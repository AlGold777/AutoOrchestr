const engine = require('../disput/custom-engine.js');

// A long task goes to each chat of a participant once; the next requests of that chat carry a reminder.
const longTask = `Ты — исследователь. ${'Условие задачи. '.repeat(120)}`;
const steps = [
  { ref: 'r1', kind: 'round', task: 'Ответь.', models: [{ name: 'GPT', id: 'gpt' }, { name: 'DeepSeek', id: 'ds' }] },
  { ref: 'r2', kind: 'round', task: 'Сведи.', models: [{ name: 'DeepSeek', id: 'ds-map' }] },
  { ref: 'r3', kind: 'round', task: 'Критикуй.', models: [{ name: 'GPT', id: 'gpt' }] }
];

const runWith = async (task, taskBrief, stepsOf = steps) => {
  const sent = [];
  let seq = 0;
  await engine.run({
    task, taskBrief, steps: stepsOf,
    sendParticipants: async (requests) => ({ byParticipant: Object.fromEntries(requests.map((request) => {
      sent.push({ id: request.participantId, step: request.stepRef, prompt: request.prompt });
      seq += 1;
      return [request.participantId, { text: `Ответ ${request.participantId} ${request.stepRef}`, status: 'SUCCESS', transportRequestId: `t${seq}` }];
    })) })
  });
  return sent;
};

describe('Basic: the task goes to each chat once', () => {
  test('long task: full on the first request of each chat, the short description later in the same chat', async () => {
    const sent = await runWith(longTask, 'Сравнить 2D ученика с 3D эталоном.');
    const of = (id, step) => sent.find((item) => item.id === id && item.step === step).prompt;
    expect(of('gpt', 'r1')).toContain(longTask.trim());
    expect(of('ds', 'r1')).toContain(longTask.trim());
    expect(of('ds-map', 'r2')).toContain(longTask.trim()); // a new participant has its own chat: the full task
    expect(of('gpt', 'r3')).not.toContain('Условие задачи. Условие задачи.');
    expect(of('gpt', 'r3')).toContain('Задача (кратко):\nСравнить 2D ученика с 3D эталоном.');
  });

  test('without a description the reminder points to the first message of the chat', async () => {
    const sent = await runWith(longTask, '');
    expect(sent.find((item) => item.id === 'gpt' && item.step === 'r3').prompt).toContain('Задача — в первом сообщении этого чата.');
  });

  test('a short task always goes in full', async () => {
    const sent = await runWith('Короткая задача.', 'кратко');
    expect(sent.find((item) => item.id === 'gpt' && item.step === 'r3').prompt).toContain('Задача:\nКороткая задача.');
  });

  test('a step with chat: new gets the full task again', async () => {
    const withNew = steps.map((step) => (step.ref === 'r3' ? { ...step, chat: 'new' } : step));
    const sent = await runWith(longTask, 'кратко', withNew);
    expect(sent.find((item) => item.id === 'gpt' && item.step === 'r3').prompt).toContain(longTask.trim());
  });
});

describe('Basic page: the short description and the ▶ task block', () => {
  const js = require('fs').readFileSync(require('path').join(__dirname, '..', 'results.js'), 'utf8');
  test('a long new task asks for the short description before the run; Cancel does not start it; the record keeps it', () => {
    expect(js).toContain("if (!resumeRecord && runSettings.askTaskBrief && String(task || '').trim().length > (engine.TASK_FULL_MAX_CHARS || 1500)) {");
    expect(js).toContain('if (answer === null) return false;');
    expect(js).toContain("let taskBrief = String(resumeRecord?.taskBrief || '');");
    expect(js).toContain('if (record && !resumeRecord) record.taskBrief = taskBrief;');
    expect(js).toMatch(/engine\.run\(\{\s*task,\s*taskBrief,/);
  });
  test('▶ shows the task of the input field and its short description; its tooltip starts with the task', () => {
    expect(js).toContain('X');
    expect(js).toContain("'<em>Задача не введена: введите её в поле ввода.</em>'");
    expect(js).toContain("safeRead(() => entryTooltipText(), '')");
  });
});
