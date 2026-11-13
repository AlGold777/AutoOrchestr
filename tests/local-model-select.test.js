/** @jest-environment jsdom */
const LocalModel = require('../disput/local-model');
const LocalModelSelect = require('../results/local-model-select');

const flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve)); };

describe('local model list', () => {
  let data;
  beforeEach(() => {
    data = {};
    window.chrome = { storage: { local: {
      get: async (key) => ({ [key]: data[key] }),
      set: async (value) => { Object.assign(data, value); }
    } } };
    LocalModel.setModel('');
    data = {};
  });
  afterEach(() => { delete window.chrome; });

  test('by default there is no model and nothing is switched on', () => {
    expect(LocalModel.MODELS[0]).toEqual({ id: '', label: 'without LLM' });
    expect(LocalModel.enabled()).toBe(false);
  });

  test('the chosen model goes into requests and is kept', () => {
    LocalModel.setModel('qwen3.5:9b-mlx');
    expect(LocalModel.enabled()).toBe(true);
    expect(LocalModel.buildRequest('текст').model).toBe('qwen3.5:9b-mlx');
    expect(data[LocalModel.CHOICE_KEY]).toBe('qwen3.5:9b-mlx');
    expect(LocalModel.setModel('unknown')).toBe('');
  });

  test('the list is filled, starts on without LLM and changes the model', async () => {
    document.body.innerHTML = '<select id="s"></select>';
    const select = document.getElementById('s');
    LocalModelSelect.mount(select, LocalModel);
    await flush();
    expect([...select.options].map((o) => o.textContent)).toEqual(['without LLM', 'Qwen 3.5 4B', 'Qwen 3.5 9B']);
    expect(select.value).toBe('');
    select.value = 'qwen3.5:4b-mlx';
    select.dispatchEvent(new Event('change'));
    expect(LocalModel.enabled()).toBe(true);
    expect(LocalModel.modelChoice()).toBe('qwen3.5:4b-mlx');
  });
});
