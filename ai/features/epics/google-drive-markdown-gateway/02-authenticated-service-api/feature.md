# Authenticated Service API

## Status

Approved

## Requirements

Expose a small JSON HTTPS API on Express that delegates to `MarkdownService`, authenticates separate Codex and MCP principals, emits redacted structured audit events, and is deployable as Cloud Run infrastructure.

## Constraints

Validate external OAuth 2.1 JWT issuer tokens for the MCP principal and a separately rotated Codex bearer secret. Keep Google credentials and gateway secrets outside source control. Bound requests, results, rate, and downstream timeouts.

## Success Criteria

Unauthenticated and unauthorized requests fail; each operation has stable errors and redacted audit metadata; Terraform and Docker describe a repeatable Cloud Run deployment with least-privilege secret access.

## Non-goals / out of scope

MCP protocol wiring, ChatGPT Work packaging, and Codex CLI are separate features.

## Implementation Map

This feature will introduce the HTTP/auth/config/observability boundaries around the Drive core. `google-drive-markdown-gateway-handoff.md` is the authoritative endpoint and security input.

## Open Questions

None.

