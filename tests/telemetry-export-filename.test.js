// Замок на экспорт телеметрии: по имени файла видно, чей это прогон, а в файле
// лежат сырые события и памятка читателю (без производных отчётов).
//
// Тест поведенческий: окно грузится в jsdom, экспорт запускается штатным
// обработчиком кнопки, файл перехватывается на реальной точке скачивания.
const path = require('path');

const DEVTOOLS_PATH = path.join(__dirname, '..', 'results-devtools.js');

const TELEMETRY_HTML = `
  <div id="api-keys-modal"><button id="telemetry-tab" class="devtools-tab"></button></div>
  <select id="telemetry-platform-select">
    <option value="all">All platforms</option>
    <option value="gemini">Gemini</option>
  </select>
  <select id="telemetry-export-profile-select">
    <option value="raw">Raw</option>
    <option value="completion">End of generation</option>
  </select>
  <button id="telemetry-export-json-btn"></button>
  <div id="telemetry-rounds"></div>
  <div id="telemetry-timeline"></div>
  <div id="telemetry-summary"></div>
  <span id="telemetry-status"></span>
  <span id="telemetry-summary-status"></span>
`;

const RUN_SESSION_ID = '1786174770340';
const rawEvent = (platform, ts, label = 'DISPATCH_SEND') => ({
    ts,
    type: 'TELEMETRY',
    label,
    level: 'info',
    platform,
    details: '',
    meta: { runSessionId: RUN_SESSION_ID, dispatchId: `${platform}:1` }
});

let downloads = [];
let storedEvents = [];
let platformSelect;
let profileSelect;

const runExport = async () => {
    downloads = [];
    const button = document.getElementById('telemetry-export-json-btn');
    button.disabled = false;
    button.click();
    for (let attempt = 0; attempt < 50 && !downloads.length; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return downloads[0];
};

beforeAll(() => {
    document.body.innerHTML = TELEMETRY_HTML;
    global.chrome = {
        runtime: {
            lastError: null,
            getURL: (p) => p,
            getManifest: () => ({ version: 'test' }),
            sendMessage: (message, callback) => {
                if (typeof callback !== 'function') return;
                if (message?.type === 'GET_DIAG_EVENTS') {
                    callback({ success: true, events: storedEvents });
                    return;
                }
                callback(null);
            }
        },
        storage: { local: { get: () => {}, set: () => {} } }
    };
    window.chrome = global.chrome;
    const RealBlob = window.Blob;
    let lastBlobText = '';
    window.Blob = function Blob(parts, options) {
        lastBlobText = parts.join('');
        return new RealBlob(parts, options);
    };
    window.URL.createObjectURL = () => 'blob:test';
    window.URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function click() {
        downloads.push({ filename: this.download, text: lastBlobText });
    };
    // eslint-disable-next-line global-require
    window.TelemetryViews = require(path.join(__dirname, '..', 'shared', 'telemetry-views.js'));
    // eslint-disable-next-line global-require
    require(DEVTOOLS_PATH);
    platformSelect = document.getElementById('telemetry-platform-select');
    profileSelect = document.getElementById('telemetry-export-profile-select');
});

beforeEach(() => {
    platformSelect.value = 'all';
    profileSelect.value = 'raw';
});

describe('telemetry export', () => {
    test('names the single model present even when the dropdown says All platforms', async () => {
        storedEvents = [rawEvent('Gemini', 1), rawEvent('Gemini', 2)];
        const { filename } = await runExport();
        expect(filename).toMatch(/^telemetry-gemini-\d+\.json$/);
    });

    test('names the model picked in the dropdown and exports only its events', async () => {
        storedEvents = [rawEvent('Gemini', 1), rawEvent('Qwen', 2)];
        platformSelect.value = 'gemini';
        const { filename } = await runExport();
        expect(filename).toMatch(/^telemetry-gemini-\d+\.json$/);
        const payload = JSON.parse(downloads[0].text);
        expect(payload.events.map((event) => event.platform)).toEqual(['Gemini']);
    });

    test('falls back to all-models when the export spans several models', async () => {
        storedEvents = [rawEvent('Gemini', 1), rawEvent('Qwen', 2)];
        const { filename } = await runExport();
        expect(filename).toMatch(/^telemetry-all-models-\d+\.json$/);
    });

    test('run-level SYSTEM events do not turn a single-model export into all-models', async () => {
        storedEvents = [rawEvent('SYSTEM', 1), rawEvent('Gemini', 2)];
        const { filename } = await runExport();
        expect(filename).toMatch(/^telemetry-gemini-\d+\.json$/);
    });

    test('the file carries raw events, the run id and a reader guide', async () => {
        storedEvents = [rawEvent('Gemini', 1), rawEvent('Gemini', 2, 'MODEL_FINAL')];
        await runExport();
        const payload = JSON.parse(downloads[0].text);
        expect(payload.format).toBe('telemetry-raw/1');
        expect(String(payload.runSessionId)).toBe(RUN_SESSION_ID);
        expect(payload.eventCount).toBe(2);
        expect(payload.readerGuide).toContain('не зафиксировано');
        expect(payload.events[1].label).toBe('MODEL_FINAL');
    });

    test('a problem profile exports a compact view with the task for the reader', async () => {
        storedEvents = [rawEvent('Gemini', 1, 'SELECTOR_STATS'), rawEvent('Gemini', 2, 'ANSWER_COMPLETE_DETECTED'), rawEvent('Gemini', 3, 'MODEL_FINAL')];
        profileSelect.value = 'completion';
        const { filename, text } = await runExport();
        expect(filename).toMatch(/^telemetry-completion-gemini-\d+\.json$/);
        const payload = JSON.parse(text);
        expect(payload.format).toBe('telemetry-view/1');
        expect(payload.profile).toBe('completion');
        expect(payload.sourceEventCount).toBe(3);
        expect(payload.eventCount).toBe(2);
        expect(payload.events.map((row) => row.l)).toEqual(['ANSWER_COMPLETE_DETECTED', 'MODEL_FINAL']);
        expect(payload.readerGuide).toContain('Задача:');
        expect(payload.fieldsGuide).toContain('n —');
    });
});
