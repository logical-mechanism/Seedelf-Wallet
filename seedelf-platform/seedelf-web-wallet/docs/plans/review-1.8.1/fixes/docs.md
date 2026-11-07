# 1.8.1's fix round: docs

Lane `docs`, worktree `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-r181-docs`, on `2a8060d3`. Everything is uncommitted. Eight files are modified, none is new, moved or deleted. No string a user sees changed, so no i18n key was added or changed.

**Tests.** These are docs only. No test reads any line I changed except `wasm/tests/readme_test.rs`, which holds wasm/README.md's export table to the exports. It can't see a row's fields: its header says "a row's fields are the review's". I ran it after my last README edit, on my worktree's own target: it passed (1 of 1). I didn't write a test for a doc. A test that reads development.md would need web-wallet.yml's `covered` filter to name that file, which is a CI change. So I checked each claim against the code (the files are cited below).

## The findings

### guard#2 · fixed · `docs/store/privacy-policy.md:46`

- **What changed:** one sentence in the body's *Lovejoin's pools* bullet, before its line about a pool's start: "Before the wallet builds a Lovejoin mix or a box's way back, at a review too, it asks what sits in that pool's reward account, the one Lovejoin's own script runs through, and again as you send a mix or a return kept for you: one request a pool, the same for everyone, naming the pool and nothing of yours."
- **No new dated entry:** nothing about data handling is new. The Effective date stays 6 November 2026.
- **Checked against:**
  - `rewardsIn` keeps one read a pool id (`lovejoin.ts:4625`);
  - the read is made at every build, a review's included;
  - Send reads again in `publicStart`, `backSubmit` and `claimSubmit`;
  - a Bootstrap isn't a mix, and it reads none (`lovejoin.ts:4853`, and the balance lane's worker#5).

### guard#5 · fixed · `docs/architecture.md:680`, `:701`, `:706`

- **:680, the diagram:** the arrow from `lovejoin.ts` to Koios lists `account_info (mix_logic)`.
- **:701, *A chain is built whole…*:** one sentence. The chain's first mix in each pool takes whatever sits in that pool's `mix_logic` reward account into its change, and every later one there withdraws 0. The parenthesis says how: `rewardsIn`'s `account_info` is read once a build, and reads none while the wallet's own transaction on its way takes it; a chain kept for Send reads it again there, and one that moved is a review to make again.
- **:706, *Withdraws*:** a box comes back "with giveme.my's collateral, its pool's `mix_logic` reward balance with it (chunk 43)".
- **Checked against:** `lovejoin-rewards.ts`'s `balanceAfter`, `readsFor` and `moved`, and core's `into_register`.

### guard#6 and worker#5 · fixed · `docs/architecture.md:749`

The cost line now reads: one `account_info` for each pool a build mixes or withdraws in, its collateral's 5 ₳ pool among them, read once a build. That gives:

- a chain in one pool 1, or 2 where its collateral's mix goes into the 5 ₳ pool apart;
- a return across pools, one a pool;
- one more a pool at Send;
- a refused withdraw built again, one more;
- a Bootstrap, which runs no script, none.

"The data layer's edge charges 4 units for each". Before, it said "a return across pools one a pool and one for its collateral's 5 ₳ pool".

**Checked against:** `fanOut` reads `[pool, c.collateralPool?.pool]` (`lovejoin.ts:3826`), `acrossOf` reads the legs and the collateral's pool (`:4035`), and `rewardsIn` dedupes by pool id (`:4625`). So "a chain in one pool 1" was wrong too, for a token chain whose collateral goes into the 5 ₳ pool.

### readers#4 (with v-pv11-trace#1 and v-pv11-impact#1) · fixed · `docs/architecture.md:377`

The list of staking's submit refusals now gives the ledger's names before protocol version 11 and since, as the FIXBRIEF has the refusals lane match them:

- **A withdrawal that isn't the whole balance:** `WithdrawalsNotInRewards`; from 11, `ConwayIncompleteWithdrawals`.
- `NotDelegatedToDRep`, and a pool or DRep that's gone.
- **An account whose staking changed:**
  - a withdrawal from one that isn't registered: from 11, `ConwayWithdrawalsMissingAccounts`;
  - its key registered or not: `StakeKeyRegistered`, `StakeKeyNotRegistered`, and ledger 1.24's `AccountAlreadyRegistered`;
  - a deposit or a refund it doesn't expect: `IncorrectDeposit`; from 11, `DepositIncorrect` and `RefundIncorrect`;
  - rewards left at Stop staking: `NonZeroRewardAccountBalance`, "which later ledgers name `NonZeroAccountBalance`".
- **The type:** a withdrawal refused by any of its three names is a `RewardsChangedError`, which Lovejoin tells by its type.

**The NonZero name's wording is deliberate.** v-pv11-impact dates that rename to conway 1.21. It isn't gated on the protocol version, so "from 11" would be wrong for it.

### guard#7 · fixed · `docs/privacy.md:236` and `docs/store/privacy-policy.md:93`

- **privacy.md:**
  - It was "from the IP address that sends the transaction moments later". It now reads "from the IP address that sends the transaction, and at review, as the pool read is, even for a review never sent".
  - "Before each build in a pool" is now "but a Bootstrap's, which runs no script", which is true with the balance lane's worker#5.
- **The policy's 6 November entry:** "moments later" is now "at its review too, even one you don't send". That's a wording change inside the entry, not a new entry. See *For the lead*.

### guard#8 · fixed · `seedelf-platform/CLAUDE.md:97`

- **The line now reads:** "Every Lovejoin builder whose transactions run `mix_logic` (the mixes, the withdraws, the chains and their collateral's tail and mix; not the deposits or a pool's start) takes a `&mut lovejoin::Rewards`".
- **Checked against:**
  - `seedelf-core/src/lovejoin/mod.rs`: `deposit`, `deposit_from` and `deposit_across` take none; `mix`, `mix_giveme`, the three withdraws, `chain`, `chain_from`, `chain_across`, `again`, `again_at`, `collateral_tail` and `collateral_mix` do;
  - `launch.rs`: none.

### guard#9 · fixed · `wasm/README.md:92`

- **What changed:** the `inspectDappTx` row's return list now names two more fields:
  - `proposals`: each one's kind, its deposit and the reward account it goes back to, and a treasury withdrawal's recipients, each stake key named as a certificate's is (chunk 39);
  - `paidScripts`: the scripts whose reward accounts it pays into, by hash, each once (a stake pool registration's, a proposal's deposit return and a treasury withdrawal's payee), for the extension's Lovejoin refusal (chunk 43).
- **Checked against:** `cip30.rs` `TxSummary` and `Proposal`.
- **The test:** `readme_test` passes.

### mutants#10, money#2's note and guard#1's line · fixed · `docs/archive/plans/chunk-43-lovejoin-reward-balance.md:47`, `:169`, `:175`–`:181`

- **:47 (guard#1, v-guard#1):** `mixLogicHashes` is "the classic pool and every pool discovery keeps, retired pools and copies included, asking nobody". It adds: #367's took a copy only once handed over or found holding the wallet's boxes, which told a site where those were. This is true once the guard lane's fix lands.
- **:169 (mutants#10, money#2):** WebAssembly's line names what `wasm/tests/lovejoin_test.rs` holds:
  - a session's chain and its tail in two pools, with `returned` counting both;
  - a tail in the chain's own pool, which takes nothing;
  - a public chain;
  - a box's way back;
  - the parsing of `rewards`.

  It adds that `lovejoin_across_test.rs` passes none. Before, it claimed both files held "each pool's first mix and no other".
- **:175 (mutants#10):** the chain stopped in Lovejoin's words is held for the public account's chain, through `pumpPublicNow` (`lovejoin-reward-balance.test.ts`), not by chain-resend.test.ts's `pumpChain`.
- **:176–:181, new: *Not covered by #367's tests*.** Each item cites its finding:
  - core on `Set::V2`, every chain transaction's balance, and the classic and mainnet kinds (core#1, money#1); the withdraw that takes nothing and Mix again's take (mutants#1, #2);
  - WebAssembly's other `rewards` entry points (mutants#3, money#2), and `paidScripts`'s proposal return alone (mutants#4);
  - the worker's flows past the public mix and a box-paid way back, four of `lovejoin-rewards.ts`'s rules, and the read's own (mutants#5–#8, worker#4);
  - the guard (guard#3, mutants#9);
  - the PV11 names, which every test there missed (readers#4).

  It ends "its record says what its fix round added", which the lead's review record has to bear out.

### readers#1 · fixed · `docs/backlog.md:52`

- **What changed:** the owner's deferred line stays ❓. It now says where the take is counted:
  - a return's review, in what comes back;
  - a public mix's or Mix again's, in *Public account after* (1.8.1's release review, readers#1).
- **What it depends on:** the balance lane's after row.
- **Why not "a return's in *Back now*":** a direct return's row reads *Into your private balance* (`Swaps.tsx:2304`, `SiteSessions.tsx:277`), and its `lovelace` counts the take too (money#2). So the line says "in what comes back".

### The race, on the verifiers' traces · backlog line · `docs/backlog.md:55`–`:59`

- **The line:** one ❓ line, "The wallet's own transactions in one pool race for its reward balance", citing 1.8.1's release review (worker#2, readers#3, readers#2, worker#3).
- **What it says:**
  - each refusal comes before any script runs (phase 1, or Send's own read), so nothing is lost;
  - only an order fixes it (first built or first sent, or no build in that pool until the take is in), and that's the owner's to pick;
  - each fix proposed moved the refusal elsewhere, and two conflict.
- **One sub-line for each flow:**
  - a tail alone in its pool;
  - Bring everything back over two or more sessions, a review made again stopping the next return's chain after its deposit;
  - a landed take counting for up to two hours;
  - a maybe-sent way back resent for two hours.
- **One change from your wording:** your "Every refusal is phase 1" became "Each refusal comes before any script runs (phase 1, or Send's own read)". readers#3's Send refusal is the wallet's own stale review, not the ledger's phase 1.

### guard#10 · backlog line · `docs/backlog.md:23`

- **Where:** under *The owner's open calls*, beside the critical-words gate's line.
- **What it says:**
  - `lj.rewardsMovedReview` shows in Bring everything back's failed list (a warn callout, `ClaimAll.tsx:161`), as every send error's own words do, `sess.spentSince` and Koios's too, none of them critical;
  - the route is older than the rule, and `tests/i18n-worker-reasons.test.ts`'s `RUNTIME` doesn't name it;
  - the choice: list it, which takes `.warn.` names and a blind round for every error that can reach it, or keep it as precedent.

### critic#3 · fixed · `docs/development.md:182`, `:279`

- `release_version=1.8.1`.
- "With `package.json` at 1.8.1, that file is `extension/release/seedelf-wallet-1.8.1-mainnet.zip`."
- `package.json` is at 1.8.1. This follows each earlier release's record commit (`0b75beaa` changed both lines for 1.8.0).

## What a doc now says wrongly, or will

- **None of my edits is wrong today.** Five of them are written for the merged tree, and say what's true once the other lanes land:
  - `architecture.md:377`: the refusals lane's matches. If it words `WithdrawalsMissingAccounts` in rewardsChanged's words rather than `koios.staking.changed`, move that name from "an account whose staking changed" to the first group;
  - `architecture.md:749` and `privacy.md:236`'s "a Bootstrap reads none": the balance lane's worker#5;
  - `backlog.md:52`: the balance lane's readers#1;
  - chunk 43's record `:47`: the guard lane's guard#1;
  - chunk 43's record `:176`: the review's record naming the tests its fix round added.
- **Left as records, as v-pv11-trace and v-pv11-impact advise:** chunk 43's record `:8` ("refuses anything else as `WithdrawalsNotInRewards`") and `:171` (koios.test.ts's PV10 name). Its new *Not covered* item says what PV11 says instead.

## For the lead

- **The policy's 6 November entry.** I read "the 6 November entry stands" as no new dated entry, and changed its "moments later" for guard#7. The house has reworded an unreleased entry in a review round before, for example the 28 October entry in `8f717678`. If you meant the entry untouched, revert that one phrase at `privacy-policy.md:93`: "…sends the transaction, at its review too, even one you don't send." back to "…sends the transaction moments later."
- **guard#4 is in no lane:** `lj.warn.rewardsMoved` is listed as verified, with no round recorded. That's your blind round, and both verified files' reviewer notes gaining a 1.8.1 entry.
- **`seedelf-core/src/withdraw_zero.rs:8`'s comment** names only `WithdrawalsNotInRewards`; from protocol version 11 it's `ConwayIncompleteWithdrawals` (v-pv11-trace's docs list). It's in no lane's files. koios.ts:628's comment is the refusals lane's.
- **`seedelf-platform/CLAUDE.md:86`** says `Set::V2` is "the bytes `seedelf-verification` proves". The rust lane's trust#1 test will hold that. Once it lands, its name could go there.
- **`docs/development.md:145`**, the retired pools' checklist item, is worded for 1.8.0's update ("a 1.8.0 build puts none there", "the profile's first unlock on 1.8.0"). For 1.8.1's checklist it reads as "from 1.8.0 on". It's not a finding, so I didn't change it.
- **A possible privacy.md line (not written).** After guard#1's fix, the guard's set is discovery's unsealed record. A connected site can still tell, from a refusal unasked against a prompt, whether this device keeps a given pool, a copy say. That's nearly the same for every device: v-guard notes the guard already shows it through `known`. The connector's section could say so.
- **The archive's IDs table** (`docs/archive/plans/README.md`) may want a 1.8.1 row when you write the review's record.
- **For the owner, a CI decision (trust#1's note), not made here:** web-wallet.yml's changes filter skips the Rust job for a pull request that touches only `seedelf-verification/`.

## Files

- M `seedelf-platform/CLAUDE.md`
- M `seedelf-platform/seedelf-web-wallet/docs/architecture.md`
- M `seedelf-platform/seedelf-web-wallet/docs/archive/plans/chunk-43-lovejoin-reward-balance.md`
- M `seedelf-platform/seedelf-web-wallet/docs/backlog.md`
- M `seedelf-platform/seedelf-web-wallet/docs/development.md`
- M `seedelf-platform/seedelf-web-wallet/docs/privacy.md`
- M `seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md`
- M `seedelf-platform/seedelf-web-wallet/wasm/README.md`

## What I ran last

- `env -u CARGO_TARGET_DIR cargo test -p seedelf-wasm --test readme_test`, in the worktree's `seedelf-platform/`, after the last README edit: 1 passed.
- `git status --porcelain` in the worktree: the eight files above, nothing else (the new `target/` is ignored).
