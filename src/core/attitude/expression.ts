/**
 * Tiny safe expression evaluator for the custom-equation attitude rule.
 *
 * Deliberately NOT `eval` / `new Function`: those would execute arbitrary code
 * from a text field, and configurations are shareable as JSON, so a pasted
 * config could run anything. This is a hand-written recursive-descent parser
 * over a fixed grammar with a whitelist of variables and functions.
 *
 * Grammar (highest precedence last):
 *
 *   expr    := term (('+' | '-') term)*
 *   term    := unary (('*' | '/' | '%') unary)*
 *   unary   := ('+' | '-') unary | power
 *   power   := primary ('^' unary)?          right-associative
 *   primary := number | ident | ident '(' args ')' | '(' expr ')'
 *
 * The expression is compiled ONCE into a closure tree, so evaluating it inside
 * the integrator costs no parsing.
 */

export type VariableBag = Record<string, number>;

type Node = (vars: VariableBag) => number;

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
  tau: 2 * Math.PI,
};

/** Whitelisted functions, by arity. */
const FUNCTIONS_1: Record<string, (x: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  exp: Math.exp,
  log: Math.log,
  log10: Math.log10,
  sqrt: Math.sqrt,
  abs: Math.abs,
  sign: Math.sign,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  deg: (x) => (x * 180) / Math.PI,
  rad: (x) => (x * Math.PI) / 180,
};

const FUNCTIONS_2: Record<string, (a: number, b: number) => number> = {
  atan2: Math.atan2,
  pow: Math.pow,
  min: Math.min,
  max: Math.max,
  mod: (a, b) => (b === 0 ? NaN : a - b * Math.floor(a / b)),
};

const FUNCTIONS_3: Record<string, (a: number, b: number, c: number) => number> = {
  /** clamp(x, lo, hi) */
  clamp: (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x),
  /** if(cond, thenValue, elseValue) - cond > 0 counts as true */
  if: (c, a, b) => (c > 0 ? a : b),
};

export const EXPRESSION_FUNCTIONS = [
  ...Object.keys(FUNCTIONS_1),
  ...Object.keys(FUNCTIONS_2).map((f) => `${f}(a, b)`),
  ...Object.keys(FUNCTIONS_3).map((f) => `${f}(a, b, c)`),
];

export const EXPRESSION_CONSTANTS = Object.keys(CONSTANTS);

// ---------------------------------------------------------------------------
// Tokeniser
// ---------------------------------------------------------------------------

type Token =
  | { type: 'num'; value: number }
  | { type: 'ident'; value: string }
  | { type: 'op'; value: string };

function tokenise(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const start = i;
      while (i < src.length && /[0-9.]/.test(src[i])) i++;
      // Exponent notation: 1e-3, 2.5E+4
      if (i < src.length && /[eE]/.test(src[i])) {
        const save = i;
        i++;
        if (i < src.length && /[+-]/.test(src[i])) i++;
        if (i < src.length && /[0-9]/.test(src[i])) {
          while (i < src.length && /[0-9]/.test(src[i])) i++;
        } else {
          i = save; // not an exponent after all
        }
      }
      const text = src.slice(start, i);
      const value = Number(text);
      if (!Number.isFinite(value)) throw new Error(`Invalid number "${text}"`);
      tokens.push({ type: 'num', value });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) i++;
      tokens.push({ type: 'ident', value: src.slice(start, i) });
      continue;
    }
    if ('+-*/%^(),'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }
    throw new Error(`Unexpected character "${ch}" at position ${i}`);
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class Parser {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly allowedVars: readonly string[],
  ) {}

  parse(): Node {
    const node = this.parseExpr();
    if (this.pos < this.tokens.length) {
      throw new Error(`Unexpected trailing input near token ${this.pos + 1}`);
    }
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private eatOp(value: string): boolean {
    const t = this.peek();
    if (t && t.type === 'op' && t.value === value) {
      this.pos++;
      return true;
    }
    return false;
  }

  private expectOp(value: string): void {
    if (!this.eatOp(value)) throw new Error(`Expected "${value}"`);
  }

  private parseExpr(): Node {
    let left = this.parseTerm();
    for (;;) {
      if (this.eatOp('+')) {
        const right = this.parseTerm();
        const l = left;
        left = (v) => l(v) + right(v);
      } else if (this.eatOp('-')) {
        const right = this.parseTerm();
        const l = left;
        left = (v) => l(v) - right(v);
      } else return left;
    }
  }

  private parseTerm(): Node {
    let left = this.parseUnary();
    for (;;) {
      if (this.eatOp('*')) {
        const right = this.parseUnary();
        const l = left;
        left = (v) => l(v) * right(v);
      } else if (this.eatOp('/')) {
        const right = this.parseUnary();
        const l = left;
        left = (v) => l(v) / right(v);
      } else if (this.eatOp('%')) {
        const right = this.parseUnary();
        const l = left;
        left = (v) => l(v) % right(v);
      } else return left;
    }
  }

  private parseUnary(): Node {
    if (this.eatOp('-')) {
      const inner = this.parseUnary();
      return (v) => -inner(v);
    }
    if (this.eatOp('+')) return this.parseUnary();
    return this.parsePower();
  }

  private parsePower(): Node {
    const base = this.parsePrimary();
    if (this.eatOp('^')) {
      const exp = this.parseUnary(); // right-associative
      return (v) => base(v) ** exp(v);
    }
    return base;
  }

  private parsePrimary(): Node {
    const t = this.peek();
    if (!t) throw new Error('Unexpected end of expression');

    if (t.type === 'num') {
      this.pos++;
      const value = t.value;
      return () => value;
    }

    if (t.type === 'op' && t.value === '(') {
      this.pos++;
      const inner = this.parseExpr();
      this.expectOp(')');
      return inner;
    }

    if (t.type === 'ident') {
      this.pos++;
      const name = t.value;

      // Function call?
      if (this.eatOp('(')) {
        const args: Node[] = [];
        if (!this.eatOp(')')) {
          for (;;) {
            args.push(this.parseExpr());
            if (this.eatOp(',')) continue;
            this.expectOp(')');
            break;
          }
        }
        const f1 = FUNCTIONS_1[name];
        if (f1) {
          if (args.length !== 1) throw new Error(`${name}() takes 1 argument`);
          const [a] = args;
          return (v) => f1(a(v));
        }
        const f2 = FUNCTIONS_2[name];
        if (f2) {
          if (args.length !== 2) throw new Error(`${name}() takes 2 arguments`);
          const [a, b] = args;
          return (v) => f2(a(v), b(v));
        }
        const f3 = FUNCTIONS_3[name];
        if (f3) {
          if (args.length !== 3) throw new Error(`${name}() takes 3 arguments`);
          const [a, b, c] = args;
          return (v) => f3(a(v), b(v), c(v));
        }
        throw new Error(`Unknown function "${name}"`);
      }

      if (name in CONSTANTS) {
        const value = CONSTANTS[name];
        return () => value;
      }
      if (this.allowedVars.includes(name)) {
        return (v) => {
          const x = v[name];
          return x === undefined ? 0 : x;
        };
      }
      throw new Error(`Unknown name "${name}"`);
    }

    throw new Error('Unexpected token in expression');
  }
}

export interface CompiledExpression {
  /** Evaluate against a variable bag. Never throws; returns 0 on non-finite. */
  evaluate(vars: VariableBag): number;
  /** The source text. */
  source: string;
}

/**
 * Compile an expression. Throws a descriptive Error for invalid input so the
 * UI can show it next to the field.
 */
export function compileExpression(
  source: string,
  allowedVars: readonly string[],
): CompiledExpression {
  const trimmed = source.trim();
  if (trimmed === '') throw new Error('Expression is empty');
  if (trimmed.length > 500) throw new Error('Expression is too long (max 500 characters)');

  const node = new Parser(tokenise(trimmed), allowedVars).parse();

  return {
    source: trimmed,
    evaluate(vars: VariableBag): number {
      const x = node(vars);
      return Number.isFinite(x) ? x : 0;
    },
  };
}

/** Validate without keeping the compiled result. Returns null when valid. */
export function validateExpression(
  source: string,
  allowedVars: readonly string[],
): string | null {
  try {
    const compiled = compileExpression(source, allowedVars);
    // Smoke-test with all variables at zero to catch obvious arity issues.
    const zeros: VariableBag = {};
    for (const name of allowedVars) zeros[name] = 0;
    compiled.evaluate(zeros);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
