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


test('exported Prompt starts collapsed, preserves literal text and toggles like the main export', () => {
  const prompt = 'Line 1 <script>bad()</script>\n' + 'Long prompt line\n'.repeat(10);
  const html = Exporter.buildFeedDocument(multiRoundFeed(), '1', 'Feed', {}, prompt);
  const saved = new JSDOM(html, {
    runScripts: 'dangerously',
    beforeParse(window) {
      Object.defineProperty(window.HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 300 });
      Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 90 });
    }
  });
  const doc = saved.window.document;
  const block = doc.querySelector('.export-prompt');
  const toggle = doc.querySelector('.prompt-toggle');
  expect(block.textContent).toBe(prompt.trim());
  expect(doc.querySelector('.feed-navigation').nextElementSibling.className).toBe('prompt-section');
  expect(block.classList.contains('is-collapsed')).toBe(true);
  expect(toggle.hidden).toBe(false);
  toggle.click();
  expect(block.classList.contains('is-collapsed')).toBe(false);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(toggle.textContent).toBe('Show less');
  toggle.click();
  expect(block.classList.contains('is-collapsed')).toBe(true);
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(toggle.textContent).toBe('Show more');
  expect(doc.querySelectorAll('script')).toHaveLength(1);
  saved.window.close();
});

test('each model or round click scrolls to its first answer, including repeated selections', () => {
  const scroll = jest.fn();
  const saved = new JSDOM(Exporter.buildFeedDocument(multiRoundFeed()), {
    runScripts: 'dangerously',
    beforeParse(window) {
      window.HTMLElement.prototype.scrollIntoView = function (options) { scroll(this.textContent, options); };
    }
  });
  const doc = saved.window.document;
  expect(scroll).not.toHaveBeenCalled();
  doc.querySelector('[data-view="round"][data-value="r1"]').click();
  expect(scroll.mock.calls[0][0]).toContain('First round GPT');
  doc.querySelector('[data-view="model"][data-value="Claude"]').click();
  expect(scroll.mock.calls[1][0]).toContain('Second round Claude');
  doc.querySelector('[data-view="model"][data-value="Claude"]').click();
  expect(scroll.mock.calls[2][0]).toContain('Second round Claude');
  doc.querySelector('[data-view="all"]').click();
  expect(scroll.mock.calls[3][0]).toContain('Second round Claude');
  saved.window.close();
});


test('feed answers place round beside the model, metadata below, and End after the unshaded body', () => {
  const feed = multiRoundFeed();
  const card = feed.querySelector('.debate-model-card');
  card.dataset.llmName = 'Le Chat';
  card.dataset.pipelineRoundId = 'r1';
  card.dataset.responseTimestamp = String(new Date(2026, 9, 5, 10, 33).getTime());
  card.dataset.sourceUrl = 'https://claude.ai/chat/5f8da1b0-88d4-421d-a2ab-8401dda9a63c';
  const doc = new DOMParser().parseFromString(Exporter.buildFeedDocument(feed), 'text/html');
  const response = doc.querySelector('.feed-response');
  expect(response.querySelector('h2').textContent).toBe('Le Chat R1');
  const metadata = response.querySelector('.response-meta');
  expect(metadata.textContent).toBe('2026-10-05 10-33  https://claude.ai/chat/5f8da1b0-88d4-421d-a2ab-8401dda9a63c');
  expect(response.querySelector('h2').nextElementSibling).toBe(metadata);
  expect(response.querySelector('.response-body').nextElementSibling.textContent).toBe('Le Chat End');
  expect(doc.querySelector('style').textContent).toContain('.response-body{background:transparent;padding:0;border-radius:0}');
});
