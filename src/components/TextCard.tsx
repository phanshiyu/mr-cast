import { AlertTriangle, FileCode2, ShieldAlert, ShieldCheck, type LucideIcon } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { targetSteps } from '../../shared/targets.mjs';
import type { Fit } from '../../shared/textfit.mjs';
import type { HunkMap, Risk, TextScene, Tone } from '../types';
import type { Box, MarkTargets } from '../utils/penGeometry';
import { currentStep, focusSpotlight, type Emphasis } from '../utils/spotlight';
import { shownOf, stateFrame } from '../utils/stateTrack';
import { countText, GAP, layoutText, QUESTION_ROOM, QUOTE_MARK, RULE, SIDE_GUTTER, textStates, type LeadFit, type TextBlock } from '../utils/textLayout';
import { FitText } from './FitText';
import { PenMarks } from './PenMarks';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { clamp, colors, fonts, riskColors } from './theme';
import { tones } from './tones';

const riskIcon: Record<Risk, LucideIcon> = { low: ShieldCheck, medium: AlertTriangle, high: ShieldAlert };
/** A lit item slides this far right. */
const LIT_SHIFT = 12;
/** Frames a figure takes to count to a value a step sets. */
const RECOUNT_FRAMES = 30;
const figureFill = (tone?: Tone) => `linear-gradient(180deg, #ffffff 10%, ${tone && tone !== 'accent' ? `${tones[tone].color}aa` : '#c7cdff'} 60%, ${tone ? tones[tone].color : colors.accent} 100%)`;
const calm: Emphasis = { opacity: 1, bar: 0, glow: 0 };

/** Totals over changed hunks; source snippets change nothing, so an explanation shows no stats. */
function diffStats(hunks: HunkMap) {
  const all = Object.values(hunks).filter((h) => h.status !== 'source');
  return { files: new Set(all.map((h) => h.file)).size, additions: all.reduce((s, h) => s + h.additions, 0), deletions: all.reduce((s, h) => s + h.deletions, 0) };
}

const Chip: React.FC<{ color?: string; children: ReactNode }> = ({ color = colors.muted, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', borderRadius: 999, border: `1px solid ${colors.border}`, background: 'rgba(255,255,255,0.04)', color, fontFamily: fonts.mono, fontSize: 24, fontWeight: 600 }}>
    {children}
  </div>
);

const RiskBadge: React.FC<{ risk: Risk; appear: number }> = ({ risk, appear }) => {
  const RiskIcon = riskIcon[risk];
  const c = riskColors[risk];
  return (
    <div style={{ marginTop: GAP.risk, alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 22px 10px 16px', borderRadius: 999, background: `${c}1f`, border: `1px solid ${c}66`, color: c, fontSize: 24, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', transform: `scale(${0.85 + 0.15 * appear})`, transformOrigin: 'left center', opacity: appear }}>
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

/** The old and the new of a part a step rewrote, crossfading in one place; just the new when nothing changed. */
const Swap: React.FC<{ before: ReactNode; after: ReactNode; t: number }> = ({ before, after, t }) =>
  before === null || t >= 1 ? (
    <>{after}</>
  ) : (
    <div style={{ display: 'grid' }}>
      <div style={{ gridArea: '1 / 1', opacity: 1 - t, transform: `translateY(${-20 * t}px)` }}>{before}</div>
      <div style={{ gridArea: '1 / 1', opacity: t, transform: `translateY(${20 * (1 - t)}px)` }}>{after}</div>
    </div>
  );

const sameFit = (a: Fit | null | undefined, b: Fit | null | undefined) => a?.text === b?.text && a?.size === b?.size;

/** A number's figure in display type: `text` is the figure as it counts. */
const Figure: React.FC<{ lead: LeadFit; text: string; tone?: Tone }> = ({ lead, text, tone }) => (
  <div style={{ fontSize: lead.main.size, fontWeight: 800, letterSpacing: lead.main.font.letterSpacing, lineHeight: 1, fontVariantNumeric: 'tabular-nums', whiteSpace: 'pre', background: figureFill(tone), WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', paddingBottom: lead.main.size * 0.04 }}>
    {text}
  </div>
);

/** A lead drawn as its field says; a number's figure written as `figure` while it counts. */
const Lead: React.FC<{ lead: LeadFit; figure: string | null; tone?: Tone }> = ({ lead, figure, tone }) => {
  if (lead.kind !== 'number' || !lead.count) return <FitText fit={lead.main} style={{ color: colors.text }} />;
  const shown = <Figure lead={lead} text={figure ?? lead.main.text} tone={tone} />;
  return lead.unit ? (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: lead.main.size * 0.1 }}>
      {shown}
      <FitText fit={lead.unit} style={{ color: colors.muted, lineHeight: 1.05 }} />
    </div>
  ) : (
    shown
  );
};

interface BlockProps {
  block: TextBlock;
  /** The block before the current step rewrote it, while the step's change plays. */
  before: TextBlock | null;
  /** 0 to 1: how far a rewrite has gone. */
  t: number;
  /** A number's figure as it counts, or null to draw it as written. */
  figure: string | null;
  appear: (delay: number) => number;
  lead: Emphasis;
  note: Emphasis;
  kicker: Emphasis;
  tone?: Tone;
  refs?: (key: string) => (el: HTMLDivElement | null) => void;
}

/** A kicker, a lead drawn as its field says, and the note under it; a quote's mark in the room it leaves at the left. */
const Block: React.FC<BlockProps> = ({ block, before, t, figure, appear, lead, note, kicker, tone, refs }) => {
  const l = block.lead;
  const enter = (delay: number, e: Emphasis): CSSProperties => ({ opacity: appear(delay) * e.opacity, transform: `translateY(${(1 - appear(delay)) * 24}px)` });
  const ink = tone ? tones[tone].color : colors.accent;
  const was = <T,>(changed: boolean, node: T) => (before && changed ? node : null);
  const counting = l?.kind === 'number' && figure !== null;
  const noteOf = (b: TextBlock) =>
    b.note ? (
      <>
        {b.lead?.kind === 'term' ? <div style={{ width: RULE.width, height: RULE.height, borderRadius: 4, background: ink, margin: `${GAP.rule - GAP.note}px 0 ${GAP.rule}px` }} /> : null}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          {b.lead?.kind === 'quote' ? <div style={{ width: 40, height: 3, background: ink, borderRadius: 2, flexShrink: 0 }} /> : null}
          <FitText fit={b.note} style={{ color: note.glow > 0 ? colors.text : b.lead?.kind === 'term' || b.lead?.kind === 'number' ? 'rgba(242,244,248,0.88)' : colors.muted }} />
        </div>
      </>
    ) : null;
  return (
    <div style={{ position: 'relative', paddingLeft: block.indent }}>
      {block.kicker ? (
        <div ref={refs?.('t:kicker')} style={{ width: 'fit-content', marginBottom: GAP.kicker, opacity: appear(2) * kicker.opacity }}>
          <Swap t={t} before={was(!sameFit(before?.kicker, block.kicker), before?.kicker ? <FitText fit={before.kicker} style={{ color: colors.muted }} /> : null)} after={<FitText fit={block.kicker} style={{ color: colors.muted }} />} />
        </div>
      ) : null}
      {l ? (
        <div ref={refs?.('t:lead')} style={{ position: 'relative', width: 'fit-content', ...enter(5, lead) }}>
          {l.kind === 'quote' ? (
            <div style={{ position: 'absolute', left: -block.indent, top: -l.main.size * 0.5, fontSize: l.main.size * QUOTE_MARK.scale, lineHeight: 1, fontWeight: 800, color: ink, opacity: 0.9 }}>“</div>
          ) : null}
          <Swap t={t} before={was(!counting && !sameFit(before?.lead?.main, l.main), before?.lead ? <Lead lead={before.lead} figure={null} tone={tone} /> : null)} after={<Lead lead={l} figure={figure} tone={tone} />} />
        </div>
      ) : null}
      {block.note ? (
        <div ref={refs?.('t:note')} style={{ width: 'fit-content', marginTop: GAP.note, ...enter(14, note) }}>
          <Swap t={t} before={was(!sameFit(before?.note, block.note), before ? noteOf(before) : null)} after={noteOf(block)} />
        </div>
      ) : null}
    </div>
  );
};

export const TextCard: React.FC<SceneProps<TextScene>> = ({ scene, hunks, durationInFrames, segments }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const states = useMemo(() => textStates(scene), [scene]);
  const layouts = useMemo(() => states.map((st) => layoutText(scene, st.values, st.paths)), [scene, states]);
  const lit = useMemo(() => new Set([...targetSteps(scene, hunks).keys()].map((k) => k.slice(0, k.indexOf(':')))), [scene, hunks]);
  const s = stateFrame(states, segments, frame);
  const focus = focusSpotlight(scene, hunks, segments, frame);
  // A part dims while others are lit only when some step lights a part of its kind.
  const emphasis = (key: string): Emphasis => {
    const e = lit.has(key.slice(0, key.indexOf(':'))) ? focus(key) : calm;
    return { ...e, opacity: e.opacity * shownOf(s, key) };
  };
  const pop = (delay: number) => spring({ frame: frame - delay, fps, config: { damping: 18, stiffness: 120 } });
  const stats = diffStats(hunks);

  const k = currentStep(segments, frame);
  const nowAt = k >= 0 && layouts[k + 1] ? k + 1 : 0;
  const layout = layouts[nowAt]!;
  const before = nowAt > 0 ? layouts[nowAt - 1]!.block : null;

  // A number counts up from 0 as the scene opens, and from the figure before when a step sets a new one.
  const lead = layout.block.lead;
  const from = before?.lead?.count ?? null;
  const recount = nowAt > 0 && before?.lead?.main.text !== lead?.main.text && from !== null;
  const counted = recount
    ? interpolate(frame, [segments[nowAt]!.from, segments[nowAt]!.from + RECOUNT_FRAMES], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })
    : interpolate(frame, [6, 46], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const figure = lead?.count ? (counted < 1 ? countText(lead.count, counted, recount ? from : null) : lead.main.text) : null;

  const root = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLDivElement>());
  const refs = (key: string) => (el: HTMLDivElement | null) => {
    if (el) els.current.set(key, el);
    else els.current.delete(key);
  };
  const [marks, setMarks] = useState<MarkTargets | null>(null);
  const marked = scene.steps?.some((step) => step.mark || step.draw) ?? false;
  useLayoutEffect(() => {
    if (!marked || !root.current) return;
    const area = { x: 0, y: 0, width: root.current.offsetWidth, height: root.current.offsetHeight };
    const boxes = [...els.current].map(([key, el]): [string, Box] => {
      const b = boxIn(el, root.current!);
      // An item's box takes in its dot, where it sits once lit.
      return [key, key.startsWith('b:') ? { ...b, x: b.x - 34 + LIT_SHIFT, width: b.width + 34 } : b];
    });
    const next = { boxes: new Map(boxes), obstacles: boxes.map(([, b]) => b), area };
    // Measured after every render, since the card can be laid out before it is shown; set only on a change.
    setMarks((m) => (m && JSON.stringify([...m.boxes, m.area]) === JSON.stringify([...next.boxes, next.area]) ? m : next));
  });

  const changing = before !== null && s.t < 1;
  return (
    <SceneShell
      scene={scene}
      durationInFrames={durationInFrames}
      camera={{ hunks, segments, targets: () => marks }}
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
      <div ref={root} style={{ position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%', paddingBottom: GAP.bottom, boxSizing: 'border-box' }}>
        {layout.mark ? (
          <div style={{ position: 'absolute', right: 0, top: '50%', width: `${QUESTION_ROOM * 100}%`, display: 'flex', justifyContent: 'center', transform: `translateY(-50%) scale(${0.9 + 0.1 * pop(10)})`, opacity: pop(10) * emphasis('t:lead').opacity }}>
            <div style={{ fontSize: layout.mark.size, fontWeight: 800, lineHeight: 0.8, background: `linear-gradient(160deg, ${colors.accent} 0%, rgba(124,140,255,0.08) 85%)`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>?</div>
          </div>
        ) : null}
        <Block block={layout.block} before={changing ? before : null} t={s.t} figure={figure} appear={pop} lead={emphasis('t:lead')} note={emphasis('t:note')} kicker={emphasis('t:kicker')} refs={refs} />
        {scene.risk ? <RiskBadge risk={scene.risk} appear={pop(12)} /> : null}
        {layout.items.length ? (
          <div style={{ marginTop: GAP.list, display: 'flex', flexDirection: 'column', gap: GAP.item }}>
            {layout.items.map((item, i) => {
              const p = pop(20 + i * 7);
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
          <div style={{ marginTop: layout.block.height ? GAP.list : 0, width: layout.mark ? `${(1 - QUESTION_ROOM) * 100}%` : undefined, display: 'grid', gridTemplateColumns: `1fr ${SIDE_GUTTER * 2}px 1fr`, alignItems: 'start' }}>
            {layout.sides.map((side, i) => {
              const own = scene.sides![i]!;
              const ink = own.tone ? tones[own.tone].color : i === 0 ? tones.neutral.color : colors.accent;
              const e = emphasis(`sd:${i}`);
              const p = pop(12 + i * 10);
              const sideFigure = side.block.lead?.count ? countText(side.block.lead.count, interpolate(frame, [6, 46], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })) : null;
              return [
                i === 1 ? (
                  <div key="rule" style={{ alignSelf: 'stretch', display: 'flex', justifyContent: 'center', opacity: pop(18) }}>
                    <div style={{ width: 2, background: colors.border }} />
                  </div>
                ) : null,
                <div key={i} ref={refs(`sd:${i}`)} style={{ opacity: p * e.opacity, transform: `translateY(${(1 - p) * 24}px)` }}>
                  {side.label ? <FitText fit={side.label} style={{ color: ink, marginBottom: GAP.sideLabel }} /> : null}
                  <Block block={side.block} before={null} t={1} figure={sideFigure} appear={() => 1} lead={calm} note={calm} kicker={calm} tone={own.tone} />
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
