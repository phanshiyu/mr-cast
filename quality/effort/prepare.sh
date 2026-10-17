#!/usr/bin/env bash
# One writer's workdir for one fixture, with the seeded bug: <dir>/repo, <dir>/notes/mr-cast/, <dir>/config, <dir>/claude,
# and <dir>/bin/mr-cast, the shim the skill calls (quality/shim.sh).
# Usage: quality/effort/prepare.sh <dir> <skill-variant-dir> <fixture>
set -euo pipefail
dir="${1:?usage: prepare.sh <dir> <skill-variant-dir> <fixture>}"
variant="${2:?usage: prepare.sh <dir> <skill-variant-dir> <fixture>}"
fixture="${3:?usage: prepare.sh <dir> <skill-variant-dir> <fixture>}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$variant/skills/mr-cast/SKILL.md" ] || { echo "prepare.sh: run quality/variant.sh first" >&2; exit 1; }
rm -rf "${dir:?}" && mkdir -p "$dir/notes" "$dir/config" "$dir/claude"
bash "$here/../fixtures/$fixture.sh" "$dir/repo" >/dev/null
bash "$here/../node.sh" "$here/seed.mjs" "$dir/repo" "$fixture"
cp -R "$variant/skills/mr-cast" "$dir/notes/mr-cast"
bash "$here/../shim.sh" "$dir"
