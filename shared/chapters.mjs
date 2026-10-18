// A scene's chapter title: its own `chapter`, else a label for its type. Shared by the player's header and
// chapter list, `validate`'s fit check, and the reading order, which names the chapter that explains each hunk.

export const DEFAULT_CHAPTERS = {
  text: 'Overview',
  graph: 'Architecture',
  code: 'Code change',
  flow: 'Data flow',
  sequence: 'Sequence',
  er: 'Data model',
  state: 'States',
  mermaid: 'Diagram',
  tests: 'Tests',
  table: 'Table',
  chart: 'Chart',
  timeline: 'Timeline',
  files: 'Files',
  review: "Claude's review",
  reading: 'Reading order',
  compare: 'Compare',
  terminal: 'Terminal',
  layers: 'Layers',
  array: 'Step by step',
  memory: 'Memory',
  svg: 'Drawing',
  plot: 'Plot',
};

export function sceneChapter(scene) {
  if (scene.chapter) return scene.chapter;
  if (scene.type === 'graph' && Array.isArray(scene.nodes) && scene.nodes.some((n) => n?.shape === 'decision')) return 'Flowchart';
  return DEFAULT_CHAPTERS[scene.type] ?? scene.type;
}
