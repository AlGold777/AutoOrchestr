/** @jest-environment node */
// Automation Lab runs must deliver model results only to the tab that started them, stamped with
// sourceView "automation", so an open Pipeline/Results page never renders their raw framed answers.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'background', 'ui-broadcast.js'), 'utf8');
const RESULTS_SRC = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

function load({ session, resultsTabId = 11, failTabs = [] }) {
  const sent = [];
  const broadcast = [];
  const sandbox = {
    console,
    jobState: { session, llms: {} },
    resultsTabId,
    isValidTabId: (id) => Number.isInteger(id) && id > 0,
    TabMapManager: { entries: () => [], get: () => null },
    chrome: {
      runtime: { lastError: null, sendMessage: (message, cb) => { broadcast.push(message); cb && cb(); } },
      tabs: {
        sendMessage: (tabId, message, cb) => {
          sent.push({ tabId, message });
          if (typeof cb === 'function') {
            sandbox.chrome.runtime.lastError = failTabs.includes(tabId) ? { message: 'Receiving end does not exist' } : null;
            cb();
            sandbox.chrome.runtime.lastError = null;
            return undefined;
          }
          return Promise.resolve();
        }
      }
    }
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { sandbox, sent, broadcast };
}

describe('automation result routing', () => {
  test('automation results go to the origin tab only, stamped', () => {
    const { sandbox, sent, broadcast } = load({ session: { sourceView: 'automation', originTabId: 42, pipelineRunId: 'EXEC-1' }, resultsTabId: 11 });
    sandbox.sendMessageToResultsTab({ type: 'LLM_PARTIAL_RESPONSE', llmName: 'GPT', answer: 'x' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ tabId: 42, message: { sourceView: 'automation', pipelineRunId: 'EXEC-1', llmName: 'GPT' } });
    expect(broadcast).toHaveLength(0);
  });

  test('if the origin tab is gone the fallback broadcast is still stamped', () => {
    const { sandbox, broadcast } = load({ session: { sourceView: 'automation', originTabId: 42, pipelineRunId: 'EXEC-1' }, failTabs: [42] });
    sandbox.sendMessageToResultsTab({ type: 'LLM_PARTIAL_RESPONSE', llmName: 'GPT', answer: 'x' });
    expect(broadcast).toHaveLength(1);
    expect(broadcast[0].sourceView).toBe('automation');
  });

  test('pipeline runs keep the existing results-tab behaviour', () => {
    const { sandbox, sent } = load({ session: { sourceView: 'pipeline', originTabId: 42 }, resultsTabId: 11 });
    sandbox.sendMessageToResultsTab({ type: 'LLM_PARTIAL_RESPONSE', llmName: 'GPT', answer: 'x' });
    expect(sent).toHaveLength(1);
    expect(sent[0].tabId).toBe(11);
    expect(sent[0].message.sourceView).toBeUndefined();
  });

  test('the Pipeline/Results message listener ignores automation messages', () => {
    expect(RESULTS_SRC).toMatch(/if \(message\?\.sourceView === 'automation'\) return false;/);
  });

  test('startProcess records the origin tab for the run', () => {
    const orchestrator = fs.readFileSync(path.join(__dirname, '..', 'background', 'job-orchestrator.js'), 'utf8');
    expect(orchestrator).toContain('jobState.session.originTabId = Number.isInteger(resultsTab) ? resultsTab : null;');
  });
});
