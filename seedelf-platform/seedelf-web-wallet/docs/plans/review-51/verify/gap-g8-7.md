# gap-g8#7: verification

From lane gap-G8, graded low by its finder.

## Trace: confirmed, low

The finding holds as described. The wallet refuses any slippage outside 0.1% to 20% in two places, and nothing on chain asks for that range.
- **The form:** `parseSlippage` (ui/swap.ts:264-270) gives undefined outside SLIPPAGE_MIN 0.1 and SLIPPAGE_MAX 20 (swap.ts:210-211).
- **The worker:** `checkAsk` (sessions.ts:836) refuses the same range at the quote, the funding, Review it myself and the runner's order.

The range has been there since chunk 15 (b858d22e, then e43cec9a) and was never decided against a ledger or contract limit.
- Minswap writes amount_out / (1 + s%) into the order as its minimum, and a DEX's order takes any minimum.
- On the Danogo route there is no order: the wallet's own `checkProceeds` holds the swap to that minimum at any value.
- The wallet's own runner already asks Minswap's build-tx with less than 0.1% after a dip (`slippageKeeping`, sessions.ts:4163-4164; the test shows 0.0499). So the floor isn't one the wallet holds Minswap to.

By the owner's rule of 2026-10-19, a risky but valid choice gets a warning at most, and the form already warns from 5%.

**Narrowing:** the user meets only the form's refusal. The form's slippage state starts at 1 and changes only through the presets or `parseSlippage`, so it never holds a value out of range. `checkAsk` is a second line that only a crafted message from one of the wallet's own pages could reach. A site can't send swap-quote at all (sw.ts:364, `serveUi`).

**Not checked:** whether Minswap's estimate and build-tx take 25% or 0.05% (no network). If Minswap refuses them, the range is in effect Minswap's and the wallet's own refusal costs nothing.

**Grade: low.** Who is the user. No funds are lost, locked or misdirected, and the dialog states the range when a typed value isn't taken.
- **Past 20%:** a quote that moves more than about 16.7% against the user before the order is placed pauses (PriceMoved), or the order waits unfilled. Stop brings the funding back at the session's fees, so there's a way out.
- **Under 0.1%:** a stablecoin swap gets a minimum up to about 0.05% of the trade looser than the user wanted.

Both are small costs in an edge case.

**Evidence:**

Trace, every cited line opened in TREE (HEAD 140886c9; extension/src differs from web-wallet/1.9.1 only in manifest.ts):

1. **Entry (form).** Swaps.tsx:682 `const [slippage, setSlippage] = useState(1)`. It changes only through SlippageSettings (Swaps.tsx:1995-2072):
   - the presets 0.5, 1 and 3;
   - the own field, `const n = parseSlippage(e.target.value); if (n !== undefined) onChange(n);` (:2051-2052).
   - `parseSlippage` (ui/swap.ts:265-270): `return n >= SLIPPAGE_MIN && n <= SLIPPAGE_MAX ? n : undefined;` with SLIPPAGE_MIN = 0.1 and SLIPPAGE_MAX = 20 (:210-211).
   - Typing 25 or 0.05 leaves the value as it was and sets aria-invalid. The note reads "Between 0.1% and 20%, with at most two decimal places." (:2057-2061, en.json swaps.slippage.range).
2. **Worker.** handlers.ts:461-467 passes message.slippage to `sessions.quote`. sessions.ts:1601 `checkAsk(ask)`, and :836 `if (!(ask.slippage >= 0.1 && ask.slippage <= 20)) throw new Error(t("sess.slippageRange"))` ("Slippage is between 0.1% and 20%.", en.json:1904).
   - The same check runs at outBuild :1918, swapBuild :3199 and the runner's order :4140.
   - Only the wallet's pages reach these messages. sw.ts:388 `serveUi(port, extensionOrigin, answerUi)`; a site's port goes through dappSession (:364) to answerSite only.
3. **Minswap.** minswap.ts:470-475 `routed` sends `slippage: ask.slippage` as asked. :379-383: build-tx puts amount_out / (1 + slippage%) in the order as its minimum. The blind test confirms it: 906.5941 / 1.01 = 897.61792 MIN (blind-task-usability-test.md:951).
4. **No contract bound.**
   - Order routes: the minimum is just the datum's field.
   - Against-pools route (DanogoCLMMV1, minswap.ts:270-275): `checkProceeds` (sessions.ts:6807-6815) holds the proceeds to minAmountOut at any value.
   - The wallet itself goes under the floor: sessions.ts:4163-4164 `const asked = dipped ? { ...ask, slippage: slippageKeeping(BigInt(est.amount_out), least) } : ask;` passes values under 0.1% (0 too, when amount_out is within a hair of the approved minimum) to buildTx.
5. **Warnings already there from 5%** (swap.ts:216 SLIPPAGE_HIGH = 5): the form (Swaps.tsx:1223), the review (:1355) and the dialog (:2063-2064).
6. **Pinned as designed, never as a decision:**
   - tests/swap-form.test.ts:104-111 ("takes a slippage from 0.1% to 20%": 0.05 and 25 undefined)
   - tests/sessions.test.ts:382 (50 throws)
   - e2e/extension.spec.ts:2802-2803 (30 shows "Between 0.1% and 20%")
   - flows.md:467 (description only)
7. **Since:** git blame puts swap.ts:209-211/264-270 in e43cec9a (2026-09-24), and sessions.ts:836 in e90efff5 (the i18n swap of b858d22e's literal, 2026-09-24). In every release from 1.0.0; `git tag --contains e43cec9a` includes web-wallet/1.6.0 on.

Ran: `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m npx vitest run tests/r51-gap-g8-7.test.ts` (from extension/). 2 failed, 1 passed, as expected. The control passes: `slippageKeeping(1_000_501_001n, 1_000_000_000n) === 0.0499`. The two fixed-behaviour tests fail on the bug: parseSlippage("25") is undefined, and checkAsk throws "Slippage is between 0.1% and 20%."

**Known:** None: not settled or known. Searched for slippage, slippageRange, parseSlippage, SLIPPAGE_M, checkAsk, "0.1% to 20" and "20%":
- docs/backlog.md: no hits at all.
- docs/archive/plans: only design text. Chunk 15's plan; usability-review DX-3/DX-4, which added the chip and the 5% warning, marked Fixed, with no word on the range; roadmap-v1.
- flows.md:467: the description only.
- The owner's 2026-10-19 rule (chunk-34-token-pools.md:1240, chunk-51 brief) points the other way.
- SECURITY.md, the chunk-46 and chunk-49 plans, and seedelf-verification's README and audit findings: no hits.
- Review-51 itself: INDEX.md:407 lists only this finding. lanes/E7a.md:129 lists checkAsk's range as a guard, not a finding. E7a.md:162 notes the related offline question: whether Minswap takes slippageKeeping's sub-0.1% values.

**Fix notes:**

This needs the owner, because it changes what the swap form accepts.

**The change:**
- Widen the range in both places in one go: SLIPPAGE_MIN/SLIPPAGE_MAX (ui/swap.ts:210-211, used by parseSlippage and the field's note) and the hard-coded 0.1/20 in checkAsk (sessions.ts:836). Better, have checkAsk import the same constants, so the two copies can't drift.
- Take whatever Minswap's estimate and build-tx take. Look it up live, with an estimate at 25% and at 0.05% (this lane had no network). Otherwise allow any 0 < s < 100.
- Keep the warning from 5%. Optionally add a stronger line past 20%.

**What else must change with it:**
- These tests pin the current range: tests/swap-form.test.ts:104-111 (0.05 and 25 are refused), tests/sessions.test.ts:382 (50 throws, which a range up to 100 would accept) and e2e/extension.spec.ts:2802-2803 (30 shows "Between 0.1% and 20%").
- flows.md:467 describes the range.
- The en/es/ja text of sess.slippageRange and swaps.slippage.range names the bounds. Follow the steps for changing a translated value.

**Side observations, not part of this finding:**
- The warning "the order can fill for up to {{percent}} less than the quote" overstates the risk. Minswap's minimum is amount_out / (1 + s%), so 20% allows up to 16.7% less, and 5% up to 4.76% less.
- slippageKeeping can return 0, not only values under 0.1%. That happens when the fresh quote is within about a millionth of the approved minimum while est.min_amount_out is under it. lanes/E2a.md calls 0 unreachable, but it can be reached. Whether Minswap's build-tx takes 0 or a 4-decimal value is the same lookup.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension/tests/r51-gap-g8-7.test.ts`

Result: RUN  v5.0.3 /home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension

 ❯ tests/r51-gap-g8-7.test.ts (3 tests | 2 failed) 15ms
   ❯ gap-g8#7: a slippage the order takes (3)
     × is taken by the form's field: 25% and 0.05% 6ms
     × is taken by the worker's checkAsk: 25% and 0.05% 5ms

 FAIL  tests/r51-gap-g8-7.test.ts > gap-g8#7: a slippage the order takes > is taken by the form's field: 25% and 0.05%
AssertionError: expected undefined to be 25 // Object.is equality
- Expected: 25
+ Received: undefined
 ❯ tests/r51-gap-g8-7.test.ts:34:33

 FAIL  tests/r51-gap-g8-7.test.ts > gap-g8#7: a slippage the order takes > is taken by the worker's checkAsk: 25% and 0.05%
AssertionError: expected [Function] to not throw an error but 'Error: Slippage is between 0.1% and 2…' was thrown
- Expected: undefined
+ Received: "Error: Slippage is between 0.1% and 20%."
 ❯ tests/r51-gap-g8-7.test.ts:41:58

 Test Files  1 failed (1)
      Tests  2 failed | 1 passed (3)

The test that passed is the control: the runner's own slippageKeeping asks Minswap with 0.0499%.

```
// Chunk 51, gap-g8#7: a swap refuses a slippage outside 0.1% to 20%, though the order takes any minimum.
//
// The form's own field (Swaps.tsx SlippageSettings) takes a typed slippage only through parseSlippage (ui/swap.ts:264-270),
// which gives undefined outside SLIPPAGE_MIN = 0.1 and SLIPPAGE_MAX = 20 (swap.ts:210-211): the chosen slippage stays as
// it was, and the field says "Between 0.1% and 20%". The worker's checkAsk (background/sessions.ts:836) refuses any ask
// outside the same range ("Slippage is between 0.1% and 20%."), at the quote (:1601), the funding (:1918), Review it
// myself (:3199) and the runner's order (:4140). Minswap puts amount_out / (1 + slippage%) in the order as its minimum
// (minswap.ts:379-383), and the slippage goes to it as asked (minswap.ts:470-475); a DEX's order takes any minimum.
//
// The wallet's own runner already asks Minswap's build-tx with less than 0.1% after a dip (sessions.ts:4163-4164,
// slippageKeeping), so the floor isn't one the wallet itself holds Minswap to. The first test shows that, and passes.
//
// The right behaviour under the owner's rule of 2026-10-19 (refuse only what the ledger or the contracts refuse; a
// risky but valid choice gets a warning at most): 25% for a thin token and 0.05% for a stablecoin pair are taken, by the
// form and the worker alike, with the warning from 5% kept. The other two tests pass then, and fail while the range
// stands. Whether Minswap's estimate and build-tx take them was not checked (no network in chunk 51): if Minswap
// refuses them, the owner may keep the range as Minswap's, and these two are dropped, not fixed.
import { describe, expect, it } from "vitest";

import { checkAsk, slippageKeeping } from "../src/background/sessions";
import { parseSlippage, SLIPPAGE_HIGH } from "../src/ui/swap";

const ASK = { amount: "10000000", tokenIn: "lovelace", tokenOut: "ab".repeat(28), slippage: 1 };

describe("gap-g8#7: a slippage the order takes", () => {
  it("is one the wallet's own runner asks Minswap with, under 0.1%, after a dip", () => {
    // A quote 0.0501% above the approved minimum: the runner asks build-tx with 0.0499% (sessions.ts:4163-4164).
    const asked = slippageKeeping(1_000_501_001n, 1_000_000_000n);
    expect(asked).toBe(0.0499);
    expect(asked).toBeLessThan(0.1);
  });

  it("is taken by the form's field: 25% and 0.05%", () => {
    expect(parseSlippage("25")).toBe(25);
    expect(parseSlippage("0.05")).toBe(0.05);
    // Still warned of, from 5%, on the form, the dialog and the review.
    expect(25 >= SLIPPAGE_HIGH).toBe(true);
  });

  it("is taken by the worker's checkAsk: 25% and 0.05%", () => {
    expect(() => checkAsk({ ...ASK, slippage: 25 })).not.toThrow();
    expect(checkAsk({ ...ASK, slippage: 25 }).slippage).toBe(25);
    expect(() => checkAsk({ ...ASK, slippage: 0.05 })).not.toThrow();
    expect(checkAsk({ ...ASK, slippage: 0.05 }).slippage).toBe(0.05);
  });
});
```
