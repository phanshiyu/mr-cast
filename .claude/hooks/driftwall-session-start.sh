#!/usr/bin/env bash
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
# The repository pins driftwall in its devDependencies; prefer that copy over one on PATH.
PATH="$PWD/node_modules/.bin:$PATH"
[ -f architecture.mmd ] || exit 0
echo "Architecture contract (architecture.mmd), enforced by driftwall. Solid arrows are enforced dependencies, dotted arrows are planned."
cat architecture.mmd
if command -v driftwall >/dev/null 2>&1; then
  echo
  echo "Current state (driftwall brief):"
  driftwall brief . 2>&1
  echo
  echo "Use 'driftwall neighbors <node>' for one node's dependencies and 'driftwall where <file>' for a file's owner."
fi
