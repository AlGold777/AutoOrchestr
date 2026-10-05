// Prompt text, folded clipboard fragments and their shared undo/redo history.
(function installResultsPastedText(root) {
    'use strict';
    if (!root || root.ResultsPastedText) return;

    const MIN_CHARACTERS = 3000;
    const MIN_LINES = 40;
    const shouldCollapse = (text) => text.length >= MIN_CHARACTERS || text.split('\n').length >= MIN_LINES;

    function create({ input, bar } = {}) {
        const doc = input?.ownerDocument || root.document;
        const container = input?.closest('.prompt-container');
        let chips = [];
        let sequence = 0;
        let visibleText = input?.value || '';
        let pendingEdit = null;
        let dialog = null;
        let editingId = null;
        let returnFocus = null;
        const undoStack = [];
        const redoStack = [];
        const HISTORY_LIMIT = 100;
        let historyState;
        let editGroup = null;
        let restoringHistory = false;

        const captureState = () => ({
            visibleText, chips: chips.map((chip) => ({ ...chip })),
            start: input?.selectionStart || 0, end: input?.selectionEnd || 0,
            direction: input?.selectionDirection || 'none'
        });
        const sameContent = (a, b) => a.visibleText === b.visibleText
            && a.chips.length === b.chips.length
            && a.chips.every((chip, index) => {
                const other = b.chips[index];
                return chip.id === other.id && chip.offset === other.offset
                    && chip.text === other.text && chip.name === other.name;
            });
        const resetHistory = () => {
            undoStack.length = 0;
            redoStack.length = 0;
            editGroup = null;
            historyState = captureState();
        };
        // Keep the caret before each edit, including programmatic chip changes.
        const captureSelection = () => {
            if (!historyState) return;
            if (historyState.start !== input?.selectionStart || historyState.end !== input?.selectionEnd) editGroup = null;
            historyState.start = input?.selectionStart || 0;
            historyState.end = input?.selectionEnd || 0;
            historyState.direction = input?.selectionDirection || 'none';
        };
        const recordChange = (event) => {
            if (restoringHistory) return;
            const next = captureState();
            if (sameContent(historyState, next)) return;
            const type = event?.inputType;
            const groupable = ['insertText', 'insertCompositionText', 'deleteContentBackward', 'deleteContentForward'].includes(type);
            const now = Date.now();
            if (!groupable || !editGroup || editGroup.type !== type || now - editGroup.at > 1000) {
                undoStack.push(historyState);
                if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
            }
            redoStack.length = 0;
            historyState = next;
            editGroup = groupable ? { type, at: now } : null;
        };
        const travelHistory = (redo = false) => {
            if (!input || input.readOnly || input.disabled) return;
            syncVisibleEdit();
            const from = redo ? redoStack : undoStack;
            const to = redo ? undoStack : redoStack;
            const state = from.pop();
            if (!state) return;
            to.push(captureState());
            closeEditor();
            visibleText = state.visibleText;
            chips = state.chips.map((chip) => ({ ...chip }));
            input.value = visibleText;
            input.setSelectionRange(state.start, state.end, state.direction);
            pendingEdit = null;
            editGroup = null;
            historyState = captureState();
            render();
            restoringHistory = true;
            try { emitChange(); } finally { restoringHistory = false; }
        };

        const orderedChips = () => chips.slice().sort((a, b) => a.offset - b.offset || a.order - b.order);
        const moveAnchors = (start, end, length) => {
            chips.forEach((chip) => {
                if (chip.offset > end) chip.offset += length - (end - start);
                else if (chip.offset > start) chip.offset = start + length;
            });
        };
        const syncVisibleEdit = () => {
            const next = input?.value || '';
            if (next === visibleText) { pendingEdit = null; return; }
            let start = 0;
            let oldEnd = visibleText.length;
            let newEnd = next.length;
            // Use the real selection where possible (repeated text makes a
            // longest-prefix diff ambiguous), with a diff for edits without beforeinput.
            if (pendingEdit && next.startsWith(visibleText.slice(0, pendingEdit.start))
                && next.endsWith(visibleText.slice(pendingEdit.end))) {
                start = pendingEdit.start;
                oldEnd = pendingEdit.end;
                newEnd = next.length - (visibleText.length - oldEnd);
            } else {
                while (start < oldEnd && start < newEnd && visibleText[start] === next[start]) start++;
                while (oldEnd > start && newEnd > start && visibleText[oldEnd - 1] === next[newEnd - 1]) { oldEnd--; newEnd--; }
            }
            moveAnchors(start, oldEnd, newEnd - start);
            visibleText = next;
            pendingEdit = null;
        };
        const getText = () => {
            syncVisibleEdit();
            let cursor = 0;
            let text = '';
            orderedChips().forEach((chip) => {
                text += visibleText.slice(cursor, chip.offset) + chip.text;
                cursor = chip.offset;
            });
            return text + visibleText.slice(cursor);
        };
        const closeEditor = () => {
            if (!dialog?.hasAttribute('open')) return;
            if (typeof dialog.close === 'function') dialog.close();
            else dialog.removeAttribute('open');
            editingId = null;
            if (returnFocus?.isConnected) returnFocus.focus();
            else input?.focus();
        };
        const emitChange = () => {
            pendingEdit = null;
            input?.dispatchEvent(new root.Event('input', { bubbles: true }));
        };
        const render = () => {
            if (!bar) return;
            bar.replaceChildren();
            bar.hidden = !chips.length;
            container?.classList.toggle('has-pasted-text', Boolean(chips.length));
            orderedChips().forEach((chip) => {
                const card = doc.createElement('div');
                card.className = 'pasted-text-chip';
                card.dataset.pastedTextId = chip.id;
                const open = doc.createElement('button');
                open.type = 'button';
                open.className = 'pasted-text-open';
                open.setAttribute('aria-label', `View and edit ${chip.name}`);
                const icon = doc.createElement('span');
                icon.className = 'pasted-text-icon';
                icon.setAttribute('aria-hidden', 'true');
                icon.textContent = '≡';
                const details = doc.createElement('span');
                details.className = 'pasted-text-details';
                const title = doc.createElement('span');
                title.className = 'pasted-text-name';
                title.textContent = chip.name;
                const meta = doc.createElement('span');
                meta.className = 'pasted-text-meta';
                meta.textContent = `${chip.text.length.toLocaleString()} characters · ${chip.text.split('\n').length.toLocaleString()} lines`;
                details.append(title, meta);
                open.append(icon, details);
                open.addEventListener('click', () => openEditor(chip.id, open));
                const restore = doc.createElement('button');
                restore.type = 'button';
                restore.className = 'pasted-text-restore';
                restore.textContent = '↙ Paste original';
                restore.addEventListener('click', () => restoreOriginal(chip.id));
                const remove = doc.createElement('button');
                remove.type = 'button';
                remove.className = 'pasted-text-remove';
                remove.textContent = '×';
                remove.setAttribute('aria-label', `Remove ${chip.name}`);
                remove.title = 'Remove pasted text';
                remove.addEventListener('click', () => {
                    syncVisibleEdit();
                    captureSelection();
                    chips = chips.filter((item) => item.id !== chip.id);
                    if (editingId === chip.id) closeEditor();
                    render();
                    emitChange();
                    input?.focus();
                });
                card.append(open, restore, remove);
                bar.append(card);
            });
        };
        const restoreOriginal = (id) => {
            syncVisibleEdit();
            const ordered = orderedChips();
            const chip = ordered.find((item) => item.id === id);
            if (!chip || !input) return;
            captureSelection();
            const index = ordered.indexOf(chip);
            ordered.forEach((item, itemIndex) => {
                if (item.offset > chip.offset || (item.offset === chip.offset && itemIndex > index)) item.offset += chip.text.length;
            });
            visibleText = visibleText.slice(0, chip.offset) + chip.text + visibleText.slice(chip.offset);
            chips = chips.filter((item) => item !== chip);
            input.value = visibleText;
            closeEditor();
            render();
            input.focus();
            input.setSelectionRange(chip.offset, chip.offset + chip.text.length);
            emitChange();
        };
        const openEditor = (id, trigger) => {
            const chip = chips.find((item) => item.id === id);
            if (!chip) return;
            if (!dialog) {
                dialog = doc.createElement('dialog');
                dialog.className = 'pasted-text-dialog';
                dialog.setAttribute('aria-label', 'View and edit pasted text');
                const heading = doc.createElement('h2');
                heading.className = 'pasted-text-dialog-title';
                const editor = doc.createElement('textarea');
                editor.className = 'pasted-text-editor';
                editor.setAttribute('aria-label', 'Pasted text');
                editor.spellcheck = false;
                const actions = doc.createElement('div');
                actions.className = 'pasted-text-dialog-actions';
                const cancel = doc.createElement('button');
                cancel.type = 'button';
                cancel.textContent = 'Cancel';
                cancel.addEventListener('click', closeEditor);
                const save = doc.createElement('button');
                save.type = 'button';
                save.className = 'pasted-text-save';
                save.textContent = 'Save';
                save.addEventListener('click', () => {
                    syncVisibleEdit();
                    captureSelection();
                    const current = chips.find((item) => item.id === editingId);
                    if (current) {
                        // textarea normalizes CRLF. Viewing and saving an
                        // unchanged fragment must keep its original newlines.
                        if (current.text.replace(/\r\n?/g, '\n') !== editor.value) current.text = editor.value;
                        if (!current.text.length) chips = chips.filter((item) => item !== current);
                    }
                    closeEditor();
                    render();
                    emitChange();
                    input?.focus();
                });
                actions.append(cancel, save);
                dialog.append(heading, editor, actions);
                dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeEditor(); });
                dialog.addEventListener('keydown', (event) => {
                    // Do not let composer shortcuts dispatch a prompt from the editor.
                    event.stopPropagation();
                    if (event.key === 'Escape') { event.preventDefault(); closeEditor(); }
                    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); save.click(); }
                });
                doc.body.append(dialog);
            }
            editingId = id;
            returnFocus = trigger;
            dialog.querySelector('h2').textContent = chip.name;
            const editor = dialog.querySelector('textarea');
            editor.value = chip.text;
            editor.setSelectionRange(0, 0);
            editor.scrollTop = 0;
            if (typeof dialog.showModal === 'function') dialog.showModal();
            else dialog.setAttribute('open', '');
            editor.focus();
        };
        const tryPaste = (text) => {
            if (!input || !bar || input.readOnly || input.disabled || !shouldCollapse(text)) return false;
            syncVisibleEdit();
            captureSelection();
            const start = input.selectionStart;
            const end = input.selectionEnd;
            moveAnchors(start, end, 0);
            const order = ++sequence;
            chips.push({ id: `pasted-text-${order}`, order, offset: start, text, name: `Pasted text ${order}.txt` });
            visibleText = visibleText.slice(0, start) + visibleText.slice(end);
            input.value = visibleText;
            input.setSelectionRange(start, start);
            render();
            emitChange();
            return true;
        };
        const setText = (text) => {
            closeEditor();
            chips = [];
            visibleText = String(text || '');
            pendingEdit = null;
            if (input) input.value = visibleText;
            render();
            resetHistory();
        };
        const getSnapshot = () => {
            syncVisibleEdit();
            return { version: 1, visibleText, chips: orderedChips().map(({ text, offset, name }) => ({ text, offset, name })) };
        };
        const restoreSnapshot = (snapshot, fullText = '') => {
            setText(fullText);
            if (snapshot?.version !== 1 || typeof snapshot.visibleText !== 'string' || !Array.isArray(snapshot.chips)) return;
            if (!snapshot.chips.every((chip) => typeof chip.text === 'string' && Number.isInteger(chip.offset)
                && chip.offset >= 0 && chip.offset <= snapshot.visibleText.length)) return;
            visibleText = snapshot.visibleText;
            if (input) input.value = visibleText;
            chips = snapshot.chips.map((chip) => {
                const order = ++sequence;
                return { ...chip, id: `pasted-text-${order}`, order, name: String(chip.name || `Pasted text ${order}.txt`) };
            });
            // A stale or malformed snapshot must never replace the saved prompt.
            if (getText() !== fullText) { setText(fullText); return; }
            render();
            resetHistory();
        };
        // HTML-to-plain paste inserts programmatically without beforeinput.
        // Capture its selection before the composer paste handler runs.
        input?.addEventListener('paste', () => {
            captureSelection();
            editGroup = null;
            pendingEdit = { start: input.selectionStart, end: input.selectionEnd };
        }, true);
        input?.addEventListener('beforeinput', (event) => {
            if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
                event.preventDefault();
                travelHistory(event.inputType === 'historyRedo');
                return;
            }
            captureSelection();
            const start = input.selectionStart;
            const end = input.selectionEnd;
            // Only ordinary insertion/replacement has a known selection range.
            pendingEdit = event.inputType?.startsWith('insert') ? { start, end } : null;
        });
        input?.addEventListener('input', (event) => {
            syncVisibleEdit();
            recordChange(event);
        });
        input?.addEventListener('keydown', (event) => {
            if (event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)
                || input.readOnly || input.disabled) return;
            // Physical codes also work with a Russian keyboard layout.
            const z = event.code === 'KeyZ' || event.key.toLowerCase() === 'z';
            const y = event.code === 'KeyY' || event.key.toLowerCase() === 'y';
            if (!z && !(y && !event.shiftKey)) return;
            event.preventDefault();
            travelHistory(y || event.shiftKey);
        });
        render();
        resetHistory();
        return { getText, setText, tryPaste, getSnapshot, restoreSnapshot };
    }

    root.ResultsPastedText = Object.freeze({ create, shouldCollapse, MIN_CHARACTERS, MIN_LINES });
})(typeof window !== 'undefined' ? window : globalThis);
