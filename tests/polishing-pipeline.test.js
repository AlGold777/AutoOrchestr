const fs = require('fs');
const path = require('path');
const Polishing = require('../disput/polishing-pipeline');
const Presets = require('../disput/pipeline-presets');

describe('Polishing pipeline', () => {
  test('one line is one idea: bullets and numbering are stripped, refusals and repeats dropped', () => {
    const known = [{ text: 'Добавить кэш' }];
    expect(Polishing.parseIdeas('1. Добавить кэш.\n- **Ввести роли**\n\n2) Логировать отказы\nНовых улучшений нет.', known))
      .toEqual(['Ввести роли', 'Логировать отказы']);
    expect(Polishing.parseIdeas('Нет новых улучшений')).toEqual([]);
  });

  test('the prompt carries the idea, the whole list and K', () => {
    const prompt = Polishing.buildPrompt({ idea: 'Сервис заметок', ideas: [{ text: 'A' }, { text: 'B' }], maxIdeas: 2 });
    expect(prompt).toContain('Сервис заметок');
    expect(prompt).toContain('1. A\n2. B');
    expect(prompt).toContain('не больше 2');
    expect(Polishing.buildPrompt({ idea: 'x' })).toContain('Пока нет.');
  });

  test('models run in order, each sees the lines added before it', async () => {
    const prompts = [];
    const answers = { A: ['a1\na2', 'a3', 'a1'], B: ['b1', '', ''] };
    const result = await Polishing.run({
      idea: 'idea',
      rounds: [['A', 'B'], ['A', 'B'], ['A', 'B']],
      send: async (model, prompt, { round }) => {
        prompts.push({ model, round, prompt });
        return { text: answers[model][round - 1] || '' };
      }
    });
    expect(prompts.map((item) => `${item.model}${item.round}`)).toEqual(['A1', 'B1', 'A2', 'B2', 'A3', 'B3']);
    expect(prompts[1].prompt).toContain('1. a1\n2. a2');
    expect(result.ideas.map((item) => `${item.text}@${item.model}${item.round}`)).toEqual(['a1@A1', 'a2@A1', 'b1@B1', 'a3@A2']);
    // Round 3: A only repeats a listed line, B gives no text — a round without new lines stops the run.
    expect(result.stopReason).toBe('no_new_ideas');
    expect(result.log.map((entry) => entry.status)).toEqual(['OK', 'OK', 'OK', 'FAILED', 'EMPTY', 'FAILED']);
  });

  test('a failing model is skipped, the chain goes on', async () => {
    const result = await Polishing.run({
      idea: 'idea',
      rounds: [['A', 'B']],
      send: async (model) => { if (model === 'A') throw new Error('timeout'); return { text: 'b1' }; }
    });
    expect(result.ideas.map((item) => item.text)).toEqual(['b1']);
    expect(result.log[0]).toMatchObject({ model: 'A', status: 'FAILED', reason: 'timeout' });
    expect(result.stopReason).toBe('rounds_done');
  });

  test('one silent round is survived, two in a row stop with all_failed; nothing new is EMPTY', async () => {
    let calls = 0;
    const recovered = await Polishing.run({
      idea: 'i', rounds: [['A'], ['A'], ['A']],
      send: async () => { calls += 1; return { text: calls === 2 ? 'a1' : '' }; }
    });
    expect(recovered.ideas.map((item) => item.text)).toEqual(['a1']);
    expect(recovered.stopReason).toBe('rounds_done');
    const failed = await Polishing.run({ idea: 'i', rounds: [['A'], ['A'], ['A']], send: async () => ({ text: '' }) });
    expect(failed.log).toHaveLength(2);
    expect(failed.stopReason).toBe('all_failed');
    const empty = await Polishing.run({ idea: 'i', rounds: [['A']], send: async () => ({ text: 'Новых улучшений нет' }) });
    expect(empty.log[0].status).toBe('EMPTY');
    expect(empty.stopReason).toBe('no_new_ideas');
  });

  test('an answer of the delivery token alone is EMPTY, so such a round stops at once with no_new_ideas', async () => {
    const result = await Polishing.run({
      idea: 'i', rounds: [['A', 'B'], ['A', 'B']],
      send: async (model, prompt, { round }) => (round === 1 && model === 'A' ? { text: 'a1', answered: true } : { text: '', status: 'SUCCESS', answered: true })
    });
    expect(result.log.map((entry) => entry.status)).toEqual(['OK', 'EMPTY', 'EMPTY', 'EMPTY']);
    expect(result.stopReason).toBe('no_new_ideas');
    // Without proof of a finished answer an empty text stays a failure.
    const failed = await Polishing.run({ idea: 'i', rounds: [['A']], send: async () => ({ text: '', status: 'TIMEOUT' }) });
    expect(failed.log[0]).toMatchObject({ status: 'FAILED', reason: 'TIMEOUT' });
  });

  test('K is a hard limit: lines beyond the first K are dropped and counted', async () => {
    const result = await Polishing.run({
      idea: 'i', rounds: [['A']], maxIdeas: 3,
      send: async () => ({ text: 'l1\nl2\nl3\nl4\nl5' })
    });
    expect(result.ideas.map((item) => item.text)).toEqual(['l1', 'l2', 'l3']);
    expect(result.log[0]).toMatchObject({ status: 'OK', added: 3, dropped: 2 });
    expect(Polishing.formatRounds(result.log)).toBe('Круг 1: A +3 (сверх K отброшено 2)');
  });

  test('Stop keeps what was collected', async () => {
    const controller = new AbortController();
    const result = await Polishing.run({
      idea: 'i', rounds: [['A', 'B']], signal: controller.signal,
      send: async () => { controller.abort(); return { text: 'x' }; }
    });
    expect(result.ideas.map((item) => item.text)).toEqual(['x']);
    expect(result.stopReason).toBe('cancelled');
    const thrown = await Polishing.run({
      idea: 'i', rounds: [['A']],
      send: async () => { throw new DOMException('cancelled', 'AbortError'); }
    });
    expect(thrown.stopReason).toBe('cancelled');
  });

  test('stops before the prompt with the whole list outgrows its budget', async () => {
    const result = await Polishing.run({
      idea: 'i', rounds: [['A'], ['A'], ['A']], maxPromptChars: 360,
      send: async (model, prompt, { round }) => ({ text: `улучшение номер ${round} `.repeat(4) })
    });
    expect(result.stopReason).toBe('list_full');
    expect(result.ideas.length).toBeGreaterThan(0);
    expect(result.ideas.length).toBeLessThan(3);
  });

  test('headings, fences, emphasis and an echo of the idea are not ideas', () => {
    expect(Polishing.parseIdeas('Улучшения:\n## Идеи\n```\n**Кэшировать ответы**\nСервис заметок', ['Сервис заметок']))
      .toEqual(['Кэшировать ответы']);
  });

  test('the result names author and round of every line, the answers of every round and the stop', () => {
    expect(Polishing.formatIdeas([{ text: 'a', model: 'GPT', round: 2 }])).toBe('1. a — GPT, круг 2');
    expect(Polishing.formatResult({
      ideas: [{ text: 'a', model: 'GPT', round: 1 }],
      log: [{ round: 1, model: 'GPT', status: 'OK', added: 1 }, { round: 1, model: 'Claude', status: 'EMPTY', added: 0 },
        { round: 1, model: 'Gemini', status: 'FAILED', reason: 'timeout', added: 0 }],
      stopReason: 'cancelled'
    })).toBe('1. a — GPT, круг 1\n\nКруг 1: GPT +1, Claude пусто, Gemini сбой (timeout)\n\nОстановка: остановлено пользователем.');
  });

  test('the Polishing preset runs its own loop on the page; while it runs Run is Stop', () => {
    expect(Presets.getPipelinePreset('POLISHING').runner).toBe('polishing');
    expect(Presets.BUILTIN_PIPELINE_DEFINITIONS.find((item) => item.presetId === 'POLISHING')).toMatchObject({ name: 'Polishing', polishingMaxIdeas: 3, defaultModelCount: 0 });
    const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
    expect(source).toContain("if (selectedPreset?.runner === 'polishing') {");
    expect(source).toContain("return { action: 'stop', icon: 'ti ti-player-stop'");
    const glue = source.slice(source.indexOf('const runPolishingFromPage'), source.indexOf('const startDebateFromPage'));
    expect(glue).toContain('anonymizeParticipants: false');
    expect(glue).toContain('maxPromptChars,');
    expect(glue).toContain("&& modelResult.attribution === 'verified';");
    expect(glue).toContain('return { text, status: modelResult.status || \'\', answered };');
    expect(glue).toContain("updateDebateModelCardOutput('Polishing', polishing.formatResult(result)");
    expect(glue).not.toContain('renderDebateModelCards(');
    expect(source).toMatch(/if \(controls\.action === 'stop'\) \{\s*event\.preventDefault\(\);\s*void cancelPipelineRun\(\);/);
    expect(source).toContain("const RETIRED_PIPELINE_PRESET_IDS = ['DELTA'];");
    // Polishing's own preset and glue carry no trace of the old name.
    expect(JSON.stringify(Presets.getPipelinePreset('POLISHING'))).not.toMatch(/delta/i);
    expect(glue).not.toMatch(/delta/i);
    ['result_new.html', 'pipeline_panel.html'].forEach((page) => {
      expect(fs.readFileSync(path.join(__dirname, '..', page), 'utf8')).toContain('<script src="disput/polishing-pipeline.js"></script>');
    });
  });

  test('Extract on a run without Debate stages explains itself instead of failing', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
    const handler = source.slice(source.indexOf("const button = event.target.closest('#disput-extract')"));
    const guard = handler.indexOf('!report.metadata?.debateRunId || !Array.isArray(report.stageExecutions)');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(handler.indexOf('window.ReportDigest.extractTransport(report, sourceFile)'));
    expect(handler.slice(guard, guard + 400)).toContain('нет этапов Debate');
    // The extractor itself still refuses a report that is not a Debate flow.
    expect(() => require('../shared/report-digest').buildTransportDigest({ metadata: {}, events: [] }))
      .toThrow('Transport extraction requires a Disput Flow report');
  });
});
