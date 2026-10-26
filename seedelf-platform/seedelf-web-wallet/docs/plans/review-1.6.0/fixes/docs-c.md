# docs-c: the docs brought in line after fx-last and fx-promise

The docs checked against the tree as it stands: `677715db` (round 3c, fx-last, committed) plus fx-promise's uncommitted code (`sessions.ts`, `rpc.ts`, `LovejoinReturn.tsx`, `Swaps.tsx`, `DappApprovals.tsx`, `SiteSessions.tsx`, `Lovejoin.tsx`, the locales). Every claim was read in the code before it was written. Docs only: no code, no test, no build, no cargo, no formatter.

What I took:
- the 14 findings of `review/docs-check.md`;
- fx-last's and fx-promise's *Docs to update*;
- what docs-a left: the fixers' report corrections, OWNER-CALLS.md's corrections and HANDOFF.md's;
- docs-b's to-do for after fx-last committed.

## The privacy policy (served live)

All in the unshipped 1.6.0 material. The **Effective** date and the header's list are untouched (the owner's open call).

- **The collateral's mix, said only where it holds** (docs-check 3):
  - the Lovejoin row and the 18 October entry say a session's 5 ₳ goes into a pool of 5 ₳ boxes "where one holds enough other people's boxes and enough of the session's ADA is left, not held with tokens, to pay for the mix";
  - "A session funded while such a pool is shown" now reads "while such a pool would take its collateral".
  - The code needs that: the pool's floor and two free boxes (`collateralPool`, `TAIL_DRAWS`); the chain's change or a UTxO of ADA alone to pay for it (`with_return`, `direct_tail`); none where the ADA sits beside a token (`tailUnpaid`, a token order's cancel).
  - The Cardano server's line "measures the one mix of the session's 5 ₳ collateral" gains "where there is one".
- **The public payer with several accounts** (docs-check 4). The escape hatch's public payer ties the box to the account, "and, for a box another of your public accounts put in, the two accounts to each other", in the Lovejoin paragraph and the 18 October entry. That's `hatchOrder` (lovejoin.ts:2017) and `lovejoin.stuck.privacy.publicNamed`.
- **The restore scan's new ask** (docs-check 12, the owner's rule of a dated entry for every data-handling change):
  - **The 18 October entry**, one sentence: "The look for your private sessions' money also asks the Cardano server about the first Seedelf UTxO each later payment into their accounts spent, strangers' too, which it has just listed; which are yours is worked out on your device."
  - **The body's own bullet** on that look names it too, so the page says what the look asks, as the 12 October entry wanted.
  - **The code:** `sessions.ts` 2747–2788. `unsigned.slice(0, -1)` leaves the funding out, the input is filtered to the Seedelf contract, it goes in the same `utxo_info` as the orders' outputs, and the register check is on the device.
- **`bringStopped`** (docs-check 13). Named in the Lovejoin row's on-device list and in the entry's *On your device*: "once you stop Bring every box back now, how many boxes it sent and from which pool, until you next use it". That's lovejoin.ts:909: set only by the user's Stop (6402), cleared only by the next run's ask (6385).
- **fx-promise and fx-last need no line.** Nothing new leaves the device. fx-last's one new read (`epoch_params` in Stop's no-box dialog) is gone again with `tailPaid`.

## Findings

| id | status | change |
|---|---|---|
| docs-check 1 | fixed (doc narrowed) | architecture.md's "No catch swallows a trap" is now "The runs and the services hand a trap on". It names the three page-started calls that still end in `.catch(() => undefined)` (`handlers.ts` 153, 226, 570: a restore's scan, the pump Home's `pending-tx` poll starts, Bring every box back now's first run). A trap inside the queue there still locks (`serial`); one outside leaves the wallet unlocked until a call traps again under `answerUi` or `runs.ts`. The code gap is recorded in post-release-roadmap's *Left by 1.6.0's release review* (see the calls). |
| docs-check 2 | fixed | #323 merged 26 s after its check started, 12 min before it failed at *Extension unit tests*. Checked with `gh pr view 323` (merged 16:02:25Z) and `gh run view 40109672647` (created 16:01:59Z, failed 16:14:34Z, later steps skipped). Corrected in development.md:15, roadmap.md's surprise bullet, the plan's highs item 1 and *For the owner* item 6, and HANDOFF.md:7 (the source). development.md now says nothing **of the wallet's** runs on `main`: `continuous-integration.yml` runs there, Aiken only. |
| docs-check 3 | fixed | The policy, above. Also flows.md's *Back* step and the web wallet README, which promised the mix wherever a pool is shown. |
| docs-check 4 | fixed | The policy, above. |
| docs-check 5 | fixed (to fx-promise's state) | architecture.md's collateral bullet. **The summaries' `collateralPool` gives way to the one rule:** `CollateralMix` on `SessionOutSummary`, `SwapQuote` and `SwapLovejoin`, with `keepsReserve`, a site's never `mixed`, the screens' definite words and `CollateralMixLine`. **The quote's `collateralMix`** sits beside `collateralMaybe`, which no screen reads now (grep: only sessions.ts and rpc.ts). **`stopCost`:** `mayMix`, the reserve set aside, the count on what the return will hold (an ADA order's cancel less `CANCEL_FEE_ESTIMATE`; a token order's, nothing), `keeps`, and no parameters read. `tailPaid` and `lovejoinPriced` are named nowhere now. |
| docs-check 6 | fixed (to fx-promise's state) | flows.md. **Max (464):** its note names the mix only on a "yes" read with a fill that keeps the reserve, "may take" otherwise; Max never follows down to nothing (LM-2). **The approval (469):** mixed only where the reserve is paid and the fill keeps it (ADA, or a token with boxes); the conditional line wherever else a pool takes it, a token's fill with no box among them, and why. **Stop (480):** boxes on what the return will hold; the pool-short line's "its ADA"; one of three things of the collateral (mixed, only if enough is left, nothing), with the no-box notes. |
| docs-check 7 | fixed | privacy.md:217: the reviews' words by the one rule. Mixed only where the funding paid and the return keeps it; the hedged line wherever else a pool may take it; a site's funding and top-up never mixed outright. |
| docs-check 8 | fixed | flows.md:513: in a token pool, the public held figure is the chain's pick for the most boxes the stepper offers, one where none fits, whatever the count (`publicSideOf(..., most \|\| 1)`, Lovejoin.tsx:2764). |
| docs-check 9 | fixed | flows.md:523 and architecture.md:484: singular for one box while the balances show, plural while they're hidden (`amounts.hidden ? 2`, PendingBanner.tsx:243). |
| docs-check 10 | fixed | flows.md:139: the row and Lovejoin's form offer no second 5 ₳ while it waits, and the page only **Pay it again anyway**, 10 minutes after the send. That's coin-control.ts:372–375's `late` and Collateral.tsx's `WaitingFoot`. |
| docs-check 11 | fixed | privacy.md:121: the reviews say giveme.my's part wherever the collateral may be mixed as the review reads the pool, in a hedged line where it may not go. fx-promise answered the finding's owner's call: the Mix reviews now show the conditional line where the funding went without the reserve (`CollateralMixNote` on `collateralMix`, mixFunding's `asked`). |
| docs-check 12 | fixed | The policy, above. |
| docs-check 13 | fixed | The policy, above. |
| docs-check 14 | fixed | seedelf-data/README.md:169: `` `seedelf-core`'s `` backticked. |
| fx-promise 1–5 | fixed | flows.md 464, 469, 480, 490, 494 and 514, as asked. **Max**, the approval and Stop are above. **A site's funding note and Top up's** say "only if enough is left", never mixed outright; the return's own review says which. **A private mix's review** says the conditional line where the funding went without the reserve, its ⓘ keeping "comes back with the 5 ₳ kept aside" (Session 10's call 2); Mix my boxes again's review the same (`againBuild` → `mixFunding`). |
| fx-promise 6 | fixed | architecture.md, docs-check 5's row. |
| fx-promise 7, 8 | fixed | privacy.md:217 and :121, docs-check 7's and 11's rows. |
| fx-promise 9 | fixed | **OWNER-CALLS.md** gains *Round 3c* (fx-last, docs-a, docs-b) and *After round 3c* (fx-promise, docs-c), each with notes on what later rounds made moot. Earlier calls are annotated in brackets: reserve's 4, sc-o-1's 1 and its stopCost "Not fixed", sc-lj-1's 2 and 3, fx-reserve-1's 2, 3, 4, 7 and 8, fx-reserve-2's 3 and 7. **The plan's *For the owner*** gains item 8 (the ADA-to-token words). |
| fx-promise 10 | already-fixed | The policy needs nothing for fx-promise: no new request, one fewer. |
| fx-last 3, 6, 7 | fixed | Max never down to nothing (flows.md:464); the token pool's held figure (513); the banner while hidden (523, architecture.md:484). |
| fx-last 1, 2, 4, 5, 8 | fixed (superseded by fx-promise) | Stop's and the approval's words, `tailPaid` and privacy.md:217 are written as fx-promise left them. The owner's list notes fx-reserve-1's call 2 (no longer arises) and fx-reserve-2's call 7 (Bootstrap form only, LW-4). |
| fx-last 9 | already-fixed | No policy line: its one new read is gone. |
| docs-a: the reports | fixed | **wlj-4.md:30** gains a bracketed correction: the funding grid was compared within 0.5% until R3-18, whose exact compare then passed (review/CONFIRMED.md R3-18). **w-left.md:3** likewise: four of 314-wasm#0's `runs.ts` catches had no test until R3-19 (fixes/fx-tests.md). |
| docs-a: OWNER-CALLS.md | fixed | **fx-reserve-1's item 7:** sc-o-1's call 1 is "funded without the reserve, not without the mix", and now said so. **fx-reserve-2's item 5:** sc-lj-1's call 2 is now true since R3-7, and call 3's clause no longer applies. Reserve's call 4 gained a note, since fx-promise changed what the fallback says. |
| docs-a: HANDOFF.md | fixed | **The owner's calls (wss-1):** once the watched part lands after an unlock, Home says the payment went only in part, never confirmed: the watch keeps `parts`, sealed (pending.ts:233–237, handlers.ts `pending-tx`). What waits stays in session storage (`seedelf.waiting.<network>`, parts.ts:34), so a lock still cuts it. **The plan's 10b call 1** got the same pointer. post-release-roadmap's "Waiting parts across a lock" now says what's left: parts that outlive a lock would be new. 10b's design wanted its sealed record only to count them, which the watch now does. |
| docs-b: after fx-last | fixed | **The plan:** *Status* and *Start here* drop the last fix-ups. Session 12's commit list gains `677715db`, and its record list `last-3c.md` and `docs-check.md`. *Round 3c* is now what it did, with its checks from the commit message (`tsc` clean, Vitest 2,859). A line on fx-promise and these docs follows it. *Left* drops fx-last's fix-ups, names the later rounds' critical keys for the back-translation, and turns the docs step into "the docs for anything the live run changes". **The roadmap's note:** "was running as this was written" replaced; the one rule added to *Smaller*; fx-last and the design docs out of *Before the PR*; the ADA-to-token call added. **post-release-roadmap:** "the last fix-ups" out of 1.6.0's *Left*. |

## Also changed, beyond the lists (same class, found while checking)

- **post-release-roadmap's R3-10 option (a) bullet** says that with it, an ADA-to-token swap whose token gets no box could say mixed (fx-promise's call 1).
- **flows.md's *Back* step (478)** said the 5 ₳ goes into a pool wherever one is shown and Settings has it on. It now adds "and enough ADA, not held with tokens, is left to pay for it", as line 522 already said.
- **The web wallet README's** chunk-34 paragraph is qualified the same way.

## Files touched

- `seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md`
- `seedelf-platform/seedelf-web-wallet/docs/architecture.md`
- `seedelf-platform/seedelf-web-wallet/docs/flows.md`
- `seedelf-platform/seedelf-web-wallet/docs/privacy.md`
- `seedelf-platform/seedelf-web-wallet/docs/development.md`
- `seedelf-platform/seedelf-web-wallet/docs/roadmap.md`
- `seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md`
- `seedelf-platform/seedelf-web-wallet/docs/plans/chunk-34-token-pools.md`
- `seedelf-platform/seedelf-web-wallet/docs/plans/review-1.6.0/HANDOFF.md`
- `seedelf-platform/seedelf-web-wallet/docs/plans/review-1.6.0/review/OWNER-CALLS.md`
- `seedelf-platform/seedelf-web-wallet/docs/plans/review-1.6.0/fixes/wlj-4.md`
- `seedelf-platform/seedelf-web-wallet/docs/plans/review-1.6.0/fixes/w-left.md`
- `seedelf-platform/seedelf-web-wallet/README.md`
- `seedelf-data/README.md`
- this report

Not touched: the provenance JSON (fx-promise's edits), `seedelf-platform/CLAUDE.md`, `wasm/README.md`, `extension/README.md`, `store/README.md`, `seedelf-data/deploy/README.md` and the root README. Nothing they say moved: no Rust, no export and no store text changed. `CollateralMixLine` lives in `LovejoinReturn.tsx`, which extension/README.md already lists.

## Keys

None added or changed, critical or otherwise.

## Docs to update (left for later events)

- **Once e2e and the suites run on the final tree:** the checks lines in Session 12 and the roadmap's note. They still name `3ea05dc1`, and round 3c's Vitest count is in its own line.
- **After the back-translation and the live run:** each record's *Left*.
- **The record PR:** *Done that way* in the handoff note.
- **If the lead adds a round name:** I called fx-promise's round "After round 3c" / "Then fx-promise, and the docs again", not "3d", since no commit names it yet. Rename it in OWNER-CALLS.md and Session 12 if the commit calls it "round 3d".

## Calls the owner might overturn (mine)

1. **The policy's wording on the collateral's mix:** "where one holds enough other people's boxes and enough of the session's ADA is left, not held with tokens, to pay for the mix". Shorter would be docs-check's "the session's ADA of its own".
2. **The restore scan's ask** has a sentence in the 18 October entry *and* in the policy's own restore-scan bullet, though the server learns nothing it didn't just list. This reverses docs-a's call 2, under the owner's rule, as the task asked.
3. **`bringStopped` is named in the policy** (row and entry) rather than cleared once a page has shown it, which would be code.
4. **architecture.md's trap bullet is narrowed to what holds.** The three calls that drop a trap are recorded in post-release-roadmap rather than fixed: no code in a docs round. The fix is a few lines in `handlers.ts` (`wallet.trapped()` on `isTrap` in each `.catch`, as `answerUi` does). If the lead fixes it now, drop the post-release bullet and architecture.md's last two sentences there.
5. **The plan's *For the owner* gains item 8,** the ADA-to-token words, with "keep for 1.6.0" as the recommendation; R3-10's option (a) would let such a swap say mixed. The roadmap's call list names it the same way.
6. **The two fixers' reports carry bracketed corrections** rather than rewrites, so what each fixer claimed stays visible.

## Notes for the lead

- **`node scripts/i18n-critical.mjs --write`** is still needed for fx-promise's new critical key, `lovejoin.collateralMix.privacy.ifLeft`: `critical-keys.json` doesn't hold it yet. Until then `i18n.test.ts` has a third failure, and the roadmap's and plan's "two es/ja checks" hold only after it.
- **The back-translation list in the plan's *Left*** names `swaps.stop.privacy.collateralMix`, `lovejoin.collateralMix.privacy.ifLeft` and `dappUi.back.privacy.noteLovejoinMixed`. None of the three is in `verified-critical-{es,ja}.json`.
- **No test reads these docs.** `words.test.ts` reads `src/` only, `i18n.test.ts` reads `docs/i18n/` only, `store-images-copy.test.ts` reads neither. So none was run.
- **One GitHub read** settled #323's times (`gh pr view 323`, `gh run view 40109672647`). Nothing written.

## Checks

- **Every claim read in the code:**
  - `sessions.ts`: `quote`, `outBuild`, `siteOutBuild`, `mixFunding`, `topUpBuild`, `againBuild`, `stopCost`, `keepsReserve`, `tailReserve`, `orWithoutReserve`, the restore scan;
  - `rpc.ts`;
  - `Swaps.tsx`: `NewSwap`'s Max note, `SwapApproval`, `StopDialog`;
  - `DappApprovals.tsx` `FundingWayBack`, `SiteSessions.tsx` `TopUpCollateralNote`, `Lovejoin.tsx` (`reviewHint`, `CollateralMixNote`, PoolPage's `shownSide`), `LovejoinReturn.tsx` `CollateralMixLine`;
  - `swap.ts` (`followMax`, `swapCosts`), `PendingBanner.tsx`, `coin-control.ts`, `Collateral.tsx`;
  - `handlers.ts`, `sw.ts` `answerUi`, `wallet.ts` `serial`, `runs.ts`;
  - `lovejoin.ts` (`hatchOrder`, `bringStopped`), `pending.ts`, `parts.ts`;
  - en.json's keys.
- **`git diff --check`** on every file I touched: clean.
- **Stale names and phrases**, grepped over my files: `tailPaid` (now only in the round 3c record, as history), `lovejoinPriced`, the summaries' `collateralPool`, "No catch swallows", "merged a minute", "none offers a second", "where there is one and the session", "where such a pool is shown", "picks for that many boxes". No other hits.
- **Added lines grepped:**
  - for lowercase "seedelf" in prose: none;
  - for release dates and store status: none.
- **Not run:** tests, builds, formatters, cargo, e2e.
