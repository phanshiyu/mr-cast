import { layerRoute } from '../../shared/layers.mjs';
import { fitBlock, fitText, type Fit, type Slot } from '../../shared/textfit.mjs';
import { SLOTS, sized } from '../fit/slots';
import type { Layer, LayerItem, LayersScene } from '../types';
import { cardTexts, type CardText } from './nodeText';
import type { Box, LayoutBoxes, Pt } from './penGeometry';

export const BAND_GAP = 16;
const BAND_MAX_H = 180;
const BAND_MIN_H = 72;
export const PAD_X = 28;
const PAD_Y = 14;
const LABEL_MIN_W = 260;
const LABEL_MAX_W = 440;
/** A band with no items in the scene keeps its label to this width, so it reads as a label and not a line of prose. */
const LABEL_ALONE_W = 900;
const LABEL_ALONE_MIN_W = 760;
export const CAPTION_GAP = 4;
const ITEM_GAP = 20;
const ITEM_MAX_W = 300;
const ITEM_MAX_H = 84;
/** From the bands' right edge to the lane the token goes down, then to the lane it comes back up. */
const RAIL_GAP = 34;
const LANE_GAP = 28;
export const DOT_R = 11;
/** From a lane to the token's pill. */
export const PILL_GAP = DOT_R + 10;
export const PILL_PAD_X = 14;
export const PILL_H = 40;
const PILL_MAX_W = 340;

export interface PlacedItem {
  item: LayerItem;
  x: number;
  y: number;
  w: number;
  h: number;
  text: CardText;
}

export interface PlacedLayer {
  layer: Layer;
  index: number;
  y: number;
  h: number;
  label: Fit;
  caption: Fit | null;
  /** Top of the label, so the label and caption sit centred in the band. */
  textY: number;
  /** Whether the label and caption together fit the band's height. */
  room: Fit;
  items: PlacedItem[];
}

/** The column right of the bands where the request token travels, and the texts it carries. */
export interface Rail {
  downX: number;
  upX: number;
  pillW: number;
  label: Fit | null;
  reply: Fit | null;
}

export interface LayersLayout {
  width: number;
  height: number;
  bandW: number;
  labelW: number;
  layers: PlacedLayer[];
  rail: Rail | null;
  /**
   * Where the token stops for each layer and item key ("l:id" or "i:id"), level with its wire's end on
   * the down lane. An item's wire leaves the bottom of its card and runs under the cards beside it, so it
   * never passes behind another item; a layer's wire leaves the band's right edge.
   */
  wires: Map<string, Pt[]>;
  yOf: Map<string, number>;
  /** The box of each layer and item, by item key. */
  boxes: Map<string, Box>;
}

const natural = (text: string, slot: Slot) => fitText(text, sized(slot, Infinity), '').width;

function fitRail(scene: LayersScene, bandsRight: number): Rail | null {
  const path = scene.path;
  if (!path) return null;
  const reply = path.skip?.reply ?? (path.return ? path.reply : undefined);
  const texts = [path.label, reply].filter((t): t is string => typeof t === 'string');
  const wanted = Math.max(0, ...texts.map((t) => natural(t, SLOTS.tokenLabel)));
  const pillW = Math.min(PILL_MAX_W, Math.ceil(wanted) + 2 * PILL_PAD_X);
  const fit = (text: string | undefined, at: string) => (text ? fitText(text, sized(SLOTS.tokenLabel, pillW - 2 * PILL_PAD_X), at) : null);
  const downX = bandsRight + RAIL_GAP;
  return { downX, upX: downX + LANE_GAP, pillW, label: fit(path.label, 'path.label'), reply: fit(reply, path.skip ? 'path.skip.reply' : 'path.reply') };
}

/** Width the rail takes right of the bands. */
const railWidth = (rail: Rail) => RAIL_GAP + LANE_GAP + PILL_GAP + rail.pillW + 6;

export function layoutLayers(scene: LayersScene, box: { width: number; height: number }): LayersLayout {
  const n = scene.layers.length;
  const h = Math.max(BAND_MIN_H, Math.min(BAND_MAX_H, (box.height - (n - 1) * BAND_GAP) / n));
  const probe = fitRail(scene, 0);
  const railW = probe ? railWidth(probe) : 0;
  const most = Math.max(0, ...scene.layers.map((l) => l.items?.length ?? 0));
  // Tall bands, as with three layers, take larger text, so the stack reads from across the room.
  const big = h >= 140;
  const labelSlot = { ...SLOTS.layerLabel, size: big ? 36 : SLOTS.layerLabel.size, lines: h >= 124 ? 2 : 1 };
  const captionSlot = { ...SLOTS.layerCaption, size: big ? 23 : SLOTS.layerCaption.size, lines: big ? 2 : 1 };
  const wanted = Math.ceil(Math.max(...scene.layers.map((l) => Math.max(natural(l.label, labelSlot), l.caption ? natural(l.caption, captionSlot) : 0)))) + 2 * PAD_X;
  const labelW = most ? Math.min(LABEL_MAX_W, Math.max(LABEL_MIN_W, wanted + 8)) : Math.min(box.width - railW, Math.max(LABEL_ALONE_MIN_W, wanted + 40), LABEL_ALONE_W);
  // Bands are as wide as their content, so a stack of few items or none sits centred instead of trailing empty space.
  const bandW = Math.min(box.width - railW, most ? labelW + most * ITEM_MAX_W + (most - 1) * ITEM_GAP + PAD_X : labelW);
  const rail = fitRail(scene, bandW);
  const itemW = most ? Math.min(ITEM_MAX_W, (bandW - labelW - PAD_X - (most - 1) * ITEM_GAP) / most) : 0;
  const itemH = Math.min(ITEM_MAX_H, h - 2 * PAD_Y);
  const all = scene.layers.flatMap((l, i) => (l.items ?? []).map((item, j) => ({ item, path: `layers[${i}].items[${j}]` })));
  const texts = cardTexts(
    all.map((a) => a.item),
    itemW,
    itemH,
    'compact',
    (i) => all[i]!.path,
  );

  const wires = new Map<string, Pt[]>();
  const boxes = new Map<string, Box>();
  const downX = rail?.downX ?? bandW;
  const layers: PlacedLayer[] = scene.layers.map((layer, index) => {
    const y = index * (h + BAND_GAP);
    const textW = labelW - 2 * PAD_X;
    const label = fitText(layer.label, sized(labelSlot, textW), `layers[${index}].label`);
    const caption = layer.caption ? fitText(layer.caption, sized(captionSlot, textW), `layers[${index}].caption`) : null;
    const textH = label.height + (caption ? CAPTION_GAP + caption.height : 0);
    const room = fitBlock(`layers[${index}]`, 'band', textH <= h - 2 * PAD_Y + 2, 'shorten the label or caption, or use fewer layers so each band is taller');
    const items = (layer.items ?? []).map((item, j): PlacedItem => ({ item, x: labelW + j * (itemW + ITEM_GAP), y: y + (h - itemH) / 2, w: itemW, h: itemH, text: texts.get(item.id)! }));
    wires.set(`l:${layer.id}`, [
      { x: bandW, y: y + h / 2 },
      { x: downX, y: y + h / 2 },
    ]);
    boxes.set(`l:${layer.id}`, { x: 0, y, width: bandW, height: h });
    for (const it of items) {
      const below = it.y + it.h;
      const floor = below + (y + h - below) / 2;
      wires.set(`i:${it.item.id}`, [
        { x: it.x + it.w / 2, y: below },
        { x: it.x + it.w / 2, y: floor },
        { x: downX, y: floor },
      ]);
      boxes.set(`i:${it.item.id}`, { x: it.x, y: it.y, width: it.w, height: it.h });
    }
    return { layer, index, y, h, label, caption, textY: y + (h - textH) / 2, room, items };
  });
  const yOf = new Map([...wires].map(([key, points]) => [key, points[points.length - 1]!.y]));
  const height = n * h + (n - 1) * BAND_GAP;
  return { width: bandW + railW, height, bandW, labelW, layers, rail, wires, yOf, boxes };
}

/** Where the token is at a route position: on the down or up lane, level with its stop's band. */
export function tokenPoint(scene: LayersScene, layout: LayersLayout, p: number): { x: number; y: number } {
  const { visits } = layerRoute(scene);
  const rail = layout.rail!;
  const at = (i: number) => {
    const v = visits[Math.max(0, Math.min(visits.length - 1, i))]!;
    return { x: v.leg === 'down' ? rail.downX : rail.upX, y: layout.yOf.get(v.key)! };
  };
  if (p <= 0) {
    const first = at(0);
    return { x: first.x, y: first.y + 60 * p };
  }
  const i = Math.floor(p);
  const a = at(i);
  const b = at(i + 1);
  const t = p - i;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * The box of each item a step can focus, by its key in shared/targets.mjs, in layout units: a layer's band
 * and an item's card. A note keeps off the cards, the labels and the rail, and may sit in a band's free space.
 */
export function layersBoxes(layout: LayersLayout): LayoutBoxes {
  const labels = layout.layers.map((l): Box => ({ x: PAD_X, y: l.textY, width: Math.max(l.label.width, l.caption?.width ?? 0), height: l.label.height + (l.caption ? CAPTION_GAP + l.caption.height : 0) }));
  const cards = layout.layers.flatMap((l) => l.items.map((it): Box => ({ x: it.x, y: it.y, width: it.w, height: it.h })));
  const rail = layout.rail ? [{ x: layout.bandW, y: 0, width: layout.width - layout.bandW, height: layout.height }] : [];
  return { boxes: layout.boxes, obstacles: [...labels, ...cards, ...rail] };
}


/** The scale a layer stack draws at in `box`: shrunk only to fit its height. */
export const layersScale = (layout: LayersLayout, box: { width: number; height: number }): number => Math.min(1, box.height / layout.height);
