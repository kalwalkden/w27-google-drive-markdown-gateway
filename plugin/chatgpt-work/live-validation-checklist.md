# Operator-only private Work validation

Do not run this checklist until the current tenant profile and deployed HTTPS
MCP endpoint at the exact `/mcp` path are known. Keep the endpoint URL,
headers, tokens, screenshots, and raw transcript outside Git. The synthetic
template endpoint is `https://gateway.invalid/mcp`; never use it as a live
endpoint.

## Preflight

- Start a fresh private Work session using the exact recorded private-plugin
  build and a scoped Work identity.
- Confirm the operator-entered issuer, audience, JWKS URL/key identifier,
  allowed algorithms, and principal match the deployment-owned `workMcp`
  configuration. Never paste a JWT or secret into package fields.
- Confirm the adapter presents exactly the six expected tools and the gateway
  deployment write mode remains default-disabled. The current production runtime
  has no write session, so every create, update, and archive request must
  return `UNSUPPORTED`.

## Fixture and operations

Within the already approved dedicated root, select an existing disposable
Markdown fixture. Record an opaque fixture identifier/digest outside source
control, then perform and record factual outcomes for:

1. `list_markdown`, `search_markdown`, and `read_markdown`.
2. `create_markdown`, `update_markdown`, and `archive_markdown` only if the
   operator has explicit approval to observe the current fail-closed response.
   Each must return `UNSUPPORTED`; do not retry, bypass, or create a cleanup
   fixture.

Record the platform's observed write path as `denied-as-expected`,
`blocked-by-platform`, or `not-run`, with factual notes only. An absent
gateway write session is an expected `UNSUPPORTED`, not permission to bypass
the gate, and an unobserved UI prompt is not a pass.

## Cleanup and incomplete runs

No archive cleanup is available in current production. Never delete, trash,
share, create a cleanup fixture, or broad-cleanup by a path or name pattern.
Archive success remains BLOCKED until atomic destination-topology proof and a
separately approved production write composition exist. Record cleanup as
`not-applicable` and do not mark a future mutation release complete.
