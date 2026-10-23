// Обмен схемами между стендом ({ task, steps: [{ id, block, … }] }) и Basic ({ schemaVersion, origin, steps: [{ ref, kind, models }] }).
// toBasic — экспорт со стенда: файл, который принимает кнопка Import в Basic. fromBasic — импорт файла Basic на стенд.
// Переносятся round, owner, defaults (roundTask, discipline, modelNotes), run, description. Остальные этапы (file), исходные
// артефакты и defaults.synthesisTask пропускаются с предупреждением: синтеза в Basic нет, это роль раунда из одной модели.
// Проверки на стенде нет: шаг gate из старого файла Basic приходит на стенд обычным раундом, шаг synthesis — раундом из одной модели.
(function initBasicExport(root) {
  'use strict';

  const own = (v) => typeof v === 'string' && v.trim() !== '';
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const list = (v) => (Array.isArray(v) ? v : []);
  const idPart = (id, fallback) => (String(id || '').replace(/[^A-Za-z0-9_-]/g, '') || fallback);
  const RUN_WORDS = [300, 500, 700, 1000];
  const MODEL_COPY = ['maxWords', 'discipline'];

  // Ссылка входа стенда ("s2" или "s3.Артефакт") → id этапа.
  const stepOf = (ref) => String(ref).split('.')[0];

  function toBasic(schema, opts = {}) {
    const roleIdOf = opts.roleIdOf || (() => '');
    const warnings = [];
    const steps = list(schema?.steps).filter(isObj);
    const pos = new Map(steps.map((st, i) => [st.id, i]));

    // Первый проход: ref каждого переносимого шага.
    const refs = new Map();
    let rounds = 0;
    steps.forEach((st, i) => {
      if (st.block === 'round') refs.set(st.id, `r${++rounds}`);
      else if (st.block === 'owner') refs.set(st.id, `owner:${idPart(st.id, `s${i + 1}`)}`);
    });
    const inputRefs = (st) => [...new Set(list(st.inputs).map(stepOf).filter((id) => refs.has(id) && pos.get(id) < pos.get(st.id)).map((id) => refs.get(id)))];

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
    const out = [];
    steps.forEach((st, i) => {
      const ref = refs.get(st.id);
      if (!ref) { warnings.push(`Этап ${st.id || i + 1} (${st.block}) не перенесён: в Basic такого блока нет.`); return; }
      const input = inputRefs(st);
      const step = { ref, kind: st.block };
      if (st.block === 'round') {
        step.input = input.length ? input : 'none';
        if (own(st.task)) step.task = st.task.trim();
        step.models = list(st.models).filter((m) => isObj(m) && own(m.name)).map(modelOf);
      } else if (st.block === 'owner') {
        step.task = own(st.ask) ? st.ask.trim() : 'Дайте ответ';
        step.models = [];
        if (input.length) step.input = input;
      }
      if (own(st.title)) step.title = st.title.trim();
      if (own(st.why)) step.goal = st.why.trim();
      out.push(step);
    });
    list(schema?.artifacts).filter(isObj).forEach((a) => warnings.push(`Исходный артефакт «${a.name}» не перенесён: в Basic исходных артефактов нет.`));

    const result = { schemaVersion: 1, origin: 'user' };
    if (own(schema.description)) result.description = schema.description;
    const d = schema.defaults;
    if (isObj(d)) {
      const defaults = {};
      if (typeof d.roundTask === 'string') defaults.roundTask = d.roundTask;
      if (own(d.synthesisTask)) warnings.push('Задание синтеза (defaults.synthesisTask) не перенесено: в Basic синтез — раунд из одной модели с ролью, задание пишется в task этого раунда.');
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
    if (!out.some((st) => st.kind === 'round' || st.kind === 'owner')) warnings.push('Нечего экспортировать: в схеме нет раунда или этапа User.');
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
      if (st.kind === 'round' || st.kind === 'gate') {
        if (st.kind === 'gate') {
          step.block = 'round';
          step.task = [`Критерии проверки: ${list(st.criteria).filter(own).join('; ') || 'ответ полный'}`, own(st.task) ? st.task : ''].filter(Boolean).join('\n\n');
          warnings.push('Проверка Basic импортирована как обычный этап: ветвление по вердикту не перенесено.');
        } else if (own(st.task)) step.task = st.task;
        step.models = list(st.models).filter((m) => isObj(m) && own(m.name)).map((m) => {
          const model = { name: m.name };
          if (own(m.role) && m.role !== 'None') model.role = m.role;
          if (own(m.task)) model.task = m.task;
          MODEL_COPY.forEach((k) => { if (m[k] !== undefined && m[k] !== '') model[k] = m[k]; });
          return model;
        });
      } else if (st.kind === 'synthesis') {
        const m = list(st.models).find((x) => isObj(x) && own(x.name));
        step.block = 'round';
        if (own(st.task)) step.task = st.task;
        const model = { name: m ? m.name : 'Claude', role: m && own(m.role) && m.role !== 'None' ? m.role : 'свести' };
        if (m && own(m.task)) model.task = m.task;
        MODEL_COPY.forEach((k) => { if (m && m[k] !== undefined && m[k] !== '') model[k] = m[k]; });
        step.models = [model];
        warnings.push('Синтез Basic импортирован как раунд из одной модели с ролью.');
      } else if (st.kind === 'owner') {
        step.ask = own(st.task) ? st.task : 'Дайте ответ';
      } else if (st.kind === 'route') {
        warnings.push('Маршрут Basic не импортирован: в черновой схеме ветвления нет.');
        return;
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
