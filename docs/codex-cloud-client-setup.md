# Codex cloud Markdown client setup

This guide is project-scoped. It configures neither a cloud environment nor a
gateway; it prepares an operator to use the checked-in `md-drive` client after
those systems already exist. Repository skill/runtime readiness is separate:
see [codex-cloud-preflight.md](codex-cloud-preflight.md).

## Default status

This repository currently runs locally. No Codex cloud session, deployed
gateway, credentials, or tenant/platform controls are available here. The local
and deployment-default state is read-only: absent or false `write.enabled`
returns `UNSUPPORTED` and no mutation occurs. Only an operator-selected,
controlled write-enabled revision may be tested after the separate release
gates; local tests never constitute live validation.

## Operator setup

1. Check out the approved revision, run `./scripts/verify-vendored-skills.sh`,
   then install the locked toolchain and dependencies with `mise install` and `mise run install`,
   then build the checked-in client with `mise run build`. Run it as
   `node dist/codex-cli/cli.js`; do not globally install a client or download
   an unpinned package.
2. In the current Codex cloud environment controls, verify and record whether
   project secret injection and exact-hostname egress controls are available.
   Do not assume a UI label or configuration schema. If method controls are
   unavailable, record that limitation; do not claim method enforcement. The
   external harness configuration records the check timestamp and the observed
   state of credential injection, exact-hostname egress, and method egress; it
   must not use the former `operator-must-verify` placeholder.
3. Inject `MD_DRIVE_GATEWAY_URL` and exactly one of
   `MD_DRIVE_BEARER_TOKEN` or `MD_DRIVE_BEARER_SECRET_FILE` using the
   platform's secret value or mounted-file facility. Values stay outside Git,
   prompts, examples, logs, and release evidence. Rotate the injected Codex
   bearer independently; do not change source or share a Google secret.
4. Allow outbound traffic only to the one canonical HTTPS gateway hostname.
   The client uses `GET` for list/search/read and `POST` for
   create/update/archive. Do not allow `PATCH`, wildcards, IP addresses, URL
   paths, queries, redirect domains, package registries, Google APIs, broad
   Internet access, or a proxy. A redirect is a client protocol failure: fix
   the configured gateway hostname rather than expanding egress.

Never inject Google OAuth JSON, refresh tokens, service-account credentials,
`GOOGLE_APPLICATION_CREDENTIALS`, Drive IDs, private keys, or gateway values
into source control.

## Normal use and recovery

Load `$codex-cloud-markdown-gateway`. Read before writing and retain the exact
opaque revision. List/search may use a nested `--path`; update/archive use that
revision. On `CONFLICT`, reread and ask; on `OUTCOME_UNKNOWN` (exit 9), timeout,
or transport uncertainty, do not retry, clean up, or archive automatically:
manually reread and reconcile before any later action. `UNAUTHENTICATED` means check the scoped injected bearer;
`UNSUPPORTED` means the independently controlled write session is not
available. Explicit archive intent is required. Do not substitute raw HTTP,
`curl`, a cloud egress policy, or a passing client check for write authority.

## Operator-only release check

`mise run codex-cloud:harness -- run --config <external-config> --output
<external-evidence> --confirm W27_CODEX_CLOUD_TEST_ONLY` is never CI/setup
behavior. Run it only in a clean, operator-configured cloud environment with a
pre-provisioned nested validation folder and external output path, only after a
marked dedicated root/archive, provider probe, reviewed Terraform plan, and a
controlled revision whose immutable image/config/probe digests match the input.
It validates list/search/read/create, duplicate refusal, update, stale conflict,
and archive verification. `UNSUPPORTED` is an inconclusive disabled-mode result
with no later mutation. It is evidence only and never authorizes a bypass.

If a harness mutation receives an uncertain transport result or `OUTCOME_UNKNOWN`,
its evidence retains only an opaque run reference and the fixed direction to
manually reread the exact generated run file, then archive only if identity and
revision are proved. It never records
the generated path, file ID, revision, content, endpoint, operation ID, or raw
diagnostics. Archive can pass only after the returned identity and destination
match the exact generated file and configured archive semantics; otherwise
cleanup remains inconclusive and manual cleanup is required.
