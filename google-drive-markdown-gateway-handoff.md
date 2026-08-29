# Google Drive Markdown Gateway

## Handoff to the implementation session

This document is the product brief, architecture baseline, and initial epic backlog for a small service that gives ChatGPT Work and Codex cloud controlled read/write access to Markdown files stored in Google Drive.

Copy this file into the root of the new implementation repository as `HANDOFF.md`. The first implementation session should review it, record any changed decisions, create the project skeleton, and work through the epics in order.

## Decision

Build a narrow Google Drive gateway rather than adopt Composio.

This decision is based on the expected scope for the next year:

- Google Drive is the only external content system.
- The content is literal `.md` files, not Google Docs.
- ChatGPT Work and Codex cloud both need read and write access.
- The same files must remain available through Google Drive on macOS, iPhone, and iPad.
- Credential control and a small data-processing surface are more important than adding many integrations quickly.

Do not recreate a general integration platform. The service should expose only the operations needed for this workflow.

## Product goal

Create one dependable folder of Markdown files in Google Drive that can serve as the source of truth for specifications, implementation briefs, blog drafts, and related working documents.

A person or agent should be able to:

1. List and search Markdown files within the configured folder tree.
2. Read a file with its current revision identifier.
3. Create a new Markdown file.
4. Update a file only when the caller supplies the revision it previously read.
5. Move or archive a file within the configured folder tree.
6. Use those operations from ChatGPT Work and Codex cloud.

## Non-goals

- General access to all of Google Drive
- Google Docs, Sheets, or Slides editing
- File sharing or permission management
- Permanent deletion
- Binary file storage or conversion
- Multi-user collaboration features beyond Google Drive's existing behavior
- Rich-text editing
- A web application or document editor
- Integrations with Slack, Notion, Gmail, or other services

## Recommended repository layout

```text
google-drive-markdown-gateway-handoff.md
README.md
AGENTS.md
docs/
  architecture.md
  operations.md
  threat-model.md
src/
  core/
  drive/
  http/
  mcp/
  auth/
scripts/
tests/
infra/
```

The implementation session may adjust this layout after selecting the language and deployment tooling.

## Architecture baseline

Use one small service deployed to Google Cloud Run.

```text
ChatGPT Work private plugin
        |
        | Remote MCP over HTTPS
        v
Google Drive Markdown Gateway
        ^
        | Authenticated HTTPS client
        |
Codex cloud setup and skill

Gateway -> Google Drive API -> Dedicated Markdown folder
```

The service owns all Google Drive interaction and folder-boundary enforcement. The MCP and HTTP interfaces must call the same application service methods. Do not implement Drive behavior twice.

### Interfaces

Expose a remote MCP endpoint for the ChatGPT Work plugin.

Expose either the same MCP tools or a small JSON HTTPS API for Codex cloud. Prefer the simplest option verified to work reliably in a Codex cloud environment. If Codex cloud cannot directly load the remote MCP server, provide a checked-in CLI that calls the HTTPS API.

Suggested CLI examples:

```bash
md-drive list
md-drive search "release plan"
md-drive read specs/release-plan.md
md-drive create drafts/new-post.md --file /tmp/new-post.md
md-drive update specs/release-plan.md --revision REVISION --file /tmp/release-plan.md
md-drive archive drafts/old-post.md
```

The CLI must return machine-readable JSON when requested so a Codex skill can use it safely.

### Google authentication

Decide this during Epic 1 after confirming the type of Google account and Drive location:

- For a Google Workspace Shared Drive, prefer a service account with access only to that Shared Drive or folder.
- For an ordinary My Drive folder, use user OAuth with offline access and store the refresh token in Google Secret Manager.

Do not place Google refresh tokens, service-account keys, or client secrets in the repository or Codex environment.

### Client authentication

The gateway must not be public without authentication.

- Use standards-compatible OAuth for the ChatGPT Work plugin if required by the current plugin platform.
- Use a separate scoped bearer credential for the Codex cloud client.
- Store the Codex credential as an environment secret, never in committed configuration.
- Support credential rotation without redeploying application code.
- Treat the ChatGPT and Codex credentials as separate principals in audit logs.

Do not forward gateway credentials to Google. The gateway performs Google authentication with its own server-side credential.

### Codex cloud networking

Codex cloud blocks agent internet access by default. Its environment must allow the gateway hostname and the HTTP methods used by the client. Use the narrowest domain allowlist possible. Avoid unrestricted internet access.

The setup script may install the checked-in client and its dependencies. The agent phase still needs outbound access to the deployed gateway for file operations.

## Tool contract

Start with these six operations. Names may be adjusted to meet MCP naming conventions.

### `list_markdown`

Lists Markdown files under an optional relative folder.

Input:

- `path`, optional relative folder
- `recursive`, boolean with a conservative default

Output:

- relative path
- file ID
- revision
- modified time
- size

### `search_markdown`

Searches filenames and, if practical, text content only within the configured folder tree.

Input:

- `query`
- optional relative folder
- bounded result limit

Output uses the same metadata as `list_markdown`, plus a short match excerpt when available.

### `read_markdown`

Reads one file.

Input:

- relative path or opaque file ID

Output:

- content
- relative path
- file ID
- revision
- modified time

### `create_markdown`

Creates one new `.md` file. It must fail if the target already exists unless the caller explicitly uses the update operation.

Input:

- relative path
- UTF-8 Markdown content

### `update_markdown`

Replaces one file only when the expected revision matches the current Drive revision.

Input:

- relative path or file ID
- expected revision
- UTF-8 Markdown content

On conflict, return the current metadata without overwriting the file.

### `archive_markdown`

Moves a file into a configured archive folder. It does not permanently delete or trash the file.

Input:

- relative path or file ID
- expected revision

## Core safety rules

These rules must be enforced in application code, not only described in prompts or skills:

- Every file operation must resolve inside one configured root folder.
- Reject path traversal, absolute paths, hidden path ambiguity, and folder escapes.
- Accept only files ending in `.md`, case-insensitively if Drive behavior requires it.
- Enforce a configurable maximum file size.
- Decode and encode content as UTF-8.
- Never overwrite without an expected revision.
- Never expose Google credentials to clients.
- Never offer sharing changes or permanent deletion.
- Use stable Drive file IDs internally rather than assuming paths are unique forever.
- Log operation metadata but do not log full document content or credentials.
- Apply request timeouts, bounded result limits, and basic rate limiting.

## User experience requirements

### ChatGPT Work

The private plugin should include a short skill or server instruction that tells the agent to:

1. Search or read before editing.
2. Retain the returned revision.
3. Update using that exact revision.
4. Report conflicts rather than silently replacing newer content.
5. Ask before archiving unless the user explicitly requested it.

### Codex cloud

Check in a project-scoped skill or `AGENTS.md` guidance that gives Codex the same workflow. Provide examples using the CLI or remote tool.

The client should make common actions short enough that an agent will use the gateway rather than improvising with raw HTTP calls.

## Epics

### Epic 0: Validate platform assumptions

Goal: remove unknowns before committing to the final authentication and adapter design.

Tasks:

- Confirm whether the destination is My Drive or a Google Workspace Shared Drive.
- Create or identify the dedicated Markdown root folder.
- Verify raw `.md` create, download, and revision-safe update through the Drive API.
- Verify the current private plugin installation path for ChatGPT Work.
- Verify whether Codex cloud can use the remote MCP endpoint directly.
- If not, prove that a checked-in CLI can call the gateway during the agent phase.
- Record decisions in `docs/architecture.md`.

Acceptance criteria:

- A minimal spike reads and writes a test Markdown file without broad Drive access.
- The repository records the selected Google and client authentication approaches.
- No production credentials are committed.

### Epic 1: Google Drive core

Goal: implement and test the folder-confined Drive operations.

Tasks:

- Implement Google authentication.
- Resolve and cache the configured root folder ID safely.
- Implement list, search, read, create, revision-safe update, and archive.
- Normalize Drive errors into stable application errors.
- Enforce Markdown-only, path, size, and folder-boundary rules.
- Add unit tests with a fake Drive adapter.
- Add integration tests against a dedicated test folder.

Acceptance criteria:

- All six operations work against the test folder.
- Attempts to reach files outside the root are rejected.
- A stale revision produces a conflict and preserves the newer content.

### Epic 2: Authenticated service API

Goal: deploy a secure, observable gateway on Cloud Run.

Tasks:

- Add HTTPS-facing application endpoints.
- Implement separate client identities for ChatGPT and Codex.
- Store secrets in Google Secret Manager.
- Add structured audit logging without document bodies.
- Add health checks, timeouts, request limits, and rate limiting.
- Create infrastructure and deployment automation.

Acceptance criteria:

- Unauthenticated requests fail.
- Each operation records principal, operation, file ID, result, and timing.
- Credentials can be rotated independently.
- The service can be redeployed from repository instructions.

### Epic 3: ChatGPT Work plugin

Goal: make the six operations available inside hosted ChatGPT Work sessions.

Tasks:

- Add a Streamable HTTP MCP endpoint or plugin-compatible remote MCP adapter.
- Publish accurate tool schemas and read/write annotations.
- Implement the required plugin authentication flow.
- Add concise server instructions for read-before-write and conflict handling.
- Package the MCP server and skill as a private plugin.
- Test listing, reading, creating, updating, conflict handling, and archiving from ChatGPT Work.

Acceptance criteria:

- The private plugin installs in the target workspace.
- A fresh Work session can find and read a Markdown file.
- A fresh Work session can create and safely update a file.
- Write tools require appropriate user approval under the current platform behavior.

### Epic 4: Codex cloud client

Goal: make the same operations available in repository-backed Codex cloud sessions.

Tasks:

- Implement the smallest reliable client, preferring remote MCP if supported and a CLI otherwise.
- Add machine-readable output and stable exit codes.
- Add repository setup instructions.
- Configure the gateway token as an environment secret.
- Configure the narrow domain and HTTP-method allowlist required for the gateway.
- Add a project skill or `AGENTS.md` instructions for using the client.
- Test from a clean Codex cloud environment.

Acceptance criteria:

- A new Codex cloud session can list, read, create, and update Markdown files.
- No Google credential is present in the Codex environment.
- A stale update fails safely and gives Codex enough information to recover.

### Epic 5: Operational hardening

Goal: make the gateway dependable enough for important specifications and drafts.

Tasks:

- Write a lightweight threat model.
- Add metrics and alerts for authentication failures, Drive errors, and elevated latency.
- Document backup and recovery using Google Drive version history.
- Test token revocation and rotation.
- Test duplicate names, renamed folders, moved files, Drive throttling, large files, and malformed UTF-8.
- Document failure recovery and administrative procedures.

Acceptance criteria:

- The documented recovery procedure has been exercised.
- Alerts cover sustained failures without logging sensitive content.
- Security boundaries have automated tests.

### Epic 6: Migrate planning files

Goal: move the workflow source of truth from the bootstrap repository into Google Drive.

Tasks:

- Create a clear folder structure for briefs, specifications, drafts, and archives.
- Copy this handoff and active planning documents into Drive.
- Verify access from ChatGPT Work, Codex cloud, macOS, iPhone, and iPad.
- Keep repository documentation for gateway code and operations.
- Declare whether project specifications now live in Drive or remain repository-specific.

Acceptance criteria:

- The same test file can be safely edited from both agent environments.
- The files appear normally in Google Drive clients.
- The source-of-truth policy is documented.

## Suggested delivery sequence

Do not estimate the full project until Epic 0 is complete. The expected shape is:

- One focused day for the platform spike and Drive core.
- A second focused day for deployment and the first working adapters.
- One to three additional days for production authentication, hardening, documentation, and end-to-end testing.

Treat the one-to-two-day target as a functional implementation, not a production-readiness guarantee.

## Definition of done

The project is complete when:

- ChatGPT Work and Codex cloud can operate on the same Drive-hosted Markdown files.
- All operations are confined to the configured root folder.
- Updates use optimistic concurrency and never silently overwrite newer content.
- Credentials are scoped, separated by client, stored outside the repository, and rotatable.
- There is no general-purpose Drive proxy or permanent-delete operation.
- A clean environment can be configured from documented steps.
- Integration tests cover both clients and the real Drive test folder.
- Recovery and operational ownership are documented.

## Instructions for the next Codex session

1. Read this entire file before changing code.
2. Inspect the repository and any existing `AGENTS.md` instructions.
3. Do not assume that Codex cloud can directly load an MCP server. Verify it during Epic 0.
4. Ask only for decisions that materially change the architecture, especially My Drive versus Shared Drive and the desired Google account.
5. Start with a thin vertical spike before generating the complete scaffold.
6. Keep Google Drive logic behind one adapter and tool interfaces thin.
7. Use test doubles for routine tests and a dedicated Drive folder for integration tests.
8. Never commit credentials or include them in logs, fixtures, screenshots, or example commands.
9. Update this file or linked architecture records when a baseline decision changes.
10. Deliver the smallest secure system that satisfies the six operations.

## Current official OpenAI references

- MCP support and configuration: <https://learn.chatgpt.com/docs/extend/mcp>
- Codex cloud internet access and allowlists: <https://learn.chatgpt.com/docs/cloud/internet-access>

These product surfaces can change. Recheck the official documentation during Epic 0 rather than treating this handoff as authoritative platform documentation.
