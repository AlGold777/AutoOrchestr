const Engine = require(require('path').resolve(__dirname, '../../../disput/custom-engine.js'));
const text = {};
let n = 0;
const putText = value => { const ref = `t${++n}`; text[ref] = String(value); return ref; };
const getText = ref => text[ref];
const saved = [];
const checkpoint = async state => saved.push(JSON.parse(JSON.stringify(state)));
(async () => {
  const controller = new AbortController();
  const first = await Engine.run({
    task: 'T', steps: [{ ref: 'S1', kind: 'round', input: 'none', models: ['GPT'] }], signal: controller.signal,
    checkpoint, putText, getText,
    send: async () => { controller.abort(); throw Object.assign(new Error('stopped during send'), { name: 'AbortError' }); }
  });
  let checks = 0, ownerChoices = 0;
  const resumed = await Engine.run({
    task: 'T', steps: [{ ref: 'S1', kind: 'round', input: 'none', models: ['GPT'] }], resume: saved.at(-1), checkpoint, putText, getText,
    checkUnknown: async () => { checks++; return { ok: true, status: 'found', text: 'answer' }; },
    resolveUnknown: async () => { ownerChoices++; return 'skip'; },
    send: async () => { throw new Error('must not send on check'); }
  });
  process.stdout.write(JSON.stringify({ firstStop: first.stopReason, resumedStop: resumed.stopReason, checkCalls: checks, resolveUnknownCalls: ownerChoices, current: saved.at(-1).current }) + '\n');
})().catch(e => { process.stderr.write(String(e.stack || e) + '\n'); process.exitCode = 1; });
