// npm run corpus:playcanvas: dump the shader programs the PlayCanvas engine (MIT) assembles for its
// materials into test/corpus/playcanvas/<case>.vert/.frag, with LICENSE and VERSION. The programs
// only exist once a scene has rendered, so a real engine runs in headless Chromium (the pixel
// harness's browser) and the sources are captured from the WebGL calls it makes. Needs a browser
// like test/pixels.test.ts.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { chromium } from "playwright";
import { repoRoot } from "../test/golden.js";

const version = process.argv[2] ?? "2.22.2";
const out = path.join(repoRoot, "test/corpus/playcanvas");
const work = path.join(repoRoot, "tests/out/playcanvas-pack");

const pkg = path.join(work, "package");
if (!fs.existsSync(path.join(pkg, "build/playcanvas.js"))) {
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  execFileSync("npm", ["pack", `playcanvas@${version}`, "--pack-destination", work], { stdio: "inherit" });
  execFileSync("tar", ["xzf", path.join(work, `playcanvas-${version}.tgz`), "-C", work]);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.error("[page]", m.text().slice(0, 300)); });
  page.on("pageerror", (e) => console.error("[pageerror]", String(e).slice(0, 300)));
  await page.route("https://playcanvas.local/**", (route) => {
    const name = path.basename(new URL(route.request().url()).pathname);
    if (name === "index.html") return route.fulfill({ body: "<!doctype html><title>playcanvas dump</title>", contentType: "text/html" });
    return route.fulfill({ body: fs.readFileSync(path.join(pkg, "build", name), "utf8"), contentType: "text/javascript" });
  });
  await page.goto("https://playcanvas.local/index.html");
  await page.addScriptTag({ path: path.join(repoRoot, "scripts/dump-playcanvas-shaders.page.js") });
  const programs = await page.evaluate("window.dumpPlayCanvasPrograms()") as { name: string; vert: string; frag: string }[];
  if (programs.length === 0) throw new Error("no programs captured");
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  fs.copyFileSync(path.join(pkg, "LICENSE"), path.join(out, "LICENSE"));
  fs.writeFileSync(path.join(out, "VERSION"), `playcanvas ${version} (https://github.com/playcanvas/engine), programs assembled by scripts/dump-playcanvas-shaders.ts\n`);
  for (const p of programs) {
    fs.writeFileSync(path.join(out, `${p.name}.vert`), p.vert.trimEnd() + "\n");
    fs.writeFileSync(path.join(out, `${p.name}.frag`), p.frag.trimEnd() + "\n");
  }
  console.log(`wrote ${programs.length} programs to ${path.relative(repoRoot, out)}: ${programs.map((p) => p.name).join(", ")}`);
} finally {
  await browser.close();
}
