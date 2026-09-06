# Service Config and Principal Verification — Implementation Plan

## Scope

Add import-safe typed service configuration and a transport-neutral authentication boundary. The
boundary accepts exactly two fixed principals: a Work MCP caller with an externally issued signed
JWT and a Codex caller with a separate bearer credential read from a mounted secret file. It returns
only normalized principal data or one stable, content-free authentication failure.

This task does not add Express routes, middleware installation, HTTP status mapping, audit emission,
Secret Manager/Terraform resources, Google credential acquisition, MCP wiring, authorization roles,
or Drive mutations. Task 002 composes this verifier at the HTTP edge and owns request/audit behavior.
Task 003 supplies Cloud Run secret mounts. No production credential, token, JWKS response, OAuth
exchange, filesystem secret read, or network call is made while shaping or testing this work.

## Binding decisions and constraints

| Decision / constraint | Implementation effect | Provenance |
| --- | --- | --- |
| There are exactly two client principals. | Define `PrincipalKind` as `work-mcp` and `codex`; do not introduce user, role, scope, tenant, or caller-selected principal types. | Task brief; feature requirements; handoff client-authentication section. |
| Work MCP authentication is externally issued JWT verification. | Require a configured HTTPS issuer, JWKS URL, audience, and nonempty asymmetric algorithm allowlist. Verify compact signed JWTs with a resolver created from the configured JWKS URL, exact issuer/audience checks, normal temporal-claim validation, and a required nonempty `sub`. Never trust a decoded payload before verification. | Task brief; RFC 8725 sections 3.1, 3.8–3.12. |
| Key discovery is deployment configuration, never token input. | The JWKS URL is a validated static config value. Never use `jku`, `x5u`, token issuer discovery, or an untrusted header/claim to choose a fetch target. Use the installed `jose` remote-JWKS resolver with explicit timeout/cache options; the production resolver is constructed once and reuses its cache. | RFC 8725 section 3.10; installed `jose` types. |
| Codex uses a separate rotating bearer secret. | The non-secret config contains only `codexBearerSecretFile`; the verifier obtains the current one-line base64url credential through an injected secret reader for each verification. It permits an atomic mounted-secret replacement without code redeploy and keeps the value independent of Work JWT keys/configuration. | Task brief; handoff client-authentication section; task 003 brief. |
| JWT and Codex credentials cannot be confused. | A bearer value with exactly three dot-separated base64url segments is treated only as a Work JWT and never falls back to Codex comparison. A Codex credential must be a bounded base64url string without dots; malformed forms fail closed. Do not accept JWT `alg: none`, HMAC algorithms, or any configured algorithm outside the approved asymmetric set. | RFC 8725 sections 3.1, 3.2, 3.11, 3.12; task brief. |
| The principal contract is deliberately minimal. | Return `{ kind, subject, issuer }` only. For Work, `subject` is verified `sub` and `issuer` is the exact configured/verified `iss`; for Codex, both are fixed non-secret configuration literals (`codex` and `gateway-codex-bearer`). Do not return raw JWT claims, scopes, audience, protected headers, token hashes, or bearer values. | Feature requirement for separate principals; task brief; later audit scope. |
| Authentication failure is stable and redacted. | Every absent/malformed Authorization value, bad token, claim/signature/key failure, JWKS failure, missing/malformed secret, or secret mismatch produces the same `AuthenticationError` with code `UNAUTHENTICATED` and fixed message `Authentication failed.` No wrapped causes, raw headers, URLs, claim values, keys, file paths, or token-derived details are exposed. | Task brief; `AGENTS.md`; handoff security/logging constraints. |
| Constant-time secret comparison is required. | Compare equal-length UTF-8 bearer bytes with `timingSafeEqual`; a length mismatch is an authentication failure. Do not normalize a caller token beyond strict Bearer parsing. Secret-file parsing may remove one terminal LF/CRLF so a mounted text secret is usable, then rejects whitespace/control characters and invalid length/encoding. | Task brief rotation/fail-closed requirement; Node crypto pattern in `src/write-gate/gate.ts`. |
| Non-secret configuration must fail before service composition. | Parse one strict JSON-like object synchronously with Zod. Reject unknown keys, empty IDs/URLs/audiences, non-HTTPS issuer/JWKS URLs, URL credentials/fragments, duplicate or unsupported algorithms, invalid numeric limits, unsupported Drive auth-mode/topology combinations, and missing/extra secret-file references. Parsing config never opens files, exchanges a token, fetches JWKS, or initializes Drive. | Task objective; `src/live-drive/config.ts`; task 003 deployment requirement. |
| Secret references are paths, not values. | Type the two credential sources as explicit file references: My Drive OAuth JSON file only for `my-drive-refresh-token`, and Codex bearer file always. Preserve the existing live-probe loader untouched; service runtime resolution is a new injectable seam that accepts Cloud Run mounted-secret paths, including mount-managed symlinks. Paths must never be returned by auth errors or audit contracts. | Task objective; task 003 brief; existing `src/live-drive/config.ts` is harness-only. |
| Routine tests are fake-only. | Inject JWT verification and secret reading. Tests use generated in-memory fake values and resolvers, never environment variables, mounted files, real issuer/JWKS requests, OAuth/ADC, Drive, or a static token/secret fixture. | Task brief; `AGENTS.md`; existing fake-first test conventions. |

## Visual design

No visual design applies. This task supplies server-side contracts only. The approved feature-level
design source is `02-authenticated-service-api/feature.md`; it introduces no additional visual
requirements.

## Current-tree alignment

`package.json` already allows `jose` from `^6.1.3`, currently locked at 6.2.10, and its installed
type declarations export `jwtVerify` and `createRemoteJWKSet`; do not add a second JWT library. `src/live-drive/config.ts`
and `src/live-drive/auth.ts` are an opt-in capability harness that reads a local OAuth file under
different restrictions. They are not service runtime configuration and must remain unchanged.

The committed Drive core currently exposes direct write methods on `DrivePort` and
`MarkdownService`. The in-progress `01-drive-core/003-guarded-write-and-archive-operations` task
will replace that with a guarded write-session composition. Do not edit Drive/domain/application or
write-gate files here. This task's configuration may carry non-secret Drive facts and file
references, but it must not construct a writer, evaluate a `WriteGate`, load evidence/approval
files, or make a Drive call. Re-read the final Drive task before task 002 composes the service.

## Detailed implementation approach

### 1. Define strict parsed configuration without secret values

Create `src/config/service-config.ts` with a strict Zod schema and exported parsed types. Keep the
configuration input explicitly injectable (`parseServiceConfig(input: unknown)`); do not make an
environment/global configuration read at module import. The eventual container composition decides
where the non-secret JSON comes from.

The parsed shape should cover the already-approved service boundaries:

```text
service
  drive
    rootFolderId, archiveFolderId, maxMarkdownBytes, traversal/result limits
    shared-drive-adc: sharedDriveId; no OAuth file reference
    my-drive-refresh-token: oauthSecretFile; no sharedDriveId
  authentication
    workMcp: issuer, audience, jwksUrl, allowedAlgorithms,
             clockToleranceSeconds, jwksTimeoutMs, jwksCacheMaxAgeMs
    codex: bearerSecretFile
```

Use opaque `FolderId` conversion only after structural validation. Require a valid absolute HTTPS
URL for issuer and JWKS URL, reject a URL username/password, hash, or query, preserve the original
validated issuer string for exact issuer matching, and require `issuer` and `jwksUrl` to be different
configuration values. Keep `audience` as a nonempty opaque string rather than deriving it from a
host. The algorithm array must be unique and limited to `RS256`, `PS256`, `ES256`, `ES384`, or
`EdDSA`; no default and no symmetric algorithms. Bound timing/JWKS values conservatively and expose
them as validated values rather than request inputs.

Require absolute nonempty secret-file paths and reject NUL. Configuration parsing stores a branded
reference/path only; it never logs, reads, stat-checks, resolves, or validates file contents. For
My Drive, the OAuth JSON reference feeds later server-side Drive composition; for ADC it is forbidden.
For Codex it always identifies the separate bearer secret. Do not add example secret files or embed
secret-looking sample values in configuration.

### 2. Define a small principal and failure boundary

Create `src/auth/principal.ts` (or equivalently focused `src/auth/authentication.ts`) containing:

- a discriminated `AuthenticatedPrincipal` with `kind: "work-mcp" | "codex"`, byte-bounded,
  nonempty, control-free opaque `subject`, and nonempty opaque `issuer`;
- `AuthenticationError`, whose public properties are only the stable code/message above; and
- a narrow `PrincipalVerifier` interface accepting one raw Authorization value and resolving an
  `AuthenticatedPrincipal` or rejecting with `AuthenticationError`.

Keep HTTP request/response objects, Express types, logger/audit types, authorization roles, and
Google credentials out of this module. The later transport receives the principal and owns its
request lifecycle/audit event. Ensure imports have no config, file, token, network, or crypto work.

### 3. Implement exact bearer selection and Work JWT verification

Create `src/auth/principal-verifier.ts` with explicit dependency interfaces such as a JWT-verifier
function and `readTextFile(reference)`. Its production factory receives parsed `ServiceConfig`,
constructs exactly one `createRemoteJWKSet(new URL(config.authentication.workMcp.jwksUrl), options)`
resolver, and calls `jwtVerify` with the configured issuer, audience, algorithms, and clock
tolerance. The remote resolver must use only the configured URL and bounded timeout/cache values.

Accept exactly one case-insensitive `Bearer` scheme followed by one nonempty visible token; reject
arrays, commas, repeated scheme/value, other schemes, whitespace/control characters, and anything
outside the bounded token size. Do not decode or inspect a JWT for routing beyond the compact-token
shape. A three-segment token is Work-only: invoke the injected/configured JWT verifier, require an
exact verified issuer and a byte-bounded, nonempty, control-free string `sub`, then return `work-mcp`.
Any verification error is intentionally collapsed.

For a non-JWT-shaped Bearer value, resolve the Codex secret through the injected reader at the time
of comparison. Read at most the configured small secret-file bound; accept exactly one normalized
base64url credential and compare it in constant time. A read/parse error, token mismatch, or
unexpected secret shape rejects as the same authentication failure. Return the fixed Codex principal
only after comparison succeeds. Never retry either verifier under a different principal, persist a
secret/JWT, add a cache that delays secret rotation, or forward either value to Google.

The production resolver may perform JWKS retrieval only when it needs a key; a failure (including
timeout, key rotation race, malformed key set, or unavailable network) fails closed as
`UNAUTHENTICATED`. The implementation must not expose a token-dependent distinction. Tests cover
that outcome through injected failures rather than remote fetches.

### 4. Keep configuration-to-auth composition narrow

Optionally add a small `createPrincipalVerifier(config, dependencies?)` factory that consumes only
the authentication subsection plus the injected secret reader/JWT verifier factory. Do not modify
`src/index.ts`: the current `createApp()` remains transport scaffolding and task 002 owns real
composition/middleware. Do not yet construct `GoogleDriveReadAdapter`, `MarkdownService`, or any
write-session/gate from service configuration.

The factory must provide a test-only dependency injection route that cannot silently select a fake
in production. A caller which does not supply overrides uses the `jose` resolver and Node
`fs/promises.readFile`; tests pass a fake reader/verifier. Do not add an in-memory accepted-token
mode, environment-token fallback, or configuration field that carries a bearer value.

## Expected flow and invariants

```text
deployment-owned non-secret config
  -> parseServiceConfig (strict, no I/O)
  -> createPrincipalVerifier (one configured JWKS resolver + secret-file reader)
  -> future HTTP/MCP transport provides one Authorization value
      -> strict Bearer parser
          -> three JWT segments: configured issuer/JWKS/audience verification
              -> { kind: work-mcp, subject: verified sub, issuer: configured iss }
          -> otherwise: current Codex secret-file read + constant-time compare
              -> { kind: codex, subject: codex, issuer: gateway-codex-bearer }
          -> all failures: stable AuthenticationError(UNAUTHENTICATED)
```

- No principal is inferred from a request path, content, Drive ID, user-supplied issuer, `kid`,
  `jku`, `x5u`, or unverified claim.
- A token intended for Work cannot fall back to Codex bearer verification; Codex's dot-free secret
  cannot become a JWT.
- Only verified `sub` crosses the boundary for Work. Principal data is sufficient for future audit
  attribution but carries no credential/token/claim payload.
- Incorrect configuration halts composition; invalid runtime credentials fail closed per request.
- Secret rotation is per-principal: Work keys rotate at its configured JWKS; Codex reads its separate
  mounted credential on each check. Neither operation changes Google authentication.
- Authentication errors and thrown causes are content- and secret-free, and retain no raw token.

## Test strategy

All tests are unit tests with injected fakes. They do not call `fetch`, `createRemoteJWKSet`, Drive,
ADC, OAuth, an issuer, filesystem secret paths, or environment configuration.

| Test area | Required cases |
| --- | --- |
| `tests/config/service-config.test.ts` | valid Shared Drive ADC and My Drive reference shapes; strict unknown-key rejection; required/forbidden per-mode fields; root/archive mismatch; invalid IDs/limits; non-HTTPS/credentialed/fragment/query issuer or JWKS URL; invalid/duplicate/symmetric algorithms; invalid secret references. Assert parsing performed no I/O. |
| `tests/auth/principal-verifier.test.ts` | missing/malformed/duplicated/oversized Authorization fails with only the stable error; exact Bearer parsing; a fake verified JWT produces only the Work principal; missing `sub`, invalid issuer/audience/algorithm/time/signature/key errors collapse; JWT-shaped input never calls the Codex reader; non-JWT input never calls the JWT verifier. |
| `tests/auth/principal-verifier.test.ts` | generated in-memory Codex secret accepts only exact byte match; mismatch/length mismatch/read failure/malformed secret all have the same public failure; reader is called per verification so a changed fake value rotates; no test fixture file or static token-shaped secret is added. |
| import-safety test | importing config/auth modules causes no file, environment, network, crypto-verification, JWKS, Google, or Drive work. |
| regression checks | serialized error/principal output contains neither an Authorization value, token-like string, JWKS URL, secret file reference, arbitrary JWT claim, nor thrown provider error. |

Use call counters and ordered fake events to prove principal selection. Generate each Codex credential in test setup (for example, deterministic byte arrays encoded at runtime) and keep it in memory; fixtures may contain only non-secret configuration and public test keys when direct JWT-library verification is useful. Do not use a real issuer or remote JWKS even for a focused test.

## Exact validation

```bash
CI=true pnpm test -- tests/config/service-config.test.ts
CI=true pnpm test -- tests/auth/principal-verifier.test.ts
CI=true pnpm test -- tests/auth/import-safety.test.ts
CI=true pnpm lint
CI=true pnpm format:check
CI=true pnpm typecheck
CI=true pnpm test
CI=true pnpm build
./scripts/verify-vendored-skills.sh
CI=true pnpm check
git diff --check
```

Run only focused file names that exist, then the full suite. Inspect the final diff for token-shaped
strings, real secret paths/values, logs of Authorization or claims, issuer/JWKS URLs sourced from a
token, an `alg: none`/HMAC fallback, unbounded remote fetches, Drive calls, changes to the
in-progress guarded-write task, and any secret fixture. Never run the live Drive probe or contact an
OAuth/JWKS endpoint as part of this task.

## Risks and careful checks

- The external Work issuer/profile is deployment-selected. Require its issuer, audience, JWKS URL,
  and accepted asymmetric algorithms explicitly; do not assume an OpenID discovery URL or a ChatGPT
  token profile. If the actual platform requires extra claims or a JWT type, add them as a reviewed
  config-bound validation rule before deployment rather than accepting them implicitly.
- A remote JWKS outage looks deliberately identical to a bad credential at this boundary. Future
  observability may record an allowlisted internal outcome, but must not change the public error or
  log raw provider details.
- Mounted Secret Manager files can be symlinks as part of supported rotation. Do not reuse the live
  harness's owner/mode/no-symlink policy, which is for a local operator credential outside the repo.
  Container/IAM ownership is task 003's concern.
- Re-read `01-drive-core/003-guarded-write-and-archive-operations` outputs before the HTTP
  composition task. This spec must not preserve the current unguarded Drive write surface or create
  an auth-to-write bypass.

## Open questions

None. The issuer/audience/JWKS URL/algorithm set and mounted file paths are explicit operator
configuration values, not repository defaults.
