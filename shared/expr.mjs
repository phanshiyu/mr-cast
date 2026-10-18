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
const FUNCTION_NAMES = [...Object.keys(FUNCTIONS), 'sum'];
/**
 * The most terms one sum adds; past it the sum has no value. Sums whose bounds are numbers, nested ones multiplied,
 * may add no more at one point, or the expression does not parse.
 */
const MAX_TERMS = 10000;
/** The most terms one evaluation adds across all its sums, nested ones included; past it the value is NaN. */
export const MAX_EVAL_TERMS = 100000;
/** How deep parentheses, minus signs, powers and calls may nest. */
const MAX_DEPTH = 200;

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
  // Every nesting (parentheses, a call's arguments, a minus sign, a power's exponent) passes through unary, so its
  // depth bounds the parser's recursion and every walk of the tree below.
  let depth = 0;
  // Unary minus binds looser than ^, so -x^2 is -(x^2), and a power's exponent may be negative: 2^-x.
  const unary = () => {
    if (depth >= MAX_DEPTH) throw new ParseError(`nests more than ${MAX_DEPTH} levels deep in parentheses, minus signs, powers or calls; write it more simply`, peek()?.at ?? end);
    depth++;
    try {
      if (isOp('-') || isOp('+')) {
        const op = tokens[i++];
        const arg = unary();
        return op.text === '-' ? { kind: 'neg', arg, at: op.at } : arg;
      }
      return power();
    } finally {
      depth--;
    }
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
    checkSumSizes(ast);
    return { ast };
  } catch (err) {
    if (err instanceof ParseError) return { error: { message: err.message, at: err.at } };
    throw err;
  }
}

/** A node's children, each with the names bound inside it: a sum's index is bound in its term. */
function children(node, bound) {
  switch (node.kind) {
    case 'bin':
      return [[node.left, bound], [node.right, bound]];
    case 'neg':
      return [[node.arg, bound]];
    case 'call':
      return node.args.map((a) => [a, bound]);
    case 'sum':
      return [[node.from, bound], [node.to, bound], [node.term, new Set([...bound, node.index])]];
    default:
      return [];
  }
}

/** Names the expression reads that it does not define itself (constants, and a sum's index inside its term), with where each first appears. */
export function freeNames(ast) {
  const found = [];
  const stack = [[ast, new Set()]];
  while (stack.length) {
    const [node, bound] = stack.pop();
    if (node.kind === 'name' && !bound.has(node.name) && !own(CONSTANTS, node.name)) found.push({ name: node.name, at: node.at });
    const next = children(node, bound);
    for (let k = next.length - 1; k >= 0; k--) stack.push(next[k]);
  }
  const out = new Map();
  for (const { name, at } of found) if (!out.has(name)) out.set(name, at);
  return [...out].map(([name, at]) => ({ name, at }));
}

/** How many terms a sum adds when its bounds are numbers, as a parse would see them; null when they read names. */
function staticTerms(node) {
  if (freeNames(node.from).length || freeNames(node.to).length) return null;
  const [a, b] = [Math.ceil(compileExpr(node.from)({})), Math.ceil(compileExpr(node.to)({}))];
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, b - a + 1) : null;
}

/** Throws when sums whose bounds are numbers, nested inside each other, would add more than MAX_TERMS terms at one point. */
function checkSumSizes(ast) {
  const stack = [[ast, 1, []]];
  while (stack.length) {
    const [node, product, counts] = stack.pop();
    let [inner, path] = [product, counts];
    if (node.kind === 'sum') {
      const n = staticTerms(node);
      if (n !== null) {
        [inner, path] = [product * n, [...counts, n]];
        if (inner > MAX_TERMS) {
          const many = path.length > 1 ? `these nested sums add ${path.join(' × ')} = ${inner} terms` : `this sum adds ${inner} terms`;
          throw new ParseError(`${many} at every point; at most ${MAX_TERMS} in all, so use fewer terms`, node.at);
        }
      }
      stack.push([node.from, product, counts], [node.to, product, counts], [node.term, inner, path]);
      continue;
    }
    for (const [child] of children(node, null)) stack.push([child, product, counts]);
  }
}

/**
 * A left-leaning run of one precedence, a + b - c or a * b / c, as its first operand and the [op, operand] pairs
 * after it, so a long chain is computed in a loop rather than one nested call per operator.
 */
function chainOf(node, ops) {
  const rest = [];
  let first = node;
  while (first.kind === 'bin' && ops.includes(first.op)) {
    rest.push([first.op, first.right]);
    first = first.left;
  }
  return { first, rest: rest.reverse() };
}

const APPLY = { '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b, '^': (a, b) => a ** b };

/**
 * The tree as a function of a scope and the evaluation's term budget, `{ left, spent }`, which every sum draws from,
 * nested ones included.
 */
function build(ast) {
  switch (ast.kind) {
    case 'num':
      return () => ast.value;
    case 'name':
      if (own(CONSTANTS, ast.name)) return () => CONSTANTS[ast.name];
      return (scope) => (own(scope, ast.name) && typeof scope[ast.name] === 'number' ? scope[ast.name] : NaN);
    case 'neg': {
      const arg = build(ast.arg);
      return (scope, budget) => -arg(scope, budget);
    }
    case 'bin': {
      if (ast.op === '^') {
        const [a, b] = [build(ast.left), build(ast.right)];
        return (s, budget) => a(s, budget) ** b(s, budget);
      }
      const { first, rest } = chainOf(ast, ast.op === '+' || ast.op === '-' ? ['+', '-'] : ['*', '/']);
      const head = build(first);
      const tail = rest.map(([op, node]) => [APPLY[op], build(node)]);
      if (tail.length === 1) {
        const [[apply, b]] = tail;
        return (s, budget) => apply(head(s, budget), b(s, budget));
      }
      return (s, budget) => {
        let value = head(s, budget);
        for (const [apply, b] of tail) value = apply(value, b(s, budget));
        return value;
      };
    }
    case 'call': {
      const fn = FUNCTIONS[ast.fn][2];
      const args = ast.args.map(build);
      if (args.length === 1) return (s, budget) => fn(args[0](s, budget));
      // Pairwise, so min or max of a long list never spreads it into one call's arguments.
      if (FUNCTIONS[ast.fn][1] === Infinity) return (s, budget) => args.reduce((acc, arg) => fn(acc, arg(s, budget)), fn(args[0](s, budget)));
      return (s, budget) => fn(...args.map((arg) => arg(s, budget)));
    }
    case 'sum': {
      const [from, to, term] = [build(ast.from), build(ast.to), build(ast.term)];
      return (scope, budget) => {
        const [a, b] = [Math.ceil(from(scope, budget)), to(scope, budget)];
        if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
        const last = Math.ceil(b);
        const count = Math.max(0, last - a + 1);
        if (count > MAX_TERMS) return NaN;
        if (count > budget.left) {
          budget.left = 0;
          budget.spent = true;
          return NaN;
        }
        budget.left -= count;
        const inner = { ...scope };
        let total = 0;
        for (let k = a; k <= last; k++) {
          inner[ast.index] = k;
          const weight = Math.min(1, b - k + 1);
          if (weight > 0) total += weight * term(inner, budget);
        }
        return total;
      };
    }
  }
  throw new Error(`unknown expression node ${ast.kind}`);
}

/**
 * The expression's value in a scope, and whether its sums ran out of the evaluation's MAX_EVAL_TERMS terms, which
 * leaves the value NaN.
 * @returns {(scope: Record<string, number>) => { value: number, overBudget: boolean }}
 */
function evaluatorOf(ast) {
  const run = build(ast);
  return (scope) => {
    const budget = { left: MAX_EVAL_TERMS, spent: false };
    const value = run(scope, budget);
    return { value: budget.spent ? NaN : value, overBudget: budget.spent };
  };
}

/**
 * The expression as a function of its names' values. A sum whose upper bound is not whole adds its last term in part,
 * so a bound tweened from 1 to 3 grows the sum smoothly; past MAX_TERMS terms it has no value (NaN), and so has the
 * whole expression once its sums add more than MAX_EVAL_TERMS in one evaluation.
 * @returns {(scope: Record<string, number>) => number}
 */
export function compileExpr(ast) {
  const evaluate = evaluatorOf(ast);
  return (scope) => evaluate(scope).value;
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
    if (parsed.error) hit = { error: parsed.error, names: [], fn: () => NaN, evaluate: () => ({ value: NaN, overBudget: false }) };
    else {
      const evaluate = evaluatorOf(parsed.ast);
      hit = { error: null, names: freeNames(parsed.ast), fn: (scope) => evaluate(scope).value, evaluate };
    }
    compiled.set(key, hit);
  }
  return hit;
}
