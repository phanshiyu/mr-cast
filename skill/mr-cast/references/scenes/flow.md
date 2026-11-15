# flow

A row of stages, each an actor and what it does, with the data as it looks after that stage, or the real lines of code that do it.

## Example

```json
{
  "type": "flow",
  "chapter": "What the limiter keeps",
  "title": "One request, step by step",
  "narration": "Here is what the limiter makes of one request.",
  "steps": [
    { "actor": "rateLimit", "action": "builds the key", "payload": "rl:203.0.113.7:29126401", "icon": "key-round", "say": "The limiter builds a key from the visitor's address and the current minute." },
    { "actor": "Redis", "action": "adds one", "payload": "21", "icon": "database", "say": "Redis adds one to the count under that key and returns twenty one." },
    { "actor": "rateLimit", "action": "refuses", "payload": "429 Retry-After: 60", "icon": "gauge", "tone": "bad", "say": "Twenty one is past the limit, so the limiter refuses and asks the visitor to wait a minute." }
  ]
}
```

## Schema and validate notes

A flow takes no `focus`. Each stage is `{ actor, action, payload?, code?, icon?, say? }`, and either every stage has a `say` or none does. `payload` is a string, so stringify JSON yourself. It is drawn as monospace code in large type, meant for a short value such as `status pending, attempts 1` or `429 Retry-After: 60`; say sentences in `action` or `say`, not there.

A stage may carry `code` instead of `payload`: `{ "hunk": "h56", "lines": "47-60", "light": "52-54" }` for a diff hunk, or `{ "snippet": "s2", "lines": "127-135" }` for a snippet. The panel then draws those real lines at normal code size, with the file name, line numbers, syntax colour and the diff's change marks, and the step list shows the `path:line` itself, so do not type it. `light` marks the lines the stage is about and dims the rest. `lines` are numbered as in the file, inside the hunk. About 14 lines stay readable; `validate` reports a stage whose lines do not fit. A pre-read puts no code on screen, so its stages keep a `payload`. It is the way to show one request's path through several files: one stage per file, each with its own lines. `{{MR_CAST}}/bin/mr-cast validate` fails on a `say` on only some stages, a payload that is not a string, a `code` with both or neither of `hunk` and `snippet`, with a hunk, snippet or lines that do not exist, or beside a `payload`, and stages too many for their rows to hold each actor and action without overlapping.

`{{MR_CAST}}/bin/mr-cast schema flow` prints its fields.

A whole demo: `{{MR_CAST}}/examples/primitives/flow/storyboard.json`. In the worked examples: `{{MR_CAST}}/examples/explain/bitcoin/storyboard.json` (scene 1, a signature checked); `{{MR_CAST}}/examples/architecture/react/storyboard.json` (scene 10, the whole update path); `{{MR_CAST}}/examples/science/mrna-vaccine/storyboard.json` (scene 5, the immune response).
