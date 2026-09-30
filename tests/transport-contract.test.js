/** @jest-environment node */
// Transport contract between the Pipeline panel and the background.
const fs = require('fs');
const path = require('path');
const Contract = require('../shared/transport-contract.js');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

describe('TransportContract', () => {
  test('completion is independent of the status name alone', () => {
    expect(Contract.classifyCompletion('SUCCESS', 'text')).toBe('complete');
    expect(Contract.classifyCompletion('SUCCESS', '')).toBe('failed');
    expect(Contract.classifyCompletion('STREAM_TIMEOUT', 'cut')).toBe('partial');
    expect(Contract.classifyCompletion('PARTIAL', 'cut')).toBe('partial');
    expect(Contract.classifyCompletion('ERROR', 'some text')).toBe('partial');
    expect(Contract.classifyCompletion('ERROR', '')).toBe('failed');
    expect(Contract.classifyCompletion('STOPPED', 'x')).toBe('cancelled');
    expect(Contract.classifyCompletion('GENERATING', 'x')).toBe('pending');
  });

  test('every final status produced by the background is terminal', () => {
    const orchestrator = read('background/job-orchestrator.js');
    const fn = orchestrator.slice(orchestrator.indexOf('function deriveFailureFinalStatus'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    const produced = new Set((body.match(/'[A-Z_]{4,}'/g) || []).map((value) => value.slice(1, -1)));
    ['SUCCESS', 'PARTIAL', 'STREAM_TIMEOUT_HIDDEN'].forEach((status) => produced.add(status));
    produced.forEach((status) => {
      expect([status, Contract.isTerminalStatus(status)]).toEqual([status, true]);
    });
  });

  test('panel deadline is never shorter than the tab generation limit', () => {
    const config = read('content-scripts/pipeline-config.js');
    // Standard and Long hardMax / streamStartTimeout as declared by the tab.
    expect(config).toContain(`hardMax: ${Contract.CONTENT_LIMITS_MS.standard.hardMax}`);
    expect(config).toContain(`hardMax: ${Contract.CONTENT_LIMITS_MS.long.hardMax}`);
    expect(config).toContain(`streamStartTimeout: ${Contract.CONTENT_LIMITS_MS.long.streamStart}`);
    const hardMaxValues = (config.match(/hardMax: (\d+)/g) || []).map((m) => Number(m.split(': ')[1]));
    expect(Math.max(...hardMaxValues)).toBe(Contract.CONTENT_LIMITS_MS.long.hardMax);
    expect(Contract.resolvePanelWaitTimeoutMs('long', 240000)).toBeGreaterThan(Contract.CONTENT_LIMITS_MS.long.hardMax);
    expect(Contract.resolvePanelWaitTimeoutMs('standard', 240000)).toBeGreaterThan(Contract.CONTENT_LIMITS_MS.standard.hardMax);
    expect(Contract.resolvePanelWaitTimeoutMs('standard', 5000000)).toBe(5000000);
  });

  test('request ids are unique', () => {
    const ids = new Set(Array.from({ length: 200 }, () => Contract.makeTransportRequestId()));
    expect(ids.size).toBe(200);
  });
});

describe('background transport identity', () => {
  const orchestrator = read('background/job-orchestrator.js');

  test('every panel-bound answer message carries the producing entry identity', () => {
    const blocks = orchestrator.split("type: 'LLM_PARTIAL_RESPONSE',").slice(1).map((chunk) => chunk.slice(0, 600));
    expect(blocks.length).toBeGreaterThanOrEqual(7);
    blocks.forEach((block) => expect(block).toContain('...transportIdentityFor('));
  });

  test('the final answer is explicitly terminal and a post-terminal update is a revision', () => {
    expect(orchestrator).toMatch(/status: finalStatus,\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*terminal: true,/);
    expect(orchestrator).toContain('revision: true,');
  });

  test('the panel request id is stored on the model entry and survives compaction', () => {
    expect(orchestrator).toContain('jobState.llms[llmName].transportRequestId = String(pipelineContext?.transportRequestIds?.[llmName]');
    const PipelineFSM = require('../shared/pipeline-fsm.js');
    const compacted = PipelineFSM.compactJobStateForStorage({
      prompt: 'shared',
      session: { startTime: 1, promptsByModel: { GPT: 'role prompt [[AO-abcdef]]' }, pipelineContext: { pipelineRunId: 'run-1' } },
      llms: { GPT: { llmName: 'GPT', transportRequestId: 'treq-1' } }
    });
    expect(compacted.llms.GPT.transportRequestId).toBe('treq-1');
    expect(compacted.session.promptsByModel.GPT).toBe('role prompt [[AO-abcdef]]');
    expect(compacted.session.pipelineContext).toEqual({ pipelineRunId: 'run-1' });
  });

  test('global state snapshot exposes the request identity for recovery', () => {
    expect(read('background/ui-broadcast.js')).toContain('transportRequestId: entry?.transportRequestId || null');
  });
});
