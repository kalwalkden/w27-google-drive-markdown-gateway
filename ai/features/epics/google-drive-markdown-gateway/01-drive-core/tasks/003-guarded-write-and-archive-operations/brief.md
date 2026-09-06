# Guarded Write and Archive Operations

## Status

Approved

## Context

The product promises no silent overwrite and no permanent deletion, but Drive atomic precondition support must be demonstrated first.

## Objective

Implement create, update, and archive only when the validated precondition gate allows it, with conflicts preserving the current file.

## Scope

Add Drive write operations, expected-revision handling, archive-folder moves, stable conflict mapping, default-deny behavior, fake-port tests, and dedicated-root integration harness cases.

## Non-goals / later

No transport endpoints, user-facing merge experience, automatic retries after conflict, sharing changes, trashing, or deletion.

## Constraints / caveats

Writes remain unavailable unless the operator evidence gate proves the exact Drive conditional mechanism. Create must reject an existing or ambiguous target; archive also requires a valid expected revision.

## Dependent tasks or work

Depends on live-drive evidence and the read adapter.

## Likely starting points

- `google-drive-markdown-gateway-handoff.md` — update/archive contracts and no-delete rule.

## Expected change surface

Application write use cases, Google adapter write paths, integration harnesses, and error contracts. Read safety stays unchanged.

## Open Questions

None.

