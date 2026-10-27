// Обмен схемами между стендом ({ task, steps: [{ id, block, … }] }) и Basic ({ schemaVersion, origin, steps: [{ ref, kind, models }] }).
// toBasic — экспорт со стенда: файл, который принимает кнопка Import в Basic. fromBasic — импорт файла Basic на стенд.
// Переносятся round, owner, defaults (roundTask, discipline, modelNotes), run, description, исходные файлы и выходные артефакты.
// Остальные этапы (включая file) и defaults.synthesisTask не переносятся.
// Проверки на стенде нет: шаг gate из старого файла Basic приходит на стенд обычным раундом, шаг synthesis — раундом из одной модели.
(function initBasicExport(root) {
  'use strict';

  const own = (v) => typeof v === 'string' && v.trim() !== '';
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const list = (v) => (Array.isArray(v) ? v : []);
  const idPart = (id, fallback) => (String(id || '').replace(/[^A-Za-z0-9_-]/g, '') || fallback);
  const MODEL_COPY = ['maxWords', 'discipline'];
  const fieldPointer = (index) => `/${index === 0 ? 'a1' : `a${index + 1}`}`;

  const freshIdNamespace = () => {
    try {
      const cryptoApi = root.crypto || globalThis.crypto;
      if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
      if (cryptoApi?.getRandomValues) {
        const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      }
    } catch (_) { /* use the local fallback below */ }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  };

  // Ссылка входа стенда ("s2" или "s3.Артефакт") → id этапа.
  const stepOf = (ref) => String(ref).split('.')[0];

  function toBasic(schema, opts = {}) {
    const roleIdOf = opts.roleIdOf || (() => '');
    const warnings = [];
    const errors = [];
    const steps = list(schema?.steps).filter(isObj);
    const pos = new Map(steps.map((st, i) => [st.id, i]));
    const sourceArtifacts = list(schema?.artifacts).filter(isObj);
    const artifactIds = new Map();
    const sourceFiles = new Map();
    const sourceNamespace = freshIdNamespace();
    sourceArtifacts.forEach((artifact, i) => {
      const name = String(artifact.name || '').trim();
      if (name && sourceFiles.has(name)) errors.push(`Исходный артефакт «${name}» объявлен несколько раз; входы нельзя сопоставить однозначно.`);
      else if (name) sourceFiles.set(name, { artifact, id: `${sourceNamespace}-in-${i + 1}` });
    });

    // Первый проход: ref каждого переносимого шага.
    const refs = new Map();
    let rounds = 0;
    steps.forEach((st, i) => {
      if (st.block === 'round') refs.set(st.id, `r${++rounds}`);
      else if (st.block === 'owner') refs.set(st.id, `owner:${idPart(st.id, `s${i + 1}`)}`);
    });
    const enabledModels = (st) => list(st.models).filter((m) => isObj(m) && own(m.name) && m.enabled !== false);
    const artifactsOf = (st) => list(st.artifacts).map((a) => typeof a === 'string' ? { name: a } : a)
      .filter((a) => isObj(a) && own(a.name));
    const artifactNames = (st) => {
      const ids = new Map();
      let n = 0;
      artifactsOf(st).forEach((a) => {
        const name = String(a.name).trim();
        if (ids.has(name)) { errors.push(`Этап ${st.id}: артефакт «${name}» объявлен несколько раз.`); return; }
        if (a.document === 'read') { ids.set(name, { id: idPart(name, 'doc'), document: 'read' }); return; }
        if (a.document === 'form') { ids.set(name, { id: null, document: 'form' }); return; }
        n += 1;
        ids.set(name, { id: `a${n}`, pointer: fieldPointer(n - 1), document: '' });
      });
      artifactIds.set(st.id, ids);
      return ids;
    };
    const inputRefs = (st) => {
      const result = [];
      const seen = new Set();
      list(st.inputs).forEach((value) => {
        const r = String(value);
        if (r.startsWith('in.')) {
          const name = r.slice(3);
          const file = sourceFiles.get(name);
          if (!file) { errors.push(`Этап ${st.id}: вход «${r}» не перенесён: исходный файл «${name}» не найден.`); return; }
          const artifact = file.artifact;
          const descriptor = { id: file.id };
          if (typeof artifact.type === 'string') descriptor.type = artifact.type;
          if (Number.isSafeInteger(artifact.size) && artifact.size >= 0) descriptor.size = artifact.size;
          if (own(artifact.content)) {
            descriptor.name = /\.txt$/i.test(name) ? name : `${name}.txt`;
            descriptor.content = artifact.content;
          } else if (own(artifact.attachment)) descriptor.name = artifact.attachment;
          else { errors.push(`Этап ${st.id}: исходный артефакт «${name}» не перенесён: нужен content или attachment.`); return; }
          const key = `file:${descriptor.id}`;
          if (!seen.has(key)) { result.push({ file: descriptor }); seen.add(key); }
          return;
        }
        const dot = r.indexOf('.');
        const sid = dot < 0 ? r : r.slice(0, dot);
        if (!refs.has(sid)) {
          const sourceStep = pos.has(sid) ? steps[pos.get(sid)] : null;
          const message = sourceStep?.block === 'file'
            ? `Этап ${st.id}: вход «${r}» не перенесён: он зависит от этапа file, которого нет в Basic.`
            : `Этап ${st.id}: вход «${r}» не перенесён: источник «${sid}» отсутствует или не поддерживается.`;
          errors.push(message);
          if (sourceStep?.block === 'file') warnings.push(message);
          return;
        }
        if (pos.get(sid) >= pos.get(st.id)) {
          errors.push(`Этап ${st.id}: вход «${r}» не перенесён: источник должен быть раньше потребителя.`);
          return;
        }
        let source;
        if (dot >= 0) {
          const name = r.slice(dot + 1);
          const sourceStep = steps[pos.get(sid)];
          const enabled = sourceStep.block === 'owner' ? [{ name: 'owner' }] : enabledModels(sourceStep);
          const declaration = artifactIds.get(sid)?.get(name);
          if (!declaration) { errors.push(`Этап ${st.id}: вход «${r}» не перенесён: артефакт «${name}» не объявлен.`); return; }
          if (declaration.document === 'form') { errors.push(`Этап ${st.id}: вход «${r}» не перенесён: document form не объявляет адресуемый выходной артефакт.`); return; }
          if (enabled.length !== 1) { errors.push(`Этап ${st.id}: вход «${r}» не перенесён: у этапа ${sid} несколько включённых моделей, участника артефакта нельзя определить.`); return; }
          source = { artifact: { step: refs.get(sid), participant: enabled[0].name, id: declaration.id }, version: 'latest', required: true };
        } else source = { step: refs.get(sid), required: true };
        const key = JSON.stringify(source);
        if (!seen.has(key)) { result.push(source); seen.add(key); }
      });
      return result;
    };

    const modelOf = (m) => {
      const roleId = roleIdOf(m.role);
      const roleLine = own(m.role) && !roleId ? `Роль: ${m.role.trim()}.` : '';
      const task = [roleLine, own(m.task) ? m.task.trim() : ''].filter(Boolean).join('\n\n');
      const out = { name: String(m.name) };
      if (m.enabled === false) out.enabled = false;
      if (roleId && roleId !== 'None') out.role = roleId;
      if (task) out.task = task;
      MODEL_COPY.forEach((k) => { if (m[k] !== undefined && m[k] !== '') out[k] = m[k]; });
      if (Array.isArray(m.files)) out.files = m.files.map((file) => ({ ...file }));
      return out;
    };
    const out = [];
    // Раунды, чей документ для User перенесён в output шага Basic (на них может ссылаться owner.document).
    const docRounds = new Set();
    steps.forEach((st, i) => {
      const ref = refs.get(st.id);
      if (!ref) {
        if (st.block === 'file') {
          const message = `Этап ${st.id || i + 1} (file) не перенесён: вид file в Basic не поддерживается.`;
          errors.push(message);
          warnings.push(message);
        }
        else errors.push(`Этап ${st.id || i + 1} (${st.block}) не перенесён: в Basic такого блока нет.`);
        return;
      }
      const idsForArtifacts = st.block === 'round' || st.block === 'owner' ? artifactNames(st) : new Map();
      const input = inputRefs(st);
      const step = { ref, kind: st.block };
      if (st.block === 'round') {
        const basicInput = input.filter((source) => !source.file);
        step.input = basicInput.length ? basicInput : 'none';
        if (own(st.task)) step.task = st.task.trim();
        step.models = list(st.models).filter((m) => isObj(m) && own(m.name)).map(modelOf);
        const fileInputs = input.filter((source) => source.file).map((source) => source.file);
        if (fileInputs.length) step.files = fileInputs;
        const ordinary = artifactsOf(st).filter((a) => a.document !== 'read' && a.document !== 'form');
        const docArt = artifactsOf(st).find((a) => a.document === 'read' || a.document === 'form');
        if (ordinary.length) {
          if (docArt) errors.push(`Этап ${st.id}: обычные артефакты не перенесены вместе с document «${docArt.name}»: несовместимые выходы.`);
          else {
            const fields = ordinary.map((a) => {
              const declaration = idsForArtifacts.get(String(a.name).trim());
              return { id: declaration.id, name: String(a.name).trim(), pointer: declaration.pointer, ...(own(a.description) ? { description: a.description } : {}) };
            });
            step.output = { format: 'json', requiredFields: fields.map((field) => field.pointer), artifacts: fields };
            step.output.form = `Верни JSON. Поле ${fields.map((field) => `"${field.pointer.slice(1)}" — артефакт «${field.name}»`).join('; ')}. Содержимое каждого поля должно быть готовым артефактом.`;
          }
        }
        // Документ для User: только в раунде из одной модели; вид read — артефакт в output, form — опросник (json).
        if (docArt) {
          const name = String(docArt.name || '').trim();
          if (ordinary.length) { /* reported as an incompatible output above */ }
          else if (enabledModels(st).length !== 1) errors.push(`Этап ${st.id}: документ «${name}» не перенесён: в Basic документ для User даёт раунд из одной модели.`);
          else {
            docRounds.add(st.id);
            step.output = docArt.document === 'read'
              ? { document: 'read', artifacts: [{ id: idPart(name, 'doc'), name, pointer: '', ...(own(docArt.description) ? { description: docArt.description } : {}) }] }
              : { format: 'json', document: 'form' };
          }
        }
        if (['new', 'continue'].includes(st.chat)) step.chat = st.chat;
      } else if (st.block === 'owner') {
        step.task = own(st.ask) ? st.ask.trim() : 'Дайте ответ';
        step.models = [];
        const basicInput = input.filter((source) => !source.file);
        if (basicInput.length) step.input = basicInput;
        const fileInputs = input.filter((source) => source.file).map((source) => source.file);
        if (fileInputs.length) step.files = fileInputs;
        const ownerArtifacts = artifactsOf(st).filter((artifact) => {
          if (artifact.document) {
            errors.push(`Этап ${st.id}: документ User «${artifact.name}» не перенесён: Basic не поддерживает document-выходы у owner.`);
            return false;
          }
          return true;
        });
        if (ownerArtifacts.length) {
          const fields = ownerArtifacts.map((artifact) => {
            const declaration = idsForArtifacts.get(String(artifact.name).trim());
            return { id: declaration.id, name: String(artifact.name).trim(), pointer: declaration.pointer, ...(own(artifact.description) ? { description: artifact.description } : {}) };
          });
          step.output = { format: 'json', requiredFields: fields.map((field) => field.pointer), artifacts: fields };
          step.output.form = `Верни JSON. Поле ${fields.map((field) => `"${field.pointer.slice(1)}" — артефакт «${field.name}»`).join('; ')}. Содержимое каждого поля должно быть готовым артефактом.`;
        }
        if (st.document != null) {
          if (docRounds.has(st.document)) step.document = refs.get(st.document);
          else errors.push(`Этап ${st.id}: document «${st.document}» не перенесён: исходный round не экспортирован как document read.`);
        }
      }
      if (own(st.title)) step.title = st.title.trim();
      if (own(st.why)) step.goal = st.why.trim();
      out.push(step);
    });
    sourceArtifacts.forEach((a) => {
      const used = steps.some((st) => list(st.inputs).includes(`in.${a.name}`));
      if (!used) warnings.push(`Исходный артефакт «${a.name}» не перенесён: ни один этап его не использует.`);
    });

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
      if (Number.isSafeInteger(schema.run.maxWords) && schema.run.maxWords > 0) run.maxWords = schema.run.maxWords;
      if (Object.keys(run).length) result.run = run;
    }
    result.steps = out;
    if (!out.some((st) => st.kind === 'round' || st.kind === 'owner')) warnings.push('Нечего экспортировать: в схеме нет раунда или этапа User.');
    return { schema: result, warnings, errors };
  }

  function fromBasic(basic, opts = {}) {
    const warnings = [];
    const steps = list(basic?.steps).filter(isObj);
    const ids = new Map(steps.map((st, i) => [st.ref, `s${i + 1}`]));
    const MODEL_KINDS = ['round', 'gate', 'synthesis'];
    const linkable = (st) => MODEL_KINDS.includes(st.kind) || st.kind === 'owner';
    const refList = (input, consumer) => {
      if (!Array.isArray(input)) return [];
      const mapped = input.map((source) => {
        const ref = typeof source === 'string' ? source : (source?.step || source?.artifact?.step);
        const sourceStep = steps.find((candidate) => candidate.ref === ref);
        if (!sourceStep || !linkable(sourceStep)) return null;
        const label = typeof source === 'string' ? source : (source?.artifact
          ? `артефакт «${source.artifact.id || '?'}» участника «${source.artifact.participant || '?'}»`
          : source?.participant ? `участник «${source.participant}»` : `шаг «${ref}»`);
        if (!isObj(source) || source.required !== true) {
          warnings.push(`Шаг ${consumer.ref}: необязательный вход (${label}) Basic перенесён как связь со стендом; необязательность не сохраняется.`);
        }
        if (isObj(source) && source.artifact) {
          warnings.push(`Шаг ${consumer.ref}: адрес артефакта (${label}) сведён к связи со всем этапом ${ref}; артефакт и его версия не переносятся.`);
        } else if (isObj(source) && source.participant) {
          warnings.push(`Шаг ${consumer.ref}: адрес участника ${source.participant} этапа ${ref} сведён к связи со всем этапом.`);
        }
        return ids.get(sourceStep.ref);
      });
      return [...new Set(mapped.filter(Boolean))];
    };
    // «previous» — шаг перед этим, «all» — все шаги перед этим; раунд без input берёт предыдущий шаг (в том числе шаг User), если перед ним есть шаг; первый шаг — без входа (умолчание Basic).
    const inputsOf = (st, i) => {
      if (st.kind === 'route') return [];
      const spec = st.input === undefined && MODEL_KINDS.includes(st.kind) ? (steps.slice(0, i).some(linkable) ? 'previous' : 'none') : st.input;
      const before = steps.slice(0, i).filter(linkable).map((x) => ids.get(x.ref));
      if (spec === 'previous') {
        if (before.length) warnings.push(`Шаг ${st.ref}: input «previous» импортирован как связь с ближайшим предыдущим этапом стенда; при прогоне Basic предыдущим может оказаться более ранний результат.`);
        return before.slice(-1);
      }
      if (spec === 'all') {
        if (before.length) warnings.push(`Шаг ${st.ref}: input «all» собирает имеющиеся ответы всех предыдущих этапов; на стенде связи выглядят обязательными, и повторный экспорт сделает их обязательными.`);
        return before;
      }
      return refList(spec, st);
    };
    const out = [];
    steps.forEach((st, i) => {
      const id = ids.get(st.ref);
      const step = { id, block: st.kind, title: own(st.title) ? st.title : String(st.ref), why: own(st.goal) ? st.goal : 'Из схемы Basic' };
      if (list(st.files).length) warnings.push(`Шаг ${st.ref}: входные файлы Basic не представлены в формате стенда и не перенесены.`);
      if (list(st.models).some((model) => isObj(model) && model.input !== undefined)) {
        warnings.push(`Шаг ${st.ref}: индивидуальный models[].input не перенесён на стенд.`);
      }
      list(st.models).forEach((model) => {
        if (isObj(model) && list(model.files).length) warnings.push(`Шаг ${st.ref}: файлы участника «${model.name}» Basic не представлены в формате стенда и не перенесены.`);
      });
      const inputs = inputsOf(st, i);
      if (inputs.length) step.inputs = inputs;
      if (st.kind === 'round' || st.kind === 'gate') {
        if (st.kind === 'gate') {
          step.block = 'round';
          step.task = [`Критерии проверки: ${list(st.criteria).filter(own).join('; ') || 'ответ полный'}`, own(st.task) ? st.task : ''].filter(Boolean).join('\n\n');
          warnings.push('Проверка Basic импортирована как обычный этап: ветвление по вердикту не перенесено.');
        } else if (own(st.task)) step.task = st.task;
        step.models = list(st.models).filter((m) => isObj(m) && own(m.name)).map((m) => {
          const model = { name: m.name };
          if (m.enabled === false) model.enabled = false;
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
      if (st.kind === 'round') {
        const o = isObj(st.output) ? st.output : null;
        if (o?.document === 'read' && isObj(o.artifacts?.[0])) step.artifacts = [{ name: o.artifacts[0].name, document: 'read' }];
        else if (o?.document === 'form') step.artifacts = [{ name: own(o.name) ? o.name : 'Опросник', document: 'form' }];
        if (['new', 'continue'].includes(st.chat)) step.chat = st.chat;
      }
      if (st.kind === 'owner' && st.document !== undefined) step.document = ids.get(st.document);
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
