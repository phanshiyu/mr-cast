# 35. Bounds from the 0.28 review: public picture downloads, finite expressions, and a world outline loaded on demand

- Status: Accepted
- Date: 2026-10-18
- Amends: 0029 (expression limits), 0030 (how the player loads the outline), 0032 (which URLs validate downloads)

## Context

An independent review of the 0.28 candidate found three places where the new scenes trusted their input more than a
storyboard written by an agent, or copied from elsewhere, deserves:

- **Picture URLs reached any host.** `validate` fetched an image scene's URL with `fetch` and followed redirects, so a
  storyboard could make it request `http://169.254.169.254/` (a cloud metadata address), `localhost` or a private
  network, and a public URL could redirect there. DNS could also answer differently between a check and the connect.
- **Expressions had no bound on work.** One `sum` was capped at 10,000 terms, but nested sums multiplied:
  `sum(k, 1, 10000, sum(j, 1, 10000, …))` ran 10^8 terms per value, and a plot evaluates hundreds of values per step.
  Deep nesting (20,000 parentheses, a long `^` chain) or a 200,000-term `+` chain overflowed the stack, so `validate`
  threw instead of reporting.
- **Every player paid for the map.** `shared/map.mjs` imported both outlines, and `shared/targets.mjs` and
  `shared/state-steps.mjs` import `shared/map.mjs`, so the 420 KB outline sat in the player's main chunk and every
  video parsed it, map or not.

## Decision

- **Downloads go to public addresses only** (`bin/lib/public-fetch.mjs`). Each hop's host is resolved, and the URL is
  refused when any address is loopback, private, link-local, ULA, multicast, documentation, `0.0.0.0`, `::`, or an
  IPv4-mapped or 6to4 form of one. The request connects to the address that was checked, through a `lookup` that
  returns it, so a later DNS answer cannot replace it; TLS still verifies the host name. Redirects are followed by hand,
  at most five, and each is checked again. The error names the refusal, not the address. `MR_CAST_IMAGES_ALLOW_LOOPBACK=1`
  admits loopback only, for the test suite's local server. Local paths are resolved through links before the
  containment check. A server may send `application/octet-stream`, `binary/octet-stream` or `image/jpg`, since the
  first bytes decide the type.
- **Expressions are finite.** The parser refuses nesting past 200 levels, with the column. Sums whose bounds are numbers
  may nest to at most 10,000 terms in all at one point, or the expression does not parse. Every evaluation draws its
  sums from one budget of 100,000 terms and is NaN past it, and `validate` says a line ran out of terms rather than
  that it has no value. Long `+` and `*` chains compute in a loop and the name walk is iterative, so the tree's depth
  never becomes the stack's.
- **The outline loads on demand.** `shared/map.mjs` reads it through `loadWorld()`, two dynamic imports, and
  `countriesAt` throws if a caller reads a map before loading it. `validate`, `mr-cast steps`, the fit report bundle,
  the player page (before it shows a storyboard with a map) and the render composition (holding the frame with
  `delayRender`) each await it when the storyboard has a map scene.

## Alternatives considered

- **An allowlist of image hosts.** Safer, but every new source would need a setting; refusing non-public addresses
  covers the risk without one.
- **A bigger stack, or a token cap, for expressions.** Neither bounds nested sums, and a token cap still lets a deep
  tree through; the depth limit and the budget each bound one cost directly.
- **`React.lazy` for the map component.** The outline is read by shared modules every scene uses, not only by the
  component, so only an explicit load in `shared/map.mjs` keeps it out of the main chunk.

## Consequences

- A picture on `localhost` or a home network cannot be downloaded; save it in the run directory or the repository.
- An expression that parsed in the 0.28 candidate with static nested sums past 10,000 terms no longer does; no example
  used one.
- The player's main chunk is 417 KB smaller (2,408 KB to 1,992 KB, 770 KB to 611 KB gzipped); a storyboard with a map
  fetches the outline as two chunks of 83 KB and 336 KB. Code that reads a map outside these entry points must await
  `loadWorld()` first, and the error says so.
