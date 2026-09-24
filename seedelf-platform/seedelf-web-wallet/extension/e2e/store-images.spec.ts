// The Chrome Web Store listing's images, made from the recorded preprod
// fixtures and the public 12-word test phrase, so no real wallet is on screen
// and the same build always gives the same images:
//
// - five 1280×800 screenshots: the popup at 2×, framed, with a caption;
// - the 440×280 small promo tile;
// - the 128×128 store icon: 96×96 of artwork in 16 px of transparent padding.
//
// npm run store:images (after a build) writes them to docs/store/images/.

import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { chromium, type Page } from "@playwright/test";

import { cardanoTab, expect, openApp, restore, test, transferPreprod, vector } from "./support";

const out = fileURLToPath(new URL("../../docs/store/images/", import.meta.url));
const dataUri = (type: string, bytes: Buffer) => `data:${type};base64,${bytes.toString("base64")}`;
const asset = (path: string) => readFileSync(new URL(path, import.meta.url));

const inter = dataUri("font/woff2", asset("../public/fonts/inter-latin.woff2"));
const wordmark = dataUri("image/png", asset("../public/brand/wordmark-on-dark.png"));
const guardian = dataUri("image/png", asset("../../brand/hooded_seed_elf_guardian_icon.png"));

// The brand's navy, with a teal glow behind the popup.
const BACKDROP = `
  radial-gradient(ellipse 60% 70% at 76% 50%, rgb(0 196 188 / 0.16), transparent 70%),
  linear-gradient(160deg, #011833 0%, #000c2c 100%)`;

const page = (body: string, css: string) => `<!doctype html>
<html><head><style>
  @font-face { font-family: Inter; font-weight: 100 900; src: url(${inter}) format("woff2"); }
  * { margin: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; }
  body { font-family: Inter, sans-serif; color: #fff; -webkit-font-smoothing: antialiased; }
  ${css}
</style></head><body>${body}</body></html>`;

/** A 1280×800 screenshot: the caption on the left, the popup on the right. */
const screenshot = (popup: Buffer, title: string, text: string) =>
  page(
    `<main>
      <div class="words">
        <img class="wordmark" src="${wordmark}" alt="">
        <h1>${title}</h1>
        <p>${text}</p>
      </div>
      <img class="popup" src="${dataUri("image/png", popup)}" alt="">
    </main>`,
    `main { width: 1280px; height: 800px; background: ${BACKDROP}; position: relative; }
     .words { position: absolute; left: 104px; top: 0; bottom: 0; width: 520px;
              display: flex; flex-direction: column; justify-content: center; }
     .wordmark { position: absolute; top: 72px; left: 0; height: 56px; }
     h1 { font-size: 54px; line-height: 1.08; font-weight: 700; letter-spacing: -0.025em; text-wrap: balance; }
     p { margin-top: 24px; font-size: 23px; line-height: 1.45; color: #b9c6d8; text-wrap: pretty; }
     .popup { position: absolute; right: 120px; top: 60px; width: 408px; height: 680px; border-radius: 16px;
              box-shadow: 0 0 0 1px rgb(255 255 255 / 0.10), 0 28px 80px rgb(0 0 0 / 0.55); }`,
  );

const promoTile = page(
  `<main><img src="${wordmark}" alt=""></main>`,
  `main { width: 440px; height: 280px; background: ${BACKDROP.replace("76% 50%", "50% 50%")};
          display: grid; place-items: center; }
   img { width: 340px; }`,
);

// The guardian artwork's rounded square spans about (24, 21)–(1228, 1221) of
// its 1254² canvas, with corners of about a fifth of its side. Clipping to it
// drops the black corners and the glow, so the icon sits on any background.
const storeIcon = page(
  `<div class="art"><img src="${guardian}" alt=""></div>`,
  `body { background: transparent; }
   .art { position: absolute; left: 16px; top: 16px; width: 96px; height: 96px;
          border-radius: 19px; overflow: hidden; }
   .art img { position: absolute; width: ${(1254 * 96) / 1204}px; left: ${(-24 * 96) / 1204}px;
              top: ${(-21 * 96) / 1200}px; }`,
);

/** Renders `html` at exactly `width`×`height` pixels into docs/store/images/`name`. */
async function render(compose: Page, html: string, width: number, height: number, name: string, transparent = false) {
  await compose.setViewportSize({ width, height });
  await compose.setContent(html);
  await compose.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => img.decode()));
  });
  await compose.screenshot({ path: `${out}${name}`, omitBackground: transparent });
}

test.use({ scale: 2 });

test("the Web Store listing's images", async ({ context }) => {
  mkdirSync(out, { recursive: true });
  const tab = await openApp(context);
  await restore(tab, vector(12).phrase);
  await expect(tab.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await tab.close();

  // A Chrome popup is at most 600 px tall.
  const popup = await openApp(context, "popup");
  await popup.setViewportSize({ width: 360, height: 600 });
  const shoot = () => popup.screenshot({ animations: "disabled" });
  const back = () => popup.getByRole("button", { name: "Back", exact: true }).click();
  const shots: Array<[Buffer, string, string]> = [];

  await expect(popup.getByTestId("seedelf-tokens")).toContainText("tUSDM");
  await expect(popup.getByTestId("updated")).toHaveText("Updated just now");
  shots.push([
    await shoot(),
    "Private money on Cardano",
    "Your Seedelf balance sits in UTxOs that don't say who owns them.",
  ]);

  await popup.getByRole("button", { name: "Send to a seedelf" }).click();
  await popup.getByLabel("Seedelf name").fill(transferPreprod.to);
  await expect(popup.getByTestId("transfer-to-note")).toContainText("Found: This is a test.");
  await popup.getByLabel("Amount", { exact: true }).fill("5");
  shots.push([
    await shoot(),
    "Pay any seedelf by name",
    "Paste the name and the wallet finds it. The payment can't be linked to the seedelf it pays.",
  ]);
  await back();

  await popup.getByRole("button", { name: "Create a seedelf" }).click();
  await expect(popup.getByTestId("mint-from-note")).toBeVisible();
  await popup.getByLabel("Personal tag (optional)").fill("alice");
  shots.push([
    await shoot(),
    "Get paid privately",
    "Create a seedelf and share its name. Anyone can pay it, and no payment points back to it.",
  ]);
  await back();

  await popup.getByRole("button", { name: "Withdraw" }).click();
  await popup.getByLabel("To", { exact: true }).fill(vector(12).preprod.receive_0);
  await expect(popup.getByTestId("withdraw-own")).toContainText("This is your own Cardano account");
  await popup.getByLabel("Amount", { exact: true }).fill("10");
  shots.push([
    await shoot(),
    "It says what links",
    "Withdraw to any address or $handle. The wallet warns you before a move ties your accounts together.",
  ]);
  await back();

  await cardanoTab(popup);
  await expect(popup.getByTestId("cardano-lovelace")).not.toHaveText("— ₳");
  shots.push([
    await shoot(),
    "A Cardano account built in",
    "Restore a Lace or Eternl phrase, or make a new one. Fund the account, then move money in.",
  ]);

  const browser = await chromium.launch();
  try {
    const compose = await browser.newPage({ deviceScaleFactor: 1 });
    for (const [i, [image, title, text]] of shots.entries()) {
      await render(compose, screenshot(image, title, text), 1280, 800, `screenshot-${i + 1}.png`);
    }
    await render(compose, promoTile, 440, 280, "promo-small-440x280.png");
    await render(compose, storeIcon, 128, 128, "icon-128.png", true);
  } finally {
    await browser.close();
  }
});
