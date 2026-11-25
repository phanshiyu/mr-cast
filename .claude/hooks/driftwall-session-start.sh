#!/usr/bin/env bash
set -uo pipefail
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
  echo "driftwall hook: DRIFTWALL_CONTRACT is $contract, which does not exist; skipped" >&2
  exit 0
fi
echo "Architecture contract ($contract), enforced by driftwall. Solid arrows are enforced dependencies, dotted arrows are planned."
cat "$contract"
if command -v driftwall >/dev/null 2>&1; then
  echo
  echo "Current state (driftwall brief):"
  driftwall brief . --contract "$contract" 2>&1
  echo
  echo "Use 'driftwall neighbors <node> --contract $contract' for one node's dependencies and 'driftwall where <file> --contract $contract' for a file's owner."
else
  echo "driftwall hook: $contract exists but no driftwall binary is on PATH or in node_modules/.bin; showing the contract only" >&2
fi
