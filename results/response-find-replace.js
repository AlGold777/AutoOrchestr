(function installResponseFindReplace(root) {
    'use strict';

    const SCOPE_SELECTOR = '.output, .debate-model-card-output';
    let panel = null;
    let activeScope = null;
    let activeScopeKey = null;
    let lastScope = null;
    let currentMatch = -1;
    let matches = [];

    const textOf = (scope) => String(scope?.innerText || scope?.textContent || '');
    const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    function scopeFromNode(node) {
        const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        return element?.closest?.(SCOPE_SELECTOR) || null;
    }

    function scopeFromSelection() {
        const selection = window.getSelection?.();
        return scopeFromNode(selection?.anchorNode) || scopeFromNode(selection?.focusNode);
    }

    function rememberScope(scope) {
        if (!scope || !scope.matches?.(SCOPE_SELECTOR) || !scope.isConnected) return;
        const card = scope.closest('.llm-panel, .debate-model-card');
        activeScopeKey = {
            scopeId: scope.id || '',
            cardId: card?.id || '',
            entryId: card?.dataset?.entryId || card?.dataset?.messageId || '',
            sessionId: card?.dataset?.sessionId || '',
            llmName: card?.dataset?.llmName || ''
        };
        lastScope = scope;
    }

    function findRememberedScope() {
        if (lastScope?.isConnected && lastScope.matches?.(SCOPE_SELECTOR)) return lastScope;
        const key = activeScopeKey;
        if (!key) return null;
        if (key.scopeId) {
            const byId = document.getElementById(key.scopeId);
            if (byId?.matches?.(SCOPE_SELECTOR)) return byId;
        }
        if (key.cardId) {
            const card = document.getElementById(key.cardId);
            const scope = card?.querySelector?.(SCOPE_SELECTOR);
            if (scope) return scope;
        }
        const cards = Array.from(document.querySelectorAll('.llm-panel, .debate-model-card'));
        const card = cards.find((candidate) => {
            const data = candidate.dataset || {};
            return (!key.entryId || data.entryId === key.entryId || data.messageId === key.entryId)
                && (!key.sessionId || data.sessionId === key.sessionId)
                && (!key.llmName || data.llmName === key.llmName);
        });
        return card?.querySelector?.(SCOPE_SELECTOR) || null;
    }

    function currentScope() {
        if (activeScope?.isConnected && activeScope.matches?.(SCOPE_SELECTOR)) return activeScope;
        const resolved = findRememberedScope();
        if (resolved) activeScope = resolved;
        return activeScope;
    }

    function ensurePanel() {
        if (panel) return panel;
        panel = document.createElement('div');
        panel.id = 'response-find-replace-panel';
        panel.className = 'response-find-replace';
        panel.hidden = true;
        panel.innerHTML = `
            <div class="response-find-replace-row response-find-replace-find-row">
                <button type="button" class="response-find-replace-toggle" data-fr-toggle aria-expanded="false" aria-label="Show replace field" title="Show replace field">›</button>
                <input name="find" type="search" placeholder="Find" autocomplete="off" spellcheck="false" aria-label="Find">
                <button type="button" class="response-find-replace-case" data-fr-case aria-pressed="false" aria-label="Match case" title="Match case">Aa</button>
                <output data-fr-status aria-live="polite">No results</output>
                <button type="button" class="response-find-replace-nav" data-fr-prev aria-label="Previous match" title="Previous match">↑</button>
                <button type="button" class="response-find-replace-nav" data-fr-next aria-label="Next match" title="Next match">↓</button>
                <button type="button" class="response-find-replace-close" data-fr-close aria-label="Close" title="Close">×</button>
            </div>
            <div class="response-find-replace-row response-find-replace-row-secondary" data-fr-replace-row hidden>
                <span class="response-find-replace-toggle-placeholder" aria-hidden="true"></span>
                <input name="replace" type="text" placeholder="Replace" autocomplete="off" spellcheck="false" aria-label="Replace">
                <button type="button" class="response-find-replace-action" data-fr-one aria-label="Replace current match" title="Replace current match">ab</button>
                <button type="button" class="response-find-replace-action" data-fr-all aria-label="Replace all matches" title="Replace all matches">aᵇ</button>
            </div>`;
        document.body.appendChild(panel);
        panel.addEventListener('click', handleClick);
        panel.querySelector('[name="find"]').addEventListener('input', refresh);
        panel.querySelector('[data-fr-case]').addEventListener('click', () => {
            const button = panel.querySelector('[data-fr-case]');
            const active = button.getAttribute('aria-pressed') !== 'true';
            button.setAttribute('aria-pressed', String(active));
            refresh();
        });
        panel.querySelector('[name="replace"]').addEventListener('keydown', (event) => {
            if (event.key === 'Enter') replaceOne();
        });
        panel.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') close();
        });
        return panel;
    }

    function input(name) { return panel?.querySelector(`[name="${name}"]`); }
    function status(message) {
        const node = panel?.querySelector('[data-fr-status]');
        if (node) node.textContent = message;
    }

    function collectMatches() {
        const find = String(input('find')?.value || '');
        const scope = currentScope();
        if (!scope || !find) return [];
        const matchCase = panel?.querySelector('[data-fr-case]')?.getAttribute('aria-pressed') === 'true';
        const regex = new RegExp(escapeRegExp(find), matchCase ? 'g' : 'gi');
        const found = [];
        const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            let match;
            regex.lastIndex = 0;
            while ((match = regex.exec(node.nodeValue || ''))) {
                found.push({ node, start: match.index, end: match.index + match[0].length });
                if (!match[0]) regex.lastIndex += 1;
            }
        }
        return found;
    }

    function selectMatch(index) {
        if (!matches.length) {
            currentMatch = -1;
            status('No results');
            return;
        }
        currentMatch = (index + matches.length) % matches.length;
        const match = matches[currentMatch];
        const selection = window.getSelection();
        const range = document.createRange();
        range.setStart(match.node, match.start);
        range.setEnd(match.node, match.end);
        selection.removeAllRanges();
        selection.addRange(range);
        match.node.parentElement?.scrollIntoView?.({ block: 'nearest' });
        status(`${currentMatch + 1} of ${matches.length}`);
    }

    function refresh() {
        matches = collectMatches();
        selectMatch(matches.length ? Math.min(Math.max(currentMatch, 0), matches.length - 1) : 0);
    }

    function dispatchChange() {
        const scope = currentScope();
        if (!scope) return;
        scope.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }));
        if (scope.matches('.debate-model-card-output')) {
            scope.closest('.debate-model-card')?.dispatchEvent(new CustomEvent('response-find-replace-change', { bubbles: true }));
        }
    }

    function replaceOne() {
        const match = matches[currentMatch];
        if (!match) { status('No results'); return; }
        const replacement = String(input('replace')?.value || '');
        match.node.nodeValue = `${match.node.nodeValue.slice(0, match.start)}${replacement}${match.node.nodeValue.slice(match.end)}`;
        dispatchChange();
        refresh();
    }

    function replaceAll() {
        const find = String(input('find')?.value || '');
        const scope = currentScope();
        if (!scope || !find) return;
        const replacement = String(input('replace')?.value || '');
        const matchCase = panel?.querySelector('[data-fr-case]')?.getAttribute('aria-pressed') === 'true';
        const regex = new RegExp(escapeRegExp(find), matchCase ? 'g' : 'gi');
        let count = 0;
        const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
        const nodes = [];
        let node;
        while ((node = walker.nextNode())) nodes.push(node);
        nodes.forEach((textNode) => {
            const before = textNode.nodeValue || '';
            const after = before.replace(regex, () => { count += 1; return replacement; });
            if (after !== before) textNode.nodeValue = after;
        });
        if (count) dispatchChange();
        refresh();
        if (count) status(`Replaced ${count}`);
    }

    function setExpanded(expanded) {
        const replaceRow = panel?.querySelector('[data-fr-replace-row]');
        const toggle = panel?.querySelector('[data-fr-toggle]');
        if (!replaceRow || !toggle) return;
        replaceRow.hidden = !expanded;
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.setAttribute('aria-label', expanded ? 'Hide replace field' : 'Show replace field');
        toggle.title = expanded ? 'Hide replace field' : 'Show replace field';
        toggle.textContent = expanded ? '⌄' : '›';
    }

    function handleClick(event) {
        const button = event.target.closest('button');
        if (!button || !panel.contains(button)) return;
        if (button.matches('[data-fr-toggle]')) {
            const row = panel.querySelector('[data-fr-replace-row]');
            setExpanded(row.hidden);
            if (!row.hidden) input('replace')?.focus();
        } else if (button.matches('[data-fr-case]')) {
            return;
        } else if (button.matches('[data-fr-prev]')) {
            selectMatch(currentMatch - 1);
        } else if (button.matches('[data-fr-next]')) {
            selectMatch(currentMatch + 1);
        } else if (button.matches('[data-fr-one]')) {
            replaceOne();
        } else if (button.matches('[data-fr-all]')) {
            replaceAll();
        } else if (button.matches('[data-fr-close]')) {
            close();
        }
    }

    function selectionRectForScope(scope) {
        scope = currentScope();
        const selection = window.getSelection?.();
        if (!selection || !selection.rangeCount || selection.isCollapsed) return null;
        const range = selection.getRangeAt(0);
        if (!scope?.contains(range.commonAncestorContainer)) return null;
        const rect = typeof range.getBoundingClientRect === 'function'
            ? range.getBoundingClientRect()
            : null;
        return rect && (rect.width || rect.height) ? rect : null;
    }

    function positionPanel(scope) {
        if (!panel) return;
        const liveScope = currentScope();
        if (!liveScope) return;
        const selectionRect = selectionRectForScope(liveScope);
        const formattingToolbar = document.querySelector('#responseSelTb.vis, #debateSelTb.vis');
        const formattingRect = formattingToolbar?.getBoundingClientRect?.();
        const anchorRect = formattingRect && (formattingRect.width || formattingRect.height)
            ? formattingRect
            : selectionRect;
        if (!anchorRect) return;

        const gap = 8;
        const panelWidth = panel.offsetWidth || 420;
        const panelHeight = panel.offsetHeight || 34;
        const top = Math.max(8, anchorRect.top - panelHeight - gap);
        const center = selectionRect
            ? selectionRect.left + selectionRect.width / 2
            : anchorRect.left + anchorRect.width / 2;
        const left = Math.max(8, Math.min(center - panelWidth / 2, window.innerWidth - panelWidth - 8));
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
    }

    function close() {
        if (panel) panel.hidden = true;
        activeScope = null;
        lastScope = null;
        activeScopeKey = null;
        matches = [];
        currentMatch = -1;
    }

    function open(scope) {
        if (!scope) return;
        rememberScope(scope);
        activeScope = scope;
        const view = ensurePanel();
        if (view.parentElement !== document.body) document.body.appendChild(view);
        view.hidden = false;
        currentMatch = -1;
        positionPanel(scope);
        input('find')?.focus();
        input('find')?.select?.();
        refresh();
    }

    function resolveScope(target) {
        const direct = scopeFromNode(target);
        if (direct) return direct;
        const selected = scopeFromSelection();
        if (selected) return selected;
        const card = target?.closest?.('.llm-panel, .debate-model-card');
        return card?.querySelector?.(SCOPE_SELECTOR) || findRememberedScope() || currentScope();
    }

    function init() {
        const reposition = () => {
            if (panel && !panel.hidden && currentScope()) positionPanel(currentScope());
        };
        window.addEventListener('scroll', reposition, { passive: true });
        window.addEventListener('resize', reposition);
        document.addEventListener('pointerdown', (event) => rememberScope(scopeFromNode(event.target)), true);
        document.addEventListener('focusin', (event) => rememberScope(scopeFromNode(event.target)), true);
        document.addEventListener('selectionchange', () => rememberScope(scopeFromSelection()));
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && panel && !panel.hidden) {
                event.preventDefault();
                close();
                return;
            }
            if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'f') return;
            const scope = resolveScope(event.target);
            if (!scope) return;
            event.preventDefault();
            open(scope);
        }, true);
        document.addEventListener('response-find-replace-change', (event) => {
            const card = event.target.closest?.('.debate-model-card');
            if (!card || typeof root.patchDebateCardMessage !== 'function') return;
            const output = card.querySelector('.debate-model-card-output');
            root.patchDebateCardMessage(card, { text: textOf(output).trim(), html: output?.innerHTML || '' });
            root.syncDebateCardOutputLayout?.(card);
        });
    }

    root.ResponseFindReplace = Object.freeze({ open, replaceAll });
    if (typeof module !== 'undefined' && module.exports) module.exports = { escapeRegExp };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})(typeof window !== 'undefined' ? window : globalThis);
