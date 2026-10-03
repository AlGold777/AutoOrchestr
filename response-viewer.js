(function initResponseViewer() {
    'use strict';

    const shell = document.getElementById('viewer-shell');
    const content = document.getElementById('viewer-content');
    const closeButton = document.getElementById('viewer-close');
    let viewingFeed = false;
    let closing = false;
    let receivedContent = false;

    function close() {
        if (closing) return;
        closing = true;
        try {
            chrome.runtime.sendMessage({ type: 'RESPONSE_VIEWER_CLOSE' });
        } catch (_) {}
        window.close();
    }

    function render(message = {}) {
        const wasViewingFeed = viewingFeed;
        const scrollTop = shell.scrollTop;
        const wasAtBottom = shell.scrollHeight - shell.clientHeight - scrollTop <= 8;
        viewingFeed = message.view === 'debate-feed';
        content.classList.toggle('viewer-debate-feed', viewingFeed);
        const model = String(message.model || 'Response').trim() || 'Response';
        const rawHtml = String(message.html || '').trim();
        const rawText = String(message.text || '').trim();
        if (rawHtml && typeof DOMPurify !== 'undefined') {
            content.innerHTML = DOMPurify.sanitize(rawHtml);
            if (viewingFeed) {
                content.querySelectorAll('button, input, select, textarea, .status-indicator, .debate-fragment-hint').forEach((node) => node.remove());
                content.querySelectorAll('[contenteditable]').forEach((node) => node.removeAttribute('contenteditable'));
            }
            const firstHeading = content.querySelector('h1, h2, h3, h4, h5, h6');
            if (!viewingFeed && firstHeading && firstHeading.textContent.trim().toLocaleLowerCase() === model.toLocaleLowerCase()) {
                const children = Array.from(content.children);
                const before = children.slice(0, children.indexOf(firstHeading));
                if (!before.some((node) => node.textContent.trim())) firstHeading.remove();
            }
        } else {
            content.textContent = rawText;
        }
        document.title = viewingFeed ? model : `${model} response`;
        if (viewingFeed && wasViewingFeed) shell.scrollTop = wasAtBottom ? shell.scrollHeight : scrollTop;
    }

    async function loadStoredContent() {
        const viewerId = new URLSearchParams(window.location.search).get('viewerId');
        if (!viewerId) return;
        const key = `llmResponseViewer.${viewerId}`;
        let payload = null;
        try {
            if (chrome.storage?.session) {
                const stored = await chrome.storage.session.get(key);
                payload = stored?.[key] || null;
            }
        } catch (_) {}
        if (!payload) {
            try {
                const stored = await chrome.storage.local.get(key);
                payload = stored?.[key] || null;
            } catch (_) {}
        }
        if (!payload) {
            try {
                const response = await chrome.runtime.sendMessage({ type: 'RESPONSE_VIEWER_GET_CONTENT', key });
                payload = response?.payload || null;
            } catch (_) {}
        }
        if (payload && !receivedContent) render(payload);
    }

    closeButton?.addEventListener('click', close);
    shell?.addEventListener('click', (event) => {
        if (event.target === shell) close();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') close();
    });
    window.addEventListener('blur', () => {
        if (viewingFeed) close();
    });
    chrome.runtime.onMessage.addListener((message) => {
        if (message?.type === 'RESPONSE_VIEWER_SET_CONTENT') {
            receivedContent = true;
            render(message);
        }
    });
    try { chrome.runtime.sendMessage({ type: 'RESPONSE_VIEWER_READY' }); } catch (_) {}
    loadStoredContent();
})();
