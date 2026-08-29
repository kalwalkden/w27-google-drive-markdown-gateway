# Production Write and Tree Support

## Status

Complete

The user delegated the feature-level security and product decisions in this corrective planning
pass. No open decision remains before task shaping.

## Requirements

Close the gap between the handoff and the current public service:

- list Markdown in any unambiguous relative folder, directly or recursively;
- search Markdown names and bounded text content below any unambiguous relative folder;
- read Markdown by relative path or stable file ID anywhere under the configured root;
- create Markdown in an existing unambiguous folder under the root;
- update a root-confined Markdown file only with its exact current revision;
- archive a root-confined Markdown file into the configured archive folder only with its exact
  current revision; and
- make the same behavior available to authenticated ChatGPT Work and Codex clients in production.

All operations continue to use the one `MarkdownService` boundary. The feature must not create a
second Drive implementation in a transport or client.

## Constraints

- Reject absolute paths, traversal, unsafe provider names, shortcuts, multiple parents, cycles,
  folder escapes, non-Markdown files, malformed UTF-8/UTF-16, oversized content, and ambiguous
  canonical paths.
- Use stable Drive IDs internally. A path is usable only when every segment is the unique child with
  that name in its verified parent. ID reads must prove the same path uniqueness before exposing a
  relative path.
- Apply one request-local budget across folder depth, enumerated nodes, pages, metadata checks,
  content reads, result count, and response bytes. Exceeding a completeness bound returns the stable
  result-limit outcome; it never returns a partial answer that could hide a duplicate.
- Keep exact expected-revision preconditions for update and archive. Do not add last-write-wins,
  automatic conflict retry, or a fallback mutation without `If-Match`.
- Do not trash, delete, change sharing, create shortcuts, or mutate folders. Archive is one
  revision-checked parent move of the file.
- Keep Work JWT, Codex bearer, and Google credentials separate. Client credentials authenticate
  only to the gateway and are never forwarded to Google. Only the server-side Google identity may
  obtain Drive write authority.
- Never log paths, queries, document bodies, excerpts, revisions, folder IDs, credentials, provider
  messages, or raw request/response payloads.
- Missing, malformed, or disabled operator write configuration leaves both transports read-only.
  Startup must fail rather than silently broaden Drive scope when enabled configuration is
  inconsistent.
- Make no claim that Google Drive offers a transaction spanning a file and its mutable ancestor
  folders.

## Success Criteria

- Both transports and the checked-in Codex client expose the handoff's six operations over nested
  folders with the same application outcomes.
- List, search, and read return content or metadata only after the requested file and its unique
  ancestry have passed pre- and post-operation verification inside the configured root.
- Create, update, and archive perform at most one provider mutation, never retry it, and verify the
  resulting file and ancestry before reporting success.
- A stale update or archive returns `CONFLICT` and does not overwrite or move the newer file.
- A mutation that may have reached Drive but cannot satisfy its postconditions returns a new stable
  `OUTCOME_UNKNOWN` result. Clients are told to reread/reconcile before any further mutation.
- Archive refuses a same-name destination collision, verifies that the configured archive folder
  is a unique descendant of the root, and never invokes trash or delete.
- Production write composition exists for both authenticated principals only when the reviewed
  deployment setting explicitly enables it; absence and the Terraform default deny writes.
- Automated validation covers hostile topology, duplicate names, traversal budgets, stale
  revisions, pre/post races, ambiguous provider outcomes, transport parity, and disabled runtime
  composition without external credentials or network calls.
- Operator-only checks cover the exact deployed image/configuration against a dedicated test tree.
  Planning and local validation do not count as live Drive, Work, Codex, or Cloud Run success.

## Non-goals / out of scope

- Atomic transactions across Drive files and folders
- Protection against a malicious Drive administrator deliberately moving an ancestor out and back
  during one request
- Folder create, rename, move, share, trash, or delete operations
- Automatic rollback, cleanup, retry, merge, or idempotency after an uncertain mutation outcome
- Content indexing, background synchronization, web UI work, or general Drive access
- Per-document ACLs, multi-tenant authorization, or a second read-only/write-only principal matrix
- Treating operator evidence, a Git commit, or a passing test as proof of live cloud success

## Decisions and Tradeoffs

### Runtime write authority

The existing signed live-evidence/JWS/replay lease is not the production authorization mechanism.
It proves a provider behavior at one time, but its single-use approval, unavailable durable replay
store, process-local lease, five-minute maximum lifetime, and missing renewal path make it unsuitable
for ongoing authenticated service writes.

The live capability harness remains an operator release gate. The JWS approval, replay store, and
expiring `WriteLease` are retired from runtime composition instead of completing a second
authorization system. Ongoing authorization is:

1. the existing Work JWT or separate Codex bearer principal verification; and
2. an explicit deployment-owned write mode, disabled when absent and false by default in Terraform.

When write mode is disabled, runtime does not construct a write-capable Google transport and does
not provide a `MarkdownWriteSession` to JSON or MCP. When enabled, one process-local, non-serializable
session delegates to the same service and raw Drive writer. The setting enables both authenticated
principals because both are product write clients. Work write annotations and client confirmation
guidance remain user-experience protections, not server authorization.

Write-enabled runtime uses the exact `https://www.googleapis.com/auth/drive` scope required for
arbitrary existing files, media update, and parent move; read-only runtime retains
`https://www.googleapis.com/auth/drive.readonly`. Shared Drive deployments should restrict the
server identity with Drive membership/ACLs to the dedicated root or Drive. My Drive OAuth remains
supported, but its write grant is broader than one folder; root confinement therefore depends on
application checks and must be an explicitly reviewed operator risk. No Google credential enters
Work or Codex.

### Tree completeness and duplicate names

One request-scoped traversal budget covers all provider work, rather than resetting a large limit at
each folder. The service adds a maximum path depth and a maximum number of searched file bodies;
existing file-size, page, traversal-node, result, request, and response limits remain authoritative.
Search traverses the selected subtree, sorts canonical paths deterministically, checks duplicate
paths across the complete bounded snapshot, and only then applies the caller result limit. If the
content-search bound would make the result incomplete, it returns `RESULT_LIMIT` instead of a
partial search.

Provider children with the same safe name make that path ambiguous. Path operations fail. ID
operations also fail until sibling enumeration proves each segment maps uniquely to the selected ID.
Create fails if any file or folder already has the target leaf name. Archive fails if a different
item already has the source name in the archive folder. A file already directly in the archive may
return its current metadata only after revision, uniqueness, and archive ancestry checks pass.

### Topology and concurrency checks

The service uses an ordered topology snapshot of the target and each ancestor: stable ID, safe name,
kind, exact single parent, and available provider revision/modified facts. It also proves sibling
name uniqueness at every segment. The configured root identity and Shared Drive identity, when
applicable, are revalidated through the provider adapter.

- List/search: build one bounded snapshot, reject any incomplete traversal or duplicate canonical
  path, and re-fetch every returned file plus its unique chain before returning metadata. Search
  also verifies every content read against the same file and ancestry.
- Read: resolve path or ID and record the unique chain; download only the exact file; then re-fetch
  the file and full chain and return content only if the snapshots still agree.
- Create: prove the parent chain and complete same-name absence; immediately recheck before the one
  create; then verify the returned file ID/name/size/revision, exact parent, unique canonical path,
  and full chain.
- Update: prove the unique chain and exact caller revision; immediately recheck before one content
  update with exact `If-Match`; then verify the same file ID/name/parent, new revision and size, and
  the full chain.
- Archive: prove source and archive chains, the exact source revision, and complete destination-name
  absence; immediately recheck both chains before one `If-Match` move that removes the exact source
  parent and adds the archive folder; then verify the same file ID/name, one archive parent, new
  revision, destination uniqueness, the archive chain, and that the old source parent no longer
  enumerates that file ID.

A change found before provider dispatch returns a conflict or safe topology failure without a
mutation. A network failure, timeout, malformed success, non-conflict provider response, or failed
postcondition after dispatch returns `OUTCOME_UNKNOWN`. The gateway does not retry or attempt an
unconditional rollback. The caller must reread by stable ID or path and reconcile.

## Trusted Administration and Concurrency Assumptions

- Deployment operators and Drive administrators are trusted, follow change control, and do not
  intentionally race gateway requests. They own root/archive IDs, Drive permissions, Google OAuth
  consent, runtime identity, secrets, and write-mode changes.
- Root and archive folders are expected to remain in the selected Drive, with archive a unique
  descendant of root. The gateway rechecks this; it does not prevent an administrator from changing
  it.
- Work and Codex callers are untrusted and may issue concurrent requests. Exact file revisions
  serialize update/archive conflicts for the target file.
- Humans and other Drive clients may edit or move files concurrently. File `If-Match` protects the
  target mutation. Ancestor folders have no single Google precondition that can join them to that
  mutation.
- Pre/post snapshots detect ordinary ancestor changes, but cannot prove an ancestor was never moved
  out and back between checks. Under the trusted-administrator assumption this residual risk is
  accepted and documented; no stronger atomic guarantee is claimed.
- A route timeout cannot cancel a mutation already sent to Drive. Clients must treat timeout and
  `OUTCOME_UNKNOWN` as reconciliation states, never as permission to retry automatically.

## Validation and Operator Release Gates

Each implementation task must keep `CI=true pnpm check` green and add focused fake/static tests at
its boundary. Task 1 validates tree completeness and read races. Task 2 validates default-deny
configuration, credential separation, authenticated raw-write construction, and Terraform shape.
Task 3 validates single-dispatch create/update/archive behavior, pre/post races, conflicts, unknown
outcomes, telemetry, and JSON/MCP/CLI parity. Task 4 validates documentation and isolated operator
harness behavior without contacting live systems.

Writes remain disabled through implementation and local review. An operator may enable them only
after all of the following:

1. complete independent task and feature review on the exact immutable image;
2. verify the dedicated test root/archive topology, server-side Drive permissions, selected auth
   mode, and absence of any trash/delete path;
3. run the live capability harness against disposable Markdown in that tree, including nested
   create/read/update, stale update rejection, archive, duplicate refusal, and verified cleanup;
4. review sanitized evidence as release evidence only; it does not create a runtime lease;
5. review a Terraform plan with the write setting and a separate write-risk acknowledgement both
   explicit, while confirming an omitted/false setting remains read-only;
6. deploy a controlled revision and verify unauthenticated denial, read behavior, one conflict, and
   no-retry uncertain-outcome guidance before broader traffic;
7. run separate Work and Codex test-file flows from clean configured clients; and
8. retain a rollback that deploys write-disabled configuration without deleting credentials or
   Drive data.

Live results, cloud policy changes, secret provisioning, Drive ACL changes, Terraform apply, plugin
installation, and Codex environment mutation remain operator actions outside task completion.

## Visual / Interaction Direction

There is no visual product surface. Preserve the existing six tool/CLI concepts and safe public
errors. The request and release flow is captured in
[`visuals/operation-flow.md`](visuals/operation-flow.md).

## Implementation Map

- `src/application/markdown-service.ts` — owns direct-root restrictions, path/ID resolution,
  duplicate checks, write-session behavior, and the currently unsupported archive path.
- `src/domain/markdown.ts` — owns the six public contracts and stable error codes.
- `src/drive/drive-port.ts` — read/write port contracts and bounded child-list semantics.
- `src/drive/google-drive-read-adapter.ts` — owns Drive metadata/list/media behavior, root/Shared
  Drive validation, current traversal helpers, and direct-root content restrictions.
- `src/drive/google-drive-write-adapter.ts` — sends one raw create, conditional media update, or
  conditional parent move, but is not authenticated or production-composed.
- `src/drive/guarded-drive-write-port.ts` and `src/write-gate/` — current lease authority boundary
  to simplify; the live evidence harness under `src/live-drive/` remains operator tooling.
- `src/config/service-config.ts`, `src/runtime/config.ts`, and `src/runtime/server.ts` — deployment
  configuration, Google credential loading, shared service composition, and the currently absent
  production write-session provider.
- `src/http/json-api.ts` and `src/mcp/stateless-mcp.ts` — shared transport outcomes, limits,
  write-session seams, and Work write annotations.
- `src/codex-cli/cli.ts` and `src/codex-cloud/harness.ts` — machine-readable client contract and the
  currently blocked release harness.
- `src/observability/audit.ts`, `docs/observability-contract.md`, and `docs/threat-model.md` — closed
  telemetry and current direct-root/write-disabled risk record.
- `infra/terraform/cloud-run.tf`, `infra/terraform/variables.tf`, and
  `docs/cloud-run-deployment.md` — default-deny production configuration and operator gates.
- `plugin/chatgpt-work/` and `.agents/skills/codex-cloud-markdown-gateway/SKILL.md` — Work/Codex
  read-before-write, conflict, confirmation, and reconciliation guidance.
- `tests/application/markdown-service.test.ts`, `tests/drive/`, `tests/runtime/server.test.ts`,
  `tests/http/json-api.test.ts`, `tests/mcp/stateless-mcp.test.ts`, `tests/codex-cli/`, and
  `tests/codex-cloud/` — representative safety and parity coverage later tasks must re-check.
- `google-drive-markdown-gateway-handoff.md` — authoritative product goal and six-operation safety
  baseline.

## Open Questions

None.
