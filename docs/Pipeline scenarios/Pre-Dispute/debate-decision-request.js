(function initDebateDecisionRequest(root) {
  'use strict';

  const VERSION = 1;
  const MODES = Object.freeze(['auto', 'assisted', 'manual']);
  const STATUSES = Object.freeze(['pending', 'resolved', 'expired']);
  const EFFECTS = Object.freeze([
    'execute_action', 'defer_action', 'reject_action', 'synthesize_now',
    'continue_one_step', 'accept_as_limitation', 'stop_run'
  ]);
  const freeze = (value) => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
  };
  const id = (prefix = 'decision') => `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;
  const normalizeOption = (option = {}, index = 0) => ({
    id: String(option.id || `option_${index + 1}`).trim(),
    label: String(option.label || option.id || `Вариант ${index + 1}`).trim(),
    description: String(option.description || '').trim(),
    effect: EFFECTS.includes(option.effect) ? option.effect : 'defer_action',
    payload: option.payload && typeof option.payload === 'object' ? { ...option.payload } : {},
    dangerous: option.dangerous === true
  });

  function validate(request = {}) {
    const errors = [];
    if (Number(request.schemaVersion) !== VERSION) errors.push('decision_schema_version_invalid');
    if (!String(request.requestId || '').trim()) errors.push('decision_request_id_missing');
    if (!String(request.question || '').trim()) errors.push('decision_question_missing');
    if (!MODES.includes(request.mode)) errors.push('decision_mode_invalid');
    if (!STATUSES.includes(request.status)) errors.push('decision_status_invalid');
    if (!Array.isArray(request.options) || request.options.length < 2 || request.options.length > 5) errors.push('decision_options_count_invalid');
    const optionIds = new Set();
    (request.options || []).forEach((option) => {
      if (!option.id || optionIds.has(option.id)) errors.push('decision_option_id_invalid');
      optionIds.add(option.id);
      if (!option.label) errors.push(`decision_option_label_missing:${option.id || 'unknown'}`);
      if (!EFFECTS.includes(option.effect)) errors.push(`decision_option_effect_invalid:${option.id || 'unknown'}`);
    });
    if (request.recommendedOptionId && !optionIds.has(request.recommendedOptionId)) errors.push('decision_recommendation_invalid');
    if (request.defaultOptionId && !optionIds.has(request.defaultOptionId)) errors.push('decision_default_invalid');
    return freeze({ ok: errors.length === 0, errors });
  }

  function create(input = {}) {
    const options = (input.options || []).map(normalizeOption);
    const request = {
      schemaVersion: VERSION,
      requestId: String(input.requestId || id('decision-request')),
      runId: String(input.runId || ''), stageId: String(input.stageId || ''),
      kind: String(input.kind || 'action_confirmation'),
      subjectId: String(input.subjectId || ''),
      question: String(input.question || 'Как продолжить?').trim(),
      reason: String(input.reason || '').trim(),
      mode: MODES.includes(input.mode) ? input.mode : 'assisted',
      options,
      recommendedOptionId: String(input.recommendedOptionId || options[0]?.id || ''),
      defaultOptionId: String(input.defaultOptionId || input.recommendedOptionId || options[0]?.id || ''),
      status: 'pending', createdAt: Number(input.createdAt || Date.now()),
      metadata: input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {}
    };
    const verdict = validate(request);
    if (!verdict.ok) throw new Error(`Invalid DecisionRequest: ${verdict.errors.join(', ')}`);
    return freeze(request);
  }

  function forTask(task = {}, context = {}) {
    const verify = ['verify_fact', 'verify_evidence'].includes(task.action);
    const options = verify ? [
      { id: 'execute', label: 'Проверить', description: 'Запустить независимую проверку.', effect: 'execute_action' },
      { id: 'limitation', label: 'Принять ограничение', description: 'Сохранить неопределённость в карте и не проверять сейчас.', effect: 'accept_as_limitation' },
      { id: 'synthesize', label: 'Перейти к итогу', description: 'Завершить исследование с явным ограничением.', effect: 'synthesize_now' }
    ] : [
      { id: 'execute', label: 'Выполнить', description: 'Разрешить предложенное действие.', effect: 'execute_action' },
      { id: 'defer', label: 'Отложить', description: 'Не выполнять действие в текущем цикле.', effect: 'defer_action' },
      { id: 'synthesize', label: 'Перейти к итогу', description: 'Завершить текущую проработку и собрать результат.', effect: 'synthesize_now' }
    ];
    return create({
      runId: context.runId, stageId: context.stageId, subjectId: task.id || task.targetId,
      kind: verify ? 'verification_choice' : 'action_confirmation',
      question: `Следующий шаг: ${task.action || task.role || 'действие'}. Что сделать?`,
      reason: task.reason, mode: context.mode || 'assisted', options,
      recommendedOptionId: 'execute', defaultOptionId: context.defaultOptionId || 'execute',
      metadata: { taskId: task.id, targetId: task.targetId, triggerId: task.triggerId }
    });
  }

  function forStagnation(context = {}) {
    return create({
      runId: context.runId, stageId: context.stageId, subjectId: context.subjectId,
      kind: 'stagnation', question: 'Нового содержательного прогресса нет. Как продолжить?',
      reason: context.reason || 'Окно прогресса не изменилось.', mode: context.mode || 'assisted',
      options: [
        { id: 'synthesize', label: 'Собрать итог', description: 'Зафиксировать достигнутое и ограничения.', effect: 'synthesize_now' },
        { id: 'continue', label: 'Ещё один шаг', description: 'Разрешить один дополнительный целевой вклад.', effect: 'continue_one_step' },
        { id: 'stop', label: 'Остановить', description: 'Остановить запуск без нового синтеза.', effect: 'stop_run', dangerous: true }
      ],
      recommendedOptionId: 'synthesize', defaultOptionId: 'synthesize', metadata: context.metadata || {}
    });
  }

  function resolve(request, optionId, actor = 'human', at = Date.now()) {
    const verdict = validate(request);
    if (!verdict.ok) throw new Error(`Invalid DecisionRequest: ${verdict.errors.join(', ')}`);
    const option = request.options.find((item) => item.id === optionId);
    if (!option) throw new Error(`Unknown decision option: ${optionId}`);
    return freeze({
      schemaVersion: VERSION, decisionId: id('decision'), requestId: request.requestId,
      runId: request.runId, stageId: request.stageId, subjectId: request.subjectId,
      kind: request.kind, optionId: option.id, label: option.label, effect: option.effect,
      payload: option.payload, actor: String(actor || 'human'), reason: request.reason,
      resolvedAt: Number(at || Date.now()), metadata: { ...request.metadata }
    });
  }

  const chooseDefault = (request, actor = 'system') => resolve(request, request.defaultOptionId || request.recommendedOptionId, actor);
  const api = Object.freeze({ VERSION, MODES, STATUSES, EFFECTS, validate, create, forTask, forStagnation, resolve, chooseDefault });
  root.DebateDecisionRequest = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
