// The static type of an expression, as far as it can be told without a full type checker, for
// resolving a call among overloads of the same arity: `f(vec2)` against `f(float)`. Every answer is
// exact or null. A null argument type leaves a call unresolved, which is what the passes already
// handle; a wrong answer would bind a call to the wrong function, so every rule here is a rule
// the GLSL spec states, and anything else is null.
import * as Ast from "./ast.js";
import type { Expr, StructOrInterfaceBlock, Type } from "./ast.js";
import { Ident, makeType } from "./ast.js";
import * as Builtin from "./builtin.js";

const named = (name: string, sizes: readonly Expr[] = []): Type => makeType(Ast.TypeName(new Ident(name)), [], [...sizes]);
export const typeName = (t: Type): string | null => (t.name.kind === "TypeName" ? t.name.ident.name : null);
export const arrayDims = (t: Type): number => t.arraySizes.length;

/** A scalar's name and a vector's component count and scalar name; null for anything else. */
const vector = (name: string): { base: string; n: number } | null => {
  if (name === "float" || name === "int" || name === "uint" || name === "bool") return { base: name, n: 1 };
  const m = /^([iub]?)vec([234])$/.exec(name);
  if (m === null) return null;
  return { base: { "": "float", i: "int", u: "uint", b: "bool" }[m[1]]!, n: Number(m[2]) };
};
const vectorName = (base: string, n: number): string => (n === 1 ? base : `${{ float: "", int: "i", uint: "u", bool: "b" }[base] ?? ""}vec${n}`);
const matrix = (name: string): { cols: number; rows: number } | null => {
  const m = /^mat([234])(?:x([234]))?$/.exec(name);
  return m === null ? null : { cols: Number(m[1]), rows: Number(m[2] ?? m[1]) };
};

/** The types of the builtin variables a shader may read. */
const builtinVariables: Record<string, string> = {
  gl_FragCoord: "vec4", gl_FrontFacing: "bool", gl_PointCoord: "vec2", gl_FragColor: "vec4", gl_FragDepth: "float",
  gl_Position: "vec4", gl_PointSize: "float", gl_VertexID: "int", gl_InstanceID: "int",
};

/** Builtin functions whose result has the type of their widest argument (`max(vec3, float)` is a vec3, `step(float, vec2)` a vec2). */
const genTypeFunctions = new Set([
  ...Builtin.trigonometryFunctions,
  "abs", "ceil", "clamp", "dFdx", "dFdy", "exp", "exp2", "floor", "fma", "fract", "fwidth", "inversesqrt", "log", "log2",
  "max", "min", "mix", "mod", "pow", "round", "roundEven", "sign", "smoothstep", "sqrt", "step", "trunc",
  "normalize", "reflect", "refract", "faceforward", "cross",
]);

export class ExprTyper {
  /**
   * `isAlternative` says whether a variable is declared in alternative `#if` branches, possibly with
   * another type in the other branch: its type here is one setting's, so it is unknown.
   */
  constructor(private readonly structs: ReadonlyMap<string, StructOrInterfaceBlock>, private readonly isAlternative: (elt: Ast.DeclElt) => boolean = () => false) {}

  /** The type of a variable as declared: its type plus the declarator's own array sizes. */
  static declaredType(ty: Type, elt: Ast.DeclElt): Type {
    return elt.sizes.length === 0 && ty.typeQ.length === 0 ? ty : makeType(ty.name, [], [...elt.sizes, ...ty.arraySizes]);
  }

  typeOf(e: Expr): Type | null {
    switch (e.kind) {
      case "Int": return named("int");
      case "Float": return named("float");
      case "Var": {
        const d = e.ident.declaration;
        if (d.kind === "Variable") return this.isAlternative(d.decl.decl) ? null : ExprTyper.declaredType(d.decl.ty, d.decl.decl);
        const b = builtinVariables[e.ident.name];
        return b === undefined ? null : named(b);
      }
      case "Subscript": {
        const t = this.typeOf(e.arr);
        if (t === null) return null;
        if (arrayDims(t) > 0) return makeType(t.name, [], t.arraySizes.slice(1));
        const n = typeName(t);
        if (n === null) return null;
        const v = vector(n);
        if (v !== null && v.n > 1) return named(v.base);
        const m = matrix(n);
        return m === null ? null : named(vectorName("float", m.rows));
      }
      case "Dot": {
        const t = this.typeOf(e.expr);
        if (t === null || arrayDims(t) > 0) return null;
        if (t.name.kind === "TypeBlock") return this.fieldType(t.name.block, e.field.name);
        const n = t.name.ident.name;
        const v = vector(n);
        if (v !== null) return Builtin.isFieldSwizzle(e.field.name) && e.field.name.length <= 4 && v.n > 1 ? named(vectorName(v.base, e.field.name.length)) : null;
        const s = this.structs.get(n);
        return s === undefined ? null : this.fieldType(s, e.field.name);
      }
      case "FunCall": return this.callType(e);
      case "Conditional": {
        const ts = e.branches.map((b) => this.typeOf(b.expr));
        return ts.every((t) => t !== null && sameType(t, ts[0]!)) ? ts[0] : null;
      }
      default: return null;
    }
  }

  private fieldType(block: StructOrInterfaceBlock, field: string): Type | null {
    for (const m of block.members) {
      if (m.kind !== "MemberVariable") return null; // a member kept as text: the layout is not known
      for (const d of m.decl[1]) if (d.name.name === field) return ExprTyper.declaredType(m.decl[0], d);
    }
    return null;
  }

  private callType(e: Extract<Expr, { kind: "FunCall" }>): Type | null {
    const args = e.args;
    if (e.fn.kind === "Op") {
      const op = e.fn.op;
      if (op === "?:") { const a = this.typeOf(args[1]), b = this.typeOf(args[2]); return a !== null && b !== null && sameType(a, b) ? a : null; }
      if (op === ",") return this.typeOf(args[args.length - 1]);
      if (Builtin.assignOps.has(op)) return this.typeOf(args[0]);
      if (["==", "!=", "<", ">", "<=", ">=", "&&", "||", "^^", "!"].includes(op)) return named("bool");
      if (args.length === 1) return this.typeOf(args[0]); // unary -, +, ~, ++, --
      if (args.length !== 2) return null;
      const a = this.typeOf(args[0]), b = this.typeOf(args[1]);
      if (a === null || b === null || arrayDims(a) > 0 || arrayDims(b) > 0) return null;
      const an = typeName(a), bn = typeName(b);
      if (an === null || bn === null) return null;
      if (an === bn) {
        // mat*mat is a matrix; every other operator on equal types, and the rest of mat op mat, is componentwise
        return named(an);
      }
      const av = vector(an), bv = vector(bn), am = matrix(an), bm = matrix(bn);
      if (av !== null && bv !== null) {
        if (av.base !== bv.base) return null;
        return av.n === 1 ? b : bv.n === 1 ? a : null; // scalar op vector
      }
      if (op === "*") {
        if (am !== null && bv !== null) return bv.n === 1 ? a : bv.n === am.cols ? named(vectorName("float", am.rows)) : null; // mat * vec
        if (av !== null && bm !== null) return av.n === 1 ? b : av.n === bm.rows ? named(vectorName("float", bm.cols)) : null; // vec * mat
        if (am !== null && bm !== null) return bm.cols === am.cols && am.cols === bm.rows ? a : null;
      }
      if (am !== null && bv !== null && bv.n === 1) return a; // mat op scalar
      if (av !== null && av.n === 1 && bm !== null) return b;
      return null;
    }
    if (e.fn.kind !== "Var") return null;
    const name = e.fn.ident.name;
    const d = e.fn.ident.declaration;
    if (d.kind === "UserFunction") return d.decl.funcType.retType;
    if (Builtin.builtinTypes.has(name) && name !== "void") return named(name); // a constructor
    if (this.structs.has(name)) return named(name);
    if (d.kind !== "BuiltinFunction" && !Builtin.builtinFunctions.has(name)) return null;
    if (genTypeFunctions.has(name)) {
      let widest: Type | null = null;
      for (const a of args) {
        const t = this.typeOf(a);
        if (t === null || arrayDims(t) > 0) return null;
        const v = vector(typeName(t) ?? "");
        if (v === null) return null;
        if (widest === null || v.n > vector(typeName(widest)!)!.n) widest = t;
      }
      return widest;
    }
    if (name === "length" || name === "distance" || name === "dot") return named("float");
    if (Builtin.textureFunctions.has(name) && args.length > 0) {
      const s = this.typeOf(args[0]);
      const sn = s === null ? null : typeName(s);
      if (sn === null || !Builtin.isSamplerType(sn)) return null;
      if (sn.endsWith("Shadow")) return named("float");
      return named(sn.startsWith("u") ? "uvec4" : sn.startsWith("i") ? "ivec4" : "vec4");
    }
    return null;
  }
}

/** The same type for a parameter and an argument: same name and as many array dimensions (qualifiers and precision aside). */
export const sameType = (a: Type, b: Type): boolean => {
  const an = typeName(a), bn = typeName(b);
  return an !== null && an === bn && arrayDims(a) === arrayDims(b);
};

/** The parameter types of a function, as declared. */
export const signatureOf = (ft: Ast.FunctionType): Type[] => ft.args.map(([ty, elts]) => ExprTyper.declaredType(ty, elts[0]));

/** Two functions of one name and arity are the same overload when their parameter types agree; function nodes are rebuilt between passes, so identity says nothing. */
export const sameSignature = (a: Ast.FunctionType, b: Ast.FunctionType): boolean => {
  const sa = signatureOf(a), sb = signatureOf(b);
  return a.fName.name === b.fName.name && sa.length === sb.length && sa.every((t, i) => sameType(t, sb[i]));
};
