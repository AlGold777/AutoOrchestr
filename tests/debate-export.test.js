/** @jest-environment jsdom */
const Exporter = require('../results/debate-export');

test('builds one session export and escapes headings', () => {
  document.body.innerHTML = `<div id="feed"><article class="debate-model-card" data-session-id="1" data-llm-name="&lt;GPT&gt;"><span class="debate-model-card-time">10:00</span><div class="debate-model-card-output"><b>safe</b></div></article><article class="debate-model-card" data-session-id="2"><div class="debate-model-card-output">other</div></article></div>`;
  const html = Exporter.buildFeedDocument(document.getElementById('feed'), '1');
  expect(html).toContain('&lt;GPT&gt;');
  expect(html).toContain('<b>safe</b>');
  expect(html).not.toContain('other');
  expect(html).toContain('class="saved-at"');
});

test('uses requested month-year filename stamp and machine-readable saved time', () => {
  const date = new Date(2026, 6, 17, 18, 30);
  expect(Exporter.fileStamp(date)).toBe('jul26 18-30');
  expect(Exporter.cardFileStamp(date)).toBe('jul26 18-30');
  expect(Exporter.savedStamp(date)).toBe('2026-07-17_18-30');
});

test('strips executable markup defensively', () => {
  document.body.innerHTML = `<article class="debate-model-card" data-session-id="1"><div class="debate-model-card-output"><img src="javascript:alert(1)" onerror="alert(2)"><script>alert(3)</script><b>ok</b></div></article>`;
  const html = Exporter.buildFeedDocument(document.body, '1');
  expect(html).toContain('<b>ok</b>');
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  expect(parsed.querySelector('.response-body').innerHTML).not.toMatch(/javascript:|onerror=|<script/i);
  expect(parsed.querySelectorAll('script')).toHaveLength(1);
});

const { JSDOM } = require('jsdom');

function multiRoundFeed() {
  document.body.innerHTML = `<div id="feed">
    <article class="debate-model-card" data-session-id="1" data-llm-name="Claude" data-pipeline-round-id="r2"><div class="debate-model-card-output">Second round Claude</div></article>
    <article class="debate-model-card" data-session-id="1" data-llm-name="GPT" data-pipeline-round-id="r1" style="display:none"><div class="debate-model-card-output">First round GPT</div></article>
    <article class="debate-model-card" data-session-id="1" data-llm-name="Claude" data-pipeline-round-id="r1"><div class="debate-model-card-output">First round Claude</div></article>
    <article class="debate-model-card" data-session-id="1" data-llm-name="Moderator"><div class="debate-model-card-output">User prompt</div></article>
    <article class="debate-model-card" data-session-id="2" data-llm-name="Other"><div class="debate-model-card-output">Other session</div></article>
  </div>`;
  return document.getElementById('feed');
}

test('saved HTML switches independently between a model across rounds and all models in a round', () => {
  const icon = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
  const html = Exporter.buildFeedDocument(multiRoundFeed(), '1', 'Feed', { GPT: icon });
  expect(html).toContain(icon);
  expect(html).not.toContain('Other session');
  const saved = new JSDOM(html, { runScripts: 'dangerously' });
  const doc = saved.window.document;
  const visible = () => [...doc.querySelectorAll('.feed-response')].filter((card) => !card.hidden).map((card) => card.querySelector('.response-body').textContent);
  expect(visible()).toHaveLength(4);
  doc.querySelector('[data-view="model"][data-value="Claude"]').click();
  expect(visible()).toEqual(['Second round Claude', 'First round Claude']);
  doc.querySelector('[data-view="round"][data-value="r1"]').click();
  expect(visible()).toEqual(['First round GPT', 'First round Claude']);
  expect(doc.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
  doc.querySelector('[data-view="all"]').click();
  expect(visible()).toHaveLength(4);
  saved.window.close();
});

test('TXT preserves feed order, hidden cards, moderator content and exact separators', () => {
  const text = Exporter.buildFeedText(multiRoundFeed(), '1');
  const separator = Array(3).fill('='.repeat(57)).join('\n');
  expect(text.split(`\n\n${separator}\n\n`)).toEqual([
    'Claude R2\nSecond round Claude', 'GPT R1\nFirst round GPT',
    'Claude R1\nFirst round Claude', 'Moderator\nUser prompt'
  ]);
  expect(text).not.toContain('Other session');
  expect(Exporter.buildFeedText(null)).toBe('');
  expect(Exporter.buildFeedDocument(null)).toBe('');
});

test('TXT download uses UTF-8 text and preserves the supplied contents', async () => {
  const createUrl = URL.createObjectURL;
  const revokeUrl = URL.revokeObjectURL;
  URL.createObjectURL = jest.fn(() => 'blob:feed');
  URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    expect(this.download).toBe('Feed.txt');
  });
  try {
    expect(Exporter.downloadText('Feed.txt', 'Claude R1\nОтвет\n')).toBe(true);
    const blob = URL.createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe('text/plain;charset=utf-8');
    const text = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsText(blob);
    });
    expect(text).toBe('Claude R1\nОтвет\n');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:feed');
    expect(document.querySelector('a[download]')).toBeNull();
  } finally {
    click.mockRestore();
    URL.createObjectURL = createUrl;
    URL.revokeObjectURL = revokeUrl;
  }
});
