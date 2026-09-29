// Vercel packaging check (DEFECT-001 regression).
//
// Vercel ships each function with only the files Next.js traced for it (*.nft.json), not the
// whole node_modules. This script rebuilds the report issue function from its trace in an
// empty directory — as on /var/task — and loads the PDF runtime from there alone:
//   1. playwright-core and @sparticuz/chromium load (the live failure was browsers.json);
//   2. with --launch (Linux x64 only, as on Vercel): the serverless Chromium binary is
//      unpacked from the traced files and renders a real PDF.
// Run after `npm run build`.
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const ROUTE = ".next/server/app/projects/[projectId]/reports/[kind]/[subjectId]/page.js.nft.json";
const root = process.cwd();
if (!existsSync(ROUTE)) throw new Error(`No trace at ${ROUTE}: run npm run build first`);

const trace = JSON.parse(readFileSync(ROUTE, "utf8"));
const files = [...new Set(trace.files.map((f) => path.relative(root, path.resolve(path.dirname(ROUTE), f))))];
const task = realpathSync(mkdtempSync(path.join(tmpdir(), "vo-function-")));
let bytes = 0;
for (const f of files) {
  if (f.startsWith("..") || !existsSync(f)) continue;
  const dest = path.join(task, f);
  mkdirSync(path.dirname(dest), { recursive: true });
  // Turbopack externals are symlinks (.next/node_modules/<pkg>-<hash> → node_modules/<pkg>): keep them as links.
  if (lstatSync(f).isSymbolicLink()) symlinkSync(readlinkSync(f), dest);
  else if (statSync(f).isFile()) {
    copyFileSync(f, dest);
    bytes += statSync(f).size;
  }
}
console.log(`function bundle: ${files.length} traced files, ${(bytes / 1e6).toFixed(1)} MB → ${task}`);

const failures = [];
const req = createRequire(path.join(task, "package.json"));
const fromBundle = (id) => req.resolve(id, { paths: [path.join(task, "node_modules")] });
let playwright;
try {
  const resolved = fromBundle("playwright-core");
  if (!resolved.startsWith(task)) throw new Error(`resolved outside the bundle: ${resolved}`);
  playwright = req(resolved);
  playwright.chromium.executablePath(); // touches the browser registry (browsers.json)
  console.log("✓ playwright-core loads from the traced files");
} catch (err) {
  failures.push(`playwright-core: ${err.message.split("\n")[0]}`);
}
let serverless;
try {
  const resolved = fromBundle("@sparticuz/chromium");
  if (!resolved.startsWith(task)) throw new Error(`resolved outside the bundle: ${resolved}`);
  serverless = req(resolved).default ?? req(resolved);
  for (const bin of ["chromium.br", "al2023.tar.br", "fonts.tar.br", "swiftshader.tar.br"]) {
    if (!existsSync(path.join(task, "node_modules/@sparticuz/chromium/bin", bin)))
      throw new Error(`missing bin/${bin}`);
  }
  console.log("✓ @sparticuz/chromium and its Brotli binaries are in the traced files");
} catch (err) {
  failures.push(`@sparticuz/chromium: ${err.message.split("\n")[0]}`);
}

if (!failures.length && process.argv.includes("--launch")) {
  if (process.platform !== "linux" || process.arch !== "x64") {
    console.log("(skipping --launch: the serverless Chromium binary is Linux x64 only)");
  } else {
    const browser = await playwright.chromium.launch({
      args: serverless.args,
      executablePath: await serverless.executablePath(),
      headless: true,
    });
    const page = await browser.newPage();
    await page.setContent("<!doctype html><h1>Value Office packaging check</h1>");
    const pdf = await page.pdf({ format: "A4" });
    await browser.close();
    if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") failures.push("serverless Chromium did not produce a PDF");
    else console.log(`✓ serverless Chromium from the traced files rendered a PDF (${pdf.byteLength} bytes)`);
  }
}

rmSync(task, { recursive: true, force: true });
if (failures.length) {
  console.error(`✗ Vercel function bundle is incomplete:\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
