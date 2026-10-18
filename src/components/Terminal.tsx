import { useMemo } from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import type { TerminalScene } from '../types';
import { staged, type MarkTargets, type Stage } from '../utils/penGeometry';
import { focusSpotlight, type Emphasis } from '../utils/spotlight';
import { terminalCamera, terminalSchedule, type EntryTiming } from '../utils/terminalCamera';
import { CHROME_H, EXIT_FONT, PAD_X, layoutTerminal, terminalBoxes, type PlacedEntry, type TerminalLayout } from '../utils/terminalLayout';
import { FitText } from './FitText';
import { PenMarks } from './PenMarks';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { clamp, colors, contentBox, fonts } from './theme';

const WINDOW_START = 2;
const OUTPUT_TEXT = '#c3c8d4';
const PROMPT = colors.add;
const BODY_BG = '#0b0d13';
/** Room under the title bar where scrolled lines fade out. */
const FADE = 26;

const hex = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');

/** A block cursor after the typed text: solid while typing, blinking while the command waits for its output. */
const Cursor: React.FC<{ layout: TerminalLayout; frame: number; timing: EntryTiming }> = ({ layout, frame, timing }) => {
  const typing = frame < timing.typeFrom + timing.typeFrames;
  const on = typing || Math.floor((frame - timing.typeFrom) / 8) % 2 === 0;
  return <span style={{ display: 'inline-block', width: layout.font * 0.6, height: layout.font * 1.15, verticalAlign: 'text-bottom', background: colors.text, opacity: on ? 0.85 : 0 }} />;
};

const Entry: React.FC<{ layout: TerminalLayout; placed: PlacedEntry; timing: EntryTiming; frame: number; emphasis: Emphasis; lineEmphasis: (line: number) => Emphasis }> = ({
  layout,
  placed,
  timing,
  frame,
  emphasis,
  lineEmphasis,
}) => {
  if (frame < timing.typeFrom) return null;
  const { rowH, font } = layout;
  const failed = placed.entry.exit !== undefined && placed.entry.exit !== 0;
  const typed = placed.command ? Math.floor(interpolate(frame, [timing.typeFrom, timing.typeFrom + Math.max(1, timing.typeFrames)], [0, placed.command.chars], clamp)) : 0;
  const printing = frame < timing.outFrom;
  const lineIn = (l: number) => interpolate(frame, [timing.outFrom + l * timing.lineGap, timing.outFrom + l * timing.lineGap + 3], [0, 1], clamp);
  const lastIn = placed.lines.length ? lineIn(placed.lines.length - 1) : interpolate(frame, [timing.outFrom, timing.outFrom + 3], [0, 1], clamp);
  const height = placed.bottom - placed.top;
  const opacity = Math.max(emphasis.opacity, ...placed.lines.map((l) => lineEmphasis(l.index).opacity));
  let before = 0;

  return (
    <div style={{ opacity }}>
      {failed ? (
        <div style={{ position: 'absolute', left: PAD_X - 18, top: placed.top - 4, width: layout.innerW + 36, height: height + 8, borderRadius: 10, background: colors.delBg, opacity: 0.8 * lastIn }} />
      ) : null}
      {failed || emphasis.glow > 0 ? (
        <div style={{ position: 'absolute', left: PAD_X - 18, top: placed.top - 4, width: 4, height: height + 8, borderRadius: 2, background: failed ? colors.del : colors.accent, opacity: failed ? lastIn : emphasis.glow }} />
      ) : null}
      {emphasis.glow > 0 ? (
        <div
          style={{
            position: 'absolute',
            left: PAD_X - 18,
            top: placed.top - 4,
            width: layout.innerW + 36,
            height: height + 8,
            borderRadius: 10,
            background: `rgba(124, 140, 255, ${0.09 * emphasis.glow})`,
            boxShadow: `inset 0 0 0 1.5px ${colors.accent}${hex(0.55 * emphasis.glow)}`,
          }}
        />
      ) : null}
      {placed.lines.map((line) => {
        const glow = lineEmphasis(line.index).glow;
        return glow > 0 ? (
          <div
            key={line.index}
            style={{
              position: 'absolute',
              left: PAD_X + line.indent - 10,
              top: line.y,
              width: Math.min(layout.innerW, line.fit.width) + 20,
              height: Math.max(1, line.fit.lines.length) * rowH,
              borderRadius: 8,
              background: `rgba(124, 140, 255, ${0.18 * glow})`,
              boxShadow: `inset 0 0 0 2px ${colors.accent}${hex(0.8 * glow)}, 0 0 ${24 * glow}px ${colors.accentGlow}`,
            }}
          />
        ) : null;
      })}
      {placed.command
        ? placed.command.rows.map((row, r) => {
            const from = before;
            before += row.length;
            const shown = row.slice(0, Math.max(0, typed - from));
            const cursorHere = printing && (typed < from + row.length || r === placed.command!.rows.length - 1) && typed >= from;
            return (
              <div
                key={r}
                style={{ position: 'absolute', left: PAD_X, top: placed.command!.y + r * rowH, height: rowH, lineHeight: `${rowH}px`, fontFamily: fonts.mono, fontSize: font, whiteSpace: 'pre', color: colors.text, fontWeight: 500 }}
              >
                {r === 0 ? <span style={{ color: failed && lastIn > 0.5 ? colors.del : PROMPT, fontWeight: 700 }}>{`${placed.prompt} `}</span> : <span style={{ display: 'inline-block', width: placed.promptW }} />}
                {shown}
                {cursorHere ? <Cursor layout={layout} frame={frame} timing={timing} /> : null}
              </div>
            );
          })
        : null}
      {placed.lines.map((line) => (
        <FitText key={line.index} fit={line.fit} style={{ position: 'absolute', left: PAD_X + line.indent, top: line.y, color: OUTPUT_TEXT, opacity: lineIn(line.index) }} />
      ))}
      {placed.exit ? (
        <div
          style={{
            position: 'absolute',
            left: PAD_X + layout.innerW - placed.exit.w,
            top: placed.exit.y + (rowH - EXIT_FONT * 1.7) / 2,
            height: EXIT_FONT * 1.7,
            width: placed.exit.w,
            boxSizing: 'border-box',
            borderRadius: 999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: fonts.mono,
            fontSize: EXIT_FONT,
            fontWeight: 700,
            color: placed.exit.ok ? colors.add : colors.del,
            background: placed.exit.ok ? colors.addBg : colors.delBg,
            boxShadow: `inset 0 0 0 1.5px ${placed.exit.ok ? colors.add : colors.del}66`,
            opacity: lastIn,
          }}
        >
          {placed.exit.text}
        </div>
      ) : null}
    </div>
  );
};

const Chrome: React.FC<{ layout: TerminalLayout }> = ({ layout }) => (
  <div style={{ position: 'absolute', left: 0, top: 0, width: layout.width, height: CHROME_H, background: '#171a23', borderBottom: `1px solid ${colors.border}`, borderRadius: '16px 16px 0 0' }}>
    <div style={{ position: 'absolute', left: 22, top: 0, height: CHROME_H, display: 'flex', alignItems: 'center', gap: 10 }}>
      {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
        <div key={c} style={{ width: 14, height: 14, borderRadius: 7, background: c, opacity: 0.85 }} />
      ))}
    </div>
    {layout.window ? (
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: CHROME_H, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <FitText fit={layout.window} style={{ color: colors.muted }} />
      </div>
    ) : null}
  </div>
);

export const Terminal: React.FC<SceneProps<TerminalScene>> = ({ scene, hunks, durationInFrames, segments }) => {
  const frame = useCurrentFrame();
  const box = contentBox(Boolean(scene.title));
  const layout = useMemo(() => layoutTerminal(scene, box.width, box.height), [scene, box.width, box.height]);
  const timing = useMemo(() => terminalSchedule(scene, layout, segments), [scene, layout, segments]);
  const camera = useMemo(() => terminalCamera(scene, layout, timing, segments), [scene, layout, timing, segments]);
  const scroll = camera.scrollAt(frame);
  const emphasisOf = focusSpotlight(scene, hunks, segments, frame);
  const windowH = CHROME_H + layout.viewH;
  const windowTop = Math.max(0, box.height - windowH) * 0.4;
  const appear = interpolate(frame, [WINDOW_START, WINDOW_START + 12], [0, 1], clamp);
  const stage: Stage = { left: 0, top: windowTop + CHROME_H, scale: 1 };
  const boxes = useMemo(() => terminalBoxes(layout), [layout]);
  // Marks scroll with the session: placed where step k's camera settles, then carried along while it moves.
  const markTargets = (k: number): MarkTargets => {
    const stop = camera.stops[k] ?? 0;
    const moved = { boxes: new Map([...boxes.boxes].map(([key, b]) => [key, { ...b, y: b.y - stop }])), obstacles: boxes.obstacles?.map((b) => ({ ...b, y: b.y - stop })) };
    return { ...staged(moved, stage, box), shift: { x: 0, y: stop - scroll } };
  };
  const more = scroll < layout.height - layout.viewH - 1;
  const mask = `linear-gradient(to bottom, ${scroll > 1 ? 'transparent' : '#000'} 0px, #000 ${scroll > 1 ? FADE : 0}px, #000 ${more ? layout.viewH - FADE : layout.viewH}px, ${more ? 'transparent' : '#000'} ${layout.viewH}px)`;

  return (
    <SceneShell scene={scene} durationInFrames={durationInFrames} camera={{ hunks, segments, targets: markTargets }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: windowTop,
          width: layout.width,
          height: windowH,
          borderRadius: 16,
          background: BODY_BG,
          boxShadow: `0 0 0 1.5px ${colors.borderStrong}, 0 24px 70px rgba(0,0,0,0.55)`,
          opacity: appear,
          transform: `translateY(${(1 - appear) * 14}px)`,
        }}
      >
        <Chrome layout={layout} />
        <div style={{ position: 'absolute', left: 0, top: CHROME_H, width: layout.width, height: layout.viewH, overflow: 'hidden', maskImage: mask, WebkitMaskImage: mask }}>
          <div style={{ position: 'absolute', left: 0, top: 0, width: layout.width, height: layout.height, transform: `translateY(${-scroll}px)` }}>
            {layout.entries.map((placed) => (
              <Entry
                key={placed.index}
                layout={layout}
                placed={placed}
                timing={timing[placed.index]!}
                frame={frame}
                emphasis={emphasisOf(`en:${placed.index}`)}
                lineEmphasis={(line) => emphasisOf(`ln:${placed.index}/${line}`)}
              />
            ))}
          </div>
        </div>
      </div>
      <PenMarks scene={scene} hunks={hunks} segments={segments} targets={markTargets} />
    </SceneShell>
  );
};
