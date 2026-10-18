// JSON.parse messages differ across Node versions and often omit the position, so on
// failure we rescan the text to report a line and column the LLM can jump to.

const LITERAL = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y;

/** @returns {{ pos: number, line: number, column: number, reason: string } | null} */
export function locateJsonError(text) {
  let i = 0;
  const fail = (reason) => {
    throw { pos: i, reason };
  };
  const ws = () => {
    while (' \t\n\r'.includes(text[i]) && i < text.length) i++;
  };

  const string = () => {
    i++;
    while (i < text.length) {
      const c = text[i];
      if (c === '"') {
        i++;
        return;
      }
      if (c === '\\') i += 2;
      else if (c < ' ') fail('raw control character or newline inside a string');
      else i++;
    }
    fail('unterminated string');
  };

  const sequence = (close, item) => {
    i++;
    ws();
    if (text[i] === close) {
      i++;
      return;
    }
    for (;;) {
      item();
      ws();
      if (text[i] === ',') {
        i++;
        ws();
        if (text[i] === close) fail(`trailing comma before '${close}'`);
        continue;
      }
      if (text[i] === close) {
        i++;
        return;
      }
      fail(`expected ',' or '${close}'`);
    }
  };

  const value = () => {
    ws();
    const c = text[i];
    if (c === '{')
      return sequence('}', () => {
        ws();
        if (text[i] !== '"') fail('expected a double-quoted property name');
        string();
        ws();
        if (text[i] !== ':') fail("expected ':' after property name");
        i++;
        value();
      });
    if (c === '[') return sequence(']', value);
    if (c === '"') return string();
    LITERAL.lastIndex = i;
    const m = LITERAL.exec(text);
    if (m) {
      i += m[0].length;
      return;
    }
    fail(i >= text.length ? 'unexpected end of input' : `unexpected ${JSON.stringify(c)}`);
  };

  try {
    value();
    ws();
    if (i < text.length) fail('unexpected text after the JSON value');
    return null;
  } catch (err) {
    if (err.reason === undefined) throw err;
    const before = text.slice(0, err.pos).split('\n');
    return { ...err, line: before.length, column: before[before.length - 1].length + 1 };
  }
}
