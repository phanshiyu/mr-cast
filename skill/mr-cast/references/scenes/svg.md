# svg

A drawing in SVG markup that steps light, colour, show and hide by element id: a map, a tiling, a geometric figure, points on a plane.

## Example

```json
{
  "type": "svg",
  "chapter": "The window",
  "title": "Requests in one minute",
  "narration": "The limiter counts each visitor's requests inside a one minute window.",
  "svg": "<svg viewBox=\"0 0 600 260\"><rect id=\"window\" x=\"40\" y=\"60\" width=\"520\" height=\"120\" rx=\"16\" fill=\"none\" stroke=\"var(--border)\" stroke-width=\"3\"/><text x=\"40\" y=\"40\" font-size=\"24\" fill=\"var(--muted)\">One minute</text><g id=\"allowed\" class=\"tone-good\"><rect x=\"70\" y=\"95\" width=\"50\" height=\"50\" rx=\"8\"/><rect x=\"140\" y=\"95\" width=\"50\" height=\"50\" rx=\"8\"/><rect x=\"210\" y=\"95\" width=\"50\" height=\"50\" rx=\"8\"/></g><rect id=\"blocked\" x=\"480\" y=\"95\" width=\"50\" height=\"50\" rx=\"8\" class=\"tone-bad\"/><text id=\"count\" x=\"300\" y=\"230\" text-anchor=\"middle\" font-size=\"28\">3 of 20 used</text></svg>",
  "labels": {
    "allowed": "requests under the limit",
    "blocked": "twenty first request"
  },
  "hidden": [
    "blocked"
  ],
  "steps": [
    {
      "focus": [
        "allowed",
        "count"
      ],
      "say": "The first requests are under the limit, so they go through."
    },
    {
      "show": [
        "blocked"
      ],
      "set": {
        "count": "20 of 20 used"
      },
      "callout": "`429 Too Many Requests`",
      "say": "The twenty first request in the same minute is blocked."
    }
  ]
}
```

## Schema and validate notes

`svg` is one `<svg>` element with a `viewBox`, which the scene scales to fill the stage and places on it; it is clipped to the stage, with room for a glow at the edge. Elements that steps name carry an `id`; a `focus`, `show`, `hide` and `tint` key is an id, and a lit group lights everything in it. `hidden` lists ids drawn only once a step shows them; `{{MR_CAST}}/bin/mr-cast validate` warns on one no step shows. A step's `set` rewrites a `<text>` element by id. `tint` gives a shape a tone's border and a soft fill of it, and text the tone's colour; `"dim"` fades it and `"clear"` takes it off. `callout` is a boxed line at the right of the header that steps replace. The callout box is as wide as its longest text; beside it, a title too long for one line wraps onto a second. `labels` gives the words a step's `say` may name an element by, for the highlight check; an element's id and its text name it too.

Colours: a `fill`, `stroke` or `stop-color` is a colour (`#7c8cff`, a name such as `white`, `none`, `currentColor`, `rgb()` or `hsl()`), and a fill or stroke may be `url(#id)` for a gradient in the drawing. `clip-path` and the markers are `url(#id)` or `none`. `var(--name)` is a palette colour (`--text`, `--muted`, `--faint`, `--bg`, `--surface`, `--border`, `--accent`, `--good`, `--bad`, `--warn`, `--neutral`). `class="tone-good"` (or `accent`, `bad`, `warn`, `neutral`) colours a shape as a tint does, and `fill-good` and `stroke-good` set one colour solid. With no fill or stroke of its own or from a group, a rect, circle, ellipse or polygon draws as a card, a line, polyline or path as a `--muted` line, and text in `--text` in the player's sans font, or its mono with `font-family="mono"`.

`{{MR_CAST}}/bin/mr-cast validate` fails on markup that does not parse, a missing viewBox, anything it cuts (any element but `g`, `defs`, `title`, `desc`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `path`, `text`, `tspan`, `marker`, `linearGradient`, `radialGradient`, `stop`, `clipPath` and `use`; a `style` attribute; an event handler; a `url()` or `href` that points outside the drawing; a paint that is no colour; a backslash in any attribute; a class other than the tone classes; a `transform`, `x` or `y` on the root `<svg>`, since the scene places it), an unknown palette colour, and an id a field names that the drawing lacks. It warns on text smaller than 15 px once scaled to the stage, and on text that runs past the viewBox. `{{MR_CAST}}/bin/mr-cast still` shows the drawing as the viewer sees it.

`{{MR_CAST}}/bin/mr-cast schema svg` prints its fields. A whole demo: `{{MR_CAST}}/examples/primitives/svg/storyboard.json`. In the worked examples: `{{MR_CAST}}/examples/architecture/h3/storyboard.json` (scenes 0 to 3, maps and tilings); `{{MR_CAST}}/examples/architecture/oauth/storyboard.json` (scene 3, a secret and its hash); `{{MR_CAST}}/examples/algorithms/quicksort/storyboard.json` (scene 4, how deep the splits go).
