# Basic participants: UI integration notes

These notes describe the page-side participant controls implemented for Basic. The schema and transport contract is documented separately in [basic-participants-schema-notes.md](basic-participants-schema-notes.md).

## Canvas cards

- Basic model stack entries retain provider `name`, participant `id`, display `label`, Send state, and role independently. Saved `schemaVersion: 2` schemas are projected with `BasicSchema.toCanvas`; standard provider rows remain available so a new Basic schema can start from an empty canvas.
- Each Basic card has a small `+` action. It creates a fresh UUID participant for the same provider, labels it `Provider 2`, `Provider 3`, and so on, sets `settingsMode: "explicit"`, and starts with Send off. A duplicate can be enabled in the current round immediately. Its declared ID is projected as a disabled card into the other rounds.
- The label action changes `label` for every occurrence of that participant ID in the schema. The provider name and ID remain unchanged. Labels are checked for uniqueness among participants of the same provider.
- `×` is only rendered on duplicate participants. It removes that ID from the current round. Schema validation blocks removal when it would leave invalid references; after a successful removal, the card is rebuilt from the schema and cannot reappear from a stale stack snapshot.
- Role selectors and the participant settings inspector remain editable when a Basic participant's Send checkbox is off. Run state still disables canvas editing.

## Participant settings and run feed

- The existing participant settings window is addressed by `(stepRef, participantId)`, and stores card settings under the participant ID. For `settingsMode: "explicit"`, the prompt and editable task/discipline fields start empty; the participant's explicit profile does not display inherited placeholders.
- `Default` is placed immediately before `Save`. It fills the open form's prompt preview, shared length, task, and discipline from the effective round values in the draft. It does not alter Send or save the form; Save remains a separate action. An empty explicit prompt remains automatic prompt assembly.
- Canvas round plans use participant IDs in `participantIds` and `participantBindings`. Model names remain provider names for dispatch and model keys; labels are presentation data.
- Debate answer cards retain the provider as the model name and show a separate participant label when supplied. The label is also carried in the page's feed message snapshot and delivery metadata alongside participant ID.

## Integration notes for C

- Confirm the page round-plan builder, Save/reload, import/export, catalog, and run preview preserve `{ name, id, label, settingsMode }` and key settings by ID. This UI code does not add a parallel participant registry.
- Confirm transport event metadata provides `participantLabel` as well as `participantId`; the feed accepts it from message, delivery, metadata, or the in-page response context.
- Confirm Default covers all editable participant fields, including participant input/output where those fields are exposed by the schema editor. This change fills the current settings form fields and leaves Send untouched.
- Check removal of a participant with artifact references, use of one ID in later rounds, and a schema that has no enabled model yet. The UI allows a draft with Send off, but a runnable schema still needs an enabled model or User step.
- Verify both `pipeline_panel.html` and `result_new.html`; both share `results.js`, `pipeline/pipeline-runtime.js`, and `styles/pipeline.css`.
