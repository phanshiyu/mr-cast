# 49. Everything is drawn on the board

- Status: Accepted
- Date: 2026-11-19
- Amends: [48](0048-a-hand-drawn-board-look.md)

## Context

A review of the first video made with the board look (ADR 48), against the reference explainers, found that it looked like
a slide deck with a board skin. The agent had used a chart, a table, a sequence diagram, terminals and bullet lists, which
the board only recolours. Between strokes the pencil parked or hovered. The captions were the clearest thing on screen,
fills were solid with a glow, the wavering lines could not be seen at 1080p, and amber was a third colour.

## Decision

- **Only pictures on the board.** On the board `validate` warns about every scene that is not an svg: a point is a
  label written on the picture, a command or an error a short handwritten note, a number a bar drawn on. The skill says
  so.
- **The pencil keeps drawing.** It goes round what each step lights, shades in a part a step colours, and draws on
  what a step shows. Over a longer gap it takes its time to get to the next stroke, rather than parking.
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
