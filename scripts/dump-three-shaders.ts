// npm run corpus:three: dump the shader programs three.js (MIT) assembles for its materials into
// test/corpus/three/<Material>[-variant].vert/.frag, with LICENSE and VERSION. The programs only
// exist after three.js expands its chunks for a material's features, so a real renderer runs in
// headless Chromium (the pixel harness's browser) with a scene per material, and the linked
// sources are read back from the WebGL context. Needs a browser like test/pixels.test.ts.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { chromium } from "playwright";
import { repoRoot } from "../test/golden.js";

const version = process.argv[2] ?? "0.186.0";
const out = path.join(repoRoot, "test/corpus/three");
const work = path.join(repoRoot, "tests/out/three-pack");

const pkg = path.join(work, "package");
if (!fs.existsSync(path.join(pkg, "build/three.module.js"))) {
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  execFileSync("npm", ["pack", `three@${version}`, "--pack-destination", work], { stdio: "inherit" });
  execFileSync("tar", ["xzf", path.join(work, `three-${version}.tgz`), "-C", work]);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.error("[page]", m.text().slice(0, 300)); });
  // The page and three's two module files are served from a made-up origin, so `import()` works.
  await page.route("https://three.local/**", (route) => {
    const name = path.basename(new URL(route.request().url()).pathname);
    if (name === "index.html") return route.fulfill({ body: "<!doctype html><title>three dump</title>", contentType: "text/html" });
    return route.fulfill({ body: fs.readFileSync(path.join(pkg, "build", name), "utf8"), contentType: "text/javascript" });
  });
  await page.goto("https://three.local/index.html");
  await page.addScriptTag({ path: path.join(repoRoot, "scripts/dump-three-shaders.page.js") });
  const programs = await page.evaluate("window.dumpThreePrograms()") as { name: string; vert: string; frag: string }[];
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  fs.copyFileSync(path.join(pkg, "LICENSE"), path.join(out, "LICENSE"));
  fs.writeFileSync(path.join(out, "VERSION"), `three ${version} (https://github.com/mrdoob/three.js), programs assembled by scripts/dump-three-shaders.ts\n`);
  for (const p of programs) {
    fs.writeFileSync(path.join(out, `${p.name}.vert`), p.vert.trimEnd() + "\n");
    fs.writeFileSync(path.join(out, `${p.name}.frag`), p.frag.trimEnd() + "\n");
  }
  console.log(`wrote ${programs.length} programs to ${path.relative(repoRoot, out)}: ${programs.map((p) => p.name).join(", ")}`);
} finally {
  await browser.close();
}
