# Documentation map

Use this page to find the current owner of a project fact or contract. Runtime
code and the manifest define what the extension does; documentation describes
that behavior and the process for changing it.

## Current references

- [Project overview](project-overview.md): installation, user-visible behavior,
  runtime layout and current project version.
- [Development workflow](development-workflow.md): how to trace a runtime path,
  preserve behavior across generated output and merges, and verify the loaded
  extension.
- [Model tabs and dispatch](model-tabs-architecture.md): tab ownership and
  prompt dispatch.
- [Completion protocol](completion-protocol-v2.md): answer completion and
  acceptance rules.
- [Timing settings](timings-settings.md): timing ownership and current values.
- [Telemetry](telemetry.md): diagnostic events, exports and validation.
- [Automation Layer v2.2](automation-layer-v2.2.md): current Automation Layer
  runtime and integration notes.
- [Changelog](CHANGELOG.md): append-only release history, newest entry first.

The Debate implementation currently lives in [`../disput/`](../disput/) and
the results-page integration. Do not link to a design document unless that file
exists and still describes the shipped contract.

## Writing and maintenance rules

- Keep one current owner for each evolving contract. Link to it from other
  documents instead of copying mutable details.
- When behavior or release steps change, update the owning document in the same
  change. Historical detail belongs in the changelog; current instructions
  belong in the owning guide.
- Check links and version claims against the repository before committing.
- Mark measurements and test counts with their date. Do not present an old
  snapshot as a current result.
- Record unresolved runtime attribution as unresolved until the active code
  path and installed build have been verified.
