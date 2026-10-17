# mermaid

A static Mermaid diagram, for a shape no other primitive draws.

## Lowers load when

- The idea has a shape the viewer already knows how to read and no other primitive draws: a class hierarchy, a gantt plan, a git history, the proportions of a whole as a pie.

## Adds load when

- Any other primitive fits. Mermaid has no steps, so it cannot build up or light parts as the words name them.
- More than about 12 nodes. A static picture of that size is read all at once.

## Load mistakes

- **A flowchart or sequence in Mermaid.** It cannot walk, so the viewer reads it all at once. Use [graph](graph.md) or [sequence](sequence.md).
- **Words that walk a static picture part by part.** Nothing lights, so the eye searches. Keep the narration to what the whole picture shows.

## Example

```json
{
  "type": "mermaid",
  "chapter": "Two limiters",
  "title": "One shape, two stores",
  "narration": "Both limiters follow one interface, so the server can use either.",
  "code": "classDiagram\n  class Limiter {\n    <<interface>>\n    +hit(key) number\n  }\n  class RedisLimiter {\n    +hit(key) number\n  }\n  class MemoryLimiter {\n    +hit(key) number\n  }\n  Limiter <|.. RedisLimiter\n  Limiter <|.. MemoryLimiter"
}
```

## Schema and validate notes

`code` holds the Mermaid source. `{{MR_CAST}}/bin/mr-cast validate` parses it and fails on invalid Mermaid. Run `{{MR_CAST}}/bin/mr-cast still <sceneIndex>` to see that it fits.
