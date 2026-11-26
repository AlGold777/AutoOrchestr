// TheCycle C02: durable state, append-only journal and exclusive transport ownership.
// No model calls, scheduling, or automatic eviction. IndexedDB transactions are
// the source of truth; the UI and Basic's disposable history are not.
(function initTheCycleStateStore(root) {
  'use strict';
  const DB_NAME = 'auto-orchestr-thecycle';
  const DB_VERSION = 1;
  const STORES = ['research', 'control', 'runs', 'events', 'packets'];
  const LOCK = 'transport';
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const str = (value) => typeof value === 'string' && value.trim().length > 0;
  const pos = (value) => Number.isSafeInteger(value) && value > 0;
  const nat = (value) => Number.isSafeInteger(value) && value >= 0;
  class StoreError extends Error {
    constructor(code, message) {
      super(message || code);
      this.name = 'TheCycleStoreError';
      this.code = code;
    }
  }
  const fail = (code, message) => new StoreError(code, message);
  function request(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || fail('IDB_REQUEST_FAILED'));
    });
  }
  function openDatabase(factory, name) {
    return new Promise((resolve, reject) => {
      const req = factory.open(name, DB_VERSION);
      let blocked = false;
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('research')) db.createObjectStore('research', { keyPath: 'researchId' });
        if (!db.objectStoreNames.contains('control')) db.createObjectStore('control', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('runs')) db.createObjectStore('runs', { keyPath: ['researchId', 'runId'] });
        if (!db.objectStoreNames.contains('events')) db.createObjectStore('events', { keyPath: ['researchId', 'runId', 'eventId'] });
        if (!db.objectStoreNames.contains('packets')) db.createObjectStore('packets', { keyPath: ['researchId', 'cycleId'] });
      };
      req.onblocked = () => { blocked = true; reject(fail('DB_UPGRADE_BLOCKED')); };
      req.onerror = () => reject(req.error || fail('DB_OPEN_FAILED'));
      req.onsuccess = () => {
        const db = req.result;
        if (blocked) { db.close(); return; }
        db.onversionchange = () => db.close();
        resolve(db);
      };
    });
  }
  // Only IndexedDB operations and synchronous computation inside work().
  // Resolving a write request is NOT success: wait for transaction completion.
  async function tx(db, mode, work) {
    const t = db.transaction(STORES, mode);
    const done = new Promise((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onabort = () => reject(t.error || fail('TRANSACTION_ABORTED'));
      t.onerror = () => {}; // request/abort handles the error
    });
    done.catch(() => {}); // avoid unhandled rejection while a request is pending
    const s = Object.fromEntries(STORES.map((name) => [name, t.objectStore(name)]));
    try {
      const result = await work(s);
      await done;
      return result;
    } catch (error) {
      try { t.abort(); } catch (_) { /* already ended */ }
      try { await done; } catch (_) { /* preserve original error */ }
      throw error;
    }
  }
  function checkIdentity(researchId, ownerId) {
    if (!str(researchId) || !str(ownerId)) throw fail('INVALID_OWNER');
  }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function checkVersion(state, version) {
    if (!nat(version) || state.stateVersion !== version) throw fail('STALE_STATE');
  }
  async function mustState(s, researchId) {
    const state = await request(s.research.get(researchId));
    if (!state) throw fail('RESEARCH_NOT_FOUND');
    return state;
  }
  async function mustOwn(s, token) {
    if (!token || !str(token.ownerId) || !str(token.researchId) || !pos(token.epoch)) throw fail('INVALID_FENCE');
    const lock = await request(s.control.get(LOCK));
    if (!lock || lock.researchId !== token.researchId || lock.ownerId !== token.ownerId || lock.epoch !== token.epoch) {
      throw fail('STALE_OWNER');
    }
    return mustState(s, token.researchId);
  }
  async function writeState(s, state) {
    state.stateVersion += 1;
    await request(s.research.put(state));
    return state;
  }

  async function createStateStore({ indexedDB = root.indexedDB, name = DB_NAME } = {}) {
    if (!indexedDB || typeof indexedDB.open !== 'function') throw fail('INDEXEDDB_UNAVAILABLE');
    const db = await openDatabase(indexedDB, name);
    const read = (work) => tx(db, 'readonly', work);
    const write = (work) => tx(db, 'readwrite', work);

    async function createResearch({ researchId, task, pipelineRef, maxCalls } = {}) {
      if (![researchId, task, pipelineRef].every(str) || !pos(maxCalls)) throw fail('INVALID_RESEARCH');
      const state = {
        researchId, task, pipelineRef, stateVersion: 0, phase: 'READY',
        nextCycle: 1, activeRunId: null, lastCommittedPacket: null, backupRequiredCycleId: null,
        stopRequested: false, budget: { maxCalls, usedCalls: 0 }
      };
      return write(async (s) => {
        if (await request(s.research.get(researchId))) throw fail('RESEARCH_EXISTS');
        await request(s.research.add(state));
        return copy(state);
      });
    }

    const load = (researchId) => read(async (s) => copy(await mustState(s, researchId)));
    const getOwnership = () => read(async (s) => copy((await request(s.control.get(LOCK))) || null));

    // Ownership has no timeout: an expired timer is not proof that a provider
    // stopped generating. Explicit takeover fences the old writer and forces
    // recovery; it is never permission to send a second request.
    async function acquire({ researchId, ownerId, takeoverEpoch = null } = {}) {
      checkIdentity(researchId, ownerId);
      return write(async (s) => {
        const state = await mustState(s, researchId);
        const old = await request(s.control.get(LOCK));
        if (old?.ownerId && old.ownerId === ownerId && old.researchId === researchId && takeoverEpoch === null) {
          return { researchId, ownerId, epoch: old.epoch };
        }
        if (old?.ownerId) {
          if (old.researchId !== researchId || takeoverEpoch !== old.epoch) throw fail('TRANSPORT_OWNED');
          // A recovery owner must be distinct from the old owner.
          if (ownerId === old.ownerId) throw fail('TAKEOVER_REQUIRES_NEW_OWNER');
          if (state.activeRunId) {
            state.phase = 'RECONCILE';
            await writeState(s, state);
          }
        } else if (takeoverEpoch !== null) {
          throw fail('STALE_OWNER');
        }
        const epoch = (old?.epoch || 0) + 1;
        if (!pos(epoch)) throw fail('EPOCH_OVERFLOW');
        await request(s.control.put({ key: LOCK, researchId, ownerId, epoch }));
        return { researchId, ownerId, epoch };
      });
    }

    async function release(token) {
      return write(async (s) => {
        const state = await mustOwn(s, token);
        if (state.activeRunId) throw fail('RUN_UNSETTLED');
        await request(s.control.put({ key: LOCK, researchId: null, ownerId: null, epoch: token.epoch }));
        return true;
      });
    }

    async function prepareRun(token, { expectedVersion, runId, cycleId, pipelineRef, maxCalls } = {}) {
      if (![runId, pipelineRef].every(str) || !pos(cycleId) || !pos(maxCalls)) throw fail('INVALID_RUN');
      return write(async (s) => {
        const state = await mustOwn(s, token);
        checkVersion(state, expectedVersion);
        if (state.phase !== 'READY' || state.activeRunId || state.stopRequested) throw fail('RUN_NOT_ALLOWED');
        if (cycleId !== state.nextCycle || pipelineRef !== state.pipelineRef) throw fail('WRONG_PLAN');
        if (maxCalls > state.budget.maxCalls - state.budget.usedCalls) throw fail('BUDGET_EXHAUSTED');
        const run = { researchId: state.researchId, runId, cycleId, pipelineRef, maxCalls,
          usedCalls: 0, phase: 'PREPARED', batches: [], resultEventId: null, eventCount: 0 };
        await request(s.runs.add(run)); // unique runId within research
        state.activeRunId = runId;
        state.phase = 'INTENT';
        return copy(await writeState(s, state));
      });
    }

    function eventKey(event) {
      const type = event.type;
      if (['RUN_INTENT', 'RUN_RESULT', 'RUN_ERROR'].includes(type)) return type;
      if (['DISPATCH_INTENT', 'DISPATCH_RESPONSE', 'DISPATCH_UNKNOWN', 'NOT_SENT'].includes(type) && str(event.batchId)) {
        return type + ':' + event.batchId;
      }
      throw fail('INVALID_EVENT');
    }

    // Bind once per owner to the C01 adapter's journal callback. Every event
    // is fenced and the budget is debited in the same transaction as intent.
    function journalFor(token) {
      return async function append(raw) {
        const event = copy(raw);
        const eventId = eventKey(event);
        if (event.researchId !== token.researchId || !str(event.runId) || !pos(event.cycleId)) throw fail('INVALID_EVENT_IDENTITY');
        return write(async (s) => {
          const state = await mustOwn(s, token);
          const key = [event.researchId, event.runId, eventId];
          const prior = await request(s.events.get(key));
          if (prior) {
            if (!same(prior.payload, event)) throw fail('EVENT_CONFLICT');
            // A duplicate intent must not be interpreted as permission to send again.
            if (event.type === 'DISPATCH_INTENT' || event.type === 'RUN_INTENT') throw fail('INTENT_ALREADY_RECORDED');
            return { duplicate: true, eventId };
          }
          const run = await request(s.runs.get([event.researchId, event.runId]));
          if (!run || state.activeRunId !== run.runId || run.cycleId !== event.cycleId) throw fail('RUN_NOT_ACTIVE');
          const batch = run.batches.find((item) => item.batchId === event.batchId);

          switch (event.type) {
            case 'RUN_INTENT':
              if (run.phase !== 'PREPARED' || state.stopRequested || event.maxCalls !== run.maxCalls) throw fail('RUN_NOT_ALLOWED');
              run.phase = 'RUNNING';
              state.phase = 'RUNNING';
              break;
            case 'DISPATCH_INTENT': {
              if (state.stopRequested || state.phase !== 'RUNNING' || run.phase !== 'RUNNING' || batch ||
                  run.batches.some((item) => ['INTENT', 'UNKNOWN'].includes(item.status))) throw fail('DISPATCH_NOT_ALLOWED');
              const count = Array.isArray(event.models) ? event.models.length : 0;
              if (!pos(count) || new Set(event.models).size !== count || !event.models.every(str) ||
                  run.usedCalls + count > run.maxCalls || state.budget.usedCalls + count > state.budget.maxCalls) throw fail('BUDGET_OR_BATCH_INVALID');
              run.usedCalls += count;
              state.budget.usedCalls += count;
              run.batches.push({ batchId: event.batchId, count, status: 'INTENT' });
              break;
            }
            case 'NOT_SENT':
              if (!batch || batch.status !== 'INTENT') throw fail('INVALID_BATCH_TRANSITION');
              batch.status = 'NOT_SENT';
              run.usedCalls -= batch.count;
              state.budget.usedCalls -= batch.count;
              break;
            case 'DISPATCH_RESPONSE':
              if (!batch || batch.status !== 'INTENT') throw fail('INVALID_BATCH_TRANSITION');
              batch.status = 'RESPONSE';
              break;
            case 'DISPATCH_UNKNOWN':
              if (!batch || batch.status !== 'INTENT') throw fail('INVALID_BATCH_TRANSITION');
              batch.status = 'UNKNOWN';
              state.phase = 'RECONCILE';
              break;
            case 'RUN_RESULT':
            case 'RUN_ERROR':
              if (!['RUNNING', 'PREPARED'].includes(run.phase)) throw fail('INVALID_RUN_TRANSITION');
              if (event.type === 'RUN_RESULT' && (!event.report || event.report.runId !== run.runId ||
                  event.report.researchId !== state.researchId || event.report.cycleId !== run.cycleId)) throw fail('INVALID_REPORT');
              run.phase = event.type === 'RUN_RESULT' ? 'RESULT' : 'ERROR';
              run.resultEventId = eventId;
              state.phase = run.batches.some((item) => ['INTENT', 'UNKNOWN'].includes(item.status)) ? 'RECONCILE' : 'COMMIT';
              break;
            default: throw fail('INVALID_EVENT');
          }
          run.eventCount += 1;
          await request(s.events.add({ researchId: event.researchId, runId: event.runId, eventId,
            sequence: run.eventCount, payload: event }));
          await request(s.runs.put(run));
          await writeState(s, state);
          return { eventId, stateVersion: state.stateVersion };
        });
      };
    }

    async function getRun(researchId, runId) {
      return read(async (s) => copy((await request(s.runs.get([researchId, runId]))) || null));
    }
    async function getEvents(researchId, runId) {
      // Composite key bounds select one run without scanning other research.
      return read(async (s) => {
        const range = root.IDBKeyRange?.bound([researchId, runId], [researchId, runId, []]);
        if (!range) throw fail('IDB_KEY_RANGE_UNAVAILABLE');
        const rows = await request(s.events.getAll(range));
        return copy(rows.sort((a, b) => a.sequence - b.sequence));
      });
    }

    // No automatic resending here. Caller supplies correlated transport/owner
    // evidence; C04 must implement the actual verification and safe takeover.
    async function reconcileBatch(token, { runId, batchId, expectedVersion, status, evidence } = {}) {
      if (![runId, batchId].every(str) || !['RESPONSE', 'NOT_SENT'].includes(status) ||
          !evidence || typeof evidence !== 'object' || !str(evidence.source) || !str(evidence.reference)) throw fail('INVALID_RECONCILIATION');
      const payload = copy({ runId, batchId, status, evidence });
      return write(async (s) => {
        const state = await mustOwn(s, token);
        checkVersion(state, expectedVersion);
        if (state.phase !== 'RECONCILE' || state.activeRunId !== runId) throw fail('RECONCILIATION_NOT_ALLOWED');
        const run = await request(s.runs.get([state.researchId, runId]));
        const batch = run?.batches.find((item) => item.batchId === batchId);
        if (!batch || !['INTENT', 'UNKNOWN'].includes(batch.status)) throw fail('INVALID_BATCH_TRANSITION');
        batch.status = status;
        if (status === 'NOT_SENT') {
          run.usedCalls -= batch.count;
          state.budget.usedCalls -= batch.count;
        }
        run.eventCount += 1;
        await request(s.events.add({ researchId: state.researchId, runId, eventId: 'RECONCILED:' + batchId,
          sequence: run.eventCount, payload }));
        // Even if every dispatch is settled, main Basic cannot resume midway.
        // An interrupted run becomes a partial recovery packet, never a success.
        if (!run.batches.some((item) => ['INTENT', 'UNKNOWN'].includes(item.status))) state.phase = 'COMMIT';
        await request(s.runs.put(run));
        return copy(await writeState(s, state));
      });
    }

    // If a crashed run had no unsettled batch, it still needs an explicit
    // recovery decision before creating a partial packet.
    async function settleInterruptedRun(token, { expectedVersion, runId, evidence } = {}) {
      if (!str(runId) || !evidence || !str(evidence.source) || !str(evidence.reference)) throw fail('INVALID_RECOVERY');
      return write(async (s) => {
        const state = await mustOwn(s, token);
        checkVersion(state, expectedVersion);
        if (state.phase !== 'RECONCILE' || state.activeRunId !== runId) throw fail('RECOVERY_NOT_ALLOWED');
        const run = await request(s.runs.get([state.researchId, runId]));
        if (!run || run.batches.some((item) => ['INTENT', 'UNKNOWN'].includes(item.status))) throw fail('RUN_UNSETTLED');
        run.eventCount += 1;
        await request(s.events.add({ researchId: state.researchId, runId, eventId: 'RECOVERY_DECISION',
          sequence: run.eventCount, payload: copy(evidence) }));
        await request(s.runs.put(run));
        state.phase = 'COMMIT';
        return copy(await writeState(s, state));
      });
    }

    // Owner Stop with a request already sent: the unresolved batches stay UNKNOWN (budget stays spent, nothing is
    // resent, no packet is invented), the run is closed and the research ends with an explicit reason, so the
    // transport can be released and a new research can start.
    async function abandonRun(token, { expectedVersion, runId, reason } = {}) {
      if (!str(runId) || !str(reason) || reason.length > 200) throw fail('INVALID_RECOVERY');
      return write(async (s) => {
        const state = await mustOwn(s, token);
        checkVersion(state, expectedVersion);
        if (!state.stopRequested || state.activeRunId !== runId ||
            !['RECONCILE', 'RUNNING', 'INTENT'].includes(state.phase)) throw fail('ABANDON_NOT_ALLOWED');
        const run = await request(s.runs.get([state.researchId, runId]));
        if (!run) throw fail('RUN_NOT_ACTIVE');
        const unresolvedBatchIds = [];
        for (const batch of run.batches) {
          if (['INTENT', 'UNKNOWN'].includes(batch.status)) { batch.status = 'UNKNOWN'; unresolvedBatchIds.push(batch.batchId); }
        }
        run.phase = 'CLOSED_UNRESOLVED';
        run.eventCount += 1;
        await request(s.events.add({ researchId: state.researchId, runId, eventId: 'RUN_CLOSED',
          sequence: run.eventCount, payload: { type: 'RUN_CLOSED', runId, reason, unresolvedBatchIds } }));
        await request(s.runs.put(run));
        state.activeRunId = null;
        state.phase = 'COMPLETED';
        state.closedReason = reason;
        state.lastDecision = { action: 'COMPLETE', reason, stateVersion: state.stateVersion };
        return copy(await writeState(s, state));
      });
    }

    // Atomic handoff: raw journal remains immutable and the packet references
    // it. Semantic knowledge graph / manifest hashing belongs to C05.
    async function commitPacket(token, { expectedVersion, runId } = {}) {
      if (!str(runId)) throw fail('INVALID_RUN');
      return write(async (s) => {
        const state = await mustOwn(s, token);
        checkVersion(state, expectedVersion);
        if (state.phase !== 'COMMIT' || state.activeRunId !== runId) throw fail('COMMIT_NOT_ALLOWED');
        const run = await request(s.runs.get([state.researchId, runId]));
        if (!run || run.batches.some((item) => ['INTENT', 'UNKNOWN'].includes(item.status))) throw fail('RUN_UNSETTLED');
        const packet = { researchId: state.researchId, cycleId: run.cycleId, runId,
          pipelineRef: run.pipelineRef, parentStateVersion: state.stateVersion,
          journalEventCount: run.eventCount, resultEventId: run.resultEventId,
          status: run.phase === 'RESULT' ? 'RECORDED_RESULT' : 'PARTIAL_RECOVERY', usedCalls: run.usedCalls };
        await request(s.packets.add(packet));
        run.phase = 'COMMITTED';
        await request(s.runs.put(run));
        state.lastCommittedPacket = run.cycleId;
        // Persist backup obligation in the SAME transaction as the packet.
        state.backupRequiredCycleId = run.cycleId;
        state.nextCycle += 1;
        state.activeRunId = null;
        state.phase = state.stopRequested ? 'PAUSED' : 'EVALUATE';
        await writeState(s, state);
        return copy({ state, packet });
      });
    }

    async function acknowledgePacketBackup(token, { expectedVersion, cycleId } = {}) {
      if (!pos(cycleId)) throw fail('INVALID_CYCLE');
      return write(async (s) => {
        const state = await mustOwn(s, token);
        checkVersion(state, expectedVersion);
        if (state.backupRequiredCycleId !== cycleId ||
            state.lastCommittedPacket !== cycleId ||
            !(await request(s.packets.get([state.researchId, cycleId]))))
          throw fail('BACKUP_ACK_NOT_ALLOWED');
        state.backupRequiredCycleId = null;
        return copy(await writeState(s, state));
      });
    }

    const getPacket = (researchId, cycleId) => read(async (s) => copy((await request(s.packets.get([researchId, cycleId]))) || null));

    async function requestStop(researchId) {
      return write(async (s) => {
        const state = await mustState(s, researchId);
        state.stopRequested = true;
        if (!state.activeRunId && state.phase !== 'COMPLETED') state.phase = 'PAUSED';
        return copy(await writeState(s, state));
      });
    }

    // C03's decision hook: only from a settled run or a deliberate pause.
    const FINAL_STATUSES = ['PARTIAL', 'INCONCLUSIVE', 'BUDGET_EXHAUSTED', 'CANCELLED', 'ERROR', 'VERIFIED_SOLUTION'];
    // detail is a bounded record of why the policy chose the action: only these keys, only strings.
    const DETAIL_KEYS = ['action', 'refs', 'reason', 'question', 'errors', 'schema', 'claim', 'procedure', 'verifier', 'independence', 'verificationRecord'];
    const VERDICTS = ['SUPPORTED', 'CONTRADICTED', 'INSUFFICIENT', 'VERIFIED'];
    const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    const jsonSize = (v) => JSON.stringify(v).length;
    const DETAIL_JSON_MAX = 65536;
    // Verification record of one VERIFY cycle: bounded, only these keys.
    function cleanVerificationRecord(rec) {
      const keys = ['claim', 'procedure', 'verdict', 'checks', 'independence', 'verifierModel', 'limitations', 'downgrades'];
      if (!isObj(rec) || Object.keys(rec).some((key) => !keys.includes(key)) || !VERDICTS.includes(rec.verdict) ||
          typeof rec.claim !== 'string' || !Array.isArray(rec.procedure) || !Array.isArray(rec.checks) ||
          typeof rec.independence !== 'string' || typeof rec.verifierModel !== 'string' || jsonSize(rec) > DETAIL_JSON_MAX) throw fail('INVALID_DECISION_DETAIL');
      return copy(rec);
    }
    // detail is a bounded record of why the policy chose the action: only these keys, bounded sizes.
    function cleanDetail(detail) {
      if (detail === undefined) return undefined;
      const strs = (list, max) => Array.isArray(list) && list.length <= max && list.every((v) => typeof v === 'string' && v.length <= 400);
      if (!isObj(detail) || Object.keys(detail).some((key) => !DETAIL_KEYS.includes(key))) throw fail('INVALID_DECISION_DETAIL');
      const out = {};
      for (const key of ['action', 'reason', 'question', 'claim', 'verifier', 'independence']) {
        if (detail[key] === undefined) continue;
        if (typeof detail[key] !== 'string' || detail[key].length > 2000) throw fail('INVALID_DECISION_DETAIL');
        out[key] = detail[key];
      }
      for (const [key, max] of [['refs', 50], ['errors', 30]]) {
        if (detail[key] === undefined) continue;
        if (!strs(detail[key], max)) throw fail('INVALID_DECISION_DETAIL');
        out[key] = [...detail[key]];
      }
      if (detail.procedure !== undefined) {
        if (!Array.isArray(detail.procedure) || detail.procedure.length > 10 || !detail.procedure.every((item) => isObj(item) &&
            Object.keys(item).every((key) => ['id', 'check'].includes(key)) && typeof item.id === 'string' && typeof item.check === 'string')) throw fail('INVALID_DECISION_DETAIL');
        out.procedure = copy(detail.procedure);
      }
      if (detail.schema !== undefined) {
        if (!isObj(detail.schema) || jsonSize(detail.schema) > DETAIL_JSON_MAX) throw fail('INVALID_DECISION_DETAIL');
        out.schema = copy(detail.schema);
      }
      if (detail.verificationRecord !== undefined) out.verificationRecord = cleanVerificationRecord(detail.verificationRecord);
      return out;
    }

    async function decide(token, { expectedVersion, action, pipelineRef, reason, detail, finalStatus, verificationRecord } = {}) {
      if (!['CONTINUE', 'PAUSE', 'COMPLETE', 'RESUME'].includes(action)) throw fail('INVALID_DECISION');
      const cleanedDetail = cleanDetail(detail);
      if (finalStatus !== undefined && (!FINAL_STATUSES.includes(finalStatus) || action !== 'COMPLETE' ||
          (finalStatus === 'VERIFIED_SOLUTION' && verificationRecord !== true))) throw fail('INVALID_FINAL_STATUS');
      return write(async (s) => {
        const state = await mustOwn(s, token);
        checkVersion(state, expectedVersion);
        if (state.activeRunId || !['EVALUATE', 'READY', 'PAUSED'].includes(state.phase)) throw fail('DECISION_NOT_ALLOWED');
        if (action === 'CONTINUE' && state.stopRequested) throw fail('STOP_REQUESTED');
        if (action === 'RESUME' && state.phase !== 'PAUSED') throw fail('RESUME_NOT_ALLOWED');
        if (pipelineRef !== undefined) {
          if (!str(pipelineRef) || !['CONTINUE', 'RESUME'].includes(action)) throw fail('INVALID_PIPELINE');
          state.pipelineRef = pipelineRef; // C03 validates schema before dispatch
        }
        if (reason !== undefined && (!str(reason) || reason.length > 200)) throw fail('INVALID_DECISION_REASON');
        if (state.phase === 'EVALUATE' && state.lastCommittedPacket !== null) {
          const packet = await request(s.packets.get([state.researchId, state.lastCommittedPacket]));
          if (!packet || packet.decision) throw fail('DECISION_PACKET_INVALID');
          packet.decision = { action, reason: reason || null, stateVersion: state.stateVersion };
          if (cleanedDetail !== undefined) packet.decision.detail = copy(cleanedDetail);
          await request(s.packets.put(packet));
        }
        if (reason !== undefined) {
          state.lastDecision = { action, reason, stateVersion: state.stateVersion };
          // The heavy parts (schema, verification record) stay on the packet; the state keeps the short part.
          if (cleanedDetail !== undefined) { const { schema: _s, verificationRecord: _v, ...light } = cleanedDetail; state.lastDecision.detail = copy(light); }
        }
        if (finalStatus !== undefined) state.finalStatus = finalStatus;
        if (action === 'RESUME') state.stopRequested = false;
        state.phase = action === 'COMPLETE' ? 'COMPLETED' : action === 'PAUSE' ? 'PAUSED' : 'READY';
        // No decision here asserts mathematical proof.
        return copy(await writeState(s, state));
      });
    }

    // C02 backup foundation: capture every store in one readonly transaction.
    // This is a consistent logical snapshot, not a durable off-device backup.
    // The caller MUST write the returned object to independent storage and
    // confirm its integrity before claiming backup protection.
    async function exportSnapshot() {
      return read(async (s) => {
        const snapshot = { format: 'thecycle-idb-snapshot', version: 1, databaseVersion: DB_VERSION, stores: {} };
        for (const name of STORES) snapshot.stores[name] = copy(await request(s[name].getAll()));
        return snapshot;
      });
    }

    // Integrity envelope covers the exact UTF-8 JSON bytes, not a reserialized
    // object. SHA-256 detects corruption; it does NOT authenticate the source.
    async function digest(bytes, cryptoApi) {
      if (!cryptoApi?.subtle?.digest) throw fail('BACKUP_CRYPTO_UNAVAILABLE');
      const hash = new Uint8Array(await cryptoApi.subtle.digest('SHA-256', bytes));
      return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
    }

    async function exportVerifiedBackup({ cryptoApi = root.crypto } = {}) {
      if (typeof TextEncoder === 'undefined') throw fail('BACKUP_ENCODING_UNAVAILABLE');
      const snapshot = await exportSnapshot();
      const payload = JSON.stringify(snapshot);
      const sha256 = await digest(new TextEncoder().encode(payload), cryptoApi);
      return { format: 'thecycle-backup', version: 1, algorithm: 'SHA-256', sha256, payload };
    }

    async function verifyBackup(envelope, { cryptoApi = root.crypto } = {}) {
      if (!envelope || envelope.format !== 'thecycle-backup' || envelope.version !== 1 ||
          envelope.algorithm !== 'SHA-256' || typeof envelope.payload !== 'string' ||
          !/^[0-9a-f]{64}$/.test(envelope.sha256 || '')) throw fail('INVALID_BACKUP');
      if (typeof TextEncoder === 'undefined') throw fail('BACKUP_ENCODING_UNAVAILABLE');
      const actual = await digest(new TextEncoder().encode(envelope.payload), cryptoApi);
      if (actual !== envelope.sha256) throw fail('BACKUP_INTEGRITY_FAILED');
      let snapshot;
      try { snapshot = JSON.parse(envelope.payload); } catch (_) { throw fail('INVALID_BACKUP_PAYLOAD'); }
      if (snapshot?.format !== 'thecycle-idb-snapshot' || snapshot.version !== 1 ||
          snapshot.databaseVersion !== DB_VERSION || !snapshot.stores ||
          !STORES.every((name) => Array.isArray(snapshot.stores[name])) ||
          Object.keys(snapshot.stores).length !== STORES.length) throw fail('BACKUP_SCHEMA_MISMATCH');
      return copy(snapshot);
    }

    return Object.freeze({ createResearch, load, getOwnership, acquire, release, prepareRun, journalFor,
      getRun, getEvents, getPacket, reconcileBatch, settleInterruptedRun, abandonRun, commitPacket, acknowledgePacketBackup, requestStop, decide, exportSnapshot, exportVerifiedBackup, verifyBackup,
      close: () => db.close() });
  }
  const api = Object.freeze({ createStateStore, StoreError, DB_NAME, DB_VERSION });
  root.TheCycleStateStore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
