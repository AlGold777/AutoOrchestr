/** @jest-environment jsdom */
const ChoiceDialog = require('../results/choice-dialog');

describe('ChoiceDialog input file links', () => {
    let created;
    let originalCreate;
    let originalRevoke;

    beforeEach(() => {
        document.body.innerHTML = '';
        created = [];
        originalCreate = URL.createObjectURL;
        originalRevoke = URL.revokeObjectURL;
        URL.createObjectURL = jest.fn((blob) => {
            const url = `blob:test/${created.length + 1}`;
            created.push({ url, blob });
            return url;
        });
        URL.revokeObjectURL = jest.fn();
    });

    afterEach(() => {
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
    });

    const file = (name, type, base64, size) => ({ name, type, size, base64 });
    const readBlob = (blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => resolve(reader.result);
        reader.readAsText(blob);
    });

    test('shows safe download links below the message with decoded file contents', async () => {
        const answer = ChoiceDialog.ask({
            title: 'Вопрос', message: 'Прочитайте файлы',
            inputFiles: [file('brief.txt', 'text/plain', 'SGVsbG8=', 5), file('<img src=x>.pdf', 'application/pdf', 'WA==', 1)],
            choices: [{ value: 'continue', label: 'Продолжить' }]
        });
        const message = document.querySelector('.choice-dialog-message');
        const files = document.querySelector('.choice-dialog-input-files');
        expect(message.nextElementSibling).toBe(files);
        const links = [...files.querySelectorAll('a')];
        expect(links.map((link) => [link.textContent, link.download])).toEqual([
            ['📎 brief.txt', 'brief.txt'], ['📎 <img src=x>.pdf', '<img src=x>.pdf']
        ]);
        expect(files.querySelector('img')).toBeNull();
        expect(links[0].href).toBe('blob:test/1');
        expect(await readBlob(created[0].blob)).toBe('Hello');
        expect(created[0].blob.type).toBe('text/plain');
        document.querySelector('.choice-dialog-choice').click();
        await expect(answer).resolves.toBe('continue');
        expect(URL.revokeObjectURL.mock.calls).toEqual([['blob:test/1'], ['blob:test/2']]);
    });

    test('cancel and Escape revoke every created URL', async () => {
        const byCancel = ChoiceDialog.ask({ inputFiles: [file('one.txt', 'text/plain', 'MQ==', 1)] });
        document.querySelector('.choice-dialog-cancel').click();
        await expect(byCancel).resolves.toBeNull();
        expect(URL.revokeObjectURL).toHaveBeenLastCalledWith('blob:test/1');

        const byEscape = ChoiceDialog.ask({ inputFiles: [file('two.txt', 'text/plain', 'Mg==', 1)] });
        document.querySelector('.choice-dialog').dispatchEvent(new Event('cancel'));
        await expect(byEscape).resolves.toBeNull();
        expect(URL.revokeObjectURL).toHaveBeenLastCalledWith('blob:test/2');
        expect(document.querySelector('.choice-dialog')).toBeNull();
    });

    test('abort revokes URLs and removes the abort listener; an already aborted signal opens no dialog', async () => {
        const controller = new AbortController();
        const removeListener = jest.spyOn(controller.signal, 'removeEventListener');
        const answer = ChoiceDialog.ask({ signal: controller.signal, inputFiles: [file('run.txt', 'text/plain', 'cnVu', 3)] });
        controller.abort();
        await expect(answer).resolves.toBeNull();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test/1');
        expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
        await expect(ChoiceDialog.ask({ signal: controller.signal, inputFiles: [file('stale.txt', 'text/plain', 'eA==', 1)] })).resolves.toBeNull();
        expect(document.querySelector('.choice-dialog')).toBeNull();
        expect(URL.revokeObjectURL).toHaveBeenLastCalledWith('blob:test/2');
    });

    test('input files do not change the dialog answer value', async () => {
        const answer = ChoiceDialog.ask({ inputFiles: [file('brief.txt', 'text/plain', 'eA==', 1)], choices: [{ value: 'kept', label: 'OK' }] });
        document.querySelector('.choice-dialog-choice').click();
        await expect(answer).resolves.toBe('kept');
    });
});
