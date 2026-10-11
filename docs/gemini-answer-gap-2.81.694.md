# Gemini answer gap — 2.81.694

## Причина и сравнение с эталоном

`content-scripts/answer-structure.js:51` исключает `cdk-visually-hidden` / `screen-reader` из структурного текста. До исправления `linearizeText` (`:72`) превращал «заголовок размышления + Ответ Gemini» в один заголовок. Поэтому новая защита 2.81.693 в `shared/answer-content-classifier.js:68` не видела метку и считала заголовок допустимым ответом. Текст и HTML расходились: текст мог содержать заголовок, HTML — заголовок и метку. Это воспроизведено на исходном коммите `3da66a63`, а не выведено только из длины ответа.

В `/Users/restart/Documents/GitHub/2.81.604 !!!!!!!!!!!!` структурное извлечение, TurnResolver и UnifiedAnswerPipeline совпадают с исходной 2.81.693 в этой части. Значит, ошибка границы содержимого уже существовала в эталоне; сам факт совпадения не объясняет наблюдаемую разницу запусков. Существенное отличие background — добавленный после эталона `startStaticAnswerWatchdog` / `runStaticAnswerWatchTick` (`background/job-orchestrator.js:10063`): тишина в сохранённом тексте теперь вызывает принудительный commit после 30 секунд. Защита 2.81.691 проверяет окончание текста меткой, но её уже мог удалить структурный извлекатель. Без телеметрии конкретного дефектного запуска нельзя доказать, какой из перечисленных каналов закрыл каждый из трёх раундов.

## Все пути к телу карточки

Строки ниже относятся к исправленной 2.81.694. Общий конец доставки: `background/job-orchestrator.js:9656` публикует терминальный `LLM_PARTIAL_RESPONSE`, а `:9389` — нетерминальный кандидат, когда финализация заблокирована; `results.js:18970` принимает сообщение, `:18984` вызывает `updateDebateModelCardOutput` (`:23813`), далее `appendDebateFeedEntry` (`:23589`) и `renderDebateResponseBody` (`:22472`). Последний использует `resolveCompleteAnswerHtml` (`:19327`).

| Канал | Цепочка и возможность дефекта до исправления |
| --- | --- |
| Основной pipeline | `content-gemini.js:1582` → `tryGeminiPipeline :513` → `unified-answer-pipeline.js:1230` → `turn-resolver.js:157` → `answer-structure.js:72`; watcher читает тем же способом (`unified-answer-watcher.js:1120`). Скрытая метка удалялась до классификации; заголовок мог стать кандидатом. Callback `content-gemini.js:1584` и listener `:1780` отправляют `LLM_RESPONSE` / `FINAL_LLM_RESPONSE` → `message-router.js:2410` / `:2460` → `job-orchestrator.js:8269` → общий конец доставки. |
| Повторный запрос и legacy DOM | Повторный GET_ANSWER: `content-gemini.js:1161`, `:1188`; обычный fallback: `:1613`, `:1628` → `waitForFreshGeminiAnswer :197` / `grabLatestAssistantMarkup :72` → тот же listener `:1780`, router и background. Просматривались вложенные узлы и прежние ответы; фильтр имел предел заголовка 120 символов. Снимок объявлялся свежим после двух одинаковых наблюдений. Если baseline отсутствовал, предыдущий полный ответ мог заполнить паузу нового. |
| SelectorFinder | `content-gemini.js:1646` → `trySelectorFinderResponse :123` → возврат строки `:1652` → listener, router и background. До исправления здесь проверялся baseline, но отсутствовала проверка «тело ответа ещё не появилось». |
| Наблюдатель снимков | `content-utils.js:1272` → observer `:1349` → `ANSWER_SNAPSHOT :1359` → `message-router.js:3771` / `:3792` → `job-orchestrator.js:654` (cache) → `lateCollectAnswer :858` → `acceptLateCollectResult :1103` / `recoverAnswerViaDomSnapshot :1892` → `handleLLMResponse :8269`. Входной порог 80 символов отсекает именно 12-символьную метку и заголовки 28–46 символов; этот канал сам по себе не объясняет их при стандартном пороге. Но длинное размышление могло пройти, а восстановление ранее сохранённых кандидатов имеет отдельные входы. |
| Inline recovery / Get it / materialize | `job-orchestrator.js:323` → `runInlineLateExtract :843` → `lateCollectAnswer :858` → `acceptLateCollectResult :1103`; materialize дополнительно проходит `shouldAcceptMaterializeRecoveryResult :2110`, затем `acceptLateCollectResult :2418` либо публикует unverified artifact (`:2178`, отправка `:2216`). Извлекатель выбирал среди обёртки и вложенного announcer; некоторые операции используют сниженный minChars. Публикация позднего улучшения (`:1319`) и unverified artifact происходила до обычной классификации `handleLLMResponse`. |
| Принудительное сохранение | Сохранённый кандидат → `runStaticAnswerWatchTick :10063` либо завершение визитов (`background/human-presence.js:295`, вызовы `commitIncompleteAnswer :315` и `:1107`) → `dispatch-coordinator.js:465` → `handleLLMResponse`. Проверка `answerHasNoBodyYet :461` не распознаёт заголовок, если метка была удалена раньше. Deferred/deadline-пути тоже возвращаются в `handleLLMResponse`, поэтому новый ранний guard `job-orchestrator.js:8304` закрывает их для сырого текста с меткой. |
| Отображение и Δ | `results.js:19327` раньше выбирал HTML с одной меткой для короткого готового текста: пороги 120/200 символов не включали такой случай. Кроме того, `appendPostTerminalAnswerRevision :23465` сохранял уже закрытое тело: если новый ответ не продолжал «заголовок + Ответ Gemini» дословно, он попадал в отдельную скрытую revision (`:23565`), отображаемую через Δ. Это не новый путь извлечения, а причина, почему настоящий поздний ответ не исправлял основную карточку. |

В `results.js:18415` восстановление из GLOBAL_STATE также проходит `resolveCompleteAnswerHtml` и `updateDebateModelCardOutput`; оно повторно отображает сохранённый payload, а не извлекает Gemini из DOM. История карточек сохраняет ранее принятый текст: новый запуск исправляет сбор, а уже закрытый placeholder заменяется при приходе настоящего ответа того же запроса/раунда.

## Исправление

- Проверка наличия тела по исходному Gemini turn выполняется **до** удаления служебных узлов. Готовый ответ сохраняет метку.
- Вложенные кандидаты Gemini объединяются в целый turn; legacy и snapshot extraction берут последний `model-response`, не возвращаясь к старым ответам во время паузы.
- Fallback delivery, late collect и materialize отвергают метку/размышление до публикации или терминального решения; такой текст означает ожидание ответа, а не ошибку генерации.
- Настоящий ответ заменяет закрытый placeholder в основном теле карточки. Если HTML ещё содержит только метку/заголовок, отображается уже полученный текст без порогов его длины.

Метка не удаляется из готового ответа. Вёрстка ленты и `.moderator-input` не изменены.

## Проверка

`npm test -- --runInBand --silent tests/gemini-answer-gap.test.js`

Один и тот же тест скопирован в временный detached checkout тега `before-gemini-answer-gap-2.81.693` и запущен там: **до — 8 failed / 2 passed; после — 10 passed**. Fake timers воспроизводят 13.5 секунды до первых слов, затем полный ответ с `[[AO-abc123]]`. Проверены DOM/legacy collection, inline recovery с доступными и недоступными content helpers, late snapshots, stale HTML и замена закрытого placeholder в основном теле.

Связанный прогон 11 наборов (gap, snapshot gates, stale response, automation telemetry, answer structure, watcher guards, LeChat extraction, materialize recovery, manual recovery, lifecycle structure и terminal recovery): **118 passed**. Один промежуточный прогон поймал существующую чувствительность watcher-теста к 1 ms (`449999` вместо `450000`); изолированный повтор и финальный связанный прогон прошли.

Общий прогон `npm test -- --runInBand --silent`: **313 наборов прошли, 6 упали; 2796 passed / 20 failed**. Все 20 падений отдельно подтверждены на чистом исходном коммите: 4 в results-debate-favorites, 7 в pipeline-feed-layout, 5 в release-log-regressions, 2 в pipeline-semi-auto, 1 в telemetry-export-actions и 1 в results-ui-recovery-triggers. Их код/ожидания не изменялись. После последних правок выполнен повтор всех наборов, кроме этих шести подтверждённо падающих: **313 наборов / 2540 тестов прошли**. Команда: `npm test -- --runInBand --silent --testPathIgnorePatterns 'results-debate-favorites.test.js|pipeline-feed-layout.test.js|release-log-regressions.test.js|pipeline-semi-auto.test.js|telemetry-export-actions.test.js|results-ui-recovery-triggers.test.js'`.

## Не проверено на живом Gemini

- Basic-пайплайн в три раунда после перезагрузки расширения и вкладки Gemini.
- Работа настоящих stop/copy controls и остановка DOM-наблюдателей при SPA navigation.
- Посимвольное совпадение ответов страницы, сообщения background и карточки на реальных трёх раундах.
- Конкретный канал преждевременного закрытия раунда из пользовательского запуска: актуальной телеметрии этого запуска в репозитории нет.

Разница длин `2143/2238` или `1946/2105` сама по себе не доказывает обрезку: структурный текст нормализует пробелы и исключает служебные узлы. Вложенные фрагменты действительно могли выбираться вместо всего turn; это исправлено, но конкретную потерю символов в полевом запуске без исходных payload/DOM доказать нельзя. `Cleanup triggered: spa_navigation:url_change` снимает listener (`content-gemini.js:493`, `:1814`) и может включить recovery, но не создаёт текст «Ответ Gemini»; он берётся из DOM.
