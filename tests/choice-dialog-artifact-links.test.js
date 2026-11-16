/** @jest-environment jsdom */
const ChoiceDialog = require('../results/choice-dialog');
window.OwnerAsk = require('../results/owner-ask');

describe('read-only artifact dialog links', () => {
  let createObjectURL;
  let revokeObjectURL;

  beforeEach(() => {
    document.body.innerHTML = '';
    createObjectURL = jest.fn(() => 'blob:artifact-copy');
    revokeObjectURL = jest.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  });

  afterEach(() => {
    delete URL.createObjectURL;
    delete URL.revokeObjectURL;
  });

  test('shows a safe source page and a downloadable text copy, then revokes the blob URL on close', async () => {
    const answer = ChoiceDialog.ask({
      title: 'Plan',
      document: { kind: 'read', readOnly: true, name: '', text: 'artifact body', sourceUrl: 'https://model.example/chat/123', downloadName: 'Plan/report.txt' }
    });

    const source = document.querySelector('.choice-dialog-document-source');
    const download = document.querySelector('.choice-dialog-document-download');
    expect(source.href).toBe('https://model.example/chat/123');
    expect(source.target).toBe('_blank');
    expect(source.rel).toBe('noopener noreferrer');
    expect(download.download).toBe('Plan_report.txt');
    expect(download.href).toBe('blob:artifact-copy');
    expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'text/plain;charset=utf-8' }));
    expect(document.querySelector('.choice-dialog-document').textContent).toBe('artifact body');

    document.querySelector('.choice-dialog-cancel').click();
    await expect(answer).resolves.toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:artifact-copy');
  });

  test.each(['javascript:alert(1)', 'file:///tmp/model'])('does not create a source link for unsafe URL %s', async (sourceUrl) => {
    const answer = ChoiceDialog.ask({
      document: { kind: 'read', readOnly: true, text: 'body', sourceUrl, downloadName: '' }
    });
    expect(document.querySelector('.choice-dialog-document-source')).toBeNull();
    document.querySelector('.choice-dialog-cancel').click();
    await expect(answer).resolves.toBeNull();
  });
});
