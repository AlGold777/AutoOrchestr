# LLM Codex-Codex

LLM Codex-Codex is a Chrome MV3 extension for running one prompt across multiple LLM web interfaces and optional API fallbacks, collecting answers, tracking generation lifecycle, and supporting comparison, evaluation, and debate workflows.

The project is optimized for unstable provider UIs. Its core design assumes selectors break, tabs become stale, service workers cold-start, responses stream unpredictably, and providers may block or rate-limit automation.

## Status

- Current version: `2.81.487`, synchronized in `manifest.json`, `package.json`
  and the root package entry in `package-lock.json`
- Extension type: Chrome Manifest V3
- Package name: `llm-selector-manager`
- Stability: internal / advanced local use
- Test status: `281` suites / `2,177` tests passed on 2026-09-17; run
  `npm test -- --runInBand` for the live count
- Primary risk: external LLM web UI and selector drift

The current documentation set is intentionally compact: this overview covers
product behavior, `model-tabs-architecture.md` covers tab/dispatch ownership,
`completion-protocol-v2.md` covers completion authority, `telemetry.md` covers
diagnostics, and `timings-settings.md` owns current runtime timing values.

## What It Does

- Dispatches a user prompt to selected LLM targets.
- Automates provider web UIs through content scripts.
- Uses API fallback paths where configured.
- Watches response lifecycle and streaming completion.
- Extracts, cleans, and stores model answers.
- Tracks per-model run state and terminal outcomes.
- Supports evaluation and Disput/debate pipelines.
- Provides a left sidebar for Notes and saved Sessions.
- Records telemetry and diagnostics for failure analysis.
- Maintains selector profiles, fallback discovery, and signed remote selector updates.
- Disput has three fixed topologies — Duel, Triad and Multi — plus the
  trigger-driven FreeTalk. Runtime ownership is implemented in `disput/` and
  covered by the Disput tests; the former prose contract set was removed from
  `/docs` when it became stale.
- Disput also includes pipeline profiles, a persistent state case/map and the
  trigger-driven `FreeTalk MVP`. FreeTalk accepts one or more selected models,
  has no fixed round/model ceiling, reserves finalization budget and chooses
  work from open claims, blockers, evidence gaps and dissent. Its contract is
  the runtime contracts in `disput/` and `results.js`.
- All Debate topologies share typed task/stage/action contracts, bounded
  provenance-aware context and prompt pack `3.0.0`; accepted semantic changes
  reach the map only through an anchored StateDelta. The prompt contract is in
  the runtime contracts in `disput/` and `results.js`.
- FreeTalk rules are profile-driven; the same rules run in shadow mode after
  fixed-topology checkpoints. Typed moderator forks, progress windows,
  cross-run rule history and the map History page are specified in
  the runtime contracts in `disput/` and `results.js`.
- Built-in presets and their current plan are defined by the executable
  pipeline profiles and their tests.
- Saved Pipelines store runnable protocol settings, including topology, models, run policy, limits, synthesizer and round plan.
- Release-by-release project history is intentionally kept only in [CHANGELOG.md](CHANGELOG.md).

## Saved Sessions

The left sidebar has two modes: Notes and Sessions.

Sessions let you save the current work on the results page so you can return to it later. A saved Session can include:

- the provider tabs that belong to that session;
- the request text from the prompt field;
- the text and formatting inside response cards;
- the Favourite card;
- user-applied color highlights inside response text.

The first item in the Sessions list is always `Current session`. It is the work currently open on the page. When you click a saved Session, the app returns to the main results page if you were in Debate, the visible response cards switch to that saved content, and the prompt field shows the saved tabs first, then the saved request text below them. Imported model answers are shown directly in the response area even if the page was previously showing the compact live preview. When you click `Current session`, the page returns to the content you were working on before switching.

Use `Save` in Sessions mode to save the current card state. Use export/import as a backup or to move saved Sessions to another computer.

The buttons at the bottom of the left sidebar work against one dedicated folder, `Downloads/Saved sessions`:

- the download icon exports notes and saved Sessions straight into that folder — no Save As dialog, the app only asks for the file name, and a name clash gets a numeric suffix instead of overwriting;
- `↓` imports a backup **replacing** the current notes and Session set;
- `+` imports saved Sessions **without replacing** anything — they are appended to the current set, and colliding ids are reassigned;
- `txt` exports the answers of every saved Session into one text file, `Saved sessions <stamp>.txt`.

The TXT file groups answers by Session: a line with the Session name, then that Session's prompt, Favourite and model answers indented under it. `Current session` is not included — use the `txt` button on the main page for the work currently open. Saved answers carry no time/URL metadata line, because that metadata describes a live run and is not part of a stored Session.

Both imports open the browser's standard file window inside `Downloads/Saved sessions` — the same dialog any download or upload uses, no in-app file list. The first press after installing opens `Downloads`, where `Saved sessions` sits one folder down; once a backup has been picked there, Chrome remembers that folder for this dialog and every later press opens straight inside it. No extra permission is needed.

## Attachments Behavior

When you send a prompt with an attached file, the app tries to attach the file to each provider page automatically. Since 2.80.133 the behavior on failure is designed to leave you in a recoverable state instead of a dead end:

- If the file cannot be attached automatically, the model card shows an "action required" status — but the prompt text is still placed into the provider's input box (currently wired for Grok). To finish, just attach the file manually on that page and press send.
- A model card only turns green when the app actually holds the answer text. If a status says "success" but no answer was captured anywhere, the card shows an honest "uncertain" state instead of a false green.
- After starting a run on the main page, or after selecting at least one model, the prompt and its input section use normal page flow at 5px below the header. The Pipeline composer uses the same 5px raised-state inset whenever Pro is open, a model is selected, or a run is started; this state is also restored when the saved Pro panel is reopened on page load. This is handled by CSS flow rather than a compensating scroll operation, so model clicks do not move the sticky header or change the page scroll position. The sticky header keeps the same 12px top inset as its initial layout position, preventing a jump when scrolling upward, and paints that inset as a cover so scrolled prompt content cannot show through. Root pull-down overscroll is disabled, so the prompt cannot be dragged downward away from the header, while normal page scrolling still moves it upward together with the rest of the content.
- In the horizontal response-card layout, each model card and its response area have a minimum height of 300px.
- On the Pipeline page, the same composer lift is applied when opening Pro or pressing the Pipeline start button.
- An answer that arrived while the prompt was never actually sent (for example, an old answer left on the page from a previous conversation) is no longer accepted as a result.
- If the provider page keeps showing a "busy" spinner after the answer has visibly finished (a known stuck-indicator glitch), the app verifies the text has stopped changing across several checks and then marks the answer green instead of leaving it orange as "partial".

## Status Double-Click: Pull The Full Answer

If a model card shows an orange "partial" state while the provider page clearly has the full answer, double-click the model's status indicator:

- Each double-click reads the provider page again with a different extraction strategy (latest visible block, longest block, prose block, and so on), instead of re-reading the same spot every time.
- If a longer answer is found, the card text is updated and the status is upgraded from orange "partial" to green "success".
- Manual retries use a separate bounded path and can replace a stale answer even
  when the correct answer is shorter. Automatic collection never shrinks a
  terminal answer on its own.

The results page protects against stale provider replies, premature finalization, and incomplete streaming answers. Manual status retry can replace a stale or partial answer; long-generation timing and multi-model verification are governed by runtime policy. Detailed historical entries belong only in `docs/CHANGELOG.md`.

## Supported Models And Targets

| Target | Web UI | API fallback | Status | Notes |
|---|---:|---:|---|---|
| ChatGPT | yes | OpenAI API | stable | `chatgpt.com`, `chat.openai.com` |
| Gemini | yes | Google API | fragile | `gemini.google.com`, legacy `bard.google.com` |
| Claude | yes | Anthropic API | stable | `claude.ai` |
| Grok | yes | xAI API | fragile | `grok.com`, `grok.x.ai`, `x.com`, `x.ai` |
| Z.ai | yes | no | experimental | `chat.z.ai` |
| Qwen | yes | DashScope API | fragile | `chat.qwen.ai` |
| DeepSeek | yes | DeepSeek API | stable / fragile | `chat.deepseek.com` |
| Le Chat | yes | Mistral API | experimental | `chat.mistral.ai` |
| Perplexity | yes | Perplexity API | stable | `perplexity.ai`, `www.perplexity.ai` |
| Kimi | yes | no | experimental | `kimi.ai`, `www.kimi.ai`; answer selectors unverified (login wall) |

## Installation

### Local Development Install

1. Install dependencies:

```bash
npm install
```

2. Open Chrome extensions:

```text
chrome://extensions
```

3. Enable Developer Mode.
4. Choose "Load unpacked".
5. Select the project root directory.
6. Open the extension action or the result/pipeline panel.

### Required Accounts

For web UI automation, the browser profile must already be logged in to the provider pages that will be used. Login, CAPTCHA, Cloudflare, paywalls, onboarding screens, and consent screens can block dispatch.

### Optional API Keys

API fallback support depends on configured keys for the relevant provider. API key storage and retrieval are handled through `utils/api-key-storage.js`. Raw API keys must not be logged, exported in telemetry, or stored in plain text outside the approved storage helper.

## Running And Testing

The canonical timing ownership map and complete current values are maintained
in [`timings-settings.md`](timings-settings.md). Any runtime timing change must
update that document and keep `tests/timing-ladder.test.js` green where the
profile ladder is affected.

```bash
npm test -- --runInBand
npm run test:telemetry
npm run test:qwen
npm run auth:models
npm run build:bundles
npm run scroll:stress
```

| Script | Purpose |
|---|---|
| `npm test -- --runInBand` | Full Jest suite with serialized execution |
| `npm run test:telemetry` | DevTools / telemetry diagnostic check |
| `npm run test:qwen` | Provider-specific Qwen Playwright check |
| `npm run auth:models` | Manual real-page login/composer readiness smoke |
| `npm run build:bundles` | Builds adapter bundles into `dist/` |
| `npm run scroll:stress` | Scroll coordinator stress validation |

## Project Map

```text
background/          MV3 service worker orchestration
content-scripts/     Site-specific automation, injection, extraction
content-utils/       Selector resolution and lifecycle helpers
shared/              Cross-context contracts and pure logic
results/             Extracted results-page helper modules (boot/dom/attachments/tooltips)
styles/              Modular CSS loaded via the styles.css @import loader
selectors/           Static selector profiles per provider
dist/                Built adapter bundles
pipeline/            Pipeline flow/runtime helpers
disput/              Debate protocol FSMs, presets, prompts, registry, run store and projections
Modifiers/           Prompt modifier presets
system_templates/    System prompt templates
notes/               Notes/sidebar storage layer
tests/               Jest and Playwright-oriented tests
scripts/             Maintenance, signing, and diagnostics
artifacts/           Generated reports
config/              Timing and runtime configuration
utils/               Storage, retry, sanitization, mutex, cleanup helpers
```

## Architecture Overview

### Runtime Contexts

The extension has three main runtime contexts:

| Context | Files | Responsibility |
|---|---|---|
| Background service worker | `background/index.js`, `background/*` | Run orchestration, tab ownership, dispatch, retry, health, storage, telemetry, API fallback |
| Content scripts | `content-scripts/*`, `content-utils/*`, `selector-manager.js` | Provider DOM automation, selector lookup, prompt injection, answer extraction |
| UI / results panel | `result_new.html`, `results.js`, `styles.css`, `pipeline/*` | User controls, run status, answers, debate/evaluation controls |

### Data Flow

```text
User prompt
  -> results UI
  -> background/message-router.js
  -> background/job-orchestrator.js
  -> background/tab-manager.js
  -> background/dispatch-coordinator.js
  -> provider content script
  -> LLM web UI or API fallback
  -> answer watcher / lifecycle detector
  -> background state manager
  -> results UI
  -> optional evaluation / debate pipeline
```

### Main State Machines

- `shared/pipeline-fsm.js`: high-level pipeline state.
- `background/dispatch-state-machine.js`: dispatch progression and retry boundaries.
- `shared/model-run-state.js`: per-model state contract.
- `shared/finalization-controller.js`: completion and finality checks.
- `shared/recovery-intent.js`: recovery classification and retry intent.
- `shared/debate-schema.js`: log-only validation for serial Debate runtime state.
- `disput/debate-runtime.js` (`DebateFSM`): explicit serial-debate state machine — state shape, A0/B0 opening-phase gate, A/B routing, run-status lifecycle, and turn progression. `results.js` routes its debate runtime through it.

Terminal states must be treated as final unless a new run/session explicitly supersedes them.

## Core Modules

### Background Layer

| File | Responsibility |
|---|---|
| `background/job-orchestrator.js` | Full run lifecycle, persistence, completion, stop/cancel handling |
| `background/message-router.js` | Chrome runtime message boundary |
| `background/tab-manager.js` | Target tabs, tab ownership, session scoping |
| `background/dispatch-coordinator.js` | Prompt dispatch to selected models |
| `background/dispatch-retry.js` | Retry strategy and circuit breaker behavior |
| `background/state-manager.js` | Per-model state updates and guards |
| `background/health-monitor.js` | Stuck run and terminal-state monitoring |
| `background/rate-limit.js` | Provider throttling and alarms |
| `background/api-fallback.js` | API fallback execution |
| `background/remote-selectors.js` | Signed selector update handling |
| `background/evaluation-manager.js` | Evaluation runs in foreground provider tabs |
| `background/telemetry-logs.js` | Telemetry recording and export support |

### Content Layer

| File | Responsibility |
|---|---|
| `content-scripts/content-chatgpt.js` | ChatGPT adapter |
| `content-scripts/content-claude.js` | Claude adapter |
| `content-scripts/content-gemini.js` | Gemini adapter |
| `content-scripts/content-grok.js` | Grok adapter |
| `content-scripts/content-qwen.js` | Qwen adapter |
| `content-scripts/content-deepseek.js` | DeepSeek adapter |
| `content-scripts/content-perplexity.js` | Perplexity adapter |
| `content-scripts/content-zai.js` | Z.ai adapter |
| `content-scripts/content-kimi.js` | Kimi adapter |
| `content-scripts/content-lechat.js` | Le Chat adapter |
| `content-scripts/unified-answer-watcher.js` | Shared response extraction watcher |
| `content-scripts/unified-answer-pipeline.js` | Shared answer lifecycle pipeline |
| `selector-manager.js` | Selector lookup and fallback coordination |
| `content-scripts/semantic-finder.js` | DOM fallback discovery |
| `content-utils/selector-resolver-v2.js` | Selector profile resolution |
| `content-utils/response-lifecycle-detector.js` | Streaming and finality detection |

### Shared Contracts

The `shared/` directory contains cross-context contracts. Changes here affect background logic, content scripts, tests, and UI behavior. Any change in `shared/` should include targeted tests for state transitions, terminal guards, serialization, and backward compatibility.

## Selector Policy

Selector sources, overrides, health checks, signing and provider-specific
failure modes are maintained in `selectors/`, `selector-manager.js` and their
tests. The main-page tab contract is in
[model-tabs-architecture.md](model-tabs-architecture.md); this overview only
points to the canonical entry points:

- `selectors/*.config.js` — canonical provider configuration;
- `selectors-override.json` — local runtime overrides.

Treat selector changes as production changes: update focused tests, preserve a
fallback where possible, and run the affected provider smoke test.

## Run Lifecycle

Common state progression:

```text
IDLE
READY
DISPATCHING
GENERATING
RECEIVING
COMPLETED
FAILED
TIMEOUT
CANCELLED
```

Terminal states include `COMPLETED`, `FAILED`, `TIMEOUT`, and `CANCELLED`. After a model reaches a terminal state, stale content-script messages must not move it back to a non-terminal state. Session IDs and ownership guards exist to prevent stale tabs from corrupting active runs.

## Generation Wait Profiles (Standard / Long)

How long the extension waits for a model to finish generating is governed by
`content-scripts/pipeline-config.js` (`window.AnswerPipelineConfig`) — the single
hub read per run by `UnifiedAnswerPipeline` and the answer watcher.

Two profiles are available:

- **Standard** (**default**): the former Long behavior — passive generation wait
  up to 450s and automatic foreground/focus activity only during the first 60s.
- **Long**: passive generation wait up to 900s and automatic foreground/focus
  activity only during the first 90s. After that, passive extraction continues
  without taking focus from the user.

Switching:

- A **Long** toggle sits in the main page prompt footer (`#long-mode-checkbox`,
  left of New pages), **default OFF**. Off means Standard; on means Long.
- `results.js` writes the boolean to `chrome.storage.local.longGenerationMode`.
- Each model tab's `pipeline-config.js` reads that flag on load and on
  `storage.onChanged`, calling `AnswerPipelineTiming.applyTimingProfile('standard'|'long')`
  before the per-run pipeline/watcher is constructed.
- **Debate always forces Long** regardless of the toggle: `runModelBatch` (the
  serial-debate dispatcher) sets the flag before each turn, since per-turn
  completeness matters most there.

Tune the Long values in the `LONG_OVERRIDES` block of `pipeline-config.js`.
The legacy input value `short` remains accepted as an alias of Standard.
The toggle is main-page only; the main page resets it to OFF (Standard) on load.

## Storage And Data

### Chrome Storage

Chrome storage may contain:

- job state;
- tab map;
- selector cache;
- telemetry metadata;
- compressed large payload references;
- notes metadata and chunks;
- saved Sessions metadata;
- model run state.

### Local Storage

Page local storage may contain lightweight, page-scoped metadata:

- selector hints;
- last known response container;
- debug flags;
- ephemeral session metadata.

It must not contain raw API keys, unnecessary full prompts, unnecessary full answers, or sensitive user data unless explicitly required and documented.

## Security And Permissions

### Chrome Permissions

| Permission | Reason |
|---|---|
| `storage` | Persist run state, settings, selectors, telemetry metadata |
| `tabs` | Open, reuse, focus, and validate provider tabs |
| `scripting` | Inject automation and bridge scripts |
| `activeTab` | Work with currently active provider/result tabs |
| `alarms` | Rate-limit and lifecycle timers |
| `clipboardRead`, `clipboardWrite` | Support provider text/attachment clipboard integration where enabled |
| `downloads` | Materialize Gemini attachments as temporary local files before assigning them to the page file input |

### Host Permissions

Provider web UI permissions are required for content scripts. API endpoint permissions are required for fallback execution. Host permissions should be kept aligned with supported targets and reviewed before public release.

### Sanitization

Sanitization uses `utils/sanitize.js` and `lib/purify.min.js`. Any UI path that renders provider output, user notes, markdown, or imported HTML must preserve sanitization.

## Telemetry And Diagnostics

Telemetry should explain what happened without leaking unnecessary user data. Useful telemetry includes:

- run/session identifiers;
- model state transitions;
- selector resolution path;
- dispatch attempts and retry reason;
- terminal outcome;
- timing data;
- failure classifications.

Telemetry must avoid raw API keys, credentials, cookies, private account data, and unnecessary full prompt/answer content.

Answer-bearing state telemetry stores only safe evidence summaries (length,
hash, source, eligibility flags), never full answer text or HTML. Run Summary
also reports non-terminal observation state, including partial text still being
generated and tab closure during generation. For Qwen, lifecycle telemetry
records whether the selected snapshot belongs to a visible reasoning or answer
surface; a reasoning-only completion emits
`LIFECYCLE_COMPLETION_PHASE_SUSPECT`.

Disput trace follows the same content-minimization rule. Canonical trace events
store structural identifiers, state/status transitions, timing, lengths,
hashes and bounded diagnostic reasons; prompts, answers, HTML, semantic
artifact prose, StateMap/context snapshots and attachment bodies are redacted
at ingress. Derived report sections reference canonical event IDs rather than
embedding event copies. Restored legacy traces are sanitized before they can be
rendered or exported.

Telemetry exposes exactly two filters: Platform and Tasks. It has no
`Only problems` mode. A selected Task exports an incident-scoped,
proof-preserving projection from the single canonical ledger; All tasks exports
the shared ledger plus all diagnostic projections without parallel recording.
Disput may use its own problem-context filtering independently.

## Debate / Disput Pipeline

The Disput pipeline is implemented through:

- `disput/debate-runtime.js` (`DebateFSM`) — the explicit state machine for a debate run: immutable participant slots, A0/B0 opening-phase gate, separate opening/public turn counters, event log, A/B routing, run-status lifecycle, and turn progression. Pure and unit-tested (`tests/debate-runtime.test.js`).
- `disput/triad-registry.js` / `disput/debate-registry.js` — shared registry core for Debate state: raw event log, open issues, claims, term mismatches, pending actions, violations, derived operational logs, and compact prompt serialization.
- `results.js` (`serialDebateState`) — the UI controller/orchestration for a debate run (DOM, dispatch via `runModelBatch`, cancel, pause, approval UI); routes all state transitions through `DebateFSM`.
- `disput/disput-massage.js` — message/prompt templates for A, B, and public turns.
- `disput/debate-engine.js` — transcript persistence/export + template delegate utility (NOT a parallel runtime).
- `disput/debate-run-store.js` / `disput/debate-projections.js` — canonical run aggregate, event stream and read projections.
- `results/debate-transport.js`, `results/debate-controller.js`, `results/debate-renderer.js`, `results/debate-sessions-store.js`, `results/debate-export.js` — focused UI/transport adapters.
- `disput/pipeline-actions.json` — moderator intervention templates.

User-facing Debate has two related controls. Saved pipelines choose the
scenario and selected models, including flexible `Multi Verdict` (`many`), where
the app selects all available models first and then lets the user turn
individual models off without collapsing the selection to two or three. The
active pipeline item chooses the runtime shape for the next run through
`protocol.presetId`: fixed-length `Duel`, `Triad`, or `Multi`, and open-ended
`Duel Long` / `Triad Long`.

The state map appears as a collapsible block below saved pipelines. `Structure`
is the prioritized case register; `Graf` visualizes actual artifact relations.
The block remains available for partial, failed, budget-limited and manually
stopped cases. Profiles can be validated, copied, saved, imported and exported
from the Disput page.
Only `Duel Long` and `Triad Long` show the round selector. Fixed `Duel`,
`Triad`, and `Multi` presets hide it and use their saved round plans instead.
`Multi Long — later` is visible as a disabled future option.

> Consolidation note: the former shadow background executor was removed. Debate
> semantics stay in page protocol FSMs; background owns delivery/control state
> through `PipelineRunState`, `PipelineFSM` and `PipelineMessageHandlers`.
> The executable ownership is in `results.js`, `background/` and `disput/`.

This layer coordinates debate-style execution over collected model outputs. It depends on stable run completion, answer availability, and UI controls in `results.js`. Changes to this layer should include behavioural tests for start, cancel/pause lifecycle, approval routing, immutable participants, public-turn accounting, the opening A0/B0 phase gate, duplicate-card prevention, registry feedback, and malformed (error-string) answer handling.

For non-developers: the Debate page now remembers more about the structure of a debate. It does not just pass the last answer to the next model. It can keep a small, checked list of unresolved questions, unsupported claims, repeated weak spots, and focus suggestions. The models only see compact summaries, so the debate stays directed without flooding every prompt with the full history.

Preset naming rule: built-in presets with the same suffix should be comparable.
`Verdict` means a standard quick-to-final-answer budget across Duel, Triad, and
Multi. `Long` means user-controlled/open-ended depth. This prevents a topology
from looking better just because it silently received more critique rounds.

## Development Workflow

### Before Changing Code

```bash
npm test -- --runInBand
```

### After Changing Selectors

```bash
npm test -- selector
npm run test:qwen
```

Also perform a manual smoke test against the affected provider when possible.

### After Changing Background Orchestration

Run targeted tests around:

- dispatch;
- state;
- lifecycle;
- terminal guards;
- recovery;
- tab ownership;
- rate limits.

Example:

```bash
npm test -- dispatch state lifecycle terminal recovery tab
```

### After Changing UI

Verify:

- extension action opens the panel after MV3 cold start;
- existing result tab is reused;
- run controls are clickable;
- copy buttons work;
- debate controls work;
- the Long toggle defaults OFF and, when on, long answers wait to finish;
- modular CSS (`styles/*.css` via the `styles.css` loader) renders correctly;
- long model names and statuses do not break layout;
- failed model states are visible and understandable.

## Release Checklist

- Version bumped in `package.json`.
- Version bumped in `manifest.json`.
- `npm test -- --runInBand` passes.
- No temporary test files.
- No raw telemetry dumps.
- No debug-only console spam in release paths.
- No accidental secrets or API keys.
- Remote selectors signed if changed.
- Manual smoke test across key providers.
- Extension loads cleanly in `chrome://extensions`.
- Background service worker has no startup errors.
- Result/pipeline panel opens from the extension action.

## Known Failure Modes

- Provider UI changed.
- User is not logged in.
- CAPTCHA, Cloudflare, paywall, onboarding, or consent screen appears.
- Provider rate limit.
- Browser discards or reloads a tab.
- MV3 service worker cold-start timing.
- Response never reaches terminal state.
- Response reaches terminal state too early.
- Copy button disappears.
- Streaming detector stops too early.
- API fallback key missing, expired, or invalid.
- Storage quota exceeded.
- Stale tab sends messages from an old session.
- Provider changes markdown/code rendering.
- **Watch — Qwen duplicate attach (latent):** Qwen uses `strategies: ['drop','input']` in `content-scripts/attachment-handler.js` and does not yet set `confirmOptional`. If its `confirmSelectors` ever stop matching the attached-file DOM, `waitForUploadConfirmation` will false-negative and the cascade can re-attach the same file (drop + input) — the "file already added" symptom fixed for GPT in 2.80.85. Not observed for Qwen so far. Fix if it appears: set `confirmOptional: true` on the Qwen config.

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| Model stuck on generating | Lifecycle detector did not reach terminal | Check content logs and response detector |
| Prompt not sent | Composer or send selector changed | Update provider selector profile |
| Prompt not inserted | Composer rejected or lost the prepared prompt before send | Inspect insertion outcome and composer context in telemetry |
| Empty answer | Extraction selector changed | Run watcher and provider extraction tests |
| Panel does not open | Service worker startup error | Inspect background service worker logs |
| Qwen/Grok fails | Provider UI changed | Run provider-specific test and update selectors |
| API fallback fails | Missing or invalid key | Check API key storage and provider response |
| Results disappear | Storage compression or quota issue | Check storage budget tests and telemetry |
| Tab focus jumps unexpectedly | Stale focus request or tab ownership bug | Check session ID and tab-manager logs |

## Testing Matrix

| Area | Tests |
|---|---|
| FSM | `tests/pipeline-fsm.test.js` |
| Selectors | `tests/selector-resolver-v2.spec.js`, `tests/selector-manager.spec.js` |
| Terminal guards | `tests/state-manager-terminal-guard.test.js`, `tests/early-terminal-guard.test.js` |
| Recovery | `tests/recovery-intent.test.js`, `tests/materialize-recovery-finality.test.js` |
| Debate / Disput | `tests/debate-engine.test.js`, `tests/results-debate-favorites.test.js` (cancel, phase gate, dedup, status lock) |
| Results helper modules | `tests/boot-utils.test.js`, `tests/dom-utils.test.js`, `tests/attachments.test.js` |
| Telemetry | `tests/telemetry-export.test.js`, `tests/model-run-telemetry.test.js` |
| Provider extraction | `tests/qwen-extraction.test.js`, `tests/grok-dom-fallback.test.js` |
| Storage | `tests/storage-budgets.test.js` |
| Tabs | `tests/tab-manager-session-scope.test.js`, `tests/tab-open-metrics.test.js` |
| Transport | `tests/transport-policy.test.js` |
| Health | `tests/health-monitor-terminal-state.test.js` |

## Conventions

- Keep MV3 service worker compatibility in mind.
- Keep provider-specific DOM logic in provider adapters.
- Keep orchestration logic out of content scripts.
- Keep shared contracts side-effect-light where possible.
- Add tests for lifecycle, terminal state, selector, storage, and recovery changes.
- Do not expand `results.js` or `job-orchestrator.js` without considering extraction.
- Prefer explicit state transitions over implicit flags.
- Prefer structured failure reasons over string-only errors.
- Treat stale sessions as expected behavior, not exceptional behavior.

## Roadmap

Deferred work is tracked in code comments, focused tests and current changelog
entries; no separate stale backlog document is maintained.

## License / Internal Use

This project is currently marked `private` in `package.json`. Define license, distribution rules, and public release policy before publishing outside local/internal use.
