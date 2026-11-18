// What a restore's look for accounts finds, and the pages that show it
// (release review C12, C32, C09). The look runs in the background and writes
// only the sealed list, so the pages follow that record's name; it merges
// into the list as it then is, so a name or an account added meanwhile stays;
// and Settings names the account the worker actually asked about, from its
// own list. A restore looks only in order, so an account past an unused one
// is one to note by number.
import { describe, expect, it, vi } from "vitest";

import { handle, type Context } from "../src/background/handlers";
import { NetworkChoice } from "../src/background/preferences";
import { PRIVATE_PREFIX } from "../src/background/private-store";
import type { NetworkName } from "../src/networks";
import { LOCAL_ACCOUNT, LOCAL_ACCOUNTS_RECORD, LOCAL_PREFERENCES } from "../src/shared/preferences";
import type { Requests } from "../src/shared/rpc";
import { accountsChanged, nextInOrder, restoreFinds } from "../src/ui/accounts";
import { loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
/** The one vector phrase with both accounts recorded (24 words), as accounts.test.ts uses it. */
const phrase = (account: 0 | 1) =>
  vectors("cardano_account.json").find((v) => v.account === account && v.phrase.split(" ").length === 24)!;

type T = ReturnType<typeof testBalances>;

function context(t: T): Context {
  const networks: NetworkName[] = ["preprod"];
  return {
    ...(t as unknown as Context),
    wasm: loadTestWasm(),
    connector: async (on) => on,
    version: "1.0.0",
    network: "preprod",
    networks,
    networkChoice: new NetworkChoice(t.local, networks),
  };
}

const stakeOf = (t: T, index: number) => t.wallet.withAccount(index, ({ cardano }) => cardano.stakeAddress(t.deps.wasm.Network.Preprod));
const indexes = async (t: T) => (await t.accounts.list()).accounts.map((a) => a.index);

describe("a restore's look for more accounts", () => {
  it("writes what it finds to the record the pages follow, by its name alone", async () => {
    // The pages don't import the cipher: the name is written out there, and must be the record's.
    expect(LOCAL_ACCOUNTS_RECORD).toBe(PRIVATE_PREFIX + "accounts");
    const t = testBalances();
    t.koios.usedStakes.add(phrase(1).preprod.stake as string);
    await handle({ type: "restore-wallet", phrase: phrase(0).phrase, password: PASSWORD }, context(t));
    // The restore answers before the look ends, as the page reads the list at once.
    await vi.waitFor(async () => expect(await indexes(t)).toEqual([0, 1]));
    expect(t.local.data.has(LOCAL_ACCOUNTS_RECORD)).toBe(true);

    // A page reads the list again on that change, as on a switch, and on nothing else of local storage's.
    expect(accountsChanged({ [LOCAL_ACCOUNTS_RECORD]: { newValue: "sealed" } })).toBe(true);
    expect(accountsChanged({ [LOCAL_ACCOUNT]: { newValue: 1 } })).toBe(true);
    expect(accountsChanged({ [LOCAL_PREFERENCES]: { newValue: {} } })).toBe(false);
  });

  it("keeps an account added and a name given while it asked Koios", async () => {
    const t = testBalances();
    await t.wallet.create(phrase(0).phrase, PASSWORD);
    await t.accounts.recordFirst();
    t.koios.usedStakes.add(phrase(1).preprod.stake as string);
    let release!: () => void;
    t.koios.hold = new Promise((r) => (release = r));
    const look = t.accounts.discover("preprod");
    await vi.waitFor(() => expect(t.koios.calls.some((c) => c.path === "account_addresses")).toBe(true));
    // Settings, while the restore's look waits on Koios: neither asks Koios anything.
    await t.accounts.add(1337);
    await t.accounts.rename(0, "Main");
    release();
    t.koios.hold = undefined;
    expect(await look).toEqual([{ index: 1, foundAt: t.clock.now }]);
    expect((await t.accounts.list()).accounts).toEqual([
      { index: 0, name: "Main" },
      { index: 1, foundAt: t.clock.now },
      { index: 1337 },
    ]);
  });

  it("is followed by Settings' look naming the account the worker asked about, from the worker's own list", async () => {
    const t = testBalances();
    const ctx = context(t);
    t.koios.usedStakes.add(phrase(1).preprod.stake as string);
    await handle({ type: "restore-wallet", phrase: phrase(0).phrase, password: PASSWORD }, ctx);
    await vi.waitFor(async () => expect(await indexes(t)).toEqual([0, 1]));
    // A page that read the list before the look ended still holds [0]: the worker asks about index 2, Account 3.
    t.koios.calls.length = 0;
    const reply = (await handle({ type: "account-discover", limit: 1 }, ctx)) as Requests["account-discover"]["result"];
    expect(reply.found).toEqual([]);
    expect(t.koios.calls.map((c) => c.body?._stake_addresses)).toEqual([[await stakeOf(t, 2)]]);
    expect(nextInOrder(reply.accounts)).toBe(2);
    expect(nextInOrder([{ index: 0 }])).toBe(1);
  });
});

describe("a look for accounts still asking Koios when the wallet is removed and another phrase restored", () => {
  // Chunk 51, e4a#1's family (accounts.ts): the look went on under the next phrase's keys, probing its accounts from
  // where it was, and put what it found into that phrase's list. It's the phrase's it began under, as a reading is.
  it("ends as a lock ends it, and puts nothing into that phrase's list", async () => {
    const t = testBalances();
    await t.wallet.create(phrase(0).phrase, PASSWORD);
    await t.accounts.recordFirst();
    t.koios.usedStakes.add(phrase(1).preprod.stake as string);
    let release!: () => void;
    t.koios.hold = new Promise((r) => (release = r));
    const look = t.accounts.discover("preprod");
    look.catch(() => undefined);
    await vi.waitFor(() => expect(t.koios.calls.some((c) => c.path === "account_addresses")).toBe(true));
    // Remove wallet, then a restore of the 12-word phrase, as the handlers make one (its own look aside).
    await t.wallet.reset();
    await t.accounts.useFirst();
    await t.wallet.create(vectors("cardano_account.json").find((v) => v.phrase.split(" ").length === 12)!.phrase, PASSWORD);
    await t.accounts.recordFirst();
    release();
    t.koios.hold = undefined;
    await expect(look).rejects.toThrow("The wallet is locked.");
    expect(await indexes(t)).toEqual([0]);
  });

  /** Remove wallet, then a restore of the 12-word phrase, as the handlers make one (its own look aside). */
  async function anotherPhrase(t: T) {
    await t.wallet.reset();
    await t.accounts.useFirst();
    await t.wallet.create(vectors("cardano_account.json").find((v) => v.phrase.split(" ").length === 12)!.phrase, PASSWORD);
    await t.accounts.recordFirst();
  }

  /** Holds Koios's `n`th account_addresses request, the probe of one account, until released. */
  function holdProbe(t: T, n: number) {
    const real = t.koios.fetch;
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const hit = new Promise<void>((r) => (reached = r));
    let probes = 0;
    t.koios.fetch = async (url, init) => {
      if (url.endsWith("/account_addresses") && ++probes === n) {
        reached();
        await gate;
      }
      return real(url, init);
    };
    return { hit, release };
  }

  // Chunk 51, r2tests#4: the case above holds the first probe, so the next probe's own pin ends the look before its
  // merge. Here the last probe, the one Koios answers unused, spans them: nothing is probed after it, and the merge's
  // own pin is what keeps account 1 out of the other phrase's list.
  it("ends at its merge when its last probe spans them, putting nothing into that phrase's list", async () => {
    const t = testBalances();
    await t.wallet.create(phrase(0).phrase, PASSWORD);
    await t.accounts.recordFirst();
    t.koios.usedStakes.add(phrase(1).preprod.stake as string);
    // Account 1 is found; account 2's probe, never used, the look's last, is held.
    const { hit, release } = holdProbe(t, 2);
    const look = t.accounts.discover("preprod");
    look.catch(() => undefined);
    await hit;
    await anotherPhrase(t);
    release();
    await expect(look).rejects.toThrow("The wallet is locked.");
    expect(await indexes(t)).toEqual([0]);
  });

  // And Settings' check of one account, whose one probe spans them: it adds nothing to that phrase's list.
  it("ends a check of one account whose probe spans them, adding nothing to that phrase's list", async () => {
    const t = testBalances();
    await t.wallet.create(phrase(0).phrase, PASSWORD);
    await t.accounts.recordFirst();
    t.koios.usedStakes.add(phrase(1).preprod.stake as string);
    const { hit, release } = holdProbe(t, 1);
    const checked = t.accounts.check("preprod", 1);
    checked.catch(() => undefined);
    await hit;
    await anotherPhrase(t);
    release();
    await expect(checked).rejects.toThrow("The wallet is locked.");
    expect(await indexes(t)).toEqual([0]);
  });
});

describe("an account a restore won't find by itself", () => {
  it("is any past the run of accounts found used, from Account 2 up", () => {
    const used = (index: number) => ({ index, foundAt: 1 });
    // Account 1 is always found, and the next after the run once it's used.
    expect(restoreFinds([{ index: 0 }], 0)).toBe(true);
    expect(restoreFinds([{ index: 0 }, { index: 1 }], 1)).toBe(true);
    expect(restoreFinds([{ index: 0 }, used(1), used(2)], 3)).toBe(true);
    // A number of your own, past the run.
    expect(restoreFinds([{ index: 0 }, { index: 1337 }], 1337)).toBe(false);
    expect(restoreFinds([{ index: 0 }, used(1337)], 1337)).toBe(false);
    // One past an account added but never found used: the look stops there.
    expect(restoreFinds([{ index: 0 }, { index: 1 }, { index: 2 }], 2)).toBe(false);
    expect(restoreFinds([{ index: 0 }, { index: 1 }, used(2)], 2)).toBe(false);
  });
});
