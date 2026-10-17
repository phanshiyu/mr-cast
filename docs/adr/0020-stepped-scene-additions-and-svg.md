# 20. Callout, tint, growing diagrams, several arrays, changing tables, and an svg scene

- Status: Accepted
- Date: 2026-10-18

## Context

ADR 0019 made mr-cast a set of tools that leave the teaching to the model. The user's direction for 0.26 is the same:
"let each model express however they want; we provide the tools". To find which tools were missing, eleven video
blueprints (quicksort, binary search, merge sort, Dijkstra, hash tables, YouTube at scale, React, OAuth with PKCE, H3,
Bitcoin and GPT) were split into their visual beats and each beat checked against the 0.25 scenes
([docs/primitives.md](../primitives.md)). Four gaps had no workaround a viewer would accept, and between them they touch
ten of the eleven blueprints:

1. A formula or comparison with real numbers beside the diagram it computes on (10 blueprints).
2. A colour that stays on a cell, node or row across steps (8).
3. Parts of a graph or table that appear a step at a time (6).
4. Several arrays in one scene (4).

Two more were narrower: a graph whose numbers change with a table beside it that changes in the same step (Dijkstra's
tracker, Bitcoin's ledger), and things placed at coordinates (H3's map and hexagons, GP's word vectors). The user
picked "P1 to P5 + svg scene" from the proposals in that analysis.

## Decision

The additions extend the scenes whose steps already change state (`array`, `memory`) and bring `graph` and `table` into
that model. Each keeps one rule: a scene's state at step k is its first state with the changes of steps 0 to k applied,
and a step with no `focus` lights what it changes. Every state lives in `shared/state-steps.mjs`, which the scenes draw
from and `validate` walks, so a change that names nothing fails before anything renders.

- **P1, `callout`** (gap 1). On `array`, `memory`, `graph`, `table` and `svg`, a boxed line at the right end of the
  header, with markup. A step's `callout` replaces it from that step on; `""` removes it. The voice does not read it.
  It sits in the header so it never covers the diagram; the header grows to a title's height to hold two lines.
- **P2, `tint`** (gap 2). A map from refs to a tone, `"dim"` or `"clear"`, at scene level for the first state and on
  any step after. It colours array cells, graph nodes, edges and groups, table rows and cells, and svg elements. `dim`
  is its own value because a ruled-out cell should recede, not turn red; a step's dimmed refs do not light, unless
  dimming is all the step does.
- **P3, `hidden`, `show` and `hide` on graphs and tables** (gap 3). A graph node or edge and a table row can start
  hidden; the graph lays out every node from the start, so one that appears moves nothing, and an edge draws only while
  both its ends do.
- **P4, several arrays** (gap 4). `arrays` in place of `values`, each with a name, a label, values, `splits` and
  `hidden`. One cell size for all, labels at the left of their rows, refs `"left[0]"`, `"left[0-1]"` and
  `"array:left"`, and pointers and ranges with `"array"`. `cells: "hex"` draws a hex grid with the same refs.
- **P5, option A: a table beside the graph.** A graph step `set`s a node's badge and the cells of a `table` drawn in the
  right 40% of the frame, by `"Header@row"` with a row named by index or first cell. A table scene's steps `set` cells
  the same way. The graph and its table change in the same step, which is what Dijkstra's tracker needs; option B
  (badges, then a table scene) never shows the two change together.
- **P6, an `svg` scene.** The storyboard holds SVG markup with a viewBox. Steps `focus`, `show`, `hide` and `tint`
  elements by id, and `set` rewrites a `<text>` element. `shared/svg.mjs` parses the markup and keeps only drawing
  elements and attributes; `validate` fails on anything it cuts (script, foreignObject, image, style, event handlers, a
  `url()` or `href` pointing outside the drawing), on markup that does not parse, on a missing viewBox, and on an id a
  field names that the drawing lacks. The scene renders the parsed tree, never the markup. The palette is `var(--name)`
  and tone classes, resolved by the renderer, so a drawing matches the other scenes. `validate` warns on text under
  15 px once the viewBox is scaled to the stage, and on text past the viewBox, measured in the player's own font.

## Alternatives considered

For the svg scene, three shapes were sketched before building:

- **A JSON shape list** (`shapes: [{ id, kind: "polygon", points, tone }]`). Easy to validate and to fit text in, but a
  second drawing language the model must learn from the schema, and it would grow a field per SVG feature (markers,
  gradients, paths, transforms) until it was SVG with braces.
- **A `scatter` kind on `chart`**, points at `[x, y]` with arrows between them. It closes GP's word vectors and nothing
  else: not H3's hexagons, its icosahedron net or a map.
- **SVG markup, sanitized at the boundary (chosen).** Models already write SVG well, it draws anything, and
  sanitizing is a whitelist plus a parser in one file. The cost is that `validate` cannot see overlaps inside a drawing;
  `mr-cast still` shows them.

For the rest, the analysis records the alternatives: a `formula` scene or KaTeX for P1, a new `grid` scene or arrays as
graph nodes for P4, and option B for P5.

## Consequences

- A storyboard can now show the binary search eliminating halves with the formula above the cells, the merge sort
  zipper, Dijkstra's graph and tracker in one scene, a ledger whose rows arrive and get rejected, an H3 k-ring, and any
  figure the model can draw.
- The renderers share two small pieces: `HeaderCallout` and `src/utils/tint.ts`. A table scene and the table beside a
  graph share `TableView` and `layoutTableStates`, which sizes the columns from every state so they never move.
- The svg scene's text is checked only for size and for running past the viewBox, not for overlaps or crowding.
- Each scene type has a short demo storyboard under `examples/primitives/`, which `validate:examples` runs, and a
  still in `docs/gallery.md` from `scripts/gallery.mjs`.
- Nothing is superseded.
