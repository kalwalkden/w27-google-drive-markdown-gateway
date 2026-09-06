# Client Validation and Write Gate

## Status

Approved

## Context

ChatGPT Work and Codex cloud require deployed, operator-configured environments; unsafe writes must never be enabled from an unproved assumption.

## Objective

Define the durable evidence gate that keeps gateway writes disabled until the live raw Drive probe proves an atomic precondition, and document later Work/Codex verification inputs.

## Scope

Add a typed, fail-closed proof-state contract, operator evidence record, and environment/runbook requirements for narrow Codex networking and Work OAuth/JWT validation.

## Non-goals / later

No actual HTTP, MCP, CLI, credential provisioning, or external platform verification.

## Constraints / caveats

An ordinary version comparison followed by update is not a safe substitute for atomic conditional Drive writes. No operator may bypass the gate through a repository change.

## Dependent tasks or work

Depends on the raw capability harness; later Drive write and deployment tasks consume the gate.

## Likely starting points

- `google-drive-markdown-gateway-handoff.md` — defines separate principals, rotation, and cloud allowlisting.
- `docs/codex-cloud-preflight.md` — existing cloud environment guidance.

## Expected change surface

Configuration/proof-state boundary and operator documentation. No client adapter is introduced.

## Open Questions

None.

