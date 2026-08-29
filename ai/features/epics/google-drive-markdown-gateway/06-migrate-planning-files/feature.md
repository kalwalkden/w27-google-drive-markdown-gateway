# Migrate Planning Files

## Status

Complete

## Requirements

Move the agreed planning source of truth into the configured Drive tree and verify safe access from Work, Codex cloud, and Google Drive clients.

## Constraints

Migration is operator-authorized and uses archive rather than permanent deletion. The task must not expose credentials or copy unrelated Drive content. Repository gateway code and operations documentation remain in the repository.

## Success Criteria

The target folder taxonomy, migration manifest, verification steps, source-of-truth policy, and live cross-client test make the cutover auditable and recoverable.

## Non-goals / out of scope

Bulk Drive migration tooling, moving credentials, or making all repository files Drive-backed.

## Implementation Map

Uses the completed gateway and its documented clients. The handoff's Epic 6 defines the required folders and client verification target.

## Open Questions

None.
