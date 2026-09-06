# Operator Cutover and Cross-Client Verification — Implementation Plan

## Scope

After task 001 supplies the exact manifest/plan contract, add an operator-only
cutover runbook, closed external evidence schema, and non-live preflight
harness. The implementation validates only local plan/checklist/evidence
grammar. It never configures a tenant, deployment, egress, secret, root,
client, or device and never dispatches a gateway/Drive mutation.

The current local and deployment-default state is read-only: absent or false
`write.enabled` yields `UNSUPPORTED`. A controlled, deployment-owned
write-enabled revision can support create, update, and archive only after the
independent Terraform, capability-probe, ACL, digest, and operator gates are
accepted. No checked-in test or evidence record changes that authority.

## Binding decisions

| Decision | Implementation effect | Provenance |
| --- | --- | --- |
| Task 001 is the single migration allowlist. | Accept its verified plan/digest only; never scan Git, choose a target, accept a glob, or bulk sync. | Task 001; Epic 6. |
| Nested paths and archive are current gateway capabilities. | The future procedure targets one exact manifest-approved nested path in a pre-provisioned dedicated folder and archives only the captured file to the configured archive folder after successful proof. | Current service/Work/Codex contracts. |
| Writes remain default-off and deployment-owned. | Current preflight records `BLOCKED`/`WRITE_UNAVAILABLE`; it must not treat static code, a bearer, plugin registration, or client availability as a write lease. | `service-config`, runtime, Terraform/write-gate guidance. |
| Unknown mutation results are terminal to automation. | `OUTCOME_UNKNOWN`, timeout, malformed output, and transport uncertainty stop the attempt. No retry, overwrite, cleanup, rollback, delete, trash, or automatic archive follows; manual reread/reconciliation is required. | JSON/MCP/CLI and Work/Codex instructions. |
| Archive is archive-only cleanup. | Archive occurs only with captured identity/current revision after verified readback; destination identity must be confirmed. A failed/inconclusive archive remains external manual recovery, never a delete/trash fallback. | `MarkdownService.archiveMarkdown`; client validation guide. |
| Release evidence is sanitized and external. | Keep only opaque release/environment/client-profile identifiers, three relevant digests, closed operation/gate states, and manual-recovery state. Exclude paths/names/content/digests, IDs, revisions, endpoints, secret references, raw responses, errors, screenshots, and account/device data. | `docs/client-validation-record.example.json`; live evidence patterns. |

## Operator contract

Create `docs/planning-file-cutover.md`, a synthetic evidence example, a closed
evidence/preflight module under `src/planning-migration/`, and an opt-in
`migration:cutover-preflight` script. Require explicit confirmation plus
external non-secret config and external exclusive output. Reject repository
paths, symlinks, existing output, unknown fields, unsafe values, invalid state
transitions, and any completed declaration inconsistent with required gates.

The preflight can validate task-001 plan data in process. It must have no
shell, `md-drive`, fetch, MCP, Drive SDK, OAuth, credential, WriteGate,
browser, or device dependency. A local preflight `PASSED` means only that a
future operator checklist is internally well formed—not that any live gate
passed.

Future operator flow, outside implementation/CI:

```text
verified plan + immutable image/runtime/probe digests
  -> reviewed default-off or controlled write-enabled Terraform revision
  -> dedicated nested target + configured archive + destination check
  -> one authorized create; exact revision/byte readback
  -> update + stale conflict proof; archive verification
  -> fresh Work, clean Codex, macOS, iPhone, iPad read visibility
  -> sanitized external evidence and source-of-truth decision
```

Before the single create, the operator verifies current Work private-plugin
registration/OAuth, Codex secret injection and exact HTTPS host GET/POST
egress, server identity/ACL, dedicated nested folder topology, archive
location, live Drive capability evidence, Terraform plan, and matching
immutable image/non-secret-runtime/probe digests. A method-control limitation
is recorded precisely, never compensated by broad Internet access.

The create uses exactly the manifest target and collision policy. A duplicate,
ambiguity, conflict, or uncertain result stops. After a successful readback,
the same exact document is read from fresh Work, fresh Codex, macOS, iPhone,
and iPad contexts. Devices perform no convenience writes. Archive cleanup uses
the current reread revision and only the captured file; it is not permission to
archive a discovered/broad-name result.

## Evidence and invariants

Use finite statuses `NOT_STARTED`, `BLOCKED`, `PASSED`, `FAILED`, and
`INCONCLUSIVE`; reason codes include `WRITE_UNAVAILABLE`,
`CLIENT_NOT_CONFIGURED`, `DESTINATION_COLLISION`, `READBACK_MISMATCH`,
`CONFLICT`, `OUTCOME_UNKNOWN`, `TRANSPORT_UNCERTAIN`,
`ARCHIVE_VERIFICATION_FAILED`, and `MANUAL_RECOVERY_REQUIRED`. Unknown keys or
recursive sensitive key names fail closed.

- Completion requires all required operation/read observations and archive
  verification where a created test object requires cleanup.
- `UNSUPPORTED` is a blocked/inconclusive deployment finding, not a reason to
  bypass the gateway or downgrade safety checks.
- Evidence is release documentation only and cannot affect writer composition,
  principal verification, write-gate evaluation, or lease issuance.
- There is no broad sync, permanent deletion, trash, auto-retry, or automatic
  cleanup interface.

## Implementation approach

1. Reuse task-001 plan types, strict external-path posture, and current
   client-record vocabulary; do not duplicate the manifest parser.
2. Add closed evidence/checklist parsing, recursive redaction, transition
   validation, and atomic restrictive external writer with injectable seams.
3. Add direct ESM preflight execution with fixed redacted diagnostics and no
   process/client runner.
4. Write current-block and future-authorized runbook sections with exact
   nested-path/archive/default-off/recovery language.
5. Add fake/static tests for all blocked and failed states, output safety,
   redaction, no-client behavior, Work/Codex contract references, five client
   observations, one-dispatch/manual recovery, and archive verification.

## Current-tree evidence and boundaries

Task 001 is still to be implemented. Current service code supports bounded
nested paths and verified archive moves; the runtime composes the guarded writer
only for `write.enabled`. The committed Work package/instructions and Codex
setup/harness use the six operations, nested validation areas, explicit
archive confirmation, default-off handling, `CONFLICT`, and
`OUTCOME_UNKNOWN` recovery. Their actual tenant/cloud/live state remains
operator-owned and unavailable here.

Do not edit application/Drive/auth/write-gate/runtime/transports, deployment,
client package/configuration, operations docs, credentials, feature status,
tasks, or build log. Do not run any external preflight or live verification.

## Validation

```bash
CI=true pnpm test -- tests/planning-migration
CI=true pnpm lint
CI=true pnpm format:check
CI=true pnpm typecheck
CI=true pnpm test
CI=true pnpm build
./scripts/verify-vendored-skills.sh
CI=true pnpm check
git diff --check
```

## Risks

Do not let a future-capable archive or nested path become an implicit
permission. Recheck task-001 output and committed Work/Codex contracts before
implementation; live operator evidence and deployment state remain separate
gates.
