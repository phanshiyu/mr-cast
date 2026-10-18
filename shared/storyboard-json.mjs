// A JSON object puts names such as "2" before every other name, whatever order they were written in. A memory
// scene draws its variables and fields in the order written, and a later tint key wins over an earlier one
// ({ "0-5": "dim", "3": "good" } leaves cell 3 good), so where a storyboard enters, as text, each memory frame's
// `vars`, object's `fields`, and every scene's and step's `tint` become [name, value] pairs in that order.
// Pairs survive every later JSON round trip, such as the render's props and the player's fetch.

const STRING = /"(?:[^"\\]|\\.)*"(\s*:)?/g;
/** Put before every property name while parsing, so no name reads as an index and every object keeps its order. */
const TAG = '~';

const isRecord = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

const untag = (v) => (Array.isArray(v) ? v.map(untag) : isRecord(v) ? Object.fromEntries(pairsOf(v)) : v);
const pairsOf = (tagged) => Object.entries(tagged).map(([name, value]) => [name.slice(TAG.length), untag(value)]);

/** storyboard.json's text as a storyboard, with memory vars and fields as pairs in the order written. Throws as JSON.parse does. */
export function parseStoryboard(text) {
  const tagged = JSON.parse(text.replace(STRING, (s, colon) => (colon ? `"${TAG}${s.slice(1)}` : s)));
  const storyboard = untag(tagged);
  const at = (v, name) => (isRecord(v) ? v[TAG + name] : undefined);
  const scenes = at(tagged, 'scenes');
  if (!Array.isArray(scenes)) return storyboard;
  const ordered = (tagged, plain, field) => {
    const record = at(tagged, field);
    if (isRecord(record)) plain[field] = pairsOf(record);
  };
  scenes.forEach((scene, i) => {
    ordered(scene, storyboard.scenes[i], 'tint');
    const steps = at(scene, 'steps');
    if (Array.isArray(steps)) steps.forEach((step, k) => ordered(step, storyboard.scenes[i].steps[k], 'tint'));
    if (at(scene, 'type') !== 'memory') return;
    for (const [list, field] of [
      ['frames', 'vars'],
      ['objects', 'fields'],
    ]) {
      const items = at(scene, list);
      if (!Array.isArray(items)) continue;
      items.forEach((item, j) => {
        const record = at(item, field);
        if (isRecord(record)) storyboard.scenes[i][list][j][field] = pairsOf(record);
      });
    }
  });
  return storyboard;
}

const orderedEntries = (v) =>
  Array.isArray(v)
    ? v.filter((p) => Array.isArray(p) && typeof p[0] === 'string')
    : isRecord(v)
      ? Object.entries(v)
      : [];
/** A memory frame's vars or an object's fields as [name, value] pairs, in order, from pairs or an object. */
export const memoryMembers = orderedEntries;
/** A tint as [ref, tint] pairs, in the order written, from pairs or an object. */
export const tintEntries = orderedEntries;
