/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// Same loader-aware CSS resolution as the debate tests.
const readResolvedCss = () => {
  const loader = read('styles.css');
  const modules = [...loader.matchAll(/@import url\("(styles\/[^"]+\.css)"\)/g)].map((m) => read(m[1]));
  return [loader, ...modules].join('\n');
};

describe('pipeline panel markup', () => {
  const html = read('pipeline_panel.html');

  test('session tabs are hidden but kept as the session state holder', () => {
    expect(html).toMatch(/<div class="debate-session-left" hidden>/);
    expect(html).toContain('id="debate-session-tabs"');
  });

  test('session actions stay in the bar', () => {
    const bar = html.slice(html.indexOf('id="debate-session-bar"'), html.indexOf('id="debate-model-cards"'));
    ['debate-session-fullscreen-btn', 'debate-session-copy-btn', 'debate-session-export-btn', 'debate-session-export-txt-btn', 'debate-session-clear-btn']
      .forEach((id) => expect(bar).toContain(`id="${id}"`));
  });

  test('fullscreen is an icon immediately before copy', () => {
    const page = new DOMParser().parseFromString(html, 'text/html');
    const button = page.getElementById('debate-session-fullscreen-btn');
    expect(button.nextElementSibling.id).toBe('debate-session-copy-btn');
    expect(button.querySelector('i').classList.contains('ti-maximize')).toBe(true);
    expect(button.textContent.trim()).toBe('');
  });

  test('the duplicate pause button is gone: the main Run button pauses and resumes', () => {
    expect(html).not.toContain('id="debate-auto-pause-btn"');
    expect(html).toContain('id="debate-run-toggle-btn"');
  });
});

describe('pipeline feed layout styles', () => {
  const css = readResolvedCss();

  test('collapsed top bar hides logo and model labels and is scoped to the pipeline page', () => {
    expect(css).toMatch(/\.pipeline-page\.pipeline-top-collapsed \.top-control-bar \.logo-badge,\s*\.pipeline-page\.pipeline-top-collapsed \.top-control-bar \.llm-button-label \{\s*display: none;/);
    expect(css).toContain('.pipeline-page.pipeline-top-collapsed .top-bar-right .debate-session-actions');
  });

  test('collapsed top bar: 14px between icons, 7px tighter to the edge and to the input section', () => {
    expect(css).toMatch(/pipeline-top-collapsed \.top-control-bar \.models-row-header \.llm-buttons \{\s*gap: 14px;/);
    expect(css).toMatch(/pipeline-top-collapsed \.top-control-bar \{[^}]*top: 5px;\s*margin: -7px 0 -11px 0;/);
    expect(css).toMatch(/pipeline-top-collapsed \.top-bar-right \.debate-session-actions \{\s*margin-right: 14px;/);
  });

  test('compact input trims 4px from the msg-header padding', () => {
    expect(css).toMatch(/is-feed-input-compact \.msg-header \{\s*padding-top: 2px;\s*padding-bottom: 0;/);
  });

  test('the feed stays inside the composer: no full-viewport width', () => {
    expect(css).not.toMatch(/\.pipeline-page \.debate-model-cards\s*\{[^}]*(100vw|50vw)/);
  });

  test('only the composer is wider on the pipeline page; the top bar column keeps the main page width', () => {
    expect(css).toMatch(/\.pipeline-page \{\s*--pipeline-main-max-width: 1280px;/);
    // .main-inner (the column of the top bar) must not be widened here: the bar would differ from the main page.
    expect(css).not.toMatch(/\.pipeline-page \.main-inner\s*\{/);
    expect(css).toMatch(/\.pipeline-page \.app-main \{\s*container-type: inline-size;/);
    expect(css).toMatch(/\.pipeline-page \.prompt-container\.prompt-sandwich:not\(\.is-debate-feed-wide-expanded\) \{[^}]*width: var\(--pipeline-composer-width\);[^}]*margin-left: calc\(\(100% - var\(--pipeline-composer-width\)\) \/ 2\);/);
  });

  test('compact moderator input is one line unless focused', () => {
    expect(css).toMatch(/is-feed-input-compact \.moderator-input textarea#modTa:not\(:focus\) \{\s*height: 20px !important;/);
  });

  test('live printing signal is a one-line chip in the card header', () => {
    expect(css).toMatch(/\.debate-model-card-header \.debate-model-card-printing \{[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis;/);
  });
});

describe('debateFeedLayout controller', () => {
  const source = read('results.js');
  const start = source.indexOf('const debateFeedLayout = (() => {');
  const end = source.indexOf('})();', start) + '})();'.length;
  const controllerSource = source.slice(start, end);

  let cards;
  let composer;
  let bar;
  let actions;
  let topBarRight;
  let layout;
  let content;

  const build = () => {
    document.body.className = 'pipeline-page';
    document.body.innerHTML = `
      <div class="top-control-bar"><div class="top-bar-right"><button id="telemetry"></button></div></div>
      <div class="prompt-container prompt-sandwich debate-composer has-debate-feed">
        <div class="debate-session-bar" id="debate-session-bar">
          <div class="debate-session-actions"><button id="copy"></button></div>
        </div>
        <div id="debate-model-cards"></div>
        <div class="moderator-input" id="moderator-input"></div>
      </div>`;
    cards = document.getElementById('debate-model-cards');
    composer = document.querySelector('.debate-composer');
    bar = document.getElementById('debate-session-bar');
    actions = bar.querySelector('.debate-session-actions');
    topBarRight = document.querySelector('.top-bar-right');
    const topBar = document.querySelector('.top-control-bar');
    const moderator = document.getElementById('moderator-input');
    const isTop = () => document.body.classList.contains('pipeline-top-collapsed');
    const isCompact = () => composer.classList.contains('is-feed-input-compact');
    Object.defineProperty(cards, 'scrollHeight', { get: () => content });
    Object.defineProperty(cards, 'clientHeight', { get: () => 300 + (isCompact() ? 60 : 0) + (isTop() ? 50 : 0) });
    Object.defineProperty(moderator, 'offsetHeight', { get: () => (isCompact() ? 40 : 100) });
    Object.defineProperty(topBar, 'offsetHeight', { get: () => (isTop() ? 40 : 90) });
    layout = new Function(
      'debateModelCards', 'debateSessionBar',
      `${controllerSource}\nreturn debateFeedLayout;`
    )(cards, bar);
  };

  beforeEach(() => {
    window.requestAnimationFrame = (cb) => { cb(); return 1; };
    global.requestAnimationFrame = window.requestAnimationFrame;
    content = 500;
    build();
  });

  test('overflow shrinks the moderator input first, the top bar stays expanded', () => {
    layout.evaluate();
    expect(composer.classList.contains('is-feed-input-compact')).toBe(true);
    expect(document.body.classList.contains('pipeline-top-collapsed')).toBe(false);
  });

  test('scrolling down collapses the top bar and moves the session actions into it', () => {
    layout.evaluate();
    cards.scrollTop = 100;
    layout.evaluate();
    expect(document.body.classList.contains('pipeline-top-collapsed')).toBe(true);
    expect(actions.parentElement).toBe(topBarRight);
    expect(topBarRight.firstElementChild).toBe(actions);
    expect(document.documentElement.style.getPropertyValue('--pipeline-top-gain')).toBe('50px');
  });

  test('returning to the top of the feed restores the bar and the actions', () => {
    layout.evaluate();
    cards.scrollTop = 100;
    layout.evaluate();
    cards.scrollTop = 0;
    layout.evaluate();
    expect(document.body.classList.contains('pipeline-top-collapsed')).toBe(false);
    expect(actions.parentElement).toBe(bar);
    expect(composer.classList.contains('is-feed-input-compact')).toBe(true);
  });

  test('hysteresis keeps the compact input until the content clearly fits', () => {
    layout.evaluate();
    content = 330; // fits the compact box (360) but not the default one (300)
    layout.evaluate();
    expect(composer.classList.contains('is-feed-input-compact')).toBe(true);
    content = 200;
    layout.evaluate();
    expect(composer.classList.contains('is-feed-input-compact')).toBe(false);
  });

  test('a feed that fits changes nothing', () => {
    content = 200;
    layout.evaluate();
    expect(composer.classList.contains('is-feed-input-compact')).toBe(false);
    expect(document.body.classList.contains('pipeline-top-collapsed')).toBe(false);
  });

  test('no feed resets both steps', () => {
    layout.evaluate();
    cards.scrollTop = 100;
    layout.evaluate();
    composer.classList.remove('has-debate-feed');
    layout.evaluate();
    expect(document.body.classList.contains('pipeline-top-collapsed')).toBe(false);
    expect(composer.classList.contains('is-feed-input-compact')).toBe(false);
    expect(actions.parentElement).toBe(bar);
  });
});

describe('post-terminal revision label', () => {
  const source = read('results.js');
  const start = source.indexOf('function shortenRevisionSource(source) {');
  const end = source.indexOf('function appendPostTerminalAnswerRevision', start);
  const shorten = new Function(`${source.slice(start, end)}\nreturn shortenRevisionSource;`)();

  test('known recovery source becomes a short word', () => {
    expect(shorten('GLOBAL_STATE_ANSWER_RECOVERY')).toBe('Recovery');
    expect(shorten('unknown')).toBe('Unknown');
  });

  test('long sources are cut to 20 characters plus three dots', () => {
    const label = shorten('late_partial_response');
    expect(label).toBe('Late partial respons...');
    expect(label.length).toBe(23);
  });

  test('technical updates live in one badge popover with tabs', () => {
    const css = readResolvedCss();
    expect(css).toMatch(/\.post-terminal-badge-wrap \{[^}]*position: relative;/);
    expect(css).toMatch(/\.post-terminal-popover \{[^}]*position: absolute;/);
    expect(css).toMatch(/\.post-terminal-popover\[hidden\]/);
    expect(css).toContain('.post-terminal-tab.active');
  });
});
