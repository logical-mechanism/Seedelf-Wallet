// The Chrome Web Store listing's images, made from the recorded preprod
// fixtures and the public 12-word test phrase, so no real wallet is on screen
// and the same build always gives the same images:
//
// - five 1280×800 screenshots: the side panel at 2×, framed, with a caption,
//   in each language the wallet speaks (English's in images/, Spanish's and
//   Japanese's in images/es/ and images/ja/, the listing's own in each);
// - the 440×280 small promo tile;
// - the 128×128 store icon: 96×96 of artwork in 16 px of transparent padding.
//
// The flow is driven in English, and each screen is shot in every language
// by switching the wallet's language on it, as Settings does.
//
// The listing is for mainnet, so the wallet is on mainnet, as the store's
// build opens: the fake Koios gives the recordings with mainnet's addresses
// (support.ts), and each test token on screen stands in for one on the
// wallet's mainnet list (MAINNET_TOKENS).
//
// npm run store:images (after a build) writes them to docs/store/images/.

import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { blake2b } from "@noble/hashes/blake2.js";
import { chromium, type Page } from "@playwright/test";

import { LOCAL_LANGUAGE } from "../src/shared/preferences";
import { bech32 } from "../tests/fixtures/bech32";
import { cardanoTab, expect, openApp, restore, test, vector } from "./support";

/** A token's CIP-14 fingerprint, as Koios lists it. */
const fingerprint = (policy: string, name: string) =>
  bech32("asset", blake2b(Buffer.from(policy + name, "hex"), { dkLen: 20 }));

/** Mainnet's USDM and DJED (src/tokens/list.json), each with 6 decimals. */
const USDM = { policy_id: "c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad", asset_name: "0014df105553444d" };
const DJED = { policy_id: "8db269c3ec630e06ae29f74bc39edd1f87c819f1056206e879a1cd61", asset_name: "446a65644d6963726f555344" };
const standIn = (token: { policy_id: string; asset_name: string }) => ({
  ...token,
  fingerprint: fingerprint(token.policy_id, token.asset_name),
  decimals: 6,
});

/**
 * The recordings' test tokens on screen, by preprod unit, and the mainnet
 * tokens they stand in for: the private balance's tUSDM (owned-utxos.json),
 * and the public account's tUSDM and LINK (koios-preprod.json).
 */
const MAINNET_TOKENS: Array<[string, ReturnType<typeof standIn>]> = [
  ["c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0.745553444d", standIn(USDM)],
  ["e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9.0014df10745553444d", standIn(USDM)],
  ["9c6cd01df2299fcb46293880da5a07d9d77089ec2fcbfefd737c0c9d.0014df104c494e4b", standIn(DJED)],
];

/** A Seedelf in the recordings (koios-preprod.json) to pay, named "Ancient Kraken". */
const PAY_TO = "5eed0e1f416e6369656e74204b72616b656e0250963e8b37a282536e8e0d6369";

type Language = "en" | "es" | "ja";

/** The listing's languages, the wallet's own: English's images at the top of images/, the others' in a folder each. */
const LANGUAGES: Language[] = ["en", "es", "ja"];

/** Each screenshot's caption, a title and a line, in each language (docs/store/README.md lists them). */
const CAPTIONS: Record<Language, Array<[string, string]>> = {
  en: [
    ["Private money on Cardano", "Your private balance sits in UTxOs that don't say who owns them."],
    ["Pay any Seedelf by name", "Paste the name and the wallet finds it. The payment can't be linked to the Seedelf it pays."],
    ["Get paid privately", "Create a Seedelf and share its name. Anyone can pay it, and no payment points back to it."],
    [
      "It says what links",
      "Make money public to any address or $handle. The wallet warns you before a payment ties your accounts together.",
    ],
    ["A full Cardano wallet", "Send, stake with a pool and delegate your vote. Restore a Lace or Eternl phrase, or make a new one."],
  ],
  es: [
    ["Dinero privado en Cardano", "Tu saldo privado está en UTxOs que no dicen de quién son."],
    ["Paga a un Seedelf por nombre", "Pega el nombre y la billetera lo encuentra. El pago no se puede vincular con el Seedelf al que paga."],
    ["Recibe en privado", "Crea un Seedelf y comparte su nombre. Cualquiera puede pagarle, y ningún pago lleva hasta él."],
    [
      "Te dice qué vincula",
      "Haz público tu dinero pagando a cualquier dirección o $handle. La billetera te avisa antes de que un pago vincule tus cuentas entre sí.",
    ],
    ["Billetera completa de Cardano", "Envía, haz staking con un pool y delega tu voto. Restaura una frase de Lace o Eternl, o crea una nueva."],
  ],
  ja: [
    ["Cardano 上のプライベートなお金", "プライベート残高は、誰のものかを示さない UTxO の中にあります。"],
    [
      "どの Seedelf にも名前で支払う",
      "名前を貼り付ければ、ウォレットがその Seedelf を見つけます。その支払いを支払先の Seedelf と結び付けることは、誰にもできません。",
    ],
    [
      "プライベートに受け取る",
      "Seedelf を作成して、その名前を伝えましょう。誰でもそこに支払うことができ、どの支払いからもその Seedelf にはたどり着けません。",
    ],
    ["結び付くものを示す", "任意のアドレスや $handle に支払って、お金を公開できます。支払いでアカウント同士が結び付く前に、ウォレットが警告します。"],
    [
      "フル機能の Cardano ウォレット",
      "送金、プールへのステーキング、投票権の委任ができます。Lace や Eternl のフレーズから復元することも、新しいフレーズを作ることもできます。",
    ],
  ],
};

const out = fileURLToPath(new URL("../../docs/store/images/", import.meta.url));
const folder = (language: Language) => (language === "en" ? out : `${out}${language}/`);
const dataUri = (type: string, bytes: Buffer) => `data:${type};base64,${bytes.toString("base64")}`;
const asset = (path: string) => readFileSync(new URL(path, import.meta.url));

const inter = dataUri("font/woff2", asset("../public/fonts/inter-latin.woff2"));
const wordmark = dataUri("image/png", asset("../public/brand/wordmark-on-dark.png"));
const guardian = dataUri("image/png", asset("../../brand/hooded_seed_elf_guardian_icon.png"));

// The brand's navy, with a teal glow behind the popup.
const BACKDROP = `
  radial-gradient(ellipse 60% 70% at 76% 50%, rgb(0 196 188 / 0.16), transparent 70%),
  linear-gradient(160deg, #011833 0%, #000c2c 100%)`;

const page = (body: string, css: string, language: Language = "en") => `<!doctype html>
<html lang="${language}"><head><style>
  @font-face { font-family: Inter; font-weight: 100 900; src: url(${inter}) format("woff2"); }
  * { margin: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; }
  body { font-family: Inter, sans-serif; color: #fff; -webkit-font-smoothing: antialiased; }
  ${css}
</style></head><body>${body}</body></html>`;

/** A 1280×800 screenshot: the caption on the left, the wallet on the right. */
const screenshot = (popup: Buffer, [title, text]: [string, string], language: Language) =>
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
     :lang(ja) h1 { letter-spacing: 0; line-height: 1.2; }
     /* Japanese has no spaces: break its lines between phrases, not inside a word. */
     :lang(ja) h1, :lang(ja) p { word-break: auto-phrase; }
     p { margin-top: 24px; font-size: 23px; line-height: 1.45; color: #b9c6d8; text-wrap: pretty; }
     .popup { position: absolute; right: 120px; top: 60px; width: 408px; height: 680px; border-radius: 16px;
              box-shadow: 0 0 0 1px rgb(255 255 255 / 0.10), 0 28px 80px rgb(0 0 0 / 0.55); }`,
    language,
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

/** Renders `html` at exactly `width`×`height` pixels into the file at `path`. */
async function render(compose: Page, html: string, width: number, height: number, path: string, transparent = false) {
  await compose.setViewportSize({ width, height });
  await compose.setContent(html);
  await compose.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => img.decode()));
  });
  await compose.screenshot({ path, omitBackground: transparent });
}

test.use({ scale: 2, network: "mainnet" });

test("the Web Store listing's images", async ({ context, koios }) => {
  for (const language of LANGUAGES) {
    expect(CAPTIONS[language], language).toHaveLength(CAPTIONS.en.length);
    mkdirSync(folder(language), { recursive: true });
  }
  for (const [unit, token] of MAINNET_TOKENS) koios.mainnetTokens.set(unit, token);
  const tab = await openApp(context);
  await restore(tab, vector(12).phrase);
  await expect(tab.getByTestId("network")).toHaveText("MAINNET");
  await expect(tab.getByTestId("seedelf-lovelace")).toHaveText("28 ₳");
  await tab.close();

  // The side panel at its default width, cut to what the listing's frame fits.
  const popup = await openApp(context, "panel");
  await popup.setViewportSize({ width: 360, height: 600 });
  /** The wallet's language, switched as Settings does: it follows the stored choice on every open page. */
  const speak = async (language: Language) => {
    await popup.evaluate(({ key, code }) => chrome.storage.local.set({ [key]: code }), { key: LOCAL_LANGUAGE, code: language });
    await expect(popup.locator("html")).toHaveAttribute("lang", language);
    // The screens redraw on i18next's change, which comes before the attribute: two frames and they're painted.
    await popup.evaluate(() => new Promise((painted) => requestAnimationFrame(() => requestAnimationFrame(painted))));
  };
  /** The screen as it is, in each language, and back in English to go on. */
  const shoot = async () => {
    const images = {} as Record<Language, Buffer>;
    for (const language of LANGUAGES) {
      await speak(language);
      images[language] = await popup.screenshot({ animations: "disabled" });
    }
    await speak("en");
    return images;
  };
  const back = () => popup.getByRole("button", { name: "Back", exact: true }).click();
  const shots: Array<Record<Language, Buffer>> = [];

  await expect(popup.getByTestId("seedelf-tokens")).toContainText("USDM");
  await expect(popup.getByTestId("test-network")).toHaveCount(0);
  await expect(popup.getByTestId("updated")).toHaveText("Updated just now");
  shots.push(await shoot());

  await popup.getByRole("button", { name: "Send privately" }).click();
  await popup.getByLabel("Seedelf name").fill(PAY_TO);
  await expect(popup.getByTestId("transfer-to-note")).toContainText("Found: Ancient Kraken");
  await popup.getByLabel("Amount", { exact: true }).fill("5");
  shots.push(await shoot());
  await back();

  await popup.getByRole("button", { name: "Create a Seedelf" }).click();
  await expect(popup.getByTestId("mint-from-note")).toBeVisible();
  await popup.getByLabel("Tag (optional, anyone can read it)").fill("alice");
  shots.push(await shoot());
  await back();

  await popup.getByRole("button", { name: "Make public" }).click();
  await popup.getByLabel("To", { exact: true }).fill(vector(12).mainnet.receive_0);
  await expect(popup.getByTestId("withdraw-own")).toContainText("This is your own public account");
  await popup.getByLabel("Amount", { exact: true }).fill("10");
  shots.push(await shoot());
  await back();

  await cardanoTab(popup);
  await expect(popup.getByTestId("cardano-lovelace")).not.toHaveText("— ₳");
  await expect(popup.getByTestId("staking-row-pool")).toHaveText("Staking with LOGIC");
  await expect(popup.getByTestId("cardano-tokens")).toContainText("DJED");
  shots.push(await shoot());

  const browser = await chromium.launch();
  try {
    const compose = await browser.newPage({ deviceScaleFactor: 1 });
    for (const [i, images] of shots.entries()) {
      for (const language of LANGUAGES) {
        const html = screenshot(images[language], CAPTIONS[language][i]!, language);
        await render(compose, html, 1280, 800, `${folder(language)}screenshot-${i + 1}.png`);
      }
    }
    await render(compose, promoTile, 440, 280, `${out}promo-small-440x280.png`);
    await render(compose, storeIcon, 128, 128, `${out}icon-128.png`, true);
  } finally {
    await browser.close();
  }
});
