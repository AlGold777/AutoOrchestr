/** @jest-environment jsdom */
const InputFilesUI = require('../results/input-files');
const BasicInputFiles = require('../disput/basic-input-files');

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Basic input files UI', () => {
    let header;
    let title;
    let slot;
    let changes;
    let descriptors;
    let store;

    beforeEach(() => {
        document.body.innerHTML = '<header><h2>Participant</h2><div class="length"></div></header><div class="slot"></div>';
        window.BasicInputFiles = BasicInputFiles;
        header = document.querySelector('header');
        title = header.querySelector('h2');
        slot = document.querySelector('.slot');
        changes = [];
        descriptors = [];
        store = {
            put: jest.fn(async (file, options) => {
                const descriptor = { id: options?.id || `f${descriptors.length + 1}`, name: file.name, size: file.size };
                descriptors.push(descriptor);
                return descriptor;
            }),
            get: jest.fn(async (descriptor) => {
                if (descriptor.id === 'missing') return null;
                return new File(['body'], descriptor.name);
            })
        };
    });

    const choose = async (mount, files) => {
        Object.defineProperty(mount.input, 'files', { configurable: true, value: files });
        mount.input.dispatchEvent(new Event('change'));
        await tick();
    };

    test('mounts after the participant length control and adds selected files', async () => {
        const length = header.querySelector('.length');
        const mount = InputFilesUI.mount({
            header, after: length, container: header, store,
            onChange: async (files) => changes.push(files)
        });
        expect(length.nextElementSibling).toBe(mount.element);
        await choose(mount, [new File(['content'], 'brief.txt')]);
        expect(store.put).toHaveBeenCalledTimes(1);
        expect(changes.at(-1)[0].name).toBe('brief.txt');
        expect(mount.element.querySelector('.basic-input-files-name').textContent).toBe('brief.txt');
    });

    test('keeps missing files visible with a replace action and reports store errors', async () => {
        const notify = jest.fn();
        const mount = InputFilesUI.mount({ header, after: title, container: header, files: [{ id: 'missing', name: 'source.pdf' }], store, notify, onChange: async (files) => changes.push(files) });
        await tick();
        expect(mount.element.querySelector('.basic-input-files-replace')).not.toBeNull();
        await choose(mount, [new File(['new'], 'source.pdf')]);
        expect(store.put).toHaveBeenCalledWith(expect.any(File), { id: 'missing' });
        expect(changes.at(-1)[0]).toEqual(expect.objectContaining({ id: 'missing', name: 'source.pdf' }));

        store.put.mockRejectedValueOnce(new Error('File limit exceeded'));
        await choose(mount, [new File(['new'], 'too-large.bin')]);
        expect(notify).toHaveBeenCalledWith('File limit exceeded', 'error');
        expect(mount.element.querySelector('.basic-input-files-status').textContent).toBe('File limit exceeded');
    });

    test('validates the combined 30 MiB batch before storing any newly picked file', async () => {
        const mount = InputFilesUI.mount({
            header, after: title, container: header,
            files: Array.from({ length: 6 }, (_, index) => ({ id: `large${index}`, name: `large${index}.bin`, size: 5 * 1024 * 1024 })),
            store, validateBatch: BasicInputFiles.validateBatch,
            onChange: async (files) => changes.push(files)
        });
        await tick();
        await choose(mount, [new File([new Uint8Array(2 * 1024 * 1024)], 'extra.bin')]);
        expect(store.put).not.toHaveBeenCalled();
        expect(changes).toHaveLength(0);
        expect(mount.element.querySelector('.basic-input-files-status').textContent).toContain('30 МиБ');
    });

    test('inline content is available even when the store has no byte record', async () => {
        const mount = InputFilesUI.mount({
            header, after: title, container: header,
            files: [{ id: 'inline', name: 'inline.txt', content: 'hello', size: 5 }], store,
            onChange: async () => {}
        });
        await tick();
        expect(mount.element.querySelector('.basic-input-files-name').dataset.missing).toBeUndefined();
        expect(store.get).not.toHaveBeenCalled();
    });

    test('choosing a different filename from Replace creates a fresh ID for that slot', async () => {
        const mount = InputFilesUI.mount({
            header, after: title, container: header, files: [{ id: 'missing', name: 'old.txt' }], store,
            onChange: async (files) => changes.push(files)
        });
        await tick();
        mount.element.querySelector('.basic-input-files-replace').click();
        await choose(mount, [new File(['replacement'], 'new.txt')]);
        expect(store.put).toHaveBeenCalledWith(expect.any(File), undefined);
        expect(changes.at(-1)).toEqual([expect.objectContaining({ id: 'f1', name: 'new.txt' })]);
        expect(mount.element.querySelectorAll('.basic-input-files-item')).toHaveLength(1);
    });

    test('replacing a bound file creates a new ID without changing the same file on another card', async () => {
        const shared = { id: 'shared-id', name: 'brief.txt', type: 'text/plain', size: 3 };
        const storedById = new Map([['shared-id', new File(['old'], 'brief.txt', { type: 'text/plain' })]]);
        store.get.mockImplementation(async ({ id }) => storedById.get(id) || null);
        store.put.mockImplementation(async (file, options) => {
            const id = options?.id || `replacement-${storedById.size}`;
            storedById.set(id, file);
            return { id, name: file.name, type: file.type, size: file.size };
        });
        const cardAChanges = [];
        const cardBChanges = [];
        const cardA = InputFilesUI.mount({
            container: slot, files: [shared], store,
            onChange: async (files) => cardAChanges.push(files)
        });
        const cardBHeader = document.createElement('header');
        const cardB = InputFilesUI.mount({
            container: cardBHeader, files: [shared], store,
            onChange: async (files) => cardBChanges.push(files)
        });
        await tick();

        await choose(cardA, [new File(['new bytes'], 'brief.txt', { type: 'text/plain' })]);

        expect(store.put).toHaveBeenCalledWith(expect.any(File), undefined);
        expect(cardAChanges.at(-1)[0]).toEqual(expect.objectContaining({ id: 'replacement-1', name: 'brief.txt' }));
        expect(cardBChanges).toEqual([]);
        expect(cardB.element.querySelector('.basic-input-files-name').textContent).toBe('brief.txt');
        expect((await store.get(shared)).size).toBe(3);
        cardA.destroy();
        cardB.destroy();
    });

    test('removes a file and a disabled mount never writes', async () => {
        const onChange = jest.fn();
        const mount = InputFilesUI.mount({ header, after: title, container: header, files: [{ id: 'saved', name: 'saved.txt' }], store, onChange });
        await tick();
        document.dispatchEvent(new CustomEvent('basic-pipeline-editing', { detail: { enabled: false } }));
        expect(mount.input.disabled).toBe(true);
        mount.element.querySelector('.basic-input-files-remove').click();
        await tick();
        mount.input.dispatchEvent(new Event('change'));
        await tick();
        expect(onChange).not.toHaveBeenCalled();
        expect(store.put).not.toHaveBeenCalled();

        document.dispatchEvent(new CustomEvent('basic-pipeline-editing', { detail: { enabled: true } }));
        await tick();
        mount.element.querySelector('.basic-input-files-remove').click();
        await tick();
        expect(onChange).toHaveBeenCalledWith([]);
    });

    test('repeat mount destroys the prior listener and does not append after an in-flight read', async () => {
        let release;
        const slowStore = { ...store, get: jest.fn(() => new Promise((resolve) => { release = resolve; })) };
        const removeListener = jest.spyOn(document, 'removeEventListener');
        const first = InputFilesUI.mount({ container: slot, mountKey: header, store: slowStore, files: [{ id: 'pending', name: 'pending.txt' }], onChange: async () => {} });
        const nextSlot = document.createElement('div');
        document.body.append(nextSlot);
        const second = InputFilesUI.mount({ container: nextSlot, mountKey: header, store, onChange: async () => {} });
        expect(first.element.isConnected).toBe(false);
        expect(removeListener).toHaveBeenCalledWith('basic-pipeline-editing', expect.any(Function));
        expect(document.querySelectorAll('[data-basic-input-files]')).toHaveLength(1);
        expect(second.element.isConnected).toBe(true);
        release(new File(['old'], 'old.txt'));
        await tick();
        expect(first.element.querySelector('.basic-input-files-item')).toBeNull();
        expect(header.querySelectorAll('.basic-input-files-item')).toHaveLength(0);
        removeListener.mockRestore();
        second.destroy();
    });

    test('a failed persistence leaves the old file list visible and reports the error', async () => {
        const notify = jest.fn();
        const mount = InputFilesUI.mount({
            header, after: title, container: header, files: [{ id: 'saved', name: 'saved.txt' }], store, notify,
            onChange: async () => { throw new Error('save failed'); }
        });
        await tick();
        mount.element.querySelector('.basic-input-files-remove').click();
        await tick();
        expect(mount.element.querySelector('.basic-input-files-name').textContent).toBe('saved.txt');
        expect(mount.element.querySelector('.basic-input-files-status').textContent).toBe('save failed');
        expect(notify).toHaveBeenCalledWith('save failed', 'error');
    });
});
