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
Клавиша I (Ш) вне полей ввода и окон открывает окно вставки JSON-схемы `{ task, steps }` (формат и примеры — `stand-examples.json`).
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
