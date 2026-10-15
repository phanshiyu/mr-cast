import type { Change } from '../types';
import { CHANGE_WORD } from '../utils/marks';
import { changeTone } from './marks';
import { colors, fonts } from './theme';

const ORDER: Change[] = ['added', 'removed', 'modified'];

/** Lists only the change kinds a scene uses, so the viewer can decode the colours. */
export const ChangeLegend: React.FC<{ used: ReadonlySet<Change> }> = ({ used }) => (
  <div style={{ display: 'flex', gap: 22, fontSize: 19, color: colors.muted, flexShrink: 0, paddingBottom: 6 }}>
    {ORDER.filter((c) => used.has(c)).map((c) => (
      <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            background: changeTone[c].bg,
            border: `1px solid ${changeTone[c].color}88`,
            color: changeTone[c].color,
            fontFamily: fonts.mono,
            fontWeight: 800,
            fontSize: 19,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {changeTone[c].marker}
        </span>
        {CHANGE_WORD[c]}
      </div>
    ))}
  </div>
);
