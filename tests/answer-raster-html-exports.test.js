/** @jest-environment jsdom */
const { delay, renderDebateDom, loadResultsScript } = require('./helpers/results-page-harness');

const RASTER_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/JgAAAABJRU5ErkJggg==';
const RASTER_MARKUP = `<p>Answer with picture</p><img src="${RASTER_DATA_URL}" alt="Generated image">`;

function addPipelineCard(id = 'raster-card') {
  const card = document.createElement('article');
  card.className = 'debate-model-card';
  Object.assign(card.dataset, {
    sessionId: '1', entryId: id, messageId: id, llmName: 'GPT', entryKind: 'response', kind: 'answer'
  });
  card.innerHTML = `
    <div class="debate-model-card-header">
      <span class="debate-model-card-title-main"><span class="debate-model-card-name">GPT</span></span>
      <span class="debate-model-card-meta">
        <button type="button" class="debate-card-copy">Copy</button>
        <button type="button" class="debate-card-export">Export</button>
      </span>
    </div>
    <div class="debate-model-card-output"></div>
  `;
  card.querySelector('.debate-model-card-output').innerHTML = window.sanitizeHTML(RASTER_MARKUP);
  document.getElementById('debate-model-cards').appendChild(card);
  return card;
}

async function withHtmlDownload(operation) {
  const createUrl = URL.createObjectURL;
  const revokeUrl = URL.revokeObjectURL;
  URL.createObjectURL = jest.fn(() => 'blob:raster-export');
  URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
    await operation();
  } finally {
    click.mockRestore();
    URL.createObjectURL = createUrl;
    URL.revokeObjectURL = revokeUrl;
  }
}

const blobToText = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error);
  reader.readAsText(blob);
});

describe('raster images in answer HTML exports and Pipeline copy', () => {
  beforeAll(async () => {
    renderDebateDom();
    document.body.classList.add('pipeline-page');
    await loadResultsScript();
  });

  beforeEach(() => {
    document.getElementById('debate-model-cards').innerHTML = '';
    window.ResultsShared.writeRichContentToClipboard.mockClear();
  });

  test('all-responses, single-response, and Favourite HTML keep a materialized raster image', async () => {
    const panel = document.createElement('section');
    panel.className = 'llm-panel';
    panel.id = 'panel-raster-export';
    panel.innerHTML = `
      <span class="llm-title">Raster model</span>
      <div class="output" id="raster-export-output"></div>
      <button class="panel-export-html-btn" data-target="raster-export-output" data-name="Raster model">Export</button>
    `;
    panel.querySelector('.output').innerHTML = window.sanitizeHTML(RASTER_MARKUP);
    document.body.appendChild(panel);

    const favoriteState = window.__resultsExportDebug.favoriteState;
    const originalEntries = [...favoriteState.entries];
    const originalCardMap = new Map(favoriteState.cardKeyToId);
    const originalNextId = favoriteState.nextId;
    favoriteState.entries = [{
      id: 'favorite-raster', kind: 'card', sourceName: 'Raster model', modelKey: 'raster-model',
      sourceOutputId: 'raster-export-output', text: 'Answer with picture',
      html: window.sanitizeHTML(RASTER_MARKUP), timeLabel: '12:00'
    }];
    favoriteState.cardKeyToId = new Map([['card:raster-export-output', 'favorite-raster']]);
    favoriteState.nextId = 2;

    try {
      const allDoc = new DOMParser().parseFromString(window.__resultsExportDebug.buildAllResponsesExportHtml(), 'text/html');
      expect(allDoc.querySelector('.response-body img')?.getAttribute('src')).toBe(RASTER_DATA_URL);
      expect(allDoc.querySelector('h2')?.textContent).toBe('Favourite');
      expect(allDoc.querySelectorAll('.response-body img')).toHaveLength(2);

      const favoriteDoc = new DOMParser().parseFromString(window.__resultsExportDebug.buildFavoriteExportHtml(), 'text/html');
      expect(favoriteDoc.querySelector('.response-body img')?.getAttribute('src')).toBe(RASTER_DATA_URL);

      await withHtmlDownload(async () => {
        panel.querySelector('.panel-export-html-btn').click();
        const singleHtml = await blobToText(URL.createObjectURL.mock.calls[0][0]);
        const singleDoc = new DOMParser().parseFromString(singleHtml, 'text/html');
        expect(singleDoc.querySelector('.response-body img')?.getAttribute('src')).toBe(RASTER_DATA_URL);
      });
    } finally {
      favoriteState.entries = originalEntries;
      favoriteState.cardKeyToId = originalCardMap;
      favoriteState.nextId = originalNextId;
      panel.remove();
    }
  });

  test('Pipeline feed and individual-card HTML exports keep a materialized raster image', async () => {
    const card = addPipelineCard();

    await withHtmlDownload(async () => {
      document.getElementById('debate-session-export-btn').click();
      const feedHtml = await blobToText(URL.createObjectURL.mock.calls[0][0]);
      const feedDoc = new DOMParser().parseFromString(feedHtml, 'text/html');
      expect(feedDoc.querySelector('.response-body img')?.getAttribute('src')).toBe(RASTER_DATA_URL);

      URL.createObjectURL.mockClear();
      card.querySelector('.debate-card-export').click();
      const cardHtml = await blobToText(URL.createObjectURL.mock.calls[0][0]);
      const cardDoc = new DOMParser().parseFromString(cardHtml, 'text/html');
      expect(cardDoc.querySelector('.response-body img')?.getAttribute('src')).toBe(RASTER_DATA_URL);
    });
  });

  test('Pipeline card copy includes the raster image in rich clipboard HTML', async () => {
    const card = addPipelineCard('raster-copy-card');
    card.querySelector('.debate-card-copy').click();
    await delay(0);

    expect(window.ResultsShared.writeRichContentToClipboard).toHaveBeenCalledTimes(1);
    const html = window.ResultsShared.writeRichContentToClipboard.mock.calls[0][0].html;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelector('img')?.getAttribute('src')).toBe(RASTER_DATA_URL);
    expect(doc.querySelector('img')?.getAttribute('alt')).toBe('Generated image');
  });
});
