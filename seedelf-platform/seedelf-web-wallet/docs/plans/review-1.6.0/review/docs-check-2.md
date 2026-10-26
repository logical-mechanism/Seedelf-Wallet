# docs-check-2: the docs checked against the code again, after docs-c

**Scope.** `git diff 3ea05dc1` over the docs the brief names, with `review-1.6.0/` skipped. The same 15 files changed as in the first check, plus the web wallet README (docs-c). The root README, wasm/README.md and seedelf-data/deploy/README.md didn't change. The focus was docs-c's own lines (`git diff 677715db`, uncommitted: 12 files) and the served privacy policy, read whole.

**What it was checked against:** the tree as it stands, `677715db` plus fx-promise's uncommitted code (`sessions.ts`, `rpc.ts`, `LovejoinReturn.tsx`, `Swaps.tsx`, `DappApprovals.tsx`, `SiteSessions.tsx`, `Lovejoin.tsx`, the locales). The reports are `review/docs-check.md` (the first check) and `fixes/docs-c.md`.

**How:** read-only. Nothing was built, tested or run through cargo. Two GitHub reads settled #323's times again: `gh pr view 323` (merged 16:02:25Z) and `gh run view 40109672647` (created 16:01:59Z, failed 16:14:34Z at *Extension unit tests*, every later step skipped).

**Result:**
- **No high or medium.** Two findings: one low, one nit.
- **The first check's 14 findings are all fixed** in the tree, each read in the code (below).
- **No data-handling change of 1.6.0 is left out of the policy's 18 October entry.** One is an open owner's call already (10b's call 1).
- **No release date or store status.**
- **No line of the served policy promises what the wallet doesn't do.** Finding 2 is a nit of where, not of what.

## Findings

### 1. Low: the plan's Session 12 says every site's funding gives giveme.my's part
- **Where:** chunk-34-token-pools.md:944, the *Then fx-promise* line. It says "only if enough is left", giveme.my's part with it, wherever else a 5 ₳ pool may take it, "an ADA-to-token swap whose token gets no box and every site's funding among them".
- **What the code does:**
  - A site's funding review says only "only if enough is left", with no word of giveme.my (`FundingWayBack`, DappApprovals.tsx:466, 488; `dappUi.back.privacy.noteLovejoinMixed`, en.json:349).
  - Its top-up says the same (`TopUpCollateralNote`, SiteSessions.tsx:520-527; `sites.topUp.collateralMixed`, en.json:2141).
  - giveme.my's part comes on that return's own review (`CollateralTailNote`, LovejoinReturn.tsx:470-477; en.json:1021).
  - The line that carries giveme.my's part, `CollateralMixLine`, is on the swap approval, Stop and the two Mix reviews only.
- **The other docs have it right:** architecture.md:633 ("the site's two notes in their own words"), privacy.md:217 and flows.md:490.
- **Fix, short:** "…giveme.my's part with it, wherever else a 5 ₳ pool may take it, an ADA-to-token swap whose token gets no box among them; a site's funding and top-up say only if enough is left, their return's own review giveme.my's part; nothing where no mix can go."

### 2. Nit: the policy's 1.6.0 entry puts Bring every box back now's Stop "in Settings"
- **Where:** privacy-policy.md:93, "once you stop **Bring every box back now** in Settings, how many boxes it sent and from which pool".
- **What the code does:**
  - A pool's page has its own Bring every box back now, for that pool alone (Lovejoin.tsx:3525). Settings has the one for every pool (Settings.tsx:914).
  - Stop on either page, or in another tab, keeps the record (BringAllBack.tsx:163, handlers.ts:572-573, lovejoin.ts:6402).
  - The record names a pool only for a run that a pool's page started, and kept one pool's (handlers.ts:569; lovejoin.ts:6380, 6383). A run started in Settings names none.
- **So** "in Settings" leaves out the page the pool comes from. The Lovejoin row (:28) says it without "in Settings".
- **Fix:** drop "in Settings".

## The first check's findings, as they now stand

| # | Now | Read in |
|---|---|---|
| 1 | architecture.md:53 says only what holds. It names the three calls in `handlers.ts` that still drop a trap (153, 226, 570). A trap inside the queue still locks (wallet.ts:577-589). post-release-roadmap.md:367 has the code gap. | handlers.ts, wallet.ts, sw.ts's listeners (none runs WebAssembly outside the queue) |
| 2 | #323's timeline is right in development.md:15, roadmap.md:51, the plan's :925 and :960. "Nothing of the wallet's runs on `main`" is true. | the two GitHub reads; `continuous-integration.yml` (push to main: Aiken alone), `web-wallet.yml` (pull requests alone) |
| 3 | The policy's :28 and :93 mix the collateral where the pool holds enough other people's boxes and enough ADA, not held with tokens, is left. | `collateralPool` (lovejoin.ts:3894-3905: the floor, `TAIL_DRAWS` 2 free; `usableNow` refuses only a box below the minimum), `intoPool` (sessions.ts:4358), `direct_tail` pays from ADA alone (wasm lovejoin.rs:369, 373), a chain from its change (:1784) |
| 4 | The several-accounts tie is in :69 and :93. | `hatchOrder` (lovejoin.ts:2017-2023), `lovejoin.stuck.privacy.publicNamed` (en.json:1338) |
| 5 | architecture.md:633 follows `CollateralMix` and `stopCost`. | rpc.ts:1573, 1622, 1669, 1954; `keepsReserve` (sessions.ts:1037-1039); the quote (:1584), `outBuild` (:1915), `siteOutBuild` (:1963), `mixFunding` (:2140), `topUpBuild` (:2221); `stopCost`'s `mayMix`, `aside`, `ordered`, `cancelled`, `counted`, `keeps` (:3290-3310), `CANCEL_FEE_ESTIMATE` 0.25 ₳ (:211); no read of parameters there (`priced` and `funding` read none); no screen reads `collateralMaybe` (grep) |
| 6 | flows.md:464, :469 and :480. | Max's note (Swaps.tsx:1104-1111), `followMax` (swap.ts:149-151); the approval (Swaps.tsx:1310, 1389, 1407, 1418); Stop (:2837-2924) and its strings (en.json:2503-2518) |
| 7 | privacy.md:217 states the one rule. | as 5 and 6, and the site's two notes (finding 1's lines) |
| 8 | flows.md:513: the public figure picks for the stepper's most, one where none fits. | Lovejoin.tsx:2764 |
| 9 | flows.md:523 and architecture.md:484: plural while hidden. | PendingBanner.tsx:243 |
| 10 | flows.md:139: the row and Lovejoin's form offer no second 5 ₳; only the page offers **Pay it again anyway**, after 10 minutes. | `WAIT_MS` (coin-control.ts:74), `late` (:372-375), `WaitingFoot` (Collateral.tsx:60-89) |
| 11 | privacy.md:121: the reviews say giveme.my's part wherever the mix may go, hedged where it may not. The Mix reviews now show the hedged line without the reserve. | `CollateralMixNote` (Lovejoin.tsx:3802, 3814-3816, 3883); `reviewHint` (:174-182) keeps `privateNote`'s "comes back with the 5 ₳ kept aside" there |
| 12 | The restore scan's ask is in the 18 October entry and the body's bullet (:43). | sessions.ts:2751-2786: the funding left out (`unsigned.slice(0, -1)`), the first input at the contract, one `utxo_info` with the orders' outputs, `ownedUtxos` on the device |
| 13 | `bringStopped` is in the row and the entry. | lovejoin.ts:909 (sealed, as the schedule is: :809-815), set only by Stop (:6402), cleared only by the next run (:6385); see finding 2 |
| 14 | seedelf-data/README.md:169 backticks the crate. | |

## docs-c's other lines, checked and holding

- **flows.md:478** (*Back*): the floor (networks.ts:71, 30 on mainnet), two free, Settings' switch, and ADA not held with tokens.
- **flows.md:490 and :494:** a site's funding and top-up say "only if enough is left", never mixed outright. The mix row and the both-ways total stay on the reserve (DappApprovals.tsx:464-489, SiteSessions.tsx:520-527).
- **flows.md:514:** a mix funded without the reserve shows the hedged line, and Mix my boxes again's review says the same (`againBuild` → `mixFunding`, sessions.ts:2055, 2140; en.json:1120).
- **post-release-roadmap.md:**
  - :354: after an unlock Home says how many parts didn't go (handlers.ts:232-237; pending.ts:230-237; PendingBanner.tsx:262-267; en.json:1542-1543).
  - :355: R3-10 option (a)'s new sentence.
  - :367: the three calls.
- **roadmap.md:50, :51, :54, :59, :60** and **the plan's** *Status*, *Start here*, the commit and record lists, *Round 3c* (as the commit message has it), items 6 and 8, and *Left*.
- **The web wallet README** (:57), **development.md:15**, and the policy's "where there is one" (:45), which matches `crossCheck` leaving the tail's mix to `tailWitness` (lovejoin.ts:4166-4178).
- **Added lines grepped** for lowercase "seedelf" in prose: none.

## The policy's 1.6.0 entry and each later round's data handling

| Change | In the 18 October entry? | Verdict |
|---|---|---|
| The restore scan's `utxo_info` of each later payment's first contract input | Yes (docs-c), and the body's bullet | Named, and true |
| `bringStopped` | Yes (docs-c), and the row | Named, and true; finding 2 is its wording |
| fx-promise's words (`CollateralMix`) | — | Words only: nothing new is sent or kept |
| Stop's no-box `epoch_params` (fx-last's `tailPaid`) | — | Gone again: the only request line fx-promise's `sessions.ts` diff touches is that read's removal |
| fx-last's LM-2, LW-1, LW-2, LW-4 | — | No request, no record |
| Bring every box back now's run record (`bringing`), `counted`, `recheck` | The row's "a box being brought back until it's settled" | Covered, as the first check had it: each ends once its boxes are settled |
| The watch's `parts`, how many of a payment's parts went (fc8561c7) | The row *A payment you send* | A count in a record the policy lists, sealed and deleted with it: no line needed |
| A payment's later parts, signed, waiting in session storage (10a, 10b; parts.ts:8-13) | No | The plan's 10b call 1 says no entry: the owner's, already open (below) |

## Release dates and store status

- **None.**
- **Words looked at and kept:**
  - "the privacy policy's unshipped 1.6.0 entry" (plan:944) says how far the release has got, as the plan's *Left* does ("the upload … left"). It's no store status.
  - The entry's date, and the roadmap's "2026-10-25: 1.6.0's release gate", are as before (below, and the first check).

## The served policy, read whole

No line promises what the wallet doesn't do.
- **The 1.6.0 lines read in the code:** :22, :28, :41, :43, :45, :46, :49, :69, :71, :93.
- **One that reads close:** :71's "one of up to 9 at the default depth (16 with four boxes a mix)". It isn't broken by the collateral's box, which is mixed once, three wide, whatever Settings' depth and width (`TAIL_DRAWS`, lovejoin.ts:320): up to 3 is within up to 9. And :28 says the box is "mixed there once with two other people's boxes".

## Not verified

- The tests, the builds, e2e and the live run: none was run.
- The checks lines' counts (Vitest 2,859; fx-promise's 194 and 1,868).
- 0.237697 ₳ for a real Minswap cancel (core's `cancel_integrity.json`).

## Already tracked, not counted

- **A third critical-key failure.** fx-promise's critical key `lovejoin.collateralMix.privacy.ifLeft` isn't in `critical-keys.json` yet, so `i18n.test.ts` fails three ways until `node scripts/i18n-critical.mjs --write`. The plan's *Left* item 1 and the roadmap say two (docs-c's notes for the lead).
- **The policy's date and header.** *Effective 18 October 2026* stands over later changes, and the header's list doesn't name the collateral's mix: Session 12's call 1.
- **A payment's waiting parts.** They're held in memory-only session storage, never sealed, and the policy names no such holding: the plan's 10b call 1 ("No new device record, so no privacy policy entry"), the owner's to confirm.
