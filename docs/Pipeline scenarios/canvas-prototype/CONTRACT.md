# Контракт прототипа холста

Папка: `docs/Pipeline scenarios/canvas-prototype/`. Страница открывается двойным кликом (file://), без сборки.
Настоящие стили подключаются относительными ссылками на корень проекта (`../../../styles.css`, `../../../styles/*.css`), своих копий нет.

Файлы и владельцы:
- `index.html`, `canvas.js` — холст (агент A).
- `cards.js` (+ `cards.css`, только если в настоящих стилях чего-то нет) — окна (агент B).
- `state.js` — общее состояние; создаёт агент A первым, агент B только читает форму.

## Состояние `window.ProtoState`
```js
{
  models: ['Claude','GPT','Gemini'],              // доступные модели
  defaults: { roundTask:'', synthesisTask:'', discipline:{limit:'',content:'',delivery:'',correction:'',lines:[]}, modelNotes:{}, roundPrompts:{} },
  run: { policy:'auto', maxWords:300 },
  rounds: [ { ref:'r1', order:'', input:'', task:'', role:'None',
              models:[ { name:'Claude', enabled:true, role:'None', task:'', request:'', maxWords:'', discipline:{limit:'',content:'',delivery:'',correction:'',lines:[]} } ],
              intermediateSynthesis: null | { model:'Claude', task:'', discipline:{} },
              artifacts:[ { id:'a1', title:'Карта функций', version:1 } ] } ],
  final: { on:true, model:'Claude', task:'', discipline:{} },
  onChange(){}   // вызывает владелец холста; окна вызывают после Save
}
```

Дополнения холста (агент A): `selectedModel` — модель, выбранная в верхней строке; у модели раунда необязательное `send` (галочка Send, по умолчанию `true`). Индексы раундов в API окон — с нуля (`rounds[index]`).

## API окон (`window.ProtoCards`, агент B)
- `openEntry()` — окно ▶.
- `openRound(index)` — окно раунда (клик по значку R1, R2…).
- `openModel(roundIndex, modelName)` — окно модели (двойной клик по блоку).
- `openSynthesis(kind, roundIndex)` — `kind` = `'intermediate'` | `'final'`.
Каждое окно по Save пишет в `ProtoState` и вызывает `ProtoState.onChange()`.

## API холста (`window.ProtoCanvas`, агент A)
- `render()` — перерисовать из `ProtoState`.

## Стенд схем (`stand.js`, `window.ProtoStand`)
Окно вставки JSON-схемы `{ task, steps }` (формат и примеры — `stand-examples.json`) открывается кнопкой «i» в шапке панели
(`#pipeline-profile-btn`, подсказка «Стенд JSON») или клавишей I (Ш) вне полей ввода и окон; клавиша слушается на `window` в фазе
перехвата. Версия стенда (`STAND_VERSION` в `stand.js`) видна в имени файла `canvas-prototype-vN.html`, заголовке вкладки,
заголовке окна и первой строке блока замечаний. Единый файл собирает `python3 build.py` (стили проекта, скрипты и иконки внутри;
файл прежней версии удаляется). Руководство — [README.md](README.md), запрос для моделей — [model-prompt.md](model-prompt.md).
«Применить» проверяет схему (замечания — в окне и меткой «!» на карточке) и, если JSON читается, рисует холст по ней:
раунды и синтезы кладутся в `ProtoState` (`rounds`, `final`), поэтому их окна — окна `cards.js`, дополненные разделом «Из схемы»;
остальные блоки — карточки с окном «Из схемы». «Сбросить» возвращает состояние и холст, бывшие до первого «Применить».
- `ProtoStand.active` — пока `true`, `ProtoCanvas.render()` отдаёт отрисовку в `ProtoStand.render()`.
- `ProtoCanvas` дополнительно отдаёт `syncChrome()` (шапка: число раундов, предел слов, Auto — стенд вызывает её при отрисовке),
  `drawInputSplitConnector(svgId, stackId, color, targetMode)` и `drawMergeSplitConnector` — ими стенд рисует линии.
- `ProtoStand.validate(text)` → `{ schema, flat, issues, comment }`; `open()`, `reset()`, `examples` (`basic`, `foreach`, `defaults`).

### Формат схемы (необязательные поля сверх `{ task, steps }`)
```js
{ task, steps,
  defaults: { roundTask, synthesisTask, discipline: { limit, content, delivery, correction, lines: [строки] }, modelNotes: { "Claude": "текст", … } },
  run: { policy: "auto"|"manual", maxWords: 300|500|700|1000 } }
// у элемента models[] раунда и у этапа synthesis:
{ maxWords: целое > 0, request: "полный свой запрос вместо автоматического", discipline: { limit, content, delivery, correction, lines } }
```
Блок `source`: `kind` (`text` / `document` / `link`), `content` (полный текст материала) или `attachment` (точное имя файла с
расширением, приложенного к ответу модели в чате). Стенд файл не ищет и не читает: имя — видимая ссылка на материал; нет ни `content`,
ни `attachment` — мягкое замечание «Материал не передан». Приложение материал само не загружает (решение владельца).

`description` (строка, презентация проекта — не короткая) — описание схемы для пользователя, на прогон не влияет; в окне ▶ показано блоком «Description» (2 строки, кнопка ⤢ — на весь экран; блок есть всегда, без поля — «Описание не задано»); тот же текст — подсказка при наведении на ▶; не строка — замечание.

`defaults` и `run` ложатся поверх `ProtoState.defaults` / `ProtoState.run` (до первого «Применить»); свои поля модели — в
`rounds[].models[]`, синтеза — в `final` / `rounds[].intermediateSynthesis`. Окна cards.js показывают их как заполненные поля;
окно ▶ дополнено разделом «Из схемы» (task, defaults, run и общие замечания). Неверный тип, maxWords не целое > 0,
неизвестный ключ внутри `defaults` / `run` / `discipline`, неизвестное имя в `modelNotes` — замечание, значение не применяется.

### Чтение ответа модели
Схема **не применяется** (ошибка): поле пустое; внутреннее состояние прототипа (`ProtoState` в тексте или объект с
`rounds` / `models` / `final` без `steps`); Mermaid или текст без JSON; оборванный ответ (называются последние ~60 символов и
последний полностью прочитанный этап); JSON, который не исправить (с местом ошибки).

Сначала удаляются служебные строки расширения-копировщика (`[[AO-…]]`, `[НЕ СКОПИРОВАНО: …]`, `[СКОПИРОВАНО: …]`) —
одно замечание «Удалено служебных строк расширения: N». Текст вне JSON (до и после, без ```` ``` ````) сохраняется как
«Комментарий модели»: замечание «Текст вне JSON сохранён как комментарий модели» и сворачиваемый блок с полным текстом под
замечаниями (`validate(text).comment`); корзина и «Сбросить» его очищают. JSON одной строкой и в ```` ```json ```` читается.

Исправляется автоматически, с замечанием на каждое исправление:
- несколько JSON-объектов подряд — применяется первый;
- мягкий JSON: типографские “ ” ‘ ’ и одинарные кавычки → двойные, комментарии `//` и `/* */`, хвостовые запятые,
  ключи без кавычек, перевод строки и табуляция внутри строки (содержимое строк не меняется);
- обёртки: корень-список `[ {task, steps} ]` → первый объект; `{ "schema" | "result" | "pipeline" | "data" | … : {…} }` → развёртывается;
  корень-список этапов → `{ steps: […] }`;
- алиасы (не заменяют существующие правильные поля): `stages` / `nodes` / `blocks` → `steps`; `steps` и `body` как объект
  `{ id: этап }` → список; `type` / `kind_of_block` → `block`; `name` → `title` (кроме блока `block`); `input` / `depends_on` /
  `requires` → `inputs`; `block` в другом регистре или с пробелами → нижний регистр;
- формы: `inputs` / `optional_inputs` / `artifacts` / `discipline.lines` строкой → список; `models` списком имён → `{ name }`;
  `maxWords` строкой из цифр → число.

Только замечание: заглушка вместо текста («...», «…», TODO, TBD, «и т.д.» или текст, оканчивающийся на «…» / «...»);
заглушка вместо целого этапа — ошибка этапа. Все прежние проверки этапов (ссылки только вверх, route вниз, why, repeats + because,
item, optional_inputs, повторная проверка после петли, имена моделей, weights) остаются.

### Каталог шаблонов (v16)
Схемы, предложенные моделями, копятся шаблонами в одном JSON-файле на компьютере — каталог черновиков для переноса в приложение.
Список Pipelines (`#pipelineItems`): строка-статус («Каталог: нет файла» / «Каталог: <файл>» / «… · нет доступа» / «… · не прочитан»),
Default (сброс стенда, `reset()`; не удаляется), шаблоны в порядке сохранения. Разметка пункта — как в `results.js`
(`.pipeline-item` > `.pipeline-item-main` > `input.pipeline-radio` + `span.pipeline-item-name`, `.pipeline-item-delete` «×», активный — `.active`).
`title` шаблона: имя · N этапов · дата сохранения. Клик по шаблону = «Применить» его схемы в окне стенда (validate → applySchema;
замечания и комментарий модели видны в окне по «i»), пункт становится активным.

Формат файла:
```js
{ "format": "autoorchestr-stand-templates", "version": 1, "stand": "16",
  "templates": [ { "id": "uuid", "name": "…", "savedAt": "ISO", "schema": { task, steps, defaults?, run? }, "comment": "комментарий модели" } ] }
```
- **Save** (`#pipeline-save-btn`, перехват на window в фазе capture) сохраняет применённую схему (`stand.schema` после автоисправлений,
  поля task/steps/defaults/run) и комментарий модели. Схемы нет — тост «Сначала примените схему (кнопка i)». Имя — task до 48 символов,
  совпадение имён → « (2)», « (3)». Холст загружен из шаблона и не менялся «Применить» в окне стенда — шаблон перезаписывается
  (schema, savedAt), иначе создаётся новый. Тост внизу посередине (~2,5 с): «Сохранено: имя» и «Каталог: файл» или причина, почему только в памяти.
- **Файл.** Первое сохранение без файла — `showSaveFilePicker` (stand-templates.json) прямо из клика; отмена — шаблон только в памяти.
  Дальше каждый Save и удаление перезаписывают файл целиком (`createWritable`); права — `queryPermission`, при необходимости
  `requestPermission({mode:'readwrite'})` в жесте клика; отказ — шаблон в памяти. Файл с содержимым, не похожим на каталог, не перезаписывается.
- **Хранение.** Handle файла — IndexedDB `proto-stand` / `kv` / `catalogHandle`; копия каталога — `localStorage.protoStandTemplates`
  (показывается сразу при загрузке). При загрузке: права `granted` — файл читается и заменяет кэш; `prompt` — пункт
  «Открыть каталог: <файл>» (клик запрашивает права и читает файл). Шаблоны, сохранённые только в памяти, при чтении файла не теряются.
  У Chrome все страницы `file://` — одно происхождение: IndexedDB и localStorage общие для любых имён и папок, поэтому каталог
  переживает смену версии сборки (`canvas-prototype-vN.html`).
- **Удаление.** «×» видна при наведении на активный пункт (настоящий CSS) и после долгого нажатия (≥ 600 мс без движения → `.is-longpress`;
  снимается нажатием вне пункта, Escape, через 6 с; click после долгого нажатия не применяет шаблон). `confirm` → удаление из каталога
  и файла; удалён активный — `reset()` и Default. Тост «Удалено: имя».
- **Import** (`#pipeline-import-btn`): `showOpenFilePicker` → проверка `format`/`templates` (иначе «Файл не похож на каталог шаблонов»,
  каталог не меняется) → `confirm`, если каталог не пуст → каталог заменяется, файл становится файлом каталога.
  Без File System Access — обычный выбор файла, без записи. **Export** (`#pipeline-export-btn`): скачать каталог как stand-templates.json
  (Blob + `a[download]`). Без `showSaveFilePicker` Save хранит шаблоны в памяти и кэше, тост «Нет доступа к файлам: используйте Export».
- `ProtoStand.catalog` (для проверок): `state`, `restore(handle)`, `draw()`, `save()`, `parse(text)`, `text()`.
