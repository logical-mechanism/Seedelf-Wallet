# Fixer `fx-lj-2`: Bring every box back now's Stop, the last swallowed traps, and the clocks (round 3b, Lane Y)

Leftovers L2, L3 and L4, and three of review/QUESTIONS.md's questions: the late line after Stop, the late state's three lines, and a cut collateral's mix. All six are fixed.

- **The code:**
  - `background/lovejoin.ts`: the Stop mark, the traps, the clock, and the cut collateral's mix;
  - `ui/components/BringAllBack.tsx`: Stopped, and the late state;
  - `shared/rpc.ts`: one additive field;
  - `background/activity.ts`: one catch;
  - `background/sessions.ts`, Lane X's file: small anchored edits (one catch, two writes, five reads).
- **No Rust. No test needs the pkg rebuilt.**
- **No refusal added.** Every change is a mark, a wait, a rethrow or words.

## Findings

| id | status | change |
|---|---|---|
| L2 | fixed | **Worker:** Stop now leaves a sealed mark, `Schedule.bringStopped = { back, pool? }`, with the run's count and pool, where it used to delete the run with no trace. It's shown as `LovejoinHeld.bringStopped`, and a new ask clears it. A run that already stopped by itself (`bringing.stopped`) gets no mark: Settings already says that stop. **Page:** `bringFollower` says **Stopped, never Done**, with the worker's count, for a run it saw go that's gone with the mark. That holds on another page or tab. It holds on the page that pressed Stop too: that page said nothing before. The new key is `settings.lovejoin.bringStoppedSent` ("Stopped: 3 boxes sent back."). |
| L3 | fixed | Each listed catch rethrows `isTrap` and keeps its meaning for every other failure. lovejoin.ts gets a module-level `unlessTrap`, the same as runs.ts' own. The catches: `watchOf`'s and `mixBoxes`' quiet `readSet`, activity.ts' catch over `mixBoxes`, `progress()`'s `pumpPublic`, `collateralPool`'s `split`, and sessions.ts' `tailReserve` over `collateralPool`. **`withdrawOne` after its submit:** `stale`, the history's entry and `dropWithdrawing` each still run, whatever the one before did. A trap among them is rethrown only after all three. **Beyond the list, because `watchOf` now hands traps on:** `lookFor`'s catch and `progress()`'s two `publicUnsettled` catches would have taken that same trap again one level up, so they rethrow it too. `publicSubmit` keeps Home's watch of the mix it sent before it rethrows a trap from that read. |
| L4 | fixed | **lovejoin.ts:** `listing()` and `tailChain`'s `ours` read spent marks on `deps.now()`. **sessions.ts:** `sendRecorded`'s two `rememberSpent` calls write on `now()`. Its five `spentSet` reads (close, the restore scan, sendChain's `spentSince`, `listNow`, `listing`) read on it too, so the file writes and reads on one clock. **w-left's bring tests move the clock now:** `lapsed` is gone. **Three older tests** wrote their marks with `Date.now()` and now write `t.clock.now`. One of them, lovejoin.test.ts' final review lovejoin-1, had stopped testing its point: see Tests. |
| Q: the late line after Stop | fixed (words) | `settings.lovejoin.bringLate` says what's true either way. If the run goes on, the box is sent again once its spend lapses, two hours after it went. If you stop, it's read once two hours on and given a wait of its own. New value: "One isn't on chain after 10 minutes. If a node dropped it, it's sent again within 2 hours while the wallet is unlocked, or after its own wait if you stop." |
| Q: three lines above Stop | fixed | When it's late, the separate "Keep Seedelf Wallet unlocked…" line no longer shows: the late line carries "while the wallet is unlocked". The late state is now the count's line, one note, and Stop. Before, three lines stacked above Stop. Every other state keeps the unlocked line. |
| Q: a cut collateral's mix | fixed | New `tailBuildable(c, now)` is tailOf's own rule, and `tailOf` now uses it. New `tailBoxes(s, now)` gives the collateral's boxes a session's mix will spend: a waiting tail's (`tailWaits`), or the last rebuildable tail of each session's. Bring every box back now leaves those boxes out of what it takes, and says `waiting: "collateral"` when they're all that's left. It does so while a lock-cut chain's return may still build the mix again (fewer than TAIL_TRIES builds, within TAIL_KEEP_MS of the deposit). Past that, it brings the box back, not mixed. |

### Why the fixes differ from the suggested ones

- **L2: the pressing page says Stopped too,** through the same mark. The lead's line was "make BringAllBack say Stopped, not Done, wherever the run was stopped". That page said nothing before, and now both pages say the same count, the worker's at Stop. A press sets `halted`, and the first read sent after its request answered says it, once. sc-lj-2's test, whose reads carry no mark, still sees nothing said.
- **L2: the mark is kept until the next ask, with no time bound.** A page in a background tab may read only once a minute. A time bound short enough to matter could let such a page miss the mark and say Done. The mark is a few bytes in a record that exists anyway.
- **L3, three catches beyond the list:**
  - `lookFor`'s `.then(…, () => undefined)` and `progress()`'s two `publicUnsettled(...).catch(() => undefined)` would each have taken the trap `watchOf` now hands on, so on the page's path the `watchOf` fix would have changed nothing.
  - `publicSubmit` reads `watchOf` after its submit. The brief's rule ("bookkeeping after a submit must still run: rethrow after it, not before") puts Home's watch first. With no answer from that read, the watch goes on the classic pool's feed, which watchSent defaults to.
- **L4, sessions.ts's reads too.** Moving only its writes would have split sessions.ts against itself: in tests, its own marks would sit in the future of its own reads, held for good. A scratch copy showed what moving the reads costs: 2 of 877 tests failed, both because the test wrote its mark with `Date.now()`. The first copy run was invalid: `now` wasn't in scope at those sites. It was redone with `this.deps.now()`.

## Tests

Every new test names its 1.6.0 origin. Every mutation was undone with Edit, run, and put back with Edit. The log is the scratchpad's `fx-lj-2-mutations.log`, and a grep afterwards finds no mutation left.

**L4**
- **`tests/lovejoin-bring-review-fixes.test.ts`, w-left's three tests in "a withdraw of Bring every box back now that a node dropped".** `lapsed` is removed, so each test moves the clock SPENT_KEEP_MS on. The describe's comment says why. Fail before, on today's tree:
  - `counts a box…`: `expected [] to have a length of 1 but got +0`;
  - `gives the box its due time back after Stop…` and `…once the run stopped itself too…`: `expected [ 1800054120000 ] to have a length of 2 but got 1`.

  Mutation M12, `listing()` back on `Date.now()`: the same three lines.
- **`tests/lovejoin-planner.test.ts`, "reads a send of the wallet's own by the marks it still holds on its own clock, never one held no longer (L4)"** (new). A cut collateral's box, not listed, whose spend mark is 3 hours old on the wallet's clock, waits (`lj.tail.waiting`); its tail isn't over.
  - Fail before: `promise resolved "{ …(10) }" instead of rejecting`.
  - Mutation M13 (`ours` back on `Date.now()`): the same.
  - 323-worker#5's "takes its box for moved at once…" now writes its mark with `t.clock.now`. It passes before and after.
- **`tests/spent-clock-review-fixes.test.ts`** (new):
  - "writes what its return spends on the services' clock, held as spent two hours on it, then free, sent or maybe sent". Fail before: `sent: 0101…#1: expected 1792982447459 to be 1800000000000`. Mutations M14 (the maybe-sent write) and M15 (the sent write) each fail it.
  - "reads the session's account less what the wallet spent on the same clock: its return's spends held two hours, then listed again". Mutation M16 (`listNow`'s read back on `Date.now()`): `expected +0 to be 3`.
  - The other four sessions.ts reads are the same one-line change. Each is covered only by the adapted tests below, which pass with either clock.
- **Adapted tests** (setup only, a mark's time):
  - `tests/return-chain-scope.test.ts` (independent review L18) and `tests/sessions.test.ts` (final review sessions-1): `Date.now()` becomes `t.clock.now`.
  - `tests/lovejoin.test.ts` (final review lovejoin-1): the same, plus one assertion that the spend hides the box (`notMixed` is `[]`). With the mark on `Date.now()`, the box was no longer hidden once listing() read the wallet's clock: the test still passed, but no longer tested its point.

**L3**, in `tests/run-traps-review-fixes.test.ts`, new describe "a trap under a catch that takes any failure (1.6.0's release review, L3)". Each test runs with both of w-left's traps (a `WebAssembly.RuntimeError`, and a real V8 stack overflow inside WebAssembly).

| test | guard for every other failure | fail before | mutations |
|---|---|---|---|
| "hands a trap in the read of a chain's pools for its watch on, a read that fails still naming each by its id" | readSet rejecting a plain error: the pool named by its id | `promise resolved "Map{ …(1) }" instead of rejecting` | M4 (watchOf) |
| "hands a trap in the read of the pools' mix boxes for Activity on, as Activity does, …" (mixBoxes and Activity's `cardano`) | the classic pool's mix box; Activity's list read | `promise resolved "[ '67ffe4…' ]"…` | M5 (mixBoxes), M6 (activity.ts) |
| "hands a trap on from the Lovejoin page's progress: sending more of a mix, or looking for a transaction that may have gone through" (pumpPublic; a token-pool mix stopped maybe-sent, its progress gone, and kept) | a plain send failure: `null` | `promise resolved "null" instead of rejecting` | M1 (pumpPublic), M2 and M3 (each publicUnsettled catch), M4, M8 (lookFor) |
| "keeps Home's watch of a mix from the public account it sent before it hands on a trap in the read of its feed" | none | written after the fix | M9 (the trap thrown before watchSent): `expected undefined to match object` |
| "keeps a withdraw sent as sent, its box counted back, before it hands on a trap in what comes after its submit" | none | `promise resolved "[ { kind: 'lovejoin-withdraw', … } ]"…` | M10a (rethrow before dropWithdrawing): `expected { …(7) } to be undefined`; M10b (traps swallowed) |
| "hands a trap in the read of the 5 ₳ pool's boxes on, a read that fails still leaving the collateral out" | credential_utxos 500: `undefined` | `promise resolved "undefined"…` | M7 (split) |
| "hands a trap in a funding's look for the 5 ₳ pool on, the funding going on without its reserve where that look fails otherwise" (siteOutBuild) | a plain error: funded, no reserve | `promise resolved "{ changeLovelace: … }"…` | M11 (tailReserve) |

**L2**
- **`tests/lovejoin-bring-review-fixes.test.ts`, describe "Bring every box back now stopped by Stop (L2)":**
  - "marks the stop with how many it sent and its pool, kept sealed through a restart, until it's asked again". Mutation M17, today's behaviour: `expected undefined to deeply equal { back: 2, pool: 'classic' }`. M19 (a new ask keeps it): `expected { back: 2, pool: 'classic' } to be undefined`.
  - "marks no stop for a run that stopped by itself, whose stop Settings says already". M18: `expected { back: +0 } to be undefined`.
- **`tests/lovejoin-bring-screen-review-fixes.test.ts`, describe "Bring every box back now stopped, on this page or another (L2)".** `page()` now records the third argument of `done`. Three tests:
  - "says Stopped, with how many the worker counted, where Stop was pressed on another page or tab, never Done";
  - "says Stopped on the page that pressed it too, once a read sent after its request finds the worker's count";
  - "still says Done for a run that ended with no Stop, and words a stopped one as stopped".

  Fail before:
  - `undefined: expected [ undefined ] to deeply equal [ true ]` (another page said Done);
  - `expected [] to deeply equal [ 4 ]` (the pressing page said nothing);
  - `expected 'Done: 3 boxes back in your private ba…' to contain 'Stopped: 3 boxes sent back.'`.

  Mutations M20 (the mark ignored), M21 (`halted` never set) and M22 (`doneStopped` ignored) each fail the test(s) above.

**The late state**, `tests/lovejoin-bring-screen-review-fixes.test.ts`, in the 321-lj-worker#4 describe:
- New: "says what comes of the late withdraw whether it goes on or stops, in one line beside Stop that says to stay unlocked". It checks one `class="note"` in the late state, on Settings and a pool's page, and that the unlocked line still shows when not late. Mutation M23 (the unlocked line shown when late): `…not to contain 'Keep Seedelf Wallet unlocked'`.
- The existing late test now reads the new line through `LATE`.

**The cut collateral's mix**, `tests/lovejoin-bring-review-fixes.test.ts`, in the x-scenarios-lj#1 describe: "leaves the collateral's box to its mix once a lock cut its chain, while its return may build that mix again, a day at most". It runs on wlj-2's `waitingTail`, then a lock wipes the progress and the reservation. The run takes d1, says `{ back: 1, left: 1, waiting: "collateral" }`, and `tailOf` still returns the tail. A day after the deposit, it brings e0 back.
- Fail before: `expected [ { …(5) }, { …(5) } ] to have a length of 1 but got 2` (the collateral's box taken in the first run).
- Mutations:
  - M24 (takes not filtered): the same line;
  - M25 (no rebuildable tails in `tailBoxes`): the same;
  - M26 (no day bound in `tailBuildable`): this test fails (`expected [] to have a length of 1 but got +0`), and so does the planner's 323-worker#8, through tailOf's refactor.

## Files touched

- `extension/src/background/lovejoin.ts`:
  - `Schedule.bringStopped`, `empty()`, the reader, `held()`, `bringAllBack`, `stopBringingAllBack`;
  - `unlessTrap`, `progress()`, `watchOf`, `mixBoxes`, `collateralPool`, `lookFor`, `publicSubmit`, `withdrawOne`'s post-submit steps;
  - `listing()`, `tailChain`'s `ours`;
  - `tailBuildable`, `tailBoxes`, `tailOf`, `bringAllBackNow`'s takes and its doc comment.
- `extension/src/background/sessions.ts` (Lane X's; anchored): `tailReserve`'s catch; `sendRecorded`'s two `rememberSpent` calls; the five `spentSet` reads.
- `extension/src/background/activity.ts`: the catch over `mixBoxes`.
- `extension/src/shared/rpc.ts`: `LovejoinHeld.bringStopped` (additive).
- `extension/src/ui/components/BringAllBack.tsx`: `bringFollower` (`halted`, the stopped branch), the `done` state, `BringAllBackView`'s `doneStopped` and the late state.
- `extension/src/i18n/translations/{en,es,ja}.json`, `docs/i18n/{es,ja}-provenance.json`: anchored edits.
- Tests:
  - `tests/run-traps-review-fixes.test.ts` (one describe, 7 tests; imports);
  - `tests/lovejoin-bring-review-fixes.test.ts` (L4's three tests, the cut-tail test, the L2 describe; imports);
  - `tests/lovejoin-bring-screen-review-fixes.test.ts` (`page()`, the L2 describe, the late test);
  - `tests/lovejoin-planner.test.ts` (one new test, one mark's time);
  - `tests/spent-clock-review-fixes.test.ts` (new);
  - `tests/return-chain-scope.test.ts`, `tests/sessions.test.ts`, `tests/lovejoin.test.ts` (a mark's time each; one assertion in lovejoin.test.ts).

## Keys

**Critical keys added or changed: none.** `node scripts/i18n-critical.mjs` (print only) lists neither of mine. Its difference from the checked-in list is other lanes' keys: `collateral.warn.bothLand`, `lovejoin.mix.privacy.collateralIfLeft` and `lovejoin.stuck.privacy.privateNamed` in, and `lovejoin.stuck.privacy.privateAccounts` out.

**Other keys:**
- **Added:** `settings.lovejoin.bringStoppedSent`, en `_one`/`_other` "Stopped: {{boxes}} sent back."
  - es `_one` "Detenido: {{boxes}} enviada de vuelta."; `_many` and `_other` "Detenido: {{boxes}} enviadas de vuelta."
  - ja `_other` "停止しました: {{boxes}}を送り返しました。"
  - Provenance `machine` for each.
- **Changed:** `settings.lovejoin.bringLate`, as above.
  - es: "Una de ellas no está en la cadena tras 10 minutos. Si un nodo la descartó, se envía de nuevo en menos de 2 horas mientras la billetera esté desbloqueada, o tras su propia espera si lo detienes."
  - ja: "そのうち 1 つが 10 分たってもチェーンにありません。ノードに破棄された場合は、ウォレットのロックが解除されている間に 2 時間以内にもう一度送ります。停止すると、そのボックスの待ち時間のあとに送ります。"
  - Both stay `machine`.

No e2e expectation names these words, or Stop's states.

## Docs to update

1. **flows.md:527** (Bring every box back now). Now true:
   - A Stop pressed on one page reads as "Stopped: N sent back." on every page that saw the run go, the pressing one included, never Done. The worker keeps that stop, sealed, until it's asked again.
   - When it's late, there's one line beside Stop: "One isn't on chain after 10 minutes. If a node dropped it, it's sent again within 2 hours while the wallet is unlocked, or after its own wait if you stop." In that state "Keep Seedelf Wallet unlocked" isn't shown apart.
   - After a lock cut a session's return at its collateral's mix, the run leaves the 5 ₳ box to that mix while its return may build it again (two builds in all, a day from its deposit), saying it waits for its mix. After that, it brings the box back, not mixed.
2. **architecture.md:424** (`lovejoin.<network>`'s contents): `bringStopped`, Bring every box back now's last run stopped by Stop, its count and pool, sealed, until it's asked again. Also `LovejoinHeld.bringStopped`.
3. **architecture.md:52** (a call that traps), adding to w-left's item 1:
   - These hand a trap on too: `watchOf`'s and `mixBoxes`' pool reads, Activity's read of the pools' mix boxes, the Lovejoin page's progress (sending more of a mix, and looking for one that may have gone through), and the 5 ₳ pool's read, in `collateralPool` and in a funding's reserve.
   - A withdraw's bookkeeping after its submit, and Home's watch of a public mix, run first.
4. **architecture.md, spent marks (spent.ts):**
   - Lovejoin's and the sessions' services write and read the marks on their own clock (`now`).
   - pending.ts still writes its own on the device's clock. It's the same clock in the worker.
5. **architecture.md, the worker's withdraws / the collateral's tail:** `tailBuildable` is tailOf's rule; `tailBoxes` is what Bring every box back now leaves to a session's collateral's mix.
6. **privacy.md, Bring every box back now:** a session's collateral's box waits for its mix, a day at most, rather than come back unmixed. That covers a chain a lock cut too.
7. **The privacy policy: no change, I think.** No new request, no new party; the stop mark is on the device, sealed. It's the docs lane's call.

## Calls the owner might overturn

1. **The page that pressed Stop also says "Stopped: N sent back."** That's a new line on that page, which said nothing before. Without it, only the other pages would say it.
2. **The Stop mark has no time bound.** It goes at the next ask, or with the wallet.
3. **The late line's wording,** and the unlocked line folded into it, in the late state only.
4. **A cut collateral's mix: the run waits up to a day for the session's return to build that mix again.** A swap's runner builds it by itself. A site's session, or one stopped to come back directly, may never build it. The run then waits the whole day, saying "a day at most", and brings the box back, not mixed. Stop ends it at any time. This is private by default, as the lead asked.
5. **L4 goes past the named sites:** sessions.ts's five reads moved too, so the file is on one clock. pending.ts's three writes (`rememberSpent` with no time, at :351, :523 and :875) stay on the device's clock. Moving those touches every private send's tests; I left it.
6. **L3 goes past the list:** lookFor, progress's two `publicUnsettled` catches, and publicSubmit's watch. Each was needed so `watchOf`'s rethrow reaches a handler.

## Notes for the lead and other fixers

- **No test needs the pkg rebuilt.**
- **Lane X (fx-reserve-2):** my sessions.ts hunks are anchored one-liners:
  - `tailReserve`'s catch;
  - `rememberSpent(…, now())` at `sendRecorded`'s two calls;
  - `spentSet(session, …now())` at close, the restore scan, `sendChain`, `listNow` and `listing`.

  I re-read each before editing. A rerun once met your mid-edit `refuseParts` ("this.refuseParts is not a function"); it passed when rerun.
- **Catch-alls seen and not changed** (not listed, and no trap reaches them through my changes):
  - settleWithdrawing's `activity.sent(...).catch(() => undefined)`: the same shape as withdrawOne's, but ActivityService.sent calls no WebAssembly;
  - activity.ts' `ownDrepId(this.deps).catch(() => undefined)` (Activity's DRep name);
  - `unreadCopies`' `copies` catch (no WebAssembly).
- **The other clocks:** balances.ts, account.ts, contract-scan.ts, coin-control.ts, activity.ts and dapp.ts read `spentSet(session)` on the device's clock, and pending.ts writes on it. They're consistent with each other and with the worker, but not with a test's clock.
- **Visual check (lead), Settings → Lovejoin, and a pool's page, Bring every box back now:**
  - Stop pressed in a tab while the side panel's pool page shows the run: "Stopped: N sent back." on both, never "Done";
  - the late state: the count's line, one note, Stop;
  - a session's return cut by a lock at its collateral's mix: "What's left is a session's 5 ₳ collateral: it waits for its mix, a day at most."
- **Scratch files** are `fx-lj-2-*` in the scratchpad: the fail-before and mutation logs, the critical-set print, the broad runs' logs, and the copy used for the sessions.ts reads (`fx-lj-2-copy/`, deleted before return).

## Checks

| check | result |
|---|---|
| Each new test on today's tree, before its fix | failed for its reason, as above. Two were written after their fix, and fail under its mutation: publicSubmit's watch (M9) and the L2 worker tests (M17, today's behaviour). Logs: `fx-lj-2-l4-failbefore.log`, `fx-lj-2-l3-failbefore.log` |
| Mutations M1–M26 | each failed its test(s), and each was put back with Edit. A grep for the markers (`&& false`, `(_e: unknown) => {}`) finds none |
| `npm run typecheck` | clean (after one fix in my own test: `t.deps.koios()` takes no network) |
| Broad set, default build: lovejoin\*, session\*, chain\*, return\*, parts\*, payment\*, withdraw\*, run\*, remove-wallet\*, public-mix\*, collateral\*, script-spend\*, restore\*, swap\*, site\*, maybe-sent\*, pending\*, submit\*, approvals\*, dapp\*, spent\*, activity\*, settings\*, screens\*, home\*, unlock\*, handlers\*, worker\*, i18n\*, words\*, privacy-notes\*, wasm\* | 158 files: 1,908 passed, 2 skipped, 3 failed. The 3 are `tests/i18n.test.ts`' critical-key gate: other lanes' keys and L5 |
| The same set, `VITE_ENABLE_MAINNET=false` | the same: 1,908 passed, the same 3 |
| L4's first broad run (before L2, L3 and the questions): the worker set above, less the screens and i18n | 131 files: 1,432 passed, 2 skipped |
| My files plus the 1.5.0 gate, at the end, on both builds | 12 files: 383 passed on each |
| `tests/lovejoin-1-5-0.test.ts` (the 1.5.0 gate) | passes unedited, on both builds |
| `node scripts/i18n-critical.mjs` (print only, never `--write`) | none of my keys in the derived set; the difference is other lanes' |
| The copy run for sessions.ts's reads | 877 tests: 2 failed, both on a test's own `Date.now()` mark, adapted here. The copy is deleted |
| Not run (the brief) | e2e, any build, `--write`, cargo |
