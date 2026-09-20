// Port of Minifier/printer.fs
import * as Ast from "./ast.js";
import type { Ident, Expr, Stmt, Type, TypeSpec, Decl, DeclElt, FunctionType, TopLevel, StructOrInterfaceBlock, StructMember, Shader } from "./ast.js";

// https://github.com/ConspiracyHu/kkpView-public/blob/main/README.md
function kkpSymFormat(shaderSymbol: string, minifiedSize: number, symbolPool: string[], symbolIndexes: number[]): Uint8Array {
  const bytes: number[] = [];
  const ascii = (s: string) => { for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i) & 0xff); };
  const asciiz = (s: string) => { ascii(s); bytes.push(0); };
  const fourByteInteger = (n: number) => bytes.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
  const twoByteInteger = (n: number) => bytes.push(n & 0xff, (n >>> 8) & 0xff);
  ascii("PHXP");                        // 4 bytes: FOURCC: 'PHXP'
  asciiz(shaderSymbol);                 // ASCIIZ string: name of the shader described by this sym file.
  fourByteInteger(minifiedSize);        // 4 bytes: minified data size (Ds) of the shader.
  fourByteInteger(symbolPool.length);   // 4 bytes: symbol count (Sc).
  for (const symbolName of symbolPool) asciiz(symbolName); // For each symbol (Sc), ASCIIZ string: name of the symbol.
  for (const symbolIndex of symbolIndexes) twoByteInteger(symbolIndex); // For each byte in the minified shader (Ds), 2 bytes: symbol index in the symbol pool.
  return Uint8Array.from(bytes);
}

class SymbolMap {
  private readonly symbolRefs: string[] = []; // one per byte in the minified shader
  addMapping(str: string, symbolName: string): void {
    for (let i = 0; i < str.length; i++) {
      if (str.charCodeAt(i) >= 256) throw new Error("cannot process a non-byte char");
      this.symbolRefs.push(symbolName);
    }
  }
  symFileBytes(shaderSymbol: string, minifiedShader: string): Uint8Array {
    if (minifiedShader.length !== this.symbolRefs.length) throw new Error("minified byte size doesn't match symbols");
    const indexMap = new Map<string, number>(); // maps each distinct symbol name to its index in the pool
    const symbolPool: string[] = [];
    const symbolIndexes = this.symbolRefs.map((name) => {
      let idx = indexMap.get(name);
      if (idx === undefined) { idx = symbolPool.length; symbolPool.push(name); indexMap.set(name, idx); }
      return idx;
    });
    return kkpSymFormat(shaderSymbol, minifiedShader.length, symbolPool, symbolIndexes);
  }
}

export const stripIndentation = (s: string): string => s.replace(/\0/g, "").replace(/\t/g, ""); // see PrinterImpl.nl

const precedenceList: string[][] = [
  [","],
  ["=", "+=", "-=", "*=", "/=", "%=", "<<=", ">>=", "&=", "^=", "|="], // precedence = 1
  ["?:"],
  ["||"],
  ["^^"],
  ["&&"],
  ["|"],
  ["^"],
  ["&"],
  ["==", "!="],
  ["<", ">", "<=", ">="],
  ["<<", ">>"],
  ["+", "-"],
  ["*", "/", "%"],
  // _++ is prefix and $++ is postfix
  ["_++", "_--", "_+", "_-", "_~", "_!", "$++", "$--"],
  ["."],
];
const precedence = new Map<string, number>();
precedenceList.forEach((ops, k) => ops.forEach((op) => precedence.set(op, k)));
const prec = (op: string): number => {
  const p = precedence.get(op);
  if (p === undefined) throw new Error(`unknown operator ${op}`);
  return p;
};

const isIdentChar = (c: string): boolean => /[\p{L}\p{Nd}_]/u.test(c); // Char.IsLetterOrDigit
const endsWithIdentChar = (s: string): boolean => s.length > 0 && isIdentChar(s[s.length - 1]);
const startsWithIdentChar = (s: string): boolean => s.length > 0 && isIdentChar(s[0]);

/** Shortest-digits decomposition of a positive finite double: value = 0.DIGITS * 10^(exp+1). */
function shortestDigits(a: number): { digits: string; exp: number } {
  const m = /^(\d)(?:\.(\d+))?e([-+]\d+)$/.exec(a.toExponential())!;
  return { digits: m[1] + (m[2] ?? ""), exp: parseInt(m[3], 10) };
}

// Mirrors .NET a.ToString("#.################"): shortest digits, at most 16 fraction digits, no leading zero.
function fixedForm(a: number): string {
  const { digits, exp } = shortestDigits(a);
  const pointPos = exp + 1;
  let intPart: string;
  let frac: string;
  if (pointPos <= 0) { intPart = ""; frac = "0".repeat(-pointPos) + digits; }
  else if (pointPos >= digits.length) { intPart = digits + "0".repeat(pointPos - digits.length); frac = ""; }
  else { intPart = digits.slice(0, pointPos); frac = digits.slice(pointPos); }
  if (frac.length > 16) {
    const r = a.toFixed(16);
    const mm = /^(\d+)\.(\d+)$/.exec(r)!;
    intPart = mm[1];
    frac = mm[2].replace(/0+$/, "");
  }
  intPart = intPart.replace(/^0+/, "");
  if (intPart === "" && frac === "") return "0.";
  return intPart + "." + frac;
}

// Mirrors .NET a.ToString("0.################e0") rewritten as <digits>e<exp>.
function exponentForm(a: number): string {
  const { digits, exp } = shortestDigits(a);
  return `${digits}e${exp - (digits.length - 1)}`;
}

export function floatToS(f: number): string {
  const a = Math.abs(f);
  if (a === 0 || !Number.isFinite(a)) return (f < 0 && a !== 0 ? "-" : "") + (a === 0 ? "0." : String(a));
  const str1 = fixedForm(a);
  const str2 = exponentForm(a);
  const str = str1.length <= str2.length ? str1 : str2;
  return (f < 0 ? "-" : "") + str;
}

class PrinterImpl {
  constructor(private readonly withLocations: boolean) {}

  private idToS(id: Ident): string {
    // In mode Unambiguous, ids contain numbers. We print a single Unicode char instead.
    if (id.isUniqueId) return String.fromCharCode(1000 + parseInt(id.name, 10));
    if (this.withLocations) return `${id.name}@${id.loc.line},${id.loc.col}@`;
    return id.name;
  }

  private commaListToS<T>(toS: (x: T) => string, li: T[]): string {
    return li.map(toS).join(",");
  }

  // newline and indent that might be stripped later. Use \0 for unessential newline.
  // Use \t for indentation (space would be ambiguous, since a non-indented line can start with a space).
  private nl(indent: number): string { return "\0" + "\t".repeat(indent); }

  exprToS(indent: number, exp: Expr): string { return this.exprToSLevel(indent, 0, exp); }

  // Convert Expr option to string, with default value.
  private exprToSOpt(indent: number, def: string, exp: Expr | null): string {
    return exp === null ? def : this.exprToS(indent, exp);
  }

  private exprToSLevel(indent: number, level: number, e: Expr): string {
    switch (e.kind) {
      case "Int": return `${e.value}${e.suffix}`;
      case "Float": return `${floatToS(e.value)}${e.suffix}`;
      case "Var": return this.idToS(e.ident);
      case "Op": return e.op;
      case "FunCall": {
        const f = e.fn;
        const args = e.args;
        if (f.kind === "Op") {
          const op = f.op;
          if (op === "?:" && args.length === 3) {
            const p = prec("?:");
            const res = `${this.exprToSLevel(indent, p + 1, args[0])}?` +
              // The middle expression of ?: is parsed as if grouped: precedence doesn't apply to it.
              `${this.nl(indent + 1)}${this.exprToSLevel(indent + 1, 0, args[1])}` +
              `:${this.nl(indent + 1)}${this.exprToSLevel(indent + 1, p, args[2])}`;
            return p < level ? `(${res})` : res;
          }
          if (args.length === 1) {
            // Unary operators. _++ is prefix and $++ is postfix
            if (op[0] === "$") return `${this.exprToSLevel(indent, prec(op), args[0])}${op.slice(1)}`;
            const e = this.exprToSLevel(indent, prec("_" + op), args[0]);
            // Upstream only guards binary +/-, so "-(--a)" would print as "---a".
            return (op === "+" || op === "-") && e.startsWith(op) ? `${op} ${e}` : `${op}${e}`;
          }
          if (args.length === 2) {
            // Binary operators.
            const p = prec(op);
            let e1: string;
            let e2: string;
            if (p === prec("=")) { // "=", "+=", or other operator with right-associativity
              e1 = this.exprToSLevel(indent, p + 1, args[0]);
              e2 = this.exprToSLevel(indent, p, args[1]);
            } else {
              e1 = this.exprToSLevel(indent, p, args[0]);
              e2 = this.exprToSLevel(indent, p + 1, args[1]);
            }
            // Add a space to avoid "+" or "-" to be parsed as "++" or "--".
            const opS = (op === "+" || op === "-") && e2.startsWith(op) ? op + " " : op;
            const res = `${e1}${opS}${e2}`;
            return p < level ? `(${res})` : res;
          }
        }
        // Function calls. We set the level in case a comma operator is used in the argument list.
        return `${this.exprToS(indent, f)}(${this.commaListToS((a: Expr) => this.exprToSLevel(indent, prec(",") + 1, a), args)})`;
      }
      case "Subscript": return `${this.exprToS(indent, e.arr)}[${this.exprToSOpt(indent, "", e.index)}]`;
      case "Dot": return `${this.exprToSLevel(indent, prec("."), e.expr)}.${e.field.name}`;
      case "VerbatimExp": return e.text;
    }
  }

  // Add a space if needed
  private sp(s: string): string { return s.length > 0 && isIdentChar(s[0]) ? " " + s : s; }
  private sp2(s: string, s2: string): string { return endsWithIdentChar(s) && startsWithIdentChar(s2) ? s + " " + s2 : s + s2; }

  private blockToS(indent: number, block: StructOrInterfaceBlock): string {
    const name = block.name === null ? "" : " " + block.name.name;
    const d = block.members.map((s) => `${this.nl(indent + 1)}${this.structMemberToS(indent + 1, s)};`).join("");
    const d2 = d === "" ? "" : `${d}${this.nl(indent)}`;
    const prefix = block.blockType.kind === "Struct" ? "struct" : block.blockType.prefix;
    return `${this.sp2(prefix, name)}{${d2}}`;
  }

  private typeSpecToS(indent: number, t: TypeSpec): string {
    return t.kind === "TypeName" ? t.ident.name : this.blockToS(indent, t.block);
  }

  typeToS(indent: number, ty: Type): string {
    const get = (li: string[]): string => {
      if (li.length === 0) return "";
      const str = li.reduce((a, b) => this.sp2(a, b));
      return endsWithIdentChar(str) ? str + " " : str;
    };
    const typeSpec = this.typeSpecToS(indent, ty.name);
    const sizes = ty.arraySizes.map((e) => `[${this.exprToS(indent, e)}]`).join("");
    return `${get(ty.typeQ)}${typeSpec}${sizes}`;
  }

  declToS(indent: number, [ty, vars]: Decl): string {
    const out1 = (decl: DeclElt): string => {
      const sizes = decl.sizes.map((size) => (size.kind === "Int" && size.value === 0 ? "[]" : `[${this.exprToS(indent, size)}]`)).join("");
      // We set the level in case a comma operator is used in the argument list.
      const init = decl.init === null ? "" : `=${this.exprToSLevel(indent, prec(",") + 1, decl.init)}`;
      return `${this.idToS(decl.name)}${sizes}${init}`;
    };
    if (vars.length === 0) return "";
    return `${this.typeToS(indent, ty)} ${this.commaListToS(out1, vars)}`;
  }

  private funDeclToS(indent: number, fct: FunctionType, body: Stmt): string {
    if (body.kind === "Block" && body.stmts.length === 0) return `${this.funToS(indent, fct)}{}`;
    if (body.kind === "Block") return `${this.funToS(indent, fct)}${this.stmtToS(indent, body)}`;
    return `${this.funToS(indent, fct)}${this.nl(indent)}{${this.stmtToS(indent + 1, body)}${this.nl(indent)}}`;
  }

  private structMemberToS(indent: number, m: StructMember): string {
    return this.declToS(indent, m.decl);
  }

  private directiveToS(d: string[]): string {
    if (d.length === 3) return `${d[0]} ${d[1]}${d[2]}\n`;
    return `${d.join(" ")}\n`;
  }

  /// Detect if the current statement might accept a dangling else.
  /// Note that the function needs to be recursive to detect things like:
  ///   if(a) for(;;) if(b) {} else {}
  /// https://github.com/laurentlb/Shader_Minifier/issues/143
  private hasDanglingElseProblem(s: Stmt): boolean {
    switch (s.kind) {
      case "If": return s.else === null ? true : this.hasDanglingElseProblem(s.else);
      case "While": case "DoWhile": case "ForD": case "ForE": return this.hasDanglingElseProblem(s.body);
      default: return false;
    }
  }

  private stmtToSNoNl(indent: number, s: Stmt): string {
    switch (s.kind) {
      case "Block": {
        if (s.stmts.length === 0) return ";";
        const body = s.stmts.map((x) => this.stmtToS(indent + 1, x)).join("");
        return `{${body}${this.nl(indent)}}`;
      }
      case "Decl":
        if (s.decl[1].length === 0) return "";
        return `${this.declToS(indent, s.decl)};`;
      case "Expr": return `${this.exprToS(indent, s.expr)};`;
      case "If": {
        const th = s.else !== null && this.hasDanglingElseProblem(s.then) ? Ast.Block([s.then]) : s.then;
        let el: string;
        if (s.else === null) el = "";
        else if (s.else.kind === "If") el = `${this.nl(indent)}else${this.sp(this.stmtToSNoNl(indent, s.else))}`;
        else el = `${this.nl(indent)}else${this.nl(indent + 1)}${this.sp(this.stmtToSNoNl(indent + 1, s.else))}`;
        return `if(${this.exprToS(indent, s.cond)})${this.stmtToSInd(indent, th)}${el}`;
      }
      case "ForD": {
        const cond = this.exprToSOpt(indent, "", s.cond);
        const inc = this.exprToSOpt(indent, "", s.inc);
        return `for(${this.declToS(indent, s.init)};${cond};${inc})${this.stmtToSInd(indent, s.body)}`;
      }
      case "ForE": {
        const cond = this.exprToSOpt(indent, "", s.cond);
        const inc = this.exprToSOpt(indent, "", s.inc);
        const init = this.exprToSOpt(indent, "", s.init);
        return `for(${init};${cond};${inc})${this.stmtToSInd(indent, s.body)}`;
      }
      case "While": return `while(${this.exprToS(indent, s.cond)})${this.stmtToSInd(indent, s.body)}`;
      case "DoWhile":
        return `do${this.nl(indent + 1)}${this.sp(this.stmtToSNoNl(indent + 1, s.body))}${this.nl(indent)}while(${this.exprToS(indent, s.cond)});`;
      case "Jump":
        return s.expr === null ? `${s.keyword};` : `${s.keyword}${this.sp(this.exprToS(indent, s.expr))};`;
      case "Verbatim": // add a space at end when it seems to be needed
        return s.text.length > 0 && isIdentChar(s.text[s.text.length - 1]) ? s.text + " " : s.text;
      case "Directive": return "\n" + this.directiveToS(s.parts);
      case "Switch": {
        const labelToS = (l: Ast.CaseLabel): string => (l.kind === "Case" ? `case ${this.exprToS(indent, l.expr)}:` : "default:");
        const caseToS = (c: Ast.SwitchCase): string => {
          const stmts = c.stmts.map((x) => this.stmtToS(indent + 2, x)).join("");
          return `${this.nl(indent + 1)}${labelToS(c.label)}${stmts}`;
        };
        const body = s.cases.map(caseToS).join("");
        return `switch(${this.exprToS(indent, s.expr)}){${body}${this.nl(indent)}}`;
      }
    }
  }

  private stmtToS(indent: number, i: Stmt): string { return `${this.nl(indent)}${this.stmtToSNoNl(indent, i)}`; }

  /// print indented statement
  private stmtToSInd(indent: number, i: Stmt): string { return this.stmtToS(indent + 1, i); }

  funToS(indent: number, f: FunctionType): string {
    return `${this.typeToS(indent, f.retType)} ${this.idToS(f.fName)}(${this.commaListToS((d: Decl) => this.declToS(indent, d), f.args)})`;
  }

  private topLevelToS(tl: TopLevel): string {
    switch (tl.kind) {
      case "TLVerbatim": { // add a space at the end when it seems to be needed
        const trailing = tl.text.length > 0 && isIdentChar(tl.text[tl.text.length - 1]) ? " " : "";
        return `${tl.text}${trailing}`;
      }
      case "TLDirective": return this.directiveToS(tl.parts);
      case "Function": return this.funDeclToS(0, tl.funcType, tl.body);
      case "Precision": return `precision ${this.typeToS(0, tl.ty)};`;
      case "TLDecl": return `${this.declToS(0, tl.decl)};`;
      case "TypeDecl": return `${this.blockToS(0, tl.block)};`;
    }
  }

  private printIndentedList(tl: TopLevel[]): string[] {
    let wasMacro = true;
    // handle the required \n before a macro
    return tl.map((x) => {
      const isMacro = x.kind === "TLDirective";
      const needEndLine = isMacro && !wasMacro;
      wasMacro = isMacro;
      if (needEndLine) return `\n${this.nl(0) + this.topLevelToS(x)}`;
      return this.nl(0) + this.topLevelToS(x);
    });
  }

  printIndented(tl: TopLevel[]): string { return this.printIndentedList(tl).join(""); }

  writeSymbols(shader: Shader): Uint8Array {
    const tlStrings = this.printIndentedList(shader.code).map(stripIndentation);
    const minifiedShader = tlStrings.join("");
    const symbolMap = new SymbolMap();
    shader.code.forEach((tl, i) => {
      let symbolName: string;
      switch (tl.kind) {
        case "Function": symbolName = tl.funcType.fName.oldName; break;
        case "TLDecl": symbolName = tl.decl[1].map((d) => d.name.oldName).join(","); break;
        case "TypeDecl": symbolName = tl.block.name !== null ? tl.block.name.oldName : "*type decl*"; break; // struct or unnamed interface block
        case "Precision": symbolName = "*precision*"; break;
        case "TLDirective": symbolName = tl.parts[0] === "#define" ? "#define" : "*directive*"; break;
        case "TLVerbatim": symbolName = "*verbatim*"; break; // //[ skipped //]
      }
      symbolMap.addMapping(tlStrings[i], symbolName);
    });
    return symbolMap.symFileBytes(Ast.shaderMangledFilename(shader), minifiedShader);
  }
}

export const printIndented = (tl: TopLevel[]): string => new PrinterImpl(false).printIndented(tl); // Indentation is encoded using \0 and \t
export const print = (tl: TopLevel[]): string => stripIndentation(printIndented(tl));
export const symbolsFile = (shader: Shader): Uint8Array => new PrinterImpl(false).writeSymbols(shader);
export const exprToS = (x: Expr): string => stripIndentation(new PrinterImpl(false).exprToS(0, x));
export const typeToS = (ty: Type): string => stripIndentation(new PrinterImpl(false).typeToS(0, ty));
export const printWithLoc = (tl: TopLevel[]): string => new PrinterImpl(true).printIndented(tl);

export function debugDecl(t: DeclElt): string {
  const sizes = t.sizes.map((s) => `[${exprToS(s)}]`).join("");
  const init = t.init === null ? "" : ` = ${exprToS(t.init)}`;
  return `${t.name.oldName}${sizes}${init}`;
}

export function debugIdent(ident: Ident): string {
  return ident.declaration.kind === "Variable" ? debugDecl(ident.declaration.decl.decl) : ident.oldName;
}

export const debugFunc = (funcType: FunctionType): string => new PrinterImpl(false).funToS(0, funcType);
