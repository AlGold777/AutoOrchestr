const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { digest } = require('../scripts/agent/run-digest.js');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'agent', 'run-digest.js');
const ID = 'circle-aaaa';

const run = (cycleId, role, usedCalls, researchId = ID) => ({
  researchId, runId: `${researchId}:cycle:${cycleId}`, cycleId, usedCalls, phase: 'COMMITTED',
  pipelineRef: `thecycle:circle:${researchId}:${role}:c${cycleId}`
});
const packet = (cycleId, decision) => ({
  researchId: ID, cycleId, runId: `${ID}:cycle:${cycleId}`, status: 'RECORDED_RESULT', decision
});
const result = (cycleId, status) => ({
  researchId: ID, runId: `${ID}:cycle:${cycleId}`, eventId: 'RUN_RESULT', payload: { type: 'RUN_RESULT', report: { status } }
});

const snapshot = () => ({
  format: 'thecycle-idb-snapshot', version: 1,
  stores: {
    research: [
      { researchId: ID, phase: 'PAUSED', budget: { maxCalls: 10, usedCalls: 6 },
        lastDecision: { action: 'PAUSE', reason: 'STRATEGY_REJECTED', stateVersion: 30, detail: { errors: ['мало запросов'] } } },
      { researchId: 'circle-bbbb', phase: 'PAUSED', stopRequested: true, budget: { maxCalls: 5, usedCalls: 2 } }
    ],
    runs: [run(2, 'analyst', 1), run(1, 'schema', 3), run(3, 'verify', 1), run(4, 'analyst', 1), run(1, 'schema', 2, 'circle-bbbb')],
    events: [result(1, 'PARTIAL'), result(2, 'PIPELINE_COMPLETE'), result(3, 'PIPELINE_COMPLETE'), result(4, 'PIPELINE_COMPLETE')],
    packets: [
      packet(1, { action: 'CONTINUE', reason: 'ANALYST_NEXT', stateVersion: 10 }),
      packet(2, { action: 'CONTINUE', reason: 'VERIFY_NEXT', stateVersion: 15,
        detail: { action: 'VERIFY', reason: 'нужна проверка | сертификата https://chat.example/c/123' } }),
      packet(3, { action: 'CONTINUE', reason: 'ANALYST_NEXT', stateVersion: 20, detail: { action: 'VERIFY', reason: 'verdict SUPPORTED',
        verificationRecord: { verdict: 'SUPPORTED', checks: [{ result: 'PASS' }, { result: 'FAIL' }], verifierModel: 'Qwen', independence: 'UNPROVEN' } } }),
      packet(4, { action: 'PAUSE', reason: 'STRATEGY_REJECTED', stateVersion: 30,
        detail: { action: 'CHANGE_STRATEGY', reason: 'декомпозиция', errors: ['мало запросов'] } })
    ]
  }
});
const envelope = (data) => {
  const payload = JSON.stringify(data);
  return { format: 'thecycle-backup', version: 1, algorithm: 'SHA-256', payload,
    sha256: crypto.createHash('sha256').update(payload, 'utf8').digest('hex') };
};
const rowsOf = (text) => text.split('\n').filter((line) => /^\| \d/.test(line));

describe('run-digest: сводка прогона по копии TheCycle', () => {
  test('строка на цикл: решение, проверка, расход, причина паузы', () => {
    const text = digest(envelope(snapshot()), { research: [ID] });
    const rows = rowsOf(text);
    expect(rows).toHaveLength(4);
    expect(text).toContain('запросов 6 из 10. Пауза: STRATEGY_REJECTED: мало запросов');
    expect(rows[0]).toBe('| 1 | работа | 3 (3) | PARTIAL | — | — | CONTINUE ANALYST_NEXT |');
    expect(rows[1]).toContain('VERIFY — нужна проверка \\| сертификата <ссылка>');
    expect(rows[2]).toContain('| проверка | 1 (5) |');
    expect(rows[2]).toContain('SUPPORTED, PASS 1/2, Qwen, UNPROVEN');
    expect(rows[3]).toContain('CHANGE_STRATEGY — декомпозиция');
    expect(rows[3]).toContain('PAUSE STRATEGY_REJECTED: мало запросов');
    expect(text).not.toContain('chat.example');
  });

  test('исследование берётся из имени файла; без записи цикла видно, что решения нет', () => {
    const text = digest(snapshot(), { fileName: 'thecycle-circle-bbbb-1-1.thecycle.json' });
    expect(text).not.toContain(ID);
    expect(text).toContain('Пауза: остановка пользователем');
    expect(rowsOf(text)[0]).toContain('цикл не записан');
  });

  test('командная строка: дописывает отчёт; неверный вход — код 2', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-digest-'));
    const input = path.join(dir, 'copy.thecycle.json');
    const report = path.join(dir, 'report.md');
    fs.writeFileSync(input, JSON.stringify(envelope(snapshot())));
    fs.writeFileSync(report, '# Отчёт\n');
    execFileSync('node', [SCRIPT, input, report, '--research', ID]);
    const written = fs.readFileSync(report, 'utf8');
    expect(written.startsWith('# Отчёт\n\n### circle-aaaa\n')).toBe(true);

    const code = (args) => {
      try { execFileSync('node', [SCRIPT, ...args], { stdio: 'pipe' }); return 0; } catch (error) { return error.status; }
    };
    expect(code([])).toBe(2);
    expect(code([input, '--research', 'нет'])).toBe(2);
    expect(code([path.join(dir, 'нет.json')])).toBe(2);
    fs.writeFileSync(input, JSON.stringify({ ...envelope(snapshot()), sha256: '0' }));
    expect(code([input])).toBe(2);
  });
});
