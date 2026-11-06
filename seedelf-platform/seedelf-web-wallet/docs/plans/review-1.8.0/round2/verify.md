# 1.8.0's release review, round two: the traces

*One skeptic for each low (or group), each told to refute where it could (workflow `wf_fb0a2335-da7`). Written by the lead from their structured outputs. Nits weren't traced, as the house's rule has it; each nit fixed is pinned by its fixer's test.*

| Finding | Verdict |
|---|---|
| r2-critic#1 | PARTLY |
| r2-worker#1 | CONFIRMED |
| r2-critic#0 | PARTLY |
| r2-critic#2 | PARTLY |
| r2-critic#3 | CONFIRMED |
| r2-worker#0 | PARTLY |
| r2-tests#0 | CONFIRMED |
| r2-tests#1 | CONFIRMED |
| r2-screens#0 | CONFIRMED |
| r2-tests#2 | PARTLY |
| r2-tests#3 | PARTLY |

## r2-critic#1: PARTLY

**Reach:** The code behaviour is real and reachable as claimed. It holds only on Koios paths and only once the v2 5 ₳ pool is kept. Koios paths are: every preprod device (always Koios, and 1.8.0's head start keeps 47bece42, so on preprod it always holds); mainnet with Settings' Koios only on; mainnet while the data layer is down. On mainnet the 5 ₳ pool is kept once the owner's pool is found (or a later head start bundles it).

It also needs a v2 pool of a listed token launched after the device's last holder look. None exists on either network today. The bundled head start's only token pools are preprod's two MIN pools on 8131b1d (retired), and mainnet has none. backlog.md:70 in the drafts says the same for preprod.

The scenario's LJTEST is not on preprod's token list (src/tokens/list.json has tUSDM and MIN), so a real LJTEST pool would never be shown on any device. The scratch test models a listed token through discovery's `listed`. The same mechanism holds for a v2 MIN or tUSDM pool, so the scenario as written is unreachable but the claim isn't.

Who meets it:
- a by-hand return of a session that isn't an approved swap (a site's session, a restored session, Bring everything back) holding a box's worth of that token;
- a swap's Review buying that token;
- in both cases only before anything has looked since the launch: Lovejoin's page as it opens, or Start a pool's build, or Settings' Bring every box back with no pool named (only REFRESH_MS after the last look).

For a swap only the Review counts. A self-running swap's return (and Stop) never takes a token into a pool its Review didn't name (wayOf), so 'a swap's tokens go into one only if the page has looked since that pool's launch' should read 'before its Review'.

Mainnet with the data layer up (the default) never meets it. How often: until the user opens Lovejoin's page once after the launch. Effect: the token comes back directly with the return. Nothing is lost, and no screen says it goes in: tokenPool returns undefined, so no way, box or reason is shown, and acrossOf adds no token way.

**Trace:** At 4b4628e9:
1. sw.ts:237 makes one PoolDiscovery per worker life. sw.ts:247-248 wire serviceDeps(discovery) and lookForPools: discovery.look.
2. lovejoin-pools.ts:624-645 serviceDeps: `pools` = refresh (the data layer's list) then the pools handed over; `known` = handed, no request; `lookSoon`.
3. refreshNow (lovejoin-pools.ts:455-500) has no index on preprod, Koios-only or the data layer down (private-index.ts:362-371), so it returns with nothing kept.
4. Koios's holder is read only in scan (:533-541). scan is reached from look (:406-411: the page's open via handlers.ts:530-531 → lovejoin.ts:3217-3222; Start a pool's build at lovejoin-launch.ts:244) and from lookSoon (:423-430). lookSoon is called only by adaPool's ask, after both `kept` and `listed` are empty (lovejoin.ts:4164-4172), and by bringAllBack with no pool named (lovejoin.ts:6873).
5. adaPool (lovejoin.ts:4166-4167) returns `kept` at once. adaPoolOf (:676-677) takes any v2 5 ₳ ADA pool, under its floor or not. Preprod's bundled head start holds 47bece42 (v2, 5 ₳), so on preprod no ask ever looks.
6. A return: buildBack's collateral pick (sessions.ts:4527-4535) → collateralPool (lovejoin.ts:4276-4278): adaPool is kept, then split (:7202-7209) does a loud readSet whose refresh finds nothing. Then chain() (:3583) gets the kept pool from adaPool. acrossOf (:3824) reads quietly and lacks the new pool, so :3848 `if (!byToken.size) return undefined`. The 5 ₳ pool's chain is built alone (:3678), and the token comes back with the return.
7. A swap's Review: outBuild (sessions.ts:1883) → lovejoinCost → priced (:1784-1785): adaPool is kept, then room → rooms (lovejoin.ts:3374-3386) → splitAll (:7224-7226), loud, refresh finds nothing. Then tokenPool (sessions.ts:1689) calls poolsOf(network, unit, false), which is a loud readSet (lovejoin.ts:3091-3095) whose refresh finds nothing. No candidates, so it returns undefined. The quote as the user types (:1589) is quiet.
8. A swap that runs itself: act (sessions.ts:3645) → bringBack (:4286-4289) → buildBack → wayOf (:6334-6347). An approval with no token way has no `returns`, so acrossOf never runs. One with ways has `only: true`, so any token it didn't name gets null (comes back directly).

(1) Old behaviour. At 6b70c1f8 (1.7.2) and at 1beba3fb, token pools behave the same:
- the holder is read only by the page's look (handlers.ts:531 → lovejoin.ts:3101-3104 at 6b70c1f8, :3164-3167 at 1beba3fb) and by Start a pool's build (lovejoin-launch.ts:243 / :244);
- there is no lookSoon;
- acrossOf reads quietly (6b70c1f8 lovejoin.ts:3646; 1beba3fb :3724);
- the Review calls poolsOf(network, unit, !pool) (6b70c1f8 sessions.ts:1674; 1beba3fb :1675), which refreshes only the list;
- 1beba3fb's adaPool (lovejoin.ts:4057-4060) asks the list only.
lovejoin-pools.ts's diff from the base to the merge adds only lookSoon, its `scanned` throttle, answeredWithin and the shared refresh. The bundled list and head start are byte-identical at the two commits. So it's old (o-design's risk 9, since 1.6.0), and the merge narrowed it: while no 5 ₳ pool is kept, O1's look finds token pools too, and Settings' press now looks.

(2) Mainnet with the data layer up. The token pool is found by the first loud readSet (serviceDeps.pools → refresh → `lovejoin/pools`) made REFRESH_MS or more after the list was last asked in this worker's life (lovejoin-pools.ts:461-466, kept in memory), once the data layer lists it.
- Before a return's acrossOf, only two reads refresh: the collateral pick's split (sessions.ts:4527-4535 → lovejoin.ts:4278 → :7209), and tailChain's (sessions.ts:4543 → lovejoin.ts:4355) for a resumed chain. The pick runs only when the account holds a 5 ₳ UTxO that fits, the return goes through Lovejoin, Settings' collateral switch is on (the default), the session isn't a Bootstrap or seed, and the kept pool takes new boxes.
- chain()'s own first read asks nobody. With no pick, the first loud read is chain()'s 5 ₳ split (:3678), which comes after acrossOf. That return brings the token back directly, and the next return takes it in.
- Before a swap's Review's token pick, both priced's room (sessions.ts:1785, unless rooms were read within POOL_ROOM_MS) and tokenPool's poolsOf (:1689) are loud, so the first Review REFRESH_MS after the last list ask finds it.
- Background loud reads also refresh it: status, withdrawDueNow's `ours` at an unlock with something open in Lovejoin, tailReserve, lovejoinRoomNow, Bring one back.
- The request is `lovejoin/pools`, already named in the committed policy, privacy-policy.md:46 at 4b4628e9: 'on mainnet it asks ours for its list of pools … as it reads the pools, and again only after five minutes while the browser keeps the wallet running'. privacy.md:200 names it too. No holder read is made on that path. It needs a data layer that carries #363.

**Evidence:** - Copied the reviewer's test as /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-screens/seedelf-platform/seedelf-web-wallet/extension/tests/trace-c1-token-found-later.test.ts. `npx vitest run tests/trace-c1-token-found-later.test.ts --maxWorkers=2 --silent=false`: 1 passed, with the same log: holderAtBuild 0; before ways null with 2 boxes in 0eedc4eb…; after ways [{pool c5852bb7…, boxes 2}].
- Mine: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-screens/seedelf-platform/seedelf-web-wallet/extension/tests/trace-c1-when-found.test.ts. Same command: 9 passed. Logs:
  - mainnet, data layer up, 5 ₳ pool kept, token pool listed later: dataUp {reviewEarly [], listEarly 1, typed [], listAfterAsk 1, listAfterPick 2, quietAfter [c5852bb7…], holder 0}. A Review within REFRESH_MS of the last ask doesn't find it; quiet reads and the kept pool's ask make no request; the return's collateral pick asks the list and the quiet read after it has the pool. dataUpReview {review [c5852bb7…], list 2, holder 0}.
  - Modelled, a site session's return on the data layer's path, using preprod's fixtures with a data layer origin given to preprod (the code is network-agnostic but for `index`): switch on {ways [2], tail 0eedc4eb…, list 2, holder 0}; switch off {first [], firstPool 0eedc4eb…, listAfterFirst 2, second [2]}.
  - Mainnet Koios only, 5 ₳ pool kept: koiosOnly {review [], afterAsks 1, afterPressEarly 1, foundByPressEarly [], afterPage 2, foundByPage [c5852bb7…], list 0}. Settings' press REFRESH_MS on: {holder 2, found, bringing {at, back 0}}.
  - With no 5 ₳ pool kept: noFive {holder 1, found [c5852bb7…]}. O1's look finds a later token pool too.
  - pin (preprod, page-kept 5 ₳ pool, clock moved REFRESH_MS+1 on): {atBuild 0, ways [], pool 0eedc4eb…, review [], after 0}.
  - wayOf: an approval with no token way gives {width 3}, so no returns; one with tokens gives returns.only true.
- git show at 6b70c1f8 and 1beba3fb, and git grep of look/scan/lookSoon callers at all three commits: as in the trace.
- Bundled data, read from the files: tokens/list.json has preprod 2 (tUSDM, MIN) and mainnet 32. lovejoin-pools.json has preprod 5 pools (MIN 100000000 and 500000000 a box, both 8131b1d; 18c4df77 5 ₳ and aab7c72d 7 ₳ on 8131b1d; 47bece42 v2 5 ₳) and mainnet 1 (dc6abe3b, 5 ₳ on 8131b1d). No v2 token pool is bundled anywhere. LJTEST is not on preprod's list. git diff 1beba3fb 4b4628e9 shows neither file changed.
- The merged worktree's docs: grep plus git diff 4b4628e9 to tell drafts from committed text. No sources were mutated (the sandbox is read-only on sources).

**The fix:** The lead's call (keep O1 to the 5 ₳ pool for 1.8.0, correct the docs, leave widening to the owner) is right on the facts:
- the behaviour is old and unchanged at 1beba3fb and 1.7.2 (the merge narrows it);
- nothing is lost, and no screen promises otherwise;
- the default path finds the pool with a request the policy already names;
- no v2 token pool exists on either network yet;
- widening adds Koios holder reads at the user's action on Koios paths, and needs a policy entry.
R2BRIEF's and FINDINGS' restatement ('A pool launched later … is found and used on both networks without Lovejoin's page') is broader than the code. Ask the owner whether 'or really any pool' meant token pools.

(4) Docs in the merged worktree. All are drafts unless marked committed.

False for a token pool on Koios paths:
- docs/development.md:331: 'It's a head start, never a gate: a pool launched after it is found live, without Lovejoin's page.' On preprod this is false for every pool a return or a swap could use: a later v2 5 ₳ pool is a copy of 47bece42, and a token pool is found only by the page, a pool's start or Settings' press. Its next clause ('wherever a return, a review or a funding asks for the 5 ₳ pool while the wallet keeps none') never happens on preprod with this head start, and the sentence leaves out Settings' press and a pool's start. The committed :330 ('a pool launched after it is found live.', from 030fdcf0 in 1.6.0) is true, since the page's look is live. So the finding's 'both are false' overstates.
- docs/architecture.md:740: 'So a pool launched after a device's head start is found and used without the page, on both networks.' It sits in *The 5 ₳ pool* bullet: true of that pool, false read of any. Say 'a 5 ₳ pool'.
- docs/archive/plans/chunk-44-lovejoin-v2.md:67: 'The release review made the wallet work with no pool and use one once it exists, on both networks, without the page.' Say 'the 5 ₳ pool'.
- Code comments with the same overreach: lovejoin-pools.ts:417-418 and lovejoin.ts:4159-4160.

Already accurate:
- README.md:59 (5 ₳ only);
- architecture.md:733 ('or an ask finds no 5 ₳ pool');
- architecture.md:747 (worth a clause that an ask looks only while no 5 ₳ pool is kept);
- privacy.md:198, :202 ('while no v2 pool of 5 ₳ boxes is kept') and :233;
- privacy-policy.md:46 and :93 (both scoped to the 5 ₳ pool);
- flows.md:470 (the ADA's 5 ₳ pool), :490, :529 and :530;
- the archive's :75;
- backlog.md:70.

Add a backlog line: on Koios paths a v2 token pool launched after the 5 ₳ pool is kept is found by the page's look, a pool's start or Settings' press, never at a Review or a return; the owner's call. Keep a pin test.

A flaw in the reviewer's test: it keeps the 5 ₳ pool by a page look at the same clock instant, so lookSoon's throttle alone yields holderAtBuild 0. It can't kill a mutant that drops adaPool's `kept ||` short-circuit. My pin moves the clock REFRESH_MS+1 on first, and would kill it (reasoned from the code, not mutated).

(3) If the owner widens. lookSoon refreshes first (lovejoin-pools.ts:424) and stops where the data layer answered (:426), so it adds holder reads on Koios paths only.

When a widened look would read the holder:
- (a) a swap's Review buying a listed token (sessions.ts:1689 when `pool`) and its rebuilds (:1919, Change, the switch); never the quote as typed (:1589);
- (b) a by-hand return of a session that isn't an approved swap, holding such a token: a session's Bring back, Bring everything back (one look per press, throttled), a site's or a restored session;
- never Stop or a self-running swap's return: wayOf fixes their tokens, so a look there is wasted.

How often and what it asks:
- At most one holder look per network per REFRESH_MS within one worker's life, shared with the page, a pool's start, Settings' press and O1. One under way is joined. Each worker Chrome restarts begins unthrottled (r2-critic#2).
- A look is 1 credential_utxos at the holder (from the last look's height less 20 blocks). tx_info is added only for a new candidate that passes the offline checks, and account_update_history only for a launch that didn't register L.
- Discovery's token list has 2 tokens on preprod and 32 on mainnet, and none has a usable pool kept. So on mainnet with Koios only, nearly every token swap's Review would look until a v2 pool of its token is found.

The safe shape:
- key it on a token of discovery's list with no kept v2 pool that isn't a copy, ignoring floor, room and stuck (a look can't fix those, and under the mainnet floor of 30 it would look at every Review);
- never drop adaPool's `kept`, which would look at every return, Review and funding;
- in acrossOf, look only where `returns.only` is false, and before byToken;
- hand a trap on (unlessTrap), and let a failed look find none.

Risks:
- requests, as above;
- the request names nothing, but its timing now depends on whether the user's token has a pool on this device; the 6 November policy entry must name it;
- 34e's review 9 (a return that pays for no box asks nothing) would no longer hold for such returns;
- money: nothing new.

Mutants the tests must kill:
- no look at Review (with the 5 ₳ pool kept and a later token pool at the holder, the Review must offer its boxes);
- a look as typed;
- a look when a v2 pool of the token is kept;
- a look for an unlisted token;
- a look in an approved swap's return or Stop;
- the throttle dropped (two Reviews 60 s apart must read once);
- a holder read with the data layer answering.

An alternative, one holder look per unlock on Koios paths, finds every later pool without tying reads to a swap, but costs a read for users who never use Lovejoin.

*Notes (r2-critic#1):* Side facts for the lead:
(a) With 1.8.0's head start, O1's look at an ask never runs on preprod: 47bece42 is always kept, and adaPoolOf takes it whatever its floor. Preprod's live run can't exercise that look at a return. On preprod the holder is read only as the page opens, at a pool's start, and at Settings' Bring every box back (throttled).
(b) Settings' Bring every box back is no way to find a pool. Within REFRESH_MS of the last look it reads nothing. Pressed later it finds the pool, but it also asks every box back.
(c) Because the reviewer's test keeps the 5 ₳ pool by a page look at the same instant, lookSoon's throttle masks the `kept` short-circuit. Use a clock REFRESH_MS on for any permanent pin.
Scratch tests (sources untouched):
- /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-screens/seedelf-platform/seedelf-web-wallet/extension/tests/trace-c1-token-found-later.test.ts (the reviewer's, copied)
- /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-screens/seedelf-platform/seedelf-web-wallet/extension/tests/trace-c1-when-found.test.ts (mine, 9 cases)
Old versions read with git show are saved under /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/trace-c1-<commit>-*.ts.
Not done: no mutation runs (read-only sources), no widening prototype, no network, no full mainnet return (the return on the data layer's path is modelled on preprod's fixtures with a data layer origin).

## r2-worker#1: CONFIRMED

**Reach:** Settings' defaults (Lovejoin returns on, the collateral switch on), wherever v2's 5 ₳ pool is kept or found and takes new boxes.

- **Preprod:** today, because its head start bundles the pool.
- **Mainnet:** only from the pool's launch on. The merged head start has no v2 5 ₳ pool. Until one is launched and found, collateralPool and lovejoinRoomNow both stop at adaPool, so 0 listings, as at base.

**Site funding review (siteOutBuild):**
- Collateral switch on: 2 listings, base 1.
- Collateral switch off: 1, base 0.
- A second review within POOL_ROOM_MS: 1 (split's), as at base.
- With no pool kept, the review's own ask finds it: 2 listings plus one look (holder credential_utxos 1, tx_info 1; on mainnet with the data layer up, lovejoin/pools 1).

**Swap's Review (outBuild):**
- Pool kept: 2 listings, as at base and 1.7.2. The claim is right there.
- No pool kept: 2. This part is new in 1.8.0, from O2's ask in priced. At base priced's adaPool didn't ask and there was no look, so it made 0 listings on preprod and Koios-only, and 1 on mainnet when the data layer's list had the pool.

**One listing, by mode:**
- Preprod, and mainnet Koios-only: one Koios credential_utxos POST naming every pool's mix_box (at most 75 per request, paged at 1000 rows).
- Mainnet, data layer down: the same. In the worker, DataLayerKoios may send it to the data layer's public part while that part is up.
- Mainnet, data layer up: poolNow (lovejoin/pool + lovejoin/since/…) plus tokensNow (lovejoin/tokens + lovejoin/tokens/since/…) = 4 GETs. So it's 8 against 4 on the data layer's budget, not Koios's. A shown pool tokensNow doesn't cover adds a Koios credential_utxos to each listing.

**Same class, not claimed:**
- The tile's Mix review and Mix again: 2 listings since 1.7.2 (fits' or againBoxes' split plus tailReserve's).
- A return's build: 2 with the collateral on, 1 off (collateralPool's pick plus chain()'s own read). Build time.

**Not affected:** privacy (the same request for everyone, every pool listed both times) and money.

**Trace:** Line numbers at 4b4628e9.

**Funding review**
1. sessions.ts:1988 siteOutBuild. 1992 reads epoch_params once. 1996 calls tailReserve(network, through, {params, direct:true}).
2. sessions.ts:4798 tailReserve passes its gate (through, available, collateralIntoPool, which defaults on), then 4807 calls lovejoin.collateralPool(network, read, undefined, true).
3. lovejoin.ts:4274 collateralPool calls adaPool(network, true) (4164: the quiet readSet's kept pool, else readSet, then lookSoon), then usableNow (WebAssembly, cached per epoch), then 4278 split(network, undefined, undefined, pool).
4. lovejoin.ts:7202 split:
   - readSet (deps.pools → discovery.refresh, throttled REFRESH_MS, so the list isn't asked again).
   - listing(set) at 3137 → poolRows at 3154: on preprod or Koios-only, 3197 credentialUtxos(every mixBox); on mainnet with the data layer up, 3166 poolNow and 3177 tokensNow.
   - reservedSet with except undefined (7212).
   - split never writes roomsRead (2766, written only at 3380).
   - 4279–4284: floor, TAIL_DRAWS → {pool, rows, free}.
5. sessions.ts:1999 lovejoinRoomNow (2046): adaPool(ask), now kept; usable, cached; 2052 room → lovejoin.ts:3364 → rooms() at 3374. roomsRead is empty or stale, so splitAll at 7224 → listing(set): the same request as step 4. Then 3380 roomsRead is set.
6. Base 1beba3fb (read with git show): siteOutBuild had tailReserve alone, so 1 listing with the collateral on and 0 off. It read epoch_params twice (tailReserve, then buildFunding's readContract); merged reads it once.
   - So the connector report's 'fewer requests' holds for epoch_params only.
   - Total requests, collateral on: preprod 3 → 3; mainnet with the data layer up 6 → 9.
   - Collateral off: 1 → 2.

**Swap's Review**
- outBuild at 1868 → 1883 lovejoinCost → priced: 1784 adaPool(network, pool), 1785 room → rooms() → splitAll listing.
- tokenPool's rooms at 1691 is kept by then.
- 1887 tailReserve → collateralPool → split: a second listing.
- At base 1759 priced called adaPool(network) with no ask. In 1.7.2 it called room(network) for the classic pool, beside the same split.

**The checks asked**
- **free vs left:** split and splitAll both call reservedSet(session, network, {except: undefined}) with avoid empty, and run the same WebAssembly otherBoxes over the same unspent rows. So rooms()'s free equals collateralPool's left, and others match, at one moment.
- **rows:** used only at build time: buildBack at 4534, then the ChainCall and the direct request. tailReserve reads only .pool.id and .free (4813–4817).
- **rooms() on failure:** the bare catch at 3382 returns undefined and leaves roomsRead alone. collateralPoolTakes (4295) then finds no read within POOL_ROOM_MS and says maybe (or no, by usables or the crowd count). That is today's tell result.
- **Traps:** the bare catch also swallows traps.
  - Inside withKeys a trap already becomes WalletLocked, and broken() locks the wallet (wallet.ts:577–599).
  - Outside withKeys it doesn't: poolRows' keysOf → cip30Address (6093) on the data layer's token rows (3182), and readSet's first verifiedPool.
  - Today only collateralPool(tell) hands such a trap on, to tailReserve's isTrap rethrow.

**Evidence:** **The reviewer's tests**
`npx vitest run tests/r2-worker-flows.test.ts -t "flow 1b|F-double|flow 2a" --maxWorkers=2 --silent=false`: FLOW1B collateral on, reads 2; off, reads 1. FLOW2A reads 2. 4 passed.

Their setup is reachable: the pool is kept by the page's look, or by the head start on preprod. But their device() leaves `index` out of LovejoinService's deps, so their mainnet 'data layer up' pool reads went to Koios.

**My scratch test** (sw.ts wiring, the index in the Lovejoin service's deps):
/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-worker/seedelf-platform/seedelf-web-wallet/extension/tests/trace-r2-worker1-listings.test.ts

- **TRACE-FUND**, pool kept, first review then again at once:
  - Preprod, mainnet Koios-only, mainnet data layer down: on, koios 2 then 1; off, 1 then 0.
  - Data layer up, covered: on, pool/since/tokens/tokensSince 2 each, then 1 each; off, 1 each.
  - Not covered: the same, plus koios 2/1.
  - epoch_params 1 per review.
- **TRACE-SWAP**, every mode: 2 listings (data layer up: 2 of each route).
- **TRACE-FUND-FOUND**, no pool kept: 2 listings, holder 2 (one look); data layer up: list 1 and 2 of each route.
- **TRACE-MIX:** 2. **TRACE-TOPUP:** 1. **TRACE-BACK:** on 2, off 1.
- **TRACE-FREE**, n = 0, 1, 2, 3, 6, 32: collateralPool.free equals room.free; below 2 free, collateralPool is null.
- **TRACE-STALE:** kept room free 6. Another chain reserves 3, and fresh collateralPool says 3. The kept read still says 6 until POOL_ROOM_MS, then 3.
- **TRACE-FAIL:** listing at 500 → rooms undefined, collateralPool(tell) throws KoiosError, collateralPoolTakes says maybe.
- **TRACE-TRAP**, lovejoinOwned trapping: rooms undefined, wallet locked.
- **TRACE-TRAP-OUT**, cip30Address trapping on mainnet with the data layer up: rooms swallows it and the wallet stays unlocked. Collateral on: siteOutBuild throws RuntimeError. Off: built on.

**Modelled fix**, patched on the instances; no source changed:
- TRACE-FIX: every site funding (on and off) and every swap's Review lists once, every mode.
- TRACE-FIX-TELL: with the listing failing, now and fixed both give no reserve and collateralMix ifLeft.
- TRACE-FIX-TRAP: if rooms() hands traps on, both switches reject. If it swallows them, both are built on.
- TRACE-FIX-P1: draws kept fresh → ifLeft. Draws moved onto rooms() → 'mixed'.
- TRACE-FIX-FOUND: a missing pool read afresh → reserve 2800000, as today. A missing pool taken as failed → none.

**Lane suites under the model** (patch: …/extension/tests/trace-r2-worker1-fix-patch.ts; wrappers: …/extension/tests/trace-r2-worker1-fixed-{run-traps-review-fixes,collateral-reserve-review-fixes,connector-lovejoin-review-fixes,lovejoin-share-review-fixes,lovejoin-found-later}.test.ts):
- 125 of 126 pass. The one failure is run-traps 'hands a trap in a funding's look for the 5 ₳ pool on…', which spies on collateralPool.
- With TRACE_R2W1_ALL=1 (draws moved too), only the fx-may mix test fails, and only because it spies on collateralPool. P1's own tests pass, so they don't pin the staleness.

**Base and 1.7.2:** read with `git show <rev>:… | grep`, not run.

**The fix:** **Verdict:** right in direction. Modelled, it cuts each funding, top-up and swap review to one listing in every mode, keeps tell, and puts a swap's box count and its collateral's reserve on one read. It needs three things.

**1. rooms() must hand a trap on.**
```ts
} catch (e) { if (isTrap(e)) throw e; return undefined; }
```
Without this, a trap outside withKeys that today's collateral-on funding hands on (through collateralPool(tell)) is swallowed and the funding is built on. That's an L3 regression, shown by the model. With it, lovejoinRoomNow (collateral off), priced and tokenPool hand traps on too, which closes an existing gap. Every caller of rooms()/room() already hands traps on.

**2. Leave tailReserve's `draws` callers (mixOutBuild, againBuild) on collateralPool's fresh split.** P1's `short` compares the mix's own draws, sized on fits' or againBoxes' fresh read, with `free`. A kept read can't see a reservation the wallet made since (sendChain's start). Modelled, it says 'mixed' where P1 says ifLeft. Those reviews keep their two listings (since 1.7.2, not claimed). If they're to be cut, have fits or againBoxes hand their own free to tailReserve.

**3. A kept map that lacks the 5 ₳ pool must read afresh, not count as failed.** The map was read before the pool was found (a token's rooms() at a swap's Review, then the page's look or a launch). Modelled, treating it as failed drops a reserve today's code pays. Either fall back to collateralPool's split, or have rooms() read again when its map lacks a pool the quiet readSet has. The second also fixes priced's `fits = Infinity` there.

**The other checks:**
- A read up to POOL_ROOM_MS old is fine for the no-draws reviews. It only decides whether 1.5 ₳ or 2.8 ₳ of the user's own ADA is set aside, which comes back with the change if unused. Site and top-up words are always ifLeft, and priced already uses that read. No fee changes.
- Rows aren't needed at review.
- free equals left at one moment.
- rooms() now does ownership for every pool where split did one; that costs milliseconds.
- Privacy is unchanged, and fewer requests are made.

**Smallest change:**
```ts
// lovejoin.ts, beside collateralPool
async collateralRoom(network: NetworkName, params: unknown): Promise<{ pool: LovejoinPool; free: number } | "failed" | undefined> {
  if (!this.available(network)) return undefined;
  const pool = await this.adaPool(network, true);
  if (!pool || this.usableNow(network, pool, params)) return undefined;
  const rooms = await this.rooms(network);
  if (!rooms) return "failed";
  const room = rooms.get(pool.id);
  if (!room) return this.collateralPool(network, params, undefined, true);
  if (this.floorShort(network, room.others) || room.free < TAIL_DRAWS) return undefined;
  return { pool, free: room.free };
}
// sessions.ts:4807
const look = draws ? lovejoin.collateralPool(network, read, undefined, true) : lovejoin.collateralRoom(network, read);
```
Keep the existing `.catch` and the 'failed' branch. Add the rooms() catch from point 1.

**Safer, if only 1.8.0's new regression is to be fixed:** the finding's own fix. Answer `lovejoinRoom` from tailReserve's fresh read (carry others and free; room = a pool && !poolShort), and call lovejoinRoomNow only where tailReserve read nothing. This is equivalent, since mixesPerBox(depth≥1, 3)·2 ≥ TAIL_DRAWS, with failed mapping to false. It adds no staleness and changes no trap path, but leaves the swap's older double.

**Not advised:** having split fill roomsRead. It would need splitAll's ownership read of every pool on every build-time split.

**Tests to pin, and the mutant each must kill:**
- **Count:** preprod, pool kept, collateral on. siteOutBuild and outBuild each list once (credential_utxos naming the 5 ₳ mix_box; on mainnet with the data layer up, lovejoin/tokens = 1). Kills tailReserve back on the split (2).
- **Trap:** mainnet, data layer up, cip30Address trapping. siteOutBuild rejects on both switches. Kills rooms()'s bare catch. This replaces run-traps' collateralPool spy.
- **P1:** 6 free, rooms() read, another chain reserves 3, then the tile's Mix of 1 box at depth 1 says ifLeft. Kills `draws` moved onto collateralRoom ('mixed').
- **Found later:** rooms() read with no pool, then lookForPools, then siteOutBuild reserves 2800000. Kills missing-as-failed.
- **Tell:** already pinned by collateral-reserve-review-fixes' fx-may tests, which pass under the model.

*Notes (r2-worker#1):* **Side findings and corrections**

1. **Existing L3 gap (nit, not claimed).** rooms()'s bare catch (lovejoin.ts:3382) swallows traps raised outside withKeys inside its listing: keysOf → cip30Address (6093) on the data layer's token rows (3182), and readSet's first verifiedPool. Shown on mainnet with the data layer up and the collateral switch off: siteOutBuild built on with the wallet unlocked, though lovejoinRoomNow's doc says 'a trap is handed on'. priced, tokenPool and Stop's dialog read through the same catch. The reviewer's Covered line ('withKeys locks, so nothing is built on') holds only for traps under withKeys. The one-line rooms() change above closes it.
2. **The reviewer's mainnet harness.** r2-worker-flows' device() doesn't give LovejoinService `index`, so its flow 1c sent the pool listings to Koios. Wired as sw.ts wires it, each listing is 4 data-layer GETs.
3. **Flow 2c's 'as at base' needs a correction.** With no pool kept, base made 0 listings at a swap's Review on preprod and Koios-only (priced didn't ask, and there was no look), and 1 on mainnet when the data layer's list had the pool. Read, not run.
4. **The connector report's 'fewer requests'** is about epoch_params only: 2 → 1. Pool listings go up.

**Caveat about the sandbox.** Its sessions.ts carries another tracer's uncommitted edit to priced and stopCost, gated on the TRACE_W0_FIX environment variable. It's inert without that variable, and my counts were the same before and after it appeared. I changed no source.

**Files**
I wrote only under …/r2/r2-worker/seedelf-platform/seedelf-web-wallet/extension/tests/:
- trace-r2-worker1-listings.test.ts
- trace-r2-worker1-fix-patch.ts
- trace-r2-worker1-fixed-*.test.ts (5 wrappers)

Briefly I also put four `git show` copies of base and 1.7.2 sources in scratchpad/r2/, outside the sandbox. I deleted them; nothing else of mine is left outside it.

**Not checked**
- A real Chrome run.
- DataLayerKoios's public-part routing on mainnet with the data layer down (my harness used plain Koios).
- Running against base sources (base was read only).
- againBuild's counts (read only: againBoxes' split plus tailReserve's).

## r2-critic#0: PARTLY

**Reach:** Two preconditions together, once per network per wallet (`retired` is set once), on preprod and mainnet alike, data layer or Koios.

(1) An update from 1.7 with something in a retired pool (the classic pool or an 8131b1d pool) that had no due time. The new part is 1.7's not-mixed boxes: a chain a lock or a closed browser cut, or a restored 1.7 wallet's boxes made by a deposit (heldBy17's shape). The part that predates the fix round, and which the finding doesn't name, is a 1.7 Bootstrap's held boxes, which retireOnce releases.

(2) The first unlock's retired run stops after sending at least one box and before taking the rest. Either Settings' Stop (or a retired pool page's) is pressed between two withdraws; the loop checks `bringing` before each box (:7103), so no giveme.my refusal is needed, the reviewer's 400 only makes the test deterministic. Or the run stops by itself after BRING_FAILED_RUNS (3) runs in a row send nothing after the first send: giveme.my 5xx, 429 or unreachable, or Koios failing, for about 3 minutes at the one-minute alarm.

What the user meets, for up to 2 h while unlocked (or until the next unlock after that, if locked):
- **A restored 1.7 wallet's state (no chain record):** Home shows no In Lovejoin section at all, not 'In Lovejoin · Your mixes' as the finding says. The reviewer's test renders InLovejoin without Home's inLovejoinShown gate (Home.tsx:988). The 10 ₳ is nowhere on Home.
- **Where 1.7 kept the cut chain's record:** Home shows 'In Lovejoin · Your mixes · A mix stopped partway: open Lovejoin to see what to do.' with no box and no ₳.
- **Settings** says only 'Stopped: 1 box sent back.' after a Stop, or 'Stopped: several tries in a row sent nothing. … Press Try again to bring back the rest.' after the run's own stop.
- **The box's own wait** is drawn at the 2 h read instead of a minute after the Stop, so it comes back about 2 h later.
- **Ending sooner:** opening Lovejoin's page ends it at once (status reads and schedules found boxes). Where a chain record keeps the network `open`, so does the next unlock.

No money at risk, and nothing stranded in the reviewer's case. Low, as rated. The not-mixed part is new (the base over-counted '2 not mixed yet' for the same 2 h).

The Bootstrap sibling hides identically after a Stop partway, at the base too (chunk 44). Worse, if the retired run stops by itself having sent nothing (back 0), its boxes get no read at all. The alarm stops (returning false), and an unlock reads nothing (`open` ignores entries). They come back only once Lovejoin's page opens or Try again is pressed. Settings asks for Try again, but by the letter of Medium this is 'a box that never comes back by itself', and it is the very state critic#3's fixer added `recheck` for, for the counts. The lead decides; I'd keep it Low given the narrow precondition and the stated way out.

**Trace:** Line numbers at 4b4628e9.

1. **First unlock:** runs.ts:95 calls withdrawDue(network, true), then withdrawDueNow (lovejoin.ts:6523), then retireOnce (:6527 → :4198).
   - It drops the retired pools' notMixed and unsure (:4236-4244) and sets `if (counted) s.recheck ??= now` (:4245).
   - It asks the retired run: `bringing = {at, back: 0, retired: true}` (:4248).
   - It releases a retired pool's Bootstraps (:4229) with no recheck.
2. :6530 returns into bringAllBackNow while the run goes. The scheduled path's recheck read (:6550, :6578) is never reached, so critic#3's 'at once' read stays pending through the whole run.
3. **The run:** bringAllBackNow sends each box back to back.
   - Each sent withdraw writes `counted[box]` (dropWithdrawing, :7485).
   - It marks the box spent in chrome.storage.session for SPENT_KEEP_MS = 2 h (spent.ts:33, :127). `ours` (:3246) then leaves it out of `owned` while it stays `listed`.
   - A Stop between boxes ends the loop at :7103.
4. **Stop:** stopBringingAllBack :6919, `if (s.bringing?.back) s.recheck = now + SPENT_KEEP_MS`, overwrites the earlier recheck. The run's own stop does the same in bringNoted :7177, once `fails` reaches BRING_FAILED_RUNS with back > 0.
5. **Every run after:**
   - `open` (:6548: due, chains, notMixed) is false: the counts are gone and the box left has no due time.
   - `recheck` (:6550) stays false until +2 h.
   - :6551 returns [] with no pool read.
   - The alarm still fires each minute: returning :6496 is true on `recheck`, and sw.ts:87 sets periodInMinutes 1.
6. **held** (:6435) reads the schedule alone: due [] gives boxes 0, notMixed 0, and :6444 leaves out a released Bootstrap. Home.tsx:988 then renders In Lovejoin only if inLovejoinShown (:1474) is true, which it isn't.
7. **At Stop + 2 h:** the read runs `ours`, then sortOut (a retired pool's box comes back mixed or not), then scheduleFound (:6572) gives the box a due time, and :6578 deletes recheck. Home shows '1 box of 10 ₳ · Next back …'.
8. **What closes it earlier:** status (:6118/:6124) when Lovejoin's page opens, or an unlock with `open` (a chain record).

**Why Stop pushes the read:**
- A withdraw of the run that a node drops leaves its box listed but held as spent for 2 h. Its due time was taken when it went (countBack), so nothing reads the pools again once it's free.
- Stop therefore arranges one read after every withdraw the run sent is free again, so that box gets a due time (1.6.0's wlj-2's notes). settings.lovejoin.bringLate promises exactly this: 'or after its own wait if you stop'.
- Pinned by bring-review-fixes' 'gives the box its due time back after Stop, once it's free' and '…once the run stopped itself too', and by crediting-review-fixes' R3-5.
- One field holds both reads, so the later write wins.

**Evidence:** All runs from the sandbox's extension folder with `npx vitest run <files> --maxWorkers=2`.

**Reproduced the reviewer's test:** tests/r2-critic-home-after-stop.test.ts gives 1 passed. Minutes 0-90: boxes 0. Minute 120: 'In Lovejoin 1 box of 10 ₳ 10 ₳ Next back Today, 05:30'.

**My test:** /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-critic/seedelf-platform/seedelf-web-wallet/extension/tests/trace-r2-critic0-reach.test.ts, 6 passed at 4b4628e9:
1. **Real cadence (one run a minute), Home through inLovejoinShown:** '(no In Lovejoin section)' at every sample from minute 0 to 119. credential_utxos reads stay at 1 from the Stop to minute 119 and reach 2 at 120. recheck − stop = 7,200,000 ms; counted 1.
2. **status() 5 min after the Stop:** 'In Lovejoin 1 box of 10 ₳ … Next back Today, 03:35'.
3. **giveme.my 503 after the first withdraw:** the run stops by itself 3 min later with {back 1, fails 3, stopped}, recheck +120 min, and no section on Home.
4. **With a 1.7 cut chain's record:** after the Stop, 'In Lovejoin Your mixes A mix stopped partway: open Lovejoin to see what to do.' After lock and unlock, '1 box of 10 ₳ … Next back …'.
5. **A 1.7 Bootstrap of two classic boxes:** recheck undefined after the run. After a Stop past one withdraw, no section at minutes 0, 30, 60 and 90; the box shows at 120.
6. **Bootstrap, run stopped by itself having sent nothing (credential_utxos 500 three times):** returning false. 12 h of runs, an unlock included: 0 reads, 0 withdraws, no section. After status(): '2 boxes of 10 ₳ … Next back'.

**Base:** 1beba3fb's lovejoin.ts swapped in, then restored; sha256 87ad0676…cb8b checked OK. The reviewer's test fails there, with Home showing '2 boxes of 10 ₳ 20 ₳ Not on their way back 2 not mixed yet' from minute 0 to 90. My tests 5 and 6 behave identically at base.

**Prototype:** /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-critic/trace0-proto.py, run as `python3 -I trace0-proto.py src/background/lovejoin.ts A|A+|A-norearm`. Pins: …/extension/tests/trace-r2-critic0-pin.test.ts, 5 tests: Stop; the run's own stop; late with a dropped withdraw and nothing left; Bootstrap Stop; Bootstrap with nothing sent.

| Build | Pins | Existing tests |
|---|---|---|
| Unfixed tree | 1, 2 and 4 take 120 min; 5 brings nothing back; 3 passes | — |
| A (the reviewer's option (a)) | 1-3 pass; 4 and 5 fail (120 min; 0 back) | The four listed files plus lovejoin-crediting-review-fixes: 100 passed |
| A-norearm (plain Math.min) | 3 fails: 'expected [Array(1)] to have a length of 2 but got 1' | The same five files: 100 passed, so the mutant survives every existing test |
| A+ | 5/5 pass, also with VITE_ENABLE_MAINNET=false | Those five files: 105 passed together with the pins. 22 more files: 494 passed* |

\* lovejoin-flows, -release-rules, -pools, -merged-review, -restore, run-traps-review-fixes, lovejoin-1-5-0, -bring-screen-review-fixes, -stopped-shown, -held-balance, home-review-fixes, lovejoin, -due-times, unlock-waits, runs, withdraw-resend-unlock, lovejoin-withdraw-submit, -planner, public-mix-maybe, spent-clock-review-fixes, lovejoin-found-later, -own-wait.

lovejoin.ts was restored after every run, and its sha256 checked each time. git diff is empty. Untracked files: my two tests, trace0-proto.py and trace0-lovejoin.sha. I didn't touch the reviewer's tests.

**The fix:** **(a) is right, and smaller and safer than (b).** As prototyped (A), it is all in lovejoin.ts, with no UI, i18n, schema or migration change:
- :6919 and :7177 become `s.recheck = Math.min(s.recheck ?? Infinity, now + SPENT_KEEP_MS)`.
- :6578, on a recheck read, re-arms instead of deleting while one of the run's withdraws is still listed and held as spent:

```ts
const mine = new Set(owned.map(ref));
const out = new Set(listed.filter((b) => !mine.has(ref(b))).map(ref));
if (Object.keys(s.counted ?? {}).some((r) => out.has(r))) s.recheck = now + SPENT_KEEP_MS;
else delete s.recheck;
```

The re-arm is required: a plain Math.min loses the dropped withdraw's read where nothing else is left. That is the reviewer's caveat, and my pin 3 proves it.

**Widen it (A+).** retireOnce should owe the read at once when it releases a Bootstrap too:
- At :4229, track `released` for an entry not released before.
- At :4245, write `if (counted || released) s.recheck = Math.min(s.recheck ?? now, now)`.

Otherwise the older sibling stays: hidden 2 h after a Stop partway, and waiting for the hub after a run that stopped having sent nothing. Math.min in place of `??=` also stops a 1.7 Stop's pending recheck from deferring the read; with the re-arm that's safe.

**Cost:**
- **Requests:** Stop's read moves from +2 h to the next run, in the retired run only, plus at most one more read at +2 h while a withdraw is held as spent. A+ adds one read after a first unlock that released a Bootstrap. These are the same pool listings every wallet makes, so the privacy policy needs no change.
- **Behaviour elsewhere:** a plain Stop with no earlier recheck is unchanged.
- **Money figures:** none change; Home is simply right sooner.
- **Traps:** none (Math.min on finite numbers).
- **Privacy:** the box's own wait is drawn a minute after the Stop rather than 2 h later, still one box at its own time.

**(b) is larger and fixes less.**
- held() reads the schedule alone (Home polls every 20 s, asking nobody), and the schedule keeps no per-pool boxes from the last read: Bringing.left is one total, and Stop deletes `bringing`.
- So (b) needs a new sealed field and its migration (:7716-7735), clearing at the next read so nothing double counts, and a Home sub-line for a box with no due time (en, es and ja plus a blind round).
- It keeps the 2 h delay of the return.
- As worded (bringStopped.retired), it misses the run's own stop, which keeps `bringing` with `stopped` and writes no bringStopped.

**Pins the fix must carry** (each kills a mutant):
- Pin 1, Stop partway: the box shows at the next run. Kills reverting :6919.
- Pin 2, the run's own stop: kills reverting :7177.
- Pin 3, late with a dropped withdraw and nothing left: the box still comes back. Kills plain Math.min, the mutant every existing test lets through.
- Pins 4 and 5: kill dropping `released`.

*Notes (r2-critic#0):* My files, all in my sandbox:
- Tests: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-critic/seedelf-platform/seedelf-web-wallet/extension/tests/trace-r2-critic0-reach.test.ts and …/tests/trace-r2-critic0-pin.test.ts.
- Prototype script: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-critic/trace0-proto.py, which applies A, A+ or A-norearm by exact strings.
- Checksum: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-critic/trace0-lovejoin.sha, the restored lovejoin.ts's sha256.

The sandbox has no tracked changes. One slip: I first wrote trace0-proto.py into a sibling folder outside my sandbox, …/scratchpad/r2/r2-critic-trace0/. I moved it into the sandbox at once and removed that folder; nothing else was written outside.

An aside I didn't trace further: with a 1.7 cut chain's record, Home keeps 'A mix stopped partway: open Lovejoin to see what to do.' after the box is back on its due time in a retired pool. The chain's `left` stays 1 while its box is listed, though nothing waits for the user there. Base and merged both show it, so it isn't this round's.

Not checked:
- Bootstrap boxes in an 8131b1d token or 5 ₳ pool: I tested the classic pool only. The release and the recheck code are pool-agnostic.
- Real Chrome, e2e or live runs.
- The prototype's code comments in house style.

## r2-critic#2: PARTLY

**Reach:** The claim holds: lookSoon's 'at most every REFRESH_MS a network' is true only within one worker's life. The reach is narrower than the scenario on one side and wider on another.

Koios side (the holder read): reachable on mainnet with Settings' Koios-only on, or while the data layer is marked down, from 1.8.0 until a v2 5 ₳ pool is launched on mainnet and found. The mainnet head start keeps none: src/lovejoin-pools.json holds only a retired v1 5 ₳ pool there. Any ask can then look: a return's build (yours or the runner's), a swap's Review, Stop's dialog, a site's funding or top-up review, a mix's review in a v2 token pool, and Put in 5 ₳. Settings' Bring every box back now (and its Try again) looks whatever is kept: always on preprod, and on mainnet with Koios-only or the data layer down.

Narrower: on preprod the release's head start keeps v2's 5 ₳ pool (47bece42…, launched at block 5378705). So no adaPool ask ever looks there; the scenario's 'Preprod … no 5 ₳ pool kept' swap Review can't happen. The critic's tests stripped v2 from the head start to model it.

Wider: on mainnet with the data layer up, a look is lovejoin/pools alone. That list's own in-memory throttle (asked/answered) has the same gap. The policy body hedges it at :46, but the 6 November entry (:93) restates it unhedged.

When the bound breaks: only across a worker restart. While an unlocked wallet page is open, LockCountdown (App.tsx:257, LockCountdown.tsx:21) asks the worker every 15 s and keeps it alive, so asks in one sitting share the throttle. It breaks when:
- the page is closed for more than ~30 s between asks;
- the runner builds a return with no page open (alarms a minute apart, each run in a fresh worker);
- the browser restarts or the extension updates.

Cost: at most one extra look per ask. Each look is one credential_utxos of the holder from the last height, plus tx_info and account_update_history only for candidates. It names nothing of the user's, but its timing marks the ask.

**Trace:** 1. The throttle lives on the instance: lovejoin-pools.ts:277 `private scanned = new Map<NetworkName, number>()`. :423-430 lookSoon calls refresh, returns if answeredWithin (:433-436), returns if `scanned` is within REFRESH_MS and no look is under way (:427-428), and otherwise calls scan. scan (:533-541) sets `scanned` at its start (:538).
2. The list's throttle is the same kind: `asked` and `answered` are Maps on the same instance (:268-271), checked in refreshNow (:459-468).
3. One instance per worker: sw.ts:137 `let context` is module-level, getContext (:142-147) builds it once a worker life, and :237 makes `new PoolDiscovery(...)` inside it. :244-247 passes serviceDeps(discovery), so LovejoinService's lookSoon is that instance's (lovejoin-pools.ts:644).
4. The askers: lovejoin.ts:4164-4171 adaPool(ask) calls lookSoon when none is kept or listed. :6873 bringAllBack with no pool calls lookSoon unconditionally.
5. Chrome stops an idle worker after ~30 s; the house says so itself (koios.ts:521-523, dapp.ts:443-444). sw.ts:71 says 'Worker timers don't survive restarts'.
6. Head start: lovejoin-pools.ts:351 kept() merges the bundled pools. adaPoolOf (lovejoin.ts:676-677) finds preprod's v2 5 ₳ ADA pool there, so adaPool returns `kept` (:4166-4167) before any ask.
7. Sentences stating the look's five minutes with no hedge. Code (4b4628e9, under extension/):
- lovejoin-pools.ts:414-416 (lookSoon)
- lovejoin.ts:1591-1592 (LovejoinDeps.lookSoon; the critic missed this one)
- lovejoin.ts:4158-4159 (adaPool)
- lovejoin.ts:6868 (bringAllBack, 'At most once a REFRESH_MS a network')
- sw.ts:235-236 ('at most every five minutes')
8. Drafts in the merged worktree (seedelf-platform/seedelf-web-wallet/docs/):
- store/privacy-policy.md:46: 'and, at most every five minutes, when you press **Bring every box back now** …'. The same sentence hedges the list.
- store/privacy-policy.md:93: 'A look asks what opening Lovejoin's page asks, at most every five minutes: on mainnet our server's list of pools …; on preprod … Koios …'. Both halves are unhedged.
- privacy.md:202: 'at most every 5 minutes a network (counted from the last look's start, the page's too, whatever it found)', against :201's hedge for the list.
- architecture.md:740: 'unless the data layer answered within `REFRESH_MS` or a look started within `REFRESH_MS`', plus the list's '(… at most every `REFRESH_MS`)', against :733's hedge.
- architecture.md:748: '… at most every 5 minutes a network'.
- development.md:331: 'which a pool read asks at most every 5 minutes' (the list's).
- flows.md: none (its :470 'kept five minutes' is the Review's pool read).
9. Old, list-only, unhedged code comments: lovejoin-pools.ts:32 and :439.
10. Other in-memory throttles the docs describe:
- Same gap, old (not new in 1.8.0): PUBLIC_LOOK_MS. lovejoin.ts:2773 `looked`, used by lookDue (:2928-2934) and the runs' publicLook (:5020-5026). With no page open the alarm's runs are separate workers, so the look comes every minute, not 'at most every two minutes' as privacy.md:124, architecture.md:349, :351, :748 and flows.md:128 say.
- Same gap, minor: POOL_ROOM_MS (`roomsRead`): 'kept five minutes' in privacy.md:198, flows.md:470, lovejoin.ts:81 and sessions.ts:1761, :3387. A restart re-reads.
- No practical gap where the window is ≤30 s, because a restart needs ~30 s idle: parts.ts:61 LOOK_EVERY_MS 15 s (its comment already hedges), the activity ping.
- Held across restarts because they live in session storage: the dApp view (dapp.ts:1609), prices, DataParts' Koios fallback, the dApp refusals, the RateLimit hold.

**Evidence:** All runs from the sandbox's extension/ folder, with --maxWorkers=2.

1. `npx vitest run tests/trace-r2-critic-2-3-throttle.test.ts --maxWorkers=2 --silent=false` (the critic's test, copied under my label): 3 passed, `TRACE23-THROTTLE {"reads":2,"apartMs":60000,"REFRESH_MS":300000}`.
2. `npx vitest run tests/trace-r2-critic-2-3-reach.test.ts --maxWorkers=2 --silent=false` (mine; the shipped head start, wired as sw.ts, a restart modelled as a new PoolDiscovery and LovejoinService over the same storage): 7 passed.
- `TRACE23-PREPROD-KEPT {"version":"v2","lovelace":"5000000","holder":[],"koios":0}`: a preprod ask finds v2's pool kept and asks nobody.
- `TRACE23-MAINNET-KOIOS-ONLY {"oneWorker":1,"restarted":2,"apartMs":120000}`
- `TRACE23-MAINNET-UP {"list":1,"holder":[]}`: with the data layer up, a look is the list alone.
- `TRACE23-BRING {"oneWorker":1,"restarted":2}`: preprod, Settings' press, whatever is kept.
- `TRACE23-RUNNER-RESTART {"atReview":1,"atFill":1}`: a self-running swap's fill, built by runAll in a new worker within REFRESH_MS of its Review's look, reads the holder again.
3. All four of my files run together: 13 passed.
4. The within-worker bound is already pinned by lovejoin-found-later.test.ts:391, :491, :512 and :817. :391's second backBuild within REFRESH_MS must not read the holder again, which kills a mutant that deletes lovejoin-pools.ts:428.
5. `git diff --stat` in the sandbox is empty: no source was touched.

**The fix:** Hedge the docs, as the list's throttle is hedged. Don't move `scanned` into chrome.storage.session.

Why not session storage:
(a) It doesn't make the drafted words hold. The entry's 'at most every five minutes' also covers 'on mainnet our server's list of pools', which is the in-memory asked/answered. Moving those is not small: `answered` gates look() and goes with `crowds`, the hub's counts, which live in memory (UI-9).
(b) Session storage survives Remove wallet (privacy.md:142). A restore within five minutes of a look would then skip its first look while the deleted local record forgot the pool. That's the bug state.md's notes fixed for the list (refreshNow :462-466), and it goes against 'when it exists it uses it'. It would need its own special case.
(c) The bound protects only Koios's per-IP budget and a timing signal. The read names nothing of the user's, extra looks are capped at one per ask, and RateLimit already holds the whole wallet under the tier.
(d) Code and tests at the release gate, against docs alone.
If the owner wants a firm bound, move both throttles together in a later chunk, with Remove wallet clearing them.

Wording (the house's own):
- privacy-policy.md:46: 'and, at most every five minutes while the browser keeps the wallet running, when you press …'
- privacy-policy.md:93: 'A look asks what opening Lovejoin's page asks, at most every five minutes while the browser keeps the wallet running: …'
- privacy.md:202: 'at most every 5 minutes a network while the worker runs (counted from the last look's start …; the throttle is in its memory, as the list's, so a worker the browser started again looks at its first ask)'
- architecture.md:740 and :748, and development.md:331: add 'while the worker runs'.
- The five code comments: add 'while this worker runs (`scanned` is in its memory, as `asked` is)'.

The critic's fix is right but misses lovejoin.ts:1591-1592, architecture.md:740 and :748, development.md:331, and the entry's list half.

Risks: none. It changes no request, money figure or trap.

Test: the within-worker bound is pinned (found-later :391). Optionally commit the restart test ('a new worker looks at its first ask') as the hedge's pin: it kills a mutant that persists `scanned` without the docs dropping the hedge. The old PUBLIC_LOOK_MS docs (privacy.md:124 and the others) want the same hedge, or `looked` moved to session storage, and are outside 1.8.0's 'new'.

## r2-critic#3: CONFIRMED

**Reach:** (1) Put in 5 ₳ for Lovejoin's pool read: mainnet only (networks.ts:71 sets the floor at 30; preprod's is 0, :56, which skips the room read). It needs a v2 5 ₳ pool, kept or found by the press's own ask, and a session brought back by hand with no 5 ₳ of ADA alone at its account and spare ADA that pays for a box. If no pool read is kept within POOL_ROOM_MS in that worker, the press reads every pool's boxes: our server's lovejoin/pool and lovejoin/tokens, and Koios for pools those don't cover. Before any v2 5 ₳ pool exists, the press asks the list or looks, but reads no boxes. A rare flow (sessions a restore found), but certain once the pool exists, and new against the base and the 30 October policy alike.
(2) The look at a site session's top-up review needs a fresh collateral, returns through Lovejoin on and the collateral switch on. The look at a mix's review needs the tile's Mix or Mix my boxes again in a v2 token pool. Both only while no v2 5 ₳ pool is known; the mix case is narrow.
(3) Any self-running swap through Lovejoin while no v2 5 ₳ pool is known (mainnet, as the head start ships). Its return is built by the alarm's run, or by its page's own step, as the order fills or refunds, or after Stop once the cancel lands. It asks discovery: a Koios holder read with Koios-only or the data layer down, our server's list with the data layer up. That comes seconds before the return is sent. It runs only while the wallet is unlocked (runs.ts:50-53): within the auto-lock window (1 to 60 minutes), or 2 to 20 minutes after an unlock. Never at a press.

**Trace:** 1. Put in 5 ₳. sessions.ts:2443 backCollateralBuild calls lovejoinWantsCollateral(…, true) (:4914-4918), which calls collateralWanted(ask=true) (:4866).
- :4873 adaPool(network, ask) (lovejoin.ts:4164-4171) reads the list, then calls lookSoon.
- :4874 `pays` is WebAssembly's funding: no request.
- :4875-4876, with floor > 0, calls room(network, id, !ask), i.e. not quiet: lovejoin.ts:3364-3365 room, then rooms (:3374-3387), then splitAll (:7224), then readSet() and listing (:3137), then poolRows (:3154: poolNow, tokensNow, Koios credential_utxos).
- Base (1beba3fb): lovejoinWantsCollateral(network, s, rows) was quiet. Its collateralWanted read adaPool(network) quietly (base sessions.ts:4701), WebAssembly's funding, and poolsOf(…, true). collateralTopUp has no Lovejoin call. No request.
2. Top-up and mix reviews. topUpBuild :2322-2323 (fresh), then tailReserve (:4798, :4807), then collateralPool (lovejoin.ts:4274-4276), then adaPool(network, true), then lookSoon (:4169-4170). mixFunding :2190 and :2206 reach the same tailReserve, from mixOutBuild (:2119, :2145) and againBuild (:2156, :2171). At base the same calls asked the list only (base lovejoin.ts:4057-4060).
3. The runner. runs.ts:83 runAll, sessions.ts:3518 step, act (:3645), then bringBack at :3866 (fill), :3820 (a direct swap), :3798 (Stop) or :3778 (stopped partway). bringBack (:4286-4296) calls buildBack (:4464):
- with the 5 ₳ collateral at the account: :4534 collateralPool, then chain() (lovejoin.ts:3583 adaPool(network, true));
- without it: :4598 collateralWanted(…, true), then :4873.
Then lookSoon, then sendBack at once (:4295).
4. Every request time the merged code adds over the base, and whether the draft entry (privacy-policy.md:93) names it.
The look:
- Settings' Bring every box back now and its Try again (lovejoin.ts:6873): named.
- A return built by you: named ('as a private session's return is built').
- A return built by the runner, and a mix session's chain (buildBack's collateralPool): the build is named, but 'it comes when you do one of these' is false for these, and a mix's chain isn't 'a return'.
- A swap's Review (:1784, :1887) and Stop's dialog (:3413, asked as Stop is pressed, Swaps.tsx:2451): named.
- A site's funding review (:1996, :2050): named.
- A top-up review (:2323): named only if 'a session's funding review' is read to include it. The policy never mentions top-ups.
- A mix's review (:2206): not named.
- Put in 5 ₳ (:4873): named.
Pool listings:
- A site's funding review, by lovejoinRoomNow's room (:2052): named ('even with the collateral switch off').
- On mainnet, a return built with no 5 ₳ at its account (:4598, then :4876): named.
- On mainnet, Put in 5 ₳'s press (:2443, then :4876): NOT named.
- Not owed: priced's room once the ask finds a pool none was kept for (:1785): a review read, the same request at the same moment. And O5 (lovejoin.ts:3603 acrossOf): a token return with no 5 ₳ pool reads and measures its pools again, which the 26 October entry already describes.
- Nothing else: reserve is local (lovejoin.ts:4501); retireOnce, cuts, retiredIds, rows and lovejoinRoomKept are meant to ask nobody; siteOutBuild reads epoch_params once instead of twice.
5. Wrong or missing, exactly.
In the entry (:93):
- 'It names nothing of yours, though it comes when you do one of these.' is wrong for the runner's returns.
- '…it also looks for one as a private session's return is built, at a swap's review or its Stop, at a session's funding review, and when you put 5 ₳ in for Lovejoin' doesn't name the runner, the top-up or the mix's review.
- '…and, on mainnet, by a return built with no 5 ₳ at its account.' is missing 'and by **Put in 5 ₳ for Lovejoin**'.
In the body (:46): the same look list, and the same omissions.
Committed text the drafts left stale:
- architecture.md:647: 'It reads the device alone: Settings, and WebAssembly's price of one box.' and 'The offer doesn't read Lovejoin's pool, so with the pool short the return still leaves Lovejoin out …'. Both are now true only of the list's view: the press asks, reads the room, and refuses under the floor.
- architecture.md:658: '…Put in 5 ₳ for Lovejoin … its test reading only the device (C53).'

**Evidence:** All runs from the sandbox's extension/ folder, with --maxWorkers=2.

(1) `npx vitest run tests/trace-r2-critic-2-3-put-in-five.test.ts --maxWorkers=2 --silent=false` (the critic's test, copied under my label; it sets preprod's floor to 30 to stand in for mainnet's): 1 passed, `TRACE23-PUTIN5 {"offered":"missing","press":"Its return needs no 5 ₳: …","pressRead":1,"after":null}`. I didn't swap base files in: the sandbox is shared. The base half is by reading base sessions.ts:4701 and its collateralTopUp, which has no Lovejoin call.
(3) tests/trace-r2-critic-2-3-reach.test.ts (mine; swap-session.ts's flow, Lovejoin wired with discovery; preprod's head start less v2 stands in for mainnet's, which has no v2 pool):
- `TRACE23-RUNNER {"atReview":1,"atFill":1,"sent":1,"auto":{"step":"returning","filled":true,…}}`: the return, built by runAll after REFRESH_MS with nothing pressed, read the holder and went out directly.
- `TRACE23-RUNNER-COLLATERAL {"atFill":1,"sent":1,"asks":["preprod:ask:LovejoinService.collateralPool","preprod:ask:LovejoinService.chain"]}`: with the 5 ₳ collateral at the account, the asks come from the critic's chain, with one holder read between them.
- `TRACE23-RUNNER-RESTART {"atReview":1,"atFill":1}`.
(2) By reading the chains above, with every line number checked at 4b4628e9.
Also `npx vitest run tests/trace-r2-critic-2-3-site-reads.test.ts --maxWorkers=2 --silent=false` (mine): `TRACE23-SITE-READS {"collateralSwitch":true,"listings":2}` and `{"collateralSwitch":false,"listings":1}`. At base, by reading, these were 1 and 0.
All 13 scratch tests pass, and no tracked file changed.

**The fix:** The critic is right on (1) and (2): add 'and by **Put in 5 ₳ for Lovejoin**' to the pool-read sentence, and name the top-up and the mix's review.

Their replacement for (3) is itself inaccurate. 'it comes seconds before that return, review or funding' doesn't fit a review: the look comes as the review is built, when you open it. And for your own return's review, the return may go much later, or never. Use privacy.md:202's own phrase: 'though it comes at the moment of one of these'.

Proposed text for the entry (and the same list in the body at :46): 'While the wallet knows of no such pool, it also looks for one as a private session's return is built, by you or by the wallet as a swap that runs itself comes back, at a swap's review or its Stop, at a session's funding or top-up review, at a mix's review, and when you put 5 ₳ in for Lovejoin; … at most every five minutes while the browser keeps the wallet running … It names nothing of yours, though it comes at the moment of one of these. … and, on mainnet, by a return built with no 5 ₳ at its account and by **Put in 5 ₳ for Lovejoin**.'

Also owed, and missed by the critic: architecture.md:647 and :658 (the press asks as a return's build does), and the body line :46.

Risks: none, docs only. No request, figure or trap changes.

Test: no docs test exists. The critic's Put in 5 ₳ test, committed, would kill flipping sessions.ts:4876's `!ask` to `true`. That mutant makes the press stop reading, so the new sentence would go false, and critic#1's refusal under the floor would silently go too.

*Notes (r2-critic#2, r2-critic#3):* The four scratch tests and my working folder are in the sandbox, and no source was touched:
- /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-screens/seedelf-platform/seedelf-web-wallet/extension/tests/trace-r2-critic-2-3-throttle.test.ts (the critic's, copied)
- /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-screens/seedelf-platform/seedelf-web-wallet/extension/tests/trace-r2-critic-2-3-put-in-five.test.ts (the critic's, copied)
- /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-screens/seedelf-platform/seedelf-web-wallet/extension/tests/trace-r2-critic-2-3-reach.test.ts (mine)
- /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-screens/seedelf-platform/seedelf-web-wallet/extension/tests/trace-r2-critic-2-3-site-reads.test.ts (mine)
- /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-screens/.trace-r2-critic-2-3/ (the two diffs, the base copies of lovejoin.ts and sessions.ts, find.py)

Side findings from counting request times. None is in my two traces; route them as you see fit:

N1 (low, new): a site's private session's funding review now reads every pool's boxes twice when the collateral switch is on, its default. tailReserve's collateralPool reads once, then lovejoinRoomNow's room() reads again (sessions.ts:1996, :1999, :2052; lovejoin.ts:4279 against :3374-3387). The base read once. Shown by trace-r2-critic-2-3-site-reads.test.ts: 2 listings with the switch on, 1 with it off. It's the same request at the same moment, so not a policy matter, but it doubles that review's pool requests (two credential_utxos of every mix box on preprod or with Koios only). Possible fix: have lovejoinRoomNow reuse tailReserve's read, for example by giving CollateralPool `others`.

N2 (nit, new): lovejoinRoomKept, the connect window's card, calls room(network, ada.id) without quiet at sessions.ts:2075, after collateralPoolTakes said "yes" at :2073. Each tests `now - kept.at < POOL_ROOM_MS` on its own (lovejoin.ts:4302-4304 and :3375-3376). If the clock crosses the five-minute boundary between the two, rooms() reads every pool at a site's connect, the read dapp.ts:1065-1067 says is never tied to a connect. The window is milliseconds wide. Fix: `room(network, ada.id, true)`.

N3 (old, outside 1.8.0's "new"): PUBLIC_LOOK_MS's "at most every two minutes" (privacy.md:124, architecture.md:349, :351, :748, flows.md:128) has the same gap. With no page open, each alarm run is a fresh worker, so the look comes every minute. Found by reading, not tested.

The brief's line "a double read of Koios's holder is a finding" doesn't apply: one ask's collateralPool and chain() share one holder read (TRACE23-RUNNER-COLLATERAL).

The Markdown copy at docs/plans/review-1.8.0/round2/ isn't written: that's outside my sandbox, which the task forbids.

## r2-worker#0: PARTLY

**Reach:** Who meets it: anyone who presses Stop on a swap session that returns through Lovejoin with Settings' collateral switch on (the default), on a 1.8.0 or a 1.7.2 approval, where the 5 ₳ pool's free count limits the return's box count. It happens on both networks.

At width 3 the reach is narrower than "wherever the room binds":
- Depth 1 (draws d = 2): every binding pool with f ≥ 4 free.
- Depth 2, the default (d = 8): only where f ≡ 0 or 1 (mod 8) and f ≥ 16. That's 2 pool sizes in every 8.
- Depth 3 (d = 26): f ≡ 0 or 1 (mod 26), f ≥ 52.
- On preprod (floor 0) that's any such size. On mainnet (floor 30 others) it's normal use near the floor: at depth 2, 32/33, 40/41 or 48/49 free with about 40 ₳ or more coming back.
- Each time the dialog names one box more than is made, with that box's mixes (4 at depth 2, 3.8 ₳ of mix fees) and a 0.3 ₳ withdraw estimate. That box's ADA comes back directly with the return.
- The figures stay upper bounds. Across 51 states the current dialog is never under the chain (boxes or mix fees) and over it in 28.

At width 4 the reach is wider than claimed. Width 4 is a Settings option, kept on the approval only when the Review's own read picked four.
- The width and its fall-back note can be wrong in both directions, with fees counted at the wrong width.
- At exactly 4 free (depth 1) or 16 free (depth 2), the dialog shows the critical `swaps.stop.privacy.collateralMix` ("mixed"). The return builds no tail, so the 5 ₳ comes back with the rest.
- This is P1's class of error, and it contradicts the finding's Covered line that tailDrawn's word matches "in every case". That line was run at width 3 only.
- Preprod: plausible at those pool sizes. Mainnet: 16 free with 30 or more others needs 14 or more of the pool's boxes reserved by the wallet's own other chains, so it's rare.

The swap's Review has the same unheld count at its own read (a forecast).

Age: from 44b (the base 1beba3fb already holds the hold; 1.7.2 had none), so it's new in 1.8.0, not made by the fix round. Round one saw it as an aside, not a finding: p1-trace's Notes, and share.md's "priced's own box count at 16 or 17 … is the find lane's".

**Trace:** Stop's dialog (line numbers at 4b4628e9):
1. stopCost, sessions.ts:3399, calls priced(network, true, auto.lovejoin, …) at :3413.
2. adaPool(network, true) at :1784, then a loud room() at :1785 (rooms()/splitAll, kept POOL_ROOM_MS).
3. at(w): fits = ⌊room.free / (mixesPerBox·(w−1))⌋ at :1795–1801, with no hold.
4. price/leg, then wayOver over the unheld legs at :1841.
5. takes at :3429–3432 = collateralPoolTakes (lovejoin.ts:4295–4305) on that kept read: "yes" iff others ≥ floor and free ≥ TAIL_DRAWS.
6. aside, held and counted at :3434–3447; cost = price(counted) at :3449.
7. drawn = takes==="yes" && tailDrawn at :3454. tailDrawn (:3472–3482) computes made = min(cost.boxes, roomLeavingTail(free, draws)) at cost.width, the dialog's unheld width, and feeds only the collateral word (:3455).

The return:
1. stop() → step → buildBack, sessions.ts:4464.
2. intoPool at :4527–4535 = collateralPool(network, params, chainOwner(index)), lovejoin.ts:4274–4284: adaPool(…, true), !usableNow, split with owner, !floorShort, free ≥ TAIL_DRAWS (:4282).
3. chain(…) at :4615 with boxes = record.mix?.boxes (undefined for a swap) and again = record.mix?.again (:4609, :4623), way.collateralPool = intoPool (:4637).
4. into = adaPool(network, true) at lovejoin.ts:3583.
5. holdTail = way.collateralPool && (boxes === undefined || again) at :3643, true for every swap return whose collateral goes in.
6. fanOut (:3692), fit(w): room = roomIn(c, pool, free, perBox·(w−1)) at :3729. This is roomLeavingTail = max(⌊(f−2)/d⌋, min(1, ⌊f/d⌋)) (:838–841), since collateralPool.pool.id === into.id (:849–852).
7. wayOver over the held counts at :3737. acrossOf's ADA leg goes through the same roomIn (:3918).

So the return holds iff intoPool is defined. stopCost's takes==="yes" is the same rule on the kept read, plus:
- `landing`, which counts the collateral before it's listed.
- spare>0 ‖ out ‖ (landing && adaIn). Where that's false, no box is counted anyway.

One edge has takes "no" while the return holds: mainnet's crowd count under the floor while the live read is over it. There the dialog over-counts, even after the fix, and "at most" stays true.

Why one box: ⌊f/d⌋ − roomLeavingTail(f, d) = 1 iff f mod d ∈ {0, 1} and f ≥ 2d. At d = 2 that's every f ≥ 4.

Why the width differs at four: held, three's count can drop to four's (1 = 1). wayOver then picks four (:3737), while the unheld dialog picks three with FOUR_SHORT. At f = 4 (d1) or 16 (d2), four's single box draws 3 of 4 (15 of 16), leaving the tail 1 box. Conversely, with exactly 2 boxes paid at 6–7 free (d1), the unheld four fits 2 and the dialog says four, while the held four fits 1 and the chain goes three.

The Review: lovejoinCost → priced(network, pool && on) at :1633 has no hold. It's the same arithmetic at the Review's read, and it records `width: 4` only when that unheld wayOver picks four (:1951).

**Evidence:** 1. The reviewer's tests, run as given. `npx vitest run tests/r2-worker-flows.test.ts -t "flow 2b|F-stop" --maxWorkers=2 --silent=false`: 14 passed, logs reproduced exactly.
- n=5: 2 against 1. n=6 and 7: 3 against 2. n=9 on a 1.8.0 approval: 4 against 3. n=3 and n=20 agree. F-stop-kept: 3 against 2.

2. My copy, `tests/trace-w0-stop.test.ts` in the sandbox. It uses the reviewer's device(), the real WebAssembly, and records shaped as outSubmit writes them (auto {approved, direct:false, lovejoin {depth, delay, width?, box}}, collateralReserve, the account holding funding + the 1.5 ₳ reserve + 5 ₳). `-t "trace-w0"`, 51 states, all run:
- w3 d1: n=4,5 → 2 vs 1; n=6,7 → 3 vs 2; n=8,9 → 4 vs 3; n=2,3 agree.
- w3 d2: n=16,17 → 2 vs 1; n=24,25 → 3 vs 2; n=8,9,10,15,18,26 agree.
- w4 d1, 40 ₳: n=4 → dialog {2 boxes, width 3, fellBack, "mixed"}, chain {1, width 4, no tail}. n=5 → {2, 3, fellBack} vs {1, 4, tail}. n=6–13 → one over at three.
- w4 d1, 15–16 ₳ fundings: n=6,7 → dialog {2, width 4, no note, 2.7 ₳} vs chain {2, width 3, 1.9 ₳}.
- w4 d2, 80 ₳: n=16 → {2, 3, fellBack, "mixed"} vs {1, 4, no tail}. n=17 → width mismatch. n=32 → 4 vs 3.
- Collateral switch off (`-t "trace-w0 off"`): dialog = chain at n=6 d1 w3 (3), n=16 d2 (2), n=4 d1 w4 (2 at three) and n=6 d1 w4 (3). The gap is exactly the hold.
- A swap's Review (`-t "trace-w0 review"`): MIN→ADA at n=6 d1 shows 3 of 10 "mixed" (2 if held). At n=16 d2 it shows 2 of 7 (1 if held). ADA→MIN's ifStopped shows 3 at n=6.

3. Fixes, patched into the sandbox's sessions.ts behind TRACE_W0_FIX (the diffs are in trace-w0-out/flag.diff and thunk-and-cap.diff).
- The lead's form (a hold thunk called after priced's room read) and a call-time flag form (price(counted, undefined, takes==="yes")) both make dialog = chain in boxes, width, fellBack, collateral word and mix fees in all 51 states: 0 under, 0 over. No built chain changed.
- The cap alternative under-states in 10 of 51 states:
  - n=4 w4 d1: 1 box at three, 0.95 ₳ shown, while 1.35 ₳ is paid at four.
  - n=6–7 w4 d1 with 15–16 ₳: 1 box at four shown, 2 made at three.
  - It also keeps "mixed" at n=4 (d1) and n=16 (d2).
- Existing tests under the fix: the thunk form passed 103 + 184. The flag form passed 348 in 9 files: collateral-reserve-review-fixes, lovejoin-chain-review-fixes, lovejoin-share-review-fixes, swap-lovejoin-way, lovejoin-found-later, lovejoin-1-5-0, lovejoin-planner, lovejoin, sessions. None pins the hold: share's 16-strangers test asserts only the word (lovejoin-share-review-fixes.test.ts:465–470).

4. Base: `git show 1beba3fb:` has roomIn's hold and holdTail, and its stopCost has no tailDrawn. 6b70c1f8 (1.7.2) has neither.

5. Restored: sessions.ts sha256 1d0df96d…, the same as the HEAD blob; git diff is empty.

**The fix:** The lead's fix is right, and it's the one that keeps the dialog's width (4 against 3, and fellBack) equal to the chain's.
- With held fits inside priced, wayOver weighs what fanOut weighs.
- tailDrawn then gets the chain's width, so its word is right at four too.
- The cap alternative fails at width 4. It keeps the unheld width and note, and keeps "mixed" at 4/16 free. Worse, it under-states mix fees (10 of 51 states) and boxes (6). That makes today's true "at most" false: a fee paid and not shown. At width 3 the two are equivalent.

A simpler form, the same results in all 51 states:
- price(spare, upTo, held) and leg(spare, held) pick roomLeavingTail(room.free, draws) or ⌊room.free/draws⌋ at call time.
- stopCost keeps its order and calls price(counted, undefined, takes === "yes"). No thunk and no reorder.
- Use `=== "yes"`, as tailDrawn and collateralPool's success do. `!== "no"` differs only in r2-worker#2's lapse window.
- Optionally, priced returns its `room`, and drawn = held && room.free − cost.boxes·draws(cost.width) < TAIL_DRAWS. That drops tailDrawn's second adaPool/room() calls and closes r2-worker#2's tailDrawn half.

What changes:
- Money: Stop's boxes, mixes and fees drop to the return's.
- Words: `of` shows more often, as "about N … all the pool has room for now". The room now includes the collateral's two draws, which is acceptable.
- No switch disappears, since roomLeavingTail ≥ 1 wherever ⌊f/d⌋ ≥ 1.
- No request, trap or privacy change, and the Review is untouched.

Also correct stopCost's L1 sentence (sessions.ts:3393–3397).

Leaving the Review as a forecast is consistent with P1: "leave a swap's approval alone, since it's a forecast". Holding there would also record width 4 at 4 (d1) or 16 (d2) free. A return at four there leaves the collateral one box, so the 5 ₳ comes back unmixed, where the Review's recorded three mixes both.

Pins for the new test:
- (a) share's Stop test at 16 strangers: cost.boxes = back.lovejoin.boxes = 1, mixes 4, 3.8 ₳.
- (b) a width-4 approval, depth 1, 4 strangers: dialog {boxes 1, width 4, no fellBack, "ifLeft"}, chain width 4, 1 box, no tail.
- (c) width 4, depth 1, 6 strangers, 15 ₳ funding: dialog fellBack FOUR_SHORT with no width; chain three, 2 boxes.
- (d) collateral switch off, 6 strangers, depth 1: 3 = 3.
- (e) a fresh device with nothing kept.

Mutants these must kill: the hold dropped (a, b, c); the hold ungated (d); the cap alternative (b, c); tailDrawn at the unheld width (b); the hold read before priced's room() ("maybe": a, b on e).

*Notes (r2-worker#0):* Verdict: PARTLY.
- The finding's scenario is real and reproduces exactly, but the claim's reach is off both ways.
- Narrower: at the default depth 2 the one-box over-count is only where free ≡ 0 or 1 mod 8.
- Wider: at width 4 the dialog's width, its fall-back note and its fees can be wrong. At 4 free (depth 1) or 16 free (depth 2) it shows the critical "mixed" while the return builds no tail, which is P1's class of error.

The lead's fix works:
- Held fits in priced make the dialog exact (boxes, width, word, fees) in all 51 states.
- A call-time flag form is simpler and gives the same results.
- The cap alternative is worse: it under-states fees and boxes.

Adjacent, not judged (chain side): fanOut's D3 choice ignores the tail. With width 4 asked and the hold, at 4 free (d1) or 16 free (d2) three and four both make one box, so four goes. Its box draws 3 of 4 (15 of 16), leaving the collateral's mix one, so no tail; three would have mixed the box and the 5 ₳. With the collateral switch off the same pool goes three with 2 boxes. It's the owner's D3 rule (boxes only), so I flag it rather than judge it.

The sandbox is shared with trace:r2-worker#1, whose prototype-patch tests are in the same tests/ folder. My TRACE_W0_FIX patches to sessions.ts were live from about 06:41 to 06:58. Without the env var they behaved the same as HEAD. sessions.ts is now restored to HEAD's blob (sha256 1d0df96d…), and git diff is empty.

Files are in /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-worker:
- seedelf-platform/seedelf-web-wallet/extension/tests/trace-w0-stop.test.ts (the scratch test)
- trace-w0-out/flag.diff and trace-w0-out/thunk-and-cap.diff (the fixes as patched)
- trace-w0-out/run-none.txt, run-lead.txt, run-cap.txt and run-flag.txt (the logs)
- trace-w0-out/sessions.ts.orig, .thunk and .flag (the copies)

## r2-tests#0: CONFIRMED

**Reach:** Stop's dialog for a swap that runs itself, approved on 1.7.2 at four a mix and still running when 1.8.0 lands. In practice that's an order that hadn't filled. 1.7.2 wrote auto.lovejoin as {depth, delay, width: 4} with no `box` (git show 6b70c1f8 sessions.ts:1892-1898), so pricedClassic is true. It also needs v2's 5 ₳ pool shown, with room four a mix for the 1.7.2-priced count but not for the uncapped 5 ₳ count. The reach is wider than the finding says, because it isn't preprod-only. Preprod (floor 0): 40 ₳ with 12 strangers, and 60 ₳ with 20. Past mainnet's floor of 30 it diverges too. With preprod's floor set to 30: 80 ₳/30 free boxes, 100 ₳/30 and 200 ₳/60 all diverge. The band rises with the pool's size, since the mutant weighs about twice the boxes against free/3. There, the mutant also names a box more than the return makes (80 ₳: 7 against 6; 200 ₳: 18 against 17), not just the wrong width. The population is one-time and shrinking (1.7.2 approvals in flight), so low is still the right severity.

**Trace:** 1. sessions.ts:3413 stopCost calls priced(network, true, auto.lovejoin, undefined, pricedClassic(s)). pricedClassic (6355) is true where there's no `box`, and asked = fixed.width = 4 (1779).
2. at(w), 1786-1836: `tens` (1814-1816) is the classic pool's funding of one box and of two, so approved(spare) (1819) is 1.7.2's count. price (1820-1830) caps by it at 1821. leg (1831-1834) caps by it at 1832; that cap is the lead's, a990deb8.
3. price(spare, 4), 1839-1844: line 1840 returns three.price when upTo is 3, which is why the lead's three-wide test never reads leg. Otherwise it runs wayOver([four.leg], [three.leg]) (1841; lovejoin.ts:2582-2591), which goes four iff four.fits >= min(four.pays, three.fits).
4. The return: buildBack passes classic: true (sessions.ts:4636). chain()'s countAt (lovejoin.ts:3663-3672) caps each width's count by the classic plan (3666-3669), and fanOut's fit and wayOver (3724-3737) weigh those capped counts.
5. Under B3 (1832 becomes `affordable(spare)`), the dialog's D3 rule weighs the uncapped 5 ₳ count (6 at 40 ₳) against four's room (4 at 12 strangers) and falls back with FOUR_SHORT. Its price is still capped (1821), so it shows three's width and three's fees. The return weighs 3 against 4 and goes four.
6. It shows in StopDialog (Swaps.tsx:2833): the mix fees in swaps.stop.throughCost (2910), and the WidthNote line (2945).

**Evidence:** All under my runner, /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-tests/trace-r2-tests/trace-mutate.py. It applies each mutant by exact replacement, then restores and checks the sha256. Results: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-tests/trace-r2-tests/main.jsonl and /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-tests/trace-r2-tests/second.jsonl.
- B3 survives the finding's 9 files: 348 passed (348).
- It also survives every other committed file that calls stopCost: session-funding-parts, splash-remnant, session-close, swap-order-open, pool-swap-landing, sessions-review-fixes, sundae-orders, swap-runner, swap-page-words and lovejoin-screens-review-fixes-1-8-0. That's 10 files, 171 passed.
- Only stopCost passes `classic` (priced's callers are 1633 and 3413). The planner's 1.7.2 four-wide Stop (lovejoin-planner.test.ts:1042) has 3 strangers, where neither width has room, so it can't tell.
- The scratch r2-tests-stop-width under B3 gives 2 failed, 4 passed. 40 ₳/12: expected {boxes:3,width:3} to equal {boxes:3,width:4}. 60/20: {boxes:5,width:3} against {boxes:5,width:4}. Clean, 6 passed, three runs on the default build and three with VITE_ENABLE_MAINNET=false.
- The fee probe, clean: {boxes:3,width:4,mixes:3,mixFees:"4050000"}. Under B3: {boxes:3,mixes:3,mixFees:"2850000"}. Per box, 1.35 ₳ four-wide against 0.95 ₳.
- My floor-30 variant, /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-tests/seedelf-platform/seedelf-web-wallet/extension/tests/trace-r2-tests-stop-floor.test.ts, clean: dialog equals return at 8 boxes four-wide 10.8 ₳ (100 ₳/30), 6 boxes 8.1 ₳ (80/30) and 17 boxes 22.95 ₳ (200/60). Under B3, 3 failed: 8 three-wide 7.6 ₳, 7 three-wide 6.65 ₳ against a return of 6, and 18 three-wide 17.1 ₳ against 17. Each B3 dialog adds the line "Lovejoin's pool hasn't enough boxes free to mix four at a time, so this mixes three at a time."
- The adoption copy, /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-tests/seedelf-platform/seedelf-web-wallet/extension/tests/trace-r2-tests-adopt-chain.test.ts, is chain-review-fixes plus the two distinguishing cases, also asserting fellBack undefined. Clean, 11 passed, three runs including the preprod build. Under B3, 2 failed.

**The fix:** The proposed fix is right: pin it, no code change.
- Keep only the two cases that tell the widths apart: 40 ₳/12 and 60 ₳/20. The 30 ₳ cases, 60/12 and 40/20 all survive B3.
- Put them in chain-review-fixes' critic#4 describe and assert fellBack undefined. My adoption copy shows that file's helpers fit.
- I'd add one floor-30 case: 80 ₳ with adaStrangers(30), preprod's floor set to 30 and restored, as found-later does. It catches the mutant naming a box more than the return makes, which breaks L1's rule (stopCost's doc, 3392-3396), not only the width.
- Optionally, assert stop.mixFees equals boxes × lj.funding(…, 4).mixFees, to pin the money figure.
- The mutant it must kill is B3: `const pays = affordable(spare);` at 1832.
- An optional safeguard, not needed for 1.8.0: one capped count per width, shared by price and leg, so the two can't drift again.
- No product risk. Each case builds one real chain, about 1 to 1.4 s.

## r2-tests#1: CONFIRMED

**Reach:** Settings' Bring every box back, in two states of the retired pools' run. That's the run 1.8.0's first unlock asks of users holding classic or 8131b1d boxes.
(a) The run stopped by itself, and the user presses Try again. Under C1 the question says "Bring every box back now?", but the request is the retired pools' run alone (bringAsk gives {retired: true}).
(b) The run is going, and the user presses Settings' button, which `asks` keeps shown (BringAllBack.tsx:370). The press widens it to every pool's (bringAsk gives {}), but under C3 the question says "Bring the retired pools' boxes back now?", hiding that the v2 pools' boxes come back too.
Only the modal's title is wrong; the request is unchanged in both. Low, as claimed.

**Trace:** 1. BringAllBack.tsx:183-184 declares `bringing` and `asking`. 245: onAsk sets asking.
2. 253-263 renders BringAllBackQuestion, with 256 `retired={!!bringAsk(pool, bringing).retired}`. 444 picks the title key from it.
3. Confirm (258-261) runs ask() (213-228), which sends bringAsk(pool, bringing) (216, 220). Same function, same state, so as merged the title and the request agree.
4. bringAsk (60-61) gives {retired: true} only on Settings, for a stopped retired run. The worker's bringingView (lovejoin.ts:2280-2290) gives {back, retired: true, stopped: why} for that run, so the seeded shape is one the worker writes.
5. No committed test renders BringAllBack with asking true. The lead's test (lovejoin-retire-review-fixes.test.ts:471-489) copies the expression into its own call of BringAllBackQuestion, so it pins the title given the prop, not the wiring.
6. The e2e at extension.spec.ts:2969-2992 asks only the first press's question, with no run going. Every mutant leaves that alone. That's by reading: I ran no Playwright.

**Evidence:** - C1 and C3 each survive the 8 committed files that name BringAllBack: 203 passed (203) each. grep confirms those 8 are every committed file naming it.
- C4, r2-screens' `bringAsk(pool, undefined)`, survives them too: 203 passed.
- The scratch r2-tests-bring-question kills C1 (Expected "Bring the retired pools' boxes back now?", Received "Bring every box back now?"), C3 (the reverse), C2 and C4.
- Clean, 1 passed, three runs on each build.
- It's deterministic: a static render, no effects run, and call() never resolves.

**The fix:** No code change is needed, as the finding says. But the placement claim is wrong. The case can go in a committed file: lovejoin-screens-review-fixes-1-8-0.test.ts already has the file-wide vi.mock("react") and this exact seam (seed 125, seedInitial 131, render 140, words 156). So it needs no new file and no copied seam.
My adoption copy adds 12 lines there: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-tests/seedelf-platform/seedelf-web-wallet/extension/tests/trace-r2-tests-adopt-screens.test.ts. Clean it gives 27 passed for the whole file, three runs including the preprod build. It kills C1, C2, C3 and C4.
The mutants it must kill: C1 `retired={false}`, C3 `retired={!!bringing?.retired}`, C4 `bringAsk(pool, undefined)`, and C2 (the title ignoring `retired`). The comparison with r2-screens#0 is in that entry.

## r2-screens#0: CONFIRMED

**Reach:** Same as r2-tests#1, the same line. The claim that a static render reaches the asking state is right. The house seam seeds `bringing` (the first useState, which starts undefined) and `asking` (the first useState that starts false).

**Trace:** As in r2-tests#1: BringAllBack.tsx:256 feeds the title at :444, and :216/:220 send the request.

**Evidence:** - I copied the test unchanged to /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-tests/seedelf-platform/seedelf-web-wallet/extension/tests/trace-r2-tests-screens-bring-question.test.ts. Both copies hash to sha256 61b2e485…. BringAllBack.tsx is 42f21e61… in both sandboxes.
- Clean, 3 passed (en, es, ja), three runs on each build.
- C1, C2, C3 and C4 each give 3 failed.
- The finding's "under retired={false}, five of those files give 131 passed" is a subset. All 8 files give 203 passed under C1, C3 and C4.

**The fix:** Which to keep: r2-screens' content, placed in the house file.
- Keep from r2-screens: its five states use shapes the worker writes. That includes the going retired run {back, left, retired} and the retired pool's page with retired: true, as Lovejoin's page passes it.
- Keep its key-level expectations, such as t("settings.lovejoin.bringRetiredTitle"), so a wording change can't break a wiring test.
- Drop from r2-tests: its bringAsk asserts, which the lead's test already has.
- Drop its literal English.
- Drop its going run's `at: 1`, a field LovejoinHeld's bringing doesn't have (rpc.ts:2581-2593).
- r2-tests' positional check of the first two useStates' initials is a nice guard. But the house seam already fails loudly on the same reorderings, with "a seed after [] met a state starting …" or "(no question)".
- One language is enough: the wiring doesn't depend on language, and i18n.test.ts holds key parity. The three-language loop is harmless, about 15 ms.
- How to merge: a describe in lovejoin-screens-review-fixes-1-8-0.test.ts with a six-line question() helper. It calls seam.reset(), seed([], bringing), seedInitial(false, true), then renders BringAllBack, and carries r2-screens' five expectations. That is exactly my adoption copy, /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-tests/seedelf-platform/seedelf-web-wallet/extension/tests/trace-r2-tests-adopt-screens.test.ts.
Both tests pin behaviour (the title shown for a run state and a press). They depend on implementation only through the useState order, and they fail loudly if it changes.

## r2-tests#2: PARTLY

**Reach:** Real, and held by no committed test. But in the real wallet it's mainnet-only, and it asks for more than one Koios credential_utxos read.
- Mainnet-only: collateralWanted reads the room only where floor > 0 (sessions.ts:4876; networks.ts:56 gives preprod 0, :71 mainnet 30). So on preprod E1 is equivalent in the real wallet. The scratch reaches it by setting preprod's floor to 30, as found-later's floor test does.
- The state on mainnet: a session brought back by hand (no auto, site or mix; one the restore scan found counts, sessions.ts:1228-1230). Its account holds no 5 ₳ of ADA alone and spare that pays for a 5 ₳ box. v2's 5 ₳ pool is kept, and no room read is under POOL_ROOM_MS old (a fresh worker, or five minutes after any review).
- Under E1 every session list read then reads every pool, once per POOL_ROOM_MS. Home reads the list every 20 s while it shows (Home.tsx:427-452, whose comment says no Koios request), and dApps, Swaps, Lovejoin and the session pages read it too.
- What it asks: room() non-quiet calls rooms(), then splitAll (lovejoin.ts:7224). That runs readSet non-quiet: `pools`, then discovery.refresh, the data layer's lovejoin/pools list, at most every REFRESH_MS. Then listing and poolRows: the data layer's pool and token feeds where it's up (sw.ts gives Lovejoin `index` through spends), or Koios credential_utxos of the pools' scripts when Koios-only or the data layer is down. And WebAssembly works out ownership for every pool inside the list.
- The offer flips too. Where the read finds the pool under its floor, the 5 ₳ offer disappears. As merged, the list offers it, and Put in 5 ₳ then refuses with notNeeded, by design.

**Trace:** 1. handlers.ts:457-458 handles "sessions" with list (sessions.ts:5693-5697).
2. list calls backWantsCollateral (5707-5709), then lovejoinWantsCollateral(…, ask false) (4914-4919), then collateralWanted (4866-4902).
3. In collateralWanted: 4873 adaPool(network, false), as discovery kept it. 4874 pays. 4876 room(network, ada.id, !ask), which is quiet (lovejoin.ts:3364-3368): it answers from a read under POOL_ROOM_MS old, else undefined. So 4877-4878 find no short, and the list offers the 5 ₳.
4. E1 drops `!ask`, so room() goes non-quiet: 3365 calls rooms() (3374-3385), which reads when stale.
5. The build half: backCollateralBuild (2443) and buildBack (4598) pass ask true and read loud. E2, quiet everywhere, is caught by found-later's floor test (confirmed below).

**Evidence:** - E1 survives the 4 named files: 165 passed.
- It survives 11 more: connector-lovejoin-review-fixes, i18n-worker-reasons, lovejoin-planner, worker-words, lovejoin-1-5-0, lovejoin-merged-review, sessions, dapp, restore-scan, restore-scan-lovejoin and swap-page. 388 passed. They set a floor, list mainnet sessions or name backCollateral.
- Every committed list read comes right after a build, inside its kept read (lovejoin-found-later.test.ts:620).
- The scratch r2-tests-list-quiet under E1: `expected 1 to be +0`. E2 passes it, by design. Clean, 1 passed, three runs on each build.
- E2 against lovejoin-found-later.test.ts -t "brought back by hand": 1 failed (the floor's reason).
- My mainnet variant, /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-tests/seedelf-platform/seedelf-web-wallet/extension/tests/trace-r2-tests-list-mainnet.test.ts, uses found-later's device, a sessions.mainnet record and the shipped floor of 30. Clean, in both "data layer up" and "koios only", the list asks only for the session's account (one credential_utxos) and offers "missing". Under E1 both fail with one more credential_utxos naming the 5 ₳ pool's mix box, and the offer is gone.
- A limit of that harness: its LovejoinService has no `index` (only discovery gets the data layer), so it can't show the data-layer feeds the real wallet would read with the data layer up. That part is by code: lovejoin.ts poolRows, and sw.ts spends.index.
- Adoption copy: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-tests/seedelf-platform/seedelf-web-wallet/extension/tests/trace-r2-tests-adopt-found-later.test.ts. Clean, 38 passed, three runs including the preprod build. Under E1, 1 failed.

**The fix:** The proposed fix is right: pin it, no code change.
- Put the case in found-later's critic#1 describe; its byHand() helper builds the session. Add ADA_VIEW to the top import from ./v2-pools, not as the scratch's mid-file import. My adoption copy shows it fits.
- The guard is the request count: pool reads naming ADA_VIEW.mixBoxHash must be 0.
- Keep the backCollateral "missing" check, but as secondary. It pins a documented design (the list offers as its last read allows), and a later decision about that offer shouldn't read as a request regression.
- Optional: a mainnet twin, Koios-only with the shipped floor. It kills E1 without touching NETWORKS.
- The mutant it must kill is E1. E2 stays found-later's to catch.
- No product risk.

## r2-tests#3: PARTLY

**Reach:** The guard is real, and no committed test holds it. But both the reach and the harm are narrower than claimed.
Reach: only while discovery's own kept record can't be read (or known()'s write of `shown` fails) and the sealed schedule still reads. Both live in chrome.storage.local (sw.ts:149, 184, 237), so a failure of storage as a whole fails the schedule read first, and no row shows at all. It also needs a worker life with no successful pool read yet: readSet falls back to `handed` (lovejoin.ts:2816-2823), which only a non-quiet read fills. Then status() and chains() both lack the v2 pool.
Harm: the line I1 drops ("Mix my boxes again mixes the boxes it didn't", Lovejoin.tsx:973) names an action that isn't available in that window. The pool's page isn't listed, since status lists only its read set. Mix my boxes again is refused by poolNamed (lovejoin.ts:3016): "That pool isn't one the wallet reads. Open Lovejoin again so it looks for pools, then try again." The next good read decides the pool (v2, so not retired), and then both trees say the same. So the finding's "though Mix again works there" is true only once the failure clears, when the mutant no longer differs.

**Trace:** 1. rows(), lovejoin.ts:6368-6391. 6371 reads the set only for a stopped chain in a non-classic pool. 6372: old(p) is true for the classic pool, or a pool in the set that's retired. 6386 marks retired only where every pool is old.
2. chains() (6245) calls readSet(quiet). 2820-2821 asks `known`, which is serviceDeps' known, i.e. discovery.known (lovejoin-pools.ts:627, 637; 294-313). That calls kept (364-366) and local.get. On failure, .catch(kept) returns handed.get(network) ?? [].
3. status() (6202) builds rows from ours()' reads. ours() runs readSet non-quiet, which calls `pools` (lovejoin-pools.ts:630-635); that reads the same record and falls back the same way.
4. I1 adds `!read.some(q => q.id === p)`, so a pool the set lacks counts as retired. 6386 then sets `retired`, and Lovejoin.tsx:973 shows lovejoin.detail.whyStopped.

**Evidence:** - I1 survives the 9 named files: 191 passed.
- It survives 12 more that hold stopped chains or retired pools: lovejoin-stopped-before, lovejoin-restore, lovejoin-crediting-review-fixes, lovejoin-merged-review, lovejoin-bring-all-back, lovejoin-bring-review-fixes, lovejoin-pools, lovejoin-release-rules, restore-scan-lovejoin, lovejoin-form-review-fixes, lovejoin-accounts and lovejoin. 313 passed.
- The scratch r2-tests-chain-undecided under I1: `expected [ true ] to deeply equal [ undefined ]`. Clean, 1 passed, three runs on each build.
- The scratch models the failure through `pools`, with no `known` (chain-fixtures' lovejoinOf). The real chains() asks `known`.
- My variant /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-tests/seedelf-platform/seedelf-web-wallet/extension/tests/trace-r2-tests-chain-undecided-known.test.ts makes both `pools` and `known` throw, as sw.ts's serviceDeps would, since both read the same record. Clean: chains() leaves the row undecided; status() lists no v2 pool and leaves the row undecided; againBoxes(ADA) is refused with lj.poolUnknown. I1 kills it at chains().
- /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-tests/seedelf-platform/seedelf-web-wallet/extension/tests/trace-r2-tests-chain-undecided-status.test.ts checks status() first; I1 kills it at status().
- Adopted into W8's file (trace-r2-tests-adopt-screens.test.ts): clean, 27 passed. Under I1, 1 failed.

**The fix:** The pin is cheap (about 250 ms) and keeps rows() in step with R3's retiredIds rule, where undecided means "said as before". Adding it to W8's describe is fine, but it's the lowest-value of the four.
- Give it `known` throwing too (the real quiet path), or both, as my variant does.
- Don't describe it as protecting a working action.
- No code change. The mutant it must kill is I1.
- One could argue for I1's behaviour during the failure (say only why it stopped, since Mix again is refused then). That's a design call, not a bug, and R3 chose "as before".

*Notes (r2-tests#0, r2-tests#1, r2-screens#0, r2-tests#2, r2-tests#3):* Tree: the sandbox worktree at 4b4628e9. After every run, `git diff --quiet` is clean and sessions.ts, lovejoin.ts and BringAllBack.tsx match their pristine sha256s.

Untracked files: only the reviewer's scratch files and mine. I didn't edit the reviewer's scratch tests. The r2-screens test was copied unchanged under my label; its own sandbox was only read.

Runner and results:
- Runner: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-tests/trace-r2-tests/trace-mutate.py
- Specs: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-tests/trace-r2-tests/specs (main, second, third, fourth, fifth). The mutants' exact strings are taken from the reviewer's specs, and each was checked to occur exactly once.
- Results: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-tests/trace-r2-tests/main.jsonl and /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-tests/trace-r2-tests/second.jsonl
- Logs: /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-tests/trace-r2-tests/logs

My test files are in /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/8420b6d7-4a5c-4f2d-934b-2d1b5eec9799/scratchpad/r2/r2-tests/seedelf-platform/seedelf-web-wallet/extension/tests:
- adoption copies: trace-r2-tests-adopt-chain, -adopt-screens and -adopt-found-later
- variants: trace-r2-tests-stop-floor, -list-mainnet, -chain-undecided-known and -chain-undecided-status
- the unchanged r2-screens copy: trace-r2-tests-screens-bring-question

Clean runs:
- The five reviewer scratch files plus the r2-screens copy: 12 passed, three runs on the default build and three with VITE_ENABLE_MAINNET=false.
- My eight files: 86 passed, twice on the default build and once with mainnet off.

Summary:
- All four findings are real test gaps, and every mutant is non-equivalent.
- r2-tests#0 reaches mainnet past its floor, where the mutant also miscounts boxes.
- r2-tests#1 and r2-screens#0 are the same line. Keep r2-screens' cases, but put them in lovejoin-screens-review-fixes-1-8-0.test.ts, which already has the seam, rather than a new file.
- r2-tests#2 is mainnet-only. There it would read every 5 minutes while Home shows, and with the data layer up its reads go to the data layer, not only Koios.
- r2-tests#3 is narrow: only a failure of discovery's own record, in a window where Mix again is refused anyway.

Not done:
- No Playwright. My e2e judgements are by reading extension.spec.ts:2969-2992.
- Not the whole suite. The committed sets were 8 to 21 files per mutant, all with --maxWorkers=2.
- The data-layer half of r2-tests#2 on mainnet is traced by code only: the test harness gives Lovejoin no data layer.
- No markdown report written; this structured output is the report.
