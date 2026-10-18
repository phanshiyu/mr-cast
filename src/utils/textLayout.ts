import { fitBlock, fitText, fitTextAt, measure, type Fit } from '../../shared/textfit.mjs';
import { sceneStates, type SceneState } from '../../shared/state-steps.mjs';
import { TEXT_LEADS } from '../../shared/targets.mjs';
import { contentBox } from '../components/theme';
import type { TextLead, TextScene } from '../types';

type LeadKind = (typeof TEXT_LEADS)[number] & keyof TextLead;

const SANS = { family: 'sans', balanced: true } as const;

/** Vertical rhythm, in px. */
export const GAP = {
  kicker: 22,
  note: 26,
  rule: 30,
  risk: 32,
  riskH: 50,
  list: 44,
  item: 20,
  sideLabel: 18,
  sideList: 26,
  sideItem: 14,
  bottom: 24,
};
export const RULE = { width: 120, height: 7 };
/** The question mark beside a question takes this share of the width. */
export const QUESTION_ROOM = 0.2;
export const SIDE_GUTTER = 64;
/** Items sit after their dot, its gap and the shift a lit item takes. */
const BULLET_INDENT = 12 + 22 + 12;
/** A quote's opening mark, as a multiple of the quote's size, and the gap between it and the quote. */
export const QUOTE_MARK = { scale: 3.2, gap: 0.35 };

/**
 * Each lead's type: its size alone, above items or sides, and in a side; how small it may get; its lines; and the
 * share of the width it takes, up to `maxWidth`. A headline above items is set as the intent card's summary was.
 */
const LEAD_TYPE: Record<
  LeadKind,
  {
    alone: number;
    list: number;
    side: number;
    min: number;
    lines: number;
    weight: number;
    ls: number;
    lh: number;
    width: number;
    maxWidth?: number;
  }
> = {
  headline: {
    alone: 120,
    list: 68,
    side: 60,
    min: 44,
    lines: 3,
    weight: 700,
    ls: -2.5,
    lh: 1.12,
    width: 0.94,
    maxWidth: 1580,
  },
  question: {
    alone: 92,
    list: 64,
    side: 52,
    min: 40,
    lines: 3,
    weight: 700,
    ls: -2,
    lh: 1.1,
    width: 1 - QUESTION_ROOM,
  },
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

/** A figure to count to, and how to write it on the way. */
interface Count {
  value: number;
  decimals: number;
  grouped: boolean;
  prefix: string;
  suffix: string;
}

export interface LeadFit {
  kind: LeadKind;
  /** The whole lead, or a number's leading figure. */
  main: Fit;
  /** A number's words after its figure, drawn smaller beside it. */
  unit: Fit | null;
  /** A number's figure as a value to count up to. */
  count: Count | null;
}

export interface TextBlock {
  kicker: Fit | null;
  lead: LeadFit | null;
  note: Fit | null;
  /** Room a quote's opening mark takes at the left of the block. */
  indent: number;
  height: number;
}

/** A rectangle in the content box, in px. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SideLayout {
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
  /** A question's mark: its glyph size and the box it takes at the right; null for any other lead. */
  mark: { size: number; box: Rect } | null;
  /** Reports text that runs into the question mark; null without one. */
  clear: Fit | null;
}

const leadKind = (o: TextLead): LeadKind | null =>
  (TEXT_LEADS.find((f) => (o as Record<string, unknown>)[f] !== undefined) as LeadKind | undefined) ?? null;

/** "500 hours" as its figure "500" and its words "hours"; "1.5×" stays whole. Null when it does not start with a figure. */
function splitNumber(text: string): { figure: string; unit: string } | null {
  const m = /^\s*([~≈<>+\-−$€£]?\s?\d[\d,.]*\s?[%×x]?)(?:\s+(.+))?$/.exec(text);
  if (!m || /[*`=[\]{}]/.test(m[1]!)) return null;
  return { figure: m[1]!.trim(), unit: (m[2] ?? '').trim() };
}

function countOf(figure: string): Count | null {
  const m = /^([^\d]*)(\d[\d,]*)(\.\d+)?(.*)$/.exec(figure);
  if (!m) return null;
  return {
    prefix: m[1]!,
    value: Number(`${m[2]!.replaceAll(',', '')}${m[3] ?? ''}`),
    decimals: m[3] ? m[3].length - 1 : 0,
    grouped: m[2]!.includes(','),
    suffix: m[4]!,
  };
}

/**
 * A figure partway (`t`, 0 to 1) from `from` to `to`, written as `to` is. Null when the two are not one kind of
 * figure, such as "$4" and "4%", which then swap rather than count.
 */
export function countText(to: Count, t: number, from: Count | null = null): string | null {
  if (from && (from.prefix !== to.prefix || from.suffix !== to.suffix)) return null;
  const start = from?.value ?? 0;
  const v = start + (to.value - start) * t;
  const decimals = Math.max(to.decimals, from?.decimals ?? 0);
  const [int, dec] = v.toFixed(t >= 1 ? to.decimals : decimals).split('.');
  const grouped = to.grouped || from?.grouped ? int!.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : int!;
  return `${to.prefix}${grouped}${dec ? `.${dec}` : ''}${to.suffix}`;
}

type Where = 'alone' | 'list' | 'side';

/** Where each text a state draws came from: the scene's own field, or the step that last set it. */
export type TextPaths = Partial<Record<'t:lead' | 't:note' | 't:kicker', string>>;

function fitLead(kind: LeadKind, text: string, width: number, where: Where, scale: number, path: string): LeadFit {
  const t = LEAD_TYPE[kind];
  const size = Math.max(t.min, Math.round(t[where] * scale));
  const slotWidth = Math.min(width * t.width, t.maxWidth ?? Infinity);
  const letterSpacing = kind === 'headline' || kind === 'question' ? -Math.round(size * 0.022 * 10) / 10 : t.ls;
  const slot = {
    ...SANS,
    balanced: !(kind === 'headline' && where === 'list'),
    name: kind,
    weight: t.weight,
    size,
    min: Math.min(size, t.min),
    lines: t.lines,
    lineHeight: t.lh,
    letterSpacing,
    width: slotWidth,
    fix: `shorten the ${kind}`,
  };
  if (kind === 'number') {
    const split = splitNumber(text);
    if (split) {
      const main = fitText(split.figure, { ...slot, markup: false }, path);
      const unitSlot = {
        ...SANS,
        name: 'number unit',
        weight: 700,
        size: Math.max(32, Math.round(main.size * 0.3)),
        min: 26,
        lines: 2,
        lineHeight: 1.1,
        letterSpacing: -0.5,
        width: Math.max(1, width - main.width - main.size * 0.12),
        fix: 'shorten the words after the number, and move the rest to the note',
      };
      return {
        kind,
        main,
        unit: split.unit ? fitText(split.unit, unitSlot, path) : null,
        count: countOf(split.figure),
      };
    }
  }
  return { kind, main: fitText(text, slot, path), unit: null, count: null };
}

/** The room a quote's mark takes before the quote, at the size its lead starts at. */
const quoteIndent = (where: Where, scale: number) => {
  const size = Math.max(LEAD_TYPE.quote.min, Math.round(LEAD_TYPE.quote[where] * scale));
  return Math.round(
    measure('“', { family: 'sans', weight: 800, size: size * QUOTE_MARK.scale }) + size * QUOTE_MARK.gap,
  );
};

function fitBlockOf(
  o: { kicker?: string; note?: string } & TextLead,
  values: Record<string, unknown> | null,
  paths: TextPaths,
  full: number,
  where: Where,
  scale: number,
  prefix: string,
): TextBlock {
  const kind = leadKind(o);
  const text = (key: string, own: string | undefined) =>
    values && typeof values[key] === 'string' ? (values[key] as string) : own;
  const path = (key: keyof TextPaths, own: string) => paths[key] ?? `${prefix}${own}`;
  const indent = kind === 'quote' ? quoteIndent(where, scale) : 0;
  const width = full - indent;
  const kickerText = text('t:kicker', o.kicker);
  const noteText = text('t:note', o.note);
  const leadText = kind ? text('t:lead', (o as Record<string, string>)[kind]) : undefined;
  const kicker =
    kickerText !== undefined
      ? fitText(
          kickerText,
          {
            ...SANS,
            name: 'kicker',
            weight: 500,
            size: where === 'side' ? 24 : 28,
            min: 20,
            lines: 1,
            lineHeight: 1.2,
            width: kind === 'question' ? width * (1 - QUESTION_ROOM) : width,
            fix: 'shorten the kicker',
          },
          path('t:kicker', 'kicker'),
        )
      : null;
  const lead =
    kind && leadText !== undefined ? fitLead(kind, leadText, width, where, scale, path('t:lead', kind)) : null;
  const nt = NOTE_TYPE[kind ?? 'none'];
  const noteSize = Math.max(26, Math.round((where === 'side' ? nt.side : nt.size) * Math.max(scale, 0.8)));
  const noteWidth = width * (kind === 'question' ? 1 - QUESTION_ROOM : kind === 'quote' ? 0.86 : 0.9);
  const note =
    noteText !== undefined
      ? fitText(
          noteText,
          {
            ...SANS,
            name: 'note',
            weight: nt.weight,
            size: noteSize,
            min: 24,
            lines: nt.lines,
            lineHeight: 1.3,
            width: noteWidth,
            fix: 'shorten the note',
          },
          path('t:note', 'note'),
        )
      : null;
  const leadH = lead ? Math.max(lead.main.height, lead.unit?.height ?? 0) : 0;
  const ruleH = lead?.kind === 'term' && note ? GAP.rule * 2 + RULE.height - GAP.note : 0;
  const height = (kicker ? kicker.height + GAP.kicker : 0) + leadH + (note ? GAP.note + ruleH + note.height : 0);
  return { kicker, lead, note, indent, height };
}

/** Items at one size, from `start` down to `min`: the largest at which each fits its two lines and `room` holds them all. */
function fitItems(
  items: readonly string[],
  width: number,
  start: number,
  min: number,
  gap: number,
  room: number,
  prefix: string,
): Fit[] {
  const slot = {
    ...SANS,
    balanced: false,
    name: 'item',
    weight: 600,
    size: start,
    min,
    lines: 2,
    lineHeight: 1.3,
    width: width - BULLET_INDENT,
    fix: 'shorten the item or split it in two',
  };
  let fits: Fit[] = [];
  for (let size = start; size >= min; size--) {
    fits = items.map((b, i) => fitTextAt(b, slot, `${prefix}items[${i}]`, size));
    if (fits.every((f) => f.fits) && itemsHeight(fits, gap) <= room) break;
  }
  return fits;
}

const itemsHeight = (items: Fit[], gap: number) =>
  items.reduce((s, b) => s + b.height, 0) + Math.max(0, items.length - 1) * gap;

/** The boxes a block's kicker, lead and note take, with its top left at (x, y). */
function blockRects(b: TextBlock, x: number, y: number): Rect[] {
  const y0 = y;
  const out: Rect[] = [];
  if (b.kicker) {
    out.push({ x: x + b.indent, y, width: b.kicker.width, height: b.kicker.height });
    y += b.kicker.height + GAP.kicker;
  }
  if (b.lead) {
    const { main, unit } = b.lead;
    out.push({
      x: x + b.indent,
      y,
      width: main.width + (unit ? main.size * 0.1 + unit.width : 0),
      height: Math.max(main.height, unit?.height ?? 0),
    });
  }
  // A note sits at the block's foot, under a term's rule; a quote's source after its 58px dash.
  if (b.note)
    out.push({
      x: x + b.indent,
      y: y0 + b.height - b.note.height,
      width: b.note.width + (b.lead?.kind === 'quote' ? 58 : 0),
      height: b.note.height,
    });
  return out;
}

const itemRects = (items: Fit[], x: number, y: number, gap: number): Rect[] =>
  items.map((f, i) => ({
    x: x + BULLET_INDENT,
    y: y + itemsHeight(items.slice(0, i), gap) + (i ? gap : 0),
    width: f.width,
    height: f.height,
  }));

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Every box a text card draws text in, as `TextCard` stacks it: centred in `room`, sides `sideW` wide. */
export function textRects(
  l: Pick<TextLayout, 'block' | 'items' | 'sides' | 'height'> & { risk?: string },
  room: number,
  sideW: number,
): Rect[] {
  let y = (room - l.height) / 2;
  const out = blockRects(l.block, 0, y);
  y += l.block.height;
  if (l.risk) {
    out.push({
      x: 0,
      y: y + GAP.risk,
      width: 76 + measure(`${l.risk} risk`, { family: 'sans', weight: 700, size: 24, letterSpacing: 1.5, upper: true }),
      height: GAP.riskH,
    });
    y += GAP.risk + GAP.riskH;
  }
  if (l.items.length) out.push(...itemRects(l.items, 0, y + GAP.list, GAP.item));
  if (l.sides) {
    const top = y + (l.block.height ? GAP.list : 0);
    l.sides.forEach((side, i) => {
      const x = i * (sideW + SIDE_GUTTER * 2);
      let at = top;
      if (side.label) {
        out.push({ x, y: at, width: side.label.width, height: side.label.height });
        at += side.label.height + GAP.sideLabel;
      }
      out.push(...blockRects(side.block, x, at));
      if (side.items.length) out.push(...itemRects(side.items, x, at + side.block.height + GAP.sideList, GAP.sideItem));
    });
  }
  return out;
}

/** The question mark's glyph size and its box in the content box: centred in the right share it keeps, on the card's middle. */
function questionMark(height: number, width: number, boxHeight: number): { size: number; box: Rect } {
  const column = width * QUESTION_ROOM;
  const size = Math.round(
    Math.min(640, height * 1.25 + 160, column / (measure('?', { family: 'sans', weight: 800, size: 100 }) / 100)),
  );
  const glyph = measure('?', { family: 'sans', weight: 800, size });
  return {
    size,
    box: { x: width - column / 2 - glyph / 2, y: boxHeight / 2 - size * 0.4, width: glyph, height: size * 0.8 },
  };
}

/**
 * A text scene's layout at one state: `values` holds the lead, note and kicker a step may have set, and `paths`
 * where each came from. The items shrink first, from 36px (32px past four) to 24px; then the lead and notes shrink
 * a step at a time until everything fits the frame.
 */
export function layoutText(
  scene: TextScene,
  values: Record<string, unknown> | null = null,
  paths: TextPaths = {},
): TextLayout {
  const box = contentBox(false);
  const width = box.width;
  const room = box.height - GAP.bottom;
  const listed = Boolean(scene.items?.length || scene.sides);
  const asked = leadKind(scene) === 'question';
  // A question keeps the right share of the frame for its mark, so what sits under it narrows to clear it.
  const inner = asked ? width * (1 - QUESTION_ROOM) : width;
  let out: TextLayout | null = null;
  for (let scale = 1; scale >= 0.5 - 1e-9; scale -= 0.05) {
    const block = fitBlockOf(scene, values, paths, width, listed ? 'list' : 'alone', scale, '');
    const above = block.height + (scene.risk ? GAP.risk + GAP.riskH : 0);
    const items = scene.items?.length
      ? fitItems(scene.items, inner, scene.items.length > 4 ? 32 : 36, 24, GAP.item, room - above - GAP.list, '')
      : [];
    const sideW = (inner - SIDE_GUTTER * 2) / 2;
    const sides = scene.sides
      ? scene.sides.map((side, i) => {
          const label = side.label
            ? fitText(
                side.label,
                {
                  ...SANS,
                  name: 'side label',
                  weight: 800,
                  size: 24,
                  min: 16,
                  lines: 1,
                  lineHeight: 1.2,
                  letterSpacing: 2.5,
                  upper: true,
                  width: sideW,
                  fix: 'shorten the label',
                },
                `sides[${i}].label`,
              )
            : null;
          const b = fitBlockOf(side, null, {}, sideW, 'side', scale, `sides[${i}].`);
          const its = side.items?.length
            ? fitItems(side.items, sideW, 30, 22, GAP.sideItem, Infinity, `sides[${i}].`)
            : [];
          const height =
            (label ? label.height + GAP.sideLabel : 0) +
            b.height +
            (its.length ? GAP.sideList + itemsHeight(its, GAP.sideItem) : 0);
          return { label, block: b, items: its, height };
        })
      : null;
    const below =
      (items.length ? GAP.list + itemsHeight(items, GAP.item) : 0) +
      (sides ? (block.height ? GAP.list : 0) + Math.max(...sides.map((s) => s.height)) : 0);
    const height = above + below;
    const mark = asked ? questionMark(height, width, box.height) : null;
    const clear = mark
      ? !textRects({ block, items, sides, height, risk: scene.risk }, room, sideW).some((r) => overlaps(r, mark.box))
      : true;
    out = {
      width,
      block,
      items,
      sides,
      height,
      room: fitBlock('', 'text scene', height <= room, 'shorten the lead, the note or the items, or keep fewer items'),
      mark,
      clear: mark
        ? fitBlock(
            '',
            'text beside the question mark',
            clear,
            'shorten the text that runs into the question mark at the right, or use a headline',
          )
        : null,
    };
    if (height <= room && clear) break;
  }
  return out!;
}

/**
 * Every state of a text scene with the text it draws, and where that text was written: a step's `set` from that
 * step on, so a set text that does not fit is reported at the step.
 */
export function textStates(scene: TextScene): (SceneState & { paths: TextPaths })[] {
  const lead = leadKind(scene);
  const fields: [keyof TextPaths, string | null][] = [
    ['t:lead', lead],
    ['t:note', 'note'],
    ['t:kicker', 'kicker'],
  ];
  const paths: TextPaths = {};
  return sceneStates(scene).map((state, k) => {
    const step = k > 0 ? scene.steps?.[k - 1] : undefined;
    for (const [key, field] of fields)
      if (field && step?.set?.[field] !== undefined) paths[key] = `steps[${k - 1}].set.${field}`;
    return { ...state, paths: { ...paths } };
  });
}
