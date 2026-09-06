# Live Drive Capability Harness — References

## Primary edit targets

No harness source, Drive client, credential loader, live config, evidence schema, or relevant tests
exist in the current tree. The likely implementation surface is:

| Path | Symbol / area | Why it is likely to change |
| --- | --- | --- |
| `package.json` | dependencies and `drive:probe` script | Add Google auth, config validation, and a manual built-CLI entry without adding live execution to `check`. |
| `pnpm-lock.yaml` | resolved dependency graph | Regenerate after manifest changes; do not hand edit. |
| `src/live-drive/config.ts` | `LiveDriveProbeConfig`, secret schema, root marker constant | New strict config and secret-file boundary. |
| `src/live-drive/auth.ts` | `AccessTokenProvider`, ADC and refresh-token providers | New credential-mode seam that returns in-memory access tokens only. |
| `src/live-drive/http.ts` | `HttpTransport`, `FetchHttpTransport`, raw request/response types | New injectable transport preserving raw headers and enforcing timeouts/no retries. |
| `src/live-drive/drive-client.ts` | `RawDriveClient` | New minimal Drive v3 request builder for get/create/update/download/move only. |
| `src/live-drive/probe.ts` | `runLiveDriveCapabilityProbe` | New two-actor orchestration and mandatory cleanup owner. |
| `src/live-drive/evidence.ts` | evidence schema, opaque-reference/redaction serializer | New sanitized machine-record contract and atomic writer. |
| `src/live-drive/cli.ts` | direct-execution CLI | New explicit opt-in entry, signal handling, exit mapping, and content-free operator output. |
| `config/live-drive-probe.example.json` | secret-free configuration example | New placeholder-only config; never contains usable folder IDs or credential values. |
| `docs/live-drive-capability-harness.md` | setup/runbook | New ADC, My Drive secret-file, marker, execution, interpretation, and recovery instructions. |
| `docs/live-drive-capability-evidence.example.json` | sanitized result template | New checked-in shape example with fake identifiers/ETags only, clearly not a passed result. |
| `tests/live-drive/*.test.ts` | config/auth/HTTP/probe/evidence unit tests | New fake-only tests for success, unsupported behavior, redaction, and cleanup. |
| `.gitignore` | local live-probe artifacts | Add narrowly named local config/result patterns if implementation permits repository-adjacent temporary files; the CLI should still require its output outside the repo. |

The proposed new paths must be verified immediately before implementation. If the implementer uses
a smaller file split, preserve the named seams and ownership rather than the exact module count.

## Entry point and call path

Current product code has only this path:

`tests/index.test.ts` → `createApp` in `src/index.ts` → fresh Express application

It performs no configuration or external I/O and is not a harness integration point.

The new manual path should be:

`built src/live-drive/cli.ts` → config/auth construction → root/archive preflight → two injected
`RawDriveClient` actors → `runLiveDriveCapabilityProbe` → `finally` archive → evidence serializer →
operator-supplied external output file

The unit-test path should be:

`tests/live-drive/*.test.ts` → scripted `AccessTokenProvider` + `HttpTransport` → probe/config/evidence
modules

No unit-test path reaches ADC, the OAuth token endpoint, DNS, or Drive.

## Contracts, state, and invariants

- `LiveDriveProbeConfig`: secret-free, closed schema; auth mode, root ID, archive ID, bounded timeout.
- `OAuthSecret`: closed in-memory schema loaded only from a protected external file.
- `AccessTokenProvider`: authentication seam; callers cannot inspect underlying credential objects.
- `HttpTransport`: exact request/response seam; preserves raw status and headers, accepts abort
  signal, and has no implicit retry.
- `RawDriveClient`: only Drive request construction/parsing; must add `supportsAllDrives=true`, hide
  authorization, and never retain document content.
- `DriveSnapshot`: exact raw ETag plus allowlisted file metadata, HMAC opaque parent/file refs,
  `payloadSha256`, and `payloadByteLength`.
- `CapabilityOutcome`: `SUPPORTED | UNSUPPORTED | INCONCLUSIVE`; no truthy boolean shortcut.
- `CleanupStatus`: `ARCHIVED | ALREADY_ARCHIVED | FAILED | NOT_CREATED`.
- `LiveDriveEvidence`: versioned, strict, machine-readable, sanitized record. Unknown/forbidden keys
  fail serialization.

Critical invariants:

- The root has `appProperties.w27MarkdownGatewayTestRoot == "v1"`; no override exists.
- Archive is a direct child of root and in the same topology/drive.
- The only created item is a generated `.md` blob in the root.
- Both logical actors use independent client/snapshot state.
- Stale content and stale parent mutations send the original raw ETag in `If-Match`.
- Only status 412 plus an unchanged readback proves rejection.
- Exact `version` and `headRevisionId` values are observations, never preconditions.
- Missing/ignored ETags are `UNSUPPORTED`; transient inability to test is `INCONCLUSIVE`; both keep
  writes disabled.
- Once creation succeeds, the exact file ID is cleanup's only target. Cleanup moves to archive and
  never deletes/trashes.
- Evidence/logs contain no content, token, authorization header, OAuth secret, credential path, raw
  Drive ID, arbitrary URL, or error body/message.

## Patterns to reuse

| Existing path | Pattern | Applicability |
| --- | --- | --- |
| `src/index.ts` | import-safe exported factory with no environment reads at import time | Keep new harness modules import-safe; only the direct CLI boundary may read arguments/environment. |
| `tests/index.test.ts` | finite Vitest test with no credentials or external I/O | All harness tests use injected fakes and remain safe in `pnpm test`. |
| `package.json` | canonical finite scripts and aggregate `check` | Add a separate manual script; preserve `check` ordering and coverage without live calls. |
| `tsconfig.json` / `tsconfig.build.json` | strict NodeNext source/test typing and production emit | New source compiles to `dist`; tests type-check but do not emit. |
| `ARCHITECTURE.md` | canonical project commands and approved external boundaries | Source for stack/validation; update only if implementation establishes a new durable manual command. |
| `scripts/verify-vendored-skills.sh` | repository-owned finite validation | Keep unchanged and passing. |

No repository implementation exists for Google auth, raw HTTP, Drive, evidence redaction, or live
cleanup. Do not treat Express middleware as a starting point for this standalone operator harness.

## Tests and fixtures

Likely new tests:

| Path | Important cases |
| --- | --- |
| `tests/live-drive/config.test.ts` | closed schemas; opt-in confirmation; marker/topology rejection; both auth modes; secret file outside repo, regular/non-symlink, protected permissions. |
| `tests/live-drive/http.test.ts` | URL encoding; `supportsAllDrives`; multipart/media requests; exact `If-Match`; case-insensitive ETag; abort timeout; no implicit mutation retries. |
| `tests/live-drive/probe.test.ts` | supported two-actor timeline; 2xx stale content; 2xx stale move; missing/unchanged ETag; non-412; changed readback after 412; transient failures; cleanup in every post-create exit. |
| `tests/live-drive/evidence.test.ts` | strict schema; exact ETag/version/headRevisionId; HMAC opaque IDs; digest-only content; forbidden-key rejection; exclusive atomic output; exit precedence. |
| `tests/live-drive/cli.test.ts` | import safety; argument errors before auth/network; outcome/cleanup exit codes; sanitized stderr. |

Use scripted response fixtures defined in test code or clearly fake JSON fixture files. Fixtures must
not resemble usable OAuth credentials, contain real Drive IDs, contain bearer strings, or include
document bodies. There is no automated live-test fixture.

## Expected unchanged boundaries

- `src/index.ts` remains the route-free Express application factory.
- `tests/index.test.ts` remains the baseline construction test.
- No `MarkdownService`, domain operation, production Drive port/adapter, JSON/MCP endpoint,
  authenticated service API, CLI client for the future gateway, Cloud Run, Docker, or Terraform is
  introduced.
- `google-drive-markdown-gateway-handoff.md` remains planning input and is not edited.
- `AGENTS.md`, vendored `.agents/skills/`, and `scripts/verify-vendored-skills.sh` remain unchanged.
- Task 003 still owns the durable production write gate. This task produces evidence but cannot
  enable writes.
- Feature/task status and `tasks.md` remain unchanged.
- No credential, secret file, real config, or live result is committed.

## Selected primary external references

These are current primary sources explicitly selected for this task. The Google documentation URLs
are stable canonical pages but moving documentation, not immutable revisions; they were checked on
2026-08-28. The live probe remains authoritative when documentation is silent. Google Developers
pages state CC BY 4.0 for prose and Apache 2.0 for code samples; this plan uses links/paraphrase only,
so no copied sample or additional attribution file is required.

| Source | Applicability |
| --- | --- |
| [Drive v3 `files.get`](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get) | Metadata is `GET /drive/v3/files/{fileId}`; `alt=media` returns stored blob content; `supportsAllDrives` is available. |
| [Drive v3 `files.create`](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/create) | Defines metadata/upload endpoints, `supportsAllDrives`, and `media`/`multipart`/`resumable` upload types. The probe selects multipart create to set name, parent, MIME type, and bytes atomically. |
| [Drive v3 `files.update`](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update) | Defines metadata and upload `PATCH` endpoints, `addParents`/`removeParents`, `supportsAllDrives`, and media upload behavior. It does not document a v3 compare-and-swap guarantee for `If-Match`; the probe must prove it. |
| [Drive v3 `File` resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/files) | `version` is a monotonically increasing server change count; `headRevisionId` is output-only and currently available for binary/blob content. Both are evidence, not atomic guards. |
| [Upload file data](https://developers.google.com/workspace/drive/api/guides/manage-uploads) | Primary upload guidance for multipart create and media update. The task uses small UTF-8 Markdown, so resumable upload is unnecessary. |
| [Download and export files](https://developers.google.com/workspace/drive/api/guides/manage-downloads) | Blob content is downloaded with `files.get` and `alt=media`; Markdown is a Drive blob, not a Workspace export. |
| [Implement Shared Drive support](https://developers.google.com/workspace/drive/api/guides/enable-shareddrives) | Requires `supportsAllDrives=true` for the selected `files.get`, `files.create`, and `files.update` methods. |
| [How Application Default Credentials works](https://cloud.google.com/docs/authentication/application-default-credentials) | Defines ADC search order, local ADC, `GOOGLE_APPLICATION_CREDENTIALS`, and attached service accounts; attached/keyless credentials are preferred over committed keys. It also notes Drive scopes need explicit local ADC setup. |
| [Google Auth Library for Node.js](https://cloud.google.com/nodejs/docs/reference/google-auth-library/latest) | Official client selected for ADC/OAuth token acquisition. It documents automatic access-token refresh when a refresh token is present and the first-authorization/offline-access caveat. |
| [OAuth 2.0 for web server applications — offline access](https://developers.google.com/identity/protocols/oauth2/web-server#offline) | Primary authorization-flow behavior: request offline access to receive a refresh token for use after the user is absent. The harness consumes an already provisioned token and does not run consent. |
| [OAuth token expiration/revocation](https://developers.google.com/identity/protocols/oauth2#expiration) | Refresh tokens can stop working for documented reasons; such failure is `INCONCLUSIVE` and requires operator reauthorization, never token logging. |
| [RFC 9110 §13.1.1 `If-Match`](https://www.rfc-editor.org/rfc/rfc9110.html#name-if-match) | Primary HTTP semantics for requiring a matching current entity tag and returning 412 when the condition is false. Google Drive-specific support remains unproved until the live run. |

The [Drive performance guide](https://developers.google.com/workspace/drive/api/guides/performance)
is supporting context only: it says ETags are updated after patch *if* the API uses ETags. That
conditional language is why neither the spec nor production code may assume support.

## Validation commands

Current authoritative local validation:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
./scripts/verify-vendored-skills.sh
pnpm check
```

Sources: `package.json` for product commands, `ARCHITECTURE.md` for the canonical command record, and
`AGENTS.md` for setup integrity. `pnpm check` currently runs lint, format check, type-check, unit
tests, build, and vendored-skill verification in that order.

Proposed manual live validation after implementation/build:

```bash
W27_DRIVE_PROBE_OAUTH_SECRET_FILE=/absolute/path/to/oauth-secret.json \
  pnpm drive:probe -- run \
  --config /absolute/path/to/live-drive-probe.json \
  --output /absolute/path/outside-repository/live-drive-result.json \
  --confirm W27_DRIVE_TEST_ONLY
```

Omit the environment variable for ADC. This command is never part of CI or `pnpm check`.

## Uncertainties to verify

- Whether the live Drive v3 responses expose a raw ETag usable with `If-Match` on both media and
  metadata `files.update`. This is the task's central experiment; missing/ignored behavior is
  `UNSUPPORTED`.
- Whether a stale conditional request returns exact HTTP 412 in each topology. Any other response
  does not satisfy the proof.
- Whether `headRevisionId` appears consistently for literal Markdown blob uploads. Record absence;
  do not fail over to it as a precondition.
- Whether the operator's My Drive OAuth app has `drive.file` access to the supplied folders. If not,
  preflight must fail without silently widening scope.
- The current compatible `google-auth-library` and Zod versions must be resolved by pnpm and pinned
  in `pnpm-lock.yaml` at implementation time.
- Recheck the current working tree immediately before editing. Shaping observed a clean tree at
  `faf3644` with no uncommitted changes.
