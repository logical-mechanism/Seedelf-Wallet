// A `drep_deposit` from Koios off the network's (over its 5,000 ₳ cap, or not
// a number) is unknown, not an error. Every build parses the same epoch_params
// row, and every payment failed over a figure only a DRep's registration
// uses: now the registration alone refuses, and the screens, which count
// with it, read it as unknown.
import { afterEach, describe, expect, it } from "vitest";

import { epochParams, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
/** The 15-word phrase's receive address: someone else's. */
const THEIRS = account(15).preprod.receive_0 as string;
const LOGIC_DREP = "drep1ydmraa6kv8cvmry059v608tehl50nfmg0z764lmsqkvwurs40sw2z";

const row = epochParams[0] as Record<string, unknown>;
const recorded = row.drep_deposit;
afterEach(() => {
  row.drep_deposit = recorded;
});

async function unlocked() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  return t;
}

describe("a DRep deposit off the network's", () => {
  it.each(["5000000001", "five hundred", 500_000_000.5])("%s: payments build, a registration refuses", async (off) => {
    row.drep_deposit = off;
    const t = await unlocked();
    await expect(t.send.build("preprod", [{ to: THEIRS, lovelace: "3000000", tokens: [] }])).resolves.toBeDefined();
    const vote = await t.staking.build("preprod", { kind: "vote", drep: LOGIC_DREP });
    expect(vote.drep).toBe(LOGIC_DREP);
    await expect(t.staking.build("preprod", { kind: "drep-register", delegate: false })).rejects.toThrow(
      "registering a DRep locks up",
    );
  });

  it("is unknown on the screens, which counted with it and threw while they drew", async () => {
    const t = await unlocked();
    expect((await t.staking.ownDrep("preprod")).depositNow).toBe("500000000");
    for (const off of ["five hundred", 1e21, null]) {
      row.drep_deposit = off;
      const own = await t.staking.ownDrep("preprod");
      expect(own.status, String(off)).toBe("not_registered");
      expect(own.depositNow, String(off)).toBeUndefined();
    }
  });
});
