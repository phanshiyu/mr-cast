import { Easing, interpolate } from 'remotion';
import { stepTargets } from '../../shared/targets.mjs';
import { FPS, STEP_SETTLE_FRAMES, buildFrames } from '../../shared/timing.mjs';
import type { TerminalScene } from '../types';
import { stepMove } from './spotlight';
import { PAD_Y, terminalBoxes, type PlacedEntry, type TerminalLayout } from './terminalLayout';
import type { SpokenSegment } from './timing';

/** A readable typing pace, in characters a second. */
const TYPE_CPS = 40;
const TYPE_MIN = 6;
/** A long command types faster, so it never holds the screen past this many frames. */
const TYPE_MAX = 30;
/** Frames between a command's last character and its first line of output. */
const OUTPUT_DELAY = 4;
/** Frames between output lines, and the most an entry's output takes to print. */
const LINE_GAP = 2;
const OUTPUT_SPREAD = 10;
const ENTRY_GAP = 4;
/** Room kept between what the camera shows and the window's edges. */
const MARGIN = 20;
/** Frames the finished session holds, without steps, before the scene ends. */
const HOLD = 30;

/** When an entry starts typing, how long it types, and when its output lines print. */
export interface EntryTiming {
  typeFrom: number;
  typeFrames: number;
  outFrom: number;
  lineGap: number;
  /** The frame its last output line is in. */
  done: number;
}

function natural(e: PlacedEntry) {
  const typeFrames = e.command ? Math.min(TYPE_MAX, Math.max(TYPE_MIN, (e.command.chars * FPS) / TYPE_CPS)) : 0;
  const delay = e.command ? OUTPUT_DELAY : 0;
  const lineGap = e.lines.length > 1 ? Math.min(LINE_GAP, OUTPUT_SPREAD / (e.lines.length - 1)) : 0;
  return { typeFrames, delay, lineGap, total: typeFrames + delay + lineGap * Math.max(0, e.lines.length - 1) + 1 };
}

/** Plays `entries` one after another from `from`, squeezed into `budget` frames when they would take longer. */
function playGroup(entries: readonly PlacedEntry[], from: number, budget: number, out: EntryTiming[]) {
  const paces = entries.map(natural);
  const total = paces.reduce((n, p) => n + p.total + ENTRY_GAP, 0) - ENTRY_GAP;
  const k = total > budget ? Math.max(0.05, budget / total) : 1;
  let at = from;
  entries.forEach((e, i) => {
    const p = paces[i]!;
    const outFrom = at + (p.typeFrames + p.delay) * k;
    const done = outFrom + p.lineGap * k * Math.max(0, e.lines.length - 1);
    out[e.index] = { typeFrom: at, typeFrames: p.typeFrames * k, outFrom, lineGap: p.lineGap * k, done };
    at = done + 1 + ENTRY_GAP * k;
  });
}

/** Per step, the last entry typed by its end: every entry up to the last one it or an earlier step names. */
export function entryReach(scene: TerminalScene): number[] {
  let last = -1;
  return stepTargets(scene).map((keys) => {
    for (const key of keys) if (key.startsWith('en:') || key.startsWith('ln:')) last = Math.max(last, parseInt(key.slice(3), 10));
    return last;
  });
}

/**
 * When each entry plays. With steps, each step types the entries up to the last one it names from its start,
 * at a readable pace before the next step, or within STEP_SETTLE_FRAMES when the step draws a pen mark, so the
 * pen starts on a finished screen; the last step plays any entries after it. Without steps, the entries play
 * one after another while the narration speaks.
 */
export function terminalSchedule(scene: TerminalScene, layout: TerminalLayout, segments: readonly SpokenSegment[]): EntryTiming[] {
  const out: EntryTiming[] = [];
  const entries = layout.entries;
  const reach = entryReach(scene);
  if (reach.length && segments.length > 1) {
    let shown = 0;
    reach.forEach((last, k) => {
      const end = k === reach.length - 1 ? entries.length - 1 : last;
      const from = segments[k + 1]!.from;
      const next = segments[k + 2]?.from ?? from + segments[k + 1]!.durationInFrames;
      const marked = Boolean(scene.steps?.[k]?.mark);
      playGroup(entries.slice(shown, end + 1), from, marked ? STEP_SETTLE_FRAMES : (next - from) * 0.8, out);
      shown = Math.max(shown, end + 1);
    });
    return out;
  }
  const narration = segments[0]!;
  const from = Math.max(buildFrames('terminal'), narration.voiceFrom);
  // The session plays out until a second before the narration's segment ends, so the last screen holds to be read.
  const span = Math.max(entries.length * 12, narration.from + narration.durationInFrames - HOLD - from);
  const slot = span / Math.max(1, entries.length);
  entries.forEach((e) => playGroup([e], from + e.index * slot, slot * 0.8, out));
  return out;
}

export interface TerminalCamera {
  scrolls: boolean;
  /** Where the camera settles for each step, in session units from the top. */
  stops: number[];
  scrollAt: (frame: number) => number;
}

/**
 * The camera over a session taller than its window. It keeps the newest line at the bottom, as a terminal
 * does, and scrolls back up to what a step names when that is above the view. With steps it eases to each
 * step's stop as the step starts, at rest when the step settles; without, it follows the typing.
 */
export function terminalCamera(scene: TerminalScene, layout: TerminalLayout, timing: readonly EntryTiming[], segments: readonly SpokenSegment[]): TerminalCamera {
  const maxScroll = Math.max(0, layout.height - layout.viewH);
  const steps = scene.steps ?? [];
  if (maxScroll < 0.5) return { scrolls: false, stops: steps.map(() => 0), scrollAt: () => 0 };
  const clampScroll = (v: number) => Math.min(maxScroll, Math.max(0, v));
  const showing = (bottom: number) => clampScroll(bottom + PAD_Y - layout.viewH);
  const entries = layout.entries;
  const reach = entryReach(scene);
  if (reach.length && segments.length > 1) {
    const { boxes } = terminalBoxes(layout);
    const stops = stepTargets(scene).map((keys, k) => {
      const last = k === reach.length - 1 ? entries.length - 1 : reach[k]!;
      let stop = last >= 0 ? showing(entries[last]!.bottom) : 0;
      const tops = keys.flatMap((key) => (boxes.has(key) ? [boxes.get(key)!.y] : []));
      if (tops.length && Math.min(...tops) - MARGIN < stop) stop = clampScroll(Math.min(...tops) - MARGIN);
      return stop;
    });
    const scrollAt = (frame: number) => stops.reduce((acc, stop, k) => acc + (stop - (k ? stops[k - 1]! : 0)) * stepMove(frame, segments[k + 1]!.from), 0);
    return { scrolls: true, stops, scrollAt };
  }
  const times: number[] = [0];
  const values: number[] = [0];
  const key = (t: number, v: number) => {
    times.push(Math.max(t, times[times.length - 1]! + 1));
    values.push(Math.max(v, values[values.length - 1]!));
  };
  entries.forEach((e) => {
    const t = timing[e.index]!;
    key(t.typeFrom, showing(e.command ? e.command.y + e.command.fit.lines.length * layout.rowH : e.top + layout.rowH));
    key(t.done + 6, showing(e.bottom));
  });
  const scrollAt = (frame: number) => interpolate(frame, times, values, { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.quad) });
  return { scrolls: true, stops: steps.map(() => maxScroll), scrollAt };
}

