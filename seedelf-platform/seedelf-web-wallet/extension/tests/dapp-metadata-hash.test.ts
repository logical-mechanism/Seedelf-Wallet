// Chunk 51, G5's notes (2): the sign window read a transaction's CIP-20 note straight from its auxiliary data and never
// checked it against the hash in the body, which is what the signature commits to. A site could show one note while
// the body commits to other metadata, then send the signed transaction with that instead, and with a hash in the body
// and no metadata at all the window said nothing. Transaction details, in the same window, compares them and warns
// (`tx.warn.metadataHash`). The worker now reads `metadataHashMatches` from the same decode (dapp.ts `readTx`), made
// whatever the transaction carries, and the window warns in a line of its own. Through the real worker and
// WebAssembly, as the window gets the request.
import { blake2b } from "@noble/hashes/blake2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { i18n } from "../src/i18n/core";
import { NetworkContext } from "../src/ui/network";
import { SignTx } from "../src/ui/screens/DappApprovals";
import { koiosPreprod, loadTestWasm, testBalances, vectors } from "./fakes";

const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");
/** The page's text, without its tags. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("a site's transaction whose metadata isn't what its body commits to (chunk 51, G5's notes)", () => {
  const signer = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
  const OWN = signer.preprod.receive_0 as string;
  const SITE = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 15)!.preprod
    .receive_0 as string;
  const INPUT = "13".repeat(32);
  /** A CBOR text string of fewer than 256 bytes. */
  const cborText = (s: string) => {
    const n = Buffer.byteLength(s, "utf8");
    return `${n < 24 ? (0x60 + n).toString(16) : `78${n.toString(16).padStart(2, "0")}`}${hex(s)}`;
  };
  /** CIP-20's message: 674 → {"msg": [line]}, as a one-entry metadata map. */
  const noteOf = (line: string) => `a11902a2a1${cborText("msg")}81${cborText(line)}`;
  const SHOWN = noteOf("Thanks for order 77");
  const COMMITTED = noteOf("I agree to pay 500 ADA");
  const digest = (metadata: string) => bytesToHex(blake2b(Buffer.from(metadata, "hex"), { dkLen: 32 }));

  /**
   * A site's transaction: the account's 10 ₳ pays it 4 ₳. Its body commits to `committed` (its hash, key 7), none
   * without; it carries `carried` as its auxiliary data, none (null) without.
   */
  const tx = ({ committed, carried }: { committed?: string; carried?: string }) => {
    const wasm = loadTestWasm();
    const fields = `0081825820${INPUT}00018182${`5839${wasm.cip30Address(SITE)}`}1a003d0900021a00029810`;
    const body = committed === undefined ? `a3${fields}` : `a4${fields}075820${digest(committed)}`;
    return `84${body}a0f5${carried ?? "f6"}`;
  };

  async function until(check: () => boolean) {
    for (let i = 0; i < 400 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
    expect(check()).toBe(true);
  }

  /** The worker's request for a site's `txCbor`, and the window's words for it. */
  async function signWindow(txCbor: string) {
    const t = testBalances();
    await t.wallet.create(signer.phrase, "correct horse battery");
    await t.preferences.set({ dappConnector: true, dappPassword: false, spendRewards: false });
    const template = Object.values(koiosPreprod.accounts)
      .flatMap((a) => a.account_utxos)
      .find((u) => u.address === OWN)!;
    t.koios.addedToAccounts.push({ ...template, tx_hash: INPUT, tx_index: 0, value: "10000000", asset_list: [], block_height: 1 });
    const s = { id: "g5-notes", origin: "https://app.example", title: "App" };
    const enabling = t.dapp.call(s, "enable", []);
    await until(() => t.dapp.approvals().length === 1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
    expect(await enabling).toBe(true);
    const signing = t.dapp.call(s, "signTx", [txCbor, false]).catch(() => undefined);
    await until(() => t.dapp.approvals().length === 1);
    const asked = t.dapp.approvals()[0]!;
    if (asked.kind !== "sign-tx") throw new Error(`a sign-tx approval, not ${asked.kind}`);
    await t.dapp.answer(asked.id, false);
    await signing;
    const page = text(
      renderToStaticMarkup(
        createElement(
          NetworkContext.Provider,
          { value: "preprod" },
          createElement(SignTx, { summary: asked.summary, partial: false, session: false, collateralSpent: false }),
        ),
      ),
    );
    return { summary: asked.summary, page };
  }
  const WARNING = () => i18n.t("dappUi.warn.metadataHash");

  it.each([
    ["shows one note while its body commits to another", { committed: COMMITTED, carried: SHOWN }],
    ["commits to metadata it doesn't carry at all", { committed: COMMITTED }],
    ["carries a note its body commits to nothing of", { carried: SHOWN }],
  ])("warns when it %s", async (_, made) => {
    const { summary, page } = await signWindow(tx(made));
    expect.soft(summary.metadataMismatch).toBe(true);
    expect.soft(page).toContain(WARNING());
  }, 60_000);

  it("says nothing of it where the body commits to just what it carries, or to nothing and carries nothing", async () => {
    for (const made of [{ committed: SHOWN, carried: SHOWN }, {}]) {
      const { summary, page } = await signWindow(tx(made));
      expect(summary.metadataMismatch, JSON.stringify(made)).toBeUndefined();
      expect(page, JSON.stringify(made)).not.toContain(WARNING());
    }
  }, 60_000);
});
