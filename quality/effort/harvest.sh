#!/usr/bin/env bash
# Copies each finished reviewer's answer and transcript metrics into <results>/A/<writer>/ or <results>/B/<run>/.
# Usage: quality/effort/harvest.sh <results-dir> <tasks-dir> <looks-dir> <casts-dir>
# <results>/reviewers.tsv rows: run (A-wNN or bNN), agent id, phase.
set -uo pipefail
res="$1"; tasks="$2"; looks="$3"; casts="$4"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node="$here/../node.sh"
tail -n +2 "$res/reviewers.tsv" | while IFS=$'\t' read -r run agent phase; do
  t="$tasks/$agent.output"
  if [ "$phase" = A ]; then w="${run#A-}"; out="$res/A/$w"; repo="$casts/$w/none"; packet="$casts/$w/packet"
  else out="$res/$phase/$run"; repo="$looks/$run/repo"; packet="$looks/$run/packet"; fi
  [ -f "$out/answers.md" ] && continue
  mkdir -p "$(dirname "$out")"
  bash "$node" "$here/handback.mjs" "$t" >"$out.tmp" 2>/dev/null || { rm -f "$out.tmp"; continue; }
  mkdir -p "$out" && mv "$out.tmp" "$out/answers.md"
  bash "$node" "$here/transcript.mjs" "$t" "$repo" "$packet" >"$out/transcript.json"
  echo "harvested $run"
done
