# v-pr329-4-impact: pr329#4, impact and the fix

**Finding:** `architecture.md:732` still says a listed pool's being finished is the server's word, and its being on chain the ledger's to judge. Since #336, both are confirmed from Koios (pr329, rated low).

**Verdict:** partly. **Severity: low**, as rated.
- The defect is real. #336 left the design doc describing the trust as it was before.
- Two parts of the finding need correcting:
  - **The claim:** "where its launch sits" is still the server's word.
  - **The fix:** "Being finished and being on chain are then checked" claims more than the code checks. Koios reads no outputs, so the pool's rows are still the server's word.
- Written as proposed, the fix would replace one misleading doc with another, and would hide pr336's F1.

## What holds (HEAD `6bca8bec`)

- **The code:**
  - `lovejoin-pools.ts:454`: `await this.keep(network, await this.confirmed(network, found));`.
  - `:565` `confirmed()` sends every pool the device doesn't hold yet through `launched()` (:522).
  - `launched()` checks three things:
    - the launch's `tx_info` (`koios.ts:926`);
    - the seed among its inputs (`lovejoinLaunchCheck`);
    - L registered by the launch, or by an earlier block (`firstRegistrations`, `account_update_history`, `koios.ts:954`).
- **The doc is stale.** `architecture.md:732` still says "that it's finished, and where its launch sits, which the earliest is worked out from, are the server's word (below). Whether a pool is on chain at all is the ledger's to judge, not the server's: a pool verifies offline from any seed, so one a list names may never have been launched…". It names `tx_info` and `account_update_history` only for "Koios's look".
- **#336 didn't touch the doc.** `git diff --stat 473b7f1a^1 473b7f1a` lists `privacy.md`, `privacy-policy.md`, `lovejoin-pools.ts` and two tests, and no `architecture.md`.
- **This was an oversight, not a deferral.**
  - The owner's rule (2026-10-28) holds back only the list's ticks for the release-prep commit.
  - Every other item PR in the range updated `architecture.md` itself: #330 `0154d55e`, #333 `fe900cea`, #335 `65a45719`, #337 `aa6f5fc2`.
  - #336's description doesn't mention the doc.
- **The module's own comments are stale in the same way:**
  - `lovejoin-pools.ts:33-35`: "Verified offline, a pool may still not be on chain …, so the ledger is the judge of that".
  - `:435-438`: "That the pool is on chain at all, the ledger checks".
- **`:737` (*What each costs*) gives no cost for discovery.** So since #336, the doc says nothing about the one Koios request mainnet now makes while the data layer is up (rule 8).

## What doesn't hold

Scratch test `zz-review-v-pr329-4-impact-1`: real WebAssembly, the discovery suite's own fixtures, 6 of 6 pass, deleted.

- **A: the finding's main point is right.** The list names a pool new to the device, and Koios knows no launch for it. One `tx_info` goes out, and nothing is kept.
- **B: Koios is asked for no outputs.**
  - The `tx_info` query is `select=tx_hash,block_height,tx_block_index,tx_timestamp,inputs,certificates`, with `_inputs` and `_certs` on (`koios.ts:942`).
  - So nothing Koios answers covers the reference row or the script rows. The data-layer path gives `launched()` the server's rows; the holder look gives it Koios's own.
- **C: the server's datum and position are kept.**
  - Setup: the list's reference datum says 3 ₳ a box (`1a001e8480` changed to `1a002dc6c0`), at block 1, place 0. Koios's `tx_info` says `BLOCK`, place 3.
  - Result: the pool passes the confirm and is kept with `boxLovelace: "3000000"` and `launch: { block: 1, index: 0 }`.
  - Why: `confirmed()` returns the list's own entries (`:583`), and `shown()` orders by them.
  - So "where its launch sits" is still the server's word (the claim's first bullet over-reaches), and so are the datum's box ADA, token and max fee (pr336's F1).
- **D: a pool the device already keeps is never confirmed.** No request, and it stays kept even when Koios knows no launch.
  - This covers a pool a 1.6.0 device kept from the list without a check.
  - Mainnet's bundled head start has 0 pools (`src/lovejoin-pools.json`), so in practice this is narrow.
- **E: the confirm runs only on mainnet with the data layer up.** With Koios-only on, no list is read and Koios is asked nothing (`private-index.ts:368`). The same holds on preprod and with the private part down.
- **F: an unconfirmed pool is asked about again.** While Koios can't confirm it, every list, at least 5 minutes apart, asks `tx_info` again.

## Impact

- **Who can be misled:** only readers of the repo's design doc (the owner, maintainers, agents). `architecture.md` isn't in the store build, and no user, site or attacker reaches it.
- **The user-facing statements are right.** These say what #336 does:
  - the policy's pools paragraph (`privacy-policy.md:46`);
  - the policy's dated entry (`:93`);
  - `privacy.md:200`.
- **So it's low, not medium.** No privacy statement a user reads is wrong.
- **It isn't a nit either.** The doc misstates a security property: what a lying server can hand over. It also leaves out mainnet's only Koios request from discovery. That's "a misleading doc" by the brief's scale.

## The fix, corrected

**Base it on pr336's F6** ("Koios confirms a new pool's launch and L, while its row and its position stay the server's"). Don't use this finding's "Being finished and being on chain are then checked", or x-scen#5's "Only its launch position stays the server's word": both claim more than the code checks.

**Write it after the owner decides pr336's F1.** If F1's code fix lands (read the fresh reference outpoints with `utxo_info` and keep Koios's row and position), the "server's word" sentence below changes, and the cost gains that request.

**On HEAD as it stands, in the house style:**
- **`architecture.md:732`:** after "…(`refresh`; 1.6.0's release review, 317-wallet#0)", replace the text up to "(`account_update_history`)." with:
  > A pool on the list new to the device is kept only once Koios finds it as its holder look would (`confirmed`, then `launched`; 1.7.0, pool-exists and docs-small#1): its launch transaction known (`tx_info`, so on chain), spending its seed, and L registered by it or an earlier block (`account_update_history`). A pool kept already isn't asked about again, and one Koios can't confirm yet waits for the next list. Koios is asked for no outputs, so the rows stay the server's word: the reference datum (its box ADA, token and max fee), the script rows, and where the launch sits in its block, which the earliest is worked out from (`confirmed` keeps the list's entry). A row that isn't on chain is still the ledger's to refuse: every deposit into a token pool reads its reference UTxO (core's `deposit_across`), so it's refused (`BadInputsUTxO`, which stops the chain) rather than lock its boxes for good. Koios's look reads the rows from Koios itself.
  - Keep "Nothing checks L again once a pool is found (`usableNow` passes `registered: true`)". It's still true (`lovejoin.ts:3920`, `:2926`).
  - Drop "(below)".
  - Don't say the ledger stands behind a misstated datum on a real row. Nothing refuses that: a deposit runs no script.
- **The cost (rule 8),** at `:737` or in `:732`:
  > On mainnet, a pool on the list that the device keeps already costs Koios nothing. One new to it costs one `tx_info` for every 20 such launches (inputs and certificates), and one `account_update_history` for every 75 Ls their launches didn't register. That's at the first list that names it, and at each list after (5 minutes apart at least) until Koios confirms it. Preprod, Koios-only and a private part held on Koios read no list, so they never ask it.
  - The batch sizes are `TXS_PER_REQUEST = 20` and `CREDENTIALS_PER_REQUEST = 75` (`koios.ts:448`, `:442`).
- **`:287`, optional:** "`lovejoin/pools` is the shown pools' list (`lovejoin-pools.ts`); one on it new to the device is confirmed on Koios first."
- **The comments, the same correction and comment-only:** `lovejoin-pools.ts:33-35` and `:435-438`.
- **The tick (pr336's F8), in the same release-prep commit:**
  - Tick item 5 (`post-release-roadmap.md:39`), and mark `:379-380` done.
  - Name what was built: `tx_info` and `account_update_history`, not the planned `utxo_info` and `account_info`.
  - If the owner leaves F1 open, add it as a new *Kept in mind* entry.

**What it changes or breaks:** nothing that ships.
- No test reads `architecture.md` or the roadmap. `words.test.ts` scans `../src` string literals and JSX only, never comments.
- Editing comments in `src/` triggers CI's path filter, which the release-prep PR runs anyway.
- Owner's rules:
  - It adds no guard and no UI text.
  - It drops no privacy note: the policy and `privacy.md` already carry the change, with its dated entry.
  - Rule 7: say "1.7.0", never a date.

## Duplicates

The same gap is reported five times. Merge them into one finding:
- pr329#4 (this one);
- pr336's F6 (the most accurate: it has the row, the position, the cost and the comments);
- x-docs#4;
- x-scen#5;
- x-priv#5 (`:287` and the cost).

x-docs#4 says "Overlaps pr329 #5". The fix belongs with pr336's F1 (code, low, owner's call on the extra `utxo_info`) and F8 (the tick).

## Checks run

- Read on HEAD:
  - `architecture.md:286-287`, `:732-737`;
  - `lovejoin-pools.ts`, whole;
  - `koios.ts:140-160`, `:915-965`;
  - `lovejoin.ts`'s `usableNow` and `cantComeBack`;
  - `private-index.ts:362-372`;
  - the roadmap's `:33-42` and `:370-392`.
- Git: #336's diff and PR description, and the range's log for `architecture.md`.
- Scratch test `extension/tests/zz-review-v-pr329-4-impact-1.test.ts`: run alone, 6 of 6 pass in 0.9 s, then deleted. The `zz-review-v-pr329-4-trace-1.test.ts` left in `tests/` is another agent's.
- No network, no build, no tracked file edited.
