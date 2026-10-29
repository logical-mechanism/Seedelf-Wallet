# v-x-rel-4-impact: x-rel#4, impact and the fix

**Finding:** #337's way out (*Bring the rest back now*, `session-skip-collateral-mix`) has never run against a chain: no e2e, no live preprod run, no checklist line.

**Verdict: confirmed. Severity: low, as filed.** Confidence is high. Every fact holds on HEAD `6bca8bec`. The fix is right in kind (a live preprod run, then one checklist line), but its recipe is wrong in five details. As written, it could miss the state, or record a false failure. Corrected below and checked by scratch tests over the real worker.

## The facts hold

- **No e2e names it.** `grep -rln -E "Bring the rest back now|skip-collateral-mix|collateral-held|wayOut|collateralHeld|tailHeld|TAIL_OFFER" e2e/` finds nothing. I grepped with `support.ts` excluded, and a count on `support.ts` alone is 0.
- **No live run.**
  - PR #337's body says "Checked by eye … e2e can't reach this state under its fakes".
  - The commit is 18:15Z and the merge 18:30Z, and the hour itself takes longer than that gap.
  - `e2e/live/` (`run.mjs`'s flow list) has no session or Lovejoin flow at all.
- **No checklist line.** `development.md:145` ends "…and that mix waits for giveme.my;".
- **The owner's rule** (2026-10-20, *test-live-on-preprod*): run a send path the e2e fakes can't complete live on preprod before reporting it. Never hand "the first real run" to the owner.

## Can it happen with the shipped build?

**Mainnet, the store's default: dormant.**
- `collateralPool` (`lovejoin.ts:3969-3974`) needs a shown 5 ₳ ADA pool, not a copy, that is usable now, holds the floor of other people's boxes, and has two of them free.
- Mainnet's floor is 30 (`networks.ts:71`).
- The bundled head start lists no mainnet token pool at all (`src/lovejoin-pools.json`: `mainnet.pools` is empty at height 14110720).
- That threshold is chain state, so the path can switch on with no update. I made no mainnet read to see whether someone has started a 5 ₳ pool since.

**Preprod, in Settings: reachable today.**
- The floor is 0 (`networks.ts:56`).
- The head start carries the 5 ₳ pool `18c4df77…`.
- `lovejoinReturns` and `lovejoinCollateral` are on by default (`shared/preferences.ts:172-173`).

**Even there it needs giveme.my not to sign for an hour,** so a tester meets it rarely.

## Harm: low

- **#337 adds no transaction shape and no request.**
  - The press marks the tail over, and `witnessTail` stops a chain before it asks giveme.my (`sessions.ts:5144`).
  - The rest comes back by the same direct return that the day's end (`lj.tail.tooLong`) and a refusal (`lj.tail.refused`) already lead to.
  - The plan itself framed the item as "a button and its words" (`post-release-roadmap.md:373`).
- **If the press misbehaved,** the fallback is 1.6.0's behaviour: the day's wait (`TAIL_KEEP_MS`). The 5 ₳ box stays the wallet's either way, so nothing is lost.
- **Why not refuted:**
  - The owner's standing rule asks for exactly this run.
  - 1.6.0's gate had the same kind of finding (`x-release#1`). Its live run found LIVE-1 in this same state machine: a cut chain whose rest came back read "stopped partway" (`docs/archive/plans/chunk-34-token-pools.md:957`).
  - Mainnet can switch on without an update.
- **Why not medium:**
  - There's no new shape or service, unlike 1.6.0's `x-release#1`, which was giveme.my's first Lovejoin mix.
  - The worker's path is exercised over fakes: the PR's test, plus pr337's scratch R5.
  - This is "a missing test on a minor path".

## The fix: five corrections, then the line

1. **Who and when.** The lead runs it in this gate, on preprod with the gate's test wallet, never on mainnet. Run it on the fixed build, after pr337#0, #1 and #3's fixes, since each changes this path. Record its hashes in the 1.7.0 handoff note, as 1.6.0's gate did. "The release's preprod pass" would hand the owner the first real run.
2. **Block giveme.my in the worker, as a network error.**
   - The worker asks giveme.my (`collateral.ts` `witness`, through `tailWitness`), so `page.route` never sees the request. Use `context.route("https://www.giveme.my/**", (r) => r.abort())`, as e2e routes the worker (`e2e/data-layer.ts:39`), or the worker's own DevTools (chrome://extensions → service worker → Network request blocking).
   - A blocked fetch is a `CollateralError` (`collateral.ts:67`), which `witnessTail` waits out (`sessions.ts:5162`). Scratch A shows this.
   - **Never a 4xx.** Past `GIVEME_BEHIND_MS` that stops the chain (`sessions.ts:5161`). For a session that runs itself, the rebuilt mix is refused too, so its tail ends and the rest comes back within about 10 minutes, with no offer ever shown (scratch B).
3. **Block earlier.** Block once the session's funding is sent, which is the only giveme.my request before the tail. Don't wait "once the collateral's deposit lands": `pumpChain` asks giveme.my at the first 5 s poll after everything before the mix is on chain (`lovejoin.ts:505-508`), so it has usually signed by then.
4. **At most one lock in the hour** for a session that runs itself.
   - Auto-lock is 15 minutes by default (`preferences.ts:167`), and only pointer and key events count as activity (`App.tsx:95`).
   - One lock is fine: the runner builds the mix again, which waits too, and the offer still comes at the first deposit's hour (scratch C).
   - A second cut ends the tail (`TAIL_TRIES = 2`, `lovejoin.ts:328`, `:1340`). The rest then comes back by itself, with no offer.
   - So set auto-lock to 60 minutes and click within it, or let exactly one lock happen. That one lock covers the lock-cut branch, which is the usual state at the hour.
5. **The expected results depend on the kind.**
   - **A mix's card (it runs itself):** the press sends one direct return in the same request (scratch C).
   - **A site's page (by hand):** the press stops the chain and sends nothing. The page reads "Stopped after 3 of 5 transactions; the rest stays at the account until you bring it back" (`lovejoin.chain.stoppedByHand`, scratch A). The finding's "the rest should come back directly" would fail there. That is pr337#1, and its fix decides this line.
   - **A swap's page:** it adds Minswap's preprod fill and no new worker path, so it's optional.
   - **Where the reason shows:** only on the Lovejoin page (`lovejoin.chains.whyStopped`, and the card's detail). A swap's or site's page shows `chainText` alone (`SiteSessions.tsx:407`, `Swaps.tsx:3052`).
   - **Don't quote `lj.tail.skipped` in the checklist.** pr337#1's fix rewords it.

Also check the precondition before the hour starts: the return's review shows *Its 5 ₳ collateral* mixed in the 5 ₳ pool. If it doesn't, the preprod pool lacks two free boxes of other people's (`lovejoin.ts:3974`), and no tail is built. The last step stands as written: unblock giveme.my, since *Mix my boxes again* is giveme.my-backed, and it should move the box.

**The checklist line,** after `:145`, with its site clause following whatever pr337#1's fix decides:

> the way out of that wait: block `www.giveme.my` in the worker's DevTools once the session's funding is sent, and an hour after the collateral's deposit lands the mix's card offers **Bring the rest back now**. It brings the rest back at once (a site's waits for **Bring it back**), the Lovejoin page says why the chain stopped, and once giveme.my is unblocked, **Mix my boxes again** moves the 5 ₳ box;

## What else the fix changes

- **No code, string, guard or privacy note changes.** The owner's rules are untouched.
- **The run** spends preprod tADA only, which is free.
- **The checklist** gains about an hour of wall time per release, run alongside the other items. Keeping the line for later releases, rather than the one live run alone, is the owner's call.
- **Overlaps:**
  - x-rel F6's #337 bullet is this same line, so merge them.
  - pr337#2's unit tests complement the run: the run doesn't replace them, and they don't replace it.
  - pr337#1 sets the site's expected outcome.
  - pr337#3's fix 2 changes the press's race with a rebuild.

## Repro (scratch, deleted)

`extension/tests/zz-review-v-x-rel-4-impact-1.test.ts` used the planner test's harness: the real WebAssembly, a 5 ₳ pool, giveme.my's fetch swapped mid-test. Its three tests pass on HEAD.

- **A: a site's session, giveme.my's fetch throwing** (`TypeError: Failed to fetch`), with 61 alarm runs a minute apart and the user active.
  - giveme.my was asked 7 times (0, 1, 3, 7, 15, 31 and 61 min). The chain was still pending, with its tail not over, and `collateralHeld` was `{ offerAt: landed + TAIL_OFFER_MS }`.
  - **The press:** the tail is over, `stopped` is `lj.tail.skipped`, giveme.my isn't asked again, nothing is submitted, and the stage stays `open`.
- **B: a mix that runs itself, giveme.my answering 403.**
  - The first chain stops (`lj.tail.refused`, tries 1). The rebuilt one stops too (tries 2), and both tails are over.
  - One direct return spends the deposit's change and not the 5 ₳ box, 10.5 minutes after `landed`.
  - `collateralHeld` never shows.
- **C: a mix that runs itself, giveme.my's fetch throwing, with a lock wiping the chain at 20 minutes.**
  - The runner rebuilds the mix (tries 2, same `landed`), which waits. At 61 minutes `collateralHeld` is `{ offerAt: landed + 1 h }`, and giveme.my had been asked 11 times.
  - **The press:** exactly one submit, spending the deposit's change and not the box. giveme.my isn't asked again, the stage is `returning`, and every tail is over.
