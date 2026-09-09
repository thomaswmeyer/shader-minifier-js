// Port of Minifier/options.fs (Argu replaced by a hand-written arg parser)
import { isFieldSwizzle, swizzleIndex } from "./builtin.js";

export const version = "1.5.1"; // Shader Minifier version this port tracks

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

export type OutputFormat = "text" | "indented" | "c-variables" | "c-array" | "js" | "nasm" | "rust" | "json";
const outputFormats: readonly OutputFormat[] = ["text", "indented", "c-variables", "c-array", "js", "nasm", "rust", "json"];

export type FieldSet = "rgba" | "xyzw" | "stpq";

export interface Options {
  version: boolean;
  outputName: string;
  outputFormat: OutputFormat;
  verbose: boolean;
  debug: boolean;
  canonicalFieldNames: string;
  preserveExternals: boolean;
  preserveAllGlobals: boolean;
  hlsl: boolean;
  noInlining: boolean;
  noOverloading: boolean;
  aggroInlining: boolean;
  noSequence: boolean;
  noRenaming: boolean;
  noRenamingList: string[];
  noRemoveUnused: boolean;
  moveDeclarations: boolean;
  preprocess: boolean;
  exportKkpSymbolMaps: boolean;
  /** Port addition: disable replacing pi-like literals with acos(-1.) etc. */
  noPiSubstitution: boolean;
  /** Port addition: only emit constructs WebGL accepts (no ?: on structs; no void calls in comma sequences). */
  webgl: boolean;
  /** Port addition: expand #define macros before parsing instead of keeping them verbatim. */
  expandMacros: boolean;
}

export const helpTextMessage = `Shader Minifier ${version} - https://github.com/laurentlb/Shader_Minifier`;

export function defaultOptions(): Options {
  return {
    version: false,
    outputName: "shader_code.h",
    outputFormat: "c-variables",
    verbose: false,
    debug: false,
    canonicalFieldNames: "xyzw",
    preserveExternals: false,
    preserveAllGlobals: false,
    hlsl: false,
    noInlining: false,
    noOverloading: false,
    aggroInlining: false,
    noSequence: false,
    noRenaming: false,
    noRenamingList: ["main", "mainImage"],
    noRemoveUnused: false,
    moveDeclarations: false,
    preprocess: false,
    exportKkpSymbolMaps: false,
    noPiSubstitution: false,
    webgl: false,
    expandMacros: false,
  };
}

export function renameField(options: Options, field: string): string {
  if (isFieldSwizzle(field)) {
    return [...field].map((c) => options.canonicalFieldNames[swizzleIndex(c)]).join("");
  }
  return field;
}

export function trace(options: Options, str: string): void {
  if (options.debug) console.log(str);
}

const usage: [string, string][] = [
  ["-o <name>", "Set the output filename (default is shader_code.h)"],
  ["-v", "Verbose, display additional information"],
  ["--debug", "Debug, display more additional information"],
  ["--hlsl", "Use HLSL (default is GLSL)"],
  ["--format <fmt>", "Choose to format the output (use 'text' if you want just the shader): text, indented, c-variables, c-array, js, nasm, rust, json"],
  ["--field-names <set>", "Choose the field names for vectors: 'rgba', 'xyzw', or 'stpq'"],
  ["--preserve-externals", "Do not rename external values (e.g. uniform)"],
  ["--preserve-all-globals", "Do not rename functions and global variables"],
  ["--no-inlining", "Do not automatically inline variables and functions"],
  ["--aggressive-inlining", "Aggressively inline constants. This can reduce output size due to better constant folding. It can also increase output size due to repeated inlined constants, but this increased redundancy can be beneficial to compression, leading to a smaller final compressed size anyway. Does nothing if inlining is disabled."],
  ["--no-renaming", "Do not rename anything"],
  ["--no-renaming-list <list>", "Comma-separated list of functions to preserve"],
  ["--no-sequence", "Do not use the comma operator trick"],
  ["--no-remove-unused", "Do not remove unused code"],
  ["--no-overloading", "When renaming functions, do not introduce new overloads"],
  ["--move-declarations", "Move declarations to group them"],
  ["--preprocess", "Evaluate some of the file preprocessor directives"],
  ["--export-kkp-symbol-maps", "Export kkpView symbol maps"],
  ["--no-pi-substitution", "Do not replace pi-like literals with acos(-1.) (port addition)"],
  ["--webgl", "Skip rewrites WebGL rejects: ?: on structs, void calls in comma sequences (port addition)"],
  ["--expand-macros", "Expand #define macros instead of keeping them (port addition)"],
  ["--version", "Display the version and exit"],
  ["<filenames>...", "List of files to minify"],
];

export function flagsHelp(message: string = helpTextMessage): string {
  const lines = [message, "", "USAGE: shader-minifier [options] <filenames>...", "", "OPTIONS:", ""];
  const width = Math.max(...usage.map(([f]) => f.length)) + 2;
  for (const [flag, desc] of usage) lines.push(`    ${flag.padEnd(width)}${desc}`);
  return lines.join("\n") + "\n";
}

export class ArgumentError extends Error {}

function parseArgs(argv: readonly string[]): { options: Options; filenames: string[] } {
  const options = defaultOptions();
  const filenames: string[] = [];
  let aggro = false;
  let noInlining = false;
  const next = (flag: string, i: number): string => {
    if (i + 1 >= argv.length) throw new ArgumentError(`Missing argument for ${flag}\n${flagsHelp()}`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--version": options.version = true; break;
      case "-o": options.outputName = next(arg, i++); break;
      case "-v": options.verbose = true; break;
      case "--debug": options.debug = true; break;
      case "--hlsl": options.hlsl = true; break;
      case "--format": {
        const f = next(arg, i++);
        if (!outputFormats.includes(f as OutputFormat)) throw new ArgumentError(`Unrecognized output format '${f}'\n${flagsHelp()}`);
        options.outputFormat = f as OutputFormat;
        break;
      }
      case "--field-names": {
        const f = next(arg, i++).toLowerCase();
        if (!["rgba", "xyzw", "stpq"].includes(f)) throw new ArgumentError(`Unrecognized field names '${f}'\n${flagsHelp()}`);
        options.canonicalFieldNames = f;
        break;
      }
      case "--preserve-externals": options.preserveExternals = true; break;
      case "--preserve-all-globals": options.preserveAllGlobals = true; options.preserveExternals = true; break;
      case "--no-inlining": noInlining = true; break;
      case "--aggressive-inlining": aggro = true; break;
      case "--no-renaming": options.noRenaming = true; break;
      case "--no-renaming-list":
        options.noRenamingList = next(arg, i++).split(",").map((s) => s.trim());
        break;
      case "--no-sequence": options.noSequence = true; break;
      case "--no-remove-unused": options.noRemoveUnused = true; break;
      case "--no-overloading": options.noOverloading = true; break;
      case "--move-declarations": options.moveDeclarations = true; break;
      case "--preprocess": options.preprocess = true; break;
      case "--export-kkp-symbol-maps": options.exportKkpSymbolMaps = true; break;
      case "--no-pi-substitution": options.noPiSubstitution = true; break;
      case "--webgl": options.webgl = true; break;
      case "--expand-macros": options.expandMacros = true; break;
      case "--help": case "-h": throw new ArgumentError(flagsHelp());
      default:
        if (arg.startsWith("-") && arg !== "-") throw new ArgumentError(`Unrecognized argument: '${arg}'\n${flagsHelp()}`);
        filenames.push(arg);
    }
  }
  options.noInlining = noInlining;
  options.aggroInlining = aggro && !noInlining;
  return { options, filenames };
}

/** Parse flags only; fails if any filename is given. */
export function init(argv: readonly string[]): Options {
  const { options, filenames } = parseArgs(argv);
  if (filenames.length > 0) throw new ArgumentError(`Unexpected arguments: ${filenames.join(" ")}`);
  return options;
}

/** Parse flags and filenames. */
export function initFiles(argv: readonly string[]): { options: Options; filenames: string[] } {
  const { options, filenames } = parseArgs(argv);
  if (!options.version && filenames.length === 0) {
    throw new ArgumentError(flagsHelp("Missing parameter: the list of shaders to minify"));
  }
  return { options, filenames };
}
