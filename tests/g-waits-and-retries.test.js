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
});
