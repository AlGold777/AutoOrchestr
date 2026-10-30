# Basic participants: schema and transport notes

Working contract for implementation of multiple participants backed by one provider. This file records the schema and transport side for integration; the user-facing guide and developer docs are updated by the integrator after the UI contract is settled.

## Schema versions

- `schemaVersion: 1` retains the existing contract: a missing participant `id` means `id === name`; unknown participant keys remain errors; existing inheritance/default behavior is unchanged.
- `schemaVersion: 2` accepts `id`, `label`, and `settingsMode`. Every participant entry must carry a nonempty stable `id`; `name` remains the provider key used by transport and cannot change for a given ID anywhere in one schema. `label` is optional, nonempty when present, and falls back to `name` for display. A participant keeps one label across its schema entries, and labels are unique per provider.
- `settingsMode: "explicit"` applies to one participant in one round. Missing task, input, discipline strings, output, and maxWords resolve empty/absent rather than inheriting round, pipeline, or Basic participant defaults. Missing input resolves to `none`. The launch task and transport's delivery/size safeguards remain outside this profile.
- `SCHEMA_VERSION` is 2 and `[1, 2]` remains supported. Do not mass-convert stored v1 schemas. Any new fields require v2; an old reader must reject v2 instead of dropping identity.

Example:

```json
{
  "schemaVersion": 2,
  "origin": "user",
  "steps": [{
    "ref": "r1",
    "kind": "round",
    "models": [
      { "id": "participant-uuid-1", "name": "Claude", "label": "Claude" },
      { "id": "participant-uuid-2", "name": "Claude", "label": "Claude 2", "enabled": false, "onCanvas": true, "settingsMode": "explicit" }
    ]
  }]
}
```

IDs, not labels or provider names, key model-card settings, answers, outputs, artifacts, and references. A repeated ID in one round is invalid. A repeated provider name with different IDs is valid. Disabled duplicate entries remain available to canvas/settings conversion; `enabled: false` means no request is assembled.

## Conversion contract for the page integrator

`BasicSchema.toSettings(schema)` returns `customModelSettings[stepRef][participantId]` entries. An entry includes provider `name`, optional `label`, optional `settingsMode`, plus only fields represented in the schema (`promptTemplate`, `maxWords`, `task`, `discipline`, `input`, `output`). A disabled entry additionally carries `enabled: false`. Preserve empty strings and empty nested objects; do not replace them with inheritance.

`BasicSchema.toCanvas(schema)` returns model stack items as `{ name, id, label?, input, send, role }`. `name` is the provider; `id` is the immutable participant key; `label` is display-only. `send`/`input` reflect the current round's enabled state. Every declared duplicate that remains on the canvas must appear by its own ID, including disabled entries. Turning one on reuses that ID. `rounds[].participantIds` and `rounds[].roles` describe only enabled participants.

`BasicSchema.assemble(schema)` emits engine participants with `{ name, id, label?, settingsMode?, promptTemplate, maxWords, task, discipline, input?, output? }`. For explicit settings, do not materialize inherited participant defaults. The engine uses provider `name` for delivery and `id` for all result keys. `label` is presentation metadata and must be available to feed/run-record adapters. Preview and run must resolve the same explicit profile.

## Run chat bindings

The background binding and run snapshot use `chatBindings[participantId]`:

```text
{ modelName, tabId, requestId, stageAttemptId, chatUrl?, initialUrl?, stepRef?, visit?, transportRequestId?, chatVisit?, attachedChatVisit? }
```

`chatUrl` is the provider conversation address, not a provider homepage or sign-in URL. It is captured when the live tab leaves its initial provider URL. Continue checks the live tab URL against the saved address. If the tab is gone or moved, recovery may open only the exact saved URL; the loaded URL must still match and be eligible for the same provider before dispatch. Missing URL permits a verified live legacy tab only; it cannot recover a closed tab. Any failed binding write or uncertain recovery refuses dispatch. Chat URL is run-private data and does not belong in exported schemas or telemetry.

The existing participant-wave ordering, attempts, and unknown-request decision flow stay unchanged. Restoring a tab does not settle or resend an unknown request.

## Integration still required

The page owns serialization from background replies into the live run record. Its participant binding projection must carry `chatUrl` and `initialUrl` end to end, including the binding passed back to background on resume. The implementation here does not modify `results.js`; without that projection, worker memory can preserve an address during one live session, but a page reload cannot restore it from the run snapshot. UI code must also use `label` only for display and address every edit/send by `id`.
