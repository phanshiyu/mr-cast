# flow

A row of stages, each an actor and what it does, with the data as it looks after that stage.

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

A flow takes no `focus`. Each stage is `{ actor, action, payload?, icon?, say? }`, and either every stage has a `say` or none does. `payload` is a string, so stringify JSON yourself. `{{MR_CAST}}/bin/mr-cast validate` fails on a `say` on only some stages, a payload that is not a string, and stages too many for their rows to hold each actor and action without overlapping.

`{{MR_CAST}}/bin/mr-cast schema flow` prints its fields.

A whole demo: `{{MR_CAST}}/examples/primitives/flow/storyboard.json`.
