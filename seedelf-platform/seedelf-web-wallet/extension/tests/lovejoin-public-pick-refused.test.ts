// Chunk 51, gap-g2#3: the public Mix form counts UTxOs that WebAssembly's chain never takes. The chain's pick
// (chain_from_account_at) leaves out every UTxO that eval::refusal refuses: any reference script, and an inline datum
// nested past cbor::MAX_DEPTH. The form's copy of that pick (Lovejoin.tsx publicPick) leaves out only a UTxO marked
// `unspendable`, and on the public side that's a reference script whose bytes Koios doesn't give (coin-control.ts
// lists, koios.ts measurable). So a stranger's UTxO at the account, holding a reference script Koios gives the bytes
// of, or a datum too deep to read, is counted in "What Lovejoin can spend from your public account" and in the
// stepper's cap, and Review refuses the count the stepper offers. Asserted here is the right behaviour: the figure is
// what the chain can spend, and the most the stepper offers is the most the chain builds. With the real WebAssembly
// and Lovejoin v2's 5 ₳ pool, as the chain tests have them (chain-fixtures.ts publicFunded).
import { describe, expect, it } from "vitest";

import type { KoiosUtxo } from "../src/background/koios";
import * as LovejoinScreen from "../src/ui/screens/Lovejoin";
import { publicFunded, type Tested } from "./chain-fixtures";
import { deepRow, withRawRows } from "./fakes";
import { ADA, ADA_BOX } from "./v2-pools";

const { mixOffer, publicSideOf } = LovejoinScreen;

/** Real chains are built and measured in WebAssembly: seconds each, more on CI. */
const SLOW = { timeout: 300_000 };

/** A native script of one key, `[0, keyhash]`: 32 bytes of CBOR, which Koios gives, so it's measurable. */
const SCRIPT = { hash: "ab".repeat(28), size: 32, type: "timelock", bytes: `8200581c${"cd".repeat(28)}` };

/** What a stranger puts at the account's 0/0, beside e6…#0 (`at`, the row it's made like). */
type Stranger = (t: Tested, at: KoiosUtxo) => void;

/** 30 ₳ of ADA alone carrying SCRIPT. */
const withScript: Stranger = (t, at) => {
  t.koios.addedToAccounts.push({ ...at, tx_hash: "e8".repeat(32), value: "30000000", reference_script: SCRIPT } as KoiosUtxo);
};

/** 3 ₳ of ADA alone whose inline datum is a list nested 200 levels deep. */
const withDeepDatum: Stranger = (t, at) => {
  withRawRows(t.koios, at.payment_cred!, [deepRow(at, 200, { txHash: "e9".repeat(32) })]);
};

/**
 * The public account: e6…#0 holds `lovelace`, beside its 5 ₳ collateral and the stranger's UTxO, and the UTxOs of ADA
 * alone it was recorded with are kept out of payments, so e6 is the only UTxO of ADA alone the chain may spend.
 * Lovejoin one wave deep, three boxes a mix: a box costs 5 ₳ and a mix's 0.95 ₳, and the funding keeps 1.5 ₳ beside
 * them. What the page has of it: Home's figure, and the account's UTxOs as its `utxos` read gives them (coin-control's
 * lists).
 */
async function account(lovelace: string, stranger: Stranger) {
  const t = await publicFunded(lovelace);
  await t.deps.preferences.set({ lovejoinDepth: 1 });
  const at = t.koios.addedToAccounts.find((u) => u.tx_hash === "e6".repeat(32))!;
  stranger(t, at);
  const home = (await t.balances.get("preprod")).cardano;
  let { cardano: utxos } = await t.coins.lists("preprod");
  const ours = ["e6", "e8", "e9"].map((x) => x.repeat(32));
  for (const u of utxos.filter((u) => !u.tokens.length && !u.collateral && !u.locked && !ours.includes(u.txHash))) {
    ({ cardano: utxos } = await t.coins.setLocked("preprod", "cardano", `${u.txHash}#${u.index}`, true));
  }
  return { t, home, utxos };
}

/** Review of `boxes` boxes from that account: what it built, or why not. */
async function review(t: Tested, boxes: number): Promise<string> {
  return t.lovejoin.publicBuild("preprod", boxes, { pool: ADA }).then(
    (s) => `built ${s.boxes}`,
    (e: unknown) => (e as Error).message,
  );
}

/**
 * The Mix form at one box, as the page has it (Lovejoin.tsx): its figure (publicSideOf), the stepper's most (mixOffer,
 * the pool's room left at ten), and Review at that most, on a fresh copy of the account.
 */
async function mixForm(lovelace: string, stranger: Stranger) {
  const { t, home, utxos } = await account(lovelace, stranger);
  const funding = await t.lovejoin.funding("preprod", 1, false, undefined, ADA);
  const { side, mixable } = publicSideOf(home, utxos, undefined, 1);
  const { most } = mixOffer("public", side, undefined, funding, ADA_BOX, 10, 1, 0n, mixable ? utxos : undefined);
  return { depth: funding.depth, mixable, spendable: side?.lovelace, most, review: await review(t, most) };
}

describe("gap-g2#3: the public Mix form counts only what the chain's pick can spend", SLOW, () => {
  it("leaves out a stranger's UTxO holding a reference script Koios gives the bytes of", async () => {
    // What the chain pays for: three boxes from e6's 20 ₳ (19.35 ₳), and not four (25.3 ₳); the stranger's 30 ₳ never.
    expect(await review((await account("20000000", withScript)).t, 3)).toBe("built 3");
    expect(await review((await account("20000000", withScript)).t, 4)).toMatch("doesn't pay for 4 boxes");
    // The form: its figure is what the chain can spend, and its stepper offers what the chain pays for.
    expect(await mixForm("20000000", withScript)).toEqual({ depth: 1, mixable: true, spendable: "20000000", most: 3, review: "built 3" });
  });

  it("leaves out a stranger's UTxO whose datum is nested past 128 levels", async () => {
    // What the chain pays for: three boxes from e6's 24 ₳, and not four; the stranger's 3 ₳, which would make 27, never.
    expect(await review((await account("24000000", withDeepDatum)).t, 3)).toBe("built 3");
    expect(await review((await account("24000000", withDeepDatum)).t, 4)).toMatch("doesn't pay for 4 boxes");
    expect(await mixForm("24000000", withDeepDatum)).toEqual({ depth: 1, mixable: true, spendable: "24000000", most: 3, review: "built 3" });
  });
});
