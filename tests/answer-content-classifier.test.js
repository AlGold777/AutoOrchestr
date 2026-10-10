const Classifier = require('../shared/answer-content-classifier');
const { CLASSES } = Classifier;

describe('AnswerContentClassifier', () => {
  const prompt = 'Explain the CAP theorem in distributed systems.';

  test('empty text', () => {
    const r = Classifier.classify('   ', { prompt });
    expect(r.contentClass).toBe(CLASSES.EMPTY);
    expect(r.terminalEligible).toBe(false);
  });

  test('prompt echo (verbatim and near-verbatim)', () => {
    expect(Classifier.classify(prompt, { prompt }).contentClass).toBe(CLASSES.PROMPT_ECHO);
    expect(Classifier.classify(prompt + ' ?', { prompt }).contentClass).toBe(CLASSES.PROMPT_ECHO);
    expect(Classifier.isTerminalEligible(prompt, { prompt })).toBe(false);
  });

  test('Gemini thinking heading plus the page label is not an answer; the answer after the label is', () => {
    for (const t of ['Ответ Gemini', 'Analyzing the Russian\nОтвет Gemini', 'Refining Hell Joke\n\nОтвет Gemini', 'Gemini said']) {
      const r = Classifier.classify(t, { prompt });
      expect(r.terminalEligible).toBe(false);
      expect(r.reason).toBe('gemini_thinking_only');
    }
    const answer = 'Ответ Gemini\n\nСовременный японский юмор 2026 года строится на выразительном и коротком формате. [[AO-a2gmbb]]';
    expect(Classifier.classify(answer, { prompt }).terminalEligible).toBe(true);
  });

  test('provider error surfaces (longer than min, still not an answer)', () => {
    for (const t of [
      'Something went wrong. Please try again later.',
      'You have reached your message limit for this hour.',
      'Network error: failed to generate a response.'
    ]) {
      expect(Classifier.classify(t, { prompt }).contentClass).toBe(CLASSES.PROVIDER_ERROR);
      expect(Classifier.isTerminalEligible(t, { prompt })).toBe(false);
    }
  });

  test('adapter transport diagnostics are not answers', () => {
    for (const t of [
      'Error: Claude send not confirmed',
      'Error: ChatGPT prompt submission was not confirmed',
      'Error: FutureProvider send was not confirmed',
      'Error: Empty answer received',
      'Error: Extracted text is prompt/UI scaffolding, not an answer',
      'Error: Extracted answer matches original prompt',
      'Error: Tab closed during generation',
      'Error: Rate limit detected. Please wait.',
      'Error: script_runtime_hard_stop_180000ms'
    ]) {
      expect(Classifier.classify(t, { prompt }).contentClass).toBe(CLASSES.TECHNICAL_MESSAGE);
      expect(Classifier.isTerminalEligible(t, { prompt })).toBe(false);
    }
  });

  test('an explicitly marked internal error is technical even when its text is dynamic', () => {
    const result = Classifier.classify('Error: completely new adapter diagnostic', {
      prompt,
      internalError: true
    });
    expect(result.contentClass).toBe(CLASSES.TECHNICAL_MESSAGE);
    expect(result.terminalEligible).toBe(false);
  });

  test('UI noise (short labels / model names / buttons)', () => {
    for (const t of [
      'Copy',
      'Regenerate',
      'Claude Opus 4.8',
      'Thinking…',
      'GPT-5',
      'Ссылайся на следующее содержимое:',
      'Refer to the following content:'
    ]) {
      expect(Classifier.classify(t, { prompt }).contentClass).toBe(CLASSES.UI_NOISE);
      expect(Classifier.isTerminalEligible(t, { prompt })).toBe(false);
    }
  });

  test('short but meaningful answers are SHORT_VALID and terminal-eligible', () => {
    for (const t of ['Yes.', 'Готово.', 'No, it cannot.', '42']) {
      const r = Classifier.classify(t, { prompt });
      expect(r.contentClass).toBe(CLASSES.SHORT_VALID);
      expect(r.terminalEligible).toBe(true);
    }
  });

  test('a real long answer is VALID', () => {
    const t = 'The CAP theorem states that a distributed data store can provide at most '
      + 'two of three guarantees: consistency, availability, and partition tolerance. '
      + 'In practice, partition tolerance is required, so the trade-off is between C and A.';
    const r = Classifier.classify(t, { prompt });
    expect(r.contentClass).toBe(CLASSES.VALID);
    expect(r.terminalEligible).toBe(true);
  });

  test('a long answer that merely mentions "error" is NOT misclassified', () => {
    const t = 'A 500 error means the server failed. To debug it, check the application logs, '
      + 'verify the database connection pool, and confirm the upstream service is reachable. '
      + 'Typical causes are unhandled exceptions and timeouts under load.';
    expect(Classifier.classify(t, { prompt }).contentClass).toBe(CLASSES.VALID);
  });
});
