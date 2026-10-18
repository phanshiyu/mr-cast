# plot

Numeric axes with lines of x, curves of t, data series, points, arrows and shaded areas. Numbers can be expressions in named parameters that steps set, so a curve reshapes and a point moves; a step can trace a line on.

## Example

```json
{
  "type": "plot",
  "chapter": "Compound interest",
  "title": "$10,000 at 7% a year",
  "narration": "Put ten thousand dollars somewhere that grows seven percent a year.",
  "x": { "from": 0, "to": 30, "ticks": 5, "label": "years" },
  "y": { "from": 0, "to": 80000, "ticks": 20000, "prefix": "$", "grid": true },
  "params": { "year": 0 },
  "functions": [
    { "id": "growth", "y": "10000 * 1.07^x", "label": "at 7%" },
    { "id": "today", "y": "10000 * (1.07 / 1.03)^x", "label": "in today's dollars", "tone": "good" }
  ],
  "areas": [{ "id": "gap", "between": ["growth", "today"], "tone": "warn", "hidden": true }],
  "points": [{ "id": "marker", "at": ["year", "10000 * 1.07^year"], "label": "${10000 * 1.07^year:0}", "side": "left", "guides": true, "hidden": true }],
  "steps": [
    { "trace": ["growth"], "set": { "year": 30 }, "show": ["marker"], "say": "Year by year it bends upward, to $76,123 after thirty years." },
    { "set": { "year": 10 }, "focus": "marker", "callout": "72 ÷ 7 = 10.3 years", "say": "It doubles in about ten years." },
    { "trace": ["today"], "focus": "today", "say": "In today's money, after three percent inflation, it is worth $31,361." },
    { "show": ["gap"], "focus": ["gap", "growth", "today"], "say": "The shaded gap is what inflation takes." }
  ]
}
```

## Schema and validate notes

`x` and `y` are axes with `from` and `to`, an optional `label`, `ticks` (a step, a list of values, or `"pi"` for multiples of π/2), `log` for powers of ten, `grid`, and a `prefix` or `suffix` for each tick's number. `equal: true` makes one unit as long on y as on x, so a circle is round. Without `y` the scene is a number line that draws points and vectors only. The x axis crosses at y = 0 and the y axis at x = 0 when 0 is in range, else they run along the bottom and left edges.

Every part has an `id`, and may have a `label`, a `tone` and `hidden`. `functions` hold `y` in x, between `from` and `to`, or a curve: `x` and `y` in t over `t`. `series` hold `[x, y]` `points` drawn as a `"line"`, `"points"` or `"both"`. `points` sit `at` `[x, y]`, with a `side` for the label and `guides` to the axes. `vectors` run `from` (default the origin) `to`. `areas` fill `under` a line down to y = 0, or `between` two lines, over `from` to `to`.

Any number a part is placed by can be an expression in the scene's `params`: numbers, names, `+ - * / ^`, unary minus, parentheses, `pi`, `e`, `sin cos tan asin acos atan exp log ln log10 sqrt abs sign floor ceil round mod min max`, and `sum(k, from, to, term)`. `log` is the natural log. A sum's `to` that is not whole adds its last term in part. A label shows a value with `{expr}`, or `{expr:0}` for the decimals.

A step's `set` changes parameters by name, and every part that reads one reshapes or moves to it over the half second the step settles in. `trace` draws lines, series, vectors or areas on from left to right across the step's words, and moves the step's `set` parameters over the same time, so a point placed by one rides along the line. A part some step traces is undrawn until its first trace, as though `hidden`, so it never shows during the narration and then draws again; to show it earlier, `show` it in an earlier step. `when` starts the step's changes at those words of its `say`. `focus`, `show`, `hide` and `tint` take part ids; a parameter's name lights the parts that read it. `callout` is a boxed line at the right of the header that steps replace. Ink draws on parts by id. A step's `camera` zooms the plot like any stepped scene, and lines are drawn through points about two screen pixels apart wherever it looks, so a fast-wiggling line stays smooth at any zoom without narrowing the axes.

`{{MR_CAST}}/bin/mr-cast validate` fails on an expression that does not parse, with its column, a name that is no parameter, a parameter named like a function or a constant, a step that sets no parameter, a trace on a point, an area between a curve or a missing line, and a `when` the step never says. It draws every step's state and warns on a line with no value inside its range, a line that draws nowhere on the plot, a point off the plot, labels that overlap each other or the axis text, a label that runs off the stage, and tick labels that overlap. `{{MR_CAST}}/bin/mr-cast still` shows the plot as the viewer sees it.

`{{MR_CAST}}/bin/mr-cast schema plot` prints its fields. A whole demo, a square wave built from sine waves and then this example: `{{MR_CAST}}/examples/primitives/plot/storyboard.json`. In the worked examples: `{{MR_CAST}}/examples/math/fourier/storyboard.json` (scenes 1, 2 and 4, waves traced and summed, the camera on the jump); `{{MR_CAST}}/examples/money/compound-interest/storyboard.json` (scenes 2 and 4, growth against inflation); `{{MR_CAST}}/examples/science/gps-relativity/storyboard.json` (scene 4, clock drift by height).
