// Barrier settlement contract of pipelineWaiter: answers are matched only by
// transportRequestId; a terminal failure settles the participant; every wait
// has exactly one outcome; concurrent batches never share state.
const fs = require('fs');
const path = require('path');

function loadPipelineWaiter() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
  const start = source.indexOf('const PIPELINE_TRANSPORT');
  const end = source.indexOf('let appendModeratorNoneNoteFromComposer');
  if (start < 0 || end < 0 || end <= start) throw new Error('pipelineWaiter block not found in results.js');
  const block = source.slice(start, end);
  // eslint-disable-next-line no-new-func
  return new Function(`${block}; return pipelineWaiter;`)();
}

const ids = (models, prefix = 'req') => Object.fromEntries(models.map((model) => [model, `${prefix}-${model}`]));
const final = (llmName, answer, extra = {}) => ({
  llmName,
  answer,
  transportRequestId: extra.transportRequestId || `req-${llmName}`,
  status: extra.status,
  metadata: { terminal: true, ...(extra.metadata || {}) }
});

describe('pipelineWaiter — terminal settlement', () => {
  test('2 SUCCESS + 1 terminal FAILED (empty answer) resolves without timeout', async () => {
    const waiter = loadPipelineWaiter();
    const promise = waiter.waitForModels(['A', 'B', 'C'], { timeoutMs: 60000, requestIds: ids(['A', 'B', 'C']) });
    waiter.handleFinal(final('A', 'answer A'));
    waiter.handleFinal(final('B', 'answer B'));
    waiter.handleFinal(final('C', '', { status: 'ERROR' }));
    const result = await promise;
    expect(result.timedOut).toBe(false);
    expect(Object.keys(result.responses).sort()).toEqual(['A', 'B']);
    expect(result.missing).toEqual(['C']);
    expect(result.failed).toEqual({ C: 'ERROR' });
    expect(result.results.C.completion).toBe('failed');
  });

  test('terminal failure first, successes after — still settles', async () => {
    const waiter = loadPipelineWaiter();
    const promise = waiter.waitForModels(['A', 'B'], { timeoutMs: 60000, requestIds: ids(['A', 'B']) });
    waiter.handleFinal(final('B', '', { status: 'EXTRACT_FAILED' }));
    waiter.handleFinal(final('A', 'ok'));
    const result = await promise;
    expect(result.timedOut).toBe(false);
    expect(result.failed).toEqual({ B: 'EXTRACT_FAILED' });
  });

  test('late usable answer overrides an earlier failure settlement before finalize', async () => {
    const waiter = loadPipelineWaiter();
    const promise = waiter.waitForModels(['A', 'B'], { timeoutMs: 60000, requestIds: ids(['A', 'B']) });
    waiter.handleFinal(final('A', '', { status: 'STREAM_TIMEOUT' }));
    waiter.handleFinal(final('A', 'recovered answer'));
    waiter.handleFinal(final('B', 'ok'));
    const result = await promise;
    expect(result.responses.A).toBe('recovered answer');
    expect(result.failed).toEqual({});
  });

  test('a terminal answer is immutable: a later revision does not replace it', async () => {
    const waiter = loadPipelineWaiter();
    const promise = waiter.waitForModels(['A', 'B'], { timeoutMs: 60000, requestIds: ids(['A', 'B']) });
    expect(waiter.handleFinal(final('A', 'first final'))).toBe(true);
    expect(waiter.handleFinal(final('A', 'revised final', { metadata: { revision: true } }))).toBe(false);
    waiter.handleFinal(final('B', 'ok'));
    const result = await promise;
    expect(result.responses.A).toBe('first final');
  });

  test('status survives text: STREAM_TIMEOUT with text is partial, not complete', async () => {
    const waiter = loadPipelineWaiter();
    const promise = waiter.waitForModels(['A'], { timeoutMs: 60000, requestIds: ids(['A']) });
    waiter.handleFinal(final('A', 'cut off answer', { status: 'STREAM_TIMEOUT' }));
    const result = await promise;
    expect(result.responses.A).toBe('cut off answer');
    expect(result.results.A).toMatchObject({ status: 'STREAM_TIMEOUT', completion: 'partial' });
  });

  test('every final status the background can publish settles the request', async () => {
    const statuses = ['SUCCESS', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN', 'ERROR', 'EXTERNAL_LLM_FAILURE',
      'EXTRACT_FAILED', 'NO_SEND', 'STREAM_TIMEOUT', 'UNCERTAIN', 'USER_ACTION_REQUIRED'];
    const waiter = loadPipelineWaiter();
    const promise = waiter.waitForModels(statuses, { timeoutMs: 60000, requestIds: ids(statuses) });
    // Status only, no explicit terminal flag: the status list alone must settle.
    statuses.forEach((status) => waiter.handleFinal({
      llmName: status, answer: '', transportRequestId: `req-${status}`, status, metadata: {}
    }));
    const result = await promise;
    expect(result.timedOut).toBe(false);
    expect(Object.keys(result.failed).sort()).toEqual(statuses.slice().sort());
  });

  test('non-terminal empty message does not settle (still waits, then timeout)', async () => {
    jest.useFakeTimers();
    try {
      const waiter = loadPipelineWaiter();
      const promise = waiter.waitForModels(['A'], { timeoutMs: 5000, requestIds: ids(['A']) });
      waiter.handleFinal({ llmName: 'A', answer: '', transportRequestId: 'req-A', metadata: {} });
      jest.advanceTimersByTime(5001);
      const result = await promise;
      expect(result.timedOut).toBe(true);
      expect(result.missing).toEqual(['A']);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('pipelineWaiter — request identity', () => {
  test('answers without identity or of another request are rejected', async () => {
    const waiter = loadPipelineWaiter();
    const promise = waiter.waitForModels(['A'], { timeoutMs: 60000, requestIds: ids(['A']) });
    expect(waiter.handleFinal({ llmName: 'A', answer: 'no id', metadata: { terminal: true } })).toBe(false);
    expect(waiter.handleFinal(final('A', 'old request', { transportRequestId: 'req-old' }))).toBe(false);
    expect(waiter.handleFinal(final('B', 'other model', { transportRequestId: 'req-A' }))).toBe(false);
    expect(waiter.handleFinal(final('A', 'mine'))).toBe(true);
    await expect(promise).resolves.toMatchObject({ responses: { A: 'mine' } });
  });

  test('registration happens before dispatch: an immediate answer is not lost', async () => {
    const waiter = loadPipelineWaiter();
    const promise = waiter.waitForModels(['A'], { timeoutMs: 60000, requestIds: ids(['A']) });
    // The answer arrives synchronously, before any awaited dispatch acknowledgement.
    waiter.handleFinal(final('A', 'fast answer'));
    await expect(promise).resolves.toMatchObject({ responses: { A: 'fast answer' }, timedOut: false });
  });

  test('concurrent batches of the same model are independent', async () => {
    const waiter = loadPipelineWaiter();
    const first = waiter.waitForModels(['A'], { timeoutMs: 60000, requestIds: { A: 'req-1' } });
    const second = waiter.waitForModels(['A'], { timeoutMs: 60000, requestIds: { A: 'req-2' } });
    waiter.handleFinal(final('A', 'second answer', { transportRequestId: 'req-2' }));
    waiter.handleFinal(final('A', 'first answer', { transportRequestId: 'req-1' }));
    await expect(first).resolves.toMatchObject({ responses: { A: 'first answer' } });
    await expect(second).resolves.toMatchObject({ responses: { A: 'second answer' } });
  });

  test('reset and cancel settle every pending wait with AbortError', async () => {
    const waiter = loadPipelineWaiter();
    const first = waiter.waitForModels(['A'], { timeoutMs: 60000, requestIds: { A: 'req-1' } });
    const second = waiter.waitForModels(['B'], { timeoutMs: 60000, requestIds: { B: 'req-2' } });
    waiter.reset();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    expect(waiter.waiting).toBe(false);
  });

  test('an aborted signal settles the wait', async () => {
    const waiter = loadPipelineWaiter();
    const controller = new AbortController();
    const promise = waiter.waitForModels(['A'], { timeoutMs: 60000, requestIds: ids(['A']), signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('pipelineWaiter — the delivery token upgrades an unproven answer', () => {
  test('a kept answer without the token is replaced by the same request\'s answer with it, while the batch is open', async () => {
    const waiter = loadPipelineWaiter();
    const promise = waiter.waitForModels(['A', 'B'], { timeoutMs: 60000, requestIds: ids(['A', 'B']) });
    waiter.handleFinal(final('A', 'обрезанный текст', { metadata: { attributionState: 'unproven' } }));
    expect(waiter.handleFinal(final('A', 'полный текст ответа', { metadata: { revision: true } }))).toBe(true);
    waiter.handleFinal(final('B', 'ok'));
    const result = await promise;
    expect(result.responses.A).toBe('полный текст ответа');
    expect(result.results.A).toMatchObject({ attribution: 'verified', replacedUnproven: true });
  });

  test('a verified answer stays immutable; an unproven revision does not replace an unproven answer', async () => {
    const waiter = loadPipelineWaiter();
    const promise = waiter.waitForModels(['A', 'B'], { timeoutMs: 60000, requestIds: ids(['A', 'B']) });
    waiter.handleFinal(final('A', 'первый', { metadata: { attributionState: 'unproven' } }));
    expect(waiter.handleFinal(final('A', 'второй', { metadata: { attributionState: 'unproven', revision: true } }))).toBe(false);
    waiter.handleFinal(final('B', 'ok'));
    expect(waiter.handleFinal(final('B', 'другое', { metadata: { revision: true } }))).toBe(false);
    const result = await promise;
    expect(result.responses).toEqual({ A: 'первый', B: 'ok' });
  });
});
