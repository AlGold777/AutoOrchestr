# LLM Codex-Codex

Chrome MV3 extension for dispatching prompts to multiple LLM web interfaces,
collecting answers, and running Debate pipelines.

## Start here

- Documentation map and writing rules: [docs/documentation-map.md](docs/documentation-map.md)
- Project setup and runtime overview: [docs/project-overview.md](docs/project-overview.md)
- Current Debate architecture: [docs/disput/orchestrator-contract-v1.0.md](docs/disput/orchestrator-contract-v1.0.md)
- Main-page model tabs and dispatch: [docs/model-tabs-architecture.md](docs/model-tabs-architecture.md)
- Timing architecture and current values: [docs/timings-settings.md](docs/timings-settings.md)
- Current Debate plans: [docs/disput/PLAN-universal-pipeline-v3.0.md](docs/disput/PLAN-universal-pipeline-v3.0.md)
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
