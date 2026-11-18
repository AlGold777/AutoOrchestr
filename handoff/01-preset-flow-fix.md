> **Исторический документ.** Снимок версии 2.80.200. Режимы Duel, Triad, Multi и FreeTalk из него удалены; актуальное описание — `docs/project-overview.md` и `docs/Pipeline scenarios/basic-start-here.md`.

# Документ 1 — Реальный flow = выбранный предустановленный pipeline

> Версия после внедрения: **2.80.200**. Все правки — в основной папке
> `/Users/restart/Downloads/LLM_Sol-Fable`. Тесты: `npx jest` должен давать
> 134 suites / 733 теста зелёными.

## Что это решает

Пользователь выбирал встроенный pipeline **Triad Red Team** на странице Debate,
но вместо многораундового дебата шла «примитивная схема»: три модели отвечали
по разу, затем Claude писал один общий итог. То есть реальный запуск НЕ
соответствовал выбранному pipeline.

Три независимые причины, все закрыты в этом документе:

- **A. Red Team пресеты запускались в `manual`**, а manual-режим застревает
  после первой волны (approve не продвигает волну). Это и была главная причина.
- **B. Число раундов бралось из скрытого UI-селектора**, а не из канонического
  `roundPlan` пресета — защитная правка, чтобы длина всегда была верной.
- **C. Запуск с главной страницы (сравнение)** игнорировал debate-пресет —
  hand-off, чтобы Triad/Multi запускались как дебат.

Внедрять можно в порядке A → B → C. Пункт A самодостаточен и уже чинит симптом.

---

## A. Red Team пресеты → `runPolicy: 'auto'` (ГЛАВНЫЙ ФИКС)

**Файл:** `disput/pipeline-presets.js`
**Где:** массив `BUILTIN_PIPELINE_DEFINITIONS`.

### A1. Добавить комментарий перед массивом

Найди строку:

```js
  // Complete built-in definitions. The UI supplies only model availability;
  // protocol policy, round plans and reasoning budgets live here.
  const BUILTIN_PIPELINE_DEFINITIONS = Object.freeze([
```

Замени на:

```js
  // Complete built-in definitions. The UI supplies only model availability;
  // protocol policy, round plans and reasoning budgets live here.
  //
  // All fixed presets run `auto`: in `manual` the debate stops after the first
  // wave and cannot advance (the per-wave approval never re-activates the
  // aggregate protocol state), which surfaced to users as "Triad Red Team just
  // sends 3 models to a judge". Running auto executes the full canonical round
  // plan (independent openings → cross-critique waves with a filter pass each →
  // final words → Final Synthesis). Manual moderation is a separate,
  // still-unfinished feature tracked in next-steps.
  const BUILTIN_PIPELINE_DEFINITIONS = Object.freeze([
```

### A2. Поменять `runPolicy: 'manual'` → `'auto'` у трёх Red Team пресетов

В трёх строках заменить только значение `runPolicy`:

```diff
- Object.freeze({ name: 'Duel Red Team',  ... runPolicy: 'manual', ... }),
+ Object.freeze({ name: 'Duel Red Team',  ... runPolicy: 'auto',   ... }),

- Object.freeze({ name: 'Triad Red Team', ... runPolicy: 'manual', ... }),
+ Object.freeze({ name: 'Triad Red Team', ... runPolicy: 'auto',   ... }),

- Object.freeze({ name: 'Multi Red Team', ... runPolicy: 'manual', ... }),
+ Object.freeze({ name: 'Multi Red Team', ... runPolicy: 'auto',   ... }),
```

Больше в этих строках НИЧЕГО не менять (scheme, roundLimit, roundPlan, roles
остаются как были). Verdict-пресеты уже `auto` — их не трогать. Long-пресеты
(`Duel Long`, `Triad Long`) остаются как есть.

### Почему

В `manual` после init-волны агрегатная `protocolState.active` становится
`false`; `routeApprovedTriadTurn` выходит на проверке `!triad.active`, а блок
`finally` в `startDebateFromPage` сбрасывает прогон как завершённый. Поэтому
approve не продвигает волну. В `auto` этой ветки нет — раннер сам проходит все
раунды. Полноценная manual-модерация — отдельная задача (см. `docs/disput-docs/reports/D19_disput-next-steps.md`).

---

## B. Длина fixed-пресета — из `roundPlan`, а не из скрытого селектора

**Файл 1:** `disput/pipeline-presets.js`

### B1. Добавить функцию `resolveRuntimeRoundLimits`

Перед функцией `function normalizePipelinePreset(presetId, userOptions = {}) {`
вставить новую функцию:

```js
  // Canonical runtime round/turn/wave limits for a preset.
  //
  // A fixed preset (Verdict / Red Team) hides the manual round selector: its
  // length is the number of stages in the canonical roundPlan, NOT whatever the
  // hidden UI control happens to hold. Reading the control here is exactly the
  // bug that collapsed Triad/Multi Red Team to the default round count — it must
  // run all of its planned rounds. Open-ended presets (Long) keep taking their
  // length from the live control, including the infinite sentinel.
  //
  // Returns { roundLimit, turnLimit, waveLimit } where:
  //  - roundLimit: number of protocol rounds ('infinite' allowed for open-ended);
  //  - turnLimit: duel public-turn budget = (rounds - 1) * 2 (R1 is the parallel
  //    opening wave, later rounds are full A/B exchanges);
  //  - waveLimit: triad/multi wave budget = rounds.
  function resolveRuntimeRoundLimits(presetOrId, input = {}) {
    const preset = getPipelinePreset(typeof presetOrId === 'string' ? presetOrId : presetOrId?.id);
    const isOpenEnded = preset.duration === 'open_ended';
    const uiRoundLimit = input.uiRoundLimit;
    const planLength = Array.isArray(input.roundPlan) ? input.roundPlan.length : 0;
    const storedLimit = Number(input.storedRoundLimit);
    const canonical = planLength > 0
      ? planLength
      : (Number.isFinite(storedLimit) && storedLimit > 0 ? storedLimit : null);

    const uiIsInfinite = String(uiRoundLimit || '').trim() === 'infinite';
    let roundLimit;
    if (isOpenEnded) {
      roundLimit = uiIsInfinite ? 'infinite' : (normalizeLimit(uiRoundLimit, canonical) || 'infinite');
    } else {
      roundLimit = canonical != null ? canonical : (normalizeLimit(uiRoundLimit, 3) || 3);
    }

    if (roundLimit === 'infinite') {
      return Object.freeze({ roundLimit, turnLimit: null, waveLimit: null });
    }
    const rounds = Number(roundLimit);
    return Object.freeze({
      roundLimit: rounds,
      turnLimit: Math.max(0, (rounds - 1) * 2),
      waveLimit: rounds
    });
  }

```

(`normalizeLimit` и `getPipelinePreset` уже существуют в этом файле выше — новых
зависимостей нет.)

### B2. Экспортировать функцию

Найди объект экспорта `const api = Object.freeze({` и добавь строку
`resolveRuntimeRoundLimits,` рядом с `normalizePipelinePreset,`:

```diff
    DEFAULT_PRESET_ID,
    normalizePipelinePreset,
+   resolveRuntimeRoundLimits,
    getPipelinePreset,
```

**Файл 2:** `results.js`, функция `buildPipelinePresetRuntimeConfig(...)`.

### B3. Использовать резолвер вместо чтения UI-селектора

Внутри `buildPipelinePresetRuntimeConfig`, СРАЗУ ПЕРЕД строкой
`if (!api?.normalizePipelinePreset) {` вставить:

```js
            // Source of truth for round/turn/wave counts. Fixed presets take
            // their length from the canonical roundPlan; only open-ended presets
            // read the live round selector. This is what makes Triad/Multi Red
            // Team actually run all of their planned rounds instead of collapsing
            // to the hidden control's default. (D11_debate-round-plans.md)
            const runtimeLimits = api?.resolveRuntimeRoundLimits
                ? api.resolveRuntimeRoundLimits(presetId, {
                    roundPlan,
                    storedRoundLimit: protocol.roundLimit,
                    uiRoundLimit: getDebateRoundLimit()
                })
                : null;
            const effectiveRoundLimit = runtimeLimits ? runtimeLimits.roundLimit : getDebateRoundLimit();
            const effectiveWaveLimit = runtimeLimits
                ? (runtimeLimits.waveLimit ?? (getDebateScheme() === 'many' ? getMultiWaveLimit() : getTriadWaveLimit()))
                : (getDebateScheme() === 'many' ? getMultiWaveLimit() : getTriadWaveLimit());
            const effectiveTurnLimit = runtimeLimits
                ? (runtimeLimits.turnLimit ?? getDebateMaxTurns())
                : getDebateMaxTurns();
```

Затем в ЭТОЙ же функции заменить, что подставляется в конфиг:

- в ветке-фолбэке (`if (!api?.normalizePipelinePreset)`) в возвращаемом объекте:

```diff
-                    turnLimit: getDebateMaxTurns(),
-                    waveLimit: scheme === 'many' ? getMultiWaveLimit() : getTriadWaveLimit(),
+                    turnLimit: effectiveTurnLimit,
+                    waveLimit: scheme === 'many' ? getMultiWaveLimit() : effectiveWaveLimit,
```

- в основном `return Object.freeze({ ...api.normalizePipelinePreset(presetId, {` в
  блоке `currentUiLimits`:

```diff
                currentUiLimits: {
-                    roundLimit: getDebateRoundLimit(),
-                    turnLimit: getDebateMaxTurns(),
-                    maxTurns: getDebateMaxTurns(),
-                    waveLimit: getDebateScheme() === 'many' ? getMultiWaveLimit() : getTriadWaveLimit(),
-                    maxWaves: getDebateScheme() === 'many' ? getMultiWaveLimit() : getTriadWaveLimit()
+                    roundLimit: effectiveRoundLimit,
+                    turnLimit: effectiveTurnLimit,
+                    maxTurns: effectiveTurnLimit,
+                    waveLimit: effectiveWaveLimit,
+                    maxWaves: effectiveWaveLimit
                }
```

### Почему

Скрытый для fixed-пресетов селектор мог держать устаревшее значение и обрезать
раунды. Теперь длина всегда берётся из канонического `roundPlan.length`
(fallback — сохранённый `roundLimit`); open-ended по-прежнему читает live-контрол.

---

## C. Hand-off с главной страницы на страницу Debate

Проблема: `result_new.html` (главная) показывает pipeline-canvas как превью, но
кнопка Send запускает плоское сравнение `START_FULLPAGE_PROCESS` + судья, не зная
о выбранном debate-пресете. Debate-композер есть только на `pipeline_panel.html`.

Решение: если активна схема Triad(`3`)/Multi(`many`), Send делает hand-off —
кладёт intent (тема + модели + схема) в storage и переходит на debate-страницу,
которая при загрузке потребляет intent и авто-стартует полный дебат.

**Файл 1:** `results/debate-ui.js`

### C1. Добавить предикат `shouldHandOffToDebatePage`

Перед функцией `function getProtocolSynthesizer(protocol = {}) {` вставить:

```js
  // A Triad ('3') or Multi ('many') pipeline is a multi-round debate that a
  // flat main-page comparison cannot express. When such a preset is active on
  // the main page, Send must hand off to the Debate page instead of silently
  // running a comparison. Duel/comparison ('2') keeps the main-page flow, and
  // the Debate page never hands off to itself.
  function shouldHandOffToDebatePage({ scheme = '2', isPipelinePage = false } = {}) {
    if (isPipelinePage) return false;
    const normalized = String(scheme || '2').trim();
    return normalized === '3' || normalized === 'many';
  }
```

И добавить его в экспорт:

```diff
  const api = Object.freeze({
    shouldShowRoundLimitControl,
    usesSynthesisStage,
+   shouldHandOffToDebatePage,
    getProtocolSynthesizer
  });
```

**Файл 2:** `results.js`

### C2. Ключ storage для intent

Рядом с `const crossViewNavigationIntentKey = ...` добавить:

```js
    // Hand-off from the main comparison page to the Debate page: a Triad/Multi
    // preset cannot run as a flat comparison, so the main Send navigates here
    // and the Debate page auto-starts the real debate with the carried topic.
    const debateAutoRunIntentKey = 'llmComparatorDebateAutoRunIntent';
```

### C3. Хелперы hand-off (внешний scope)

Перед `const getPromptDraftText = () => {` вставить блок:

```js
    const bodyIncludesPipelinePage = () => String(document.body.className || '')
        .split(/\s+/).filter(Boolean).includes('pipeline-page');
    // Main page → Debate page hand-off for Triad/Multi presets.
    const handOffDebateRunToPipelinePage = async (topic) => {
        // The auto-run on the Debate page must be self-contained: a page reload
        // does not reliably restore header model selection, so carry the exact
        // models and scheme in the intent instead of depending on restoration.
        let models = [];
        try { models = (typeof getSelectedLLMs === 'function' ? getSelectedLLMs() : []) || []; } catch (_) {}
        const scheme = String(window.__debateSchemeValue || '2').trim();
        try {
            await persistCrossViewUiState();
        } catch (_) {}
        try {
            await safeStorageLocalSet({
                llmComparatorLastPipelineView: 'pipeline',
                [debateAutoRunIntentKey]: {
                    topic: String(topic || '').trim(),
                    models: Array.isArray(models) ? models.slice() : [],
                    scheme,
                    savedAt: Date.now()
                }
            });
        } catch (err) {
            console.warn('[RESULTS] Failed to persist debate auto-run intent', err);
        }
        showNotification('Открываю страницу дебатов и запускаю выбранный pipeline…', 'info');
        window.location.href = 'pipeline_panel.html';
    };
    const consumeDebateAutoRunIntentOnLoad = async () => {
        const stored = await safeStorageLocalGet(debateAutoRunIntentKey);
        const intent = stored[debateAutoRunIntentKey];
        await safeStorageLocalRemove(debateAutoRunIntentKey);
        if (!bodyIncludesPipelinePage() || !intent || typeof intent !== 'object') return null;
        const savedAt = Number(intent.savedAt || 0);
        if (!(savedAt > 0 && Date.now() - savedAt <= crossViewNavigationIntentTtlMs)) return null;
        return {
            topic: String(intent.topic || '').trim(),
            models: Array.isArray(intent.models) ? intent.models.slice() : [],
            scheme: String(intent.scheme || '').trim()
        };
    };
```

(`persistCrossViewUiState`, `safeStorageLocalSet/Get/Remove`, `getSelectedLLMs`,
`showNotification`, `crossViewNavigationIntentTtlMs` уже существуют.)

### C4. Роутинг в обработчике кнопки Send (`start-button`)

В обработчике `startButton?.addEventListener('click', async () => {` СРАЗУ после
блока `if (!(await ensureNoOtherViewRun())) { return; }` вставить:

```js
            // The active pipeline is a Triad/Multi debate preset. A flat
            // comparison cannot express a multi-round debate, so hand off to the
            // Debate page and auto-start the real debate with this prompt as the
            // topic. Duel/comparison (scheme '2') keeps the main-page flow.
            const activeDebateScheme = String(window.__debateSchemeValue || '2').trim();
            const handOffToDebate = window.ResultsDebateUi?.shouldHandOffToDebatePage
                ? window.ResultsDebateUi.shouldHandOffToDebatePage({ scheme: activeDebateScheme, isPipelinePage: bodyIncludesPipelinePage() })
                : (!bodyIncludesPipelinePage() && (activeDebateScheme === '3' || activeDebateScheme === 'many'));
            if (handOffToDebate) {
                await handOffDebateRunToPipelinePage(finalPrompt);
                return;
            }
```

### C5. Хук авто-запуска на debate-странице

В блоке `if (pipelinePanel) { ... }`, рядом со строкой
`window.runPipeline = ...`, добавить:

```js
        // Invoked on the Debate page when the main page handed off a Triad/Multi
        // run. Restores scheme + models, forces auto, pre-seeds the topic and
        // starts the full multi-round debate.
        window.__autoRunDebateWithTopic = (intent = {}) => {
            const payload = (intent && typeof intent === 'object') ? intent : { topic: String(intent || '') };
            const trimmed = String(payload.topic || '').trim();
            if (payload.scheme && window.setDebateSchemeValue) {
                try { window.setDebateSchemeValue(payload.scheme); } catch (_) {}
            }
            if (Array.isArray(payload.models) && payload.models.length) {
                try { setHeaderSelectedLLMsFromNames(payload.models); } catch (_) {}
                try { window.syncPipelineModelsFromSelectedLLMs?.({ force: true }); } catch (_) {}
            }
            // A run handed off from the main comparison page is fire-and-forget:
            // there is no approval surface there, so force AUTO so the whole
            // multi-round debate completes on its own.
            if (debateRunPolicySelect) {
                debateRunPolicySelect.value = 'auto';
                debateRunPolicySelect.dataset.explicitOverride = 'auto';
                try { debateRunPolicySelect.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
            }
            if (trimmed) {
                const session = ensureDebateSession(debateTabsState?.activeSessionId || '1');
                session.disputeTopic = trimmed;
                applyDisputeTopicDisplay(trimmed);
                if (promptInput && !promptInput.value.trim()) promptInput.value = trimmed;
            }
            return window.runPipeline();
        };
```

### C6. Потребление intent при загрузке

В функции `hydrateStartupState`, после блока `restoreCrossViewUiState()` +
delayed restore, добавить:

```js
            // Auto-start a debate handed off from the main page (Triad/Multi Send).
            const autoRunIntent = await consumeDebateAutoRunIntentOnLoad();
            if (autoRunIntent && typeof window.__autoRunDebateWithTopic === 'function') {
                setTimeout(() => {
                    try {
                        window.__autoRunDebateWithTopic(autoRunIntent);
                    } catch (err) {
                        console.warn('[RESULTS] Debate auto-run hand-off failed', err);
                    }
                }, 600);
            }
```

### Почему intent несёт модели

Перезагрузка страницы не восстанавливает выбор моделей в шапке; без переноса
дебат падал на «выберите модели». Поэтому intent несёт `{ topic, models, scheme }`
и на debate-странице заново выбирает модели, форсит auto и подставляет тему.

---

## Тесты (обязательно добавить)

### T1. `tests/pipeline-presets.test.js` — гард на auto + резолвер

Добавить внутрь `describe(...)`:

```js
  test('fixed built-in presets run auto (manual per-wave approval is unfinished and stalls after wave 1)', () => {
    const defs = PipelinePresets.BUILTIN_PIPELINE_DEFINITIONS;
    const byName = (name) => defs.find((d) => d.name === name);
    ['Duel Verdict', 'Duel Red Team', 'Triad Verdict', 'Triad Red Team', 'Multi Verdict', 'Multi Red Team']
      .forEach((name) => {
        expect(byName(name)).toBeTruthy();
        expect(byName(name).runPolicy).toBe('auto');
      });
  });

  describe('resolveRuntimeRoundLimits', () => {
    test('fixed Triad preset takes its round count from the roundPlan, ignoring a stale UI value', () => {
      const redTeamPlan = [['a'], ['b'], ['c'], ['d']];
      const limits = PipelinePresets.resolveRuntimeRoundLimits('TRIAD_STANDARD', {
        roundPlan: redTeamPlan, storedRoundLimit: '4', uiRoundLimit: 3
      });
      expect(limits.roundLimit).toBe(4);
      expect(limits.waveLimit).toBe(4);
    });
    test('fixed Duel preset derives the public-turn budget from the plan length', () => {
      const limits = PipelinePresets.resolveRuntimeRoundLimits('DUEL_STANDARD', {
        roundPlan: [['a'], ['b'], ['c']], storedRoundLimit: '3', uiRoundLimit: 1
      });
      expect(limits.roundLimit).toBe(3);
      expect(limits.turnLimit).toBe(4);
    });
    test('empty roundPlan falls back to the stored preset round limit', () => {
      const limits = PipelinePresets.resolveRuntimeRoundLimits('MULTI_STANDARD', {
        roundPlan: [], storedRoundLimit: '4', uiRoundLimit: 2
      });
      expect(limits.waveLimit).toBe(4);
    });
    test('open-ended preset keeps reading the live control, including infinite', () => {
      const infinite = PipelinePresets.resolveRuntimeRoundLimits('DUEL_LONG', {
        roundPlan: [], storedRoundLimit: 'infinite', uiRoundLimit: 'infinite'
      });
      expect(infinite.roundLimit).toBe('infinite');
      expect(infinite.turnLimit).toBeNull();
      const finiteOverride = PipelinePresets.resolveRuntimeRoundLimits('DUEL_LONG', {
        roundPlan: [], storedRoundLimit: '', uiRoundLimit: 5
      });
      expect(finiteOverride.roundLimit).toBe(5);
    });
  });
```

### T2. `tests/debate-handoff-routing.test.js` — предикат hand-off (новый файл)

```js
const DebateUi = require('../results/debate-ui');

describe('shouldHandOffToDebatePage', () => {
  test('Triad and Multi on the main page hand off to the Debate page', () => {
    expect(DebateUi.shouldHandOffToDebatePage({ scheme: '3', isPipelinePage: false })).toBe(true);
    expect(DebateUi.shouldHandOffToDebatePage({ scheme: 'many', isPipelinePage: false })).toBe(true);
  });
  test('Duel/comparison (scheme 2) keeps the main-page flow', () => {
    expect(DebateUi.shouldHandOffToDebatePage({ scheme: '2', isPipelinePage: false })).toBe(false);
  });
  test('the Debate page never hands off to itself', () => {
    expect(DebateUi.shouldHandOffToDebatePage({ scheme: '3', isPipelinePage: true })).toBe(false);
    expect(DebateUi.shouldHandOffToDebatePage({ scheme: 'many', isPipelinePage: true })).toBe(false);
  });
  test('defaults are safe (no scheme → no hand-off)', () => {
    expect(DebateUi.shouldHandOffToDebatePage({})).toBe(false);
  });
});
```

### T3. `tests/triad-full-run.test.js` — интеграционный прогон (новый файл)

Драйвит реальные `TriadFSM` + протокол + шаблоны через полный auto-прогон с
мок-`runModelBatch`, считая волны по `context.pipelineStageId`. Утверждает, что
Triad Red Team (waveLimit 4) диспатчит **init + 3 критических волны** (4 записи
со stage вида `rN:wave`) и ровно один `final:synthesis`, а не «одну волну и
судью». Полный текст файла — в репозитории (`tests/triad-full-run.test.js`);
ключевые проверки:

```js
test('Triad Red Team (4 rounds) dispatches init + 3 critique waves + 1 synthesis', async () => {
  const { waveDispatches, synthesisDispatches } = await runWithWaveLimit(4);
  expect(waveDispatches).toHaveLength(4);
  expect(synthesisDispatches).toBe(1);
});
```

---

## Проверка внедрения

1. `npx jest` — всё зелёное (134 suites / 733 теста).
2. Node-проверка цепочки без браузера:
   ```bash
   node -e '
   const P = require("./disput/pipeline-presets.js");
   const d = P.BUILTIN_PIPELINE_DEFINITIONS.find(x=>x.name==="Triad Red Team");
   const l = P.resolveRuntimeRoundLimits("TRIAD_STANDARD",{roundPlan:d.roundPlan,storedRoundLimit:d.roundLimit});
   console.log(d.runPolicy, l.waveLimit); // ожидается: auto 4
   '
   ```
3. В расширении (после Reload, версия 2.80.200): страница Debate → выбрать
   Triad Red Team → переключатель политики стоит на **Auto** → запуск проходит
   4 раунда: независимые старты → 3 волны cross-critique (после каждой — filter)
   → финальные слова → Final Synthesis.

## Поднять версию

В `manifest.json`, `package.json`, `package-lock.json` (первые две записи
`"version"`) выставить `2.80.200`.
