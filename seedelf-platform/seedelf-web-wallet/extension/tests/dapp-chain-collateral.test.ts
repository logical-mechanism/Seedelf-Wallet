// While the account's own Lovejoin chain is being sent, its collateral backs
// every mix: a site is neither offered it (getCollateral) nor let put it up
// in a transaction it asks to sign (independent review L32). A site that
// flips a signed transaction's validity flag would otherwise have the
// network take it, and the chain would stop partway.
import { describe, expect, it } from "vitest";

import { type DappSession } from "../src/background/dapp";
import { SESSION_RESERVED_PREFIX } from "../src/background/spent";
import { TxSignError } from "../src/shared/dapp";
import { koiosPreprod, loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
const OWN = account(12).preprod.receive_0 as string;
const THEIRS = account(15).preprod.receive_0 as string;

let pages = 0;
const site = (): DappSession => ({ id: `chain${++pages}`, origin: "https://app.example.com", title: "Example" });

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}

const uint = (n: number) => (n < 24 ? n.toString(16).padStart(2, "0") : `18${n.toString(16).padStart(2, "0")}`);
const outpoints = (list: string[]) => `8${list.length}${list.map((o) => `825820${o.slice(0, 64)}${uint(Number(o.slice(65)))}`).join("")}`;

/** A site's transaction spending `inputs`, putting up `collateral`, paying 4 ₳ to someone else. */
function siteTx(inputs: string[], collateral: string[]) {
  const pay = `825839${loadTestWasm().cip30Address(THEIRS)}1a003d0900`;
  return `84a400${outpoints(inputs)}0181${pay}021a000298100d${outpoints(collateral)}a0f5f6`;
}

describe("the collateral of a Lovejoin chain being sent", () => {
  it("is neither offered to a site nor put up by one, until the chain lets go", async () => {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
    await t.preferences.set({ dappConnector: true, spendRewards: false });
    const template = Object.values(koiosPreprod.accounts)
      .flatMap((a) => a.account_utxos)
      .find((u) => u.address === OWN)!;
    t.koios.addedToAccounts.push({ ...template, tx_hash: "c0".repeat(32), tx_index: 0, value: "5000000", asset_list: [], block_height: 1 });
    const s = site();
    const enabling = t.dapp.call(s, "enable", []);
    await until(() => t.dapp.approvals().length === 1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
    await enabling;
    await t.balances.get("preprod");
    const utxos = (await t.coins.lists("preprod")).cardano;
    const ref = (u: { txHash: string; index: number }) => `${u.txHash}#${u.index}`;
    const collateral = ref(utxos.find((u) => u.collateral)!);
    const [held, free] = utxos.filter((u) => !u.collateral).map(ref);
    const offered = (await t.dapp.call(s, "getCollateral", [])) as string[];
    expect(offered).toHaveLength(1);

    // Built and kept for Send, it holds only its pool boxes: the collateral is still offered.
    await t.session.set(SESSION_RESERVED_PREFIX + "preprod", {
      public: { inputs: [held!], collateral: [collateral], until: t.clock.now + 60 * 60_000 },
    });
    expect(await t.dapp.call(s, "getCollateral", [])).toEqual(offered);

    // Being sent: none is offered, and a site that names it anyway is refused unasked.
    await t.session.set(SESSION_RESERVED_PREFIX + "preprod", { public: { inputs: [held!], collateral: [collateral] } });
    expect(await t.dapp.call(s, "getCollateral", [])).toBeNull();
    await expect(t.dapp.call(s, "signTx", [siteTx([free!], [collateral]), false])).rejects.toMatchObject({
      failure: { code: TxSignError.ProofGeneration, info: expect.stringContaining(`a UTxO (${collateral}) that a Lovejoin chain still holds`) },
    });
    expect(t.dapp.approvals()).toEqual([]);

    // Once it's all sent, it's the site's collateral again.
    await t.lovejoin.release("preprod", "public");
    expect(await t.dapp.call(s, "getCollateral", [])).toEqual(offered);
    const signing = t.dapp.call(s, "signTx", [siteTx([free!], [collateral]), false]);
    await until(() => t.dapp.approvals().length === 1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, false);
    await expect(signing).rejects.toMatchObject({ failure: { code: TxSignError.UserDeclined } });
  });
});
