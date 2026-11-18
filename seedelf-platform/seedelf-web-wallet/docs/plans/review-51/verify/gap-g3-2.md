# gap-g3#2: verification

From lane gap-G3, graded low by its finder.

## Trace: confirmed, low

The finding holds as described, and my test shows it failing on TREE. Its code is byte-identical to web-wallet/1.9.1 (`git diff web-wallet/1.9.1 HEAD` shows no change under src/background).

What happens:
- A site's session has no `auto`, so running() is false and act never runs for it. act holds the only rule that lets a lost step go.
- So a chain deposit Koios never answered stays in the record for good as maybe sent: `inputs` set, no `unsent`, never confirmed.
- chainSoFar then reads the chain as started for good. Every later return is built as a plain direct return, with no `lovejoin` and no `lovejoinSkipped`. The review shows no Lovejoin switch and no note.
- The page keeps saying "Stopped after 1 of 10 transactions; the rest stays at the account until you bring it back", though nothing of the chain ever reached a node.

One correction widens the reach. The two-hour wait isn't needed. I ran a lock and an unlock one minute after the stop (in a copy, to explore). The lock wipes the spent marks in session storage, while the book is kept on disk, so all 45 ₳ shows at once and the next return comes back directly: 38.82 ₳. An ordinary auto-lock (15 minutes idle) is enough.

I also confirmed the accidental way out the finder names, in the same copy:
- Without a lock, a return made inside the window brings back only the 5 ₳, as 4.83 ₳ directly.
- Once that return lands, the chain reads as finished, and the next return goes through Lovejoin.

Severity is low:
- **Who reaches it:** a user pressing Bring it back (or Bring everything back), through Lovejoin as the default has it. It also needs an honest outage while the deposit is being sent: Koios, or on mainnet the data layer then Koios, not answering any of its five tries (about 100 s), or one unanswered try followed by a 429 or "node down". And the deposit must not have reached a node. A stranger or a site can't cause it.
- **What it costs:** no money is lost or locked. It costs privacy for that one session: its spare ADA (38.82 ₳ of 45 ₳ here) comes back directly. That ties it on chain to the session and, through its funding, to the private UTxOs that paid it, which is the link the Lovejoin default exists to avoid. And it happens with no switch and no word.
- **The figures shown:** the page miscounts the chain. Until a lock, or for two hours, it also shows 5 ₳ where 45 ₳ sits. That part is L6's accepted class.
- **Way out:** only the accidental one above; no informed choice is offered.

It sits at the top of low: the harm is a privacy link made by the default flow, but only after an outage in a narrow window.

**Evidence:**

Every cited line opened in TREE (paths under seedelf-platform/seedelf-web-wallet/extension/src).

**The send, background/sessions.ts and lovejoin.ts:**
1. koios.ts:1209: a 5xx throws `KoiosBusyError(..., true, ...)`, which is maybe sent. A lost connection does the same (unreachable).
2. sendStep (sessions.ts:5395-5398): mayBeIn is false for a KoiosBusyError. chainRetryMs (lovejoin.ts:258-263, CHAIN_RETRIES = 4 at :222) retries 4 times at 10, 20, 30 and 40 s, then returns undefined, so `throw e`. Five submits in all (my run: `submits: 5`).
3. sendRecorded:
   - **First try:** no record yet, so `sentBefore` is false. In the catch, `maybe` is true, so `t.inputs = txInputs(bytes)` (:5571), and rememberSpent runs (:5579).
   - **Each retry:** `unanswered = sentBefore && !!again.inputs` is true (:5526), so `unread` is true (:5566). `else if (!unread) t.unsent = true` (:5572) is never reached.
4. pump's catch (:5331-5336) sets `s.chain.stopped`, then chainEnded, dropPending and release, and rethrows.

**Nothing lets the deposit go:**
- running() (:1269-1271) needs `s.auto`. Only mix sessions (:2339) and self-running swaps (:3165) get one. siteOutSubmit (:2141-2148) records `site: { origin }` and no auto.
- runAll steps only `running` sessions (:3554). For the others:
  - it pumps a pending chain, which dropPending removed;
  - settleReturns runs only where `waits` holds (:3569: a summary, or a funding that may still land);
  - settle() only confirms what's on chain.
- listNow's refresh (:5643-5651) also only confirms.
- lost() (:1348) is called only in act (:3696, :3702). forgetSpent is called only at :3749.
- markCut skips a chain already stopped. sendBack's direct path (:5070+) and noteLanded touch only landed returns.
- Lovejoin's chainEnded and restBack write Lovejoin's own record, never the session's.

**The return:**
- chainSoFar (:1305-1311): `since` keeps every tx without `unsent`, and `started = !finished && went.some(deposit|mix)` is true.
- buildBack: `chainSoFar` at :4534. At :4580, tailChain → tailOf (lovejoin.ts:4447: `c.sent < c.total - 2`, with c.sent 0) → undefined.
- :4616's Lovejoin branch is skipped because `started` is true. `restOnItsWay` (:4556) is false, since no "back" was sent.
- So `said` (:4804) is empty, and the return carries no lovejoin and no lovejoinSkipped.
- UI, ui/components/LovejoinReturn.tsx: LovejoinSwitch returns null at :376 (`!back.lovejoin && through`), and LovejoinNote at :421.
- chainView counts the deposit, and chainText's byHand words are en.json:1006.

**Since:** c138b3b0, 1340fba1 and 6b65c3cf are all ancestors of 1.0.0's commit 0d5ec42 (releases.md) and of every tag from web-wallet/1.6.0 to 1.9.1.

**The fix check, in a copy** (rsync to ~/.cache/seedelf-review-51/verify-gap-g3_2, node_modules symlinked; removed after):
- I added the finder's rule to listNow's refresh: a deposit or mix of a session that isn't running, kept maybe sent past LOST_AFTER_MS, not on chain, and whose inputs utxo_info shows unspent, is dropped, and its inputs are freed with forgetSpent.
- My test then PASSED. The return went through Lovejoin again: `lovejoin: {boxes: 6, depth: 1, mixes: 6, txs: 10, ...}`, 3.65 ₳ coming back directly, and the view's chain read `sent: 0`.

**Exploration, in the same copy with the fix reverted:**
- `LOCK {"chain":{"total":10,"sent":1,...},"holding":"45000000","lovejoin":false,"lovelace":"38822242","tail":true}`: a lock and an unlock one minute after the stop.
- `WINDOW {"lovejoin":false,"lovelace":"4829439","tail":false}`, then `LATER {"lovejoin":true,...}`: the 5 ₳ brought back inside the window, then the next return.

`npx tsc --noEmit -p tsconfig.json` reports no error in the new test, and no tracked file in TREE changed.

**Known:** Not known. Searched:
- **backlog.md** for: maybe sent, didn't answer, never answered, LOST_AFTER, lost rule, by hand, site's session plus chain. I also read every backlog line naming answer, maybe, deposit, chain or site. Line 125 is only the wording for a mix's chain cut before it began.
- **docs/archive/plans/*.md** for: LOST_AFTER, act's lost, as lost, "didn't answer" with deposit, chain or session, sessions-1, F11, L5, L23. I read the independent review's Not fixed and Disputed lists too. chunk-34:593 is about Lovejoin's own record.
- **chunk-46, chunk-49 and chunk-51's plans,** SECURITY.md (an honest outage isn't a dishonest source), and INDEX.md for duplicates.

What's related:
- **L6 (independent review, Not fixed):** "a site's transaction that never lands hides its inputs for up to 2 h. A lock clears it." That's the same class as part (1)'s two-hour hiding, so part (1) is accepted. But L6 is about a site's own transactions, and says nothing of the lasting `started` that makes every later return direct.
- **L5:** fixed the twin of this for public mixes (maybe-sent lookup).
- **F11:** made unanswered retries stay maybe sent.
- **L17's test** (return-chain-scope.test.ts:132-149): covers only a first transaction refused outright.
- **e2b#1:** a different chainSoFar path (a finished mix).

**Fix notes:**

The finder's fix is sound, and a sketch of it makes the test pass. I added it in a copy only, to listNow's refresh, and removed the copy after.

Recommended shape: one helper shared by act's rule (sessions.ts:3701-3749) and the paths that serve sessions nothing steps:
- runAll's loop over sessions that don't run themselves (:3561-3572);
- listNow's refresh (:5643-5651);
- buildBack, before chainSoFar (:4534), so a return reviewed at once is right too.

What it lets go: a deposit or mix with `inputs` (maybe sent), not confirmed, not `unsent`, older than LOST_AFTER_MS, that tx_status doesn't show.
- Only once utxo_info shows each of its inputs known and unspent.
- A Koios error in that read leaves it, as a maybe.
- It drops the record, as act does for kinds that aren't rebuilt, and frees the inputs with forgetSpent, passing `at` so a spend made since stays marked.
- chainSoFar then reads the chain as never started. chainView stops counting the deposit. The next return goes through Lovejoin.
- One that lands meanwhile is confirmed, as now.

The class is every session with no `auto`: a site's, one the restore scan found, and a hand-run swap from before auto. needs_owner: no. It restores the documented default and adds no refusal.

A possible sibling for the fixer, not traced here: a site session's direct return that Koios never answered stays a maybe-sent "back" for good. The view keeps `stage: "returning"`, and SiteSessions.tsx's `moving` holds Disconnect on it. Worth checking whether that page still offers Bring it back once its marks clear.

Two small corrections to the finding's text:
- The two hours are "two hours or until the next lock". The auto-lock at 15 minutes idle makes the direct return the next one.
- The chain count in the test is 1 of 10. The finder's 12 is only an example.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension/tests/r51-gap-g3-2.test.ts`

Result: Run from extension/ on TREE: `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m npx vitest run tests/r51-gap-g3-2.test.ts`

```
 RUN  v5.0.3 .../Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension
stdout | tests/r51-gap-g3-2.test.ts > a site's session whose chain's deposit Koios never answered (r51 gap-g3#2) > brings it back through Lovejoin again once that deposit is known never to have landed
{"submits":5,"recorded":[{"kind":"out","unsent":false,"inputs":0},{"kind":"deposit","unsent":false,"inputs":1}],"afterStop":{"chain":{"total":10,"sent":1,"confirmed":0,"cut":false,"stopped":"The server is having trouble (503 for submittx). Try again in a minute."},"holding":"5000000"},"later":{"chain":{"total":10,"sent":1,"confirmed":0,"cut":false,"stopped":"The server is having trouble (503 for submittx). Try again in a minute."},"holding":"45000000"},"again":{"lovelace":"38822242","collateralTail":true}}
 ❯ tests/r51-gap-g3-2.test.ts (1 test | 1 failed) 2973ms
     × brings it back through Lovejoin again once that deposit is known never to have landed 2971ms
 FAIL  tests/r51-gap-g3-2.test.ts > ... > brings it back through Lovejoin again once that deposit is known never to have landed
AssertionError: expected undefined to match object { depth: 1 }
- Expected: { "depth": 1 }
+ Received: undefined
 ❯ tests/r51-gap-g3-2.test.ts:117:28
 Test Files  1 failed (1)
      Tests  1 failed (1)
```

It fails on TREE because of the bug:
- **After 2 h 5 min:** the return built is direct, 38.82 ₳ with no `lovejoin` and no `lovejoinSkipped`. Only the collateral's own mix goes into the pool. The chain still reads sent 1 of 10.
- **Right after the stop:** the account showed 5 ₳ where 45 ₳ sits.

On a copy with the finder's rule added to listNow's refresh, the same test passed (`Tests 1 passed (1)`). Its return was `lovejoin: {boxes: 6, depth: 1, mixes: 6, txs: 10, ...}` and the chain read `sent: 0`.

```
// Chunk 51's verifier for gap-g3#2: a site's private session whose return's chain through Lovejoin stopped at its
// deposit, which Koios never answered (a 503 on every try) and which never reached a node. Nothing settles that deposit
// for a session that doesn't run itself: act's lost rule (LOST_AFTER_MS) runs only for one with `auto`. So the record
// keeps it as maybe sent for good, chainSoFar reads the chain as started, and every later return comes back directly,
// with no Lovejoin and no word why, though nothing of the chain went in. The right outcome is the one
// return-chain-scope.test.ts pins for a deposit refused outright: brought back again, through Lovejoin. The real
// WebAssembly, Lovejoin v2's 5 ₳ pool (v2-pools.ts), and fakes of Koios, as in that file.
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { Minswap } from "../src/background/minswap";
import { SessionService } from "../src/background/sessions";
import { SPENT_KEEP_MS } from "../src/background/spent";
import { busyFor, sessionSwap, testBalances, vectors } from "./fakes";
import { ADA_POOL, ADA_ROWS } from "./v2-pools";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;

const CHAINS = { timeout: 60_000 };
const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };

function atSession(tx_hash: string, tx_index: number, value: string): KoiosUtxo {
  return {
    tx_hash,
    tx_index,
    address: sessionSwap.address,
    value,
    stake_address: null,
    payment_cred: sessionSwap.keyHash,
    epoch_no: 315,
    block_height: 5_000_000,
    block_time: 1_800_000_000,
    datum_hash: null,
    inline_datum: null,
    reference_script: null,
    is_spent: false,
    asset_list: [],
  } as KoiosUtxo;
}

/** A site's private session 0 holding 40 ₳ and its 5 ₳ collateral, and the 5 ₳ pool its ADA goes into (as return-chain-scope.test.ts). */
async function withSession() {
  const t = testBalances({ pools: [ADA_POOL] });
  await t.wallet.create(account(12).phrase, PASSWORD);
  await t.store.set("sessions.preprod", {
    next: 1,
    sessions: [
      {
        index: 0,
        ownStake: true,
        createdAt: t.clock.now,
        txs: [{ kind: "out", txHash: "ab".repeat(32), at: t.clock.now, confirmed: true }],
        site: { origin: "https://example.org" },
      },
    ],
  });
  t.koios.addedToAccounts.push(atSession("c1".repeat(32), 0, "40000000"), atSession("c2".repeat(32), 1, "5000000"), ...ADA_ROWS);
  t.koios.evaluation = AGREES;
  await t.deps.preferences.set({ lovejoinDepth: 1 });
  const sessions = new SessionService({
    ...t.deps,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
    lovejoin: t.lovejoin,
    sleep: async () => undefined,
  });
  return { t, sessions };
}

type Book = { sessions: Array<{ txs: Array<{ kind: string; unsent?: boolean; inputs?: string[] }> }> };

describe("a site's session whose chain's deposit Koios never answered (r51 gap-g3#2)", () => {
  it("brings it back through Lovejoin again once that deposit is known never to have landed", CHAINS, async () => {
    const { t, sessions } = await withSession();
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin).toBeDefined();

    // Koios never answers a submit: a 503 every time, so nothing reaches a node (the fake's own submit never runs).
    const fetch = t.koios.fetch;
    let submits = 0;
    t.koios.fetch = async (url, init) => {
      if (url.endsWith("/submittx")) {
        submits++;
        return new Response("upstream unavailable", { status: 503 });
      }
      return fetch(url, init);
    };
    await expect(sessions.backSubmit("preprod", review.txHash)).rejects.toThrow();
    t.koios.fetch = fetch;
    expect(t.koios.submitted).toHaveLength(0);
    const kept = (await t.store.get<Book>("sessions.preprod"))!.sessions[0]!.txs;
    const stopped = (await sessions.list("preprod", true)).find((v) => v.index === 0)!;

    // Well past LOST_AFTER_MS (15 minutes) and SPENT_KEEP_MS (2 hours), the user busy all along, so nothing locks. tx_status
    // still doesn't know the deposit (the fake's confirmations are null), and utxo_info shows what it spends unspent.
    await busyFor(t, SPENT_KEEP_MS + 5 * 60_000);
    await sessions.list("preprod", true);
    const again = await sessions.backBuild("preprod", 0);
    const view = (await sessions.list("preprod")).find((v) => v.index === 0)!;
    console.log(
      JSON.stringify({
        submits,
        recorded: kept.map((x) => ({ kind: x.kind, unsent: !!x.unsent, inputs: x.inputs?.length ?? 0 })),
        afterStop: { chain: stopped.chain, holding: stopped.holding?.lovelace },
        later: { chain: view.chain, holding: view.holding?.lovelace },
        again: { lovejoin: again.lovejoin, lovejoinSkipped: again.lovejoinSkipped, lovelace: again.lovelace, collateralTail: !!again.collateralTail },
      }),
    );

    // Nothing of the chain went in: brought back again, through Lovejoin, as the default says, not directly with no word
    // why (the owner's intent for a deposit refused outright, return-chain-scope.test.ts:146).
    expect(again.lovejoinSkipped).toBeUndefined();
    expect(again.lovejoin).toMatchObject({ depth: 1 });
    // And its page no longer counts a transaction of that chain as sent.
    expect(view.chain?.sent ?? 0).toBe(0);
  });
});
```
