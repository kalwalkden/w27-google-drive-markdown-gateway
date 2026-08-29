# Machine-Readable Diagnostics CLI — References

## Primary edit targets

| Path | Symbol / area | Why it is likely to change |
| --- | --- | --- |
| `src/codex-cli/` (new) | argument parser, credential loader, bounded HTTP client, envelope mapper, executable | The task has no current CLI. This directory owns client-only mechanics and must remain independent of Drive/service modules. |
| `package.json` | `bin.md-drive` and any narrow CLI script metadata | Publishes the compiled Node 24 executable through the existing package/build system. |
| `tests/codex-cli/` (new) | local HTTP and executable contract tests | Verifies wire mapping, strict argument behavior, finite handling, redaction, stdout/stderr, and exit behavior without egress. |

## Entry point and call path

```text
md-drive executable
  -> parse closed argv grammar and fixed help/version
  -> validate HTTPS API origin + load one bounded Codex credential source
  -> optional bounded local Markdown file read
  -> fetch one JSON API route with Bearer header and deadline
  -> stream bounded reply; validate stable envelope
  -> JSON result to stdout / fixed diagnostic to stderr / stable exit code
```

The selected commands map exactly to `GET /v1/markdown/list`, `GET /v1/markdown/search`, `GET /v1/markdown/read`, `POST /v1/markdown/create`, `POST /v1/markdown/update`, and `POST /v1/markdown/archive`.

## Contracts, state, and invariants

- `src/http/json-api.ts` is the binding remote API contract: route names, query/body schemas, success envelope `{ ok: true, operationId, data }`, public failure envelope `{ ok: false, operationId, error: { code, message } }`, response status mapping, and no-store security posture.
- `src/domain/markdown.ts` defines the application DTOs returned in successful `data`: file metadata, document content, opaque file IDs, and opaque revisions. The client must not import it solely to reimplement policy; it may define narrow wire validators based on its stable JSON shapes.
- `src/auth/principal-verifier.ts` supplies the bounded canonical Codex bearer definition and mounted-secret newline normalization. The CLI mirrors its input-safety limits but never verifies against a server secret or imports server authentication composition.
- `package.json` requires Node `>=24 <25`, uses ESM, and builds `src/**/*.ts` to `dist/`; `tsconfig.build.json` already makes a source CLI eligible for compilation.
- Every ordinary invocation has exactly one stdout JSON record. No diagnostics include bearer/token values, secret-file references, endpoint URL, local content/file names, server body, raw response metadata, or thrown error text.
- One command maps to one request. No retries or automatic conflict rereads occur, particularly for create/update/archive.

## Patterns to reuse

| Existing path | Pattern | Applicability |
| --- | --- | --- |
| `src/live-drive/cli.ts` | ESM `main(args, environment)` and executable guard | Reuse the import-safe executable structure and testable `main` seam, not its live Drive behavior. |
| `src/live-drive/http.ts` | `fetch` with `AbortSignal.timeout` | Reuse only the Node 24 deadline approach, adding bounded streaming and no redirects. |
| `src/live-drive/config.ts` | closed argument map / secret-file safety checks | Reuse its fail-closed parsing mindset; do not inherit live-probe confirmation, root restrictions, or OAuth handling. |
| `src/http/json-api.ts` | finite wire-schema/error-envelope approach | Match route names and only its public fixed response vocabulary. |
| `tests/http/json-api.test.ts` | loopback Express fixture plus fake collaborators | Use the same local-only contract-test model; the CLI must not contact any deployed service. |

## Tests and fixtures

- Loopback HTTP test server, injected into the transport/origin seam only; production argv rejects non-HTTPS origins.
- Plain synthetic bearer sentinel and fake secret-reader/file seams. Assert only header presence/authorization shape or use server-side redaction; never retain the sentinel in test snapshots/output.
- Temporary regular, symlink, oversized, and invalid-UTF-8 content fixtures with unique sentinel text. Assert it never appears in error stdout/stderr.
- Route fixture responses for all valid success/failure envelopes and deliberate HTML, malformed JSON, redirect, oversize/chunked, unknown-code, and mismatched-operation cases.
- Request counter fixture proving exactly one request for every transport/timeout/409/write case.

No fixture may contain a real bearer, Google credential, deployed URL, Drive ID, OAuth data, or document content drawn from a real source.

## Expected unchanged boundaries

- `src/http/**`: service route semantics and public error contract remain unchanged.
- `src/application/**`, `src/domain/**`, `src/drive/**`, and `src/write-gate/**`: retain ownership of document and write policy.
- `src/auth/**`: server-side principal verification remains separate from client credential loading.
- `src/live-drive/**` and `tests/live-drive/**`: live capability harness remains untouched and must not run.
- `docs/codex-cloud-preflight.md`, deployment infrastructure, network configuration, secret injection instructions, and `AGENTS.md`: task 002 scope.

## Validation commands

Authoritative sources: `AGENTS.md`, `ARCHITECTURE.md`, and `package.json`.

```bash
CI=true pnpm test -- tests/codex-cli
CI=true pnpm lint
CI=true pnpm format:check
CI=true pnpm typecheck
CI=true pnpm test
CI=true pnpm build
./scripts/verify-vendored-skills.sh
CI=true pnpm check
git diff --check
```

Use focused tests only after they exist. Never run `pnpm drive:probe`, reach the gateway, or use a real mounted/environment secret for this task.

## Selected external material

None. The specification relies on approved in-repository feature/brief decisions and the current implemented JSON API. No external documentation or network guidance was selected during shaping; task 002 separately owns current cloud setup guidance.

## Uncertainties to verify

- Recheck `src/http/json-api.ts` immediately before coding. It is currently the source of truth for all envelopes and public error code/message pairs; do not infer undocumented server behavior.
- Confirm Node 24's streamed `fetch` response/body cancellation behavior in a fake local test so oversized/redirected replies release resources without printing the payload.
- Confirm package-manager bin behavior against the existing ESM output after `pnpm build`; add no global install or cloud setup step in this task.
