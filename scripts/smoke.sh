#!/usr/bin/env bash
# End-to-end smoke test of a built checkout, as CI runs it: stills of the gallery and demo examples, one
# voiced clip rendered to an MP4 with its voice and chapters, and the live player loading in an installed Chrome.
# Needs `pnpm install`, `pnpm build` and the render engine (a checkout builds it with cargo).
# usage: scripts/smoke.sh <out dir> [--no-voice]
# Downloads the voice model (unless --no-voice) into $XDG_CACHE_HOME/mr-cast on first use. The player step needs a
# Chrome (MR_CAST_CHROME, or Google Chrome or Chromium installed). Writes nothing outside <out dir> and that cache.
set -euo pipefail
OUT="${1:?usage: scripts/smoke.sh <out dir> [--no-voice]}"
VOICE=1
[ "${2:-}" = "--no-voice" ] && VOICE=0
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MRC=(node "$ROOT/bin/mr-cast.mjs")
VERIFY="$ROOT/.claude/skills/verify/scripts"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
export MR_CAST_NO_UPDATE_CHECK=1 CLAUDE_CONFIG_DIR="$OUT/work/claude" XDG_CONFIG_HOME="$OUT/work/config"

fail() { echo "smoke: FAIL $*" | tee -a "$OUT/failure.txt" >&2; exit 1; }

for example in gallery demo; do
  mkdir -p "$OUT/work/$example"
  cp "$ROOT/examples/$example"/*.json "$OUT/work/$example/"
  "${MRC[@]}" still --dir "$OUT/work/$example" --out "$OUT/stills/$example" > "$OUT/still-$example.txt" 2>&1 || fail "$example: still exited non-zero"
  expected="$(node -p "require('$OUT/work/$example/storyboard.json').scenes.length")"
  got="$(find "$OUT/stills/$example" -name '*.png' -size +10k | wc -l | tr -d ' ')"
  [ "$got" = "$expected" ] || fail "$example: $got of $expected stills"
  echo "smoke: ok $example stills ($got)"
done

if [ "$VOICE" = 1 ]; then
  mkdir -p "$OUT/work/voice"
  cp "$ROOT/examples/demo/hunks.json" "$OUT/work/voice/"
  node -e 'const [src, dst] = process.argv.slice(1); const s = require(src); s.scenes = [s.scenes[0]]; require("fs").writeFileSync(dst, JSON.stringify(s))' \
    "$ROOT/examples/demo/storyboard.json" "$OUT/work/voice/storyboard.json"
  "${MRC[@]}" voice --dir "$OUT/work/voice" > "$OUT/voice.txt" 2>&1 || { cat "$OUT/voice.txt"; fail "voice exited non-zero"; }
  seconds="$(node -p "Object.values(require('$OUT/work/voice/voiceover.json').clips).reduce((n, c) => n + c.seconds, 0)")"
  node -e "process.exit($seconds > 5 ? 0 : 1)" || { cat "$OUT/voice.txt"; fail "voice clip is ${seconds}s"; }
  echo "smoke: ok voice (${seconds}s)"
  "${MRC[@]}" render --dir "$OUT/work/voice" --out "$OUT/voice.mp4" > "$OUT/render.txt" 2>&1 || { cat "$OUT/render.txt"; fail "render exited non-zero"; }
  # The engine reads its own MP4 back: an H.264 track, the voice as AAC, and the chapters both ways.
  ENGINE="$(node --input-type=module -e "import('$ROOT/bin/lib/engine.mjs').then((m) => console.log(m.locateEngine().path))")"
  "$ENGINE" probe --in "$OUT/voice.mp4" > "$OUT/probe.txt" 2>&1 || { cat "$OUT/probe.txt"; fail "the MP4 does not read back"; }
  node -e '
    const p = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const codecs = p.tracks.map((t) => t.codec).join(" ");
    if (codecs !== "avc1 mp4a text") throw new Error(`tracks: ${codecs}`);
    if (!p.chapters.length || p.chapters.length !== p.tracks[2].chapters.length) throw new Error("no chapters");
  ' "$OUT/probe.txt" || { cat "$OUT/probe.txt"; fail "the MP4 lacks video, voice or chapters"; }
  echo "smoke: ok render"
fi

mkdir -p "$OUT/work/fits"
cp "$ROOT/examples/demo/hunks.json" "$OUT/work/fits/"
cp "$ROOT/.claude/skills/verify/fixtures/stress/fits.json" "$OUT/work/fits/storyboard.json"
"${MRC[@]}" still 0 --no-voice --dir "$OUT/work/fits" --out "$OUT/work/fits-still" > "$OUT/still.txt" 2>&1 || { cat "$OUT/still.txt"; fail "still exited non-zero"; }
"${MRC[@]}" play --no-open --no-voice --dir "$OUT/work/fits" > "$OUT/play.txt" 2>&1 &
PLAY=$!
trap 'kill $PLAY 2>/dev/null || true' EXIT
for _ in $(seq 1 100); do
  URL="$(grep -o 'http://127.0.0.1:[0-9]*' "$OUT/play.txt" | head -1 || true)"
  [ -n "$URL" ] && break
  sleep 0.2
done
[ -n "$URL" ] || { cat "$OUT/play.txt"; fail "player did not start"; }
# The canvas draws the scenes, so the page's own text is the chapter list; the page loading with it is the check.
# Text fitting is checked by the engine's tests against shared/textfit.mjs, which validate uses too.
node "$VERIFY/browse.mjs" "$URL/" "$OUT/page" wait:Stress > "$OUT/browse.txt" 2>&1 || { cat "$OUT/browse.txt"; fail "browse exited non-zero"; }
echo "smoke: ok"
