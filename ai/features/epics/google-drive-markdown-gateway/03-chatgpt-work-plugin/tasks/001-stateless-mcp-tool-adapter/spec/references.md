# Stateless MCP Tool Adapter — References

## Primary edit targets

| Path | Symbol / area | Why it is likely to change |
| --- | --- | --- |
| `package.json` / `pnpm-lock.yaml` | selected official `@modelcontextprotocol/sdk` dependency | The SDK is not currently declared or locked; add only the official TypeScript SDK after API/version inspection. |
| `src/mcp/` (new) | stateless Streamable HTTP adapter, six tool schemas/results, safe error mapper | New transport owns MCP protocol wiring and delegation only. |
| `src/index.ts` | MCP factory/export or final shared composition seam | Current index re-exports JSON composition; expose the MCP injection seam without starting a listener or disrupting JSON. |
| `src/auth/principal.ts` / `src/auth/principal-verifier.ts` | `PrincipalVerifier`, `AuthenticatedPrincipal` | Reuse, never duplicate, the sole auth/principal normalization boundary. |
| `src/application/markdown-service.ts` | read methods and `MarkdownWriteSession` | The one application policy surface invoked by tools. |
| `src/http/json-api.ts` (concurrent work; inspect before changing) | `WriteSessionProvider`, public error vocabulary, dependency pattern | Supporting evidence only; extract a helper only when it is demonstrably transport-neutral and preserves concurrent ownership. |
| `src/observability/audit.ts` (concurrent work; inspect before changing) | allowlisted audit types/logger seam | Reuse or narrowly extend only after confirming its final owner/contract. |
| `tests/mcp/` (new) | protocol, schema, error, statelessness, and JSON-parity tests | Verifies real SDK transport behavior with fakes and no external calls. |

## Entry point and call path

```text
Work HTTPS MCP request
  -> mounted Streamable HTTP MCP route
  -> PrincipalVerifier.verify(one Authorization value)
  -> normalized work-mcp principal only
  -> official SDK validates/dispatches one of six tools
  -> MarkdownService list/search/read
     or injected MarkdownWriteSession create/update/archive
  -> safe MCP content + structured output / tool error
```

## Contracts, state, and invariants

- `PrincipalVerifier` returns only `{ kind, subject, issuer }` or `AuthenticationError`. MCP code
  must call it once and must neither decode a JWT nor read a Codex secret. A `codex` principal is
  not valid for this Work-only endpoint.
- `MarkdownService` owns all document and Drive policy. Its `listMarkdown`, `searchMarkdown`, and
  `readMarkdown` methods are the read surface. `MarkdownWriteSession` owns the three mutations.
- A `WriteLease` is private to the write-gate/guarded-writer chain. The MCP dependency boundary
  obtains at most a pre-opened session; it cannot inspect, construct, log, or serialize a lease.
- Domain DTOs and opaque brands live in `src/domain/markdown.ts`; MCP accepts validated strings then
  brands IDs/revisions only at the adapter edge.
- `GoogleDriveProviderError` is a provider boundary error; its detail cannot be an MCP result.
- The adapter is stateless: no transport session persistence, cookies, read cache, principal cache,
  resume store, or server-to-client requests. SDK-required ephemeral state ends with the request.

## Patterns to reuse

| Existing path | Pattern | Applicability |
| --- | --- | --- |
| `src/http/json-api.ts` | strict Zod wire schemas, finite bounds, stable public errors, injected session | Match semantics, not its HTTP routes or Express parser implementation. |
| `src/auth/principal-verifier.ts` | injected verifier, strict bearer selection, failure collapse | MCP middleware calls this boundary rather than duplicating issuer/JWKS logic. |
| `src/application/markdown-service.ts` | one policy-owning service plus optional `MarkdownWriteSession` | Tool handlers delegate once and do no Drive/path enforcement. |
| `src/drive/guarded-drive-write-port.ts` | default deny and last-moment lease validation | Ensure MCP cannot bypass it through an auth or tool input path. |
| `src/observability/audit.ts` | constructed, allowlisted event payloads | If audit is shared, never pass protocol request/result/error objects to Pino. |
| `tests/application/markdown-service.test.ts` | deterministic in-memory service setup | Reuse fixture facts/expected outcomes, not raw Drive behavior. |
| `tests/auth/principal-verifier.test.ts` | fake verifier/call counters/redaction sentinels | Prove auth ordering and no credential propagation. |

## Tests and fixtures

- New tests should use the selected SDK's supported local/in-process client or HTTP fixture so they
  cover its actual Streamable HTTP handler, not a hand-built approximation.
- Use fakes for principal verification, service/session methods, audit, time, IDs, and any endpoint
  wrapper. Give them counters and deterministic results/errors.
- Use sentinel values for Markdown content, path, query, revision, bearer, issuer, and credentials;
  assert they never cross errors or audit events.
- Cover all six successful outcomes, input/schema rejection, authentication/non-Work refusal,
  default-disabled writes, conflict/no-retry, archive-as-move, safe provider/unknown mapping, and
  concurrent-request isolation.
- No test may access Google Drive, Google OAuth/ADC, a secret file, a remote issuer/JWKS, a live
  Work tenant, external HTTP, or the live Drive capability harness.

## Expected unchanged boundaries

- Drive/domain/application policy and provider adapters: `src/domain/**`,
  `src/application/markdown-service.ts`, and `src/drive/**`.
- Write-gate/lease implementation: `src/write-gate/**`.
- Live Drive probe and its evidence/docs: `src/live-drive/**`, `tests/live-drive/**`, and
  `pnpm drive:probe`.
- Cloud Run listener/container/Terraform, secret mounts, plugin package/install metadata, and live
  Work validation. These belong to adjacent/later approved tasks.
- Feature-wide task lists, statuses, build logs, and all unrelated concurrent work.

## Validation commands

Authoritative project commands come from `package.json`, `ARCHITECTURE.md`, and `AGENTS.md`:

```bash
CI=true pnpm test -- tests/mcp
CI=true pnpm lint
CI=true pnpm format:check
CI=true pnpm typecheck
CI=true pnpm test
CI=true pnpm build
./scripts/verify-vendored-skills.sh
CI=true pnpm check
git diff --check
```

## Selected external material

None. The product handoff requires the official TypeScript MCP SDK, but the repository has not
selected or locked a version and this shaping pass did not promote moving online documentation to
repository policy. Before implementation, record the selected locked package version and inspect
its installed declarations; task 002 will separately verify the current Work platform profile.

## Uncertainties to verify

- The exact official SDK version, import paths, Streamable HTTP stateless handler API, Zod v4
  compatibility, output-schema/error semantics, tool annotations, and concurrency behavior.
- The final ChatGPT Work issuer/audience/JWKS/claim profile and private-install endpoint discovery
  requirements; no value is safe to invent from this repository.
- Final shared JSON/API exports after concurrent task-002 implementation settles, especially the
  write-session and audit seams.
- Whether official transport behavior permits the planned structured success/error output exactly;
  validate it by contract test and retain safe text errors if it does not.
