// The re-read of Basic/Circle looks for the request's own answer among the open tabs of the model when the bound tab is gone
// (live run 2026-11-27: DeepSeek answered in a tab the binding no longer pointed to; the re-read looked at the closed one).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JOB = fs.readFileSync(path.join(__dirname, '..', 'background/job-orchestrator.js'), 'utf8');
const source = JOB.slice(JOB.indexOf('const RETRY_REREAD_POLL_MS'), JOB.indexOf('function collectGetItBatch('));
const TAG = '[[AO-fvkysx]]';
const PROMPT = `Задание. ${TAG}`;

function build({ pages, boundTabId, answerText = `Итог.\n${TAG}`, noEntry = false, finalized = false }) {
  const pings = [];
  const entry = { tabId: boundTabId, pendingFinalAnswer: '', finalized };
  const jobState = noEntry ? {} : { llms: { DeepSeek: entry } };
  const live = () => jobState.llms.DeepSeek;
  const ctx = {
    document, jobState, pings,
    isFinalizedEntry: (e) => e.finalized === true,
    ensureManualRecoveryModelEntry: (name, tabId) => {
      jobState.llms = jobState.llms || {};
      jobState.llms[name] = jobState.llms[name] || { tabId, pendingFinalAnswer: '' };
      return jobState.llms[name];
    },
    setTimeout: (fn) => { fn(); return 0; },
    isValidTabId: (id) => Number.isInteger(id) && id > 0,
    isEligibleTabForLlm: (name, tab) => /chat\.deepseek\.com/.test(tab.url),
    pageHoldsOwnPromptTurn: async () => false,
    pageHoldsAnswerEndingWithTag: async () => false,
    answerHasDeliveryToken: (name, text, tag) => text.trimEnd().endsWith(tag),
    handleManualResponsePing: async () => { live().pendingFinalAnswer = answerText; pings.push(live().tabId); return {}; },
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
  return { run: (extra = {}) => ctx.run({ llmName: 'DeepSeek', sentPrompt: PROMPT, previousText: '', ...extra }), entry, live, pings };
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

// Live run 2026-11-27: Stop clears the job state, and DeepSeek's own captions follow the answer.
describe('re-read for a continued research (detached)', () => {
  const page = `<main><div>${PROMPT}</div><div>Итог.</div><div>${TAG}</div><div>${'подписи под полем ввода '.repeat(8)}</div></main>`;

  test('without a job entry a Basic re-read stays unavailable', async () => {
    const t = build({ boundTabId: null, noEntry: true, pages: { 22: page } });
    expect(await t.run()).toMatchObject({ found: false, reason: 'reread_unavailable' });
    expect(t.pings).toEqual([]);
  });

  test('the job state is empty: the tab is found by the token, an entry is created, the answer is confirmed', async () => {
    const t = build({ boundTabId: null, noEntry: true, pages: { 21: '<main>другой чат [[AO-zzzzzz]]</main>', 22: page } });
    expect(await t.run({ detached: true })).toMatchObject({ found: true, confirmed: true, status: 'SUCCESS', completion: 'complete' });
    expect(t.pings).toEqual([22]);
  });

  test('an answer without the token is not confirmed', async () => {
    const t = build({ boundTabId: null, noEntry: true, answerText: 'Итог без метки', pages: { 22: page } });
    expect(await t.run({ detached: true })).toMatchObject({ confirmed: false, status: 'PARTIAL' });
  });

  test('a finished entry of a later run is replaced, an unfinished one is left alone', async () => {
    const later = build({ boundTabId: 11, finalized: true, pages: { 11: '<main>позже</main>', 22: page } });
    later.entry.answer = 'Ответ другого запуска';
    expect(await later.run({ detached: true })).toMatchObject({ found: true, confirmed: true });
    expect(later.live()).not.toBe(later.entry);
    expect(later.live().tabId).toBe(22);
    const busy = build({ boundTabId: 11, pages: { 11: '<main>идёт</main>', 22: page } });
    expect(await busy.run({ detached: true })).toMatchObject({ found: false, reason: 'model_busy' });
    expect(busy.entry.tabId).toBe(11);
    expect(busy.pings).toEqual([]);
  });

  test('no tab holds the token', async () => {
    const t = build({ boundTabId: null, noEntry: true, pages: { 22: '<main>пусто</main>' } });
    expect(await t.run({ detached: true })).toMatchObject({ found: false, reason: 'no_tab' });
  });
});
