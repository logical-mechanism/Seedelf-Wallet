// Chunk 51, l3sign#1: a site's payment from the account into Seedelf Wallet's contract under the user's own register,
// inline, its output carrying a reference script too. The window read it as a Seedelf payment ("register": the privacy
// note alone, no warning), and Transaction details tagged it "Yours, in your private balance", while the private
// balance leaves such a row out and no Seedelf Wallet spend takes it (script-spend.ts `spendable`, core's
// `eval::refusal`): only the CLI's `sweep --all` brings it back. Now WebAssembly reads it "script-ref" (cip30.rs
// `inspect`), the window warns in the UTxOs page's words in place of the Seedelf note, and Transaction details tags it
// as one Seedelf Wallet can't spend yet. Each of tests/fixtures/register-spellings.json's reference scripts, as
// wasm/tests/register_spellings_test.rs reads them; the lane's own harness (lanes/L3sign.md), as
// dapp-datum-hash.test.ts's. The window's reading needs wasm/pkg built from this change; Transaction details' tag
// reads only what decodeTx gave before it.
import { readFileSync } from "node:fs";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { spendable, unspendable } from "../src/background/script-spend";
import { txView } from "../src/background/tx-view";
import { i18n } from "../src/i18n/core";
import type { DappTxSummary, TxDetail } from "../src/shared/rpc";
import { TxDetailBody } from "../src/ui/components/TxDetail";
import { NetworkContext } from "../src/ui/network";
import { SignTx } from "../src/ui/screens/DappApprovals";
import { koiosPreprod, loadTestWasm, ownedUtxos, testBalances, vectors } from "./fakes";

/** The page's text, without its tags. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
/** `element`'s text on preprod. */
const onPreprod = (element: ReactElement) =>
  text(renderToStaticMarkup(createElement(NetworkContext.Provider, { value: "preprod" }, element)));

/** The reference scripts the register-spellings vectors put beside each spelling, as an output's key 3. */
const SCRIPTS = (
  JSON.parse(readFileSync(new URL("./fixtures/register-spellings.json", import.meta.url), "utf8")) as {
    referenceScripts: { scripts: Array<{ name: string; scriptRef: string }> };
  }
).referenceScripts.scripts;

describe("a site's payment under the user's register that carries a reference script (chunk 51, l3sign#1)", () => {
  const signer = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
  const OWN = signer.preprod.receive_0 as string;
  const INPUT = "14".repeat(32);
  /** The fixture's Seedelf UTxO of this phrase: the contract's preprod address, and the user's own register. */
  const CONTRACT = ownedUtxos[2]!.address;
  const REGISTER = (ownedUtxos[2]!.inline_datum as { bytes: string }).bytes;
  /** The register as an inline datum's `#6.24(bytes)`. */
  const WRAPPED = `d81858${(REGISTER.length / 2).toString(16).padStart(2, "0")}${REGISTER}`;

  /** The account's 10 ₳ pays the contract 4 ₳ under the user's register, `scriptRef` beside it where there is one. */
  const paying = (scriptRef?: string) => {
    const address = loadTestWasm().cip30Address(CONTRACT);
    const out = scriptRef
      ? `a400581d${address}011a003d0900028201${WRAPPED}03${scriptRef}`
      : `a300581d${address}011a003d0900028201${WRAPPED}`;
    return `84a30081825820${INPUT}000181${out}021a00029810a0f5f6`;
  };

  async function until(check: () => boolean) {
    for (let i = 0; i < 400 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
    expect(check()).toBe(true);
  }

  /** The worker's request for a site's `txCbor`, the window's words for it, and its Transaction details. */
  async function asked(txCbor: string) {
    const t = testBalances();
    await t.wallet.create(signer.phrase, "correct horse battery");
    await t.preferences.set({ dappConnector: true, dappPassword: false, spendRewards: false });
    const template = Object.values(koiosPreprod.accounts)
      .flatMap((a) => a.account_utxos)
      .find((u) => u.address === OWN)!;
    t.koios.addedToAccounts.push({ ...template, tx_hash: INPUT, tx_index: 0, value: "10000000", asset_list: [], block_height: 1 });
    const s = { id: "l3sign1", origin: "https://app.example", title: "App" };
    const enabling = t.dapp.call(s, "enable", []);
    await until(() => t.dapp.approvals().length === 1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
    expect(await enabling).toBe(true);
    const signing = t.dapp.call(s, "signTx", [txCbor, false]).catch(() => undefined);
    await until(() => t.dapp.approvals().length === 1);
    const request = t.dapp.approvals()[0]!;
    if (request.kind !== "sign-tx") throw new Error(`a sign-tx approval, not ${request.kind}`);
    const summary: DappTxSummary = request.summary;
    const window = onPreprod(createElement(SignTx, { summary, partial: false, session: false, collateralSpent: false, ties: [] }));
    // Transaction details, as the window's button opens them: the request's own bytes, while it waits.
    const deps = { wasm: t.deps.wasm, wallet: t.wallet, session: t.session };
    const waiting = (hash: string) => (hash === summary.txHash ? txCbor : undefined);
    const { detail } = await txView(deps, "preprod", summary.txHash, waiting);
    await t.dapp.answer(request.id, false);
    await signing;
    const details = onPreprod(createElement(TxDetailBody, { detail, network: "preprod", testId: "tx" }));
    return { summary, window, detail, details };
  }

  /** The row the balance reads once the output is on chain: the same output, its script beside its datum or not. */
  const row = (txHash: string, script: boolean) => ({
    ...ownedUtxos[2]!,
    tx_hash: txHash,
    tx_index: 0,
    value: "4000000",
    asset_list: [],
    reference_script: script ? { hash: "00".repeat(28), size: 5, type: "timelock", bytes: "8200820180" } : null,
  });

  it("has more than one kind of script to read", () => {
    expect(SCRIPTS.length).toBeGreaterThan(1);
  });

  it.each(SCRIPTS.map((s) => [s.name, s.scriptRef]))("beside %s: Transaction details says Seedelf Wallet can't spend it yet", async (_, scriptRef) => {
    const { detail, details } = await asked(paying(scriptRef));
    const [out] = detail.outputs as [TxDetail["outputs"][number]];
    // What decodeTx reads: the user's register, payable, and a script beside it.
    expect([out.address.seedelf, out.register?.payable, !!out.scriptRef]).toEqual([true, true, true]);
    expect.soft(out.yours).toEqual({ kind: "unspendable" });
    expect.soft(details).toContain(i18n.t("tx.yours.warn.unspendable"));
    expect.soft(details).not.toContain(i18n.t("tx.yours.private"));
    // As the balance has it once it's on chain: not in the private balance, and no spend takes it.
    const view = { owned: [row(detail.txHash, true)], seedelfs: {} };
    expect([spendable({}, view).length, unspendable({}, view).length]).toEqual([0, 1]);
  }, 60_000);

  // Needs wasm/pkg built from cip30.rs's "script-ref" reading.
  it.each(SCRIPTS.map((s) => [s.name, s.scriptRef]))("beside %s: the window warns in its place of the Seedelf note", async (_, scriptRef) => {
    const { summary, window } = await asked(paying(scriptRef));
    expect.soft(summary.paid.map((p) => [p.datum, p.script, p.seedelf])).toEqual([["inline", true, "script-ref"]]);
    expect.soft(window).toContain(i18n.t("dappUi.warn.seedelfScriptRef"));
    expect.soft(window).not.toContain(i18n.t("dappUi.privacy.paysSeedelfAccount"));
    // Signing's note never says the private balance is out of it: the register is the user's.
    expect.soft(window).not.toContain(i18n.t("dappUi.privacy.notPrivate"));
  }, 60_000);

  it("reads the same payment without a script as a Seedelf payment in the private balance, as before", async () => {
    const { summary, window, detail, details } = await asked(paying());
    expect(summary.paid.map((p) => [p.datum, p.seedelf])).toEqual([["inline", "register"]]);
    expect(window).toContain(i18n.t("dappUi.privacy.paysSeedelfAccount"));
    expect(window).not.toContain(i18n.t("dappUi.warn.seedelfScriptRef"));
    expect(detail.outputs[0]!.yours).toEqual({ kind: "private" });
    expect(details).toContain(i18n.t("tx.yours.private"));
    const view = { owned: [row(detail.txHash, false)], seedelfs: {} };
    expect([spendable({}, view).length, unspendable({}, view).length]).toEqual([1, 0]);
  }, 60_000);
});
