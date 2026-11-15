# 43. Draw the svg, map and mermaid scenes with resvg, and mermaid with merman

- Status: Accepted
- Date: 2026-11-16

## Context

[ADR 42](0042-rust-engine.md) moves frame drawing from Chrome to a Rust engine. The svg, map and mermaid scenes draw
SVG: a storyboard's own markup, the world's outlines through d3-geo, and Mermaid's output. They also use SVG features
the engine's box-and-text display list has no equivalent for: masks that draw a line on, soft glows round a lit shape,
gradients, markers and clip paths. Mermaid itself is JavaScript that needs a browser's text measuring.

## Decision

- Each frame of an svg or map scene is written as SVG exactly as the React component renders it, then rasterized by
  resvg and placed in the frame as a picture (`Item::Image`). The step light, tint, move, morph and trace logic is
  ported as is; only the last step, drawing, is resvg.
- Mermaid diagrams are drawn by merman, a headless Rust re-implementation of Mermaid, behind the `mermaid` cargo feature
  of `mrc_core`. The CLI turns it on. The wasm player leaves it off, and a mermaid scene there shows the same message
  card the component shows for a diagram that fails.
- The map's d3-geo pieces (three projections, antimeridian clipping with polygon rejoin, adaptive resampling, fitting)
  are ported in `engine/core/src/scenes/map/geo.rs`, since no Rust crate has natural-earth and geoBounds together.
- Pictures reach the core decoded: the CLI reads the files named in `props.images` with the `image` crate and the core
  reads no files.

## Consequences

- Text in these scenes is drawn by resvg, not the engine's own shaper, so it matches Chrome about as closely as the
  other scenes' text does, but glyphs the bundled Inter subset lacks (such as "₂") are missing, where Chrome falls back
  to another font.
- merman measures text with its own metrics, so a Mermaid diagram's boxes can differ a little from Mermaid's in Chrome.
