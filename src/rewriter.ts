// Port of Minifier/rewriter.fs -- PHASE 2 STUB (identity)
import type { TopLevel } from "./ast.js";
import type { Options } from "./options.js";

// reorder functions if there were forward declarations
export function reorderFunctions(_options: Options, code: TopLevel[]): TopLevel[] {
  return code;
}

export function simplify(_options: Options, code: TopLevel[]): TopLevel[] {
  return code;
}
