/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');

class Channel {
  constructor() {
    this.port1 = { onmessage: null };
    this.port2 = { postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0) };
  }
}

beforeAll(() => {
  global.MessageChannel = Channel;
  global.PointerEvent = class extends MouseEvent {};
  Element.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, width: 10, height: 10 };
  };
  require('../content-scripts/platform-mode-setter.js');
});

beforeEach(() => { document.body.innerHTML = ''; });

describe('режимы сайтов перед отправкой', () => {
  test('DeepSeek: DeepThink включается, Search выключается', async () => {
    document.body.innerHTML = `
      <div class="ds-toggle-button" aria-pressed="false">DeepThink</div>
      <div class="ds-toggle-button" aria-pressed="true">Search</div>`;
    document.querySelectorAll('.ds-toggle-button').forEach((el) => el.addEventListener('click', () => {
      el.setAttribute('aria-pressed', String(el.getAttribute('aria-pressed') !== 'true'));
    }));
    const result = await window.PlatformModeSetter.ensure('chat.deepseek.com');
    expect(result.ok).toBe(true);
    expect(result.steps.map((step) => [step.label, step.before, step.after])).toEqual([
      ['DeepThink on', 'false', 'true'], ['Search off', 'true', 'false']
    ]);
  });

  test('уже выставленный режим не трогается', async () => {
    document.body.innerHTML = '<button id="model-select-trigger">Build Beta</button>';
    let opened = false;
    document.querySelector('button').addEventListener('click', () => { opened = true; });
    const result = await window.PlatformModeSetter.ensure('grok.com');
    expect(result.ok).toBe(true);
    expect(result.steps[0].changed).toBe(false);
    expect(opened).toBe(false);
  });

  test('Z.ai: выбирается GLM-5.3, а не Flash, и результат сверяется по странице', async () => {
    document.body.innerHTML = '<button class="modelSelectorButton">GLM-5.3-Flash</button>';
    const trigger = document.querySelector('button');
    trigger.addEventListener('pointerdown', () => {
      const item = document.createElement('button');
      item.setAttribute('aria-label', 'model-item');
      item.dataset.value = 'glm-5.3';
      item.addEventListener('click', () => { trigger.textContent = 'GLM-5.3'; });
      document.body.appendChild(item);
    });
    const result = await window.PlatformModeSetter.ensure('chat.z.ai');
    expect(result.ok).toBe(true);
    expect(result.steps[0]).toMatchObject({ before: 'GLM-5.3-Flash', after: 'GLM-5.3', changed: true });
  });

  test('нет нужного пункта: режим не считается выставленным', async () => {
    document.body.innerHTML = '<button id="model-select-trigger">Быстрый</button>';
    const result = await window.PlatformModeSetter.ensure('grok.com');
    expect(result.ok).toBe(false);
    expect(result.steps[0].reason).toBe('item_not_found');
  }, 10000);

  test('сайт без заданных режимов проходит без действий', async () => {
    await expect(window.PlatformModeSetter.ensure('gemini.google.com')).resolves.toMatchObject({ ok: true, steps: [] });
  });
});

describe('подключение к отправке', () => {
  const dispatch = fs.readFileSync(path.join(__dirname, '..', 'background', 'dispatch-coordinator.js'), 'utf8');

  test('оба пути отправки проверяют режим до команды GET_ANSWER', () => {
    const calls = dispatch.split('await ensurePlatformModeForDispatch(llmName, tabId, entry)').length - 1;
    expect(calls).toBe(2);
    const first = dispatch.indexOf('await ensurePlatformModeForDispatch', dispatch.indexOf('async function dispatchSimpleFirstPass'));
    expect(first).toBeLessThan(dispatch.indexOf("{type: 'GET_ANSWER', prompt, attachments, meta}"));
    const second = dispatch.indexOf('await ensurePlatformModeForDispatch', first + 1);
    expect(second).toBeLessThan(dispatch.indexOf('const answerCommand = {'));
  });

  test('режим выставляется только участникам Basic, отказ завершает запрос участника', () => {
    expect(dispatch).toContain('!self.isActiveBasicParticipant?.(llmName)');
    expect(fs.readFileSync(path.join(__dirname, '..', 'background', 'job-orchestrator.js'), 'utf8')).toContain('self.isActiveBasicParticipant =');
    expect(dispatch).toContain("type: 'platform_mode_not_set'");
  });

  test('Circle идёт без списка участников, но режимы сайтов выставляются', () => {
    const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const page = read('results.js');
    const bridge = page.slice(page.indexOf('window.TheCycleMainPageBridge'), page.indexOf('async reread(request)', page.indexOf('window.TheCycleMainPageBridge')));
    expect(bridge).toContain('platformModes: true');
    const background = read('background/job-orchestrator.js');
    expect(background).toContain('activePlatformModeRun = pipelineContext?.platformModes === true;');
    expect(background).toContain('activePlatformModeRun || Boolean(activeParticipantRequests[llmName])');
  });

  test('Qwen is set to Qwen4-Max (the site renamed Qwen4-Max-Preview, 2026-11-25), not to the older default', () => {
    const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'content-scripts', 'platform-mode-setter.js'), 'utf8');
    expect(source).toContain("pillStep('Qwen4-Max', () => document.querySelector('.wms-trigger'), /qwen4-max/i, '[role=\"option\"]', /^qwen4-max/i)");
    expect(/^qwen4-max/i.test('Qwen4-MaxУстановить по умолчаниюФлагманская модель')).toBe(true);
    expect(/^qwen4-max/i.test('Qwen3.8-MaxУстановить по умолчанию')).toBe(false);
    expect(source).not.toMatch(/qwen3\\\.8-max/i);
  });
});
