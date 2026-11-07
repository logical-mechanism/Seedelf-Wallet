# 1.8.1's round-two fix-ups: the brief

Round two ([R2BRIEF.md](R2BRIEF.md), its reports `r2-*.md`) found 24: 13 low and 11 nits, no medium. Three are regressions from round one's v-pv11-impact#2. The fix-ups run as three lanes, each in its own worktree, with [FIXBRIEF.md](FIXBRIEF.md)'s rules (test first, your files only, named tests only, uncommitted, a report at `WW/docs/plans/review-1.8.1/fixes/r2-<lane>.md`).

## The lead's calls (2026-11-07)

- **v-pv11-impact#2 is reverted, not patched.** Naming a stale answer's inputs from Ogmios's 3004 reason reached three paths that had never run on a real answer: tailWitness's `ours` (r2-worker#1: a collateral's mix whose box another wallet drew waits a day), and unstale's `avoid` into Mix again's own boxes (r2-worker#2 and r2-tests#1: a false "no box there", or a private Mix again given up). Its benefit shows only on preprod or with Koios as a fallback; on mainnet with the data layer up it never fires. It goes back to `2a8060d3`'s code and tests, and to a backlog line: the 'Koios behind' rules were built against an invented 3117 that Ogmios never sends, and naming the input reaches tailWitness, unstale and Mix again together. Rework them together, later.
- **r2-screens#1 is fixed:** staking's words only for a key's account. A refused withdrawal from a script's account (a Danogo pool's withdraw-zero, Lovejoin's `mix_logic`) keeps the network's words and stays a `RewardsChangedError`, which Lovejoin rewords by type.
- **r2-docs#1 is the owner's:** whether the policy's 6 November entry and Effective line move to the release PR's merge day (1.6.0's were moved; 1.7.0's question was put to the owner). The PR asks.
- **r2-docs#4:** one line in privacy.md. The policy's sites row is the owner's call.
- **r2-docs#13** (a comment in `Lovejoin/Template/Scripts.lean`) is left: any edit there rebuilds every Lovejoin module.

## The lanes

### worker: `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-r2fix-worker`

Detached at the snapshot `a619169f` (the merged round one).

- **The revert:**
  - `lovejoin.ts`'s `MISSING_INPUT` and `unknownInputs` back to `2a8060d3` (`git diff 2a8060d3 a619169f -- <file>` shows round one's hunks; revert only v-pv11-impact#2's), and their tests:
    - `lovejoin-planner.test.ts`'s two "asks again" cases, back to `2a8060d3`'s;
    - `lovejoin.test.ts`'s `unknownTo` (the lead's edit), back to `2a8060d3`'s `unknownBox` and the runner's case.
  - **The test that must fail after the revert, until the code is reverted too:** r2-tests#1's repro (`SCRATCH/review/r2-tests/`) and r2-worker#2's (`SCRATCH/review/r2-worker/repros/`), kept as tests that expect `lj.poolDrifted`.
- **r2-screens#1:**
  - In koios.ts, staking's words (`rewardsChanged` and `changed`) only where the refusal names a key's account (`KeyHashObj`, at PV10 and PV11). A script's account gets the network's words, still a `RewardsChangedError`.
  - Tests:
    - `koios.test.ts`'s script-account case expects the network's words with the type;
    - a direct swap refused for a Danogo script's account never says "staking rewards" or "review it again" (`SCRATCH/review/r2-screens/`);
    - Lovejoin's tests still hold `REWARDS_MOVED()`.
- **r2-last#1:** tests for withdrawOne's rebuild after a refusal for a moved balance, each failing with its option dropped from the rebuild line (lovejoin.ts ~:7719):
  - Bring every box back's box (`bring`);
  - a Bootstrap's held box (`bootstrap`/`holder`: its Bootstrap's count down by one, no mix's entry closed);
  - optionally a lock and unlock inside the rebuild (`lj.lockedWhileBuilding`).
  - Start from `SCRATCH/review/r2-last/repros/`.
- **r2-tests#2:** a timeout on the describes holding `dapp-ties-accounts.test.ts:186`, `dapp.test.ts:803` and `:1404`, as the heavy files do, with a line saying why. Check them under `taskset -c 0,1` with four workers.

### rust: `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-r181`

Round one's Rust lane, its changes staged and its target built. Your edits stay unstaged, so `git diff` is yours alone.

- **r2-rust#1:** a Lovejoin fee held to the ledger's minimum when two keys sign: the mix under the payer's own collateral, the paid withdraw and a deposit with a two-key payer, in `every_kind_takes` or beside it. Better still, the WebAssembly tests that build two-key public transactions hold each signed transaction's fee to the minimum worked out from its own signed bytes. Each test fails on a mutant that prices one signature (`SCRATCH/review/r2-rust/`).
- `cargo fmt --all`, clippy `-D warnings` on core and wasm, and the targets you touched.

### docs: `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-r2fix-docs`

Detached at the snapshot.

- r2-screens#3 (flows.md);
- r2-docs#2 (the AnyTx README's stale Owner-verifier and Remaining-safety sections);
- r2-docs#3 (architecture.md: the dApp signer's Lovejoin refusal, and its set: the classic pool and every pool discovery keeps);
- r2-docs#4 (privacy.md's Connecting a site: a site can tell from an unasked refusal which Lovejoin pools this device knows);
- r2-docs#5 (backlog.md's guard#10 line: lj.warn.rewardsMoved is in that list now);
- r2-docs#6 and r2-last#2 (chunk 41's other #71 lines);
- r2-docs#7 (CLAIMS.md's count of the fork's changes);
- r2-docs#8 (development.md:145, for 1.8.1);
- r2-docs#9 (check.sh's usage text);
- r2-docs#10 (architecture.md:701);
- r2-docs#11 and r2-docs#12 (the archived records' wording);
- r2-rust#2 (`seedelf-platform/CLAUDE.md`: the test holds three of Set::V2's four script files, the fourth being fee_contract, out of scope);
- **and the backlog line for the reverted v-pv11-impact#2**, in the Lovejoin area, citing 1.8.1's review (r2-worker#1, r2-worker#2, r2-tests#1).
