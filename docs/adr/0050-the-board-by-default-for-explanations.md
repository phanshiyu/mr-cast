# 50. The board is the default for explanations

- Status: Accepted
- Date: 2026-11-20
- Amends: [48](0048-a-hand-drawn-board-look.md), [49](0049-everything-drawn-on-the-board.md)

## Context

ADR 49 kept the board a choice and warned a longer explanation without it. The user watched the React worked example
redrawn on the board and asked for it as the default style, with the demos redone. The redraw also showed that hatching
at the old density hid the label inside any tinted box.

## Decision

- **An explanation is drawn on the board unless it asks not to.** A storyboard with no `look` is drawn on the board when
  the run is an explanation (every hunk is source, as `normalizeStoryboard` already tells them apart), and plain when it
  holds a diff. `"look": "plain"` turns the board off; `"look": "board"` still puts a branch on it. The default is
  decided in `normalizeStoryboard`, which the CLI and the player both run, so the browser and the MP4 agree.
- **Videos of a branch stay plain.** Their diffs, file trees and test scenes are slides by nature, and the board would
  warn about every one.
- **The slide warning needs a drawing.** It fires on the board only when the video has an svg scene or is long enough to
  need a picture (5 scenes), so a one-scene chart is not called a slide in the middle of a drawing. The `look: none`
  warning is gone.
- **Lighter hatching.** Lines are thinner (2 px), further apart (16 px) and fainter (22 to 40% opacity), so a label
  in the tint's colour reads on top of it.
- **The worked examples are redrawn.** Each is svg scenes on the board, with real code and commands kept as code and
  terminal scenes. The scene-type demos in `examples/primitives` set `"look": "plain"`, since they show each scene type.

## Consequences

- An explanation that leans on card scenes now gets the slide warning without asking for the board; `"look": "plain"`
  silences it.
- Videos of explanations made before look different when rendered again.
