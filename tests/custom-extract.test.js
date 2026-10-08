// Extract (Transport) for a Custom run: the same compact digest as for Debate, built from the run's
// part of the delivery journal.
const fs = require('fs');
const path = require('path');
const Digest = require('../shared/report-digest');

const T = 1700000000000;
const iso = (ms) => new Date(T + ms).toISOString();
const RUN = 'run-c';
const stage = (step) => Digest.customStageId(RUN, step);

const journal = [
  // An earlier Debate batch: not part of the Custom run.
  { at: iso(-5000), kind: 'batch_start', batchId: 'debate-run:r1:g0', stageId: 'stage-x', models: ['GPT'], requestIds: { GPT: 'q-old' } },
  { at: iso(-4000), kind: 'verified', model: 'GPT', requestId: 'q-old', chars: 10 },
  { at: iso(0), kind: 'custom_start', pipelineRunId: RUN, semiAuto: false,
    steps: [{ step: 0, label: 'Раунд 1', order: 'parallel', input: 'none', models: ['A', 'B'] },
      { step: 1, label: 'Раунд 2', order: 'parallel', input: 'previous', models: ['A'] }] },
  { at: iso(100), kind: 'batch_start', batchId: `${RUN}:r1:g0`, stageId: stage(0), models: ['A', 'B'], requestIds: { A: 'q1', B: 'q2' } },
  { at: iso(110), kind: 'prepared', model: 'A', requestId: 'q1', batchId: `${RUN}:r1:g0`, token: 'AO-a', chars: 50 },
  { at: iso(110), kind: 'prepared', model: 'B', requestId: 'q2', batchId: `${RUN}:r1:g0`, token: 'AO-b', chars: 50 },
  { at: iso(4000), kind: 'verified', model: 'A', requestId: 'q1', token: 'AO-a', chars: 300, status: 'SUCCESS' },
  { at: iso(9000), kind: 'no_answer', model: 'B', requestId: 'q2', token: 'AO-b', chars: 0, status: 'TIMEOUT' },
  { at: iso(9001), kind: 'custom_answer', pipelineRunId: RUN, step: 0, model: 'B', accepted: false, transportRequestId: 'q2' },
  { at: iso(9002), kind: 'custom_step', pipelineRunId: RUN, step: 0, accepted: 1, failed: 1 },
  { at: iso(9100), kind: 'batch_start', batchId: `${RUN}:r2:g0`, stageId: stage(1), models: ['A'], requestIds: { A: 'q3' } },
  { at: iso(12000), kind: 'verified', model: 'A', requestId: 'q3', token: 'AO-c', chars: 200, status: 'SUCCESS' },
  { at: iso(12001), kind: 'custom_step', pipelineRunId: RUN, step: 1, accepted: 1, failed: 0 },
  { at: iso(12002), kind: 'custom_end', pipelineRunId: RUN, stopReason: 'steps_done' }
];

test('the run is found and only its own journal is taken', () => {
  expect(Digest.latestCustomRunId(journal)).toBe(RUN);
  const own = Digest.customRunJournal(journal, RUN);
  expect(own.some((e) => e.requestId === 'q-old')).toBe(false);
  expect(own.filter((e) => e.kind === 'verified').map((e) => e.requestId)).toEqual(['q1', 'q3']);
});

test('a Custom run gives the same transport extract: steps as stages, its requests, its problems', () => {
  const own = Digest.customRunJournal(journal, RUN);
  const report = Digest.customFlowReport({ runId: RUN, delivery: { journal: own, diagnosis: { sends: [], batches: [] } } });
  expect(report.stageExecutions.map((s) => [s.stageId, s.label, s.actual.participants, s.durationMs])).toEqual([
    [stage(0), 'Раунд 1', ['A', 'B'], 8902], [stage(1), 'Раунд 2', ['A'], 2901]
  ]);
  const extract = Digest.extractTransport(report, 'Disput Flow test.json');
  const md = Digest.renderTransportMarkdown(extract);
  expect(md).not.toContain('[object Object]');
  expect(md).toContain('stage-1');
  expect(md).toContain('stage-2');
  expect(md).not.toContain('q-old');
  expect(Buffer.byteLength(md)).toBeLessThan(Buffer.byteLength(JSON.stringify({ journal })) * 20);
});

test('a journal without a Custom run has nothing to extract', () => {
  expect(Digest.latestCustomRunId(journal.slice(0, 2))).toBeNull();
  expect(() => Digest.customFlowReport({ runId: 'none', delivery: { journal } })).toThrow('custom_start');
});

test('the page routes Extract of a run without Debate stages to the latest Custom run; Custom batches carry their own stage', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
  const handler = source.slice(source.indexOf("const button = event.target.closest('#disput-extract')"));
  expect(handler.slice(0, 4000)).toContain('const runId = window.ReportDigest.latestCustomRunId(report.delivery?.journal);');
  expect(handler.slice(0, 4000)).toContain('const extract = window.ReportDigest.extractTransport(source, sourceFile);');
  expect(source).toContain("stageId: window.ReportDigest?.customStageId?.(runContext.pipelineRunId, step) || `custom:${runContext.pipelineRunId}:s${step + 1}`,");
});
