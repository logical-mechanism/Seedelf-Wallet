# 1.8.1's release review, its fixes and the gate (2026-11-07)

**Status: ✅ done, the gate for 1.8.1.** It's on branch `web-wallet/release-1.8.1`.

The working folder, `docs/plans/review-1.8.1/`, was compressed into this file when the PR was ready. It held the briefs and every finder's, verifier's and fixer's report, round two's and the last look's, and the back-translations. Its full text is in git at `e96e57db`, and [The IDs](#the-ids) says where each family is. What still holds is in the design docs, and what's left open is a line in [backlog.md](../../backlog.md).

## The review

**What it covered:** every PR since `web-wallet/1.8.0` (`497da3a3`) bar #366, 1.8.0's record. That's #367 and #368, as one tree on `main` at `d190f717`, then the release prep `2a8060d3`.
- #367 is chunk 43. Lovejoin's transactions take whatever sits in their pool's `mix_logic` reward account, and the dApp signer refuses a site's transaction that pays into one.
- #368 is chunk 45: Lovejoin v2's `mix_logic` and `one_shot_mint` in every transaction, kernel-checked, in the Aiken source's terms, and `seedelf-verification/CLAIMS.md`.

**How:**
- **Nine finders:** core, worker, readers, guard, mutants and money on #367; fidelity, trust and claims on #368.
- **Six verifiers:** a trace and an impact verdict on the medium, readers#4; traces on #367's behavioural lows (v-worker, v-readers, v-guard); and a completeness critic.
- **#368's findings** were docs and claims, checked while fixing with no refuters, as a docs PR's are.
- **The build:** the lead built #368's 25 modules capped, all ok. The heaviest, Collect, peaked at 12.8 GB.

**60 findings, none high:** 52 in round one (2 medium, 36 low and 14 nits) and 8 from the verification.

- **readers#4 (medium):** since protocol version 11 (mainnet epoch 644, preprod 294), the ledger refuses a withdrawal that isn't the account's whole balance as `ConwayIncompleteWithdrawals`, in LEDGER, not as `WithdrawalsNotInRewardsCERTS`. So #367's `RewardsChangedError` never fired, and staking's "rewards changed" words had never shown since the hard fork. Both its verifiers graded it low, since nothing is lost and nothing stuck; the critic graded it medium. It's fixed either way.
- **claims#1 (medium):** CLAIMS.md said the CEK model "is tested against the Plutus conformance suite", where IOG's README says "working toward conformance". It never named the fork the proofs run on.
- **What the verification added:**
  - stakingRefusal's DELEG names, dead at PV11 too (v-pv11-trace#1, v-pv11-impact#1);
  - Ogmios never names an unknown input in an evaluation (v-pv11-impact#2);
  - the guard's set told a site whether the wallet holds boxes in a copy pool (v-guard#1);
  - the critic's four: README's scope for Audit/, CLAIMS.md silent on Seedelf's results being Z3's word, development.md's `release_version` left at 1.8.0, and the AnyTx README's opening.
- **#368's proofs held:**
  - No `sorry`, axiom or `native_decide` in the 25 modules.
  - The guards cover the headline iffs: through the `_valid` forms, and now by name too.
  - The readable definitions match the Aiken source at `29573c5`, handler by handler.
  - The Lean template hex is core's `Set::V2` byte for byte, and applied it gives mainnet's live v2 5 ₳ pool (`fcb3f5ec…`).
  - It backs #367: `mix_logic`'s withdraw handler never reads the withdrawal's amount.

## The lead's calls

- **Not fixed, backlog lines:**
  - **The race for a balance between two of the wallet's own transactions in one pool** (worker#2, readers#3, readers#2, worker#3). Every fix proposed moved the refusal elsewhere, and two of them conflict. Only an order fixes it, and that's the owner's to pick.
  - **guard#10.**
- **v-pv11-impact#2 was reverted in round two,** not patched (below).
- **The policy's date is the owner's** (r2-docs#1), as 1.7.0's was.

## The fixes

Six fixers worked by file ownership, each in a worktree of `2a8060d3`, test first:

| Lane | What | Findings |
|---|---|---|
| refusals | `WITHDRAWAL_REFUSED` (`WithdrawalsNotInRewards`, `IncompleteWithdrawals`, `WithdrawalsMissingAccounts`) decides `RewardsChangedError`. Staking's words go by PV10's and PV11's names: `WithdrawalsMissingAccounts` as `changed`, checked before `NotDelegatedToDRep`. DELEG's PV11 and ledger-1.24 names are anchored, so GOV's `ProposalDepositIncorrect` stays the node's own words. A chain refused for the balance is rethrown in Lovejoin's words. Also v-pv11-impact#2's naming, reverted later | readers#4, worker#1, v-pv11-trace#1, v-pv11-impact#1, v-pv11-impact#2 |
| balance | A public mix's and Mix again's *Public account after* count what the chain takes. A Bootstrap reads no reward account. Tests for lovejoin-rewards.ts's five rules, a session's return, Mix again, the paid ways back, and the read's own rules | readers#1, worker#5, mutants#5–#8, worker#4 |
| guard | The guard's set is the classic pool plus every pool discovery keeps (`everyKept`), whatever the wallet's boxes. `DappDeps.lovejoin` is required. Tests for a private session, a proposal's return and a treasury payee | guard#1, v-guard#1, guard#3, mutants#9 |
| rust | v2 takes a balance in every kind and pays the ledger's fee. Each WebAssembly request's `rewards`. A refused withdraw takes nothing, and Mix again's take leaves the caller's `Rewards`. A proposal's return is in `paidScripts`. `Rewards::of` keeps the last entry for a hash. `lovejoin_proven_bytes_test.rs` | core#1–#3, money#1–#2, mutants#1–#4, trust#1, claims#2 |
| verif | CLAIMS.md's *Where it stops*; README's hypotheses, its standard command with `lovejoin-every`, Audit/'s scope. check.sh's 51 prerequisites, and its caps for a module named alone. Readable.lean's guards on the base iffs. `Lovejoin/Every/README.md`. Chunks 42 and 45 archived | claims#1–#11, fidelity#1–#3, trust#2–#4, critic#1, #2, #4 |
| docs | The privacy policy's body; architecture.md's diagram, cost line and refusals; privacy.md, `seedelf-platform/CLAUDE.md` and the wasm README; chunk 43's record; backlog.md; development.md part 1 at 1.8.1 | guard#2, guard#5–#9, mutants#10, readers#1's line, critic#3, the race's and guard#10's lines |

The lead merged them with no conflict. Edits at the merge:
- one call in `lovejoin-reward-balance.test.ts` joined the two lanes' forms;
- a new test (T12c, which no lane held): a box's way back refused twice says so in Lovejoin's words;
- CLAIMS.md and `CLAUDE.md` name the new byte test;
- architecture.md names the DELEG refusals whole.

The suites, by the numbers:
- Rust: 713 at 1.8.0's gate; 744 after round one and 745 after round two, with #367's tests and this review's.
- Vitest: 3,208 on #367's tree with the prep, 3,261 after.

## Round two

Six lenses read the merged fixes where the lanes meet: the worker, the screens and words, the tests by revert and under load, the Rust, the docs, and a last look. They found 24: 13 low and 11 nits.

- **Three were regressions from v-pv11-impact#2's fix.** Naming a stale answer's input reached three paths that had never run on a real answer:
  - tailWitness's `ours` (r2-worker#1): a collateral's mix whose box another wallet drew waited a day, its return held;
  - unstale's avoid set, into Mix again's own boxes (r2-worker#2, r2-tests#1): a false "none of your boxes", or a private Mix again given up.
  - The fix was reverted, not patched: its benefit shows only on preprod or with Koios as a fallback. It's a backlog line.
- **r2-screens#1:** readers#4's match had put staking's words on a refused withdrawal from a script's account, such as a Danogo pool's withdraw-zero. Staking's words are now only for a key's account (`KeyHashObj`); a script's account keeps the network's words, and still the type.
- **The rest:**
  - r2-last#1: withdrawOne's rebuild options were untested.
  - r2-tests#2: three tests ran within a second of Vitest's 5 s under load, so they're now `SLOW`.
  - r2-rust#1: fees with two keys signing were untested.
  - Docs.

Three fix-up lanes (worker, rust, docs) made them, with a second blind round for the warning's new frames.

## The last look

- **The code part found nothing.** The revert is complete, and each new test fails under its mutant.
- **The docs part found three nits, which the lead fixed:**
  - the retired pools' run as "1.8.0's" in eight more lines (now "1.8.0 or later", for a profile updated straight from 1.7.2);
  - the backlog lines, now saying what the user sees;
  - the probe line, now noting that the head start's pools are known to every device.

## Left open

In [backlog.md](../../backlog.md):
- **The race for a pool's balance** between the wallet's own transactions: four lines, the owner's to order. worker#3's was seen in this review's live check.
- **The 'Koios behind' rules never see a name:** the reverted v-pv11-impact#2.
- **guard#10.**
- **Chunk 43's three:** the review line, an address's stake part, and rebuilding a cut chain.

Left as they are:
- r2-docs#13, a comment in `Lovejoin/Template/Scripts.lean`: any edit there rebuilds every Lovejoin module.
- The two AnyTx modules in no check.sh family (`LogicOwnerPrefix`, `LogicOwnerParserReach`).
- The `KeyHashObj` gate reads the whole answer. A script's withdrawal refused beside a failure that names a key's address keeps staking's words, but no transaction of the wallet's is built that way.

## The release prep

`2a8060d3`:
- 1.8.1.
- `npm run tokens`: unchanged. The data layer's token decimals: unchanged (1,175), and nothing under `seedelf-data/` changed, so there's no API deploy.
- `npm run dreps`: mainnet 466 named (one kept as committed), preprod 63; only the dates moved.
- `npm run lovejoin-pools`: mainnet's v2 5 ₳ pool (`fcb3f5ec…`, launched at block 14,167,059), so mainnet's head start holds two pools; preprod's five are unchanged. With it bundled, the e2e's "a 5 ₳ pool launched after the head start on mainnet" test skips, as it was written to.
- `npm run lovejoin-registry`, given no file, prints 8 mainnet entries: the 8131b1d 5 ₳ pool's four, still unsent, and the v2 pool's four ("Mix Box v2 (5 ADA)" and the rest, version 3).

## The translations

`lj.warn.rewardsMoved`, critical since chunk 43, was back-translated blind in es and ja, a fresh agent a language with no English in view, in two rounds: its first three frames, then the five that worker#1's rethrow put it in. Every clause held and nothing drifted. The notes were about what the English leaves open too (its "it", "as it was sent") or about older frames. Both verified files record the round.

## The checks

On the final tree:
- **Rust:** fmt, clippy `-D warnings` and the workspace's 745 tests; `payment_parts_shapes_test` in a release build, 215 s.
- **Lean:** `./check.sh lovejoin-every`, 76 ok (the 51 prerequisites, then the 25), Readable's new guards included. No Lean source changed after it.
- **The WebAssembly** rebuilt (`C compiler: Ubuntu clang version 21.1.8 (6ubuntu1)`).
- **tsc** clean.
- **Vitest:** 3,261 on both builds. In one run on a loaded machine, restore-scan.test.ts timed out once; it takes 1.6 s alone and passed on the quiet rerun.
- **e2e:**
  - 108 passed on the dev build and 108 on the store build, each with the found-later test skipping by design. The store build was built as CI builds it, without package.mjs in the main tree.
  - The data layer's 3.

## The live run

A dev build of the final tree, on preprod. Every transaction was read back from Koios.

| What | Transactions |
|---|---|
| **The PV11 refusal, end to end.** Wallet A, its `account_info` for 47bece42's `mix_logic` faked to 1 ₳ (two reads: the build's and Send's; the driver's route). A public mix of one box: the review carried the take. Send read again and passed. The deposit was accepted. The real node refused the first mix with HTTP 400, `ConwayIncompleteWithdrawals (… ScriptHashObj (ScriptHash "7a9d5bbf…") … Mismatch (RelEQ) {supplied: Coin 1000000, expected: Coin 0})`. The wallet answered "The network refused it: Lovejoin's pool changed as it was sent. Nothing was lost.", and the chain stopped after its deposit, 1 of 5, in those words | deposit `2aa41377…` |
| **Bring one back now** on that box, with one faked read. Koios answered the first submit 500 ("Something went wrong"), so the wallet held it as maybe sent. Each resend got the node's 400 `ConwayIncompleteWithdrawals`, which a resend ignores: worker#3's two-hour hold, here reached through a Koios 500. The withdraw never landed, and the box waits in the pool, A's, until the hold ends | `9383d1f8…` (never on chain) |
| **The release harness:** `e2e/live/run.mjs all`, six transactions, all confirmed; only `preprod.koios.rest` and `www.giveme.my` were contacted | `e498a78a…`, `497cb014…`, `e199e172…`, `501920a8…`, `96374195…`, `e064d698…` |
| `e2e/live/run.mjs staking`, four transactions, all confirmed; only `preprod.koios.rest` was contacted. `LIVE_KOIOS=1 tests/live.test.ts`: 2 | `5b799742…`, `f9184e84…`, `cb293178…`, `291d5621…` |

The full hashes:
- **The PV11 check:**
  - the deposit `2aa41377732331a1c4b22c912bccba61618b4f33831cd6403b0dca0a30d4d213`;
  - the held withdraw `9383d1f8419000efefb32f99ff701f225f2d6979be0b904c9ca5656bef6d8dea` (refused, never on chain).
- **`all`:**
  - `e498a78a030884b3dc6e2b3a6e9b32bb6e49c2340ca7a658ffc63ff0e6030df6`
  - `497cb0143bbfc36b6a4f293f5c96aedfb42bae10afe8a714c89ead70a2d4909a`
  - `e199e17201fe519f1164899c00a72233c116f8c74f3814641f395d73bbb4c5d2`
  - `501920a8bbb1352f8575ff4461c75c33cb6a4e4c3bd1e5d8ec71fe9b7890b41b`
  - `963741950aa62bd7d7635093839c9b6a5bedeac00687d12b710f3ae568f4aa47`
  - `e064d69812521d3ef798710a70fd5cc5e0722d981a6740a0652941ca2ff35d0f`
- **`staking`:**
  - `5b799742132d67c9c5f6fa72562969bf80cd972ece5a8b395e947d20b34840ac`
  - `f9184e847a6f3761fe5a95d462863e97902e8abc1ba6fc04ed250de36ad91db8`
  - `cb293178288ebf36fc99630b42d8e01704535e18c3b303301fbe8c0608df4a8c`
  - `291d5621395424a1642009a50cdc718df8a639764c7804e1bd6d1eb248ef1975`

The rebuild-once path wasn't reached live, since the first refusal came as a 500. Its unit tests hold it with the node's exact body, now rendered `Mismatch (RelEQ)` as the live answer showed, at PV10 and PV11. The edge case's live run with a real balance stays declined (the owner's call).

## For the owner

After the merge, in order:
1. **No API deploy:** nothing under `seedelf-data/` or in the token list changed.
2. **Package on `main`** (part 2's block reads 1.8.1 from `package.json`), then upload. The listing's text is unchanged. Tag `web-wallet/1.8.1` on the commit the zip was built from, and record it in `docs/releases.md`.
3. **The policy's date:** its 6 November entry and its *Effective* line. This PR rewords the entry's last clause and adds a sentence to the body. Move both to the merge day, as 1.6.0's were, or keep 6 November.
4. **The Cardanoscan entries:** the fork beside the repository still has the 8131b1d 5 ₳ pool's entries uncommitted. Once it's clean, part 1's registry block adds the v2 pool's four too.

Your calls, whenever you choose:
- the race's order: first built, or first sent;
- whether the policy's *sites you connect* row says a site can tell which Lovejoin pools a device knows (privacy.md says so now);
- **a CI change:** `web-wallet.yml`'s `covered` filter skips the Rust job for a PR that touches only `seedelf-verification/`. Adding `^seedelf-verification/Lovejoin/(Template/)?Scripts/` would make a hex-only edit fail on the PR, not only after the merge;
- the two AnyTx modules in no check.sh family.

## Lessons

- **A fix that turns on dead code turns on everything behind it.** v-pv11-impact#2's names were right. But three paths had been built against an invented answer and had never run on a real one, and each was a bug waiting.
- **Hold the node's words to the protocol version the networks run.** Staking's refusal words had been dead since July's hard fork. Tests using the old name hid it, and a free refusal on preprod is the proof.
- **Faking one read live finds what faking the network can't:** the node's exact body, and a Koios 500 that turned a clean refusal into a two-hour hold.

## The IDs

The code, the tests and the docs cite these by ID. Their full text is in git at `e96e57db`, under `seedelf-platform/seedelf-web-wallet/docs/plans/review-1.8.1/`.

| IDs | What | File at `e96e57db` |
|---|---|---|
| `core#`, `worker#`, `readers#`, `guard#`, `mutants#`, `money#`, `fidelity#`, `trust#`, `claims#`, cited as "1.8.1's release review, …" | round one's 52 | the lens's report (`core.md` and the rest), and `REVIEWBRIEF.md` |
| `v-pv11-trace#`, `v-pv11-impact#`, `v-guard#`, `critic#`, and the verifiers' verdicts | the verification | `v-pv11-trace.md`, `v-pv11-impact.md`, `v-worker.md`, `v-readers.md`, `v-guard.md`, `critic.md` |
| the lanes (`refusals`, `balance`, `guard`, `rust`, `verif`, `docs`) | round one's fixes | `fixes/<lane>.md`, and `FIXBRIEF.md` |
| `r2-<lens>#<n>`, cited as "1.8.1's review of its fixes, …" | round two's 24 | `r2-*.md`, and `R2BRIEF.md` |
| the fix-ups (`r2-worker`, `r2-rust`, `r2-docs`) | round two's fixes | `fixes/r2-*.md`, and `R2FIXBRIEF.md` |
| `last-<part>#<n>` | the last look | `last-code.md`, `last-docs.md` |
| the back-translations | both rounds | `back-translation.md` |
