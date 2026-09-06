# Google Drive Read Adapter — References

## Primary edit targets

| Path | Symbol / area | Why it is likely to change |
| --- | --- | --- |
| `package.json` and `pnpm-lock.yaml` | production dependencies | Add official `googleapis`; preserve scripts and the opt-in-only live probe. |
| `src/drive/google-drive-auth.ts` (new) | explicit auth/client factory | Creates ADC or injected refresh-token auth without repository secret ownership. |
| `src/drive/google-drive-read-adapter.ts` (new) | `GoogleDriveReadAdapter : DrivePort` | Root/cache, narrow Drive calls, record normalization, media validation, provider errors, and explicit unsupported writes. |
| `src/drive/drive-port.ts` | finalized port contracts | Binding surface from concurrent task 001. Read immediately before editing. |
| `src/domain/markdown.ts` | opaque values/errors | Reuse public brands/helpers/errors; no duplicate domain contract. |
| `tests/drive/google-drive-read-adapter.test.ts` (new) | adapter seam tests | Fake `files.get/list` shape, cache, failure, decode, and no-write tests. |
| `tests/drive/google-drive-auth.test.ts` (new, if useful) | auth factory tests | Selects auth mode without exchanging a token or using a credential. |

## Entry point and call path

```text
future HTTP/MCP/CLI caller
  -> MarkdownService (src/application/markdown-service.ts)
  -> DrivePort (src/drive/drive-port.ts)
  -> GoogleDriveReadAdapter (new)
  -> Google Drive files.get / files.list
```

`MarkdownService` owns locator traversal, ancestor verification, Markdown filtering, duplicate
rejection, and public domain errors. The adapter owns provider facts, root context/cache, exact
query construction, Drive normalization, media decode/size checks, and safe provider errors.
A transport must not call the adapter directly.

## Contracts, state, and invariants

- Task 001 currently defines `getNode`, `listChildren`, `listDescendants`,
  `searchDescendants`, `readFile`, and conditional write methods in `DrivePort`. Implement
  its final shape exactly; write methods return its unsupported variant with no API call.
- `DriveNode` distinguishes folder/file/shortcut and provides opaque ID, parents, revision,
  modified time, and size. Preserve shortcuts and duplicate child names for service policy.
- Root configuration contains an opaque `FolderId`, auth mode/credentials, and safe byte/traversal
  bounds. It contains no repository-local secret path, environment lookup, or caller query string.
- Root cache holds only validated root metadata plus optional Shared Drive ID. Coalesce initialization,
  expire/invalidate safely, and never cache failure as success.
- Every list is `'<folderId>' in parents and trashed = false`. Shared Drive uses exact `driveId`
  plus `corpora: drive`; My Drive uses `corpora: user`; all calls set `supportsAllDrives`.
- Direct opaque-ID metadata fetch is needed for service ancestry validation, but does not authorize
  that item. The service must verify the complete parent chain before content/metadata exposure.
- `DriveRead` contains only complete byte-bounded fatal-UTF-8 decoded literal Drive content.

## Patterns to reuse

| Existing path | Pattern | Applicability |
| --- | --- | --- |
| `src/drive/drive-port.ts` | small provider-facts interface | Google SDK stays behind it. |
| `src/drive/in-memory-drive-port.ts` | immutable snapshots and explicit unsupported writes | Match contract behavior, not fake storage. |
| `src/live-drive/auth.ts` | `GoogleAuth`/`OAuth2Client` mechanics | Concept only; never import the raw harness. |
| `src/live-drive/drive-client.ts` | supports-all-drives/narrow fields | Concept only; production adapter uses `googleapis`. |
| `tests/live-drive/drive-client.test.ts` | capture fake + request-shape tests | Reuse fake-first style, not harness code. |
| `src/index.ts` / `tests/index.test.ts` | import-safe ESM and deterministic Vitest | New modules perform no work at import time. |

## Tests and fixtures

Use a fake Drive API façade to cover valid/wrong/trashed/shortcut roots, cache coalescing and
invalidation, pagination, exact-parent query construction, both corpus modes, duplicate siblings,
shortcuts, recursive traversal bounds, metadata-only ID lookup, successful/empty/oversize/malformed
media reads, fatal UTF-8 rejection, 401/403/404/429/5xx/timeout/malformed mapping, and zero API
calls from every write method.

Fixtures use only synthetic IDs/tokens/content. Ordinary tests require no ADC, no token exchange, no
network, no Drive mutation, and no external secret.

## Expected unchanged boundaries

- `src/application/**`, `src/domain/**`, and `src/drive/in-memory-drive-port.ts` are task 001
  ownership except minimal finalized-contract reconciliation.
- `src/live-drive/**`, `tests/live-drive/**`, and `docs/live-drive-capability-harness.md`
  remain task 0's raw capability harness.
- HTTP/MCP/CLI transport, gateway-client auth, deployment, Secret Manager wiring, write/archive
  implementation, and task status are out of scope.

## Validation commands

Authoritative commands from `package.json`, `ARCHITECTURE.md`, and `AGENTS.md`:

```bash
CI=true pnpm test -- tests/drive/google-drive-read-adapter.test.ts
CI=true pnpm test -- tests/drive/google-drive-auth.test.ts
CI=true pnpm lint
CI=true pnpm format:check
CI=true pnpm typecheck
CI=true pnpm test
CI=true pnpm build
./scripts/verify-vendored-skills.sh
CI=true pnpm check
git diff --check
```

If only one focused test file is created, run only that focused file before the full suite. Never
run `pnpm drive:probe` automatically.

## Selected external material

The following sources were read on 2026-08-29 and selected only for this adapter; their moving
documentation is not repository policy beyond the decisions recorded in `plan.md`.

| Source | Applicability | License / attribution |
| --- | --- | --- |
| [Drive `files.list` reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list) | Parent query, pagination, corpora, page size, `driveId`, and `supportsAllDrives`. | Google Developers: CC BY 4.0; samples Apache 2.0. Link/cite only. |
| [Drive `files.get` reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get) | Metadata/media read, `alt=media`, Shared Drive support. | CC BY 4.0 / Apache 2.0 samples. |
| [Drive File resource](https://developers.google.com/workspace/drive/api/reference/rest/v3/files) | Shortcut MIME/details and monotonic `version`; revisions remain opaque in the domain. | CC BY 4.0 / Apache 2.0 samples. |
| [Search files guide](https://developers.google.com/workspace/drive/api/guides/search-files) | Exact parent-membership query and the decision to avoid global full-text search. | CC BY 4.0 / Apache 2.0 samples. |
| [Shared Drive support guide](https://developers.google.com/workspace/drive/api/guides/enable-shareddrives) | `supportsAllDrives`, `includeItemsFromAllDrives`, `corpora: drive`, and `driveId`. | CC BY 4.0 / Apache 2.0 samples. |
| [Application Default Credentials](https://cloud.google.com/docs/authentication/application-default-credentials) | ADC resolution and attached least-privilege identity preference. | Google Cloud documentation terms; link/cite only. |
| [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server) | Server OAuth, offline refresh token, secret handling, and client-library guidance. | CC BY 4.0 / Apache 2.0 samples. |

## Uncertainties to verify

- Task 001's port/error symbols may change while this spec is read. Reconcile the final tree just
  before implementation instead of retaining obsolete types.
- Check the installed `googleapis` TypeScript method/response types. Isolate unavoidable adapter
  casts in the façade, never across domain/application code.
- Reuse application limits if task 001 exposes them; otherwise choose explicit conservative
  read/traversal defaults and test boundaries.
- Full-text search is not assumed. If the final port requires it, perform only bounded
  post-enumeration content search; never broaden a Drive query.
