# mermaid

A static Mermaid diagram, for a shape no other primitive draws.

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

`{{MR_CAST}}/bin/mr-cast schema mermaid` prints its fields.

A whole demo: `{{MR_CAST}}/examples/primitives/mermaid/storyboard.json`.
