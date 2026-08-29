# Codex cloud preflight

Run this preflight before using `$architect-feature` or `$ship-feature` to build the product. It
checks two separate things:

1. Codex cloud received and discovered the repository-scoped skills.
2. The cloud runtime can satisfy `$ship-feature`'s fresh-subagent and model-routing requirements.

Passing the first check does not imply that the second one is available.

## 1. Make the setup reachable

Commit and push these paths to a branch that Codex cloud can check out:

- `.agents/skills/`
- `AGENTS.md`
- `scripts/verify-vendored-skills.sh`
- `docs/codex-cloud-preflight.md`
- `google-drive-markdown-gateway-handoff.md`

Do not add product credentials. The preflight requires no secrets and no agent internet access.

## 2. Create the cloud environment

1. Open [Codex environment settings](https://chatgpt.com/codex/settings/environments).
2. Create an environment for this repository.
3. Select the branch containing the vendored skills.
4. Set the setup script to:

   ```bash
   ./scripts/verify-vendored-skills.sh
   ```

5. Set the optional maintenance script to the same command. This rechecks the snapshot when a
   cached container resumes.
6. Leave agent internet access off for this preflight.
7. Save the environment. Reset its cache if it was previously built from an older commit.

## 3. Run the local integrity check

Before starting the cloud task, run:

```bash
./scripts/verify-vendored-skills.sh
```

Expected final line:

```text
PASS: 9 vendored skills verified; archive helper tests passed.
```

## 4. Start a read-only cloud test

Create a cloud task in the environment and use this prompt:

```text
Run a read-only Codex cloud preflight. Do not edit files, create commits, or push anything.

1. Run ./scripts/verify-vendored-skills.sh.
2. Explicitly load $architect-feature. Report its declared skill name and the first Markdown heading
   after its frontmatter, using the repository copy under .agents/skills.
3. Confirm that $ship-feature is discoverable and read its "Require the Orchestration Runtime"
   section.
4. Determine whether this session can spawn a fresh subagent with no inherited conversation and an
   explicitly selected model. Do not infer this from documentation or general Codex capabilities.
   If the tools exist, actually spawn one harmless read-only subagent with no inherited turns and a
   model advertised by this runtime. Ask it only to report the repository basename and whether
   .agents/skills/ship-feature/SKILL.md exists. If the tools do not exist, say so precisely.
5. Return exactly these result lines, followed by concise evidence:
   vendored skill integrity: PASS or FAIL
   architect-feature discovery: PASS or FAIL
   ship-feature discovery: PASS or FAIL
   fresh subagent: PASS or FAIL
   explicit subagent model selection: PASS or FAIL
```

## 5. Interpret the result

`$architect-feature` is ready when the integrity and both discovery lines pass.

`$ship-feature` is ready only when all five lines pass. Its runtime contract requires a fresh worker
context and explicit model routing. If either subagent line fails, do not weaken or silently bypass
that gate. Use `$architect-feature` in the cloud if desired, then run `$ship-feature` in a supported
local Codex runtime, or revisit the workflow once the cloud runtime exposes the required controls.

## 6. Start feature architecture

After the relevant checks pass, start a new cloud task with:

```text
Use $architect-feature to turn google-drive-markdown-gateway-handoff.md into the initial feature
plan. This repository has not yet approved an implementation plan. First use $discover-architecture
because ARCHITECTURE.md does not exist. Record requirements, constraints, success criteria,
non-goals, an evidence-based implementation map, and every unresolved decision under Open
Questions. Do not implement product code. Stop at the feature-plan approval gate before creating
task briefs.
```

Review and answer the resulting open questions. Only after the feature plan is explicitly approved
should the architect create task briefs and a later task invoke `$ship-feature` on the exact feature
root.
