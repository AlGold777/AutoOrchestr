#!/usr/bin/env node
// Проверка ответов моделей по выгрузке прогона Basic: какие ответы нельзя принимать без чтения.
//
//   node scripts/agent/check-run.js [--flagged] <выгрузка Basic>.json [ещё ...]
//     --flagged  печатать только отмеченные ответы
//
// Проверяются признаки, не смысл. «ПРОВЕРИТЬ» — открыть и прочитать ответ; «ок» не значит, что ответ хороший.
// Берётся последняя попытка участника в шаге (visit, phase): более ранние неудачи только считаются.
// exit: 0 отмеченных нет; 1 есть отмеченные; 2 неверный вызов или не та выгрузка.
'use strict';

const fs = require('fs');
const path = require('path');
const Output = require('../../disput/basic-output.js');

// Пороги. SHORT_OF_PEERS — доля медианы других ответов того же шага; SHORT_OF_LIMIT — доля предела слов,
// когда сравнить не с чем. Сообщение о лимите или ошибке ищется только в коротком ответе.
const SHORT_OF_PEERS = 0.3;
const SHORT_OF_LIMIT = 0.2;
const SERVICE_MAX_CHARS = 600;
const ECHO_CHARS = 200;

const SERVICE = /usage limit|rate limit|limit reached|reached your .{0,30}limit|message cap|too many requests|something went wrong|network error|server is busy|лимит (использования|сообщений|запросов)|(достигли|исчерпа\p{L}*) .{0,20}лимит|слишком много запросов|что-то пошло не так|сервер (занят|перегружен)|войдите, чтобы|please (log|sign) ?in|verify you are human|подтвердите, что вы (не робот|человек)/iu;
const MARK = /\[\[AO-[a-z0-9]+\]\]/gi;
const IDEA_LINE = /^[\s>*#|-]*\*{0,2}([ИК])-(\d+)\b\*{0,2}\s*[.):|]/u;
const SOURCE_ID = /^(?=.*\d)[\p{L}\d]{1,12}(?:[.\-_][\p{L}\d]{1,8}){0,3}$/u;

const normalize = (value) => String(value || '').replace(MARK, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
};

const listNumbers = (values) => (values.length > 8 ? `${values.slice(0, 8).join(', ')} и ещё ${values.length - 8}` : values.join(', '));

const gaps = (numbers) => {
  const set = new Set(numbers);
  const missing = [];
  for (let n = 1; n <= Math.max(...numbers); n += 1) if (!set.has(n)) missing.push(n);
  return missing;
};

// Номера исходных элементов в конце строки: «… — 1a, 2b» или «… — 1.2, 2.5».
function sourceTail(line) {
  const cells = line.replace(/[\s|*.]+$/u, '').split(/\s[—–]\s/);
  if (cells.length < 2) return null;
  const ids = cells[cells.length - 1].split(/\s*[,;]\s*/).map((id) => id.replace(/^[[<(*]+|[\]>)*.]+$/g, ''));
  return ids.every((id) => SOURCE_ID.test(id)) ? ids : null;
}

// Карта идей: строки «И-3. формулировка. — 1a, 2b», строка «Не идеи: …», счётчики в конце.
// Ответ, где у большинства строк «И-N» нет источников (например критика карты), картой не считается.
// Пропуски после последнего номера не видны.
function ideaProblems(answer) {
  const ids = [];
  const sources = [];
  let ideaLines = 0;
  for (const line of String(answer).split(/\r?\n/)) {
    const other = /^[\s>*#-]*не идеи\*{0,2}\s*:\s*(.+)$/iu.exec(line);
    if (other) sources.push(...other[1].split(/\s*[,;]\s*/).map((id) => id.replace(/[\s*.]+$/g, '')).filter((id) => SOURCE_ID.test(id)));
    const idea = IDEA_LINE.exec(line);
    if (!idea) continue;
    ideaLines += 1;
    const tail = sourceTail(line);
    if (!tail) continue;
    ids.push({ letter: idea[1], number: Number(idea[2]) });
    sources.push(...tail);
  }
  if (ids.length < 5 || ids.length * 2 < ideaLines) return [];
  const problems = [];
  for (const letter of new Set(ids.map((id) => id.letter))) {
    const numbers = ids.filter((id) => id.letter === letter).map((id) => id.number);
    const repeated = [...new Set(numbers.filter((n, at) => numbers.indexOf(n) !== at))];
    if (repeated.length) problems.push(`номера идей повторяются: ${listNumbers(repeated.map((n) => `${letter}-${n}`))}`);
    const missing = gaps(numbers);
    if (missing.length) problems.push(`пропущены номера идей или у них нет источников: ${listNumbers(missing.map((n) => `${letter}-${n}`))}`);
  }
  const twice = [...new Set(sources.filter((ref, at) => sources.indexOf(ref) !== at))];
  if (twice.length) problems.push(`исходные номера стоят дважды: ${listNumbers(twice)}`);

  // Пропуски: «3.2» между 3.1 и 3.3, «1b» между 1a и 1c, элемент 4 между 3 и 5.
  const parents = new Map();
  for (const id of sources) {
    const parts = /^(\d+)(?:\.(\d+)|([a-z]))?$/.exec(id);
    if (!parts) continue;
    const parent = Number(parts[1]);
    if (!parents.has(parent)) parents.set(parent, []);
    if (parts[2]) parents.get(parent).push(Number(parts[2]));
    if (parts[3]) parents.get(parent).push(parts[3].charCodeAt(0) - 96);
  }
  if (parents.size) {
    const letters = sources.some((id) => /^\d+[a-z]$/.test(id));
    const lost = gaps([...parents.keys()]).map(String);
    for (const [parent, children] of [...parents].sort((a, b) => a[0] - b[0])) {
      if (!children.length) continue;
      lost.push(...gaps(children).map((n) => (letters ? `${parent}${String.fromCharCode(96 + n)}` : `${parent}.${n}`)));
    }
    if (lost.length) problems.push(`нет исходных номеров: ${listNumbers(lost)}`);
  }

  // Счётчики, которые модель посчитала о себе сама.
  const claimed = (name) => { const found = new RegExp(`${name}\\s*[—–:-]\\s*(\\d+)`, 'iu').exec(answer); return found ? Number(found[1]) : null; };
  const unique = claimed('Уникальных идей');
  if (unique !== null && unique !== ids.length) problems.push(`счётчик неверен: уникальных идей заявлено ${unique}, в списке ${ids.length}`);
  const atomic = claimed('После атомизации');
  const found = new Set(sources).size;
  if (atomic !== null && atomic !== found) problems.push(`счётчик неверен: элементов заявлено ${atomic}, номеров в списке ${found}`);
  return problems;
}

function cutProblem(answer) {
  const body = String(answer).replace(MARK, '').trim();
  if (/продолжение следует[^\n]{0,10}$/iu.test(body)) return 'ответ не закончен: «ПРОДОЛЖЕНИЕ СЛЕДУЕТ»';
  if ((body.match(/^\s*```/gm) || []).length % 2) return 'похож на оборванный: не закрыт блок кода';
  if ((body.match(/\[\[DOC:[^\]]*\]\]/g) || []).length > (body.match(/\[\[\/DOC\]\]/g) || []).length) return 'похож на оборванный: не закрыт документ [[DOC]]';
  const end = /[,;:(«—–]$/.exec(body);
  return end ? `похож на оборванный: кончается на «${end[0]}»` : null;
}

function readRun(data) {
  const run = data && data.customRun;
  if (!run || !Array.isArray(run.attempts)) throw new Error('это не выгрузка прогона Basic (нет customRun.attempts)');
  const texts = run.texts || {};
  const text = (ref, inline) => {
    const value = ref != null && Object.prototype.hasOwnProperty.call(texts, ref) ? texts[ref] : inline;
    return typeof value === 'string' ? value : '';
  };
  return { run, text };
}

// Строка на каждый ответ: { ref, visit, phase, participant, model, words, flags, notes }.
function checkRun(data) {
  const { run, text } = readRun(data);
  const snapshot = run.snapshot || {};
  const steps = snapshot.steps || [];
  const runLimit = snapshot.runSettings && snapshot.runSettings.runMaxWords;

  const groups = new Map();
  for (const attempt of run.attempts) {
    const key = JSON.stringify([attempt.ref, attempt.visit, attempt.phase, attempt.participant]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(attempt);
  }

  const rows = [...groups.values()].map((attempts) => {
    const last = attempts[attempts.length - 1];
    const answer = text(last.answerRef, last.answer);
    const step = steps.find((item) => item.ref === last.ref) || {};
    const member = (step.models || []).find((item) => item.id === last.participant) || {};
    return {
      ref: last.ref,
      visit: last.visit,
      phase: last.phase,
      participant: last.participant,
      model: last.model,
      attempts: attempts.length,
      last,
      answer,
      words: Output.countWords(Output.cleanAnswer(answer)),
      output: member.output || step.output || null,
      limit: member.maxWords || step.maxWords || runLimit || null,
      flags: [],
      notes: []
    };
  });

  for (const row of rows) {
    const { last, answer, flags, notes } = row;
    if (row.attempts > 1) notes.push(`с ${row.attempts}-й попытки`);
    if (last.state && last.state !== 'done') {
      flags.push(`не закончен (${last.state})`);
      continue;
    }
    if (last.accepted === false) flags.push(`ответ не принят: ${last.reason || last.status || 'причина не записана'}`);
    if (!normalize(answer)) {
      if (!flags.length) flags.push('пустой ответ');
      continue;
    }
    if (answer.length <= SERVICE_MAX_CHARS && SERVICE.test(answer)) flags.push('вместо ответа сообщение о лимите, входе или ошибке');

    const prompt = normalize(text(last.promptRef, last.prompt));
    const head = normalize(answer).slice(0, ECHO_CHARS);
    if (answer.includes('[RESPONSE_LIMIT]') || (head.length === ECHO_CHARS && prompt.includes(head))) flags.push('в ответе повторён запрос');

    const twin = rows.find((other) => other !== row && normalize(other.answer) === normalize(answer) && normalize(answer).length > 80);
    if (twin) flags.push(`тот же текст, что у ${twin.model} в ${twin.ref}`);

    const peers = rows.filter((other) => other !== row && other.ref === row.ref && other.visit === row.visit
      && other.phase === row.phase && other.last.accepted !== false && other.words > 0).map((other) => other.words);
    const json = row.output && row.output.format === 'json';
    if (!json && peers.length >= 2 && row.words < median(peers) * SHORT_OF_PEERS) {
      flags.push(`намного короче других: ${row.words} слов при медиане ${Math.round(median(peers))}`);
    } else if (!json && peers.length < 2 && row.limit && row.words < row.limit * SHORT_OF_LIMIT) {
      flags.push(`очень короткий: ${row.words} слов при пределе ${row.limit}`);
    }

    const cut = cutProblem(answer);
    if (cut) flags.push(cut);

    if (row.output && row.phase === 'answer') {
      const shape = Output.checkAnswer(answer, row.output, { limit: row.limit });
      if (!shape.ok) flags.push(`не по формату: ${shape.reason}${shape.detail ? ` ${shape.detail}` : ''}`);
    }

    flags.push(...ideaProblems(answer));

    const mark = /метку\s*(\[\[AO-[a-z0-9]+\]\])/i.exec(text(last.sentPromptTailRef, last.sentPrompt));
    // Часть сайтов метку не отдаёт, поэтому сама по себе она ни о чём не говорит.
    if (flags.length && mark && !answer.includes(mark[1])) notes.push('нет метки конца');
    if (last.attribution === 'unproven') notes.push('принадлежность ответа запросу не подтверждена');
  }

  // Участники начатого раунда, которым запрос не отправлялся. Не начатые раунды и ходы владельца не в счёт.
  for (const round of data.rounds || []) {
    if (round.kind === 'owner' || !rows.some((row) => row.ref === round.stepRef && row.visit === round.visit)) continue;
    for (const participant of round.expectedParticipants || []) {
      if (rows.some((row) => row.ref === round.stepRef && row.visit === round.visit && row.participant === participant)) continue;
      const known = (round.participants || []).find((item) => item.participant === participant) || {};
      rows.push({ ref: round.stepRef, visit: round.visit, phase: 'answer', participant, model: known.model || participant, words: 0, flags: ['запрос не отправлялся'], notes: [] });
    }
  }

  const order = (row) => {
    const at = steps.findIndex((step) => step.ref === row.ref);
    return at === -1 ? steps.length : at;
  };
  return rows.sort((a, b) => order(a) - order(b) || a.visit - b.visit)
    .map(({ ref, visit, phase, participant, model, words, flags, notes }) => ({ ref, visit, phase, participant, model, words, flags, notes }));
}

function formatReport(data, rows, { flaggedOnly = false } = {}) {
  const run = data.customRun;
  const bad = rows.filter((row) => row.flags.length);
  const lines = [`${run.pipelineName || 'Basic'} · расширение ${data.extensionVersion || '?'} · остановка: ${run.stopReason || 'прогон не закончен'}`,
    `Ответов: ${rows.length}, проверить: ${bad.length}`];
  for (const row of flaggedOnly ? bad : rows) {
    const where = `${row.ref}${row.visit > 1 ? ` ×${row.visit}` : ''}${row.phase && row.phase !== 'answer' ? ` ${row.phase}` : ''}`;
    const text = [...row.flags, ...row.notes.map((note) => `(${note})`)].join('; ');
    lines.push(`${row.flags.length ? 'ПРОВЕРИТЬ' : 'ок       '}  ${where}  ${row.model} [${row.participant}]  ${row.words} сл.${text ? `  ${text}` : ''}`);
  }
  return lines.join('\n');
}

module.exports = { checkRun, formatReport, ideaProblems, cutProblem };

if (require.main === module) {
  const args = process.argv.slice(2);
  const flaggedOnly = args.includes('--flagged');
  const files = args.filter((arg) => arg !== '--flagged');
  if (!files.length) {
    console.error('usage: node scripts/agent/check-run.js [--flagged] <выгрузка Basic>.json [ещё ...]');
    process.exit(2);
  }
  let code = 0;
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const rows = checkRun(data);
      console.log(`# ${path.basename(file)}\n${formatReport(data, rows, { flaggedOnly })}\n`);
      if (code === 0 && rows.some((row) => row.flags.length)) code = 1;
    } catch (error) {
      console.error(`# ${path.basename(file)}: ${error.message}`);
      code = 2;
    }
  }
  process.exitCode = code;
}
