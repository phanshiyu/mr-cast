# image

A picture, such as a photo, a screenshot or a figure from a paper, with a caption and credit, a slow pan and zoom, and regions that steps light and ink draws on.

## Example

```json
{
  "type": "image",
  "chapter": "The home lab",
  "title": "Where the side project runs",
  "src": "shots/desk.png",
  "caption": "One laptop, one router and one small server",
  "credit": "Photo: the author",
  "kenBurns": true,
  "narration": "This is the whole setup.",
  "regions": [
    { "id": "laptop", "box": [0.33, 0.37, 0.36, 0.37], "label": "the laptop" },
    { "id": "server", "box": [0.79, 0.11, 0.135, 0.45], "label": "the server" }
  ],
  "steps": [
    { "focus": "laptop", "say": "You write the code on the laptop." },
    { "focus": "server", "say": "The server runs it all night.", "draw": [{ "circle": "server", "note": "one disk is failing" }] }
  ]
}
```

## Schema and validate notes

mr-cast does not make, find or change pictures. It shows the file given, and whoever makes the video owns the right to use it.

`src` is a path relative to the run directory or the repository, or an http(s) URL. A PNG, JPEG, WebP or GIF file of up to 10 MB; an SVG file is refused, since it can carry scripts, so draw it in an svg scene instead. `{{MR_CAST}}/bin/mr-cast validate` copies a local file into the run's `images/` folder, or downloads a URL there once (later runs reuse the copy), and records each in `images.json`. The player and renders read only those copies, so nothing loads from the network once validate has run. Validate fails on a file that is missing or outside the run directory and the repository, a file that is no such image (it reads the first bytes, not the name), one over 10 MB, and a URL it cannot download, with the reason, such as "HTTP 404" or "ECONNREFUSED". The validate hook downloads nothing and says a URL is not downloaded yet.

`fit` is `contain` (default), which shows all of the picture, or `cover`, which fills the frame and crops the edges. `kenBurns: true` moves in a little toward the centre over the scene; `{ "from": "laptop", "to": [0, 0, 1, 1] }` pans from a region or a box to another. A region's `box` is `[x, y, width, height]` as fractions of the picture from its top left. A step's `focus` names region ids; the rest of the picture darkens and the lit region gets an outline and its `label`. Ink refs are region ids too. Validate warns when the picture is drawn more than twice its own size, which looks soft.

A compare cell can be a picture too: `{ "image": "before.png", "fit": "cover" }`, drawn in a 16:9 box the cell's width, with the same sources and checks.

`{{MR_CAST}}/bin/mr-cast schema image` prints its fields.

A whole demo, with pictures its own script draws: `{{MR_CAST}}/examples/primitives/image/storyboard.json`.
