# 1.8.1's fix round: balance

Lane `balance`, worktree `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-r181-balance` (detached at `2a8060d3`). Everything is uncommitted.

**In short:**

- **Two fixes, each test first:**
  - readers#1: a public mix's review and Mix again's say the account after with what the chain takes.
  - worker#5: a private Bootstrap reads no reward account.
- **25 new tests** (24 in `lovejoin-reward-balance.test.ts`, one in R9's screens block) **follow the balance through every flow that builds in a pool:** the read, the request, what's kept for Send, and the read again at Send.
  - Each was checked against a mutant of the line it holds: 31 mutants, every one killed.
  - Undoing each of the two fixes (4 more mutants) fails its own test again: 35 in the final run.
- **Left to the refusals lane, as the brief's note says:** T11b and T12c, which test the refusal's words. T12c isn't in that lane's list (below).
- **No i18n key added or changed, and no new file.** The one new field, `taken`, is kept where the review it belongs to is kept already: no new storage key and no new data handling.

## Files

- M `seedelf-platform/seedelf-web-wallet/extension/src/background/lovejoin.ts`
- M `seedelf-platform/seedelf-web-wallet/extension/src/shared/rpc.ts`
- M `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Lovejoin.tsx`
- M `seedelf-platform/seedelf-web-wallet/extension/tests/lovejoin-reward-balance.test.ts` (new describe blocks, between the reservation block and `type T`, and imports)
- M `seedelf-platform/seedelf-web-wallet/extension/tests/lovejoin-merged-screens.test.ts` (one `it`, in R9's block)

## readers#1 · fixed

**What changed:**

- **The summary,** `src/shared/rpc.ts:2264`: `LovejoinPublicSummary.taken?: string` is what the chain's first mix takes of its pool's `mix_logic` balance, which `change` brings into the account. It's absent when nothing is taken.
- **The worker,** `src/background/lovejoin.ts`:
  - `takenOf` (`:910`) sums the chain's `balances`, which are readsFor's amounts.
  - `publicBuild` (`:4906`, `:4921`) and `publicAgainBuild` (`:5084`, `:5097`) compute `balancesOf` once and spread it into the kept review (`:4931`, `:5105`) as before. They put `takenOf` of it on the summary.
- **The screen,** `src/ui/screens/Lovejoin.tsx`:
  - `publicAfter` (`:4011`) is Home's figure less `publicLeaving`, plus `taken`.
  - `PublicReview` (`:4051`) and `PublicAgainReview` (`:4118`) render `TotalRows` without `before`, then `AfterRow` with that figure. That's how MoveIn.tsx and Staking.tsx render their after rows.
  - The row and its test id (`review-after-public`) stay where they were, inside the review's rows. With nothing taken, its figure is unchanged, so e2e's `extension.spec.ts:3118` reads as before.
  - The Bootstrap's review is untouched: a Bootstrap reads nothing and takes nothing.
  - No line of its own names the take (backlog.md:51, chunk 43's call 1).

**Tests, each failing on `2a8060d3`:**

- **`lovejoin-merged-screens.test.ts:274`,** "with what its first mix takes of its pool's reward balance…": 100 ₳ on Home, two 10 ₳ boxes, 6.852214 ₳ of fees, and 500 ₳ taken.
  - It expects "Total leaving your public account 26.852214 ₳ Public account after 573.147786 ₳", and 593.147786 ₳ mixing again.
  - Before the fix it rendered "Public account after 73.147786 ₳".
- **`lovejoin-reward-balance.test.ts:261`,** "is named on its summary…":
  - A real `publicBuild` with no balance has no `taken` key, and one with 500 ₳ in the pool's account has `taken` "500000000".
  - Before the fix: `expected undefined to be '500000000'`.
- **`lovejoin-reward-balance.test.ts:621`** (Mix again), "takes it in its first mix alone, names it on its review…":
  - Before the fix its `toMatchObject` lacked `"taken": "500000000"`, and the rest matched.
- **Each half undone** (mutants R1a, R1b and R1ui) fails its test again.

## worker#5 · fixed

**What changed:** `src/background/lovejoin.ts:3838`, in `fanOut`'s attempt: `...(depth > 0 ? rewardsField(await this.rewardsOf(…)) : {})`.

- Depth 0 is only a Bootstrap's chain (or a seed's: none is built since chunk 34), whose deposit alone runs no script. Neither gets a collateral pool (`depositOnly`), so no tail loses its read.
- `balancesOf(c.rewards, …)` then names none, and Send reads none.

**Test:** `lovejoin-reward-balance.test.ts:336`, "reads none for a Bootstrap from the private balance either…" (v-worker-5's private case).

- It runs `mixOutBuild` with `bootstrap`, `mixOutSubmit`, the funding landed, then `advance`. The session's deposit goes, and no `account_info` names the pool's `mix_logic`.
- Before the fix: `expected 1 to be +0`. Mutant W5 (the fix undone) fails it again.

## The test gaps

Every test is in `tests/lovejoin-reward-balance.test.ts`, and passes on `2a8060d3`. The mutant texts are mutants.md's, moved onto the lines as they now stand. Each was run alone against the whole file and the file restored byte for byte, checked with sha256. "Killed by" lists every test that failed under the mutant.

### mutants#5 · fixed (`:229`, five unit tests on hand-made CBOR, from its repro)

| Mutant | Killed by |
|---|---|
| T3a (takingFrom without goingOut) | `:233` counts one it sent while its spend is held; `:238`; and the mainnet test `:370` |
| T3c (goingOut without either) | `:238` counts either of two that spend one coin |
| T3d (the last reservation, not the most) | `:242` |
| T4c (`read - taking` kept) | `:247`, which pins today's rule: 503 ₳ read with a 500 ₳ take on its way reads 0. The other figure is the owner's call. |
| T7d (`every` for `some`) | `:253`; and the across test `:510`, where only the token pool's balance moved and Send went |

### mutants#6 and worker#4 · partly (`:413`, a site's session one wave deep, real WebAssembly)

| Mutant | Line held | Killed by |
|---|---|---|
| T25 | lovejoin.ts:3838, a chain's read sent | `:421` takes it in its chain's first mix alone, read once, kept for Send; `:433`; `:446`; `:299` |
| T25b | :4046, a return across pools' read sent | `:510` across pools: the token pool's first mix takes 500 ₳, the 5 ₳ pool's 3 ₳, both kept |
| T9f1 | :3850, a chain's balances kept | `:421`, `:433`, `:446` |
| T9f2 | :4087, across, balances kept | `:510` |
| T9d2 | sessions.ts:4713, a return's chain, balances kept | `:421`, `:433`, `:446`, `:510` |
| T9b | sessions.ts:3279, backSubmit's read at Send | `:433` (StaleReviewError in `lj.rewardsMovedReview`'s words, nothing sent), `:459`, `:474`, `:510` |
| T9c | sessions.ts:3352, claimSubmit's read at Send | `:446` (`failed` with the stale review's words, nothing sent) |
| T19 | sessions.ts:4746, a direct return's tail, rewards passed | `:459` comes back directly, its collateral's mix taking it |
| T9e | sessions.ts:4800, a direct return's tail, balances kept | `:459` |
| T17 | lovejoin.ts:4506, the collateral's mix built again, rewards passed | `:474` (a lock cut the chain; tailChain builds that mix again on 500 ₳) |
| T17b | :4512, built again, balances kept | `:474` |
| T9d1 | sessions.ts:4593, the tail's resumption, balances kept | `:474` |

**Not done here: T11b** (sessions.ts `pump`'s `REWARDS_MOVED`), and worker#4's "session chain stopped by the refusal". Both test the refusal's words, which the brief's note gives to the refusals lane, and they land with worker#1's rethrow there.

### mutants#7 · partly

**Mix again (`:586`),** from a public mix cut after its deposit, its two boxes in the 5 ₳ pool:

| Mutant | Killed by |
|---|---|
| T24 (the balance never read) | `:621` (its first mix takes it, and the review names it) and `:631` (moved before Send: StaleReviewError, nothing sent) |
| T9g2 (balances not kept) | `:621` and `:631` |

**The paid ways back (`:644`):**

| Mutant | Killed by |
|---|---|
| T26b (account-paid, rewards not passed) | `:655` (withdraws 500 ₳, read once) and `:664` |
| T12d (the rebuild forgets `paid`) | `:664`: refused once as the balance moved, rebuilt once, both paid by the account with the same inputs, and giveme.my never asked |
| T26c (private-paid, rewards not passed) | `:683` (a private UTxO beside the box, and 500 ₳ withdrawn) |

**Not done here: T12c** (`withdrawOne` refused twice, said in Lovejoin's words). It tests the refusal's words, which the brief's note gives to the refusals lane. Its report lists publicSubmit, backSubmit and claimSubmit, not this. The test is Bring one back now, refused twice, rejecting with `REWARDS_MOVED()`. For the lead.

### mutants#8 · fixed (`:272`)

| Mutant | Killed by |
|---|---|
| T21 (a failed account_info fails the build) | `:280` (builds as before, on none, its read kept `unread`) and `:289` (the read again at Send unanswered: Send goes) |
| T22 (never marked unread) | `:280` and `:289` |
| T8a, T8b (a pool read again each try) | `:299`: a session's return, four a mix refused (D3's fallback to three), its collateral's mix in the same pool, read once |
| T8c (one pool named twice, read twice) | `:299`, `:421` and `:510` |
| T18 (a public Bootstrap reads) | `:328` |
| T8d (mainnet's header `f0`) | `:370` |
| T14c (holdOnly drops the held step's take) | `:385` |

- **How `:370` holds T8d without trusting the header:** on each network, `rewardsIn` must name the account by the bytes of WebAssembly's own bech32 for it (`bech32Bytes`): `f0…` on preprod, and `f1…` for mainnet's head-start pool `fcb3f5ec…`, L `a6a85074…`. A hand-made transaction of the wallet's on its way there that takes it all must then read as 0.
- **How `:385` holds T14c:** a public mix stopped at its first mix, which may have gone through, keeps `{ inputs, collateral: [], takes: { f0…: "500000000" } }`. Once 16 later chain sends push that mix out of the sends the wallet keeps (`sent-txs.ts` KEEP), the read is still 0.

Also checked: **T9g1**, publicBuild's balances, the line readers#1's fix moved. Three tests kill it, the existing Send test among them.

## For the lead

- **Merging `lovejoin-reward-balance.test.ts` with the refusals lane:**
  - Their hunks are at the original `:139-155` and `:207-280`. Mine are the import lines and the block inserted after `:175`, so the patches apply side by side.
  - Their new `refusing(t, refusal, count, then)` breaks my one call, at `:668` (`refusing(t, 1, () => holding(t, 0n))`). The merged form, in their style:
    ```ts
    it.each(NOT_IN_REWARDS)("paid by the public account and refused as the balance moved at %s, is built again once, paid by the account again", async (_, refusal) => {
      …
      refusing(t, refusal, 1, () => holding(t, 0n));
    ```
    That runs T12d's case at protocol version 10 and 11. Version 11 is live, and with readers#4's match this rebuild runs on both networks for the first time (their note 5).
  - I added `import { readFileSync } from "node:fs";` at the top, for the v2 token pool's fixture, as every other test file loads it. They didn't touch the import block.
- **Docs, for the docs lane's lines:**
  - `backlog.md:51` is true again: a public mix's review now counts what comes back (their readers#1 item).
  - `architecture.md:749` (guard#6's cost line) and `privacy.md:236` (guard#7's) say a read is made before "each build in a pool". A Bootstrap's build makes none now, public or private, and the public one never did.
  - The policy's 6 November entry ("before the wallet builds a Lovejoin mix, or brings one of your boxes back") stays true, since a Bootstrap is neither. No new dated entry: this is one read fewer, no new data.
- **T11b and T12c** are uncovered after this lane (above). T12c is in no lane's list.
- **Untouched, per your calls:** readers#2, readers#3, worker#2 and worker#3 (the race, as backlog lines). Nothing here changes `takingFrom`, `balanceAfter`, `reserve` or what a reservation takes.
- **Scratch:** the runner `SCRATCH/balance/mutate.py`, every mutant's exact text and verdict, and its logs `SCRATCH/balance/mutants.jsonl` (the final run) and `mutants-first.jsonl` (the run before the tests' last edits). There was one throwaway probe, `tests/zz-r181-balance-probe.test.ts`, which showed mainnet's pool verifies in WebAssembly. It's deleted.

## Ran

- **The two test files I touched, in full:** `npx vitest run tests/lovejoin-reward-balance.test.ts tests/lovejoin-merged-screens.test.ts`. 2 files, 57 tests, all passed, three times under `taskset -c 2,3`, about 22.8 s each. Every test runs in about a second, against `CHAINS`' 60 s.
- **`npm run typecheck`:** clean (tsc 7, tests included).
- **The mutants:** `python3 SCRATCH/balance/mutate.py <ids>`, 35 in the final run, all killed, and every file's sha256 the same afterwards.
- **The neighbours,** by name: the files that render PublicReview, build a Bootstrap, or read a pool's `account_info`, plus the public-mix and share-review files.
  - The 24 files: `collateral-reserve-review-fixes`, `lovejoin-1-5-0`, `lovejoin-accounts-page`, `lovejoin-crediting-review-fixes`, `lovejoin-flows`, `lovejoin-form-review-fixes`, `lovejoin-hub`, `lovejoin-merged-review`, `lovejoin-planner`, `lovejoin-release-rules`, `lovejoin-retired`, `lovejoin-retire-review-fixes`, `lovejoin-screens-review`, `lovejoin-session5-screens`, `lovejoin`, `review-layout`, `review-totals-incoming`, `screens`, `screens-wiring-review-fixes`, `sessions-review-fixes`, `lovejoin-accounts`, `public-mix-maybe-hold`, `public-mix-mark`, `lovejoin-share-review-fixes`.
  - 672 tests, all passed.
- **Nothing else:** no build, no e2e, no network, nothing in the main tree but this report.
