# 7. Open the page only when the voice is ready

- Status: Accepted (supersedes [0006](0006-play-at-once-voice-in-background.md))
- Date: 2026-10-17

## Context

ADR 6 served the page at once and voiced in the background, with a muted autoplay and a pill. The user said: "we should
only launch the page when voice has finished, if not i keep wondering why there is no voice" (v023 voice brief). A
silent video read as a broken one.

## Decision

- `play` voices first, then opens the browser. The terminal shows one line, "Voicing 4 of 17 lines... (--no-voice skips
  the voice)", counting spoken lines, not scenes, so it never sits on 0 for long, and prints the URL at once. A page
  opened early from that URL says "Making the voice-over..." instead of playing (CHANGELOG 0.23.0; v023 merge brief, 2).
- Voicing stays in the child process, so the server keeps its other duties.
- An edit keeps the open page playing its current version, with its voice and a small "Updating..." note, until the
  edit is voiced, then reloads once at the same place.
- If the voice fails, the page opens anyway, silent, with "Voice failed, see the terminal", and the terminal says so.
- The muted play, the "Voice: 1 of 3 scenes" pill and "Play with voice (V)" are removed (CHANGELOG 0.23.0).

## Consequences

Good:
- The user never sees the video without its voice unless they passed `--no-voice` or the voice failed (README, Voice).
- A 2-scene, 43-second quick video opens in about 16 seconds on a first run, and in under half a second once its clips
  are cached, since clips are keyed by a hash of voice, speed and text (CHANGELOG 0.23.0; README, Voice).
- Less player state: the pill and the muted path are gone.

Bad:
- The first open of a long video waits for its whole voice-over, as before 0.21.0. Quick mode's promise moved from about
  20 seconds silent to about 16 seconds voiced on a small video.

## Alternatives considered

- Keep ADR 6 and explain the pill better: the confusion was the silent start itself, not the wording.
- Open the page and block play until voiced: the user would still see a page without voice.
