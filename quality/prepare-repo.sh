#!/usr/bin/env bash
# Prepare <workdir>/<name>/{repo,notes,bin,config} for any local repository, the way prepare.sh does for fixtures:
# a clone holding only <base> and <branch>, origin removed, <branch> checked out, the variant skill copied to
# notes/mr-cast, and the shim from shim.sh.
# Usage: quality/prepare-repo.sh <workdir> <skill-variant-dir> <name> <repo-path> <base> <branch>
# <skill-variant-dir> is the output of variant.sh (contains skills/mr-cast/).
set -euo pipefail
usage="usage: prepare-repo.sh <workdir> <skill-variant-dir> <name> <repo-path> <base> <branch>"
work="${1:?$usage}"
variant="${2:?$usage}"
name="${3:?$usage}"
src="${4:?$usage}"
base="${5:?$usage}"
branch="${6:?$usage}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
skill="$variant/skills/mr-cast"
[ -f "$skill/SKILL.md" ] || { echo "prepare-repo.sh: $skill not found; run variant.sh first" >&2; exit 1; }
src="$(cd "$src" && pwd)"
git -C "$src" rev-parse --verify --quiet "refs/heads/$base" >/dev/null || { echo "prepare-repo.sh: no branch $base in $src" >&2; exit 1; }
git -C "$src" rev-parse --verify --quiet "refs/heads/$branch" >/dev/null || { echo "prepare-repo.sh: no branch $branch in $src" >&2; exit 1; }
mkdir -p "$work"
dest="$(cd "$work" && pwd)/$name"
rm -rf "${dest:?}"
mkdir -p "$dest/notes"
git init -q -b prepare-repo-unborn "$dest/repo"
git -C "$dest/repo" fetch -q --no-tags "$src" "refs/heads/$base:refs/heads/$base" "refs/heads/$branch:refs/heads/$branch"
git -C "$dest/repo" checkout -q "$branch"
git -C "$dest/repo" remote remove origin 2>/dev/null || true
cp -R "$skill" "$dest/notes/mr-cast"
bash "$here/shim.sh" "$dest"
echo "prepared $dest"
