// Обмен схемами между стендом ({ task, steps: [{ id, block, … }] }) и Basic ({ schemaVersion, origin, steps: [{ ref, kind, models }] }).
// toBasic — экспорт со стенда: файл, который принимает кнопка Import в Basic. fromBasic — импорт файла Basic на стенд.
// Переносятся round, synthesis, gate, owner, defaults, run, description. Остальные блоки пропускаются с предупреждением.
// Повтор шага (repeats) в Basic — переход проверки назад (onFail.goto с maxLoops), поэтому повторные шаги не переносятся.
(function initBasicExport(root) {
  'use strict';

  const own = (v) => typeof v === 'string' && v.trim() !== '';
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const list = (v) => (Array.isArray(v) ? v : []);
  const idPart = (id, fallback) => (String(id || '').replace(/[^A-Za-z0-9_-]/g, '') || fallback);
  const RUN_WORDS = [300, 500, 700, 1000];
  const MODEL_COPY = ['maxWords', 'request', 'discipline'];

  // Ссылка входа стенда ("s2" или "s3.Артефакт") → id этапа.
  const stepOf = (ref) => String(ref).split('.')[0];

  function toBasic(schema, opts = {}) {
    const roleIdOf = opts.roleIdOf || (() => '');
    const warnings = [];
    const steps = list(schema?.steps).filter(isObj);
    const pos = new Map(steps.map((st, i) => [st.id, i]));
    const repeatOf = (st) => (own(st.repeats) && pos.has(st.repeats) && pos.get(st.repeats) < pos.get(st.id) ? st.repeats : '');
    const kept = steps.filter((st) => !repeatOf(st));
    const lastSynth = kept.map((st) => st.block).lastIndexOf('synthesis');
    const finalStep = lastSynth >= 0 && !kept.slice(lastSynth + 1).some((st) => st.block === 'round') ? kept[lastSynth] : null;

    // Первый проход: ref каждого переносимого шага.
    const refs = new Map();
    let rounds = 0;
    steps.forEach((st, i) => {
      if (repeatOf(st)) return;
      if (st.block === 'round') refs.set(st.id, `r${++rounds}`);
      else if (st.block === 'synthesis') refs.set(st.id, st === finalStep ? 'final' : `synth:${idPart(st.id, `s${i + 1}`)}`);
      else if (st.block === 'gate') refs.set(st.id, `gate:${idPart(st.id, `s${i + 1}`)}`);
      else if (st.block === 'owner') refs.set(st.id, `owner:${idPart(st.id, `s${i + 1}`)}`);
    });
    const inputRefs = (st) => [...new Set(list(st.inputs).map(stepOf).filter((id) => refs.has(id) && pos.get(id) < pos.get(st.id)).map((id) => refs.get(id)).filter((ref) => ref !== 'final'))];

    const modelOf = (m) => {
      const roleId = roleIdOf(m.role);
      const roleLine = own(m.role) && !roleId ? `Роль: ${m.role.trim()}.` : '';
      const task = [roleLine, own(m.task) ? m.task.trim() : ''].filter(Boolean).join('\n\n');
      const out = { name: String(m.name) };
      if (roleId && roleId !== 'None') out.role = roleId;
      if (task) out.task = task;
      MODEL_COPY.forEach((k) => { if (m[k] !== undefined && m[k] !== '') out[k] = m[k]; });
      return out;
    };
    const firstModel = (before) => {
      for (let i = before - 1; i >= 0; i -= 1) {
        const st = steps[i];
        const name = st.block === 'synthesis' ? st.model : list(st.models)[0]?.name;
        if (own(name)) return name;
      }
      return list(steps.find((st) => st.block === 'round')?.models)[0]?.name || 'Claude';
    };

    const out = [];
    steps.forEach((st, i) => {
      if (repeatOf(st)) return;
      const ref = refs.get(st.id);
      if (!ref) { warnings.push(`Этап ${st.id || i + 1} (${st.block}) не перенесён: в Basic такого блока нет.`); return; }
      const input = inputRefs(st);
      const step = { ref, kind: st.block };
      if (st.block === 'round') {
        step.order = st.order === 'sequential' ? 'sequential' : 'parallel';
        step.input = input.length ? input : 'none';
        if (own(st.task)) step.task = st.task.trim();
        step.models = list(st.models).filter((m) => isObj(m) && own(m.name)).map(modelOf);
      } else if (st.block === 'synthesis') {
        step.input = input.length ? input : 'previous';
        const roleLine = own(st.role) ? `Роль: ${st.role.trim()}.` : '';
        const task = [roleLine, own(st.task) ? st.task.trim() : ''].filter(Boolean).join('\n\n');
        if (task) step.task = task;
        step.models = [modelOf({ name: own(st.model) ? st.model : firstModel(i), maxWords: st.maxWords, request: st.request, discipline: st.discipline })];
      } else if (st.block === 'gate') {
        step.input = input.length ? input : 'previous';
        step.criteria = own(st.criteria) ? [st.criteria.trim()] : ['Ответ полный и без противоречий'];
        step.models = [{ name: firstModel(i) }];
        // Повторные шаги и повторная проверка — это возврат назад: первая проверка отправляет к самому раннему повторённому шагу.
        const targets = steps.filter((o) => repeatOf(o) && o.block !== 'gate' && String(o.because || '').includes(st.id)).map((o) => repeatOf(o)).filter((id) => refs.has(id));
        if (targets.length) {
          const first = targets.sort((a, b) => pos.get(a) - pos.get(b))[0];
          step.onFail = { goto: refs.get(first), maxLoops: 3 };
        }
      } else if (st.block === 'owner') {
        step.task = own(st.ask) ? st.ask.trim() : 'Дайте ответ';
        step.models = [];
        if (input.length) step.input = input;
      }
      if (own(st.title)) step.title = st.title.trim();
      if (own(st.why)) step.goal = st.why.trim();
      out.push(step);
    });
    // В Basic финальный синтез — последний шаг: проверки и вопросы после него встают перед ним и читают то, что читает синтез.
    const finalAt = out.findIndex((st) => st.ref === 'final');
    if (finalAt >= 0 && finalAt < out.length - 1) {
      const final = out[finalAt];
      const trailing = out.splice(finalAt + 1);
      trailing.forEach((st) => {
        if (st.kind === 'gate' && st.input === 'previous') st.input = final.input;
        warnings.push(`Шаг ${st.ref} стоял после финального синтеза: в Basic он перенесён перед ним.`);
      });
      out.splice(finalAt, 0, ...trailing);
    }
    steps.filter((st) => repeatOf(st)).forEach((st) => { if (st.block === 'gate' && !steps.some((o) => o.block === 'gate' && o.id === st.repeats)) warnings.push(`Повторная проверка ${st.id} без первой проверки пропущена.`); });

    const result = { schemaVersion: 1, origin: 'user' };
    if (own(schema.description)) result.description = schema.description;
    const d = schema.defaults;
    if (isObj(d)) {
      const defaults = {};
      ['roundTask', 'synthesisTask'].forEach((k) => { if (typeof d[k] === 'string') defaults[k] = d[k]; });
      if (isObj(d.discipline)) defaults.discipline = d.discipline;
      if (isObj(d.modelNotes)) defaults.modelNotes = d.modelNotes;
      if (Object.keys(defaults).length) result.defaults = defaults;
    }
    if (isObj(schema.run)) {
      const run = {};
      if (['auto', 'manual'].includes(schema.run.policy)) run.policy = schema.run.policy;
      if (RUN_WORDS.includes(schema.run.maxWords)) run.maxWords = schema.run.maxWords;
      if (Object.keys(run).length) result.run = run;
    }
    result.steps = out;
    if (!out.some((st) => st.kind === 'round' || st.kind === 'gate' || st.kind === 'owner')) warnings.push('Нечего экспортировать: в схеме нет раунда, проверки или владельца.');
    return { schema: result, warnings };
  }

  function fromBasic(basic, opts = {}) {
    const warnings = [];
    const steps = list(basic?.steps).filter(isObj);
    const ids = new Map(steps.map((st, i) => [st.ref, `s${i + 1}`]));
    const refList = (input) => (Array.isArray(input) ? [...new Set(input.map((x) => (typeof x === 'string' ? x : x?.step)).map((r) => ids.get(r)).filter(Boolean))] : []);
    const out = [];
    steps.forEach((st, i) => {
      const id = ids.get(st.ref);
      const step = { id, block: st.kind, title: own(st.title) ? st.title : String(st.ref), why: own(st.goal) ? st.goal : 'Из схемы Basic' };
      const inputs = refList(st.input);
      if (inputs.length) step.inputs = inputs;
      if (st.kind === 'round') {
        step.order = st.order === 'sequential' ? 'sequential' : 'parallel';
        if (own(st.task)) step.task = st.task;
        step.models = list(st.models).filter((m) => isObj(m) && own(m.name)).map((m) => {
          const model = { name: m.name };
          if (own(m.role) && m.role !== 'None') model.role = m.role;
          if (own(m.task)) model.task = m.task;
          MODEL_COPY.forEach((k) => { if (m[k] !== undefined && m[k] !== '') model[k] = m[k]; });
          return model;
        });
      } else if (st.kind === 'synthesis') {
        const m = list(st.models).find((x) => isObj(x) && own(x.name));
        if (m) step.model = m.name;
        if (m && own(m.role) && m.role !== 'None') step.role = m.role;
        if (own(st.task)) step.task = st.task;
      } else if (st.kind === 'gate') {
        step.criteria = list(st.criteria).filter(own).join('; ') || 'Ответ полный';
        if (st.onFail?.goto) warnings.push(`Возврат проверки ${st.ref} на ${st.onFail.goto} не перенесён: на стенде он записывается повторными этапами.`);
      } else if (st.kind === 'owner') {
        step.ask = own(st.task) ? st.task : 'Дайте ответ';
      } else {
        warnings.push(`Шаг ${st.ref} (${st.kind}) не перенесён на стенд.`);
        return;
      }
      out.push(step);
    });
    const schema = { task: own(opts.name) ? opts.name : (own(basic?.description) ? basic.description.trim().slice(0, 60) : 'Схема Basic') };
    if (own(basic?.description)) schema.description = basic.description;
    if (isObj(basic?.defaults)) schema.defaults = JSON.parse(JSON.stringify(basic.defaults));
    if (isObj(basic?.run)) schema.run = JSON.parse(JSON.stringify(basic.run));
    schema.steps = out;
    return { schema, warnings };
  }

  const api = { toBasic, fromBasic };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ProtoBasicExport = api;
}(typeof window !== 'undefined' ? window : globalThis));
