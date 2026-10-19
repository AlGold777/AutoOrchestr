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
    const COLORS = ['#fff176', '#a5d6a7', '#81d4fa', '#f48fb1', '#ffcc80'];
    const SKIP = '#hl-favs,[data-hl-ui],nav,button,script,style,textarea,input,select';
    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
    const el = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const normalize = (text) => text.replace(/[ \t ]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    let lastColor = COLORS[0], range = null, point = null, handle = null, frame = 0;

    if (!document.getElementById('hl-style')) {
      const style = el('style');
      style.id = 'hl-style';
      style.textContent = `
        mark.hl { color: inherit; border-radius: 3px; padding: 0 1px; }
        mark.hl.hl-flash { outline: 2px solid #3b6fd8; outline-offset: 1px; }
        .hl-bar { position: fixed; display: none; z-index: 2147483647; align-items: center; gap: 6px; padding: 6px 8px;
                  background: #fff; color: #334155; border: 1px solid #dbe3ee; border-radius: 12px;
                  font: 13px system-ui, -apple-system, 'Segoe UI', sans-serif;
                  box-shadow: 0 8px 24px rgba(30,41,59,.16), 0 1px 3px rgba(30,41,59,.08); }
        .hl-btn { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0;
                  border: 1px solid transparent; border-radius: 8px; background: transparent; color: #64748b;
                  font: 15px/1 system-ui, sans-serif; cursor: pointer; transition: background .12s, color .12s, transform .12s; }
        .hl-btn:hover { background: #eef2f7; color: #1e293b; }
        .hl-btn.hl-sw { width: 20px; height: 20px; border: 1px solid rgba(30,41,59,.2); border-radius: 50%; }
        .hl-btn.hl-sw:hover { transform: scale(1.18); }
        .hl-btn.hl-star:hover { background: #fff6e0; color: #d98a00; }
        .hl-sep { width: 1px; height: 18px; margin: 0 2px; background: #e2e8f0; }
        #hl-favs { margin: 0 0 24px; padding: 14px 16px; border: 1px solid #dbe3ee; border-radius: 14px; background: #f6f8fc;
                   box-shadow: 0 1px 2px rgba(30,41,59,.05); font: 14px/1.55 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #334155; }
        #hl-favs h3 { margin: 0 0 10px; font-size: 19px; font-weight: 600; color: #475569; }
        #hl-favs .hl-fav { margin: 8px 0 0; padding: 10px 12px 8px; background: #fff; border: 1px solid #e2e8f0;
                           border-left: 4px solid rgb(118 198 255); border-radius: 10px; }
        #hl-favs .hl-fav-t { white-space: pre-wrap; user-select: text; color: #1e293b; }
        #hl-favs .hl-fav-m { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; font-size: 12px; }
        #hl-favs .hl-fav-m a { color: #2f62c8; font-weight: 500; text-decoration: none; }
        #hl-favs .hl-fav-m a:hover { text-decoration: underline; }
        #hl-favs .hl-fav-x { width: 24px; height: 24px; padding: 0; border: 0; border-radius: 6px; background: none;
                             color: #94a3b8; font-size: 13px; cursor: pointer; transition: background .12s, color .12s; }
        #hl-favs .hl-fav-x:hover { background: #fdecec; color: #d03a3a; }
        .hl-modal { position: fixed; inset: 0; z-index: 2147483647; display: flex; align-items: center; justify-content: center;
                    background: rgba(15,23,42,.45); font: 14px system-ui, -apple-system, 'Segoe UI', sans-serif; }
        .hl-modal-box { display: flex; flex-direction: column; gap: 8px; width: min(640px, 92vw); max-height: 90vh; box-sizing: border-box;
                        padding: 14px; background: #fff; color: #1e293b; border-radius: 12px; }
        .hl-modal textarea { width: 100%; height: 40vh; box-sizing: border-box; font: 11px/1.4 monospace; }
        .hl-modal-row { display: flex; gap: 8px; justify-content: flex-end; }
        .hl-toast { position: fixed; right: 12px; bottom: 12px; z-index: 2147483647; padding: 8px 14px; border-radius: 10px;
                    background: #1e293b; color: #f1f5f9; font: 13px system-ui, -apple-system, 'Segoe UI', sans-serif;
                    box-shadow: 0 8px 24px rgba(30,41,59,.25); }
      `;
      document.head.append(style);
    }

    // Карточка «Избранное»; строится из mark[data-fav] (источник истины — DOM).
    const favs = document.getElementById('hl-favs') || el('section');
    favs.id = 'hl-favs';
    // над ответом первой модели, под навигацией и промптом; без ответов моделей — в начале отчёта
    const firstAnswer = report.querySelector('.feed-response') || report.querySelector('.model-title')?.closest('section');
    if (firstAnswer) firstAnswer.parentNode.insertBefore(favs, firstAnswer); else report.prepend(favs);

    // ---------- Плавающая панель ----------
    const bar = el('div', 'hl-bar');
    bar.setAttribute('data-hl-ui', '');
    const addButton = (className, title, text, onClick) => {
      const node = el('button', 'hl-btn ' + className, text);
      node.type = 'button';
      node.title = title;
      node.setAttribute('aria-label', title);
      node.addEventListener('mousedown', (event) => event.preventDefault());   // не сбрасывать выделение
      node.addEventListener('click', onClick);
      bar.append(node);
      return node;
    };
    COLORS.forEach((color) => {
      addButton('hl-sw', 'Подсветить: ' + color, '', () => colorize(color)).style.background = color;
    });
    bar.append(el('span', 'hl-sep'));
    addButton('hl-star', 'В избранное', '★', favorite);
    addButton('', 'Снять подсветку', '✕', unhighlight);
    document.body.append(bar);

    const inBar = (event) => Boolean(event.target.closest?.('[data-hl-ui]'));
    const hide = () => { bar.style.display = 'none'; range = null; };
    const allowed = (node) => {
      const element = node.nodeType === 1 ? node : node.parentElement;
      return Boolean(element) && report.contains(element) && !element.closest(SKIP);
    };

    function place() {
      const rects = range.getClientRects?.() ?? [];
      const end = rects[rects.length - 1] || range.getBoundingClientRect?.() || { left: 0, right: 0, top: 0, height: 0 };
      const w = bar.offsetWidth, h = bar.offsetHeight;
      let left, top;
      if (point) {
        // мышь и тач: справа от точки; если не помещается — слева
        const x = point.x - scrollX, y = point.y - scrollY;
        left = x + 20 + w <= innerWidth - 4 ? x + 20 : x - 20 - w;
        top = y - h / 2;
      } else {
        // клавиатура: справа от конца выделения
        left = end.right + 12 + w <= innerWidth - 4 ? end.right + 12 : end.left - 12 - w;
        top = end.top + (end.height - h) / 2;
      }
      bar.style.left = clamp(left, 4, innerWidth - w - 4) + 'px';
      bar.style.top = clamp(top, 4, innerHeight - h - 4) + 'px';
    }
    function show() {
      const selection = getSelection();
      if (!selection.rangeCount || selection.isCollapsed || !allowed(selection.getRangeAt(0).commonAncestorContainer)) return hide();
      range = selection.getRangeAt(0).cloneRange();
      bar.style.display = 'flex';
      place();
    }
    // Панель показывается синхронно на mouseup; события самой панели игнорируются
    document.addEventListener('mouseup', (event) => {
      if (inBar(event)) return;
      point = { x: event.clientX + scrollX, y: event.clientY + scrollY };
      show();
    });
    document.addEventListener('touchend', (event) => {
      if (inBar(event)) return;
      const touch = event.changedTouches[0];
      point = touch ? { x: touch.clientX + scrollX, y: touch.clientY + scrollY } : null;
      setTimeout(show, 150);
    });
    document.addEventListener('keyup', (event) => {
      if (!event.shiftKey && !event.key.startsWith('Arrow')) return;
      point = null;
      show();
    });
    document.addEventListener('selectionchange', () => { if (getSelection().isCollapsed) hide(); });
    const reposition = () => {
      if (!range || frame) return;
      frame = requestAnimationFrame(() => { frame = 0; if (range) place(); });
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);

    // ---------- Подсветка ----------
    const marks = () => [...report.querySelectorAll('mark.hl')];
    // Каждый текстовый узел выделения получает свой mark; смещения считаются до правок DOM
    function collect() {
      const walker = document.createTreeWalker(report, NodeFilter.SHOW_TEXT);
      const items = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.nodeValue.trim() || !range.intersectsNode(node) || !allowed(node)) continue;
        const start = node === range.startContainer ? range.startOffset : 0;
        const end = node === range.endContainer ? range.endOffset : node.length;
        if (start < end) items.push({ node, start, end });
      }
      return items;
    }
    // keep=true: уже подсвеченный текст сохраняет свой цвет (для ★)
    function paint(items, color, keep) {
      return items.map(({ node, start, end }) => {
        if (end < node.length) node.splitText(end);
        const text = start > 0 ? node.splitText(start) : node;
        const old = text.parentElement.closest('mark.hl');
        if (!old) {
          const mark = el('mark', 'hl');
          mark.style.background = color;
          text.parentNode.insertBefore(mark, text);
          mark.append(text);
          return mark;
        }
        // уже подсвеченный фрагмент: старый mark делится на части, меняется только выбранная
        const pieces = [...old.childNodes].map((child) => {
          const piece = old.cloneNode(false);
          piece.removeAttribute('id');
          piece.style.background = child === text && !keep ? color : old.style.background;
          piece.append(child);
          return piece;
        });
        old.replaceWith(...pieces);
        return pieces.find((piece) => piece.contains(text));
      });
    }
    function unwrap(mark) {
      mark.replaceWith(...mark.childNodes);
    }
    function finish() {
      getSelection().removeAllRanges();
      hide();
      rebuild();
    }
    function colorize(color) {
      lastColor = color;
      const items = collect();
      if (items.length) paint(items, color, false);
      finish();
    }
    function favorite() {
      const items = collect();
      if (!items.length) return finish();
      const text = normalize(getSelection().toString());   // до правок DOM; переносы между блоками сохраняются
      const id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const painted = paint(items, lastColor, true);
      painted.forEach((mark) => { mark.dataset.fav = id; mark.removeAttribute('data-fav-text'); });
      painted[0].dataset.favText = text;
      finish();
    }
    // ✕ снимает подсветку целиком с пересекающихся mark и со всей заметки, которой они принадлежат
    function unhighlight() {
      if (range) {
        const hits = marks().filter((mark) => allowed(mark) && range.intersectsNode(mark));
        const ids = new Set(hits.map((mark) => mark.dataset.fav).filter(Boolean));
        marks().filter((mark) => hits.includes(mark) || ids.has(mark.dataset.fav)).forEach(unwrap);
        report.normalize();
      }
      finish();
    }

    // ---------- Карточка ----------
    function rebuild() {
      const groups = new Map();
      marks().forEach((mark) => {
        if (!mark.dataset.fav) return;
        if (!groups.has(mark.dataset.fav)) groups.set(mark.dataset.fav, []);
        groups.get(mark.dataset.fav).push(mark);
      });
      favs.replaceChildren();
      favs.style.display = groups.size ? '' : 'none';
      if (!groups.size) return;
      favs.append(el('h3', '', 'Избранное'));
      groups.forEach((items, id) => {
        const saved = items.find((mark) => mark.dataset.favText);
        const text = saved ? saved.dataset.favText : normalize(items.map((mark) => mark.textContent).join(' '));
        items.forEach((mark) => { mark.removeAttribute('id'); mark.removeAttribute('data-fav-text'); });
        const first = items[0];
        first.id = 'hl-' + id;   // якорь работает и без скрипта
        first.dataset.favText = text;

        const row = el('div', 'hl-fav');
        const body = el('div', 'hl-fav-t', text);
        const meta = el('div', 'hl-fav-m');
        const link = el('a', '', '▽');
        link.href = '#' + first.id;
        link.title = 'К месту в тексте';
        link.setAttribute('aria-label', 'К месту в тексте');
        link.addEventListener('click', (event) => {
          event.preventDefault();
          for (let node = first; node; node = node.parentElement) node.hidden = false;   // скрытая карточка ленты
          first.scrollIntoView({ behavior: 'smooth', block: 'center' });
          items.forEach((mark) => mark.classList.add('hl-flash'));
          setTimeout(() => items.forEach((mark) => mark.classList.remove('hl-flash')), 1500);
        });
        const remove = el('button', 'hl-fav-x', '✕');
        remove.type = 'button';
        remove.title = 'Убрать из избранного (подсветка останется)';
        remove.setAttribute('aria-label', 'Убрать из избранного');
        remove.addEventListener('click', () => {
          items.forEach((mark) => { mark.removeAttribute('data-fav'); mark.removeAttribute('data-fav-text'); mark.removeAttribute('id'); });
          rebuild();
        });
        meta.append(link, remove);
        row.append(body, meta);
        favs.append(row);
      });
    }

    // ---------- Сохранение ----------
    function toast(text) {
      document.getElementById('hl-toast')?.remove();
      const node = el('div', 'hl-toast', text);
      node.id = 'hl-toast';
      node.setAttribute('data-hl-ui', '');
      node.setAttribute('role', 'status');
      document.body.append(node);
      setTimeout(() => node.remove(), 1800);
    }
    // Запасной путь: HTML в textarea — скопировать и вставить в новый .html
    function showCopy(html) {
      document.querySelector('[data-hl-copy]')?.remove();
      const modal = el('div', 'hl-modal');
      modal.setAttribute('data-hl-ui', '');
      modal.setAttribute('data-hl-copy', '');
      const box = el('div', 'hl-modal-box');
      const message = el('div', '', 'Здесь автосохранение недоступно (предпросмотр). Откройте файл двойным кликом в Chrome/Edge или скопируйте HTML и вставьте в новый файл с расширением .html.');
      const area = el('textarea');
      area.readOnly = true;
      area.value = html;
      const row = el('div', 'hl-modal-row');
      const copy = el('button', '', 'Копировать');
      copy.type = 'button';
      copy.addEventListener('click', async () => {
        area.select();
        try {
          await navigator.clipboard.writeText(html);
          copy.textContent = 'Скопировано';
        } catch (_) {
          document.execCommand('copy');
          copy.textContent = 'Скопировано (Ctrl+C)';
        }
      });
      const close = el('button', '', 'Закрыть');
      close.type = 'button';
      close.addEventListener('click', () => modal.remove());
      row.append(copy, close);
      box.append(message, area, row);
      modal.append(box);
      document.body.append(modal);
      area.select();
    }
    async function save() {
      const clone = document.documentElement.cloneNode(true);
      clone.querySelectorAll('[data-hl-ui]').forEach((node) => node.remove());
      clone.querySelectorAll('.hl-flash').forEach((node) => node.classList.remove('hl-flash'));
      const html = '<!DOCTYPE html>\n' + clone.outerHTML;
      const name = (decodeURIComponent(location.pathname.split('/').pop() || '') || 'report.html').replace(/\.html?$/i, '') + '_annotated.html';
      // iframe (предпросмотр в приложении или почте): File System API там нет, а скачивание блокируется молча
      let boxed = false;
      try { boxed = window !== window.top; } catch (_) { boxed = true; }
      if (!boxed && window.showSaveFilePicker) {
        try {
          handle = handle || await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'HTML', accept: { 'text/html': ['.html'] } }] });
          const stream = await handle.createWritable();
          await stream.write(html);
          await stream.close();
          return toast('Сохранено');
        } catch (error) {
          if (error.name === 'AbortError') return;
          handle = null;
        }
      }
      try {
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
        const link = el('a');
        link.href = url;
        link.download = name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast(boxed ? 'Предпросмотр может блокировать скачивание' : 'Скачано копией — папка «Загрузки»');
      } catch (_) { boxed = true; }
      if (boxed) showCopy(html);
    }
    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save(); }
    });
    rebuild();
  }

  // Аннотатор для любого HTML-экспорта: содержимое отчёта должно лежать в <div id="report">.
  const annotationScript = () => `<script>(${initReportAnnotations.toString()})();<\/script>`;

  const documentHtml = (title, bodyHtml, date = new Date(), showHeader = true) => `<!DOCTYPE html>
<html lang="ru"><head><meta charset="UTF-8"><title>${escape(title)}</title><style>
body{font-family:Arial,sans-serif;background:#fff;color:#111;padding:24px;line-height:1.5}section{margin-bottom:24px}h1{font-size:24px;margin:0 0 4px}h2{margin:0 0 12px;font-size:20px}pre{background:#f6f8fa;padding:12px;border-radius:8px;white-space:pre-wrap;word-wrap:break-word}.response-body{background:#f8fafc;padding:12px;border-radius:8px}.response-body table{width:100%;border-collapse:collapse;margin:8px 0}.response-body th,.response-body td{border:1px solid #ddd;padding:6px 8px;vertical-align:top}.response-body ul,.response-body ol{padding-left:24px}.response-time,.saved-at{color:#555;font-size:14px;font-weight:400}.saved-at{margin:0 0 16px}
</style></head><body><div id="report">${showHeader ? `<h1>${escape(title)}</h1><p class="saved-at">${savedStamp(date)}</p>` : ''}${bodyHtml}</div>${annotationScript()}</body></html>`;

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

  const api = Object.freeze({ escape, sanitizeFragment, stamp, fileStamp, cardFileStamp, savedStamp, cardParts, heading, section, annotationScript, documentHtml, collectFeedHtml, buildFeedDocument, buildFeedText, downloadHtml, downloadText });
  root.DebateExport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
