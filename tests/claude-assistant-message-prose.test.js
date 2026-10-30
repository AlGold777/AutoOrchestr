/** @jest-environment node */
const fs = require('fs');
const { JSDOM } = require('jsdom');
const Output = require('../disput/basic-output');

const answer = '{"items":[{"id":"q1","type":"yesno","question":"Берём?","required":true}]}';
const html = (text) => `<div data-testid="assistant-message" data-cds="AssistantMessage">
  <h3 class="sr-only">Claude responded: ${answer.slice(0, 40)}</h3>
  <div class="flex min-w-0 flex-col">
    <div class="group/status flex"><span>Expanding the answer</span><span class="sr-only">Expanding the answer</span></div>
    <div class="min-w-0"><div class="grid"><div class="contents"><div class="prose"><p>${text}</p></div></div></div></div>
  </div></div>`;

describe('Claude assistant message in the 2026-10 layout', () => {
  test('the answer element is div.prose, without the screen-reader title and the status row', () => {
    const { document } = new JSDOM(html(answer)).window;
    const found = document.querySelectorAll('[data-testid="assistant-message"] div.prose');
    expect(found).toHaveLength(1);
    expect(found[0].textContent).toBe(answer);
  });

  test('every Claude selector list names the new layout', () => {
    for (const file of ['background/job-orchestrator.js', 'content-scripts/content-claude.js', 'selectors/config-bundle.json']) {
      expect(fs.readFileSync(require.resolve(`../${file}`), 'utf8')).toContain('assistant-message');
    }
    expect(fs.readFileSync(require.resolve('../content-scripts/content-claude.js'), 'utf8')).toContain('.sr-only, [class*="group/status"]');
  });
});

describe('a JSON answer shown by the page with typographic quotes', () => {
  test('is read as the same object', () => {
    const typographic = answer.replace(/"/g, (_, i) => (i % 2 ? '”' : '“'));
    expect(Output.parseJsonAnswer(typographic)).toEqual(JSON.parse(answer));
  });

  test('text that is not JSON stays null', () => {
    expect(Output.parseJsonAnswer('responded: “items”')).toBeNull();
  });
});
