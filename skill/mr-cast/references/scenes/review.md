# review

A recap of what looks wrong, grouped by severity, each with its file and line.

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

The scene takes no `steps`. The storyboard's `findings` hold each finding's `id`, `severity` (`bug`, `risk` or `nit`), `file`, `line`, `claim` and `evidence`; `evidence` goes into `review.md`, not on screen. A code step's `flag` names a finding and draws a pen circle in its severity's colour around the step's lines, with the claim (or the step's `note`) as the handwritten note. `{{MR_CAST}}/bin/mr-cast validate` fails on a finding whose line the diff does not show, a flag on a step that does not show its line, and a review scene with no findings, and warns on a finding no step flags.

`{{MR_CAST}}/bin/mr-cast schema review` prints its fields.

A whole demo: `{{MR_CAST}}/examples/primitives/review/storyboard.json`.
