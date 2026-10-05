const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../results/pipeline-card-cover.js'), 'utf8');

describe('Pipeline internal cover deck', () => {
    let root, cover, cards;
    beforeEach(() => {
        document.body.innerHTML = '<div id="feed" style="padding:6px 0 8px">'
            + ['A', 'B', 'C'].map((name) => `<div class="debate-model-card is-expanded">${name}</div>`).join('') + '</div>';
        root = document.getElementById('feed');
        Object.defineProperty(root, 'clientHeight', { value: 414, configurable: true });
        window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
        window.eval(source);
        cards = [...root.children];
        cover = window.PipelineCardCover.create(root);
        cover.refresh();
    });
    afterEach(() => cover.destroy());
    const scroll = (position) => {
        root.scrollTop = position * 400 * 0.92;
        root.dispatchEvent(new Event('scroll'));
    };
    test('holds, covers and seats original direct children; reverse scrolling works', () => {
        expect([...root.children]).toEqual(cards);
        scroll(0.25);
        expect(cards[0].dataset.coverState).toBe('seated');
        expect(cards[1].dataset.coverState).toBe('hidden');
        scroll(0.57);
        expect(cards[1].style.getPropertyValue('--pipeline-cover-y')).toBe('200.00px');
        expect(cards[0].style.getPropertyValue('--pipeline-cover-y')).toBe('-68.00px');
        expect(cards[0].inert).toBe(true);
        scroll(0.9);
        expect(cards[1].dataset.coverState).toBe('seated');
        expect(cards[1].inert).toBe(false);
        scroll(0);
        expect(cards[0].dataset.coverState).toBe('seated');
    });
    test('filtering retains the reading card and restores excluded card presentation', () => {
        scroll(1);
        cards[0].style.display = 'none';
        cover.refresh();
        expect(root.scrollTop).toBe(0);
        expect(cards[1].dataset.coverState).toBe('seated');
        expect(cards[0].classList.contains('pipeline-cover-card')).toBe(false);
        expect(cards[0].style.display).toBe('none');
    });
    test('resizing preserves reading progress and compact mode restores the feed', () => {
        scroll(1.57);
        Object.defineProperty(root, 'clientHeight', { value: 314, configurable: true });
        cover.refresh();
        expect(root.scrollTop).toBeCloseTo(1.57 * 300 * 0.92);
        cover.setEnabled(false);
        expect(root.classList.contains('pipeline-cover-host')).toBe(false);
        expect([...root.children]).toEqual(cards);
        cards.forEach((card) => {
            expect(card.hasAttribute('data-cover-state')).toBe(false);
            expect(card.style.getPropertyValue('--pipeline-cover-y')).toBe('');
            expect(card.inert).toBe(false);
        });
    });
    test('export removes hidden/moving presentation without changing live cards', () => {
        scroll(0.57);
        const clone = cards[1].cloneNode(true);
        window.PipelineCardCover.cleanSnapshot(clone);
        expect(clone.classList.contains('pipeline-cover-card')).toBe(false);
        expect(clone.hasAttribute('data-cover-state')).toBe(false);
        expect(clone.style.getPropertyValue('--pipeline-cover-y')).toBe('');
        expect(cards[1].dataset.coverState).toBe('moving');
    });
    test('reduced motion keeps the regular expanded feed', () => {
        cover.destroy();
        window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
        cover = window.PipelineCardCover.create(root);
        cover.refresh();
        expect(root.classList.contains('pipeline-cover-host')).toBe(false);
    });
});
