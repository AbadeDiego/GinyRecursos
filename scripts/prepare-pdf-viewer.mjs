import { cp, mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const dependency = createRequire(require.resolve("react-pdf")).resolve("pdfjs-dist/package.json");
const { version } = JSON.parse(await readFile(dependency, "utf8"));
const source = dirname(dependency);
const target = new URL(`../public/pdf-viewer/${version}/`, import.meta.url);

const assets = [
  ["build/pdf.worker.min.mjs", "pdf.worker.min.mjs"],
  ["cmaps", "cmaps"],
  ["standard_fonts", "standard_fonts"],
  ["wasm", "wasm"],
  ["LICENSE", "LICENSE"],
];

await mkdir(target, { recursive: true });
await Promise.all(assets.map(([from, to]) => cp(join(source, from), new URL(to, target), { recursive: true })));
