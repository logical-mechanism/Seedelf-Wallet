# 1.9.0's review of its fixes: the swaps lens

Round two, on the merged fixes at `204c7a93`. Verbatim from its structured report.

## Coverage

Read: R2BRIEF, COMMON, FINDINGS, FIXBRIEF, fix-full.txt (all five lanes), and the merged diff 8d7c4b0c..204c7a93. In the integration tree I read minswap.ts in full from line 60 to 479 (MinswapTrouble, NAME_REFUSED, NO_ROUTE, troubleOf, refusalOf, the protocol lists). In sessions.ts I read MINSWAP_REASON and retryReasonOf (277-297), routeOf (874-904), quote (1591-1631), outBuild (1907-1977), swapBuild (3175-3212), stop/resume/runAll/step/act (3391-3905), order and cancel (4135-4198), liveOrders, settle/landed/lost (1348-1437), the restore scan's record shape (~2970) and Refused (752). Also spent.ts's TTL, ui-port.ts codeOf, rpc.ts RetryReason, Swaps.tsx retryReason and the lookedUp change, handlers.ts swap-quote, the new tests in swap-routes.test.ts and order-cancel-check.test.ts, the helpers in swap-session.ts and fakes.ts, architecture.md 665-673, flows.md 466/475, and backlog.md 108-112. I also checked 1.8.1's routeOf (f77aa5c1).

Ran, in my own worktrees R/r2/swaps/tree (integrate) and R/r2/swaps/base (8d7c4b0c), both now removed with their symlinks unlinked; the main tree is clean at 8d7c4b0c:
- 13 swap files once: 285/285 passed.
- `npx tsc --noEmit -p .`: exit 0.
- i18n-worker-reasons, worker-words, swap-page-words and swap-page: 98/98 passed.
- Load, R/r2/swaps/scripts/load.sh: each of 13 files 3 times under `taskset -c 0,1`, 39 runs, all exit 0. Then all 13 files together with --maxWorkers=4 on CPUs 0,1, 3 times: exit 1 each (2, 4 and 3 timeouts).
- The same combined run on the base (scripts/load-base.sh): 4, 2 and 3 timeouts. JSON reports are in R/r2/swaps/load*/ and were parsed with scripts/slow.py and timeouts.py.
- Probe for question 2, R/r2/swaps/zz-r2-outside.test.ts, run on both trees: a first ask and a build-tx each refused with the 400 and the 404, through the quote, Review it myself and the runner. Output (outside-*.txt) is identical on both trees.
- Probe for question 4, R/r2/swaps/zz-r2-swaps-probe.test.ts, 4/4 passed. V4 on mainnet and V3 on preprod: the copy is given up, the runner waits while the funding is counted spent, then at 2 h re-routes, gets the 404 and pauses, and Stop gives ["out","back"]. Danogo on preprod: the copy is given up at 16 min, a re-route refusal pauses the swap, the copy lands while it's paused, and Stop and Try again each bring back own collateral plus swap#2, never building a second swap.

Not done: no network calls, cargo, Vite or Playwright (no e2e spec uses Minswap's refusal words; support.ts was not opened). I didn't re-run the lane's mutants; I read their evidence and checked by reading that the tests can fail. A design point I'm noting rather than reporting: routeOf leaves out all of `avoid` at once, so Danogo beside an unchecked DEX loses Danogo too, where asking without the unchecked DEX alone would leave Danogo in place. That has been so since #375. It only matters for a pair no other checked DEX can route, and it refuses before anything is funded. I also didn't trace a given-up order copy that lands more than 2 h after it was sent, after it has been dropped; that path existed before this round.

## Findings

### r2-swaps#1 (low, confirmed-by-run): Under two-CPU oversubscription, five existing default-timeout swap tests time out (as on the base), and this round's heaviest new test reaches 3.7 s

**Files:** seedelf-platform/seedelf-web-wallet/extension/tests/swap-routes.test.ts, seedelf-platform/seedelf-web-wallet/extension/tests/sessions.test.ts, seedelf-platform/seedelf-web-wallet/extension/tests/restore-scan.test.ts, seedelf-platform/seedelf-web-wallet/extension/tests/swap-runner.test.ts

**Claim.** This round causes no regression. Run the brief's way (each file three times on two CPUs), no default-timeout test comes within 1.5 s of Vitest's 5 s. With the 13 swap files in one run, four workers on two CPUs, five existing tests time out 2 to 4 times a run on both the integration tree and the base 8d7c4b0c. This round's new swap-routes.test.ts:427 goes from 0.7-0.9 s alone to 2.9-3.7 s there, within 1.5 s of the limit.

**Evidence.** From the worktree's extension/, under systemd-run MemoryMax=8G.

Solo: `taskset -c 0,1 npx vitest run tests/<f>.test.ts --reporter=json` for 13 files, 3 times each. 39 runs, all passed. The slowest default-timeout test is restore-scan.test.ts:1253 (C41, C47) at 1,823-2,108 ms. Only two tests go over 3 s, and both carry their own timeout: sessions.test.ts:1228 (`}, 30_000);`) at 2,885-3,517 ms and restore-scan.test.ts:1035 (`}, 20_000);`) at 2,494-3,132 ms.

Combined: `taskset -c 0,1 npx vitest run <13 files> --maxWorkers=4`, 3 times. The integration tree failed 2, 4 and 3 of 285 tests; the base failed 4, 2 and 3. All are 'Test timed out in 5000ms', in the same tests. Integration ms, then base ms ('!' marks a timeout):
- sessions.test.ts:1296 (chunk 24 cancel): 5464! 5018! 5075!; base 5010! 4844 5020!
- restore-scan.test.ts:1253 (C41, C47): 5145! 5041! 5035!; base 5039! 5026! 5057!
- restore-scan.test.ts:1273 (C41, 2 hours): 4599 4396 5027!; base 5018! 2678 5038!
- sessions.test.ts:1072 (sessions-3): 4857 5046! 4559; base 5033! 3576 3349
- swap-runner.test.ts:320 (L15, D2): 4361 5091! 3233; base 4620 2567 2726
- The base also timed out once on sessions-6.

The new swap-routes.test.ts:427, "still throws on a limit or an outage, as any ask does…": 888, 703 and 835 ms solo; 2937, 3016 and 3740 ms combined. It runs two quote refusals and then a full runner flow with three advances under the default 5 s. fix-full.txt's swaps notes saw restore-scan:1253 at 5,034 ms in a 73-file parallel run on this machine.

**Scenario.** A loaded CI runner times out restore-scan.test.ts:1253 or sessions.test.ts:1296, and a release PR's unit job goes red at random until it's re-run. The new swap-routes.test.ts:427 is now the heaviest test in that file and could join them. No user or attacker reaches this: it's a CI cost only.

**Fix.** Give the five tests, and swap-routes.test.ts:427, an explicit timeout as the house does for heavy runner tests (`}, 20_000);`, as at restore-scan.test.ts:1035 and sessions.test.ts:1228). Or split swap-routes.test.ts:427 into its three scenarios: the 429 quote, the 503 quote, and the runner's retry then placement.

### r2-swaps#2 (nit, traced): backlog.md:111 says a name routeOf adds "no longer" fails every swap's quote, which it never did

**Files:** seedelf-platform/seedelf-web-wallet/docs/backlog.md

**Claim.** The new sentence suggests a name routeOf adds once failed every quote, and that it now doesn't fail one. It only ever failed the quotes routed through that DEX. Those quotes are still refused; what changed is the words, which are now the wallet's, and the runner, which now pauses instead of retrying with no end.

**Evidence.** backlog.md:111: "A DEX name Minswap stops taking fails every swap's quote … while it's on the wallet's own list, which every ask sends. … One that `routeOf` adds from Minswap's own route no longer does: refused, its second ask leaves the first answer standing, and the route is refused in the wallet's words (1.9.0's release review, L8)."

The code: routeOf (sessions.ts:893-897) sends a second ask, the only one that names such a DEX, only when `avoid` is non-empty, that is, for a route through that DEX. Kept first, quote() refuses it at 1603-1606 (`sess.routesThrough`). At 8d7c4b0c, routeOf's `const est = avoid.length ? await minswap.estimate(ask, avoid) : first;` threw the 400 for that one quote only.

**Scenario.** A reader of the backlog, the owner choosing what to build next, takes it that swaps routed through a refused name now quote. They are still refused before funding, and the runner pauses them.

**Fix.** Reword: "One that `routeOf` adds from Minswap's own route fails only the swaps routed through it, and in the wallet's words: refused, its second ask leaves the first answer standing, so the quote is refused and the runner pauses (1.9.0's release review, L8)."

## What holds

- Q1: a kept `first` never reaches build-tx, a funded order or a signature. avoid = outOfPlace(first) ∪ uncheckedProtocols(network, first) (sessions.ts:893). With est === first, each caller re-runs exactly those two checks with the same network before building: quote 1603/1607, which never builds; swapBuild 3202/3206, before buildTx at 3210; order() 4145/4149, as Refused, before buildTx at 4167. signAndSend comes only after a build (4175), or through txSubmit of a KeptTx, which only a built review stores.
- There are no other callers: grep of src shows estimate, buildTx and routeOf only at sessions.ts:892/897, 1602, 3200/3210 and 4141/4167.
- The runner: step() turns Refused into `paused {why: refused}` and deletes retry (3665-3667). runAll skips a paused session (running() at 1270, 3554). A 429, silence or a 5xx still throws and retries; the new test at swap-routes.test.ts:427 shows reasons minswap-rate-limited, then other, then placement.
- Q2: outside routeOf the user sees exactly what 8d7c4b0c showed. My probe ran identically on both trees. A first-ask 400 shows 'Minswap refused it (400): body/exclude_protocols/0 must be equal to constant, …' (1,275 chars); a 404 shows 'Minswap refused it (404): Quote not found.'. The runner retries with reason 'other' and those words and never pauses, for the first ask and for build-tx. Review it myself shows the same words. MINSWAP_REASON maps both codes to 'other' (283-284), which is what an undefined trouble gave (294-296), and Swaps.tsx:3052 shows the error words for 'other'.
- Q3: nothing treats the new codes differently. Only sessions.ts reads MinswapError.trouble: retryReasonOf (294) and routeOf (899). ui-port.ts codeOf (12-13) never forwards trouble to a page. RetryReason (rpc.ts:1786) gains no value, so persisted retry reasons and Swaps.tsx RETRY_REASONS are unchanged. The restore scan's records carry no `auto` (sessions.ts ~2978), so they never step or reach routeOf. The i18n/worker-word guards pass, 98/98.
- Q4: the route pause is written only by order(), which act() reaches only when no swap copy is taken (3829-3837). Then the funding is at the account, or freed: a Danogo copy's held inputs are released at 3732. A V3/V4 copy's funding stays counted spent for SPENT_KEEP_MS (2 h), so the runner just waits until REPLACED_WATCH_MS drops the copy. Try again pauses again while Minswap refuses, and Review it myself refuses too, so Stop is the only way back, by design. Stop works: stop() deletes paused (3417), and act() never routes for a stopped swap. It runs bringBack (3836), or the wallet's own cancel of any order a given-up copy placed (3834/3845). My probe passed 4/4 for V4 on mainnet, V3 on preprod and Danogo on preprod, including a Danogo copy that lands while the swap is paused, which both Stop and Try again bring back.
- troubleOf (minswap.ts:436-442) keeps funding-unseen and build-failed first. It tags name-refused only on a 400 and no-route only on a 404 with the anchored /^quote not found\.?$/i, so Fastify's own 404 ('Route POST:/… not found') or an HTML 404 isn't taken for 'no route'. Changed wording at Minswap falls back to the old throw and retry.
- The new tests can fail. The 429 case would kill a catch on any trouble; the unit test pins both status checks; the mutants#4 test kills z6 and z7 (the lane's runs, consistent with my reading). The V4 Stop, scan and fill tests run the real wasm and pass, 30/30 in order-cancel-check.
- Q5, the brief's method (each file three times on taskset -c 0,1): no test on the default 5 s timeout comes within 1.5 s of it. The maximum is 2,108 ms (restore-scan.test.ts:1253). The two tests over 3 s carry 20 s and 30 s timeouts.
- Q6: architecture.md:665's cost line ('three when Minswap's first route is asked for again … or, on mainnet, a DEX the wallet doesn't check') matches avoid at sessions.ts:893. Line 670's L8 paragraph matches troubleOf and routeOf 895-901, and 'any other failure still throws' matches 899. Lines 667 and 673 and flows.md:475 still hold.
- 1.8.1's routeOf (f77aa5c1 sessions.ts:880-886) already re-asked for outOfPlace and threw on its 404. So the docs are right to say the change covers both kinds of re-ask, and the swaps lane's trade-off note is accurate: those paths used to retry and now pause.
- Where it meets #377: a single-leg V4 route on mainnet is never re-asked (it's in MAINNET_PROTOCOLS and not out of place). Round one's live check took preprod's list with SundaeSwapV4 with a 200 (find-full.txt:677, 732, 1081), so preprod quotes don't fall into the name-refused class.
- Where it meets the views lane: Swaps.tsx's lookedUp (cancel or pools) never meets a kept first, since a refused route builds no review.
- The integration tree typechecks (tsc exit 0), and the 13 swap files pass 285/285.
