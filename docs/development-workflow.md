# Runtime change and release workflow

Use this workflow for behavior changes, regressions and fixes that cross files,
providers, generated artifacts or browser contexts. It is designed to keep a
working fix from disappearing during a later build, merge or reload.

## 1. Identify the code that actually runs

Before editing, inspect `manifest.json` and trace its script order, matches and
execution worlds. Follow the user-visible action through the payload, background
dispatch and provider adapter to the operation that changes the page. For a
reported live failure, also verify which local folder Chrome loaded and the
version shown on `chrome://extensions`.

Classify each similar implementation as one of:

- active source loaded by the manifest;
- generated output that is loaded by another supported package or setup;
- optional or historical output that is not loaded by the current manifest.

`dist/` is not automatically the active runtime just because it is tracked or
contains a matching function name. Conversely, an unpacked extension may keep
running an older loaded copy until Chrome reloads it. State which path was
verified; do not infer runtime causality from a text search alone.

## 2. Write down the invariant and the boundaries

Describe the behavior as an observable invariant before changing code. For
quantities, record the expected count at each boundary. Then follow that value
through the complete path: user input, serialization, message routing, storage
or dispatch, provider hydration, and final UI action.

Search all active implementations and generated outputs for alternate caps,
defaults and truncation. For a multi-provider behavior, enumerate the providers
that use shared code and those with their own adapter. A match is a lead to
classify, not proof that the code runs.

## 3. Preserve the invariant with a regression check

Add a regression check at the boundary where the behavior could be lost, and
cover at least one item beyond the old limit. For a shared pipeline, verify the
value reaches its provider boundary; a test of UI collection or serialization
alone does not establish delivery by the provider adapter. Preserve that check
when rebasing or merging later work.

Run the focused checks first, then the broader suite appropriate to the changed
surface. Report the commands and actual results. A static search, successful
build or helper-level test alone is not evidence that the reported live path now
works.

## 4. Rebuild generated outputs from their source

Treat source files as authoritative. Do not hand-edit generated adapters or
bundles to make them look current. Use the repository build command for each
generated format that is distributed or consumed by a supported setup; inspect
the resulting diff and confirm the output contains the source change. If a
generated file is optional or not selected by the current manifest, document
that fact instead of describing it as the active runtime.

After branch merges, compare the merged tree with its base and recheck the
invariant and regression check. A branch can restore older source or generated
output even when the fix remains in Git history.

## 5. Verify the extension the user will run

For browser-facing changes, confirm Chrome's loaded directory is the checkout
or package that was just updated, reload the extension, and check its displayed
version. Reproduce the relevant action with a value that crosses the former
limit, then inspect the provider result or diagnostic evidence. If live provider
verification is unavailable, say so and distinguish source/build evidence from
observed browser behavior.

## 6. Keep release metadata and documentation aligned

When code changes, update all applicable project-version references together:
`manifest.json`, `package.json`, the root package entries in `package-lock.json`,
and the root HTML stylesheet cache-busters when they are versioned with the
release. Update the current-version line in `docs/project-overview.md` and the
changelog. Check `git diff` for stale version strings before committing.

Update the owning documentation whenever behavior, supported paths or the
release workflow changes. Keep unrelated user changes out of the commit; stage
the files belonging to this change explicitly.

## Attachment-cap incident, 2026-09-29

Commit `458ea61` (version `2.81.490`) removed the five-file default and adapter
truncation from the source content scripts. Tracked files under `dist/` still
contained the old cap on 2026-09-29. The current root manifest loads raw
`content-scripts/` files rather than those `dist/` adapters, so that stale output
was a real distribution-parity defect but does not by itself prove why a live
extension still stopped at five files. The exact active install and provider
path must be checked before naming the runtime cause.

The existing attachment UI test verifies that six files can be collected and
serialized; that alone does not verify six files survive provider dispatch.
Future changes to attachment limits must check the count at the provider
boundary and the exact build Chrome loads.
