# Bounded Tree Read Model

## Status

Complete

## Context

The public service currently exposes only direct-root list, search, and read even though the Drive
adapter has partial traversal helpers. Those restrictions were added because content reads were not
bound to mutable ancestor topology.

## Objective

Provide complete, bounded, duplicate-aware list/search/read behavior across the configured folder
tree, returning data only after the selected file and ancestry pass pre/post verification.

## Scope

Add a request-local traversal budget, maximum path depth and bounded content-search work. Resolve
folder paths and file path/ID locators through exact single-parent chains with sibling-name
uniqueness. Support direct and recursive list below an optional folder, recursive name/content
search below an optional folder, and nested read. Revalidate relevant topology before returning
metadata, excerpts, or content. Sort deterministic output and reject incomplete traversal or hidden
duplicates with the stable result-limit/ambiguity outcomes.

## Non-goals / later

No write authority, create/update/archive behavior, folder mutation, background index, provider
transaction claim, or live Drive run.

## Constraints / caveats

Apply one budget across all provider calls in a request. Reject shortcuts, cycles, unsafe names,
multiple parents, malformed IDs, oversized files, and content-search truncation. ID reads must prove
the same canonical-path uniqueness as path reads. Pre/post checks mitigate ordinary races but do not
claim to detect a trusted administrator moving an ancestor out and back between checks.

## Dependent tasks or work

Builds on the completed Drive core and authenticated service. It is the read/topology foundation for
tasks 002 and 003.

## Acceptance criteria

- Nested list/search/read and optional folder selection satisfy the feature-level behavior and
  bounds through fakes.
- Duplicate folders/files and topology changes cannot yield partial metadata, excerpts, or content.
- The direct-root behavior remains compatible and all production writes remain unavailable.

## Likely starting points

- `src/application/markdown-service.ts` — direct-root gates, path/ID resolution, metadata checks, and
  result-limit behavior.
- `src/drive/drive-port.ts` — list/traversal/search contracts and overflow signal.
- `src/drive/google-drive-read-adapter.ts` — provider pagination, traversal, metadata/media reads,
  root validation, and direct-root restrictions.
- `src/drive/in-memory-drive-port.ts` — representative topology and concurrency fake.
- `tests/application/markdown-service.test.ts` — current direct-root, duplicate, race, and bound
  expectations.
- `tests/drive/google-drive-read-adapter.test.ts` — provider request and normalization coverage.

## Expected change surface

Application topology resolution and traversal budgets; Drive read-port and Google/fake adapter
contracts; service/runtime limit configuration; read/list/search tests; JSON/MCP parity tests where
tree inputs already exist. Authentication, raw writes, production sessions, Terraform, and client
release harnesses remain unchanged.

## Open Questions

None.
