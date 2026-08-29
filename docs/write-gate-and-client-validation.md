# Write gate and client validation

The gateway does not have a configuration switch that enables writes. A future mutation is denied
unless this gate validates a successful raw Drive capability record and a short-lived, separately
signed approval. Source changes, a Git revision, a Drive `version`, or a passing local test never
substitute for that proof.

## Write-gate release procedure

1. Run the dedicated-folder experiment in
   [live-drive-capability-harness.md](live-drive-capability-harness.md). Keep its sanitized output
   outside this repository.
2. Confirm the record has `outcome: "SUPPORTED"`, `cleanup.status` of `ARCHIVED` or
   `ALREADY_ARCHIVED`, and both stale checks show `If-Match`, HTTP 412, and successful unchanged
   readback. Unsupported, inconclusive, malformed, stale, or cleanup-failed evidence cannot be
   overridden.
3. In an operator-owned signing system, create an Ed25519 compact JWS with only the protected
   header `alg: EdDSA`, a provisioned `kid`, and
   `typ: w27-drive-write-approval+jws`. Its unsigned payload shape is documented in
   [write-approval.payload.example.json](write-approval.payload.example.json). Bind it to the
   SHA-256 of the exact evidence bytes, the deployment environment, the configured Drive topology,
   auth mode, and an opaque Drive-configuration fingerprint. Never create signing keys, a signed
   approval, or trust values in this repository.
4. Provision at least one public verification key, expected environment, opaque fingerprint, short
   approval lifetime, maximum evidence age, clock skew, and a durable transactional replay store
   through deployment-owned secret and configuration systems. The maximum evidence age is a
   deployment policy, bounded by the gateway, so a newly signed approval cannot bless an arbitrarily
   old Drive probe. Review changes to any of those systems as a write-authority change. Add a new
   `kid` before retiring an old one, then retain both until all approvals from the old key have
   expired.
5. Deploy the gate and submit the exact evidence bytes, its separately parsed record, and the JWS
   to obtain a lease. A replayed approval is denied because its ID is atomically consumed before a
   lease is issued.

The resulting lease is opaque, process-local, and short-lived. It is not a bearer credential to
store, log, or send to a client. A restart invalidates it. Its expiry is the earlier of the configured
lease lifetime and the signed approval expiry. Future create, update, and archive boundaries must
call `validateLease` immediately before dispatching their Drive request; reads do not need a lease.
A lease expires without fallback to an approval, so a new approval is required after expiry.

Only allowlisted decision and audit reason codes may be logged. Never log evidence content or raw
identifiers, JWS strings, approval IDs, keys, credentials, request headers, folder paths, or
document bodies.

## Later client release records

The record at [client-validation-record.example.json](client-validation-record.example.json) is a
synthetic template. It is release evidence only and has no effect on `WriteGateDecision`.

For ChatGPT Work, record the private plugin build and MCP origin identifiers, OAuth issuer,
audience, redirect URI and JWKS key identifiers, the scoped Work principal identifier, a successful
read test, and the expected write-approval behavior. Validate OAuth/JWT configuration with the
actual private plugin only after deployment; retain identifiers and digests, never tokens, JWTs,
cookies, authorization codes, URLs containing query strings, or secret locations.

For Codex cloud, record the environment/revision identifier, exact gateway-hostname identifier,
the narrow methods needed by the client, separate principal key identifier, health/read tests, and
an expected denied write test without a lease. Confirm the cloud environment's network policy
allows only the exact gateway hostname and required methods. Do not use an unrestricted internet
allowlist or place Google credentials in Codex.
