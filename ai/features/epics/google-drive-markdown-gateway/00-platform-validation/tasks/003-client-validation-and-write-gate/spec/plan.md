# Client Validation and Write Gate — Implementation Plan

## Scope

Add the typed, fail-closed authorization boundary required by every future production Drive mutation. It consumes sanitized task-002 proof evidence and a separate operator-signed approval statement. It also documents later manual ChatGPT Work OAuth/JWT and Codex cloud network validation.

This task adds no Google Drive, Work, Codex, MCP, CLI, credential, endpoint, deployment, or production-write call. Tests use only synthetic evidence and locally generated test keys.

## Binding decisions and constraints

| Decision | Implementation effect | Provenance |
| --- | --- | --- |
| Default deny | `WriteGate` returns a typed denial unless every validation succeeds. There is no enable flag, `skipValidation`, environment override, or permissive fallback. | Approved brief; task-002 invariant; handoff safety rules |
| Evidence is not authority | Require a separate signed approval that binds SHA-256 of exact evidence bytes to the gateway environment, Drive topology, and expiry. A passing JSON record or hash alone never enables writes. | Task objective; task-002 discarded per-run HMAC key |
| External trust root | Keys, expected environment, opaque Drive configuration fingerprint, and replay state are injected through a narrow runtime port and provisioned outside Git. Do not commit trust values, signing keys, evidence, approvals, or a write-enable setting. | No repository-change bypass constraint; handoff rotation rules |
| Atomic proof only | Accept only task-002 evidence with `outcome: SUPPORTED`, cleanup `ARCHIVED` or `ALREADY_ARCHIVED`, and both stale content/parent tests proving sent `If-Match`, HTTP 412, and unchanged readback. | Task 002 plan; approved brief |
| Fresh, scoped approval | Approval binds evidence digest, auth mode, topology, environment, fingerprint, approval ID, issued time, and expiry. Reject mismatch, expiry, excessive lifetime, or future date outside small clock skew. | Brief; handoff separate-principal rules |
| Interoperable integrity | Verify compact JWS only with protected `alg: EdDSA` and `Ed25519` keys selected by `kid`, using maintained JOSE code. Reject `none`, other algorithms, embedded keys, unexpected headers, and unknown payload fields. | Security decision; RFC references |
| Replay protection | Atomically consume approval ID in injected `ConsumedApprovalStore` before issuing a lease. Provide only test in-memory storage; later deployment owns durable storage. | Durable-gate requirement |
| Safe diagnostics | Return allowlisted reason codes and safe audit metadata only; never evidence bodies, raw IDs, JWS strings, keys, tokens, headers, paths, or content. | Repository security policy; task-002 redaction |

Repository-only checks cannot withstand a source change. The enforced boundary is fail-closed code plus an operator-owned trust root, signed approval, and durable replay store outside the repository. The runbook must require deployment review for changes to any of those.

## Visual design

No visual design applies. Output is concise, content-free denial text and allowlisted structured audit data.

## Product alignment

The handoff requires revision-safe updates and separate Google, ChatGPT, and Codex principals. Task 002 establishes whether Drive provides the required atomic condition. This task turns that result into a future mutation gate without treating `version`, Git state, or local tests as production permission. Work/Codex records are release evidence, not write authority.

## Proposed contracts

Create import-safe modules under `src/write-gate/`; exact filenames may change only if trust, parsing, gate, replay, and audit ownership stays separate. Import task-002 `LiveDriveEvidence` parser rather than copying its shape. The gate receives exact UTF-8 evidence bytes plus the parsed record, computes SHA-256 itself, and requires it to equal the signed value.

The evidence semantic validator requires explicitly supported schema/probe versions, `SUPPORTED` outcome, verified cleanup, successful create/download and fresh updates, and both stale checks reporting sent `If-Match`, exact 412, and unchanged post-rejection state. A missing check, named check without readback, or `version`/`headRevisionId` alone is denial. Auth mode/topology must match approval and runtime policy. If final task-002 schema differs, update this plan before coding; do not weaken proof.

Define this closed compact-JWS payload:

```json
{
  "schemaVersion": 1,
  "approvalId": "UUID",
  "gatewayEnvironment": "operator-managed identifier",
  "driveConfigurationFingerprint": "sha256:<64 lowercase hex characters>",
  "evidenceSha256": "sha256:<64 lowercase hex characters>",
  "authMode": "shared-drive-adc",
  "topology": "shared-drive",
  "issuedAt": "RFC 3339 UTC timestamp",
  "expiresAt": "RFC 3339 UTC timestamp"
}
```

The protected header contains only `alg: "EdDSA"`, nonempty `kid`, and `typ: "w27-drive-write-approval+jws"`. Runtime policy maps `kid` to current keys and sets max lifetime/clock skew. Rotation is additive until every approval from a retired key expires. The Drive fingerprint comes from operator-managed deployment configuration without folder IDs; it is not task-002 per-run HMAC data and is never computed from Git.

Use a discriminated decision: `type WriteGateDecision = { allowed: true; lease: WriteLease; audit: AllowedWriteGateAudit } | { allowed: false; reason: WriteGateDenialReason; audit: DeniedWriteGateAudit };`. `WriteLease` is opaque, nonce-bound, short lived, and issued only after atomic `consumeOnce`. Future create/update/archive methods must revalidate it immediately before dispatch. Reads never need a lease. Inject `Clock`, `JwsVerifier`, `ConsumedApprovalStore`, and `RuntimeWriteGateTrust`. Do not wire the gate into `src/index.ts` in this task.

## Implementation sequence

1. Inspect final task-002 evidence parser, check IDs, and probe version. Export a strict parser there if absent; do not duplicate it.
2. Add a minimal audited JOSE dependency/lockfile update only if needed. Add no private signing key or usable trust material.
3. Implement pure evidence semantics, approval parsing, Ed25519 JWS verification, runtime binding, freshness, safe reason mapping, consume-once flow, and opaque lease validation.
4. Add only a test in-memory replay store. Specify the durable-store port; do not create file/repository-backed production storage.
5. Add synthetic unsigned approval and client-validation templates. Never add a signed, copy-pastable approval.
6. Add `docs/write-gate-and-client-validation.md`: run task 002; inspect sanitized evidence; issue short-lived Ed25519 approval with an operator-owned system; provision verification keys, environment/fingerprint, and replay storage outside Git; deploy; revoke/rotate when proof, key, credential, topology, or environment changes. State no approval overrides unsupported, inconclusive, malformed, stale, or cleanup-failed evidence.
7. The runbook defines later Work records (plugin build, MCP origin, OAuth issuer/audience/redirect URI, JWKS rotation, scoped principal, read test, write approval behavior) and Codex records (environment/revision, exact gateway hostname, narrow methods, separate principal key ID, health/read test, expected denied write without lease). They contain identifiers/digests only, never tokens, JWTs, cookies, codes, secret paths, query-string URLs, arbitrary allowlists, or content. Neither record feeds `WriteGateDecision`.

## Data flow and invariants

```text
future mutation -> WriteGate.evaluate
  -> evidence parse + semantic atomic-proof validation
  -> SHA-256 exact evidence bytes
  -> Ed25519 JWS verification against deployment trust root
  -> environment/topology/fingerprint/freshness binding
  -> durable consume-once approval ID
  -> opaque short-lived write lease -> future Drive mutation
```

Any parse, integrity, signature, key, scope, freshness, replay, evidence, or cleanup failure produces a typed denial with no Drive request. Future code must not translate denial into compare-then-update.

## Test strategy

Use fake-only Vitest coverage for absent/malformed evidence, approval, or trust; unknown fields; every non-supported outcome; cleanup failures; missing stale checks; 412 without unchanged readback; byte-level digest changes including whitespace/field order; version/auth/topology/environment/fingerprint mismatch; generated Ed25519 valid JWS; unknown/retired `kid`; wrong algorithm/`none`/embedded key/header/serialization/tamper/duplicate-field attacks; issued/expiry/skew/lifetime boundaries via fake time; atomic one-time consumption and store failure; opaque/expired/fabricated lease rejection; recursive redaction; and import/app-construction safety with no network, credential, file, environment, or mutation work. No fixture resembles live credentials, Drive IDs, signed approval, or environment.

## Exact validation commands

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
./scripts/verify-vendored-skills.sh
pnpm check
git diff --check
```

Do not run task-002 live probes, signing, Work OAuth/JWT, Codex cloud calls, or credential lookup in automated validation. They are operator-controlled release gates.

## Current-tree boundaries and open questions

Task 001 created the TypeScript baseline. Task 002 is concurrently adding raw-probe evidence; implement task 003 only against its committed output. Keep `src/index.ts`, `tests/index.test.ts`, task-002 live behavior, vendored skills, handoff, statuses, and existing `pnpm check` components unchanged. Do not add a Drive adapter, service, endpoint, MCP/plugin, Codex CLI, deployment, or live configuration loader.

No open question exists for this task. Durable replay storage and trust-root provisioning are intentionally later work; their ports remain fail-closed until then.
