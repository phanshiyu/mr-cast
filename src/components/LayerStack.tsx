import { useMemo } from 'react';
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { layerOf, layerRoute, tokenSteps } from '../../shared/layers.mjs';
import type { HunkMap, LayersScene } from '../types';
import { BAND_GAP, CAPTION_GAP, DOT_R, PAD_X, PILL_GAP, PILL_H, PILL_PAD_X, layersBoxes, layoutLayers, tokenPoint, type LayersLayout, type PlacedLayer } from '../utils/layersLayout';
import { centredStage, staged } from '../utils/penGeometry';
import { asBrightAs, brighter, focusSpotlight, type Emphasis } from '../utils/spotlight';
import type { SpokenSegment } from '../utils/timing';
import { FitText } from './FitText';
import { badgesOf, changeTone, CornerBadges, EMPHASIS, emphasisRing } from './marks';
import { NodeCard } from './NodeCard';
import { PenMarks } from './PenMarks';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { clamp, colors, contentBox } from './theme';
import { tones } from './tones';

const START = 6;
/** Frames between one band and the next drawing in, top to bottom. */
const BAND_STAGGER = 5;
const SKIPPED_OPACITY = 0.3;
const ease = Easing.inOut(Easing.cubic);

/**
 * The token's route position over the scene, as keyframes. With steps it waits off screen, then moves
 * to each step's stop as that step starts, taking longer the more stops it passes. Without steps it
 * walks the whole route while the narration is spoken.
 */
function tokenKeys(scene: LayersScene, hunks: HunkMap, segments: readonly SpokenSegment[], count: number) {
  const { positions } = tokenSteps(scene, hunks);
  const times = [0];
  const pos = [-1];
  const stepped = segments.length > 1 && positions.some((p) => p >= 0);
  if (stepped) {
    let cur = -1;
    positions.forEach((q, k) => {
      if (q === cur) return;
      const at = segments[k + 1]!.from;
      times.push(at, at + Math.min(30, 12 + 4 * (q - Math.max(0, cur))));
      pos.push(cur, q);
      cur = q;
    });
  } else {
    const narration = segments[0]!;
    const start = narration.voiceFrom;
    const end = Math.max(start + count * 20, narration.voiceFrom + narration.speakingFrames);
    times.push(start - 12, start);
    pos.push(-1, 0);
    for (let i = 1; i < count; i++) {
      times.push(start + (i / Math.max(1, count - 1)) * (end - start));
      pos.push(i);
    }
  }
  return { times, pos, stepped };
}

const lit = (e: Emphasis) => (e.glow > 0 ? `, 0 0 0 ${4 * e.glow}px ${colors.accent}, 0 0 ${44 * e.glow}px ${colors.accentGlow}` : '');

const Band: React.FC<{ placed: PlacedLayer; layout: LayersLayout; appear: number; emphasis: Emphasis }> = ({ placed, layout, appear, emphasis }) => {
  const { layer } = placed;
  const change = layer.change ? changeTone[layer.change] : null;
  const removed = layer.change === 'removed';
  const tone = layer.tone ? tones[layer.tone] : null;
  const edge = change?.color ?? (layer.highlight ? EMPHASIS.color : (tone?.color ?? colors.borderStrong));
  const background = layer.change === 'added' ? 'linear-gradient(180deg, #13201d, #10171a)' : layer.change === 'modified' ? 'linear-gradient(180deg, #191d30, #131624)' : layer.highlight ? EMPHASIS.card : colors.surface;
  const ring = change ? `0 0 0 4px ${change.bg}` : layer.highlight ? emphasisRing(4, 36) : '0 10px 28px rgba(0,0,0,0.35)';
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: placed.y,
        width: layout.bandW,
        height: placed.h,
        boxSizing: 'border-box',
        borderRadius: 18,
        background,
        border: `1.5px ${removed ? 'dashed' : 'solid'} ${change || layer.highlight ? edge : colors.border}`,
        boxShadow: ring + lit(emphasis),
        opacity: appear * emphasis.opacity * (removed ? 0.7 : 1),
        transform: `translateY(${(1 - appear) * 22}px)`,
      }}
    >
      <div style={{ position: 'absolute', left: 0, top: 14, bottom: 14, width: 5, borderRadius: 3, background: edge, opacity: change || tone || layer.highlight ? 1 : 0.5 }} />
      <div style={{ position: 'absolute', left: PAD_X, top: placed.textY - placed.y, width: layout.labelW - 2 * PAD_X }}>
        <FitText
          fit={placed.label}
          style={{ color: removed ? colors.muted : colors.text, textDecoration: removed ? 'line-through' : 'none', textDecorationColor: colors.del, textDecorationThickness: 3 }}
        />
        {placed.caption ? <FitText fit={placed.caption} style={{ color: colors.muted, marginTop: CAPTION_GAP }} /> : null}
      </div>
      <CornerBadges badges={badgesOf(layer)} size={14} top={-13} right={22} />
    </div>
  );
};

const Pill: React.FC<{ x: number; y: number; w: number; color: string; bg: string; opacity: number; children: React.ReactNode }> = ({ x, y, w, color, bg, opacity, children }) => (
  <div
    style={{
      position: 'absolute',
      left: x,
      top: y - PILL_H / 2,
      width: w,
      height: PILL_H,
      boxSizing: 'border-box',
      padding: `0 ${PILL_PAD_X}px`,
      display: 'flex',
      alignItems: 'center',
      borderRadius: PILL_H / 2,
      background: `linear-gradient(${bg}, ${bg}), ${colors.bg}`,
      border: `1.5px solid ${color}`,
      boxShadow: `0 0 22px ${color}55`,
      color,
      opacity,
    }}
  >
    {children}
  </div>
);

export const LayerStack: React.FC<SceneProps<LayersScene>> = ({ scene, hunks, durationInFrames, segments }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const box = contentBox(Boolean(scene.title));
  const layout = useMemo(() => layoutLayers(scene, box), [scene, box.width, box.height]);
  const scale = Math.min(1, box.height / layout.height);
  const stage = centredStage(box, layout, scale);
  const marks = useMemo(() => staged(layersBoxes(layout), stage, box), [layout, stage.left, stage.top, scale, box.width, box.height]);
  const route = useMemo(() => layerRoute(scene), [scene]);
  const keys = useMemo(() => tokenKeys(scene, hunks, segments, route.visits.length), [scene, hunks, segments, route]);
  const emphasisOf = focusSpotlight(scene, hunks, segments, frame);
  const rail = layout.rail;
  const visits = route.visits;
  const p = visits.length ? interpolate(frame, keys.times, keys.pos, { ...clamp, easing: ease }) : -1;
  const turn = route.turn;
  const skip = scene.path?.skip;
  const back = interpolate(p, [turn, turn + 1], [0, 1], clamp);
  const skipped = new Set(route.skipped);
  const skipFade = skip ? 1 - (1 - SKIPPED_OPACITY) * back : 1;

  /** How strongly the token is at a key's stop right now. Steps light the stops they move it to, so only a walk without them lights its own. */
  const here = (key: string) => (keys.stepped ? 0 : Math.max(0, ...visits.map((v, i) => (v.key === key ? 1 - Math.min(1, Math.abs(p - i) * 1.6) : 0))));
  const emphasis = (key: string): Emphasis => {
    const own = emphasisOf(key);
    const at = here(key);
    const e = at > 0 ? brighter(own, { opacity: 1, bar: at, glow: at }) : own;
    return skipped.has(key) ? { ...e, opacity: e.opacity * skipFade } : e;
  };
  /** An item is at least as bright as its own band, so focusing a layer lights what is in it, unless the request never reached it. */
  const itemEmphasis = (id: string, layer: string) => {
    const own = emphasis(`i:${id}`);
    return skipped.has(`i:${id}`) ? own : asBrightAs(own, [emphasis(`l:${layer}`)]);
  };
  const appearAt = (i: number, delay = 0) => spring({ frame: frame - START - i * BAND_STAGGER - delay, fps, config: { damping: 18, stiffness: 140 } });

  const replyTone = tones[skip?.tone ?? (skip ? 'warn' : 'good')];
  const token = rail && visits.length ? tokenPoint(scene, layout, p) : null;
  const tokenIn = interpolate(p, [-1, -0.2], [0, 1], clamp);
  const guideIn = interpolate(frame, [START + 30, START + 45], [0, 1], clamp);
  const yOf = (i: number) => layout.yOf.get(visits[Math.max(0, Math.min(visits.length - 1, i))]!.key)!;
  const stopKeys = [...visits.filter((v) => v.leg === 'down').map((v) => v.key), ...route.skipped];
  const lastY = stopKeys.length ? layout.yOf.get(stopKeys[stopKeys.length - 1]!)! : 0;
  const downTo = token ? (p >= turn ? yOf(turn) : token.y) : 0;
  const turnBand = skip && visits.length ? layout.layers[layerOf(scene, visits[turn]!.key)] : undefined;
  const turnBar = turnBand ? { y: turnBand.y + turnBand.h + BAND_GAP / 2 } : null;

  return (
    <SceneShell scene={scene} durationInFrames={durationInFrames}>
      <div style={{ position: 'absolute', left: stage.left, top: stage.top, width: layout.width, height: layout.height, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        {layout.layers.map((placed) => (
          <Band
            key={placed.layer.id}
            placed={placed}
            layout={layout}
            appear={appearAt(placed.index)}
            emphasis={asBrightAs(emphasis(`l:${placed.layer.id}`), placed.items.map((it) => itemEmphasis(it.item.id, placed.layer.id)))}
          />
        ))}
        {rail && token ? (
          <svg style={{ position: 'absolute', inset: 0, overflow: 'visible' }} width="100%" height="100%">
            {stopKeys.map((key, i) => {
              const wire = layout.wires.get(key)!;
              const end = wire[wire.length - 1]!;
              const reached = i <= turn && p >= i - 0.05;
              const fade = skipped.has(key) ? skipFade : 1;
              return (
                <g key={key} opacity={guideIn * fade}>
                  <polyline
                    points={wire.map((pt) => `${pt.x},${pt.y}`).join(' ')}
                    fill="none"
                    stroke={reached ? colors.accent : colors.faint}
                    strokeOpacity={reached ? 0.8 : 0.5}
                    strokeWidth={reached ? 3 : 2}
                    strokeDasharray={reached ? undefined : '2 8'}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx={end.x} cy={end.y} r={6} fill={reached ? colors.accent : colors.bg} stroke={reached ? colors.accent : colors.faint} strokeWidth={2} />
                </g>
              );
            })}
            <line x1={rail.downX} x2={rail.downX} y1={yOf(0) - 40} y2={lastY} stroke={colors.faint} strokeWidth={2.5} strokeDasharray="2 9" strokeLinecap="round" opacity={guideIn} />
            {p > -0.2 ? <line x1={rail.downX} x2={rail.downX} y1={yOf(0)} y2={downTo} stroke={colors.accent} strokeWidth={4} strokeLinecap="round" /> : null}
            {p > turn ? (
              <>
                <path d={`M ${rail.downX} ${yOf(turn)} H ${Math.min(token.x, rail.upX)}`} stroke={replyTone.color} strokeWidth={4} strokeLinecap="round" fill="none" />
                <line x1={rail.upX} x2={rail.upX} y1={yOf(turn)} y2={token.y} stroke={replyTone.color} strokeWidth={4} strokeLinecap="round" opacity={back} />
              </>
            ) : null}
            {turnBar && rail ? <line x1={rail.downX - 16} x2={rail.downX + 16} y1={turnBar.y} y2={turnBar.y} stroke={replyTone.color} strokeWidth={6} strokeLinecap="round" opacity={back} /> : null}
            <circle cx={token.x} cy={token.y} r={DOT_R + 8} fill={p > turn ? replyTone.color : colors.accent} opacity={0.25 * tokenIn} />
            <circle cx={token.x} cy={token.y} r={DOT_R} fill={p > turn ? replyTone.color : colors.accent} stroke={colors.bg} strokeWidth={3} opacity={tokenIn} />
          </svg>
        ) : null}
        {layout.layers.flatMap((placed) =>
          placed.items.map((it, j) => (
            <NodeCard key={it.item.id} node={it.item} x={it.x} y={it.y} width={it.w} height={it.h} size="compact" appear={appearAt(placed.index, 6 + 2 * j)} emphasis={itemEmphasis(it.item.id, placed.layer.id)} text={it.text} />
          )),
        )}
        {rail && token ? (
          <>
            {rail.label ? (
              <Pill x={token.x + PILL_GAP} y={token.y} w={rail.label.width + 2 * PILL_PAD_X} color={colors.accent} bg={colors.accentSoft} opacity={tokenIn * Math.max(0, 1 - 2 * back)}>
                <FitText fit={rail.label} inline />
              </Pill>
            ) : null}
            {rail.reply && p > turn ? (
              <Pill x={token.x + PILL_GAP} y={token.y} w={rail.reply.width + 2 * PILL_PAD_X} color={replyTone.color} bg={replyTone.bg} opacity={Math.max(0, 2 * back - 1)}>
                <FitText fit={rail.reply} inline />
              </Pill>
            ) : null}
          </>
        ) : null}
      </div>
      <PenMarks scene={scene} hunks={hunks} segments={segments} targets={() => marks} />
    </SceneShell>
  );
};
