#!/usr/bin/env bash
# Install a SKILL.md template (with {{MR_CAST}} / {{STORYBOARD_TYPES}} placeholders) the way
# `mr-cast install-skill` would, into <out-dir>, leaving ~/.claude untouched.
# Usage: quality/variant.sh <skill-md-source> <out-dir>
# Result: <out-dir>/skills/mr-cast-review/SKILL.md
set -euo pipefail
src="${1:?usage: variant.sh <skill-md-source> <out-dir>}"
out="${2:?usage: variant.sh <skill-md-source> <out-dir>}"
[ -f "$src" ] || { echo "variant.sh: $src not found" >&2; exit 1; }
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$out"
MR_CAST_SKILL_TEMPLATE="$(cd "$(dirname "$src")" && pwd)/$(basename "$src")" \
  CLAUDE_CONFIG_DIR="$(cd "$out" && pwd)" "$root/bin/mr-cast" install-skill >/dev/null
echo "$out/skills/mr-cast-review/SKILL.md"
