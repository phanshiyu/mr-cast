# graph

Cards and the lines between them, laid out automatically. With `decision`, `terminal` and `step` shapes it is a flowchart.

## Lowers load when

- The idea is a structure: "the service talks to a queue and two databases". Position and lines show what connects to what, so no sentence per link is needed.
- The idea is a decision: "if the cache has it, return it, otherwise ask the database". The question and both branches are drawn, so the viewer sees the path not taken while following the one taken.
- Groups of nodes belong together, such as a team or a service boundary. A `group` box says so without words.

## Adds load when

- The parts form a stack with an order. Use [layers](layers.md).
- The story is a thing's status. Use [state](state.md).
- The order of calls matters. Use [sequence](sequence.md).
- There are more than about 12 nodes. Split it, or move detail into a second scene.

## Load mistakes

- **Everything at once.** The narration tells the whole path while every node is lit. Walk it: the node, the edge leaving it, the next node.
- **Words name nodes that are not lit.** "The limiter asks Redis" lights the limiter, the edge and Redis, not only the limiter.
- **A decision drawn as a plain card.** The viewer must read the branch out of the words. Give it `"shape": "decision"` and label each edge leaving it with its answer.
- **Marks on most nodes.** When everything glows or is marked changed, nothing stands out. Mark one or two.

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

A `focus` is a node id, an edge `"a->b"` (`"a-b"` either way), `"group:Name"` or an edge index. Cards take a Lucide `icon` and a `caption`. Decision, terminal and step shapes take no icon. `layout` is `LR` or `TB` (top to bottom, for a hierarchy or a hand-off). An edge's `direction` is `both` for a two-way link or `none` for a plain one, and its `style` is `solid` when nothing moves or `dashed` for a weak or indirect link. A graph with a decision lays out top to bottom by itself. `{{MR_CAST}}/bin/mr-cast validate` fails on an unknown node in an edge or an unknown icon, and warns past 12 nodes, on an unlabelled decision edge, and on narration over 35 words.

`{{MR_CAST}}/bin/mr-cast schema graph` prints its fields.
