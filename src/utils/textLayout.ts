import { fitBlock, fitText, fitTextAt, type Fit } from '../../shared/textfit.mjs';
import { TEXT_LEADS } from '../../shared/targets.mjs';
import { contentBox } from '../components/theme';
import type { TextLead, TextScene } from '../types';

export type LeadKind = (typeof TEXT_LEADS)[number] & keyof TextLead;

const SANS = { family: 'sans', balanced: true } as const;

/** Vertical rhythm, in px. */
export const GAP = { kicker: 18, note: 26, rule: 30, risk: 32, riskH: 50, list: 44, item: 20, sideLabel: 18, sideNote: 18, sideList: 26, sideItem: 14 };
export const RULE = { width: 120, height: 7 };
/** The question mark beside a question takes this share of the width. */
export const QUESTION_ROOM = 0.2;
export const SIDE_GUTTER = 64;
export const BULLET_INDENT = 12 + 22 + 12;

/** Each lead's type: its size alone, beside a list, and in a side; how small it may get; its lines and width share. */
const LEAD_TYPE: Record<LeadKind, { alone: number; list: number; side: number; min: number; lines: number; weight: number; ls: number; lh: number; width: number }> = {
  headline: { alone: 120, list: 68, side: 60, min: 40, lines: 3, weight: 700, ls: -2.5, lh: 1.08, width: 0.94 },
  question: { alone: 92, list: 64, side: 52, min: 40, lines: 3, weight: 700, ls: -2, lh: 1.1, width: 1 - QUESTION_ROOM },
  number: { alone: 300, list: 190, side: 170, min: 90, lines: 1, weight: 800, ls: -10, lh: 1, width: 1 },
  term: { alone: 140, list: 100, side: 100, min: 52, lines: 2, weight: 800, ls: -4, lh: 1.05, width: 0.94 },
  quote: { alone: 68, list: 54, side: 44, min: 34, lines: 4, weight: 600, ls: -1, lh: 1.22, width: 0.86 },
};

/** The note under each lead: a subtitle, a number's context, a term's meaning, a quote's source. */
const NOTE_TYPE: Record<LeadKind | 'none', { size: number; side: number; weight: number; lines: number }> = {
  headline: { size: 42, side: 32, weight: 500, lines: 3 },
  question: { size: 42, side: 32, weight: 500, lines: 3 },
  number: { size: 50, side: 34, weight: 500, lines: 2 },
  term: { size: 54, side: 40, weight: 500, lines: 3 },
  quote: { size: 34, side: 28, weight: 500, lines: 2 },
  none: { size: 42, side: 32, weight: 500, lines: 3 },
};

export interface LeadFit {
  kind: LeadKind;
  /** The whole lead, or a number's leading figure. */
  main: Fit;
  /** A number's words after its figure, drawn smaller beside it. */
  unit: Fit | null;
  /** A number's figure as a value to count up to, and how to write it. */
  count: { value: number; decimals: number; grouped: boolean; prefix: string; suffix: string } | null;
}

export interface TextBlock {
  kicker: Fit | null;
  lead: LeadFit | null;
  note: Fit | null;
  height: number;
}

export interface SideLayout {
  label: Fit | null;
  block: TextBlock;
  items: Fit[];
  height: number;
}

export interface TextLayout {
  width: number;
  block: TextBlock;
  items: Fit[];
  sides: SideLayout[] | null;
  height: number;
  room: Fit;
}

export const leadKind = (o: TextLead): LeadKind | null => (TEXT_LEADS.find((f) => (o as Record<string, unknown>)[f] !== undefined) as LeadKind | undefined) ?? null;

/** "500 hours" as its figure "500" and its words "hours"; "1.5×" stays whole. Null when it does not start with a figure. */
export function splitNumber(text: string): { figure: string; unit: string } | null {
  const m = /^\s*([~≈<>+\-−$€£]?\s?\d[\d,.]*\s?[%×x]?)(?:\s+(.+))?$/.exec(text);
  if (!m || /[*`=[\]{}]/.test(m[1]!)) return null;
  return { figure: m[1]!.trim(), unit: (m[2] ?? '').trim() };
}

function countOf(figure: string): LeadFit['count'] {
  const m = /^([^\d]*)(\d[\d,]*)(\.\d+)?(.*)$/.exec(figure);
  if (!m) return null;
  return { prefix: m[1]!, value: Number(`${m[2]!.replaceAll(',', '')}${m[3] ?? ''}`), decimals: m[3] ? m[3].length - 1 : 0, grouped: m[2]!.includes(','), suffix: m[4]! };
}

/** A figure partway through counting up, written as the figure is. */
export function countText(count: NonNullable<LeadFit['count']>, t: number): string {
  const v = count.value * t;
  const fixed = v.toFixed(count.decimals);
  const [int, dec] = fixed.split('.');
  const grouped = count.grouped ? int!.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : int!;
  return `${count.prefix}${grouped}${dec ? `.${dec}` : ''}${count.suffix}`;
}

type Where = 'alone' | 'list' | 'side';

function fitLead(kind: LeadKind, text: string, width: number, where: Where, scale: number, path: string): LeadFit {
  const t = LEAD_TYPE[kind];
  const size = Math.max(t.min, Math.round(t[where] * scale));
  const slot = { ...SANS, name: kind, weight: t.weight, size, min: Math.min(size, t.min), lines: t.lines, lineHeight: t.lh, letterSpacing: kind === 'headline' || kind === 'question' ? -Math.round(size * 0.022 * 10) / 10 : t.ls, width: width * t.width, fix: `shorten the ${kind}` };
  if (kind === 'number') {
    const split = splitNumber(text);
    if (split) {
      // Digits count up in tabular figures, so the figure is measured as zeros of the same length.
      const main = fitText(split.figure, { ...slot, markup: false, balanced: false }, path);
      const unitSlot = { ...SANS, name: 'number unit', weight: 700, size: Math.max(32, Math.round(main.size * 0.3)), min: 26, lines: 2, lineHeight: 1.1, letterSpacing: -0.5, width: Math.max(1, width - main.width - main.size * 0.12), fix: 'shorten the words after the number, and move the rest to the note' };
      return { kind, main, unit: split.unit ? fitText(split.unit, unitSlot, path) : null, count: countOf(split.figure) };
    }
  }
  return { kind, main: fitText(text, slot, path), unit: null, count: null };
}

function fitBlockOf(o: { kicker?: string; note?: string } & TextLead, values: Record<string, unknown> | null, width: number, where: Where, scale: number, prefix: string): TextBlock {
  const kind = leadKind(o);
  const text = (key: string, own: string | undefined) => (values && typeof values[key] === 'string' ? (values[key] as string) : own);
  const kickerText = text('t:kicker', o.kicker);
  const noteText = text('t:note', o.note);
  const leadText = kind ? text('t:lead', (o as Record<string, string>)[kind]) : undefined;
  const kicker = kickerText !== undefined ? fitText(kickerText, { ...SANS, name: 'kicker', weight: 500, size: where === 'side' ? 24 : 30, min: 20, lines: 1, lineHeight: 1.25, width, fix: 'shorten the kicker' }, `${prefix}kicker`) : null;
  const lead = kind && leadText !== undefined ? fitLead(kind, leadText, width, where, scale, `${prefix}${kind}`) : null;
  const nt = NOTE_TYPE[kind ?? 'none'];
  const noteSize = Math.max(26, Math.round((where === 'side' ? nt.side : nt.size) * Math.max(scale, 0.8)));
  const noteWidth = width * (kind === 'question' ? 1 - QUESTION_ROOM : kind === 'quote' ? 0.86 : 0.9);
  const note = noteText !== undefined ? fitText(noteText, { ...SANS, name: 'note', weight: nt.weight, size: noteSize, min: 24, lines: nt.lines, lineHeight: 1.3, width: noteWidth, fix: 'shorten the note' }, `${prefix}note`) : null;
  const leadH = lead ? Math.max(lead.main.height, lead.unit?.height ?? 0) : 0;
  const ruleH = lead?.kind === 'term' && note ? GAP.rule * 2 + RULE.height - GAP.note : 0;
  const height = (kicker ? kicker.height + GAP.kicker : 0) + leadH + (note ? GAP.note + ruleH + note.height : 0);
  return { kicker, lead, note, height };
}

function fitItems(items: readonly string[], width: number, start: number, min: number, prefix: string): Fit[] {
  const slot = { ...SANS, balanced: false, name: 'item', weight: 600, size: start, min, lines: 2, lineHeight: 1.3, width: width - BULLET_INDENT, fix: 'shorten the item or split it in two' };
  for (let size = start; size >= min; size--) {
    const fits = items.map((b, i) => fitTextAt(b, slot, `${prefix}items[${i}]`, size));
    if (fits.every((f) => f.fits) || size === min) return fits;
  }
  return [];
}

const itemsHeight = (items: Fit[], gap: number) => items.reduce((s, b) => s + b.height, 0) + Math.max(0, items.length - 1) * gap;

/**
 * A text scene's layout at one state: `values` holds the lead, note and kicker a step may have set. The lead
 * starts at its largest size and the whole scene shrinks a step at a time until it fits the frame.
 */
export function layoutText(scene: TextScene, values: Record<string, unknown> | null = null): TextLayout {
  const box = contentBox(false);
  const width = box.width;
  const listed = Boolean(scene.items?.length || scene.sides);
  let out: TextLayout | null = null;
  for (let scale = 1; scale >= 0.5 - 1e-9; scale -= 0.05) {
    const block = fitBlockOf(scene, values, width, listed ? 'list' : 'alone', scale, '');
    const items = scene.items?.length ? fitItems(scene.items, width, scene.items.length > 4 ? 32 : 36, 24, '') : [];
    const sideW = (width - SIDE_GUTTER * 2) / 2;
    const sides = scene.sides
      ? scene.sides.map((side, i) => {
          const label = side.label ? fitText(side.label, { ...SANS, name: 'side label', weight: 800, size: 24, min: 16, lines: 1, lineHeight: 1.2, letterSpacing: 2.5, upper: true, width: sideW, fix: 'shorten the label' }, `sides[${i}].label`) : null;
          const b = fitBlockOf(side, null, sideW, 'side', scale, `sides[${i}].`);
          const its = side.items?.length ? fitItems(side.items, sideW, 30, 22, `sides[${i}].`) : [];
          const height = (label ? label.height + GAP.sideLabel : 0) + b.height + (its.length ? GAP.sideList + itemsHeight(its, GAP.sideItem) : 0);
          return { label, block: b, items: its, height };
        })
      : null;
    const below = (scene.risk ? GAP.risk + GAP.riskH : 0) + (items.length ? GAP.list + itemsHeight(items, GAP.item) : 0) + (sides ? GAP.list + Math.max(...sides.map((s) => s.height)) : 0);
    const height = block.height + below;
    out = { width, block, items, sides, height, room: fitBlock('', 'text scene', height <= box.height, 'shorten the lead, the note or the items') };
    if (height <= box.height) break;
  }
  return out!;
}
