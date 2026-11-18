# gap-g3#1: verification

From lane gap-G3, graded low by its finder.

## Trace: confirmed, low

It holds, and a run shows it. The quiet rule only ever holds a withdraw after the wallet's own send. No automatic sender holds back after a withdraw:
- the alarm's run puts every session step first and the withdraw last;
- the sessions runner's `go` reads only the unlock's wait.

So the next run sends the wallet's next transaction a minute after a box's way back. My test drives the real runNetworks. A swap's funding lands one run after a due box's withdraw, and the alarm's next run places the swap's order 60,000 ms after the withdraw.

privacy.md:440 (1d41dfed, 2026-11-17, after the web-wallet/1.9.1 tag) promises "rules that keep its way back from lining up with anything else the wallet does". That is wider than the code. :442's "within 5 minutes of the wallet's own send" reads two-sided too. 1.9.1's privacy.md:221, privacy review §3.1 and d74677a9's own subject are all one-way, as the code is.

One narrowing of the finder's scope: architecture.md:716 is headed "Quiet after a send", so it states the one-way rule correctly. Fix (b) needs only privacy.md.

Graded low, as the finder had it:
- **Who:** the user, by an ordinary action (a swap or mix that runs itself, whose trigger lands just after a withdraw).
- **Cost:** a timing hint for a chain observer. The server and giveme.my learn nothing new (privacy.md:235), and privacy.md:14 already says timing isn't hidden. No money is at stake.
- **Way out:** no stuck state to get out of. The only wrong thing is the doc's promise.

**Evidence:**

Trace. Paths are under TREE/seedelf-platform/seedelf-web-wallet/extension/src/background/ unless named.

The rule is one way:
1. lovejoin.ts:1689-1698 (QUIET_AFTER_SEND_MS): "No box goes back within this long of the wallet's own last send ... a withdraw minutes after a payment says both are one owner's."
2. quiet() (:1750) is called only at :6904 (withdrawDueNow) and :7900 (the withdraw's resend).
3. wallet.sends() is read only at lovejoin.ts:6901 and :7895. grep finds no sends(), lastSpentAt or QUIET in sessions.ts, parts.ts, pending.ts or runs.ts.

Nothing holds the withdraw while a mix or swap session's funding is landing:
- :6793 mixingAgain is true only for `again` sessions (sessions.ts:1279-1288).
- :6796 chainsMixing counts only recorded chains (:5926). A session's chain is recorded only at sendChain. `mixing` (:1468) also leaves out chains whose collateral's mix alone waits (tailWaits, :1461).

The run order:
- runs.ts:80-92 runs the sessions, pumpPublic, the pending watch and the parts first.
- runs.ts:93-102 runs withdrawDue last.
- sw.ts:84-93 sets the alarm to every minute. sw.ts:112-130 runs an `asked` run at once after a long one.

The senders:
- sessions.ts:3806-3807 `const go = async (send) => { if (!(await this.waits(network, s, run))) await send(); }`. waits (:3940-3966) reads only unlockedAt and unlockWait.
- `go` covers a mix (:3811 bringBack), a swap's order (:3837) and the return after a fill (:3904). The READ_EVERY_MS gate (:3642, 15 s) doesn't hold a step a minute later.
- sessions.ts:3686 (act) and :3562 (runAll) pump a pending chain with no gate at all. That includes the collateral's mix after giveme.my witnesses it (:5316 witnessTail), while withdraws aren't held by a tail-only chain. This member of the class isn't in the finder's list (traced, not run).
- parts.ts:429-461 step: the parent shown, mayGo, settleMaybeSent, then send. No timing gate.
- pending.ts:832-851 resends after RESEND_MS (pending.ts:69) from its own last try only.

The docs:
- privacy.md:440-442, blamed to 1d41dfed (2026-11-17, `git merge-base` puts it after web-wallet/1.9.1).
- 1.9.1's privacy.md:221: "...or later when the wallet has just sent something (privacy review §3.1)", which is one way.
- archive/plans/privacy-review.md:517, §3.1's ask: "No withdraw in a pass that sent anything else, or within about 5–10 min of the wallet's own submit."
- d74677a9's subject: "nor a box right after the wallet's own send".
- architecture.md:716 (d0bebd94): "Quiet after a send: none goes ...", accurate.

Runs. All from extension/, with `nice -n 10 systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m npx vitest run tests/r51-gap-g3-1.test.ts`.
- **First draft:** it failed early. It read the store's `withdrawing`, which dropWithdrawing (lovejoin.ts:7741) deletes after a successful submit.
- **Debug run:** withdrawDue was called with since = 1800000360000 and sends().sent = 1800000000000 (the funding, 6 min earlier). It returned [{kind: "lovejoin-withdraw", submittedAt: 1800000360000}]. So the withdraw went as the finder says.
- **Final test, on TREE:** it fails at :142. Run 1 sent only the withdraw: it spends e1…#0, 6 min after the funding. In run 2, a minute on, the swap's order is submitted 60000 ms after the withdraw.
- **Sketch of fix (a), in an rsync copy** at ~/.cache/seedelf-review-51/verify-gap-g3_1-trace (node_modules symlinked): withdrawOne stores its time beside rememberSpent, and waits returns true for run !== "asked" within QUIET_AFTER_SEND_MS of it. With that, the same file passed ("Test Files 1 passed (1) Tests 1 passed (1) Duration 9.58s"). The copy is removed. `git status` on TREE shows only the new test file.

**Known:** None: it isn't known. What I searched:
- backlog.md and docs/archive/plans/*.md for: after a withdraw, after the withdraw, after its withdraw, send after, sends after, right after a withdraw, either side, both ways, one-way, lining up, line up, symmetric, quiet, QUIET_AFTER, own send, wallet's last send, lastSpentAt.
- privacy-review.md §3.1 (:506-529, table :58), which asks for the rule one way.
- independent-review.md M10.
- chunk-16-lovejoin.md:19, also one way.
- chunk-46 and chunk-49 plans: nothing about the quiet rule.
- SECURITY.md's out-of-scope list: nothing about timing.

privacy.md:14 ("Not hidden: ... timing") and :235 (the server ties both ends) admit timing in general, but not this pairing, and :440 promises against it.

Inside chunk 51, x4#1's verifier noted in passing (verify/x4-1.md) that "the reverse order (a Send just after a withdraw) was never covered by the rule". That's a working note in this review, not a settled item.

**Fix notes:**

The owner chooses, as the finder says. (a) changes a timing default; (b) changes the privacy doc's promise.

**(b), the wording.** Only privacy.md needs it:
- :440 says the box's way back never follows right after something else the wallet sent. It shouldn't say that nothing lines up with it.
- :442 should read "within 5 minutes after the wallet's own send".
- architecture.md:716 ("Quiet after a send") is accurate as it stands.

Even with (a), :440 can't hold literally. The user's own Send, Make public or a site's submitTx right after a withdraw can't be held without holding the user's own action. So :440 needs (b)'s wording either way, or a note that the wallet's automatic sends wait.

**(a), the code.** Keep the last withdraw's time where the runner reads it, beside `seedelf.sends` so a lock keeps it. My copy's sketch used plain session storage, which a lock clears. The withdraws to note:
- withdrawOne's rememberSpent (lovejoin.ts:7684);
- the resend's submit.

Then hold every automatic sender within QUIET_AFTER_SEND_MS of it, with a fresh draw as the push. The class:
- sessions.ts `go`/`waits` (:3806, :3940), for runs other than "asked": a mix's bringBack, a swap's order, a cancel, the return after a fill;
- the chain pump, which skips `go` entirely (act :3686, runAll :3562). After a withdraw, only a chain's collateral mix can go that way (witnessTail, :5316), because withdraws wait for any other chain (`mixing`, lovejoin.ts:1468);
- parts.ts step (:429), when the alarm or Home's poll drives it;
- pending.ts's resend (:832).

My 3-line sketch (a stamp in withdrawOne, a check at the top of waits' run !== "asked" branch) made r51-gap-g3-1 pass in a copy. It is not a full fix: it covers only `go`.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension/tests/r51-gap-g3-1.test.ts`

Result: On TREE it fails as expected, because of the bug:
```
 ❯ tests/r51-gap-g3-1.test.ts (1 test | 1 failed) 13385ms
   ❯ r51 gap-g3#1: the wallet's own send a run after a box's withdraw (1)
     × waits out the quiet after the withdraw, as the withdraw waits out the quiet after a send 13381ms
 FAIL  tests/r51-gap-g3-1.test.ts > r51 gap-g3#1: the wallet's own send a run after a box's withdraw > waits out the quiet after the withdraw, as the withdraw waits out the quiet after a send
AssertionError: expected [ { tx: 'the swap\'s order', …(1) } ] to deeply equal []
- Expected
+ Received
- []
+ [
+   {
+     "msAfterWithdraw": 60000,
+     "tx": "the swap's order",
+   },
+ ]
 ❯ tests/r51-gap-g3-1.test.ts:142:19
 Test Files  1 failed (1)
      Tests  1 failed (1)
```

The assertions before :142 held:
- The first run sent exactly one transaction, the withdraw, which spends e1…#0.
- It went at least QUIET_AFTER_SEND_MS after the funding; the debug run showed exactly 6 min (1800000360000 against 1800000000000).

In an rsync copy with fix (a) sketched (withdrawOne notes its time beside rememberSpent; sessions.ts waits holds a step with run !== "asked" within QUIET_AFTER_SEND_MS of it), the same file passed:
```
 Test Files  1 passed (1)
      Tests  1 passed (1)
   Duration  9.58s
```
I removed the copy. No tracked file in TREE was touched.

```
// Chunk 51, gap-g3#1 (the trace verifier's test). Lovejoin's quiet rule holds a box's withdraw after the wallet's own
// send (QUIET_AFTER_SEND_MS, lovejoin.ts withdrawDueNow), but nothing holds the wallet's next send after a withdraw:
// the alarm's run puts the sessions' steps first and the withdraw last (runs.ts runEach), and a swap's step waits for
// the unlock alone (sessions.ts act's `go`, `waits`). privacy.md *Timing* says a box "comes back while the wallet is
// unlocked, under rules that keep its way back from lining up with anything else the wallet does" (:440), and "never
// in a run that sent anything else, nor within 5 minutes of the wallet's own send" (:442). The behaviour that promise
// asks for, asserted here: a swap that runs itself, whose funding lands a run after a box's withdraw, doesn't place
// its order within QUIET_AFTER_SEND_MS of that withdraw, and places it once that's over. Fails today: the alarm's next
// run, a minute on, places it.
//
// This is the finder's fix (a). Under fix (b), privacy.md saying it as the code does, this test goes.
//
// The harness is unlock-waits.test.ts's (the quiet after a send, a swap's step at the unlock) and lovejoin-withdraw-
// submit.test.ts's `due`, driven by the real runner (runs.ts runNetworks) as unseen-send-time.test.ts drives it: the
// real WebAssembly, v2's 5 ₳ pool, and fakes of Koios, giveme.my and Minswap.
import { afterEach, describe, expect, it, vi } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService, QUIET_AFTER_SEND_MS, QUIET_PUSH_MS } from "../src/background/lovejoin";
import { Minswap } from "../src/background/minswap";
import { runNetworks, type Runner } from "../src/background/runs";
import { SessionService } from "../src/background/sessions";
import { SESSION_UNLOCKED_AT } from "../src/background/wallet";
import { txIdOf } from "./fixtures/cbor";
import { bytes, swapTx } from "./fixtures/swap-tx";
import { busyFor, loadTestWasm, minswapEstimate, sessionSwap, testBalances, vectors, withdrawPreprod } from "./fakes";
import { ADA, ADA_POOL, ADA_ROWS, adaBox, madeByAdaMix, ownDatum } from "./v2-pools";

const PASSWORD = "correct horse battery";
const HOUR = 3_600_000;
const PHRASE = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase;
const SWAP = swapTx();
const SWAP_TX = txIdOf(bytes(SWAP));
/** The wallet's box in the 5 ₳ pool. */
const BOX = `${"e1".repeat(32)}#0`;
/** A funding, a withdraw and an order, each built and measured in WebAssembly. */
const SLOW = { timeout: 120_000 };

afterEach(() => void vi.restoreAllMocks());

/**
 * The 12-word phrase's wallet, unlocked an hour ago with its unlock's draws made, one box of its own in v2's 5 ₳ pool
 * (made five hours ago by someone else's mix) due an hour ago, giveme.my's witness and the one-time key's signature
 * stood in for. Returns the services and one alarm run over preprod, as the worker runs it.
 */
async function wallet() {
  const t = testBalances({ pools: [ADA_POOL] });
  // What's written ahead of a submit is stamped by the device's clock, which in the worker is the services' own (sw.ts
  // `now: Date.now`), and runs.ts takes its run's start (`since`) from it: here, the test's clock.
  vi.spyOn(Date, "now").mockImplementation(() => t.clock.now);
  await t.wallet.create(PHRASE, PASSWORD);
  // One spend: the swap's funding takes the 25 ₳ UTxO alone (unlock-waits.test.ts).
  const evaluation = withdrawPreprod.amount.evaluation as { result: unknown[] };
  t.koios.evaluation = { ...evaluation, result: evaluation.result.slice(0, 1) };
  madeByAdaMix(t.koios, "e1".repeat(32));
  t.koios.addedToAccounts.push(...ADA_ROWS, adaBox("e1", await ownDatum(t.wallet), t.clock.now));
  const unlocked = t.clock.now - HOUR;
  await t.wallet.withKeys(() => t.session.set(SESSION_UNLOCKED_AT, unlocked));
  await t.store.set("lovejoin.preprod", { due: [], pools: { [ADA]: { due: [t.clock.now - HOUR] } }, unlock: unlocked });
  const wasm = loadTestWasm();
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  t.minswap.swapCbor = SWAP;
  const signed = (request: string) => {
    const { txCbor } = JSON.parse(request) as { txCbor: string };
    return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
  };
  const collateral = () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch);
  const lovejoin = new LovejoinService({
    ...t.deps,
    wasm: { ...wasm, finishLovejoinWithdraw: signed } as typeof wasm,
    collateral,
    store: t.store,
    pools: async () => [ADA_POOL],
  });
  const sessions = new SessionService({
    ...t.deps,
    wasm: { ...wasm, signScriptSpend: (_key: unknown, request: string) => signed(request) } as typeof wasm,
    collateral,
    store: t.store,
    minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
    alarm: { start: async () => undefined },
  });
  // When Koios took each transaction, by its hash, on the test's clock.
  const at = new Map<string, number>();
  const real = t.koios.fetch;
  t.koios.fetch = async (url, init) => {
    const answer = await real(url, init);
    if (url.endsWith("/submittx")) at.set(txIdOf(t.koios.submitted.at(-1)!), t.clock.now);
    return answer;
  };
  const ctx = { networks: ["preprod"], wallet: t.wallet, sessions, lovejoin, pending: t.pending } as unknown as Runner;
  const alarm = { start: async () => undefined, stop: async () => undefined, starts: () => 0 };
  return { t, sessions, at, run: () => runNetworks(ctx, alarm) };
}

describe("r51 gap-g3#1: the wallet's own send a run after a box's withdraw", SLOW, () => {
  it("waits out the quiet after the withdraw, as the withdraw waits out the quiet after a send", async () => {
    const { t, sessions, at, run } = await wallet();
    // The user starts a swap that runs itself: its funding goes now, from the private balance.
    const funded = t.clock.now;
    const out = await sessions.outBuild("preprod", await sessions.quote("preprod", minswapEstimate.ask));
    await sessions.outSubmit("preprod", out.txHash);
    expect((await t.wallet.sends()).sent).toBe(funded);
    const sent = t.koios.submitted.length;
    const sentSince = () => t.koios.submitted.slice(sent).map((b) => txIdOf(b));

    // The funding is slow to land. Six minutes on, past the quiet after it, the alarm's run finds it not on chain yet:
    // the swap's step sends nothing, and the box due goes, last in the run.
    await busyFor(t, QUIET_AFTER_SEND_MS + 60_000);
    await run();
    // One transaction went in that run, and it's the box's way back: it spends the box.
    expect(sentSince()).toHaveLength(1);
    const withdraw = sentSince()[0]!;
    expect(txInputs(t.koios.submitted.at(-1)!)).toContain(BOX);
    const withdrawn = at.get(withdraw)!;
    expect(withdrawn - funded).toBeGreaterThanOrEqual(QUIET_AFTER_SEND_MS);
    // On chain, its box leaves the pool.
    t.koios.spent.add(BOX);

    // The funding lands, and the account holds what the recorded swap spends (unlock-waits.test.ts `funded`).
    t.koios.confirmations = 1;
    t.koios.addedToAccounts.push({
      ...ADA_ROWS[0]!,
      tx_hash: sessionSwap.utxo.tx_hash,
      tx_index: sessionSwap.utxo.tx_index,
      address: sessionSwap.address,
      value: sessionSwap.utxo.value,
      payment_cred: sessionSwap.keyHash,
      inline_datum: null,
      asset_list: [],
    } as KoiosUtxo);

    // The alarm's next run, a minute on. Nothing of the wallet's goes out within the quiet after the box's way back:
    // not the swap's order either.
    await busyFor(t, 60_000);
    await run();
    const early = sentSince()
      .filter((h) => h !== withdraw)
      .map((h) => ({ tx: h === SWAP_TX ? "the swap's order" : h, msAfterWithdraw: at.get(h)! - withdrawn }));
    expect(early).toEqual([]);

    // Held, never dropped: a run of the alarm's places it once that quiet is over (and any fresh push of it).
    const by = withdrawn + QUIET_AFTER_SEND_MS + QUIET_PUSH_MS[1] + 2 * 60_000;
    while (!sentSince().includes(SWAP_TX) && t.clock.now < by) {
      await busyFor(t, 60_000);
      await run();
    }
    expect(sentSince()).toEqual([withdraw, SWAP_TX]);
    expect(at.get(SWAP_TX)! - withdrawn).toBeGreaterThanOrEqual(QUIET_AFTER_SEND_MS);
  });
});
```
