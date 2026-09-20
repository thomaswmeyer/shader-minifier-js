// Port of Minifier/ast.fs
import * as Builtin from "./builtin.js";
import type { Options } from "./options.js";

export type VarScope = "Global" | "Local" | "Parameter";

export interface Location { line: number; col: number }
export const noLoc: Location = { line: -1, col: -1 };

// a Var in the AST can be a read, a write, both, or neither.
export interface Access {
  isRead: boolean;
  isWrite: boolean; // A declaration's assignment is not counted as a write.
}
export const accessToString = (a: Access): string => (a.isRead ? "r" : "-") + (a.isWrite ? "w" : "-");

export type Declaration =
  | { kind: "Unknown" }
  | { kind: "Variable"; decl: VarDecl }
  | { kind: "UserFunction"; decl: FunDecl }
  | { kind: "BuiltinFunction" }
  | { kind: "UnknownFunction" }; // ambiguous (type-based) overloading, builtin unknown to minifier, or builtin redefinition

export const UnknownDeclaration: Declaration = { kind: "Unknown" };
export const BuiltinFunctionDeclaration: Declaration = { kind: "BuiltinFunction" };
export const UnknownFunctionDeclaration: Declaration = { kind: "UnknownFunction" };

// An Ident is the name of a variable, function, struct, interface block, or type, or struct field.
// It is a mutable object shared by every AST location that refers to it; the renamer relies on this.
export class Ident {
  private _name: string;
  readonly oldName: string;
  toBeInlined: boolean;
  // This prefix disables function inlining and variable inlining.
  doNotInline: boolean;
  // Two different reasons an identifier is not the minifier's to change, kept apart because the
  // consumers of each are different.
  //
  // keepName: the name is part of an interface something outside the shader reads. An application
  // looks up a uniform and its struct fields by name; GL matches a struct-typed uniform between
  // two stages by its type name; a field named like a swizzle (`hex.q`) must stay legible as a
  // field. Only the renamer cares, and only about the name: such a declaration is still free to be
  // inlined or removed if nothing uses it.
  keepName = false;
  // hiddenUses: text this pass cannot read refers to the name, so the uses it can count are not
  // all of them. A kept #define body is the case: the macro's text is the use the minifier never
  // sees. Removal, reuse and inlining must all leave such a declaration alone; the name has to
  // survive too, so whoever sets this sets keepName as well.
  hiddenUses = false;
  loc: Location;
  isVarWrite = false;
  declaration: Declaration = UnknownDeclaration;

  constructor(name: string, loc: Location = noLoc) {
    this._name = name;
    this.oldName = name;
    this.toBeInlined = name.startsWith("i_");
    this.doNotInline = name.startsWith("noinline_");
    this.loc = loc;
  }

  get name(): string { return this._name; }
  rename(n: string): void { this._name = n; }

  get varDecl(): VarDecl | null {
    return this.declaration.kind === "Variable" ? this.declaration.decl : null;
  }

  // Real identifiers cannot start with a digit, but the temporary ids of the rename pass are numbers.
  get isUniqueId(): boolean { return this._name.length > 0 && this._name[0] >= "0" && this._name[0] <= "9"; }

  toString(): string { return `<${this.oldName}>`; }
}

/** F# Ident equality: by current name. */
export const identEquals = (a: Ident, b: Ident): boolean => a.name === b.name;

export class VarDecl {
  isEverWrittenAfterDecl = false;
  constructor(readonly ty: Type, readonly decl: DeclElt, readonly scope: VarScope) {}
}

export class FunDecl {
  hasExternallyVisibleSideEffects = false;
  constructor(readonly func: TopLevel, readonly funcType: FunctionType) {}
}

export type JumpKeyword = "break" | "continue" | "discard" | "return";
export function jumpKeywordFromString(s: string): JumpKeyword {
  if (s === "break" || s === "continue" || s === "discard" || s === "return") return s;
  throw new Error("not a keyword: " + s);
}

export type Expr =
  | { kind: "Int"; value: number; suffix: string }
  | { kind: "Float"; value: number; suffix: string }
  | { kind: "Var"; ident: Ident } // 'Var' can be an identifier referencing a variable or a function! (or a macro)
  | { kind: "Op"; op: string } // Can only occur as a FunCall's first Expr.
  | { kind: "FunCall"; fn: Expr; args: Expr[] } // The first Expr of a FunCall can be: Op, Var, Subscript, or Dot.
  | { kind: "Subscript"; arr: Expr; index: Expr | null }
  | { kind: "Dot"; expr: Expr; field: Ident }
  | { kind: "VerbatimExp"; text: string }
  // A `#if`/`#elif`/`#else` chain standing where one expression does, which engine shaders write
  // inside an argument list (three.js: `getTangentFrame(-vViewPosition, normal,\n#if defined(
  // USE_NORMALMAP )\n vNormalMapUv\n#elif ...`). Each branch holds the whole directive line as
  // written and the expression it guards; the last branch of an `#else` has `directive` for the
  // `#else` line itself. The compiler's own preprocessor picks a branch, so the minifier must keep
  // all of them and may not assume any one is taken.
  | { kind: "Conditional"; branches: { directive: string; expr: Expr }[] };
// Examples:
// * "i++" = FunCall (Op "$++", [Var ident: i])
// * "sin(1.0)" = FunCall (Var ident: sin, [Float (1.0, "")])
// * "float[2](8.,9.)" = FunCall (Subscript (Var ident: float, Some (Int (2, ""))), [Float (8.0, ""); Float (9.0, "")])
// * "array.length()" = FunCall (Dot (Var ident: array, "length"), [])

export type ExprKind = Expr["kind"];
export type ExprOf<K extends ExprKind> = Extract<Expr, { kind: K }>;

export const Int = (value: number, suffix = ""): Expr => ({ kind: "Int", value, suffix });
export const Float = (value: number, suffix = ""): Expr => ({ kind: "Float", value, suffix });
export const Var = (ident: Ident): Expr => ({ kind: "Var", ident });
export const Op = (op: string): Expr => ({ kind: "Op", op });
export const FunCall = (fn: Expr, args: Expr[]): Expr => ({ kind: "FunCall", fn, args });
export const OpCall = (op: string, args: Expr[]): Expr => FunCall(Op(op), args);
export const Subscript = (arr: Expr, index: Expr | null): Expr => ({ kind: "Subscript", arr, index });
export const Dot = (expr: Expr, field: Ident): Expr => ({ kind: "Dot", expr, field });
export const VerbatimExp = (text: string): Expr => ({ kind: "VerbatimExp", text });
export const Conditional = (branches: { directive: string; expr: Expr }[]): Expr => ({ kind: "Conditional", branches });

/** Matches FunCall(Op op, args); returns null otherwise. */
export function asOpCall(e: Expr): { op: string; args: Expr[] } | null {
  if (e.kind === "FunCall" && e.fn.kind === "Op") return { op: e.fn.op, args: e.args };
  return null;
}
/** Matches FunCall(Var v, args); returns null otherwise. */
export function asVarCall(e: Expr): { ident: Ident; args: Expr[] } | null {
  if (e.kind === "FunCall" && e.fn.kind === "Var") return { ident: e.fn.ident, args: e.args };
  return null;
}
export const isVarNamed = (e: Expr, name: string): boolean => e.kind === "Var" && e.ident.name === name;

export type TypeSpec =
  | { kind: "TypeName"; ident: Ident }
  | { kind: "TypeBlock"; block: StructOrInterfaceBlock }; // an anonymous struct, or an interface block with an instance name

export const TypeName = (ident: Ident): TypeSpec => ({ kind: "TypeName", ident });
export const TypeBlock = (block: StructOrInterfaceBlock): TypeSpec => ({ kind: "TypeBlock", block });

export type StructMember =
  | { kind: "MemberVariable"; decl: Decl }
;

export type BlockType = { kind: "Struct" } | { kind: "InterfaceBlock"; prefix: string }; // things like "uniform" or "layout(...)"
export const StructBlockType: BlockType = { kind: "Struct" };

// An interface block followed by an instance name (in a TLDecl), like structs, declares an instance.
// An interface block without an instance name (in a TypeDecl), unlike structs, introduces a set of external global variables.
// struct or interface block, e.g. struct Point<T> : Base { int x; int y; T item; }
export interface StructOrInterfaceBlock {
  blockType: BlockType;
  name: Ident | null; // Point
  members: StructMember[];
}

export interface Type {
  name: TypeSpec; // e.g. int
  typeQ: string[]; // type qualifiers, e.g. const, uniform, out, inout...
  arraySizes: Expr[]; // e.g. [3][5]
}

export const typeIsInOrInout = (t: Type): boolean => !t.typeQ.includes("out");
export const typeIsConst = (t: Type): boolean => t.typeQ.includes("const");
export const typeIsOutOrInout = (t: Type): boolean => t.typeQ.includes("out") || t.typeQ.includes("inout");
export const typeAccess = (t: Type): Access => ({ isRead: typeIsInOrInout(t), isWrite: typeIsOutOrInout(t) });
export const typeIsExternal = (t: Type): boolean => t.typeQ.some((q) => Builtin.externalQualifiers.has(q));
export const typeIsScalar = (t: Type): boolean =>
  t.name.kind === "TypeName" && Builtin.builtinScalarTypes.has(t.name.ident.oldName);
export const typeIsScalarOrVector = (t: Type): boolean =>
  t.name.kind === "TypeName" &&
  (Builtin.builtinScalarTypes.has(t.name.ident.oldName) || Builtin.builtinVectorTypes.has(t.name.ident.oldName));

export interface DeclElt {
  name: Ident; // e.g. foo
  sizes: Expr[]; // e.g. [3]
  init: Expr | null; // e.g. = f(x)
}

export type Decl = [ty: Type, elts: DeclElt[]];

export type CaseLabel = { kind: "Case"; expr: Expr } | { kind: "Default" };
export interface SwitchCase { label: CaseLabel; stmts: Stmt[] }

export type Stmt =
  | { kind: "Block"; stmts: Stmt[] }
  | { kind: "Decl"; decl: Decl }
  | { kind: "Expr"; expr: Expr }
  | { kind: "If"; cond: Expr; then: Stmt; else: Stmt | null }
  | { kind: "ForD"; init: Decl; cond: Expr | null; inc: Expr | null; body: Stmt } // for loop starting with a declaration
  | { kind: "ForE"; init: Expr | null; cond: Expr | null; inc: Expr | null; body: Stmt } // for loop starting with an expression
  | { kind: "While"; cond: Expr; body: Stmt }
  | { kind: "DoWhile"; cond: Expr; body: Stmt }
  | { kind: "Jump"; keyword: JumpKeyword; expr: Expr | null } // break, continue, return (expr)?, discard
  | { kind: "Verbatim"; text: string }
  | { kind: "Directive"; parts: string[] } // ["#define"; "name"; "value"]
  | { kind: "Switch"; expr: Expr; cases: SwitchCase[] };

export const Block = (stmts: Stmt[]): Stmt => ({ kind: "Block", stmts });
export const DeclStmt = (decl: Decl): Stmt => ({ kind: "Decl", decl });
export const ExprStmt = (expr: Expr): Stmt => ({ kind: "Expr", expr });
export const If = (cond: Expr, then: Stmt, else_: Stmt | null): Stmt => ({ kind: "If", cond, then, else: else_ });
export const ForD = (init: Decl, cond: Expr | null, inc: Expr | null, body: Stmt): Stmt => ({ kind: "ForD", init, cond, inc, body });
export const ForE = (init: Expr | null, cond: Expr | null, inc: Expr | null, body: Stmt): Stmt => ({ kind: "ForE", init, cond, inc, body });
export const While = (cond: Expr, body: Stmt): Stmt => ({ kind: "While", cond, body });
export const DoWhile = (cond: Expr, body: Stmt): Stmt => ({ kind: "DoWhile", cond, body });
export const Jump = (keyword: JumpKeyword, expr: Expr | null): Stmt => ({ kind: "Jump", keyword, expr });
export const Verbatim = (text: string): Stmt => ({ kind: "Verbatim", text });
export const Directive = (parts: string[]): Stmt => ({ kind: "Directive", parts });
export const Switch = (expr: Expr, cases: SwitchCase[]): Stmt => ({ kind: "Switch", expr, cases });

export const asStmtList = (s: Stmt): Stmt[] => (s.kind === "Block" ? s.stmts : [s]);

export interface FunctionType {
  retType: Type;
  fName: Ident;
  args: Decl[];
}

export const funHasOutOrInoutParams = (f: FunctionType): boolean =>
  f.args.some(([ty]) => ty.typeQ.includes("out") || ty.typeQ.includes("inout"));
/** (name, arity) key, as a string. Uses the current (possibly renamed) name, like upstream. */
export const funPrototype = (f: FunctionType): string => `${f.fName.name}/${f.args.length}`;
export const prototypeKey = (name: string, arity: number): string => `${name}/${arity}`;
export function funParameters(f: FunctionType): [Type, DeclElt][] {
  return f.args.map(([ty, elts]) => {
    if (elts.length !== 1) throw new Error("invalid declElt for function argument");
    return [ty, elts[0]];
  });
}

export type TopLevel =
  | { kind: "TLVerbatim"; text: string }
  | { kind: "TLDirective"; parts: string[]; loc: Location }
  | { kind: "Function"; funcType: FunctionType; body: Stmt }
  | { kind: "TLDecl"; decl: Decl }
  | { kind: "TypeDecl"; block: StructOrInterfaceBlock } // named struct, or interface block that introduce a set of external global variables.
  | { kind: "Precision"; ty: Type };

export const TLVerbatim = (text: string): TopLevel => ({ kind: "TLVerbatim", text });
export const TLDirective = (parts: string[], loc: Location): TopLevel => ({ kind: "TLDirective", parts, loc });
export const Function = (funcType: FunctionType, body: Stmt): TopLevel => ({ kind: "Function", funcType, body });
export const TLDecl = (decl: Decl): TopLevel => ({ kind: "TLDecl", decl });
export const TypeDecl = (block: StructOrInterfaceBlock): TopLevel => ({ kind: "TypeDecl", block });
export const Precision = (ty: Type): TopLevel => ({ kind: "Precision", ty });

export const makeType = (name: TypeSpec, typeQ: string[], arraySizes: Expr[]): Type => ({ name, typeQ, arraySizes });
export const makeDecl = (name: Ident, sizes: Expr[], init: Expr | null): DeclElt => ({ name, sizes, init });
export const makeFunctionType = (retType: Type, fName: Ident, args: Decl[]): FunctionType => ({ retType, fName, args });

// An ExportedName is a name that is used outside the shader code (e.g. uniform and attribute
// values). We need to provide accessors for the developer (e.g. create macros for C/C++).
export type ExportPrefix = "Variable";
export interface ExportedName {
  prefix: ExportPrefix;
  name: string;
  newName: string;
}

export const mangleToAscii = (s: string): string => s.replace(/[^a-zA-Z_0-9]/g, "_"); // é -> _
export const mangleToUnicode = (s: string): string => s.replace(/[^\p{L}\p{Nd}_]/gu, "_"); // é -> é

export interface Shader {
  filename: string;
  code: TopLevel[];
  forbiddenNames: string[];
  pinnedNames: string[]; // identifiers named in #define bodies, and the field names after a dot; see Ident.hiddenUses
  pinnedFields: string[];
  reorderFunctions: boolean; // set to true if we saw a forward declaration
}
export const shaderMangledFilename = (s: Shader): string => mangleToUnicode(basename(s.filename));
export function basename(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i < 0 ? path : path.slice(i + 1);
}

// ---------------------------------------------------------------------------
// Structural equality helpers (F# uses structural equality on records/unions).

export function exprEquals(a: Expr, b: Expr): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "Int": case "Float": {
      const bb = b as typeof a;
      return a.value === bb.value && a.suffix === bb.suffix;
    }
    case "Var": return a.ident.name === (b as typeof a).ident.name;
    case "Op": return a.op === (b as typeof a).op;
    case "FunCall": { const bb = b as typeof a; return exprEquals(a.fn, bb.fn) && exprListEquals(a.args, bb.args); }
    case "Subscript": {
      const bb = b as typeof a;
      return exprEquals(a.arr, bb.arr) && (a.index === null ? bb.index === null : bb.index !== null && exprEquals(a.index, bb.index));
    }
    case "Dot": { const bb = b as typeof a; return exprEquals(a.expr, bb.expr) && a.field.name === bb.field.name; }
    case "VerbatimExp": return a.text === (b as typeof a).text;
    case "Conditional": {
      const bb = b as typeof a;
      return a.branches.length === bb.branches.length
        && a.branches.every((x, i) => x.directive === bb.branches[i].directive && exprEquals(x.expr, bb.branches[i].expr));
    }
  }
}
export const exprListEquals = (a: Expr[], b: Expr[]): boolean => a.length === b.length && a.every((e, i) => exprEquals(e, b[i]));

export function typeSpecEquals(a: TypeSpec, b: TypeSpec): boolean {
  if (a.kind === "TypeName" && b.kind === "TypeName") return a.ident.name === b.ident.name;
  if (a.kind === "TypeBlock" && b.kind === "TypeBlock") return a.block === b.block;
  return false;
}
export const stringListEquals = (a: string[], b: string[]): boolean => a.length === b.length && a.every((s, i) => s === b[i]);
export function typeEquals(a: Type, b: Type): boolean {
  return typeSpecEquals(a.name, b.name) && stringListEquals(a.typeQ, b.typeQ) && exprListEquals(a.arraySizes, b.arraySizes);
}

// ---------------------------------------------------------------------------
// MapEnv is a kind of visitor that applies transformations to statements and expressions,
// while also collecting visible variable and function declarations along the way.

export type BlockLevel = { kind: "FunctionRoot"; fn: FunctionType } | { kind: "Nested" } | { kind: "Unknown" };
export const NestedLevel: BlockLevel = { kind: "Nested" };
export const UnknownLevel: BlockLevel = { kind: "Unknown" };
export const FunctionRootLevel = (fn: FunctionType): BlockLevel => ({ kind: "FunctionRoot", fn });

export type Level = "TopLevel" | "InFunc";

export type ExprMapper = (env: MapEnv, e: Expr) => Expr;
export type StmtMapper = (env: MapEnv, s: Stmt) => Stmt;

export class MapEnv {
  constructor(
    readonly fExpr: ExprMapper,
    readonly fStmt: StmtMapper,
    readonly vars: ReadonlyMap<string, [Type, DeclElt]>,
    // This doesn't support type-based disambiguation of user-defined function overloading
    readonly fns: ReadonlyMap<string, [FunctionType, Stmt][]>,
    readonly blockLevel: BlockLevel,
    readonly options: Options,
  ) {}

  private with(changes: { vars?: ReadonlyMap<string, [Type, DeclElt]>; fns?: ReadonlyMap<string, [FunctionType, Stmt][]>; blockLevel?: BlockLevel }): MapEnv {
    return new MapEnv(this.fExpr, this.fStmt, changes.vars ?? this.vars, changes.fns ?? this.fns, changes.blockLevel ?? this.blockLevel, this.options);
  }

  withVar(name: string, ty: Type, decl: DeclElt): MapEnv {
    const vars = new Map(this.vars);
    vars.set(name, [ty, decl]);
    return this.with({ vars });
  }

  withVars(vars: ReadonlyMap<string, [Type, DeclElt]>): MapEnv { return this.with({ vars }); }
  withBlockLevel(blockLevel: BlockLevel): MapEnv { return this.with({ blockLevel }); }

  private withFunction(fct: FunctionType, body: Stmt, replaceMostRecentOverload: boolean): MapEnv {
    const key = funPrototype(fct);
    const oldFnsList = this.fns.get(key) ?? [];
    const newFnsList: [FunctionType, Stmt][] = [[fct, body], ...(replaceMostRecentOverload ? oldFnsList.slice(1) : oldFnsList)];
    const fns = new Map(this.fns);
    fns.set(key, newFnsList);
    return this.with({ fns });
  }

  foldList<T>(fct: (env: MapEnv, item: T) => [MapEnv, T], li: readonly T[]): [MapEnv, T[]] {
    let env: MapEnv = this;
    const res = li.map((i) => {
      const [newEnv, x] = fct(env, i);
      env = newEnv;
      return x;
    });
    return [env, res];
  }

  // Applies env.fExpr recursively on all nodes of an expression.
  iterExpr(e: Expr): void { this.mapExpr(e); }
  mapExpr(e: Expr): Expr {
    switch (e.kind) {
      case "FunCall": return this.fExpr(this, FunCall(this.mapExpr(e.fn), e.args.map((a) => this.mapExpr(a))));
      case "Subscript": return this.fExpr(this, Subscript(this.mapExpr(e.arr), e.index === null ? null : this.mapExpr(e.index)));
      case "Dot": return this.fExpr(this, Dot(this.mapExpr(e.expr), e.field));
      case "Conditional": return this.fExpr(this, Conditional(e.branches.map((b) => ({ ...b, expr: this.mapExpr(b.expr) }))));
      default: return this.fExpr(this, e);
    }
  }

  mapDecl([ty, vars]: Decl): [MapEnv, Decl] {
    const aux = (env: MapEnv, decl: DeclElt): [MapEnv, DeclElt] => {
      // First visit the initialization value, then add the decl to the env
      // e.g. in `float x = x + 1`, the two `x` are not the same!
      const ret: DeclElt = {
        ...decl,
        sizes: decl.sizes.map((s) => env.mapExpr(s)),
        init: decl.init === null ? null : env.mapExpr(decl.init),
      };
      return [env.withVar(decl.name.name, ty, decl), ret];
    };
    const [env, newVars] = this.foldList(aux, vars);
    return [env, [ty, newVars]];
  }

  iterStmt(blockLevel: BlockLevel, stmt: Stmt): void { this.mapStmt(blockLevel, stmt); }
  mapStmt(blockLevel: BlockLevel, stmt: Stmt): [MapEnv, Stmt] {
    const mapStmtNested = (env: MapEnv, s: Stmt): [MapEnv, Stmt] => env.mapStmt(NestedLevel, s);
    const env: MapEnv = this.withBlockLevel(NestedLevel);
    const aux = (): [MapEnv, Stmt] => {
      switch (stmt.kind) {
        case "Block": {
          const [, stmts] = env.foldList(mapStmtNested, stmt.stmts);
          return [env, Block(stmts)];
        }
        case "Expr": return [env, ExprStmt(env.mapExpr(stmt.expr))];
        case "Decl": {
          const [env2, res] = env.mapDecl(stmt.decl);
          return [env2, DeclStmt(res)];
        }
        case "If":
          return [env, If(env.mapExpr(stmt.cond), mapStmtNested(env, stmt.then)[1], stmt.else === null ? null : mapStmtNested(env, stmt.else)[1])];
        case "While": return [env, While(env.mapExpr(stmt.cond), mapStmtNested(env, stmt.body)[1])];
        case "DoWhile": return [env, DoWhile(env.mapExpr(stmt.cond), mapStmtNested(env, stmt.body)[1])];
        case "ForD": {
          const [env2, decl] = env.mapDecl(stmt.init);
          const res = ForD(decl, stmt.cond === null ? null : env2.mapExpr(stmt.cond), stmt.inc === null ? null : env2.mapExpr(stmt.inc), mapStmtNested(env2, stmt.body)[1]);
          return [env, res]; // a GLSL for-initializer does not stay in scope after the loop
        }
        case "ForE":
          return [env, ForE(
            stmt.init === null ? null : env.mapExpr(stmt.init),
            stmt.cond === null ? null : env.mapExpr(stmt.cond),
            stmt.inc === null ? null : env.mapExpr(stmt.inc),
            mapStmtNested(env, stmt.body)[1])];
        case "Jump": return [env, Jump(stmt.keyword, stmt.expr === null ? null : env.mapExpr(stmt.expr))];
        case "Verbatim": case "Directive": return [env, stmt];
        case "Switch": {
          const mapCase = (c: SwitchCase): SwitchCase => {
            const label: CaseLabel = c.label.kind === "Case" ? { kind: "Case", expr: env.mapExpr(c.label.expr) } : c.label;
            const [, stmts] = env.foldList(mapStmtNested, c.stmts);
            return { label, stmts };
          };
          return [env, Switch(env.mapExpr(stmt.expr), stmt.cases.map(mapCase))];
        }
      }
    };
    const [env2, res] = aux();
    const env3 = env2.withBlockLevel(blockLevel);
    return [env3, env3.fStmt(env3, res)];
  }

  iterTopLevel(li: readonly TopLevel[]): void { this.mapTopLevel(li); }
  mapTopLevel(li: readonly TopLevel[]): TopLevel[] {
    const [, res] = this.foldList((env: MapEnv, tl: TopLevel): [MapEnv, TopLevel] => {
      switch (tl.kind) {
        case "TLDecl": {
          const [env2, res] = env.mapDecl(tl.decl);
          return [env2, TLDecl(res)];
        }
        case "Function": {
          let fct = tl.funcType;
          let body = tl.body;
          // Back up the vars without the parameters.
          const varsWithoutParameters = env.vars;
          // Add the function to env.fns, to have it when transforming the parameters.
          let env2 = env.withFunction(fct, body, false);
          // Transform the parameters and add them to env.vars, to have them when transforming the body.
          const [env3, args] = env2.foldList((e: MapEnv, d: Decl) => e.mapDecl(d), fct.args);
          // Update env.fns with the transformed parameters.
          fct = { ...fct, args };
          env2 = env3.withFunction(fct, body, true);
          // Transform the body. The env modifications (local variables) are discarded.
          body = env2.mapStmt(FunctionRootLevel(fct), body)[1];
          // Update env.fns with the transformed body.
          env2 = env2.withFunction(fct, body, true);
          // Remove the parameters from env.vars, so that following functions don't see them.
          env2 = env2.withVars(varsWithoutParameters);
          return [env2, Function(fct, body)];
        }
        default: return [env, tl];
      }
    }, li);
    return res;
  }
}

const identityExpr: ExprMapper = (_env, e) => e;
const identityStmt: StmtMapper = (_env, s) => s;

export function visitor(options: Options, fExpr?: ExprMapper, fStmt?: StmtMapper): MapEnv {
  return new MapEnv(fExpr ?? identityExpr, fStmt ?? identityStmt, new Map(), new Map(), UnknownLevel, options);
}

/** Active pattern ResolvedVariableUse: a Var whose ident resolves to a variable declaration. */
export function resolvedVariableUse(e: Expr): [Ident, VarDecl] | null {
  if (e.kind === "Var" && e.ident.declaration.kind === "Variable") return [e.ident, e.ident.declaration.decl];
  return null;
}
