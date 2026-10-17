# sequence

Participants across the top and messages down the page in time order: calls, replies and fire-and-forget messages.

## Example

```json
{
  "type": "sequence",
  "chapter": "One request, counted",
  "narration": "Here is one request on its way to the order handler.",
  "participants": [
    { "id": "client", "label": "Client", "icon": "user", "caption": "visitor" },
    { "id": "limiter", "label": "rateLimit", "icon": "gauge", "caption": "middleware", "change": "added" },
    { "id": "redis", "label": "Redis", "icon": "database", "caption": "counts" },
    { "id": "orders", "label": "Order handler", "icon": "shopping-cart" }
  ],
  "messages": [
    { "from": "client", "to": "limiter", "label": "POST /orders" },
    { "from": "limiter", "to": "redis", "label": "add one to this minute's count" },
    { "from": "redis", "to": "limiter", "label": "count: 21", "kind": "return" },
    { "from": "limiter", "to": "client", "label": "429 Too Many Requests", "kind": "return" }
  ],
  "steps": [
    { "focus": 0, "say": "A visitor sends a twenty first order inside one minute." },
    { "focus": "1-2", "say": "The limiter adds one to the visitor's count for this minute, and Redis answers twenty one." },
    { "focus": 3, "say": "Twenty one is past the limit, so the limiter answers too many requests." }
  ]
}
```

## Schema and validate notes

A `focus` is a message index, an `"a-b"` range of messages, or a participant id; a step draws every message up to the last one it focuses. Messages take `kind` `call`, `return` or `async`, and `from` equal to `to` for a self-call. `{{MR_CAST}}/bin/mr-cast validate` fails on an unknown participant and a label that does not fit, and warns past 6 participants and on a message no step names, which then appears unnamed with a neighbouring step.

`{{MR_CAST}}/bin/mr-cast schema sequence` prints its fields.

A whole demo: `{{MR_CAST}}/examples/primitives/sequence/storyboard.json`.
