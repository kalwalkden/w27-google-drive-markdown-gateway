# Service Config and Principal Verification — References

## Primary edit targets

| Path | Symbol / area | Why it is likely to change |
| --- | --- | --- |
| `src/config/service-config.ts` (new) | `parseServiceConfig`, typed service/secret-reference configuration | Fail-fast strict parsing for non-secret Drive/service data, issuer/JWKS policy, and mounted secret references. |
| `src/auth/principal.ts` (new) | `AuthenticatedPrincipal`, `AuthenticationError`, `PrincipalVerifier` | Establishes the minimal, transport-neutral principal and stable public failure contract. |
| `src/auth/principal-verifier.ts` (new) | strict Bearer parsing, JWT/Codex selection, `createPrincipalVerifier` | Performs configured Work JWT verification and rotating Codex file-backed bearer comparison through injected seams. |
| `tests/config/service-config.test.ts` (new) | parsed configuration cases | Demonstrates closed-schema/fail-fast policy without opening a file or a network connection. |
| `tests/auth/principal-verifier.test.ts` (new) | fake verifier/reader coverage | Tests principal normalization, no-fallback selection, rotation, and redacted stable failures. |
| `tests/auth/import-safety.test.ts` (new) | module side-effect guard | Confirms imports do not read config/secrets, contact JWKS, initialize Google, or mutate Drive. |

`package.json` and `pnpm-lock.yaml` should remain unchanged: the repository already allows `jose`
from `^6.1.3` and currently locks 6.2.10. Add no production authentication dependency unless a final
installed API incompatibility is verified and separately justified.

## Entry point and call path

```text
task 003 deployment config / mounted secrets
  -> parseServiceConfig (new, no I/O)
  -> createPrincipalVerifier (new)
  -> task 002 Express middleware (future)
  -> MarkdownService / future guarded write session (future, unchanged here)
```

The auth boundary precedes all routes. It owns token verification and principal normalization only;
it does not authorize an operation, create an audit event, access Drive, choose a writer, or map an
HTTP response. Task 002 converts the one stable authentication failure to its route response and
uses the normalized principal for audit metadata.

## Contracts, state, and invariants

- `ServiceConfig` is parsed from a caller-supplied unknown value. It contains non-secret values and
  references only, never OAuth/refresh/client secrets, Codex bearer text, JWKS contents, tokens, or
  a Google access token.
- Drive configuration selects exactly one of existing `GoogleDriveAuthConfig` modes:
  `shared-drive-adc` with a Shared Drive ID, or `my-drive-refresh-token` with an OAuth secret-file
  reference. The task does not load that OAuth file or construct the Drive adapter.
- Work authentication config binds an exact HTTPS issuer, exact audience, exact HTTPS JWKS URL, a
  bounded asymmetric algorithm allowlist, and bounded JWKS/time policy. The remote resolver uses
  this static URL only.
- Codex config references a distinct mounted bearer file. The reader is invoked per credential
  verification; successful value comparison is constant-time. A secret file's path/value never
  crosses principal/error contracts.
- `AuthenticatedPrincipal` is `{ kind, subject, issuer }` only. Work `subject` is a verified
  nonempty JWT `sub`; Codex fields are fixed non-secret literals. No raw claims or credentials
  survive the boundary.
- `AuthenticationError` exposes exactly the stable `UNAUTHENTICATED` code/message. Its object,
  `cause`, and serialization must not retain raw provider errors, token strings, paths, URLs, keys,
  or claims.
- A compact JWT shape is Work-only. It never attempts Codex comparison after a JWT failure. A
  dot-free base64url Codex secret is Codex-only and never reaches JWT verification.
- Failed JWT signature, issuer/audience/temporal claim, algorithm/key/JWKS errors and failed/missing
  Codex secrets all deny. No implicit allow, stale-secret cache, issuer discovery, HMAC, or `none`
  algorithm is permitted.

## Patterns to reuse

| Existing path | Pattern | Applicability |
| --- | --- | --- |
| `src/live-drive/config.ts` | Zod `.strict()` schemas and explicit parser functions | Reuse the fail-fast, caller-injected parsing pattern; do not reuse its local secret-file policy or import it into runtime auth. |
| `src/write-gate/gate.ts` | `timingSafeEqual`, bounded inputs, all-or-nothing decisions | Reuse constant-time comparison and failure-collapse discipline without sharing write-gate capability types. |
| `src/write-gate/audit.ts` | allowlisted data with no caller-controlled strings | Future auth/audit output must use the same redaction mindset, while task 002 owns actual audit events. |
| `src/drive/google-drive-auth.ts` | dependency-injected factory and import-safe construction | Keep external-client construction behind a narrow factory; do not acquire tokens during config/auth import. |
| `tests/live-drive/drive-client.test.ts` | capturing fake request/client tests | Use fakes and call counters for request selection; never test against a live endpoint. |
| `tests/write-gate/import-safety.test.ts` | import-only safety assertion | Mirror the side-effect test for config/auth modules. |
| `node_modules/jose/dist/types/{index,jwks/remote,jwt/verify}.d.ts` | installed `jwtVerify` / `createRemoteJWKSet` contracts | Use the already locked library with configured `RemoteJWKSetOptions`; keep all JOSE library types at the auth seam. |

## Tests and fixtures

Create only fake-only tests under `tests/config/` and `tests/auth/`. A fake JWT verifier returns a
minimal verified claim object or throws typed/untyped synthetic errors. A fake secret reader returns
generated in-memory base64url material, a changed value, malformed content, or a rejected promise.
Use call counters to establish which branch executed.

Do not add OAuth JSON, bearer token, PEM/private key, JWKS response, or filesystem secret fixtures.
No test reads an environment variable, opens a configured secret path, calls `fetch`, imports an
issuer, exchanges OAuth credentials, contacts Google Drive, or runs `pnpm drive:probe`.

## Expected unchanged boundaries

- `src/application/**`, `src/domain/**`, `src/drive/**`, `src/live-drive/**`, and `src/write-gate/**`
  remain unchanged for this task. In particular, do not alter the guarded-write task's port/session
  work, capability evidence, or lease behavior.
- `src/index.ts` remains Express scaffolding. Task 002 owns route/middleware composition, request
  schemas, error-envelope/status mapping, limits, audit output, timeouts, and rate limiting.
- Docker, Terraform, Cloud Run environment/mount resources, Secret Manager bindings, service
  identities, deployment instructions, and secret payload creation are task 003 boundaries.
- MCP plugin and Codex CLI/client configuration stay in epics 03 and 04. This task defines a server
  verification boundary only.

## Validation commands

Authoritative commands from `package.json`, `ARCHITECTURE.md`, and `AGENTS.md`:

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

Run focused tests only when their named files exist. The last `pnpm check` is the canonical aggregate
validation and includes the vendored-skill integrity check.

## Selected external material

These immutable IETF publications were selected for this task's security policy. They are not
repository policy beyond the binding decisions in `plan.md`; do not treat an external issuer's
documentation or a moving JWKS endpoint as an unreviewed source of runtime rules.

| Source | Immutable revision / applicability | License / attribution |
| --- | --- | --- |
| [RFC 8725, JSON Web Token Best Current Practices](https://www.rfc-editor.org/rfc/rfc8725.html) | February 2020 BCP 225; algorithm allowlist, issuer/subject/audience validation, cross-JWT confusion defenses, and rejection of token-directed key URLs. | IETF Trust legal provisions; link/cite only. |
| [RFC 7519, JSON Web Token](https://www.rfc-editor.org/rfc/rfc7519.html) | May 2015; registered `iss`, `sub`, `aud`, and temporal claim semantics used by the verifier. | IETF Trust legal provisions; link/cite only. |
| [RFC 7517, JSON Web Key](https://www.rfc-editor.org/rfc/rfc7517.html) | May 2015; JWK/JWKS representation at the configured issuer-key boundary. | IETF Trust legal provisions; link/cite only. |

## Uncertainties to verify

- Before implementation, confirm the final ChatGPT Work issuer profile: exact issuer, expected
  audience, JWKS endpoint, acceptable asymmetric algorithms, and whether it mandates a JWT type or
  additional claims. Populate only deployment configuration; do not encode an unverified platform
  assumption as a default.
- Confirm the locked `jose` 6.2.10 `RemoteJWKSetOptions` names and `jwtVerify` types in the installed
  declarations before writing the factory. Keep library-specific casts confined to the auth module.
- Re-read `01-drive-core/003-guarded-write-and-archive-operations` and any task-002 shaping before
  composition. This task intentionally does not decide which authenticated operations may obtain a
  write session.
