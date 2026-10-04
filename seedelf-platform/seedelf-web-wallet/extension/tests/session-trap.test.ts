// WebAssembly that traps outside the wallet's queue as a session's money
// comes back (a Lovejoin chain's cross-check calls it directly) leaves an
// instance wasm.ts calls broken for good: the wallet locks, and the next
// unlock carries on with a fresh one. Only Send's return used to lock, since
// its request was the one path that handed the trap to sw.ts's answerUi.
// Bring everything back listed the session as left out with the trap's raw
// word, "unreachable", in any language, and built the next session's return
// on the broken instance; a swap or a mix that runs itself recorded the trap
// as a failure and tried again every 30 s, with the wallet open.
import { describe, expect, it } from "vitest";

import { SESSION_CLAIM } from "../src/background/sessions";
import { WalletLocked, WASM_BROKEN } from "../src/background/wallet";
import { isTrap } from "../src/background/wasm";
import { account, AGREES, atSession, CHAINS, lovejoinOf, PASSWORD, POOL, sessionsOf, type Tested } from "./chain-fixtures";
import { testBalances } from "./fakes";

type Book = { sessions: Array<{ auto?: { retry?: unknown } }> };

/** Lovejoin with every chain it builds trapping, as a broken instance's cross-check does; `built.calls` counts them. */
function trapping(t: Tested) {
  const lovejoin = lovejoinOf(t);
  const built = { calls: 0 };
  lovejoin.chain = async () => {
    built.calls++;
    throw new WebAssembly.RuntimeError("unreachable");
  };
  return { lovejoin, built };
}

/** An unlocked wallet with two sites' private sessions, 0 and 1, each holding 40 ₳ and its 5 ₳ collateral, and Lovejoin's pool. */
async function twoSites() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  const one = await t.wallet.withKeys((keys) => ({
    address: keys.oneTime.address(t.deps.wasm.Network.Preprod, 1),
    keyHash: keys.oneTime.keyHash(1),
  }));
  const now = t.clock.now;
  const site = (index: number, origin: string, txHash: string) => ({
    index,
    ownStake: true,
    createdAt: now,
    txs: [{ kind: "out", txHash, at: now, confirmed: true }],
    site: { origin },
  });
  await t.store.set("sessions.preprod", {
    next: 2,
    sessions: [site(0, "https://example.org", "ab".repeat(32)), site(1, "https://example.com", "cd".repeat(32))],
  });
  const atOne = (txHash: string, txIndex: number, value: string) => ({
    ...atSession(txHash, txIndex, value),
    address: one.address,
    payment_cred: one.keyHash,
  });
  t.koios.addedToAccounts.push(
    atSession("c1".repeat(32), 0, "40000000"),
    atSession("c2".repeat(32), 1, "5000000"),
    atOne("d1".repeat(32), 0, "40000000"),
    atOne("d2".repeat(32), 1, "5000000"),
    ...POOL,
  );
  t.koios.evaluation = AGREES;
  return t;
}

/** An unlocked wallet with a mix from the private balance that runs itself, funded: 40 ₳ and its 5 ₳ collateral at its account. */
async function runningMix() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  const now = t.clock.now;
  await t.store.set("sessions.preprod", {
    next: 1,
    sessions: [
      {
        index: 0,
        ownStake: true,
        createdAt: now,
        txs: [{ kind: "out", txHash: "ab".repeat(32), at: now, confirmed: true }],
        mix: { boxes: 1 },
        auto: {
          approved: { minAmountOut: "0", fund: { lovelace: "40000000", tokens: [] } },
          direct: false,
          lovejoin: { depth: 1, delay: "6-24" },
        },
      },
    ],
  });
  t.koios.addedToAccounts.push(atSession("c1".repeat(32), 0, "40000000"), atSession("c2".repeat(32), 1, "5000000"), ...POOL);
  t.koios.evaluation = AGREES;
  return t;
}

describe("WebAssembly that traps outside the wallet's queue as a session's money comes back", CHAINS, () => {
  it("ends Bring everything back with the trap itself, which its request turns into a lock, and builds nothing more on it", async () => {
    const t = await twoSites();
    const { lovejoin, built } = trapping(t);
    const e = await sessionsOf(t, undefined, lovejoin)
      .claimBuild("preprod", [0, 1])
      .catch((x: unknown) => x);
    // What answerUi (sw.ts) locks the wallet for, never a session left out for "unreachable".
    expect(e).toBeInstanceOf(WebAssembly.RuntimeError);
    expect(isTrap(e)).toBe(true);
    // Session 1's return isn't built on the broken instance, and nothing is kept for Send.
    expect(built.calls).toBe(1);
    expect(await t.deps.session.get(SESSION_CLAIM)).toBeUndefined();
  });

  it("locks the wallet in a mix that runs itself, rather than try again on the broken instance", async () => {
    const t = await runningMix();
    const { lovejoin, built } = trapping(t);
    // The page's Try now: it hears why the wallet locked, as a request answerUi locked for would.
    const e = await sessionsOf(t, undefined, lovejoin)
      .advance("preprod", 0, true)
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(WalletLocked);
    expect((e as Error).message).toBe(WASM_BROKEN());
    expect(built.calls).toBe(1);
    expect(await t.wallet.state()).toBe("locked");
    expect(t.wallet.lockReason()).toBe("trap");
    // No failure recorded to try again: the next unlock's run takes the step afresh.
    await t.wallet.unlock(PASSWORD);
    expect((await t.store.get<Book>("sessions.preprod"))!.sessions[0]!.auto!.retry).toBeUndefined();
  });

  it("locks it from the alarm's run too, where no page's request is answered", async () => {
    const t = await runningMix();
    const { lovejoin, built } = trapping(t);
    // As runs.ts runs it: what fails once the wallet has locked is the run's to swallow.
    await sessionsOf(t, undefined, lovejoin)
      .runAll("preprod")
      .catch(() => false);
    expect(built.calls).toBe(1);
    expect(await t.wallet.state()).toBe("locked");
    expect(t.wallet.lockReason()).toBe("trap");
  });
});
