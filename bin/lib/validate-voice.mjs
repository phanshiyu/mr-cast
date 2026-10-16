// How the voice talks: warnings on spoken text (narration and every step's `say`) that a listener cannot follow
// by ear, such as code names read out, a bare status code, a long sentence, a scene that opens on "It", or a
// term nobody explained. Each warning quotes the phrase and says what to say instead.

import { sceneSteps } from '../../shared/steps.mjs';
import { spokenTexts, wordCount } from '../../shared/timing.mjs';

const SENTENCE_MAX = 25;

/** Words that look like code but are names a listener knows. */
const KNOWN_NAMES = new Set([
  'iPhone', 'iPad', 'iOS', 'macOS', 'iCloud', 'eBay', 'JavaScript', 'TypeScript', 'GitHub', 'GitLab', 'PostgreSQL', 'MySQL',
  'SQLite', 'MongoDB', 'DynamoDB', 'GraphQL', 'OAuth', 'WebSocket', 'WebSockets', 'PayPal', 'YouTube', 'LinkedIn', 'OpenAI',
  'WordPress', 'RabbitMQ', 'CloudFront', 'BigQuery', 'PagerDuty', 'FastAPI', 'NestJS', 'NextAuth', 'DevOps',
]);

/** "createOrder" or "OrderService" as the words a person would say: "create order", "order service". */
const words = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/[_.:/-]+/g, ' ').trim().toLowerCase();

/** HTTP status codes a sentence might read out, and what each means. */
const STATUSES = {
  200: 'OK', 201: 'created', 202: 'accepted', 204: 'no content', 301: 'moved permanently', 302: 'found', 304: 'not modified',
  400: 'bad request', 401: 'unauthorized', 403: 'forbidden', 404: 'not found', 405: 'method not allowed', 409: 'conflict',
  410: 'gone', 413: 'too large', 415: 'unsupported media type', 422: 'unprocessable', 429: 'too many requests', 500: 'server error',
  502: 'bad gateway', 503: 'unavailable', 504: 'gateway timeout',
};
/** A word after the number that makes it a count or an amount, not a status: "500 orders", "200 milliseconds". */
const COUNTED = /^(?:[a-z]+s|ms|kb|mb|gb|percent|times|lines?|rows?|words?|minutes?|seconds?|hours?|days?|users?|people|items?|bytes?|requests?)$/i;
/** A word near the number that explains it as a status. */
const STATUS_WORDS = /\b(?:status|code|response|error|ok|created|accepted|no content|moved|redirect|not modified|bad request|unauthori[sz]ed|forbidden|not found|not allowed|conflict|too large|unsupported|unprocessable|too many requests|server error|bad gateway|unavailable|timeout|timed out)\b/i;

/**
 * Terms a listener stumbles on unless they are explained, each with plain words to use instead. Kept short on
 * purpose: everyday developer words (Redis, endpoint, queue, cache) are fine.
 */
const JARGON = [
  [/\bidempoten(?:t|cy)\b/i, 'safe to repeat'],
  [/\bmiddleware\b/i, 'a step that runs before the route, such as "the limiter runs before every order request"'],
  [/\bmount(?:s|ed|ing)?\b/i, 'what it does, such as "puts the limiter in front of the orders route"'],
  [/\bshort-circuit(?:s|ed|ing)?\b/i, '"stops early"'],
  [/\bupserts?\b/i, '"adds the row, or updates it if it is already there"'],
  [/\bmemoi[sz](?:e|es|ed|ing|ation)\b/i, '"remembers the result"'],
  [/\bdebounc(?:e|es|ed|ing)\b/i, '"waits for a pause before it acts"'],
  [/\bfire-and-forget\b/i, '"without waiting for an answer"'],
  [/\bno-op\b/i, '"does nothing"'],
  [/\b(?:truthy|falsy|nullish)\b/i, 'the values it means, such as "empty or missing"'],
  [/\bSKUs?\b/, '"product code"'],
  [/\bTTL\b/, '"expiry time"'],
  [/\bINCR\b/, '"adds one to the count"'],
  [/\bRetry-After\b/i, '"tells the client how long to wait"'],
  [/\bpayloads?\b/i, 'what it carries, such as "the order id and total"'],
  [/\bmutex\b/i, '"a lock"'],
  [/\bregexp?\b/i, '"pattern"'],
  [/\bde-?dup(?:e|es|ed|licates?)\b/i, '"drops repeats"'],
  [/\bhydrat(?:e|es|ed|ion)\b/i, 'what it fills in'],
  [/\bserializ(?:e|es|ed|ation)\b/i, '"turns into text" or "saves"'],
  [/\bPromise\.?\s?all\b/i, '"all at the same time"'],
  [/\bawait(?:s|ed|ing)?\b/i, '"waits for"'],
  [/\bstub(?:s|bed)?\b/i, '"a placeholder"'],
];
/** Sentence shapes that explain a term right where it is used: "Redis, the shared store", "a SKU is a product code". */
const EXPLAINED_AFTER = /^\s*(?:,\s*(?:a|an|the|which|meaning|that is)\b|\s*\(|\s+(?:is|are|means)\s+(?:a|an|the|when|that)\b)/i;

/** Whether `next`, the sentence after a term, explains it: "A middleware is a function that ...". */
const explainsNext = (next, term) => typeof next === 'string' && new RegExp(`^(?:an?|the)?\\s*${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(?:is|are|means)\\b`, 'i').test(next);

/** Rules on one sentence; each match is a phrase the voice should not say as written, and what to say instead. */
const PHRASE_RULES = [
  { find: /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/[\w/:{}.-]*/g, say: () => 'what the request does, such as "a request to create an order"' },
  { find: /(?<![\w/])\/[a-z][\w-]*(?:\/[\w:{}.-]+)*/g, say: (m) => `the route by what it is for, such as "the ${words(m)} route"` },
  { find: /\b[\w-]+(?:\/[\w.-]+){2,}/g, say: (m) => `the file by what it holds, such as "the ${words(m.split('/').pop().replace(/\.\w+$/, ''))} file"` },
  { find: /\b[\w-]+\.(?:tsx?|jsx?|mjs|cjs|py|rb|go|rs|java|kt|swift|json|ya?ml|toml|sql|sh|css|html|md|env|lock)\b/g, say: (m) => `the file by what it holds, such as "the ${words(m.replace(/\.\w+$/, ''))} file"` },
  { find: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, say: (m) => `the setting by what it does, such as "the ${words(m)} setting"` },
  { find: /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g, say: (m) => `"${words(m)}", or what it is` },
  { find: /\b[a-z]+[A-Z][a-zA-Z0-9]*\b/g, say: (m) => `"the ${words(m)} function" or what it does` },
  { find: /\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+\b/g, say: (m) => `"the ${words(m)}" or what it is` },
  { find: /\b[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+(?:\(\))?/g, skip: (m) => /^(?:e\.g|i\.e|etc|vs)$/i.test(m) || /^[a-z]{2,}\.(?:com|org|io|dev|net)$/.test(m), say: (m) => `"${words(m.replace(/\(\)$/, ''))}", or what it is` },
  { find: /\w+::\w+/g, say: (m) => `"${words(m)}", or what it is` },
  { find: /\b\w+\(\)|=>|===?|!==?|&&|\|\||\+\+|\+=|<=|>=/g, say: () => 'the operation in words, such as "is the same as", "and", or "calls"' },
];

/**
 * Openers that point back at something the scene has not named yet. "This is the limiter" names its subject at
 * once, so a this or these that introduces a noun is fine.
 */
const BARE_OPENER = /^(?:It|They|Them)\b|^(?:This|That|These|Those)\s+(?!(?:is|was|are|were)\s+(?:the|a|an|how|where|what|why|our|one|two|three)\b)(?:is|was|are|were|has|had|does|did|will|would|can|could|should|may|might|means|makes|lets|keeps|happens|works|matters|runs|calls|checks|returns|sends|sets|gets|adds|stops|starts|uses|needs|shows)\b|^(?:This|That)\s+[a-z]+s(?<!ss|us|is)\b|^(?:This|That|These|Those)[,.]/;

/** Sentences of a spoken text, split at a full stop, question mark or exclamation mark followed by a space. */
export const sentences = (text) => String(text ?? '').split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

const excerpt = (text) => (text.length > 50 ? `${text.slice(0, 47)}...` : text);

function checkStatusCodes(sentence, at, warnings) {
  for (const m of sentence.matchAll(/\b([1-5]\d\d)\b/g)) {
    const meaning = STATUSES[m[1]];
    if (!meaning) continue;
    const next = sentence.slice(m.index + m[0].length).match(/^\s+([A-Za-z]+)/)?.[1];
    if (next && COUNTED.test(next)) continue;
    const near = sentence.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40);
    if (STATUS_WORDS.test(near)) continue;
    warnings.push(`${at}: "${m[1]}" is a bare status code; say what it means, "${meaning}", and the number only if it matters`);
  }
}

/**
 * Warnings for spoken text a listener cannot follow by ear. The text is what the voice says: markup dropped and
 * the forms the voice rewrites already in words. `simple` style has its own shorter sentence limit.
 */
export function checkVoice(storyboard, { simple = false } = {}, warnings) {
  const explained = new Set();
  storyboard.scenes.forEach((scene, i) => {
    if (!scene || typeof scene !== 'object') return;
    const p = `scenes[${i}]`;
    const paths = [`${p}.narration`, ...sceneSteps(scene).map((_, j) => `${p}.steps[${j}].say`)];
    let first = true;
    spokenTexts(scene).forEach((text, k) => {
      if (typeof text !== 'string' || !text.trim()) return;
      const at = paths[k];
      const all = sentences(text);
      all.forEach((sentence, n) => {
        if (first && BARE_OPENER.test(sentence)) {
          warnings.push(`${at}: the scene opens with "${sentence.split(/\s+/).slice(0, 3).join(' ')}", which points at nothing yet; name the subject, such as "The rate limiter ..."`);
        }
        first = false;
        const count = wordCount(sentence);
        if (!simple && count > SENTENCE_MAX) warnings.push(`${at}: a sentence of ${count} words ("${excerpt(sentence)}"); a listener cannot hold that, so split it into sentences of one idea each`);
        /** [start, end) of each phrase already reported, so a path is not reported again as a file name. */
        const taken = [];
        for (const rule of PHRASE_RULES) {
          for (const { 0: m, index } of sentence.matchAll(rule.find)) {
            const end = index + m.length;
            if (KNOWN_NAMES.has(m) || /^[A-Z]\w*\.js$/.test(m) || rule.skip?.(m) || taken.some(([a, b]) => index < b && a < end)) continue;
            taken.push([index, end]);
            warnings.push(`${at}: "${m}" reads as code aloud; say ${rule.say(m)}. The screen shows the exact name`);
          }
        }
        checkStatusCodes(sentence, at, warnings);
        for (const [term, plain] of JARGON) {
          const m = sentence.match(term);
          if (!m || explained.has(term)) continue;
          explained.add(term);
          if (EXPLAINED_AFTER.test(sentence.slice(m.index + m[0].length)) || explainsNext(all[n + 1], m[0])) continue;
          warnings.push(`${at}: "${m[0]}" is jargon to a listener; say ${plain}, or explain it in a few words the first time`);
        }
      });
    });
  });
}
