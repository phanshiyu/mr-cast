import { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { sceneStates } from '../../shared/state-steps.mjs';
import { buildFrames } from '../../shared/timing.mjs';
import { shownOf, stateFrame, type StateFrame } from '../utils/stateTrack';
import { layoutTableStates, stateRows, tableBoxes } from '../utils/tableLayout';
import { dimOpacity, mainTone, tintMix } from '../utils/tint';
import { TableView } from './DataTable';
import { HeaderCallout } from './HeaderCallout';
import { tones } from './tones';
import type { GraphEdge, GraphNode, GraphScene, Change } from '../types';
import { GROUP_NAME, LABEL_PAD, asShown, graphAreas, graphBoxes, fitSceneGraph, shapeOf, type PlacedGroup, type RoutedEdge } from '../utils/graphLayout';
import { ShapeNode } from './ShapeNode';
import { centredStage, staged, type MarkTargets } from '../utils/penGeometry';
import { brighter, focusSpotlight, asBrightAs, type Emphasis } from '../utils/spotlight';
import { ChangeLegend } from './ChangeLegend';
import { changeTone, EMPHASIS } from './marks';
import { FitText } from './FitText';
import { NodeCard } from './NodeCard';
import { PenMarks } from './PenMarks';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { clamp, colors } from './theme';

const NODE_START = 8;
const NODES_END = 20;
const EDGE_DRAW = 12;
const EDGE_LABEL_END = 16;
const MUTED = 'rgba(170,178,200,0.55)';

/** Arrowhead colours, one marker each: plain, highlighted, and one per change. */
const MARKERS = { muted: 'rgba(170,178,200,0.8)', emphasis: EMPHASIS.color, accent: colors.accent, added: colors.add, removed: colors.del, good: tones.good.color, bad: tones.bad.color, warn: tones.warn.color, neutral: tones.neutral.color } as const;
type MarkerTone = keyof typeof MARKERS;

const isHighlighted = (n: GraphNode | undefined) => Boolean(n?.highlight && !n.change);

/**
 * An edge's colour: its own change, else highlighted, either itself or by joining two highlighted nodes,
 * else plain. An edge between two changed nodes stays plain: only its own `change` says the diff touched it.
 */
function edgeTone(edge: GraphEdge, nodes: ReadonlyMap<string, GraphNode>): { stroke: string; marker: MarkerTone } {
  if (edge.change) return { stroke: changeTone[edge.change].color, marker: edge.change === 'modified' ? 'accent' : edge.change };
  if (edge.highlight || (isHighlighted(nodes.get(edge.from)) && isHighlighted(nodes.get(edge.to)))) return { stroke: EMPHASIS.color, marker: 'emphasis' };
  return { stroke: MUTED, marker: 'muted' };
}

/** An edge's style: its own, else moving dashes for a forward edge, except in a flowchart, whose arrows are still. */
const edgeStyle = (edge: GraphEdge, flowchart: boolean) => edge.style ?? ((edge.direction ?? 'forward') === 'forward' && !flowchart ? 'flow' : 'solid');

const EdgePath: React.FC<{ routed: RoutedEdge; draw: number; frame: number; tone: ReturnType<typeof edgeTone>; emphasis: Emphasis; flowchart: boolean; fade: number }> = ({ routed, draw, frame, tone, emphasis, flowchart, fade }) => {
  const { edge } = routed;
  const direction = edge.direction ?? 'forward';
  const style = edgeStyle(edge, flowchart);
  const removed = edge.change === 'removed';
  const marker = `url(#arrow-${tone.marker})`;
  const heads = {
    markerEnd: direction === 'none' ? undefined : marker,
    markerStart: direction === 'both' ? marker : undefined,
    opacity: interpolate(draw, [0.85, 1], [0, 1], clamp),
  };
  const id = `graph-reveal-${routed.index}`;
  return (
    <g opacity={draw > 0 ? emphasis.opacity * fade * (removed ? 0.78 : 1) : 0}>
      {emphasis.glow > 0 || (edge.change && !removed) || edge.highlight ? (
        <path
          d={routed.d}
          fill="none"
          stroke={emphasis.glow > 0 && !edge.change && !edge.highlight ? colors.accent : tone.stroke}
          strokeOpacity={((edge.change && !removed) || edge.highlight ? 0.22 : 0) + 0.45 * emphasis.glow}
          strokeWidth={10}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="1 1"
          strokeDashoffset={1 - draw}
        />
      ) : null}
      {style === 'flow' && !removed ? (
        <>
          <path d={routed.d} fill="none" stroke={tone.stroke} strokeOpacity={0.25} strokeWidth={3} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - draw} />
          <path
            d={routed.d}
            fill="none"
            stroke={tone.stroke}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray="10 12"
            strokeDashoffset={-frame * 1.4}
            {...heads}
          />
        </>
      ) : (
        <>
          <mask id={id} maskUnits="userSpaceOnUse">
            <path d={routed.d} fill="none" stroke="#fff" strokeWidth={14} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - draw} />
          </mask>
          <path
            d={routed.d}
            fill="none"
            stroke={tone.stroke}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={style === 'dashed' || removed ? '10 9' : undefined}
            mask={`url(#${id})`}
          />
          <path d={routed.d} fill="none" stroke="transparent" strokeWidth={3} {...heads} />
        </>
      )}
    </g>
  );
};

const EdgeLabel: React.FC<{ label: NonNullable<RoutedEdge['label']>; edge: GraphEdge; appear: number; emphasis: Emphasis; tinted: string | null }> = ({ label, edge, appear, emphasis, tinted }) => {
  const { change } = edge;
  const highlight = edge.highlight && !change;
  const color = change ? changeTone[change].color : tinted ?? (highlight ? EMPHASIS.color : colors.muted);
  return (
    <div
      style={{
        position: 'absolute',
        left: label.x,
        top: label.y,
        transform: `translate(-50%, -50%) scale(${(0.9 + 0.1 * appear) * (1 + 0.06 * emphasis.glow)})`,
        opacity: appear * emphasis.opacity,
        padding: `${LABEL_PAD.y}px ${LABEL_PAD.x}px`,
        borderRadius: 10,
        background: '#0d0f16',
        border: `1px solid ${emphasis.glow > 0 ? colors.accent : change || highlight || tinted ? `${color}99` : colors.borderStrong}`,
        boxShadow: emphasis.glow > 0 ? `0 0 ${22 * emphasis.glow}px ${colors.accentGlow}` : highlight ? `0 0 18px ${EMPHASIS.glow}` : undefined,
        color: emphasis.glow > 0 && !change ? colors.text : color,
        textDecoration: change === 'removed' ? 'line-through' : 'none',
      }}
    >
      <FitText fit={label.text} align="center" />
    </div>
  );
};

/** A labelled box behind a group's nodes. */
const GroupBox: React.FC<{ group: PlacedGroup; appear: number; emphasis: Emphasis }> = ({ group, appear, emphasis }) => (
  <div
    style={{
      position: 'absolute',
      left: group.x,
      top: group.y,
      width: group.width,
      height: group.height,
      boxSizing: 'border-box',
      borderRadius: 26,
      border: `2px solid ${emphasis.glow > 0 ? colors.accent : 'rgba(255,255,255,0.1)'}`,
      background: emphasis.glow > 0 ? `rgba(124,140,255,${0.04 + 0.05 * emphasis.glow})` : 'rgba(255,255,255,0.025)',
      boxShadow: emphasis.glow > 0 ? `0 0 ${40 * emphasis.glow}px ${colors.accentSoft}` : undefined,
      opacity: appear * Math.max(emphasis.opacity, 0.7),
    }}
  >
    <FitText
      fit={group.label}
      style={{ position: 'absolute', [group.nameAt]: GROUP_NAME.x, top: GROUP_NAME.y, color: emphasis.glow > 0 ? colors.accent : colors.muted, lineHeight: 'normal' }}
    />
  </div>
);

/** Nodes carry badges; the legend decodes the colours of changed edges, so it shows only when an edge changes. */
function legendChanges(scene: GraphScene): Set<Change> {
  if (!scene.edges.some((e) => e.change)) return new Set();
  return new Set([...scene.nodes, ...scene.edges].flatMap((x) => (x.change ? [x.change] : [])));
}

/** An edge's colour: a tone a step keeps on it, over its own change or highlight. */
function tintedTone(base: ReturnType<typeof edgeTone>, s: StateFrame, key: string): ReturnType<typeof edgeTone> {
  const tone = mainTone(tintMix(s, key));
  return tone && tone !== 'accent' ? { stroke: tones[tone].color, marker: tone } : tone === 'accent' ? { stroke: colors.accent, marker: 'accent' } : base;
}

/** Two sets of mark targets in one content box, such as a graph's and its table's. */
const merged = (a: MarkTargets, b: MarkTargets | null): MarkTargets =>
  b ? { boxes: new Map([...a.boxes, ...b.boxes]), obstacles: [...(a.obstacles ?? a.boxes.values()), ...(b.obstacles ?? b.boxes.values())], lines: [...(a.lines ?? []), ...(b.lines ?? [])], area: a.area } : a;

export const GraphDiagram: React.FC<SceneProps<GraphScene>> = ({ scene, hunks, durationInFrames, segments }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { full, graphBox, tableW } = graphAreas(scene);
  const states = useMemo(() => sceneStates(scene), [scene]);
  const { layout, scale } = useMemo(() => fitSceneGraph(scene, states, graphBox), [scene, states, graphBox.width, graphBox.height]);
  const tables = useMemo(() => (scene.table ? layoutTableStates(scene.table.columns, stateRows(scene.table.columns, scene.table.rows, states), tableW, full.height, 'table.') : null), [scene.table, states, tableW, full.height]);
  const nodes = useMemo(() => new Map(scene.nodes.map((n) => [n.id, n])), [scene.nodes]);
  const flowchart = scene.nodes.some((n) => shapeOf(n) === 'decision');
  const graphStage = centredStage(graphBox, layout, scale);
  const tableTop = tables ? Math.max(0, (full.height - Math.max(...tables.map((t) => t.height * t.scale))) / 2) : 0;
  const tableLeft = full.width - tableW;
  const marks = useMemo(() => {
    const graph = staged(graphBoxes(layout), graphStage, full);
    return states.slice(1).map((_, k) => merged(graph, tables ? staged(tableBoxes(tables[k + 1]!), { left: tableLeft, top: tableTop, scale: tables[k + 1]!.scale }, full) : null));
  }, [layout, scale, tables, states]);
  const s = stateFrame(states, segments, frame);
  const emphasisOf = focusSpotlight(scene, hunks, segments, frame);
  // Groups and nodes land layer by layer, then the edges draw, all before the voice starts.
  const layerStagger = Math.min(6, (NODES_END - NODE_START) / Math.max(1, layout.layerCount - 1));
  const edgeStagger = Math.min(4, (buildFrames('graph') - NODES_END - EDGE_LABEL_END) / Math.max(1, layout.edges.length - 1));
  const edgeAt = (i: number) => NODES_END + i * edgeStagger;
  const changes = legendChanges(scene);
  const nodeEmphasis = (node: GraphNode) => {
    const own = node.group ? brighter(emphasisOf(`n:${node.id}`), emphasisOf(`g:${node.group}`)) : emphasisOf(`n:${node.id}`);
    return asBrightAs(own, scene.edges.flatMap((e, i) => (e.from === node.id || e.to === node.id ? [emphasisOf(`e:${i}`)] : [])));
  };
  /** How shown an edge is: its own show and hide, and never more than either end. */
  const edgeShown = (e: GraphEdge, i: number) => Math.min(shownOf(s, `e:${i}`), shownOf(s, `n:${e.from}`), shownOf(s, `n:${e.to}`));
  /** A table row lights with its own focus, or any of its cells'. */
  const cellEmphasis = (row: number, col: number) => emphasisOf(`x:${row}/${col}`);
  const rowEmphasis = (row: number): Emphasis => {
    const own = emphasisOf(`r:${row}`);
    return { ...own, opacity: Math.max(own.opacity, ...(scene.table?.columns ?? []).map((_, col) => cellEmphasis(row, col).opacity)) };
  };
  const tableNow = tables?.[states.indexOf(s.now)];
  const tableBefore = tables?.[states.indexOf(s.before)];

  return (
    <SceneShell scene={scene} durationInFrames={durationInFrames} aside={<>{changes.size ? <ChangeLegend used={changes} /> : null}<HeaderCallout scene={scene} s={s} /></>}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: graphBox.width, height: graphBox.height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'relative', width: layout.width, height: layout.height, transform: `scale(${scale})`, flexShrink: 0 }}>
          {layout.groups.map((group) => (
            <GroupBox
              key={group.name}
              group={group}
              emphasis={emphasisOf(`g:${group.name}`)}
              appear={interpolate(frame, [NODE_START - 4 + group.layer * layerStagger, NODE_START + 6 + group.layer * layerStagger], [0, 1], clamp)}
            />
          ))}
          <svg width={layout.width} height={layout.height} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
            <defs>
              {(Object.keys(MARKERS) as MarkerTone[]).map((tone) => (
                <marker key={tone} id={`arrow-${tone}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill={MARKERS[tone]} />
                </marker>
              ))}
            </defs>
            {layout.edges.map((routed, i) => {
              const key = `e:${routed.index}`;
              const shown = edgeShown(routed.edge, routed.index);
              const built = interpolate(frame, [edgeAt(i), edgeAt(i) + EDGE_DRAW], [0, 1], clamp);
              return (
                <EdgePath
                  key={i}
                  routed={routed}
                  frame={frame}
                  tone={tintedTone(edgeTone(routed.edge, nodes), s, key)}
                  flowchart={flowchart}
                  emphasis={emphasisOf(key)}
                  draw={Math.min(built, shown)}
                  fade={dimOpacity(tintMix(s, key))}
                />
              );
            })}
          </svg>
          {layout.nodes.map((placed) => {
            const shape = shapeOf(placed.node);
            const node = asShown(nodes.get(placed.node.id)!, s.t < 0.5 ? s.before : s.now);
            const key = `n:${node.id}`;
            const common = {
              node,
              x: placed.box.x,
              y: placed.box.y,
              width: placed.box.width,
              height: placed.box.height,
              text: layout.texts.get(node.id)!,
              emphasis: nodeEmphasis(node),
              appear: spring({ frame: frame - NODE_START - placed.layer * layerStagger, fps, config: { damping: 16, stiffness: 110 } }) * shownOf(s, key),
              tint: tintMix(s, key),
            };
            return shape === 'card' ? <NodeCard key={node.id} {...common} size="large" /> : <ShapeNode key={node.id} {...common} shape={shape} />;
          })}
          {layout.edges.map((routed, i) => {
            if (!routed.label) return null;
            const key = `e:${routed.index}`;
            const tone = mainTone(tintMix(s, key));
            return (
              <EdgeLabel
                key={i}
                label={routed.label}
                edge={routed.edge}
                emphasis={emphasisOf(key)}
                tinted={tone ? tones[tone].color : null}
                appear={interpolate(frame, [edgeAt(i) + EDGE_DRAW - 4, edgeAt(i) + EDGE_LABEL_END], [0, 1], clamp) * edgeShown(routed.edge, routed.index) * dimOpacity(tintMix(s, key))}
              />
            );
          })}
        </div>
      </div>
      {tableNow && tableBefore ? (
        <TableView
          layout={tableNow}
          before={tableBefore}
          s={s}
          left={tableLeft}
          top={tableTop}
          frame={frame}
          headerIn={interpolate(frame, [NODES_END, NODES_END + 10], [0, 1], clamp)}
          rowAt={(i) => NODES_END + 4 + i * 3}
          rowEmphasis={rowEmphasis}
          cellEmphasis={cellEmphasis}
          headerGlow={() => 0}
        />
      ) : null}
      <PenMarks scene={scene} hunks={hunks} segments={segments} targets={(k) => marks[k] ?? null} />
    </SceneShell>
  );
};
