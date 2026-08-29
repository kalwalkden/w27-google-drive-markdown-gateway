# Resilience and Drive Edge-Case Coverage

## Status

Complete

## Context

Drive behavior around names, moves, throttling, and malformed content determines whether the gateway maintains its narrow safety promise under stress.

## Objective

Add proportionate automated and opt-in live coverage for the failure modes that could bypass safety or make the service unreliable.

## Scope

Cover duplicate names, shortcuts, renamed/moved folders, file moves, Drive throttling/timeouts, large files, malformed UTF-8, stale revisions, retry classification, rate limits, and timeout propagation through fakes plus dedicated-root live harnesses where needed.

## Non-goals / later

No load-test platform, unbounded retry policy, background synchronization, or new content operations.

## Constraints / caveats

Do not invent deterministic results for Google APIs: live cases remain opt-in and documented. Preserve fail-closed writes and content-free logs.

## Dependent tasks or work

Depends on completed Drive, JSON, and deployment-capable service paths.

## Likely starting points

- `google-drive-markdown-gateway-handoff.md` — Epic 5 edge cases and acceptance criteria.

## Expected change surface

Unit/contract/integration tests, Drive error translation, timeout/retry boundary behavior, and live-test documentation. Public operation scope stays fixed.

## Open Questions

None.
