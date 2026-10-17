# layers

Bands stacked top to bottom in their real order, each holding a few cards, with a token that carries a request down and its reply back up.

## Example

```json
{
  "type": "layers",
  "chapter": "The request stack",
  "narration": "Each request passes these layers from top to bottom.",
  "layers": [
    { "id": "server", "label": "HTTP server", "caption": "shared middleware", "items": [
      { "id": "json", "label": "express.json", "icon": "braces", "caption": "parses the body" }
    ] },
    { "id": "limits", "label": "Rate limiting", "caption": "**20** a minute per visitor", "items": [
      { "id": "limiter", "label": "rateLimit", "icon": "gauge", "caption": "counts in Redis", "change": "added" }
    ] },
    { "id": "routes", "label": "Routes", "items": [
      { "id": "orders", "label": "POST /orders", "icon": "route" }
    ] }
  ],
  "path": { "label": "POST /orders", "stops": ["json", "limiter", "orders"], "skip": { "at": "limiter", "reply": "429 Too Many Requests" } },
  "steps": [
    { "focus": "json", "say": "A new order request first has its body read by the server." },
    { "focus": "limiter", "say": "Next the new rate limiter counts the visitor's requests in the last minute." },
    { "focus": 0, "say": "Past twenty requests, the limiter answers too many requests and sends the request straight back." },
    { "focus": "routes", "say": "So the order route never sees the extra requests." }
  ]
}
```

## Schema and validate notes

A `focus` is a layer id, an item id or `"layer.item"`, or a path stop index, which moves the token. `path.stops` go down the stack in order. `skip` turns the token back early at a stop with a `reply`. With `return` or `skip`, focus a stop again to bring the token back up. `{{MR_CAST}}/bin/mr-cast validate` fails on stops that go back up and a duplicate id, and warns past 7 layers or 5 items in a band, on a step at a stop the token has passed, and on a reply that never shows.

`{{MR_CAST}}/bin/mr-cast schema layers` prints its fields.
