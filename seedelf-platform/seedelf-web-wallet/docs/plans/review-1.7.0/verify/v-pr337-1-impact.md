# Verify `pr337#1` (label `v-pr337-1-impact`)

**Verdict: confirmed. Severity: low**, as filed, at the low end of low. Confidence: high.

Everything was read and run on HEAD `6bca8bec`.

- **The facts hold exactly.**
  - For a site's session, the press only ends the wait.
  - The Lovejoin page then says the rest came back, while the rest sits at the session's account.
  - flows.md leaves out the step by hand.
- **The impact is narrow.**
  - Money is never at risk.
  - The site's own page tells the truth.
  - Mainnet can't reach it today.
- **The fix is right in direction, with three corrections:**
  - the new words;
  - the page wiring;
  - flows.md's quoted reason.

## What happens

**The code.** `skipCollateralMix` (`sessions.ts:5526-5538`) does three things:
1. It marks the tail over.
2. It pumps a pending chain.
3. It ends with `return this.advance(network, index, true);`.

`step` (`:3446`) then reads `if (!s || !running(s)) return;`, and `running` (`:1230`) needs `!!s.auto`. A site's session never has `auto`: its record (`:1984-1991`) carries `site: { origin }` and nothing else of the kind.

**Scratch R1.** A site's session, set up with the planner test's own `setUp`. Its chain is pending at the collateral's mix, giveme.my answers busy, and `landed` is moved back by `TAIL_OFFER_MS`.
- **Before the press,** the view has `collateralHeld` and the chain `{total:5, sent:3, confirmed:3, cut:false}`.
- **The press:**
  - submitted transactions: 3 before, 3 after;
  - stage `open`;
  - `collateralHeld` gone;
  - `chain.stopped` = "You brought the rest back without waiting for the collateral's mix, so the chain stopped there.", with `cut: false`.
- **The Lovejoin page's chains** (`lj.status().chains`) carry the same reason.
- **Then `backBuild(…, 0)` without `direct`.** This is the page's `buildBack(true)`.
  - It builds a plain return of 4.66 ₳.
  - `lovejoin`, `collateralTail`, `lovejoinSkipped` and `chain` are all undefined.
  - giveme.my is not asked again.
- **Once that return is sent:**
  - `chain.cut` is true, so the page says "what was left came back directly".
  - The Chains row keeps the reason, which is true from then on.

**Scratch S1** renders the pages with SSR.
- **The site's page before the press:** "Sending 3 of 5 transactions", then the way-out callout, **Bring the rest back now**, and "Its return is on its way."
- **The site's page after the press:** "Stopped after 3 of 5 transactions; the rest stays at the account until you bring it back". The button is gone, and *Bring it back* is in the foot. **The site's page is truthful.**
- **The Lovejoin page's Chains:** "Why it stopped: You brought the rest back without waiting for the collateral's mix, so the chain stopped there. Mix my boxes again mixes the boxes it didn't."
- **Your mixes:** once the chain leaves Chains, the card shows the same reason (`Lovejoin.tsx:2535`).

**Scratch R2.** The same chain, cut by a lock: the session's progress is removed, and `runAll` marks the chain cut. The hold comes from `tailBuildable`, past the hour.
- **The press:**
  - Nothing is submitted.
  - The reason stays the cut's: "The wallet locked, or the browser closed, while its chain was being sent."
  - **No false text appears anywhere.**
- **The press changes only what the next *Bring it back* builds:**
  - after the press, a plain return;
  - before the press, the mix built again, `[mix, back]` (`lovejoin-planner.test.ts:1401`).
- **The site's page** reads "the rest stays at the account until you bring it back" both before and after. The press only removes the callout.

## Impact

**Can a real user reach it? Yes, but narrowly.**

- **A 5 ₳ pool has to take the collateral.**
  - Mainnet: dormant.
    - The floor is 30 of other people's boxes (`networks.ts:71`).
    - Chunk 34's plan says "dormant on mainnet until one holds its floor" (`:969`) and "on mainnet there's none yet" (`:1055`).
    - So the store build's default network can't reach this until someone's 5 ₳ pool holds its floor.
  - Preprod, in Settings: the floor is 0, and a 5 ₳ pool exists.
- **Which sessions:**
  - **A site's session (private CIP-30).** Its return goes through Lovejoin (`lovejoinReturns`, on by default), with its collateral (`lovejoinCollateral`, on by default).
  - **A swap brought back by hand.** In a store build this is only a session the restore scan found, which this device then sent back through Lovejoin. Every swap a store build made runs itself: `auto` came in `e7d411ee` (2026-09-24), before 1.0.0's bump `14b0b3fe` (2026-09-26).
- **The false reason (R1) needs the chain still pending an hour after the collateral's deposit landed.** Two things must hold:
  - giveme.my was busy or out of reach for that hour, or Koios was behind;
  - the wallet stayed unlocked the whole time. Auto-lock is at most 60 minutes without activity (`LOCK_AFTER_MINUTES`), and a lock cuts the chain, which is R2's state instead.

  This is rare.
- **The other half, a press that brings nothing back (R2), is more likely.** A lock or a closed browser cuts the chain in the minutes before giveme.my signs. The user comes back between an hour and a day later. This is harmless, because the page already says what comes next.

**What harm does it do? None to money or privacy.**

- **The money stays where the user can see it.**
  - The rest stays at the session's account, which the site's page shows.
  - Disconnect waits until it's brought back (`sites.why.disconnectHolds`).
- **The false statement appears only on the Lovejoin page:** first in Chains, then in Your mixes. Someone who reads only that page may think the rest is in their private balance.
- **The cost to the user** is one more press and a review. Otherwise, the rest waits at the account until they notice.

**Severity: low** ("an edge case … a small UX defect", and a doc that leaves out a step).
- **Not medium:**
  - no money is at risk;
  - there's no stuck state;
  - the page where the press happens says the right thing;
  - the false text needs a rare state.
- **Not nit:** the false line says where the money is.

## The fix

### 1. The words: the part that must change

Reword `lj.tail.skipped`, but not to "The rest comes back without the collateral's mix…". That wording has two problems:
- For a session brought back by hand, the rest still doesn't come back by itself.
- A saved reason in the present tense reads oddly under "Why it stopped:" days later.

Use words that are true for every session and every outcome: **"You chose not to wait for the collateral's mix, so the chain stopped there."** x-ui F2 and x-scen 2 propose the same.

What the change involves:
- **It's a machine draft.** Provenance is "machine" in both es and ja, and the key isn't in `critical-keys.json`. Update the es and ja drafts; no back-translation is needed.
- **Tests:** the only reader is `lovejoin-planner.test.ts:1818`, which goes through `tr()`, so it stays green.
- **Saved records:** reasons are saved as text, so stopped chains already recorded keep the old words. 1.7.0 hasn't shipped, so only dev and preprod test records have them.

### 2. The page: better UX and small, but the owner's call

On the by-hand pages only, open the return's review after the press. Those are SiteSessions' `onSkip`, and Swaps' branch without `auto` (`:2567`). The `auto` branch (`:2513`) keeps `setS`, since its return goes out in the same request.

How to wire it:
- **Do it inside the same `act` task.** Await the skip, call `onRefresh()`, then build: `setRebuilding`, `session-back-build`, `setBack`, `setBackThrough(true)`, `setBackPools({})`.
  - Don't call `buildBack(true)` from inside `act`. That nests a second `act`, whose `busy` is the render's stale `false`. The outer `finally` then clears `busy` while the build is still in flight.
- **Open the review only when the press's answer shows the rest still at the account:** `view.chain?.stopped && !view.chain.cut && view.stage !== "closed"`.
  - Otherwise a press that loses the race with giveme.my's signature (the alarm's pump sends the mix and the return: pr337#4) opens on "The session's account is empty…", just after the rest came back through the chain.

What the change keeps:
- Nothing new is sent without Send.
- The switch stays hidden on a plain return (`LovejoinSwitch`: `!back.lovejoin && through` → null).
- Every privacy note on the review stays.
- It adds no text and no guard.
- The paths for sessions that run themselves don't change.

Two caveats:
- **An edge case.** "Builds a plain return" holds unless a top-up has since put a fresh 5 ₳ at the account. Then Settings' collateral mix builds a new tail, as *Bring it back* does today. This doesn't block the fix.
- **Without the page change,** the new words and flows.md still make every line true. The label then promises a little more than the press does on a by-hand page, and the page's own row says the next step.

### 3. flows.md:522

- **Add the step by hand:** "by itself for a swap or a mix; for a site's session, or one brought back by hand, through its return's review" (or "at *Bring it back*" without the page change).
- **Update its quote** of the reason once the key is reworded.
- **privacy.md:217:** pr337#4's addition shouldn't say the press brings the rest back.

### Tests

- **Worker:** a site's session held past the hour. After `skipCollateralMix`, `chain.stopped` is `tr("lj.tail.skipped")`, and its English doesn't match `/brought the rest back/`. This fails on HEAD.
- **Page:** the house's wiring seam (`screens-wiring-review-fixes.test.ts`) can't follow a press past an await.
  - Extract the rule, `openBackAfterSkip(view)` say, and test it.
  - Also test that the press asks `session-skip-collateral-mix` first.

## Repro (scratch files, deleted)

- **`extension/tests/zz-review-v-pr337-1-impact-1.test.ts`** drives the worker, with the planner test's own helpers (a site's session, a 5 ₳ pool, the real WebAssembly). It holds R1 and R2: 2 passed.
- **`extension/tests/zz-review-v-pr337-1-impact-2.test.ts`** renders `SiteSession` and Lovejoin's `Chains` with SSR. It holds S1: 1 passed.
