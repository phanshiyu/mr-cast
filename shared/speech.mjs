// Spoken text as the voice should read it. Kokoro reads a few written forms badly ("e.g." as "ee jee", "5s" as
// "fives", "ms" as "em ess", an arrow as nothing), so each is rewritten to the words a person would say. Only forms
// with one reading are rewritten. Anything else that reads as code is left for `validate` to point out.

/** [written form, spoken form], applied in order. */
const SPOKEN_FORMS = [
  [/\be\.g\.,?/gi, 'for example,'],
  [/\bi\.e\.,?/gi, 'that is,'],
  [/\s*(?:->|→)\s*/g, ' to '],
  [/(\d)\s?ms\b/g, '$1 milliseconds'],
  // "5s", but not a decade ("the 90s", "1990s").
  [/(?<!\bthe\s)\b(\d{1,3}(?:\.\d+)?)s\b/g, '$1 seconds'],
  [/(\w)\/(?:s|sec|second)\b/g, '$1 per second'],
  [/(\w)\/(?:min|minute)\b/g, '$1 per minute'],
  [/(\w)\/(?:h|hr|hour)\b/g, '$1 per hour'],
  [/(\w)\/day\b/g, '$1 per day'],
  [/(\d)\s?reqs?\b/g, '$1 requests'],
  // "v0.14" or "0.14.2" is a version, read part by part ("zero point fourteen"), never as a decimal.
  [/\bv(\d+(?:\.\d+)*)\b/g, (_, v) => `version ${v.split('.').join(' point ')}`],
  [/\b\d+\.\d+\.\d+\b/g, (v) => v.split('.').join(' point ')],
];

/** `text` with each written form the voice misreads replaced by its spoken words. */
export function speechText(text) {
  let out = String(text ?? '');
  for (const [form, spoken] of SPOKEN_FORMS) out = out.replace(form, spoken);
  return out.replace(/,(\s*[,.!?])/g, '$1').replace(/ {2,}/g, ' ');
}
