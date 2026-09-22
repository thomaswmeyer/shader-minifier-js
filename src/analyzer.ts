// Port of Minifier/analyzer.fs
import * as Ast from "./ast.js";
import type { Access, Decl, Expr, FunctionType, Ident, Stmt, TopLevel, VarDecl } from "./ast.js";
import { asOpCall, resolvedVariableUse } from "./ast.js";
import * as Builtin from "./builtin.js";
import { ExprTyper, sameSignature, sameType } from "./typer.js";

// We can visit Var uses in evaluation order (sometimes twice: read then write),
// and we know if they're read and/or written (by assignment operators or by in/out),
// if it's a field access, and if it's a declaration initialization.

export interface VarUse {
  access: Access;
  isPartialAccess: boolean;
  isDecl: boolean;
}
export const varUseToString = (u: VarUse): string =>
  Ast.accessToString(u.access) + (u.isPartialAccess ? " field" : "") + (u.isDecl ? " decl" : " use");

export type OnVarUse = (varUse: VarUse, ident: Ident, vd: VarDecl) => void;

export class VarVisitor {
  varUse: VarUse = { access: { isWrite: false, isRead: true }, isPartialAccess: false, isDecl: false };

  constructor(private readonly onVarUse: OnVarUse) {}

  onVisitVar(e: Expr): void {
    const r = resolvedVariableUse(e);
    if (r !== null) this.onVarUse(this.varUse, r[0], r[1]);
  }

  using(newContext: VarUse, go: () => void): void {
    const old = this.varUse;
    this.varUse = newContext;
    try {
      go();
    } finally {
      this.varUse = old;
    }
  }

  private withAccess(isRead: boolean, isWrite: boolean): VarUse { return { ...this.varUse, access: { isRead, isWrite } }; }

  // Vars in the AST can be a few things:
  // [A] A declaration without initialization is neither a read nor a write.            int x;
  // [B] A declaration with initialization is a "isDecl" write.                         int x = 1;
  // [C] An assignment is a write.                                                      x = 1;
  // [D] An augmented assignment is a read and then a write.                            x += 1;
  // [E] A function name itself can contain a variable read                             x.length();
  // [F] An "in" parameter in a function call is a read.                                sin(x);
  // [G] An "out" parameter in a function call is a write.                              void f(out p) { p = 1; } ... f(x);
  // [H] An "inout" parameter in a function call is a read later followed by a write.   void f(inout p) { p += 1; } ... f(x);
  //   Note that even when passing a global as out or inout, no aliasing happens.
  //   The function works on a local copy, and copies back the value when exiting.
  // [I] Other stray var uses are reads.
  visitExpr(e: Expr): void {
    switch (e.kind) {
      case "FunCall": {
        const opCall = asOpCall(e);
        if (opCall !== null && Builtin.assignOps.has(opCall.op) && opCall.args.length > 0) {
          const [first, ...args] = opCall.args;
          const alsoReadTheVar = opCall.op !== "="; // Augmented assignment or ++ or --
          if (alsoReadTheVar) {
            // Visit the lhs of the assignment as a read. [D]
            this.using(this.withAccess(true, false), () => this.visitExpr(first));
          }
          for (const a of args) this.visitExpr(a); // visit the rhs of the assignments
          this.visitExpr(e.fn); // visit the assignment op
          // Visit the lhs of the assignment as a write. [C] [D]
          this.using(this.withAccess(false, true), () => this.visitExpr(first));
          return;
        }
        this.using(this.withAccess(true, false), () => this.visitExpr(e.fn)); // [E]
        // Handle in/out/inout parameters.
        let funcDecl: Ast.FunDecl | null = null;
        if (e.fn.kind === "Var" && e.fn.ident.declaration.kind === "UserFunction") funcDecl = e.fn.ident.declaration.decl;
        const paramAccessList: Access[] = funcDecl !== null
          ? funcDecl.funcType.args.map(([ty]) => Ast.typeAccess(ty))
          : e.args.map(() => ({ isWrite: false, isRead: true }));
        const n = Math.min(e.args.length, paramAccessList.length); // F# List.zip throws on mismatch; be lenient
        for (let i = 0; i < n; i++) {
          const access = paramAccessList[i];
          this.using({ ...this.varUse, access }, () => this.visitExpr(e.args[i])); // [F] [G] [H]
        }
        return;
      }
      case "Subscript":
        this.using({ ...this.varUse, isPartialAccess: true }, () => this.visitExpr(e.arr));
        this.using(this.withAccess(true, false), () => { if (e.index !== null) this.visitExpr(e.index); }); // [I]
        return;
      case "Dot":
        this.using({ ...this.varUse, isPartialAccess: true }, () => this.visitExpr(e.expr));
        return;
      case "Var": this.onVisitVar(e); return;
      case "Conditional": for (const b of e.branches) this.visitExpr(b.expr); return; // every branch may be the one the compiler keeps
      default: return;
    }
  }

  visitDecl([, declElts]: Decl): void {
    for (const declElt of declElts) {
      // Visit the init expr first.
      this.using(this.withAccess(true, false), () => { if (declElt.init !== null) this.visitExpr(declElt.init); }); // [I]
      // Then visit the declared var (maybe as a write).
      this.using({ ...this.varUse, isDecl: true }, () => {
        this.using(this.withAccess(false, declElt.init !== null), () => { // [A] [B]
          this.onVisitVar(Ast.Var(declElt.name));
        });
      });
    }
  }

  visitStmt(stmt: Stmt): void {
    this.using(this.withAccess(true, false), () => { // [I]
      switch (stmt.kind) {
        case "Block": for (const s of stmt.stmts) this.visitStmt(s); return;
        case "Expr": this.visitExpr(stmt.expr); return;
        case "Decl": this.visitDecl(stmt.decl); return;
        case "If":
          this.visitExpr(stmt.cond);
          this.visitStmt(stmt.then);
          if (stmt.else !== null) this.visitStmt(stmt.else);
          return;
        case "While": case "DoWhile":
          this.visitExpr(stmt.cond);
          this.visitStmt(stmt.body);
          return;
        case "ForD":
          this.visitDecl(stmt.init);
          if (stmt.cond !== null) this.visitExpr(stmt.cond);
          if (stmt.inc !== null) this.visitExpr(stmt.inc);
          this.visitStmt(stmt.body);
          return;
        case "ForE":
          if (stmt.init !== null) this.visitExpr(stmt.init);
          if (stmt.cond !== null) this.visitExpr(stmt.cond);
          if (stmt.inc !== null) this.visitExpr(stmt.inc);
          this.visitStmt(stmt.body);
          return;
        case "Jump": if (stmt.expr !== null) this.visitExpr(stmt.expr); return;
        case "Verbatim": case "Directive": case "Precision": return;
        case "Switch":
          this.visitExpr(stmt.expr);
          for (const c of stmt.cases) {
            if (c.label.kind === "Case") this.visitExpr(c.label.expr);
            for (const s of c.stmts) this.visitStmt(s);
          }
          return;
      }
    });
  }

  visitTopLevels(tls: readonly TopLevel[]): void {
    for (const tl of tls) {
      if (tl.kind === "TLDecl") this.visitDecl(tl.decl);
      else if (tl.kind === "Function") {
        for (const d of tl.funcType.args) this.visitDecl(d);
        this.visitStmt(tl.body);
      }
    }
  }
}

export namespace Effects {
  export function sideEffects(e: Expr): Expr[] {
    switch (e.kind) {
      case "Var": case "Int": case "Float": return [];
      // Only one branch survives preprocessing, but which one is not known here, so the whole
      // conditional has an effect if any branch does, and it cannot be split into its parts.
      case "Conditional": return e.branches.some((b) => sideEffects(b.expr).length > 0) ? [e] : [];
      case "Dot": return sideEffects(e.expr);
      case "Subscript": return [e.arr, ...(e.index === null ? [] : [e.index])].flatMap(sideEffects);
      case "FunCall": {
        const f = e.fn;
        if (f.kind === "Var") {
          if (Builtin.pureBuiltinFunctions.has(f.ident.name)) return e.args.flatMap(sideEffects);
          const d = f.ident.declaration;
          if (d.kind === "UserFunction" && !d.decl.hasExternallyVisibleSideEffects) return e.args.flatMap(sideEffects);
          return [e];
        }
        if (f.kind === "Op") {
          if (f.op === "?:" && e.args.length === 3) {
            const [condExpr, thenExpr, elseExpr] = e.args;
            if (sideEffects(thenExpr).length === 0 && sideEffects(elseExpr).length === 0) return sideEffects(condExpr);
            return [e]; // We could apply sideEffects to thenExpr and elseExpr, but the result wouldn't necessarily have the same type...
          }
          if (!Builtin.assignOps.has(f.op)) return e.args.flatMap(sideEffects);
          return [e];
        }
        if (f.kind === "Dot" && f.field.name === "length") return [f, ...e.args].flatMap(sideEffects);
        if (f.kind === "Subscript") return [f, ...e.args].flatMap(sideEffects);
        return [e];
      }
      default: return [e];
    }
  }
  export const isPure = (e: Expr): boolean => sideEffects(e).length === 0;
}

// The Analyzer module performs some static analysis on the code and stores the
// information in the AST nodes, e.g. find which variables are modified,
// which declarations can be inlined.

export interface CallSite {
  ident: Ident;
  varsInScope: string[];
  prototype: string;
  argExprs: Expr[];
  /** The function the call resolved to, by name and arity or, among overloads of one arity, by argument types; null when ambiguous. */
  resolved: FunctionType | null;
}

export interface FuncInfo {
  func: TopLevel;
  funcType: FunctionType;
  body: Stmt;
  name: string;
  callSites: CallSite[]; // calls to other user-defined functions, from inside this function.
  isResolvable: boolean; // Currently we cannot resolve overloaded functions based on argument types.
  /** Upstream name kept; it is true when NO other function shares this name (i.e. "is not overloaded"). */
  isOverloaded: boolean;
}

export enum IdentKind {
  Var = 0b1,
  Field = 0b10,
  Type = 0b100,
}

/** Every call of a named function in a statement, as `name/arity` prototypes, in order; builtins and unknown functions included. */
export function callPrototypes(stmt: Stmt): string[] {
  const calls: string[] = [];
  const collect = (_: Ast.MapEnv, e: Expr): Expr => { if (e.kind === "FunCall" && e.fn.kind === "Var") calls.push(Ast.prototypeKey(e.fn.ident.name, e.args.length)); return e; };
  Ast.visitor(collect).iterStmt(Ast.UnknownLevel, stmt);
  return calls;
}

export class Analyzer {

  // findFuncInfos finds the call graph, and other related information for function inlining.
  findFuncInfos(code: readonly TopLevel[]): FuncInfo[] {
    const functions = code.filter((tl): tl is Extract<TopLevel, { kind: "Function" }> => tl.kind === "Function");
    // The function of this code a call resolved to. The call's declaration may be from an earlier
    // pass, whose function nodes were rebuilt since, so it is matched by signature (prototype and
    // parameter types), never by identity; a call that was not resolved, or whose overload is
    // gone, is null, which every caller reads as "possibly any of them".
    const resolvedFunction = (ident: Ident): FunctionType | null => {
      const d = ident.declaration;
      if (d.kind !== "UserFunction") return null;
      const proto = Ast.funPrototype(d.decl.funcType);
      const same = functions.filter((g) => Ast.funPrototype(g.funcType) === proto);
      if (same.length === 1) return same[0].funcType;
      const matching = same.filter((g) => sameSignature(g.funcType, d.decl.funcType));
      return matching.length === 1 ? matching[0].funcType : null;
    };
    const findCallSites = (block: Stmt): CallSite[] => { // Gets the list of call sites in this function
      const callSites: CallSite[] = [];
      const collect = (mEnv: Ast.MapEnv, e: Expr): Expr => {
        if (e.kind === "FunCall" && e.fn.kind === "Var") {
          callSites.push({ ident: e.fn.ident, varsInScope: [...mEnv.vars.keys()], prototype: Ast.prototypeKey(e.fn.ident.name, e.args.length), argExprs: e.args, resolved: resolvedFunction(e.fn.ident) });
        }
        return e;
      };
      Ast.visitor(collect).iterStmt(Ast.UnknownLevel, block);
      return callSites;
    };
    return functions.map((f) => {
      const funcType = f.funcType;
      const proto = Ast.funPrototype(funcType);
      const callSites = findCallSites(f.body)
        // only return calls to user-defined functions
        .filter((callSite) => functions.some((g) => callSite.prototype === Ast.funPrototype(g.funcType)));
      const others = functions.filter((g) => g !== f);
      const isResolvable = !others.some((g) => Ast.funPrototype(g.funcType) === proto);
      const isOverloaded = !others.some((g) => Ast.identEquals(g.funcType.fName, funcType.fName));
      return { func: f, funcType, name: funcType.fName.name, callSites, body: f.body, isResolvable, isOverloaded };
    });
  }

  identUsesInStmt(kind: IdentKind, stmt: Stmt): Ident[] {
    const idents: Ident[] = [];
    const collectLocalUses = (_env: Ast.MapEnv, e: Expr): Expr => {
      if (e.kind === "Var" && kind & IdentKind.Var) idents.push(e.ident);
      else if (e.kind === "Dot" && kind & IdentKind.Field) idents.push(e.field);
      return e;
    };
    const collectLocalUsesInStmt = (_env: Ast.MapEnv, s: Stmt): Stmt => {
      // A declaration's type name is a use of that type (a struct), in a statement or a for header.
      const decl = s.kind === "Decl" ? s.decl : s.kind === "ForD" ? s.init : null;
      if (decl !== null && decl[0].name.kind === "TypeName" && kind & IdentKind.Type) idents.push(decl[0].name.ident);
      return s;
    };
    Ast.visitor(collectLocalUses, collectLocalUsesInStmt).iterStmt(Ast.UnknownLevel, stmt);
    return idents;
  }

  // recalculates hasExternallyVisibleSideEffects/isVarWrite/isEverWrittenAfterDecl, for inlining
  markWrites(topLevel: readonly TopLevel[]): void {
    const findWrites: OnVarUse = (varUse, v, vd) => {
      const isWriteAfterDecl = varUse.access.isWrite && !varUse.isDecl;
      if (isWriteAfterDecl) {
        // this is initially set to false when `resolve` creates all Declarations
        vd.isEverWrittenAfterDecl = true;
      }
      v.isVarWrite = isWriteAfterDecl;
    };
    new VarVisitor(findWrites).visitTopLevels(topLevel);

    const findExternallyVisibleSideEffect = (tl: TopLevel): boolean => {
      let hasExternallyVisibleSideEffect = false;
      const findExprSideEffects = (_env: Ast.MapEnv, e: Expr): Expr => {
        if (e.kind === "Var") {
          const v = e.ident;
          const d = v.declaration;
          let hasSideEffect: boolean;
          switch (d.kind) {
            case "Variable":
              switch (d.decl.scope) {
                case "Global": hasSideEffect = v.isVarWrite; break;
                case "Parameter": hasSideEffect = Ast.typeIsOutOrInout(d.decl.ty); break;
                default: hasSideEffect = false;
              }
              break;
            // functions are processed in order, so this is initialized before use
            case "UserFunction": hasSideEffect = d.decl.hasExternallyVisibleSideEffects; break;
            case "BuiltinFunction": hasSideEffect = !Builtin.pureBuiltinFunctions.has(v.name); break;
            default: hasSideEffect = true;
          }
          hasExternallyVisibleSideEffect = hasExternallyVisibleSideEffect || hasSideEffect;
        }
        return e;
      };
      const findStmtSideEffects = (_env: Ast.MapEnv, s: Stmt): Stmt => {
        // Side effects can hide in macros.
        if (s.kind === "Verbatim" || s.kind === "Directive") hasExternallyVisibleSideEffect = true;
        return s;
      };
      Ast.visitor(findExprSideEffects, findStmtSideEffects).iterTopLevel([tl]);
      return hasExternallyVisibleSideEffect;
    };

    for (const tl of topLevel) {
      if (tl.kind === "Function") {
        const d = tl.funcType.fName.declaration;
        if (d.kind === "UserFunction") d.decl.hasExternallyVisibleSideEffects = findExternallyVisibleSideEffect(tl);
      }
    }
  }

  // Create an ident.Declaration for each declaration in the file.
  // Give each Ident a reference to that Declaration.
  resolve(topLevel: readonly TopLevel[]): void {
    const structs = new Map<string, Ast.StructOrInterfaceBlock>();
    for (const tl of topLevel) if (tl.kind === "TypeDecl" && tl.block.name !== null) structs.set(tl.block.name.name, tl.block);
    // A declaration in alternative `#if` branches (a local unified below, marked doNotInline, or a
    // global in a top-level region) may have another type under the other setting of the define,
    // so such a variable has no type here; and an overload group with a member inside a region is
    // never resolved, since the other setting may need the other member.
    const conditionalGlobals = Ast.conditionalGlobals(topLevel);
    const conditionalFunctions = Ast.conditionalFunctions(topLevel);
    const typer = new ExprTyper(structs, (elt) => elt.name.doNotInline || conditionalGlobals.has(elt));
    // Among overloads of one arity, the one whose every parameter has the argument's type, when
    // every argument's type is known and exactly one overload takes them; else the call stays
    // unresolved and every pass treats the whole group as possibly called. Exact types only: an
    // `int` argument to a `float` parameter, which ES 3.00 converts, is left unresolved.
    const byTypes = (candidates: [FunctionType, Stmt][], args: readonly Expr[]): FunctionType | null => {
      if (candidates.some(([ft]) => conditionalFunctions.has(ft))) return null;
      const types = args.map((a) => typer.typeOf(a));
      if (types.some((t) => t === null)) return null;
      const matching = candidates.filter(([ft]) => ft.args.every(([ty, elts], i) => sameType(ExprTyper.declaredType(ty, elts[0]), types[i]!)));
      return matching.length === 1 ? matching[0][0] : null;
    };
    const resolveExpr = (env: Ast.MapEnv, e: Expr): Expr => {
      if (e.kind === "FunCall" && e.fn.kind === "Var") {
        const v = e.fn.ident;
        const found = env.fns.get(Ast.prototypeKey(v.name, e.args.length));
        const typed = found !== undefined && found.length > 1 ? byTypes(found, e.args) : null;
        if (found !== undefined && found.length === 1) v.declaration = found[0][0].fName.declaration;
        else if (typed !== null) v.declaration = typed.fName.declaration;
        else if (found === undefined && Builtin.builtinFunctions.has(v.name)) v.declaration = Ast.BuiltinFunctionDeclaration;
        else v.declaration = Ast.UnknownFunctionDeclaration;
      } else if (e.kind === "Var") {
        const found = env.vars.get(e.ident.name);
        if (found !== undefined) e.ident.declaration = found[1].name.declaration;
      }
      return e;
    };

    const resolveDecl = (scope: Ast.VarScope, [ty, li]: Decl): void => {
      for (const elt of li) {
        elt.name.declaration = { kind: "Variable", decl: new Ast.VarDecl(ty, elt, scope) };
      }
    };

    const resolveStmt = (_env: Ast.MapEnv, s: Stmt): Stmt => {
      if (s.kind === "Decl") resolveDecl("Local", s.decl);
      else if (s.kind === "ForD") resolveDecl("Local", s.init);
      return s;
    };

    const resolveGlobalsAndParameters = (tl: TopLevel): void => {
      if (tl.kind === "TLDecl") resolveDecl("Global", tl.decl);
      else if (tl.kind === "Function") {
        for (const decl of tl.funcType.args) resolveDecl("Parameter", decl);
        tl.funcType.fName.declaration = { kind: "UserFunction", decl: new Ast.FunDecl(tl, tl.funcType) };
      }
    };

    // First visit all declarations, creating them.
    for (const tl of topLevel) resolveGlobalsAndParameters(tl);
    Ast.visitor(undefined, resolveStmt).iterTopLevel(topLevel);
    this.unifyAlternativeDeclarations(topLevel);
    // Then, visit all uses and associate them to their declaration.
    Ast.visitor(resolveExpr).iterTopLevel(topLevel);
  }

  // A block with conditional directives in it may declare one name twice, in alternative
  // branches the compiler picks one of (three.js: `#ifdef FOG_EXP2\n float fogFactor = ...;\n#else\n
  // float fogFactor = ...;\n#endif`), or declare a local of a global's or parameter's name in a
  // branch (`#ifdef USE_INSTANCING_MORPH\n float morphTargetInfluences[N];` over the uniform). Read
  // as one flat list, the uses bind to the last declaration, the others look unused, and each
  // rewrite that acts on one of them is wrong under the other setting of the define: the first
  // declaration removed as unused, the last inlined into a use both share, the two renamed apart.
  //
  // So every declaration of such a name in the list is made one variable: the later ones point at
  // the first's declaration, all of them are kept out of inlining, and a shadowed global or
  // parameter is treated as having uses this pass cannot see. The renamer then gives them one name
  // (RenamerVisitor.renDecl). Blocks without a directive cannot redeclare a name, so nothing else
  // changes.
  private unifyAlternativeDeclarations(topLevel: readonly TopLevel[]): void {
    const globals = new Map<string, Ident>();
    for (const tl of topLevel) if (tl.kind === "TLDecl") for (const d of tl.decl[1]) globals.set(d.name.name, d.name);
    const unifyList = (stmts: readonly Stmt[], outer: ReadonlyMap<string, Ident>): void => {
      if (!stmts.some(Ast.isConditionalDirective)) return;
      const seen = new Map<string, Ident>();
      for (const s of stmts) {
        if (s.kind !== "Decl") continue;
        for (const elt of s.decl[1]) {
          const name = elt.name.name;
          const first = seen.get(name);
          if (first !== undefined) {
            elt.name.declaration = first.declaration;
            elt.name.doNotInline = true;
            first.doNotInline = true;
            continue;
          }
          seen.set(name, elt.name);
          const shadowed = outer.get(name);
          if (shadowed !== undefined) {
            elt.name.doNotInline = true;
            shadowed.doNotInline = true;
            shadowed.hiddenUses = true; // its uses in the other setting of the define resolve to the local here
          }
        }
      }
    };
    const walk = (s: Stmt, outer: ReadonlyMap<string, Ident>): void => {
      switch (s.kind) {
        case "Block": unifyList(s.stmts, outer); for (const x of s.stmts) walk(x, outer); break;
        case "If": walk(s.then, outer); if (s.else !== null) walk(s.else, outer); break;
        case "ForD": case "ForE": case "While": case "DoWhile": walk(s.body, outer); break;
        case "Switch": for (const c of s.cases) { unifyList(c.stmts, outer); for (const x of c.stmts) walk(x, outer); } break;
        default: break;
      }
    };
    for (const tl of topLevel) {
      if (tl.kind !== "Function") continue;
      const outer = new Map(globals);
      for (const [, elts] of tl.funcType.args) for (const d of elts) outer.set(d.name.name, d.name);
      walk(tl.body, outer);
    }
  }

  // Every variable use must still name the declaration it was resolved to. A rewrite that copies
  // an expression into a scope where one of its names is bound to another variable (a capture)
  // leaves the use pointing at the old declaration while the name means the new one; the next
  // resolve() would silently rebind it by name, so only the pass that made the copy can tell.
  // Called by the rewriter after every pass. Uses of a name no declaration in scope binds
  // (builtins, verbatim code) are not checked.
  /**
   * `final` adds the rule that every use must have a declaration in scope. That is only true of
   * finished code: between passes the rewriter can leave an assignment to a variable whose
   * declaration has already gone, and the next pass removes the statement.
   */
  checkScopes(topLevel: readonly TopLevel[], final = false): void {
    const check = (env: Ast.MapEnv, e: Expr): Expr => {
      const r = resolvedVariableUse(e);
      if (r === null) return e;
      const [ident, vd] = r;
      const at = (l: Ast.Location): string => `${l.line}:${l.col}`;
      const found = env.vars.get(ident.name)?.[1].name;
      if (found !== undefined && found.varDecl !== null && found.varDecl !== vd) {
        throw new Error(`Internal error: a rewrite captured '${ident.name}' at ${at(ident.loc)}: it referred to the ${vd.scope.toLowerCase()} declared at ${at(vd.decl.name.loc)} but now names the ${found.varDecl.scope.toLowerCase()} declared at ${at(found.loc)}`);
      }
      // The same use moved the other way: a global read before its own declaration. GLSL requires
      // a declaration to precede every use, and `found === undefined` here means nothing of that
      // name is in scope yet, so the capture check above cannot see it. This is the class of bug
      // docs/PORTING.md item 18 had to be found by hand, since only the capture check existed.
      if (found === undefined && final) {
        // Nothing of that name is in scope. Either the use was moved above its declaration, or the
        // declaration is gone and the use was left behind; variable reuse can do the second by
        // renaming a chain of uses onto a name that a later reuse then renamed away.
        const what = vd.scope === "Global" ? "moved" : "left";
        throw new Error(`Internal error: a rewrite ${what} '${ident.name}' at ${at(ident.loc)} with no declaration in scope (it named the ${vd.scope.toLowerCase()} declared at ${at(vd.decl.name.loc)})`);
      }
      return e;
    };
    Ast.visitor(check).iterTopLevel(topLevel);
  }
}
