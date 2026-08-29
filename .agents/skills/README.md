# Vendored workflow skills

These repository-scoped skills are vendored from
[`kalwalkden/evidence-based-ai-engineering`](https://github.com/kalwalkden/evidence-based-ai-engineering)
at commit `4676914527c8dd06ab605c955d87232570dc5b22`.

Vendored on 2026-08-28:

- `architect-feature`
- `discover-architecture`
- `shape-spec`
- `developer`
- `task-reviewer`
- `feature-reviewer`
- `archive-work-artifact`
- `ship-feature`
- `ship-task`

The directories are copied files, not symlinks, so Codex cloud can load them from the repository
checkout. The upstream Apache 2.0 license is included as `LICENSE`.

When refreshing the snapshot, copy each complete skill directory, retain supporting `agents/`,
`references/`, `scripts/`, and `tests/` content, omit transient files such as `.DS_Store` and
`__pycache__`, update the commit above, and run:

```bash
./scripts/verify-vendored-skills.sh
```
