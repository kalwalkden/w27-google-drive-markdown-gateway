# Live Drive capability harness

This is an operator-run safety experiment. It never runs in tests or normal validation. A
`SUPPORTED` result proves only the observed Drive deployment accepted stale `If-Match` requests for
this exact experiment; it does not enable product writes.

## Prepare a dedicated test area

Create a disposable Drive folder and a separate archive folder directly inside it. Set this exact
app property on the disposable root through your Drive administration tooling:

```text
w27MarkdownGatewayTestRoot = v1
```

The harness refuses every unmarked root, an archive that is not its direct child, mismatched Drive
topologies, and My Drive/Shared Drive mode mismatches. It creates one Markdown blob with a unique
run ID, then moves only that exact blob to the archive. It never deletes or trashes files.

Copy `config/live-drive-probe.example.json` outside this repository, replace the two placeholder
folder IDs, and keep the resulting configuration out of version control.

## Credentials

For Shared Drives, use `authMode: "shared-drive-adc"`. Configure Application Default Credentials
outside the repository, preferably an attached service account, workload identity, local ADC, or
impersonation rather than a downloaded key. Grant that principal only the access needed for this
test root and archive.

For My Drive, use `authMode: "my-drive-refresh-token"` and create a JSON file outside the
repository with mode `0600`:

```json
{ "clientId": "...", "clientSecret": "...", "refreshToken": "..." }
```

Obtain the refresh token through the OAuth web-server flow with offline access. Google may only
return a refresh token on the first authorization unless consent is forced. Revocation or expiry
requires reauthorization. The harness does not implement a consent flow. OAuth cannot issue a
folder-scoped token; prefer `drive.file` only when the OAuth app can already access these folders.
Do not widen the scope silently.

## Run

Build first, then invoke the explicit command. The output must be an unused path outside the
repository.

```bash
pnpm build
W27_DRIVE_PROBE_OAUTH_SECRET_FILE=/absolute/path/to/oauth-secret.json \
  pnpm drive:probe -- run \
  --config /absolute/path/to/live-drive-probe.json \
  --output /absolute/path/outside-repository/live-drive-result.json \
  --confirm W27_DRIVE_TEST_ONLY
```

Omit `W27_DRIVE_PROBE_OAUTH_SECRET_FILE` for ADC. The result records only digests, byte lengths,
opaque per-run identifier references, ETags, versions, and revision IDs. It records no content,
folder IDs, URLs, credentials, paths, request/response bodies, or error details.

A zero exit code requires recorded operation statuses: a 2xx create and both current-ETag fresh
updates, plus HTTP 412 for both stale mutations. Each proof also records a separate successful
metadata/download readback; the evidence gate rejects older schema versions or records that blur
the mutation response with that readback. The created file must be verified in the archive.
`UNSUPPORTED`, `INCONCLUSIVE`, configuration failure,
and cleanup failure are nonzero and preserve the fail-closed write policy. If a hard kill prevents
cleanup/evidence, inspect only the marked dedicated test root for the fixed
`w27-drive-capability-` filename prefix and move the disposable Markdown file to the archive.

`SIGINT` and `SIGTERM` stop the active probe request and enter the same cleanup path. A hard kill,
machine loss, or forced process termination can still bypass cleanup.
