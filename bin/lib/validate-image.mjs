// Checks for the image scene and a compare cell's picture, mirroring src/types.ts. Whether the file itself can be shown
// is bin/lib/images.mjs's to say; these check the fields. Each pushes human/LLM-readable strings onto `errors`.

const FITS = ['contain', 'cover'];
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;

/** A source as written: a relative path or an http(s) URL, and no SVG. */
export function checkImageSrc(src, q, errors) {
  if (!isStr(src))
    return errors.push(
      `${q}: required string, a path relative to the run directory or the repository, or an http(s) URL`,
    );
  if (/\.svgz?(?:[?#].*)?$/i.test(src))
    errors.push(
      `${q}: ${JSON.stringify(src)} is an SVG image, which mr-cast does not show as a picture since it can carry scripts; draw it in an svg scene, or convert it to PNG`,
    );
}

export function checkImageFit(fit, q, errors) {
  if (fit !== undefined && !FITS.includes(fit)) errors.push(`${q}: must be one of ${FITS.join(', ')}`);
}

/** A box of fractions, [x, y, width, height], that lies inside the picture. */
function boxProblem(box) {
  if (!Array.isArray(box) || box.length !== 4 || !box.every((v) => typeof v === 'number' && Number.isFinite(v)))
    return 'must be [x, y, width, height], fractions of the picture from its top left, e.g. [0.1, 0.2, 0.3, 0.25]';
  const [x, y, w, h] = box;
  if (w <= 0 || h <= 0) return 'needs a width and height above 0';
  if (x < 0 || y < 0 || x + w > 1 + 1e-9 || y + h > 1 + 1e-9)
    return 'runs past the picture; x + width and y + height are at most 1';
  return null;
}

export function checkImage(s, p, errors) {
  for (const k of ['title', 'caption', 'credit'])
    if (s[k] !== undefined && typeof s[k] !== 'string') errors.push(`${p}.${k}: must be a string`);
  checkImageSrc(s.src, `${p}.src`, errors);
  checkImageFit(s.fit, `${p}.fit`, errors);
  const ids = new Set();
  if (s.regions !== undefined) {
    if (!Array.isArray(s.regions)) errors.push(`${p}.regions: must be an array of { id, box, label? }`);
    else
      s.regions.forEach((r, i) => {
        const q = `${p}.regions[${i}]`;
        if (!r || typeof r !== 'object') return errors.push(`${q}: must be { id, box, label? }`);
        if (!isStr(r.id)) errors.push(`${q}.id: required string, e.g. "door"`);
        else if (ids.has(r.id)) errors.push(`${q}.id: "${r.id}" is taken; every region has its own id`);
        else ids.add(r.id);
        const bad = boxProblem(r.box);
        if (bad) errors.push(`${q}.box: ${bad}`);
        if (r.label !== undefined && typeof r.label !== 'string') errors.push(`${q}.label: must be a string`);
      });
  }
  const kb = s.kenBurns;
  if (kb === undefined || typeof kb === 'boolean') return;
  if (!kb || typeof kb !== 'object' || Array.isArray(kb))
    return errors.push(`${p}.kenBurns: must be true, or { from?, to? }, each a region id or a box`);
  for (const end of ['from', 'to']) {
    const at = kb[end];
    if (at === undefined) continue;
    if (typeof at === 'string') {
      if (!ids.has(at))
        errors.push(
          `${p}.kenBurns.${end}: ${JSON.stringify(at)} is no region id${ids.size ? `; they are ${[...ids].map((id) => JSON.stringify(id)).join(', ')}` : '; the scene has no regions'}`,
        );
    } else {
      const bad = boxProblem(at);
      if (bad) errors.push(`${p}.kenBurns.${end}: ${bad}`);
    }
  }
}
