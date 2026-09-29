// Automation Lab — offline model simulator implementing the transport interface.
// It answers compiled prompts exactly like a disciplined Web model would: it reads the ACTIVE
// snapshot, echoes the passport and produces stage-appropriate AL-STRUCT-1 objects. Faults can be
// injected to exercise repair, fresh attempts, failover and duplicate suppression.
(function initAlSimulator(root) {
  'use strict';

  const Canonical = root.AlCanonical || require('./al-canonical.js');

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function parsePrompt(prompt) {
    const tokens = /Line 1: PAF_RESPONSE_BEGIN (\S+) (\S+)/.exec(prompt);
    const stage = /of stage (\d+) "/.exec(prompt);
    const active = /## ACTIVE\n[^\n]*\n```json\n([^\n]+)\n```/.exec(prompt);
    return {
      callToken: tokens?.[1],
      attemptToken: tokens?.[2],
      stage: stage ? Number(stage[1]) : null,
      active: active ? JSON.parse(active[1]) : null,
      isRepair: /was rejected by the validator/.test(prompt)
    };
  }

  const ru = (active) => /[а-яё]/i.test(JSON.stringify(active?.objects?.find((o) => o.ref.code === 'IDEA')?.payload || ''));
  const byCode = (active, code) => (active?.objects || []).filter((object) => object.ref.code === code);
  const key = (ref) => `${ref.object_id}@v${ref.version}`;

  function envelope(active, stageN, outputs, changes, extra = {}) {
    const refs = active.input_refs;
    return {
      passport: { contract: 'AL-STRUCT-1', stage: stageN, input_snapshot_id: active.input_snapshot_id, input_snapshot_hash: active.input_snapshot_hash, input_refs: refs },
      outputs,
      annotations: [{ type: 'FACT' }],
      trace: outputs.map((output) => ({ output_id: output.id, source_ids: refs.map(key) })),
      input_fate: refs.map((ref) => ({ input_id: key(ref), disposition: 'CONSUMED', output_ids: outputs.map((o) => o.id) })),
      dispositions: [],
      changes,
      completion: { status: 'COMPLETE', output_ids: outputs.map((o) => o.id), output_count: outputs.length, empty_by_design: false, anomalies: [] },
      ...extra
    };
  }

  function respond(stageN, active, model) {
    const L = ru(active);
    const idea = byCode(active, 'IDEA')[0];
    const ideaRef = idea?.ref;
    const out = (text) => [{ id: 'OUT-1', type: 'ANSWER', version: 1, content: text }];
    switch (stageN) {
      case 1:
        return envelope(active, 1, out(L ? 'Пользователь, проблема и ожидаемый результат зафиксированы.' : 'User, problem and expected outcome recorded.'), [
          { op: 'CREATE', object_type: 'DPL', temp_id: 'tmp-dpl-1', source_output_id: 'OUT-1', source_refs: [ideaRef], payload: {
            profile_id: 'pilot-default',
            authority_rules: [
              { authority_class: 'A0', decision_kinds: ['structural', 'reversible'], mode: 'AUTO_POLICY', max_risk: 'LOW' },
              { authority_class: 'A1', decision_kinds: ['factual'], mode: 'REQUIRE_EVIDENCE', max_risk: 'MEDIUM', evidence_required: true },
              { authority_class: 'A2', decision_kinds: ['product_preference'], mode: 'REQUIRE_OWNER_SELECTION', max_risk: 'HIGH' },
              { authority_class: 'A3', decision_kinds: ['scope', 'business_model'], mode: 'REQUIRE_OWNER_SELECTION', max_risk: 'CRITICAL' },
              { authority_class: 'A4', decision_kinds: ['out_of_policy'], mode: 'PROHIBITED', max_risk: 'CRITICAL' }
            ],
            post_g1_autonomy: { architecture_direction_rule: 'Select by DPL criteria and evidence', risk_acceptance_rule: 'Only LOW/MEDIUM risks auto-accepted', technical_choice_rule: 'Reversible choices auto-closed' },
            scope_change_policy: 'STOP_AND_REOPEN_PRODUCT_BASELINE',
            selected_from: [ideaRef]
          } },
          { op: 'CREATE', object_type: 'UNK', temp_id: 'tmp-unk-1', source_output_id: 'OUT-1', source_refs: [ideaRef], payload: { question: L ? 'Какой сегмент пользователей приоритетен?' : 'Which user segment comes first?', impacts: [ideaRef], evidence_required: 'owner preference', route: 'QUESTIONNAIRE' } },
          { op: 'CREATE', object_type: 'ASM', temp_id: 'tmp-asm-1', source_output_id: 'OUT-1', source_refs: [ideaRef], payload: { statement: L ? 'Пользователи готовы работать через веб.' : 'Users work in a web browser.', needed_evidence: 'user interviews', relied_on_by: [{ code: 'DPL', temp_id: 'tmp-dpl-1' }] } }
        ]);
      case 2: {
        const kinds = ['SCENARIO', 'CAPABILITY', 'EDGE_CASE'];
        return envelope(active, 2, out(L ? `Независимое расширение от ${model}.` : `Independent expansion by ${model}.`), [
          ...kinds.map((kind, index) => ({ op: 'CREATE', object_type: 'PRP', temp_id: `tmp-prp-${index + 1}`, source_output_id: 'OUT-1', source_refs: [ideaRef], payload: {
            kind, statement: `${model}: ${L ? 'предложение' : 'proposal'} ${kind.toLowerCase()} #${index + 1}`, rationale: L ? 'Следует из идеи.' : 'Follows from the idea.', open_questions: index === 0 ? [L ? 'Нужен ли офлайн-режим?' : 'Is offline mode needed?'] : []
          } })),
          { op: 'CREATE', object_type: 'RSK', temp_id: 'tmp-rsk-1', source_output_id: 'OUT-1', source_refs: [ideaRef], payload: { failure_class: 'adoption', likelihood: 'MEDIUM', impact: 'HIGH', linked_to: [{ code: 'PRP', temp_id: 'tmp-prp-1' }], mitigation: L ? 'Пилот с 5 пользователями.' : 'Pilot with 5 users.' } }
        ]);
      }
      case 3: {
        const prps = byCode(active, 'PRP').filter((object) => object.status === 'PROPOSED');
        const [first, second, ...rest] = prps;
        const changes = [];
        const dispositions = [];
        const pd = (temp, sources, klass, extra = {}) => ({ op: sources.length > 1 ? 'MERGE' : 'CREATE', object_type: 'PD', temp_id: temp, source_output_id: 'OUT-1', source_refs: sources.map((o) => o.ref), payload: { question: `${L ? 'Решение по' : 'Decision on'} ${sources.map((o) => o.ref.object_id).join('+')}`, decision: extra.decision ?? null, decided_by: extra.decided_by || 'OWNER_SELECTION', affects: [ideaRef] }, state_patch: { authority_class: klass, ...(extra.status ? { status: extra.status } : {}) } });
        if (first && second) {
          changes.push(pd('tmp-pd-1', [first, second], 'A2'));
          dispositions.push({ input_ref: first.ref, action: 'MERGE', result_temp_ids: ['tmp-pd-1'], reason_code: 'SAME_CONSEQUENCE' }, { input_ref: second.ref, action: 'MERGE', result_temp_ids: ['tmp-pd-1'], reason_code: 'SAME_CONSEQUENCE' });
          changes.push({ op: 'CREATE', object_type: 'QST', temp_id: 'tmp-qst-1', source_output_id: 'OUT-1', source_refs: [], payload: {
            decision_ref: { code: 'PD', temp_id: 'tmp-pd-1' }, question: L ? 'Какой вариант выбрать для первой версии?' : 'Which option for the first release?', input_type: 'SINGLE',
            options: [
              { option_id: 'O1', label: L ? 'Минимальный сценарий' : 'Minimal scenario', semantic_value: 'MIN', effects: [{ effect_type: 'CLOSE_PD', target: 'tmp-pd-1', value: L ? 'Начать с минимального сценария' : 'Start with the minimal scenario' }] },
              { option_id: 'O2', label: L ? 'Полный сценарий' : 'Full scenario', semantic_value: 'FULL', effects: [{ effect_type: 'CLOSE_PD', target: 'tmp-pd-1', value: L ? 'Сразу полный сценарий' : 'Full scenario from day one' }] },
              { option_id: 'O3', label: L ? 'Отложить' : 'Defer', semantic_value: 'DEFER', effects: [{ effect_type: 'DEFER_PD', target: 'tmp-pd-1', value: 'deferred' }] }
            ],
            when: true, required: true, authority_class: 'A2', blocking: true, default: null
          } });
        }
        rest.forEach((prp, index) => {
          const temp = `tmp-pd-${index + 2}`;
          if (index % 3 === 2) {
            dispositions.push({ input_ref: prp.ref, action: 'REJECT', result_temp_ids: [], reason_code: 'OUT_OF_SCOPE' });
            return;
          }
          const auto = index % 3 === 0;
          changes.push(pd(temp, [prp], auto ? 'A0' : 'A1', auto ? { status: 'CLOSED', decision: L ? 'Принято по политике A0' : 'Accepted by A0 policy', decided_by: 'MODEL_POLICY' } : { decided_by: 'EVIDENCE_RULE' }));
          dispositions.push({ input_ref: prp.ref, action: 'SUPERSEDE', result_temp_ids: [temp], reason_code: 'TRANSFORMED_TO_DECISION' });
        });
        changes.push({ op: 'CREATE', object_type: 'UNK', temp_id: 'tmp-unk-1', source_output_id: 'OUT-1', source_refs: [ideaRef], payload: { question: L ? 'Какие метрики успеха?' : 'Which success metrics?', impacts: [ideaRef], evidence_required: 'owner input', route: 'QUESTIONNAIRE' } });
        const response = envelope(active, 3, out(L ? 'Предложения синтезированы в решения.' : 'Proposals synthesized into decisions.'), changes, { dispositions });
        response.input_fate = active.input_refs.map((ref) => {
          const d = dispositions.find((item) => key(item.input_ref) === key(ref));
          return { input_id: key(ref), disposition: d ? (d.action === 'REJECT' ? 'REJECTED' : 'TRANSFORMED') : 'CONSUMED', output_ids: ['OUT-1'] };
        });
        return response;
      }
      case 4:
        return envelope(active, 4, out(L ? 'Концепция продукта собрана.' : 'Product concept assembled.'), [
          { op: 'CREATE', object_type: 'PCON', temp_id: 'tmp-pcon-1', source_output_id: 'OUT-1', source_refs: active.input_refs, payload: {
            summary: L ? 'Концепция продукта по итогам решений владельца.' : 'Product concept following the owner decisions.',
            actors: [L ? 'Пользователь' : 'User'], scenarios: byCode(active, 'PD').map((o) => o.payload.decision || o.payload.question),
            scope: [L ? 'Минимальный сценарий' : 'Minimal scenario'], rules: byCode(active, 'UNK').map((o) => `OPEN: ${o.payload.question}`),
            derived_from: active.input_refs
          } }
        ]);
      case 5: {
        const pcon = byCode(active, 'PCON')[0];
        return envelope(active, 5, out(L ? `Ревью ${model}.` : `Review by ${model}.`), [
          { op: 'CREATE', object_type: 'FND', temp_id: 'tmp-fnd-1', source_output_id: 'OUT-1', source_refs: [pcon.ref], payload: { target: pcon.ref, class: 'MISSING_SCENARIO', severity: 'MEDIUM', description: `${model}: ${L ? 'не описан сценарий ошибки' : 'error scenario missing'}`, proposed_route: 'stage 6 delta decision closure', fix_refs: [] } },
          { op: 'CREATE', object_type: 'FND', temp_id: 'tmp-fnd-2', source_output_id: 'OUT-1', source_refs: [pcon.ref], payload: { target: pcon.ref, class: 'HIDDEN_ASSUMPTION', severity: 'LOW', description: `${model}: ${L ? 'скрытое допущение о доступе к сети' : 'hidden network assumption'}`, proposed_route: 'stage 6 delta decision closure', fix_refs: [] } }
        ]);
      }
      default:
        return null;
    }
  }

  function render(value, tokens, style) {
    const json = JSON.stringify(value, null, 2);
    if (style === 'rendered-code-block') return `Готово.\nPAF_RESPONSE_BEGIN ${tokens.callToken} ${tokens.attemptToken}\njson\nCopy code\n${json}\nPAF_RESPONSE_END ${tokens.callToken} ${tokens.attemptToken}`;
    return `PAF_RESPONSE_BEGIN ${tokens.callToken} ${tokens.attemptToken}\n\`\`\`json\n${json}\n\`\`\`\nPAF_RESPONSE_END ${tokens.callToken} ${tokens.attemptToken}`;
  }

  // faults: [{ model, stage, kind, times }] kinds: bad_json | wrong_hash | no_frame | semantic | timeout | duplicate
  function createSimulatorTransport({ latencyMs = 30, faults = [], styles = {} } = {}) {
    const conversations = new Map();
    const remaining = faults.map((fault) => ({ ...fault, left: fault.times ?? 1 }));
    const sent = [];
    let lastText = null;
    let cancelled = false;

    async function dispatch({ calls, freshConversation, onResult }) {
      cancelled = false;
      const results = {};
      await Promise.all(calls.map(async (call) => {
        await answerOne(call);
        onResult?.(call.model, results[call.model]);
      }));
      return results;

      async function answerOne({ model, prompt }) {
        const started = Date.now();
        sent.push({ model, freshConversation, prompt });
        const parsed = parsePrompt(prompt);
        if (freshConversation || !conversations.has(model)) conversations.set(model, parsed);
        const context = parsed.isRepair ? conversations.get(model) : parsed;
        await sleep(latencyMs);
        if (cancelled) { results[model] = { ok: false, cancelled: true, status: 'CANCELLED' }; return; }
        const fault = remaining.find((item) => item.left > 0 && (!item.model || item.model === model) && (!item.stage || item.stage === context.stage));
        if (fault) fault.left -= 1;
        if (fault?.kind === 'timeout') { results[model] = { ok: false, status: 'TIMEOUT', error: 'TIMEOUT', durationMs: Date.now() - started }; return; }
        if (fault?.kind === 'duplicate' && lastText) {
          results[model] = { ok: true, text: lastText.text, sourceMessageId: lastText.id, status: 'SUCCESS', durationMs: Date.now() - started };
          return;
        }
        const value = respond(context.stage, context.active, model);
        if (fault?.kind === 'wrong_hash') value.passport.input_snapshot_hash = 'f'.repeat(64);
        if (fault?.kind === 'semantic' && value.changes.length) value.changes = value.changes.filter((change) => change.object_type !== (context.stage === 1 ? 'DPL' : context.stage === 4 ? 'PCON' : 'QST'));
        let text = render(value, { callToken: parsed.callToken, attemptToken: parsed.attemptToken }, styles[model]);
        if (fault?.kind === 'bad_json') text = text.replace('"passport"', 'passport');
        if (fault?.kind === 'no_frame') text = JSON.stringify(value);
        const id = `sim:${model}:${Canonical.sha256Hex(text).slice(0, 16)}`;
        lastText = { text, id };
        results[model] = { ok: true, text, sourceMessageId: id, status: 'SUCCESS', durationMs: Date.now() - started };
      }
    }

    return Object.freeze({ kind: 'simulator', dispatch, cancel: async () => { cancelled = true; }, sent });
  }

  const api = Object.freeze({ createSimulatorTransport, parsePrompt, respond });
  root.AlSimulator = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
