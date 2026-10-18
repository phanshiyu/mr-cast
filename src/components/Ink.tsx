// The whiteboard pen over a stepped scene. Each step's `draw` items are written on in turn or on their cue words, and
// stay on the board until a step's `erase` takes them off. Each is placed clear of everything the scene shows from
// its step on and of the ink already there.

import { interpolate, useCurrentFrame } from 'remotion';
import { FACES } from '../fonts';
import { inkBoard, type BoardItem, type InkTarget } from '../../shared/ink.mjs';
import { plainText } from '../../shared/markup.mjs';
import { sceneSteps } from '../../shared/steps.mjs';
import { cueFrame } from '../../shared/timing.mjs';
import type { HunkMap, InkItem, Scene } from '../types';
import { besideBox, BRACE_REACH, type InkSide, braceSketch, clearOf, edgeToward, keepIn, leader, linkSketch, placeText, shaftBulge, SIDE_ONLY, tickSketch, UNDER_FIRST } from '../utils/inkGeometry';
import { center, grow, seedOf, sketchMark, strokeLength, strokePath, union, type Box, type MarkTargets, type Pt, type Sketch, type Stroke } from '../utils/penGeometry';
import type { SpokenSegment } from '../utils/timing';
import { clamp, colors } from './theme';
import { tones } from './tones';

const PEN_INK = '#ffe066';
const PEN = 4.5;
const NOTE_FONT = 38;
const WRITE_FONT = 42;
const HAND = FACES.hand;
const CLEAR_FRAMES = 10;
/** Pen speed in pixels of stroke a frame. An arrow is drawn slower, so the eye follows it from one end to the other. */
const STROKE_PX_PER_FRAME = 60;
const ARROW_PX_PER_FRAME = 40;
/** Frames a character of handwriting takes. */
const FRAMES_PER_CHAR = 2.2;
/** Frames between one item finishing and the next starting, when neither has a cue. */
const ITEM_GAP = 4;

let measurer: CanvasRenderingContext2D | null | undefined;
function textWidth(text: string, size: number): number {
  const font = `600 ${size}px ${HAND}`;
  try {
    measurer ??= document.createElement('canvas').getContext('2d');
    if (measurer && document.fonts.check(font)) {
      measurer.font = font;
      return Math.ceil(measurer.measureText(text).width);
    }
  } catch {
    // No DOM: fall through to the estimate.
  }
  return Math.ceil(text.length * size * 0.42);
}

interface Text {
  lines: string[];
  box: Box;
  size: number;
}

/** An item laid out and timed: its strokes, its text, the frames it draws over, and the frame it starts to clear. */
interface Placed {
  item: BoardItem;
  sketch: Sketch | null;
  text: Text | null;
  /** Writes the text before the strokes: a `write` with a leader arrow back to what it is about. */
  textFirst: boolean;
  color: string;
  start: number;
  /** Frames the strokes take, then the text. */
  strokeFrames: number;
  textFrames: number;
  clear: number;
  /** What the item covers, for the items after it to keep off and for an arrow to point at. */
  bounds: Box;
}

function textBlock(text: string, size: number) {
  const lines = plainText(text).split('\n');
  return { lines, width: Math.max(...lines.map((l) => textWidth(l, size))) + 10, height: Math.round(size * 1.2) * lines.length };
}

const strokesBounds = (strokes: readonly Stroke[]): Box => union(strokes.flatMap((s) => s.points.map((p) => ({ x: p.x, y: p.y, width: 0, height: 0 }))))!;
const strokeTotal = (sketch: Sketch | null) => (sketch ? sketch.strokes.reduce((sum, s) => sum + strokeLength(s), 0) : 0);

/** Lays out and times every item of the board in order, each placed clear of the scene from its step on and of the ink still up. */
function planInk(scene: Scene, hunks: HunkMap, segments: readonly SpokenSegment[], targets: (k: number) => MarkTargets | null): Placed[] {
  const steps = sceneSteps(scene) as readonly { mark?: string; flag?: string }[];
  const { items } = inkBoard(scene, hunks);
  const placed: Placed[] = [];
  const cursors = new Map<number, number>();
  for (const it of items) {
    const segment = segments[it.step + 1];
    const t = targets(it.step);
    if (!segment || !t) continue;
    const stepStart = segment.from;
    const live = placed.filter((p) => p.clear > stepStart);
    const boxOf = (target: InkTarget): Box | null => {
      if ('ink' in target) {
        const own = live.findLast((p) => p.item.id === target.ink);
        return own ? (own.text?.box ?? own.bounds) : null;
      }
      if ('point' in target) return grow({ x: t.area.x + target.point[0] * t.area.width, y: t.area.y + target.point[1] * t.area.height, width: 0, height: 0 }, 4);
      return union(target.keys.map((key) => t.boxes.get(key) ?? t.boxOf?.(key)));
    };
    // A scene whose camera moves draws later steps elsewhere; its ink moves with the content, so only this step's boxes count.
    const shown = t.shift ? [t] : steps.slice(it.step).flatMap((_, j) => targets(it.step + j) ?? []);
    const obstacles = [...shown.flatMap((tj) => [...(tj.obstacles ?? tj.boxes.values())]), ...live.flatMap((p) => [p.bounds, ...(p.text ? [p.text.box] : [])])];
    const item: InkItem = it.item;
    const seed = seedOf(`${it.step}:${it.index}:${JSON.stringify(item)}`);
    const color = item.tone ? tones[item.tone].color : PEN_INK;
    const size = it.verb === 'write' ? WRITE_FONT : NOTE_FONT;
    const words = item.write ?? item.note;
    const block = words ? textBlock(words, size) : null;
    const blockSize = block ? { width: block.width, height: block.height } : { width: 0, height: 0 };
    let sketch: Sketch | null = null;
    let box: Box | null = null;
    let textFirst = false;

    if (it.verb === 'arrow') {
      const [from, to] = it.targets as [InkTarget, InkTarget];
      const source = boxOf(from);
      const target = boxOf(to);
      if (!source || !target) continue;
      const tail = 'point' in from ? center(source) : edgeToward(source, center(target));
      sketch = linkSketch('point' in from ? null : source, tail, target, obstacles, seed, PEN);
      if (block) {
        // The note sits on the outside of the bend, off the shaft.
        const bulge = shaftBulge(sketch);
        const ends = sketch.strokes[0]!.points;
        const out = { x: bulge.x - (ends[0]!.x + ends[ends.length - 1]!.x) / 2, y: bulge.y - (ends[0]!.y + ends[ends.length - 1]!.y) / 2 };
        const outward: InkSide = Math.abs(out.y) >= Math.abs(out.x) ? (out.y > 0 ? 'below' : 'above') : out.x > 0 ? 'right' : 'left';
        const dot = grow({ ...bulge, width: 0, height: 0 }, 8);
        const sides = [outward, ...(['right', 'left', 'above', 'below'] as const).filter((side) => side !== outward)];
        box = placeText(dot, dot, blockSize, [...obstacles, source, target], t.area, sides).box;
      }
    } else if (it.verb === 'brace') {
      const span = union(it.targets.map(boxOf));
      if (!span) continue;
      const side = item.side ?? (span.width >= span.height ? 'below' : 'right');
      const target = clearOf(span, side, obstacles);
      sketch = braceSketch(target, side, seed, PEN);
      if (block) box = placeText(grow(target, BRACE_REACH - 12), target, blockSize, obstacles, t.area, SIDE_ONLY[side]).box;
    } else if (it.verb === 'write') {
      if (item.at) box = keepIn({ x: t.area.x + item.at[0] * t.area.width, y: t.area.y + item.at[1] * t.area.height, ...blockSize }, t.area);
      else {
        const target = boxOf(it.targets[0]!);
        if (!target) continue;
        if (item.side) box = keepIn(besideBox(target, item.side, blockSize, 16), t.area);
        else {
          const near = placeText(grow(target, 6), target, blockSize, obstacles, t.area);
          box = near.box;
          if (near.crowded) {
            const far = leader(grow(target, 6), blockSize, obstacles, t.area, seed, PEN);
            box = far.box;
            sketch = { strokes: far.strokes, bounds: strokesBounds(far.strokes) };
          }
        }
      }
      textFirst = true;
    } else {
      const target = union(it.targets.map(boxOf));
      if (!target) continue;
      sketch = it.verb === 'tick' ? tickSketch(target, seed, PEN) : sketchMark(it.verb as 'circle' | 'box' | 'underline' | 'strike' | 'cross', target, t.area, obstacles, seed, PEN);
      if (block) {
        const near = placeText(sketch.bounds, target, blockSize, obstacles, t.area, item.side ? SIDE_ONLY[item.side] : it.verb === 'underline' ? UNDER_FIRST : undefined);
        box = near.box;
        if (near.crowded && !item.side) {
          const far = leader(sketch.bounds, blockSize, obstacles, t.area, seed, PEN);
          box = far.box;
          sketch = { strokes: [...sketch.strokes, ...far.strokes], bounds: sketch.bounds };
        }
      }
    }

    const strokeFrames = strokeTotal(sketch) / (it.verb === 'arrow' ? ARROW_PX_PER_FRAME : STROKE_PX_PER_FRAME);
    const textFrames = block ? block.lines.join('').length * FRAMES_PER_CHAR : 0;
    const cursor = cursors.get(it.step) ?? (steps[it.step]?.mark || steps[it.step]?.flag ? segment.voiceFrom : segment.markFrom);
    const start = (item.when ? cueFrame(segment, item.when) : null) ?? cursor;
    cursors.set(it.step, Math.max(cursor, start + Math.max(8, strokeFrames + textFrames) + ITEM_GAP));
    const clear = it.until === Infinity ? Infinity : (segments[it.until + 1]?.from ?? Infinity);
    const text = block && box ? { lines: block.lines, box, size } : null;
    placed.push({ item: it, sketch, text, textFirst, color, start, strokeFrames, textFrames, clear, bounds: sketch?.bounds ?? box! });
  }
  return placed;
}

const Strokes: React.FC<{ strokes: Stroke[]; progress: (i: number) => number; width: number; color: string; opacity: number }> = ({ strokes, progress, width, color, opacity }) => (
  <>
    {strokes.map((stroke, i) =>
      progress(i) > 0 ? (
        <path key={i} d={strokePath(stroke)} fill="none" stroke={color} strokeOpacity={opacity} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - progress(i)} />
      ) : null,
    )}
  </>
);

/** The pen's tip where it is drawing. */
const Tip: React.FC<{ at: Pt; color: string }> = ({ at, color }) => (
  <div style={{ position: 'absolute', left: at.x - 3.5, top: at.y - 3.5, width: 7, height: 7, borderRadius: 4, background: color, boxShadow: `0 0 8px ${color}` }} />
);

/** Handwriting revealed left to right at writing speed, line by line, with a soft wet edge and the pen's tip at it. */
const Writing: React.FC<{ text: Text; written: number; color: string }> = ({ text, written, color }) => {
  const lineH = Math.round(text.size * 1.2);
  const lengths = text.lines.map((l) => Math.max(1, l.length));
  const total = lengths.reduce((a, b) => a + b, 0);
  let before = 0;
  return (
    <>
      {text.lines.map((line, i) => {
        const share = lengths[i]! / total;
        const raw = (written - before) / share;
        const p = raw > 0.995 ? 1 : Math.max(0, raw);
        before += share;
        if (p <= 0) return null;
        const w = textWidth(line, text.size) + 10;
        const edge = p * w;
        const writing = p < 1;
        const mask = writing ? `linear-gradient(to right, #000 ${edge - 8}px, transparent ${edge + 4}px)` : undefined;
        return (
          <div key={i} style={{ position: 'absolute', left: text.box.x, top: text.box.y + i * lineH, height: lineH, width: w + 20 }}>
            <div
              style={{
                padding: '0 5px',
                fontFamily: `${HAND}, "Bradley Hand", "Segoe Print", cursive`,
                fontWeight: 600,
                fontSize: text.size,
                lineHeight: `${lineH}px`,
                whiteSpace: 'pre',
                color,
                textShadow: `0 0 3px ${colors.bg}, 0 0 8px ${colors.bg}, 0 0 14px ${colors.bg}`,
                WebkitMaskImage: mask,
                maskImage: mask,
              }}
            >
              {line}
            </div>
            {writing ? <Tip at={{ x: edge, y: lineH * 0.5 + Math.sin(edge / 9) * text.size * 0.18 }} color={color} /> : null}
          </div>
        );
      })}
    </>
  );
};

/** The point `share` of the way along a sketch's strokes, drawn in order. */
function pointAlong(strokes: readonly Stroke[], share: number): Pt | null {
  const lengths = strokes.map(strokeLength);
  let left = share * lengths.reduce((a, b) => a + b, 0);
  for (const [i, stroke] of strokes.entries()) {
    if (left > lengths[i]!) {
      left -= lengths[i]!;
      continue;
    }
    for (let j = 1; j < stroke.points.length; j++) {
      const [a, b] = [stroke.points[j - 1]!, stroke.points[j]!];
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      if (left <= seg) return { x: a.x + ((b.x - a.x) * left) / (seg || 1), y: a.y + ((b.y - a.y) * left) / (seg || 1) };
      left -= seg;
    }
  }
  return null;
}

const InkItemView: React.FC<{ p: Placed; frame: number; area: Box; shift: Pt | undefined }> = ({ p, frame, area, shift }) => {
  const total = Math.max(8, p.strokeFrames + p.textFrames);
  const t = Math.min(1, Math.max(0, (frame - p.start) / total));
  const strokeShare = p.strokeFrames / (p.strokeFrames + p.textFrames || 1);
  const [penFrom, penTo, textFrom, textTo] = p.textFirst ? [1 - strokeShare, 1, 0, 1 - strokeShare] : [0, strokeShare, strokeShare, 1];
  const pen = interpolate(t, [penFrom, Math.max(penFrom + 1e-6, penTo)], [0, 1], { ...clamp, easing: (x) => 1 - (1 - x) ** 1.6 });
  const written = interpolate(t, [textFrom, Math.max(textFrom + 1e-6, textTo)], [0, 1], clamp);
  const lengths = p.sketch ? p.sketch.strokes.map(strokeLength) : [];
  const sum = lengths.reduce((a, b) => a + b, 0) || 1;
  const progress = (i: number) => {
    const before = lengths.slice(0, i).reduce((a, b) => a + b, 0) / sum;
    return Math.min(1, Math.max(0, (pen - before) / (lengths[i]! / sum)));
  };
  const tip = p.sketch && pen > 0 && pen < 1 ? pointAlong(p.sketch.strokes, pen) : null;
  const opacity = p.clear === Infinity ? 1 : interpolate(frame, [p.clear, p.clear + CLEAR_FRAMES], [1, 0], clamp);
  return (
    <div style={{ position: 'absolute', inset: 0, opacity, transform: shift ? `translate(${shift.x}px, ${shift.y}px)` : undefined }}>
      {p.sketch ? (
        <svg width={area.width} height={area.height} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
          <Strokes strokes={p.sketch.strokes} progress={progress} width={PEN + 6} color={colors.bg} opacity={0.6} />
          <Strokes strokes={p.sketch.strokes} progress={progress} width={PEN} color={p.color} opacity={1} />
        </svg>
      ) : null}
      {tip ? <Tip at={tip} color={p.color} /> : null}
      {p.text && written > 0 ? <Writing text={p.text} written={written} color={p.color} /> : null}
    </div>
  );
};

/** Every ink item on the board at this frame. Draws nothing for a scene whose steps draw nothing. */
export const InkLayer: React.FC<{ scene: Scene; hunks: HunkMap; segments: readonly SpokenSegment[]; targets: (k: number) => MarkTargets | null }> = ({ scene, hunks, segments, targets }) => {
  const frame = useCurrentFrame();
  if (!sceneSteps(scene).some((s) => (s as { draw?: unknown[] })?.draw?.length)) return null;
  const shown = planInk(scene, hunks, segments, targets).filter((p) => frame >= p.start && frame < p.clear + CLEAR_FRAMES);
  if (!shown.length) return null;
  const first = targets(0);
  const area = first?.area ?? { x: 0, y: 0, width: 1920, height: 1080 };
  const clip = first?.clip;
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', clipPath: clip ? `inset(${clip.y}px 0 ${area.height - clip.y - clip.height}px 0)` : undefined }}>
      {shown.map((p) => (
        <InkItemView key={`${p.item.step}:${p.item.index}`} p={p} frame={frame} area={area} shift={targets(p.item.step)?.shift} />
      ))}
    </div>
  );
};
