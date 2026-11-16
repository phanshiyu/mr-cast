import type { ScenePart, ShownFile } from '../../shared/files.mjs';
import { fitBlock, fitText, type Fit } from '../../shared/textfit.mjs';
import { SLOTS, sized } from '../fit/slots';
import type { PartWeight } from '../types';
import type { Box, LayoutBoxes } from './penGeometry';

/** Padding inside a part's card. */
const CARD_PAD = 22;
const GAP_Y = 24;
/** Room between columns that holds the links; without links the cards sit closer. */
const LINK_GAP = 76;
const PLAIN_GAP = 28;
const MIN_CARD_W = 340;
const MAX_CARD_W = 600;
/** The most rows of cards; past it the cards fill a grid instead of layers. */
const MAX_LAYER_ROWS = 2;
/** Heights of a card's rows, in px: the tags, the counts, each listed file and the "+ N more" line. */
const TAGS_H = 22;
const STATS_H = 26;
const FILE_ROW_H = 26;
const BLOCK_GAP = 10;
/** Most files a card lists under it, by weight; a card with less room lists fewer. */
const LISTED: Record<PartWeight, number> = { core: 3, support: 3, routine: 2 };
/** The name's largest size by weight: the part that matters is the largest. */
const NAME_SIZE: Record<PartWeight, number> = { core: 30, support: 27, routine: 24 };

export interface PlacedFile {
  file: ShownFile;
  name: Fit;
  /** Top of its row, from the card's top. */
  y: number;
}

export interface PlacedCard {
  part: ScenePart;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The weight word and, for a part that holds a place to check, "check". */
  tags: string[];
  name: Fit;
  does: Fit | null;
  /** What the part's first check item says is at risk, with "+ N more", drawn quietly under `does`. */
  risk: Fit | null;
  /** Tops of the name, the `does` line (just under the name), the risk line and the counts (level across cards), from the card's top. */
  nameY: number;
  doesY: number;
  riskY: number;
  statsY: number;
  /** The listed files, largest first, and how many more the part holds. */
  files: PlacedFile[];
  more: number;
  /** Reports a card too short for what it must hold. */
  room: Fit;
}

export interface PartLink {
  from: number;
  to: number;
  /** An SVG path from the earlier card to the later one. */
  path: string;
  /** The arrowhead at its end: a triangle's three points. */
  head: string;
}

export interface PartsLayout {
  cards: PlacedCard[];
  links: PartLink[];
  /** The map's size in layout units, cards and gaps. */
  width: number;
  height: number;
}

const size = (f: ShownFile) => (f.additions ?? 0) + (f.deletions ?? 0);

/** Where each part sits: a column and a row. Layers by `after` when the links make a few short columns, else a grid in order. */
function place(parts: readonly ScenePart[], width: number) {
  const index = new Map(parts.map((p, i) => [p.name, i]));
  const before = parts.map((p, i) =>
    [...new Set(p.after ?? [])].flatMap((n) => (index.has(n) && index.get(n) !== i ? [index.get(n)!] : [])),
  );
  const linked = before.some((b) => b.length);
  const maxCols = Math.max(1, Math.floor((width + LINK_GAP) / (MIN_CARD_W + LINK_GAP)));
  // A link back to a part that already follows this one is a loop: it is ignored for the order, and still drawn.
  const depth: number[] = [];
  const visiting = new Set<number>();
  const depthOf = (i: number): number => {
    if (depth[i] !== undefined) return depth[i]!;
    visiting.add(i);
    const d = Math.max(-1, ...before[i]!.filter((j) => !visiting.has(j)).map(depthOf)) + 1;
    visiting.delete(i);
    return (depth[i] = d);
  };
  parts.forEach((_, i) => depthOf(i));
  // A part no link touches goes to the emptiest column, the first on a tie, or to a new one when every column is full.
  const alone = parts.map((_, i) => linked && !before[i]!.length && !before.some((b) => b.includes(i)));
  const chained = Math.max(0, ...depth.filter((_, i) => !alone[i])) + 1;
  const sizes = Array.from({ length: chained }, (_, c) => depth.filter((d, i) => !alone[i] && d === c).length);
  parts.forEach((_, i) => {
    if (!alone[i]) return;
    const c = sizes.indexOf(Math.min(...sizes));
    const into = sizes[c]! >= MAX_LAYER_ROWS ? sizes.length : c;
    sizes[into] = (sizes[into] ?? 0) + 1;
    depth[i] = into;
  });
  const columns = Math.max(0, ...depth) + 1;
  const layers = Array.from({ length: columns }, (_, c) => parts.flatMap((_p, i) => (depth[i] === c ? [i] : [])));
  if (linked && columns <= maxCols && Math.max(...layers.map((l) => l.length)) <= MAX_LAYER_ROWS) {
    const row = new Map<number, number>();
    layers.forEach((layer, c) => {
      // Parts follow the average row of the parts they follow, so links cross less.
      const at = (i: number) => {
        const rows = before[i]!.filter((j) => depth[j]! < c).map((j) => row.get(j)!);
        return alone[i] ? Infinity : rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : i;
      };
      layer.sort((a, b) => (at(a) === at(b) ? a - b : at(a) < at(b) ? -1 : 1)).forEach((i, r) => row.set(i, r));
    });
    return {
      linked,
      layered: true,
      columns,
      cell: parts.map((_, i) => ({ col: depth[i]!, row: row.get(i)! })),
      before,
    };
  }
  const order = linked ? parts.map((_, i) => i).sort((a, b) => depth[a]! - depth[b]! || a - b) : parts.map((_, i) => i);
  const n = parts.length;
  const cols = Math.min(maxCols, n <= 3 ? n : n === 4 ? 2 : n <= 6 ? 3 : 4);
  const cell = parts.map(() => ({ col: 0, row: 0 }));
  order.forEach((i, k) => (cell[i] = { col: k % cols, row: Math.floor(k / cols) }));
  return { linked, layered: false, columns: cols, cell, before };
}

/** Counts "12 files, +40 −3" take one line; the name, `does` line and files take what the card's text needs. */
function build(
  part: ScenePart,
  w: number,
  names: readonly string[],
  hasDoes: boolean,
): Pick<PlacedCard, 'tags' | 'name' | 'does' | 'risk' | 'files' | 'more'> & { all: PlacedFile[] } {
  const inner = w - 2 * CARD_PAD;
  const ranked = [...part.files].sort((a, b) => size(b) - size(a));
  const all = ranked.map((file, k): PlacedFile => {
    const base = file.path.split('/').pop()!;
    const shared = names.filter((n) => n === base).length > 1;
    return {
      file,
      y: k,
      name: fitText(
        shared ? file.path : base,
        sized(SLOTS.partCardFile, inner - 26),
        `parts[${JSON.stringify(part.name)}].files[${JSON.stringify(file.path)}]`,
      ),
    };
  });
  return {
    tags: [part.weight, ...(part.check ? ['check'] : [])],
    name: fitText(
      part.name,
      { ...sized(SLOTS.partCardName, inner), size: NAME_SIZE[part.weight] },
      `parts[${JSON.stringify(part.name)}]`,
    ),
    does: hasDoes
      ? fitText(part.does!, sized(SLOTS.partCardDoes, inner), `parts[${JSON.stringify(part.name)}].does`)
      : null,
    risk: part.risk
      ? fitText(
          `${part.risk}${part.riskMore ? ` + ${part.riskMore} more` : ''}`,
          sized(SLOTS.partCardRisk, inner),
          `parts[${JSON.stringify(part.name)}].risk`,
        )
      : null,
    files: [],
    more: 0,
    all,
  };
}

/** The height a card needs to hold `listed` files under its text. */
function need(card: { nameH: number; doesH: number; riskH: number }, listed: number, more: boolean): number {
  const files = listed + (more ? 1 : 0);
  return (
    2 * CARD_PAD +
    TAGS_H +
    BLOCK_GAP +
    card.nameH +
    (card.doesH ? BLOCK_GAP / 2 + card.doesH : 0) +
    (card.riskH ? BLOCK_GAP / 2 + card.riskH : 0) +
    BLOCK_GAP +
    STATS_H +
    (files ? BLOCK_GAP + files * FILE_ROW_H : 0)
  );
}

/**
 * The map of the change: one card per part, in columns by `after` (a part sits after the parts it names, with a link
 * from each) or, with no links or too many, in a grid in order, core first. A card holds the part's name and weight,
 * what it does, its counts and its largest files; every card is as tall as the fullest needs, up to the room there is.
 */
export function layoutParts(parts: readonly ScenePart[], width: number, height: number): PartsLayout {
  const where = place(parts, width);
  const rows = Math.max(...where.cell.map((c) => c.row)) + 1;
  const gap = where.linked ? LINK_GAP : PLAIN_GAP;
  const w = Math.min(MAX_CARD_W, Math.floor((width - (where.columns - 1) * gap) / where.columns));
  const names = parts.flatMap((p) => p.files.map((f) => f.path.split('/').pop()!));
  const built = parts.map((p) => build(p, w, names, Boolean(p.does)));
  // Every card gives its name and `does` line the room the tallest needs, so the counts and files line up across cards.
  const nameH = Math.max(...built.map((b) => b.name.height));
  const doesH = Math.max(0, ...built.map((b) => b.does?.height ?? 0));
  const riskH = Math.max(0, ...built.map((b) => b.risk?.height ?? 0));
  const cap = (i: number) => Math.min(LISTED[parts[i]!.weight], parts[i]!.files.length);
  const wanted = Math.max(
    ...parts.map((_, i) => need({ nameH, doesH, riskH }, cap(i), parts[i]!.files.length > cap(i))),
  );
  const h = Math.floor(Math.min(wanted, (height - (rows - 1) * GAP_Y) / rows));
  const totalW = where.columns * w + (where.columns - 1) * gap;
  const totalH = rows * h + (rows - 1) * GAP_Y;
  const cards = parts.map((part, i): PlacedCard => {
    const b = built[i]!;
    let listed = cap(i);
    while (listed > 0 && need({ nameH, doesH, riskH }, listed, part.files.length > listed) > h + 1) listed--;
    const more = part.files.length - listed;
    const nameY = CARD_PAD + TAGS_H + BLOCK_GAP;
    const doesY = nameY + b.name.height + BLOCK_GAP / 2;
    const riskY = nameY + nameH + (doesH ? BLOCK_GAP / 2 + doesH : 0) + BLOCK_GAP / 2;
    const statsY =
      nameY + nameH + (doesH ? BLOCK_GAP / 2 + doesH : 0) + (riskH ? BLOCK_GAP / 2 + riskH : 0) + BLOCK_GAP;
    const filesY = statsY + STATS_H + BLOCK_GAP;
    const { col, row } = where.cell[i]!;
    const fits = need({ nameH, doesH, riskH }, listed, more > 0) <= h + 1;
    return {
      part,
      x: col * (w + gap),
      y: row * (h + GAP_Y),
      w,
      h,
      tags: b.tags,
      name: b.name,
      does: b.does,
      risk: b.risk,
      nameY,
      doesY,
      riskY,
      statsY,
      files: b.all.slice(0, listed).map((f, k) => ({ ...f, y: filesY + k * FILE_ROW_H })),
      more,
      room: fitBlock(
        `parts[${JSON.stringify(part.name)}]`,
        'part card',
        fits,
        'there are too many parts for the room: merge parts, or shorten the names and `does` lines',
      ),
    };
  });
  // A link that another path already implies (A to C when A leads to B and B to C) is left out.
  const leads = (f: number, m: number, seen = new Set<number>()): boolean =>
    where.before[m]!.some((x) => x === f || (!seen.has(x) && (seen.add(x), leads(f, x, seen))));
  const links = where.before.flatMap((from, to) =>
    [...new Set(from)]
      .filter((f) => f !== to && !from.some((m) => m !== f && m !== to && leads(f, m)))
      .map((f) => link(cards, f, to, where.layered)),
  );
  return { cards, links, width: totalW, height: totalH };
}

const HEAD = 9;

/** An elbow from the earlier card to the later one, leaving the right edge for the next column, else the bottom edge. */
function link(cards: readonly PlacedCard[], fromIndex: number, toIndex: number, layered: boolean): PartLink {
  const a = cards[fromIndex]!;
  const b = cards[toIndex]!;
  const across = layered ? a.x !== b.x : a.x !== b.x && a.y === b.y;
  if (across && b.x > a.x) {
    const [sx, sy, ex, ey] = [a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2];
    const mx = ex - (ex - sx > 2 * LINK_GAP ? LINK_GAP : ex - sx) / 2;
    return {
      from: fromIndex,
      to: toIndex,
      path: `M${sx} ${sy} H${mx} V${ey} H${ex - HEAD}`,
      head: `${ex},${ey} ${ex - HEAD},${ey - HEAD / 2 - 1} ${ex - HEAD},${ey + HEAD / 2 + 1}`,
    };
  }
  const [sx, sy, ex, ey] = [a.x + a.w / 2, a.y + a.h, b.x + b.w / 2, b.y];
  const my = sy + (ey - sy) / 2;
  return {
    from: fromIndex,
    to: toIndex,
    path: `M${sx} ${sy} V${my} H${ex} V${ey - HEAD}`,
    head: `${ex},${ey} ${ex - HEAD / 2 - 1},${ey - HEAD} ${ex + HEAD / 2 + 1},${ey - HEAD}`,
  };
}

/** The box of each part's card by its key in shared/targets.mjs, and of each file its card lists; a file it does not list is its card. */
export function partsBoxes(layout: PartsLayout): LayoutBoxes {
  const boxes = new Map<string, Box>();
  const obstacles: Box[] = [];
  for (const card of layout.cards) {
    const box = { x: card.x, y: card.y, width: card.w, height: card.h };
    boxes.set(`p:${card.part.name}`, box);
    obstacles.push(box);
    for (const f of card.part.files) boxes.set(`f:${f.path}`, box);
    for (const f of card.files)
      boxes.set(`f:${f.file.path}`, {
        x: card.x + CARD_PAD,
        y: card.y + f.y,
        width: card.w - 2 * CARD_PAD,
        height: FILE_ROW_H,
      });
  }
  return { boxes, obstacles };
}
