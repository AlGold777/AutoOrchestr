# Живой Chrome: проверка расширения, импорта и экспорта

Рабочий способ, которым проверялись импорт/экспорт схем Basic в загруженном расширении. Все шаги проверены на Google Chrome 155 (macOS).

## 1. Когда нужно

- Проверить, что расширение работает в настоящем Chrome: импорт и экспорт схем, кнопки страницы, список pipeline, уведомления.
- Жалоба «нет доступа к живому Chrome» не причина останавливаться: способ ниже не требует расширения-мостика и работает через CDP.

## 2. Рецепт

Пути: основной чекаут `/Users/restart/Documents/GitHub/AutoOrchestr`, временная папка `$S` (scratchpad сессии).

**2.1. Запуск Chrome**

```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --remote-debugging-port=9333 --user-data-dir=$S/profileN \
  --enable-unsafe-extension-debugging --no-first-run --no-default-browser-check \
  about:blank > $S/chromeN.log 2>&1 & echo $! > $S/chrome.pid
```

- `--user-data-dir` только временная папка: каждый запуск с новым `profileN`, иначе старые расширения и страницы остаются.
- `--enable-unsafe-extension-debugging` нужен для `Extensions.loadUnpacked`.
- `--load-extension` в branded Chrome 155 не работает: `chrome://extensions` остаётся пустым. `--disable-features=DisableLoadExtensionCommandLineSwitch` тоже не помог.

**2.2. Browser-level WebSocket**

```
curl -s http://127.0.0.1:9333/json/version   # поле webSocketDebuggerUrl
```

**2.3. Загрузка расширения**

Через browser-level сокет отправить:
`{"id":1,"method":"Extensions.loadUnpacked","params":{"path":"/Users/restart/Documents/GitHub/AutoOrchestr"}}`

Ответ: `{"id":1,"result":{"id":"<extension-id>"}}`. Этот id и есть id расширения. Для профиля, который уже запускался, он был `egfijmjjpedpikkfmfaekjbhjjjlhlgo`, но в новом профиле брать из ответа.

Не угадывать id: `Target.createTarget` на чужой `chrome-extension://<id>/…` открывает пустые страницы чужих расширений.

**2.4. Открыть страницу расширения**

`Target.createTarget {url: "chrome-extension://<id>/pipeline_panel.html"}`, затем `Target.attachToTarget {targetId, flatten: true}` и `Runtime.enable`, `DOM.enable`. Подождать ~4 с.

- `pipeline_panel.html` содержит `#debate-length-select` (300/500/700/1000). Это обязательная страница для импорта схем с `run.maxWords`.
- `result_new.html` этого select не содержит: список `runWords` пуст, и `run.maxWords` отклоняется.

**2.5. Импорт файла**

Сначала подготовить файл схемы: `node -e "const E=require('./basic-export.js'); const ex=require('./stand-examples.json'); console.log(JSON.stringify(E.toBasic(ex.defaults.schema||ex.defaults).schema,null,2))"` (в папке `docs/Pipeline scenarios/canvas-prototype/`). Ключи примеров: `basic`, `foreach`, `defaults`.

- Версия 2.81.843: клик по `#pipeline-import-btn` создаёт скрытый `input[type=file][accept="application/json"]` в конце `body`. Найти его через `DOM.getDocument {depth:-1}` и `DOM.querySelector {selector: 'body > input[type=file][accept="application/json"]'}`, затем `DOM.setFileInputFiles {nodeId, files: [<абсолютный путь>]}`.
- Версия 2.81.844: импорт сначала вызывает `window.showOpenFilePicker`. Системное окно из CDP не открыть, поэтому подменяется шпионом (см. раздел 3).
- После выбора файла появляется промпт «Имя pipeline для схемы:» с именем по файлу. Подтверждение: `document.getElementById('prompt-ok-btn').click()`.

**2.6. Чтение результата**

- Список pipeline: `[...document.querySelectorAll('#pipelineItems > *')].map(e => e.innerText.trim().split('\n')[0])`.
- Холст: `document.querySelector('.pipeline-canvas').innerText`. Подсчёт `[class*=model]` даёт завышенное число, по нему блоки не считать.
- Уведомления: leaf-элементы с текстом, например `[...document.querySelectorAll('*')].filter(e => e.children.length === 0 && /Схема|схем/.test(e.textContent)).map(e => e.textContent.trim())`. Селекторы `[class*=notification]` ничего не нашли.
- Ошибки консоли и исключения: подписаться на `Runtime.consoleAPICalled` и `Runtime.exceptionThrown`.

**2.7. Экспорт**

`document.getElementById('pipeline-export-btn').click()` на выбранном pipeline. Уведомление: «Схема сохранена в Загрузки/Схемы: <имя>.json». Файл лежит в `/Users/restart/Downloads/Схемы/`.

## 3. Рабочие приёмы

- Шпион на выбор файла (проверено на 2.81.844):
  `window.__picker=[]; window.showOpenFilePicker = async (o) => { window.__picker.push({id:o.id, startIn:o.startIn}); return [{getFile: async () => new File([text], 'name.json', {type:'application/json'})}]; }`
  Вызов: `{id:"basicSchemas", startIn:"downloads"}`. Шпион не проверяет пользовательский жест и реальное окно выбора.
- Проверка экспортированного файла: `find /Users/restart/Downloads/Схемы -maxdepth 1 -name '<имя>*.json'`, затем `head -c 200`.
- Остановка своего Chrome: `kill $(cat $S/chrome.pid)`, затем `pkill -f "remote-debugging-port=9333"` и `pgrep -fl "remote-debugging-port=9333"`.

## 4. Ловушки

- Исключение «Cannot add property ready, object is not extensible» при загрузке страницы. Оно не связано с импортом и есть на обеих страницах.
- Обрезанные уведомления: если в скрипте стоит `slice(0, 120)`, полный текст теряется. Выводить полный `textContent`.
- Пустой `#debate-length-select` на `result_new.html` даёт отказ `run.maxWords`, хотя схема верная.
- Старый экспортёр выпускал `final` до `gate`: валидатор требует синтез последним. Исправлено в стенде v22.
- Пример `defaults` содержит `run.maxWords: 500`: значение должно быть в списке 300/500/700/1000.

## 5. Уборка

- Удалять только свои файлы и процессы. Например, в `Downloads/Схемы` файл `1111.json` принадлежит пользователю, его не трогать. Папка `Схемы` существовала до теста, не удалять.
- Перед удалением файла проверить по времени создания, что он создан тестом.
