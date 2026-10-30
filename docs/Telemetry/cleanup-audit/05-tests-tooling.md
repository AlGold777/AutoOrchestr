# 05. Тесты и инструменты (сжатый отчёт агента)

Тесты не запускались (`node_modules` отсутствует). Слова `export` и `digest` цепляют лишнее (`module.exports`, Debate export, Extract).

## Сводка

116 тестовых файлов содержат слово telemetry, 67 ссылаются на модули телеметрии. Чисто телеметрийных около 44, смешанных около 50.

Жёсткие зависимости, похожие на телеметрию, но рабочие: `background/telemetry-logs.js` (816 строк, реестр лейблов); `shared/log-replay-harness.js` (грузится в service worker, `background/index.js:240`); `shared/decision-ledger.js`.

## Чисто телеметрийные (падают вместе с модулями)

`proof-oriented-telemetry`, `proof-telemetry-{audit,clock,contracts,field-validation,final-acceptance,incidents,inventory,ledger,measurement,policy,presentations,preset-semantics,report-cli,scenarios,semantic-comparator,semantic-r2,semantic-r3,stress-gates,validator,canonical-evidence,store,session-scope,browser-load-order}`, `dispatch-readiness-telemetry`, `provider-dispatch-stage-telemetry`, `false-success-effectiveness`, `user-focus-observation`, `telemetry-digest`, `telemetry-digest-coverage`, `telemetry-export`, `telemetry-export-runtime`, `telemetry-export-worker`, `telemetry-export-bootstrap`, `telemetry-export-actions`, `telemetry-export-filename`, `telemetry-model-filter`, `telemetry-clear-all`, `telemetry-markdown-export-regression`, `telemetry-retention-regression`, `telemetry-meta-delta`, `pinned-telemetry-labels`, `debate-telemetry-view`; `telemetry-devtools-check.js` (Playwright, ручной, `package.json:8`).

Зависят от рабочих файлов `telemetry-logs.js`/`message-router.js`: `telemetry-markdown-export-regression`, `telemetry-retention-regression`, `pinned-telemetry-labels`, `proof-telemetry-session-scope`.

## Смешанные: чтение исходного кода и поиск лейблов (опасно)

- `dispatch-baseline-stale-guard.test.js:42-103, 133`: лейблы `RECOVERY_BLOCKED_SUBMIT_UNCONFIRMED`, `STALE_BASELINE_ANSWER_IGNORED`, `RECOVERY_STALE_BASELINE_REJECTED` в `telemetry-logs.js`.
- `prompts-by-model.test.js:66`, `dispatch-correlation-contract.test.js:13-17`, `extension-reload-reset.test.js:61-62`, `results-ui-recovery-triggers.test.js:40-41`, `diagnostics-burst-storage.test.js:5`, `disput-diagnostic-adapter.test.js:40-42`, `post-terminal-diagnostics.test.js:70,131-156`, `lechat-submit-method-visibility.test.js:7-8,47-93`.

## Смешанные: поведение с проверкой событий

`round4-gate` (:110-345), `lifecycle-sender-gate` (:258-701), `human-presence-lease` (:180-290), `tab-manager-session-scope` (:226-432), `universal-dispatch-recovery` (:148-429), `materialize-recovery-finality` (:295-442), `early-terminal-guard` (:1056), `model-run-telemetry` (:61-185), `answer-length-policy` (:168-206), `precollect-scroll-render`, `round1-simple-pass`, `round1-independent-preparation`, `health-monitor-terminal-state`, `recovery-deny-throttle`, `final-stability-retry`, `trusted-provider-dispatch-runtime`, `run-result-background-gate`, `release-log-regressions`. `automation-telemetry.test.js` по имени про телеметрию, по содержимому про Automation tab и Disput export.

## Рабочие модули с похожими именами (не удалять по имени)

`log-replay-harness.test.js`, `finalization-backoff-and-replay.test.js`, `finalization-evidence.test.js`, `decision-ledger.test.js`, `prompt-insertion-proof-contract.test.js`, `report-digest-*`, `custom-extract`, `disput-extract`, `summarize-report`, `polishing-pipeline`, `debate-export`, `modifier-bootstrap-reset`, `results-debate-favorites` (4218 строк).

## Фикстуры и артефакты

- `tests/replay-fixtures/telemetry-1781134749690.json` (3334 строки, 97,5 КБ): только `log-replay-harness.test.js:124`.
- `tests/fixtures/proof-telemetry-scenario-matrix.js`: 4 теста proof-telemetry.
- `logs.json` (корень, 13 КБ): ни код, ни тест не читают.
- `artifacts/manual-auth-smoke-report.json`: не телеметрия, содержит путь `/Users/restart/...`.
- `benchmarks/`: Debate-бенчмарк, без телеметрии.

## Скрипты и `package.json`

- `analyze-proof-telemetry-size.js` (`measure:telemetry`), `run-proof-telemetry-stress.js` (`test:telemetry-stress`), `validate-proof-telemetry.js` (`validate:telemetry`, требует `ajv/dist/2020`), `validate-proof-telemetry-field.js`, `build-proof-telemetry-report.js` (`build:telemetry-report`): актуальны.
- `generate-proof-telemetry-examples.js`: нигде не используется, перезаписывает `telemetry-spec`.
- `tmp-run-telemetry-check.js`: жёсткие пути `/Users/restart/Downloads/LLM_Codex`, не в `package.json`.
- `scripts/telemetry-digest.js`, `summarize-report.js`: не в `package.json`.
- `test:telemetry-parity` запускает только `proof-telemetry-semantic-comparator.test.js`.
- `ajv` не объявлена в `package.json`, только транзитивно (`package-lock.json:1662`); на неё опираются `proof-telemetry-contracts`, `proof-telemetry-validator` и `validate-proof-telemetry.js:4`.
- CI-конфигов (`.github`) нет.

## Рекомендации

Сначала переписать или удалить тесты на строки лейблов, затем менять продакшен. В смешанных поведенческих убрать телеметрийные проверки или заменить поведенческими. Отдельно решить судьбу `decision-ledger`, `log-replay-harness`, `report-digest`. Объявить `ajv` или убрать зависимость валидатора.
