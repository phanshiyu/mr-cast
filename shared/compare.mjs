// The compare scene's sides and rows, shared by the scene (which draws them) and the CLI (which checks and outlines them).

/** A compare scene's two side titles, "Before" and "After" unless it names its own. */
export const compareTitles = (scene) => ['Before', 'After'].map((fallback, i) => (typeof scene?.sides?.[i]?.title === 'string' ? scene.sides[i].title : fallback));

const cellKey = (cell) => (typeof cell === 'string' ? cell.trim() : `${cell?.lang ?? ''}\n${cell?.code ?? ''}`);

/** Whether a row reads the same on both sides: its own `same`, or else whether its two cells are equal. */
export const compareRowSame = (row) => row?.same ?? (Array.isArray(row?.cells) && row.cells.length === 2 && cellKey(row.cells[0]) === cellKey(row.cells[1]));
