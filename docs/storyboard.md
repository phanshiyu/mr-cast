# Storyboard reference

A storyboard is the `storyboard.json` file in a run's directory. Claude writes it, and mr-cast plays or renders it. `src/types.ts` defines the schema, and `mr-cast schema` prints it: `mr-cast schema graph` for one scene type, `mr-cast schema all` for everything. This page describes what the fields do on screen.

A storyboard has a `title` and a list of `scenes`. Every scene has a `type` and a `narration`, the words the voice speaks over it.

## Scenes

| Scene | Shows |
| --- | --- |
| `text` | Words as the picture: one lead, which is a `headline`, a `question` beside a large question mark, a `number` whose figure counts up, a `term` over a rule and its meaning, or a `quote` after a large quote mark; a `kicker` above it and a `note` under it; then up to 6 `items`, or two `sides` each with its own lead, note and items. `risk` adds a badge and `diffstat` the diff's size. Steps `set` new text for the lead, note or kicker, and `show` or `hide` parts. An `intent` scene from an older storyboard draws as a text scene. |
| `graph` | Nodes and edges laid out left to right or top to bottom, with groups drawn as labelled boxes. Nodes can be services, people, teams or anything with a [Lucide icon](https://lucide.dev/icons), or flowchart shapes. With `steps`, the voice walks the graph node by node and edge by edge, and steps can show nodes and edges that start `hidden`, `set` a node's badge, and `tint` nodes, edges and groups. A `table` beside the graph changes in the same steps. An edge that skips over nodes in a line takes a lane of its own beside them. |
| `code` | One hunk or snippet, in split or morph view. Focused lines stay bright, and a callout explains them. With `steps`, each highlight has its own spoken words. With `typing`, each step types its lines in behind a cursor, and a step's `output` prints into a pane beside the code. |
| `flow` | A step-by-step trace with the payload at each step. With a `say` on each step, the current step follows the voice. |
| `sequence` | Participants with lifelines, and call, return and async messages in order. With `steps`, messages draw in as the voice reaches them. A sequence taller than the frame scrolls under its pinned participants, and each step moves the camera to its messages. |
| `er` | Tables and crow's-foot relations. With `steps`, each table, field or relation lights as the voice names it. |
| `state` | A state machine with an entry dot, final states and labelled transitions. |
| `mermaid` | Any Mermaid diagram (class, gantt, git graph or pie, among others) as a static themed SVG, for diagrams the other scenes don't cover. |
| `tests` | A matrix: rows are situations the code meets, columns the outcomes it promises, and each cell the promised value. A cell a test checks is green with a tick and NEW or CHANGED; a promise no test checks is amber, "unchecked"; a situation no test tries is a red dashed bar with what goes wrong. A removed test's old value shows struck through. A step that focuses a test shows its name in the callout, and the tests that check each row are listed beside it when there is room. |
| `table` | Rows and columns of text, such as settings, API parameters or error codes. A changed cell shows its old value struck through beside the new one. Steps can show rows that start `hidden`, `set` cells and `tint` rows and cells. |
| `chart` | A bar, line, pie or donut chart of one or more series, bars side by side or `stacked`, upright or `horizontal`. Steps `set` new values, which the bars, points and slices move to, and `sort` orders bars and slices by value, so bars overtake each other as a race. With two series, such as before and after, each label gets a change badge like −42%, coloured by `better`, unless `badges` is `false`. A value under 10,000 prints with up to four significant digits, as written when it has four or fewer. `annotation` calls out one point. |
| `timeline` | Events on a time axis, and `spans` under it for waits and windows. A playhead reveals them left to right, or moves to each step's events. Cards of events close in time move apart, and a bent leader joins each card to its dot, so no card covers another. |
| `files` | The changed files as a tree with line counts and a diffstat bar, tests marked, and a note beside each file the narration names. |
| `compare` | Two sides, such as before and after or two designs, row by row at the same height. A row that differs gets an arrow between the sides, a row that is the same dims behind an `=`, and a `verdict` marks the better side green and the worse red. A cell is text, a short code snippet or a picture. With `steps`, rows show as the voice reaches them. |
| `terminal` | A shell session in a window. Each command types out, then its output prints, and a failed exit tints the entry red. Long lines wrap and a long session scrolls. With `steps`, each step types its entries and the camera follows. |
| `layers` | Stacked bands in their real order, each with a label, a caption and the components inside it. A `path` sends a request token down through its stops and, with `return`, back up with a reply. `skip` answers early at one stop, turns the token back there, and fades the stops it never reached. |
| `array` | A row of cells with their indexes, named `pointers` above them and shaded `ranges` under them; with `arrays`, several rows that share one cell size, each with its label at its left; with `cells: "hex"`, a hex grid. Each step can `set` cell values, `move` a pointer or range, `show` or `hide` one, and `tint` cells. A changed value slides out and the new one slides in, briefly lit. |
| `memory` | Call frames with their variables on the left and objects with their fields on the right. Variables and fields keep the order written. A value `{ "ref": "c1" }` draws an arrow to that object, so aliasing shows as two arrows into one object; an arrow that is not into the next column runs through the gaps and under the cards, never behind one. Each step can `set` a variable or field, which re-routes its arrow, and `show` or `hide` a frame or object. |
| `svg` | A drawing in SVG markup: a map, a tiling, a geometric figure, points on a plane. Steps light, `tint`, `show`, `hide` and rewrite its elements by id, and [move, trace and morph](#motion-on-a-drawing) them. `validate` cuts nothing silently: it fails on anything that is not a drawing element or attribute. |
| `plot` | Numeric axes with lines of x, curves of t, data series, points, arrows and shaded areas, or a number line without `y`. A part's numbers can be expressions in named `params`; a step's `set` changes one and every part that reads it reshapes or moves, and `trace` draws a line on across the step's words. See [Plots](#plots). |
| `map` | A real world map from Natural Earth's public-domain outline: countries by ISO 3166-1 alpha-3 code or name, `places` at `[lat, lng]` with labels, `routes` that follow the great circle between their stops, `lines` along a parallel or meridian, and shaded `regions`. A step's `view` eases the camera to a box or round some refs, `trace` draws a route or line on from its first stop, and `show`, `hide`, `tint`, `set` and `callout` work as on the other stepped scenes. Projections: `equal-earth` (the default), `natural-earth` and `mercator`. |
| `image` | A picture from a file or a URL, which `validate` copies into the run, fitted `contain` or `cover`, with a caption and credit, a slow pan and zoom, and regions that steps light and ink draws on. |
| `review` | In [review mode](#review-findings), every finding, worst first, with its severity, file, line and claim, under "Claude's review". |
| `reading` | In a [pre-read](#pre-read), the order in which to read the code after the video. |

The stepped scenes (`array`, `memory`, `graph`, `table`, `svg`, `plot`, `map` and `chart`) also take a `callout`: a boxed line at the right of the header, such as a formula with real numbers. A step's `callout` replaces it from that step on, and `""` removes it. A `tint` maps refs to a colour that stays from its step on: a tone (`good`, `bad`, `warn`, `accent`, `neutral`), `"dim"` for ruled out, or `"clear"`. A scene-level `tint` is the first state. The callout box is as wide as its text, and a title too long beside it wraps onto a second line. `validate` warns on a part that starts `hidden` and no step shows.

A `tests` scene written before 0.27, with `cases` and `gaps`, still validates and renders: each case reads as a situation named by its test, with one outcome, "Proves" (or its `titles.proves`), and each gap as a situation drawn as a gap. A case's `badge` and `tone` and the `subject` and `none` titles are not drawn. A decision `graph` with `tint` can show the paths tests take through the code: see `examples/primitives/tests-map/`.

## Examples

Each storyboard under `examples/` passes `mr-cast validate`, and CI checks it.

- `examples/demo/` is a rate limit change. `scripts/demo.sh <dir>` creates the git repository it describes.
- `examples/demo-simple/` tells the same change line by line.
- `examples/primitives/<type>/` holds a short demo of each scene type.
- `examples/algorithms/`, `examples/architecture/` and `examples/explain/` hold eleven worked explanations with real numbers: quicksort, binary search, merge sort, Dijkstra, hash tables, YouTube, React, OAuth, H3, Bitcoin and GPT. Each has a `generate.mjs` that computes its numbers and writes its storyboard; run it with `node`.
- The [gallery](gallery.md) shows a still of each worked example and each scene type, with its storyboard and its video.
- `examples/gallery/` shows the `files`, `state`, `table`, `chart`, `timeline`, `mermaid`, `tests`, `compare`, `terminal`, `layers`, `array` and `memory` scenes, and a flowchart.
- `examples/people/` explains how a support ticket gets resolved, with no code at all.
- `examples/preread/` is a pre-read of a rate limit change, with a `plan.json`.
- `examples/review/` is a password reset change with review findings. `scripts/review-demo.sh <dir>` creates its git repository.

## Charts that move

A chart step's `set` gives new values from that step on, as a series name to one number per label or one value `"series@label"` to a number. The bars, points or slices move to their new sizes as the step starts, and the printed values count to theirs. `sort` on the scene or a step orders bars and slices by value, largest first, and a bar that changes place slides past the others. A horizontal chart prints each value past its bar and has no axis: each bar is as long as its value against the largest value then on screen. With one series and no `tone`, each of its bars has its own colour. A pie or donut takes one series; a donut prints the total in its hole.

## Typing code

A code scene with `typing` types each step's lines in over the step's `say`, behind a cursor; lines no step names are there from the start, and removed lines are not drawn. A step's `output` prints into a pane beside the code, like a terminal, at the words of `outputWhen`, else once the step's lines are typed. The output works without `typing` too.

## Pictures

An `image` scene shows a picture, and a compare cell can be `{ "image": "before.png" }`. `src` is a path relative to the run directory or the repository, or an http(s) URL. `mr-cast validate` copies the file into the run's `images/` folder, or downloads the URL there once, and writes `images.json`; the player serves only that folder and renders read only the copies. A picture must be a PNG, JPEG, WebP or GIF file of up to 10 MB, checked by its first bytes; SVG files are refused because they can carry scripts. mr-cast does not make or change pictures: it shows the file given, and whoever makes the video owns the right to use it.

## Code from a diff or from snippets

A code scene shows one hunk of `hunks.json` by its id, such as `h3`. `mr-cast extract` writes the hunks of a branch.

An explanation has no diff. `mr-cast snippet src/limiter.ts:12-30` adds those lines as a snippet, such as `s1`, and a code scene shows it the same way. A snippet has a neutral SOURCE badge and its line range, in the single-column view.

## Steps

`steps` let the video move the viewer's attention as the voice explains.

A code scene's steps each name their `lines` (or `oldLines` for removed code) and what to `say` while those lines are highlighted. Each step lasts as long as its words, so the highlight follows the voice. The scene's `narration` becomes the intro, spoken while the diff morphs in. Removed lines stay on screen until the last step about them, then collapse. A `label` on every step draws the step diagram beside the code.

A diagram's steps each name what to light in `focus`, one ref or a list, and what to `say`. The whole diagram draws first. Half a second before each step's words, its focus lights up, earlier steps' items stay softly visible, and the rest dims. A sequence, a timeline, a compare and a terminal also reveal their messages, events, rows or entries as the steps reach them.

| Scene | A `focus` ref is |
| --- | --- |
| `graph` | A node id, an edge `"from->to"` (or `"a-b"` for either direction), a group `"group:Support team"`, or an edge index; with a `table`, a row `"row:A"` (by index or first cell), a column `"col:Distance"` or a cell `"Distance@A"`. A bare number that is both an edge index and a row index fails `validate`; name the edge or the row. A step that changes something and has no `focus` focuses what it changes. |
| `sequence` | A message index, an `"a-b"` range of them, or a participant id. A step draws every message up to the last one it focuses. |
| `er` | An entity id, a field `"orders.status"`, a relation `"users->orders"`, or a relation index. |
| `state` | A state id, a transition `"pending->paid"`, a transition's exact label such as `"pay"`, or a transition index. |
| `table` | A row index, a column `"col:Value"`, or one cell `"Value@2"` (column, then row index). A step that changes something and has no `focus` focuses what it changes. |
| `chart` | A label, a series `"series:after"`, or one value `"after@p99"`. |
| `timeline` | An event index, an `"a-b"` range of them, or a span `"span:wait"`. The playhead moves to the furthest one. |
| `files` | A path in the tree. |
| `layers` | A layer id, an item id or `"layer.item"`, or a path stop index. A step that focuses a stop moves the token there. The token only moves on along the path, so focus the first stop again to bring it back up. |
| `tests` | A situation id (its row), a cell `"retry.Calls"`, an outcome (its column), or a test's name (every cell it checks). |
| `array` | A cell index, an `"a-b"` range of cells, a pointer `"ptr:lo"`, or a range `"range:window"`; with `arrays`, a cell `"left[0]"`, cells `"left[0-1]"`, or a whole array `"array:left"`. A step that changes something and has no `focus` focuses what it changes, except what it only dims. |
| `memory` | A frame `"frame:main"`, a variable `"main.cart"`, an object id, or a field `"c1.items"`. A step that changes something and has no `focus` focuses what it changes. |
| `svg` | An element id. A lit group lights everything in it. A step that changes something and has no `focus` focuses what it changes. |
| `plot` | A part's id, or a parameter's name, which lights every part that reads it. A step that changes something and has no `focus` focuses what it changes. |
| `map` | A country code such as `"CAN"` or its name, the id of a place, route, line or region, or `"map"` for all of it. A lit route lights its stops. A step that changes something and has no `focus` focuses what it changes, or what its `view` frames, or the whole map. |
| `text` | An item index or an `"a-b"` range of them, `"note"`, `"kicker"`, the lead's field name such as `"number"`, or a side `"left"` or `"right"`. A step that changes something and has no `focus` focuses what it changes. |
| `compare` | A row index, an `"a-b"` range of them, a side `"side:After"` (by title, or `"side:0"`), or one cell `"2@After"` (row, then side). A step shows every row up to the last one it focuses. |
| `terminal` | An entry index, an `"a-b"` range of them, or one output line `"2:3"` (entry, then line, from 0). A step types every entry up to the last one it focuses, and scrolls back to an earlier one. |

A `flow` scene gives each of its own steps a `say` instead, and a step becomes current just before its words. Without steps, a diagram is fully drawn before the narration starts.

`validate` checks every ref and suggests the closest name when one matches nothing. It also warns when a step's words name something the step does not light, and when a change lands before the words that describe it. `mr-cast steps` prints each step's words beside what it lights, with these warnings.

## Timing

Each spoken text is a segment: a lead, the voice, and a tail. The narration waits until the scene has drawn in. That takes 1 second, or the scene type's build time plus 0.3 seconds when longer. Most diagrams take 1.5 seconds, so their voice starts at 1.8 seconds. Each step's items light up 0.5 seconds before its voice and stay lit 1.2 seconds after it. Without a voice clip, a segment reads at 130 words a minute and holds 1.5 seconds after, 3 seconds at least. The pace scales the reading speed and every pause.

## Pen marks

A step can draw on what it points at, like a reviewer circling a line on a printout. Give the step a `mark` and, optionally, a `note`:

```json
{ "focus": "redis", "mark": "arrow", "note": "no fallback", "say": "If Redis goes down, every order fails." }
```

| `mark` | Draws |
| --- | --- |
| `circle` | A loop around it. |
| `underline` | A line under it. |
| `box` | A rectangle around it. |
| `arrow` | An arrow pointing at it from free space nearby, with the note at its tail. |
| `strike` | One line through it. |
| `cross` | An X over it. |

The mark goes on the step's first `focus` ref, or on the whole range for a ref such as `"3-5"`. A code step marks its `lines`, or with a `token` only that text on them: `{ "lines": 8, "mark": "circle", "token": "max: 20", "say": "..." }`. The `note` is a few handwritten words, up to 40 characters, placed beside the mark where it covers least.

The pen starts once the step has settled, after its camera has moved and its items have lit up, and finishes just before the step's words begin. The mark fades when the next step starts. A mark on the last step stays until the scene ends.

`validate` rejects an unknown `mark`, a `note` over 40 characters or without a `mark`, a `token` outside a code step, and a `token` that does not occur exactly once on its lines.

## Ink

A step can also write and draw on the scene, like a teacher at a whiteboard. Its `draw` lists the items, each keyed by what it draws, and they stay on the board until a later step's `erase`:

```json
{ "set": { "A": "3" }, "say": "Going through B costs two plus one, which is three.",
  "draw": [{ "arrow": ["B", "A"], "note": "2 + 1 = 3", "when": "two plus one" },
           { "write": "3 < 4", "near": "Distance@A", "tone": "good" }] }
```

| Verb | Draws |
| --- | --- |
| `circle`, `box`, `underline`, `strike`, `cross` | As the pen marks above, on a ref, a list of refs, or an earlier item's `id`. |
| `tick` | A check mark to its right. |
| `brace` | A curly brace along the span its refs cover. |
| `arrow` | `[from, to]`: an arrow between two refs, ids or `[x, y]` points. |
| `write` | Handwritten text `near` a ref or id, or `at` an `[x, y]` point, each a fraction of the stage. |

An item can add a `note`, a `when` (words of the step's `say` at which it starts), a `tone`, a `side` and an `id`. Without `when`, a step's items draw one after another once its items have settled. A stroke draws at about 60 pixels a frame, an arrow at 40, and handwriting at 2.2 frames a character, with the pen's tip at the end of the line. `"erase": true` takes everything off the board as the step starts, before the step's own `draw`, and `"erase": ["id"]` takes the named items. Ink fades out over 10 frames.

Each item goes where it covers least of what the scene shows from its step on, including pointers that move later and ink already up. Text with no clear spot beside its target goes to the end of its row, as a comment ends a line of code, or else to free space with a leader arrow back. A long arrow bends, or swings round the side, to cross the fewest things. On a code, terminal or sequence step, ink moves with the camera, and on code it is clipped to the code's viewport. Ink on refs moves with them when a later step moves them: a circle round a bar slides with it when a sort reorders the chart, and ink on a plot point or a moved svg shape follows it.

A step's `mark` and `note` are the shorthand for one item on the first focus ref, drawn in the half second before the words and cleared at the next step. They draw as before. Ink is not lit: the highlight check reads only `focus` and what a step changes.

`validate` fails on an item with no verb or two, an unknown field, a ref that names nothing, an id not on the board at that step (an `arrow` from an item drawn later, an `erase` of an id never drawn), an id that is also a ref, a `when` the step's `say` does not contain, and a note or a line of text over 40 characters. It warns when text written `at` a point lands on what a graph, table, array, memory, svg, state or tests scene draws while the text is up, and when ink text has markup, which is dropped. `mr-cast still <scene> --step <k>` renders the board as step k ends. The full reference is [skill/mr-cast/references/ink.md](../skill/mr-cast/references/ink.md), and [examples/primitives/ink](../examples/primitives/ink/storyboard.json) is a short demo.

## Camera

A step's `camera` zooms and pans the scene to what it names, on every scene whose steps take refs but the map, and on code. A map's camera is its own `view`, which keeps its labels their size; an `image` with `kenBurns` already moves, so its steps take no camera. It stays until a later step's camera; `"all"` pulls back to the whole scene, which is also what the narration shows.

```json
{ "camera": { "on": "ribosome", "zoom": 4 }, "focus": "ribosome", "say": "Zoom in on one ribosome." }
```

The value is `"all"`, a ref, a list of refs, or `{ "on": refs, "zoom": z }`. Without `zoom` the camera fits the refs with a margin, enlarged at most 6 times; `zoom` runs from 1, the whole scene's scale, to 40. The view keeps inside the scene and never shrinks it. It eases there as the step starts, with the step's other changes, and grows or shrinks about one still point, as a camera moving straight in does. When a later step moves its refs, such as a pointer that slides, the camera follows. Ink and pen marks move with the content, and the view fades out over 32 px at its edges. A state step (`array`, `memory`, `graph`, `table`, `svg`, `plot`, `chart`, `text`) that only moves the camera needs no `focus`.

`validate` fails on a ref that names nothing, a zoom outside 1 to 40, an empty list, `"all"` inside a list, an unknown field, and a camera on a `flow` scene. It warns when a shot leaves a lit ref out of view on a graph, table, array, memory, svg, plot, chart, image, state, tests, er, files, layers or timeline scene, and the soft-picture warning counts how close a camera brings a picture. On an svg scene the small-text warning measures each text at the zoom of every state it is shown in, so detail text too small for the whole scene passes when it shows only while the camera is zoomed in on it. The full reference is [skill/mr-cast/references/camera.md](../skill/mr-cast/references/camera.md), and [examples/primitives/camera](../examples/primitives/camera/storyboard.json) is a short demo.

## Motion on a drawing

An `svg` step can move its elements, draw lines on, and change one shape into another:

```json
{ "move": { "t1": "translate(0 300)", "needle": "rotate(120 1080 420)" },
  "trace": [{ "ref": "route", "when": "around the coast" }],
  "morph": { "blob": "square" }, "say": "..." }
```

| Field | Does |
| --- | --- |
| `move` | Gives elements a transform of `translate`, `rotate` and `scale`, outside their own, tweened from the last one. `""` puts an element back. Moves with the same functions tween argument by argument, so a rotation turns about its pivot. `{ "to": transform, "when": words }` plays the move at an even pace from those words to the end of the `say`, and `{ "to": transform }` across the whole say, so an orbit takes as long as the sentence. |
| `trace` | Draws a path, line, polyline, polygon, rect, circle, ellipse or group of them on from its start, at about 40 px a frame, from its `when` cue or as the step settles. A hidden element is shown. |
| `morph` | Gives a path the shape of another path, usually hidden, tweened point for point; naming the path itself restores it. Any two paths with the same number of outlines morph: each is turned into cubic curves, and the shorter list is split until they pair. |

`class="flow"` on a line or group gives it marching dashes over a faint copy of itself, as a graph edge has. A step's `focus` defaults to what it moves, traces or morphs. `validate` fails on a move of the root `<svg>` or with another function, a trace of something with no line, a `when` the step does not say, a morph to or from anything but a path or between paths with a different number of outlines, a trace on a scene other than svg, plot and map, and a morph on any but svg. `trace` takes the same entries on a `map` step, where `when` is the words a route arrives on, and ids on a `plot` step, timed by the step's own `when`. The full reference is [skill/mr-cast/references/motion.md](../skill/mr-cast/references/motion.md), and [examples/primitives/motion](../examples/primitives/motion/storyboard.json) proves a² + b² = c² by sliding four triangles.

## Text on screen

A scene never cuts its text. Every label, caption, bullet, note, cell and title wraps to the lines its place allows, then shrinks down to a minimum readable size. Text that still does not fit makes `validate` fail, naming the scene, the item, the text and a fix:

```
scenes[2] ("Who calls whom").messages[4].label: "POST /orders/{orderId}/line-items/{lineItemId}/adjustments" does not fit its message label, even at 15px; shorten the label, or split the message in two
```

`validate` runs the player's own layout code, so it and the video agree. A diagram that is scaled down to fit, such as a long graph, a state machine or an er diagram, warns when the scale draws its text under 15 px. File paths, hunk headers and lines of code are the source's own text, so they shrink further with a warning instead. Text is drawn in Inter and code in JetBrains Mono, both bundled ([Inter license](../src/assets/inter-OFL.txt), [JetBrains Mono license](../src/assets/jetbrains-mono-OFL.txt)). Widths come from tables measured from those font files, so a video lays out the same on macOS and Linux. Pen notes use the bundled Caveat font ([Caveat license](../src/assets/caveat-OFL.txt)).

On-screen text takes inline markup for the one word or value a sentence is about:

| Markup | Draws |
| --- | --- |
| `**bold**` | Heavier weight. |
| `` `code` `` | A monospace chip. Everything inside is literal. |
| `==marked==` | A highlighter behind the words. |
| `[words]{tone}` | The words in a tone: `good`, `bad`, `warn`, `accent` or `neutral`. |

Bold and code can go inside a mark or a tone, and nothing else nests. `**` and `==` open only before a word and close only after one, so `a ** b` stays literal. `[` is markup only when `]{tone}` follows. A backslash makes `*`, `` ` ``, `=`, `[`, `]`, `{` or `}` literal. `validate` fails on unclosed markup or an unknown tone, with its column. Narration, `say` and pen notes are spoken, so mr-cast drops their markup before the voice and the subtitles, with a warning.

## Plots

A `plot` scene draws numbers on axes. `x` and `y` each have `from` and `to`, and optionally a `label`, `ticks` (a step, a list of values, or `"pi"` for multiples of π/2), `log` for powers of ten, `grid`, and a `prefix` or `suffix` such as `"$"` or `"%"`. Tick numbers from ten thousand read as `20k` and `1.5M`. `equal: true` gives both axes the same unit, so a circle is round. Without `y`, the scene is a number line with points and vectors.

Each part has an `id`, a `label`, a `tone` and `hidden`:

- `functions` draw `y` as an expression in x between `from` and `to`, or a curve with `x` and `y` in t over `t`. A line breaks where it has no value.
- `series` draw `[x, y]` `points` as a line, dots or both.
- `points` sit `at` `[x, y]`, with their label on a `side` and dashed `guides` to the axes.
- `vectors` are arrows `from` (default the origin) `to`.
- `areas` shade `under` a line down to y = 0, or `between` two lines.

Any number a part is placed by can be an expression in the scene's `params`, such as `"10000 * 1.07^year"`. Expressions take numbers, names, `+ - * / ^`, unary minus, parentheses, `pi`, `e`, the common functions (`log` is the natural log), `min`, `max`, `mod` and `sum(k, from, to, term)`. They are parsed, never run as code, and read nothing but the parameters and x or t. A label shows a value with `{expr}`, or `{expr:0}` for its decimals.

A step's `set` changes parameters, and every part that reads one reshapes or moves to the new value over the half second the step settles in. A sum whose upper bound is between two whole numbers adds its last term in part, so adding terms grows the curve smoothly. `trace` draws lines, series, vectors or areas on from left to right across the step's words and moves that step's parameters over the same time, so a point placed by a parameter rides along the line as it draws. A traced line's label appears once it is drawn. `when` starts a step's changes at those words of its `say`.

`validate` fails on an expression that does not parse, at its column, and on a name that is no parameter. It draws every step and warns on a line with no value inside its range, a line or point off the plot, labels that overlap each other or the axis text or run off the stage, and tick labels that overlap.

## Diagram nodes

Graph nodes and sequence participants are the same kind of card, so they can be people, teams, places and documents as well as services. Each has an `id` and a `label`, plus:

- `icon`, any [Lucide icon](https://lucide.dev/icons) name such as `user`, `headset`, `building-2` or `database`. `validate` rejects a name Lucide lacks and suggests close ones.
- `caption`, a short line under the label, such as `customer` or `datastore`.
- `change`, `highlight` and `badge`. See [Marks](#marks).
- `tone`, the colour of the icon and the badge: `neutral`, `accent`, `good`, `bad` or `warn`.

A graph node also takes a `group`. Nodes in one group are drawn inside a labelled box. A graph edge takes a `label`, a `direction` (`forward` by default, `both`, or `none` for a plain line), a `style`, and a `change` or `highlight`. The `style` is `flow` (dashes move along the edge), `solid` (still), or `dashed` (a weak or indirect link). A graph lays out left to right, or top to bottom with `"layout": "TB"`.

A node's `shape` draws a flowchart:

| `shape` | Draws |
| --- | --- |
| `card` | The default card, with its icon and caption. |
| `decision` | A diamond holding a short question, such as `"Cache hit?"`. Label each edge leaving it with its answer, such as `"yes"` and `"no"`. |
| `terminal` | A pill, where the flow starts or ends. |
| `step` | A plain box for an action, with a caption and no icon. |

A graph with a decision lays out top to bottom unless it sets `layout`, draws still arrows unless an edge sets `style`, and is headed Flowchart. Focus, pen marks, badges, `change` and `highlight` work on every shape.

## Marks

Three marks say three different things:

- `change` says what the diff did to an item: `added` (green, NEW), `removed` (red, dashed and struck through, REMOVED) or `modified` (blue, CHANGED). A viewer reads every change mark as a fact about the diff.
- `highlight: true` points at the part a whole scene is about, with a soft white glow and no word. To point at parts one at a time as the voice names them, use `steps`.
- `badge` is your own label, up to 14 characters, such as `"hot path"`, `"v2"` or `"owner"`, drawn as a pill in the item's `tone`.

| Item | `change` | `highlight` | `badge`, `tone` |
| --- | --- | --- | --- |
| graph node, sequence participant | yes, with a badge | yes | yes |
| graph edge | yes | yes | no |
| sequence message | yes, with a badge | yes | yes |
| er table | yes, with a badge | yes | yes |
| er field, er relation, state transition | yes, by colour and a `+`, `−` or `~` marker | yes | yes |
| state | yes, with a badge | yes | yes |
| table row | yes, by colour and marker | no, use the scene's `highlight` or `steps` | yes |
| timeline event, span | no | yes | yes |
| files entry | yes, by colour and marker | no, use the scene's `highlight` or `steps` | yes |
| layer, layer item | yes, with a badge | yes | yes |
| test | its `status` | no | no |

Everything that names a change uses the same three words: NEW, CHANGED and REMOVED. A code header says RENAMED for a renamed file and SOURCE for a snippet. An explanation that explains a change sets `"explainsChange": true` on the storyboard or the scene to use change marks.

## Review findings

In review mode, the storyboard holds Claude's flags in `findings`. Each finding has an `id`, a `severity` (`bug`, `risk` or `nit`), a `file` and `line` from the diff, a one-line `claim` shown on screen, and one line of `evidence` written to `review.md`. `"findings": []` records a review that found nothing.

```json
{ "id": "token-reused", "severity": "bug", "file": "src/reset.js", "line": 21,
  "claim": "Deletes by user id, so a used token still works",
  "evidence": "delete(row.userId) removes nothing, so the same token works twice" }
```

A code step shows a finding with `"flag": "<id>"`. It draws a circle in the severity's colour (red, orange or blue) with the claim as the note, unless the step names its own `mark` or `note`. A `review` scene lists every finding, worst first. It is optional, and it can go anywhere in the storyboard. `validate` fails on a `review` scene when `findings` is empty.

`validate` checks that each finding's file and line are in the diff, that its severity is valid, and that it has a claim and evidence. It checks that each `flag` names a finding and sits on the step whose lines hold the finding's line. It warns about a finding that no step flags. An explanation has no diff, so `validate` fails on `findings` there. It writes `review.md` into the run's directory, with each finding as a `file:line` bullet and its evidence.

## Pre-read

Pass `--audience preread` to each command for a pre-read. A pre-read shows no code, so it has no `code` scene and no code cell in a `compare`.

- A diagram can name the hunks it explains in `"from": ["h1", "h3"]`. The scene shows them as a quiet "In the code: limiter.ts, server.ts" line.
- A `reading` scene lists hunks in reading order in `items`. A storyboard has at most one, and it can go anywhere. Each item has a `hunkId`, and a `check`: what to verify there, such as "the key resets on a new minute; check the off-by-one". The file and lines come from `hunks.json`. `"lines": "40-58"` points an item at the lines that matter inside its hunk. An item marked `"routine": true`, such as wiring or config, needs no `check`. It stays off the screen, and `reading.md` and the player list it on one "skim" line. The scene shows the first 6 items under "Read first" and counts the rest.
- `validate` writes `reading.md` beside the storyboard: a ``- [ ] 1. `src/limiter.ts:12-30`: check`` checklist to paste into the merge request. `outline` prints the same order as `path:line` lines. The player shows it in a **Reading order** panel, where each item's "Explained in" seeks the video to the scene that explains it.
- In review mode, a reading item takes `"flag": "<id>"` for the finding in its hunk, shown in the severity's colour. A pre-read has no `review` scene, and its code steps take no `flag`. `validate` still writes `review.md`.
