// Spoken text as the voice should read it. Kokoro reads a few written forms badly ("e.g." as "ee jee", "5s" as
// "fives", "ms" as "em ess", an arrow as nothing), so each is rewritten to the words a person would say. Only forms
// with one reading are rewritten. Anything else that reads as code is left for `validate` to point out.

/** [written form, spoken form], applied in order. */
const SPOKEN_FORMS = [
  [/\be\.g\.,?/gi, 'for example,'],
  [/\bi\.e\.,?/gi, 'that is,'],
  [/(?<![<-])\s*(?:-{1,2}>|→)\s*/g, ' to '],
  [/(\d)\s?ms\b/g, '$1 milliseconds'],
  // "5s" and "1.5s", but not a count ("100s of", "1,000s"), a decade ("the 90s", "mid-90s") or a name ("747s").
  [/(?<!\b(?:the|and|or|early|late|mid)[\s-]+|[\d,.$-])\b(\d{1,2}(?:\.\d+)?)s\b(?!-|\s+of\b)/gi, '$1 seconds'],
  [/(\w)\/(?:s|sec|second)\b/g, '$1 per second'],
  [/(\w)\/(?:min|minute)\b/g, '$1 per minute'],
  [/(\w)\/(?:h|hr|hour)\b/g, '$1 per hour'],
  [/(\w)\/day\b/g, '$1 per day'],
  [/(\d)\s?reqs?\b/g, '$1 requests'],
  // "v0.14" or "0.14.2" is a version, read part by part ("zero point fourteen"), never as a decimal. Not a bare
  // "v87", which is as often an id as a version, not inside a route or a URL ("/v1/orders"), and not an address
  // with four parts.
  [/(?<![\w/.]|\bversion\s)v(\d+(?:\.\d+)+)(?![\w/]|\.\d)/gi, (_, v) => `version ${v.split('.').join(' point ')}`],
  [/(?<![\w.])\d+\.\d+\.\d+(?![\w]|\.\d)/g, (v) => v.split('.').join(' point ')],
];

/** `text` with each written form the voice misreads replaced by its spoken words. */
export function speechText(text) {
  const written = String(text ?? '');
  let out = written;
  for (const [form, spoken] of SPOKEN_FORMS) out = out.replace(form, spoken);
  // Tidy only what a rewrite left behind, so text without these forms keeps its exact words and its clip.
  return out === written ? written : out.replace(/,(\s*[,.!?]|\s*$)/g, '$1').replace(/ {2,}/g, ' ');
}
