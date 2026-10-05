const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../results.js'), 'utf8');
const start = source.indexOf('    function applyPartialMarker(');
const end = source.indexOf('    function applyAttributionMarker(', start);
const apply = new Function(`${source.slice(start, end)}; return applyPartialMarker;`)();
const apiStart = source.indexOf('    const ensureApiIndicator = ');
const apiEnd = source.indexOf('    const setApiIndicatorState = ', apiStart);

describe('incomplete answer header placement', () => {
    beforeEach(() => {
        window.TransportContract = { classifyCompletion: (status) => status === 'STREAM_TIMEOUT' ? 'partial' : 'complete' };
        document.body.innerHTML = '<div class="llm-panel"><div class="llm-header"><span class="status-indicator"></span><span class="api-indicator">API</span><button>Copy</button></div><div class="output">Answer</div></div>';
    });
    test('sits immediately after API, remains unique, and disappears on completion', () => {
        const panel = document.querySelector('.llm-panel');
        apply(panel, { status: 'STREAM_TIMEOUT' });
        apply(panel, { status: 'STREAM_TIMEOUT' });
        expect(panel.querySelectorAll('.answer-partial-mark')).toHaveLength(1);
        expect(panel.querySelector('.api-indicator').nextElementSibling.textContent).toBe('uncompleted');
        expect(panel.firstElementChild.className).toBe('llm-header');
        expect(panel.querySelector('.answer-partial-mark').title).toContain('STREAM_TIMEOUT');
        apply(panel, {});
        expect(panel.querySelector('.answer-partial-mark')).not.toBeNull();
        apply(panel, { status: 'SUCCESS' });
        expect(panel.querySelector('.answer-partial-mark')).toBeNull();
    });
    test('relocates a legacy mark above the header', () => {
        const panel = document.querySelector('.llm-panel');
        panel.insertAdjacentHTML('afterbegin', '<span class="answer-partial-mark">uncompleted</span>');
        const original = panel.firstElementChild;
        apply(panel, { status: 'STREAM_TIMEOUT' });
        expect(panel.querySelector('.api-indicator').nextElementSibling).toBe(original);
        expect(panel.firstElementChild.className).toBe('llm-header');
    });
    test('API created after the mark retains the requested order', () => {
        const panel = document.querySelector('.llm-panel');
        panel.querySelector('.api-indicator').remove();
        apply(panel, { status: 'STREAM_TIMEOUT' });
        const ensure = new Function('apiIndicatorRegistry', 'getPanelByLLMName', `${source.slice(apiStart, apiEnd)}; return ensureApiIndicator;`)(new Map(), () => panel);
        const api = ensure('GPT');
        expect(api.nextElementSibling.className).toBe('answer-partial-mark');
        expect(api.parentElement.className).toBe('llm-header');
    });
    test('Pipeline cards without API keep their round label and one inline mark', () => {
        document.body.innerHTML = '<div class="debate-model-card"><div class="debate-model-card-title-main"><span>GPT</span><span class="debate-model-card-round">R3</span></div></div>';
        const card = document.querySelector('.debate-model-card');
        apply(card, { status: 'STREAM_TIMEOUT' });
        expect(card.querySelector('.debate-model-card-round').nextElementSibling.textContent).toBe('uncompleted');
    });
});
