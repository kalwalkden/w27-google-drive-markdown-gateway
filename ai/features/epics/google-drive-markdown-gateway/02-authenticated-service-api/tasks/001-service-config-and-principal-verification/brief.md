# Service Config and Principal Verification

## Status

Approved

## Context

The gateway must distinguish a Work MCP caller from a Codex caller while keeping all Google credentials server-side.

## Objective

Add typed service configuration and an authentication boundary that verifies external OAuth 2.1 JWT issuer tokens and a separately rotated Codex bearer credential.

## Scope

Define fail-fast non-secret config, secret-file references, principal identity/claims, issuer/JWKS validation policy, Codex credential verification, and redacted authentication errors with unit coverage.

## Non-goals / later

No HTTP route behavior, MCP transport, Secret Manager resource provisioning, or authorization roles beyond the two fixed principals.

## Constraints / caveats

Never accept a gateway credential as Google credential. Do not place secrets in fixtures. Secret rotation needs independent per-principal values and fail-closed invalid-token handling.

## Dependent tasks or work

Depends on Drive Core contracts and platform proof-state conventions.

## Likely starting points

- `google-drive-markdown-gateway-handoff.md` — client authentication and rotation requirements.

## Expected change surface

New `src/config/` and `src/auth/` boundaries with unit tests. Drive business behavior remains unchanged.

## Open Questions

None.

