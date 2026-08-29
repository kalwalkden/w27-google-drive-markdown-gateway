# Nested Mutations and Archive

## Status

Complete

## Context

Create/update are direct-root-only and archive always returns `UNSUPPORTED`. The raw adapter can
already send create, conditional update, and conditional parent-move requests, but application and
runtime postconditions do not yet make them safe across the configured tree.

## Objective

Complete nested create, revision-safe update, and archive for both production transports with one
provider dispatch and explicit reconciliation when the final state cannot be proved.

## Scope

Use task 001's unique topology snapshots and task 002's configured writer. Add immediate
pre-dispatch rechecks and post-dispatch verification for nested create/update/archive as decided in
`feature.md`. Make archive validate its configured descendant chain, exact source parent/revision,
and destination name vacancy before one conditional move. Add `OUTCOME_UNKNOWN` across domain,
provider, HTTP, MCP, CLI, audit, and metrics classification. Supply the same runtime write-session
provider to JSON and MCP only when write mode is enabled.

## Non-goals / later

No folder create/move, archive renaming, trash/delete, automatic cleanup, retry, rollback,
idempotency service, merge UI, live Drive request, or claim of cross-resource atomicity.

## Constraints / caveats

Update and archive require exact `If-Match`; only 412 is a normal conflict. Once dispatch may have
occurred, any unverified response or failed postcondition is outcome-unknown. Create and archive
must enumerate the relevant destination completely before claiming name uniqueness. A source already
directly in archive is successful only after exact revision, ancestry, and uniqueness checks.

## Dependent tasks or work

Depends on tasks 001 and 002. Task 004 aligns external guidance and operator validation with the
completed behavior.

## Acceptance criteria

- Nested create/update/archive work through one application boundary and both transports when the
  explicit production write mode is enabled.
- Stale revisions and pre-dispatch topology/name races perform no mutation.
- Each request dispatches at most one provider mutation and never retries or falls back without a
  precondition.
- Uncertain provider or postcondition outcomes produce the stable redacted reconciliation result.
- Archive never invokes trash/delete and cannot move a file to an unverified or colliding
  destination.

## Likely starting points

- `src/application/markdown-service.ts` — current direct-root mutation gates and disabled archive.
- `src/drive/drive-port.ts` — create/conditional write result contracts.
- `src/drive/google-drive-write-adapter.ts` — one create/update/move dispatch and current failure
  normalization.
- `src/runtime/server.ts` — shared JSON/MCP service and session composition.
- `src/http/json-api.ts` and `src/mcp/stateless-mcp.ts` — public error mapping and write-session use.
- `src/codex-cli/cli.ts` — strict response validation and stable exit behavior.
- `src/observability/audit.ts` — closed terminal result/metric vocabulary.
- `tests/application/markdown-service.test.ts`, `tests/drive/google-drive-write-adapter.test.ts`,
  `tests/http/json-api.test.ts`, `tests/mcp/stateless-mcp.test.ts`, and
  `tests/runtime/server.test.ts` — current mutation, conflict, transport, and composition coverage.

## Expected change surface

Application mutation orchestration; raw write result union; production session composition; stable
error and telemetry vocabularies; JSON/MCP/CLI contracts; fake and adversarial race tests. Client
release harness execution and final operator/runbook updates remain for task 004.

## Open Questions

None.
