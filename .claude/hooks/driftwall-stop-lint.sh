#!/usr/bin/env bash
set -uo pipefail
input=$(cat)
if printf '%s' "$input" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then exit 0; fi
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
# The repository pins driftwall in its devDependencies; prefer that copy over one on PATH.
PATH="$PWD/node_modules/.bin:$PATH"
command -v driftwall >/dev/null 2>&1 || exit 0
[ -f architecture.mmd ] || exit 0
out=$(driftwall lint . 2>&1)
code=$?
if [ "$code" -ne 0 ]; then
  printf '%s\n' "$out" >&2
  exit 2
fi
exit 0
