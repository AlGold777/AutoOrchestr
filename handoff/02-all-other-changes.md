> **Исторический документ.** Снимок версии 2.80.200. Режимы Duel, Triad, Multi и FreeTalk из него удалены; актуальное описание — `docs/project-overview.md` и `docs/Pipeline scenarios/basic-start-here.md`.

# Документ 2 — Все остальные изменения этой беседы

> База: та же (версия 2.80.200, основная папка `/Users/restart/Downloads/LLM_Sol-Fable`).
> Эти правки НЕ обязательны для фикса «flow = pipeline» (см. Документ 1), но
> сделаны в этой же сессии. Порядок разделов независим.

Разделы:
- **1.** Канвас ↔ реальный runtime (Final Synthesis для Duel, чипы фильтров, подписи)
- **2.** Роли участников + протокол-миссии (пресеты реально различаются)
- **3.** Компактные prompt-шаблоны Debate
- **4.** Детектор окончания генерации (главная страница)
- **5.** Инспектор pipeline: показывать применяемую роль
- **6.** Обновления документации

---

## 1. Канвас ↔ реальный runtime

Проблема: канвас показывал не то, что реально исполняет runtime. Runtime всегда
делает Final Synthesis (в т.ч. Duel), после каждого R-раунда — filter-pass; на
канвасе этого не было видно, а Duel вообще не показывал стадию синтеза.

### 1.1 `results/debate-ui.js` — синтез-стадия для всех схем

Заменить `usesSynthesisStage` и `getProtocolSynthesizer`:

```js
  // Every topology (Duel included) runs a mandatory Final Synthesis stage after
  // the last round, so the synthesis flow block is shown for all schemes. The
  // only exception is an open-ended run with an infinite round limit, where the
  // terminal stage cannot be placed on the canvas yet.
  function usesSynthesisStage({ scheme = '2', presetMeta = {}, roundLimit = '' } = {}) {
    const normalizedScheme = String(scheme || '2').trim();
    if (!['2', '3', 'many'].includes(normalizedScheme)) return false;
    const duration = getPresetDuration(presetMeta);
    if (duration !== 'open_ended') return true;
    return String(roundLimit || '').trim() !== 'infinite';
  }

  function getProtocolSynthesizer(protocol = {}) {
    const scheme = String(protocol?.scheme || (protocol?.type === 'multi' ? 'many' : protocol?.type === 'triad' ? '3' : '2')).trim();
    if (scheme === 'many') return String(protocol.multiSynthesizer || '').trim();
    // Duel and Triad runs both read the non-multi synthesizer select
    // (a Duel run falls back to model A at runtime when it is empty).
    if (scheme === '3' || scheme === '2') return String(protocol.triadSynthesizer || '').trim();
    return '';
  }
```

(Было: `usesSynthesisStage` возвращал false для схемы '2'; `getProtocolSynthesizer`
не отдавал синтезатор для схемы '2'.)

### 1.2 `results.js` — Final Synthesis flow виден для Duel

В `syncDebateSchemeUi` (расчёт `usesSynthesisStage`) в фолбэке заменить условие:

```diff
-            : (scheme === '3' || scheme === 'many') && (presetMeta.duration !== 'open_ended' || currentRoundLimit !== 'infinite');
+            : ['2', '3', 'many'].includes(scheme) && (presetMeta.duration !== 'open_ended' || currentRoundLimit !== 'infinite');
```

В `updatePipelineAll` заменить расчёт `hasSynthesisFlow`:

```diff
-            const hasSynthesisFlow = (getDebateScheme() === '3' || getDebateScheme() === 'many')
-                && synthesisStack
-                && synthesisColumn?.hidden !== true;
+            // The synthesis flow block mirrors the mandatory Final Synthesis
+            // stage of the runtime for every topology; visibility is owned by
+            // syncDebateSchemeUi via usesSynthesisStage.
+            const hasSynthesisFlow = !!synthesisStack && synthesisColumn?.hidden !== true;
```

В `renderTriadSynthesisStage` и `syncTriadSynthesizerFlowStage` и
`syncTriadSynthesizerBlocks` — учесть Duel: при схеме '2' пустой синтезатор
показывать как `Model A (auto)` (в рантайме Duel без синтезатора использует
модель A). Заголовки/подписи: `isMulti ? 'Multi' : (isDuel ? 'Duel' : 'Triad')`.
Полные версии — в `results.js` (ищи `isDuel = scheme === '2'`).

### 1.3 `results.js` — чипы filter-pass на раундах

В `getPipelineProtocolConfig` перенести `roundPlan` активного pipeline в
захваченный конфиг (иначе сохранение теряло filter-passes):

```js
            // Carry the active pipeline's round plan into every captured config:
            // the runtime executes one filter pass per planned round, and losing
            // the plan on save would silently drop those passes for the copy.
            const activeName = String(pipelineStore.active || pipelineName?.textContent || '').trim();
            const activeRoundPlan = getPipelineConfigByName(activeName)?.protocol?.roundPlan;
            const roundPlan = Array.isArray(activeRoundPlan)
                ? activeRoundPlan.map((entry) => ({
                    round: Number(entry?.round) || 0,
                    outputs: Array.isArray(entry?.outputs) ? entry.outputs.slice() : []
                }))
                : [];
```
…и в возвращаемом объекте добавить `roundPlan,` рядом с `selectedModels: getSelectedLLMs()`.

Добавить функцию `syncRoundFilterChips` (вызвать её из `updatePipelineAll` перед
`syncPipelineFlowVisualState()`). Она добавляет к подписи раунда чип `⏳ filter`
с tooltip-перечнем артефактов, а к synthesis-стадии — подпись
`Final Words + Synthesis` (Duel/Triad) / `Final Synthesis` (Multi):

```js
        const syncRoundFilterChips = () => {
            if (!pipelinePanel) return;
            const scheme = getDebateScheme();
            const protocol = getPipelineProtocolConfig();
            const roundPlan = Array.isArray(protocol?.roundPlan) ? protocol.roundPlan : [];
            pipelinePanel.querySelectorAll('.stage-column[data-round]').forEach((column) => {
                const round = Number(column.dataset.round || 0);
                const label = column.querySelector('.stage-label');
                if (!label || !round) return;
                let chip = label.querySelector('.round-filter-chip');
                const outputs = roundPlan.find((entry) => Number(entry?.round) === round)?.outputs || [];
                if (!outputs.length) { chip?.remove(); return; }
                if (!chip) {
                    chip = document.createElement('span');
                    chip.className = 'round-filter-chip';
                    label.appendChild(chip);
                }
                chip.textContent = '⏳ filter';
                chip.title = `After R${round} the synthesizer runs a filter pass producing: ${outputs.join(', ')}`;
            });
            const synthesisLabel = synthesisColumn?.querySelector('.stage-label');
            if (synthesisLabel) {
                const badge = synthesisLabel.querySelector('.round-badge');
                const withFinalWords = scheme === '2' || scheme === '3';
                const labelText = withFinalWords ? ' Words + Synthesis' : ' Synthesis';
                const textNode = Array.from(synthesisLabel.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
                if (textNode) { if (textNode.textContent !== labelText) textNode.textContent = labelText; }
                else if (badge) { badge.after(document.createTextNode(labelText)); }
                synthesisLabel.title = withFinalWords
                    ? 'The runtime requests final words from every participant, then the mandatory Final Synthesis.'
                    : 'The runtime runs the mandatory Final Synthesis after the last wave.';
            }
        };
```

### 1.4 `styles/pipeline.css` — стиль чипа

Перед `.pipeline-round-delete-btn {` добавить:

```css
/* Marks the per-round filter pass the runtime executes after the round. */
.round-filter-chip {
    font-size: 8px;
    font-weight: 600;
    text-transform: none;
    letter-spacing: 0;
    color: var(--pipeline-muted);
    border: 1px solid var(--pipeline-border);
    border-radius: 999px;
    padding: 1px 5px;
    line-height: 1.2;
    white-space: nowrap;
    cursor: help;
}
```

---

## 2. Роли участников и протокол-миссии

Проблема: пресеты хранят `roles: ['critical','meta']`, но в prompt уходил
внутренний id (`Role: interaction_critical_audit`), а Verdict и Red Team
читались моделями одинаково.

### 2.1 `disput/debate-prompt-catalog.js` — каталог ролей и миссий

Сразу после `const text = (...)` добавить:

```js
  const PARTICIPANT_ROLES = Object.freeze({
    critical: 'Критик: атакуй самое слабое место каждой позиции, требуй доказательств, вскрывай скрытые допущения и ошибки.',
    meta: 'Синтезатор: строй собственное лучшее решение, забирая из чужих ответов только то, что выдерживает проверку.',
    expert: 'Эксперт: давай точные проверяемые утверждения в своей области и явно помечай границы своей компетенции.',
    provocateur: 'Провокатор: оспаривай очевидное, задавай неудобные вопросы и крайние сценарии, чтобы проверить устойчивость позиций.'
  });

  function resolveParticipantRoleText(value, index = 0) {
    const raw = text(value).toLowerCase();
    if (!raw) return index % 2 === 1 ? PARTICIPANT_ROLES.meta : PARTICIPANT_ROLES.critical;
    if (raw.includes('critical') || raw.includes('crit') || raw.includes('критич')) return PARTICIPANT_ROLES.critical;
    if (raw.includes('meta') || raw.includes('synthes') || raw.includes('синтез')) return PARTICIPANT_ROLES.meta;
    if (!raw.startsWith('interaction_')) return text(value);   // свободный текст роли — как есть
    return index % 2 === 1 ? PARTICIPANT_ROLES.meta : PARTICIPANT_ROLES.critical;
  }

  const PROTOCOL_MISSIONS = Object.freeze({
    verdict: 'Протокол Verdict: сужай спор до проверяемых утверждений; цель — обоснованный финальный вердикт, а не согласие ради согласия.',
    red_team: 'Протокол Red Team: ищи реальные уязвимости, контрпримеры и риски; слабое место, пережившее атаку, ценнее нового аргумента.',
    long: 'Протокол Long: открытая дискуссия без лимита раундов; углубляй тему, фиксируй достигнутый прогресс и не повторяйся.'
  });

  function resolveProtocolMission(preset = {}) {
    const suffix = String(preset?.reasoningBudget?.comparableSuffix || preset?.comparableSuffix || '').toLowerCase();
    if (suffix.includes('red')) return PROTOCOL_MISSIONS.red_team;
    if (suffix.includes('long')) return PROTOCOL_MISSIONS.long;
    if (suffix.includes('verdict')) return PROTOCOL_MISSIONS.verdict;
    const budgetClass = String(preset?.reasoningBudget?.class || '').toLowerCase();
    if (budgetClass === 'medium') return PROTOCOL_MISSIONS.red_team;
    if (budgetClass === 'infinite') return PROTOCOL_MISSIONS.long;
    return PROTOCOL_MISSIONS.verdict;
  }
```

Добавить все четыре имени (`PARTICIPANT_ROLES`, `resolveParticipantRoleText`,
`PROTOCOL_MISSIONS`, `resolveProtocolMission`) в объект `api = Object.freeze({...})`.

### 2.2 `results.js` — использовать текст роли, не id

Добавить хелпер (перед `resolveJudgePromptId`):

```js
        const getDebateParticipantRoleText = (index = 0) => {
            const catalog = window.DebatePromptCatalog;
            if (!catalog?.resolveParticipantRoleText) return '';
            const stack = captureModelStackState('r2-models');
            const storedRole = stack?.items?.[index]?.role || '';
            const prompt = storedRole ? getJudgePromptById(storedRole) : null;
            return catalog.resolveParticipantRoleText(prompt?.label || storedRole, index);
        };
```

Заменить multi `resolveRole`:

```diff
-            resolveRole: (index) => resolveJudgePromptId(index % 2 === 0 ? 'critical' : 'meta', index),
+            resolveRole: (index) => getDebateParticipantRoleText(index),
```

В `resolveSerialDebateScenarioFromFeed` роли A/B брать из канваса, а не оставлять
пустыми (композер-роль имеет приоритет для A):

```js
            const composerRole = String(debateRoleSelect?.value || '').trim();
            const slotIndexOf = (modelName) => {
                const stack = captureModelStackState('r2-models');
                const found = (stack?.items || []).findIndex((item) => item?.name === modelName);
                return found >= 0 ? found : null;
            };
            const indexA = slotIndexOf(initialTargetModel);
            const indexB = slotIndexOf(modelB);
            return {
                ok: true, modelA: initialTargetModel, modelB,
                roleA: composerRole || getDebateParticipantRoleText(indexA == null ? 0 : indexA),
                roleB: getDebateParticipantRoleText(indexB == null ? 1 : indexB),
                initialTarget: 'A'
            };
```

Миссия протокола (`resolveProtocolMission`) пробрасывается в triad-runner как
`getProtocolMission: (preset) => window.DebatePromptCatalog?.resolveProtocolMission?.(preset) || ''`.

### 2.3 Тест `tests/debate-prompt-catalog.test.js`

Добавить проверку, что роли резолвятся в читаемый текст, а не в id:

```js
  test('resolves participant roles to readable text, never to internal ids', () => {
    expect(Catalog.resolveParticipantRoleText('critical')).toBe(Catalog.PARTICIPANT_ROLES.critical);
    expect(Catalog.resolveParticipantRoleText('interaction_critical_audit')).toBe(Catalog.PARTICIPANT_ROLES.critical);
    expect(Catalog.resolveParticipantRoleText('Meta-Синтез')).toBe(Catalog.PARTICIPANT_ROLES.meta);
    expect(Catalog.resolveParticipantRoleText('interaction_select_ideas', 0)).toBe(Catalog.PARTICIPANT_ROLES.critical);
    expect(Catalog.resolveParticipantRoleText('interaction_select_ideas', 1)).toBe(Catalog.PARTICIPANT_ROLES.meta);
    expect(Catalog.resolveParticipantRoleText('Скептик-экономист')).toBe('Скептик-экономист');
  });
```

---

## 3. Компактные prompt-шаблоны Debate

Принцип: убрать «воду», незаполняемые `{placeholder}` и примеры, оставить сжатую
рабочую инструкцию. Ниже — НОВОЕ содержимое (старое было длиннее и многословнее).

### 3.1 `disput/disput-massage.js` — init A/B и ход диспута

- `buildInitAPrompt`: задача хода —
  ```
  # Твой ход — стартовая позиция:
  1. Сформулируй свою позицию по теме одним чётким абзацем.
  2. Приведи 2–4 ключевых аргумента с обоснованием каждого.
  3. Явно укажи допущения и зоны неопределённости.
  4. Задай {opponent} один вопрос, который продвинет обсуждение.

  Начинай дебаты.
  ```
- `buildInitBPrompt`: то же, но заголовок `# Твой ход — стартовая позиция (оппонент её ещё не видит):`
  и БЕЗ пунктов 4 и «Начинай дебаты».
- `buildStandardTurnPrompt`: задача хода —
  ```
  # Твой ход:
  1. Атакуй самое слабое место в аргументах оппонента: логическую уязвимость, подмену понятий или недостающий факт. Цитируй атакуемый фрагмент.
  2. Дай контраргументы от своей позиции, не повторяя уже сказанного тобой.
  3. Укажи, с чем из сказанного оппонентом ты согласен, если такое есть.
  4. Если модератор дал указание — выполни его в первую очередь.
  5. Закончи одним точным вопросом оппоненту. Цель — точное понимание темы, а не победа любой ценой.
  ```
  Также в контекстных строках убраны двойные пробелы (`Тема дебатов с {opponent}: ...`).

Тест `tests/disput-massage.test.js` обновить под новые строки (проверять
`'Тема дебатов с Claude: Pipeline topic'`, `'1. Сформулируй свою позицию...'`,
`'4. Задай Claude один вопрос...'`, для standard turn — `'1. Атакуй самое слабое место...'`).

### 3.2 `disput/pipeline-actions.json` — чипы модератора и финала

Заменить сырые шаблоны с `{placeholder}` на самодостаточные инструкции.
Пример (`final_word_request`):

```json
{
  "id": "final_word_request",
  "label": "Запрос финального слова",
  "type": "suffix",
  "text": "# Финальное слово\nТема дебатов: {pipelineName}\nТвоя роль: {roleX}\n\nПодведи итог, без новых вопросов оппоненту:\n1. Итоговая позиция и что в ней изменилось за время дебатов.\n2. Точки согласия и принципиальные разногласия.\n3. Самый сильный аргумент оппонента и твой ответ на него.\n4. Оставшиеся неопределённости.\n5. Финальный вывод по теме — 2–3 предложения.",
  "order": 120, "groupLabel": "Final"
}
```
Аналогично сжаты `moderator_correction`, `moderator_challenge`,
`moderator_evidence_request`, `moderator_summary` (полные тексты — в файле).

### 3.3 Judge-промпты — в ТРЁХ местах синхронно

Одинаковый компактный текст должен лежать в:
- `prompts.json` → `judgeSystemPrompts[]`
- `results.js` → `DEFAULT_JUDGE_SYSTEM_PROMPTS` (зеркало на случай, если prompts.json не загрузился)
- `Modifiers/modifiers-basic.json` → соответствующие `interaction_*`

Новые тексты (id → text):
- `interaction_meta_synthesis`: «Построй собственное экспертное решение, используя представленные версии как сырьё, а не как источник консенсуса. Возьми из них только идеи, которые усиливают твоё решение; слабые отбрось, даже если они встречаются во всех версиях. Проверяй заимствованное на фактическую точность. Результат — новый цельный ответ, а не пересказ и не компиляция.»
- `interaction_critical_audit`: «Проведи экспертный аудит ответов и покажи то, что все пропустили:\n1. Слепые зоны — важные аспекты и следствия, которые никто не назвал.\n2. Ошибки — фактические неточности, логические противоречия, ложные причинно-следственные связи.\n3. Методология — неподходящие критерии и фреймворки, неучтённые ограничения и риски.\nКаждый пункт: конкретный пример → общий паттерн. Без вступлений, сразу к сути.»
- `interaction_select_ideas`: «Извлеки из материала все уникальные идеи, включая слабые и спорные. Раздроби ответы до атомарных идей (одна идея = один пункт), объедини дубли, но сохрани отдельно варианты с разным подходом, акцентом или контекстом. Выдай нумерованный список, ранжированный по значимости. Начни сразу с пункта 1, без пояснений.»
- `interaction_pattern_clustering`: «Сгруппируй идеи по сути подхода, а не по формальным признакам. Для каждого кластера дай: концептуальное название (жирным), суть подхода одним предложением, список входящих идей. Идеи, не вписавшиеся ни в один кластер, вынеси отдельным блоком. Без преамбулы.»

> Примечание: пользователь дополнительно добавил в `prompts.json`
> `evaluationTemplate` хвост «Answer in the language of the original question.» —
> это его правка, оставить.

---

## 4. Детектор окончания генерации (главная страница)

**Файл:** `content-utils/response-lifecycle-detector.js`. Три правки.

### 4.1 Индикаторы генерации — только видимые элементы

В `detectGeneratingIndicators`, в цикле по `GENERATING_SELECTORS`, заменить
фильтр по rect на полную проверку видимости:

```diff
-          const nodes = Array.from(root.querySelectorAll(selector)).filter((el) => {
-            const rect = el.getBoundingClientRect?.();
-            return !!rect && rect.width > 0 && rect.height > 0;
-          });
+          // Full visibility check (computed style, not just rect): a spinner kept
+          // in the DOM with visibility:hidden/opacity:0 must not read as
+          // "still generating" — that blocked completion until hard timeout.
+          const nodes = Array.from(root.querySelectorAll(selector)).filter((el) => isVisible(el));
           if (nodes.length) indicators.push(selector);
```

### 4.2 Константа и обход «застрявшего» busy-индикатора

Рядом с `const MIN_COMPLETE_CONFIDENCE = 0.75;` добавить:

```js
  const STUCK_BUSY_OVERRIDE_MIN_MS = 6000;
```

В `waitForAnswerComplete`, перед финальной проверкой завершения, добавить:

```js
      const stableForMs = Date.now() - stability.stableSince;
      const stuckBusyOverride = indicators.hasLoadingIndicator
        && !indicators.hasProgressbar
        && indicators.stopButtonSignal === false
        && completionSignals.mutationQuiet
        && stableForMs >= Math.max(4 * stableMs, STUCK_BUSY_OVERRIDE_MIN_MS);
      if (stuckBusyOverride) { completionSignals.stuckBusyOverride = true; }
```

И в условии завершения разрешить обход декоративного loading-класса:

```diff
-        !indicators.hasLoadingIndicator &&
+        (!indicators.hasLoadingIndicator || stuckBusyOverride) &&
```

(Видимый progressbar или stop-кнопка блокируют завершение безусловно.) Добавить
`STUCK_BUSY_OVERRIDE_MIN_MS` в экспортируемый объект.

### 4.3 Сброс чужого кандидата на старте трекинга

В `startResponseLifecycleTracking`, после `stopResponseLifecycleTracking(...)` и
перед `getLatestAnswerSnapshot`, добавить:

```js
    const previouslyRegistered = registeredCandidates.get(modelName);
    if (previouslyRegistered?.traceId && traceId && String(previouslyRegistered.traceId) !== String(traceId)) {
      registeredCandidates.delete(modelName);
    }
```

Тест: новый файл `tests/lifecycle-stuck-busy-override.test.js` — проверяет
(1) скрытый спиннер не считается генерацией; (2) видимый progressbar блокирует
завершение; (3) декоративный loading-класс обходится после долгой стабильности.

---

## 5. Инспектор pipeline — показывать применяемую роль

**Файл:** `results.js`, `buildPipelineInfoRoundsHtml`.

Раньше инспектор показывал полный текст judge-шаблона (который runtime НЕ
отправляет). Теперь показывать реально применяемый текст роли:

```js
                    const appliedRoleText = item.role
                        ? window.DebatePromptCatalog?.resolveParticipantRoleText?.(prompt?.label || item.role, index) || ''
                        : '';
                    const promptText = appliedRoleText
                        ? (isTriadScheme
                            ? `Роль слота (Triad применяет общую роль из mod-role-select ко всем участникам; пер-роли — v2): ${appliedRoleText}`
                            : `Роль в prompt: ${appliedRoleText}`)
                        : 'Initial protocol prompt is generated at runtime.';
```
(где `isTriadScheme = String(config?.protocol?.scheme || '') === '3'`).

Также в `buildPipelineInfoSynthesizerHtml` для схемы '2' показывать секцию
«Final synthesis round» (Duel всегда делает final words + синтез).

---

## 6. Документация

Обновлены нормативные документы (по `docs/disput-docs/D0_documentation-map.md`):
- `docs/disput-docs/D11_debate-round-plans.md` — роли участников, источник длины (roundPlan), чипы.
- `docs/disput-docs/D8_duel-protocol.md` — synthesis-стадия для Duel, правила ролей A/B.
- `docs/disput-docs/D2_disput-architecture.md` — две страницы (comparison / debate) и hand-off.
- `docs/timing-map.md` — §5 константы детектора (`STUCK_BUSY_OVERRIDE_MIN_MS` и др.).
- `docs/model-tabs-architecture.md` — контракт видимости индикаторов, stuck-busy,
  сброс stale-кандидата.
- `docs/disput-docs/CHANGELOG.md` — записи по всем правкам.
- `docs/disput-docs/reports/D19_disput-next-steps.md` — известный баг manual-модерации Triad/Multi.

---

## Итоговая проверка

`npx jest` — 134 suites / 733 теста зелёные. Новые тест-файлы:
`tests/triad-full-run.test.js`, `tests/debate-handoff-routing.test.js`,
`tests/lifecycle-stuck-busy-override.test.js`.
