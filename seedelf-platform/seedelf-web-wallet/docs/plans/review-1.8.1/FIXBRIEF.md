# 1.8.1's fix round: the brief

Six lanes, each in its own worktree of `2a8060d3`, every fix test first, every lane by the files it owns. The lead merges the lanes into `web-wallet/release-1.8.1` as patches, rebuilds, runs every suite, and then a second review reads the merged fixes where the lanes meet.

Read [REVIEWBRIEF.md](REVIEWBRIEF.md) for the paths (ROOT, WW, EXT, WASM, CORE, VER, SCRATCH) and the owner's calls, and your findings in full in their lens's report here (`core.md`, `worker.md`, `readers.md`, `guard.md`, `mutants.md`, `money.md`, `fidelity.md`, `trust.md`, `claims.md`) and in the verifiers' (`v-pv11-trace.md`, `v-pv11-impact.md`, `v-worker.md`, `v-readers.md`, `v-guard.md`, `critic.md`). Every finding in structured form: `SCRATCH/review/find-result.json` and `SCRATCH/review/verify-result.json`.

## Rules, for every lane

1. **Work only in your worktree.** Never edit the main tree or another lane's worktree. A change you'd make outside your lane's files goes in your report, under *For the lead*.
2. **Test first.** Write the test, run it and see it fail on the code as it is, fix, and see it pass. For a test gap (behaviour that's already right), break the line the test holds, see the test fail, and restore it. Your report says what each test failed on.
3. **Run named tests only:** `npx vitest run tests/<file>` in your worktree's `extension/`; `cargo test -p <crate> --test <name>` in your worktree's `seedelf-platform/` (its own target: CARGO_TARGET_DIR is unset). Before you return, run every test file you touched in full, and `npm run typecheck` if you touched TypeScript. The lead runs the whole suites.
4. **Never:** `npm ci`, `npm install`, `npm run build`, `npm run package`, `npm run e2e`, anything under `e2e/live`, `wasm/build.sh`, a binary from `seedelf-data/target`, `cargo run` in `seedelf-data/`, `cargo test -- --ignored`, `lake`, `lean` or `check.sh`. No network beyond public docs and source on GitHub.
5. **No formatter but rustfmt.** There's no prettier here: match the surrounding code's layout, naming and comment density. The Rust lane runs `cargo fmt --all`.
6. **The words.** A user-visible string you add or change changes in `en.json`, `es.json` and `ja.json` together. A line that warns, or tells the user something about privacy, gets a `.warn.` or `.privacy.` key. Name every new or changed key in your report: the lead runs a blind back-translation round. The worker never compares, parses or persists translated text. The name is Seedelf; UI text is one short line.
7. **Leave everything uncommitted.** Use `mv`, never `git mv`, and name every new, moved or deleted file in your report: the lead collects them with `git status --porcelain`.
8. **Your report** is `WW/docs/plans/review-1.8.1/fixes/<lane>.md` (in the main tree: the one file there you write). For each finding: what changed (file:line), each test and what it failed on before the fix, anything not done and why, and anything a doc now says wrongly (for the docs lane). Write it before you return.

## The lead's calls (2026-11-07)

- **Fixed in 1.8.1:** every finding the lanes below name.
- **Not fixed, as backlog lines** (the docs lane writes them), on the verifiers' traces:
  - **The race for a balance between two of the wallet's own transactions in one pool:** worker#2 (a collateral tail alone in its pool holds the balance from Send until giveme.my signs; other flows there build on 0 and are refused), readers#3 (Bring everything back over two or more sessions through one pool counts the balance in each return, Send refuses all but the first, and a review made again before the first's take is in stops that return's chain after its deposit), readers#2 (a take that landed counts as on its way for up to two hours), worker#3 (a maybe-sent way back that took a balance and lost it is resent for two hours, holding every way back). Every refusal is phase 1, so nothing is lost. Only an order fixes the race (first built or first sent, or no build in that pool until the take is in), and that's the owner's to pick. Each proposed fix moved the refusal elsewhere, and two of them conflict (v-readers.md, v-worker.md).
  - **guard#10:** `lj.rewardsMovedReview` shown in Bring everything back's failed list (not critical; the route carries every send error's words).
- **readers#4's grade:** low (both verifiers), medium (its finder). Fixed either way.
- **Owner's, not ours:** web-wallet.yml's changes filter skips the Rust job for a pull request that touches only `seedelf-verification/` (trust#1's note). A CI decision: put it in your report only.

## The lanes

### refusals: `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-r181-refusals`

- **Findings:**
  - **readers#4:** match `/WithdrawalsNotInRewards|IncompleteWithdrawals/` for staking's rewards words and `WithdrawalsMissingAccounts` as `koios.staking.changed`. Decide `RewardsChangedError` by all three.
  - **worker#1:** a chain refused for the balance is rethrown in Lovejoin's words, keeping the type: `lovejoin.ts` ~:5411 and `sessions.ts` ~:5319. It lands with readers#4, never alone.
  - **v-pv11-trace#1 and v-pv11-impact#1:** stakingRefusal's DELEG names at PV11 and in ledger 1.24: `/StakeKey(Not)?Registered|AccountAlreadyRegistered|IncorrectDeposit|DepositIncorrect|RefundIncorrect|NonZero(Reward)?AccountBalance/`, with no live body gaining a new match.
  - **v-pv11-impact#2:** `unknownInputs` also takes names from an item's `error.data.reason` (`missing from UTxO set): <hash>#<ix>`), and only when the answer already counts as stale (3110 or 3117). Which answers count as stale never changes.
- **Files:**
  - `EXT/src/background/koios.ts`.
  - In `lovejoin.ts`: the rethrow, plus `unknownInputs` (~:600) and what it feeds.
  - In `sessions.ts`: the rethrow.
  - Tests: `koios.test.ts`, `staking.test.ts`, and `lovejoin-planner.test.ts` (move its 'asks again, rather than stop' cases from the invented 3117 to the recorded 3010/3110/3004 shape); a new `tests/lovejoin-refusals.test.ts` for the words (publicSubmit, backSubmit and claimSubmit given the PV11 body).
  - In `lovejoin-reward-balance.test.ts`, only the `NOT_IN_REWARDS` bodies: run its refusal cases with the PV10 body and the PV11 one.
- **Start from:**
  - `SCRATCH/review/v-pv11-trace/fix.diff` and `tests.diff`;
  - `SCRATCH/review/v-pv11-impact/repros/` (`fix-koios.diff`, `fix-lovejoin.diff` and its four tests);
  - `SCRATCH/review/worker/zz-r181-worker-1.test.ts`.
  - Use real bodies: cardano-submit-api's envelope (v-pv11-trace.md, part c), and Ogmios's recorded answer `CORE/tests/fixtures/ogmios/unknown_inputs.json`.

### balance: `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-r181-balance`

- **Findings:**
  - **readers#1:** a public mix's review and Mix again's review: *Public account after* adds what the chain takes. The worker puts it on the summary, as readsFor's amounts summed.
  - **worker#5:** a Bootstrap (depth 0) reads no reward account.
  - **The test gaps,** each test checked against a mutant of the line it holds:
    - mutants#5: the five rules in lovejoin-rewards.ts, T3a, T3c, T3d, T4c and T7d. T4c pins today's rule.
    - mutants#6 and worker#4: a session's return passes its balance, keeps it for Send, and is refused at Send when it moved.
    - mutants#7: the public Mix again and the paid ways back.
    - mutants#8: an account_info that fails builds as before (unread); one read a pool a build; a Bootstrap reads none; mainnet's account header `f1`; holdOnly keeps a held step's take.
- **Files:**
  - In `lovejoin.ts`: the public summary, publicBuild's and publicAgainBuild's, and the Bootstrap's read (~:3826).
  - `EXT/src/shared/rpc.ts`'s `LovejoinPublicSummary`.
  - In `EXT/src/ui/screens/Lovejoin.tsx`: PublicReview and PublicAgainReview's after row.
  - Tests: `lovejoin-reward-balance.test.ts` (new describe blocks only; its NOT_IN_REWARDS bodies are the refusals lane's), and a screens test for the after row.
- **Start from:**
  - `SCRATCH/review/readers/repros/zz-r181-readers-1.test.ts`;
  - `SCRATCH/review/mutants/repros/zz-r181-mutants-1.test.ts`;
  - `SCRATCH/review/worker/zz-r181-worker-4.test.ts`;
  - `SCRATCH/review/v-worker/zz-r181-v-worker-5.test.ts`;
  - `mutants.md`'s T-numbers.
- **Note:** a test of the refusal's words is the refusals lane's. Yours follow the balance through: the read, the request, kept for Send, the read again at Send.

### guard: `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-r181-guard`

- **Findings:**
  - **guard#1 and v-guard#1:** the guard's set is the classic pool plus every pool discovery keeps, so it no longer depends on where the wallet's boxes are. That also closes v-guard#1's probe.
  - **guard#3:** tests: a session's DappService with `lovejoin`, refusing a pool registration and a proposal's return; a proposal's return and a treasury payee (definite and indefinite maps) through the signer; mixLogicHashes over discovery's pools on each network, a pool found since included.
  - **mutants#9:** `DappDeps.lovejoin` required, at every construction site.
- **Files:** `lovejoin.ts` (mixLogicHashes only), `lovejoin-pools.ts` (everyKept), the serviceDeps wiring, `dapp.ts`'s DappDeps, `sw.ts` if the type needs it; tests: `dapp.test.ts`, `fakes.ts` and the other construction sites, and a new test file if that's cleaner.
- **Start from:** `SCRATCH/review/v-guard/` (`guard1-fix.patch`, `mutants9-optionA.patch`, `zz-r181-v-guard-1.test.ts`) and `SCRATCH/review/guard/zz-r181-guard-1.test.ts`.
- **Note:** a signature reads nothing new: no request and no new storage key. Say the cost.

### rust: `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-r181`

This is the mutation lens's worktree, with its target built. Keep CARGO_TARGET_DIR unset.

- **Findings:**
  - **core#1 and money#1:** v2 mixes and withdraws, of every kind, take a balance and pay the ledger's fee, and every chain transaction balances with a take, on the v2 ADA and token fixtures; plus the classic kinds no test runs with one.
  - **money#2 and mutants#3:** a test per WebAssembly entry point that reads `rewards` (chain_across_pools and its tail sharing the chain's Rewards, again_from_account_at, withdraw_paid_in, withdraw_private_in, collateral_mix, session_return's direct tail).
  - **mutants#1:** a withdraw refused after it read the balance takes nothing.
  - **mutants#2:** mixing again hands its take out of the caller's Rewards.
  - **mutants#4:** cip30's paidScripts holds a proposal's deposit return on its own.
  - **core#2:** `Rewards::of`: the last entry for a hash wins, a 0 included (collect, then retain), with a test.
  - **core#3:** the two doc comments.
  - **trust#1, with claims#2's pin:** a test in the WebAssembly crate (`publish = false`) that reads `seedelf-verification/Lovejoin/Template/Scripts/{mix_logic,one_shot_mint}.hex` with `include_str!` and holds them to core's `Set::V2` bytes. It also pins mainnet's v2 5 ₳ pool: `derive_in(Set::V2)` from seed `6db8a313…#3` gives P `fcb3f5ec…`, L `a6a85074…`, M `dd94113c…` (full hashes in trust.md, claims.md and the head start `EXT/src/lovejoin-pools.json`).
- **Files:**
  - `CORE/src/lovejoin/mod.rs`: `Rewards::of` and those docs only;
  - `CORE/tests/*`;
  - `WASM/tests/*`;
  - `WASM/src` only if a path can't be reached otherwise (say why).
- **Start from:**
  - `SCRATCH/review/core/zz_r181_core_1.rs`;
  - `SCRATCH/review/money/zz_r181_money_1.rs` and `zz_r181_money_2.rs`;
  - `SCRATCH/review/mutants/repros/rust-repros.diff`;
  - `SCRATCH/review/trust/zz_r181_trust_1.rs`.
- **Before you return:** `cargo fmt --all`, `cargo clippy -p seedelf-core -p seedelf-wasm --tests -- -D warnings`, and every core and wasm test target you touched, in full.

### verif: `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-r181-verif`

- **Findings:**
  - **CLAIMS.md:** claims#1, trust#4 and critic#2, in one *Where it stops* rewrite, plus claims#10, and claims#2's line (the live mainnet pool's scripts are these templates applied, as the rust lane's test pins).
  - **README.md:**
    - fidelity#1: the hypotheses at :68;
    - fidelity#2 and claims#3: the standard command ends `&& ./check.sh lovejoin-every`, with its caps;
    - claims#8: the Next line;
    - critic#1: Audit/'s scope at :7;
    - claims#7: :7's pointer;
    - trust#2: the manual step after an extract run, in Running it.
  - **The AnyTx README:** claims#1's aliases (serialise_data and xor through the fork; byteStringToInteger is upstream) and critic#4 (its opening).
  - **check.sh:** claims#5 (an Every module named alone gets 16 GB and 30 minutes) and claims#4 (the 51 prerequisites, in import order, ahead of the 25).
  - **Readable.lean:** fidelity#3, trust#3 and claims#9, a `#guard_msgs in #print axioms` for `mix_logic_accepts_iff` and for `one_shot_mint_accepts_iff`, each `[propext, Classical.choice, Quot.sound]`. The lead builds them.
  - **tools/:** claims#11's path regex.
  - **Audit/review/findings.md and findings.json:** trust#2's finding is open again, with its manual step.
  - **claims#6:** move the chunk-45 plan's method, pitfalls and tools into a new `VER/Lovejoin/Every/README.md` (linked from the AnyTx README), its upstream items into chunk 41's plan. Then `mv` the plan to `WW/docs/archive/plans/`, ending with what its PR did (#368, `d190f717`), its stale lines fixed.
  - **claims#7:** chunk 42's plan, its rows 9 and 10 done, its limits pointing to CLAIMS.md. Archive it too if nothing in it is still live.
- **Files:** everything under `VER/`, and those two plans (`WW/docs/plans/chunk-45-lovejoin-every-tx.md`, `chunk-42-lovejoin-verification.md`) and chunk 41's plan's upstream list.
- **No builds:** `bash -n check.sh`, and a parse-only copy of check.sh (printing each module and its caps instead of building) to show the lists.

### docs: `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-r181-docs`

- **Findings:**
  - **guard#2:** the privacy policy's body, in its Lovejoin's pools bullet. No new dated entry: no new data handling, and the 6 November entry stands.
  - **architecture.md:** guard#5 (the diagram's account_info read), guard#6 (the cost line), and readers#4's :377 list of refusals (the PV11 names, as the refusals lane matches them).
  - **The rest:** guard#7 (privacy.md), guard#8 (`seedelf-platform/CLAUDE.md`) and guard#9 (`WASM/README.md`).
  - **mutants#10, money#2's note and guard#1's line:** chunk 43's archived record names what's tested and lists the rest as not covered; copies are guarded (after the guard lane's fix).
  - **readers#1:** backlog.md:51 is true again with the balance lane's fix: a public mix's review counts the balance in *Public account after*, a return's in *Back now*. The owner's deferred line stays deferred.
  - **The backlog lines** from *The lead's calls*: the race (one line, or one for each flow, citing 1.8.1's review), and guard#10.
  - **critic#3:** development.md part 1's `release_version=1.8.1`, and the zip name it gives (`seedelf-wallet-1.8.1-mainnet.zip`).
- **Files:** `WW/docs/**` (but `plans/review-1.8.1/` and the chunk-42 and chunk-45 plans, which are the verif lane's), `seedelf-platform/CLAUDE.md`, `WASM/README.md`.
- **Notes:** docs never date releases, and never say what the store is doing. A data-handling change gets a dated policy entry, and none is new here.
