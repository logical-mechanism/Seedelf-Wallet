# O cluster: the design (o-design)

Verifier: **o-design**, round two. Tree `a6c94743`, sandbox `…/scratchpad/wt/words`. Every command ran from its `seedelf-platform/seedelf-web-wallet/extension` with `--maxWorkers=2`.

I mutated four files in the sandbox and put each back from a copy: `src/background/lovejoin.ts` (md5 `ec3a833f…`), `src/background/sessions.ts` (`e457a663…`), `src/lovejoin-pools.json` (`c29cc9d4…`), and `lovejoin-pools.ts`, which I read but never changed (`a84413ac…`). `git status` shows only untracked scratch files, and I ran no state-changing git. I didn't open `support.ts`, the vectors, the test wallet or any `.env`, and nothing touched the network.

**My scratch files** (all in the sandbox's `extension/`):
- `tests/o-design-found-later.test.ts`: discovery wired as `sw.ts` wires it (`serviceDeps(discovery)`, `lookForPools: discovery.look`), with Koios's holder answering a v2 5 ₳ launch made after preprod's head start. Its tests assert what `a6c94743` does.
- `tests/o-design-found-fixed.test.ts`: what the change set should make true. Its tests ran against the prototype.
- `tests/o-design-mainnet-verify.test.ts`: the same launch re-addressed to mainnet, with Koios-only on.
- `tests/o-design-token.test.ts`: the cross reviewer's token test, copied.
- `tests/o-design-planner-noada.test.ts`: a copy of `lovejoin-planner.test.ts` with an O5 block added, run with `-t "o-design"`.
- `tests/o-design-hub.test.ts` and `src/ui/screens/Lovejoin.o-design.tsx`: the screens reviewer's hub test, copied. Its copy of the hub differs from `Lovejoin.tsx` only in the two `useState` initial values (checked with `diff`).

**The prototype:**
- Its diffs are in the scratchpad: `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/o-design-full-patch-lovejoin.diff` and `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/o-design-full-patch-sessions.diff`.
- They hold the lead's draft at `adaPool`, `priced` and `collateralWanted` asking, and the O5 change.

## Verdicts in short

| ID | Verdict | Severity | Introduced | One line |
|---|---|---|---|---|
| O1 | **CONFIRMED** | medium | new | Without Lovejoin's page, a later pool is found only through the data layer's list. Preprod, Koios-only and a data layer marked down never find it. The lead's draft fixes this: tested in all four modes, mainnet itself included. |
| O4 | **CONFIRMED** | low | new | The saved reason reads false on the session's page once a pool exists. Present tense, it's also false in O1's own state. |
| O5 | **CONFIRMED** | low | new | With no 5 ₳ pool, a usable v2 token pool is skipped too. A swap's approval in that state funds the token's box and shows it going in, yet the return brings it back directly. A fix was prototyped and builds. |
| O6 | **CONFIRMED** | nit | new | The hub says "A mixer for ADA and tokens" with only the 5 ₳ pool, and says nothing of "No pool to mix in yet" while only retired pools are listed. A fix was prototyped. |

---

## 1 · Every path that reads the 5 ₳ pool

What a quiet read sees is what discovery last kept. An ask refreshes the data layer's list (throttled to `REFRESH_MS`). No path looks at Koios's holder; only Lovejoin's page and a pool's start do.

| Path (`a6c94743`) | Quiet or asking | With no pool | What the call needs |
|---|---|---|---|
| `adaPool(network, ask)`, `lovejoin.ts:4057` | Quiet. With `ask`, a refresh after a quiet read finds none | `undefined` | **The ask must look**, at most every `REFRESH_MS` (§3). Keep it quiet without `ask`. |
| `adaPoolOf`, `lovejoin.ts:671` | Pure | `undefined` | Nothing. |
| `collateralPool`, `:4117` (a return's build `sessions.ts:4403`; `tailReserve` `:4644` at every funding review: a swap's, a site's, a mix's, a top-up's) | Asks (`adaPool(network, true)`) | `undefined`: the collateral comes back with the rest | Gets the look through `adaPool`. Nothing else. |
| `collateralPoolTakes`, `:4137` (quote as typed `:1582`, Stop `:3326`, a failed read's fallback `:4650`) | Quiet | `"no"` | Stays quiet. These are reads as the user types, and Review is the one that decides. |
| `room`, `:3308` | Quiet by default. Its one caller (`priced`) passes `ada.id` | `undefined` | Drop the dead default (W10). |
| `funding`'s tail, `:3467` (the Mix form) | Quiet | No `collateralReserve` on the form | Stays quiet: the form is on Lovejoin's page, whose look runs as it opens. The mix's own review (`mixFunding` → `tailReserve`) asks. |
| `priced`, `sessions.ts:1755`, its read `:1759` (quote, Review `:1619`, Stop `:3306`) | Quiet, even at Review | 0 boxes, `skipped: noAdaPool` | **Ask at Review and Stop** (`adaPool(network, pool)`, O2's fix 1). It must ship with O1's look (E5). |
| `collateralWanted`, `sessions.ts:4694`, its read `:4701` (buildBack's no-collateral path `:4465`; the top-up offer and the list through `lovejoinWantsCollateral`) | Quiet | `false`, so a return says "its spare ADA is too little for a box" for 40 ₳ | **Ask at a return's build and `backCollateralBuild`.** The list (`backWantsCollateral`) stays quiet. Where the ask finds no pool and no token's pool wants it, say `noAdaPool` (O2's fix 2). |
| `chain()`, `lovejoin.ts:3516-3517` | Asks | Throws `noAdaPool` before `acrossOf` | Gets the look through `adaPool`, plus O5's change: the tokens go without an ADA leg. |
| `acrossOf`, `:3716`; token pools `:3724`; `ada = c.pool` `:3750` | Token pools quiet. The ADA leg is chain()'s | Not reached | O5. A token pool launched later on Koios paths is found only by the page: old since 1.6.0 (risk 9). |
| The Mix form, `Lovejoin.tsx`: `tailReserveOf` `:329`, `lovejoin-funding` | Status (a pool read) and the funding's quiet tail | The hub has no 5 ₳ pool row: no Mix | Nothing: the page's look runs first, and `grew` reloads the page. |
| The connector's approval, `DappApprovals.tsx:533`, `FundingWayBack` `:455-500` | Reads nothing of the pool | Promises mixing | O3. The card reads quietly, never a look. The funding review takes its mark from its own Review ask, which this set makes look. |
| The hub, `Lovejoin.tsx:1743-1750` (look), `:1922-1929` (aside), `:2003-2009` (none yet) | Status is a non-quiet pool read; the look runs beside it | "No pool to mix in yet." only when nothing is listed | O6's words. |

## 2 · How a pool launched after the head start is found at `a6c94743`

Discovery's wiring:
- `sw.ts:236-247` wires `serviceDeps(discovery)`: `pools` is `refresh` then `known`; `known` asks nobody; plus `copies` and `copiesRead`. `lookForPools` is `discovery.look`.
- `look` (`lovejoin-pools.ts:402`) is `refresh`, then `scan` unless the data layer answered within `REFRESH_MS`.
- `scan` (`:495`) reads Koios's holder, deduped by `looking`, and takes only launches `SETTLE_MS` old.
- `refresh` (`:415`) asks `index`. `privateIndexClient` (`private-index.ts:362`) gives none on preprod (no origin), with Koios-only on, and while the private part is marked down.

| Network, mode | A return's build, a collateral pick (`adaPool`'s ask) | Other non-quiet reads (split/splitAll, poolNamed, poolsOf at Review, status) | Lovejoin's page | Start a pool's review (`lovejoin-launch.ts:244`) |
|---|---|---|---|---|
| preprod | `refresh` asks nobody: **not found** | not found | `scan`, Koios's holder: found | `look`: found |
| mainnet, data layer up | the list: **found**, once it's on it (≥200 slots after launch, at most 5 minutes old) | found the same way | `refresh`: found, no Koios read | found |
| mainnet, Koios-only | **not found** | not found | Koios scan: found | found |
| mainnet, data layer down | **not found**; nothing new while its last answer is under 5 minutes old | not found | Koios scan, once the last answer is 5 minutes old | found |

**E1.** `npx vitest run tests/o-design-found-later.test.ts --maxWorkers=2 --silent=false`: **5 passed**.
- preprod, Koios-only and data layer down (the list answers 503) each print `before the page: lovejoin=null skipped=Lovejoin has no pool of 5 ₳ boxes to take it yet holder reads=0`.
- Then `lookForPools` gives `{grew: true}`, and the next build gives `pool=0eedc4eb… boxes=2 tail=0eedc4eb…`.
- With the data layer up: the pool is found, Koios is never read, and the index sees `["lovejoin/pools"]`.

**E8.** `npx vitest run tests/o-design-mainnet-verify.test.ts --maxWorkers=2 --silent=false`, on mainnet proper, with the fixture re-addressed as the e2e's `fiveAt` does:
- WebAssembly verifies it (`version "v2"`, 5 ₳).
- With Koios-only on, `adaPool("mainnet", true)` gives `none`, with Koios calls `[]`.

## 3 · The change set

### The smallest change

The lead's draft, made exact: `lovejoin.ts adaPool`.

```ts
async adaPool(network: NetworkName, ask = false): Promise<LovejoinPool | undefined> {
  if (!this.available(network)) return undefined;
  const kept = adaPoolOf(await this.readSet(network, true));
  if (kept || !ask) return kept;
  const listed = adaPoolOf(await this.readSet(network));
  if (listed || !this.deps.lookForPools) return listed;
  // Not listed, or no list read (preprod, Koios only, the data layer down): Koios's holder, as Lovejoin's page reads
  // it, at most every REFRESH_MS a network, counted from the attempt (the owner, 2026-11-06). A look that fails finds none.
  const now = this.deps.now();
  const last = this.looked.get(network);
  if (last !== undefined && now >= last && now - last < REFRESH_MS) return undefined;
  this.looked.set(network, now);
  await this.deps.lookForPools(network).catch(unlessTrap(undefined));
  return adaPoolOf(await this.readSet(network, true));
}
```

Two ways to have the constant:
- import `REFRESH_MS` from `lovejoin-pools.ts`, which imports only types from `lovejoin.ts`, so there's no runtime cycle;
- or keep a constant beside `POOL_ROOM_MS`.

### What it does

- **A return's build:** `chain()` and `collateralPool` both go through `adaPool`. The build reads the holder once; the second ask reads quietly.
- **A swap's Review and Stop's dialog:** `priced` asks.
- **A funding's collateral pick:** `tailReserve` → `collateralPool`.
- **The no-collateral return:** `collateralWanted` asks.
- The quiet reads stay quiet: the quote as the user types, `collateralPoolTakes`, the form's tail, Home's `held()`, Activity.

### Ordered

1. **`adaPool`'s ask looks** (above). There's no `sw.ts` change: `lookForPools` is wired already, and tests without it keep today's behaviour.
2. **`priced` asks at Review and Stop** (`sessions.ts:1759`: `adaPool(network, pool)`), and is quiet as the user types. Without it, O1's look spreads O2's contradiction to every network (E5).
3. **`collateralWanted(…, ask)`.**
   - `buildBack`'s no-collateral path and `backCollateralBuild` ask; `backWantsCollateral` (the list) doesn't.
   - With no ADA pool after the ask, and no token's pool wanting the collateral, say `noAdaPool`, not `noBox` (O2's fix 2: the ask before the reason, as o2-trace finds).
4. **O5:** no 5 ₳ pool shown, a return's tokens still go.
   - `chain()` runs `acrossOf` with no ADA leg when `way.returns` is set, no pool is named and it isn't a Mix again.
   - `acrossOf`'s `ada` becomes optional: its values, its guess, its legs and `adaSplit`; `adaShort` is `!ada ||` the floor; "none goes" says `noAdaPool`; the token-failure fallback returns no `ada`.
   - `noAdaPool` is thrown only when no token goes.
5. **O4:** a reworded, critical `sess.skip.warn.noAdaPool`.
   - A wallet-side past clause, true later and in O1's residual windows: e.g. "the wallet knew of no pool of 5 ₳ boxes to take it".
   - `swaps.lovejoin.warn.pool` and `swaps.stop.poolShort` open with `{{why}}`, so either give them a capital (`Swaps.tsx:1615`, `:2929`, as `sentence.ts` does) or pick a value that starts with one.
   - es and ja need a blind back-translation, and the negation lists must still match.
   - Update the literal pin at `tests/lovejoin-1-5-0.test.ts:420` (`NO_ADA_POOL`).
6. **O3** (its verifier's): the card's mark is a quiet read, never a look (a look there would tie a Koios read to a site's connection). The funding review's mark is `priced`'s `skipped`, asked at Review (step 2), so it already sees a pool found by step 1.
7. **O6:**
   - The aside is keyed on a token pool that takes boxes (`!!p.box.token && !isRetired(p) && !isCopy(p)`).
   - `noneYet` shows when no listed pool takes boxes and nothing is typed; `noneMatch` stays for a query.
   - `tokenPools` stays the gate of the critical `lovejoin.start.warn.cost` note. Changing it would change that note's visibility as a side effect.
8. **Hardening (recommended):**
   - (a) **The throttle in discovery.** `PoolDiscovery.lookSoon(network)` would skip a scan within `REFRESH_MS` of any scan, the page's too, and join one under way. It's exposed through `serviceDeps` and used by `adaPool` in place of its own map. Today the draft's throttle doesn't see the page's scans: a page's look, then an ask, reads the holder twice (E4).
   - (b) **Share an in-flight refresh** (a `refreshing` map, as `looking` is). Then a refresh that overlaps another waits for the list, rather than returning at once and letting `look` scan Koios while the data layer answers. That race is old (E4: two looks at once), and the ask adds callers to it.
9. **Docs in the same PR:**
   - The privacy policy's `:46` changes. Its dated *Changes* entry for this rides with D2's 1.8.0 entry: "while it knows of no pool of 5 ₳ boxes, a private session's return, a review and a funding also look, at most every five minutes, the same read of Lovejoin's reference holder."
   - `privacy.md:201`, now "only as the Lovejoin page opens or a pool's start is reviewed".
   - `architecture.md:733`, now "or Koios's holder as the Lovejoin page opens".
   - `development.md:330`'s "a head start, never a gate: a pool launched after it is found live" is true again.
   - The plan's 44c: the gate goes, and how a later pool is found goes in.
10. **The tests in §5,** unit on both builds, and one e2e on mainnet.

The release branch's prep (`1beba3fb`) bundles preprod's `47bece42` in the head start. That's harmless: a head start, not a gate. But on preprod the release build then never runs the look (E9), so it's tested on mainnet's path (§5).

## 4 · The lead's draft, judged

The draft holds on every point, with two refinements (§3 step 8) and the privacy policy's words (§3 step 9).

**E2.** With the draft applied, `o-design-found-later` fails its three "before the page" cases, as it should:
- each now finds `{"boxes":2,"depth":2,"mixes":8,…,"pool":"0eedc4eb…"}`, with `holder reads=1`;
- the data-layer-up case is unchanged (`holder=0`).

**E3.** `npx vitest run tests/o-design-found-fixed.test.ts --maxWorkers=2 --silent=false` with the draft: **10 passed**.

### Koios requests added (the public tier is per IP: 5,000 a day, 100 per 10 s)

**Preprod at `a6c94743`'s head start.** The first ask costs one `credential_utxos` (the holder from the head start's height − 20) and one `tx_info`:
- E3: `[credential_utxos, tx_info] = [1, 1]` at the build, then none.
- With the prep's head start, none: the pool is kept.

**Mainnet, Koios-only or the private part down, before any pool exists.** One holder read per ask, at most every `REFRESH_MS` a network:
- E3, no pool: `credential_utxos?block_height=gt.5356438…` twice over three builds and one clock step.
- Plus `tx_info` for any unsettled or unknown candidate of a listed value.
- After the launch, one holder read and one `tx_info`, once (E8 with the draft: `["credential_utxos","tx_info"]`).

**Mainnet, data layer up.** No Koios read:
- E3 "data layer up, not listed": Koios calls `[]`, index `["lovejoin/pools"]`;
- E1 "listed": found, holder 0.

**A failing look:** three requests (the client's retries), then none for `REFRESH_MS` (E3).

The throttle lives in memory, as `refresh`'s does (`privacy.md:200`). MV3 stops an idle worker, so the bound is about one look per return or review after idle while no pool exists: bounded by what the user does.

### Privacy

**What's read.** The holder read is the same for every wallet with the same look history:
- `POST credential_utxos {"_payment_credentials":["288fea77…"],"_extended":true}`, `block_height=gt.<h>`, paged;
- `h` is the head start's height or the device's last look, less 20;
- nothing of the wallet's is in it (E3's printed query).

**When it's read.** At a return's build, a review, or a funding's collateral pick, and only while no 5 ₳ pool is kept. So it does come at a moment tied to a return:
- **On preprod and with Koios-only,** Koios already gets that build's account reads and its submit from the same IP, so the look adds no linkage.
- **With only the private part down,** a return's pool read of the 5 ₳ pool goes to Koios anyway once a pool is kept (1.6.0's accepted fallback), so the look is the same kind of read at the same moment.
- **The one new case** is no pool known at all, where today the build reads no pool. That's one holder read seconds before a direct return that the data layer's submit part sends.

This changes when the wallet sends a request, so it owes the policy's words (§3 step 9).

### Races with the page's look

- E3 "the page's look and a return's build at once": **one** holder read. `scan` dedups by `looking`.
- E4 (`-t "draft's edges"`):
  - the page's look, then an ask: **2** holder reads, because the draft's throttle is its own (hardening a);
  - with the data layer up, a page's look and a build at once: Koios `[]`;
  - but two looks at once give Koios `["credential_utxos","tx_info"]` while the data layer answers. That race is old, and hardening b closes it.

### A look that fails

The draft swallows it, and hands on a trap. E3: the return comes back directly with `noAdaPool`, nothing is thrown, nothing is asked again within `REFRESH_MS`, and the next ask after it finds the pool.

That's the precedent: discovery failing elsewhere is "no pool gone", and `collateralPool`'s failed read leaves the collateral out, not the return.

The cost: during a Koios failure on Koios paths, a return that could have mixed comes back directly, and so does the runner's swap return, which no one reviews. Rethrowing would block every Koios-only return while Koios is down, before any pool exists. Choose this deliberately. Either way, O4's words must say what the wallet knew.

### SETTLE_MS

E3: a launch 3 minutes old isn't taken, the look `REFRESH_MS` later still isn't, and the next one is: found **13 minutes after its block** (three holder reads, one `tx_info`). So the bound is `SETTLE_MS` + `REFRESH_MS`, about 15 minutes, on Koios paths. With the data layer, it's its own lag plus 5 minutes.

### A pool launched but still empty

Once found, it's kept, and no more looks run.
- **Under a floor of 30** (preprod's floor set as `lovejoin.test.ts:782` sets it): "Lovejoin's pool holds 20 boxes not yours, and the wallet mixes only from 30", and no `collateralTail`, so the collateral comes back with the rest.
- **Empty on preprod (floor 0):** "Lovejoin's pool has 0 boxes to mix with, and this needs 8".
- Both are true, and both come back directly, as the owner's call 4 says.

### Other checks (E3)

- `collateralPool` alone (a funding's pick) looks once and finds it.
- **E5** (`-t "swap's Review"`):
  - the draft alone gives `skipped: noAdaPool, boxes 0, collateralReserve 1500000`, with one holder read at Review and none as the user types. That's O2's contradiction, now on preprod too;
  - with `priced` asking, it gives `ifStopped {boxes 1, mixes 4, mixFees 3800000, withdrawFees 300000}`, no `skipped`, one read at Review and none as the user types.
- **E6** (`-t "no 5 ₳ at its account"`):
  - the draft alone says "its spare ADA is too little for a box", with zero holder reads;
  - with `collateralWanted` asking, it says "its 5 ₳ collateral isn't at its account anymore, and the mixes need it", after one read.

### With all three changes applied

- `npx vitest run tests/o-design-found-fixed.test.ts tests/lovejoin-retired.test.ts tests/lovejoin-1-5-0.test.ts tests/lovejoin-planner.test.ts tests/collateral-reserve-review-fixes.test.ts tests/lovejoin-discovery.test.ts --maxWorkers=2`: **6 files, 176 passed**.
- `npx vitest run tests/sessions.test.ts tests/lovejoin.test.ts tests/swap-lovejoin-way.test.ts tests/approvals-review-fixes.test.ts tests/dapp-prompt.test.ts tests/session-collateral.test.ts --maxWorkers=2`: **6 files, 208 passed**.
- `VITE_ENABLE_MAINNET=false`, for `o-design-found-fixed`, `o-design-found-later` and `lovejoin-retired`: 33 passed, and the 3 failures are `found-later`'s pins of `a6c94743`.
- `npx tsc --noEmit -p .`: no error under `src/`. All 71 are unused imports in scratch tests.

## 5 · Tests for "found later"

### What exists

- `lovejoin-retired.test.ts`'s "asks discovery once for the 5 ₳ pool where it had kept none…" (e8dc1ec9). It fakes `pools` as if a data layer answered on preprod. It pins the ask, not the wiring: the real preprod wiring fails where it passes (E1).
- `lovejoin-discovery.test.ts`: `scan`, `refresh` and `look` as units (settling, failure, head start, throttle).
- `lovejoin-pools-head-start.test.ts`, and `lovejoin-1-5-0`'s head-start case.
- The e2e: `fivePool` with `lookedForFive` (the page's look, asked of the worker), called before every return test. It hides this gap.

### What's missing

Each test uses discovery as `sw.ts` wires it, with an **injected `headStart` holding no v2 pool**. E9 shows why: with the release branch's head start, the preprod return finds `47bece42` quietly and comes back with "Lovejoin's pool has 0 boxes to mix with, and this needs 8", with no holder read. So a test reading the bundled file changes meaning at each refresh.

1. **preprod:** at its build, a return finds the pool at Koios's holder (one `credential_utxos`, one `tx_info`) and mixes there, its collateral too. The next build reads nothing.
2. **mainnet, Koios-only** (the fixture re-addressed, E8): `adaPool` and `collateralPool` find it from the holder, and the data layer is never asked.
3. **mainnet, data layer marked down:** the same, from Koios. With its last answer under 5 minutes old: no Koios read.
4. **mainnet, data layer up:**
   - listed: found, and Koios is never asked;
   - not listed: back directly, and Koios is never asked.
5. **No pool anywhere:** one look per `REFRESH_MS` a network; back directly with O4's words.
6. **A look that fails:** back directly, nothing thrown, no retry within `REFRESH_MS`. A trap in the look is handed on.
7. **`SETTLE_MS`:** a launch under 10 minutes old isn't taken; the first look after it settles takes it.
8. **Found but short:** under a floor, the floor's words, the collateral with the rest; empty, the "needs more" words.
9. **A swap:** its Review and Stop's dialog find the pool; the quote as the user types reads no holder.
10. **A return with no 5 ₳ at its account:** never "too little for a box". With no pool anywhere, `noAdaPool`.
11. **Races:** the page's look and a build at once read the holder once. Two looks at once with the data layer up read no Koios, once hardening b is in.
12. **O5:** a return's token goes through its v2 pool with no 5 ₳ pool, the ADA back with the return; and the swap the approval approved goes through it too.
13. **O6:** the aside, `noneYet` with only retired pools listed, `noneMatch` with a query.

### The e2e

Yes, one. The bug was found by the e2e, and every moved test now opens the page's look first.

- Mainnet, with Koios-only on: `fivePool(context, koios, { network: "mainnet" })`. Mainnet's head start holds no v2 pool.
- No `lookedForFive`.
- A site session's Bring it back names the 5 ₳ pool: with ≥30 strangers it mixes; with `fivePool`'s 20 it gives the floor's reason, which already proves the pool was found.
- The worker's Koios calls show one holder `credential_utxos` and one `tx_info` at the build.

Keep `lookedForFive` where a test is about the page. The preprod tests move to the bundled pool (D6).

---

## O1 · CONFIRMED · medium · new

**Claim.** On preprod, and on mainnet with Koios-only on or the data layer down, a pool launched after the head start is found only by Lovejoin's page's look (or a pool's start).

**Holds:** traced in §2, and tested in all four modes (E1), on mainnet proper too (E8).

**Reachable:**
- **At `a6c94743`, on preprod:** every device that never opened the page, since preprod's head start had no v2 pool. The prep on the release branch bundles `47bece42`, so preprod's release build no longer needs the look (E9).
- **On mainnet, for a pool launched after the release's head start** (the owner may launch it after the release):
  - every return made by a Koios-only user;
  - anyone's while the private part is marked down, unless the list answered within 5 minutes;
  - until that user opens Lovejoin's page.
- With the data layer up, the ask's refresh finds it (E1).

**Why medium.** It's met in normal use: Koios-only is a Settings switch, and its users chose it for privacy. Those returns come back unmixed, tied to the session, under the critical "Lovejoin has no pool of 5 ₳ boxes to take it yet", which is false while the pool exists. The review shows that before Send, and a swap's approval says the same at Review, so nothing breaks silently; that keeps it below high.

**Fix.** The lead's direction is right and minimal (§3 step 1, E2 and E3). With it go:
- the look counted from the attempt, its failure swallowed, a trap handed on;
- `priced` and `collateralWanted` asking (steps 2 and 3);
- hardening a and b;
- the privacy policy's dated words;
- §5's per-mode tests and the mainnet e2e.

## O4 · CONFIRMED · low · new

**Claim.** `sess.skip.warn.noAdaPool` is saved with a session, and later reads false in `lovejoin.warn.skippedIts`.

**Holds.** `npx vitest run tests/words-scratch-saved.test.ts --maxWorkers=2 --silent=false`: 2 passed.
- The session's page, after the pool is pushed and `adaPool("preprod", true)` gives it, still says: "Lovejoin was left out of its return: Lovejoin has no pool of 5 ₳ boxes to take it yet. So it comes back directly, tied to the session on chain."
- es says "aún no tiene", ja "まだ…ありません".
- I read the scratch's setup: a real backBuild and backSubmit, then `sessions.list`.
- It's saved at `sessions.ts:4839` and `:4957`, and shown at `SiteSessions.tsx:452`, `Swaps.tsx:2519` and `:2582`.

**Reachable.** On mainnet, every return made before the 5 ₳ pool's launch keeps the reason on its session's page afterwards. That's the common path if the launch comes after the release.

The present tense is also false in O1's own state: a pool on chain the wallet hasn't found. With O1's look, that shrinks to the residual windows: `SETTLE_MS` + `REFRESH_MS`, a failed look, a data layer before 44a.

**Why low.** It was true when said, in the house's precedent (1.5.0's L9, `collateralComing`). Its false-now case is O1's, and is counted there.

**Fix.** A wallet-side past clause, as §3 step 5. Beware the two swap frames that open with `{{why}}`, the literal pin at `lovejoin-1-5-0.test.ts:420`, the negation lists, and the blind es/ja back-translation, since it's critical.

## O5 · CONFIRMED · low · new

**Claim.** With no 5 ₳ pool shown, `chain()` throws before `acrossOf`, so a token with a usable v2 pool comes back directly too.

**Holds.** `npx vitest run tests/o-design-token.test.ts --maxWorkers=2 --silent=false` (cross's test): 2 passed. With the ADA pool, LJTEST makes 2 boxes in its pool; without it, `skipped` is `noAdaPool` and nothing goes.

**Broader than the row says** (`npx vitest run tests/o-design-planner-noada.test.ts -t "o-design" --maxWorkers=2 --silent=false`: 2 passed):
- A swap reviewed into MIN, with only a v2 MIN pool shown, funds **9,800,000** for MIN's box. Its approval shows MIN's way: 1 box, 4 mixes. `skipped: noAdaPool` speaks of the ADA alone.
- Its return then brings MIN back directly, saving `noAdaPool`.
- So the approval's word on the token breaks. No money is lost: the funded ADA comes back.
- `minPool` is a launch through the wallet's own launch, so a v2 pool.

**Reachable.** Only where a v2 token pool is shown and no v2 5 ₳ pool is. That's mainnet before the owner's launch, if anyone starts a v2 pool of a listed token first. Not preprod, once `47bece42` is bundled.

**Why low.** By kind, a broken approval promise is high. But the state is an edge one, and the owner means the 5 ₳ pool to come first.

**Fix.** The lead's direction (§3 step 4), prototyped:
- **E10:** WebAssembly builds a chain across pools with no ADA leg: LJTEST makes 2 boxes, and MIN's return makes `parts [{pool: bbc4e4b6…, boxes 1}]` in 3 transactions;
- both pins fail, as they should;
- `npx vitest run tests/lovejoin-planner.test.ts tests/lovejoin-retired.test.ts tests/collateral-reserve-review-fixes.test.ts tests/lovejoin-1-5-0.test.ts tests/chain-reservations.test.ts --maxWorkers=2`: **5 files, 143 passed**;
- `tsc`: clean under `src/`.

The switch already says `onTokens` where only token pools take boxes (`LovejoinReturn.tsx:381`). It's the owner's "when it exists it uses it".

## O6 · CONFIRMED · nit · new

**Claim.** The aside shows "in 5 ₳ boxes" only when no 5 ₳ pool is known, and `noneYet` isn't shown when every listed pool is retired.

**Holds.** `npx vitest run tests/o-design-hub.test.ts --maxWorkers=2 --silent=false` (screens' test; its hub copy checked by `diff`): 3 failed, 1 passed at `a6c94743`:
- "V2 5 ADA POOL ONLY: Lovejoin A mixer for ADA and tokens …";
- "ONLY RETIRED LISTED: … Your boxes in it come back by themselves. Start a pool …", with no "No pool to mix in yet.";
- with no v2 pool: "A mixer for ADA, in 5 ₳ boxes" above "No pool to mix in yet.";
- the fourth failure, a stale query, is S1's.

**Reachable.**
- The aside: every user once the v2 5 ₳ pool is found.
- The retired-only list: only while the retired pools' run is still bringing the wallet's boxes back after the first unlock. Then they leave, and `noneYet` shows.

**Fix.** §3 step 7, prototyped in the hub copy: the aside and the retired-only cases pass. It uses existing keys and adds no translation round. Keep `tokenPools` for the cost note.

## Where O2's and O3's fixes meet mine

- **O2.**
  - Its fix 1 (`priced` asks) is step 2. It must land with O1's look, or E5's contradiction reaches the Koios paths.
  - Its fix 2 (`collateralWanted`'s reason) needs the ask first (step 3, E6), as o2-trace says.
  - o2-trace's claim 5, Koios-only, is O1's, and step 1 covers it.
- **O3.**
  - The funding review's mark is `priced`'s `skipped`, read at Review through step 2's ask, which step 1 makes look.
  - The card reads quietly, or through `rooms` (a refresh, no look).
  - The look should never be tied to a site's connect.

## Covered

- Every path in §1, read at `a6c94743`.
- Discovery's wiring (`sw.ts`, `serviceDeps`, `privateIndexClient`, `refresh`, `look`, `scan`, `holder`).
- The page's look.
- The start's look.
- O1 in four modes and on mainnet proper.
- The draft:
  - the requests, the throttle and a failed look;
  - `SETTLE_MS`, the floor and an empty pool;
  - the races;
  - the collateral pick, the swap's review and the no-collateral return;
  - 384 tests in 12 nearby files, on both builds, and `tsc`.
- O4's mechanism, frames and pins.
- O5 with the swap, and its prototype.
- O6 and its prototype.
- The release branch's head start (E9: the main tree's `lovejoin-pools.json` copied into the sandbox, then put back).

## Not checked

- **Playwright.** It's the tests-e2e lane. The e2e above is a recommendation, not run.
- **O2's and O3's full fixes:** their verifiers'.
- **Hardening a and b:** not prototyped. Only the race was shown (E4).
- **O4's es/ja wording:** it needs a blind back-translator.
- **The data layer** listing v2 pools (cargo), and live runs.
- **The full unit suite:** I ran targeted files alone, with two workers.
