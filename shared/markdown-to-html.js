// shared/markdown-to-html.js
// GFM subset -> HTML for the results page, used when an answer has no usable HTML but has an
// answerMarkdown copy. Every text is escaped here; the result still goes through sanitizeHTML.
// Supported: headings, paragraphs (single newline = <br>), nested ordered/unordered lists (start number),
// task lists, fenced code (``` and ~~~, longer fences, info string), pipe tables with alignment and
// <br> in cells, block quotes (nested), horizontal rules, code spans, bold, italic, strikethrough,
// links, images (shown as a link), autolinks, footnotes (reference + list at the end).
// Not supported (shown as text): indented code, raw HTML, setext headings, reference-style links.
(function initMarkdownToHtml(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MarkdownToHtml = api;
})(typeof self !== 'undefined' ? self : globalThis, function factory() {
  'use strict';

  const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const SAFE_URL = /^(?:https?:|mailto:|tel:|#)/i;

  const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})[ \t]*([^`\s]*)[^`]*$/;
  const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
  const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
  const QUOTE = /^ {0,3}>[ ]?/;
  const LIST_ITEM = /^( *)([-+*]|\d{1,9}[.)])([ \t]+)(.*)$/;
  const TABLE_DELIM = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
  const FOOTNOTE_DEF = /^\[\^([^\]\s]+)\]:[ \t]*(.*)$/;

  function splitCells(line) {
    let text = line.trim();
    if (text.startsWith('|')) text = text.slice(1);
    if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
    const cells = [];
    let current = '';
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === '\\' && text[i + 1] === '|') { current += '|'; i += 1; continue; }
      if (text[i] === '|') { cells.push(current.trim()); current = ''; continue; }
      current += text[i];
    }
    cells.push(current.trim());
    return cells;
  }

  function createRenderer() {
    const footnoteOrder = [];
    const footnoteBodies = new Map();

    function inline(source, options = {}) {
      const tokens = [];
      const stash = (html) => { tokens.push(html); return `\u0000${tokens.length - 1}\u0000`; };
      let text = String(source);
      // Code spans first: nothing inside is interpreted.
      text = text.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, __, code) => stash(`<code>${escapeHtml(code.replace(/^ (.*) $/, '$1'))}</code>`));
      text = escapeHtml(text);
      if (options.cell) text = text.replace(/&lt;br\s*\/?&gt;/gi, '<br>');
      // Images are not rendered as pictures here: they stay a link.
      text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, alt, url) => (SAFE_URL.test(url)
        ? stash(`<a href="${url}">${alt || 'изображение'}</a>`) : stash(alt || 'изображение')));
      text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, label, url) => (SAFE_URL.test(url)
        ? stash(`<a href="${url}">${label}</a>`) : stash(label)));
      text = text.replace(/\[\^([^\]\s]+)\]/g, (_, id) => {
        if (!footnoteBodies.has(id)) return `[^${id}]`;
        let index = footnoteOrder.indexOf(id);
        if (index < 0) { footnoteOrder.push(id); index = footnoteOrder.length - 1; }
        return stash(`<sup>[${index + 1}]</sup>`);
      });
      text = text.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, (_, url) => stash(`<a href="${url}">${url}</a>`));
      text = text.replace(/(^|[\s(])(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g, (_, lead, url) => `${lead}${stash(`<a href="${url}">${url}</a>`)}`);
      text = text.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
        .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
        .replace(/(^|[^*\w])\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\*)/g, '$1<em>$2</em>')
        .replace(/(^|[^\w])_(?=[^\s_])([\s\S]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>');
      text = text.replace(/(?: {2,}|\\)\n/g, '<br>').replace(/\n/g, '<br>');
      return text.replace(/\u0000(\d+)\u0000/g, (_, n) => tokens[Number(n)]);
    }

    function isBlockStart(line, nextLine) {
      return HEADING.test(line) || HR.test(line) || FENCE_OPEN.test(line) || QUOTE.test(line)
        || /^ {0,3}(?:[-+*]|1[.)])[ \t]+\S/.test(line)
        || (line.includes('|') && nextLine !== undefined && TABLE_DELIM.test(nextLine) && nextLine.includes('-'));
    }

    function blocks(lines) {
      const out = [];
      let i = 0;
      while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) { i += 1; continue; }

        const def = FOOTNOTE_DEF.exec(line);
        if (def) {
          const body = [def[2]];
          i += 1;
          while (i < lines.length && /^( {2,}|\t)\S/.test(lines[i])) { body.push(lines[i].trim()); i += 1; }
          footnoteBodies.set(def[1], body.join(' '));
          continue;
        }

        const fence = FENCE_OPEN.exec(line);
        if (fence) {
          const marker = fence[2];
          const body = [];
          i += 1;
          const closing = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}[ \\t]*$`);
          while (i < lines.length && !closing.test(lines[i])) {
            body.push(lines[i].replace(new RegExp(`^ {0,${fence[1].length}}`), ''));
            i += 1;
          }
          i += 1; // the closing fence (or the end of the text: an unterminated block is still shown whole)
          const lang = fence[3] ? ` class="language-${escapeHtml(fence[3].replace(/[^\w+#.-]/g, ''))}"` : '';
          out.push(`<pre><code${lang}>${escapeHtml(body.join('\n'))}</code></pre>`);
          continue;
        }

        const heading = HEADING.exec(line);
        if (heading) {
          out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
          i += 1;
          continue;
        }

        if (HR.test(line)) { out.push('<hr>'); i += 1; continue; }

        if (QUOTE.test(line)) {
          const inner = [];
          while (i < lines.length && QUOTE.test(lines[i])) { inner.push(lines[i].replace(QUOTE, '')); i += 1; }
          out.push(`<blockquote>${blocks(inner)}</blockquote>`);
          continue;
        }

        if (line.includes('|') && i + 1 < lines.length && TABLE_DELIM.test(lines[i + 1]) && lines[i + 1].includes('-')) {
          const head = splitCells(line);
          const delim = splitCells(lines[i + 1]);
          if (head.length === delim.length) {
            const align = delim.map((cell) => {
              const left = cell.startsWith(':');
              const right = cell.endsWith(':');
              return left && right ? 'center' : (right ? 'right' : (left ? 'left' : ''));
            });
            const cell = (tag, value, index) => `<${tag}${align[index] ? ` style="text-align:${align[index]}"` : ''}>${inline(value, { cell: true })}</${tag}>`;
            const rows = [];
            i += 2;
            while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
              const cells = splitCells(lines[i]);
              rows.push(`<tr>${head.map((_, index) => cell('td', cells[index] || '', index)).join('')}</tr>`);
              i += 1;
            }
            out.push(`<table><thead><tr>${head.map((value, index) => cell('th', value, index)).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`);
            continue;
          }
        }

        const item = LIST_ITEM.exec(line);
        if (item) {
          const baseIndent = item[1].length;
          const ordered = /\d/.test(item[2]);
          const start = ordered ? parseInt(item[2], 10) : null;
          const entries = [];
          while (i < lines.length) {
            const current = LIST_ITEM.exec(lines[i]);
            if (!current || current[1].length !== baseIndent || /\d/.test(current[2]) !== ordered) break;
            const contentIndent = current[1].length + current[2].length + current[3].length;
            const body = [current[4]];
            i += 1;
            while (i < lines.length) {
              const next = lines[i];
              if (!next.trim()) {
                // A blank line stays inside the item only when an indented line follows.
                let k = i;
                while (k < lines.length && !lines[k].trim()) k += 1;
                if (k < lines.length && lines[k].match(/^ */)[0].length >= contentIndent) { body.push(''); i += 1; continue; }
                break;
              }
              if (next.match(/^ */)[0].length >= contentIndent) { body.push(next.slice(contentIndent)); i += 1; continue; }
              const sibling = LIST_ITEM.exec(next);
              if (sibling && sibling[1].length <= baseIndent) break;
              if (isBlockStart(next, lines[i + 1])) break;
              body.push(next.trim()); // lazy continuation of the item's paragraph
              i += 1;
            }
            entries.push(body);
          }
          const rendered = entries.map((body) => {
            let first = body[0];
            let task = '';
            const box = /^\[( |x|X)\][ \t]+/.exec(first);
            if (box) { task = box[1] === ' ' ? '☐ ' : '☑ '; first = first.slice(box[0].length); }
            let content = blocks([first, ...body.slice(1)]);
            // A tight item (no blank line inside) shows its first paragraph without <p>.
            if (!body.includes('')) content = content.replace(/^<p>([\s\S]*?)<\/p>/, '$1');
            return `<li>${task}${content}</li>`;
          }).join('');
          const tag = ordered ? 'ol' : 'ul';
          out.push(`<${tag}${ordered && start !== 1 ? ` start="${start}"` : ''}>${rendered}</${tag}>`);
          continue;
        }

        const paragraph = [line];
        i += 1;
        while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i], lines[i + 1]) && !FOOTNOTE_DEF.test(lines[i])) {
          paragraph.push(lines[i]);
          i += 1;
        }
        out.push(`<p>${inline(paragraph.map((value) => value.replace(/^\s+/, '')).join('\n'))}</p>`);
      }
      return out.join('');
    }

    function footnotes() {
      if (!footnoteOrder.length) return '';
      return `<hr><ol>${footnoteOrder.map((id) => `<li>${inline(footnoteBodies.get(id) || '')}</li>`).join('')}</ol>`;
    }

    return { blocks, footnotes };
  }

  function render(markdown) {
    const source = String(markdown ?? '').replace(/\r\n?/g, '\n');
    if (!source.trim()) return '';
    const renderer = createRenderer();
    const lines = source.replace(/\t/g, '    ').split('\n');
    // Footnote definitions are collected first so references resolve wherever they are.
    renderer.blocks(lines.filter((line) => FOOTNOTE_DEF.test(line)));
    const html = renderer.blocks(lines);
    return html + renderer.footnotes();
  }

  return { render, escapeHtml };
});
