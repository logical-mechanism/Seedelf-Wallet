# v-x-priv-3-impact: #337's way-out line blames giveme.my where the 5 ₳ pool is the wait

Finding `x-priv#3` (low, ux; the report's own #4). I judged impact and the fix, on HEAD `6bca8bec`.

## Verdict

- **Confirmed. Severity: low, as reported.** It is dormant on mainnet today and reachable on preprod.
- **The fix:** the finding's first option is right and minimal: drop the cause, as in "The collateral's mix hasn't gone yet." I checked it in a copy.
- **Not recommended for 1.7.0:** the second option, carrying the cause on `collateralHeld`.

## The claim, reproduced on HEAD

**The scratch test:** `zz-review-v-x-priv-3-impact-1.test.ts`, now deleted. It drove the real worker and WebAssembly:
- a mix session that runs itself;
- preprod's bundled 5 ₳ pool (`18c4df77…`) with two of other people's boxes;
- one wave deep, so the chain is `deposit, mix, deposit*, mix*!, back`.

**Case A:** giveme.my refuses past its wait, so the chain stops at the collateral's mix. Someone else's mix then takes both other boxes, and the runner's next step builds that mix again.

**Case B, the finding's own scenario:**
1. giveme.my is busy, so the mix waits for it (`tailWaits`), with `landed` set.
2. A lock wipes the chain's progress, standing in as `cutAfterDeposit` does.
3. At the next step, the pool is short.

**Result, in both cases, an hour after the deposit landed:**
- **The view:** `auto.retry.error` is `lj.tail.fewBoxes` (reason `other`), and `collateralHeld.offerAt` is now or earlier. Case B's view has `chain.cut: false`.
- **The swap page:** its retry line shows the pool's reason (`retryReason` returns that error).
- **The mix card's detail (B):** "Why it stopped: The wallet locked, or the browser closed, while its chain was being sent. It tries again at 00:00:30. What went wrong: Lovejoin's pool of 5 ₳ boxes hasn't enough of other people's boxes free for its collateral's mix yet. The rest waits for that mix, a day at most."
- **The callout below it:** "The collateral's mix is still waiting for giveme.my. Bring the rest back without it, and its 5 ₳ box stays in the pool unmixed, tied to this session, until you mix it again."
- **giveme.my was asked 0 times in that state.** Nothing waits for it.

**The privacy half is right.** `privacy-policy.md` says "If the mix can't go, the box waits there, and can be tied to the session until it's mixed, as any box at its deposit can."

**Evidence on HEAD:**
- `en.json:922` (the line), and `:915`/`:916` (fewBoxes, noPool);
- `lovejoin.ts:4131` `if (!tailWaits(c) && !tailBuildable(c, this.deps.now())) return undefined;`;
- `lovejoin.ts:4041` `if (!pool?.ref) return "noPool";`;
- `lovejoin.ts:4082` `… return "fewBoxes";`;
- `sessions.ts:4390` `throw new Error(tailWaiting(resumed))`;
- `sessions.ts:5617` (the view);
- `Swaps.tsx:3205` (the retry line), and `:2513`/`:2567`;
- `Lovejoin.tsx:911` (the detail) and `:2588`;
- `LovejoinReturn.tsx:551`.

**A wider state has the same false sentence.** In a by-hand session (a site's, or a swap brought back by hand) whose chain a lock cut, nothing waits for giveme.my until the user presses *Bring it back*. The view still holds `collateralHeld` (v-pr337-0-impact's ZZ4), so the callout says giveme.my there too. The same fix covers it.

## Reachable with the store build?

- **Mainnet (the default): dormant today.**
  - A collateral's tail exists only where a shown 5 ₳ ADA pool holds 30 boxes that aren't the wallet's (`collateralPool`, `lovejoin.ts:3966`). The head start lists no mainnet pool (`lovejoin-pools.json`: `pools: []`), and #337 itself says "On mainnet it stays dormant until a 5 ₳ ADA pool holds its floor of boxes."
  - Pools are found as they're read, so this goes live with no update once such a pool exists. Even then, the finding's exact states are unlikely on mainnet:
    - **fewBoxes** needs fewer than 2 free other boxes at the rebuild (`tailChain` checks no floor; WebAssembly needs `TAIL_DRAWS` = 2), in a pool that had at least 30 when the chain was built.
    - **noPool** needs discovery to fail with nothing handed over (after a worker restart).
  - The by-hand lock-cut variant above is the likelier one there.
- **Preprod (Settings): reachable today.** The 5 ₳ pool is bundled and the floor is 0, so a thin pool makes fewBoxes after a refusal, a lock or a drawn box gone plausible. I didn't read preprod's pool from Koios (brief's limit); the severity doesn't hinge on it.
- **Before the hour:**
  - The `unlisted` wait can't overlap the offer, since `LANDING_MS` is 15 min and the offer comes at `landed + 1 h`.
  - A hold whose rebuild succeeds sends a new chain whose mix does wait for giveme.my, so the line is true again.

## Harm, by the brief's scale

- **What's wrong:** the cause the callout states contradicts the retry line on the same page.
- **What's right:**
  - The privacy clause (unmixed, tied to this session).
  - The button's effect.
  - The choice it frames: wait up to a day, or leave the box unmixed. That choice doesn't depend on the cause.
- **Nothing else is at stake:** no money is involved, no data is sent, and no state gets stuck.
- **Rating:** a small UX defect in an edge state → **low**.
  - Not medium: the misstatement is operational, not a misleading money or privacy statement.
  - Not a nit either: it's a false statement in a critical callout with a concrete, reproduced scenario, not a matter of style.

## The fix

**Recommended: drop the cause.**
- en: "The collateral's mix hasn't gone yet. Bring the rest back without it, and its 5 ₳ box stays in the pool unmixed, tied to this session, until you mix it again."
- **Why this wording:**
  - It's true in every held state: `tailWaits`; `tailBuildable` with any `TailWait`; a by-hand cut chain not yet tried again; even pr337#0's stale hold, as far as the first sentence goes.
  - It's shorter (rule 4), and matches the house verb ("If that mix can't go").
  - The privacy clause stays word for word (rule 3). It adds no guard and changes no default (rules 1 and 2).
- **Drafts for the blind round:**
  - es: "La mezcla del colateral aún no se ha hecho. Si traes el resto de vuelta sin ella, …" (rest unchanged)
  - ja: "コラテラルのミックスはまだ行われていません。それを待たずに残りを取り戻すと、…" (rest unchanged)
  - Rule 6 needs a fresh blind back-translation of both, noted in `verified-critical-{es,ja}.json`'s reviewer text.
  - The key's name doesn't change, so `critical-keys.json` and the verified key lists stay as they are. Provenance stays `machine`.

**Checked in a copy** (`scratchpad/review/v-x-priv-3-impact/`, since deleted):
- **The three locales changed:** the inverted scratch test passes; the callout reads "The collateral's mix hasn't gone yet. …" and names no giveme.my.
- **The files the change touches pass, 157 tests:** `collateral-held`, `i18n`, `i18n-critical-helpers`, `i18n-worker-reasons`, `words`, `worker-words`, `i18n-values-in-place`, `i18n-joins` and `i18n-review-fixes`.
- **The checks it meets:** the negation check passes (es "sin", ja "ずに" are kept). No test pins the old English.

**What else it changes:**
- **The common hold loses the only on-page mention that giveme.my is the hold-up.** In `tailWaits`, the swap page says "Coming back through Lovejoin: sending 3 of 5 transactions." 1.6.0 named no cause at all.
- **No privacy note is dropped.** giveme.my's role, and that it sees the mix, stay on the reviews (`swaps.review.privacy.collateralMix`, `lovejoin.collateralBox.privacy.note_*`, `lovejoin.collateralMix.privacy.ifLeft`).
- **Docs:** `flows.md:522` already paraphrases the line without a cause ("while the mix still waits (for giveme.my, or to be built again)"), so it stays right. `rpc.ts:1866`'s comment ("which waits for giveme.my") could say "or to be built again" (a nit).
- **pr337#0's view-level fix (`cut`) is independent.** This state has `cut: false`, and its hold is real (the mix still goes if boxes come), so both should land.

**Not recommended for 1.7.0: carry why it's held** (`collateralHeld.giveme = tailWaits(c)`, and two sentences).
- It needs a new critical key with its own back-translations, plus changes to the RPC type, the worker, the component and the tests.
- It still can't name the pool for a by-hand session without recording the last `TailWait`.
- That is more than a low finding needs.

## Tests to add

1. **`collateral-held.test.ts`:** `expect(shown).not.toContain("giveme.my")`, with a comment that the hold may be on the pool or on *Bring it back*. It fails on HEAD.
2. **A worker test of the held fewBoxes state.** Extend lovejoin-planner's "says the 5 ₳ pool hasn't enough…" (`:1664`):
   - after the `lj.tail.fewBoxes` rejection, move `tail.landed` back by `TAIL_OFFER_MS`;
   - expect `collateralHeld` defined in `sessions.list`.
   - **Mutation check (in the copy):** with `tailBuildable` removed from `tailHeld`'s line (`lovejoin.ts:4131`), both of my scratch cases fail (`collateralHeld` undefined). So this also closes pr337's finding 3 (M2 went unseen).

## Clean-up

- **Deleted:** the scratch test from the tree, and the copy (which also held the dev test wallet file).
- **Untouched:** no tracked file.
- **Network:** nothing was sent; no Koios read was made.
