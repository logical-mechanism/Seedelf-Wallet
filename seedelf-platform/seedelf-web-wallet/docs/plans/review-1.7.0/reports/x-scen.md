# x-scen: end-to-end walks of the flows 1.7.0 changed

Lens: cross-PR scenarios over `babb8e76..6bca8bec` (#325 to #338), on HEAD `6bca8bec`.

## Summary

I walked four flows through the worker's state, the screens and the money:

1. A return held at its collateral's mix, and *Bring the rest back now* (#337).
2. A private Bootstrap at 6,465 lovelace a byte (#333).
3. A payment in parts and its *Transaction details* stepper (#335).
4. A new token pool from the data layer, confirmed by Koios (#336).

**No money is lost or locked, and no flow gets stuck, on any path I walked.**

- **Flow 1.** The skip's state machine holds together in every variant:
  - **Case A**, the chain still being sent: `witnessTail` reads `tailIsOver` before it asks giveme.my.
  - **Case B**, the chain cut or refused and its mix to be built again: `tailBuildable`.
  - **A lock and unlock in between:** `cuts`, `markCut`, then the unlock wait. A user's "asked" step skips it.
  - **giveme.my signing as the button is pressed:** the mix and the return still go. The record ends with `tail.over` and `tail.scheduled` both set, which is harmless.
  - **A site's session:** `advance` is a no-op, and *Bring it back* then builds a direct return.
  - **Mix my boxes again on the unmixed 5 ₳ box:** `againBoxes`, then `fanOut` takes the box first, and the new session's own tail never draws a box the chain spends (`spent_by`).
- **Flow 2.** The reserve is priced the same way in all six places:
  - the form (`privateBootstrapBounds`, then `bootstrapLimits`);
  - the review (`bootstrapReserve`);
  - the funding (`mixFunding`);
  - the deposit and its sweep back (`buildBack`, `chain` at depth 0);
  - the cap (`bootstrap_most`).

  Core's and Vitest's tests hold it at 6,465.
- **Flow 3.** The stepper finds every part under `partKey`, and asks Koios nothing.
- **Flow 4.** `confirmed()` keeps an unconfirmed pool out, both with Koios down and with Koios-only switched on midway. Kept pools survive a Koios outage.

**What I found** is small: one real race on the skip (a press can be lost), two pieces of misleading text on the new way out, two stale docs (flows.md's Bootstrap paragraph, which #333 left contradicting the code, and architecture.md with lovejoin-pools.ts's header, which #336 left behind), privacy.md silent on the new way out, a test gap, and two nits.

## Coverage

**Read on HEAD:**
- Every source diff of #330, #332, #333, #335, #336 and #337, and their tests and PR descriptions.
- **Flow 1, worker side:**
  - `sessions.ts`: `advance`, `step`, `act`, `waits`, `bringBack`, `buildBack`, `sendChain`, `pump`, `sendStep`, `witnessTail`, `skipCollateralMix`, `views`/`one`/`view`, `tailReserve`, `mixFunding`, `mixOutBuild`, `againBuild`, `stopCost`.
  - `lovejoin.ts`: the `ChainRecord`/`Tail` types, `tailWaits`, `tailBuildable`, `tailBoxes`, `mayLand`, `makers`, `unmixedOf`, `restOnly`, `carriedOf`, `shown`, `pumpChain`, `tailOf`, `tailChain`, `tailWitness`, `tailLanded`, `tailHeld`, `tailIsOver`, `tailOver`, `recordChain`, `chainSent`, `chainEnded`, `sortOut`, `unschedule`, `scheduleFound`, `moreThanDue`, `held`, `againBoxes`, `funding`, `chain`/`fanOut`, `collateralPool`, `collateralPoolTakes`, `privateBootstrapMost`/`Bounds`, `update`.
  - WASM: `buildSessionReturn`, `plan_return`, and the chain's `CollateralTail` with `spent_by`.
- **Flow 1, screens:** Swaps.tsx (`Session`, `Timeline`, `stoppable`), SiteSessions.tsx (`SiteSession`), Dapps.tsx (no poll), Lovejoin.tsx (`MixList`/`MixCard`/`mixItems`, `Chains`), `LovejoinReturn.tsx` (`CollateralHeldWayOut`, `chainText`, `useSessionsWhile`, `LovejoinSwitch`), Home.tsx's `InLovejoin`.
- **Flow 2:**
  - Core's `bootstrap_back_reserve`/`bootstrap_most`, and `ProtocolParameters::from_koios` (its bounds).
  - `linear_fee` and the min UTxO.
  - The `bootstrapLimits` form and its effect.
- **Flow 3:** `tx-view.ts`, `TxDetail.tsx`, `parts.ts`, `script-spend.ts`'s `keepParts` and `send`, `pending.ts`'s `submitWatched`, Transfer.tsx's send.
- **Flow 4:** `lovejoin-pools.ts` in full, and the data layer's L rule (`seedelf-data/api/src/lovejoin/standard.rs`, read only).
- **Docs:** flows.md, architecture.md, privacy.md, privacy-policy.md and the en.json keys, for each flow.

**Ran:** one scratch Vitest (`tests/zz-review-x-scen-1.test.ts`, real WebAssembly, harness copied from `lovejoin-planner.test.ts`), now deleted. It passed every assertion:
- For a site's session stopped at its collateral's mix because giveme.my refused (Case B), the view carries `collateralHeld` (offerAt = landed + 1 h).
- After the hour (moved back in the record), the mix's rebuild is built, then `skipCollateralMix` marks the old tail over, then the rebuild is sent. The new chain's tail isn't over (tries 2), it waits for giveme.my again, and the view offers the way out again.

## Findings

### 1. low: a skip that lands while the runner rebuilds the collateral's mix is lost

- **Category:** correctness. **Confidence:** medium (the mechanism is shown by test; the runner's timing is from reading).
- **Files:** `extension/src/background/sessions.ts:5526-5537`, `extension/src/background/lovejoin.ts:4127-4133`, `lovejoin.ts:4997-5001`, `sessions.ts:4387`.

**Claim.** `skipCollateralMix` reads `tailHeld` and writes `tailOver` outside the sessions queue (`serial`). The runner's step rebuilds a stopped chain's collateral's mix inside the queue, from `buildBack` → `tailChain` (which found the tail not over) to `recordChain`, whose hand-over is skipped when the predecessor's tail is already over (`if (was && !was.over)`). A skip that lands between the two is lost:
- the old chain is marked over;
- the rebuilt chain keeps a tail of its own (tries 2, its `landed` carried over), which waits for giveme.my again;
- the page shows the button again.

**Scenario.**
1. An auto swap's return stops at its collateral's mix: a lock cut it, or giveme.my refused it past `GIVEME_BEHIND_MS`. The hour since its deposit landed has passed, so the swap page shows *Bring the rest back now*.
2. The unlock wait ends, and the alarm's run, or the page's own `session-advance` poll, enters `act` → `bringBack` → `buildBack` → `tailChain`, which reads the 5 ₳ pool and builds in WebAssembly: a few seconds.
3. The user presses the button in that window. `tailOver(old)` is written. `recordChain` then sees `was.over` and doesn't hand over, and the new chain's tail is live.
4. Skip's `advance` waits for the queue, then pumps the new chain, which asks giveme.my again. The returned view has `collateralHeld` again (offerAt already past).

The press did nothing. The user has to press again, and meanwhile the return keeps waiting for giveme.my.

**Evidence.**
```ts
// sessions.ts:5526
async skipCollateralMix(network, index) {
  const held = await this.deps.lovejoin?.tailHeld(network, index);   // outside serial
  if (held && this.deps.now() >= held.offerAt) {
    await this.deps.lovejoin!.tailOver(network, held.id);
    ...
  return this.advance(network, index, true);                          // serial

// lovejoin.ts:4998
const was = resumes ? s.chains.find((c) => c.id === resumes)?.tail : undefined;
if (was && !was.over) { was.over = true; handedOn = true; }
```
The scratch test (build the rebuild, then skip, then send it) ends with the new chain's `tail.over` undefined, `tries` 2, and `view.collateralHeld` defined.

**Fix.** Run the skip's check-and-set in the queue: `this.serial(async () => { tailHeld; tailOver; pump; step("asked"); return one(); })`. Call `pump`, `step` and `one` directly: `serial` isn't reentrant. Then a rebuild either finishes first, and the skip marks the new chain over, or it finds the tail over and builds a plain return.

**Test.** A Case B auto mix session. Wrap `lj.tailChain` so `lj.tailOver(old)` runs after it returns, as a skip landing there would, then `runAll`. The new chain must not wait for giveme.my, and `collateralHeld` must be gone. This fails on HEAD and passes with the skip serialized.

### 2. low: for a session brought back by hand, the way out doesn't bring the rest back, and the Lovejoin page says it did

- **Category:** ux. **Confidence:** high.
- **Files:** `extension/src/i18n/translations/en.json:920`, `extension/src/ui/screens/Lovejoin.tsx:965`, `Lovejoin.tsx:2535`, `extension/src/background/sessions.ts:3446`, `sessions.ts:5144`.

**Claim.** On a site's session, or a swap from before swaps ran themselves:
- *Bring the rest back now* only ends the wait. `advance`'s `step` returns at once for a session that isn't running, and the rest stays at the one-time account until *Bring it back* and Send.
- Yet the chain's stop reason is `lj.tail.skipped`: "You brought the rest back without waiting for the collateral's mix, so the chain stopped there." The Lovejoin page shows it under Chains, and in Your mixes once the chain leaves Chains, while nothing has come back.

**Scenario.** A site's session's return waits at its collateral's mix for an hour. On the site's page the user presses *Bring the rest back now*. The site's page now says "Stopped after N of M transactions; the rest stays at the account until you bring it back", which is right. The Lovejoin page says "Why it stopped: You brought the rest back without waiting for the collateral's mix, so the chain stopped there. Mix my boxes again mixes the boxes it didn't." A user reading Lovejoin's page takes the money as back in the private balance, and it isn't. It stays at the session's account until they bring it back.

**Evidence.**
- `step`, sessions.ts:3446: `if (!s || !running(s)) return;`
- witnessTail: `throw new Error(t("lj.tail.skipped"))`
- Lovejoin.tsx:965: `tr("lovejoin.chains.whyStopped", { why: withoutStop(c.stopped) })`
- The PR's own test (`lovejoin-planner.test.ts:1814-1825`) shows nothing sent after the skip: the rest needs a separate `backBuild`.

**Fix.** Word the reason for what happened: "You chose not to wait for the collateral's mix, so the chain stopped there." That's true for both kinds of session. On a by-hand page, the button could go on to build the return's review, as *Bring it back* does, so it does what it says. Or keep the label and let the site's page's own line carry the next step.

**Test.** Render `Chains` with a chain stopped by `lj.tail.skipped` for a by-hand session that still holds its rest: the words mustn't say the rest came back.

### 3. low: the way out's note says the mix "is still waiting for giveme.my" when it isn't

- **Category:** ux. **Confidence:** high.
- **Files:** `extension/src/i18n/translations/en.json:922`, `extension/src/background/lovejoin.ts:4127-4133`, `lovejoin.ts:1334-1341`.

**Claim.** `tailHeld` offers the way out in Case B too: the chain is no longer being sent, and the mix is to be built again (`tailBuildable`). It may be waiting:
- after a lock cut, for the runner's unlock wait or a by-hand *Bring it back*;
- after giveme.my refused it past its wait;
- for a 5 ₳ pool that can't be read, or has too few free boxes (TailWait `noPool`/`fewBoxes`).

The critical note's first sentence still reads "The collateral's mix is still waiting for giveme.my."

**Scenario.** giveme.my refuses the mix past 3 minutes, and the chain stops with "giveme.my wouldn't back the collateral's mix, so the chain stopped there." An hour after the deposit, the site's page offers the way out under "The collateral's mix is still waiting for giveme.my…". The scratch test confirms `collateralHeld` is set in exactly that state.

**Evidence.** `if (!tailWaits(c) && !tailBuildable(c, this.deps.now())) return undefined;` offers Case B. The en.json:922 value starts "The collateral's mix is still waiting for giveme.my."

**Fix.** "The collateral's mix hasn't gone yet." is true in every state that offers it, and keeps the rest of the note. It's a critical key, so the change needs a new blind back-translation for es and ja.

**Test.** None needed beyond the critical-set checks.

### 4. low: flows.md's Bootstrap paragraph still describes the fixed reserve #333 replaced

- **Category:** docs. **Confidence:** high.
- **Files:** `docs/flows.md:523`.

**Claim.** #333 changed only "3 ₳ of reserves" to "3 ₳ of reserves at today's prices" in this paragraph. It still says the payment carries "1.5 ₳ for returning the rest", and that the cap is "one deposit's most under today's fees (68 in the classic pool at 6,465 lovelace a byte, half as much again as today's)". It also says the review's *For returning the rest* row reads 1.5 ₳. Since #333 the way back's reserve is priced from the parameters (1.8 ₳ at 6,465), and the cap there is one deposit's most: 96.

**Scenario.** Someone checks the 6,465-lovelace case against flows.md. It says 68 boxes and 1.5 ₳. The wallet offers 96 boxes, and the review shows 1.8 ₳ *For returning the rest*.

**Evidence.**
- flows.md:523: "1.5 ₳ for returning the rest … (68 in the classic pool at 6,465 lovelace a byte, half as much again as today's)".
- `lovejoin-flows.test.ts:507`: `expect(await lj.privateBootstrapBounds("preprod")).toEqual({ most: 96, back: "1800000" })`.
- `lovejoin_pools_test.rs:1809`: `bootstrap_most(&dear, &classic, true, 96) == 96`.
- architecture.md was updated correctly: "1.8 ₳ at 6,465 … where a fixed 1.5 ₳ held it to 68".

**Fix.** Say the way back's reserve is priced from the network's parameters (1.5 ₳ today, never less), so one deposit's most goes at a dearer byte too. Drop the 68. The review row is the same priced figure. privacy.md:198's "1.5 ₳ for its way back" can take "today" the same way.

### 5. low: architecture.md and lovejoin-pools.ts's header still say a listed pool's existence is the server's word and the ledger's

- **Category:** docs. **Confidence:** high.
- **Files:** `docs/architecture.md:732`, `extension/src/background/lovejoin-pools.ts:31-36`.

**Claim.** #336 confirms every pool on the data layer's list that's new to the device from Koios before it's kept: the launch's `tx_info`, and L's registration. It updated privacy.md and the policy, but not architecture.md or the module's header comment. Both still describe the old trust.

**Scenario.** A maintainer reasoning about a lying server or a rollback reads architecture.md, which says a listed pool's existence is the ledger's to judge and its finishing is the server's word. The code no longer takes either on the server's word for a new pool.

**Evidence.**
- architecture.md:732: "that it's finished, and where its launch sits, which the earliest is worked out from, are the server's word (below). Whether a pool is on chain at all is the ledger's to judge, not the server's".
- lovejoin-pools.ts:34: "so the ledger is the judge of that".
- `refresh` → `keep(network, await this.confirmed(network, found))`.

**Fix.** Say a pool new to the device is kept only once Koios finds it as its holder look would (`confirmed`, then `launched`). Only its launch position stays the server's word. The ledger's check still stands behind it.

### 6. low: privacy.md doesn't mention the new way out of a held collateral mix

- **Category:** docs. **Confidence:** high.
- **Files:** `docs/privacy.md:217`.

**Claim.** The privacy design doc says the collateral's box waits unmixed and tied to the session only "past that, or a day after the deposit landed". Since #337, the user can choose that an hour after the deposit (*Bring the rest back now*), and *Bring every box back now* then takes the box unmixed. #337 updated flows.md and architecture.md, not privacy.md. The policy needs nothing, since no data handling changed.

**Scenario.** Someone checks privacy.md for when a session's 5 ₳ box can be left unmixed and tied to the session. It names a refusal, a lock or a day, never the user's own choice after an hour.

**Evidence.** `grep "Bring the rest back" docs/privacy.md` finds nothing. Line 217 reads "past that, or a day after the deposit landed, the box waits not mixed yet, tied to the session".

**Fix.** Add one clause: or, from an hour after its deposit landed, on the user's word (*Bring the rest back now*), the box waits the same way, tied to the session until mixed again.

### 7. low: the new way out has one worker test, for a session brought back by hand

- **Category:** tests. **Confidence:** high.
- **Files:** `extension/tests/lovejoin-planner.test.ts:1791-1828`, `extension/tests/collateral-held.test.ts`.

**Claim.** The only worker test is a by-hand site's session whose chain is still being sent (Case A). Nothing tests:
- an auto swap or a mix, where the skip's `advance` must send the direct return at once;
- Case B, a stopped or cut chain whose mix is to be built again;
- the three pages that place `CollateralHeldWayOut`: Swaps (auto and by hand), SiteSessions, and the MixCard with `onSkipCollateral`.

**Scenario.** If `skipCollateralMix` stopped calling `advance`, or the MixCard's condition went wrong, an auto swap's rest would wait after the press, or a mix's card would show no button, and no test would fail.

**Evidence.** `grep -rln "collateralHeld|skipCollateralMix|collateral-held|TAIL_OFFER_MS" tests e2e` finds only `lovejoin-planner.test.ts` and `collateral-held.test.ts`.

**Fix.** Add a worker test for an auto mix session: skip after the hour, then assert the return is submitted in the same call. Add the Case B view test above. Add a render of `MixList` with a mix session carrying `collateralHeld`.

### 8. nit: on a page that doesn't poll, the button appears only after a Refresh once its hour comes

- **Category:** ux. **Confidence:** high.
- **Files:** `extension/src/ui/components/LovejoinReturn.tsx:539-549`, `extension/src/ui/screens/SiteSessions.tsx:411`, `extension/src/ui/screens/Dapps.tsx:233-247`.

**Claim.** `CollateralHeldWayOut` reads `now = Date.now()` as it renders. The site's session page and a by-hand swap's page have no timer of their own: Dapps.tsx re-reads only on Refresh. Left open across the hour, they never show the button. The auto swap page polls, and so does the Lovejoin hub.

**Scenario.** The user opens the site's page at 59 minutes and waits. Nothing appears until they press Refresh.

**Fix.** Re-render at `offerAt` (a timeout in the component), or poll the site's page while its chain is held.

### 9. nit: after a payment's Send fails partway, the stepper opens no part at all

- **Category:** ux. **Confidence:** high.
- **Files:** `extension/src/background/pending.ts:521-525`, `extension/src/background/tx-view.ts:150-162`.

**Claim.**
- `submitWatched` removes the kept record when the first part's submit succeeds, and that record is the one carrying `partHashes`.
- If a later part then fails, the review stays on screen with `worker.parts.partly`.
- The stepper now finds no part: the first and the sent are gone, and those still kept under `partKey` can't be found without `partHashes`.
- Each says "That transaction isn't one the wallet is holding. Review it again."

**Scenario.** Send privately with Max over 40 UTxOs. Part 2 is refused, and the review shows "1 of 3 transactions went…". Transaction details then says every part, including part 3, which is still kept, isn't held.

**Fix.** Leave it, since the error asks for a new review anyway. Or keep `partHashes` with each kept part, so a part still kept is still found.

## Not checked

- **The runner's timing in finding 1 under real load.** I showed the interleaving's outcome by building, skipping, then sending. I didn't drive an auto session through `runAll` with an injected delay.
- **A pre-existing, possible shift of a leaf's due time.** In `sortOut`, `unschedule` runs for every pool read, not only the chain's own. It counts an unmixed collateral box, which never had a due time, against the 5 ₳ pool's due times. With another session's collateral leaf in flight, that could drop that leaf's due time, which `scheduleFound` later redraws from Settings' delay. That's a timing change only, and pre-existing (1.6.0). 1.7.0's skip makes such a box routine. Not proven by test.
- **Live preprod and e2e.** No live run (forbidden), no e2e, and no screenshots of the new button and stepper.
- **The es and ja wording** of the three new #337 keys and the three #335 keys. That's the i18n lenses' area.
- **Overflow under #332:** the parameters are bounded in `from_koios`, so I didn't test `bootstrap_back_reserve`'s sums further. The x-overflow lens covers it.

## CLI notes

None. #333 changed core's `bootstrap_back_reserve`/`bootstrap_most`, which only the WebAssembly calls. #332's profile is `wasm-release` only.
