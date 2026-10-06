# FINAL CHANGESET — Automation Layer v2.2.3

Status: final pre-code baseline. All changes below are already integrated into the full files in this package; no manual patching is required.

## Accepted changes after Claude / Qwen / DeepSeek / Terra / Le Chat / Z.ai reviews

1. **Explicit domain dispositions in AL-STRUCT-1.** `dispositions[]` is a separate vocabulary from `input_fate`. It is mandatory only for stage contracts with `dispositions_required=true` (initially stages 3 and 15); otherwise it must be `[]`. Runtime owns the accountable set and reconciles declared dispositions with `changes`, `input_fate`, policy and the frozen snapshot.
2. **Canonical hash format unified.** Persisted/runtime SHA-256 values use lowercase bare 64-hex only. `sha256:`-prefixed values are rejected/normalized before persistence and never become canonical Ledger values.
3. **Compact model-facing AL-STRUCT contract.** The full JSON Schema is validator-side only. Ordinary prompts receive `execution/al-struct-1.prompt-contract.json`: required fields, closed enums, semantic rules, one schema example and `full_schema_hash`. Dispatch fails if that hash does not match the full schema.
4. **Deterministic transport-tolerant JSON extraction.** Accepted transport representations are whole-text JSON or exactly one unambiguous fenced JSON candidate from correlated `textContent`/raw text. Wrapper prose/fences remain RAW only. Multiple candidates or ambiguity are rejected.
5. **M1 is a synthetic zero-commit transport probe.** It does not execute Product Stage 1 and performs no Registry/Ledger domain mutation or canonical ID allocation. It validates snapshot → compact layered prompt → Web dispatch → correlation → extraction → full schema → snapshot acknowledgement → audit/telemetry.
6. **M1 provider telemetry is mandatory.** Record first-pass validity, extraction mode/failure, schema failure, snapshot-hash mismatch, bounded-repair outcome and latency for the enabled provider set. Repair budget is not increased without measured evidence.
7. **Runtime cost is measured, not assumed.** Record model calls, repair calls, fan-out calls and wall-clock duration. Estimates such as 70–100 calls are not scheduler constants.
8. **Automation Layer and `disput/` are separate orchestration domains.** Existing provider/transport/lifecycle utilities may be reused only through explicit adapters. Debate scheduler, vocabulary, artifact model and commit semantics are not the Product→Architecture execution engine.

## Prior fixes retained unchanged

- `changes[].state_patch` + deterministic MutationNormalizer for `REVISE` / `SET_STATUS` and state proposals.
- `annotations[]` are diagnostic-only and non-authoritative.
- Deterministic decomposition/coverage policy for stages 7, 11, 12 and 15.
- IndexedDB as authoritative Registry/Ledger/run store; one StateCommit = one readwrite transaction.
- Ajv standalone/build-time validation for MV3; semantic rules remain deterministic JS validators.
- Restartable controller/checkpoint model; UI page is not authoritative state.
- Evidence Collector / HUMAN_TEST routing; model analysis alone never yields VERIFIED evidence.
- Explicit 10-provider Web matrix: ChatGPT, Claude, Gemini, Grok, Le Chat, Qwen, DeepSeek, Perplexity, Z.ai, Kimi.

## Implementation consequence

After this release, the next work item is **M0 → M1 code**, not further contract expansion: loader/lint/precompiled validators, then the synthetic zero-commit transport probe. M2 introduces the first canonical StateCommit.
