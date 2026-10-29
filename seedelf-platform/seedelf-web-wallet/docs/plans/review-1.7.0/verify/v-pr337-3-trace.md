# v-pr337-3-trace: pr337#3, a press lost while the runner builds the collateral's mix again

**Verdict: confirmed. Severity: low** (the finding's own rating). The main scenario happens on HEAD as described. The secondary variant (a review built before the press and sent after it) is also real, but it needs two windows. Confidence: high. A scratch test reproduced it, and a no-race control isolates the window.

## Trace on HEAD (6bca8bec)

1. **The press is outside the queue.** `skipCollateralMix` (sessions.ts:5526-5538) calls `this.deps.lovejoin?.tailHeld(network, index)` and then `tailOver(network, held.id)` with no `this.serial`. Only its pump (5532) and the final `advance` (3219-3224) enter the queue.
   - Nothing outside the queue orders the press against the runner either. `answerUi` (sw.ts:371-381) hands each page message straight to `handle`, and the alarm's `runAll` runs beside it.
2. **The runner's rebuild happens in one queued task:**
   - `runAll` → `serial(step)` (3366), or the page's `advance` every 20 s (Swaps.tsx:2064, Lovejoin.tsx:143).
   - `act` → `bringBack` (3617) → `buildBack` → `lovejoin.tailChain` (4387).
   - `tailOf` reads chain A and returns a copy, `{ id: c.id, tail: { ...c.tail }, ended }` (lovejoin.ts:4017).
   - Then the pool read in `split`, `tailLanded`, `spentSet`, the WebAssembly build, `leftBy`, and `sendBack` → `sendChain`, which does more storage awaits.
   - Last comes `recordChain` (sessions.ts:4979). Every await in that list is a point where the press's handler runs.
3. **`recordChain` builds B's `Tail` with no `over`** (lovejoin.ts:4956-4968). It hands A's tail on only if A isn't over yet: `if (was && !was.over) { was.over = true; handedOn = true; }` (4998-5002).
   - If the press ended A after `tailOf` read it, B is recorded live, with `tries: 2` and A's `landed`.
   - Only two places ever set `over`: `tailOver` (4144) and that hand-on (5000). The press is the only `tailOver` caller outside tailOf/tailChain's own paths.
4. **B's mix asks giveme.my.**
   - `sendChain` pumps right after recording (4991).
   - `witnessTail` checks only B's own tail: `tailIsOver(network, pending.txs.at(-1)!.txHash)` (5144). That is false, so `tailWitness` asks giveme.my.
   - Neither the press's queued pump nor its `advance` stops B: the same check is still false.
5. **The press's response still offers the way out.**
   - `advance` → `one` → `tailHeld` finds B, because `tailWaits(B)` is true (lovejoin.ts:1319: not ended, not over, not scheduled, `landed` set).
   - `offerAt` is A's `landed` + 1 h, already past.
   - `CollateralHeldWayOut` shows the button whenever `held && now >= offerAt` (LovejoinReturn.tsx:548).

## Scratch test (run alone, then deleted)

`extension/tests/zz-review-v-pr337-3-trace-1.test.ts` used the planner test's helpers, copied: real WebAssembly, a 5 ₳ pool started by the wallet, and fakes of Koios and giveme.my.

**Setup.** A mix session as `mixOutSubmit` records it (`auto`, `mix: { boxes: 1 }`):

- `advance(…, true)` built and sent its chain: deposit, mix, deposit, mix, back.
- With confirmations on and giveme.my answering 503, the collateral's mix waited (asked 1, `landed` set).
- `wallet.lock()` / `unlock()` cut the chain, and what it sent was marked landed.
- A's `landed` was moved back `TAIL_OFFER_MS + 1 min` in its record, as PR #337's own test does. A clock jump auto-locks the wallet.
- The list then offered `collateralHeld`.

**R1, the race.** Lovejoin's `buildCollateralMix` was hooked to fire the real `sessions.skipCollateralMix("preprod", 0)` once, during the runner's `advance(…, true)`. The test asserted that B's tail is over and that the view holds nothing. It **fails on HEAD**:

```
R1 {"aOver":true,"bIsNew":true,"bTail":{"tries":2,"over":null,"landedFromA":true},"bEnded":null,"bStopped":null,"givemeAsked":2,"viewHeld":{"offerAt":1799999940000}}
AssertionError: expected undefined to be true  (b.tail?.over)
```

This is exactly the finding's R6.

**R2, control with no race.** The same setup, but the press comes after the runner's step has recorded B. It **passes**: B's tail is over, B stopped with `lj.tail.skipped`, the view holds nothing, and the press didn't ask giveme.my again. The defect is the window between `tailOf`'s read and `recordChain`'s write, nothing wider.

**R3, a review built before the press and sent after it.** The session was made hand-run. `backBuild` rebuilt the mix (`["mix","back"]`), then the press, then `backSubmit`:

```
R3 {"pressViewHeld":null,"aOverAfterPress":true,"bIsNew":true,"bTail":{"tries":2,"over":null},"givemeAskedBeforeSend":1,"givemeAsked":2}
```

So the mechanics hold. Here, though, the press's own response offers nothing. The later Send is the user's own act on a review whose rows and note show the collateral's mix. In SiteSessions the review is its own screen (SiteSessions.tsx:241-306), so the button and the review's Send are never on screen together: this needs two windows.

## Reach and harm

- **Timing.** The window is the rebuild's own duration, roughly 1-3 s: a pool read, the mix's build and measuring in WebAssembly, and several storage awaits. It opens at a moment the user can't see. After an unlock it is when the drawn wait ends and the alarm (each minute) or the page's 20 s advance takes the step. The button shows during that whole wait. A press before the rebuild ends A and the rest comes back directly. A press after it ends B, as R2 shows. Only a press inside the window is lost.
- **Harm.** One lost press. The button stays, and a second press works. giveme.my is asked once more in between: if it signs then, the mix goes and the rest comes back after it, which is the private outcome anyway.
- **Not affected.** No money is at risk, nothing gets stuck, and there's no privacy cost.

## Fix advice

- **Option 1 (serialize the press) would deadlock if written literally.** `advance` (3219-3224) and the press's pump (5532) both enter `this.serial`. Nested inside an outer serial task, each waits on the queue's head forever. Do one of these instead:
  - one queued task that calls `this.pump(network, index)` directly, then `this.step(network, index, "asked")` and `this.one(network, index)` (advance's body); or
  - a queued task for `tailHeld`, `tailOver` and pump, followed by a plain `advance` after it.
- **Option 1 doesn't cover R3.** `backBuild` and `backSubmit` are separate queued tasks, and the press runs between them.
- **Option 2 (`recordChain` records B's tail `over` when the tail it resumes is already over) alone leaves a narrower race.** The press's `tailHeld` can read A before `recordChain`'s write while its `tailOver(A)` is queued after it. Lovejoin's `inTurn` orders the two writes, and sealed-store reads go through the wallet's own queue. A is then handed on first, the press's `tailOver(A)` does nothing, and B is live again.
- **Recommended: both.**
  - Serialize the press (option 1, without nesting `serial`).
  - Make `recordChain` treat a resumed tail that is already over as ended (option 2). `witnessTail` then stops B at its mix before asking giveme.my, which is the end state the press already makes for a chain mid-send (R2). Under it, R3's Send fails with `lj.tail.skipped` ("You brought the rest back without waiting for the collateral's mix, so the chain stopped there."), and a fresh build brings the rest back directly.
  - Refusing such a review before it's recorded would be cleaner, but it's a new refusal. Under the owner's rule 1 it would be an owner's call, so I don't propose it here.
- **Tests.** The finding's test (hook `buildCollateralMix` to fire `skipCollateralMix` once; afterwards B's tail is over and the view holds nothing), plus R3's variant.

The scratch file was deleted. No tracked file was touched.
