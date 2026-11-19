# 48. A hand-drawn board look

- Status: Accepted
- Date: 2026-11-19

## Context

ADR 47 matched the reference explainers' pacing and structure: one picture across scenes, titles that make a point,
something changing with each sentence. What it left is the look. The references are drawn by hand on a dark board,
and a pencil is always on screen, drawing what the voice describes; the picture is moving about 72% of the time,
ours about 24%, and most of that difference is the pencil. Their colours are two, green for what is normal and
orange for the problem, and their headlines are hand-lettered.

The engine already has the parts: a handwriting face (Caveat), rough pen strokes with a seeded wobble, and
handwriting that is revealed at writing speed with a dot at its tip.

## Decision

A storyboard may choose `"look": "board"`. The default look is unchanged.

- **The board.** A dark, matte board, a little lighter in the middle, in place of the gradient and glows.
- **Two colours.** The palette is remapped as a frame is drawn: the accent and `good` become green, `bad` orange,
  `warn` amber, text chalk white. The remap works on the display list and on svg markup, so every scene type takes
  it without code of its own.
- **Hand-lettered titles, written on.** The scene title is drawn in the handwriting face, in orange, and is written
  on left to right as the scene starts. The chapter label above it is left out.
- **Rough lines.** On the board an svg rect or line is drawn as a hand would: each side slightly bowed, its corners a
  little off, the pen running past the corner it started from. It is seeded by the element, so it holds still
  between frames. (A displacement filter over the whole drawing was tried first; it broke thin lines into pixel steps.)
- **Drawn on, part by part.** As a scene starts, its drawing's parts draw on one after another, as a pencil would
  draw them, over up to three seconds; the voice starts partway, as someone explaining talks while they draw.
- **A pencil.** A pencil is drawn at the point being drawn: the tip of ink as it is written, a title as it is
  lettered, and a part of an svg drawing as it draws on. Between strokes it rests where it last drew.

## Consequences

- An explanation can look like the references with one field, and the default look keeps every existing video as
  it was.
- The remap matches the palette's own colours; a colour a scene derives from them (a mix, a brighter accent) keeps
  its default hue until the scene names it. Scene types other than svg keep their card layouts on the board; making
  each of them hand-drawn is later work.
- `validate` measures titles in the default face; the handwriting face is narrower, so a title that fits still fits.

## Alternatives considered

- **A board look by default.** It changes every video at once, before the other scene types are drawn for it.
- **One displacement filter over the drawing.** It covers every element at once, but resvg samples it per pixel, so
  thin lines broke into steps; rough outlines are drawn for rects and lines instead, and other shapes keep theirs.
- **A pencil only while ink is written.** Most of what a scene shows is not ink; the pencil would sit still for most
  of a video.
