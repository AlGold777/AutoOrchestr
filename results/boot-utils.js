// Page boot, reload cleanup, and external-link helpers for the results page.
// Extracted verbatim from results.js (self-refactor) to shrink the monolith.
// Behaviour is identical to the previous inline implementation — do not "improve"
// it here without updating results.js callers.
(function installResultsBootUtils(root) {
    'use strict';

    if (!root || root.ResultsBootUtils) return;

    const DEBATE_TRANSCRIPT_STORAGE_KEY = 'aoEngineState.v1';

    const resetGeometryState = () => {
        const rootEl = document.documentElement;
        if (rootEl) {
            rootEl.style.removeProperty('--sidebar-left-width');
            rootEl.style.removeProperty('--sidebar-right-width');
            rootEl.style.removeProperty('--devtools-panels-height');
        }
        document.body?.classList.remove(
            'left-sidebar-open',
            'right-sidebar-open',
            'right-sidebar-closing',
            'right-sidebar-reset',
            'is-resizing'
        );
    };
    const recoverUiIfHidden = (reason = 'unknown') => {
        const shell = document.querySelector('.app-shell');
        if (!shell) return;
        const shellStyle = window.getComputedStyle(shell);
        const bodyStyle = window.getComputedStyle(document.body);
        const shellRect = shell.getBoundingClientRect();
        const textLen = String(shell.innerText || '').replace(/\s+/g, '').length;
        const shellHidden = shellStyle.display === 'none'
            || shellStyle.visibility === 'hidden'
            || Number(shellStyle.opacity || 1) === 0
            || shellRect.width < 20
            || shellRect.height < 20;
        const bodyHidden = bodyStyle.display === 'none'
            || bodyStyle.visibility === 'hidden'
            || Number(bodyStyle.opacity || 1) === 0;
        if (!(shellHidden || bodyHidden || textLen === 0)) return;

        const detail = {
            reason,
            shellHidden,
            bodyHidden,
            textLen,
            shellRect: { width: Math.round(shellRect.width), height: Math.round(shellRect.height) }
        };
        console.warn('[RESULTS] UI recovery triggered', detail);
        // Surface to background telemetry so the actual trigger condition (shellHidden /
        // bodyHidden / textLen0 / geometry-collapse) is captured in exported logs — this
        // is what pins the still-open geometry root cause from real runs.
        try {
            chrome?.runtime?.sendMessage?.({
                type: 'LLM_DIAGNOSTIC_EVENT',
                llmName: 'UI',
                event: {
                    type: 'UI_RECOVERY',
                    label: 'UI recovery triggered',
                    level: 'warning',
                    details: `reason=${reason} shellHidden=${shellHidden} bodyHidden=${bodyHidden} textLen=${textLen} w=${detail.shellRect.width} h=${detail.shellRect.height}`,
                    meta: detail
                }
            }, () => void chrome?.runtime?.lastError);
        } catch (_) {}
        resetGeometryState();
        document.body.classList.remove('pro-features-hidden', 'hidden');
        document.body.style.removeProperty('display');
        document.body.style.removeProperty('visibility');
        document.body.style.removeProperty('opacity');
        shell.style.removeProperty('display');
        shell.style.removeProperty('visibility');
        shell.style.removeProperty('opacity');
    };
    const isPageReloadNavigation = () => {
        try {
            const navEntry = performance?.getEntriesByType?.('navigation')?.[0];
            if (navEntry?.type === 'reload') return true;
        } catch (_) {}
        try {
            return performance?.navigation?.type === 1;
        } catch (_) {
            return false;
        }
    };
    // Reload starts a new workspace. Finish the background reset before any
    // page module can hydrate a draft, answers or telemetry from the old one.
    const prepareWorkingSession = async () => {
        await (root.StorageKeyMigration?.ready || Promise.resolve());
        const storage = root.chrome?.storage?.local || globalThis.chrome?.storage?.local;
        const runtime = root.chrome?.runtime || globalThis.chrome?.runtime;
        if (!isPageReloadNavigation()) {
            const saved = storage ? await new Promise((resolve, reject) => {
                const result = storage.get('llmComparatorWorkingSessionStartedAt', (value) => {
                    if (runtime?.lastError) reject(new Error(runtime.lastError.message));
                    else resolve(value || {});
                });
                if (result?.then) result.then((value) => resolve(value || {}), reject);
            }) : {};
            return { startedAt: Number(saved.llmComparatorWorkingSessionStartedAt) || 0 };
        }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Сброс рабочей сессии не подтверждён. Перезагрузите страницу ещё раз.')), 10000);
            const fail = (error) => { clearTimeout(timer); reject(error); };
            try {
                runtime.sendMessage({ type: 'RESET_WORKING_SESSION', reason: 'page_reload' }, (response) => {
                    if (runtime.lastError) { fail(new Error(runtime.lastError.message)); return; }
                    if (!response?.success || !(Number(response.startedAt) > 0)) {
                        fail(new Error(response?.error || 'Не удалось очистить рабочую сессию.'));
                        return;
                    }
                    clearTimeout(timer);
                    resolve({ startedAt: Number(response.startedAt) });
                });
            } catch (error) { fail(error); }
        });
    };
    const clearDebateTranscriptOnReload = () => new Promise((resolve) => {
        if (!isPageReloadNavigation()) {
            resolve(false);
            return;
        }
        const storage = (typeof chrome !== 'undefined' && chrome?.storage?.local) ? chrome.storage.local : null;
        if (!storage?.remove) {
            resolve(false);
            return;
        }
        try {
            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };
            const maybePromise = storage.remove(DEBATE_TRANSCRIPT_STORAGE_KEY, () => {
                if (chrome?.runtime?.lastError) {
                    console.warn('[results] debate transcript reload clear error', chrome.runtime.lastError);
                    finish(false);
                } else {
                    console.info('[RESULTS] debate transcript cleared on reload');
                    finish(true);
                }
            });
            if (maybePromise && typeof maybePromise.then === 'function') {
                maybePromise.then(() => {
                    console.info('[RESULTS] debate transcript cleared on reload');
                    finish(true);
                }).catch((err) => {
                    console.warn('[results] debate transcript reload clear failed', err);
                    finish(false);
                });
            }
            setTimeout(() => finish(true), 250);
        } catch (err) {
            console.warn('[results] debate transcript reload clear failed', err);
            resolve(false);
        }
    });
    const normalizeExternalLinkUrl = (href) => {
        const raw = String(href || '').trim();
        if (!raw || raw.startsWith('#')) return '';
        try {
            const url = new URL(raw, window.location.href);
            if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return '';
            return url.href;
        } catch (_) {
            return '';
        }
    };
    const decorateLinksForNewTab = (root) => {
        if (!root?.querySelectorAll) return;
        root.querySelectorAll('a[href]').forEach((anchor) => {
            const url = normalizeExternalLinkUrl(anchor.getAttribute('href') || anchor.href);
            if (!url) return;
            anchor.href = url;
            anchor.target = '_blank';
            anchor.rel = 'noopener noreferrer';
            anchor.setAttribute('contenteditable', 'false');
            anchor.classList.add('response-external-link');
        });
    };
    const openResponseLinkInNewTab = (url) => {
        if (!url) return;
        try {
            if (typeof chrome !== 'undefined' && chrome?.tabs?.create) {
                chrome.tabs.create({ url });
                return;
            }
        } catch (_) {}
        try {
            window.open(url, '_blank', 'noopener,noreferrer');
        } catch (_) {}
    };

    root.ResultsBootUtils = Object.freeze({
        resetGeometryState,
        recoverUiIfHidden,
        isPageReloadNavigation,
        prepareWorkingSession,
        clearDebateTranscriptOnReload,
        normalizeExternalLinkUrl,
        decorateLinksForNewTab,
        openResponseLinkInNewTab
    });
})(typeof window !== 'undefined' ? window : globalThis);
