# v-pr336-7-trace: pr336#7, the roadmap's item 5 and its two *Kept in mind* entries

**Verdict: partly. Severity: nit.**

The facts hold on HEAD (`6bca8bec`). The doc is stale and has to change before the cut. But the missing tick isn't a slip by #336:

- After #330 and #332 ticked their own items, the ticks were deliberately left to one release-prep docs commit. #333's description records it: "As agreed, the 1.7.0 list's tick waits for the release-prep docs commit."
- #335, #336 and #337 all followed that, so items 4 (its Bootstrap half), 5, 6 and 7 are waiting on the same commit.

What's left is narrower than the finding: that commit has to **rewrite** :379–380, not just tick or strike them. They describe requests the wallet never sends.

## What was checked

### The roadmap on HEAD

- `docs/post-release-roadmap.md:39` reads "5. ⬜ **A listed pool confirmed on chain, and L's registration checked on the data layer's path**, before a pool is handed over: new requests, so a privacy policy entry in the same PR."
- :379 (pool-exists) reads "one `utxo_info` per newly listed pool. Without it a lying server, or a deep rollback, can show a pool that isn't on chain, kept for good; …"
- :380 (docs-small#1) reads "One batched `account_info` as a pool is first handed over would check it, …"

### What #336 built (`lovejoin-pools.ts` on HEAD)

- `refresh()` now calls `this.keep(network, await this.confirmed(network, found))` (:454).
- `confirmed()` (:565–584) runs `launched()` on the pools new to the device, through `koiosAlone()`.
- `launched()` (:522–554) asks Koios for:
  - `koios.launches()`, which is `tx_info` (`koios.ts:926–947`, 20 a request). It selects `tx_hash,block_height,tx_block_index,tx_timestamp,inputs,certificates`, with no outputs.
  - `koios.firstRegistrations()`, which is `account_update_history` (`koios.ts:954–965`, 75 a request, `action_type=eq.registration`), asked only for an L its launch didn't register.
- The data layer's path sends no `utxo_info` and no `account_info`.

### Which PRs touched the roadmap

From `git diff <merge>^1 <merge>` on the roadmap:

| PR | What it did to the roadmap |
|---|---|
| #330 | Ticked item 3 and struck its entry (:37, :388) |
| #331 | Moved item 2 to 🚧 |
| #332 | Ticked item 4's overflow half (:38, :387) |
| #338 | Ticked item 8 (:42, :405–409). As the owner says, docs only: it touched no line of item 5 |
| #333, #335, #336, #337 | Nothing |

### The PR descriptions

- `gh pr view 333` records the agreement quoted above.
- #336's description says nothing either way about the roadmap.
- The agreement isn't written down anywhere in the tree's docs.

## Scratch test

`extension/tests/zz-review-v-pr336-7-trace-1.test.ts`, run alone and then deleted. It uses the harness from `lovejoin-discovery.test.ts` and the real WebAssembly. Result: 3 passed, 3 failed.

**Passed on HEAD (the code):**

- **A1.** A newly listed pool whose launch didn't register L, with L registered by an earlier block. Koios was asked:
  - `[{"path":"tx_info","query":"select=tx_hash%2Cblock_height%2Ctx_block_index%2Ctx_timestamp%2Cinputs%2Ccertificates"}`
  - `{"path":"account_update_history","query":"select=stake_address%2Cblock_time&action_type=eq.registration"}]`

  There was no `utxo_info` and no `account_info`. The pool was kept, and the next list asked nothing more.
- **A2.** The check runs once, at first sight. A pool was kept, then its launch dropped from Koios (a rollback after the check). The next list still kept it, and sent no new `tx_info`.
- **Context.** In the 1.7.0 list, items 3 and 8 are ✅, item 4 is 🚧, and items 6 and 7 are ⬜.

**Failed on HEAD (the docs, as the finding says):**

- Item 5 at :39 isn't `5. ✅`.
- The pool-exists entry at :379 names `utxo_info`.
- The docs-small#1 entry at :380 names `account_info`.

## Why partly, not confirmed

- **"Believes item 5 isn't done":** unlikely. Ticking items 4–7 is the release-prep commit's agreed job, and the PR list names #336 as item 5. pr326, pr329, pr335#2, pr338#5 and x-docs carry the same unticked list. This is one row of that shared finding, not something #336 did wrong.
- **"Believes the utxo_info plan was built":** this half is real. :387–388's style keeps the old text struck through behind a "✅ 1.7.0:" lead. A prep that only strikes :379–380 would leave the roadmap stating a Koios cost (`utxo_info`, `account_info`) for a feature that sends other requests (rule 8).

## Fix advice

In the release-prep docs commit, together with items 4, 6 and 7:

1. **Item 5 → ✅.** On mainnet's data layer path, a pool new to the device is kept only once Koios confirms it. `tx_info` must find the launch spending the seed. Where the launch didn't register L, `account_update_history` must show an earlier registration. This goes through `launched()`, which the holder look shares, and the policy entry is dated 28 October 2026.
2. **:379–380.** Replace them with "✅ **1.7.0:**" lines naming what's built, with the old text struck through, as :387–388 do. Each entry should give the cost:
   - one `tx_info` per 20 new pools, plus one `account_update_history` per 75 L's;
   - asked once per pool per device, and again at each list while it's unconfirmed;
   - never a `utxo_info` or an `account_info`.
3. **Keep open what isn't covered**, unless it gets fixed first:
   - F1: the reference row's datum (box ADA, token, max fee) and the launch position stay the server's word, because `tx_info` is asked without outputs (`koios.ts:942`).
   - The check runs once, at first sight (A2). The pool-exists entry's "a deep rollback … kept for good" is closed only before that check.
