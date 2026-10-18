// Where the state scenes draw each item at each step, in their content box: what a pen mark and ink keep off and
// draw on. The scenes draw from these, and `validate` reads them through src/fit/report.ts, so both see one layout.

import { sceneStates } from '../../shared/state-steps.mjs';
import { svgGeometry, svgOf, svgStage } from '../../shared/svg.mjs';
import { stateMotion } from '../../shared/svg-motion.mjs';
import { plotAxes, plotGeometry, plotLabels, stateParams } from '../../shared/plot.mjs';
import { headerBox } from '../fit/shell';
import { contentBox } from '../components/theme';
import { sceneFiles } from '../../shared/files.mjs';
import type { ArrayScene, ErScene, FilesScene, GraphScene, HunkMap, LayersScene, MemoryScene, PlotScene, StateScene, SvgScene, TableScene, TestsScene, TimelineScene } from '../types';
import { arrayBoxes, layoutArray } from './arrayLayout';
import { erBoxes, erScale, layoutEr } from './erLayout';
import { filesBoxes, layoutFiles, treeRows } from './filesLayout';
import { layersBoxes, layersScale, layoutLayers } from './layersLayout';
import { layoutTimeline, timelineBoxes, timelineScale } from './timelineLayout';
import { fitSceneGraph, graphAreas, graphBoxes } from './graphLayout';
import { layoutMemory, memoryBoxes } from './memoryLayout';
import { centredStage, staged, type MarkTargets } from './penGeometry';
import { layoutState, stateBoxes, stateScale } from './stateLayout';
import { layoutTableStates, stateRows, tableBoxes } from './tableLayout';
import { layoutTests, testsBoxes } from './testsLayout';

/** Two sets of mark targets in one content box, such as a graph's and its table's. */
const merged = (a: MarkTargets, b: MarkTargets | null): MarkTargets =>
  b ? { boxes: new Map([...a.boxes, ...b.boxes]), obstacles: [...(a.obstacles ?? a.boxes.values()), ...(b.obstacles ?? b.boxes.values())], lines: [...(a.lines ?? []), ...(b.lines ?? [])], area: a.area } : a;

/** A graph's boxes, and its table's as step k leaves it, for each step. */
export function graphTargets(scene: GraphScene): MarkTargets[] {
  const { full, graphBox, tableW } = graphAreas(scene);
  const states = sceneStates(scene);
  const { layout, scale } = fitSceneGraph(scene, states, graphBox);
  const tables = scene.table ? layoutTableStates(scene.table.columns, stateRows(scene.table.columns, scene.table.rows, states), tableW, full.height, 'table.') : null;
  const tableTop = tables ? Math.max(0, (full.height - Math.max(...tables.map((t) => t.height * t.scale))) / 2) : 0;
  const graph = staged(graphBoxes(layout), centredStage(graphBox, layout, scale), full);
  return states.slice(1).map((_, k) => merged(graph, tables ? staged(tableBoxes(tables[k + 1]!), { left: full.width - tableW, top: tableTop, scale: tables[k + 1]!.scale }, full) : null));
}

export function tableTargets(scene: TableScene): MarkTargets[] {
  const box = headerBox(scene);
  const layouts = layoutTableStates(scene.columns, stateRows(scene.columns, scene.rows, sceneStates(scene)), box.width, box.height);
  return layouts.slice(1).map((l) => staged(tableBoxes(l), { left: 0, top: Math.max(0, box.height - l.height * l.scale) * 0.3, scale: l.scale }, box));
}

export function arrayTargets(scene: ArrayScene): MarkTargets[] {
  const box = headerBox(scene);
  const layout = layoutArray(scene, box);
  const stage = { left: Math.round((box.width - layout.width) / 2), top: Math.round(Math.max(0, box.height - layout.height) * 0.4), scale: 1 };
  return sceneStates(scene).slice(1).map((state) => staged(arrayBoxes(scene, layout, state), stage, box));
}

export function memoryTargets(scene: MemoryScene): MarkTargets[] {
  const box = headerBox(scene);
  const layout = layoutMemory(scene, box);
  const stage = centredStage(box, layout, layout.scale);
  return sceneStates(scene).slice(1).map((state) => staged(memoryBoxes(layout, state), stage, box));
}

/** A drawing's boxes as each step leaves it, with its moves and morphs. */
export function svgTargets(scene: SvgScene): MarkTargets[] {
  const box = headerBox(scene);
  const { root, viewBox, ids } = svgOf(scene.svg);
  const stage = viewBox ? svgStage(viewBox, box) : { scale: 1, left: 0, top: 0 };
  return sceneStates(scene).slice(1).map((state) => {
    const { boxes } = svgGeometry(root, stateMotion(ids, state));
    return staged({ boxes: new Map([...boxes].map(([id, b]) => [`s:${id}`, b])) }, stage, box);
  });
}

/** A plot's parts where each step leaves them, with every label kept clear of. */
export function plotTargets(scene: PlotScene): MarkTargets[] {
  const box = headerBox(scene);
  const axes = plotAxes(scene, box);
  return sceneStates(scene).slice(1).map((state) => {
    const scope = stateParams(scene, state);
    const geometry = plotGeometry(scene, axes, scope);
    const shown = (id: string) => !state.hidden[`p:${id}`];
    const boxes = new Map([...geometry].flatMap(([id, g]) => (g.box && g.visible && shown(id) ? [[`p:${id}`, g.box] as const] : [])));
    const labels = plotLabels(scene, axes, geometry, scope, shown).map((l) => l.box);
    return staged({ boxes, obstacles: [...boxes.values(), ...labels, ...axes.ticks.x.map((t) => t.box), ...axes.ticks.y.map((t) => t.box)] }, { left: 0, top: 0, scale: 1 }, box);
  });
}

/** A state diagram does not change between steps, so every step has the same targets. */
export function stateTargets(scene: StateScene): MarkTargets {
  const layout = layoutState(scene.states, scene.transitions, scene.initial);
  const box = contentBox(Boolean(scene.title));
  return staged(stateBoxes(layout), centredStage(box, layout, stateScale(layout, box)), box);
}

/** A tests matrix does not move between steps: its rows, cells and outcome columns, the same for every step. */
export function testsTargets(scene: TestsScene): MarkTargets[] {
  const box = headerBox(scene);
  const layout = layoutTests(scene, box.width, box.height);
  const targets = staged(testsBoxes(layout), { left: 0, top: Math.max(0, box.height - layout.height * layout.scale) * 0.3, scale: layout.scale }, box);
  return (scene.steps ?? []).map(() => targets);
}

// The scenes below do not move between steps, so one set of targets serves every step.

export function erTargets(scene: ErScene): MarkTargets {
  const layout = layoutEr(scene.entities, scene.relations);
  const box = contentBox(Boolean(scene.title));
  return staged(erBoxes(layout), centredStage(box, layout, erScale(layout, box)), box);
}

export function filesTargets(scene: FilesScene, hunks: HunkMap): MarkTargets {
  const box = contentBox(Boolean(scene.title));
  const layout = layoutFiles(treeRows(sceneFiles(scene, hunks), scene.notes ?? {}), box.width, box.height);
  return staged(filesBoxes(layout), { left: 0, top: Math.max(0, box.height - layout.height * layout.scale) * 0.3, scale: layout.scale }, box);
}

export function layersTargets(scene: LayersScene): MarkTargets {
  const box = contentBox(Boolean(scene.title));
  const layout = layoutLayers(scene, box);
  return staged(layersBoxes(layout), centredStage(box, layout, layersScale(layout, box)), box);
}

export function timelineTargets(scene: TimelineScene): MarkTargets {
  const box = contentBox(Boolean(scene.title));
  const layout = layoutTimeline(scene, box.width);
  const scale = timelineScale(layout, box);
  return staged(timelineBoxes(layout), { left: (box.width - layout.width * scale) / 2, top: Math.max(0, box.height - layout.height * scale) * 0.4, scale }, box);
}
