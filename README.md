# LLM Codex-Codex

Chrome MV3 extension for dispatching prompts to multiple LLM web interfaces,
collecting answers, and running Debate pipelines.

Select text in a response card or on a model page to open its formatting bar.
The arrow on the left reveals paragraph alignment, a bulleted list, and
decrease/increase indent controls. These actions format the paragraph containing
the selection; selecting across paragraphs formats each selected paragraph.

In the main page's single-column answer view, scrolling brings the next model
card up from below to cover the current card in a stable reading viewport.
In the three-column grid, the next row of three cards covers the current row
as one block, including an incomplete final row. Narrower layouts group cards
by the available number of columns.
Small initial scrolls hold the current card in place; scrolling back reverses
the transition. Long answers scroll inside each card. Switching layouts keeps
the reading model in view. Streaming previews, expanded cards, and
reduced-motion preferences use the normal layout.

Pipeline answer cards show a small round badge beside the model name (`GPT R1`).
Each model has one card per round: streaming updates reuse it, and later answer
growth adds paragraphs to the same card. The next round gets a separate card.
Incomplete answers retain the round badge and show `uncompleted` after it
(for example, `DeepSeek R3 uncompleted`), including manually recovered answers.
Round identity survives background-state recovery and deferred display. If a
recovered card receives its round identity later, it gains the badge in place;
repeated recovery and final deliveries keep a single card for that request.

The fullscreen icon immediately before Copy opens the visible Debate feed in
the same separate window and at the same size as a main-page answer. The feed
updates as new messages arrive. Click outside the window or press Esc to close it.

## Start here

- Documentation map and writing rules: [docs/documentation-map.md](docs/documentation-map.md)
- Project setup and runtime overview: [docs/project-overview.md](docs/project-overview.md)
- Current Debate architecture: [docs/disput/orchestrator-contract-v1.0.md](docs/disput/orchestrator-contract-v1.0.md)
- Main-page model tabs and dispatch: [docs/model-tabs-architecture.md](docs/model-tabs-architecture.md)
- Timing architecture and current values: [docs/timings-settings.md](docs/timings-settings.md)
- Current Debate plans: [docs/disput/PLAN-universal-pipeline-v3.0.md](docs/disput/PLAN-universal-pipeline-v3.0.md)
- Universal task engine concept and draft contracts: [docs/Universal Engine/README.md](<docs/Universal Engine/README.md>)
- Deferred work only: [docs/disput/OPEN-ITEMS-v3.0.md](docs/disput/OPEN-ITEMS-v3.0.md)
- Append-only change history: [docs/CHANGELOG.md](docs/CHANGELOG.md)
- Disput runtime/UI corrections: [docs/disput/TZ-runtime-ui-corrections-v1.0.md](docs/disput/TZ-runtime-ui-corrections-v1.0.md)

## Development

```bash
npm install
npm test -- --runInBand
```

The extension is loaded unpacked from the project root through
`chrome://extensions`. Provider pages must already be authenticated for web UI
automation.
