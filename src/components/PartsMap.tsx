import { FileCode2 } from 'lucide-react';
import { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { sceneFiles, sceneParts } from '../../shared/files.mjs';
import { buildFrames } from '../../shared/timing.mjs';
import type { FilesScene, PartWeight } from '../types';
import {
  CARD_OPACITY,
  CARD_PAD,
  FILE_ROW_H,
  STATS_H,
  TAGS_H,
  layoutParts,
  type PlacedCard,
} from '../utils/partsLayout';
import { filesTargets } from '../utils/sceneTargets';
import { brighter, focusSpotlight, spotlight, spotlightStarts, type Emphasis } from '../utils/spotlight';
import { FilesTotals } from './FilesTotals';
import { FitText } from './FitText';
import { PenMarks } from './PenMarks';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { clamp, colors, contentBox, fonts, riskColors } from './theme';

const START = 10;
const MINUS = '−';
const TAG_FONT = 15;
const COUNT_FONT = 19;
const COLOR: Record<PartWeight, string> = { core: colors.accent, support: colors.text, routine: colors.muted };

const Tag: React.FC<{ word: string; color: string }> = ({ word, color }) => (
  <span
    style={{
      padding: '1px 9px',
      borderRadius: 999,
      border: `1px solid ${color}88`,
      color,
      fontSize: TAG_FONT,
      fontWeight: 800,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      lineHeight: 1.3,
    }}
  >
    {word}
  </span>
);

const Card: React.FC<{ card: PlacedCard; land: number; emphasis: Emphasis }> = ({ card, land, emphasis }) => {
  const { part } = card;
  const color = COLOR[part.weight];
  const lit = emphasis.glow > 0;
  return (
    <div
      style={{
        position: 'absolute',
        left: card.x,
        top: card.y,
        width: card.w,
        height: card.h,
        boxSizing: 'border-box',
        borderRadius: 16,
        background: part.weight === 'core' ? '#161a30' : '#0f1118',
        border: `${part.weight === 'core' ? 2 : 1.5}px solid ${part.weight === 'core' ? `${colors.accent}88` : colors.border}`,
        boxShadow: lit
          ? `inset 0 0 0 2px ${colors.accent}${Math.round(emphasis.glow * 150)
              .toString(16)
              .padStart(2, '0')}, 0 0 ${30 * emphasis.glow}px ${colors.accent}33`
          : undefined,
        opacity: land * emphasis.opacity * CARD_OPACITY[part.weight],
        transform: `translateY(${(1 - land) * 24}px)`,
      }}
    >
      <div style={{ position: 'absolute', left: CARD_PAD, top: CARD_PAD, height: TAGS_H, display: 'flex', gap: 8 }}>
        {card.tags.map((t) => (
          <Tag key={t} word={t} color={t === 'check' ? riskColors.medium : color} />
        ))}
      </div>
      <div style={{ position: 'absolute', left: CARD_PAD, top: card.nameY, color }}>
        <FitText fit={card.name} />
      </div>
      {card.does ? (
        <div style={{ position: 'absolute', left: CARD_PAD, top: card.doesY, color: '#c9cedb' }}>
          <FitText fit={card.does} />
        </div>
      ) : null}
      {card.risk ? (
        <div style={{ position: 'absolute', left: CARD_PAD, top: card.riskY, color: riskColors.medium, opacity: 0.8 }}>
          <FitText fit={card.risk} />
        </div>
      ) : null}
      <div
        style={{
          position: 'absolute',
          left: CARD_PAD,
          right: CARD_PAD,
          top: card.statsY,
          height: STATS_H,
          display: 'flex',
          alignItems: 'center',
          gap: '0.9em',
          fontFamily: fonts.mono,
          fontSize: COUNT_FONT,
          fontWeight: 700,
          color: colors.muted,
          whiteSpace: 'nowrap',
        }}
      >
        <span>
          {part.files.length} {part.files.length === 1 ? 'file' : 'files'}
        </span>
        {part.files.some((f) => f.additions !== undefined || f.deletions !== undefined) ? (
          <>
            <span style={{ color: colors.add }}>+{part.additions}</span>
            <span style={{ color: colors.del }}>
              {MINUS}
              {part.deletions}
            </span>
          </>
        ) : null}
      </div>
      {card.files.map((f) => (
        <div
          key={f.file.path}
          style={{
            position: 'absolute',
            left: CARD_PAD,
            top: f.y,
            height: FILE_ROW_H,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: colors.muted,
          }}
        >
          <FileCode2 size={17} strokeWidth={2} color={colors.faint} style={{ flexShrink: 0 }} />
          <FitText fit={f.name} inline />
        </div>
      ))}
      {card.more ? (
        <div
          style={{
            position: 'absolute',
            left: CARD_PAD,
            top: card.files.length ? card.files.at(-1)!.y + FILE_ROW_H : card.statsY + STATS_H + 10,
            height: FILE_ROW_H,
            display: 'flex',
            alignItems: 'center',
            fontFamily: fonts.mono,
            fontSize: 16,
            color: colors.faint,
          }}
        >
          + {card.more} more
        </div>
      ) : null}
    </div>
  );
};

/**
 * The parts of a change as a map: a card for each part (its weight, what it does, its counts and largest files), set
 * after the parts it builds on, with a thin link between the two.
 */
export const PartsMap: React.FC<SceneProps<FilesScene>> = ({ scene, hunks, durationInFrames, segments }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const box = contentBox(Boolean(scene.title));
  const files = useMemo(() => sceneFiles(scene, hunks), [scene, hunks]);
  const parts = useMemo(() => sceneParts(scene, files) ?? [], [scene, files]);
  const layout = useMemo(() => layoutParts(parts, box.width, box.height), [parts, box.width, box.height]);
  const marks = useMemo(() => filesTargets(scene, hunks), [scene, hunks]);
  const left = Math.max(0, box.width - layout.width) / 2;
  const top = Math.max(0, box.height - layout.height) * 0.3;
  const walked = scene.highlight ?? [];
  const { emphasis } = spotlight(frame, spotlightStarts(segments, walked.length, buildFrames('files')));
  const focus = focusSpotlight(scene, hunks, segments, frame);
  const cardEmphasis = (card: PlacedCard): Emphasis => {
    if (scene.steps?.length)
      return card.part.files.reduce((e, f) => brighter(e, focus(`f:${f.path}`)), focus(`p:${card.part.name}`));
    return emphasis(card.part.files.flatMap((f) => (walked.includes(f.path) ? [walked.indexOf(f.path)] : [])));
  };
  const stagger = Math.min(5, 12 / Math.max(1, layout.cards.length - 1));
  const landed = (i: number) =>
    spring({ frame: frame - START - i * stagger, fps, config: { damping: 17, stiffness: 130 } });
  const emphases = layout.cards.map(cardEmphasis);
  const linkIn = interpolate(frame, [START + 14, START + 30], [0, 1], clamp);

  return (
    <SceneShell
      scene={scene}
      durationInFrames={durationInFrames}
      camera={{ hunks, segments, targets: () => marks }}
      aside={<FilesTotals files={files} />}
    >
      <div style={{ position: 'absolute', left, top, width: layout.width, height: layout.height }}>
        <svg
          width={layout.width}
          height={layout.height}
          style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
        >
          {layout.links.map((l, i) => {
            const dim = Math.min(emphases[l.from]!.opacity, emphases[l.to]!.opacity);
            const strong = Math.max(emphases[l.from]!.glow, emphases[l.to]!.glow);
            const stroke = strong > 0.5 ? colors.accent : '#8a91ad';
            return (
              <g key={i} opacity={linkIn * dim * 0.85}>
                <path d={l.path} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" />
                <polygon points={l.head} fill={stroke} />
              </g>
            );
          })}
        </svg>
        {layout.cards.map((card, i) => (
          <Card key={card.part.name} card={card} land={landed(i)} emphasis={emphases[i]!} />
        ))}
      </div>
      <PenMarks scene={scene} hunks={hunks} segments={segments} targets={() => marks} />
    </SceneShell>
  );
};
