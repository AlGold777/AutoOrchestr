#!/usr/bin/env node
// Generates disput/architecture-framework.js (the stage catalogue of the
// "Разработка архитектуры" pipeline template) from the Product→Architecture
// Framework in docs/Automation GPT комплект Документов/process/stages.json.
//
//   node scripts/build-architecture-framework.js          # write the file
//   node scripts/build-architecture-framework.js --check  # fail when it is stale
//
// The framework stays the source of truth; the generated file only carries what
// the pipeline canvas needs (stage card text, who works, the stage brief).
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'docs', 'Automation GPT комплект Документов', 'process', 'stages.json');
const TARGET = path.join(ROOT, 'disput', 'architecture-framework.js');

const PHASES = {
  product: 'Продукт',
  discovery: 'Ограничения и факты',
  generation: 'Варианты архитектуры',
  evidence: 'Доказательства и базовая линия'
};

// Русские названия этапов и роль этапа на холсте. `purpose` — назначение этапа
// движка (DebateArtifactPipeline.operationForPurpose); `who` — кто работает:
//   all     — все выбранные модели независимо друг от друга;
//   lead    — одна модель (Producer / Synthesizer / Decision Closer);
//   review  — одна модель, но не та, что ведёт (Reviewer / Verifier);
//   gate    — ворота: моделей нет, этап закрывает модератор.
const STAGES = {
  1: ['Идея продукта и политика решений', 'position', 'lead'],
  2: ['Независимое расширение концепции', 'position', 'all'],
  3: ['Закрытие решений', 'critique', 'review'],
  4: ['Синтез продуктовой концепции', 'synthesis', 'lead'],
  5: ['Состязательная проверка концепции', 'critique', 'all'],
  6: ['Дельта-закрытие решений', 'response', 'lead'],
  7: ['Черновик функциональной карты', 'position', 'lead'],
  8: ['Аудит функциональной карты', 'critique', 'review'],
  9: ['Проверка сценариев и прототипа', 'verification', 'review'],
  10: ['Дельта-закрытие решений', 'response', 'lead'],
  11: ['Функциональная спецификация', 'position', 'lead'],
  12: ['Аудит функциональной спецификации', 'critique', 'review'],
  13: ['Продуктовая базовая линия', 'human_judgment', 'gate'],
  14: ['Независимый поиск ограничений', 'position', 'all'],
  15: ['Синтез и нормализация ограничений', 'synthesis', 'lead'],
  16: ['Проверка фактов и реестр валидации', 'verification', 'review'],
  17: ['Пакет входов для архитектуры', 'human_judgment', 'gate'],
  18: ['Независимые архитектурные предложения', 'position', 'all'],
  19: ['Независимая оценка кандидатов', 'critique', 'all'],
  20: ['Перекрёстная критика и доработка', 'response', 'all'],
  21: ['Сравнение архитектур', 'synthesis', 'lead'],
  22: ['Решение о направлении архитектуры', 'human_judgment', 'gate'],
  23: ['Предварительная концептуальная архитектура', 'synthesis', 'lead'],
  24: ['Бэклог решений и проверок', 'synthesis', 'lead'],
  25: ['Исследования и проверка платформы', 'evidence_review', 'review'],
  26: ['Закрытие блокирующих архитектурных решений', 'response', 'lead'],
  27: ['Премортем: поиск пропущенных отказов', 'critique', 'all'],
  28: ['Ревизия концептуальной архитектуры', 'response', 'lead'],
  29: ['Аудит: ADR, согласованность, трассируемость', 'critique', 'review'],
  30: ['Базовая линия концептуальной архитектуры', 'human_judgment', 'gate']
};

const list = (items) => (Array.isArray(items) ? items : []).map(String).filter(Boolean);
const bullets = (items) => list(items).map((item) => `- ${item}`).join('\n');

function buildInstruction(stage, titleRu, who) {
  const doc = stage.documentation || {};
  const parts = [`Этап ${stage.n}. ${titleRu} (${stage.title}).`];
  if (who === 'gate') {
    parts.push('Это ворота: модель не запускается. Модератор проверяет результат предыдущих этапов и решает, зафиксировать ли базовую линию.');
  }
  if (list(doc.inputs).length) parts.push(`Входы:\n${bullets(doc.inputs)}`);
  if (list(doc.allowed).length) parts.push(`Что нужно сделать:\n${bullets(doc.allowed)}`);
  if (list(doc.forbidden).length) parts.push(`Чего делать нельзя:\n${bullets(doc.forbidden)}`);
  if (list(doc.rules).length) parts.push(`Правила: ${list(doc.rules).join('; ')}.`);
  if (stage.independent) parts.push('Этап независимый: не опирайся на ответы других моделей этого этапа.');
  return parts.join('\n\n');
}

function build() {
  const source = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  if (!Array.isArray(source) || source.length !== 30) throw new Error('stages.json: expected 30 stages');
  const stages = source.map((stage) => {
    const meta = STAGES[stage.n];
    if (!meta) throw new Error(`No mapping for stage ${stage.n}`);
    const [titleRu, purpose, who] = meta;
    const doc = stage.documentation || {};
    return {
      n: stage.n,
      title: stage.title,
      titleRu,
      phase: stage.phase,
      phaseRu: PHASES[stage.phase] || stage.phase,
      roles: list(stage.active_roles),
      independent: stage.independent === true,
      gate: stage.gate || null,
      purpose,
      who,
      inputs: list(doc.inputs),
      allowed: list(doc.allowed),
      forbidden: list(doc.forbidden),
      rules: list(doc.rules),
      creates: list(stage.contract?.creates),
      modifies: list(stage.contract?.modifies),
      instruction: buildInstruction(stage, titleRu, who)
    };
  });
  const header = [
    '// GENERATED by scripts/build-architecture-framework.js from',
    '// docs/Automation GPT комплект Документов/process/stages.json — do not edit by hand.',
    '// Stage catalogue of the "Разработка архитектуры" pipeline template.',
    ''
  ].join('\n');
  const body = `(function initArchitectureFramework(root) {
  'use strict';
  const STAGES = ${JSON.stringify(stages, null, 2)};
  const PHASES = ${JSON.stringify(PHASES, null, 2)};
  const freezeDeep = (value) => {
    if (value && typeof value === 'object') Object.values(value).forEach(freezeDeep);
    return Object.freeze(value);
  };
  freezeDeep(STAGES);

  const byNumber = (n) => STAGES.find((stage) => stage.n === Number(n)) || null;

  // Which of the selected models work at a stage. Order of \`models\` matters:
  // the first one leads (Producer / Synthesizer / Decision Closer), the next one
  // reviews, so the reviewer is never the author when there are two or more.
  function participantsFor(stage, models = []) {
    const list = Array.isArray(models) ? models.filter(Boolean) : [];
    if (!stage || !list.length || stage.who === 'gate') return [];
    if (stage.who === 'all') return list.slice();
    if (stage.who === 'review') return [list[1 % list.length]];
    return [list[0]];
  }

  const api = Object.freeze({ VERSION: 1, STAGES, PHASES, byNumber, participantsFor });
  root.ArchitectureFramework = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
`;
  return header + body;
}

if (require.main === module) {
  const output = build();
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : '';
    if (current !== output) {
      console.error('disput/architecture-framework.js is stale: run node scripts/build-architecture-framework.js');
      process.exit(1);
    }
    console.log('architecture framework up to date');
  } else {
    fs.writeFileSync(TARGET, output);
    console.log(`wrote ${path.relative(ROOT, TARGET)}`);
  }
}

module.exports = { build, STAGES };
