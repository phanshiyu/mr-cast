import { FlaskConical } from 'lucide-react';
import type { sceneFiles } from '../../shared/files.mjs';
import { colors, fonts } from './theme';

const MINUS = '−';

/** The files scene's count of files, lines and tests, at the right end of its header. */
export const FilesTotals: React.FC<{ files: ReturnType<typeof sceneFiles> }> = ({ files }) => {
  const add = files.reduce((n, f) => n + (f.additions ?? 0), 0);
  const del = files.reduce((n, f) => n + (f.deletions ?? 0), 0);
  // A file split across parts is listed once under each, and is still one file.
  const unique = [...new Map(files.map((f) => [f.path, f])).values()];
  const tests = unique.filter((f) => f.test).length;
  const counted = files.some((f) => f.additions !== undefined || f.deletions !== undefined);
  return (
    <div
      style={{
        display: 'flex',
        gap: 22,
        fontSize: 21,
        color: colors.muted,
        flexShrink: 0,
        paddingBottom: 6,
        alignItems: 'baseline',
      }}
    >
      <span>
        {unique.length} {unique.length === 1 ? 'file' : 'files'}
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
