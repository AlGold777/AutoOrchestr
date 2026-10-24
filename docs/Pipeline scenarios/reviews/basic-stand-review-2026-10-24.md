# Review движка Basic и стенда схем, 24.10.2026

Метод: 12 исполнителей Haiku искали кандидатов, сопоставляя две стороны контракта; главный инженер проверил цитаты grep'ом, трассировал кандидатов по коду и запускал сценарии. Код расширения не менялся, версия `manifest.json` не поднималась.

## 1. Версия и базовая линия

- Версия 2.81.851 (`/Users/restart/Documents/GitHub/AutoOrchestr/manifest.json`), коммит `c3d39b45` (стенд v48), основной чекаут и worktree на одном коммите.
- Базовая линия: `npx jest --config tests/jest.config.js tests/custom-engine*.test.js tests/custom-run-record.test.js tests/basic-*.test.js` → 20 наборов, 412 тестов, все зелёные. TEST-2 не упал.
- Итог review: P1 — 0, P2 — 7 (B-1, S-1…S-6), P3 — 10. Воспроизведены тестами `tests/review-b1.test.js`, `review-s1.test.js`, `review-s2.test.js` (8 тестов, все падают: тесты записывают правильное ожидание, они закоммичены красными намеренно; после исправления станут зелёными).

## 2. Находки Basic

**B-1 P2 — `validate` падает исключением на имени вида шага из `Object.prototype`.**
- Где: `disput/basic-schema.js:423` — `unknownKeys(step, [...(STEP_KEYS[step.kind] || STEP_KEYS.round), …`; `STEP_KEYS['toString']` — функция, spread даёт TypeError. До этой строки проверка `oneOf(step.kind, KINDS` (:434) не доходит.
- Условие: схема `{"schemaVersion":1,"origin":"user","steps":[{"ref":"r1","kind":"toString","models":[]}]}` (то же для `constructor`, `hasOwnProperty`).
- Что увидит пользователь: вместо «steps[0].kind: допустимо round, owner» — исключение «(STEP_KEYS[step.kind] || STEP_KEYS.round) is not iterable». Как его перехватывает страница при Import, не прослежено (`results.js`, `describeSchemaErrors` не читался).
- Доказательство: `tests/review-b1.test.js` (3 теста падают, вывод jest — TypeError на `basic-schema.js:423:50`).
- Исправление: `Object.hasOwn(STEP_KEYS, step.kind)` в строке 423; затрагивает только `validate`.

**B-2 P3 — первый раунд после шага User по умолчанию получает `input: "none"`, ответ User ему не передаётся.**
- Где: `disput/basic-schema.js:127-129` — `const roundIndex = rounds++;` / `const input = step.input || defaultInput(roundIndex);` (`defaultInput(0) === 'none'`, :106); счётчик не считает шаги User.
- Условие: схема `[owner, round]` без `input` у раунда. Проверено запуском: `assemble` даёт `{"kind":"round","ref":"r1","input":"none"}`.
- Что увидит пользователь: раунд не видит ответа User, пока `input` не задан явно. Решение (ожидаемо ли это) за владельцем; ожидание не задокументировано.
- Доказательство: трасса + запуск `assemble`. Тест не писался: правильное поведение не определено.

**B-3 P3 — превью запроса и реальный запрос расходятся при пустом предыдущем входе и при `promptTemplate`.**
- `previewPrompt`: `disput/custom-engine.js:1047-1048` — `const input = spec === 'none' || !plan.some(…) ? []` / `: [{ label: 'Вход', text: PLACEHOLDER[…] …` показывает вход, если предыдущий шаг существует; прогон при отсутствии принятых ответов даёт `return [];` (:596) и не добавляет блок (`if (input.length) {`, :121).
- С `promptTemplate`: `partsFor` (:601) помечает `extra` и `stepTask` как отправленные, `buildPrompt` при шаблоне (:111-118) их не добавляет.
- Поведение прогона от этого не страдает; страдает только превью. Не воспроизводилось.

**B-4 P3 — `discipline.ask` обрабатывается двумя путями по-разному.** `custom-engine.js:110` (`if (askInstruction && typeof model.discipline?.ask === 'string')`, нужен непустой общий `askInstruction`) и `:601` (`askInstruction: semiAuto ? (model.discipline?.ask ?? askInstruction) : ''`). Следствие: у модели с собственным `ask` при пустом общем инструкция есть в превью деталей, но не в запросе. Не воспроизводилось; страница `askInstruction` не передаёт (E7), поэтому при штатном пути затрагивается только `discipline.ask`.

**B-5 P3 — хвосты удалённого функционала (мёртвый код).** `BasicArtifacts.markInvalid` экспортирован (`disput/basic-artifacts.js:62`) и нигде не вызывается (grep по `disput`, `results.js`, `background`, `results`: единственное упоминание — само определение). Спящие ветки `valid === false`: `custom-engine.js:589`, `results.js:6734`, `basic-artifacts.js:54`. Исполняемых хвостов `goto/return/gate/route/synthesis/order/require` в цикле не найдено (E1, E7).

**B-6 P3 — слабые места `basic-output.js` при условии, что схема их допускает.** Указатель без ведущего `/` сдвигается (`:20` — `pointer.slice(1)`: `"result"` читает ключ `esult`); пустой раздел в `sections` совпадает с любым ответом (`:65`); `sections` игнорируются при `format: json` (`:58-63`); при `strictLength` слова считаются по `split(/\s+/)` (`:13`), поэтому ограждение ```` ```json ```` и знаки «—» идут в счёт; `register` с тем же `(lineage, source)` молча оставляет старую запись (`basic-artifacts.js:18-19`). Проверено только чтением; схема может отсекать часть до выхода (`validate`, `checkSource`) — не проверялось.

**B-7 P3 — снимок: проверка V07 неполная.** `setSnapshot` всегда пишет ключ `pc` (`custom-run-record.js:148` — `pc: state.pc ?? null,`), поэтому `isComplete` (:191 — `if (!('pc' in shape)`) не ловит отсутствие `pc`; `restoreRun` принимает `pc: null` как «прогон окончен» (`custom-engine.js:844-846`). В штатном пути `pc` всегда задан (`liveState`, :448), риск только при программном вызове `setSnapshot` без `state.pc`. Вложения: `canResume` не смотрит `attachmentsStored` (`custom-run-record.js:185-196`), отказ стоит на странице (`results.js:6675`) — защита есть, но в другом слое. Сверка схемы снимка с планом только по `ref` (`custom-engine.js:837-839`).

**B-8 P3 — `accept`/`parseAsks` страницы при отсутствии модуля молча «пропускают».** `results.js:7024` — `…evaluate?.({ text, meta: { completion } }) || { ok: true }`, `:7025` — `…?.askItems || []`. Без `DebateResponseAcceptance` проверка приёма отключена без сообщения.

## 3. Находки стенда

**S-1 P2 — Export теряет `run.maxWords` вне {300, 500, 700, 1000} без предупреждения.**
- Где: `basic-export.js:13` (`const RUN_WORDS = [300, 500, 700, 1000];`), `:79` (`if (RUN_WORDS.includes(schema.run.maxWords))`). Basic принимает любое целое > 0 (`basic-schema.js:294`), стенд при Apply только предупреждает (`stand.js:364`).
- Условие: `{"task":"T","run":{"maxWords":800},"steps":[…]}`. Файл Basic не содержит `run`, предупреждения нет.
- Доказательство: `tests/review-s1.test.js`, тест 1 (падает: Expected true, Received false).

**S-2 P2 — вход на этап `file` при Export молча превращается в `input: "none"`.**
- Где: `basic-export.js:32` (фильтр `pos.get(id) < pos.get(st.id)` отбрасывает ссылку на непереносимый шаг), `:51` (`step.input = input.length ? input : 'none';`), `:47` (предупреждение только про сам `file`).
- Условие: `[file s1, round s2 inputs:["s1"]]`. Раунд теряет вход, предупреждения о разорванной связи нет.
- Доказательство: `tests/review-s1.test.js`, тест 2 (падает; запуск показал `warnings: ["Этап s1 (file) не перенесён…"]` и `input: "none"`).

**S-3 P2 — ссылка `"s1.Артефакт"` при Export молча превращается во весь ответ этапа `r1`.** `basic-export.js:17` — `const stepOf = (ref) => String(ref).split('.')[0];`. Basic строкой артефакт адресовать не умеет (`basic-schema.js:196`), поэтому перенос даёт либо весь ответ, либо ничего; предупреждения нет. Доказательство: `tests/review-s1.test.js`, тест 3 (падает на проверке предупреждения).

**S-4 P2 — Import файла Basic включает модели с `enabled: false`.** `basic-export.js:105` — `const model = { name: m.name };` (копируются только `MODEL_COPY`); выключенная модель на стенде включена, предупреждения нет (запуск: `models: [{"name":"Claude"},{"name":"GPT"}]`, `warnings: []`). Доказательство: `tests/review-s2.test.js`, тест 1 (падает).

**S-5 P2 — Import теряет `input` шага Basic в форме строки (`all`, `previous`) и умолчание «previous».** `basic-export.js:91` — `Array.isArray(input) ?`, иначе `[]`. Раунд Basic без `input` (по умолчанию `previous`) или с `input: "all"` после Import не имеет `inputs`; при следующем Export он получает `input: "none"` (`:51`). Круговой обмен Basic → стенд → Basic молча меняет смысл схемы. Запуск: `input: "all"` → шаг без `inputs`, `warnings: []`. Доказательство: `tests/review-s2.test.js`, тест 2 (падает).

**S-6 P2 — превью запроса на стенде не добавляет задание раунда при входе «ничего».** `cards.js:96` — `if (step.input !== 'none' && own(task)) parts.push(…)`. Движок всегда добавляет «Задание» из `step.task` (`custom-engine.js:127-128`), окно приложения прямо говорит: при входе «ничего» отправляется только задание из этого окна (`results/stage-card.js:172`; `basic-windows.md:18`). Автор по стенду увидит запрос без задания. Исполнитель S3 дал цитаты обеих сторон; прогнано чтением, тест не писался (окна стенда требуют DOM).

**S-7 P3 — различия проверок стенда и Basic (таблица для переноса, §4).** Стенд мягче там, где Basic строже, и наоборот. Заметные случаи: `inputs: []` — Basic отказывает (`basic-schema.js:332`), стенд нет (`stand.js:461`); дубль источника во входах — Basic (`:337`), стенд нет; дубль модели в шаге — Basic (`:453`); `maxWords` модели строкой — стенд принимает с замечанием (`stand.js:322`), Basic отказывает (`basic-schema.js:463`); `order` — стенд предупреждение (`:434`), Basic ошибка (`:422`); `why` обязателен на стенде (`stand.js:431`), в Basic необязателен; неизвестное имя модели — стенд предупреждает (`:482`), Basic не проверяет (`:448`); ключи корня: стенд требует только `task`/`steps`, Basic — `schemaVersion` и `origin` (`:275`, `:278`), `task` для Basic — неизвестное поле (`:280`); раунд без `models` — стенд ошибка (`stand.js:449`), Basic допускает при наличии исполнимого шага (`:263`). Это различие форматов, не дефект; Export честно прогоняет `BasicSchema.validate` перед записью.

**S-8 P3 — роли и Send на холсте стенда.** `canvas.js:27` — значение выпадающего списка роли — подпись («Synthes»), в `cards.js:24` — id; cards.js:70 `if (id === 'custom')` не узнаёт «Custom» с холста. `canvas.js:299-301` — галочка Send и роль пишутся в `ProtoState`, но запрос строится из `item.enabled` (`cards.js:401`). Галочка Send убрана в Basic с 2.81.850, на стенде осталась. Влияние: только на прототип.

**S-9 P3 — документы стенда, которые код не подтверждает.**
- `CONTRACT.md:145` обещает замечание «Возврат назад … не перенесён» при Import; в `basic-export.js` и `stand.js` такого текста нет (grep пуст).
- `CONTRACT.md:70`: «неизвестное имя в `modelNotes` — значение не применяется»; код только предупреждает (`stand.js:351`) и применяет (`:517`, `:521`).
- `CONTRACT.md:97`, `README.md:144`: текст ошибки `gate` короче, чем в `stand.js:28` («…, затем поставьте этап owner…»).
- `README.md:21`: «корзина очищает только поле»; код очищает и комментарий модели (`stand.js:983`).
- `CONTRACT.md:118`: шаблон хранит `task/steps/defaults/run`; код также `version`, `description`, `artifacts` (`stand.js:1058`); при перезаписи — ещё `comment` (`:1184`).
- `CONTRACT.md:143`: файл Export `<task>.json`; код `${name} v${N}.json` (`stand.js:1293, 1298`, как и `CONTRACT.md:136`).
- `CONTRACT.md:82`: «замечание на каждое исправление»; код — одно общее «JSON исправлен автоматически: …» (`stand.js:211`).
- `CONTRACT.md:65`: подсказка ▶ — «тот же текст»; код обрезает до 400 знаков (`stand.js:732`).
- `CONTRACT.md:56-57`: в полях модели нет `task` (есть в `MODEL_KEYS`, `stand.js:54`).
- `CONTRACT.md:61`: замечание «Артефакт не передан»; код — длиннее (`stand.js:383`).
- `basic-windows.md:139` советует «оставьте Send у одной модели»; Send убран в 2.81.850 (из `basic-developer.md`, раздел 1; не ссылка на код).

## 4. Карта переноса стенд → Basic

| Элемент | Стенд | Basic | Что нужно для переноса | Готово |
|---|---|---|---|---|
| Этап `round` (id, title, why, task, models) | `stand.js` | `kind: round`, `ref`, `goal` | уже переносится `toBasic` | да |
| Этап `owner` (ask) | `block: owner` | `kind: owner`, `task` | пустой `ask` → «Дайте ответ» молча | да |
| Этап `file` | `block: file` | нет | вид шага в Basic, а до того — предупреждение о разорванных входах (S-2) | нет |
| `inputs` ссылкой на этап | `inputs: ["s1"]` | `input: [ref]` | — | да |
| `inputs` строкой `"s1.Артефакт"` | допустимо | только `{artifact:{step,participant,id},version}` | адрес артефакта, предупреждение (S-3) | нет |
| `in.Имя`, верхнеуровневые `artifacts` | допустимо | нет | вид «исходный артефакт» в Basic | нет |
| Артефакты этапа, `version` | имя + описание | `output.artifacts` с `pointer` | pointer на стенде отсутствует | нет |
| Модель: `name`, `maxWords`, `discipline` | `models[]` | `models[]` | — | да |
| Модель: `role` | подпись/текст | id роли | `roleIdOf` есть; без id роль уходит текстом в `task` | да |
| Модель: `task`, `enabled` | `task` есть, `enabled` нет | оба | Import теряет `enabled` (S-4) | частично |
| `defaults`: `roundTask`, `discipline`, `modelNotes` | есть | есть | `roundPrompts`, `synthesisTask` не переносятся | частично |
| `run.policy`, `run.maxWords` | оба | оба | допустить любое целое > 0 (S-1) | частично |
| `version` схемы | в шапке | нет | только в имени файла | нет |
| Проверки (`validate`) | мягкие | строгие | таблица различий S-7; Export уже гоняет `BasicSchema.validate` | частично |
| Окна раунда/модели/▶ | `cards.js` | `stage-card.js` | S-6 (вход «ничего»), S-8 (Send, роли) | частично |
| Холст: зона артефактов, версия в шапке | есть | нет | нет вида артефакта в Basic | нет |
| Автоисправление JSON, алиасы, комментарий модели | есть | нет | инструмент стенда, не переносится | н/п |
| Каталог шаблонов | файл на компьютере | запись в `chrome.storage` | инструмент стенда | н/п |

Итог: готово «да» — 6 элементов; «частично» — 5; «нет» — 6; не переносится по замыслу — 2.

## 5. Уже известно, зоны, проверенные не полностью

- Уже известно (не искали): REVIEW-1 (V01–V08, N04, R07), OI-5, V06, «Что не проверено вживую». V06 в этом review не воспроизвёлся (`validate` пропускает `input: none/all` у шага User; запуск), для проверки состояния записи «V06» в `basic-developer.md` стоит обновить.
- Опровергнуто трассировкой (не находки): окно паузы при Stop не закрывается (кандидаты E7 K-3/K-9 — закрывает `finally`, `results.js:7124-7127`); потеря вложений при resume (защита на странице, `results.js:6675`); «реестр не попадает в снимок» (страница передаёт его при resume отдельно, `results.js:7049`); участники одной модели с разными id (страница передаёт `sendParticipants`, `custom-engine.js:402`, поэтому `participant_transport_required` не срабатывает); «пропущенный шаг передаёт ранние ответы» — задумано (`custom-engine.js:588`); `previewPrompt` для удалённого вида — защищён (`:1044`); ответ, пришедший после Stop, принимается — соответствует заголовку движка («Stop keeps what was collected»).
- Проверено не полностью: цикл попыток при resume (вызов `execute` с `firstAttempt`, `custom-engine.js:897-991`, счётчик с нуля по каждому решению — считаем задуманным); `choice-dialog.js`; `cards.js` (окна) — только сопоставление полей; проверки, которые исполнители помечали «НЕ НАЙДЕНО» (EXECUTED_KINDS, `inputProblem`, `outputProblem`); `basic-control.js` в репозитории нет; перенос ролей и дисциплины в живом приложении; нестабильный TEST-2 в этом review не запускался.
- Исполнители вышли за свои диапазоны чтения в E3 и E7 (сообщили сами); их цитаты проверены.

## 6. Ведомость заданий

| Id | Область | Статус | Чем проверено |
|---|---|---|---|
| E1 | `custom-engine.js` 184–269, 916–1037 (цикл) | принят | цитаты: 187, 191, 208, 402, 829, 844, 846, 1040, 1044 |
| E2 | `custom-engine.js` 138–156, 387–409, 618–810 (попытки) | принят | цитаты: 618–726 (22 строки), 769–779, 142, 147 (строка 663 сдвинута на 1) |
| E3 | `custom-engine.js` 85–136, 569–617, 1039–1061; `basic-schema.js` 114–166 | принят | цитаты: 110, 111, 121, 588–601, 989, 994, 1045–1048; basic-schema 127–129, 138 |
| E4 | `basic-schema.js` 1–113, 167–561; `custom-engine.js` 270–366 | принят | запуск проб: K-1 воспроизведён; K-2/K-3 опровергнуты (`validate` отказывает; страница передаёт участников) |
| E5 | `custom-run-record.js`; `custom-engine.js` 410–492, 811–915 | принят | цитаты: run-record 28–34, 105–108, 141–200; engine 837–853; 7 кандидатов опровергнуто |
| E6 | `basic-output.js`, `basic-artifacts.js`, `custom-engine.js` 157–183, 493–568 | принят | цитаты: output 9–71; grep `markInvalid` (нет вызовов) |
| E7 | `results.js` 6320–7100 + `custom-engine.js` 368–386, 1000–1037 | принят | цитаты: 6624–6649, 6784–6893, 7024–7025, 7124–7127 |
| S1 | `stand.js` 284–492; `basic-schema.js` 167–477 | принят | цитаты: stand 322–482; basic-schema 196–463 |
| S2 | `basic-export.js`; `tests/stand-basic-export.test.js` | принят | цитаты: export 13–115; 3 запуска проб; тесты `review-s1/s2` |
| S3 | `cards.js`, `canvas.js`, `state.js`, `stage-card.js`, `basic-windows.md` | принят | цитаты: cards 24, 70, 94–97, 401; canvas 27, 35, 299–301; stage-card 172; basic-windows 18, 139 |
| S4a | `CONTRACT.md` 49–103 ↔ `stand.js` | принят | цитаты: stand 28, 54, 211, 383, 517, 521, 732; версия 48 |
| S4b | `README.md`, `model-prompt.md`, `CONTRACT.md` 1–48, 104–149 | принят | grep «назад/Возврат/goto» по `basic-export.js`, `stand.js` — пусто; цитаты stand 983, 1058, 1184, 1293, 1298 |
| R | `tests/review-b1/s1/s2.test.js` | принят | перезапуск: 3 набора, 8 тестов падают; ассерты читал целиком |
