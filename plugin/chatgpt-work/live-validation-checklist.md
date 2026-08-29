# Operator-only private Work validation

Do not run this checklist until the current tenant profile, deployed HTTPS MCP
origin, dedicated Markdown test root, archive destination, and cleanup owner
are known. Keep the unique fixture name, document body, endpoint URL, headers,
tokens, screenshots, and raw transcript outside Git.

## Preflight

- Start a fresh private Work session using the exact recorded private-plugin
  build and a scoped Work identity.
- Confirm the operator-entered issuer, audience, JWKS URL/key identifier,
  allowed algorithms, and principal match the deployment-owned `workMcp`
  configuration. Never paste a JWT or secret into package fields.
- Confirm the adapter presents exactly the six expected tools and the gateway
  write gate remains independently fail closed.

## Fixture and operations

Within the already approved dedicated root, choose one unique disposable
Markdown fixture. Record an opaque fixture identifier/digest outside source
control, then perform and record factual outcomes for:

1. `list_markdown`, `search_markdown`, and `read_markdown`.
2. `create_markdown`, followed by `read_markdown`; retain that returned
   revision.
3. `update_markdown` with the retained revision, then `read_markdown` again.
4. One stale `update_markdown` using the old revision. `CONFLICT` is expected:
   stop and reread; do not retry or overwrite.
5. `archive_markdown` using the current expected revision only after explicit
   archive intent. Verify the archived outcome by read/list behavior.

Record the platform's observed write path as `passed`, `denied-as-expected`,
`blocked-by-platform`, or `not-run`, with factual notes only. An absent
gateway lease may produce an expected denial; it is not permission to bypass
the gate, and an unobserved UI prompt is not a pass.

## Cleanup and incomplete runs

Finish by archiving only that exact unique fixture through
`archive_markdown`. Never delete, trash, share, or broad-cleanup by a path or
name pattern. If the run stops before archive, mark cleanup `incomplete`, give
the designated cleanup owner only the bounded unique fixture reference outside
Git, and do not mark release evidence complete.
