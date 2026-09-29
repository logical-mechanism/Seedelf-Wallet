// A Lovejoin withdraw that may have gone through isn't sent again at the
// moment of an unlock that came while Koios was asked about it: a run whose
// tx_status call outlasted a lock and an unlock leaves the resend to the
// next run, which draws its wait into the new unlock, as a new withdraw's
// does (privacy review §3.1, independent review L11, final review F6).
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService, UNLOCK_WAIT_MS } from "../src/background/lovejoin";
import { SESSION_SPENT } from "../src/background/spent";
import { SESSION_UNLOCKED_AT } from "../src/background/wallet";
import { txIdOf } from "./fixtures/cbor";
import { bytes, swapTx } from "./fixtures/swap-tx";
import { busyFor, loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const HOUR = 3_600_000;
const PHRASE = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase;
const SLOW = { timeout: 30_000 };
const POOL = (
  JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }
).pool;

type T = ReturnType<typeof testBalances>;

interface Kept {
  unlock?: number;
  withdrawing?: { txHash: string; sentAt: number; waitUntil?: number; unlock?: true };
}
const kept = async (t: T) => (await t.store.get<Kept>("lovejoin.preprod"))!;

/**
 * An unlocked wallet, unlocked an hour ago with that unlock's draws made, and
 * a withdraw Koios didn't answer ten minutes ago, not on chain yet.
 */
async function maybeSent() {
  const t = testBalances();
  await t.wallet.create(PHRASE, PASSWORD);
  t.koios.addedToAccounts.push(...POOL);
  const unlocked = t.clock.now - HOUR;
  await t.wallet.withKeys(() => t.session.set(SESSION_UNLOCKED_AT, unlocked));
  const cbor = swapTx();
  const txHash = txIdOf(bytes(cbor));
  const at = t.clock.now - 10 * 60_000;
  await t.store.set("lovejoin.preprod", {
    due: [],
    unlock: unlocked,
    withdrawing: { txHash, txCbor: cbor, lovelace: "9700000", fee: "300000", at, sentAt: at },
  });
  await t.wallet.withKeys(() => t.session.set(SESSION_SPENT, { [txInputs(bytes(cbor))[0]!]: at }));
  t.koios.missing.add(txHash);
  const lovejoin = new LovejoinService({
    ...t.deps,
    wasm: loadTestWasm(),
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
  });
  return { t, lovejoin, txHash, unlocked };
}

const resent = (t: T, txHash: string) => t.koios.submitted.filter((b) => txIdOf(b) === txHash).length;

describe("a withdraw that may have gone through, and an unlock while Koios is asked (final review F6)", SLOW, () => {
  it("isn't sent again at that unlock: the next run draws its wait into it, and it goes then", async () => {
    const { t, lovejoin, txHash } = await maybeSent();
    // Koios is slow to answer tx_status; meanwhile the wallet locks, and the user unlocks it again.
    const real = t.koios.fetch;
    let again: number | undefined;
    t.koios.fetch = async (url, init) => {
      if (url.endsWith("/tx_status") && again === undefined) {
        await t.wallet.lock();
        t.clock.now += 40_000;
        await t.wallet.unlock(PASSWORD);
        again = t.clock.now;
        t.clock.now += 2_000;
      }
      return real(url, init);
    };
    await lovejoin.withdrawDue("preprod", false, t.clock.now);
    t.koios.fetch = real;
    expect(again).toBeDefined();
    expect(resent(t, txHash)).toBe(0);
    // The next run makes the new unlock's draw: a fresh wait from it, then the resend.
    await lovejoin.withdrawDue("preprod", false, t.clock.now);
    const w = (await kept(t)).withdrawing!;
    expect((await kept(t)).unlock).toBe(again);
    expect(w.unlock).toBe(true);
    expect(w.waitUntil).toBeGreaterThanOrEqual(again! + UNLOCK_WAIT_MS[0]);
    expect(resent(t, txHash)).toBe(0);
    await busyFor(t, w.waitUntil! - t.clock.now);
    await lovejoin.withdrawDue("preprod", false, t.clock.now);
    expect(resent(t, txHash)).toBe(1);
    expect((await kept(t)).withdrawing).toMatchObject({ sentAt: t.clock.now });
  });

  it("is sent again as before when no unlock came meanwhile", async () => {
    const { t, lovejoin, txHash } = await maybeSent();
    await lovejoin.withdrawDue("preprod", false, t.clock.now);
    expect(resent(t, txHash)).toBe(1);
  });
});
