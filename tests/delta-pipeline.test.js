const fs = require('fs');
const path = require('path');
const Delta = require('../disput/delta-pipeline');
const Presets = require('../disput/pipeline-presets');

describe('Delta pipeline', () => {
  test('first turn gets the whole phrase, later turns only the words added after its own', async () => {
    const prompts = [];
    const answers = { A: ['вышел', 'и'], B: ['на', 'увидел'], C: ['крышу', 'луну'] };
    const result = await Delta.run({
      start: 'Утром кот',
      rounds: [['A', 'B', 'C'], ['A', 'B', 'C']],
      send: async (model, prompt, { round, full }) => {
        prompts.push({ model, round, full, prompt });
        return { text: answers[model][round - 1] };
      }
    });
    expect(result.phrase).toBe('Утром кот вышел на крышу и увидел луну');
    expect(prompts.map((item) => item.full)).toEqual([true, true, true, false, false, false]);
    expect(prompts[2].prompt).toContain('Фраза: «Утром кот вышел на»');
    expect(prompts[3].prompt).toContain('После твоего слова добавлено: «на крышу»');
    expect(prompts[3].prompt).not.toContain('Утром');
    expect(prompts[4].prompt).toContain('добавлено: «крышу и»');
    expect(prompts[5].prompt).toContain('добавлено: «и увидел»');
    expect(result.stopReason).toBe('rounds_done');
  });

  test('a model that did not answer gets the whole phrase on its next turn', async () => {
    const prompts = [];
    const result = await Delta.run({
      start: 'Утром',
      rounds: [['A', 'B'], ['A', 'B']],
      send: async (model, prompt, { round }) => {
        prompts.push(prompt);
        if (model === 'B' && round === 1) return { text: '', status: 'TIMEOUT' };
        return { text: `${model}${round}` };
      }
    });
    expect(result.log[1]).toMatchObject({ model: 'B', status: 'FAILED', reason: 'TIMEOUT' });
    expect(prompts[3]).toContain('Фраза: «Утром A1 A2»');
    expect(result.phrase).toBe('Утром A1 A2 B2');
  });

  test('only the first word is taken; quotes and the delivery token are not words', () => {
    expect(Delta.parseWord('«крышу» и ещё')).toEqual({ word: 'крышу', extra: 2 });
    expect(Delta.parseWord('**луну**\n[[AO-abc123]]')).toEqual({ word: 'луну', extra: 0 });
    expect(Delta.parseWord('[[AO-abc123]]')).toEqual({ word: '', extra: 0 });
  });

  test('a single model gets a delta without new words', async () => {
    const prompts = [];
    await Delta.run({ start: 'Раз', rounds: [['A'], ['A']], send: async (m, prompt) => { prompts.push(prompt); return { text: 'два' }; } });
    expect(prompts[1]).toContain('После твоего слова ничего не добавлено.');
  });

  test('a round where nobody added a word stops the game', async () => {
    const result = await Delta.run({ start: 'x', rounds: [['A'], ['A']], send: async () => { throw new Error('timeout'); } });
    expect(result.stopReason).toBe('all_failed');
    expect(result.log).toHaveLength(1);
  });

  test('Stop aborts the game', async () => {
    const controller = new AbortController();
    const run = Delta.run({
      start: 'x', rounds: [['A', 'B']], signal: controller.signal,
      send: async () => { controller.abort(); return { text: 'y' }; }
    });
    const result = await run;
    expect(result.stopReason).toBe('cancelled');
    // The word already added stays in the phrase.
    expect(result.phrase).toBe('x y');
  });

  test('the result shows the phrase and who added each word', () => {
    expect(Delta.formatResult({ phrase: 'Утром кот', words: [{ text: 'кот', model: 'GPT', round: 1 }], stopReason: 'rounds_done' }))
      .toBe('Утром кот\n\nкот — GPT, круг 1\n\nОстановка: все круги пройдены.');
  });

  test('the preset runs on the page loop; Run is Stop; each model starts in its own new chat', () => {
    expect(Presets.getPipelinePreset('DELTA').runner).toBe('delta');
    expect(Presets.BUILTIN_PIPELINE_DEFINITIONS.find((item) => item.presetId === 'DELTA')).toMatchObject({ name: 'Delta', defaultModelCount: 0 });
    const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
    expect(source).toContain("if (selectedPreset?.runner === 'delta') {");
    expect(source).toContain('(customAbortController || polishingAbortController || deltaAbortController).abort();');
    expect(source).toContain('&& !models.some((model) => opened?.has?.(model));');
    expect(source).toContain('models.forEach((model) => activePipelineRunContext.newPagesModels.add(model));');
    const glue = source.slice(source.indexOf('const runDeltaFromPage'), source.indexOf('// Polishing (disput/polishing-pipeline.js)'));
    expect(glue).toContain('anonymizeParticipants: false');
    expect(glue).toContain("updateDebateModelCardOutput('Delta', delta.formatResult(result)");
    ['result_new.html', 'pipeline_panel.html'].forEach((page) => {
      expect(fs.readFileSync(path.join(__dirname, '..', page), 'utf8')).toContain('<script src="disput/delta-pipeline.js"></script>');
    });
  });
});
