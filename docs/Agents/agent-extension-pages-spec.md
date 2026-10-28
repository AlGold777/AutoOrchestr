# Спецификация двух страниц расширения для автономных агентов

Актуальная карта интерфейса и поведения страниц `pipeline_panel.html` и `result_new.html`. Это рабочая спецификация для анализа кода и тестирования; HTML задаёт структуру, а обработчики и дочерние модули задают фактический эффект. Перед изменением кода сверяйте текущую ветку и реальные файлы: DOM и поведение меняются вместе.

## 1. Страницы и источники истины

| Страница | Назначение | HTML / CSS | Основная логика |
|---|---|---|---|
| `chrome-extension://<extension-id>/pipeline_panel.html` | Pipeline/Basic: настройка схемы, prompt, последовательный прогон и лента ответов | [pipeline_panel.html](../../pipeline_panel.html), [styles.css](../../styles.css), [styles/pipeline.css](../../styles/pipeline.css) | [results.js](../../results.js), `disput/*`, `results/debate-*`, [pipeline/pipeline-runtime.js](../../pipeline/pipeline-runtime.js), background handlers |
| `chrome-extension://<extension-id>/result_new.html` | Обычная страница prompt → выбранные модели → карточки ответов и сравнительный анализ; справа также доступна панель Pipeline | [result_new.html](../../result_new.html), [styles.css](../../styles.css), [styles/response-card-cover.css](../../styles/response-card-cover.css) | [results.js](../../results.js), [results/response-card-cover.js](../../results/response-card-cover.js), [results/response-find-replace.js](../../results/response-find-replace.js), [results-devtools.js](../../results-devtools.js) |

Обе страницы загружают `results.js` и большую часть тех же модулей. Поведение различается по `document.body.pipeline-page` и по наличию DOM-элемента: `results.js` проверяет наличие каждого элемента, поэтому одного общего обработчика может быть недостаточно для вывода о странице. Скрипт `results-devtools.js` загружается лениво из `results.js`; его вкладки и динамические действия могут отсутствовать в DOM до открытия Telemetry.

Дополнительные источники поведения:

- [results-shared.js](../../results-shared.js) — общие модели и выбранные провайдеры.
- [notes/notes-client.js](../../notes/notes-client.js), `results.js` — локальные заметки и сессии.
- [results/pasted-text.js](../../results/pasted-text.js), [results/attachments.js](../../results/attachments.js) — составной prompt и вложения.
- [results/debate-sessions-store.js](../../results/debate-sessions-store.js), [results/debate-export.js](../../results/debate-export.js) — вкладки ленты, история и экспорт.
- [results-devtools.js](../../results-devtools.js), `background/*selector*`, `content-scripts/*selector*` — диагностические и селекторные инструменты.
- [tos-consent.js](../../tos-consent.js), `background/job-orchestrator.js` — первое согласие и проверка согласия перед реальным запуском.

Селекторы и публичные методы `window` для взаимодействия с `pipeline_panel.html` подробнее описаны в [инструкции управления страницей](agent-extension-page-control.md). Здесь зафиксирован охват обеих страниц и их поведение.

## 2. Общие элементы оболочки — обе страницы

### 2.1 Левая боковая панель: Sessions / Notes

| Элемент | Контрол | Поведение и код |
|---|---|---|
| Переключатель режима | `#notes-mode-toggle` | Меняет вид между `#sessions-panel` и `#notes-tree`; состояние и рендер обрабатывает `results.js`, данные заметок — `notes-client.js`. |
| Сохранить сессию | `#sessions-save-btn` | Сохраняет текущую ленту/состояние как сессию; при пустом состоянии сообщает, что сохранять нечего. Сессии находятся в локальном хранилище. |
| Добавить заметку | `#notes-add-root` | Создаёт корневую заметку в дереве; содержимое хранится локально. |
| Добавить вкладку заметок | `#notes-tab-add` | Добавляет вкладку заметок; динамические вкладки имеют действие закрытия `data-action="close"`. |
| Поиск и очистка поиска | `#notes-search`, `#notes-search-clear` | Фильтруют дерево заметок; очистка сбрасывает поисковую строку. Поиск может появляться в рендере панели. |
| Импорт/экспорт сессий и backup | `#notes-hint-sessions-add`, `#notes-hint-sessions-export-txt`, `#notes-hint-backup-export`, `#notes-hint-backup-import` | Импорт «Add» добавляет сессии, не заменяя текущие; импорт backup заменяет текущие заметки/сессии; экспорты создают файлы. Файловые выборы требуют отдельной проверки. |
| Удаление | `#notes-delete-btn`, `#sessions-delete-btn` | Удаляет выбранные заметки либо все сохранённые сессии; кнопки могут быть отключены/скрыты при пустом выборе. |
| Динамические узлы заметок | `.notes-tree [data-action="toggle|add-child"]`, `.notes-tab-close[data-action="close"]` | Сворачивает/разворачивает дочерние заметки, создаёт дочернюю заметку, закрывает вкладку. Обработчик делегирован на `#notes-tree`/`#notes-tabs` в `results.js`. |
| Изменение заметки | `#notes-active-title`, `#notes-textarea`, элементы `.notes-tree` | Ввод/blur сохраняет активную заметку; дерево поддерживает выделение, перемещение и drag/drop. Не считать ввод в редактор временным: он может сохраняться автоматически. |
| Изменение размера панели | `#left-sidebar-resizer` | Pointer drag меняет ширину левой панели; `#left-sidebar-toggle` и `#left-sidebar-close` открывают/закрывают её. |

В prompt area каждой страницы есть контейнер `#variable-inputs`; при выборе шаблона `results.js` может добавить туда inputs для переменных шаблона. Их `input` меняет собранный prompt, но сам его не отправляет.

Кнопки подсказки могут быть доступны только в соответствующем режиме. Перед импортом/удалением снимайте состав локальных данных; тестировать на отдельном профиле, не на профиле User.

### 2.2 Верхняя полоса, модели и боковые панели

| Элемент | Контролы | Поведение и код |
|---|---|---|
| Выбор провайдеров | `#llm-gpt`, `#llm-claude`, `#llm-qwen`, `#llm-zai`, `#llm-kimi`, `#llm-gemini`, `#llm-grok`, `#llm-deepseek`, `#llm-lechat`, `#llm-perplexity` | Toggle `.active`; синхронизирует видимость соответствующих `#panel-<model>`, список `ResultsShared.getSelectedLLMs()`, доступные роли и сохранённый выбор текущего view. Не отправляет prompt сам. В `pipeline_panel` также вызывает синхронизацию моделей схемы. |
| Выбрать всех / снять всех | двойной клик по кнопке модели | Переключает весь набор моделей. Это отдельное поведение от одиночного toggle. |
| Выбор шаблона prompt | `#template-select` | `manual` — ручной prompt; `create` открывает форму шаблона. На разметке контейнер скрыт, поэтому проверяйте фактическую видимость. |
| Notes / Pipeline / Telemetry | `#left-sidebar-toggle`, `#right-sidebar-toggle`, `#pipeline-close-btn`, `#telemetry-toggle-btn` | Открывают/закрывают панели или модалку. Состояние правой панели меняет доступность центральной области. Telemetry лениво загружает `results-devtools.js`. |
| Режим API | `#api-mode-checkbox` и в панели ключей `#api-toggle` | `#api-mode-checkbox` скрыт в текущей разметке и служит состоянием API fallback; `#api-toggle` переключает его и подпись/режим. API fallback — альтернативный транспорт, способный вызывать реальные API; не тестировать с активными ключами без отдельного разрешения. |
| API ключи | `#api-keys-modal`, `#api-key-openai`, `#api-key-anthropic`, `#api-key-google`, `#api-key-grok`, `#api-key-lechat`, `#api-key-qwen`, `#api-key-deepseek`, `#api-key-perplexity`, `#save-api-keys`, `#close-api-keys-modal` | Ключи загружаются при открытии и хранятся в session storage; пустое поле при Save удаляет ключи. Не считывать, не печатать, не экспортировать и не менять ключи во время теста. |
| Динамический индикатор API модели | `.api-indicator`, `.status-indicator`, `.status-ping-btn` | Рендерится около карточки модели; двойной клик по `.api-indicator` открывает DevTools. Индикатор статуса модели не является кнопкой запуска. |

## 3. Страница Pipeline: `pipeline_panel.html`

### 3.1 Prompt и управление прогоном

| Элемент | Контролы | Поведение и код |
|---|---|---|
| Prompt | `#modTa` | Основное поле prompt для страницы Pipeline. `input` меняет черновик; это не отправка. Текст может синхронизироваться между двумя views через `llmComparatorCrossViewUiState`. |
| Очистить prompt | `#debate-composer-clear-btn`; общая кнопка `#clear-prompt-btn` если показана | Очищает текст, rich mode, вложения и выбранные модификаторы. |
| Lead / Sender / Receiver | `#judge-select`, `#mod-sender-select`, `#mod-receiver-select` | Lead выбирает ведущую/судящую модель. Sender содержит User (`Moderator`) и выбранные модели; Receiver — All models, None и доступные модели. Опции/disabled зависят от выбранных моделей и состояния схемы. Менять через `change`, затем проверить фактический value и сохранённую маршрутизацию. |
| Автоматический режим | `#debate-auto-toggle-btn`; скрытые совместимые `#debate-run-policy-select`, `#auto-checkbox` | Включает Auto и сохраняет настройку; при включении может подтвердить ожидающий ответ/продолжить прогон. В тестах не переключать при активном прогоне. |
| Число раундов | `#debate-round-value`, `#debate-round-minus-btn`, `#pipeline-add-round-btn`, совместимый скрытый `#debate-round-limit-select`, `#debate-max-turns-input` | Меняет лимит раундов/ходов и синхронизирует UI схемы. Числовые значения ограничены разметкой и обработчиками. Нажатия могут быть disabled у минимального/максимального значения или активного прогона. |
| Длина ответа | `#debate-length-select` | Выбирает один из текущих вариантов длины; читается как предел ответа/подсказка протокола. Допустимые значения брать из `options`, не придумывать. |
| Auto/New pages | `#debate-auto-toggle-btn`, `#new-pages-checkbox` | Auto управляет режимом прогона. New pages задаёт открытие страниц моделей в новых вкладках при отправке. Изменение New pages не открывает вкладки само. |
| Run | `#debate-run-toggle-btn` | Главная кнопка прогона. По состоянию может быть запуском, отменой, паузой, подтверждением или продолжением. Обработчик в `results.js` вызывает Pipeline runtime/engine; возможны реальные внешние отправки. Перед нажатием читать `aria-label`, `title`, состояние движка и active run. |
| Служебная кнопка prompt | `#start-button` | В странице Pipeline присутствует в общем шаблоне, но скрыта; обычная кнопка Pipeline — `#debate-run-toggle-btn`. Не выбирать по общему ID без проверки видимости и page body class. |
| Tuning Control | `#pipeline-toggle-modifiers-btn` | Показывает/скрывает панель модификаторов prompt; управляет `aria-pressed` и состоянием оболочки. |
| Переключатель Pro | `#pipeline-panel-toggle-title` | Сворачивает/разворачивает дополнительную панель (Pro/сравнение); это не запуск Pipeline. |
| Вложения | `#prompt-attach-input` | Скрытый file input; сборка payload и проверки возможностей моделей — `results/attachments.js` и `results.js`. Необходим настоящий выбор файла; файл может передаваться внешней модели. |

### 3.2 Лента ответов, сессии и выделение

| Элемент | Контролы | Поведение и код |
|---|---|---|
| Вкладки прогона | `#debate-session-tabs`, `#debate-session-add-btn`, `#debate-session-delete-btn` | Сессии ленты управляются `DebateSessionsStore`; добавление создаёт новую локальную вкладку, удаление удаляет текущую. Вкладки рендерятся динамически и имеют `data-session-id`. |
| Разворот карточек | `#debate-full-answers-btn` | Переключает раскрытое/свернутое отображение карточек, сохраняет `aoFullAnswers.v1`. |
| Полноэкранная лента | `#debate-session-fullscreen-btn` | Переключает полноэкранный вид ленты. |
| Копирование и экспорт ленты | `#debate-session-copy-btn`, `#debate-session-export-btn`, `#debate-session-export-txt-btn` | Копирует текущую ленту или скачивает HTML/TXT через `results/debate-export.js`. Пустая лента даёт предупреждение/пустой результат. |
| Очистить ленту | `#debate-session-clear-btn` | Очищает текущий feed/session. Может стирать пользовательские ответы; проверять только в одноразовом тестовом профиле или при гарантированно пустой ленте. |
| Карточки ответа | `.debate-model-card`, `.debate-model-card-output`, элементы внутри `#debate-model-cards` | Рендерятся по схеме/ответам. Клик/двойной клик и маркеры этапов могут открывать карточку, документ/артефакт или stage dialog. Смотрите `results/debate-renderer.js`, `results/stage-card.js`, `results/pipeline-card-cover.js`. |
| Панель форматирования prompt | `#debateSelTb` и `.stb[data-cmd]`, `[data-color]`, `[data-block]`, `[data-fav]`, `[data-clear-highlight]`, `[data-more]` | Появляется при выделении текста в composer. Bold/Italic, цвета, align/list/indent, No colour и Favorite форматируют выделение или добавляют фрагмент в избранное. Кнопка More открывает дополнительные действия. |
| Шаг User (Basic) | динамический `dialog.choice-dialog` (`results/choice-dialog.js`): `.choice-dialog-message` («Назначение: …» и задание), поле `.choice-dialog-text` (или `.choice-dialog-document-edit` у документа), `.choice-dialog-choice` «Отправить» (disabled до ввода), `.choice-dialog-cancel` | Окно шага `owner` во время прогона. «Отправить» передаёт ответ и продолжает прогон; не нажимать в пользовательском/активном запуске без сценария. |
| Вопрос User | `#owner-ask-dialog`, `[data-owner-ask="answer|skip|later"]` | Окно вопросов движка к User: ответить, пропустить или позже. Изменяет активный прогон. |
| Карточка шага | `#pipeline-stage-dialog`, `[data-stage-close]` | Окно сведений о шаге холста (`openControlCard`); прогон не меняет. |

### 3.3 Builder/схема справа

| Элемент | Контролы | Поведение и код |
|---|---|---|
| Открыть общие настройки | `#entryPoint` | Открывает окно общих значений для Basic. Заголовки, подсказки и видимость строятся по текущей схеме. |
| Новый пустой поток | `#pipeline-add-btn` | Начинает создание пустого pipeline; может создать черновик/запросить сохранение. Это меняет активную схему, поэтому фиксировать исходный preset и возвращать его после теста. |
| Сохранить | `#pipeline-save-btn` | Открывает запрос имени/сохраняет текущую схему в пользовательские схемы. Внутренний путь `savePipeline`. |
| Reset / Delete | `#pipeline-reset-btn`, `#pipeline-delete-btn` (могут быть добавлены/показаны динамически) | Сбрасывает схему или удаляет активный user pipeline; требует защиты от потери пользовательской схемы. |
| Экспорт/импорт | `#pipeline-export-btn`, `#pipeline-export-all-btn`, `#pipeline-import-btn` | Экспорт активной Basic-схемы или каталога; импорт открывает системный file picker. Импорт меняет схемы только после выбора и разбора JSON. |
| Вставить схему | `#pipeline-profile-btn` | Открывает модальное окно `schema-paste-window`; Cancel закрывает, Apply разбирает/проверяет вставленный текст и применяет схему. Не нажимать Apply с неизвестным содержимым. |
| Переключить стрелки | `#pipeline-arrows-toggle` | Меняет только визуальное отображение стрелок. |
| Список схем | `#pipelineItems`, `#pipelineItems .pipeline-radio` | Выбор пресета меняет активную схему, canvas и синхронизирует модели/роли. Double click может вызвать редактирование названия/описания. |
| Модельные карточки/роли | `.model-input-checkbox`, `.role-selector` | Выбор модели и назначение ролей внутри раундов. Состояние может зависеть от выбранных верхних кнопок моделей; обработчики делегированы на `#pipeline-sidebar`. |
| Раунды | `.pipeline-round-delete-btn`, `#removeRoundBtn`, `#pipeline-add-round-btn` | Добавляет/удаляет последний/указанный раунд; удаление может быть скрыто или disabled при минимальном числе раундов. |
| Редактор пользовательской карточки | Динамические `#custom-card-*`, `[data-action="copy|inherit|clear|save|remove"]` | Редактирует персональные запросы, длину, дисциплины/строки; Reset/clear может вернуть наследование или очистить поле, Save сохраняет. Определения строит `results.js` в редакторе настроек. |
| Участники Basic | `.model-participant-add[data-participant-add]`, `.model-participant-label[data-participant-label]`, `.model-participant-remove[data-participant-remove]` внутри `.model-block` | Делегированный обработчик `#pipeline-panel` добавляет участника с новым UUID и выключенным Send, открывает переименование и удаляет участника только из раунда. Удаление с зависимыми входами/артефактами блокируется. Настройки участника открываются двойным кликом по карточке. |
| Информационные окна | Двойной клик по `.pipeline-block`, `#pipeline-info-modal`, `#pipeline-block-info-modal`; кнопки `#pipeline-info-close`, `#pipeline-block-info-close` | Показывает описание блоков/стадий и допустимые значения; только чтение, если внутри нет редактора пользовательской карточки. |

Карточки одного провайдера различаются по `data-participant-id` и видимой подписи. Сохранение схемы записывает ID, label и `settingsMode`; кнопка **Default** в редакторе участника заполняет текущий черновик и сама не сохраняет и не отправляет запрос.

## 4. Страница обычного prompt и ответов: `result_new.html`

### 4.1 Prompt, отправка и настройки

| Элемент | Контролы | Поведение и код |
|---|---|---|
| Prompt | `#prompt-input`, `#prompt-note-view`, `#prefix-container`, `#suffix-container`, `#prompt-pasted-text-bar` | Prompt составной: обычный текст, заметка, выбранные модификаторы/вложения. Источники — `results/pasted-text.js`, `results/attachments.js`, `results.js`. `input` сохраняет cross-view draft; сам ничего не отправляет. |
| Tuning Console | `#toggle-modifiers-btn`, `#modifiers-section`, `#modifiers-header`, `#modifiers-container`, `#modifier-preset-select`, контейнеры `#prefix-cards-container`, `#secondary-prefix-cards-container`, `#suffix-cards-container`, `#secondary-suffix-cards-container` | Открывает/сворачивает модификаторы. Карточки и chips генерируются из preset; выбор/ввод меняет добавляемый к prompt текст. Рендер и события в `results.js`; список preset может подгружаться асинхронно. |
| Вложения | `#prompt-attach-btn`, скрытый `#prompt-attach-input`, `#prompt-attachment-bar` | Открывает file picker и добавляет файл к prompt; удаление вложения меняет payload. Реальная отправка передаёт файл выбранным моделям и может раскрыть содержимое провайдеру. |
| Копировать/очистить prompt | `#prompt-copy-btn`, `#clear-prompt-btn` | Копирует собранный текст/модификаторы либо очищает prompt, форматирование/модификаторы и вложения. На пустом prompt выдаёт warning. |
| Long / New pages | `#long-mode-checkbox`, `#new-pages-checkbox` | Long выбирает длинный профиль ожидания; New pages открывает вкладки моделей отдельно при отправке. Не запускают сами по себе. |
| Отправить / остановить | `#start-button` | Если prompt пустой или нет выбранных моделей, ничего не отправляет и показывает уведомление. Иначе строит payload, отправляет `START_FULLPAGE_PROCESS` в background, который взаимодействует с реальными страницами моделей и может использовать API fallback. Во время работы тот же элемент становится Stop и отправляет `STOP_ALL`. Никогда не считать Enter/click безопасным без намеренного тестового prompt и разрешения на внешний вызов. |
| Переключение сетки | `#view-grid-btn`, `#view-stack-btn` | Меняет классы `.view-grid`/`.view-stack` в `.llm-results`; это только раскладка и сохраняемая UI-настройка. |
| Pro/результаты | `#pro-header`, `#get-it-button` | Pro сворачивает/разворачивает блок результатов. Get It собирает свежие ответы из уже открытых вкладок моделей через background `GET_IT_BATCH`; двойной клик запрашивает только модели без usable ответа. Это обращение к реальным страницам, но не новый prompt. |

`#prompt-input` и `#modTa` — `<textarea>`. В просмотренном коде `results.js` нет обработчика Enter/Ctrl+Enter для отправки этих полей; Enter вставляет перевод строки по стандартному поведению textarea. Для запуска используйте видимую кнопку страницы. Не выводите поведение клавиатуры из автоматического Enter в других формах (например, имя схемы или редактор модификатора).

### 4.2 Ответы моделей и сравнительный анализ

На `result_new.html` есть десять карточек и десять соответствующих outputs:

| Модель | Карточка | Output |
|---|---|---|
| GPT | `#panel-gpt` | `#output-gpt` |
| Claude | `#panel-claude` | `#output-claude` |
| Qwen | `#panel-qwen` | `#output-qwen` |
| Z.ai | `#panel-zai` | `#output-zai` |
| Kimi | `#panel-kimi` | `#output-kimi` |
| Gemini | `#panel-gemini` | `#output-gemini` |
| Grok | `#panel-grok` | `#output-grok` |
| DeepSeek | `#panel-deepseek` | `#output-deepseek` |
| Le Chat | `#panel-lechat` | `#output-lechat` |
| Perplexity | `#panel-perplexity` | `#output-perplexity` |

Каждая карточка имеет `.status-indicator` и повторяемые кнопки с `data-target="#output-*"`: `.copy-btn`, `.panel-export-html-btn`, `.panel-export-md-btn`, `.panel-clear-response-btn`. Копирование/экспорт читает output; Clear удаляет его и обновляет состояние кнопок/избранного. Двойной клик в пустой части шапки разворачивает карточку; клик вне неё сворачивает. Не путать двойной клик по заголовку с нажатием его кнопок.

`result_new.html` показывает обычные ответы провайдеров в индивидуальных outputs. Лента ответов Basic (`#debate-model-cards`) находится на `pipeline_panel.html`; там участник отображается по подписи и сохраняет `data-participant-id` вместе с метаданными карточки.

Глобальные действия над ответами:

| Контрол | Поведение |
|---|---|
| `#export-html-btn`, `#export-md-btn` | Экспортирует собранные ответы всех карточек в HTML/Markdown; пустой сбор даёт warning. Реализация делегирована в `results.js`/`results/debate-export.js`. |
| `#copy-all-btn` | Копирует совокупный rich text всех outputs в clipboard. |
| `#clear-all-btn` | Очищает ответы во всех модельных карточках, обновляет favorite entries и compare availability. Считать разрушающим действием. |
| Индивидуальные Copy/HTML/Markdown/Clear | Делегированные обработчики `.copy-btn`, `.panel-export-html-btn`, `.panel-export-md-btn`, `.panel-clear-response-btn`; цель берётся из `data-target`. |
| `#comparison-section`, `#comparison-output`, `#close-comparison-btn` | Появляются для Comparative Analysis; у результата есть собственные Copy/Export/Clear кнопки. Закрытие скрывает панель, не обязательно удаляет текст. |
| Динамический Favorite panel | `ensureFavoritePanelUI()` добавляет карточку избранного и динамические `#favorite-export-md-btn`, `.favorite-export-btn`, `.favorite-clear-btn`; текст выделения добавляется через toolbar Favorite. |
| Панель выделения ответа | `#responseSelTb` генерируется в `results.js`; `data-cmd`, `data-color`, `data-block`, `data-clear-highlight`, `data-fav`, `data-more` форматируют выделение или сохраняют фрагмент. |
| Вставить ответ в prompt | В `results.js` остались делегированные обработчики `.panel-use-input-btn` и `#use-as-input-btn`, но кнопок с этими селекторами нет в текущих двух HTML и генераторах DOM, найденных при этой сверке. Считать их legacy hooks, пока фактический DOM не покажет кнопку. |

Кнопки сравнения `#compare-button`, `#smart-compare-button`, селекторы evaluator/system prompt в текущей статической разметке отсутствуют (старые обработчики/переменные могут остаться в `results.js`). Проверять наличие перед тем, как считать контрол рабочим. `#get-it-button` — сбор ответов, не судья и не сравнение.

## 5. Общие модальные окна, подтверждения и диагностика

### 5.1 Шаблоны и системные диалоги

| Элементы | Фактическая роль |
|---|---|
| `#create-template-modal`, `.close`, `#template-name`, `#template-prompt`, `#add-variable`, `#cancel-template`, `#save-template`, `#export-templates-btn`, `#import-templates-btn`, `#import-file-input`, `#system-templates-toggle` | Создание/редактирование и импорт/экспорт prompt templates. Динамические variable rows добавляются кнопкой Add Variable; `.close` закрывает модалку. Save/Import меняют локальную коллекцию. |
| `#confirm-modal`, `#cancel-confirm`, `#retry-confirm`, `#delete-confirm` | Общий confirm/prompt диалог; подпись `#delete-confirm` контекстная, в HTML изначально содержит Save. Читать текст модалки перед нажатием. |
| `#notification-modal`, `#notification-ok-btn` | Уведомление; OK только закрывает его. |
| `#prompt-dialog`, `#prompt-dialog-input`, `#prompt-cancel-btn`, `#prompt-ok-btn` | Запрос строки, например имя схемы. OK подтверждает текущий ввод. |
| `#api-keys-modal` и вложенные `#telemetry-tab`, `#disput-tab`, `#selectors0-tab`, `#api-tab` | Модалка DevTools. Вкладки переключают панели; вкладка API содержит секреты. Закрытие — `#close-api-keys-modal` или backdrop/Escape согласно ModalManager. |
| TOS overlay `#tosConsentOverlay`, `#tosConsentCheckbox`, `#tosConsentAccept` | Создаётся `tos-consent.js` при отсутствии записи согласия; блокирует страницу до установки checkbox и Continue. Клик подтверждает риски автоматизации сторонних сервисов. Не принимать согласие за пользователя без прямого разрешения. |

### 5.2 Telemetry, Disput и Selector Tools

Вкладки/контролы объявлены в двух HTML, но содержимое, часть кнопок и строки таблиц создаёт `results-devtools.js` при открытии модалки.

| Подпанель | Контролы / группы | Поведение и оговорки |
|---|---|---|
| Telemetry | `#telemetry-platform-select`, `#telemetry-export-profile-select`, `#telemetry-export-json-btn`, `#export-all-logs-md-telemetry`, `#capture-b1-skeletons-btn`, `#telemetry-clear-all-btn` (есть только в `result_new.html`) | Фильтр платформы/экспортного профиля; JSON/MD экспорт; B1 снимает санитизированные skeletons с открытых model tabs; Clear удаляет telemetry и logs. Экспорт/clear требуют учитывать приватность и сохранность данных. |
| Диагностика | `#export-diagnostics-html`, `#copy-diagnostics-logs`, `#clear-diagnostics-logs`, динамические строки `.diag-action-btn[data-action="export-html|copy-log|clear-log"]`, контейнер `#diagnostics-log-wrapper` | Экспортирует/копирует/удаляет диагностические записи; строки строятся динамически. Логи могут содержать prompt/ответ/URL — проверять redaction до чтения/передачи. |
| Disput | `#disput-only-problems`, `#disput-basic`, `#disput-extract`, `#disput-extract-type`, `#disput-clear-trace`, `#disput-export-json`, `#disput-export-md` | Фильтр Only problems — только отображение; Basic/Extract и JSON/MD создают telemetry reports; Clear очищает trace. Выбор типа брать из `<option>`. |
| Selector health | `#copy-selector-health-btn`, `#export-selector-health-btn`, `#refresh-selector-health-btn`, динамические `#selector-health-status`, `#selector-health-summary`, `#selector-health-table` | Копирует/экспортирует summary; refresh перечитывает health. Статус может быть `no data`, если нет вкладок модели. |
| Workbench selectors | `#selectors0-model`, кнопки `.selectors0-workbench [data-selectors-action="export|import|save-all"]`, `.selectors0-file-input` | Выбор модели, экспорт/импорт JSON и Save all. Импорт требует файл; Save all сохраняет overrides. |
| Workbench rows | Динамические строки с `[data-action="pick|record|test|save|clear"]` и `input` селектора | Pick запускает выбор элемента на активной вкладке модели; Record наблюдает селектор; Test проверяет selector; Save сохраняет override; Clear очищает значение. Без активной страницы модели Pick/Record могут вернуть `Model tab not active`. |
| Overrides/cache/audit | `#run-selector-healthcheck-btn`, `#refresh-selector-overrides-btn`, `#clear-selector-overrides-btn`, `#clear-selector-cache-btn`, `#selector-audit-refresh-btn` | Запускает health-check, обновляет/очищает remote overrides/cache, перечитывает историю. Это может читать/менять browser storage и общаться с remote selector service. Проверять наличие permission/config и snapshot key `aoSelectors.v1` до изменений. |
| API keys | `#api-toggle`, поля `#api-key-*`, `#save-api-keys` | Режим и session keys. Секреты не выводить в журнал, screenshot, DOM dump или отчет. |

В текущих `pipeline_panel.html` и `result_new.html` реально размечены health summary, selector workbench, `Run health check`, `Refresh overrides`, `Clear overrides`, `Clear cache` и `Refresh override history`. Строки workbench с `Pick`, `Record`, `Test`, `Save`, `Clear` генерируются `results.js` для каждого поля. Имена `#refresh-telemetry-btn`, `#selector-detected-refresh-btn`, `#selector-validate-btn`, `#selector-validate-active-btn`, `#selector-pick-btn`, `#selector-highlight-btn`, `#selector-save-override-btn` и `#toggle-diagnostics-expand` присутствуют в старом коде как optional DOM hooks, но в текущем HTML нет соответствующих controls; не считать их доступными кнопками, пока реальный DOM не докажет обратное. Вкладки Active selectors, Overrides, Saved Overrides и Candidates раскрываются нативными `<details><summary>`; это тоже интерактивные элементы.

## 6. Общие поведения и правила проверки

1. **ID не гарантирует видимый контрол.** Перед нажатием читайте `hidden`, `disabled`, `aria-hidden`, computed style и `getClientRects()`. Скрытые compatibility controls (`#debate-run-policy-select`, `#debate-round-limit-select`, `#api-mode-checkbox`, `#auto-checkbox`) не использовать как пользовательский путь, если видимый переключатель доступен.
2. **Проверяйте обработчик по коду.** Делегированные клики в `results.js` могут работать для динамической кнопки даже если `addEventListener` на ней не установлен. Ищите `event.target.closest(selector)` и генерацию `innerHTML`/`createElement`.
3. **Подтверждайте итоговое состояние.** Для переключателей — `checked`/`aria-pressed` и storage; для select — `value`, выбранная подпись и `disabled`; для pipeline — выбранный preset и plan; для экспорта — уведомление и файл; для run — background response, вкладки, статус/телеметрия и карточка ответа.
4. **Синтетический `.click()` не открывает надёжно системный file picker и не заменяет пользовательский жест.** Для file chooser, clipboard, downloads и выбора DOM-элемента используйте CUA/настоящий ввод согласно [agent-live-chrome.md](agent-live-chrome.md).
5. **Одна и та же кнопка меняет смысл по состоянию.** Перед `#start-button`/`#debate-run-toggle-btn`, Auto, Get It, Owner dialog и селекторными действиями считайте состояние прогона, описание (`title`/`aria-label`) и открытые вкладки.
6. **Изолируйте изменения.** До UI теста сохраняйте исходные модели, prompt, Auto, New pages, роли, pipeline preset/plan, вкладки/сессии/заметки и storage keys. В конце восстановите обратимые значения; не «восстанавливайте» удалённые пользовательские данные из предположений.
7. **Различайте запуск и сбор.** `#start-button` и `#debate-run-toggle-btn` отправляют prompt/управляют run. `#get-it-button` просит background забрать ответы с уже открытых вкладок. Выбор модели, длины, роли, формы и сам факт создания вкладки не доказывают отправку prompt.

## 7. Что нужно агенту для настоящего end-to-end теста с моделями

Одного доступа к HTML расширения недостаточно: полноценный сценарий проходит через Chrome extension background, content scripts и реальные сайты провайдеров. Для самостоятельного теста должны быть подготовлены следующие условия.

| Необходимое условие | Для чего нужно |
|---|---|
| Доступный инструмент управления Chrome | Использовать обычный Chrome User’а самостоятельно в рамках задачи, проверив профиль, вкладку и URL. Для проверок с изоляцией данных — отдельный профиль по [agent-live-chrome.md](agent-live-chrome.md); он обычно не содержит авторизации моделей. |
| Загруженная версия расширения и разрешения | Нужны `manifest.json` с правильными host permissions, service worker/background и content scripts; записать extension ID и версию из тестового профиля, не предполагать постоянный ID. |
| Реальные модельные страницы и авторизованные тестовые аккаунты | Для UI-автоматизации требуются активные вкладки поддерживаемых провайдеров. Состояние login/MFA/CAPTCHA/rate limit должно быть видно агенту, но учётные данные не передавать в prompt/логи. Новый профиль обычно не имеет авторизации; её заранее подготавливает User либо отдельный безопасный тестовый аккаунт. |
| Разрешение на конкретный реальный запуск | Prompt передаётся третьей стороне, может расходовать квоту/деньги и создавать историю аккаунта. Нужны явный тестовый prompt, список моделей, число запусков/лимит и разрешение на отправку; согласие на ToS overlay — отдельное действие. |
| Способ управлять не только extension tab, но и вкладками провайдеров | Через CDP/CUA агент должен уметь перечислить target tabs, прочитать видимый статус и ответ, переключить активную вкладку и подтвердить завершение. Обычный DOM extension page не даёт доступа к cross-origin DOM модели. |
| Тестовый fixture и критерии успеха | Короткий безопасный prompt без персональных данных; ожидаемый набор моделей, допустимые варианты текста/ошибок, timeout, правила retry, условия остановки, критерий успешной доставки и получения ответа. |
| Наблюдаемость | Собирать timestamp, extension version, выбранные модели/режимы, run/session/transport IDs и видимый результат; консоль и telemetry анализировать с redaction. Не снимать/публиковать секреты, приватные запросы или полные страницы аккаунтов. |
| Восстановление и очистка | Заранее определить, удалять ли тестовые вкладки/ответы/сессии, очищать ли prompt и downloads, сохранять ли telemetry. Нужны timeout и понятный Stop/abort путь. |
| Модельные DOM/selector fixtures | При изменении селекторов нужны актуальные DOM/атрибуты/скриншоты каждой страницы модели и состояния генерации. Их следует снимать самостоятельно доступным инструментом с нужной вкладки обычного Chrome или тестового профиля; обращаться к User, только если нужные данные недоступны агенту; логические выводы агента не заменяют фактические DOM-данные. |

До выполнения этих условий агент может проверить реальный DOM обеих extension pages, переключатели и локальные модальные окна, а также проверить background readiness. Он не может честно подтвердить end-to-end отправку/ответ реальной модели без model tabs, авторизации, fixture и явного разрешения на внешний prompt.

### Минимальный самостоятельный тестовый протокол

1. Подключиться доступным инструментом к обычному Chrome User’а; для проверки с изоляцией запустить временный профиль и загрузить unpacked расширение по [agent-live-chrome.md](agent-live-chrome.md). Сохранить extension ID, версию, target IDs и исходные настройки; проверить авторизацию нужных моделей.
2. Открыть обе страницы; убедиться, что consent overlay завершён законным образом, background доступен, версия совпадает с ожидаемой.
3. Проверить локальные элементы без запуска: выбор модели/роли, длину, Auto/New pages, открытие панелей, тестовый текст в Input с последующей очисткой, пустые/disabled состояния, import/export на синтетических файлах.
4. Для реального прогона выполнить только одобренную матрицу: один короткий fixture prompt → выбранные модели → один запуск → проверка вкладок, dispatch ack, статусов, ответа и telemetry → остановка по timeout.
5. Сверить наблюдаемое состояние в UI, background/transport telemetry и видимую страницу провайдера. Отдельно записать частичный успех, ошибку доставки, пустой ответ, timeout и rate-limit.
6. Сбросить тестовые prompt/ответы/сессии/вкладки/файлы согласно плану очистки; сохранить только redacted evidence и восстановить тестовый профиль.

## 8. Пробелы, которые прежняя инструкция не покрывала

- Она почти полностью описывала `pipeline_panel.html` и не фиксировала структуру и кнопки `result_new.html`.
- Не учитывала составной prompt, модификаторы и вложения, карточки 10 ответов, global/per-card copy/export/clear, режим сетки/списка, Get It и comparative/favorite/selection UI.
- Не перечисляла Notes/Sessions, backup import/export, dynamic tabs, удаление, шаблоны, API keys и TOS overlay.
- Не отделяла static HTML controls от динамических кнопок `results.js` и lazy-loaded `results-devtools.js`.
- Не описывала privacy/cost boundaries и условия, необходимые для настоящего теста с реальными страницами моделей.

При добавлении/удалении элемента в любой из двух HTML или изменении его обработчика обновляйте этот файл в том же изменении, особенно таблицу соответствий selector → handler → наблюдаемое состояние.

## 9. Результат сверки с текущим исходным кодом

На 27.10.2026 инвентарь проверен по статическим `button`, `select`, `input` и `textarea` в обоих HTML и сопоставлен с их ID в этой спецификации: все найденные ID учтены. Кроме них отдельно описаны динамические группы, которые создаются из `results.js`/`results-devtools.js`. Это source-level аудит; он не подтверждает, что каждый элемент включён/видим при любом runtime state, что активный Chrome имеет такую же версию, или что сетевой прогон модели прошёл.
