const Views = require('../shared/telemetry-views');

const ev = (ts, label, extra = {}) => ({
  ts, type: 'TELEMETRY', label, level: 'info', platform: 'Gemini', details: '',
  meta: { runSessionId: 'run1', dispatchId: 'Gemini:1', telemetryTaxonomy: { stage: 'x' }, ...(extra.meta || {}) },
  ...extra
});

describe('telemetry views', () => {
  const events = [
    ev(1000, 'RUN_START'),
    ev(1100, 'DISPATCH_SEND'),
    ev(1200, 'PROMPT_INSERTION_CONFIRMED'),
    ev(1300, 'PROMPT_SUBMITTED_ACCEPTED'),
    ev(2000, 'ANSWER_GENERATING'),
    ev(2500, 'ANSWER_GENERATING'),
    ev(3000, 'ANSWER_GENERATING'),
    ev(3500, 'ANSWER_TEXT_STABLE', { details: 'len=120' }),
    ev(3600, 'ANSWER_COMPLETE_DETECTED'),
    ev(3700, 'FINALIZATION_DECISION', { details: 'accepted' }),
    ev(3800, 'MODEL_FINAL'),
    ev(500, 'SELECTOR_STATS'),
    ev(5000, 'UNRELATED_NOISE', { level: 'error', details: 'boom' }),
    ev(5100, 'UNRELATED_NOISE_2')
  ];

  test('raw returns the input untouched', () => {
    const view = Views.buildTelemetryView(events, 'raw');
    expect(view.compact).toBe(false);
    expect(view.events).toBe(events);
    expect(Views.buildTelemetryView(events, 'no-such-profile').events).toBe(events);
  });

  test('send keeps the dispatch chain and drops answer-side events', () => {
    const labels = Views.buildTelemetryView(events, 'send').events.map((row) => row.l);
    expect(labels).toEqual(expect.arrayContaining(['RUN_START', 'DISPATCH_SEND', 'PROMPT_INSERTION_CONFIRMED', 'PROMPT_SUBMITTED_ACCEPTED']));
    expect(labels).not.toContain('ANSWER_TEXT_STABLE');
    expect(labels).not.toContain('SELECTOR_STATS');
  });

  test('completion keeps generation and decision events and sorts by time', () => {
    const rows = Views.buildTelemetryView(events, 'completion').events;
    const labels = rows.map((row) => row.l);
    expect(labels).toEqual(expect.arrayContaining(['ANSWER_TEXT_STABLE', 'ANSWER_COMPLETE_DETECTED', 'FINALIZATION_DECISION', 'MODEL_FINAL']));
    expect(labels).not.toContain('DISPATCH_SEND');
    const times = rows.map((row) => row.t);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(rows[0].t).toBe(0);
  });

  test('errors and warnings are always kept, whatever their label', () => {
    ['send', 'completion', 'lastAnswer', 'truncated'].forEach((id) => {
      const rows = Views.buildTelemetryView(events, id).events;
      expect(rows.some((row) => row.l === 'UNRELATED_NOISE' && row.v === 'error' && row.d === 'boom')).toBe(true);
      expect(rows.some((row) => row.l === 'UNRELATED_NOISE_2')).toBe(false);
    });
  });

  test('polling repeats collapse into one counted row', () => {
    const rows = Views.buildTelemetryView(events, 'completion').events;
    const generating = rows.filter((row) => row.l === 'ANSWER_GENERATING');
    expect(generating).toHaveLength(1);
    expect(generating[0].n).toBe(3);
    expect(generating[0].t2).toBeGreaterThan(generating[0].t);
  });

  test('meta is trimmed: identity fields hoisted away, long values cut', () => {
    const long = 'x'.repeat(500);
    const rows = Views.buildTelemetryView([
      ev(10, 'MODEL_FINAL', { meta: { dispatchId: 'Gemini:1', answerText: long, items: Array.from({ length: 30 }, (_, i) => i) } })
    ], 'completion').events;
    const meta = rows[0].m;
    expect(meta.telemetryTaxonomy).toBeUndefined();
    expect(meta.runSessionId).toBeUndefined();
    expect(meta.dispatchId).toBe('Gemini:1');
    expect(meta.answerText.length).toBeLessThan(200);
    expect(meta.items).toHaveLength(9);
  });

  test('every profile except raw defines a task for the reader and a label filter', () => {
    Views.listProfiles().filter((profile) => profile.id !== 'raw').forEach((profile) => {
      const full = Views.getProfile(profile.id);
      expect(typeof full.task).toBe('string');
      expect(full.labels).toBeInstanceOf(RegExp);
    });
    expect(Views.listProfiles().map((profile) => profile.id)).toEqual(['raw', 'send', 'completion', 'lastAnswer', 'truncated']);
  });

  test('a profile view is much smaller than the raw export on a realistic mix', () => {
    const noisy = [];
    for (let i = 0; i < 3000; i += 1) {
      noisy.push(ev(i * 10, ['SELECTOR_STATS', 'TAB_ACTIVATION_IGNORED_PROGRAMMATIC', 'ROUND_STATE_REPAIR', 'LEASE_GRANTED'][i % 4], {
        meta: { runSessionId: 'run1', dispatchId: `Gemini:${i}`, payload: 'y'.repeat(200) }
      }));
    }
    const all = noisy.concat(events);
    const rawSize = JSON.stringify(all).length;
    const viewSize = JSON.stringify(Views.buildTelemetryView(all, 'truncated').events).length;
    expect(viewSize).toBeLessThan(rawSize / 20);
  });

  test('send keeps the content adapter narrative by event type, not only by label', () => {
    const rows = Views.buildTelemetryView([
      ev(1, 'GPT send attempt', { type: 'SEND' }),
      ev(2, 'GPT send button found', { type: 'SEND' }),
      ev(3, 'Input value set', { type: 'DISPATCH' }),
      ev(4, 'Some unrelated note', { type: 'INFO' })
    ], 'send').events;
    expect(rows.map((row) => row.l)).toEqual(['GPT send attempt', 'GPT send button found', 'Input value set']);
    expect(rows[0].y).toBe('SEND');
  });

  test('send ends 30 s after the dispatch was accepted, except problems', () => {
    const accepted = ev(1000, 'PROMPT_SUBMITTED_ACCEPTED');
    const rows = Views.buildTelemetryView([
      accepted,
      ev(20000, 'TAB_READY_CHECK'),
      ev(60000, 'TAB_READY_CHECK'),
      ev(61000, 'TAB_ACTIVATION_IGNORED_PROGRAMMATIC', { level: 'warning' }),
      ev(70000, 'DISPATCH_SEND', { meta: { dispatchId: 'Gemini:2' } })
    ], 'send').events;
    expect(rows.map((row) => row.t)).toEqual([0, 19000, 60000, 69000]);
  });

  test('repeated identity blocks are dropped and dispatchId is stated once per chain', () => {
    const identity = { expectedIdentity: { a: 1 }, incomingIdentity: { b: 2 }, extVersion: '1', logCollection: { appended: 3 }, tabId: 7 };
    const rows = Views.buildTelemetryView([
      ev(1, 'DISPATCH_SEND', { meta: { dispatchId: 'GPT:1', ...identity } }),
      ev(2, 'PROMPT_SUBMITTED_ACCEPTED', { meta: { dispatchId: 'GPT:1', ...identity } }),
      ev(3, 'DISPATCH_SEND', { meta: { dispatchId: 'GPT:2', ...identity } })
    ], 'send').events;
    expect(rows[0].m).toEqual({ dispatchId: 'GPT:1', tabId: 7 });
    expect(rows[1].m).toEqual({ tabId: 7 });
    expect(rows[2].m).toEqual({ dispatchId: 'GPT:2', tabId: 7 });
  });
});
