# ChatGPT Work Plugin

## Status

Complete

## Requirements

Expose the six existing operations as a stateless Streamable HTTP MCP endpoint with accurate input schemas and safe read-before-write guidance.

## Constraints

Use the official TypeScript MCP SDK. Do not duplicate Drive or authorization behavior. The endpoint must support the target platform's OAuth 2.1/JWT issuer integration and remain compatible with the current MCP transport through explicit contract tests.

## Success Criteria

MCP calls have the same outcomes as JSON calls; tools identify writes clearly; a private Work installation can be verified with an operator-provided environment.

## Non-goals / out of scope

Client-side document editing, persistent MCP sessions, server-initiated interactions, and a second business-logic implementation.

## Implementation Map

The MCP adapter will sit beside the HTTP service added by `02-authenticated-service-api` and call its shared application boundary. The handoff supplies tool names and user workflow constraints.

## Open Questions

None.
