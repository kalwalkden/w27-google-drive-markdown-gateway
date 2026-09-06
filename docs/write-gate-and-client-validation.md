# Deployment-owned write authority and client validation

Runtime write authority is deployment-owned. A revision can compose the server-side Drive writer
only when `enable_write=true` and the separate `acknowledge_write_risk=true` Terraform input is
reviewed. Both values default to false; omission produces a read-only runtime. The acknowledgement
is not passed to the service, and neither setting proves live Drive access or authorizes a client.

## Release evidence and enablement

1. Complete independent task/feature review against the immutable image, then
   verify the marked dedicated root/direct-child archive and server Drive ACLs.
2. Run the dedicated-folder experiment in
   [live-drive-capability-harness.md](live-drive-capability-harness.md). Keep sanitized output
   outside this repository.
3. Bind the probe evidence digest, immutable image digest, and canonical non-secret runtime-config
   digest to the candidate; none enables writes.
4. Review a Terraform plan with both write inputs explicitly true only when a deployment is meant
   to compose a server-side writer. Shared Drive ACLs are operator-owned. My Drive OAuth grants can
   be broader than the configured root, so application confinement and this residual risk require
   explicit review.
5. Deploy a controlled revision whose immutable image and non-secret config digest match the
   release input; verify liveness, unauthenticated denial, reads, one conflict, and
   `OUTCOME_UNKNOWN` reconciliation guidance.
6. Run separate Work and Codex flows in the pre-provisioned nested disposable folder. Record all
   six operation outcomes, duplicate/stale conflicts, archive verification, and archive-only cleanup.
7. Make a human release decision or roll back with `enable_write=false`; never delete Drive data,
   credentials, evidence, or secrets.
8. The capability harness and its evidence never enter runtime configuration, request
   authorization, writer construction, or a client session.

Work JWTs and Codex bearer credentials authenticate only to the gateway. Neither is a Google
credential or is forwarded to Drive. Only the selected server-side Google identity obtains the
read-only or write scope. Do not log credentials, tokens, headers, paths, revisions, evidence, or
document bodies.

## Later client release records

The record at [client-validation-record.example.json](client-validation-record.example.json) is a
synthetic template. It is release evidence only and has no runtime-authority effect.

For ChatGPT Work, record safe build/principal identifiers, the three immutable digests, the six
operation categories, duplicate/stale conflict results, archive verification, cleanup, and an
inconclusive manual-recovery category when needed. A timeout, transport uncertainty, or
`OUTCOME_UNKNOWN` is `not-observed` until a human rereads and reconciles; it is never converted to
an automatic retry or cleanup. Validate OAuth/JWT configuration with the actual private plugin only
after deployment; retain identifiers and digests, never tokens, JWTs, cookies, authorization codes,
URLs containing query strings, or secret locations.

For Codex cloud, record only safe environment/hostname identifiers, the narrow GET/POST methods,
the three digests, and closed stage categories. Confirm the cloud environment's network policy
allows only the exact gateway hostname and required methods. Do not use an unrestricted internet
allowlist or place Google credentials in Codex.
