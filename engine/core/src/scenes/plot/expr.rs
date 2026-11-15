//! The plot scene's small arithmetic language: a port of shared/expr.mjs. An expression that does not parse
//! has no value (NaN), as the JS's `fn` of a parse error does.

const MAX_TERMS: f64 = 10000.0;
const MAX_EVAL_TERMS: f64 = 100000.0;
const MAX_DEPTH: usize = 200;

#[derive(Clone, Copy, PartialEq)]
enum F {
    Sin,
    Cos,
    Tan,
    Asin,
    Acos,
    Atan,
    Exp,
    Log,
    Log10,
    Sqrt,
    Abs,
    Sign,
    Floor,
    Ceil,
    Round,
    Mod,
    Min,
    Max,
}

fn function(name: &str) -> Option<(F, usize, usize)> {
    let one = |f| Some((f, 1, 1));
    match name {
        "sin" => one(F::Sin),
        "cos" => one(F::Cos),
        "tan" => one(F::Tan),
        "asin" => one(F::Asin),
        "acos" => one(F::Acos),
        "atan" => one(F::Atan),
        "exp" => one(F::Exp),
        "log" | "ln" => one(F::Log),
        "log10" => one(F::Log10),
        "sqrt" => one(F::Sqrt),
        "abs" => one(F::Abs),
        "sign" => one(F::Sign),
        "floor" => one(F::Floor),
        "ceil" => one(F::Ceil),
        "round" => one(F::Round),
        "mod" => Some((F::Mod, 2, 2)),
        "min" => Some((F::Min, 1, usize::MAX)),
        "max" => Some((F::Max, 1, usize::MAX)),
        _ => None,
    }
}

const RESERVED: [&str; 22] = [
    "sin", "cos", "tan", "asin", "acos", "atan", "exp", "log", "ln", "log10", "sqrt", "abs", "sign", "floor", "ceil",
    "round", "mod", "min", "max", "sum", "pi", "e",
];

fn constant(name: &str) -> Option<f64> {
    match name {
        "pi" => Some(std::f64::consts::PI),
        "e" => Some(std::f64::consts::E),
        _ => None,
    }
}

/// `Math.round`.
fn js_round(x: f64) -> f64 {
    let r = x.floor();
    if x - r >= 0.5 { r + 1.0 } else { r }
}

fn js_sign(x: f64) -> f64 {
    if x.is_nan() || x == 0.0 { x } else { x.signum() }
}

/// `a ** b` as JS has it.
fn js_pow(a: f64, b: f64) -> f64 {
    if b.is_nan() || (a.abs() == 1.0 && b.is_infinite()) {
        return f64::NAN;
    }
    a.powf(b)
}

fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { f64::NAN } else { a.min(b) }
}

fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { f64::NAN } else { a.max(b) }
}

fn apply1(f: F, a: f64) -> f64 {
    match f {
        F::Sin => a.sin(),
        F::Cos => a.cos(),
        F::Tan => a.tan(),
        F::Asin => a.asin(),
        F::Acos => a.acos(),
        F::Atan => a.atan(),
        F::Exp => a.exp(),
        F::Log => a.ln(),
        F::Log10 => a.log10(),
        F::Sqrt => a.sqrt(),
        F::Abs => a.abs(),
        F::Sign => js_sign(a),
        F::Floor => a.floor(),
        F::Ceil => a.ceil(),
        F::Round => js_round(a),
        F::Min | F::Max => a,
        F::Mod => f64::NAN,
    }
}

#[derive(Clone, Debug)]
enum Node {
    Num(f64),
    Name(String),
    Neg(Box<Node>),
    Bin(char, Box<Node>, Box<Node>),
    Call(usize, Vec<Node>),
    Sum { index: String, from: Box<Node>, to: Box<Node>, term: Box<Node> },
}

impl std::fmt::Debug for F {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "fn")
    }
}

const FN_TABLE: [(&str, F); 19] = [
    ("sin", F::Sin),
    ("cos", F::Cos),
    ("tan", F::Tan),
    ("asin", F::Asin),
    ("acos", F::Acos),
    ("atan", F::Atan),
    ("exp", F::Exp),
    ("log", F::Log),
    ("ln", F::Log),
    ("log10", F::Log10),
    ("sqrt", F::Sqrt),
    ("abs", F::Abs),
    ("sign", F::Sign),
    ("floor", F::Floor),
    ("ceil", F::Ceil),
    ("round", F::Round),
    ("mod", F::Mod),
    ("min", F::Min),
    ("max", F::Max),
];

#[derive(Clone, Debug, PartialEq)]
enum Tok {
    Num(f64),
    Name(String),
    Op(char),
}

fn tokenize(text: &str) -> Option<Vec<Tok>> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        let starts_num = c.is_ascii_digit() || (c == '.' && chars.get(i + 1).is_some_and(|d| d.is_ascii_digit()));
        if starts_num {
            let mut j = i;
            while j < chars.len() && chars[j].is_ascii_digit() {
                j += 1;
            }
            if j < chars.len() && chars[j] == '.' {
                j += 1;
                while j < chars.len() && chars[j].is_ascii_digit() {
                    j += 1;
                }
            }
            if j < chars.len() && (chars[j] == 'e' || chars[j] == 'E') {
                let mut k = j + 1;
                if k < chars.len() && (chars[k] == '+' || chars[k] == '-') {
                    k += 1;
                }
                if k < chars.len() && chars[k].is_ascii_digit() {
                    while k < chars.len() && chars[k].is_ascii_digit() {
                        k += 1;
                    }
                    j = k;
                }
            }
            let s: String = chars[i..j].iter().collect();
            out.push(Tok::Num(s.parse().ok()?));
            i = j;
            continue;
        }
        if c.is_ascii_alphabetic() || c == '_' {
            let mut j = i;
            while j < chars.len() && (chars[j].is_ascii_alphanumeric() || chars[j] == '_') {
                j += 1;
            }
            out.push(Tok::Name(chars[i..j].iter().collect()));
            i = j;
            continue;
        }
        match c {
            'π' => out.push(Tok::Name("pi".into())),
            '−' => out.push(Tok::Op('-')),
            '×' | '·' => out.push(Tok::Op('*')),
            '*' if chars.get(i + 1) == Some(&'*') => return None,
            '+' | '-' | '*' | '/' | '^' | '(' | ')' | ',' => out.push(Tok::Op(c)),
            _ => return None,
        }
        i += 1;
    }
    Some(out)
}

struct Parser {
    toks: Vec<Tok>,
    i: usize,
    depth: usize,
}

type P<T> = Option<T>;

impl Parser {
    fn is_op(&self, op: char) -> bool {
        self.toks.get(self.i) == Some(&Tok::Op(op))
    }
    fn expect(&mut self, op: char) -> P<()> {
        if self.is_op(op) {
            self.i += 1;
            Some(())
        } else {
            None
        }
    }
    fn additive(&mut self) -> P<Node> {
        let mut left = self.multiplicative()?;
        while self.is_op('+') || self.is_op('-') {
            let Tok::Op(op) = self.toks[self.i].clone() else { return None };
            self.i += 1;
            left = Node::Bin(op, Box::new(left), Box::new(self.multiplicative()?));
        }
        Some(left)
    }
    fn multiplicative(&mut self) -> P<Node> {
        let mut left = self.unary()?;
        while self.is_op('*') || self.is_op('/') {
            let Tok::Op(op) = self.toks[self.i].clone() else { return None };
            self.i += 1;
            left = Node::Bin(op, Box::new(left), Box::new(self.unary()?));
        }
        Some(left)
    }
    fn unary(&mut self) -> P<Node> {
        if self.depth >= MAX_DEPTH {
            return None;
        }
        self.depth += 1;
        let r = (|| {
            if self.is_op('-') || self.is_op('+') {
                let minus = self.is_op('-');
                self.i += 1;
                let arg = self.unary()?;
                return Some(if minus { Node::Neg(Box::new(arg)) } else { arg });
            }
            self.power()
        })();
        self.depth -= 1;
        r
    }
    fn power(&mut self) -> P<Node> {
        let base = self.primary()?;
        if !self.is_op('^') {
            return Some(base);
        }
        self.i += 1;
        Some(Node::Bin('^', Box::new(base), Box::new(self.unary()?)))
    }
    fn primary(&mut self) -> P<Node> {
        let t = self.toks.get(self.i)?.clone();
        let node = match t {
            Tok::Num(v) => {
                self.i += 1;
                Node::Num(v)
            }
            Tok::Name(name) => {
                self.i += 1;
                if self.is_op('(') { self.call(name)? } else { Node::Name(name) }
            }
            Tok::Op('(') => {
                self.i += 1;
                let n = self.additive()?;
                self.expect(')')?;
                n
            }
            Tok::Op(_) => return None,
        };
        match self.toks.get(self.i) {
            Some(Tok::Op('(')) | Some(Tok::Num(_)) | Some(Tok::Name(_)) => None,
            _ => Some(node),
        }
    }
    fn call(&mut self, name: String) -> P<Node> {
        self.i += 1;
        let mut args = Vec::new();
        if !self.is_op(')') {
            args.push(self.additive()?);
            while self.is_op(',') {
                self.i += 1;
                args.push(self.additive()?);
            }
        }
        self.expect(')')?;
        if name == "sum" {
            if args.len() != 4 {
                return None;
            }
            let mut it = args.into_iter();
            let index = match it.next()? {
                Node::Name(n) if !RESERVED.contains(&n.as_str()) => n,
                _ => return None,
            };
            let (from, to, term) = (it.next()?, it.next()?, it.next()?);
            return Some(Node::Sum { index, from: Box::new(from), to: Box::new(to), term: Box::new(term) });
        }
        let (_, min, max) = function(&name)?;
        if args.len() < min || args.len() > max {
            return None;
        }
        let at = FN_TABLE.iter().position(|(n, _)| *n == name)?;
        Some(Node::Call(at, args))
    }
}

/// Names the expression reads that it does not define itself, in order of first appearance.
fn free_names(node: &Node, bound: &mut Vec<String>, out: &mut Vec<String>) {
    match node {
        Node::Name(n) => {
            if !bound.contains(n) && constant(n).is_none() && !out.contains(n) {
                out.push(n.clone());
            }
        }
        Node::Neg(a) => free_names(a, bound, out),
        Node::Bin(_, a, b) => {
            free_names(a, bound, out);
            free_names(b, bound, out);
        }
        Node::Call(_, args) => args.iter().for_each(|a| free_names(a, bound, out)),
        Node::Sum { index, from, to, term } => {
            free_names(from, bound, out);
            free_names(to, bound, out);
            bound.push(index.clone());
            free_names(term, bound, out);
            bound.pop();
        }
        Node::Num(_) => {}
    }
}

/// Terms a sum adds when its bounds are numbers; None when they read names.
fn static_terms(from: &Node, to: &Node) -> Option<f64> {
    let (mut a, mut b) = (Vec::new(), Vec::new());
    free_names(from, &mut Vec::new(), &mut a);
    free_names(to, &mut Vec::new(), &mut b);
    if !a.is_empty() || !b.is_empty() {
        return None;
    }
    let (a, b) = (run(from, &mut Scope::new()).ceil(), run(to, &mut Scope::new()).ceil());
    (a.is_finite() && b.is_finite()).then(|| (b - a + 1.0).max(0.0))
}

fn run(node: &Node, scope: &mut Scope) -> f64 {
    let mut budget = Budget { left: MAX_EVAL_TERMS, spent: false };
    eval(node, scope, &mut budget)
}

/// False when sums whose bounds are numbers, nested, would add more than MAX_TERMS terms at one point.
fn sum_sizes_ok(node: &Node, product: f64) -> bool {
    match node {
        Node::Sum { from, to, term, .. } => {
            let inner = match static_terms(from, to) {
                Some(n) => product * n,
                None => product,
            };
            if inner > MAX_TERMS {
                return false;
            }
            sum_sizes_ok(from, product) && sum_sizes_ok(to, product) && sum_sizes_ok(term, inner)
        }
        Node::Neg(a) => sum_sizes_ok(a, product),
        Node::Bin(_, a, b) => sum_sizes_ok(a, product) && sum_sizes_ok(b, product),
        Node::Call(_, args) => args.iter().all(|a| sum_sizes_ok(a, product)),
        _ => true,
    }
}

/// Names bound to numbers; the latest binding of a name wins.
#[derive(Clone, Default)]
pub struct Scope(pub Vec<(String, f64)>);

impl Scope {
    pub fn new() -> Scope {
        Scope(Vec::new())
    }
    pub fn get(&self, name: &str) -> Option<f64> {
        self.0.iter().rev().find(|(n, _)| n == name).map(|(_, v)| *v)
    }
    pub fn with(&self, name: &str, v: f64) -> Scope {
        let mut s = self.clone();
        s.0.push((name.to_string(), v));
        s
    }
    /// Sets the last binding (made by `with`).
    pub fn set_last(&mut self, v: f64) {
        if let Some(l) = self.0.last_mut() {
            l.1 = v;
        }
    }
}

struct Budget {
    left: f64,
    spent: bool,
}

fn eval(node: &Node, scope: &mut Scope, budget: &mut Budget) -> f64 {
    match node {
        Node::Num(v) => *v,
        Node::Name(n) => constant(n).or_else(|| scope.get(n)).unwrap_or(f64::NAN),
        Node::Neg(a) => -eval(a, scope, budget),
        Node::Bin(op, a, b) => {
            let (x, y) = (eval(a, scope, budget), eval(b, scope, budget));
            match op {
                '+' => x + y,
                '-' => x - y,
                '*' => x * y,
                '/' => x / y,
                _ => js_pow(x, y),
            }
        }
        Node::Call(f, args) => {
            let (_, which) = (0, FN_TABLE[*f].1);
            if args.len() == 1 {
                return apply1(which, eval(&args[0], scope, budget));
            }
            match which {
                F::Min | F::Max => {
                    let mut acc = apply1(which, eval(&args[0], scope, budget));
                    for a in &args[1..] {
                        let v = eval(a, scope, budget);
                        acc = if which == F::Min { js_min(acc, v) } else { js_max(acc, v) };
                    }
                    acc
                }
                _ => {
                    let (a, b) = (eval(&args[0], scope, budget), eval(&args[1], scope, budget));
                    a - b * (a / b).floor()
                }
            }
        }
        Node::Sum { index, from, to, term } => {
            let a = eval(from, scope, budget).ceil();
            let b = eval(to, scope, budget);
            if !a.is_finite() || !b.is_finite() {
                return f64::NAN;
            }
            let last = b.ceil();
            let count = (last - a + 1.0).max(0.0);
            if count > MAX_TERMS {
                return f64::NAN;
            }
            if count > budget.left {
                budget.left = 0.0;
                budget.spent = true;
                return f64::NAN;
            }
            budget.left -= count;
            scope.0.push((index.clone(), 0.0));
            let mut total = 0.0;
            let mut k = a;
            while k <= last {
                scope.set_last(k);
                let weight = (b - k + 1.0).min(1.0);
                if weight > 0.0 {
                    total += weight * eval(term, scope, budget);
                }
                k += 1.0;
            }
            scope.0.pop();
            total
        }
    }
}

/// A parsed expression: its function of a scope and the names it reads.
#[derive(Debug)]
pub struct Expr {
    ast: Option<Node>,
    pub names: Vec<String>,
}

impl Expr {
    pub fn parse(text: &str) -> Expr {
        let parsed = (|| {
            if text.trim().is_empty() {
                return None;
            }
            let mut p = Parser { toks: tokenize(text)?, i: 0, depth: 0 };
            let ast = p.additive()?;
            if p.i < p.toks.len() || !sum_sizes_ok(&ast, 1.0) {
                return None;
            }
            Some(ast)
        })();
        let mut names = Vec::new();
        if let Some(a) = &parsed {
            free_names(a, &mut Vec::new(), &mut names);
        }
        Expr { ast: parsed, names }
    }

    /// The value in a scope; NaN for a parse error, or when its sums run out of their term budget.
    pub fn eval(&self, scope: &mut Scope) -> f64 {
        let Some(ast) = &self.ast else { return f64::NAN };
        let mut budget = Budget { left: MAX_EVAL_TERMS, spent: false };
        let v = eval(ast, scope, &mut budget);
        if budget.spent { f64::NAN } else { v }
    }
}
