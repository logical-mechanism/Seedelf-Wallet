// Renders a media folder's src/*.html to PNGs beside src/: 1600×900, at 2×
// for sharpness. Playwright comes from the extension, so `npm ci` there first.
//
//   node media/render.mjs x/private-contracts          every image in it
//   node media/render.mjs x/private-contracts 01-the-loop
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(join(here, "../extension/package.json"))("playwright");

const [folder, ...only] = process.argv.slice(2);
if (!folder) {
  console.error("usage: node media/render.mjs <folder, e.g. x/private-contracts> [name ...]");
  process.exit(1);
}
const out = join(here, folder);
const src = join(out, "src");

const names = readdirSync(src)
  .filter((f) => f.endsWith(".html"))
  .map((f) => basename(f, ".html"))
  .filter((n) => only.length === 0 || only.includes(n));

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  for (const name of names) {
    await page.goto(pathToFileURL(join(src, `${name}.html`)).href);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(out, `${name}.png`) });
    console.log(join(folder, `${name}.png`));
  }
} finally {
  await browser.close();
}
