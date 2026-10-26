# Fixer w-left (round 2, Lane W): the worker's leftovers

Five items: 321-parts-worker#3's second half, 314-wasm#0's defence in depth, rr-1's note on acrossOf (319-rust#0's worker half), wlj-2's two slips in Bring every box back now, and wlj-1's test name. All five are done. Each fix has a test that failed on today's tree for the item's reason, and each hunk was mutation-checked. (Corrected in the docs round, from fx-tests: four of 314-wasm#0's `runs.ts` catches had no test until R3-19, whose test traps at each of the run's six steps.)

**No test needs the pkg rebuilt.** No Rust changed.

## 321-parts-worker#3, its second half (sendChain): **fixed**

**What today did.** The return was already refused, so the finding's merge never happened. `LovejoinService.reserve()` refuses a reservation that overlaps any other, and that includes a payment's parts. But it refused:
- in the pool's words, "Lovejoin's pool changed while the wallet read it.", which aren't the reason;
- only after the session's record and the chain's record were written, then rolled back.

**Change** (sessions.ts `sendChain`). Before anything is recorded, a return's chain is now refused when any of its inputs is held by a payment's parts still to go: a `parts.` reservation being sent.
- The words are new, beside the parts family: `worker.spend.partsConflict.return`, "That return spends a UTxO that a payment still being sent in parts spends too. Review it again."
- If a Lovejoin chain being sent holds the input instead, reserve()'s refusal still handles it, as before. Build-time reservations already make that case all but unreachable.
- A plain `Error`, as sendChain's other refusals (`sess.spentSince`, `sess.chainSending`) are.

**Test.** `tests/parts-send-review-fixes.test.ts`, in describe "a payment in parts checked whole at Send (1.6.0's release review, 321-parts-worker#3)": "refuses, sending none of it, a return through Lovejoin reviewed before the payment's Send whose chain merges into what a waiting part spends". It's a real chain with a merge:
- test wallet A's 12 bundles, sent in 2 parts;
- session 0's funding change is a bundle the second part spends;
- the return is reviewed first and merges into that bundle;
- then the payment's Send goes, and then the return's Send.

The test checks that nothing of the return goes and no chain is recorded. Then the return, reviewed again, leaves the bundle out and goes, and the payment's second part goes after it.

**Fail before:** `expected [Function] to throw error including 'That return spends a UTxO that a paym…' but got 'Lovejoin's pool changed while the wa…'`.

**Mutation:** with the check removed, the same line.

## 314-wasm#0, defence in depth: **fixed**

**How traps travel.** A trap leaves the instance broken. Under a page's request, `answerUi` (sw.ts) calls `wallet.trapped()`. Under the wallet's queue, `wallet.serial` does. A session's step does it itself. The runner had nothing like that: sw.ts swallows every failure of a run.

**Changes:**
- **runs.ts:** every step's catch is now `unlessTrap(fallback)`. A trap from any step (not only withdrawDue) reaches `runNetworks`, which calls `wallet.trapped()`, stops the alarm (as for a locked wallet) and ends the run, so nothing more runs on the broken instance. A refusal, or JavaScript's own stack overflow, still lets the other network go on.
- **lovejoin.ts `readSet`:** discovery's catch, for `pools` and `known` alike, rethrows a trap rather than reading the pools handed over before.
- **On the same run's way, catches that would have swallowed that same trap:**
  - Bring every box back now's pool read used to keep the trap's words as the run's reason;
  - its per-box catch used to go on to the next box on the broken instance;
  - a box's own withdraw (`withdrawDueNow`) used to return [].

  Each now rethrows a trap.

**Tests.** `tests/run-traps-review-fixes.test.ts` (new). Each test runs with two traps: a `WebAssembly.RuntimeError`, and a real V8 RangeError from a self-calling WebAssembly module.
- "locks the wallet, as a page's request does, and runs nothing more on the broken instance": the trap comes from withdrawDue, then from the pending watch.
- "goes on past a refusal, or JavaScript's own stack running out, which leave WebAssembly as it was": a guard.
- "hands a trap from discovery on, where discovery failing reads the pools it handed over before".
- "hands a trap in Bring every box back now's pool read on, never keeping it as the run's reason".
- "hands a trap in a box's withdraw on, in its own run and in Bring every box back now's".
- "locks the wallet when a pool read traps in the unlock's run, as it would under a page's request": end to end, with a real Wallet and LovejoinService through `runNetworks`.

**Fail before:**
- `withdrawDue: expected "vi.fn()" to be called 1 times, but got 0 times`;
- `promise resolved "{ available: true, boxes: [], …(8) }" instead of rejecting`;
- `promise resolved "[]" instead of rejecting`, twice;
- `a trap: expected 'unlocked' to be 'locked'`.

**Mutations,** each undone with Edit and put back:

| Hunk undone | What failed |
|---|---|
| runs.ts withdrawDue's catch back to `() => undefined` | the runs test, and the end-to-end test |
| runs.ts without `wallet.trapped()` | the same two |
| readSet's catch without the rethrow | the readSet test, and the end-to-end test |
| the bring's pool-read catch | the bring pool-read test |
| withdrawDueNow's withdraw catch | the box's withdraw test, its own run |
| the bring's per-box catch | the box's withdraw test, brought back |

## rr-1's note: acrossOf counts what holdings_of counts (319-rust#0's worker half): **fixed**

**Change** (lovejoin.ts). The new exported `evaluable(u)` mirrors core's `eval::refusal`: no reference script, and an inline datum the wallet can read.
- The datum is read by `withinDepth`, a TypeScript walk that mirrors core's `cbor::within_depth` item by item: one well-formed item, nothing after it, at most 128 levels, text in UTF-8, chunks of their own kind. It walks without recursion.
- acrossOf's held loop counts only rows that pass `evaluable`. So such a token stays out of `byToken`, and comes back with the return as any token without a pool does.
- **Also aligned: sessions.ts `collateralWanted`.** Its comment says it counts "as acrossOf counts them", and it decides both the "its 5 ₳ collateral isn't at its account anymore, and the mixes need it" reason and the 5 ₳ offer on a session's page (`backCollateral`). Left alone, a session whose only token row WebAssembly can't take would have been offered 5 ₳ of collateral for a box that would never go.

**Tests.** `tests/lovejoin-planner.test.ts`, describe "a token on a UTxO WebAssembly's deposit can't take (1.6.0's release review, rr-1's note on 319-rust#0)":
- "is no token of a pool's this time, counted from the UTxOs the deposit takes: it comes back with the return". Two shapes:
  - a reference script whose bytes are given, so it passes the build's `measurable` filter;
  - a datum 129 levels deep.

  A control at 128 levels still goes into the pool.
- "wants no collateral for a box of such a token: a return without its 5 ₳ says its spare is too little for a box, and none is offered". A session brought back by hand: with such a row, and with a row the deposit takes.
- "reads a UTxO's datum as core's evaluator does, held to core's own vectors". `withinDepth` and `evaluable` against all 28 `scriptRowDatums` in `seedelf-core/tests/fixtures/lovejoin-pool-vectors.json`. All matched on the first run.

**Fail before:**
- `a reference script: expected [ { …(7) } ] to be undefined`, with `"skipped": "its spare ADA is too little for a box"`, and the same for the deep datum;
- `takes: false: expected 'its 5 ₳ collateral isn't at its acco…' to be 'its spare ADA is too little for a box'`.

**Mutations:**

| Hunk undone | What failed |
|---|---|
| acrossOf without `evaluable` | the reference-script shape |
| the walk's UTF-8 check removed | "text that isn't UTF-8" |
| the walk's depth limit `===` changed to `>` | "lists 129 deep", and the deep-datum shape |
| collateralWanted without `evaluable` | the collateral test |

## wlj-2's notes: Bring every box back now's two slips: **fixed**, both

Both slips start the same way. A node drops a withdraw the run sent, so its box stays listed, held as spent for 2 hours, then free.

**(a) Taken again, the box counted back twice: `back`, and `countBack`.** It also took a second due time, another box's.

The change:
- A sealed `Schedule.counted` keeps each box a Bring every box back now withdraw went for, with its pool and when the withdraw went (`Withdrawing.bring` marks such withdraws).
- `dropWithdrawing` doesn't `countBack` a box that's in `counted`.
- In the run, a box in `counted` takes no due time. It adds to `back` only if an earlier run counted it, not this one (`taken.at >= asked.at`).
- `sortOut` drops an entry once a read of its pool no longer lists the box.

**Only the run's withdraws are recorded.** The first version recorded every withdraw, and the 1.5.0 gate (`tests/lovejoin-1-5-0.test.ts`, which must pass unedited) failed: its traces then showed a `counted` field. So a box's own withdraw records nothing new, and the gate passes unedited.

**(b) After Stop, the box came back with no due time** until some later read gave it one. The new sealed `Schedule.recheck` handles it:
- Stop, or the run stopping itself after `BRING_FAILED_RUNS`, sets it to now + `SPENT_KEEP_MS` once the run has sent anything.
- `returning()` keeps the alarm going while it's set. A minute with nothing due still asks Koios nothing.
- `withdrawDueNow` reads the pools once when it falls due, so `scheduleFound` gives the freed box its due time, and then clears it.
- After Stop, such a box comes back by itself, counted back once, through (a)'s `counted`.

**Tests.** `tests/lovejoin-bring-review-fixes.test.ts`, describe "a withdraw of Bring every box back now that a node dropped (1.6.0's release review, wlj-2's notes)". The setup: box a1, the run asked for, then mix c2 sent since, whose box keeps its wait.
- "counts a box it takes again back once, and takes no second due time for it". It also checks that the record of it goes once the withdraw is on chain.
- "gives the box its due time back after Stop, once it's free, and it comes back by itself, counted back once".
- "gives the box its due time back once the run stopped itself too, as Stop does".

The pool's listing reads spent marks against `Date.now()` (lovejoin.ts `listing`), while the tests' clock is in 2027. So the tests let a mark lapse by deleting it (`lapsed`), as other tests set `SESSION_SPENT`.

**Fail before:**
- (a) `expected { back: 2, left: +0 } to match object { back: 1 }`;
- (b) `expected [ 1800054120000 ] to have a length of 2 but got 1`;
- the run stopping itself: written after the fix. Under its mutation it fails with that same line.

**Mutations:**

| Hunk undone | What failed |
|---|---|
| countBack every time | (a) and (b): `expected [] to deeply equal [ ObjectContaining{…} ]`, c2's mix closed |
| a retake takes the pool's earliest due time | (a)'s due times |
| `back` counted for every take | (a)'s `back` |
| Stop without the recheck | (b)'s due times |
| the read gate ignoring the recheck | (b)'s due times |
| `counted` never pruned | (a)'s record check |
| the auto-stop without the recheck | the auto-stop test |
| the run not marking its withdraws (`bring`) | (a) and (b) |

## wlj-1's note: the STATE-5 test name: **fixed**

`tests/lovejoin-release-rules.test.ts`: "lets go of the wallet's other box it held in its place once its record goes, and that box comes back" is now "holds none of the wallet's other boxes in its place, is gone once its record goes, and that box comes back". A comment above it says why the name changed (316#0). The test's body is unchanged, and it passes.

## Files touched

- `seedelf-platform/seedelf-web-wallet/extension/src/background/runs.ts`: `unlessTrap`; `runNetworks` split into `runNetworks` and `runEach`.
- `.../extension/src/background/lovejoin.ts`:
  - item 2: readSet's `kept`, and three catches;
  - item 3: `evaluable`, `withinDepth`, the `MAX_DEPTH` import, acrossOf's loop;
  - item 4: the `counted` and `recheck` fields, `Withdrawing.bring`, `read()`, `empty()`, `dropWithdrawing`, `sortOut`'s prune, the run's loop, `stopBringingAllBack`, `bringNoted`, `returning()`, and `withdrawDueNow`'s read gate and clear.
  - S2's `collateralPoolShown` is not mine, and I left it alone.
- `.../extension/src/background/sessions.ts`: the `reservations` and `evaluable` imports, `sendChain`'s parts check, `collateralWanted`'s loop. S2's quote hunk is not mine.
- `.../extension/src/i18n/translations/{en,es,ja}.json`: one new key each.
- `.../docs/i18n/{es,ja}-provenance.json`: `machine` for it.
- Tests:
  - `tests/run-traps-review-fixes.test.ts` (new);
  - `tests/parts-send-review-fixes.test.ts`: one test, imports, `CLASSIC_POOL` and `AGREES`;
  - `tests/lovejoin-planner.test.ts`: one describe of 3 tests, and imports;
  - `tests/lovejoin-bring-review-fixes.test.ts`: one describe of 3 tests, imports, and `Sealed.mixes`;
  - `tests/lovejoin-release-rules.test.ts`: one test's name.

## Keys

**Critical keys added or changed: none.**

**Other keys added:**

| Key | en | es | ja |
|---|---|---|---|
| `worker.spend.partsConflict.return` | That return spends a UTxO that a payment still being sent in parts spends too. Review it again. | Esa devolución gasta un UTxO que también gasta un pago que todavía se está enviando por partes. Revísala otra vez. | その返却は、まだ分けて送信中の支払いも使用する UTxO を使用します。もう一度確認してください。 |

Both es and ja have provenance `machine`. Each mirrors its `partsConflict` siblings, using "devolución" and "返却" as `sess.spentSince` and `sess.chainSending` do.

## Docs to update

1. **architecture.md:52** (a call that traps):
   - the worker's runs (`runs.ts`) lock the wallet on a trap from any step, stop the alarm and end the run;
   - Lovejoin's pool read hands a trap from discovery on;
   - Bring every box back now's pool read and withdraws, and a box's own withdraw, hand a trap on, and never keep it as a run's reason.
2. **architecture.md:231** (the worker's runs): "one network's failure never stops the other's", but a trap ends the run and locks the wallet.
3. **architecture.md:323** (a chain kept for Send is refused at Send):
   - It's also refused when a payment's parts still to go reserve something it spends, such as a return reviewed before that payment's Send, merging the funding change a waiting part spends.
   - The refusal comes before its chain or the session's record is touched, in `worker.spend.partsConflict.return`'s words.
   - Before, reserve()'s overlap check refused it as "Lovejoin's pool changed while the wallet read it." **flows.md:381**, if it covers a return's Send: the same.
4. **architecture.md:728** (token pools; a return's tokens through their own pools):
   - A token on a session's own UTxO that WebAssembly's evaluator can't take is no pool's token for that return. That means a reference script on it, or a datum past 128 levels or not one CBOR item.
   - It gets no way, and comes back with the return. A session brought back by hand isn't offered 5 ₳ of collateral for it.
   - The worker reads such a datum as core does (`withinDepth`, held to the shared vectors' `scriptRowDatums`).
5. **seedelf-platform/CLAUDE.md**, the "Lovejoin's token-pool templates are pinned" bullet, beside deep-datum's note: the worker has its own copy of the depth walk too (lovejoin.ts `withinDepth`), tested against the same vectors.
6. **flows.md:527** (Bring every box back now):
   - A box whose withdraw a node dropped is taken again once it's free, 2 hours on. It counts as one box back, in Settings' count and in the list of mixes, and takes no other box's due time.
   - After Stop, or when the run stops itself after three runs that sent nothing, the pools are read once 2 hours on. Such a box then gets its due time back and comes back by itself.
7. **architecture.md:424** (`lovejoin.<network>`'s contents):
   - `counted`: each box Bring every box back now's withdraws went for, with its pool and when, kept while a read of that pool lists it;
   - `recheck`: when Stop's one read is due.

   Both are sealed and on the device. No new kind of request: the read is the pool read every wallet makes.
8. **architecture.md:711** (a withdraw is written ahead): Bring every box back now's withdraws carry `bring`.
9. **privacy.md and the policy:** I think no change is needed. There's no new kind of request, only one more pool read 2 hours after Stop. That's the docs lane's call.

## Calls the owner might overturn

1. **A box's own dropped withdraw, taken again, still counts back twice.** This was there before 1.6.0's review, in the regular flow. Fixing it means recording every classic withdraw's box, and that changes the sealed records the 1.5.0 gate pins. So the record is kept only for Bring every box back now. Fixing the regular flow too would need the gate's fixture re-recorded: the owner's call.
2. **A box taken again within the run takes no due time.** It doesn't take the pool's earliest. If a page's read had already given the box a due time, that one is left over, and the next read trims it. The other way would take another box's due time.
3. **Stop's recheck is a pool read 2 hours after Stop**, which the wallet wouldn't otherwise make (the same read every wallet makes), and the alarm keeps going until then. The run stopping itself sets one too.
4. **The runner locks on a trap from any of its steps**, not only withdrawDue's, and ends the run there. Four more Lovejoin catches hand traps on: the run's pool read, its per-box catch, a box's own withdraw, and readSet's `known`.
5. **A return is refused here only for a payment's parts.** A Lovejoin chain being sent that holds one of its inputs is left to reserve()'s existing refusal.
6. **The datum walk is a third copy of the rule,** after core and the data layer. Its test fails loudly if core's vectors change. Asking WebAssembly instead needs a Rust export, which this round doesn't allow.

## Notes for the lead and other fixers

- **No test needs the pkg rebuilt.**
- **e2e:** no expectation changed. I grepped `e2e/*.ts` for the old and new words; none appear.
- **Catch-alls still swallowing a trap,** left as they were (outside the run's path or my files):
  - `watchOf`'s and `mixBoxes`' quiet readSet catches, with activity.ts:497's catch over `mixBoxes`;
  - `progress()`'s `pumpPublic(...).catch(() => undefined)`;
  - withdrawOne's best-effort catches after the submit.

  watchOf's catch also guards post-submit bookkeeping, so rethrowing there needs more thought.
- **Test clocks and spent marks:** `lovejoin.ts listing()` reads spent marks with `spentSet(session)`, which is `Date.now()`, not `deps.now()`. In tests a mark never lapses. In the worker the two clocks are the same, so nothing is wrong there. Aligning it could change other tests that move the clock hours ahead.
- **Seen, not mine:**
  - `src/ui/screens/Home.tsx` was mid-edit by S2 (a duplicate `held`). It broke `home-review-fixes`, `restore-scan` and `lovejoin-restore` in one run; all pass on the rerun.
  - `tests/lovejoin-bring-screen-review-fixes.test.ts` (S1) failed once and showed `donePool` typecheck errors mid-edit; it passes on the rerun.
  - The critical-key gate fails three tests on other lanes' new keys (`dappUi.back.privacy.noteLovejoinMixed`, `swaps.retry.privacy.cbor`, `swaps.review.privacy.collateralMix`) and the round-3 es/ja checks. Mine isn't critical.
- **Scratch logs** are in the scratchpad, `w-left-*`. Nothing of mine is left in the tree but the files above.

## Checks

| Check | Result |
|---|---|
| Each new test on the tree before its fix | failed, for the reason above (the guard passes, as a guard does) |
| Mutations: 6 for traps, 1 for sendChain, 4 for acrossOf and collateralWanted, 8 for the bring | each undone hunk failed its test; each put back with Edit; a grep finds no mutation left |
| `npm run typecheck` | clean |
| Broad set, default build: 168 files (lovejoin, sessions, session-, site-, swap, return-, parts-, payment-parts, runs, run-, chain, remove-wallet, public-mix, collateral, unlock-, pending-, withdraw-, i18n, words, worker, wasm, dapp, restore, script-spend, activity, handlers, home, private-landing, settle, maybe-sent, write-ahead, send, transfer, and 20 more that reach Lovejoin, sessions or the runner) | all pass but the i18n critical-key gate (3, others' keys). S2's mid-edit Home.tsx broke 3 files in one run, which passed on the rerun. |
| The same 168 files, `VITE_ENABLE_MAINNET=false` | 167 of 168 files: 2,054 passed; the 3 failures are the critical-key gate |
| `tests/lovejoin-1-5-0.test.ts` (the 1.5.0 gate), unedited | passes on both builds |
| My files alone: run-traps-review-fixes, runs, lovejoin-bring-review-fixes, lovejoin-planner, parts-send-review-fixes, lovejoin-release-rules, lovejoin-1-5-0 | 7 files, 153 passed |
