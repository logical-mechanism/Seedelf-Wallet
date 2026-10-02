// The phrase's public accounts (chunk 18, P1): discovery, the switch, and
// what each account keeps of its own.
import { describe, expect, it } from "vitest";

import { accountLabel, activeAccount, MAX_ACCOUNTS, WIPED_ON_SWITCH } from "../src/background/accounts";
import { choicesOf, withChoices } from "../src/background/coin-control";
import { LOCAL_ACCOUNT } from "../src/shared/preferences";
import { testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
/**
 * The one vector phrase with both accounts recorded (24 words), so a switch
 * can be checked against values from `@cardano-sdk/key-management` rather
 * than against what this code happens to derive.
 */
const phrase = (account: 0 | 1) =>
  vectors("cardano_account.json").find((v) => v.account === account && v.phrase.split(" ").length === 24)!;

async function unlocked() {
  const t = testBalances();
  await t.wallet.create(phrase(0).phrase, PASSWORD);
  await t.accounts.recordFirst();
  return t;
}

/** What `account_addresses` was asked about, in order. */
const asked = (t: Awaited<ReturnType<typeof unlocked>>) =>
  t.koios.calls.filter((c) => c.path === "account_addresses").map((c) => (c.body as { _stake_addresses: string[] })._stake_addresses);

describe("the wallet's public accounts", () => {
  it("starts on account 0 alone, which every phrase has", async () => {
    const t = await unlocked();
    expect(await t.accounts.list()).toEqual({ accounts: [{ index: 0 }], active: 0 });
    expect(await activeAccount(t.local)).toBe(0);
    // A wallet from before chunk 18 has nothing kept, and anything else there is account 0 too.
    await t.local.set(LOCAL_ACCOUNT, "two");
    expect(await activeAccount(t.local)).toBe(0);
    await t.local.set(LOCAL_ACCOUNT, -1);
    expect(await activeAccount(t.local)).toBe(0);
    await t.local.set(LOCAL_ACCOUNT, MAX_ACCOUNTS);
    expect(await activeAccount(t.local)).toBe(0);
  });

  it("looks for accounts in order and stops at the first never used, one request each", async () => {
    const t = await unlocked();
    // Account 1 of this phrase has used an address; account 2 never has.
    const one = phrase(1).preprod.stake as string;
    t.koios.usedStakes.add(one);

    expect(await t.accounts.discover("preprod")).toEqual([{ index: 1, foundAt: t.clock.now }]);
    // One stake address an ask, never a batch: a single request for twenty
    // would tell Koios those twenty are one wallet's.
    expect(asked(t)).toEqual([[one], [await stakeOf(t, 2)]]);
    expect((await t.accounts.list()).accounts).toEqual([{ index: 0 }, { index: 1, foundAt: t.clock.now }]);

    // Asked again, it carries on from the highest it knows, and finds nothing.
    t.koios.calls.length = 0;
    expect(await t.accounts.discover("preprod")).toEqual([]);
    expect(asked(t)).toEqual([[await stakeOf(t, 2)]]);
  });

  it("probes exactly one account when the picker asks for one", async () => {
    const t = await unlocked();
    t.koios.calls.length = 0;
    expect(await t.accounts.discover("preprod", 1)).toEqual([]);
    expect(asked(t)).toHaveLength(1);
  });

  it("switches only to an account it knows, and drops what the one it left read", async () => {
    const t = await unlocked();
    await expect(t.accounts.use(1, ["preprod"])).rejects.toThrow("doesn't know that account");
    await expect(t.accounts.use(-1, ["preprod"])).rejects.toThrow("isn't an account");

    t.koios.usedStakes.add(phrase(1).preprod.stake as string);
    await t.accounts.discover("preprod");

    // What the account it leaves read, and nothing that is the private
    // balance's or protects a payment in flight.
    for (const prefix of WIPED_ON_SWITCH) await t.session.set(prefix + "preprod", { kept: true });
    await t.session.set("seedelf.contract.preprod", { kept: true });
    await t.session.set("seedelf.reserved.preprod", { kept: true });
    await t.session.set("seedelf.pendingTx.preprod", { kept: true });

    expect(await t.accounts.use(1, ["preprod"])).toBe(1);
    expect(await activeAccount(t.local)).toBe(1);
    for (const prefix of WIPED_ON_SWITCH) expect(await t.session.get(prefix + "preprod")).toBeUndefined();
    // The private balance is shared, so its scan stays: that is what makes a
    // switch cost one account read rather than a full contract scan.
    expect(await t.session.get("seedelf.contract.preprod")).toEqual({ kept: true });
    // And what the wallet spent protects every account from a double spend.
    expect(await t.session.get("seedelf.reserved.preprod")).toEqual({ kept: true });
    expect(await t.session.get("seedelf.pendingTx.preprod")).toEqual({ kept: true });
  });

  it("derives the account it is on, and the Seedelf key stays on account 0", async () => {
    const t = await unlocked();
    const first = await t.wallet.account("preprod");
    expect(first).toMatchObject({ account: 0, receiveAddress: phrase(0).preprod.receive_0, stakeAddress: phrase(0).preprod.stake });

    t.koios.usedStakes.add(phrase(1).preprod.stake as string);
    await t.accounts.discover("preprod");
    await t.accounts.use(1, ["preprod"]);

    // The next key use re-derives: nothing else had to happen.
    const second = await t.wallet.account("preprod");
    expect(second).toMatchObject({
      account: 1,
      receiveAddress: phrase(1).preprod.receive_0,
      stakeAddress: phrase(1).preprod.stake,
    });
    // One private balance for the whole phrase (the owner, 2026-10-02).
    expect(second.seedelfPublicValue).toBe(first.seedelfPublicValue);
  });

  it("hands a specific account's keys whichever one is active, for a site bound to it", async () => {
    const t = await unlocked();
    const net = t.deps.wasm.Network.Preprod;
    expect(await t.wallet.withAccount(1, ({ cardano, account }) => [account, cardano.stakeAddress(net)])).toEqual([
      1,
      phrase(1).preprod.stake,
    ]);
    // The wallet is still on account 0.
    expect(await t.wallet.withKeys(({ account }) => account)).toBe(0);
  });

  it("names an account, and shows a number from 1 with no name", async () => {
    const t = await unlocked();
    expect(accountLabel({ index: 0 })).toBe("Account 1");
    expect(accountLabel({ index: 4, name: "  Exchange  " })).toBe("Exchange");
    expect(accountLabel({ index: 1, name: "   " })).toBe("Account 2");

    expect(await t.accounts.rename(0, "Spending")).toEqual([{ index: 0, name: "Spending" }]);
    expect(await t.accounts.rename(0, "")).toEqual([{ index: 0 }]);
    expect(await t.accounts.rename(0, "x".repeat(50))).toEqual([{ index: 0, name: "x".repeat(24) }]);
    await expect(t.accounts.rename(2, "Nope")).rejects.toThrow("doesn't know that account");
  });

  it("offers the active account even where discovery hasn't seen it used", async () => {
    const t = await unlocked();
    // Set by hand, as a network switch can leave it: account 2 is used on the
    // other network, so the picker must still show the account it is on.
    await t.local.set(LOCAL_ACCOUNT, 2);
    expect(await t.accounts.list()).toEqual({ accounts: [{ index: 0 }, { index: 2 }], active: 2 });
  });
});

describe("what each account keeps of its own", () => {
  it("reads the record sealed before chunk 18 as account 0's", () => {
    const old = { seedelf: ["a#0"], cardano: ["b#1"], collateral: "c#2", collateralSentAt: 7 };
    expect(choicesOf(old, 0)).toEqual({ seedelf: ["a#0"], cardano: ["b#1"], collateral: "c#2", collateralSentAt: 7 });
    // Another account has locked nothing and chosen no collateral of its own,
    // but the private side is shared.
    expect(choicesOf(old, 1)).toEqual({ seedelf: ["a#0"], cardano: [] });
    expect(choicesOf(undefined, 0)).toEqual({ seedelf: [], cardano: [] });
  });

  it("keeps account 0's locks and collateral when another account writes first", () => {
    const old = { seedelf: ["a#0"], cardano: ["b#1"], collateral: "c#2" };
    // Account 1 locks something: account 0's choices move into the map rather
    // than being dropped with the fields they were in.
    const after = withChoices(old, 1, { seedelf: ["a#0"], cardano: ["d#3"] });
    expect(choicesOf(after, 0)).toEqual({ seedelf: ["a#0"], cardano: ["b#1"], collateral: "c#2" });
    expect(choicesOf(after, 1)).toEqual({ seedelf: ["a#0"], cardano: ["d#3"] });
    // And the legacy fields are gone, so nothing reads them twice.
    expect(after.cardano).toBeUndefined();
    expect(after.collateral).toBeUndefined();
  });

  it("keeps the private side shared across accounts", () => {
    const after = withChoices({ seedelf: [], cardano: [] }, 1, { seedelf: ["p#0"], cardano: [] });
    expect(choicesOf(after, 0).seedelf).toEqual(["p#0"]);
    expect(choicesOf(after, 1).seedelf).toEqual(["p#0"]);
  });

  it("gives each account its own collateral", async () => {
    const t = await unlocked();
    t.koios.usedStakes.add(phrase(1).preprod.stake as string);
    await t.accounts.discover("preprod");

    await t.coins.sent("preprod", "aa#0");
    expect((await t.coins.choices("preprod")).collateral).toBe("aa#0");
    await t.accounts.use(1, ["preprod"]);
    // Account 1 has chosen none, so the wallet takes its own oldest 5 ₳ UTxO, as it always does.
    expect((await t.coins.choices("preprod")).collateral).toBeUndefined();
    await t.coins.sent("preprod", "bb#0");
    expect((await t.coins.choices("preprod")).collateral).toBe("bb#0");
    await t.accounts.use(0, ["preprod"]);
    expect((await t.coins.choices("preprod")).collateral).toBe("aa#0");
  });
});

describe("paying your own public account from Seedelf", () => {
  it("is flagged for every account the wallet knows, not only the one it is on", async () => {
    const t = await unlocked();
    const { resolveDestination } = await import("../src/background/destination");
    const deps = { wasm: t.deps.wasm, wallet: t.wallet, koios: t.deps.koios, session: t.session, knownAccounts: t.deps.knownAccounts };

    // The account the wallet is on: flagged, as it always was.
    expect(await resolveDestination(deps, "preprod", phrase(0).preprod.receive_0 as string)).toMatchObject({ own: true });
    // Another account's address, before the wallet knows that account exists:
    // nothing on the device says it is ours.
    expect(await resolveDestination(deps, "preprod", phrase(1).preprod.receive_0 as string)).toMatchObject({ own: false });

    t.koios.usedStakes.add(phrase(1).preprod.stake as string);
    await t.accounts.discover("preprod");
    // Known now, and still flagged while the wallet is on account 0: paying
    // your own public account from Seedelf re-links the money to it, and that
    // is as true of Account 2 as of the one you are looking at.
    expect(await resolveDestination(deps, "preprod", phrase(1).preprod.receive_0 as string)).toMatchObject({ own: true });
    expect(await t.wallet.withKeys(({ account }) => account)).toBe(0);

    // Someone else's address is still someone else's.
    const theirs = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 15)!;
    expect(await resolveDestination(deps, "preprod", theirs.preprod.receive_0 as string)).toMatchObject({ own: false });
  });
});

/** Account `index`'s preprod stake address, as discovery derives it. */
async function stakeOf(t: Awaited<ReturnType<typeof unlocked>>, index: number): Promise<string> {
  return t.wallet.withAccount(index, ({ cardano }) => cardano.stakeAddress(t.deps.wasm.Network.Preprod));
}
