// Prompt attachment state and UI helpers for results pages.
(function installResultsAttachments(root) {
    'use strict';

    if (!root || root.ResultsAttachments) return;

    function create(options = {}) {
        const promptAttachInput = options.promptAttachInput || null;
        const promptAttachBtn = options.promptAttachBtn || null;
        const promptAttachmentBar = options.promptAttachmentBar || null;
        const escapeHtml = typeof options.escapeHtml === 'function' ? options.escapeHtml : (value = '') => String(value);
        const clearNode = typeof options.clearNode === 'function' ? options.clearNode : (node) => node?.replaceChildren?.();
        const replaceChildrenFromHtml = typeof options.replaceChildrenFromHtml === 'function'
            ? options.replaceChildrenFromHtml
            : (node, html) => { if (node) node.innerHTML = String(html || ''); };
        const showNotification = typeof options.showNotification === 'function' ? options.showNotification : () => {};

        const attachedFiles = [];
        const attachmentKeys = new Set();
        const draftKey = options.draftKey || '';
        // IndexedDB keeps File objects intact, without base64 expansion or the
        // chrome.storage quota that is smaller than a valid attachment batch.
        const draftRequest = (mode, files) => new Promise((resolve, reject) => {
            if (!draftKey || !root.indexedDB) { resolve([]); return; }
            const request = root.indexedDB.open('aoPromptAttachments', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('drafts');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const db = request.result;
                const transaction = db.transaction('drafts', mode);
                const store = transaction.objectStore('drafts');
                const operation = mode === 'readonly' ? store.get(draftKey)
                    : (files.length ? store.put(files, draftKey) : store.delete(draftKey));
                transaction.oncomplete = () => { db.close(); resolve(operation.result || []); };
                transaction.onabort = () => { db.close(); reject(transaction.error); };
                transaction.onerror = () => {}; // onabort reports the failure once.
            };
        });
        let draftWrite = Promise.resolve();
        const saveDraft = () => {
            const files = [...attachedFiles];
            draftWrite = draftWrite.catch(() => {}).then(() => draftRequest('readwrite', files));
            return draftWrite;
        };
        const persistDraft = () => saveDraft().catch((err) => {
            console.warn('[results] failed to save attachment draft', err);
        });
        const MAX_ATTACHMENT_BYTES = 30 * 1024 * 1024;
        const MAX_TOTAL_BYTES = 30 * 1024 * 1024;

        const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });

        const extractFilesFromTransfer = (transfer) => {
            if (!transfer) return [];
            const files = Array.from(transfer.files || []);
            if (transfer.items) {
                for (const item of Array.from(transfer.items)) {
                    const kind = item?.kind || '';
                    if (kind !== 'file') continue;
                    const file = item.getAsFile?.();
                    if (file) {
                        files.push(file);
                        continue;
                    }
                    const blob = item.getAsFile?.();
                    if (blob) {
                        const fallbackName = `clipboard.${(blob.type || 'bin').split('/').pop() || 'bin'}`;
                        files.push(new File([blob], fallbackName, { type: blob.type || 'application/octet-stream' }));
                    }
                }
            }
            return files;
        };

        const renderPromptAttachments = () => {
            if (!promptAttachmentBar) return;
            if (!attachedFiles.length) {
                promptAttachmentBar.classList.add('is-empty');
                clearNode(promptAttachmentBar);
                return;
            }
            promptAttachmentBar.classList.remove('is-empty');
            const attachmentMarkup = attachedFiles.map((file) => {
                const name = file.name || '';
                const displayName = name.length > 12 ? `${name.slice(0, 12)}...` : name;
                const key = `${file.name}-${file.size}-${file.type}`;
                return `<span class="attachment-pill" data-attachment-key="${escapeHtml(key)}" title="${escapeHtml(file.name)}"><span class="attachment-icon">📎</span><span class="attachment-label">${escapeHtml(displayName)}</span><button class="attachment-remove" aria-label="Remove attachment" title="Remove attachment">×</button></span>`;
            }).join('');
            replaceChildrenFromHtml(promptAttachmentBar, attachmentMarkup);
        };

        const addPromptAttachments = (files = []) => {
            let added = false;
            files.forEach((file) => {
                if (!file || !file.name) return;
                const key = `${file.name}-${file.size}-${file.type}`;
                if (attachmentKeys.has(key)) return;
                attachmentKeys.add(key);
                attachedFiles.push(file);
                added = true;
            });
            if (added) {
                renderPromptAttachments();
                persistDraft();
            }
        };

        const tryAddTransferAttachments = (transfer) => {
            const files = extractFilesFromTransfer(transfer);
            if (!files.length) return false;
            addPromptAttachments(files);
            return true;
        };

        const findPromptAttachment = (key) => attachedFiles.find((file) => `${file.name}-${file.size}-${file.type}` === key) || null;

        const removePromptAttachment = (key) => {
            const idx = attachedFiles.indexOf(findPromptAttachment(key));
            if (idx < 0) return;
            attachedFiles.splice(idx, 1);
            attachmentKeys.delete(key);
            renderPromptAttachments();
            persistDraft();
        };

        // Сбрасываем все вложения (после отправки запроса), чтобы тот же файл
        // не уехал повторно со следующим запросом в те же открытые вкладки.
        const clearPromptAttachments = () => {
            if (!attachedFiles.length && !attachmentKeys.size) return false;
            attachedFiles.splice(0, attachedFiles.length);
            attachmentKeys.clear();
            try { if (promptAttachInput) promptAttachInput.value = ''; } catch (_) {}
            renderPromptAttachments();
            persistDraft();
            return true;
        };

        const buildAttachmentPayload = async () => {
            const payload = [];
            let total = 0;
            for (const file of attachedFiles) {
                if (!file || !file.name) continue;
                if (file.size > MAX_ATTACHMENT_BYTES) {
                    showNotification(`File ${file.name} is too large (>${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB)`);
                    continue;
                }
                if (total + file.size > MAX_TOTAL_BYTES) {
                    showNotification(`Total attachment size exceeds ${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)}MB`);
                    break;
                }
                try {
                    const dataUrl = await readFileAsDataUrl(file);
                    payload.push({
                        name: file.name,
                        size: file.size,
                        type: file.type || 'application/octet-stream',
                        base64: dataUrl
                    });
                    total += file.size;
                } catch (err) {
                    console.warn('[results] failed to read attachment', file?.name, err);
                }
            }
            return payload;
        };

        promptAttachBtn?.addEventListener('click', () => {
            try {
                promptAttachInput?.click();
            } catch (err) {
                console.warn('[results] prompt attach click failed', err);
            }
        });

        promptAttachInput?.addEventListener('change', (event) => {
            const files = Array.from(event.target.files || []);
            if (!files.length) return;
            addPromptAttachments(files);
            try {
                promptAttachInput.value = '';
            } catch (_) {}
        });

        promptAttachmentBar?.addEventListener('click', (event) => {
            const btn = event.target.closest('.attachment-remove');
            if (!btn) return;
            const pill = btn.closest('.attachment-pill');
            if (!pill) return;
            const key = pill.getAttribute('data-attachment-key');
            if (key) removePromptAttachment(key);
        });

        renderPromptAttachments();

        return {
            saveDraft,
            restoreDraft: async ({ clear = false } = {}) => {
                if (clear) {
                    await draftRequest('readwrite', []);
                    return;
                }
                const files = await draftRequest('readonly');
                addPromptAttachments(Array.isArray(files) ? files : []);
            },
            buildAttachmentPayload,
            tryAddTransferAttachments,
            renderPromptAttachments,
            addPromptAttachments,
            findPromptAttachment,
            removePromptAttachment,
            clearPromptAttachments,
            extractFilesFromTransfer
        };
    }

    root.ResultsAttachments = Object.freeze({ create });
})(typeof window !== 'undefined' ? window : globalThis);
