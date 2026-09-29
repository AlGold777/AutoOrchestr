# SOURCE ALIGNMENT REPORT — v2.2.3

Status: PASS after static verification.

## Framework preservation

- Canonical process remains 30 stages.
- Human framework and `product_architecture_framework_system_model_final.json` are included unchanged as source artifacts.
- PFB / AIP / CAB, gates G1–G4, roles, authority ladder and dependency/control-flow sources are preserved.

## v2.2.3 runtime changes

- Explicit domain `dispositions[]` added to AL-STRUCT-1 for required transformation stages.
- Coverage runtime changed to declaration reconciliation rather than inferred semantic disposition.
- Canonical hashes are lowercase bare 64-hex throughout runtime schemas.
- Compact prompt-facing AL-STRUCT contract is bound to the full validator schema by SHA-256.
- Structured response extraction accepts whole-text JSON or one fenced JSON candidate and rejects ambiguity.
- M1 is a zero-domain-commit synthetic probe with provider telemetry.
- Runtime call/cost telemetry is measured rather than assumed.
- `disput/` is explicitly excluded as Product→Architecture scheduler/state authority.

## Provider alignment

Ten Web providers are represented: ChatGPT, Claude, Gemini, Grok, Le Chat, Qwen, DeepSeek, Perplexity, Z.ai and Kimi. Production enablement still requires fixture + live M1 PASS per provider.

## Verification

Static integrity runner: `tests/automation-static-contracts.mjs`.
Contract tests in bundle: 98.
