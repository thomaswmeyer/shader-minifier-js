// Port of Minifier/formatter.fs
import * as fs from "node:fs";
import * as Ast from "./ast.js";
import type { ExportedName, Shader } from "./ast.js";
import { version, type Options } from "./options.js";
import * as Printer from "./printer.js";

const NL = "\n";

/** Sort like F# Seq.sort on the ExportedName record: prefix (union order), name, newName; ordinal compares. */
function sortExports(names: readonly ExportedName[]): ExportedName[] {
  const prefixOrder = (p: Ast.ExportPrefix) => (p === "Variable" ? 0 : 1);
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...names].sort((a, b) => prefixOrder(a.prefix) - prefixOrder(b.prefix) || cmp(a.name, b.name) || cmp(a.newName, b.newName));
}

class Impl {
  constructor(private readonly options: Options, private readonly withLocations: boolean) {}

  private minify(shader: Shader): string {
    if (this.options.exportKkpSymbolMaps) {
      if (this.options.outputFormat === "indented") throw new Error("exporting symbols is not compatible with indented mode");
      fs.writeFileSync(shader.filename + ".sym", Printer.symbolsFile(shader));
    }
    switch (this.options.outputFormat) {
      case "text": case "js": case "json":
        return this.withLocations ? Printer.stripIndentation(Printer.printWithLoc(shader.code)) : Printer.print(shader.code);
      default:
        return this.withLocations ? Printer.printWithLoc(shader.code) : Printer.printIndented(shader.code);
    }
  }

  private formatPrefix(p: Ast.ExportPrefix): string { return p === "Variable" ? "var" : "F"; }

  private getLines(shader: Shader): [string, string][] {
    const lines = this.minify(shader);
    return lines.replace(/^\0+|\0+$/g, "").split("\0").map((line) => {
      // count the number of \t at the beginning of the string
      let indentLevel = 0;
      while (indentLevel < line.length && line[indentLevel] === "\t") indentLevel++;
      return [" ".repeat(2 * indentLevel), line.slice(indentLevel)];
    });
  }

  private escape(str: string): string { return str.replace(/"/g, '\\"').replace(/\n/g, "\\n"); }

  private banner(comment: string): string {
    return `${comment} Generated with Shader Minifier ${version} (https://github.com/laurentlb/Shader_Minifier/)${NL}`;
  }

  private printCVariables(shaders: Shader[], exportedNames: ExportedName[]): string {
    const fileName = this.options.outputName === "" || this.options.outputName === "-" ? "shader_code.h" : Ast.basename(this.options.outputName);
    const macroName = Ast.mangleToAscii(Ast.basename(fileName)).toUpperCase() + "_";
    let out = this.banner("//");
    out += `#ifndef ${macroName}${NL}`;
    out += `# define ${macroName}${NL}`;
    for (const value of sortExports(exportedNames)) {
      out += `# define ${this.formatPrefix(value.prefix).toUpperCase()}_${value.name} "${value.newName}"${NL}`;
    }
    out += NL;
    for (const shader of shaders) {
      out += `const char *${Ast.mangleToAscii(Ast.shaderMangledFilename(shader))} =${NL}`;
      const lines = this.getLines(shader).map(([indent, line]) => ` ${indent}"${this.escape(line)}"`).join(NL);
      out += `${lines};${NL}`;
      out += NL;
    }
    out += `#endif // ${macroName}${NL}`;
    return out;
  }

  private printCArray(shaders: Shader[], exportedNames: ExportedName[]): string {
    let out = this.banner("//");
    out += `#ifndef SHADER_MINIFIER_IMPL${NL}`;
    out += `#ifndef SHADER_MINIFIER_HEADER${NL}`;
    out += `# define SHADER_MINIFIER_HEADER${NL}`;
    for (const value of sortExports(exportedNames)) {
      out += `# define ${this.formatPrefix(value.prefix).toUpperCase()}_${value.name} "${value.newName}"${NL}`;
    }
    out += `#endif${NL}`;
    out += NL;
    out += `#else // if SHADER_MINIFIER_IMPL${NL}`;
    out += NL;
    for (const shader of shaders) {
      out += `// ${shader.filename}${NL}`;
      const lines = this.getLines(shader).map(([indent, line]) => ` ${indent}"${this.escape(line)}"`).join(NL);
      out += `${lines},${NL}`;
      out += NL;
    }
    out += `#endif${NL}`;
    return out;
  }

  private printNoHeader(shaders: Shader[]): string {
    return shaders.map((s) => this.minify(s)).join("\n");
  }

  private printIndented(shaders: Shader[]): string {
    let out = "";
    for (const shader of shaders) {
      if (shaders.length > 1) out += "// " + shader.filename + NL;
      for (const [indent, line] of this.getLines(shader)) out += indent + line + NL;
      out += NL;
    }
    return out;
  }

  private printJSHeader(shaders: Shader[], exportedNames: ExportedName[]): string {
    let out = this.banner("//");
    for (const value of sortExports(exportedNames)) {
      out += `var ${this.formatPrefix(value.prefix)}_${value.name.toUpperCase()} = "${value.newName}"${NL}`;
    }
    out += NL;
    for (const shader of shaders) {
      out += `var ${Ast.shaderMangledFilename(shader)} = \`${this.minify(shader)}\`${NL}`;
      out += NL;
    }
    return out;
  }

  private printNasmHeader(shaders: Shader[], exportedNames: ExportedName[]): string {
    const escape = (str: string) => str.replace(/"/g, '\\"').replace(/\n/g, "', 10, '");
    let out = this.banner(";");
    for (const value of sortExports(exportedNames)) {
      out += `_${this.formatPrefix(value.prefix)}_${value.name.toUpperCase()}: db '${value.newName}', 0${NL}`;
    }
    out += NL;
    for (const shader of shaders) {
      out += `_${Ast.mangleToAscii(Ast.shaderMangledFilename(shader))}:${NL}`;
      const lines = this.getLines(shader).map(([indent, line]) => `\tdb ${indent}'${escape(line)}'`).join(NL);
      out += `${lines}, 0${NL}`;
      out += NL;
    }
    return out;
  }

  private printRustHeader(shaders: Shader[], exportedNames: ExportedName[]): string {
    let out = this.banner("//");
    for (const value of sortExports(exportedNames)) {
      out += `pub const ${this.formatPrefix(value.prefix).toUpperCase()}_${value.name.toUpperCase()}: &'static [u8] = b"${value.newName}\\0";${NL}`;
    }
    for (const shader of shaders) {
      out += NL;
      out += `pub const ${Ast.shaderMangledFilename(shader).toUpperCase()}: &'static [u8] = b"\\${NL}`;
      const lines = this.getLines(shader).map(([indent, line]) => ` ${indent}${this.escape(line)}\\`).join(NL);
      out += `${lines}0";${NL}`;
    }
    return out;
  }

  private printJsonHeader(shaders: Shader[], exportedNames: ExportedName[]): string {
    const printMap = (map: Map<string, string>): string => {
      const keys = [...map.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)); // F# Map is sorted by key
      return `{${keys.map((k) => `"${this.escape(k)}":"${this.escape(map.get(k)!)}"`).join(",")}}`;
    };
    const namesMap = printMap(new Map(exportedNames.map((v) => [v.name, v.newName])));
    const shadersMap = printMap(new Map(shaders.map((s) => [s.filename, this.minify(s)])));
    return `{"mappings":${namesMap},"shaders":${shadersMap}}${NL}`;
  }

  format(shaders: Shader[], exportedNames: ExportedName[]): string {
    switch (this.options.outputFormat) {
      case "indented": return this.printIndented(shaders);
      case "text": return this.printNoHeader(shaders);
      case "c-variables": return this.printCVariables(shaders, exportedNames);
      case "c-array": return this.printCArray(shaders, exportedNames);
      case "js": return this.printJSHeader(shaders, exportedNames);
      case "nasm": return this.printNasmHeader(shaders, exportedNames);
      case "rust": return this.printRustHeader(shaders, exportedNames);
      case "json": return this.printJsonHeader(shaders, exportedNames);
    }
  }
}

export const print = (options: Options, shaders: Shader[], exportedNames: ExportedName[]): string =>
  new Impl(options, false).format(shaders, exportedNames);
export const printWithLocations = (options: Options, shaders: Shader[], exportedNames: ExportedName[]): string =>
  new Impl(options, true).format(shaders, exportedNames);
