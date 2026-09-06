# JSON API and Redacted Audit Events — References

## Primary edit targets

| Path | Symbol / area | Why it is likely to change |
| --- | --- | --- |
| `src/index.ts` | exported Express composition factory | The current factory is route-free. This task turns it into, or re-exports, injected JSON API composition without starting a listener. |
| `src/http/` (new) | route schemas, principal middleware, error map, limiter/deadline, API factory | Owns HTTP wire validation, lifecycle controls, and delegation only; it must not own Drive/document policy. |
| `src/observability/` (new) | Pino logger factory and allowlisted audit builder | Defines content-free terminal audit records and keeps Pino integration injectable. |
| `src/config/service-config.ts` | strict `http` configuration schema/type | Adds non-secret finite transport limits and relationships needed by the factory. |
| `package.json` / `pnpm-lock.yaml` | `pino` production dependency | Pino is required by the approved task scope and is absent from the current lockfile. |
| `tests/http/` (new) | fake API contract tests | Verifies exact HTTP routes, strict validation, middleware order, stable envelopes, bounds, and default-disabled writes. |
| `tests/observability/` (new) | audit-event tests | Proves terminal event fields and redaction using sentinel content/credential values. |
| `tests/config/service-config.test.ts` | HTTP config parse tests | Extends task 001's no-I/O strict configuration coverage for bounds/cross-field rules. |

Recheck these targets immediately before implementation because the shared tree may advance. The
task deliberately does not name a Google adapter as an edit target: routes only receive
`MarkdownService`/session abstractions.

## Entry point and call path

```text
HTTP request
  -> createJsonApiApp / Express named operation route
  -> completed PrincipalVerifier.verify(Authorization)
  -> request-local principal + bounded limiter
  -> strict Zod query/body parser
  -> MarkdownService list/search/read
     or separately supplied MarkdownWriteSession create/update/archive
  -> selected stable JSON envelope + allowlisted Pino event
```

Write capability remains outside this flow:

```text
operator/deployment-owned WriteGate evaluation and approval
  -> live process-local WriteLease
  -> MarkdownService.openWriteSession(lease)
  -> separately supplied HTTP WriteSessionProvider
  -> session operation
  -> GuardedDriveWritePort.validateLease immediately before raw mutation
```

The HTTP caller cannot provide, inspect, or generate anything in the second flow. The `healthz`
route bypasses both flows and reports only pre-composed application readiness.

## Contracts, state, and invariants

- `PrincipalVerifier` (`src/auth/principal.ts`) accepts one raw Authorization value and returns
  `{ kind, subject, issuer }` or the one stable `AuthenticationError`. The middleware must not
  inspect JWTs, secrets, or raw bearer values itself.
- `MarkdownService` owns `listMarkdown`, `searchMarkdown`, and `readMarkdown`; it is the sole owner
  of path, ID ancestry, Markdown/type, root, result, and content policy. Its read DTOs are the
  success `data` payloads after response-size checking.
- `MarkdownWriteSession` owns the existing mutation DTOs. The write endpoints require a separate
  session; no public DTO contains `WriteLease`. With the default `DisabledDriveWritePort`, a session
  still returns `UNSUPPORTED` and no mutation occurs.
- `GuardedDriveWritePort` validates a private lease immediately before calling its raw port. The
  route must not import the raw port, `WriteGate.evaluate`, evidence, JWS, trust, or replay-store
  modules.
- `ServiceConfig` currently parses strict non-secret Drive/auth values with no I/O. Its new `http`
  section must retain that same caller-injected, fail-fast property and carry only finite limits.
- `GoogleDriveProviderError` carries a safe internal category but its message/status must not cross
  the HTTP envelope or audit record. `OUTSIDE_ROOT` must be rendered as not-found.
- Every protected route response has a generated operation ID. Every recognized API attempt has one
  final audit event made only from allowlisted scalar fields. Markdown content, query/path, revision,
  Authorization, bearer credential, raw claims, and arbitrary error values are prohibited.

## Patterns to reuse

| Existing path | Pattern | Applicability |
| --- | --- | --- |
| `src/auth/principal-verifier.ts` | injected dependencies, strict bearer selection, collapsed failures | Principal middleware should call this once and map only `AuthenticationError`; it must not duplicate verification. |
| `src/config/service-config.ts` | Zod `.strict()` schemas and no-I/O parser | Extend with strict transport limits rather than environment reads or permissive defaults. |
| `src/domain/markdown.ts` | branded opaque IDs/revisions and stable domain errors | Convert validated wire strings at the edge and map codes safely; do not expose error context. |
| `src/application/markdown-service.ts` | one policy-owning application boundary | Route handlers delegate to its established methods and do not reimplement path/Drive policy. |
| `src/drive/guarded-drive-write-port.ts` | default-deny and last-moment lease validation | Preserve the session/lease boundary; authentication does not bypass it. |
| `src/write-gate/audit.ts` | closed allowlist instead of caller-controlled audit strings | Build Pino event data from enum/scalar values only. |
| `tests/auth/principal-verifier.test.ts` | in-memory fakes and call counters | HTTP tests should demonstrate middleware ordering and no fallback/no secret work. |
| `tests/application/markdown-service.test.ts` | deterministic in-memory Drive/service fixture | Reuse only as an API fake backing service/session; do not call real Drive. |
| `tests/drive/guarded-drive-write-port.test.ts` | zero-call default-deny assertions | Mirror this property at HTTP level for a valid principal without a separately supplied session. |

## Tests and fixtures

Use fake-only adapters:

- a fake `PrincipalVerifier` that returns fixed normalized Work/Codex principals or throws a plain
  `AuthenticationError`; it records only that it was called, never an actual bearer;
- an in-memory `MarkdownService` fixture or a narrow fake service/session with counters, stable
  metadata, injected errors, and delayed promises;
- a default-deny and an explicitly supplied fake `WriteSessionProvider`; the latter is the sole
  way write-route success is tested;
- deterministic UUID/clock/deadline/rate-limit seams and a bounded capturing Pino destination;
- sentinel strings for Markdown content, search query, path, revision, and bearer inputs, asserted
  absent from both response errors and serialized logs.

Do not use secret fixture files, real bearer values, real issuer/JWKS URLs, external HTTP, Drive,
ADC/OAuth, the Google SDK, or `pnpm drive:probe`. Tests may exercise the Express application
in-process/local-only, but all collaborators beyond Express are fakes.

## Expected unchanged boundaries

- `src/domain/**`, `src/application/markdown-service.ts`, `src/drive/**`, and
  `src/write-gate/**` retain their document/write authority semantics. In particular, no HTTP code
  gains a raw writer or `WriteGate.evaluate` call.
- `src/live-drive/**`, `tests/live-drive/**`, probe docs/config/results, and all real Drive
  capability evidence remain untouched and must not run.
- No Dockerfile, Terraform, Cloud Run listener/runtime bootstrap, secret mount, service account,
  deployment configuration, MCP transport, plugin package, or Codex CLI belongs in this task.
- No credential, token, JWS, Google OAuth material, secret path/value, document body, or raw audit
  capture is committed.

## Validation commands

The repository authority is `package.json`, `ARCHITECTURE.md`, and `AGENTS.md`:

```bash
CI=true pnpm test -- tests/http
CI=true pnpm test -- tests/observability
CI=true pnpm test -- tests/config/service-config.test.ts
CI=true pnpm lint
CI=true pnpm format:check
CI=true pnpm typecheck
CI=true pnpm test
CI=true pnpm build
./scripts/verify-vendored-skills.sh
CI=true pnpm check
git diff --check
```

Run focused paths only once they exist. `CI=true pnpm check` remains the canonical aggregate check.

## Selected external material

None. This specification relies on the approved repository handoff and completed in-repository
contracts as its binding primary sources. No external network reference was selected during shaping;
the implementation should consult the installed Pino API/types after adding its locked dependency
rather than inventing a logging interface from a moving online document.

## Uncertainties to verify

- Confirm the locked Pino version/API and TypeScript types after dependency resolution; keep all
  Pino-specific configuration inside `src/observability/` and preserve the injected audit seam.
- Confirm the final Express 5 JSON-parser error shape in a focused test. Map it to the fixed
  envelope without serializing its parser error.
- Before implementing deadline behavior, retain the documented limitation that the current service
  and Drive ports have no cancellation signal. Do not claim a timed-out write cannot later settle or
  add an unreviewed retry.
