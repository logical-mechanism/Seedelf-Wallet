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

import { withTokenDecimals } from "../src/background/dapp";
import type { KoiosUtxo } from "../src/background/koios";
import { SESSION_BACK } from "../src/background/sessions";
import { txView } from "../src/background/tx-view";
import { SESSION_BALANCES_PREFIX } from "../src/background/wallet";
import { i18n } from "../src/i18n/core";
import { assetFingerprint } from "../src/shared/fingerprint";
import type { Balances, DappTxSummary } from "../src/shared/rpc";
import { TxDetailBody } from "../src/ui/components/TxDetail";
import { NetworkContext } from "../src/ui/network";
import { SignTx } from "../src/ui/screens/DappApprovals";
import { tokenQuantity, viewToken } from "../src/ui/tokens";
import { koiosPreprod, loadTestWasm, ownedUtxos, testBalances, vectors } from "./fakes";

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

// Chunk 51, l3sign#2: a site's transaction's window showed a token off the wallet's list in raw units, WebAssembly's
// token lists carrying no decimals, while the Transaction details it opens scaled it (e9a#2's fix): 10^6 apart for one
// of 6 decimals. Both read them now from the rows the window's reading resolved and those the device keeps
// (tx-view.ts `heldDecimals`), one map for the two, so they can't scale a token apart. Real worker, real WebAssembly,
// over the fake Koios, the site's transaction written by hand as a site would send it.
describe("the sign window and its Transaction details agree on a token's units (chunk 51, l3sign#2)", () => {
  const INPUT = "a7".repeat(32);
  const STRANGERS = "a8".repeat(32);
  /** A CBOR unsigned integer. */
  const uint = (n: bigint) => {
    const hexOf = (bytes: number) => n.toString(16).padStart(bytes * 2, "0");
    if (n < 24n) return hexOf(1);
    if (n < 256n) return `18${hexOf(1)}`;
    if (n < 65_536n) return `19${hexOf(2)}`;
    return n < 4_294_967_296n ? `1a${hexOf(4)}` : `1b${hexOf(8)}`;
  };
  /** An output to `address` (a base address) of `lovelace`, and `foo` raw units of FOO beside it. */
  const output = (address: string, lovelace: bigint, foo?: bigint) => {
    const multiasset = foo === undefined ? "" : `a1581c${FOO.policyId}a143${FOO.assetName}${uint(foo)}`;
    const value = foo === undefined ? uint(lovelace) : `82${uint(lovelace)}${multiasset}`;
    return `825839${loadTestWasm().cip30Address(address)}${value}`;
  };
  /** A site's transaction spending `inputs` (outpoints' hashes, index 0) into `outputs`, for a 0.17 ₳ fee. */
  const siteTx = (inputs: string[], outputs: string[]) => {
    const list = (items: string[]) => `${(0x80 + items.length).toString(16)}${items.join("")}`;
    return `84a300${list(inputs.map((h) => `825820${h}00`))}01${list(outputs)}021a00029810a0f5f6`;
  };
  const foo = (quantity: string) => ({
    policy_id: FOO.policyId,
    asset_name: FOO.assetName,
    quantity,
    decimals: 6,
    fingerprint: assetFingerprint(FOO),
  });

  async function until(check: () => boolean) {
    for (let i = 0; i < 400 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
    expect(check()).toBe(true);
  }

  /** The account's `held` (lovelace, FOO's raw units) read, then the site's `txCbor`: the window's and view's words. */
  type Held = { lovelace: string; foo?: string };
  async function windowAndView(held: Held, txCbor: string, partial = false, other?: KoiosUtxo) {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
    await t.preferences.set({ dappConnector: true, dappPassword: false, spendRewards: false });
    const template = Object.values(koiosPreprod.accounts)
      .flatMap((a) => a.account_utxos)
      .find((u) => u.address === OWN)!;
    const asset_list = held.foo ? [foo(held.foo)] : [];
    const input = { tx_hash: INPUT, tx_index: 0, value: held.lovelace, asset_list, block_height: 1 };
    t.koios.addedToAccounts.push({ ...template, ...input });
    if (other) t.koios.added.push(other);
    await t.balances.get("preprod");
    const s = { id: "l3sign2", origin: "https://app.example", title: "App" };
    const enabling = t.dapp.call(s, "enable", []);
    await until(() => t.dapp.approvals().length === 1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
    expect(await enabling).toBe(true);
    const signing = t.dapp.call(s, "signTx", [txCbor, partial]).catch(() => undefined);
    await until(() => t.dapp.approvals().length === 1);
    const request = t.dapp.approvals()[0]!;
    if (request.kind !== "sign-tx") throw new Error(`a sign-tx approval, not ${request.kind}`);
    const props = { summary: request.summary, partial, session: false, collateralSpent: false };
    const window = text(createElement(SignTx, props));
    // Transaction details, as the window's button opens them (handlers.ts "tx-detail"): the connector beside the view.
    const deps = { wasm: t.deps.wasm, wallet: t.wallet, session: t.session, dapp: t.dapp };
    const { detail } = await txView(deps, "preprod", request.summary.txHash, (h) => t.dapp.waitingCbor(h));
    const view = text(createElement(TxDetailBody, { detail, network: "preprod", testId: "tx" }));
    await t.dapp.answer(request.id, false);
    await signing;
    return { summary: request.summary, window, view };
  }

  it("scales a token the account holds, as Home and its view do", async () => {
    // 5 ₳ and 100 FOO; the site pays someone 2 ₳ and 1.5 FOO, the rest back to the account.
    const tx = siteTx([INPUT], [output(THEIRS, 2_000_000n, 1_500_000n), output(OWN, 2_830_000n, 98_500_000n)]);
    const { summary, window, view } = await windowAndView({ lovelace: "5000000", foo: "100000000" }, tx);
    expect(summary.netTokens.map((x) => [key(x), x.quantity])).toEqual([[key(FOO), "-1500000"]]);
    expect(window).toContain(`${i18n.t("dappUi.sends")} 1.5 FOO`);
    expect(window).toMatch(/(?<![\d,.])2 ₳ 1\.5 FOO/);
    expect(window).not.toContain("1,500,000");
    expect(view).toContain("1.5 FOO");
    expect(view).toContain("98.5 FOO");
    expect(view).not.toContain("1,500,000");
  }, 60_000);

  it("scales one only the request's own rows know, a stranger's input, in both", async () => {
    // The account holds no FOO (7 ₳, never its 5 ₳ collateral): only the stranger's UTxO the site spends beside the
    // account's says its decimals.
    const strangers = {
      ...ownedUtxos[0]!,
      address: THEIRS,
      tx_hash: STRANGERS,
      tx_index: 0,
      value: "2000000",
      asset_list: [foo("1000000")],
      inline_datum: null,
    } as KoiosUtxo;
    const tx = siteTx([INPUT, STRANGERS], [output(THEIRS, 2_000_000n, 1_000_000n), output(OWN, 6_830_000n)]);
    const { summary, window, view } = await windowAndView({ lovelace: "7000000" }, tx, true, strangers);
    expect(summary.paid.flatMap((p) => p.tokens).map((x) => [key(x), x.quantity])).toEqual([[key(FOO), "1000000"]]);
    expect(window).toMatch(/(?<![\d,.])1 FOO/);
    expect(window).not.toContain("1,000,000 FOO");
    expect(view).toMatch(/(?<![\d,.])1 FOO/);
    expect(view).not.toContain("1,000,000 FOO");
  }, 60_000);

  it("gives every list the window shows or counts the units, and leaves a token nothing knows as it was", () => {
    const BAR = { policyId: "b0".repeat(28), assetName: Buffer.from("BAR").toString("hex") };
    const tokens = [{ ...FOO, quantity: "1000000" }, { ...BAR, quantity: "5" }];
    const paid = { address: THEIRS, lovelace: "2000000", tokens, datum: null, script: false, seedelf: null };
    const own = { txIndex: 1, address: OWN, role: 0, index: 0, lovelace: "1000000", tokens, inlineDatum: null };
    const summary = {
      ...({} as DappTxSummary),
      netTokens: tokens,
      paid: [{ ...paid, ownPaymentKey: false }],
      ownOutputs: [{ ...own, datumHash: null }],
      mint: tokens,
      contractTokens: tokens,
      releasedTokens: tokens,
    };
    const shown = withTokenDecimals(summary, new Map([[key(FOO), 6]]));
    const lists = [shown.netTokens, shown.paid[0]!.tokens, shown.ownOutputs[0]!.tokens, shown.mint];
    for (const list of [...lists, shown.contractTokens!, shown.releasedTokens!]) {
      expect(list.map((x) => [key(x), x.decimals])).toEqual([[key(FOO), 6], [key(BAR), undefined]]);
    }
    expect(withTokenDecimals(summary, new Map())).toBe(summary);
  });
});

// Chunk 51, l3still#5's class: a review whose own summary gives a token its decimals from the rows it was built from
// (Remove's, e4d97bea; a session's return's, once sessions.ts gives them) opened Transaction details that read only the
// device's rows, which hold no session's account: the view showed the token in raw units under a review that scaled
// it. The view takes what the record it found the bytes in carries too.
describe("Transaction details take the decimals the review it's under carries (chunk 51, l3still#5's class)", () => {
  it("scales a token the record carries, though no row the device keeps knows it", async () => {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
    const wasm = loadTestWasm();
    // A session's return as sessions.ts keeps it for Send: its bytes pay 1,000,000 raw units of FOO to the account, and
    // its summary's tokens carry Koios's 6 decimals for it.
    const value = `821a001e8480a1581c${FOO.policyId}a143${FOO.assetName}1a000f4240`;
    const cbor = `84a30081825820${"b1".repeat(32)}000181825839${wasm.cip30Address(OWN)}${value}021a00029810a0f5f6`;
    const txHash = "b2".repeat(32);
    const tokens = [{ ...FOO, quantity: "1000000", decimals: 6 }];
    await t.wallet.withKeys(() => t.session.set(SESSION_BACK, { network: "preprod", index: 0, txHash, txCbor: cbor, tokens }));
    const { detail } = await txView({ wasm: t.deps.wasm, wallet: t.wallet, session: t.session }, "preprod", txHash);
    const page = text(createElement(TxDetailBody, { detail, network: "preprod", testId: "tx" }));
    expect(page).toMatch(/(?<![\d,.])1 FOO/);
    expect(page).not.toContain("1,000,000 FOO");
  });
});
