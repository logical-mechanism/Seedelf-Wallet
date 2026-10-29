# x-mut-ts: do the new TypeScript tests fail without their fix?

Lens: across #330, #333 (worker and form), #335, #336 and #337, each behaviour the PR added was undone in a copy of
`seedelf-web-wallet/` outside the tree, and the tests that could notice were run there. Then each new test was read for
false confidence.

## Method

- Copies: `scratchpad/review/x-mut-ts/seedelf-platform/seedelf-web-wallet` (worker mutations), `.../copy2/...` (screens,
  and the scratch tests that show what would notice), `.../copy3/...` (typecheck only). `node_modules` symlinked to the
  tree's; `seedelf-core/tests/fixtures` and `seedelf-crypto/tests/vectors` copied beside, as `tests/fakes.ts` reads them.
- Baseline at HEAD (`6bca8bec`): handlers, collateral-held, tx-view-screen, lovejoin-release-rules, lovejoin-discovery
  (103 tests) and lovejoin-flows, parts-send-review-fixes, lovejoin-merged-review, lovejoin-planner, lovejoin (282
  tests): all pass.
- A runner (`mut-x-mut-ts.py`) applies one exact-string mutation, runs `vitest run --no-cache` on the named files (with
  `-t` where the file is slow), restores the file from `git show 6bca8bec:`. Screen mutations ran against every test
  file that imports the mutated screen (24 files for Lovejoin.tsx, 20 for Swaps.tsx, …), not just the PR's.
- `tsc --noEmit -p .` on every mutation no test noticed (strict, noUnusedLocals/Parameters): a natural deletion that
  leaves something unused is a TS6133 in CI even with no test.
- The copies are deleted. What's kept, in `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/review/x-mut-ts/`: the runner, every mutation (`muts-*.json`), each run's log (`runs*/`), and the scratch tests' own code (`zz-tail-x-mut-ts-1.ts`, `zz-planner-insert-x-mut-ts.ts`, `zz-discovery-tail-x-mut-ts.ts`).
- Scratch tests (built in copy2 only): `zz-review-x-mut-ts-1` (the screens, over the R3-20 seam copied from
  `screens-wiring-review-fixes.test.ts`), `-2` (a copy of `lovejoin-planner.test.ts` with tests added after #337's), `-3`
  (`lovejoin-discovery.test.ts` plus one). Each passes on HEAD and fails under the mutation it targets.

## What each mutation did

| PR | Mutation | Noticed by |
|---|---|---|
| 330 | restore's scan back to `void …catch(() => undefined)` | handlers.test.ts (trap case) |
| 330 | the parts pump the same | handlers.test.ts |
| 330 | Bring every box back's first run the same | handlers.test.ts |
| 330 | `unawaited` locks on any failure (`isTrap(e)` → `e`) | handlers.test.ts, all three "leaves unlocked" |
| 333 | `privateBootstrapBounds` answers `back: "1500000"` | lovejoin-flows "caps a Bootstrap…" |
| 333 | `mixFunding`'s `back` fixed at 1.5 ₳ | lovejoin-flows "caps a Bootstrap…" |
| 333 | `bootstrapLimits` ignores `back` | lovejoin-release-rules |
| 333 | handler answers `{ most }` only | **nothing** (66 tests; tsc ok) → finding 6 |
| 333 | PoolPage stops passing / storing `privateBack` | no test (475 / 125 pass); tsc TS6133 on the natural deletion |
| 333 | the 62162483-era recovery branch at a fixed 1.5 ₳ | nothing; neutral (below) |
| 335 | tx-view skips the part lookup | parts-send-review-fixes |
| 335 | a later part read off another network | parts-send-review-fixes (the mainnet assertion, line 1357) |
| 335 | the view's effect keyed on `txHash`, not `hash` | no Vitest test (93 pass); the e2e by reading; zz-1 |
| 335 | the view keeps the last part's bytes on a step | **nothing**, e2e included → finding 8 |
| 335 | TxDetailButton drops `parts` | tsc TS6133; the e2e |
| 335 | Next not disabled on the last | e2e only (by reading); zz-1 |
| 335 | Transfer, Swaps, Lovejoin, DappApprovals drop `parts=` | **nothing** (803 tests in 34 files; tsc ok) → finding 7 |
| 336 | refresh keeps what the list says, no confirmation | lovejoin-discovery (5 tests) |
| 336 | pools already kept re-confirmed | lovejoin-discovery (calls count) |
| 336 | Koios's failure thrown out of refresh | lovejoin-discovery ("keeps nothing new…") |
| 336 | a trap under the confirmation swallowed | **nothing** (88 tests in 6 files; tsc ok) → finding 1 |
| 336 | `known.has(…) ||` dropped from the final filter | nothing; neutral (keep unions) |
| 336 | the id dropped from the confirmed set's key | nothing; not shown to matter |
| 337 | skip before the hour | lovejoin-planner (#337's test) |
| 337 | skip without `tailOver` | lovejoin-planner |
| 337 | skip without the pump | lovejoin-planner |
| 337 | witnessTail without the over check | lovejoin-planner |
| 337 | the list's view without `collateralHeld` | lovejoin-planner |
| 337 | the session's own view (`one()`) without it | **nothing** (38 tail tests; tsc ok) → finding 3 |
| 337 | `tailHeld` without the waits-or-buildable check | **nothing** (38; tsc ok) → finding 4 |
| 337 | `tailHeld` without the landed check | no test; tsc TS18048 on the natural deletion |
| 337 | skip swallows a trap under the pump | **nothing** (38; tsc ok) → finding 2 |
| 337 | closed sessions offered it too | nothing (38; tsc ok); edge (finding 4) |
| 337 | `sessions.tailHeld` swallows traps | nothing; unreachable (below) |
| 337 | `now < offerAt` → shown at once | collateral-held.test.ts |
| 337 | the button ignores `busy` | no test (222 pass); tsc TS6133 |
| 337 | a swap's page loses one of its two renders | **nothing** (tsc ok) → finding 5 |
| 337 | the way out gone from the swap's page (both), the site's, the mix card, or the page's hand-off | no test (union: 712 tests in 40 files); tsc TS6133 on each natural deletion |
| 337 | the handler's route gone | tsc TS2366 |

## Findings

### 1. medium — #336: the trap a listed pool's confirmation can raise is never tested

`extension/src/background/lovejoin-pools.ts:578-581`, in `confirmed()`:

```ts
    } catch (e) {
      if (isTrap(e)) throw e;
      standard = [];
    }
```

With `if (isTrap(e)) throw e;` removed, all 88 tests of lovejoin-discovery, lovejoin-discovery-review-fixes,
lovejoin-merged-review, wasm-review-fixes, lovejoin-crediting-review-fixes and storage-privacy pass, and so does tsc.

Scenario: on mainnet the data layer lists a pool new to this device. While Koios's `tx_info` for its launch is checked,
`lovejoinLaunchCheck` traps: any panic, an overflow #332 now checks in core, say. The `catch` takes the trap for Koios
being down, so `refresh` resolves, the pool read goes on, and the worker runs on a broken WebAssembly instance with the
wallet unlocked. That is what #330 fixed for the requests it doesn't wait for. The holder's look (`holder()` →
`launched()`) throws the same trap, so only this path would go quiet. Likelihood is low, since `lovejoinVerifyPool`
reads the same row first, but this is a guard on the lock.

The test that would notice (zz-3, passes on HEAD, fails without the line): a `Proxy` over the test WebAssembly whose
`lovejoinLaunchCheck` throws `new WebAssembly.RuntimeError("unreachable")`, a listed pool, then
`await expect(found.refresh("preprod")).rejects.toBeInstanceOf(WebAssembly.RuntimeError)` and nothing kept.

### 2. low — #337: the trap under the skip's pump is never tested, and can't fire today

`extension/src/background/sessions.ts:5532-5534`:

```ts
        await this.serial(() => this.pump(network, index)).catch((e: unknown) => {
          if (isTrap(e)) throw e;
        });
```

With it swallowed (`.catch(() => undefined)`), the 38 tests of the tail describe pass, and so does tsc. On HEAD's path,
though, nothing can trap there. In the skip's state the chain has nothing in flight and its next is the unwitnessed mix,
so `pumpChain` goes straight to `witnessTail`, whose first line (5144) throws `lj.tail.skipped` before any WebAssembly.
The risk is a later change to that order. Swallowed, a trap would leave a by-hand session's wallet unlocked:
`advance`'s `step` returns early for a session that doesn't run itself.

The test that would notice (zz-2): the hour gone, `vi.spyOn(lj, "tailIsOver")` throwing a `WebAssembly.RuntimeError`,
then `await expect(sessions.skipCollateralMix("preprod", 0)).rejects.toBeInstanceOf(WebAssembly.RuntimeError)`.

### 3. low — #337: the session's own view carries `collateralHeld` untested, and #337's test can't tell

`extension/src/background/sessions.ts:5505`, `one()`: `… await this.stillWaiting(network, s), await this.tailHeld(network, s));`

With the last argument dropped, the 38 tail tests pass, and so does tsc. #337's test reads `collateralHeld` only through
`sessions.list`. It discards the before-hour skip's answer (`lovejoin-planner.test.ts:1805`), and its only check on
`one()`'s answer, `expect(after.collateralHeld).toBeUndefined()` (1815), passes whether or not `one()` ever sets it.

Scenario: the Lovejoin page's timer for running mixes replaces each card's view with `session-advance`'s answer
(`Lovejoin.tsx:1757`), and so does a swap's page poll (`Swaps.tsx:2145`). Both answers are `one()`'s. Without the field,
*Bring the rest back now* would drop off a held mix's card at every advance, and off a swap's page after its first
poll.

The test that would notice (zz-2): before the hour,
`expect((await sessions.skipCollateralMix("preprod", 0)).collateralHeld).toEqual({ offerAt: landed + TAIL_OFFER_MS })`,
and the same for `advance("preprod", 0, true)`.

### 4. low — #337: `tailHeld`'s waits-or-buildable check is untested

`extension/src/background/lovejoin.ts:4131`:
`if (!tailWaits(c) && !tailBuildable(c, this.deps.now())) return undefined;`

Removed, the 38 tail tests pass, and so does tsc.

Scenario: the collateral's mix is already witnessed and sent (`tail.scheduled`), and the return waits for it to land.
The page then offers *Bring the rest back now* under `lj.tail.privacy.wayOut`, "The collateral's mix is still waiting
for giveme.my…", which is false by then. Pressing it marks a mix that went as over.

The test that would notice (zz-2): set `tail.scheduled = true` in the record, then expect the list's view to have no
`collateralHeld`.

The landed check on the line before is pinned by the typecheck: deleting it is TS18048 at `c.tail.landed +
TAIL_OFFER_MS`. zz-2 pins its meaning too: on a chain a lock cut before its deposit was known in, the offer must not be
NaN, which crosses the port as `null` and shows the button at once. The closed-session guards (`stage !== "closed"` at
5616, `s.closedAt` at 5510) can go together unnoticed as well. That's an edge: a session closed while its last chain's
tail is still buildable.

### 5. low — #337: either of a swap's page's two ways out can go alone, unnoticed

`extension/src/ui/screens/Swaps.tsx:2513` (a swap that runs itself) and `:2567` (one brought back by hand):
`<CollateralHeldWayOut held={s.collateralHeld} busy={busy} onSkip={skipCollateralMix} />`

Deleting either one alone passes every test and the typecheck, since `skipCollateralMix` is still used by the other.
No test renders any of #337's three pages with a `collateralHeld` view: removing them all, with the Lovejoin page's
hand-off, leaves 712 tests in 40 files green, and only tsc's TS6133 notices.

Scenario: a swap brought back by hand, its return held at the collateral's mix past the hour, line 2567 gone. Its page
offers no way out, and the return waits for the mix's own give-up, up to `TAIL_KEEP_MS`, a day.

The test that would notice (zz-1, over the R3-20 seam): `Session`, `SiteSession` and `MixList`, each rendered with
`collateralHeld: { offerAt: NOW - 1 }`, the button pressed through `on(…)`:
`expect(payloads("session-skip-collateral-mix")).toEqual([{ index: 0 }])`, or the index handed to `onSkipCollateral`.
zz-1's `Session` case is the by-hand branch. A second case with `auto` set covers line 2513.

### 6. low — #333: nothing holds the worker's answer to `back`, the typecheck included

`extension/src/background/handlers.ts:592`:
`return ctx.lovejoin.privateBootstrapBounds(ctx.network, …);`

Back to 1.6.0's `privateBootstrapMost(…).then((most) => ({ most }))`, written plainly, with no cast: 66 tests pass, and
so does tsc. `handle()` returns `Promise<Requests[Message["type"]]["result"]>`, the union of every request's result, so
a case's answer is never checked against its own request (`rpc.ts:2985` says `{ most: number; back: string }`).

Scenario: at `coins_per_utxo_size` 6465, the form gets no `back`, and `bootstrapLimits` falls back to
`BOOTSTRAP_BACK_LEAST`, 1.5 ₳. A private balance of 275 ₳ for 27 classic boxes then shows Bootstrap enabled, and the
funding, priced at 1.8 ₳ (`sessions.ts:2096`), refuses it after the press. That is bootstrap's call 1 coming back. No
money moves.

PoolPage's own wiring (`Lovejoin.tsx:2687`, `:3115`) has no test either. Its natural deletions are TS6133 errors.

The tests that would notice: zz-2,
`expect(await handle({ type: "lovejoin-bootstrap-most" }, { lovejoin: lj, network: "preprod" })).toEqual(await lj.privateBootstrapBounds("preprod"))`.
And zz-1: PoolPage over the seam answering `{ most: 96, back: "1800000" }` at 275 ₳ shows `lovejoin-bootstrap-why` and
disables Bootstrap. It fails if the page stops storing or passing `back`.

### 7. low — #335: four of the five reviews hand their parts to Transaction details untested

`Transfer.tsx:236`, `Swaps.tsx:935`, `Lovejoin.tsx:3075`, `DappApprovals.tsx:772` (`parts={…parts}`)

Only Withdraw's (`Withdraw.tsx:223`) is in the e2e (`extension.spec.ts:2657-2675`). Dropping all four leaves 803 tests in
34 files green, and tsc too.

Scenario: a private Send too large for one transaction, its review saying *Transactions 2*. Transaction details opens
the first part alone with no stepper: 321-parts-worker#5, back on four of the five screens.

The test that would notice: on each review, seeded over the seam, capture the button's props
(`on("TxDetailButton", (p) => …)`) and expect `parts` to be the summary's. Or extend the Withdraw e2e to Transfer. Not
built here.

### 8. low — #335: the view's clearing on a step is tested nowhere, e2e included

`extension/src/ui/components/TxDetail.tsx:132-133`: `setView(undefined); setError(undefined);`

Removed: 65 Vitest tests pass, tsc passes, and by reading the e2e passes too. Its step assertions wait for the next
part's id, which arrives either way.

Scenario: stepping to part 2 whose read is slow or fails, with `NOT_HELD` once the review was replaced, or a lock. Part
1's whole view stays under *Transaction 2 of 2*, with part 1's id in the hash row (`data-value` is
`view.detail.txHash`), beside part 2's error.

The test that would notice (zz-1): the second part's `tx-detail` never answers. After Next, the hash row must say the
second hash and never the first.

The step's fetch (`[hash]`) and Next disabled on the last are covered by the e2e alone. zz-1 shows a Vitest test is
feasible (the seam runs `TxDetailModal`'s effects).

## False confidence, test by test

- #330 handlers.test.ts:
  - The trap it fakes matches the real code: the restore scan calls WebAssembly directly and rethrows traps
    (`sessions.ts:2728-2741`), and so does `pumpParts`.
  - `settled()` is a `setTimeout(0)`, but `trapped()` settles on microtasks over the in-memory areas. Mutating
    `isTrap(e)` to `e` failed all three "leaves unlocked" cases, so it's not passing by timing.
- #333:
  - The dear row merges over the real `epoch_params` fixture (`tests/fakes.ts:426`), as a Koios row would read.
  - The real WebAssembly prices it, and both the form's rule and the funding are asserted at 1.8 ₳.
  - The release-rules test pins the rule (`bootstrapLimits`), not the page. See finding 6.
- #335:
  - parts-send-review-fixes uses the real worker and WebAssembly. Its mainnet assertion is the one that catches a later
    part read off another network.
  - tx-view-screen's two tests are static renders, so no effect runs. They claim only the first render, which is what
    they check.
- #336: the fake Koios answers `tx_info` and `account_update_history` in the flat, `select=`-trimmed shape `koios.ts`
  asks for. It doesn't apply `action_type=eq.registration`, but it's only ever given registrations.
- #337:
  - The planner test moves `landed` back rather than the clock, since the wallet would auto-lock: sound.
  - `expect(after.collateralHeld).toBeUndefined()` is vacuous (finding 3).
  - collateral-held.test.ts never renders `busy: true`.

## Neutral (undone with no test noticing, and nothing changes)

- `sessions.ts:4454`, the 62162483-era recovery branch priced at a fixed 1.5 ₳: only a funding that paid no reserve at
  all reaches it, so `paid < boxesOnly + reserve` is true at 1.5 ₳ and 1.8 ₳ alike.
- `lovejoin-pools.ts:583`'s `known.has(…) ||`: `keep()` unions with what's kept (`:381`).
- `sessions.ts:5511-5514`, `sessions.tailHeld`'s trap rethrow: `lovejoin.tailHeld` makes no direct WebAssembly call, and
  its sealed record opens through the wallet's queue, where a trap locks and comes out as `WalletLocked`.

## Not checked

- The e2e (forbidden here): its coverage of #335's Withdraw stepper is by reading.
- The whole suite: each mutation ran against the files importing the mutated module.
- #333's Rust side.
- The seam tests for the four reviews' `parts` and for Session's `auto` branch: described, not built.

No CLI-only matters.
