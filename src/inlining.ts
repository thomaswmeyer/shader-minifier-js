// Port of Minifier/inlining.fs
import * as Ast from "./ast.js";
import type { Decl, Expr, Ident, Level, Location, Stmt, TopLevel, VarDecl } from "./ast.js";
import { asOpCall, asVarCall, resolvedVariableUse } from "./ast.js";
import { Analyzer, Effects, IdentKind, type CallSite, type FuncInfo } from "./analyzer.js";
import * as Builtin from "./builtin.js";
import * as Printer from "./printer.js";
import { trace, type Options } from "./options.js";

const locToS = (loc: Location): string => `${loc.line}:${loc.col}`;

function isTrivialExpr(e: Expr): boolean { // "trivial" means "small enough to inline to multiple places".
  switch (e.kind) {
    case "Var": return e.ident.name === "true" || e.ident.name === "false";
    case "Int":
    case "Float": return true;
    default: return false;
  }
}

// Whether `name` is bound to a local or parameter (other than `except`) in the visitor's scope.
// An expression copied into that scope would have `name` captured by it.
function isShadowedAt(env: Ast.MapEnv, name: string, except: VarDecl | null = null): boolean {
  const found = env.vars.get(name);
  if (found === undefined) return false;
  const vd = found[1].name.varDecl;
  return vd !== null && vd !== except && vd.scope !== "Global";
}

// Whether the expression calls a function (a builtin or a user function; constructors don't count).
function hasCall(e: Expr): boolean {
  switch (e.kind) {
    case "FunCall": {
      if (e.fn.kind === "Var" && !Builtin.builtinTypes.has(e.fn.ident.name)) return true; // builtinTypes covers every constructor
      return hasCall(e.fn) || e.args.some(hasCall);
    }
    case "Subscript": return hasCall(e.arr) || (e.index !== null && hasCall(e.index));
    case "Dot": return hasCall(e.expr);
    case "Conditional": return e.branches.some((b) => hasCall(b.expr));
    default: return false;
  }
}

// Return the list of variables used in the statements, with the number of references.
function countReferences(stmtList: readonly Stmt[]): Map<VarDecl, number> {
  const counts = new Map<VarDecl, number>();
  const collectLocalUses = (_env: Ast.MapEnv, e: Expr): Expr => {
    const r = resolvedVariableUse(e);
    if (r !== null) {
      const vd = r[1];
      counts.set(vd, (counts.get(vd) ?? 0) + 1);
    }
    return e;
  };
  for (const expr of stmtList) {
    Ast.visitor(collectLocalUses).iterStmt(Ast.UnknownLevel, expr);
  }
  return counts;
}

// Collect the expressions under a statement, but do not look in loops.
function collectExprsOutsideLoops(stmt: Stmt, out: Expr[]): void {
  switch (stmt.kind) {
    case "Decl":
      for (const def of stmt.decl[1]) {
        if (def.init !== null) out.push(def.init);
      }
      break;
    case "Expr": out.push(stmt.expr); break;
    case "Jump": if (stmt.expr !== null) out.push(stmt.expr); break;
    case "If":
      out.push(stmt.cond);
      collectExprsOutsideLoops(stmt.then, out);
      if (stmt.else !== null) collectExprsOutsideLoops(stmt.else, out);
      break;
    case "Block": for (const s of stmt.stmts) collectExprsOutsideLoops(s, out); break;
    case "Directive": case "Verbatim": case "ForE": case "ForD": case "While": case "DoWhile": case "Switch": break;
  }
}

export class VariableInlining {
  constructor(private readonly options: Options) {}

  private countReferences(stmtList: readonly Stmt[]): Map<VarDecl, number> {
    return countReferences(stmtList);
  }

  private isEffectivelyConst(ident: Ident): boolean {
    const d = ident.declaration;
    switch (d.kind) {
      case "Variable": return !d.decl.isEverWrittenAfterDecl;
      case "UserFunction": return !d.decl.hasExternallyVisibleSideEffects;
      case "BuiltinFunction": return Builtin.pureBuiltinFunctions.has(ident.name);
      default: return false;
    }
  }

  // Mark variables as inlinable when possible.
  // Variables are always safe to inline when all of:
  //  - the variable is used only once in the current block
  //  - the variable is not used in a loop sub-block, for runtime performance
  //  - the init value refers only to variables that are never written to, and functions that are builtin and pure
  private markSafelyInlinableLocals(block: readonly Stmt[]): void {
    // Variables that are defined in this scope.
    // The boolean indicate if the variable initialization is const.
    const localDefs = new Map<string, [Ident, boolean]>();
    for (const stmt of block) {
      if (stmt.kind === "Decl") {
        const [, declElts] = stmt.decl;
        for (const def of declElts) {
          // can only inline if it has a value
          if (def.init === null) {
            localDefs.set(def.name.name, [def.name, true]);
          } else {
            const isConst = new Analyzer().identUsesInStmt(IdentKind.Var, Ast.ExprStmt(def.init)).every((i) => this.isEffectivelyConst(i));
            localDefs.set(def.name.name, [def.name, isConst]);
          }
        }
      }
    }
    // List of all expressions under the current block, but do not look in loops.
    const localExprs: Expr[] = [];
    for (const stmt of block) collectExprsOutsideLoops(stmt, localExprs);

    const localReferences = this.countReferences(localExprs.map((e) => Ast.ExprStmt(e)));
    const allReferences = this.countReferences(block);

    for (const [ident, isConst] of localDefs.values()) {
      const varDecl = ident.varDecl;
      if (varDecl === null) throw new Error(`unresolved declaration: ${Printer.debugIdent(ident)}`);
      if (!ident.doNotInline && !ident.toBeInlined && !varDecl.isEverWrittenAfterDecl) {
        const decl = varDecl.decl;
        const localCount = localReferences.get(varDecl) ?? 0;
        const allCount = allReferences.get(varDecl) ?? 0;
        if (localCount === 1 && allCount === 1 && isConst && decl.init !== null) {
          trace(this.options, `${locToS(ident.loc)}: inlining local variable '${Printer.debugIdent(ident)}' because it's safe to inline (const) and used only once`);
          ident.toBeInlined = true;
        } else if (localCount === 0 && allCount === 0) {
          const ok = decl.init !== null ? Effects.isPure(decl.init) : true;
          if (ok) {
            trace(this.options, `${locToS(ident.loc)}: inlining (removing) local variable '${Printer.debugDecl(decl)}' because it's unused and the init is pure or missing`);
            ident.toBeInlined = true;
          }
        }
      }
    }
  }

  // Detect if a variable can be inlined in multiple places, based on its value.
  private isSimpleEnoughToInline(init: Expr): boolean {
    if (isTrivialExpr(init)) return true;
    if (this.options.inlining !== "aggressive") return false;
    // Allow a few things to be inlined with aggroInlining (even if they have side effects!)
    const use = resolvedVariableUse(init) ?? (init.kind === "Dot" ? resolvedVariableUse(init.expr) : null);
    if (use !== null) {
      const [v, vd] = use;
      if (!vd.decl.name.toBeInlined) { // Don't inline the use of a variable that's already marked for inlining!
        return this.isEffectivelyConst(v);
      }
      return false;
    }
    const opCall = asOpCall(init);
    if (opCall !== null) {
      return !Builtin.assignOps.has(opCall.op) && opCall.args.every(isTrivialExpr);
    }
    const varCall = asVarCall(init);
    if (varCall !== null) {
      return Builtin.pureBuiltinFunctions.has(varCall.ident.name) && varCall.args.every(isTrivialExpr);
    }
    return false;
  }

  // Inline global or local variables, regardless of where they are used or how often they are used, when all of:
  //  - it is not external
  //  - it is never written after declaration
  //  - it is either:
  //      - an uninitialized local (remove it). this breaks the shader if the local is read.
  //      - the init value is a simple constant, or with aggro inlining, it uses only builtin functions and variables never written to.
  private markUnwrittenVariablesWithSimpleInit(level: Level, [ty, defs]: Decl): void {
    if (Ast.typeIsExternal(ty)) return;
    for (const def of defs) {
      const varDecl = def.name.varDecl;
      if (varDecl === null) throw new Error(`unresolved declaration: ${Printer.debugDecl(def)}`);
      if (!def.name.toBeInlined && // already done in a previous pass
          !def.name.doNotInline &&
          !varDecl.isEverWrittenAfterDecl) {
        if (def.init === null) {
          // Top-level values are special. Keep them for now.
          // Never-written locals without init might be unused, but we don't know for sure here. Let safe inlining handle them.
        } else if (this.isSimpleEnoughToInline(def.init)) {
          // Never-written locals and globals are inlined when their value is "simple enough".
          // This can increase non-compressed size but decreases compressed size.
          const varKind = level === "TopLevel" ? "global" : "local";
          trace(this.options, `${locToS(def.name.loc)}: inlining ${varKind} variable '${Printer.debugDecl(def)}' because it's never written and has a 'simple' definition`);
          def.name.toBeInlined = true;
        }
      }
    }
  }

  private markSafelyInlinableVariables(li: readonly TopLevel[]): void {
    const mapStmt = (_env: Ast.MapEnv, stmt: Stmt): Stmt => {
      if (stmt.kind === "Block") this.markSafelyInlinableLocals(stmt.stmts);
      return stmt;
    };
    Ast.visitor(undefined, mapStmt).iterTopLevel(li);
  }

  private markSimpleInlinableVariables(li: readonly TopLevel[]): void {
    const mapStmt = (_env: Ast.MapEnv, stmt: Stmt): Stmt => {
      if (stmt.kind === "Decl") this.markUnwrittenVariablesWithSimpleInit("InFunc", stmt.decl);
      else if (stmt.kind === "ForD") this.markUnwrittenVariablesWithSimpleInit("InFunc", stmt.init);
      return stmt;
    };
    // Visit locals
    Ast.visitor(undefined, mapStmt).iterTopLevel(li);
    // Visit globals
    for (const tl of li) {
      if (tl.kind === "TLDecl") this.markUnwrittenVariablesWithSimpleInit("TopLevel", tl.decl);
    }
  }

  // --inline-single-use (port addition): a never-written global with a pure const init,
  // referenced exactly once outside any loop, is inlined into that use. Upstream inlines
  // globals only when the init is a literal, or anything const under aggressive inlining.
  private markSingleUseGlobals(li: readonly TopLevel[]): void {
    const allStmts: Stmt[] = [];
    const outsideLoops: Expr[] = [];
    for (const tl of li) {
      if (tl.kind === "Function") {
        allStmts.push(tl.body);
        collectExprsOutsideLoops(tl.body, outsideLoops);
      } else if (tl.kind === "TLDecl") {
        for (const def of tl.decl[1]) {
          if (def.init !== null) { allStmts.push(Ast.ExprStmt(def.init)); outsideLoops.push(def.init); }
        }
      }
    }
    const allReferences = this.countReferences(allStmts);
    const outsideLoopReferences = this.countReferences(outsideLoops.map((e) => Ast.ExprStmt(e)));

    const candidates = new Map<VarDecl, { def: Ast.DeclElt; initIdents: Ident[] }>();
    for (const tl of li) {
      if (tl.kind !== "TLDecl") continue;
      const [ty, defs] = tl.decl;
      if (Ast.typeIsExternal(ty) || ty.arraySizes.length > 0) continue;
      for (const def of defs) {
        const varDecl = def.name.varDecl;
        if (varDecl === null) throw new Error(`unresolved declaration: ${Printer.debugDecl(def)}`);
        if (def.init === null || def.sizes.length > 0 || def.name.toBeInlined || def.name.doNotInline || varDecl.isEverWrittenAfterDecl) continue;
        if ((allReferences.get(varDecl) ?? 0) !== 1 || (outsideLoopReferences.get(varDecl) ?? 0) !== 1) continue;
        const initIdents = new Analyzer().identUsesInStmt(IdentKind.Var, Ast.ExprStmt(def.init));
        if (!initIdents.every((i) => this.isEffectivelyConst(i)) || !Effects.isPure(def.init)) continue;
        candidates.set(varDecl, { def, initIdents });
      }
    }
    if (candidates.size === 0) return;

    // A use inside a function that something else calls may run many times, so a value that costs
    // work does not move there. An entry point is not such a function: nothing in the file calls
    // it, so its body runs once per invocation. That is a property of the call graph, not of
    // --no-renaming-list, which names what the application calls and may also name a helper.
    const called = new Set(new Analyzer().findFuncInfos(li).flatMap((n) => n.callSites.map((c) => c.prototype)));
    const usedInHelper = new Set<VarDecl>(); // the use is in a function that may itself run in a loop
    for (const tl of li) {
      if (tl.kind !== "Function" || !called.has(Ast.funPrototype(tl.funcType))) continue;
      const visitUse = (_env: Ast.MapEnv, e: Expr): Expr => {
        const r = resolvedVariableUse(e);
        if (r !== null && candidates.has(r[1])) usedInHelper.add(r[1]);
        return e;
      };
      Ast.visitor(visitUse).iterTopLevel([tl]);
    }

    for (const [varDecl, { def }] of candidates) {
      // The global is computed once per invocation; inlined into a helper that a loop calls it
      // would be computed on every call. Only a value without calls is cheap enough for that.
      if (usedInHelper.has(varDecl) && hasCall(def.init!)) {
        trace(this.options, `${locToS(def.name.loc)}: not inlining global variable '${Printer.debugDecl(def)}': its value calls a function and the use is not in an entry point`);
        continue;
      }
      trace(this.options, `${locToS(def.name.loc)}: inlining global variable '${Printer.debugDecl(def)}' because it's const and used only once`);
      def.name.toBeInlined = true;
    }
  }

  // A variable's init is copied to its uses; where a name the init reads is bound to another
  // variable at a use (a later local of that name, a parameter), the copy would be captured.
  // Upstream has this check for function bodies only (rule [A]): `float b=t.x; float t=0.; t+=b;`
  // inlined b into `t+=t.x`. Unmark every candidate with such a use, whichever rule marked it.
  private unmarkCapturedVariables(li: readonly TopLevel[]): void {
    const initIdents = new Map<VarDecl, Ident[]>();
    const visitUse = (env: Ast.MapEnv, e: Expr): Expr => {
      const r = resolvedVariableUse(e);
      if (r === null) return e;
      const [, vd] = r;
      const decl = vd.decl;
      if (!decl.name.toBeInlined || decl.init === null || decl.name.name.startsWith("i_")) return e;
      let idents = initIdents.get(vd);
      if (idents === undefined) { idents = new Analyzer().identUsesInStmt(IdentKind.Var, Ast.ExprStmt(decl.init)); initIdents.set(vd, idents); }
      // The candidate's own declaration may carry a name its init reads (`float d=map(p,d).x`,
      // the outer d): removing it uncovers that outer variable again, so it is not a capture.
      const capturedAt = (i: Ident): boolean => {
        const found = env.vars.get(i.name);
        return found !== undefined && found[1].name.varDecl !== i.varDecl && found[1].name.varDecl !== vd;
      };
      if (idents.some(capturedAt)) {
        trace(this.options, `${locToS(decl.name.loc)}: not inlining variable '${Printer.debugDecl(decl)}': a name in its value is bound to another variable at its use`);
        decl.name.toBeInlined = false;
      }
      return e;
    };
    Ast.visitor(visitUse).iterTopLevel(li);
  }

  markInlinableVariables(li: readonly TopLevel[]): void {
    this.markSafelyInlinableVariables(li);
    // "simple" inlining must come after "safe" inlining, because it must check that it's not going to inline a var already being inlined.
    this.markSimpleInlinableVariables(li);
    if (this.options.inlineSingleUse) this.markSingleUseGlobals(li);
    this.unmarkCapturedVariables(li);
  }
}


export class FunctionInlining {
  constructor(private readonly options: Options) {}

  // To ensure correctness, we verify if it's safe to inline.
  //
  // [A] Only inline a function if it never refers to a global function or variable by a name that is shadowed by a local variable in scope at the call site.
  // [B] Only inline a function if it has only one call site.
  //     Exception: if the body is "trivial" it will be inlined at all call sites.
  // [C] Only inline a function if it is a single expression return.
  //     This also ensures the function does not declare any locals.
  // [D] Only inline a function if it uses its 'in' parameters at most once,
  //     or if the parameter is used multiple times but the argument expression can be duplicated at the call site.
  //     No attempt is made to inline in other cases. For example, it would be correct to inline
  //     when the parameter is written but the argument is a lvalue that doesn't make any side effect and is not used after the call site.
  //     Repeating the expression could increase the shader size or decrease run time performance.
  // [E] Only inline a function if its 'in' parameters are never written to (through assignOps or calling an out or inout function or operator).
  //     No attempt is made to find if the passed argument is an lvalue that's never used after calling the function to inline.
  //     No attempt is made to copy the argument into a newly declared local variable at the call site to get correct writing semantics.
  // [F] Only inline a function if it has no 'out' or 'inout' parameters.
  //     'out' or 'inout' parameters must be lvalues, which simplifies things. But there are problems to watch out for.
  //     Evaluating them could have side effects (e.g. a[b++]), which is a problem if they are used more than once.
  //     If the 'out' parameters are read from, inlining can change the behavior.
  //     It's fine if 'out' parameters are written in more than one place.
  // [G] Only inline a function if the argument expressions are pure.
  //     Inlining can change the evaluation order of the arguments, and will remove unused arguments.
  //     This is fine when they are pure. Except in one case:
  //     BUG: Function inlining can delay the evaluation order of an argument expression that reads a global,
  //     and the global can be modified by the inlined function before it's evaluated as part of the argument.
  //         int g = 0; int foo(int a) { return ++g - a; } int main() { return foo(g); } // `foo(g)` is 1, but `g++ - g` would be 0
  private verifyVarsAndParams(funcInfo: FuncInfo, callSites: readonly CallSite[]): boolean {
    const paramUsageCounts = new Map<string, number>();
    let shadowedGlobal = false;
    let paramIsWritten = false;

    const visitVarUsesInBody = (_env: Ast.MapEnv, e: Expr): Expr => {
      const r = resolvedVariableUse(e);
      if (r !== null) {
        const [v, vd] = r;
        switch (vd.scope) {
          case "Local":
            throw new Error("There shouldn't be any locals in a function whose body is a single return statement.");
          case "Parameter":
            if (vd.isEverWrittenAfterDecl) {
              paramIsWritten = true;
            }
            paramUsageCounts.set(v.name, (paramUsageCounts.get(v.name) ?? 0) + 1);
            break;
          case "Global":
            if (callSites.some((callSite) => callSite.varsInScope.includes(v.name))) {
              shadowedGlobal = true;
            }
            break;
        }
      }
      return e;
    };
    Ast.visitor(visitVarUsesInBody).iterTopLevel([funcInfo.func]);

    if (paramIsWritten || // [E]
        shadowedGlobal // [A]
    ) return false;

    const canBeDuplicated = (e: Expr): boolean => {
      const r = resolvedVariableUse(e);
      if (r !== null) { // allow non-global variable reads
        const [v, vd] = r;
        return !v.isVarWrite && !(vd.scope === "Global");
      }
      return isTrivialExpr(e);
    };

    const paramNames = funcInfo.funcType.args.map(([, argDeclElts]) => {
      if (argDeclElts.length === 1) return argDeclElts[0].name.name;
      throw new Error("arguments have one declElt each.");
    });

    let hasAnyImpureArg = false;
    let cannotDuplicateArg = false;
    for (const callSite of callSites) {
      callSite.argExprs.forEach((argExpr, argIndex) => {
        if (!Effects.isPure(argExpr)) {
          hasAnyImpureArg = true;
        }
        const paramUsageCount = paramUsageCounts.get(paramNames[argIndex]) ?? 0;
        if (paramUsageCount > 1 && !canBeDuplicated(argExpr)) {
          cannotDuplicateArg = true;
        }
      });
    }

    const ok =
      !hasAnyImpureArg && // [G]
      !cannotDuplicateArg; // [D]
    return ok;
  }

  private tryMarkFunctionToInline(funcInfo: FuncInfo, callSites: readonly CallSite[]): void {
    if (!funcInfo.funcType.fName.doNotInline && this.verifyVarsAndParams(funcInfo, callSites)) {
      // Mark only the function's ident, not the call sites.
      // simplifyExpr can't rely on call sites to be marked anyway, to support the function inline pragma.
      trace(this.options, `${locToS(funcInfo.funcType.fName.loc)}: inlining function '${Printer.debugFunc(funcInfo.funcType)}' into ${callSites.length} call sites`);
      funcInfo.funcType.fName.toBeInlined = true;
    }
  }

  markInlinableFunctions(code: readonly TopLevel[]): void {
    const funcInfos = new Analyzer().findFuncInfos(code);
    for (const funcInfo of funcInfos) {
      const canBeRenamed = !this.options.noRenamingList.includes(funcInfo.name); // noRenamingList includes "main"
      if (canBeRenamed && funcInfo.isResolvable) {
        if (!Ast.funHasOutOrInoutParams(funcInfo.funcType)) { // [F]
          // Find calls to this function. This works because we checked that the function is not overloaded ambiguously.
          const prototype = Ast.funPrototype(funcInfo.funcType);
          const callSites = funcInfos.flatMap((n) => n.callSites)
            .filter((callSite) => callSite.prototype === prototype);
          if (callSites.length > 0) { // Unused function elimination is not handled here
            const stmts = Ast.asStmtList(funcInfo.body);
            if (stmts.length === 1 && stmts[0].kind === "Jump" && stmts[0].keyword === "return" && stmts[0].expr !== null) { // [C]
              const body = stmts[0].expr;
              if (callSites.length === 1 || isTrivialExpr(body)) { // [B]
                this.tryMarkFunctionToInline(funcInfo, callSites);
              }
            }
          }
        }
      }
    }
  }
}


interface Inlining {
  func: TopLevel;
  argIndex: number;
  varDecl: VarDecl;
  argExpr: Expr;
}
// Inline the argument of a function call into the function body.
export class ArgumentInlining {
  constructor(private readonly options: Options) {}

  private isInlinableExpr(e: Expr): boolean {
    // This is different that purity: reading a variable is pure, but non-inlinable in general.
    const r = resolvedVariableUse(e);
    if (r !== null) {
      // 'in' uniforms are read-only globals, they can be inlined
      const vd = r[1];
      return vd.scope === "Global" && !vd.isEverWrittenAfterDecl && !vd.decl.name.doNotInline;
    }
    switch (e.kind) {
      case "Var": return e.ident.name === "true" || e.ident.name === "false";
      case "Int":
      case "Float": return true;
      case "FunCall": {
        const varCall = asVarCall(e);
        if (varCall !== null) return Builtin.pureBuiltinFunctions.has(varCall.ident.name) && varCall.args.every((a) => this.isInlinableExpr(a));
        const opCall = asOpCall(e);
        if (opCall !== null) return !Builtin.assignOps.has(opCall.op) && opCall.args.every((a) => this.isInlinableExpr(a));
        return false;
      }
      default: return false;
    }
  }

  // The inlined expression becomes the init of a local declared at the top of the body, where a
  // parameter of the same name as a global it reads would capture it (not in upstream, which
  // declares `float t=uT;` in a body whose other parameter is `uT`). The parameter being inlined
  // may carry the name: it is removed.
  // Whether the argument expression can be substituted into the function's body, which it is
  // about to become part of. Two things stop it, both about the names it reads once it is there:
  //
  //   another parameter of the same function would capture one of them;
  //   a global it reads is declared after the function (not in upstream: three.js passes
  //     `uniform sampler2D envMap`, declared after `bilinearCubeUV(sampler2D envMap, ...)`, and a
  //     sampler parameter can only be replaced by the global itself);
  //   a global it reads is declared inside a `#if` region at top level (three.js: `uniform vec3
  //     lightProbe[9]` under `#if defined( USE_LIGHT_PROBES )`, passed from a call under the same
  //     condition into `getLightProbeIrradiance`, whose body is compiled whatever the define).
  //
  // All read the same list of identifiers, so it is gathered once. `globalPosition` and
  // `conditional` are indexed once per findInlinings call rather than once per candidate.
  private argumentCanMoveIntoBody(argExpr: Expr, funcInfo: FuncInfo, argDecl: Ast.DeclElt, funcIndex: number, globalPosition: Map<VarDecl, number>, conditional: Set<Ast.DeclElt>): boolean {
    const params = new Set(Ast.funParameters(funcInfo.funcType).map(([, d]) => d.name.name).filter((n) => n !== argDecl.name.name));
    const idents = new Analyzer().identUsesInStmt(IdentKind.Var, Ast.ExprStmt(argExpr));
    return idents.every((i) => !params.has(i.name)
      && (i.varDecl === null || i.varDecl.scope !== "Global" || ((globalPosition.get(i.varDecl) ?? -1) < funcIndex && !conditional.has(i.varDecl.decl))));
  }

  // Find when functions are always called with the same trivial expr, that can be inlined into the function body.
  private findInlinings(code: readonly TopLevel[]): Inlining[] {
    const argInlinings: Inlining[] = [];
    new Analyzer().resolve(code);
    new Analyzer().markWrites(code);
    const funcInfos = new Analyzer().findFuncInfos(code);
    const globalPosition = new Map<VarDecl, number>();
    code.forEach((tl, i) => { if (tl.kind === "TLDecl") for (const e of tl.decl[1]) { const vd = e.name.varDecl; if (vd !== null) globalPosition.set(vd, i); } });
    const conditional = Ast.conditionalGlobals(code);
    for (const funcInfo of funcInfos) {
      const canBeRenamed = !this.options.noRenamingList.includes(funcInfo.name); // noRenamingList includes "main"
      // If the function is overloaded, removing a parameter could conflict with another overload.
      if (canBeRenamed && funcInfo.isOverloaded) {
        const prototype = Ast.funPrototype(funcInfo.funcType);
        const callSites = funcInfos.flatMap((n) => n.callSites).filter((n) => n.prototype === prototype);
        Ast.funParameters(funcInfo.funcType).forEach(([, argDecl], argIndex) => {
          const varDecl = argDecl.name.varDecl;
          if (varDecl !== null && !Ast.typeIsOutOrInout(varDecl.ty)) { // Only inline 'in' parameters.
            const argExprs = distinctExprs(callSites.map((c) => c.argExprs[argIndex]));
            if (argExprs.length === 1 && this.isInlinableExpr(argExprs[0]) && this.argumentCanMoveIntoBody(argExprs[0], funcInfo, argDecl, code.indexOf(funcInfo.func), globalPosition, conditional)) { // The argExpr must always be the same at all call sites.
              const argExpr = argExprs[0];
              trace(this.options, `${locToS(varDecl.decl.name.loc)}: inlining expression '${Printer.exprToS(argExpr)}' into argument '${Printer.debugDecl(varDecl.decl)}' of '${Printer.debugFunc(funcInfo.funcType)}'`);
              argInlinings.unshift({ func: funcInfo.func, argIndex, varDecl, argExpr });
            }
          }
        });
      }
    }
    return argInlinings;
  }

  apply(didInline: { value: boolean }, code: TopLevel[]): TopLevel[] {
    const argInlinings = this.findInlinings(code);

    const removeInlined = <T>(func: TopLevel, list: readonly T[]): T[] =>
      list.filter((_, idx) => !argInlinings.some((inl) => inl.func === func && inl.argIndex === idx));

    const applyExpr = (_env: Ast.MapEnv, e: Expr): Expr => {
      const varCall = asVarCall(e);
      if (varCall !== null) {
        // Remove the argument expression from the call site.
        const d = varCall.ident.declaration;
        if (d.kind === "UserFunction") return Ast.FunCall(Ast.Var(varCall.ident), removeInlined(d.decl.func, varCall.args));
        return e;
      }
      return e;
    };

    const applyTopLevel = (f: TopLevel): TopLevel => {
      if (f.kind !== "Function") return f;
      // Handle argument inlining for other functions called by f.
      const [, body] = Ast.visitor(applyExpr).mapStmt(Ast.FunctionRootLevel(f.funcType), f.body);
      // Handle argument inlining for f. Remove the parameter from the declaration.
      const fct = { ...f.funcType, args: removeInlined(f, f.funcType.args) };
      // Sampler types can be declared as globals or as function parameters but not as locals.
      // This means we can inline them into the body of the function only if we inline them further.
      for (const inl of argInlinings) {
        const name = inl.varDecl.ty.name;
        if (name.kind === "TypeName" && Builtin.isSamplerType(name.ident.name)) inl.varDecl.decl.name.toBeInlined = true;
      }
      // --inline-single-use (port addition): an argument that reads a never-written global
      // is substituted into the body instead of declared as a local, when n uses of its name
      // cost no more than the declaration plus n one-letter uses. The parameter must never
      // be written: the local is a writable copy, the global is not. And the global's name
      // must not be captured by another parameter or a local at any use of the parameter.
      if (this.options.inlineSingleUse) {
        const uses = countReferences([body]);
        const captured = new Set<VarDecl>();
        const visitUse = (env: Ast.MapEnv, e: Expr): Expr => {
          const r = resolvedVariableUse(e);
          if (r === null) return e;
          for (const inl of argInlinings) {
            if (inl.func !== f || inl.varDecl !== r[1]) continue;
            const g = resolvedVariableUse(inl.argExpr);
            // The parameter itself may carry the global's name: dropping it uncovers the global.
            if (g !== null && isShadowedAt(env, g[0].name, inl.varDecl)) captured.add(inl.varDecl);
          }
          return e;
        };
        Ast.visitor(visitUse).iterTopLevel([f]);
        for (const inl of argInlinings) {
          if (inl.func !== f || inl.varDecl.isEverWrittenAfterDecl || inl.varDecl.decl.name.hiddenUses) continue;
          const r = resolvedVariableUse(inl.argExpr);
          if (r === null) continue;
          if (captured.has(inl.varDecl)) {
            trace(this.options, `${locToS(inl.varDecl.decl.name.loc)}: not substituting '${r[0].name}' for argument '${Printer.debugDecl(inl.varDecl.decl)}': the name is shadowed in the body`);
            continue;
          }
          const n = uses.get(inl.varDecl) ?? 0;
          const nameLen = r[0].name.length;
          const tyName = inl.varDecl.ty.name;
          const tyLen = tyName.kind === "TypeName" ? tyName.ident.name.length : 5;
          if (n * nameLen <= tyLen + 4 + nameLen + n) {
            trace(this.options, `${locToS(inl.varDecl.decl.name.loc)}: substituting '${r[0].name}' for argument '${Printer.debugDecl(inl.varDecl.decl)}' rather than declaring it`);
            inl.varDecl.decl.name.toBeInlined = true;
          }
        }
      }
      // Handle argument inlining for f. Insert in front of the body a declaration for each inlined argument.
      const decls = argInlinings
        .filter((inl) => inl.func === f)
        // A `const in` parameter's local copy cannot stay const: its init is the argument, often
        // a uniform (`const mat4 m = modelMatrix;` is an error). Upstream keeps the qualifier.
        .map((inl) => Ast.DeclStmt([
          { ...inl.varDecl.ty, typeQ: [] },
          [{ ...inl.varDecl.decl, init: inl.argExpr }],
        ]));
      return Ast.Function(fct, Ast.Block([...decls, ...Ast.asStmtList(body)]));
    };

    if (argInlinings.length === 0) {
      return code;
    } else {
      const newCode = code.map(applyTopLevel);
      didInline.value = true;
      return newCode;
    }
  }
}

/** F# List.distinct on Expr (structural equality), keeping first-occurrence order. */
function distinctExprs(exprs: readonly Expr[]): Expr[] {
  const res: Expr[] = [];
  for (const e of exprs) {
    if (!res.some((r) => Ast.exprEquals(r, e))) res.push(e);
  }
  return res;
}
