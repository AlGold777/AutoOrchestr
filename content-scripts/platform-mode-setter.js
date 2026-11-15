// Sets the mode each model site must be in for a Basic run (docs/Run Automation/model-modes.md)
// and verifies it on the page. Injected right before a prompt goes out; also used by the manual tab.sh.
(function () {
  if (globalThis.PlatformModeSetter) return;

  // setTimeout is throttled in a hidden tab; a message channel is not.
  const tick = () => new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(0);
  });
  const until = async (read, ms = 4000) => {
    const end = Date.now() + ms;
    for (;;) {
      const value = read();
      if (value || Date.now() >= end) return value;
      await tick();
    }
  };
  const visible = (el) => {
    const rect = el?.getBoundingClientRect?.();
    return Boolean(rect && rect.width > 0 && rect.height > 0);
  };
  const textOf = (el) => String(el?.innerText || el?.textContent || '').trim().replace(/\s+/g, ' ');
  const all = (selector) => Array.from(document.querySelectorAll(selector)).filter(visible);
  const last = (list) => list[list.length - 1] || null;

  const pointer = (el, names) => {
    const rect = el.getBoundingClientRect();
    const base = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, detail: 1,
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
      pointerId: 1, pointerType: 'mouse', isPrimary: true };
    names.forEach((name) => {
      const Event_ = name.startsWith('pointer') ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Event_(name, { ...base, buttons: /down/.test(name) ? 1 : 0 }));
    });
  };
  const clickEl = (el) => pointer(el, ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
  const pressDown = (el) => pointer(el, ['pointerdown', 'mousedown']);
  const key = (el, name, code) => {
    const init = { key: name, code: name, keyCode: code, which: code, bubbles: true, cancelable: true, composed: true };
    el.dispatchEvent(new KeyboardEvent('keydown', init));
    el.dispatchEvent(new KeyboardEvent('keyup', init));
  };
  const arrowOpen = (el) => {
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, bubbles: true, cancelable: true }));
  };
  const openMenus = () => all('[role="menu"],[role="listbox"]').filter((m) => m.getAttribute('data-state') !== 'closed');
  const closeMenus = () => {
    if (!openMenus().length) return;
    key(document.activeElement || document.body, 'Escape', 27);
  };
  const itemIn = (selector, match) => all(selector).find((el) => match.test(textOf(el))) || null;

  const pickItem = (open, findItem) => async (trigger) => {
    open(trigger);
    const item = await until(findItem);
    if (!item) { closeMenus(); return 'item_not_found'; }
    clickEl(item);
    return '';
  };

  const pillStep = (label, findTrigger, wanted, itemSelector, itemMatch, open = clickEl) => ({
    label,
    trigger: findTrigger,
    read: (el) => textOf(el) || el.getAttribute('aria-label') || '',
    isSet: (value) => wanted.test(value),
    apply: pickItem(open, () => (typeof itemSelector === 'function' ? itemSelector() : itemIn(itemSelector, itemMatch)))
  });

  const deepseekToggle = (name, wanted) => ({
    label: `${name} ${wanted ? 'on' : 'off'}`,
    trigger: () => all('.ds-toggle-button').find((el) => textOf(el).toLowerCase() === name.toLowerCase()) || null,
    read: (el) => el.getAttribute('aria-pressed') || '',
    isSet: (value) => value === String(wanted),
    apply: async (el) => { el.click(); return ''; }
  });

  const gptTrigger = () => last(all('button[aria-haspopup="menu"][aria-label*="ChatGPT"]'));
  const gptHigh = /высок|high/i;
  const gpt = [{
    label: 'reasoning High',
    trigger: gptTrigger,
    read: textOf,
    isSet: (value) => gptHigh.test(value),
    apply: async (trigger) => {
      clickEl(trigger);
      const slider = await until(() => all('[role="menu"] [role="slider"]')[0] || null);
      if (!slider) { closeMenus(); return 'effort_control_not_found'; }
      slider.focus();
      for (let i = 0; i < 3 && slider.getAttribute('aria-valuenow') !== slider.getAttribute('aria-valuemax'); i += 1) {
        key(slider, 'ArrowRight', 39);
        await until(() => false, 200);
      }
      closeMenus();
      return '';
    }
  }];

  const qwenThinkingLabel = () => all('.qwen-chat-v2-dropdown-menu-select-label')
    .find((el) => /^(авто|мышлени|быстр|auto|think|fast)/i.test(textOf(el))) || null;
  const perplexity = [pillStep('Kimi K3 Thinking',
    () => last(all('button[aria-haspopup="menu"]').filter((el) => textOf(el))),
    /kimi k3/i, '[role="menuitemradio"]', /^kimi k3/i)];

  const SITES = {
    'chatgpt.com': gpt,
    'chat.openai.com': gpt,
    'claude.ai': [pillStep('Sonnet 5.5', () => document.querySelector('[data-testid="model-selector-dropdown"]'),
      /sonnet 5\.5/i, () => document.querySelector('[role="menuitemradio"][data-model-id="claude-sonnet-5-5"]'), null, arrowOpen)],
    'chat.deepseek.com': [deepseekToggle('DeepThink', true), deepseekToggle('Search', false)],
    'chat.qwen.ai': [
      pillStep('Qwen4-Max-Preview', () => document.querySelector('.wms-trigger'), /qwen4-max-preview/i, '[role="option"]', /^qwen4-max-preview/i),
      pillStep('thinking on', qwenThinkingLabel, /мышлен|think/i, '[role="menu"] [role="menuitem"]', /^(мышлени|think)/i)
    ],
    'www.perplexity.ai': perplexity,
    'perplexity.ai': perplexity,
    'chat.mistral.ai': [pillStep('Think',
      () => all('button[aria-haspopup="menu"]').find((el) => /^(think|fast)/i.test(textOf(el))) || null,
      /^think/i, '[role="menu"] [role="menuitem"]', /^think/i)],
    'chat.z.ai': [pillStep('GLM-5.3', () => document.querySelector('button.modelSelectorButton'),
      /^glm-5\.3$/i, () => document.querySelector('button[aria-label="model-item"][data-value="glm-5.3"]'), null, pressDown)],
    'grok.com': [pillStep('Build', () => document.querySelector('#model-select-trigger'),
      /build/i, '[role="menuitemradio"]', /^build/i)]
  };

  const runStep = async (step) => {
    const trigger = await until(step.trigger, 8000);
    if (!trigger) return { label: step.label, ok: false, reason: 'control_not_found' };
    const before = step.read(trigger);
    if (step.isSet(before)) return { label: step.label, ok: true, before, after: before, changed: false };
    const reason = await step.apply(trigger);
    if (reason) return { label: step.label, ok: false, before, reason };
    const set = await until(() => {
      const current = step.trigger();
      return current && step.isSet(step.read(current));
    });
    const after = step.read(step.trigger() || trigger);
    closeMenus();
    return set
      ? { label: step.label, ok: true, before, after, changed: true }
      : { label: step.label, ok: false, before, after, reason: 'not_confirmed' };
  };

  globalThis.PlatformModeSetter = {
    ensure: async (host = location.hostname) => {
      const steps = [];
      for (const step of SITES[host] || []) steps.push(await runStep(step));
      return { ok: steps.every((step) => step.ok), host, steps };
    }
  };
})();
