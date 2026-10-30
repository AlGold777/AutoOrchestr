// DOM, HTML, SVG, and incremental-render helpers for results pages.
(function installResultsDomUtils(root) {
    'use strict';

    if (!root || root.ResultsDomUtils) return;

    function create(options = {}) {
        const promptPasteBlockSelector = options.promptPasteBlockSelector || '';
        const escapeHtml = typeof options.escapeHtml === 'function'
            ? options.escapeHtml
            : (value = '') => String(value);
        const sanitizeHTML = typeof options.sanitizeHTML === 'function'
            ? options.sanitizeHTML
            : root.sanitizeHTML;

        const getListDepth = (node) => {
            let depth = 0;
            let current = node?.parentElement || null;
            while (current) {
                if (current.tagName === 'UL' || current.tagName === 'OL') {
                    depth += 1;
                }
                current = current.parentElement;
            }
            return Math.max(0, depth - 1);
        };

        const getListPrefix = (node) => {
            const parent = node?.parentElement || null;
            if (!parent) return '- ';
            if (parent.tagName === 'OL') {
                const items = Array.from(parent.children || []).filter((child) => child.tagName === 'LI');
                const index = items.indexOf(node);
                if (index >= 0) return `${index + 1}. `;
            }
            return '- ';
        };

        const parseHtmlDocument = (html, { sanitize = false } = {}) => {
            const raw = String(html || '');
            const source = sanitize && typeof sanitizeHTML === 'function' ? sanitizeHTML(raw) : raw;
            return new DOMParser().parseFromString(source, 'text/html');
        };

        const createHtmlFragment = (contextNode, html) => {
            const source = String(html || '');
            if (!source) return document.createDocumentFragment();
            const range = document.createRange();
            const context = contextNode || document.body || document.documentElement;
            if (context) range.selectNode(context);
            return range.createContextualFragment(source);
        };

        const replaceChildrenFromHtml = (container, html) => {
            if (!container) return;
            container.replaceChildren(createHtmlFragment(container, html));
        };

        const replaceChildrenFromSanitizedHtml = (container, html) => {
            if (!container) return;
            const safe = typeof sanitizeHTML === 'function' ? sanitizeHTML(String(html || '')) : String(html || '');
            container.replaceChildren(createHtmlFragment(container, safe));
            // Code blocks get their header and Copy button (DOM code, after the sanitizer); idempotent.
            if (root.ResultsCodeBlocks) root.ResultsCodeBlocks.decorateCodeBlocks(container);
        };

        const incrementalRenderQueue = [];
        let incrementalRenderHandler = null;

        const setIncrementalRenderHandler = (handler) => {
            incrementalRenderHandler = typeof handler === 'function' ? handler : null;
        };

        const dispatchIncrementalRenderMeasurement = (measurement = {}) => {
            if (typeof incrementalRenderHandler === 'function') {
                incrementalRenderHandler(measurement);
            } else {
                incrementalRenderQueue.push(measurement);
            }
        };

        const renderIncrementalList = (container, items = [], { getId, getHash, renderItem }) => {
            if (!container || typeof getId !== 'function' || typeof renderItem !== 'function') return;
            const startTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const existing = new Map();
            Array.from(container.children).forEach((child) => {
                const id = child?.dataset?.itemId;
                if (id) existing.set(id, child);
            });
            let mutatedCount = 0;
            let processedItems = 0;
            const fragment = document.createDocumentFragment();
            items.forEach((item) => {
                const id = getId(item);
                if (!id) return;
                processedItems += 1;
                const hash = typeof getHash === 'function' ? getHash(item) : '';
                let node = existing.get(id);
                if (node && node.dataset.hash === hash) {
                    existing.delete(id);
                } else {
                    node = renderItem(item);
                    if (!node) return;
                    mutatedCount += 1;
                }
                node.dataset.itemId = id;
                if (hash) node.dataset.hash = hash;
                fragment.appendChild(node);
            });
            container.replaceChildren(fragment);
            const endTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            if (processedItems > 0) {
                dispatchIncrementalRenderMeasurement({
                    itemCount: processedItems,
                    mutatedCount,
                    durationMs: Math.max(0, endTime - startTime)
                });
            }
        };

        const clearNode = (container) => {
            if (!container) return;
            container.replaceChildren();
        };

        const setSvgContent = (svg, markup = '') => {
            if (!svg) return;
            clearNode(svg);
            const rawSource = String(markup || '').trim();
            const source = rawSource;
            if (!source) return;
            const parser = new DOMParser();
            const doc = parser.parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${source}</svg>`, 'image/svg+xml');
            const payload = doc.documentElement;
            if (!payload) return;
            payload.querySelectorAll('script, foreignObject, iframe, object, embed').forEach((node) => node.remove());
            payload.querySelectorAll('*').forEach((node) => {
                Array.from(node.attributes || []).forEach((attr) => {
                    const name = String(attr.name || '').toLowerCase();
                    const value = String(attr.value || '').trim().toLowerCase();
                    if (name.startsWith('on') || value.startsWith('javascript:') || value.startsWith('data:text/html')) {
                        node.removeAttribute(attr.name);
                    }
                });
            });
            const fragment = document.createDocumentFragment();
            Array.from(payload.childNodes).forEach((node) => {
                fragment.appendChild(svg.ownerDocument.importNode(node, true));
            });
            svg.appendChild(fragment);
        };

        const plainTextFromHtml = (html) => {
            if (!html) return '';
            const doc = parseHtmlDocument(html, { sanitize: true });
            const container = doc.body || doc.documentElement;
            if (!container) return '';
            container.querySelectorAll('script, style, noscript').forEach((node) => node.remove());
            container.querySelectorAll('br').forEach((node) => node.replaceWith('\n'));
            container.querySelectorAll('li').forEach((node) => {
                const indent = '  '.repeat(getListDepth(node));
                node.insertAdjacentText('afterbegin', `${indent}${getListPrefix(node)}`);
            });
            if (promptPasteBlockSelector) {
                container.querySelectorAll(promptPasteBlockSelector).forEach((node) => {
                    node.insertAdjacentText('beforebegin', '\n');
                    node.insertAdjacentText('afterend', '\n');
                });
            }
            let text = container.textContent || '';
            text = text.replace(/\u00a0/g, ' ');
            text = text.replace(/\r\n/g, '\n');
            text = text.replace(/[ \t]+\n/g, '\n');
            text = text.replace(/\n[ \t]+/g, '\n');
            text = text.replace(/\n{3,}/g, '\n\n');
            return text.trim();
        };

        const buildHtmlFromText = (text) => escapeHtml(String(text || '')).replace(/\n/g, '<br>');

        const looksLikeHtml = (value) =>
            /<(?:p|div|span|pre|code|br|ul|ol|li|table|thead|tbody|tfoot|tr|td|th|blockquote|h[1-6])\b/i.test(String(value || ''));

        const insertTextAtCursor = (input, text) => {
            if (!input) return;
            const value = input.value || '';
            const start = typeof input.selectionStart === 'number' ? input.selectionStart : value.length;
            const end = typeof input.selectionEnd === 'number' ? input.selectionEnd : value.length;
            const nextValue = value.slice(0, start) + text + value.slice(end);
            input.value = nextValue;
            const nextPos = start + text.length;
            input.setSelectionRange(nextPos, nextPos);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        };

        return {
            getListDepth,
            getListPrefix,
            parseHtmlDocument,
            createHtmlFragment,
            replaceChildrenFromHtml,
            replaceChildrenFromSanitizedHtml,
            incrementalRenderQueue,
            setIncrementalRenderHandler,
            dispatchIncrementalRenderMeasurement,
            renderIncrementalList,
            clearNode,
            setSvgContent,
            plainTextFromHtml,
            buildHtmlFromText,
            looksLikeHtml,
            insertTextAtCursor
        };
    }

    root.ResultsDomUtils = Object.freeze({ create });
})(typeof window !== 'undefined' ? window : globalThis);
