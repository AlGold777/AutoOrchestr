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

  const documentHtml = (title, bodyHtml, date = new Date(), showHeader = true) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>${escape(title)}</title><style>
body{font-family:Arial,sans-serif;background:#fff;color:#111;padding:24px;line-height:1.5}section{margin-bottom:24px}h1{font-size:24px;margin:0 0 4px}h2{margin:0 0 12px;font-size:20px}pre{background:#f6f8fa;padding:12px;border-radius:8px;white-space:pre-wrap;word-wrap:break-word}.response-body{background:#f8fafc;padding:12px;border-radius:8px}.response-body table{width:100%;border-collapse:collapse;margin:8px 0}.response-body th,.response-body td{border:1px solid #ddd;padding:6px 8px;vertical-align:top}.response-body ul,.response-body ol{padding-left:24px}.response-time,.saved-at{color:#555;font-size:14px;font-weight:400}.saved-at{margin:0 0 16px}
</style></head><body>${showHeader ? `<h1>${escape(title)}</h1><p class="saved-at">${savedStamp(date)}</p>` : ''}${bodyHtml}</body></html>`;

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
</style>`).replace('</body>', `<script>
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
