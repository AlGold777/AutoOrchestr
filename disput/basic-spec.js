// Basic spec: a readable description of a pipeline, built from its Basic schema (docs: basic-developer.md).
// Pure functions: no DOM, no chrome.*. build(schema) gives the model in three layers (whole, scheme, stages);
// toMarkdown(model) renders it. A field is { key, label, value, source }: 'schema' (taken from the schema or derived
// from it), 'author' (the author's own text of spec, title, goal, rules, quality), 'missing' (no such field, value ''),
// 'default' (the Basic default task applies; its text is not copied here).
// The stages are the steps assemble() keeps: a round with an enabled model, and every owner step.
(function initBasicSpec(root) {
  'use strict';

  const Schema = root.BasicSchema || (typeof require === 'function' ? require('./basic-schema') : null);

  // The control kinds assemble() always keeps (the same list as in basic-schema.js).
  const CONTROL_KINDS = ['owner'];
  // The steps whose answer a later step can take as input (an owner's answer is its own text).
  const ANSWER_KINDS = ['round', 'owner'];
  const KIND_LABEL = Object.freeze({ round: 'раунд', owner: 'User' });
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
    const counters = rawSteps.map((step) => { if (step.kind === 'round') rounds += 1; return { number: rounds }; });

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
      const inputSpec = step.input || (step.kind === 'round' ? (round.number === 1 ? 'none' : 'previous') : undefined);
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
      else if (entry.kind === 'round') {
        if (inputSpec !== 'none') {
          const shared = textOf(defaults.roundTask);
          task = shared ? field('task', 'Задание этапа', shared, 'schema') : field('task', 'Задание этапа', '', 'default');
        }
      }

      const owner = step.kind === 'owner' ? 'этап выполняет User' : (step.owner === 'approve' ? 'User утверждает ответ этапа' : 'не требуется');
      const result = {
        number: entry.number, ref: entry.ref, kind: entry.kind, kindLabel: KIND_LABEL[entry.kind] || String(entry.kind),
        title: entry.title, goal: entry.goal, rules: entry.rules, quality: entry.quality,
        participants: entry.participants, count: entry.count,
        input: field('input', 'Вход', input, 'schema'),
        output: field('output', 'Выход', outputText(step, entry, run), 'schema'),
        task,
        owner: field('owner', 'User', owner, 'schema')
      };
      return result;
    });

    // The whole: who decides, and the volume (the requests are at least one per participant; repeats are not counted).
    const approvals = entries.filter((entry) => entry.raw.owner === 'approve').map((entry) => entry.title.value);
    const ownerSteps = entries.filter((entry) => entry.kind === 'owner').map((entry) => entry.title.value);
    const ownerParts = [run.policy === 'auto' ? 'User решает только при проблемах' : 'User решает после каждого этапа'];
    if (approvals.length) ownerParts.push(`утверждает этапы: ${approvals.join(', ')}`);
    if (ownerSteps.length) ownerParts.push(`этапы User: ${ownerSteps.join(', ')}`);
    const requests = entries.reduce((sum, entry) => sum + entry.count, 0);
    const multi = entries.filter((entry) => entry.count > 1).map((entry) => entry.title.value);
    const volume = `этапов: ${entries.length}; участников: ${participantKeys.size}; запросов не меньше ${requests} (точное число зависит от повторов); этапы с несколькими участниками: ${multi.length ? multi.join(', ') : 'нет'}`;
    whole.push(field('ownerInvolvement', 'Участие User', ownerParts.join('; '), 'schema'), field('volume', 'Объём', volume, 'schema'));

    const filled = log.filter((item) => item.filled).length;
    return {
      name: typeof name === 'string' ? name : '',
      whole,
      scheme: {
        stages: stages.map((stage) => ({ number: stage.number, ref: stage.ref, title: stage.title.value, kindLabel: stage.kindLabel })),
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
      ['input', 'output', 'task', 'rules', 'quality', 'owner'].filter((key) => stage[key])
        .forEach((key) => lines.push(fieldLine(stage[key])));
    });
    lines.push('', '## Заполнение', '', `Заполнено полей автора: ${completeness.filled} из ${completeness.total}.`, '');
    return lines.join('\n');
  }

  const api = Object.freeze({ build, toMarkdown });
  root.BasicSpec = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
