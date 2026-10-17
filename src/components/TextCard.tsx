import { AlertTriangle, FileCode2, ShieldAlert, ShieldCheck, type LucideIcon } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { sceneStates } from '../../shared/state-steps.mjs';
import { targetSteps } from '../../shared/targets.mjs';
import type { HunkMap, Risk, TextScene, Tone } from '../types';
import type { Box, MarkTargets } from '../utils/penGeometry';
import { focusSpotlight, type Emphasis } from '../utils/spotlight';
import { shownOf, stateFrame } from '../utils/stateTrack';
import { countText, GAP, layoutText, QUESTION_ROOM, RULE, SIDE_GUTTER, type TextBlock } from '../utils/textLayout';
import { FitText } from './FitText';
import { PenMarks } from './PenMarks';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { clamp, colors, fonts, riskColors } from './theme';
import { tones } from './tones';

const riskIcon: Record<Risk, LucideIcon> = { low: ShieldCheck, medium: AlertTriangle, high: ShieldAlert };
const LIT_SHIFT = 12;
const figureFill = (tone?: Tone) => `linear-gradient(180deg, #ffffff 10%, ${tone && tone !== 'accent' ? `${tones[tone].color}aa` : '#c7cdff'} 60%, ${tone ? tones[tone].color : colors.accent} 100%)`;

function diffStats(hunks: HunkMap) {
  const all = Object.values(hunks).filter((h) => h.status !== 'source');
  return { files: new Set(all.map((h) => h.file)).size, additions: all.reduce((s, h) => s + h.additions, 0), deletions: all.reduce((s, h) => s + h.deletions, 0) };
}

const Chip: React.FC<{ color?: string; children: React.ReactNode }> = ({ color = colors.muted, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', borderRadius: 999, border: `1px solid ${colors.border}`, background: 'rgba(255,255,255,0.04)', color, fontFamily: fonts.mono, fontSize: 24, fontWeight: 600 }}>
    {children}
  </div>
);

const RiskBadge: React.FC<{ risk: Risk; appear: number }> = ({ risk, appear }) => {
  const RiskIcon = riskIcon[risk];
  const c = riskColors[risk];
  return (
    <div style={{ marginTop: GAP.risk, height: GAP.riskH, boxSizing: 'border-box', alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 12, padding: '0 22px 0 16px', borderRadius: 999, background: `${c}1f`, border: `1px solid ${c}66`, color: c, fontSize: 24, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', transform: `scale(${0.85 + 0.15 * appear})`, transformOrigin: 'left center', opacity: appear }}>
      <RiskIcon size={26} strokeWidth={2.4} />
      {risk} risk
    </div>
  );
};

/** Where `el` sits inside `root`, from layout offsets, which transforms and the player's scaling leave alone. */
function boxIn(el: HTMLElement, root: HTMLElement): Box {
  let [x, y] = [0, 0];
  for (let at: HTMLElement | null = el; at && at !== root; at = at.offsetParent as HTMLElement | null) {
    x += at.offsetLeft;
    y += at.offsetTop;
  }
  return { x, y, width: el.offsetWidth, height: el.offsetHeight };
}

interface BlockProps {
  block: TextBlock;
  /** 0 to 1: how far the figure has counted up. */
  counted: number;
  appear: (delay: number) => number;
  lead: Emphasis;
  note: Emphasis;
  tone?: Tone;
  refs?: (key: string) => (el: HTMLDivElement | null) => void;
}

/** A kicker, a lead drawn as its field says, and the note under it. */
const Block: React.FC<BlockProps> = ({ block, counted, appear, lead, note, tone, refs }) => {
  const { kicker } = block;
  const l = block.lead;
  const enter = (delay: number, e: Emphasis): CSSProperties => ({ opacity: appear(delay) * e.opacity, transform: `translateY(${(1 - appear(delay)) * 24}px)` });
  const ink = tone ? tones[tone].color : colors.accent;
  return (
    <div style={{ position: 'relative' }}>
      {kicker ? <FitText fit={kicker} style={{ color: colors.muted, marginBottom: GAP.kicker, opacity: appear(2), lineHeight: kicker.lineHeight }} /> : null}
      {l ? (
        <div ref={refs?.('t:lead')} style={{ position: 'relative', ...enter(5, lead) }}>
          {l.kind === 'quote' ? (
            <div style={{ position: 'absolute', right: '100%', marginRight: l.main.size * 0.3, top: -l.main.size * 0.5, fontSize: l.main.size * 3.2, lineHeight: 1, fontWeight: 800, color: ink, opacity: 0.9 }}>“</div>
          ) : null}
          {l.kind === 'number' && l.unit ? (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: l.main.size * 0.1 }}>
              <Figure block={block} counted={counted} tone={tone} />
              <FitText fit={l.unit} style={{ color: colors.muted, lineHeight: 1.05 }} />
            </div>
          ) : l.kind === 'number' ? (
            <Figure block={block} counted={counted} tone={tone} />
          ) : (
            <FitText fit={l.main} style={{ color: colors.text }} />
          )}
        </div>
      ) : null}
      {block.note ? (
        <div ref={refs?.('t:note')} style={{ marginTop: GAP.note, ...enter(14, note) }}>
          {l?.kind === 'term' ? <div style={{ width: RULE.width, height: RULE.height, borderRadius: 4, background: ink, margin: `${GAP.rule - GAP.note}px 0 ${GAP.rule}px` }} /> : null}
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            {l?.kind === 'quote' ? <div style={{ width: 40, height: 3, background: ink, borderRadius: 2, flexShrink: 0 }} /> : null}
            <FitText fit={block.note} style={{ color: note.glow > 0 ? colors.text : l?.kind === 'term' || l?.kind === 'number' ? 'rgba(242,244,248,0.88)' : colors.muted }} />
          </div>
        </div>
      ) : null}
    </div>
  );
};

/** A number's figure in display type, counting up to its value as it appears. */
const Figure: React.FC<{ block: TextBlock; counted: number; tone?: Tone }> = ({ block, counted, tone }) => {
  const l = block.lead!;
  const text = l.count && counted < 1 ? countText(l.count, counted) : l.main.text;
  return (
    <div style={{ fontSize: l.main.size, fontWeight: 800, letterSpacing: l.main.font.letterSpacing, lineHeight: 1, fontVariantNumeric: 'tabular-nums', whiteSpace: 'pre', background: figureFill(tone), WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', paddingBottom: l.main.size * 0.04 }}>
      {text}
    </div>
  );
};

export const TextCard: React.FC<SceneProps<TextScene>> = ({ scene, hunks, durationInFrames, segments }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const states = useMemo(() => sceneStates(scene), [scene]);
  const layouts = useMemo(() => states.map((st) => layoutText(scene, st.values)), [scene, states]);
  const lit = useMemo(() => new Set([...targetSteps(scene, hunks).keys()].map((k) => k.slice(0, k.indexOf(':')))), [scene, hunks]);
  const s = stateFrame(states, segments, frame);
  const focus = focusSpotlight(scene, hunks, segments, frame);
  const calm: Emphasis = { opacity: 1, bar: 0, glow: 0 };
  // A part dims while others are lit only when some step lights a part of its kind.
  const emphasis = (key: string): Emphasis => (lit.has(key.slice(0, key.indexOf(':'))) ? focus(key) : calm);
  const pop = (delay: number) => spring({ frame: frame - delay, fps, config: { damping: 18, stiffness: 120 } });
  const counted = interpolate(frame, [6, 46], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const stats = diffStats(hunks);

  const k = states.indexOf(s.now);
  const before = layouts[states.indexOf(s.before)]!;
  const now = layouts[k]!;
  const swapped = before.block !== now.block && (s.before.values['t:lead'] !== s.now.values['t:lead'] || s.before.values['t:note'] !== s.now.values['t:note'] || s.before.values['t:kicker'] !== s.now.values['t:kicker']);
  const layout = now;
  const isQuestion = layout.block.lead?.kind === 'question';

  const root = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLDivElement>());
  const refs = (key: string) => (el: HTMLDivElement | null) => {
    if (el) els.current.set(key, el);
  };
  const [marks, setMarks] = useState<MarkTargets | null>(null);
  const marked = scene.steps?.some((step) => step.mark) ?? false;
  useLayoutEffect(() => {
    if (!marked || !root.current) return;
    const area = { x: 0, y: 0, width: root.current.offsetWidth, height: root.current.offsetHeight };
    const boxes = [...els.current].map(([key, el]): [string, Box] => [key, boxIn(el, root.current!)]);
    const next = { boxes: new Map(boxes), obstacles: boxes.map(([, b]) => b), area };
    setMarks((m) => (m && JSON.stringify([...m.boxes, m.area]) === JSON.stringify([...next.boxes, next.area]) ? m : next));
  });

  const blockOf = (b: TextBlock, extra: CSSProperties = {}) => (
    <div style={extra}>
      <Block block={b} counted={counted} appear={pop} lead={emphasis('t:lead')} note={{ ...emphasis('t:note'), opacity: emphasis('t:note').opacity * shownOf(s, 't:note') }} refs={refs} />
    </div>
  );

  return (
    <SceneShell
      scene={scene}
      durationInFrames={durationInFrames}
      aside={
        scene.diffstat && stats.files ? (
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
      <div ref={root} style={{ position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%' }}>
        {isQuestion ? (
          <div style={{ position: 'absolute', right: 0, top: '50%', width: `${QUESTION_ROOM * 100}%`, display: 'flex', justifyContent: 'center', transform: `translateY(-50%) scale(${0.9 + 0.1 * pop(10)})`, opacity: pop(10) * emphasis('t:lead').opacity }}>
            <div style={{ fontSize: Math.min(640, layout.height * 1.25 + 160), fontWeight: 800, lineHeight: 0.8, background: `linear-gradient(160deg, ${colors.accent} 0%, rgba(124,140,255,0.08) 85%)`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>?</div>
          </div>
        ) : null}
        {swapped ? (
          <div style={{ display: 'grid' }}>
            {blockOf(before.block, { gridArea: '1 / 1', opacity: 1 - s.t, transform: `translateY(${-20 * s.t}px)` })}
            {blockOf(now.block, { gridArea: '1 / 1', opacity: s.t, transform: `translateY(${20 * (1 - s.t)}px)` })}
          </div>
        ) : (
          blockOf(layout.block)
        )}
        {scene.risk ? <RiskBadge risk={scene.risk} appear={pop(12)} /> : null}
        {layout.items.length ? (
          <div style={{ marginTop: GAP.list, display: 'flex', flexDirection: 'column', gap: GAP.item }}>
            {layout.items.map((item, i) => {
              const p = pop(20 + i * 7) * shownOf(s, `b:${i}`);
              const e = emphasis(`b:${i}`);
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 22, opacity: p * e.opacity, transform: `translateX(${(1 - p) * -36 + LIT_SHIFT * e.glow}px)` }}>
                  <div style={{ width: 12, height: 12, borderRadius: 4, background: colors.accent, boxShadow: `0 0 ${16 + 20 * e.glow}px ${colors.accentGlow}`, flexShrink: 0, transform: `translateY(-6px) scale(${1 + 0.5 * e.glow})` }} />
                  <div ref={refs(`b:${i}`)} style={{ color: e.glow > 0 ? colors.text : 'rgba(242,244,248,0.9)' }}>
                    <FitText fit={item} weight={e.glow > 0 ? 600 : 400} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
        {layout.sides ? (
          <div style={{ marginTop: layout.block.height ? GAP.list : 0, display: 'grid', gridTemplateColumns: `1fr ${SIDE_GUTTER * 2}px 1fr`, alignItems: 'start' }}>
            {layout.sides.map((side, i) => {
              const own = scene.sides![i]!;
              const ink = own.tone ? tones[own.tone].color : i === 0 ? tones.neutral.color : colors.accent;
              const e = emphasis(`sd:${i}`);
              const p = pop(12 + i * 10) * shownOf(s, `sd:${i}`);
              return [
                i === 1 ? (
                  <div key="rule" style={{ alignSelf: 'stretch', display: 'flex', justifyContent: 'center', opacity: pop(18) }}>
                    <div style={{ width: 2, background: colors.border }} />
                  </div>
                ) : null,
                <div key={i} ref={refs(`sd:${i}`)} style={{ opacity: p * e.opacity, transform: `translateY(${(1 - p) * 24}px)` }}>
                  {side.label ? <FitText fit={side.label} style={{ color: ink, marginBottom: GAP.sideLabel }} /> : null}
                  <Block block={side.block} counted={counted} appear={() => 1} lead={calm} note={calm} tone={own.tone} />
                  {side.items.length ? (
                    <div style={{ marginTop: GAP.sideList, display: 'flex', flexDirection: 'column', gap: GAP.sideItem }}>
                      {side.items.map((item, j) => (
                        <div key={j} style={{ display: 'flex', alignItems: 'baseline', gap: 22 }}>
                          <div style={{ width: 10, height: 10, borderRadius: 3, background: ink, flexShrink: 0, transform: 'translateY(-5px)' }} />
                          <FitText fit={item} weight={500} style={{ color: 'rgba(242,244,248,0.9)' }} />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>,
              ];
            })}
          </div>
        ) : null}
      </div>
      {marks ? <PenMarks scene={scene} hunks={hunks} segments={segments} targets={() => marks} /> : null}
    </SceneShell>
  );
};
