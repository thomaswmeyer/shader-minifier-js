// What the rewriter knows about types: the structs, interface blocks and function return types of
// the code it was given, and the questions the rewrites and the --webgl check ask of them.
import * as Ast from "./ast.js";
import type { Expr, MapEnv, StructOrInterfaceBlock, TopLevel, Type } from "./ast.js";
import { Ident, asOpCall, makeType, typeEquals } from "./ast.js";
import * as Builtin from "./builtin.js";
import * as Printer from "./printer.js";

export const nonStructType: Type = makeType(Ast.TypeName(new Ident("float")), [], []);

export class TypeInfo {
  private readonly structs = new Map<string, StructOrInterfaceBlock>();
  private readonly returnTypes = new Map<string, Type[]>(); // every overload's return type, by function name
  // Whether a struct of the file has a field named like a swizzle (`q`, `rgb`): then `e.q` is a
  // swizzle only where e is known not to be a struct. Without such fields every one is, as upstream assumes.
  private readonly swizzleLikeFields: boolean;

  /**
   * `code` is what the types are learned from: the structs, interface blocks and function return
   * types the rewrites may meet. In a multi-file run it is the file being rewritten and the other
   * files' declarations, since a struct or a function declared in one file is used in the next.
   */
  constructor(code: readonly TopLevel[] = []) {
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
  isVoidType(ty: Type): boolean {
    return ty.name.kind === "TypeName" && ty.name.ident.name === "void";
  }

  isStructType(ty: Type): boolean {
    if (ty.name.kind === "TypeBlock") return true;
    const n = ty.name.ident.name;
    return !Builtin.builtinTypes.has(n) && !Builtin.isSamplerType(n);
  }

  // The same question for the check rather than for a guard: is this type proven to be a struct?
  // "Not a builtin" is not proof, since a kept `#define` can name a builtin: Cesium's FXAA pass
  // declares `FxaaBool goodSpanN`, and refusing `directionN?goodSpanN:goodSpanP` would refuse a
  // shader ANGLE accepts.
  isDeclaredStructType(ty: Type): boolean {
    return ty.name.kind === "TypeBlock" || this.structs.has(ty.name.ident.name);
  }

  // Best-effort static type; null means unknown.
  typeOf(e: Expr): Type | null {
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

  mayBeStruct(e: Expr): boolean {
    const t = this.typeOf(e);
    return t === null || this.isStructType(t);
  }

  /** Whether `expr.field` is a swizzle rather than a struct field access. */
  isSwizzle(expr: Expr, field: string): boolean {
    return Builtin.isFieldSwizzle(field) && (!this.swizzleLikeFields || !this.mayBeStruct(expr));
  }


  // Under --webgl the output must not contain what ANGLE rejects, whether it came from the input or
  // from a rewrite the guards missed: failing here beats emitting a shader that won't compile.
  webglCheck(code: readonly TopLevel[]): void {
    const check = (_env: MapEnv, e: Expr): Expr => {
      const op = asOpCall(e);
      if (op === null) return e;
      if (op.op === "?:" && op.args.length === 3) {
        const t = this.typeOf(op.args[1]) ?? this.typeOf(op.args[2]);
        if (t !== null && this.isDeclaredStructType(t)) throw new Error(`--webgl: WebGL rejects the ternary operator on struct values: ${Printer.exprToS(e)}`);
      } else if (op.op === ",") {
        const v = op.args.find((a) => a.kind === "FunCall" && a.fn.kind === "Var" && a.fn.ident.declaration.kind === "UserFunction" && this.hasVoidOperand(a));
        if (v !== undefined) throw new Error(`--webgl: WebGL (ES 3.00) rejects a void call in a comma sequence: ${Printer.exprToS(v)} in ${Printer.exprToS(e)}`);
      }
      return e;
    };
    Ast.visitor(check).iterTopLevel(code);
  }

  hasVoidOperand(e: Expr): boolean {
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
}
