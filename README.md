# Google Drive Markdown Gateway

A narrow service for controlled, revision-safe access to Markdown files stored in a dedicated
Google Drive folder.

The initial product and architecture brief is in
[`google-drive-markdown-gateway-handoff.md`](google-drive-markdown-gateway-handoff.md).

The current repository architecture and approved implementation program are in
[`ARCHITECTURE.md`](ARCHITECTURE.md) and
[`ai/features/epics/google-drive-markdown-gateway/`](ai/features/epics/google-drive-markdown-gateway/).

## Codex workflow setup

The repository vendors its planning, implementation, and review workflow skills under
`.agents/skills/` so Codex cloud does not depend on machine-local symlinks.

Verify the vendored snapshot with:

```bash
./scripts/verify-vendored-skills.sh
```

Before starting product planning or implementation in Codex cloud, follow
[`docs/codex-cloud-preflight.md`](docs/codex-cloud-preflight.md).
