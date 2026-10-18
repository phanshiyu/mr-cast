import { FileCode2, FlaskConical, Folder } from 'lucide-react';
import { useMemo } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { sceneFiles } from '../../shared/files.mjs';
import { buildFrames } from '../../shared/timing.mjs';
import type { FilesScene } from '../types';
import { BAR_MAX, MARKER_W, PAD_X, layoutFiles, treeRows, type FilesLayout, type PlacedRow, filesBoxes } from '../utils/filesLayout';
import { staged } from '../utils/penGeometry';
import { PenMarks } from './PenMarks';
import { focusSpotlight, spotlight, spotlightStarts, type Emphasis } from '../utils/spotlight';
import { Badge, badgesOf, changeTone } from './marks';
import { SceneShell } from './SceneShell';
import type { SceneProps } from './sceneProps';
import { FitText } from './FitText';
import { clamp, colors, contentBox, fonts } from './theme';

const START = 10;
/** Every row has started landing by this frame, so the rows, bars and notes are in by the end of the build. */
const ROWS_END = 22;
const MINUS = '−';

/** Grows a file's diffstat bar and counts its lines up as the row lands. */
const Counts: React.FC<{ layout: FilesLayout; additions: number; deletions: number; grow: number }> = ({ layout, additions, deletions, grow }) => {
  const total = additions + deletions;
  const barW = BAR_MAX * Math.sqrt(total / layout.maxLines) * grow;
  const addW = total ? (barW * additions) / total : 0;
  const font = Math.round(layout.font * 0.88);
  return (
    <div style={{ position: 'absolute', left: layout.countsX!, top: 0, bottom: 0, display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ fontFamily: fonts.mono, fontSize: font, fontWeight: 700, display: 'flex', gap: '0.6em', width: `${11 * 0.62}em`, justifyContent: 'flex-end' }}>
        <span style={{ color: colors.add, opacity: additions ? 1 : 0.35 }}>+{Math.round(additions * grow)}</span>
        <span style={{ color: colors.del, opacity: deletions ? 1 : 0.35 }}>
          {MINUS}
          {Math.round(deletions * grow)}
        </span>
      </div>
      <div style={{ width: BAR_MAX, height: 10, borderRadius: 5, background: 'rgba(255,255,255,0.05)', display: 'flex', overflow: 'hidden' }}>
        <div style={{ width: addW, background: colors.add }} />
        <div style={{ width: barW - addW, background: colors.del }} />
      </div>
    </div>
  );
};

const Row: React.FC<{ placed: PlacedRow; layout: FilesLayout; at: number; emphasis: Emphasis; frame: number }> = ({ placed, layout, at, emphasis, frame }) => {
  const { fps } = useVideoConfig();
  const { row } = placed;
  const land = spring({ frame: frame - at, fps, config: { damping: 17, stiffness: 130 } });
  const grow = interpolate(frame, [at + 4, at + 22], [0, 1], { ...clamp, easing: (t) => 1 - (1 - t) ** 3 });
  const noteIn = interpolate(frame, [at + 10, at + 20], [0, 1], clamp);
  const iconSize = Math.round(layout.font * 0.95);
  const left = layout.nameX + row.depth * layout.indent;
  const guides = Array.from({ length: row.depth }, (_, d) => layout.nameX + d * layout.indent + iconSize / 2);

  if (row.kind === 'dir') {
    return (
      <div style={{ position: 'absolute', left: placed.x, top: placed.y, width: layout.width, height: layout.rowH, opacity: land * emphasis.opacity, transform: `translateX(${(1 - land) * -30}px)` }}>
        {guides.map((x, i) => (
          <div key={i} style={{ position: 'absolute', left: x, top: 0, bottom: 0, width: 1.5, background: colors.border }} />
        ))}
        <div style={{ position: 'absolute', left, top: 0, bottom: 0, display: 'flex', alignItems: 'center', gap: Math.round(layout.font * 0.4) }}>
          <Folder size={iconSize} strokeWidth={2} color={colors.muted} />
          <FitText fit={placed.name} inline style={{ color: colors.muted }} />
        </div>
      </div>
    );
  }

  const { file } = row;
  const { note } = placed;
  const tone = file.change ? changeTone[file.change] : null;
  const removed = file.change === 'removed';
  const Icon = file.test ? FlaskConical : FileCode2;
  return (
    <div
      style={{
        position: 'absolute',
        left: placed.x,
        top: placed.y,
        width: layout.width,
        height: layout.rowH,
        borderRadius: 12,
        background: emphasis.glow > 0 ? `rgba(124, 140, 255, ${0.1 * emphasis.glow})` : undefined,
        boxShadow: emphasis.glow > 0 ? `inset 0 0 0 2px ${colors.accent}${Math.round(emphasis.glow * 150).toString(16).padStart(2, '0')}, 0 0 ${30 * emphasis.glow}px ${colors.accent}33` : undefined,
        opacity: land * emphasis.opacity,
        transform: `translateX(${(1 - land) * -30}px)`,
      }}
    >
      {emphasis.bar > 0 ? <div style={{ position: 'absolute', left: 0, top: 6, bottom: 6, width: 5, borderRadius: 3, background: colors.accent, opacity: emphasis.bar }} /> : null}
      {guides.map((x, i) => (
        <div key={i} style={{ position: 'absolute', left: x, top: 0, bottom: 0, width: 1.5, background: colors.border }} />
      ))}
      <div
        style={{
          position: 'absolute',
          left: PAD_X,
          width: MARKER_W,
          top: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          fontFamily: fonts.mono,
          fontWeight: 800,
          fontSize: layout.font,
          color: tone?.color ?? 'transparent',
        }}
      >
        {tone?.marker ?? ''}
      </div>
      <div style={{ position: 'absolute', left, width: layout.nameX + layout.nameW - left, top: 0, bottom: 0, display: 'flex', alignItems: 'center', gap: Math.round(layout.font * 0.4) }}>
        <Icon size={iconSize} strokeWidth={2} color={file.test ? colors.accent : tone && !removed ? tone.color : colors.muted} style={{ flexShrink: 0 }} />
        <FitText
          fit={placed.name}
          inline
          style={{ color: removed ? colors.muted : colors.text, textDecoration: removed ? 'line-through' : 'none', textDecorationColor: colors.del, textDecorationThickness: 2.5 }}
        />
        {file.test ? (
          <span
            style={{
              flexShrink: 0,
              padding: '2px 9px',
              borderRadius: 999,
              background: colors.accentSoft,
              border: `1px solid ${colors.accent}77`,
              color: colors.accent,
              fontSize: Math.round(layout.font * 0.58),
              fontWeight: 800,
              letterSpacing: 1.2,
              textTransform: 'uppercase',
            }}
          >
            test
          </span>
        ) : null}
        {badgesOf(file, { change: false }).map((b, i) => (
          <Badge key={i} badge={b} size={Math.round(layout.font * 0.58)} />
        ))}
      </div>
      {layout.countsX !== null && (file.additions !== undefined || file.deletions !== undefined) ? (
        <Counts layout={layout} additions={file.additions ?? 0} deletions={file.deletions ?? 0} grow={grow} />
      ) : null}
      {note ? (
        <div
          style={{
            position: 'absolute',
            left: layout.noteX,
            width: layout.noteW,
            top: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            color: '#c9cedb',
            opacity: noteIn,
            transform: `translateX(${(1 - noteIn) * 12}px)`,
          }}
        >
          <FitText fit={note} style={note.lines.length > 1 ? undefined : { lineHeight: 'normal' }} />
        </div>
      ) : null}
    </div>
  );
};

const Totals: React.FC<{ files: ReturnType<typeof sceneFiles> }> = ({ files }) => {
  const add = files.reduce((n, f) => n + (f.additions ?? 0), 0);
  const del = files.reduce((n, f) => n + (f.deletions ?? 0), 0);
  const tests = files.filter((f) => f.test).length;
  const counted = files.some((f) => f.additions !== undefined || f.deletions !== undefined);
  return (
    <div style={{ display: 'flex', gap: 22, fontSize: 21, color: colors.muted, flexShrink: 0, paddingBottom: 6, alignItems: 'baseline' }}>
      <span>
        {files.length} {files.length === 1 ? 'file' : 'files'}
      </span>
      {counted ? (
        <span style={{ fontFamily: fonts.mono, fontWeight: 700 }}>
          <span style={{ color: colors.add }}>+{add}</span> <span style={{ color: colors.del }}>{MINUS + del}</span>
        </span>
      ) : null}
      {tests ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: colors.accent }}>
          <FlaskConical size={20} strokeWidth={2.2} />
          {tests} {tests === 1 ? 'test' : 'tests'}
        </span>
      ) : null}
    </div>
  );
};

export const FileTree: React.FC<SceneProps<FilesScene>> = ({ scene, hunks, durationInFrames, segments }) => {
  const frame = useCurrentFrame();
  const box = contentBox(Boolean(scene.title));
  const files = useMemo(() => sceneFiles(scene, hunks), [scene, hunks]);
  const rows = useMemo(() => treeRows(files, scene.notes ?? {}), [files, scene.notes]);
  const layout = useMemo(() => layoutFiles(rows, box.width, box.height), [rows, box.width, box.height]);
  const top = Math.max(0, box.height - layout.height * layout.scale) * 0.3;
  const marks = useMemo(() => staged(filesBoxes(layout), { left: 0, top, scale: layout.scale }, box), [layout, top, box.width, box.height]);
  // With steps, each lights the files it focuses. Without, the narration walks `highlight` in order, or
  // else every file with a note, top to bottom.
  const walked = scene.highlight?.length ? scene.highlight : rows.flatMap((r) => (r.kind === 'file' && r.note ? [r.file.path] : []));
  const rowStagger = Math.min(4, (ROWS_END - START - 4) / Math.max(1, rows.length - 1));
  const rowAt = (i: number) => START + 4 + i * rowStagger;
  const { emphasis } = spotlight(frame, spotlightStarts(segments, walked.length, buildFrames('files')));
  const focus = focusSpotlight(scene, hunks, segments, frame);
  const fileEmphasis = (path: string | null) =>
    scene.steps?.length ? focus(`f:${path}`) : emphasis(path !== null && walked.includes(path) ? [walked.indexOf(path)] : []);

  return (
    <SceneShell scene={scene} durationInFrames={durationInFrames} camera={{ hunks, segments, targets: () => marks }} aside={<Totals files={files} />}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top,
          width: layout.totalWidth,
          height: layout.height,
          transform: `scale(${layout.scale})`,
          transformOrigin: 'top left',
        }}
      >
        {layout.rows.map((placed, i) => {
          const e = fileEmphasis(placed.row.kind === 'file' ? placed.row.file.path : null);
          // Directories stay readable while files are spotlit: they are the map, not the subject.
          const shown = placed.row.kind === 'dir' ? { ...e, opacity: Math.max(e.opacity, 0.7) } : e;
          return <Row key={i} placed={placed} layout={layout} at={rowAt(i)} emphasis={shown} frame={frame} />;
        })}
      </div>
      <PenMarks scene={scene} hunks={hunks} segments={segments} targets={() => marks} />
    </SceneShell>
  );
};
