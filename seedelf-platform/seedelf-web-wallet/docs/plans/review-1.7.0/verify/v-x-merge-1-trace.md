# v-x-merge-1-trace: x-merge#1

**Verdict: partly.** **Severity: low.** Confidence: high.

The sessions.ts half is real: I proved it on HEAD through `runNetworks`, and the proposed fix closes it, checked in a copy outside the tree. The dapp.ts half is wrong. `watchFunding`'s only WebAssembly runs inside `wallet.withKeys`, and `Wallet.serial` locks the wallet on a trap there before `watchFunding`'s catch runs. The fix proposed for `watchFunding` would never fire.

## What holds (sessions.ts)

### The catches

- `sessions.ts:3368`: `if (await this.pendingChain(network, s.index)) await this.serial(() => this.pump(network, s.index)).catch(() => undefined);`
- `sessions.ts:3377`: `await this.serial(() => this.settleReturns(network, s.index)).catch(() => undefined);`

`runAll`'s only caller is `runs.ts:83` (`.catch(unlessTrap(false))`). These two inner catches return normally, so `unlessTrap` never sees the trap and `runNetworks`' `wallet.trapped()` (runs.ts:57-61) never runs.

### The trap really reaches them: WebAssembly outside the wallet's queue

- **`onChain` → `watchOf`:**
  - The path is `lovejoin.ts:2869` → `readSet(network, true).catch(unlessTrap([]))` → `verifiedPool` → `this.deps.wasm.lovejoinVerifyPool` (2737). The `isTrap` rethrows at 2739 and 2869 pass it on.
  - `pumpChain`'s `onChain` catch (lovejoin.ts ~511) keeps only a `KoiosError`.
  - It's reached when the chain record has `pools` or `tail` (a session's 5 ₳ collateral mix has `tail`) and a fresh worker has empty `watches` and `verified` caches.
  - `run-traps-review-fixes.test.ts` ("hands a trap in the read of a chain's pools for its watch on") already proves that `lj.watchOf` rejects with the trap itself.
- **`witness` → `witnessTail` → `tailWitness`:**
  - `wasm.declaredCovers` and `wasm.finishLovejoinWithdraw` are called directly (lovejoin.ts:4102, 4105).
  - `witnessTail`'s catch rethrows anything that isn't a `CollateralError` or `KoiosError` (sessions.ts ~5164).
  - `pumpChain` doesn't catch `io.witness` at all.
- **#332's link holds:** `declaredCovers` is `seedelf_core::eval::declared_covers` (wasm/src/lib.rs:5909). #332 made core's arithmetic overflow-checked, so an overflow there now traps, but on these paths the trap doesn't lock.

### Pump's catch records the raw trap

At `sessions.ts:5053-5063`, pump's catch has no `isTrap` check:
1. `const why = e instanceof Error ? e.message : String(e)`
2. `s.chain.stopped = why`
3. `lovejoin.chainEnded(network, id, why, …)`
4. `dropPending`
5. `release`
6. `throw e`

`Lovejoin.tsx:965` shows it as `tr("lovejoin.chains.whyStopped", { why: withoutStop(c.stopped) })`, which reads "Why it stopped: unreachable." in every language.

The recording isn't only the alarm's. The same thing happens under the button (`skipCollateralMix`) and under a running session's `step`: both lock, but only after pump has written "unreachable" and dropped the chain.

### The contrast with the button

- The skip path hands a trap on: sessions.ts:5531-5535, `.catch((e) => { if (isTrap(e)) throw e; })`.
- From there it goes `handlers.ts:512` → `answerUi` (sw.ts:371-381) → `wallet.trapped()`.
- A running session's `step` locks too (sessions.ts:3462-3464).
- The site's sessions, the hand-run swaps and the paused ones are the gap.

### The docs and the history

- `architecture.md:53` says "The worker's runs (`runs.ts`) lock the wallet on a trap from any step". That doesn't hold for these two loops.
  - Small correction: the "any step" sentence predates #330 (it's in babb8e76's text). #330 only rewrote the `unawaited` sentence.
- `git show 7e2d89ed:…/fixes/fx-cut-2.md` line 157 says: "runAll swallows a trap on the alarm's path … around settleReturns (and pump, markCut) … pre-existing."
- `post-release-roadmap.md` has no entry for it. Grepping for runAll, settleReturns and "alarm's run" finds only the `unawaited` items, 3 and 388.
- It's pre-existing and not a 1.7.0 regression.

## What doesn't hold (dapp.ts `watchFunding`)

### Where its WebAssembly runs

- `siteAccount` (sessions.ts:2462-2470) calls WebAssembly only through `this.accounts()` (5881-5897: `wallet.withKeys((keys) => keys.oneTime.address/sharedStakeAddress/keyHash)`) and through `wallet.withKeys((keys) => keys.oneTime.rewardAddress(net, index))`.
- Both run inside `Wallet.serial`. wallet.ts:578-585: `if (!isTrap(e)) throw e; await this.broken(); throw new WalletLocked(WASM_BROKEN());`
- `accountUtxos` and `fundingSeen` have no WebAssembly outside the queue: spent.ts uses JS CBOR, koios.ts uses no wasm, and `fundingState`, `partsOf` and `stillWaiting` are JS.

### What the site and the wallet see

- The wallet is already locked, with lockReason `trap`, when `watchFunding`'s bare `catch {}` answers `SITE_TRAPPED`. That answer is right.
- The suggested fix, `isTrap(e)` → `wallet.trapped()` in that catch, would be dead code: what arrives there is a `WalletLocked`, not a trap.

## The scratch test

The test was `extension/tests/zz-review-v-x-merge-1-trace-1.test.ts`, run alone and now deleted. It uses the chain-fixtures `withSession`, `backBuild`, `chainNet` and `backSubmit`, then makes `t.lovejoin.watchOf` reject with `WebAssembly.RuntimeError("unreachable")` and runs `runNetworks` over the real wallet, sessions, Lovejoin and pending services.

### On HEAD

- **A (the pump):** `{"pendingBefore":"present","inMempool":4,"watchOfCalls":1,"runNetworks":"nothing","state":"unlocked","alarmOn":false,"sessionChainStopped":"unreachable","lovejoinChainStopped":"unreachable","pendingAfter":"dropped","sessionChainStoppedAfterNextRun":"unreachable"}`
  - It fails on three assertions: `expected 'unlocked' to be 'locked'`, a lock reason `undefined` where `'trap'` is expected, and a stop reason that's still `'unreachable'`.
  - The alarm also stopped: nothing is left running, so the wallet just sits unlocked on the broken instance.
- **C (settleReturns):** the chain is all sent and its history isn't written yet (`activity.sent` rejects). The output is `{"pendingLeft":"all sent","unconfirmed":["mix","mix","mix","back+summary"],"watchOfCalls":1,"state":"unlocked"}`, and it fails on `expected 'unlocked' to be 'locked'`.
- **B (`watchFunding`):** `OneTimeAccounts.prototype.address` throws `RuntimeError`. The output is `{"state":"locked","lockReason":"trap","siteHeard":[{"code":-2,"info":"Seedelf Wallet couldn't answer this request."}]}`, and it passes, which refutes that half of the finding.
- **B2:** `siteAccount` alone gives `{"isWalletLocked":true,"isRuntimeError":false,"state":"locked","lockReason":"trap"}`.

### With the fix (mutation copy outside the tree, now deleted)

The fix: in `runAll`'s pump and settleReturns loops, `.catch((e) => { if (isTrap(e)) throw e; })`, plus `if (isTrap(e)) throw e;` as the first line of pump's catch.

- **A** passes: `"state":"locked","lockReason":"trap"`. After an unlock, the next run marks the chain "The wallet locked, or the browser closed, while its chain was being sent." (`CHAIN_CUT`).
- **C** passes: `"state":"locked","lockReason":"trap"`.

## Fix advice

- **sessions.ts:** the proposed fix is right. Rethrowing the trap at the top of pump's catch also fixes the "unreachable" record on the button's path and the step's path, so the lock cuts the chain as any lock does. runs.ts is `runAll`'s only caller, so the trap does reach `runNetworks`' lock.
- **dapp.ts:** drop the `watchFunding` change. The narrow-the-docs alternative still works: name the two loops in `architecture.md:53`, or say "every step but…" there, and put the gap under *Kept in mind*.
- **The test:** the finding's suggested test, in `tests/session-trap.test.ts` through `runNetworks` with lockReason `trap` and a stop reason that isn't "unreachable", fails today as described, and C covers settleReturns.
