# motion

Motion on an `svg` scene: a step's `move` slides, turns and scales elements, `trace` draws lines on from their start, `morph` turns one path into the shape of another, and `class="flow"` marches dashes along a line.

## Example

```json
{
  "type": "svg",
  "chapter": "Morph and flow",
  "title": "Filling a tank",
  "narration": "A pipe fills a tank, and a gauge beside it reads the level.",
  "svg": "<svg viewBox=\"0 0 1400 700\"><path id=\"pipe\" class=\"flow\" stroke=\"var(--accent)\" stroke-width=\"10\" d=\"M60 140 H360 Q420 140 420 200 V230\"/><rect x=\"380\" y=\"220\" width=\"400\" height=\"420\" rx=\"18\"/><path id=\"water\" class=\"tone-accent\" d=\"M392 580 H768 V628 H392 Z\"/><path id=\"water-full\" d=\"M392 300 Q486 280 580 300 T768 300 V628 H392 Z\"/><g id=\"needle\" transform=\"rotate(-60 1080 420)\"><line x1=\"1080\" y1=\"420\" x2=\"1080\" y2=\"270\" stroke=\"var(--warn)\" stroke-width=\"10\"/></g></svg>",
  "hidden": ["pipe", "water-full"],
  "steps": [
    { "trace": [{ "ref": "pipe", "when": "runs in" }], "say": "Water runs in along the pipe." },
    { "morph": { "water": "water-full" }, "move": { "needle": "rotate(120 1080 420)" }, "say": "The level rises, and the needle swings round to full." },
    { "morph": { "water": "water" }, "move": { "needle": "" }, "say": "Drain the tank, and both go back." }
  ]
}
```

## Schema and validate notes

`move` maps element ids to a transform of `translate(x y)`, `rotate(degrees cx cy)` and `scale(s)`, alone or in a row. It goes outside the element's own `transform`, so it moves the element from where the drawing puts it, and it lasts until a later move; `""` puts the element back. The change tweens as the step starts: two moves with the same functions in the same order tween argument by argument, so a needle turns about its pivot; others tween through a slide, a turn and a scale. Wrap a group of shapes in a `<g id>` to move them together.

`trace` lists ids of a `path`, `line`, `polyline`, `polygon`, `rect`, `circle`, `ellipse` or a `<g>` of them, whose lines all draw at once. An entry is an id, or `{ "ref": "route", "when": "around the coast" }` to start on those words of the `say`; without `when` it starts as the step's changes settle. A hidden element it names is shown. A line draws at about 40 px a frame, from 12 frames up to two and a half seconds; its fill fades in with it, and a dashed or flowing line keeps its dashes. `plot` and `map` steps take `trace` too: see [plot](scenes/plot.md) and [map](scenes/map.md), where a route's `when` is the words it arrives on.

`morph` maps a path's id to the id of another `<path>` whose shape it takes from this step on; the other path, usually in `hidden`, lends only its `d`, read in the first path's own coordinates. Name a path after itself to give it its shape back. Both shapes are turned into curves and the one with fewer is split until they pair point for point, so a circle of arcs morphs into a square of lines; a hidden path a morph uses is not reported as never drawn.

`class="flow"` on a line, or on a group of lines, draws a faint copy of it under dashes that march along its direction, as a graph edge's do; wider lines get longer dashes. A step's `focus` defaults to what it moves, traces or morphs.

`{{MR_CAST}}/bin/mr-cast validate` fails on a move of the root `<svg>`, a transform with any other function (`matrix`, `skewX`), an id the drawing lacks, a trace of text or anything with no line, a `when` the step's `say` does not contain, a morph of anything but a path, into anything but a path, or between paths with a different number of outlines (M parts), and trace or morph on any scene but svg.

A whole demo: `{{MR_CAST}}/examples/primitives/motion/storyboard.json` (four triangles slide inside a square to prove a² + b² = c², and the tank above).
