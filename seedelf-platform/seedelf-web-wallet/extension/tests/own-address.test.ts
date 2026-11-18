// Make public's own-account warning (privacy review §2.17): the wallet counts
// and spends anything under the account's payment keys, whatever the
// address's staking part (account.ts), so a destination under one of them is
// the account's own too, an enterprise address say. The first 20 keys of
// each chain always count, and those the last balance reading found. Nothing
// is asked of Koios for it. With a stake part none of the accounts' (none at
// all, or someone else's), it's the account's all the same, and says so
// (`stakeElsewhere`): its stake works for someone else, or nobody (chunk 51,
// x1a#1).
import { describe, expect, it } from "vitest";

import { SESSION_ACCOUNT_ADDRESSES_PREFIX } from "../src/background/activity";
import { FARTHER_KEYS, fartherKeys } from "../src/background/chain";
import { bech32Bytes, preprodAddress } from "./fixtures/bech32";
import { loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const phrase = (words: number) => vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!.phrase;

async function unlocked() {
  const t = testBalances();
  await t.wallet.create(phrase(12), PASSWORD);
  return t;
}

/** The 12-word phrase's payment key hash at `role/index`; `words` picks another phrase's, `of` another account. */
function keyHash(role: 0 | 1, index: number, words = 12, of = 0): string {
  const account = loadTestWasm().CardanoAccount.fromPhrase(phrase(words), of);
  try {
    return account.paymentKeyHash(role, index);
  } finally {
    account.free();
  }
}

/** The 12-word phrase's account `of`'s stake key hash, hex. */
function stakeHash(of = 0): string {
  const wasm = loadTestWasm();
  const account = wasm.CardanoAccount.fromPhrase(phrase(12), of);
  try {
    return Buffer.from(bech32Bytes(account.stakeAddress(wasm.Network.Preprod)).slice(1)).toString("hex");
  } finally {
    account.free();
  }
}

describe("a destination under the account's own payment key", () => {
  it("is the account's own, with no staking part: an enterprise address", async () => {
    const t = await unlocked();
    for (const [role, index] of [
      [0, 0],
      [1, 19],
    ] as const) {
      const address = preprodAddress(keyHash(role, index));
      expect(await t.withdraw.resolve("preprod", address)).toEqual({ address, own: true, ownAccount: 0, stakeElsewhere: true });
    }
    expect(t.koios.calls).toHaveLength(0);
  });

  it("past the first 20 keys, is the account's own once the last reading found that key", async () => {
    const t = await unlocked();
    const far = keyHash(0, 25);
    const address = preprodAddress(far);
    expect(await t.withdraw.resolve("preprod", address)).toEqual({ address, own: false });
    await t.session.set(SESSION_ACCOUNT_ADDRESSES_PREFIX + "preprod", { stake: "stake_test1", addresses: [], keys: [far] });
    expect(await t.withdraw.resolve("preprod", address)).toEqual({ address, own: true, ownAccount: 0, stakeElsewhere: true });
  });

  it("isn't when the key is someone else's", async () => {
    const t = await unlocked();
    const address = preprodAddress(keyHash(0, 0, 15));
    expect(await t.withdraw.resolve("preprod", address)).toEqual({ address, own: false });
  });
});

// The 2026-11-02 bounty report: anyone can pair their own payment key with the
// account's stake key, public in every address it hands out, and Send said a
// payment there came back. Its payment key says whose it is; the stake key
// alone makes it `staked`, for the screens to say it isn't the user's.
describe("a destination under the account's stake key", () => {
  it("isn't the account's own under someone else's payment key", async () => {
    const t = await unlocked();
    const address = preprodAddress(keyHash(0, 0, 15), stakeHash());
    expect(await t.withdraw.resolve("preprod", address)).toEqual({ address, own: false, staked: 0 });
    expect(t.koios.calls).toHaveLength(0);
  });

  it("is under one of its own keys past the first 20, as another wallet of the phrase may hand out", async () => {
    const t = await unlocked();
    const address = preprodAddress(keyHash(1, 300), stakeHash());
    expect(await t.withdraw.resolve("preprod", address)).toEqual({ address, own: true, ownAccount: 0 });
  });

  it("is looked for as far along each chain as a site's prompt and Lovejoin look, and no further", async () => {
    // WebAssembly's OWN_KEYS_STAKED and chain.ts's FARTHER_KEYS agreed only by a comment (1.7.2's release review,
    // pr359#4).
    const t = await unlocked();
    const account = loadTestWasm().CardanoAccount.fromPhrase(phrase(12), 0);
    try {
      for (const role of [0, 1] as const) {
        const [last, past] = [keyHash(role, FARTHER_KEYS - 1), keyHash(role, FARTHER_KEYS)];
        expect(fartherKeys((r, i) => account.paymentKeyHash(r, i), [last, past])).toEqual([last]);
        const reached = preprodAddress(last, stakeHash());
        expect(await t.withdraw.resolve("preprod", reached)).toEqual({ address: reached, own: true, ownAccount: 0 });
        const beyond = preprodAddress(past, stakeHash());
        expect(await t.withdraw.resolve("preprod", beyond)).toEqual({ address: beyond, own: false, staked: 0 });
      }
    } finally {
      account.free();
    }
  });

  it("says whose stake key it carries, and another account's payment key still makes it that account's", async () => {
    const t = await unlocked();
    await t.accounts.add(1);
    const staked = preprodAddress(keyHash(0, 0, 15), stakeHash(1));
    expect(await t.withdraw.resolve("preprod", staked)).toEqual({ address: staked, own: false, staked: 1 });
    const theirs = preprodAddress(keyHash(0, 0, 12, 1), stakeHash(0));
    expect(await t.withdraw.resolve("preprod", theirs)).toEqual({ address: theirs, own: true, ownAccount: 1 });
  });
});

// Chunk 51, x1a#1: anyone can pair the account's receive key 0/0, public in every address it hands out, with their own
// stake key. What's paid there is the account's, by its payment key, and comes back to the balance; but while it's there
// its stake earns, and votes, for the stranger's key. The worker told it from the Receive address by nothing, so Send
// and Make public said of it exactly what they say of the Receive address. The sign window says so of the same shape.
describe("a destination under the account's payment key, with a stake part none of its accounts'", () => {
  /** Any 28 bytes: a stake key that isn't any account's of this phrase. */
  const STRANGERS_STAKE = "cd".repeat(28);

  it("is the account's own, and says its stake isn't the account's: someone else's stake key", async () => {
    const t = await unlocked();
    const planted = preprodAddress(keyHash(0, 0), STRANGERS_STAKE);
    expect(await t.withdraw.resolve("preprod", planted)).toEqual({ address: planted, own: true, ownAccount: 0, stakeElsewhere: true });
    // The Receive address, the same payment key under the account's own stake key, says nothing of the kind.
    const receive = (await t.wallet.account("preprod")).receiveAddress;
    expect(preprodAddress(keyHash(0, 0), stakeHash())).toBe(receive);
    expect(await t.withdraw.resolve("preprod", receive)).toEqual({ address: receive, own: true, ownAccount: 0 });
    expect(t.koios.calls).toHaveLength(0);
  });

  it("is another account's own the same way, and not when the stake key is another of the user's accounts'", async () => {
    const t = await unlocked();
    await t.accounts.add(1);
    const strangers = preprodAddress(keyHash(0, 0, 12, 1), STRANGERS_STAKE);
    expect(await t.withdraw.resolve("preprod", strangers)).toEqual({ address: strangers, own: true, ownAccount: 1, stakeElsewhere: true });
    // Account 2's key under account 1's stake key: the stake is the user's, in account 1.
    const ours = preprodAddress(keyHash(0, 0, 12, 1), stakeHash(0));
    expect(await t.withdraw.resolve("preprod", ours)).toEqual({ address: ours, own: true, ownAccount: 1 });
    const ourOther = preprodAddress(keyHash(0, 0), stakeHash(1));
    expect(await t.withdraw.resolve("preprod", ourOther)).toEqual({ address: ourOther, own: true, ownAccount: 0 });
  });
});
