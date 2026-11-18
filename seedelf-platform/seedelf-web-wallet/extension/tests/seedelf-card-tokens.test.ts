// A Seedelf's card names the other tokens its UTxO holds, which Remove moves with it: anyone can mint a Seedelf beside
// tokens of theirs, under a copy of the user's register, and the card said only the ADA locked with it (chunk 51,
// w1b#2's card; Remove's review names them since its WebAssembly fix). The reading is the real worker's, over the fake
// Koios; the card is Receive's.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { KoiosUtxo } from "../src/background/koios";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import type { SeedelfInfo } from "../src/shared/rpc";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import { ReceiveSeedelf } from "../src/ui/screens/Receive";
import { ownedUtxos, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const v = vectors("cardano_account.json").find((x) => x.account === 0 && x.phrase.split(" ").length === 12)!;
const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");
const noop = () => undefined;

const card = (seedelfs: SeedelfInfo[]) =>
  renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: "preprod" },
      createElement(
        PreferencesContext.Provider,
        { value: { prefs: DEFAULT_PREFERENCES, loaded: true, set: async () => undefined } },
        createElement(ReceiveSeedelf, { seedelfs, onBack: noop, onCreate: noop, onRemove: noop }),
      ),
    ),
  ).replace(/ /g, " ");

describe("a Seedelf's card (chunk 51, w1b#2's card)", () => {
  it("says what other tokens are locked with it, which come back when it's removed", async () => {
    const t = testBalances();
    await t.wallet.create(v.phrase, PASSWORD);
    // A second Seedelf under the user's register, as anyone can mint one, with 1,000 of a token of theirs beside it.
    const recorded = ownedUtxos[2]!;
    const name = recorded.asset_list![0]!.asset_name;
    const theirs = `${name.slice(0, -2)}${name.endsWith("ff") ? "fe" : "ff"}`;
    const junk = { policy_id: "f0".repeat(28), asset_name: hex("JUNK"), quantity: "1000", decimals: 0, fingerprint: "asset1junk" };
    const planted: KoiosUtxo = { ...recorded, tx_hash: "fe".repeat(32), tx_index: 0, asset_list: [{ ...recorded.asset_list![0]!, asset_name: theirs }, junk] };
    t.koios.added.push(planted);

    const { seedelf } = await t.balances.get("preprod");
    const own = seedelf.seedelfs.find((s) => s.assetName === name)!;
    const gift = seedelf.seedelfs.find((s) => s.assetName === theirs)!;
    // Its other tokens, the Seedelf itself not among them; the one with none has no list.
    expect(gift.tokens).toEqual([{ policyId: junk.policy_id, assetName: junk.asset_name, quantity: "1000", decimals: 0, fingerprint: "asset1junk" }]);
    expect(own.tokens).toBeUndefined();
    // They're never the private balance's: only removing it spends that UTxO.
    expect(seedelf.tokens.some((x) => x.policyId === junk.policy_id)).toBe(false);

    const page = card([own, gift]);
    expect(page).toContain(`data-testid="seedelf-about-${theirs}"`);
    const about = (assetName: string) => page.match(new RegExp(`data-testid="seedelf-about-${assetName}">(.*?)</p>`))![1]!;
    expect(about(theirs)).toContain("₳ and 1 token locked with it, back when you remove it");
    expect(about(name)).toContain("₳ locked with it, back when you remove it");
    expect(about(name)).not.toContain("token");
  });
});
