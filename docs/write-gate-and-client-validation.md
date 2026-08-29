# Deployment-owned write authority and client validation

Runtime write authority is deployment-owned. A revision can compose the server-side Drive writer
only when `enable_write=true` and the separate `acknowledge_write_risk=true` Terraform input is
reviewed. Both values default to false; omission produces a read-only runtime. The acknowledgement
is not passed to the service, and neither setting proves live Drive access or authorizes a client.

## Release evidence and enablement

1. Run the dedicated-folder experiment in
   [live-drive-capability-harness.md](live-drive-capability-harness.md). Keep sanitized output
   outside this repository.
2. Review supported results, stale-write behavior, archival cleanup, selected Drive identity, and
   dedicated root/archive topology as operator release evidence.
3. Review a Terraform plan with both write inputs explicitly true only when a deployment is meant
   to compose a server-side writer. Shared Drive ACLs are operator-owned. My Drive OAuth grants can
   be broader than the configured root, so application confinement and this residual risk require
   explicit review.
4. The capability harness and its evidence never enter runtime configuration, request
   authorization, writer construction, or a client session.

Work JWTs and Codex bearer credentials authenticate only to the gateway. Neither is a Google
credential or is forwarded to Drive. Only the selected server-side Google identity obtains the
read-only or write scope. Do not log credentials, tokens, headers, paths, revisions, evidence, or
document bodies.

## Later client release records

The record at [client-validation-record.example.json](client-validation-record.example.json) is a
synthetic template. It is release evidence only and has no runtime-authority effect.

For ChatGPT Work, record the private plugin build and exact `/mcp` endpoint identifiers, OAuth issuer,
audience, redirect URI and JWKS key identifiers, the scoped Work principal identifier, a successful
read test, and the expected `UNSUPPORTED` result for create, update, and archive while production
has no write session. Archive success remains blocked until atomic destination-topology proof and a
separately approved production write composition. Validate OAuth/JWT configuration with the actual
private plugin only after deployment; retain identifiers and digests, never tokens, JWTs, cookies,
authorization codes, URLs containing query strings, or secret locations.

For Codex cloud, record the environment/revision identifier, exact gateway-hostname identifier,
the narrow methods needed by the client, separate principal key identifier, health/read tests, and
an expected denied write test while transport sessions remain withheld. Confirm the cloud environment's network policy
allows only the exact gateway hostname and required methods. Do not use an unrestricted internet
allowlist or place Google credentials in Codex.
