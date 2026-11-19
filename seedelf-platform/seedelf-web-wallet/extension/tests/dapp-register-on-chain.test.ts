// Chunk 51, x1a#2: a site's transaction pays the public account's money into Seedelf Wallet's contract under a register
// the site wrote. The window said "It pays a Seedelf. Nothing on chain says whose, …" for every payable register, but
// the register is the site's to write: one copied as found (d = 1, the root README's "bad d value") is the datum beside
// a Seedelf's token, or beside one of the wallet's own UTxOs, so anyone can see whose Seedelf it pays, and for the
// user's own that ties it to the public account. The owner's call (B5 = a): the window never claims whose stays hidden,
// and where the kept contract view, asking nobody, holds that same register, a short warning says anyone can see whose
// Seedelf it pays. Matched by the register's points as read, whatever the spelling (chain.ts `registerKey`). The
// verifier's test (verify/x1a-2.md, at 009c4ab4), restored and widened. Through the real worker and WebAssembly, as the
// window gets the request.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CONTRACT_V1 } from "../src/background/balances";
import { registerOf } from "../src/background/chain";
import { keptContractView } from "../src/background/contract-scan";
import type { DappSession } from "../src/background/dapp";
import type { KoiosUtxo } from "../src/background/koios";
import { i18n } from "../src/i18n/core";
import type { DappApproval } from "../src/shared/rpc";
import { SignTx } from "../src/ui/screens/DappApprovals";
import { koiosPreprod, ownedUtxos, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const ACCOUNT = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
/** The account's receive address 0/0. */
const OWN = ACCOUNT.preprod.receive_0 as string;
/** A pure 100 ₳ UTxO of the account's at 0/0, which the site's transaction spends. */
const FUNDS = { tx_hash: "c1".repeat(32), tx_index: 0, lovelace: 100_000_000n };
const PAID = 25_000_000n;
const FEE = 170_000n;
const OLD_CLAIM = "Nothing on chain says whose";

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}

/** A CBOR byte string of 24 to 255 bytes. */
const bytesOf = (hex: string) => `58${(hex.length / 2).toString(16).padStart(2, "0")}${hex}`;
const coin = (n: bigint) => (n < 0x100000000n ? `1a${n.toString(16).padStart(8, "0")}` : `1b${n.toString(16).padStart(16, "0")}`);

/** Seedelf Wallet's contract on preprod, as seedelf-core's `wallet_contract` builds it: its script hash, no staking part. */
const CONTRACT = `70${CONTRACT_V1.walletContractHash}`;

/**
 * A site's transaction: it spends FUNDS, pays 25 ₳ into the contract under the inline datum `datum` (CBOR, hex), and
 * the rest less its 0.17 ₳ fee back to `change` (CIP-30 hex). The wallet only reads it.
 */
function paysContract(datum: string, change: string) {
  const inputs = `81825820${FUNDS.tx_hash}00`;
  const toContract = `a300${bytesOf(CONTRACT)}01${coin(PAID)}028201d818${bytesOf(datum)}`;
  const back = `82${bytesOf(change)}${coin(FUNDS.lovelace - PAID - FEE)}`;
  return `84a300${inputs}0182${toContract}${back}02${coin(FEE)}a0f5f6`;
}

/** The Seedelf token a contract row holds, if it holds one. */
const seedelfOf = (u: KoiosUtxo) => (u.asset_list ?? []).find((a) => a.policy_id === CONTRACT_V1.seedelfPolicyId)?.asset_name;
/** A row's register written in constructor 0's general form, `102([0, [g, u]])`, which the node reads alike. */
const generalForm = (row: KoiosUtxo) => {
  const r = registerOf(row)!;
  return `d866820082${bytesOf(r.generator)}${bytesOf(r.publicValue)}`;
};
/** A register no row on chain has: seedelf-crypto's test vector (tests/fixtures/register-spellings.json). */
const FRESH = (() => {
  const f = JSON.parse(readFileSync(new URL("./fixtures/register-spellings.json", import.meta.url), "utf8")) as {
    generator: string;
    publicValue: string;
  };
  return `d8799f${bytesOf(f.generator)}${bytesOf(f.publicValue)}ff`;
})();

/** The worker's sign-tx request for a site's `txCbor`, declined once read, and the window's text for it. */
async function asked(t: ReturnType<typeof testBalances>, s: DappSession, txCbor: string) {
  const signing = t.dapp.call(s, "signTx", [txCbor, false]);
  await until(() => t.dapp.approvals().length === 1);
  const approval = t.dapp.approvals()[0]! as Extract<DappApproval, { kind: "sign-tx" }>;
  await t.dapp.answer(approval.id, false);
  await expect(signing).rejects.toMatchObject({ failure: { info: "The user declined." } });
  const { summary, ties, staked, certified } = approval;
  const page = renderToStaticMarkup(
    createElement(SignTx, { summary, partial: false, session: false, collateralSpent: false, ties, staked, certified }),
  )
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
  return { summary, page };
}

/** A wallet with its connector on, a site connected to the public account, and the 100 ₳ the site's transaction spends. */
async function connected() {
  const t = testBalances();
  await t.wallet.create(ACCOUNT.phrase as string, PASSWORD);
  await t.preferences.set({ dappConnector: true, spendRewards: false });
  const template = Object.values(koiosPreprod.accounts)
    .flatMap((a) => a.account_utxos)
    .find((u) => u.address === OWN)!;
  t.koios.addedToAccounts.push({
    ...template,
    tx_hash: FUNDS.tx_hash,
    tx_index: FUNDS.tx_index,
    value: FUNDS.lovelace.toString(),
    asset_list: [],
    block_height: 1,
  });
  const s: DappSession = { id: "x1a-2", origin: "https://pay.example", title: "Pay a Seedelf" };
  const enabling = t.dapp.call(s, "enable", []);
  await until(() => t.dapp.approvals().length === 1);
  await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
  expect(await enabling).toBe(true);
  return { t, s };
}

describe("a site's payment into a Seedelf under a register already on chain (chunk 51, x1a#2)", () => {
  // Someone's Seedelf (a real preprod one), the wallet's own, and one of the wallet's own private UTxOs.
  const theirs = koiosPreprod.contract_utxos.find((u) => seedelfOf(u) && u.inline_datum)!;
  const ours = ownedUtxos.find((u) => seedelfOf(u) && u.inline_datum)!;
  const ourRow = ownedUtxos.find((u) => !seedelfOf(u) && u.inline_datum)!;

  it("warns anyone can see whose Seedelf it pays where the kept view holds that register, never says whose stays hidden", { timeout: 60_000 }, async () => {
    const { t, s } = await connected();
    // A balance reading, as Home makes after an unlock: it reads the contract and keeps where each Seedelf is.
    await t.balances.get("preprod");
    expect((await t.coins.lists("preprod")).cardano.some((u) => u.txHash === FUNDS.tx_hash)).toBe(true);
    const view = await keptContractView(t.session, "preprod");
    expect(view?.seedelfs[seedelfOf(theirs)!]?.inline_datum?.bytes).toBe(theirs.inline_datum!.bytes);
    expect(view?.owned.some((u) => u.inline_datum?.bytes === ourRow.inline_datum!.bytes)).toBe(true);
    const change = t.deps.wasm.cip30Address(OWN);

    for (const [who, datum] of [
      ["someone's Seedelf, as found", theirs.inline_datum!.bytes],
      ["the wallet's own Seedelf, as found", ours.inline_datum!.bytes],
      ["one of the wallet's own private UTxOs, as found", ourRow.inline_datum!.bytes],
      // The same register as someone's Seedelf, spelled another way the node reads alike: the points match.
      ["someone's Seedelf, re-spelled", generalForm(theirs)],
    ] as const) {
      const { summary, page } = await asked(t, s, paysContract(datum, change));
      // The window was opened for it: 25 ₳ into the contract under a register only its key's holder can spend.
      expect(summary.paid.map((p) => [p.lovelace, p.datum, p.seedelf]), who).toEqual([["25000000", "inline", "register"]]);
      expect.soft(summary.registerOnChain, who).toBe(true);
      expect.soft(page, who).toContain(i18n.t("dappUi.warn.registerOnChain"));
      expect.soft(page, who).not.toContain(OLD_CLAIM);
      expect.soft(page, who).toContain(i18n.t("dappUi.privacy.paysSeedelfAccount"));
    }
  });

  it("adds no warning for a register no row in the kept view has, and still never says whose stays hidden", { timeout: 60_000 }, async () => {
    const { t, s } = await connected();
    await t.balances.get("preprod");
    const { summary, page } = await asked(t, s, paysContract(FRESH, t.deps.wasm.cip30Address(OWN)));
    expect(summary.paid.map((p) => p.seedelf)).toEqual(["register"]);
    expect(summary.registerOnChain).toBeUndefined();
    expect(page).not.toContain(i18n.t("dappUi.warn.registerOnChain"));
    expect.soft(page).not.toContain(OLD_CLAIM);
    expect(page).toContain(i18n.t("dappUi.privacy.paysSeedelfAccount"));
  });

  it("claims nothing either way before the contract was first read, asking nobody for it", { timeout: 60_000 }, async () => {
    const { t, s } = await connected();
    expect(await keptContractView(t.session, "preprod")).toBeUndefined();
    const { summary, page } = await asked(t, s, paysContract(theirs.inline_datum!.bytes, t.deps.wasm.cip30Address(OWN)));
    expect(summary.registerOnChain).toBeUndefined();
    expect(page).not.toContain(i18n.t("dappUi.warn.registerOnChain"));
    expect.soft(page).not.toContain(OLD_CLAIM);
    // The check reads the contract only as the last reading kept it: a site's request never has it read.
    expect(await keptContractView(t.session, "preprod")).toBeUndefined();
  });
});
