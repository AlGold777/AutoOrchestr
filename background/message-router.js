

const API_MODE_STORAGE_KEY = 'llmComparatorApiModeEnabled';
const AUTO_FOCUS_NEW_TABS_KEY = 'autofocus_llm_tabs_enabled';
const DIAGNOSTICS_EVENTS_KEY = '__diagnostics_events__';
const DIAGNOSTICS_EXPORT_MAX_ITEMS = 2000;
const DIAGNOSTICS_EXPORT_MAX_BYTES = 1500000;
const llmStartChains = Object.create(null);
const routerSessionTimerManager = (() => {
    const register = (typeof self?.registerSessionTimer === 'function') ? self.registerSessionTimer : (id) => id;
    const deregister = (typeof self?.deregisterSessionTimer === 'function') ? self.deregisterSessionTimer : () => {};
    return { register, deregister };
})();
const routerRegisterSessionTimer = routerSessionTimerManager.register;
const routerDeregisterSessionTimer = routerSessionTimerManager.deregister;
const trustedInputFlightsByTab = new Map();
const geminiAttachmentFlightsByTab = new Map();
const qwenAttachmentFlightsByTab = new Map();
const providerAttachmentFlightsByTab = new Map();
// Browser-level debugging is permanently disabled. Keep this guard in the
// transport itself so a future permission/configuration change cannot bring
// back Chrome's "started debugging this browser" notification.
const BROWSER_DEBUGGING_DISABLED = true;
const debuggerSessionQueuesByTab = new Map();
const completionAuthorityAttempts = self.__completionAuthorityAttempts || new Map();
self.__completionAuthorityAttempts = completionAuthorityAttempts;
const completionRuntimeByTab = new Map();
const completionRuntimeRepairFlights = new Map();
const EXPECTED_COMPLETION_DETECTOR_VERSION = '2.3.0';
const EXPECTED_COMPLETION_PROTOCOL_VERSION = '2.3.1';

const expectedCompletionRuntime = () => ({
    buildVersion: chrome.runtime.getManifest().version,
    detectorVersion: EXPECTED_COMPLETION_DETECTOR_VERSION,
    protocolVersion: EXPECTED_COMPLETION_PROTOCOL_VERSION
});

const isCompletionRuntimeHealthy = (runtime) => {
    const expected = expectedCompletionRuntime();
    return runtime?.completionSessionAvailable === true
        && runtime?.buildVersion === expected.buildVersion
        && runtime?.detectorVersion === expected.detectorVersion
        && runtime?.protocolVersion === expected.protocolVersion;
};

// Readiness must not wait for document_idle or an unresponsive renderer.
const completionRuntimeDeadline = async (operation, timeoutMs = 6000) => {
    let timer;
    try {
        return await Promise.race([
            Promise.resolve().then(operation),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('completion_runtime_timeout')), timeoutMs);
            })
        ]);
    } finally {
        clearTimeout(timer);
    }
};

const probeCompletionRuntimeInTab = async (tabId) => {
    if (!Number.isInteger(Number(tabId)) || Number(tabId) <= 0 || !chrome?.scripting?.executeScript) return null;
    try {
        const results = await completionRuntimeDeadline(() => chrome.scripting.executeScript({
            target: { tabId: Number(tabId) },
            injectImmediately: true,
            func: () => {
                const detector = window.LLMExtension?.ResponseLifecycleDetector || window.ResponseLifecycleDetector;
                const protocol = window.CompletionProtocol;
                let buildVersion = 'unknown';
                try { buildVersion = chrome.runtime.getManifest().version || 'unknown'; } catch (_) {}
                return {
                    buildVersion: detector?.buildVersion || buildVersion,
                    detectorVersion: detector?.version || null,
                    protocolVersion: detector?.protocolVersion || protocol?.version || null,
                    completionSessionAvailable: typeof protocol?.CompletionSession === 'function'
                        && typeof detector?.startResponseLifecycleTracking === 'function'
                };
            }
        }));
        return results?.find((item) => item?.result)?.result || null;
    } catch (_) {
        return null;
    }
};

const ensureCompletionRuntimeInTab = (tabId, llmName) => {
    const numericTabId = Number(tabId);
    if (!Number.isInteger(numericTabId) || numericTabId <= 0) return Promise.resolve({ ok: false, reason: 'invalid_tab' });
    if (completionRuntimeRepairFlights.has(numericTabId)) return completionRuntimeRepairFlights.get(numericTabId);
    const cached = completionRuntimeByTab.get(numericTabId);
    if (isCompletionRuntimeHealthy(cached) && Date.now() - cached.verifiedAt < 30000) {
        return Promise.resolve({ ok: true, runtime: cached, cached: true });
    }
    const flight = (async () => {
        let runtime = await probeCompletionRuntimeInTab(numericTabId);
        if (!isCompletionRuntimeHealthy(runtime)) {
            try {
                await completionRuntimeDeadline(() => chrome.scripting.executeScript({
                    target: { tabId: numericTabId },
                    injectImmediately: true,
                    files: [
                        'shared/completion-protocol.js',
                        'content-utils/selector-resolver-v2.js',
                        'content-utils/response-lifecycle-detector.js',
                        'content-scripts/content-bootstrap.js'
                    ]
                }));
            } catch (error) {
                emitTelemetry(llmName || 'SYSTEM', 'COMPLETION_RUNTIME_REPAIR_FAILED', {
                    level: 'error',
                    details: error?.message || 'runtime injection failed',
                    meta: { tabId: numericTabId, expectedRuntime: expectedCompletionRuntime(), observedRuntime: runtime },
                    force: true
                });
                return { ok: false, reason: 'injection_failed', runtime };
            }
            runtime = await probeCompletionRuntimeInTab(numericTabId);
        }
        if (!isCompletionRuntimeHealthy(runtime)) {
            emitTelemetry(llmName || 'SYSTEM', 'COMPLETION_RUNTIME_UNAVAILABLE', {
                level: 'error',
                details: 'completion runtime contract mismatch',
                meta: { tabId: numericTabId, expectedRuntime: expectedCompletionRuntime(), observedRuntime: runtime },
                force: true
            });
            return { ok: false, reason: 'runtime_contract_mismatch', runtime };
        }
        completionRuntimeByTab.set(numericTabId, { ...runtime, verifiedAt: Date.now() });
        emitTelemetry(llmName || 'SYSTEM', 'COMPLETION_RUNTIME_REPAIRED', {
            level: 'success',
            details: 'completion runtime verified',
            meta: { tabId: numericTabId, runtime },
            force: true
        });
        try {
            await completionRuntimeDeadline(() => chrome.tabs.sendMessage(numericTabId, {
                type: 'REQUEST_SCRIPT_READY',
                llmName,
                reason: 'completion_runtime_verified'
            }), 1000);
        } catch (_) {}
        return { ok: true, runtime };
    })().finally(() => completionRuntimeRepairFlights.delete(numericTabId));
    completionRuntimeRepairFlights.set(numericTabId, flight);
    return flight;
};
self.ensureCompletionRuntimeInTab = ensureCompletionRuntimeInTab;

try {
    chrome.tabs?.onRemoved?.addListener?.((tabId) => {
        completionRuntimeByTab.delete(Number(tabId));
        completionRuntimeRepairFlights.delete(Number(tabId));
    });
    chrome.tabs?.onUpdated?.addListener?.((tabId, changeInfo) => {
        if (changeInfo?.status === 'loading' || changeInfo?.url) completionRuntimeByTab.delete(Number(tabId));
    });
} catch (_) {}

function withManagedDebuggerSession(tabId, label, operation) {
    if (!Number.isInteger(tabId) || tabId <= 0) return Promise.reject(new Error('invalid_tab'));
    if (typeof operation !== 'function') return Promise.reject(new Error('missing_debugger_operation'));
    const queuedAt = Date.now();
    const previous = debuggerSessionQueuesByTab.get(tabId) || Promise.resolve();
    const run = previous.catch(() => undefined).then(async () => {
        const target = { tabId };
        let attached = false;
        try {
            await callChromeDebugger('attach', target, '1.3');
            attached = true;
            emitTelemetry('SYSTEM', 'DEBUGGER_SESSION_ACQUIRED', {
                details: String(label || 'debugger_operation'),
                meta: { tabId, label: label || null, queuedAt, acquiredAt: Date.now(), queueWaitMs: Date.now() - queuedAt },
                force: true
            });
            return await operation(target);
        } finally {
            if (attached) {
                try { await callChromeDebugger('detach', target); } catch (_) {}
            }
            emitTelemetry('SYSTEM', 'DEBUGGER_SESSION_RELEASED', {
                details: String(label || 'debugger_operation'),
                meta: { tabId, label: label || null, releasedAt: Date.now() },
                force: true
            });
        }
    });
    const tail = run.catch(() => undefined);
    debuggerSessionQueuesByTab.set(tabId, tail);
    tail.finally(() => {
        if (debuggerSessionQueuesByTab.get(tabId) === tail) {
            debuggerSessionQueuesByTab.delete(tabId);
        }
    });
    return run;
}
const DEBUGGER_RPC_TYPES = new Set([
    'GROK_TRUSTED_INPUT_REQUEST',
    'LECHAT_TRUSTED_SEND_REQUEST',
    'PROVIDER_TRUSTED_SEND_REQUEST',
    'KIMI_TRUSTED_SEND_REQUEST',
    'KIMI_TRUSTED_INPUT_REQUEST',
    'PERPLEXITY_TRUSTED_ENTER_REQUEST',
    'PERPLEXITY_TRUSTED_INPUT_REQUEST',
    'PROVIDER_TRUSTED_INPUT_REQUEST',
    'GEMINI_CDP_ATTACH_REQUEST',
    'QWEN_CDP_ATTACH_REQUEST',
    'PROVIDER_CDP_ATTACH_REQUEST'
]);
// PERPLEXITY_TRUSTED_INPUT_REQUEST is the donor 2.81.75 insertion path and is
// enabled for the same reason the send routes are: Perplexity's composer refuses
// in-page insertion. dispatchProviderTrustedInput focuses the composer, issues a
// native SelectAll and a native Input.insertText — that SelectAll is also what
// replaces leftover text in a reused tab, which the execCommand-based clear()
// cannot do when the editor ignores it.
const ENABLED_DEBUGGER_RPC_TYPES = new Set([
    'PROVIDER_TRUSTED_SEND_REQUEST',
    'KIMI_TRUSTED_SEND_REQUEST',
    'KIMI_TRUSTED_INPUT_REQUEST',
    'PERPLEXITY_TRUSTED_ENTER_REQUEST',
    'PERPLEXITY_TRUSTED_INPUT_REQUEST'
]);

const callChromeDebugger = (method, ...args) => new Promise((resolve, reject) => {
    if (BROWSER_DEBUGGING_DISABLED) {
        reject(new Error('browser_debugging_disabled'));
        return;
    }
    try {
        chrome.debugger[method](...args, (result) => {
            const err = chrome.runtime.lastError;
            if (err) {
                reject(new Error(err.message || `chrome.debugger.${method} failed`));
                return;
            }
            resolve(result);
        });
    } catch (err) {
        reject(err);
    }
});

// Reported 2026-07-31: the debugger transport "interferes with work". Part of
// that is the attach banner, which CDP cannot avoid — but the other part was
// Page.bringToFront, which yanks the Chrome window in front of whatever
// application the user is in, once per trusted action.
//
// CDP input targets the tab's renderer directly and the composer is focused
// through Runtime.evaluate, so the OS window does not need to be frontmost. The
// raise is kept only while the user is already in Chrome, matching the donor's
// visible behaviour there, and skipped entirely when they are elsewhere.
const bringToFrontUnlessUserIsElsewhere = async (target) => {
    const browserHasFocus = await new Promise((resolve) => {
        try {
            chrome.windows.getLastFocused({}, (win) => {
                if (chrome.runtime.lastError || !win) {
                    resolve(false);
                    return;
                }
                resolve(win.focused === true);
            });
        } catch (_) {
            resolve(false);
        }
    });
    if (!browserHasFocus) return false;
    try {
        await callChromeDebugger('sendCommand', target, 'Page.bringToFront');
        return true;
    } catch (_) {
        return false;
    }
};

const callChromeDownloads = (method, ...args) => new Promise((resolve, reject) => {
    try {
        chrome.downloads[method](...args, (result) => {
            const err = chrome.runtime.lastError;
            if (err) {
                reject(new Error(err.message || `chrome.downloads.${method} failed`));
                return;
            }
            resolve(result);
        });
    } catch (err) {
        reject(err);
    }
});

const routerSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let internalDownloadUiSuppressions = 0;

const setInternalDownloadUiEnabled = (enabled) => new Promise((resolve) => {
    const api = chrome.downloads?.setUiOptions;
    if (typeof api !== 'function') {
        resolve(false);
        return;
    }
    try {
        api.call(chrome.downloads, { enabled }, () => {
            const err = chrome.runtime.lastError;
            resolve(!err);
        });
    } catch (_) {
        resolve(false);
    }
});

async function acquireInternalDownloadUiSuppression() {
    internalDownloadUiSuppressions += 1;
    if (internalDownloadUiSuppressions > 1) return true;
    const suppressed = await setInternalDownloadUiEnabled(false);
    if (!suppressed) internalDownloadUiSuppressions = Math.max(0, internalDownloadUiSuppressions - 1);
    return suppressed;
}

async function releaseInternalDownloadUiSuppression() {
    internalDownloadUiSuppressions = Math.max(0, internalDownloadUiSuppressions - 1);
    if (internalDownloadUiSuppressions === 0) await setInternalDownloadUiEnabled(true);
}

const sanitizeAttachmentFilename = (value = '', index = 0) => {
    const cleaned = String(value || `attachment-${index + 1}`)
        .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_')
        .replace(/^\.+/, '')
        .slice(0, 180);
    return cleaned || `attachment-${index + 1}`;
};

async function cleanupMaterializedDownload(id) {
    if (!Number.isInteger(id)) return;
    try { await callChromeDownloads('cancel', id); } catch (_) {}
    try { await callChromeDownloads('removeFile', id); } catch (_) {}
    try { await callChromeDownloads('erase', { id }); } catch (_) {}
}

const GEMINI_ATTACHMENT_CLEANUP_PREFIX = 'gemini-attachment-cleanup:';
const scheduleMaterializedDownloadCleanup = (id, delayMs = 120000) => {
    if (!Number.isInteger(id)) return;
    try {
        chrome.alarms.create(`${GEMINI_ATTACHMENT_CLEANUP_PREFIX}${id}`, {
            when: Date.now() + delayMs
        });
    } catch (_) {
        setTimeout(() => { void cleanupMaterializedDownload(id); }, delayMs);
    }
};

try {
    chrome.alarms?.onAlarm?.addListener?.((alarm) => {
        const name = String(alarm?.name || '');
        if (!name.startsWith(GEMINI_ATTACHMENT_CLEANUP_PREFIX)) return;
        const id = Number(name.slice(GEMINI_ATTACHMENT_CLEANUP_PREFIX.length));
        if (Number.isInteger(id)) void cleanupMaterializedDownload(id);
    });
} catch (_) {}

async function materializeGeminiAttachments(attachments = []) {
    const items = Array.isArray(attachments) ? attachments : [];
    if (!items.length) throw new Error('no_attachments');
    const totalBytes = items.reduce((sum, item) => sum + String(item?.base64 || '').length, 0);
    if (totalBytes > 100 * 1024 * 1024) throw new Error('attachments_too_large');
    const runDir = `LLM_Codex_Attachments/${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const materialized = [];
    const createdIds = [];
    const downloadUiSuppressed = await acquireInternalDownloadUiSuppression();
    if (!downloadUiSuppressed) throw new Error('download_ui_suppression_unavailable');
    try {
        for (let i = 0; i < items.length; i++) {
            const item = items[i] || {};
            const url = String(item.base64 || '');
            if (!/^data:[^,]+;base64,/i.test(url)) throw new Error('invalid_attachment_payload');
            const filename = `${runDir}/${sanitizeAttachmentFilename(item.name, i)}`;
            const id = await callChromeDownloads('download', {
                url,
                filename,
                conflictAction: 'uniquify',
                saveAs: false
            });
            createdIds.push(id);
            let download = null;
            for (let attempt = 0; attempt < 100; attempt++) {
                const matches = await callChromeDownloads('search', { id });
                download = Array.isArray(matches) ? matches[0] : null;
                if (download?.state === 'complete' && download.filename) break;
                if (download?.error) throw new Error(`attachment_download_failed:${download.error}`);
                await routerSleep(100);
            }
            if (!download?.filename || download.state !== 'complete') throw new Error('attachment_download_timeout');
            materialized.push({ id, filename: download.filename });
        }
        return materialized;
    } catch (err) {
        await Promise.allSettled(createdIds.map(cleanupMaterializedDownload));
        throw err;
    } finally {
        await releaseInternalDownloadUiSuppression();
    }
}

const GEMINI_FIND_FILE_INPUT_EXPRESSION = `(() => {
  const queue = [document];
  const seen = new Set();
  while (queue.length) {
    const root = queue.shift();
    if (!root || seen.has(root)) continue;
    seen.add(root);
    const input = root.querySelector?.('input[type="file"]');
    if (input) return input;
    for (const el of root.querySelectorAll?.('*') || []) {
      if (el.shadowRoot) queue.push(el.shadowRoot);
    }
  }
  return null;
})()`;

const GEMINI_FIND_UPLOAD_TRIGGER_EXPRESSION = `(() => {
  const collect = () => {
    const roots = [document]; const nodes = []; const seen = new Set();
    while (roots.length) {
      const root = roots.shift(); if (!root || seen.has(root)) continue; seen.add(root);
      for (const el of root.querySelectorAll?.('button,[role="button"],[role="menuitem"],[role="option"]') || []) {
        nodes.push(el); if (el.shadowRoot) roots.push(el.shadowRoot);
      }
      for (const el of root.querySelectorAll?.('*') || []) if (el.shadowRoot) roots.push(el.shadowRoot);
    }
    return nodes;
  };
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const label = (el) => [
    el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('data-testid'),
    el.getAttribute('data-test-id'), el.textContent
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const score = (el) => {
    const value = label(el);
    if (!value || /send|submit|remove|delete|отправ|удал|enviar|eliminar/i.test(value)) return -1;
    // Status/help controls also contain the word "file" (for example Gemini's
    // Russian "Файл не прикреплен, нужна помощь: дополнительные параметры").
    // Clicking it repeatedly never opens a chooser and starves the real upload
    // button, so reject status/help/menu-overflow language before positive scores.
    if (/file not attached|file wasn'?t attached|файл не прикреплен|нужна помощь|need help|help|more options|additional options|дополнительные параметры|feedback|справк/i.test(value)) return -1;
    const menuBonus = /menuitem|option/i.test(el.getAttribute('role') || '') ? 30 : 0;
    if (/upload files?|upload from (?:computer|device)|загрузить файл|с компьютера|с устройства|subir archivos?|desde (?:el )?(?:ordenador|dispositivo)|téléverser|datei(?:en)? hochladen|carica file/i.test(value)) return 120 + menuBonus;
    if (/open upload menu|add files?|добавить файлы?|открыть меню загрузки/i.test(value)) return 90 + menuBonus;
    if (/open upload|add files?|attach files?|прикреп|добавить файл|загруз|subir|adjuntar|añadir archivos?|téléverser|joindre|hochladen|anhängen|carica|allega/i.test(value)) return 70;
    if (/upload|attachment|file upload/i.test(value)) return 50;
    return -1;
  };
  return collect()
    .filter(visible)
    .map((el) => ({ el, score: score(el) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score)[0]?.el || null;
})()`;

async function findGeminiFileInputObject(target) {
    const result = await callChromeDebugger('sendCommand', target, 'Runtime.evaluate', {
        expression: GEMINI_FIND_FILE_INPUT_EXPRESSION,
        returnByValue: false,
        awaitPromise: false
    });
    return result?.result?.objectId || null;
}

async function readDebuggerPageUrl(target) {
    try {
        const result = await callChromeDebugger('sendCommand', target, 'Runtime.evaluate', {
            expression: 'location.href',
            returnByValue: true,
            awaitPromise: false
        });
        return String(result?.result?.value || '');
    } catch (_) {
        return '';
    }
}

async function findGeminiUploadTriggerObject(target) {
    const result = await callChromeDebugger('sendCommand', target, 'Runtime.evaluate', {
        expression: GEMINI_FIND_UPLOAD_TRIGGER_EXPRESSION,
        returnByValue: false,
        awaitPromise: false
    });
    return result?.result?.objectId || null;
}

async function trustedClickDebuggerObject(target, objectId) {
    if (!objectId) return false;
    try {
        const descriptionResult = await callChromeDebugger('sendCommand', target, 'Runtime.callFunctionOn', {
            objectId,
            functionDeclaration: `function () {
                return {
                    tag: this.tagName || '',
                    role: this.getAttribute?.('role') || '',
                    label: [
                        this.getAttribute?.('aria-label'), this.getAttribute?.('title'),
                        this.getAttribute?.('data-testid'), this.getAttribute?.('data-test-id'),
                        this.textContent
                    ].filter(Boolean).join(' ').replace(/\\s+/g, ' ').trim().slice(0, 240)
                };
            }`,
            returnByValue: true
        });
        const descriptor = descriptionResult?.result?.value || null;
        await callChromeDebugger('sendCommand', target, 'Runtime.callFunctionOn', {
            objectId,
            functionDeclaration: 'function () { this.scrollIntoView({ block: "center", inline: "center" }); }',
            returnByValue: true
        });
        await routerSleep(75);
        const model = await callChromeDebugger('sendCommand', target, 'DOM.getBoxModel', { objectId });
        const quad = model?.model?.content;
        if (!Array.isArray(quad) || quad.length < 8) return false;
        const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
        const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
        await callChromeDebugger('sendCommand', target, 'Input.dispatchMouseEvent', {
            type: 'mouseMoved', x, y
        });
        await callChromeDebugger('sendCommand', target, 'Input.dispatchMouseEvent', {
            type: 'mousePressed', x, y, button: 'left', clickCount: 1
        });
        await callChromeDebugger('sendCommand', target, 'Input.dispatchMouseEvent', {
            type: 'mouseReleased', x, y, button: 'left', clickCount: 1
        });
        return { clicked: true, descriptor };
    } finally {
        try { await callChromeDebugger('sendCommand', target, 'Runtime.releaseObject', { objectId }); } catch (_) {}
    }
}

function observeGeminiFileChooser(tabId) {
    let backendNodeId = null;
    const listener = (source, method, params) => {
        if (source?.tabId !== tabId || method !== 'Page.fileChooserOpened') return;
        const candidate = Number(params?.backendNodeId);
        if (Number.isInteger(candidate) && candidate > 0) backendNodeId = candidate;
    };
    chrome.debugger.onEvent.addListener(listener);
    return {
        getBackendNodeId: () => backendNodeId,
        dispose: () => {
            try { chrome.debugger.onEvent.removeListener(listener); } catch (_) {}
        }
    };
}

async function dispatchGeminiCdpAttachments(tabId, attachments = []) {
    if (!Number.isInteger(tabId) || tabId <= 0) throw new Error('invalid_tab');
    if (geminiAttachmentFlightsByTab.has(tabId)) return geminiAttachmentFlightsByTab.get(tabId);
    const flight = (async () => {
        const startedAt = Date.now();
        const materialized = await materializeGeminiAttachments(attachments);
        emitTelemetry('Gemini', 'GEMINI_CDP_FILES_MATERIALIZED', {
            details: `files=${materialized.length}`,
            force: true,
            meta: { tabId, fileCount: materialized.length, elapsedMs: Date.now() - startedAt }
        });
        try {
            return await withManagedDebuggerSession(tabId, 'gemini_cdp_attachments', async (target) => {
            let chooserObserver = null;
            try {
            emitTelemetry('Gemini', 'GEMINI_CDP_DEBUGGER_ATTACHED', {
                force: true,
                meta: { tabId, elapsedMs: Date.now() - startedAt }
            });
            await callChromeDebugger('sendCommand', target, 'Runtime.enable');
            await callChromeDebugger('sendCommand', target, 'DOM.enable');
            await callChromeDebugger('sendCommand', target, 'Page.enable');
            chooserObserver = observeGeminiFileChooser(tabId);
            await callChromeDebugger('sendCommand', target, 'Page.setInterceptFileChooserDialog', { enabled: true });

            let objectId = await findGeminiFileInputObject(target);
            let backendNodeId = chooserObserver.getBackendNodeId();
            for (let attempt = 0; !objectId && !backendNodeId && attempt < 12; attempt++) {
                await bringToFrontUnlessUserIsElsewhere(target);
                await routerSleep(150);
                const triggerObjectId = await findGeminiUploadTriggerObject(target);
                if (triggerObjectId) {
                    const clickResult = await trustedClickDebuggerObject(target, triggerObjectId);
                    if (clickResult?.clicked) {
                        const triggerLabel = String(clickResult?.descriptor?.label || 'unlabeled');
                        emitTelemetry('Gemini', 'GEMINI_CDP_UPLOAD_TRIGGER_CLICKED', {
                            details: triggerLabel,
                            force: true,
                            meta: {
                                tabId,
                                attempt: attempt + 1,
                                trigger: clickResult.descriptor,
                                elapsedMs: Date.now() - startedAt
                            }
                        });
                    }
                }
                await routerSleep(350);
                backendNodeId = chooserObserver.getBackendNodeId();
                if (backendNodeId) break;
                objectId = await findGeminiFileInputObject(target);
            }
            if (!objectId && !backendNodeId) throw new Error('gemini_file_chooser_not_opened');
            emitTelemetry('Gemini', 'GEMINI_CDP_FILE_INPUT_FOUND', {
                force: true,
                meta: {
                    tabId,
                    source: backendNodeId ? 'file_chooser' : 'dom_input',
                    elapsedMs: Date.now() - startedAt
                }
            });
            const setFilesParams = { files: materialized.map((item) => item.filename) };
            if (backendNodeId) setFilesParams.backendNodeId = backendNodeId;
            else setFilesParams.objectId = objectId;
            await callChromeDebugger('sendCommand', target, 'DOM.setFileInputFiles', setFilesParams);
            emitTelemetry('Gemini', 'GEMINI_CDP_FILES_ASSIGNED', {
                details: `files=${materialized.length}`,
                force: true,
                meta: { tabId, fileCount: materialized.length, elapsedMs: Date.now() - startedAt }
            });
            return { ok: true, method: 'cdp_set_file_input', uploadedCount: materialized.length };
            } finally {
                chooserObserver?.dispose?.();
                try {
                    await callChromeDebugger('sendCommand', target, 'Page.setInterceptFileChooserDialog', { enabled: false });
                } catch (_) {}
            }
            });
        } finally {
            // Gemini may read large files asynchronously after the input change.
            // Keep the materialized source alive longer than the 90s UI confirmation
            // budget so cleanup cannot truncate an otherwise valid upload.
            materialized.forEach(({ id }) => scheduleMaterializedDownloadCleanup(id, 120000));
        }
    })().finally(() => geminiAttachmentFlightsByTab.delete(tabId));
    geminiAttachmentFlightsByTab.set(tabId, flight);
    return flight;
}

const QWEN_FIND_FILE_INPUT_EXPRESSION = `(() => {
  const direct = document.querySelector('input#filesUpload[type="file"]');
  if (direct) return direct;
  const queue = [document]; const seen = new Set();
  while (queue.length) {
    const root = queue.shift(); if (!root || seen.has(root)) continue; seen.add(root);
    const input = root.querySelector?.('input[type="file"]');
    if (input) return input;
    for (const el of root.querySelectorAll?.('*') || []) if (el.shadowRoot) queue.push(el.shadowRoot);
  }
  return null;
})()`;

async function dispatchQwenCdpAttachments(tabId, attachments = []) {
    if (!Number.isInteger(tabId) || tabId <= 0) throw new Error('invalid_tab');
    if (qwenAttachmentFlightsByTab.has(tabId)) return qwenAttachmentFlightsByTab.get(tabId);
    const flight = (async () => {
        const startedAt = Date.now();
        const materialized = await materializeGeminiAttachments(attachments);
        try {
            return await withManagedDebuggerSession(tabId, 'qwen_cdp_attachments', async (target) => {
            let objectId = null;
            try {
            await callChromeDebugger('sendCommand', target, 'Runtime.enable');
            await callChromeDebugger('sendCommand', target, 'DOM.enable');
            await callChromeDebugger('sendCommand', target, 'Page.enable');
            await bringToFrontUnlessUserIsElsewhere(target);
            const evaluated = await callChromeDebugger('sendCommand', target, 'Runtime.evaluate', {
                expression: QWEN_FIND_FILE_INPUT_EXPRESSION,
                returnByValue: false,
                awaitPromise: false
            });
            objectId = evaluated?.result?.objectId || null;
            if (!objectId) throw new Error('qwen_file_input_not_found');
            await callChromeDebugger('sendCommand', target, 'DOM.setFileInputFiles', {
                objectId,
                files: materialized.map((item) => item.filename)
            });
            emitTelemetry('Qwen', 'QWEN_CDP_FILES_ASSIGNED', {
                details: `files=${materialized.length}`,
                force: true,
                meta: { tabId, fileCount: materialized.length, elapsedMs: Date.now() - startedAt }
            });
            return { ok: true, method: 'qwen_cdp_set_file_input', uploadedCount: materialized.length };
            } finally {
                if (objectId) {
                    try { await callChromeDebugger('sendCommand', target, 'Runtime.releaseObject', { objectId }); } catch (_) {}
                }
            }
            });
        } finally {
            materialized.forEach(({ id }) => scheduleMaterializedDownloadCleanup(id, 120000));
        }
    })().finally(() => qwenAttachmentFlightsByTab.delete(tabId));
    qwenAttachmentFlightsByTab.set(tabId, flight);
    return flight;
}

const PROVIDER_FILE_INPUT_EXPRESSION = `(() => {
  const queue = [document]; const seen = new Set();
  while (queue.length) {
    const root = queue.shift(); if (!root || seen.has(root)) continue; seen.add(root);
    const inputs = Array.from(root.querySelectorAll?.('input[type="file"]') || [])
      .filter((candidate) => !candidate.disabled)
      .sort((a, b) => {
        const score = (el) => {
          const meta = [el.accept, el.multiple ? 'multiple' : '', el.getAttribute('aria-label'), el.getAttribute('data-testid'), el.name, el.id].filter(Boolean).join(' ').toLowerCase();
          let value = 0;
          if (/attach|upload|file|paperclip/.test(meta)) value += 40;
          if (/pdf|text|document|application/.test(meta)) value += 25;
          if (el.multiple) value += 10;
          if (/avatar|profile|photo/.test(meta)) value -= 80;
          if (el.closest('form, [data-testid*="composer" i], [class*="composer" i], [role="search"]')) value += 30;
          return value;
        };
        return score(b) - score(a);
      });
    if (inputs[0]) return inputs[0];
    for (const el of root.querySelectorAll?.('*') || []) if (el.shadowRoot) queue.push(el.shadowRoot);
  }
  return null;
})()`;

async function findProviderFileInputObject(target) {
    const result = await callChromeDebugger('sendCommand', target, 'Runtime.evaluate', {
        expression: PROVIDER_FILE_INPUT_EXPRESSION,
        returnByValue: false,
        awaitPromise: false
    });
    return result?.result?.objectId || null;
}

async function dispatchProviderCdpAttachments(tabId, model, attachments = []) {
    if (!Number.isInteger(tabId) || tabId <= 0) throw new Error('invalid_tab');
    if (providerAttachmentFlightsByTab.has(tabId)) return providerAttachmentFlightsByTab.get(tabId);
    const flight = (async () => {
        const materialized = await materializeGeminiAttachments(attachments);
        try {
            return await withManagedDebuggerSession(tabId, `provider_cdp_attachments:${model}`, async (target) => {
            let objectId = null;
            let chooserObserver = null;
            try {
            await callChromeDebugger('sendCommand', target, 'Runtime.enable');
            await callChromeDebugger('sendCommand', target, 'DOM.enable');
            await callChromeDebugger('sendCommand', target, 'Page.enable');
            await bringToFrontUnlessUserIsElsewhere(target);
            let backendNodeId = null;
            if (model === 'Perplexity') {
                chooserObserver = observeGeminiFileChooser(tabId);
                await callChromeDebugger('sendCommand', target, 'Page.setInterceptFileChooserDialog', { enabled: true });
                // Perplexity creates its native file input lazily after the first
                // "Add files" click. Check for that input before and after every
                // click. The old loop watched only for a chooser event, so it
                // skipped the usable input and clicked the paid-plan menu item;
                // after returning from /pro/payment it repeated the same mistake.
                objectId = await findProviderFileInputObject(target);
                for (let attempt = 0; attempt < 2 && !objectId && !backendNodeId; attempt++) {
                    const triggerObjectId = await findGeminiUploadTriggerObject(target);
                    if (!triggerObjectId) break;
                    const clickResult = await trustedClickDebuggerObject(target, triggerObjectId);
                    emitTelemetry(model, 'PROVIDER_UPLOAD_TRIGGER_CLICKED', {
                        details: String(clickResult?.descriptor?.label || 'unlabeled'), force: true,
                        meta: { tabId, attempt: attempt + 1, trigger: clickResult?.descriptor || null }
                    });
                    await routerSleep(300);
                    backendNodeId = chooserObserver.getBackendNodeId();
                    const currentUrl = await readDebuggerPageUrl(target);
                    if (/\/pro\/payment(?:\?|\/|$)/i.test(currentUrl)) {
                        throw new Error('perplexity_file_upload_paywall_navigation');
                    }
                    if (!backendNodeId) objectId = await findProviderFileInputObject(target);
                }
                if (!backendNodeId && !objectId) throw new Error('perplexity_file_input_not_found');
            }
            if (!objectId) {
                objectId = await findProviderFileInputObject(target);
            }
            if (!objectId && !backendNodeId) throw new Error('provider_file_input_not_found');
            const setFilesParams = { files: materialized.map((item) => item.filename) };
            if (backendNodeId) setFilesParams.backendNodeId = backendNodeId;
            else setFilesParams.objectId = objectId;
            await callChromeDebugger('sendCommand', target, 'DOM.setFileInputFiles', setFilesParams);
            if (objectId && !backendNodeId) {
                await callChromeDebugger('sendCommand', target, 'Runtime.callFunctionOn', {
                    objectId,
                    functionDeclaration: `function () {
                      this.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                      this.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                    }`,
                    returnByValue: true
                });
            }
            emitTelemetry(model, 'PROVIDER_CDP_FILES_ASSIGNED', {
                details: `files=${materialized.length}`,
                force: true,
                meta: { tabId, fileCount: materialized.length, source: backendNodeId ? 'file_chooser' : 'dom_input' }
            });
            return { ok: true, method: 'provider_cdp_set_file_input', uploadedCount: materialized.length };
            } finally {
                chooserObserver?.dispose?.();
                try { await callChromeDebugger('sendCommand', target, 'Page.setInterceptFileChooserDialog', { enabled: false }); } catch (_) {}
                if (objectId) {
                    try { await callChromeDebugger('sendCommand', target, 'Runtime.releaseObject', { objectId }); } catch (_) {}
                }
            }
            });
        } finally {
            materialized.forEach(({ id }) => scheduleMaterializedDownloadCleanup(id, 120000));
        }
    })().finally(() => providerAttachmentFlightsByTab.delete(tabId));
    providerAttachmentFlightsByTab.set(tabId, flight);
    return flight;
}

async function dispatchTrustedGrokInput(tabId, mode, text = '', isMac = false) {
    if (!Number.isInteger(tabId) || tabId <= 0) throw new Error('invalid_tab');
    if (!['paste', 'insertText'].includes(mode)) throw new Error('invalid_mode');
    if (mode === 'insertText' && (!text || text.length > 250000)) throw new Error('invalid_text');
    if (trustedInputFlightsByTab.has(tabId)) return trustedInputFlightsByTab.get(tabId);
    const flight = (async () => {
        return withManagedDebuggerSession(tabId, 'trusted_grok_input', async (target) => {
            if (mode === 'insertText') {
                await callChromeDebugger('sendCommand', target, 'Input.insertText', { text });
                return { ok: true, method: 'cdp_insert_text' };
            }
            const modifiers = isMac ? 4 : 2; // CDP: Ctrl=2, Meta=4
            await callChromeDebugger('sendCommand', target, 'Input.dispatchKeyEvent', {
                type: 'rawKeyDown',
                key: 'v',
                code: 'KeyV',
                windowsVirtualKeyCode: 86,
                nativeVirtualKeyCode: 86,
                modifiers,
                commands: ['Paste']
            });
            await callChromeDebugger('sendCommand', target, 'Input.dispatchKeyEvent', {
                type: 'keyUp',
                key: 'v',
                code: 'KeyV',
                windowsVirtualKeyCode: 86,
                nativeVirtualKeyCode: 86,
                modifiers
            });
            return { ok: true, method: isMac ? 'cdp_cmd_v' : 'cdp_ctrl_v' };
        });
    })().finally(() => trustedInputFlightsByTab.delete(tabId));
    trustedInputFlightsByTab.set(tabId, flight);
    return flight;
}

async function dispatchTrustedCtrlEnter(tabId) {
    if (!Number.isInteger(tabId) || tabId <= 0) throw new Error('invalid_tab');
    return withManagedDebuggerSession(tabId, 'trusted_ctrl_enter', async (target) => {
        await bringToFrontUnlessUserIsElsewhere(target);
        await callChromeDebugger('sendCommand', target, 'Input.dispatchKeyEvent', {
            type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
            nativeVirtualKeyCode: 13, modifiers: 2
        });
        await callChromeDebugger('sendCommand', target, 'Input.dispatchKeyEvent', {
            type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
            nativeVirtualKeyCode: 13, modifiers: 2
        });
        return { ok: true, method: 'cdp_ctrl_enter' };
    });
}

const buildProviderComposerFocusExpression = (expectedText = '') => `(() => {
  const expected = ${JSON.stringify(String(expectedText || ''))};
  const normalize = (value) => String(value || '').normalize('NFKC')
    .replace(/[\\u200B-\\u200D\\u2060\\uFEFF]/g, '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const normalizedExpected = normalize(expected);
  const matchesPrompt = (value) => {
    const actual = normalize(value);
    return Boolean(normalizedExpected) && actual === normalizedExpected;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && style.display !== 'none'
      && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
  };
  const candidates = Array.from(document.querySelectorAll(
    'textarea[data-testid="search-input"],form[role="search"] textarea,textarea,[contenteditable="true"][role="textbox"],[contenteditable="plaintext-only"],[contenteditable="true"]'
  ));
  const composer = candidates.find((el) => visible(el)
    && matchesPrompt(el.value || el.innerText || el.textContent || ''));
  if (!composer) return false;
  composer.focus();
  return document.activeElement === composer;
})()`;

async function dispatchProviderTrustedEnter(tabId, model, expectedText) {
    if (!Number.isInteger(tabId) || tabId <= 0) throw new Error('invalid_tab');
    return withManagedDebuggerSession(tabId, `provider_trusted_enter:${model}`, async (target) => {
        await callChromeDebugger('sendCommand', target, 'Runtime.enable');
        await bringToFrontUnlessUserIsElsewhere(target);
        const focused = await callChromeDebugger('sendCommand', target, 'Runtime.evaluate', {
            expression: buildProviderComposerFocusExpression(expectedText),
            returnByValue: true,
            awaitPromise: false
        });
        if (focused?.result?.value !== true) throw new Error('filled_composer_not_found');
        await callChromeDebugger('sendCommand', target, 'Input.dispatchKeyEvent', {
            type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
            nativeVirtualKeyCode: 13, modifiers: 0
        });
        await callChromeDebugger('sendCommand', target, 'Input.dispatchKeyEvent', {
            type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
            nativeVirtualKeyCode: 13, modifiers: 0
        });
        emitTelemetry(model, 'PROVIDER_TRUSTED_ENTER_DISPATCHED', {
            details: 'filled composer + native Enter', force: true, meta: { tabId }
        });
        return { ok: true, method: 'cdp_focused_composer_enter' };
    });
}

async function dispatchProviderTrustedInput(tabId, model, text, isMac = false) {
    if (!Number.isInteger(tabId) || tabId <= 0) throw new Error('invalid_tab');
    if (!String(text || '') || String(text).length > 250000) throw new Error('invalid_text');
    return withManagedDebuggerSession(tabId, `provider_trusted_input:${model}`, async (target) => {
        await callChromeDebugger('sendCommand', target, 'Runtime.enable');
        await bringToFrontUnlessUserIsElsewhere(target);
        const focused = await callChromeDebugger('sendCommand', target, 'Runtime.evaluate', {
            expression: `(() => {
              const visible = (el) => {
                const rect = el?.getBoundingClientRect?.();
                const style = el ? getComputedStyle(el) : null;
                return !!(rect && rect.width > 0 && rect.height > 0
                  && style?.display !== 'none' && style?.visibility !== 'hidden');
              };
              const selector = [
                'textarea[data-testid="search-input"]',
                'form[role="search"] textarea',
                'div[contenteditable="true"][role="textbox"]',
                '[contenteditable="plaintext-only"]',
                'form [contenteditable="true"]',
                '[data-testid*="composer" i] [contenteditable="true"]',
                'textarea'
              ].join(',');
              const active = document.activeElement?.matches?.(selector) && visible(document.activeElement)
                ? document.activeElement : null;
              const composer = active || Array.from(document.querySelectorAll(selector)).find(visible);
              if (!composer) return false;
              composer.focus();
              return document.activeElement === composer;
            })()`,
            returnByValue: true,
            awaitPromise: false
        });
        if (focused?.result?.value !== true) throw new Error('composer_not_found');
        const modifiers = isMac ? 4 : 2;
        await callChromeDebugger('sendCommand', target, 'Input.dispatchKeyEvent', {
            type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65,
            nativeVirtualKeyCode: 65, modifiers, commands: ['SelectAll']
        });
        await callChromeDebugger('sendCommand', target, 'Input.dispatchKeyEvent', {
            type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65,
            nativeVirtualKeyCode: 65, modifiers
        });
        await callChromeDebugger('sendCommand', target, 'Input.insertText', { text: String(text) });
        emitTelemetry(model, 'PROVIDER_TRUSTED_INPUT_DISPATCHED', {
            details: 'focused composer + native text', force: true, meta: { tabId, textLength: String(text).length }
        });
        return { ok: true, method: 'cdp_focused_composer_input' };
    });
}

const buildProviderSendControlExpression = (expectedText = '') => `(() => {
  const expected = ${JSON.stringify(String(expectedText || ''))};
  const normalize = (value) => String(value || '').normalize('NFKC')
    .replace(/[\\u200B-\\u200D\\u2060\\uFEFF]/g, '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const normalizedExpected = normalize(expected);
  const matchesPrompt = (value) => {
    const actual = normalize(value);
    return Boolean(normalizedExpected) && actual === normalizedExpected;
  };
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  // Some providers (Kimi) render Send as a plain <div>, not a <button> and not
  // role="button", with no aria-label — just an SVG icon. className and a
  // descendant SVG's name attribute widen the label pool for those.
  const hasDisabledClass = (el) => /(^|\s)(disabled|is-disabled)(\s|$)/i.test(el.className || '');
  const text = (el) => [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('data-testid'), el.getAttribute('data-test-id'), typeof el.className === 'string' ? el.className : '', el.querySelector?.('svg')?.getAttribute('name'), el.textContent].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const active = document.activeElement?.matches?.('textarea,[contenteditable="true"],[role="textbox"]')
    ? document.activeElement : null;
  const composer = (active && visible(active) && matchesPrompt(active.value || active.innerText || active.textContent || '') && active)
    || Array.from(document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]'))
      .find((el) => visible(el) && matchesPrompt(el.value || el.innerText || el.textContent || ''));
  if (!composer) return null;
  const score = (el) => {
    const label = text(el);
    if (!visible(el) || el.disabled || el.getAttribute('aria-disabled') === 'true' || hasDisabledClass(el)) return -1;
    if (/microphone|voice|record|attach|upload|file|stop|cancel|model|tool/i.test(label)) return -1;
    if (/send message|send|submit|ask|arrow-up|paper-plane|отправ|enviar/i.test(label)) return 100;
    if (el.type === 'submit') return 70;
    return -1;
  };
  const scopes = [];
  const ownedScope = composer.closest('form,[data-testid*="composer" i],[class*="composer" i],[role="search"]');
  if (ownedScope) scopes.push(ownedScope);
  let ancestor = composer.parentElement;
  while (ancestor && ancestor !== document.body && scopes.length < 6) {
    if (!scopes.includes(ancestor)) scopes.push(ancestor);
    ancestor = ancestor.parentElement;
  }
  for (const scope of scopes) {
    const match = Array.from(scope.querySelectorAll('button,[role="button"],[class*="send-button" i],[class*="send_button" i]'))
      .map((el) => ({ el, score: score(el) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)[0]?.el;
    if (match) return match;
  }
  return null;
})()`;

async function dispatchProviderTrustedSend(tabId, model, expectedText = '') {
    const runOnce = () => withManagedDebuggerSession(tabId, `provider_trusted_send:${model}`, async (target) => {
        let objectId = null;
        try {
        await callChromeDebugger('sendCommand', target, 'Runtime.enable');
        await callChromeDebugger('sendCommand', target, 'DOM.enable');
        await bringToFrontUnlessUserIsElsewhere(target);
        const evaluated = await callChromeDebugger('sendCommand', target, 'Runtime.evaluate', {
            expression: buildProviderSendControlExpression(expectedText), returnByValue: false, awaitPromise: false
        });
        objectId = evaluated?.result?.objectId || null;
        if (!objectId) throw new Error('enabled_send_control_not_found');
        const clicked = await trustedClickDebuggerObject(target, objectId);
        if (!clicked?.clicked) throw new Error('trusted_send_click_failed');
        emitTelemetry(model, 'PROVIDER_TRUSTED_SEND_CLICKED', {
            details: String(clicked.descriptor?.label || 'unlabeled'), force: true,
            meta: { tabId, control: clicked.descriptor || null }
        });
        return { ok: true, method: 'cdp_send_control_click', control: clicked.descriptor || null };
        } finally {
            if (objectId) try { await callChromeDebugger('sendCommand', target, 'Runtime.releaseObject', { objectId }); } catch (_) {}
        }
    });
    try {
        return await runOnce();
    } catch (err) {
        const reason = String(err?.message || err || '');
        // Perplexity can commit the draft with an SPA navigation. Chrome then
        // invalidates the debugger session acquired a moment earlier. Re-open a
        // fresh, serialized session once; the first session could not dispatch
        // the click when Chrome reports that it was not attached.
        if (!/debugger is not attached|not attached to the tab|target closed/i.test(reason)) throw err;
        emitTelemetry(model, 'PROVIDER_TRUSTED_SEND_SESSION_RETRY', {
            level: 'warning',
            details: reason,
            meta: { tabId, retry: 1, reason: 'debugger_session_invalidated' },
            force: true
        });
        await new Promise((resolve) => setTimeout(resolve, 150));
        return runOnce();
    }
}

// Kimi's Send control is a plain <div class="send-button-container"> with no
// role="button" and no text label, and neither Enter nor Ctrl+Enter submits
// on this composer (confirmed against the live page: both are no-ops even as
// genuine, OS-level trusted keystrokes) — the button click is the only send
// path. buildProviderSendControlExpression's generic role/label scoring also
// requires the composer's live text to exactly match expectedText, which is
// one more thing to get wrong; querying Kimi's own known selector directly is
// more reliable than routing through that generic matcher.
async function dispatchKimiTrustedSend(tabId) {
    if (!Number.isInteger(tabId) || tabId <= 0) throw new Error('invalid_tab');
    return withManagedDebuggerSession(tabId, 'kimi_trusted_send', async (target) => {
        let objectId = null;
        try {
            await callChromeDebugger('sendCommand', target, 'Runtime.enable');
            await callChromeDebugger('sendCommand', target, 'DOM.enable');
            await bringToFrontUnlessUserIsElsewhere(target);
            const evaluated = await callChromeDebugger('sendCommand', target, 'Runtime.evaluate', {
                expression: `(() => {
                  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
                  const candidates = Array.from(document.querySelectorAll('.send-button-container'))
                    .filter((el) => visible(el) && !/(^|\\s)(disabled|is-disabled|stop)(\\s|$)/i.test(el.className || ''));
                  return candidates[0] || null;
                })()`,
                returnByValue: false, awaitPromise: false
            });
            objectId = evaluated?.result?.objectId || null;
            if (!objectId) throw new Error('kimi_send_control_not_found');
            const clicked = await trustedClickDebuggerObject(target, objectId);
            if (!clicked?.clicked) throw new Error('kimi_trusted_send_click_failed');
            emitTelemetry('Kimi', 'PROVIDER_TRUSTED_SEND_CLICKED', {
                details: 'kimi send-button-container', force: true,
                meta: { tabId, control: clicked.descriptor || null }
            });
            return { ok: true, method: 'cdp_kimi_send_click', control: clicked.descriptor || null };
        } finally {
            if (objectId) try { await callChromeDebugger('sendCommand', target, 'Runtime.releaseObject', { objectId }); } catch (_) {}
        }
    });
}

const isTerminalRouterEntry = (entry = null) => {
    if (!entry) return false;
    if (self.ModelRunState?.isTerminalRunState?.(entry)) return true;
    const entryStatus = String(entry?.status || entry?.finalStatus || '').toUpperCase();
    return Boolean(entry.finalStatusRecorded || entry.finalStatus || TERMINAL_STATUSES.includes(entryStatus));
};

// Content lifecycle messages may only mutate a model's run state when they come
// from that model's bound tab. The content script runs in EVERY tab of a
// provider — including the user's own manual chats — so without this gate an
// unbound tab of the same provider can confirm a send (PROMPT_SUBMITTED),
// deliver an answer (LLM_RESPONSE), or set completion evidence
// (LLM_RESPONSE_READY -> lifecycleReadyAt) for the active run.
// Non-tab senders (extension pages, background self-calls) and models without
// an active binding keep their existing behaviour.
const deliveryIdentityMeta = (meta = {}) => ({
    runSessionId: meta.runSessionId || meta.sessionId || null,
    dispatchId: meta.dispatchId || null,
    generationEpoch: meta.generationEpoch ?? null,
    attemptId: meta.attemptId || null,
    payloadEvidenceId: meta.payloadEvidenceId || null,
    normalizedHash: meta.normalizedHash || meta.answerHash || null,
    normalizedLength: Number.isFinite(Number(meta.normalizedLength ?? meta.textLength))
        ? Number(meta.normalizedLength ?? meta.textLength) : null,
    normalizationVersion: meta.normalizationVersion || null
});

const validateLifecycleSender = (llmName, sender, messageType, messageMeta = {}) => {
    const senderTabId = Number(sender?.tab?.id || 0) || null;
    if (!senderTabId) {
        return { ok: true, reason: 'non_tab_sender', senderTabId: null, boundTabId: null };
    }
    const entry = llmName ? jobState?.llms?.[llmName] : null;
    const boundTabId = Number(entry?.tabId || 0)
        || Number((typeof TabMapManager !== 'undefined' && TabMapManager?.get?.(llmName)) || 0)
        || null;
    if (!boundTabId) {
        emitTelemetry(llmName, 'SENDER_WITHOUT_BINDING_REJECTED', {
            level: 'warning',
            details: `${messageType} from tab ${senderTabId} without active binding`,
            meta: { messageType, senderTabId, ...deliveryIdentityMeta(messageMeta) },
            force: true
        });
        return { ok: false, reason: 'no_bound_tab', senderTabId, boundTabId: null };
    }
    if (senderTabId !== boundTabId) {
        emitTelemetry(llmName, 'SENDER_TAB_MISMATCH_REJECTED', {
            level: 'warning',
            details: `${messageType} from tab ${senderTabId} != bound ${boundTabId}`,
            meta: { messageType, senderTabId, boundTabId, ...deliveryIdentityMeta(messageMeta) },
            force: true
        });
        return { ok: false, reason: 'sender_tab_mismatch', senderTabId, boundTabId };
    }
    return { ok: true, reason: 'bound_tab_match', senderTabId, boundTabId };
};

const validateLifecycleCorrelation = (llmName, message, messageType) => {
    const entry = llmName ? jobState?.llms?.[llmName] : null;
    if (!entry) return { ok: false, reason: 'missing_model_entry' };
    const expectedDispatchId = entry?.lastDispatchMeta?.dispatchId || entry?.runIdentity?.dispatchId || null;
    const expectedRunSessionId = Number(jobState?.session?.startTime || 0) || null;
    const meta = message?.meta && typeof message.meta === 'object' ? message.meta : {};
    const incomingDispatchId = typeof meta.dispatchId === 'string' ? meta.dispatchId : null;
    const incomingRunSessionId = Number(meta.runSessionId || meta.sessionId || 0) || null;
    if (expectedDispatchId && incomingDispatchId !== expectedDispatchId) {
        emitTelemetry(llmName, 'LIFECYCLE_CORRELATION_REJECTED', {
            level: 'warning',
            details: `${messageType}:dispatch_mismatch`,
            meta: {
                messageType,
                // Exported field, unlike `details`: metadata-only privacy strips
                // the text, and the reason was previously recoverable only by
                // measuring detailsLength.
                correlationReason: incomingDispatchId ? 'dispatch_mismatch' : 'missing_dispatch_id',
                expectedDispatchId,
                incomingDispatchId,
                ...deliveryIdentityMeta(meta)
            },
            force: true
        });
        return { ok: false, reason: incomingDispatchId ? 'dispatch_mismatch' : 'missing_dispatch_id' };
    }
    if (expectedRunSessionId && incomingRunSessionId !== expectedRunSessionId) {
        emitTelemetry(llmName, 'LIFECYCLE_CORRELATION_REJECTED', {
            level: 'warning',
            details: `${messageType}:run_session_mismatch`,
            meta: {
                messageType,
                correlationReason: incomingRunSessionId ? 'run_session_mismatch' : 'missing_run_session_id',
                expectedRunSessionId,
                incomingRunSessionId,
                ...deliveryIdentityMeta(meta)
            },
            force: true
        });
        return { ok: false, reason: incomingRunSessionId ? 'run_session_mismatch' : 'missing_run_session_id' };
    }
    return { ok: true, expectedDispatchId, incomingDispatchId, expectedRunSessionId, incomingRunSessionId };
};

const completionAuthorityKey = (llmName) => String(llmName || '').trim();

const getPersistedCompletionAuthorityAttempt = (llmName) => {
    const key = completionAuthorityKey(llmName);
    const persisted = key ? jobState?.llms?.[key]?.completionAuthorityAttempt : null;
    return persisted && typeof persisted === 'object' ? persisted : null;
};

const getCompletionAuthorityAttempt = (llmName) => {
    const key = completionAuthorityKey(llmName);
    if (!key) return null;
    const inMemory = completionAuthorityAttempts.get(key) || null;
    if (inMemory) return inMemory;
    const persisted = getPersistedCompletionAuthorityAttempt(key);
    if (persisted) completionAuthorityAttempts.set(key, persisted);
    return persisted;
};

const recordCompletionAuthorityAttempt = (llmName, meta = {}) => {
    const key = completionAuthorityKey(llmName);
    if (!key) return null;
    const previous = getCompletionAuthorityAttempt(key) || {};
    const nextDispatchId = meta.dispatchId || previous.dispatchId || null;
    const sameAttempt = Boolean(previous.dispatchId && nextDispatchId
        && String(previous.dispatchId) === String(nextDispatchId));
    const next = {
        ...(sameAttempt ? previous : {}),
        runSessionId: meta.runSessionId || meta.sessionId || previous.runSessionId || null,
        dispatchId: nextDispatchId,
        generationEpoch: meta.generationEpoch ?? previous.generationEpoch ?? null,
        rolloutMode: ['legacy', 'shadow', 'enforced'].includes(meta.rolloutMode) ? meta.rolloutMode : (previous.rolloutMode || 'enforced'),
        legacyDeliveryAuthorized: meta.legacyDeliveryAuthorized === true,
        protocolVersion: meta.protocolVersion || previous.protocolVersion || null,
        terminalResult: meta.terminalResult || (sameAttempt ? previous.terminalResult : null) || null,
        updatedAt: Date.now()
    };
    completionAuthorityAttempts.set(key, next);
    const entry = jobState?.llms?.[key];
    if (entry) {
        entry.completionAuthorityAttempt = next;
        try { saveJobState(jobState); } catch (_) {}
    }
    return next;
};

const validateCompletionAuthorityDelivery = (llmName, message = {}) => {
    if (message.error || !String(message.answer || '').trim()) return { ok: true, reason: 'non_success_payload' };
    const meta = message.meta && typeof message.meta === 'object' ? message.meta : {};
    const authority = getCompletionAuthorityAttempt(llmName);
    const incomingDispatchId = meta.dispatchId || null;
    if (!authority) return { ok: false, reason: 'completion_attempt_unregistered' };
    if (authority.dispatchId && !incomingDispatchId) {
        return { ok: false, reason: 'completion_authority_dispatch_missing' };
    }
    if (authority.dispatchId && String(authority.dispatchId) !== String(incomingDispatchId)) {
        return { ok: false, reason: 'completion_authority_dispatch_mismatch' };
    }
    const rolloutMode = meta.completionRolloutMode || authority.rolloutMode || 'enforced';
    if ((rolloutMode === 'legacy' || rolloutMode === 'shadow') && authority.legacyDeliveryAuthorized === true) {
        return { ok: true, reason: `${rolloutMode}_explicit_legacy_delivery` };
    }
    const terminalResult = meta.completionTerminalResult || meta.terminalResult || authority.terminalResult || null;
    if (terminalResult?.status === 'SUCCESS_TERMINAL') {
        return { ok: true, reason: 'success_terminal_authority' };
    }
    // STALLED records a deadline in the observer, not a provider failure. A late
    // payload must still reach answer verification with that status intact.
    // Dropping it here makes recovery impossible even when the page finishes.
    const explicitlyFailed = new Set(['FAILED_TERMINAL', 'INTERRUPTED', 'CANCELLED']);
    if (explicitlyFailed.has(String(terminalResult?.status || ''))) {
        return { ok: false, reason: 'completion_terminal_failed' };
    }
    // Attempt authority proves that this payload belongs to the live dispatch;
    // terminal certainty is a separate answer-quality decision. Treating an
    // uncertain/missing terminal as an irreversible transport rejection lost
    // complete late answers when observers were throttled. The normal answer
    // verification/finalization gates still decide whether the payload can win.
    return { ok: true, reason: 'attempt_authority_pending_terminal_verification' };
};

self.CompletionAuthorityRegistry = Object.freeze({
    recordAttempt: recordCompletionAuthorityAttempt,
    validateDelivery: validateCompletionAuthorityDelivery,
    get(llmName) {
        return getCompletionAuthorityAttempt(llmName);
    },
    clear(llmName) {
        const key = completionAuthorityKey(llmName);
        const deleted = completionAuthorityAttempts.delete(key);
        const entry = jobState?.llms?.[key];
        if (entry?.completionAuthorityAttempt) {
            delete entry.completionAuthorityAttempt;
            try { saveJobState(jobState); } catch (_) {}
            return true;
        }
        return deleted;
    }
});

const PERPLEXITY_TRANSIENT_BLOCKER_KIND = 'file_upload_paywall';
const PERPLEXITY_TRANSIENT_BLOCKER_TTL_MS = 120000;
const PERPLEXITY_TRANSIENT_BLOCKER_ALARM_PREFIX = 'perplexity-transient-blocker-expiry:';

const getPerplexityTransientBlockerAlarmName = (token) => (
    token ? `${PERPLEXITY_TRANSIENT_BLOCKER_ALARM_PREFIX}${String(token).slice(0, 200)}` : null
);

const schedulePerplexityTransientBlockerExpiry = (token, expiresAt = Date.now() + PERPLEXITY_TRANSIENT_BLOCKER_TTL_MS) => {
    const name = getPerplexityTransientBlockerAlarmName(token);
    if (!name) return;
    try {
        chrome.alarms.create(name, { when: Math.max(Date.now() + 1000, Number(expiresAt) || 0) });
    } catch (_) {}
};

const cancelPerplexityTransientBlockerExpiry = (token) => {
    const name = getPerplexityTransientBlockerAlarmName(token);
    if (!name) return;
    try { chrome.alarms.clear(name); } catch (_) {}
};

const normalizePerplexityTransientBlockerIdentity = (message, sender) => ({
    kind: PERPLEXITY_TRANSIENT_BLOCKER_KIND,
    token: typeof message?.token === 'string' ? message.token.slice(0, 200) : '',
    runSessionId: Number(message?.meta?.runSessionId || message?.meta?.sessionId || 0) || null,
    dispatchId: typeof message?.meta?.dispatchId === 'string' ? message.meta.dispatchId : null,
    tabId: Number(sender?.tab?.id || 0) || null,
    tabSessionId: message?.meta?.tabSessionId || null
});

const isFreshPerplexityTransientBlocker = (blocker, now = Date.now()) => Boolean(
    blocker
    && blocker.kind === PERPLEXITY_TRANSIENT_BLOCKER_KIND
    && typeof blocker.token === 'string'
    && blocker.token.length >= 8
    && Number(blocker.runSessionId || 0) > 0
    && typeof blocker.dispatchId === 'string'
    && Number(blocker.tabId || 0) > 0
    && now - Number(blocker.startedAt || blocker.armedAt || 0) <= PERPLEXITY_TRANSIENT_BLOCKER_TTL_MS
);

const samePerplexityTransientBlocker = (blocker, identity) => Boolean(
    blocker
    && identity
    && blocker.kind === identity.kind
    && blocker.token === identity.token
    && Number(blocker.runSessionId || 0) === Number(identity.runSessionId || 0)
    && blocker.dispatchId === identity.dispatchId
    && Number(blocker.tabId || 0) === Number(identity.tabId || 0)
);

const perplexityTransientBlockerOwnsLifecycle = (entry, message, sender) => {
    const blocker = entry?.transientBlocker || null;
    if (!isFreshPerplexityTransientBlocker(blocker)) return false;
    const runSessionId = Number(message?.meta?.runSessionId || message?.meta?.sessionId || 0) || null;
    const dispatchId = message?.meta?.dispatchId || null;
    const tabId = Number(sender?.tab?.id || 0) || null;
    return ['ARMED', 'ACTIVE', 'PROBING', 'RESUMING'].includes(String(blocker.phase || '').toUpperCase())
        && Number(blocker.runSessionId || 0) === Number(runSessionId || 0)
        && blocker.dispatchId === dispatchId
        && Number(blocker.tabId || 0) === Number(tabId || 0);
};

const probePerplexityResumeDocument = (sender, identity) => new Promise((resolve) => {
    const tabId = Number(sender?.tab?.id || 0) || null;
    if (!tabId || !identity?.token) {
        resolve({ ok: false, reason: 'missing_resume_probe_identity' });
        return;
    }
    const options = {};
    if (sender?.documentId) options.documentId = sender.documentId;
    else if (Number.isInteger(sender?.frameId)) options.frameId = sender.frameId;
    try {
        chrome.tabs.sendMessage(tabId, {
            type: 'PROVIDER_TRANSIENT_BLOCKER_RESUME_PROBE',
            llmName: 'Perplexity',
            blocker: PERPLEXITY_TRANSIENT_BLOCKER_KIND,
            token: identity.token,
            meta: {
                runSessionId: identity.runSessionId,
                sessionId: identity.runSessionId,
                dispatchId: identity.dispatchId,
                tabSessionId: identity.tabSessionId || null
            }
        }, options, (response) => {
            const runtimeError = chrome.runtime.lastError;
            if (runtimeError) {
                resolve({ ok: false, reason: runtimeError.message || 'resume_probe_failed' });
                return;
            }
            const valid = response?.ok === true
                && response?.ready === true
                && response?.composerReady === true
                && response?.token === identity.token
                && response?.dispatchId === identity.dispatchId;
            resolve(valid
                ? { ok: true, response }
                : { ok: false, reason: 'resume_document_not_ready', response: response || null });
        });
    } catch (err) {
        resolve({ ok: false, reason: err?.message || 'resume_probe_failed' });
    }
});

try {
    chrome.alarms?.onAlarm?.addListener?.((alarm) => {
        const name = String(alarm?.name || '');
        if (!name.startsWith(PERPLEXITY_TRANSIENT_BLOCKER_ALARM_PREFIX)) return;
        const token = name.slice(PERPLEXITY_TRANSIENT_BLOCKER_ALARM_PREFIX.length);
        const entry = jobState?.llms?.Perplexity || null;
        const blocker = entry?.transientBlocker || null;
        if (!entry || entry.finalStatusRecorded || blocker?.token !== token) return;
        entry.transientBlocker = null;
        entry.transientBlockerActive = null;
        entry.transientBlockerActiveAt = 0;
        entry.transientBlockerRunSessionId = null;
        entry.transientBlockerDispatchId = null;
        entry.transientBlockerTabId = null;
        entry.providerPipelineActive = false;
        entry.providerPipelineActiveAt = 0;
        entry.providerPipelineDispatchId = null;
        entry.awaitingSubmitConfirmation = false;
        entry.awaitingSubmitConfirmationAt = null;
        entry.awaitingSubmitConfirmationDispatchId = null;
        emitTelemetry('Perplexity', 'PROVIDER_TRANSIENT_BLOCKER_EXPIRED', {
            level: 'error',
            details: 'file-upload paywall handoff expired before resume acceptance',
            meta: { tabId: blocker.tabId || null, dispatchId: blocker.dispatchId || null, token },
            force: true
        });
        handleLLMResponse(
            'Perplexity',
            '',
            { type: 'attachment_unavailable', message: 'Perplexity file-upload paywall handoff expired before resume acceptance' },
            entry.lastDispatchMeta || null,
            ''
        );
        saveJobState(jobState);
    });
} catch (_) {}

const hasCompressedDiagnosticsStorage = () => (
    typeof CompressedStorage !== 'undefined'
    && CompressedStorage
    && typeof CompressedStorage.get === 'function'
    && typeof CompressedStorage.set === 'function'
);

const readDiagnosticsEventsFromStorage = async () => {
    if (typeof self?.readDiagnosticsEventsConsistent === 'function') {
        return self.readDiagnosticsEventsConsistent();
    }
    if (hasCompressedDiagnosticsStorage()) {
        const value = await CompressedStorage.get(DIAGNOSTICS_EVENTS_KEY);
        return Array.isArray(value) ? value : [];
    }
    const res = await chrome.storage.local.get([DIAGNOSTICS_EVENTS_KEY]);
    return Array.isArray(res?.[DIAGNOSTICS_EVENTS_KEY]) ? res[DIAGNOSTICS_EVENTS_KEY] : [];
};

const writeDiagnosticsEventsToStorage = async (entries = []) => {
    const payload = Array.isArray(entries) ? entries : [];
    if (typeof self?.replaceDiagnosticsEventsConsistent === 'function') {
        await self.replaceDiagnosticsEventsConsistent(payload);
        return;
    }
    if (hasCompressedDiagnosticsStorage()) {
        await CompressedStorage.set(DIAGNOSTICS_EVENTS_KEY, payload);
        return;
    }
    await chrome.storage.local.set({ [DIAGNOSTICS_EVENTS_KEY]: payload });
};

const clearDiagnosticsRuntimeLogs = () => {
    if (!jobState?.llms || typeof jobState.llms !== 'object') return false;
    let changed = false;
    Object.values(jobState.llms).forEach((entry) => {
        if (!entry || !Array.isArray(entry.logs) || !entry.logs.length) return;
        entry.logs = [];
        changed = true;
    });
    if (changed) {
        try { saveJobState(jobState); } catch (_) {}
    }
    return changed;
};

const clearDiagnosticsStorageOnStartup = () => {
    writeDiagnosticsEventsToStorage([])
        .catch((err) => console.warn('[DIAGNOSTICS] startup clear failed', err));
};

if (typeof chrome !== 'undefined' && chrome?.runtime) {
    if (typeof chrome.runtime.onStartup?.addListener === 'function') {
        chrome.runtime.onStartup.addListener(clearDiagnosticsStorageOnStartup);
    }
    if (typeof chrome.runtime.onInstalled?.addListener === 'function') {
        chrome.runtime.onInstalled.addListener(clearDiagnosticsStorageOnStartup);
    }
}

const DIAG_PINNED_LABELS = new Set([
    'ATTEMPT_CONTEXT_CAPTURED',
    'COMPLETION_ATTEMPT_ACCEPTED',
    'COMPLETION_ATTEMPT_REJECTED',
    'GENERATION_OBSERVED',
    'OWNERSHIP_CONFIRMED',
    'OWNERSHIP_CONFLICT',
    'PRODUCER_TERMINAL',
    'CONTENT_TERMINAL',
    'TIMEOUT_PROGRESS',
    'TIMEOUT_PRODUCER_STUCK',
    'TIMEOUT_HARD',
    'TERMINAL_DECISION',
    'EXTRACTION_SNAPSHOT_CAPTURED',
    'MODEL_FINAL',
    'FINAL_STATUS',
    'MODEL_MISSING',
    'FOCUS_STUCK',
    'BUDGET_EXHAUSTED',
    'FINALIZATION_DECISION',
    'PRE_INSERTION_FAILURE_DEFERRED',
    'ANSWER_LENGTH_SUSPECT',
    'GEMINI_CDP_ATTACH_REQUESTED',
    'GEMINI_CDP_FILES_MATERIALIZED',
    'GEMINI_CDP_DEBUGGER_ATTACHED',
    'GEMINI_CDP_UPLOAD_TRIGGER_CLICKED',
    'GEMINI_CDP_FILE_INPUT_FOUND',
    'GEMINI_CDP_FILES_ASSIGNED',
    'GEMINI_CDP_ATTACH_FAILED',
    'QWEN_CDP_ATTACH_REQUESTED',
    'QWEN_CDP_FILES_ASSIGNED',
    'QWEN_CDP_ATTACH_FAILED',
    'ATTACHMENT_STRATEGY_START',
    'ATTACHMENT_DISPATCHED',
    'ATTACHMENT_DISPATCH_FAILED',
    'ATTACHMENT_CONFIRMED',
    'ATTACHMENT_CONFIRM_TIMEOUT',
    // The state in which a prompt can still go out without its file. Exactly the
    // outcome a report has to show, so it must survive the allowlist.
    'ATTACHMENT_ACCEPTED_UNPROVEN',
    // One-shot causal dispatch events (mirror of PINNED_LABELS rationale).
    'TRANSPORT_DECISION',
    'PROMPT_SUBMITTED_ACCEPTED',
    'PROMPT_SUBMITTED_INFERRED',
    'PROMPT_SUBMITTED_PENDING',
    'PROMPT_SUBMITTED_UNCONFIRMED',
    'PROVIDER_SUBMIT_METHOD_OBSERVED',
    'PAGE_READY_BLOCKED',
    'PROMPT_INSERTION_CONFIRMED',
    'PROMPT_INSERTION_FAILED',
    'PROVIDER_DISPATCH_STAGE_OBSERVED',
    'DISPATCH_BASELINE_CAPTURED',
    'STALE_BASELINE_ANSWER_IGNORED',
    'UNSAFE_REUSE_SKIPPED',
    'SOFT_REUSE_BLOCKER_OVERRIDDEN',
    'TAB_ISOLATION_FALLBACK_CREATE',
    'DONOR_STICKY_TAB_REUSED',
    'PROVIDER_TRUSTED_ENTER_DISPATCHED',
    'PROVIDER_TRUSTED_SEND_CLICKED',
    'PROVIDER_TRUSTED_ENTER_FAILED',
    'PROVIDER_TRUSTED_SEND_FAILED',
    'PERPLEXITY_DUPLICATE_DISPATCH_SUPPRESSED',
    'PERPLEXITY_CONCURRENT_DISPATCH_REJECTED',
    'FINALIZE_BLOCKED_SUBMIT_PENDING',
    'SENDER_TAB_MISMATCH_REJECTED',
    'STALE_SNAPSHOT_SIGNATURE_EXCLUDED',
    'TAB_CREATE_FAILED'
]);

const isPinnedDiagnosticEvent = (entry = {}) => {
    const label = String(entry?.label || entry?.meta?.event || '').toUpperCase();
    if (!label) return false;
    if (label.startsWith('ROUND')) return true;
    return DIAG_PINNED_LABELS.has(label);
};

const diagTrimDiagnosticsBuffer = (entries = [], maxItems = 200) => {
    let next = Array.isArray(entries) ? entries.slice() : [];
    if (next.length <= maxItems) return next;
    const pinned = next.filter(isPinnedDiagnosticEvent);
    const unpinned = next.filter((entry) => !isPinnedDiagnosticEvent(entry));
    const capacity = Math.max(0, maxItems - pinned.length);
    const trimmed = capacity ? unpinned.slice(-capacity) : [];
    next = trimmed.concat(pinned);
    next.sort((a, b) => (a?.ts || 0) - (b?.ts || 0));
    return next;
};

const diagDropOldestUnpinned = (entries = []) => {
    if (!entries.length) return entries;
    const idx = entries.findIndex((entry) => !isPinnedDiagnosticEvent(entry));
    if (idx === -1) {
        return entries.slice(1);
    }
    return entries.slice(0, idx).concat(entries.slice(idx + 1));
};

// v2.54 (2025-12-19 19:36): Early ready signal system for faster script readiness detection
const earlyReadyWaiters = new Map(); // llmName -> Set<callback>

function waitForEarlyReadySignal(llmName, timeoutMs = 2000) {
    return new Promise((resolve) => {
        if (!llmName) {
            resolve(false);
            return;
        }
        const waiters = earlyReadyWaiters.get(llmName) || new Set();
        earlyReadyWaiters.set(llmName, waiters);

        let settled = false;
        const done = (success) => {
            if (settled) return;
            settled = true;
            if (timer) {
                clearTimeout(timer);
                routerDeregisterSessionTimer(timer);
            }
            waiters.delete(handler);
            resolve(success);
        };

        const handler = () => done(true);
        waiters.add(handler);
        let timer = null;
        timer = routerRegisterSessionTimer(setTimeout(() => done(false), timeoutMs));
    });
}

function resolveEarlyReadySignal(llmName) {
    const waiters = earlyReadyWaiters.get(llmName);
    if (waiters && waiters.size) {
        waiters.forEach((cb) => {
            try { cb(); } catch (_) {}
        });
        waiters.clear();
    }
}

chrome.storage.local.get(API_MODE_STORAGE_KEY, (data) => {
    if (typeof data?.[API_MODE_STORAGE_KEY] === 'boolean') {
        cachedApiMode = data[API_MODE_STORAGE_KEY];
        self.cachedApiMode = cachedApiMode;
    }
});

chrome.storage.local.get(AUTO_FOCUS_NEW_TABS_KEY, (data) => {
    if (typeof data?.[AUTO_FOCUS_NEW_TABS_KEY] === 'boolean') {
        autoFocusNewTabsEnabled = data[AUTO_FOCUS_NEW_TABS_KEY];
        self.autoFocusNewTabsEnabled = autoFocusNewTabsEnabled;
    }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes[API_MODE_STORAGE_KEY]) {
        cachedApiMode = !!changes[API_MODE_STORAGE_KEY].newValue;
        self.cachedApiMode = cachedApiMode;
    }
    if (changes[AUTO_FOCUS_NEW_TABS_KEY]) {
        autoFocusNewTabsEnabled = !!changes[AUTO_FOCUS_NEW_TABS_KEY].newValue;
        self.autoFocusNewTabsEnabled = autoFocusNewTabsEnabled;
    }
});


let initialStatePromise = null;
let initialStateReady = false;
let initialStorageMaintenancePromise = null;

function scheduleInitialStorageMaintenance() {
    if (initialStorageMaintenancePromise) return initialStorageMaintenancePromise;
    initialStorageMaintenancePromise = new Promise((resolve) => {
        setTimeout(resolve, 1000);
    })
        .then(async () => {
            await CompressedStorage.migrate(['results', 'notes', 'logs']);
            await CompressedStorage.pruneIfNeeded();
        })
        .catch((err) => {
            initialStorageMaintenancePromise = null;
            console.warn('[BACKGROUND] Deferred storage maintenance failed:', err);
        });
    return initialStorageMaintenancePromise;
}

function ensureInitialState() {
    if (!initialStatePromise) {
        initialStatePromise = (async () => {
            if (self.__extensionLifecycleReady) {
                await self.__extensionLifecycleReady;
            }
            await Promise.all([loadJobState(), TabMapManager.load()]);
            await loadResolutionMetrics();
            await (self.DispatchCircuit?.loadDispatchCircuitState ? self.DispatchCircuit.loadDispatchCircuitState() : Promise.resolve());
            initialStateReady = true;
            scheduleInitialStorageMaintenance();
        })().catch((err) => {
            initialStateReady = false;
            initialStatePromise = null;
            throw err;
        });
    }
    return initialStatePromise;
}

function isInitialStateReady() {
    return initialStateReady;
}

ensureInitialState().catch((err) => {
    console.error('[BACKGROUND] Failed to preload initial state:', err);
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    globalThis.LLMLog?.debug?.(`[BACKGROUND] Tab ${tabId} was closed.`);
    if (self.ReadySignalManager?.handleTabClosed) {
        self.ReadySignalManager.handleTabClosed(tabId);
    }
    closePingWindowForTab(tabId);
    removeActiveListenerForTab(tabId);
    delete llmActivityMap[tabId];
    if (pendingPings.size) {
        Array.from(pendingPings.entries()).forEach(([pingId, meta]) => {
            if (meta?.tabId === tabId) {
                pendingPings.delete(pingId);
            }
        });
    }
    pendingPingByTabId.delete(tabId);
    healthCheckFailuresByTabId.delete(tabId);
    lastHealthCheckReportAtByTabId.delete(tabId);
    let cleanupReason = null;
    let llmTabClosed = false;
    
    //-- 4.4. Cleanup при закрытии вкладок --//
    const mappedLlmName = TabMapManager.getNameByTabId(tabId);
    const stateMatchedLlmName = Object.entries(jobState?.llms || {})
        .find(([, entry]) => Number(entry?.tabId) === Number(tabId))?.[0] || null;
    const closedLlmName = mappedLlmName || stateMatchedLlmName;
    if (closedLlmName) {
        globalThis.LLMLog?.debug?.(`[BACKGROUND] LLM tab ${closedLlmName} closed, sending cleanup...`);
        const closedEntry = jobState?.llms?.[closedLlmName] || null;
        const alreadyFinished = isTerminalRouterEntry(closedEntry);
        const answerLength = String(closedEntry?.answer || closedEntry?.pendingFinalAnswer || '').trim().length;
        const modelRunState = closedEntry?.modelRunState || null;
        const generationActive = !alreadyFinished && (
            String(closedEntry?.status || '').toUpperCase() === 'GENERATING'
            || String(modelRunState?.generationState || '').toLowerCase().includes('generat')
            || String(modelRunState?.liveStatus || '').toUpperCase() === 'GENERATING'
        );
        const closureState = removeInfo?.isWindowClosing
            ? 'window_closed'
            : alreadyFinished
                ? 'post_terminal_tab_closed'
                : generationActive
                    ? 'tab_closed_during_generation'
                    : 'tab_closed_before_terminal';
        emitTelemetry(closedLlmName, 'TAB_CLOSED', {
            details: closureState,
            level: 'warning',
            meta: {
                tabId,
                windowId: removeInfo?.windowId ?? null,
                isWindowClosing: !!removeInfo?.isWindowClosing,
                reason: 'tab_removed',
                closureState,
                closeOrigin: 'user_or_external',
                mappingSource: mappedLlmName ? 'tab_map' : 'job_state_fallback',
                status: closedEntry?.status || null,
                finalStatus: closedEntry?.finalStatus || null,
                terminal: alreadyFinished,
                generationActive,
                answerLength,
                generationState: modelRunState?.generationState || null,
                answerState: modelRunState?.answerState || null
            }
        });
        clearDeferredAnswerTimer(closedLlmName);
        llmTabClosed = true;
        if (jobState?.llms?.[closedLlmName]) {
            if (!alreadyFinished) {
                handleLLMResponse(closedLlmName, '', {
                    type: 'tab_closed_prematurely'
                });
            }
            jobState.llms[closedLlmName].tabId = null;
        }
        cleanupTabResources(tabId, 'tab_removed');
        // Tab is already gone; just drop mapping/state.
        if (self.setTabBinding) void self.setTabBinding(closedLlmName, null);
        else TabMapManager.removeByName(closedLlmName);
    }
    
    // Проверяем evaluator tab
    if (evaluatorTabId === tabId) {
        globalThis.LLMLog?.debug?.(`[BACKGROUND] Evaluator tab closed.`);
        evaluatorTabId = null;
        cleanupReason = cleanupReason || 'evaluator_tab_closed';
    }
    
    // Проверяем results tab
    if (resultsTabId === tabId) {
        globalThis.LLMLog?.debug?.(`[BACKGROUND] Results tab closed, clearing all LLM sessions...`);
        TabMapManager.entries().forEach(([, llmTabId]) => {
            chrome.tabs.sendMessage(llmTabId, { type: 'STOP_AND_CLEANUP' }).catch(() => {});
        });
        resultsTabId = null;
        cleanupReason = cleanupReason || 'results_tab_closed';
    }

    const remainingLlms = Math.max(0, TabMapManager.entries().length - (llmTabClosed ? 1 : 0));
    if (!remainingLlms) {
        cleanupReason = cleanupReason || 'no_llm_tabs';
    }

    if (cleanupReason) {
        // Никогда не закрываем LLM-вкладки автоматически при закрытии results,
        // оставляем только очистку состояния.
        stopAllProcesses(cleanupReason, { closeTabs: false });
    }
});

async function respondProofTelemetrySnapshot(message, sendResponse) {
    try {
        if (message?.incidentScope && self.ProofTelemetryLedger?.snapshotIncident) {
            const events = await self.ProofTelemetryLedger.snapshotIncident(message.incidentScope);
            sendResponse({
                success: true,
                schemaVersion: 6,
                incidentScope: message.incidentScope,
                eventCount: events.length,
                events
            });
            return;
        }
        const ledger = self.ProofTelemetryLedger;
        if (!ledger?.snapshot) {
            sendResponse({ success: false, error: 'proof_telemetry_ledger_unavailable' });
            return;
        }
        const snapshotStartedAt = Date.now();
        const timeoutToken = Object.freeze({ timedOut: true });
        let timeoutId = null;
        const barrierSnapshot = ledger.snapshot({
            runSessionId: message?.runSessionId || null
        }).catch(() => timeoutToken);
        const barrierDeadline = new Promise((resolve) => {
            timeoutId = setTimeout(() => resolve(timeoutToken), 750);
        });
        let snapshot = await Promise.race([barrierSnapshot, barrierDeadline]);
        if (timeoutId) clearTimeout(timeoutId);
        const barrierTimedOut = snapshot === timeoutToken;
        if (barrierTimedOut) {
            const committed = await ledger.snapshotCommitted?.({
                runSessionId: message?.runSessionId || null
            });
            if (!committed) {
                sendResponse({ success: false, error: 'proof_telemetry_ledger_unavailable' });
                return;
            }
            sendResponse({
                success: true,
                ...committed,
                barrierTimedOut: true,
                snapshotWaitMs: Date.now() - snapshotStartedAt,
                snapshotConsistency: committed?.snapshotConsistency || 'committed_boundary',
                queuedMutationCount: Number(committed?.queuedMutationCount || 0),
                pendingRecordCount: Number(committed?.pendingRecordCount || 0)
            });
            return;
        }
        if (!snapshot) {
            sendResponse({ success: false, error: 'proof_telemetry_ledger_unavailable' });
            return;
        }
        sendResponse({
            success: true,
            ...snapshot,
            barrierTimedOut,
            snapshotWaitMs: Date.now() - snapshotStartedAt
        });
    } catch (err) {
        sendResponse({ success: false, error: err?.message || String(err) });
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    globalThis.LLMLog?.debug?.("[BACKGROUND] Received message:", message);
    if (message?.type === 'NOTES_CMD' || message?.type === 'NOTES_EVENT') {
        return false;
    }
    if (message?.type === 'RESPONSE_VIEWER_CLOSE') {
        const windowId = sender?.tab?.windowId;
        if (Number.isInteger(windowId)) {
            chrome.windows.remove(windowId).catch(() => {});
        }
        sendResponse({ ok: true });
        return false;
    }
    if (message?.type === 'RESPONSE_VIEWER_STORE_CONTENT') {
        const key = String(message.key || '').trim();
        if (!key || !message.payload || typeof message.payload !== 'object') {
            sendResponse({ ok: false, error: 'invalid_response_viewer_payload' });
            return false;
        }
        chrome.storage.local.set({ [key]: message.payload }, () => {
            if (chrome.runtime.lastError) {
                sendResponse({ ok: false, error: chrome.runtime.lastError.message });
                return;
            }
            chrome.storage.session.set({ [key]: message.payload }, () => sendResponse({ ok: !chrome.runtime.lastError }));
        });
        return true;
    }
    if (message?.type === 'RESPONSE_VIEWER_GET_CONTENT') {
        const key = String(message.key || '').trim();
        if (!key) {
            sendResponse({ ok: false, error: 'missing_response_viewer_key' });
            return false;
        }
        chrome.storage.local.get(key, (stored) => {
            if (stored?.[key]) {
                sendResponse({ ok: !chrome.runtime.lastError, payload: stored[key] });
                return;
            }
            chrome.storage.session.get(key, (sessionStored) => sendResponse({ ok: !chrome.runtime.lastError, payload: sessionStored?.[key] || null }));
        });
        return true;
    }
    // Export must remain available during a cold service-worker start. It only
    // depends on the proof ledger, which is imported before this router, and
    // must not wait for unrelated job/tab/circuit initialization below.
    if (message?.type === 'GET_PROOF_TELEMETRY_SNAPSHOT') {
        void respondProofTelemetrySnapshot(message, sendResponse);
        return true;
    }
    // The debugger permission is restored only for the proven Le Chat and
    // Perplexity submit transactions. Keep every other historical CDP route
    // fail-closed so adding the permission cannot silently change attachments
    // or input behaviour for unrelated providers.
    if (DEBUGGER_RPC_TYPES.has(message?.type) && !ENABLED_DEBUGGER_RPC_TYPES.has(message.type)) {
        sendResponse({ ok: false, reason: 'debugger_route_disabled' });
        return false;
    }

    const processMessage = () => {
        if (self.PipelineMessageHandlers?.handle?.(message, {
            jobState,
            sendResponse,
            stopAllProcesses,
            saveJobState,
            chromeApi: chrome,
            fsm: self.PipelineFSM
        })) {
            return true;
        }
        switch (message.type) {
            case 'CAPTURE_B1_SANITIZED_SKELETONS': {
                const senderUrl = String(sender?.url || sender?.tab?.url || '');
                const allowedPages = [
                    chrome.runtime.getURL('result_new.html'),
                    chrome.runtime.getURL('pipeline_panel.html')
                ];
                if (sender?.id !== chrome.runtime.id || !allowedPages.some((url) => senderUrl.startsWith(url))) {
                    sendResponse({ success: false, error: 'b1_capture_sender_not_authorized' });
                    return false;
                }
                if (!self.B1SkeletonCollector?.collectAll) {
                    sendResponse({ success: false, error: 'b1_collector_unavailable' });
                    return false;
                }
                self.B1SkeletonCollector.collectAll({ chromeApi: chrome })
                    .then((result) => sendResponse(result))
                    .catch((error) => sendResponse({
                        success: false,
                        error: error?.message || 'b1_capture_failed'
                    }));
                return true;
            }
            case 'START_FULLPAGE_PROCESS': {
                const forceNewTabs = message.forceNewTabs !== undefined ? message.forceNewTabs : true;
                const useApiFallback = message.useApiFallback !== undefined ? message.useApiFallback : cachedApiMode;
                const promptsByModel = self.TransportPolicy?.sanitizePromptsByModel
                    ? self.TransportPolicy.sanitizePromptsByModel(message.promptsByModel)
                    : null;
                (async () => {
                    const runGuard = self.RunGuard?.canStartNewRun?.(jobState?.session, message);
                    if (runGuard && runGuard.ok === false) {
                        sendResponse({
                            success: false,
                            errorCode: runGuard.errorCode,
                            activeSessionId: runGuard.activeSessionId || null
                        });
                        return;
                    }

                    try {
                        await writeDiagnosticsEventsToStorage([]);
                        await self.ProofTelemetryLedger?.clear?.(null);
                        clearDiagnosticsRuntimeLogs();
                    } catch (err) {
                        console.warn('[DIAGNOSTICS] new run clear failed', err);
                    }
                    const startResult = await startProcess(message.prompt, message.selectedLLMs, sender.tab.id, {
                        forceNewTabs,
                        useApiFallback,
                        promptsByModel,
                        attachments: Array.isArray(message.attachments) ? message.attachments : [],
                        pipelineContext: message.pipelineContext || null,
                        sourceView: message.sourceView || message.pipelineContext?.sourceView || null
                    });
                    if (startResult && startResult.ok === false) {
                        sendResponse({
                            success: false,
                            errorCode: startResult.errorCode,
                            activeSessionId: startResult.activeSessionId || null
                        });
                        return;
                    }
                    sendResponse({ status: 'process_started' });
                })();
                return true;
            }

            case 'GET_ACTIVE_RUN_STATE': {
                const session = jobState?.session || null;
                const llmEntries = Object.values(jobState?.llms || {});
                const totalModels = Number(session?.totalModels || llmEntries.length || 0);
                const terminalCount = llmEntries.filter((entry) => isTerminalRouterEntry(entry)).length;
                const hasOpenModelRun = llmEntries.some((entry) => !isTerminalRouterEntry(entry));
                const sessionAgeMs = session?.startTime ? Math.max(0, Date.now() - Number(session.startTime || 0)) : 0;
                const staleActiveRun = Boolean(
                    session?.startTime
                    && !session?.roundsInProgress
                    && hasOpenModelRun
                    && sessionAgeMs > 15 * 60 * 1000
                );
                const active = Boolean(
                    session?.startTime
                    && !staleActiveRun
                    && (
                        session?.roundsInProgress
                        || hasOpenModelRun
                        || (totalModels > 0 && terminalCount < totalModels)
                    )
                );
                sendResponse({
                    status: 'ok',
                    active,
                    staleActiveRun,
                    sessionAgeMs,
                    sourceView: session?.sourceView || session?.pipelineContext?.sourceView || null,
                    sessionId: session?.startTime || null,
                    roundsInProgress: !!session?.roundsInProgress,
                    totalModels,
                    terminalCount,
                    completed: Number(session?.completed || 0),
                    failed: Number(session?.failed || 0),
                    selectedModels: Array.isArray(session?.selectedModels) ? session.selectedModels : [],
                    pipelineState: session?.pipelineState || null,
                    pipelineContext: session?.pipelineContext || null
                });
                return true;
            }

            case 'COLLECT_RESPONSES':
                (async () => {
                    try {
                        const responses = await collectResponsesStaged?.();
                        sendResponse({ success: true, responses });
                    } catch (err) {
                        sendResponse({ success: false, error: err?.message || String(err) });
                    }
                })();
                return true;

            case 'SESSION_TABS_GET': {
                const requestedIds = Array.isArray(message.tabIds)
                    ? new Set(message.tabIds.map((id) => Number(id)).filter(Number.isInteger))
                    : null;
                const currentRunOnly = message.scope === 'currentRun';
                Promise.resolve().then(async () => {
                    const tabs = await getTrackedSessionTabs();
                    const runIds = currentRunOnly && typeof getRunBoundTabIds === 'function'
                        ? new Set(getRunBoundTabIds())
                        : null;
                    const effectiveIds = requestedIds || runIds;
                    const scopedTabs = effectiveIds
                        ? tabs.filter((tab) => effectiveIds.has(Number(tab?.id ?? tab?.tabId)))
                        : tabs;
                    sendResponse({ status: 'ok', tabs: scopedTabs });
                });
                return true;
            }

            case 'SESSION_TABS_OPEN': {
                const rawUrls = Array.isArray(message.urls) ? message.urls : [];
                const urls = rawUrls
                    .filter((url) => typeof url === 'string' && /^https?:\/\//i.test(url));
                Promise.resolve().then(async () => {
                    if (!urls.length) {
                        sendResponse({ status: 'empty', tabs: [] });
                        return;
                    }
                    const created = [];
                    for (const url of urls) {
                        const tab = await new Promise((resolve) => {
                            chrome.tabs.create({ url, active: false }, (newTab) => {
                                if (chrome.runtime.lastError || !newTab) {
                                    resolve(null);
                                    return;
                                }
                                resolve(newTab);
                            });
                        });
                        if (tab?.id) {
                            trackSessionTab(tab.id);
                            created.push({ tabId: tab.id, url: tab.url || url });
                        }
                    }
                    sendResponse({ status: 'opened', tabs: created });
                });
                return true;
            }

            case 'START_EVALUATION_WITH_PROMPT': {
                const shouldFocusEvaluator = message.openEvaluatorTab !== false;
                startEvaluation(
                    message.evaluationPrompt,
                    message.evaluatorLLM,
                    { openEvaluatorTab: shouldFocusEvaluator }
                );
                sendResponse({ status: 'evaluation_started_with_prompt' });
                break;
            }

            case 'LLM_COMPLETION_ATTEMPT': {
                const senderGate = validateLifecycleSender(message.llmName, sender, 'LLM_COMPLETION_ATTEMPT', message.meta || {});
                if (!senderGate.ok) {
                    emitTelemetry(message.llmName || 'SYSTEM', 'COMPLETION_ATTEMPT_REJECTED', {
                        level: 'warning',
                        details: senderGate.reason,
                        meta: { reason: senderGate.reason, ...deliveryIdentityMeta(message.meta || {}) },
                        force: true
                    });
                    sendResponse({ status: 'completion_attempt_rejected', reason: senderGate.reason });
                    break;
                }
                const correlationGate = validateLifecycleCorrelation(message.llmName, message, 'LLM_COMPLETION_ATTEMPT');
                if (!correlationGate.ok) {
                    emitTelemetry(message.llmName || 'SYSTEM', 'COMPLETION_ATTEMPT_REJECTED', {
                        level: 'warning',
                        details: correlationGate.reason,
                        meta: { reason: correlationGate.reason, ...deliveryIdentityMeta(message.meta || {}) },
                        force: true
                    });
                    sendResponse({ status: 'completion_attempt_rejected', reason: correlationGate.reason });
                    break;
                }
                const authority = recordCompletionAuthorityAttempt(message.llmName, message.meta || {});
                // Authority is accepted by the in-memory/persisted job-state model
                // synchronously. Storage durability is intentionally asynchronous:
                // blocking this ACK on a full jobState write made every provider
                // transaction wait (and retry) behind telemetry/storage pressure.
                emitTelemetry(message.llmName, 'COMPLETION_ATTEMPT_ACCEPTED', {
                    level: 'info',
                    details: 'completion_attempt_recorded',
                    meta: {
                        authorityAccepted: true,
                        rolloutMode: authority?.rolloutMode || null,
                        ...deliveryIdentityMeta(message.meta || {})
                    },
                    force: true
                });
                sendResponse({ status: 'completion_attempt_recorded', rolloutMode: authority?.rolloutMode || null });
                break;
            }

            case 'LLM_COMPLETION_TERMINAL': {
                const senderGate = validateLifecycleSender(message.llmName, sender, 'LLM_COMPLETION_TERMINAL', message.meta || {});
                if (!senderGate.ok) {
                    sendResponse({ status: 'completion_terminal_rejected', reason: senderGate.reason });
                    break;
                }
                const correlationGate = validateLifecycleCorrelation(message.llmName, message, 'LLM_COMPLETION_TERMINAL');
                if (!correlationGate.ok) {
                    sendResponse({ status: 'completion_terminal_rejected', reason: correlationGate.reason });
                    break;
                }
                const authority = recordCompletionAuthorityAttempt(message.llmName, message.meta || {});
                const terminalResult = authority?.terminalResult || null;
                if (terminalResult && terminalResult.status !== 'SUCCESS_TERMINAL' && !isTerminalRouterEntry(jobState?.llms?.[message.llmName])) {
                    const errorType = ({
                        CONTINUE_REQUIRED: 'continue_required',
                        PROVIDER_ERROR: 'provider_error',
                        INTERRUPTED: 'interrupted',
                        STALLED: 'stream_start_timeout',
                        AMBIGUOUS: 'uncertain',
                        CONTEXT_LOST: 'uncertain'
                    })[terminalResult.status] || 'uncertain';
                    handleLLMResponse(message.llmName, '', {
                        type: errorType,
                        message: terminalResult.reason || terminalResult.status
                    }, {
                        ...(message.meta || {}),
                        completionTerminalResult: terminalResult,
                        completionRolloutMode: authority.rolloutMode
                    }, '');
                }
                sendResponse({ status: 'completion_terminal_recorded', terminalStatus: terminalResult?.status || null });
                break;
            }

            case 'LLM_RESPONSE': {
                const senderGate = validateLifecycleSender(message.llmName, sender, 'LLM_RESPONSE');
                if (!senderGate.ok) {
                    sendResponse({ status: 'response_rejected', reason: senderGate.reason });
                    break;
                }
                const correlationGate = validateLifecycleCorrelation(message.llmName, message, 'LLM_RESPONSE');
                if (!correlationGate.ok) {
                    sendResponse({ status: 'response_rejected', reason: correlationGate.reason });
                    break;
                }
                const authorityGate = sender?.tab?.id
                    ? validateCompletionAuthorityDelivery(message.llmName, message)
                    : { ok: true, reason: 'trusted_extension_page_sender' };
                if (!authorityGate.ok) {
                    emitTelemetry(message.llmName, 'ANSWER_DELIVERY_REJECTED', {
                        level: 'warning', details: authorityGate.reason,
                        meta: { ...(message.meta || {}), messageType: 'LLM_RESPONSE' }, force: true
                    });
                    sendResponse({ status: 'response_rejected', reason: authorityGate.reason });
                    break;
                }
                if (message.llmName === 'Perplexity'
                    && perplexityTransientBlockerOwnsLifecycle(jobState?.llms?.[message.llmName], message, sender)) {
                    emitTelemetry(message.llmName, 'TRANSIENT_BLOCKER_RESPONSE_QUARANTINED', {
                        level: 'info',
                        details: message.error?.message || 'original pipeline lifecycle suspended during paywall handoff',
                        meta: {
                            tabId: sender?.tab?.id || null,
                            dispatchId: message?.meta?.dispatchId || null,
                            errorType: message.error?.type || null
                        },
                        force: true
                    });
                    sendResponse({ status: 'response_deferred', reason: 'transient_blocker_active' });
                    break;
                }
                handleLLMResponse(
                    message.llmName,
                    message.answer,
                    message.error || null,
                    message.meta || null,
                    message.answerHtml || message.html || ''
                );
                sendResponse({ status: 'response_handled' });
                break;
            }

            // Some content-scripts can emit FINAL_LLM_RESPONSE (e.g. evaluator flows).
            // Treat it the same as a regular LLM response to avoid "silent" drops.
            case 'FINAL_LLM_RESPONSE': {
                const senderGate = validateLifecycleSender(message.llmName, sender, 'FINAL_LLM_RESPONSE');
                if (!senderGate.ok) {
                    sendResponse({ status: 'final_response_rejected', reason: senderGate.reason });
                    break;
                }
                const correlationGate = validateLifecycleCorrelation(message.llmName, message, 'FINAL_LLM_RESPONSE');
                if (!correlationGate.ok) {
                    sendResponse({ status: 'final_response_rejected', reason: correlationGate.reason });
                    break;
                }
                const authorityGate = sender?.tab?.id
                    ? validateCompletionAuthorityDelivery(message.llmName, message)
                    : { ok: true, reason: 'trusted_extension_page_sender' };
                if (!authorityGate.ok) {
                    emitTelemetry(message.llmName, 'ANSWER_DELIVERY_REJECTED', {
                        level: 'warning', details: authorityGate.reason,
                        meta: { ...(message.meta || {}), messageType: 'FINAL_LLM_RESPONSE' }, force: true
                    });
                    sendResponse({ status: 'final_response_rejected', reason: authorityGate.reason });
                    break;
                }
                if (message.llmName === 'Perplexity'
                    && perplexityTransientBlockerOwnsLifecycle(jobState?.llms?.[message.llmName], message, sender)) {
                    emitTelemetry(message.llmName, 'TRANSIENT_BLOCKER_RESPONSE_QUARANTINED', {
                        level: 'info',
                        details: message.error?.message || 'original final pipeline lifecycle suspended during paywall handoff',
                        meta: {
                            tabId: sender?.tab?.id || null,
                            dispatchId: message?.meta?.dispatchId || null,
                            errorType: message.error?.type || null
                        },
                        force: true
                    });
                    sendResponse({ status: 'final_response_deferred', reason: 'transient_blocker_active' });
                    break;
                }
                handleLLMResponse(
                    message.llmName,
                    message.answer,
                    message.error || null,
                    message.meta || null,
                    message.answerHtml || message.html || ''
                );
                sendResponse({ status: 'final_response_handled' });
                break;
            }

            case 'PROMPT_INSERTION_OBSERVED': {
                // Adapter reports the composer transaction outcome for the current
                // dispatch, success as well as failure. The failure path alone left
                // the insertion_outcome slot unavailable on every successful run, so
                // "was the prompt inserted?" was unanswerable from the ledger.
                const llmName = message.llmName;
                const entry = llmName && jobState?.llms?.[llmName];
                const incomingMeta = message?.meta && typeof message.meta === 'object' ? message.meta : {};
                const senderGate = validateLifecycleSender(llmName, sender, 'PROMPT_INSERTION_OBSERVED', incomingMeta);
                const correlationGate = validateLifecycleCorrelation(llmName, message, 'PROMPT_INSERTION_OBSERVED');
                if (!entry || !senderGate.ok || !correlationGate.ok) {
                    if (typeof sendResponse === 'function') {
                        sendResponse({
                            status: 'prompt_insertion_rejected',
                            reason: !entry
                                ? 'missing_model_entry'
                                : (!senderGate.ok ? senderGate.reason : correlationGate.reason)
                        });
                    }
                    break;
                }
                if (entry) {
                    const inserted = message.insertionState === 'inserted';
                    const dispatchId = incomingMeta.dispatchId;
                    // Insertion was only ever resolved through a waiter, so nothing
                    // outside the dispatch call could tell whether this dispatch got
                    // as far as the composer. Finalization needs that distinction.
                    if (inserted) {
                        entry.promptInsertedAt = Date.now();
                        entry.promptInsertedDispatchId = dispatchId || entry.lastDispatchMeta?.dispatchId || null;
                    }
                    emitTelemetry(llmName, inserted ? 'PROMPT_INSERTION_CONFIRMED' : 'PROMPT_INSERTION_FAILED', {
                        level: inserted ? 'info' : 'error',
                        details: inserted ? (message.method || 'inserted') : (message.reason || 'not_inserted'),
                        meta: {
                            dispatchId,
                            generationEpoch: incomingMeta.generationEpoch
                                ?? entry?.lastDispatchMeta?.generationEpoch
                                ?? entry?.generationEpoch
                                ?? null,
                            attemptId: incomingMeta.attemptId || entry?.lastDispatchMeta?.attemptId || null,
                            insertionState: inserted ? 'inserted' : 'failed',
                            method: message.method || null,
                            reason: message.reason || null,
                            promptLength: Number.isFinite(Number(message.promptLength)) ? Number(message.promptLength) : null,
                            composerLength: Number.isFinite(Number(message.composerLength)) ? Number(message.composerLength) : null,
                            attempt: Number.isFinite(Number(message.attempt)) ? Number(message.attempt) : null
                        },
                        force: true
                    });
                    resolvePromptInsertion(llmName, {
                        ok: inserted,
                        insertionState: inserted ? 'inserted' : 'failed',
                        method: message.method || null,
                        reason: message.reason || null,
                        dispatchId,
                        meta: incomingMeta
                    });
                }
                if (typeof sendResponse === 'function') sendResponse({ status: 'prompt_insertion_ack' });
                break;
            }

            case 'PROVIDER_DISPATCH_STAGE_OBSERVED': {
                const llmName = String(message.llmName || '');
                const incomingMeta = message?.meta && typeof message.meta === 'object' ? message.meta : {};
                const senderGate = validateLifecycleSender(llmName, sender, 'PROVIDER_DISPATCH_STAGE_OBSERVED', incomingMeta);
                const correlationGate = validateLifecycleCorrelation(llmName, message, 'PROVIDER_DISPATCH_STAGE_OBSERVED');
                if (!senderGate.ok || !correlationGate.ok) {
                    sendResponse?.({
                        status: 'provider_dispatch_stage_rejected',
                        reason: !senderGate.ok ? senderGate.reason : correlationGate.reason
                    });
                    break;
                }
                const stage = String(message.stage || '').trim().toLowerCase();
                if (!stage) {
                    sendResponse?.({ status: 'provider_dispatch_stage_rejected', reason: 'missing_stage' });
                    break;
                }
                const entry = jobState?.llms?.[llmName];
                const dispatchId = incomingMeta.dispatchId || entry?.lastDispatchMeta?.dispatchId || null;
                if (entry) {
                    entry.providerDispatchStage = stage;
                    entry.providerDispatchStageAt = Date.now();
                    entry.providerDispatchStageDispatchId = dispatchId;
                }
                emitTelemetry(llmName, 'PROVIDER_DISPATCH_STAGE_OBSERVED', {
                    level: /failed|blocked|timeout/.test(String(message.outcome || message.reason || '')) ? 'warning' : 'info',
                    details: stage,
                    meta: {
                        ...incomingMeta,
                        stage,
                        outcome: message.outcome || null,
                        reason: message.reason || null,
                        elapsedMs: Number.isFinite(Number(message.elapsedMs)) ? Number(message.elapsedMs) : null,
                        composerVisible: typeof message.composerVisible === 'boolean' ? message.composerVisible : null,
                        composerConnected: typeof message.composerConnected === 'boolean' ? message.composerConnected : null
                    },
                    force: true
                });
                if (stage === 'send_action_requested') {
                    self.armPromptSubmittedWaiter?.(llmName, dispatchId);
                    if (entry?.providerSendActionObservedDispatchId !== dispatchId) {
                        if (entry) {
                            entry.providerSendActionObservedDispatchId = dispatchId;
                            entry.providerSendActionObservedAt = Date.now();
                        }
                        emitTelemetry(llmName, 'DISPATCH_SEND', {
                            level: 'info',
                            details: 'provider_send_action_requested',
                            meta: {
                                ...incomingMeta,
                                ...(entry?.lastCommandAcceptedDispatchId === dispatchId
                                    ? (entry.lastCommandAcceptedTiming || {})
                                    : {}),
                                dispatchId,
                                commandAcceptedAt: entry?.lastCommandAcceptedDispatchId === dispatchId
                                    ? entry.lastCommandAcceptedAt || null
                                    : null,
                                providerStage: stage
                            },
                            force: true
                        });
                    }
                }
                if (stage === 'prompt_inserted' || stage === 'send_action_failed') {
                    self.scheduleProviderSendOnlyRecovery?.(llmName, {
                        dispatchId,
                        reason: stage,
                        delayMs: stage === 'send_action_failed' ? 500 : 14000
                    });
                } else if (stage === 'send_action_completed') {
                    self.cancelProviderSendOnlyRecovery?.(llmName);
                }
                sendResponse?.({ status: 'provider_dispatch_stage_ack' });
                break;
            }

            case 'DISPATCH_BASELINE_CAPTURED': {
                // Adapter reports the on-page answer signature captured *before* it sends,
                // so the orchestrator can reject that prior answer until the new one renders
                // (see isStaleBaselineCandidate). Fire-and-forget; survives a failed submit.
                const llmName = message.llmName;
                const entry = llmName && jobState?.llms?.[llmName];
                if (entry) {
                    const sig = typeof message.signature === 'string' ? message.signature : '';
                    const incomingMeta = message?.meta && typeof message.meta === 'object' ? message.meta : null;
                    const expectedRunSessionId = Number(jobState?.session?.startTime || 0) || null;
                    const normalizedMeta = incomingMeta ? Object.assign({}, incomingMeta) : {};
                    if (normalizedMeta.sessionId && !normalizedMeta.runSessionId) {
                        normalizedMeta.runSessionId = normalizedMeta.sessionId;
                    }
                    const incomingRunSessionId = normalizedMeta?.runSessionId ? Number(normalizedMeta.runSessionId) : null;
                    const incomingDispatchId = typeof normalizedMeta?.dispatchId === 'string' ? normalizedMeta.dispatchId : null;
                    const expectedDispatchId = entry?.lastDispatchMeta?.dispatchId || null;
                    const senderTabId = Number(sender?.tab?.id || 0) || null;
                    const expectedTabId = Number(entry?.tabId || 0) || null;
                    const dispatchAccepted = incomingDispatchId
                        ? (!expectedDispatchId || incomingDispatchId === expectedDispatchId)
                        : !expectedDispatchId;
                    const metaMismatch = Boolean(
                        (expectedRunSessionId && incomingRunSessionId && incomingRunSessionId !== expectedRunSessionId)
                        || !dispatchAccepted
                        || (senderTabId && expectedTabId && senderTabId !== expectedTabId)
                    );
                    if (metaMismatch) {
                        emitTelemetry(llmName, 'DISPATCH_BASELINE_REJECTED', {
                            details: 'meta_mismatch',
                            level: 'warning',
                            meta: {
                                dispatchId: incomingDispatchId || null,
                                expectedDispatchId,
                                runSessionId: incomingRunSessionId || null,
                                expectedRunSessionId,
                                senderTabId,
                                expectedTabId
                            }
                        });
                        if (typeof sendResponse === 'function') sendResponse({ status: 'dispatch_baseline_rejected', reason: 'meta_mismatch' });
                        break;
                    }
                    const dispatchId = incomingDispatchId || expectedDispatchId || null;
                    // F6.2: positional turn anchor from the unified pipeline —
                    // how many answer nodes the page already had at dispatch.
                    const anchorAnswerCount = message.anchorAnswerCount !== null
                        && message.anchorAnswerCount !== undefined
                        && Number.isFinite(Number(message.anchorAnswerCount))
                        ? Number(message.anchorAnswerCount)
                        : null;
                    if (anchorAnswerCount !== null) {
                        entry.preDispatchAnswerNodeCount = anchorAnswerCount;
                        entry.preDispatchAnswerNodeCountDispatchId = dispatchId;
                    }
                    if (sig) {
                        entry.preDispatchAnswerSignature = sig;
                        entry.preDispatchAnswerHash = self.AnswerEvidence?.hashText
                            ? self.AnswerEvidence.hashText(String(sig).replace(/\s+/g, ' ').trim().toLowerCase())
                            : null;
                        entry.preDispatchAnswerDispatchId = dispatchId;
                        entry.preDispatchAnswerCapturedAt = Date.now();
                    } else {
                        // Empty baseline = fresh/new chat with no prior answer; clear any stale guard.
                        entry.preDispatchAnswerSignature = null;
                        entry.preDispatchAnswerHash = null;
                        entry.preDispatchAnswerDispatchId = dispatchId;
                        entry.preDispatchAnswerCapturedAt = Date.now();
                    }
                    emitTelemetry(llmName, 'DISPATCH_BASELINE_CAPTURED', {
                        details: `len=${sig.length}`,
                        meta: {
                            dispatchId,
                            generationEpoch: normalizedMeta.generationEpoch
                                ?? entry?.lastDispatchMeta?.generationEpoch
                                ?? entry?.generationEpoch
                                ?? null,
                            attemptId: normalizedMeta.attemptId || entry?.lastDispatchMeta?.attemptId || null,
                            signatureLength: sig.length,
                            baselineHash: entry.preDispatchAnswerHash || null,
                            baselineState: sig ? 'present' : 'empty',
                            anchorAnswerCount
                        }
                    });
                }
                if (typeof sendResponse === 'function') sendResponse({ status: 'dispatch_baseline_ack' });
                break;
            }

            case 'BRIDGE_INJECT_REQUEST': {
                // CSP-safe main-world bridge injection (review P1): inline
                // <script> under the page's CSP can be blocked on provider
                // sites; chrome.scripting.executeScript({world:'MAIN'}) is
                // guaranteed by the browser. The token is delivered by a
                // second func-call through extension args — never via DOM.
                (async () => {
                    const tabId = Number(sender?.tab?.id || 0) || null;
                    const token = typeof message.bridgeToken === 'string' ? message.bridgeToken : '';
                    if (!tabId || !token || !chrome?.scripting?.executeScript) {
                        sendResponse({ ok: false, reason: !tabId ? 'no_sender_tab' : (!token ? 'no_token' : 'scripting_unavailable') });
                        return;
                    }
                    try {
                        await completionRuntimeDeadline(() => chrome.scripting.executeScript({
                            target: { tabId },
                            world: 'MAIN',
                            injectImmediately: true,
                            files: ['content-scripts/content-bridge.js']
                        }));
                        const results = await completionRuntimeDeadline(() => chrome.scripting.executeScript({
                            target: { tabId },
                            world: 'MAIN',
                            injectImmediately: true,
                            func: (bridgeToken) => {
                                try {
                                    return typeof window.__LLM_BRIDGE_SET_TOKEN__ === 'function'
                                        ? window.__LLM_BRIDGE_SET_TOKEN__(bridgeToken)
                                        : null;
                                } catch (_) { return null; }
                            },
                            args: [token]
                        }));
                        const tokenAccepted = Array.isArray(results)
                            ? results.some((item) => item?.result === true)
                            : false;
                        if (!tokenAccepted) {
                            emitTelemetry(message.llmName || 'unknown', 'BRIDGE_TOKEN_NOT_ACCEPTED', {
                                level: 'warning',
                                details: 'main_world_setter_missing_or_consumed',
                                meta: { tabId },
                                force: true
                            });
                        }
                        sendResponse({ ok: true, tokenAccepted });
                    } catch (err) {
                        sendResponse({ ok: false, reason: err?.message || String(err) });
                    }
                })();
                return true;
            }
            case 'GROK_TRUSTED_INPUT_REQUEST': {
                const tabId = sender?.tab?.id;
                const senderUrl = String(sender?.url || sender?.tab?.url || '');
                const isGrokPage = /^https:\/\/(?:[^/]+\.)?(?:grok\.com|x\.ai)\//i.test(senderUrl);
                if (!tabId || !isGrokPage) {
                    sendResponse({ ok: false, reason: 'untrusted_sender' });
                    break;
                }
                (async () => {
                    try {
                        const result = await dispatchTrustedGrokInput(
                            tabId,
                            String(message.mode || ''),
                            String(message.text || ''),
                            message.isMac === true
                        );
                        sendResponse(result);
                    } catch (err) {
                        emitTelemetry('Grok', 'GROK_TRUSTED_INPUT_FAILED', {
                            level: 'error',
                            details: err?.message || String(err),
                            meta: { tabId, mode: String(message.mode || '') },
                            force: true
                        });
                        sendResponse({ ok: false, reason: err?.message || 'trusted_input_failed' });
                    }
                })();
                return true;
            }

            case 'LECHAT_TRUSTED_SEND_REQUEST': {
                const tabId = sender?.tab?.id;
                const senderUrl = String(sender?.url || sender?.tab?.url || '');
                if (!tabId || !/^https:\/\/chat\.mistral\.ai\//i.test(senderUrl)) {
                    sendResponse({ ok: false, reason: 'untrusted_sender' });
                    break;
                }
                dispatchTrustedCtrlEnter(tabId)
                    .then(sendResponse)
                    .catch((err) => sendResponse({ ok: false, reason: err?.message || 'trusted_send_failed' }));
                return true;
            }

            case 'PROVIDER_TRUSTED_SEND_REQUEST': {
                const tabId = sender?.tab?.id;
                const senderUrl = String(sender?.tab?.url || sender?.url || '');
                const model = String(message.llmName || '');
                const allowed = (model === 'Le Chat' && /^https:\/\/chat\.mistral\.ai\//i.test(senderUrl))
                    || (model === 'Perplexity' && /^https:\/\/(?:www\.)?perplexity\.ai\//i.test(senderUrl))
                    || (model === 'Gemini' && /^https:\/\/(?:www\.)?gemini\.google\.com\//i.test(senderUrl))
                    || (model === 'Kimi' && /^https:\/\/(?:www\.)?kimi\.ai\//i.test(senderUrl));
                if (!tabId || !allowed) {
                    sendResponse({ ok: false, reason: 'untrusted_sender' });
                    break;
                }
                dispatchProviderTrustedSend(tabId, model, String(message.prompt || ''))
                    .then(sendResponse)
                    .catch((err) => {
                        const reason = err?.message || 'trusted_send_failed';
                        emitTelemetry(model, 'PROVIDER_TRUSTED_SEND_FAILED', {
                            level: 'error',
                            details: reason,
                            meta: { tabId, debuggerApiAvailable: typeof chrome.debugger?.attach === 'function' },
                            force: true
                        });
                        sendResponse({ ok: false, reason });
                    });
                return true;
            }

            case 'KIMI_TRUSTED_SEND_REQUEST': {
                const tabId = sender?.tab?.id;
                const senderUrl = String(sender?.tab?.url || sender?.url || '');
                if (!tabId || !/^https:\/\/(?:www\.)?kimi\.ai\//i.test(senderUrl)) {
                    sendResponse({ ok: false, reason: 'untrusted_sender' });
                    break;
                }
                dispatchKimiTrustedSend(tabId)
                    .then(sendResponse)
                    .catch((err) => {
                        const reason = err?.message || 'trusted_send_failed';
                        emitTelemetry('Kimi', 'PROVIDER_TRUSTED_SEND_FAILED', {
                            level: 'error',
                            details: reason,
                            meta: { tabId, debuggerApiAvailable: typeof chrome.debugger?.attach === 'function' },
                            force: true
                        });
                        sendResponse({ ok: false, reason });
                    });
                return true;
            }

            case 'KIMI_TRUSTED_INPUT_REQUEST': {
                const tabId = sender?.tab?.id;
                const senderUrl = String(sender?.tab?.url || sender?.url || '');
                if (!tabId || !/^https:\/\/(?:www\.)?kimi\.ai\//i.test(senderUrl)) {
                    sendResponse({ ok: false, reason: 'untrusted_sender' });
                    break;
                }
                dispatchProviderTrustedInput(tabId, 'Kimi', String(message.text || ''), message.isMac === true)
                    .then(sendResponse)
                    .catch((err) => sendResponse({ ok: false, reason: err?.message || 'trusted_input_failed' }));
                return true;
            }

            case 'PERPLEXITY_TRUSTED_ENTER_REQUEST': {
                const tabId = sender?.tab?.id;
                const senderUrl = String(sender?.tab?.url || sender?.url || '');
                if (!tabId || !/^https:\/\/(?:www\.)?perplexity\.ai\//i.test(senderUrl)) {
                    sendResponse({ ok: false, reason: 'untrusted_sender' });
                    break;
                }
                dispatchProviderTrustedEnter(tabId, 'Perplexity', String(message.prompt || ''))
                    .then(sendResponse)
                    .catch((err) => {
                        const reason = err?.message || 'trusted_enter_failed';
                        emitTelemetry('Perplexity', 'PROVIDER_TRUSTED_ENTER_FAILED', {
                            level: 'error',
                            details: reason,
                            meta: { tabId, debuggerApiAvailable: typeof chrome.debugger?.attach === 'function' },
                            force: true
                        });
                        sendResponse({ ok: false, reason });
                    });
                return true;
            }

            case 'PERPLEXITY_TRUSTED_INPUT_REQUEST': {
                const tabId = sender?.tab?.id;
                const senderUrl = String(sender?.tab?.url || sender?.url || '');
                if (!tabId || !/^https:\/\/(?:www\.)?perplexity\.ai\//i.test(senderUrl)) {
                    sendResponse({ ok: false, reason: 'untrusted_sender' });
                    break;
                }
                dispatchProviderTrustedInput(
                    tabId,
                    'Perplexity',
                    String(message.text || ''),
                    message.isMac === true
                )
                    .then(sendResponse)
                    .catch((err) => sendResponse({ ok: false, reason: err?.message || 'trusted_input_failed' }));
                return true;
            }

            case 'PROVIDER_TRUSTED_INPUT_REQUEST': {
                const tabId = sender?.tab?.id;
                const senderUrl = String(sender?.tab?.url || sender?.url || '');
                const model = String(message.llmName || '');
                const allowed = (model === 'Le Chat' && /^https:\/\/chat\.mistral\.ai\//i.test(senderUrl))
                    || (model === 'Perplexity' && /^https:\/\/(?:www\.)?perplexity\.ai\//i.test(senderUrl));
                if (!tabId || !allowed) {
                    sendResponse({ ok: false, reason: 'untrusted_sender' });
                    break;
                }
                dispatchProviderTrustedInput(
                    tabId,
                    model,
                    String(message.text || ''),
                    message.isMac === true
                )
                    .then(sendResponse)
                    .catch((err) => sendResponse({ ok: false, reason: err?.message || 'trusted_input_failed' }));
                return true;
            }

            case 'GEMINI_CDP_ATTACH_REQUEST': {
                const tabId = sender?.tab?.id;
                const senderUrl = String(sender?.tab?.url || sender?.url || '');
                const isGeminiPage = /^https:\/\/gemini\.google\.com\//i.test(senderUrl);
                if (!tabId || !isGeminiPage) {
                    sendResponse({ ok: false, reason: 'untrusted_sender' });
                    break;
                }
                (async () => {
                    try {
                        const fileCount = Array.isArray(message.attachments) ? message.attachments.length : 0;
                        emitTelemetry('Gemini', 'GEMINI_CDP_ATTACH_REQUESTED', {
                            details: `files=${fileCount}`,
                            force: true,
                            meta: { tabId, fileCount }
                        });
                        const result = await dispatchGeminiCdpAttachments(tabId, message.attachments);
                        sendResponse(result);
                    } catch (err) {
                        emitTelemetry('Gemini', 'GEMINI_CDP_ATTACH_FAILED', {
                            level: 'error',
                            details: err?.message || String(err),
                            meta: { tabId },
                            force: true
                        });
                        sendResponse({ ok: false, reason: err?.message || 'cdp_attach_failed' });
                    }
                })();
                return true;
            }

            case 'QWEN_CDP_ATTACH_REQUEST': {
                const tabId = sender?.tab?.id;
                const senderUrl = String(sender?.tab?.url || sender?.url || '');
                const isQwenPage = /^https:\/\/chat\.qwen\.ai\//i.test(senderUrl);
                if (!tabId || !isQwenPage) {
                    sendResponse({ ok: false, reason: 'untrusted_sender' });
                    break;
                }
                (async () => {
                    try {
                        const fileCount = Array.isArray(message.attachments) ? message.attachments.length : 0;
                        emitTelemetry('Qwen', 'QWEN_CDP_ATTACH_REQUESTED', {
                            details: `files=${fileCount}`,
                            force: true,
                            meta: { tabId, fileCount }
                        });
                        sendResponse(await dispatchQwenCdpAttachments(tabId, message.attachments));
                    } catch (err) {
                        emitTelemetry('Qwen', 'QWEN_CDP_ATTACH_FAILED', {
                            level: 'error',
                            details: err?.message || String(err),
                            meta: { tabId },
                            force: true
                        });
                        sendResponse({ ok: false, reason: err?.message || 'qwen_cdp_attach_failed' });
                    }
                })();
                return true;
            }

            case 'PROVIDER_CDP_ATTACH_REQUEST': {
                const tabId = sender?.tab?.id;
                const senderUrl = String(sender?.tab?.url || sender?.url || '');
                const model = String(message.llmName || '');
                const allowed = (model === 'Perplexity' && /^https:\/\/(?:www\.)?perplexity\.ai\//i.test(senderUrl))
                    || (model === 'Z.ai' && /^https:\/\/chat\.z\.ai\//i.test(senderUrl))
                    || (model === 'Kimi' && /^https:\/\/(?:www\.)?kimi\.ai\//i.test(senderUrl));
                if (!tabId || !allowed) {
                    sendResponse({ ok: false, reason: 'untrusted_sender' });
                    break;
                }
                (async () => {
                    try {
                        sendResponse(await dispatchProviderCdpAttachments(tabId, model, message.attachments));
                    } catch (err) {
                        const entry = jobState?.llms?.[model] || null;
                        const navigationOwnsFailure = model === 'Perplexity'
                            && isFreshPerplexityTransientBlocker(entry?.transientBlocker)
                            && Number(entry?.transientBlocker?.tabId || 0) === Number(tabId || 0);
                        emitTelemetry(model, navigationOwnsFailure
                            ? 'PROVIDER_CDP_ATTACH_DEFERRED_TRANSIENT_BLOCKER'
                            : 'PROVIDER_CDP_ATTACH_FAILED', {
                            level: navigationOwnsFailure ? 'info' : 'error',
                            details: err?.message || String(err),
                            meta: { tabId, blockerPhase: entry?.transientBlocker?.phase || null },
                            force: true
                        });
                        sendResponse({
                            ok: false,
                            reason: navigationOwnsFailure
                                ? 'transient_blocker_navigation'
                                : (err?.message || 'provider_cdp_attach_failed')
                        });
                    }
                })();
                return true;
            }

            case 'PROVIDER_DISPATCH_PIPELINE_STATE': {
                const llmName = String(message.llmName || '');
                const senderGate = validateLifecycleSender(llmName, sender, 'PROVIDER_DISPATCH_PIPELINE_STATE');
                if (!senderGate.ok) {
                    sendResponse({ ok: false, reason: senderGate.reason });
                    break;
                }
                const correlationGate = validateLifecycleCorrelation(llmName, message, 'PROVIDER_DISPATCH_PIPELINE_STATE');
                if (!correlationGate.ok) {
                    sendResponse({ ok: false, reason: correlationGate.reason });
                    break;
                }
                const entry = jobState?.llms?.[llmName];
                const phase = ['composer', 'answer_collection'].includes(String(message.phase || ''))
                    ? String(message.phase)
                    : 'composer';
                if (message.active !== true && phase === 'composer' && llmName === 'Perplexity'
                    && perplexityTransientBlockerOwnsLifecycle(entry, message, sender)) {
                    sendResponse({ ok: true, status: 'pipeline_state_deferred_for_transient_blocker' });
                    break;
                }
                if (entry) {
                    const active = message.active === true;
                    const prefix = phase === 'composer' ? 'providerComposerTransaction' : 'providerAnswerCollection';
                    entry[`${prefix}Active`] = active;
                    entry[`${prefix}ActiveAt`] = active ? Date.now() : 0;
                    entry[`${prefix}DispatchId`] = message.meta?.dispatchId || null;
                    // Backward-compatible field now means only duplicate-sensitive
                    // composer ownership, never the long answer wait.
                    entry.providerPipelineActive = entry.providerComposerTransactionActive === true;
                    entry.providerPipelineActiveAt = entry.providerComposerTransactionActiveAt || 0;
                    entry.providerPipelineDispatchId = entry.providerComposerTransactionDispatchId || null;
                }
                sendResponse({ ok: true, phase });
                break;
            }

            case 'PROVIDER_TRANSIENT_BLOCKER_STARTED': {
                const llmName = String(message.llmName || '');
                const senderGate = validateLifecycleSender(llmName, sender, 'PROVIDER_TRANSIENT_BLOCKER_STARTED');
                const correlationGate = validateLifecycleCorrelation(llmName, message, 'PROVIDER_TRANSIENT_BLOCKER_STARTED');
                const identity = normalizePerplexityTransientBlockerIdentity(message, sender);
                const senderUrl = String(sender?.tab?.url || sender?.url || '');
                const phase = message.phase === 'active' ? 'ACTIVE' : 'ARMED';
                const supportedUrl = /^https:\/\/(?:www\.)?perplexity\.ai\//i.test(senderUrl);
                const activeUrlValid = phase !== 'ACTIVE'
                    || /\/pro\/payment(?:\?|\/|$)/i.test(senderUrl) && /(?:\?|&)origin=fileUpload(?:&|$)/i.test(senderUrl);
                if (!senderGate.ok || !correlationGate.ok || llmName !== 'Perplexity'
                    || message.blocker !== PERPLEXITY_TRANSIENT_BLOCKER_KIND
                    || !supportedUrl || !activeUrlValid
                    || identity.token.length < 8 || !identity.runSessionId || !identity.dispatchId || !identity.tabId) {
                    sendResponse({
                        ok: false,
                        reason: senderGate.reason || correlationGate.reason || 'invalid_transient_blocker_start'
                    });
                    break;
                }
                const entry = jobState?.llms?.[llmName];
                if (!entry || isTerminalRouterEntry(entry)) {
                    sendResponse({ ok: false, reason: 'model_run_not_active' });
                    break;
                }
                const current = entry.transientBlocker || null;
                const replacingResumedDispatch = Boolean(
                    current?.phase === 'RESUMING'
                    && Number(current.runSessionId || 0) === Number(identity.runSessionId || 0)
                    && Number(current.tabId || 0) === Number(identity.tabId || 0)
                    && current.dispatchId !== identity.dispatchId
                    && entry?.lastDispatchMeta?.dispatchId === identity.dispatchId
                );
                if (isFreshPerplexityTransientBlocker(current)
                    && !samePerplexityTransientBlocker(current, identity)
                    && !replacingResumedDispatch) {
                    sendResponse({ ok: false, reason: 'different_transient_blocker_active' });
                    break;
                }
                const now = Date.now();
                if (current?.token && current.token !== identity.token) {
                    cancelPerplexityTransientBlockerExpiry(current.token);
                }
                entry.transientBlocker = {
                    ...identity,
                    phase,
                    armedAt: replacingResumedDispatch ? now : (Number(current?.armedAt || 0) || now),
                    startedAt: phase === 'ACTIVE'
                        ? now
                        : (replacingResumedDispatch ? 0 : Number(current?.startedAt || 0)),
                    documentId: sender?.documentId || current?.documentId || null,
                    frameId: Number.isInteger(sender?.frameId) ? sender.frameId : (current?.frameId ?? null)
                };
                entry.transientBlockerActive = PERPLEXITY_TRANSIENT_BLOCKER_KIND;
                entry.transientBlockerActiveAt = now;
                entry.transientBlockerRunSessionId = identity.runSessionId;
                entry.transientBlockerDispatchId = identity.dispatchId;
                entry.transientBlockerTabId = identity.tabId;
                schedulePerplexityTransientBlockerExpiry(
                    identity.token,
                    entry.transientBlocker.armedAt + PERPLEXITY_TRANSIENT_BLOCKER_TTL_MS
                );
                (async () => {
                    await saveJobState(jobState);
                    emitTelemetry(llmName, phase === 'ACTIVE'
                        ? 'PROVIDER_TRANSIENT_BLOCKER_STARTED'
                        : 'PROVIDER_TRANSIENT_BLOCKER_ARMED', {
                        level: 'info',
                        details: `${phase.toLowerCase()}:${identity.dispatchId}`,
                        meta: {
                            tabId: identity.tabId,
                            dispatchId: identity.dispatchId,
                            runSessionId: identity.runSessionId,
                            token: identity.token,
                            phase
                        },
                        force: true
                    });
                    sendResponse({ ok: true, status: phase === 'ACTIVE' ? 'blocker_started' : 'blocker_armed' });
                })();
                return true;
            }

            case 'PROVIDER_TRANSIENT_BLOCKER_CANCELLED': {
                const llmName = String(message.llmName || '');
                const senderGate = validateLifecycleSender(llmName, sender, 'PROVIDER_TRANSIENT_BLOCKER_CANCELLED');
                const correlationGate = validateLifecycleCorrelation(llmName, message, 'PROVIDER_TRANSIENT_BLOCKER_CANCELLED');
                const identity = normalizePerplexityTransientBlockerIdentity(message, sender);
                if (!senderGate.ok || !correlationGate.ok || llmName !== 'Perplexity'
                    || message.blocker !== PERPLEXITY_TRANSIENT_BLOCKER_KIND) {
                    sendResponse({
                        ok: false,
                        reason: senderGate.reason || correlationGate.reason || 'invalid_transient_blocker_cancel'
                    });
                    break;
                }
                const entry = jobState?.llms?.[llmName];
                const current = entry?.transientBlocker || null;
                if (current && !samePerplexityTransientBlocker(current, identity)) {
                    sendResponse({ ok: false, reason: 'transient_blocker_identity_mismatch' });
                    break;
                }
                if (entry) {
                    entry.transientBlocker = null;
                    entry.transientBlockerActive = null;
                    entry.transientBlockerActiveAt = 0;
                    entry.transientBlockerRunSessionId = null;
                    entry.transientBlockerDispatchId = null;
                    entry.transientBlockerTabId = null;
                }
                cancelPerplexityTransientBlockerExpiry(identity.token);
                (async () => {
                    if (entry) await saveJobState(jobState);
                    emitTelemetry(llmName, 'PROVIDER_TRANSIENT_BLOCKER_CANCELLED', {
                        level: 'info',
                        details: String(message.reason || 'attachment_attempt_finished'),
                        meta: { tabId: identity.tabId, dispatchId: identity.dispatchId, token: identity.token },
                        force: true
                    });
                    sendResponse({ ok: true, status: current ? 'blocker_cancelled' : 'already_cancelled' });
                })();
                return true;
            }

            case 'PROVIDER_TRANSIENT_BLOCKER_CLEARED': {
                const llmName = String(message.llmName || '');
                const senderGate = validateLifecycleSender(llmName, sender, 'PROVIDER_TRANSIENT_BLOCKER_CLEARED');
                const identity = normalizePerplexityTransientBlockerIdentity(message, sender);
                const senderUrl = String(sender?.tab?.url || sender?.url || '');
                const entry = jobState?.llms?.[llmName];
                if (!senderGate.ok || llmName !== 'Perplexity'
                    || message.blocker !== PERPLEXITY_TRANSIENT_BLOCKER_KIND
                    || identity.token.length < 8 || !identity.tabId
                    || !/^https:\/\/(?:www\.)?perplexity\.ai\//i.test(senderUrl)
                    || /\/pro\/payment(?:\?|\/|$)/i.test(senderUrl)) {
                    sendResponse({
                        ok: false,
                        reason: senderGate.reason || 'unsupported_transient_blocker'
                    });
                    break;
                }
                if (!entry) {
                    sendResponse({ ok: false, reason: 'model_run_not_active' });
                    break;
                }
                if (entry.lastClearedTransientBlockerToken === identity.token) {
                    cancelPerplexityTransientBlockerExpiry(identity.token);
                    sendResponse({ ok: true, status: 'already_cleared' });
                    break;
                }
                if (entry.finalStatusRecorded) {
                    sendResponse({ ok: false, reason: 'model_run_not_active' });
                    break;
                }
                const current = entry.transientBlocker || null;
                const currentMatches = isFreshPerplexityTransientBlocker(current)
                    && samePerplexityTransientBlocker(current, identity)
                    && Number(jobState?.session?.startTime || 0) === Number(identity.runSessionId || 0);
                if (currentMatches && ['PROBING', 'RESUMING'].includes(current.phase)) {
                    sendResponse({ ok: false, reason: 'transient_blocker_resume_in_progress' });
                    break;
                }
                const liveDispatchId = entry?.lastDispatchMeta?.dispatchId || entry?.runIdentity?.dispatchId || null;
                const ownsCurrentDispatch = liveDispatchId === identity.dispatchId;
                const ownsFailedResumeDispatch = current?.failedResumeDispatchId
                    && current.failedResumeDispatchId === liveDispatchId
                    && current.failedResumeToken === identity.token;
                if (!currentMatches || current.phase !== 'ACTIVE'
                    || (!ownsCurrentDispatch && !ownsFailedResumeDispatch)) {
                    sendResponse({ ok: false, reason: 'transient_blocker_not_active' });
                    break;
                }
                current.phase = 'PROBING';
                current.probeStartedAt = Date.now();
                saveJobState(jobState);
                (async () => {
                    const probe = await probePerplexityResumeDocument(sender, identity);
                    if (!probe.ok) {
                        const probeEntry = jobState?.llms?.[llmName];
                        if (samePerplexityTransientBlocker(probeEntry?.transientBlocker, identity)
                            && probeEntry.transientBlocker.phase === 'PROBING') {
                            probeEntry.transientBlocker.phase = 'ACTIVE';
                            probeEntry.transientBlocker.probeStartedAt = 0;
                            saveJobState(jobState);
                        }
                        emitTelemetry(llmName, 'PROVIDER_TRANSIENT_BLOCKER_RESUME_NOT_READY', {
                            level: 'warning',
                            details: probe.reason || 'resume_document_not_ready',
                            meta: { tabId: identity.tabId, dispatchId: identity.dispatchId, token: identity.token },
                            force: true
                        });
                        sendResponse({ ok: false, reason: probe.reason || 'resume_document_not_ready' });
                        return;
                    }

                    if (self.ReadySignalManager?.handleReadySignal) {
                        self.ReadySignalManager.handleReadySignal(identity.tabId, llmName, {
                            url: senderUrl,
                            tabSessionId: probe.response?.tabSessionId || identity.tabSessionId || null,
                            source: 'transient_blocker_resume_probe'
                        });
                    }

                    const liveEntry = jobState?.llms?.[llmName];
                    if (!liveEntry || liveEntry.finalStatusRecorded
                        || !samePerplexityTransientBlocker(liveEntry.transientBlocker, identity)
                        || liveEntry.transientBlocker.phase !== 'PROBING') {
                        sendResponse({ ok: false, reason: 'transient_blocker_changed_during_probe' });
                        return;
                    }
                    const resumeCount = Number(liveEntry.perplexityPaywallResumeCount || 0);
                    if (resumeCount >= 1) {
                        liveEntry.lastClearedTransientBlockerToken = identity.token;
                        liveEntry.transientBlocker = null;
                        liveEntry.transientBlockerActive = null;
                        liveEntry.transientBlockerActiveAt = 0;
                        liveEntry.transientBlockerRunSessionId = null;
                        liveEntry.transientBlockerDispatchId = null;
                        liveEntry.transientBlockerTabId = null;
                        liveEntry.providerPipelineActive = false;
                        liveEntry.providerPipelineActiveAt = 0;
                        liveEntry.providerPipelineDispatchId = null;
                        liveEntry.awaitingSubmitConfirmation = false;
                        liveEntry.awaitingSubmitConfirmationAt = null;
                        liveEntry.awaitingSubmitConfirmationDispatchId = null;
                        cancelPerplexityTransientBlockerExpiry(identity.token);
                        handleLLMResponse(
                            llmName,
                            '',
                            { type: 'attachment_unavailable', message: 'Perplexity file upload paywall repeated after an accepted resume' },
                            liveEntry.lastDispatchMeta || null,
                            ''
                        );
                        await saveJobState(jobState);
                        sendResponse({ ok: true, status: 'repeated_blocker_terminal' });
                        return;
                    }

                    liveEntry.transientBlocker.phase = 'RESUMING';
                    liveEntry.transientBlocker.resumingAt = Date.now();
                    liveEntry.providerPipelineActive = false;
                    liveEntry.providerPipelineActiveAt = 0;
                    liveEntry.awaitingSubmitConfirmation = false;
                    liveEntry.awaitingSubmitConfirmationAt = null;
                    liveEntry.awaitingSubmitConfirmationDispatchId = null;
                    liveEntry.csBusyUntil = 0;
                    if (liveEntry.preTerminalMaterializeRecovery) {
                        liveEntry.preTerminalMaterializeRecovery = {
                            key: `cancelled:${identity.token}:${Date.now()}`,
                            inFlight: false,
                            cancelledAt: Date.now(),
                            cancelledBy: 'perplexity_transient_blocker_resume'
                        };
                    }

                    const machine = self.DispatchStateManager?.get?.(llmName) || null;
                    const states = self.DISPATCH_STATES || {};
                    if (machine?.isInProgress?.()) {
                        machine.error({
                            error: 'perplexity_transient_navigation_cancelled',
                            code: 'TRANSIENT_NAVIGATION_CANCELLED',
                            blocker: PERPLEXITY_TRANSIENT_BLOCKER_KIND
                        });
                    }
                    if (machine?.is?.(states.ERROR) || machine?.is?.(states.DONE)) {
                        machine.reset();
                    }
                    if (machine && !machine.canQueue?.()) {
                        if (samePerplexityTransientBlocker(liveEntry.transientBlocker, identity)) {
                            liveEntry.transientBlocker.phase = 'ACTIVE';
                            liveEntry.transientBlocker.resumingAt = 0;
                            saveJobState(jobState);
                        }
                        emitTelemetry(llmName, 'PROVIDER_TRANSIENT_BLOCKER_RESUME_FAILED', {
                            level: 'error',
                            details: `dispatch_state_not_idle:${machine.state}`,
                            meta: { tabId: identity.tabId, dispatchId: identity.dispatchId, token: identity.token },
                            force: true
                        });
                        sendResponse({ ok: false, reason: `dispatch_state_not_idle:${machine.state}` });
                        return;
                    }

                    liveEntry.dispatchInFlight = false;
                    liveEntry.messageSent = false;
                    liveEntry.dispatchState = 'IDLE';
                    saveJobState(jobState);
                    emitTelemetry(llmName, 'PROVIDER_TRANSIENT_BLOCKER_RESUME_ATTEMPT', {
                        level: 'info',
                        details: 'composer and runtime listener confirmed; dispatching original request',
                        meta: { tabId: identity.tabId, dispatchId: identity.dispatchId, token: identity.token },
                        force: true
                    });

                    try {
                        const resumePrompt = self.TransportPolicy?.resolvePromptForModel
                            ? self.TransportPolicy.resolvePromptForModel(
                                jobState?.session?.promptsByModel,
                                llmName,
                                jobState.prompt
                            )
                            : jobState.prompt;
                        const result = await self.dispatchPromptToTab(
                            llmName,
                            sender.tab.id,
                            resumePrompt,
                            jobState.attachments || [],
                            'perplexity_paywall_resume',
                            {
                                forceFocus: false,
                                skipNoFocusProbe: false,
                                skipFocusRestore: true,
                                skipSubmitWait: true,
                                resetStateAfterSend: false,
                                requireCommandAcceptance: true
                            }
                        );
                        if (!result?.ok || result?.accepted !== true || !result?.dispatchId) {
                            throw new Error(result?.reason || result?.errorCode || 'resume_command_not_accepted');
                        }
                        const acceptedEntry = jobState?.llms?.[llmName];
                        if (!acceptedEntry || acceptedEntry.finalStatusRecorded) {
                            throw new Error('model_run_closed_before_resume_acceptance');
                        }
                        acceptedEntry.perplexityPaywallResumeCount = resumeCount + 1;
                        acceptedEntry.lastClearedTransientBlockerToken = identity.token;
                        if (samePerplexityTransientBlocker(acceptedEntry.transientBlocker, identity)) {
                            acceptedEntry.transientBlocker = null;
                            acceptedEntry.transientBlockerActive = null;
                            acceptedEntry.transientBlockerActiveAt = 0;
                            acceptedEntry.transientBlockerRunSessionId = null;
                            acceptedEntry.transientBlockerDispatchId = null;
                            acceptedEntry.transientBlockerTabId = null;
                        }
                        cancelPerplexityTransientBlockerExpiry(identity.token);
                        await saveJobState(jobState);
                        emitTelemetry(llmName, 'PROVIDER_TRANSIENT_BLOCKER_RESUME', {
                            level: 'info',
                            details: 'original request accepted by restored Perplexity document',
                            meta: {
                                tabId: identity.tabId,
                                previousDispatchId: identity.dispatchId,
                                dispatchId: result.dispatchId,
                                resumeCount: resumeCount + 1,
                                token: identity.token
                            },
                            force: true
                        });
                        sendResponse({
                            ok: true,
                            status: 'resume_accepted',
                            dispatchId: result.dispatchId,
                            previousDispatchId: identity.dispatchId
                        });
                    } catch (err) {
                        const failedEntry = jobState?.llms?.[llmName];
                        if (samePerplexityTransientBlocker(failedEntry?.transientBlocker, identity)) {
                            failedEntry.transientBlocker.phase = 'ACTIVE';
                            failedEntry.transientBlocker.resumingAt = 0;
                            const failedDispatchId = failedEntry?.lastDispatchMeta?.dispatchId || null;
                            if (failedDispatchId && failedDispatchId !== identity.dispatchId) {
                                failedEntry.transientBlocker.failedResumeDispatchId = failedDispatchId;
                                failedEntry.transientBlocker.failedResumeToken = identity.token;
                                failedEntry.transientBlocker.failedResumeAt = Date.now();
                            }
                            saveJobState(jobState);
                        }
                        emitTelemetry(llmName, 'PROVIDER_TRANSIENT_BLOCKER_RESUME_FAILED', {
                            level: 'error',
                            details: err?.message || String(err),
                            meta: { tabId: identity.tabId, dispatchId: identity.dispatchId, token: identity.token },
                            force: true
                        });
                        sendResponse({ ok: false, reason: err?.message || 'resume_dispatch_failed' });
                    }
                })();
                return true;
            }

            case 'PROMPT_SUBMITTED': {
                const llmName = message.llmName;
                {
                    const senderGate = validateLifecycleSender(llmName, sender, 'PROMPT_SUBMITTED');
                    if (!senderGate.ok) {
                        sendResponse({ status: 'prompt_submitted_rejected', reason: senderGate.reason });
                        break;
                    }
                }
                if (llmName && jobState?.llms?.[llmName]) {
                    const entry = jobState.llms[llmName];
                    const now = Date.now();
                    const flags = self.getDispatchFlags ? self.getDispatchFlags(llmName, entry) : null;

                    const incomingMeta = message?.meta && typeof message.meta === 'object' ? message.meta : null;
                    const expectedRunSessionId = Number(jobState?.session?.startTime || 0) || null;
                    const normalizedMeta = incomingMeta ? Object.assign({}, incomingMeta) : {};
                    if (expectedRunSessionId && !normalizedMeta.runSessionId) {
                        normalizedMeta.runSessionId = expectedRunSessionId;
                    }
                    if (normalizedMeta.sessionId && !normalizedMeta.runSessionId) {
                        normalizedMeta.runSessionId = normalizedMeta.sessionId;
                    }
                    const incomingRunSessionId = normalizedMeta?.runSessionId ? Number(normalizedMeta.runSessionId) : null;
                    const incomingDispatchId = typeof normalizedMeta?.dispatchId === 'string' ? normalizedMeta.dispatchId : null;
                    const expectedDispatchId = entry?.lastDispatchMeta?.dispatchId || null;
                    const hasCorrelationMeta = !!(incomingRunSessionId || incomingDispatchId || expectedRunSessionId);
                    const alreadyConfirmed = incomingDispatchId
                        ? (self.DispatchIdRegistry?.isDispatchConfirmed?.(incomingDispatchId) || entry?.confirmedDispatchId === incomingDispatchId)
                        : !!entry?.promptSubmittedAt;

                    // If the content-script echoes dispatch meta, enforce matching to avoid cross-run pollution.
                    const metaMismatch = (() => {
                        if (!incomingMeta) return false;
                        if (expectedRunSessionId && incomingRunSessionId && incomingRunSessionId !== expectedRunSessionId) return true;
                        if (expectedDispatchId && incomingDispatchId !== expectedDispatchId) return true;
                        return false;
                    })();

                    if (metaMismatch) {
                        emitTelemetry(llmName, 'PROMPT_SUBMITTED_REJECTED', {
                            details: 'meta_mismatch',
                            level: 'warning',
                            meta: {
                                dispatchId: incomingDispatchId || null,
                                runSessionId: incomingRunSessionId || null,
                                expectedRunSessionId,
                                reason: 'meta_mismatch'
                            }
                        });
                        broadcastDiagnostic(llmName, {
                            type: 'DISPATCH',
                            label: 'PROMPT_SUBMITTED ignored (dispatch mismatch)',
                            details: `dispatchId=${incomingDispatchId || 'n/a'} runSessionId=${incomingRunSessionId || 'n/a'} expectedRunSessionId=${expectedRunSessionId || 'n/a'}`,
                            level: 'warning'
                        });
                        sendResponse({ status: 'prompt_submitted_ack' });
                        break;
                    }
                    if (alreadyConfirmed) {
                        emitTelemetry(llmName, 'PROMPT_SUBMITTED_STALE', {
                            details: 'duplicate_dispatch_id',
                            level: 'warning',
                            meta: { dispatchId: incomingDispatchId }
                        });
                        broadcastDiagnostic(llmName, {
                            type: 'DISPATCH',
                            label: 'PROMPT_SUBMITTED ignored (duplicate)',
                            details: `dispatchId=${incomingDispatchId || 'n/a'}`,
                            level: 'warning'
                        });
                        sendResponse({ status: 'prompt_submitted_ack' });
                        break;
                    }

                    // Guard against late/stale PROMPT_SUBMITTED from an old run:
                    // only accept if we actually dispatched something recently.
                    const lastDispatchAt = Number(entry?.lastDispatchAt || 0);
                    const attempts = Number(entry?.dispatchAttempts || 0);
                    const ageMs = lastDispatchAt ? (now - lastDispatchAt) : null;
                    const inFlight = flags ? flags.isInFlight : !!entry?.dispatchInFlight;
                    const stale = !inFlight && (attempts <= 0 || !lastDispatchAt || (typeof ageMs === 'number' && ageMs > 5 * 60 * 1000));
                    const confirmedFlag = typeof normalizedMeta?.confirmed === 'boolean' ? normalizedMeta.confirmed : null;

                    if (confirmedFlag === false) {
                        emitTelemetry(llmName, 'PROMPT_SUBMITTED_UNCONFIRMED', {
                            level: 'warning',
                            details: `attempts=${attempts} lastDispatchAgeMs=${ageMs ?? 'n/a'}`,
                            meta: {
                                dispatchId: incomingDispatchId || null,
                                runSessionId: incomingRunSessionId || expectedRunSessionId || null,
                                confirmed: false,
                                submitMethod: normalizedMeta.submitMethod || null,
                                submitEvidence: normalizedMeta.submitEvidence || null
                            }
                        });
                        broadcastDiagnostic(llmName, {
                            type: 'DISPATCH',
                            label: 'Submit signal without confirmation',
                            details: `dispatchId=${incomingDispatchId || 'n/a'} runSessionId=${incomingRunSessionId || 'n/a'}`,
                            level: 'warning'
                        });
                        sendResponse({ status: 'prompt_submitted_ack' });
                        break;
                    }

                    if (!alreadyConfirmed && incomingDispatchId && incomingDispatchId === expectedDispatchId && (!stale || hasCorrelationMeta)) {
                        entry.promptSubmittedAt = now;
                        entry.lastRuntimeActivityAt = now;
                        entry.lastRuntimeActivitySource = 'prompt_submitted';
                        entry.csBusyUntil = 0;
                        entry.awaitingSubmitConfirmation = false;
                        entry.awaitingSubmitConfirmationAt = null;
                        entry.awaitingSubmitConfirmationDispatchId = null;
                        entry.confirmedDispatchId = incomingDispatchId || entry?.lastDispatchMeta?.dispatchId || null;
                        entry.submitSource = 'content';
                        self.cancelProviderSendOnlyRecovery?.(llmName);
                        if (self.PipelineFSM?.markSubmitted) {
                            const currentControl = jobState?.session?.pipelineControl || self.PipelineFSM.normalizeControlState?.({
                                pipelineRunId: jobState?.session?.pipelineRunId || null,
                                sessionId: jobState?.session?.startTime || null,
                                state: jobState?.session?.pipelineState || 'IDLE',
                                stage: jobState?.session?.pipelineStage || null,
                                round: jobState?.session?.pipelineRoundId || null
                            });
                            const nextControl = self.PipelineFSM.markSubmitted(currentControl, {
                                llmName,
                                dispatchId: entry.confirmedDispatchId,
                                tabSessionId: normalizedMeta.tabSessionId || null,
                                pipelineRunId: incomingRunSessionId || expectedRunSessionId || null,
                                stage: 'submitted',
                                reason: 'prompt_submitted'
                            });
                            if (nextControl) {
                                jobState.session = jobState.session || {};
                                jobState.session.pipelineControl = nextControl;
                                jobState.session.pipelineRunId = nextControl.pipelineRunId || jobState.session.pipelineRunId || null;
                                jobState.session.pipelineState = nextControl.state || jobState.session.pipelineState || 'IDLE';
                                jobState.session.pipelineStage = nextControl.stage || jobState.session.pipelineStage || null;
                                saveJobState(jobState);
                                try { chrome.storage.session.set({ [self.PipelineFSM.STORAGE_KEY]: nextControl }); } catch (_) {}
                            }
                        }
                        if (self.DispatchStateManager) {
                            const machine = self.DispatchStateManager.get(llmName);
                            const states = self.DISPATCH_STATES || {};
                            if (machine.is(states.IDLE)) {
                                machine.queue({
                                    prompt: jobState?.prompt,
                                    attachments: jobState?.attachments || [],
                                    dispatchId: entry.confirmedDispatchId || `${llmName}:${now}`
                                });
                            }
                            if (machine.is(states.QUEUED)) {
                                machine.activate({ tabId: entry?.tabId ?? null, inferred: true });
                            }
                            if (machine.is(states.ACTIVATING)) {
                                machine.ready({ inferred: true });
                            }
                            if (machine.is(states.TYPING)) {
                                machine.submit({ inferred: true });
                            }
                            if (machine.is(states.SUBMITTING)) {
                                machine.sent({ confirmedAt: now, dispatchId: entry.confirmedDispatchId });
                            }
                        }
                        if (incomingDispatchId && self.DispatchIdRegistry?.markDispatchConfirmed) {
                            self.DispatchIdRegistry.markDispatchConfirmed(incomingDispatchId, {
                                llmName,
                                tabId: entry?.tabId || null
                            });
                        }
                        if (self.DispatchCircuit?.recordDispatchSuccess) {
                            self.DispatchCircuit.recordDispatchSuccess(llmName);
                        }
                        emitTelemetry(llmName, 'PROMPT_SUBMITTED_ACCEPTED', {
                            meta: {
                                dispatchId: entry.confirmedDispatchId,
                                runSessionId: incomingRunSessionId || expectedRunSessionId || null,
                                generationEpoch: normalizedMeta.generationEpoch ?? entry?.generationEpoch ?? null,
                                attemptId: normalizedMeta.attemptId || entry?.lastDispatchMeta?.attemptId || null,
                                confirmed: confirmedFlag !== false,
                                submitMethod: normalizedMeta.submitMethod || null,
                                submitEvidence: normalizedMeta.submitEvidence || null
                            }
                        });
                        broadcastDiagnostic(llmName, {
                            type: 'DISPATCH',
                            label: 'Submit confirmation signal from content',
                            level: 'success'
                        });
                        if (typeof self.armScriptRuntimeHardStopForConfirmedPrompt === 'function') {
                            self.armScriptRuntimeHardStopForConfirmedPrompt(llmName, {
                                dispatchId: entry.confirmedDispatchId || incomingDispatchId || null,
                                tabId: entry?.tabId || null
                            });
                        }
                        resolvePromptSubmitted(llmName, { ok: true, ts: entry.promptSubmittedAt, meta: normalizedMeta, dispatchId: entry.confirmedDispatchId });
                        if (typeof self.scheduleAdaptiveCollectionProbe === 'function') {
                            self.scheduleAdaptiveCollectionProbe(
                                llmName,
                                expectedRunSessionId || jobState?.session?.startTime || null,
                                { reason: 'prompt_submitted', source: 'adaptive_submit' }
                            );
                        }
                    } else if (stale) {
                        emitTelemetry(llmName, 'PROMPT_SUBMITTED_STALE', {
                            details: `attempts=${attempts} lastDispatchAgeMs=${ageMs ?? 'n/a'} inFlight=${inFlight}`,
                            level: 'warning',
                            meta: { reason: 'stale', dispatchId: incomingDispatchId || null }
                        });
                        broadcastDiagnostic(llmName, {
                            type: 'DISPATCH',
                            label: 'PROMPT_SUBMITTED ignored (stale)',
                            details: `attempts=${attempts} lastDispatchAgeMs=${ageMs ?? 'n/a'} inFlight=${inFlight}`,
                            level: 'warning'
                        });
                    }
                }
                sendResponse({ status: 'prompt_submitted_ack' });
                break;
            }

            // v2.54 (2025-12-19 19:36): Handle early ready signals from content scripts
            case 'SCRIPT_READY_EARLY': {
                const llmName = message.llmName;
                if (llmName) {
                    globalThis.LLMLog?.debug?.(`[BACKGROUND] Early ready signal received from ${llmName}`);
                    resolveEarlyReadySignal(llmName);
                    sendResponse({ status: 'early_ready_ack' });
                } else {
                    sendResponse({ status: 'early_ready_ignored' });
                }
                break;
            }
            case 'COMPLETION_RUNTIME_READY': {
                const tabId = Number(sender?.tab?.id || 0) || null;
                const runtime = message?.runtime && typeof message.runtime === 'object' ? message.runtime : null;
                if (!tabId || !isCompletionRuntimeHealthy(runtime)) {
                    emitTelemetry(message?.llmName || 'SYSTEM', 'COMPLETION_RUNTIME_UNAVAILABLE', {
                        level: 'error',
                        details: 'runtime announcement rejected',
                        meta: { tabId, expectedRuntime: expectedCompletionRuntime(), observedRuntime: runtime },
                        force: true
                    });
                    sendResponse({ status: 'completion_runtime_rejected', expectedRuntime: expectedCompletionRuntime() });
                    break;
                }
                completionRuntimeByTab.set(tabId, { ...runtime, verifiedAt: Date.now() });
                if (message?.llmName) {
                    emitTelemetry(message.llmName, 'COMPLETION_RUNTIME_READY', {
                        level: 'success',
                        details: message?.reason || 'runtime announced',
                        meta: { tabId, runtime },
                        force: true
                    });
                }
                sendResponse({ status: 'completion_runtime_recorded' });
                break;
            }
            case 'SCRIPT_READY': {
                const llmName = message.llmName;
                const tabId = sender?.tab?.id;
                const reportedRuntime = message?.meta?.completionRuntime || null;
                if (tabId && isCompletionRuntimeHealthy(reportedRuntime)) {
                    completionRuntimeByTab.set(Number(tabId), { ...reportedRuntime, verifiedAt: Date.now() });
                }
                const runtime = completionRuntimeByTab.get(Number(tabId)) || null;
                if (tabId && !isCompletionRuntimeHealthy(runtime)) {
                    void ensureCompletionRuntimeInTab(tabId, llmName);
                    sendResponse({
                        status: 'ready_deferred_completion_runtime',
                        expectedRuntime: expectedCompletionRuntime(),
                        observedRuntime: runtime
                    });
                    return true;
                }
                if (tabId && self.ReadySignalManager?.handleReadySignal) {
                    const meta = message.meta || {};
                    const tabSessionId = message.tabSessionId || meta.tabSessionId || null;
                    const info = self.ReadySignalManager.handleReadySignal(tabId, llmName, {
                        ...meta,
                        tabSessionId
                    });
                    const dispatchId = jobState?.llms?.[llmName]?.lastDispatchMeta?.dispatchId || null;
                    if (self.PipelineFSM?.markReady) {
                        const currentControl = jobState?.session?.pipelineControl || self.PipelineFSM.normalizeControlState?.({
                            pipelineRunId: jobState?.session?.pipelineRunId || null,
                            sessionId: jobState?.session?.startTime || null,
                            state: jobState?.session?.pipelineState || 'IDLE',
                            stage: jobState?.session?.pipelineStage || null,
                            round: jobState?.session?.pipelineRoundId || null
                        });
                        const nextControl = self.PipelineFSM.markReady(currentControl, {
                            llmName,
                            dispatchId,
                            tabId,
                            tabSessionId,
                            pipelineRunId: jobState?.session?.pipelineRunId || null,
                            stage: 'ready',
                            reason: 'script_ready'
                        });
                        if (nextControl) {
                            jobState.session = jobState.session || {};
                            jobState.session.pipelineControl = nextControl;
                            jobState.session.pipelineRunId = nextControl.pipelineRunId || jobState.session.pipelineRunId || null;
                            jobState.session.pipelineState = nextControl.state || jobState.session.pipelineState || 'IDLE';
                            jobState.session.pipelineStage = nextControl.stage || jobState.session.pipelineStage || null;
                            saveJobState(jobState);
                            try { chrome.storage.session.set({ [self.PipelineFSM.STORAGE_KEY]: nextControl }); } catch (_) {}
                        }
                    }
                    const ackPayload = {
                        type: 'ACK_READY',
                        llmName,
                        tabSessionId,
                        dispatchId,
                        ackAt: Date.now()
                    };
                    globalThis.LLMLog?.debug?.(`[READY] ACK_READY -> ${llmName} tab=${tabId} session=${tabSessionId || 'n/a'}`);
                    chrome.tabs.sendMessage(tabId, ackPayload).catch(() => {});
                    try {
                        if (typeof sendMessageToResultsTab === 'function') {
                            sendMessageToResultsTab({
                                type: 'SMART_SCRIPT_READY_ACK',
                                llmName,
                                tabId,
                                tabSessionId,
                                dispatchId,
                                ackAt: ackPayload.ackAt
                            });
                        }
                    } catch (_) {}
                    self.ReadySignalManager.markAcked?.(tabId, ackPayload);
                    sendResponse({ status: 'ready_ack', info });
                } else {
                    sendResponse({ status: 'ready_ignored' });
                }
                break;
            }
            case 'ANSWER_SNAPSHOT': {
                {
                    const senderGate = validateLifecycleSender(message.llmName, sender, 'ANSWER_SNAPSHOT');
                    if (!senderGate.ok) {
                        sendResponse({ status: 'snapshot_ignored', reason: senderGate.reason });
                        break;
                    }
                }
                {
                    const correlationGate = validateLifecycleCorrelation(message.llmName, message, 'ANSWER_SNAPSHOT');
                    if (!correlationGate.ok) {
                        sendResponse({ status: 'snapshot_ignored', reason: correlationGate.reason });
                        break;
                    }
                }
                (async () => {
                    try {
                        if (typeof self.saveAnswerSnapshotFromContent !== 'function') {
                            sendResponse({ status: 'snapshot_ignored', reason: 'collector_unavailable' });
                            return;
                        }
                        const result = await self.saveAnswerSnapshotFromContent(message, sender);
                        sendResponse(result);
                    } catch (err) {
                        console.warn('[LateAnswerCollector] ANSWER_SNAPSHOT failed', err);
                        sendResponse({ status: 'snapshot_failed', error: err?.message || String(err) });
                    }
                })();
                return true;
            }
            case 'SPA_NAVIGATION': {
                const tabId = sender?.tab?.id;
                const llmName = message.llmName || (tabId ? TabMapManager.getNameByTabId(tabId) : null);
                if (tabId && self.ReadySignalManager?.markTabNotReady) {
                    self.ReadySignalManager.markTabNotReady(tabId);
                }
                if (llmName && typeof initRequestMetadata === 'function') {
                    initRequestMetadata(llmName, tabId || null, message.newUrl || message.newURL || '');
                }
                if (llmName && jobState?.llms?.[llmName]) {
                    const entry = jobState.llms[llmName];
                    entry.lastSpaNavigationAt = Date.now();
                    const newUrl = message.newUrl || message.newURL || '';
                    if (newUrl) {
                        entry.lastKnownUrl = newUrl;
                    }
                }
                emitTelemetry(llmName || 'ROUNDS', 'SPA_NAVIGATION', {
                    details: message.reason || 'url_change',
                    meta: {
                        tabId: tabId || null,
                        llmName: llmName || null,
                        newUrl: message.newUrl || message.newURL || null
                    }
                });
                sendResponse({ status: 'spa_navigation_ack' });
                break;
            }

            // Purpose: ensure focus requests only activate the current session/tab.
            case 'NEED_FOCUS': {
                const tabId = sender?.tab?.id;
                const requestSessionId = message.sessionId;
                const currentSessionId = jobState?.session?.startTime || null;
                const reason = message.reason || 'unknown';

                if (!tabId || !requestSessionId || requestSessionId !== currentSessionId) {
                    globalThis.LLMLog?.debug?.(`[NEED_FOCUS] Ignored stale focus request from tab ${tabId} (session ${requestSessionId})`);
                    if (tabId) {
                        chrome.tabs.sendMessage(tabId, {
                            type: 'SESSION_EXPIRED',
                            currentSessionId
                        }).catch(() => {});
                    }
                    sendResponse({ status: 'focus_denied_stale' });
                    break;
                }

                const llmName = message.model || (tabId ? TabMapManager.getNameByTabId(tabId) : null);
                if (!llmName) {
                    globalThis.LLMLog?.debug?.('[NEED_FOCUS] Ignored: unknown LLM for focus request');
                    sendResponse({ status: 'focus_denied_unknown_llm' });
                    break;
                }

                const expectedTabId = TabMapManager.get(llmName);
                if (!expectedTabId || expectedTabId !== tabId) {
                    globalThis.LLMLog?.debug?.(`[NEED_FOCUS] Ignored: tab ${tabId} is not mapped to ${llmName}`);
                    sendResponse({ status: 'focus_denied_wrong_tab' });
                    break;
                }

                const entry = jobState?.llms?.[llmName];
                if (!entry) {
                    globalThis.LLMLog?.debug?.(`[NEED_FOCUS] Ignored: ${llmName} has no active entry`);
                    sendResponse({ status: 'focus_denied_no_entry' });
                    break;
                }

                if (isTerminalRouterEntry(entry)) {
                    globalThis.LLMLog?.debug?.(`[NEED_FOCUS] Ignored: ${llmName} is in terminal status ${entry.status}`);
                    sendResponse({ status: 'focus_denied_terminal' });
                    break;
                }

                if (reason === 'visibility' || entry.promptSubmittedAt || self.isInitialPromptPassActive?.()) {
                    sendResponse({ status: 'focus_deferred', reason: reason === 'visibility'
                        ? 'already_visible' : (entry.promptSubmittedAt ? 'prompt_already_submitted' : 'initial_dispatch_pass') });
                    break;
                }

                globalThis.LLMLog?.debug?.(`[NEED_FOCUS] Activating tab ${tabId} for ${llmName} (reason: ${reason})`);
                const focus = async () => {
                    if (jobState?.session?.startTime !== currentSessionId || jobState?.llms?.[llmName] !== entry
                        || entry.promptSubmittedAt || isTerminalRouterEntry(entry) || self.isInitialPromptPassActive?.()) {
                        return { status: 'focus_deferred', reason: 'context_changed' };
                    }
                    const activated = await self.activateTabForDispatch?.(tabId);
                    return { status: activated === true ? 'focus_granted' : 'focus_unavailable' };
                };
                Promise.resolve(self.withPromptDispatchFocusLock ? self.withPromptDispatchFocusLock(focus) : focus())
                    .then(result => sendResponse(result || { status: 'focus_unavailable' }))
                    .catch(() => sendResponse({ status: 'focus_unavailable' }));
                return true;
            }

            case 'HUMANOID_EVENT': {
                const event = message.event;
                const detail = message.detail || {};
                const source = detail.source || '';

                // Extract LLM name from source (e.g., "lechat:inject" -> "Le Chat")
                const llmName = (() => {
                    if (source.includes('lechat')) return 'Le Chat';
                    if (source.includes('claude')) return 'Claude';
                    if (source.includes('grok')) return 'Grok';
                    if (source.includes('chatgpt')) return 'ChatGPT';
                    if (source.includes('gemini')) return 'Gemini';
                    if (source.includes('deepseek')) return 'DeepSeek';
                    if (source.includes('qwen')) return 'Qwen';
                    if (source.includes('perplexity')) return 'Perplexity';
                    if (source.includes('zai') || source.includes('z.ai')) return 'Z.ai';
                    if (source.includes('kimi')) return 'Kimi';
                    return null;
                })();

                if (!llmName) {
                    sendResponse({ status: 'humanoid_event_ignored' });
                    break;
                }

                const lifecycleEntry = jobState?.llms?.[llmName] || null;
                const lifecycleBlocker = lifecycleEntry?.transientBlocker || null;
                if (llmName === 'Perplexity'
                    && event === 'activity:error'
                    && isFreshPerplexityTransientBlocker(lifecycleBlocker)
                    && Number(lifecycleBlocker.tabId || 0) === Number(sender?.tab?.id || 0)) {
                    sendResponse({ status: 'humanoid_event_deferred', reason: 'transient_blocker_active' });
                    break;
                }

                // Handle different event types
                if (event === 'activity:heartbeat') {
                    const phase = detail.phase || '';
                    const status = (() => {
                        switch (phase) {
                            case 'composer-search':
                                return 'INITIALIZING';
                            case 'composer-ready':
                                return 'PROMPT_READY';
                            case 'typing':
                                return 'INJECTING';
                            case 'send-dispatched':
                                return 'SENDING';
                            case 'waiting-response':
                            case 'pipeline':
                                return 'RECEIVING';
                            case 'response-processed':
                                return 'COMPLETE';
                            default:
                                return null;
                        }
                    })();

                    if (status) {
                        updateModelState(llmName, status, {
                            phase,
                            progress: detail.progress || 0,
                            message: `Phase: ${phase}`
                        });
                    }
                } else if (event === 'activity:start') {
                    updateModelState(llmName, 'INITIALIZING', {
                        message: 'Starting activity...'
                    });
                } else if (event === 'activity:stop') {
                    // Don't change status - let handleLLMResponse set the final status
                    // Just log the lifecycle event
                    appendLogEntry(llmName, {
                        type: 'LIFECYCLE',
                        label: 'Activity lifecycle completed',
                        details: detail.answerLength ? `Answer received, length: ${detail.answerLength}` : '',
                        level: 'info'
                    });
                } else if (event === 'activity:error') {
                    const errorType = String(detail.errorType || '').trim().toLowerCase();
                    if (['prompt_injection_failed', 'injection_failed'].includes(errorType)) {
                        const insertionEntry = jobState?.llms?.[llmName] || null;
                        emitTelemetry(llmName, 'PROMPT_INSERTION_FAILED', {
                            level: 'error',
                            details: detail.error || errorType,
                            meta: {
                                dispatchId: insertionEntry?.lastDispatchMeta?.dispatchId || null,
                                generationEpoch: insertionEntry?.generationEpoch ?? null,
                                insertionState: 'failed',
                                errorType,
                                source: detail.source || null,
                                promptLength: Number.isFinite(Number(detail.promptLength)) ? Number(detail.promptLength) : null
                            },
                            force: true
                        });
                    }
                    // Only update status indicator for FATAL errors (selector not found, injection failed)
                    // Timeouts and pipeline errors are handled by handleLLMResponse
                    if (detail.fatal) {
                        updateModelState(llmName, 'CRITICAL_ERROR', {
                            message: detail.error || 'Critical error occurred'
                        });
                    }
                }

                sendResponse({ status: 'humanoid_event_processed' });
                break;
            }

            case 'CONTENT_CLEANING_STATS':
                globalThis.LLMLog?.debug?.(`[BACKGROUND] Cleaning stats from ${message.llmName}:`, message.stats);
                sendResponse({ status: 'stats_received' });
                break;

            case 'METRICS_REPORT':
                globalThis.LLMLog?.debug?.(`[BACKGROUND] Metrics report from ${message.llmName}:`, message.metrics);
                sendResponse({ status: 'metrics_received' });
                break;

            case 'SELECTOR_METRIC': {
                const event = message.event;
                const payload = message.payload || {};
                if (event === 'selector_search_failed' || event === 'selector_search_error') {
                    recordSelectorFailureMetric({
                        modelName: payload.modelName,
                        elementType: payload.elementType,
                        event
                    }).then(() => {
                        sendResponse({ status: 'metric_recorded' });
                    }).catch((err) => {
                        console.warn('[BACKGROUND] Failed to record selector metric', err);
                        sendResponse({ status: 'metric_error', error: err?.message });
                    });
                    return true;
                }
                sendResponse({ status: 'metric_ignored' });
                break;
            }

            case 'METRIC_EVENT':
                if (message.event === 'selector_resolution') {
                    recordResolutionMetric({
                        modelName: message.modelName,
                        elementType: message.elementType,
                        layer: message.layer || message.method
                    })
                        .then(() => sendResponse({ status: 'metric_recorded' }))
                        .catch((err) => {
                            console.warn('[BACKGROUND] Failed to record metric event', err);
                            sendResponse({ status: 'metric_error', error: err?.message });
                        });
                    return true;
                }
                sendResponse({ status: 'metric_ignored' });
                break;

            case 'VISUAL_RESOLVE_REQUEST':
                sendResponse({
                    ok: false,
                    disabled: true,
                    reason: 'visual_resolver_not_enabled'
                });
                break;

            case 'ANSWER_CARD_RENDER_EVALUATED': {
                const llmName = String(message.llmName || '');
                const entry = jobState?.llms?.[llmName];
                const senderTabId = Number(sender?.tab?.id || 0) || null;
                const expectedDispatchId = entry?.lastDispatchMeta?.dispatchId || entry?.runIdentity?.dispatchId || null;
                const incomingDispatchId = message?.meta?.dispatchId || null;
                if (!entry || (resultsTabId && senderTabId !== resultsTabId)) {
                    sendResponse({ ok: false, reason: !entry ? 'missing_model_entry' : 'not_results_tab' });
                    break;
                }
                emitTelemetry(llmName, 'ANSWER_CARD_RENDER_EVALUATED', {
                    level: message?.meta?.outcome === 'matched' ? 'success' : 'warning',
                    details: message?.meta?.outcome || 'unknown',
                    meta: {
                        ...(message.meta || {}),
                        runSessionId: jobState?.session?.startTime || null,
                        expectedDispatchId,
                        dispatchMatches: Boolean(expectedDispatchId && incomingDispatchId === expectedDispatchId)
                    },
                    force: true
                });
                sendResponse({ ok: true });
                break;
            }

            case 'LLM_RESPONSE_READY':
                if (message?.meta?.terminalResult?.status !== 'SUCCESS_TERMINAL') {
                    emitTelemetry(message?.llmName || null, 'ANSWER_DELIVERY_REJECTED', {
                        level: 'warning',
                        details: 'missing_success_terminal_authority',
                        meta: { terminalResult: message?.meta?.terminalResult || null },
                        force: true
                    });
                    sendResponse({ status: 'response_ready_rejected', reason: 'missing_success_terminal_authority' });
                    break;
                }
                {
                    const senderGate = validateLifecycleSender(message.llmName, sender, 'LLM_RESPONSE_READY', message.meta || {});
                    if (!senderGate.ok) {
                        sendResponse({ status: 'response_ready_rejected', reason: senderGate.reason });
                        break;
                    }
                }
                {
                    const correlationGate = validateLifecycleCorrelation(message.llmName, message, 'LLM_RESPONSE_READY');
                    if (!correlationGate.ok) {
                        sendResponse({ status: 'response_ready_rejected', reason: correlationGate.reason });
                        break;
                    }
                }
                if (message.llmName) {
                    const entry = jobState?.llms?.[message.llmName];
                    const isTerminal = isTerminalRouterEntry(entry);
                    if (isTerminal) {
                        emitTelemetry(message.llmName, 'ANSWER_DELIVERY_REJECTED', {
                            level: 'warning',
                            details: 'post_terminal_noise',
                            meta: {
                                messageType: 'LLM_RESPONSE_READY',
                                reason: 'post_terminal_noise',
                                terminalStatus: entry?.finalStatus || entry?.status || null,
                                ...deliveryIdentityMeta(message.meta || {})
                            },
                            force: true
                        });
                        if (self.commitModelRunTransition) {
                            self.commitModelRunTransition(message.llmName, entry, 'POST_TERMINAL_NOISE', {
                                label: 'LLM_RESPONSE_READY',
                                source: 'message_router_response_ready_terminal',
                                ts: Date.now(),
                                runSessionId: jobState?.session?.startTime || null,
                                dispatchId: entry?.lastDispatchMeta?.dispatchId || null,
                                tabId: entry?.tabId || null
                            });
                            try { saveJobState(jobState); } catch (_) {}
                        } else if (self.ModelRunState?.recordPostTerminalNoise) {
                            self.ModelRunState.recordPostTerminalNoise(entry, {
                                label: 'LLM_RESPONSE_READY',
                                ts: Date.now()
                            });
                            try { saveJobState(jobState); } catch (_) {}
                        }
                        sendResponse({ status: 'response_ready_ignored_terminal' });
                        break;
                    }
                    if (entry) {
                        entry.lifecycleReadyAt = Date.now();
                        entry.lifecycleReadyMeta = message.meta || {};
                        const lifecycleAnswerText = String(message.answerText || '').trim();
                        const lifecycleDispatchId = message?.meta?.dispatchId
                            || entry?.lastDispatchMeta?.dispatchId
                            || entry?.confirmedDispatchId
                            || null;
                        const lifecycleProofIdentity = {
                            runSessionId: message?.meta?.runSessionId || message?.meta?.sessionId || jobState?.session?.startTime || null,
                            dispatchId: lifecycleDispatchId,
                            generationEpoch: message?.meta?.generationEpoch ?? entry?.generationEpoch ?? null,
                            attemptId: message?.meta?.attemptId || entry?.lastDispatchMeta?.attemptId || null
                        };
                        const lifecycleValidation = lifecycleAnswerText && typeof self.validateMaterializedAnswerEvidence === 'function'
                            ? self.validateMaterializedAnswerEvidence(message.llmName, lifecycleAnswerText, {
                                source: 'lifecycle_complete_snapshot',
                                entry,
                                dispatchId: lifecycleDispatchId,
                                answerVerification: message?.meta?.answerVerification || null
                            })
                            : { valid: false, rejectReason: lifecycleAnswerText ? 'validator_unavailable' : 'empty' };
                        if (lifecycleValidation.valid) {
                            const receivedProof = self.AnswerProofNormalization?.evidence?.(lifecycleAnswerText, {
                                dispatchId: lifecycleDispatchId,
                                attemptId: lifecycleProofIdentity.attemptId
                            }) || null;
                            entry.lifecycleAnswerCandidate = {
                                text: lifecycleAnswerText,
                                length: lifecycleAnswerText.length,
                                hash: receivedProof?.normalizedHash || lifecycleValidation.hash || message?.meta?.answerHash || null,
                                source: 'lifecycle_complete_snapshot',
                                dispatchId: lifecycleDispatchId,
                                capturedAt: Number(message?.meta?.completedAt || Date.now())
                            };
                            entry.pendingFinalAnswer = lifecycleAnswerText;
                            emitTelemetry(message.llmName, 'ANSWER_SOURCE_MATERIALIZED', {
                                level: 'success',
                                details: 'direct_preterminal',
                                meta: {
                                    ...lifecycleProofIdentity,
                                    sourceProofLevel: 'direct_preterminal',
                                    payloadEvidenceId: receivedProof?.payloadEvidenceId || message?.meta?.payloadEvidenceId || null,
                                    normalizedLength: receivedProof?.normalizedLength ?? lifecycleAnswerText.length,
                                    normalizedHash: receivedProof?.normalizedHash || message?.meta?.normalizedHash || null,
                                    normalizationVersion: receivedProof?.normalizationVersion || message?.meta?.normalizationVersion || null
                                },
                                force: true
                            });
                            emitTelemetry(message.llmName, 'ANSWER_DELIVERY_ACKNOWLEDGED', {
                                level: 'success',
                                details: 'accepted',
                                meta: {
                                    ...lifecycleProofIdentity,
                                    outcome: 'accepted',
                                    payloadEvidenceId: receivedProof?.payloadEvidenceId || message?.meta?.payloadEvidenceId || null,
                                    normalizedLength: receivedProof?.normalizedLength ?? lifecycleAnswerText.length,
                                    normalizedHash: receivedProof?.normalizedHash || message?.meta?.normalizedHash || null,
                                    normalizationVersion: receivedProof?.normalizationVersion || message?.meta?.normalizationVersion || null
                                },
                                force: true
                            });
                            emitTelemetry(message.llmName, 'ANSWER_EXTRACTION_COMPLETED', {
                                level: 'success',
                                details: `len=${lifecycleAnswerText.length}`,
                                meta: {
                                    ...lifecycleProofIdentity,
                                    candidateId: message?.meta?.candidateId || message?.meta?.answerVerification?.candidateId || null,
                                    accepted: true,
                                    answerIdentity: 'current_dispatch',
                                    extractedTextLength: receivedProof?.normalizedLength ?? lifecycleAnswerText.length,
                                    normalizedLength: receivedProof?.normalizedLength ?? lifecycleAnswerText.length,
                                    normalizedHash: receivedProof?.normalizedHash || message?.meta?.normalizedHash || null,
                                    normalizationVersion: receivedProof?.normalizationVersion || message?.meta?.normalizationVersion || null,
                                    payloadEvidenceId: receivedProof?.payloadEvidenceId || message?.meta?.payloadEvidenceId || null,
                                    extractionMode: 'lifecycle_complete_snapshot'
                                },
                                force: true
                            });
                            emitTelemetry(message.llmName, 'LIFECYCLE_SNAPSHOT_ACCEPTED', {
                                level: 'success',
                                details: `len=${lifecycleAnswerText.length}`,
                                meta: {
                                    ...lifecycleProofIdentity,
                                    answerLength: lifecycleAnswerText.length,
                                    answerHash: entry.lifecycleAnswerCandidate.hash,
                                    answerMethod: message?.meta?.answerMethod || null,
                                    responsePhase: message?.meta?.responsePhase || null,
                                    phaseEvidence: message?.meta?.phaseEvidence || null,
                                    completionSignals: message?.meta?.completionSignals || null,
                                    checkedAtLocalMonoMs: message?.meta?.checkedAtLocalMonoMs || null,
                                    contentScriptAvailable: true
                                },
                                force: true
                            });
                        } else if (lifecycleAnswerText) {
                            emitTelemetry(message.llmName, 'LIFECYCLE_SNAPSHOT_REJECTED', {
                                level: 'warning',
                                details: lifecycleValidation.rejectReason || 'invalid_candidate',
                                meta: {
                                    dispatchId: lifecycleDispatchId,
                                    answerLength: lifecycleAnswerText.length,
                                    answerHash: lifecycleValidation.hash || message?.meta?.answerHash || null
                                },
                                force: true
                            });
                        }
                        entry.earlyTerminalGuard = null;
                        entry.earlyTerminalGuardNextPingAt = 0;
                        if (self.PipelineFSM?.markAwaitingFinal) {
                            const currentControl = jobState?.session?.pipelineControl || self.PipelineFSM.normalizeControlState?.({
                                pipelineRunId: jobState?.session?.pipelineRunId || null,
                                sessionId: jobState?.session?.startTime || null,
                                state: jobState?.session?.pipelineState || 'IDLE',
                                stage: jobState?.session?.pipelineStage || null,
                                round: jobState?.session?.pipelineRoundId || null
                            });
                            const nextControl = self.PipelineFSM.markAwaitingFinal(currentControl, {
                                llmName: message.llmName,
                                dispatchId: entry?.lastDispatchMeta?.dispatchId || null,
                                tabId: entry?.tabId || null,
                                pipelineRunId: jobState?.session?.pipelineRunId || null,
                                stage: 'awaiting_final',
                                reason: 'response_ready'
                            });
                            if (nextControl) {
                                jobState.session = jobState.session || {};
                                jobState.session.pipelineControl = nextControl;
                                jobState.session.pipelineRunId = nextControl.pipelineRunId || jobState.session.pipelineRunId || null;
                                jobState.session.pipelineState = nextControl.state || jobState.session.pipelineState || 'IDLE';
                                jobState.session.pipelineStage = nextControl.stage || jobState.session.pipelineStage || null;
                                saveJobState(jobState);
                                try { chrome.storage.session.set({ [self.PipelineFSM.STORAGE_KEY]: nextControl }); } catch (_) {}
                            }
                        }
                        if (self.commitModelRunTransition) {
                            self.commitModelRunTransition(message.llmName, entry, 'LIFECYCLE_READY', {
                                status: 'RECEIVING',
                                source: 'message_router_response_ready',
                                dispatchId: entry?.lastDispatchMeta?.dispatchId || null,
                                tabId: entry?.tabId || null,
                                runSessionId: jobState?.session?.startTime || null
                            });
                        } else if (self.ModelRunState?.applyModelRunTransition) {
                            self.ModelRunState.applyModelRunTransition(entry, 'LIFECYCLE_READY', {
                                status: 'RECEIVING',
                                dispatchId: entry?.lastDispatchMeta?.dispatchId || null,
                                tabId: entry?.tabId || null,
                                runSessionId: jobState?.session?.startTime || null
                            });
                        }
                        try { saveJobState(jobState); } catch (_) {}
                        const lifecycleAnswerVerification = message?.meta?.answerVerification || null;
                        if (lifecycleAnswerVerification && typeof self.recordPipelineAnswerVerification === 'function') {
                            self.recordPipelineAnswerVerification(message.llmName, lifecycleAnswerVerification, sender);
                        }
                        if (lifecycleValidation.valid && typeof handleLLMResponse === 'function') {
                            handleLLMResponse(
                                message.llmName,
                                lifecycleAnswerText,
                                null,
                                {
                                    ...(message.meta || {}),
                                    dispatchId: lifecycleDispatchId,
                                    sessionId: jobState?.session?.startTime || undefined,
                                    runSessionId: jobState?.session?.startTime || undefined,
                                    lifecycleCompleteSnapshot: true,
                                    responseMeta: {
                                        source: 'lifecycle_complete_snapshot',
                                        completionReason: 'lifecycle_complete_snapshot',
                                        forceTerminalSuccess: true,
                                        lateCollectFinal: true,
                                        freshTurnEvidence: true,
                                        lifecycleSnapshot: true,
                                        answerVerification: lifecycleAnswerVerification,
                                        completionTerminalResult: message?.meta?.terminalResult || null,
                                        extractionSnapshot: message?.meta?.extractionSnapshot || null
                                    }
                                },
                                message?.meta?.extractionSnapshot?.html || ''
                            );
                        }
                    }
                    const responseReadyEntry = jobState?.llms?.[message.llmName];
                    if (!isTerminalRouterEntry(responseReadyEntry)) {
                        updateModelState?.(message.llmName, 'RECEIVING', {
                            message: 'Answer appears complete; ready for collection',
                            lifecycle: message.meta || {}
                        });
                    }
                }
                sendResponse({ status: 'response_ready_ack' });
                break;

            case 'AUTOMATION_DEADLINE_SIGNAL':
                {
                    const senderGate = validateLifecycleSender(message.llmName, sender, 'AUTOMATION_DEADLINE_SIGNAL');
                    if (!senderGate.ok) {
                        sendResponse({ status: 'automation_deadline_rejected', reason: senderGate.reason });
                        break;
                    }
                    const correlationGate = validateLifecycleCorrelation(message.llmName, message, 'AUTOMATION_DEADLINE_SIGNAL');
                    if (!correlationGate.ok) {
                        sendResponse({ status: 'automation_deadline_rejected', reason: correlationGate.reason });
                        break;
                    }
                    const applied = typeof self.finalizeAutomationDeadline === 'function'
                        ? self.finalizeAutomationDeadline(
                            message.llmName,
                            message.phase || 'generation',
                            null,
                            {
                                source: message?.meta?.source || 'content_lifecycle_timeout',
                                reportedBudgetMs: Number(message.budgetMs || 0),
                                textLength: Number(message?.meta?.textLength || 0),
                                contentLifecycleSignal: true
                            }
                        )
                        : false;
                    sendResponse({
                        status: applied ? 'automation_deadline_applied' : 'automation_deadline_ignored'
                    });
                }
                break;

            case 'STORE_TAB_STATE': {
                const tabId = sender?.tab?.id;
                if (!tabId || !message.state) {
                    sendResponse({ status: 'ignored' });
                    break;
                }
                const key = `state_${tabId}`;
                if (!self.__TAB_STATE_CACHE__) {
                    self.__TAB_STATE_CACHE__ = new Map();
                }
                self.__TAB_STATE_CACHE__.set(tabId, Object.assign({}, message.state, {
                    tabId
                }));
                chrome.storage.local.set({ [key]: message.state }, () => {
                    sendResponse({ status: 'stored', key });
                });
                return true;
            }

            case 'GET_ALL_STATES': {
                chrome.storage.local.get(null, (all) => {
                    const raw = Object.entries(all || {}).filter(([k]) => k.startsWith('state_'));
                    const best = new Map();
                    raw.forEach(([key, value]) => {
                        const sid = value?.sessionId || key.replace('state_', '');
                        const platform = value?.platform || 'unknown';
                        const composite = `${platform}::${sid}`;
                        const existing = best.get(composite);
                        const score = key.includes(`${platform}_`) ? 2 : 1; // prefer platform-specific key
                        const existingScore = existing ? (existing.__score || 0) : 0;
                        if (!existing || score > existingScore || (score === existingScore && (value?.updatedAt || 0) > (existing.updatedAt || 0))) {
                            if (value) {
                                value.__score = score;
                                best.set(composite, value);
                            }
                        }
                    });
                    let states = Array.from(best.values())
                        .map((v) => { const { __score, ...rest } = v || {}; return rest; })
                        .sort((a, b) => (b?.updatedAt || 0) - (a?.updatedAt || 0));
                    const runFilter = message?.runId || message?.sessionId || null;
                    if (runFilter) {
                        states = states.filter((s) => s?.sessionId === runFilter);
                    }
                    sendResponse({ success: true, states });
                });
                return true;
            }

            case 'SUBMIT_PROMPT': {
                (async () => {
                    const runGuard = self.RunGuard?.canStartNewRun?.(jobState?.session);
                    if (runGuard && runGuard.ok === false) {
                        sendResponse({
                            success: false,
                            errorCode: runGuard.errorCode,
                            activeSessionId: runGuard.activeSessionId || null
                        });
                        return;
                    }

                    const commandId = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                    const baseCommand = {
                        id: commandId,
                        action: 'submit_prompt',
                        payload: { prompt: message.prompt, platforms: message.platforms },
                        createdAt: Date.now()
                    };
                    const delivery = await broadcastCommandToLlmTabs(baseCommand);
                    const targetPlatforms = Array.isArray(message.platforms) && message.platforms.length
                        ? message.platforms
                        : Object.keys(LLM_TARGETS || {});
                    const pendingEntries = {};
                    targetPlatforms.forEach((platform) => {
                        const scopedCommand = Object.assign({}, baseCommand, {
                            payload: Object.assign({}, baseCommand.payload, { platforms: [platform] }),
                            targetPlatform: platform
                        });
                        pendingEntries[`pending_command_${platform}`] = scopedCommand;
                    });
                    try {
                        const targetStore = chrome.storage?.session || chrome.storage.local;
                        await targetStore.set(Object.assign({}, pendingEntries, { pending_command: baseCommand }));
                    } catch (_) {
                        await chrome.storage.local.set(Object.assign({}, pendingEntries, { pending_command: baseCommand }));
                    }
                    sendResponse({ success: true, commandId, delivered: delivery.sent, platforms: targetPlatforms });
                })();
                return true;
            }

            case 'STOP_ALL': {
                (async () => {
                    const cmd = { action: 'STOP_ALL', timestamp: Date.now(), platforms: message.platforms };
                    await chrome.storage.local.set({ global_command: cmd });
                    stopAllProcesses('stop_all_command', { closeTabs: false });
                    sendResponse({ success: true });
                })();
                return true;
            }

            case 'COMMAND_ACK': {
                (async () => {
                    try {
                        const { commandId, ack } = message || {};
                        const platformKey = ack?.platform ? `pending_command_${ack.platform}` : null;
                        const stores = [chrome.storage?.session, chrome.storage?.local].filter(Boolean);
                        await Promise.all(stores.map(async (store) => {
                            try {
                                const data = await store.get(null);
                                const keysToRemove = [];
                                if (platformKey) keysToRemove.push(platformKey);
                                // если не осталось других pending_command_ — убираем alias
                                const pendingKeys = Object.keys(data || {}).filter((k) => k.startsWith('pending_command_'));
                                if (pendingKeys.length <= 1) {
                                    keysToRemove.push('pending_command');
                                }
                                if (keysToRemove.length) await store.remove(keysToRemove);
                            } catch (_) {}
                        }));
                        sendResponse({ success: true });
                    } catch (err) {
                        sendResponse({ success: false, error: err?.message || String(err) });
                    }
                })();
                return true;
            }

            case 'SET_SETTINGS': {
                (async () => {
                    try {
                        const next = Object.assign({}, message.settings || {});
                        await chrome.storage.local.set({ settings: next });
                        try {
                            chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', settings: next });
                        } catch (_) {}
                        sendResponse({ success: true, settings: next });
                    } catch (err) {
                        sendResponse({ success: false, error: err?.message || String(err) });
                    }
                })();
                return true;
            }

            case 'GET_SETTINGS': {
                (async () => {
                    try {
                        const res = await chrome.storage.local.get(['settings']);
                        sendResponse({ success: true, settings: res?.settings || {} });
                    } catch (err) {
                        sendResponse({ success: false, error: err?.message || String(err) });
                    }
                })();
                return true;
            }

            case 'DIAG_EVENT': {
                (async () => {
                    try {
                        const sourceEvent = message.event || {};
                        const platform = sourceEvent.platform || message.platform || null;
                        const llmName = typeof resolveLlmName === 'function' ? resolveLlmName(platform) : platform;
                        const currentEntry = llmName ? jobState?.llms?.[llmName] : null;
                        const senderTabId = Number(sender?.tab?.id);
                        const expectedTabId = Number(currentEntry?.tabId || TabMapManager?.get?.(llmName));
                        const senderMatchesCurrentModel = Number.isFinite(senderTabId)
                            && Number.isFinite(expectedTabId)
                            && senderTabId === expectedTabId;
                        const currentRunSessionId = Number(jobState?.session?.startTime);
                        const sourceMeta = sourceEvent.meta && typeof sourceEvent.meta === 'object'
                            ? sourceEvent.meta
                            : {};
                        const canAttachCurrentRun = senderMatchesCurrentModel
                            && Number.isFinite(currentRunSessionId)
                            && currentRunSessionId > 0;
                        const meta = {
                            ...sourceMeta,
                            ...(canAttachCurrentRun && !sourceMeta.runSessionId && !sourceMeta.sessionId ? {
                                runSessionId: currentRunSessionId
                            } : {}),
                            ...(canAttachCurrentRun && !sourceMeta.dispatchId && currentEntry?.lastDispatchMeta?.dispatchId ? {
                                dispatchId: currentEntry.lastDispatchMeta.dispatchId
                            } : {}),
                            ...(llmName && !sourceMeta.llmName ? { llmName } : {})
                        };
                        const evt = Object.assign({}, sourceEvent, {
                            ts: Date.now(),
                            platform,
                            traceId: sourceEvent.traceId || null,
                            sessionId: sourceEvent.sessionId || (canAttachCurrentRun ? currentRunSessionId : null),
                            runSessionId: sourceEvent.runSessionId || (canAttachCurrentRun ? currentRunSessionId : null),
                            source: sourceEvent.source || sender?.url || sender?.tab?.url || null,
                            meta
                        });
                        await self.ProofTelemetryLedger?.record?.(evt, llmName || platform || 'SYSTEM', {
                            runSessionId: meta.runSessionId || currentRunSessionId || null,
                            producerComponent: 'content-script-diagnostic'
                        });
                        const appendEvent = (arr) => {
                            let next = diagTrimDiagnosticsBuffer(
                                [...arr, evt],
                                DIAGNOSTICS_EXPORT_MAX_ITEMS
                            );
                            const stringify = () => JSON.stringify(next);
                            while (stringify().length > DIAGNOSTICS_EXPORT_MAX_BYTES && next.length > 1) {
                                next = diagDropOldestUnpinned(next);
                            }
                            return next;
                        };
                        if (typeof self?.mutateDiagnosticsEventsConsistent === 'function') {
                            await self.mutateDiagnosticsEventsConsistent(appendEvent);
                        } else {
                            await writeDiagnosticsEventsToStorage(
                                appendEvent(await readDiagnosticsEventsFromStorage())
                            );
                        }
                        sendResponse({ success: true });
                    } catch (err) {
                        console.warn('[DIAG_EVENT] store failed', err);
                        sendResponse({ success: false, error: err?.message || String(err) });
                    }
                })();
                return true;
            }

            case 'GET_RUN_OUTCOME_SUMMARY': {
                // Source of truth for exports: jobState survives results-page reloads,
                // unlike page-side llmLogs/bridge caches (defect seen in the 2.74.98
                // smoke run export, which had no terminal evidence at all).
                try {
                    const session = jobState?.session || null;
                    const models = Object.entries(jobState?.llms || {}).map(([llmName, entry]) => ({
                        llmName,
                        finalStatus: entry?.finalStatus || null,
                        terminal: Boolean(entry?.finalStatusRecorded || entry?.finalStatus),
                        status: entry?.status || null,
                        statusReason: entry?.statusReason || null,
                        finalizedAt: entry?.finalizedAt || null,
                        answerLength: Number(entry?.answerLength || String(entry?.answer || '').length || 0),
                        answerSource: entry?.responseMeta?.source || entry?.responseSource || null,
                        dispatchId: entry?.lastDispatchMeta?.dispatchId || null,
                        generationEpoch: entry?.generationEpoch ?? null,
                        turnAnchor: entry?.preDispatchAnswerNodeCount
                            ?? entry?.anchorAnswerCount
                            ?? entry?.baselineAnswerCount
                            ?? null,
                        turnAnchorDispatchId: entry?.preDispatchAnswerNodeCountDispatchId || null,
                        promptSubmittedAt: entry?.promptSubmittedAt || null,
                        submitSource: entry?.submitSource || null,
                        submitConfirmedBy: entry?.submitConfirmedBy || null,
                        lengthPolicyRef: entry?.finalizationEvidence?.lengthPolicy?.policyRef || null,
                        suspectShortSuccess: entry?.finalizationEvidence?.lengthPolicy?.suspectShortSuccess === true
                        , finalizationAccepted: entry?.finalizationEvidence?.accepted ?? null
                        , finalizationContradictions: Array.isArray(entry?.finalizationEvidence?.contradictions)
                            ? entry.finalizationEvidence.contradictions.slice(0, 20)
                            : []
                        , decisionSnapshot: entry?.finalizationEvidence?.decisionSnapshot || null
                        , calibrationEndMarker: entry?.finalizationEvidence?.calibrationEndMarker || null
                        , calibrationEndMarkerPresent: entry?.finalizationEvidence?.calibrationEndMarkerPresent ?? null
                        , answerFreshness: entry?.answerFreshness ? {
                            fresh: entry.answerFreshness.fresh === true,
                            dispatchId: entry.answerFreshness.dispatchId || null,
                            source: entry.answerFreshness.source || null
                        } : null
                        , verificationState: entry?.modelRunState?.verificationState || entry?.answerVerification?.state || null
                        , extractionState: entry?.modelRunState?.extractionState || null
                        , currentStage: Array.isArray(entry?.stageTimeline) && entry.stageTimeline.length
                            ? entry.stageTimeline[entry.stageTimeline.length - 1].stage : null
                        , pendingReason: !(entry?.finalStatusRecorded || entry?.finalStatus)
                            ? (entry?.statusReason || entry?.status || 'not_terminal')
                            : (entry?.modelRunState?.verificationState === 'candidate' ? 'answer_not_verified' : null)
                    }));
                    sendResponse({
                        success: true,
                        runSessionId: session?.startTime || null,
                        complete: models.length > 0 && models.every((m) => m.terminal && m.verificationState !== 'candidate'),
                        models
                    });
                } catch (err) {
                    sendResponse({ success: false, error: err?.message || String(err) });
                }
                return true;
            }

            case 'GET_DIAG_EVENTS': {
                (async () => {
                    try {
                        const { platforms, limit } = message || {};
                        // A diagnostics export is a snapshot, not a persistence
                        // barrier. Do not wait for the serialized write queue: return
                        // the latest committed storage value while pending telemetry
                        // keeps flushing in the background.
                        let arr = typeof self?.readDiagnosticsEventsSnapshot === 'function'
                            ? await self.readDiagnosticsEventsSnapshot()
                            : await readDiagnosticsEventsFromStorage();
                        if (Array.isArray(platforms) && platforms.length) {
                            const set = new Set(platforms.map((p) => String(p).toLowerCase()));
                            arr = arr.filter((e) => set.has(String(e?.platform || 'unknown').toLowerCase()));
                        }
                        // The persisted diagnostics buffer is cleared when a new
                        // run starts, not when a page reloads. Reloading the
                        // results page without starting a run therefore re-hydrated
                        // the previous session, and the page's own
                        // "current run" resolver — which reads the newest event it
                        // was given — then presented that stale run as the active
                        // one. Scope to the ledger's current run session here so a
                        // reload cannot resurrect an earlier session. Events that
                        // carry no run identity (setup/system lines) are kept.
                        const activeRunSessionId = message?.allRunSessions === true
                            ? null
                            : (self.ProofTelemetryLedger?.currentRunSessionId?.() ?? null);
                        if (activeRunSessionId !== null && activeRunSessionId !== undefined) {
                            arr = arr.filter((entry) => {
                                const entryRunSessionId = entry?.meta?.runSessionId
                                    ?? entry?.meta?.sessionId
                                    ?? entry?.runSessionId
                                    ?? entry?.sessionId
                                    ?? null;
                                if (entryRunSessionId === null || entryRunSessionId === undefined) return true;
                                return String(entryRunSessionId) === String(activeRunSessionId);
                            });
                        }
                        const capSize = (limit && Number.isFinite(limit))
                            ? limit
                            : DIAGNOSTICS_EXPORT_MAX_ITEMS;
                        const capped = diagTrimDiagnosticsBuffer(arr, capSize);
                        sendResponse({ success: true, events: capped });
                    } catch (err) {
                        sendResponse({ success: false, error: err?.message || String(err) });
                    }
                })();
                return true;
            }

            case 'GET_PROOF_TELEMETRY_INCIDENTS': {
                (async () => {
                    try {
                        const incidents = await self.ProofTelemetryStore?.listIncidents?.({
                            runGeneration: message?.runGeneration ?? null,
                            modelId: message?.modelId || null
                        }) || [];
                        sendResponse({ success: true, incidents });
                    } catch (err) {
                        sendResponse({ success: false, error: err?.message || String(err) });
                    }
                })();
                return true;
            }

            case 'CLEAR_DIAG_EVENTS': {
                (async () => {
                    try {
                        await writeDiagnosticsEventsToStorage([]);
                        await self.ProofTelemetryLedger?.clear?.(null);
                        const runtimeCleared = clearDiagnosticsRuntimeLogs();
                        sendResponse({ success: true, runtimeCleared });
                    } catch (err) {
                        sendResponse({ success: false, error: err?.message || String(err) });
                    }
                })();
                return true;
            }

            case 'SMOKE_CHECK': {
                (async () => {
                    try {
                        const platform = message?.platform;
                        const tabId = message?.tabId;
                        const targetTabId = tabId || (await new Promise((resolve) => {
                            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs?.[0]?.id));
                        }));
                        if (!targetTabId) {
                            sendResponse({ success: false, error: 'no_tab' });
                            return;
                        }
                        const resp = await new Promise((resolve) => {
                            let settled = false;
                            let timer = null;
                            timer = routerRegisterSessionTimer(setTimeout(() => {
                                if (settled) return;
                                settled = true;
                                resolve({ success: false, error: 'timeout' });
                                routerDeregisterSessionTimer(timer);
                            }, 5000));
                            try {
                                chrome.tabs.sendMessage(targetTabId, { type: 'SMOKE_CHECK', platform }, (r) => {
                                    if (settled) return;
                                    settled = true;
                                    if (timer) {
                                        clearTimeout(timer);
                                        routerDeregisterSessionTimer(timer);
                                    }
                                    resolve(r || { success: false, error: chrome.runtime.lastError?.message || 'no_response' });
                                });
                            } catch (err) {
                                if (settled) return;
                                settled = true;
                                clearTimeout(timer);
                                resolve({ success: false, error: err?.message || 'send_error' });
                            }
                        });
                        try {
                            const event = {
                                type: 'smoke_check',
                                platform: platform || null,
                                ts: Date.now(),
                                status: resp?.success ? 'ok' : 'fail',
                                details: resp?.error || `${(resp?.report || []).length || 0} selectors checked`,
                                report: resp?.report || null
                            };
                            const res = await chrome.storage.local.get(['__diagnostics_events__']);
                            const arr = Array.isArray(res?.__diagnostics_events__) ? res.__diagnostics_events__ : [];
                            const next = [...arr, event].slice(-200);
                            await chrome.storage.local.set({ '__diagnostics_events__': next });
                        } catch (_) {}
                        sendResponse(resp || { success: false, error: 'unknown' });
                    } catch (err) {
                        sendResponse({ success: false, error: err?.message || String(err) });
                    }
                })();
                return true;
            }

            case 'GET_COMMAND_STATUS': {
                (async () => {
                    try {
                        const sessionAll = (chrome.storage?.session && await chrome.storage.session.get(null)) || {};
                        const localAll = await chrome.storage.local.get(null);
                        const merged = Object.assign({}, localAll || {}, sessionAll || {});
                        const pendingList = Object.entries(merged)
                            .filter(([k]) => k.startsWith('pending_command_'))
                            .map(([, v]) => v)
                            .filter(Boolean)
                            .sort((a, b) => (b?.createdAt || 0) - (a?.createdAt || 0));
                        const pending = pendingList[0] || merged?.pending_command || null;
                        const platforms = Array.isArray(message.platforms) ? message.platforms : null;
                        const acks = Object.entries(merged || {})
                            .filter(([k]) => k.startsWith('cmd_ack_'))
                            .map(([, v]) => v)
                            .filter((v) => {
                                if (!platforms) return true;
                                return platforms.includes(v?.platform);
                            })
                            .sort((a, b) => (b?.executedAt || 0) - (a?.executedAt || 0))
                            .slice(0, 20);
                        const filteredPending = (!platforms || (pending && platforms.includes(pending?.payload?.platform))) ? pending : null;
                        sendResponse({ success: true, pending: filteredPending, acks });
                    } catch (err) {
                        sendResponse({ success: false, error: err?.message || String(err) });
                    }
                })();
                return true;
            }

            case 'EVALUATOR_RESPONSE':
                handleEvaluatorResponse(message.answer);
                sendResponse({ status: 'evaluator_response_handled' });
                break;
                
            case 'REGISTER_RESULTS_TAB':
                resultsTabId = sender.tab.id;
                globalThis.LLMLog?.debug?.("[BACKGROUND] Registered results tab:", resultsTabId);
                const runtimeReset = Number(self.__extensionRuntimeResetAt || 0) > 0
                    && Date.now() - Number(self.__extensionRuntimeResetAt) < 30000;
                sendResponse({
                    status: 'registered',
                    state: buildGlobalStateSnapshot({ includeAnswers: true }),
                    runtimeReset
                });
                break;
            
            case 'REQUEST_SELECTOR_VERSION_STATUS': {
                (async () => {
                    let snapshot = null;
                    if (message.forceRefresh) {
                        snapshot = await updateVersionStatusSnapshot();
                    }
                    if (!snapshot) {
                        snapshot = await getStoredVersionStatus();
                    }
                    sendResponse({ status: 'ok', snapshot });
                })();
                return true;
            }

            case 'REQUEST_SELECTOR_HEALTH_SUMMARY': {
                (async () => {
                    try {
                        const summary = await buildSelectorHealthSummary({
                            includeActiveVersions: !!message.includeActiveVersions
                        });
                        sendResponse({ status: 'ok', summary });
                    } catch (err) {
                        sendResponse({ status: 'error', error: err?.message || 'health_summary_failed' });
                    }
                })();
                return true;
            }
            
            case 'REQUEST_SELECTOR_TELEMETRY':
                sendResponse({ status: 'ok', metrics: Object.fromEntries(selectorResolutionMetrics.entries()) });
                break;
            
            case 'REQUEST_SELECTOR_MODELS': {
                const models = Object.keys(self.SelectorConfig?.models || {});
                sendResponse({ status: 'ok', models });
                break;
            }

            case 'REQUEST_SELECTOR_DEFINITIONS': {
                const modelName = message.modelName;
                const cfg = self.SelectorConfig;
                if (!modelName || !cfg?.getModelConfig) {
                    sendResponse({ status: 'error', error: 'Unknown model' });
                    break;
                }
                const modelConfig = cfg.getModelConfig(modelName);
                if (!modelConfig) {
                    sendResponse({ status: 'error', error: 'Unknown model' });
                    break;
                }
                const versions = (modelConfig.versions || []).map((version) => {
                    const selectors = {};
                    SELECTOR_ELEMENT_TYPES.forEach((elementType) => {
                        selectors[elementType] = cfg.getSelectorsFor(modelName, version.version, elementType) || [];
                    });
                    return {
                        version: version.version,
                        uiRevision: version.uiRevision || '',
                        description: version.description || '',
                        selectors
                    };
                });
                sendResponse({ status: 'ok', modelName, versions });
                break;
            }

            case 'REQUEST_SELECTOR_ACTIVE_VERSION': {
                (async () => {
                    const modelName = message.modelName;
                    if (!modelName) {
                        sendResponse({ status: 'error', error: 'Missing model' });
                        return;
                    }
                    const tabId = await resolveTabForLlmNameAsync(modelName);
                    if (!tabId) {
                        sendResponse({ status: 'no_tab' });
                        return;
                    }
                    try {
                        const [result] = await chrome.scripting.executeScript({
                            target: { tabId },
                            func: (model, elementTypes) => {
                                if (!window.SelectorConfig || typeof window.SelectorConfig.detectUIVersion !== 'function') {
                                    return { ok: false, error: 'SelectorConfig unavailable' };
                                }
                                const version = window.SelectorConfig.detectUIVersion(model, document) || 'unknown';
                                const selectors = {};
                                elementTypes.forEach((elementType) => {
                                    selectors[elementType] = window.SelectorConfig.getSelectorsFor(model, version, elementType) || [];
                                });
                                return { ok: true, version, selectors };
                            },
                            args: [modelName, SELECTOR_ELEMENT_TYPES]
                        });
                        if (result?.result?.ok) {
                            sendResponse({ status: 'ok', tabId, version: result.result.version, selectors: result.result.selectors });
                        } else {
                            sendResponse({ status: 'error', error: result?.result?.error || 'active_version_failed' });
                        }
                    } catch (err) {
                        sendResponse({ status: 'error', error: err?.message || 'active_version_failed' });
                    }
                })();
                return true;
            }

            case 'VALIDATE_SELECTORS': {
                (async () => {
                    const modelName = message.modelName;
                    const selectors = Array.isArray(message.selectors) ? message.selectors : [];
                    if (!modelName || !selectors.length) {
                        sendResponse({ status: 'error', error: 'Missing selectors' });
                        return;
                    }
                    const tabId = await resolveTabForLlmNameAsync(modelName);
                    if (!tabId) {
                        sendResponse({ status: 'no_tab' });
                        return;
                    }
                    const result = await validateSelectorsOnTab(tabId, selectors);
                    if (result?.ok) {
                        sendResponse({ status: 'ok', results: result.results || [], tabId });
                    } else {
                        sendResponse({ status: 'error', error: result?.error || 'validation_failed' });
                    }
                })();
                return true;
            }

            case 'REQUEST_SELECTOR_OVERRIDE_AUDIT': {
                (async () => {
                    try {
                        const limit = Number.isFinite(message.limit) ? message.limit : SELECTOR_OVERRIDE_AUDIT_LIMIT;
                        const entries = await readSelectorOverrideAudit(limit);
                        sendResponse({ status: 'ok', entries });
                    } catch (err) {
                        sendResponse({ status: 'error', error: err?.message || 'audit_failed' });
                    }
                })();
                return true;
            }
            
            case 'SAVE_SELECTOR_OVERRIDE': {
                (async () => {
                    try {
                        const overrides = await saveManualSelectorOverride(message.modelName, message.elementType, message.selector);
                        await appendSelectorOverrideAudit({
                            modelName: message.modelName,
                            elementType: message.elementType,
                            selector: message.selector,
                            reason: message.reason || '',
                            source: 'devtools'
                        });
                        sendResponse({ status: 'ok', overrides: overrides[message.modelName] || {} });
                    } catch (err) {
                        sendResponse({ status: 'error', error: err?.message || 'Failed to save override' });
                    }
                })();
                return true;
            }

            case 'PICK_SELECTOR_START': {
                (async () => {
                    const { modelName, elementType, mode } = message;
                    if (!modelName) {
                        sendResponse({ status: 'error', error: 'Missing model' });
                        return;
                    }
                    const tabId = await resolveTabForLlmNameAsync(modelName);
                    if (!tabId) {
                        sendResponse({ status: 'error', error: 'Model tab not active' });
                        return;
                    }
                    const requestId = `pick-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
                    pickerRequests.set(requestId, { modelName, elementType, startedAt: Date.now() });
                    chrome.tabs.sendMessage(
                        tabId,
                        { type: 'PICKER_START', mode: mode || 'selector', requestId, elementType },
                        (response) => {
                            if (chrome.runtime.lastError) {
                                pickerRequests.delete(requestId);
                                sendResponse({ status: 'error', error: chrome.runtime.lastError.message });
                                return;
                            }
                            if (response && response.ok === false) {
                                pickerRequests.delete(requestId);
                                sendResponse({ status: 'error', error: response.error || 'Picker unavailable' });
                                return;
                            }
                            sendResponse({ status: 'ok', requestId });
                        }
                    );
                })();
                return true;
            }

            case 'PICKER_CANCEL': {
                (async () => {
                    const requestId = message.requestId || null;
                    const requestMeta = requestId ? pickerRequests.get(requestId) : null;
                    const modelName = message.modelName || requestMeta?.modelName || null;
                    if (requestId) pickerRequests.delete(requestId);
                    const tabId = modelName ? await resolveTabForLlmNameAsync(modelName) : null;
                    if (!tabId) {
                        sendResponse({ status: 'error', error: 'Model tab not active' });
                        return;
                    }
                    chrome.tabs.sendMessage(tabId, { type: 'PICKER_CANCEL', requestId }, () => {
                        if (chrome.runtime.lastError) {
                            sendResponse({ status: 'error', error: chrome.runtime.lastError.message });
                            return;
                        }
                        sendResponse({ status: 'ok' });
                    });
                })();
                return true;
            }

            case 'HIGHLIGHT_SELECTOR': {
                const { modelName, selector } = message;
                (async () => {
                    const tabId = await resolveTabForLlmNameAsync(modelName);
                    if (!tabId) {
                        sendResponse({ status: 'error', error: 'Model tab not active' });
                        return;
                    }
                    chrome.scripting.executeScript({
                        target: { tabId },
                        func: (cssSelector) => {
                            if (!window.SelectorFinder || typeof window.SelectorFinder.previewSelector !== 'function') {
                                return { ok: false, error: 'Preview unavailable' };
                            }
                            const success = window.SelectorFinder.previewSelector(cssSelector);
                            return { ok: success };
                        },
                        args: [selector]
                    }).then(([result]) => {
                        if (result?.result?.ok) {
                            sendResponse({ status: 'ok' });
                        } else {
                            sendResponse({ status: 'error', error: result?.result?.error || 'No response' });
                        }
                    }).catch((err) => {
                        sendResponse({ status: 'error', error: err?.message || 'Highlight failed' });
                    });
                })();
                return true;
            }

            case 'PICKER_RESULT': {
                const requestId = message.requestId || null;
                const requestMeta = requestId ? pickerRequests.get(requestId) : null;
                if (requestId) pickerRequests.delete(requestId);
                sendMessageToResultsTab({
                    type: 'PICKER_RESULT',
                    requestId,
                    payload: message.payload || null,
                    modelName: requestMeta?.modelName || null,
                    elementType: requestMeta?.elementType || null
                });
                sendResponse({ status: 'ok' });
                break;
            }

            case 'PICKER_CANCELLED': {
                const requestId = message.requestId || null;
                if (requestId) pickerRequests.delete(requestId);
                sendMessageToResultsTab({
                    type: 'PICKER_CANCELLED',
                    requestId,
                    reason: message.reason || null
                });
                sendResponse({ status: 'ok' });
                break;
            }

        case 'HUMAN_VISIT_CONTROL':
            handleHumanVisitControl(message.action);
            sendResponse({ status: 'ok' });
            break;

        case 'HUMAN_VISIT_MODEL_TOGGLE':
            handleHumanVisitModelToggle(message.llmName, message.enabled);
            sendResponse({ status: 'ok' });
            break;

        case 'REQUEST_HUMAN_VISIT_STATUS':
            sendResponse({ status: 'ok', payload: {
                active: humanPresenceActive,
                paused: humanPresencePaused,
                stopped: humanPresenceManuallyStopped,
                pending: hasPendingHumanVisits(),
                llms: jobState?.llms
                    ? Object.entries(jobState.llms).map(([name, entry]) => ({
                        name,
                        status: entry?.status || 'IDLE',
                        visits: entry?.humanVisits || 0,
                        stalled: !!entry?.humanStalled,
                        skipped: !!entry?.skipHumanLoop
                    }))
                    : []
            }});
            break;

            case 'CLEAR_SELECTOR_CACHE': {
                (async () => {
                    try {
                        const removed = await clearSelectorCache();
                        sendResponse({ status: 'ok', removed });
                    } catch (err) {
                        sendResponse({ status: 'error', error: err?.message || 'Failed to clear cache' });
                    }
                })();
                return true;
            }

            case 'RUN_SELECTOR_HEALTHCHECK': {
                (async () => {
                    const pairs = TabMapManager.entries();
                    if (!pairs.length) {
                        sendResponse({ status: 'error', error: 'No active LLM tabs available for check' });
                        return;
                    }
                    const results = await Promise.all(pairs.map(([llmName, tabId]) => runSelectorHealthCheckForTab(llmName, tabId)));
                    await Promise.all(results.map((entry) => {
                        if (entry?.ok && Array.isArray(entry.report)) {
                            return updateSelectorHealthChecks(entry.llmName, entry.report);
                        }
                        return Promise.resolve();
                    }));
                    results.forEach((entry) => {
                        appendLogEntry(entry.llmName, {
                            type: 'SELECTOR_HEALTH',
                            label: entry.ok ? 'Health-check success' : 'Health-check failed',
                            details: entry.ok ? '' : entry.error,
                            level: entry.ok ? 'info' : 'warning'
                        });
                    });
                    sendResponse({ status: 'ok', results });
                })();
                return true;
            }

            case 'HEALTH_CHECK_PONG':
                if (pendingPings.has(message.pingId)) {
                    const meta = pendingPings.get(message.pingId);
                    globalThis.LLMLog?.debug?.(`[HEALTH-CHECK] PONG received from ${meta.llmName}`);
                    pendingPings.delete(message.pingId);
                    if (meta?.tabId && pendingPingByTabId.get(meta.tabId) === message.pingId) {
                        pendingPingByTabId.delete(meta.tabId);
                        healthCheckFailuresByTabId.delete(meta.tabId);
                        lastHealthCheckReportAtByTabId.delete(meta.tabId);
                    }
                }
                sendResponse({ status: 'pong_received' });
                break;

            case 'CLOSE_ALL_SESSIONS':
                closeAllSessions();
                sendResponse({ status: 'sessions_closed' });
                break;
                
            //-- 4.5. Ручная команда cleanup из UI --//
        case 'CLEAR_ALL_SESSIONS':
            TabMapManager.entries().forEach(([llmName, tabId]) => {
                chrome.tabs.sendMessage(tabId, { type: 'STOP_AND_CLEANUP' }).catch(() => {});
            });
            // Purpose: clear the tab map asynchronously during session shutdown.
            TabMapManager.clear().catch((err) => {
                console.warn('[BACKGROUND] TabMapManager.clear failed:', err);
            });
            jobState = {};
            clearAllDeferredAnswerTimers();
            stopHumanPresenceLoop();
            finalizeTabVisit('session_cleared');
            humanPresencePaused = false;
            humanPresenceManuallyStopped = false;
            Object.keys(llmActivityMap).forEach((tabId) => delete llmActivityMap[tabId]);
            clearActiveListeners();
            if (typeof CompressedStorage !== 'undefined' && CompressedStorage?.remove) {
                CompressedStorage.remove('jobState').catch((err) => {
                    console.warn('[BACKGROUND] CompressedStorage.remove(jobState) failed:', err);
                });
            } else {
                chrome.storage.local.remove(['jobState'], () => chrome.runtime.lastError);
            }
            broadcastGlobalState();
            sendResponse({ status: 'all_sessions_cleared' });
            break;

            case 'GET_IT_BATCH': {
                collectGetItBatch(message.llmNames, {
                    failedOnly: message.failedOnly === true,
                    returnToTabId: isAppUiTab(sender?.tab) ? sender.tab.id : null
                }).then(sendResponse, err => {
                    sendResponse({ status: 'get_it_failed', error: err?.message || String(err) });
                });
                return true;
            }

            case 'MANUAL_RESPONSE_PING': {
                (async () => {
                    try {
                        const result = await handleManualResponsePing(message.llmName, {
                            advanceStrategy: message.advanceStrategy === true || message.advanceSelector === true,
                            manualLatestRecovery: message.manualLatestRecovery === true,
                            manualRecovery: message.manualRecovery !== false,
                            reason: message.reason || 'manual_button'
                        });
                        sendResponse(result);
                    } catch (err) {
                        console.error('[BACKGROUND] Manual ping handler failed', err);
                        sendResponse({ status: 'manual_ping_failed', error: err?.message || 'Ping error' });
                    }
                })();
                return true;
            }

            case 'REQUEST_LLM_RESPONSE': {
                const llmName = message.llmName;
                const entry = llmName ? jobState?.llms?.[llmName] : null;
                const hasCachedAnswer = Boolean(entry && entry.answer);
                const isTerminal = isTerminalRouterEntry(entry);
                const shouldAdvanceStrategy = message.advanceStrategy === true;
                const manualLatestRecovery = message.manualLatestRecovery === true;
                if (entry && entry.answer && !manualLatestRecovery) {
                    sendMessageToResultsTab({
                        type: 'LLM_PARTIAL_RESPONSE',
                        llmName,
                        answer: entry.answer,
                        answerHtml: entry.answerHtml || '',
                        requestId: entry.requestId || null,
                        metadata: { status: entry.status || 'UNKNOWN' },
                        logs: getLogSnapshot(llmName)
                    });
                }
                if (isTerminal && hasCachedAnswer && !shouldAdvanceStrategy && !manualLatestRecovery) {
                    sendResponse({ status: 'cached_response_sent' });
                    break;
                }
                (async () => {
                    try {
                        const result = await handleManualResponsePing(llmName, {
                            advanceStrategy: shouldAdvanceStrategy,
                            getIt: message.getIt === true,
                            returnToTabId: message.reason === 'status_indicator_dblclick' && isAppUiTab(sender?.tab)
                                ? sender.tab.id : null,
                            manualLatestRecovery,
                            manualRecovery: message.manualRecovery !== false,
                            reason: message.reason || 'request_llm_response'
                        });
                        sendResponse(result);
                    } catch (err) {
                        console.error('[BACKGROUND] Manual ping handler failed', err);
                        sendResponse({ status: 'manual_ping_failed', error: err?.message || 'Ping error' });
                    }
                })();
                return true;
            }

            case 'LLM_DIAGNOSTIC_EVENT': {
                const event = message.event || {};
                const resolvedName = resolveEventLlmName(message, event, sender);
                if (!resolvedName) {
                    sendResponse({ status: 'diagnostic_missing_llm' });
                    break;
                }
                if (isTelemetryEntry(event)) {
                    const saved = dispatchTelemetry(resolvedName, event, { sender, source: event?.source });
                    sendResponse({ status: 'diagnostic_logged', stored: !!saved, sampled: !!saved });
                    break;
                }
                const saved = broadcastDiagnostic(resolvedName, event);
                if (saved) {
                    updateTypingStateFromDiagnostic(resolvedName, saved);
                }
                (async () => {
                    try {
                        const persisted = saved
                            ? await persistDiagnosticEvent(resolvedName, saved, { sender, source: event?.source })
                            : null;
                        sendResponse({ status: 'diagnostic_logged', stored: !!persisted });
                    } catch (err) {
                        console.warn('[LLM_DIAGNOSTIC_EVENT] store failed', err);
                        sendResponse({ status: 'diagnostic_logged', stored: false, error: err?.message || String(err) });
                    }
                })();
                return true;
            }

            case 'PIPELINE_EVENT': {
                const event = message.event || {};
                const resolvedName = resolveEventLlmName(message, event, sender);
                const payload = {
                    ...event,
                    type: event.type || 'PIPELINE',
                    label: event.label || event.event || event?.meta?.event || 'PIPELINE'
                };
                const force = ['PIPELINE_COMPLETE', 'FINALIZATION_DONE', 'STREAMING_DONE'].includes(payload.label);
                if (payload.label === 'ANSWER_VERIFICATION_RESULT' && resolvedName && typeof self.recordPipelineAnswerVerification === 'function') {
                    self.recordPipelineAnswerVerification(resolvedName, payload.meta || {}, sender);
                }
                const saved = dispatchTelemetry(resolvedName, payload, { sender, source: event?.source, force });
                sendResponse({ status: 'pipeline_logged', stored: !!saved, sampled: !!saved });
                break;
            }

            case 'TELEMETRY_EVENT': {
                const event = message.event || {};
                const resolvedName = resolveEventLlmName(message, event, sender);
                const label = event.phase || event.event || 'TELEMETRY_EVENT';
                const payload = {
                    type: 'TELEMETRY',
                    label,
                    details: event.reason || event.message || '',
                    level: event.level || 'info',
                    meta: { ...event, event: label }
                };
                const saved = dispatchTelemetry(resolvedName, payload, { sender, source: event?.source });
                sendResponse({ status: 'telemetry_logged', stored: !!saved, sampled: !!saved });
                break;
            }
            case 'REFRESH_SELECTOR_OVERRIDES': {
                if (!remoteSelectorsAllowed) {
                    const result = { success: false, error: 'remote_overrides_disabled' };
                    sendMessageToResultsTab({ type: 'SELECTOR_OVERRIDE_REFRESH_RESULT', result });
                    sendResponse({ status: 'rejected', reason: 'remote_overrides_disabled' });
                    break;
                }
                fetchRemoteSelectors()
                    .then((result) => {
                        sendMessageToResultsTab({ type: 'SELECTOR_OVERRIDE_REFRESH_RESULT', result });
                    })
                    .catch((err) => {
                        sendMessageToResultsTab({
                            type: 'SELECTOR_OVERRIDE_REFRESH_RESULT',
                            result: { success: false, error: err?.message || 'refresh failed' }
                        });
                    });
                sendResponse({ status: 'accepted' });
                break;
            }
            case 'CLEAR_SELECTOR_OVERRIDES_AND_CACHE': {
                clearSelectorOverridesAndCache()
                    .then((result) => {
                        sendMessageToResultsTab({
                            type: 'SELECTOR_OVERRIDE_CLEARED',
                            success: true,
                            removed: result.removed || []
                        });
                    })
                    .catch((err) => {
                        sendMessageToResultsTab({
                            type: 'SELECTOR_OVERRIDE_CLEARED',
                            success: false,
                            error: err?.message || 'cleanup failed'
                        });
                    });
                sendResponse({ status: 'accepted' });
                break;
            }
            case 'MANUAL_RESEND_REQUEST': {
                globalThis.LLMLog?.debug?.('[BACKGROUND] Manual resend handler invoked for', message.llmName);
                Promise.resolve().then(() => {
                    let result;
                    try {
                        result = handleManualResendRequest(message.llmName);
                    } catch (err) {
                        console.error('[BACKGROUND] Manual resend handler crashed:', err);
                        result = {
                            status: 'manual_resend_failed',
                            error: err?.message || 'Unexpected manual resend error'
                        };
                    }
                    globalThis.LLMLog?.debug?.('[BACKGROUND] Manual resend handler replying', result);
                    try {
                        sendResponse(result);
                    } catch (err) {
                        console.error('[BACKGROUND] Failed to send manual resend response:', err);
                    }
                });
                return true;
            }
            case 'MANUAL_PING_RESULT': {
                if (message.llmName && message.status === 'failed') {
                    // A prompt-echo / invalid-candidate / unchanged rejection is the guard
                    // working as intended (it refused a non-answer); the model typically
                    // still finalizes SUCCESS afterwards. Don't inflate the error count for
                    // these — only genuine extraction failures stay at error level.
                    const benignPingFailure = /prompt_echo|invalid_candidate|unchanged|stale/i.test(String(message.error || ''));
                    broadcastDiagnostic(message.llmName, {
                        type: 'PING_ERROR',
                        label: 'Manual ping failed',
                        details: message.error || 'unknown',
                        level: benignPingFailure ? 'warning' : 'error'
                    });
                }
                if (message.llmName) {
                    const status = message.status || 'unknown';
                    const isSuccess = status === 'success';
                    const label = isSuccess ? 'MANUAL_PING_SUCCESS' : 'MANUAL_PING_FAIL';
                    emitTelemetry(message.llmName, label, {
                        level: isSuccess ? 'success' : 'warning',
                        details: status,
                        meta: {
                            status,
                            pingId: message.pingId || null,
                            error: message.error || null
                        }
                    });
                }
                sendMessageToResultsTab(message);
                sendResponse({ status: 'manual_ping_notified' });
                break;
            }
            default:
                sendResponse({ status: 'unknown_message' });
                break;
        }
        return false;
    };

    const runSafely = () => {
        try {
            return processMessage();
        } catch (err) {
            console.error('[BACKGROUND] Failed to process runtime message:', err);
            try {
                sendResponse({ status: 'error', error: err?.message || 'internal_error' });
            } catch (responseErr) {
                console.error('[BACKGROUND] Failed to respond with error:', responseErr);
            }
            return false;
        }
    };

    if (!isInitialStateReady()) {
        ensureInitialState()
            .then(runSafely)
            .catch((err) => {
                console.error('[BACKGROUND] Failed to initialize state before handling message:', err);
                try {
                    sendResponse({ status: 'error', error: err?.message || 'initialization_failed' });
                } catch (responseErr) {
                    console.error('[BACKGROUND] Failed to respond with initialization error:', responseErr);
                }
            });
        return true;
    }

    return runSafely();
});

function removeActiveListenerForTab(tabId) {
    const entry = activeListeners.get(tabId);
    if (!entry) return;
    try {
        chrome.tabs.onUpdated.removeListener(entry.listener);
        globalThis.LLMLog?.debug?.(`[BACKGROUND] Removed listener for tab ${tabId}`);
    } catch (e) {
        console.warn(`[BACKGROUND] Error removing listener for tab ${tabId}:`, e);
    }
    if (entry.timeoutId) {
        clearTimeout(entry.timeoutId);
    }
    activeListeners.delete(tabId);
}

function clearActiveListeners() {
    Array.from(activeListeners.keys()).forEach(removeActiveListenerForTab);
}
