# Stateless MCP Tool Adapter

## Status

Approved

## Context

Remote MCP must expose the same document semantics as JSON without retaining session state that Cloud Run cannot safely share across instances.

## Objective

Mount the official TypeScript SDK's stateless Streamable HTTP handler and map the six tool contracts to the shared service.

## Scope

Register precise Zod-backed inputs/results, safe write annotations, principal propagation, protocol/error translation, and parity tests comparing MCP and JSON outcomes.

## Non-goals / later

No new Drive methods, server-initiated MCP requests, persistent sessions, browser UI, or plugin installation assets.

## Constraints / caveats

Do not reimplement authorization or `MarkdownService` behavior. Keep current protocol compatibility explicit and pin SDK versions; streaming is only used where the SDK requires it, not as a state store.

## Dependent tasks or work

Depends on the authenticated JSON service and external-JWT principal boundary.

## Likely starting points

- `google-drive-markdown-gateway-handoff.md` — MCP tool contract and safe-agent workflow.

## Expected change surface

New MCP transport module, service composition updates, and MCP protocol/adapter parity tests. Drive core stays unchanged.

## Open Questions

None.

