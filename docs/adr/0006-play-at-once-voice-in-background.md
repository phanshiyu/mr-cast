# 6. Play at once and voice in the background

- Status: Superseded by [0007](0007-open-page-when-voice-ready.md)
- Date: 2026-10-17

## Context

Before 0.21.0, `play` voiced every clip before it served the page: 15 seconds for a 2-scene, 31-second video, and minutes
for a long one (CHANGELOG 0.21.0). Quick mode (ADR 5) promised a video on screen in seconds. The quick-build brief asked
to measure first, and named `play` awaiting voice generation as the likely cost.

## Decision

- `play` serves the page at once, in about 0.2 seconds, and makes the voice in a child process
  (`bin/lib/voice-child.mjs`), so the server keeps answering while Kokoro works.
- Until the voice is ready the player plays muted with subtitles and a "Voice: 1 of 3 scenes" pill, then offers "Play
  with voice (V)". It never switches the audio mid-play, since voiced scenes are longer and the timeline would move.
- An edit to the storyboard reloads the player at once, silent, with the pill counting the new lines as they are voiced.
- A failed voicing keeps the video playing with "Voice failed, see the terminal" (CHANGELOG 0.21.0).

## Consequences

Good:
- The page was playable about 75 times sooner on a small video.
- The child process kept the server responsive, which 0.23.0 keeps.

Bad:
- The first thing the user saw was a silent video. The user "kept wondering why there was no voice" (v023 voice brief).
- The muted path added state that broke in review: the child's `done` message was lost for payloads around 64 KB, so the
  voice went silent after every edit on a large video; two EventSource connections per tab hung the third tab; out-of-order
  voice fetches left the pill on building (review021 fix brief, M1, M2, L5).

## Alternatives considered

- Keep voicing before serving: correct but slow, which was the problem.
- Switch audio in mid-play once the voice arrives: rejected, because the timeline would jump.
