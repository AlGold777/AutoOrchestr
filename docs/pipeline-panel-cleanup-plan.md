# План чистки pipeline panel (2.81.774)

База: ветка `claude/gracious-mccarthy-fe9lrh` (загруженная версия 2.81.774). Ревью по 2.81.700 устарело: `disput/` уже почищен (debate-storage-migrations, debate-protocols, debate-stage-types и др. удалены, `results/debate-plan-view-model`, `shared/debate-schema` тоже). Ниже только то, что подтверждено grep на 2.81.774.

Правила: каждая волна — отдельный коммит; после волны `npx jest --config tests/jest.config.js`; удаляется только то, у чего 0 ссылок в коде (тесты, правящие якорь, правятся вместе).

## Волна 1. Мёртвые функции results.js (0 вызовов)
- Заметки: mergeSelectedNotes, exportSelectedNotes, toggleSelectAll и осиротевшие после них хелперы (getSelectedNoteIdsByVisualOrder, normalizeNoteTextForMerge, buildSourceMetaLines, getSelectedNoteIds, buildChildrenLookup, getAllNoteIds, syncSelectAllIndicator — каждый перепроверяется после удаления).
- Дебаты: appendVerdictFeedEntry, downloadSerialDebateFlowMarkdown + buildSerialDebateFlowMarkdown, pushSerialDebateTimeline, buildDebateModeratorDispatchText, syncModeratorRouteAfterModelResponse, getDebateScheme, getHeaderModelNames, getActiveDebateSession, formatModelCardExportStamp, getDebateParticipantRoleText, syncAggregateProtocolState, markNewPageModelOpened, setDebateLengthByDelta, DEBATE_AUTO_TURN_RETRY_*, sleepDebateMs.
- Прочее: pruneEmptyTabs, runSelectedSession, getActiveProtocolMission, domActive, drawHorizontalConnectors, loadFavoriteEntriesFromStorage, buildAllLogsComparisonMarkdown, detectManualIntervention, snapshotAllLogs, getDisputeTemplateApi + getDisputeDefaultFormat (правка якоря в tests/pipeline-semi-auto.test.js), локальная buildResponsesList (проверить, что тест не опирается), bodyIncludesPipelinePage, одиночные объявления (comparisonPanel, proSection, sessionsPanel, devToolsPanel, expandCollapseIcon, pipelineModifiersHeader, latestTelemetrySnapshot, effectiveRoundLimit, debateSessionExportBtn), закомментированная строка short-checkbox.
- Заглушки: queueDebateCaseWrite/debateCaseWriteQueue/syncAggregateArtifactsToCase (с вызовом), storeNewPagesState/newPagesStorageKey (с вызовами и change-обработчиком), getHeaderModelButtonLimitEarly — упростить обе одинаковые ветки.
- window.PipelineNotes + savePipelineRun (нет потребителей).

## Волна 2. pipeline_panel.html
- Блок #comparative-analysis (+ правило .comparative-analysis), кнопка #prompt-export-html-btn (+ правила .prompt-export-btn), `<meta keywords>`, неиспользуемые классы без ссылок в JS/CSS/тестах, id pipelineFlow (если не якорь теста), дубли inline-стилей, «v8.0» в логотипе, `?v=` синхронизировать с версией.
- Не трогать: debate-session-left (его читает results.js), wrapper template-select (низкая уверенность — проверить чтение results.js).

## Волна 3. CSS
- Удалить полностью мёртвые правила (раздел A скрипта css-audit): app-controls, results-debate, modals-responsive, pipeline, devtools-selectors, notes-sidebar.
- Точные дубли (3 шт.), перекрытые декларации — удалять заведомо проигравшие.
- Необъявленные переменные --ca, --br, --bg2, --cm, --ct заменить на существующие токены; неиспользуемые переменные base.css удалить.
- Кандидаты «через общий префикс» — удалять только после ручной проверки по динамическим сборкам.

## Волна 4. Дубли и устаревшее в results.js (выполнено)
- stripBackgroundColorStyles: вложенная копия удалена, осталась верхнеуровневая.
- Миграции (buildSendOverridesFromLegacy, migrateBasicTemplateName, очистка пресетов, legacyView) оставлены: они живые (версия хранилища 9 — переименование Basic → Default) и защищают данные пользователя.
- exportSingleTemplate — обычная функция на 37 строк, переименование не требуется (оценка ревью «813 строк» была ошибочной).
- window.__* хуки без внешних ссылок — оставлены (могут вызываться из DevTools).

## Не делаем (причина)
- Слияние двух наборов выделения текста (ответы/дебаты) и унификация экспорта — рефакторинг с риском для поведения, не чистка.
- Необъявленные --ca, --br, --bg2, --cm, --ct (modals-responsive.css): `var()` без значения даёт inherit/initial, удаление деклараций может изменить вид — решать отдельно.
- Дубли хелперов в shared/ (hashText, normalizeStatus…) — то же.
- Телеметрия панели (proof-telemetry*, ~2800 строк) и legacy-адаптер — нужна проверка в рантайме.
- shared/log-replay-harness, utils/safe-mutex — подключает background/index.js.
- results/response-find-replace.js — нужен result_new.html.
- docs/Pipeline scenarios/Pre-Dispute и «КОНТЕКСТ ДЛЯ АНАЛИЗА» — архив пользователя, не код страницы.

## Завершение
Версия в manifest.json и package.json +1, `?v=` в pipeline_panel.html; обновить docs/Pipeline scenarios/basic-developer.md, если упомянуты удалённые имена (tests/basic-docs-refs.test.js); коммиты; ff-merge в основной чекаут; `grep '"version"'` там.
