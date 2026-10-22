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
