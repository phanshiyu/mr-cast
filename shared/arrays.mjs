// The arrays of an `array` scene, shared by the scene (which draws them), shared/targets.mjs and
// shared/state-steps.mjs (which name their cells) and `validate`. A scene with `values` has one array with no
// name, whose cells are "c:3"; a scene with `arrays` has named ones, whose cells are "c:left/3".

const list = (v) => (Array.isArray(v) ? v : []);

/** The scene's arrays in order, as { name, label, values, splits, hidden }; the one array of `values` is named "". */
export function arrayRows(scene) {
  if (Array.isArray(scene?.arrays)) {
    return scene.arrays.map((a) => ({
      name: String(a?.name ?? ''),
      label: a?.label ?? a?.name,
      values: list(a?.values),
      splits: list(a?.splits),
      hidden: a?.hidden === true,
    }));
  }
  return [{ name: '', label: scene?.label, values: list(scene?.values), splits: list(scene?.splits), hidden: false }];
}

/** The item key of cell `i` of the array named `name`. */
export const cellKey = (name, i) => (name ? `c:${name}/${i}` : `c:${i}`);

/** The item key of a whole named array. */
export const rowKey = (name) => `a:${name}`;

/** A cell key's array name and index. */
export function splitCellKey(key) {
  const body = key.slice(2);
  const slash = body.lastIndexOf('/');
  return slash < 0
    ? { name: '', index: Number(body) }
    : { name: body.slice(0, slash), index: Number(body.slice(slash + 1)) };
}

/** The array a pointer or range sits on: its own `array`, else the first. */
export const markerRow = (scene, marker) =>
  Array.isArray(scene?.arrays) ? (marker?.array ?? arrayRows(scene)[0]?.name ?? '') : '';

/** How a cell ref reads in words: "cell 3", or "left[3]" with named arrays. */
export const cellName = (name, i) => (name ? `${name}[${i}]` : `cell ${i}`);
