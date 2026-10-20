# Проход вверх по ответу (materialization sweep)

**Зачем.** Часть блоков ответа страница модели рисует только когда они попадают в область видимости (ChatGPT: Mermaid-диаграммы,
до этого на их месте `div[role="status"][aria-label="Загрузка диаграммы Mermaid"]`). После генерации страница стоит внизу, верхние
блоки остаются заглушками — и в извлечённый ответ попадает только то, что нарисовано. Решение универсальное, без селекторов провайдера:
после подтверждённого конца генерации и прокрутки вниз пройти вверх по ответу, затем вернуться.

**Модуль.** `shared/answer-materialize-sweep.js` (`window.AnswerMaterializeSweep.run(options)`), в `manifest.json` и `dist/content-lib.js`.

**Где вызывается.**
- Основной путь: `content-utils/response-lifecycle-detector.js`, `MaterializationHydrationGate.materialize` → после `forceBottom` вызывается
  `expandDeferred` (раньше пустой хук) → `AnswerMaterializeSweep.run({ answerEl: tracker.latestAnswerEl })`, затем штатные `waitForSettle` и повторный
  `capture`; изменившийся ответ даёт обычный свидетель `CONTENT_PROGRESS` (подтверждённый результат, не активность).
- Get it / ручной сбор: `runPreCollectScrollNudge(..., { getIt })` (`background/job-orchestrator.js`) сразу после прокрутки вниз, внутри focus lock;
  `runMaterializeSweepInTab` при необходимости внедряет модуль в вкладку.

**Алгоритм.** Прокручиваемый предок ответа (или самый большой scrollable под `main`) → шаги вверх по 0,6 высоты окна с паузой на «тишину» DOM
(250 мс, потолок 600 мс; MutationObserver только читает) до тех пор, пока начало ответа не в окне (без известного ответа — не больше 12 шагов).
Затем каждая «несозревшая» заглушка (`role=status`/`aria-busy=true`, подпись/текст про загрузку/диаграмму/rendering, внутри нет svg/img/canvas/pre)
подводится в центр окна и ждётся до 1,5 с. Второй проход — только если изменились высота контейнера, число блоков или число заглушек. Позиция возвращается
(в том числе `column-reverse`). Ответ короче окна и страница без изменений с прошлого прохода — пропуск (`fits_viewport`/`no_scroller`/`unchanged_since_last_sweep`).

**Константы.** бюджет 10 с на модель (в Get it 8 с, отдельно от `LATE_COLLECT_*`), максимум 2 прохода, шаг 0,6, тишина 250 мс.

**Не признак жизни.** Проход не шлёт сообщений и heartbeat; пока он идёт (и 400 мс после) `globalThis.__AO_SWEEP_ACTIVE === true`, и наблюдатели активности
(`response-lifecycle-detector.js`, `unified-answer-watcher.js`) игнорируют изменения DOM. Любое `wheel`/`touchstart`/`keydown`/`mousedown` пользователя
останавливает проход, позиция возвращается (`reason: user_input`).

**Фоновая вкладка.** Ленивые блоки не рисуются без пересечений: проход не прокручивает, отчёт `visible:false, reason:page_hidden`; заглушки остаются и попадают
в html/Markdown как «диаграмма не отрисована страницей» (`answer-html-builder.js`). Get it активирует вкладку заранее (как и раньше), без новых прыжков фокуса.

**Событие телеметрии.** `ANSWER_MATERIALIZE_SWEEP`: `provider, passes, steps, durationMs, heightBefore/After, blocksBefore/After, placeholdersBefore/After, changed, visible, reason`
(`done | budget | user_input | page_hidden | fits_viewport | no_scroller | unchanged_since_last_sweep | no_document`).

**Тесты.** `tests/answer-materialize-sweep.test.js` (jsdom, заглушки + двойник IntersectionObserver), `tests/answer-materialize-sweep.browser.test.js`
(Chrome, настоящий IntersectionObserver; `RUN_HTML_EXPORT_BROWSER_TESTS=1`).

## Граница прохода: начало ПОСЛЕДНЕГО ответа

- `findAnswerElement(doc, provider)`: селекторы провайдера (`AnswerPipelineSelectors.PLATFORM_SELECTORS[...].messageRoot`), затем общие признаки; без сообщения пользователя, блока размышлений, контейнеров страницы (`AnswerHtmlBuilder`); берётся последний по документу и расширяется до хода (`expandToTurn`; расширение, проглотившее много текста, отвергается). Элемент, переданный вызывающим, расширяется до найденного хода.
- Проход идёт вверх, пока начало ответа не окажется в окне (запас `topReserve` = 0,25 окна), не больше `ceil(расстояние/шаг)+2` шагов; после последнего шага верх ответа подтягивается к верхней границе окна.
- Ответ не найден: не больше `unknownSteps` = 3 шагов (≈1,8 окна), в отчёте `note: 'answer_start_unknown'`.
- Отчёт: `answerFound`, `answerHeight`, `scrolledPx`, `stoppedBy` (`answer_top` | `budget` | `user_input` | `unknown_cap` | `fits_viewport`).
