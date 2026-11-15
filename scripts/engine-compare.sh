#!/bin/sh
# Compares the Rust engine's stills with Remotion's, scene by scene and step by step.
#
#   scripts/engine-compare.sh <example or run dir> [--scenes 0,3,5] [--out dir]
#
# The directory holds a storyboard.json, and hunks.json and meta.json if it has them (an explanation has none).
# Scenes are 0-based, as `mr-cast still` takes them; the default is every scene. For each one the script takes
# Remotion's still at the scene's end and at the end of every step, and the engine's matching still, and writes
# into --out (default /tmp/engine-compare/<dir name>):
#
#   remotion-<still>.png, engine-<still>.png
#   compare-<still>.png   Remotion on top, the engine below
#   diff-<still>.png      their difference, four times brighter, black where they agree
#
# and prints, per still, the mean absolute difference over the frame and the worst 64-pixel tile with its top left,
# in levels of 255. Remotion's stills are cached, each by the hash of the run's files and of src/, shared/ and bin/,
# so a re-run after `cargo build --release` only redraws the engine's side.
#
# Every mr-cast command runs with temporary XDG_CONFIG_HOME, XDG_STATE_HOME and CLAUDE_CONFIG_DIR. XDG_CACHE_HOME is
# left alone on purpose: the Remotion bundle and Chrome live in ~/.cache/mr-cast, and a fresh cache would download
# Chrome on every run.
set -eu

usage() {
  echo "usage: scripts/engine-compare.sh <example or run dir> [--scenes 0,3,5] [--out dir]" >&2
  exit 2
}

[ $# -ge 1 ] || usage
src=$(cd "$1" && pwd) || usage
shift
scenes=""
out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --scenes) scenes=$2; shift 2 ;;
    --out) out=$2; shift 2 ;;
    *) usage ;;
  esac
done
[ -f "$src/storyboard.json" ] || { echo "engine-compare: no storyboard.json in $src" >&2; exit 2; }

repo=$(cd "$(dirname "$0")/.." && pwd)
engine="$repo/engine/target/release/mr-cast-engine"
[ -x "$engine" ] || { echo "engine-compare: build the engine first: cargo build --release --manifest-path engine/Cargo.toml" >&2; exit 2; }
out=${out:-/tmp/engine-compare/$(basename "$src")}
mkdir -p "$out"
out=$(cd "$out" && pwd)

# The cache key: the run's files and the code that draws Remotion's side.
key=$( {
  for f in storyboard.json hunks.json meta.json; do [ -f "$src/$f" ] && cat "$src/$f"; done
  cd "$repo" && find src shared bin -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' -o -name '*.css' \) -print0 | sort -z | xargs -0 cat
} | shasum -a 256 | cut -c1-16)
cache="${XDG_CACHE_HOME:-$HOME/.cache}/mr-cast-engine-compare/$key"

work=$(mktemp -d "${TMPDIR:-/tmp}/engine-compare.XXXXXX")
trap 'rm -rf "$work"' EXIT
run="$work/run"
mkdir -p "$run" "$work/config" "$work/state" "$work/claude"
cp "$src/storyboard.json" "$run/"
if [ -f "$src/hunks.json" ]; then cp "$src/hunks.json" "$run/"; else echo '{}' > "$run/hunks.json"; fi
if [ -f "$src/meta.json" ]; then cp "$src/meta.json" "$run/"; elif [ ! -f "$src/hunks.json" ]; then echo '{ "mode": "explain" }' > "$run/meta.json"; fi

mrcast() {
  XDG_CONFIG_HOME="$work/config" XDG_STATE_HOME="$work/state" CLAUDE_CONFIG_DIR="$work/claude" \
    MR_CAST_NO_UPDATE_CHECK=1 MR_CAST_PROCS_SCAN=0 "$repo/bin/mr-cast" "$@"
}

# Each chosen scene with its type and how many steps it speaks, from the storyboard as the run normalizes it.
node --input-type=module -e "
  import fs from 'node:fs';
  import { sceneSteps } from '$repo/shared/steps.mjs';
  const sb = JSON.parse(fs.readFileSync('$run/storyboard.json', 'utf8'));
  const want = '$scenes' ? '$scenes'.split(',').map(Number) : sb.scenes.map((_, i) => i);
  for (const i of want) {
    const s = sb.scenes[i];
    if (!s) { console.error('engine-compare: no scene ' + i); process.exit(2); }
    console.log(i, s.type, sceneSteps(s).length);
  }
" > "$work/scenes.txt"

# Remotion's stills: one Chrome per step index, for the chosen scenes whose still is not cached yet.
mkdir -p "$cache"
name_of() { # scene index, type, step or -1
  n=$(printf '%02d' $(($1 + 1)))
  if [ "$3" -lt 0 ]; then echo "scene-$n-$2"; else echo "scene-$n-$2-step-$3"; fi
}
missing() { # step index or -1: the chosen scenes with that still missing
  while read -r i type steps; do
    if [ "$1" -lt "$steps" ] && [ ! -f "$cache/$(name_of "$i" "$type" "$1").png" ]; then printf '%s ' "$i"; fi
  done < "$work/scenes.txt"
}
most=$(awk '$3 > m { m = $3 } END { print m + 0 }' "$work/scenes.txt")
k=-1
while [ "$k" -lt "$most" ]; do
  if [ "$k" -lt 0 ]; then
    # Every scene has an end; `missing -1` would ask for steps, so list the ends here.
    want=$(while read -r i type steps; do [ -f "$cache/$(name_of "$i" "$type" -1).png" ] || printf '%s ' "$i"; done < "$work/scenes.txt")
    step=""
  else
    want=$(missing "$k")
    step="--step $k"
  fi
  if [ -n "$want" ]; then
    # Validation output goes to the log; a storyboard that does not validate stops here with it.
    # shellcheck disable=SC2086
    mrcast still $want --no-voice --dir "$run" --out "$cache" $step > "$work/still.log" 2>&1 || { cat "$work/still.log" >&2; exit 1; }
  fi
  k=$((k + 1))
done

# The engine's side, every time.
node "$repo/scripts/engine-dump.mjs" props "$run" "$work/props.json" > /dev/null
printf '%-34s %8s %10s  %s\n' still mean worst-tile at
while read -r i type steps; do
  n=$(printf '%02d' $((i + 1)))
  k=-1
  while [ "$k" -lt "$steps" ]; do
    if [ "$k" -lt 0 ]; then name="scene-$n-$type"; step=""; else name="scene-$n-$type-step-$k"; step="--step $k"; fi
    k=$((k + 1))
    [ -f "$cache/$name.png" ] || { printf '%-34s %s\n' "$name" "no Remotion still"; continue; }
    cp "$cache/$name.png" "$out/remotion-$name.png"
    # shellcheck disable=SC2086
    "$engine" still --props "$work/props.json" --scene $((i + 1)) $step --out "$out/engine-$name.png" 2> /dev/null
    set -- $("$engine" compare --remotion "$out/remotion-$name.png" --engine "$out/engine-$name.png" \
      --out-compare "$out/compare-$name.png" --out-diff "$out/diff-$name.png")
    printf '%-34s %8s %10s  %s\n' "$name" "$1" "$2" "$3"
  done
done < "$work/scenes.txt"
echo "images in $out"
