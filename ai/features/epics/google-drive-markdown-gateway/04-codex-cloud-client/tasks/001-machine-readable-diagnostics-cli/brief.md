# Machine-Readable Diagnostics CLI

## Status

Approved

## Context

Codex cloud may require an HTTPS fallback even when remote MCP exists; it must use the service contract, not Drive APIs.

## Objective

Implement a small Node CLI for diagnostics and fallback use of the authenticated JSON API.

## Scope

Provide list/search/read/create/update/archive commands, JSON output mode, stable exit/error behavior, file-content input handling, expected-revision support, credential lookup from environment or mounted secret path, and unit/contract tests.

## Non-goals / later

No direct Google authentication, local content database, agent workflow changes, or a second business-logic path.

## Constraints / caveats

The CLI uses only the scoped Codex gateway credential. It must report conflicts cleanly and never print secret values or full response diagnostics by default.

## Dependent tasks or work

Depends on the JSON API error and authentication contract.

## Likely starting points

- `google-drive-markdown-gateway-handoff.md` — CLI command and machine-readable output examples.

## Expected change surface

New CLI module/entry point and tests consuming the JSON contract. HTTP service semantics remain unchanged.

## Open Questions

None.

