import { AlertTriangle, FileCode2, ShieldAlert, ShieldCheck, type LucideIcon } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { HunkMap, IntentScene, Risk } from '../types';
import type { Box, MarkTargets } from '../utils/penGeometry';
import { focusSpotlight } from '../utils/spotlight';
import { PenMarks } from './PenMarks';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { clamp, clampLines, colors, defaultChapter, ellipsis, fitFontSize, fonts, riskColors } from './theme';

const riskIcon: Record<Risk, LucideIcon> = { low: ShieldCheck, medium: AlertTriangle, high: ShieldAlert };

/** Totals over changed hunks; source snippets change nothing, so an explanation shows no stats. */
function diffStats(hunks: HunkMap) {
  const all = Object.values(hunks).filter((h) => h.status !== 'source');
  return {
    files: new Set(all.map((h) => h.file)).size,
    additions: all.reduce((s, h) => s + h.additions, 0),
    deletions: all.reduce((s, h) => s + h.deletions, 0),
  };
}

const Chip: React.FC<{ color?: string; children: React.ReactNode }> = ({ color = colors.muted, children }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '10px 18px',
      borderRadius: 999,
      border: `1px solid ${colors.border}`,
      background: 'rgba(255,255,255,0.04)',
      color,
      fontFamily: fonts.mono,
      fontSize: 24,
      fontWeight: 600,
    }}
  >
    {children}
  </div>
);

/** Where `el` sits inside `root`, from layout offsets, which transforms and the player's scaling leave alone. */
function boxIn(el: HTMLElement, root: HTMLElement): Box {
  let [x, y] = [0, 0];
  for (let at: HTMLElement | null = el; at && at !== root; at = at.offsetParent as HTMLElement | null) {
    x += at.offsetLeft;
    y += at.offsetTop;
  }
  return { x, y, width: el.offsetWidth, height: el.offsetHeight };
}

/** A lit bullet slides this far right. */
const LIT_SHIFT = 12;

const RiskBadge: React.FC<{ risk: Risk; appear: number }> = ({ risk, appear }) => {
  const RiskIcon = riskIcon[risk];
  const riskColor = riskColors[risk];
  return (
    <div
      style={{
        marginTop: 32,
        alignSelf: 'flex-start',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 22px 10px 16px',
        borderRadius: 999,
        background: `${riskColor}1f`,
        border: `1px solid ${riskColor}66`,
        color: riskColor,
        fontSize: 24,
        fontWeight: 700,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        transform: `scale(${0.85 + 0.15 * appear})`,
        transformOrigin: 'left center',
        opacity: appear,
      }}
    >
      <RiskIcon size={26} strokeWidth={2.4} />
      {risk} risk
    </div>
  );
};

export const IntentCard: React.FC<SceneProps<IntentScene>> = ({ scene, hunks, storyboard, durationInFrames, segments }) => {
  const frame = useCurrentFrame();
  const emphasisOf = focusSpotlight(scene, hunks, segments, frame);
  const { fps } = useVideoConfig();
  const stats = diffStats(hunks);
  const pop = (delay: number) => spring({ frame: frame - delay, fps, config: { damping: 18, stiffness: 120 } });
  const bullets = scene.bullets.slice(0, 6);
  const bulletSize = bullets.length > 4 ? 32 : 36;
  // The card flows like a page, so it is the one scene that measures where its bullets landed.
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const texts = useRef<(HTMLDivElement | null)[]>([]);
  const [marks, setMarks] = useState<MarkTargets | null>(null);
  const marked = scene.steps?.some((step) => step.mark) ?? false;
  useLayoutEffect(() => {
    if (!marked || !root.current || !list.current) return;
    const area = { x: 0, y: 0, width: root.current.offsetWidth, height: root.current.offsetHeight };
    const bulletBoxes = texts.current.flatMap((el, i): [string, Box][] => {
      if (!el) return [];
      const b = boxIn(el, root.current!);
      return [[`b:${i}`, { ...b, x: b.x - 34 + LIT_SHIFT, width: b.width + 34 }]];
    });
    const above = { x: 0, y: 0, width: area.width, height: boxIn(list.current, root.current).y - 8 };
    const next = { boxes: new Map(bulletBoxes), obstacles: [above, ...bulletBoxes.map(([, b]) => b)], area };
    // Measured after every render, since the card can be laid out before it is shown; set only on a change.
    setMarks((now) => (now && JSON.stringify([...now.boxes, now.area]) === JSON.stringify([...next.boxes, next.area]) ? now : next));
  });

  return (
    <SceneShell
      durationInFrames={durationInFrames}
      eyebrow={scene.chapter ?? defaultChapter.intent}
      aside={
        stats.files ? (
          <div style={{ display: 'flex', gap: 12, opacity: interpolate(frame, [10, 22], [0, 1], clamp) }}>
            <Chip>
              <FileCode2 size={22} />
              {stats.files} {stats.files === 1 ? 'file' : 'files'}
            </Chip>
            <Chip color={colors.add}>+{stats.additions}</Chip>
            <Chip color={colors.del}>−{stats.deletions}</Chip>
          </div>
        ) : undefined
      }
    >
      <div ref={root} style={{ position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%', paddingBottom: 24, boxSizing: 'border-box' }}>
        <div style={{ fontSize: 28, color: colors.muted, fontWeight: 500, ...ellipsis }}>
          {storyboard.title}
          {storyboard.subtitle ? <span style={{ color: colors.faint }}>{'  ·  '}{storyboard.subtitle}</span> : null}
        </div>
        <div
          style={{
            marginTop: 22,
            fontSize: fitFontSize(scene.summary, 68, 90, 44),
            lineHeight: 1.12,
            fontWeight: 700,
            letterSpacing: -1.5,
            maxWidth: 1580,
            ...clampLines(3),
            transform: `translateY(${(1 - pop(4)) * 24}px)`,
            opacity: pop(4),
          }}
        >
          {scene.summary}
        </div>
        {scene.risk ? <RiskBadge risk={scene.risk} appear={pop(12)} /> : null}
        <div ref={list} style={{ marginTop: 44, display: 'flex', flexDirection: 'column', gap: 20, minHeight: 0 }}>
          {bullets.map((bullet, i) => {
            const p = pop(20 + i * 7);
            const e = emphasisOf(`b:${i}`);
            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 22,
                  opacity: p * e.opacity,
                  transform: `translateX(${(1 - p) * -36 + 12 * e.glow}px)`,
                }}
              >
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 4,
                    background: colors.accent,
                    boxShadow: `0 0 ${16 + 20 * e.glow}px ${colors.accentGlow}`,
                    flexShrink: 0,
                    transform: `translateY(-6px) scale(${1 + 0.5 * e.glow})`,
                  }}
                />
                <div ref={(el) => { texts.current[i] = el; }} style={{ fontSize: bulletSize, lineHeight: 1.3, color: e.glow > 0 ? colors.text : 'rgba(242,244,248,0.9)', fontWeight: e.glow > 0 ? 600 : 400, ...ellipsis }}>{bullet}</div>
              </div>
            );
          })}
        </div>
      </div>
      {marks ? <PenMarks scene={scene} hunks={hunks} segments={segments} targets={() => marks} /> : null}
    </SceneShell>
  );
};
