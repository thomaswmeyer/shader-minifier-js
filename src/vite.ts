import * as fs from "node:fs";
import type { Plugin } from "vite";
import { minify } from "./api.js";
import { defaultOptions, optimizationLevels, type Options } from "./options.js";

export interface ShaderMinifierPluginOptions {
  /** Which imports to minify. Default: `.glsl`, `.frag`, `.vert`, `.vs`, `.fs` (with or without `?raw`). */
  include?: RegExp;
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
  /** Evaluate builtin calls on literals at float32 precision when shorter (`--fold-builtins`). Default true. */
  foldBuiltins?: boolean;
  /** Drop precision statements that restate the stage's default (`--drop-default-precision`); the stage comes from the file extension. Default true. */
  dropDefaultPrecision?: boolean;
  /** Inline single-use globals and substitute global arguments when not longer (`--inline-single-use`). Default true. */
  inlineSingleUse?: boolean;
  /** Remove unused globals, struct types and sampler precision statements (`--remove-unused-declarations`); externals stay. Default true, and a no-op under `noRemoveUnused`. */
  removeUnusedDeclarations?: boolean;
  /** Remove varyings no fragment shader reads (`--remove-unused-varyings`); needs both stages in one run, so the plugin cannot use it and it defaults false. */
  removeUnusedVaryings?: boolean;
  /** Remove uniforms no shader of the run reads (`--remove-unused-uniforms`); needs both stages, and the application must tolerate a null location. Default false. */
  removeUnusedUniforms?: boolean;
  /** Disable renaming entirely (`--no-renaming`). Default false. */
  noRenaming?: boolean;
  /** Extra names never to rename, in addition to `main` and `mainImage` (`--no-renaming-list`). */
  noRenamingList?: string[];
  /** `--no-inlining` */
  noInlining?: boolean;
  /** `--aggressive-inlining` */
  aggressiveInlining?: boolean;
  /** `--no-sequence` */
  noSequence?: boolean;
  /** `--no-remove-unused` */
  noRemoveUnused?: boolean;
  /** `--preprocess` */
  preprocess?: boolean;
  /** `--move-declarations` */
  moveDeclarations?: boolean;
  /** Any other minifier option, applied last. */
  options?: Partial<Options>;
  /** Restrict the plugin to `build` or `serve`; default both. */
  apply?: "build" | "serve";
}

const defaultInclude = /\.(glsl|frag|vert|vs|fs)$/;

export function toMinifierOptions(o: ShaderMinifierPluginOptions = {}): Options {
  // The plugin is -O2 for a WebGL target: the level's rewrites, with the names an application
  // looks up kept and no new overloads, which ANGLE's linker is strict about.
  const d: Options = { ...defaultOptions(), ...optimizationLevels[2], outputFormat: "text", webgl: true, preserveExternals: true, noOverloading: true };
  return {
    ...d,
    webgl: o.webgl ?? d.webgl,
    preserveExternals: o.preserveExternals ?? d.preserveExternals,
    noOverloading: o.noOverloading ?? d.noOverloading,
    noPiSubstitution: o.noPiSubstitution ?? d.noPiSubstitution,
    expandMacros: o.expandMacros ?? d.expandMacros,
    foldBuiltins: o.foldBuiltins ?? d.foldBuiltins,
    dropDefaultPrecision: o.dropDefaultPrecision ?? d.dropDefaultPrecision,
    inlineSingleUse: o.inlineSingleUse ?? d.inlineSingleUse,
    removeUnusedDeclarations: o.removeUnusedDeclarations ?? d.removeUnusedDeclarations,
    removeUnusedVaryings: o.removeUnusedVaryings ?? d.removeUnusedVaryings,
    removeUnusedUniforms: o.removeUnusedUniforms ?? d.removeUnusedUniforms,
    noRenaming: o.noRenaming ?? false,
    noRenamingList: [...d.noRenamingList, ...(o.noRenamingList ?? [])],
    noInlining: o.noInlining ?? false,
    aggroInlining: o.aggressiveInlining ?? false,
    noSequence: o.noSequence ?? false,
    noRemoveUnused: o.noRemoveUnused ?? false,
    preprocess: o.preprocess ?? false,
    moveDeclarations: o.moveDeclarations ?? false,
    ...o.options,
  };
}

export function shaderMinifier(pluginOptions: ShaderMinifierPluginOptions = {}): Plugin {
  const include = pluginOptions.include ?? defaultInclude;
  const options = toMinifierOptions(pluginOptions);
  return {
    name: "shader-minifier",
    enforce: "pre",
    apply: pluginOptions.apply,
    load(id) {
      const file = id.split("?")[0];
      if (!include.test(file)) return null;
      const source = fs.readFileSync(file, "utf8");
      const { code } = minify([{ name: file, content: source }], options);
      return { code: `export default ${JSON.stringify(code)};`, map: null };
    },
  };
}

export default shaderMinifier;
