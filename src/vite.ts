import * as fs from "node:fs";
import type { Plugin } from "vite";
import { minify } from "./api.js";
import { defaultOptions, optimizationLevels, type Inlining, type OptimizationLevel, type Options, type RemoveUnused } from "./options.js";

/**
 * The rewrite settings, which apply to every file or, in `overrides`, to the files a pattern
 * matches. Each is the minifier option of the same name; the defaults are -O2 for a WebGL target.
 */
export interface ShaderMinifierRewriteOptions {
  /** The optimisation level the other settings start from (`-O0` to `-O3`). Default 2, the plugin's own rewrites. */
  level?: OptimizationLevel;
  /** Refuse to emit constructs WebGL rejects (`--webgl`). Default true. */
  webgl?: boolean;
  /** Keep uniform/attribute/varying names (`--preserve-externals`). Default true. */
  preserveExternals?: boolean;
  /** Do not introduce new function overloads when renaming (`--no-overloading`). Default true. */
  noOverloading?: boolean;
  /** Leave pi-like literals alone (`--no-pi-substitution`). Default true. */
  noPiSubstitution?: boolean;
  /** Expand `#define` macros so they vanish from the output (`--expand-macros`). Default true. */
  expandMacros?: boolean;
  /** Fold builtin calls on literals and constant divisions at float32 precision when shorter (`--approximate-folds`). Default true. */
  approximateFolds?: boolean;
  /** Fold `+ - *` on literals with upstream's decimal arithmetic instead of at float32 (`--decimal-folds`). Default false. */
  decimalFolds?: boolean;
  /** Drop precision statements that restate the stage's default (`--drop-default-precision`); the stage comes from the file extension. Default true. */
  dropDefaultPrecision?: boolean;
  /** Inline single-use globals and substitute global arguments when not longer (`--inline-single-use`). Default true. */
  inlineSingleUse?: boolean;
  /** What to remove when unused (`--remove-unused`): `"none"`, `"functions"` (upstream's default) or `"declarations"`, also globals, struct types and sampler precision statements, externals staying. Default `"declarations"`. */
  removeUnused?: RemoveUnused;
  /** Remove varyings no fragment shader reads (`--remove-unused-varyings`); needs both stages in one run, so the plugin cannot use it and it defaults false. */
  removeUnusedVaryings?: boolean;
  /** Remove uniforms no shader of the run reads (`--remove-unused-uniforms`); needs both stages, and the application must tolerate a null location. Default false. */
  removeUnusedUniforms?: boolean;
  /** Disable renaming entirely (`--no-renaming`). Default false. */
  noRenaming?: boolean;
  /** Extra names never to rename, in addition to `main` and `mainImage` (`--no-renaming-list`). */
  noRenamingList?: string[];
  /** How much to inline (`--inlining`): `"none"`, `"default"` or `"aggressive"`. Default `"default"`. */
  inlining?: Inlining;
  /** `--no-sequence` */
  noSequence?: boolean;
  /** `--preprocess` */
  preprocess?: boolean;
  /** `--move-declarations` */
  moveDeclarations?: boolean;
  /** Any other minifier option, applied last. */
  options?: Partial<Options>;
}

export interface ShaderMinifierPluginOptions extends ShaderMinifierRewriteOptions {
  /** Which imports to minify. Default: `.glsl`, `.frag`, `.vert`, `.vs`, `.fs` (with or without `?raw`). */
  include?: RegExp;
  /** Restrict the plugin to `build` or `serve`; default both. */
  apply?: "build" | "serve";
  /**
   * Settings for the files a pattern matches, applied in order over the ones above: a shader with a
   * hash function in it may keep `approximateFolds: false`, a vertex shader may take another
   * `level`. The pattern is tested against the file path without its query.
   */
  overrides?: ({ include: RegExp } & ShaderMinifierRewriteOptions)[];
}

const defaultInclude = /\.(glsl|frag|vert|vs|fs)$/;

/** The minifier options for one file, or for every file when `file` is not given: the plugin's settings and then each matching override. */
export function toMinifierOptions(plugin: ShaderMinifierPluginOptions = {}, file?: string): Options {
  let o: ShaderMinifierRewriteOptions = plugin;
  for (const ov of plugin.overrides ?? []) {
    if (file === undefined || !ov.include.test(file)) continue;
    const { include: _include, ...settings } = ov;
    o = { ...o, ...settings, noRenamingList: [...(o.noRenamingList ?? []), ...(settings.noRenamingList ?? [])], options: { ...o.options, ...settings.options } };
  }
  // The plugin is -O2 for a WebGL target: the level's rewrites, with the names an application
  // looks up kept and no new overloads, which ANGLE's linker is strict about. Every other setting
  // is the minifier option of the same name.
  const d: Options = { ...defaultOptions(), ...optimizationLevels[o.level ?? 2], outputFormat: "text", webgl: true, preserveExternals: true, noOverloading: true };
  const { level: _level, noRenamingList, options, ...settings } = o;
  return {
    ...d,
    ...Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== undefined)),
    noRenamingList: [...d.noRenamingList, ...(noRenamingList ?? [])],
    ...options,
  };
}

export function shaderMinifier(pluginOptions: ShaderMinifierPluginOptions = {}): Plugin {
  const include = pluginOptions.include ?? defaultInclude;
  const options = toMinifierOptions(pluginOptions);
  const optionsFor = (file: string): Options => (pluginOptions.overrides?.length ? toMinifierOptions(pluginOptions, file) : options);
  return {
    name: "shader-minifier",
    enforce: "pre",
    apply: pluginOptions.apply,
    load(id) {
      const file = id.split("?")[0];
      if (!include.test(file)) return null;
      const source = fs.readFileSync(file, "utf8");
      const { code } = minify([{ name: file, content: source }], optionsFor(file));
      return { code: `export default ${JSON.stringify(code)};`, map: null };
    },
  };
}

export default shaderMinifier;
