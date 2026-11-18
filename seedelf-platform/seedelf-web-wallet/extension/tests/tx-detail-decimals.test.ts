// Transaction details scale a token by the decimals the balance reading has for
// it, as the review above them and Home do (chunk 51, e9a#2, its verifier's test,
// moved here): a token off the wallet's list showed in raw units there, while
// Home and the review scaled it by Koios's decimals. Real worker, real
// WebAssembly, over the fake Koios: the account holds 100 FOO (6 decimals,
// Koios's), sends 1.5 FOO publicly, and opens Transaction details under that
// review.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { txView } from "../src/background/tx-view";
import { SESSION_BALANCES_PREFIX } from "../src/background/wallet";
import { assetFingerprint } from "../src/shared/fingerprint";
import type { Balances } from "../src/shared/rpc";
import { TxDetailBody } from "../src/ui/components/TxDetail";
import { NetworkContext } from "../src/ui/network";
import { tokenQuantity, viewToken } from "../src/ui/tokens";
import { koiosPreprod, ownedUtxos, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
const OWN = account(12).preprod.receive_0 as string;
const THEIRS = account(15).preprod.receive_0 as string;

/** A token off the wallet's list (2 preprod, 32 mainnet), whose decimals Koios knows from the token registry: 6. */
const FOO = { policyId: "f0".repeat(28), assetName: Buffer.from("FOO").toString("hex") };
const key = (x: { policyId: string; assetName: string }) => `${x.policyId}.${x.assetName}`;

/** A page's text, as a person reads it (tx-view-screen.test.ts's). */
function text(element: ReactElement): string {
  return renderToStaticMarkup(createElement(NetworkContext.Provider, { value: "preprod" }, element))
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

describe("Transaction details and the review above them agree on a token's units (chunk 51, e9a#2)", () => {
  it("shows an unlisted token with Koios's decimals as Home and the review do", async () => {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
    const template = Object.values(koiosPreprod.accounts)
      .flatMap((a) => a.account_utxos)
      .find((u) => u.address === OWN)!;
    t.koios.addedToAccounts.push({
      ...template,
      tx_hash: "f1".repeat(32),
      tx_index: 0,
      value: "5000000",
      asset_list: [
        { policy_id: FOO.policyId, asset_name: FOO.assetName, quantity: "100000000", decimals: 6, fingerprint: assetFingerprint(FOO) },
      ],
      block_height: 1,
    });

    // Home: the reading carries Koios's decimals, and the token list shows 100 FOO (Tokens.tsx, viewToken).
    const reading = await t.balances.get("preprod");
    const held = reading.cardano.tokens.find((x) => key(x) === key(FOO))!;
    expect(held.decimals).toBe(6);
    expect(viewToken("preprod", held).amount).toBe("100");

    // Send publicly, 1.5 FOO: the review's row reads "1.5 FOO", as CardanoSend.tsx:183-191 builds it.
    const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "0", tokens: [{ ...FOO, quantity: "1500000" }] }]);
    const tk = summary.payments[0]!.tokens.find((x) => key(x) === key(FOO))!;
    expect(tokenQuantity("preprod", { ...held, ...tk })).toBe("1.5");

    // Transaction details under that review: what the worker answers "tx-detail" with (handlers.ts), as the modal shows it.
    const { detail } = await txView({ wasm: t.deps.wasm, wallet: t.wallet, session: t.session }, "preprod", summary.txHash);
    const paid = detail.outputs.find((o) => o.address.bech32 === THEIRS)!;
    expect(paid.assets.find((a) => key(a) === key(FOO))?.quantity).toBe("1500000");
    const page = text(createElement(TxDetailBody, { detail, network: "preprod", testId: "tx" }));

    // The same 1.5 FOO the review shows, and the change's 98.5 FOO, not their raw units.
    expect(page).toContain("1.5 FOO");
    expect(page).toContain("98.5 FOO");
    expect(page).not.toContain("1,500,000 FOO");
  });
});

// Chunk 51, r2sign#3's sibling: the view took a token's decimals from the reading's two side totals alone, and a
// Seedelf's UTxO is in neither (balances.ts spendableOwned), so Remove's Transaction details showed what sat with it in
// raw units, as its review did before r2sign#3's fix. It reads them from the rows the wallet's transactions are built
// from, as the device keeps them, as balances.ts reads them for what's on its way. Real worker, real WebAssembly, over
// the fake Koios: a stranger puts a Seedelf under a copy of the user's register beside 1,000,000 raw units of FOO,
// which Koios reports with 6 decimals (remove-review.test.ts's), and the user removes it.
describe("Transaction details under Remove's review, a token off the wallet's list (chunk 51, r2sign#3)", () => {
  const hexOf = (s: string) => Buffer.from(s, "ascii").toString("hex");
  /** The fixture's own Seedelf UTxO: its register, under the 12-word phrase's key, is on chain for anyone to copy. */
  const template = ownedUtxos[2]!;
  const SEEDELF_POLICY = template.asset_list![0]!.policy_id;
  /** The stranger's Seedelf. */
  const PLANTED = `5eed0e1f${hexOf("stranger")}00${"cd".repeat(19)}`;

  it("shows it in the units the Seedelf's UTxO gives it, as the review above does", async () => {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
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
    // The reading lists the planted Seedelf as the user's; FOO is in no side's totals.
    const reading = await t.balances.get("preprod");
    expect(reading.seedelf.seedelfs.some((s) => s.assetName === PLANTED)).toBe(true);
    expect([...reading.seedelf.tokens, ...reading.cardano.tokens].some((x) => key(x) === key(FOO))).toBe(false);

    // Remove it, its ADA and FOO back to the public account: the review scales FOO by the UTxO's decimals.
    const summary = await t.withdraw.buildRemove("preprod", PLANTED, "account");
    expect(summary.tokens.map((x) => [key(x), x.quantity, x.decimals])).toEqual([[key(FOO), "1000000", 6]]);

    // Transaction details under that review: the same 1 FOO comes back, not its 1,000,000 raw units.
    const { detail } = await txView({ wasm: t.deps.wasm, wallet: t.wallet, session: t.session }, "preprod", summary.txHash);
    const back = detail.outputs.find((o) => o.assets.some((a) => key(a) === key(FOO)))!;
    expect(back.assets.find((a) => key(a) === key(FOO))?.quantity).toBe("1000000");
    const page = text(createElement(TxDetailBody, { detail, network: "preprod", testId: "tx" }));
    expect(page).toMatch(/(?<![\d,.])1 FOO/);
    expect(page).not.toContain("1,000,000 FOO");
  });

  it("reads the account's rows too, where the reading's totals no longer list a token", async () => {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
    const template = Object.values(koiosPreprod.accounts)
      .flatMap((a) => a.account_utxos)
      .find((u) => u.address === OWN)!;
    t.koios.addedToAccounts.push({
      ...template,
      tx_hash: "f1".repeat(32),
      tx_index: 0,
      value: "5000000",
      asset_list: [
        { policy_id: FOO.policyId, asset_name: FOO.assetName, quantity: "100000000", decimals: 6, fingerprint: assetFingerprint(FOO) },
      ],
      block_height: 1,
    });
    await t.balances.get("preprod");
    const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "0", tokens: [{ ...FOO, quantity: "1500000" }] }]);
    // The kept reading's totals without FOO, as when the coin holding it is spent since (balances.ts lessSpent), while
    // the account's rows the device keeps still hold it.
    const reading = (await t.session.get<Balances>(`${SESSION_BALANCES_PREFIX}preprod`))!;
    await t.session.set(`${SESSION_BALANCES_PREFIX}preprod`, { ...reading, cardano: { ...reading.cardano, tokens: [] } });

    const { detail } = await txView({ wasm: t.deps.wasm, wallet: t.wallet, session: t.session }, "preprod", summary.txHash);
    const page = text(createElement(TxDetailBody, { detail, network: "preprod", testId: "tx" }));
    expect(page).toContain("1.5 FOO");
    expect(page).not.toContain("1,500,000 FOO");
  });
});
