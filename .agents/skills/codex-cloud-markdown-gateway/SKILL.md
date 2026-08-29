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

Read first: use `node dist/codex-cli/cli.js list`, `search`, or `read` before
a mutation. Retain the returned opaque revision. Issue one explicit update with
that revision. On `CONFLICT`, stop, reread, describe the newer state, and wait
for the user's choice. Never silently retry or overwrite. Ask for explicit user
confirmation before archive unless it was already requested.

Never put a bearer, endpoint value, secret-file reference, Drive credential,
or document content in Git, prompts, command arguments, diagnostics, or
evidence. Do not broaden egress. The operator-only cloud harness is a release
check and runs only when explicitly requested; normal tests remain fake/static.
