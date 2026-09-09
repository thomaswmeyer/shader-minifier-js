// Port of Minifier/preprocessor.fs
// Only evaluates the directives it can decide statically (#if 0/1, #ifdef of a macro defined in the file).

// The stack contains information for each nested #if/#ifdef block
//   Active: condition was true, lines are printed (e.g. #if 1)
//   Inactive: condition was false, delete the text (e.g. #if 0)
//   Unknown: condition could not be evaluated, keep both the directive and the text
type Status = "Active" | "Inactive" | "Unknown";

class Impl {
  // Dict of macro name to value
  private readonly defines = new Map<string, string>();
  private readonly stack: Status[] = [];

  private currentStatus(): Status {
    return this.stack.length === 0 ? "Active" : this.stack[this.stack.length - 1];
  }

  private enterScope(evaluated: Status): void {
    this.stack.push(this.currentStatus() === "Inactive" ? "Inactive" : evaluated);
  }

  private evalCond(str: string): Status {
    switch (str.trim()) {
      case "0": return "Inactive";
      case "1": return "Active";
      default: return "Unknown";
    }
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
      case "elif": {
        const oldStatus = this.stack.pop() ?? "Active";
        const cond = this.evalCond(afterKw);
        let newStatus: Status;
        if (oldStatus === "Unknown" || cond === "Unknown") newStatus = "Unknown";
        else if (cond === "Inactive") newStatus = "Inactive";
        else if (oldStatus === "Active") newStatus = "Inactive";
        else newStatus = "Active";
        this.stack.push(newStatus);
        return newStatus === "Unknown" ? "#elif " + afterKw : "";
      }
      case "else": {
        const st = this.stack.pop() ?? "Active";
        switch (st) {
          case "Active": this.stack.push("Inactive"); return "";
          case "Inactive": this.stack.push("Active"); return "";
          default: this.stack.push("Unknown"); return "#else";
        }
      }
      case "endif": {
        const st = this.stack.pop() ?? "Active";
        return st === "Unknown" ? "#endif" : "";
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
      if (line.startsWith("#")) {
        out.push(this.directive(line.slice(1).replace(/^[ \t]*/, "")));
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

// ---------------------------------------------------------------------------
// Port addition (--expand-macros): expand #define like a C preprocessor would, so the macro names
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
      if (trackComments && text.startsWith("//", i)) return out + text.slice(i);
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
      out += this.expand(body, inner, false);
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

  // Pass 2: expand in file order with the definitions active at each point.
  const macros = new Map<string, Macro>();
  const expander = new MacroExpander(macros);
  const out: string[] = [];
  for (const line of lines) {
    if (!/^\s*#/.test(line)) { out.push(expander.expandLine(line)); continue; }
    const p = parseDefine(line);
    if (p === null || keep.has(p.def.name)) { out.push(line); continue; }
    if (p.kw === "undef") macros.delete(p.def.name);
    else macros.set(p.def.name, { params: p.def.params, body: p.def.body });
    out.push(""); // removed directives leave an empty line so parse errors keep their line numbers
  }
  return out.join("\n");
}
