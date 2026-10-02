/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'content-scripts', 'perplexity-composer-transaction.js'), 'utf8');
const setRect = (element, { top = 0, left = 0, width = 300, height = 40 } = {}) => {
  element.getBoundingClientRect = () => ({ top, left, width, height, right: left + width, bottom: top + height });
};

describe('Perplexity composer transaction', () => {
  beforeEach(() => {
    delete window.PerplexityComposerTransaction;
    document.head.replaceChildren();
    document.body.replaceChildren();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    window.eval(SOURCE);
  });

  test('Send clicks the current draft control once and rejects stale, disabled or detached drafts', () => {
    document.body.innerHTML = '<form><textarea></textarea><button type="button" aria-label="Send">Send</button></form>';
    const composer = document.querySelector('textarea');
    const button = document.querySelector('button');
    setRect(composer); setRect(button);
    composer.value = '8 / 4';
    const clicked = jest.fn();
    button.addEventListener('click', clicked);
    const api = window.PerplexityComposerTransaction;
    expect(api.clickSend(composer, '8 / 4')).toEqual({ok:true, method:'dom_send_control_click'});
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(api.clickSend(composer, 'different prompt').ok).toBe(false);
    button.disabled = true;
    expect(api.clickSend(composer, '8 / 4').ok).toBe(false);
    button.disabled = false;
    composer.remove();
    expect(api.clickSend(composer, '8 / 4').ok).toBe(false);
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  test('editor-owned beforeinput inserts once without a second native insertion', async () => {
    document.body.innerHTML = '<div contenteditable="true">old draft</div>';
    const composer = document.querySelector('[contenteditable]');
    const prompt = 'Divide 144 by 12';
    const previous = document.execCommand;
    document.execCommand = jest.fn(() => { composer.textContent += prompt; return true; });
    composer.addEventListener('beforeinput', event => {
      event.preventDefault();
      composer.textContent = event.data;
    });
    try {
      const result = await window.PerplexityComposerTransaction.insert(composer, prompt, { sleep: async () => {} });
      expect(result.ok).toBe(true);
      expect(composer.textContent).toBe(prompt);
      expect(document.execCommand).not.toHaveBeenCalled();
    } finally { document.execCommand = previous; }
  });

  test('live replacement proves insertion even when the detached node reports failure', async () => {
    document.body.innerHTML = '<form><textarea></textarea><button type="submit">Send</button></form>';
    setRect(document.querySelector('textarea'));
    setRect(document.querySelector('button'));
    const prompt = 'Divide 144 by 12';
    const result = await window.PerplexityComposerTransaction.prepare({ doc: document, prompt,
      selectors: ['textarea'], sleep: async () => {}, attempts: 1,
      insertStrategy: async old => {
        const replacement = document.createElement('textarea');
        replacement.value = prompt;
        setRect(replacement);
        old.replaceWith(replacement);
        return { ok: false, reason: 'old_node_empty' };
      }
    });
    expect(result.ok).toBe(true);
    expect(result.composer).toBe(document.querySelector('textarea'));
    expect(result.history[0].nodeReplaced).toBe(true);
  });

  test('selects the composer owned by the search form instead of an extension editor', () => {
    document.body.innerHTML = `
      <aside id="llm-notes-sidebar"><div contenteditable="true" role="textbox"></div></aside>
      <form role="search"><textarea data-testid="search-input"></textarea><button type="submit">Send</button></form>`;
    const notes = document.querySelector('aside [contenteditable]');
    const composer = document.querySelector('textarea');
    const send = document.querySelector('button');
    setRect(notes, { top: 100 });
    setRect(composer, { top: 650, width: 700, height: 70 });
    setRect(send, { top: 660, left: 720, width: 40, height: 40 });

    const result = window.PerplexityComposerTransaction.resolveComposer(document);
    expect(result.element).toBe(composer);
    expect(result.diagnostics[0]).toEqual(expect.objectContaining({ inSearch: true, hasSendControl: true }));
  });

  test('fragmented prompt evidence requires exactly one head and one tail', () => {
    const tx = window.PerplexityComposerTransaction;
    const prompt = 'A sufficiently long current prompt whose two ends identify one dispatch.';
    const normalized = tx.normalize(prompt);
    const width = Math.min(32, Math.max(12, Math.floor(normalized.length / 3)));
    const fragmented = `${normalized.slice(0, width)} attachment.pdf ${normalized.slice(-width)}`;
    expect(tx.promptMatches(fragmented, prompt)).toBe(true);
    expect(tx.promptMatches(`${fragmented} ${fragmented}`, prompt)).toBe(false);
  });

  test('suppresses a parallel duplicate until the active dispatch finishes', () => {
    const gate = window.PerplexityComposerTransaction.createDispatchGate();
    const first = gate.begin({ dispatchId: 'd1', prompt: 'One provider request' });
    const duplicate = gate.begin({ dispatchId: 'd2', prompt: 'One provider request' });
    expect(first.accepted).toBe(true);
    expect(duplicate).toEqual(expect.objectContaining({
      accepted: false,
      duplicate: true,
      activeDispatchId: 'd1'
    }));
    expect(gate.finish(first.token)).toBe(true);
    expect(gate.begin({ dispatchId: 'd2', prompt: 'One provider request' }).accepted).toBe(true);
  });

  test('rejects a different prompt while another provider transaction is active', () => {
    const gate = window.PerplexityComposerTransaction.createDispatchGate();
    gate.begin({ dispatchId: 'd1', prompt: 'First prompt' });
    expect(gate.begin({ dispatchId: 'd2', prompt: 'Different prompt' })).toEqual(expect.objectContaining({
      accepted: false,
      duplicate: false,
      activeDispatchId: 'd1'
    }));
  });

  test('a dispatch of a later stage replaces a transaction that never settled (field report: stage 2 refused as busy)', () => {
    const gate = window.PerplexityComposerTransaction.createDispatchGate();
    const stage1 = gate.begin({ dispatchId: 'Perplexity:1790940815904:1', prompt: 'Stage one prompt' });
    // Same run start, different prompt: still a parallel request inside one run — refused.
    expect(gate.begin({ dispatchId: 'Perplexity:1790940815904:2', prompt: 'Another prompt of the same run' })).toEqual(expect.objectContaining({ accepted: false, duplicate: false }));
    // A later run start (the next stage): the stale transaction is replaced.
    const stage2 = gate.begin({ dispatchId: 'Perplexity:1790940858496:1', prompt: 'Stage two prompt' });
    expect(stage2).toEqual(expect.objectContaining({ accepted: true, supersededDispatchId: 'Perplexity:1790940815904:1' }));
    // The old request settling late can neither close nor disturb the new transaction.
    expect(gate.finish(stage1.token)).toBe(false);
    expect(gate.snapshot().dispatchId).toBe('Perplexity:1790940858496:1');
    expect(gate.finish(stage2.token)).toBe(true);
  });

  test('an older dispatch never replaces a newer transaction', () => {
    const gate = window.PerplexityComposerTransaction.createDispatchGate();
    gate.begin({ dispatchId: 'Perplexity:1790940858496:1', prompt: 'Newer' });
    expect(gate.begin({ dispatchId: 'Perplexity:1790940815904:1', prompt: 'Older and different' })).toEqual(expect.objectContaining({ accepted: false }));
  });

  test('rejects a page-sized promotion ancestor even when it contains upgrade text and an icon button', () => {
    const page = document.createElement('main');
    page.textContent = 'Upgrade your plan. Search and navigation content. '.repeat(80);
    const close = document.createElement('button');
    close.className = 'reset interactable select-none outline-none';
    close.innerHTML = '<svg></svg>';
    page.appendChild(close);
    document.body.appendChild(page);
    setRect(page, { top: 0, left: 0, width: 1200, height: 800 });
    setRect(close, { top: 10, left: 1150, width: 32, height: 32 });

    expect(window.PerplexityComposerTransaction.findOwnedPromotionClose(document)).toBeNull();
  });

  test('accepts a compact explicitly-owned promotion dialog', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.textContent = 'Try Perplexity Pro';
    const close = document.createElement('button');
    close.setAttribute('aria-label', 'Close');
    dialog.appendChild(close);
    document.body.appendChild(dialog);
    setRect(dialog, { top: 120, left: 300, width: 500, height: 300 });
    setRect(close, { top: 130, left: 750, width: 32, height: 32 });

    expect(window.PerplexityComposerTransaction.findOwnedPromotionClose(document)).toEqual({ button: close, container: dialog });
  });

  test('reacquires a replaced composer and requires its scoped Send control', async () => {
    document.body.innerHTML = '<form role="search"><textarea data-testid="search-input"></textarea><button type="submit">Send</button></form>';
    let composer = document.querySelector('textarea');
    const send = document.querySelector('button');
    setRect(composer, { top: 650, width: 700, height: 70 });
    setRect(send, { top: 660, left: 720, width: 40, height: 40 });
    const prompt = 'Explain why this draft belongs to the current transaction.';

    const result = await window.PerplexityComposerTransaction.prepare({
      doc: document,
      prompt,
      attempts: 1,
      settleMs: 0,
      sleep: () => Promise.resolve(),
      insertStrategy: async (oldComposer) => {
        const replacement = oldComposer.cloneNode();
        replacement.value = prompt;
        setRect(replacement, { top: 650, width: 700, height: 70 });
        oldComposer.replaceWith(replacement);
        composer = replacement;
        return { ok: true, method: 'framework_replacement' };
      }
    });

    expect(result).toEqual(expect.objectContaining({ ok: true, composer, sendControl: send }));
    expect(result.history[0]).toEqual(expect.objectContaining({ nodeReplaced: true, sendControlReady: true }));
  });

  test('does not accept visible prompt text when the scoped Send control is absent', async () => {
    document.body.innerHTML = '<form role="search"><textarea data-testid="search-input"></textarea></form>';
    const composer = document.querySelector('textarea');
    setRect(composer, { top: 650, width: 700, height: 70 });

    const result = await window.PerplexityComposerTransaction.prepare({
      doc: document,
      prompt: 'Draft without application acknowledgement',
      attempts: 1,
      settleMs: 0,
      sleep: () => Promise.resolve()
    });

    expect(result).toEqual(expect.objectContaining({ ok: false, reason: 'send_control_not_ready' }));
  });

  test('rich editor insertion uses the editor transaction before any DOM fallback', async () => {
    document.body.innerHTML = '<form role="search"><div contenteditable="true" role="textbox"></div><button type="submit">Send</button></form>';
    const composer = document.querySelector('[contenteditable]');
    const prompt = 'Rich editor transaction payload';
    setRect(composer, { top: 650, width: 700, height: 70 });
    setRect(document.querySelector('button'), { top: 660, left: 720, width: 40, height: 40 });
    const originalExecCommand = document.execCommand;
    document.execCommand = jest.fn((command, _ui, value) => {
      if (command === 'delete') composer.textContent = '';
      if (command === 'insertText') composer.textContent = String(value || '');
      return true;
    });

    const result = await window.PerplexityComposerTransaction.insert(composer, prompt, {
      sleep: () => Promise.resolve(), settleMs: 0
    });

    expect(result).toEqual(expect.objectContaining({ ok: true, method: 'beforeinput_exec_command' }));
    expect(document.execCommand).toHaveBeenCalledWith('insertText', false, prompt);
    document.execCommand = originalExecCommand;
  });

  // 2.81.120 field regression: the live composer reported inForm:false and
  // inSearch:false, so the scope collapsed to composer.parentElement and the Send
  // control — which sits further up the tree — was never found. Every attempt
  // recorded hasSendControl:false and a correctly inserted draft was rejected.
  test('finds the Send control when it lives outside the composer parent', () => {
    document.body.innerHTML = `
      <div id="shell">
        <div id="row">
          <div id="editor-wrap"><div contenteditable="true" role="textbox"></div></div>
          <div id="actions"><button aria-label="Send message"></button></div>
        </div>
      </div>`;
    const composer = document.querySelector('[contenteditable]');
    const sendButton = document.querySelector('button');
    setRect(composer, { top: 285, left: 269, width: 686, height: 236 });
    setRect(sendButton, { top: 480, left: 960, width: 40, height: 40 });

    // Precondition: the defect's shape — no form/search/composer ancestor.
    expect(composer.closest('form,[role="search"],[data-testid*="composer" i]')).toBeNull();
    expect(composer.parentElement.querySelector('button')).toBeNull();

    expect(window.PerplexityComposerTransaction.resolveSendControl(composer)).toBe(sendButton);
  });

  test('does not reach an unrelated Send control far outside the composer', () => {
    document.body.innerHTML = `
      <div id="far"><button aria-label="Send feedback"></button></div>
      <div><div><div><div><div><div><div>
        <div contenteditable="true" role="textbox"></div>
      </div></div></div></div></div></div></div>`;
    const composer = document.querySelector('[contenteditable]');
    setRect(composer, { top: 285, left: 269, width: 686, height: 236 });
    setRect(document.querySelector('button'), { top: 10, left: 10, width: 40, height: 40 });

    expect(window.PerplexityComposerTransaction.resolveSendControl(composer)).toBeNull();
  });

  // 2.81.122 field regression: on a tab whose focus was taken mid-insert,
  // execCommand('insertText') returned true while inserting nothing. The old
  // guard trusted that return value, so the range fallback never ran and the
  // draft stayed empty — history showed insertMethod beforeinput_exec_command
  // together with inserted:false on all three attempts.
  test('falls back to range insertion when execCommand lies about success', async () => {
    document.body.innerHTML = '<div contenteditable="true" role="textbox"></div>';
    const composer = document.querySelector('[contenteditable]');
    const prompt = 'Focus-less insertion payload';
    setRect(composer, { top: 253, left: 309, width: 606, height: 240 });
    const originalExecCommand = document.execCommand;
    // Reports success, changes nothing — exactly the unfocused-tab behaviour.
    document.execCommand = jest.fn(() => true);

    const result = await window.PerplexityComposerTransaction.insert(composer, prompt, {
      sleep: () => Promise.resolve(), settleMs: 0
    });

    expect(result.ok).toBe(true);
    expect(result.method).toBe('beforeinput_range');
    expect(composer.textContent).toContain(prompt);
    document.execCommand = originalExecCommand;
  });

  test('reads a contenteditable draft even when innerText is unavailable', () => {
    document.body.innerHTML = '<div contenteditable="true" role="textbox"></div>';
    const composer = document.querySelector('[contenteditable]');
    const prompt = 'Background tab draft payload';
    composer.textContent = prompt;
    // jsdom leaves innerText undefined; a real background tab can report it empty
    // because it depends on layout. textContent must still satisfy the match.
    Object.defineProperty(composer, 'innerText', { configurable: true, value: '' });

    expect(window.PerplexityComposerTransaction.promptMatches(
      window.PerplexityComposerTransaction.read(composer), prompt
    )).toBe(true);
  });
});
