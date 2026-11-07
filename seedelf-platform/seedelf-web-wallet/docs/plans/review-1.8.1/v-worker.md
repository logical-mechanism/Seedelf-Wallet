# 1.8.1 review · v-worker: worker#1, #2, #3 and #5 traced

Verifier id `v-worker`. Tree: `web-wallet/release-1.8.1` at `2a8060d3`. Each claim traced against the code as merged, with the finder's repros re-run and extended.

| id | verdict | severity | fix in 1.8.1 |
|---|---|---|---|
| worker#1 | confirmed, once readers#4 is fixed | low | yes, in the same change as readers#4's |
| worker#2 | narrower | low | no: a backlog line |
| worker#3 | narrower | low | no: a backlog line |
| worker#5 | confirmed | nit | no (safe, optional) |

No new findings.

## What I ran

- **Vitest, by name.** Each file ran alone (`npx vitest run tests/zz-r181-v-worker-<n>.test.ts`) and was deleted from the tree afterwards. Copies are in `SCRATCH/review/v-worker/`.
  - `zz-r181-v-worker-1`: the finder's repro 1, re-run (4 cases).
  - `zz-r181-v-worker-2`: three cases with a ledger model. A withdrawal must be the whole balance of the 5 ₳ pool's `mix_logic` account, and a take empties it at once.
    - Today.
    - The finder's fix, simulated: the tail's `takes` deleted from its reservation, which is what the fix gives this chain.
    - Due withdraws while a tail waits, with Koios's Ogmios held behind for the tail. A withdraw doesn't ask Ogmios.
  - `zz-r181-v-worker-3`: the finder's repro 3, re-run, plus `koios.ts`'s reading of five refusal bodies.
  - `zz-r181-v-worker-5`: a private and a public Bootstrap, counting `account_info` asks for the pool's `mix_logic`.
- **Source.** cardano-ledger master's Conway `Rules/Mempool.hs` (GitHub), and the `Ledger.hs` readers saved in `SCRATCH/review/readers/`.
- **Stand-in.** The refusal in my repros is the PV10 name (`WithdrawalsNotInRewardsCERTS`), which `koios.ts` matches today. It stands in for readers#4's fixed match of PV11's `ConwayIncompleteWithdrawals`.
- **Nothing else:** no e2e, no live run, no submit, no network beyond GitHub.

## worker#1 · confirmed (as it will be once readers#4 is fixed) · low

**It holds.** Both catches give the chain's record Lovejoin's words, then rethrow the original error, in staking's words:
- `lovejoin.ts:5390-5411`: `stopped = … RewardsChangedError ? REWARDS_MOVED() : …`, then `throw unsure !== undefined ? new Error(sending.stopped) : e;`.
- `sessions.ts:5309-5319`: `why = … REWARDS_MOVED() …`, then `throw e;`.

**Where users see it.** Every Lovejoin chain submit exits through these two catches:
- the public chain's (`lovejoin.ts:5297`), and a session chain's step (`sessions.ts:5592` `submit`, under `pumpChain` → `pump`);
- `withdrawOne` words its own second refusal (`:7675`), and `settleWithdrawing` swallows its refusals (`:7836`).

The rethrown message shows in four places:
- the public mix's review (`Lovejoin.tsx:3032`, `setError(e.message)`);
- a reviewed return's Send (`backSubmit`);
- Bring everything back's `failed[].error` (`sessions.ts:3361`);
- the runner's `auto.retry.error` (`sessions.ts:3651-3654`), shown by `detailOf` as "What went wrong".

`progress` swallows `pumpPublic`'s throw, so the Lovejoin page shows `stopped` alone.

**Repro `v-worker-1`** (PV10 name), all four as the finder said:
- **Public Send:** `Your staking rewards changed since you reviewed this. Review it again.` Its progress says `The network refused it: Lovejoin's pool changed as it was sent. Nothing was lost.`, with `next: 1`.
- **Return Send:** the staking words. The session chain's `stopped` is Lovejoin's.
- **Runner:** `Why it stopped: The network refused it: Lovejoin's pool changed as it was sent. Nothing was lost. It tries again at 00:00:30. What went wrong: Your staking rewards changed since you reviewed this. Review it again.`
- **Claim:** `failed: [{"index":0,"error":"Your staking rewards changed since you reviewed this. Review it again."}]`.
- **`v-worker-2`'s first case** shows the public path again, in a tail's wait.

**Today it can't happen.** At PV11 the node says `ConwayIncompleteWithdrawals`, which is a plain `KoiosError` (`v-worker-3`: "short alone, PV11: KoiosError"). So `stopped` and the rethrown message are both the node's raw JSON. That is readers#4's finding. worker#1 goes live with readers#4's match.

**The plan is the finder's reading.** It says Lovejoin's flows "say their own words" (chunk-43 plan `:147`), and that a chain refused while it's sent "stops in Lovejoin's words, never staking's" (`:175`).

**The fix is complete and safe.** The finder's two lines cover every path. Nothing downstream reads the type, except as a `KoiosError`:
- `ui-port.ts:13` maps only `StaleReviewError` and `CollateralRefusedError` to `stale`;
- `retryReasonOf` (`sessions.ts:290`) reads `trouble`, which is unset either way;
- no `instanceof RewardsChangedError` exists outside the two catches and `withdrawOne`.

After the fix, the runner's detail says the one sentence twice (`stopped` and `retry.error`). It does that today for every other stop reason too: `pump` sets `stopped = e.message` and rethrows `e`.

**Tests that must fail without it** (readers#4's PV11 body as the refusal):
- `lovejoin-reward-balance.test.ts:153` asserts `publicSubmit` rejects with `REWARDS_MOVED()`, rather than `.catch(() => undefined)`.
- New cases: `backSubmit` rejects with `REWARDS_MOVED()`; `claimSubmit`'s `failed[0].error` is `REWARDS_MOVED()`; and the runner's `auto.retry.error` is `REWARDS_MOVED()`.

## worker#2 · narrower · low · no fix in 1.8.1: a backlog line

### How long a tail waits

A tail's mix is sent once every transaction before it is on chain (`pumpChain`'s `unwitnessed`), and giveme.my has signed it (`witnessTail`). It's pumped at Send, then by the runner every minute (`sw.ts:87`), and by an open page.
- **Normally:** the deposit lands in a block or two, and giveme.my signs at the first ask. That's a minute or two after Send.
- **At worst:** giveme.my busy or out of reach, or Koios's Ogmios behind (`sess.notCaughtUp`).
  - It's asked again after 1, 2, 4, 8 and 16 minutes, then every 30 (`TAIL_WITNESS_WAIT_MS`).
  - That goes on up to `TAIL_KEEP_MS`, 24 h from the deposit landing (`lj.tail.tooLong`).
  - The backoff outlasts the trouble: in `v-worker-2`'s third case, Ogmios caught up at +24 m, and the tail went at +32 m.
- **giveme.my refusing** (not busy) after `GIVEME_BEHIND_MS` (3 min) stops the chain, and the claim goes with its reservation (`pump`'s catch, then `release`).

### Each of the finder's failures, traced

**(a) holds: the wallet's other flow in that pool is cut.** `v-worker-2`, today:
- The public Send inside the wait was refused in staking's words, with `stopped` in Lovejoin's and `next: 1`.
- Ledger: `refused a244c3c7: withdraws 0, the account holds 500000000`, then `took 4c78acd4: withdraws 500000000`. The second is the tail, once giveme.my answered.
- The return went in full (`out,deposit,mix,back`).

**(b) is narrower: due withdraws don't meet a normal wait.**
- `mayLand` (`lovejoin.ts:1500`) holds every due withdraw for `LANDING_MS` (15 min) from when the tail's deposit was first known in. `landedDeposit` (`:6568`) marks a chain landed only by its last maker, and for a chain with a tail that's the tail's mix.
- `QUIET_AFTER_SEND_MS` also pushes a box due within 5 minutes of the Send's deposit.
- Past that, while the tail still waits, every run builds the due box on 0, asks giveme.my twice, and is refused twice. That's with readers#4's fix. Today it's once each, since `withdrawOne` builds again only on a `RewardsChangedError`.
- `v-worker-2`'s third case:
  - **+1 to +15 m:** nothing.
  - **+16 to +31 m, every minute:** `giveme.my asked 2, ledger refused …: withdraws 0, the account holds 500000000; refused …`.
  - **+32 m:** the tail took the balance.

**(c) holds.** `withdrawNow` (`:6958`) checks `chainsMixing` and `settleWithdrawing`, but not `mayLand`.

**The owner's call has a consequence nobody wrote down.** The plan's `:77` covers a tail in its chain's own pool only. Under lucky winner, a tail alone in its pool is built first and sent last. It holds the balance from Send until it goes, so the wallet's own flows in that pool are refused meanwhile.

### Which fix

**The finder's smallest fix** (leave a tail's mix out of `takes`), simulated in `v-worker-2`'s second case:
- The public mix took the balance (`took 1c03b792: withdraws 500000000`), and its Send went.
- The tail's mix was then refused: `refused 9ddf536d: withdraws 500000000, the account holds 0`.
- The session's return, already sent, stopped at the tail:
  - `stopped` in Lovejoin's words, txs `out,deposit,mix`;
  - `tailHeld` set: the page offers the rest without the tail an hour after its deposit landed;
  - a site's session waits for the user to build the return again (`buildBack` → `tailChain`, which reads afresh). Only a session that runs itself is rebuilt by the runner.
- **What it breaks:**
  - It moves every conflict onto a return the user already sent. In (b), the likeliest case, a background due withdraw would stop the user's return. Today the withdraw waits and the return completes.
  - It changes what every reservation claims (`spent.ts` `reservationOf`), which readers#3's proposed fix would build on.

**The alternative** (due withdraws wait for such a tail):
- It ends (b)'s waste and keeps the return whole.
- For a tail that took a balance, it brings back the day-long wait that x-scenarios-lj#1 removed.
- (a) and (c) stay, unless Bring one back now and Bring every box back get the rule too. That's a new wait across three paths.

**None, a backlog line, recommended.**
- **It's rare.** It needs:
  - a balance (mainnet's three `mix_logic` accounts hold none, per readers);
  - a tail alone in its pool: a direct return with its collateral mixed, or a token pool's mix;
  - another flow in that pool inside the wait. For (b), a wait past 15 minutes.
- **Nothing is lost:**
  - every refusal is in phase 1;
  - a cut chain's boxes wait for Mix my boxes again, which the owner's cut-chain backlog line covers;
  - withdraws come back later.
- **The line:** the lucky-winner consequence above, for the owner to choose first built or first sent if it ever turns up.

## worker#3 · narrower · low · no fix in 1.8.1

**The mechanism holds as the finder said.**
- `settleWithdrawing` (`:7789-7848`) resends every `CHAIN_RESEND_MS`, with `submitTx(bytes).catch(() => undefined)`, until `SPENT_KEEP_MS` from `at`.
- Meanwhile every way back waits:
  - `withdrawDue` returns nothing (`:6763`);
  - Bring one back now says `lj.lastBoxMaybe` (`:6976`);
  - Bring every box back waits (`:7195`, `elsewhere("withdraw")`).
- Repro `v-worker-3`, re-run:
  - **+4 m:** 2 submits. **+30 m:** 11. **+60 m:** 21. **+110 m:** 37. Each time Bring one back now said "The last box may still be on its way back…".
  - **+125 m:** dropped, after 42 submits.

**The hold isn't new.**
- A maybe-sent withdraw whose box another wallet's mix drew meanwhile is refused as spent at every resend. That's a `SpentInputError`, which can't be told from a copy already in.
- It holds every way back for the same 2 h. The comment at `:7835` names the case ("or its box moved").
- #367 adds a rarer way in, which, unlike that one, can be told apart.

**Today the fix can't fire.** PV11's `ConwayIncompleteWithdrawals` is a plain `KoiosError`, swallowed like every other refusal. The fix needs readers#4's match first.

**What the node answers when the inputs are spent and the withdrawal is short:**
- **All inputs spent** (a copy landed, or sits in that node's mempool):
  - Conway's MEMPOOL rule answers `ConwayMempoolFailure "All inputs are spent. Transaction has probably already been included"`.
  - It then skips LEDGER, whose `trans @(EraRule "LEDGER")` sits under `whenFailureFreeDefault`. No withdrawal failure is reported at all.
- **Some inputs spent:**
  - LEDGER checks the withdrawals first (`Ledger.hs:406`, inside the phase-2-valid branch, before CERTS at `:414`).
  - It runs UTXOW after the if/else (`:448`), with no `whenFailureFree` guard.
  - So `ConwayIncompleteWithdrawals` and `BadInputsUTxO` come back in one list.

**Which check wins in `koios.ts`: spent.** It checks `BadInputsUTxO` and `All inputs are spent` (`:1227`) before `stakingRefusal` (`:1232`). `v-worker-3`'s five bodies:

| body | `koios.ts` reads it as |
|---|---|
| all inputs spent | `SpentInputError` |
| some spent and short, PV11 | `SpentInputError` |
| some spent and short, PV10 | `SpentInputError` |
| short alone, PV10 | `RewardsChangedError` |
| short alone, PV11 | `KoiosError` |

**The finder's safety argument holds, with one edge left.**
- A `RewardsChangedError` on a resend means nothing the withdraw spends is spent, in that node's ledger or its mempool.
- **The edge:** a copy only in another node's mempool, or on a fork, three minutes or more after the first send.
- **If such a copy lands after the drop:** nothing is lost, since the box and the balance go to the user's register. The bookkeeping goes wrong in three ways:
  - its due time is given back;
  - the wallet writes no history for it;
  - a second withdraw may be built from a stale read, and is refused as spent.

**The fix, if it's ever taken with readers#4's:**
- In `settleWithdrawing`, a resend refused with `RewardsChangedError` runs `neverWent` and `forgetWithdraw`, and returns false.
- Tests, in repro 3's shape with readers#4's PV11 body:
  - after such a refusal, `withdrawing` is dropped at that run and its due time is back;
  - a resend answered `All inputs are spent`, or `BadInputsUTxO` beside `ConwayIncompleteWithdrawals`, keeps it withdrawing.
- **Not for 1.8.1.** The trigger is a balance, an unanswered submit and a lost race. The hold is bounded and was already there. `settleWithdrawing` has been through many review rounds (F5, F6, M11, L8, L11).

## worker#5 · confirmed · nit

**It holds.**
- `fanOut`'s `attempt` (`lovejoin.ts:3826`) reads with no depth check.
- A private Bootstrap is built through `buildBack` → `lovejoin.chain(…, fixed 0)` (`sessions.ts:4636-4649`) → `fanOut`.
- `balancesOf` (`:901`) finds no withdrawal, so the read reaches nothing.
- The public Bootstrap reads none (`:4852-4853`).

**Repro `v-worker-5`.**
- **Private Bootstrap:** 1 `account_info` ask for the pool's `mix_logic`, txs `out,deposit,back`.
- **Public Bootstrap:** 0.

**No other read on its path.**
- The funding asks none.
- `balancesHeld` → `rewardsMoved` returns at `!reads?.length`.
- `sessions.ts:4729` reads only with a collateral pool, which a Bootstrap never gets (`intoPool`'s `!depositOnly`).

**Fix, safe and optional:** `...(depth > 0 ? rewardsField(await this.rewardsOf(network, c, [pool, c.collateralPool?.pool])) : {})`.
- Depth 0 belongs only to a Bootstrap's or a seed's session (`LOVEJOIN_DEPTHS` is 1–3), and those never get a collateral pool. So no tail loses its read.
- The test: `v-worker-5`'s private case asks none.
- Not worth a patch on its own: it's one request a private Bootstrap, naming a public pool, as every other Lovejoin build does.

## Checked, and held

- **The rethrow sites.** The two catches are the only exits for a Lovejoin chain's refusal. The submits are at `lovejoin.ts:5297`, `:7657`, `:7836` and `sessions.ts:5592`, and `progress` swallows.
- **The tail's claim.**
  - `reservationOf` (`spent.ts:200`) takes every transaction's withdrawal, the tail's mix included.
  - `takingFrom` counts reservations being sent (no `until`).
  - `reserve` (`lovejoin.ts:4691`) is called with the chain's whole `txs`.
- **The waits.** `tailWaits`, `mixing`, `mayLand` and `landedDeposit` read as traced, and so do the quiet rule (`quiet`, `QUIET_PUSHES`) and `withdrawNow`'s guards.
- **The plan and backlog.** Neither has a line on a tail alone in its pool (chunk-43 plan `:77`; `backlog.md:51-53`).
- **The ledger source.** Mempool and LEDGER order, as above.
- **Safe to drop the read.** `balancesOf` handles no reads, and `LOVEJOIN_DEPTHS` is `[1, 2, 3]`.
