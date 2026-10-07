// What the user locked on the dApp account, and its collateral, stay out of a
// site's hands whichever account the picker is on (the release review). Sites
// read and sign the dApp account, but its locks and collateral were picked
// from the account on screen: moved to another, a site was offered the locked
// UTxO and signed over it unrefused, and got another 5 ₳ as collateral, or
// none. Every lock and collateral a 1.1.0 wallet sealed is account 0's, the
// default dApp account, so all of them lapsed once the user added an account
// and switched to it.
import { describe, expect, it } from "vitest";

import { type DappSession } from "../src/background/dapp";
import { TxSignError } from "../src/shared/dapp";
import type { UtxoInfo } from "../src/shared/rpc";
import { loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
/** The one vector phrase with both accounts recorded: account 0 holds six pure 5 ₳ UTxOs. */
const phrase = (account: 0 | 1) =>
  vectors("cardano_account.json").find((v) => v.account === account && v.phrase.split(" ").length === 24)!;
const THEIRS = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 15)!.preprod
  .receive_0 as string;

let pages = 0;
const site = (origin = "https://app.example.com"): DappSession => ({ id: `coins${++pages}`, origin, title: "Example" });
async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}

async function on() {
  const t = testBalances();
  await t.wallet.create(phrase(0).phrase, PASSWORD);
  await t.accounts.recordFirst();
  await t.preferences.set({ dappConnector: true, dappPassword: false, spendRewards: false });
  // Account 1 of this phrase has been used, so the wallet can move to it.
  t.koios.usedStakes.add(phrase(1).preprod.stake as string);
  await t.accounts.discover("preprod");
  return t;
}

async function connect(t: Awaited<ReturnType<typeof on>>, s = site()) {
  const enabling = t.dapp.call(s, "enable", []);
  await until(() => t.dapp.approvals().length === 1);
  await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
  expect(await enabling).toBe(true);
  return s;
}

const ref = (u: UtxoInfo) => `${u.txHash}#${u.index}`;
const uint = (n: number) => (n < 24 ? n.toString(16).padStart(2, "0") : `18${n.toString(16).padStart(2, "0")}`);
const outpoints = (list: string[]) => `8${list.length}${list.map((o) => `825820${o.slice(0, 64)}${uint(Number(o.slice(65)))}`).join("")}`;

/** A site's transaction spending `inputs`, putting up `collateral`, paying someone else 4 ₳. The wallet only reads it. */
function siteTx(inputs: string[], collateral: string[] = []) {
  const fields = [`00${outpoints(inputs)}`, `0181825839${loadTestWasm().cip30Address(THEIRS)}1a003d0900`, "021a00029810"];
  if (collateral.length) fields.push(`0d${outpoints(collateral)}`);
  return `84a${fields.length}${fields.join("")}a0f5f6`;
}

describe("the dApp account's locks and collateral", () => {
  it("hold for sites with the picker on another account, as 1.1.0 sealed them, whatever that account chose", async () => {
    const t = await on();
    const s = await connect(t);
    await t.balances.get("preprod");
    const utxos = (await t.coins.lists("preprod")).cardano;
    const fives = utxos.filter((u) => u.lovelace === "5000000" && !u.tokens.length);
    // Not the wallet's own pick, the oldest: the one the user chose.
    const chosen = fives.find((u) => !u.collateral)!;
    const locked = utxos.find((u) => !fives.includes(u))!;
    const free = fives.find((u) => u !== chosen && !u.collateral)!;
    // The shape 1.1.0 sealed, before there were several accounts: account 0's, the dApp account's.
    await t.store.set("coins.preprod", { seedelf: [], cardano: [ref(locked)], collateral: ref(chosen) });

    const seen = async () => ({
      utxos: (await t.dapp.call(s, "getUtxos", [])) as string[],
      collateral: (await t.dapp.call(s, "getCollateral", [])) as string[] | null,
      balance: await t.dapp.call(s, "getBalance", []),
    });
    const before = await seen();
    expect(before.collateral).toHaveLength(1);
    expect(before.collateral![0]).toContain(chosen.txHash);
    expect(before.utxos.some((u) => u.includes(locked.txHash) || u.includes(chosen.txHash))).toBe(false);

    // The picker moves to account 1, which reclaims its own collateral: a site sees no change, read again or not.
    await t.accounts.use(1, ["preprod"]);
    await t.coins.reclaim("preprod");
    expect(await seen()).toEqual(before);
    t.clock.now += 31_000;
    expect(await seen()).toEqual(before);

    // And a transaction that spends the lock, puts it up as collateral, or spends the collateral is refused unasked.
    const refused = (info: string) => ({ failure: { code: TxSignError.ProofGeneration, info: expect.stringContaining(info) } });
    for (const tx of [siteTx([ref(locked)]), siteTx([ref(free)], [ref(locked)])]) {
      await expect(t.dapp.call(s, "signTx", [tx, false])).rejects.toMatchObject(refused(`a UTxO you locked (${ref(locked)})`));
    }
    await expect(t.dapp.call(s, "signTx", [siteTx([ref(free), ref(chosen)]), false])).rejects.toMatchObject(
      refused(`spends your collateral (${ref(chosen)})`),
    );
    expect(t.dapp.approvals()).toEqual([]);

    // Account 1's own choices are its own: the record keeps both.
    expect((await t.coins.choices("preprod")).collateral).toBeNull();
    expect(await t.coins.choices("preprod", 0)).toMatchObject({ cardano: [ref(locked)], collateral: ref(chosen) });
  });
});
