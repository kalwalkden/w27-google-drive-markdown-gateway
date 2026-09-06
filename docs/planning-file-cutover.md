# Planning-file cutover

This is an operator procedure. The local preflight validates only a manifest,
checklist, and sanitized evidence shape. It never makes a gateway request,
creates a Drive file, enables writes, or proves a live client. Its evidence
binds the manifest SHA-256 plus the immutable image, non-secret runtime, and
live-Drive-probe digests. It always records `sourceOfTruth` as `not-declared`.

## Current state

Default deployment mode is read-only. Record `BLOCKED` with
`WRITE_UNAVAILABLE` when `write.enabled` is absent or false; every later gate,
operation, and client observation remains `NOT_STARTED`. A controlled
write-enabled deployment remains an `INCONCLUSIVE` local checklist, not live
success. It is a separate release decision requiring reviewed Terraform,
matching image/runtime/probe digests, server ACLs, a dedicated nested folder,
configured archive folder, and current Work/Codex platform controls.

## Future authorized sequence

Use exactly one manifest entry. Confirm the target folder exists and the exact
target is empty. Record each operation explicitly: list, search, read, create,
update, and archive. Make one create attempt through an approved client; a
duplicate create must prove `CONFLICT`. Preserve the returned locator and
revision only in operator working memory, not the evidence file. On a
collision, `CONFLICT`, `OUTCOME_UNKNOWN`, timeout, malformed response, or
transport uncertainty, stop. Do not retry, overwrite, clean up, archive,
delete, trash, or synchronize. Manually reread and reconcile before any later
operator decision.

After exact readback, verify update and stale-update `CONFLICT` behavior, then
archive only the captured file with its current reread revision and verify its
archive destination and cleanup state. An archive or cleanup failure is manual
recovery, not a delete/trash fallback. `OUTCOME_UNKNOWN` and
`TRANSPORT_UNCERTAIN` also require manual recovery. Read the same document from
a fresh Work session, clean Codex environment, macOS, iPhone, and iPad. Mark a
missing client as `BLOCKED`/`CLIENT_NOT_CONFIGURED`; those clients perform no
convenience writes.

Store evidence outside Git and outside any repository symlink. The tool rejects
repository-local paths, symlinked ancestors, existing output files, and unsafe
or oversized config files; it writes a complete exclusive `0600` temporary file
and atomically hard-links it only after rechecking the temporary inode and
parent directory. A directory swap before publication cannot receive evidence
content. Consume owner-only evidence only after the command reports success. Evidence may
retain opaque release/environment/client profile references, the four approved
digests, finite states, and manual recovery state.
Never retain paths, names, content, IDs, revisions, endpoints, credentials,
responses, diagnostics, screenshots, or device/account identities.

Run local preflight only with explicit external paths:

`mise run migration:cutover-preflight -- run --manifest <repository-manifest> --config <external-config> --output <external-evidence> --confirm W27_PLANNING_CUTOVER_PREFLIGHT_ONLY`

An `INCONCLUSIVE` result is checklist consistency only. It is not live success
and cannot declare Drive the source of truth.
