# 34. What ten worked examples changed in the scenes

- Status: Accepted
- Date: 2026-10-18
- Amends: 0019 (the example index), 0028 (svg `move` timing, ink on svg text), 0029 (traced plot parts, sampling)

## Context

For 0.28, ten worked examples outside software were written against the new scenes: a Fourier series, compound
interest, GPS and relativity, mRNA vaccines, Docker, a CPU adder, the 49th parallel, the Raspberry Pi 5, bread and
Spanish's ser and estar. Their writers hit thirteen problems in the scenes and worked around most of them in their
`generate.mjs`: a `hidden` on every traced plot line, a Fourier axis narrowed so 480 samples looked smooth at zoom 3,
three `<text>`s with guessed widths because ink on a `<tspan>` drew nothing, a headline where a question was wanted, rows
named `five` and `three` so speech saying "a two" was not read as `a[2]`, and a price chart with no unit because `"$"`
printed "35 $".

## Decision

Fix each in the scene, with a test that fails without the fix, and drop the workaround from the example.

- **A traced plot part starts undrawn,** as a traced map route does, without `hidden`. A step can still `show` it first.
- **A plot line is drawn about every 2 screen pixels** for the camera's current view, and finer only where it is on
  screen. What a line is (its box, end and label spots, and what `validate` checks) still comes from the plain 480
  samples, so zooming never moves a label or ink.
- **An svg `move` can span its step's words.** A move is still a transform string, which tweens over the half-second
  settle, or now `{ "to": transform, "when"?: words }`, which plays evenly from its words, or the start of the voice, to
  the end of the step's voice, as a trace does. There is no duration field; a spanned move ends with the voice.
- **svg text is laid out run by run** in the player's font, so a `<tspan id>` has its own box for ink, the camera and
  focus. `validate` fails on ink that names an element with nothing on the stage, such as a gradient or an empty group,
  instead of drawing nothing. Whitespace between tspans is kept.
- **A chart takes a `prefix`,** printed against each value after any minus sign, as a plot axis's is. The legend no
  longer repeats the unit, since every printed value carries it.
- **A `write` beside a chart label** steps out past a bar that covers the label's column, so it never sits in the bar's
  foot.
- **A question lead keeps the right fifth of its card** for the question mark, and everything else is fitted to the
  rest. The fit check also reports any text box that overlaps the mark.
- **A written `"\n"` is a hard line break in every fitted text,** counted in its lines and height, so a compare row grows
  to hold it.
- **A table cell that is only a percentage is text,** not code. Plain numbers and money stay mono so number columns
  line up.
- **The spoken cell form "name index"** ("sum three" for `sum[3]`) needs a row name that is a word of three or more
  letters. A row named `a` is named by "a cell 2" or "a index 2", so the article in "a two" is prose.
- **Dockerfiles are coloured.** prism-react-renderer has no docker grammar, so Prism's, MIT, is copied into
  `src/utils/prismDocker.ts` rather than adding prismjs.
- **A timeline `unit` takes `wk`, `mo` and `yr`.** The axis still starts at 0, so `at` is time elapsed, not a date.
- **The list of worked examples moves to `references/examples.md`.** With twenty-one it pushed SKILL.md past its token
  budget; SKILL.md links it in one line.

## Consequences

- Storyboards from 0.27 draw as before except where a fix is the point: a traced plot part without `hidden` no longer
  shows before its trace, a chart legend loses its "· unit", a question card's mark tops out at 585 px instead of 640,
  a text with a written newline breaks there, and a percentage cell is drawn in the text font.
- Ink on a part a spanned move carries jumps to the move's end as the step settles, the gap ADR 0033 notes for traces.
- Calendar years on a timeline would need an axis that does not start at 0. Shaded plot areas still use 240 samples.
- bash, ruby, lua, elixir and makefile still print uncoloured; the same copied-grammar pattern would fix them.

## Alternatives considered

- **A `validate` warning for a traced plot part drawn early.** It would only teach authors to keep writing `hidden`.
- **More fixed samples per plot line.** Enough for zoom 40 would be thousands per line on every frame at zoom 1.
- **Refusing ink on a tspan** instead of measuring it. Ink on a word inside a sentence is what the ser and estar example
  needed.
- **Code-like table cells by any digit.** Turning all numbers to text would break the lined-up number columns many
  examples rely on.
