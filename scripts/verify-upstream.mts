// npm run upstream:verify -- <path to a built Shader Minifier>
//
// Runs upstream Shader Minifier over `upstream/repro/`, one minimal shader per report in
// `upstream/cases.json`, and writes what it produced to `upstream/actual/`. Each report in
// `upstream/issues/` quotes that output, so this is how a claim is re-checked after an upstream
// change. `upstream/README.md` has the build steps; the default path is where they put the binary.
//
// It needs a .NET 8 SDK and upstream's sources, neither of which this repository depends on, so it
// is a script rather than a test.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { repoRoot } from "../test/golden.js";

interface Case { id: string; slug: string; tier: string; title: string; flags: string[]; file: string; wrong: string; cause: string }
const cases: Case[] = JSON.parse(fs.readFileSync(path.join(repoRoot, "upstream/cases.json"), "utf8"));
const dll = process.argv[2] ?? path.join(repoRoot, "upstream/Shader_Minifier/artifacts/bin/ShaderMinifier/release/ShaderMinifier.dll");
if (!fs.existsSync(dll)) { console.error(`no minifier at ${dll}\nSee upstream/README.md for the build steps, or pass the path to ShaderMinifier.dll.`); process.exit(1); }

/** What upstream prints for this shader, or the error it refused it with. */
function run(c: Case): string {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sm-")), "out.txt");
  try {
    execFileSync("dotnet", [dll, ...c.flags, "--format", "text", "-o", out, path.join(repoRoot, "upstream/repro", c.file)], { stdio: "pipe" });
    return fs.readFileSync(out, "utf8").trim() + "\n";
  } catch (e) {
    // The message is on stdout or the first stderr line that is not a stack frame.
    const { stdout, stderr } = e as { stdout?: Buffer; stderr?: Buffer };
    const lines = `${String(stdout ?? "")}\n${String(stderr ?? e)}`.split("\n").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("at "));
    const msg = lines.find((l) => /Exception|error|Error/.test(l)) ?? lines[0];
    return `REFUSED: ${msg ?? "no message"}\n`;
  }
}

const dir = path.join(repoRoot, "upstream/actual");
fs.mkdirSync(dir, { recursive: true });
let changed = 0;
for (const c of cases) {
  const file = path.join(dir, `${c.id}-${c.slug}.txt`);
  const now = run(c);
  const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (before !== null && before !== now) { changed++; console.log(`${c.id} ${c.slug}: CHANGED\n  was: ${before.trim()}\n  now: ${now.trim()}`); }
  else if (before === null) console.log(`${c.id} ${c.slug}: recorded`);
  fs.writeFileSync(file, now);
}
console.log(`\n${cases.length} cases, ${changed} changed. Outputs in upstream/actual/.`);
