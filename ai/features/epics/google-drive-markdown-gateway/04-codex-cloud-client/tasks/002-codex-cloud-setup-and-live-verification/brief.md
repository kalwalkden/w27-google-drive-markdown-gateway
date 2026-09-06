# Codex Cloud Setup and Live Verification

## Status

Approved

## Context

Codex cloud defaults to restricted egress and must not acquire Google credentials to use the gateway.

## Objective

Document and harness a clean Codex cloud setup that can safely exercise the diagnostics CLI against the deployed service.

## Scope

Add narrow gateway hostname/method allowlist guidance, secret injection/setup instructions, clean-environment live validation covering the six operations and stale updates, and recovery guidance for failure states.

## Non-goals / later

No edits to `AGENTS.md`, unrestricted Internet access, automatic cloud-environment mutation, or direct remote-Drive configuration.

## Constraints / caveats

All secrets and deployment URLs are operator supplied. The validation harness must detect missing network/configuration prerequisites without leaking them.

## Dependent tasks or work

Depends on the CLI, deployed JSON service, and Drive write proof.

## Likely starting points

- `docs/codex-cloud-preflight.md` — existing Codex cloud environment patterns.
- `google-drive-markdown-gateway-handoff.md` — narrow network and client security requirements.

## Expected change surface

Codex-specific documentation and live harnesses. Existing `AGENTS.md` and core service code remain unchanged.

## Open Questions

None.

