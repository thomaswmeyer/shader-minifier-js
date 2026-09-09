// tom.to's ink shaders (test/tomto), minified with the Vite plugin's defaults, pinned to
// goldens so a size regression shows up here. UPDATE_GOLDEN=1 rewrites the goldens.
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { Minifier } from "../src/api.js";
import { toMinifierOptions } from "../src/vite.js";
import { repoRoot } from "./golden.js";

export const tomtoDir = path.join(repoRoot, "test/tomto");
export const tomtoShaders = (): string[] => fs.readdirSync(tomtoDir).filter((f) => /\.(frag|vert)$/.test(f)).sort();
export const minifyTomto = (name: string): string =>
  new Minifier(toMinifierOptions(), [[name, fs.readFileSync(path.join(tomtoDir, name), "utf8")]]).format();

describe("tom.to ink shaders", () => {
  for (const name of tomtoShaders()) {
    it(name, () => {
      const out = minifyTomto(name);
      const golden = path.join(tomtoDir, name + ".expected");
      if (process.env.UPDATE_GOLDEN || !fs.existsSync(golden)) fs.writeFileSync(golden, out + "\n");
      expect(out).toBe(fs.readFileSync(golden, "utf8").trimEnd());
    });
  }
});
