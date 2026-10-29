// WebAssembly that traps outside the wallet's queue as a session's money
// comes back (a Lovejoin chain's cross-check calls it directly) leaves an
// instance wasm.ts calls broken for good: the wallet locks, and the next
// unlock carries on with a fresh one. Only Send's return used to lock, since
// its request was the one path that handed the trap to sw.ts's answerUi.
// Bring everything back listed the session as left out with the trap's raw
// word, "unreachable", in any language, and built the next session's return
// on the broken instance; a swap or a mix that runs itself recorded the trap
// as a failure and tried again every 30 s, with the wallet open.
import { describe, expect, it, vi } from "vitest";

import { CHAIN_CUT } from "../src/background/lovejoin";
import { runNetworks, type Runner } from "../src/background/runs";
import { SESSION_CLAIM, type SessionService } from "../src/background/sessions";
import { WalletLocked, WASM_BROKEN } from "../src/background/wallet";
import { isTrap } from "../src/background/wasm";
import { account, AGREES, atSession, CHAINS, lovejoinOf, PASSWORD, POOL, publicFunded, sessionsOf, withSession, type Tested } from "./chain-fixtures";
import { testBalances } from "./fakes";
import { txIdOf } from "./fixtures/cbor";

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

/**
 * An unlocked wallet with a mix from the private balance that runs itself, funded: 40 ₳ and its 5 ₳ collateral at its
 * account. `depth`: its box's mixes, each a transaction of its chain.
 */
async function runningMix(depth = 1) {
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
          lovejoin: { depth, delay: "6-24" },
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

  it("ends Bring everything back's Send with a trap in a chain's sending, sends no other return on it, and the lock cuts that chain", async () => {
    const t = await twoSites();
    const sessions = sessionsOf(t);
    const built = await sessions.claimBuild("preprod", [0, 1]);
    expect(built.returns.map((r) => r.index)).toEqual([0, 1]);
    const kept = (await t.wallet.withKeys(() => t.deps.session.get<Array<{ txHash: string; chain?: Array<{ txHash: string }> }>>(SESSION_CLAIM)))!;
    // Session 1's, its own or its chain's: here it comes back directly, session 0's chain holding the pool's boxes.
    const one = [kept[1]!.txHash, ...(kept[1]!.chain ?? []).map((tx) => tx.txHash)];
    // Stands in for WebAssembly's own as session 0's chain is sent (with Send's budget, a collateral's mix built
    // again: its witness).
    vi.spyOn(t.lovejoin, "chainSent").mockRejectedValueOnce(new WebAssembly.RuntimeError("unreachable"));
    const e = await sessions.claimSubmit("preprod", built.returns.map((r) => r.txHash)).catch((x: unknown) => x);
    // What answerUi (sw.ts) locks the wallet for, never a session that failed for "unreachable"; session 1's return
    // isn't sent on the broken instance (1.7.0's review of the fixes, worker#0).
    expect(e).toBeInstanceOf(WebAssembly.RuntimeError);
    expect(t.koios.submitted.map((b) => txIdOf(b)).filter((h) => one.includes(h))).toEqual([]);
    // Locked as answerUi locks, session 0's chain reads as the lock cut it: never still being sent, nor stopped for the
    // trap's raw word.
    await t.wallet.trapped();
    await t.wallet.unlock(PASSWORD);
    await sessions.runAll("preprod");
    expect((await sessions.list("preprod")).find((v) => v.index === 0)!.chain).toMatchObject({ stopped: CHAIN_CUT() });
    expect((await t.lovejoin.status("preprod")).chains).toMatchObject([{ session: 0, stopped: CHAIN_CUT() }]);
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

// 1.7.0's release review, x-merge#1: the alarm's run took every failure of a chain's sending and of the look for a return
// nothing steps (a site's session, a hand-run swap, a paused one), traps too, so runs.ts never locked for them; and a
// chain's sending recorded a trap's raw word as why it stopped, before any lock. The trap stands in for WebAssembly's
// own under Lovejoin's look at where a chain's transactions are (watchOf: its read of the pools verifies them there).
describe("WebAssembly that traps under the alarm's run, as a chain or a return nothing steps comes back", CHAINS, () => {
  const trap = () => new WebAssembly.RuntimeError("unreachable");

  /** The worker's run on the sessions alarm (runs.ts), over `t`'s services with `sessions`. */
  function alarmRun(t: Tested, sessions: SessionService) {
    const ctx = { networks: ["preprod"], wallet: t.wallet, sessions, lovejoin: t.lovejoin, pending: t.pending } as unknown as Runner;
    return runNetworks(ctx, { start: async () => undefined, stop: async () => undefined, starts: () => 0 });
  }

  it("locks the wallet when a site's return's chain traps as the alarm sends more of it, and the chain reads as a lock cut it", async () => {
    const { t, sessions } = await withSession("40000000");
    const review = await sessions.backBuild("preprod", 0);
    // Its first window sent: the rest is the alarm's, nothing stepping a site's session.
    await sessions.backSubmit("preprod", review.txHash);
    const watch = vi.spyOn(t.lovejoin, "watchOf").mockRejectedValue(trap());
    await alarmRun(t, sessions);
    expect(watch).toHaveBeenCalled();
    expect(await t.wallet.state()).toBe("locked");
    expect(t.wallet.lockReason()).toBe("trap");
    // Unlocked, the lock cut it, in the user's words, never "unreachable": on the session and in Lovejoin's record alike.
    watch.mockRestore();
    await t.wallet.unlock(PASSWORD);
    await sessions.runAll("preprod");
    expect((await sessions.list("preprod"))[0]!.chain).toMatchObject({ stopped: CHAIN_CUT() });
    expect((await t.lovejoin.status("preprod")).chains).toMatchObject([{ session: 0, stopped: CHAIN_CUT() }]);
  });

  it("locks it when a chain traps under a mix's own step, the chain cut by the lock, not stopped for the trap's raw word", async () => {
    // Two deep: a chain longer than the transactions that wait in the mempool at once.
    const t = await runningMix(2);
    const sessions = sessionsOf(t);
    // Its step sends the return's chain, a block's worth: the rest waits for its next steps.
    await sessions.advance("preprod", 0, true);
    expect((await sessions.list("preprod"))[0]!.chain).toMatchObject({ total: 6, sent: 4 });
    const watch = vi.spyOn(t.lovejoin, "watchOf").mockRejectedValue(trap());
    const e = await sessions.advance("preprod", 0, true).catch((x: unknown) => x);
    expect(watch).toHaveBeenCalled();
    expect(e).toBeInstanceOf(WalletLocked);
    expect(t.wallet.lockReason()).toBe("trap");
    watch.mockRestore();
    await t.wallet.unlock(PASSWORD);
    await sessions.runAll("preprod");
    expect((await sessions.list("preprod"))[0]!.chain).toMatchObject({ stopped: CHAIN_CUT() });
    expect((await t.lovejoin.status("preprod")).chains).toMatchObject([{ session: 0, stopped: CHAIN_CUT() }]);
  });

  it("locks it when a mix from the public account traps as the alarm sends more of it, the chain cut by the lock, not stopped for the trap's raw word", async () => {
    // A session's chain's sibling (1.7.0's review of the fixes, worker#1).
    const t = await publicFunded();
    const mix = await t.lovejoin.publicBuild("preprod", 1);
    // Its first window sent: the rest is the alarm's.
    await t.lovejoin.publicSubmit("preprod", mix.txHash);
    const watch = vi.spyOn(t.lovejoin, "watchOf").mockRejectedValue(trap());
    await alarmRun(t, sessionsOf(t));
    expect(watch).toHaveBeenCalled();
    expect(await t.wallet.state()).toBe("locked");
    expect(t.wallet.lockReason()).toBe("trap");
    watch.mockRestore();
    await t.wallet.unlock(PASSWORD);
    expect((await t.lovejoin.status("preprod")).chains).toMatchObject([{ stopped: CHAIN_CUT() }]);
    expect(await t.lovejoin.progress("preprod")).toMatchObject({ stopped: CHAIN_CUT() });
  });

  it("locks it when the look for a site's return, its history still to write, traps", async () => {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
    const now = t.clock.now;
    const mix = "e1".repeat(32);
    const back = "e2".repeat(32);
    // Its return's chain went whole, its last mix and the return not seen yet, the history not opening as it went: the
    // alarm's runs look for them (settleReturns).
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: now,
          txs: [
            { kind: "out", txHash: "ab".repeat(32), at: now, confirmed: true },
            { kind: "deposit", txHash: "e0".repeat(32), at: now, confirmed: true },
            { kind: "mix", txHash: mix, at: now },
            { kind: "back", txHash: back, at: now, summary: { index: 0, lovelace: "39000000", tokens: [], fee: "300000" } },
          ],
          chain: { total: 3, last: back, at: now },
          site: { origin: "https://example.org" },
        },
      ],
    });
    const sessions = sessionsOf(t);
    const watch = vi.spyOn(t.lovejoin, "watchOf").mockRejectedValue(trap());
    await alarmRun(t, sessions);
    expect(watch).toHaveBeenCalledWith("preprod", [mix]);
    expect(await t.wallet.state()).toBe("locked");
    expect(t.wallet.lockReason()).toBe("trap");
  });

  it("keeps a chain's other failures as they were: said on the session as why it stopped, the wallet open", async () => {
    const { t, sessions } = await withSession("40000000");
    const review = await sessions.backBuild("preprod", 0);
    await sessions.backSubmit("preprod", review.txHash);
    const watch = vi.spyOn(t.lovejoin, "watchOf").mockRejectedValue(new Error("The record won't open."));
    await alarmRun(t, sessions);
    expect(watch).toHaveBeenCalled();
    expect(await t.wallet.state()).toBe("unlocked");
    expect((await sessions.list("preprod"))[0]!.chain).toMatchObject({ stopped: "The record won't open." });
  });
});
