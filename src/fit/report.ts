import { sceneFiles } from '../../shared/files.mjs';
import type { Fit } from '../../shared/textfit.mjs';
import type { HunkMap, ImageManifest, Scene, Storyboard } from '../types';
import { layoutImage } from '../utils/imageLayout';
import { sceneDurationInFrames, sceneSegments } from '../../shared/timing.mjs';
import { contentBox } from '../components/theme';
import { calloutFits } from './callout';
import { fitSceneGraph, graphAreas } from '../utils/graphLayout';
import { layoutArray } from '../utils/arrayLayout';
import { layoutChart } from '../utils/chartLayout';
import { layoutBarRows, layoutPie } from '../utils/chartShapes';
import { layoutCompare } from '../utils/compareLayout';
import { layoutCode } from '../utils/codeLayout';
import { erScale, layoutEr } from '../utils/erLayout';
import { layoutFiles, treeRows } from '../utils/filesLayout';
import { layoutFlow } from '../utils/flowLayout';
import { layoutText, textStates } from '../utils/textLayout';
import { layersScale, layoutLayers } from '../utils/layersLayout';
import { layoutMemory } from '../utils/memoryLayout';
import { layoutSequence, sequenceScale } from '../utils/sequenceLayout';
import { layoutState, stateScale } from '../utils/stateLayout';
import { layoutTableStates, stateRows } from '../utils/tableLayout';
import { sceneStates } from '../../shared/state-steps.mjs';
import { layoutReview } from '../utils/reviewLayout';
import { layoutReading } from '../utils/readingLayout';
import { readingOrder } from '../../shared/reading.mjs';
import { layoutTests } from '../utils/testsLayout';
import { layoutTerminal } from '../utils/terminalLayout';
import { layoutTimeline, timelineScale } from '../utils/timelineLayout';
import { headerBox, shellFits } from './shell';
import { sourceFit } from './source';
import { arrayTargets, graphTargets, imageTargets, memoryTargets, stateTargets, svgTargets, tableTargets, testsTargets } from '../utils/sceneTargets';
import type { Box, MarkTargets } from '../utils/penGeometry';

/** A layout the scene draws at `scale`, so each text in it lands on screen at its fitted size times the scale. */
class Scaled {
  constructor(readonly name: string, readonly scale: number, readonly layout: unknown) {}
}

/** Each table state, at the scale it draws at. */
const scaledTables = (name: string, tables: readonly { scale: number }[]) => tables.map((t) => new Scaled(name, t.scale, t));

/** Everything a scene type fits its text into, given its scene: the layouts its component draws from. */
type SceneFits = { [T in Scene['type']]: (scene: Extract<Scene, { type: T }>, storyboard: Storyboard, hunks: HunkMap, images: ImageManifest) => unknown };

const SCENE_FITS: SceneFits = {
  text: (scene) => textStates(scene).map((state) => layoutText(scene, state.values, state.paths)),
  graph: (scene) => {
    const { full, graphBox, tableW } = graphAreas(scene);
    const states = sceneStates(scene);
    const { layout, scale } = fitSceneGraph(scene, states, graphBox);
    const tables = scene.table ? layoutTableStates(scene.table.columns, stateRows(scene.table.columns, scene.table.rows, states), tableW, full.height, 'table.') : [];
    return [new Scaled('graph', scale, layout), scaledTables('table', tables)];
  },
  code: (scene, _storyboard, hunks) => (hunks[scene.hunkId] ? layoutCode(scene, hunks[scene.hunkId]!) : null),
  flow: (scene) => layoutFlow(scene),
  sequence: (scene) => {
    const box = contentBox(Boolean(scene.title));
    const layout = layoutSequence(scene.participants, scene.messages, box);
    return new Scaled('sequence', sequenceScale(layout, box), layout);
  },
  er: (scene) => {
    const layout = layoutEr(scene.entities, scene.relations);
    return new Scaled('er diagram', erScale(layout, contentBox(Boolean(scene.title))), layout);
  },
  state: (scene) => {
    const layout = layoutState(scene.states, scene.transitions, scene.initial);
    return new Scaled('state diagram', stateScale(layout, contentBox(Boolean(scene.title))), layout);
  },
  mermaid: () => null,
  tests: (scene) => {
    const box = headerBox(scene);
    const layout = layoutTests(scene, box.width, box.height);
    return new Scaled('test matrix', layout.scale, layout);
  },
  table: (scene) => {
    const box = headerBox(scene);
    return scaledTables('table', layoutTableStates(scene.columns, stateRows(scene.columns, scene.rows, sceneStates(scene)), box.width, box.height));
  },
  chart: (scene) => {
    const box = headerBox(scene);
    if (scene.kind === 'pie' || scene.kind === 'donut') return layoutPie(scene, box.width, box.height);
    return scene.horizontal ? layoutBarRows(scene, box.width, box.height) : layoutChart(scene, box.width, box.height);
  },
  timeline: (scene) => {
    const box = contentBox(Boolean(scene.title));
    const layout = layoutTimeline(scene, box.width);
    return new Scaled('timeline', timelineScale(layout, box), layout);
  },
  files: (scene, _storyboard, hunks) => {
    const box = contentBox(Boolean(scene.title));
    const layout = layoutFiles(treeRows(sceneFiles(scene, hunks), scene.notes ?? {}), box.width, box.height);
    return new Scaled('file tree', layout.scale, layout);
  },
  layers: (scene) => {
    const box = contentBox(Boolean(scene.title));
    const layout = layoutLayers(scene, box);
    return new Scaled('layer stack', layersScale(layout, box), layout);
  },
  array: (scene) => layoutArray(scene, headerBox(scene)),
  memory: (scene) => {
    const layout = layoutMemory(scene, headerBox(scene));
    return new Scaled('memory diagram', layout.scale, layout);
  },
  review: (scene, storyboard) => {
    const box = contentBox(Boolean(scene.title));
    return layoutReview(storyboard.findings ?? [], box.width, box.height);
  },
  reading: (scene, storyboard, hunks) => {
    const box = contentBox(Boolean(scene.title));
    const order = readingOrder(storyboard, hunks);
    return order ? layoutReading(order, scene.items, box.width, box.height) : null;
  },
  compare: (scene) => {
    const box = contentBox(Boolean(scene.title));
    const layout = layoutCompare(scene, box.width, box.height);
    return new Scaled('comparison', layout.scale, layout);
  },
  // A drawing's text is checked against its viewBox in bin/lib/validate-svg.mjs; nothing here wraps it.
  svg: () => null,
  image: (scene, _storyboard, _hunks, images) => layoutImage(scene, headerBox(scene), images),
  terminal: (scene) => {
    const box = contentBox(Boolean(scene.title));
    return layoutTerminal(scene, box.width, box.height);
  },
};

/** A part of a scene drawn scaled, and the texts inside it. */
export interface ScaledFits {
  name: string;
  scale: number;
  fits: Fit[];
}

/**
 * Every fit inside a layout, found by walking it, so a text a layout fits can never go unreported. The
 * fits inside a scaled layout also go to a part of their own in `scaled`.
 */
function collect(value: unknown, out: Fit[], scaled: ScaledFits[], seen: Set<object>): void {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if ((value as Fit).fit === true && typeof (value as Fit).path === 'string') {
    out.push(value as Fit);
    return;
  }
  if (value instanceof Scaled) {
    const part: ScaledFits = { name: value.name, scale: value.scale, fits: [] };
    collect(value.layout, part.fits, scaled, seen);
    scaled.push(part);
    out.push(...part.fits);
  } else if (value instanceof Map) for (const v of value.values()) collect(v, out, scaled, seen);
  else for (const v of Object.values(value)) collect(v, out, scaled, seen);
}

export interface FitReport {
  scene: number;
  fits: Fit[];
  scaled: ScaledFits[];
}

/** Every text each scene draws, fitted exactly as the player fits it. Expects a normalized, valid storyboard. */
export function fitReport(storyboard: Storyboard, hunks: HunkMap, images: ImageManifest = {}): FitReport[] {
  return storyboard.scenes.map((scene, i) => {
    const out: Fit[] = [];
    const scaled: ScaledFits[] = [];
    const fits = SCENE_FITS[scene.type] as (s: Scene, sb: Storyboard, h: HunkMap, i: ImageManifest) => unknown;
    collect([shellFits(scene), sourceFit(scene, hunks), calloutFits(scene), fits(scene, storyboard, hunks, images)], out, scaled, new Set());
    return { scene: i, fits: out, scaled };
  });
}

/** Each step's item boxes, for the scene types whose layout code gives them without rendering. */
const STEP_TARGETS: Partial<{ [T in Scene['type']]: (scene: Extract<Scene, { type: T }>) => MarkTargets[] }> = {
  graph: graphTargets,
  table: tableTargets,
  array: arrayTargets,
  memory: memoryTargets,
  svg: svgTargets,
  state: (scene) => (scene.steps ?? []).map(() => stateTargets(scene)),
  tests: testsTargets,
};

export interface InkStage {
  area: Box;
  /** Item boxes by item key, as `focus` refs resolve to them. */
  boxes: [string, Box][];
}

/** Per scene, each step's stage and item boxes, where ink at a point would land; null for a scene type without them. */
export function inkStages(storyboard: Storyboard, images: ImageManifest = {}): (InkStage[] | null)[] {
  return storyboard.scenes.map((scene) => {
    if (scene.type === 'image') {
      // Each step's ink lands as the step's pen starts, the pan and zoom that far along.
      const segments = sceneSegments(scene, null);
      const total = sceneDurationInFrames(scene, null);
      return imageTargets(scene, images, segments.slice(1).map((s) => s.markFrom / total)).map((t) => ({ area: t.area, boxes: [...t.boxes] }));
    }
    const targets = (STEP_TARGETS[scene.type] as ((s: Scene) => MarkTargets[]) | undefined)?.(scene);
    return targets ? targets.map((t) => ({ area: t.area, boxes: [...t.boxes] })) : null;
  });
}

/** Pictures drawn more than twice their own size, which look soft: the scene, the picture's size, and its drawn size. */
export function imageScales(storyboard: Storyboard, images: ImageManifest): { scene: number; natural: { width: number; height: number }; drawn: { width: number; height: number }; scale: number }[] {
  return storyboard.scenes.flatMap((scene, i) => {
    if (scene.type !== 'image') return [];
    const layout = layoutImage(scene, headerBox(scene), images);
    if (!layout.natural || layout.upscale <= 2) return [];
    return [{ scene: i, natural: layout.natural, drawn: { width: Math.round(layout.base.width), height: Math.round(layout.base.height) }, scale: layout.upscale }];
  });
}
