# Live Drive Capability Harness — Implementation Plan

## Scope

Add an operator-invoked, raw Google Drive v3 capability probe. It creates one uniquely named,
disposable Markdown blob in a dedicated test root, exercises upload/download and two stale
`If-Match` mutations through two independent logical actors, writes sanitized machine-readable
evidence, and moves the disposable file to an operator-supplied archive folder in a `finally`
cleanup path.

The harness is a platform test, not a Drive adapter and not production write behavior. Normal
builds and tests must never call Drive. No result, credential, token, OAuth client secret, refresh
token, file content, authorization header, or secret-file path may be committed or recorded in
evidence.

## Binding decisions and constraints

| Decision / constraint | Implementation effect | Provenance |
| --- | --- | --- |
| Live use is explicit and fail-closed. | The CLI requires both a live subcommand and the exact typed confirmation `W27_DRIVE_TEST_ONLY`; it has no default credentials, root, archive, output path, or implicit network mode. `pnpm test` and `pnpm check` run unit tests only. | Approved task brief; feature constraint; user shaping direction |
| Only a marked dedicated test root is eligible. | Before creating anything, fetch the supplied root and require a non-trashed Drive folder with `appProperties.w27MarkdownGatewayTestRoot == "v1"`. Reject a missing/different marker. The harness does not create or add this marker. | User shaping direction; handoff dedicated-folder rule |
| The archive is operator supplied and confined. | Fetch the supplied archive folder before creation. Require it to be a non-trashed folder, a direct child of the marked test root, and in the same `driveId` when one is present. Root and archive IDs must differ. | User shaping direction; handoff no-permanent-deletion and root confinement rules |
| The probe uses raw HTTP. | Use Google authentication only to obtain/refresh access tokens. Send Drive REST requests through a small injected HTTP transport so exact request headers and raw response `ETag` headers remain observable. Do not use a convenience Drive client for the capability decisions. | Objective to prove raw Drive behavior; official Drive REST references |
| Both credential modes are supported without repository secrets. | `shared-drive-adc` uses Google Application Default Credentials with the Drive scope. `my-drive-refresh-token` reads `clientId`, `clientSecret`, and `refreshToken` from one operator-owned secret JSON file whose path is supplied at runtime. Neither secret values nor the path enter evidence or logs. | Approved feature requirements; handoff authentication direction; user shaping direction |
| Shared Drive flags are unconditional. | Send `supportsAllDrives=true` on every applicable `files.get`, `files.create`, and `files.update` request in both modes. This keeps the raw request shape identical and satisfies Shared Drive requirements. | Google Shared Drive guide and method references selected below |
| `version` and `headRevisionId` are observations, not write guards. | Request and record both fields on every metadata snapshot. Do not implement compare-then-update with either field. Only an atomic HTTP precondition can pass this probe. | Drive `File` resource; approved brief; task 003 brief |
| A stale `If-Match` must reject both content and parent mutations. | A capability result is `SUPPORTED` only when both stale requests include the exact stale raw response ETag, receive HTTP `412`, and a subsequent metadata/download snapshot proves the newer content and parents are unchanged. | User shaping direction; HTTP `If-Match` semantics; task safety gate |
| Missing or ignored ETag behavior is unsafe. | Missing/unusable response ETags, a 2xx stale mutation, an unexpected state change, or a stale request rejected for a reason other than `412` yields `UNSUPPORTED`. Network, authentication, quota, or 5xx failures yield `INCONCLUSIVE`. Every non-`SUPPORTED` result leaves production writes disabled. | User shaping direction; task 003 fail-closed gate |
| Cleanup is mandatory and non-destructive. | Once a file ID exists, cleanup runs for success, unsupported behavior, expected rejection, exceptions, and handled `SIGINT`/`SIGTERM`. It moves only that run's disposable file to the supplied archive; it never deletes or trashes. Cleanup failure is prominent in evidence and the exit code. | User shaping direction; handoff no-permanent-deletion rule |
| Evidence contains no bodies or credentials. | Store generated-content byte counts and SHA-256 digests only. Store raw ETag, `version`, and `headRevisionId`, but no request/response bodies, tokens, authorization headers, OAuth metadata, raw Drive IDs, user email, secret paths, or full request URLs. | Approved brief; user shaping direction; repository security policy |

The official Drive v3 method documentation does not promise that `files.update` honors `If-Match`
for this use case. The general Drive performance page only discusses ETag behavior conditionally.
Therefore documentation is orientation, not proof; the live result is authoritative. There is no
fallback from `If-Match` to a `version` check.

## Visual design

No visual design applies. The feature has no `visuals/` directory, and this task adds a CLI,
machine record, and operator runbook only. Human output should be terse status/progress on stderr;
the evidence document is the only structured output.

## Product alignment

This task resolves the principal unknown behind revision-safe Drive writes without prematurely
creating the production Drive port. It intentionally uses a disposable file, explicit root marker,
separate archive, and raw HTTP observations. Task 003 may later consume the sanitized result as a
write gate, but this task must not enable writes, add an override, or encode a committed approval.

## Configuration contract

Add a checked-in, secret-free example plus a Zod-validated runtime contract. Recommended shape:

```json
{
  "schemaVersion": 1,
  "authMode": "shared-drive-adc",
  "testRootFolderId": "operator-supplied",
  "archiveFolderId": "operator-supplied",
  "requestTimeoutMs": 30000
}
```

`authMode` is exactly `shared-drive-adc` or `my-drive-refresh-token`. Folder IDs are required,
nonempty opaque strings and may not be equal. Timeouts have conservative lower/upper bounds. No
unknown fields are accepted. The marker key/value and Drive API origins are code constants rather
than configurable escape hatches.

For My Drive, require `W27_DRIVE_PROBE_OAUTH_SECRET_FILE` to point to a regular, operator-owned JSON
file outside the repository. Its strict schema is:

```json
{
  "clientId": "...",
  "clientSecret": "...",
  "refreshToken": "..."
}
```

Reject extra fields, symlinks, non-files, group/world-readable mode bits on POSIX, missing values,
or a path inside the repository. Never accept these secret values directly as CLI flags or in the
non-secret config. The OAuth client must set the credentials and let `google-auth-library` obtain
and refresh short-lived access tokens. The runbook must explain that offline access is required to
obtain a refresh token, that it may only be returned on first authorization unless consent is
forced, and that revocation/expiry requires operator reauthorization. The harness does not contain
an OAuth consent flow.

For Shared Drive, use ADC with the Drive scope and no key-loading code of its own. Prefer an
attached service account in Google Cloud or keyless local ADC/impersonation. If
`GOOGLE_APPLICATION_CREDENTIALS` is used, it remains an operator environment concern and never
appears in output. The Shared Drive must grant the ADC principal access only as broadly as needed
for the marked test root/archive.

The runbook must note the My Drive limitation: Google OAuth does not issue a folder-scoped token.
Use the least-privileged workable OAuth scope (prefer `drive.file` when the OAuth app has already
been granted access to the operator-supplied folders); otherwise a broader Drive scope is an
explicit operator provisioning decision, not a harness default. A credential that cannot fetch the
root fails before creation.

## Implementation approach

### 1. Add dependencies and an opt-in CLI entry

- Add `google-auth-library` and `zod` to `package.json` and regenerate `pnpm-lock.yaml` through pnpm.
- Add a `drive:probe` package script that runs the built CLI. Do not add the live probe to `check`,
  `test`, postinstall, build, or any automatic hook.
- Add `src/live-drive/cli.ts` as a direct-execution-only entry. It validates arguments and config,
  creates dependencies, handles `SIGINT`/`SIGTERM` by requesting graceful abort, invokes the probe,
  atomically writes the evidence file, prints a one-line sanitized result, and maps outcomes to
  stable nonzero exit codes. Hard process termination cannot be guaranteed; the runbook must state
  how to locate the run by generated name/run ID and manually archive it if no evidence is written.

The exact live invocation after a build is:

```bash
pnpm build
W27_DRIVE_PROBE_OAUTH_SECRET_FILE=/absolute/path/to/oauth-secret.json \
  pnpm drive:probe -- run \
  --config /absolute/path/to/live-drive-probe.json \
  --output /absolute/path/outside-repository/live-drive-result.json \
  --confirm W27_DRIVE_TEST_ONLY
```

Omit `W27_DRIVE_PROBE_OAUTH_SECRET_FILE` for ADC. Require the output path to be outside the
repository and create it with exclusive/atomic write behavior and mode `0600`; never overwrite an
existing result.

### 2. Separate authentication, HTTP, and Drive request seams

Create these narrow, unit-testable seams:

- `AccessTokenProvider.getAccessToken(): Promise<string>` in `src/live-drive/auth.ts`. Production
  implementations wrap ADC or an OAuth2 client. Tokens stay in memory and are never returned in
  errors.
- `HttpTransport.send(request): Promise<RawHttpResponse>` in `src/live-drive/http.ts`. The fetch
  implementation applies a per-request abort timeout. Tests inject a scripted transport.
- `RawDriveClient` in `src/live-drive/drive-client.ts`. It constructs only the required Drive v3
  `files.get`, multipart `files.create`, media `files.update`, and metadata/parent `files.update`
  requests. It adds authorization immediately before transport, never exposes it to evidence, and
  parses only allowlisted response metadata and headers.

Use two separate `RawDriveClient` instances labelled `actor-a` and `actor-b`. They may share one
token provider because the test models two concurrent readers/writers, not two Google principals;
they must not share cached ETags, file snapshots, or mutable request state.

Raw request forms:

- Metadata: `GET /drive/v3/files/{id}` with
  `supportsAllDrives=true&fields=id,name,mimeType,parents,driveId,trashed,appProperties,version,headRevisionId`.
- Download: `GET /drive/v3/files/{id}?alt=media&supportsAllDrives=true`.
- Create: multipart upload to `/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true`
  with metadata `{name, mimeType: "text/markdown", parents: [testRootFolderId]}` and generated UTF-8
  bytes.
- Content update: media upload `PATCH /upload/drive/v3/files/{id}?uploadType=media&supportsAllDrives=true`
  with `Content-Type: text/markdown; charset=utf-8` and `If-Match` when required.
- Parent move: metadata `PATCH /drive/v3/files/{id}?addParents={archive}&removeParents={root}&supportsAllDrives=true`
  with an empty metadata object and `If-Match` when required.

Percent-encode all path/query values through URL APIs. Do not persist constructed URLs because they
contain raw Drive IDs. Parse the raw response `etag` header case-insensitively and preserve its exact
value, including weak/quoted syntax, for the next `If-Match` request and evidence.

### 3. Preflight the safety boundary before writing

1. Load and validate config and credentials without printing values.
2. Fetch root and archive metadata.
3. Verify folder MIME types, `trashed == false`, distinct IDs, marker exact match, archive direct
   parent equal to root, and equal `driveId` values when present.
4. Confirm the credential mode agrees with topology: `shared-drive-adc` requires a nonempty
   `driveId`; `my-drive-refresh-token` requires the root not to report a shared-drive `driveId`.
5. Generate a UUID run ID, in-memory random HMAC key, name
   `w27-drive-capability-<run-id>.md`, and small deterministic-per-run content variants. Do not read
   operator files as probe content.

Any failed preflight returns `INCONCLUSIVE`, creates no file, and records only sanitized reason
codes. The harness has no `--force`, marker bypass, arbitrary API origin, delete, trash, share, list,
or search option.

### 4. Execute the two-actor proof

For every state observation, perform a metadata `files.get` and an `alt=media` download, then retain
content bytes only long enough to compute SHA-256 and byte length.

1. **Create/download proof.** Actor A creates the uniquely named Markdown file in the root using
   multipart upload, obtains the file ID, reads metadata and raw ETag, downloads it, and proves the
   digest/length match generated content V1. From this point onward cleanup is armed.
2. **Establish actor A's stale snapshot.** Actor A retains snapshot S0 (`etag`, `version`,
   `headRevisionId`, parents, content digest/length).
3. **Actor B fresh content update.** Actor B independently reads S0, then uploads V2 with
   `If-Match: S0.etag`. Require success and snapshot S1 with V2 digest. The ETag must change; version
   must be numeric and nondecreasing, and should increase. Record observed `headRevisionId` without
   assuming it is always present beyond blob-file documentation.
4. **Actor A stale content update.** Actor A sends V-stale with `If-Match: S0.etag`. Require HTTP
   `412`. Fetch S1-after and prove ETag/version/headRevisionId/parents/content digest and length are
   unchanged from S1. A 2xx or state change is `UNSUPPORTED`.
5. **Establish a second stale snapshot.** Actor A retains S1. Actor B updates content to V3 with
   `If-Match: S1.etag`, then reads S2 and proves V3 is current with a new ETag.
6. **Actor A stale parent move.** Actor A attempts `addParents=archive&removeParents=root` with
   `If-Match: S1.etag`. Require HTTP `412`. Read S2-after and prove parents still equal `[root]` and
   ETag/version/headRevisionId/content digest/length are unchanged from S2. A 2xx, presence in the
   archive, or any state change is `UNSUPPORTED`.

Do not stop immediately after an accepted stale write. Record the unsafe observation, recover the
current disposable-file state, and proceed directly to cleanup when further proof would compound
risk. If content and parent behavior can still be tested safely after one unsupported observation,
the implementation may finish the other check, but `UNSUPPORTED` is irreversible for that run.

`SUPPORTED` requires all of the following: create/download match; raw ETags present; both actor B
fresh updates accepted with the sent current ETag; both actor A stale requests return exactly 412;
both post-rejection snapshots are unchanged; and cleanup verifies archive placement. `version` and
`headRevisionId` corroborate evidence but never replace these checks.

### 5. Always archive the disposable file

Wrap all post-create work in `try/finally`.

- Fetch the file by the exact captured file ID. Verify its opaque run fingerprint, generated name,
  Markdown MIME type, and that its current parent is either the root or archive. Never search by
  name or act on a different ID.
- If already in archive, record `ALREADY_ARCHIVED`.
- Otherwise attempt the parent move with the freshest ETag and verify the resulting parent is the
  archive. If an ETag is unavailable or a conditional cleanup conflicts, one unconditional cleanup
  move is allowed only after the identity/parent checks above because this is the harness-created
  disposable file. Record that fallback explicitly.
- Never delete, trash, permanently remove, or overwrite an operator file.
- Record `FAILED` with stage and sanitized status/reason if the move or verification fails. Print a
  prominent, content-free manual-cleanup message containing the generated disposable filename and
  run ID, not credentials or content. Return nonzero even if capability checks passed.

### 6. Emit a sanitized evidence record

Add a strict evidence schema and a checked-in example/template. Recommended top-level contract:

```text
schemaVersion, probeVersion, runId, startedAt, finishedAt,
authMode, topology, outcome, checks[], cleanup, redaction
```

`outcome` is `SUPPORTED`, `UNSUPPORTED`, or `INCONCLUSIVE`. `cleanup.status` is `ARCHIVED`,
`ALREADY_ARCHIVED`, `FAILED`, or `NOT_CREATED`. Each check records: stable check ID; actor label;
sanitized endpoint kind and method; whether `If-Match` and `supportsAllDrives` were sent; HTTP
status; exact response ETag/version/headRevisionId when observed; HMAC-derived opaque references for
Drive IDs/parents; `payloadSha256` and `payloadByteLength`; expected invariant; pass/fail; and an
allowlisted reason code.

The per-run HMAC key is discarded and never stored, preventing raw identifiers or cross-run
correlation. Do not store names other than the generated disposable filename/run ID. Do not store
HTTP bodies, error messages, stack traces, request URLs, arbitrary headers, auth scopes returned by
Google, or environment/config snapshots. Add a recursive evidence allowlist/redaction assertion
before writing; a serialization attempt containing reserved body/credential keys such as
`authorization`, `accessToken`, `refreshToken`, `clientSecret`, `content`, `body`, or a credential
path must fail closed. Digest/length fields use the `payload*` names above and never contain bytes.

Exit behavior:

- `0`: `SUPPORTED` and cleanup is verified.
- nonzero stable codes: `UNSUPPORTED`; `INCONCLUSIVE`; configuration/preflight failure; or cleanup
  failure. Cleanup failure wins the process exit code but does not rewrite an observed
  `UNSUPPORTED` capability outcome.

## Expected control flow and invariants

```text
operator CLI
  -> strict opt-in/config validation
  -> external token provider
  -> root + archive preflight
  -> actor A / actor B raw Drive clients
  -> create/read/fresh update/stale content/stale move checks
  -> finally archive exact disposable file
  -> allowlisted evidence serializer -> external result file
```

Invariants:

- No Drive request occurs from import, application construction, unit tests, build, or aggregate
  validation.
- No file is created until auth, root marker, archive containment, and topology checks pass.
- Every applicable Drive method sends `supportsAllDrives=true`.
- Every stale mutation sends the exact raw ETag retained by actor A; actor B does not mutate actor
  A's snapshot.
- Only exact HTTP 412 plus unchanged state proves stale rejection.
- No result can enable production writes. Task 003 owns the later evidence gate, and all absent,
  malformed, unsupported, inconclusive, or cleanup-failed evidence remains fail-closed.
- File content and credentials exist in memory only for the shortest practical period and never
  enter logs/evidence.
- Cleanup targets only the exact disposable file ID and moves it to the supplied archive.

## Test strategy

Use scripted in-memory `HttpTransport` and `AccessTokenProvider` fakes. Unit tests must cover:

- strict config schemas, both auth modes, missing confirmation, same root/archive ID, unknown
  fields, missing marker, wrong topology, and secret-file path/mode/symlink/repository checks;
- URL, upload, `supportsAllDrives`, `If-Match`, timeout, and case-insensitive raw ETag handling;
- two clients retaining independent snapshots while sharing only the token provider;
- happy-path `SUPPORTED` behavior with two 412 responses and unchanged metadata/content/parents;
- ignored stale content update, ignored stale parent move, unexpected non-412 rejection, absent ETag,
  unchanged ETag after fresh write, and changed state after 412, all failing closed;
- authentication/network/timeout/429/5xx outcomes as `INCONCLUSIVE` without accidental retry of a
  mutation;
- cleanup on every exception after create, already-archived detection, safe conditional cleanup,
  tightly guarded unconditional cleanup fallback, cleanup verification failure, and nonzero exits;
- exact evidence schema, HMAC opaque IDs, exact ETag/version/headRevisionId capture, atomic exclusive
  output, and rejection of bodies/tokens/secrets/paths/forbidden keys;
- import safety and proof that `pnpm test` performs no real network or credential discovery.

No Vitest case uses live credentials or Drive. The live operator run is manual and intentionally
cannot be part of CI.

## Exact validation commands

Run implementation validation in this order:

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

Then, only with operator-provided folders/credentials and explicit approval, run the live command
shown above for the selected auth mode. Inspect the result with a JSON parser, confirm no forbidden
keys/content appear, confirm both stale checks are 412 plus unchanged state, and confirm cleanup is
`ARCHIVED` or `ALREADY_ARCHIVED`. Never commit the config, OAuth secret file, or result.

Authoritative project commands are `package.json`, `ARCHITECTURE.md`, and `AGENTS.md`. The live
command is introduced by this task and remains outside `pnpm check`.

## Current-tree deviations and boundaries

Task 001 has been implemented at commit `faf3644`: strict TypeScript, Express app factory, Vitest,
Biome, pnpm lockfile, build, and aggregate validation now exist. This supersedes the task brief's
planning-only starting point. No Google dependencies, live-test modules, credential contracts, or
Drive tests exist yet.

Keep `src/index.ts` and `tests/index.test.ts` behavior unchanged except that the build may now include
new import-safe live-harness modules. Do not add Drive routes, `MarkdownService`, production Drive
ports/adapters, gateway authentication, MCP/JSON interfaces, Cloud Run/Terraform, or a write-enable
gate. Do not update task or feature status.

## Risks and implementer checks

- Confirm in a real response whether Drive v3 emits a usable ETag header for blob metadata/create
  and update responses. Absence is an `UNSUPPORTED` result, not a reason to synthesize an ETag.
- Treat a weak ETag exactly as returned; do not strip `W/` or quotes. If Drive rejects it other than
  412, capability is not proved.
- Do not assume `headRevisionId` is populated on every response; explicitly request it and record
  absence. The file resource currently documents it only for binary/blob content.
- Do not retry create or mutation calls automatically. Token refresh may happen before dispatch,
  but transport retries can duplicate or mask the exact stale request. Reads may use a small bounded
  retry policy for 429/5xx if each attempt is recorded.
- A My Drive `drive.file` credential may not see an operator-created root unless the same OAuth app
  was granted access. Fail before creation and document the provisioning requirement; do not widen
  scope silently.
- A hard kill or machine loss can bypass `finally`; the unique generated name and explicit manual
  archive guidance are the recovery mechanism.

## Open questions

None for implementation. Actual Drive conditional behavior and credential access are outputs of the
probe, not unresolved design decisions. If the platform ignores `If-Match`, the run records
`UNSUPPORTED` and production writes remain disabled.
