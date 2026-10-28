// Plan item 1.2 (docs/Pipeline scenarios/basic-user-schemas-fix-plan.md): a stored list of pipelines that cannot be read is
// never overwritten by the page's empty copy.
const { delay, renderDebateDom, loadResultsScript } = require('./helpers/results-page-harness');

describe('Basic: an unreadable list of pipelines', () => {
  const CORRUPTED = '__LZ__not a compressed list';

  beforeAll(async () => {
    renderDebateDom();
    document.body.classList.add('pipeline-page');
    await loadResultsScript(CORRUPTED);
    await delay(20);
  });

  test('1.2 stays in the storage as it was, and the owner is told', async () => {
    expect((await chrome.storage.local.get('llmComparatorPipelines')).llmComparatorPipelines).toBe(CORRUPTED);
    const result = await window.__pipelineLifecycleDebug.installBasicSchema('New', { schemaVersion: 1, origin: 'user', steps: [{ ref: 'r1', kind: 'round', models: [{ name: 'GPT' }] }] });
    expect(result.ok).toBe(false);
    expect(result.errors[0].message).toContain('не прочитан');
    expect((await chrome.storage.local.get('llmComparatorPipelines')).llmComparatorPipelines).toBe(CORRUPTED);
    expect(document.getElementById('notification-message').textContent).toContain('Список pipelines в хранилище не прочитан');
  });

  test('a pasted schema is refused before its name is asked', async () => {
    const prompt = jest.spyOn(window, 'prompt').mockReturnValue('Asked');
    document.getElementById('pipeline-profile-btn').click();
    document.getElementById('schema-paste-text').value = JSON.stringify({ schemaVersion: 1, origin: 'user', steps: [{ ref: 'r1', kind: 'round', models: [{ name: 'GPT' }] }] });
    document.getElementById('schema-paste-apply').click();
    await delay(20);
    expect(document.getElementById('prompt-modal')?.classList.contains('show') || prompt.mock.calls.length > 0).toBe(false);
    expect(document.getElementById('notification-message').textContent).toContain('Список pipelines в хранилище не прочитан');
    expect((await chrome.storage.local.get('llmComparatorPipelines')).llmComparatorPipelines).toBe(CORRUPTED);
    prompt.mockRestore();
    document.getElementById('schema-paste-cancel')?.click();
  });
});
