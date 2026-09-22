// Port of Checker/main.fs golden-test logic. Runs from the repo root.
import * as fs from "node:fs";
import * as path from "node:path";
import { Minifier } from "../src/api.js";
import type { Options } from "../src/options.js";

export const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

// Generated files may contain the Shader Minifier version. Ignore version changes in the tests.
const versionRegex = /\bShader Minifier \d(\.\d+)+/g;
export const cleanString = (s: string): string => s.replace(/\r\n/g, "\n").trim().replace(versionRegex, "");

export function splitArgs(line: string): string[] {
  const args: string[] = [];
  let insideQuotes = false;
  let arg = "";
  for (const c of line) {
    if (c === '"') insideQuotes = !insideQuotes;
    else if (c === " " && !insideQuotes) { args.push(arg); arg = ""; }
    else arg += c;
  }
  if (arg !== "") args.push(arg);
  return args;
}

export function loadCommands(): string[][] {
  const lines = fs.readFileSync(path.join(repoRoot, "tests/commands.txt"), "utf8").split("\n");
  return lines.map((l) => l.trim()).filter((l) => l.length > 0 && l[0] !== "#").map(splitArgs);
}

export interface GoldenResult { name: string; ok: boolean; got: string; expected: string }

export function runCommand(argv: string[], updateGolden = false): GoldenResult {
  const cwd = process.cwd();
  process.chdir(repoRoot);
  try {
    const { options, filenames } = Minifier.parseOptionsWithFiles(argv);
    // The goldens pin upstream's output, and upstream folds float operators in decimal; the port
    // rounds at float32 by default (docs/PORTING.md 5.2 item 33), so the corpus runs with the flag that
    // restores upstream's arithmetic rather than carrying 14 numeric deviations.
    options.decimalFolds = true;
    let expected: string;
    try {
      expected = cleanString(fs.readFileSync(options.outputName, "utf8"));
    } catch (e) {
      if (!updateGolden) throw e;
      expected = "";
    }
    const files = filenames.map((f): [string, string] => [f, fs.readFileSync(f, "utf8")]);
    const minifier = new Minifier(options, files);
    const result = cleanString(minifier.format());

    if (filenames.length === 1) {
      const indentedOptions: Options = { ...options, outputFormat: "indented", exportKkpSymbolMaps: false };
      const shader = minifier.shaders[0];
      const resultIndented = cleanString(minifier.format(indentedOptions));
      const outdir = "tests/out/" + options.outputName.replace(/^tests\/(.*)\/[^/]*$/, "$1") + "/";
      const m = /(^.*)\.([^.]+)$/.exec(path.basename(shader.filename))!;
      fs.mkdirSync(outdir, { recursive: true });
      fs.writeFileSync(outdir + m[1] + ".minind." + m[2], resultIndented + "\n");
    }

    const ok = result === expected;
    if (!ok && updateGolden) fs.writeFileSync(options.outputName, result + "\n");
    return { name: options.outputName, ok, got: result, expected };
  } finally {
    process.chdir(cwd);
  }
}
