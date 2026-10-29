/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(require.resolve('../content-scripts/content-grok'), 'utf8');

test.each(['Stop response', 'Остановить', 'Cancel generation'])('cached Send changed to %s is never clicked', async label => {
  const dom = new JSDOM('<button aria-label="Send">Send</button><textarea>prompt</textarea>');
  const button = dom.window.document.querySelector('button');
  const click = jest.spyOn(button, 'click');
  // Same DOM node, different meaning after the keyboard submission.
  button.setAttribute('aria-label', label);
  const c = vm.createContext({});
  const from = source.indexOf('  async function attemptSendViaButton');
  vm.runInContext(source.slice(from, source.indexOf('  async function attemptSendViaCtrlEnter', from)), c);
  expect(await c.attemptSendViaButton(button, dom.window.document.querySelector('textarea'))).toBe(false);
  expect(click).not.toHaveBeenCalled();
  dom.window.close();
});

test('ordinary Send clicks once without a second keyboard submission', async () => {
  const dom = new JSDOM('<button aria-label="Send">Send</button><textarea>prompt</textarea>');
  const button = dom.window.document.querySelector('button');
  const click = jest.spyOn(button, 'click');
  const c = vm.createContext({watchResponseActivity:async()=>true,waitForComposerClear:async()=>true,
    emitDiagnostic:()=>{},simulateCtrlEnter:jest.fn()});
  const from = source.indexOf('  async function attemptSendViaButton');
  vm.runInContext(source.slice(from, source.indexOf('  async function attemptSendViaCtrlEnter', from)), c);
  expect(await c.attemptSendViaButton(button, dom.window.document.querySelector('textarea'))).toBe(true);
  expect(click).toHaveBeenCalledTimes(1);
  expect(c.simulateCtrlEnter).not.toHaveBeenCalled();
  dom.window.close();
});

test.each([false,true])('posted-prompt verification failure leaves generation running (observed=%s)', async observed => {
  const events=[];
  const c=vm.createContext({submittedPrompt:{observed,matches:false,text:'partial',elapsedMs:10000},
    prompt:'complete prompt',sendMethod:'ctrl_enter',normalizeForComparison:s=>s,
    emitDiagnostic:e=>events.push(e),stopGrokWrongGeneration:jest.fn()});
  const from=source.indexOf('        if (!submittedPrompt.observed || !submittedPrompt.matches)');
  const to=source.indexOf('\n        }',from)+10;
  vm.runInContext(`async function verify(){${source.slice(from,to)}}`,c);
  await expect(c.verify()).rejects.toMatchObject({type:observed?'send_payload_mismatch':'send_payload_unverified'});
  expect(c.stopGrokWrongGeneration).not.toHaveBeenCalled();
  expect(events[0].meta.generationStopped).toBe(false);
});

test('кнопка «Прикрепить» (меню) никогда не нажимается как отправка', async () => {
  const dom = new JSDOM('<button aria-label="Прикрепить" aria-haspopup="menu" data-testid="attach-button"><svg></svg></button><textarea>prompt</textarea>');
  const button = dom.window.document.querySelector('button');
  const click = jest.spyOn(button, 'click');
  const c = vm.createContext({});
  const from = source.indexOf('  async function attemptSendViaButton');
  vm.runInContext(source.slice(from, source.indexOf('  async function attemptSendViaCtrlEnter', from)), c);
  expect(await c.attemptSendViaButton(button, dom.window.document.querySelector('textarea'))).toBe(false);
  expect(click).not.toHaveBeenCalled();
  expect(source).not.toMatch(/fallbackSelectors[\s\S]{0,1200}'button:has\(svg\)'/);
  dom.window.close();
});
