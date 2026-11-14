const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../results.js'), 'utf8');
const start = source.indexOf('    function applyPartialMarker(');
const end = source.indexOf('    function applyAttributionMarker(', start);
const apply = new Function(`${source.slice(start, end)}; return applyPartialMarker;`)();

describe('incomplete answer header placement', () => {
    beforeEach(() => {
        window.TransportContract = { classifyCompletion: (status) => status === 'STREAM_TIMEOUT' ? 'partial' : 'complete' };
        document.body.innerHTML = '<div class="llm-panel"><div class="llm-header"><span class="status-indicator"></span><span class="api-indicator">API</span><button>Copy</button></div><div class="output">Answer</div></div>';
    });
    test('main card keeps partial state without a label, including after completion', () => {
        const panel = document.querySelector('.llm-panel');
        panel.insertAdjacentHTML('afterbegin', '<span class="answer-partial-mark">uncompleted</span>');
        apply(panel, { status: 'STREAM_TIMEOUT' });
        expect(panel.dataset.completion).toBe('partial');
        expect(panel.querySelector('.answer-partial-mark')).toBeNull();
        apply(panel, {});
        expect(panel.dataset.completion).toBe('partial');
        apply(panel, { status: 'SUCCESS' });
        expect(panel.dataset.completion).toBe('');
    });
    test('Pipeline cards without API keep their round label and one inline mark', () => {
        document.body.innerHTML = '<div class="debate-model-card"><div class="debate-model-card-title-main"><span>GPT</span><span class="debate-model-card-round">R3</span></div></div>';
        const card = document.querySelector('.debate-model-card');
        apply(card, { status: 'STREAM_TIMEOUT' });
        expect(card.querySelector('.debate-model-card-round').nextElementSibling.textContent).toBe('uncompleted');
    });
});
