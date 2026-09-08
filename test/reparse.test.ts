// Phase 4 gate: every minified output must be valid GLSL. Two independent checks per output:
// our own parser must re-parse it (and re-print it unchanged), and @shaderfrog/glsl-parser
// (a strict GLSL ES grammar) must accept it.
import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "@shaderfrog/glsl-parser";
import { describe, expect, it } from "vitest";
import { Minifier } from "../src/api.js";
import { runParser } from "../src/parser.js";
import * as Printer from "../src/printer.js";
import { loadCommands, repoRoot } from "./golden.js";

// Re-parsing is not byte-idempotent for these (all are valid GLSL): comments are whitespace to
// the parser, the trailing ';' of a do-while is a separate empty statement upstream too, and
// compute `layout(...) in;` only differs in whitespace. Compared loosely instead. HLSL outputs
// (verbatim `//[ ]` blocks, attributes) are only required to re-parse.
const looseOnly = new Set([
  "tests/unit/verbatim.frag.expected",
  "tests/unit/loop.frag.expected",
  "tests/real/terrarium.frag.expected",
  "tests/real/from-the-seas-to-the-stars.frag.expected",
  "unit/loop.frag",
  "unit/verbatim.frag",
]);
const loose = (s: string): string => s.replace(/\/\/[^\n]*/g, "").replace(/\s+/g, "").replace(/;+/g, ";");

// Upstream refuses to parse struct fields that look like swizzles (parse.fs "Record field name"),
// and the renamer legitimately produces such names; glsl-parser still validates those outputs.
const swizzleLikeField = /Record field name/;

interface Case { name: string; argv: string[] }
const cases: Case[] = loadCommands().map((argv) => ({ name: argv[argv.indexOf("-o") + 1], argv }));
for (const f of fs.readdirSync(path.join(repoRoot, "tests/unit")).filter((f) => f.endsWith(".frag")).sort()) {
  cases.push({ name: `unit/${f}`, argv: ["--format", "text", "--no-remove-unused", "-o", "/dev/null", `tests/unit/${f}`] });
}

describe("minified output re-parses", () => {
  for (const c of cases) {
    it(c.name, () => {
      const cwd = process.cwd();
      process.chdir(repoRoot);
      try {
        const { options, filenames } = Minifier.parseOptionsWithFiles(c.argv);
        const minifier = new Minifier(options, filenames.map((f): [string, string] => [f, fs.readFileSync(f, "utf8")]));
        for (const shader of minifier.shaders) {
          const out = Printer.print(shader.code);
          let again: string | null = null;
          try {
            again = Printer.print(runParser(options, shader.filename, out).code);
          } catch (e) {
            if (!swizzleLikeField.test(String(e))) throw e;
          }
          if (again !== null && !options.hlsl) {
            if (looseOnly.has(c.name)) expect(loose(again)).toBe(loose(out));
            else expect(again).toBe(out);
          }
          if (!options.hlsl) expect(() => parse(out, { quiet: true })).not.toThrow();
        }
      } finally {
        process.chdir(cwd);
      }
    });
  }
});
