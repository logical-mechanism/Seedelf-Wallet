# v-pr338-4-trace: verifying pr338#4

**Verdict: confirmed, low.** I couldn't refute it. Every fact in the finding holds on HEAD (`6bca8bec`), and the line numbers are right. The harm is narrower than the scenario's last step says: rule 8 is already met for the feature elsewhere. It duplicates `pr334`'s finding 3, which `v-pr334-2-trace` also confirmed as low.

## What I traced

- **Which PRs touched the roadmap** (`git diff --stat <merge>^1 <merge>`):
  - #330, #331, #332, #334 and #338 changed `post-release-roadmap.md`.
  - #333, #335, #336 and #337 didn't.
  - #338 changed item 8's list line and its *Kept in mind* entry, and nothing else. That matches the user's note: "a pure docs pr that updated the item 8 text".
- **The deferral is deliberate.** #333's description says: "As agreed, the 1.7.0 list's tick waits for the release-prep docs commit." That commit isn't on HEAD.
- **HEAD's list:**
  - :38 `4. 🚧`, with only "✅ The overflow half".
  - :39 `5. ⬜`.
  - :40 `6. ⬜`, which still says "The owner's calls first: after how long it's offered, and its words."
  - :41 `7. ⬜`.
  - :42 `8. ✅`.
- ***Kept in mind* on HEAD:** :373, :374, :378, :379 and :380 are all unticked. Only :387 and :388 carry `✅ **1.7.0:**`.
- **Each item did land on HEAD:**
  - Item 4: `bootstrap_back_reserve(params)` (`seedelf-core/src/lovejoin/mod.rs:1744`), with `BOOTSTRAP_BACK_RESERVE` now its floor (`:1750`).
  - Item 6: `TAIL_OFFER_MS = 60 * 60_000` (`lovejoin.ts:335`), `session-skip-collateral-mix` (`handlers.ts:512`), and the button "Bring the rest back now" (`en.json:921`).
  - Item 7: `tx-view.ts:190-192` follows `partHashes`.
  - Item 5: see the next bullet.
- **What item 5 asks Koios on HEAD:**
  1. `refresh()` calls `confirmed()` (`lovejoin-pools.ts:454`).
  2. `confirmed()` (`:565-584`) calls `launched()` on Koios alone (`koiosAlone()`, `:570`).
  3. `launched()` calls `koios.launches` (`:527`), which posts `tx_info` (`koios.ts:926-947`), 20 transactions a request (`TXS_PER_REQUEST`, `:448`).
  4. Then, only for an L its launch didn't register (`lovejoin-pools.ts:550-551`), it calls `koios.firstRegistrations`, which posts `account_update_history` (`koios.ts:954-965`), 75 a request (`CREDENTIALS_PER_REQUEST`, `:442`).

  Nothing on this path asks `utxo_info` or `account_info`. Roadmap :379 says "one `utxo_info` per newly listed pool", and :380 says "One batched `account_info`". Both describe the candidate's plan, not what #336 built.

## Scratch test (deleted)

`extension/tests/zz-review-v-pr338-4-trace-1.test.ts`, run alone. It used the real WebAssembly and the discovery test's fakes. Result: **Tests 4 failed | 6 passed (10)**.

- **Part 1, the code. 4 tests, all pass:**
  - A new listed pool whose launch registered L: Koios calls `["tx_info"]`.
  - One whose launch didn't register L: `["tx_info", "account_update_history"]`, asked for that L alone.
  - A pool Koios can't confirm: `["tx_info", "tx_info", "tx_info"]` over three refreshes. It's asked again at every refresh, not once.
  - 25 launches take 2 `tx_info` requests, and 80 Ls take 2 `account_update_history` requests.
- **Part 2, the finding. 4 tests, all fail on HEAD:**
  - Items 4–7 aren't `✅`. Received: "4. 🚧 …".
  - Item 6 still contains "The owner's calls first".
  - :379 contains `` `utxo_info` ``.
  - None of the *Kept in mind* entries starts with `  - ✅ **1.7.0:**`.
- **Part 3, the narrowing. 2 tests, both pass:**
  - `privacy.md:200`'s sentence names `tx_info` and `account_update_history`, "only as each is new", and neither `utxo_info` nor `account_info`.
  - The privacy policy's 28 October entry (`store/privacy-policy.md:93`) says what Koios is asked.

The file is deleted, and `git status` shows none of my files.

## Narrower than stated

1. **Rule 8 is already met for the feature.**
   - #336 states the cost correctly in `privacy.md:200`, the policy's 28 October entry, and `lovejoin-pools.ts:516-520`.
   - If :379–380 were left as they are, the roadmap would contradict those docs. That is a misleading doc (low), not a feature with no stated cost.
   - The scenario's step 3 ("goes against rule 8") is true only of the roadmap's own lines.
2. **The unticked marks aren't a defect on their own.** The owner agreed to the deferral, and the release-prep commit is the planned remedy. What the finding adds is useful: that commit has to rewrite these lines, not just tick them. The house convention does that: :387–388 put a new `✅ **1.7.0:**` description over the struck old text, and #338 replaced item 8's entry outright. Nothing on HEAD enforces the convention, so the scenario can happen.

## Fix advice (refinements to the finding's)

- **:379–380, the cost as built.** "`tx_info` per new launch" is imprecise. As built, it is:
  - one `tx_info` per up to 20 new launches;
  - one `account_update_history` per up to 75 Ls, only for those the launch didn't register;
  - asked of Koios, never the data layer, at a list refresh (at most every 5 minutes, `REFRESH_MS`), and only for pools new to the device;
  - asked again at every refresh for a pool Koios can't confirm, since `confirmed()` keeps nothing unconfirmed.
- **:378 and :38 need rewriting too, not just ticking.**
  - :378 still describes the bug as current: "a fixed 1.5 ₳ … 68 classic boxes, and 51 of LJTEST".
  - Since #333, the reserve is `bootstrap_back_reserve(params)`, with `BOOTSTRAP_BACK_RESERVE` as its 1.5 ₳ floor. At 6,465 lovelace a byte the cap is 96 and 64.
- **:40 and :373, the calls as made:**
  - offered an hour after the collateral mix's deposit (`TAIL_OFFER_MS`);
  - *Bring the rest back now*, with its line `lj.tail.privacy.wayOut`.
- **Leave item 2 at 🚧** until the owner requires the check.

## Adjacent, already reported (not this finding)

- `architecture.md:732` still says a listed pool's being finished is the server's word, and that being on chain is "the ledger's to judge".
- `architecture.md:737` (*What each costs*) has no confirm cost.
- `lovejoin-pools.ts:31-36` and `:436-438` say the ledger judges whether the pool is on chain.
- These are already reported by `pr329`#5, `pr336`, `x-docs`#4, `x-scen`#5 and `x-priv`. The same release-prep commit can fix them.

Confidence: high.
