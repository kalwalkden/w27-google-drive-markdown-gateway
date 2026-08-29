---
name: codex-cloud-markdown-gateway
description: Use the checked-in md-drive client from a configured Codex cloud environment to operate the Markdown gateway safely. Use for ordinary cloud gateway work, not for provisioning or live release validation unless explicitly requested.
---

# Codex Cloud Markdown Gateway

Before using this skill, the operator must complete
`docs/codex-cloud-client-setup.md` and inject `MD_DRIVE_GATEWAY_URL` plus
exactly one scoped bearer input outside Git. After the project build, use
`node dist/codex-cli/cli.js`; do not use raw HTTP, `curl`, Google APIs, or any
Google credential.

Use only the six operations: `list_markdown`, `search_markdown`,
`read_markdown`, `create_markdown`, `update_markdown`, and `archive_markdown`.
List/search can use an exact nested `--path`. Before update or archive, read
the selected path or opaque ID and retain its exact opaque revision. Create only
at an intended `.md` path in an existing verified folder; do not turn a
duplicate refusal into an update. Issue one update with that revision.

On `CONFLICT`, stop, reread, describe the newer state, and wait for the user's
choice. `OUTCOME_UNKNOWN` (CLI exit 9), a timeout, or transport uncertainty can
mean a mutation applied: do not retry, archive, clean up, roll back, or claim a
failure. Manually reread and reconcile before any later mutation. Ask for
explicit user confirmation before archive unless it was already requested.
Never silently retry or overwrite.

Never put a bearer, endpoint value, secret-file reference, Drive credential,
or document content in Git, prompts, command arguments, diagnostics, or
evidence. Do not broaden egress. The operator-only cloud harness is a release
check and runs only when explicitly requested; normal tests remain fake/static.
Local/default configuration is write-disabled. `UNSUPPORTED` means the
deployment-owned write mode is disabled or unavailable; it never permits a raw
HTTP, Google API, or alternate-client bypass. A controlled operator release run
uses only a marked dedicated tree, exact image/config/probe digests, and
sanitized evidence; it does not enable writes or perform provisioning.
