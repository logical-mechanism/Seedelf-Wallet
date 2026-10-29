# v-pr329-2-impact: pr329#2, #324's call 7 (fx-may's call 1) has no entry in the live roadmap

**Verdict: confirmed. Severity: low**, as filed. I'm highly confident of the facts, all read at HEAD (`6bca8bec`). The severity is a judgement.

This is a docs gap. Nothing in the shipped build changes, and it doesn't block 1.7.0. The behaviour it would track happens on preprod in the store build and is dormant on mainnet. The proposed fix is right. Two of the finding's sentences overstate the gap, and the fix needs a few refinements (*The fix*, below).

## The facts hold

- **#324's body, *Calls to look at*, 7:** "A review whose read of the 5 ₳ pool fails funds without the reserve (fx-may's call 1). *Recommended:* keep the reserve there, as Max does, soon after 1.6.0."
- **Where the other six went:**
  - Call 1 was decided.
  - Call 2 became item 6, call 4 became item 4, and call 6 became item 2.
  - Call 3's recommendation was "keep".
  - Call 5 sits under *Left by chunk 34's sessions* (post-release-roadmap.md:392).
- **Call 7 is in neither list:**
  - `grep -c fx-may post-release-roadmap.md` gives 0.
  - I also searched for it in other words ("read fails", "failed read", "keep the reserve", "on a maybe", "look fails") and found nothing.
  - The nearest entry, x-privacy#3's room cache (:386), is a different call.
- **The plan never got it:**
  - `git show 7e2d89ed:…/fixes/fx-may.md`, item 9, reads "OWNER-CALLS.md and the chunk 34 plan: add the calls below."
  - OWNER-CALLS.md got them (`### fx-may`, at :313–317 in that commit).
  - Session 12's *For the owner* (chunk-34-token-pools.md:966–974) did not. Its Round 4 paragraph (:947) describes the fix, not the call.
- **HEAD still does it:** sessions.ts:4624 reads `if (pool === "failed") return (await lovejoin.collateralPoolTakes(network)) === "no" ? { reserve: 0n } : { reserve: 0n, may: true };`.
- **The quote does the opposite on the same maybe.** sessions.ts:1575–1578: "Where nothing read lately says, kept aside all the same, the private default, and named a maybe." So the form's Max leaves room for a reserve that the review then doesn't pay.

## Two overstatements

1. **"Tracked nowhere" is too strong.**
   - OWNER-CALLS.md at `7e2d89ed` holds the call and its "To overturn: fund with the reserve on a maybe … it's the more private default by the owner's rule."
   - The header of *Left by 1.6.0's release review* (:372) names that file: "every fixer's calls are in the review's `OWNER-CALLS.md`".
   - What's missing is #324's recommendation and its timing ("soon after 1.6.0"). So is a place among the candidates that 1.7.0 was picked from.
2. **The omission is #324's own, and #329 inherited it.**
   - At `babb8e76`, 1.6.0's own *Left by 1.6.0's release review* (line 351 there) already lacked it.
   - So does roadmap.md:59, 1.6.0's handoff list of "The owner's calls to look at". That list says "Session 12 has each in full", but Session 12 doesn't have this one.
   - #329's header, "what 1.6.0 left", still made catching it #329's job. So the finding's point stands.

## Can it happen in practice?

**On preprod in the store build: yes.**
- **The setup:**
  - Preprod's 5 ₳ pool is in the bundled head start (`src/lovejoin-pools.json`: `18c4df77…`, `boxLovelace: "5000000"`).
  - Its floor is 0 (networks.ts:56), and preprod reads Koios alone.
- **The path:** a 504 or a timeout on that pool's `credential_utxos` read at Review makes `collateralPool(…, tell)` (lovejoin.ts:3966) throw.
  - `tailReserve` then asks `collateralPoolTakes`, which answers "maybe" or "yes" (lovejoin.ts:3987–3998).
  - The funding goes without the reserve, with `may`.
- **Repro:** `npx vitest run tests/collateral-reserve-review-fixes.test.ts -t "review whose read of the 5 ₳ pool fails"` passes 2 tests, with 30 skipped. These are fx-may's own tests, at :1068 and :1116, run alone on HEAD.
  - The quote has `collateralReserve` and `collateralMaybe: true`.
  - The swap's review (both ways), the mix's, the site's funding and the top-up then each have `collateralReserve` undefined and `collateralMix: "ifLeft"`.

**On mainnet: dormant.**
- The head start lists no mainnet pools (`"mainnet": { "height": 14110720, "pools": [] }`).
- With no 5 ₳ pool, `collateralPool` returns undefined before any read that could fail, so `tailReserve` returns `{ reserve: 0n }` with no `may`.
- Once someone launches one, `collateralPoolTakes` says "no" until the data layer counts 30 boxes there (`poolFloor: 30`, networks.ts:71).
- I didn't check today's chain. The verdict doesn't depend on it, so I made no Koios request.

**The harm is small and disclosed.**
- **No money is at risk.** The 5 ₳ comes back with the rest.
- **The loss is the mix itself:** that 5 ₳ would have come back as one of three boxes, and instead it stays under the session's history.
- **The review says so:** "Its 5 ₳ collateral is mixed only if enough is left".
- **The design docs match the code:** flows.md:469, :490, :494 and :514, privacy.md:121 and :217, and architecture.md:633.
- **The return may still mix it.** fx-may's swap test mixes it from the order's change and the fill's 6 ₳. The reserve matters most for a mix's chain, which spends its funding on boxes.

## Severity: low

It's a misleading doc, by the brief's scale.
- The 1.7.0 list is billed as "what 1.6.0 left". *Kept in mind* is billed as "what the review and the sessions left".
- Of #324's seven calls, this is the only one with a "soon after" recommendation that has no entry. Call 2 had the same wording and became item 6.

**Not higher:**
- Nothing users see changes.
- The behaviour is disclosed in the screens and the docs.
- It's dormant on mainnet.
- It doesn't block the release.

**Not a nit:** it's a privacy-default call the gate asked the owner to make. fx-may calls the alternative "the more private default by the owner's rule". The owner can't pick it from the roadmap.

**The code behaviour itself, if anyone files it,** is an owner-call: a deliberate rule (L3, "a look that fails funds without the reserve") that leans against rule 2.

## The fix

The fix is right, minimal and within the owner's rules:
- It's docs only.
- It adds no guard, request or text to the wallet.
- It drops no privacy note.

No test reads post-release-roadmap.md: `words.test.ts` scans `src/` alone, and `activity.test.ts` names the roadmap only in comments.

1. **Where:** one bullet under *Left by 1.6.0's release review*, beside x-privacy#3's (:386), its nearest sibling. A suggested text:

   > - **A review whose read of the 5 ₳ pool fails funds without the reserve** (fx-may's call 1; #324's call 7), even where the private balance would pay it, though the quote's Max kept it aside on the same maybe. Its line says the collateral is mixed only if enough is left. *Recommended:* keep the reserve there, as Max does: the more private default. Dormant on mainnet until a 5 ₳ pool holds the floor.

2. **Put it in 1.7.0 only on the owner's word.** If it goes in:
   - Append it as item 9, and never insert or renumber. Merged work cites items by number: #330 is "List item 3", and `62be5bc4` is "1.7.0's item 8".
   - Mark the bullet **(1.7.0)**.
   - The version is cut once the list is in, so it would hold the cut until it's built.

   The bullet itself can go in the release-prep docs commit, with the list's ticks, so no item PR has to touch the list.
3. **Optional:** name it in roadmap.md:59's list too, so that list matches #324's body. Leave the archived plan as a record.
4. **For whoever builds it, if the owner takes the recommendation:**
   - **The change:** `tailReserve`'s failed branch returns the reserve with `may`. A site's funding and a top-up pay the direct reserve (2.8 ₳ today).
   - **The words must stay hedged.** Returning a reserve on `may` alone would make two screens promise a mix on a pool nobody read:
     - `outBuild` says "mixed" wherever a reserve is paid and `keepsReserve` holds (sessions.ts:1916), so the swap's approval would promise it.
     - `mixFunding` says "mixed" wherever a reserve is paid (:2143), so the mix's review would too.

     Follow the quote's rule (:1584): "mixed" only on a "yes".
   - **No new refusal:** `orWithoutReserve` still funds without the reserve where the balance can't pay it.
   - **No new request:** `collateralPoolTakes` asks nobody, so the privacy policy needs no entry. No new key either: the cost row and the `ifLeft` line exist.
   - **Tests and docs move with it:**
     - flip fx-may's tests at :1068 and :1116;
     - update flows.md:469, :490, :494 and :514, privacy.md:121 and :217, and architecture.md:633, which all say the funding goes without the reserve.

**Scratch:** no file in the tree. I ran only the existing test above, alone, and the one scratchpad note is deleted.
