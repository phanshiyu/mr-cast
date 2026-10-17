# What the scenes can show: eleven blueprints, beat by beat

This document checks eleven video blueprints against the scenes mr-cast has in 0.25.0. It lists every visual beat, groups the beats into kinds of idea, says which scene shows each kind today and how well, ranks what is missing, and proposes the smallest set of additions. The user picks the set before any example storyboard is written.

The blueprints are the quicksort outline and the ten in `blueprints.md` and `blueprints-2.md`. This document calls them by these codes:

| Code | Blueprint |
| --- | --- |
| QS | Quicksort (outline) |
| BS | Binary search |
| MS | Merge sort |
| DJ | Dijkstra |
| HT | Hash tables |
| YT | Designing YouTube at scale |
| RE | How React works |
| OA | OAuth 2.0 with PKCE |
| H3 | Uber's geospatial problem and H3 |
| BC | How Bitcoin works |
| GP | How a GPT predicts the next word |

**How each verdict was reached.** Most verdicts come from the field definitions in `src/types.ts` and the renderers in `src/components/`. Six were checked against the real tools on 2026-10-17: a probe storyboard ran through `mr-cast validate` and `mr-cast still`. The probe is marked "probed" where it is cited. The numbers in "Facts in the blueprints" were checked by a script that runs each algorithm.

A verdict is one of three words:

- **Fully.** A scene shows the beat with fields it has today.
- **Awkwardly.** A scene shows a weaker version, or only with a workaround that the viewer can see.
- **Not at all.** No scene draws it.

## Beat catalogue

Each kind of idea lists the beats that need it, the scene that shows it today with the exact fields, and the verdict.

### 1. A value changes in a fixed row of slots

Beats: QS partition swaps with `i` and `j`; BS the cursor stepping cell by cell, then `L`, `R` and `mid`; MS the output slots filling; HT a key landing in slot 0, the probe stepping to slot 1; BC the nonce counter spinning; GP the prompt as a row of token blocks.

Today: `array` with `values`, `pointers`, `ranges`, and steps that `set`, `move`, `show` and `hide`. **Fully** for one row of up to 16 cells.

### 2. A cell, node or row keeps a colour across steps

Beats: BS eliminated halves struck out, the found cell solid green; QS each pivot in its final place; MS sorted pieces; HT the collision slot flashing red, a full table at 7 of 8; DJ visited nodes turning orange; BC a rejected ledger row in red; H3 the k-ring lighting outward; GP tokens as coloured blocks.

Today: an `array` range tints the cells it covers and draws a band under them, but it covers one contiguous span, and more than 3 ranges get cramped. A pen mark `strike` or `cross` lasts only its own step. A graph node's `tone` colours its icon and badge only. A table row has no colour of its own apart from `change`. **Awkwardly** for one contiguous span in an array, **not at all** for scattered cells, graph nodes and table rows.

### 3. A formula or comparison evaluated with real numbers

Beats: BS `mid = L + ⌊(R − L) / 2⌋`, then `= 0 + ⌊(15 − 0) / 2⌋ = 7`, then `72 > 45`; DJ the relaxation rule `d(u) + w(u,v) < d(v)` and `2 + 1 = 3 < 4`; HT `99 + 97 + 116 = 312`, `312 mod 8 = 0`, `α = N / M = 0.875`; MS `log₂ n levels × n per level`; QS the complexity summary; BC `SHA-256(transactions + nonce)` starting with 30 zero bits; GP softmax `P_i = e^(z_i / T) / Σ e^(z_j / T)`; OA `code_challenge = BASE64URL(SHA256(code_verifier))`; H3 the parent as bit operations; RE `UI = f(state)`.

Today: a scene `title` is fixed for the whole scene. A pen `note` holds 40 handwritten characters for one step. A `flow` step's `payload` holds one line. An `intent` card holds bullets with no diagram. **Awkwardly**: nothing puts a changing formula beside the cells it computes on.

### 4. A structure grows a level at a time

Beats: MS the divide tree expanding downward, level by level; BS the halvings 16, 8, 4, 2, 1 appearing as a tree; QS the recursion splitting into sub-arrays; BC blocks added to the chain, then a fork, then one branch growing longer; DJ the shortest path drawn edge by edge at the end; YT the transcoding DAG fanning out.

Today: a `graph` draws every node and edge before its first step; steps only light and dim. A `memory` scene can `show` a frame or object, so a call stack grows. A `sequence`, `timeline`, `compare` or `terminal` reveals its items in order. **Awkwardly** for trees and chains, which are graphs; **fully** for a call stack.

### 5. Several rows of slots at once

Beats: MS the zipper merge, left `[13, 51]` and right `[4, 89]` with a pointer on each feeding a 4-slot output; MS the lone `[42]` beside the unsorted array; MS each divide level as halves of the row above; HT the resize, 8 slots then 16; QS the two sub-arrays after a partition.

Today: an `array` scene has one row. Two rows need two scenes, so the zipper's three rows never share the screen. **Not at all**.

### 6. A graph whose numbers change per step, with a table that changes in step

Beats: DJ each node's tentative distance updating, 4 crossed out and 3 written in, with a tracker table (Node, Distance, Previous, Visited) beside the graph; BC the prev-hash link breaking when an old block is edited.

Today: a node's `badge` and an edge's `label` are fixed. A `table` cell `{ before, after }` strikes an old value beside a new one, but the table is fixed for the whole scene, and no scene holds a graph and a table together. **Not at all** in one scene; **awkwardly** as a graph scene followed by a table scene.

### 7. A table whose rows arrive, change and get rejected

Beats: BC the communal ledger gaining rows, the ID on each row, balances found by scanning down, "Charlie pays David 30" turning red; HT the summary card; H3 the resolutions table; OA the valet key mapped to the four roles.

Today: `table` with `rows`, `columns`, cells `{ before, after }`, and steps that light a row, a column or a cell. Every row draws at the start. **Fully** for a fixed table (HT, H3, OA); **awkwardly** for the ledger, whose rows should arrive one at a time and turn red.

### 8. A pointer walks a linked structure, or a reference re-points

Beats: RE the Fiber nodes with `child`, `sibling` and `return` pointers and `workInProgress` walking them; RE the `current` pointer swapping to the finished tree; HT separate chaining, slot 0 holding `"cat" → "act" → null`.

Today: `memory` with objects whose fields hold `{ "ref": "<object id>" }`, drawn as arrows, and steps that `set` a field to a new ref. **Fully**, up to 6 objects.

### 9. A call stack grows, blocks, and unwinds

Beats: QS the recursion's frames with their `low` and `high`; RE `render(App)` to `render(NavList)` stacked, with an input event that cannot get in.

Today: `memory` frames, `hidden` until a step shows them. The blocked event is a pen `cross` with a `note`. **Fully** for the stack; the blocked event is one step's pen mark.

### 10. An actor sends a message and waits

Beats: OA the client, the authorization server and the API in swimlanes; YT the creator's upload through the gateway; BC Alice broadcasting a transaction.

Today: `sequence` with `participants`, `messages` (`call`, `return`, `async`) and a short `note`. **Fully** for short labels. Probed: the `/authorize` URL as a message label and the token JSON as a note both fail `validate` ("does not fit its message label, even at 15px").

### 11. A long payload shown readably

Beats: OA the `/authorize` query string, the `/token` request and response bodies, the `Authorization: Bearer` header; YT the HLS manifest lines; YT `UPDATE videos SET views = views + 1`; RE the JSX beside the object it compiles to.

Today: `compare` cells take `{ "code": "...", "lang": "jsx" }`; `terminal` entries wrap long commands and output; `code` shows a snippet. **Fully**. Probed: the JSX and its object side by side in `compare`, and the URL and JSON in `terminal`, both render readably at full size. The payload sits in its own scene, apart from the swimlane that sends it.

### 12. Two or three things compared

Beats: YT control plane against data plane; RE render phase against commit phase; RE the old stack reconciler against Fiber; OA the master key against the valet key; HT separate chaining against open addressing; HT linear, binary search and a hash lookup side by side (three); H3 triangles, squares and hexagons (three); H3 the old way against H3; BS O(n) against O(log n).

Today: `compare` with two `sides` and up to 6 `rows`, each with an optional `verdict`; `table` for three or more columns. **Fully**.

### 13. A quantity over a parameter

Beats: MS O(n²) climbing steeply against O(n log n); BS the log curve and n against steps; BC the attacker's chain against the honest network's; BC the block reward halving 50, 25, 12.5, 6.25, 3.125; GP the next-token probability bars; GP temperature 0.2, 1 and 2 on the same logits; YT throughput dropping in the tunnel.

Today: `chart` with `kind` `bar` or `line`, up to 4 `series`, an `annotation`, and steps that light a label, a series or one value. **Fully** for a fixed chart. Probed: the three temperatures as three bar series on four tokens render cleanly. **Awkwardly** where the bars must change in place: GP's distribution updating after each appended token takes one chart scene per token. A halving drawn as `line` slopes between points instead of stepping.

### 14. Events and intervals on a clock

Beats: YT chunks 0 to 4 s and 4 to 8 s at 1080p, the tunnel at 8 s, the next chunk at 480p; OA the token valid for 60 minutes, then 401, then the refresh; BC a block every 10 minutes; RE the 16.6 ms frame budget.

Today: `timeline` with `events`, `spans` (up to 4) and steps that move a playhead. **Fully**. Probed: the three YT chunks as spans with the bandwidth events above them.

### 15. A pipeline from input to output

Beats: RE `setState()` to scheduler to reconciler to renderer to paint; YT the end-to-end topology; GP tokenize, embed, attention and MLP alternating, unembed, softmax; OA consent, code, exchange, access; HT the hash function as a machine, `"cat"` in and slot 0 out; BC `Sign(message, sk)` and `Verify(message, signature, pk)` as functions.

Today: `flow` for a line of actors with a `payload` each; `graph` with `step` nodes and labelled edges, including an edge back to the start for a loop; `layers` for a request going down a stack. **Fully**.

### 16. Things placed in space

Beats: H3 a city map with hundreds of dots, jagged zone borders, and one car on a border; YT an origin data centre and edge servers in Tokyo, Singapore, Frankfurt and New York; GP word vectors as points in a plane with clusters and the arrows of king + woman − man ≈ queen.

Today: `graph` places nodes by its own layout and ignores `x` and `y`; `group` boxes stand in for regions. No scene plots points at coordinates. **Awkwardly** for YT (groups for origin and edges); **not at all** for the map and the vector plot.

### 17. A grid of cells, square or hexagonal

Beats: H3 a hexagon with its 6 neighbours at equal distance d; H3 a square with 4 neighbours at d and 4 at about 1.414 d; H3 the k-ring, ring 1 lighting 6 cells and ring 2 lighting 12 more; H3 a parent hexagon holding 7 children; GP the context window as 2,048 columns of 12,288 numbers.

Today: no scene draws a grid. A `table` of short cells looks like a square grid but cannot colour a cell. **Not at all**.

### 18. Bit fields in a register

Beats: H3 the 64-bit index split into bit 63, 4 bits of mode, 3 reserved bits, 4 bits of resolution, 7 bits of base cell and 15 digits of 3 bits; BC a signature as 256 bits.

Today: an `array` with one cell per field (20 cells, past the 16 that stay readable) and up to 3 `ranges` naming fields under it. **Awkwardly**.

### 19. Geometry

Beats: H3 the icosahedron inside a sphere and its unfolded net with 12 pentagons; H3 the 7 children rotated about 19.1 degrees inside their parent; H3 triangles, squares and hexagons tiling a plane; RE the browser viewport flashing red on reflow.

Today: nothing draws shapes from coordinates; `mermaid` draws graphs and charts, not polygons. **Not at all**.

### 20. One actor carrying several warnings

Beats: OA three red warnings over PrintMyPhotos (all-or-nothing access, a password stored in its database, revoking means changing the password).

Today: a graph node has one `badge`; a step's pen `arrow` with a `note` shows one warning at a time; an `intent` card lists bullets without the actor. **Awkwardly**.

### 21. Code walked a few lines at a time

Beats: QS `quickSort` and `partition` in Java, the base case `if (low < high)`; GP `y = mx + b` scaled up.

Today: `code` with a snippet (`mr-cast snippet`) and `steps` with `lines`, `label` and pen marks. **Fully**. Java has no grammar in the bundled Prism, so `src/utils/highlight.ts` colours it as C-like: keywords, strings and numbers colour, class names do not.

### 22. A value whose characters change

Beats: BC `SHA-256("Hello")` against `SHA-256("hello")`, the whole digest scrambled; BC one changed character changing the whole signature.

Today: a `table` cell `{ before, after }` or two `compare` rows; the characters that differ can be marked by hand with `==marked==`. **Awkwardly**, since every differing character is marked by hand.

## Gaps, ranked by how many blueprints need them

| Rank | Gap | Blueprints | Count | Kind |
| --- | --- | --- | --- | --- |
| 1 | A formula or comparison that changes per step, beside the diagram | BS, DJ, HT, MS, QS, BC, GP, OA, H3, RE | 10 | 3 |
| 2 | A colour that stays on a cell, node, edge or row across steps | BS, QS, MS, HT, DJ, BC, H3, GP | 8 | 2 |
| 3 | Parts of a graph or table that appear a step at a time | MS, BS, QS, BC, DJ, YT | 6 | 4, 7 |
| 4 | Several arrays in one scene | MS, HT, QS, H3 | 4 | 5, 18 |
| 5 | Things placed at coordinates: a map, a vector plot, polygons | H3, YT, GP | 3 | 16, 19 |
| 6 | Graph badges and table cells that change per step, and a table beside a graph | DJ, BC | 2 | 6, 7 |
| 7 | A long payload on a swimlane message | OA, YT | 2 | 10 |
| 8 | Several warnings on one actor | OA | 1 | 20 |
| 9 | A grid of cells, square or hexagonal | H3 | 1 | 17 |
| 10 | Chart values that change per step | GP | 1 | 13 |

Gaps 7 and 8 have a workaround that reads well: a `terminal` or `compare` scene right after the swimlane carries the payload, and three steps with pen notes carry the warnings. Gaps 1 to 4 have no workaround a viewer would accept, and between them they touch every blueprint except YT.

## Proposed additions

The additions below extend the scenes whose steps already change state (`array` and `memory`) and bring `graph` and `table` into that model. Each scene keeps one rule: its state at step k is its first state with the changes of steps 0 to k applied, and a step with no `focus` lights what it changes. Only P6 is a new scene type.

### P1. `callout`: a boxed line that steps replace

Closes gap 1 for all 10 blueprints. On `array`, `memory`, `graph` and `table`, a scene-level `callout` is display text drawn in a box at the top right of the header. A step's `callout` replaces it from that step on, and `""` removes it. It takes markup, so `[72 > 45]{good}` colours the comparison. The voice does not read it.

```json
{
  "type": "array",
  "values": [2, 5, 8, 12, 16, 23, 38, 45, 56, 67, 72, 79, 84, 91, 95, 99],
  "callout": "mid = L + ⌊(R − L) / 2⌋",
  "steps": [
    { "show": ["ptr:mid"], "callout": "mid = 0 + ⌊(15 − 0) / 2⌋ = 7", "say": "The middle of the list is index seven." },
    { "focus": 7, "callout": "[72 > 45]{good}", "say": "Seventy two is bigger than forty five." }
  ]
}
```

Alternatives:

- **A callout in the header (proposed).** It never covers the diagram, and the header row has room at its right end. It holds one or two short lines.
- **A `formula` scene with substitution steps.** It can show a long derivation, but it cannot sit beside the cells the numbers come from, which is the point of beats such as BS and DJ.
- **Real maths typesetting (KaTeX).** It draws fractions and sums properly, but adds a dependency for formulas that read well in Unicode (`⌊ ⌋ Σ α ≤ ≈`).

### P2. `tint`: a colour that stays

Closes gap 2. A `tint` maps refs to a colour: a Tone (`good`, `bad`, `warn`, `accent`, `neutral`), `"dim"` for ruled out, or `"clear"` for plain again. A scene-level `tint` is the first state; a step's `tint` changes it from that step on. It applies to `array` cells, `graph` nodes, edges and groups, and `table` rows and cells.

```json
{ "tint": { "0-7": "dim" }, "move": { "L": 8 }, "say": "None of the first eight can be seventy two, so they are out." }
{ "tint": { "10": "good" }, "focus": 10, "say": "Index ten holds seventy two." }
{ "tint": { "B": "warn", "S->B": "warn" }, "say": "B is now settled." }
```

`dim` is a separate value because ruled-out cells should recede, not turn red. That is the BS elimination and the DJ settled nodes.

### P3. `hidden`, `show` and `hide` on graphs and tables

Closes gap 3. A graph node or edge, and a table row, can start `hidden: true`; a step's `show` and `hide` take node ids, edge refs and row refs. The graph lays out every node from the start, so a node that appears does not move the others. An edge draws only while both its ends are shown.

```json
{
  "type": "graph",
  "layout": "TB",
  "nodes": [
    { "id": "all", "label": "51 13 89 4 62 28 77 35", "shape": "step" },
    { "id": "l", "label": "51 13 89 4", "shape": "step", "hidden": true },
    { "id": "r", "label": "62 28 77 35", "shape": "step", "hidden": true }
  ],
  "edges": [{ "from": "all", "to": "l", "hidden": true }, { "from": "all", "to": "r", "hidden": true }],
  "steps": [{ "show": ["l", "r", "all->l", "all->r"], "say": "Split the list in half." }]
}
```

The ledger in BC is a table whose rows start hidden and arrive with `"show": [3]`; a rejected row gets `"tint": { "3": "bad" }`.

### P4. Several arrays in one scene: `arrays`, `splits`, `indexes`, `cells`

Closes gap 4, and gap 9 if `cells: "hex"` is kept. An `array` scene takes `arrays` in place of `values`: each array has a `name`, a `label`, `values`, `splits` and `hidden`. All arrays share one cell size, so their cells line up. A cell ref names its array, `"left[0]"` or `"left[0-1]"`; `"array:left"` is the whole array. Pointers and ranges take `"array": "left"`. `splits` cuts an array before the given cells with a wider gap, which draws a divide level as halves. `indexes: false` hides the index labels. `cells: "hex"` draws hexagons, each row set half a cell right of the one above, which is a hex grid.

```json
{
  "type": "array",
  "arrays": [
    { "name": "left", "values": [13, 51] },
    { "name": "right", "values": [4, 89] },
    { "name": "out", "values": ["", "", "", ""] }
  ],
  "pointers": [{ "name": "i", "array": "left", "at": 0 }, { "name": "j", "array": "right", "at": 0 }, { "name": "k", "array": "out", "at": 0 }],
  "steps": [
    { "focus": ["left[0]", "right[0]"], "say": "Compare thirteen and four." },
    { "set": { "out[0]": 4 }, "move": { "j": 1, "k": 1 }, "say": "Four is smaller, so it takes the first slot." }
  ]
}
```

Alternatives:

- **Extend `array` (proposed).** Pointers, ranges, `set`, `move` and the highlight linter keep working on every row. A single-row scene is unchanged.
- **A new `grid` scene of rows and columns.** It is cleaner for H3's hexagons and a 2D table of cells, but it repeats the array's pointers, `set` and `move`, and the zipper merge would still need several arrays.
- **Arrays as graph nodes.** A merge-sort tree of `step` nodes holding `"51 13 89 4"` works today with P3, but a node is 320 pixels wide whatever it holds, so 8 leaves scale the tree down to about 0.6.

### P5. Graph badges and table cells that change, and a table beside a graph

Closes gap 6. A graph step's `set` gives a node a new `badge`, `{ "A": "3" }`. A table step's `set` changes a cell, `{ "Distance@1": { "before": "4", "after": "3" } }`, which strikes the old value. For DJ's tracker, two shapes are possible.

- **A table beside the graph (A).** The graph takes `table: { columns, rows }`, drawn in the right 40% of the frame. Steps `set`, `tint`, `show` and light table cells and rows by `"Header@row"` and `"row:A"`, where a row is named by its index or its first cell. The graph and its table change in the same step, which is the blueprint's design. It costs a split layout in the graph scene, and more than 4 columns or 8 rows get cramped.

  ```json
  { "set": { "A": "3", "Distance@A": { "before": "4", "after": "3" }, "Previous@A": "B" }, "say": "Through B, A costs three, less than four." }
  ```

- **Badges only, then a table scene (B).** Each node's badge carries its distance, and the tracker table follows as its own scene with P5's table `set`. Nothing new is laid out, but the viewer never sees the graph and the table change together.

A is the better match for DJ, which is the only blueprint that needs it; B is cheaper. P1 to P4 do not depend on the choice.

### P6. A drawing scene for things placed at coordinates (optional)

Closes gap 5 if the user wants H3's map and icosahedron and GP's vector plot. Two shapes:

- **An `svg` scene.** The storyboard holds SVG markup; a step's `focus` names element ids and lights them, and `show` and `hide` take ids. It draws anything: a map, a tiling, an icosahedron net, points with arrows. The model must write good SVG, and validate can check only that the ids exist.
- **A `scatter` kind on `chart`.** Points at `[x, y]` with labels, and `arrows` between points. It closes GP's vector arithmetic and nothing else.

Without P6, H3's map is a hex grid (P4) with a zone tint (P2), the icosahedron is said in words beside a table of V, E and F, and GP's vectors are a table of nearest neighbours.

### Not proposed

- **A payload field on sequence messages** (gap 7). A `terminal` or `compare` scene after the swimlane shows the full URL and JSON readably (probed), at the cost of one more scene.
- **Several badges per node** (gap 8). Three steps with pen notes on the node show OA's warnings one at a time.
- **Chart steps that change values** (gap 10). Probed: one bar chart with three series shows the temperatures together, which reads better than one changing set of bars; GP's autoregressive loop takes one chart per appended token.

## What shows what

This index points at the scene and fields that show each kind of idea, with a blueprint beat that proves it. It lists capabilities with examples, not rules: any scene may show any idea. "Today" marks what 0.25.0 already draws; P1 to P6 mark what an addition would add.

| Kind of idea | Shown by | Proved by |
| --- | --- | --- |
| A value changes in a row of slots | `array` with `set` and `move` (today) | BS `L`, `R` and `mid` closing on 72 |
| A colour that stays on cells or nodes | `tint` on `array`, `graph`, `table` (P2) | BS the eliminated halves dimmed, the found cell green |
| A formula with real numbers | `callout` on a stepped scene (P1) | BS `mid = 0 + ⌊(15 − 0) / 2⌋ = 7` above the cells |
| A structure growing level by level | `graph` with `hidden` and `show` (P3) | MS the divide tree |
| A call stack growing and unwinding | `memory` frames with `hidden` and `show` (today) | QS the recursion |
| A pointer walking linked nodes | `memory` objects with `{ "ref" }` fields and `set` (today) | RE `workInProgress` walking child, sibling, return |
| Two arrays merging into a third | `array` with `arrays` and a pointer on each (P4) | MS the zipper merge |
| A graph and its bookkeeping changing together | `graph` with `table` and `set` (P5 A) | DJ the tracker table |
| Rows arriving and being rejected | `table` with hidden rows, `show` and `tint` (P3, P2) | BC the ledger |
| Two or three options side by side | `compare` (two) or `table` (three or more) (today) | RE render against commit |
| Source text beside what it becomes | `compare` with `{ "code" }` cells (today) | RE JSX beside the object |
| A long request or response | `terminal` output or `compare` code cells (today) | OA the `/token` JSON |
| Who calls whom, and in what order | `sequence` (today) | OA the redirect, the code and the exchange |
| A quantity over a parameter | `chart` `line` or `bar` (today) | GP temperature 0.2, 1 and 2 on the same logits |
| Intervals and events on a clock | `timeline` with `spans` (today) | YT 1080p chunks, then 480p in the tunnel |
| A pipeline or loop | `flow`, or `graph` with `step` nodes (today) | RE `setState()` to paint |
| A hex grid lighting outward | `array` with `cells: "hex"` and `tint` (P4, P2) | H3 the k-ring |
| Bit fields | `array` with one cell per field, `tint` and `splits` (P4, P2) | H3 the 64-bit index |
| A shape, a map or a point cloud | `svg` scene (P6) | H3 the icosahedron net |
| Code walked a few lines at a time | `code` with `steps` (today) | QS `partition` in Java |

## Facts in the blueprints

A script ran each algorithm and each calculation. Most numbers hold; these need a fix before an example uses them.

- **BS.** The summary "n = 16 → 4 steps" is this search's count; the worst case for 16 items is 5 (⌊log₂ 16⌋ + 1). The other two rows, 20 for a million and 32 for 4 billion, are worst cases. The table should say "at most" and give 5 for 16.
- **BS.** The halving tree reads 16, 8, 4, 2, 1, but this search went 16, 8, 3, 1. The tree is the general case and should say so.
- **YT.** The blueprint has 720p in AV1 and 360p in VP9 cut into 4-second `.ts` chunks. MPEG-TS segments carry H.264 and AAC; AV1 and VP9 go in fragmented MP4 (`.m4s`, CMAF) segments. Either keep `.ts` with H.264 or say fMP4.
- **OA.** The sample `code_challenge=E9Mel-hopw...` is not the hash of the sample verifier `raw_random_string`. An example should make a real verifier of 43 to 128 characters and compute `BASE64URL(SHA256(verifier))` with a script. The SPA sends no `client_secret` in the token request, which is right for a public client.
- **H3.** The sample index `8828308281fffff` decodes to mode 1, resolution 8, base cell 20, digits 0 6 0 4 0 5 0 0, then seven 7s. That matches the corrected layout.

These were checked and hold: BS's four comparisons (mid 7, 11, 9, 10); MS merging to `[4, 13, 51, 89]`; DJ's order S, B, A, C, E and the path S, B, A, C, E costing 6; HT `"cat"` and `"act"` both summing to 312 and landing in slot 0, and α = 0.875; GP W_E = 50,257 × 12,288 = 617,558,016, and softmax of the logits `[3, 2, 1, 0.5]` at T = 0.2, 1 and 2; BC 2³⁰ = 1,073,741,824 guesses, the rewards 50, 25, 12.5, 6.25 and 3.125, and the 21 million cap.

## What is already built

Commit `35d3f9e` on `wt/examples` is work in progress toward P1 to P5 (option A). It is not usable yet.

- **Done.** The types in `src/types.ts` (`Tint`, `ArrayRow`, `GraphStep`, `GraphTable`, `TableStep`, and the new fields); the state model in `shared/state-steps.mjs` for `array` rows, `graph` and `table`, with `tint` and `callout` on every stepped scene; refs in `shared/targets.mjs` (`left[0]`, `array:left`, `row:A`, `Header@row` beside a graph); `validate` errors for each broken reference; `shared/arrays.mjs`; and the new array layout in `src/utils/arrayLayout.ts`. `pnpm test` passes (227 tests).
- **Not done.** `src/components/ArrayDiagram.tsx` does not draw the new layout yet, so `pnpm typecheck` fails. Nothing draws a callout, a tint, a hidden graph node or a table beside a graph. The highlight linter does not know named arrays, graph badges or the beside table. No new tests, docs or stills.

If the user drops an addition, its part comes out of that commit before the rest is finished.
