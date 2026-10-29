# Verify `pr337#2` (label `v-pr337-2-trace`)

**Verdict: confirmed. Severity: low.**

- **The `tailBuildable` branch has no test.** No test covers `tailHeld`'s `tailBuildable` branch, and no test covers the skip for a session that runs itself. Both paths work on HEAD: my three scratch tests pass there.
- **Mutation M2 goes unseen.** It removes `tailBuildable` from `tailHeld`. All 81 tests in `lovejoin-planner.test.ts` and `collateral-held.test.ts` still pass, and two of my scratch tests fail.
- **Mutation M3 goes unseen too.** It stops `skipCollateralMix` from advancing the session. The PR's own test still passes, and my runs-itself test fails.
- **One claim is too strong.** The scenario says that under M2 a lock-cut session "never" offers the way out. It still offers it until a Lovejoin read marks the chain cut, and while a rebuilt chain waits (details below).

Traced on HEAD `6bca8bec`. #338 is docs only: `git diff 11e249d2 HEAD -- seedelf-platform/seedelf-web-wallet/extension/` is empty.

## The paths

### `tailHeld` (`lovejoin.ts:4127-4133`)

- It has two branches: `if (!tailWaits(c) && !tailBuildable(c, this.deps.now())) return undefined;`
- `tailWaits` (`:1319`) requires `!c.ended`. So it covers only a chain still being sent.
- `tailBuildable` (`:1334-1341`) requires `!!c.ended`. It covers a chain that stopped:
  - a lock cut it;
  - giveme.my refused past `GIVEME_BEHIND_MS`;
  - a box it drew is gone;
  - the network measured it higher.
- It also covers the waits that may follow (`fewBoxes`, `noPool`, `unlisted`), for up to `TAIL_KEEP_MS`.

### Lock cuts are marked by `cuts`, not by `tailHeld`

- `tailHeld` never calls `cuts`. `cuts` (`:5309-5334`) is what sets `ended` and `cut` on a chain whose progress a lock wiped.
- Nearly every Lovejoin read calls `cuts` first:
  - `progress` (`:2800`);
  - `tailOf` (`:4010`);
  - `chainsSending` (`:5338`), which the lock countdown asks (`handlers.ts:191-193`);
  - `chainsMixing`, used by the withdraws (`:5348`);
  - `status` (`:5786`);
  - `chains` (`:5903`);
  - `mixes` (`:5915`);
  - `held` (`:6084`).
- So once the wallet is unlocked again, a lock-cut chain reads as ended almost at once. From then on only `tailBuildable` keeps the offer.

### The skip for a session that runs itself (`sessions.ts:5526-5538`)

1. `skipCollateralMix` calls `tailOver`, then `pump` if a chain is still being sent. `witnessTail` then throws `lj.tail.skipped` (`:5144`).
2. It then calls `advance(network, index, true)` (`:3219-3224`), which runs `step(…, "asked")`.
3. `step` returns at once unless `running(s)` (`:3446`). `running` (`:1230-1232`) is `!!s.auto && …`, so a site's session never gets past this point.
4. For a session that runs itself, `act` continues: a mix goes to `bringBack` (`:3617`). `waits` returns false for `"asked"` (`:3746+`).
5. `bringBack` calls `buildBack`. Its `tailChain` returns nothing once the tail is over (`:4386-4390`), so the return goes directly.
6. `sendBack` then submits the direct return, in the same request.

## What the tests cover

- **Only one worker test.** Only `lovejoin-planner.test.ts:1791-1828` reads `collateralHeld` or calls `skipCollateralMix`. Nothing in `e2e/` does, and no screens test passes a `collateralHeld` view. `collateral-held.test.ts` renders the component alone.
- **That test reaches neither path.**
  - Its `setUp` (`:1331-1341`) makes a site's session (`siteSession`, no `auto`). giveme.my answers 503, so the chain stays pending and is held through `tailWaits`.
  - Its `advance` stops at `!running(s)`. So `step`, `act` and `bringBack` never run after the skip.
- **The file reaches `tailBuildable` states but never asks for the offer there.**
  - `stoppedAtMix` (`:1450-1471`) and `cutAfterDeposit` (`:1635-1649`) reach those states.
  - So does the 1546 test: it removes `${SESSION_CHAIN_PREFIX}preprod.0`.
  - None of them reads `collateralHeld`.
- **No other test file can detect M2.**
  - A collateral tail needs a 5 ₳ ADA pool: `collateralPool`, `lovejoin.ts:3969`, `!p.token && … p.lovelace === COLLATERAL_LOVELACE`.
  - Only the planner launches one (`adaPool`). The 5 ₳ pool in `lovejoin-flows.test.ts:974` is a MIN token pool.
  - The tails written by hand in `lovejoin-stopped-shown.test.ts:142,165` carry no `landed`, so `tailHeld` returns undefined there either way.
  - The tails in the bring and crediting review-fix tests are `CollateralTail` summary shapes, not chain records.

## Scratch tests and mutation runs

### On HEAD

`tests/zz-review-v-pr337-2-trace-1.test.ts`, run alone on HEAD: **3 passed**. It has three tests:

- **(a1), a site's session cut by a lock.**
  - Setup: giveme.my is busy, then a lock wipes `${SESSION_CHAIN_PREFIX}preprod.0`.
  - Before `cuts`, `collateralHeld` is still defined, through `tailWaits` on a record not marked yet.
  - After `lj.cuts("preprod")`, the record reads `ended` and `cut: true`. **ZZ-A1:** `collateralHeld` equals `{ offerAt: landed + TAIL_OFFER_MS }`.
  - A skip before the hour changes nothing.
  - An hour on, the skip sets `tail.over` and clears `collateralHeld`. Then `backBuild` has no `collateralTail`, and giveme.my isn't asked again.
- **(a2), a site's session whose mix giveme.my refused.**
  - Setup: giveme.my refuses past `GIVEME_BEHIND_MS`, so the chain stops with `tries: 1`. The pool's two other boxes are then spent, so `backBuild` throws `lj.tail.fewBoxes`.
  - **ZZ-A2:** `collateralHeld` is defined, with nothing being sent.
  - An hour on, the skip clears it, and `backBuild` builds the direct return.
- **(b), a mix that runs itself** (`mix: { boxes: 1 }`, `auto.approved`).
  - `runAll` builds and starts its chain: the last three transactions are `deposit, mix, back`.
  - With everything before the mix on chain and giveme.my busy, giveme.my is asked once and `collateralHeld` is shown.
  - An hour on, its box is listed in the pool and the deposit's change is at the account. Then `skipCollateralMix` gives **ZZ-B:**
    - exactly one more submit. It is neither the chain's mix nor its return, and it spends `${deposit.txHash}#${change.index}`;
    - giveme.my still asked once;
    - `collateralHeld` cleared;
    - the chain's record reads `stopped === lj.tail.skipped`;
    - the session's last recorded transaction is a `back`.

### The mutations

Both ran in a copy under `scratchpad/review/v-pr337-2-trace/`. The extension's tests also read `seedelf-core/tests/fixtures/*.json` (for example `fakes.ts:294`) and `seedelf-crypto/tests/vectors/` (`fakes.ts:121`). A copy of the web wallet alone needs those beside it, at `../../../`.

- **M2:** `if (!tailWaits(c)) return undefined;` in `tailHeld`.
  - Scratch: (a1) and (a2) fail at ZZ-A1 and ZZ-A2 with `expected undefined to deeply equal { offerAt: 1800003600000 }`. (b) passes.
  - The existing tests: `npx vitest run tests/lovejoin-planner.test.ts tests/collateral-held.test.ts` gives `Test Files 2 passed (2)`, `Tests 81 passed (81)`. That is the whole file plus the component test, a superset of the finding's 41.
- **M3:** `return this.one(network, index);` in place of `return this.advance(network, index, true);`.
  - Filtered with `-t "offers the rest back|v-pr337-2-trace"`, the run gives `Tests 1 failed | 3 passed | 78 skipped (82)`.
  - The failure is (b) at ZZ-B: `expected [ …(3) ] to have a length of 4 but got 3`. The PR's own test passes.

## Where the finding is narrower than stated

1. **"Never offers the way out" under M2 is too strong.**
   - Right after a lock wipes the pending chain, `tailWaits` still holds, because nothing has set `ended` yet. The first check in (a1) passes under M2.
   - A session that runs itself has its mix built again by the runner after the unlock wait (`tailChain`, `tries` 2, `landed` carried over at `sessions.ts:4414`). That brings `tailWaits` back, and the offer with it.
   - So M2 loses the offer in two cases:
     - **A site's session, after a Lovejoin read marked the chain cut.** The offer is gone until the user presses *Bring back*, which builds the mix again.
     - **Any session whose rebuild waits** (`fewBoxes`, `noPool`, `unlisted`). Nothing else brings the offer back, for up to a day. That is (a2).
2. **"The usual way a held chain ends" holds.**
   - The auto-lock defaults to 15 minutes (`preferences.ts:167`) and is 60 at most (`:76`).
   - The lock countdown only warns about a chain being sent (`handlers.ts:189-193`). It doesn't hold the lock off.
   - `TAIL_OFFER_MS` is 60 minutes.
   - So a held return that reaches its hour has usually been cut by a lock, unless the user kept the screens active. After unlock, a Lovejoin read marks it ended at once.
3. **Other ways out exist even under M2.**
   - A site's review has its direct switch: `buildBack` skips `tailChain` when `direct` (`sessions.ts:4386`).
   - A session that runs itself has *Stop* directly.
   - So M2's harm is the new button missing in its main state, not money stuck. A missing test on this path is **low**, as filed.

## Fix advice

- **(a) The lock-cut test must run a Lovejoin read after removing the pending key.** That read is `lj.cuts`, or anything that calls it, such as `lj.status`. Without it the test passes under M2.
  - Simpler: reuse `stoppedAtMix()` (`:1450`), which already gives a `tailBuildable` record.
  - Add the `fewBoxes` variant (a2). In that state nothing else brings the offer back.
- **(b) As the finding proposes.** Assert that the skip's own request submits exactly one transaction, that it spends the deposit's change, and that the session's last transaction is a `back`. It fails under M3.
- **The pages, optionally.** A render with a past `offerAt` would catch a dropped prop:
  - the Lovejoin page's mix card: `s && s.collateralHeld && !isOver(s) && onSkipCollateral` (`Lovejoin.tsx:2586`);
  - Swaps' two forms (`Swaps.tsx:2513`, `:2567`);
  - `SiteSessions.tsx:411-416`.
- **A ready source.** My scratch file is kept outside the tree at `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/review/v-pr337-2-trace/zz-review-v-pr337-2-trace-1.test.ts.kept`. Its helpers are copied from the planner. Inside the planner, the three tests need only a mix variant of `setUp`.

## Cleanup

- `extension/tests/zz-review-v-pr337-2-trace-1.test.ts` is deleted from the tree.
- The mutation copy (the web wallet, `seedelf-core` fixtures and `seedelf-crypto` vectors) is removed.
- No tracked file was touched. `git status` shows only untracked review files and other agents' scratch tests.
