// Typed, versioned contracts shared by every Disput topology.
(function initDebateContracts(root) {
  'use strict';

  const VERSION = 1;
  const TASK_CLASSES = Object.freeze([
    'direct_answer', 'factual', 'analysis', 'decision', 'research',
    'idea_development', 'creative', 'red_team', 'general'
  ]);
  const OPERATIONS = Object.freeze([
    'opening', 'critique', 'response', 'verification', 'resolve_contradiction',
    'examine_dissent', 'compact_context', 'final_position', 'synthesis',
    'synthesis_audit', 'state_extraction', 'round_filter', 'human_gate'
  ]);
  const EVIDENCE_POLICIES = Object.freeze(['none', 'preferred', 'required', 'external_required']);
  const text = (value) => String(value == null ? '' : value).trim();
  const list = (value) => Array.from(new Set((Array.isArray(value) ? value : []).map(text).filter(Boolean)));
  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const stable = (value) => {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
  };
  const hash = (value) => {
    const source = stable(value); let result = 2166136261;
    for (let index = 0; index < source.length; index += 1) { result ^= source.charCodeAt(index); result = Math.imul(result, 16777619); }
    return `fnv1a-${(result >>> 0).toString(16).padStart(8, '0')}`;
  };
  const freeze = (value) => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
  };

  const TASK_PATTERNS = Object.freeze([
    ['direct_answer', /^(?:\s*(?:сколько|реши|вычисли|посчитай)\b|\s*[\d\s()+\-*/^=.,]+\??\s*$)/i],
    ['research', /\b(?:исследу|research|найди источ|литератур|обзор источ|проведи поиск)\w*/i],
    ['factual', /\b(?:факт|правда ли|проверь утверж|доказательств|подтверди|источник)\w*/i],
    ['decision', /\b(?:выбери|решени|стоит ли|рекоменд|что лучше|вариант)\w*/i],
    ['red_team', /\b(?:red[ -]?team|уязвим|атак|режим отказ|failure mode|риск)\w*/i],
    ['analysis', /\b(?:анализ|сравни|оцени|разбер|объясни почему)\w*/i],
    ['idea_development', /\b(?:развить иде|доработ|продум|концепци|архитектур)\w*/i],
    ['creative', /\b(?:придумай|создай|предложи идеи|названи|сценари)\w*/i]
  ]);
  const LEGACY_CLASS = Object.freeze({ other: 'general', creative: 'creative', factual: 'factual', analysis: 'analysis', decision: 'decision', red_team: 'red_team' });
  const DEFAULT_OUTPUTS = Object.freeze({
    direct_answer: 'Короткий точный ответ с минимально необходимым пояснением.',
    factual: 'Проверяемый ответ с основаниями и явной неопределённостью.',
    analysis: 'Структурированный анализ по существенным критериям.',
    decision: 'Рекомендация, критерии выбора, компромиссы и условия пересмотра.',
    research: 'Проверяемые выводы, источники, пробелы и уровень уверенности.',
    idea_development: 'Развитая, проверяемая и практически осуществимая концепция.',
    creative: 'Сильные различимые варианты и объяснение их ценности.',
    red_team: 'Ранжированные режимы отказа, последствия и способы проверки.',
    general: 'Ясный ответ, непосредственно решающий задачу пользователя.'
  });

  function inferTaskClass(source = '', explicit = '') {
    const normalized = text(explicit).toLowerCase();
    const mapped = LEGACY_CLASS[normalized] || normalized;
    if (TASK_CLASSES.includes(mapped)) return { taskClass: mapped, confidence: 1, source: 'explicit' };
    const match = TASK_PATTERNS.find(([, pattern]) => pattern.test(text(source)));
    return match
      ? { taskClass: match[0], confidence: match[0] === 'direct_answer' ? 0.92 : 0.76, source: 'heuristic' }
      : { taskClass: 'general', confidence: 0.45, source: 'fallback' };
  }

  function createTaskContract(input = {}) {
    if (input?.contractKind === 'task' && Number(input.schemaVersion) === VERSION) return input;
    const rawRequest = text(input.rawRequest || input.moderatorMessage || input.topic || input.objective || input.problemSpec?.objective);
    const inferred = inferTaskClass(rawRequest, input.taskClass || input.taskType || input.problemSpec?.taskType);
    const maxWordsNumber = Number.parseInt(String(input.maxWords ?? input.problemSpec?.maxWords ?? ''), 10);
    const evidence = text(input.evidencePolicy || input.evidenceMode || input.problemSpec?.evidenceMode).toLowerCase();
    const task = {
      contractKind: 'task', schemaVersion: VERSION,
      taskId: text(input.taskId || input.runId || `task-${hash(rawRequest || Date.now())}`),
      rawRequest,
      objective: text(input.objective || input.problemSpec?.objective || rawRequest || 'Задача не указана'),
      currentInstruction: text(input.currentInstruction || input.moderatorInstruction),
      globalConstraints: list(input.globalConstraints || input.constraints || input.problemSpec?.constraints),
      taskClass: inferred.taskClass,
      classification: { confidence: Number(input.classificationConfidence ?? inferred.confidence), source: text(input.classificationSource || inferred.source), userOverride: inferred.source === 'explicit' },
      desiredOutput: text(input.desiredOutput || input.requiredOutput || input.problemSpec?.requiredOutput || DEFAULT_OUTPUTS[inferred.taskClass]),
      evidencePolicy: EVIDENCE_POLICIES.includes(evidence) ? evidence : (['research', 'factual'].includes(inferred.taskClass) ? 'required' : ['analysis', 'decision', 'red_team'].includes(inferred.taskClass) ? 'preferred' : 'none'),
      language: text(input.language || 'ru'),
      maxWords: Number.isFinite(maxWordsNumber) && maxWordsNumber > 0 ? maxWordsNumber : null,
      successCriteria: list(input.successCriteria).length ? list(input.successCriteria) : [DEFAULT_OUTPUTS[inferred.taskClass]],
      attachmentRefs: list(input.attachmentRefs || input.attachments?.map?.((item) => item.id || item.name)),
      profileId: text(input.profileId || input.presetId),
      createdAt: Number(input.createdAt || 0) || Date.now()
    };
    task.fingerprint = hash({ ...task, createdAt: 0, fingerprint: undefined });
    return freeze(task);
  }

  function validateTaskContract(task = {}) {
    const errors = [];
    if (task.contractKind !== 'task') errors.push('task_contract_kind_invalid');
    if (Number(task.schemaVersion) !== VERSION) errors.push('task_contract_version_invalid');
    if (!text(task.objective)) errors.push('task_objective_missing');
    if (!TASK_CLASSES.includes(task.taskClass)) errors.push(`task_class_invalid:${task.taskClass}`);
    if (!EVIDENCE_POLICIES.includes(task.evidencePolicy)) errors.push(`task_evidence_policy_invalid:${task.evidencePolicy}`);
    if (task.maxWords != null && (!Number.isFinite(Number(task.maxWords)) || Number(task.maxWords) <= 0)) errors.push('task_max_words_invalid');
    return freeze({ ok: errors.length === 0, errors });
  }
  function evolveTaskContract(task = {}, patch = {}) {
    const next = { ...clone(task), ...clone(patch) };
    delete next.contractKind; delete next.schemaVersion; delete next.fingerprint;
    return createTaskContract(next);
  }

  const ACTION_DEFINITIONS = Object.freeze({
    critique_claim: { operation: 'critique', role: 'critic', instruction: 'Проверь целевое утверждение. Найди наиболее существенную уязвимость, укажи её основание и предложи проверяемый контрпример или тест.', expectedArtifactTypes: ['objection'], independence: 'different_author_preferred' },
    resolve_blocker: { operation: 'response', role: 'defender', instruction: 'Ответь на блокирующее возражение. Либо сними его проверяемым основанием, либо сузь или пересмотри исходное утверждение.', expectedArtifactTypes: ['evidence', 'revision'], independence: 'none' },
    verify_fact: { operation: 'verification', role: 'verifier', instruction: 'Независимо проверь спорный факт. Отдели подтверждённое, опровергнутое и то, что пока нельзя установить.', expectedArtifactTypes: ['evidence', 'evidence_gap'], independence: 'different_family_required', tool: 'web_research' },
    verify_evidence: { operation: 'verification', role: 'verifier', instruction: 'Проверь качество и релевантность основания. Укажи, какой вывод оно действительно поддерживает и какие ограничения остаются.', expectedArtifactTypes: ['evidence', 'limitation'], independence: 'different_author_preferred' },
    recheck_revision: { operation: 'verification', role: 'critic', instruction: 'Повторно проверь изменённое утверждение против исходного возражения. Укажи, снята ли проблема полностью, частично или не снята.', expectedArtifactTypes: ['objection', 'revision'], independence: 'different_author_preferred' },
    resolve_contradiction: { operation: 'resolve_contradiction', role: 'arbiter', instruction: 'Разбери противоречие. Определи, является ли оно фактическим, логическим, терминологическим или ценностным, и укажи возможное разрешение.', expectedArtifactTypes: ['contradiction', 'open_question'], independence: 'different_author_preferred' },
    examine_dissent: { operation: 'examine_dissent', role: 'arbiter', instruction: 'Исследуй позицию меньшинства как самостоятельную гипотезу. Назови её сильнейшее основание и условие, при котором её следует принять или отклонить.', expectedArtifactTypes: ['dissent', 'evidence_gap'], independence: 'different_author_preferred' },
    stop_repetition: { operation: 'compact_context', role: 'moderator', instruction: 'Не повторяй прежние формулировки. Кратко зафиксируй достигнутое и назови один следующий вопрос, способный изменить состояние дела.', expectedArtifactTypes: ['open_question'], independence: 'none' },
    compact_context: { operation: 'compact_context', role: 'moderator', instruction: 'Сожми рабочее состояние без потери открытых возражений, позиций меньшинства, оснований и ограничений.', expectedArtifactTypes: ['limitation'], independence: 'none' },
    summarize_or_stop: { operation: 'synthesis', role: 'synthesizer', instruction: 'Определи, достигнут ли полезный предел обсуждения. Сохрани нерешённое и не изображай определённость там, где её нет.', expectedArtifactTypes: ['synthesis_conclusion'], independence: 'none' },
    synthesize: { operation: 'synthesis', role: 'synthesizer', instruction: 'Собери итог только из состояния дела, сохрани меньшинство, ограничения и открытые вопросы.', expectedArtifactTypes: ['synthesis_conclusion'], independence: 'none' },
    audit_synthesis: { operation: 'synthesis_audit', role: 'auditor', instruction: 'Проверь итог против карты: неподдержанные выводы, потерянное меньшинство, незакрытые blockers и ложную определённость.', expectedArtifactTypes: ['audit'], independence: 'different_family_required' }
  });

  function createActionContract(input = {}) {
    if (input?.contractKind === 'action' && Number(input.schemaVersion) === VERSION) return input;
    const actionId = text(input.action || input.actionId || input.id);
    const definition = ACTION_DEFINITIONS[actionId] || {};
    const action = {
      contractKind: 'action', schemaVersion: VERSION,
      actionId: text(input.id || input.taskId || actionId || `action-${Date.now()}`),
      actionType: actionId || text(input.actionType || 'custom'),
      operation: text(input.operation || definition.operation || 'critique'),
      role: text(input.role || definition.role || 'participant'),
      instruction: text(input.instruction || definition.instruction || input.reason || 'Внеси один новый, проверяемый вклад в решение задачи.'),
      reason: text(input.reason), targetId: text(input.targetId),
      expectedArtifactTypes: list(input.expectedArtifactTypes || definition.expectedArtifactTypes),
      independence: text(input.independence || definition.independence || 'none'),
      requiredTool: text(input.requiredTool || definition.tool),
      completion: text(input.completion || 'Ответ добавляет проверяемое изменение или обоснованно подтверждает отсутствие изменения.'),
      cost: Math.max(0, Number(input.cost ?? 1))
    };
    action.fingerprint = hash({ ...action, fingerprint: undefined });
    return freeze(action);
  }

  function createStageContract(input = {}) {
    if (input?.contractKind === 'stage' && Number(input.schemaVersion) === VERSION) return input;
    const operation = OPERATIONS.includes(text(input.operation)) ? text(input.operation) : 'opening';
    const maxWords = Number.parseInt(String(input.maxWords ?? input.outputContract?.maxWords ?? ''), 10);
    const stage = {
      contractKind: 'stage', schemaVersion: VERSION,
      stageId: text(input.stageId || `${operation}:${Date.now()}`), operation,
      role: text(input.role || 'participant'), lens: text(input.lens),
      purpose: text(input.purpose), targetId: text(input.targetId),
      inputArtifactIds: list(input.inputArtifactIds || input.inputs),
      expectedArtifactTypes: list(input.expectedArtifactTypes || input.outputs),
      contextPolicy: text(input.contextPolicy || 'relevant'),
      independence: text(input.independence || 'none'),
      service: Boolean(input.service),
      outputContract: {
        kind: text(input.outputContract?.kind || (input.service ? 'json' : 'text')),
        maxWords: Number.isFinite(maxWords) && maxWords > 0 ? maxWords : null,
        requiredSections: list(input.outputContract?.requiredSections),
        schemaId: text(input.outputContract?.schemaId),
        allowShort: input.outputContract?.allowShort === true,
        completion: text(input.outputContract?.completion)
      },
      repairPolicy: { maxAttempts: Math.max(0, Math.min(1, Number(input.repairPolicy?.maxAttempts ?? 1))) },
      failurePolicy: text(input.failurePolicy || 'continue_degraded')
    };
    stage.fingerprint = hash({ ...stage, fingerprint: undefined });
    return freeze(stage);
  }

  function validateStageContract(stage = {}) {
    const errors = [];
    if (stage.contractKind !== 'stage') errors.push('stage_contract_kind_invalid');
    if (Number(stage.schemaVersion) !== VERSION) errors.push('stage_contract_version_invalid');
    if (!text(stage.stageId)) errors.push('stage_id_missing');
    if (!OPERATIONS.includes(stage.operation)) errors.push(`stage_operation_invalid:${stage.operation}`);
    return freeze({ ok: errors.length === 0, errors });
  }

  const api = Object.freeze({
    VERSION, TASK_CLASSES, OPERATIONS, EVIDENCE_POLICIES, DEFAULT_OUTPUTS,
    ACTION_DEFINITIONS, inferTaskClass, createTaskContract, evolveTaskContract, validateTaskContract,
    createActionContract, createStageContract, validateStageContract, hash, clone
  });
  root.DebateContracts = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
