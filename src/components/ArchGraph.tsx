import { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { buildFrames } from '../../shared/timing.mjs';
import type { ArchEdge, ArchNode, ArchScene, Change } from '../types';
import { NODE_H, NODE_W, layoutArch, type PlacedGroup, type RoutedEdge } from '../utils/archLayout';
import { brighter, focusSpotlight, asBrightAs, type Emphasis } from '../utils/spotlight';
import { wrapLabel } from '../utils/wrapLabel';
import { ChangeLegend, changeTone } from './ChangeLegend';
import { NodeCard } from './NodeCard';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { clamp, colors, contentBox, defaultChapter, ellipsis, fonts } from './theme';

const NODE_START = 8;
const NODES_END = 20;
const EDGE_DRAW = 12;
const EDGE_LABEL_END = 16;
const MUTED = 'rgba(170,178,200,0.55)';

/** Arrowhead colours, one marker each: plain, key, and one per change. */
const MARKERS = { muted: 'rgba(170,178,200,0.8)', accent: colors.accent, added: colors.add, removed: colors.del } as const;
type MarkerTone = keyof typeof MARKERS;

const isKey = (n: ArchNode | undefined) => Boolean(n && (n.highlight || n.change === 'modified'));

/** An edge's colour: its own change, else accent between two key nodes, else plain. */
function edgeTone(edge: ArchEdge, nodes: ReadonlyMap<string, ArchNode>): { stroke: string; marker: MarkerTone } {
  if (edge.change) return { stroke: changeTone[edge.change].color, marker: edge.change === 'modified' ? 'accent' : edge.change };
  if (isKey(nodes.get(edge.from)) && isKey(nodes.get(edge.to))) return { stroke: colors.accent, marker: 'accent' };
  return { stroke: MUTED, marker: 'muted' };
}

const edgeStyle = (edge: ArchEdge) => edge.style ?? ((edge.direction ?? 'forward') === 'forward' ? 'flow' : 'solid');

const EdgePath: React.FC<{ routed: RoutedEdge; draw: number; frame: number; tone: ReturnType<typeof edgeTone>; emphasis: Emphasis }> = ({ routed, draw, frame, tone, emphasis }) => {
  const { edge } = routed;
  const direction = edge.direction ?? 'forward';
  const style = edgeStyle(edge);
  const removed = edge.change === 'removed';
  const marker = `url(#arrow-${tone.marker})`;
  const heads = {
    markerEnd: direction === 'none' ? undefined : marker,
    markerStart: direction === 'both' ? marker : undefined,
    opacity: interpolate(draw, [0.85, 1], [0, 1], clamp),
  };
  const id = `arch-reveal-${routed.index}`;
  return (
    <g opacity={draw > 0 ? emphasis.opacity * (removed ? 0.78 : 1) : 0}>
      {emphasis.glow > 0 || (edge.change && !removed) ? (
        <path
          d={routed.d}
          fill="none"
          stroke={emphasis.glow > 0 && !edge.change ? colors.accent : tone.stroke}
          strokeOpacity={(edge.change && !removed ? 0.22 : 0) + 0.45 * emphasis.glow}
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

/**
 * Characters per line of an edge label: about 250px at the label font left to right, inside the column
 * gap; top to bottom the label sits in a row gap, where width is free and height is not.
 */
const EDGE_LABEL_CHARS = { LR: 22, TB: 32 } as const;

const EdgeLabel: React.FC<{ routed: RoutedEdge; chars: number; appear: number; emphasis: Emphasis }> = ({ routed, chars, appear, emphasis }) => {
  const change = routed.edge.change;
  const color = change ? changeTone[change].color : colors.muted;
  return (
    <div
      style={{
        position: 'absolute',
        left: routed.mid.x,
        top: routed.mid.y,
        transform: `translate(-50%, -50%) scale(${(0.9 + 0.1 * appear) * (1 + 0.06 * emphasis.glow)})`,
        opacity: appear * emphasis.opacity,
        padding: '5px 12px',
        borderRadius: 10,
        background: '#0d0f16',
        border: `1px solid ${emphasis.glow > 0 ? colors.accent : change ? `${color}99` : colors.borderStrong}`,
        boxShadow: emphasis.glow > 0 ? `0 0 ${22 * emphasis.glow}px ${colors.accentGlow}` : undefined,
        color: emphasis.glow > 0 && !change ? colors.text : color,
        fontFamily: fonts.mono,
        fontSize: 17,
        lineHeight: 1.3,
        textAlign: 'center',
        whiteSpace: 'pre',
        textDecoration: change === 'removed' ? 'line-through' : 'none',
      }}
    >
      {wrapLabel(routed.edge.label ?? '', chars).map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  );
};

/** A labelled box behind a group's nodes. Top to bottom, its name stays in the left half, clear of edges entering at the middle. */
const GroupBox: React.FC<{ group: PlacedGroup; vertical: boolean; appear: number; emphasis: Emphasis }> = ({ group, vertical, appear, emphasis }) => (
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
    <div
      style={{
        position: 'absolute',
        left: 22,
        top: 12,
        maxWidth: vertical ? group.width / 2 - 34 : group.width - 44,
        fontSize: 16,
        fontWeight: 700,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        color: emphasis.glow > 0 ? colors.accent : colors.muted,
        ...ellipsis,
      }}
    >
      {group.name}
    </div>
  </div>
);

/** Nodes carry badges; the legend decodes the colours of changed edges, so it shows only when an edge changes. */
function legendChanges(scene: ArchScene): Set<Change> {
  if (!scene.edges.some((e) => e.change)) return new Set();
  return new Set([...scene.nodes, ...scene.edges].flatMap((x) => (x.change ? [x.change] : [])));
}

export const ArchGraph: React.FC<SceneProps<ArchScene>> = ({ scene, hunks, durationInFrames, segments }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const layout = useMemo(() => layoutArch(scene.nodes, scene.edges, scene.layout), [scene.nodes, scene.edges, scene.layout]);
  const nodes = useMemo(() => new Map(scene.nodes.map((n) => [n.id, n])), [scene.nodes]);
  const emphasisOf = focusSpotlight(scene, hunks, segments, frame);
  const box = contentBox(false);
  const scale = Math.min(box.width / layout.width, box.height / layout.height, 1.3);
  // Groups and nodes land layer by layer, then the edges draw, all before the voice starts.
  const layerStagger = Math.min(6, (NODES_END - NODE_START) / Math.max(1, layout.layerCount - 1));
  const edgeStagger = Math.min(4, (buildFrames('arch') - NODES_END - EDGE_LABEL_END) / Math.max(1, layout.edges.length - 1));
  const edgeAt = (i: number) => NODES_END + i * edgeStagger;
  const changes = legendChanges(scene);
  const nodeEmphasis = (node: ArchNode) => {
    const own = node.group ? brighter(emphasisOf(`n:${node.id}`), emphasisOf(`g:${node.group}`)) : emphasisOf(`n:${node.id}`);
    return asBrightAs(own, scene.edges.flatMap((e, i) => (e.from === node.id || e.to === node.id ? [emphasisOf(`e:${i}`)] : [])));
  };

  return (
    <SceneShell durationInFrames={durationInFrames} eyebrow={scene.chapter ?? defaultChapter.arch} aside={changes.size ? <ChangeLegend used={changes} /> : undefined}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'relative', width: layout.width, height: layout.height, transform: `scale(${scale})`, flexShrink: 0 }}>
          {layout.groups.map((group) => (
            <GroupBox
              key={group.name}
              group={group}
              vertical={scene.layout === 'TB'}
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
            {layout.edges.map((routed, i) => (
              <EdgePath
                key={i}
                routed={routed}
                frame={frame}
                tone={edgeTone(routed.edge, nodes)}
                emphasis={emphasisOf(`e:${routed.index}`)}
                draw={interpolate(frame, [edgeAt(i), edgeAt(i) + EDGE_DRAW], [0, 1], clamp)}
              />
            ))}
          </svg>
          {layout.nodes.map((placed) => (
            <NodeCard
              key={placed.node.id}
              node={placed.node}
              x={placed.x}
              y={placed.y}
              width={NODE_W}
              height={NODE_H}
              size="large"
              emphasis={nodeEmphasis(placed.node)}
              appear={spring({ frame: frame - NODE_START - placed.layer * layerStagger, fps, config: { damping: 16, stiffness: 110 } })}
            />
          ))}
          {layout.edges.map((routed, i) =>
            routed.edge.label ? (
              <EdgeLabel
                key={i}
                routed={routed}
                chars={EDGE_LABEL_CHARS[scene.layout ?? 'LR']}
                emphasis={emphasisOf(`e:${routed.index}`)}
                appear={interpolate(frame, [edgeAt(i) + EDGE_DRAW - 4, edgeAt(i) + EDGE_LABEL_END], [0, 1], clamp)}
              />
            ) : null,
          )}
        </div>
      </div>
    </SceneShell>
  );
};
