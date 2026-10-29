# Review of the merged fixes: the worker and the money

Tree: `W` = `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-wt/release-1.7.0`, branch `web-wallet/release-1.7.0-fixes`, the working changes against `6bca8bec`. Read-only: nothing in `W` was edited. Scratch tests and the one mutation ran in a copy, `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/review-worker/copy/` (its `node_modules`, `wasm/pkg` and fixtures linked to `W`'s).

Paths below start at `W/seedelf-platform/seedelf-web-wallet/` unless they start with `seedelf-core/`.

## Findings

Two real defects, both low, both where the traps lane's fix (x-merge#1) meets a path no lane changed. Neither is a regression in money moved; each leaves a trap either unlocked or recorded as its raw word, which x-merge#1's fix and its new docs say no longer happens.

### 1. Bring everything back's Send still swallows a trap from a chain's sending, and since the merge leaves that chain going (low)

- **Where:** `extension/src/background/sessions.ts:3202-3209`, `claimSubmit`'s loop:
  ```ts
  try {
    await this.sendBack(network, built, SESSION_CLAIM);
    sent.push({ index: built.index, txHash: built.txHash });
  } catch (e) {
    failed.push({ index: built.index, error: (e as Error).message });
  }
  ```
  `claimBuild`'s own loop rethrows a trap (`:3176`); this one doesn't.
- **What the merge changed:** `pump`'s catch now rethrows a trap before recording anything (`:5064`, x-merge#1). So a trap under `claimSubmit`'s `sendBack` → `sendChain` → `pump` no longer ends that chain, and `claimSubmit` still takes the trap as one session's failure.
- **Scenario:** Bring everything back, Lovejoin on, two sites' sessions. WebAssembly traps outside the wallet's queue while session 0's chain is sent (with Send's budget of 0 that's the witness of a chain whose first transaction is the collateral's mix built again: `tailWitness`'s `declaredCovers` / `finishLovejoinWithdraw`).
  - The answer lists session 0 as failed with `"unreachable"`, the raw word in every language (`ClaimAll.tsx:160-168`).
  - The wallet stays unlocked, and session 1's return is still sent, from that instance, in the same request (pre-existing).
  - New since the merge: session 0's chain progress and its reservation stay, unrecorded, so its page shows the chain still being sent (`chain {total: 10, sent: 1, cut: false}`, no stop) while ClaimAll says it failed. The alarm's next run sends more of it from the same instance; only a second trap there locks. Before the merge the chain was stopped at the trap ("unreachable") and dropped.
- **Shown on the merged tree** (scratch `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/review-worker/copy/seedelf-web-wallet/extension/tests/zz-review-worker-claim.test.ts`: `twoSites`, `claimBuild`, `t.lovejoin.chainSent` rejecting with `WebAssembly.RuntimeError` once as the stand-in trap):
  - merged: `{"sent":[{"index":1,…}],"failed":[{"index":0,"error":"unreachable"}]}`, wallet `unlocked`, session 0's pending chain kept, view `chain {"total":10,"sent":1,"confirmed":0,"cut":false}`;
  - with `pump`'s new rethrow removed (in the copy only): the same answer and state, but the pending chain gone and the view `stopped: "unreachable"`.
- **Against the docs:** `docs/architecture.md:53`, as the docs lane now has it, says a chain's sending hands a trap on "so a chain a trap stopped reads as cut by the lock (`CHAIN_CUT`), never stopped for the trap's raw word"; ClaimAll shows the raw word and nothing locks.
- **Fix:** one line at the top of that catch, `if (isTrap(e)) throw e;`, as `claimBuild` does: the request then locks as it's answered (sw.ts `answerUi`), and the lock cuts the chain (`markCut`, CHAIN_CUT). The traps lane flagged the gap and left it to whoever owns Bring everything back; no lane took it. A test beside `session-trap.test.ts`'s "ends Bring everything back with the trap itself": `claimSubmit` rejects with the trap, and session 1's return isn't sent.

### 2. A public mix's chain still records a trap's raw word as why it stopped (low)

- **Where:** `extension/src/background/lovejoin.ts:4825-4868`, `pumpPublicNow`'s catch. Only `ChainGone` is told apart; a trap falls through to `sending.stopped = e.message` (`:4848-4853`) and `chainEnded(network, id, sending.stopped, …)` (`:4860`), then is rethrown.
- **Reach:** the same as x-merge#1's: `onChain` (`:4807`) → `watchOf` → `readSet(quiet)` → `verifiedPool` → `lovejoinVerifyPool`, for a public mix into a token pool. runs.ts locks for it (`runs.ts:86`), and so does the Lovejoin page's progress request, so the lock happens; only the record is wrong.
- **Scenario:** a mix from the public account into a token pool, its first window sent. At the alarm's next run that WebAssembly traps. The wallet locks; after unlock, Lovejoin's page lists that chain as "Why it stopped: unreachable", while a session's chain stopped by the same trap now reads CHAIN_CUT.
- **Shown on the merged tree** (scratch `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/review-worker/copy/seedelf-web-wallet/extension/tests/zz-review-worker-public.test.ts`: `publicFunded`, `publicBuild`, `publicSubmit`, `watchOf` rejecting with `WebAssembly.RuntimeError`, then `runNetworks`): wallet `locked` / `trap`; after unlock, `status().chains` is `[{boxes:1,total:5,sent:4,…,stopped:"unreachable"}]`.
- **Against the docs:** the same `architecture.md:53` bullet lists "the Lovejoin page's progress (sending a public mix, `lookFor`)" among what "hand a trap on, and never keep it as a run's reason", and the new x-merge#1 sentence says a chain a trap stopped reads as cut by the lock.
- **Fix:** `if (isTrap(e)) throw e;` first in that catch, as sessions' `pump` now does. The lock wipes the progress, and the next look marks it cut (`cuts`; `chain-lock.test.ts` shows a public chain reads `CHAIN_CUT` after a lock, its first transaction's sealed mark kept). Or narrow the doc to sessions' chains. Pre-existing, x-merge#1's sibling on a path its fix didn't reach.

## The original findings in this lens, on the merged tree

Each fix was read in place, and its tests run on `W` one file at a time (results below).

| Finding(s) | Lane | Merged tree |
|---|---|---|
| x-merge#1 | traps | Fixed for sessions: `runAll`'s `unlessTrap` (`sessions.ts:3367-3384`) and `pump`'s first-line rethrow (`:5064`). Its four tests pass. Two sibling paths remain: findings 1 and 2. The dapp.ts half: not a bug, agreed (its WebAssembly runs in `withKeys`). |
| pr330#0, pr330#1 | traps | Tests only / not a bug. restore-scan and splash-remnant pass. |
| pr337#0 | tail | Fixed: `view()` drops `collateralHeld` once the chain is `cut` (`:5636`). A chain a lock cut isn't `cut` (no direct return since), so the way out stays offered there, as its test shows. |
| pr337#3, x-scen#0 | tail | Fixed: `skipCollateralMix` runs whole in the sessions' queue (`:5539-5555`). No re-entry: `tailHeld`, `tailOver`, `pendingChain`, `pump`, `step` and `one` never enter that queue, and LovejoinService never calls into SessionService. A trap under the press's pump is handed on, before anything is recorded, to `answerUi`, which locks. |
| pr337#1, x-merge#2, x-ui#1, x-scen#1 | tail | Fixed: by-hand pages open the return's review after the press (`reviewAfterSkip`), and `lj.tail.skipped` is reworded. |
| x-priv#3, x-ui#0, x-docs#5, x-scen#2, x-ui#3 | tail | Fixed (words). Critical key `lj.tail.privacy.wayOut` changed: es/ja need the lead's back-translation. |
| pr337#2, x-mut-ts#1/#2/#3/#7, x-scen#6, x-ui#2, pr337#5 | tail | Tests and UI added; planner 87/87, collateral-held 7/7, wiring passes. |
| x-rel#4 | tail | Deferred to a live preprod run: still open. |
| x-merge#0 | pools | Fixed: the copy check reads `lastListed` (`lovejoin-launch.ts:247-251`). In production too: sw.ts passes the `PoolDiscovery` itself (`sw.ts:236, 264`), so the optional `lastListed` is there. |
| pr336#0 | pools | Fixed: a new pool is kept from Koios's `utxo_info` rows (`_extended`, rows at the holder), then `launched()`, as the holder's look keeps one. |
| pr336#1, x-priv#2, pr336#2 | pools | Fixed: the check runs in the background, one per network; the list is kept with `listed` first. |
| pr336#4, x-mut-ts#0 | pools | Fixed: a trap under the check calls `wallet.trapped()` (`sw.ts:236` wires the worker's wallet). |
| x-scen#4, pr336#5 | pools | Comments and architecture.md updated. |
| x-rel#6 | pools | Deferred (no e2e): still open. |
| x-upgrade#2 | pools | Owner's call. |
| x-overflow#0, x-upgrade#0 | rust | Fixed in core (`seedelf-core/src/eval.rs:148-163`: `checked_add`, refused in words). It lands where the worker expects words: `tried` (`lovejoin-pools.ts`) and `verifiedPool` (`lovejoin.ts:2731-2745`) leave the pool out, and nothing in the extension matches the new messages by text. **But `wasm/pkg` predates it** (see below). |
| pr332#0, pr332#1, x-mut-rs#2, x-overflow#1, x-docs#7 | rust | Docs and `wasm_profile_test.rs`; core's tests pass. |
| pr333#0/#1/#4/#5, x-mut-ts#4, x-mut-rs#0/#1/#3/#4 | bootstrap | Words and tests only; no worker code changed. lovejoin-flows 33/33. pr333#0's priced room and pr333#3 are owner's calls. |
| x-upgrade#1 | stepper | `parts.ts`' header corrected; the sealed record is an owner's call. |

## For the lead (not defects of the fixes)

- **`wasm/pkg` predates the Rust fixes.** `seedelf_wasm_bg.wasm` is from 15:57; `eval.rs`, `lovejoin/mod.rs`, `orders.rs` and `build.rs` from 19:54-20:06. Every Vitest run so far, mine included, ran the old module. Rebuild, then run `wasm/tests/*.test.mjs` (the x-overflow#0 node test fails with `unreachable` until then), and run the Vitest files again.
- **`lovejoin-1-5-0.test.ts` still fails** ("mainnet 1: expected 'dc6abe3b…' to be undefined"), from the release prep's head start, which now bundles a mainnet 5 ₳ ADA pool. CI's `npm test` stays red until that expectation changes. It also means the collateral's mix, its tail and the way out run on mainnet in 1.7.0 once that pool holds its floor. The tail lane rated its severities assuming they were dormant there.
- **A stray scratch test** from another reviewer is untracked in `W`: `extension/tests/zz-review-screens-1.test.ts`. Don't commit it.
- **Checked, no defect:**
  - Pressing the way out just as giveme.my signs: the press holds nothing, and a by-hand page's review then says `sess.chainSending` ("Its return through Lovejoin is still being sent."). Words only, and true.
  - The background check's trap racing the request that started it: it locks at the wallet's next queue slot, as any run's trap does.
  - `keep(network, [])` adds nothing and writes only `listed`.
  - With Koios-only on, `lastListed` keeps the last list in memory. That's documented.
  - None of the new Rust refusals replaces a sum within a u64.

## What I ran

- Vitest on `W`, one file at a time:
  - pass: lovejoin-planner 87, session-trap 7, lovejoin-discovery 27, lovejoin-merged-review 41, collateral-held 7, restore-scan 45, splash-remnant 9, lovejoin-flows 33, sessions 61;
  - pass too: lovejoin 92, screens-wiring-review-fixes 43, chain-lock 3, chain-resend 7, public-mix-pump 2, run-traps-review-fixes 14, runs 6, handlers 21, sessions-review-fixes 25;
  - fails as the lanes said: lovejoin-1-5-0, 1 of 4 (`dc6abe3b…`).
- `npx tsc --noEmit -p .` on `W`: clean.
- `cargo test --locked -p seedelf-core --test {eval_test,orders_test,lovejoin_pools_test,apart_test,wasm_profile_test}`: 8, 24, 33, 13 and 2 passed.
- The scratch tests for findings 1 and 2, and the one mutation (`pump`'s rethrow removed) for finding 1, all in the copy.
