# Задание: метка ответа модели и проверка секретов (главная страница), версия 2.81.1081

Ты — исполнитель в команде (docs/Agents/agent-team.md). Работаешь в worktree
`/Users/restart/Documents/GitHub/AutoOrchestr/.claude/worktrees/qwen-capabilities-analysis-4331af`, ветка `claude/qwen-capabilities-analysis-4331af`.
Не коммить: коммит делает ведущий. Чужие файлы не трогай. Не создавай новых документов, кроме указанных.

Принцип: приложение не оценивает смысл. Модель только подсказывает, приложение проверяет одно — что цитата дословно есть в тексте ответа. Решает владелец. Отправка, приёмка ответов, статусы и карточки не меняются.

Прочитай сначала: `disput/local-model.js` (FEATURES, post, reviewReply, squeeze, buildObservationRequest, checkObservation, addLog), `results/local-model-main.js`, `tests/local-model-main.test.js`, `tests/local-model-features.test.js`, абзацы о локальной модели в `docs/Pipeline scenarios/basic-developer.md` (строки около 88–104).

## 1. Метка ответа (`main_answer_label`)

### Реестр
В `LocalModel.FEATURES` добавить:
`{ id: 'main_answer_label', page: 'main', label: 'Метка ответа: отказ, обрыв, не по вопросу', group: 'Ответы моделей', level: 'hint', defaultOn: true }`.
`defaultOn: true` — иначе главная по умолчанию окажется в режиме «Свой», а не Middle.

### Вызов модели (`disput/local-model.js`)
Новые экспорты: `ANSWER_LABELS`, `buildAnswerLabelRequest(prompt, answer, context='')`, `checkAnswerLabel(raw, answer)`, `labelAnswer({ prompt, answer, participant }, { fetchImpl, signal, log } = {})`, `answerLabelLine(participant, result)`.

- `ANSWER_LABELS` (enum): `ok` — обычный ответ на вопрос; `refusal` — модель отказалась отвечать или ответила, что не может; `cut_off` — ответ оборван на полуслове или явно не закончен; `off_topic` — ответ не на заданный вопрос (в том числе только пересказ вопроса); `unclear` — не понятно.
- Текст для owner в строке: refusal «похоже на отказ», cut_off «похоже, ответ оборван», off_topic «похоже, ответ не на вопрос».
- Вход: вопрос — первые 1000 символов `prompt`; ответ — если длиннее 4000 символов, то первые 2000 + «\n…\n» + последние 2000. Промпт на русском, по образцу `buildObservationPrompt`: роли, описание каждой метки, `quote` — дословная фраза из ОТВЕТА до 200 символов, на которой основан вывод; для `ok` и `unclear` — пустая строка. Ответь JSON.
- Запрос: `stream:false, think:false, keep_alive:'10m'`, `format` — JSON-схема `{label: enum ANSWER_LABELS, quote: string}`, обе обязательны, `options: { temperature: 0, num_ctx: 8192, num_predict: 160 }`, модель `modelId()`. Контекст владельца (`contextOf(loadState())`) — как system, как у других функций.
- Через `post(..., { priority: 'owner_hint', signal, fetchImpl })`.
- `checkAnswerLabel`: битый JSON или метка не из enum → `{ problem: { kind: 'bad_reply' } }`; `ok`/`unclear` → `{}`; иначе цитата проверяется как в `reviewReply` (squeeze, части вокруг многоточия, `MIN_QUOTE_CHARS`) по тексту ОТВЕТА, который ушёл модели; не прошла → `{ problem: { kind: 'quote_rejected', detail } }`; прошла → `{ result: { label, quote } }`.
- `labelAnswer`: возвращает `{label, quote}` или `null`; проблемы пишет в журнал (`addLog`) с именем участника; никогда не бросает. Сервис недоступен — как у других функций (`problem.kind` из `post`), в журнал, `null`.
- `answerLabelLine('GPT', r)` → `GPT: похоже на отказ. «цитата»`.

### Главная страница (`results/local-model-main.js`)
- `begin(names, prompt)` — запоминает текст запроса. В `results.js` (около строки 25633) вызов поменять на `window.LocalModelMain?.begin(selectedLLMs, finalPrompt)`.
- Ввести счётчик запросов: `begin` и `stop` увеличивают его. Асинхронный результат (и метки, и `look`) показывается, только если счётчик не изменился с момента вызова. Так поздний результат прошлого запроса не попадает в карточку нового (снимает известное ограничение из CHANGELOG 2.81.1079; запись о нём там исправь).
- `noteAnswer(name, text)`: пустой текст — как сейчас (`look`). Непустой — если `api.feature('main_answer_label')`, один раз на модель за запрос вызвать `api.labelAnswer({ prompt, answer: text, participant: name })`; результат не `null` → `setLine(name, api.answerLabelLine(name, result))`.
- Строка та же (`.local-model-look`), уходит так же: новый запрос, очистка карточки, «очистить всё». Успешный статус после метки строку НЕ должен стирать: сейчас `noteStatus` при финальном неошибочном статусе делает `setLine(name, '')` — порядок статуса и финального ответа не гарантирован. Стирание по успешному статусу убрать совсем: строка `look` и так относится только к текущему запросу.
- Всё внутри `safe()`, ошибки до страницы не доходят.

## 2. Проверка секретов перед отправкой (код, без модели)

- Новый файл `shared/secret-check.js`: `SecretCheck.find(text)` → массив названий найденного без повторов, напр. `['ключ API', 'номер карты']`. Значения не возвращать и никуда не писать.
- Только надёжные шаблоны: `sk-ant-…`, `sk-…` (≥20 символов после префикса), GitHub `gh[pousr]_…` (≥30), AWS `AKIA[0-9A-Z]{16}`, Google `AIza[0-9A-Za-z_-]{35}`, Slack `xox[baprs]-…`, блок `-----BEGIN … PRIVATE KEY-----`, JWT `eyJ….eyJ….…`, номер карты 13–19 цифр (пробелы и дефисы между группами допустимы) с проверкой Луна. Почту и телефоны не искать.
- Подключить в `result_new.html` до `results.js`. В `results.js` в обработчике запуска главной страницы, после `applySelectedModifiersToPrompt` и проверки выбранных моделей, до `replaceCurrentMainRequestIds`: если `window.SecretCheck?.find(finalPrompt)` не пуст — `window.confirm('В тексте запроса похоже на: ключ API, номер карты. Он уйдёт во все выбранные модели. Отправить?')`; «Отмена» — запрос не отправляется, текст остаётся в поле. Ничего не найдено — без окна.
- На панели pipeline не подключать.

## 3. Тесты
- `tests/local-model-main.test.js`: метка показана для refusal с верной цитатой; выдуманная цитата — строки нет; `ok` — строки нет; функция выключена — `labelAnswer` не вызван; один вызов на модель за запрос; поздний результат после нового `begin` и после `stop` не показывается (и для метки, и для `look`); успешный статус после метки строку не стирает; `begin` получает текст запроса (проверка исходника `results.js`).
- Тесты `checkAnswerLabel`, `buildAnswerLabelRequest` (обрезка 2000+2000, вопрос 1000, схема format, priority через `post`) — в `tests/local-model-main.test.js` или новом `tests/local-model-answer-label.test.js`.
- `tests/secret-check.test.js`: каждый шаблон находится; валидная карта находится, невалидная по Луна — нет; обычный текст, почта, телефон, длинные числа без Луна, слово «sk-» в тексте — не находятся; значения в результате нет; подключение в `result_new.html` до `results.js` и отсутствие в `pipeline_panel.html`.
- Обновить существующие ожидания: список функций главной теперь три (`main_stall_watch`, `main_failure_look`, `main_answer_label`), `featureState` в тесте режимов.
- Прогон: `npx jest tests/local-model tests/secret-check tests/basic-docs-refs tests/basic-schema-guide` — всё зелёное; затем `npx jest 2>&1 | tail -40` — падать могут только 6 известных: custom-run-resume-wiring, custom-run-chat-bindings, basic-round-file-drop, composer-fast-preflight, basic-canvas-cover-tooltips, get-it-delivery-token-turn.

## 4. Документы и версия
- `docs/Pipeline scenarios/basic-developer.md`: в абзаце о функциях — `main_answer_label` (что даёт, что приложение проверяет только дословность цитаты, счётчик запросов); строки таблицы файлов для `shared/secret-check.js`; в строке `disput/local-model.js` — новые экспорты. Фразу «новая функция в будущем выключена» заменить на «функция, которой нужна более сильная модель, выключена по умолчанию».
- `docs/Agents/agent-extension-pages-spec.md`: в разделе главной — метка в карточке и окно подтверждения при секретах (`window.confirm`).
- `docs/CHANGELOG.md`: запись 2.81.1081.
- `manifest.json`, `package.json`: 2.81.1081.
- Формулировки простые, короткие.

## Отчёт
Список изменённых файлов, результаты обоих прогонов тестов (числа), что не сделано и почему.
