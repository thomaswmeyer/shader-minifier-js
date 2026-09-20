// --fold-builtins: evaluate pure builtin calls whose arguments are all literals.
// Upstream folds operators only. Results are computed at float32 precision, like the GPU would,
// and printed with the shortest digits that round-trip through float32; a fold is only applied
// when it makes the expression shorter (upstream's rule for constant division).
import { Float, FunCall, Ident, Int, Var, type Expr } from "./ast.js";
import * as Printer from "./printer.js";

interface Lit { comps: number[]; isInt: boolean; isVector: boolean }

type Impl = (a: number[]) => number;
// `undefined` names the inputs GLSL leaves undefined or implementation-defined, which are not folded.
interface Spec { arity: number[]; fn: Impl; intOk?: boolean; undefined?: (a: number[]) => boolean }

const cw = (arity: number[], fn: Impl, intOk = false, undef?: (a: number[]) => boolean): Spec => ({ arity, fn, intOk, undefined: undef });
const clamp = (x: number, lo: number, hi: number): number => Math.min(Math.max(x, lo), hi);

// Component-wise functions (scalars broadcast to the widest argument, as GLSL allows).
const componentwise: Record<string, Spec> = {
  radians: cw([1], ([x]) => (x * Math.PI) / 180),
  degrees: cw([1], ([x]) => (x * 180) / Math.PI),
  sin: cw([1], ([x]) => Math.sin(x)), cos: cw([1], ([x]) => Math.cos(x)), tan: cw([1], ([x]) => Math.tan(x)),
  asin: cw([1], ([x]) => Math.asin(x)), acos: cw([1], ([x]) => Math.acos(x)),
  atan: cw([1, 2], (a) => (a.length === 1 ? Math.atan(a[0]) : Math.atan2(a[0], a[1])), false, (a) => a.length === 2 && a[0] === 0 && a[1] === 0),
  sinh: cw([1], ([x]) => Math.sinh(x)), cosh: cw([1], ([x]) => Math.cosh(x)), tanh: cw([1], ([x]) => Math.tanh(x)),
  asinh: cw([1], ([x]) => Math.asinh(x)), acosh: cw([1], ([x]) => Math.acosh(x)), atanh: cw([1], ([x]) => Math.atanh(x)),
  pow: cw([2], ([x, y]) => Math.pow(x, y), false, ([x, y]) => x < 0 || (x === 0 && y <= 0)),
  exp: cw([1], ([x]) => Math.exp(x)), log: cw([1], ([x]) => Math.log(x)),
  exp2: cw([1], ([x]) => Math.pow(2, x)), log2: cw([1], ([x]) => Math.log2(x)),
  sqrt: cw([1], ([x]) => Math.sqrt(x)), inversesqrt: cw([1], ([x]) => 1 / Math.sqrt(x)),
  abs: cw([1], ([x]) => Math.abs(x), true), sign: cw([1], ([x]) => Math.sign(x), true),
  floor: cw([1], ([x]) => Math.floor(x)), ceil: cw([1], ([x]) => Math.ceil(x)), trunc: cw([1], ([x]) => Math.trunc(x)),
  round: cw([1], ([x]) => Math.round(x), false, ([x]) => Math.abs(x % 1) === 0.5), // the half case is implementation-defined
  fract: cw([1], ([x]) => x - Math.floor(x)),
  mod: cw([2], ([x, y]) => x - y * Math.floor(x / y)),
  min: cw([2], ([x, y]) => Math.min(x, y), true), max: cw([2], ([x, y]) => Math.max(x, y), true),
  clamp: cw([3], ([x, lo, hi]) => clamp(x, lo, hi), true),
  mix: cw([3], ([x, y, t]) => x * (1 - t) + y * t),
  step: cw([2], ([edge, x]) => (x < edge ? 0 : 1)),
  smoothstep: cw([3], ([e0, e1, x]) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }, false, ([e0, e1]) => e0 >= e1),
};

const dot = (a: number[], b: number[]): number => a.reduce((s, x, i) => s + x * b[i], 0);

function literal(e: Expr): Lit | null {
  if (e.kind === "Int" && e.suffix === "") return { comps: [e.value], isInt: true, isVector: false };
  if (e.kind === "Float" && e.suffix === "") return { comps: [e.value], isInt: false, isVector: false };
  if (e.kind === "FunCall" && e.fn.kind === "Var" && /^vec[234]$/.test(e.fn.ident.name)) {
    const n = Number(e.fn.ident.name[3]);
    const parts = e.args.map(literal);
    if (parts.some((p) => p === null || p.isVector)) return null;
    const comps = (parts as Lit[]).flatMap((p) => p.comps);
    if (comps.length === 1) return { comps: Array(n).fill(comps[0]), isInt: false, isVector: true };
    return comps.length === n ? { comps, isInt: false, isVector: true } : null;
  }
  return null;
}

/** The double with the fewest digits that rounds to the same float32 as x; null for NaN/Infinity. */
export function float32Literal(x: number): number | null {
  const f = Math.fround(x);
  if (!Number.isFinite(f)) return null;
  for (let p = 1; p <= 9; p++) {
    const c = Number(f.toPrecision(p));
    if (Math.fround(c) === f) return c;
  }
  return f;
}

function toExpr(comps: number[], isInt: boolean, vecName: string | null, loc: Ident["loc"]): Expr | null {
  const lits: Expr[] = [];
  for (const c of comps) {
    if (isInt) {
      if (!Number.isSafeInteger(c)) return null;
      lits.push(Int(c));
    } else {
      const v = float32Literal(c);
      if (v === null) return null;
      lits.push(Float(v));
    }
  }
  if (vecName === null) return lits[0];
  const allSame = comps.every((c) => Object.is(c, comps[0]));
  return FunCall(Var(new Ident(vecName, loc)), allSame ? [lits[0]] : lits);
}

export function foldBuiltinCall(e: Expr): Expr | null {
  if (e.kind !== "FunCall" || e.fn.kind !== "Var") return null;
  const name = e.fn.ident.name;
  const args = e.args.map(literal);
  if (args.some((a) => a === null)) return null;
  const lits = args as Lit[];
  let result: Expr | null = null;

  const spec = componentwise[name];
  if (spec !== undefined && spec.arity.includes(lits.length)) {
    const width = Math.max(...lits.map((l) => l.comps.length));
    const allInt = lits.every((l) => l.isInt);
    if (!allInt && lits.some((l) => l.isInt)) return null; // int literal where GLSL needs a float
    if (allInt && !spec.intOk) return null;
    const vecName = lits.find((l) => l.isVector)?.comps.length === width ? `vec${width}` : null;
    const comps: number[] = [];
    for (let i = 0; i < width; i++) {
      const args = lits.map((l) => Math.fround(l.comps.length === 1 ? l.comps[0] : l.comps[i]));
      if (spec.undefined !== undefined && spec.undefined(args)) return null;
      const v = spec.fn(args);
      if (Number.isNaN(v)) return null;
      comps.push(v);
    }
    result = toExpr(comps, allInt, vecName, e.fn.ident.loc);
  } else if (lits.every((l) => l.isVector && !l.isInt)) {
    const vs = lits.map((l) => l.comps.map(Math.fround));
    const n = vs[0].length;
    if (!vs.every((v) => v.length === n)) return null;
    if (name === "length" && vs.length === 1) result = toExpr([Math.sqrt(dot(vs[0], vs[0]))], false, null, e.fn.ident.loc);
    else if (name === "dot" && vs.length === 2) result = toExpr([dot(vs[0], vs[1])], false, null, e.fn.ident.loc);
    else if (name === "distance" && vs.length === 2) result = toExpr([Math.sqrt(dot(vs[0].map((x, i) => x - vs[1][i]), vs[0].map((x, i) => x - vs[1][i])))], false, null, e.fn.ident.loc);
    else if (name === "normalize" && vs.length === 1) {
      const len = Math.sqrt(dot(vs[0], vs[0]));
      if (len === 0) return null;
      result = toExpr(vs[0].map((x) => x / len), false, `vec${n}`, e.fn.ident.loc);
    } else if (name === "cross" && vs.length === 2 && n === 3) {
      const [a, b] = vs;
      result = toExpr([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], false, "vec3", e.fn.ident.loc);
    }
  }
  if (result === null) return null;
  return Printer.exprToS(result).length < Printer.exprToS(e).length ? result : null;
}
