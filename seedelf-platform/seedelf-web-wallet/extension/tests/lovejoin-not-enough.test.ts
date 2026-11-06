// Lovejoin's refusal when its pool has too few boxes for a mix (release
// review C44): the depth is a plural of its own, as the session's skip
// reason says it, so one wave deep (a Settings choice) reads "1 wave deep",
// never "1 waves deep". Its count is the boxes'. The other languages carry
// `{{deep}}` too (tests/i18n.test.ts holds every locale to en.json's tokens).
// The pool is v2's 5 ₳ one: the classic pool, retired, refuses a mix before it's read (chunk 44).
import { describe, expect, it } from "vitest";

import { account, PASSWORD } from "./chain-fixtures";
import { testBalances } from "./fakes";
import { ADA, ADA_POOL } from "./v2-pools";

/** An unlocked wallet at `depth`, on a pool with no boxes but its own (none). */
async function emptyPool(depth: 1 | 2 | 3) {
  const t = testBalances({ pools: [ADA_POOL] });
  await t.wallet.create(account(12).phrase, PASSWORD);
  await t.deps.preferences.set({ lovejoinDepth: depth });
  return t;
}

describe("the pool too thin for a mix (release review C44)", () => {
  it("says one wave deep in the singular, and more in the plural, for one box or several", async () => {
    const one = await emptyPool(1);
    await expect(one.lovejoin.fits("preprod", 1, ADA)).rejects.toThrow(
      "Lovejoin's pool has 0 boxes to mix with, and a box 1 wave deep needs 2. Mix fewer, or less deep (Settings, Lovejoin).",
    );
    await expect(one.lovejoin.fits("preprod", 3, ADA)).rejects.toThrow("and 3 boxes 1 wave deep need 6.");
    const two = await emptyPool(2);
    await expect(two.lovejoin.fits("preprod", 1, ADA)).rejects.toThrow("and a box 2 waves deep needs 8.");
  });
});
