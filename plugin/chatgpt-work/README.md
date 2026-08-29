# Private ChatGPT Work package — operator guide

This directory is a secret-free preparation package, not a portable Work
manifest or a tenant configuration. ChatGPT Work private-plugin metadata and
authentication requirements are tenant and platform-version specific. Before
installation, the operator must select the tenant-supported private-plugin
format, record its revision/build identifier outside Git, and transcribe only
the required fields into the Work administration surface.

Use [private-package.template.json](private-package.template.json) as a closed
input checklist, not as a file to upload. Its `.invalid` origin and all
`example-*` identifiers are placeholders. Do not replace them in Git. The
selected registration must point to the deployed stateless HTTPS MCP endpoint
at the exact `/mcp` path, for example the synthetic
`https://gateway.invalid/mcp` template value. It is not a JSON API endpoint.
Reject endpoints with credentials, query strings, or fragments.

## Before private installation

1. Confirm the exact current tenant format, remote MCP transport requirements,
   allowed origin/header rules, OAuth/JWT registration requirements, claim
   mapping, signing algorithms, and redirect URI. Do not infer these values
   from this repository.
2. Confirm the deployed service's `authentication.workMcp` issuer, audience,
   JWKS URL, allowed algorithms, and verification bounds match the
   operator-entered tenant values. The server-side `PrincipalVerifier` remains
   the only JWT verification and Work-principal boundary.
3. Confirm task 001's stateless MCP adapter exposes exactly the six tools in
   the template and accepts only a normalized `work-mcp` principal.
4. Keep all real tenant values outside Git: URLs, tokens, JWTs, cookies,
   authorization codes, client secrets, private keys, Google credentials,
   Codex credentials, gateway secret references, and raw transcripts.
5. Confirm gateway writes remain independently fail closed. Installation,
   private-plugin metadata, user consent, and validation evidence never issue a
   deployment write authority or bypass its default-disabled boundary.

The current production composition deliberately supplies no write session.
`create_markdown`, `update_markdown`, and `archive_markdown` therefore each
return `UNSUPPORTED`; a Work package must record that result as expected and
must not attempt a workaround. Archive success remains blocked until a future,
separately approved production write composition can atomically prove the
destination topology.

Read [instructions.md](instructions.md) into the selected platform's supported
instruction field only after its format is verified. Do not add tools, direct
Drive access, a REST fallback, a credential field, or a client-side JWT parser.

## Operator-only live validation

Use [live-validation-checklist.md](live-validation-checklist.md) after the
gateway is deployed and a private Work session is available. It is deliberately
manual and must not be run by tests, builds, setup scripts, or an agent. Record
only sanitised evidence using
[release-evidence.template.json](release-evidence.template.json). That record
is release evidence, never a runtime-authority input.
