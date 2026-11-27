// The re-read of Basic/Circle looks for the request's own answer among the open tabs of the model when the bound tab is gone
// (live run 2026-11-27: DeepSeek answered in a tab the binding no longer pointed to; the re-read looked at the closed one).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JOB = fs.readFileSync(path.join(__dirname, '..', 'background/job-orchestrator.js'), 'utf8');
const source = JOB.slice(JOB.indexOf('const RETRY_REREAD_POLL_MS'), JOB.indexOf('function collectGetItBatch('));
const TAG = '[[AO-fvkysx]]';
const PROMPT = `Задание. ${TAG}`;

function build({ pages, boundTabId, answerText = `Итог.\n${TAG}` }) {
  const pings = [];
  const entry = { tabId: boundTabId, pendingFinalAnswer: '' };
  const ctx = {
    document, jobState: { llms: { DeepSeek: entry } }, pings,
    setTimeout: (fn) => { fn(); return 0; },
    isValidTabId: (id) => Number.isInteger(id) && id > 0,
    isEligibleTabForLlm: (name, tab) => /chat\.deepseek\.com/.test(tab.url),
    pageHoldsOwnPromptTurn: async () => false,
    pageHoldsAnswerEndingWithTag: async () => false,
    answerHasDeliveryToken: (name, text, tag) => text.trimEnd().endsWith(tag),
    handleManualResponsePing: async () => { entry.pendingFinalAnswer = answerText; pings.push(entry.tabId); return {}; },
    chrome: {
      tabs: { query: async () => Object.keys(pages).map((id) => ({ id: Number(id), url: 'https://chat.deepseek.com/a/chat/s/x' })) },
      scripting: { executeScript: async ({ target, func, args }) => {
        if (!(target.tabId in pages)) throw new Error('No tab');
        document.body.innerHTML = pages[target.tabId];
        return [{ result: func(...args) }];
      } }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(`${source}; this.run = rereadOwnTurnForBasic;`, ctx);
  return { run: (extra = {}) => ctx.run({ llmName: 'DeepSeek', sentPrompt: PROMPT, previousText: '', ...extra }), entry, pings };
}

afterEach(() => { document.body.innerHTML = ''; });

describe('re-read finds the answer in another tab of the model', () => {
  test('the bound tab is closed, the answer ending with the token is in another tab: found, confirmed, binding moved', async () => {
    const t = build({ boundTabId: 11, pages: { 22: `<main><div>${PROMPT}</div><div>Итог.</div><div>${TAG}</div></main>` } });
    const result = await t.run();
    expect(result).toMatchObject({ found: true, confirmed: true, status: 'SUCCESS' });
    expect(t.entry.tabId).toBe(22);
    expect(t.pings).toEqual([22]);
  });

  test('no binding at all: the same search runs', async () => {
    const t = build({ boundTabId: null, pages: { 22: `<main><div>Итог.</div><div>${TAG}</div></main>` } });
    expect((await t.run()).found).toBe(true);
  });

  test('another tab of the model with another token, or a token followed by a long text, is not the answer', async () => {
    const other = build({ boundTabId: 11, pages: { 22: '<main>Итог. [[AO-zzzzzz]]</main>' } });
    expect(await other.run()).toMatchObject({ found: false, reason: 'no_own_turn' });
    expect(other.pings).toEqual([]);
    const quoted = build({ boundTabId: 11, pages: { 22: `<main>Цитата ${TAG} ${'и дальше идёт много текста. '.repeat(10)}</main>` } });
    expect((await quoted.run()).found).toBe(false);
  });

  test('the token in the composer only is not the answer', async () => {
    const t = build({ boundTabId: 11, pages: { 22: `<main><div contenteditable="true">${TAG}</div></main>` } });
    expect((await t.run()).found).toBe(false);
  });

  test('no tab at all and no binding: no_tab', async () => {
    const t = build({ boundTabId: null, pages: {} });
    expect(await t.run()).toMatchObject({ found: false, reason: 'no_tab' });
  });
});
