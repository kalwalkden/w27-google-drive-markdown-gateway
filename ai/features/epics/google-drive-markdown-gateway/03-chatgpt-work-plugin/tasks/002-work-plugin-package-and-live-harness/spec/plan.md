# Work Plugin Package and Live Harness — Implementation Plan

## Scope

Package the completed stateless MCP endpoint for a private ChatGPT Work installation and add a
narrow operator-run validation harness. The package keeps tenant-specific registration and OAuth
values outside source control, gives the agent concise safe-use instructions, and records sanitized
release evidence for the six operations and a stale-revision conflict.

This task adds no Drive, document-policy, MCP transport, authorization, write-gate, Cloud Run,
tenant-administration, marketplace-publication, credential-provisioning, or automatic live-test
behavior. It must not run Work, Drive, cloud, OAuth, JWKS, or remote MCP calls while implementing
or validating the repository changes.

## Binding decisions and constraints

| Decision / constraint | Implementation effect | Provenance |
| --- | --- | --- |
| The private Work package exposes only the six existing MCP operations. | Package the endpoint produced by task 001; do not create a plugin-side business-logic implementation, REST fallback, or extra tool. | Approved feature/brief; product handoff |
| Private installation is a deployment/operator action. | Store only a portable, secret-free package template and runbook in Git. The operator enters the actual private-plugin build/origin and tenant values in the Work admin/product surface and deployment configuration. | Approved brief; handoff; `docs/write-gate-and-client-validation.md` |
| The platform profile is current and tenant-specific. | Do not invent an MCP discovery/registration format, OAuth flow, issuer, audience, JWKS URL/key, redirect URI, client ID, claim mapping, scopes, endpoint URL, or user-approval semantics. Before releasing, operator verifies the current Work tenant's supported private-plugin metadata and authentication profile, then fills only the documented input slots. | Task 001 open questions; handoff says platform surfaces change; current tree has no Work package/assets |
| Gateway Work authentication is server-side and separate from Drive/Codex credentials. | Reuse the `workMcp` configuration and `PrincipalVerifier` boundary. Package/runbook must never include a Google credential, Codex bearer secret, Work token/JWT/cookie/code, client secret, JWKS private key, gateway secret path, or URL query string. | `src/config/service-config.ts`; `src/auth/principal-verifier.ts`; handoff; `AGENTS.md` |
| Write authority stays fail closed. | The package describes write tools as mutations requiring the existing gateway write session/lease path; it must not imply a plugin registration, tool annotation, tenant consent, or passing live test enables writes. The validation record reports the user-approval behavior observed in that tenant, including a denied/no-lease result where applicable, without assuming the platform will show a particular confirmation UI. | Write-gate runbook; task 001 plan; brief caveat |
| Agent workflow is read-before-write. | Include short instructions: search/read first, retain the returned revision, update only with that revision, reread/report a conflict rather than overwrite, and ask before archive unless the user explicitly asked. | Product handoff user experience requirements; approved brief |
| Live evidence is operator-owned and sanitized. | Keep harness inputs, transcripts, screenshots, test documents, tokens, and raw responses outside Git. Commit only a schema/template and checklist that retain opaque identifiers/digests and pass/fail observations. Archive the exact dedicated test file during cleanup; never delete/trash it. | `docs/write-gate-and-client-validation.md`; live Drive harness/runbook; handoff |

## Visual design

No visual design applies. This is a machine-facing private package and an operator runbook. The
feature-level source is `ai/features/epics/google-drive-markdown-gateway/03-chatgpt-work-plugin/feature.md`.

## Current-tree evidence and product alignment

- `src/config/service-config.ts` already defines deployment-owned `authentication.workMcp` fields:
  HTTPS issuer and JWKS URL, audience, allowed algorithms, clock tolerance, and JWKS timeout/cache
  bounds. It deliberately has no ChatGPT Work tenant defaults or environment loader.
- `src/auth/principal-verifier.ts` verifies a compact JWT through the configured remote JWKS and
  returns the normalized `work-mcp` principal. It defers network access until request verification;
  package assets must not bypass this verifier or parse a JWT themselves.
- `src/http/json-api.ts` has a pre-opened `MarkdownWriteSession` seam and disables writes when none
  is supplied. `src/write-gate/` owns the separate fail-closed approval/lease boundary.
- Task 001 is the required MCP adapter and defines the exact six tool names, schema/parity rules,
  stateless behavior, safe error vocabulary, and tool annotations. Re-read its final exported route
  and locked SDK contract before adding an endpoint/origin reference.
- No MCP source, ChatGPT Work manifest/metadata, private-plugin directory, registration asset, or
  Work harness exists at shaping time. `package.json` also does not yet lock the MCP SDK. The
  modified JSON/API and write-gate files are concurrent work; preserve their ownership.
- `docs/client-validation-record.example.json` already establishes the release-evidence fields for
  the Work plugin build, MCP origin, OAuth issuer/audience/redirect URI, JWKS key, scoped principal,
  read result, and observed write-approval result. It is release evidence only and cannot affect
  `WriteGateDecision`.

## Detailed implementation approach

1. Recheck task 001's completed MCP route, its selected SDK/version, its six tool names, and the
   final deployment composition point. Confirm the route uses only the common `MarkdownService` /
   `MarkdownWriteSession` seams and rejects any non-`work-mcp` principal. Do not package a guessed
   route or a JSON endpoint as MCP.
2. Add one isolated, secret-free `plugin/chatgpt-work/` package area (or an equivalently isolated
   repository path if the current Work format requires a different canonical name). Keep the
   authoritative operator-facing README/runbook, the concise server/agent instructions, and a
   closed example configuration/metadata template together. The template must use obvious
   non-routable placeholders for all deployment/tenant inputs and must prohibit query strings,
   embedded credentials, and copied live values.
3. During an operator-controlled current-platform check, select the exact supported private-plugin
   metadata envelope/discovery field names and OAuth/JWT registration fields. Record the selected
   Work platform revision/build identifier and template format in the package/runbook, but never
   claim a generic manifest shape is portable across tenants. Keep all tenant values as explicit
   operator inputs: private-plugin build ID, HTTPS MCP origin/path, issuer, audience, JWKS URL/key
   ID, redirect URI, permitted signing algorithms/claims, scoped principal ID, and any required
   Work registration values.
4. Put the following concise instructions in the package's agent/server-instruction artifact:
   use `list_markdown`/`search_markdown` or `read_markdown` before a mutation; preserve the opaque
   `revision`; call `update_markdown` only with that exact revision; on `CONFLICT`, stop, reread,
   explain that newer content exists, and retry only after the user chooses based on the new read;
   never silently retry/overwrite; and request explicit user confirmation before `archive_markdown`
   unless the user already requested archive. Describe create/update/archive as state-changing,
   revision-safe gateway operations; do not claim that a Work UI approval will happen.
5. Add a private-install and live-validation runbook. Its preflight confirms: deployed HTTPS MCP
   origin; exact operator-entered config matches the deployment-owned `workMcp` issuer/audience/JWKS
   settings; only supported signing algorithms/claims are accepted; a scoped Work identity reaches
   the adapter; no secret has been copied into package fields; and the gateway write gate remains
   independently fail-closed. The runbook must say not to substitute raw Drive capability evidence,
   a source revision, a local test, an OAuth login, or plugin installation for write authority.
6. Add an explicit operator harness/checklist using a unique disposable Markdown fixture inside the
   already-approved dedicated root. In a fresh private Work session, exercise list, search, read,
   create, read-after-create, update with the read revision, stale update conflict, archive with an
   expected revision, and read/list verification of the archive outcome. Exercise the current
   platform's write path once with the deployment's normal write-gate state and record the actual
   observed behavior as `passed`, `denied-as-expected`, `blocked-by-platform`, or another defined
   factual outcome; do not relabel an unobserved UI prompt as a pass. If the gate/lease is absent,
   an expected denied write is useful release evidence, not a failure to bypass.
7. Finish every harness run by archiving only its exact disposable file through the supported
   `archive_markdown` flow; never permanent-delete, trash, or clean up by broad path/name. If the
   session/test fails before archive, give the operator a manual, bounded recovery procedure for
   that unique fixture and record cleanup as incomplete. Keep raw conversation text, document
   content, screenshots, endpoint URLs, headers, tokens, JWTs, OAuth codes/cookies, secrets, and
   Drive IDs outside the repository.
8. Add/update only sanitized release-record template material. It may contain opaque build/origin
   identifiers or SHA-256 digests, selected configuration identifiers (not values), exact operation
   outcome labels, conflict evidence, observed write-approval behavior, and cleanup status. It must
   not alter `docs/client-validation-record.example.json`'s rule that this evidence is not write
   authority. Do not create a real record, signature, approval, or tenant configuration in Git.

## Expected control flow and invariants

```text
operator supplies tenant/deployment inputs outside Git
  -> private Work registration loads deployed HTTPS MCP origin
  -> Work sends bearer JWT
  -> PrincipalVerifier verifies configured issuer/audience/JWKS
  -> task-001 stateless MCP adapter accepts work-mcp only
  -> shared MarkdownService read method
     or pre-opened, separately authorized MarkdownWriteSession
  -> safe MCP result

operator-only fresh Work validation
  -> six-operation/conflict checklist
  -> sanitized release record + exact-fixture archive cleanup
```

Invariants:

- Plugin assets are declarative/instructional only and never call Drive, Work, OAuth, JWKS, the
  deployed gateway, or a local secret at import/test/build time.
- The package has no credential, token, cookie, authorization code, signed JWT/JWS, private key,
  refresh token, service-account key, Codex bearer, actual tenant URL, Drive ID, document body, or
  query-string URL.
- Work auth validates through the existing configuration/verifier; package settings do not create
  an alternate issuer, principal mapper, gateway credential, or Drive identity.
- The instructions do not widen the six-tool surface, authorize sharing/deletion, alter root/
  Markdown/size/revision semantics, or bypass the write gate. Archive remains a move.
- A `CONFLICT` remains a non-mutating result. The agent rereads rather than retries with stale data.
- Write-approval behavior is recorded only from the actual tenant/session and exact package build;
  no metadata annotation, administrative setting, or assumed UI replaces that observation.
- Live evidence is release evidence, not a `WriteGateDecision` input. It cannot enable writes.

## Test strategy and validation

Add static/fake-only tests for the checked-in package artifacts; no test may install a Work plugin
or make a network request. Test the repository's closed example/template parser or metadata
validator (once the operator has selected the current format) with only synthetic values and assert:

- all six tool names and the MCP origin placeholder/reference agree with task 001's exported
  contract; the package adds no tool or direct Drive/JSON endpoint;
- every operator-supplied field is explicit, uses an obviously synthetic placeholder in examples,
  and rejects/flags URLs with credentials, query/fragment, non-HTTPS values where the final format
  permits validation, and embedded secret/token-like values;
- concise instructions contain search/read-before-write, revision retention, conflict reread/no
  silent overwrite, and explicit archive-confirmation requirements, while not promising a Work UI
  approval;
- static examples and any release-record schema allow only sanitized identifiers/digests/outcome
  labels; sentinel content, raw Drive IDs, endpoint paths/URLs, headers, bearer strings, JWTs,
  OAuth codes/cookies, client secrets, private keys, Google credentials, lease/approval material,
  and secret paths are absent;
- the operator checklist covers list/search/read/create/update/stale conflict/archive, fresh-session
  execution, observed write-approval behavior, expected no-lease denial, and exact-fixture cleanup;
- imports/build/tests cause no Work, Drive, cloud, OAuth/JWKS, filesystem-secret, or live harness
  call.

Run focused static package tests after they exist, then the canonical local suite:

```bash
CI=true pnpm test -- tests/plugin
CI=true pnpm lint
CI=true pnpm format:check
CI=true pnpm typecheck
CI=true pnpm test
CI=true pnpm build
./scripts/verify-vendored-skills.sh
CI=true pnpm check
git diff --check
```

The live Work harness is an operator release gate, outside `pnpm check`, and only runs after task
001, deployment, current tenant/platform profile verification, and the separate raw Drive/write-gate
procedures are available. It must use operator-owned values outside the repository.

## Expected unchanged boundaries

- `src/domain/**`, `src/application/**`, `src/drive/**`, `src/write-gate/**`, `src/live-drive/**`,
  JSON API behavior, and all Drive/document policy.
- Task 001's MCP protocol implementation except for a narrowly necessary, already-finalized export
  or documented route/origin reference; package work must not reshape its adapter contract.
- Principal validation semantics in `src/auth/**` and deployment-owned `ServiceConfig` values.
- Cloud Run/Terraform/listener/secret provisioning, Work tenant administration, marketplace
  publication, Codex cloud client work, source credentials, real live evidence, status/task/build
  logs, and unrelated concurrent edits.

## Open questions and risky edges to verify before editing

- The operator must verify the exact current ChatGPT Work private-plugin registration/discovery
  format, its required artifact names, supported remote MCP transport profile, OAuth/JWT issuer,
  audience, redirect URI, JWKS key-selection/claim/algorithm requirements, and tool-annotation
  rendering. None is safely derivable from this repository; record it as the selected tenant/profile
  input rather than a hard-coded default.
- Verify the final task-001 route, official MCP SDK version, required headers/origin behavior, and
  whether the target platform makes a stateless request per tool without unexpected session
  requirements. A mismatch is adapter/package work to fix, never a reason to retain state or relax
  authentication/revision checks.
- Verify the exact user-facing write-approval behavior in a fresh private Work session. Record the
  observed result and conditions; if no prompt appears, do not infer approval or safety from its
  absence. The gateway's write lease remains the enforcement boundary regardless.
- Verify the designated dedicated test root/archive and operational cleanup owner before a live
  run. A failed/incomplete cleanup blocks release evidence from being marked complete and must not
  be resolved with deletion.
