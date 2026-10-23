// Basic spec: a readable description of a pipeline, built from its Basic schema (docs: basic-developer.md).
// Pure functions: no DOM, no chrome.*. build(schema) gives the model in three layers (whole, scheme, stages);
// toMarkdown(model) renders it. A field is { key, label, value, source }: 'schema' (taken from the schema or derived
// from it), 'author' (the author's own text of spec, title, goal, rules, quality), 'missing' (no such field, value ''),
// 'default' (the Basic default task applies; its text is not copied here).
// The stages are the steps assemble() keeps: a round or a synthesis with an enabled model, and every gate, route, owner.
(function initBasicSpec(root) {
  'use strict';

  const Schema = root.BasicSchema || (typeof require === 'function' ? require('./basic-schema') : null);

  // The control kinds assemble() always keeps (the same list as in basic-schema.js).
  const CONTROL_KINDS = ['gate', 'route', 'owner'];
  // The steps whose answer a later step can take as input (an owner's answer is its own text).
  const ANSWER_KINDS = ['round', 'synthesis', 'owner'];
  const KIND_LABEL = Object.freeze({ round: 'раунд', synthesis: 'синтез', gate: 'проверка', route: 'маршрут', owner: 'владелец' });
  const CONFLICT_TEXT = Object.freeze({ stop: 'остановка', first: 'берётся первый подходящий', owner: 'решает владелец' });
  const SPEC_FIELDS = Object.freeze([
    ['purpose', 'Назначение'], ['inputs', 'Исходные данные'], ['result', 'Итоговый результат'], ['application', 'Применение результата'],
    ['readiness', 'Критерии готовности'], ['rules', 'Общие правила и ограничения'], ['boundaries', 'Границы'], ['failure', 'Поведение при сбое']
  ]);

  const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  // An author's text: a non-blank string as it was written, otherwise ''.
  const textOf = (value) => (typeof value === 'string' && value.trim() ? value : '');
  const field = (key, label, value, source) => ({ key, label, value, source });
  const enabledModels = (step) => (Array.isArray(step.models) ? step.models.filter((model) => isObject(model) && model.enabled !== false) : []);
  // A participant's id: the explicit one, or its name (as in basic-schema.js).
  const idOf = (model) => model.id ?? model.name;
  const refOf = (step) => (typeof step.ref === 'string' ? step.ref : '');

  // An author's field, and its record for the completeness count.
  function authorField(log, path, key, label, raw) {
    const value = textOf(raw);
    log.push({ path, filled: Boolean(value) });
    return field(key, label, value, value ? 'author' : 'missing');
  }

  // The automatic name of a stage that has no title of its own.
  function autoTitle(step, round) {
    const ref = refOf(step);
    if (step.kind === 'round') return `Раунд ${round.number}`;
    if (step.kind === 'synthesis') return ref === 'final' ? 'Итоговый синтез' : `Синтез после раунда ${round.after}`;
    if (CONTROL_KINDS.includes(step.kind)) return `${KIND_LABEL[step.kind][0].toUpperCase()}${KIND_LABEL[step.kind].slice(1)} ${ref.slice(ref.indexOf(':') + 1)}`;
    return ref;
  }

  function participantOf(model, run) {
    const out = {
      name: typeof model.name === 'string' ? model.name : '',
      role: typeof model.role === 'string' ? model.role : '',
      id: typeof model.id === 'string' ? model.id : '',
      words: Number.isSafeInteger(model.maxWords) ? model.maxWords : run.maxWords
    };
    if (textOf(model.task)) out.task = model.task;
    if (isObject(model.output)) out.ownOutput = textOf(model.output.name);
    return out;
  }

  // The order of the answers: a round with several participants (parallel by default), a control step as the schema has it.
  function orderText(step, count) {
    if (count === 0) return 'не применяется';
    if (count === 1) return 'один участник';
    if (step.kind === 'round') return step.order === 'sequential' ? 'по очереди' : 'параллельно; мнения участников независимы';
    return 'порядок в схеме не задан';
  }

  function outputText(step, entry, run) {
    const out = isObject(step.output) ? step.output : null;
    const pieces = [];
    if (!out) pieces.push('ответ в свободной форме (выход не задан)');
    else {
      if (textOf(out.name)) pieces.push(`название: ${out.name}`);
      if (textOf(out.form)) pieces.push(`форма: ${out.form}`);
      if (Array.isArray(out.sections)) pieces.push(`разделы: ${out.sections.join(', ')}`);
      if (out.format === 'json') pieces.push('формат: json');
      if (Array.isArray(out.requiredFields)) pieces.push(`обязательные поля: ${out.requiredFields.join(', ')}`);
      if (Array.isArray(out.artifacts)) pieces.push(`артефакты: ${out.artifacts.map((item) => (isObject(item) ? item.name : '')).filter(Boolean).join(', ')}`);
    }
    if (entry.count) {
      const limits = [...new Set(entry.participants.map((item) => item.words))];
      pieces.push(limits.length === 1 ? `предел слов: ${limits[0]}`
        : `предел слов: ${entry.participants.map((item) => `${item.name} — ${item.words}`).join(', ')}`);
      const strict = out && typeof out.strictLength === 'boolean' ? out.strictLength : run.strictLength;
      pieces.push(`строгая длина: ${strict ? 'да' : 'нет'}`);
      entry.participants.filter((item) => item.ownOutput !== undefined)
        .forEach((item) => pieces.push(`у участника ${item.name} свой выход: ${item.ownOutput || 'без названия'}`));
    }
    return pieces.join('; ');
  }

  // One transition of a gate or a route, as text. titleOf turns a ref into the title of its stage.
  function actionText(action, titleOf) {
    if (!isObject(action)) return 'переход не задан';
    if ('stop' in action) return `остановка: ${action.stop}`;
    if ('goto' in action) return `переход к ${titleOf(action.goto)}`;
    return 'переход не задан';
  }

  // The transitions of a gate or a route. A rule's conditions are not described: they stay in the schema.
  function transitionsOf(step, titleOf) {
    if (step.kind === 'gate') {
      const pass = step.pass ?? Schema.DEFAULTS.gate.pass;
      const onFail = step.onFail ?? Schema.DEFAULTS.gate.onFail;
      return [
        `проверяющие: ${pass === 'any' ? 'достаточно одного прошедшего' : 'нужны все прошедшие'}`,
        `при прохождении: ${'onPass' in step ? actionText(step.onPass, titleOf) : 'дальше по порядку'}`,
        `при провале: ${isObject(onFail) ? actionText(onFail, titleOf) : (onFail === 'ask' ? 'спросить владельца' : 'остановка')}`
      ];
    }
    if (step.kind !== 'route' || !isObject(step.select)) return [];
    const select = step.select;
    const lines = [];
    if (select.by === 'model') lines.push(`выбирает модель «${enabledModels(step)[0]?.name ?? ''}»`);
    else if (select.by === 'owner') lines.push('выбирает владелец');
    else lines.push(`выбирает по правилу; при нескольких подходящих: ${CONFLICT_TEXT[select.conflict ?? Schema.DEFAULTS.route.conflict] || ''}`);
    (Array.isArray(select.cases) ? select.cases : []).filter(isObject).forEach((item) => {
      lines.push(`вариант «${textOf(item.label) || item.id}»: ${actionText(item.action, titleOf)}`);
    });
    if ('otherwise' in select) lines.push(`иначе: ${actionText(select.otherwise, titleOf)}`);
    return lines;
  }

  // The schema as a description: { whole, scheme, stages, completeness } (fields are { key, label, value, source }).
  function build(schema, { name = '' } = {}) {
    const source = isObject(schema) ? schema : {};
    const run = Schema.resolveRun(source);
    const defaults = isObject(source.defaults) ? source.defaults : {};
    const log = [];
    const spec = isObject(source.spec) ? source.spec : {};
    const whole = SPEC_FIELDS.map(([key, label]) => authorField(log, `spec.${key}`, key, label, spec[key]));
    const rawSteps = Array.isArray(source.steps) ? source.steps.filter(isObject) : [];
    let rounds = 0;
    const counters = rawSteps.map((step) => { if (step.kind === 'round') rounds += 1; return { number: rounds, after: rounds }; });

    // Pass 1: the stages, with their participants and titles.
    const entries = [];
    const participantKeys = new Set();
    rawSteps.forEach((step, at) => {
      const enabled = enabledModels(step);
      if (!CONTROL_KINDS.includes(step.kind) && !enabled.length) return;
      const ref = refOf(step);
      const title = textOf(step.title);
      log.push({ path: `${ref}.title`, filled: Boolean(title) });
      enabled.forEach((model) => participantKeys.add(idOf(model)));
      entries.push({
        raw: step, at, number: entries.length + 1, ref, kind: step.kind,
        title: field('title', 'Название', title || autoTitle(step, counters[at]), title ? 'author' : 'schema'),
        goal: authorField(log, `${ref}.goal`, 'goal', 'Цель', step.goal),
        rules: authorField(log, `${ref}.rules`, 'rules', 'Правила', step.rules),
        quality: authorField(log, `${ref}.quality`, 'quality', 'Качество', step.quality),
        participants: enabled.map((model) => participantOf(model, run)),
        count: enabled.length
      });
    });
    const byRef = new Map();
    entries.forEach((entry) => { if (!byRef.has(entry.ref)) byRef.set(entry.ref, entry); });
    const titleOf = (ref) => {
      const entry = byRef.get(ref);
      return entry ? `«${entry.title.value}»` : `«${ref}» (этап выключен)`;
    };
    const labelOf = (entry, participant) => {
      const model = participant === undefined ? null : (entry.raw.models || []).find((item) => isObject(item) && idOf(item) === participant);
      const out = model && isObject(model.output) ? model.output : entry.raw.output;
      return textOf(isObject(out) ? out.name : '') || `ответы этапа «${entry.title.value}»`;
    };
    const describe = (link) => {
      if (!link.entry) return `выключенный этап «${link.ref}»`;
      let text = `«${link.entry.title.value}»`;
      if (link.participant !== undefined) text += ` (участник ${link.participant})`;
      if (link.artifact !== undefined) text += ` (артефакт ${link.artifact})`;
      return text;
    };

    // Pass 2: the input of each stage (its links), the output, the task and the owner's part.
    const links = [];
    const stages = entries.map((entry, index) => {
      const step = entry.raw;
      const round = counters[entry.at];
      const inputSpec = step.input || (step.kind === 'round' ? (round.number === 1 ? 'none' : 'previous') : (step.kind === 'synthesis' ? 'previous' : undefined));
      const sourcesOf = () => {
        if (inputSpec === undefined || inputSpec === 'none') return [];
        if (inputSpec === 'previous') {
          for (let at = index - 1; at >= 0; at -= 1) if (ANSWER_KINDS.includes(entries[at].kind)) return [{ entry: entries[at] }];
          return [];
        }
        if (inputSpec === 'all') return entries.slice(0, index).filter((item) => ANSWER_KINDS.includes(item.kind)).map((item) => ({ entry: item }));
        if (!Array.isArray(inputSpec)) return [];
        return inputSpec.map((item) => {
          if (typeof item === 'string') return { ref: item, entry: byRef.get(item) };
          if (!isObject(item)) return null;
          const artifact = 'artifact' in item;
          const address = artifact ? (isObject(item.artifact) ? item.artifact : {}) : item;
          return {
            ref: address.step, entry: byRef.get(address.step),
            ...('participant' in address ? { participant: address.participant } : {}),
            ...(artifact && 'id' in address ? { artifact: address.id } : {})
          };
        }).filter(Boolean);
      };
      const found = sourcesOf();
      found.forEach((link) => {
        if (link.entry) links.push({ from: link.entry.number, to: entry.number, label: labelOf(link.entry, link.participant), ...(link.participant !== undefined ? { participant: link.participant } : {}) });
      });
      let input = 'нет: этап получает только задание';
      if (found.length) input = `ответы: ${found.map(describe).join(', ')}`;
      else if (inputSpec !== undefined && inputSpec !== 'none') input = 'нет ответов предыдущих этапов';

      // The Basic task is sent only when the stage has input: with input none nothing is sent without the owner's text.
      let task = field('task', 'Задание этапа', '', 'missing');
      if (textOf(step.task)) task = field('task', 'Задание этапа', step.task, 'schema');
      else if (entry.kind === 'round' || entry.kind === 'synthesis') {
        if (inputSpec !== 'none') {
          const shared = textOf(defaults[entry.kind === 'round' ? 'roundTask' : 'synthesisTask']);
          task = shared ? field('task', 'Задание этапа', shared, 'schema') : field('task', 'Задание этапа', '', 'default');
        }
      }

      const owner = step.kind === 'owner' ? 'этап выполняет владелец' : (step.owner === 'approve' ? 'владелец утверждает ответ этапа' : 'не требуется');
      const result = {
        number: entry.number, ref: entry.ref, kind: entry.kind, kindLabel: KIND_LABEL[entry.kind] || String(entry.kind),
        title: entry.title, goal: entry.goal, rules: entry.rules, quality: entry.quality,
        participants: entry.participants, count: entry.count,
        order: field('order', 'Порядок', orderText(step, entry.count), 'schema'),
        input: field('input', 'Вход', input, 'schema'),
        output: field('output', 'Выход', outputText(step, entry, run), 'schema'),
        task,
        owner: field('owner', 'Владелец', owner, 'schema'),
        transitions: transitionsOf(step, titleOf)
      };
      if (entry.kind === 'gate') result.criteria = field('criteria', 'Критерии', Array.isArray(step.criteria) ? step.criteria.filter(textOf).join('; ') : '', Array.isArray(step.criteria) ? 'schema' : 'missing');
      return result;
    });

    // The whole: who decides, and the volume (the requests are at least one per participant; repeats are not counted).
    const approvals = entries.filter((entry) => entry.raw.owner === 'approve').map((entry) => entry.title.value);
    const ownerSteps = entries.filter((entry) => entry.kind === 'owner').map((entry) => entry.title.value);
    const ownerParts = [run.policy === 'auto' ? 'владелец решает только при проблемах' : 'владелец решает после каждого этапа'];
    if (approvals.length) ownerParts.push(`утверждает этапы: ${approvals.join(', ')}`);
    if (ownerSteps.length) ownerParts.push(`этапы владельца: ${ownerSteps.join(', ')}`);
    const requests = entries.reduce((sum, entry) => sum + entry.count, 0);
    const multi = entries.filter((entry) => entry.count > 1).map((entry) => entry.title.value);
    const volume = `этапов: ${entries.length}; участников: ${participantKeys.size}; запросов не меньше ${requests} (точное число зависит от повторов и переходов); этапы с несколькими участниками: ${multi.length ? multi.join(', ') : 'нет'}`;
    whole.push(field('ownerInvolvement', 'Участие владельца', ownerParts.join('; '), 'schema'), field('volume', 'Объём', volume, 'schema'));

    const filled = log.filter((item) => item.filled).length;
    return {
      name: typeof name === 'string' ? name : '',
      whole,
      scheme: {
        stages: stages.map((stage) => ({ number: stage.number, ref: stage.ref, title: stage.title.value, kindLabel: stage.kindLabel, transitions: stage.transitions })),
        links
      },
      stages,
      completeness: { filled, total: log.length, missing: log.filter((item) => !item.filled).map((item) => item.path) }
    };
  }

  // A field as a list item: its value, or the mark of a missing field or of the Basic default.
  function fieldLine(item) {
    const value = typeof item.value === 'string' ? item.value.replace(/\s*\n\s*/g, ' ').trim() : '';
    let text = value || '_не заполнено_';
    if (!value && item.source === 'default') text = '_умолчание Basic_';
    return `- **${item.label}:** ${text}`;
  }

  // The model as Markdown: the title, the three layers, the fields.
  function toMarkdown(model) {
    const data = isObject(model) ? model : {};
    const whole = Array.isArray(data.whole) ? data.whole : [];
    const stages = Array.isArray(data.stages) ? data.stages : [];
    const scheme = isObject(data.scheme) ? data.scheme : { stages: [], links: [] };
    const completeness = isObject(data.completeness) ? data.completeness : { filled: 0, total: 0 };
    const lines = [`# Спецификация pipeline${data.name ? ` «${data.name}»` : ''}`, '', '## Pipeline в целом', ''];
    whole.forEach((item) => lines.push(fieldLine(item)));
    lines.push('', '## Схема процесса', '');
    if (!scheme.stages.length) lines.push('_Этапов нет._');
    scheme.stages.forEach((item) => {
      lines.push(`${item.number}. **${item.title}** (\`${item.ref}\`) — ${item.kindLabel}`);
      item.transitions.forEach((text) => lines.push(`   - ${text}`));
    });
    if (scheme.links.length) {
      const titleOfNumber = (number) => (scheme.stages.find((item) => item.number === number) || { title: '—' }).title;
      lines.push('', '**Связи:**', '');
      scheme.links.forEach((link) => {
        const who = link.participant !== undefined ? ` (участник ${link.participant})` : '';
        lines.push(`- ${titleOfNumber(link.from)} → ${titleOfNumber(link.to)}: ${link.label}${who}`);
      });
    }
    stages.forEach((stage) => {
      lines.push('', `## ${stage.number}. ${stage.title.value}`, '', `- **Вид:** ${stage.kindLabel} (\`${stage.ref}\`)`);
      lines.push(fieldLine(stage.goal));
      const people = stage.participants.map((item) => [item.name, item.role && `роль: ${item.role}`, item.id && `id: ${item.id}`,
        item.task && `задание участника: ${item.task}`].filter(Boolean).join(', '));
      lines.push(`- **Участники (${stage.count}):** ${people.length ? people.join('; ') : '_нет_'}`);
      ['order', 'input', 'output', 'task', 'rules', 'quality', 'owner', 'criteria'].filter((key) => stage[key])
        .forEach((key) => lines.push(fieldLine(stage[key])));
    });
    lines.push('', '## Заполнение', '', `Заполнено полей автора: ${completeness.filled} из ${completeness.total}.`, '');
    return lines.join('\n');
  }

  const api = Object.freeze({ build, toMarkdown });
  root.BasicSpec = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
