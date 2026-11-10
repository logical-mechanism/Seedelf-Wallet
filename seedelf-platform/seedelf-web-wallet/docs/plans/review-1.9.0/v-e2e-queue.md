# 1.9.0's release review: the v-e2e-queue verifier

The verification, told to refute. Verbatim from its structured report; full addresses of third parties shortened.

## Coverage

Read at 8d7c4b0c: COMMON.md and claims-e2e-queue.md. Code: extension/src/ui/screens/DappApprovals.tsx (1-420 and 1040-1180: ackFor/ack, the hold, the Screen key, SignTx's release rows and callout); extension/src/background/dapp.ts (ask at 1550-1600, signTx at 2132-2200, the funding rewrite at 1454, MAX_WAITING and MAX_SITE_WAITING at 200-202); extension/src/ui/dapp.ts releasesContractFunds; extension/e2e/extension.spec.ts 5095-5150 (cip30, connectorWindow) and 5727-5900 (siteOnAccount1, the #373 test); e2e/store-images.spec.ts (`speak`); vite.config.ts (test.environment "node"); playwright.config.ts; styles.css (.switch, .setting-row); ReviewRows.tsx; Screen.tsx; the en/es/ja strings. Also every Vitest file that imports DappApprovals or reads it as text, PR #373's body, flows.md:430, architecture.md:563, and web-wallet.yml's e2e and store jobs. I opened neither e2e/support.ts nor any test vector.

Ran, in my own worktree at 8d7c4b0c: node_modules symlinked, the main tree's wasm/pkg copied in, each Playwright run under `systemd-run --user --scope -p MemoryMax=8G -- taskset -c 0,1 xvfb-run -a npx playwright test --project=extension -g ...`. Builds were `npx vite build` (CI's build:ext), with a dist/review-marker.txt that each test logs, so every run shows which build it loaded.
- Baseline dev build: queued probe 3/3 (--repeat-each=3 --workers=1), then 6/6 (--repeat-each=6 --workers=2). Layout probe 1/1. Scenario probe and the existing #373 test 2/2.
- Mutant m (`const ack = ackFor !== undefined;`) dev build: queued probe failed 3/3; the existing #373 test passed 3/3; the scenario probe showed the carry-over.
- Mutant m under Vitest: the 11 files that import or read DappApprovals passed, 283 tests.
- Store build (`VITE_ENABLE_MAINNET=true VITE_STORE_BUILD=true npx vite build`, no package.mjs): all three probes 3/3, 9 passed. Its JS chunks are byte-identical to the dev build's; only the manifest differs.

Then I unlinked the symlink and removed the worktree. The main tree is untouched: git status is clean at 8d7c4b0c, and dist/ and node_modules are unchanged. The one exception is Vitest's gitignored timing cache, node_modules/.vite/vitest/.../results.json, which was rewritten through the symlink as in the other lanes. No network calls, no cargo.

Not done:
- The full Vitest suite under mutant m. I rely on the mutants lane for that, and checked only the 11 relevant files.
- The full e2e suite and the data-layer project.
- Any live preprod run.

## Verdicts

### mutants#3: confirmed, low (confirmed-by-run)

**Why.** The gap is real, and what the finder says about it holds when run. The grade doesn't: at 8d7c4b0c the behaviour is right, so this is a real path with no test, which is low under COMMON.md, not medium.

What holds:
- ackFor is DappApprovals' own state (DappApprovals.tsx:125), outside the per-request `<Screen key={current.id}>` (:269). `ack = ackFor !== undefined && ackFor === currentId` (:126) is the only thing that stops a yes from carrying over.
- Under mutant m, the second request, never touched, shows the switch on and Sign enabled once the password is typed and the hold has passed (run 5). That is the finder's scenario.
- The existing step cannot catch it. It waits for the first window to close (extension.spec.ts:5865-5868, `await done`) and opens a new one (:5871), so DappApprovals mounts afresh. It passed 3/3 under mutant m (run 4).
- Vitest cannot catch it either:
  - vite.config.ts sets `test: { environment: "node" }`; node_modules has no jsdom, happy-dom or testing-library, and no test has a `@vitest-environment` pragma.
  - dapp-prompt.test.ts renders SignTx and its siblings with renderToStaticMarkup, never the parent's state across requests.
  - The two tests that read DappApprovals.tsx as text (hide-balances-forms, i18n-critical-helpers) check unrelated strings.
  - The 11 files that import or read DappApprovals pass under m.
- The path is real:
  - A site may have up to 5 requests waiting (dapp.ts:202 `MAX_SITE_WAITING = 5`).
  - Each sign-tx approval gets `crypto.randomUUID()` once (dapp.ts:1570). The only rewrite is a connect's funding (dapp.ts:1454), which spreads the old approval and keeps its id.
  - The next request shows in place: my run saw "1 of 2 waiting", then "The next request." in the same window, and no new view=dapp page opened.
  - The 800 ms before an empty window closes (CLOSE_AFTER_MS) is a second same-window path the existing step skips.

What doesn't:
- The medium grade. On 8d7c4b0c the queued probe passed 3/3 serially and 6/6 with 2 workers on 2 CPUs (dev build), and 3/3 on the store build. The second request starts with the switch off and the password box empty. Sign stays disabled after the password is typed, past the hold and 1.5 s more. Enter in the box signs nothing, and the request's own yes then enables Sign.
- Small slips: `current` is at :116 and `key={current.id}` at :269, not :117 and :267. "Can't mount DappApprovals at all" is a little strong: it could be server-rendered in its first state ("Loading"). But nothing in Vitest can drive its state, which is the point.

The critic's "Low, with the queued case left as a gap" matches the runs.

**Evidence.** Code at 8d7c4b0c:
- extension/src/ui/screens/DappApprovals.tsx:122-126: `// ... Held by the request it was given for, so a yes can never carry over to the next one.` / `const mustAck = current?.kind === "sign-tx" && releasesContractFunds(current.summary);` / `const [ackFor, setAckFor] = useState<string>();` / `const ack = ackFor !== undefined && ackFor === currentId;`
- :269 `key={current.id}` on Screen.
- :299 the switch's `onClick={() => setAckFor(ack ? undefined : currentId)}`.
- :318 Sign's `disabled={busy || held || (needsPassword && !password) || (mustAck && !ack)}`.
- extension/e2e/extension.spec.ts:5865 `const done = sign.waitForEvent("close");`, 5868 `await done;`, 5870 `// A yes is for one request: the next starts over.`, 5871 `const again = connectorWindow(context);`.

Runs, each under `systemd-run --user --scope -p MemoryMax=8G -- taskset -c 0,1 xvfb-run -a npx playwright test --project=extension -g <pattern>`:
1. Baseline, `-g "probe-e2e-queue: two releasing" --repeat-each=3 --workers=1`: `queue-build baseline 8d7c4b0c dev`, `queue-second-switch-at-start false`, `queue-second-pending-after-enter true new-connector-windows 0`, "3 passed (27.1s)".
2. Baseline, `--repeat-each=6 --workers=2`: "6 passed (34.4s)".
3. Mutant m (diff in mutant-m.diff: `-  const ack = ackFor !== undefined && ackFor === currentId;` / `+  const ack = ackFor !== undefined;`), same queued probe x3: "queue-second-switch-at-start true", failed 3/3 at `expect(atStart).toBe("false")` with "Expected: \"false\" Received: \"true\"".
4. Mutant m, the existing test, `-g "releases a contract UTxO under the account's key says so" --repeat-each=3`: "3 passed (19.4s)".
5. Mutant m, scenario probe: `scenario-second-untouched {"switchOn":"true","signEnabled":true,"warningShown":true}`.
6. Baseline rebuilt (index-BDLG7_Zj.js again), scenario probe: `{"switchOn":"false","signEnabled":false,"warningShown":true}`; the existing test passed.
7. Store build, all probes x3: "9 passed (1.0m)".
8. Vitest under mutant m: `npx vitest run tests/dapp-ties-accounts.test.ts tests/approvals-review-fixes.test.ts tests/collateral-reserve-review-fixes.test.ts tests/hide-balances-forms.test.ts tests/paid-rows.test.ts tests/dapp-ties.test.ts tests/connector-lovejoin-review-fixes.test.ts tests/i18n-values-in-place.test.ts tests/screens-wiring-review-fixes.test.ts tests/i18n-critical-helpers.test.ts tests/dapp-prompt.test.ts` gave "Test Files 11 passed (11) / Tests 283 passed (283)".
9. `grep -ln 'ackFor\|currentId\|dapp-contract-ack\|contractAck' tests/*.test.ts` printed nothing.

**Documented.** The behaviour is stated; the gap is stated or accepted nowhere.
- PR #373: "a switch that Sign waits for, separately for each request", and "e2e: a new test drives the window in the real extension over the e2e fakes".
- docs/flows.md:430: "a switch Sign waits for, off for each request".
- docs/architecture.md:563: "a switch Sign waits for, held per request".
- Nothing says the queued, same-window case goes untested or is accepted as such.

**The fix.** The finder's e2e is right in substance and kills mutant m: my version of it failed 3/3 under m and passed 12/12 across the dev and store builds. Changes I'd make:
1. End by declining the second request and awaiting it (`expect((await second).error?.code).toBe(2)`). As written, the fix leaves it pending, and when the context closes its page.evaluate rejects with "Target page, context or browser has been closed". In my runs that stopped early, Playwright listed that as a second error on the test.
2. Optionally, wait for the second request to be shown (`dapp-changed` reading "The next request.", `dapp-queue` gone) and read aria-checked once before the retrying checks, so the assertion is about the second request's first state.
3. Rewrite the existing step at extension.spec.ts:5870-5878, which can't fail, into the queued form, rather than adding a fourth connector-window test. One test then covers both.

Worth adding as well: assert no new view=dapp page opens, press Enter in the box, then turn the switch on and check Sign enables. That shows the switch alone holds Sign.

It's a test only: no new request, it refuses nothing, and it needs no privacy-policy entry. It ran stably under 2-CPU load on both builds, as the owner's stress rule asks. Code: probe-e2e-queue.ts.txt.

### layout-es-ja-400x605 (the orchestrator's run 2; no finder claim): refuted, none (confirmed-by-run)

**Why.** Tested as the worry behind the request: at 400x605 in Spanish or Japanese, the release warning spills sideways or cuts the switch's label. It doesn't.

- Nothing overflows sideways in en, es or ja: scrollWidth is 400 for both html and body, no element sits past either edge, and no clipping box overflows.
- The switch's label is never clipped:
  - overflow is visible and white-space normal.
  - scrollWidth equals clientWidth (316), and scrollHeight equals clientHeight.
  - It sits inside its row, 12 px clear of the switch, with no clipping ancestor.
  - en and es take one line; ja takes two, with the switch level with the first.
  - In each language the switch's accessible name is the translated label.
- One difference worth knowing, not a bug: in ja the callout starts at y=592, 13 px above the 605 fold, so the first view shows only its top edge. In en and es it is wholly in the first view (532-592). It sits lower in ja because the released token row's label wraps to four lines in its narrow column.
- The released ADA row (y=284) is in the first view in all three. Sign (979/998/1059) is reached only by scrolling past the callout, Pays and the switch, which is the design.
- Style only, no fix asked:
  - ja breaks the switch label inside 想定どおり ("…想定どお / りです"), Chrome's default Japanese breaking, as elsewhere in the UI.
  - The ja token row's label wraps to four lines.

**Evidence.** Same harness as run 1. `-g "probe-e2e-queue: the release warning"` switched the wallet's language on the sign window as store-images.spec.ts's `speak` does (`chrome.storage.local.set({[LOCAL_LANGUAGE]: code})`, wait for html[lang], two rAFs). Then it measured the page with scrollY at 0 and took full-page screenshots.

Positions are page y in px, inner window 400x605:

| | en | es | ja |
|---|---|---|---|
| Page height | 1080 | 1098 | 1160 |
| Released row (dapp-contract-released) | 284-330 | 284-330 | 284-349 |
| Callout (dapp-contract-release) | 532-592 | 532-592 | 592-670 |
| Pays heading / list | 617 / 644 | 617 / 644 | 695 / 722 |
| Privacy note | 755 | 755 | 817 |
| Switch | 868-892 | 887-911 | 930-954 |
| Label | 870-891, 1 line | 889-910, 1 line | 932-973, 2 lines |
| Password input | 927 | 945 | 1007 |
| Decline/Sign | 979 | 998 | 1059 |

Pays reads "Pays", "Paga" and "支払先".

In every language: `overflowX false`, `sides []`, `cut []`, label `overlapsSwitch false`, `gapToSwitch 12`, `insideRow true`, `clippedBy []`.

The en numbers equal the dapp-ui lane's probe (284/532/644/755/868/927/979/1080). The numbers were identical across the dev run and three store-build runs (run2-layout-es-ja.log, run8-store-build-probes-x3.log).

**Documented.** docs/flows.md:430: "The foot follows the request rather than staying in view, so Sign is reached only past who it pays and every warning". Japanese's callout starting at the fold is consistent with that.

**The fix.** Nothing to fix. If the owner wants phrase-based breaks in Japanese, `word-break: auto-phrase` under `:lang(ja)` would do it; store-images.spec.ts's captions already use it. That is a style call for the later polish pass, not part of this release.

