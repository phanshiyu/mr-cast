// Where a storyboard names a picture: an image scene's `src` and a compare cell's `image`. Shared by the CLI, which
// makes each one local (bin/lib/images.mjs), and the scenes, which draw the local copy.

const list = (v) => (Array.isArray(v) ? v : []);
const isSrc = (v) => typeof v === 'string' && v.trim().length > 0;

/** A compare cell that is a picture: `{ image, fit? }`. */
export const isImageCell = (cell) => Boolean(cell) && typeof cell === 'object' && !Array.isArray(cell) && 'image' in cell;

/** Every image source in the storyboard, in order, with the field that names it, e.g. "scenes[2].src". */
export function imageSources(storyboard) {
  return list(storyboard?.scenes).flatMap((scene, i) => {
    if (scene?.type === 'image') return isSrc(scene.src) ? [{ path: `scenes[${i}].src`, src: scene.src }] : [];
    if (scene?.type === 'compare') {
      return list(scene.rows).flatMap((row, j) => list(row?.cells).flatMap((cell, k) => (isImageCell(cell) && isSrc(cell.image) ? [{ path: `scenes[${i}].rows[${j}].cells[${k}].image`, src: cell.image }] : [])));
    }
    return [];
  });
}
