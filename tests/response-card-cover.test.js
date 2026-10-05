const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '..', 'results', 'response-card-cover.js'), 'utf8');

describe('Response card cover reading view', () => {
  let root;
  let cover;
  let scrollY;
  let motion;
  const flush = async () => { await Promise.resolve(); jest.runOnlyPendingTimers(); await Promise.resolve(); };
  const scroll = async (position) => {
    scrollY = position;
    window.dispatchEvent(new Event('scroll'));
    await flush();
  };

  beforeEach(() => {
    jest.useFakeTimers();
    scrollY = 0;
    motion = { matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() };
    window.matchMedia = jest.fn(() => motion);
    window.requestAnimationFrame = (callback) => setTimeout(callback, 0);
    window.cancelAnimationFrame = clearTimeout;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1000 });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY });
    window.scrollTo = jest.fn(({ top }) => { scrollY = top; });
    document.body.className = '';
    document.body.innerHTML = '<div class="llm-results view-stack">'
      + '<div class="llm-panel" id="a"><div class="output"><b>First answer</b></div></div>'
      + '<div class="llm-panel" id="b"><div class="output">Second answer</div></div>'
      + '<div class="llm-panel" id="c" style="display:none"><div class="output">Third answer</div></div></div>';
    root = document.querySelector('.llm-results');
    root.getBoundingClientRect = () => ({ top: 76 - scrollY, bottom: 76 - scrollY + 620 + 920 * (root.querySelectorAll('.response-cover-card').length - 1) });
    window.eval(source);
    cover = window.ResultsResponseCardCover.create(root);
  });

  afterEach(() => { cover.destroy(); jest.useRealTimers(); });

  test('holds the current card, covers it from below, and reverses when scrolling back', async () => {
    const first = document.getElementById('a');
    const second = document.getElementById('b');
    await scroll(920 * 0.29);
    expect(first.style.transform).toBe('translate3d(0, 0%, 0)');
    expect(second.style.visibility).toBe('hidden');
    await scroll(920 * 0.55);
    expect(Number.parseFloat(second.style.transform.split(',')[1])).toBeGreaterThan(0);
    expect(Number.parseFloat(second.style.transform.split(',')[1])).toBeLessThan(100);
    expect(first.hasAttribute('inert')).toBe(true);
    expect(second.hasAttribute('inert')).toBe(true);
    await scroll(920 * 0.84);
    expect(second.style.transform).toBe('translate3d(0, 0%, 0)');
    expect(first.style.transform).toBe('translate3d(0, -34%, 0)');
    expect(first.hasAttribute('inert')).toBe(true);
    expect(second.hasAttribute('inert')).toBe(false);
    await scroll(0);
    expect(first.style.transform).toBe('translate3d(0, 0%, 0)');
    expect(first.hasAttribute('inert')).toBe(false);
  });

  test('restores original nodes, order, content and inline styles when switching to grid', async () => {
    const first = document.getElementById('a');
    const button = document.createElement('button');
    const clicked = jest.fn();
    button.addEventListener('click', clicked);
    first.appendChild(button);
    root.className = 'llm-results view-grid';
    cover.refresh();
    await flush();
    expect(Array.from(root.children).map((card) => card.id)).toEqual(['a', 'b', 'c']);
    expect(document.getElementById('a')).toBe(first);
    expect(first.querySelector('b').textContent).toBe('First answer');
    expect(first.style.transform).toBe('');
    expect(first.hasAttribute('inert')).toBe(false);
    expect(document.getElementById('c').style.display).toBe('none');
    button.click();
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  test('updates visible model membership without resetting the current reading card', async () => {
    await scroll(920);
    document.getElementById('c').style.display = 'block';
    await flush();
    expect(Array.from(root.querySelectorAll('.response-cover-card')).map((card) => card.id)).toEqual(['a', 'b', 'c']);
    expect(document.getElementById('b').style.transform).toBe('translate3d(0, 0%, 0)');
    document.getElementById('a').style.display = 'none';
    await flush();
    expect(Array.from(root.querySelectorAll('.response-cover-card')).map((card) => card.id)).toEqual(['b', 'c']);
    expect(document.getElementById('b').style.transform).toBe('translate3d(0, 0%, 0)');
  });

  test('uses normal cards for previews, expanded panels and reduced motion', async () => {
    document.body.classList.add('llm-stream-preview-open');
    await flush();
    expect(root.querySelector('.response-cover-sticky')).toBeNull();
    document.body.classList.remove('llm-stream-preview-open');
    await flush();
    expect(root.querySelector('.response-cover-sticky')).not.toBeNull();
    document.getElementById('a').classList.add('llm-panel-expanded');
    await flush();
    expect(root.querySelector('.response-cover-sticky')).toBeNull();
    document.getElementById('a').classList.remove('llm-panel-expanded');
    await flush();
    motion.matches = true;
    cover.refresh();
    expect(root.querySelector('.response-cover-sticky')).toBeNull();
  });

  test('does not resurrect an externally removed card and restores safely on destruction', async () => {
    const removed = document.getElementById('b');
    removed.remove();
    await flush();
    expect(root.querySelector('.response-cover-sticky')).toBeNull();
    expect(removed.isConnected).toBe(false);
    expect(root.querySelector('#b')).toBeNull();
    expect(root.querySelector('#a').parentNode).toBe(root);
  });

  test('keeps the reading card when the viewport height changes', async () => {
    await scroll(920);
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 500 });
    window.dispatchEvent(new Event('resize'));
    await flush();
    expect(document.getElementById('b').style.transform).toBe('translate3d(0, 0%, 0)');
    expect(Number.parseFloat(root.style.getPropertyValue('--response-cover-height'))).toBeLessThanOrEqual(404);
  });
});
