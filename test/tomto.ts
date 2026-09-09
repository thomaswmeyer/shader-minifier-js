// tom.to's ink shaders (test/tomto): six GLSL ES 3.00 shaders from a WebGL2 particle engine,
// kept as model inputs. Shared by the golden test and the ANGLE compile test.
import * as fs from "node:fs";
import * as path from "node:path";
import { Minifier } from "../src/api.js";
import { toMinifierOptions } from "../src/vite.js";
import { repoRoot } from "./golden.js";

export const tomtoDir = path.join(repoRoot, "test/tomto");
export const tomtoShaders = (): string[] => fs.readdirSync(tomtoDir).filter((f) => /\.(frag|vert)$/.test(f)).sort();
export const readTomto = (name: string): string => fs.readFileSync(path.join(tomtoDir, name), "utf8");
/** Minified with the Vite plugin's defaults, as a site would get it. */
export const minifyTomto = (name: string): string => new Minifier(toMinifierOptions(), [[name, readTomto(name)]]).format();
