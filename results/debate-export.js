// Debate HTML/TXT export service; independent from runtime orchestration.
(function initDebateExport(root) {
  'use strict';

  const escape = (value = '') => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const stamp = (date = new Date()) => {
    const pad = (num) => String(num).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
  };

  const fileStamp = (date = new Date()) => {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const pad = (num) => String(num).padStart(2, '0');
    return `${months[date.getMonth()]}${String(date.getFullYear()).slice(-2)} ${pad(date.getHours())}-${pad(date.getMinutes())}`;
  };

  const cardFileStamp = (date = new Date()) => fileStamp(date).replace(':', '-');

  const savedStamp = (date = new Date()) => {
    const pad = (num) => String(num).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
  };

  function sanitizeFragment(raw) {
    if (typeof root.sanitizeHTML === 'function') return root.sanitizeHTML(String(raw || ''));
    if (typeof DOMParser === 'undefined') return escape(raw);
    const parsed = new DOMParser().parseFromString(String(raw || ''), 'text/html');
    parsed.querySelectorAll('script,style,iframe,object,embed').forEach((node) => node.remove());
    parsed.querySelectorAll('*').forEach((node) => {
      Array.from(node.attributes || []).forEach((attr) => {
        if (/^on/i.test(attr.name) || (/^(href|src)$/i.test(attr.name) && /^\s*javascript:/i.test(attr.value))) {
          node.removeAttribute(attr.name);
        }
      });
    });
    return parsed.body.innerHTML;
  }

  function responseTimestamp(value) {
    if (!value) return '';
    const date = new Date(/^\d+$/.test(String(value)) ? Number(value) : value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (number) => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}`;
  }

  function cardParts(card) {
    const outputEl = card?.querySelector?.('.debate-model-card-output');
    const rawHtml = outputEl ? sanitizeFragment(String(outputEl.innerHTML || '').trim()) : '';
    const plain = outputEl ? String(outputEl.innerText || outputEl.textContent || '').trim() : '';
    const body = rawHtml || (plain ? `<pre>${escape(plain)}</pre>` : '');
    if (!body) return null;
    return {
      model: String(card.dataset.llmName || card.querySelector('.debate-model-card-name')?.textContent || 'Model').trim() || 'Model',
      time: String(card.querySelector('.debate-model-card-time')?.textContent || '').trim(),
      metadata: [responseTimestamp(card.dataset.responseTimestamp), String(card.dataset.sourceUrl || '').trim()].filter(Boolean).join('  '),
      plain,
      round: String(card.dataset.pipelineRoundId || '').trim().toLowerCase(),
      body
    };
  }

  const heading = ({ model, time }, tag = 'h2') => `<${tag}>${escape(model)}${time ? ` <span class="response-time">${escape(time)}</span>` : ''}</${tag}>`;
  const section = (card) => {
    const parts = cardParts(card);
    return parts ? `<section>${heading(parts)}<div class="response-body">${parts.body}</div></section>` : '';
  };

  // Serialized into exports: keep this function independent of extension APIs.
  function initReportAnnotations() {
    if (window.__hlInit) return;
    const report = document.getElementById('report');
    if (!report) return;
    window.__hlInit = true;
    const skip = '#hl-favs,[data-hl-ui],nav,button,script,style,textarea,input,select,[hidden]';
    const colors = ['#fff176', '#a5d6a7', '#81d4fa', '#f48fb1', '#ffcc80'];
    let color = colors[0], range = null, point = null, frame = 0, handle = null, saving = false;
    if (!document.getElementById('hl-style')) {
      const style = document.createElement('style');
      style.id = 'hl-style';
      style.textContent = `mark.hl{color:inherit!important;border-radius:2px}.hl-flash{outline:2px solid red!important}#hl-favs{background:#fff;color:#222;border:1px solid #ddd;border-radius:8px;padding:16px;margin:0 0 24px}#hl-favs[hidden]{display:none}#hl-favs h2{margin:0 0 12px}#hl-favs article{border-left:5px solid;padding:8px 12px;margin:12px 0}#hl-favs .hl-note{white-space:pre-wrap;overflow-wrap:anywhere;user-select:text}#hl-favs a{color:#195b9b}#hl-favs button{margin-left:12px;cursor:pointer}#hl-toolbar{position:fixed;z-index:2147483647;display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px;background:#fff;color:#222;border:1px solid #bbb;border-radius:8px;box-shadow:0 3px 16px #0003;max-width:calc(100vw - 16px);box-sizing:border-box;font:14px Arial,sans-serif;color-scheme:light}#hl-toolbar[hidden]{display:none}#hl-toolbar button{border:1px solid #aaa;border-radius:4px;min-height:30px;cursor:pointer;color:#222;font:inherit}#hl-toolbar .hl-color{width:28px}#hl-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:10px 18px;border-radius:8px;background:#222;color:#fff;z-index:2147483647;font:14px Arial,sans-serif}`;
      document.head.append(style);
    }
    const favs = document.getElementById('hl-favs') || document.createElement('section');
    favs.id = 'hl-favs';
    report.prepend(favs);
    const toolbar = document.createElement('div');
    toolbar.id = 'hl-toolbar'; toolbar.dataset.hlUi = ''; toolbar.hidden = true;
    toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', 'Выделение текста');
    function button(label, action, background) {
      const el = document.createElement('button');
      el.type = 'button'; el.textContent = label;
      if (background) {
        el.className = 'hl-color'; el.style.background = background;
        el.setAttribute('aria-label', 'Подсветить: ' + background);
      }
      el.addEventListener('mousedown', (event) => event.preventDefault());
      el.addEventListener('click', action); toolbar.append(el);
    }
    colors.forEach((value) => button(' ', () => apply('color', value), value));
    button('★ В избранное', () => apply('favorite'));
    button('✕ Снять подсветку', () => apply('remove'));
    document.body.append(toolbar);
    const marks = () => [...report.querySelectorAll('mark.hl[data-fav]')];
    const allowed = (node) => {
      const el = node.nodeType === 1 ? node : node.parentElement;
      return el && report.contains(el) && !el.closest(skip);
    };
    function forget(id) {
      marks().filter((mark) => mark.dataset.fav === id).forEach((mark) => {
        delete mark.dataset.fav; delete mark.dataset.favText; mark.removeAttribute('id');
      });
    }
    function rebuild() {
      const groups = new Map();
      marks().forEach((mark) => {
        const id = mark.dataset.fav;
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id).push(mark);
      });
      favs.replaceChildren(); favs.hidden = !groups.size;
      const title = document.createElement('h2'); title.textContent = '★ Избранное (' + groups.size + ')';
      favs.append(title);
      groups.forEach((items, id) => {
        const text = items.find((mark) => mark.hasAttribute('data-fav-text'))?.dataset.favText
          || items.map((mark) => mark.textContent).join('');
        items.forEach((mark) => { mark.removeAttribute('id'); delete mark.dataset.favText; });
        items[0].id = 'hl-' + id; items[0].dataset.favText = text;
        const item = document.createElement('article'); item.style.borderColor = items[0].style.background;
        const note = document.createElement('div'); note.className = 'hl-note'; note.textContent = text;
        const link = document.createElement('a'); link.href = '#hl-' + id; link.textContent = '↗ к месту в тексте';
        link.addEventListener('click', (event) => {
          event.preventDefault();
          const target = items[0];
          const card = target.closest('.feed-response'); if (card) card.hidden = false;
          const prompt = target.closest('.export-prompt'); if (prompt) prompt.classList.remove('is-collapsed');
          target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
          items.forEach((mark) => mark.classList.add('hl-flash'));
          setTimeout(() => items.forEach((mark) => mark.classList.remove('hl-flash')), 1500);
        });
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '✕';
        remove.setAttribute('aria-label', 'Убрать из избранного');
        remove.addEventListener('click', () => { forget(id); rebuild(); });
        item.append(note, link, remove); favs.append(item);
      });
    }
    function selectedNodes(active) {
      const walker = document.createTreeWalker(report, NodeFilter.SHOW_TEXT);
      const result = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!allowed(node) || !active.intersectsNode(node)) continue;
        const start = node === active.startContainer ? active.startOffset : 0;
        const end = node === active.endContainer ? active.endOffset : node.length;
        if (end > start) result.push({ node, start, end });
      }
      return result;
    }
    function apply(action, value) {
      if (!range || !allowed(range.startContainer) || !allowed(range.endContainer)) return;
      const text = window.getSelection().toString();
      const nodes = selectedNodes(range);
      if (!nodes.length) return;
      const touched = [...new Set(nodes.map(({ node }) => node.parentElement.closest('mark.hl')).filter(Boolean))];
      if (action === 'remove' || action === 'favorite') {
        new Set(touched.map((mark) => mark.dataset.fav).filter(Boolean)).forEach(forget);
      }
      if (action === 'remove') {
        touched.forEach((mark) => { const parent = mark.parentNode; mark.replaceWith(...mark.childNodes); parent.normalize(); });
      } else {
        if (value) color = value;
        const id = action === 'favorite' ? 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) : null;
        const favoriteText = new Map(marks().filter((mark) => mark.hasAttribute('data-fav-text')).map((mark) => [mark.dataset.fav, mark.dataset.favText]));
        nodes.forEach(({ node, start, end }) => {
          const old = node.parentElement.closest('mark.hl');
          if (end < node.length) node.splitText(end);
          const selected = start ? node.splitText(start) : node;
          const mark = document.createElement('mark'); mark.className = 'hl';
          mark.style.background = action === 'favorite' && old ? old.style.background : color;
          const fav = id || old?.dataset.fav;
          if (fav) mark.dataset.fav = fav;
          if (old) {
            const pieces = [...old.childNodes].map((child) => {
              if (child === selected) { mark.append(child); return mark; }
              const copy = old.cloneNode(false); copy.removeAttribute('id'); delete copy.dataset.favText;
              copy.append(child); return copy;
            });
            old.replaceWith(...pieces);
          } else { selected.replaceWith(mark); mark.append(selected); }
        });
        favoriteText.forEach((fullText, fav) => {
          const first = marks().find((mark) => mark.dataset.fav === fav);
          if (first) first.dataset.favText = fullText;
        });
        if (id) marks().find((mark) => mark.dataset.fav === id).dataset.favText = text;
      }
      window.getSelection().removeAllRanges(); range = null; toolbar.hidden = true; rebuild();
    }
    function position() {
      if (!range || toolbar.hidden) return;
      const rects = range.getClientRects?.();
      const end = rects?.[rects.length - 1] || range.getBoundingClientRect?.();
      const x = point ? point.x : end?.right || 0, y = point ? point.y : end?.bottom || 0;
      const box = toolbar.getBoundingClientRect();
      const left = x + 20 + box.width <= innerWidth - 8 ? x + 20 : x - 20 - box.width;
      toolbar.style.left = Math.max(8, Math.min(left, innerWidth - box.width - 8)) + 'px';
      toolbar.style.top = Math.max(8, Math.min(y - box.height / 2, innerHeight - box.height - 8)) + 'px';
    }
    function show(event) {
      if (toolbar.contains(event?.target)) return;
      const selection = window.getSelection();
      if (!selection.rangeCount || selection.isCollapsed) { toolbar.hidden = true; range = null; return; }
      const active = selection.getRangeAt(0);
      if (!allowed(active.startContainer) || !allowed(active.endContainer)) { toolbar.hidden = true; range = null; return; }
      range = active.cloneRange();
      point = event?.type === 'mouseup' ? { x: event.clientX, y: event.clientY } : null;
      toolbar.hidden = false; position();
    }
    document.addEventListener('mouseup', show);
    document.addEventListener('touchend', show);
    document.addEventListener('keyup', (event) => { if (event.key !== 'Control' && event.key !== 'Meta') show(event); });
    document.addEventListener('selectionchange', () => {
      const sel = window.getSelection();
      if (!sel.rangeCount || sel.isCollapsed || !allowed(sel.anchorNode) || !allowed(sel.focusNode)) {
        toolbar.hidden = true; range = null;
      }
    });
    function schedule() {
      point = null;
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; position(); });
    }
    window.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule);
    function toast(text) {
      document.getElementById('hl-toast')?.remove();
      const el = document.createElement('div'); el.id = 'hl-toast'; el.dataset.hlUi = ''; el.setAttribute('role', 'status'); el.textContent = text;
      document.body.append(el); setTimeout(() => el.remove(), 1800);
    }
    async function save() {
      if (saving) return;
      saving = true;
      const filename = (decodeURIComponent(location.pathname.split('/').pop() || '') || document.title || 'Отчёт')
        .replace(/(?:_annotated)?\.html?$/i, '').replace(/[\\/:*?"<>|]/g, '_') + '_annotated.html';
      const serialize = () => {
        const clone = document.documentElement.cloneNode(true);
        clone.querySelectorAll('[data-hl-ui]').forEach((node) => node.remove());
        clone.querySelectorAll('.hl-flash').forEach((node) => node.classList.remove('hl-flash'));
        return '<!DOCTYPE html>\n' + clone.outerHTML;
      };
      try {
        if (window.showSaveFilePicker) {
          try {
            handle = handle || await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'HTML', accept: { 'text/html': ['.html'] } }] });
            const stream = await handle.createWritable(); await stream.write(serialize()); await stream.close(); toast('Сохранено'); return;
          } catch (error) { if (error.name === 'AbortError') return; handle = null; }
        }
        const url = URL.createObjectURL(new Blob([serialize()], { type: 'text/html;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Скачано копией');
      } catch (_) { toast('Не удалось сохранить файл'); }
      finally { saving = false; }
    }
    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); }
    });
    rebuild();
  }

  const documentHtml = (title, bodyHtml, date = new Date(), showHeader = true) => `<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8"><title>${escape(title)}</title><style>
body{font-family:Arial,sans-serif;background:#fff;color:#111;padding:24px;line-height:1.5}section{margin-bottom:24px}h1{font-size:24px;margin:0 0 4px}h2{margin:0 0 12px;font-size:20px}pre{background:#f6f8fa;padding:12px;border-radius:8px;white-space:pre-wrap;word-wrap:break-word}.response-body{background:#f8fafc;padding:12px;border-radius:8px}.response-body table{width:100%;border-collapse:collapse;margin:8px 0}.response-body th,.response-body td{border:1px solid #ddd;padding:6px 8px;vertical-align:top}.response-body ul,.response-body ol{padding-left:24px}.response-time,.saved-at{color:#555;font-size:14px;font-weight:400}.saved-at{margin:0 0 16px}
</style></head><body><div id="report">${showHeader ? `<h1>${escape(title)}</h1><p class="saved-at">${savedStamp(date)}</p>` : ''}${bodyHtml}</div><script>(${initReportAnnotations.toString()})();</script></body></html>`;

  // Session identity defines export scope; temporary display filters must not lose cards.
  function feedParts(feed, activeSessionId = '1') {
    return Array.from(feed?.querySelectorAll('.debate-model-card') || [])
      .filter((card) => card.dataset.sessionId === String(activeSessionId))
      .map(cardParts).filter(Boolean);
  }

  function collectFeedHtml(feed, activeSessionId = '1') {
    return feedParts(feed, activeSessionId).map((parts) =>
      `<section>${heading(parts)}<div class="response-body">${parts.body}</div></section>`).join('\n');
  }

  const responseSeparator = Array(3).fill('=========================================================').join('\n');

  function buildFeedText(feed, activeSessionId = '1') {
    return feedParts(feed, activeSessionId).map((parts) => [
      `${parts.model}${parts.round ? ` ${parts.round.toUpperCase()}` : ''}${parts.time ? ` ${parts.time}` : ''}`,
      parts.plain
    ].join('\n')).join(`\n\n${responseSeparator}\n\n`);
  }

  function buildFeedDocument(feed, activeSessionId = '1', title = 'Debate Feed', modelIcons = {}, promptText = '') {
    const parts = feedParts(feed, activeSessionId);
    if (!parts.length) return '';
    const models = [...new Set(parts.map((part) => part.model))];
    const rounds = [...new Set(parts.map((part) => part.round).filter(Boolean))];
    const button = (kind, value, icon, label) => `<button type="button" class="feed-nav-button" data-view="${kind}" data-value="${escape(value)}" aria-pressed="false" title="${escape(label)}">${icon}<span>${escape(label)}</span></button>`;
    const modelButtons = models.map((model) => {
      // Only bundled data images are embedded: the saved file works offline.
      const icon = /^data:image\/(?:svg\+xml|png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(modelIcons[model] || '')
        ? `<span class="model-nav-icon" style="--model-icon:url('${modelIcons[model]}')" aria-hidden="true"></span>`
        : `<span class="nav-symbol" aria-hidden="true">${escape(model.slice(0, 1))}</span>`;
      return button('model', model, icon, model);
    }).join('');
    const roundButtons = rounds.map((round) => button('round', round,
      `<span class="nav-symbol" aria-hidden="true">${escape(round.toUpperCase())}</span>`, round.toUpperCase())).join('');
    const navigation = `<nav class="feed-navigation" aria-label="Feed views">
      ${button('all', '', '<span class="nav-symbol" aria-hidden="true">⌂</span>', 'All')}
      <div class="nav-group" role="group" aria-label="Models">${modelButtons}</div>
      <div class="nav-group" role="group" aria-label="Rounds">${roundButtons}</div>
    </nav>`;
    const prompt = String(promptText || '').trim();
    const promptBlock = `<section class="prompt-section">
      <div class="prompt-heading">${prompt ? '<h2>Prompt</h2>' : ''}<span class="saved-at">${savedStamp()}</span>${prompt ? '<button type="button" class="prompt-toggle" hidden aria-expanded="false">Show more</button>' : ''}</div>
      ${prompt ? `<pre class="export-prompt is-collapsed">${escape(prompt)}</pre>` : ''}
    </section>`;
    const body = parts.map((part) => `<section class="feed-response" data-model="${escape(part.model)}" data-round="${escape(part.round)}">
      <h2 class="model-title">${escape(part.model)}${part.round ? ` ${escape(part.round.toUpperCase())}` : ''}</h2>
      ${part.metadata ? `<p class="response-meta">${escape(part.metadata)}</p>` : ''}
      <div class="response-blank-line" aria-hidden="true"></div>
      <div class="response-body">${part.body}</div>
      <div class="response-end">${escape(part.model)} End</div>
      <div class="response-blank-line" aria-hidden="true"></div></section>`).join('\n');
    return documentHtml(title, navigation + promptBlock + body, new Date(), false).replace('</style>', `
.feed-navigation{position:sticky;top:0;display:flex;flex-wrap:wrap;gap:12px;background:#fff;padding:17px 0;margin-bottom:16px;border-bottom:1px solid #ddd;z-index:10}.nav-group{display:flex;flex-wrap:wrap;gap:5px}.feed-nav-button{display:inline-flex;flex-direction:column;align-items:center;gap:6px;min-width:58px;border:0;background:transparent;color:#737b83;font-size:12px;cursor:pointer;padding:4px}.feed-nav-button:hover,.feed-nav-button[aria-pressed="true"]{color:#27251e}.model-nav-icon{display:block;width:34px;height:34px;background:currentColor;mask:var(--model-icon) center/contain no-repeat;-webkit-mask:var(--model-icon) center/contain no-repeat}.nav-symbol{display:flex;align-items:center;justify-content:center;min-width:34px;height:34px;font-size:24px}.feed-response[hidden]{display:none}
.export-prompt{box-sizing:border-box}.export-prompt.is-collapsed{max-height:calc(4.5em + 24px);overflow:hidden}.prompt-heading{position:sticky;top:var(--model-navigation-height,0px);z-index:9;display:flex;align-items:center;gap:15px;margin:0 0 12px;padding:4px 0;background:#fff}.prompt-heading h2{margin:0}.prompt-toggle{padding:4px 8px;border:1px solid #d0d7de;border-radius:6px;background:#f6f8fa;color:#27251eeb;cursor:pointer}.model-title{display:block;width:100%;box-sizing:border-box;padding:2px 8px;background:#e9eef2}.response-meta{margin:0 0 12px;color:#555;font-size:14px;overflow-wrap:anywhere}.response-blank-line{height:1.5em}.response-end{margin-top:12px;color:#27251eeb}.response-body{background:transparent;padding:0;border-radius:0}.response-body pre{background:transparent}.response-body,.response-body *{color:#27251eeb !important}.feed-response{scroll-margin-top:calc(var(--model-navigation-height,0px) + 12px)}
</style>`).replace('</script></body>', `
(() => {
  const navigation = document.querySelector('.feed-navigation');
  const syncPromptHeadingOffset = () => {
    document.documentElement.style.setProperty('--model-navigation-height', navigation.offsetHeight + 'px');
  };
  syncPromptHeadingOffset();
  window.addEventListener('resize', syncPromptHeadingOffset);
  document.querySelectorAll('.export-prompt').forEach((prompt) => {
    const toggle = prompt.parentElement.querySelector('.prompt-toggle');
    if (!toggle || prompt.scrollHeight <= prompt.clientHeight + 1) {
      if (toggle) toggle.hidden = true;
      return;
    }
    toggle.hidden = false;
    toggle.addEventListener('click', () => {
      const expanded = !prompt.classList.toggle('is-collapsed');
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.textContent = expanded ? 'Show less' : 'Show more';
    });
  });
  const buttons = Array.from(document.querySelectorAll('.feed-nav-button'));
  const cards = Array.from(document.querySelectorAll('.feed-response'));
  const select = (button, scroll = false) => {
    const view = button.dataset.view;
    const value = button.dataset.value;
    cards.forEach((card) => {
      card.hidden = view === 'model' ? card.dataset.model !== value
        : view === 'round' ? card.dataset.round !== value : false;
    });
    buttons.forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    if (scroll) {
      syncPromptHeadingOffset();
      cards.find((card) => !card.hidden)?.scrollIntoView?.({ block: 'start', behavior: 'instant' });
    }
  };
  buttons.forEach((button) => button.addEventListener('click', () => select(button, true)));
  select(buttons[0]);
})();
</script></body>`);
  }

  function downloadFile(filename, value, mime, documentRef = root.document) {
    const content = String(value || '');
    if (!content || !documentRef) return false;
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = documentRef.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    documentRef.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return true;
  }

  const downloadHtml = (filename, content, documentRef = root.document) => downloadFile(filename, content, 'text/html;charset=utf-8', documentRef);
  const downloadText = (filename, content, documentRef = root.document) => downloadFile(filename, content, 'text/plain;charset=utf-8', documentRef);

  const api = Object.freeze({ escape, sanitizeFragment, stamp, fileStamp, cardFileStamp, savedStamp, cardParts, heading, section, documentHtml, collectFeedHtml, buildFeedDocument, buildFeedText, downloadHtml, downloadText });
  root.DebateExport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
