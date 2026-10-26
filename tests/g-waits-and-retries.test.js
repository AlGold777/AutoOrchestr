/** @jest-environment node */
const Engine = require('../disput/custom-engine.js');
const CustomRunRecord = require('../disput/custom-run-record.js');

const clone = (val) => JSON.parse(JSON.stringify(val));

describe('Package G: User Waits and Retry Origins (C05 + C06 / ТЗ 5.G)', () => {
  describe('C05: User waits lifecycle, events and storage in CustomRunRecord', () => {
    test('createRun initializes record.waits as an array, and recordWaitStart/recordWaitEnd update wait lifecycle', () => {
      const record = CustomRunRecord.createRun({
        runId: 'run-g01',
        steps: [{ ref: 's1', kind: 'round', models: ['Claude'] }]
      });

      // 1. record.waits must exist and be an array
      expect(Array.isArray(record.waits)).toBe(true);
      expect(record.waits).toHaveLength(0);

      // 2. recordWaitStart registers active wait
      expect(typeof CustomRunRecord.recordWaitStart).toBe('function');
      const wait = CustomRunRecord.recordWaitStart(record, {
        waitId: 'wait-1',
        kind: 'decision',
        stepRef: 's1',
        visit: 1,
        startedAt: 1000
      });

      expect(wait).toMatchObject({
        waitId: 'wait-1',
        kind: 'decision',
        stepRef: 's1',
        visit: 1,
        startedAt: 1000,
        endedAt: null,
        outcome: null
      });
      expect(record.waits).toHaveLength(1);

      // 3. recordWaitEnd closes active wait
      expect(typeof CustomRunRecord.recordWaitEnd).toBe('function');
      const closed = CustomRunRecord.recordWaitEnd(record, {
        waitId: 'wait-1',
        endedAt: 2500,
        outcome: 'approved'
      });

      expect(closed).toMatchObject({
        waitId: 'wait-1',
        kind: 'decision',
        endedAt: 2500,
        outcome: 'approved'
      });
      expect(record.waits[0].endedAt).toBe(2500);
      expect(record.waits[0].outcome).toBe('approved');
    });

    test('Engine emits paired custom_wait_start and custom_wait_end events around decision dialog', async () => {
      const emittedEvents = [];
      const record = CustomRunRecord.createRun({
        runId: 'run-g02',
        steps: [{ ref: 's1', kind: 'round', models: ['Claude'] }]
      });

      const steps = [
        {
          ref: 's1',
          kind: 'round',
          input: 'none',
          owner: 'approve',
          models: [{ id: 'C1', name: 'Claude' }]
        }
      ];

      await Engine.run({
        task: 'Task',
        steps,
        onEvent: (name, payload) => {
          emittedEvents.push({ name, ...payload });
        },
        onRequest: (entry) => CustomRunRecord.recordAttempt(record, entry),
        onResponse: (entry) => CustomRunRecord.recordAttempt(record, entry),
        sendParticipants: async () => ({
          C1: { text: 'Answer 1', status: 'SUCCESS', transportRequestId: 'req-1' }
        }),
        decide: async ({ choices }) => {
          expect(choices).toContain('continue');
          return 'continue';
        }
      });

      const waitStart = emittedEvents.find((e) => e.name === 'custom_wait_start');
      const waitEnd = emittedEvents.find((e) => e.name === 'custom_wait_end');

      expect(waitStart).toBeDefined();
      expect(waitStart.waitId).toBeDefined();
      expect(waitStart.kind).toBe('decision');
      expect(waitStart.stepRef).toBe('s1');
      expect(waitStart.visit).toBe(1);
      expect(typeof waitStart.startedAt).toBe('number');

      expect(waitEnd).toBeDefined();
      expect(waitEnd.waitId).toBe(waitStart.waitId);
      expect(waitEnd.kind).toBe('decision');
      expect(waitEnd.stepRef).toBe('s1');
      expect(waitEnd.visit).toBe(1);
      expect(waitEnd.endedAt).toBeGreaterThanOrEqual(waitStart.startedAt);
      expect(waitEnd.outcome).toBe('approved');
    });

    test('aborting during decision wait emits custom_wait_end with outcome stopped/cancelled and endedAt', async () => {
      const emittedEvents = [];
      const controller = new AbortController();
      const record = CustomRunRecord.createRun({
        runId: 'run-g03',
        steps: [{ ref: 's1', kind: 'round', models: ['Claude'] }]
      });

      const steps = [
        {
          ref: 's1',
          kind: 'round',
          input: 'none',
          owner: 'approve',
          models: [{ id: 'C1', name: 'Claude' }]
        }
      ];

      const runPromise = Engine.run({
        task: 'Task',
        steps,
        signal: controller.signal,
        onEvent: (name, payload) => {
          emittedEvents.push({ name, ...payload });
        },
        sendParticipants: async () => ({
          C1: { text: 'Answer 1', status: 'SUCCESS', transportRequestId: 'req-1' }
        }),
        decide: async () => {
          // User stops run while dialog is open
          controller.abort();
          const abortErr = new Error('The operation was aborted');
          abortErr.name = 'AbortError';
          throw abortErr;
        }
      });

      const res = await runPromise.catch(() => null);
      if (res) expect(res.stopReason).toBe('cancelled');

      const waitStart = emittedEvents.find((e) => e.name === 'custom_wait_start');
      const waitEnd = emittedEvents.find((e) => e.name === 'custom_wait_end');

      expect(waitStart).toBeDefined();
      expect(waitEnd).toBeDefined();
      expect(waitEnd.waitId).toBe(waitStart.waitId);
      expect(['stopped', 'cancelled']).toContain(waitEnd.outcome);
      expect(typeof waitEnd.endedAt).toBe('number');
    });

    test('resuming wait after suspension preserves unfinished wait and links new wait via resumedFrom', () => {
      const record = CustomRunRecord.createRun({
        runId: 'run-g04',
        steps: [{ ref: 's1', kind: 'round', models: ['Claude'] }]
      });

      // Old wait in previous worker session was interrupted (endedAt is null)
      CustomRunRecord.recordWaitStart(record, {
        waitId: 'wait-old',
        kind: 'owner',
        stepRef: 's1',
        visit: 1,
        startedAt: 1000
      });

      // Resume in new session starts a linked wait
      const resumedWait = CustomRunRecord.recordWaitStart(record, {
        waitId: 'wait-resumed',
        kind: 'owner',
        stepRef: 's1',
        visit: 1,
        startedAt: 5000,
        resumedFrom: 'wait-old'
      });

      expect(resumedWait.resumedFrom).toBe('wait-old');
      expect(record.waits[0].endedAt).toBeNull(); // No invented end time for old wait
      expect(record.waits[1].resumedFrom).toBe('wait-old');
    });
  });

  describe('C06: Retry origins and triggers (attempt.trigger and attempt.triggerReason)', () => {
    test('initial attempt has trigger: initial', async () => {
      const record = CustomRunRecord.createRun({
        runId: 'run-g05',
        steps: [{ ref: 's1', kind: 'round', models: ['Claude'] }]
      });

      await Engine.run({
        task: 'Task',
        steps: [{ ref: 's1', kind: 'round', input: 'none', models: [{ id: 'C1', name: 'Claude' }] }],
        onRequest: (entry) => CustomRunRecord.recordAttempt(record, entry),
        onResponse: (entry) => CustomRunRecord.recordAttempt(record, entry),
        sendParticipants: async () => ({
          C1: { text: 'Answer 1', status: 'SUCCESS', transportRequestId: 'req-1' }
        })
      });

      const attempt = record.attempts.find((a) => a.participant === 'C1');
      expect(attempt).toBeDefined();
      expect(attempt.trigger).toBe('initial');
    });

    test('automatic retry has trigger: automatic_retry and triggerReason: empty_answer', async () => {
      const record = CustomRunRecord.createRun({
        runId: 'run-g06',
        steps: [{ ref: 's1', kind: 'round', models: ['Claude'] }]
      });

      let callCount = 0;
      await Engine.run({
        task: 'Task',
        steps: [{ ref: 's1', kind: 'round', input: 'none', models: [{ id: 'C1', name: 'Claude' }] }],
        onRequest: (entry) => CustomRunRecord.recordAttempt(record, entry),
        onResponse: (entry) => CustomRunRecord.recordAttempt(record, entry),
        sendParticipants: async () => {
          callCount += 1;
          if (callCount === 1) {
            // First attempt produces empty answer -> triggers automatic retry
            return { C1: { text: '', status: 'SUCCESS', transportRequestId: 'req-empty' } };
          }
          return { C1: { text: 'Valid answer on retry', status: 'SUCCESS', transportRequestId: 'req-ok' } };
        }
      });

      const attempts = record.attempts.filter((a) => a.participant === 'C1');
      expect(attempts).toHaveLength(2);

      const [firstAttempt, retryAttempt] = attempts;
      expect(firstAttempt.trigger).toBe('initial');

      expect(retryAttempt.trigger).toBe('automatic_retry');
      expect(retryAttempt.triggerReason).toBe('empty_answer');
      expect(retryAttempt.retryOf).toBe(1);
    });

    test('manual retry from decision dialog has trigger: user_retry and triggerReason: user_decision', async () => {
      const record = CustomRunRecord.createRun({
        runId: 'run-g07',
        steps: [{ ref: 's1', kind: 'round', models: ['Claude'] }]
      });

      let decided = false;
      await Engine.run({
        task: 'Task',
        steps: [{ ref: 's1', kind: 'round', input: 'none', models: [{ id: 'C1', name: 'Claude' }] }],
        maxAttempts: 1,
        onRequest: (entry) => CustomRunRecord.recordAttempt(record, entry),
        onResponse: (entry) => CustomRunRecord.recordAttempt(record, entry),
        sendParticipants: async () => {
          if (!decided) {
            return { C1: { text: '', status: 'SUCCESS', transportRequestId: 'req-1' } };
          }
          return { C1: { text: 'Retry answer', status: 'SUCCESS', transportRequestId: 'req-2' } };
        },
        decide: async ({ choices }) => {
          if (!decided) {
            decided = true;
            // User manually clicks retry in decision dialog
            return 'retry';
          }
          return 'continue';
        }
      });

      const attempts = record.attempts.filter((a) => a.participant === 'C1');
      expect(attempts).toHaveLength(2);

      const retryAttempt = attempts[1];
      expect(retryAttempt.trigger).toBe('user_retry');
      expect(retryAttempt.triggerReason).toBe('user_decision');
    });

    test('check action on unknown response completes original attempt with recoveredBy: check without new send or intent', async () => {
      const record = CustomRunRecord.createRun({
        runId: 'run-g08',
        steps: [{ ref: 's1', kind: 'round', models: ['Claude'] }]
      });

      let sendCalls = 0;
      await Engine.run({
        task: 'Task',
        steps: [{ ref: 's1', kind: 'round', input: 'none', models: [{ id: 'C1', name: 'Claude' }] }],
        onRequest: (entry) => CustomRunRecord.recordAttempt(record, entry),
        onResponse: (entry) => CustomRunRecord.recordAttempt(record, entry),
        sendParticipants: async () => {
          sendCalls += 1;
          // Returns UNCERTAIN status triggering settleUnknown
          return {
            C1: { text: '', status: 'UNCERTAIN', transportRequestId: 'req-unknown-1' }
          };
        },
        settleUnknown: async ({ items, choices }) => {
          expect(choices).toContain('check');
          // User selects "check" to read chat
          return { choice: 'check', checkedAnswers: { C1: 'Recovered answer from chat' } };
        }
      });

      // Checking does not execute a second transport send
      expect(sendCalls).toBe(1);

      const attempts = record.attempts.filter((a) => a.participant === 'C1');
      expect(attempts).toHaveLength(1);

      const attempt = attempts[0];
      expect(attempt.state).toBe('done');
      expect(attempt.recoveredBy).toBe('check');
      expect(attempt.accepted).toBe(true);
      expect(CustomRunRecord.textOf(record, attempt.answerRef)).toBe('Recovered answer from chat');
    });
  });

  describe('Package 7: Durable User waits history with real store / snapshot (C05)', () => {
    function makeMockStorage() {
      const db = new Map();
      return {
        get: async (key) => (db.has(key) ? JSON.parse(JSON.stringify(db.get(key))) : null),
        set: async (key, val) => db.set(key, JSON.parse(JSON.stringify(val))),
        remove: async (key) => db.delete(key),
        db
      };
    }

    test('open wait for decision is durably saved in store before dialog returns with endedAt=null and matching pendingOwner', async () => {
      const storage = makeMockStorage();
      const store = CustomRunRecord.createStore({ maxBytes: 500000, storage });
      const record = CustomRunRecord.createRun({
        runId: 'run-p7-decision',
        steps: [{ ref: 's1', kind: 'round', models: ['Claude'] }]
      });

      let loadedAtDialogOpen = null;
      await Engine.run({
        task: 'Task',
        steps: [{ ref: 's1', kind: 'round', input: 'none', owner: 'approve', models: [{ id: 'C1', name: 'Claude' }] }],
        checkpoint: async (state) => {
          CustomRunRecord.setSnapshot(record, { schema: [{ ref: 's1', kind: 'round' }], state });
          await store.save(record);
        },
        onEvent: async (kind, fields) => {
          if (kind === 'custom_wait_start') {
            CustomRunRecord.recordWaitStart(record, fields);
            await store.save(record);
          } else if (kind === 'custom_wait_end') {
            CustomRunRecord.recordWaitEnd(record, fields);
            await store.save(record);
          }
        },
        sendParticipants: async () => ({ C1: { text: 'ok', status: 'SUCCESS' } }),
        decide: async () => {
          // While decision dialog is open, read what store holds (simulating process crash/freeze)
          loadedAtDialogOpen = await store.load('run-p7-decision');
          return 'continue';
        }
      });

      expect(loadedAtDialogOpen).toBeDefined();
      expect(loadedAtDialogOpen.waits).toHaveLength(1);
      expect(loadedAtDialogOpen.waits[0].kind).toBe('decision');
      expect(typeof loadedAtDialogOpen.waits[0].startedAt).toBe('number');
      expect(loadedAtDialogOpen.waits[0].endedAt).toBeNull();
      expect(loadedAtDialogOpen.snapshot.pendingOwner).toBeDefined();
      expect(loadedAtDialogOpen.snapshot.pendingOwner.waitId).toBe(loadedAtDialogOpen.waits[0].waitId);
    });

    test('open wait for owner step is durably saved in store with endedAt=null and matching pendingOwner', async () => {
      const storage = makeMockStorage();
      const store = CustomRunRecord.createStore({ maxBytes: 500000, storage });
      const record = CustomRunRecord.createRun({
        runId: 'run-p7-owner',
        steps: [{ ref: 'o1', kind: 'owner', task: 'Owner task' }]
      });

      let loadedAtOwnerOpen = null;
      await Engine.run({
        task: 'Task',
        steps: [{ ref: 'o1', kind: 'owner', task: 'Owner task' }],
        sendParticipants: async () => ({}),
        checkpoint: async (state) => {
          CustomRunRecord.setSnapshot(record, { schema: [{ ref: 'o1', kind: 'owner' }], state });
          await store.save(record);
        },
        onEvent: async (kind, fields) => {
          if (kind === 'custom_wait_start') {
            CustomRunRecord.recordWaitStart(record, fields);
            await store.save(record);
          } else if (kind === 'custom_wait_end') {
            CustomRunRecord.recordWaitEnd(record, fields);
            await store.save(record);
          }
        },
        provideOwnerResult: async () => {
          loadedAtOwnerOpen = await store.load('run-p7-owner');
          return 'User answered';
        }
      });

      expect(loadedAtOwnerOpen).toBeDefined();
      expect(loadedAtOwnerOpen.waits).toHaveLength(1);
      expect(loadedAtOwnerOpen.waits[0].kind).toBe('owner');
      expect(loadedAtOwnerOpen.waits[0].endedAt).toBeNull();
      expect(loadedAtOwnerOpen.snapshot.pendingOwner.waitId).toBe(loadedAtOwnerOpen.waits[0].waitId);
    });

    test('open wait for asks is durably saved in store with endedAt=null and matching pendingOwner', async () => {
      const storage = makeMockStorage();
      const store = CustomRunRecord.createStore({ maxBytes: 500000, storage });
      const record = CustomRunRecord.createRun({
        runId: 'run-p7-asks',
        steps: [{ ref: 's1', kind: 'round', models: ['Claude'] }]
      });

      let loadedAtAskOpen = null;
      await Engine.run({
        task: 'Task',
        steps: [{ ref: 's1', kind: 'round', input: 'none', models: [{ id: 'C1', name: 'Claude' }] }],
        checkpoint: async (state) => {
          CustomRunRecord.setSnapshot(record, { schema: [{ ref: 's1', kind: 'round' }], state });
          await store.save(record);
        },
        onEvent: async (kind, fields) => {
          if (kind === 'custom_wait_start') {
            CustomRunRecord.recordWaitStart(record, fields);
            await store.save(record);
          } else if (kind === 'custom_wait_end') {
            CustomRunRecord.recordWaitEnd(record, fields);
            await store.save(record);
          }
        },
        sendParticipants: async () => ({ C1: { text: 'Question for user: [[ASK: what color?]]', status: 'SUCCESS' } }),
        parseAsks: (text) => (text.includes('[[ASK') ? ['what color?'] : []),
        askOwner: async () => {
          loadedAtAskOpen = await store.load('run-p7-asks');
          return ['blue'];
        }
      });

      expect(loadedAtAskOpen).toBeDefined();
      expect(loadedAtAskOpen.waits).toHaveLength(1);
      expect(loadedAtAskOpen.waits[0].kind).toBe('asks');
      expect(loadedAtAskOpen.waits[0].endedAt).toBeNull();
      expect(loadedAtAskOpen.snapshot.pendingOwner.waitId).toBe(loadedAtAskOpen.waits[0].waitId);
    });

    test('open wait for unknown resolution is durably saved with endedAt=null and matching pendingOwner', async () => {
      const storage = makeMockStorage();
      const store = CustomRunRecord.createStore({ maxBytes: 500000, storage });
      const record = CustomRunRecord.createRun({
        runId: 'run-p7-unknown',
        steps: [{ ref: 's1', kind: 'round', models: ['Claude'] }]
      });

      let loadedAtUnknownOpen = null;
      await Engine.run({
        task: 'Task',
        steps: [{ ref: 's1', kind: 'round', input: 'none', models: [{ id: 'C1', name: 'Claude' }] }],
        checkpoint: async (state) => {
          CustomRunRecord.setSnapshot(record, { schema: [{ ref: 's1', kind: 'round' }], state });
          await store.save(record);
        },
        onEvent: async (kind, fields) => {
          if (kind === 'custom_wait_start') {
            CustomRunRecord.recordWaitStart(record, fields);
            await store.save(record);
          } else if (kind === 'custom_wait_end') {
            CustomRunRecord.recordWaitEnd(record, fields);
            await store.save(record);
          }
        },
        sendParticipants: async () => ({ C1: { text: '', status: 'UNCERTAIN' } }),
        settleUnknown: async () => {
          loadedAtUnknownOpen = await store.load('run-p7-unknown');
          return { choice: 'check', checkedAnswers: { C1: 'Recovered' } };
        }
      });

      expect(loadedAtUnknownOpen).toBeDefined();
      expect(loadedAtUnknownOpen.waits).toHaveLength(1);
      expect(loadedAtUnknownOpen.waits[0].kind).toBe('unknown');
      expect(loadedAtUnknownOpen.waits[0].endedAt).toBeNull();
      expect(loadedAtUnknownOpen.snapshot.pendingOwner.waitId).toBe(loadedAtUnknownOpen.waits[0].waitId);
    });

    test('resume from crash during open wait preserves old wait with endedAt=null and creates new wait with resumedFrom', async () => {
      const storage = makeMockStorage();
      const store = CustomRunRecord.createStore({ maxBytes: 500000, storage });
      const record = CustomRunRecord.createRun({
        runId: 'run-p7-crash-resume',
        steps: [{ ref: 's1', kind: 'round', models: ['Claude'] }]
      });

      // 1. Run starts and stops while decision dialog is open (simulating process death:
      // during dialog wait, store contains wait with endedAt=null, and tab vanishes before custom_wait_end)
      let storedAtCrash = null;
      let resolveDecide = null;
      const decidePromise = new Promise((resolve) => { resolveDecide = resolve; });

      const runPromise = Engine.run({
        task: 'Task',
        steps: [{ ref: 's1', kind: 'round', input: 'none', owner: 'approve', models: [{ id: 'C1', name: 'Claude' }] }],
        putText: (v) => record.put(v),
        getText: (r) => record.texts[r],
        checkpoint: async (state) => {
          CustomRunRecord.setSnapshot(record, { schema: [{ ref: 's1', kind: 'round' }], state });
          await store.save(record);
        },
        onEvent: async (kind, fields) => {
          if (kind === 'custom_wait_start') {
            CustomRunRecord.recordWaitStart(record, fields);
            await store.save(record);
          } else if (kind === 'custom_wait_end') {
            CustomRunRecord.recordWaitEnd(record, fields);
            await store.save(record);
          }
        },
        sendParticipants: async () => ({ C1: { text: 'ok', status: 'SUCCESS' } }),
        decide: async () => {
          // While decision dialog is open, snapshot the stored state
          storedAtCrash = await store.load('run-p7-crash-resume');
          return decidePromise;
        }
      });

      // Wait a tick for decide to be invoked and storedAtCrash to be loaded
      for (let i = 0; i < 20 && !storedAtCrash; i++) {
        await new Promise((r) => setTimeout(r, 10));
      }

      // Verify the state that was persisted to disk before process death
      expect(storedAtCrash).toBeDefined();
      expect(storedAtCrash.waits).toHaveLength(1);
      expect(storedAtCrash.waits[0].endedAt).toBeNull();
      const oldWaitId = storedAtCrash.waits[0].waitId;

      // Clean up the running engine promise
      resolveDecide('continue');
      await runPromise;

      // 2. Revive the crash record from storage and resume in a brand new session
      const revivedRecord = CustomRunRecord.revive(storedAtCrash);
      expect(revivedRecord.waits[0].endedAt).toBeNull();

      await Engine.run({
        task: 'Task',
        steps: [{ ref: 's1', kind: 'round', input: 'none', owner: 'approve', models: [{ id: 'C1', name: 'Claude' }] }],
        sendParticipants: async () => ({ C1: { text: 'ok', status: 'SUCCESS' } }),
        resume: { ...revivedRecord.snapshot, artifacts: revivedRecord.artifacts },
        getText: (ref) => revivedRecord.texts[ref],
        checkpoint: async (state) => {
          CustomRunRecord.setSnapshot(revivedRecord, { schema: [{ ref: 's1', kind: 'round' }], state });
          await store.save(revivedRecord);
        },
        onEvent: async (kind, fields) => {
          if (kind === 'custom_wait_start') {
            CustomRunRecord.recordWaitStart(revivedRecord, fields);
            await store.save(revivedRecord);
          } else if (kind === 'custom_wait_end') {
            CustomRunRecord.recordWaitEnd(revivedRecord, fields);
            await store.save(revivedRecord);
          }
        },
        decide: async () => 'continue'
      });

      // Verify that after resume:
      // Old wait retained endedAt=null
      // New wait has resumedFrom linking to oldWaitId
      expect(revivedRecord.waits).toHaveLength(2);
      expect(revivedRecord.waits[0].waitId).toBe(oldWaitId);
      expect(revivedRecord.waits[0].endedAt).toBeNull();

      expect(revivedRecord.waits[1].resumedFrom).toBe(oldWaitId);
      expect(revivedRecord.waits[1].endedAt).toBeGreaterThanOrEqual(revivedRecord.waits[1].startedAt);
      expect(revivedRecord.waits[1].outcome).toBe('approved');
    });

    test('failure of durable checkpoint before dialog throws checkpoint_failed and prevents dialog opening', async () => {
      let decideCalled = false;
      const steps = [{ ref: 's1', kind: 'round', input: 'none', owner: 'approve', models: [{ id: 'C1', name: 'Claude' }] }];

      await expect(
        Engine.run({
          task: 'Task',
          steps,
          checkpoint: async () => {
            throw new Error('Storage write failed (quota exceeded)');
          },
          sendParticipants: async () => ({ C1: { text: 'ok', status: 'SUCCESS' } }),
          decide: async () => {
            decideCalled = true;
            return 'continue';
          }
        })
      ).rejects.toThrow();

      expect(decideCalled).toBe(false);
    });
  });
});
