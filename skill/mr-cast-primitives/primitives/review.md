# review

A recap of what looks wrong, grouped by severity, each with its file and line.

## Lowers load when

- Each finding was already said where its code was shown. The recap gathers them, so the viewer leaves with a short list instead of remembering them.
- Not picked per idea. The mr-cast skill says when there is one.

## Adds load when

- It introduces a finding for the first time. Say each finding on the code step that shows its line, with `flag`.

## Load mistakes

- **A finding said as fact.** It is an opinion. Say "I think this looks off".
- **A long list.** Keep the few findings that clearly look wrong.

## Example

```json
{
  "title": "Rate limiting",
  "findings": [
    { "id": "proxy-ip", "severity": "risk", "file": "src/api/rate-limit.ts", "line": 11, "claim": "`req.ip` is the proxy's address", "evidence": "behind a load balancer every visitor shares one count, so twenty requests in total lock everyone out" }
  ],
  "scenes": [
    { "type": "intent", "narration": "Each visitor now gets twenty requests a minute.", "summary": "Limit each visitor to 20 requests a minute", "risk": "medium", "bullets": ["Who counts as one visitor"] },
    { "type": "code", "hunkId": "h2", "narration": "So how does the limiter tell visitors apart?", "steps": [
      { "lines": 11, "flag": "proxy-ip", "note": "proxy address?", "say": "I think this looks off. The key uses the address the server sees, which behind a load balancer is the balancer's own." },
      { "lines": "12-17", "say": "The count then decides whether the request goes through." }
    ] },
    { "type": "review", "narration": "One thing looked off. The limiter may count every visitor behind a load balancer as one." }
  ]
}
```

## Schema and validate notes

The scene takes no `steps`. The storyboard's `findings` hold each finding's `id`, `severity`, `file`, `line`, `claim` and `evidence`, and a code step's `flag` names one. `{{MR_CAST}}/bin/mr-cast validate` fails on a finding with no evidence, a flag on a step that does not show its line, and findings with no review scene.
