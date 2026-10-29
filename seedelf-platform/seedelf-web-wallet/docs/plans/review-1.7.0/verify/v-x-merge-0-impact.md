# v-x-merge-0-impact: x-merge#0, impact and the fix

**Verdict:** confirmed, **medium**. The fix's copy-refusal half is right and minimal. Its join-list half should be dropped: it changes nothing a screen shows, and the only way to make it show would undo #336.

## Is it reachable in the store build?

Yes, in the default setup: mainnet, the data layer up, *Koios only* off.

- `look()` calls `refresh()`, which sets `this.answered` (lovejoin-pools.ts:432) before `confirmed()` runs (:454). `confirmed()` swallows a Koios failure as `standard = []` (:578-581), and `look()` then returns without a holder look (:395).
- So `known()` lacks the listed pool P, and `build()`'s copy check (lovejoin-launch.ts:243-248) passes.
- The rest of the launch doesn't need Koios on mainnet. `epochParams`, `credentialUtxos`, `accountInfo` (Send's `choose`) and `submitTx` all go to the data layer first (data-layer.ts). Only `launches` and `firstRegistrations` are Koios alone (data-layer.ts:276-284).
- Preprod and *Koios only* aren't affected. There `refresh()` has no index, so `look()` falls to `scan()`, which throws while Koios is down, and the build fails loudly.
- A user pays for this only if they start a pool of exactly P's values on a device that hasn't confirmed P: just restored, newly installed, or every refresh since P was listed met a Koios failure. On an IP that Koios's public tier keeps refusing (a shared VPN or NAT exit), that holds for every pool launched after the bundled head start, for good. Mainnet's head start has no pools (`src/lovejoin-pools.json`, height 14,110,720).
- Matching P's values is easier than the scenario suggests:
  - The box ADA is the suggested one (decision 14: "4.5 ₳ for every token S0d measured"), so a token-pool copy needs only the same Q.
  - An ADA pool's copy needs only the same box ADA.
  - The scenario says "the suggested Q", but Q isn't suggested; the box ADA is. The substance holds.

## The repro

The scratch test `tests/zz-review-v-x-merge-0-impact-1.test.ts` is deleted now. It wired a real `PoolDiscovery`, over a fake data layer listing PR #163's preprod token pool, into a real `LovejoinLaunchService`, using `testBalances` with 45 ₳ in the public account.

- **Control.** Koios knows the launch: `build` → `lj.launch.copy`, and `known()` = [P].
- **Koios 503** (three `tx_info` calls with the retries), **Koios 429**, and **Koios without the launch yet** (a lagging backend): `build` passes the copy check every time. It stops only at "Each box needs at least 3.88 ₳", which is an artifact of the fixture: its 2 ₳ box is under today's least, while a real P launched under the same rules wouldn't be.
- **To the end.** With the least stubbed under 2 ₳, Review is built for the copy. It locks **23.14486 ₳** (reference 1.71969, mix_box 3.61609, mix_logic 15.80908, deposit 2), plus the fee.
  - A second build within the five-minute throttle is just as blind, even with Koios back.
  - After five minutes, with Koios back, the copy is refused.
- **Mutation, 1.6.0's behaviour.** In a copy outside the tree, `keep(network, found)` without `confirmed()` refuses all four failing cases with `lj.launch.copy`, and Koios isn't asked. The regression is #336's.
- **Delays.** While Koios answers 5xx, a review waits about 4 s longer (the 1 s and 3 s retries). While Koios hangs, about 91 s (45 s, 1 s, 45 s). Then it builds blind.

No existing test catches this. `lovejoin-merged-review.test.ts:399` and `lovejoin-flows`' `launching` stub `discovery`. #336's own test (lovejoin-discovery.test.ts:404) checks only discovery's state.

## Severity: medium

- It fits the brief's medium: a refusal that doesn't happen in a reachable state, with real harm (23.14 ₳ locked in a pool no wallet shows), and a money guard with no test in that state.
- It's at the low end of medium, because it needs a Koios failure. 1.6.0's 318-worker#1 (the wallet's own repeated start, the same 23 ₳) was rated low.
- It differs from that one in three ways:
  - It's a regression this release brings: 1.6.0 refused this copy whichever single service failed.
  - The user has no way to know about P: the hub shows no pool of that token.
  - The window lasts the whole Koios failure, not minutes.
- It isn't high: it needs an outside failure together with a rare, deliberate action.

## The fix

**Half 1 (the copy check reads the data layer's last offline-verified list): right.** I applied it in a copy outside the tree. The diff:

```diff
--- a/src/background/lovejoin-pools.ts
+++ b/src/background/lovejoin-pools.ts
@@ -267,6 +267,8 @@
   private writing = new Map<NetworkName, Promise<unknown>>();
+  /** The data layer's last list, verified offline, by network: a pool on it Koios hasn't confirmed yet is kept only once it has. */
+  private listedLast = new Map<NetworkName, FoundPool[]>();
@@ -451,9 +453,15 @@
     this.crowds.set(network, new Map([["classic", answer.classic.crowd], ...answer.pools.map((p) => [p.id, p.crowd] as const)]));
+    this.listedLast.set(network, found);
     await this.keep(network, await this.confirmed(network, found));
   }
 
+  /** The data layer's last list on `network`, verified offline, Koios's confirmation or not: no request. */
+  lastListed(network: NetworkName): FoundPool[] {
+    return this.listedLast.get(network) ?? [];
+  }
--- a/src/background/lovejoin-launch.ts
+++ b/src/background/lovejoin-launch.ts
-  discovery: Pick<PoolDiscovery, "known" | "look">;
+  discovery: Pick<PoolDiscovery, "known" | "look"> & Partial<Pick<PoolDiscovery, "lastListed">>;
@@ -242,7 +242,8 @@
     const known = await this.deps.discovery.known(network);
-    const copy = known.find(
+    // A pool the data layer lists that Koios hasn't confirmed yet isn't read, but a start of its values is its copy.
+    const copy = [...known, ...(this.deps.discovery.lastListed?.(network) ?? [])].find(
```

What I ran on the fixed copy:

- **The fixed repro.** Koios 503, 429 or lagging each refuse with `lj.launch.copy`, and `known()` stays [], so #336's protection of the read set holds.
  - Other values still build while Koios is down.
  - The data layer marked down within the five minutes: still refused.
  - Both services down: the build fails at the holder look, as before.
- **The related suites.** lovejoin-discovery, -discovery-review-fixes, -merged-review, -flows, -launch-review-fixes, -pools, -pools-head-start, -token-feed, -hub and -screens-review: 203 passed, 2 skipped.
- **`tsc --noEmit`:** clean. The `Partial` keeps every stub `discovery` compiling.

Notes on half 1:

- **Never clear the list; let each answer replace it.** My first version cleared it whenever the data layer was down, as `crowds` are cleared (UI-9). That reopens the hole: within the five minutes after an answer, `look()` still skips the holder. Unlike a crowd, a pool's existence doesn't go stale. A worker restart empties the list, and the next refresh asks again.
- **It stays within the owner's rules.**
  - Rule 1: it widens an existing refusal (decision 14: "A copy of a shown pool's values is refused") back to the input it had in 1.6.0. It adds no new guard, and no new words.
  - It makes no request and keeps nothing on disk: the list is the one the worker already fetched, held in memory. So no privacy-policy entry and no Koios cost.
  - No i18n key changes.
- **What it changes beyond the bug.**
  - The wallet's own start that's on the list but unconfirmed is now refused as a copy, where HEAD (with Koios down) only warned through `startedBefore`. That matches what happens with Koios up.
  - A server that lists a pool that isn't there can now cause only a false refusal of those exact values, and the user can choose other values.
  - The refusal's words, "Use that pool instead", point to a pool the hub won't show until Koios confirms it: at least five minutes with Koios back, or never on an IP Koios refuses. That's acceptable, with no new key.
- **Optional refinement.** Leave out pools Koios answered for and found not standard. Count only those Koios couldn't answer about or didn't know yet, so a server mistake can't refuse values whose pool Koios has disproved.
- **Owner's call (my idea).** The owner's call 1 on 318-worker#1 chose "a warning in place of a refusal" for a start no look had confirmed. If the owner wants the same here, a review warning replaces the refusal. That needs a new `.warn.` key, which is critical: a blind es/ja back-translation. Refusing is the minimal change and restores 1.6.0.

**Half 2 (`terms()`' join list reads it too): drop it.**

- `terms.pools` (lovejoin-launch.ts:211-214) is read by no screen.
- The form's join list and its own copy pre-check are `same` and `copy` over the `pools` prop (LovejoinLaunch.tsx:147-148). That prop is `poolsOf(status)` (Lovejoin.tsx:1846): the hub's read set, which comes from `known()` through `serviceDeps`.
- So changing `terms()` changes nothing the user sees.
- Putting unconfirmed pools in `status.pools` would hand them over, into the read set for good, which is exactly what #336 prevents.
- The form won't pre-refuse P, but Review's build will, and its error shows on the form. That's enough.
- Aside: `terms.pools` looks like dead output, computed and tested but never shown. It's a separate nit, not part of this finding.

## The test to add

Use the finding's first half as it stands: a real `PoolDiscovery` over a data layer listing P, with Koios answering `tx_info` with a 503.

- `build` for P's values must reject with `lj.launch.copy`. It passes the check on HEAD, so the test fails before the fix.
- It needs no stub: the copy check runs before the least check.
- Also assert that `known()` stays [], and that other values still build.
- Replace the finding's `terms()` assertion, which tests a field nobody reads.
