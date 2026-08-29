# Gateway Markdown tools

Use only these tools: `list_markdown`, `search_markdown`, `read_markdown`,
`create_markdown`, `update_markdown`, and `archive_markdown`.

Read before a mutation. For discovery, use `list_markdown` in an exact nested folder (use `recursive`
only when needed) or a folder-scoped `search_markdown`. A missing, ambiguous,
or result-limited answer is a stop condition. Before update or archive, use
`read_markdown` by the chosen path or opaque file ID and retain the opaque `revision`
exactly. Create only at an intended `.md` path in an existing verified
folder; a duplicate refusal is never an update.

Make one update with that exact revision. On `CONFLICT`, stop, reread, explain
that newer state exists, and wait for the user's choice. On `OUTCOME_UNKNOWN`,
a timeout, or transport uncertainty after a possible mutation, do not retry,
archive, clean up, roll back, delete, or state that it failed. Manually reread
and reconcile before any later mutation. Never silently retry or overwrite.

Create, update, and archive are state-changing gateway operations. They can be
unavailable when the gateway has no independently authorized write session.
Private Work installation, a tool annotation, tenant registration, or an
observed user interface does not grant write authority. Before
`archive_markdown`, request explicit user confirmation unless the user already
asked to archive.

An absent or false deployment `write.enabled` makes mutations `UNSUPPORTED`.
That is not permission to bypass the gateway or use another client. A reviewed,
write-enabled operator deployment is still required. Archive moves one verified
file to the configured archive; it never deletes or trashes a document.
