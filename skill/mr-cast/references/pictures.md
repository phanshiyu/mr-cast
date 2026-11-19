# pictures, and making a video easy to follow

A viewer follows a video that keeps one picture in front of them and changes it a little at a time, as someone explaining at a whiteboard would:

- **One picture that comes back.** Find the one drawing the explanation hangs on, such as a row of byte cells, a request's path or a queue. Name it in the storyboard's `pictures` and draw it with svg scenes' `"picture"`. Scenes in a row on the same picture do not cut: the picture stays still while the title changes, and each scene starts as the one before ended. Use other scene types for what the picture cannot show, then come back to it.
- **A title that makes the scene's point.** "Rejected, but already written", not "Validation". A viewer who drifts off catches up from the title alone. `validate` warns about a title under three words.
- **Something changes with every sentence.** Each step's `say` is one or two short sentences, and the step shows, tints, traces or writes one thing as it is said: a label written with ink on its words (`"when"`), a line traced on, a part tinted. A step that changes nothing on screen is a slide with a voice over it.
- **Two colours, each with one meaning.** Say what they mean in the storyboard's `tones`, such as `{ "good": "bytes that fit", "bad": "bytes past the end" }`, and use them only for that.
- **Real things, briefly.** The actual command, error or output, a few lines at a time, where it comes up.
- **Honest sketches.** A diagram that is not real data gets `"illustrative": true`.
- **End on the opening picture, fixed.** Draw the picture you started with once more, now showing what the fix changes.
- **Drawn by hand.** `"look": "board"` on the storyboard draws an explanation by hand on a dark board: titles lettered on in orange, green for what is normal and orange for the problem, svg pictures drawn on line by line, and a pencil drawing whatever appears. On the board every scene is an svg on the picture: a point is a label written on with ink as it is said, a command or an error a short handwritten note, a number a bar drawn on. A chart, table, terminal or list scene there is a slide in the middle of a drawing; `validate` warns about one.
- **A beat after each reveal.** One or two short sentences per step, then let the drawing land before the next.

## Example

```json
{
  "title": "Bytes past the end",
  "tones": { "good": "bytes that fit", "bad": "bytes past the end" },
  "pictures": {
    "bar": "<svg viewBox=\"0 0 1200 300\"><g id=\"fit\"><rect x=\"40\" y=\"120\" width=\"700\" height=\"80\" class=\"tone-good\"/></g><g id=\"spill\"><rect x=\"740\" y=\"120\" width=\"170\" height=\"80\" class=\"tone-bad\"/></g><rect id=\"array\" x=\"40\" y=\"120\" width=\"700\" height=\"80\" fill=\"none\" stroke=\"var(--text)\" stroke-width=\"3\"/><text id=\"label\" x=\"40\" y=\"250\" font-size=\"28\" fill=\"var(--muted)\">a 50-byte array</text></svg>"
  },
  "scenes": [
    {
      "type": "svg",
      "title": "The decoder fills the array",
      "picture": "bar",
      "hidden": ["fit", "spill"],
      "narration": "Here is a fifty byte array.",
      "steps": [{ "show": ["fit"], "say": "The decoder fills it with fifty bytes." }]
    },
    {
      "type": "svg",
      "title": "Twelve bytes land past the end",
      "picture": "bar",
      "illustrative": true,
      "narration": "But it writes sixty two.",
      "steps": [
        {
          "show": ["spill"],
          "say": "Twelve bytes land past the end.",
          "draw": [{ "brace": "spill", "note": "12 past the end", "when": "past the end" }]
        }
      ]
    },
    {
      "type": "svg",
      "title": "The patch stops at fifty",
      "picture": "bar",
      "narration": "With the fix, nothing spills.",
      "steps": [{ "hide": ["spill"], "focus": ["array"], "say": "Zero bytes past the end." }]
    }
  ]
}
```

## Schema and validate notes

`pictures` maps a name to one `<svg viewBox="...">` element, with everything an [svg](scenes/svg.md) scene's `svg` takes. An svg scene draws one with `"picture": "<name>"` in place of its own `svg`, and its steps show, hide, tint, trace and write on it as on any svg.

A scene on the same picture as the scene right before it continues it: the picture neither fades nor slides between them, and it keeps its place, laid out in the box of the tallest header among the scenes in the row. The scene starts with what the scene before it ended on shown and tinted, unless it sets its own `hidden` or `tint`. Moves, morphs and set text start from the drawing as written, and ink fades as its scene ends. A part of a picture may stay hidden through a scene; `validate` does not report it as never drawn.

`tones` says what each colour means, by tone (`accent`, `good`, `bad`, `warn`); with it, `validate` warns about a tint or an svg `tone-`, `fill-` or `stroke-` class in a tone it does not list. `"illustrative": true` on any scene writes a small "illustrative" at the bottom right.

`{{MR_CAST}}/bin/mr-cast validate` fails on a picture that is not an `<svg>` element, a `picture` the storyboard does not have, a `picture` on a scene type other than svg, and a scene with both `svg` and `picture`. It warns when a scene continues a picture that the scene before it moved, morphed or set text on, since those parts jump back.
