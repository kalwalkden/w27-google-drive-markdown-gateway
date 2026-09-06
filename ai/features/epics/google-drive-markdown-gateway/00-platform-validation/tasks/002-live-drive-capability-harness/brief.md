# Live Drive Capability Harness

## Status

Approved

## Context

Drive v3 documents a monotonic file version but does not clearly document a compare-and-swap update precondition for this use case.

## Objective

Provide an opt-in, credential-free-in-repository harness that an operator can use against a dedicated test root to prove raw Markdown upload, download, and stale-write behavior.

## Scope

Add a narrowly scoped live-test configuration contract, raw Drive probe harness, results-record template without secrets, and setup/runbook documentation for Shared Drive ADC and My Drive refresh-token modes.

## Non-goals / later

No production gateway write implementation and no committed validation result or credential.

## Constraints / caveats

Live execution requires operator-provided Drive access and a disposable test file. The harness must make failures actionable without revealing content or tokens.

## Dependent tasks or work

Depends on `001-typescript-service-baseline`; informs all write work in Drive Core.

## Likely starting points

- `google-drive-markdown-gateway-handoff.md` — establishes the required dedicated test folder and revision safety rule.

## Expected change surface

Live-test helper modules/scripts, documentation, and test configuration. Product API boundaries remain unchanged.

## Open Questions

None.

