# sequence

Participants across the top and messages down the page in time order: calls, replies and fire-and-forget messages.

## Lowers load when

- The idea is an order of calls: "the client calls the API, which asks the cache, then the database".
- Replies and async work matter, because the drawing tells a reply (dashed) from a call (solid) without words.
- The time order is the point. Down the page is later, so the viewer never asks "and then?".

## Adds load when

- The payload's shape at each stage is the point. Use [flow](flow.md).
- The calls go straight down a stack and back up. Use [layers](layers.md), whose screen order is the stack's order.
- The exact times matter, such as backoff waits. Use [timeline](timeline.md).
- There are more than 6 participants. Fold minor ones into the participant that calls them.

## Load mistakes

- **Words name messages that are not lit.** A step that lights only the call while the words also tell the reply. Light the call and its reply together, as `"1-2"`.
- **Messages pop in unnamed.** A step draws every message up to the last one it names, so a skipped message appears beside the next step with no words. Give every message a step, in order.
- **A long sequence shown at once.** Past about 12 messages the scene scrolls. Walk it a few messages a step, and split it past 24.
- **Labels that are code,** such as `incr(key)`. The viewer must decode them. Say what the message does: "add one to this minute's count".

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

A `focus` is a message index, an `"a-b"` range of messages, or a participant id. Messages take `kind` `call`, `return` or `async`, and `from` equal to `to` for a self-call. `{{MR_CAST}}/bin/mr-cast validate` fails on an unknown participant and a label that does not fit, and warns past 6 participants or 24 messages, on a message no step names, and on narration over 35 words.
