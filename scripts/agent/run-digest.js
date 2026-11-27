#!/usr/bin/env node
// Сводка прогона Circle / TheCycle для отчёта этапа: таблица по циклам.
// usage: run-digest.js <копия.thecycle.json> [отчёт.md] [--research <часть id>]...
// Вход — резервная копия TheCycle (`*.thecycle.json` из папки копий). В копии лежат все исследования:
// без --research берётся то, чей id есть в имени файла, а если такого нет — все.
// Выход — markdown в stdout; с аргументом «отчёт.md» — дописывается в конец этого файла.
// exit: 0 таблица готова; 2 неверный вызов, не та выгрузка, повреждённая копия или исследование не найдено.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROLES = { schema: 'работа', analyst: 'аналитик', verify: 'проверка' };
const CELL_MAX = 240;

const fail = (message) => Object.assign(new Error(message), { digest: true });

// Тексты моделей идут в отчёт репозитория: одна строка, без ссылок, ограниченная длина.
function clip(value, max = CELL_MAX) {
  const text = String(value ?? '').replace(/https?:\/\/\S+/g, '<ссылка>').replace(/\s+/g, ' ').trim();
  return (text.length > max ? `${text.slice(0, max - 1)}…` : text).replace(/\|/g, '\\|');
}

function readSnapshot(source) {
  let snapshot = source;
  if (source?.format === 'thecycle-backup') {
    if (typeof source.payload !== 'string') throw fail('в копии нет данных');
    if (crypto.createHash('sha256').update(source.payload, 'utf8').digest('hex') !== source.sha256) {
      throw fail('копия повреждена: не сходится SHA-256');
    }
    snapshot = JSON.parse(source.payload);
  }
  const stores = snapshot?.stores;
  if (snapshot?.format !== 'thecycle-idb-snapshot' || !['research', 'runs', 'events', 'packets'].every((name) => Array.isArray(stores?.[name]))) {
    throw fail('это не копия TheCycle');
  }
  return stores;
}

function select(stores, wanted, fileName) {
  const all = stores.research.map((state) => state.researchId);
  if (wanted.length) {
    return wanted.flatMap((part) => {
      const found = all.filter((id) => id.includes(part));
      if (!found.length) throw fail(`исследование не найдено: ${part}`);
      return found;
    });
  }
  const named = all.filter((id) => fileName.includes(id));
  return named.length ? named : all;
}

const withErrors = (reason, detail) => [reason, detail?.errors?.join('; ')].filter(Boolean).join(': ');

function analystCell(role, detail) {
  if (role !== 'analyst' || !detail?.action) return '—';
  return clip([`${detail.action} — ${detail.reason || 'без основания'}`, detail.question && `вопрос: ${detail.question}`].filter(Boolean).join('; '));
}

function verifyCell(record) {
  if (!record) return '—';
  const checks = record.checks || [];
  const passed = checks.filter((check) => check.result === 'PASS').length;
  return clip([
    `${record.verdict}, PASS ${passed}/${checks.length}`,
    record.verifierModel,
    record.independence,
    record.downgrades?.length && `понижено: ${record.downgrades.join('; ')}`
  ].filter(Boolean).join(', '));
}

function outcomeCell(packet) {
  if (!packet) return 'цикл не записан';
  const partial = packet.status === 'PARTIAL_RECOVERY' ? ' (восстановлен частично)' : '';
  const decision = packet.decision;
  if (!decision) return `решения нет${partial}`;
  return clip(`${decision.action} ${withErrors(decision.reason, decision.detail)}`) + partial;
}

function stopLine(state, last) {
  if (state.phase === 'COMPLETED') {
    const reason = state.closedReason || state.lastDecision?.reason || 'причина не записана';
    return `Завершено: ${reason}${state.finalStatus ? `, итог ${state.finalStatus}` : ''}`;
  }
  if (state.phase !== 'PAUSED') return `Не остановлено: фаза ${state.phase}`;
  const decision = state.lastDecision;
  const current = decision?.action === 'PAUSE' && decision.stateVersion >= (last?.packet?.decision?.stateVersion ?? 0);
  if (current) return `Пауза: ${clip(withErrors(decision.reason, decision.detail), 300)}`;
  if (state.stopRequested) return 'Пауза: остановка пользователем';
  if (last && !last.packet?.decision) return `Пауза: по циклу ${last.cycleId} нет решения (прогон ${last.status})`;
  return 'Пауза: причина не записана';
}

function researchDigest(stores, researchId) {
  const own = (name) => stores[name].filter((item) => item.researchId === researchId);
  const state = own('research')[0];
  const events = own('events');
  const packets = own('packets');
  let used = 0;
  const cycles = own('runs').sort((a, b) => a.cycleId - b.cycleId).map((run) => {
    const packet = packets.find((item) => item.runId === run.runId);
    const report = events.find((event) => event.runId === run.runId && event.eventId === 'RUN_RESULT')?.payload?.report;
    used += run.usedCalls || 0;
    return { run, packet, cycleId: run.cycleId, status: report?.status || run.phase, used };
  });
  const rows = cycles.map(({ run, packet, cycleId, status, used: total }) => {
    const key = /:(schema|analyst|verify):/.exec(run.pipelineRef || '')?.[1];
    const detail = packet?.decision?.detail;
    return `| ${[cycleId, ROLES[key] || clip(run.pipelineRef), `${run.usedCalls} (${total})`, status,
      analystCell(key, detail), verifyCell(detail?.verificationRecord), outcomeCell(packet)].join(' | ')} |`;
  });
  return [
    `### ${researchId}`,
    '',
    `${state.phase}, циклов ${cycles.length}, запросов ${state.budget.usedCalls} из ${state.budget.maxCalls}. ${stopLine(state, cycles[cycles.length - 1])}`,
    '',
    '| Цикл | Роль | Запросов (всего) | Прогон | Решение аналитика | Проверка | Исход |',
    '|---|---|---|---|---|---|---|',
    ...rows
  ].join('\n');
}

function digest(source, { research = [], fileName = '' } = {}) {
  const stores = readSnapshot(source);
  const ids = select(stores, research, fileName);
  if (!ids.length) throw fail('в копии нет исследований');
  return `${ids.map((id) => researchDigest(stores, id)).join('\n\n')}\n`;
}

function main(argv) {
  const files = [];
  const research = [];
  for (let at = 0; at < argv.length; at += 1) {
    if (argv[at] === '--research' && argv[at + 1]) research.push(argv[at += 1]);
    else if (!argv[at].startsWith('--')) files.push(argv[at]);
    else files.length = 3;
  }
  if (files.length < 1 || files.length > 2) {
    process.stderr.write('usage: run-digest.js <копия.thecycle.json> [отчёт.md] [--research <часть id>]...\n');
    return 2;
  }
  let text;
  try {
    text = digest(JSON.parse(fs.readFileSync(files[0], 'utf8')), { research, fileName: path.basename(files[0]) });
  } catch (error) {
    if (!error.digest && !(error instanceof SyntaxError) && !error.code) throw error;
    process.stderr.write(`run-digest: ${error.message}\n`);
    return 2;
  }
  if (files[1]) fs.appendFileSync(files[1], `\n${text}`);
  else process.stdout.write(text);
  return 0;
}

module.exports = { digest };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
