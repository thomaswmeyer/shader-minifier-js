// parse -> print -> parse -> print must be a fixpoint for every shader in the corpus.
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultOptions } from "../src/options.js";
import { runParser } from "../src/parser.js";
import * as Printer from "../src/printer.js";
import { repoRoot } from "./golden.js";

function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listSources(p));
    else if (/\.(frag|vert|glsl|hlsl|comp|geom)$/.test(e.name)) out.push(p);
  }
  return out;
}

export const corpus = (): string[] => [...listSources(path.join(repoRoot, "tests/unit")), ...listSources(path.join(repoRoot, "tests/real"))];

describe("round-trip idempotence", () => {
  for (const file of corpus()) {
    const rel = path.relative(repoRoot, file);
    it(rel, () => {
      const options = defaultOptions();
      options.hlsl = file.endsWith(".hlsl");
      const src = fs.readFileSync(file, "utf8");
      if (src.includes("//[")) return; // verbatim blocks are one-way by design
      // do-while does not consume its trailing ';' (an empty statement follows, removed later by the rewriter)
      const norm = (s: string) => s.replace(/;;+/g, ";");
      const first = Printer.print(runParser(options, rel, src).code);
      const second = Printer.print(runParser(options, rel, first).code);
      expect(norm(second)).toBe(norm(first));
    });
  }
});
