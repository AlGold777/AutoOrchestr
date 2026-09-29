# Отчёт: применение структурных элементов Automation Layer

## A. Использовано

1. **Разделение semantic orchestration и Web transport.** Новый controller не управляет provider DOM; это остаётся существующим MyOrchestrator.
2. **Runtime-owned run identity.** Каждый процесс имеет `automationRunId`.
3. **Stage identity.** Round 1/2 получают persisted stage key `pipelineRunId = <automationRunId>:R<round>`.
4. **Fresh execution context.** Оба этапа используют `forceNewTabs: true`.
5. **Fail-closed correlation.** Live state связывается через `pipelineContext`, persisted state — через `pipelineRunId`.
6. **Existing completion authority.** Controller принимает только уже terminal state существующего runtime.
7. **Chronological projection.** Лента сортируется по `finalizedAt`.
8. **Разделение UI chronology и machine merge order.** Лента — по факту завершения; fan-in — в стабильном порядке выбранных моделей.
9. **Deterministic fan-in.** Два Round 1 ответа объединяет код, не LLM.
10. **Data/instruction separation.** Round 2 prompt явно отделяет original request, SOURCE answers и task.
11. **Prompt hashing.** SHA-256 хранится в diagnostic journal/audit.
12. **Persistent checkpoint.** Controller state хранится в `chrome.storage.local`.
13. **Append-only diagnostic journal.** События run/stage/answer/export не смешиваются с пользовательской лентой.
14. **Duplicate suppression.** Terminal event keys предотвращают повторные сообщения после reload.
15. **Recovery after reload.** Используются persisted controller state, `CompressedStorage` decoder и persisted `pipelineRunId`.
16. **Recovery markers in user feed, detail in diagnostics.** Краткие статусы recovery видны в ленте; полный append-only journal остаётся в `Runtime / Diagnostics`.
17. **Automatic artifacts.** TXT + audit JSON.
18. **Reuse существующего UI contract.** Использованы `#modTa`, `.llm-button.active` и `#debate-run-toggle-btn`; внутри страницы нет дублей composer/model controls.
19. **Bounded supervisory recovery.** При отсутствии terminal progress Automation вызывает существующий `GET_IT_BATCH` только для pending models; provider extraction и finalization по-прежнему принадлежат MyOrchestrator.

## B. Не использовано и почему

1. **Model-visible CALL_TOKEN / ATTEMPT_TOKEN** — не нужны, поскольку существующий runtime уже имеет dispatch/session correlation и stale-answer protection.
2. **PAF response envelope / обязательный JSON от моделей** — не нужен; полноту и terminal acceptance уже определяет existing completion/extraction runtime.
3. **Повторная отправка model request / собственный provider retry algorithm** — не используются. Automation содержит только bounded supervisory recovery: при зависшем finalization вызывает существующий `GET_IT_BATCH` для pending models и ограничивает recovery двумя проходами на этап.
4. **Собственный DOM completion detector** — это существующая responsibility provider infrastructure.
5. **Собственный selector layer** — selectors/configs уже есть.
6. **Stage decomposition** — в простом двухраундовом тесте нет объёмного stage output, требующего partitioning.
7. **Full Product→Architecture Registry** — вне цели transport/orchestration smoke test.
8. **Canonical domain object IDs/versions** — domain objects Framework здесь не создаются.
9. **DPL / authority classes** — нет autonomous architecture decision closure.
10. **Evidence subsystem** — тест не переводит claims в VERIFIED.
11. **Gates G1–G4** — этот тест не моделирует полный 30-stage lifecycle.
12. **PFB/AIP/CAB baselines** — вне scope.
13. **Production transactional Ledger** — `chrome.storage.local` используется только как smoke-test checkpoint; production guarantee не заявляется.
14. **Atomic multi-object StateCommitter** — Registry mutations отсутствуют.
15. **HTSK/HRES workflow** — human evidence tests отсутствуют.
16. **Formal proof of provider/model diversity** — UI позволяет выбрать две модели, но underlying provider identity не доказывается.
17. **Hard token/cost budgets** — Web UI не предоставляет единый authoritative meter.
18. **Full WAITING_FOR_OPERATOR workflow** — terminal provider failure сейчас приводит к `ERROR`; operator-resume — следующий уровень.

## C. Принцип отбора

Структурный элемент включался только если он добавляет новую гарантию и не дублирует уже существующую гарантию MyOrchestrator.

Automation Layer отвечает за межэтапную orchestration:

`human request → existing Web runtime → 2 accepted answers → deterministic fan-in → existing Web runtime → 2 final answers → artifact`

MyOrchestrator остаётся владельцем:

`provider DOM → prompt delivery → dispatch identity → generation observation → completion authority → stale-answer rejection → extraction → provider recovery`.

Automation Supervisor отслеживает отсутствие terminal progress, вызывает существующую recovery primitive и завершает этап как `FINALIZATION_STALLED`, если два recovery-прохода не привели к terminal state.
