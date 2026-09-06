# Platform Validation

## Status

Complete

## Requirements

Establish a reproducible TypeScript/Node 24 baseline and live-validation harnesses before writes can be enabled. Support both Shared Drive application-default credentials (ADC) and My Drive OAuth refresh-token configuration without committing credentials.

## Constraints

Use pnpm, strict TypeScript, Vitest, and Biome. Raw Drive writes remain fail-closed until an operator has run and recorded a successful atomic-precondition proof. External ChatGPT Work, Codex cloud, and Google credentials are operator supplied.

## Success Criteria

The repository builds and tests from a clean checkout; documented live probes can prove Drive behavior, credentials, and client reachability without storing secrets.

## Non-goals / out of scope

Production Drive behavior, service endpoints, and platform provisioning belong to later features.

## Implementation Map

No product source exists yet. `google-drive-markdown-gateway-handoff.md` defines the required Drive and client boundaries; `ARCHITECTURE.md` records the unselected baseline. Later implementation will introduce the planned `src/` and `tests/` roots.

## Open Questions

None.
