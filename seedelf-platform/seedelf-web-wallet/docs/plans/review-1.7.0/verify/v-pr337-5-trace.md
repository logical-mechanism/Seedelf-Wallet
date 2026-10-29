# v-pr337-5-trace: verifying pr337#5

**The finding has two halves:**
- **(a)** In the hour before `offerAt`, MixCard renders an empty `token-row__detail` row.
- **(b)** The site's page and a by-hand swap's page show *Bring the rest back now* only after a Refresh.

**Verdict: partly.** Severity **nit** for the half that stands. Confidence: high. Both halves were decided by a scratch test, and (a) was also measured in Chromium.

- **(a) Confirmed.** The scratch test fails on HEAD. The card carries `<div class="token-row__detail"></div>` with nothing in it. In Chromium, with the real stylesheet, that is a 4 px implicit grid row plus the 1 px row gap. The card is 5 px taller: 56.69 → 61.69 px, with 14 px under its sub line instead of 9 px.
- **(b) Refuted.**
  - Home's 10 s `tick` runs whatever Home shows, and Home renders Dapps inline. So the tick re-renders the open page, whether a site's page or a swap's page in either form. `CollateralHeldWayOut` reads `Date.now()` on every render.
  - The button needs no new read, only a render: it appears by `offerAt` + 10 s at the latest, with no Refresh. The scratch test shows both pages render it from the same session object once the clock passes `offerAt`.
  - Dapps doesn't poll sessions, as the finding says, but that doesn't matter.

## The trace on HEAD (6bca8bec)

### (a) The empty row

1. **The view carries `collateralHeld` for the whole hour before `offerAt`.**
   - `lovejoin.ts:4127-4132` `tailHeld` returns `{ id: c.id, offerAt: c.tail.landed + TAIL_OFFER_MS }` once the tail has `landed` and `tailWaits(c) || tailBuildable(c, now)` holds.
   - `TAIL_OFFER_MS = 60 * 60_000` is at `:335`.
   - `sessions.ts:5617`: `...(stage !== "closed" && tail ? { collateralHeld: tail } : {})`.
   - So `collateralHeld` is set from the first ask to giveme.my (`landed`), not from `offerAt`.
2. **MixCard wraps the component whatever the hour.** `Lovejoin.tsx:2586-2590`: `{s && s.collateralHeld && !isOver(s) && onSkipCollateral && ( <div className="token-row__detail"> <CollateralHeldWayOut …/> </div> )}`. The hub always passes `onSkipCollateral` (`Lovejoin.tsx:1972`).
3. **The component renders nothing before the hour.** `LovejoinReturn.tsx:548`: `if (!held || now < held.offerAt) return null;`.
4. **The CSS gives the empty wrapper a row of its own.**
   - `styles.css:1777-1791`: `.token-row` is `display: grid; grid-template-rows: auto auto; row-gap: 1px`.
   - `:3777-3786`: `.token-row__detail { grid-column: 2 / -1; margin: 4px 0 0; … }`.
   - A grid item's margins don't collapse, so the empty div takes a new implicit `auto` row, sized by its 4 px margin.
5. **Only MixCard wraps.** The other three placements put the component in directly, so they render nothing before the hour: the runs-itself swap page `Swaps.tsx:2513`, the by-hand swap page `:2567`, and the site's page `SiteSessions.tsx:410-418`.

**Reach:** the hub's *Your mixes*, for a private mix whose collateral's mix waits on giveme.my. The empty row lasts at most an hour. After the hour the wrapper holds the way out, and once the mix goes, `collateralHeld` goes too. PR #337 says the tail is dormant on mainnet until a 5 ₳ ADA pool holds its floor.

### (b) The static pages

1. **The component reads the clock on every render.** `LovejoinReturn.tsx:540` declares `now = Date.now(),` as a default parameter. No caller passes `now`: `SiteSessions.tsx:411-418`, `Swaps.tsx:2513`, `:2567`, `Lovejoin.tsx:2588`.
2. **Home re-renders every 10 s, whatever it shows.**
   - `Home.tsx:277`: `const [now, setNow] = useState(Date.now);`.
   - `:384`: `const tick = setInterval(() => setNow(Date.now()), 10_000);`, inside the mount effect `:378-386`, which has deps `[load, watch]` and no `screen` gate.
   - Both deps are stable: `load` has `[]` (`:322-349`) and `watch` has `[load]` (`:376`).
3. **Home renders the pages inline.**
   - `Home.tsx:750-765`: `if (screen === "dapps" && free) { return ( <Dapps …/> ) }`.
   - `Dapps.tsx:205` renders `<Swaps …/>` and `:235` renders `<SiteSession …/>`. `Swaps.tsx:480` renders `<Session …/>`.
   - `App.tsx:171` mounts `screen = <Home goHome={goHome} />` for the unlocked wallet.
   - These are the only render sites of Dapps, Swaps and SiteSession (grep).
4. **Nothing in the chain is memoized.**
   - Home, Dapps, Swaps, SiteSessions and LovejoinReturn have no `memo(`. Swaps' three `useMemo`s hold data, not elements.
   - **No React Compiler:**
     - `vite.config.ts` calls `react()` with no options.
     - There is no `babel-plugin-react-compiler` in `node_modules`.
     - The built bundle (`dist/assets/index-*.js`) has one `react.memo_cache_sentinel`, in React's own symbol table beside `react.memo` and `react.lazy`, not in compiled components.
5. **So every tick reaches the button.** Each tick re-renders Dapps, then the open page, then `CollateralHeldWayOut`, which reads the clock again. A site's page opened at 55 minutes and left open shows the button by `offerAt` + 10 s.

**The other surfaces poll faster:**
- **The hub** also re-reads sessions every 2 s while a mix isn't over (`Lovejoin.tsx:1766`, `WATCH_EVERY_MS = 2_000` at `LovejoinReturn.tsx:125`).
- **The runs-itself swap page** advances every 20 s (`Swaps.tsx:2159`) and watches sessions while returning (`:2166`).

## Scratch test (deleted)

`extension/tests/zz-review-v-pr337-5-trace-1.test.ts`, run alone with `npx vitest run`. Result: **1 failed, 2 passed.**

- **(a)**
  - **Setup:** the real `MixList`, with one mix session: `stage: "returning"`, `chain` all on chain, `collateralHeld: { offerAt: now + 30 min }`, and `onSkipCollateral` given.
  - **The test:** it asserts the markup has no `<div class="token-row__detail"></div>`.
  - **Fails on HEAD.** The card's markup ends `<span class="token-row__sub">All 6 transactions on chain</span><div class="token-row__detail"></div></li>`.
  - **Its controls pass.** Without `collateralHeld` there is no wrapper. At `offerAt` the wrapper holds `<div class="stack" data-testid="collateral-held">`.
- **(b)**
  - **Setup:** the real `SiteSession`, and the real by-hand `Session` (no `auto`), each with `collateralHeld: { offerAt }`. The same session object is rendered twice: once with the fake clock at `offerAt` − 5 min, and once at `offerAt` + 10 s.
  - **Both pass.** The first render has no `collateral-held`; the second has `collateral-held-skip`. The button needs only a render, which Home's tick supplies.

## Layout measurement (a)

**Setup:**
- **Browser:** Playwright's cached headless Chromium (1243), every request aborted, `setContent` only, a 360 px viewport.
- **Input:** the real `src/ui/styles.css`, with the markup the real `MixList` rendered in the scratch test.

| Card | `li` height | Grid tracks | Under the sub line |
|---|---|---|---|
| plain (no `collateralHeld`) | 56.69 px | `20.2969px 17.3906px` | 9 px |
| held, before `offerAt` | 61.69 px | `20.2969px 17.3906px 4px` | 14 px |
| held, after `offerAt` | 256.19 px | `… 198.5px` (callout and button) | n/a |

In the held-before card, the empty DIV has height 0 and `margin-top: 4px`. The script and markup are in the session scratchpad, outside the tree: `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/review/v-pr337-5-trace/`.

## Fix advice

- **(a)** The finding's first fix is right. Either option works:
  - Gate the wrapper on the hour too: `s && s.collateralHeld && Date.now() >= s.collateralHeld.offerAt && !isOver(s) && onSkipCollateral && …`.
  - Let `CollateralHeldWayOut` render the wrapper itself, through a class prop, since it already returns null before the hour.

  The hub re-renders every 2 s while a mix runs, and Home every 10 s, so a gate on `Date.now()` flips on time. For a test, the (a) assertion above fails before the fix and passes after.
- **(b)** Drop the optional timeout to `offerAt` on the static pages. Home's 10 s tick already re-renders them, and the button appears within 10 s of the hour.
