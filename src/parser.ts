// Port of Minifier/parse.fs (FParsec combinators -> recursive descent with backtracking)
import * as Ast from "./ast.js";
import { Ident } from "./ast.js";
import * as Builtin from "./builtin.js";
import { ParseError, type Options } from "./options.js";
import { expandMacros, preprocess } from "./preprocessor.js";
import * as Printer from "./printer.js";

class Fail {
  constructor(readonly pos: number, readonly expected: string) {}
}

const isLetter = (c: string): boolean => /[a-zA-Z]/.test(c);
const isDigit = (c: string): boolean => c >= "0" && c <= "9";
const isIdentChar = (c: string): boolean => isLetter(c) || isDigit(c) || c === "_";
const isSpace = (c: string): boolean => /\s/.test(c);

const glslStorage = [
  "const", "inout", "in", "out", "centroid",
  "patch", "sample", "uniform", "buffer", "shared", "coherent",
  "volatile", "restrict", "readonly", "writeonly", "subroutine",
  "attribute", "varying",
  "highp", "mediump", "lowp",
  "invariant", "precise",
  "smooth", "flat", "noperspective",
];
const hlslStorage = [
  "extern", "nointerpolation", "precise", "shared", "groupshared",
  "static", "uniform", "volatile", "const", "row_major", "column_major",
  "inline", "target",
  "out", "in", "inout",
  "linear", "centroid", "nointerpolation", "noperspective", "sample",
  "cbuffer", "tbuffer",
  // https://docs.microsoft.com/en-us/windows/win32/direct3dhlsl/dx-graphics-hlsl-geometry-shader
  "point", "line", "triangle", "lineadj", "triangleadj",
];

// Infix operators, from highest to lowest precedence.
const infixLevels: [string[], "left" | "right"][] = [
  [["*", "/", "%"], "left"],
  [["+", "-"], "left"],
  [["<<", ">>"], "left"],
  [["<", ">", "<=", ">="], "left"],
  [["==", "!="], "left"],
  [["&"], "left"],
  [["^"], "left"],
  [["|"], "left"],
  [["&&"], "left"],
  [["^^"], "left"],
  [["||"], "left"],
  [["=", "+=", "-=", "*=", "/=", "%=", "<<=", ">>=", "&=", "^=", "|="], "right"],
];
const infixOps = new Map<string, { prec: number; assoc: "left" | "right" }>();
{
  let precCounter = 20 - 2; // postfix = 19, prefix = 18, then infix levels
  for (const [ops, assoc] of infixLevels) {
    precCounter--;
    for (const op of ops) infixOps.set(op, { prec: precCounter, assoc });
  }
}
const ternaryPrec = infixOps.get("=")!.prec; // same precedence as =
const prefixOps = ["++", "--", "+", "-", "~", "!"];
const postfixOps = ["++", "--"];
// All operator spellings, longest first, for longest-match tokenization.
const allInfixSpellings = [...infixOps.keys()].sort((a, b) => b.length - a.length);
const numberSuffixes = ["f", "F", "LF", "lf", "u", "U", "l", "L", "h", "H"];

class ParserImpl {
  private pos = 0;
  private furthest = 0;
  private furthestExpected = "";
  forbiddenNames: string[] = [];
  pinnedNames = new Set<string>();
  pinnedFields = new Set<string>();
  reorderFunctions = false;

  constructor(private readonly options: Options, private readonly src: string, private readonly streamName: string) {}

  // ---- primitives ---------------------------------------------------------

  private fail(expected: string): never {
    if (this.pos > this.furthest) {
      this.furthest = this.pos;
      this.furthestExpected = expected;
    }
    throw new Fail(this.pos, expected);
  }

  private attempt<T>(f: () => T): T | null {
    const save = this.pos;
    try {
      return f();
    } catch (e) {
      if (e instanceof Fail) {
        this.pos = save;
        return null;
      }
      throw e;
    }
  }

  private choice<T>(name: string, ...alternatives: (() => T)[]): T {
    for (const alt of alternatives) {
      const r = this.attempt(alt);
      if (r !== null) return r;
    }
    return this.fail(name);
  }

  private many<T>(f: () => T): T[] {
    const res: T[] = [];
    for (;;) {
      const r = this.attempt(f);
      if (r === null) return res;
      res.push(r);
    }
  }

  private opt<T>(f: () => T): T | null { return this.attempt(f); }

  private sepBy<T>(f: () => T, sep: string): T[] {
    const first = this.attempt(f);
    if (first === null) return [];
    const res = [first];
    for (;;) {
      const next = this.attempt(() => { this.ch(sep); return f(); });
      if (next === null) return res;
      res.push(next);
    }
  }
  private sepBy1<T>(f: () => T, sep: string): T[] {
    const res = this.sepBy(f, sep);
    if (res.length === 0) this.fail("list");
    return res;
  }

  private re(regex: RegExp, at: number = this.pos): RegExpExecArray | null {
    regex.lastIndex = at;
    return regex.exec(this.src);
  }
  private peek(n = 0): string { return this.src[this.pos + n] ?? ""; }
  private startsWith(s: string): boolean { return this.src.startsWith(s, this.pos); }
  private eof(): boolean { return this.pos >= this.src.length; }

  private lineStarts: number[] | null = null;
  private location(): Ast.Location {
    if (this.lineStarts === null) {
      this.lineStarts = [0];
      for (let i = 0; i < this.src.length; i++) if (this.src[i] === "\n") this.lineStarts.push(i + 1);
    }
    // binary search for the last line start <= pos
    let lo = 0, hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= this.pos) lo = mid; else hi = mid - 1;
    }
    return { line: lo + 1, col: this.pos - this.lineStarts[lo] + 1 };
  }

  // ---- whitespace and comments -------------------------------------------

  private skipSpaces1(): boolean {
    const start = this.pos;
    while (!this.eof() && isSpace(this.peek())) this.pos++;
    return this.pos > start;
  }

  private commentLine(): boolean {
    if (!this.startsWith("//")) return false;
    const c = this.peek(2);
    if (c === "[" || c === "]") return false; // verbatim code
    this.pos += 2;
    while (!this.eof() && this.peek() !== "\n") this.pos++;
    return true;
  }

  private commentBlock(): boolean {
    if (!this.startsWith("/*")) return false;
    const end = this.src.indexOf("*/", this.pos + 2);
    if (end < 0) { this.pos += 2; this.fail("*/"); }
    this.pos = end + 2;
    return true;
  }

  private ws(): void {
    for (;;) {
      if (this.skipSpaces1()) continue;
      if (this.commentLine()) continue;
      if (this.commentBlock()) continue;
      return;
    }
  }

  private skipComment(): void {
    for (;;) {
      if (this.commentLine()) continue;
      if (this.commentBlock()) continue;
      return;
    }
  }

  private verbatim(): string {
    if (!this.startsWith("//[")) this.fail("//[");
    this.pos += 3;
    this.skipSpaces1();
    const end = this.src.indexOf("//]", this.pos);
    if (end < 0) this.fail("//]");
    const content = this.src.slice(this.pos, end);
    this.pos = end + 3;
    this.ws();
    return content;
  }

  private ch(c: string): void {
    if (this.peek() !== c) this.fail(`'${c}'`);
    this.pos++;
    this.ws();
  }

  private str(s: string): string {
    if (!this.startsWith(s)) this.fail(`'${s}'`);
    this.pos += s.length;
    this.ws();
    return s;
  }

  private keyword(s: string): string {
    if (!this.startsWith(s)) this.fail(`'${s}'`);
    const next = this.peek(s.length);
    if (next !== "" && isIdentChar(next)) this.fail(`'${s}'`);
    this.pos += s.length;
    this.ws();
    return s;
  }

  private ident(): Ident {
    const loc = this.location();
    const c = this.peek();
    if (!(isLetter(c) || c === "_")) this.fail("identifier");
    let end = this.pos + 1;
    while (end < this.src.length && isIdentChar(this.src[end])) end++;
    const name = this.src.slice(this.pos, end);
    if (Builtin.keywords.has(name)) this.fail("identifier");
    this.pos = end;
    this.ws();
    return new Ident(name, loc);
  }

  // ---- numbers ------------------------------------------------------------

  private hexa(): Ast.Expr {
    if (!(this.startsWith("0x") || this.startsWith("0X"))) this.fail("number");
    const m = this.re(/[0-9a-fA-F]+/y, this.pos + 2);
    if (!m) this.fail("hex digits");
    this.pos += 2 + m[0].length;
    this.ws();
    return Ast.Int(parseInt(m[0], 16));
  }

  private octal(): Ast.Expr {
    const m = this.re(/0[0-7]+/y);
    if (!m) this.fail("number");
    this.pos += m[0].length;
    this.ws();
    return Ast.Int(parseInt(m[0], 8));
  }

  private number(): Ast.Expr {
    const m = this.re(/(\d+\.?\d*|\.\d+)([eE][-+]?[0-9]+)?/y);
    if (!m) this.fail("number");
    const s = m[0];
    this.pos += s.length;
    this.ws();
    if (/^\d+$/.test(s)) {
      const v = Number(s);
      if (Number.isSafeInteger(v)) return Ast.Int(v);
    }
    const f = Number(s);
    if (Number.isNaN(f)) throw new Error("invalid number: " + s);
    return Ast.Float(f);
  }

  private anyNumber(): Ast.Expr {
    const n = this.choice<Ast.Expr>("number", () => this.hexa(), () => this.octal(), () => this.number());
    // number suffixes: float, long float, unsigned, long, half.
    const suffix = this.opt(() => this.choice("suffix", ...numberSuffixes.map((su) => () => this.str(su))));
    if (suffix !== null && (n.kind === "Int" || n.kind === "Float")) return { ...n, suffix };
    return n;
  }

  // ---- expressions --------------------------------------------------------

  private exprNoComma(): Ast.Expr {
    return this.choice<Ast.Expr>("expression", () => this.opExpr(0), () => Ast.VerbatimExp(this.verbatim()));
  }

  private expr(): Ast.Expr {
    const list = this.sepBy1(() => this.exprNoComma(), ",");
    return list.reduce((acc, e) => Ast.OpCall(",", [acc, e]));
  }

  private parenExp(): Ast.Expr {
    this.ch("(");
    const e = this.expr();
    this.ch(")");
    return e;
  }

  private vectorExp(): Ast.Expr {
    this.ch("{");
    const inner = this.sepBy(() => this.exprNoComma(), ",");
    this.ch("}");
    return Ast.VectorExp(inner);
  }

  private primNoCast(): Ast.Expr {
    return this.choice<Ast.Expr>("expression",
      () => this.vectorExp(),
      () => this.parenExp(),
      () => Ast.Var(this.ident()),
      () => this.anyNumber(),
    );
  }

  private cast(): Ast.Expr {
    this.ch("(");
    const id = this.ident();
    this.ch(")");
    const e = this.primNoCast();
    return Ast.Cast(id, e);
  }

  private prim(): Ast.Expr {
    const c = this.attempt(() => this.cast());
    return c ?? this.primNoCast();
  }

  // Very high priority (parenthesis, function call, field access)
  private simpleExpr(): Ast.Expr {
    let e = this.prim();
    for (;;) {
      const c = this.peek();
      if (c === ".") {
        // Not a number like .5 here: ident must follow.
        const r = this.attempt(() => { this.ch("."); return this.ident(); });
        if (r === null) return e;
        e = Ast.Dot(e, r);
      } else if (c === "[") {
        this.ch("[");
        const ind = this.opt(() => this.expr());
        this.ch("]");
        e = Ast.Subscript(e, ind);
      } else if (c === "(") {
        this.ch("(");
        const args = this.sepBy(() => this.exprNoComma(), ",");
        this.ch(")");
        e = Ast.FunCall(e, args);
      } else {
        return e;
      }
    }
  }

  private matchOp(spellings: readonly string[]): string | null {
    for (const op of spellings) if (this.startsWith(op)) return op;
    return null;
  }

  private postfixExpr(): Ast.Expr {
    let e = this.simpleExpr();
    for (;;) {
      const op = this.matchOp(postfixOps);
      if (op === null) return e;
      this.str(op);
      e = Ast.OpCall("$" + op, [e]);
    }
  }

  private prefixExpr(): Ast.Expr {
    const op = this.matchOp(prefixOps);
    if (op !== null) {
      this.str(op);
      return Ast.OpCall(op, [this.prefixExpr()]);
    }
    return this.postfixExpr();
  }

  // Operator precedence parser (replaces FParsec's OperatorPrecedenceParser).
  private opExpr(minPrec: number): Ast.Expr {
    let lhs = this.prefixExpr();
    for (;;) {
      if (this.peek() === "?") {
        if (ternaryPrec < minPrec) return lhs;
        this.ch("?");
        // The middle expression of ?: is parsed as if grouped: precedence doesn't apply to it.
        // GLSL allows a full (comma) expression here, and the rewriter generates it, so accept it (upstream's parser does not).
        const mid = this.expr();
        this.ch(":");
        const rhs = this.opExpr(ternaryPrec); // right associative
        lhs = Ast.OpCall("?:", [lhs, mid, rhs]);
        continue;
      }
      const op = this.matchOp(allInfixSpellings);
      if (op === null) return lhs;
      const { prec, assoc } = infixOps.get(op)!;
      if (prec < minPrec) return lhs;
      this.str(op);
      const rhs = this.opExpr(assoc === "left" ? prec + 1 : prec);
      lhs = Ast.OpCall(op, [lhs, rhs]);
    }
  }

  // ---- types --------------------------------------------------------------

  private generic(): string {
    const r = this.opt(() => {
      this.ch("<");
      const end = this.src.indexOf(">", this.pos);
      if (end < 0) this.fail(">");
      const s = this.src.slice(this.pos, end);
      this.pos = end + 1;
      this.ws();
      return s;
    });
    return r === null ? "" : `<${r}>`;
  }

  // A type block, like struct or interface blocks
  private blockSpecifier(prefix: string): Ast.StructOrInterfaceBlock {
    const name = this.opt(() => this.ident());
    const template = this.generic();
    const baseClass = this.opt(() => {
      this.ch(":");
      const id = this.ident();
      return id.name + this.generic();
    });
    // A field named like a swizzle (`q`, `rgb`) keeps its name: the renamer leaves such a use
    // alone since it cannot tell `hex.q` from `p.q`, and the rewriter checks the type before
    // treating one as a swizzle. Upstream refuses the declaration.
    const check = (decl: Ast.Decl): Ast.Decl => {
      for (const d of decl[1]) {
        if (Builtin.isFieldSwizzle(d.name.name)) {
          d.name.pinned = true;
          this.forbiddenNames = [d.name.name, ...this.forbiddenNames];
        }
      }
      return decl;
    };
    const structMember = (): Ast.StructMember =>
      this.choice<Ast.StructMember>("struct member",
        () => {
          const f = this.pfunction();
          if (f.kind !== "Function") throw new Error("unexpected");
          this.opt(() => this.ch(";")); // the printer emits `};` after a method; accept it back (HLSL)
          return { kind: "Method", funcType: f.funcType, body: f.body };
        },
        () => {
          const d = this.declaration();
          this.ch(";");
          return { kind: "MemberVariable", decl: check(d) };
        },
      );
    this.ch("{");
    const members = this.many(structMember);
    this.ch("}");
    if (name !== null) this.forbiddenNames = [name.name, ...this.forbiddenNames];
    const blockType: Ast.BlockType = prefix === "struct" ? Ast.StructBlockType : { kind: "InterfaceBlock", prefix };
    return { blockType, name, template, baseClass, members };
  }

  private structSpecifier(): Ast.StructOrInterfaceBlock {
    const kw = this.keyword("struct");
    return this.blockSpecifier(kw);
  }

  private structDecl(): Ast.TopLevel {
    const s = this.structSpecifier();
    if (this.options.hlsl) this.opt(() => this.ch(";"));
    else this.ch(";");
    return Ast.TypeDecl(s);
  }

  private glslLayout(): string {
    this.keyword("layout");
    this.ch("(");
    const end = this.src.indexOf(")", this.pos);
    if (end < 0) this.fail(")");
    const s = this.src.slice(this.pos, end);
    this.pos = end + 1;
    this.ws();
    return "layout(" + s + ")";
  }

  private glslQualifier(): string[] {
    return this.many(() => this.choice<string>("Type qualifier",
      () => this.choice("Type qualifier", ...glslStorage.map((k) => () => this.keyword(k))),
      () => this.glslLayout(),
    ));
  }

  private hlslQualifier(): string[] {
    return this.many(() => this.choice("Type qualifier", ...hlslStorage.map((k) => () => this.keyword(k))));
  }

  private arraySizes(): Ast.Expr[] {
    return this.many(() => { this.ch("["); const e = this.expr(); this.ch("]"); return e; });
  }

  private specifiedTypeGLSL(): Ast.Type {
    const tyQ = this.glslQualifier();
    const name = this.choice<Ast.TypeSpec>("type",
      () => Ast.TypeBlock(this.structSpecifier()),
      () => Ast.TypeName(this.ident()),
    );
    const sizes = this.arraySizes();
    return Ast.makeType(name, tyQ, sizes);
  }

  private specifiedTypeHLSL(): Ast.Type {
    const tyQ = this.hlslQualifier();
    const name = this.choice<Ast.TypeSpec>("type",
      () => Ast.TypeBlock(this.structSpecifier()),
      () => {
        const id = this.ident();
        const g = this.generic();
        return Ast.TypeName(new Ident(id.name + g, id.loc));
      },
    );
    this.generic();
    const sizes = this.arraySizes();
    return Ast.makeType(name, tyQ, sizes);
  }

  private qualifier(): string[] {
    const ret = this.options.hlsl ? this.hlslQualifier() : this.glslQualifier();
    if (ret.length === 0) this.fail("Expected a type qualifier, but got none");
    return ret;
  }

  private specifiedType(): Ast.Type {
    return this.options.hlsl ? this.specifiedTypeHLSL() : this.specifiedTypeGLSL();
  }

  // For HLSL, e.g. ": color"
  private semantics(): Ast.Expr[] {
    return this.many(() => { this.ch(":"); return this.simpleExpr(); });
  }

  private brackets(): Ast.Expr[] {
    return this.many(() => {
      this.ch("[");
      const size = this.opt(() => this.expr());
      this.ch("]");
      return size ?? Ast.Int(0);
    });
  }

  // eg. "int foo[] = exp, bar = 3"
  private declaration(): Ast.Decl {
    const ty = this.specifiedType();
    const variable = (): Ast.DeclElt => {
      const id = this.ident();
      const sizes = this.brackets();
      const sem = this.semantics();
      const init = this.opt(() => { this.ch("="); return this.exprNoComma(); });
      return Ast.makeDecl(id, sizes, sem, init);
    };
    const list = this.sepBy1(variable, ",");
    return [ty, list];
  }

  // e.g. int foo[]   used for function arguments
  private singleDeclaration(): Ast.Decl {
    const ty = this.specifiedType();
    const id = this.ident();
    const sizes = this.brackets();
    const sem = this.semantics();
    return [ty, [Ast.makeDecl(id, sizes, sem, null)]];
  }

  // GLSL, eg. "uniform Transform { ... };"
  private interfaceBlock(): Ast.TopLevel {
    const ty = this.specifiedType();
    const sem = this.semantics();
    const s = sem.map((e) => ":" + Printer.exprToS(e)).join("");
    const ret = Ast.TypeDecl(this.blockSpecifier(Printer.typeToS(ty) + s));
    // semicolon seems to be optional in hlsl
    if (this.options.hlsl) this.opt(() => this.ch(";"));
    else this.ch(";");
    return ret;
  }

  // ---- statements ---------------------------------------------------------

  private forLoop(): Ast.Stmt {
    this.keyword("for");
    this.ch("(");
    const initD = this.attempt(() => this.declaration());
    let initE: Ast.Expr | null = null;
    if (initD === null) initE = this.opt(() => this.expr());
    this.ch(";");
    const cond = this.opt(() => this.expr());
    this.ch(";");
    const inc = this.opt(() => this.expr());
    this.ch(")");
    const body = this.statement();
    return initD !== null ? Ast.ForD(initD, cond, inc, body) : Ast.ForE(initE, cond, inc, body);
  }

  private whileLoop(): Ast.Stmt {
    this.keyword("while");
    const cond = this.parenExp();
    return Ast.While(cond, this.statement());
  }

  private doWhileLoop(): Ast.Stmt {
    this.keyword("do");
    const body = this.statement();
    this.str("while");
    const cond = this.parenExp();
    return Ast.DoWhile(cond, body);
  }

  private ifStatement(): Ast.Stmt {
    this.keyword("if");
    const cond = this.parenExp();
    const th = this.statement();
    const el = this.opt(() => { this.str("else"); return this.statement(); });
    return Ast.If(cond, th, el);
  }

  private block(): Ast.Stmt {
    this.ch("{");
    const list = this.many(() => this.statement());
    this.ch("}");
    return Ast.Block(list);
  }

  private caseLabel(): Ast.CaseLabel {
    const label = this.choice<Ast.CaseLabel>("case",
      () => { this.keyword("case"); return { kind: "Case", expr: this.expr() }; },
      () => { this.keyword("default"); return { kind: "Default" }; },
    );
    this.ch(":");
    return label;
  }

  private switchStmt(): Ast.Stmt {
    this.keyword("switch");
    const e = this.parenExp();
    this.ch("{");
    const cases = this.many((): Ast.SwitchCase => {
      const label = this.caseLabel();
      const stmts = this.many(() => this.statement());
      return { label, stmts };
    });
    this.ch("}");
    return Ast.Switch(e, cases);
  }

  // A preprocessor line, as a statement or top-level item.
  private macro(): string[] {
    if (this.peek() !== "#") this.fail("'#'");
    this.pos++;
    // an ident, without eating trailing spaces
    const rawIdent = (): string => {
      let end = this.pos;
      while (end < this.src.length && isIdentChar(this.src[end])) end++;
      const s = this.src.slice(this.pos, end);
      this.pos = end;
      return s;
    };
    // manyCharsTill (anyChar .>> nl) newline, where nl skips comments and backslash-newline continuations
    const line = (): string => {
      let out = "";
      const nl = () => {
        this.skipComment();
        while (this.peek() === "\\" && this.peek(1) === "\n") this.pos += 2;
      };
      for (;;) {
        if (this.eof()) this.fail("newline");
        if (this.peek() === "\n") { this.pos++; return out; }
        out += this.peek();
        this.pos++;
        nl();
      }
    };
    const define = this.attempt(() => {
      this.keyword("define");
      const id = rawIdent();
      const rest = line();
      this.forbiddenNames = [id, ...this.forbiddenNames];
      const idents = macroBodyIdents(rest);
      for (const name of idents.names) this.pinnedNames.add(name);
      for (const name of idents.fields) this.pinnedFields.add(name);
      return ["#define", id, rest];
    });
    const res = define ?? ["#" + line()];
    this.ws();
    return res;
  }

  // HLSL attribute, eg. [maxvertexcount(12)]
  private attribute(): string {
    if (!this.options.hlsl) this.fail("attribute");
    this.ch("[");
    const end = this.src.indexOf("]", this.pos);
    if (end < 0) this.fail("]");
    const s = this.src.slice(this.pos, end);
    this.pos = end + 1;
    this.ws();
    return "[" + s + "]";
  }

  // HLSL template, e.g. template<typename T>
  private template(): string {
    if (!this.options.hlsl) this.fail("template");
    this.str("template");
    this.ch("<");
    const end = this.src.indexOf(">", this.pos);
    if (end < 0) this.fail(">");
    const s = this.src.slice(this.pos, end);
    this.pos = end + 1;
    this.ws();
    return `template<${s}>`;
  }

  private jump(): Ast.Stmt {
    const res = this.choice<Ast.Stmt>("jump",
      () => {
        const k = this.choice("jump", () => this.keyword("break"), () => this.keyword("continue"), () => this.keyword("discard"));
        return Ast.Jump(Ast.jumpKeywordFromString(k), null);
      },
      () => {
        this.keyword("return");
        const e = this.opt(() => this.expr());
        return Ast.Jump("return", e);
      },
    );
    this.ch(";");
    return res;
  }

  private simpleStatement(): Ast.Stmt {
    const e = this.opt(() => this.expr());
    this.ch(";");
    return e === null ? Ast.Block([]) : Ast.ExprStmt(e);
  }

  private statement(): Ast.Stmt {
    return this.choice<Ast.Stmt>("statement",
      () => Ast.Verbatim(this.template()),
      () => this.block(),
      () => this.jump(),
      () => this.forLoop(),
      () => this.ifStatement(),
      () => this.whileLoop(),
      () => this.doWhileLoop(),
      () => this.switchStmt(),
      () => Ast.Verbatim(this.verbatim()),
      () => Ast.Directive(this.macro()),
      () => Ast.Verbatim(this.attribute()),
      () => { const d = this.declaration(); this.ch(";"); return Ast.DeclStmt(d); },
      () => this.simpleStatement(),
    );
  }

  // ---- functions and top level -------------------------------------------

  // e.g. "int foo(float a[], out int b) : color"
  private functionHeader(): Ast.FunctionType {
    const ty = this.specifiedType();
    const id = this.ident();
    this.ch("(");
    const args = this.choice<Ast.Decl[]>("arguments",
      () => { this.keyword("void"); return []; },
      () => this.sepBy(() => this.singleDeclaration(), ","),
    );
    this.ch(")");
    const sem = this.semantics();
    return Ast.makeFunctionType(ty, id, args, sem);
  }

  private pfunction(): Ast.TopLevel {
    const head = this.functionHeader();
    const body = this.block();
    return Ast.Function(head, body);
  }

  private precision(): Ast.TopLevel {
    this.keyword("precision");
    const ty = this.specifiedType();
    this.ch(";");
    return Ast.Precision(ty);
  }

  private loneLayoutQualifier(): string {
    const list = this.qualifier();
    this.ch(";");
    return list.join(" ") + ";";
  }

  private forwardDecl(): void {
    this.functionHeader();
    this.ch(";");
    this.reorderFunctions = true;
  }

  private topLevelItem(): Ast.TopLevel {
    return this.choice<Ast.TopLevel>("top-level declaration",
      () => { const ss = this.macro(); return Ast.TLDirective(ss, this.location()); },
      () => Ast.TLVerbatim(this.template()),
      () => Ast.TLVerbatim(this.verbatim()),
      () => Ast.TLVerbatim(this.attribute()),
      () => { const d = this.declaration(); this.ch(";"); return Ast.TLDecl(d); },
      () => this.structDecl(),
      () => this.interfaceBlock(),
      () => Ast.TLVerbatim(this.loneLayoutQualifier()),
      () => this.precision(),
      () => this.pfunction(),
    );
  }

  private topLevel(): Ast.TopLevel[] {
    const res: Ast.TopLevel[] = [];
    const skipFwd = () => { while (this.attempt(() => this.forwardDecl()) !== null) { /* skip */ } };
    for (;;) {
      skipFwd();
      const item = this.attempt(() => this.topLevelItem());
      if (item === null) break;
      res.push(item);
    }
    skipFwd();
    return res;
  }

  run(): Ast.Shader {
    this.forbiddenNames = ["if", "in", "do"];
    this.reorderFunctions = false;
    this.pos = 0;
    this.ws();
    const code = this.topLevel();
    if (!this.eof()) {
      const save = this.pos;
      this.pos = Math.max(this.furthest, this.pos);
      const loc = this.location();
      this.pos = save;
      const snippet = this.src.slice(this.pos, this.pos + 30).replace(/\n/g, "\\n");
      throw new ParseError(`Error in ${this.streamName}: Ln: ${loc.line} Col: ${loc.col}\n${snippet}\n^\nExpecting: ${this.furthestExpected || "top-level declaration"}`);
    }
    return { filename: this.streamName, code, forbiddenNames: this.forbiddenNames, pinnedNames: [...this.pinnedNames], pinnedFields: [...this.pinnedFields], reorderFunctions: this.reorderFunctions };
  }
}

export function runParser(options: Options, streamName: string, content: string): Ast.Shader {
  let src = options.preprocess ? preprocess(streamName, content) : content;
  if (options.expandMacros) src = expandMacros(src);
  const shader = new ParserImpl(options, src, streamName).run();
  pinMacroNames(options, shader);
  if (options.preserveExternals || options.preserveAllGlobals) pinExternalStructFields(shader);
  return shader;
}

// Under --preserve-externals a uniform's name is what the application looks up, and for a struct
// uniform that name includes the field: three.js sets `directionalLights[0].direction`. The
// fields of every struct an external declaration uses, and of the structs those fields use, keep
// their names. Upstream renames them.
//
// The struct's own type name is kept too, for a different reason: GL matches a struct-typed
// uniform or varying between the vertex and the fragment shader by type name as well as by
// variable name, and the two shaders are minified separately, so a renamed type gets a different
// name in each half and the program fails to link ("Structure names of uniform 'x' differ between
// VERTEX and FRAGMENT").
//
// An external declaration is a uniform, in or out declaration of a named struct type, an
// interface block declared inline (`uniform Blk { L l; };`, whose members are external globals),
// or a declaration whose type is written out as a block.
function pinExternalStructFields(shader: Ast.Shader): void {
  const structs = new Map<string, Ast.StructOrInterfaceBlock>();
  for (const tl of shader.code) if (tl.kind === "TypeDecl" && tl.block.name !== null) structs.set(tl.block.name.name, tl.block);
  const pending: Ast.StructOrInterfaceBlock[] = [];
  const seed = (ty: Ast.Type): void => {
    if (ty.name.kind === "TypeBlock") pending.push(ty.name.block);
    else { const b = structs.get(ty.name.ident.name); if (b !== undefined) pending.push(b); }
  };
  for (const tl of shader.code) {
    if (tl.kind === "TLDecl" && Ast.typeIsExternal(tl.decl[0])) seed(tl.decl[0]);
    // `uniform Blk { ... };` with no instance name: the members are external globals, so the
    // structs they use are part of the interface too.
    if (tl.kind === "TypeDecl" && tl.block.blockType.kind === "InterfaceBlock") pending.push(tl.block);
  }
  const done = new Set<Ast.StructOrInterfaceBlock>();
  const fieldNames = new Set<string>();
  while (pending.length > 0) {
    const block = pending.pop()!;
    if (done.has(block)) continue;
    done.add(block);
    if (block.blockType.kind === "Struct" && block.name !== null) block.name.pinned = true;
    for (const m of block.members) {
      if (m.kind !== "MemberVariable") continue;
      const [ty, elts] = m.decl;
      for (const e of elts) fieldNames.add(e.name.name);
      seed(ty);
    }
  }
  // The renamer renames a field name the same way in every struct, so a name kept in one struct
  // is kept in all of them.
  for (const block of structs.values()) {
    for (const m of block.members) {
      if (m.kind === "MemberVariable") for (const e of m.decl[1]) if (fieldNames.has(e.name.name)) e.name.pinned = true;
    }
  }
}

/** The identifiers a macro body refers to, minus its parameters: `(a,b) a+b*k.x` gives names `k` and fields `x`. */
export function macroBodyIdents(rest: string): { names: string[]; fields: string[] } {
  let body = rest;
  let params: string[] = [];
  const m = /^\(([^)]*)\)/.exec(rest); // function-like: no space before the parenthesis
  if (m !== null) {
    params = m[1].split(",").map((s) => s.trim());
    body = rest.slice(m[0].length);
  }
  const names: string[] = [];
  const fields: string[] = [];
  for (const m of body.matchAll(/\.\s*([A-Za-z_][A-Za-z0-9_]*)|(?<![0-9A-Za-z_.])([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (m[1] !== undefined) fields.push(m[1]);
    else if (!params.includes(m[2]) && !Builtin.keywords.has(m[2])) names.push(m[2]);
  }
  return { names, fields };
}

// A #define the minifier keeps is text it cannot see into: a variable, function, struct or field
// the body names must stay declared under that name. Mark every declaration of such a name, and
// keep the names that were declared out of the renamer's generated list.
function pinMacroNames(options: Options, shader: Ast.Shader): void {
  const names = new Set(shader.pinnedNames);
  const fields = new Set(shader.pinnedFields);
  if (names.size === 0 && fields.size === 0) return;
  const used = new Set<string>();
  const pin = (id: Ast.Ident, set: Set<string>): void => { if (set.has(id.name)) { id.pinned = true; id.doNotInline = true; used.add(id.name); } };
  const pinDecl = ([, elts]: Ast.Decl, set = names): void => { for (const e of elts) pin(e.name, set); };
  const pinBlock = (block: Ast.StructOrInterfaceBlock): void => {
    if (block.name !== null) pin(block.name, names);
    for (const m of block.members) if (m.kind === "MemberVariable") pinDecl(m.decl, fields);
  };
  for (const tl of shader.code) {
    if (tl.kind === "TLDecl") pinDecl(tl.decl);
    else if (tl.kind === "Function") { pin(tl.funcType.fName, names); for (const d of tl.funcType.args) pinDecl(d); }
    else if (tl.kind === "TypeDecl") pinBlock(tl.block);
  }
  const pinStmt = (_env: Ast.MapEnv, s: Ast.Stmt): Ast.Stmt => {
    if (s.kind === "Decl") pinDecl(s.decl);
    else if (s.kind === "ForD") pinDecl(s.init);
    return s;
  };
  Ast.visitor(options, undefined, pinStmt).iterTopLevel(shader.code);
  shader.forbiddenNames = [...used, ...shader.forbiddenNames];
}
