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
- Confirm the adapter presents exactly the six expected tools. Do not begin a
  client check until the marked dedicated root/direct-child archive, provider
  probe, reviewed Terraform plan, and controlled image/config digest gates are
  satisfied. A default-disabled deployment returns `UNSUPPORTED` and ends the
  check without a later mutation.

## Fixture and operations

Within the already approved dedicated root, use one pre-provisioned nested
disposable validation folder. Keep its location, IDs, revisions, endpoint,
headers, screenshots, and transcript outside source control. Perform and record
only sanitised factual outcomes for:

1. Nested `list_markdown`, scoped `search_markdown`, and `read_markdown`.
2. One UUID-derived nested `create_markdown`, duplicate refusal, readback,
   exact-revision update, stale-revision `CONFLICT`, and final readback.
3. One explicit `archive_markdown` after verified identity/revision; verify the
   same identity is at the configured archive location.

On `CONFLICT`, reread and wait for a choice. On `OUTCOME_UNKNOWN`, timeout, or
transport uncertainty after a possible mutation, stop immediately: no retry,
reread automation, archive cleanup, delete, trash, or broad cleanup. Record an
inconclusive result and the fixed manual reread/reconcile direction only.

## Cleanup and incomplete runs

The sole cleanup is this one verified archive. Never delete, trash, share,
rename, create folders, or broad-cleanup by a path/name pattern. Evidence is a
human release input only; it never enables write mode or claims a live success.
