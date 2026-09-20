// Port of Minifier/renamer.fs
import * as Ast from "./ast.js";
import type { Decl, DeclElt, ExportedName, ExportPrefix, FunctionType, Ident, Shader, Stmt, StructMember, StructOrInterfaceBlock, TopLevel, Type } from "./ast.js";
import { Analyzer, IdentKind } from "./analyzer.js";
import * as Builtin from "./builtin.js";
import type { Options } from "./options.js";
import * as Printer from "./printer.js";

// F# record { str: string }; equality is on str, so the signature is represented by its string.
type Signature = string;
const signatureCreate = (args: Decl[]): Signature =>
  args.map(([ty]) => (ty.name.kind === "TypeName" ? `<${ty.name.ident.oldName}>` : Printer.typeToS(ty))).join(",");

function renList<T>(env: Env, fct: (env: Env, item: T) => Env, li: readonly T[]): Env {
  for (const i of li) env = fct(env, i);
  return env;
}

const ordinal = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sortedKeys = <V>(m: ReadonlyMap<string, V>): string[] => [...m.keys()].sort(ordinal); // F# Map iterates in key order

type Namespace = "VarFunStruct" | "FieldsOfAllStruct"; // we consider that all members share a common namespace.

type NewNameFn = (ns: Namespace, env: Env, id: Ident) => Env;
type OnEnterScopeFn = (env: Env, stmt: Stmt) => Env;

// Environment for renamer
// This object is useful to separate the AST walking from the renaming strategy.
// Maybe we could use a single mutable object, instead of creating envs all the time.
// TODO: create a real class.
class Env {
  private constructor(
    // Map from an old identifier name to the new one. Contains names of variables, functions and structs.
    readonly identRenames: ReadonlyMap<string, string>,
    // Map from an old identifier name to the new one. Contains names of members of all structs (but not "global" interface blocks members)
    readonly memberRenames: ReadonlyMap<string, string>,
    // Store function signatures for overloading. (newName, Map(Signature, oldName)). Not accessed as a map, but with linear search.
    readonly funOverloads: ReadonlyMap<string, ReadonlyMap<Signature, string>>,
    // List of names that are still available. Variables, functions and structs share the same name space.
    readonly availableNames: readonly string[],
    readonly availableFieldNames: readonly string[],
    readonly exportedNames: { value: ExportedName[] },
    // Whether multiple functions can have the same name (but different signature).
    readonly allowOverloading: boolean,
    // Function that decides a name (and returns the modified Env).
    readonly newName: NewNameFn,
    // Function called when we enter a scope, to support name reuse via shadowing
    readonly onEnterScope: OnEnterScopeFn,
  ) {}

  static create(availableNames: readonly string[], availableFieldNames: readonly string[], allowOverloading: boolean, newName: NewNameFn, onEnterScope: OnEnterScopeFn): Env {
    return new Env(new Map(), new Map(), new Map(), availableNames, availableFieldNames, { value: [] }, allowOverloading, newName, onEnterScope);
  }

  private with(changes: {
    identRenames?: ReadonlyMap<string, string>;
    memberRenames?: ReadonlyMap<string, string>;
    funOverloads?: ReadonlyMap<string, ReadonlyMap<Signature, string>>;
    availableNames?: readonly string[];
    availableFieldNames?: readonly string[];
  }): Env {
    return new Env(
      changes.identRenames ?? this.identRenames,
      changes.memberRenames ?? this.memberRenames,
      changes.funOverloads ?? this.funOverloads,
      changes.availableNames ?? this.availableNames,
      changes.availableFieldNames ?? this.availableFieldNames,
      this.exportedNames, this.allowOverloading, this.newName, this.onEnterScope);
  }

  // Renames the identifier and move its new name from availableNames to identRenames.
  addRenaming(ns: Namespace, id: Ident, newName: string): Env {
    const prevName = id.name;
    if (ns === "VarFunStruct") {
      const names = this.availableNames.filter((n) => n !== newName);
      id.rename(newName);
      return this.with({ identRenames: mapAdd(this.identRenames, prevName, newName), availableNames: names });
    } else {
      const names = this.availableFieldNames.filter((n) => n !== newName);
      id.rename(newName);
      return this.with({ memberRenames: mapAdd(this.memberRenames, prevName, newName), availableFieldNames: names });
    }
  }

  // Decide the identifier won't be renamed, and mark its name as used.
  dontRename(id: Ident): Env { return this.addRenaming("VarFunStruct", id, id.name); }
  dontRenameField(id: Ident): Env { return this.addRenaming("FieldsOfAllStruct", id, id.name); }
  dontRenameList(names: readonly string[]): Env {
    let env: Env = this;
    for (const name of names) env = env.dontRename(new Ast.Ident(name));
    return env;
  }

  update(identRenames: ReadonlyMap<string, string>, funOverloads: ReadonlyMap<string, ReadonlyMap<Signature, string>>, availableNames: readonly string[]): Env {
    return this.with({ identRenames, funOverloads, availableNames });
  }
}

function mapAdd<V>(m: ReadonlyMap<string, V>, key: string, value: V): ReadonlyMap<string, V> {
  const res = new Map(m);
  res.set(key, value);
  return res;
}

type DeclarationContext =
  | { kind: "TopLevelDeclaration" }
  | { kind: "LocalDeclaration" }
  | { kind: "Field"; block: StructOrInterfaceBlock; hasInstanceName: boolean }
  | { kind: "FunctionArgument"; fn: FunctionType };
const TopLevelDeclaration: DeclarationContext = { kind: "TopLevelDeclaration" };
const LocalDeclaration: DeclarationContext = { kind: "LocalDeclaration" };

// This visitor has three jobs:
//  * for every identifier declaration, give it a name (stored in Env) by calling Env.newName or DontRename
//  * for every identifier use, assign to it the stored name by calling Ident.Rename
//  * handle function names differently: use function overloading in the output, for better compression
// This happens in two steps:
//  * first pass on all top level declarations
//  * second pass on function bodies, with reuse of unused names via shadowing (with onEnterScope)
class RenamerVisitor {
  constructor(private readonly options: Options) {}

  private export(env: Env, prefix: ExportPrefix, id: Ident): void {
    if (!id.isUniqueId) {
      env.exportedNames.value = [{ prefix, name: id.oldName, newName: id.name }, ...env.exportedNames.value];
    }
  }

  private renExpr(env: Env, expr: Ast.Expr): void {
    const mapper = (_: Ast.MapEnv, e: Ast.Expr): Ast.Expr => {
      if (e.kind === "Var") {
        const name = env.identRenames.get(e.ident.name);
        if (name !== undefined) e.ident.rename(name);
        return e; // don't rename things we didn't see a declaration for. (builtins...)
      }
      if (e.kind === "Dot" && !Builtin.isFieldSwizzle(e.field.name)) {
        const name = env.memberRenames.get(e.field.name);
        if (name !== undefined) e.field.rename(name);
        return e;
      }
      return e;
    };
    Ast.visitor(this.options, mapper).iterExpr(expr);
  }

  private renNamedStruct(env: Env, structName: Ident): Env {
    // top level struct declaration, e.g. `struct foo { int a; float b; }`
    if (this.options.noRenamingList.includes(structName.name) || structName.pinned) {
      return env.dontRename(structName);
    } else {
      return env.newName("VarFunStruct", env, structName);
    }
  }

  private renDecl(context: DeclarationContext, envForType: Env | null, env: Env, [ty, vars]: Decl): Env {
    const renDeclElt = (env: Env, decl: DeclElt): Env => {
      // Rename expressions in init and size
      if (decl.init !== null) this.renExpr(env, decl.init);
      for (const s of decl.sizes) this.renExpr(env, s);

      // Rename variable type
      if (envForType !== null) { // This is when renaming the type of function args or decl in ForD.
        this.renType(envForType, ty); // use the outer env for the type
        // then, keep using the inner env
      } else {
        env = this.renType(env, ty);
      }

      // Rename declared variable
      const processExternal = (): Env => {
        if (this.options.preserveExternals) {
          return env.dontRename(decl.name);
        } else {
          const name = env.identRenames.get(decl.name.name);
          if (name === undefined) { // first time we see this external: pick a new name, export it
            const env2 = env.newName("VarFunStruct", env, decl.name);
            this.export(env2, "Variable", decl.name);
            return env2;
          } else { // external already declared in another file: rename consistently
            decl.name.rename(name);
            return env;
          }
        }
      };

      if (decl.name.pinned) { // named in a kept #define
        return context.kind === "Field" ? env.dontRenameField(decl.name) : env.dontRename(decl.name);
      }
      if (this.options.noRenamingList.includes(decl.name.name)) {
        return env.dontRename(decl.name);
      }
      switch (context.kind) {
        case "TopLevelDeclaration":
          if (this.options.preserveAllGlobals) return env.dontRename(decl.name);
          if (Ast.typeIsExternal(ty) || this.options.hlsl) return processExternal();
          return env.newName("VarFunStruct", env, decl.name);
        case "Field":
          if (context.block.blockType.kind === "InterfaceBlock") {
            if (context.hasInstanceName) {
              return env.newName("VarFunStruct", env, decl.name); // we have no tests of this and it doesn't work
            } else {
              return processExternal();
            }
          } else { // named or anonymous struct, with instance or not
            const name = env.memberRenames.get(decl.name.name);
            if (name === undefined) { // first time we see this struct field: pick a new name
              return env.newName("FieldsOfAllStruct", env, decl.name);
            } else { // struct field already renamed in another struct: rename consistently
              decl.name.rename(name);
              return env;
            }
          }
        case "FunctionArgument": return env.newName("VarFunStruct", env, decl.name);
        case "LocalDeclaration": return env.newName("VarFunStruct", env, decl.name);
      }
    };

    return renList(env, renDeclElt, vars);
  }

  private renStructMember(stru: StructOrInterfaceBlock, hasInstanceName: boolean, env: Env, structMember: StructMember): Env {
    if (structMember.kind === "MemberVariable") return this.renDecl({ kind: "Field", block: stru, hasInstanceName }, null, env, structMember.decl);
    // TODO: handle struct methods in a followup
    return env;
  }

  private renType(env: Env, ty: Type): Env {
    if (ty.name.kind === "TypeName") {
      const t = ty.name.ident;
      const name = env.identRenames.get(t.name);
      if (name !== undefined) t.rename(name); // the type name is a reference to a named struct being renamed
      // else: e.g. builtin type
      return env;
    }
    const stru = ty.name.block;
    if (stru.blockType.kind === "Struct") {
      // struct + variable declaration (top level or local, named or unnamed)
      // e.g. `struct Foo { int a; } s;` or `struct { int a; } s;`
      if (stru.name !== null) env = this.renNamedStruct(env, stru.name);
      // This isn't actually recursive with renDecl, because "Embedded struct definitions are not allowed".
      return renList(env, (e, m) => this.renStructMember(stru, true, e, m), stru.members);
    }
    throw new Error("Unsupported: interface block declaration not at top level");
  }

  private renStmt(env: Env, stmt: Stmt): Env {
    const renOpt = (o: Ast.Expr | null): void => { if (o !== null) this.renExpr(env, o); };
    switch (stmt.kind) {
      case "Expr": this.renExpr(env, stmt.expr); return env;
      case "Decl":
        return this.renDecl(LocalDeclaration, null, env, stmt.decl);
      case "Block":
        renList(env, (e, s) => this.renStmt(e, s), stmt.stmts);
        return env;
      case "If":
        this.renStmt(env.onEnterScope(env, stmt.then), stmt.then);
        if (stmt.else !== null) this.renStmt(env.onEnterScope(env, stmt.else), stmt.else);
        this.renExpr(env, stmt.cond);
        return env;
      case "ForD": {
        const envForType = env; // Use the outer env to rename the init variable's type! In the inner env the type name might have been removed.
        if (this.options.hlsl) {
          // In HLSL, a variable declared in a for initializer stays in scope after the loop.
          // We therefore can't keep the "shadowing" environment after the loop, and we must
          // ensure the initializer declaration is renamed in the outer scope.
          const envWithInit = this.renDecl(LocalDeclaration, envForType, env, stmt.init);
          const innerEnv = envWithInit.onEnterScope(envWithInit, stmt); // In the for body, allow shadowing of unused outer decls.
          this.renStmt(innerEnv, stmt.body);
          if (stmt.cond !== null) this.renExpr(innerEnv, stmt.cond);
          if (stmt.inc !== null) this.renExpr(innerEnv, stmt.inc);
          return envWithInit;
        } else {
          let innerEnv = env.onEnterScope(env, stmt); // In the for scope, we use an env that allows shadowing unused outer decls.
          innerEnv = this.renDecl(LocalDeclaration, envForType, innerEnv, stmt.init); // Use the inner env to rename the init variable.
          this.renStmt(innerEnv, stmt.body);
          if (stmt.cond !== null) this.renExpr(innerEnv, stmt.cond);
          if (stmt.inc !== null) this.renExpr(innerEnv, stmt.inc);
          return env;
        }
      }
      case "ForE": {
        const innerEnv = env.onEnterScope(env, stmt);
        renOpt(stmt.init);
        renOpt(stmt.cond);
        renOpt(stmt.inc);
        this.renStmt(innerEnv, stmt.body);
        return env;
      }
      case "While": {
        const innerEnv = env.onEnterScope(env, stmt);
        this.renExpr(innerEnv, stmt.cond);
        this.renStmt(innerEnv, stmt.body);
        return env;
      }
      case "DoWhile": {
        const innerEnv = env.onEnterScope(env, stmt);
        this.renExpr(innerEnv, stmt.cond);
        this.renStmt(innerEnv, stmt.body);
        return env;
      }
      case "Jump": renOpt(stmt.expr); return env;
      case "Verbatim": case "Directive": return env;
      case "Switch": {
        const renCase = (env: Env, c: Ast.SwitchCase): Env => {
          if (c.label.kind === "Case") this.renExpr(env, c.label.expr);
          return renList(env, (e, s) => this.renStmt(e, s), c.stmts);
        };
        this.renExpr(env, stmt.expr);
        renList(env, renCase, stmt.cases);
        return env;
      }
    }
  }

  private renFunctionWithOverloading(env: Env, signature: Signature, id: Ident): Env {
    // we're looking for a function name, already used before,
    // but not with the same signature, and which is not in options.noRenamingList.
    const isFunctionNameAvailableForThisSignature = (key: string): boolean =>
      !(env.funOverloads.get(key)!.has(signature) || this.options.noRenamingList.includes(key));
    const found = sortedKeys(env.funOverloads).find(isFunctionNameAvailableForThisSignature);
    if (found !== undefined && env.allowOverloading) {
      // overload an existing function name used with a different signature
      const newName = found;
      const overloads = env.funOverloads.get(found)!;
      const funOverloads = mapAdd(env.funOverloads, newName, mapAdd(overloads, signature, id.name));
      const env2 = env.update(mapAdd(env.identRenames, id.name, newName), funOverloads, env.availableNames);
      id.rename(newName);
      return env2;
    } else {
      // find a new function name
      const prevName = id.name;
      const env2 = env.newName("VarFunStruct", env, id);
      const funOverloads = mapAdd(env2.funOverloads, id.name, new Map([[signature, prevName]]));
      return env2.update(env2.identRenames, funOverloads, env2.availableNames);
    }
  }

  private renFunction(env: Env, f: FunctionType): Env {
    if ((Ast.funIsExternal(f, this.options) && this.options.preserveExternals) || this.options.preserveAllGlobals) {
      return env;
    } else if (this.options.noRenamingList.includes(f.fName.name) || f.fName.pinned) {
      return env;
    } else {
      const name = env.identRenames.get(f.fName.name);
      if (name !== undefined) {
        f.fName.rename(name); // bug, may cause conflicts
        return env;
      } else {
        const newEnv = this.renFunctionWithOverloading(env, signatureCreate(f.args), f.fName);
        if (Ast.funIsExternal(f, this.options)) this.export(env, "HlslFunction", f.fName);
        return newEnv;
      }
    }
  }

  renTopLevelName(env: Env, tl: TopLevel): Env {
    switch (tl.kind) {
      case "TLDecl": return this.renDecl(TopLevelDeclaration, null, env, tl.decl);
      case "Function": return this.renFunction(env, tl.funcType);
      case "TypeDecl": {
        const block = tl.block;
        if (block.blockType.kind === "InterfaceBlock") {
          // interface block without an instance name: the members are treated as external global variables
          // e.g. `uniform foo { int a; float b; }`
          return renList(env, (e, m) => this.renStructMember(block, false, e, m), block.members);
        }
        if (block.name !== null) {
          const env2 = this.renNamedStruct(env, block.name);
          return renList(env2, (e, m) => this.renStructMember(block, false, e, m), block.members);
        }
        // e.g. `struct {int A;};`
        // TIL Declaring an anonymous struct that doesn't declare a variable is legal and does nothing.
        return env;
      }
      default: return env;
    }
  }

  renTopLevelBody(env: Env, tl: TopLevel): void {
    if (tl.kind !== "Function") return;
    const fct = tl.funcType;
    // Use the top level env to rename the return type.
    env = this.renType(env, fct.retType);
    // In the function body, we use an env that allows shadowing unused outer decls.
    let envForBody = env.onEnterScope(env, tl.body);
    // Use the function body's env to rename arguments (they can shadow unused top level names).
    const envForType = env; // Use the top level env to rename the argument types! (In the body env the type names might have been removed.)
    envForBody = renList(envForBody, (e, d) => this.renDecl({ kind: "FunctionArgument", fn: fct }, envForType, e, d), fct.args);

    // Use the function body's env to rename in the body.
    this.renStmt(envForBody, tl.body);
  }
}

/* Contextual renaming */

// Dictionary<(char*char), int>, keyed on the pair of char codes.
type ContextTable = Map<number, number>;
const pairKey = (prev: number, next: number): number => prev * 65536 + next;

function computeContextTable(text: string): ContextTable {
  const contextTable: ContextTable = new Map();
  for (let i = 1; i < text.length; i++) {
    const key = pairKey(text.charCodeAt(i - 1), text.charCodeAt(i));
    contextTable.set(key, (contextTable.get(key) ?? 0) + 1);
  }
  return contextTable;
}

// /!\ This function is a performance bottleneck.
function chooseIdent(contextTable: ContextTable, ident: number, candidates: readonly string[]): string {
  const allChars: number[] = [];
  for (let c = 32; c <= 127; c++) allChars.push(c); // printable chars
  const prevs = allChars.filter((c) => contextTable.has(pairKey(c, ident)));
  const nexts = allChars.filter((c) => contextTable.has(pairKey(ident, c)));

  let bestScore = -10000;
  let bestWord = "";
  // For performance, consider at most 26 candidates.
  // Upstream's Seq.take 26 throws when fewer than 26 candidates remain.
  if (candidates.length < 26) throw new Error("Not enough names available for renaming (fewer than 26 candidates left)");
  for (const word of candidates.slice(0, 26)) {
    const firstLetter = word.charCodeAt(0);
    const lastLetter = word.charCodeAt(word.length - 1);
    let score = 0;

    for (const c of prevs) { // more frequent adjacency with previous character scores better
      score += contextTable.get(pairKey(c, firstLetter)) ?? 0;
    }

    for (const c of nexts) { // more frequent adjacency with following character scores better
      score += contextTable.get(pairKey(lastLetter, c)) ?? 0;
    }

    if (word.length > 1) { // also use adjacency between the 2 letters of an identifier
      score -= 1000; // avoid long names if there are 1-letter names available
      score += contextTable.get(pairKey(firstLetter, lastLetter)) ?? 0;
    }

    if (score > bestScore) { bestScore = score; bestWord = word; }
    // If the score is equal, consistently pick the same string, to get a more deterministic behavior.
    else if (score === bestScore && word < bestWord) { bestScore = score; bestWord = word; }
  }

  const best = bestWord;
  if (best.length === 0) throw new Error("chooseIdent: no name chosen");
  const firstLetter = best.charCodeAt(0);
  const lastLetter = best.charCodeAt(best.length - 1);

  // Update the context table. Due to this side-effect, variables in two identical functions
  // may get different names. Compression tests using Crinkler show that (on average) it's
  // still worth updating the tables. Results might differ with kkrunchy, more testing
  // will be useful.
  for (const c of allChars) {
    const n1 = contextTable.get(pairKey(c, ident));
    if (n1 !== undefined) {
      const n2 = contextTable.get(pairKey(c, firstLetter));
      contextTable.set(pairKey(c, firstLetter), n2 === undefined ? n1 : n1 + n2);
    }
    const m1 = contextTable.get(pairKey(ident, c));
    if (m1 !== undefined) {
      const m2 = contextTable.get(pairKey(lastLetter, c));
      contextTable.set(pairKey(lastLetter, c), m2 === undefined ? m1 : m1 + m2);
    }
  }

  return best;
}

// Compute list of variables names, based on frequency
function computeListOfNames(text: string): string[] {
  const charCounts = new Map<string, number>();
  for (const c of text) charCounts.set(c, (charCounts.get(c) ?? 0) + 1);
  const count = (c: string): number => charCounts.get(c) ?? 0;
  const letters: string[] = [];
  for (let c = 97; c <= 122; c++) letters.push(String.fromCharCode(c));
  for (let c = 65; c <= 90; c++) letters.push(String.fromCharCode(c));
  letters.push("_");
  const res: string[] = [];
  // First, use most frequent letters
  res.push(...[...letters].sort((a, b) => count(a) - count(b)).reverse());

  // Then, generate identifiers with 2 letters
  for (const c1 of letters) {
    for (const c2 of letters) {
      res.push(c1 + c2);
    }
  }
  return res;
}

class RenamerImpl {
  constructor(private readonly options: Options) {}

  /* ** Renamer ** */

  private newUniqueId(numberOfUsedIdents: { value: number }): NewNameFn {
    return (ns, env, id) => {
      numberOfUsedIdents.value = numberOfUsedIdents.value + 1;
      const newName = String(numberOfUsedIdents.value).padStart(4, "0");
      return env.addRenaming(ns, id, newName);
    };
  }

  // A renaming strategy that considers how a variable is used. It optimizes the frequency of
  // adjacent characters, which can make the output more compression-friendly. This is best
  // suited when minifying a single file.
  private optimizeContext(contextTable: ContextTable): NewNameFn {
    return (ns, env, id) => {
      if (ns === "VarFunStruct") {
        const cid = 1000 + parseInt(id.name, 10);
        const newName = chooseIdent(contextTable, cid, env.availableNames);
        return env.addRenaming(ns, id, newName);
      } else {
        const newName = listHead(env.availableFieldNames);
        return env.addRenaming(ns, id, newName);
      }
    };
  }

  // A renaming strategy that always picks the first available name. This optimizes the
  // frequency of a few variables. It also ensures that two identical functions will use the
  // same names for local variables, which can be very important in some multifile scenarios.
  private optimizeNameFrequency(): NewNameFn {
    return (ns, env, id) => {
      const newName = listHead(env.availableNames);
      return env.addRenaming(ns, id, newName);
    };
  }

  // A renaming strategy that's bijective: if (and only if) two variables had the same old name,
  // they will get the same new name.
  // This leads to a slightly longer output (because lots of names are created, most of them
  // have two chars). However, this preserves similarities from the input code, so that can be
  // compression-friendly.
  private bijectiveRenaming(ns: Namespace, allNames: readonly string[]): (env: Env, id: Ident) => Env {
    let names = allNames;
    const d = new Map<string, string>();
    return (env, id) => {
      const name = d.get(id.oldName);
      if (name !== undefined) {
        return env.addRenaming(ns, id, name);
      } else {
        const newName = listHead(names);
        names = names.slice(1);
        d.set(id.oldName, newName);
        return env.addRenaming(ns, id, newName);
      }
    };
  }

  // Renaming safe across multiple files (e.g. uniform/in/out variables are
  // renamed in a consistent way) that tries to optimize based on the context
  // and variable reuse.
  private multiFileRenaming(contextTable: ContextTable, exportRenames: ReadonlyMap<string, string>): NewNameFn {
    const optimizeContext = this.optimizeContext(contextTable);
    return (ns, env, id) => {
      const newName = exportRenames.get(id.name);
      if (newName !== undefined) return env.addRenaming(ns, id, newName);
      return optimizeContext(ns, env, id);
    };
  }

  // Implements name reuse via shadowing. This is called when entering a new scope (function body, if, for, while).
  // It marks already assigned names as available again when they are not used inside the scope,
  // so that the names can be reused and shadow the outer names, leading to better compression and shorter names.
  // For example, this lets local variables shadow global variables when they are not used in the function.
  private shadowVariables: OnEnterScopeFn = (env, block) => {
    // Find all the already assigned identifiers in identRenames that are used in the block.
    // They should be preserved in the renaming environment.
    const usedIdents = new Analyzer(this.options).identUsesInStmt(IdentKind.Var | IdentKind.Type, block);
    const usedNames = usedIdents.map((ident) => ident.name);
    const stillUsedSet = new Set(usedNames.map((name) => {
      const n = env.identRenames.get(name);
      if (n !== undefined) {
        // This name is a renamable identifier (that was renamed to numbers by the first phase)
        // that already has an associated identRename from an outer scope. It is a use that prevents shadowing!
        return n;
      } else {
        // This name might be a renamable identifier (that was renamed to numbers by the first phase)
        // that has no associated identRename yet, maybe because its declaration is inside the block.
        // Or it might be a non-renamable identifiers (that is external, or in no-renaming-list,
        // or a built-in function or type constructor).
        // Or it might be insidiously an identifier that is already renamed because it is instance-shared
        // between AST locations as a result of multi-use-site inlining. And that is a use that prevents shadowing!
        return name;
      }
    }));
    const identRenames = new Map<string, string>();
    let reusable: string[] = [];
    for (const key of sortedKeys(env.identRenames)) {
      const id = env.identRenames.get(key)!;
      if (stillUsedSet.has(id)) identRenames.set(key, id);
      else reusable.push(id);
    }
    reusable = reusable.filter((x) => !this.options.noRenamingList.includes(x));
    const allAvailable = [...new Set([...reusable, ...env.availableNames])];
    return env.update(identRenames, env.funOverloads, allAvailable);
  };

  private renameAsts(shaders: readonly Shader[], env: Env): ExportedName[] {
    const visitor = new RenamerVisitor(this.options);
    for (const shader of shaders) {
      // Rename top-level and body at the same time (because the body
      // needs the environment matching the top-level).
      env = renList(env, (e, tl) => visitor.renTopLevelName(e, tl), shader.code);
      for (const tl of shader.code) visitor.renTopLevelBody(env, tl);
    }

    return env.exportedNames.value;
  }

  private assignUniqueIds(shaders: readonly Shader[]): ExportedName[] {
    const numberOfUsedIdents = { value: 0 };
    const env = Env.create([], [], false, this.newUniqueId(numberOfUsedIdents), (env) => env);
    return this.renameAsts(shaders, env);
  }

  rename(shaders: readonly Shader[]): ExportedName[] {
    // First we rename each identifier into a unique number, getting them out of the way
    // for analyzing the frequency of each letter in the shader.
    const exportedNames = this.assignUniqueIds(shaders);

    // Unlike upstream, forbidden names are combined from all shaders, not only the first.
    const forbiddenNames = new Set(shaders.flatMap((s) => s.forbiddenNames));
    // A name kept as is (an external under --preserve-externals, or anything under
    // --preserve-all-globals) may be declared after a global that a generated name of the same
    // spelling already took (`const float o=...; out vec4 o;`): keep those spellings out of the
    // generated list. Upstream only marks such a name used when it reaches its declaration.
    for (const shader of shaders) {
      for (const tl of shader.code) {
        if (tl.kind !== "TLDecl") continue;
        if (this.options.preserveAllGlobals || (this.options.preserveExternals && Ast.typeIsExternal(tl.decl[0]))) {
          for (const elt of tl.decl[1]) forbiddenNames.add(elt.name.name);
        }
      }
    }

    // Then, compute the ordered list of variable names to use.
    // Most frequent letters must be picked first because they will compress better.
    const text = shaders.map((shader) => Printer.print(shader.code)).join("\0");
    const names = computeListOfNames(text).filter((x) => !forbiddenNames.has(x));
    const fieldNames = names;

    // Rename each identifier again, this time into valid names, according to the list
    // and to a "context table" (frequencies of adjacent pairs of characters).
    const allowOverloading = !this.options.noOverloading;
    let env: Env;
    if (shaders.length > 1) {
      // Env.Create(names, true, bijectiveRenaming names, shadowVariables)
      const exportsRenames = new Map<string, string>();
      exportedNames.forEach((e, i) => { if (i < names.length) exportsRenames.set(e.name, names[i]); });
      const contextTable = computeContextTable(text);
      env = Env.create(names, names, allowOverloading, this.multiFileRenaming(contextTable, exportsRenames), this.shadowVariables);
    } else {
      const contextTable = computeContextTable(text);
      env = Env.create(names, fieldNames, allowOverloading, this.optimizeContext(contextTable), this.shadowVariables);
    }
    env = env.dontRenameList(this.options.noRenamingList);
    env.exportedNames.value = exportedNames;
    return this.renameAsts(shaders, env);
  }
}

function listHead(li: readonly string[]): string {
  if (li.length === 0) throw new Error("The input list was empty.");
  return li[0];
}

export function rename(options: Options, shaders: Shader[]): ExportedName[] {
  return new RenamerImpl(options).rename(shaders);
}

/** Exposed for unit tests only. */
export const internals = { computeListOfNames, computeContextTable, chooseIdent, pairKey };
