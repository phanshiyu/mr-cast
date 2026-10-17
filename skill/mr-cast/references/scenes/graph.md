# graph

Cards and the lines between them, laid out automatically. With `decision`, `terminal` and `step` shapes it is a flowchart.

## Example

```json
{
  "type": "graph",
  "chapter": "Where the limiter sits",
  "narration": "Every request now passes the rate limiter before it reaches the order handler.",
  "nodes": [
    { "id": "client", "label": "Client", "icon": "user", "caption": "visitor", "tone": "good" },
    { "id": "limiter", "label": "rateLimit", "icon": "gauge", "caption": "middleware", "change": "added" },
    { "id": "redis", "label": "Redis", "icon": "database", "caption": "shared counts" },
    { "id": "orders", "label": "Order handler", "icon": "shopping-cart", "caption": "route" }
  ],
  "edges": [
    { "from": "client", "to": "limiter", "label": "request" },
    { "from": "limiter", "to": "redis", "label": "count" },
    { "from": "limiter", "to": "orders", "label": "allowed" }
  ],
  "steps": [
    { "focus": ["client", "client->limiter", "limiter"], "say": "A visitor's request reaches the new rate limiter first." },
    { "focus": ["limiter->redis", "redis"], "say": "The limiter counts the request in Redis, a shared in-memory store." },
    { "focus": ["limiter->orders", "orders"], "say": "Only a request under the limit goes on to the order handler." }
  ]
}
```

## Schema and validate notes

A `focus` is a node id, an edge `"a->b"` (`"a-b"` either way), `"group:Name"` or an edge index. Cards take a Lucide `icon` and a `caption`; decision, terminal and step shapes draw no icon, and only a step draws a caption. `layout` is `LR` or `TB`, and a graph with a decision lays out top to bottom by itself. An edge's `direction` is `forward`, `both` or `none`, and its `style` is `flow`, `solid` or `dashed`. `{{MR_CAST}}/bin/mr-cast validate` fails on an unknown node in an edge or an unknown icon, and warns past 12 nodes, on an edge from a node to itself, which is not drawn, and on an icon or caption a shape does not draw.

`{{MR_CAST}}/bin/mr-cast schema graph` prints its fields.
