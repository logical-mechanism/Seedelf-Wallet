# v-x-merge-1-impact: x-merge#1, traps the alarm's run drops under a session's chain

**Verdict: partly. Severity: low. Confidence: high on the mechanism, medium on how often it's reached.**

- **The `runAll` half is confirmed.** A trap under a non-running session's chain pump, or under `settleReturns`, never locks the wallet on the alarm's path. I showed this through `runNetworks` on the real WebAssembly.
- **The `watchFunding` half is refuted.** Its only WebAssembly runs inside `wallet.withKeys`, and `Wallet.serial` locks on a trap there before the bare `catch {}` ever sees it.
- **"unreachable" isn't an alarm-only symptom.** `pump`'s catch records the raw word on every path, the locking ones included. Fix B, which the finding already proposes, is what removes it.

Reviewed on HEAD `6bca8bec`. #338 is docs only, as the owner says.

## Can it happen with the shipped build?

**The mechanism holds.** On the alarm's run, a non-running session is a site's session, a hand-run swap or a paused one. For those, runAll's two catches swallow a trap:

- `sessions.ts:3368`: `.catch(() => undefined)` around `pump`
- `sessions.ts:3377`: `.catch(() => undefined)` around `settleReturns`

**Three WebAssembly calls on those paths run outside the wallet's queue:**

- **`lovejoinVerifyPool`.** `watchOf` → `readSet(network, true)` → `verifiedPool` (`lovejoin.ts:2736`). It runs under the chain pump's `onChain` and under `settleReturns` → `landed`.
- **`declaredCovers`** (`lovejoin.ts:4102`), via `witnessTail` → `tailWitness`.
- **`finishLovejoinWithdraw`** (`lovejoin.ts:4105`), the same way.

Everything else on those paths (`sendRecorded`, `chainStatus`, the records, `activity.sent`) is JavaScript, or runs inside `withKeys`.

**What triggers a trap there: nothing a site or an on-chain stranger controls.**

- **`declaredCovers`** only compares budgets parsed from Ogmios's JSON (`eval.rs:426-450`, `Budgets::from_ogmios`).
- **`finishLovejoinWithdraw`** parses and verifies giveme.my's signature (`wasm/src/lovejoin.rs:2877-2898`).
- **The quiet `readSet`** verifies only pools discovery already kept, which verified once on the same code. Box datums aren't read on this path.

**The one concrete trigger is x-upgrade#1's:** a row a lying data layer listed during 1.6.0's life, with the NFT doubled. 1.6.0 kept it because the sum wrapped, and 1.7.0 traps on it under #332. x-upgrade#1 lists "a session return's quiet look" among the reads that trap, and that is this path. In that scenario the wallet locks on many other reads anyway: the Lovejoin page, `withdrawDue` in the unlock's run, and so on. x-overflow#1's `checked_add` in `eval::resolve` removes the trigger.

**Otherwise it's defence in depth against a latent bug or a WebAssembly out of memory.**

**What happens when it does trap** (scratch test, real module, a site's session's chain sent through `backBuild`/`backSubmit`, `t.lovejoin.watchOf` throwing `WebAssembly.RuntimeError("unreachable")`, run as runs.ts runs it):

```
ALARM {"watchOfCalls":1,"state":"unlocked","lockReason":null,"stopped":"unreachable","pending":"dropped",
       "lovejoinChains":[{"session":0,"boxes":2,"total":10,"sent":4,...,"stopped":"unreachable"}],"alarmOn":false}
```

**The same trap under a running session's step,** which locks (`step`'s catch), still records the raw word. `pump`'s catch (`sessions.ts:5053-5064`) writes the session's `stopped`, calls `chainEnded` and drops the progress before the trap reaches `step`:

```
STEP {"state":"locked","lockReason":"trap","stopped":"unreachable","lovejoinChains":[{...,"stopped":"unreachable"}]}
```

#337's skip (`sessions.ts:5532-5534`) goes through the same `pump`, so *Bring the rest back now* would lock and also say "unreachable". The scenario's contrast holds for the lock only.

**`watchFunding`** (`dapp.ts:1424-1477`) has one WebAssembly path: `sessions.siteAccount` → `accounts()` and `rewardAddress`. Both go through `wallet.withKeys` (`sessions.ts:5881-5897`, `:2468`). `accountUtxos` and `fundingSeen` are JavaScript, and each has its own catch. A trap in `OneTimeAccounts.rewardAddress`, patched on the prototype, gave:

```
SITEACCOUNT {"error":"WalletLocked: The wallet's core stopped working, so the wallet locked itself. ...","state":"locked","lockReason":"trap"}
```

So the bare catch only ever sees `WalletLocked`, and the site hears `SITE_TRAPPED`, as architecture.md says. The finding's `wallet.trapped()` there would be dead code: `isTrap(e)` is never true in that catch.

**Harm when it happens.** No money moves or locks. The chain stops either way: today with "unreachable", after the fix cut by the lock. `buildBack` treats any stopped chain alike (`sessions.ts:4341`), and `chainEnded` and `cuts` both unschedule the unmixed boxes. What differs:

- **The wallet stays unlocked** on the instance that trapped until the next trap locks it, under a page's request, in the queue or later in the same run.
- **The pages show "Why it stopped: unreachable."** in en, es and ja. That's `lovejoin.chains.whyStopped` and `lovejoin.detail.whyStopped`, from `Lovejoin.tsx:907` and `:965`.
- **The docs overstate the lock.** architecture.md:53 says "The worker's runs (`runs.ts`) lock the wallet on a trap from any step". That sentence predates #330, but #330 removed the paragraph's only stated exception, so the paragraph now reads as complete. seedelf-platform/CLAUDE.md's "(a trap that locks the wallet, not a wrapped sum)" for #332 likewise doesn't hold on these paths.

## Severity: low

- **The scale fits:** "an edge case, a misleading doc". It is the same class as the three-calls finding #330 closed (1.6.0's docs check rated it low, and the owner made it 1.7.0's item 3).
- **It's pre-existing:** 1.6.0's `fixes/fx-cut-2.md` notes it (`git show 7e2d89ed:…/fixes/fx-cut-2.md`, "runAll swallows a trap on the alarm's path"), and post-release-roadmap.md never picked it up.
- **It isn't medium's "a lock that doesn't happen".** That needs real harm in a reachable state. No site or chain input reaches it, its one trigger goes with x-overflow#1's fix, and the outcome locks no money.

## The fix

**A + B as proposed are right and minimal. They must land together.**

- **A:** runAll's pump and `settleReturns` loops hand a trap on, as runs.ts' `unlessTrap` does: `.catch((e: unknown) => { if (isTrap(e)) throw e; })`. That is the form `sessions.ts:5532` already uses.
- **B:** `pump`'s catch starts with `if (isTrap(e)) throw e;`, before `stopped`, `chainEnded`, `dropPending` and `release`.
- **Never B without A.** A trap that's swallowed after B would leave the chain's progress in place, to be pumped again on the broken instance at every run.
- **Every caller of `pump` locks with A in:**
  - runAll, through runs.ts;
  - `act`, through `step`;
  - `sendChain` from Send, through answerUi or answerSite;
  - the skip, through answerUi.
- **The lock does the rest.** It wipes the progress and the reservations (`SESSION_CHAIN_PREFIX`, `SESSION_RESERVED_PREFIX`, both session storage). `markCut` and Lovejoin's `cuts` then mark the chain `CHAIN_CUT()`, with `cut: true`. That is the lock-mid-chain path, already tested (`chain-lock.test.ts`).

**Drop the `watchFunding` bullet** (above). `markCut` and the step loop need nothing: `markCut` calls WebAssembly only inside the queue, and `step` locks itself.

**What else it changes:**

- **Words.** The chain reads `lj.chainCut` ("The wallet locked, or the browser closed, while its chain was being sent.") instead of "unreachable". The lock screen gives `WASM_BROKEN`'s reason. No new key, no critical key, no privacy note touched, no request, no guard.
- **A trap that repeats at every run.** It now locks at each run on these paths too, as on every other run path, by design. With x-upgrade#1's kept row unfixed, these paths join the lock loop that finding already describes. x-overflow#1's Rust fix removes the trigger, and should ship regardless.
- **Nothing else changed in my run.** With A and B applied in a copy, 60 related files passed, 640 tests: `chain-*`, `session*`, `sessions*`, `return-*`, `site-*`, `public-mix-*`, `run-traps-review-fixes`, `runs`, `lovejoin-planner`, `lovejoin-stopped-*`, `lovejoin-1-5-0`, `lovejoin`, `handlers`, `worker-words`, `i18n-worker-reasons`, `live-runs-copy` and more. That was the default build only.

**The test, sharpened.** I ran it as four cases, real module, `runNetworks` with stub services beside the real sessions:

1. **A trap in `watchOf` under a site's chain pump.**
   - The wallet must end locked, `lockReason` `trap`, the alarm off.
   - After unlock and a `runAll`, the session's `chain.stopped` and Lovejoin's status chain must both read `CHAIN_CUT()`.
2. **A trap under `settleReturns`.** This must lock too.
   - It needs a return whose history waits: a `back` transaction with a `summary`. Without one, `runAll` never calls `settleReturns`, and the finding's scenario alone doesn't reach it.
   - Here the progress is already gone, wiped by a lock.
3. **The same trap under a running session's step.** Nothing may record "unreachable", and the Lovejoin record must read `CHAIN_CUT()`.
4. **A control.** A plain `Error` from `watchOf` must still stop the chain with its own words, drop the progress and leave the wallet unlocked.

**On the tree,** cases 1–3 fail (`expected 'unlocked' to be 'locked'` twice, `expected 'unreachable' not to be 'unreachable'`), and case 4 passes. **With A and B applied,** all four pass.

**Docs:**
- **If it's fixed:** architecture.md:53 gains one clause: a session chain's pump and a return's settling in the alarm's run hand a trap on too, and the lock cuts the chain rather than stop it with the trap's word.
- **If it isn't:** narrow that sentence, and add the gap to *Kept in mind*, as x-merge's finding 5 suggests.

## What I ran

**In the tree,** both scratch files are now deleted:
- `tests/zz-review-v-x-merge-1-impact-1.test.ts`: the three outputs quoted above.
- `tests/zz-review-v-x-merge-1-impact-2.test.ts`: the four cases, failing before the fix.

**In the copy,** at `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/review/v-x-merge-1-impact/`:
- `fix.diff`, the patch;
- `fixed.test.ts`, the four cases;
- `files.txt` and `copy-run.log`, the related set's run: 60 files and 640 tests pass.

No tracked file was edited, nothing was built, and nothing went to a network.
