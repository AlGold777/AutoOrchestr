const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

function compareDocumentOrder(a, b) {
  if (a === b) return 0;
  const NodeCtor = a?.ownerDocument?.defaultView?.Node;
  const pos = a.compareDocumentPosition(b);
  if (pos & NodeCtor.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (pos & NodeCtor.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

function latestClaudeTextFromBundle(document) {
  const bundle = JSON.parse(read('selectors', 'config-bundle.json'));
  const selectors = bundle.Claude.emergencyFallbacks.response;
  const seen = new Set();
  const nodes = [];
  for (const selector of selectors) {
    document.querySelectorAll(selector).forEach((node) => {
      if (seen.has(node)) return;
      seen.add(node);
      nodes.push(node);
    });
  }
  nodes.sort(compareDocumentOrder);
  const latest = nodes[nodes.length - 1];
  return (latest?.textContent || '').trim();
}

describe('Claude latest response selection', () => {
  test('selects the latest assistant turn even when a user turn follows it', () => {
    const dom = new JSDOM(`
      <main>
        <div data-testid="conversation-turn" data-author-role="assistant">
          <div class="standard-markdown grid-cols-1">Previous Claude answer</div>
        </div>
        <div data-testid="conversation-turn" data-author-role="user">Follow-up prompt</div>
        <div data-testid="conversation-turn" data-author-role="assistant">
          <div class="standard-markdown grid-cols-1">Latest Claude answer</div>
        </div>
        <div data-testid="conversation-turn" data-author-role="user">Trailing user draft</div>
      </main>
    `);

    expect(dom.window.document.querySelectorAll(
      'div[data-testid="conversation-turn"][data-author-role="assistant"]:last-of-type div.standard-markdown.grid-cols-1'
    )).toHaveLength(0);
    expect(latestClaudeTextFromBundle(dom.window.document)).toBe('Latest Claude answer');
  });

  test('content extractor merges primary and fallback candidates and sorts by DOM order', () => {
    const source = read('content-scripts', 'content-claude.js');
    expect(source).toContain('return nodes.sort(compareClaudeDocumentOrder);');
    expect(source).toContain('pool.sort(compareClaudeDocumentOrder);');
    expect(source).not.toContain('if (primary.length) return primary;');
  });

  test('captures submit confirmation baseline before sending and reuses it for retries', () => {
    const source = read('content-scripts', 'content-claude.js');
    const captureAt = source.indexOf('const sendBaseline = captureClaudeSendBaseline(inputArea);');
    const firstSendAt = source.indexOf('await tryEnterSend({ ctrlKey: true });', captureAt);
    expect(captureAt).toBeGreaterThan(-1);
    expect(firstSendAt).toBeGreaterThan(captureAt);
    expect(source.match(/confirmClaudeSend\(sendBaseline, inputArea\)/g)).toHaveLength(4);
    expect(source).not.toContain('const baseline = claudeSubmitConfirmation?.capture?.({');
  });

  test('Claude transport failures carry an empty answer payload', () => {
    const source = read('content-scripts', 'content-claude.js');
    const listenerAt = source.indexOf("message?.type === 'GET_ANSWER' || message?.type === 'GET_FINAL_ANSWER'");
    const catchAt = source.indexOf(".catch((err) => {", listenerAt);
    const catchBlock = source.slice(catchAt, source.indexOf('.finally(releaseActive)', catchAt));
    expect(listenerAt).toBeGreaterThan(-1);
    expect(catchAt).toBeGreaterThan(listenerAt);
    expect(catchBlock).toContain("answer: ''");
    expect(catchBlock).not.toContain('answer: `Error: ${errorMessage}`');
  });

  test('missing direct send confirmation does not abort answer extraction', () => {
    const source = read('content-scripts', 'content-claude.js');
    const deferredAt = source.indexOf("label: 'Send confirmation deferred'");
    const pipelineAt = source.indexOf('await tryClaudePipeline(prompt', deferredAt);
    const recoveredAt = source.indexOf("submitEvidence: 'fresh_answer_after_pre_send_anchor'", pipelineAt);
    expect(deferredAt).toBeGreaterThan(-1);
    expect(pipelineAt).toBeGreaterThan(deferredAt);
    expect(recoveredAt).toBeGreaterThan(pipelineAt);
    expect(source.slice(deferredAt, pipelineAt)).not.toContain("throw { type: 'send_failed'");
    expect(source.slice(recoveredAt, recoveredAt + 1400)).toContain("type: 'PROMPT_SUBMITTED'");
    expect(source.slice(recoveredAt, recoveredAt + 1400)).toContain('freshTurnEvidence: true');
    expect(source.slice(pipelineAt, recoveredAt)).toContain('extractClaudeResponseFromDOM(prompt, baselineElement)');
    expect(source.slice(recoveredAt, recoveredAt + 1400)).toContain('await Promise.resolve(chrome.runtime.sendMessage({');
  });
});

describe('C10: chat-loader is history loading, not a generation end marker', () => {
  test('Claude and Qwen have no chat-loader end marker in the bundle (JSON and runtime JS)', () => {
    const bundle = JSON.parse(read('selectors', 'config-bundle.json'));
    expect(JSON.stringify(bundle.Claude)).not.toContain('chat-loader');
    expect(JSON.stringify(bundle.Qwen)).not.toContain('chat-loader');
    const js = read('selectors', 'config-bundle.js');
    const markerBlocks = js.match(/"endGenerationMarkers": \[[^\]]*\]/g) || [];
    expect(markerBlocks.some((block) => block.includes('chat-loader'))).toBe(false);
  });
});
