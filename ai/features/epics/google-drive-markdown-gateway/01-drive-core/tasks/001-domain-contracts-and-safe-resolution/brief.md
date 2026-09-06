# Domain Contracts and Safe Resolution

## Status

Approved

## Context

The service must make one application boundary—not transports—responsible for all Drive safety rules.

## Objective

Establish pure Markdown domain contracts, errors, path resolution, and a fake Drive port with comprehensive unit coverage.

## Scope

Define six-operation inputs/results, stable IDs/revision metadata, Markdown/UTF-8/size validation, root-relative path rules, ambiguity detection, and an in-memory port suitable for application tests.

## Non-goals / later

No Google API calls, credentials, transport endpoints, or enabled writes.

## Constraints / caveats

Reject absolute/traversal paths, shortcuts, duplicate names, and folder escapes rather than selecting an arbitrary target. Path and ID routes must converge on one authorization policy.

## Dependent tasks or work

Depends on the service baseline; unblocks the Google adapter.

## Likely starting points

- `google-drive-markdown-gateway-handoff.md` — source of the six operations and safety rules.

## Expected change surface

New `src/domain/`, `src/application/`, `src/drive/` port contracts, and unit tests. No provider SDK or HTTP framework behavior.

## Open Questions

None.

