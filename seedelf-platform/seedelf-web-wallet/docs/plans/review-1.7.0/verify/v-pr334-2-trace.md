# v-pr334-2-trace: verifying pr334#2

**Verdict: confirmed, low.** Every fact in the finding holds on HEAD (`6bca8bec`). The roadmap is stale on purpose: the tick was agreed to wait for the release-prep docs commit. That commit is not on HEAD, so nothing on HEAD covers this. The finding is useful because it lists what that commit must change beyond the ticks. The harm is a little narrower than the scenario says (see *Narrower than stated*).

## What I traced

- **Which PRs touched the roadmap.** `git diff --stat <merge>^1 <merge>`:
  - #330, #331, #332, #334 and #338 changed `docs/post-release-roadmap.md`.
  - #333 (`b2c3940f`), #335 (`0bad0d52`), #336 (`473b7f1a`) and #337 (`11e249d2`) didn't touch it.
  - `git log babb8e76..6bca8bec -- docs/post-release-roadmap.md` lists no commit from those four.
  - A word diff shows each of #330, #331, #332 and #338 changing its own list mark and its *Kept in mind* entry.
- **#338** (the user's note: "a pure docs PR that updated the item 8 text"): its diff is post-release-roadmap.md alone, 6 lines. It changes item 8's list line (`⬜`→`✅`) and its *Kept in mind* entry. It leaves items 4–7 as they were.
- **The deferral is deliberate.** #333's description: "As agreed, the 1.7.0 list's tick waits for the release-prep docs commit." The descriptions of #335, #336 and #337 don't mention the roadmap.
- **HEAD's list:**
  - :35 `1. ✅`
  - :36 `2. 🚧`
  - :37 `3. ✅`
  - :38 `4. 🚧 … ✅ The overflow half`
  - :39 `5. ⬜ **A listed pool confirmed on chain, …`
  - :40 `6. ⬜ **An "unmixed, now" way out** … The owner's calls first: after how long it's offered, and its words.`
  - :41 `7. ⬜ **Transaction details for every part**`
  - :42 `8. ✅`
- ***Kept in mind* on HEAD:** :373 (323-worker#3), :374 (321-parts-worker#5), :378 (bootstrap's call 1), :379 (pool-exists) and :380 (docs-small#1) are all unticked. Only :387 and :388 carry `✅ **1.7.0:**`.
- **What #336 built, compared with :379–380:**
  - :379 says "one `utxo_info` per newly listed pool", and :380 says "One batched `account_info`".
  - The code on HEAD goes `confirmed()` (`lovejoin-pools.ts:565-584`) → `launched()` (`:522-554`) → `koios.launches` and `koios.firstRegistrations`.
  - `koios.launches` posts `"tx_info"` (`koios.ts:926-947`), 20 transactions a request (`TXS_PER_REQUEST`, `:448`).
  - `koios.firstRegistrations` posts `"account_update_history"` (`koios.ts:954-965`), 75 a request (`CREDENTIALS_PER_REQUEST`, `:442`). It is called only for an L the launch didn't register (`lovejoin-pools.ts:550-551`).
  - Nothing on this path calls `utxo_info` or `account_info`.
- **What #337 settled** (item 6's "owner's calls"):
  - The offer comes after an hour: `export const TAIL_OFFER_MS = 60 * 60_000;` (`lovejoin.ts:335`).
  - The button is `"lj.tail.wayOut": "Bring the rest back now"` (`en.json:921`), and its line is `lj.tail.privacy.wayOut` (`en.json:922`).
- **What #333 changed** (:38 and :378):
  - The reserve is now `bootstrap_back_reserve(params)` (`seedelf-core/src/lovejoin/mod.rs:1744`).
  - `BOOTSTRAP_BACK_RESERVE` (`:1733`) is now only its floor: `.max(BOOTSTRAP_BACK_RESERVE)` (`:1750`).
  - :378 still describes the bug as current: "a fixed 1.5 ₳ … 68 classic boxes, and 51 of LJTEST". Since #333, the cap at that price is 96 and 64.

## Scratch test (deleted)

`extension/tests/zz-review-v-pr334-2-trace-1.test.ts`, run alone. It read the roadmap and the worker's source.

- **Sanity (3 tests, all passed):**
  - The data-layer confirm goes through `launched()` to `tx_info` and `account_update_history`, with no `utxo_info` or `account_info`.
  - `TAIL_OFFER_MS` is an hour, and the button reads "Bring the rest back now".
  - The list has eight items.
- **The finding (12 tests, all failed on HEAD):**
  - Items 4–7 aren't `✅`. Received: `4. 🚧`, `5. ⬜`, `6. ⬜`, `7. ⬜`.
  - Item 6 still contains "The owner's calls first".
  - None of the five *Kept in mind* entries starts `  - ✅ **1.7.0:**`.
  - :379 contains `` `utxo_info` ``, and :380 contains `` `account_info` ``.
- **Result:** `Tests 12 failed | 3 passed (15)`. The file is deleted, and `git status` shows only the review folder untracked.

**The existing tests confirm the runtime behaviour.** `npx vitest run tests/lovejoin-discovery.test.ts -t "data layer"` gave 11 passed. Among them:

- :290 and :357: `expect(k.calls.map((c) => c.path)).toEqual(["tx_info"])` for a new listed pool.
- :394: `account_update_history` asked once for a late-registered L.

## Narrower than stated

1. **The Koios-cost rule is met elsewhere.** #336 states its cost correctly in three places:
   - `privacy.md:200`, the pools bullet ("`tx_info` … `account_update_history` … only as each is new").
   - The privacy policy's 28 October entry (`store/privacy-policy.md:93`).
   - The doc comment at `lovejoin-pools.ts:516-520`.

   :379–380 are a candidate's plan text that the PR left behind. So "misstates the Koios cost the rules require every feature to state" is true of the roadmap's lines only.
2. **The "someone at the gate" harm is small.** The owner agreed to the deferral, and the brief lists every PR with its item. The lasting risk is the second scenario: a release-prep commit that only flips the marks and leaves :378–380 describing a fixed bug and requests the wallet doesn't make.
3. **Item 4 isn't "unbuilt".** It shows half done (`🚧`). Three wallet items read as not started, and the fourth as half done.

**Adjacent, not this finding, already reported:** `architecture.md:732` still says a listed pool's "finished … are the server's word" and "on chain at all is the ledger's to judge, not the server's", and *What each costs* (:737) has no confirm cost. `reports/x-priv.md`, `x-docs.md#4`, `pr329.md#5` and `pr336.md` already report it. The same release-prep commit could fix both.

## Fix advice (refinements to the finding's)

- **Item 4 (:38) and :378:**
  - Name `bootstrap_back_reserve(params)`, with `BOOTSTRAP_BACK_RESERVE` as its 1.5 ₳ floor.
  - Drop "68 classic boxes, and 51 of LJTEST" as the current cap. At 6,465 lovelace a byte it's 96 and 64 since #333 (1.8 ₳ reserve).
- **Item 6 (:40) and :373:** state the calls as made. The offer comes an hour after the collateral mix's deposit (`TAIL_OFFER_MS`). The button is *Bring the rest back now*, and its line is `lj.tail.privacy.wayOut`.
- **:379–380:** state the cost as built, not "per launch":
  - One `tx_info` per up to 20 new launches (`TXS_PER_REQUEST`), and one `account_update_history` per up to 75 Ls, only those the launch didn't register.
  - It's asked at a list refresh (at most every 5 minutes, `REFRESH_MS`), and only for pools new to the device.
  - A pool Koios can't confirm isn't kept (`confirmed()` keeps nothing unconfirmed), so it is asked about again at each refresh until Koios confirms it.
  - Also say these go to Koios, not the data layer.
- **Item 7 (:41) and :374:** tick them, naming the stepper in the view and `tx-view.ts` following `partHashes`.
- **#338** needs nothing more. It changed only item 8, as the user said.

Confidence: high.
