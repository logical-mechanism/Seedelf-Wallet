// Make public's own-account warning (privacy review §2.17): the wallet counts
// and spends anything under the account's payment keys, whatever the
// address's staking part (account.ts), so a destination under one of them is
// the account's own too, an enterprise address say. The first 20 keys of
// each chain always count, and those the last balance reading found. Nothing
// is asked of Koios for it.
import { describe, expect, it } from "vitest";

import { SESSION_ACCOUNT_ADDRESSES_PREFIX } from "../src/background/activity";
import { preprodAddress } from "./fixtures/bech32";
import { loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const phrase = (words: number) => vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!.phrase;

async function unlocked() {
  const t = testBalances();
  await t.wallet.create(phrase(12), PASSWORD);
  return t;
}

/** The 12-word phrase's payment key hash at `role/index`; `words` picks another phrase's. */
function keyHash(role: 0 | 1, index: number, words = 12): string {
  const account = loadTestWasm().CardanoAccount.fromPhrase(phrase(words), 0);
  try {
    return account.paymentKeyHash(role, index);
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
      expect(await t.withdraw.resolve("preprod", address)).toEqual({ address, own: true, ownAccount: 0 });
    }
    expect(t.koios.calls).toHaveLength(0);
  });

  it("past the first 20 keys, is the account's own once the last reading found that key", async () => {
    const t = await unlocked();
    const far = keyHash(0, 25);
    const address = preprodAddress(far);
    expect(await t.withdraw.resolve("preprod", address)).toEqual({ address, own: false });
    await t.session.set(SESSION_ACCOUNT_ADDRESSES_PREFIX + "preprod", { stake: "stake_test1", addresses: [], keys: [far] });
    expect(await t.withdraw.resolve("preprod", address)).toEqual({ address, own: true, ownAccount: 0 });
  });

  it("isn't when the key is someone else's", async () => {
    const t = await unlocked();
    const address = preprodAddress(keyHash(0, 0, 15));
    expect(await t.withdraw.resolve("preprod", address)).toEqual({ address, own: false });
  });
});
