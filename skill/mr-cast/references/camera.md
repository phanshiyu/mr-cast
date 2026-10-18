# camera

A camera on any stepped scene: a step's `camera` zooms and pans to what it names, and stays there until a later step's camera, or `"all"` pulls back to the whole scene.

## Example

```json
{
  "type": "svg",
  "chapter": "Zoom into a detail",
  "title": "Where a protein is made",
  "narration": "This is one cell. The big circle is its nucleus.",
  "svg": "<svg viewBox=\"0 0 1600 800\">...<g id=\"ribosome\">...</g><g id=\"detail\" font-size=\"8\">...</g></svg>",
  "hidden": ["detail"],
  "steps": [
    { "focus": "nucleus", "say": "The nucleus keeps the DNA." },
    { "camera": "ribosome", "show": ["detail"], "focus": "ribosome", "say": "Zoom in on one ribosome.", "draw": [{ "circle": "ribosome" }] },
    { "camera": ["nucleus", "ribosome"], "hide": ["detail"], "say": "The nucleus sits far from where the work happens." },
    { "camera": "all", "say": "And this happens all over the cell." }
  ]
}
```

## Schema and validate notes

`camera` is `"all"`, a ref, a list of refs, or `{ "on": refs, "zoom": 3 }`. A ref is what the step's `focus` takes; on a code step it is a line number, an `"a-b"` range, or text on the step's lines. Without `zoom` the camera fits the refs with a margin, enlarged at most 6 times; `zoom` (1 to 40) is how many times the whole scene's scale to show them at. The view never shows past the scene's edges and never shrinks it below its own size. The narration shows the whole scene; the view eases to each step's shot as the step starts, over the half second before its words, and follows the refs when a later step moves them, such as a pointer that slides. Ink and pen marks move with the content. A step on an `array`, `memory`, `graph`, `table`, `svg` or `text` scene that only moves the camera needs no `focus`.

`{{MR_CAST}}/bin/mr-cast validate` fails on a ref that names nothing, a `zoom` outside 1 to 40, an empty list, `"all"` inside a list, an unknown field, and a camera on a `flow` scene. It warns when the shot leaves a lit ref out of view, on a graph, table, array, memory, svg, state, tests, er, files, layers or timeline scene. On an svg scene, a text too small to read at the whole scene's scale passes when it is shown only while a camera has zoomed in on it; the warning names the step where it is smallest. `{{MR_CAST}}/bin/mr-cast still <scene> --step <k>` shows the shot as step k ends.

A whole demo: `{{MR_CAST}}/examples/primitives/camera/storyboard.json` (an svg zoomed into a detail and back, and an array whose camera follows a moving pointer).
