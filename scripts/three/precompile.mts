// npm run three:precompile [-- --url <page> --out <dir>]
//
// Precompile a three.js app's shaders. three.js assembles a program in the browser from its chunk
// library, so the shaders a page really runs only exist once it has run: this opens the page,
// records every program the driver links, minifies each one with its #defines already decided, and
// reports what the set costs against the chunk library it would replace.
//
// With no --url it captures the demo scene in this directory, and then verifies the result: it
// reloads, swaps every captured shader for its minified twin on the way to the driver, and compares
// the two pictures pixel by pixel. A page of your own is captured and measured but not verified,
// since that needs it to draw the same thing twice.
//
// docs/MINIFYING_THREE_JS.md has the numbers this produced and what it cannot do yet. Needs
// Playwright's Chromium and, for the demo, `npm install --no-save three`.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { chromium, type Browser } from "playwright";
import { Minifier } from "../../src/api.js";
import * as Printer from "../../src/printer.js";
import { pluginOptions } from "../../test/corpora.js";
import { repoRoot } from "../../test/golden.js";

interface Program { vert: string; frag: string }
interface Minified extends Program { minVert: string; minFrag: string }

const argv = process.argv.slice(2);
const flag = (name: string): string | null => { const i = argv.indexOf(name); return i < 0 ? null : argv[i + 1] ?? null; };
const url = flag("--url");
const outDir = flag("--out");
const brotli = (text: string): number =>
  zlib.brotliCompressSync(Buffer.from(text, "utf8"), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length;

/** Serve the repository, so the demo page can import three from node_modules. */
function serve(): Promise<{ port: number; close: () => void }> {
  const types: Record<string, string> = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html" };
  const server = http.createServer((req, res) => {
    const asked = (req.url ?? "/").split("?")[0];
    const file = path.join(repoRoot, asked === "/" ? "scripts/three/demo.html" : asked);
    if (!file.startsWith(repoRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, () => {
    const address = server.address();
    resolve({ port: typeof address === "object" && address !== null ? address.port : 0, close: () => server.close() });
  }));
}

/** Open a page with the capture hooks already installed, and let it settle. */
async function open(browser: Browser, target: string) {
  const page = await browser.newPage();
  await page.addInitScript({ path: path.join(repoRoot, "scripts/three/inject.js") });
  page.on("pageerror", (e) => console.error(`  page error: ${String(e).split("\n")[0]}`));
  await page.goto(target, { waitUntil: "load" });
  await page.waitForTimeout(1500); // let the app draw at least one frame
  return page;
}

const chromiumPath = process.env.CHROMIUM_EXECUTABLE;
if (url === null && !fs.existsSync(path.join(repoRoot, "node_modules/three"))) {
  console.error("The demo scene needs three.js: npm install --no-save three\n(or point this at your own app with --url)");
  process.exit(1);
}

const server = url === null ? await serve() : null;
const target = url ?? `http://127.0.0.1:${server!.port}/`;
const browser = await chromium.launch({ executablePath: chromiumPath, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });

console.log(`capturing ${target}`);
const page = await open(browser, target);
const programs: Program[] = await page.evaluate("window.__smjs.programs()");
const before: number[][] = url === null ? await page.evaluate("window.__smjs.pixels()") : [];
await page.close();

if (programs.length === 0) {
  console.error("no programs were linked. Is it a WebGL page, and did it draw before the timeout?");
  await browser.close(); server?.close(); process.exit(1);
}

// The #defines are baked into the prefix three.js prepended, so --preprocess decides every #if.
// Externals keep their names because the renderer binds uniforms and attributes by name, and both
// stages of a program go through one run so the varyings they share are renamed the same way.
const options = { ...pluginOptions(), preprocess: true };
const minified: Minified[] = [];
for (const [i, p] of programs.entries()) {
  const run = new Minifier(options, [[`program${i}.vert`, p.vert], [`program${i}.frag`, p.frag]]);
  const [minVert, minFrag] = run.shaders.map((s) => Printer.print(s.code));
  minified.push({ ...p, minVert, minFrag });
}

const sourceText = minified.flatMap((p) => [p.vert, p.frag]).join("\n");
const minText = minified.flatMap((p) => [p.minVert, p.minFrag]).join("\n");
const n = (x: number) => x.toLocaleString("en");
console.log(`\n${programs.length} programs\n`);
console.log("| program | vertex | fragment | minified vertex | minified fragment |");
console.log("|---|--:|--:|--:|--:|");
for (const [i, p] of minified.entries())
  console.log(`| ${i} | ${n(p.vert.length)} | ${n(p.frag.length)} | ${n(p.minVert.length)} | ${n(p.minFrag.length)} |`);
console.log(`\nraw    ${n(sourceText.length)} -> ${n(minText.length)}  (${(100 * (1 - minText.length / sourceText.length)).toFixed(0)}% smaller)`);
console.log(`brotli ${n(brotli(sourceText))} -> ${n(brotli(minText))}  (${(100 * (1 - brotli(minText) / brotli(sourceText))).toFixed(0)}% smaller)`);

if (outDir !== null) {
  const dir = path.resolve(outDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "programs.json"), JSON.stringify(minified.map(({ minVert, minFrag }) => ({ vert: minVert, frag: minFrag })), null, 1));
  console.log(`\nwrote ${path.join(dir, "programs.json")}`);
}

// Verification: the same page again, with every captured shader swapped for its minified twin.
if (url === null) {
  const pairs = minified.flatMap((p) => [[p.vert, p.minVert], [p.frag, p.minFrag]]);
  const verify = await browser.newPage();
  await verify.addInitScript({ path: path.join(repoRoot, "scripts/three/inject.js") });
  await verify.addInitScript(`window.__smjsPairs = ${JSON.stringify(pairs)};
    const install = setInterval(() => { if (window.__smjs) { window.__smjs.substitute(window.__smjsPairs); clearInterval(install); } }, 0);`);
  await verify.goto(target, { waitUntil: "load" });
  await verify.waitForTimeout(1500);
  const counts = await verify.evaluate("window.__smjs.counts()") as { hits: number; misses: number };
  const after: number[][] = await verify.evaluate("window.__smjs.pixels()");
  await verify.close();

  let differing = 0, worst = 0, total = 0;
  before.forEach((canvas, c) => {
    const other = after[c] ?? [];
    for (let i = 0; i < canvas.length; i += 4) {
      total++;
      let moved = 0;
      for (let ch = 0; ch < 3; ch++) moved = Math.max(moved, Math.abs(canvas[i + ch] - (other[i + ch] ?? 0)));
      if (moved > 0) differing++;
      worst = Math.max(worst, moved);
    }
  });
  console.log(`\nverification: ${counts.hits} shader texts replaced, ${counts.misses} left alone`);
  console.log(`              ${differing} of ${n(total)} pixels differ, largest channel difference ${worst} of 255`);
  if (counts.hits === 0) console.log("              NOTHING WAS REPLACED, so this proves nothing");
  else console.log(differing === 0 ? "              identical" : worst <= 1 ? "              within one level" : "              DIFFERENT");
}

await browser.close();
server?.close();
