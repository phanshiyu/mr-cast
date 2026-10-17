# graph

Cards and the lines between them, laid out automatically. With `decision`, `terminal` and `step` shapes it is a flowchart. Steps can grow it, tint it, set badges, and change a table beside it.

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

A `focus` is a node id, an edge `"a->b"` (`"a-b"` either way), `"group:Name"` or an edge index. Cards take a Lucide `icon` and a `caption`; decision, terminal and step shapes draw no icon, and only a step draws a caption. `layout` is `LR` or `TB`, and a graph with a decision lays out top to bottom by itself. An edge's `direction` is `forward`, `both` or `none`, and its `style` is `flow`, `solid` or `dashed`. `{{MR_CAST}}/bin/mr-cast validate` fails on an unknown node in an edge or an unknown icon, and warns past 12 nodes, on an edge from a node to itself, which is not drawn, on an icon or caption a shape does not draw, and on a graph scaled down to fit the frame so far that its text draws under 15 px.

**Steps that change the graph.** A node or edge with `"hidden": true` is laid out from the start and drawn when a step's `show` names it (`["B", "A->B"]`); an edge draws only while both its nodes do. `{{MR_CAST}}/bin/mr-cast validate` warns on a node, edge or row that starts hidden and no step shows. A step's `set` gives a node a new badge, `{ "A": "3" }` (`""` takes it off). `tint` colours nodes, edges and groups from that step on, by ref, with a tone, `"dim"` or `"clear"`. `callout` is a boxed line at the right of the header that steps replace. The callout box is as wide as its longest text; beside it, a title too long for one line wraps onto a second.

**A table beside the graph.** `table: { columns, rows }` draws a table in the right 40% of the frame. Its rows are named `"row:A"` (by index or first cell) and its cells `"Header@A"`; steps `set` cells (`{ "before": "4", "after": "3" }` strikes the old value), `show` rows that start `hidden`, `tint` rows and cells, and light them and columns `"col:Header"` with `focus`, in the same step as the graph. A bare number is an edge index, so `{{MR_CAST}}/bin/mr-cast validate` fails on one that is also a row index of the table; write the edge `"a->b"` or the row `"row:2"`. It warns past 4 columns or 8 rows beside a graph.

`{{MR_CAST}}/bin/mr-cast schema graph` prints its fields. A whole demo: `{{MR_CAST}}/examples/primitives/graph/storyboard.json`.
