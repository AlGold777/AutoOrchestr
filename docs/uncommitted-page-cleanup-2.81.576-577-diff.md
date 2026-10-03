# Очистка страницы: незакоммиченный материал для разбора версий 2.81.576–2.81.577

Дата: 2026-10-03. Этот документ сохраняется отдельно от отката и не включается в его коммиты. Изменения ниже сняты с рабочего кода; документ не является поручением применить их заново.

## Исходное и исследуемые состояния

- Рабочая база для восстановления: `b9ebf74`, версия **2.81.575**.
- Первая попытка: `1307832`, версия **2.81.576**.
- Вторая попытка: `018e638`, версия **2.81.577**.
- Полные diff каждого из двух коммитов приведены ниже. Они сохраняют также промежуточную реализацию, которой уже нет в суммарном diff: ранний выход из инициализации и вставку текста в страницу.

## Что было предложено и реализовано

1. Перед инициализацией интерфейса при reload отправлять `REGISTER_RESULTS_TAB` с новым флагом `resetSession` и ждать подтверждения.
2. В фоне отменять прежнюю сессию через `stopAllProcesses`, дождаться очереди сохранения `jobState`, затем очистить реестр вкладок, снимок задания, кеш поздних ответов, диагностику, журнал доставки, стенограмму и историю правил. Вкладки моделей не закрывать.
3. При регистрации после reload не восстанавливать ответы из фонового снимка; обычный переход между панелями сохранял восстановление текущего состояния.
4. Читать журнал доставки из памяти страницы, отменять отложенный таймер зеркалирования при Clear/Reset.
5. Не повторять старое сообщение через runtime fallback, если Stop изменил поколение сессии.
6. В 2.81.577 добавить совместимость с фоном без нового подтверждения: `STOP_ALL` → `CLEAR_DIAG_EVENTS` → удаление локальных ключей → повторная регистрация с проверкой пустого снимка. Ограничить ожидание фоновой команды 10 секундами.
7. В 2.81.577 продолжать инициализацию при ошибке, показывать её в штатном окне уведомлений, временно подавлять старые ответы/статусы до нового `LLM_JOB_CREATED` и не восстанавливать историю правил при reload.

## Подтверждённая ошибка

Пользователь получил:

> Не удалось очистить прошлую сессию. Причина: REGISTER_RESULTS_TAB: rateLimitTimers is not defined Перезагрузите расширение и страницу.

Цепочка: `resetSessionOnReload()` → `REGISTER_RESULTS_TAB(resetSession=true)` → `stopAllProcesses('page_reload')` → `rateLimitTimers.forEach(...)` в `background/job-orchestrator.js`.

В активном коде `rateLimitTimers` используется в `background/job-orchestrator.js` и `background/cleanup-manager.js`, но его объявления не найдено. В `tests/session-stability-validation.test.js` он существует только как переданная тестовая Map. Ошибочная ссылка присутствовала уже в базе 2.81.575; наши изменения сделали вызов этой ветки обязательным при перезагрузке страницы.

Stop успевает выполнить часть отмены, но падает раньше конца процедуры, в частности до последующего удаления снимка задания и присваивания `jobState = {}`. Поэтому нельзя считать такой сброс атомарным или завершённым.

В 2.81.576 обработчик ошибки дополнительно делал ранний `return` до привязки кнопок и вставлял `<p>` в `document.body`. Это непосредственно объясняет неработающие кнопки и нарушенный макет. В 2.81.577 этот выход был убран, а сообщение перенесено в окно; сама ошибка внутри Stop осталась.

Предыдущее объяснение о несовместимом старом фоне было гипотезой по коду, а не подтверждённой причиной данного случая. Теперь сообщение пользователя указывает на конкретный ReferenceError внутри Stop. Доступ к странице расширения через инструмент браузера был заблокирован политикой URL; состояние реального фонового процесса не было проверено этим инструментом.

## Недостатки проверки

- Были выполнены проверки синтаксиса и `git diff --check`; они не обнаруживают необъявленную переменную внутри функции, которая не выполняется.
- Регрессионные тесты были добавлены, но не запускались по ранее оговорённому ограничению.
- Добавленный тест фонового сброса подменял `stopAllProcesses` заглушкой, поэтому даже его успешное выполнение не проверило бы реальный путь Stop с `rateLimitTimers`.
- Проверки реального reload расширения с реальным Stop и контролем ответа регистрации не выполнены. Совместимость с предыдущим worker тоже не подтверждена на живом расширении.

## Граница отката

Откатить оба коммита, восстановив отслеживаемые файлы до `b9ebf74`, включая версию **2.81.575**. Не исправлять `rateLimitTimers` в рамках отката. Историю Git сохранить обратными коммитами. Этот документ оставить незакоммиченным для изучения.

## Сводный объём изменений

````text
 background/message-router.js               | 35 +++++++++++++-
 background/ui-broadcast.js                 |  5 ++
 docs/CHANGELOG.md                          | 14 ++++++
 docs/message-delivery.md                   |  8 ++++
 manifest.json                              |  2 +-
 package-lock.json                          |  4 +-
 package.json                               |  2 +-
 pipeline_panel.html                        |  2 +-
 result_new.html                            |  2 +-
 results.js                                 | 30 ++++++++++--
 results/boot-utils.js                      | 39 +++++++++++++++
 shared/message-delivery-view.js            |  3 ++
 shared/message-delivery.js                 |  5 +-
 tests/automation-telemetry.test.js         |  5 ++
 tests/boot-utils.test.js                   | 77 ++++++++++++++++++++++++++++++
 tests/extension-reload-reset.test.js       | 68 +++++++++++++++++++++++++-
 tests/message-delivery.test.js             | 21 ++++++++
 tests/results-ui-recovery-triggers.test.js |  5 +-
 18 files changed, 310 insertions(+), 17 deletions(-)
````

## Полный diff 2.81.576: 1307832

````diff
diff --git a/background/message-router.js b/background/message-router.js
index 2fb4aa4..709bc81 100644
--- a/background/message-router.js
+++ b/background/message-router.js
@@ -4826,7 +4826,39 @@ chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
                 sendResponse({ status: 'evaluator_response_handled' });
                 break;
                 
-            case 'REGISTER_RESULTS_TAB':
+            case 'REGISTER_RESULTS_TAB': {
+                if (message.resetSession === true) {
+                    if (!isAppUiTab(sender?.tab)) {
+                        sendResponse({ error: 'page_reset_sender_not_authorized' });
+                        return false;
+                    }
+                    // Reuse Stop's cancellation generation: queued writes and
+                    // orchestrator waits from the old session must not revive it.
+                    stopAllProcesses('page_reload', { closeTabs: false });
+                    self.jobState = jobState;
+                    (async () => {
+                        try {
+                            if (jobStateSaveFlight) await jobStateSaveFlight;
+                            await TabMapManager.clear();
+                            await CompressedStorage.remove('jobState');
+                            const cacheCleanup = await clearLateAnswerSnapshotCache('page_reload');
+                            if (cacheCleanup?.ok === false) throw new Error(cacheCleanup.error || 'late_answer_cache_reset_failed');
+                            await chrome.storage.local.remove([
+                                'llmCortexDebateEngineState.v1',
+                                'llmCodexDebateRuleHistory.v1'
+                            ]);
+                            await writeDiagnosticsEventsToStorage([]);
+                            await self.ProofTelemetryLedger?.clear?.(null);
+                            clearDiagnosticsRuntimeLogs();
+                            await chrome.storage.session.remove('messageDelivery.journal');
+                            resultsTabId = sender.tab.id;
+                            sendResponse({ status: 'registered', state: buildGlobalStateSnapshot({ includeAnswers: true }), sessionReset: true });
+                        } catch (error) {
+                            sendResponse({ error: error?.message || String(error) });
+                        }
+                    })();
+                    return true;
+                }
                 resultsTabId = sender.tab.id;
                 globalThis.LLMLog?.debug?.("[BACKGROUND] Registered results tab:", resultsTabId);
                 const runtimeReset = Number(self.__extensionRuntimeResetAt || 0) > 0
@@ -4837,6 +4869,7 @@ chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
                     runtimeReset
                 });
                 break;
+            }
             
             case 'REQUEST_SELECTOR_VERSION_STATUS': {
                 (async () => {
diff --git a/background/ui-broadcast.js b/background/ui-broadcast.js
index b453370..a2bef88 100644
--- a/background/ui-broadcast.js
+++ b/background/ui-broadcast.js
@@ -89,10 +89,12 @@ function broadcastGlobalState() {
 }
 
 function sendMessageToResultsTab(message) {
+  const deliveryGeneration = jobStateStopGeneration;
   const isNoReceiverError = (errorMessage = '') =>
     errorMessage.toLowerCase().includes('receiving end does not exist');
 
   const fallbackToRuntime = () => {
+    if (deliveryGeneration !== jobStateStopGeneration) return;
     chrome.runtime.sendMessage(message, () => {
       if (chrome.runtime.lastError) {
         const { message: errorMessage } = chrome.runtime.lastError;
@@ -114,6 +116,9 @@ function sendMessageToResultsTab(message) {
   }
 
   chrome.tabs.sendMessage(resultsTabId, message, () => {
+    // A reload may complete while the old document's no-receiver callback is
+    // pending. Do not replay its answer into the new document via runtime.
+    if (deliveryGeneration !== jobStateStopGeneration) return;
     if (chrome.runtime.lastError) {
       const errorMessage = String(chrome.runtime.lastError.message || '');
       // The results page received the message but does not answer it: that is a
diff --git a/docs/CHANGELOG.md b/docs/CHANGELOG.md
index c9094b3..150fbef 100644
--- a/docs/CHANGELOG.md
+++ b/docs/CHANGELOG.md
@@ -1,5 +1,12 @@
 # CHANGELOG — Project
 
+### 2026-10-03 — Page reload starts a clean session, version 2.81.576
+
+- Both application pages await an acknowledged background reset before initializing stores and message listeners on reload. Registration cancels the previous session through the existing Stop lifecycle, drains old snapshot writes, clears the job/tab registry, late-answer cache, diagnostics, delivery journal, transcript and rule-run history. Provider tabs stay open.
+- Reload reconciliation no longer hydrates previous answers from the background snapshot. Old no-receiver callbacks cannot replay answers through the runtime fallback after Stop/Reload. Ordinary navigation between main and pipeline views retains current-session reconciliation. Existing saved-session/IndexedDB reload cleanup remains in effect.
+- Delivery views and exports read the page's in-memory journal; a stale storage mirror cannot restore a cleared session. Clear/Reset cancel pending mirror timers.
+- Regression coverage added for delayed snapshot writes, reset acknowledgment/failure and stale journal mirrors. Tests updated but not run; syntax and diff checks performed.
+
 ### 2026-10-03 — Structured transport Extract v2, version 2.81.575
 
 - `shared/report-digest.js`: structured JSON schema 2 and Markdown derived from the same tables; DIGEST_VERSION 2.0.0 and explicit compression parameters. All requests are included, shared stage timelines contain both models, attempt transitions retain zero lengths and state/dispatch changes. Background counts retain first/last and all member paths without line caps.
diff --git a/docs/message-delivery.md b/docs/message-delivery.md
index d9ae836..94522fb 100644
--- a/docs/message-delivery.md
+++ b/docs/message-delivery.md
@@ -70,3 +70,9 @@
 - Повтор не помог — передача сообщения другой выбранной модели.
 
 С 2.81.575 «Only problems» выключен по умолчанию. Кнопка Extract и соседний список transport запускают обработку внутри расширения и скачивают три файла из одного снимка после удаления секретов: полный `Disput Flow YYYYMMDD_HH-MM.json`, структурированный `extract_transport_YYYYMMDD_HH-MM.json` (schemaVersion 2, DIGEST_VERSION 2.0.0) и отдельный `extract_transport_YYYYMMDD_HH-MM.md`. Markdown больше не хранится строкой в JSON. Все запросы, переходы состояния, общая шкала этапов, безопасно сгруппированный фон и исходные пути доступны в выжимке. Память телеметрии ограничена двумя прогонами, поздние события не переключают активный прогон; постоянное хранение и восстановление выключены.
+
+### Перезагрузка страницы приложения (2.81.576)
+
+Перезагрузка `result_new.html` или `pipeline_panel.html` начинает пустую сессию. До инициализации интерфейса страница ждёт подтверждения фонового сброса: прежние операции отменяются через существующий Stop, очередь записи снимков завершается, снимок задания, реестр вкладок, кеш поздних ответов, диагностика, журнал доставки, стенограмма и история правил очищаются. Вкладки моделей остаются открытыми. Старые ответы не восстанавливаются при последующей регистрации страницы. Переход между двумя панелями без перезагрузки сохраняет текущую сессию.
+
+Вкладка Disput и экспорт используют журнал в памяти текущей страницы. `chrome.storage.session` служит зеркалом, а не источником восстановления; отложенная запись зеркала отменяется при Clear/Reset. Если фон не подтвердил сброс, страница показывает ошибку и не начинает восстановление старых данных.
diff --git a/manifest.json b/manifest.json
index e9b060e..f8821d8 100644
--- a/manifest.json
+++ b/manifest.json
@@ -1,7 +1,7 @@
 {
   "manifest_version": 3,
   "name": "_Opus",
-  "version": "2.81.575",
+  "version": "2.81.576",
   "description": "Compares LLMs with stable Debate pipelines, structured state maps, and optional synthesis.",
   "permissions": [
     "storage",
diff --git a/package-lock.json b/package-lock.json
index b7e2d01..90a1525 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,12 +1,12 @@
 {
   "name": "llm-selector-manager",
-  "version": "2.81.575",
+  "version": "2.81.576",
   "lockfileVersion": 3,
   "requires": true,
   "packages": {
     "": {
       "name": "llm-selector-manager",
-      "version": "2.81.575",
+      "version": "2.81.576",
       "dependencies": {
         "cheerio": "^1.1.2"
       },
diff --git a/package.json b/package.json
index 7321685..5a4f49c 100644
--- a/package.json
+++ b/package.json
@@ -1,6 +1,6 @@
 {
   "name": "llm-selector-manager",
-  "version": "2.81.575",
+  "version": "2.81.576",
   "private": true,
   "description": "Selector management and content scripts for multi-LLM browser extension",
   "scripts": {
diff --git a/pipeline_panel.html b/pipeline_panel.html
index 26cd703..48ccbee 100644
--- a/pipeline_panel.html
+++ b/pipeline_panel.html
@@ -5,7 +5,7 @@
     <!-- LLM Discus: hidden search marker for developers -->
     <meta name="keywords" content="LLM Discus">
     <title>LLM Comparison</title>
-    <link rel="stylesheet" href="styles.css?v=2.81.575">
+    <link rel="stylesheet" href="styles.css?v=2.81.576">
 </head>
 <body class="pipeline-page">
     <div class="app-shell">
diff --git a/result_new.html b/result_new.html
index be9a1de..7715858 100644
--- a/result_new.html
+++ b/result_new.html
@@ -3,7 +3,7 @@
     <meta charset="UTF-8">
     <meta name="viewport" content="width=device-width, initial-scale=1.0">
     <title>LLM Comparison</title>
-    <link rel="stylesheet" href="styles.css?v=2.81.575">
+    <link rel="stylesheet" href="styles.css?v=2.81.576">
 </head>
 <body>
     <div class="app-shell">
diff --git a/results.js b/results.js
index 725d8ec..3cea096 100644
--- a/results.js
+++ b/results.js
@@ -49,11 +49,23 @@ document.addEventListener('DOMContentLoaded', async () => {
         recoverUiIfHidden,
         isPageReloadNavigation,
         clearTelemetryOnReload,
+        resetSessionOnReload,
         clearDebateTranscriptOnReload,
         normalizeExternalLinkUrl,
         decorateLinksForNewTab,
         openResponseLinkInNewTab
     } = window.ResultsBootUtils;
+    // No restoration or runtime listener may race the background reset.
+    try {
+        await resetSessionOnReload();
+    } catch (error) {
+        console.error('[RESULTS] Session reset failed', error);
+        const notice = document.createElement('p');
+        notice.setAttribute('role', 'alert');
+        notice.textContent = 'Не удалось очистить прошлую сессию. Перезагрузите страницу ещё раз.';
+        document.body.prepend(notice);
+        return;
+    }
     const favoritePanelId = 'favorite-panel';
     const favoriteOutputId = 'favorite-output';
     const favoriteSectionId = 'favorites-section';
@@ -16869,10 +16881,9 @@ document.addEventListener('click', (event) => {
         if (pageWasReloaded || response?.runtimeReset === true || !hasLiveSnapshot) {
             clearLiveResponseCards();
         }
-        // A page reload clears the old DOM, but the answer-bearing background
-        // snapshot is the recovery channel for messages missed during reload.
-        // Only a genuine extension-runtime reset invalidates that snapshot.
-        const reconciliationState = response?.runtimeReset === true
+        // Reload starts a clean session. Ordinary navigation between views still
+        // reconciles the current background snapshot.
+        const reconciliationState = pageWasReloaded || response?.runtimeReset === true
             ? {}
             : (response?.state || {});
         syncStatusFromGlobalState(reconciliationState, { replace: true });
diff --git a/results/boot-utils.js b/results/boot-utils.js
index 32e754b..17b6219 100644
--- a/results/boot-utils.js
+++ b/results/boot-utils.js
@@ -110,6 +110,21 @@
             resolve(false);
         }
     });
+    // Reset the authoritative producer before any page store or listener starts.
+    // Clearing only the DOM allows REGISTER_RESULTS_TAB to restore old answers.
+    const resetSessionOnReload = () => new Promise((resolve, reject) => {
+        if (!isPageReloadNavigation()) { resolve(false); return; }
+        try {
+            chrome.runtime.sendMessage({ type: 'REGISTER_RESULTS_TAB', resetSession: true }, (response) => {
+                const error = chrome.runtime.lastError?.message || response?.error;
+                if (error || response?.sessionReset !== true) {
+                    reject(new Error(error || 'Page session reset was not acknowledged'));
+                    return;
+                }
+                resolve(true);
+            });
+        } catch (error) { reject(error); }
+    });
     const clearDebateTranscriptOnReload = () => new Promise((resolve) => {
         if (!isPageReloadNavigation()) {
             resolve(false);
@@ -192,6 +207,7 @@
         recoverUiIfHidden,
         isPageReloadNavigation,
         clearTelemetryOnReload,
+        resetSessionOnReload,
         clearDebateTranscriptOnReload,
         normalizeExternalLinkUrl,
         decorateLinksForNewTab,
diff --git a/shared/message-delivery-view.js b/shared/message-delivery-view.js
index 547592f..84ddfc0 100644
--- a/shared/message-delivery-view.js
+++ b/shared/message-delivery-view.js
@@ -37,6 +37,9 @@
   const empty = (text) => el('p', { class: 'diag-empty' }, text);
 
   async function readJournal() {
+    // The page owns the current journal. A persisted mirror can lag a clear
+    // or contain another document's session, so never restore it into this page.
+    if (root.MessageDelivery?.journal) return root.MessageDelivery.journal();
     try {
       const data = await root.chrome.storage.session.get(KEY());
       return Array.isArray(data?.[KEY()]) ? data[KEY()] : [];
diff --git a/shared/message-delivery.js b/shared/message-delivery.js
index c9ac85e..0290e84 100644
--- a/shared/message-delivery.js
+++ b/shared/message-delivery.js
@@ -297,6 +297,8 @@
 
   // Clears only the journal; tokens of requests still in flight stay valid.
   function clearJournal() {
+    clearTimeout(mirrorTimer);
+    mirrorTimer = null;
     journal.length = 0;
     try { root.chrome?.storage?.session?.remove(JOURNAL_KEY); } catch (_) { /* ignore */ }
   }
@@ -304,8 +306,7 @@
   function reset() {
     expectedByRequest.clear();
     latestByModel.clear();
-    journal.length = 0;
-    try { root.chrome?.storage?.session?.remove(JOURNAL_KEY); } catch (_) { /* ignore */ }
+    clearJournal();
   }
 
   // A page load starts a new session: the previous journal is not carried over.
diff --git a/tests/automation-telemetry.test.js b/tests/automation-telemetry.test.js
index 206ea29..3970eb2 100644
--- a/tests/automation-telemetry.test.js
+++ b/tests/automation-telemetry.test.js
@@ -151,6 +151,11 @@ describe('Delivery cards in the Disput tab (formerly the Automation tab)', () =>
       expect(md).toContain('## Delivery');
       expect(md).toContain('| wait-9 | S:a1 |');
       expect(md).toContain('### Sends');
+      // The storage stub still returns the old session. The active page journal
+      // is authoritative for both the Disput view and its exports after Clear.
+      Delivery.clearJournal();
+      const cleared = await window.MessageDeliveryView.buildReport();
+      expect(cleared.journal).toEqual([]);
     } finally {
       window.chrome = originalChrome;
     }
diff --git a/tests/boot-utils.test.js b/tests/boot-utils.test.js
index 83c9357..6fd1d41 100644
--- a/tests/boot-utils.test.js
+++ b/tests/boot-utils.test.js
@@ -60,3 +60,30 @@ describe('ResultsBootUtils.clearDebateTranscriptOnReload', () => {
     await expect(BootUtils.clearDebateTranscriptOnReload()).resolves.toBe(false);
   });
 });
+
+describe('ResultsBootUtils.resetSessionOnReload', () => {
+  test('ordinary navigation keeps the current session', async () => {
+    await expect(BootUtils.resetSessionOnReload()).resolves.toBe(false);
+  });
+
+  test('reload waits for an explicit background reset acknowledgment', async () => {
+    const navigation = Object.getOwnPropertyDescriptor(performance, 'getEntriesByType');
+    Object.defineProperty(performance, 'getEntriesByType', { configurable: true, value: () => [{ type: 'reload' }] });
+    const previousChrome = window.chrome;
+    let respond;
+    window.chrome = { runtime: { sendMessage: jest.fn((_, callback) => { respond = callback; }) } };
+    try {
+      const reset = BootUtils.resetSessionOnReload();
+      expect(window.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'REGISTER_RESULTS_TAB', resetSession: true }, expect.any(Function));
+      respond({ sessionReset: true });
+      await expect(reset).resolves.toBe(true);
+      const failed = BootUtils.resetSessionOnReload();
+      respond({ error: 'storage_failed' });
+      await expect(failed).rejects.toThrow('storage_failed');
+    } finally {
+      window.chrome = previousChrome;
+      if (navigation) Object.defineProperty(performance, 'getEntriesByType', navigation);
+      else delete performance.getEntriesByType;
+    }
+  });
+});
diff --git a/tests/extension-reload-reset.test.js b/tests/extension-reload-reset.test.js
index ee277b6..bd5b284 100644
--- a/tests/extension-reload-reset.test.js
+++ b/tests/extension-reload-reset.test.js
@@ -44,7 +44,7 @@ describe('extension reload state reset', () => {
     expect(resultsSource).toContain('function clearLiveResponseCards()');
     expect(resultsSource).toContain('const pageWasReloaded = isPageReloadNavigation();');
     expect(resultsSource).toContain("if (pageWasReloaded || response?.runtimeReset === true || !hasLiveSnapshot) {");
-    expect(resultsSource).toContain("const reconciliationState = response?.runtimeReset === true");
+    expect(resultsSource).toContain("const reconciliationState = pageWasReloaded || response?.runtimeReset === true");
     expect(resultsSource).toContain(': (response?.state || {});');
     expect(resultsSource).toContain('syncStatusFromGlobalState(reconciliationState, { replace: true });');
     expect(resultsSource).not.toContain('syncStatusFromGlobalState(pageWasReloaded ? {}');
@@ -55,6 +55,37 @@ describe('extension reload state reset', () => {
     expect(resultsSource).toContain("detail: { source: 'extension_reload_reconcile' }");
   });
 
+  test('page reload cancels the producer and drains old writes before registration responds', async () => {
+    const source = read('background/message-router.js');
+    const block = source.slice(source.indexOf("case 'REGISTER_RESULTS_TAB':"), source.indexOf("case 'REQUEST_SELECTOR_VERSION_STATUS':"));
+    let releaseWrite;
+    const writeFlight = new Promise(resolve => { releaseWrite = resolve; });
+    const calls = [];
+    let state = { llms: { GPT: { answer: 'previous session' } } };
+    let reply;
+    const completion = new Promise(resolve => { reply = resolve; });
+    const context = {
+      message: { type: 'REGISTER_RESULTS_TAB', resetSession: true }, sender: { tab: { id: 5 } },
+      sendResponse: jest.fn(reply), isAppUiTab: () => true,
+      stopAllProcesses: jest.fn(() => { state = {}; calls.push('stop'); }),
+      jobState: {}, self: {}, jobStateSaveFlight: writeFlight,
+      TabMapManager: { clear: async () => { calls.push('tabs'); } },
+      CompressedStorage: { remove: async () => { calls.push('remove'); } },
+      clearLateAnswerSnapshotCache: async () => {},
+      writeDiagnosticsEventsToStorage: async () => {}, clearDiagnosticsRuntimeLogs: () => {},
+      chrome: { storage: { local: { remove: async () => {} }, session: { remove: async () => {} } } },
+      buildGlobalStateSnapshot: () => state, resultsTabId: null
+    };
+    const run = new Function(...Object.keys(context), `switch (message.type) { ${block} }`);
+    expect(run(...Object.values(context))).toBe(true);
+    expect(context.stopAllProcesses).toHaveBeenCalledWith('page_reload', { closeTabs: false });
+    expect(context.sendResponse).not.toHaveBeenCalled();
+    expect(calls).toEqual(['stop']);
+    releaseWrite();
+    await expect(completion).resolves.toMatchObject({ sessionReset: true, state: {} });
+    expect(calls).toEqual(['stop', 'tabs', 'remove']);
+  });
+
   test('telemetry UI drops its in-page cache on runtime reset', () => {
     const devtoolsSource = read('results-devtools.js');
     expect(devtoolsSource).toContain("document.addEventListener('extension-runtime-reset'");
@@ -62,6 +93,27 @@ describe('extension reload state reset', () => {
     expect(devtoolsSource).toContain('telemetryEventKeys = new Set();');
   });
 
+  test('an old no-receiver callback cannot replay an answer after session reset', () => {
+    const vm = require('vm');
+    const source = read('background/ui-broadcast.js');
+    const block = source.slice(source.indexOf('function sendMessageToResultsTab('), source.indexOf('function focusResultsTab('));
+    let acknowledge;
+    const context = {
+      jobStateStopGeneration: 1, resultsTabId: 5, console,
+      chrome: {
+        tabs: { sendMessage: jest.fn((_, message, callback) => { acknowledge = callback; }) },
+        runtime: { sendMessage: jest.fn(), lastError: { message: 'Receiving end does not exist' } }
+      }
+    };
+    vm.createContext(context);
+    vm.runInContext(block, context);
+    context.sendMessageToResultsTab({ type: 'LLM_PARTIAL_RESPONSE', answer: 'old answer' });
+    context.jobStateStopGeneration += 1;
+    acknowledge();
+    expect(context.chrome.runtime.sendMessage).not.toHaveBeenCalled();
+    expect(context.resultsTabId).toBe(5);
+  });
+
   test('saved sessions clear from memory when runtime reset races sidebar loading', () => {
     const resultsSource = read('results.js');
     expect(resultsSource).toContain('let extensionRuntimeResetObserved = false;');
diff --git a/tests/message-delivery.test.js b/tests/message-delivery.test.js
index 56c0dcd..68c20e2 100644
--- a/tests/message-delivery.test.js
+++ b/tests/message-delivery.test.js
@@ -4,6 +4,27 @@ const Delivery = require('../shared/message-delivery.js');
 describe('message delivery', () => {
   beforeEach(() => Delivery.reset());
 
+  test('clear cancels a queued journal mirror and new records can mirror again', () => {
+    jest.useFakeTimers();
+    const previousChrome = globalThis.chrome;
+    const storage = { set: jest.fn(), remove: jest.fn() };
+    globalThis.chrome = { storage: { session: storage } };
+    try {
+      Delivery.record({ kind: 'status', status: 'old' });
+      Delivery.clearJournal();
+      jest.advanceTimersByTime(300);
+      expect(storage.set).not.toHaveBeenCalled();
+      expect(Delivery.journal()).toEqual([]);
+      Delivery.record({ kind: 'status', status: 'new' });
+      jest.advanceTimersByTime(300);
+      expect(storage.set).toHaveBeenCalledWith({ [Delivery.JOURNAL_KEY]: [expect.objectContaining({ status: 'new' })] });
+    } finally {
+      Delivery.reset();
+      globalThis.chrome = previousChrome;
+      jest.useRealTimers();
+    }
+  });
+
   test('each model gets its own token appended to its prompt', () => {
     const prompts = Delivery.prepare({ prompt: 'Обсудим идею', models: ['GPT', 'Claude'] });
     const tokens = Object.values(prompts).map((p) => /\[\[(AO-[a-z0-9]{6})\]\]$/.exec(p)[1]);
diff --git a/tests/results-ui-recovery-triggers.test.js b/tests/results-ui-recovery-triggers.test.js
index 2d5ec05..2c2749c 100644
--- a/tests/results-ui-recovery-triggers.test.js
+++ b/tests/results-ui-recovery-triggers.test.js
@@ -62,8 +62,9 @@ describe('main-page UI recovery triggers', () => {
     expect(RESULTS_SRC).toContain('const formattedHtml = resolveCompleteAnswerHtml(text, html);');
   });
 
-  test('results-page reload reconciles persisted answers instead of discarding them', () => {
-    expect(RESULTS_SRC).toContain("const reconciliationState = response?.runtimeReset === true");
+  test('results-page reload clears previous answers before reconciliation', () => {
+    expect(RESULTS_SRC).toContain('await resetSessionOnReload();');
+    expect(RESULTS_SRC).toContain("const reconciliationState = pageWasReloaded || response?.runtimeReset === true");
     expect(RESULTS_SRC).toContain('syncStatusFromGlobalState(reconciliationState, { replace: true });');
     expect(RESULTS_SRC).not.toContain('syncStatusFromGlobalState(pageWasReloaded ? {}');
   });
````

## Полный diff 2.81.577: 018e638

````diff
diff --git a/background/message-router.js b/background/message-router.js
index 709bc81..46c87e9 100644
--- a/background/message-router.js
+++ b/background/message-router.js
@@ -4834,10 +4834,10 @@ chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
                     }
                     // Reuse Stop's cancellation generation: queued writes and
                     // orchestrator waits from the old session must not revive it.
-                    stopAllProcesses('page_reload', { closeTabs: false });
-                    self.jobState = jobState;
                     (async () => {
                         try {
+                            stopAllProcesses('page_reload', { closeTabs: false });
+                            self.jobState = jobState;
                             if (jobStateSaveFlight) await jobStateSaveFlight;
                             await TabMapManager.clear();
                             await CompressedStorage.remove('jobState');
diff --git a/docs/CHANGELOG.md b/docs/CHANGELOG.md
index 150fbef..67ebb81 100644
--- a/docs/CHANGELOG.md
+++ b/docs/CHANGELOG.md
@@ -1,5 +1,12 @@
 # CHANGELOG — Project
 
+### 2026-10-03 — Reload reset errors keep controls usable, version 2.81.577
+
+- Removed the reset-failure return that prevented results-page controls from initializing. Errors now appear in the existing notification modal after its close handler and page controls are wired, with the underlying command/error included; no paragraph is inserted into the page layout.
+- An older worker can answer REGISTER_RESULTS_TAB without understanding resetSession. The page now uses the established STOP_ALL/CLEAR_DIAG_EVENTS contracts, clears local transcript/history and the delivery mirror, then verifies an empty registered model snapshot. Unknown, missing and nonempty snapshots are not accepted as successful reset. Runtime requests have a 10-second response deadline.
+- Synchronous Stop failures now receive an explicit error response from the reset handler. If cleanup still fails, old response/status broadcasts are suppressed until a newly created job; rule history is not restored on reload.
+- Added regression coverage for older-worker compatibility, failed/missing verification, silent-worker timeout and boot continuation/modal notification. Tests updated but not run; syntax and diff checks performed.
+
 ### 2026-10-03 — Page reload starts a clean session, version 2.81.576
 
 - Both application pages await an acknowledged background reset before initializing stores and message listeners on reload. Registration cancels the previous session through the existing Stop lifecycle, drains old snapshot writes, clears the job/tab registry, late-answer cache, diagnostics, delivery journal, transcript and rule-run history. Provider tabs stay open.
diff --git a/docs/message-delivery.md b/docs/message-delivery.md
index 94522fb..dd142e8 100644
--- a/docs/message-delivery.md
+++ b/docs/message-delivery.md
@@ -75,4 +75,6 @@
 
 Перезагрузка `result_new.html` или `pipeline_panel.html` начинает пустую сессию. До инициализации интерфейса страница ждёт подтверждения фонового сброса: прежние операции отменяются через существующий Stop, очередь записи снимков завершается, снимок задания, реестр вкладок, кеш поздних ответов, диагностика, журнал доставки, стенограмма и история правил очищаются. Вкладки моделей остаются открытыми. Старые ответы не восстанавливаются при последующей регистрации страницы. Переход между двумя панелями без перезагрузки сохраняет текущую сессию.
 
-Вкладка Disput и экспорт используют журнал в памяти текущей страницы. `chrome.storage.session` служит зеркалом, а не источником восстановления; отложенная запись зеркала отменяется при Clear/Reset. Если фон не подтвердил сброс, страница показывает ошибку и не начинает восстановление старых данных.
+Вкладка Disput и экспорт используют журнал в памяти текущей страницы. `chrome.storage.session` служит зеркалом, а не источником восстановления; отложенная запись зеркала отменяется при Clear/Reset. Если фон не подтвердил сброс, инициализация кнопок продолжается; после неё ошибка с причиной показывается в штатном всплывающем окне уведомлений. Сообщение не вставляется в макет страницы. Старые ответы и статусы игнорируются до создания нового задания, история правил при перезагрузке не восстанавливается.
+
+С 2.81.577 страница совместима с фоновым процессом предыдущей версии, который ещё не понимает `resetSession`: после обычного ответа регистрации она вызывает существующие `STOP_ALL` и `CLEAR_DIAG_EVENTS`, очищает локальную стенограмму, историю правил и зеркало журнала, затем проверяет пустой снимок моделей. Неизвестный, отсутствующий или непустой снимок не считается подтверждением очистки. Ожидание ответа каждой фоновой команды ограничено 10 секундами.
diff --git a/manifest.json b/manifest.json
index f8821d8..907acbd 100644
--- a/manifest.json
+++ b/manifest.json
@@ -1,7 +1,7 @@
 {
   "manifest_version": 3,
   "name": "_Opus",
-  "version": "2.81.576",
+  "version": "2.81.577",
   "description": "Compares LLMs with stable Debate pipelines, structured state maps, and optional synthesis.",
   "permissions": [
     "storage",
diff --git a/package-lock.json b/package-lock.json
index 90a1525..bad1476 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,12 +1,12 @@
 {
   "name": "llm-selector-manager",
-  "version": "2.81.576",
+  "version": "2.81.577",
   "lockfileVersion": 3,
   "requires": true,
   "packages": {
     "": {
       "name": "llm-selector-manager",
-      "version": "2.81.576",
+      "version": "2.81.577",
       "dependencies": {
         "cheerio": "^1.1.2"
       },
diff --git a/package.json b/package.json
index 5a4f49c..6b30ac2 100644
--- a/package.json
+++ b/package.json
@@ -1,6 +1,6 @@
 {
   "name": "llm-selector-manager",
-  "version": "2.81.576",
+  "version": "2.81.577",
   "private": true,
   "description": "Selector management and content scripts for multi-LLM browser extension",
   "scripts": {
diff --git a/pipeline_panel.html b/pipeline_panel.html
index 48ccbee..3b4068c 100644
--- a/pipeline_panel.html
+++ b/pipeline_panel.html
@@ -5,7 +5,7 @@
     <!-- LLM Discus: hidden search marker for developers -->
     <meta name="keywords" content="LLM Discus">
     <title>LLM Comparison</title>
-    <link rel="stylesheet" href="styles.css?v=2.81.576">
+    <link rel="stylesheet" href="styles.css?v=2.81.577">
 </head>
 <body class="pipeline-page">
     <div class="app-shell">
diff --git a/result_new.html b/result_new.html
index 7715858..f9d0561 100644
--- a/result_new.html
+++ b/result_new.html
@@ -3,7 +3,7 @@
     <meta charset="UTF-8">
     <meta name="viewport" content="width=device-width, initial-scale=1.0">
     <title>LLM Comparison</title>
-    <link rel="stylesheet" href="styles.css?v=2.81.576">
+    <link rel="stylesheet" href="styles.css?v=2.81.577">
 </head>
 <body>
     <div class="app-shell">
diff --git a/results.js b/results.js
index 3cea096..51ae4e8 100644
--- a/results.js
+++ b/results.js
@@ -56,15 +56,12 @@ document.addEventListener('DOMContentLoaded', async () => {
         openResponseLinkInNewTab
     } = window.ResultsBootUtils;
     // No restoration or runtime listener may race the background reset.
+    let pageSessionResetError = null;
     try {
         await resetSessionOnReload();
     } catch (error) {
         console.error('[RESULTS] Session reset failed', error);
-        const notice = document.createElement('p');
-        notice.setAttribute('role', 'alert');
-        notice.textContent = 'Не удалось очистить прошлую сессию. Перезагрузите страницу ещё раз.';
-        document.body.prepend(notice);
-        return;
+        pageSessionResetError = error;
     }
     const favoritePanelId = 'favorite-panel';
     const favoriteOutputId = 'favorite-output';
@@ -2711,7 +2708,7 @@ document.addEventListener('click', (event) => {
     const debateAggregateStore = window.DebateRunStore?.createStore?.() || null;
     const debateCaseStore = window.DebateCaseStore?.createStore?.({ storage: chrome?.storage?.local }) || null;
     const debateRuleHistoryStore = window.DebateRuleHistory?.createStore?.({ storage: chrome?.storage?.local }) || null;
-    void debateRuleHistoryStore?.restore?.();
+    if (!isPageReloadNavigation()) void debateRuleHistoryStore?.restore?.();
     const pipelineProfileView = window.PipelineProfileView?.init?.({ storage: chrome?.storage?.local }) || null;
     window.__debateCaseStore = debateCaseStore;
     const disputStateMapView = window.DisputStateMapView?.init?.({
@@ -17132,6 +17129,15 @@ document.addEventListener('click', (event) => {
     // races with the background service worker for content-script RPC messages.
     chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
         if (!RESULTS_RUNTIME_MESSAGE_TYPES.has(message?.type)) return false;
+        // A reset failure must not disable controls or restore the old session.
+        // A newly created job opens the response channel again.
+        if (message.type === 'LLM_JOB_CREATED') pageSessionResetError = null;
+        if (pageSessionResetError && [
+            'GLOBAL_STATE_BROADCAST', 'LLM_PARTIAL_RESPONSE', 'LLM_FINAL_RESPONSE',
+            'FINAL_LLM_RESPONSE', 'STATUS_UPDATE', 'UPDATE_LLM_PANEL_OUTPUT',
+            'LLM_DIAGNOSTIC_EVENT', 'TRANSPORT_DISPATCH_PHASE', 'LLM_COMPLETION_TERMINAL',
+            'TRANSPORT_FOCUS', 'SPA_NAVIGATION'
+        ].includes(message.type)) return false;
         // Journal-only messages; tab-originated ones are owned (answered) by the background.
         const JOURNAL_ONLY_TYPES = ['TRANSPORT_DISPATCH_PHASE', 'PROVIDER_STOP_RESULT', 'LLM_COMPLETION_TERMINAL', 'SPA_NAVIGATION', 'TRANSPORT_FOCUS'];
         if (window.MessageDelivery && ['STATUS_UPDATE', 'GLOBAL_STATE_BROADCAST', ...JOURNAL_ONLY_TYPES].includes(message.type)) {
@@ -24064,6 +24070,9 @@ function exportSingleTemplate(templateName, sourceData = null) {
         }
     }
     // --- V2.0 END: API Keys Modal Logic ---
+    if (pageSessionResetError) {
+        showNotification(`Не удалось очистить прошлую сессию.\nПричина: ${pageSessionResetError.message || String(pageSessionResetError)}\nПерезагрузите расширение и страницу.`);
+    }
 	});
 const pipelineExportFlash = (button, state) => {
     try {
diff --git a/results/boot-utils.js b/results/boot-utils.js
index 17b6219..30fa47f 100644
--- a/results/boot-utils.js
+++ b/results/boot-utils.js
@@ -112,19 +112,42 @@
     });
     // Reset the authoritative producer before any page store or listener starts.
     // Clearing only the DOM allows REGISTER_RESULTS_TAB to restore old answers.
-    const resetSessionOnReload = () => new Promise((resolve, reject) => {
-        if (!isPageReloadNavigation()) { resolve(false); return; }
-        try {
-            chrome.runtime.sendMessage({ type: 'REGISTER_RESULTS_TAB', resetSession: true }, (response) => {
-                const error = chrome.runtime.lastError?.message || response?.error;
-                if (error || response?.sessionReset !== true) {
-                    reject(new Error(error || 'Page session reset was not acknowledged'));
-                    return;
-                }
-                resolve(true);
-            });
-        } catch (error) { reject(error); }
-    });
+    const resetSessionOnReload = async () => {
+        if (!isPageReloadNavigation()) return false;
+        const request = (message) => new Promise((resolve, reject) => {
+            const timer = setTimeout(() => reject(new Error(`${message.type}: background_timeout`)), 10000);
+            try {
+                chrome.runtime.sendMessage(message, (response) => {
+                    clearTimeout(timer);
+                    const error = chrome.runtime.lastError?.message || response?.error;
+                    if (error) { reject(new Error(`${message.type}: ${error}`)); return; }
+                    resolve(response);
+                });
+            } catch (error) {
+                clearTimeout(timer);
+                reject(error);
+            }
+        });
+        const registration = await request({ type: 'REGISTER_RESULTS_TAB', resetSession: true });
+        if (registration?.sessionReset === true) return true;
+        if (registration?.status !== 'registered') throw new Error('REGISTER_RESULTS_TAB: unexpected_response');
+
+        // Reloading an unpacked page reads new JS while its worker may still run
+        // the previous version. That worker ignores resetSession. Use its existing
+        // Stop contract, and verify an empty snapshot instead of aborting page boot.
+        const stopped = await request({ type: 'STOP_ALL' });
+        if (stopped?.success !== true) throw new Error('STOP_ALL: reset_not_confirmed');
+        const cleared = await request({ type: 'CLEAR_DIAG_EVENTS', reason: 'page_reload' });
+        if (cleared?.success !== true) throw new Error('CLEAR_DIAG_EVENTS: reset_not_confirmed');
+        await chrome.storage.local.remove([DEBATE_TRANSCRIPT_STORAGE_KEY, 'llmCodexDebateRuleHistory.v1']);
+        await chrome.storage.session.remove('messageDelivery.journal');
+        const verified = await request({ type: 'REGISTER_RESULTS_TAB' });
+        if (verified?.status !== 'registered' || !verified?.state?.llms
+            || Object.keys(verified.state.llms).length) {
+            throw new Error('REGISTER_RESULTS_TAB: previous_session_still_active');
+        }
+        return true;
+    };
     const clearDebateTranscriptOnReload = () => new Promise((resolve) => {
         if (!isPageReloadNavigation()) {
             resolve(false);
diff --git a/tests/boot-utils.test.js b/tests/boot-utils.test.js
index 6fd1d41..98a6c12 100644
--- a/tests/boot-utils.test.js
+++ b/tests/boot-utils.test.js
@@ -86,4 +86,54 @@ describe('ResultsBootUtils.resetSessionOnReload', () => {
       else delete performance.getEntriesByType;
     }
   });
+
+  test.each([
+    [{ llms: {} }, null],
+    [{ llms: { GPT: { answer: 'old' } } }, 'previous_session_still_active'],
+    [undefined, 'previous_session_still_active']
+  ])('older background reset is verified against its snapshot %j', async (state, error) => {
+    const navigation = Object.getOwnPropertyDescriptor(performance, 'getEntriesByType');
+    Object.defineProperty(performance, 'getEntriesByType', { configurable: true, value: () => [{ type: 'reload' }] });
+    const previousChrome = window.chrome;
+    let registrations = 0;
+    window.chrome = {
+      runtime: { sendMessage: jest.fn((message, callback) => {
+        if (message.type === 'REGISTER_RESULTS_TAB') {
+          registrations += 1;
+          callback({ status: 'registered', state: registrations === 1 ? { llms: { GPT: { answer: 'old' } } } : state });
+        } else callback({ success: true });
+      }) },
+      storage: { local: { remove: jest.fn(async () => {}) }, session: { remove: jest.fn(async () => {}) } }
+    };
+    try {
+      const reset = BootUtils.resetSessionOnReload();
+      if (error) await expect(reset).rejects.toThrow(error);
+      else await expect(reset).resolves.toBe(true);
+      expect(window.chrome.runtime.sendMessage.mock.calls.map(([message]) => message.type))
+        .toEqual(['REGISTER_RESULTS_TAB', 'STOP_ALL', 'CLEAR_DIAG_EVENTS', 'REGISTER_RESULTS_TAB']);
+      expect(window.chrome.storage.session.remove).toHaveBeenCalledWith('messageDelivery.journal');
+    } finally {
+      window.chrome = previousChrome;
+      if (navigation) Object.defineProperty(performance, 'getEntriesByType', navigation);
+      else delete performance.getEntriesByType;
+    }
+  });
+
+  test('a silent background produces an actionable error instead of hanging boot', async () => {
+    jest.useFakeTimers();
+    const navigation = Object.getOwnPropertyDescriptor(performance, 'getEntriesByType');
+    Object.defineProperty(performance, 'getEntriesByType', { configurable: true, value: () => [{ type: 'reload' }] });
+    const previousChrome = window.chrome;
+    window.chrome = { runtime: { sendMessage: jest.fn() } };
+    try {
+      const check = expect(BootUtils.resetSessionOnReload()).rejects.toThrow('REGISTER_RESULTS_TAB: background_timeout');
+      jest.advanceTimersByTime(10000);
+      await check;
+    } finally {
+      window.chrome = previousChrome;
+      if (navigation) Object.defineProperty(performance, 'getEntriesByType', navigation);
+      else delete performance.getEntriesByType;
+      jest.useRealTimers();
+    }
+  });
 });
diff --git a/tests/extension-reload-reset.test.js b/tests/extension-reload-reset.test.js
index bd5b284..83de592 100644
--- a/tests/extension-reload-reset.test.js
+++ b/tests/extension-reload-reset.test.js
@@ -86,6 +86,20 @@ describe('extension reload state reset', () => {
     expect(calls).toEqual(['stop', 'tabs', 'remove']);
   });
 
+  test('reset failure preserves boot continuation and uses the existing notification modal', async () => {
+    const source = read('results.js');
+    const block = source.slice(source.indexOf('let pageSessionResetError = null;'), source.indexOf("const favoritePanelId = 'favorite-panel';"));
+    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
+    const error = new Error('storage_failed');
+    const run = new AsyncFunction('resetSessionOnReload', 'console', `${block}\nreturn { continued: true, error: pageSessionResetError };`);
+    await expect(run(async () => { throw error; }, { error: jest.fn() }))
+      .resolves.toEqual({ continued: true, error });
+    expect(block).not.toContain('document.body.prepend');
+    const noticeAt = source.indexOf('if (pageSessionResetError) {\n        showNotification(');
+    expect(noticeAt).toBeGreaterThan(source.indexOf("notificationOkBtn.addEventListener('click'"));
+    expect(source.slice(noticeAt, noticeAt + 300)).toContain('pageSessionResetError.message');
+  });
+
   test('telemetry UI drops its in-page cache on runtime reset', () => {
     const devtoolsSource = read('results-devtools.js');
     expect(devtoolsSource).toContain("document.addEventListener('extension-runtime-reset'");
````
