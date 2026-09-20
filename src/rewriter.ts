// Port of Minifier/rewriter.fs
import * as Ast from "./ast.js";
import type { BlockLevel, Decl, DeclElt, Expr, FunctionType, Ident as IdentT, Location, MapEnv, Stmt, StructOrInterfaceBlock, TopLevel, Type, VarDecl } from "./ast.js";
import {
  Block, DeclStmt, Dot, ExprStmt, Float, ForD, ForE, FunCall, DoWhile, Function as FunctionTL, Ident, If, Int, Jump, OpCall,
  TLDecl, TLDirective, TLVerbatim, Var, Verbatim, Directive,
  asOpCall, exprListEquals, funParameters, funPrototype, prototypeKey, resolvedVariableUse,
  typeEquals, typeIsConst, typeIsOutOrInout, typeIsScalar, typeIsScalarOrVector, makeType, asStmtList,
} from "./ast.js";
import { Analyzer, Effects, IdentKind, VarVisitor, type FuncInfo, type VarUse } from "./analyzer.js";
import * as Builtin from "./builtin.js";
import { float32Literal, foldBuiltinCall } from "./fold-builtins.js";
import { ArgumentInlining, FunctionInlining, VariableInlining } from "./inlining.js";
import { renameField, trace, type Options, type Stage } from "./options.js";
import * as Printer from "./printer.js";

const locToS = (loc: Location): string => `${loc.line}:${loc.col}`;

const commaSeparatedExprs = (li: Expr[]): Expr => li.reduce((a, b) => OpCall(",", [a, b]));

function isKnownToHaveTypeFloat(e: Expr): boolean {
  if (e.kind === "Float") return true;
  const r = resolvedVariableUse(e);
  if (r !== null) return r[1].decl.name.name === "float";
  return false;
}

function isKnownToBeScalarOrVector(e: Expr): boolean {
  switch (e.kind) {
    case "Int": case "Float": return true;
    case "Var": {
      const d = e.ident.declaration;
      switch (d.kind) {
        case "Unknown": return false;
        case "Variable": return typeIsScalarOrVector(d.decl.ty);
        case "UserFunction": return typeIsScalarOrVector(d.decl.funcType.retType);
        case "BuiltinFunction": return Builtin.builtinScalarTypes.has(e.ident.name) || Builtin.builtinVectorTypes.has(e.ident.name);
        case "UnknownFunction": return false;
      }
    }
    // falls through
    default: return false;
  }
}

function isKnownToBeScalar(e: Expr): boolean {
  switch (e.kind) {
    case "Int": case "Float": return true;
    case "Var": {
      const d = e.ident.declaration;
      switch (d.kind) {
        case "Unknown": return false;
        case "Variable": return typeIsScalar(d.decl.ty);
        case "UserFunction": return typeIsScalar(d.decl.funcType.retType);
        case "BuiltinFunction": return Builtin.builtinScalarTypes.has(e.ident.name);
        case "UnknownFunction": return false;
      }
    }
    // falls through
    default: return false;
  }
}

// Upstream folds Float constants with .NET decimal; rounding the double result to 15 significant
// digits gives the same float32 in every case tried and keeps 1.1+2.2 printing as 3.3.
const fold15 = (x: number): number => (Number.isFinite(x) ? Number(x.toPrecision(15)) : x);
const decimalAdd = (a: number, b: number): number => fold15(a + b);
const decimalSub = (a: number, b: number): number => fold15(a - b);
const decimalMul = (a: number, b: number): number => fold15(a * b);
const decimalRound8 = (f: number): number => Math.round(f * 1e8) / 1e8;

enum OptimizationPass {
  First,
  Second, // adds "var reuse"
}

type Assignment = { name: IdentT; target: Expr | null; expr: Expr };

const nonStructType: Type = makeType(Ast.TypeName(new Ident("float")), [], []);

class RewriterImpl {
  // For --webgl: what ANGLE rejects depends on struct-ness and void-ness, which upstream never
  // tracks, so the declarations of the file are indexed once per pass.
  private readonly structs = new Map<string, StructOrInterfaceBlock>();
  private readonly returnTypes = new Map<string, Type[]>(); // every overload's return type, by function name
  private readonly voidSequenceForbidden: boolean;
  // Whether a struct of the file has a field named like a swizzle (`q`, `rgb`): then `e.q` is a
  // swizzle only where e is known not to be a struct. Without such fields every one is, as upstream assumes.
  private readonly swizzleLikeFields: boolean;

  constructor(private readonly options: Options, private readonly optimizationPass: OptimizationPass, code: readonly TopLevel[] = []) {
    const blocks: StructOrInterfaceBlock[] = [];
    for (const tl of code) {
      if (tl.kind === "TypeDecl") blocks.push(tl.block);
      else if (tl.kind === "TLDecl" && tl.decl[0].name.kind === "TypeBlock") blocks.push(tl.decl[0].name.block);
    }
    this.swizzleLikeFields = blocks.some((b) => b.members.some((m) => m.kind === "MemberVariable" && m.decl[1].some((d) => Builtin.isFieldSwizzle(d.name.name))));
    for (const tl of code) {
      if (tl.kind === "TypeDecl" && tl.block.name !== null) this.structs.set(tl.block.name.name, tl.block);
      else if (tl.kind === "Function") {
        const name = tl.funcType.fName.name;
        const ret = tl.funcType.retType;
        this.returnTypes.set(name, [...(this.returnTypes.get(name) ?? []), ret]);
      }
    }
    // Only ES 3.00 rejects void operands in a sequence, but the `#version 300 es` line is usually
    // prepended at runtime (shadertoy, three.js), so the source can't tell us which rules apply.
    this.voidSequenceForbidden = options.webgl;
  }

  // `typeOf` answers `null` for what it cannot work out: an unresolved overload, a macro that
  // looks like a call, a builtin variable that is not `gl_`-prefixed. The two kinds of caller read
  // that `null` in opposite directions, and must:
  //
  //   a guard (`mayBeStruct`, `structTernaryForbidden`, `hasVoidOperand`) asks "could this be one?"
  //     and treats the unknown as yes, so a rewrite is skipped rather than risked;
  //   a check on finished output (`webglCheck`) asks "is this proven to be one?" and treats the
  //     unknown as no, so it reports what the guards let through instead of failing on a shader it
  //     merely cannot type.
  //
  // Reading `null` the other way around in either place would be a bug: a permissive guard emits a
  // shader ANGLE rejects, a conservative check refuses a shader that is fine.
  private isVoidType(ty: Type): boolean {
    return ty.name.kind === "TypeName" && ty.name.ident.name === "void";
  }

  private isStructType(ty: Type): boolean {
    if (ty.name.kind === "TypeBlock") return true;
    const n = ty.name.ident.name;
    return !Builtin.builtinTypes.has(n) && !Builtin.isSamplerType(n);
  }

  // Best-effort static type; null means unknown.
  private typeOf(e: Expr): Type | null {
    switch (e.kind) {
      case "Int": case "Float": return nonStructType;
      case "Var":
        if (e.ident.declaration.kind === "Variable") return e.ident.declaration.decl.ty;
        return e.ident.name.startsWith("gl_") ? nonStructType : null; // a builtin variable is never a struct
      case "Subscript": return this.typeOf(e.arr);
      case "Dot": {
        const t = this.typeOf(e.expr);
        if (t === null) return null;
        if (!this.isStructType(t)) return nonStructType;
        const block = t.name.kind === "TypeBlock" ? t.name.block : this.structs.get(t.name.ident.name);
        if (block === undefined) return null;
        for (const m of block.members) {
          if (m.kind === "MemberVariable" && m.decl[1].some((d) => d.name.name === e.field.name)) return m.decl[0];
        }
        return null;
      }
      case "FunCall": {
        if (e.fn.kind === "Op") {
          if (e.fn.op === "?:") return this.typeOf(e.args[1]);
          if (Builtin.assignOps.has(e.fn.op)) return this.typeOf(e.args[0]);
          if (e.fn.op === ",") return this.typeOf(e.args[e.args.length - 1]);
          return nonStructType; // structs only support == and !=, which yield bool
        }
        if (e.fn.kind !== "Var") return null;
        const d = e.fn.ident.declaration;
        if (d.kind === "UserFunction") return d.decl.funcType.retType;
        if (d.kind === "BuiltinFunction" || Builtin.builtinTypes.has(e.fn.ident.name)) return nonStructType;
        // An overloaded call the analyzer cannot resolve still has a known type when every overload agrees.
        const overloads = this.returnTypes.get(e.fn.ident.name);
        if (overloads !== undefined && overloads.every((t) => typeEquals(t, overloads[0]))) return overloads[0];
        const s = this.structs.get(e.fn.ident.name);
        return s === undefined ? null : makeType(Ast.TypeName(s.name!), [], []);
      }
      default: return null;
    }
  }

  private mayBeStruct(e: Expr): boolean {
    const t = this.typeOf(e);
    return t === null || this.isStructType(t);
  }

  /** Whether `expr.field` is a swizzle rather than a struct field access. */
  private isSwizzle(expr: Expr, field: string): boolean {
    return Builtin.isFieldSwizzle(field) && (!this.swizzleLikeFields || !this.mayBeStruct(expr));
  }

  private structTernaryForbidden(blockLevel: BlockLevel, e1: Expr, e2: Expr): boolean {
    if (!this.options.webgl) return false;
    if (blockLevel.kind === "FunctionRoot") return this.isStructType(blockLevel.fn.retType);
    return this.mayBeStruct(e1) || this.mayBeStruct(e2);
  }

  // Under --webgl the output must not contain what ANGLE rejects, whether it came from the input or
  // from a rewrite the guards missed: failing here beats emitting a shader that won't compile.
  webglCheck(code: readonly TopLevel[]): void {
    const check = (_env: MapEnv, e: Expr): Expr => {
      const op = asOpCall(e);
      if (op === null) return e;
      if (op.op === "?:" && op.args.length === 3) {
        const t = this.typeOf(op.args[1]) ?? this.typeOf(op.args[2]);
        if (t !== null && this.isStructType(t)) throw new Error(`--webgl: WebGL rejects the ternary operator on struct values: ${Printer.exprToS(e)}`);
      } else if (op.op === ",") {
        const v = op.args.find((a) => a.kind === "FunCall" && a.fn.kind === "Var" && a.fn.ident.declaration.kind === "UserFunction" && this.hasVoidOperand(a));
        if (v !== undefined) throw new Error(`--webgl: WebGL (ES 3.00) rejects a void call in a comma sequence: ${Printer.exprToS(v)} in ${Printer.exprToS(e)}`);
      }
      return e;
    };
    Ast.visitor(this.options, check).iterTopLevel(code);
  }

  private hasVoidOperand(e: Expr): boolean {
    const op = asOpCall(e);
    if (op !== null && op.op === ",") return op.args.some((a) => this.hasVoidOperand(a));
    if (e.kind !== "FunCall" || e.fn.kind !== "Var") return false;
    const d = e.fn.ident.declaration;
    const name = e.fn.ident.name;
    if (d.kind === "UserFunction") return this.isVoidType(d.decl.funcType.retType);
    if (d.kind === "BuiltinFunction") return false;
    // overloads: void if any overload is; a macro that looks like a call: assume void unless it names something known
    const overloads = this.returnTypes.get(name);
    if (overloads !== undefined) return overloads.some((t) => this.isVoidType(t));
    return !(Builtin.builtinFunctions.has(name) || Builtin.builtinTypes.has(name) || this.structs.has(name));
  }

  // Remove useless spaces in macros
  private stripSpaces(str: string): string {
    let result = "";
    let last = "\n";
    const write = (c: string): void => {
      last = c;
      result += c;
    };
    const isId = (c: string): boolean => /^[\p{L}\p{Nd}_]$/u.test(c);

    let space = false;
    let wasNewline = false;
    for (const c of str) {
      if (c === "\n") {
        if (!wasNewline) write("\n");
        space = false;
        wasNewline = true;
      } else if (/^\s$/.test(c)) {
        space = true;
        wasNewline = false;
      } else {
        wasNewline = false;
        if (space && isId(c) && isId(last)) write(" ");
        write(c);
        space = false;
      }
    }
    return result;
  }

  private stripDirectiveSpaces(li: string[]): string[] {
    if (li.length === 3 && li[0] === "#define") {
      const [, name, value] = li;
      // we need to distinguish between " #define f (x)" and "#define f(x)"; the whitespace may be
      // a tab (three.js: `#define RE_Direct\t\t\tRE_Direct_Lambert`), which upstream glued to the name
      const spacePrefix = /^[ \t]/.test(value) ? " " : "";
      const body = this.stripSpaces(value);
      return ["#define", name, body === "" ? "" : spacePrefix + body];
    }
    return li.map((s) => this.stripSpaces(s));
  }

  private declsNotToInline(d: DeclElt[]): DeclElt[] { return d.filter((x) => !x.name.toBeInlined); }

  private bool(b: boolean): Expr { return Var(new Ident(b ? "true" : "false")); }

  private inlineFn(declArgs: Decl[], passedArgs: Expr[], bodyExpr: Expr): Expr {
    if (declArgs.length !== passedArgs.length) throw new Error("inlineFn: argument count mismatch");
    const argMap = new Map<string, Expr>();
    declArgs.forEach((declArg, i) => {
      const elts = declArg[1];
      if (elts.length !== 1) throw new Error("invalid declElt for function argument");
      argMap.set(elts[0].name.name, passedArgs[i]);
    });
    const mapInline = (_env: MapEnv, e: Expr): Expr => {
      if (e.kind === "Var") {
        const inlinedExpr = argMap.get(e.ident.name);
        if (inlinedExpr !== undefined) return inlinedExpr;
        // This var isn't an argument to the inlined function (must be a
        // global or similar). We need to create a brand-new ident.  This is
        // because the renamer does its work via mutation on the ident. So
        // if this function gets inlined in more than one place, we don't want
        // mutations to affect all the inlined idents.
        return Var(new Ident(e.ident.name, e.ident.loc));
      }
      return e;
    };
    return Ast.visitor(this.options, mapInline).mapExpr(bodyExpr);
  }

  // Expression that doesn't need parentheses around it.
  private isNoParen(e: Expr): boolean {
    switch (e.kind) {
      case "Int": case "Float": case "Dot": case "Var": case "Subscript": return true;
      case "FunCall": return e.fn.kind === "Var";
      default: return false;
    }
  }

  // Expression that statically evaluates to a boolean value.
  private boolOf(e: Expr): "True" | "False" | "NotABool" {
    switch (e.kind) {
      case "Int": return e.value !== 0 ? "True" : "False";
      case "Float": return e.value !== 0 ? "True" : "False";
      case "Var":
        if (e.ident.name === "true") return "True";
        if (e.ident.name === "false") return "False";
        return "NotABool";
      default: return "NotABool";
    }
  }

  // Expression that statically evaluates to a numeric value.
  private numberOf(e: Expr): number | null {
    if (e.kind === "Int" || e.kind === "Float") return e.value;
    return null;
  }

  private varWithPossibleField(e: Expr): IdentT | null {
    if (e.kind === "Var") return e.ident;
    if (e.kind === "Dot") return this.varWithPossibleField(e.expr);
    return null;
  }

  // Expression that is equivalent to an assignment to a variable (or its fields).
  private asAssignment(e: Expr): Assignment | null {
    const augment = (op: string, name: IdentT, target: Expr | null, rhs: Expr): Assignment | null => {
      const baseOp = op.replace(/=+$/, "");
      if (!Builtin.augmentableOperators.has(baseOp)) {
        return null; // Here ++x/--x could be detected as an Assigment, but not x++/x--.
      }
      const augmentedE = OpCall(baseOp, [Var(name), rhs]);
      return { name, target, expr: augmentedE };
    };
    const opCall = asOpCall(e);
    if (opCall === null || opCall.args.length !== 2) return null;
    const [lhs, rhs] = opCall.args;
    if (opCall.op === "=") {
      if (lhs.kind === "Var") return { name: lhs.ident, target: null, expr: rhs };
      const v = this.varWithPossibleField(lhs);
      if (v !== null) return { name: v, target: lhs, expr: rhs };
      return null;
    }
    if (Builtin.assignOps.has(opCall.op)) {
      if (lhs.kind === "Var") return augment(opCall.op, lhs.ident, null, rhs);
      const v = this.varWithPossibleField(lhs);
      if (v !== null) return augment(opCall.op, v, lhs, rhs);
    }
    return null;
  }

  private simplifyOperator(env: MapEnv, e: Expr): Expr {
    const opCall = asOpCall(e);
    if (opCall === null) return e;
    const { op, args } = opCall;
    const n = args.length;
    const a0 = args[0];
    const a1 = args[1];
    const sub0 = n >= 1 ? asOpCall(a0) : null;
    const sub1 = n >= 2 ? asOpCall(a1) : null;

    if (op === "-" && n === 1 && a0.kind === "Int") return Int(-a0.value, a0.suffix);
    if (op === "-" && n === 1 && sub0 !== null && sub0.op === "-" && sub0.args.length === 1) return sub0.args[0];
    if (op === "+" && n === 1) return a0;
    // e1 - - e2 -> e1 + e2
    if (op === "-" && n === 2 && sub1 !== null && sub1.op === "-" && sub1.args.length === 1) {
      return env.fExpr(env, OpCall("+", [a0, sub1.args[0]]));
    }
    // e1 + - e2 -> e1 - e2
    if (op === "+" && n === 2 && sub1 !== null && sub1.op === "-" && sub1.args.length === 1) {
      return env.fExpr(env, OpCall("-", [a0, sub1.args[0]]));
    }

    if (op === "," && n === 2 && sub1 !== null && sub1.op === "," && sub1.args.length === 2) {
      return OpCall(",", [env.fExpr(env, OpCall(",", [a0, sub1.args[0]])), sub1.args[1]]);
    }

    if (op === "-" && n === 2 && a1.kind === "Float" && a1.value < 0) {
      return env.fExpr(env, OpCall("+", [a0, Float(-a1.value, a1.suffix)]));
    }
    if (op === "-" && n === 2 && a1.kind === "Int" && a1.value < 0) {
      return env.fExpr(env, OpCall("+", [a0, Int(-a1.value, a1.suffix)]));
    }

    // Boolean simplifications (let's ignore the suffix)
    if (n === 2) {
      const n1 = this.numberOf(a0);
      const n2 = this.numberOf(a1);
      if (n1 !== null && n2 !== null) {
        switch (op) {
          case "<": return this.bool(n1 < n2);
          case ">": return this.bool(n1 > n2);
          case "<=": return this.bool(n1 <= n2);
          case ">=": return this.bool(n1 >= n2);
          case "==": return this.bool(n1 === n2);
          case "!=": return this.bool(n1 !== n2);
        }
      }
    }

    // Conditionals
    if (op === "?:" && n === 3) {
      const b = this.boolOf(a0);
      if (b === "True") return a1;
      if (b === "False") return args[2];
    }
    if (op === "&&" && n === 2) {
      const b0 = this.boolOf(a0);
      if (b0 === "True") return a1;
      if (b0 === "False") return this.bool(false);
      if (this.boolOf(a1) === "True") return a0;
    }
    if (op === "||" && n === 2) {
      const b0 = this.boolOf(a0);
      if (b0 === "True") return this.bool(true);
      if (b0 === "False") return a1;
      if (this.boolOf(a1) === "False") return a0;
    }

    // Stupid simplifications (they can be useful to simplify rewritten code)
    if (n === 2) {
      const n1 = this.numberOf(a0);
      const n2 = this.numberOf(a1);
      if (op === "/" && n2 === 1) return a0;
      if (op === "*" && n2 === 1) return a0;
      if (op === "*" && n1 === 1) return a1;
      // | FunCall(Op "*", [_; Number 0M as zero]) -> zero // unsafe
      // | FunCall(Op "*", [Number 0M as zero; _]) -> zero // unsafe
      if (op === "+" && n2 === 0) return a0;
      if (op === "+" && n1 === 0) return a1;
      if (op === "-" && n2 === 0) return a0;
      if (op === "-" && n1 === 0) return OpCall("-", [a1]);
    }

    // No simplification when numbers have different suffixes
    if (n === 2 && a0.kind === "Int" && a1.kind === "Int" && a0.suffix !== a1.suffix) return e;
    if (n === 2 && a0.kind === "Float" && a1.kind === "Float" && a0.suffix !== a1.suffix) return e;

    if (n === 2 && a0.kind === "Int" && a1.kind === "Int") {
      const i1 = a0.value;
      const i2 = a1.value;
      let r: number | null = null;
      switch (op) {
        case "-": r = i1 - i2; break;
        case "+": r = i1 + i2; break;
        case "*": r = i1 * i2; break;
        case "/": if (i2 !== 0) r = Number(BigInt(i1) / BigInt(i2)); break;
        case "%": if (i2 !== 0) r = Number(BigInt(i1) % BigInt(i2)); break;
      }
      if (r !== null && Number.isSafeInteger(r)) return Int(r, a0.suffix);
    }

    if (op === "-" && n === 1 && a0.kind === "Float") {
      if (a0.value === 0) return Float(0, a0.suffix);
      return Float(-a0.value, a0.suffix);
    }
    if (n === 2 && a0.kind === "Float" && a1.kind === "Float") {
      const su = a0.suffix;
      if (this.options.foldBuiltins) {
        // What the GPU's compiler computes: float32 operands, one float32 rounding per operation
        // (a double holds the exact sum, difference, product or quotient of two float32s). Kept
        // only when the literal is not longer than the expression, as upstream does for division.
        const i1 = Math.fround(a0.value);
        const i2 = Math.fround(a1.value);
        const r = op === "-" ? i1 - i2 : op === "+" ? i1 + i2 : op === "*" ? i1 * i2 : op === "/" && i2 !== 0 ? i1 / i2 : null;
        const lit = r === null ? null : float32Literal(r);
        if (lit !== null) {
          const folded = Float(lit, su);
          if (Printer.exprToS(folded).length <= Printer.exprToS(e).length) return folded;
          return e;
        }
      } else {
        const i1 = a0.value;
        const i2 = a1.value;
        switch (op) {
          case "-": return Float(decimalSub(i1, i2), su);
          case "+": return Float(decimalAdd(i1, i2), su);
          case "*": return Float(decimalMul(i1, i2), su);
          case "/":
            if (i2 !== 0) {
              const div = Float(i1 / i2, su);
              if (Printer.exprToS(e).length <= Printer.exprToS(div).length) return e;
              return div;
            }
            break;
        }
      }
    }

    // Swap operands to get rid of parentheses.
    // x*(y*z) -> y*z*x
    if (op === "*" && n === 2 && this.isNoParen(a0) && sub1 !== null && sub1.op === "*" && sub1.args.length === 2) {
      const x = a0;
      const [y, z] = sub1.args;
      if (Effects.isPure(x) && Effects.isPure(y) && Effects.isPure(z) &&
        // Matrix multiplication is not commutative! Except with scalars.
        ((isKnownToBeScalarOrVector(x) && isKnownToBeScalarOrVector(y) && isKnownToBeScalarOrVector(z)) ||
          [isKnownToBeScalar(x), isKnownToBeScalar(y), isKnownToBeScalar(z)].filter((b) => b).length >= 2)) {
        return env.fExpr(env, OpCall("*", [OpCall("*", [y, z]), x]));
      }
    }
    // x+(y+z) -> x+y+z
    // x+(y-z) -> x+y-z
    if (op === "+" && n === 2 && this.isNoParen(a0) && sub1 !== null && (sub1.op === "+" || sub1.op === "-") && sub1.args.length === 2) {
      const [y, z] = sub1.args;
      return env.fExpr(env, OpCall(sub1.op, [OpCall("+", [a0, y]), z]));
    }
    // x-(y+z) -> x-y-z
    if (op === "-" && n === 2 && sub1 !== null && sub1.op === "+" && sub1.args.length === 2) {
      const [y, z] = sub1.args;
      return env.fExpr(env, OpCall("-", [OpCall("-", [a0, y]), z]));
    }
    // x-(y-z) -> x-y+z
    if (op === "-" && n === 2 && sub1 !== null && sub1.op === "-" && sub1.args.length === 2) {
      const [y, z] = sub1.args;
      return env.fExpr(env, OpCall("+", [OpCall("-", [a0, y]), z]));
    }

    if (op === "-" && n === 1 && sub0 !== null && sub0.args.length === 2) {
      const [x, y] = sub0.args;
      switch (sub0.op) {
        // -(x-y) -> -x+y
        case "-": {
          const minusX = env.fExpr(env, OpCall("-", [x]));
          return env.fExpr(env, OpCall("+", [minusX, y]));
        }
        // -(x+y) -> -x-y
        case "+": {
          const minusX = env.fExpr(env, OpCall("-", [x]));
          return env.fExpr(env, OpCall("-", [minusX, y]));
        }
        // -(x*y) -> -x*y
        case "*": {
          const minusX = env.fExpr(env, OpCall("-", [x]));
          return env.fExpr(env, OpCall("*", [minusX, y]));
        }
        // -(x/y) -> -x/y
        case "/": {
          const minusX = env.fExpr(env, OpCall("-", [x]));
          return env.fExpr(env, OpCall("/", [minusX, y]));
        }
      }
    }

    // a=a;  ->  a
    if (op === "=" && n === 2 && a0.kind === "Var" && a1.kind === "Var" && a0.ident.name === a1.ident.name) return a1;
    // x=x+...  ->  x+=...
    if (op === "=" && n === 2 && a0.kind === "Var" && sub1 !== null && sub1.args.length === 2 && sub1.args[0].kind === "Var" &&
      a0.ident.name === sub1.args[0].ident.name && Builtin.augmentableOperators.has(sub1.op)) {
      return OpCall(sub1.op + "=", [a0, sub1.args[1]]);
    }

    // x=...+x  ->  x+=...
    // Works only if the operator is commutative. * is not commutative with vectors and matrices.
    if (op === "=" && n === 2 && sub1 !== null && sub1.args.length === 2 && sub1.args[1].kind === "Var" &&
      ["+", "*", "&", "^", "|"].includes(sub1.op)) {
      const r = resolvedVariableUse(a0);
      if (r !== null) {
        const [v, vd] = r;
        if (v.name === sub1.args[1].ident.name
          && (sub1.op !== "*" || typeIsScalar(vd.ty))) { // * is commutative when at least one operand is scalar
          return OpCall(sub1.op + "=", [Var(v), sub1.args[0]]);
        }
      }
    }

    // Unsafe when x contains NaN or Inf values.
    //| FunCall(Op "=", [Var x; FunCall(Var fctName, [Int (0, _)])])
    //    when List.contains fctName.Name ["vec2"; "vec3"; "vec4"; "ivec2"; "ivec3"; "ivec4"] ->
    //    FunCall(Op "-=", [Var x; Var x]) // x=vec3(0);  ->  x-=x;
    return e;
  }

  // Simplify calls to the vec constructor.
  private simplifyVec(constr: IdentT, args: Expr[]): Expr {
    const lastChar = constr.name[constr.name.length - 1];
    const vecSize = /^[0-9]$/.test(lastChar ?? "") ? parseInt(lastChar, 10) : 0;

    // Combine swizzles, e.g.
    //    vec4(v1.x, v1.z, v2.r, v2.t)  =>  vec4(v1.xz, v2.xy)
    const combineSwizzles = (list: Expr[]): Expr[] => {
      if (list.length === 0) return [];
      const [d1, d2] = list;
      if (list.length >= 2 && d1.kind === "Dot" && d1.expr.kind === "Var" && d2.kind === "Dot" && d2.expr.kind === "Var" &&
        this.isSwizzle(d1.expr, d1.field.name) && this.isSwizzle(d2.expr, d2.field.name) && d1.expr.ident.name === d2.expr.ident.name) {
        return combineSwizzles([Dot(Var(d1.expr.ident), new Ident(d1.field.name + d2.field.name, d1.field.loc)), ...list.slice(2)]);
      }
      return [d1, ...combineSwizzles(list.slice(1))];
    };

    // vec2(1.0, 2.0)  =>  vec2(1, 2)
    // According to the spec, this is safe:
    // "If the basic type (bool, int, float, or double) of a parameter to a constructor does not match the
    // basic type of the object being constructed, the scalar construction rules (above) are used to convert
    // the parameters."
    const useInts = (e: Expr): Expr => {
      if (e.kind === "Float" && this.optimizationPass === OptimizationPass.Second // only do this after other transforms that can apply only to floats.
        && Number.isInteger(e.value)) {
        // the conversion to int might fail (especially on 32-bit)
        if (e.value < -2147483648 || e.value > 2147483647) return e;
        const candidate = Int(e.value, "");
        if (Printer.exprToS(candidate).length <= Printer.exprToS(e).length) return candidate;
        return e;
      }
      return e;
    };

    // vec3(1,1,1)  =>  vec3(1)
    // For safety, do not merge if there are function calls, e.g. vec2(rand(), rand()).
    // Iterate over the args as long as the arguments are equal.
    const mergeAllEquals = (allArgs: Expr[], list: Expr[]): Expr[] => {
      if (list.length >= 1 && list[0].kind === "FunCall") return allArgs;
      if (list.length >= 2 && Printer.exprToS(list[0]) === Printer.exprToS(list[1])) return mergeAllEquals(allArgs, list.slice(1));
      if (list.length === 1) return [list[0]];
      return allArgs;
    };

    // vec3(a.x, b.xy) => vec3(a.x, b)
    const dropLastSwizzle = (n: number, list: Expr[]): Expr[] => {
      if (list.length === 1 && list[0].kind === "Dot" && this.isSwizzle(list[0].expr, list[0].field.name)) {
        const last = list[0];
        const idx = [...last.field.name].map(Builtin.swizzleIndex).join(",");
        if (idx === "0" && n === 1) return [last.expr];
        if (idx === "0,1" || idx === "0,1,2" || idx === "0,1,2,3") return [last.expr];
        return [last];
      }
      if (list.length >= 1) return [list[0], ...dropLastSwizzle(n - 1, list.slice(1))];
      return list;
    };

    let newArgs = combineSwizzles(args).map(useInts);
    newArgs = newArgs.length === vecSize ? mergeAllEquals(newArgs, newArgs) : newArgs;
    newArgs = dropLastSwizzle(vecSize, newArgs);
    return FunCall(Var(constr), newArgs);
  }

  private simplifyVecDot(vecName: string, args: Expr[], field: string, e: Expr): Expr {
    const vecSize = parseInt(vecName[vecName.length - 1], 10);
    if (!(
      args.every(Effects.isPure) && // check that arguments can be reordered
      args.length === vecSize // check that the Nth swizzle index maps to the Nth arg
    )) return e;
    if (!Builtin.isFieldSwizzle(field)) return e;
    const indexes = [...field].map(Builtin.swizzleIndex);
    switch (indexes.length) {
      case 1: { // vec3(a,b,c).y  ->  b
        const arg = indexes[0] < args.length ? args[indexes[0]] : undefined;
        if (arg !== undefined && isKnownToHaveTypeFloat(arg)) return arg;
        return e;
      }
      case 2: case 3: case 4: { // vec3(a,b,c).yx  ->  vec2(b,a)
        // find whether the repeated fields are repeatable exprs (don't repeat function calls or long exprs)
        const counts = new Map<number, number>();
        for (const i of indexes) counts.set(i, (counts.get(i) ?? 0) + 1);
        const repeatedIndexes = [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
        const isRepeatableExpr = (x: Expr): boolean => x.kind === "Var" || x.kind === "Int" || x.kind === "Float";
        if (indexes.some((i) => i >= args.length)) return e;
        if (repeatedIndexes.every((index) => isRepeatableExpr(args[index]))) {
          const constructor = new Ident("vec" + indexes.length);
          return FunCall(Var(constructor), indexes.map((index) => args[index]));
        }
        return e;
      }
      default: return e;
    }
  }

  private isFuncDeclarationToInline(fn: IdentT): boolean {
    const d = fn.declaration;
    return d.kind === "UserFunction" ? d.decl.funcType.fName.toBeInlined : false;
  }

  simplifyExpr = (didInline: { value: boolean }) => (env: MapEnv, e: Expr): Expr => {
    if (e.kind === "FunCall" && e.fn.kind === "Var" && this.isFuncDeclarationToInline(e.fn.ident)) {
      const v = e.fn.ident;
      const passedArgs = e.args;
      const found = env.fns.get(prototypeKey(v.name, passedArgs.length));
      if (found === undefined) throw new Error(`Cannot inline function ${v.name} because it's a builtin`);
      if (found.length !== 1) throw new Error(`Cannot inline function ${v.name} because type-based disambiguation of user-defined function overloading is not supported`);
      const [{ args: declArgs }, body] = found[0];
      if (declArgs.length !== passedArgs.length) {
        throw new Error(`Cannot inline function ${v.name} since it doesn't have the right number of arguments`);
      }
      const stmts = asStmtList(body);
      if (stmts.length === 1 && stmts[0].kind === "Jump" && stmts[0].keyword === "return" && stmts[0].expr !== null) {
        didInline.value = true;
        return this.inlineFn(declArgs, passedArgs, stmts[0].expr);
      }
      // Don't yell if we've done some inlining this pass -- maybe it
      // turned the function into a one-liner, so allow trying again on
      // the next pass. (If it didn't, we'll yell next pass.)
      if (didInline.value) return e;
      throw new Error(`Cannot inline function ${v.name} since it consists of more than a single return`);
    }

    if (e.kind === "FunCall" && e.fn.kind === "Op") return this.simplifyOperator(env, e);

    if (this.options.foldBuiltins && e.kind === "FunCall" && e.fn.kind === "Var" && e.fn.ident.declaration.kind === "BuiltinFunction") {
      const folded = foldBuiltinCall(e);
      if (folded !== null) return folded;
    }

    if (e.kind === "FunCall" && e.fn.kind === "Var" && e.args.length === 2 && e.fn.ident.name === "distance") {
      const len = new Ident("length", e.fn.ident.loc);
      return FunCall(Var(len), [OpCall("-", [e.args[0], e.args[1]])]);
    }

    const isVecConstr = (name: string): boolean => name === "vec2" || name === "vec3" || name === "vec4";
    if (e.kind === "FunCall" && e.fn.kind === "Var" && isVecConstr(e.fn.ident.name)) {
      return this.simplifyVec(e.fn.ident, e.args);
    }

    if (e.kind === "Dot" && e.expr.kind === "FunCall" && e.expr.fn.kind === "Var" && isVecConstr(e.expr.fn.ident.name)) {
      const r = this.simplifyVecDot(e.expr.fn.ident.name, e.expr.args, e.field.name, e);
      if (r.kind === "Dot" && this.options.canonicalFieldNames !== "") {
        return Dot(r.expr, new Ident(renameField(this.options, r.field.name), r.field.loc));
      }
      return r;
    }
    if (e.kind === "Dot" && this.options.canonicalFieldNames !== "" && this.isSwizzle(e.expr, e.field.name)) {
      return Dot(e.expr, new Ident(renameField(this.options, e.field.name), e.field.loc));
    }

    const rvu = resolvedVariableUse(e);
    if (rvu !== null && rvu[1].decl.name.toBeInlined) {
      // Replace uses of inlined variables.
      const init = rvu[1].decl.init;
      if (init !== null) {
        didInline.value = true;
        return env.mapExpr(init);
      }
      return e;
    }

    if (e.kind === "FunCall" && e.fn.kind === "Var" && e.args.length === 2 && e.fn.ident.name === "pow" && this.numberOf(e.args[1]) === 1) {
      return e.args[0]; // pow(x, 1.)  ->  x
    }

    if (e.kind === "FunCall" && e.args.length === 0 && e.fn.kind === "Dot" && e.fn.expr.kind === "Var" && e.fn.field.name === "length") {
      const vd = e.fn.expr.ident.varDecl;
      if (vd !== null) {
        const sizes = vd.ty.arraySizes;
        if (sizes.length === 1 && sizes[0].kind === "Int") return sizes[0];
      }
      return e;
    }

    // pi is acos(-1), pi/2 is acos(0)
    if (e.kind === "Float" && !this.options.noPiSubstitution) {
      const r = decimalRound8(e.value);
      if (r === 3.14159265) return FunCall(Var(new Ident("acos")), [Float(-1, "")]);
      if (r === 6.28318531) return OpCall("*", [Float(2, ""), FunCall(Var(new Ident("acos")), [Float(-1, "")])]);
      if (r === 1.57079633) return FunCall(Var(new Ident("acos")), [Float(0, "")]);
    }

    return e;
  };

  // Group declarations within a block. For example, all the float variables will
  // be declared at the same time, the first time a float variable is initialized.
  // Const variables are ignored, because they must be initialized immediately.
  private groupDeclarations(stmts: Stmt[]): Stmt[] {
    const declarations: [Type, DeclElt[]][] = [];
    const findDecl = (ty: Type): [Type, DeclElt[]] | undefined => declarations.find(([t]) => typeEquals(t, ty));
    const skippedDeclarations: Stmt[] = [];
    // The names used by the statements before the one being looked at, accumulated as we go
    // rather than rescanned from the top of the block for every declaration that could move.
    const usedBefore = new Set<string>();
    for (const [index, stmt] of stmts.entries()) {
      if (index > 0) for (const i of new Analyzer(this.options).identUsesInStmt(IdentKind.Var, stmts[index - 1])) usedBefore.add(i.name);
      if (stmt.kind === "Decl" && !stmt.decl[0].typeQ.includes("const")) {
        const [ty, li] = stmt.decl;
        const existing = findDecl(ty);
        if (existing === undefined) {
          // First time this type is encountered, we store it to merge others decl in it later.
          declarations.push([ty, li]);
        } else {
          // Moving a declaration that shadows a variable used in its initialization can be incorrect. See #458.
          // Nor can it move above an earlier use of its name in the block, which refers to an outer variable
          // (not in upstream: `vec2 t` global, `... t.xy ...; float t=0.;` in a block).
          const shadowingPreventsTheMove = li.some((d) =>
            (d.init !== null && new Analyzer(this.options).identUsesInStmt(IdentKind.Var, ExprStmt(d.init)).some((i) => i.name === d.name.name)) ||
            usedBefore.has(d.name.name));
          if (shadowingPreventsTheMove) {
            skippedDeclarations.push(stmt);
          } else {
            // Remove the init of the new items; we'll use an assignment instead.
            const newLi = li.map((decl) => ({ ...decl, init: null }));
            existing[1] = [...existing[1], ...newLi];
            for (const d of newLi) {
              trace(this.options, `${locToS(d.name.loc)}: --move-declarations of '${Printer.debugDecl(d)}' to the line of '${Printer.debugDecl(existing[1][0])}'`);
            }
          }
        }
      }
    }
    const replacements = (s: Stmt): Stmt[] => {
      if (s.kind === "Decl") {
        const [ty, li] = s.decl;
        if (ty.typeQ.includes("const")) return [s];
        const existing = findDecl(ty);
        if (existing !== undefined) {
          // Insert all declarations.
          declarations.splice(declarations.indexOf(existing), 1);
          return [DeclStmt([ty, existing[1]])];
        }
        if (!skippedDeclarations.includes(s)) {
          // Replace the declarations (they were already inserted) with assignments.
          return li.flatMap((d) => (d.init !== null ? [ExprStmt(OpCall("=", [Var(d.name), d.init]))] : []));
        }
      }
      return [s];
    };
    return stmts.flatMap(replacements);
  }

  // GLSL allows squeezing array declarations of different dimensions: `float a[4], b[7];`.
  private declsCanBeSqueezed([ty1, li1]: Decl, [ty2, li2]: Decl): boolean {
    // Helper for determining if all array dimensions in two declaration lists are equal.
    const allSizesEqual = (l1: DeclElt[], l2: DeclElt[]): boolean => {
      const all = [...l1, ...l2];
      if (all.length === 0) return true;
      const sizes = all[0].sizes;
      return all.slice(1).every((decl) => exprListEquals(decl.sizes, sizes));
    };
    return typeEquals(ty1, ty2);
  }

  // Squeeze declarations: "float a=2.; float b;"  ->  "float a=2.,b;"
  private squeezeConsecutiveDeclarations(stmts: Stmt[]): Stmt[] {
    const out: Stmt[] = [];
    let i = 0;
    while (i < stmts.length) {
      let cur = stmts[i];
      i++;
      while (cur.kind === "Decl" && i < stmts.length) {
        const next = stmts[i];
        if (next.kind === "Decl" && this.declsCanBeSqueezed(cur.decl, next.decl)) {
          cur = DeclStmt([cur.decl[0], [...cur.decl[1], ...next.decl[1]]]);
          i++;
        } else break;
      }
      out.push(cur);
    }
    return out;
  }

  // Squeeze top-level declarations, e.g. uniforms
  private squeezeTLDeclarations(tls: TopLevel[]): TopLevel[] {
    const out: TopLevel[] = [];
    let i = 0;
    while (i < tls.length) {
      let cur = tls[i];
      i++;
      while (cur.kind === "TLDecl" && i < tls.length) {
        const next = tls[i];
        if (next.kind === "TLDecl" && this.declsCanBeSqueezed(cur.decl, next.decl)) {
          cur = TLDecl([cur.decl[0], [...cur.decl[1], ...next.decl[1]]]);
          i++;
        } else break;
      }
      out.push(cur);
    }
    return out;
  }

  private rwType(ty: Type): Type {
    return makeType(ty.name, ty.typeQ.map((q) => this.stripSpaces(q)), ty.arraySizes);
  }

  private rwFType(fct: FunctionType): FunctionType {
    // The default for function parameters is "in", we don't need it.
    const rwFTypeType = (ty: Type): Type => ({ ...ty, typeQ: ty.typeQ.filter((q) => q !== "in") });
    const rwFDecl = ([ty, elts]: Decl): Decl => [rwFTypeType(ty), elts];
    return { ...fct, args: fct.args.map(rwFDecl) };
  }

  private squeezeBlockWithComma(stmt: Stmt): Stmt {
    if (stmt.kind === "Block" && !this.options.noSequence) {
      const b = stmt.stmts;
      const canOptimize = b.every((s) => s.kind === "Expr" || (s.kind === "Jump" && s.keyword === "return" && s.expr !== null));
      // Try to remove blocks by using the comma operator
      if (canOptimize) {
        const li = b.flatMap((s) => (s.kind === "Expr" ? [s.expr] : []));
        if (this.voidSequenceForbidden && li.some((e) => this.hasVoidOperand(e))) return stmt;
        const returnStmt = b.find((s) => s.kind === "Jump" && s.keyword === "return");
        const returnExp = returnStmt !== undefined && returnStmt.kind === "Jump" ? returnStmt.expr : null;
        if (returnExp === null) {
          if (li.length === 0) return Block([]);
          return ExprStmt(li.reduce((acc, x) => OpCall(",", [acc, x])));
        }
        const expr = [...li, returnExp].reduce((acc, x) => OpCall(",", [acc, x]));
        return Jump("return", expr);
      }
      return stmt;
    }
    return stmt;
  }

  private hasNoDecl(stmts: Stmt[]): boolean { return stmts.every((s) => s.kind !== "Decl"); }

  private hasNoContinue(stmts: Stmt[]): boolean {
    return stmts.every((s) => {
      switch (s.kind) {
        case "Jump": return s.keyword !== "continue";
        case "If": return this.hasNoContinue([s.then]) && this.hasNoContinue(s.else === null ? [] : [s.else]);
        case "Switch": return s.cases.every((c) => this.hasNoContinue(c.stmts));
        case "Block": return this.hasNoContinue(s.stmts);
        // No need to search in nested for loops, because their continue wouldn't apply to this level.
        default: return true;
      }
    });
  }

  private removeUnusedAssignments(blockLevel: BlockLevel, blockStmts: Stmt[]): Stmt[] {
    // Control flow analysis (loop, if, switch, break, continue, return, and ternary ops) on an AST is hard.
    // Check that the visit order of the ast strictly matches the execution order.
    const isSingleFlow = (stmts: Stmt[]): boolean => {
      const stmtsAreSingleFlow = (ss: Stmt[]): boolean => ss.every((s) => {
        switch (s.kind) {
          case "Expr": return true;
          case "Decl": return true;
          case "Jump": return true;
          case "Block": return stmtsAreSingleFlow(s.stmts);
          case "If": return false;
          case "ForD": return false;
          case "ForE": return false;
          case "While": return false;
          case "DoWhile": return false;
          case "Verbatim": return false;
          case "Directive": return false;
          case "Switch": return false;
        }
      });
      const exprsAreSingleFlow = (ss: Stmt[]): boolean => {
        let anyTernaryOp = false;
        const findTernary = (_env: MapEnv, e: Expr): Expr => {
          const opCall = asOpCall(e);
          if (opCall !== null && opCall.op === "?:") anyTernaryOp = true;
          return e;
        };
        Ast.visitor(this.options, findTernary).iterStmt(blockLevel, Block(ss));
        return !anyTernaryOp;
      };
      return stmtsAreSingleFlow(stmts) && exprsAreSingleFlow(stmts);
    };

    // Assignments to parameters are only removed if is the entire function body is single-flow.
    // A pinned variable may be read by a kept #define, which the visit cannot see: never a candidate.
    const parameterCandidates: DeclElt[] =
      blockLevel.kind === "FunctionRoot" && isSingleFlow(blockStmts) ? funParameters(blockLevel.fn).map(([, d]) => d).filter((d) => !d.name.hiddenUses) : [];
    // Assignments to locals are only removed if they are declared in a Block (not a ForD) that is single-flow (starting from the declaration).
    const localCandidates: [DeclElt[], Stmt[]][] = [];
    for (let i = 0; i < blockStmts.length; i++) {
      const head = blockStmts[i];
      if (head.kind === "Decl") {
        const stmts = blockStmts.slice(i);
        if (isSingleFlow(stmts)) localCandidates.push([head.decl[1].filter((d) => !d.name.hiddenUses), stmts]);
      }
    }
    // Assignments to globals are not removed (it requires analysis over every called function).

    const identsReferToSameVar = (v1: IdentT, v2: IdentT): boolean => {
      const d1 = v1.declaration;
      const d2 = v2.declaration;
      if (d1.kind === "Variable" && d2.kind === "Variable") return d1.decl.decl.name === d2.decl.decl.name;
      return false;
    };
    const findAssignmentsToRemove = (vars: DeclElt[], stmts: Stmt[]): IdentT[] => {
      if (vars.length === 0) {
        return []; // skip the entire search
      }
      // Assignments are represented by their variable's Ident instance.
      let alwaysOverwrittenAssignments: IdentT[] = [];
      let candidates: IdentT[] = []; // Previously seen assignments that are unused so far.
      const idents = vars.map((de) => de.name);
      const traceReadsAndWrites = false;
      const visitVar = (varUse: VarUse, v: IdentT, vd: VarDecl): void => {
        if (idents.some((i) => identsReferToSameVar(vd.decl.name, i))) {
          if (traceReadsAndWrites) trace(this.options, `    ${varUse} of ${v.name} at ${locToS(v.loc)}`);

          // Reads always occur before writes (e.g. inout).
          if (varUse.access.isRead) {
            // This variable is read: its latest assignment is not unused. Remove it from the candidates.
            const lastAssignmentToVar = candidates.find((c) => identsReferToSameVar(v, c));
            if (lastAssignmentToVar !== undefined) {
              candidates = candidates.filter((c) => c.name !== lastAssignmentToVar.name);
            }
          }

          // Note that partial writes (to a field) don't let us remove previous assignments.
          if (varUse.access.isWrite && !varUse.isPartialAccess) {
            // Accept current assignment candidate, as it reached unconditional overwrite without encountering a read.
            const lastAssignmentToVar = candidates.find((c) => identsReferToSameVar(v, c));
            if (lastAssignmentToVar !== undefined) {
              candidates = candidates.filter((c) => c.name !== lastAssignmentToVar.name);
              trace(this.options, `${locToS(v.loc)}: found unused assignment to '${v.name}' (unconditionally overwritten)`);
              alwaysOverwrittenAssignments = [lastAssignmentToVar, ...alwaysOverwrittenAssignments];
            }
          }

          if (varUse.access.isWrite) {
            // Set current write as the new current assignment candidate for removal.
            candidates = [v, ...candidates];
          }
        }
      };

      if (traceReadsAndWrites) trace(this.options, "findAssignmentsToRemove: going through reads and writes:");
      new VarVisitor(visitVar).visitStmt(Block(stmts));

      // Current removal candidates reached end of scope without encountering a read.
      // This might mean they're unused, but only if they're not out/inout parameters.
      const assignmentsUnusedUntilEndOfScope = candidates.filter((v) => {
        const d = v.declaration;
        return d.kind === "Variable" ? !typeIsOutOrInout(d.decl.ty) : true;
      });
      for (const ident of assignmentsUnusedUntilEndOfScope) {
        trace(this.options, `${locToS(ident.loc)}: found unused assignment to '${ident.name}' (last use is a write)`);
      }

      // An assignment is unused if it is not followed by a read
      // either until it's unconditionally overwritten or until it reaches end of scope.
      return [...assignmentsUnusedUntilEndOfScope, ...alwaysOverwrittenAssignments];
      // Note: here we return unused "out"-written arguments in addition to unused assignments. They'll be ignored.
    };

    const parametersToRemove = findAssignmentsToRemove(parameterCandidates, blockStmts);
    const localsToRemove = localCandidates.flatMap(([declElts, stmts]) => findAssignmentsToRemove(declElts, stmts));

    // Rewrite the AST without the assignments.
    const toRemove = [...parametersToRemove, ...localsToRemove];
    const isAssignmentToRemove = (v: IdentT): boolean => toRemove.some((x) => x === v);
    const removeAssignments = (_env: MapEnv, e: Expr): Expr => {
      // Augmented assignments are removed simply by preserving the augmented operator:  `a=(b+=4);b=9;`  ->  `a=(b+4);b=9;`
      const a = this.asAssignment(e);
      if (a !== null && isAssignmentToRemove(a.name)) return a.expr;
      return e;
    };
    const removeAssignmentsToDecl = (_env: MapEnv, s: Stmt): Stmt => {
      if (s.kind === "Decl") {
        const [ty, ds] = s.decl;
        const newDs = ds.map((d) => {
          // If there are side effects in the init, they must remain.
          if (isAssignmentToRemove(d.name) && d.init !== null && Effects.isPure(d.init)) return { ...d, init: null };
          return d;
        });
        return DeclStmt([ty, newDs]);
      }
      return s;
    };
    const [, block] = Ast.visitor(this.options, removeAssignments, removeAssignmentsToDecl).mapStmt(blockLevel, Block(blockStmts));
    return asStmtList(block);
  }

  // Reuse an existing local variable declaration that won't be used anymore, instead of introducing a new one.
  // The reused identifier gets compressed better, and the declaration is sometimes removed.
  // float d1 = f(); float d2 = g();  ->  float d1 = f(); d1 = g();
  // We only do this when the reused declaration is at the same level as the removed declaration.
  private reuseExistingVarDecl(blockLevel: BlockLevel, b: Stmt[]): Stmt[] {
    const tryReplaceWithPrecedingAndFollowing = (f: (preceding: Stmt[], head: Stmt, tail: Stmt[]) => Stmt[] | null, xs: Stmt[]): Stmt[] => {
      const out: Stmt[] = [];
      let preceding: Stmt[] = [];
      for (let i = 0; i < xs.length; i++) {
        const head = xs[i];
        const tail = xs.slice(i + 1);
        const r = f(preceding, head, tail);
        if (r !== null) return [...out, ...r, ...tail];
        out.push(head);
        preceding = [head, ...preceding]; // preceding is reversed, that's good
      }
      return out;
    };
    return tryReplaceWithPrecedingAndFollowing((preceding2, head, following2) => {
      if (head.kind !== "Decl") return null;
      const [ty2, declElts] = head.decl;
      const findAssignmentReplacementFor = (declElt2: DeclElt, declBefore2: Stmt[], declAfter2: Stmt[]): Stmt[] | null => {
        // Collect previous declarations of the same type.
        const localDecls = [...preceding2, ...declBefore2].flatMap((s) =>
          s.kind === "Decl" && typeEquals(ty2, s.decl[0]) && !typeIsConst(s.decl[0]) ? s.decl[1] : []);
        const args: DeclElt[] =
          blockLevel.kind === "FunctionRoot"
            ? funParameters(blockLevel.fn).flatMap(([ty, decl]) => (!typeIsOutOrInout(ty) && typeEquals(ty, ty2) ? [decl] : []))
            : [];

        if (declElt2.name.hiddenUses) return null; // a kept #define may read it under that name
        const compatibleDeclElt = [...localDecls, ...args].find((declElt1) =>
          !declElt1.name.hiddenUses &&
          exprListEquals(declElt1.sizes, declElt2.sizes) &&
          // The first variable must not be used after the second is declared.
          new Analyzer(this.options).identUsesInStmt(IdentKind.Var, Block([...declAfter2, ...following2])).every((i) => i.name !== declElt1.name.name));

        if (compatibleDeclElt === undefined) return null;
        const declElt1 = compatibleDeclElt;
        trace(this.options, `${locToS(declElt2.name.loc)}: eliminating local variable '${declElt2.name}' by reusing existing local variable '${declElt1.name}'`);
        for (const v of new Analyzer(this.options).identUsesInStmt(IdentKind.Var, Block([...declAfter2, ...following2]))) { // Rename all uses of var2 to use var1 instead.
          if (v.name === declElt2.name.name) { v.rename(declElt1.name.name); v.declaration = declElt1.name.declaration; }
        }
        if (declElt2.init !== null) {
          // A *copy* of the name, not the declaration's own Ident. An Ident is shared by every
          // location that refers to it, so putting the declaration's object in a use position
          // makes a later rename of that use rename the declaration too: a chain of reuses then
          // renames a variable out from under the statements that still read it, and the output
          // names something it never declares.
          const use = new Ident(declElt1.name.name, declElt2.name.loc);
          use.declaration = declElt1.name.declaration;
          return [ExprStmt(OpCall("=", [Var(use), declElt2.init]))];
        }
        return [];
      };
      // For a decl sandwiched between others, we could consider moving the assignment into a comma-expr of the init of the next decl, but this adds parentheses.
      if (declElts.length === 1) { // float d1=f(); ...; float d2=g();  ->  ...; d1=g();
        return findAssignmentReplacementFor(declElts[0], [], []); // Replace the Decl with the assignment. Largest win
      }
      if (declElts.length >= 2) { // float d1=f(); ...; float d2=g(),d3=h();  ->  ...; d1=g(); float d3=h();
        const [declElt2, ...others] = declElts;
        const restOfTheDecl = [DeclStmt([ty2, others])];
        const stmts = findAssignmentReplacementFor(declElt2, [], restOfTheDecl);
        if (stmts !== null) return [...stmts, ...restOfTheDecl]; // Keep the Decl, add an assignment before it.
        // float d1=f(); ...; float d3=h(),d2=g();  ->  ...; float d3=h(); d1=g();
        const last = declElts[declElts.length - 1];
        const restOfTheDecl2 = [DeclStmt([ty2, declElts.slice(0, -1)])];
        const stmts2 = findAssignmentReplacementFor(last, restOfTheDecl2, []);
        if (stmts2 !== null) return [...restOfTheDecl2, ...stmts2]; // Keep the Decl, add an assignment after it.
        return null;
      }
      return null;
    }, b);
  }

  private simplifyBlock(blockLevel: BlockLevel, stmts: Stmt[]): Stmt[] {
    let b = stmts;
    // Avoid some optimizations when there are preprocessor directives.
    const hasPreprocessor = b.some((s) => s.kind === "Verbatim" || s.kind === "Directive");

    // Remove dead code after return/break/...
    const endOfCode = b.findIndex((s) => s.kind === "Jump");
    if (endOfCode >= 0 && !hasPreprocessor) b = b.slice(0, endOfCode + 1);

    // Remove "empty" declarations of vars that were inlined. This is mandatory for correctness, not an optional optimization.
    b = b.filter((s) => !(s.kind === "Decl" && s.decl[1].length === 0));

    const countUsesOfIdentName = (expr: Expr, identName: string): number =>
      new Analyzer(this.options).identUsesInStmt(IdentKind.Var, ExprStmt(expr)).filter((i) => i.name === identName).length;

    const replaceUsesOfIdentByExpr = (expr: Expr, identName: string, replacement: Expr): Expr => {
      const visitAndReplace = (_env: MapEnv, e: Expr): Expr => (e.kind === "Var" && e.ident.name === identName ? replacement : e);
      return Ast.visitor(this.options, visitAndReplace).mapExpr(expr);
    };

    // Merge two consecutive items into one, everywhere possible in a list.
    const squeeze = (f: (h1: Stmt, h2: Stmt) => Stmt[] | null, list: Stmt[]): Stmt[] => {
      const out: Stmt[] = [];
      let rest = list;
      while (rest.length >= 2) {
        const xs = f(rest[0], rest[1]);
        if (xs !== null) rest = [...xs, ...rest.slice(2)];
        else {
          out.push(rest[0]);
          rest = rest.slice(1);
        }
      }
      return [...out, ...rest];
    };
    b = squeeze((s1, s2) => {
      // Merge preceding expression into a for's init.
      if (s1.kind === "Expr" && s2.kind === "ForE" && s2.init === null) { // a=0;for(;i<5;++i);  ->  for(a=0;i<5;++i);
        return [ForE(s1.expr, s2.cond, s2.inc, s2.body)];
      }
      if (s1.kind === "Expr" && s2.kind === "While") { // a=0;while(i<5);  ->  for(a=0;i<5;);
        return [ForE(s1.expr, s2.cond, null, s2.body)];
      }
      if (s1.kind === "Decl" && s1.decl[1].length === 1 && s2.kind === "Jump" && s2.keyword === "return" && s2.expr !== null && s2.expr.kind === "Var") {
        const declElt = s1.decl[1][0]; // int x=f();return x;  ->  return f();
        if (s2.expr.ident.name === declElt.name.name && declElt.init !== null) {
          return [Jump("return", declElt.init)];
        }
      }
      if (s1.kind === "Expr" && s2.kind === "Jump" && s2.keyword === "return" && s2.expr !== null) {
        const a = this.asAssignment(s1.expr);
        const r = resolvedVariableUse(s2.expr); // x=f();return x;  ->  return f();
        if (a !== null && a.target === null && r !== null) {
          const [v2, vd] = r;
          if (a.name.name === v2.name && vd.scope !== "Global" && !typeIsOutOrInout(vd.ty)) {
            return [Jump("return", a.expr)];
          }
        }
      }
      // assignment to a local immediately followed by re-assignment
      if (s1.kind === "Expr" && s2.kind === "Expr") {
        const a1 = this.asAssignment(s1.expr);
        const a2 = this.asAssignment(s2.expr);
        if (a1 !== null && a1.target === null && a2 !== null && a2.target === null && a1.name.name === a2.name.name) {
          const name = a1.name;
          const init1 = a1.expr;
          const init2 = a2.expr;
          const d = name.declaration;
          if (d.kind === "Variable" && d.decl.scope === "Global") {
            // The assignment should not be removed if init2 calls a function that reads the global variable.
            return null; // Safely assume it could happen.
          }
          if (d.kind === "Variable") {
            const count = countUsesOfIdentName(init2, name.name);
            // Remove unused assignment immediately followed by re-assignment:  m=14.;m=58.;  ->  14.;m=58.;
            if (count === 0) return [ExprStmt(init1), s2]; // Transform is safe even if the var is an out parameter.
            // Inline this single use of a used-once assignment into the immediately following re-assignment:  m=14.;m=58.-m;  ->  m=58.-14.;
            if (count === 1 && Effects.isPure(init1) && Effects.isPure(init2)) { // This is ok only if init1 is pure and the part of init2 before using m is pure.
              const newInit2 = replaceUsesOfIdentByExpr(init2, name.name, init1);
              trace(this.options, `${locToS(name.loc)}: merge consecutive pure assignments to the same local '${name}'`);
              return [ExprStmt(OpCall("=", [Var(a2.name), newInit2]))];
            }
            return null;
          }
          return null;
        }
      }
      // declaration immediately followed by re-assignment
      if (s1.kind === "Decl" && s1.decl[1].length === 1 && s2.kind === "Expr") {
        const [ty, [declElt]] = s1.decl;
        const a2 = this.asAssignment(s2.expr);
        if (a2 !== null && a2.target === null && declElt.name.name === a2.name.name) {
          const init2 = a2.expr;
          const count = countUsesOfIdentName(init2, declElt.name.name);
          if (count === 0) {
            const es = declElt.init === null ? [] : Effects.sideEffects(declElt.init);
            // float m=14;m=58.;  ->  float m=58.;
            if (es.length === 0) return [DeclStmt([ty, [{ ...declElt, init: init2 }]])];
            // float m=f();m=58.;  ->  float m=(f(),58.);
            if (this.voidSequenceForbidden && es.some((e) => this.hasVoidOperand(e))) return null;
            return [DeclStmt([ty, [{ ...declElt, init: commaSeparatedExprs([...es, init2]) }]])];
          }
          if (count === 1 && (declElt.init === null || Effects.isPure(declElt.init)) && Effects.isPure(init2)) {
            if (declElt.init === null) return null; // can't replace  float a;a=f(a);  by  float a=f(a);
            const init1 = declElt.init; // float m=14.;m=58.-m;  ->  float m=58.-14.;
            trace(this.options, `${locToS(declElt.name.loc)}: merge assignment with preceding local declaration '${Printer.debugDecl(declElt)}'`);
            const newInit = replaceUsesOfIdentByExpr(init2, declElt.name.name, init1);
            return [DeclStmt([ty, [{ ...declElt, init: newInit }]])];
          }
          return null;
        }
      }
      return null;
    }, b);

    // Reduces impure expression statements to their side effects.
    b = b.flatMap((s) => {
      if (s.kind === "Expr") {
        const sideEffects = Effects.sideEffects(s.expr);
        if (sideEffects.length === 0) return []; // Remove pure statements.
        if (sideEffects.length === 1) return [ExprStmt(sideEffects[0])];
        if (this.voidSequenceForbidden && sideEffects.some((e) => this.hasVoidOperand(e))) return sideEffects.map(ExprStmt);
        return [ExprStmt(commaSeparatedExprs(sideEffects))];
      }
      return [s];
    });

    // Inline inner decl-less blocks. (Presence of decl could lead to redefinitions.)  a();{b();}c();  ->  a();b();c();
    b = b.flatMap((s) => (s.kind === "Block" && this.hasNoDecl(s.stmts) ? s.stmts : [s]));

    // Remove useless else after an if that returns.
    // if(c)return a();else b();  ->  if(c)return a();b();
    const endsWithReturn = (s: Stmt): boolean => {
      if (s.kind === "Jump" && s.keyword === "return") return true;
      if (s.kind === "Block" && s.stmts.length > 0) return endsWithReturn(s.stmts[s.stmts.length - 1]);
      return false;
    };
    const removeUselessElseAfterReturn = (list: Stmt[]): Stmt[] => list.flatMap((s) => {
      if (s.kind === "If" && s.else !== null && endsWithReturn(s.then)) {
        const bodyF = s.else;
        let tail: Stmt[];
        if (bodyF.kind === "Block" && this.hasNoDecl(bodyF.stmts)) tail = bodyF.stmts; // inline inner empty blocks without variable
        else if (bodyF.kind === "Decl") tail = [Block([bodyF])]; // a decl must stay isolated in a block, for the same reason
        else tail = [bodyF];
        return [If(s.cond, s.then, null), ...tail];
      }
      return [s];
    });
    b = removeUselessElseAfterReturn(b);

    // if(a)return b;return c;  ->  return a?b:c;
    const replaceIfReturnsWithReturnTernary = (list: Stmt[]): Stmt[] => {
      const out: Stmt[] = [];
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        const next = list[i + 1];
        if (s.kind === "If" && s.else === null && s.then.kind === "Jump" && s.then.keyword === "return" && s.then.expr !== null &&
          next !== undefined && next.kind === "Jump" && next.keyword === "return" && next.expr !== null &&
          !this.structTernaryForbidden(blockLevel, s.then.expr, next.expr)) {
          out.push(Jump("return", OpCall("?:", [s.cond, s.then.expr, next.expr])));
          return out;
        }
        out.push(s);
      }
      return out;
    };
    b = replaceIfReturnsWithReturnTernary(b);

    if (!(this.options.noRemoveUnused || hasPreprocessor)) b = this.removeUnusedAssignments(blockLevel, b);

    if (!(this.optimizationPass !== OptimizationPass.Second || hasPreprocessor)) b = this.reuseExistingVarDecl(blockLevel, b);

    // Consecutive declarations of the same type become one.  float a;float b;  ->  float a,b;
    b = this.squeezeConsecutiveDeclarations(b);

    // Group declarations, optionally (may compress poorly).  float a,f();float b=4.;  ->  float a,b;f();b=4.;
    b = hasPreprocessor || !this.options.moveDeclarations ? b : this.groupDeclarations(b);
    return b;
  }

  simplifyStmt = (env: MapEnv, stmt: Stmt): Stmt => {
    switch (stmt.kind) {
      case "Block": {
        if (stmt.stmts.length === 0) return stmt;
        const b = this.simplifyBlock(env.blockLevel, stmt.stmts);
        if (b.length === 1 && this.hasNoDecl(b)) return b[0];
        return Block(b);
      }
      case "Decl": return DeclStmt([this.rwType(stmt.decl[0]), this.declsNotToInline(stmt.decl[1])]);
      case "ForD": return ForD([this.rwType(stmt.init[0]), this.declsNotToInline(stmt.init[1])], stmt.cond, stmt.inc, this.squeezeBlockWithComma(stmt.body));
      case "ForE": return ForE(stmt.init, stmt.cond, stmt.inc, this.squeezeBlockWithComma(stmt.body));
      case "While": {
        const cond = stmt.cond;
        const body = stmt.body;
        if (body.kind === "Expr") return ForE(null, cond, body.expr, Block([])); // while(c)b();  ->  for(;c;b());
        if (body.kind === "Block") {
          const stmts = body.stmts;
          const last = stmts[stmts.length - 1];
          if (last !== undefined && last.kind === "Expr" && this.hasNoContinue(stmts) && this.hasNoDecl(stmts)) {
            // This rewrite is only valid if:
            // * continue is never used in this loop, and
            // * the last expression of the body does not use any Decl from the body.
            const rest = stmts.slice(0, -1);
            const block = rest.length === 1 ? rest[0] : Block(rest);
            return ForE(null, cond, last.expr, block); // while(c){a();b();}  ->  for(;c;b())a();
          }
          return ForE(null, cond, null, this.squeezeBlockWithComma(Block(stmts)));
        }
        return ForE(null, cond, null, this.squeezeBlockWithComma(body));
      }
      case "DoWhile": return DoWhile(stmt.cond, this.squeezeBlockWithComma(stmt.body));
      case "If": {
        const condBool = this.boolOf(stmt.cond);
        if (condBool === "True") return this.squeezeBlockWithComma(stmt.then);
        if (condBool === "False" && stmt.else !== null) return this.squeezeBlockWithComma(stmt.else);
        if (condBool === "False") return Block([]);
        const isEmptyBlock = (s: Stmt | null): boolean => s !== null && s.kind === "Block" && s.stmts.length === 0;
        if (isEmptyBlock(stmt.then) && stmt.else === null) return ExprStmt(stmt.cond); // if(c);  ->  c;
        if (isEmptyBlock(stmt.then) && isEmptyBlock(stmt.else)) return ExprStmt(stmt.cond); // if(c)else{};  ->  c;
        if (isEmptyBlock(stmt.else)) return If(stmt.cond, stmt.then, null); // "else{}"  ->  ""

        let cond = stmt.cond;
        let body1 = this.squeezeBlockWithComma(stmt.then);
        let body2 = stmt.else === null ? null : this.squeezeBlockWithComma(stmt.else);

        // if(!c)a();else b();  ->  if(c)b();else a();
        const notCall = asOpCall(cond);
        if (notCall !== null && notCall.op === "!" && notCall.args.length === 1 && body2 !== null) {
          const bodyT = body1;
          cond = notCall.args[0];
          body1 = body2;
          body2 = bodyT;
        }

        if (body1.kind === "Expr" && body2 !== null && body2.kind === "Expr") {
          const eT = body1.expr;
          const eF = body2.expr;
          const tryCollapseToAssignment = (e: Expr): [IdentT, Expr] | null => {
            const a = this.asAssignment(e);
            if (a !== null && a.target === null) return [a.name, a.expr];
            const opCall = asOpCall(e);
            if (opCall !== null && opCall.op === "," && opCall.args.length > 0) { // f(),c=d  ->  c=f(),d
              const list = opCall.args;
              const lastE = list[list.length - 1];
              const lastCall = asOpCall(lastE);
              if (lastCall !== null && lastCall.op === "=" && lastCall.args.length === 2 && lastCall.args[0].kind === "Var") {
                const mutableList = [...list];
                mutableList[mutableList.length - 1] = lastCall.args[1];
                return [lastCall.args[0].ident, OpCall(",", mutableList)];
              }
              return null;
            }
            return null;
          };
          const cT = tryCollapseToAssignment(eT);
          const cF = tryCollapseToAssignment(eF);
          // turn if-else of assignments into assignment of ternary
          if (cT !== null && cF !== null && cT[0].name === cF[0].name && !(this.options.webgl && this.mayBeStruct(Var(cT[0])))) {
            // if(c)x=y;else x=z;  ->  x=c?y:z;
            return ExprStmt(OpCall("=", [Var(cT[0]), OpCall("?:", [cond, cT[1], cF[1]])]));
          }
          // turn if-else of expressions into ternary statement
          // if(c)x();else y();  ->  c?x():y();
          // This transformation is not legal when x() and y() have different types.
          // Expr (FunCall(Op "?:", [cond; eT; eF]))
          return If(cond, body1, body2);
        }
        return If(cond, body1, body2);
      }
      case "Verbatim": return Verbatim(this.stripSpaces(stmt.text));
      case "Directive": return Directive(this.stripDirectiveSpaces(stmt.parts));
      default: return stmt;
    }
  };

  // Upstream removes unused functions and locals; engine shaders also carry globals, struct types
  // and sampler precision statements that the chunks they include never use (three.js's depth
  // pass keeps six packing constants, two light structs and seventeen `precision highp sampler*`).
  // A global that is never read or written and is not external or pinned, a struct type that is
  // never named, and a precision statement for a type that is never declared go. A global whose
  // initializer has an effect (desktop GLSL allows a call there) stays. Anything named in verbatim
  // text is kept, since that text cannot be read. --remove-unused-declarations; the plugin's default.
  static removeUnusedDeclarations(options: Options, code: TopLevel[], changed: { value: boolean } = { value: false }): TopLevel[] {
    const analyzer = new Analyzer(options);
    const used = new Set<string>();
    const usedTypes = new Set<string>();
    // Everything a declaration names: its type, the types inside it, and the variables its array
    // sizes and initializer read. An array size is a reference like any other (`float a[N];`).
    const exprVars = (e: Expr): void => { for (const i of analyzer.identUsesInStmt(IdentKind.Var, ExprStmt(e))) used.add(i.name); };
    const typeName = (ty: Type): void => {
      if (ty.name.kind === "TypeName") usedTypes.add(ty.name.ident.name); else members(ty.name.block);
      for (const s of ty.arraySizes) exprVars(s);
    };
    const declUses = (d: Decl): void => {
      typeName(d[0]);
      for (const elt of d[1]) { for (const s of elt.sizes) exprVars(s); if (elt.init !== null) exprVars(elt.init); }
    };
    const members = (block: StructOrInterfaceBlock): void => {
      for (const m of block.members) declUses(m.decl);
    };
    const verbatim: string[] = [];
    for (const tl of code) {
      switch (tl.kind) {
        case "Function":
          typeName(tl.funcType.retType);
          for (const a of tl.funcType.args) declUses(a);
          for (const i of analyzer.identUsesInStmt(IdentKind.Var | IdentKind.Type, tl.body)) used.add(i.name);
          break;
        case "TLDecl": declUses(tl.decl); break;
        case "TypeDecl": members(tl.block); break;
        case "TLVerbatim": verbatim.push(tl.text); break;
        default: break; // a name in a kept #define body is pinned by the parser, and pinned names are never removed
      }
    }
    const verbatimExpr = (_: MapEnv, e: Expr): Expr => { if (e.kind === "VerbatimExp") verbatim.push(e.text); return e; };
    const verbatimStmt = (_: MapEnv, s: Stmt): Stmt => { if (s.kind === "Verbatim") verbatim.push(s.text); return s; };
    Ast.visitor(options, verbatimExpr, verbatimStmt).iterTopLevel(code); // text inside function bodies too
    const inVerbatim = (name: string): boolean => verbatim.some((t) => new RegExp(`\\b${name}\\b`).test(t));
    const isUsed = (name: string): boolean => used.has(name) || usedTypes.has(name) || inVerbatim(name);
    let edited = false;
    const out: TopLevel[] = [];
    for (const tl of code) {
      if (tl.kind === "TLDecl" && !Ast.typeIsExternal(tl.decl[0])) {
        const kept = tl.decl[1].filter((d) => d.name.hiddenUses || isUsed(d.name.name) || (d.init !== null && !Effects.isPure(d.init)));
        if (kept.length !== tl.decl[1].length) {
          edited = true;
          trace(options, "removing unused globals: " + tl.decl[1].filter((d) => !kept.includes(d)).map((d) => d.name.name).join(", "));
          if (kept.length === 0) continue; // `Block{...};` with no instance name would declare its members as globals
          out.push(TLDecl([tl.decl[0], kept]));
          continue;
        }
      } else if (tl.kind === "TypeDecl" && tl.block.blockType.kind === "Struct" && tl.block.name !== null && !tl.block.name.hiddenUses && !isUsed(tl.block.name.name)) {
        edited = true;
        trace(options, "removing unused struct: " + tl.block.name.name);
        continue;
      } else if (tl.kind === "Precision" && tl.ty.name.kind === "TypeName" && Builtin.isSamplerType(tl.ty.name.ident.name) && !usedTypes.has(tl.ty.name.ident.name) && !inVerbatim(tl.ty.name.ident.name)) {
        edited = true;
        trace(options, "removing precision statement for unused type: " + tl.ty.name.ident.name);
        continue;
      }
      out.push(tl);
    }
    if (edited) changed.value = true;
    return edited ? RewriterImpl.removeUnusedDeclarations(options, out, changed) : out; // a struct may become unused once its only global went
  }

  // The prototypes called from a global declaration's initializers and array sizes. Desktop GLSL
  // allows `float g = f();`; upstream only counts calls from function bodies, and so removes f
  // as unused and moves g above f when squeezing declarations.
  static globalCalls(options: Options, tl: TopLevel): Set<string> {
    const calls = new Set<string>();
    if (tl.kind !== "TLDecl") return calls;
    const collect = (_: MapEnv, e: Expr): Expr => { if (e.kind === "FunCall" && e.fn.kind === "Var") calls.add(Ast.prototypeKey(e.fn.ident.name, e.args.length)); return e; };
    for (const d of tl.decl[1]) for (const e of [...d.sizes, ...(d.init === null ? [] : [d.init])]) Ast.visitor(options, collect).iterExpr(e);
    return calls;
  }

  static removeUnusedFunctions(options: Options, code: TopLevel[], changed: { value: boolean } = { value: false }): TopLevel[] {
    const funcInfos = new Analyzer(options).findFuncInfos(code);
    const globalCalls = new Set(code.flatMap((tl) => [...RewriterImpl.globalCalls(options, tl)]));
    const isUnused = (funcInfo: FuncInfo): boolean => {
      const canBeRenamed = !options.noRenamingList.includes(funcInfo.name) && !funcInfo.funcType.fName.hiddenUses; // noRenamingList includes "main"
      const proto = funPrototype(funcInfo.funcType);
      const isCalled = globalCalls.has(proto) || funcInfos.some((n) => n.callSites.some((c) => c.prototype === proto)); // when in doubt wrt overload resolution, keep the function.
      return canBeRenamed && !isCalled;
    };
    const unused = funcInfos.filter(isUnused);
    if (unused.length > 0) {
      trace(options, "removing unused functions: " + unused.map((fi) => Printer.debugFunc(fi.funcType)).join(", "));
    }
    const unusedSet = new Set(unused.map((fi) => fi.func));
    let edited = false;
    const newCode = code.filter((t) => {
      if (t.kind === "Function" && unusedSet.has(t)) {
        edited = true;
        return false;
      }
      return true;
    });
    if (edited) changed.value = true;
    return edited ? RewriterImpl.removeUnusedFunctions(options, newCode, changed) : newCode;
  }

  // Squeeze top-level declarations: `float a; float b;` -> `float a,b;`
  private reorderAndSqueezeTLDeclarations(tls: TopLevel[]): TopLevel[] {
    const splitWhile = (pred: (t: TopLevel) => boolean, list: TopLevel[]): [TopLevel[], TopLevel[]] => {
      let i = 0;
      while (i < list.length && pred(list[i])) i++;
      return [list.slice(0, i), list.slice(i)];
    };
    // Move declarations upwards, across other non-conflicting constructs,
    // to make larger sets of contiguous declarations.
    const canBeSwappedWithFollowingDeclaration = (t: TopLevel): boolean => {
      switch (t.kind) {
        case "Function": return true; // `void f(){} int n;` -> `int n; void f(){}`
        case "TLDecl": return false; // moving declarations among themselves requires init expr dependency analysis
        case "TLDirective": return false; // could be a #define used by the declaration after it
        case "TypeDecl": return false; // could be declaring the type used in a declaration after it
        case "Precision": return false; // a precision statement affects only declarations after it
        case "TLVerbatim": return false; // we don't know what this is. assume the worst
      }
    };
    const calledByDecl = new Map<TopLevel, Set<string>>(tls.map((t) => [t, RewriterImpl.globalCalls(this.options, t)]));
    const moveDeclarationsUp = (list: TopLevel[]): TopLevel[] => {
      const [swappables, rest1] = splitWhile(canBeSwappedWithFollowingDeclaration, list);
      const [decls, rest] = splitWhile((t) => t.kind === "TLDecl", rest1);
      if (decls.length === 0 && swappables.length === 0) {
        if (rest.length === 0) return [];
        return [rest[0], ...moveDeclarationsUp(rest.slice(1))];
      }
      // A declaration whose initializer calls one of the functions stays after them.
      if (swappables.some((f) => f.kind === "Function" && decls.some((d) => calledByDecl.get(d)?.has(funPrototype(f.funcType))))) return [...swappables, ...decls, ...moveDeclarationsUp(rest)];
      return [...decls, ...swappables, ...moveDeclarationsUp(rest)];
    };
    const sameList = (a: TopLevel[], b: TopLevel[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
    let tls1: TopLevel[] = [];
    let tls2 = moveDeclarationsUp(tls);
    while (!sameList(tls1, tls2)) {
      tls1 = tls2;
      tls2 = moveDeclarationsUp(tls2);
    }
    return this.squeezeTLDeclarations(tls2);
  }

  cleanup = (tl: TopLevel[]): TopLevel[] => {
    const chosen = tl.flatMap((t): TopLevel[] => {
      switch (t.kind) {
        case "TLDecl": {
          const li = this.declsNotToInline(t.decl[1]);
          if (li.length === 0) return [];
          return [TLDecl([this.rwType(t.decl[0]), li])];
        }
        case "TLVerbatim": return [TLVerbatim(this.stripSpaces(t.text))];
        case "TLDirective": return [TLDirective(this.stripDirectiveSpaces(t.parts), t.loc)];
        case "Function":
          if (t.funcType.fName.toBeInlined) return [];
          return [FunctionTL(this.rwFType(t.funcType), t.body)];
        default: return [t];
      }
    });
    return this.reorderAndSqueezeTLDeclarations(chosen);
  };
}

// reorder functions if there were forward declarations
export function reorderFunctions(options: Options, code: TopLevel[]): TopLevel[] {
  if (options.verbose) {
    console.log("Reordering functions because of forward declarations.");
  }

  const graphReorder = (nodes: FuncInfo[]): TopLevel[] => { // slow, but who cares?
    if (nodes.length === 0) return [];
    // Find a function that doesn't call anything else
    const node = nodes.find((n) => n.callSites.length === 0);
    if (node === undefined) throw new Error("Cannot reorder functions (probably because of a recursion).");
    // Remove that function from the graph
    const proto = funPrototype(node.funcType);
    const rest = nodes.filter((n) => n !== node)
      // Remove that function from the callSites. This step assumes no type-based overloading.
      .map((n) => ({ ...n, callSites: n.callSites.filter((c) => c.prototype !== proto) }));
    // Recurse
    return [node.func, ...graphReorder(rest)];
  };

  // Functions inside a conditional directive region at top level (#ifdef ... #else ... #endif)
  // are alternatives of which the compiler keeps one; pulling them out, as upstream does, defines
  // a function twice. Such a region stays where it is, as a unit, among the non-function items,
  // preceded by the functions outside any region that it calls (in dependency order); every
  // other function follows at the end, in upstream's order. Without regions this is upstream's
  // layout exactly.
  const directive = (tl: TopLevel): string => (tl.kind === "TLDirective" ? tl.parts[0] : "");
  const isConditional = (tl: TopLevel): boolean => /^#\s*(if|ifdef|ifndef|elif|else|endif)\b/.test(directive(tl));
  type Segment = { region: false; tl: TopLevel } | { region: true; items: TopLevel[] };
  const segments: Segment[] = [];
  let depth = 0;
  for (const tl of code) {
    if (isConditional(tl) && /^#\s*(if|ifdef|ifndef)\b/.test(directive(tl))) {
      if (depth === 0) segments.push({ region: true, items: [] });
      depth++;
    }
    if (depth > 0) (segments[segments.length - 1] as { items: TopLevel[] }).items.push(tl);
    else segments.push({ region: false, tl });
    if (isConditional(tl) && /^#\s*endif\b/.test(directive(tl))) depth = Math.max(0, depth - 1);
  }
  const regionFunctions = new Set<TopLevel>(segments.flatMap((s) => (s.region ? s.items.filter((t) => t.kind === "Function") : [])));
  const infos = new Analyzer(options).findFuncInfos(code);
  const free = infos.filter((n) => !regionFunctions.has(n.func));
  const freeByProto = new Map(free.map((n) => [funPrototype(n.funcType), n]));
  const freeNodes = free.map((n) => ({ ...n, callSites: n.callSites.filter((c) => freeByProto.has(c.prototype)) }));
  if (regionFunctions.size === 0) return [...code.filter((t) => t.kind !== "Function"), ...graphReorder(freeNodes)];

  // Every declaration outside a region first, as upstream lays them out, so a function pulled
  // ahead of a region never precedes a global it reads. Then the functions and the regions, each
  // after everything it calls.
  //
  // A region is one unit: its alternatives define the same function, so it cannot be split and
  // its members cannot be reordered. A free function is a unit of its own. A unit is ready when
  // every function it calls has been emitted, which orders calls from a region into another
  // region, and from a free function into a region, as well as upstream's plain callee-first
  // case. The forward declarations the source had are dropped, so an order that needs one is the
  // one thing this cannot express: a cycle through two regions leaves file order, as before.
  type Unit = { items: TopLevel[]; defines: Set<string>; calls: Set<string> };
  const unitOf = (items: TopLevel[], members: FuncInfo[]): Unit => ({
    items,
    defines: new Set(members.map((n) => funPrototype(n.funcType))),
    calls: new Set(members.flatMap((n) => n.callSites.map((c) => c.prototype))),
  });
  const byFunc = new Map(infos.map((n) => [n.func, n]));
  const units: Unit[] = segments.map((s) => (s.region
    ? unitOf(s.items, s.items.flatMap((t) => { const n = byFunc.get(t); return n === undefined ? [] : [n]; }))
    : unitOf([s.tl], s.tl.kind === "Function" && byFunc.has(s.tl) ? [byFunc.get(s.tl)!] : [])))
    .filter((u) => u.items.length > 0 && (u.defines.size > 0 || u.items.some((t) => t.kind === "Function")));
  const defined = new Set(units.flatMap((u) => [...u.defines]));
  const out: TopLevel[] = segments.flatMap((s) => (!s.region && s.tl.kind !== "Function" ? [s.tl] : []));
  const pending = units.slice();
  const done = new Set<string>();
  while (pending.length > 0) {
    // Ready: everything this unit calls is either already emitted or not defined in this file.
    let i = pending.findIndex((u) => [...u.calls].every((c) => done.has(c) || !defined.has(c) || u.defines.has(c)));
    if (i < 0) i = 0; // a cycle the dropped forward declarations cannot be recovered for
    const [u] = pending.splice(i, 1);
    for (const d of u.defines) done.add(d);
    out.push(...u.items);
  }
  return out;
}

function iterateSimplifyAndInline(options: Options, optimizationPass: OptimizationPass, passCount: number, li: TopLevel[]): TopLevel[] {
  let code = li;
  if (!options.noRemoveUnused) {
    // Removing a global can orphan a function whose only caller was its initializer, and removing
    // a function can orphan a global only it read, so alternate until neither removes anything.
    const changed = { value: true };
    while (changed.value) {
      changed.value = false;
      code = RewriterImpl.removeUnusedFunctions(options, code, changed);
      if (options.removeUnusedDeclarations) code = RewriterImpl.removeUnusedDeclarations(options, code, changed);
    }
  }
  code = code.filter((t) => !(t.kind === "TypeDecl" && t.block.blockType.kind === "Struct" && t.block.name === null)); // e.g. `struct {int A;};`
  new Analyzer(options).resolve(code);
  new Analyzer(options).markWrites(code);
  if (!options.noInlining) {
    new FunctionInlining(options).markInlinableFunctions(code);
    new VariableInlining(options).markInlinableVariables(code);
  }
  const didInline = { value: false };
  const before = Printer.print(code);
  const rewriter = new RewriterImpl(options, optimizationPass, code);
  code = Ast.visitor(options, rewriter.simplifyExpr(didInline), rewriter.simplifyStmt).mapTopLevel(code);

  // now that the functions were inlined, we can remove them
  code = code.filter((t) => !(t.kind === "Function" && t.funcType.fName.toBeInlined && !t.funcType.fName.name.startsWith("i_")));

  new Analyzer(options).checkScopes(code); // before argument inlining's resolve() hides a capture
  code = options.noInlining ? code : new ArgumentInlining(options).apply(didInline, code);
  new Analyzer(options).checkScopes(code);

  if (passCount > 20) {
    trace(options, "! possible unstable loop in change detection. stopping analysis.");
    return code;
  }
  const after = Printer.print(code);
  if (after !== before) {
    trace(options, "- significant changes happened: running analysis again...");
    return iterateSimplifyAndInline(options, optimizationPass, passCount + 1, code);
  }
  return code;
}

export function processPragmas(options: Options, li: TopLevel[]): TopLevel[] {
  let forceInlineNextFunction: [boolean, string[], Location] | null = null;
  const warnIgnoredPragma = ([, ss, loc]: [boolean, string[], Location]): void => trace(options, `${locToS(loc)}: ignored pragma ${ss.join(" ")}`);
  const processPragma = (tl: TopLevel): TopLevel | null => {
    if (tl.kind === "TLDirective" && tl.parts.length === 1) {
      const s = tl.parts[0];
      if (/#pragma +function +inline/i.test(s)) {
        if (forceInlineNextFunction !== null) warnIgnoredPragma(forceInlineNextFunction);
        forceInlineNextFunction = [true, [s], tl.loc];
        return null;
      }
      if (/#pragma +function +noinline/i.test(s)) {
        if (forceInlineNextFunction !== null) warnIgnoredPragma(forceInlineNextFunction);
        forceInlineNextFunction = [false, [s], tl.loc];
        return null;
      }
    }
    if (tl.kind === "Function") {
      const ft = tl.funcType;
      if (forceInlineNextFunction !== null) {
        if (forceInlineNextFunction[0]) {
          trace(options, `${locToS(ft.fName.loc)}: pragma forces inlining of '${Printer.debugFunc(ft)}'`);
          ft.fName.toBeInlined = true;
        } else {
          trace(options, `${locToS(ft.fName.loc)}: pragma prevents inlining of '${Printer.debugFunc(ft)}'`);
          ft.fName.doNotInline = true;
        }
      }
      forceInlineNextFunction = null;
      return tl;
    }
    return tl;
  };
  const res = li.flatMap((tl) => {
    const r = processPragma(tl);
    return r === null ? [] : [r];
  });
  if (forceInlineNextFunction !== null) warnIgnoredPragma(forceInlineNextFunction);
  return res;
}

// --drop-default-precision (port addition). GLSL ES defaults: vertex highp float and int,
// fragment mediump int (no float default), samplers lowp in both. A precision statement
// restating the default is a no-op, unless an earlier one for the same type overrode it.
// The stage is --stage, else the file extension (api.ts), else what the code proves; a shader
// that proves neither (a transform-feedback vertex shader that never writes gl_Position, say)
// only loses the sampler statements, which are the default in both stages.
const lowpSamplers = ["sampler2D", "sampler3D", "samplerCube", "samplerCubeShadow", "sampler2DShadow", "sampler2DArray", "sampler2DArrayShadow",
  "isampler2D", "isampler3D", "isamplerCube", "isampler2DArray", "usampler2D", "usampler3D", "usamplerCube", "usampler2DArray"];
const vertexOnlyBuiltins = new Set(["gl_Position", "gl_PointSize", "gl_VertexID", "gl_InstanceID"]);
const fragmentOnlyBuiltins = new Set(["gl_FragCoord", "gl_FrontFacing", "gl_PointCoord", "gl_FragColor", "gl_FragData", "gl_FragDepth"]);

/** The stage the code proves by using a builtin only one stage has, or by `discard`; null when it proves neither or both. */
export function detectStage(options: Options, code: readonly TopLevel[]): Stage | null {
  let vertex = false;
  let fragment = false;
  const spotExpr = (_env: Ast.MapEnv, e: Expr): Expr => {
    if (e.kind === "Var") {
      if (vertexOnlyBuiltins.has(e.ident.name)) vertex = true;
      else if (fragmentOnlyBuiltins.has(e.ident.name)) fragment = true;
    }
    return e;
  };
  const spotStmt = (_env: Ast.MapEnv, s: Stmt): Stmt => {
    if (s.kind === "Jump" && s.keyword === "discard") fragment = true;
    return s;
  };
  Ast.visitor(options, spotExpr, spotStmt).iterTopLevel(code);
  if (vertex === fragment) return null;
  return vertex ? "vertex" : "fragment";
}

const isPrecisionQ = (q: string): boolean => q === "lowp" || q === "mediump" || q === "highp";

// Which type's default precision governs a type name: a vector or matrix follows `float`, an
// integer vector follows `int`, a sampler is its own. `uint`, `bool` and structs are left alone,
// the first because the stage defaults above do not state it and the others because they take no
// precision qualifier.
const precisionBase = (name: string): string | null => {
  if (Builtin.isSamplerType(name)) return name;
  if (name === "float" || /^(vec[234]|mat[234](x[234])?)$/.test(name)) return "float";
  if (name === "int" || /^ivec[234]$/.test(name)) return "int";
  return null;
};

export function dropDefaultPrecision(options: Options, code: TopLevel[], stage: Stage | null = null): TopLevel[] {
  stage = options.stage ?? stage ?? detectStage(options, code);
  const defaults = new Map<string, string>(lowpSamplers.map((s) => [s, "lowp"]));
  if (stage === "vertex") { defaults.set("float", "highp"); defaults.set("int", "highp"); }
  else if (stage === "fragment") defaults.set("int", "mediump");

  // The precision in force for each type, which a `precision` statement changes from that point
  // on. A qualifier on a declaration that restates it says nothing, so it goes: ANGLE drops these
  // too, and three.js writes `highp` on most of its outputs.
  const current = new Map(defaults);
  const stripRedundant = (ty: Type): void => {
    if (ty.name.kind !== "TypeName") return;
    const base = precisionBase(ty.name.ident.name);
    const prec = ty.typeQ.find(isPrecisionQ);
    if (base === null || prec === undefined || current.get(base) !== prec) return;
    trace(options, `dropping '${prec}' from '${ty.name.ident.name}': the precision already in force`);
    ty.typeQ = ty.typeQ.filter((q) => q !== prec);
  };
  const stripDecl = (d: Decl): void => stripRedundant(d[0]);
  const stripTopLevel = (tl: TopLevel): void => {
    switch (tl.kind) {
      case "TLDecl": stripDecl(tl.decl); break;
      case "TypeDecl": for (const m of tl.block.members) if (m.kind === "MemberVariable") stripDecl(m.decl); break;
      case "Function": {
        stripRedundant(tl.funcType.retType);
        for (const a of tl.funcType.args) stripDecl(a);
        const inBody = (_: MapEnv, s: Stmt): Stmt => {
          if (s.kind === "Decl") stripDecl(s.decl);
          else if (s.kind === "ForD") stripDecl(s.init);
          return s;
        };
        Ast.visitor(options, undefined, inBody).iterStmt(Ast.UnknownLevel, tl.body);
        break;
      }
      default: break;
    }
  };

  const seen = new Set<string>();
  const out: TopLevel[] = [];
  for (const tl of code) {
    if (tl.kind === "Precision" && tl.ty.name.kind === "TypeName") {
      const tyName = tl.ty.name.ident.name;
      const prec = tl.ty.typeQ.find(isPrecisionQ);
      if (prec !== undefined) current.set(tyName, prec);
      const drop = !seen.has(tyName) && prec !== undefined && defaults.get(tyName) === prec;
      seen.add(tyName);
      if (drop) { trace(options, `dropping 'precision ${prec} ${tyName};': the default of the ${stage ?? "unknown"} stage`); continue; }
      out.push(tl);
      continue;
    }
    stripTopLevel(tl);
    out.push(tl);
  }
  return out;
}

/** `fileStage` is the stage the file name implies, if any; `--stage` overrides it. */
export function simplify(options: Options, li: TopLevel[], fileStage: Stage | null = null): TopLevel[] {
  let code = processPragmas(options, li);
  code = iterateSimplifyAndInline(options, OptimizationPass.First, 1, code);
  code = iterateSimplifyAndInline(options, OptimizationPass.Second, 1, code);
  let out = new RewriterImpl(options, OptimizationPass.First, code).cleanup(code);
  if (options.dropDefaultPrecision) out = dropDefaultPrecision(options, out, fileStage);
  if (options.webgl) new RewriterImpl(options, OptimizationPass.First, out).webglCheck(out);
  // The finished shader: every use must now name a declaration that is in scope. A rewrite that
  // leaves one behind emits a shader that does not compile, so failing here is the better outcome.
  new Analyzer(options).checkScopes(out, true);
  return out;
}

/** One file of a multi-file run, with the stage it was decided to be. */
export interface StagedCode { stage: Stage | null; code: TopLevel[] }

// --remove-unused-varyings: the one removal that needs both halves of a program at once.
//
// A varying the vertex shader writes and the fragment shader never reads costs an interpolator
// slot, the vertex work that computes it and the per-fragment interpolation, and a driver cannot
// remove it while both stages still declare it. Unlike the other removals this one is not visible
// from a single file: it needs the pair, so it only acts when the run holds at least one shader of
// each stage. That also keeps it away from a transform-feedback vertex shader, whose outputs the
// application looks up by name and which has no fragment partner.
//
// Two steps: a fragment input nothing in the fragment reads goes, then a vertex output no
// surviving fragment input names goes, along with the assignments that fed it. Two things keep a
// vertex output: an assignment whose value has an effect, since dropping the statement would lose
// it, and any read of the varying by the vertex shader itself. The second is not hypothetical:
// three.js writes `vDisplacementMapUv` and then samples the displacement map with it in the same
// shader, so removing it on the strength of the fragment shader alone does not compile.
export function removeUnusedVaryings(options: Options, files: StagedCode[]): void {
  const frags = files.filter((f) => f.stage === "fragment");
  const verts = files.filter((f) => f.stage === "vertex");
  if (frags.length === 0 || verts.length === 0) return;
  const analyzer = new Analyzer(options);
  const namesUsed = (code: readonly TopLevel[]): Set<string> => {
    const used = new Set<string>();
    for (const tl of code) {
      if (tl.kind === "Function") for (const i of analyzer.identUsesInStmt(IdentKind.Var, tl.body)) used.add(i.name);
      else if (tl.kind === "TLDecl") for (const d of tl.decl[1]) for (const e of [...d.sizes, ...(d.init === null ? [] : [d.init])]) for (const i of analyzer.identUsesInStmt(IdentKind.Var, ExprStmt(e))) used.add(i.name);
      else if (tl.kind === "TLVerbatim") used.add(tl.text); // opaque: matched loosely below
    }
    return used;
  };
  const hasQualifier = (tl: TopLevel, qs: string[]): boolean => tl.kind === "TLDecl" && qs.some((q) => tl.decl[0].typeQ.includes(q));
  const verbatim = (code: readonly TopLevel[]): string[] => code.flatMap((tl) => (tl.kind === "TLVerbatim" ? [tl.text] : tl.kind === "TLDirective" ? [tl.parts.join(" ")] : []));
  const namedInText = (texts: string[], name: string): boolean => texts.some((t) => new RegExp(`\\b${name}\\b`).test(t));

  // A fragment input the shader never reads.
  const kept = new Set<string>();
  for (const f of frags) {
    const used = namesUsed(f.code);
    const texts = verbatim(f.code);
    const out: TopLevel[] = [];
    for (const tl of f.code) {
      if (hasQualifier(tl, ["in", "varying"]) && tl.kind === "TLDecl") {
        const keep = tl.decl[1].filter((d) => d.name.keepName || d.name.hiddenUses || used.has(d.name.name) || namedInText(texts, d.name.name));
        for (const d of keep) kept.add(d.name.name);
        if (keep.length !== tl.decl[1].length) {
          trace(options, "removing unread fragment inputs: " + tl.decl[1].filter((d) => !keep.includes(d)).map((d) => d.name.name).join(", "));
          if (keep.length === 0) continue;
          out.push(TLDecl([tl.decl[0], keep]));
          continue;
        }
      }
      out.push(tl);
    }
    f.code = out;
  }

  // A vertex output no fragment input names, and the writes that fed it.
  for (const v of verts) {
    const texts = verbatim(v.code);
    const writes = new Map<string, Expr[]>(); // name -> the values assigned to it
    const assignedRoot = (e: Expr): { name: string; value: Expr } | null => {
      if (e.kind !== "FunCall" || e.fn.kind !== "Op" || !Builtin.assignOps.has(e.fn.op) || e.args.length === 0) return null;
      let target = e.args[0];
      for (;;) {
        if (target.kind === "Dot") target = target.expr;
        else if (target.kind === "Subscript") target = target.arr;
        else break;
      }
      return target.kind === "Var" ? { name: target.ident.name, value: e.args.length > 1 ? e.args[1] : e.args[0] } : null;
    };
    // Every mention of a name, and the mentions that are only the target of a plain assignment.
    // A name mentioned more often than it is assigned is read somewhere, so it has to stay.
    const mentions = new Map<string, number>();
    const writeTargets = new Map<string, number>();
    const bump = (m: Map<string, number>, k: string): void => { m.set(k, (m.get(k) ?? 0) + 1); };
    const collect = (_: MapEnv, e: Expr): Expr => {
      if (e.kind === "Var") bump(mentions, e.ident.name);
      const a = assignedRoot(e);
      if (a !== null) {
        writes.set(a.name, [...(writes.get(a.name) ?? []), a.value]);
        if (e.kind === "FunCall" && e.fn.kind === "Op" && e.fn.op === "=") bump(writeTargets, a.name);
      }
      return e;
    };
    Ast.visitor(options, collect).iterTopLevel(v.code);
    const isReadHere = (name: string): boolean => (mentions.get(name) ?? 0) > (writeTargets.get(name) ?? 0);

    const remove = new Set<string>();
    for (const tl of v.code) {
      if (!hasQualifier(tl, ["out", "varying"]) || tl.kind !== "TLDecl") continue;
      for (const d of tl.decl[1]) {
        if (d.name.keepName || d.name.hiddenUses || kept.has(d.name.name) || namedInText(texts, d.name.name)) continue;
        if (isReadHere(d.name.name)) continue; // the vertex shader reads it back
        if ((writes.get(d.name.name) ?? []).every(Effects.isPure)) remove.add(d.name.name);
      }
    }
    if (remove.size === 0) continue;
    trace(options, "removing varyings no fragment shader reads: " + [...remove].join(", "));
    const dropWrites = (_: MapEnv, s: Stmt): Stmt => {
      if (s.kind !== "Expr") return s;
      const a = assignedRoot(s.expr);
      return a !== null && remove.has(a.name) ? Ast.Block([]) : s;
    };
    v.code = Ast.visitor(options, undefined, dropWrites).mapTopLevel(v.code)
      .flatMap((tl) => {
        if (!hasQualifier(tl, ["out", "varying"]) || tl.kind !== "TLDecl") return [tl];
        const keep = tl.decl[1].filter((d) => !remove.has(d.name.name));
        return keep.length === 0 ? [] : keep.length === tl.decl[1].length ? [tl] : [TLDecl([tl.decl[0], keep])];
      });
  }
}
