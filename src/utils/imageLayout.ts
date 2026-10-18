import { fitText, type Fit } from '../../shared/textfit.mjs';
import { SLOTS, sized } from '../fit/slots';
import type { ImageBox, ImageManifest, ImageScene } from '../types';
import type { Box } from './penGeometry';

/** Width over height assumed for a picture whose size is unknown, as in `validate` without images.json. */
const UNKNOWN_ASPECT = 16 / 9;
const CAPTION_GAP = 18;
/** The gentle move in that `kenBurns: true` makes. */
const PUSH_IN: ImageBox = [0.06, 0.06, 0.88, 0.88];
const WHOLE: ImageBox = [0, 0, 1, 1];

export interface ImageLayout {
  /** The box the picture is drawn in, which clips it. */
  frame: Box;
  /** Where the whole picture sits before any pan or zoom: inside the frame for contain, over it for cover. */
  base: Box;
  caption: Fit | null;
  credit: Fit | null;
  /** Top of the caption line, under the frame. */
  captionTop: number;
  labels: Map<string, Fit>;
  /** The picture's own size when known, and how many times that size it is drawn at. */
  natural: { width: number; height: number } | null;
  upscale: number;
}

/** Lays a picture out in a scene's content box: the frame, the picture in it, and the caption and credit under it. */
export function layoutImage(scene: ImageScene, box: { width: number; height: number }, images: ImageManifest | undefined): ImageLayout {
  const caption = scene.caption ? fitText(scene.caption, sized(SLOTS.imageCaption, box.width * 0.8), 'caption') : null;
  const credit = scene.credit ? fitText(scene.credit, sized(SLOTS.imageCredit, box.width * 0.5), 'credit') : null;
  const below = Math.max(caption?.height ?? 0, credit?.height ?? 0);
  const frame = { x: 0, y: 0, width: box.width, height: box.height - (below ? below + CAPTION_GAP : 0) };
  const entry = images && Object.hasOwn(images, scene.src) ? images[scene.src] : undefined;
  const natural = entry ? { width: entry.width, height: entry.height } : null;
  const aspect = natural ? natural.width / natural.height : UNKNOWN_ASPECT;
  const wide = aspect > frame.width / frame.height;
  const containW = wide ? frame.width : frame.height * aspect;
  const coverW = wide ? frame.height * aspect : frame.width;
  const width = scene.fit === 'cover' ? coverW : containW;
  const height = width / aspect;
  const base = { x: (frame.width - width) / 2, y: (frame.height - height) / 2, width, height };
  // Contain shows the picture in the middle of its frame, so the frame shrinks to it.
  const shown = scene.fit === 'cover' ? frame : base;
  const labels = new Map((scene.regions ?? []).flatMap((r, i) => (r.label ? [[r.id, fitText(r.label, sized(SLOTS.regionLabel, 420), `regions[${i}].label`)] as const] : [])));
  return { frame: shown, base, caption, credit, captionTop: shown.y + shown.height + CAPTION_GAP, labels, natural, upscale: natural ? width / natural.width : 1 };
}

/** The box a `kenBurns` end names: a region's, a box as written, or the whole picture. */
function viewOf(scene: ImageScene, at: string | ImageBox | undefined): ImageBox {
  if (Array.isArray(at)) return at;
  return (scene.regions ?? []).find((r) => r.id === at)?.box ?? WHOLE;
}

/** The part of the picture in view `t` (0 to 1) of the way through the scene, as a box of fractions. */
export function viewAt(scene: ImageScene, t: number): ImageBox {
  const kb = scene.kenBurns;
  if (!kb) return WHOLE;
  const [from, to] = kb === true ? [WHOLE, PUSH_IN] : [viewOf(scene, kb.from), viewOf(scene, kb.to)];
  const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  return from.map((v, i) => v + (to[i]! - v) * Math.max(0, Math.min(1, e))) as ImageBox;
}

/**
 * The pan and zoom that bring `view` to fill the place the whole picture had: a scale about the picture's top left
 * and a shift, as CSS applies them, and the same map for a point.
 */
export function cameraFor(layout: ImageLayout, view: ImageBox) {
  const { base } = layout;
  const zoom = Math.min(1 / view[2], 1 / view[3]);
  const centre = { x: base.x + (view[0] + view[2] / 2) * base.width, y: base.y + (view[1] + view[3] / 2) * base.height };
  const mid = { x: base.x + base.width / 2, y: base.y + base.height / 2 };
  const map = (x: number, y: number) => ({ x: mid.x + (x - centre.x) * zoom, y: mid.y + (y - centre.y) * zoom });
  const corner = map(base.x, base.y);
  return { zoom, left: corner.x, top: corner.y, map };
}

/** A region's box on screen through the camera, in the content box. */
export function regionOnScreen(layout: ImageLayout, box: ImageBox, camera: ReturnType<typeof cameraFor>): Box {
  const { base } = layout;
  const a = camera.map(base.x + box[0] * base.width, base.y + box[1] * base.height);
  const b = camera.map(base.x + (box[0] + box[2]) * base.width, base.y + (box[1] + box[3]) * base.height);
  return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
}
