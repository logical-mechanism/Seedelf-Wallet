# x-merge: where #325–#338 meet, on the combined tree (6bca8bec)

## Summary

I looked at the merged tree where the PRs meet. Five things were checked:

- #330's `unawaited` beside #337's new RPC and its pump.
- #333's priced Bootstrap reserve beside #337's direct return.
- #336's `confirmed()`/`launched()` beside #330's runs and discovery's other callers.
- #335's part lookup beside #337's sessions and the fundings in parts.
- The i18n gates and the docs that several PRs edited.

**The baseline is all green.** `summary.txt` has fmt, clippy, Rust, the WebAssembly's node tests (57/57), tsc, and both Vitest runs, mainnet and `VITE_ENABLE_MAINNET=false`. Each Vitest run had 249 files pass with 1 skipped, and 2909 tests pass with 4 skipped. There's no red to report.

**Most of the meeting points hold.**
- #337's skip runs its pump under `serial` and rethrows a trap. `advance` locks the wallet on a trap through `step`.
- #333's reserve is read from the same parameters in the form, the funding and the cap. A Bootstrap's funding never goes in parts, and a Bootstrap has no tail, so neither #335 nor #337 reaches it. After a skip, the direct return sweeps the unused tail reserve back.
- #335's lookup covers every key that `keepParts` writes (`SESSION_TRANSFER`, `SESSION_WITHDRAW`, `SESSION_OUT`, `SESSION_SITE_OUT`, `SESSION_MIX_OUT`), which are all in `BUILT_KEYS`.
- I ran `node scripts/i18n-critical.mjs` (print only). The set it derives is identical to the checked-in `critical-keys.json` (463 keys). It includes #337's `lj.tail.privacy.wayOut` and none of #335's keys. The verified and provenance records match.

**Five findings.**
1. **Medium:** #336's Koios gate on the data layer's list opens a hole in the launch's copy refusal. A Start a pool can go through as a copy of a pool the data layer lists, and it costs about 23 ₳.
2. **Low:** `runAll`'s chain pump and `settleReturns` loops still drop a trap. So does dapp.ts' `watchFunding`. A scratch test showed this, and it contradicts what #330's docs now say. The 1.6.0 fix report fx-cut-2 noted it, but nobody tracked it.
3. **Low:** for a session brought back by hand, *Bring the rest back now* only ends the wait. The rest stays at the account until *Bring it back*. flows.md and the stop's reason say it came back.
4. **Low:** privacy.md doesn't mention the new user-chosen way out, which leaves the box unmixed.
5. **Low:** the roadmap's 1.7.0 list and *Kept in mind* are stale for items 4 to 7. #333 says the ticks wait for the release-prep commit. #336's planned request names differ from what was built.

## Findings

### 1. Medium (money): a launch's copy refusal misses a pool the data layer lists but Koios hasn't confirmed (#336 × chunk 34's launch)

**Files:**
- `extension/src/background/lovejoin-launch.ts:243-250`
- `extension/src/background/lovejoin-pools.ts:394-451` (refresh) and `:568-584` (confirmed)
- `extension/src/background/lovejoin-launch.ts:211-214` (terms)

**Claim.** `LovejoinLaunchService.build` refuses a pool whose values already have a pool, using only `discovery.known()` after `discovery.look()`:

```ts
await this.deps.discovery.look(network);
const known = await this.deps.discovery.known(network);
const copy = known.find(...)
if (copy) throw new Error(t("lj.launch.copy"));
```

The `terms()` form lists the pools to join from the same `known()`.

Since #336, a pool on the data layer's list that's new to the device is kept only once Koios confirms it. While Koios can't, `confirmed()` takes nothing new:

```ts
} catch (e) { if (isTrap(e)) throw e; standard = []; }
```

The same happens while Koios hasn't indexed the launch yet (it lands in `unknown`). `refresh()` still marks the list as answered, so `look()` doesn't fall back to the holder look either. Before #336, the data layer's pool was kept at that refresh, so the copy was refused.

**Scenario.**
1. On mainnet, the data layer is up. Koios is down or rate-limiting this IP, which is likely behind a VPN on the public tier. Koios might also not know the launch yet.
2. Pool P, of token X at Q a box, was launched after the bundled head start. The data layer lists it.
3. This device hasn't kept P: it was just restored, or every pool read since P was listed met Koios failing.
4. The user opens Start a pool for X at the suggested Q. The form offers no pool to join.
5. Review builds without `lj.launch.copy`, and Start the pool sends.
6. About 23 ₳ (the reference UTxO, two scripts, the stake deposit) never comes back. The pool is a later launch of P's values, so it's never shown and takes no new box once P is known.

**Evidence.**
- The code above.
- #336's own test, `tests/lovejoin-discovery.test.ts`, "keeps nothing new while Koios can't answer": `known()` stays `[]` with the data layer listing the pool.
- `tests/lovejoin-merged-review.test.ts:398-415` shows `build` refuses a copy only through `discovery.known`.

**Fix.**
- Keep the data layer's list as verified offline but not yet confirmed (in memory, beside `known`).
- Have the copy check in `build`, and the join list in `terms()`, read it too.
- A server that lies could only cause a false copy refusal, never a confirmed pool.
- The copy refusal is the owner's existing design (session 1's 11 and 14), so widening what it reads isn't a new guard. A new "try again later" refusal while Koios is down would be the owner's call.

**Test.** Use a real `PoolDiscovery` with the data layer listing P and Koios answering `tx_info` with a 503. `LovejoinLaunchService.build` for P's values must reject with `lj.launch.copy`, and `terms` must list P. Both fail today.

**Confidence:** high on the mechanism, medium on how often it's reached.

### 2. Low (correctness): the alarm's run still drops a trap under a session's chain pump and `settleReturns`, and under a site funding's watch

**Files:**
- `extension/src/background/sessions.ts:3368` and `:3377`
- `extension/src/background/sessions.ts:5053-5063`
- `extension/src/background/dapp.ts:1424` and `:1473-1476`
- `docs/architecture.md:53`

**Claim.** `runAll` runs each session's pending chain and its return's settling with `.catch(() => undefined)`, so `runs.ts`' `unlessTrap` never sees a trap there:

- `:3368`: `if (await this.pendingChain(network, s.index)) await this.serial(() => this.pump(network, s.index)).catch(() => undefined);`
- `:3377`: `await this.serial(() => this.settleReturns(network, s.index)).catch(() => undefined);`

`pump`'s own catch first records the trap's raw word as the chain's stop (`s.chain.stopped = why`, then `chainEnded(network, id, why, ...)`). It then drops the pending chain.

`dapp.ts` starts `void this.watchFunding(w, index)` (a WebAssembly call through `siteAccount`). Its bare `catch {}` tells the site `SITE_TRAPPED`, but it never locks.

`architecture.md:53`, as #330 rewrote it, says:
- "The worker's runs (`runs.ts`) lock the wallet on a trap from any step"
- "So do the three runs a page's request starts and doesn't wait for (`unawaited`)"

The paths differ:
- #337's skip pumps the same chain and does hand a trap on.
- #332's rationale ("a sum past its type traps and locks the wallet rather than wrapping") assumes every trap locks.

**Scenario.** A site's session's return goes through Lovejoin, and its chain waits in session storage. At the alarm's next run, a WebAssembly call under its pump traps: `verifiedPool` under `watchOf`'s quiet read, or `tailWitness`' `declaredCovers` or `finishLovejoinWithdraw`. What happens:
- The wallet stays unlocked on the broken instance.
- The chain is recorded stopped with "unreachable" in every language. The Lovejoin page's chain list shows "Why it stopped: unreachable".
- The pending chain is dropped.

The same trap under *Bring the rest back now* would lock.

**Evidence.** I ran a scratch test, since deleted, that used `chain-fixtures`. It did `withSession`, `backBuild`, `backSubmit`, made `t.lovejoin.watchOf` throw `WebAssembly.RuntimeError("unreachable")`, then called `runAll("preprod")` as `runs.ts` calls it. Its output:

`{"watchOfCalls":1,"handedOn":"undefined","state":"unlocked","stopped":"unreachable"}` and `{"pendingAfter":"dropped"}`

It's pre-existing. 1.6.0's `fixes/fx-cut-2.md` says "runAll swallows a trap on the alarm's path ... (and pump, markCut)", in `git show 7e2d89ed`. It was never carried into post-release-roadmap.md. 1.6.0's docs check rated the sibling three-calls finding low.

**Fix.**
- In `runAll`'s pump and `settleReturns` loops, catch with `(e) => { if (isTrap(e)) throw e; }`.
- In `pump`'s catch, rethrow a trap before anything is recorded, as `step` does. The lock then cuts the chain (`cuts`, `CHAIN_CUT`).
- In `watchFunding`'s catch, call `wallet.trapped()` on `isTrap(e)`.
- Or narrow `architecture.md:53` to what holds.

**Test.** In `tests/session-trap.test.ts`, the scenario above, run through `runNetworks`, must leave the wallet locked with `lockReason` `trap`, and the chain's `stopped` must not be "unreachable". It fails today.

**Confidence:** high.

### 3. Low (ux/docs): for a session brought back by hand, *Bring the rest back now* doesn't bring it back

**Files:**
- `extension/src/background/sessions.ts:5526-5538`, `:1230-1232` and `:3219-3224`
- `docs/flows.md:522`
- `extension/src/i18n/translations/en.json` (`lj.tail.skipped`)
- `extension/src/ui/screens/Lovejoin.tsx:963-966`

**Claim.** `skipCollateralMix` marks the tail over, stops a chain still being sent, then calls `advance`. But `step` returns at once for a session that isn't `running()`, which needs `s.auto`. So for a site's session or a hand-run swap, nothing builds the return. The page then offers *Bring it back*, and its review. #337's own test builds the return by hand after the skip (`sessions.backBuild`, in the `lovejoin-planner` test).

The text doesn't say so:
- flows.md:522 says "and the rest comes back directly".
- The chain's stop reason, shown in the Lovejoin page's chain list, says "You brought the rest back without waiting for the collateral's mix, so the chain stopped there."

**Scenario.** A site's session's return waits on giveme.my for over an hour. The user presses *Bring the rest back now* on the site's page and assumes the money is coming. It actually waits at the session's account until they press *Bring it back* and send its review.

**Fix:** the owner's call on the words.
- flows.md: "by itself for a swap or a mix, at Bring it back for a session brought back by hand".
- The reason: neutral words, not "You brought the rest back".
- Or open the return's review right after the skip on by-hand pages.

**Test.** A site's session skipped past its hour must say, in its view or its words, that the rest waits for *Bring it back*. The auto path also has no test: a swap's or a mix's return sent within the skip's RPC, with no `collateralTail` and giveme.my not asked again.

**Confidence:** high.

### 4. Low (docs/privacy): privacy.md doesn't mention the new way out, which leaves the 5 ₳ box unmixed

**Files:** `docs/privacy.md:217`

**Claim.** It says the box waits unmixed and tied to the session "past that, or a day after the deposit landed". It doesn't mention #337's user-chosen early end, from an hour after the deposit landed. #337 changed architecture.md and flows.md, but not privacy.md, the design doc for this ground. The store policy describes no wait, so it needs no entry.

**Scenario.** A reader of the design doc thinks the box is left unmixed only after a day. A user can now cause it after an hour.

**Fix.** Add one clause: "or, from an hour after the deposit landed, when the user brings the rest back without it (*Bring the rest back now*)".

**Confidence:** high.

### 5. Low (docs): the 1.7.0 list and *Kept in mind* are stale after #333, #335, #336 and #337

**Files:** `docs/post-release-roadmap.md:41-45`, `:373-374` and `:378-380`

**Claim.**
- Item 4 is still 🚧, with only the overflow half ticked.
- Items 5, 6 and 7 are ⬜.
- The *Kept in mind* entries are still written as open.
- `:379` and `:380` describe requests that weren't built ("one `utxo_info`", "one batched `account_info`"). #336 asks `tx_info` (20 a request) and `account_update_history`, as privacy.md and the policy say.

#333's PR body says "the 1.7.0 list's tick waits for the release-prep docs commit", so this is a reminder for that commit.

**Fix.** In the release-prep docs commit:
- Tick 4, 5, 6 and 7.
- Mark `:373`, `:374` and `:378` to `:380` done, as #330 and #332 did theirs.
- Name #336's real requests.
- Carry finding 2's gap into *Kept in mind* if it isn't fixed.

**Confidence:** high.

## Checked, no finding

- **#330 × #337.** The skip goes through `answerUi`. Its pump rethrows a trap, `advance` → `step` locks, and `views`/`one`' `tailHeld` rethrows one. #337 adds no fire-and-forget run. The real `scan`, `parts.pump` and `withdrawDue` hand a trap on as far as I read.
- **#336 × #330.** `confirmed()` runs only on non-quiet pool reads: status, `ours`, a mix's reads, `look`. `tried()` and its catch rethrow a trap, so Bring every box back now's first run, now `unawaited`, locks on one. A failing Koios leaves the pools already handed over. The restore's scan reads no pools. `watchOf` and `tailChain` read quietly, so they never reach `confirmed()`.
- **#336's rule versus the data layer's.** Both say "registered by the launch or an earlier block". The wallet compares block times strictly and the data layer compares block numbers, so they agree. Script reward headers: 0xf1 on mainnet in both.
- **#333 × #335 × #337.** The form, the funding and `bootstrap_most` use one priced reserve. Parameters are bounded in `from_koios`, so with #332 on, no reserve sum can overflow.
- **#335.** Every `keepParts` key is in `BUILT_KEYS`. A later part's record carries `network` and `txCbor`. The five reviews pass `parts`, and nothing else keeps parts.
- **i18n.** The derived set matches `critical-keys.json`. es and ja for `lj.tail.privacy.wayOut` keep every clause. There are no module-level `t()` calls in the new code.
- **The docs.** architecture.md's #330, #333, #335 and #337 paragraphs match the code, bar finding 2.
