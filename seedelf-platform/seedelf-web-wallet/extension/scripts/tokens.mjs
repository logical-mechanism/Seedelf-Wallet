// The wallet's own token registry: tickers, names, decimals and logos for a
// hand-kept list of fungible tokens per network (src/tokens/list.json), so the
// wallet never has to ask anyone about the tokens it holds. Run at each
// release; it reads the Cardano token registry through Koios `asset_info`.
//
//   node scripts/tokens.mjs                      write src/tokens/registry.<network>.json
//   node scripts/tokens.mjs build <network>      the same for one network
//   node scripts/tokens.mjs find <network> T...  registry entries for tickers, to curate the list
//
// Each listed unit must be in the registry under the ticker the list expects.
// Other entries claiming the same ticker are reported, never taken.
//
// A test network's token that isn't in the registry (preprod's MIN, which
// Minswap's preprod pools use) can be listed with `unregistered`: its name and
// decimals, vetted by hand, and where they come from. It's refused on mainnet,
// and a registry entry, once there is one, wins.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const dir = fileURLToPath(new URL("../src/tokens/", import.meta.url));
const KOIOS = { preprod: "https://preprod.koios.rest/api/v1", mainnet: "https://api.koios.rest/api/v1" };
/** Logos are stored at this size (square, transparent), enough for 2× screens. */
const LOGO_PX = 96;

async function koios(network, path, body) {
  const url = `${KOIOS[network]}/${path}`;
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`${url}: ${response.status} ${await response.text()}`);
  return response.json();
}

/** Registry entries on `network` whose ticker is `ticker`. */
const claims = (network, ticker) =>
  koios(network, `asset_token_registry?select=policy_id,asset_name,ticker,decimals&ticker=eq.${encodeURIComponent(ticker)}`);

/** A logo (base64 PNG from the registry) as a small square WebP data URI. */
async function shrink(page, base64) {
  return page.evaluate(
    async ({ src, px }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = px;
      const g = canvas.getContext("2d");
      g.imageSmoothingQuality = "high";
      const scale = Math.min(px / img.width, px / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      g.drawImage(img, (px - w) / 2, (px - h) / 2, w, h);
      return canvas.toDataURL("image/webp", 0.9);
    },
    { src: `data:image/png;base64,${base64}`, px: LOGO_PX },
  );
}

async function build(only) {
  const list = JSON.parse(readFileSync(`${dir}list.json`, "utf8"));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    for (const [network, tokens] of Object.entries(list)) {
      if (network.startsWith("//") || (only && network !== only)) continue;
      const info = [];
      for (let i = 0; i < tokens.length; i += 50) {
        const batch = tokens.slice(i, i + 50).map((t) => [t.policy, t.name]);
        info.push(...(await koios(network, "asset_info", { _asset_list: batch })));
      }
      const registry = {};
      for (const t of tokens) {
        const row = info.find((r) => r.policy_id === t.policy && r.asset_name === t.name);
        if (!row?.token_registry_metadata && t.unregistered) {
          if (network === "mainnet") throw new Error(`mainnet: ${t.ticker} must be in the token registry`);
          console.warn(`${network}: ${t.ticker} isn't in the token registry; using the list's (${t.unregistered.source})`);
          registry[`${t.policy}.${t.name}`] = { ticker: t.ticker, name: t.unregistered.name, decimals: t.unregistered.decimals };
          continue;
        }
        const meta = row?.token_registry_metadata;
        if (!meta) throw new Error(`${network}: ${t.ticker} (${t.policy}.${t.name}) isn't in the token registry`);
        if (meta.ticker !== t.ticker) {
          throw new Error(`${network}: ${t.policy}.${t.name} is ${meta.ticker} in the registry, not ${t.ticker}`);
        }
        const others = (await claims(network, t.ticker)).filter((c) => c.policy_id !== t.policy || c.asset_name !== t.name);
        if (others.length) {
          console.warn(`${network}: ${t.ticker} is also claimed by ${others.map((c) => c.policy_id).join(", ")}`);
        }
        registry[`${t.policy}.${t.name}`] = {
          ticker: meta.ticker,
          name: meta.name,
          decimals: meta.decimals ?? 0,
          ...(meta.logo ? { logo: await shrink(page, meta.logo) } : {}),
        };
      }
      const sorted = Object.fromEntries(Object.entries(registry).sort(([a], [b]) => a.localeCompare(b)));
      const out = `${dir}registry.${network}.json`;
      writeFileSync(out, `${JSON.stringify(sorted, null, 2)}\n`);
      const kb = Math.round(JSON.stringify(sorted).length / 1024);
      console.log(`${network}: ${tokens.length} tokens, ${kb} KB -> src/tokens/registry.${network}.json`);
    }
  } finally {
    await browser.close();
  }
}

async function find(network, tickers) {
  for (const ticker of tickers) {
    const found = await claims(network, ticker);
    if (found.length === 1) {
      const [c] = found;
      console.log(JSON.stringify({ ticker, policy: c.policy_id, name: c.asset_name }) + ",");
    } else {
      console.warn(`// ${ticker}: ${found.length} registry entries${found.length ? `: ${found.map((c) => c.policy_id).join(", ")}` : ""}`);
    }
  }
}

const [command, network, ...rest] = process.argv.slice(2);
if (command === "find") await find(network, rest);
else if (!command || command === "build") await build(network);
else throw new Error("usage: node scripts/tokens.mjs [build [network] | find <network> TICKER...]");
