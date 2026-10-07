// Debate HTML export service; independent from runtime orchestration.
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

  function cardParts(card) {
    const outputEl = card?.querySelector?.('.debate-model-card-output');
    const rawHtml = outputEl ? sanitizeFragment(String(outputEl.innerHTML || '').trim()) : '';
    const plain = outputEl ? String(outputEl.innerText || outputEl.textContent || '').trim() : '';
    const body = rawHtml || (plain ? `<pre>${escape(plain)}</pre>` : '');
    if (!body) return null;
    return {
      model: String(card.dataset.llmName || card.querySelector('.debate-model-card-name')?.textContent || 'Model').trim() || 'Model',
      time: String(card.querySelector('.debate-model-card-time')?.textContent || '').trim(),
      body
    };
  }

  const heading = ({ model, time }, tag = 'h2') => `<${tag}>${escape(model)}${time ? ` <span class="response-time">${escape(time)}</span>` : ''}</${tag}>`;
  const section = (card) => {
    const parts = cardParts(card);
    return parts ? `<section>${heading(parts)}<div class="response-body">${parts.body}</div></section>` : '';
  };

  const documentHtml = (title, bodyHtml, date = new Date()) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>${escape(title)}</title><style>
body{font-family:Arial,sans-serif;background:#fff;color:#111;padding:24px;line-height:1.5}section{margin-bottom:24px}h1{font-size:24px;margin:0 0 4px}h2{margin:0 0 12px;font-size:20px}pre{background:#f6f8fa;padding:12px;border-radius:8px;white-space:pre-wrap;word-wrap:break-word}.response-body{background:#f8fafc;padding:12px;border-radius:8px}.response-body table{width:100%;border-collapse:collapse;margin:8px 0}.response-body th,.response-body td{border:1px solid #ddd;padding:6px 8px;vertical-align:top}.response-body ul,.response-body ol{padding-left:24px}.response-time,.saved-at{color:#555;font-size:14px;font-weight:400}.saved-at{margin:0 0 16px}
</style></head><body><h1>${escape(title)}</h1><p class="saved-at">${savedStamp(date)}</p>${bodyHtml}</body></html>`;

  function collectFeedHtml(feed, activeSessionId = '1') {
    if (!feed) return '';
    return Array.from(feed.querySelectorAll('.debate-model-card'))
      .filter((card) => card.dataset.sessionId === String(activeSessionId) && card.style.display !== 'none')
      .map(section).filter(Boolean).join('\n');
  }

  function buildFeedDocument(feed, activeSessionId = '1', title = 'Debate Feed') {
    const body = collectFeedHtml(feed, activeSessionId);
    return body ? documentHtml(title, body) : '';
  }

  function downloadHtml(filename, htmlContent, documentRef = root.document) {
    const content = String(htmlContent || '').trim();
    if (!content || !documentRef) return false;
    const blob = new Blob([content], { type: 'text/html' });
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

  const api = Object.freeze({ escape, sanitizeFragment, stamp, fileStamp, cardFileStamp, savedStamp, cardParts, heading, section, documentHtml, collectFeedHtml, buildFeedDocument, downloadHtml });
  root.DebateExport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
