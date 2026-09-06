# JSON API and Redacted Audit Events

## Status

Approved

## Context

Codex fallback and diagnostics need a stable HTTPS contract, but no transport may own document policy.

## Objective

Expose the six use cases via authenticated Express JSON routes with consistent request validation, error mapping, bounded work, and content-free audit events.

## Scope

Add Express composition, Zod request validation, principal middleware, shared timeout/result/rate controls, health endpoint, JSON error envelope, Pino audit events, and adapter contract tests.

## Non-goals / later

No MCP endpoint, CLI, UI, direct Drive calls in routes, or client credentials embedded in code.

## Constraints / caveats

Routes must delegate to `MarkdownService`; logs include principal, operation, opaque file ID/result/timing but never Markdown content, tokens, or raw authorization headers.

## Dependent tasks or work

Depends on principal verification and Drive Core.

## Likely starting points

- `google-drive-markdown-gateway-handoff.md` — required operation payloads and logging rule.

## Expected change surface

New HTTP/observability composition modules and route/contract tests. Domain and Google adapters remain transport-neutral.

## Open Questions

None.

