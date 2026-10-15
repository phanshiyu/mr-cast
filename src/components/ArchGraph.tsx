import { Database, Layers, Monitor, Server, type LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { ArchScene, NodeKind } from '../types';
import { NODE_H, NODE_W, layoutArch, type PositionedNode, type RoutedEdge } from '../utils/archLayout';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { clamp, colors, contentBox, defaultChapter, ellipsis, fitFontSize, fonts } from './theme';

const kindIcon: Record<NodeKind, LucideIcon> = { service: Server, db: Database, queue: Layers, client: Monitor };
const kindLabel: Record<NodeKind, string> = { service: 'service', db: 'datastore', queue: 'queue', client: 'client' };

const NODE_START = 8;

const NodeCard: React.FC<{ placed: PositionedNode; appear: number }> = ({ placed, appear }) => {
  const { node } = placed;
  const Icon = kindIcon[node.kind];
  const accent = node.modified ? colors.accent : colors.muted;
  return (
    <div
      style={{
        position: 'absolute',
        left: placed.x,
        top: placed.y,
        width: NODE_W,
        height: NODE_H,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        padding: '0 22px',
        borderRadius: 20,
        background: node.modified ? 'linear-gradient(180deg, #1c2033, #151826)' : colors.raised,
        border: `2px solid ${node.modified ? colors.accent : colors.borderStrong}`,
        boxShadow: node.modified ? `0 0 0 6px ${colors.accentSoft}, 0 0 48px ${colors.accentGlow}` : '0 12px 32px rgba(0,0,0,0.4)',
        opacity: appear,
        transform: `translateY(${(1 - appear) * 20}px) scale(${0.92 + 0.08 * appear})`,
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: node.modified ? colors.accentSoft : 'rgba(255,255,255,0.05)',
          color: accent,
          flexShrink: 0,
        }}
      >
        <Icon size={30} strokeWidth={2} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: fitFontSize(node.label, 28, 12, 21), fontWeight: 650, color: colors.text, ...ellipsis }}>{node.label}</div>
        <div style={{ fontSize: 19, color: colors.faint, marginTop: 4, ...ellipsis }}>{kindLabel[node.kind]}</div>
      </div>
      {node.modified ? (
        <div
          style={{
            position: 'absolute',
            top: -16,
            right: 18,
            padding: '4px 12px',
            borderRadius: 999,
            background: colors.accent,
            color: '#0b0d18',
            fontSize: 16,
            fontWeight: 800,
            letterSpacing: 1,
            textTransform: 'uppercase',
          }}
        >
          changed
        </div>
      ) : null}
    </div>
  );
};

const EdgePath: React.FC<{ routed: RoutedEdge; draw: number; frame: number; highlighted: boolean }> = ({ routed, draw, frame, highlighted }) => {
  const stroke = highlighted ? colors.accent : 'rgba(170,178,200,0.55)';
  return (
    <g opacity={draw > 0 ? 1 : 0}>
      <path d={routed.d} fill="none" stroke={stroke} strokeOpacity={0.25} strokeWidth={3} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - draw} />
      <path
        d={routed.d}
        fill="none"
        stroke={stroke}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray="10 12"
        strokeDashoffset={-frame * 1.4}
        opacity={interpolate(draw, [0.85, 1], [0, 1], clamp)}
        markerEnd={`url(#arrow-${highlighted ? 'accent' : 'muted'})`}
      />
    </g>
  );
};

const EdgeLabel: React.FC<{ routed: RoutedEdge; appear: number }> = ({ routed, appear }) => (
  <div
    style={{
      position: 'absolute',
      left: routed.mid.x,
      top: routed.mid.y,
      transform: `translate(-50%, -50%) scale(${0.9 + 0.1 * appear})`,
      opacity: appear,
      maxWidth: 200,
      padding: '5px 12px',
      borderRadius: 10,
      background: '#0d0f16',
      border: `1px solid ${colors.borderStrong}`,
      color: colors.muted,
      fontFamily: fonts.mono,
      fontSize: 17,
      ...ellipsis,
    }}
  >
    {routed.edge.label}
  </div>
);

export const ArchGraph: React.FC<SceneProps<ArchScene>> = ({ scene, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const layout = useMemo(() => layoutArch(scene.nodes, scene.edges), [scene.nodes, scene.edges]);
  const box = contentBox(false);
  const scale = Math.min(box.width / layout.width, box.height / layout.height, 1.3);
  const modified = new Set(scene.nodes.filter((n) => n.modified).map((n) => n.id));
  // Nodes land within the first ~35% of the scene and edges by ~55%, however short the narration.
  const layerStagger = Math.min(10, (durationInFrames * 0.3) / layout.layerCount);
  const edgesStart = NODE_START + layout.layerCount * layerStagger + 4;
  const edgeStagger = Math.min(4, (durationInFrames * 0.15) / Math.max(1, layout.edges.length));

  return (
    <SceneShell durationInFrames={durationInFrames} eyebrow={scene.chapter ?? defaultChapter.arch}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'relative', width: layout.width, height: layout.height, transform: `scale(${scale})`, flexShrink: 0 }}>
          <svg width={layout.width} height={layout.height} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
            <defs>
              {(['accent', 'muted'] as const).map((tone) => (
                <marker key={tone} id={`arrow-${tone}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill={tone === 'accent' ? colors.accent : 'rgba(170,178,200,0.8)'} />
                </marker>
              ))}
            </defs>
            {layout.edges.map((routed, i) => (
              <EdgePath
                key={i}
                routed={routed}
                frame={frame}
                highlighted={modified.has(routed.edge.from) && modified.has(routed.edge.to)}
                draw={interpolate(frame, [edgesStart + i * edgeStagger, edgesStart + i * edgeStagger + 16], [0, 1], clamp)}
              />
            ))}
          </svg>
          {layout.nodes.map((placed) => (
            <NodeCard
              key={placed.node.id}
              placed={placed}
              appear={spring({ frame: frame - NODE_START - placed.layer * layerStagger, fps, config: { damping: 16, stiffness: 110 } })}
            />
          ))}
          {layout.edges.map((routed, i) =>
            routed.edge.label ? (
              <EdgeLabel key={i} routed={routed} appear={interpolate(frame, [edgesStart + i * edgeStagger + 12, edgesStart + i * edgeStagger + 22], [0, 1], clamp)} />
            ) : null,
          )}
        </div>
      </div>
    </SceneShell>
  );
};
