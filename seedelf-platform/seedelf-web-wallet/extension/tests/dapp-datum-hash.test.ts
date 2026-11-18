// Chunk 51, r2sign#1: a site's payment into Seedelf Wallet's contract that keeps its datum by hash, the user's own
// register under it. No Seedelf Wallet reads a payment's register from anywhere but its inline datum (the contract
// scan, the CLI), so none ever finds or spends it, and where the body has no script data hash the ledger takes the
// transaction without the datum: the site may keep it. The window called it a Seedelf payment, carried in the witness
// set, with no warning (1.9.1 warned), and Transaction details marked it the user's. Through the real worker and
// WebAssembly, as the window gets the request: G3's reading (81516188: cip30.rs `inspect` reads it "hash", decode.rs
// a register from the inline datum alone), so this file needs wasm/pkg built from that commit or later.
import { blake2b } from "@noble/hashes/blake2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

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

describe("a site's payment into Seedelf Wallet's contract under a datum kept by hash (chunk 51, r2sign#1)", () => {
  const signer = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
  const OWN = signer.preprod.receive_0 as string;
  const INPUT = "12".repeat(32);
  /** The fixture's Seedelf UTxO of this phrase: the contract's preprod address, and the user's own register. */
  const CONTRACT = ownedUtxos[2]!.address;
  const REGISTER = (ownedUtxos[2]!.inline_datum as { bytes: string }).bytes;
  const HASH = bytesToHex(blake2b(Buffer.from(REGISTER, "hex"), { dkLen: 32 }));
  /** The register as a CBOR byte string of 24 to 255 bytes: an inline datum's `#6.24(bytes)`. */
  const WRAPPED = `d81858${(REGISTER.length / 2).toString(16).padStart(2, "0")}${REGISTER}`;

  /** The account's 10 ₳ pays the contract 4 ₳ in `output` (its CBOR, given the address), `witness` beside. */
  const paying = (output: (address: string) => string, witness = "a0") => {
    const out = output(loadTestWasm().cip30Address(CONTRACT));
    return `84a30081825820${INPUT}000181${out}021a00029810${witness}f5f6`;
  };
  /** Under the register's hash, the register carried in the witness set if `carried`. */
  const byHash = (carried: boolean) =>
    paying((address) => `83581d${address}1a003d09005820${HASH}`, carried ? `a10481${REGISTER}` : "a0");
  /** The same register written inline. */
  const inline = () => paying((address) => `a300581d${address}011a003d0900028201${WRAPPED}`);

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
    const input = { tx_hash: INPUT, tx_index: 0, value: "10000000", asset_list: [], block_height: 1 };
    t.koios.addedToAccounts.push({ ...template, ...input });
    const s = { id: "r2sign1", origin: "https://app.example", title: "App" };
    const enabling = t.dapp.call(s, "enable", []);
    await until(() => t.dapp.approvals().length === 1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
    expect(await enabling).toBe(true);
    const signing = t.dapp.call(s, "signTx", [txCbor, false]).catch(() => undefined);
    await until(() => t.dapp.approvals().length === 1);
    const request = t.dapp.approvals()[0]!;
    if (request.kind !== "sign-tx") throw new Error(`a sign-tx approval, not ${request.kind}`);
    const summary: DappTxSummary = request.summary;
    const props = { summary, partial: false, session: false, collateralSpent: false, ties: [] };
    const window = onPreprod(createElement(SignTx, props));
    // Transaction details, as the window's button opens them: the request's own bytes, while it waits.
    const deps = { wasm: t.deps.wasm, wallet: t.wallet, session: t.session };
    const waiting = (hash: string) => (hash === summary.txHash ? txCbor : undefined);
    const { detail } = await txView(deps, "preprod", summary.txHash, waiting);
    await t.dapp.answer(request.id, false);
    await signing;
    const details = onPreprod(createElement(TxDetailBody, { detail, network: "preprod", testId: "tx" }));
    return { summary, window, detail, details };
  }

  it.each([true, false])("warns no Seedelf Wallet finds it, never calls it a Seedelf's (carried: %s)", async (carried) => {
    const { summary, window, detail, details } = await asked(byHash(carried));
    // The window's reading: kept by hash, neither a register nor anyone's.
    expect(summary.paid.map((p) => [p.datum, p.script, p.seedelf])).toEqual([["hash", true, "hash"]]);
    expect(window).toContain(i18n.t("dappUi.warn.datumByHash"));
    expect(window).not.toContain(i18n.t("dappUi.privacy.paysSeedelfAccount"));
    expect(window).not.toContain(i18n.t("dappUi.warn.noRegister"));
    // Signing's note: the private balance isn't in it, as no Seedelf Wallet would ever find this payment.
    expect(window).toContain(i18n.t("dappUi.privacy.notPrivate"));

    // Transaction details: no register read from the witness set, not the user's, and the same warning.
    const [paid] = detail.outputs as [TxDetail["outputs"][number]];
    expect([paid.address.seedelf, paid.datumHash, paid.register, paid.yours]).toEqual([true, HASH, null, undefined]);
    expect(details).toContain(`${i18n.t("tx.out.datumByHash")} · ${i18n.t("tx.out.warn.seedelfByHash")}`);
  }, 60_000);

  it("reads the same register written inline as the user's own Seedelf payment, as before", async () => {
    const { summary, window, detail } = await asked(inline());
    expect(summary.paid.map((p) => [p.datum, p.seedelf])).toEqual([["inline", "register"]]);
    expect(window).toContain(i18n.t("dappUi.privacy.paysSeedelfAccount"));
    expect(window).not.toContain(i18n.t("dappUi.warn.datumByHash"));
    expect(detail.outputs[0]!.register?.payable).toBe(true);
    expect(detail.outputs[0]!.yours).toEqual({ kind: "private" });
  }, 60_000);
});
