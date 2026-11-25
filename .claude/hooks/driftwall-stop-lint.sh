#!/usr/bin/env bash
set -uo pipefail
input=$(cat)
if printf '%s' "$input" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then exit 0; fi
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
# why: a project that pins driftwall as an npm devDependency has it here, not on the global PATH.
PATH="$PWD/node_modules/.bin:$PATH"
contract="${DRIFTWALL_CONTRACT:-}"
if [ -z "$contract" ]; then
  for candidate in architecture.mmd docs/architecture.mmd; do
    if [ -f "$candidate" ]; then contract="$candidate"; break; fi
  done
fi
[ -n "$contract" ] || exit 0
if [ ! -f "$contract" ]; then
  echo "driftwall hook: DRIFTWALL_CONTRACT is $contract, which does not exist; lint skipped" >&2
  exit 0
fi
if ! command -v driftwall >/dev/null 2>&1; then
  echo "driftwall hook: $contract exists but no driftwall binary is on PATH or in node_modules/.bin; lint skipped" >&2
  exit 0
fi
out=$(driftwall lint . --contract "$contract" 2>&1)
code=$?
if [ "$code" -ne 0 ]; then
  printf '%s\n' "$out" >&2
  exit 2
fi
exit 0
