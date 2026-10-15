#!/usr/bin/env bash
# Build one working directory per fixture: <workdir>/<fixture>/repo and <workdir>/<fixture>/notes/mr-cast-review.md
# Usage: quality/prepare.sh <workdir> <skill-variant-dir>
# <skill-variant-dir> is the output of variant.sh (contains skills/mr-cast-review/SKILL.md).
set -euo pipefail
work="${1:?usage: prepare.sh <workdir> <skill-variant-dir>}"
variant="${2:?usage: prepare.sh <workdir> <skill-variant-dir>}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
skill="$variant/skills/mr-cast-review/SKILL.md"
[ -f "$skill" ] || { echo "prepare.sh: $skill not found; run variant.sh first" >&2; exit 1; }
mkdir -p "$work"
for script in "$here"/fixtures/*.sh; do
  name="$(basename "$script" .sh)"
  rm -rf "${work:?}/$name"
  mkdir -p "$work/$name/notes"
  bash "$script" "$work/$name/repo" >/dev/null
  cp "$skill" "$work/$name/notes/mr-cast-review.md"
  echo "prepared $work/$name"
done
