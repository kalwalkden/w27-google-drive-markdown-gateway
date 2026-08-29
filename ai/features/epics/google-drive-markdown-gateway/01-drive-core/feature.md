# Drive Core

## Status

Approved

## Requirements

Implement list, search, read, create, revision-safe update, and archive through one `MarkdownService` and one Drive port. Every operation must remain inside the configured root and accept only Markdown.

## Constraints

Reject traversal, absolute paths, shortcuts, duplicate/ambiguous paths, oversized or invalid UTF-8 content, and folder escapes. Use stable file IDs internally. Shared Drive uses ADC; My Drive uses an OAuth refresh token supplied outside the repository. All writes fail closed unless precondition proof is present.

## Success Criteria

Fast tests cover policy and all six operations with a fake port. Optional integration coverage exercises a dedicated root and demonstrates no stale or unsafe overwrite.

## Non-goals / out of scope

HTTP, MCP, CLI transport, client authentication, and Cloud Run provisioning are later features.

## Implementation Map

No implementation exists. The boundary and six-operation contract are defined in `google-drive-markdown-gateway-handoff.md`; this feature will establish `src/domain/`, `src/application/`, `src/drive/`, and matching tests.

## Open Questions

None.

