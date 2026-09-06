# Planning-file source of truth

The migration manifest is a strict allowlist, not an inventory or sync tool.
After an authorized cutover and external sanitized evidence, a listed planning
document is canonical in Drive. Its Git copy is a frozen bootstrap reference.
No automatic copy, merge, overwrite, or bidirectional synchronization follows.

Only `briefs/`, `specs/`, and `drafts/` are approved bounded nested categories
beneath the configured Markdown root. Each path is exactly
`category/<lowercase-ascii-hyphenated-slug>.md`, must be manifest-reviewed,
and is created later in an existing verified folder. The configured archive
folder is deployment-owned archive-only cleanup for an exact, revision-verified
file; it is never trash or permanent deletion.

Code, tests, executable feature/task packages, deployment/runtime configuration,
operations documentation, skills, and migration tooling remain Git-owned. A
Drive copy of any of those files does not gain authority through this policy.

Default deployment configuration is read-only. A manifest or plan does not
authorize a write; later cutover requires the separate controlled write-enabled
deployment, collision check, one explicit dispatch, reread, and external
evidence. On conflict, unknown outcome, timeout, or transport uncertainty,
stop and manually reconcile—never retry, overwrite, delete, trash, or infer
cleanup.
