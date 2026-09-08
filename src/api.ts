// Port of Minifier/api.fs
import type { ExportedName, Shader } from "./ast.js";
import * as Formatter from "./formatter.js";
import type { Options } from "./options.js";
import * as Options_ from "./options.js";
import { runParser } from "./parser.js";
import * as Printer from "./printer.js";
import { rename } from "./renamer.js";
import { reorderFunctions, simplify } from "./rewriter.js";

export type InputFile = [name: string, content: string];

export class Minifier {
  readonly shaders: Shader[];
  readonly exportedNames: ExportedName[];

  constructor(readonly options: Options, files: readonly InputFile[]) {
    const vprint = (s: string) => { if (options.verbose) process.stdout.write(s); };
    const printSize = (shaders: Shader[]) => { if (options.verbose) vprint(`Shader size is: ${getSize(shaders)}\n`); };

    const names = files.map(([n, c]) => `'${n}' (${c.length}b)`).join(",");
    Options_.trace(options, `----- minifying ${names}`);
    vprint(`Input file size is: ${files.reduce((acc, [, s]) => acc + s.length, 0)}\n`);

    const parseAndRewrite = ([filename, content]: InputFile): Shader => {
      const shader = runParser(options, filename, content);
      const code = shader.reorderFunctions ? reorderFunctions(options, shader.code) : shader.code;
      return { ...shader, code: simplify(options, code) };
    };

    this.shaders = files.map(parseAndRewrite);
    vprint("Rewrite tricks applied. "); printSize(this.shaders);

    if (options.noRenaming) {
      this.exportedNames = [];
    } else {
      this.exportedNames = rename(options, this.shaders);
      vprint("Identifiers renamed. "); printSize(this.shaders);
    }
  }

  static parseOptions(flags: readonly string[]): Options { return Options_.init(flags); }
  static parseOptionsWithFiles(flags: readonly string[]): { options: Options; filenames: string[] } { return Options_.initFiles(flags); }

  get size(): number { return getSize(this.shaders); }

  format(options: Options = this.options): string { return Formatter.print(options, this.shaders, this.exportedNames); }
  formatWithLocations(): string { return Formatter.printWithLocations(this.options, this.shaders, this.exportedNames); }
}

export const getSize = (shaders: readonly Shader[]): number =>
  shaders.reduce((acc, s) => acc + Printer.print(s.code).length, 0);
