import { sceneFiles } from '../../shared/files.mjs';
import type { Fit } from '../../shared/textfit.mjs';
import type { HunkMap, Scene, Storyboard } from '../types';
import { contentBox } from '../components/theme';
import { fitGraph, graphDirection } from '../utils/graphLayout';
import { layoutChart } from '../utils/chartLayout';
import { layoutCompare } from '../utils/compareLayout';
import { layoutCode } from '../utils/codeLayout';
import { layoutEr } from '../utils/erLayout';
import { layoutFiles, treeRows } from '../utils/filesLayout';
import { layoutFlow } from '../utils/flowLayout';
import { layoutIntent } from '../utils/intentLayout';
import { layoutLayers } from '../utils/layersLayout';
import { layoutSequence } from '../utils/sequenceLayout';
import { layoutState } from '../utils/stateLayout';
import { layoutTable } from '../utils/tableLayout';
import { layoutReview } from '../utils/reviewLayout';
import { layoutTests } from '../utils/testsLayout';
import { layoutTerminal } from '../utils/terminalLayout';
import { layoutTimeline } from '../utils/timelineLayout';
import { shellFits } from './shell';

/** Everything a scene type fits its text into, given its scene: the layouts its component draws from. */
type SceneFits = { [T in Scene['type']]: (scene: Extract<Scene, { type: T }>, storyboard: Storyboard, hunks: HunkMap) => unknown };

const SCENE_FITS: SceneFits = {
  intent: (scene, storyboard) => layoutIntent(scene, storyboard),
  graph: (scene) => fitGraph(scene.nodes, scene.edges, graphDirection(scene), contentBox(false)),
  code: (scene, _storyboard, hunks) => (hunks[scene.hunkId] ? layoutCode(scene, hunks[scene.hunkId]!) : null),
  flow: (scene) => layoutFlow(scene),
  sequence: (scene) => layoutSequence(scene.participants, scene.messages, contentBox(Boolean(scene.title))),
  er: (scene) => layoutEr(scene.entities, scene.relations),
  state: (scene) => layoutState(scene.states, scene.transitions, scene.initial),
  mermaid: () => null,
  tests: (scene) => {
    const box = contentBox(Boolean(scene.title));
    return layoutTests(scene, box.width, box.height);
  },
  table: (scene) => {
    const box = contentBox(Boolean(scene.title));
    return layoutTable(scene.columns, scene.rows, box.width, box.height);
  },
  chart: (scene) => {
    const box = contentBox(Boolean(scene.title));
    return layoutChart(scene, box.width, box.height);
  },
  timeline: (scene) => layoutTimeline(scene, contentBox(Boolean(scene.title)).width),
  files: (scene, _storyboard, hunks) => {
    const box = contentBox(Boolean(scene.title));
    return layoutFiles(treeRows(sceneFiles(scene, hunks), scene.notes ?? {}), box.width, box.height);
  },
  layers: (scene) => layoutLayers(scene, contentBox(Boolean(scene.title))),
  review: (scene, storyboard) => {
    const box = contentBox(Boolean(scene.title));
    return layoutReview(storyboard.findings ?? [], box.width, box.height);
  },
  compare: (scene) => {
    const box = contentBox(Boolean(scene.title));
    return layoutCompare(scene, box.width, box.height);
  },
  terminal: (scene) => {
    const box = contentBox(Boolean(scene.title));
    return layoutTerminal(scene, box.width, box.height);
  },
};

/** Every fit inside a layout, found by walking it, so a text a layout fits can never go unreported. */
function collect(value: unknown, out: Fit[], seen: Set<object>): void {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if ((value as Fit).fit === true && typeof (value as Fit).path === 'string') {
    out.push(value as Fit);
    return;
  }
  if (value instanceof Map) for (const v of value.values()) collect(v, out, seen);
  else for (const v of Object.values(value)) collect(v, out, seen);
}

export interface FitReport {
  scene: number;
  fits: Fit[];
}

/** Every text each scene draws, fitted exactly as the player fits it. Expects a normalized, valid storyboard. */
export function fitReport(storyboard: Storyboard, hunks: HunkMap): FitReport[] {
  return storyboard.scenes.map((scene, i) => {
    const out: Fit[] = [];
    const fits = SCENE_FITS[scene.type] as (s: Scene, sb: Storyboard, h: HunkMap) => unknown;
    collect([shellFits(scene), fits(scene, storyboard, hunks)], out, new Set());
    return { scene: i, fits: out };
  });
}
