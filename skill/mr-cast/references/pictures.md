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
  "title": "Retries that bring a server down",
  "look": "board",
  "tones": { "good": "first tries", "bad": "retries" },
  "pictures": {
    "queue": "<svg viewBox=\"0 0 1200 340\"><rect id=\"server\" x=\"860\" y=\"90\" width=\"260\" height=\"160\" fill=\"none\" stroke=\"var(--text)\" stroke-width=\"3\"/><text id=\"name\" x=\"990\" y=\"300\" font-size=\"30\" text-anchor=\"middle\" fill=\"var(--muted)\">the server</text><g id=\"calls\"><rect x=\"80\" y=\"130\" width=\"90\" height=\"80\" class=\"tone-good\"/><rect x=\"200\" y=\"130\" width=\"90\" height=\"80\" class=\"tone-good\"/></g><g id=\"retries\"><rect x=\"320\" y=\"130\" width=\"90\" height=\"80\" class=\"tone-bad\"/><rect x=\"440\" y=\"130\" width=\"90\" height=\"80\" class=\"tone-bad\"/><rect x=\"560\" y=\"130\" width=\"90\" height=\"80\" class=\"tone-bad\"/></g><line id=\"path\" x1=\"680\" y1=\"170\" x2=\"850\" y2=\"170\" stroke-width=\"3\"/></svg>"
  },
  "scenes": [
    {
      "type": "svg",
      "title": "Two calls wait for a slow server",
      "picture": "queue",
      "hidden": ["calls", "retries"],
      "narration": "Here is a server that has slowed down.",
      "steps": [{ "show": ["calls"], "say": "Two calls wait in line for it." }]
    },
    {
      "type": "svg",
      "title": "Each timeout adds another call",
      "picture": "queue",
      "illustrative": true,
      "narration": "The callers give up and try again.",
      "steps": [
        {
          "show": ["retries"],
          "say": "Every retry joins the same line.",
          "draw": [{ "brace": "retries", "note": "retries", "when": "retry" }]
        },
        { "focus": ["server"], "say": "So the server falls further behind." }
      ]
    },
    {
      "type": "svg",
      "title": "Backoff keeps the line short",
      "picture": "queue",
      "narration": "With backoff, callers wait before they retry.",
      "steps": [{ "hide": ["retries"], "focus": ["calls"], "say": "Only the first tries are left." }]
    }
  ]
}
```

## Schema and validate notes

`pictures` maps a name to one `<svg viewBox="...">` element, with everything an [svg](scenes/svg.md) scene's `svg` takes. An svg scene draws one with `"picture": "<name>"` in place of its own `svg`, and its steps show, hide, tint, trace and write on it as on any svg.

A scene on the same picture as the scene right before it continues it: the picture neither fades nor slides between them, and it keeps its place, laid out in the box of the tallest header among the scenes in the row. The scene starts with what the scene before it ended on shown and tinted, unless it sets its own `hidden` or `tint`. Moves, morphs and set text start from the drawing as written, and ink fades as its scene ends. A part of a picture may stay hidden through a scene; `validate` does not report it as never drawn.

`tones` says what each colour means, by tone (`accent`, `good`, `bad`, `warn`); with it, `validate` warns about a tint or an svg `tone-`, `fill-` or `stroke-` class in a tone it does not list. `"illustrative": true` on any scene writes a small "illustrative" at the bottom right.

`{{MR_CAST}}/bin/mr-cast validate` fails on a picture that is not an `<svg>` element, a `picture` the storyboard does not have, a `picture` on a scene type other than svg, and a scene with both `svg` and `picture`. It warns when a scene continues a picture that the scene before it moved, morphed or set text on, since those parts jump back.
