// Remove's review names each token that goes with the Seedelf's ADA (chunk 51, w1b#2). The deployed policy checks only a
// Seedelf's name, so anyone can mint one beside tokens of theirs under a register of the user's, and the wallet lists it
// as the user's. Removing it moves those tokens with the ADA, to where the user sends it; the review said only the ADA
// and the fee, so the user signed for tokens it never named.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { assetFingerprint } from "../src/shared/fingerprint";
import type { RemoveSummary } from "../src/shared/rpc";
import { NetworkContext } from "../src/ui/network";
import { RemoveRows } from "../src/ui/screens/RemoveSeedelf";
import { viewToken } from "../src/ui/tokens";
import { ownedUtxos, testBalances, vectors } from "./fakes";

const hexOf = (s: string) => Buffer.from(s, "ascii").toString("hex");

/** A removal back to the public account, as WebAssembly's buildRemove gives it to the worker. */
const removal = (tokens: RemoveSummary["tokens"]): RemoveSummary => ({
  network: "preprod",
  txHash: "ab".repeat(32),
  name: `5eed0e1f${hexOf("web-wallet")}00${"ab".repeat(17)}`,
  label: "web-wallet",
  to: "account",
  lovelace: "2755846",
  tokens,
  fee: { size: "192473", compute: "34461", scriptReference: "17220", total: "244154" },
});

/** The review's rows as text: each row's label and value, in order. */
const rows = (summary: RemoveSummary) =>
  [...renderToStaticMarkup(createElement(RemoveRows, { summary })).matchAll(/<dt>(.*?)<\/dt><dd[^>]*>(.*?)<\/dd>/g)].map(
    ([, label, value]) => [label, value!.replace(/<[^>]+>/g, "")],
  );

describe("Remove's review (chunk 51, w1b#2)", () => {
  it("names each token that comes back with the ADA, under it", () => {
    const shown = rows(removal([{ policyId: "cd".repeat(28), assetName: hexOf("junk"), quantity: "100" }]));
    const back = shown.findIndex(([label]) => label === "Comes back to your public account");
    expect(back).toBeGreaterThan(-1);
    expect(shown[back]![1]).toBe("2.755846 ₳");
    // Its amount and name, with the mark an unlisted token gets everywhere.
    const [label, token] = shown[back + 1]!;
    expect(label).toBe("");
    expect(token).toMatch(/^100 junkNot on the wallet&#x27;s list, asset1/);
    expect(shown.at(-1)![0]).toBe("Network fee");
  });

  it("shows the ADA alone when nothing else sat with the Seedelf", () => {
    const shown = rows(removal([]));
    expect(shown.map(([label]) => label)).toEqual(["Seedelf", "Seedelf name", "Comes back to your public account", "Network fee"]);
  });
});

// Chunk 51, r2sign#3: a token off the wallet's list showed in raw units. WebAssembly's RemoveResult.tokens is
// {policyId, assetName, quantity}, and the review scales a token by the wallet's list, then its own decimals, then 0. The
// Seedelf's UTxO the removal spends carries Koios's decimals for it, and the UTxOs screen, and Home once it's back,
// scale it by them. Real worker, real WebAssembly, over the fake Koios: a stranger puts a Seedelf under a copy of the
// user's register beside 1,000,000 raw units of a token of theirs, FOO, which Koios reports with 6 decimals.
describe("Remove's review, a token off the wallet's list (chunk 51, r2sign#3)", () => {
  const PASSWORD = "correct horse battery";
  const phrase = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase;
  /** A token off the wallet's list (2 preprod, 32 mainnet), whose decimals Koios knows from the token registry: 6. */
  const FOO = { policyId: "f0".repeat(28), assetName: hexOf("FOO") };
  const key = (x: { policyId: string; assetName: string }) => `${x.policyId}.${x.assetName}`;
  /** The fixture's own Seedelf UTxO: its register, under the 12-word phrase's key, is on chain for anyone to copy. */
  const template = ownedUtxos[2]!;
  const SEEDELF_POLICY = template.asset_list![0]!.policy_id;
  /** The stranger's Seedelf. */
  const PLANTED = `5eed0e1f${hexOf("stranger")}00${"cd".repeat(19)}`;
  /** The review's rows on preprod, as `rows` above reads them. */
  const rowsOnPreprod = (summary: RemoveSummary) =>
    [
      ...renderToStaticMarkup(createElement(NetworkContext.Provider, { value: "preprod" }, createElement(RemoveRows, { summary }))).matchAll(
        /<dt>(.*?)<\/dt><dd[^>]*>(.*?)<\/dd>/g,
      ),
    ].map(([, label, value]) => [label, value!.replace(/<[^>]+>/g, "")]);

  it("shows it in the units the Seedelf's UTxO gives it, as the UTxOs screen does", async () => {
    const t = testBalances();
    await t.wallet.create(phrase, PASSWORD);
    t.koios.added.push({
      ...template,
      tx_hash: "e1".repeat(32),
      tx_index: 0,
      value: "3000000",
      asset_list: [
        { policy_id: SEEDELF_POLICY, asset_name: PLANTED, quantity: "1", decimals: 0, fingerprint: "" },
        { policy_id: FOO.policyId, asset_name: FOO.assetName, quantity: "1000000", decimals: 6, fingerprint: assetFingerprint(FOO) },
      ],
    });

    // The reading: the planted Seedelf is listed as the user's, its card carrying FOO with Koios's 6 decimals.
    const reading = await t.balances.get("preprod");
    const card = reading.seedelf.seedelfs.find((s) => s.assetName === PLANTED)!;
    expect(card.tokens?.map((x) => [key(x), x.quantity, x.decimals])).toEqual([[key(FOO), "1000000", 6]]);
    // The UTxOs screen's private list shows that UTxO's FOO as 1 (Utxos.tsx UtxoTokens, viewToken).
    const lists = await t.coins.lists("preprod");
    const held = lists.seedelf.find((u) => u.seedelf?.name === PLANTED)!.tokens.find((x) => key(x) === key(FOO))!;
    expect(viewToken("preprod", held).amount).toBe("1");

    // Remove it, its ADA and FOO back to the public account: the summary names FOO, with the UTxO's decimals ...
    const summary = await t.withdraw.buildRemove("preprod", PLANTED, "account");
    expect(summary.tokens.map((x) => [key(x), x.quantity, x.decimals])).toEqual([[key(FOO), "1000000", 6]]);
    // ... and the review shows the same 1 FOO coming back, not its 1,000,000 raw units.
    const shown = rowsOnPreprod(summary);
    const back = shown.findIndex(([label]) => label === "Comes back to your public account");
    expect(back).toBeGreaterThan(-1);
    const [label, token] = shown[back + 1]!;
    expect(label).toBe("");
    expect(token).toMatch(/^1 FOONot on the wallet&#x27;s list, asset1/);
  });
});
