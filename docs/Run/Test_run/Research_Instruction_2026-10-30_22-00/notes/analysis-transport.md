# Транспорт и завершение: прогон 3, расширение 2.81.952 (аналитик Haiku 5.5)

Источник: `exports/Basic-run3-v2.81.952.json`; времена как в выгрузке. «Не подтверждено» — из данных вывода нет.

## 1. Qwen-a, раунд 1: четыре FAILED «empty»
- Все 4 попытки без текста (`answerRef=null`), 273 / 186 / 573 / 190 с. Метка AO-6h6v4d есть в промпте и в `delivery.journal`.
- Терминал «пусто» выставлен раньше первого текста: journal[66] `empty_answer` 23:20:53, journal[75–76] первый текст (52 симв.) 23:20:58 (на 5,4 с позже).
- Карточка чередовалась `matched` (текст) / `wrong_card` (0 симв.) каждые ~5 с (journal[77–137]); финальное чтение попало на пустую: journal[149] `wrong_card` 0 симв. 23:22:54, journal[153] `basic_reply_text empty_plain`, итог EXTRACT_FAILED.
- В telemetry по Qwen нет событий слоя селекторов (`SELECTOR_STATS`, `WITNESS_OBSERVED`, `ANSWER_TEXT_STABLE`), у GPT и Claude они есть: какой слой отдал пусто, не определить.
- Вероятная причина: терминал «empty» до первого текста + финальное чтение на `wrong_card`; почему карточки чередуются, не подтверждено (нужен DOM вкладки).
- a2: `empty_answer` через 115 мс после prepared, до отправки (journal[162–163]). a3 («Повторить», AO-vva65z): текста не было 9 мин 25 с, `stream_start_timeout` на 572 с (23:36:01); статусы расходятся (MODEL_FINAL PARTIAL, attempt FAILED). a4: `submit_unconfirmed` 23:36:11, `send_failed` 23:39:11.

## 2. Qwen-use, раунд 3: a1 PARTIAL capped_unproven, a2 SUCCESS
- a1: `CONTEXT_LOST:context_invalidated` 23:40:30, `tab_recovering` 23:40:36 (вкладка обновлена посреди генерации); текст застыл на 78–86 симв., метки нет, завершение по `max_defer_reached` через 198 с, итог `capped_unproven`.
- a2 (повтор по `rejected_by_judge`): текст 4100 симв. за 38,5 с, итог 6043 симв. с меткой.
- Вероятная причина a1: вкладка Qwen перезагружена во время генерации (`context_invalidated` после перезагрузки расширения в начале прогона? не подтверждено).

## 3. gpt-a, раунд 1: принят при «копия неполная»
- journal[155]: `incomplete_copy`, `copyComplete=false`, plain 11981 / markdown 12026 симв., при этом `resultStatus=SUCCESS`; journal[157] через 22 мс `accepted=true`.
- Приёмка смотрит на `resultStatus`; `copyComplete` и `copyDropReason` в решении не участвуют (по порядку записей; код не читался).
- Принятый текст (11981 симв.) заканчивается «…нельзя.» без конечной метки; версия с меткой (12000 симв.) есть в том же батче. Метка в принятой копии не проверена.
- Что выпало из plain-копии (45 симв.): не подтверждено.

## 4. Лишние ожидания
- Qwen-a a3: 9 мин 25 с без текста до `stream_start_timeout`.
- Qwen-a a2 и a4: ~153 с `awaiting_submit_confirmation` после `submit_unconfirmed`.
- Qwen-a a1: после терминала «empty» (23:20:53) батч ждал Qwen до 23:22:54 (ещё 121 с).
- Qwen-use a1: терминал отложен на 198 с при тексте, не менявшемся с 23:42:41.
