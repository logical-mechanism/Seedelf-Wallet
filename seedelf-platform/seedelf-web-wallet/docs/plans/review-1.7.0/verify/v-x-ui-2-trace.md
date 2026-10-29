# v-x-ui-2-trace: x-ui#2, the way out in a mix's card

**Verdict: confirmed. Severity: nit.**

I tried to refute it on HEAD (`6bca8bec`). `src/` is identical to #337's merge (`git diff 11e249d2 HEAD -- extension/src` is empty), and `styles.css` hasn't changed since 1.6.0. Both halves of the claim hold, in the real components and the real CSS.

## The trace

- **The wrapper.** `Lovejoin.tsx:2585-2590` (added by #337):
  ```tsx
  {/* Its return held at its collateral's mix past the hour (1.7.0). */}
  {s && s.collateralHeld && !isOver(s) && onSkipCollateral && (
    <div className="token-row__detail">
      <CollateralHeldWayOut held={s.collateralHeld} busy={busy} onSkip={() => onSkipCollateral(s.index)} />
    </div>
  )}
  ```
  The comment says "past the hour", but the condition never checks `offerAt`. The page always passes `onSkipCollateral` (`Lovejoin.tsx:1972`, through `MixList` at 2364).
- **`collateralHeld` exists before the hour.** `sessions.ts:5484-5485` (`list`) and 5505 (`one`) pass `tailHeld`, and `sessions.ts:5617` sets `collateralHeld: tail` whenever the session isn't closed. `lovejoin.ts:4127-4132` returns `{ offerAt: c.tail.landed + TAIL_OFFER_MS }` as soon as the tail's deposit has landed and its mix waits (`tailWaits` or `tailBuildable`). The worker's own test shows it: `lovejoin-planner.test.ts:1804` expects `collateralHeld` to equal `{ offerAt: landed + TAIL_OFFER_MS }` straight after the deposit lands.
- **The inner component is time-gated.** `LovejoinReturn.tsx:548`: `if (!held || now < held.offerAt) return null;`. So for the hour the card renders `<div class="token-row__detail"></div>`. The page polls `sessions` every 2 s while a mix runs (`useSessionsWhile`, `Lovejoin.tsx:1764`), so the empty wrapper shows for the whole hour, and the button appears within about 2 s of `offerAt`.
- **The grid.** `.token-row` (`styles.css:1777-1791`) is a grid with `grid-template-rows: auto auto` and `row-gap: 1px`. `.token-row__detail` (`styles.css:3777-3786`) sets `grid-column: 2 / -1; margin: 4px 0 0; font-size: 12px; ... color: var(--warn)`. An empty item still takes an implicit row: 4 px of margin, plus the 1 px gap.
- **The font.** `styles.css:136-137` has `button { font: inherit;`. Neither `.primary, .secondary, .danger` (150-162) nor `.secondary` (175-179) sets a font-size, and no other selector reaches this button (I grepped every `secondary`, `token-row__detail`, `mix-card` and `button` rule; there is only one stylesheet). The button's root `.stack` sets no size either. Inside the card, the label is therefore 12 px.
- **The swap and site pages.** `Swaps.tsx:2513`, `Swaps.tsx:2567` and `SiteSessions.tsx:411` render `CollateralHeldWayOut` as a direct child of `<Screen>`, so it sits in `.screen__body` (`styles.css:950`, no font-size) at the body's `--text-md` of 14 px. Your mixes' own *Show more* `.secondary` is 14 px too: `.section` and `.list` set no size.

## The scratch test (failed on HEAD, deleted)

`extension/tests/zz-review-v-x-ui-2-trace-1.test.ts` rendered the real `MixList` with one held mix session (`stage: "open"`, chain 7 of 7 on chain, `collateralHeld`), once before the hour and once after, with `onSkipCollateral` given as the page gives it. A copy is at `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/review/v-x-ui-2-trace/zz-review-v-x-ui-2-trace-1.test.ts.copy`.

Result: **2 of 2 failed on HEAD.**

- **Before the hour:** `expected … not to contain '<div class="token-row__detail"></div>'`. The rendered card ends `…<span class="token-row__sub">All 7 transactions on chain</span><div class="token-row__detail"></div></li>`.
- **After the hour:** `expected … not to match /<div class="token-row__detail"><div class="stack" data-testid="collateral-held">/`. The way out is nested in the 12 px, warn-coloured detail class.

## Chromium measurement (headless, outside the tree)

I loaded the markup above, rendered from HEAD, with HEAD's `src/ui/styles.css` inside `.app.app--panel > .screen > .screen__body` at 400 px. The script is `…/scratchpad/review/v-x-ui-2-trace/measure.mjs` and the screenshot `…/scratchpad/review/v-x-ui-2-trace/page.png`.

| | HEAD | Control / other page |
|---|---|---|
| Card before the hour | 61.69 px, rows `20.3px 17.4px 4px` | 56.69 px with the empty wrapper removed, rows `20.3px 17.4px` |
| Button past the hour | 12 px, 48 px tall, weight 600, white | 14 px, 48 px tall, weight 600, white (swap and site placement) |
| Callout past the hour | 12.5 px, `rgb(227,230,235)` | the same |

- The empty row adds **5 px**: the 4 px margin plus the 1 px row gap. The finding said 4 px, so it slightly undercounts.
- Only the button's size differs. The warn colour never reaches the button or the callout, which set their own colours. The finding only described the class's colour; it didn't claim it leaks.
- The 48 px pill with a 12 px label matches neither the standard `.secondary` (14 px) nor the card-sized `.primary--compact` (13 px, 36 px, `styles.css:198-202`). #337 changed no CSS, so the 12 px is inherited by accident, not a design choice.

## What it costs

- Nothing functional. The button works in both states and the privacy callout shows the same everywhere. No money, privacy or flow impact.
- The visible effects are a smaller button label than on the swap and site pages and below the same section's *Show more*, and a card 5 px taller at the bottom for up to an hour. That is style trivia, so **nit** stands.

## Fix advice

- **One change fixes both halves.** Drop the `.token-row__detail` wrapper and make `CollateralHeldWayOut`'s own root the grid item, for example through an optional `className` on its `.stack` root, with a new rule `grid-column: 2 / -1; margin-top: var(--s1)` and no font-size or colour. Then:
  - before the hour the component renders no element at all, so there's no row and no gap;
  - past the hour the button inherits the `li`'s 14 px, as on the other pages.
- **The finding's first option, alone, fixes only half.** Gating MixCard's condition on `offerAt` duplicates the component's own time check and still leaves the 12 px past the hour, unless the class changes too.
- **Any empty wrapper still costs the gap.** A wrapper with `grid-column` but no margin still adds the 1 px row gap before the hour, so the wrapper must not render then.
- **The privacy callout (`lj.tail.privacy.wayOut`) must stay** (owner's rule 3). The change only moves it.
- **Test:** the two expectations of the scratch test above make a regression test that fails without the fix: no empty `.token-row__detail` before the hour, and the way out not under `.token-row__detail` after it. A font-size check needs a browser; the structural assertion is enough.
