# 1.8.1's review of its merged fixes: r2-worker

Round two, reviewer `r2-worker`. Lens: the worker where the lanes meet. The tree is the main tree with the merged fixes uncommitted (`git diff HEAD`), on `2a8060d3`.

**The short of it:**

- **Two defects, both from v-pv11-impact#2's fix** (`unknownInputs` naming a stale answer's inputs). Neither loses money; both reach code that never ran on a real answer before.
  - **r2-worker#1 (low, a regression of this round):** a session's collateral's mix whose own box another wallet's mix drew waits a day, its return held behind it, where 1.8.0 stopped at once. tailWitness reads Ogmios naming the wallet's own box as "behind, ask again". On mainnet, with the data layer up, that branch can only fire in this wrong case.
  - **r2-worker#2 (low):** Mix my boxes again avoids the wallet's *own* boxes once Ogmios names them. The public one ends in "None of your boxes in Lovejoin's pool came from a mix from your public account."; the private one gives up its mix (`lj.skip.warn.noneLeft`) and comes back directly. Both used to end in `lj.poolDrifted`, to try again.
- **Everything else in the lens held:** every catcher of `RewardsChangedError`, the rethrows' `trouble` and `failure`, `WithdrawalsMissingAccounts`, the take on the summary, the Bootstrap's skipped read, and `everyKept` at a signature. The list is under *Checked, and it held*.

| id | severity | where | what |
|---|---|---|---|
| r2-worker#1 | low | `EXT/src/background/sessions.ts:5409`, `lovejoin.ts:4553` | A collateral's mix whose own box is gone waits up to TAIL_KEEP_MS, its return held behind it |
| r2-worker#2 | low | `EXT/src/background/lovejoin.ts:4619`, `:3801`, `:5052` | Mixing again, a name of the wallet's own box empties its own set: a false refusal, or the private mix given up |

## How I worked

- **A private scratch copy** of the merged extension, `SCRATCH/review/r2-worker/tree/` (src, tests and config copied; `node_modules` entries, `wasm/`, the crates and `docs/` linked read-only). `diff -rq` held it equal to the main tree's `src/` and `tests/` before every run. Reverts went there, not in R2: R2 had another reviewer's mutant in progress (`MM seedelf-core/src/lovejoin/mod.rs` when I looked), and editing its `lovejoin.ts` would have raced theirs. R2 was never touched.
- **The repros** are copies of `tests/lovejoin-planner.test.ts` and `tests/lovejoin-reward-balance.test.ts` with tests named `ZZR2W…` added inside their describe blocks, so they reuse those files' setups. Run by name only (`-t ZZR2W`).
  - In the scratch copy, on the merged code and with `unknownInputs`' new names reverted, each result below.
  - Then once in the main tree as `EXT/tests/zz-r181-r2-worker-1.test.ts` and `zz-r181-r2-worker-2.test.ts`, by name, and deleted (`SCRATCH/review/r2-worker/repros/main-tree-run.log`, `main-tree-run-w3.log`).
  - The added tests alone: `SCRATCH/review/r2-worker/repros/w1-insert.ts`, `w2-insert.ts`, `w3-insert.ts`.
- **A fix candidate for r2-worker#1** was tried in the scratch copy only: `SCRATCH/review/r2-worker/repros/fix-witnessTail.diff`. With it, `tests/lovejoin-planner.test.ts` and `tests/lovejoin-refusals.test.ts` pass in full (94 tests).
- Nothing else: no build, no e2e, no network, nothing under `e2e/live`.

## r2-worker#1 · low · a collateral's mix whose own box another wallet's mix drew waits a day

**Where:** `EXT/src/background/sessions.ts:5409` (witnessTail's `ours`) with `EXT/src/background/lovejoin.ts:4553` (tailWitness's rule), fed by `unknownInputs` (`lovejoin.ts:607-625`).

**What's wrong.**

- tailWitness takes an answer that names only the wallet's own inputs as Koios's Ogmios being behind, and asks again:

  ```ts
  if (unknown?.length && unknown.every((o) => ours.has(o.split("#")[0]!))) throw new KoiosError(t("sess.notCaughtUp"));
  ```

- `ours` is every transaction of the chain before the mix, and the box's deposit (`sessions.ts:5409`). The collateral's mix spends two of them: its box and the deposit's change (core's `collateral_tail`).
- **The box is a pool box like any other.** Another wallet's Lovejoin mix may draw it once its deposit is in. tailChain's own doc says so ("its box moved by a mix, someone else's or the wallet's own").
- **Ogmios names it the same way either way.** The 3110 for its redeemer makes the answer stale, and a 3004's reason names the first missing input. So a box that's gone reads as "behind" too.
- **Before this round** the recorded answer named nothing (`[]`), so it was a StalePool: the chain stopped there, and Bring back brought the rest back once LANDING_MS had passed (tailChain: not listed, the deposit in, `tailOver`). That is witnessTail's documented contract: "a box it drew that's gone … stops the chain there".
- **Now** nothing bounds the asking but TAIL_KEEP_MS (24 h), at TAIL_WITNESS_WAIT_MS' 1, 2, 4 … 30 minutes. The way out comes at TAIL_OFFER_MS, or a lock cuts the chain.
- **On mainnet, the data layer up,** tx_status (home's db-sync) never runs ahead of home's Ogmios (v-pv11-impact#2's own point). There the "behind" branch can only fire for a box that's gone, or a deposit rolled back. So on mainnet this fix adds only the failure.

**Evidence: `ZZR2W1`** (`w1-insert.ts`), setUp(ONE_BOX)'s site session.

- The setup: its return sent, everything before the collateral's mix on chain, the box spent by another wallet's mix. Ogmios, caught up, answers `unknownTo(box)`, the recorded shape. The runner runs every minute, the wallet kept unlocked.
- **The merged code** (main tree and scratch alike):

  ```
  +0m ended=false … evals=1 giveme=0 held={"offerInMin":60} back=false
  +15m ended=false … evals=5 giveme=0 held={"offerInMin":45} back=false
  Bring back at +20m: refused: Its return through Lovejoin is still being sent. Wait for it to finish.
  +60m ended=false … evals=6 … held={"offerInMin":0} back=false
  +1380m ended=false … evals=50 … back=false
  +1442m ended=true stopped="The collateral's mix waited a day for giveme.my, so the chain stopped there." … evals=52 giveme=0
  ```

- **The new names reverted** (HEAD's `unknownInputs`), same test:

  ```
  +0m ended=true stopped="Lovejoin's pool changed while the wallet read it." … evals=1
  Bring back at +20m: built: collateralTail=undefined txHash=19321c6c
  +60m ended=true … over=true … held=undefined
  ```

- **`ZZR2W1b`:** the same, then a lock at +20 m. After the unlock the chain reads as cut (CHAIN_CUT), the tail is over, and Bring back builds the rest directly. The lock is the other way out.

**The failure.**

- **The trigger:** another wallet's mix in the 5 ₳ pool draws the collateral's box between its deposit landing and its mix's evaluation. That's about a minute normally. It stretches whenever giveme.my is busy, since every retry evaluates again.
- **What the user's return gets, while the wallet stays unlocked:**
  - All of it is held: its `back` spends the collateral's mix's change (`tests/lovejoin-planner.test.ts:1427`). For a direct return with its collateral mixed, that's the whole session.
  - Bring back is refused ("still being sent") for the first hour. The lock countdown says `lock.warn.chainSending`, "locking now stops it partway", which asks the user to stay for a chain that can't finish.
  - A swap that runs itself waits the same way.
  - Past a day it stops in `lj.tail.tooLong`'s words, "waited a day for giveme.my", where giveme.my was never asked.
- **It meets worker#2 (a backlog line):** the chain's reservation holds whatever its collateral's mix takes of the pool's reward balance for the whole wait. A balance there would refuse the wallet's other flows in that pool for up to a day, not minutes.
- **Which buttons still work:**
  - the way out (skipCollateralMix) from +1 h;
  - a lock, then Bring back;
  - Bring one back now, for other boxes (x-scenarios-lj#1's rule holds);
  - Mix my boxes again, for boxes the chain didn't reserve.
- **Nothing is lost.** That's v-pv11-impact#2's grade, low, of which this is the mirror. But it's this round's regression, and its fix is one line.

**Fix, test first.**

- **The test:** `ZZR2W1`'s shape, in `tests/lovejoin-planner.test.ts` beside "asks again, rather than stop". It expects the chain stopped by the first ask past LANDING_MS, and the rest back on Bring back. It fails on the merged code (above).
- **The change:** `sessions.ts:5409`. An Ogmios a block behind has caught up long before LANDING_MS, the bound tailChain already gives a listing behind the chain:

  ```ts
  const ours = waited < LANDING_MS ? new Set([...pending.txs.slice(0, i).map((x) => x.txHash), ...(box ? [box] : [])]) : new Set<string>();
  ```

  `LANDING_MS` is then imported from `./lovejoin` (`fix-witnessTail.diff`).
- **Tried in the scratch copy:**
  - `ZZR2W1` stops at +15 m.
  - "asks again, rather than stop", "lets a box of any pool come back while its mix waits", the busy-giveme.my waits and the way-out tests pass.
  - Both files run in full: 94 of 94.
- **The alternative:** look the named box up (`utxo_info`) before calling it behind. That's one more request per ask.

## r2-worker#2 · low · Mix my boxes again avoids the wallet's own boxes once Ogmios names them

**Where:** `EXT/src/background/lovejoin.ts:4619` (unstale adds every name to `avoid`). `split()` puts `avoid` into `reserved`, and `reserved` removes the wallet's own boxes too:

- `:3801`, fanOut's `owned` and `if (again && !owned.length) throw new LovejoinSkipped(… noneLeft)`;
- `:5052`, publicAgainBuild's `theirs`.

**What's wrong.**

- Mixing again, the first mix spends the wallet's own boxes from the pool read (crossCheck: "a mix whose inputs are all on chain"). So a 3004 can now name one of them.
- **It may be truly gone,** moved by another wallet's mix: still the wallet's, at a new outpoint the listing doesn't show yet. **Or Ogmios may be behind the listing:** on preprod, or mainnet's Koios fallback.
- **Either way, `avoid` takes it out of the wallet's own set,** not only out of the draws, one per try. Before this round the names were `[]`, and three tries ended in `lj.poolDrifted` ("… Try again in a minute."), a KoiosError. A session's runner tries that again later (`leftOut` rethrows it).
- **Now,** with one or two of the wallet's boxes there, the second or third try finds none of its own:
  - **public:** `lj.noneFromAccount` (`:5052`);
  - **private:** a LovejoinSkipped, which buildBack's `leftOut` turns into the session's skip. Its mix is given up and the session comes back directly.

**Evidence.**

- **`ZZR2W2`** (`w2-insert.ts`), publicAgainBuild on `cutAfterDeposit()`: the public account's two boxes, Ogmios naming the first of them the mix spends.
  - **Merged:** `evaluations 2: refused: None of your boxes in Lovejoin's pool came from a mix from your public account.`
  - **Reverted:** `evaluations 3: refused: Lovejoin's pool changed while the wallet read it: a box it drew isn't there anymore. Try again in a minute.`
- **`ZZR2W3`** (`w3-insert.ts`), the private balance's Mix again: `againBuild`, `mixOutSubmit`, the funding landed, then `advance`, Ogmios naming the box.
  - **Merged:** `named 1; … mix.skipped="none of your boxes is in Lovejoin's pool anymore"; … txs=out,deposit`. The mix was given up, and the session went on to come back directly.
  - **Reverted:** `named 3; … mix.skipped=undefined; retry="Lovejoin's pool changed while the wallet read it: … Try again in a minute."; txs=out`. Nothing sent, tried again later.

**The failure.**

- **The trigger:** a block's lag between the pool listing and Ogmios, just after another wallet's mix drew one of the boxes, or a backend behind.
- **The public Mix again** says none of the account's boxes came from it.
- **A private Mix again's session** gives up the mix the user asked for. It pays its fees and comes back, its boxes unmixed, under `lj.skip.warn.noneLeft`, a `.warn.` line that says the boxes are gone from the pool. They aren't: they're at the old outpoint, or at a new one the next read lists.
- **Rare:** every one of the wallet's boxes in the first mix must be named in turn. Nothing is lost but that session's fees.

**Fix, test first.**

- **The tests:** `ZZR2W2` expects `lj.poolDrifted`; `ZZR2W3` expects no skip and a retry. Both fail on the merged code.
- **The change:** a name avoids a draw, never one of the wallet's own boxes. Keep `split()`'s `avoid` apart from the reservations, and leave it out of `owned` (fanOut) and `theirs` (publicAgainBuild). Others' boxes are still avoided.
- **What then happens:**
  - a box behind is drawn again, and the tries end in `lj.poolDrifted` as before;
  - a box that's gone is left out by the next fresh read that's caught up.
- **Must still pass:** `tests/lovejoin.test.ts:687` (others' box avoided) and the runner's case at `:2257`.

## Checked, and it held

**`RewardsChangedError`, now raised on both networks, at every catcher:**

- **Where it's thrown and caught.** It's thrown only at `koios.ts:1248`, with no `trouble` and no `failure`. It's caught by type only at `lovejoin.ts:5434`/`:5456` (pumpPublicNow), `:7718` (withdrawOne) and `sessions.ts:5309`/`:5321` (pump).
- **No wrong side's words.** No Lovejoin builder stages the account's own rewards: WebAssembly's `withdrawing()` is called only by move_in, account_send and account_mint. So every RewardsChangedError a Lovejoin catch sees is a pool's `mix_logic` account, and REWARDS_MOVED is right there. That holds for the public chain, a session's chain and its collateral's mix, a direct return's tail, and a session that runs itself.
- **Staking's Withdraw and Stop staking, a payment that spends rewards, a session's funding:** no catcher. Staking's words show; `unsentWhyOf` still says `network`, as at PV10.
- **A site's transaction:** `dapp.ts` `notSent` gives the site English `dapp.notSent`, as for any refusal. The window's detail is staking's words, as PV10's were.
- **Retries:**
  - `chainRetryMs` and `mayBeIn` don't retry it.
  - A refusal of a resend that may have gone still stops a public chain as maybe sent (`unsure`), and a session's chain at that step, as before.
  - withdrawOne rebuilds once (`again`). `forgetWithdraw` drops the first try's spent and sent marks, so the rebuild's `takingFrom` doesn't count it. Its due time is taken back and given back, under `unlocked` as before.
  - settleWithdrawing swallows every resend's refusal, as before (worker#3 stays a backlog line).
  - A session that runs itself rebuilds its return from a fresh read at its next step, its retry line in Lovejoin's words.
- **Stops:**
  - Nothing stops now that didn't before. At PV11 every one of these flows already stopped on the raw KoiosError.
  - What's new is the words, and withdrawOne's rebuild, which T12c, T12d and the `it.each(NOT_IN_REWARDS)` cases hold.

**worker#1's rethrows, keeping `trouble` and `failure`:**

- Both are always undefined on a RewardsChangedError: submitTx builds it from staking's words alone.
- The data layer hands it on unwrapped: `failureOf` is undefined, so `throw e`.
- Nothing downstream reads them differently:
  - `retryReasonOf` gives `other`, as before;
  - `maybeSent` reads KoiosBusyError only;
  - `submitFallback` is never reached;
  - `codeOf` (ui-port) maps only StaleReviewError and CollateralRefusedError.
- `dropPending` sits before the rethrow uncaught, as it was before.

**`WithdrawalsMissingAccounts` as a RewardsChangedError:**

- **Staking** gives `koios.staking.changed`, checked before `NotDelegatedToDRep`.
- **Lovejoin** gives REWARDS_MOVED, and withdrawOne rebuilds once, then words it. It's reachable only for a pool whose `mix_logic` account was never registered: v2's `publish` handler allows `RegisterCredential` alone (`git show 29573c5:contracts/validators/mix_logic.ak`), so a launched pool's account can't be deregistered. That restores PV10's one name for both cases.
- **The new DELEG and GOV substrings:** none matches `ProposalDepositIncorrect`, `ConwayDRepIncorrectRefund`, `ConwayDRepAlreadyRegistered` or a treasury withdrawal's GOV names.

**`unknownInputs`' names (v-pv11-impact#2):**

- **Which input is named.**
  - Only one input is named, the first missing in ascending order: one TxInfo per language, built with `mapM` over `Set.toList` of the inputs.
  - Never the collateral: it isn't in the script context.
  - A reference input only after every spending input.
  - Ogmios 6.14 builds its 3004 only inside a script failure's encoding (`Data/Json/Ledger/ScriptFailure.hs:109-111`), so the recorded per-redeemer shape is the live one.
- **crossCheck's `avoid`, for others' boxes:** they leave the draws only.
  - The floor is counted on every other box.
  - At most one is added a try, for three tries.
  - A name that isn't a pool box (a reference input, the chain's own earlier output) changes nothing.
- **reserve()'s StalePool** (a direct return's tail, `sessions.ts:4779`) still comes from the wallet's own reservations alone.
- **What bounds the asking again:**
  - `unstale`: STALE_POOL_TRIES, then `lj.poolDrifted`;
  - tailWitness: TAIL_KEEP_MS alone, the way out from TAIL_OFFER_MS, or a lock (r2-worker#1).
- **No loop.**

**The balance lane:**

- **`takenOf`** sums readsFor's takes, so an unread read takes 0. A chain that fell back from four to three is summed as built.
- **`publicAfter`** is `before − publicLeaving + taken`, in the same place TotalRows put its after row. A review kept before the update has no `taken`, which reads as 0.
- **The Bootstrap's skipped read:**
  - A private Bootstrap never reaches `acrossOf`: buildBack passes `record.mix.pool`, so `pool === undefined` is false.
  - It never gets a collateral pool (`depositOnly`).
  - So `depth > 0` skips every read it made, and its Send reads none (no `balances`).
  - Mix again's depth is Settings', 1 to 3.

**The guard lane's `everyKept` at a signature:**

- **What it reads:** discovery's local record and the head start, through `kept()`. No request and no write.
- **When:** only when a site's transaction names a script's reward account (`paidScripts`).
- **Locked or fresh:**
  - The sealed copies are always kept pools, so the set is the classic pool plus every kept pool, locked or not.
  - A fresh worker verifies each kept pool once. A pool's id is its P, unique to its launch, so `mixLogicOf`'s cache by id never takes one copy for another.
  - A record that can't be read falls back to readSet's set. A trap is handed on.
- **The connector's answer** doesn't depend on the boxes or on the lock.

## Notes for the lead

- **R2's concurrency.** R2 had another reviewer's mutant in `seedelf-core/src/lovejoin/mod.rs` while I worked, so my reverts went to a private scratch copy. Several reviewers editing R2's same files at once would race each other's mutants and restores.
- **Older than this round, unchanged by it.** A 3010 of 3004s alone, with a key input or a reference input missing and no 3110, still isn't stale; `lovejoin-refusals.test.ts:162` pins that. crossCheck then reads it through `declaredCovers` as the network's refusal: a LovejoinSkipped, so a session's return leaves Lovejoin out. One way in is Mix again from the public account, its fee UTxO fresh and Koios's Ogmios behind. Nothing here made it likelier.
- **tailChain's rebuild** takes no names (`split(…, undefined, pool)`). So a listing still behind may draw the box that went again, and TAIL_TRIES (2) then ends the tail. That's older than this round too.
