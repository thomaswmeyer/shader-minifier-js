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

/** How much to inline: nothing, upstream's default, or upstream's aggressive mode (constants repeated at every use, even with side effects). */
export type Inlining = "none" | "default" | "aggressive";
const inlinings: readonly Inlining[] = ["none", "default", "aggressive"];
/** What to remove when unused: nothing, upstream's unused functions and locals, or also globals, struct types and sampler precision statements (externals stay). */
export type RemoveUnused = "none" | "functions" | "declarations";
const removeUnuseds: readonly RemoveUnused[] = ["none", "functions", "declarations"];

export interface Options {
  version: boolean;
  outputName: string;
  outputFormat: OutputFormat;
  verbose: boolean;
  debug: boolean;
  canonicalFieldNames: string;
  preserveExternals: boolean;
  preserveAllGlobals: boolean;
  /** Upstream's `--no-inlining` and `--aggressive-inlining`, as one setting. */
  inlining: Inlining;
  noOverloading: boolean;
  noSequence: boolean;
  noRenaming: boolean;
  noRenamingList: string[];
  /** Upstream's `--no-remove-unused` and the port's `--remove-unused-declarations`, as one setting. */
  removeUnused: RemoveUnused;
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
  /** Treat float literals as decimals, as upstream does: fold `+ - *` with decimal arithmetic and keep each literal's digits, instead of float32 arithmetic and the fewest digits that read back to the same float32. */
  decimalFolds: boolean;
  /** Drop precision statements that restate the stage's default (vertex: highp float/int; fragment: mediump int; samplers: lowp). */
  dropDefaultPrecision: boolean;
  /** The shader stage, for dropDefaultPrecision. null: from the file extension, else from the code, else unknown (samplers only). */
  stage: Stage | null;
  /** Inline a never-written global used once, and substitute an always-identical global argument into a function body when that is not longer. */
  inlineSingleUse: boolean;
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
    inlining: "default",
    noOverloading: false,
    noSequence: false,
    noRenaming: false,
    noRenamingList: ["main", "mainImage"],
    removeUnused: "functions",
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
//   -O1  the additions that change neither meaning nor interface: literals as the float32 the GPU
//        sees (folds of + - * and the fewest digits), no pi substitution, default precision
//        statements dropped, single-use globals inlined, unused declarations removed (externals
//        stay).
//   -O2  what the Vite plugin does: -O1 plus macro expansion and folding of builtin calls and
//        divisions, which the spec allows the hardware a few ulp on.
//   -O3  the removals the application must be ready for: -O2 plus unused varyings and uniforms,
//        which need both stages in the run and a null uniform location to be tolerated.
export type OptimizationLevel = 0 | 1 | 2 | 3;
const level0: Partial<Options> = {
  decimalFolds: true, noPiSubstitution: false, dropDefaultPrecision: false, inlineSingleUse: false, removeUnused: "functions",
  expandMacros: false, approximateFolds: false, removeUnusedVaryings: false, removeUnusedUniforms: false,
};
const level1: Partial<Options> = { ...level0, decimalFolds: false, noPiSubstitution: true, dropDefaultPrecision: true, inlineSingleUse: true, removeUnused: "declarations" };
const level2: Partial<Options> = { ...level1, expandMacros: true, approximateFolds: true };
const level3: Partial<Options> = { ...level2, removeUnusedVaryings: true, removeUnusedUniforms: true };
export const optimizationLevels: Record<OptimizationLevel, Partial<Options>> = { 0: level0, 1: level1, 2: level2, 3: level3 };

export function renameField(options: Options, field: string): string {
  if (isFieldSwizzle(field)) {
    return [...field].map((c) => options.canonicalFieldNames[swizzleIndex(c)]).join("");
  }
  return field;
}

export function trace(options: Options, str: string): void {
  if (options.debug) console.log(str);
}

export class ArgumentError extends Error {}

// ---- the flags ------------------------------------------------------------
//
// One table drives the help text, the parser, the `--no-` forms and the pragma. A row either sets
// fields (`set`), or takes a value (`arg` names it in the help, `parse` reads it). `off` is the
// flag that undoes it, for what a level may have turned on. Rows without `upstream` are the port's
// and say so in the help; `pragma` marks the rows a shader may set for itself.
interface Flag {
  flag: string;
  help: string;
  arg?: string;
  set?: Partial<Options>;
  parse?: (value: string, options: Options) => void;
  off?: { flag: string; set: Partial<Options> };
  upstream?: boolean;
  pragma?: boolean;
}

const choice = <T extends string>(what: string, choices: readonly T[], value: string): T => {
  if (!choices.includes(value as T)) throw new ArgumentError(`Unrecognized ${what} '${value}': expected ${choices.map((c) => `'${c}'`).join(", ")}\n${flagsHelp()}`);
  return value as T;
};

const flags: Flag[] = [
  { flag: "-o", arg: "<name>", help: "Set the output filename (default is shader_code.h)", upstream: true, parse: (v, o) => { o.outputName = v; } },
  { flag: "-v", help: "Verbose, display additional information", upstream: true, set: { verbose: true } },
  { flag: "--debug", help: "Debug, display more additional information", upstream: true, set: { debug: true } },
  { flag: "--format", arg: "<fmt>", help: "Choose to format the output (use 'text' if you want just the shader): text, indented, c-variables, c-array, js, nasm, rust, json", upstream: true,
    parse: (v, o) => { o.outputFormat = choice("output format", outputFormats, v); } },
  { flag: "--field-names", arg: "<set>", help: "Choose the field names for vectors: 'rgba', 'xyzw', or 'stpq'", upstream: true,
    parse: (v, o) => { o.canonicalFieldNames = choice("field names", ["rgba", "xyzw", "stpq"] as const, v.toLowerCase()); } },
  { flag: "--preserve-externals", help: "Do not rename external values (e.g. uniform)", upstream: true, set: { preserveExternals: true } },
  { flag: "--preserve-all-globals", help: "Do not rename functions and global variables", upstream: true, set: { preserveAllGlobals: true, preserveExternals: true } },
  { flag: "--no-inlining", help: "Do not automatically inline variables and functions", upstream: true, pragma: true, set: { inlining: "none" } },
  { flag: "--aggressive-inlining", help: "Aggressively inline constants. This can reduce output size due to better constant folding. It can also increase output size due to repeated inlined constants, but this increased redundancy can be beneficial to compression, leading to a smaller final compressed size anyway. Does nothing if inlining is disabled.", upstream: true, pragma: true, set: { inlining: "aggressive" } },
  { flag: "--inlining", arg: "<level>", help: "The two flags above as one setting: 'none', 'default' or 'aggressive'", pragma: true,
    parse: (v, o) => { o.inlining = choice("inlining level", inlinings, v); } },
  { flag: "--no-renaming", help: "Do not rename anything", upstream: true, set: { noRenaming: true } },
  { flag: "--no-renaming-list", arg: "<list>", help: "Comma-separated list of functions to preserve", upstream: true, parse: (v, o) => { o.noRenamingList = v.split(",").map((s) => s.trim()); } },
  { flag: "--no-sequence", help: "Do not use the comma operator trick", upstream: true, pragma: true, set: { noSequence: true } },
  { flag: "--no-remove-unused", help: "Do not remove unused code", upstream: true, pragma: true, set: { removeUnused: "none" } },
  { flag: "--no-overloading", help: "When renaming functions, do not introduce new overloads", upstream: true, set: { noOverloading: true } },
  { flag: "--move-declarations", help: "Move declarations to group them", upstream: true, pragma: true, set: { moveDeclarations: true } },
  { flag: "--preprocess", help: "Evaluate some of the file preprocessor directives", upstream: true, pragma: true, set: { preprocess: true } },
  { flag: "--export-kkp-symbol-maps", help: "Export kkpView symbol maps", upstream: true, set: { exportKkpSymbolMaps: true } },
  { flag: "-O0 | -O1 | -O2 | -O3", help: "Optimisation level: -O0 upstream's rewrites only; -O1 the port's additions that change neither meaning nor interface; -O2 the Vite plugin's rewrites; -O3 also remove unused varyings and uniforms. Flags after the level override it", pragma: true },
  { flag: "--no-pi-substitution", help: "Do not replace pi-like literals with acos(-1.)", pragma: true, set: { noPiSubstitution: true }, off: { flag: "--pi-substitution", set: { noPiSubstitution: false } } },
  { flag: "--webgl", help: "Skip rewrites WebGL rejects: ?: on structs, void calls in comma sequences", pragma: true, set: { webgl: true }, off: { flag: "--no-webgl", set: { webgl: false } } },
  { flag: "--expand-macros", help: "Expand #define macros instead of keeping them", pragma: true, set: { expandMacros: true }, off: { flag: "--no-expand-macros", set: { expandMacros: false } } },
  { flag: "--approximate-folds", help: "Fold builtin calls on literals, and constant divisions, at float32 precision when shorter: the spec allows the hardware a few ulp on these, so the fold may differ from a GPU by as much", pragma: true, set: { approximateFolds: true }, off: { flag: "--no-approximate-folds", set: { approximateFolds: false } } },
  { flag: "--decimal-folds", help: "Treat float literals as decimals, as upstream does: fold + - * with decimal arithmetic and keep each literal's digits, instead of float32 arithmetic and the fewest digits that read back to the same float32", pragma: true, set: { decimalFolds: true }, off: { flag: "--no-decimal-folds", set: { decimalFolds: false } } },
  { flag: "--drop-default-precision", help: "Drop precision statements that restate the stage's default, e.g. highp float in a vertex shader", pragma: true, set: { dropDefaultPrecision: true }, off: { flag: "--no-drop-default-precision", set: { dropDefaultPrecision: false } } },
  { flag: "--stage", arg: "<stage>", help: "The shader stage for --drop-default-precision: 'vertex' or 'fragment'. Default: from the file extension, else from the code", pragma: true,
    parse: (v, o) => { o.stage = choice("stage", ["vertex", "fragment"] as const, v.toLowerCase()); } },
  { flag: "--inline-single-use", help: "Inline a never-written global used once, and substitute a global passed as an always-identical argument when that is not longer", pragma: true, set: { inlineSingleUse: true }, off: { flag: "--no-inline-single-use", set: { inlineSingleUse: false } } },
  { flag: "--remove-unused-declarations", help: "Also remove unused globals (uniforms and other externals stay), unused struct types and precision statements for sampler types never declared", pragma: true, set: { removeUnused: "declarations" }, off: { flag: "--no-remove-unused-declarations", set: { removeUnused: "functions" } } },
  { flag: "--remove-unused", arg: "<level>", help: "--no-remove-unused, upstream's default and --remove-unused-declarations as one setting: 'none', 'functions' or 'declarations'", pragma: true,
    parse: (v, o) => { o.removeUnused = choice("remove-unused level", removeUnuseds, v); } },
  { flag: "--remove-unused-varyings", help: "Remove a varying no fragment shader of the run reads, and a fragment input nothing reads; needs the vertex and fragment shader in one run", set: { removeUnusedVaryings: true }, off: { flag: "--no-remove-unused-varyings", set: { removeUnusedVaryings: false } } },
  { flag: "--remove-unused-uniforms", help: "Remove a plain uniform no shader of the run reads; needs the vertex and fragment shader in one run, and the application must tolerate a null location", set: { removeUnusedUniforms: true }, off: { flag: "--no-remove-unused-uniforms", set: { removeUnusedUniforms: false } } },
  { flag: "--version", help: "Display the version and exit", upstream: true, set: { version: true } },
];

const byFlag = new Map<string, { row: Flag; set?: Partial<Options> }>();
for (const row of flags) {
  if (row.set !== undefined || row.parse !== undefined) byFlag.set(row.flag, { row, set: row.set });
  if (row.off !== undefined) byFlag.set(row.off.flag, { row, set: row.off.set });
}

export function flagsHelp(message: string = helpTextMessage): string {
  const lines = [message, "", "USAGE: shader-minifier [options] <filenames>...", "", "OPTIONS:", ""];
  const rows: [string, string][] = flags.map((f) => [f.arg === undefined ? f.flag : `${f.flag} ${f.arg}`, f.help + (f.upstream ? "" : " (port addition)")]);
  rows.push(["<filenames>...", "List of files to minify"]);
  const width = Math.max(...rows.map(([f]) => f.length)) + 2;
  for (const [flag, desc] of rows) lines.push(`    ${flag.padEnd(width)}${desc}`);
  const offs = flags.flatMap((f) => (f.off === undefined ? [] : [f.off.flag]));
  lines.push("", `Each of these has a form that undoes it, for what a level turned on: ${offs.join(", ")}.`);
  lines.push("", `A shader may set its own rewrite flags on a line \`#pragma ${PRAGMA} <flags>\`, applied after the`, "command line's and removed from the output. Output, renaming and cross-file flags are the run's.");
  return lines.join("\n") + "\n";
}

function parseArgs(argv: readonly string[], options: Options = defaultOptions()): { options: Options; filenames: string[] } {
  const filenames: string[] = [];
  const next = (flag: string, i: number): string => {
    if (i + 1 >= argv.length) throw new ArgumentError(`Missing argument for ${flag}\n${flagsHelp()}`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") throw new ArgumentError(flagsHelp());
    if (/^-O[0-3]$/.test(arg)) { Object.assign(options, optimizationLevels[Number(arg[2]) as OptimizationLevel]); continue; }
    const found = byFlag.get(arg);
    if (found !== undefined) {
      if (found.set !== undefined) Object.assign(options, found.set);
      else found.row.parse!(next(arg, i++), options);
      continue;
    }
    if (arg.startsWith("-") && arg !== "-") throw new ArgumentError(`Unrecognized argument: '${arg}'\n${flagsHelp()}`);
    filenames.push(arg);
  }
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

// ---- a shader's own flags --------------------------------------------------

export const PRAGMA = "shader_minifier";

/** What a shader's pragma may set: the fields of the rows marked `pragma`, its own rewrites and target. Not the output, the renaming, or what needs the whole run. */
const pragmaFields: ReadonlySet<keyof Options> = new Set<keyof Options>([
  ...flags.filter((f) => f.pragma).flatMap((f) => [...Object.keys(f.set ?? {}), ...Object.keys(f.off?.set ?? {})] as (keyof Options)[]),
  "inlining", "removeUnused", "stage", // set through `parse`
]);
/** Decided for the run, since they need every stage of it: a pragma's setting of them is ignored, so `-O3` in a pragma means `-O2`. */
const runFields: readonly (keyof Options)[] = ["removeUnusedVaryings", "removeUnusedUniforms"];

/** The `#pragma shader_minifier` lines of a shader, as flags, and the source with each replaced by an empty line so line numbers hold. */
export function extractPragmas(source: string): { source: string; flags: string[] } {
  const found: string[] = [];
  const re = new RegExp(`^\\s*#\\s*pragma\\s+${PRAGMA}\\b(.*)$`);
  const lines = source.split("\n").map((line) => {
    const m = re.exec(line);
    if (m === null) return line;
    found.push(...m[1].trim().split(/\s+/).filter((f) => f !== ""));
    return "";
  });
  return { source: lines.join("\n"), flags: found };
}

/** The run's options with a shader's pragma flags applied on top. */
export function applyPragma(options: Options, pragmaFlags: readonly string[], filename: string): Options {
  if (pragmaFlags.length === 0) return options;
  const where = `${filename}: #pragma ${PRAGMA}`;
  let out: Options, filenames: string[];
  try { ({ options: out, filenames } = parseArgs(pragmaFlags, { ...options, noRenamingList: [...options.noRenamingList] })); }
  catch (e) { throw new ArgumentError(`${where}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`); }
  if (filenames.length > 0) throw new ArgumentError(`${where} takes flags only, not '${filenames[0]}'`);
  for (const k of Object.keys(out) as (keyof Options)[]) {
    if (pragmaFields.has(k)) continue;
    if (runFields.includes(k)) { (out as unknown as Record<string, unknown>)[k] = options[k]; continue; }
    if (JSON.stringify(out[k]) !== JSON.stringify(options[k])) throw new ArgumentError(`${where} may only set rewrite flags; '${k}' is decided by the command line`);
  }
  return out;
}
