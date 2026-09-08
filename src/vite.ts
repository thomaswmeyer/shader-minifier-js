import * as fs from "node:fs";
import type { Plugin } from "vite";
import { minify } from "./api.js";
import { defaultOptions, type Options } from "./options.js";

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
  const d = defaultOptions();
  return {
    ...d,
    outputFormat: "text",
    webgl: o.webgl ?? true,
    preserveExternals: o.preserveExternals ?? true,
    noOverloading: o.noOverloading ?? true,
    noPiSubstitution: o.noPiSubstitution ?? true,
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
