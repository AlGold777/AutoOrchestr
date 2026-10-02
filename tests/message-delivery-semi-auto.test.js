// Delivery report for the semi-automatic pipeline: what the screen shows vs. what the
// stage wait accepted, the moderator's actions, run context and the age of a problem.
const Diagnosis = require('../shared/message-delivery-diagnosis.js');

const T0 = Date.parse('2026-10-01T18:55:34.880Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
const base = (extra = []) => [
  { at: at(0), kind: 'prepared', model: 'Perplexity', token: 'AO-aw4uky', requestId: 'treq-p', chars: 136, batchId: '' },
  { at: at(0.06), kind: 'batch_start', batchId: 'manual:a1', waitId: 'wait-1', models: ['Perplexity'], requestIds: { Perplexity: 'treq-p' }, timeoutMs: 1110000, manual: true, runMode: 'semi_auto', template: 'Test' },
  { at: at(17), kind: 'first_text', model: 'Perplexity', requestId: 'treq-p', token: 'AO-aw4uky', ms: 17000, chars: 312 },
  ...extra
];

describe('display_desync', () => {
  test('text shown from the global state but not accepted by the wait is reported, with source and reason', () => {
    const journal = base([{ at: at(40), kind: 'displayed', model: 'Perplexity', requestId: 'treq-p', chars: 1200, source: 'global_state_hydrate', final: false, acceptedByWait: false, rejectReason: 'not_final' }]);
    const d = Diagnosis.diagnose(journal, { now: T0 + 80000 });
    const problem = d.problems.find((p) => p.code === 'display_desync');
    expect(problem).toBeTruthy();
    expect(problem.reason).toContain('1200');
    expect(problem.reason).toContain('global_state_hydrate');
    expect(problem.reason).toContain('not_final');
    expect(problem.ageMs).toBe(80000);
    // Replaces the bare "Ответ ещё не получен" for this request.
    expect(d.problems.find((p) => p.code === 'waiting')).toBeUndefined();
    expect(d.sends[0].displayed).toHaveLength(1);
  });

  test('a displayed answer the wait accepted, or no open wait, is not a desync', () => {
    const accepted = base([{ at: at(40), kind: 'displayed', model: 'Perplexity', requestId: 'treq-p', chars: 1200, source: 'global_state_hydrate', final: true, acceptedByWait: true }]);
    expect(Diagnosis.diagnose(accepted, { now: T0 + 80000 }).problems.find((p) => p.code === 'display_desync')).toBeUndefined();
    const noWait = base([{ at: at(40), kind: 'displayed', model: 'Perplexity', requestId: 'treq-p', chars: 1200, source: 'global_state_hydrate', final: false, acceptedByWait: null }]);
    expect(Diagnosis.diagnose(noWait, { now: T0 + 80000 }).problems.find((p) => p.code === 'display_desync')).toBeUndefined();
  });

  test('a plain waiting problem says what was seen last', () => {
    const d = Diagnosis.diagnose(base([{ at: at(20), kind: 'text_progress', model: 'Perplexity', requestId: 'treq-p', chars: 312, ms: 20000 }]), { now: T0 + 30000 });
    const waiting = d.problems.find((p) => p.code === 'waiting');
    expect(waiting.reason).toContain('312');
  });
});

describe('semi-automatic context and moderator actions', () => {
  test('batch carries run mode, template and what the moderator skipped', () => {
    const journal = base([
      { at: at(50), kind: 'moderator_get_it', surface: 'pipeline', models: ['Perplexity'], failedOnly: false },
      { at: at(51), kind: 'get_it_result', surface: 'pipeline', model: 'Perplexity', status: 'manual_ping_sent' },
      { at: at(60), kind: 'moderator_stage_close', answered: ['Le Chat'], skipped: ['Perplexity'], stillWaiting: 0 },
      { at: at(60.1), kind: 'batch_end', batchId: 'manual:a1', waitId: 'wait-1', outcome: 'moderator_closed', skipped: ['Perplexity'], missing: ['Perplexity'], durationMs: 60000 }
    ]);
    const d = Diagnosis.diagnose(journal, { now: T0 + 90000 });
    expect(d.batches[0]).toMatchObject({ runMode: 'semi_auto', template: 'Test', outcome: 'moderator_closed', skipped: ['Perplexity'] });
    expect(d.moderator.map((e) => e.kind)).toEqual(['moderator_get_it', 'get_it_result', 'moderator_stage_close']);
    // A moderator close is not a timeout.
    expect(d.problems.find((p) => p.code === 'batch_timeout')).toBeUndefined();
  });

  test('engine pauses are listed; a failed stage is a problem with age and a next step', () => {
    const journal = [
      { at: at(10), kind: 'run_paused', reason: 'stage_done', stage: 'canvas-r1', gate: null, asks: 0, verdict: null },
      { at: at(40), kind: 'run_paused', reason: 'ask', stage: 'canvas-r2', gate: null, asks: 1, verdict: 'issues_found' },
      { at: at(41), kind: 'owner_answer', stage: 'canvas-r2', answered: 1, asked: 1 },
      { at: at(70), kind: 'run_paused', reason: 'stage_failed', stage: 'canvas-r3', gate: null, asks: 0, verdict: null }
    ];
    const d = Diagnosis.diagnose(journal, { now: T0 + 100000 });
    expect(d.moderator.map((e) => e.kind)).toEqual(['run_paused', 'run_paused', 'owner_answer', 'run_paused']);
    const failed = d.problems.filter((p) => p.code === 'stage_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ severity: 'warning', ageMs: 30000, reason: 'canvas-r3' });
    expect(failed[0].title).toContain('canvas-r3');
    expect(failed[0].hint).toContain('Get it');
  });
});

describe('report (9): text received, request closed empty', () => {
  const journal = [
    { at: at(0), kind: 'prepared', model: 'DeepSeek', token: 'AO-ds1111', requestId: 'treq-ds', chars: 599, batchId: '' },
    { at: at(0.01), kind: 'batch_start', batchId: 'stage-1:a1', waitId: 'wait-1', models: ['DeepSeek'], requestIds: { DeepSeek: 'treq-ds' }, runMode: 'auto', template: 'Universal' },
    { at: at(15), kind: 'dispatch', model: 'DeepSeek', requestId: 'treq-ds', phase: 'submitted', ms: 15255, dispatchId: 'D:1' },
    { at: at(55), kind: 'first_text', model: 'DeepSeek', requestId: 'treq-ds', ms: 55380, chars: 2995 },
    { at: at(204), kind: 'empty_answer', model: 'DeepSeek', requestId: 'treq-ds', token: 'AO-ds1111', ms: 204842, chars: 0, completion: 'failed', status: 'NO_SEND', reason: 'send_failed', detail: 'send_failed: DeepSeek send not confirmed' }
  ];

  test('an empty terminal after received text is the problem text_lost, with sizes and the reason', () => {
    const d = Diagnosis.diagnose(journal, { now: T0 + 300000 });
    const lost = d.problems.find((p) => p.code === 'text_lost');
    expect(lost).toMatchObject({ severity: 'critical', model: 'DeepSeek' });
    expect(lost.reason).toContain('2995');
    expect(lost.reason).toContain('NO_SEND');
    expect(lost.hint).toContain('Get it');
  });

  test('an empty terminal without any received text stays an ordinary empty answer', () => {
    const quiet = journal.filter((event) => event.kind !== 'first_text');
    const d = Diagnosis.diagnose(quiet, { now: T0 + 300000 });
    expect(d.problems.find((p) => p.code === 'text_lost')).toBeUndefined();
    expect(d.problems.find((p) => p.code === 'empty')).toBeTruthy();
  });

  test('DeepSeek counts a new chat address or a detached composer as a confirmed send', () => {
    const script = require('fs').readFileSync(require('path').join(__dirname, '..', 'content-scripts', 'content-deepseek.js'), 'utf8');
    expect(script).toContain('if (input.isConnected === false) return true;');
    expect(script).toContain("location.pathname !== startPath && /\\/a\\/chat\\/s\\//.test(location.pathname)");
  });
});
