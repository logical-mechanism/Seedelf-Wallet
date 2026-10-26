# Fixer `fx-cut-2`: last-5's two lows on fx-cut's LIVE-1 fix

Both lows from [review/last-5.md](../review/last-5.md), applied on top of fx-cut's uncommitted fix (on `22acd30e`). In both, the Done reading fx-cut gives a cut chain didn't last, or never came, and LIVE-1's "a mix stopped partway" came back.

- **Scope:** the worker only. No Rust, no WebAssembly, no words, no refusal.
- **Files:** `lovejoin.ts` (sortOut's mark, `restBack`'s bound, three docs), and one call in `sessions.ts` `noteLanded`.

## Findings

| id | status | change |
|---|---|---|
| last-5 #1 | fixed | sortOut keeps a carried chain's reading on its own record (`restBack`) before the record of the chain built in its place goes. |
| last-5 #2 | fixed | noteLanded marks the session's cut chains (`restBack`) once a direct return whose send threw is seen on chain. A trap is handed on (L3). The mark is bounded to chains recorded by the time that return was sent, beyond the reviewer's fix (below). |

### 1. The later record went first (Settings' 6–24 h)

**What was wrong.** carriedOf's chain clause needs the later chain's record, and sortOut drops records on their own clocks:
- the chain built in its place records no delay of its own (a site's or a mix's session has none approved), so its record goes RECORD_KEEP_MS (3 h) after it ended;
- the cut chain's, with Settings' delay on it, is kept for that delay's least: 6 h after its start at 6–24 h.

From the first pool read after the later record went, the cut chain said it stopped partway again, on Home, under Chains and on its card, until its own record went.

**The fix** (the reviewer's). In sortOut's update, just before `s.chains = s.chains.filter(keep)`:
```ts
const carried = carriedOf(s);
for (const c of s.chains) if (keep(c) && !c.restBack && carried(c)) c.restBack = true;
```

**Checked: nothing else reads `restBack` differently.**
- Its readers are carriedOf (after its own guards: a session's chain, stopped, ended, not done, no `maybe`, `sent >= ownTxs`) and restBack()'s own predicate, which skips a chain already marked.
- carriedOf's readers are the pages' views alone: `shown` (rows, held's `stopped`) and the list of mixes' chain view.
- Nothing spreads a ChainRecord into a view.

**Why freezing the reading is safe: it only moves one way.** Once carried, a chain stays carried, so the mark says what carriedOf would have said had the later record stayed.
- The later chain's `done` never flips: chainEnded returns at once for an ended chain.
- The cut chain's `sent` only grows.
- `tail.scheduled` is set once and never deleted, so `tailBoxOut` only goes from true to false.
- An ended chain gains no `maybe`.

**Records already on a device.** A pair still kept is marked at its next pool read. sortOut is the only place a record is dropped, so none slips through.

### 2. A direct return that threw before sendBack's mark

**What was wrong.** sendBack marks the cut chain only once `sendRecorded` returns. Two ways it never does:
- Koios takes the return but doesn't answer (maybe sent);
- a lock cuts the send off right after its submit.

Either way sendBack throws, and once the return lands only noteLanded writes its history. The chain said it stopped partway for as long as its record was kept.

**The fix.** In noteLanded, before `if (!written.size) return s;`, where a confirmed `back` still holds its summary:
```ts
const back = s.txs.filter((t) => t.kind === "back" && t.confirmed && t.summary);
if (back.length) {
  await this.deps.lovejoin?.restBack(network, s.index, Math.max(...back.map((t) => t.at))).catch((e: unknown) => {
    if (isTrap(e)) throw e;
  });
}
```
- **The call** is shaped like sendBack's: `this.deps.lovejoin?.restBack(network, index)`, best effort.
- **The catch** rethrows a trap, as the round's unlessTrap does (L3), and takes any other failure as nothing marked. A Lovejoin record that won't open must not stop the session's history, nor the Sessions page's Refresh, which calls noteLanded.
- **Where a trap goes:** handed on from the Sessions page's Refresh and from Disconnect (sw.ts answerUi locks the wallet), and from a running session's step (step's own `wallet.trapped()`).

**Beyond the reviewer's fix: the bound (`sentAt`).**
- **Why it's needed:** a return seen late on chain may have been sent before a chain of the same session was even recorded. Here's how:
  1. A session's first return comes back directly, and Koios doesn't answer it.
  2. The site pays the session again.
  3. A new return goes through Lovejoin. buildBack allows it: no chain had started, so `restOnItsWay` is false.
  4. A lock cuts that chain once its mixes went.
  5. The first return is then seen on chain.
- **What the unbounded call does then:** `restBack(network, index)` marks the new chain done while its own return is still at the account. That's a false Done, which fx-cut's "a cut chain whose rest is still to come back still reads stopped" forbids.
- **The change:** `restBack` takes an optional `sentAt`, and marks only chains recorded by then (`c.at <= sentAt`, both stamped by `now()`). noteLanded passes the latest such return's `at`. sendBack passes none, since every chain is recorded before the return it sends.
- **Why `<=`:** a return is sent strictly after the chains it carries. The test clock doesn't move between them, so the two stamps are equal there.

**What the reviewer noted, which holds:**
- a clean send isn't marked twice: sendBack deletes the summary once the history is written, and a second call writes nothing for a chain already marked;
- a chain's own return reaching here (its last step carries a summary) marks nothing wrong, since that return did land;
- the call writes only where something is `restOnly`.

## Tests, fail-before, and mutation checks

| test | fail-before | mutations caught |
|---|---|---|
| **R5** `tests/lovejoin-stopped-shown.test.ts` › "a stopped chain whose rest its session's return brought back since (1.6.0's gate, LIVE-1)" › "stays done once the record of the chain built in its place goes before its own, kept by Settings' 6–24 h delay (1.6.0's gate, last-5's first low)". Records as R1 builds them, the cut chain with `delay: "6-24"`, its box listed at its leaf. A pool read with its rest still to come back marks nothing (a guard). With the chain in its place done, `busyFor` 3 h, then a pool read: still done, and the cut chain's record alone left, `restBack: true`. | `expected { Object (stopped, rows, ...) } to deeply equal { stopped: +0, rows: [], …(1) }` at :293, after the 3 h read: stopped 1, its Chains row back, its card stopped | M1a, M1b (at :285, the guard), M1c |
| **P6** `tests/lovejoin-planner.test.ts` › "a chain cut with only its return left, and its collateral's mix (1.6.0's gate, LIVE-1)" › "still reads as done once the record of the chain built in its place went before its own, kept by Settings' 6–24 h delay". P1's flow end to end with `lovejoinDelay: "6-24"`. It also pins the cause: the cut chain records `"6-24"`, the chain built in its place nothing. Then `busyFor` 3 h 1 min and `status()`: the later record went, and Home, Chains and the card still read done. | `expected 1 to be +0` at :2085 (Home's stopped count; the assertion before it shows the later record gone) | M1a, M1c |
| **P7** same describe › "reads as done once its return, come back directly, is seen on chain after Koios took it without an answer". P3's flow (Settings' collateral switch off), the return's submit taken but unanswered (maybe-sent.test.ts's `unanswered`). A runner pass while it isn't in a block: still stopped (a guard). In a block, the next pass confirms it and writes its history: done everywhere. | `expected 1 to be +0` at :2116, the return confirmed and its history written | M2a′, M2d′ (at :2108: marked before it was seen) |
| **P8** same describe › "hands on a trap as it marks that chain, never reading on from it, and writes the return's history through any other failure (L3)". `restBack` stubbed: a `WebAssembly.RuntimeError` makes the Sessions page's Refresh (`list(…, true)`) reject with it; a plain Error lets the next Refresh write the history. | `promise resolved "[ { index: +0, …(8) } ]" instead of rejecting` at :2129 (noteLanded never called restBack) | M2a′, M2b′, M2c′ (at :2131, `Error: Lovejoin's record won't open`) |
| **P9** same describe › "marks no chain recorded after that return was sent: one whose own return is still to come back says it stopped". Records: a site's session whose first return (sent 30 min ago, summary kept) is on chain, and a chain of it recorded 20 min ago, cut once its deposit and mixes went. A runner pass confirms that return and writes its history; the chain still says it stopped. | written once the reviewer's unbounded call was in: `expected +0 to be 1` at :2193 | M2e, M2f |

**The mutations.** Each was made with Edit, the five tests run (`fx-cut-2-mut.sh`), and the hunk put back with Edit. M2a–M2d were first run on the unbounded call, then again (′) on the final form, with the same results. A grep afterwards found every hunk in place.

| id | what was undone or bent | what failed |
|---|---|---|
| M1a | sortOut's mark removed | R5 (:293), P6 |
| M1b | the mark without `carried(c)` (every kept chain) | R5 (:285, the guard: a cut chain whose rest is still to come back read done) |
| M1c | the mark moved after `s.chains = s.chains.filter(keep)` | R5 (:293), P6 |
| M2a′ | noteLanded's block removed | P7, P8 |
| M2b′ | a bare `.catch(() => undefined)` | P8 (the trap swallowed) |
| M2c′ | no catch | P8 (Lovejoin's own failure stopped the Refresh) |
| M2d′ | the filter without `t.confirmed` | P7 (:2108: marked while the return wasn't on chain) |
| M2e | restBack's bound replaced by `true` | P9 |
| M2f | noteLanded passing no `sentAt` | P9 |

**Not observable, by design:**
- the mark's `keep(c)`: a record about to go takes its mark with it;
- its `!c.restBack`: writing the mark again changes nothing.

## Files touched

- **`extension/src/background/lovejoin.ts`:**
  - sortOut's mark, with its comment;
  - `restBack(network, index, sentAt?)` and its doc;
  - the docs of `ChainRecord.restBack` and carriedOf (one sentence added).
- **`extension/src/background/sessions.ts`:** `noteLanded`, one block with its comment.
- **`extension/tests/lovejoin-planner.test.ts`:**
  - imports: `busyFor`, `type LovejoinDelay`;
  - `TailRecord.delay`, and `cutAfterMixes`' settings type gains `lovejoinDelay`;
  - helpers `unanswered` and `sessionTx`;
  - P6–P9.
- **`extension/tests/lovejoin-stopped-shown.test.ts`:** the `busyFor` import, and R5.

## Keys

None added or changed, and no critical key.

## Docs to update

1. **architecture.md, *Progress*** (the Lovejoin page's chain rows) **and *Home's In Lovejoin row*** (fx-cut's item 1). Two changes to what fx-cut's item 1 says:
   - **Where its rest went in a chain built in its place:** a pool read keeps the reading on the chain's own record (`ChainRecord.restBack`) before the other record goes (sortOut). That record carries no delay of its own (a site's or a mix's session), so under Settings' 6–24 h it may go hours before the one it carries.
   - **Where its rest came back directly:** it reads done once that return was sent (sendBack). Where that send went unanswered, or a lock cut it off, it reads done once the return is seen on chain (noteLanded). Only chains recorded by the time that return was sent count.

   So fx-cut's "nothing in the record changes" holds for the pages' reads, not for a pool read.
2. **plans/chunk-34-token-pools.md, Session 12, the live run** (beside fx-cut's LIVE-1 entry). Record:
   - last-5's two lows, fixed by fx-cut-2;
   - the bound on noteLanded's mark, which goes beyond last-5's suggestion.
3. **The privacy policy and privacy.md: no change.** Nothing new leaves the device, and there's no new request: noteLanded's mark reads and writes the sealed record alone.

## Calls the owner might overturn

1. **The bound on noteLanded's mark goes beyond the reviewer's fix.**
   - **What it does:** only chains recorded by the time the return was sent are marked.
   - **Without it:** in the rare case under fix 2 (a top-up, a new Lovejoin return and a lock, all while the first return may still land), a chain whose own return is still at the account would read Done.
   - **The cost:** an optional third parameter on fx-cut's `restBack`.
2. **sortOut marks a carried chain at any pool read, not only when its carrier's record is about to go.**
   - **Why:** it's simpler, no rule reads the mark differently, and the reading it freezes only moves one way.
   - **What follows:** a pool read now writes `restBack` on such a record. R1's "nothing written" still holds for the pages' reads (held, chains, mixes).
3. **A non-trap failure of noteLanded's mark is taken as nothing marked, as sendBack's is.** The summary goes once the history is written, so the mark isn't tried again. The chain then reads Stopped until its record goes, as `22acd30e` showed. The other way (keeping the summary until marked) would hold the history to Lovejoin's record.
4. **Records whose carrier went before this build** read Stopped until their own goes, as last-5 noted. Only pairs still kept are marked.

## Notes for the lead

- **No test needs the pkg rebuilt.** There's no Rust.
- **The 1.5.0 gate** (`tests/lovejoin-1-5-0.test.ts`, unedited, and its fixture) passes on both builds.
  - Its "finishes a 1.5.0 vault… schedules alike" compares the sealed schedule whole after every step, so neither change wrote anything to that vault's record.
  - Its chain was cut mid-mixes (4 of 10), so it's never carried.
  - Its return's history is written at its send, so noteLanded never marks.
- **sendBack's own call still has a bare `.catch(() => undefined)`** (fx-cut's). I left it: you said to keep to these two. It's L3's class, but `restBack` touches no WebAssembly today (cuts, the sealed record, session storage), so no trap can come from it. Aligning it is one line, if you want the two calls alike.
- **runAll swallows a trap on the alarm's path (outside these two).** Its per-session `.catch(() => undefined)` around settleReturns (and pump, markCut) swallows one, so noteLanded's rethrow reaches answerUi only from the Sessions page's Refresh and Disconnect, and the lock from a running session's step. That's L3's class, pre-existing.
- **fx-cut.md's "It isn't rewritten" and "nothing written"** describe its own change. After fix 1, a pool read adds `restBack` to a carried chain's record (docs item 1).
- **In the tree, not mine:** the live run's files (`docs/roadmap.md`, `docs/plans/chunk-34-token-pools.md`, `e2e/live/`, `tests/live-runs-copy.test.ts`), and fx-cut's report and last-5's review.

## Checks

- **Baseline on the tree, before any edit:** the LIVE-1 tests (`-t LIVE-1` in the planner and stopped-shown), 9 of 9.
- **Fail-before:** R5 and P6–P8 each failed on the tree as given above; P9 failed on the unbounded call. The logs are `fx-cut-2-records-failbefore.log`, `fx-cut-2-planner-failbefore.log` and `fx-cut-2-bound-failbefore.log`.
- **With both fixes:** the five new tests and fx-cut's nine, 14 of 14.
- **The named set on both builds:** the planner file, stopped-shown, the 1.5.0 gate, and `session*` and `sessions*` (14 files).
  - **Default build:** 17 files, 236 tests, all passed.
  - **Preprod build** (`VITE_ENABLE_MAINNET=false`): 17 files, 236 tests, all passed.
- **The 1.5.0 gate alone, verbose, on both builds:** 4 of 4 by name.
- **`npm run typecheck`:** clean (exit 0).
- **A wider set, on both builds:** 98 files.
  - **What's in it:** activity\*, bring\*, chain\*, collateral\*, dapp-chain\*, handlers\*, home\*, live-runs\*, lovejoin\* (the planner, stopped-shown and the 1.5.0 gate among them), maybe-sent, mempool\*, parts\*, pending\*, public-mix\*, return\*, run\*, site\*, spent\*, swap\*, withdraw\*, words, worker-words.
  - **Default build:** 1194 passed, 2 skipped.
  - **Preprod build** (`VITE_ENABLE_MAINNET=false`): 1194 passed, 2 skipped.
- **Mutations:** M1a–M1c, M2a–M2d (twice), M2e and M2f, each caught and each put back with Edit.
- **Scratch files** (`fx-cut-2-*` in the scratchpad): the fail-before and pass logs, `fx-cut-2-mutation-*.log`, `fx-cut-2-mut.sh` (the runner), the set and gate logs on both builds, the typecheck log, and the wide set's file list and log.
- **Not run:** builds, Playwright, cargo, a formatter, mainnet.
