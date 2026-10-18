import { outputLines } from '../../shared/terminal.mjs';
import { fitText, measure, type Fit } from '../../shared/textfit.mjs';
import { SLOTS, sized } from '../fit/slots';
import type { TerminalEntry, TerminalScene } from '../types';
import type { Box, LayoutBoxes } from './penGeometry';

/** Height of the window's title bar. */
export const CHROME_H = 52;
/** Padding inside the window around the session. */
export const PAD_X = 34;
export const PAD_Y = 24;
/** Text sizes to try, largest first. The smallest is the floor: a longer session scrolls rather than shrinks. */
const SIZES = [28, 26, 24];
const LINE_HEIGHT = 1.5;
/** Space between entries, as a share of a line. */
const ENTRY_GAP = 0.5;
/** The window is at least this share of the frame's height, so a short session still reads as a terminal. */
const MIN_BODY = 0.5;
export const EXIT_FONT = 17;
const EXIT_PAD = 13;
const EXIT_GAP = 20;
/** A prompt takes at most this share of the window's width, so the command beside it has room. */
const PROMPT_SHARE = 0.4;

export interface PlacedOutputLine {
  index: number;
  /** Room its leading spaces take, such as a stack trace's indent; its wrapped rows all start there. */
  indent: number;
  /** The line wrapped to the window's width, as a terminal wraps it: mid-word when a word is wider. */
  fit: Fit;
  y: number;
}

export interface PlacedCommand {
  /** Each wrapped row's text, typed in turn. */
  rows: string[];
  fit: Fit;
  chars: number;
  y: number;
}

export interface PlacedEntry {
  index: number;
  entry: TerminalEntry;
  prompt: string;
  /** The prompt fitted on one row, so `validate` names one too long to leave the command room. */
  promptFit: Fit;
  /** Room the prompt and the space after it take; a wrapped command's later rows start here too. */
  promptW: number;
  command: PlacedCommand | null;
  lines: PlacedOutputLine[];
  /** The exit status pill, right-aligned on the entry's last row, or on its own row when that row is full. */
  exit: { text: string; ok: boolean; y: number; w: number } | null;
  top: number;
  bottom: number;
  /** Widest text in the entry, from the left of the session. */
  textW: number;
}

export interface TerminalLayout {
  width: number;
  font: number;
  rowH: number;
  /** Width of the session's text. */
  innerW: number;
  entries: PlacedEntry[];
  /** Height of the whole session, padding included. */
  height: number;
  /** Height of the window's body; a session taller than it scrolls. */
  viewH: number;
  window: Fit | null;
}

const runsText = (line: Fit['lines'][number]) => line.map((r) => r.text).join('');

/** A text wrapped as a terminal wraps it. It always fits: the window scrolls, so only its markup can be wrong. */
function wrap(text: string, slot: typeof SLOTS.terminalOutput, width: number, size: number, path: string): Fit {
  const fit = fitText(text, { ...sized(slot, width), size, min: size }, path);
  // Colour marks a whole log line's status, such as a failure in red, so a line in one tone is not over-styled.
  return { ...fit, fits: true, styled: 0 };
}

function attempt(scene: TerminalScene, width: number, size: number) {
  const rowH = size * LINE_HEIGHT;
  const innerW = width - 2 * PAD_X;
  const gap = Math.round(rowH * ENTRY_GAP);
  let y = PAD_Y;
  const entries = scene.entries.map((entry, index): PlacedEntry => {
    const top = y;
    const prompt = entry.prompt ?? '$';
    const promptW = measure(`${prompt} `, { family: 'mono', weight: 700, size });
    const promptFit = fitText(
      prompt,
      { ...sized(SLOTS.terminalPrompt, innerW * PROMPT_SHARE), size, min: size },
      `entries[${index}].prompt`,
    );
    let textW = 0;
    let command: PlacedCommand | null = null;
    if (entry.command !== undefined) {
      const fit = wrap(entry.command, SLOTS.terminalCommand, innerW - promptW, size, `entries[${index}].command`);
      const rows = fit.lines.map(runsText);
      command = { rows, fit, chars: rows.reduce((n, r) => n + r.length, 0), y };
      textW = promptW + fit.width;
      y += fit.lines.length * rowH;
    }
    const lines = outputLines(entry).map((raw, l): PlacedOutputLine => {
      const text = raw.replace(/\t/g, '  ').trimEnd();
      const spaces = text.length - text.trimStart().length;
      const indent = Math.min(innerW / 2, measure(' '.repeat(spaces), { family: 'mono', weight: 400, size }));
      const fit = wrap(text.trimStart(), SLOTS.terminalOutput, innerW - indent, size, `entries[${index}].output`);
      const placed = { index: l, indent, fit, y };
      textW = Math.max(textW, indent + fit.width);
      y += Math.max(1, fit.lines.length) * rowH;
      return placed;
    });
    let exit: PlacedEntry['exit'] = null;
    if (entry.exit !== undefined) {
      const text = `exit ${entry.exit}`;
      const w = measure(text, { family: 'mono', weight: 700, size: EXIT_FONT }) + 2 * EXIT_PAD;
      const last = lines[lines.length - 1];
      // How wide the entry's last row is, or null when it has no rows.
      const lastW = last
        ? last.indent + (last.fit.widths[last.fit.widths.length - 1] ?? 0)
        : command
          ? promptW + (command.fit.widths[command.fit.widths.length - 1] ?? 0)
          : null;
      const own = lastW === null || lastW + EXIT_GAP + w > innerW;
      exit = { text, ok: entry.exit === 0, y: own ? y : y - rowH, w };
      if (own) y += rowH;
      textW = Math.max(textW, own ? w : innerW);
    }
    const placed = { index, entry, prompt, promptFit, promptW, command, lines, exit, top, bottom: y, textW };
    y += gap;
    return placed;
  });
  return { width, font: size, rowH, innerW, entries, height: y - gap + PAD_Y };
}

/**
 * Lays out a session in a window `width` wide in a box `height` tall: at the largest size where it all
 * shows, else at the smallest size, taller than the window, to scroll.
 */
export function layoutTerminal(scene: TerminalScene, width: number, height: number): TerminalLayout {
  const room = height - CHROME_H;
  const fitted = SIZES.map((size) => attempt(scene, width, size));
  const chosen = fitted.find((l) => l.height <= room) ?? fitted[fitted.length - 1]!;
  const viewH = Math.min(room, Math.max(chosen.height, Math.round(room * MIN_BODY)));
  const window = scene.window ? fitText(scene.window, sized(SLOTS.terminalWindow, width - 260), 'window') : null;
  return { ...chosen, viewH, window };
}

/** An entry's rows, from its prompt to its last output line, in session units. */
const entryBox = (layout: TerminalLayout, e: PlacedEntry): Box => ({
  x: PAD_X - 10,
  y: e.top - 4,
  width: Math.min(layout.innerW, e.textW) + 20,
  height: e.bottom - e.top + 8,
});

/**
 * The box of each item a step can focus, by its key in shared/targets.mjs, in session units (the window's
 * body before it scrolls): an entry, and one output line's text. A note keeps off every line of text.
 */
export function terminalBoxes(layout: TerminalLayout): LayoutBoxes {
  const boxes = new Map<string, Box>();
  const obstacles: Box[] = [];
  for (const e of layout.entries) {
    boxes.set(`en:${e.index}`, entryBox(layout, e));
    if (e.command)
      obstacles.push({
        x: PAD_X,
        y: e.command.y,
        width: e.promptW + e.command.fit.width,
        height: e.command.fit.lines.length * layout.rowH,
      });
    for (const line of e.lines) {
      const box = {
        x: PAD_X + line.indent,
        y: line.y,
        width: Math.max(24, line.fit.width),
        height: Math.max(1, line.fit.lines.length) * layout.rowH,
      };
      boxes.set(`ln:${e.index}/${line.index}`, box);
      if (line.fit.width > 0) obstacles.push(box);
    }
  }
  return { boxes, obstacles };
}
