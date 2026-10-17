import { createElement, useMemo, type ReactNode } from 'react';
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { sceneStates } from '../../shared/state-steps.mjs';
import { SVG_COLORS, SVG_TONES, svgGeometry, svgOf, svgStage, type SvgNode } from '../../shared/svg.mjs';
import { headerBox } from '../fit/shell';
import type { SvgScene, Tone } from '../types';
import { staged } from '../utils/penGeometry';
import { brighter, focusSpotlight, type Emphasis } from '../utils/spotlight';
import { shownOf, stateFrame, type StateFrame } from '../utils/stateTrack';
import { dimOpacity, mainTone, tintFill, tintMix, type TintMix } from '../utils/tint';
import { HeaderCallout } from './HeaderCallout';
import { PenMarks } from './PenMarks';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { colors, fonts } from './theme';
import { tones } from './tones';

const START = 6;
/** Frames between one top-level part of the drawing landing and the next. */
const STAGGER = 3;
const STAGGER_END = 22;

/** Shapes that fill an area, which with no fill of their own draw as a card; the rest draw as a line. */
const AREAS = new Set(['rect', 'circle', 'ellipse', 'polygon']);
const LINES = new Set(['line', 'polyline', 'path']);
const LEAVES = new Set([...AREAS, ...LINES, 'text', 'use']);

/** `var(--good)` as the palette colour it names. */
const resolveVars = (value: string) => value.replace(/var\(\s*--([\w-]+)\s*\)/g, (m, name: string) => SVG_COLORS[name] ?? m);

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
}

interface Draw {
  s: StateFrame;
  focus: (key: string) => Emphasis;
  /** Every id prefixed, so two drawings, or a drawing and another scene, never share one in the page. */
  prefix: string;
  /** Each `<text>` element's own text, by item key, so one a step rewrites draws its new text. */
  initial: Record<string, unknown>;
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
  const next: Inherited = { fill: hasFill, stroke: hasStroke, emphasis, tint, font: a['font-family'] ?? up.font };
  const rewritten = own !== null && value !== undefined && value !== d.initial[own];
  const children = rewritten ? [String(value)] : node.children.map((c, i) => draw(c, `${key}.${i}`, d, next));
  return createElement(node.tag, props, ...children);
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
  const { root, viewBox } = svgOf(scene.svg);
  const states = useMemo(() => sceneStates(scene), [scene]);
  const stage = viewBox ? svgStage(viewBox, box) : { scale: 1, left: 0, top: 0 };
  const marks = useMemo(() => {
    const { boxes } = svgGeometry(root);
    const targets = staged({ boxes: new Map([...boxes].map(([id, b]) => [`s:${id}`, b])) }, stage, box);
    return states.slice(1).map(() => targets);
  }, [root, states, stage.scale, stage.left, stage.top]);
  const s = stateFrame(states, segments, frame);
  const focus = focusSpotlight(scene, hunks, segments, frame);
  if (!root || !viewBox || !('tag' in root)) return <SceneShell scene={scene} durationInFrames={durationInFrames}>{null}</SceneShell>;
  const d: Draw = { s, focus, prefix: hashOf(scene.svg), initial: states[0]!.values };
  const base: Inherited = { fill: root.attrs.fill !== undefined, stroke: root.attrs.stroke !== undefined, emphasis: focus('#drawing'), tint: null, font: root.attrs['font-family'] ?? '' };
  const parts = root.children;
  const stagger = Math.min(STAGGER, (STAGGER_END - START) / Math.max(1, parts.length - 1));
  const rootProps: Record<string, string> = {};
  for (const [name, value] of Object.entries(root.attrs)) if (!['viewBox', 'width', 'height', 'preserveAspectRatio', 'version', 'id', 'class'].includes(name) && !name.startsWith('xmlns')) rootProps[propName(name)] = prefixRefs(name, resolveVars(value), d.prefix);

  return (
    <SceneShell scene={scene} durationInFrames={durationInFrames} aside={<HeaderCallout scene={scene} s={s} />}>
      <svg width={box.width} height={box.height} viewBox={`0 0 ${box.width} ${box.height}`} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
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
