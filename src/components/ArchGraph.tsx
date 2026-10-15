import { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { buildFrames } from '../../shared/timing.mjs';
import type { ArchEdge, ArchNode, ArchScene, Change } from '../types';
import { GROUP_NAME, LABEL_FONT, LABEL_LINE_HEIGHT, LABEL_PAD, NODE_H, archBoxes, fitArch, groupNameMax, type ArchDirection, type PlacedGroup, type RoutedEdge } from '../utils/archLayout';
import { centredStage, staged } from '../utils/penGeometry';
import { brighter, focusSpotlight, asBrightAs, type Emphasis } from '../utils/spotlight';
import { ChangeLegend } from './ChangeLegend';
import { changeTone, EMPHASIS } from './marks';
import { NodeCard, sharedTitleFont } from './NodeCard';
import { PenMarks } from './PenMarks';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { clamp, colors, contentBox, ellipsis, fonts } from './theme';

const NODE_START = 8;
const NODES_END = 20;
const EDGE_DRAW = 12;
const EDGE_LABEL_END = 16;
const MUTED = 'rgba(170,178,200,0.55)';

/** Arrowhead colours, one marker each: plain, highlighted, and one per change. */
const MARKERS = { muted: 'rgba(170,178,200,0.8)', emphasis: EMPHASIS.color, accent: colors.accent, added: colors.add, removed: colors.del } as const;
type MarkerTone = keyof typeof MARKERS;

const isHighlighted = (n: ArchNode | undefined) => Boolean(n?.highlight && !n.change);

/**
 * An edge's colour: its own change, else highlighted, either itself or by joining two highlighted nodes,
 * else plain. An edge between two changed nodes stays plain: only its own `change` says the diff touched it.
 */
function edgeTone(edge: ArchEdge, nodes: ReadonlyMap<string, ArchNode>): { stroke: string; marker: MarkerTone } {
  if (edge.change) return { stroke: changeTone[edge.change].color, marker: edge.change === 'modified' ? 'accent' : edge.change };
  if (edge.highlight || (isHighlighted(nodes.get(edge.from)) && isHighlighted(nodes.get(edge.to)))) return { stroke: EMPHASIS.color, marker: 'emphasis' };
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

const EdgeLabel: React.FC<{ label: NonNullable<RoutedEdge['label']>; edge: ArchEdge; appear: number; emphasis: Emphasis }> = ({ label, edge, appear, emphasis }) => {
  const { change } = edge;
  const highlight = edge.highlight && !change;
  const color = change ? changeTone[change].color : highlight ? EMPHASIS.color : colors.muted;
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
        border: `1px solid ${emphasis.glow > 0 ? colors.accent : change || highlight ? `${color}99` : colors.borderStrong}`,
        boxShadow: emphasis.glow > 0 ? `0 0 ${22 * emphasis.glow}px ${colors.accentGlow}` : highlight ? `0 0 18px ${EMPHASIS.glow}` : undefined,
        color: emphasis.glow > 0 && !change ? colors.text : color,
        fontFamily: fonts.mono,
        fontSize: LABEL_FONT,
        lineHeight: LABEL_LINE_HEIGHT,
        textAlign: 'center',
        whiteSpace: 'pre',
        textDecoration: change === 'removed' ? 'line-through' : 'none',
      }}
    >
      {label.lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  );
};

/** A labelled box behind a group's nodes. */
const GroupBox: React.FC<{ group: PlacedGroup; direction: ArchDirection; appear: number; emphasis: Emphasis }> = ({ group, direction, appear, emphasis }) => (
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
        [group.nameAt]: GROUP_NAME.x,
        top: GROUP_NAME.y,
        maxWidth: groupNameMax(group, direction),
        fontSize: GROUP_NAME.font,
        fontWeight: 700,
        letterSpacing: GROUP_NAME.letterSpacing,
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
  const { layout, scale, titleFont } = useMemo(
    () => fitArch(scene.nodes, scene.edges, scene.layout ?? 'LR', contentBox(false), (width) => sharedTitleFont(scene.nodes, width, 'large')),
    [scene.nodes, scene.edges, scene.layout],
  );
  const nodes = useMemo(() => new Map(scene.nodes.map((n) => [n.id, n])), [scene.nodes]);
  const marks = useMemo(() => staged(archBoxes(layout), centredStage(contentBox(false), layout, scale), contentBox(false)), [layout, scale]);
  const emphasisOf = focusSpotlight(scene, hunks, segments, frame);
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
    <SceneShell scene={scene} durationInFrames={durationInFrames} aside={changes.size ? <ChangeLegend used={changes} /> : undefined}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'relative', width: layout.width, height: layout.height, transform: `scale(${scale})`, flexShrink: 0 }}>
          {layout.groups.map((group) => (
            <GroupBox
              key={group.name}
              group={group}
              direction={scene.layout ?? 'LR'}
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
              width={layout.nodeWidth}
              height={NODE_H}
              size="large"
              titleFont={titleFont}
              emphasis={nodeEmphasis(placed.node)}
              appear={spring({ frame: frame - NODE_START - placed.layer * layerStagger, fps, config: { damping: 16, stiffness: 110 } })}
            />
          ))}
          {layout.edges.map((routed, i) =>
            routed.label ? (
              <EdgeLabel
                key={i}
                label={routed.label}
                edge={routed.edge}
                emphasis={emphasisOf(`e:${routed.index}`)}
                appear={interpolate(frame, [edgeAt(i) + EDGE_DRAW - 4, edgeAt(i) + EDGE_LABEL_END], [0, 1], clamp)}
              />
            ) : null,
          )}
        </div>
      </div>
      <PenMarks scene={scene} hunks={hunks} segments={segments} targets={() => marks} />
    </SceneShell>
  );
};
