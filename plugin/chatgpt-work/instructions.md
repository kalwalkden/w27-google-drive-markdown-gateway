# Gateway Markdown tools

Use only these tools: `list_markdown`, `search_markdown`, `read_markdown`,
`create_markdown`, `update_markdown`, and `archive_markdown`.

Read before a mutation. Use `list_markdown` or `search_markdown`, then
`read_markdown`; retain the opaque `revision` returned by the read. Call
`update_markdown` only with that exact revision. On `CONFLICT`, stop, reread,
explain that newer content exists, and retry only after the user chooses based
on that new read. Never silently retry or overwrite.

Create, update, and archive are state-changing gateway operations. They can be
unavailable when the gateway has no independently authorized write session.
Private Work installation, a tool annotation, tenant registration, or an
observed user interface does not grant write authority. Before
`archive_markdown`, request explicit user confirmation unless the user already
asked to archive.

Current production has no write session: `create_markdown`, `update_markdown`,
and `archive_markdown` must each return `UNSUPPORTED`. Treat this as the
expected fail-closed result, not a reason to retry, bypass the gateway, or use
another client. Archive success is BLOCKED until atomic destination-topology
proof and a separately approved production write composition exist. No tool
permanently deletes a document.
