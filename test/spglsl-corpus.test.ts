// Phase 4: the spglsl shader corpus must minify, re-parse, and parse with an independent GLSL ES grammar.
import { parse } from "@shaderfrog/glsl-parser";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { hasMain, loadSpglslCorpus, minifyToText } from "../scripts/webgl-compile-page.js";
import { Minifier } from "../src/api.js";
import { runParser } from "../src/parser.js";
import * as Printer from "../src/printer.js";
import { repoRoot } from "./golden.js";

// Shader Minifier rejects struct fields named like swizzle components, because renameField
// canonicalises `.a` to `.w` on every field access (parse.fs "Restriction on field names").
const fieldRestriction = /Record field name '\w+' is not allowed by Shader Minifier/;
const unsupportedInput: Record<string, string> = {
  "custom/complicated.frag": "struct field 'a' collides with a swizzle component name",
};

const gzipSize = (s: string): number => zlib.gzipSync(Buffer.from(s, "utf8"), { level: 9 }).length;

interface Row { name: string; source: number; minified: number; gzip: number; spglsl?: [number, number]; flags: string }
const rows: Row[] = [];

describe("spglsl corpus", () => {
  for (const { name, source } of loadSpglslCorpus()) {
    it(name, () => {
      const reason = unsupportedInput[name];
      if (reason !== undefined) {
        expect(() => minifyToText(name, source), reason).toThrow(fieldRestriction);
        return;
      }
      const out = minifyToText(name, source);
      expect(out.length).toBeGreaterThan(0);

      // Renamed struct fields may themselves look like swizzle components (upstream output has the same
      // property), so the only re-parse error tolerated is that input restriction.
      try {
        const reparsed = runParser(Minifier.parseOptions(["--no-renaming", "--no-inlining"]), name, out);
        expect(Printer.print(reparsed.code)).toBe(out);
      } catch (e) {
        if (!(e instanceof Error && fieldRestriction.test(e.message))) throw e;
      }

      expect(() => parse(out, { quiet: true })).not.toThrow();

      const m = /\/\/ #expected-size:\s*(\d+)\s+(\d+)/.exec(source);
      rows.push({
        name, source: Buffer.byteLength(source), minified: Buffer.byteLength(out), gzip: gzipSize(out),
        spglsl: m ? [Number(m[1]), Number(m[2])] : undefined,
        flags: hasMain(source) ? "" : "--no-remove-unused",
      });
    });
  }

  afterAll(() => {
    const delta = (ours: number, theirs?: number) => (theirs === undefined ? "" : `${ours - theirs > 0 ? "+" : ""}${ours - theirs}`);
    const lines = [
      "| file | source | minified | gzip | spglsl | spglsl gzip | delta | delta gzip | flags |",
      "|---|--:|--:|--:|--:|--:|--:|--:|---|",
      ...rows.map((r) => `| ${r.name} | ${r.source} | ${r.minified} | ${r.gzip} | ${r.spglsl?.[0] ?? ""} | ${r.spglsl?.[1] ?? ""} | ${delta(r.minified, r.spglsl?.[0])} | ${delta(r.gzip, r.spglsl?.[1])} | ${r.flags} |`),
    ];
    const table = lines.join("\n");
    fs.mkdirSync(path.join(repoRoot, "tests/out"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, "tests/out/spglsl-sizes.md"), `# spglsl corpus sizes (bytes)\n\nspglsl columns come from \`// #expected-size:\` annotations in the source files. Files without \`main()\` are libraries and are minified with \`--no-remove-unused\`, as spglsl keeps their functions.\n\n${table}\n`);
    console.log(table);
  });
});
