import { createElement, useMemo, type ReactNode } from 'react';
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { sceneStates, type SceneState } from '../../shared/state-steps.mjs';
import { pairShapes, traceLength, tweenShape, tweenTransform, type PairedShape } from '../../shared/svg-motion.mjs';
import { SVG_COLORS, SVG_TONES, svgOf, svgStage, type SvgNode } from '../../shared/svg.mjs';
import { STEP_SETTLE_FRAMES, cueFrame } from '../../shared/timing.mjs';
import { headerBox } from '../fit/shell';
import type { SvgScene, Tone } from '../types';
import { brighter, currentStep, focusSpotlight, type Emphasis } from '../utils/spotlight';
import type { SpokenSegment } from '../utils/timing';
import { shownOf, stateFrame, type StateFrame } from '../utils/stateTrack';
import { dimOpacity, mainTone, tintFill, tintMix, type TintMix } from '../utils/tint';
import { HeaderCallout } from './HeaderCallout';
import { PenMarks } from './PenMarks';
import { svgTargets } from '../utils/sceneTargets';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { colors, fonts } from './theme';
import { tones } from './tones';

const START = 6;
/** Frames between one top-level part of the drawing landing and the next. */
const STAGGER = 3;
const STAGGER_END = 22;
/** How far past its stage a drawing may paint, in px: room for a lit element's glow, short of the header and captions. */
const BLEED = 32;

/** Shapes that fill an area, which with no fill of their own draw as a card; the rest draw as a line. */
const AREAS = new Set(['rect', 'circle', 'ellipse', 'polygon']);
const LINES = new Set(['line', 'polyline', 'path']);
const LEAVES = new Set([...AREAS, ...LINES, 'text', 'use']);
type SvgElement = Extract<SvgNode, { tag: string }>;
/** The element an id names, when it is one. */
const elementOf = (ids: Map<string, SvgNode>, id: string): SvgElement | undefined => {
  const node = ids.get(id);
  return node && 'tag' in node ? node : undefined;
};

/** What a mask copies of a shape to trace it: its geometry, without its transform, which the mask's space already has. */
const GEOMETRY = ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'points', 'd'];
/** How fast a trace draws, in px of line a frame, as ink's arrows do; and the shortest and longest a trace takes. */
const TRACE_SPEED = 40;
const TRACE_MIN = 12;
const TRACE_MAX = 75;
/** A flowing line's dashes and how fast they march, in px on screen, as a graph edge's 3 px line; a wider line scales both. */
const FLOW_DASH = [10, 12];
const FLOW_SPEED = 1.4;

/** `var(--good)` as the palette colour it names. */
const resolveVars = (value: string) => value.replace(/var\(\s*--([\w-]+)\s*\)/g, (m, name: string) => (Object.hasOwn(SVG_COLORS, name) ? SVG_COLORS[name]! : m));

/** The tones a class list names: `tone-good` for a tinted shape, `fill-good` and `stroke-good` for one solid colour. */
function classTones(cls: string | undefined) {
  const out: { tone?: Tone; fill?: Tone; stroke?: Tone } = {};
  for (const c of (cls ?? '').split(/\s+/)) {
    const [kind, tone] = c.split('-') as [string, Tone];
    if (!SVG_TONES.includes(tone)) continue;
    if (kind === 'tone') out.tone = tone;
    else if (kind === 'fill') out.fill = tone;
    else if (kind === 'stroke') out.stroke = tone;
  }
  return out;
}

/** An SVG attribute as a React prop name: stroke-width → strokeWidth, xlink:href → href. */
const propName = (name: string) => (name === 'xlink:href' ? 'href' : name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()));

interface Inherited {
  fill: boolean;
  stroke: boolean;
  /** The light of the nearest element with an id, or of the whole drawing. */
  emphasis: Emphasis;
  /** The colour a step keeps on the nearest tinted element. */
  tint: TintMix | null;
  font: string;
  /** How far a trace has drawn the nearest traced element, 0 to 1, or null when nothing above is traced at this step. */
  trace: number | null;
  /** Whether the nearest element above is a flowing line, `class="flow"`. */
  flow: boolean;
}

interface Draw {
  s: StateFrame;
  focus: (key: string) => Emphasis;
  /** Every id prefixed, so two drawings, or a drawing and another scene, never share one in the page. */
  prefix: string;
  /** Each `<text>` element's own text, by item key, so one a step rewrites draws its new text. */
  initial: Record<string, unknown>;
  frame: number;
  /** The drawing's scale on the stage, so a flow's dashes measure the same on screen in any viewBox. */
  scale: number;
  /** How far the step's trace has drawn an element, by key, or null when the step does not trace it. */
  traced: (key: string) => number | null;
  /** How far an element has moved to the step's transform, 0 to 1: across the step's words for a spanned move. */
  moved: (key: string) => number;
  /** A path's `d` partway through a morph, or its own. */
  shape: (key: string, own: string | undefined) => string | undefined;
}

/** Ids an attribute points at, url(#id) anywhere and an href's #id, as their prefixed ids. */
const prefixRefs = (name: string, value: string, prefix: string) =>
  name === 'href' || name === 'xlink:href' ? `#${prefix}${value.slice(1)}` : value.replace(/url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/g, `url(#${prefix}$1)`);

function draw(node: SvgNode, key: string, d: Draw, up: Inherited): ReactNode {
  if (!('tag' in node)) return node.text;
  const a = node.attrs;
  const id = a.id;
  const cls = classTones(a.class);
  const own = id !== undefined ? `s:${id}` : null;
  // A lit group lights what is in it; a tint on an element colours what is in it, its own tint winning.
  const emphasis = own ? brighter(up.emphasis, d.focus(own)) : up.emphasis;
  const ownTint = own ? tintMix(d.s, own) : null;
  const tint = ownTint && (ownTint.tones.length || ownTint.dim > 0) ? ownTint : up.tint;
  const props: Record<string, unknown> = { key };
  for (const [name, value] of Object.entries(a)) {
    if (name === 'class' || name.startsWith('xmlns') || name === 'version') continue;
    props[propName(name)] = name === 'id' ? `${d.prefix}${value}` : prefixRefs(name, resolveVars(value), d.prefix);
  }
  const hasFill = up.fill || a.fill !== undefined || Boolean(cls.tone || cls.fill);
  const hasStroke = up.stroke || a.stroke !== undefined || Boolean(cls.tone || cls.stroke);
  if (cls.tone) {
    if (node.tag === 'text') props.fill ??= tones[cls.tone].color;
    else {
      props.fill ??= LINES.has(node.tag) && node.tag !== 'path' ? 'none' : tintFill(tones[cls.tone].color);
      props.stroke ??= tones[cls.tone].color;
    }
  }
  if (cls.fill) props.fill ??= tones[cls.fill].color;
  if (cls.stroke) props.stroke ??= tones[cls.stroke].color;
  if (node.tag === 'text') {
    if (!hasFill) props.fill = SVG_COLORS.text;
    props.fontFamily = /mono/i.test(a['font-family'] ?? up.font) ? fonts.mono : fonts.sans;
  } else if (AREAS.has(node.tag)) {
    if (!hasFill) props.fill = SVG_COLORS.surface;
    if (!hasStroke) props.stroke = SVG_COLORS.border;
  } else if (LINES.has(node.tag)) {
    if (!hasFill) props.fill = 'none';
    if (!hasStroke) props.stroke = SVG_COLORS.muted;
  }
  const value = own && node.tag === 'text' ? d.s.now.values[own] : undefined;
  const changed = own && node.tag === 'text' && d.s.before.values[own] !== value;
  if (LEAVES.has(node.tag) && tint) {
    const tone = mainTone(tint);
    if (tone) {
      if (node.tag === 'text') props.fill = tones[tone].color;
      else {
        if (!LINES.has(node.tag) || node.tag === 'path') props.fill = props.fill === 'none' ? 'none' : tintFill(tones[tone].color);
        props.stroke = tones[tone].color;
      }
    }
  }
  const shown = own ? shownOf(d.s, own) : 1;
  const leafOpacity = LEAVES.has(node.tag) ? emphasis.opacity * (tint ? dimOpacity(tint) : 1) : 1;
  const opacity = Number(a.opacity ?? 1) * shown * leafOpacity * (changed ? 0.35 + 0.65 * d.s.t : 1);
  if (opacity !== 1) props.opacity = opacity;
  if (own && d.focus(own).glow > 0) {
    const g = d.focus(own).glow;
    props.style = { filter: `drop-shadow(0 0 ${3 * g}px ${colors.accent}) drop-shadow(0 0 ${16 * g}px ${colors.accentGlow})` };
  }
  if (own) {
    const [was, is] = [d.s.before.transforms[own], d.s.now.transforms[own]];
    if (was !== undefined || is !== undefined) props.transform = `${tweenTransform(was ?? '', is ?? '', d.moved(own))} ${a.transform ?? ''}`.trim();
    if (node.tag === 'path') props.d = d.shape(own, a.d);
  }
  const trace = (own ? d.traced(own) : null) ?? up.trace;
  const flow = up.flow || (a.class ?? '').split(/\s+/).includes('flow');
  const next: Inherited = { fill: hasFill, stroke: hasStroke, emphasis, tint, font: a['font-family'] ?? up.font, trace, flow };
  const rewritten = own !== null && value !== undefined && value !== d.initial[own];
  const children = rewritten ? [String(value)] : node.children.map((c, i) => draw(c, `${key}.${i}`, d, next));
  if (node.tag === 'text' && trace !== null) props.opacity = Number(props.opacity ?? 1) * trace;
  if (!AREAS.has(node.tag) && !LINES.has(node.tag)) return createElement(node.tag, props, ...children);
  return motionShape(node, key, props, children, d, trace, flow);
}

/**
 * A shape as its step's motion draws it: a traced one drawn on from its start (by its own dashes when it has none, or
 * through a mask that keeps them), and a flowing one as a faint line under marching dashes.
 */
function motionShape(node: SvgElement, key: string, props: Record<string, unknown>, children: ReactNode[], d: Draw, trace: number | null, flow: boolean): ReactNode {
  const tracing = trace !== null && trace < 1;
  if (!tracing && !flow) return createElement(node.tag, props, ...children);
  if (tracing) for (const m of ['markerStart', 'markerMid', 'markerEnd']) delete props[m];
  const dashed = flow || node.attrs['stroke-dasharray'] !== undefined;
  if (tracing && !dashed) {
    Object.assign(props, { pathLength: 1, strokeDasharray: '1 1', strokeDashoffset: 1 - trace, fillOpacity: Number(node.attrs['fill-opacity'] ?? 1) * trace });
    return createElement(node.tag, props, ...children);
  }
  const layers: ReactNode[] = [];
  let mask: string | undefined;
  if (tracing) {
    const maskId = `${d.prefix}trace-${key}`;
    const shape: Record<string, unknown> = { fill: 'none', stroke: '#fff', strokeWidth: Number.parseFloat(node.attrs['stroke-width'] ?? '2') * 3 + 12 / d.scale, strokeLinecap: 'round', pathLength: 1, strokeDasharray: '1 1', strokeDashoffset: 1 - trace };
    for (const g of GEOMETRY) if (props[g] !== undefined) shape[g] = props[g];
    layers.push(createElement('mask', { key: 'm', id: maskId, maskUnits: 'userSpaceOnUse', x: -1e5, y: -1e5, width: 2e5, height: 2e5 }, createElement(node.tag, shape)));
    mask = `url(#${maskId})`;
  }
  if (!flow) return createElement('g', { key }, ...layers, createElement(node.tag, { ...props, key: 's', mask }, ...children));
  const { id: _id, markerStart: _s, markerMid: _m, markerEnd: _e, ...plain } = props;
  const opacity = Number(node.attrs['stroke-opacity'] ?? 1);
  const grow = Math.max(1, (Number.parseFloat(node.attrs['stroke-width'] ?? '1') * d.scale) / 3);
  const dashes = node.attrs['stroke-dasharray'] ?? FLOW_DASH.map((n) => (n * grow) / d.scale).join(' ');
  layers.push(createElement(node.tag, { ...plain, key: 'u', mask, strokeOpacity: 0.25 * opacity }));
  layers.push(createElement(node.tag, { ...props, key: 'f', mask, fill: 'none', strokeDasharray: dashes, strokeDashoffset: (-d.frame * FLOW_SPEED * grow) / d.scale, strokeLinecap: props.strokeLinecap ?? 'round' }, ...children));
  return createElement('g', { key }, ...layers);
}

const pairs = new Map<string, PairedShape>();
/** Two shapes paired for a morph, once per pair. */
function paired(from: string, to: string): PairedShape {
  const key = `${from}\n${to}`;
  if (!pairs.has(key)) {
    if (pairs.size > 200) pairs.clear();
    pairs.set(key, pairShapes(from, to));
  }
  return pairs.get(key)!;
}

/** How far each element the current step traces has drawn at `frame`, from its cue or the step settling, at TRACE_SPEED. */
function traceProgress(state: SceneState, ids: Map<string, SvgNode>, segments: readonly SpokenSegment[], k: number, frame: number, scale: number, shapeD: (key: string) => string | undefined) {
  const segment = segments[k + 1];
  const end = segments[k + 2]?.from ?? Infinity;
  const out = new Map<string, number>();
  if (k < 0 || !segment) return out;
  for (const [key, cue] of Object.entries(state.traces)) {
    const start = (cue ? cueFrame(segment, cue) : null) ?? segment.from + STEP_SETTLE_FRAMES;
    const node = elementOf(ids, key.slice(2));
    const frames = Math.min(TRACE_MAX, Math.max(TRACE_MIN, (traceLength(node, shapeD(key)) * scale) / TRACE_SPEED), Math.max(1, end - start));
    out.set(key, Math.min(1, Math.max(0, (frame - start) / frames)));
  }
  return out;
}

/** How far each move the current step plays across its words has gone at `frame`: evenly, from its cue or the voice to the voice's end. */
function spanProgress(state: SceneState, segments: readonly SpokenSegment[], k: number, frame: number) {
  const segment = segments[k + 1];
  const out = new Map<string, number>();
  if (k < 0 || !segment) return out;
  for (const [key, cue] of Object.entries(state.spans)) {
    const start = (cue ? cueFrame(segment, cue) : null) ?? segment.voiceFrom;
    const end = Math.max(start + STEP_SETTLE_FRAMES, segment.voiceFrom + segment.speakingFrames);
    out.set(key, Math.min(1, Math.max(0, (frame - start) / (end - start))));
  }
  return out;
}

/** A short stable name for a drawing, from its markup, to prefix its ids. */
function hashOf(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `d${(h >>> 0).toString(36)}-`;
}

export const SvgDiagram: React.FC<SceneProps<SvgScene>> = ({ scene, hunks, durationInFrames, segments }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const box = headerBox(scene);
  const { root, viewBox, ids } = svgOf(scene.svg);
  const states = useMemo(() => sceneStates(scene), [scene]);
  const stage = viewBox ? svgStage(viewBox, box) : { scale: 1, left: 0, top: 0 };
  const marks = useMemo(() => svgTargets(scene), [scene]);
  const s = stateFrame(states, segments, frame);
  const focus = focusSpotlight(scene, hunks, segments, frame);
  if (!root || !viewBox || !('tag' in root)) return <SceneShell scene={scene} durationInFrames={durationInFrames}>{null}</SceneShell>;
  const dOf = (state: SceneState, key: string, own: string | undefined) => (state.shapes[key] ? elementOf(ids, state.shapes[key])?.attrs.d : own);
  const shape = (key: string, own: string | undefined) => {
    const [was, is] = [dOf(s.before, key, own), dOf(s.now, key, own)];
    return was === is || !was || !is ? is : s.t >= 1 ? is : tweenShape(paired(was, is), s.t);
  };
  const traces = traceProgress(s.now, ids, segments, currentStep(segments, frame), frame, stage.scale, (key) => dOf(s.now, key, elementOf(ids, key.slice(2))?.attrs.d));
  const spans = spanProgress(s.now, segments, currentStep(segments, frame), frame);
  const d: Draw = { s, focus, prefix: hashOf(scene.svg), initial: states[0]!.values, frame, scale: stage.scale, traced: (key) => traces.get(key) ?? null, moved: (key) => spans.get(key) ?? s.t, shape };
  const base: Inherited = { fill: root.attrs.fill !== undefined, stroke: root.attrs.stroke !== undefined, emphasis: focus('#drawing'), tint: null, font: root.attrs['font-family'] ?? '', trace: null, flow: false };
  const parts = root.children;
  const stagger = Math.min(STAGGER, (STAGGER_END - START) / Math.max(1, parts.length - 1));
  const rootProps: Record<string, string> = {};
  for (const [name, value] of Object.entries(root.attrs)) if (!['viewBox', 'width', 'height', 'preserveAspectRatio', 'version', 'id', 'class'].includes(name) && !name.startsWith('xmlns')) rootProps[propName(name)] = prefixRefs(name, resolveVars(value), d.prefix);

  return (
    <SceneShell scene={scene} durationInFrames={durationInFrames} camera={{ hunks, segments, targets: (k) => marks[k] ?? null }} aside={<HeaderCallout scene={scene} s={s} />}>
      <svg width={box.width + 2 * BLEED} height={box.height + 2 * BLEED} viewBox={`${-BLEED} ${-BLEED} ${box.width + 2 * BLEED} ${box.height + 2 * BLEED}`} style={{ position: 'absolute', left: -BLEED, top: -BLEED, overflow: 'hidden' }}>
        <g transform={`translate(${stage.left} ${stage.top}) scale(${stage.scale})`} {...rootProps}>
          {parts.map((part, i) => {
            const appear = spring({ frame: frame - START - i * stagger, fps, config: { damping: 18, stiffness: 140 } });
            return (
              <g key={i} opacity={Math.min(1, appear)}>
                {draw(part, String(i), d, base)}
              </g>
            );
          })}
        </g>
      </svg>
      <PenMarks scene={scene} hunks={hunks} segments={segments} targets={(k) => marks[k] ?? null} />
    </SceneShell>
  );
};
