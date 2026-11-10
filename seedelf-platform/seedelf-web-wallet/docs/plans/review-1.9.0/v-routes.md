# 1.9.0's release review: the v-routes verifier

The verification, told to refute. Verbatim from its structured report; full addresses of third parties shortened.

## Coverage

Read at 8d7c4b0c: COMMON.md, claims-routes.md; minswap.ts:1-460 (DIRECT_PROTOCOLS, the preprod lists, MAINNET_PROTOCOLS, outOfPlace, MINSWAP_PROTOCOLS, excludedProtocols, uncheckedProtocols, estimate/buildTx/request, refusalOf, routed); sessions.ts routeOf (871-889), quote (1576-1616), swapBuild (3160-3197), order (4120-4161), step (3621-3661), retryAfterMs/retryReasonOf (261-294), running (1254), directSpends (6703-6745); Swaps.tsx's quote error (687-760, 968) and retry line (3032-3055, 3216-3232); sw.ts:232-233; networks.ts; en.json strings. Compared minswap.ts and sessions.ts with web-wallet/1.8.1 (git diff, git show). Also read PR #375's body (gh pr view, read-only), backlog.md:111, architecture.md:660-669, chunk-47's plan, swap-routes.test.ts, swap-session.ts, fakes.ts fakeMinswap, splash-remnant.test.ts's helpers, direct-swaps.test.ts, and the mutants lane's z6/z7/z8/baseline logs and mutate.py.

Ran, in my own worktree at 8d7c4b0c (removed afterwards; the main tree is untouched at 8d7c4b0c):
- `npx vitest run tests/v-reask-400.test.ts` and `tests/v-reask-404.test.ts`, with V_ROUTES_MODE=190, with 181 (routeOf reverted to `const avoid = outOfPlace(first)`), and with fix and fix b applied.
- `npx tsc --noEmit -p .` and 18 swap-related test files, with each fix applied.
- The full suite with z6 and z7 applied together (`npx vitest run` under systemd-run MemoryMax=8G).
- Two pins, each on the clean tree and under z6, z7 and z8.

Live: 3 mainnet `estimate` calls with minswap.ts's body (estimate.sh). None on preprod: the budget went to routes#1's trigger.

Not done:
- I didn't open docs.minswap.org (it isn't on COMMON.md's network list). So "one Protocol enum serves both fields" and "19 documented" rest on minswap.ts's comments (128-131, 284-286) and the PR body.
- I couldn't learn the 4 accepted names the wallet doesn't know.
- No visual check of the 1,275-character text on the swap page, and no Playwright run.

Side notes, outside the claims:
- (a) Mainnet's router ignores `exclude_protocols` for "Minswap" (V1) (calls c1 and c2). That's harmless here: the wallet only ever leaves V1 out through outOfPlace, and the designed refusal in its own words follows.
- (b) architecture.md:660's cost line still names routeOf's third Minswap request only for outOfPlace ("one in a path of more than one leg, or Danogo beside another DEX"), not for #375's DEX the wallet doesn't check. This is a docs nit.

## Verdicts

### routes#1: confirmed, low (confirmed-by-run)

**Why.** **The mechanism holds, end to end, by run.**
- On mainnet, routeOf puts every path protocol off MAINNET_PROTOCOLS into the second estimate's exclude_protocols, and nothing checks those names.
- Minswap's validator answers a name it refuses with FST_ERR_VALIDATION. refusalOf keeps a JSON message whole, and no trouble code matches it, so step() takes it for a transient failure: a retry with reason 'other', 30 s doubling to 5 min, uncapped. running() keeps stepping a retrying swap, while a paused one stops.
- Swaps.tsx shows the raw error for 'other', in the quote, in Review it myself and in the retry line (aria-live).
- Under 1.8.1's routeOf the same scenario refuses the quote and pauses the runner in the wallet's words, which is also what architecture.md:669 states as the design ("the runner's fresh estimate pauses as refused"). The comparison is with 1.8.1's code: live 1.8.1 failed every quote on ChakraBondingCurve (#375's "Why").
- Stop brings it back. No money is at risk.

**No trigger is shown.**
- In 3 more live calls the router named only accepted names. I found no route through ChakraBondingCurve, or through any name the validator refuses.
- Minswap's lists do drift: its docs differ from its validator (per the code and the PR), and its router ignores an accepted exclusion of "Minswap" (calls c1, c2). A path-versus-validator mismatch is possible, but unproven.

**A neighbouring path is likelier.** It's the same degradation, with short words:
- When the second ask leaves out the only DEX Minswap found, Minswap answers 404 `{"error":"QuoteNotFoundError","message":"Quote not found."}` (live, call c3).
- So a pair whose only route goes through one of the 4 accepted names the wallet doesn't know quotes as "Minswap refused it (404): Quote not found.", where 1.8.1 said "…routes this swap through X, which the wallet can't check yet".
- A funded runner on such a route retries rather than pauses.

**Grade: low.** It's an edge case and misleading text. The quote is refused either way and only the words differ; the runner's retry costs 2 Minswap estimates and a Koios read per try, with no new data.

**Evidence.** **Code at 8d7c4b0c.**
- sessions.ts:884-886: `const first = await minswap.estimate(ask); const avoid = [...new Set([...outOfPlace(first), ...uncheckedProtocols(network, first)])]; const est = avoid.length ? await minswap.estimate(ask, avoid) : first;`
- At 1.8.1, sessions.ts:882: `const avoid = outOfPlace(first);`
- minswap.ts:340: `filter((p) => !MAINNET_PROTOCOLS.includes(p))`
- minswap.ts:407-412: 429 aside, `MinswapError(t("minswap.refused", {status, why}), FUNDING_UNSEEN.test(why) ? "funding-unseen" : BUILD_FAILED.test(why) ? "build-failed" : undefined, cbor)`
- minswap.ts:433: `why: said === undefined ? words.slice(0, 300) : words`
- sessions.ts:290-293: `return "other"`
- sessions.ts:3650-3657: Refused pauses, anything else gets `auto.retry = { at: at + retryAfterMs(tries), … reason: retryReasonOf(e) …}`
- sessions.ts:275: `Math.min(30_000 * 2 ** (tries - 1), 5 * 60_000)`
- sessions.ts:1255: `!s.auto.paused`
- Swaps.tsx:3049: `reason === "other" ? error : …`
- Swaps.tsx:968: `error={error ?? quoteError}`

**Runs** (v-reask-400.test.ts, the live est2 shape, measured at 1,249 chars and 23 constants):
- 190, the quote: `"Minswap refused it (400): body/exclude_protocols/1 must be equal to constant, …" length 1275; estimate 2`.
- 190, the runner: `retry#1 reason=other in 30s | #2 60s | #3 120s | #4 240s | #5 300s | #6 300s | #7 300s; {"estimate":14,"refused":7,"build":0}`, never paused. Review it myself gives `Minswap refused it (400): …`. Stop gives `["out","back"]`.
- 181: the quote says `Minswap routes this swap through ChakraBondingCurve, which the wallet can't check yet…` after 1 estimate. The runner shows `paused {"why":"refused","detail":"Minswap now routes it through ChakraBondingCurve, whose orders the wallet can't check yet."}`. A name the validator takes (SomeNewDex) is refused at 181 but routed (MinswapV2) at 190: #375's gain.
- 404 neighbour (v-reask-404.test.ts): at 190 the quote says `Minswap refused it (404): Quote not found.` and the runner shows `retry {reason:"other"}`. At 181 the quote is refused in the wallet's words and the runner paused.

**Live** (estimate.sh, the body minswap.ts sends):
- c1, mainnet ADA→MIN 100 ₳, all 19 MINSWAP_PROTOCOLS excluded: 200, route ['Minswap'], amount_out 6707199726, pool c1353e2d…#0, the same answer as the routes lane's est1.
- c2, the wallet's mainnet 7 plus "Minswap": 200, the same Minswap V1 route.
- c3, USDR→sUSDR, the wallet's 7 plus SundaeSwapV4: 404 QuoteNotFoundError.

**Documented.** The general failure is known and in the backlog, but not this path.
- backlog.md:111: "⬜ **A DEX name Minswap stops taking fails every swap's quote** (ChakraBondingCurve, 2026-11-09). Its 400 gives the name's index, so a retry without that name would survive the next one." That's about a name in the wallet's own list, which fails the first ask.
- PR #375's body: "if that name goes too, quotes fail the same way. It's in the backlog as a retry that drops a refused name". It also says "A route still through one after that is refused as before", which assumes the second ask answers.
- architecture.md:665 says the same ("routeOf asks once more without it … and a route still through one is refused"). architecture.md:669 states the runner pauses.
- Nowhere does any doc state that routeOf's second ask can be refused (400 or 404), or accept a retry in its place.

**The fix.** **The finder's fix is right and safe**, tested in my worktree (fix-routes1.diff): a `name-refused` trouble code on `/exclude_protocols\/\d+ must be equal to constant/`, and routeOf keeps `first` when its second ask fails with it.
- The quote and Review it myself say "…routes this swap through ChakraBondingCurve, which the wallet can't check yet…", the runner pauses with nowRoutes, Stop works, and a name the validator takes is still routed around.
- 18 swap-related test files pass (373 tests), and tsc is clean.
- It needs `"name-refused": "other"` in sessions.ts's `MINSWAP_REASON` Record, or tsc fails.
- It refuses nothing new: the route already fails, and the refusal is the existing MAINNET_PROTOCOLS check. It makes no extra request (the backlog's re-ask without the name would only fetch the same route again), so it needs no privacy-policy entry.
- Matching Minswap's words fails safe, back to today's behaviour.

**Broaden it to the 404**, which is likelier: a `no-route` code for status 404 with `/^quote not found\.?$/i`, kept the same way (fix-routes1b.diff). The 404 probe then matches 1.8.1, the 400 probe passes, the 18 files pass (373 tests) and tsc exits 0.

Keep 429, silence and 5xx throwing, so the runner still retries real outages. One trade-off: a pause waits for the user's Try again, where today's retry would resume by itself once Minswap routes elsewhere. The documented design (architecture.md:669) is the pause, so the fix matches it.

### routes#2: partly, none (traced)

**Why.** **What holds, by trace.**
- On preprod uncheckedProtocols is [], and outOfPlace catches only legs and Danogo beside another DEX. So a single-leg route through a pool-swapping DEX that isn't excluded is quoted and funded.
- The runner's build then pauses at directSpends ('it spends something that isn't this session's'), and Stop costs the return's fee on top of the funding's, in test ADA.

**This is the owner's stated, accepted trade-off, and not new in 1.9.0.** 1.8.1's preprod list left out only 4 names, so CswapV1, VyFinance, MuesliSwap, SundaeSwapStable and WingRidersStableV1 were already routable there with only the session's check. The one change is that ChakraBondingCurve can't be named any more. Minswap's API refuses that name on preprod too (PR body), so excluding it was never an option.

**Parts overreach.**
- "ChakraBondingCurve under that name" needs Minswap's preprod router to name a DEX its own validator refuses: routes#1's unseen trigger.
- The "4 live names" were counted on mainnet's validator, and none is known to swap against its pools.
- "On mainnet, routeOf asks again … and works whenever the validator takes its name" isn't quite right. Live, the router kept routing through Minswap V1 though the name was accepted and excluded (c1, c2). When that happens the second route still names the DEX and the quote is refused in the wallet's words, the designed fallback. When exclusion leaves nothing, it's routes#1's 404 neighbour.

**Reachability today: not shown.** Every saved preprod answer routes through MinswapV2, and I made no preprod call. It's preprod only, with test funds.

**Evidence.** - minswap.ts:133: `export const DIRECT_PROTOCOLS = ["OpenDjedV1"];`
- minswap.ts:325: `if (network === "preprod") return [...DIRECT_PROTOCOLS, ...PREPROD_BROKEN, ...PREPROD_NOT_PINNED];`
- minswap.ts:339: `if (network !== "mainnet") return [];`
- 1.8.1's minswap.ts:129 `["ChakraBondingCurve", "OpenDjedV1"]` and :306 `return [...DIRECT_PROTOCOLS, ...PREPROD_BROKEN];`
- sessions.ts:6728: `if (!script || payment !== pool) throw new Refused(t("sess.refuse.warn.spendsOther"));`
- swap-routes.test.ts:147-152: a preprod quote through CswapV1 resolves after one estimate.
- direct-swaps.test.ts:177-181: it pauses with only the funding submitted.
- The saved preprod answers (routes/live/est4-preprod-wallet-list.json, cross/minswap/preprod.json) are both MinswapV2.
- My live c1 and c2 (mainnet, "Minswap" excluded yet routed) and c3 (404 when nothing is left).

**Documented.** Stated and accepted in several places:
- PR #375's body: "**Stop sending `ChakraBondingCurve`.** No check is lost: on mainnet a route through it is still refused by `uncheckedProtocols`, and the session's own check still pauses any DEX that swaps against its pools."
- minswap.ts:142-145: "as preprod has no list of the DEXes it may go through (`uncheckedProtocols`): a swap through one would be funded before the session's check paused it."
- minswap.ts:333-334: "None on preprod, where only the check stands."
- minswap.ts:125-126: "The session's check stays: any other DEX that does it pauses the swap."
- architecture.md:663: "Any other DEX that swaps against its pools still pauses the swap."
- swap-routes.test.ts:147's test name: "isn't asked for again on preprod, where only the check stands".

**The fix.** Not needed. In its favour, the optional preprod re-ask for names off MINSWAP_PROTOCOLS refuses nothing, and it adds only one estimate to the same Minswap endpoint, so there's no new data handling. Against it:
- It reverses a stated, pinned design (swap-routes.test.ts:147-152).
- It can't help ChakraBondingCurve under that name: the validator refuses the name, which is routes#1's 400.
- It inherits routes#1's refused-second-ask failure, so it would have to come with routes#1's keep-first fix.

For test funds, leave preprod as designed.

### mutants#4: confirmed, low (confirmed-by-run)

**Why.** **The gap is real.** With "preprod" hard-coded in swapBuild's (z6) and order()'s (z7) routeOf calls, the full suite still passes, even with both mutants applied at once.
- The runner tests' mock rewrites the network for every caller of uncheckedProtocols, routeOf's included (swap-routes.test.ts:16-17), so the argument passed never matters.
- Every swapBuild test runs on preprod. The only mainnet runner tests (splash-remnant.test.ts) start after the order.
- quote()'s call is the only one pinned: z8 is killed.

**The wrong network isn't possible today, only under a mutant.** At all three call sites the third argument is the method's own `network`, the same variable that picks the Minswap client: sessions.ts:1587, 3183-3185 and 4124-4126. So this is a missing regression pin on a real mainnet path whose behaviour is right: low.

One nit on the scenario: CswapV1 is in mainnet's base exclude list, so only a DEX Minswap adds could show up there. Under the mutant the outcome is a refusal or a pause, never money.

**Evidence.** - sessions.ts:1587: `const { est } = await routeOf(this.deps.minswap(network), checked, network);`
- sessions.ts:3183-3185 and 4124-4126: `const minswap = this.deps.minswap(network); const ask = checkAsk(s.swap); const { est, avoid } = await routeOf(minswap, ask, network);`
- swap-routes.test.ts:16-17: `real.uncheckedProtocols(rule.mainnet ? "mainnet" : network, est)`
- grep over tests/: 26 `swapBuild("preprod"`, none on mainnet. The 8 `advance("mainnet"` calls are all in splash-remnant.test.ts.
- z6 and z7 applied together, full `npx vitest run`: `Test Files 263 passed | 1 skipped (264) / Tests 3276 passed | 4 skipped (3280)`, the same as the baseline log.
- Source pin (v-routeof-network.test.ts): passes on the clean tree. z6, z7 and z8 each fail with `expected '"preprod"' to be 'network'`.
- Behavioural mainnet pin (v-routeof-mainnet-runner.test.ts):
  - On the clean tree, both cases pass (2 estimates each, the second excluding SomeNewDex).
  - z6 fails the Review it myself case: 1 estimate, then "Minswap now routes this swap through SomeNewDex…".
  - z7 fails the runner case: 1 estimate, then paused "Minswap now routes it through SomeNewDex, whose orders the wallet can't check yet."

**Documented.** Nowhere. PR #375's body lists "the re-ask on the quote and in the runner's build" among its new tests, which is true of the logic but not of the network argument.

**The fix.** **The finder's source pin works:** it kills z6, z7 and z8 and passes on the clean tree. It costs nothing but is textual, so a rename breaks it.

**A behavioural pin is cheaper than the finder assumed.**
- Plant a funded, unplaced session record under `sessions.mainnet`, as splash-remnant.test.ts does ("the fakes serve any network, and the book is a store key per network").
- Route through an unknown DEX until it's excluded, and assert two estimates, the second excluding it. Only the estimate calls are read, so the fixture build that follows doesn't matter.
- It's about 50 lines with no new fixtures, and it kills z6 and z7 (z8 is already killed by swap-routes).

Both pins are tests only: no runtime change and no network request.

