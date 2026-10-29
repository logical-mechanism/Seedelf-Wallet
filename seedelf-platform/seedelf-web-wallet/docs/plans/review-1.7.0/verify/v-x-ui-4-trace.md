# v-x-ui-4-trace: x-ui#4, "On pages that don't poll, the way out never appears at its hour until the user refreshes"

**Verdict: partly (nit).** The scenario as written can't happen on HEAD. Its mechanism is wrong and its fix would change nothing in the app. What is real is a narrower and different case, with a different cause and a different fix.

## The described scenario is refuted

The finding assumes nothing re-renders the site's page or a by-hand swap's page. Something does: `Home`'s own clock tick, and every one of these pages sits under `Home`.

- `src/ui/App.tsx:171`: `screen = <Home goHome={goHome} />;`. The unlocked wallet's only main view. `Dapps` is rendered only from `Home.tsx:752`. `SiteSession` is rendered only from `Dapps.tsx:235`, and `Swaps` only from `Dapps.tsx:205`, which renders `Session` at `Swaps.tsx:480`.
- `src/ui/screens/Home.tsx:277`: `const [now, setNow] = useState(Date.now);`
- `Home.tsx:384`: `const tick = setInterval(() => setNow(Date.now()), 10_000);`. It sits in an effect with deps `[load, watch]` (`:386`), and both are stable: `load` is `useCallback(…, [])` (`:322`) and `watch` is `useCallback(…, [load])` (`:361`/`:376`). So the tick runs every 10 s for as long as `Home` is mounted, whichever screen `Home` returns, including `screen === "dapps"` (`:750`). It isn't gated on `screen === "home"`, unlike the 20 s sessions read at `:429`.
- Nothing in `src/ui` uses `memo` (grep finds none). `vite.config.ts:105` uses plain `react()`, with no `compiler` option, so React Compiler is off. Each tick therefore re-renders `Home → Dapps → SiteSession` (or `→ Swaps → Session`) `→ CollateralHeldWayOut`.
- `LovejoinReturn.tsx:540`: `now = Date.now(),` is a default parameter, evaluated on every render. The callers pass no `now` (`SiteSessions.tsx:411`, `Swaps.tsx:2513`, `:2567`). The docstring at `:534` says "`now`: for tests".

So a view that already carries `collateralHeld` (the finding's own premise; the worker's view does carry it from the recorded landing, `sessions.ts:5617`, `lovejoin.ts:4127-4133`) shows the line and the button within 10 s of `offerAt`. No Refresh is needed and nothing is read again.

## What is real: a view read before the landing was recorded

`collateralHeld` exists only once the worker has recorded the deposit's landing: `tailHeld` returns nothing while `c.tail.landed === undefined` (`lovejoin.ts:4130`). The worker records it in its own runs, not on a page's read: `witnessTail` (`sessions.ts:5146`) and `tailChain` (`lovejoin.ts:4056`, `:4063`) call `tailLanded`.

The site's page and a by-hand swap's page never re-read the device's record by themselves:

- `Dapps` reads `sessions` when it opens, when a site's page opens (`Dapps.tsx:149`), on Refresh, at a scan's end, and on `DAPP_CHANGED` (`:145`). Only `DappService` sends that broadcast (`sw.ts:273`), never the session or Lovejoin services.
- A by-hand `Session` has `runs === false` (`Swaps.tsx:2137`), so it gets neither the 20 s advance nor `useSessionsWhile` (`:2165-2166`).

**Scenario.** On the site's page the user presses Bring it back. The Send ends in `onRefresh()`, so the view is read while the chain is still going, with no landing recorded yet. The user leaves the page open. The worker records the landing about ten minutes later, and giveme.my keeps the collateral's mix waiting. At landing + 1 h nothing appears, because the page's view has no `collateralHeld` and nothing reads it again. The way out shows only after Refresh, after Back and reopening, or after some site event. The same holds on a by-hand swap's page.

This is the same staleness as the rest of these pages: the "Through Lovejoin" row and the moving note don't follow the record either. Their only freshness signal is the Refresh row's "Updated …". So it's a nit. The finding's one-shot `setTimeout` wouldn't touch this case, because `held` is `undefined` there.

## Repro

The scratch test was `extension/tests/zz-review-v-x-ui-4-trace-1.test.ts`, now deleted. It used real React 19 (`react-dom/client`, `act`) over a minimal hand-written DOM, and the real `Home`, `Dapps`, `SiteSession`, `Swaps`/`Session` and `CollateralHeldWayOut`. The worker was answered through a fake `chrome.runtime.connect` port, so `ui/background.ts` `call` ran unmodified. The clock was faked, and the test navigated by pressing the real buttons (`home-dapps`, the site's row, Minswap's tile, the swap's row). No Refresh was pressed. All 4 cases passed on HEAD:

1. **Home → dApps → site's page**, opened 50 min after the landing (mounted 3.5 s off the 10 s phase). Stepping 500 ms at a time, the way out was absent at `offerAt` itself and first appeared at `offerAt + 3500 ms`, exactly Home's next tick (`(firstShown − mount) % 10000 === 0`). From the page opening to that moment, the worker was asked **nothing** (`askedCount: 0`).
2. **Home → dApps → Minswap → by-hand swap's page** (no `auto`; `session-next` present): first appeared at `offerAt + 6200 ms`, Home's next tick at that mount phase. Nothing was asked.
3. **The narrower case:** the page was opened 10 min before the landing was recorded, and the worker's answer gained `collateralHeld` from then on. At `offerAt + 1 min` the way out was absent and no `sessions` request had been made. Pressing Refresh showed it at once.
4. **Control:** `Dapps` mounted alone, with no `Home` above it. The way out never appears past `offerAt`.

**Mutation check.** I copied the wallet to the scratchpad, with `node_modules` symlinked, and replaced `Home.tsx:384`'s `setInterval` with nothing. Cases 1 and 2 then **failed** with "the way out, unpressed: expected undefined to be defined"; cases 3 and 4 passed. So the test fails exactly when the finding's premise (no re-render) holds, and HEAD's `Home` tick is what defeats it.

The copy and the test are deleted, and `git status` shows no change of mine.

## Fix advice

- **Drop the proposed fix.** A `setTimeout` at `offerAt` inside `CollateralHeldWayOut` makes no visible difference in the app, because Home's 10 s tick already re-renders within 10 s, and a hidden tab throttles both timers the same way. Keep it only if the lead wants the component not to lean on Home's unrelated `now` tick. It's harmless, but it's robustness, not a fix.
- **For the real, narrower case:** while a site's page (or a by-hand swap's page) shows a session whose return is moving or held, read the device's record every few seconds with the existing `useSessionsWhile` (`LovejoinReturn.tsx:133`). It calls `sessions` without `refresh`, which reads only the device (`sessions.ts:1502`, no Koios). Merge `holding` as `Dapps`' `reread` does (`Dapps.tsx:133-143`). Or accept it as these pages' Refresh design: nit either way.
- "Nothing on the page says one is coming" is by design: "Nothing before then, nor once it's over" (`LovejoinReturn.tsx:534`, the owner, 2026-10-28). Saying it would be an owner's call, and only my idea.

The same applies to pr337 #6's second bullet, which this finding cites.
