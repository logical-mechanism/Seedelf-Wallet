# Fixer `fx-cut`: a chain cut with only its rest left reads as done once that rest went (LIVE-1)

LIVE-1 is from the gate's live run on preprod (wallet B, build `22acd30e`).

- **Scope:** the worker only. No Rust, no WebAssembly, no words.
- **Files:** `lovejoin.ts` (the rule and the views), and one call in `sessions.ts`' `sendBack`.

## What was wrong

**The cause.** A chain a lock cuts is recorded `stopped` (CHAIN_CUT). `shown()` hid a stopped chain only once a pool read had found a box of it not mixed (`found`) and none of them was left (`left === 0`). A chain cut after its last mix never leaves a box not mixed, so `found` never came.

**What the user saw.** Such a chain said it stopped partway on Home's flag, under Chains and on its mix's card ("Stopped"). Chains also offered *Mix my boxes again* for boxes already mixed. This lasted as long as its record was kept: 3 h after the stop, or its delay's least, whichever is later. It held even after the session's return had brought its rest back and the session had closed.

**How common it is.** The usual way in is a lock while the collateral's mix waits for giveme.my. That wait can last up to a day, while auto-lock runs.

## The fix

**`carriedOf(s)`, in `lovejoin.ts`.** It's a read-time rule, beside `shown`. It holds for a session's chain that is stopped, ended, not done, and has nothing that may have gone through, when all three of these hold:
- **Its own boxes went.** It sent every transaction that makes one of its boxes: its deposit and its mixes (`ownTxs`).
- **No collateral's box waits on it.** It left no collateral's box waiting for its mix (`tailBoxOut`), unless a later chain took that box over. A taken-over box is one whose mix that chain built again (tailChain, with the same `tail.deposit`).
- **Its rest went.** That happened in one of two ways:
  - **In a chain.** A chain of the same session, recorded after it, was all sent (`done`). That chain is either buildBack's chain built in its place (LIVE-1's path: the collateral's deposit, its mix, then the return; Session 11's call 1) or tailChain's mix and return.
  - **In a direct return.** The session's return came back directly. Here `ChainRecord.restBack` is set by the new `LovejoinService.restBack(network, index)`. `sendBack` calls it once such a return is sent. It runs `cuts()` first, and writes only for a chain that has `restOnly`.

**What reads it.**
- **`shown()`** leaves a carried chain out. So does Home's `stopped` count in `held()`, and so do the Chains rows (`rows()`, now given the schedule, for `status` and `chains`).
- **The list of mixes** gives its chain `done: true` and drops `stopped`. Its card then says *Done*, or its session's own tag while that session isn't over.

**Nothing else changes.** The record keeps `stopped`, `cut`, `sent`, `left`, `found` and its tail, as every rule reads them: `tailOf`, `tailBuildable`, `tailBoxes`, `mayLand`, `unschedule`, `countBack`, the Bootstrap's hold and `clearMixes`. It isn't rewritten.

**Still shown as stopped, as now:**
- **A chain cut before its last mix**, its rest back or not. A box of it may wait unmixed, and *Mix my boxes again* is what's left to do.
- **A cut chain whose rest is still to come back.** This covers both before its return is built again and while the chain built in its place is still being sent, or stopped too.
- **A chain whose collateral's box waits with no chain to take it over.** That box is the wallet's, not mixed yet.

**Why not set `done` on the record.**
- **It isn't true:** `done` means "All sent."
- **It would change rules:** `mayLand` reads `done`. It would hold Bring every box back now, and the dropping of due times, for what's left of `LANDING_MS` after the cut.
- **It would need writing:** only the chain built in its place's `chainEnded` would write it, and records already on devices would need a migration.

A rule read at every read leaves every other rule as it was, and clears those records with nothing written.

**Beyond the lead's direction: direct returns.** The direction named the rebuild. I also cover a rest that came back directly, through `restBack` from `sendBack`. That's the same false "stopped partway" wherever there's no collateral's mix:
- mainnet today, where no 5 ₳ pool is shown;
- Settings' switch off;
- the review's switch to bring it back directly;
- a Bootstrap cut before its return. Its card then reads *Held*, as its hold is.

## Findings

| id | status | change |
|---|---|---|
| LIVE-1 | fixed | `carriedOf` and `shown(c, carried)`; `held()`, `rows()` and `mixes()` read it; `ChainRecord.restBack` and `LovejoinService.restBack`, called from `sessions.ts` `sendBack`. No new words, no refusal. |

## Tests, fail-before, and mutation checks

**Where the tests are.**
- **End to end** (real WebAssembly, the Koios and giveme.my fakes, a real `wallet.lock()` and `unlock()`): `tests/lovejoin-planner.test.ts` › "a return's 5 ₳ collateral mixed once…" › **"a chain cut with only its return left, and its collateral's mix (1.6.0's gate, LIVE-1)"**.
- **Records level:** `tests/lovejoin-stopped-shown.test.ts` › **"a stopped chain whose rest its session's return brought back since (1.6.0's gate, LIVE-1)"**.

**How the end-to-end tests set up the cut.**
- **The chain:** one box, two waves deep, as on the live run. That's the deposit, four mixes, the collateral's deposit and mix, and the return: 8 transactions.
- **The cut:** the deposit lands while the mixes sit in the mempool, so the fourth mix goes and the window holds the collateral's deposit back. Then the wallet locks. That leaves 5 of 8 sent, as LIVE-1 had.

| test | fail-before (on `22acd30e`'s code) | mutation → failure |
|---|---|---|
| P1 "reads as the done chain it is once the chain its return built in its place went, before a pool read and after". LIVE-1 end to end: unlocked, the cut chain still reads stopped; the return built again (`["deposit","mix","back"]`, the mix `giveme`) all goes; then `held()`, `chains()`, `mixes()`, a `status()` pool read, and the same again. The chain built in its place keeps its own card, its 5 ₳ box (316#3). | `expected { Object (boxes, lovelace, ...) } to match object { stopped: +0, boxes: 1, notMixed: +0 }` (stopped 1)¹ | A, B, K, L |
| P2 "reads as done once its collateral's mix it left, built again with the return after it, went (tailChain)". Cut after its collateral's deposit; a pool read finds that box; the rebuilt `["mix","back"]` goes; no read since. | `expected 1 to be +0` | A, B, D2, K, L |
| P3 "reads as done once its return came back directly, where it had no collateral's mix (Settings' switch off)" | `expected 1 to be +0` | A, B, I, K, L, M |
| P4 "reads as done once its rest came back directly by its review's switch, nothing of Lovejoin read since the unlock" | written after the fix; its fail-before is mutation I (the direct return's path as on `22acd30e`): `expected 1 to be +0` | A, B, H, I, K, L, M |
| P5 "still says a chain cut before all its mixes went stopped, its rest come back since…" (a guard) | passes before and after | C |
| R1 "reads as the done chain it is, kept as the live run left it: at the next read, with nothing written". Wallet B's records; the sealed schedule is byte for byte as kept. | `expected { Object (stopped, rows, ...) } to deeply equal { stopped: +0, rows: [], …(1) }` (stopped 1, its row, its card stopped) | A, B, K, L |
| R2 "still reads as stopped while its rest is still to come back: none built in its place, or one that stopped too". Also another session's chain, and a chain recorded before it. (A guard.) | passes before and after | E (recorded before), F (another session's) |
| R3 "still reads as stopped where a box of its own may wait to be mixed…". A mix unsent; its collateral's box no chain took over; then taken over, done. | the first two asserts are guards; the takeover assert: `…deeply equal { stopped: +0, rows: [], …(1) }` | A, B, C, D, D2, K, L |
| R4 "reads as done once its session's return came back directly, its hold as it was where it's a Bootstrap's". `restBack` marks a plain cut chain, marks nothing for another session, nothing where its collateral's box waits or its mix built again stopped too, and a cut Bootstrap's hold stays 1. | `t.lovejoin.restBack is not a function` (the method is new; the behaviour's fail-before is P3's and P4's) | A, B, G, J, K, L, M |

¹ P1's first run, at 16 ₳, failed earlier, at the chain's shape: depth 2 left nothing for the collateral's mix, a setup problem. At 20 ₳ it fails for the bug.

**The mutations.** Each hunk was undone with Edit, the two files run, and the hunk put back with Edit. Logs are `fx-cut-mutation-*.log`.

| id | what was undone | what failed |
|---|---|---|
| A | `shown()` without `!carried(c)` | P1–P4, R1, R3, R4 |
| B | the list of mixes' `done` without `carried(c)`: the cards stay `stopped` | P1–P4, R1, R3, R4 |
| C | `carriedOf` without `c.sent < ownTxs(c)` | P5 (`expected [] to deeply equal [ObjectContaining…]`), R3 |
| D | the takeover clause replaced by `true` | R3 (`expected +0 to be 1`) |
| D2 | the takeover clause replaced by `!tailBoxOut(c)` alone | P2, R3 |
| E | `slice(at + 1)` replaced by every chain | R2 |
| F | the session match dropped | R2, at "another session's" |
| G | `restBack` without `restOnly(c)` | R4 (the store changed) |
| H | `restBack` without `cuts()` | P4 |
| I | the `sendBack` call removed | P3, P4 |
| J | `tailBoxOut` without its built-again clause (`makers(c).length >= c.total`) | R4 |
| K | `held()`'s predicate replaced by `() => false`, run again after hoisting it | P1–P4, R1, R3, R4 |
| L | `rows()`' predicate replaced by `() => false`: the Chains row is back | P1–P4, R1, R3, R4 |
| M | `carriedOf` ignoring `restBack` | P3, P4, R4 |

A grep afterwards found every hunk in place.

## Files touched

- **`extension/src/background/lovejoin.ts`:**
  - **New:** `ChainRecord.restBack`, a documented field; `ownTxs`, `tailBoxOut`, `restOnly` and `carriedOf`, beside `shown`; the `restBack()` method, after `chainEnded`.
  - **Changed:** `shown(c, carried)`; `held()`'s `stopped`; `rows(s: Schedule)` and its two callers (`status`, `chains`); `mixes()`' chain view.
- **`extension/src/background/sessions.ts`:** `sendBack`, one call to `lovejoin.restBack` (with its comment) after a direct return is sent.
- **`extension/tests/lovejoin-planner.test.ts`:** the `CHAIN_CUT` import, and P1–P5 in a describe of their own in the tail block.
- **`extension/tests/lovejoin-stopped-shown.test.ts`:** R1–R4 in a describe of their own.

## Keys

None added or changed, and no critical key.

## Docs to update

1. **architecture.md, *Progress*** (the Lovejoin page's chain rows, :725) **and *Home's In Lovejoin row*** (:727). Add that a session's chain reads as done (`carriedOf`; 1.6.0's gate, LIVE-1) when:
   - it stopped once every transaction that makes one of its boxes was sent (the usual way: a lock while its collateral's mix waits for giveme.my);
   - it left no collateral's box waiting for its mix, but one a later chain took over;
   - the session's return brought its rest back since, in one of two ways:
     - a chain of the same session, recorded after it, was all sent (buildBack's chain built in its place, Session 11's call 1, or tailChain's);
     - a return that comes back directly was sent (`sendBack` → `LovejoinService.restBack` → `ChainRecord.restBack`).

   Such a chain is left out of Home's stopped count and the Chains rows, and its entry in the list of mixes carries `done`, not `stopped`. It's read at every read, so records kept before are read so too; nothing in the record changes.
2. **flows.md, *Chains*** (:519). Add: a chain cut short of its return (and its collateral's mix), every mix of it sent, isn't listed as stopped once its rest came back, in a chain of its own or directly. One cut before its last mix still is, its rest back or not.
3. **flows.md, *Your mixes*** (:506). Add:
   - such a chain's card says *Done*, or its session's own tag while that session isn't over;
   - a swap's or a site's return's card keeps its own count ("5 of 8 transactions sent");
   - the chain built in its place has a card of its own, its 5 ₳ box (316#3).
4. **flows.md, Home's *In Lovejoin*** (:73). Add: "a mix stopped partway" isn't said of such a chain.
5. **plans/chunk-34-token-pools.md, Session 12, the live run.** Record LIVE-1: found on preprod (wallet B, `22acd30e`), and fixed by fx-cut, the direct-return case beside it.
6. **The privacy policy and privacy.md: no change.** Nothing new leaves the device, and there's no new request.

## Calls the owner might overturn

1. **A chain whose rest went reads as done at once, as a done chain does.** It doesn't wait for a pool read to find nothing of it left.
   - **The rare case:** a box left by a transaction a node dropped since, which is very rare, since the chain in its place spends what the cut chain's last transaction left.
   - **What it shows then:** that box is said as a done chain's would be: not mixed yet on Home and on the page, with *Mix my boxes again*, never as a stopped chain.
   - **Why:** waiting for a read would have left Home's flag up until the next one, which can be hours away.
2. **"Went" means sent, not landed.**
   - **For the chain built in its place:** all sent, the moment that chain itself reads *Done*.
   - **For a direct return:** as it's sent.
   - **Why not landed:** the lead's direction said "sent and landed", but the worker reads a chain done at its last send everywhere else. If the return never lands, the session's own view says so.
3. **The direct-return case is beyond the lead's direction** (above). Its mark is written as that return is sent.
4. **Records kept before this build whose rest came back directly carry no mark.** They read as before (stopped) until their record goes. Only those whose rest went in a chain clear.
5. **A swap's or a site's return's card says "5 of 8 transactions sent" beside *Done*.** That's its own record's count, and true of that chain. The chain in its place is a card of its own ("3 of 3", its 5 ₳ box). A different line would need new words.

## Notes for the lead

- **No test needs the pkg rebuilt.** There's no Rust.
- **The 1.5.0 gate** (`tests/lovejoin-1-5-0.test.ts`, unedited) passes on both builds.
  - **Why it's unaffected:** its vault's chain was cut mid-mixes (4 of 10), so it's never carried.
  - **Its direct return:** at "bring session 0 back", `restBack` finds no chain to mark and writes nothing.
  - **Its token-pool variant:** that variant's chain built in its place doesn't carry it either.
- **`sessions.ts`** (Lane D's in round 1) has one anchored call in `sendBack`. I was the only fixer running.
- **e2e: nothing to update.** Its stopped chains, a public mix ("Stopped after 1 of 5") and a site session's chain at 4 of 10, are never carried.
- **Unchanged, but worth knowing.** While a collateral's mix built again waits for giveme.my (up to a day), the cut chain whose box that is still says *Mix my boxes again mixes the boxes it didn't*.
  - **Why it stays:** the direction's "keep showing while the return still has to come back".
  - **Why it's harmless:** that box is reserved by the chain in its place, so no other mix takes it.
- **In the tree, not mine:** the live run's records and harness, changed while I worked: `docs/roadmap.md`, `docs/plans/chunk-34-token-pools.md`, `e2e/live/lib.mjs`, `e2e/live/flows.mjs`, `tests/live-runs-copy.test.ts`.

## Checks

- **`npm run typecheck`:** clean (exit 0), run last.
- **The new tests:** P1–P5 and R1–R4, 9 in all, pass. They were run again after P1's last assertion (the tail's own card) went in.
- **The baseline before any edit:** the tail block (`-t "collateral mixed once"`), 28 of 28.
- **Once the fix was in, before P4 was written:** the 1.5.0 gate and the whole planner file, 77 of 77.
- **The wide set:** 118 files. Both files above are in it, with P4.
  - **What's in it:** activity\*, approvals\*, bring\*, chain\*, collateral\*, dapp-chain\*, direct-swaps, handlers\*, home\*, live-runs\*, lovejoin\* (the 1.5.0 gate among them), maybe-sent, mempool\*, parts\*, pending\*, pool-swap\*, public-mix\*, return\*, run\*, screens\*, session\*, site\*, spent\*, swap\*, withdraw\*, words, worker-words.
  - **Default build:** 1507 passed, 2 skipped.
  - **Preprod build** (`VITE_ENABLE_MAINNET=false`, run after P1's last assertion): 1507 passed, 2 skipped.
- **Mutations:** A–M and D2, 14 in all, each caught and each put back with Edit (K was run again after hoisting `carriedOf` in `held()`).
- **Scratch files** (`fx-cut-*` in the scratchpad):
  - the fail-before logs (`fx-cut-planner-failbefore.log`, `fx-cut-records-failbefore.log`);
  - the pass logs;
  - `fx-cut-mutation-*.log`;
  - the wide runs' logs and file list;
  - the typecheck log;
  - `fx-cut-mut.sh`, the mutation runner.

> **[Lead's note, after round 5b]** "Nothing written" and "isn't rewritten" held for this fix alone. fx-cut-2 (`fixes/fx-cut-2.md`) then had sortOut write `restBack` on a carried chain before it drops the record that carried it (last-5's first low), and noteLanded mark one whose direct return Koios took without an answer (its second). Every other field of the record is still as before.
