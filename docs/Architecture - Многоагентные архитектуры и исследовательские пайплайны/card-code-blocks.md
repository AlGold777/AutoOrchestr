# Блоки кода и диаграммы Mermaid в карточках ответов

Карточки ответов (`.debate-model-card-output`, панели ответов моделей на главной, ревизии внутри карточки) оформляет `results/code-blocks.js`:

- Каждый `pre` оборачивается в `.code-block`: сверху шапка (слева язык, справа кнопка Copy), ниже код. Подписи шапки и кнопок — CSS `::before`, текстовых узлов нет: `innerText` карточки не меняется. Копируется точный текст `pre code`.
- Вход оформления: `replaceChildrenFromSanitizedHtml` (`results/dom-utils.js`) вызывает `decorateCodeBlocks`; `MutationObserver` подхватывает прямую запись html. Оформление идемпотентно.
- При сборе (`ContentUtils.buildInlineHtml`, фоновый экстрактор) блок кода провайдера приводится к `pre[data-code-lang] > code` движком `AnswerMarkdown.normalizeCodeBlocks`; скрытый исходник Mermaid (Perplexity) сохраняется как `data-code-lang="mermaid"`.
- `pre[data-code-lang="mermaid"]` показывается как **диаграмма** (переключатель «Диаграмма | Код», по умолчанию диаграмма). Рисует локальная библиотека `lib/mermaid/` (mermaid 12.2.0, MIT), загружается при первом таком блоке через `import()`; `securityLevel: 'strict'`, `layout: 'dagre'`, `htmlLabels: false`; результат — `<img data:image/svg+xml>`. Ошибка, отсутствие библиотеки или превышение 5 с — блок остаётся кодом с пометкой «Не удалось отрисовать диаграмму: …». Результат кешируется по хэшу исходника.
- `lib/mermaid/` собирается `npm run vendor:mermaid` (скрипт `scripts/vendor-mermaid.js`) из зафиксированной devDependency `mermaid`. Не включены чанки `elk` (1,6 МБ), `architecture`, `cose-bilkent`; вся папка ≈ 3,4 МБ. Диаграмма с `layout: elk` и тип `architecture-beta` не рисуются (остаются кодом). Ни `eval`, ни `new Function` библиотека не использует — CSP расширения по умолчанию достаточно.
- Не затронуты: HTML-экспорты (получают исходник кодом), окно просмотра ответа.


## Просмотр, скачивание, номера строк

- Шапка каждого блока: язык | (Диаграмма/Код) | **Просмотр** | **Скачать** | Copy. Подписи кнопок — из CSS, текста в карточке они не добавляют. «Скачать» есть всегда.
- Скачивание: `DebateExport.downloadText` (Blob + `a[download]` + `revokeObjectURL`), имя `<модель|code>-<язык>-<N>.<расширение по языку>` (`extensionOf`/`downloadName`), содержимое — точный текст `pre code`.
- Просмотр: диалог (`role=dialog`, Esc/клик вне/×, фокус-ловушка, возврат фокуса). html — `iframe sandbox=""` с CSP-мета; svg — `<img data:>` (с активным содержимым — код); markdown — `MarkdownToHtml` + `sanitizeHTML`; mermaid — диаграмма; json — с отступами; csv — таблица до 200 строк; остальное — код с переключателем «Перенос строк».
- Номера строк: движок их отбрасывает при сборе; при оформлении карточки они удаляются из сырого `pre` (`LINE_NUMBER_NODES`), только внутри `pre`.
- Диаграммы Mermaid, нарисованные нами из исходника, имеют нейтральную монохромную тему (`diagramConfig`), панель `#f1f1f1`/`#2b2b2b`.
