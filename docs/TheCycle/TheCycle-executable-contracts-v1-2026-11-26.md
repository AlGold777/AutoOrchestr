# TheCycle — исполнительные контракты v1.0 (проект)

Дата: 2026-11-26. Ветка: `thecycle/c01-basic-adapter`. Основание: архитектура v0.2 из `docs/thecycle-architecture-review` и ТЗ §§1–16. Статус: нормативная спецификация для реализации; код, браузерные тесты и файловый sink ещё не подтверждены.

## 1. Решения, приоритеты и инварианты

TheCycle — детерминированный управляющий слой над конечным Basic. Один внешний цикл = один конечный Basic run и, при успехе, один immutable CyclePacket. Число внешних циклов не фиксируется кодом; действуют бюджет и Stop владельца. Один research может иметь только одного владельца исполнения. Все внешние побочные эффекты предваряются durable intent и резервом ресурсов. UNKNOWN не отправляется повторно. VERIFIED_SOLUTION требует независимой проверки и закрытия всех обязательств. Состояние контроллера и бэкапа долговечно при MV3 worker restart.

**Нормативные термины:** MUST — обязательно; SHOULD — рекомендуется; MAY — опционально. Все JSON ниже — схемы полей и примеры значений, а не утверждение о существующих API.

## 2. Общий протокол данных

Все сохраняемые записи MUST содержать `schemaVersion:1`, `researchId`, `createdAt` (ISO 8601 UTC), `eventId` (UUID/ULID), `ownerEpoch` (целое >=0), `stateVersion` (монотонное целое). Идентификаторы неизменяемы; содержимое immutable records не перезаписывается. Сериализация digest — RFC 8785 JSON Canonicalization Scheme по UTF-8 с исключённым полем digest. Хеши — lowercase SHA-256 hex. При неизвестной версии или невалидной ссылке переход в PAUSED_SCHEMA, без отправок.

Ошибки в публичном контракте: `INVALID_SCHEMA`, `STALE_VERSION`, `STALE_OWNER`, `BUDGET_EXCEEDED`, `STOP_REQUESTED`, `BACKUP_REQUIRED`, `CAPABILITY_UNAVAILABLE`, `DISPATCH_UNKNOWN`, `STORAGE_QUOTA`, `INTEGRITY_FAILURE`, `UNAUTHORIZED_COMMAND`, `VERIFICATION_INSUFFICIENT`. Ошибка содержит code, message, retryable, correlationId, occurredAt; не содержит cookie/token.

## 3. Контракт PolicyDecision

```json
{"schemaVersion":1,"decisionId":"d-001","researchId":"r-001","expectedStateVersion":12,"ownerEpoch":3,"action":"REPEAT_PIPELINE","reason":"Open obligation remains","evidenceRefs":["ev-02"],"proposer":{"kind":"POLICY","id":"fixed-v1"},"budgetReservation":{"calls":2,"maxPromptChars":20000},"validation":{"status":"APPROVED","policyVersion":"p1","checkedAt":"2026-11-26T09:00:00Z"},"createdAt":"2026-11-26T09:00:00Z"}
```

`action` enum: CONTINUE, REPEAT_PIPELINE, GENERATE_PIPELINE, CHANGE_STRATEGY, VERIFY, COMPLETE, STOP, WAIT_OWNER. LLM may propose but cannot set validation.status=APPROVED: controller overwrites untrusted validation. `expectedStateVersion` and `ownerEpoch` checked transactionally. Budget reserved before send, including retries and UNKNOWN. COMPLETE is legal only with a separately calculated terminal status; VERIFIED_SOLUTION only when all success criteria and independent evidence obligations are satisfied. WAIT_OWNER persists owner question and blocks dispatch. Stop and hard budget override all model proposals.

## 4. Контракт CyclePacket и исходников

```json
{"schema_version":1,"research_id":"r-001","cycle_id":12,"parent_state_version":11,"pipeline_ref":"pipe-3:v4","run_id":"run-012","source_refs":["raw-1"],"knowledge_delta":[{"claim_id":"c-017","revision":2,"status":"CANDIDATE","statement":"Exact statement","evidence_refs":["raw-1"],"depends_on":["c-004:v1"],"verification_refs":[]}],"open_obligation_refs":["obl-3"],"contradiction_refs":[],"resource_delta":{"model_calls":2},"integrity":{"algorithm":"SHA-256","digest":"<computed-on-commit>"}}
```

Commit MUST validate parent version with CAS, referenced source objects and their digests, claim revision continuity, obligation references and budget settlement; atomically store packet, stateVersion, event and source reachability metadata in IndexedDB. Source object schema: `sourceId, researchId, runId, provider, model, conversationId, messageId, capturedAt, contentType, byteLength, sha256, payloadRef, provenance`. Basic `history/artifacts/texts` MUST be materialized before Basic's quota eviction; on quota failure STOP/PAUSED_STORAGE. Claim status enum CANDIDATE, VERIFIED, REFUTED, STALE, UNRESOLVED. A refuted dependency invalidates dependent VERIFIED claims to STALE, never deletes old revisions.

## 5. Контракт DispatchRecord и транспорт

```json
{"schemaVersion":1,"researchId":"r-001","runId":"run-012","attemptId":"att-01","ownerEpoch":3,"status":"NOT_SENT","provider":"chatgpt","providerCorrelation":null,"intentEventId":"e-100","reservedCalls":1,"createdAt":"2026-11-26T09:00:00Z","lastObservedAt":null}
```

Transitions: PREPARED/NOT_SENT → SENT → ACCEPTED; SENT → UNKNOWN on timeout/restart/unverifiable outcome; NOT_SENT → CANCELLED if definitively not sent. UNKNOWN → ACCEPTED only with correlated evidence; UNKNOWN → NOT_SENT only with reliable proof of non-delivery; otherwise PAUSED_UNKNOWN and owner reconciliation. Duplicate attemptId and repeated callbacks are idempotent. A persisted intent does **not** guarantee delivery, and absence of an acknowledgment does **not** prove non-delivery. Fencing check occurs at last controllable boundary before transport side effect; prevent concurrent dispatch using a single owner gate, but do not claim external exactly-once. A late result from stale epoch may be archived with provenance, never trigger a new cycle.

Transport interface:
`dispatch({attemptId,provider,conversationTarget,promptRef,signal,ownerEpoch}) -> {status,correlationId,observations}`;
`observe(attemptId) -> {status,correlationId,observations}`;
`cancel(attemptId) -> {attempted,confirmed}`.
Transport capabilities MUST declare whether new isolated chat, cancellation, correlation and resume are actually supported. Unsupported capabilities fail before dispatch.

## 6. Контракт BackupManifest и файловой политики

```json
{"schemaVersion":1,"backupId":"b-001","researchId":"r-001","packetCommitId":"pc-012","snapshotStateVersion":12,"reason":"POST_COMMIT","createdAt":"2026-11-26T09:00:00Z","fileLocator":"user-selected-folder/thecycle-r-001-b-001.json","sha256":"<sha256>","byteLength":0,"verificationMethod":"READBACK_SHA256","verifiedAt":null,"status":"PENDING"}
```

`reason` enum POST_COMMIT, INTERVAL, MANUAL, PRE_MIGRATION. `status` enum PENDING, WRITTEN, VERIFIED, FAILED. `verifiedAt` only after byte-for-byte readback and digest match. Backup service interface `putImmutable(key,bytes)`, `read(key)`, `list(prefix)`, `verify(key,expectedSha256)`, `restoreVerified(key)`. An implementation relying solely on `chrome.downloads.download` cannot satisfy READBACK_SHA256; do not mark VERIFIED without an actual readback.

Scheduling: chrome.alarms at 10-minute interval while browser operational, plus POST_COMMIT gate. Alarm wake may be late after sleep or browser closure; report missed schedule honestly. POST_COMMIT snapshot must include that packet and remain blocked until verified. On crash after write before manifest commit, recovery MUST re-read file and finalize manifest or leave BACKUP_REQUIRED. Manifest and blocking flag persisted in IndexedDB. Immutable versioned filenames, no overwrite; retention only after verifying remaining copies. Import verifies canonical envelope, all object hashes, schema and referential integrity before atomic restore to a new research database. No automatic dispatch after restore.

**File sink architecture decision ADR-FS-01:** Prefer user-selected directory with read/write/readback-capable File System Access where supported in the extension execution context. Chrome extension service worker support and persisted handle permission MUST be tested in an executable spike before selection. Fallback: explicit user-assisted export/import with verified local readback; this does NOT satisfy unattended periodic backup and must therefore block autonomous mode. No unsupported claim of guaranteed unattended backups. Acceptance of a sink requires Chrome version matrix, restart test, revoked permission test, readback test and 10-minute alarm integration test.

## 7. VerificationRecord

```json
{"schemaVersion":1,"verificationId":"v-001","researchId":"r-001","claimRef":"c-017:v2","obligationRefs":["obl-3"],"sourceRefs":["raw-1"],"verifier":{"kind":"INDEPENDENT_CONTEXT","provider":"chatgpt","conversationId":"isolated-01","contextIsolationEvidenceRef":"transport-proof-01"},"verdict":"INSUFFICIENT","limitations":["Unproved lemma"],"checkedAt":"2026-11-26T09:00:00Z"}
```

`verdict` enum SUPPORTED, CONTRADICTED, INSUFFICIENT, VERIFIED. VerificationRecord verdict is separate from Claim.status and research terminal status. Verifier must receive exact statement, original task, source refs and relevant assumptions, without untrusted preferred verdict. Independence MUST be demonstrated by transport evidence, not role name. Formal checker evidence includes checker version, exact input, output and assumptions. If independent verification unavailable, do not emit VERIFIED_SOLUTION. Research terminal enum VERIFIED_SOLUTION, PARTIAL, INCONCLUSIVE, BUDGET_EXHAUSTED, CANCELLED, ERROR.

## 8. StrategyProposal и перенос контекста

```json
{"schemaVersion":1,"proposalId":"sp-01","researchId":"r-001","previousStrategyVersion":"s-2","action":"CHANGE_STRATEGY","proposedPipelineRef":"pipe-4:v1","reasonRefs":["barrier-2"],"expectedProgress":{"obligationsToTest":["obl-3"]},"budgetImpact":{"maxCalls":4},"validation":{"status":"PENDING"},"rollbackPoint":"s-2"}
```

Planner output is untrusted and MUST pass JSON schema, Basic capability gate, budget, prompt-length and permissions validation. Store proposal and decision separately. Rollback changes active strategy pointer, never removes negative findings. Context handoff contract: `taskRef, constraintRefs, activeStrategyRef, verifiedClaimRefs, candidateClaimRefs, refutedClaimRefs, contradictionRefs, openObligationRefs, sourceRefs, budgetSnapshot, schemaVersions`; deterministically select relevant refs under a token/character budget, never silently truncate evidence. If critical refs do not fit, decompose or WAIT_OWNER.

## 9. MV3 execution and state machine

Architectural phases: Initialize, Strategy, Design, Validate, Execute, Audit, CommitState, Verify, Evaluate, Decision, Recover, Pause, WaitOwner, Completed. MVP implementation phases READY, INTENT, RUNNING, COMMIT, EVALUATE, RECONCILE, PAUSED, COMPLETED, BACKUP_REQUIRED must map explicitly to architecture phases. Each `tick(researchId)` performs bounded work and persists a state transition. Long-lived Basic runs are observed through provider/extension events; do not depend on an immortal service worker Promise. `chrome.runtime.onMessage` commands validate extension sender, action permissions, expected stateVersion and nonce; content scripts/model outputs cannot issue privileged state changes. No control state in `chrome.storage.session` or worker memory. On extension upgrade, migration check occurs before scheduler resumes.

## 10. Acceptance mapping and test harness

The three source suites are distinct: architecture review TC-A01..TC-A12, implementation plan CT01..CT12, and T01..T20 in the main specification. Maintain a traceability table with every ID, contract, fixture, fault injection, expected DB events, expected transport sends and pass/fail evidence. Overlapping scenarios MAY share code but MUST preserve each original assertion. Blocking cases: 60 external cycles; zero double sends after worker restart; race with owner takeover; Basic quota eviction; crash after packet commit before backup; crash after file write before manifest commit; corruption on restore; false VERIFIED; independent context proof; invalid planner output; prompt overflow; stop during send; browser closed across alarm boundary.

Minimum CI: unit schema validators, property-based FSM transitions, IndexedDB fault injection, fake transport deterministic integration. Browser tests: actual Chrome MV3 extension, worker termination, tab closure, provider rate limits, file permission revoke, restore and backup readback. Record baseline before code changes and gate autonomous mode on all P0 passing. MATH-03 adaptive-vs-fixed comparison at equal budget is separate from technical acceptance.

## 11. Delivery tasks with dependencies

C00: audit main and PR3, manifest, transport and test baseline. C01: Basic adapter and source materialization. C02: durable store, outbox, backup sink and restore. C03: FSM, policy, ownership and backup gate. C04: MV3 integration, transport and minimal UI. C05: CyclePacket, knowledge graph, independent verifier. C06: Planner, Strategy Recovery, metrics and context handoff. C07: full technical acceptance, then MATH-03 experiment. For each task: code, schema validation, tests, migration if needed, failure modes, documentation and PR review. No merge to main without P0 gates.

## 12. Unresolved engineering decisions

(1) File sink viability in the exact Chrome MV3 execution contexts; (2) retention and disk quotas; (3) default owner resource policy; (4) proof standard by task type; (5) integration capability matrix for PR3; (6) practical alarm latency under sleep/closure. These are explicit blockers to claims of fully autonomous production readiness, not permission to omit requirements.
