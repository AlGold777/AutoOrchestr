const emptyDiscipline = () => ({ limit: '', content: '', delivery: '', correction: '', lines: [] });
const protoModel = (name) => ({ name, enabled: true, role: 'None', task: '', request: '', maxWords: '', discipline: emptyDiscipline() });
window.ProtoState = {
  models: ['Claude', 'GPT', 'Gemini'],
  selectedModel: 'Claude',                          // модель, выбранная в верхней строке (холст)
  defaults: { roundTask: '', synthesisTask: '', discipline: emptyDiscipline(), modelNotes: {}, roundPrompts: {} },
  run: { policy: 'auto', maxWords: 300 },
  rounds: [
    { ref: 'r1', order: '', input: '', task: '', role: 'None', models: ['Claude', 'GPT', 'Gemini'].map(protoModel), intermediateSynthesis: null,
      artifacts: [{ id: 'a1', title: 'Карта функций', version: 1 }, { id: 'a2', title: 'Список рисков', version: 2 }] },
    { ref: 'r2', order: '', input: '', task: '', role: 'None', models: ['Claude', 'GPT', 'Gemini'].map(protoModel), intermediateSynthesis: null,
      artifacts: [{ id: 'a3', title: 'План работ', version: 1 }] }
  ],
  final: { on: true, model: 'Claude', task: '', discipline: emptyDiscipline() },
  emptyDiscipline,
  protoModel,
  onChange() {}
};
