// Port of Minifier/preprocessor.fs
// Only evaluates the directives it can decide statically (#if 0/1, #ifdef of a macro defined in the file).

// The stack contains information for each nested #if/#ifdef block
//   Active: condition was true, lines are printed (e.g. #if 1)
//   Inactive: condition was false, delete the text (e.g. #if 0)
//   Unknown: condition could not be evaluated, keep both the directive and the text
type Status = "Active" | "Inactive" | "Unknown";

// A conditional block: the status of the branch being read, whether an earlier branch of the
// same block was taken (Active: yes, Inactive: no, Unknown: one of them could not be decided),
// and whether a directive of the block reached the output, so that its #endif must too.
interface Frame { status: Status; taken: Status; emitted: boolean }

class Impl {
  // Dict of macro name to value
  private readonly defines = new Map<string, string>();
  private readonly stack: Frame[] = [];

  private currentStatus(): Status {
    return this.stack.length === 0 ? "Active" : this.stack[this.stack.length - 1].status;
  }

  // The status enclosing the block on top of the stack.
  private parentStatus(): Status {
    return this.stack.length < 2 ? "Active" : this.stack[this.stack.length - 2].status;
  }

  private enterScope(evaluated: Status): void {
    const status = this.currentStatus() === "Inactive" ? "Inactive" : evaluated;
    this.stack.push({ status, taken: evaluated, emitted: status === "Unknown" });
  }

  // Upstream ports these as a flat status stack that forgets whether a branch was taken, so
  // `#if 1 ... #else` activated the else branch and an `#elif 1` inside an inactive block woke
  // its text up (three.js's nested chains). A branch after a taken one is inactive; after an
  // undecidable one it is undecidable too, and its directive is kept (as `#if` when the block's
  // own `#if` line was dropped, so the output stays well formed).
  private nextBranch(cond: Status, text: string): string {
    const frame = this.stack[this.stack.length - 1] ?? { status: "Active", taken: "Inactive", emitted: false };
    if (this.stack.length === 0) this.stack.push(frame);
    const parent = this.parentStatus();
    let status: Status;
    if (parent === "Inactive" || frame.taken === "Active") status = "Inactive";
    else if (frame.taken === "Unknown" || cond === "Unknown") status = "Unknown";
    else status = cond;
    if (cond === "Active" && frame.taken === "Inactive") frame.taken = "Active";
    else if (cond === "Unknown" && frame.taken !== "Active") frame.taken = "Unknown";
    frame.status = status;
    if (status !== "Unknown") return "";
    const line = frame.emitted ? text : text.replace(/^#elif\b/, "#if").replace(/^#else$/, "#if 1");
    frame.emitted = true;
    return line;
  }

  // Upstream decides `#if 0` and `#if 1` only. The port also decides a constant expression of
  // integer literals, `defined(X)` and the C operators (`#if ( 1 > 0 ) && defined( USE_MAP )`, the
  // form engines like three.js emit after substituting their counts); a bare identifier still
  // makes the condition unknown, as upstream's `#if DEF` golden expects.
  private evalCond(str: string): Status {
    const v = evalConstantExpression(str, (name) => this.defines.has(name), (name) => {
      const d = this.defines.get(name);
      if (d === undefined) return 0; // not defined in the file: 0, as for #ifdef
      const n = /^\s*(\d+)[uU]?\s*$/.exec(d);
      return n === null ? null : parseInt(n[1], 10);
    });
    return v === null ? "Unknown" : v !== 0 ? "Active" : "Inactive";
  }

  // Splits "ident rest" where ident is [A-Za-z0-9_]* (may be empty), like parseIdent + parseEndLine.
  private static splitIdent(s: string): [string, string] {
    const m = /^([A-Za-z0-9_]*)(.*)$/s.exec(s)!;
    return [m[1], m[2]];
  }

  private directive(body: string): string {
    // body is the text after '#' and spaces, without the newline
    const kw = /^([A-Za-z]+)(?![A-Za-z0-9_])/.exec(body);
    const keyword = kw ? kw[1] : "";
    const afterKw = kw ? body.slice(kw[0].length).replace(/^[ \t]*/, "") : "";
    // Inside an inactive block only the conditional directives matter: a #define there must
    // neither be recorded nor kept (upstream recorded it, so `#define ENV_WORLDPOS` under a false
    // condition decided a later `#ifdef ENV_WORLDPOS`).
    const conditional = keyword === "if" || keyword === "ifdef" || keyword === "ifndef" || keyword === "elif" || keyword === "else" || keyword === "endif";
    if (!conditional && this.currentStatus() === "Inactive") return "";
    switch (keyword) {
      case "line":
        return "";
      case "extension": {
        const [name, behavior] = Impl.splitIdent(afterKw);
        return name === "GL_GOOGLE_include_directive" ? "" : `#extension ${name}${behavior}`;
      }
      case "define": {
        const [name, line] = Impl.splitIdent(afterKw);
        this.defines.set(name, line);
        return `#define ${name}${line}`;
      }
      case "undef": {
        const [name] = Impl.splitIdent(afterKw);
        this.defines.delete(name);
        return `#undef ${name}`;
      }
      case "elif": return this.nextBranch(this.evalCond(afterKw), "#elif " + afterKw);
      case "else": return this.nextBranch("Active", "#else");
      case "endif": {
        const frame = this.stack.pop();
        return frame !== undefined && frame.emitted ? "#endif" : "";
      }
      case "if": {
        const status = this.evalCond(afterKw);
        this.enterScope(status);
        return status === "Unknown" ? "#if " + afterKw : "";
      }
      case "ifdef": case "ifndef": {
        const [ident] = Impl.splitIdent(afterKw);
        this.enterScope(this.defines.has(ident) === (keyword === "ifdef") ? "Active" : "Inactive");
        return "";
      }
      default:
        // It is valid to have '#' alone on a line. This is a no op.
        if (body === "") return "\n";
        // Unknown directive, keep it.
        return this.currentStatus() === "Inactive" ? "" : "#" + body;
    }
  }

  parse(content: string): string {
    const lines = content.split("\n");
    // A trailing newline produces an empty last element which upstream (parseEndLine) would not emit.
    if (lines.length > 0 && lines[lines.length - 1] === "" && content.endsWith("\n")) lines.pop();
    const out: string[] = [];
    for (const rawLine of lines) {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      // GLSL allows whitespace before `#` (three.js indents its directives with tabs); upstream
      // only recognises a directive at column 0 and lets the rest through as code.
      const trimmed = line.replace(/^[ \t]*/, "");
      if (trimmed.startsWith("#")) {
        out.push(this.directive(trimmed.slice(1).replace(/^[ \t]*/, "")));
      } else {
        out.push(this.currentStatus() === "Inactive" ? "" : line);
      }
    }
    return out.join("\n");
  }
}

export function preprocess(_streamName: string, content: string): string {
  return new Impl().parse(content);
}

/**
 * The integer value of a preprocessor constant expression, or null when it is not one the port
 * decides: anything with a bare identifier, a function-like form other than `defined`, or a
 * syntax error. Precedence climbing over the C operators; division by zero is null too.
 */
export function evalConstantExpression(text: string, isDefined: (name: string) => boolean, valueOf: (name: string) => number | null = () => null): number | null {
  const tokens = text.match(/\d+[uU]?|[A-Za-z_]\w*|&&|\|\||==|!=|<=|>=|<<|>>|[-+*/%<>!~()&|^]/g) ?? [];
  if (tokens.join("") !== text.replace(/\s+/g, "")) return null; // something the tokenizer skipped
  let i = 0;
  const peek = (): string | undefined => tokens[i];
  const take = (): string => tokens[i++];
  const fail = { failed: false };
  const primary = (): number => {
    const t = take();
    if (t === undefined) { fail.failed = true; return 0; }
    if (t === "(") { const v = expr(0); if (take() !== ")") fail.failed = true; return v; }
    if (t === "!") return primary() === 0 ? 1 : 0;
    if (t === "-") return -primary();
    if (t === "+") return primary();
    if (t === "~") return ~primary();
    if (/^\d/.test(t)) return parseInt(t, 10);
    if (t === "defined") {
      const paren = peek() === "(";
      if (paren) take();
      const name = take();
      if (name === undefined || !/^[A-Za-z_]/.test(name)) { fail.failed = true; return 0; }
      if (paren && take() !== ")") fail.failed = true;
      return isDefined(name) ? 1 : 0;
    }
    const v = valueOf(t); // a bare identifier: its #define's integer value, 0 when undefined, else not decided
    if (v === null) { fail.failed = true; return 0; }
    return v;
  };
  const precedence: Record<string, number> = { "||": 1, "&&": 2, "|": 3, "^": 4, "&": 5, "==": 6, "!=": 6, "<": 7, ">": 7, "<=": 7, ">=": 7, "<<": 8, ">>": 8, "+": 9, "-": 9, "*": 10, "/": 10, "%": 10 };
  const apply = (op: string, a: number, b: number): number => {
    switch (op) {
      case "||": return a !== 0 || b !== 0 ? 1 : 0;
      case "&&": return a !== 0 && b !== 0 ? 1 : 0;
      case "|": return a | b; case "^": return a ^ b; case "&": return a & b;
      case "==": return a === b ? 1 : 0; case "!=": return a !== b ? 1 : 0;
      case "<": return a < b ? 1 : 0; case ">": return a > b ? 1 : 0; case "<=": return a <= b ? 1 : 0; case ">=": return a >= b ? 1 : 0;
      case "<<": return a << b; case ">>": return a >> b;
      case "+": return a + b; case "-": return a - b; case "*": return a * b;
      case "/": if (b === 0) { fail.failed = true; return 0; } return Math.trunc(a / b);
      case "%": if (b === 0) { fail.failed = true; return 0; } return a % b;
      default: fail.failed = true; return 0;
    }
  };
  const expr = (minPrec: number): number => {
    let left = primary();
    for (;;) {
      const op = peek();
      if (op === undefined || !(op in precedence) || precedence[op] < minPrec) return left;
      take();
      const right = expr(precedence[op] + 1);
      left = apply(op, left, right);
    }
  };
  const value = expr(0);
  return fail.failed || i !== tokens.length ? null : value;
}

// ---------------------------------------------------------------------------
// --expand-macros: expand #define like a C preprocessor would, so the macro names
// and their definitions disappear from the output. Upstream keeps macros verbatim on purpose.
// Left alone: macros defined inside #if blocks, macros named in #if/#ifdef conditions, and
// bodies using # or ## - those stay for the compiler's preprocessor.

interface Macro { params: string[] | null; body: string }

const stripComments = (s: string): string => s.replace(/\/\*.*?\*\//g, " ").replace(/\/\/.*$/, "");
const isIdentStart = (c: string): boolean => /[A-Za-z_]/.test(c);
const isIdentChar = (c: string): boolean => /[A-Za-z0-9_]/.test(c);

class MacroExpander {
  private inBlockComment = false;
  constructor(private readonly macros: ReadonlyMap<string, Macro>) {}

  expandLine(line: string): string { return this.expand(line, new Set(), true); }

  private expand(text: string, active: ReadonlySet<string>, trackComments: boolean): string {
    let out = "";
    let i = 0;
    while (i < text.length) {
      const c = text[i];
      if (trackComments && this.inBlockComment) {
        const end = text.indexOf("*/", i);
        if (end < 0) return out + text.slice(i);
        out += text.slice(i, end + 2); i = end + 2; this.inBlockComment = false; continue;
      }
      if (trackComments && text.startsWith("//", i)) {
        const nl = text.indexOf("\n", i);
        if (nl < 0) return out + text.slice(i);
        out += text.slice(i, nl); i = nl; continue;
      }
      if (trackComments && text.startsWith("/*", i)) { this.inBlockComment = true; out += "/*"; i += 2; continue; }
      if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(text[i + 1] ?? ""))) {
        const m = /^[0-9A-Za-z_.]+/.exec(text.slice(i))!;
        out += m[0]; i += m[0].length; continue;
      }
      if (!isIdentStart(c)) { out += c; i++; continue; }
      let j = i + 1;
      while (j < text.length && isIdentChar(text[j])) j++;
      const name = text.slice(i, j);
      const macro = this.macros.get(name);
      if (macro === undefined || active.has(name)) { out += name; i = j; continue; }
      const inner = new Set(active); inner.add(name);
      if (macro.params === null) { out += this.expand(macro.body, inner, false); i = j; continue; }
      const call = MacroExpander.parseArgs(text, j);
      if (call === null) { out += name; i = j; continue; }
      const args = call.args.map((a) => this.expand(a.trim(), active, false));
      const body = MacroExpander.substitute(macro.body, macro.params, args);
      const expansion = this.expand(body, inner, false);
      // Newlines of a call spanning lines that trimming dropped come back after it, so line numbers hold.
      const count = (s: string): number => (s.match(/\n/g) ?? []).length;
      out += expansion + "\n".repeat(Math.max(0, count(text.slice(j, call.end)) - count(expansion)));
      i = call.end;
    }
    return out;
  }

  // Reads "(a, f(b, c), d)" starting at the first non-space after `from`; returns null if absent or unbalanced.
  private static parseArgs(text: string, from: number): { args: string[]; end: number } | null {
    let i = from;
    while (i < text.length && /[ \t]/.test(text[i])) i++;
    if (text[i] !== "(") return null;
    const args: string[] = [];
    let depth = 0;
    let start = i + 1;
    for (let k = i; k < text.length; k++) {
      const c = text[k];
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) {
          const last = text.slice(start, k);
          if (args.length > 0 || last.trim() !== "") args.push(last);
          return { args, end: k + 1 };
        }
      } else if (c === "," && depth === 1) { args.push(text.slice(start, k)); start = k + 1; }
    }
    return null;
  }

  private static substitute(body: string, params: string[], args: string[]): string {
    return body.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (id) => {
      const k = params.indexOf(id);
      return k < 0 ? id : (args[k] ?? "");
    });
  }
}

const identifiers = (s: string): string[] => s.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];

interface Definition { name: string; params: string[] | null; body: string; line: string }

const defineRegex = /^\s*#\s*(define|undef)\s+([A-Za-z_][A-Za-z0-9_]*)(\([^)]*\))?(.*)$/s;

function parseDefine(line: string): { kw: string; def: Definition } | null {
  const d = defineRegex.exec(line);
  if (d === null) return null;
  const [, kw, name, paramList, tail] = d;
  const params = paramList === undefined ? null : paramList.slice(1, -1).split(",").map((s) => s.trim()).filter((s) => s !== "");
  return { kw, def: { name, params, body: stripComments(tail).trim(), line } };
}

export function expandMacros(content: string): string {
  const lines = content.replace(/\\\r?\n/g, " ").split("\n");

  // Pass 1: which macro names must stay for the compiler's preprocessor.
  const keep = new Set<string>();
  const definitions = new Map<string, Definition[]>();
  const codeText: string[] = [];
  let depth = 0;
  for (const line of lines) {
    const dir = /^\s*#\s*([A-Za-z]*)(.*)$/s.exec(line);
    if (dir === null) { codeText.push(line); continue; }
    const kw = dir[1];
    if (kw === "if" || kw === "ifdef" || kw === "ifndef") depth++;
    else if (kw === "endif") depth--;
    if (kw === "if" || kw === "ifdef" || kw === "ifndef" || kw === "elif") for (const id of identifiers(dir[2])) keep.add(id);
    const p = parseDefine(line);
    if (p === null) continue;
    if (depth > 0 || p.def.body.includes("#")) keep.add(p.def.name);
    if (p.kw === "define") (definitions.get(p.def.name) ?? definitions.set(p.def.name, []).get(p.def.name)!).push(p.def);
  }

  // Expanding a macro must not grow the output: a long body used many times stays a macro.
  const code = stripComments(codeText.join("\n"));
  for (const [name, defs] of definitions) {
    if (keep.has(name)) continue;
    const uses = (code.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
    const defBytes = defs.reduce((a, d) => a + d.line.length + 1, 0);
    const bodyBytes = Math.max(...defs.map((d) => d.body.length));
    if (uses * bodyBytes > defBytes + uses * name.length) keep.add(name);
  }

  // A kept macro's body is left verbatim, so everything it refers to must be kept too.
  let grew = true;
  while (grew) {
    grew = false;
    for (const name of keep) {
      for (const def of definitions.get(name) ?? []) {
        for (const id of identifiers(def.body)) {
          if (definitions.has(id) && !keep.has(id)) { keep.add(id); grew = true; }
        }
      }
    }
  }

  // Pass 2: expand in file order with the definitions active at each point. A run of code lines
  // between directives is expanded as one text, so a call's arguments may span lines; the
  // newlines survive inside the expansion and line numbers stay put.
  const macros = new Map<string, Macro>();
  const expander = new MacroExpander(macros);
  const out: string[] = [];
  let run: string[] = [];
  const flush = (): void => { if (run.length > 0) out.push(expander.expandLine(run.join("\n"))); run = []; };
  for (const line of lines) {
    if (!/^\s*#/.test(line)) { run.push(line); continue; }
    flush();
    const p = parseDefine(line);
    if (p === null || keep.has(p.def.name)) { out.push(line); continue; }
    if (p.kw === "undef") macros.delete(p.def.name);
    else macros.set(p.def.name, { params: p.def.params, body: p.def.body });
    out.push(""); // removed directives leave an empty line so parse errors keep their line numbers
  }
  flush();
  return out.join("\n");
}
