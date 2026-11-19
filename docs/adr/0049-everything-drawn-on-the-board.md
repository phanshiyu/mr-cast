# 49. Everything is drawn on the board

- Status: Accepted
- Date: 2026-11-19
- Amends: [48](0048-a-hand-drawn-board-look.md)

## Context

A review of the first video made with the board look (ADR 48), against the reference explainers, found that it looked like
a slide deck with a board skin. The agent had used a chart, a table, a sequence diagram, terminals and bullet lists, which
the board only recolours. The captions were the clearest thing on screen,
fills were solid with a glow, the wavering lines could not be seen at 1080p, and amber was a third colour.

## Decision

- **Only pictures on the board, and the real things.** On the board `validate` warns, in one warning, about every scene
  that is not an svg, a terminal or code: a point is a label written on the picture, rows a handwritten list, a number
  a bar drawn on. Real commands and code keep their scenes, since a viewer may copy them; an unprimed agent that was
  asked to turn its terminals into handwriting chose to leave the board instead.
- **No pencil.** The pencil ADR 48 drew is gone. It went round boxes and along text in straight passes while the
  drawing appeared by its own rules, so it never quite drew what appeared, and the eye went to it instead of the
  drawing. Parts still draw on, and ink is still written, without it.
- **Shaded, not painted.** An area with a colour is hatched in that colour. A box in the plain surface colour is left
  open. Nothing glows: what a step lights is drawn over in a heavier line.
- **A visible hand.** Rects and lines are drawn twice, each pass a little off the other, with more bow than before.
- **Two colours.** `warn` is orange, as part of the problem. In a drawing the greys are green linework.
- **The board is asked for.** An unprimed agent chose the board in one run and not in the next. A longer explanation
  without it gets a warning that points to it. The look stays a choice, so other videos are unchanged.
- **Ink that finishes.** `validate` warns about a handwritten note the pen is still writing when its scene ends or a step
  erases it.
- **Captions step back.** On the board they are smaller and dim, with no band or glow. They stay, so the video works
  without sound.

## Consequences

- A storyboard on the board is a run of svg scenes on one or two pictures. That is more work to write, and the
  warnings point at it.
- Hatching is a pattern in the svg, so it costs little to render.
- Card scenes still render on the board, recoloured, for when the agent has no better way.

## Alternatives considered

- **No captions on the board.** The references have none, but a video without sound would be lost.
- **Drawing card scenes by hand.** Each scene type would need its own drawn version. Drawing on one picture is
  what the references do, and it keeps the viewer on one thing.
