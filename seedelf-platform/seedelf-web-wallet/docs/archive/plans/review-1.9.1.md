# 1.9.1's release review, its fixes and the gate (2026-11-14)

**Status: ✅ done, the gate for 1.9.1.** It's on branch `web-wallet/release-1.9.1`.

The working folder, `docs/plans/review-1.9.1/`, was compressed into this file when the PR was ready. Its full text is in git at `d7c2b0c2`:
- the briefs (REVIEWBRIEF, R2BRIEF) and the lead's FINDINGS;
- round one's six lanes' reports and the critic's;
- round two's four (`r2-*.md`) and the last look's (`last.md`).

[The IDs](#the-ids) says where each family is. What still holds is in the design docs, and what's left open is a line in [backlog.md](../../backlog.md).

## The review

**What it covered:** every PR since `web-wallet/1.9.0` (`c0b451a8`), as one tree at `3063b33f`.
- **#384:** a chain of parts ends once its payment is paid, from a bounty report against 1.9.0: the part that sent a payment's last tokens carried its ADA on, and one more part paid an output of ADA alone that wasn't asked for.
- **One light pass each:**
  - #379 (1.9.0's record);
  - #381 (the verification: all three Seedelf scripts in every transaction, kernel-checked; and its wallet docs), #382 (chunk 46's plan) and #383 (chunk 50's plan);
  - the prep, `36d90389`.
- **#380 is the owner's guards against prompt injection.** Not reviewed: it touches nothing the extension builds.

**How:**
- **Six lanes in round one:** chain-rust (#384's `chained`, path by path), shapes (a brute-force hunt with an upper bound on what parts pay), ts-parts (the extension's side), tests (mutants of #384's tests), docs and verification (the claims against the Lean statements), then a completeness critic.
- **Round two,** four lenses on the fixes where they meet the rest: the planner, the extension, the tests and the docs.
- **The last look** on what landed after round two.
- No lane sent a transaction, built `seedelf-verification/`, or ran anything in `seedelf-data/`.

**31 findings in round one: one medium, 18 low and 12 nits.** The lead checked each fixed code finding with a test that fails without its fix.
- **M1 (medium; shapes#1, critic#4): an amount whose tokens take three parts or more paid one output's least too many for each part past the second.** A part that could pay more than was owed left the parts of tokens after it one least (`keep`), but each of them paid its own. It takes an ask above (P − 1) token-output leasts: 42 Lovejoin boxes of a token go in two parts and never overpay, but with shapes#1's token 61 boxes and 50 ₳ paid 51.63 ₳, 90 paid 54.88 ₳, and 150 paid 59.78 ₳. The review showed the total with no note. Since 1.6.0.
- **L1 (chain-rust#1, critic#3, ts-parts#1): a carry no later part spends was in no figure.** A chain's last part, over the carry and what's left, spends as few of them as pay, so it can leave the carry (since 1.6.0); #384's end after a carry is a second path, unreached from any full request. A funding's privacy note named 2.09 ₳ of private change tied to the one-time account where 3.59 ₳ was, and in a second shape 65.26 ₳ where 67.44 ₳ was.
- **#384 is sound.** Its test fails on 1.9.0 and passes after. Over 3,708 requests a build, 1.9.1 refused nothing 1.9.0 built, nor planned more parts or paid more, and 139 that 1.9.0 refused go in one part (chain-rust). Over 3,585 bounty-shape runs: no part after the payment was paid, no top-up, no overpay; 1.9.0 had 167, 562 and 39 (shapes).
- **The rest:** test gaps (#384's end after a carry, its `owed == 0` and its funding's first-and-last part had none; its bound held for 1.9.0's plan; the vault check could fail by chance), two older limits of picking, the docs' facts and the verification's claims. [FINDINGS](#the-ids) has every row.

## The lead's calls

- **M1:** plan again, not restructure. What a part spends doesn't turn on what it pays, so `reserving` plans a payment again where its parts pay more than was asked and their token parts' leasts, each part leaving the leasts of the parts of tokens after it as the first plan made them. The second plan goes only where it takes less from the Seedelf balance, in no more parts and no more carries.
- **L1:** count the carry, don't change the plan. A kept carry is change in every way: an output of ADA alone to a fresh re-randomization of the wallet's own key. A measured fallback for a funding's amount would close #384's path to it, but it would retry on the balance's 20 largest UTxOs and merge other sessions' money (critic#5), so it wasn't taken.
- **#384's end after a carry stays,** as a guard: dropping it brings the report's extra part back (critic#1). Its comment says what reaches it, and a test inside lib.rs pins it.
- **Not fixed, as backlog lines:** picking's biggest holder of each token (core's `holding`: changing it changes the CLI's too), a chain's short last part of tokens (tests#1), and M1's windows (round two, below).
- **The verification's docs were fixed in their own commit,** `23ca5f20`, text only, so it can be dropped: a wallet pass has left them before. The count in chunks 46 and 49 ("342 files" against 339 tracked) is left for a verification pass: it may include generated modules.

## The fixes

The lead fixed in a worktree of `36d90389`, test first; each fix's test fails without it and passes with it.

| Commit | What | Findings |
|---|---|---|
| `c3d24629` | `reserving` and `taken` (a second plan with each part's reserve); `in_parts` takes `reserve`; `carry_kept` (a carry no later part spends is its part's change); `whole`'s least only where every part sends tokens; the structural vault check; tests; the parts suite's upper bound; architecture.md, flows.md, privacy.md, wasm/README.md, two backlog lines | M1, L1, ts-parts#2, ts-parts#3, tests#2, #3, #4, #7, chain-rust#2 |
| `af32b1aa` | the chunk plans' facts | docs#2, #3, #4 |
| `23ca5f20` | the verification's docs, text only | verification#1 to #5 |
| `9aa3e8bc` | the critic's second unspent-carry shape, and what reaches #384's end | critic#1, #3 |
| `3a7d7b1f` | round two's follow-ups | r2-* (below) |
| `ddc6d07b` | the last look's follow-ups | last#* (below) |

The tests, each named in its commit: the token boxes (61 and 90, to a Seedelf and to an address) pay exactly 50 ₳; two shapes' kept carries (funded and withdrawn) balance what the parts spend against what they pay, their fees and their counted change, and count each part's change outputs; a funding chain's first part that is its last pays the collateral once; an amount the balance can't pay is refused, never paid in part; #384's test pins one part paying the tokens' least or what was asked; `chain_end_tests` builds a funding's chain that ends on its carry; the review's least; the vault holds one record, `{version, blob}`, which opens to the phrase's entropy.

## Round two

Four lenses read the fixes where they meet the rest. They found 11: 2 low and 9 nits.
- **r2-planner** swept 7,938 requests a build, before and after: nothing refused that went before, no plan with more parts, more paid, more taken or more parts waiting; 697 changed, 696 of them paying less (1,923.06 ₳ in all). Its two:
  - **#1 (low, older):** where a part's smaller payment would leave its change under an output's least, the second plan can't go unless another split of the tokens goes in as many parts and carries, and the first plan's overpayment stays: a window about 1.46 ₳ wide at each part boundary, 1 to 2 % of the asks where a token takes three parts or more (90 boxes and 95 ₳ pay 98.52 ₳, two leasts over). Not a regression: 1.9.0 pays the same there. `reserving`'s doc and architecture.md now say so, and a backlog line has the way to close it: pay all but the change's least there, the parts after it taking the rest. It would also end the first plan's needless chain in its own windows (150 boxes and 90 ₳: 7 parts wait).
  - **#2 (nit):** nothing checked a kept carry's output count. The carry test now does.
- **r2-extension:** the funding review through the worker, with the real WebAssembly, now names 3.588088 ₳ of private change (2.085198 ₳ before); every consumer of the least and of the change says something true; the whole Vitest suite passes on both builds. Its one: **#1 (low, older)**, two Argon2id-heavy tests beside the vault check could run out of Vitest's 5 s on two CPUs.
- **r2-tests:** every fix's test fails with its fix reverted alone and passes with it (the refusal test is a guard on `owed == 0`, which 1.9.0 passes too), and none is flaky (`chain_end_tests`' window is 9,468 to 9,589 lovelace wide over 30 runs: SPEND_BUDGET_GUESS less the measured budget). Its five nits: the suite's bound claimed the bounty, which no suite shape reaches; it would misread a funding's collateral; #384's test could pin its plan; `chain_end_tests` named a collateral its chain never pays and would call a moved window closed; and the password-change test compared two undefined creation times.
- **r2-docs:** three nits (a citation, flows.md's condition, the backlog's order).

All 11 were fixed or recorded in `3a7d7b1f`.

## The last look

One reader on what landed after round two (`9aa3e8bc`, `3a7d7b1f`) found 8: one low and seven nits, fixed in `ddc6d07b`.
- **last#3 (low):** no test reached `reserving`'s guard, which alone keeps a second plan from chaining in r2-planner#1's windows: taking any second plan passed every test while 90 boxes and 95 ₳ went as four waiting parts. A test now holds both halves (no carries there, and 100 boxes with a UTxO of ADA alone stay five parts), and fails without the guard.
- **The nits:**
  - where the windows are: with a UTxO holding none of the tokens left, the second plan can split them otherwise, so the window is only where no other split goes in as many parts and carries (last#1);
  - what they cost: one least for each part of tokens after the first that follows the part paying all but one least, so 90 boxes and 95 ₳ pay two leasts over, not three (last#2);
  - FINDINGS had no round two (last#4); one token's figures throughout (last#5); a 208-column doc line (last#6); `chain_end_tests`' last message names both causes (last#7); the backlog's line for a chain's short last part says what taking it would need (last#8).
- It confirmed each of round two's and the critic's dispositions, with their mutants.

## Left open

In [backlog.md](../../backlog.md), from this review:
- picking's biggest holder of each token (shapes#2, tests#5);
- M1's windows, where a part's smaller payment would leave its change under an output's least (r2-planner#1);
- a chain's short last part of tokens (tests#1).

Recorded, not backlog lines:
- #384's amount-first part after a carry is unreached (critic#2): every chain it ended was one part. A carry it left would be counted (`carry_kept`); taking tests#1 would make it reachable, and need its test.
- The parts suite's bound is relative to the plan's own split of the tokens (r2-tests#3); api_test's part counts pin the split.
- For a verification pass: the "342 files" in chunks 46 and 49 (docs#5).

## The release prep

`36d90389`:
- 1.9.1, and development.md's blocks name it.
- Tokens unchanged (2 preprod, 32 mainnet).
- **The data layer's token decimals gain one:** the registry's HIVE (CIP-68, 6 decimals), 1,176 now. **So the API is deployed after the merge, before the package.**
- Preprod's 67 named DReps only move their date. **Mainnet's weren't refreshed:** Koios's mainnet answered 429, 503 and closed sockets all session, so the list recorded on 2026-11-10 stands.
- The Lovejoin pools' head start moves mainnet's height, with no new pool, so no Cardanoscan names are owed.

## The checks

On the final tree, `ddc6d07b` (the working folder and this record add only docs):
- **Rust:**
  - `cargo fmt --all --check`;
  - clippy `-D warnings` on seedelf-crypto and seedelf-wasm;
  - the workspace's 790 tests, 12 ignored: 1.9.0's 783, #384's one, and six from this review;
  - the parts suite (`--ignored`, release): 0 with problems, 108 refused, none of them Max.
- **The WebAssembly,** rebuilt from the fixes (`C compiler: Ubuntu clang version 21.1.8 (6ubuntu1)`), and node's 59 tests over it.
- **tsc** clean.
- **Vitest:** 3,306 on both builds, 4 skipped (3,304 at `3063b33f`).
- **e2e:** 109 passed on the dev build and 109 on the store build, each with the found-later test skipping by design, and the data layer's 3.
- **Relative links:** none broken in the docs this branch touches, this record and the working folder.

## The live runs

On preprod, with test wallet A, on the dev build of `3a7d7b1f` (what landed after it changed only tests and comments):
- `LIVE_KOIOS=1 tests/live.test.ts`: 2.
- `e2e/live/run.mjs all`, six transactions, all confirmed: a mint paid from the account (`15e48b5a…`), a move-in of 25.5 ₳ (`baa37639…`), a stealth mint (`b368055a…`), a transfer of 3.3 ₳ (`e2424f3e…`), a withdrawal of 5.5 ₳ (`5ead8b5e…`) and a removal (`7383a552…`). It contacted preprod.koios.rest and www.giveme.my alone.
- `e2e/live/run.mjs staking`, four, all confirmed: TPREP (`0a026b01…`), no confidence (`bec56b86…`), always abstain (`f6c1ce43…`) and LOGIC (`f2ae5ef3…`).
- **None of these is a payment in parts,** which is all the fixes change: a payment one transaction takes returns before the planner runs. One in parts needs a token over more UTxOs than two parts take, which wallet A doesn't hold, so the fixes' plans were checked natively and through the worker with the real WebAssembly (r2-extension).

## For the owner

After the merge, in order:
1. **Deploy the API** (Actions → *Data layer deploy*, `deploy`, on `main`), then part 2's curls: the token decimals changed.
2. **Package on `main`** (part 2's block reads 1.9.1 from `package.json`), the e2e on the store build, the second build, then upload. The listing's text is unchanged, and no images are owed: no screen in them changed.
3. **Tag** `web-wallet/1.9.1` on the commit the zip was built from, and record it in `docs/releases.md`.
4. **No privacy-policy entry:** nothing the wallet sends, keeps or reveals changed. A funding's note now names all the private change it ties.

Your calls, whenever you choose:
- `23ca5f20`, the verification's docs, if you'd rather they waited for a verification pass;
- the three backlog lines, the first of which would change the CLI's picking too;
- mainnet's DRep list, if you want it refreshed before the merge: four days old.

## Lessons

- **Fix the class, not the report's shape.** #384 fixed the reported trailing part; the same class, parts paying what wasn't asked, had an older and larger member in `in_parts`, found only by a sweep with an upper bound on what parts pay.
- **A test suite that bounds a payment from below only can't see an overpayment.** The parts suite checked only paying less; its bound now goes both ways, relative to the plan's split.
- **Every output a plan keeps is someone's figure.** A carry no later part spends was change that no figure counted, and a privacy note said less than was true.
- **Planning twice is a safe fix where what's spent doesn't turn on what's paid,** and its limit is where it does: a payment that would leave change under an output's least, where the tokens must split otherwise. A guard that keeps the first plan needs a test of its own.

## The IDs

The code, the tests and the docs cite these by ID. Their full text is in git at `d7c2b0c2`, under `seedelf-platform/seedelf-web-wallet/docs/plans/review-1.9.1/`.

| IDs | What | File at `d7c2b0c2` |
|---|---|---|
| `chain-rust#`, `shapes#`, `ts-parts#`, `tests#`, `docs#`, `verification#`, `critic#` | round one's 31 | the lane's report (`chain-rust.md` and the rest, `critic.md`), and `REVIEWBRIEF.md` |
| `M1`, `L1` to `L8`, `N1`, `N2`, `C1` to `C3`, `D1` to `D6`, `V1` to `V5` | the lead's clusters | `FINDINGS.md` |
| `r2-<lens>#<n>`, cited as "1.9.1's review of its fixes, …" | round two's 11 | `r2-*.md`, and `R2BRIEF.md` |
| `last#<n>` | the last look | `last.md` |
