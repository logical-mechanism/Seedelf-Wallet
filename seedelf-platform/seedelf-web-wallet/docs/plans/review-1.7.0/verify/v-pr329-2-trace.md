# v-pr329-2-trace: pr329#2, #324's call 7 (fx-may's call 1) carried nowhere live

**Verdict: confirmed. Severity: low (docs).** The finding holds on HEAD (`6bca8bec`). Three things narrow it, and none refutes it:
- "tracked nowhere" goes a little too far;
- the gap is older than #329;
- the code path can't run on mainnet today.

## What I traced

**1. #324's seven calls, and where each one went.** `gh pr view 324`, *Calls to look at*:

> 7. **A review whose read of the 5 ₳ pool fails funds without the reserve** (fx-may's call 1). *Recommended:* keep the reserve there, as Max does, soon after 1.6.0.

- **Call 1** (the policy's date) was decided.
- **Call 2** is item 6, and `post-release-roadmap.md:373` (323-worker#3).
- **Call 3**'s recommendation was "keep", so there's nothing to carry.
- **Call 4** is item 4, and `:378` (bootstrap's call 1).
- **Call 5** is at `:392` ("Session 12's call 5").
- **Call 6** is item 2 (`:36`, "Session 12's call 6").
- **Call 7 is nowhere in *The order* (`:16–44`) or *Kept in mind* (`:331–444`).**
  - No "fx-may", no failed or failing read tied to the reserve, no "as Max".
  - The only "fail" hits are unrelated (`:31`, `:421`).
  - The nearest entry is x-privacy#3's room cache (`:386`). It's a different item: it caches the read, and doesn't decide what a failed read does.

**2. `:392`'s "Call 7's list" is not this call.** The numbering differs:
- That line means **Session 12's call 7**: the leave-or-accept list at `archive/plans/chunk-34-token-pools.md:973`.
- That list holds 323-worker#7 ("a session funded without the reserve pays its collateral's mix from what was coming back"; FINDINGS.md at `7e2d89ed`:2997). That is a different question: whether the return pays the mix when no reserve was paid.
- #324 renumbered the calls. Its call 7 replaced Session 12's 7 and 8.

**3. The plan never got it.**
- `fixes/fx-may.md` (at `7e2d89ed`), item 9: "OWNER-CALLS.md and the chunk 34 plan: add the calls below."
- Its call 1: "To overturn: fund with the reserve on `may`. … It's the more private default by the owner's rule."
- `OWNER-CALLS.md` did get it (`7e2d89ed`:313–315, `### fx-may`).
- The plan's Session 12 *For the owner* (`chunk-34-token-pools.md:966–974`, calls 1–8) did not.
- The plan's only trace is round 4's description at `:947`: "A review whose read of the 5 ₳ pool fails still funds without the reserve…". It describes the behaviour, and records neither the call nor the recommendation.

**4. Where the gap comes from.** It's older than #329.
- *Left by 1.6.0's release review* was written in round 3c (`677715db`), before fx-may existed.
- Round 4 (`22acd30e`) and the gate (`7e2d89ed`, `ef6af2bc`) updated the roadmap and the plan, but never added this call.
- `roadmap.md:59`, the 1.6.0 handoff note's *The owner's calls to look at*, also lacks it. It lists fx-promise's call instead.
- Only #324's body raised it to a gate call.
- #329 carried "the plan's *For the owner* lists and its sessions' notes" (its body), using Session 12's numbering (item 2's "Session 12's call 6"), so the call stayed out.
- `archive/plans/review-1.6.0.md:3` still says the open items are in *Left by 1.6.0's release review*, which isn't true for this one.

**5. Why "tracked nowhere" goes too far.**
- `:372`'s header says "every fixer's calls are in the review's `OWNER-CALLS.md`", and that file at `7e2d89ed` holds this call. `roadmap.md:59` says the same.
- So the text survives in git, behind a general pointer.
- It isn't a live candidate with its recommendation, as calls 2, 4 and 5 are.

**6. The code on HEAD (`sessions.ts:4617–4624`).** A failed look funds without the reserve:

```ts
const pool = await lovejoin.collateralPool(network, read, undefined, true).catch((e: unknown) => {
  if (isTrap(e)) throw e;
  return "failed" as const;
});
if (pool === "failed") return (await lovejoin.collateralPoolTakes(network)) === "no" ? { reserve: 0n } : { reserve: 0n, may: true };
```

- `tailReserve` never looks at the balance.
- The existing test `collateral-reserve-review-fixes.test.ts:1068–1083` pins this on purpose: "the private balance paying all, the reserve too; at Review Koios times out", then `expect(built.collateralReserve).toBeUndefined()`.
- The quote keeps the reserve aside on the same maybe:
  - `sessions.ts:1575–1590`: "Where nothing read lately says, kept aside all the same, the private default, and named a maybe".
  - The quote then carries `collateralReserve` and `collateralMaybe` when `takes !== "no"`.
  - `ui/swap.ts:131–137`: `maxAdaIn` subtracts that `collateralReserve`.
- So "as Max does" holds.

**7. Where the scenario can happen.**
- The `failed` branch needs a 5 ₳ ADA pool that is shown and taking new boxes.
- Without one, `collateralPool` returns `undefined` (`lovejoin.ts:3969–3970`) and `tailReserve` returns `{ reserve: 0n }` with no `may`. `readSet(…, true)` asks nobody and catches everything but a trap (`:2705–2711`).
- `src/lovejoin-pools.json` bundles three preprod pools, among them the 5 ₳ pool, and **no mainnet pool**.
- So the scenario can happen on preprod today. On mainnet it's dormant until a 5 ₳ pool holds its floor.
- Its steps hold where it can happen:
  - steps 1–2 are traced above;
  - step 3 depends on the swap (a sell's fill brings ADA, so its mix still goes: fx-may's own test);
  - step 4 follows Session 11's call, "back with the rest where the tail can't be built".
- The review says "only if enough is left", so nothing is promised falsely. What's lost is privacy: the mix the more private default would have paid for.

## Repro

**The scratch test:** `extension/tests/zz-review-v-pr329-2-trace-1.test.ts`, run alone with `npx vitest run`, then deleted. Result: **4 passed, 3 failed, as predicted.**

| Test | What it shows | Result |
|---|---|---|
| Control | A look that succeeds gives `{ reserve: 1500000n }`, or 2.8 ₳ with `direct` | passed |
| Control | A failed look with a last read of "no" gives `{ reserve: 0n }` | passed |
| Observed on HEAD | A failed look on a last read of "maybe" or "yes" gives `{ reserve: 0n, may: true }`, `direct` included, with `collateralPoolTakes` asked once | passed |
| Sanity | The roadmap's two sections hold calls 2, 4, 5 and 6 | passed |
| **Fails on HEAD if real** | A failed look on a maybe funds the reserve (`expected 0 to be greater than 0`) | failed |
| **Fails on HEAD if real** | *The order* or *Kept in mind* carries call 7 (`expected [] to not deeply equal []`) | failed |
| **Fails on HEAD if real** | Session 12's *For the owner* names fx-may's call | failed |

The test called `tailReserve` on a real `SessionService` with stubbed `lovejoin`, `preferences` and `wasm`. Its four patterns (fx-may, a read that fails with the reserve, a failed read with the reserve, a reserve "as Max") were checked separately: they match #324's own wording of call 7 and two likely rewordings.

## Fix advice

**The finding's fix is right.** Add an entry under *Left by 1.6.0's release review*, or put it on 1.7.0's list if the owner wants it in this release. It should say:
- `tailReserve` returns `{ reserve: 0n, may: true }` on a failed look (`sessions.ts:4624`), even where the private balance pays the reserve;
- the quote's Max keeps it aside on the same maybe;
- the recommendation (#324, fx-may's call 1) is to fund with the reserve on `may`: it comes back with the change if that mix doesn't go, and it's the more private default by the owner's rule;
- it's dormant on mainnet until a 5 ₳ pool holds its floor.

Leave the archived plan and the handoff note alone, since archives aren't maintained. If the entry goes in, `review-1.6.0.md:3`'s claim becomes true again.

**If the owner has it built:**
- Keep `collateralMix` at `ifLeft` on `may` even with the reserve paid. Otherwise `outBuild`'s rule (`reserve && keepsReserve(…) ? "mixed" : "ifLeft"`, `sessions.ts:1916`) would say "mixed" when no read confirmed the pool. The quote's maybe already says "may take".
- `orWithoutReserve` keeps the fallback where the balance can't pay it.
- fx-may's tests (`collateral-reserve-review-fixes.test.ts:1068–1153`, which expect `collateralReserve` undefined) change with that call.
- It's not a new refusal, so the owner's rule 1 isn't touched.
