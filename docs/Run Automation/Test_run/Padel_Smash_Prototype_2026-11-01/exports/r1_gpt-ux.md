# Проект прототипа Padel Smash Coach

Спецификация v1.0 · Мобильный HTML-прототип · Направление: сценарий, экраны и взаимодействия

## 1. Инженерные допущения

Владелец зафиксировал основные продуктовые решения. Для устранения пробелов принимаются следующие допущения:

1. Упражнение: базовый плоский смэш (remate plano) — атакующий удар над головой после высокого мяча. Это не подача. Другие виды смэша, bandeja и víbora не оцениваются.
2. Устройство: один смартфон для каждого участника. Прототип адаптирован под вертикальный экран, а съёмка выполняется преимущественно в горизонтальной ориентации.
3. Подход: одна видеозапись длительностью ориентировочно 10–20 секунд, содержащая 2–3 повторения смэша.
4. Роли: тренер и спортсмен используют один интерфейс. Для демонстрации роль переключается на стартовом экране.
5. Эталон: один активный видеоролик тренера для упражнения. Эталон и попытки должны иметь сопоставимые ракурс, ведущую руку и видимость тела.
6. Анализ: полностью имитируется заранее подготовленными JSON-данными и SVG-разметкой. Никаких утверждений о реально вычисленных углах суставов приложение не делает.
7. Хранение: записанные через браузер видео сохраняются локально в IndexedDB, если браузер поддерживает необходимую функциональность. Предусматривается экспорт файла. Автоматическое сохранение в системную галерею не гарантируется.
8. Исходные материалы: реальные видеозаписи тренера и спортсменов не предоставлены — не нашёл. Для сборки потребуются демонстрационные видео или нарисованные SVG-кадры с синтетическими позами.

Прототип должен демонстрировать законченный пользовательский процесс, не создавать впечатление, что имитационный анализ является настоящим компьютерным зрением.

## 2. Концепция продукта

Padel Smash Coach позволяет спортсмену снять серию смэшей, сохранить видео, сопоставить ключевые фазы движения с эталоном тренера и получить наглядные рекомендации.

Общий пользовательский процесс

Тренер

Запись эталона → Просмотр → Сохранение

Активный эталон смэша

Доступен спортсмену для сравнения

Спортсмен

Запись → Сохранение → Демонстрационный анализ

Результат

Список ошибок → Кадр с двумя скелетами → Совет → Повторная попытка

### Принципы интерфейса

- Одно основное действие на каждом этапе.
- Тренер и спортсмен используют одинаковый процесс съёмки.
- Видео всегда просматривается перед сохранением.
- Каждый вывод об ошибке связан с конкретным повторением и временной меткой.
- Выбор ошибки автоматически обновляет визуальное сравнение.
- Результаты предыдущих попыток доступны для повторного просмотра.
- Отсутствующие или неподходящие данные показываются явно, без выдуманных результатов.

## 3. Карта экранов

Всего 5 экранов. Дополнительные состояния и модальные окна не считаются отдельными экранами.

| ID  | Экран                 | Назначение                                       |
| --- | --------------------- | ------------------------------------------------ |
| S01 | Упражнение            | Выбор роли, доступ к эталону и попыткам          |
| S02 | Камера                | Запись эталона или подхода                       |
| S03 | Просмотр и сохранение | Проверка видео, пересъёмка, сохранение           |
| S04 | Анализ                | Отображение демонстрационного процесса сравнения |
| S05 | Результат             | Ошибки, советы и сравнение скелетов              |

Переходы между экранами

\#chatgpt-mermaid-\_r_ef\_{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;fill:rgb(13, 13, 13);}@keyframes edge-animation-frame{from{stroke-dashoffset:0;}}@keyframes dash{to{stroke-dashoffset:0;}}#chatgpt-mermaid-\_r_ef\_ .edge-animation-slow{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 50s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_ef\_ .edge-animation-fast{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 20s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_ef\_ .error-icon{fill:rgb(243, 243, 243);}#chatgpt-mermaid-\_r_ef\_ .error-text{fill:rgb(13, 13, 13);stroke:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_ef\_ .edge-thickness-normal{stroke-width:1px;}#chatgpt-mermaid-\_r_ef\_ .edge-thickness-thick{stroke-width:3.5px;}#chatgpt-mermaid-\_r_ef\_ .edge-pattern-solid{stroke-dasharray:0;}#chatgpt-mermaid-\_r_ef\_ .edge-thickness-invisible{stroke-width:0;fill:none;}#chatgpt-mermaid-\_r_ef\_ .edge-pattern-dashed{stroke-dasharray:3;}#chatgpt-mermaid-\_r_ef\_ .edge-pattern-dotted{stroke-dasharray:2;}#chatgpt-mermaid-\_r_ef\_ .marker{fill:rgb(143, 143, 143);stroke:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_ef\_ .marker.cross{stroke:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_ef\_ svg{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;}#chatgpt-mermaid-\_r_ef\_ p{margin:0;}#chatgpt-mermaid-\_r_ef\_ .label{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";color:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_ef\_ .cluster-label text{fill:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_ef\_ .cluster-label span{color:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_ef\_ .cluster-label span p{background-color:transparent;}#chatgpt-mermaid-\_r_ef\_ .label text,#chatgpt-mermaid-\_r_ef\_ span{fill:rgb(13, 13, 13);color:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_ef\_ .node rect,#chatgpt-mermaid-\_r_ef\_ .node circle,#chatgpt-mermaid-\_r_ef\_ .node ellipse,#chatgpt-mermaid-\_r_ef\_ .node polygon,#chatgpt-mermaid-\_r_ef\_ .node path{fill:rgb(222, 234, 251);stroke:rgb(83, 154, 248);stroke-width:1px;}#chatgpt-mermaid-\_r_ef\_ .rough-node .label text,#chatgpt-mermaid-\_r_ef\_ .node .label text,#chatgpt-mermaid-\_r_ef\_ .image-shape .label,#chatgpt-mermaid-\_r_ef\_ .icon-shape .label{text-anchor:middle;}#chatgpt-mermaid-\_r_ef\_ .node .katex path{fill:#000;stroke:#000;stroke-width:1px;}#chatgpt-mermaid-\_r_ef\_ .rough-node .label,#chatgpt-mermaid-\_r_ef\_ .node .label,#chatgpt-mermaid-\_r_ef\_ .image-shape .label,#chatgpt-mermaid-\_r_ef\_ .icon-shape .label{text-align:center;}#chatgpt-mermaid-\_r_ef\_ .node.clickable{cursor:pointer;}#chatgpt-mermaid-\_r_ef\_ .root .anchor path{fill:rgb(143, 143, 143)!important;stroke-width:0;stroke:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_ef\_ .arrowheadPath{fill:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_ef\_ .edgePath .path{stroke:rgb(143, 143, 143);stroke-width:1px;}#chatgpt-mermaid-\_r_ef\_ .flowchart-link{stroke:rgb(143, 143, 143);fill:none;}#chatgpt-mermaid-\_r_ef\_ .edgeLabel{background-color:rgb(252, 252, 252);text-align:center;}#chatgpt-mermaid-\_r_ef\_ .edgeLabel p{background-color:rgb(252, 252, 252);}#chatgpt-mermaid-\_r_ef\_ .edgeLabel rect{opacity:0.5;background-color:rgb(252, 252, 252);fill:rgb(252, 252, 252);}#chatgpt-mermaid-\_r_ef\_ .labelBkg{background-color:rgba(252, 252, 252, 0.5);}#chatgpt-mermaid-\_r_ef\_ .cluster rect{fill:rgb(243, 243, 243);stroke:rgba(0, 0, 0, 0.1);stroke-width:1px;}#chatgpt-mermaid-\_r_ef\_ .cluster text{fill:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_ef\_ .cluster span{color:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_ef\_ div.mermaidTooltip{position:absolute;text-align:center;max-width:200px;padding:2px;font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:12px;background:rgb(243, 243, 243);border:1px solid rgba(0, 0, 0, 0.1);border-radius:2px;pointer-events:none;z-index:100;}#chatgpt-mermaid-\_r_ef\_ .flowchartTitleText{text-anchor:middle;font-size:18px;fill:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_ef\_ rect.text{fill:none;stroke-width:0;}#chatgpt-mermaid-\_r_ef\_ .icon-shape,#chatgpt-mermaid-\_r_ef\_ .image-shape{background-color:rgb(252, 252, 252);text-align:center;}#chatgpt-mermaid-\_r_ef\_ .icon-shape p,#chatgpt-mermaid-\_r_ef\_ .image-shape p{background-color:rgb(252, 252, 252);padding:2px;}#chatgpt-mermaid-\_r_ef\_ .icon-shape .label rect,#chatgpt-mermaid-\_r_ef\_ .image-shape .label rect{opacity:0.5;background-color:rgb(252, 252, 252);fill:rgb(252, 252, 252);}#chatgpt-mermaid-\_r_ef\_ .label-icon{display:inline-block;height:1em;overflow:visible;vertical-align:-0.125em;}#chatgpt-mermaid-\_r_ef\_ .node .label-icon path{fill:currentColor;stroke:revert;stroke-width:revert;}#chatgpt-mermaid-\_r_ef\_ .node .neo-node{stroke:rgb(83, 154, 248);}#chatgpt-mermaid-\_r_ef\_ [data-look="neo"].node rect,#chatgpt-mermaid-\_r_ef\_ [data-look="neo"].cluster rect,#chatgpt-mermaid-\_r_ef\_ [data-look="neo"].node polygon{stroke:url(#chatgpt-mermaid-\_r_ef\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_ef\_ [data-look="neo"].swimlane.cluster rect{filter:none;}#chatgpt-mermaid-\_r_ef\_ [data-look="neo"].node path{stroke:url(#chatgpt-mermaid-\_r_ef\_-gradient);stroke-width:1px;}#chatgpt-mermaid-\_r_ef\_ [data-look="neo"].node .outer-path{filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_ef\_ [data-look="neo"].node .neo-line path{stroke:rgb(83, 154, 248);filter:none;}#chatgpt-mermaid-\_r_ef\_ [data-look="neo"].node circle{stroke:url(#chatgpt-mermaid-\_r_ef\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_ef\_ [data-look="neo"].node circle .state-start{fill:#000000;}#chatgpt-mermaid-\_r_ef\_ [data-look="neo"].icon-shape .icon{fill:url(#chatgpt-mermaid-\_r_ef\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_ef\_ [data-look="neo"].icon-shape .icon-neo path{stroke:url(#chatgpt-mermaid-\_r_ef\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_ef\_ .node text{font-size:14px;font-weight:600;letter-spacing:normal;fill:rgb(0, 79, 153);}#chatgpt-mermaid-\_r_ef\_ .edgeLabels text{font-size:13px;font-weight:600;letter-spacing:-0.08px;fill:rgb(0, 79, 153);}#chatgpt-mermaid-\_r_ef\_ .node tspan[font-weight="normal"],#chatgpt-mermaid-\_r_ef\_ .edgeLabels tspan[font-weight="normal"]{font-weight:600;}#chatgpt-mermaid-\_r_ef\_ .edgeLabel .label rect{opacity:1;rx:13px;ry:13px;fill:rgb(245, 250, 255);stroke:rgb(206, 219, 229);stroke-width:1px;}#chatgpt-mermaid-\_r_ef\_ .node rect,#chatgpt-mermaid-\_r_ef\_ .node circle,#chatgpt-mermaid-\_r_ef\_ .node ellipse,#chatgpt-mermaid-\_r_ef\_ .node polygon,#chatgpt-mermaid-\_r_ef\_ .node path{fill:rgb(229, 243, 255);stroke:rgba(0, 0, 0, 0.1);stroke-width:1px;}#chatgpt-mermaid-\_r_ef\_ .node rect{rx:16px;ry:16px;}#chatgpt-mermaid-\_r_ef\_ .mermaid-decision .label-container{fill:rgb(245, 250, 255);stroke:rgb(206, 219, 229);stroke-dasharray:2,2;}#chatgpt-mermaid-\_r_ef\_ .edgePaths .flowchart-link{stroke:rgb(143, 143, 143);stroke-width:1px;stroke-linecap:round;stroke-linejoin:round;}#chatgpt-mermaid-\_r_ef\_ .marker{fill:rgb(143, 143, 143);stroke:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_ef\_ :root{--mermaid-font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";}S01 · УпражнениеS02 · КамераS03 · Просмотр исохранениеS04 · АнализS05 · РезультатПереснятьТренер сохраняет эталонСпортсмен сохраняетпопыткуПовторить подходВсе попыткиОткрыть готовый результат

## 4. Сквозные сценарии

### 4.1. Роль тренера: создание эталона

Начальное условие: выбран режим «Тренер».

1. Тренер открывает упражнение «Смэш».
2. Видит состояние эталона: отсутствует либо уже сохранён.
3. Нажимает «Записать эталон».
4. Открывается общий экран камеры S02 с обозначением роли.
5. Тренер устанавливает телефон так, чтобы спортсмен, ракетка и зона удара помещались в кадре.
6. Нажимает «Начать запись» и демонстрирует 2–3 правильных смэша.
7. Останавливает запись и переходит на S03.
8. Просматривает видео. При необходимости выбирает «Переснять».
9. Нажимает «Сохранить эталон».
10. Приложение сохраняет видеоматериал, присваивает ему идентификатор и делает активным эталоном упражнения.
11. Тренер возвращается на S01 и видит подтверждение «Эталон готов».

При замене существующего эталона система запрашивает подтверждение. Старые попытки продолжают ссылаться на прежнюю версию эталона либо явно помечаются как несовместимые, если прежняя версия удалена.

Результат: сохранённый эталон доступен для последующих попыток спортсмена.

### 4.2. Роль спортсмена: тренировка и разбор

Начальное условие: существует активный эталон.

1. Спортсмен открывает упражнение и видит карточку тренерского эталона.
2. Нажимает «Снять подход».
3. На экране S02 получает инструкцию по расположению телефона.
4. Снимает серию смэшей и останавливает запись.
5. На S03 просматривает полученное видео.
6. Нажимает «Сохранить и анализировать».
7. Видео сохраняется, создаётся новая попытка и открывается S04.
8. Приложение выполняет имитацию анализа, выбирая подготовленные ошибки по идентификатору попытки.
9. На S05 спортсмен видит количество замечаний и список ошибок.
10. Выбирает конкретную ошибку.
11. Система показывает нужный момент движения: слева спортсмен, справа тренер, поверх изображения — скелеты, выделенные суставы и метки времени.
12. Спортсмен читает рекомендацию и нажимает «Повторить подход».
13. Новая видеозапись создаётся как отдельная попытка. Предыдущая остаётся в истории.

Результат: спортсмен понимает, что именно изменить в следующей серии ударов, и может сравнивать свои попытки.

## 5. Подробное описание экранов

### S01. Упражнение «Смэш»

Назначение: центральная точка начала и продолжения тренировки.

PADEL COACH

Прототип

Спортсмен

Тренер

[Что такое падел-теннис и как в него играть - Чемпионат](https://images.openai.com/static-rsc-4/59jQvX3-R0POdaDhdGw-OEG3kFvHhXqS3X4dOISYVuLu55YuG6OHeMofjfOaEz3sCSvLHTlrdLbzXMG6PWvRLIogNlg4AvpVWsUqKE91IxbHIsGN3nW0oUOWZkShFRjmjJ_RCRi8tTu_-AypvOaNo0dKUITF13yjZsveAFAu_sQ?purpose=inline)

[championat.com](https://www.championat.com/lifestyle/article-5508392-chto-takoe-padel-tennis-i-kak-v-nego-igrat.html?utm_source=chatgpt.com)

## Смэш

Техника атакующего удара над головой

Эталон тренера доступен

Мои попытки

Попытка 02 · 2 замечания

Попытка 01 · 4 замечания

Снять подход

Схематический макет. Изображение иллюстративное, не эталон тренера.

Содержимое: название упражнения, переключатель роли, карточка эталона, история попыток, основная кнопка действия.

Поведение по ролям: у тренера основная кнопка называется «Записать эталон» или «Заменить эталон». У спортсмена — «Снять подход». При отсутствии эталона спортсмену предлагается сначала создать его в режиме тренера либо воспользоваться заранее заготовленным демонстрационным эталоном.

Переходы: основная кнопка → S02; выбор ранее проанализированной попытки → S05; просмотр эталона → встроенное окно видеопросмотра без перехода на отдельный экран.

### S02. Камера

Назначение: обеспечить запись движения с достаточной видимостью для последующего сравнения.

Элементы:

- Живое изображение с камеры или демонстрационный кадр при отсутствии разрешения.
- Обозначение роли: «Эталон тренера» либо «Подход спортсмена».
- Сетка кадрирования и силуэтная зона расположения игрока.
- Инструкция: «Поместите в кадр всё тело, ракетку и зону удара».
- Кнопки «Начать», «Остановить», «Отмена».
- Счётчик длительности, индикатор состояния записи.
- Опциональный обратный отсчёт перед началом записи.

Съёмка может происходить в горизонтальной ориентации, но система управления должна оставаться доступной на телефоне.

Состояния: подготовка, запись, остановлено, ошибка камеры.

Переходы: остановка корректной записи → S03; отмена → S01; ошибка доступа → возможность выбрать локальное видео, повторить разрешение или загрузить демонстрационную попытку.

Для настоящей браузерной видеозаписи потребуется HTTPS либо localhost и разрешение камеры. Открытие файла напрямую через `file://` не гарантирует доступ к камере.

### S03. Просмотр и сохранение

Назначение: пользователь должен убедиться, что материал пригоден, прежде чем сохранять его.

Элементы: видеоплеер, полоса воспроизведения, длительность, номер попытки или признак эталона, кнопка «Переснять», основная кнопка сохранения.

У тренера:

«Сохранить эталон» → локальная запись и обновление активного эталона → S01.

У спортсмена:

«Сохранить и анализировать» → локальная запись, создание попытки и привязка к эталону → S04.

Критическое правило: переход к анализу разрешён только после подтверждённого сохранения видеоданных или после явного выбора заранее подготовленного демонстрационного видео.

При ошибке сохранения пользователь остаётся на S03 и получает возможность повторить операцию или экспортировать файл.

### S04. Анализ

Назначение: показать процесс обработки попытки и переход к результату, сохраняя совместимость с будущим аналитическим модулем.

Анализ смэша

Демо

Сопоставление движений

Используются заранее подготовленные данные

&#x20;Видео подготовлено

&#x20;Эталон выбран

&#x20;Формируется разбор

Этапы отображения:

1. Подготовка видео.
2. Сопоставление демонстрационных ключевых фаз.
3. Формирование списка замечаний.
4. Переход к результату.

Прогресс в прототипе является сценарным, а не результатом настоящих вычислений. При отсутствии JSON для конкретной попытки необходимо показать ошибку «Демонстрационные данные не найдены», а не подставлять произвольные ошибки.

Переходы: успешное завершение → S05; отмена → S01; повтор при ошибке → S04.

### S05. Результат анализа

Это главный продуктовый экран. Он должен давать ответ на три вопроса: где ошибка, чем движение отличается от эталона и как её исправить.

## Разбор смэша

Попытка 01 · 12 секунд

Демо

Найдено 4 замечания

Удар 1 из 2

Момент контакта

00:02.40

Спортсмен

00:02.40

Тренер

00:02.10

Схематические SVG-позы для демонстрации. Не являются результатом анализа реального видео.

Ошибки техники

1\. Низкая точка контакта

Удар 1 · 00:02.40

Рука согнута, мяч встречается слишком низко.

Совет: вытяни руку и встречай мяч выше, немного впереди себя.

2\. Поздняя подготовка

3\. Недостаточный разворот корпуса

4\. Потеря равновесия

Повторить подход

Все попытки

#### Логика экрана результата

Верхняя часть: название упражнения, номер попытки, количество замечаний, обозначение демонстрационного режима.

Визуальный блок: два кадра, показывающие одинаковую фазу движения. На кадрах нанесены заранее подготовленные 2D-скелеты. Проблемный сустав или сегмент спортсмена выделяется контрастным цветом. У тренера показывается соответствующее правильное положение.

Временные метки: для спортсмена и эталона могут отображаться разные времена. Например, 00:02.40 и 00:02.10. Сопоставление выполняется по фазе смэша, а не по равенству времени с начала видео.

Список ошибок: каждая карточка содержит название, номер удара, временную метку, краткое объяснение и совет. Выбранная карточка раскрывается, остальные остаются свернутыми.

Связь ошибки и кадра: нажатие на любую карточку выполняет одну атомарную операцию интерфейса:

- Изменяет `selectedErrorId`.
- Загружает относящуюся к ошибке пару кадров.
- Обновляет метки времени и выделенные сегменты скелета.
- Показывает соответствующий совет.
- Прокручивает визуальный блок в видимую область, если он оказался выше экрана.

При небольшом экране два кадра остаются рядом для непосредственного сравнения. Нажатие на кадр открывает увеличенное модальное представление. Дополнительный режим «По одному» позволяет последовательно просматривать изображения без уменьшения масштаба.

Для прототипа используется переключение между заранее размеченными ключевыми кадрами. Свободная покадровая перемотка с непрерывной корректной разметкой не имитируется.

Нижняя часть: основное действие «Повторить подход» → S02, дополнительное «Все попытки» → S01.

При нуле ошибок экран сообщает «В демонстрационных данных замечаний нет», но не делает вывод об идеальной технике.

## 6. Каталог типичных ошибок смэша

Каталог ориентирован на базовый плоский смэш. Технические принципы — ранняя подготовка, правильная позиция относительно мяча, высокая точка контакта, разворот корпуса и перенос массы — согласуются с учебными материалами по паделу.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://www.ltapadel.org.uk\&sz=32)

LTA Padel+3



Это редакционный каталог для прототипа, а не диагностические правила с подтверждёнными численными порогами.

| Код и ошибка                            | Признак на видео                                            | Что не так                                                  | Как исправить                                               | Совет одной фразой                                  |
| --------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------- |
| SM01. Поздняя подготовка                | Ракетка поднимается непосредственно перед контактом         | Недостаточно времени для согласованного движения            | Начинать подготовку сразу после распознавания высокого мяча | «Подними ракетку раньше и подготовь удар заранее».  |
| SM02. Недостаточный разворот корпуса    | Плечи почти не разворачиваются боком перед ударом           | Ограничивается участие корпуса в ударном движении           | Выполнить ранний боковой разворот                           | «Разверни плечи боком ещё до замаха».               |
| SM03. Пассивная свободная рука          | Нерабочая рука сразу опущена вдоль тела                     | Теряется дополнительный ориентир для мяча и подготовки плеч | Поднять свободную руку для сопровождения траектории мяча    | «Направь свободную руку к мячу при подготовке».     |
| SM04. Низкая точка контакта             | Локоть ударной руки заметно согнут в момент встречи с мячом | Снижается доступная высота контакта                         | Раньше занять позицию и вытянуть ударную руку               | «Встречай мяч выше, с вытянутой рукой».             |
| SM05. Контакт за корпусом               | Мяч встречается позади линии ударного плеча                 | Игрок не успевает занять правильную позицию                 | Раньше сместиться под траекторию мяча                       | «Займи позицию так, чтобы мяч был немного впереди». |
| SM06. Потеря баланса                    | После удара корпус заметно отклоняется назад                | Устойчивость и перенос массы нарушены                       | Стабилизировать опору и направить движение в сторону удара  | «Сохраняй баланс и направляй движение вперёд».      |
| SM07. Резко прерванное сопровождение    | Ракетка останавливается сразу после контакта                | Движение обрывается вместо контролируемого завершения       | Продолжить естественную траекторию ракетки                  | «Не обрывай удар сразу после контакта».             |
| SM08. Отсутствие восстановления позиции | Игрок остаётся неподвижным после смэша                      | Задерживается подготовка к следующему мячу                  | Восстановить устойчивую игровую позицию                     | «После смэша сразу готовься к следующему удару».    |

Пороговые значения, например допустимый угол локтя или разворота плеч, здесь не устанавливаются. Для реального анализа они должны калиброваться тренером, зависеть от фазы, ракурса, варианта удара и надёжности распознавания.

Дополнительно ошибки SM02, SM05 и SM06 могут быть трудноразличимы на одном двумерном ракурсе. В дальнейшем низкая достоверность должна приводить к состоянию «Недостаточно данных», а не к категоричному диагнозу.

## 7. Демонстрационные данные

### 7.1. Структура

Для прототипа используются сущности:

| Сущность  | Основные поля                                                   |
| --------- | --------------------------------------------------------------- |
| Exercise  | `id`, `name`, `shotType`                                        |
| Reference | `id`, `videoId`, `role`, `viewpoint`, `handedness`              |
| Attempt   | `id`, `videoId`, `referenceId`, `durationMs`                    |
| Analysis  | `mode`, `status`, `errors`                                      |
| Error     | `id`, `code`, `shotIndex`, `athleteMs`, `referenceMs`, `advice` |
| Evidence  | `phase`, `athletePose`, `referencePose`, `highlightSegments`    |

Все попытки должны ссылаться на конкретную версию эталона.

### 7.2. JSON-пример двух попыток

```

{
  "schemaVersion": "1.0",
  "exercise": {
    "id": "padel-smash-flat",
    "name": "Плоский смэш",
    "shotType": "remate_plano"
  },
  "reference": {
    "id": "ref-001",
    "videoId": "coach-demo-001",
    "role": "coach",
    "viewpoint": "rear-oblique",
    "handedness": "right",
    "source": "demo"
  },
  "attempts": [
    {
      "id": "attempt-001",
      "videoId": "athlete-demo-001",
      "referenceId": "ref-001",
      "durationMs": 12000,
      "shotCount": 2,
      "analysis": {
        "mode": "mock",
        "status": "ready",
        "errors": [
          {
            "id": "err-001",
            "code": "SM04",
            "shotIndex": 1,
            "phase": "contact",
            "athleteMs": 2400,
            "referenceMs": 2100,
            "advice": "Встречай мяч выше, с вытянутой рукой.",
            "evidence": {
              "type": "svg-preset",
              "athletePose": "low-contact",
              "referencePose": "high-contact",
              "highlightSegments": ["rightElbow", "rightWrist"]
            }
          },
          {
            "id": "err-002",
            "code": "SM01",
            "shotIndex": 1,
            "phase": "preparation",
            "athleteMs": 1600,
            "referenceMs": 1300,
            "advice": "Подними ракетку раньше.",
            "evidence": {
              "type": "svg-preset",
              "athletePose": "late-preparation",
              "referencePose": "early-preparation",
              "highlightSegments": ["rightShoulder", "rightElbow"]
            }
          },
          {
            "id": "err-003",
            "code": "SM02",
            "shotIndex": 2,
            "phase": "preparation",
            "athleteMs": 6900,
            "referenceMs": 6200,
            "advice": "Разверни плечи боком.",
            "evidence": {
              "type": "svg-preset",
              "athletePose": "limited-turn",
              "referencePose": "full-turn",
              "highlightSegments": ["leftShoulder", "rightShoulder"]
            }
          },
          {
            "id": "err-004",
            "code": "SM06",
            "shotIndex": 2,
            "phase": "recovery",
            "athleteMs": 8800,
            "referenceMs": 8200,
            "advice": "Сохраняй баланс.",
            "evidence": {
              "type": "svg-preset",
              "athletePose": "leaning-back",
              "referencePose": "balanced-finish",
              "highlightSegments": ["leftHip", "rightHip"]
            }
          }
        ]
      }
    },
    {
      "id": "attempt-002",
      "videoId": "athlete-demo-002",
      "referenceId": "ref-001",
      "durationMs": 11000,
      "shotCount": 2,
      "analysis": {
        "mode": "mock",
        "status": "ready",
        "errors": [
          {
            "id": "err-005",
            "code": "SM05",
            "shotIndex": 1,
            "phase": "contact",
            "athleteMs": 2500,
            "referenceMs": 2100,
            "advice": "Встречай мяч немного впереди.",
            "evidence": {
              "type": "svg-preset",
              "athletePose": "contact-behind",
              "referencePose": "high-contact",
              "highlightSegments": ["rightShoulder", "rightWrist"]
            }
          },
          {
            "id": "err-006",
            "code": "SM08",
            "shotIndex": 2,
            "phase": "recovery",
            "athleteMs": 9100,
            "referenceMs": 8200,
            "advice": "Сразу готовься к следующему удару.",
            "evidence": {
              "type": "svg-preset",
              "athletePose": "static-recovery",
              "referencePose": "balanced-finish",
              "highlightSegments": ["leftAnkle", "rightAnkle"]
            }
          }
        ]
      }
    }
  ]
}

```

Здесь `videoId` — логические идентификаторы, а `athletePose` и `referencePose` — ключи статических SVG-заготовок, которые должны быть подготовлены при сборке. Это не URL и не свидетельство существования реальных видео.

В полном демонстрационном наборе необходимо предусмотреть исходные видеоролики либо видеозаглушки, все используемые SVG-позы, каталог ошибок и описания кадров. Каждая ссылка между сущностями должна разрешаться локально.

Сценарный контраст: у попытки 01 четыре замечания, у попытки 02 два. Это позволяет продемонстрировать историю и уменьшение числа замечаний без недоказанных оценок процента улучшения техники.

## 8. Замена имитации настоящим анализом позы

Интерфейс не должен зависеть от способа получения аналитических данных.

Предлагаемое разделение:

\#chatgpt-mermaid-\_r_g8\_{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;fill:rgb(13, 13, 13);}@keyframes edge-animation-frame{from{stroke-dashoffset:0;}}@keyframes dash{to{stroke-dashoffset:0;}}#chatgpt-mermaid-\_r_g8\_ .edge-animation-slow{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 50s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_g8\_ .edge-animation-fast{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 20s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_g8\_ .error-icon{fill:rgb(243, 243, 243);}#chatgpt-mermaid-\_r_g8\_ .error-text{fill:rgb(13, 13, 13);stroke:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_g8\_ .edge-thickness-normal{stroke-width:1px;}#chatgpt-mermaid-\_r_g8\_ .edge-thickness-thick{stroke-width:3.5px;}#chatgpt-mermaid-\_r_g8\_ .edge-pattern-solid{stroke-dasharray:0;}#chatgpt-mermaid-\_r_g8\_ .edge-thickness-invisible{stroke-width:0;fill:none;}#chatgpt-mermaid-\_r_g8\_ .edge-pattern-dashed{stroke-dasharray:3;}#chatgpt-mermaid-\_r_g8\_ .edge-pattern-dotted{stroke-dasharray:2;}#chatgpt-mermaid-\_r_g8\_ .marker{fill:rgb(143, 143, 143);stroke:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_g8\_ .marker.cross{stroke:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_g8\_ svg{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;}#chatgpt-mermaid-\_r_g8\_ p{margin:0;}#chatgpt-mermaid-\_r_g8\_ .label{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";color:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_g8\_ .cluster-label text{fill:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_g8\_ .cluster-label span{color:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_g8\_ .cluster-label span p{background-color:transparent;}#chatgpt-mermaid-\_r_g8\_ .label text,#chatgpt-mermaid-\_r_g8\_ span{fill:rgb(13, 13, 13);color:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_g8\_ .node rect,#chatgpt-mermaid-\_r_g8\_ .node circle,#chatgpt-mermaid-\_r_g8\_ .node ellipse,#chatgpt-mermaid-\_r_g8\_ .node polygon,#chatgpt-mermaid-\_r_g8\_ .node path{fill:rgb(222, 234, 251);stroke:rgb(83, 154, 248);stroke-width:1px;}#chatgpt-mermaid-\_r_g8\_ .rough-node .label text,#chatgpt-mermaid-\_r_g8\_ .node .label text,#chatgpt-mermaid-\_r_g8\_ .image-shape .label,#chatgpt-mermaid-\_r_g8\_ .icon-shape .label{text-anchor:middle;}#chatgpt-mermaid-\_r_g8\_ .node .katex path{fill:#000;stroke:#000;stroke-width:1px;}#chatgpt-mermaid-\_r_g8\_ .rough-node .label,#chatgpt-mermaid-\_r_g8\_ .node .label,#chatgpt-mermaid-\_r_g8\_ .image-shape .label,#chatgpt-mermaid-\_r_g8\_ .icon-shape .label{text-align:center;}#chatgpt-mermaid-\_r_g8\_ .node.clickable{cursor:pointer;}#chatgpt-mermaid-\_r_g8\_ .root .anchor path{fill:rgb(143, 143, 143)!important;stroke-width:0;stroke:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_g8\_ .arrowheadPath{fill:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_g8\_ .edgePath .path{stroke:rgb(143, 143, 143);stroke-width:1px;}#chatgpt-mermaid-\_r_g8\_ .flowchart-link{stroke:rgb(143, 143, 143);fill:none;}#chatgpt-mermaid-\_r_g8\_ .edgeLabel{background-color:rgb(252, 252, 252);text-align:center;}#chatgpt-mermaid-\_r_g8\_ .edgeLabel p{background-color:rgb(252, 252, 252);}#chatgpt-mermaid-\_r_g8\_ .edgeLabel rect{opacity:0.5;background-color:rgb(252, 252, 252);fill:rgb(252, 252, 252);}#chatgpt-mermaid-\_r_g8\_ .labelBkg{background-color:rgba(252, 252, 252, 0.5);}#chatgpt-mermaid-\_r_g8\_ .cluster rect{fill:rgb(243, 243, 243);stroke:rgba(0, 0, 0, 0.1);stroke-width:1px;}#chatgpt-mermaid-\_r_g8\_ .cluster text{fill:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_g8\_ .cluster span{color:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_g8\_ div.mermaidTooltip{position:absolute;text-align:center;max-width:200px;padding:2px;font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:12px;background:rgb(243, 243, 243);border:1px solid rgba(0, 0, 0, 0.1);border-radius:2px;pointer-events:none;z-index:100;}#chatgpt-mermaid-\_r_g8\_ .flowchartTitleText{text-anchor:middle;font-size:18px;fill:rgb(13, 13, 13);}#chatgpt-mermaid-\_r_g8\_ rect.text{fill:none;stroke-width:0;}#chatgpt-mermaid-\_r_g8\_ .icon-shape,#chatgpt-mermaid-\_r_g8\_ .image-shape{background-color:rgb(252, 252, 252);text-align:center;}#chatgpt-mermaid-\_r_g8\_ .icon-shape p,#chatgpt-mermaid-\_r_g8\_ .image-shape p{background-color:rgb(252, 252, 252);padding:2px;}#chatgpt-mermaid-\_r_g8\_ .icon-shape .label rect,#chatgpt-mermaid-\_r_g8\_ .image-shape .label rect{opacity:0.5;background-color:rgb(252, 252, 252);fill:rgb(252, 252, 252);}#chatgpt-mermaid-\_r_g8\_ .label-icon{display:inline-block;height:1em;overflow:visible;vertical-align:-0.125em;}#chatgpt-mermaid-\_r_g8\_ .node .label-icon path{fill:currentColor;stroke:revert;stroke-width:revert;}#chatgpt-mermaid-\_r_g8\_ .node .neo-node{stroke:rgb(83, 154, 248);}#chatgpt-mermaid-\_r_g8\_ [data-look="neo"].node rect,#chatgpt-mermaid-\_r_g8\_ [data-look="neo"].cluster rect,#chatgpt-mermaid-\_r_g8\_ [data-look="neo"].node polygon{stroke:url(#chatgpt-mermaid-\_r_g8\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_g8\_ [data-look="neo"].swimlane.cluster rect{filter:none;}#chatgpt-mermaid-\_r_g8\_ [data-look="neo"].node path{stroke:url(#chatgpt-mermaid-\_r_g8\_-gradient);stroke-width:1px;}#chatgpt-mermaid-\_r_g8\_ [data-look="neo"].node .outer-path{filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_g8\_ [data-look="neo"].node .neo-line path{stroke:rgb(83, 154, 248);filter:none;}#chatgpt-mermaid-\_r_g8\_ [data-look="neo"].node circle{stroke:url(#chatgpt-mermaid-\_r_g8\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_g8\_ [data-look="neo"].node circle .state-start{fill:#000000;}#chatgpt-mermaid-\_r_g8\_ [data-look="neo"].icon-shape .icon{fill:url(#chatgpt-mermaid-\_r_g8\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_g8\_ [data-look="neo"].icon-shape .icon-neo path{stroke:url(#chatgpt-mermaid-\_r_g8\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_g8\_ .node text{font-size:14px;font-weight:600;letter-spacing:normal;fill:rgb(0, 79, 153);}#chatgpt-mermaid-\_r_g8\_ .edgeLabels text{font-size:13px;font-weight:600;letter-spacing:-0.08px;fill:rgb(0, 79, 153);}#chatgpt-mermaid-\_r_g8\_ .node tspan[font-weight="normal"],#chatgpt-mermaid-\_r_g8\_ .edgeLabels tspan[font-weight="normal"]{font-weight:600;}#chatgpt-mermaid-\_r_g8\_ .edgeLabel .label rect{opacity:1;rx:13px;ry:13px;fill:rgb(245, 250, 255);stroke:rgb(206, 219, 229);stroke-width:1px;}#chatgpt-mermaid-\_r_g8\_ .node rect,#chatgpt-mermaid-\_r_g8\_ .node circle,#chatgpt-mermaid-\_r_g8\_ .node ellipse,#chatgpt-mermaid-\_r_g8\_ .node polygon,#chatgpt-mermaid-\_r_g8\_ .node path{fill:rgb(229, 243, 255);stroke:rgba(0, 0, 0, 0.1);stroke-width:1px;}#chatgpt-mermaid-\_r_g8\_ .node rect{rx:16px;ry:16px;}#chatgpt-mermaid-\_r_g8\_ .mermaid-decision .label-container{fill:rgb(245, 250, 255);stroke:rgb(206, 219, 229);stroke-dasharray:2,2;}#chatgpt-mermaid-\_r_g8\_ .edgePaths .flowchart-link{stroke:rgb(143, 143, 143);stroke-width:1px;stroke-linecap:round;stroke-linejoin:round;}#chatgpt-mermaid-\_r_g8\_ .marker{fill:rgb(143, 143, 143);stroke:rgb(143, 143, 143);}#chatgpt-mermaid-\_r_g8\_ :root{--mermaid-font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";}Сохранённое видеоAnalysis ProviderЕдиный JSON-контрактS05 · РезультатMock ProviderPose Analysis Provider —позже

В первой версии используется `MockAnalysisProvider`: он получает `attemptId` и `referenceId`, возвращает заранее заготовленный объект `analysis`.

В дальнейшем добавляется `PoseAnalysisProvider` с тем же внешним контрактом. Ему потребуется выполнить следующие операции:

1. Декодировать видеокадры и проверить достаточность изображения.
2. Найти ключевые точки тела, оценить качество распознавания и их временную стабильность.
3. Сегментировать подход на отдельные смэши и выделить подготовку, контакт, завершение и восстановление.
4. Сопоставить ключевые фазы спортсмена и эталона без предположения, что они происходят в одинаковое время.
5. Вычислить только те геометрические или временные признаки, которые можно надёжно извлечь из выбранного ракурса.
6. Применить проверенные правила и пороги, настроенные тренером.
7. Вернуть каталог ошибок, временные метки, разметку кадров и оценки достоверности.

Для настоящей системы потребуется отдельная валидация определения момента контакта мяча и ракетки. Один лишь скелет тела не гарантирует точного определения момента удара; может понадобиться отслеживание ракетки, мяча или ручная коррекция.

Технические признаки, которые должны быть добавлены в контракт позднее: `confidence`, `analysisVersion`, `modelVersion`, `qualityWarnings`, `unassessablePhases` и сведения о системе координат.

В результате экраны S01–S05 и большая часть компонентов результата останутся прежними; изменится только источник аналитических данных.

## 9. План сборки HTML-прототипа

### Этап 1. Основа интерфейса

Создать адаптивное HTML-приложение с пятью экранами, переходами без перезагрузки страницы и управлением состоянием роли, выбранной попытки и выбранной ошибки.

Результат: все переходы работают на компьютере и мобильном браузере.

### Этап 2. Демонстрационные материалы

Подготовить один эталон, две попытки, JSON из раздела 7 и SVG-позы для всех шести ошибок этих попыток. Для визуально убедительного результата предпочтительно использовать одинаковый ракурс и тип движения.

Результат: приложение работает без камеры, используя демонстрационные данные.

### Этап 3. Съёмка и сохранение

Подключить браузерную камеру и MediaRecorder, реализовать просмотр, повторную съёмку, локальное хранение видео и экспорт. Предусмотреть выбор видео из файлов устройства, если запись через браузер невозможна.

Формат контейнера выбирается по фактически поддерживаемому браузером MIME-типу, без требования обязательного MP4.

Результат: пользователь способен создать собственный локальный видеоролик. Для пользовательских видео, не имеющих подготовленных аналитических данных, результат не подделывается: предлагается демонстрационный пример.

### Этап 4. Анализ и результат

Подключить MockAnalysisProvider, сценарные состояния обработки, список ошибок, выбор ключевых кадров, отрисовку двух скелетов и рекомендации.

Результат: обе подготовленные попытки показывают независимые, воспроизводимые разборы.

### Этап 5. Финальная проверка

Проверить мобильную адаптацию, сохранность видео, отсутствие неработающих переходов, читаемость двух кадров и корректную обработку ошибок.

Для передачи прототипа предлагается статический сайт, работающий по HTTPS. При необходимости полностью автономной демонстрации видеоматериалы, JSON и SVG должны находиться в локальном комплекте, без обращения к внешним API.

## 10. Критерии приёмки

| ID   | Проверка                       | Ожидаемый результат                                                                                    |
| ---- | ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| AC01 | Открытие прототипа на телефоне | Все пять экранов доступны, горизонтальной прокрутки страницы нет                                       |
| AC02 | Переключение роли              | Интерфейс меняет основной сценарий, сохраняя общий экран камеры                                        |
| AC03 | Запись тренера                 | Эталон можно снять, просмотреть, переснять и сохранить                                                 |
| AC04 | Сохранение спортсмена          | Попытка сохраняется до перехода к анализу                                                              |
| AC05 | Повторный просмотр             | Сохранённое видео доступно после навигации и перезагрузки в рамках поддерживаемого локального хранения |
| AC06 | Анализ попытки 01              | Отображаются четыре заранее заданные ошибки                                                            |
| AC07 | Анализ попытки 02              | Отображаются две заранее заданные ошибки                                                               |
| AC08 | Выбор ошибки                   | Обновляются кадры, скелеты, метки времени и совет                                                      |
| AC09 | Сопоставление фаз              | Кадр спортсмена и эталона соответствует одинаковой фазе, даже если метки времени различаются           |
| AC10 | Повторная попытка              | Запускается S02, предыдущие данные не перезаписываются                                                 |
| AC11 | Недоступность камеры           | Предлагается альтернативный демонстрационный сценарий или импорт видео                                 |
| AC12 | Ошибка сохранения              | Нет ложного перехода к успешному анализу                                                               |
| AC13 | Отсутствующий JSON             | Выводится явное сообщение, случайные ошибки не генерируются                                            |
| AC14 | Отсутствие эталона             | Анализ не запускается без выбора действительного эталона                                               |
| AC15 | Прозрачность имитации          | Демонстрационный анализ обозначен на экранах S04 и S05                                                 |
| AC16 | Замена провайдера              | UI принимает результат нового провайдера в том же контракте без переработки экранов                    |

Условие приёмки: прототип считается завершённым, когда оба основных сценария проходят от начала до конца, демонстрационные результаты воспроизводимы и визуальная разметка соответствует выбранным ошибкам.

## 11. Границы реализации и итоговая архитектурная рекомендация

Проект сознательно не включает регистрацию, оплату, облачную синхронизацию, рейтинг спортсменов, медицинские или биомеханические заключения, а также настоящее распознавание движений. Эти возможности не требуются для проверки основной продуктовой гипотезы.

Особенно важно не смешивать три независимые функции: запись, сохранение и анализ. У каждой должен быть отдельный статус и понятная обработка ошибки. Это обеспечит возможность последующей замены демонстрационных данных настоящей системой компьютерного зрения без изменения пользовательского сценария.

Основной продуктовый критерий — не количество экранов и не сложность анимации, а способность спортсмена быстро связать конкретную ошибку со своим положением тела, увидеть соответствующий эталон тренера и понять, какое движение изменить в следующем подходе.

Для первой версии приоритет разработки: S05 «Результат» → демонстрационные данные → S02/S03 «Съёмка и сохранение» → объединение полного процесса. Такой порядок сначала проверяет наиболее важную ценность продукта, затем обеспечивает реальную видеозапись и сквозную навигацию.

КОНЕЦ-ОТВЕТА