# v-x-rel-5-impact: the preprod checklist names none of 1.7.0's behaviours

**Verdict: partly. Severity: nit, not the filed low.** Confidence: high.

- **The facts hold.** On HEAD the checklist doesn't mention #335's stepper, #333's priced reserve or #336's Koios confirm. In the range, `development.md` changed only at line 13.
- **The harm doesn't.** No user, site or attacker reaches a checklist. The only question is whether a defect could ship because the owner doesn't look for it:
  - **#335:** the four reviews the e2e doesn't step through use the same component and the same key-generic worker lookup. My scratch test showed every part is found under all three funding keys.
  - **#333:** at today's parameters nothing it changed can be seen. Every figure reads as it did in 1.6.0.
  - **#336:** in item 9's fresh profile, the confirm fires only for a mainnet pool launched after the release's head-start refresh. That clause is x-rel#1's fix anyway.
- **The fix is half right:**
  - The stepper clause on item 6's Max line is fine, as one short clause.
  - "On a funding in parts" asks for a setup no step of the checklist makes.
  - The Bootstrap clause is wrong. The form never says "3 ₳", and the review's figure is 1.5 ₳, the same as in 1.6.0.
  - Item 9's clause belongs to x-rel#1, and F5's line to x-rel#4.

## Duplicates

- **x-rel#5 is x-rel's F6** (`reports/x-rel.md:121`).
- **Its item 9 clause is x-rel#1's** (F2). F2's list of places names `development.md:162` itself, and `v-x-rel-1-impact` confirmed that finding as low. One edit there covers it.
- **Its "F5's line" is x-rel#4's own fix**, judged in that finding's verification. I don't judge it here.
- **Unique to this finding:** the #335 clause and the #333 clause.

## The facts, checked on HEAD (`6bca8bec`)

### The doc
- `git diff babb8e76..6bca8bec -- docs/development.md` is one line, `:13`, from `c5d19d3f` (#331).
- #338 changed only `post-release-roadmap.md` (`git diff --stat 6bca8bec^1 6bca8bec`). That fits the user's note that it was docs-only, for item 8's text. It doesn't bear on this finding.

### #335's stepper
**Five wirings,** each with the right field:
- `Transfer.tsx:236` and `Withdraw.tsx:223`: `parts={summary.parts}`;
- `Swaps.tsx:935`: `out.summary.parts`;
- `DappApprovals.tsx:772`: `review.parts`, where `review` is a `SessionOutSummary`;
- `Lovejoin.tsx:3075`: `review.summary.parts`, on a private review only.

`SessionOutSummary extends WithdrawSummary` (`rpc.ts:1944`), whose `parts?: Array<{ txHash; fee; inputs; waits? }>` (`:831`) is what `TxDetailButton` takes. `tsc` is clean.

**One e2e:** `extension.spec.ts:2662` and `:2668` (`withdraw-tx-part`, "Transaction 1 of 2", then "2 of 2"). No other `-tx-part` test id appears in `e2e/`.

**The worker's lookup doesn't depend on the key:**
- `BUILT_KEYS` (`tx-view.ts:83`) lists `SESSION_TRANSFER` (`:86`), `SESSION_WITHDRAW` (`:87`), `SESSION_OUT` (`:92`), `SESSION_SITE_OUT` (`:93`) and `SESSION_MIX_OUT` (`:98`).
- The new step applies to whichever key it is reading: `const part = partOf(record, wanted)` (`:158`), then `partKey(key, part)` (`:160`).
- A funding is kept by the same `keepParts`: `keepFunding(SESSION_OUT | SESSION_SITE_OUT | SESSION_MIX_OUT, …)` (`sessions.ts:1911`, `:1958`, `:2134`, `:2960-2961`).
- `session-funding-parts.test.ts:56` already pins a funding's parts under `partKey(SESSION_OUT, i)`.

### The checklist
- **Item 6's Max line** (`development.md:147`): "**Max** on Send privately and on Make public from more than 20 UTxOs: the review's *Transactions* says how many it goes as, and Home follows each to the last". It doesn't ask for the details.
- **No step makes a funding in parts.** Nothing in items 1–9 produces a swap, site or Lovejoin funding from more than 20 UTxOs.

### #333's form and review
**The form shows no reserve.** Its cost line is `lovejoin.bootstrap.costPrivateOf`, "{{count}} boxes, {{value}} from your private balance. They stay in the pool until you bring them back." (`en.json:1332`, `Lovejoin.tsx:3389`), where the value is the boxes alone.
- The reserves count only toward the shortfall: `const reserves = DEPOSIT_RESERVE + (back === undefined ? BOOTSTRAP_BACK_LEAST : BigInt(back));` and `const costs = BigInt(putting) * BigInt(pool.box.lovelace) + reserves + FEE_ROOM;` (`:3662-3663`), where `FEE_ROOM = 2_000_000n` (`:211`).
- A short balance shows only "Your private balance holds {{held}} ₳: not enough for that many, with the fees and returning the rest on top." (`en.json:1181`, `:3417`).
- **So "its form asks 3 ₳ beside the boxes" isn't on screen.** The threshold is the boxes plus 5 ₳, and a tester sees it only as a disabled button.

**The review shows the priced figure** as "For returning the rest: {{ada}} ₳, and what it doesn't use comes back" (`Lovejoin.tsx:3798`, `en.json:1159` and `:1021`). That figure is `summary.bootstrapReserve`, which is `back` (`sessions.ts:2096`, `:2142`).

**At today's price it's 1.5 ₳, exactly 1.6.0's fixed figure:**
- core floors the priced reserve at `BOOTSTRAP_BACK_RESERVE` (`seedelf-core/src/lovejoin/mod.rs:1744-1751`, `.max(BOOTSTRAP_BACK_RESERVE)`);
- #333's own table gives 4,310 lovelace a byte → priced 1.1 ₳ → **1.5 ₳, unchanged**, and the PR says "Nothing changes at today's prices";
- the recorded preprod parameters in `tests/` and `e2e/` are `coins_per_utxo_size: "4310"`. The other values there are test scenarios: 4,800, 6,465 and 12,930.

### #336 and item 9
- **Item 9** (`development.md:162`) says `api.koios.rest` is asked "only for a part the data layer couldn't answer".
- **The confirm runs only for a pool the device doesn't hold:**
  - `confirmed()` filters to `fresh` (`lovejoin-pools.ts:568`) before it asks `koiosAlone()` (`:570`);
  - `kept()` merges the bundled head start (`:349`);
  - mainnet's head start holds no pool (`src/lovejoin-pools.json`: height 14110720, 0 pools), and every release rewrites it (`development.md:276`).
- **Item 9's line was loose before 1.7.0 too.** `lovejoin.ts:5702` reads the wallet's own boxes from Koios alone, while ours answers, wherever the listing doesn't cover them.

## Can it happen with the shipped build?

**Not as harm to a user.** The checklist is a release procedure, so the question is whether one of the gaps lets a defect through.

1. **#335: no.** My scratch test (below) built a real three-part transfer with the real WebAssembly and moved its kept records under each funding key: `txView` returned every part under all three. That covers:
   - the worker path that the e2e only exercises for Make public;
   - the funding's keys, which `session-funding-parts.test.ts:56` already pins.

   What's left is one type-checked prop per screen, which I read on HEAD. A check by hand on Send privately would repeat what's already tested. It's a cheap repeat, since the Max line already puts the tester on a review in parts.
2. **#333: no, and the line can't tell.** At today's parameters every figure the tester could compare is what 1.6.0 showed. The line asks the tester to find a "3 ₳" that isn't on the form. Line 144 already runs a private Bootstrap end to end, through #333's new code: `privateBootstrapBounds` and `mixFunding`'s priced `back`. A crude break, such as WebAssembly refusing the new argument, would fail its review build there. The dearer byte is covered by #333's three unit tests, each shown failing without its part.
3. **#336: rarely, and harmlessly.** The misfire needs a mainnet token pool launched between the release branch's `npm run lovejoin-pools` and item 9's check on the merge commit. That window is hours to days. Starting a pool is open to anyone, so this can happen.
   - **If it happens,** the owner sees a correct `tx_info` and looks into it for a few minutes.
   - **"Misses it"** is no harm: item 9 can't make the confirm fire on mainnet (F7, x-rel#6), and nothing wrong would be missed.

## Severity: nit

- The brief's *low* is "a misleading doc, a missing test on a minor path".
- The doc's only inaccuracy, item 9, is x-rel#1's.
- What's left is one manual step that repeats paths the automated layers test at the worker, the screen and the e2e (Make public).
- I could find no case where its absence lets a defect ship. Without a scenario that causes harm, it's a nit.

## The fix, corrected

1. **Item 6's Max line (`:147`):** add one clause and keep the rest: "…, and Home follows each to the last; its **Transaction details** steps through each (*Transaction 1 of N*)".
   - Keep it to the line's own two reviews.
   - Leave out "on a funding in parts". No step makes one, contriving one costs a tester real preprod setup, and the worker path is now shown to be key-generic.
   - If the lead wants a funding pinned, a unit test is the better tool. In `session-funding-parts.test.ts`, after `:56`, add `for (const p of out.parts!) expect((await txView(view, "preprod", p.txHash)).detail.txHash).toBe(p.txHash)`. This is my idea, optional.
2. **The Bootstrap clause: drop it.**
   - If the lead wants a line anyway, the accurate one is "from the private balance, its review's *For returning the rest* says 1.5 ₳ at today's parameters".
   - Even that only confirms a figure that didn't change.
   - Don't write "3 ₳ beside the boxes" or "the form asks": the form says neither.
3. **Item 9:** fix it in x-rel#1's edit pass, once. Wording for it: "…, and `api.koios.rest` only for a part the data layer couldn't answer, or to confirm a Lovejoin pool it lists that this profile hasn't seen".
4. **F5's line:** that's x-rel#4's.

**Within the owner's rules:**
- Docs only.
- No guard, refusal, UI text or translation.
- No critical key, and no privacy note moved or dropped.
- No release date or store status (rule 7).

**What else it would change:** nothing.
- No test reads `development.md`. `words.test.ts` scans `src/` only, and `live-runs-copy.test.ts` names the file only in a comment.
- The clauses fit the checklist's own style: one line per flow, words the screens use.

## Scratch test (deleted)

`extension/tests/zz-review-v-x-rel-5-impact-1.test.ts`, run alone (`npx vitest run …`):

**What it did:**
- built a transfer in parts with the real WebAssembly (20 token bundles, as `parts-send-review-fixes.test.ts`'s wallet A);
- read its kept records under `partKey(SESSION_TRANSFER, i)` and checked that the first names every part (`partHashes`);
- removed them, so a later part was "not held";
- for each of `SESSION_OUT`, `SESSION_SITE_OUT` and `SESSION_MIX_OUT`: wrote the records under `partKey(key, i)`, asked `txView` for every part, then removed them and checked a part was no longer held.

**The result:** passed, 1 of 1.
- The log read `parts=3; every part found under seedelf.session.out, seedelf.session.site-out, seedelf.session.mix-out`.
- The file is deleted, and `git status` shows none of my files.

## Not checked

- I made no Koios or data-layer reads. Whether the live API lists a mainnet token pool today is unknown, so I can't say whether item 9's misfire could already happen.
- I didn't run the e2e, open the built extension, or run the checklist.
- I didn't measure preprod's live parameters. "1.5 ₳ today" rests on the recorded 4,310, #333's table and x-rel's own "still 3 ₳ at today's parameters".
