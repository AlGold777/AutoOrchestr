# 01. Документы и спецификации (сжатый отчёт агента)

## Инвентаризация

- `docs/Telemetry/telemetry.md`: 121 КБ, 1706 строк. Строки 1-1034 (2.81.124-2.81.216) соответствуют коду по именам (344 идентификатора найдены; проверка слабая, только наличие строки). Строки 1035-1706 (2.54-2.81.74) историческая часть, включая устаревшие schema v2.54/v2.72.
- `telemetry-semi-auto-spec.md` (135 строк): ТЗ T1-T7. Реализованы T1 частично, T3-T7 в 2.81.523-525; T2 и `displayed` для остальных путей не сделаны.
- `automation-telemetry-brief.md` (85 строк): база 2.81.502, устарел; путь `docs/telemetry/` в нижнем регистре.
- `automation-telemetry-starter.diff`: `git apply --check` падает, не накладывается.
- `report-analysis-prompt.md` (193 строки): актуален; DIGEST 3.8.0 и лимит 250000 байт совпадают с `shared/report-digest.js:194-196`.
- `Reports/` (4 файла): датированные замеры 2026-10-03/04; лимит 70 КБ в одном из них заменён на 250000; ссылки на `/Users/restart/Downloads/`.
- `telemetry-spec/`: `README.md`, `SPECIFICATION.md` (1025 строк), `schemas/` (5), `registry/report-dependency-registry.json` (118 КБ, registryVersion 6.7.0), `all-presets.example.json` (270 КБ), `canonical-evidence.example.json` (163 КБ), `presets/*.example.json` (7 по 49-63 КБ).
- `КОНТЕКСТ ДЛЯ АНАЛИЗА/`: 7 файлов `*-Improvement-JUL30.txt`, 14 МБ, 333 тыс. строк, в git. Снимки кода 2.81.169. Ссылок на них нет. С текущим кодом расходятся: `job-orchestrator.js` на 2084 строки, `manifest.json` на 91.

## Карта понятий

- Ledger schema 6 (`EVENT_SCHEMA_VERSION = 6`, `shared/proof-telemetry-contracts.js:5`), слои fact/inference/decision/action/audit/system. Legacy schema 5 отдельным файлом.
- 13 осей состояния (`STATE_AXIS_NAMES`, `shared/proof-oriented-telemetry.js:40`).
- Контейнеры: `all-presets` (schema 5.0), `canonical-evidence` (2.81.230).
- Семь типов отчётов (`REPORT_TYPES`, `proof-oriented-telemetry.js:31-39`): cutted, false-success, old-answer, no-delivery, prompt-not-inserted, prompt-not-sent, late-end. Старый `empty` заменён на `no-delivery` (2.81.164).
- `REGISTRY_VERSION = '6.7.0'`, `REPORT_VERSION = '3.6.0'`, `GENERATOR_VERSION = 'proof-export@2.10.0'`.
- Отдельный контур: digest Transport Extract (`shared/report-digest.js`, `shared/telemetry-digest.js`).

## Расхождения с кодом

- `SPECIFICATION.md` Часть V: упоминает несуществующий `empty.example.json`; нет `no-delivery.example.json`, `canonical-evidence.example.json`, `canonical-evidence.schema.json`, `telemetry-event-v6.schema.json`; номера разделов `## 29.` ×3 (строки 702, 725, 905) и `## 30.` ×2 (773, 979).
- `telemetry.md:798` ссылается на несуществующий `docs/telemetry-field-validation-2026-08-02.md`.
- `telemetry.md` 2.81.124: `canonicalRuntimeEmissionPending=true`, в примере `false`. Исторические отчёты `request-not-sent`, `true-completion` и др. в коде отсутствуют.
- `telemetry.md:963`: ключ `__proof_telemetry_ledger_v5__`, в коде IndexedDB `proof-telemetry-v6`.
- `tmp-run-telemetry-check.js` tracked в git вопреки `.gitignore` (`tmp-run-*.js`); процедура в `telemetry.md:1082-1272` на него ссылается.

## Генерация и потребители

- Генератор `scripts/generate-proof-telemetry-examples.js` пишет `all-presets.example.json`, `canonical-evidence.example.json`, `registry/report-dependency-registry.json`, `presets/*.example.json`. Версия зашита `2.81.169` (строка 214). Генератор нигде не вызывается.
- Валидатор: 3 из 7 примеров (`old-answer`, `prompt-not-inserted`, `prompt-not-sent`) дают `TYPED_CANONICAL_CONFLICT`.
- `registry/report-dependency-registry.json` совпадает с `dependencyRegistrySnapshot()` (тест `tests/proof-telemetry-contracts.test.js:167-171`).
- Потребители: `all-presets.example.json` ← `scripts/analyze-proof-telemetry-size.js:108`, `tests/proof-telemetry-report-cli.test.js:109`. `canonical-evidence.example.json` и `presets/*.example.json`: тесты и runtime не читают. Схемы v6, all-presets, diagnostic-report, canonical-evidence ← `scripts/validate-proof-telemetry.js`. `telemetry-event.schema.json` (v5): потребителей нет.
- Ссылаются на docs/Telemetry: `docs/documentation-map.md:10`, `docs/Architecture - Многоагентные архитектуры и исследовательские пайплайны/model-tabs-architecture.md:186,613,1011`, `docs/project-overview.md:20`.

## Кандидаты на удаление или архив

`КОНТЕКСТ ДЛЯ АНАЛИЗА/`; `telemetry-event.schema.json`; `docs/Telemetry/Reports/`; `automation-telemetry-starter.diff` и `automation-telemetry-brief.md` (решение владельца); `presets/*.example.json` и `canonical-evidence.example.json` (после правки Части V); `telemetry.md` строки 1035-1706 в архив; `tmp-run-telemetry-check.js`.

Оставить: четыре актуальные схемы, реестр, `all-presets.example.json`, `telemetry-semi-auto-spec.md`.

## Не проверено

Гейтинг `startAutomationVisit` (`human-presence.js:1380-1396`) по `isModeratorDrivenRun`; смысловая сверка 344 идентификаторов; регенерация примеров не запускалась.
