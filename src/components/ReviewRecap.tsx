import { MessageCircleWarning } from 'lucide-react';
import { useMemo } from 'react';
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { buildFrames } from '../../shared/timing.mjs';
import type { ReviewScene } from '../types';
import { COL_GAP, PILL_W, ROW_PAD_X, layoutReview, type PlacedFinding, type ReviewLayout } from '../utils/reviewLayout';
import { FitText } from './FitText';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { colors, contentBox, severityInk } from './theme';

const START = 12;

/** Says whose words these are, so the recap never reads as part of the explanation. */
const Opinion: React.FC = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 6, color: colors.muted, fontSize: 22, fontWeight: 500 }}>
    <MessageCircleWarning size={26} strokeWidth={2} color={severityInk.risk} />
    My opinion, checked against the code
  </div>
);

const Row: React.FC<{ row: PlacedFinding; layout: ReviewLayout; at: number }> = ({ row, layout, at }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ink = severityInk[row.finding.severity];
  const land = spring({ frame: frame - at, fps, config: { damping: 17, stiffness: 120 } });
  const centred = (lines: number, lineHeight: number) => (row.h - lines * lineHeight) / 2;
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: row.y,
        height: row.h,
        borderRadius: 14,
        background: 'rgba(255,255,255,0.03)',
        boxShadow: `inset 0 0 0 1px ${colors.border}`,
        opacity: land,
        transform: `translateX(${(1 - land) * -40}px)`,
      }}
    >
      <div style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 5, borderRadius: 3, background: ink }} />
      <div style={{ position: 'absolute', left: ROW_PAD_X, top: 0, bottom: 0, display: 'flex', alignItems: 'center' }}>
        <div
          style={{
            width: PILL_W,
            padding: '5px 0',
            boxSizing: 'border-box',
            textAlign: 'center',
            borderRadius: 999,
            border: `1.5px solid ${ink}99`,
            background: `${ink}1f`,
            color: ink,
            fontSize: 16,
            fontWeight: 800,
            letterSpacing: 1.6,
            textTransform: 'uppercase',
          }}
        >
          {row.finding.severity}
        </div>
      </div>
      <FitText
        fit={row.where}
        style={{ position: 'absolute', left: layout.whereX, width: layout.claimX - layout.whereX - COL_GAP, top: centred(1, row.where.lineHeight), lineHeight: `${row.where.lineHeight}px`, color: colors.muted }}
      />
      <FitText
        fit={row.claim}
        style={{ position: 'absolute', left: layout.claimX, width: layout.claimW, top: centred(row.claim.lines.length, layout.lineHeight), lineHeight: `${layout.lineHeight}px`, color: colors.text }}
      />
    </div>
  );
};

/** The review's recap: every finding, worst first, under a label that says it is Claude's opinion. */
export const ReviewRecap: React.FC<SceneProps<ReviewScene>> = ({ scene, storyboard, durationInFrames }) => {
  const box = contentBox(Boolean(scene.title));
  const layout = useMemo(() => layoutReview(storyboard.findings ?? [], box.width, box.height), [storyboard.findings, box.width, box.height]);
  const stagger = Math.min(8, (buildFrames('review') - START - 14) / Math.max(1, layout.rows.length - 1));
  const top = Math.max(0, box.height - layout.height) * 0.3;
  return (
    <SceneShell scene={scene} durationInFrames={durationInFrames} aside={<Opinion />}>
      <div style={{ position: 'absolute', left: 0, top, width: box.width, height: layout.height }}>
        {layout.rows.map((row, i) => (
          <Row key={row.finding.id} row={row} layout={layout} at={START + i * stagger} />
        ))}
      </div>
    </SceneShell>
  );
};
