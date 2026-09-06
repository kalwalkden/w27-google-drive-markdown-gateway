# Google Drive Markdown Gateway

A small gateway designed to give ChatGPT Work and Codex cloud controlled access to Markdown
files in Google Drive. Keep specifications, implementation briefs, blog drafts, and working
notes in one dedicated folder, ready for both people and AI agents to use.

**Status: pre-implementation.** This repository currently contains the product brief and
development workflow. The gateway, integrations, and client commands described below are
planned; there is no runnable service or installable client yet.

## Why this project?

Working across AI tools can mean copying documents between conversations, repositories, and
apps. This project aims to let those tools work on the same ordinary `.md` files in Google Drive.

The intended benefits are:

- **One source of truth:** use the same specifications and drafts from ChatGPT Work, Codex cloud,
  and your usual Google Drive workflow on macOS, iPhone, and iPad.
- **Portable documents:** keep content as plain UTF-8 Markdown, editable with your preferred tools.
- **Conflict-aware edits:** require the revision returned by a read when updating a file, so an
  agent cannot silently overwrite a newer version.
- **Limited access:** confine every gateway operation to one configured Markdown folder tree.
- **Centralized credentials:** keep Google credentials on the service, with separate authenticated
  access for each client.
- **Focused scope:** provide a small set of document operations without building a general
  integration platform or another document editor.

## Planned usage

For example, you could draft a feature brief with ChatGPT Work, have Codex cloud read it while
implementing the feature, and review the same file through Google Drive.

The gateway is planned to support six operations:

| Operation | Purpose |
| --- | --- |
| List | Find Markdown files within the configured folder tree. |
| Search | Search filenames, with content search if practical. |
| Read | Retrieve file content and its current revision. |
| Create | Add a Markdown file without replacing an existing file. |
| Update | Replace content only when the expected revision matches. |
| Archive | Move a file into a configured archive folder without trashing or permanently deleting it. |

The editing workflow is to read a file, retain its revision, and submit changes with that
revision. If the file has changed in the meantime, the planned behavior is to return a conflict
and preserve the newer content so the caller can read it again and reconcile the changes.

## Planned architecture

```text
ChatGPT Work ── Remote MCP over HTTPS ──┐
                                      v
                              Markdown Gateway ── Google Drive API ── Markdown folder
                                      ^
Codex cloud ── Authenticated client ────┘
```

The architecture baseline is one small service on Google Cloud Run, with shared application
logic behind its client interfaces. ChatGPT Work is intended to connect through a private
plugin using remote MCP. Codex cloud will use remote MCP or a small HTTPS client, depending
on platform validation.

Google authentication will be selected based on whether the destination is My Drive or a
Google Workspace Shared Drive. Client compatibility and authentication still need to be
validated before implementation.

The scope excludes Google Docs, Sheets, and Slides editing; sharing or permission changes;
permanent deletion; binary files; and access to unrelated Drive content. Folder boundaries,
revision checks, and credential handling are implementation requirements, not guarantees
provided by the current repository.

## Get involved

Start with the
[`product brief and architecture baseline`](google-drive-markdown-gateway-handoff.md)
for the proposed contracts, safety rules, and delivery backlog. The first milestone is to
validate Drive operations, revision-safe updates, authentication, and access from both clients.
Deployment and installation instructions will follow implementation.

For repository development, read [`AGENTS.md`](AGENTS.md) and run the current setup check from
the repository root:

```bash
./scripts/verify-vendored-skills.sh
```

The repository includes its planning, implementation, and review skills under
[`.agents/skills/`](.agents/skills/) so the workflow does not depend on machine-local skills.
Before planning or implementing in Codex cloud, follow the
[`runtime preflight`](docs/codex-cloud-preflight.md). Feature work follows the documented
planning, approval, task review, and feature review gates.

Do not commit Google credentials, refresh tokens, service-account keys, OAuth client secrets,
or gateway bearer credentials.

## License

Licensed under the [MIT License](LICENSE).
