# v-pr337-3-impact: pr337#3, impact and the fix

**Finding:** "A press is lost while the runner builds that mix again: the new chain takes the tail on, not over."

**Verdict:** confirmed. **Severity:** low, as filed. Confidence is high: the mechanism was read on HEAD and measured, and both fixes were measured in a copy.

## The mechanism on HEAD

- **The press runs outside the queue.** `skipCollateralMix` calls `tailHeld` and `tailOver` outside `this.serial` (`sessions.ts:5526-5538`). Only its pump and its `advance` are queued.
- **The runner holds an old copy.** The runner's rebuild runs inside the queue:
  - `act` → `bringBack` (`sessions.ts:3617/3622`) → `buildBack` → `tailChain` (`sessions.ts:4387`);
  - `tailChain` takes chain A's tail as a copy, `return { id: c.id, tail: { ...c.tail }, ended: c.ended }` (`lovejoin.ts:4017`);
  - after reads and the WebAssembly build, it reaches `sendChain` → `recordChain`.
- **recordChain hands the tail on only if it isn't over.** `const was = resumes ? …; if (was && !was.over) { was.over = true; handedOn = true; }` (`lovejoin.ts:4998-5002`). The new tail is built with no `over` (`lovejoin.ts:4955-4968`).
- **The result:** a press that marks A over between `tailOf`'s read and `recordChain`'s update leaves B's tail live. B's pump passes `witnessTail`'s `tailIsOver` (`sessions.ts:5144`) and asks giveme.my again.

## Scratch test

The test was `zz-review-v-pr337-3-impact-1`, now deleted.

**Setup:**
- The harness is copied from the collateral block of `lovejoin-planner.test.ts`.
- `stoppedAtMix()`: giveme.my refused past its wait, so the chain stopped with its tail buildable.
- `landed` is moved back by `TAIL_OFFER_MS`.
- The session is made a swap that runs itself (`auto`, `swap`, no `site`).
- The runner's step is `advance(…, true)`.
- **The press** is fired from a wrapper on `lj.tailLanded`, which `tailChain` calls right after `tailOf` took A. The wrapper waits, with a bound, until A is over, then lets the rebuild go on.
- **The fixes** were applied in two copies under `scratchpad/review/v-pr337-3-impact/`.

| Case | HEAD | Fix 1 (press in `serial`) | Fix 2 (`recordChain`) |
|---|---|---|---|
| R6a, press during rebuild, giveme.my busy | A over. B `{tries:2}` **not over**. giveme.my +1. Nothing sent. **View still `collateralHeld`.** A second press works: B stops (`lj.tail.skipped`), the return is sent. | One press works: B over, a direct return is sent. giveme.my **+1** | One press works: B recorded over and stops at its mix, a direct return is sent. giveme.my **+0**. No hold |
| R6b, same, giveme.my answering | B's mix and return are sent. giveme.my +1. No hold: the press is overridden and the box mixed after all | Same as HEAD (+1, the mix goes) | B stops at once, a direct return is sent, giveme.my +0 |
| Press after the rebuild (busy) | Works in one press | Works | Works |
| Press before the rebuild (busy) | Works, giveme.my +0 | Works | Works |
| R4: by-hand review built, press in another window, then Send | B's mix and return are sent. giveme.my +1 | Unchanged | **Send rejected** with `lj.tail.skipped`, nothing sent |

**Existing tests with each fix:**
- The 41 collateral tests in `lovejoin-planner.test.ts` (`-t collateral`) pass with each fix.
- With fix 2, `collateral-again-review-fixes`, `collateral-reserve-review-fixes` and `session-collateral` also pass (41 tests).

## Is it reachable with the store build? Yes, rarely

- **Only a session that runs itself,** a swap or a mix. The runner steps nothing else (`sessions.ts:3446`, `if (!s || !running(s)) return;`).
- **At most one rebuild per tail:** `TAIL_TRIES = 2` (`lovejoin.ts:328`).
- **When the rebuild runs:**
  - after a lock cut, it waits the unlock's draw, 2 to 20 min (`UNLOCK_WAIT_MS`, `lovejoin.ts:1525`), then goes on the alarm's or the page's next step;
  - after a giveme.my refusal, it goes on the next step.
- **The button is up throughout,** from the hour on. A press during the unlock wait works.
- **The window** is that one step's reads (discovery, the pools' listing, ownership), plus `buildCollateralMix`, `leftBy` and `sendChain`'s checks: seconds, at a time the user can't see.
- **The page can trigger it.** Its own 20 s advance (`Swaps.tsx:2159`; the same on the Lovejoin page, `ADVANCE_EVERY_MS` at `Lovejoin.tsx:143`) sets `checking`, not `busy`. So the button stays enabled while that step runs.
- **R4 needs two windows.** Both by-hand pages replace the session page with the review (`Swaps.tsx:2257`, `SiteSessions.tsx:241`).

## Harm: low

- **No money is at risk:** nothing is lost or locked, there is no stuck state, and nothing new is sent anywhere.
- **giveme.my busy:** the press is lost. The same line and button come back, and a second press works. If the user ignores it, B keeps asking until a day after A's deposit (`TAIL_KEEP_MS`, the 1.6.0 behaviour), then the rest comes back, since B was the last build.
- **giveme.my answering:** the mix goes after the press and the rest comes back with it. The user gets the rest at once, and the box is more private than the way-out line promised.
- **The extra giveme.my request** is for the same mix the approval already disclosed ("giveme.my backs that mix, so it sees it").
- **Why not medium:** nothing is stuck, and no money or privacy statement turns false. This is an edge case and a small UX defect.

**R4 is not a defect on HEAD.** The review sent there shows the collateral's mix, "Its 5 ₳ collateral: Mixed once in Lovejoin's pool…", and its note says "giveme.my backs that mix, so it sees it." Sending it does what it showed: in two windows, the later action wins.

## The fix

### Fix 2: the right minimal one

It is one branch in the same atomic `update` that hands the tail on (`lovejoin.ts:4999`):

```ts
        if (was && !was.over) {
          was.over = true;
          handedOn = true;
        } else if (was?.over && record.tail) {
          record.tail.over = true;
        }
```

- **What it closes:** all of R6. giveme.my isn't asked again. The press's own queued `advance` brings the rest back directly in the same request. It passes the finding's proposed test.
- **What else it changes:**
  - **R4:** the stale review's Send fails with the skip's words and sends nothing. The user then brings the rest back again, as a plain return. That follows the user's own press (the PR's contract: a press stops a chain at its mix), not a new guard. If the owner would rather a later Send win in that two-window corner, that is their call.
  - **The runner's step** records a retry with the skip's words for a moment. The press's queued `advance` clears it in the same request.
  - **No text, key or privacy note changes.**
- **Other ways a resumed tail is already over at `recordChain`:** only `tailOf` and `tailChain` (both in the queue) and the press set `over`. So outside these races, nothing else hits the branch.

### Fix 1: partial

Running the press's `tailHeld`, `tailOver` and pump in `this.serial` ends the second press. But the runner's own pump of B asks giveme.my before the queued press runs, and with giveme.my answering, the mix goes. **It fails the finding's own test** ("giveme.my not asked again"), and it leaves R4 as it is.

If it is chosen:
- use one `serial` task that calls `pump`, `step(…, "asked")` and `one` directly;
- never `this.serial` or `advance()` inside it, or the queue waits on itself;
- the press then waits behind the runner's step (up to `CHAIN_PUMP_MS`, 20 s, plus the reads), with the button busy.

Both fixes keep to the owner's rules: the default stays the mix, the way out stays a visible button, and no text changes.

## The test to add

- **Hook placement.** The finding's hook on `buildCollateralMix` is a synchronous WebAssembly call, so it can't wait for the press. Whether its `tailOver` lands before `recordChain` then depends on microtask order. Instead, wrap `lj.tailLanded`, which `tailChain` calls right after `tailOf`: fire `skipCollateralMix`, then await `tailIsOver(A)` with a bound, so the test can't hang if the press is queued.
- **Assert both giveme.my answers:**
  - **busy (503):** on HEAD, B's tail is not over, giveme.my is asked one more time, and the view is still held;
  - **answering (200):** on HEAD, B's mix is submitted;
  - **with fix 2, either answer:** B's tail is over, giveme.my isn't asked again, one direct return is submitted, and nothing is held.
