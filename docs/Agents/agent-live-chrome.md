# Живой Chrome: как агенту работать с расширением в настоящем браузере

Инструкция для изолированных проверок расширения в отдельном Chrome: открыть страницу, нажать кнопку, прочитать текст, скопировать DOM, сделать снимок, перехватить скачивание. User просить не нужно: всё делается через Chrome DevTools Protocol (CDP) в отдельном временном Chrome. «Нет доступа к живому Chrome» — не причина остановиться. Проверено на Google Chrome 155 (macOS), Node 22.

Полная карта элементов и поведения обеих страниц (`pipeline_panel.html` и `result_new.html`) — [agent-extension-pages-spec.md](agent-extension-pages-spec.md). Для CUA, селекторов и методов `pipeline_panel.html` — [agent-extension-page-control.md](agent-extension-page-control.md).

Обычный Chrome User’а используйте самостоятельно при наличии подходящего инструмента — см. [agent-real-chrome-control.md](agent-real-chrome-control.md). Этот отдельный профиль нужен, когда проверке требуется изоляция (например, импорт или удаление тестовых данных). Авторизация моделей в новом профиле обычно отсутствует.

## 1. Запуск отдельного Chrome

`$S` — временная папка сессии (scratchpad). Профиль всегда новый, чтобы не мешали старые расширения и страницы, и чтобы не задеть браузер User.

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --remote-debugging-port=9333 --user-data-dir="$S/profile1" \
  --enable-unsafe-extension-debugging --no-first-run --no-default-browser-check \
  about:blank > "$S/chrome1.log" 2>&1 &
echo $! > "$S/chrome.pid"
sleep 3; curl -s http://127.0.0.1:9333/json/version   # поле webSocketDebuggerUrl
```

- `--headless=new` — окна нет; если нужно видеть, уберите флаг (окно откроется на экране User, предупредите).
- `--enable-unsafe-extension-debugging` нужен, чтобы загрузить распакованное расширение по CDP.
- `--load-extension=…` в обычной сборке Chrome не работает (`chrome://extensions` остаётся пустым), `--disable-features=DisableLoadExtensionCommandLineSwitch` не помогает. Использовать только CDP-загрузку (раздел 3).
- Порт 9333 занят — возьмите другой (9334…), номер профиля увеличивайте при каждом запуске.

## 2. Подключение и вызов команд CDP

В Node 22 есть встроенный `WebSocket`, пакеты не нужны. Минимальный помощник (сохранить в `$S/cdp.mjs`, он же образец для остальных заданий):

```js
// node $S/cdp.mjs  — подключается к браузеру, шлёт команды, возвращает result
const base = 'http://127.0.0.1:9333';
export async function connect() {
  const { webSocketDebuggerUrl } = await (await fetch(`${base}/json/version`)).json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  let id = 0; const wait = new Map(); const events = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && wait.has(d.id)) { const { ok, fail } = wait.get(d.id); wait.delete(d.id); d.error ? fail(new Error(JSON.stringify(d.error))) : ok(d.result); }
    else events.push(d);                     // события: Runtime.consoleAPICalled, Runtime.exceptionThrown …
  };
  const send = (method, params = {}, sessionId) => new Promise((ok, fail) => {
    const n = ++id; wait.set(n, { ok, fail });
    ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { send, events, close: () => ws.close() };
}
```

Все вызовы идут через один сокет; для команд страницы указывается `sessionId` (раздел 4).

## 3. Загрузка расширения

```js
const { send } = await connect();
const { id } = await send('Extensions.loadUnpacked', { path: '/Users/restart/Documents/GitHub/AutoOrchestr' });
```

- `path` — всегда основной чекаут (оттуда загружено расширение у User), если не нужно проверить конкретную ветку или worktree: тогда путь к ней.
- Ответ содержит `id` расширения. Брать из ответа, не угадывать: страницы чужих `chrome-extension://<id>/…` открываются пустыми.
- Страницы расширения: `chrome-extension://<id>/<файл>.html`; список файлов — в корне проекта и в `manifest.json`. Какая страница содержит нужный элемент, проверяйте поиском в html (`grep -l 'id="…"' *.html`): одни и те же `id` есть не на всех страницах, и на неполной странице часть кода получает пустые данные.

## 4. Открыть страницу и выполнить код

```js
const { targetId } = await send('Target.createTarget', { url: `chrome-extension://${id}/pipeline_panel.html` });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Runtime.enable', {}, sessionId);
await send('DOM.enable', {}, sessionId);
await new Promise((r) => setTimeout(r, 4000));                 // дать странице загрузиться
const r = await send('Runtime.evaluate',
  { expression: 'document.title', returnByValue: true, awaitPromise: true }, sessionId);
console.log(r.result.value);
```

- `Runtime.evaluate` выполняет любой JS на странице: клик (`el.click()`), чтение (`innerText`, `outerHTML`, `getAttribute`), вызов функций страницы, чтение `chrome.storage`, `fetch`. `awaitPromise: true` — чтобы дождаться промиса.
- Содержимое любой страницы целиком: `document.documentElement.outerHTML`; один узел: `document.querySelector(sel).outerHTML`; вычисленные стили: `getComputedStyle(el)`.
- Снимок экрана: `Page.captureScreenshot { format: 'png' }` → поле `data` (base64) записать в файл в `$S` и открыть Read-ом.
- Размер окна: `Emulation.setDeviceMetricsOverride { width, height, deviceScaleFactor: 1, mobile: false }`.
- Консоль и исключения страницы: события `Runtime.consoleAPICalled`, `Runtime.exceptionThrown` приходят в `events` (нужен `Runtime.enable`). Сетевые запросы: `Network.enable`, события `Network.requestWillBeSent`.
- Настоящий клик/ввод по координатам: `Input.dispatchMouseEvent`, `Input.insertText` (по умолчанию хватает `el.click()` из `Runtime.evaluate`).
- Веб-страницы (не расширения) открываются так же: `Target.createTarget { url: 'https://…' }`. Вход в аккаунты в чужом профиле не выполнять без разрешения User.

## 5. Файлы и диалоги, которые CDP не может открыть

Системные окна (выбор файла, сохранение) из CDP не открываются. Обход:

- **Скрытый `<input type=file>`**: найти узел и подставить файл. `DOM.getDocument {depth:-1}` → `DOM.querySelector {nodeId, selector}` → `DOM.setFileInputFiles {nodeId, files:[абсолютный путь]}`; страница получит обычное событие `change`.
- **File System Access API** (`showOpenFilePicker`, `showSaveFilePicker`, `showDirectoryPicker`): подменить функцию на странице и проверить, с какими параметрами её вызвали:
  ```js
  window.__picker = [];
  window.showOpenFilePicker = async (o) => { window.__picker.push(o); return [{ getFile: async () => new File([text], 'name.json', { type: 'application/json' }) }]; };
  ```
  Подмена не проверяет жест пользователя и не открывает реальное окно: это нужно оговаривать в отчёте.
- **Скачивание**: `chrome.downloads` и ссылки `a[download]` кладут файл в папку загрузок профиля. Выбрать папку заранее можно командой `Browser.setDownloadBehavior { behavior: 'allow', downloadPath: '<папка в $S>', eventsEnabled: true }` (browser-уровень, без `sessionId`); иначе искать в `~/Downloads` по времени создания (`find ~/Downloads -newer "$S/chrome.pid"`).
- **`confirm`/`prompt`/`alert`** самого браузера блокируют страницу: после `Page.enable` дождаться события `Page.javascriptDialogOpening` (в `events`, обычно 0,5–0,8 с после действия) и только затем `Page.handleJavaScriptDialog { accept: true }`. Вызов раньше события отвечает «No dialog is showing» (код −32602). Окна, нарисованные самим расширением, — обычный DOM.

## 6. Приёмы, которые экономят время

- Сначала читайте страницу (`innerText`, `outerHTML` узла), потом действуйте: угадывать селекторы дороже.
- Уведомления расширения — обычные элементы; не обрезайте текст (`slice`), печатайте целиком.
- Проверка «после действия»: прочитать состояние до, выполнить, подождать 0,5–1 с, прочитать после; сравнить.
- Исключение «Cannot add property ready, object is not extensible» при загрузке страниц расширения известно и к заданиям не относится.
- Лог запуска Chrome — `$S/chromeN.log`; если порт не отвечает, смотреть его.
- Версия расширения в проверяемом профиле: `grep '"version"' <путь>/manifest.json`; её нужно называть в отчёте.

## 7. Уборка (обязательно)

- Останавливать только свой Chrome: `kill $(cat "$S/chrome.pid")`, затем `pgrep -fl "remote-debugging-port=9333"` — пусто.
- Удалять только файлы, созданные тестом (проверять по времени создания и по имени). Файлы User в любых папках, особенно в `Downloads`, не трогать; папки, существовавшие до теста, не удалять.
- Временный профиль в `$S` можно оставить: это папка сессии.
- При уборке изолированного теста браузер User и его вкладки не закрывать. Для проверок в обычном Chrome используйте доступный инструмент по инструкции `agent-real-chrome-control.md`.

## 8. Что не проверено

- Реальный пользовательский жест для `showOpenFilePicker` и реальное системное окно выбора файла.
- Поведение headed-режима (с видимым окном) на экране User.
