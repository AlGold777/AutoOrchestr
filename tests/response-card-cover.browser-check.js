// Run: node tests/response-card-cover.browser-check.js
// Actual markup/CSS regression check: preview height rules must not disable or shrink the deck.
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const project = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(project, file), 'utf8');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const css = [...read('styles.css').matchAll(/@import url\("(styles\/[^"?]+\.css)(?:\?[^\"]*)?"\)/g)]
      .map((match) => read(match[1])).join('\n') + '\n' + read('styles/response-card-cover.css');
    const html = read('result_new.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<link[^>]*>/g, '').replace('</head>', `<style>${css}</style></head>`);
    await page.setContent(html);
    await page.addScriptTag({ path: path.join(project, 'results/response-card-cover.js') });
    await page.evaluate(() => {
      document.body.className = 'llm-stream-preview-open';
      const root = document.querySelector('.llm-results');
      root.classList.add('view-grid');
      window.originalCards = [...root.querySelectorAll('.llm-panel')];
      originalCards.forEach((card, index) => {
        card.style.display = index < 7 ? '' : 'none';
        // A restored answer in the still-active preview is one of the affected paths.
        if (index === 0) card.classList.add('llm-panel-session-restored');
        card.querySelector('.output').innerHTML = '<p>Long model answer</p>'.repeat(80);
      });
      window.cover = ResultsResponseCardCover.create(root);
      window.originalSticky = root.querySelector('.response-cover-sticky');
    });
    const snapshot = () => page.evaluate(() => {
      const root = document.querySelector('.llm-results');
      const sticky = root.querySelector('.response-cover-sticky');
      return {
        columns: Number(root.style.getPropertyValue('--response-cover-columns')),
        height: Number.parseFloat(root.style.getPropertyValue('--response-cover-height')),
        top: sticky?.getBoundingClientRect().top,
        groups: [...root.querySelectorAll('.response-cover-group')].map((group) => ({
          top: group.getBoundingClientRect().top,
          visible: getComputedStyle(group).visibility === 'visible',
          cards: [...group.children].map((card) => ({
            height: card.getBoundingClientRect().height,
            scrollable: card.querySelector('.output').scrollHeight > card.querySelector('.output').clientHeight,
            inert: card.inert
          }))
        }))
      };
    });
    const scroll = async (progress) => {
      await page.evaluate((progress) => {
        const root = document.querySelector('.llm-results');
        scrollTo(0, root.getBoundingClientRect().top + scrollY
          - Number.parseFloat(root.style.getPropertyValue('--response-cover-top')) + progress * innerHeight * 0.92);
      }, progress);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      return snapshot();
    };
    let state = await scroll(0.25);
    assert.equal(state.columns, 3);
    assert.equal(state.groups.length, 3);
    assert.ok(state.groups[0].visible && !state.groups[1].visible);
    state.groups[0].cards.forEach((card) => {
      assert.ok(Math.abs(card.height - state.height) < 1, 'preview/restored cards fill the deck');
      assert.ok(card.scrollable && !card.inert);
    });
    state = await scroll(0.57);
    assert.ok(state.groups[0].top < state.top);
    assert.ok(state.groups[1].top > state.top && state.groups[1].top < state.top + state.height);
    assert.ok(state.groups[1].cards.every((card) => card.inert));
    state = await scroll(0.9);
    assert.ok(!state.groups[0].visible && state.groups[1].visible);
    assert.ok(Math.abs(state.groups[1].top - state.top) < 1);
    await page.evaluate(() => {
      document.body.classList.remove('llm-stream-preview-open');
      document.body.classList.add('prompt-submitted');
      cover.refresh();
    });
    assert.ok(await page.evaluate(() => document.querySelector('.response-cover-sticky') === originalSticky));
    state = await scroll(0.25);
    assert.ok(state.groups[0].visible && !state.groups[1].visible, 'reverse scroll restores the first row');
    await page.evaluate(() => {
      const root = document.querySelector('.llm-results');
      root.classList.replace('view-grid', 'view-stack');
      cover.refresh();
    });
    state = await scroll(0.9);
    assert.equal(state.columns, 1);
    assert.ok(state.groups[1].visible);
    await page.setViewportSize({ width: 390, height: 500 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    state = await snapshot();
    assert.ok(state.height > 0 && state.height < 500);
    await page.evaluate(() => cover.destroy());
    assert.ok(await page.evaluate(() => originalCards.every((card, index) => document.querySelector('.llm-results').children[index] === card)));
    console.log('PASS: preview/restored grid, full-height cards, overlap, reverse, submitted transition, stack, mobile, original nodes');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
