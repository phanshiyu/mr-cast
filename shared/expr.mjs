// A small arithmetic language for the plot scene's functions and coordinates: numbers, names, + - * / ^, unary
// minus, parentheses, a fixed set of functions, pi and e, and sum(k, from, to, term). It parses to a tree and
// evaluates the tree; nothing is passed to eval or Function, and there is no property access, so an expression
// can only compute a number from the names it is given.

/** Functions by name: how many arguments they take (min, max) and what they compute. */
const FUNCTIONS = {
  sin: [1, 1, Math.sin],
  cos: [1, 1, Math.cos],
  tan: [1, 1, Math.tan],
  asin: [1, 1, Math.asin],
  acos: [1, 1, Math.acos],
  atan: [1, 1, Math.atan],
  exp: [1, 1, Math.exp],
  log: [1, 1, Math.log],
  ln: [1, 1, Math.log],
  log10: [1, 1, Math.log10],
  sqrt: [1, 1, Math.sqrt],
  abs: [1, 1, Math.abs],
  sign: [1, 1, Math.sign],
  floor: [1, 1, Math.floor],
  ceil: [1, 1, Math.ceil],
  round: [1, 1, Math.round],
  mod: [2, 2, (a, b) => a - b * Math.floor(a / b)],
  min: [1, Infinity, Math.min],
  max: [1, Infinity, Math.max],
};
const CONSTANTS = { pi: Math.PI, e: Math.E };
/** Own keys only, so a name such as "constructor" or "toString" never reaches an object's prototype. */
const own = (record, name) => Object.hasOwn(record, name);
/** Names an expression cannot give a parameter or a sum's index, since they mean something already. */
export const RESERVED_NAMES = [...Object.keys(FUNCTIONS), 'sum', ...Object.keys(CONSTANTS)];
export const FUNCTION_NAMES = [...Object.keys(FUNCTIONS), 'sum'];
/** The most terms one sum adds; past it the sum has no value. */
export const MAX_TERMS = 10000;

const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*/;

/** The expression's tokens, each with its 0-based position, or an error at the first character that starts none. */
function tokenize(text) {
  const tokens = [];
  for (let at = 0; at < text.length; ) {
    const rest = text.slice(at);
    const space = /^\s+/.exec(rest);
    if (space) {
      at += space[0].length;
      continue;
    }
    const num = NUMBER.exec(rest);
    if (num) {
      tokens.push({ kind: 'num', value: Number(num[0]), text: num[0], at });
      at += num[0].length;
      continue;
    }
    const name = NAME.exec(rest);
    if (name) {
      tokens.push({ kind: 'name', text: name[0], at });
      at += name[0].length;
      continue;
    }
    const ch = rest[0];
    if (ch === 'π') tokens.push({ kind: 'name', text: 'pi', at });
    else if (ch === '−') tokens.push({ kind: 'op', text: '-', at });
    else if (ch === '×' || ch === '·') tokens.push({ kind: 'op', text: '*', at });
    else if (ch === '*' && rest[1] === '*') return { error: { message: 'write a power with ^, as in x^2', at } };
    else if ('+-*/^(),'.includes(ch)) tokens.push({ kind: 'op', text: ch, at });
    else return { error: { message: `unexpected ${JSON.stringify(ch)}${ch === '.' ? '; a name cannot be followed by a dot' : ''}`, at } };
    at += 1;
  }
  return { tokens };
}

class ParseError extends Error {
  constructor(message, at) {
    super(message);
    this.at = at;
  }
}

/**
 * The expression's tree, or an error with its message and 0-based position.
 * @returns {{ ast: import('./expr').Expr } | { error: { message: string, at: number } }}
 */
export function parseExpr(text) {
  if (typeof text !== 'string' || !text.trim()) return { error: { message: 'is empty', at: 0 } };
  const lexed = tokenize(text);
  if (lexed.error) return lexed;
  const tokens = lexed.tokens;
  let i = 0;
  const peek = () => tokens[i];
  const isOp = (op) => peek()?.kind === 'op' && peek().text === op;
  const end = text.length;
  const describe = (t) => (t ? JSON.stringify(t.text) : 'the end');
  const expect = (op, opened) => {
    if (isOp(op)) return void i++;
    const t = peek();
    throw new ParseError(opened ? `expected ")" to close the "(" at column ${opened.at + 1}, found ${describe(t)}` : `expected ${JSON.stringify(op)}, found ${describe(t)}`, t?.at ?? end);
  };

  const additive = () => {
    let left = multiplicative();
    while (isOp('+') || isOp('-')) {
      const op = tokens[i++];
      left = { kind: 'bin', op: op.text, left, right: multiplicative(), at: op.at };
    }
    return left;
  };
  const multiplicative = () => {
    let left = unary();
    while (isOp('*') || isOp('/')) {
      const op = tokens[i++];
      left = { kind: 'bin', op: op.text, left, right: unary(), at: op.at };
    }
    return left;
  };
  // Unary minus binds looser than ^, so -x^2 is -(x^2), and a power's exponent may be negative: 2^-x.
  const unary = () => {
    if (isOp('-') || isOp('+')) {
      const op = tokens[i++];
      const arg = unary();
      return op.text === '-' ? { kind: 'neg', arg, at: op.at } : arg;
    }
    return power();
  };
  const power = () => {
    const base = primary();
    if (!isOp('^')) return base;
    const op = tokens[i++];
    return { kind: 'bin', op: '^', left: base, right: unary(), at: op.at };
  };
  const primary = () => {
    const t = peek();
    if (!t) throw new ParseError('ends too soon; something is missing at the end', end);
    let node;
    if (t.kind === 'num') {
      i++;
      node = { kind: 'num', value: t.value, at: t.at };
    } else if (t.kind === 'name') {
      i++;
      node = isOp('(') ? call(t) : { kind: 'name', name: t.text, at: t.at };
    } else if (isOp('(')) {
      i++;
      node = additive();
      expect(')', t);
    } else throw new ParseError(`unexpected ${describe(t)}`, t.at);
    const next = peek();
    if (next && (next.kind !== 'op' || next.text === '(')) throw new ParseError(`expected an operator before ${describe(next)}; write ${JSON.stringify(`${text.slice(t.at, next.at).trim()}*${next.text}`)} to multiply`, next.at);
    return node;
  };
  const call = (name) => {
    const open = tokens[i++];
    const args = [];
    if (!isOp(')')) {
      args.push(additive());
      while (isOp(',')) {
        i++;
        args.push(additive());
      }
    }
    expect(')', open);
    if (name.text === 'sum') {
      if (args.length !== 4) throw new ParseError(`sum takes 4 arguments, (index, from, to, term), as in sum(k, 1, n, sin(k*x)/k); found ${args.length}`, name.at);
      if (args[0].kind !== 'name') throw new ParseError('sum\'s first argument is the name of its index, such as k', args[0].at);
      if (RESERVED_NAMES.includes(args[0].name)) throw new ParseError(`"${args[0].name}" cannot be sum's index, since it already means something; use a name such as k`, args[0].at);
      return { kind: 'sum', index: args[0].name, from: args[1], to: args[2], term: args[3], at: name.at };
    }
    const fn = own(FUNCTIONS, name.text) ? FUNCTIONS[name.text] : null;
    if (!fn) throw new ParseError(`"${name.text}" is no function; the functions are ${FUNCTION_NAMES.join(', ')}`, name.at);
    const [min, max] = fn;
    if (args.length < min || args.length > max) throw new ParseError(`${name.text} takes ${min === max ? min : `at least ${min}`} argument${min === 1 && max === 1 ? '' : 's'}, found ${args.length}`, name.at);
    return { kind: 'call', fn: name.text, args, at: name.at };
  };

  try {
    const ast = additive();
    if (peek()) throw new ParseError(`unexpected ${describe(peek())}`, peek().at);
    return { ast };
  } catch (err) {
    if (err instanceof ParseError) return { error: { message: err.message, at: err.at } };
    throw err;
  }
}

/** Names the expression reads that it does not define itself (constants, and a sum's index inside its term), with where each first appears. */
export function freeNames(ast) {
  const out = new Map();
  const walk = (node, bound) => {
    switch (node.kind) {
      case 'name':
        if (!bound.has(node.name) && !own(CONSTANTS, node.name) && !out.has(node.name)) out.set(node.name, node.at);
        return;
      case 'bin':
        walk(node.left, bound);
        return walk(node.right, bound);
      case 'neg':
        return walk(node.arg, bound);
      case 'call':
        return node.args.forEach((a) => walk(a, bound));
      case 'sum':
        walk(node.from, bound);
        walk(node.to, bound);
        return walk(node.term, new Set([...bound, node.index]));
    }
  };
  walk(ast, new Set());
  return [...out].map(([name, at]) => ({ name, at }));
}

/**
 * The expression as a function of its names' values. A sum whose upper bound is not whole adds its last term in part,
 * so a bound tweened from 1 to 3 grows the sum smoothly; past MAX_TERMS terms it has no value (NaN).
 * @returns {(scope: Record<string, number>) => number}
 */
export function compileExpr(ast) {
  switch (ast.kind) {
    case 'num':
      return () => ast.value;
    case 'name':
      if (own(CONSTANTS, ast.name)) return () => CONSTANTS[ast.name];
      return (scope) => (own(scope, ast.name) && typeof scope[ast.name] === 'number' ? scope[ast.name] : NaN);
    case 'neg': {
      const arg = compileExpr(ast.arg);
      return (scope) => -arg(scope);
    }
    case 'bin': {
      const [a, b] = [compileExpr(ast.left), compileExpr(ast.right)];
      switch (ast.op) {
        case '+':
          return (s) => a(s) + b(s);
        case '-':
          return (s) => a(s) - b(s);
        case '*':
          return (s) => a(s) * b(s);
        case '/':
          return (s) => a(s) / b(s);
        default:
          return (s) => a(s) ** b(s);
      }
    }
    case 'call': {
      const fn = FUNCTIONS[ast.fn][2];
      const args = ast.args.map(compileExpr);
      if (args.length === 1) return (s) => fn(args[0](s));
      return (s) => fn(...args.map((arg) => arg(s)));
    }
    case 'sum': {
      const [from, to, term] = [compileExpr(ast.from), compileExpr(ast.to), compileExpr(ast.term)];
      return (scope) => {
        const [a, b] = [Math.ceil(from(scope)), to(scope)];
        if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
        const last = Math.ceil(b);
        if (last - a + 1 > MAX_TERMS) return NaN;
        const inner = { ...scope };
        let total = 0;
        for (let k = a; k <= last; k++) {
          inner[ast.index] = k;
          const weight = Math.min(1, b - k + 1);
          if (weight > 0) total += weight * term(inner);
        }
        return total;
      };
    }
  }
  throw new Error(`unknown expression node ${ast.kind}`);
}

const compiled = new Map();
/**
 * An expression's tree, the names it reads and its function, parsed once per text; or its parse error.
 * @returns {import('./expr').CompiledExpr}
 */
export function exprOf(text) {
  const key = String(text);
  let hit = compiled.get(key);
  if (!hit) {
    const parsed = parseExpr(key);
    hit = parsed.error ? { error: parsed.error, names: [], fn: () => NaN } : { error: null, names: freeNames(parsed.ast), fn: compileExpr(parsed.ast) };
    compiled.set(key, hit);
  }
  return hit;
}
