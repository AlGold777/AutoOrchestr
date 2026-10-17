// Behavioural tests for results/attachments.js — enabled by extracting prompt
// attachment handling out of the results.js monolith into a testable module.
require('../results/dom-utils');
require('../results/attachments');

const escapeHtml = (v = '') => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function makeAttach() {
  const bar = document.createElement('div');
  document.body.appendChild(bar); // attached: replaceChildrenFromHtml needs a parented context node
  const input = document.createElement('input');
  input.type = 'file';
  const btn = document.createElement('button');
  document.body.append(input, btn);
  const dom = window.ResultsDomUtils.create({ promptPasteBlockSelector: 'p', escapeHtml, sanitizeHTML: (v) => v });
  const notifications = [];
  const api = window.ResultsAttachments.create({
    promptAttachInput: input,
    promptAttachBtn: btn,
    promptAttachmentBar: bar,
    escapeHtml,
    clearNode: dom.clearNode,
    replaceChildrenFromHtml: dom.replaceChildrenFromHtml,
    showNotification: (m) => notifications.push(m)
  });
  return { api, bar, input, btn, notifications };
}

const txtFile = (name, body = 'hello') => new File([body], name, { type: 'text/plain' });

describe('ResultsAttachments add / render / dedup', () => {
  test('adds files and renders a pill per file, de-duplicating identical files', () => {
    const { api, bar } = makeAttach();
    api.addPromptAttachments([txtFile('a.txt')]);
    expect(bar.querySelectorAll('.attachment-pill').length).toBe(1);

    api.addPromptAttachments([txtFile('a.txt')]); // same name/size/type → ignored
    expect(bar.querySelectorAll('.attachment-pill').length).toBe(1);

    api.addPromptAttachments([txtFile('b.txt')]);
    expect(bar.querySelectorAll('.attachment-pill').length).toBe(2);
  });
});

describe('ResultsAttachments.clearPromptAttachments', () => {
  test('clears all pills and lets the same file be re-added afterwards', () => {
    const { api, bar } = makeAttach();
    api.addPromptAttachments([txtFile('a.txt'), txtFile('b.txt')]);
    expect(bar.querySelectorAll('.attachment-pill').length).toBe(2);

    expect(api.clearPromptAttachments()).toBe(true);
    expect(bar.querySelectorAll('.attachment-pill').length).toBe(0);

    // dedup set was cleared too: the same file can be attached again
    api.addPromptAttachments([txtFile('a.txt')]);
    expect(bar.querySelectorAll('.attachment-pill').length).toBe(1);

    // no-op when already empty
    api.clearPromptAttachments();
    expect(api.clearPromptAttachments()).toBe(false);
  });
});

describe('ResultsAttachments.buildAttachmentPayload', () => {
  test('keeps and serializes more than five attachments', async () => {
    const { api, bar } = makeAttach();
    const files = Array.from({ length: 6 }, (_, index) => txtFile(`file-${index + 1}.txt`));
    api.addPromptAttachments(files);

    expect(bar.querySelectorAll('.attachment-pill')).toHaveLength(6);
    await expect(api.buildAttachmentPayload()).resolves.toHaveLength(6);
  });

  test('reads attachments into base64 payloads', async () => {
    const { api } = makeAttach();
    api.addPromptAttachments([txtFile('h.txt', 'hello world')]);
    const payload = await api.buildAttachmentPayload();
    expect(payload).toHaveLength(1);
    expect(payload[0]).toEqual(expect.objectContaining({ name: 'h.txt', type: 'text/plain' }));
    expect(String(payload[0].base64)).toMatch(/^data:/);
  });

  test('skips oversized files and notifies', async () => {
    const { api, notifications } = makeAttach();
    const big = new File([new Uint8Array(6 * 1024 * 1024)], 'big.bin', { type: 'application/octet-stream' });
    api.addPromptAttachments([big]);
    const payload = await api.buildAttachmentPayload();
    expect(payload).toHaveLength(0);
    expect(notifications.some((n) => /too large/i.test(n))).toBe(true);
  });
});

describe('ResultsAttachments.extractFilesFromTransfer / tryAddTransferAttachments', () => {
  test('extracts files from a transfer and reports whether anything was added', () => {
    const { api, bar } = makeAttach();
    const f = txtFile('d.txt');
    expect(api.extractFilesFromTransfer({ files: [f] })).toHaveLength(1);
    expect(api.tryAddTransferAttachments({ files: [f] })).toBe(true);
    expect(bar.querySelectorAll('.attachment-pill').length).toBe(1);
    expect(api.tryAddTransferAttachments({ files: [] })).toBe(false);
  });
});

test('nine files totaling 193 kB are serialized completely before background dispatch', async () => {
  const { api } = makeAttach();
  const batch = Array.from({ length: 9 }, (_, index) => txtFile(`document-${index}.txt`, 'x'.repeat(index === 8 ? 21000 : 21500)));
  api.addPromptAttachments(batch);
  const payload = await api.buildAttachmentPayload();
  expect(payload).toHaveLength(9);
  expect(payload.reduce((sum, item) => sum + item.size, 0)).toBe(193000);
  payload.forEach((item, index) => {
    expect(item.name).toBe(batch[index].name);
    expect(Buffer.from(item.base64.split(',')[1], 'base64').length).toBe(batch[index].size);
  });
});
