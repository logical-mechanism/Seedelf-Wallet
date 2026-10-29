# v-x-docs-0-trace: verifying x-docs#0

**Finding:** 1.7.0's items 4–7 and five (1.7.0) *Kept in mind* entries still read as open, and two of the entries describe requests that weren't built.

**Verdict: confirmed, low.** Every claim holds on HEAD `6bca8bec`. The fix is mostly right, but three parts need correcting (below). The staleness is the agreed deferral (#333: "As agreed, the 1.7.0 list's tick waits for the release-prep docs commit"), so this is the checklist for that commit, not an oversight. #338, as the owner says, is docs only and changed item 8 alone.

## What I traced

- **None of the four PRs touched the roadmap.** In the range, `git log babb8e76..6bca8bec -- docs/post-release-roadmap.md` shows only #326, #329, #330, #331, #332, #334 and #338. #333, #335, #336 and #337 each list other files.
- **Which PR landed which item** (from each PR's own description): #333 item 4's other half, #335 item 7, #336 item 5, #337 item 6.
- **The roadmap on HEAD:**
  - :38 reads `4. 🚧`, with only the overflow half ✅.
  - :39, :40 and :41 read `5. ⬜`, `6. ⬜ … The owner's calls first: after how long it's offered, and its words.` and `7. ⬜`.
  - :373, :374, :378, :379 and :380 are the only open `(1.7.0)` entries. :387, :388 and :405 are ✅.
  - No other roadmap line restates these four features. (:364's `utxo_info` is a different path, on the public side.)
- **The code on HEAD:**
  - **Item 4:** `bootstrap_back_reserve(params)` (mod.rs:1744), with `BOOTSTRAP_BACK_RESERVE` now only its floor (mod.rs:1733, `.max(BOOTSTRAP_BACK_RESERVE)`). `bootstrap_most` uses it (`let back = bootstrap_back_reserve(params)?;`, mod.rs:1974). :378 ("a fixed 1.5 ₳, so a dearer byte lowers the cap") is false now.
  - **Item 5:** `refresh()` keeps `await this.confirmed(network, found)` (lovejoin-pools.ts:454). `confirmed()` (:565) calls `launched()`, which calls `koios.launches` (`tx_info`, koios.ts:926) and `koios.firstRegistrations(ask)` (`account_update_history`, koios.ts:954). It asks the second only for an L whose launch didn't register it. Nothing on this path asks `utxo_info` or `account_info`, so :379–380 describe requests that weren't built. :380's "the wallet takes its word that L is registered" is false now.
  - **Item 6:** `TAIL_OFFER_MS = 60 * 60_000` (lovejoin.ts:335, "the owner, 2026-10-28"), `case "session-skip-collateral-mix"` (handlers.ts:512), and `lj.tail.wayOut` "Bring the rest back now". :40's "The owner's calls first" and :373 now describe a control that exists as one not yet built.
  - **Item 7:** `tx-view.ts`'s `partOf` follows `partHashes` (:190–194), and `TxDetail.tsx` has the stepper (`tx.partOf`). :374's "a review opens only the first part's" is false now.

## The scratch test

`extension/tests/zz-review-v-x-docs-0-trace-1.test.ts` read source and docs as text only. I ran it alone and then deleted it.

- **Part A, the code (4 tests):** item 4's priced reserve in `bootstrap_most`; item 5's `confirmed` → `launched` → `tx_info` / `account_update_history`, with no `utxoInfo` or `accountInfo`; item 6's `TAIL_OFFER_MS` and RPC; item 7's `partHashes`. **All 4 passed.**
- **Part B, the roadmap (6 tests):** items 4–7 each start `N. ✅`; no open `(1.7.0)` entry under *Kept in mind*; the `pool-exists` and `docs-small#1` lines name neither `utxo_info` nor `account_info` outside strikethrough. **All 6 failed on HEAD:**
  - The items read `4. 🚧`, `5. ⬜`, `6. ⬜` and `7. ⬜`.
  - The open entries are exactly the five the finding lists.
  - :379 still says "one `utxo_info` per newly listed pool".

So the features are built and the roadmap says they aren't. That's the finding.

## Corrections to the proposed fix

1. **Item 5's tick shouldn't say #336 closes "a lying server" outright.**
   - `confirmed()` runs `launched()` on the server's own reference row (`fresh.map((p) => ({ row: p.ref.reference, … }))`, lovejoin-pools.ts:576).
   - `tx_info` is asked without outputs (`select=…,inputs,certificates`, koios.ts:942).
   - A pool's scripts derive from its seed alone (`templates::derive`, templates.rs:120), so the derivation never pins the reference datum's box ADA, token or max fee.
   - `confirmed()` also returns the server's `found` entries, so the launch position stays the server's too (:583).
   - **What #336 closes:** a listed pool whose launch isn't on chain (a seed no launch spent), and one whose L neither its launch nor an earlier block registered.
   - **What it leaves:** the server's word on a real pool's datum and position. This is pr336's F1, whose remedy is the very `utxo_info` read :379 proposed. If F1 stays open, keep that idea as a residual entry rather than deleting it as "not built".
2. **State the Koios cost as batched (rule 8).** "`tx_info` per new pool's launch" reads as one request per pool. The real cost:
   - one `tx_info` per 20 new launches (`TXS_PER_REQUEST = 20`, koios.ts:448);
   - one `account_update_history` per 75 L's whose launch didn't register them (`CREDENTIALS_PER_REQUEST = 75`, koios.ts:442);
   - once per pool per device, since a kept pool is never asked again (`known.has(…) ||`, :583; pinned by lovejoin-discovery.test.ts, "a pool kept isn't asked about again");
   - again at each list while a pool is unconfirmed.
3. **The rollback note is right, but narrow.**
   - `confirmed()` checks only pools not yet kept, and `keep()` only appends, so a launch rolled back after its first check stays kept. The Koios path has always behaved the same way.
   - The data layer lists only as of a stable cursor 200 slots behind its tip (`DEPTH = 200`, `QUANT = 200`, seedelf-data/api/src/cursor.rs:18,21). So the rollback would have to be deeper than that, and come after the device's first check.
   - Note that the data-layer path has no `SETTLE_MS` gate of its own: that's only in `holder()` (lovejoin-pools.ts:492).

**The rest of the fix holds:**
- **Item 2 stays 🚧.** `gh api …/branches/main` shows it protected, with `required_status_checks` contexts `[]` and checks `[]`.
- **Strike the five entries in the file's own convention**, "✅ **1.7.0:** …", as :387–388 do.
- **Item 6's hour is recorded as the owner's** (lovejoin.ts:330–335). The repo doesn't record the button's words as the owner's call, so the tick should give the words as built and credit the owner only with what's recorded.

## Severity

**Low:** a misleading doc on HEAD, already planned for release prep. It matters for two reasons:
- this file is what the next chunk is picked from, and :40 says the way out still waits on the owner's calls;
- a tick alone would leave :379–380 recording requests the wallet doesn't make.
