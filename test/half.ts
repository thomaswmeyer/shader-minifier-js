// fp16 emulation for the pixel harness. SwiftShader, and desktop ANGLE generally, run `mediump`
// as fp32, so a shader reduced from `highp` to `mediump` renders identically here and the pixel
// test would pass while the shader broke on a phone, where `mediump` is fp16. This transform
// makes a shader compute what fp16 hardware would: every float intermediate is rounded to half
// precision, so the comparison against the fp32 render says what the reduction would cost.
//
// What is rounded: the result of every arithmetic operator, every builtin call that yields
// floats, every constructor, every float literal, and every read of a float uniform or varying
// (fp16 storage). Locals need no rounding on read, since what was stored in them was rounded.
// Not rounded, on purpose: constant expressions (a global initializer or a `const` must stay
// constant), lvalues, bare variables passed to a user function (it may take them `out`), and
// struct fields and arrays, whose element reads are the one under-emulation left.
//
// The rounding itself: in ES 3.00 `unpackHalf2x16(packHalf2x16(x))`, the hardware's own path; in
// ES 1.00 arithmetic that finds the fp16 quantum (11 significant bits, subnormals below 2^-14,
// infinity from 65520) and rounds to it, ties to even. test/half.test.ts checks the two agree.
import * as Ast from "../src/ast.js";
import type { Expr, Stmt, TopLevel } from "../src/ast.js";
import * as Builtin from "../src/builtin.js";
import { defaultOptions } from "../src/options.js";
import { runParser } from "../src/parser.js";
import * as Printer from "../src/printer.js";
import { glslVersion } from "./pixels.js";

export const HALF = "H16_";

/** The rounding function and its overloads, as GLSL text for the given version. */
export function halfHelpers(version: 1 | 2): string {
  // Both paths send what fp16 cannot hold (65520 and up) to infinity, as a conversion does;
  // SwiftShader's packHalf2x16 gives NaN there instead. The ES 1.00 path finds the quantum (2^-24
  // below 2^-14, else 2^(e-10)) and rounds to it, ties to even.
  const scalar = version === 2
    ? `float ${HALF}(float x){if(abs(x)>=65520.)return x*1e35;return unpackHalf2x16(packHalf2x16(vec2(x,0.))).x;}`
    : `float ${HALF}(float x){float a=abs(x);if(a>=65520.)return x*1e35;float p;if(a<6.103515625e-5)p=5.9604644775390625e-8;else{p=exp2(floor(log2(a)));if(p>a)p*=.5;else if(p*2.<=a)p*=2.;p/=1024.;}float n=a/p,r=floor(n),f=n-r;if(f>.5||(f==.5&&mod(r,2.)==1.))r+=1.;return sign(x)*r*p;}`;
  const vec2 = `vec2 ${HALF}(vec2 v){return vec2(${HALF}(v.x),${HALF}(v.y));}`;
  const passthrough = (types: string[]): string => types.map((t) => `${t} ${HALF}(${t} x){return x;}`).join("");
  const mats = version === 2 ? ["mat2", "mat3", "mat4", "mat2x3", "mat2x4", "mat3x2", "mat3x4", "mat4x2", "mat4x3"] : ["mat2", "mat3", "mat4"];
  const mat = (t: string): string => {
    const cols = parseInt(t[3], 10);
    return `${t} ${HALF}(${t} m){return ${t}(${Array.from({ length: cols }, (_, i) => `${HALF}(m[${i}])`).join(",")});}`;
  };
  return scalar + vec2
    + `vec3 ${HALF}(vec3 v){return vec3(${HALF}(v.xy),${HALF}(v.z));}vec4 ${HALF}(vec4 v){return vec4(${HALF}(v.xy),${HALF}(v.zw));}`
    + mats.map(mat).join("")
    + passthrough(["int", "ivec2", "ivec3", "ivec4", ...(version === 2 ? ["uint", "uvec2", "uvec3", "uvec4"] : [])]);
}

// Builtins whose result is a float, vector or matrix of floats (or, for the generic ones, the
// type of their argument, which the passthrough overloads absorb). `modf` and `frexp` take an
// `out` parameter and are left alone.
const floatBuiltins = new Set([
  "radians", "degrees", "sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh",
  "pow", "exp", "log", "exp2", "log2", "sqrt", "inversesqrt", "abs", "sign", "floor", "trunc", "round", "roundEven", "ceil",
  "fract", "mod", "min", "max", "clamp", "mix", "step", "smoothstep", "fma",
  "length", "distance", "dot", "cross", "normalize", "faceforward", "reflect", "refract",
  "matrixCompMult", "outerProduct", "transpose", "determinant", "inverse", "dFdx", "dFdy", "fwidth",
  "texture2D", "texture2DProj", "texture2DLod", "texture2DProjLod", "textureCube", "textureCubeLod",
  "texture", "textureProj", "textureLod", "textureOffset", "texelFetch", "texelFetchOffset", "textureProjOffset",
  "textureLodOffset", "textureProjLod", "textureProjLodOffset", "textureGrad", "textureGradOffset", "textureProjGrad", "textureProjGradOffset",
  "unpackHalf2x16", "unpackSnorm2x16", "unpackUnorm2x16", "intBitsToFloat", "uintBitsToFloat",
]);
const isConstructor = (name: string): boolean => name === "float" || Builtin.builtinVectorTypes.has(name) || Builtin.builtinMatrixTypes.has(name);
const arithmetic = new Set(["+", "-", "*", "/"]);
const isFloatType = (ty: Ast.Type): boolean =>
  ty.name.kind === "TypeName" && ty.arraySizes.length === 0
  && (ty.name.ident.name === "float" || (Builtin.builtinVectorTypes.has(ty.name.ident.name) && !/^[biu]/.test(ty.name.ident.name)) || Builtin.builtinMatrixTypes.has(ty.name.ident.name) && !ty.name.ident.name.startsWith("d"));

interface Ctx { lvalue?: boolean; constant?: boolean; arg?: boolean }

/** The shader with every float intermediate rounded to fp16; `name` decides the stage. */
export function emulateHalf(name: string, source: string): string {
  const version = glslVersion(source);
  const shader = runParser(defaultOptions(), name, source);
  const stage = /\.vert$/.test(name) ? "vert" : "frag";
  const inputQualifiers = stage === "vert" ? ["uniform", "attribute", "in"] : ["uniform", "varying", "in"];

  // Reads of these are fp16 storage.
  const externals = new Set<string>();
  for (const tl of shader.code) {
    if (tl.kind !== "TLDecl") continue;
    const [ty, elts] = tl.decl;
    if (!ty.typeQ.some((q) => inputQualifiers.includes(q)) || !isFloatType(ty)) continue;
    for (const e of elts) if (e.sizes.length === 0) externals.add(e.name.name);
  }

  const wrap = (e: Expr): Expr => Ast.FunCall(Ast.Var(new Ast.Ident(HALF)), [e]);
  const plain: Ctx = {};
  // An lvalue whose evaluation has no effect, so `x op= e` may become `x = H(x op e)`.
  const pureLvalue = (e: Expr): boolean =>
    e.kind === "Var" || (e.kind === "Dot" && pureLvalue(e.expr)) || (e.kind === "Subscript" && pureLvalue(e.arr) && (e.index === null || e.index.kind === "Var" || e.index.kind === "Int"));

  const tx = (e: Expr, ctx: Ctx): Expr => {
    switch (e.kind) {
      case "Int": case "Op": case "VerbatimExp": return e;
      case "Float": return ctx.constant ? e : wrap(e);
      case "Var": return !ctx.lvalue && !ctx.arg && !ctx.constant && externals.has(e.ident.name) ? wrap(e) : e;
      case "Dot": return Ast.Dot(tx(e.expr, { ...ctx, arg: false }), e.field);
      case "Subscript": return Ast.Subscript(tx(e.arr, { ...ctx, arg: false }), e.index === null ? null : tx(e.index, { constant: ctx.constant }));
      case "Conditional": return Ast.Conditional(e.branches.map((b) => ({ ...b, expr: tx(b.expr, ctx) })));
      case "FunCall": {
        const inner: Ctx = { constant: ctx.constant };
        if (e.fn.kind === "Op") {
          const op = e.fn.op;
          if (Builtin.assignOps.has(op) && e.args.length === 2) {
            const lhs = tx(e.args[0], { lvalue: true });
            const rhs = tx(e.args[1], inner);
            if (op === "=" || ctx.constant || !pureLvalue(e.args[0])) return Ast.OpCall(op, [lhs, rhs]);
            return Ast.OpCall("=", [lhs, wrap(Ast.OpCall(op.slice(0, -1), [tx(e.args[0], plain), rhs]))]);
          }
          if (op === "++" || op === "--" || op === "$++" || op === "$--") return Ast.OpCall(op, [tx(e.args[0], { lvalue: true })]);
          const args = e.args.map((a) => tx(a, inner));
          return arithmetic.has(op) && !ctx.constant ? wrap(Ast.OpCall(op, args)) : Ast.OpCall(op, args);
        }
        if (e.fn.kind === "Var") {
          const fname = e.fn.ident.name;
          if (floatBuiltins.has(fname) || isConstructor(fname)) {
            const call = Ast.FunCall(e.fn, e.args.map((a) => tx(a, inner)));
            return ctx.constant ? call : wrap(call);
          }
          return Ast.FunCall(e.fn, e.args.map((a) => tx(a, { ...inner, arg: true }))); // a user function, or a macro
        }
        return Ast.FunCall(tx(e.fn, inner), e.args.map((a) => tx(a, inner)));
      }
    }
  };

  const txDecl = ([ty, elts]: Ast.Decl, constant: boolean): Ast.Decl =>
    [ty, elts.map((d) => ({ ...d, init: d.init === null ? null : tx(d.init, { constant: constant || Ast.typeIsConst(ty) }) }))];
  const txStmt = (s: Stmt): Stmt => {
    switch (s.kind) {
      case "Block": return Ast.Block(s.stmts.map(txStmt));
      case "Decl": return Ast.DeclStmt(txDecl(s.decl, false));
      case "Expr": return Ast.ExprStmt(tx(s.expr, plain));
      case "If": return Ast.If(tx(s.cond, plain), txStmt(s.then), s.else === null ? null : txStmt(s.else));
      case "ForD": return Ast.ForD(txDecl(s.init, false), s.cond === null ? null : tx(s.cond, plain), s.inc === null ? null : tx(s.inc, plain), txStmt(s.body));
      case "ForE": return Ast.ForE(s.init === null ? null : tx(s.init, plain), s.cond === null ? null : tx(s.cond, plain), s.inc === null ? null : tx(s.inc, plain), txStmt(s.body));
      case "While": return Ast.While(tx(s.cond, plain), txStmt(s.body));
      case "DoWhile": return Ast.DoWhile(tx(s.cond, plain), txStmt(s.body));
      case "Jump": return Ast.Jump(s.keyword, s.expr === null ? null : tx(s.expr, plain));
      case "Verbatim": case "Directive": return s;
      case "Switch": return Ast.Switch(tx(s.expr, plain), s.cases.map((c) => ({ label: c.label, stmts: c.stmts.map(txStmt) })));
    }
  };
  const code: TopLevel[] = shader.code.map((tl) => {
    switch (tl.kind) {
      case "Function": return Ast.Function(tl.funcType, txStmt(tl.body));
      case "TLDecl": return Ast.TLDecl(txDecl(tl.decl, true)); // a global initializer must stay a constant expression
      default: return tl;
    }
  });

  // The helpers go after the float precision statement, which a function needs in an ES fragment
  // shader, or else after the leading directives.
  let at = code.findIndex((tl) => tl.kind === "Precision" && tl.ty.name.kind === "TypeName" && tl.ty.name.ident.name === "float");
  if (at < 0) { at = 0; while (at < code.length && code[at].kind === "TLDirective") at++; } else at++;
  code.splice(at, 0, Ast.TLVerbatim(halfHelpers(version)));
  return Printer.print(code);
}
