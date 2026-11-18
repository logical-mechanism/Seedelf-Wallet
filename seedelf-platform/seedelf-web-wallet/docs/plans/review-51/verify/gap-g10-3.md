# gap-g10#3: verification

From lane gap-G10, graded low by its finder.

## Trace: confirmed, low

The finding holds. The Add tokens picker (TokenAmounts.tsx:269) draws a lookalike's warning line with the class `token-row__sub` alone and ignores the view's `warn`. Home's TokenRow (TokenList.tsx:57) turns `warn` into `wrap token-row__sub--warn`, following H-9's rule in tokens.ts:230-236: "Shown whole, never cut". The swap's TokenSelect row (Swaps.tsx:1913) does the same with an own pick's mark. `.token-row__sub` is grey and one line, cut with an ellipsis (styles.css:1825-1832).

I measured the real component markup on the real stylesheet. At 360 px with 1,000,000 units the picker shows "Calls itself SNEK, not on th…" in #9ba3b1, and the swap's picker shows "Not on the wallet's list: it c…". My test fails on TREE in both pickers and passes once the finder's fix is applied in a copy.

Severity is low:
- **Who:** any stranger can send a token named like a listed one.
- **What it costs:** a weaker anti-impersonation warning at one step. The row is still named by its fingerprint, with initials "AS" instead of SNEK's logo, and the visible words still begin "Calls itself SNEK, not on th…".
- **Way out:** after Add, the amount box is named by the fingerprint. All six flows' reviews (TokenAmountRow) and the swap's funding line (tokenAmountText) show the whole mark before anything is signed.

One correction to the scenario: at 360 px the line is cut even at 50 units (218 px box, 224 px text). The finder's 217 px was read during the modal's scale(0.97) open animation. The line fits at 400 px.

Since: ead12610 (2026-09-27) brought "Calls itself …" into a picker that already cut its sub line (01c354ba). d423b79a (2026-10-05) fixed Home only. The gap is in every tag from web-wallet/1.6.0 to 1.9.1.

**Evidence:**

Trace (TREE b9f7e755; extension src differs from web-wallet/1.9.1 only in manifest.ts):

1. **The input.** A stranger's token named "SNEK" (or "tUSDM" on preprod) under another policy.
   - tokens.ts:116-117: `lookalikeOf` gives posesAs, so `label: id` (the fingerprint).
   - tokens.ts:266-267 viewToken: `sub: ... text.posesAs ? t("tokens.callsItself", { own })`, plus `warn: true`.
   - en.json:2646: "Calls itself {{own}}, not on the wallet's list".
2. **The rule.** tokens.ts:230-236 (TokenView.warn): "Shown whole, never cut: in the side panel it read 'not on the wallet's …', the part that matters lost (chunk 23's review, H-9)". H-9's original text (16c65399, chunk-23-ux-review.md) asked to "let the subtitle wrap".
3. **Home's list follows it.** TokenList.tsx:57: `className={view.warn ? "token-row__sub wrap token-row__sub--warn" : "token-row__sub"}`. Its aria-label (:51) also adds view.sub when warn.
4. **The picker doesn't.** TokenAmounts.tsx:269: `<span className="token-row__sub">{v.sub}</span>`, with the button's `aria-label={v.label}` (:263).
   - d423b79a touched line :268 (the masked amount) and left :269 as it was.
   - The picker opens from six forms: CardanoSend.tsx:333, Transfer.tsx:368, MoveIn.tsx:197, Withdraw.tsx:355, SiteSessions.tsx:687 and DappApprovals.tsx:986.
5. **The swap's picker doesn't either.** Swaps.tsx:569-575: an own pick's `sub` is the capitalised `tokenMark` ("Not on the wallet's list: it calls itself SNEK, but it isn't the listed SNEK"). `row()` (:1901-1914) draws it at :1913 with `token-row__sub` alone, and the pay list uses it at :1938.
6. **The CSS.**
   - styles.css:1825-1832: `.token-row__sub { font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }`.
   - :3591 `.token-row__sub.wrap { white-space: normal }`.
   - :3639 `.token-row__sub--warn { color: var(--warn) }`.
7. **The way out.**
   - The reviews name tokens through TokenAmountRow, whose TokenAmountText (TokenList.tsx:226-230) gives the whole mark the class `token-mark--warn`: CardanoSend.tsx:186, Transfer.tsx:197, MoveIn.tsx:121, Withdraw.tsx:185, and PaidRows.tsx:19 (used by SiteSessions.tsx:638 and DappApprovals.tsx:790).
   - The swap's funding line uses tokenAmountText (Swaps.tsx:1803-1809).

**Test.** tests/r51-gap-g10-3.test.ts fails on TREE: Home's control passes, and both pickers give `[ 'token-row__sub' ]`. In a copy with the fix (TokenAmounts.tsx:269 using v.warn; Swaps.tsx OwnPick `warn: !!text.posesAs` passed to row()) all 3 pass. The test is also type-clean: tsc in the copy reported no error in it.

**Layout.** I rendered the real TokenPicker and TokenSelect('pay') to static markup in a copy, on mainnet with balances shown, a stranger "SNEK" beside the real SNEK. I laid that out in headless Chrome with the real styles.css and the bundled Inter embedded, in 360 and 400 px containers, animations off, no network (`--host-resolver-rules="MAP * ~NOTFOUND"`, dead proxy, systemd-run MemoryMax=4G, timeout 90). Sub lines:
- **Picker, 1,000,000 @ 360:** box 165, text 224, cut, rgb(155,163,177): "Calls itself SNEK, not on th…"
- **Picker, 50 @ 360:** box 218, text 224, cut: "Calls itself SNEK, not on the wallet's…"
- **Picker, 1,000,000 @ 400:** box 205, cut: "Calls itself SNEK, not on the wallet…"
- **Picker, 50 @ 400:** box 258, whole.
- **Swap pay, 1,000,000 @ 360:** box 165, text 387: "Not on the wallet's list: it c…"
- **Swap pay, 1,000,000 @ 400:** box 205: "Not on the wallet's list: it calls itsel…"
- **The real SNEK row:** "Snek", whole.

A screenshot at 360 px shows the row as "AS | asset1k4t4…kp9pcu | 1,000,000 / Calls itself SNEK, not on th…" in grey, above SNEK with its logo.

The finder's 217 px text width matches 224 × 0.97, the scale `@keyframes modal-in` (styles.css:2187) starts the modal at.

**Known:** Not known.

- **backlog.md:** searched for token, truncat, ellipsis, cut, picker, warn, lookalike, "Calls itself". No such item.
- **usability-review.md:**
  - H-9 began as chunk-23-ux-review.md at 16c65399 ("the warning is cut off … let the subtitle wrap"). It was fixed in d423b79a for TokenRow only.
  - V-6's "warnings never truncate" has no row in §9's fix table.
  - HM-8 (Left) is a different matter: whether every unlisted token gets marked.
- **blind-task-usability-test.md:** step 17 opened Add tokens but recorded no sub line (amount 1,234.56).
- **launch-review.md:** #18 is the token-text helper and #20 is unverified held tokens in the swap's receive list.
- **Other records:** privacy-review §3.11, release reviews 1.6.0 to 1.9.1, the deleted chunk-23-style-flow-3.md, and review-51's INDEX and data (only gap-G10 itself). Nothing records the picker's line.
- **SECURITY.md and the owner's rules:** not out of scope. The fix adds no refusal and no words, and changes no privacy default.

**Fix notes:**

**Fix the class: one row component for a token in any list,** carrying H-9's rule, used by Home's TokenRow, TokenPicker and the swap's TokenSelect.

**Members:**
- **TokenAmounts.tsx:269:** `className={v.warn ? "token-row__sub wrap token-row__sub--warn" : "token-row__sub"}`.
- **Swaps.tsx:**
  - give OwnPick a `warn` set to `!!text.posesAs` in ownPicks (:569-577);
  - pass it to `row()` (:1901), whose sub span (:1913) takes the same classes;
  - the pay list calls it at :1938.
- **Accessible names, same family:** TokenPicker's button has `aria-label={v.label}` (:263) and the swap's row `aria-label={nameOf(p)}`. A screen reader therefore hears only the fingerprint and never the warning, while TokenRow's aria-label adds view.sub when warn (TokenList.tsx:51). Give both pickers the same aria-label.

**Correction for the record:**
- The scenario's "at 50 units the line fits" is wrong at 360 px. The text is 224 px against a 218 px box, so it shows "Calls itself SNEK, not on the wallet's…"; it fits at 400 px.
- The finder's 217 px was measured during the modal's scale(0.97) open animation. So the cut doesn't depend much on what amount the stranger sends.

**Needs no owner call.**

**Test:** tests/r51-gap-g10-3.test.ts pins both pickers against Home's row.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension/tests/r51-gap-g10-3.test.ts`

Result: Run from TREE/seedelf-platform/seedelf-web-wallet/extension:
`systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m npx vitest run tests/r51-gap-g10-3.test.ts`

```
 ❯ tests/r51-gap-g10-3.test.ts (3 tests | 2 failed) 35ms
   ❯ gap-g10#3: a lookalike token's warning in the pickers (3)
     × the Add tokens picker gives it the same classes, so it shows whole, in the warning's colour 12ms
     × the swap's pay picker gives its mark the same classes 7ms

 FAIL  tests/r51-gap-g10-3.test.ts > gap-g10#3: a lookalike token's warning in the pickers > the Add tokens picker gives it the same classes, so it shows whole, in the warning's colour
AssertionError: the picker's warning line: expected [ 'token-row__sub' ] to deeply equal ArrayContaining{…}
- ArrayContaining [
+ [
    "token-row__sub",
-   "wrap",
-   "token-row__sub--warn",
  ]
 ❯ tests/r51-gap-g10-3.test.ts:68:58

 FAIL  tests/r51-gap-g10-3.test.ts > gap-g10#3: a lookalike token's warning in the pickers > the swap's pay picker gives its mark the same classes
AssertionError: the swap's mark line: expected [ 'token-row__sub' ] to deeply equal ArrayContaining{…}
- ArrayContaining [
+ [
    "token-row__sub",
-   "wrap",
-   "token-row__sub--warn",
  ]
 ❯ tests/r51-gap-g10-3.test.ts:75:51

 Test Files  1 failed (1)
      Tests  2 failed | 1 passed (3)
```

The control (Home's list) passes.

The same file in a copy (`$HOME/.cache/seedelf-review-51/verify-gap-g10_3-trace`, removed afterwards) with the finder's fix applied: `Test Files 1 passed (1)`, `Tests 3 passed (3)`. The fix was:
- TokenAmounts.tsx:269: `className={v.warn ? "token-row__sub wrap token-row__sub--warn" : "token-row__sub"}`
- Swaps.tsx: `OwnPick.warn = !!text.posesAs`, passed to `row()` for the same classes.

```
// Chunk 51, gap-g10#3: the Add tokens picker and the swap's pay picker show a lookalike token's warning as a plain
// grey sub line, cut to one line.
//
// A token whose own name passes for a listed one goes by its fingerprint, and its view's second line is a warning,
// "Calls itself tUSDM, not on the wallet's list", with `warn` set (tokens.ts viewToken). TokenView.warn's rule
// (tokens.ts, chunk 23's review, H-9): shown whole, never cut. Home's TokenRow (TokenList.tsx) gives that line
// `wrap token-row__sub--warn`: styles.css's `.token-row__sub.wrap` (white-space: normal) and `.token-row__sub--warn`
// (color: var(--warn)). The Add tokens picker (TokenAmounts.tsx's TokenPicker, opened from Send, Send privately, Make
// private, Make public, a site session's top-up and the connector's funding) renders the same view's line with
// `token-row__sub` alone, which is grey (var(--muted)) and one line, cut with an ellipsis (overflow: hidden,
// text-overflow: ellipsis, white-space: nowrap). The swap's token picker (Swaps.tsx's TokenSelect) does the same with
// an own pick's mark, "Not on the wallet's list: it calls itself tUSDM, but it isn't the listed tUSDM", which a
// review shows in the warning's colour (TokenAmountText's token-mark--warn).
//
// The right behaviour: both pickers carry a lookalike's warning as Home's list does. Home's row is the control: the
// token is a lookalike, its view says warn, and the list gives its line the two classes. The token is preprod's
// tUSDM under a stranger's policy, so the test doesn't hang on whether the mainnet list is built in.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TokenPicker } from "../src/ui/components/TokenAmounts";
import { TokenList } from "../src/ui/components/TokenList";
import { NetworkContext } from "../src/ui/network";
import { TokenSelect } from "../src/ui/screens/Swaps";
import { tokenText, viewToken } from "../src/ui/tokens";

const STRANGER = "e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9";
const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");
/** A stranger's 1,000,000 "tUSDM", the scenario's amount (the class doesn't depend on it; the cut does). */
const lookalike = { policyId: STRANGER, assetName: hex("tUSDM"), quantity: "1000000", decimals: 0, fingerprint: "" };
const tokens = [lookalike];
const noop = () => undefined;
const seedelf = { lovelace: "50000000", utxos: 1, seedelfs: [], locked: { lovelace: "0", tokens: [], utxos: 0 }, tokens };

const html = (element: ReactElement) =>
  renderToStaticMarkup(createElement(NetworkContext.Provider, { value: "preprod" }, element));

/** The class of the span whose text starts with `start`, as React writes it (an apostrophe is &#x27;). */
function classOf(markup: string, start: string): string | undefined {
  const escaped = start.replace(/'/g, "&#x27;").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<span class="([^"]*)">${escaped}[^<]*</span>`).exec(markup)?.[1];
}

const classes = (c: string | undefined) => (c ?? "").split(/\s+/).filter(Boolean);
const WARNED = ["token-row__sub", "wrap", "token-row__sub--warn"];

describe("gap-g10#3: a lookalike token's warning in the pickers", () => {
  const text = tokenText("preprod", lookalike);
  const view = viewToken("preprod", lookalike);
  const warning = "Calls itself tUSDM, not on the wallet's list";

  it("the control: Home's list gives the lookalike's warning its wrap and warn classes", () => {
    expect(text.posesAs, "the stranger's tUSDM passes for the listed one").toBe("tUSDM");
    expect(view.label, "it goes by its fingerprint").toBe(text.id);
    expect(view.sub).toBe(warning);
    expect(view.warn).toBe(true);
    const home = classOf(html(createElement(TokenList, { tokens, of: "seedelf", testId: "tokens", onViewAll: noop })), warning);
    expect(home, "Home's row carries the warning line").toBeDefined();
    expect(classes(home)).toEqual(expect.arrayContaining(WARNED));
  });

  it("the Add tokens picker gives it the same classes, so it shows whole, in the warning's colour", () => {
    const markup = html(createElement(TokenPicker, { tokens, onClose: noop, onPick: noop }));
    expect(markup, "the picker lists the token by its fingerprint").toContain(`aria-label="${text.id}"`);
    const picker = classOf(markup, warning);
    expect(picker, "the picker's row carries the warning line").toBeDefined();
    expect(classes(picker), "the picker's warning line").toEqual(expect.arrayContaining(WARNED));
  });

  it("the swap's pay picker gives its mark the same classes", () => {
    const markup = html(createElement(TokenSelect, { which: "pay", seedelf, onPick: noop, onClose: noop }));
    const swap = classOf(markup, "Not on the wallet's list: it calls itself tUSDM, but it isn't the listed tUSDM");
    expect(swap, "the swap's row carries the mark").toBeDefined();
    expect(classes(swap), "the swap's mark line").toEqual(expect.arrayContaining(WARNED));
  });
});
```
