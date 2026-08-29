#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SKILLS_ROOT="${REPO_ROOT}/.agents/skills"

REQUIRED_SKILLS=(
  architect-feature
  discover-architecture
  shape-spec
  developer
  task-reviewer
  feature-reviewer
  archive-work-artifact
  ship-feature
  ship-task
  codex-cloud-markdown-gateway
)

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

[[ -d "${SKILLS_ROOT}" ]] || fail "missing ${SKILLS_ROOT}"
[[ -f "${SKILLS_ROOT}/LICENSE" ]] || fail "missing vendored Apache 2.0 license"

for skill in "${REQUIRED_SKILLS[@]}"; do
  skill_file="${SKILLS_ROOT}/${skill}/SKILL.md"
  [[ -f "${skill_file}" ]] || fail "missing ${skill_file}"
  grep -q "^name: ${skill}$" "${skill_file}" || fail "unexpected skill name in ${skill_file}"
done

first_symlink="$(find "${SKILLS_ROOT}" -type l -print -quit)"
[[ -z "${first_symlink}" ]] || fail "vendored skills must not contain symlinks: ${first_symlink}"

first_local_path="$(grep -RIl '/Users/kalwalkden/' "${SKILLS_ROOT}" --exclude=README.md || true)"
[[ -z "${first_local_path}" ]] || fail "vendored skill contains a machine-local path: ${first_local_path}"

[[ -f "${SKILLS_ROOT}/ship-feature/references/model-routing.md" ]] || \
  fail "ship-feature model-routing reference is missing"
[[ -f "${SKILLS_ROOT}/archive-work-artifact/scripts/archive_work_artifact.py" ]] || \
  fail "archive-work-artifact script is missing"
[[ -f "${SKILLS_ROOT}/archive-work-artifact/tests/test_archive_work_artifact.py" ]] || \
  fail "archive-work-artifact tests are missing"

PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s "${SKILLS_ROOT}/archive-work-artifact/tests" \
  -p 'test_*.py'

printf 'PASS: %s vendored skills verified; archive helper tests passed.\n' \
  "${#REQUIRED_SKILLS[@]}"
