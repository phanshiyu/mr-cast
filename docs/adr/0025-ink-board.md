# 25. Ink: a step's draw stays on the board until a step erases it

- Status: Accepted
- Date: 2026-10-18

## Context

A step could draw one pen `mark` on its first focus ref, with a `note` of up to 40 characters, between its items
settling and its words, and the mark cleared when the next step started. Teaching the worked examples needed more than
that: Dijkstra writes "2 + 1 = 3" along the road it relaxes and "3 < 4" beside the distance it replaces, and binary
search circles the middle, writes "72 > 45" and brackets the half it rules out, while the voice says each one. A
prototype on branch `wt/ink` (`examples/proto-ink/`) built two designs against the real examples: A, a `draw` list on
any step whose items stay on the board, and B, a separate whiteboard scene. The user picked A.

## Decision

- **A step's `draw` lists items, each keyed by one verb.** `circle`, `box`, `underline`, `strike`, `cross`, `tick`
  and `brace` take a ref, a list of refs or an earlier item's `id`; `arrow` takes `[from, to]`, each a ref, an id or an
  `[x, y]` stage fraction; `write` takes text and `near` (a ref or id) or `at` (a point). Options: `note`, `when`,
  `tone`, `side`, `id`.
- **The board persists.** An item stays until a step's `erase`: `true` takes everything, a list takes those ids. The
  erase lands as the step starts, before its own `draw`. One walk in `shared/ink.mjs` resolves every item's targets
  and the step that erases it; the renderer draws from it and `validate` reports its problems, so the two cannot
  disagree.
- **Ink is timed to the words.** `when` names words of the step's `say`; the item starts three frames before the voice
  reaches them, by the clip's sentence timings when it has them (`cueFrame` in `shared/timing.mjs`, the inverse of the
  caption's word count). Without `when`, items draw one after another from the step's settled frame. Strokes draw at
  60 px a frame and arrows at 40, 1.5 times slower than the prototype so the eye follows them; handwriting reveals left
  to right at 2.2 frames a character, with the pen's tip at the edge.
- **Placement keeps off what the scene shows from the step on.** Each item's obstacles are every box of its step and
  of every later step, so a pointer that moves later is kept clear, plus the ink still up. Text with no clear spot
  goes to the end of its target's row, as a comment ends a line of code, or else to free space with a leader arrow. A
  long arrow tries bends either way and a swing round the side of its ends, and takes the one that crosses the fewest
  things. On a scene whose camera moves (code, terminal, sequence), an item moves with the step it was drawn on, and
  code clips ink to its viewport.
- **`mark` and `note` stay** as the shorthand for one item on the first focus ref that clears at the next step, drawn
  by the same code as before. Old storyboards and review flags render pixel for pixel as in 0.26: 19 step stills with a
  mark or flag, across the review, demo, people, binary search and seven primitive examples, compare equal.
- **`validate`** fails on an unknown ref, a `when` the say does not contain, an `erase` id never drawn or not on the
  board, an arrow or `near` from an id not yet drawn, an id that is also a ref, and malformed items. It warns when text
  written `at` a point lands on a scene box while it is up; the boxes come from the scenes' own step targets, now in
  `src/utils/sceneTargets.ts`, which the graph, table, array, memory, svg, state and tests scenes draw from and the
  fit report hands to `validate`. A step that draws or erases ink is not reported as moving nothing. The highlight check is
  unchanged: ink is not lit.
- **`mr-cast still --step k`** renders each scene as step k ends, so a model can see the board mid-scene. It replaces
  the prototype's `MR_CAST_PROTO_AT` environment variable, which is not shipped.

## Alternatives considered

- **B, a whiteboard scene** with handwriting on a blank stage. It shows the working but not on the thing being worked
  on; the sums sit away from the graph and the table they change.
- **Per-step ink that clears at the next step**, as `mark` does. The prototype rendered both from one storyboard: the
  per-step version wiped "via S" and "2 + 1 = 3" just as the next step built on them.
- **Rendering `mark` through the new layer.** One code path, but `mark` draws in the lead before the words with its own
  placement, and moving it would change every existing still; the shorthand keeps its renderer.

## Consequences

- Ink works on every scene with focus refs and on code: graph, table, array, memory, svg, state, sequence, er, chart,
  timeline, files, tests, compare, terminal, layers, text and code. Flow steps have no refs, so `validate` rejects
  `draw` there.
- On a text scene (ADR 0026) a ref is an item, the lead by its field name, `note`, `kicker` or a side; an intent
  scene draws as one. On a tests matrix (ADR 0024) a ref is a situation, a cell, an outcome or a test, and ink goes
  on the cells it covers, kept off the names column, the column titles and the counts. The text scene measures its
  boxes as it renders, so the `at` warning does not cover it.
- Placement is a heuristic. It can still cross an edge or sit tight against a chip; `mr-cast still --step` shows it.
- Dijkstra and binary search use ink, from their `generate.mjs`; `examples/primitives/ink` is a short demo, and the
  gallery lists it under "On every scene".
- Nothing is superseded.
