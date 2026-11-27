# Перенос Circle (TheCycle) на 2.81.1115

## Концепция (от User, 26.11.2026)
Basic — движок запуска pipeline. Classic — существующий тип pipeline (схема шагов). Circle — новый тип pipeline со своими частями, исполняется движком Basic. Первая реализация Circle — TheCycle (ветка GPT `origin/thecycle/c01-basic-adapter`, база 2.81.700).

## План
### Решения ведущего
1. Работа GPT продолжается по его плану G1 → G5 (`docs/TheCycle/TheCycle-GLOBAL-PLAN-v2-archive.md`). Переносим всё как есть: модули следующих этапов (восстановление, активация, retention, restore), G1-панель, options-страница, alarm, workflows, документы — не удаляются. Архитектуру GPT не меняем.
2. Перенос — настоящим слиянием ветки `origin/thecycle/c01-basic-adapter` в рабочую линию: новые коммиты GPT потом вливаются без повторного переноса.
3. Правим только то, что мешает работе на 2.81.1115 и первому прогону:
   - конфликты (`results.js`, `disput/pipeline-presets.js`, два теста пресетов): сохранить всё из H и добавить Circle;
   - мост `TheCycleMainPageBridge` и `basic-adapter.js` — под API Basic H: исход по `model.id`, шаги `owner` отклонять, устаревшую проверку «input:none + task» снять (в H отбрасывается только `defaults.roundTask`), сверить сигнатуры `composeCustomPrompts` и `runModelBatch`;
   - адаптер: исключение до вызова транспорта — NOT_SENT, а не UNKNOWN; доставленная неудача одной модели (статус не SUCCESS) — ответ «нет ответа», а не UNKNOWN всего пакета;
   - Stop во время прогона моста реально прерывает запросы; `end()` моста в `try/finally`;
   - `background/index.js`: импорт модулей TheCycle — после lifecycle-барьера H, чтобы сбой в них не ломал service worker;
   - `manifest.json`: версия и permissions из H, плюс `options_page` из C.
4. Тесты GPT написаны на `node:test`: не переписываем; Jest их не запускает (исключение в `tests/jest.config.js`), отдельный скрипт `npm run test:thecycle` = `node --test tests/thecycle-*.test.js`.
5. Найденное, но не исправляемое сейчас (этапы GPT G2/G4), — в `docs/TheCycle/TheCycle-GLOBAL-PLAN-v2-archive.md`, раздел о переносе: блокировка транспорта навсегда после Stop/сбоя/перезагрузки (нужен вызов reconcile/takeOver из UI); бюджет не проверяется до цикла; фоновые копии без retention; доступ к каталогу после перезапуска Chrome; FSA в service worker не проверен; Stop в узком окне даёт STALE_STATE.

### Шаги
- [ ] S1 слияние и правки по п. 3–4 (исполнитель Sonnet)
- [ ] S2 версия, документы (ведущий)
- [ ] S3 независимая проверка (Sonnet), полный прогон тестов (Haiku)
- [ ] S4 коммит (Haiku), доставка

### Открыто
- Живая проверка в Chrome с отправкой моделям — по приёмке G1 у GPT; нужно разрешение User на тестовый prompt.
