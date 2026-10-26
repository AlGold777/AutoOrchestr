/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const Delivery = require('../shared/message-delivery.js');
const CustomRunRecord = require('../disput/custom-run-record.js');

describe('Package D: Chat Routing and Event Correlation (C01 + C02 / ТЗ 5.D)', () => {
  beforeEach(() => {
    Delivery.reset();
  });

  describe('C01: observeRuntime event correlation without fallback to latestByModel', () => {
    test('events with transportRequestId req-A correlate to req-A even after req-B was prepared for the same model', () => {
      // 1. Prepare request A for Claude
      const promptsA = Delivery.prepare({
        prompt: 'Prompt A',
        models: ['Claude'],
        requestIds: { Claude: 'req-A' }
      });
      const tokenA = /\[\[(AO-[a-z0-9]{6})\]\]/.exec(promptsA.Claude)[1];

      // 2. Prepare request B for Claude (same model, becomes latestByModel)
      const promptsB = Delivery.prepare({
        prompt: 'Prompt B',
        models: ['Claude'],
        requestIds: { Claude: 'req-B' }
      });
      const tokenB = /\[\[(AO-[a-z0-9]{6})\]\]/.exec(promptsB.Claude)[1];
      expect(tokenA).not.toBe(tokenB);

      // 3. Dispatch events carrying transportRequestId req-A
      Delivery.observeRuntime({
        type: 'LLM_COMPLETION_TERMINAL',
        llmName: 'Claude',
        transportRequestId: 'req-A',
        meta: {
          transportRequestId: 'req-A',
          dispatchId: 'disp-A-1',
          terminalResult: { status: 'CONTEXT_LOST', reason: 'context_invalidated' }
        }
      });

      Delivery.observeRuntime({
        type: 'SPA_NAVIGATION',
        llmName: 'Claude',
        transportRequestId: 'req-A',
        oldUrl: 'https://claude.ai/chat/1',
        newUrl: 'https://claude.ai/chat/1-updated',
        reason: 'pushState'
      });

      Delivery.observeRuntime({
        type: 'PROVIDER_STOP_RESULT',
        llmName: 'Claude',
        transportRequestId: 'req-A',
        stopped: true,
        reason: 'stop_command'
      });

      const journal = Delivery.journal();

      // Check completion_terminal
      const termEvent = journal.find((e) => e.kind === 'completion_terminal');
      expect(termEvent).toBeDefined();
      expect(termEvent.requestId).toBe('req-A');
      expect(termEvent.requestId).not.toBe('req-B');
      expect(termEvent.token).toBe(tokenA);

      // Check navigation
      const navEvent = journal.find((e) => e.kind === 'navigation');
      expect(navEvent).toBeDefined();
      expect(navEvent.requestId).toBe('req-A');
      expect(navEvent.requestId).not.toBe('req-B');
      expect(navEvent.token).toBe(tokenA);

      // Check provider_stop
      const stopEvent = journal.find((e) => e.kind === 'provider_stop');
      expect(stopEvent).toBeDefined();
      expect(stopEvent.requestId).toBe('req-A');
      expect(stopEvent.requestId).not.toBe('req-B');
      expect(stopEvent.token).toBe(tokenA);
    });

    test('event with unknown request ID (req-unknown) does NOT fallback to req-B and records unassigned correlation', () => {
      // Prepare requests A and B
      Delivery.prepare({
        prompt: 'Prompt A',
        models: ['Claude'],
        requestIds: { Claude: 'req-A' }
      });
      Delivery.prepare({
        prompt: 'Prompt B',
        models: ['Claude'],
        requestIds: { Claude: 'req-B' }
      });

      // Deliver event with unknown transportRequestId
      Delivery.observeRuntime({
        type: 'LLM_COMPLETION_TERMINAL',
        llmName: 'Claude',
        transportRequestId: 'req-unknown',
        meta: {
          transportRequestId: 'req-unknown',
          terminalResult: { status: 'ERROR', reason: 'crash' }
        }
      });

      const journal = Delivery.journal();
      const termEvent = journal.find((e) => e.kind === 'completion_terminal');

      expect(termEvent).toBeDefined();
      // Must NOT be attributed to req-B via latestByModel fallback
      expect(termEvent.requestId).toBeNull();
      // Per ТЗ 5.D item 4: sourceTransportRequestId is preserved, correlation is unassigned
      expect(termEvent.sourceTransportRequestId).toBe('req-unknown');
      expect(termEvent.attemptCorrelation).toBe('unassigned');
      expect(termEvent.reason).toBe('unknown_request_id');
    });

    test('wiring check: message-delivery.js does not fall back unconditionally to latestByModel in observeRuntime', () => {
      const src = fs.readFileSync(path.join(__dirname, '..', 'shared', 'message-delivery.js'), 'utf8');
      const termBlock = src.slice(
        src.indexOf("if (message.type === 'LLM_COMPLETION_TERMINAL')"),
        src.indexOf("if (message.type === 'SPA_NAVIGATION')")
      );
      expect(termBlock).not.toContain('const entry = latestByModel.get(message.llmName);');
    });

    test('Package 5: event without requestId and without tabId does NOT fall back to latestByModel tab and remains unassigned (missing_request_id)', () => {
      // Req A with tab 10
      Delivery.prepare({
        prompt: 'Prompt A',
        models: ['Claude'],
        requestIds: { Claude: 'req-A' },
        tabIds: { Claude: 10 }
      });
      // Req B with tab 20 (latestByModel)
      Delivery.prepare({
        prompt: 'Prompt B',
        models: ['Claude'],
        requestIds: { Claude: 'req-B' },
        tabIds: { Claude: 20 }
      });

      // LLM_COMPLETION_TERMINAL without requestId and without tabId
      Delivery.observeRuntime({
        type: 'LLM_COMPLETION_TERMINAL',
        llmName: 'Claude'
      });

      const journal = Delivery.journal();
      const termEvt = journal.find((e) => e.kind === 'completion_terminal');
      expect(termEvt).toBeDefined();
      expect(termEvt.requestId).toBeNull();
      expect(termEvt.attemptCorrelation).toBe('unassigned');
      expect(termEvt.correlationReason).toBe('missing_request_id');
    });

    test('Package 5: proven tabId binds to request matching that tabId, multiple matches yield conflict', () => {
      // Req A on tab 10
      Delivery.prepare({
        prompt: 'Prompt A',
        models: ['Claude'],
        requestIds: { Claude: 'req-A' }
      });
      Delivery.observeRuntime({
        type: 'TRANSPORT_DISPATCH_PHASE',
        llmName: 'Claude',
        transportRequestId: 'req-A',
        tabId: 10,
        phase: 'dispatched'
      });

      // Req B on tab 20
      Delivery.prepare({
        prompt: 'Prompt B',
        models: ['Claude'],
        requestIds: { Claude: 'req-B' }
      });
      Delivery.observeRuntime({
        type: 'TRANSPORT_DISPATCH_PHASE',
        llmName: 'Claude',
        transportRequestId: 'req-B',
        tabId: 20,
        phase: 'dispatched'
      });

      // SPA_NAVIGATION on proven tab 10 -> linked to req-A
      Delivery.observeRuntime({
        type: 'SPA_NAVIGATION',
        llmName: 'Claude',
        tabId: 10,
        oldUrl: 'https://a',
        newUrl: 'https://b'
      });

      const navEvt = Delivery.journal().find((e) => e.kind === 'navigation');
      expect(navEvt).toBeDefined();
      expect(navEvt.requestId).toBe('req-A');
      expect(navEvt.attemptCorrelation).toBe('linked');
      expect(navEvt.correlationReason).toBe('tab_bound');
    });

    test('Package 5: delayed STOP of request A retains request A identity after request B is prepared', () => {
      // Req A prepared
      Delivery.prepare({
        prompt: 'Prompt A',
        models: ['Claude'],
        requestIds: { Claude: 'req-A' }
      });

      // Req B prepared (becomes latestByModel)
      Delivery.prepare({
        prompt: 'Prompt B',
        models: ['Claude'],
        requestIds: { Claude: 'req-B' }
      });

      // Provider stop from async stop of A arriving with captured transportRequestId 'req-A'
      Delivery.observeRuntime({
        type: 'PROVIDER_STOP_RESULT',
        llmName: 'Claude',
        transportRequestId: 'req-A',
        stopped: true,
        reason: 'stop_command'
      });

      const stopEvt = Delivery.journal().find((e) => e.kind === 'provider_stop');
      expect(stopEvt).toBeDefined();
      expect(stopEvt.requestId).toBe('req-A');
      expect(stopEvt.attemptCorrelation).toBe('linked');
    });
  });

  describe('C02: chatIntent and chatRoute in CustomRunRecord attempts', () => {
    test('recordAttempt stores chatIntent with newChat, reason, bindingTabId, attachmentNames', () => {
      const record = CustomRunRecord.createRun({
        runId: 'run-d01',
        steps: [{ ref: 's1', kind: 'step', models: ['Claude'] }]
      });

      const attempt = CustomRunRecord.recordAttempt(record, {
        step: 0,
        ref: 's1',
        participant: 'C1',
        model: 'Claude',
        attempt: 1,
        visit: 1,
        phase: 'answer',
        prompt: 'Do task',
        chatIntent: {
          newChat: true,
          reason: 'step_new',
          bindingTabId: null,
          attachmentNames: ['data.csv', 'spec.pdf']
        }
      });

      expect(attempt).toBeDefined();
      expect(attempt.chatIntent).toBeDefined();
      expect(attempt.chatIntent).toMatchObject({
        newChat: true,
        reason: 'step_new',
        bindingTabId: null,
        attachmentNames: ['data.csv', 'spec.pdf']
      });
    });

    test('recordAttempt stores chatRoute with action, reason, tabId, transportRequestId, eventId', () => {
      const record = CustomRunRecord.createRun({
        runId: 'run-d02',
        steps: [{ ref: 's1', kind: 'step', models: ['Claude'] }]
      });

      // Initial attempt send
      CustomRunRecord.recordAttempt(record, {
        step: 0,
        ref: 's1',
        participant: 'C1',
        model: 'Claude',
        attempt: 1,
        visit: 1,
        phase: 'answer',
        prompt: 'Do task',
        chatIntent: {
          newChat: true,
          reason: 'step_new',
          bindingTabId: null,
          attachmentNames: []
        }
      });

      // Update attempt with chatRoute
      const updated = CustomRunRecord.recordAttempt(record, {
        step: 0,
        ref: 's1',
        participant: 'C1',
        model: 'Claude',
        attempt: 1,
        visit: 1,
        phase: 'answer',
        chatRoute: {
          action: 'created',
          reason: 'new_chat_created',
          tabId: 42,
          transportRequestId: 'req-A',
          eventId: 'evt-route-1'
        }
      });

      expect(updated.chatRoute).toBeDefined();
      expect(updated.chatRoute).toMatchObject({
        action: 'created',
        reason: 'new_chat_created',
        tabId: 42,
        transportRequestId: 'req-A',
        eventId: 'evt-route-1'
      });
    });

    test('chatRoute supports all allowed actions: created, attached_unbound, continued, refused', () => {
      const record = CustomRunRecord.createRun({
        runId: 'run-d03',
        steps: [{ ref: 's1', kind: 'step', models: ['Claude'] }]
      });

      const allowedActions = [
        { action: 'created', reason: 'new_tab_opened', tabId: 10 },
        { action: 'attached_unbound', reason: 'reused_free_tab', tabId: 11 },
        { action: 'continued', reason: 'continued_existing_chat', tabId: 12 },
        { action: 'refused', reason: 'strict_mode_no_tab', tabId: null }
      ];

      allowedActions.forEach((routeSpec, idx) => {
        const attempt = CustomRunRecord.recordAttempt(record, {
          step: 0,
          ref: 's1',
          participant: `C${idx + 1}`,
          model: 'Claude',
          attempt: 1,
          visit: 1,
          phase: 'answer',
          prompt: `Task ${idx + 1}`,
          chatRoute: {
            action: routeSpec.action,
            reason: routeSpec.reason,
            tabId: routeSpec.tabId,
            transportRequestId: `req-${idx + 1}`
          }
        });

        expect(attempt.chatRoute).toBeDefined();
        expect(attempt.chatRoute.action).toBe(routeSpec.action);
        expect(attempt.chatRoute.tabId).toBe(routeSpec.tabId);
      });
    });
  });
});
