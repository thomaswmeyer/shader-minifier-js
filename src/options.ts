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

export type Stage = "vertex" | "fragment";

/** The stage a file name implies: `.vert`/`.vs` or `.frag`/`.fs`; null for anything else. */
export function stageOfFilename(filename: string): Stage | null {
  if (/\.(vert|vs)$/i.test(filename)) return "vertex";
  if (/\.(frag|fs)$/i.test(filename)) return "fragment";
  return null;
}

export interface Options {
  version: boolean;
  outputName: string;
  outputFormat: OutputFormat;
  verbose: boolean;
  debug: boolean;
  canonicalFieldNames: string;
  preserveExternals: boolean;
  preserveAllGlobals: boolean;
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
  // Not in upstream Shader Minifier:
  /** Keep pi-like literals instead of replacing them with acos(-1.) etc. */
  noPiSubstitution: boolean;
  /** Only emit constructs WebGL accepts (no ?: on structs; no void calls in comma sequences). */
  webgl: boolean;
  /** Expand #define macros before parsing instead of keeping them verbatim. */
  expandMacros: boolean;
  /** Fold builtin calls on literals, and constant divisions, at float32 precision, only when shorter: the folds the spec lets the hardware get a few ulp wrong on. */
  approximateFolds: boolean;
  /** Fold float operators with upstream's decimal arithmetic instead of at float32 precision. */
  decimalFolds: boolean;
  /** Drop precision statements that restate the stage's default (vertex: highp float/int; fragment: mediump int; samplers: lowp). */
  dropDefaultPrecision: boolean;
  /** The shader stage, for dropDefaultPrecision. null: from the file extension, else from the code, else unknown (samplers only). */
  stage: Stage | null;
  /** Inline a never-written global used once, and substitute an always-identical global argument into a function body when that is not longer. */
  inlineSingleUse: boolean;
  /** Remove unreferenced non-external globals, unreferenced struct types and precision statements for sampler types the shader never declares. */
  removeUnusedDeclarations: boolean;
  /** Remove a varying no fragment shader of the run reads, and a fragment input nothing reads. Needs both stages in one run. */
  removeUnusedVaryings: boolean;
  /** Remove a plain uniform no shader of the run reads. Needs both stages in one run; the application must tolerate a null location. */
  removeUnusedUniforms: boolean;
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
    approximateFolds: false,
    decimalFolds: false,
    dropDefaultPrecision: false,
    stage: null,
    inlineSingleUse: false,
    removeUnusedDeclarations: false,
    removeUnusedVaryings: false,
    removeUnusedUniforms: false,
  };
}

// Optimisation levels: one flag for a coherent group of the port's additions, applied where it
// stands among the other flags, so a flag after it wins (`-O2 --no-approximate-folds`) and a level
// after a flag resets the group (`--approximate-folds -O0`). The target flags (--webgl,
// --preserve-externals, --no-overloading, --stage, --preprocess) and upstream's own switches are
// not part of a level.
//   -O0  upstream's rewrites only, byte for byte: what the goldens pin.
//   -O1  the additions that change neither meaning nor interface: float32 folds of + - *, no pi
//        substitution, default precision statements dropped, single-use globals inlined, unused
//        declarations removed (externals stay).
//   -O2  what the Vite plugin does: -O1 plus macro expansion and folding of builtin calls and
//        divisions, which the spec allows the hardware a few ulp on.
//   -O3  the removals the application must be ready for: -O2 plus unused varyings and uniforms,
//        which need both stages in the run and a null uniform location to be tolerated.
export type OptimizationLevel = 0 | 1 | 2 | 3;
const level0: Partial<Options> = {
  decimalFolds: true, noPiSubstitution: false, dropDefaultPrecision: false, inlineSingleUse: false, removeUnusedDeclarations: false,
  expandMacros: false, approximateFolds: false, removeUnusedVaryings: false, removeUnusedUniforms: false,
};
const level1: Partial<Options> = { ...level0, decimalFolds: false, noPiSubstitution: true, dropDefaultPrecision: true, inlineSingleUse: true, removeUnusedDeclarations: true };
const level2: Partial<Options> = { ...level1, expandMacros: true, approximateFolds: true };
const level3: Partial<Options> = { ...level2, removeUnusedVaryings: true, removeUnusedUniforms: true };
export const optimizationLevels: Record<OptimizationLevel, Partial<Options>> = { 0: level0, 1: level1, 2: level2, 3: level3 };

/** `--no-<flag>` for each flag a level turns on, so a level can be taken minus one thing. */
const negations: Record<string, [keyof Options, boolean]> = {
  "--pi-substitution": ["noPiSubstitution", false],
  "--no-decimal-folds": ["decimalFolds", false],
  "--no-expand-macros": ["expandMacros", false],
  "--no-approximate-folds": ["approximateFolds", false],
  "--no-drop-default-precision": ["dropDefaultPrecision", false],
  "--no-inline-single-use": ["inlineSingleUse", false],
  "--no-remove-unused-declarations": ["removeUnusedDeclarations", false],
  "--no-remove-unused-varyings": ["removeUnusedVaryings", false],
  "--no-remove-unused-uniforms": ["removeUnusedUniforms", false],
};

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
  ["-O0 | -O1 | -O2 | -O3", "Optimisation level: -O0 upstream's rewrites only; -O1 the port's additions that change neither meaning nor interface; -O2 the Vite plugin's rewrites; -O3 also remove unused varyings and uniforms. Flags after the level override it (port addition)"],
  ["--no-<flag>", "Turn off a flag a level turned on: --no-expand-macros, --no-approximate-folds, --no-drop-default-precision, --no-inline-single-use, --no-remove-unused-declarations, --no-remove-unused-varyings, --no-remove-unused-uniforms, --no-decimal-folds, --pi-substitution (port addition)"],
  ["--no-pi-substitution", "Do not replace pi-like literals with acos(-1.) (port addition)"],
  ["--webgl", "Skip rewrites WebGL rejects: ?: on structs, void calls in comma sequences (port addition)"],
  ["--expand-macros", "Expand #define macros instead of keeping them (port addition)"],
  ["--approximate-folds", "Fold builtin calls on literals, and constant divisions, at float32 precision when shorter: the spec allows the hardware a few ulp on these, so the fold may differ from a GPU by as much (port addition)"],
  ["--decimal-folds", "Fold + - * on literals with decimal arithmetic as upstream does, instead of at float32 precision (port addition)"],
  ["--drop-default-precision", "Drop precision statements that restate the stage's default, e.g. highp float in a vertex shader (port addition)"],
  ["--stage <stage>", "The shader stage for --drop-default-precision: 'vertex' or 'fragment'. Default: from the file extension, else from the code (port addition)"],
  ["--inline-single-use", "Inline a never-written global used once, and substitute a global passed as an always-identical argument when that is not longer (port addition)"],
  ["--remove-unused-declarations", "Remove unused globals (uniforms and other externals stay), unused struct types and precision statements for sampler types never declared (port addition)"],
  ["--remove-unused-varyings", "Remove a varying no fragment shader of the run reads, and a fragment input nothing reads; needs the vertex and fragment shader in one run (port addition)"],
  ["--remove-unused-uniforms", "Remove a plain uniform no shader of the run reads; needs the vertex and fragment shader in one run, and the application must tolerate a null location (port addition)"],
  ["--version", "Display the version and exit"],
  ["<filenames>...", "List of files to minify"],
];

export function flagsHelp(message: string = helpTextMessage): string {
  const lines = [message, "", "USAGE: shader-minifier [options] <filenames>...", "", "OPTIONS:", ""];
  const width = Math.max(...usage.map(([f]) => f.length)) + 2;
  for (const [flag, desc] of usage) lines.push(`    ${flag.padEnd(width)}${desc}`);
  lines.push("", `A shader may set its own rewrite flags on a line \`#pragma ${PRAGMA} <flags>\`, applied after the`, "command line's and removed from the output. Output, renaming and cross-file flags are the run's.");
  return lines.join("\n") + "\n";
}

// ---- a shader's own flags --------------------------------------------------

export const PRAGMA = "shader_minifier";

/** What a shader's pragma may set: its own rewrites. Not the output, the renaming, or what needs the whole run. */
const pragmaFields: ReadonlySet<keyof Options> = new Set<keyof Options>([
  "noInlining", "aggroInlining", "noSequence", "noRemoveUnused", "moveDeclarations", "preprocess", "webgl", "stage",
  "noPiSubstitution", "expandMacros", "approximateFolds", "decimalFolds", "dropDefaultPrecision", "inlineSingleUse", "removeUnusedDeclarations",
]);
/** Decided for the run, since they need every stage of it: a pragma's setting of them is ignored, so `-O3` in a pragma means `-O2`. */
const runFields: readonly (keyof Options)[] = ["removeUnusedVaryings", "removeUnusedUniforms"];

/** The `#pragma shader_minifier` lines of a shader, as flags, and the source with each replaced by an empty line so line numbers hold. */
export function extractPragmas(source: string): { source: string; flags: string[] } {
  const flags: string[] = [];
  const re = new RegExp(`^\\s*#\\s*pragma\\s+${PRAGMA}\\b(.*)$`);
  const lines = source.split("\n").map((line) => {
    const m = re.exec(line);
    if (m === null) return line;
    flags.push(...m[1].trim().split(/\s+/).filter((f) => f !== ""));
    return "";
  });
  return { source: lines.join("\n"), flags };
}

/** The run's options with a shader's pragma flags applied on top. */
export function applyPragma(options: Options, flags: readonly string[], filename: string): Options {
  if (flags.length === 0) return options;
  const where = `${filename}: #pragma ${PRAGMA}`;
  let out: Options, filenames: string[];
  try { ({ options: out, filenames } = parseArgs(flags, { ...options, noRenamingList: [...options.noRenamingList] })); }
  catch (e) { throw new ArgumentError(`${where}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`); }
  if (filenames.length > 0) throw new ArgumentError(`${where} takes flags only, not '${filenames[0]}'`);
  for (const k of Object.keys(out) as (keyof Options)[]) {
    if (pragmaFields.has(k)) continue;
    if (runFields.includes(k)) { (out as unknown as Record<string, unknown>)[k] = options[k]; continue; }
    if (JSON.stringify(out[k]) !== JSON.stringify(options[k])) throw new ArgumentError(`${where} may only set rewrite flags; '${k}' is decided by the command line`);
  }
  return out;
}

export class ArgumentError extends Error {}

function parseArgs(argv: readonly string[], options: Options = defaultOptions()): { options: Options; filenames: string[] } {
  const filenames: string[] = [];
  let aggro = options.aggroInlining;
  let noInlining = options.noInlining;
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
      case "--approximate-folds": options.approximateFolds = true; break;
      case "--decimal-folds": options.decimalFolds = true; break;
      case "--drop-default-precision": options.dropDefaultPrecision = true; break;
      case "--stage": {
        const s = next(arg, i++).toLowerCase();
        if (s !== "vertex" && s !== "fragment") throw new ArgumentError(`Unrecognized stage '${s}': expected 'vertex' or 'fragment'\n${flagsHelp()}`);
        options.stage = s;
        break;
      }
      case "--inline-single-use": options.inlineSingleUse = true; break;
      case "--remove-unused-declarations": options.removeUnusedDeclarations = true; break;
      case "--remove-unused-varyings": options.removeUnusedVaryings = true; break;
      case "--remove-unused-uniforms": options.removeUnusedUniforms = true; break;
      case "--help": case "-h": throw new ArgumentError(flagsHelp());
      case "-O0": case "-O1": case "-O2": case "-O3": Object.assign(options, optimizationLevels[Number(arg[2]) as OptimizationLevel]); break;
      default:
        if (arg in negations) { const [field, value] = negations[arg]; (options as unknown as Record<string, boolean>)[field] = value; break; }
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
