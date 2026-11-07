# 1.8.1's release review: v-readers

**Task:** trace readers#1, readers#2 and readers#3 (readers.md) against `web-wallet/release-1.8.1` at `2a8060d3`, judge each proposed fix for a patch release, and say what else reads what it changes.

**In short:**

| id | verdict | severity | fix in 1.8.1? |
|---|---|---|---|
| readers#1 | confirmed | low | yes: the backlog line at least; the code fix is small and safe |
| readers#2 | narrower | low | no: the fix as worded regresses the rule it changes |
| readers#3 | wider | low | no: the proposed fix cuts the next return's chain after its deposit, in the repro's own shape |

No new findings. readers#3's wider effect is worker#2's failure (a), reached through Bring everything back's own "Review it again". The proposed fixes for readers#3 and worker#2 conflict. See *For the lead*.

**The repros** were `EXT/tests/zz-r181-v-readers-{1,2,3}.test.ts`, each run alone with `npx vitest run tests/zz-r181-v-readers-<n>.test.ts --silent=false`. They're deleted from the tree, and kept at `SCRATCH/review/v-readers/`.

- `-1` is readers' repro 1 as it was.
- `-2` is readers' repro 2, plus a case for the 16-send cap.
- `-3` is readers' repro 3's harness with a simulated ledger. Koios's `submittx` refuses a withdrawal from the 5 ₳ pool's `mix_logic` account that isn't its balance as the mempool leaves it (`NOT_IN_REWARDS`), and takes the balance to 0 once one withdraws all of it. It runs three cases.
- readers' own repro 3, run unchanged first, gave readers' output exactly: takes `[null,"500000000",null]` and `[null,"500000000","0",…]`, 501.82 ₳ and 509.48 ₳ back, `sent [0]`, `failed [1]` "Lovejoin's pool changed since you reviewed this. Review it again."

## readers#1 · confirmed · low

**What holds.** A mix or a Mix again from the public account that takes a pool's balance N puts N in its change, at the public account. Its review's "Public account after" leaves N out.

- `Lovejoin.tsx:4002`: `publicLeaving = (summary.again ? 0n : BigInt(summary.boxes) * BigInt(box.lovelace)) + BigInt(summary.fees)`.
- `ReviewTotals.tsx:63`: `<AfterRow side={side} lovelace={BigInt(before) - leaving} />`.
- `lovejoin.ts:4906` and `:5080` set `change: chain.returned`, which counts N. No screen reads `change` (a grep of `src/ui`).
- The after row shows only where `pool.id` is set (`Lovejoin.tsx:3125`): every v2 and token pool. The classic pool is retired.

**Repro** (`-1`, the real WebAssembly, v2's 5 ₳ pool, Home's 65 ₳):

- With none in the account: change 51.516966 ₳, fees 3.483034 ₳, "Public account after 56.516966 ₳".
- With 500 ₳ there: change 551.517699 ₳, fees 3.482301 ₳, "Public account after 56.517699 ₳".
- Once it lands the account holds 556.517699 ₳ (65 − 5 − 3.482301 + 500).
- `backlog.md:51` says "a return's or a public mix's review counts what comes back with it". A return's Back now does. A public mix's review doesn't: nothing on it counts N.

**The fix, small and safe:**

- `taken?: string` on `LovejoinPublicSummary` (`rpc.ts:2232`), set in `publicBuild` (`lovejoin.ts:4893`) and `publicAgainBuild` (`:5069`). It's the sum of `readsFor(reads, chain.txs)`'s amounts, which the build already computes for `balances`, and it's set only when it's more than 0.
- `TotalRows` gets an optional `back` (default `0n`), added to the after at `ReviewTotals.tsx:63`. `PublicReview` (`:4041`) and `PublicAgainReview` (`:4107`) pass `BigInt(summary.taken ?? "0")`.
- With nothing taken, no field is set and nothing renders differently. A Bootstrap withdraws nothing.

**What else reads that summary or that row:**

- Only the Lovejoin screen renders `LovejoinPublicSummary`. `KeptPublic` extends it and stores it.
- **e2e:** `extension.spec.ts:3118` checks the after row at N = 0 (`/^Public account after10,434\.\d+\s₳$/`), and is unchanged. `:3119`'s `snap` writes a `test-results/` screenshot, not a store image, also unchanged. `:3421` and `:3879` check other rows. `store-images.spec.ts` has no Lovejoin screen.
- **Unit tests:** `lovejoin-merged-screens.test.ts:246-272` (R9) renders summaries without the field, so it's unchanged. The new render test goes there.
- **flows.md** documents Send's after row (`:236`), not Lovejoin's public review: nothing to change there.

**The tests that must fail without it:**

- R9's block: `review({ ...summary, taken: "500000000" }, "100000000")` contains "Public account after 573.147786 ₳".
- `lovejoin-reward-balance.test.ts`: `publicBuild` with 500 ₳ gives `summary.taken` "500000000", and with none there's no `taken` key.

**For 1.8.1:** at least correct `backlog.md:51`, the premise the owner's call 1 rests on (a return's review counts it, a public mix's doesn't). It's docs, at no risk. The code fix is the owner's pick. It makes the line true without adding the review line the owner left out. It errs today in the user's favour, and only with a balance.

## readers#2 · narrower · low

**What holds.** `takingFrom` (`lovejoin-rewards.ts:68-79`) counts each kept sent transaction whose inputs are still held as spent (`goingOut(sent, spent, { either: true })`), landed or not. `balanceAfter` (`:86-88`) then gives 0 for any reading at least as large. Repro `-2`'s first case, re-run:

- A landed take, then 500 ₳ new an hour later, reads `0`.
- Past two hours from its send, the same reading is `500000000`.

**Narrower than "two hours":**

- `rememberSent` keeps at most 16 chain-class sends (`sent-txs.ts:43` `KEEP = 16`, `:85`). Every Lovejoin send is remembered with no account (`lovejoin.ts:5338`, `:5399`, `:7649`, `:7837`; `sessions.ts:5559`, `:5578`).
- So 16 more of the wallet's chain or session sends push the take out. The same reading is then taken whole. Repro `-2`'s second case: "take still kept? false", and the read 20 minutes on is `500000000`.
- A lock wipes both records (session storage). The auto-lock runs 1 to 60 minutes, 15 by default (`preferences.ts:76`, `wallet.ts:49`).

**How reachable.** All of these at once:

- a balance in a pool's account (rare by the owner's call; mainnet's three hold 0 today, per readers);
- this wallet's own transaction took it;
- an epoch's start within that window paying as much again. A balance arrives only at an epoch's start: about 1.7% of a mainnet epoch's 120 hours, 8% of preprod's day. Takes cluster just after a start, since every other wallet's mix there is refused until one takes it, so it's rarer still;
- the wallet unlocked throughout;
- a build in that pool by this wallet in that time.

The effect is a phase-1 refusal at no cost. A chain stops after its deposit, or a way back waits. It clears by itself.

**The fix isn't safe as worded:**

- **"A chain record done" isn't "landed".**
  - `pumpChain` "returns true once all of it is sent" (`lovejoin.ts:447`, `:548`).
  - On that, `pumpPublicNow` (`:5350`) and sessions.ts `pump` (`:5321`) call `chainEnded`, which sets `done = true` (`:5633`), and release the reservation.
  - A direct return's chain sends its collateral's mix (the take) and its sweep back to back, so it's "done" while the take is still in the mempool. That's the very case the rule exists for: "Koios and the data layer report it until their block".
- **"Outputs the build's fresh pool read lists" is a real landing signal, but from one read, while `account_info` is another.**
  - Koios balances several backends, and spent.ts saw one 20 minutes behind. Then the build takes the old balance and is refused.
  - account.ts accepted that trade (`account.ts:190`: "Should account_info be behind the UTxOs, the withdrawal is refused at Send, nothing lost") because its refusal comes at Send, before anything goes.
  - A Lovejoin refusal comes after a deposit and cuts the chain.
  - So the fix trades one rare refusal for another of the same cost, through the rule every Lovejoin build reads.

**For 1.8.1:** no fix. If the owner ever wants the window shorter, the smallest change is `recentlySent` (`SENT_KEEP_MS`, 20 minutes, the longest a backend was seen behind) in place of `heldSent` in `readRewards` (`lovejoin.ts:4640`). Its test is the repro: a landed take, then 500 ₳ an hour later, read whole. Not recommended for a patch.

## readers#3 · wider · low

**What holds.**

- `readRewards` counts only reservations being sent (`lovejoin.ts:4642`: `const sending = Object.values(kept).filter((r) => r.until === undefined);`).
- Every return Bring everything back builds is kept for Send with an `until` (`lovejoin.ts:3843`, `:4078`; `sessions.ts:4776`). The builds go in turn (`sessions.ts:3319`), so each reads the same N.
- The review's Back now sums them (`ClaimAll.tsx:257`).
- At Send (`:3352`), once the first goes, each later return's `balancesHeld` reads 0 against its N and is refused.
- Sends go in build order (`ClaimAll.tsx:125`).

**Wider.** readers says "a second review then sends them, reading 0". That holds only once the first return's take has gone out.

- In the repro's own shape, session 0's take is its collateral's mix under giveme.my's collateral. `pumpChain` sends that only once every transaction before it is on chain (`lovejoin.ts:509`; `:531`, `if (chain.flying.length) break;`). `claimSubmit` pumps with no budget (`sessions.ts:5240`), so only its deposit goes at Send.
- A second review before that take is in builds session 1 at 0, since session 0's unsent take counts as on its way. Send's read then passes (0 = 0). Session 1's deposit goes, and its first mix, withdrawing 0 while the ledger holds 500 ₳, is refused. Its chain stops after its deposit, its boxes unmixed.
- The wallet's own "Review it again" sends the user straight into that window.
- This is worker#2's failure (a) ("another session's chain builds on 0, its deposit lands, and its first mix is refused"), reached through readers#3's flow.

**Repro `-3`, the simulated ledger, three cases:**

1. **Today's code.**
   - The first Send: `sent [0]`, `failed [1]` "Lovejoin's pool changed since you reviewed this. Review it again.". Nothing has taken the balance yet: session 0's mix waits for its deposit's block.
   - The second review: session 1's mixes all withdraw 0.
   - Its Send: the ledger refused session 1's first mix (`bd57cfc7…`), and `failed [1]` reads "Your staking rewards changed since you reviewed this. Review it again." (worker#1's words).
   - Session 1's chain: 9 transactions, 1 sent, stopped "The network refused it: Lovejoin's pool changed as it was sent. Nothing was lost."
2. **readers' fix, simulated.** `rewardsIn` and `reserve` are wrapped on the service while `claimBuild` runs, so later builds count what earlier returns take.
   - The review is right: 501.82 ₳ + 9.48 ₳ back.
   - At the first Send, session 1 passes Send's read once session 0 is being sent. Its deposit goes and its first mix (`ded5cda5…`, withdrawing 0) is refused: `failed [1]`, its chain stopped after its deposit.
   - Today's first Send refuses session 1 before anything of it goes.
3. **The same fix, where session 0's take is its chain's first mix** (40 ₳ each, 30 strangers' boxes). That take goes in its first window, and both are sent (`failed []`, the ledger taking 500 ₳ from session 0's `60636fc7…` first).

**The fix, judged:**

- **Not safe.** It holds only where the earlier return's take goes in its own first window (case 3). Where it's a collateral's mix under giveme.my's collateral (a session too small for a box, its collateral into the 5 ₳ pool: case 2), it moves the cut into the first Send.
- **Not small.** Three build paths read the balance: `sessions.ts:4729` (a direct return's tail), `lovejoin.ts:3826` and `:4035` (chains, through `rewardsOf`), and `:4485` (`tailChain`). So the takes would be threaded through `buildBack`, `chain()`'s options, `tailChain` and `rewardsIn`.
- **It conflicts with worker#2's fix.** worker#2 leaves a tail's take out of a reservation until it's sent. With both, Send's read sees the later return's 0 against the reading N and refuses it again, as today.

**The lucky-winner call's consequence, unwritten:** with a balance, two of the wallet's own transactions in one pool race for it.

- Bring everything back builds every return on the same balance and counts it in each one's Back now.
- Send keeps the first and refuses the rest.
- A review made again before the first's take is in stops the next return's chain after its deposit.

**For 1.8.1:** no code change for readers#3. Design the race once, with worker#2's, the owner's to pick, and give it a backlog line.

Any fix must pass `-3`. Both returns' chains complete under the ledger's rule, whether the first return's take is its collateral's mix (cases 1 and 2's shape) or its chain's first mix (case 3), and Back now counts the balance once. Today case 1 fails it, and readers' fix fails case 2.

## For the lead

- **readers#3 and worker#2 share a root:** a build in a pool while a chain of the wallet's has an unsent take there.
  - Counting the unsent take makes that build withdraw 0, refused until the take is in.
  - Not counting it makes the build withdraw N, and then whichever lands second is refused.
  - Only an order fixes it: no build or Send in that pool until the take is in the mempool. Don't take readers#3's fix and worker#2's together.
- **worker#1** (staking's words) shows in case 1: `claimSubmit`'s failed line after the cut.
- **readers#1's code fix** touches only the after row. Nothing it changes meets the other findings: with readers#2's or worker#2's 0, `taken` is absent.

## Checked, and it held

- **readers#1:**
  - `publicLeaving` and both after rows; `change` read by no screen.
  - Every consumer of `LovejoinPublicSummary` (`Lovejoin.tsx`, `KeptPublic`).
  - The e2e and unit tests that read the after row; store-images; flows.md.
  - The private funding reviews (`FundingTotals`) aren't touched: a private chain is the runner's, with no review of its own.
  - A return's Back now and a way back's amount count N.
- **readers#2:**
  - `takingFrom`, `balanceAfter` and `readRewards`.
  - Both holds (`SPENT_KEEP_MS`, `SENT_HELD_MS`) and the 16-send cap.
  - A submit the network refused is never remembered: `rememberSpent` runs after one that went, or one Koios didn't answer (`lovejoin.ts:5338`, `sessions.ts:5559`, `:5578`).
  - account.ts's landed rule and the trade it states.
  - `done` means all sent.
- **readers#3:**
  - `claimBuildNow`, `claimSubmit` and `balancesHeld`; `buildBack`'s three paths.
  - The reservations kept for Send.
  - `pumpChain`'s giveme.my wait and the budget-0 pump at Send.
  - The order the UI sends in; the ledger's order in the mempool.
