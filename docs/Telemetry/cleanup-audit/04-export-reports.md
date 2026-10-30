# 04. Экспорт, отчёты, дайджесты (сжатый отчёт агента)

## Файлы

| Файл | Строк | Статус |
|---|---|---|
| `shared/telemetry-export.js` | 228 | мёртв: не подключён ни к HTML, ни к manifest, ни к воркеру; только тесты (`tests/telemetry-export.test.js`, `log-replay-harness.test.js:120,135`) |
| `shared/telemetry-export-runtime.js` | 158 | жив: клиент воркера для Full forensic и Canonical |
| `shared/telemetry-digest.js` | 440 | жив: формат Digest по умолчанию |
| `shared/report-digest.js` | 955 | жив: Extract (DIGEST 3.8.0, лимит 250000 байт) |
| `shared/telemetry-meta-delta.js` | 192 | жив, но это кодек хранилища (`DIAG_KEY`), не экспорт |
| `workers/telemetry-export-worker.js` | 57 | жив: только full и canonical |
| `results-telemetry-export-bootstrap.js` | 59 | жив: лёгкий загрузчик `results-devtools.js` |
| `scripts/telemetry-digest.js` | 23 | CLI над дайджестом |
| `scripts/summarize-report.js` | 46 | CLI (delivery и Disput) |
| `scripts/build-proof-telemetry-report.js` | 274 | CLI, UI не вызывает; `LEGACY_REPRODUCTION_ADAPTERS = []` |

`popup.js` и `results-shared.js` телеметрии не содержат.

## Что получает пользователь

Вкладка Telemetry (`result_new.html:591-700`): фильтры модели и задачи (7 пресетов); формат: Digest (по умолчанию), Canonical evidence, Full forensic; Export JSON (`results-devtools.js:1268-1417`); All Logs MD (`results.js:17283-17336`); Clear all; B1 skeletons; Export Diagnostics HTML (общий и по моделям). При ошибке воркера скачивается canonical recovery; таймауты: общий 20 с, стадии 5-15 с. Для задач не «all» скачиваются incident-отчёты, формат Digest молча игнорируется.

Вкладка Disput: JSON (`results.js:17184-17210`), MD (`17139-17165`), Extract (`17213-17258`, два файла: полный JSON и `extract_transport_*.md`), Only problems (только отображение). Экспорт Disput пишет в активный трейс (`results.js:22086-22096`, `2987-2994`).

Размеры (по документации): Digest 20 событий 163 КБ → 2,3 КБ; 2180 событий 3,2 МБ → 44 КБ. Полный all-presets около 640 КБ. Сырой транспортный JSON Disput около 1,2 МБ, его Markdown 30-135 КБ.

## Что анализирует

- `telemetry-digest.js`: `EXCEPTION_TYPES` (14), `READ_TYPES` (6), `PROGRESS_TYPES` (20), `IGNORED_TYPES`; дедупликация повторов; `capProgress` (60 шагов: голова 20, хвост 40); «старый ответ» по порогу ±60 символов (строка 264, эвристика); голодные lease; блокеры по `ruleId`; контракт читателя в начале файла.
- `report-digest.js`: `terminalPairWindowMs 50`, длительность LONG (> 3×медиана или > 120000 мс), фильтр шума (`NOISE_LABEL`, `ROUTINE_*`), regex проблем (679, 837), `criticalCategory` (838-848), join по `requestId` → `dispatchId` → этап/модель (127-185), компактный режим при > 250000 байт.

## Пересечения

- `scripts/summarize-report.js:26` и кнопка Extract дают одно и то же (`summarizeDisputFlow`).
- Два рендера внутри `report-digest.js` (592 и 830) с общими фрагментами.
- Четыре генератора Markdown для Disput: `DebateTraceProjections.toMarkdown`, fallback `buildDisputTelemetryMarkdown` (`results.js:22127-22162`), `MessageDeliveryView.buildMarkdown`, `renderTransportMarkdown`.
- `build-proof-telemetry-report.js` повторяет путь воркера офлайн.
- RUN_SUMMARY: `shared/telemetry-export.js` (мёртв) и `results.js` `buildRunOutcomeSummaryMarkdown` (16550).

## Мёртвое и полумёртвое

`shared/telemetry-export.js` целиком; `results.js:22164-22180` (`buildSerialDebateFlowMarkdown`, `downloadSerialDebateFlowMarkdown`); `results-devtools.js:7-10`, `1088-1100`, `1422-1468` (refresh/reset/copy без элементов в HTML); `results.js:2212-2216`, `14718-14766` (таблица селекторной телеметрии без элементов); ветка `#export-all-logs-md` без элемента (`results.js:17283, 17302`); `summarizeDelivery` (`report-digest.js:878-916`) только в CLI; shadow-сравнение по флагу `proofTelemetryShadowCompare` (`results-devtools.js:1393-1406`). Инструкция «uncheck the `digest` checkbox» (`telemetry-digest.js:337`) устарела.

## Что заменить на «сырьё + запрос»

Заменимо: проекция `telemetry-digest.js`, Canonical и Full forensic с воркером, runtime, bootstrap (около 274 строк), `build-proof-telemetry-report.js`, `renderTransportOverview` и `summarizeDelivery`, два CLI-обёртки (объединить в один). Оставить: ядро `report-digest.js` (join и длительности; модель плохо считает медианы, это запрещено в `report-analysis-prompt.md:186-190`), `telemetry-meta-delta.js` (кодек хранилища, нужна миграция).

В `docs/Pipeline scenarios/Pre-Dispute/` лежат устаревшие копии `result_new.html` и `results.js`.

Не читались: `shared/proof-oriented-telemetry.js`, `proof-telemetry-incidents.js`, `proof-telemetry-presentations.js`, `debate-trace-projections.js`, `message-delivery-view.js`.
