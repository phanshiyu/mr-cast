import { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { SceneState } from '../../shared/state-steps.mjs';
import { buildFrames } from '../../shared/timing.mjs';
import { headerBox } from '../fit/shell';
import type { TestsScene } from '../types';
import { asBrightAs, focusSpotlight, type Emphasis } from '../utils/spotlight';
import { stateFrame } from '../utils/stateTrack';
import { testsTargets } from '../utils/sceneTargets';
import {
  FOOT_H,
  HEAD_H,
  layoutTests,
  tagFont,
  type PlacedCell,
  type PlacedRow,
  type TestsLayout,
} from '../utils/testsLayout';
import { FitText } from './FitText';
import { HeaderCallout } from './HeaderCallout';
import { PenMarks } from './PenMarks';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { clamp, colors, fonts } from './theme';
import { tones } from './tones';

const START = 8;
const AMBER = tones.warn.color;

/** Frames at which each row lands; all of them inside the build. */
function rowAt(layout: TestsLayout) {
  const stagger = Math.min(5, (buildFrames('tests') - START - 24) / Math.max(1, layout.rows.length - 1));
  return (i: number) => START + 6 + i * stagger;
}

const TAG_COLOR = { NEW: tones.good.color, CHANGED: colors.accent, unchecked: AMBER, REMOVED: colors.muted } as const;

const Cell: React.FC<{ placed: PlacedCell; layout: TestsLayout; land: number; emphasis: Emphasis }> = ({
  placed,
  layout,
  land,
  emphasis,
}) => {
  const { cell, value, was, tag } = placed;
  const { padX, lineHeight, tagFont: small } = layout;
  const checked = cell.state === 'checked';
  const border = checked
    ? `1.5px solid ${tones.good.color}${emphasis.glow > 0 ? '' : '88'}`
    : cell.state === 'unchecked'
      ? `1.5px dashed ${AMBER}cc`
      : cell.state === 'removed'
        ? `1.5px dashed ${colors.faint}`
        : 'none';
  const color = checked ? tones.good.color : cell.state === 'unchecked' ? AMBER : colors.faint;
  const textH =
    (value ? value.lines.length * lineHeight : cell.state === 'none' ? lineHeight : 0) +
    (was ? Math.round(small * 1.25) : 0);
  return (
    <div
      style={{
        position: 'absolute',
        left: placed.x,
        top: placed.y,
        width: placed.w,
        height: placed.h,
        boxSizing: 'border-box',
        borderRadius: 10,
        border,
        background: checked ? tones.good.bg : 'transparent',
        boxShadow:
          emphasis.glow > 0
            ? `0 0 0 ${3 * emphasis.glow}px ${colors.accentSoft}, 0 0 ${28 * emphasis.glow}px ${colors.accentGlow}`
            : undefined,
        opacity: land * emphasis.opacity,
        transform: `translateY(${(1 - land) * 14}px)`,
      }}
    >
      <div style={{ position: 'absolute', left: padX, top: (placed.h - textH) / 2 - 1.5 }}>
        {value ? (
          <FitText fit={value} style={{ color, lineHeight: `${lineHeight}px` }} />
        ) : cell.state === 'none' ? (
          <div style={{ fontSize: layout.font, lineHeight: `${lineHeight}px`, color: colors.faint }}>–</div>
        ) : null}
        {was ? (
          <FitText
            fit={was}
            style={{
              color: colors.muted,
              textDecoration: 'line-through',
              textDecorationColor: colors.del,
              textDecorationThickness: 2,
              lineHeight: `${Math.round(small * 1.25)}px`,
            }}
          />
        ) : null}
      </div>
      {tag ? (
        <div
          style={{
            position: 'absolute',
            right: padX,
            top: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            fontFamily: fonts.sans,
            fontSize: small,
            fontWeight: tagFont(tag, small).weight,
            letterSpacing: tagFont(tag, small).letterSpacing,
            color: TAG_COLOR[tag],
          }}
        >
          {tag}
        </div>
      ) : null}
    </div>
  );
};

const Row: React.FC<{
  placed: PlacedRow;
  layout: TestsLayout;
  land: number;
  emphasisOf: (key: string) => Emphasis;
}> = ({ placed, layout, land, emphasisOf }) => {
  const { row, when, count, bar, names } = placed;
  const own = emphasisOf(row.key);
  const cells = placed.cells.map((c) => [c, asBrightAs(emphasisOf(c.cell.key), [own])] as const);
  // A row header stays as bright as its brightest cell, so a lit cell never sits beside a dim situation.
  const head = asBrightAs(
    own,
    cells.map(([, e]) => e),
  );
  const { padX, lineHeight } = layout;
  const gapColor = colors.del;
  const nameH = names.length ? Math.round(names[0]!.fit.size * 1.25) : 0;
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: placed.y,
          width: layout.whenCol.w,
          height: placed.h,
          opacity: land * head.opacity,
        }}
      >
        {head.bar > 0 ? (
          <div
            style={{
              position: 'absolute',
              left: -14,
              top: 8,
              bottom: 8,
              width: 5,
              borderRadius: 3,
              background: colors.accent,
              opacity: head.bar,
            }}
          />
        ) : null}
        <FitText
          fit={when}
          style={{
            position: 'absolute',
            left: 0,
            top: (placed.h - when.lines.length * lineHeight) / 2,
            lineHeight: `${lineHeight}px`,
            color: row.gap ? gapColor : colors.text,
          }}
        />
        {count ? (
          <div
            style={{
              position: 'absolute',
              right: padX,
              top: 0,
              bottom: 0,
              display: 'flex',
              alignItems: 'center',
              fontSize: layout.tagFont,
              fontWeight: 600,
              color: count === 'no test' ? AMBER : colors.faint,
            }}
          >
            {count}
          </div>
        ) : null}
      </div>
      {bar ? (
        <div
          style={{
            position: 'absolute',
            left: bar.x,
            top: bar.y,
            width: bar.w,
            height: bar.h,
            boxSizing: 'border-box',
            borderRadius: 10,
            border: `2px dashed ${gapColor}`,
            background: own.glow > 0 ? colors.delBg : 'transparent',
            boxShadow: own.glow > 0 ? `0 0 ${30 * own.glow}px ${colors.delBg}` : undefined,
            opacity: land * own.opacity,
          }}
        >
          <FitText
            fit={bar.text}
            style={{
              position: 'absolute',
              left: padX,
              top: (bar.h - bar.text.lines.length * lineHeight) / 2 - 2,
              lineHeight: `${lineHeight}px`,
              color: gapColor,
            }}
          />
        </div>
      ) : null}
      {cells.map(([c, e], i) => (
        <Cell key={i} placed={c} layout={layout} land={land} emphasis={e} />
      ))}
      {layout.namesCol && names.length ? (
        <div
          style={{
            position: 'absolute',
            left: layout.namesCol.x + padX,
            top: placed.y + (placed.h - names.length * nameH) / 2,
            opacity: land * head.opacity,
          }}
        >
          {names.map(({ fit, removed }, i) => (
            <FitText
              key={i}
              fit={fit}
              style={{
                color: removed ? colors.faint : colors.muted,
                textDecoration: removed ? 'line-through' : undefined,
                lineHeight: `${nameH}px`,
              }}
            />
          ))}
        </div>
      ) : null}
    </>
  );
};

export const TestMatrix: React.FC<SceneProps<TestsScene>> = ({ scene, hunks, durationInFrames, segments }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const emphasisOf = focusSpotlight(scene, hunks, segments, frame);
  const box = headerBox(scene);
  const layout = useMemo(() => layoutTests(scene, box.width, box.height), [scene, box.width, box.height]);
  const at = useMemo(() => rowAt(layout), [layout]);
  // The callout is the only thing a tests step changes: the names of the tests it focuses, or its own words.
  const states = useMemo<SceneState[]>(
    () =>
      ['', ...(scene.steps ?? []).map((s) => s.callout ?? '')].map((callout) => ({
        values: {},
        places: {},
        hidden: {},
        tints: {},
        callout,
        transforms: {},
        shapes: {},
        traces: {},
        spans: {},
      })),
    [scene.steps],
  );
  const s = stateFrame(states, segments, frame);
  const headerIn = interpolate(frame, [START, START + 10], [0, 1], clamp);
  const top = Math.max(0, box.height - layout.height * layout.scale) * 0.3;
  const marks = useMemo(() => testsTargets(scene), [scene]);
  const label: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    height: HEAD_H,
    display: 'flex',
    alignItems: 'center',
    color: colors.muted,
  };
  const colLit = (col: number) => emphasisOf(`o:${col}`);

  return (
    <SceneShell
      scene={scene}
      durationInFrames={durationInFrames}
      camera={{ hunks, segments, targets: (k) => marks[k] ?? null }}
      aside={<HeaderCallout scene={scene} s={s} />}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top,
          width: box.width / layout.scale,
          height: layout.height,
          transform: `scale(${layout.scale})`,
          transformOrigin: 'top left',
        }}
      >
        <div style={{ ...label, left: 0, width: layout.whenCol.w, opacity: headerIn }}>
          <FitText fit={layout.whenCol.title} style={{ lineHeight: 'normal' }} />
        </div>
        {layout.cols.map((c, col) => (
          <div
            key={col}
            style={{
              ...label,
              left: c.x + layout.padX,
              width: c.w - layout.padX,
              opacity: headerIn * colLit(col).opacity,
              color: colLit(col).glow > 0 ? colors.text : colors.muted,
            }}
          >
            <FitText fit={c.title} style={{ lineHeight: 'normal' }} />
          </div>
        ))}
        {layout.namesCol ? (
          <div style={{ ...label, left: layout.namesCol.x + layout.padX, opacity: headerIn }}>
            <FitText fit={layout.namesCol.title} style={{ lineHeight: 'normal' }} />
          </div>
        ) : null}
        {layout.rows.map((row, i) => (
          <Row
            key={i}
            placed={row}
            layout={layout}
            land={spring({ frame: frame - at(i), fps, config: { damping: 18, stiffness: 140 } })}
            emphasisOf={emphasisOf}
          />
        ))}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: layout.footY,
            width: layout.width,
            height: FOOT_H,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 24,
            borderTop: `1px solid ${colors.border}`,
            opacity: interpolate(frame, [at(layout.rows.length), at(layout.rows.length) + 10], [0, 1], clamp),
          }}
        >
          {layout.subject ? (
            <FitText fit={layout.subject} style={{ color: colors.muted, lineHeight: 'normal' }} />
          ) : (
            <span />
          )}
          <span style={{ fontSize: 18, color: colors.muted, whiteSpace: 'nowrap' }}>{layout.counts}</span>
        </div>
      </div>
      <PenMarks scene={scene} hunks={hunks} segments={segments} targets={(k) => marks[k] ?? null} />
    </SceneShell>
  );
};
