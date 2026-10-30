(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.InputFilesUI = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const mountedWidgets = new WeakMap();
    const mountedByKey = new WeakMap();
    const escapeText = (value) => String(value ?? '');

    function mount({ header, after, container, mountKey = container, files = [], onChange, disabled = false, store, validateBatch = null, notify } = {}) {
        if (!container || !store || typeof store.put !== 'function' || typeof store.get !== 'function' || typeof onChange !== 'function') {
            throw new TypeError('InputFilesUI.mount requires container, store and onChange');
        }
        mountedByKey.get(mountKey)?.();
        const old = container.querySelector('[data-basic-input-files]');
        if (old) (mountedWidgets.get(old) || (() => old.remove()))();

        const root = document.createElement('div');
        root.className = 'basic-input-files';
        root.dataset.basicInputFiles = '';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'basic-input-files-button';
        button.title = 'Входные файлы';
        button.setAttribute('aria-label', 'Входные файлы');
        button.textContent = '📎';
        button.disabled = Boolean(disabled);
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.hidden = true;
        input.disabled = Boolean(disabled);
        input.tabIndex = -1;
        input.setAttribute('aria-label', 'Выбрать входные файлы');
        const list = document.createElement('ul');
        list.className = 'basic-input-files-list';
        list.setAttribute('aria-label', 'Прикреплённые входные файлы');
        const status = document.createElement('span');
        status.className = 'basic-input-files-status';
        status.setAttribute('role', 'status');
        root.append(button, input, list, status);
        if (header) {
            if (after?.parentElement === header) after.insertAdjacentElement('afterend', root);
            else header.append(root);
        } else container.append(root);

        let current = Array.isArray(files) ? files.slice() : [];
        let destroyed = false;
        const report = (message) => {
            status.textContent = message || '';
            if (message && typeof notify === 'function') notify(message, 'error');
        };
        const publish = async (next) => {
            if (button.disabled || input.disabled) return;
            try {
                await onChange(next.slice());
                current = next;
                report('');
                await render();
            } catch (error) {
                report(error?.message || 'Не удалось сохранить входные файлы.');
            }
        };
        const render = async () => {
            if (destroyed) return;
            list.replaceChildren();
            for (const descriptor of current) {
                let missing = false;
                const hasInlineContent = descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'content');
                try { missing = !hasInlineContent && !(await store.get(descriptor)); } catch (_) { missing = !hasInlineContent; }
                if (destroyed) return;
                const item = document.createElement('li');
                item.className = 'basic-input-files-item';
                const name = document.createElement('span');
                name.className = 'basic-input-files-name';
                name.textContent = escapeText(descriptor?.name || 'Файл');
                if (missing) name.dataset.missing = 'true';
                item.append(name);
                if (missing) {
                    const replace = document.createElement('button');
                    replace.type = 'button';
                    replace.className = 'basic-input-files-replace';
                    replace.textContent = 'Заменить';
                    replace.setAttribute('aria-label', `Заменить файл: ${name.textContent}`);
                    replace.disabled = Boolean(disabled);
                    replace.addEventListener('click', () => { input.dataset.replaceId = String(descriptor.id || ''); input.click(); });
                    item.append(replace);
                }
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'basic-input-files-remove';
                remove.textContent = '×';
                remove.title = 'Удалить файл';
                remove.setAttribute('aria-label', `Удалить файл: ${name.textContent}`);
                remove.disabled = Boolean(disabled);
                remove.addEventListener('click', () => publish(current.filter((entry) => entry !== descriptor)));
                item.append(remove);
                list.append(item);
            }
        };

        button.addEventListener('click', () => { if (!button.disabled) { input.dataset.replaceId = ''; input.click(); } });
        input.addEventListener('change', async () => {
            if (input.disabled) return;
            const picked = Array.from(input.files || []);
            input.value = '';
            if (!picked.length) return;
            try {
                let plan = current.map((descriptor) => ({ descriptor }));
                let replaceId = input.dataset.replaceId;
                input.dataset.replaceId = '';
                for (const file of picked) {
                    const replaceIndex = replaceId
                        ? plan.findIndex((item) => String(item.descriptor?.id || '') === replaceId)
                        : plan.findIndex((item) => item.descriptor?.name === file.name);
                    replaceId = '';
                    const previous = replaceIndex >= 0 ? plan[replaceIndex].descriptor : null;
                    const nextItem = { file, previous };
                    if (previous) plan[replaceIndex] = nextItem;
                    else plan.push(nextItem);
                }
                const batch = [];
                for (const item of plan) {
                    if (item.file) batch.push(item.file);
                    else if (Number.isSafeInteger(item.descriptor?.size)) batch.push({ name: item.descriptor.name, size: item.descriptor.size });
                    else if (typeof item.descriptor?.content === 'string') batch.push({ name: item.descriptor.name, size: new Blob([item.descriptor.content]).size });
                    else {
                        const stored = await store.get(item.descriptor);
                        batch.push(stored ? { name: item.descriptor?.name || stored.name, size: stored.size } : { name: item.descriptor?.name || 'Файл', size: 0 });
                    }
                }
                const checkBatch = validateBatch || root.BasicInputFiles?.validateBatch;
                if (typeof checkBatch === 'function') checkBatch(batch);
                const next = [];
                for (const item of plan) {
                    if (!item.file) { next.push(item.descriptor); continue; }
                    const previous = item.previous;
                    // Bind a missing imported source once; replacing a bound file belongs only to this card.
                    const alreadyBound = previous && (typeof previous.content === 'string' || await store.get(previous));
                    const bindId = previous?.name === item.file.name && !alreadyBound ? previous.id : null;
                    next.push(await store.put(item.file, bindId ? { id: bindId } : undefined));
                }
                await publish(next);
            } catch (error) {
                report(error?.message || 'Не удалось добавить входной файл.');
            }
        });
        const setDisabled = (value) => {
            button.disabled = Boolean(value);
            input.disabled = Boolean(value);
            list.querySelectorAll('button').forEach((item) => { item.disabled = Boolean(value); });
        };
        const onEditingState = (event) => setDisabled(!event.detail?.enabled);
        document.addEventListener('basic-pipeline-editing', onEditingState);
        const destroy = () => {
            if (destroyed) return;
            destroyed = true;
            document.removeEventListener('basic-pipeline-editing', onEditingState);
            root.remove();
            mountedWidgets.delete(root);
            if (mountedByKey.get(mountKey) === destroy) mountedByKey.delete(mountKey);
        };
        mountedWidgets.set(root, destroy);
        if (mountKey && typeof mountKey === 'object') mountedByKey.set(mountKey, destroy);
        render();
        return {
            element: root,
            input,
            setDisabled,
            destroy
        };
    }

    return { mount };
});
