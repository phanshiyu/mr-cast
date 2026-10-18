// Inline markup in the text a scene draws, shared by the player and `validate`.
//
//   **bold**          heavier weight
//   `code`            monospace chip; everything inside is literal
//   ==marked==        highlighter behind the words
//   [words]{tone}     words in a tone: good, bad, warn, accent or neutral
//
// Bold and code may sit inside a tone or a mark; a tone and a mark never nest. `**` and `==` open only
// before a non-space and close only after one, so `a ** b` and `x == y` stay literal, and `[` is
// markup only when `]{tone}` follows. A backslash before * ` = [ ] { } or \ keeps that character literal.

export const TONE_NAMES = ['good', 'bad', 'warn', 'accent', 'neutral'];

const ESCAPABLE = '*`=[]{}\\';

/**
 * @typedef {{ text: string, bold?: boolean, code?: boolean, mark?: boolean, tone?: string }} Run
 * @typedef {{ at: number, message: string }} MarkupError
 */

const isSpace = (ch) => ch === undefined || /\s/.test(ch);

/** Index of the `]` that closes a tone span opened at `open`, skipping escapes and code; -1 when none. */
function closingBracket(src, open) {
  for (let i = open + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') i++;
    else if (ch === '`') {
      const end = src.indexOf('`', i + 1);
      if (end < 0) return -1;
      i = end;
    } else if (ch === ']') return i;
    else if (ch === '[' || ch === '\n') return -1;
  }
  return -1;
}

/**
 * Splits `src` into styled runs. Malformed markup is kept as literal text and reported in `errors`,
 * each with the 1-based column it starts at.
 * @param {string} src
 * @returns {{ runs: Run[], errors: MarkupError[] }}
 */
export function parseMarkup(src) {
  const text = String(src ?? '');
  /** @type {Run[]} */
  const runs = [];
  /** @type {MarkupError[]} */
  const errors = [];
  const style = { bold: false, mark: false, tone: undefined };
  /** Where each open span started, to report the ones never closed. */
  const opened = { bold: -1, mark: -1, tone: -1 };
  let toneEnd = -1;
  let buf = '';
  const flush = (extra = {}) => {
    if (!buf) return;
    const run = { text: buf };
    if (style.bold) run.bold = true;
    if (style.mark) run.mark = true;
    if (style.tone) run.tone = style.tone;
    Object.assign(run, extra);
    const last = runs[runs.length - 1];
    if (last && !extra.code && !last.code && last.bold === run.bold && last.mark === run.mark && last.tone === run.tone)
      last.text += buf;
    else runs.push(run);
    buf = '';
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && ESCAPABLE.includes(text[i + 1] ?? '')) {
      buf += text[++i];
      continue;
    }
    if (i === toneEnd) {
      flush();
      style.tone = undefined;
      opened.tone = -1;
      i = text.indexOf('}', i);
      toneEnd = -1;
      continue;
    }
    if (ch === '`') {
      let end = -1;
      let code = '';
      for (let j = i + 1; j < text.length; j++) {
        if (text[j] === '\\' && text[j + 1] === '`') {
          code += '`';
          j++;
        } else if (text[j] === '`') {
          end = j;
          break;
        } else code += text[j];
      }
      if (end < 0) {
        errors.push({
          at: i + 1,
          message: 'a ` that never closes; close the code with a second `, or write \\` for a literal one',
        });
        buf += ch;
        continue;
      }
      flush();
      buf = code;
      flush({ code: true });
      i = end;
      continue;
    }
    const pair = text.slice(i, i + 2);
    if (pair === '**' || pair === '==') {
      const key = pair === '**' ? 'bold' : 'mark';
      const canOpen = !isSpace(text[i + 2]);
      const canClose = !isSpace(text[i - 1]);
      if (style[key] && canClose) {
        flush();
        style[key] = false;
        opened[key] = -1;
        i++;
        continue;
      }
      if (!style[key] && canOpen) {
        if (key === 'mark' && style.tone)
          errors.push({ at: i + 1, message: '== inside a [ ]{tone}; a mark and a tone do not nest' });
        else if (key === 'mark' && style.bold)
          errors.push({ at: i + 1, message: '== inside **bold**; put the bold inside the mark instead' });
        else {
          flush();
          style[key] = true;
          opened[key] = i;
          i++;
          continue;
        }
      }
      buf += pair;
      i++;
      continue;
    }
    if (ch === '[') {
      const close = closingBracket(text, i);
      const tone = close >= 0 ? /^\{([A-Za-z]*)\}/.exec(text.slice(close + 1)) : null;
      if (tone) {
        if (!TONE_NAMES.includes(tone[1])) {
          errors.push({ at: close + 2, message: `unknown tone "${tone[1]}"; use ${TONE_NAMES.join(', ')}` });
        } else if (style.tone || style.mark || style.bold) {
          errors.push({
            at: i + 1,
            message: 'a [ ]{tone} inside other markup; a tone goes outermost, with any **bold** inside it',
          });
        } else {
          flush();
          style.tone = tone[1];
          opened.tone = i;
          toneEnd = close;
          continue;
        }
      }
    }
    buf += ch;
  }
  flush();
  if (style.bold)
    errors.push({
      at: opened.bold + 1,
      message: '** that never closes; end the bold with a second ** right after a word, or write \\* for a literal one',
    });
  if (style.mark)
    errors.push({
      at: opened.mark + 1,
      message: '== that never closes; end the mark with a second == right after a word, or write \\= for a literal one',
    });
  return { runs, errors };
}

/** The text without its markup, as a voice reads it. */
export function plainText(src) {
  return parseMarkup(src)
    .runs.map((r) => r.text)
    .join('');
}

/** Whether `src` has any markup in it. */
export function hasMarkup(src) {
  const { runs } = parseMarkup(src);
  return runs.some((r) => r.bold || r.code || r.mark || r.tone) || plainText(src) !== String(src ?? '');
}

/** Share of the characters (0 to 1) that are bold, code, marked or toned. */
export function styledShare(src) {
  const { runs } = parseMarkup(src);
  const total = runs.reduce((n, r) => n + r.text.length, 0);
  const styled = runs.reduce((n, r) => n + (r.bold || r.code || r.mark || r.tone ? r.text.length : 0), 0);
  return total ? styled / total : 0;
}
