// npm run corpus:cesium: dump the shader programs CesiumJS (Apache-2.0) assembles for its globe,
// primitives, materials and post-processing into test/corpus/cesium/<case>.vert/.frag, with
// LICENSE and VERSION. A Cesium shader as written in the repository is not a whole shader: the
// renderer adds the `czm_` builtins it references and the automatic uniforms, so only a running
// scene produces the real thing. Runs in the pixel harness's browser, like the other engine
// dumpers. Needs a browser like test/pixels.test.ts.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { chromium } from "playwright";
import { repoRoot } from "../test/golden.js";

const version = process.argv[2] ?? "1.145.0";
const out = path.join(repoRoot, "test/corpus/cesium");
const work = path.join(repoRoot, "tests/out/cesium-umd");
const pkg = path.join(work, "package");

if (!fs.existsSync(path.join(pkg, "Build/Cesium/Cesium.js"))) {
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  execFileSync("npm", ["pack", `cesium@${version}`, "--pack-destination", work], { stdio: "inherit" });
  execFileSync("tar", ["xzf", path.join(work, `cesium-${version}.tgz`), "-C", work]);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text().slice(0, 200)); });
  page.on("pageerror", (e) => console.error("[pageerror]", String(e).slice(0, 200)));
  // Cesium asks for its workers and assets by relative URL, so the whole Build directory is served.
  await page.route("https://cesium.local/**", (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\//, "");
    if (rel === "index.html") return route.fulfill({ body: "<!doctype html><title>cesium dump</title>", contentType: "text/html" });
    const file = path.join(pkg, "Build/Cesium", rel);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: "" });
    const type = rel.endsWith(".js") ? "text/javascript" : rel.endsWith(".css") ? "text/css" : rel.endsWith(".json") ? "application/json" : "application/octet-stream";
    return route.fulfill({ body: fs.readFileSync(file), contentType: type });
  });
  await page.goto("https://cesium.local/index.html");
  await page.addScriptTag({ path: path.join(repoRoot, "scripts/dump-cesium-shaders.page.js") });
  const programs = await page.evaluate("window.dumpCesiumPrograms()") as { name: string; vert: string; frag: string }[];
  if (programs.length === 0) throw new Error("no programs captured");
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  fs.copyFileSync(path.join(pkg, "LICENSE.md"), path.join(out, "LICENSE"));
  fs.writeFileSync(path.join(out, "VERSION"), `cesium ${version} (https://github.com/CesiumGS/cesium), programs assembled by scripts/dump-cesium-shaders.ts\n`);
  for (const p of programs) {
    fs.writeFileSync(path.join(out, `${p.name}.vert`), p.vert.trimEnd() + "\n");
    fs.writeFileSync(path.join(out, `${p.name}.frag`), p.frag.trimEnd() + "\n");
  }
  console.log(`wrote ${programs.length} programs to ${path.relative(repoRoot, out)}: ${programs.map((p) => p.name).join(", ")}`);
} finally {
  await browser.close();
}
