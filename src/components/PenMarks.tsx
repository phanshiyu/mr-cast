import { interpolate, useCurrentFrame } from 'remotion';
import { FACES } from '../fonts';
import { plainText } from '../../shared/markup.mjs';
import { markedKeys } from '../../shared/pen-marks.mjs';
import { sceneSteps } from '../../shared/steps.mjs';
import type { CodeStep, FocusStep, HunkMap, Scene } from '../types';
import { arrowSketch, placeArrow, placeNote, random, seedOf, sketchMark, strokeLength, strokePath, union, type MarkTargets, type Sketch } from '../utils/penGeometry';
import type { SpokenSegment } from '../utils/timing';
import { clamp, colors } from './theme';

const INK = '#ffe066';
const PEN = 4.5;
const NOTE_FONT = 34;
const HAND = FACES.hand;
/** A mark fades over these frames once the next step starts. */
const CLEAR_FRAMES = 8;

let measurer: CanvasRenderingContext2D | null | undefined;
/** Width of a note in the handwriting, or an estimate before the font has loaded. */
function noteWidth(text: string): number {
  const font = `600 ${NOTE_FONT}px ${HAND}`;
  try {
    measurer ??= document.createElement('canvas').getContext('2d');
    if (measurer && document.fonts.check(font)) {
      measurer.font = font;
      return Math.ceil(measurer.measureText(text).width);
    }
  } catch {
    // No DOM: fall through to the estimate.
  }
  return Math.ceil(text.length * NOTE_FONT * 0.42);
}

/** A review flag's pen: its severity's colour, and the severity written before its note. */
export interface Ink {
  color: string;
  label: string;
}
export type InkOf = (step: FocusStep | CodeStep) => Ink | null;

type MarkedStep = (FocusStep | CodeStep) & { mark: NonNullable<FocusStep['mark']> };

/**
 * When a step's mark draws, is complete, and starts to clear. The pen starts once the step's items are at
 * rest (the timing gives every scene STEP_SETTLE_FRAMES to move and draw them) and finishes a frame before
 * the step's words.
 */
function markTiming(segments: readonly SpokenSegment[], k: number) {
  const segment = segments[k + 1]!;
  return { start: segment.markFrom, done: segment.voiceFrom - 1, clear: segments[k + 2]?.from ?? Infinity };
}

/** The same strokes traced again a pixel or so off, as a pen that goes over its line twice. */
function retrace(sketch: Sketch, seed: number): Sketch {
  const rand = random(seed);
  return { ...sketch, strokes: sketch.strokes.map((s) => ({ ...s, points: s.points.map((p) => ({ x: p.x + (rand() - 0.5) * 2.4, y: p.y + (rand() - 0.5) * 2.4 })) })) };
}

const Strokes: React.FC<{ sketch: Sketch; progress: (i: number) => number; width: number; color: string; opacity: number }> = ({ sketch, progress, width, color, opacity }) => (
  <>
    {sketch.strokes.map((stroke, i) =>
      progress(i) > 0 ? (
        <path
          key={i}
          d={strokePath(stroke)}
          fill="none"
          stroke={color}
          strokeOpacity={opacity}
          strokeWidth={width}
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          strokeDasharray="1 1"
          strokeDashoffset={1 - progress(i)}
        />
      ) : null,
    )}
  </>
);

const Mark: React.FC<{ step: MarkedStep; k: number; scene: Scene; hunks: HunkMap; segments: readonly SpokenSegment[]; targets: MarkTargets; frame: number; ink: Ink | null }> = ({
  step,
  k,
  scene,
  hunks,
  segments,
  targets,
  frame,
  ink,
}) => {
  const { boxes, area, shift } = targets;
  const target = scene.type === 'code' ? (boxes.get((step as CodeStep).token ? 'token' : 'lines') ?? null) : union(markedKeys(scene, step as FocusStep, hunks).map((key) => boxes.get(key)));
  if (!target) return null;
  const clutter = { target, obstacles: targets.obstacles ?? [...boxes.values()], lines: targets.lines ?? [] };
  const seed = seedOf(`${k}:${step.mark}:${step.note ?? ''}`);
  const text = plainText(step.note ?? '').trim();
  const note = ink ? `${ink.label}: ${text}` : text || null;
  const color = ink?.color ?? INK;
  const noteSize = { width: note ? noteWidth(note) + 8 : 0, height: note ? Math.round(NOTE_FONT * 1.25) : 0 };
  const arrow = step.mark === 'arrow' ? placeArrow(noteSize, clutter, area) : null;
  const sketch = arrow ? arrowSketch(arrow.tail, target, seed, PEN) : sketchMark(step.mark as Exclude<typeof step.mark, 'arrow'>, target, area, clutter.obstacles, seed, PEN);
  const noteBox = !note ? null : arrow ? arrow.note : placeNote(step.mark as Exclude<typeof step.mark, 'arrow'>, noteSize, sketch, clutter, area);

  const { start, done, clear } = markTiming(segments, k);
  const span = done - start;
  // An arrow writes its note first and then points from it; any other mark is drawn, then labelled.
  const [penFrom, penTo, noteFrom, noteTo] = arrow ? [0.3, 1, 0, 0.4] : [0, 1, 0.5, 1];
  const pen = interpolate(frame, [start + penFrom * span, start + penTo * span], [0, 1], { ...clamp, easing: (t) => 1 - (1 - t) ** 2 });
  const lengths = sketch.strokes.map(strokeLength);
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  const progress = (i: number) => {
    const before = lengths.slice(0, i).reduce((a, b) => a + b, 0) / total;
    return Math.min(1, Math.max(0, (pen - before) / (lengths[i]! / total)));
  };
  const written = interpolate(frame, [start + noteFrom * span, start + noteTo * span], [0, 1], clamp);
  const opacity = clear === Infinity ? 1 : interpolate(frame, [clear, clear + CLEAR_FRAMES], [1, 0], clamp);
  const trace = retrace(sketch, seed + 1);

  return (
    <div style={{ position: 'absolute', inset: 0, opacity, transform: shift ? `translate(${shift.x}px, ${shift.y}px)` : undefined }}>
      <svg width={area.width} height={area.height} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
        <Strokes sketch={sketch} progress={progress} width={PEN + 6} color={colors.bg} opacity={0.6} />
        <Strokes sketch={sketch} progress={progress} width={PEN} color={color} opacity={1} />
        <Strokes sketch={trace} progress={progress} width={1.6} color={color} opacity={0.55} />
      </svg>
      {note && noteBox && written > 0 ? (
        <div
          style={{
            position: 'absolute',
            left: noteBox.x,
            top: noteBox.y,
            width: noteBox.width,
            height: noteBox.height,
            boxSizing: 'border-box',
            padding: '0 4px',
            fontFamily: `${HAND}, "Bradley Hand", "Segoe Print", cursive`,
            fontWeight: 600,
            fontSize: NOTE_FONT,
            lineHeight: `${noteBox.height}px`,
            whiteSpace: 'nowrap',
            color,
            textShadow: `0 0 3px ${colors.bg}, 0 0 8px ${colors.bg}, 0 0 14px ${colors.bg}`,
            clipPath: `inset(-12px ${(1 - written) * 100}% -12px -12px)`,
          }}
        >
          {note}
        </div>
      ) : null}
    </div>
  );
};

/**
 * Draws each step's pen mark on what the step points at, and its note beside it. A mark draws itself
 * between the step's items coming to rest and its words, and clears when the next step starts. Scenes
 * give only the boxes where the items rest.
 */
export const PenMarks: React.FC<{ scene: Scene; hunks: HunkMap; segments: readonly SpokenSegment[]; targets: (step: number) => MarkTargets | null; inkOf?: InkOf }> = ({
  scene,
  hunks,
  segments,
  targets,
  inkOf,
}) => {
  const frame = useCurrentFrame();
  const steps = sceneSteps(scene) as readonly (FocusStep | CodeStep)[];
  const shown = steps.flatMap((step, k) => {
    if (!step?.mark || !segments[k + 1]) return [];
    const { start, clear } = markTiming(segments, k);
    return frame >= start && frame < clear + CLEAR_FRAMES ? [k] : [];
  });
  if (!shown.length) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {shown.map((k) => {
        const t = targets(k);
        return t ? <Mark key={k} step={steps[k] as MarkedStep} k={k} scene={scene} hunks={hunks} segments={segments} targets={t} frame={frame} ink={inkOf?.(steps[k]!) ?? null} /> : null;
      })}
    </div>
  );
};
