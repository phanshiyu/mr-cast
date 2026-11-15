import { AbsoluteFill, Img } from 'remotion';
import { colors, fonts } from './theme';
import '../fonts';

/** One scene's still in a contact sheet, with its label: "2 flow · Chapter". */
export type SheetTile = { src: string; label: string };

export type ContactSheetProps = { tiles: SheetTile[] };

const COLUMNS = 3;
const TILE_W = 600;
const TILE_H = 338;
const GAP = 14;
const LABEL_H = 40;

/** The sheet's pixel size for `count` tiles: three to a row, so a model viewing it still reads each tile's headline. */
export function sheetSize(count: number): { width: number; height: number } {
  const rows = Math.max(1, Math.ceil(count / COLUMNS));
  return { width: COLUMNS * TILE_W + (COLUMNS + 1) * GAP, height: rows * (TILE_H + LABEL_H + GAP) + GAP };
}

/** Every scene's still in a grid, each under a label with its scene number, type and chapter. */
export const ContactSheet: React.FC<ContactSheetProps> = ({ tiles }) => (
  <AbsoluteFill
    style={{
      background: colors.bg,
      padding: GAP,
      display: 'grid',
      gridTemplateColumns: `repeat(${COLUMNS}, ${TILE_W}px)`,
      gridAutoRows: TILE_H + LABEL_H,
      gap: GAP,
      alignContent: 'start',
    }}
  >
    {tiles.map((tile) => (
      <div key={tile.src}>
        <div
          style={{
            height: LABEL_H,
            display: 'flex',
            alignItems: 'center',
            fontFamily: fonts.mono,
            fontSize: 22,
            fontWeight: 600,
            color: colors.text,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          {tile.label}
        </div>
        <Img
          src={tile.src}
          style={{ width: TILE_W, height: TILE_H, display: 'block', border: `1px solid ${colors.borderStrong}` }}
        />
      </div>
    ))}
  </AbsoluteFill>
);
