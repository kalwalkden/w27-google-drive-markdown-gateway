# Codex cloud Markdown client setup

This guide is project-scoped. It configures neither a cloud environment nor a
gateway; it prepares an operator to use the checked-in `md-drive` client after
those systems already exist. Repository skill/runtime readiness is separate:
see [codex-cloud-preflight.md](codex-cloud-preflight.md).

## Current status

This repository currently runs locally. No Codex cloud session, deployed
gateway, credentials, or tenant/platform controls are available here. Live
validation is **BLOCKED** until an operator verifies the current platform
controls in a clean cloud environment. Local runtime can select a subagent
model explicitly; do not infer that a cloud runtime can.

## Operator setup

1. Check out the approved revision, run `./scripts/verify-vendored-skills.sh`,
   then build the checked-in client with `pnpm build`. Run it as
   `node dist/codex-cli/cli.js`; do not globally install a client or download
   an unpinned package.
2. In the current Codex cloud environment controls, verify and record whether
   project secret injection and exact-hostname egress controls are available.
   Do not assume a UI label or configuration schema. If method controls are
   unavailable, record that limitation; do not claim method enforcement.
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

Load `$codex-cloud-markdown-gateway`. Read before writing and retain the
revision. Use one explicit update. On `CONFLICT`, reread and ask; on timeout or
transport uncertainty, do not retry a mutation and reread before any later
action. `UNAUTHENTICATED` means check the scoped injected bearer;
`UNSUPPORTED` means the independently controlled write session/gate is not
available. Explicit archive intent is required. Do not substitute raw HTTP,
`curl`, a cloud egress policy, or a passing client check for write authority.

## Operator-only release check

`pnpm codex-cloud:harness -- run --config <external-config> --output
<external-evidence> --confirm W27_CODEX_CLOUD_TEST_ONLY` is never CI/setup
behavior. Run it only in a clean, operator-configured cloud environment with a
dedicated validation location and external output path, after current platform
controls and gateway deployment are verified. It is evidence only: a missing
lease or unavailable write blocks release validation and never authorizes a
bypass.
