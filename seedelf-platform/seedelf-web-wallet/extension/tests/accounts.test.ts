// The phrase's public accounts (chunk 18, P1): discovery, the switch, and
// what each account keeps of its own.
import * as wasm from "@seedelf/wasm";
import { describe, expect, it } from "vitest";

import { accountLabel, activeAccount, MAX_INDEX, MAX_KEPT, WIPED_ON_SWITCH } from "../src/background/accounts";
import { choicesOf, withChoices } from "../src/background/coin-control";
import { isAccountIndex, LOCAL_ACCOUNT, LOCAL_PREFERENCES, ONE_TIME_ACCOUNT } from "../src/shared/preferences";
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
    await t.local.set(LOCAL_ACCOUNT, MAX_INDEX + 1);
    expect(await activeAccount(t.local)).toBe(0);
    // Any index CIP-1852 allows is one, though: the path component is hardened, so it runs to 2^31 - 1.
    await t.local.set(LOCAL_ACCOUNT, MAX_INDEX);
    expect(await activeAccount(t.local)).toBe(MAX_INDEX);
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

  it("checks an account by number, whatever its index, and adds a used one", async () => {
    const t = await unlocked();
    // 1337 can never be reached by the sequential look: it stops at the first
    // account never used, so account 1 ends it (the owner, 2026-10-02).
    const stake = await stakeOf(t, 1337);
    t.koios.usedStakes.add(stake);
    t.koios.calls.length = 0;
    expect(await t.accounts.check("preprod", 1337)).toEqual({ index: 1337, used: true });
    expect(asked(t)).toEqual([[stake]]);
    expect((await t.accounts.list()).accounts).toEqual([{ index: 0 }, { index: 1337, foundAt: t.clock.now }]);

    // One never used is reported, not added: adding it is the user's call.
    expect(await t.accounts.check("preprod", 9)).toEqual({ index: 9, used: false });
    expect((await t.accounts.list()).accounts.map((a) => a.index)).toEqual([0, 1337]);

    await expect(t.accounts.check("preprod", MAX_INDEX + 1)).rejects.toThrow("whole number from 1 to");
    await expect(t.accounts.check("preprod", 1.5)).rejects.toThrow("whole number from 1 to");
  });

  it("adds an account that has never been used, asking nobody anything", async () => {
    const t = await unlocked();
    t.koios.calls.length = 0;
    expect(await t.accounts.add(1337)).toEqual([{ index: 0 }, { index: 1337 }]);
    // It exists in the phrase either way, and a user starting a custom account
    // must not have to put something on chain first to be allowed to pick it.
    expect(t.koios.calls).toEqual([]);
    expect(await t.accounts.use(1337, ["preprod"])).toBe(1337);
    expect(await t.wallet.withKeys(({ account }) => account)).toBe(1337);

    // Adding it twice changes nothing, and a bad number is refused.
    expect((await t.accounts.add(1337)).map((a) => a.index)).toEqual([0, 1337]);
    await expect(t.accounts.add(-1)).rejects.toThrow("whole number from 1 to");
    await expect(t.accounts.add(MAX_INDEX + 1)).rejects.toThrow("whole number from 1 to");
  });

  it("never makes the private sessions' one-time account a public one", async () => {
    // Its 0/i and 2/0 keys are session i's and session 0's: as a public
    // account it would read, and spend, private sessions' money (privacy.md,
    // rule 6). The screens count from 1, so it's Account 24302 there.
    const t = await unlocked();
    t.koios.calls.length = 0;
    await expect(t.accounts.add(ONE_TIME_ACCOUNT)).rejects.toThrow("Account 24302 is the one Seedelf Wallet keeps for private sessions");
    await expect(t.accounts.check("preprod", ONE_TIME_ACCOUNT)).rejects.toThrow("keeps for private sessions");
    await expect(t.accounts.use(ONE_TIME_ACCOUNT, ["preprod"])).rejects.toThrow("That isn't an account");
    expect(t.koios.calls).toEqual([]);
    // Its neighbours are ordinary accounts.
    expect((await t.accounts.add(ONE_TIME_ACCOUNT + 1)).map((a) => a.index)).toEqual([0, ONE_TIME_ACCOUNT + 1]);

    // Kept by a build from before the check, it reads as account 0 and leaves
    // the list, and a dApp account kept as it is account 0 too.
    await t.local.set(LOCAL_ACCOUNT, ONE_TIME_ACCOUNT);
    expect(await activeAccount(t.local)).toBe(0);
    expect(isAccountIndex(ONE_TIME_ACCOUNT)).toBe(false);
    await t.deps.store.set("accounts", { known: [{ index: 0 }, { index: ONE_TIME_ACCOUNT }] });
    expect((await t.accounts.list()).accounts.map((a) => a.index)).toEqual([0]);
    await t.local.set(LOCAL_PREFERENCES, { dappAccount: ONE_TIME_ACCOUNT });
    expect((await t.deps.preferences.get()).dappAccount).toBe(0);
  });

  it("names the account the one-time accounts are derived under", () => {
    // Session 0's address is payment key 0/0 and stake key 2/0 of account
    // ONE_TIME_ACCOUNT, so the constant here is seedelf-crypto's, not a guess.
    const { phrase: words } = phrase(0);
    const sessions = wasm.OneTimeAccounts.fromPhrase(words);
    const account = wasm.CardanoAccount.fromPhrase(words, ONE_TIME_ACCOUNT);
    try {
      expect(account.receiveAddress(wasm.Network.Preprod, 0)).toBe(sessions.address(wasm.Network.Preprod, 0));
    } finally {
      sessions.free();
      account.free();
    }
  });

  it("carries the sequential look on from the first gap, not the highest known", async () => {
    const t = await unlocked();
    // A custom account must not stop the look from ever reaching account 2.
    await t.accounts.add(1337);
    const second = await stakeOf(t, 1);
    t.koios.usedStakes.add(second);
    t.koios.calls.length = 0;

    expect(await t.accounts.discover("preprod")).toEqual([{ index: 1, foundAt: t.clock.now }]);
    expect(asked(t)).toEqual([[second], [await stakeOf(t, 2)]]);
    expect((await t.accounts.list()).accounts.map((a) => a.index)).toEqual([0, 1, 1337]);
  });

  it("keeps at most MAX_KEPT accounts, which is a list length and not a limit on the numbers", async () => {
    const t = await unlocked();
    for (let i = 1; i < MAX_KEPT; i += 1) await t.accounts.add(i * 1000);
    expect((await t.accounts.list()).accounts).toHaveLength(MAX_KEPT);
    await expect(t.accounts.add(999_999)).rejects.toThrow(`keeps up to ${MAX_KEPT} accounts`);
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

describe("the public Send and the wallet's own accounts", () => {
  it("pays another of your own accounts, and names which one it is", async () => {
    const t = await unlocked();
    t.koios.usedStakes.add(phrase(1).preprod.stake as string);
    await t.accounts.discover("preprod");

    // Allowed, not refused (the owner, 2026-10-02): moving money between your
    // own accounts is a thing people want to do, and accounts aren't
    // necessarily unlinked — some of what the wallet already does links them.
    // So the destination names the account and the form says what it reveals.
    const other = phrase(1).preprod.receive_0 as string;
    const summary = await t.send.build("preprod", [{ to: other, lovelace: "2000000", tokens: [] }]);
    expect(summary.payments[0]).toMatchObject({ own: true, ownAccount: 1 });

    // However the address arrived: it is read off the resolved address, not
    // off how it was typed, so Contacts and ADA Handles say the same.
    expect(await t.withdraw.resolve("preprod", other)).toMatchObject({ own: true, ownAccount: 1 });
  });

  it("pays this account too, which is what the collateral payment is", async () => {
    const t = await unlocked();
    // The money comes straight back less the fee, so this links nothing new,
    // and Settings' collateral is exactly a payment to this account's own 0/0.
    const summary = await t.send.build("preprod", [{ to: phrase(0).preprod.receive_0 as string, lovelace: "2000000", tokens: [] }]);
    expect(summary.payments[0]).toMatchObject({ own: true, ownAccount: 0 });
  });
});

/** Account `index`'s preprod stake address, as discovery derives it. */
async function stakeOf(t: Awaited<ReturnType<typeof unlocked>>, index: number): Promise<string> {
  return t.wallet.withAccount(index, ({ cardano }) => cardano.stakeAddress(t.deps.wasm.Network.Preprod));
}
