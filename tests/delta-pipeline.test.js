const fs = require('fs');
const path = require('path');
const Delta = require('../disput/delta-pipeline');
const Presets = require('../disput/pipeline-presets');

describe('Delta pipeline', () => {
  test('one line is one idea: bullets and numbering are stripped, refusals and repeats dropped', () => {
    const known = [{ text: 'Добавить кэш' }];
    expect(Delta.parseIdeas('1. Добавить кэш.\n- **Ввести роли**\n\n2) Логировать отказы\nНовых улучшений нет.', known))
      .toEqual(['**Ввести роли**', 'Логировать отказы']);
    expect(Delta.parseIdeas('Нет новых улучшений')).toEqual([]);
  });

  test('the prompt carries the idea, the whole list and K', () => {
    const prompt = Delta.buildPrompt({ idea: 'Сервис заметок', ideas: [{ text: 'A' }, { text: 'B' }], maxIdeas: 2 });
    expect(prompt).toContain('Сервис заметок');
    expect(prompt).toContain('1. A\n2. B');
    expect(prompt).toContain('не больше 2');
    expect(Delta.buildPrompt({ idea: 'x' })).toContain('Пока нет.');
  });

  test('models run in order, each sees the lines added before it', async () => {
    const prompts = [];
    const answers = { A: ['a1\na2', 'a3', 'a1'], B: ['b1', '', ''] };
    const result = await Delta.run({
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
    const result = await Delta.run({
      idea: 'idea',
      rounds: [['A', 'B']],
      send: async (model) => { if (model === 'A') throw new Error('timeout'); return { text: 'b1' }; }
    });
    expect(result.ideas.map((item) => item.text)).toEqual(['b1']);
    expect(result.log[0]).toMatchObject({ model: 'A', status: 'FAILED', reason: 'timeout' });
    expect(result.stopReason).toBe('rounds_done');
  });

  test('a round where nobody answered stops with all_failed; an answer with nothing new is EMPTY', async () => {
    const failed = await Delta.run({ idea: 'i', rounds: [['A'], ['A']], send: async () => ({ text: '' }) });
    expect(failed.stopReason).toBe('all_failed');
    const empty = await Delta.run({ idea: 'i', rounds: [['A']], send: async () => ({ text: 'Новых улучшений нет' }) });
    expect(empty.log[0].status).toBe('EMPTY');
    expect(empty.stopReason).toBe('no_new_ideas');
  });

  test('Stop aborts the run', async () => {
    const controller = new AbortController();
    const run = Delta.run({
      idea: 'i', rounds: [['A', 'B']], signal: controller.signal,
      send: async () => { controller.abort(); return { text: 'x' }; }
    });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
  });

  test('the result list names the author and the round', () => {
    expect(Delta.formatIdeas([{ text: 'a', model: 'GPT', round: 2 }])).toBe('1. a — GPT, круг 2');
  });

  test('the Delta preset runs its own loop on the page; while it runs Run is Stop', () => {
    expect(Presets.getPipelinePreset('DELTA').runner).toBe('delta');
    expect(Presets.BUILTIN_PIPELINE_DEFINITIONS.find((item) => item.presetId === 'DELTA')).toMatchObject({ name: 'Delta', deltaMaxIdeas: 3, defaultModelCount: 0 });
    const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
    expect(source).toContain("if (selectedPreset?.runner === 'delta') {");
    expect(source).toContain("return { action: 'stop', icon: 'ti ti-player-stop'");
    expect(source).toMatch(/if \(controls\.action === 'stop'\) \{\s*event\.preventDefault\(\);\s*void cancelPipelineRun\(\);/);
    ['result_new.html', 'pipeline_panel.html'].forEach((page) => {
      expect(fs.readFileSync(path.join(__dirname, '..', page), 'utf8')).toContain('<script src="disput/delta-pipeline.js"></script>');
    });
  });
});
