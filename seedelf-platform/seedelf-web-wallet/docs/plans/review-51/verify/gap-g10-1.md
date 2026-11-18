# gap-g10#1: verification

From lane gap-G10, graded low by its finder.

## Trace: confirmed, low

The finding holds as described. I traced it end to end, and no guard, caller or type stops it.

Tokens:
- tokenName (format.ts:44) refuses only C0/C1 controls, so U+2003, U+3000 and U+00A0 survive.
- HIDDEN (tokens.ts:159) matches Cf and Default_Ignorable only, and these are Zs, so the name counts as readable (tokens.ts:113-114).
- nameSkeleton's NFKD turns each into U+0020 and drops it (format.ts:71, 80). "SNEK" + 9 EM SPACE + "x" therefore becomes "snekx", which misses every whole-skeleton entry. The digit-lead rules don't apply, and the ADA-word rule covers ADA only (tokens.ts:201-219).
- So posesAs is undefined and the label is the padded name itself (tokens.ts:117).
- That label is what TokenRow, the Add tokens picker, the swap picker and the swap button show. Each puts it in a nowrap, ellipsis box (styles.css:1811-1816).
- CSS collapses only U+0020, tabs and line breaks. Inter's own unicode-range covers U+2000-206F (styles.css:14), so each em space draws 1em wide.
- I measured it myself with the real stylesheet. At Chrome's default side panel width of 360 px (e2e/support.ts:663), with 1,000,000 units, the x isn't drawn.

DReps:
- dreps.mjs's nameOf and the worker's drepName (staking.ts:306) strip only controls and trim. plainName strips only Cf and Default_Ignorable and trims (format.ts:87).
- sharedNames counts by skeleton, so "8ballx" is not counted with the two real "8Ball" DReps on the mainnet list.
- The impostor's row therefore gets no "Shared name" tag, and its label is cut at both 360 and 400 px.

Not known: no entry in the backlog, the archived reviews or the review-51 data, and SECURITY.md doesn't exclude it.

Low, as the finder graded it:
- Anyone can reach it, free for a token. A DRep costs a 500 ₳ refundable deposit and waits for the next release's list refresh.
- No ADA moves, and the wallet signs what it shows. Reviews show the whole name with the grey "not on the wallet's list" mark, and the details screen says the token isn't on the list.
- Other tells remain: an initials avatar instead of SNEK's logo, the fingerprint on the second line instead of "Snek", and the ellipsis itself.
- Harm needs a user fooled outside the wallet (for example, a trade paid in fake SNEK), or a vote delegated to the wrong DRep, which can be changed any time.
- What it does defeat is launch review #18's lookalike guard in every one-line list.

**Evidence:**

Trace (TREE at 140886c9; code identical to web-wallet/1.9.1 apart from manifest.ts):

Tokens:
- tokens.ts:110 `const own = tokenName(t.assetName);`
- format.ts:44 `if (text && !/[\u0000-\u001f\u007f-\u009f]/.test(text)) return text;` lets the wide spaces through.
- tokens.ts:113-114: `readable` is true. HIDDEN (tokens.ts:159) is `/[\p{Cf}\p{Default_Ignorable_Code_Point}]/u`, and U+2003, U+3000 and U+00A0 are all Zs.
- tokens.ts:116, then lookalikeOf:
  - :201 `nameSkeleton(own)` gives "snekx" (format.ts:80: NFKD maps U+2003, U+3000 and U+00A0 to U+0020, and :71 drops it).
  - :204 has no whole match.
  - :209-213: AMOUNT_LEAD and FOLDED_LEAD don't match a name that starts with "S".
  - :216-218: the words are ["snek", "x"], and only ADA's words count.
  - So it returns undefined.
- tokens.ts:117: the label is the padded own name. viewToken:264 copies it.

Where that label is shown:
- TokenList.tsx:55 (Home and the Tokens page)
- TokenAmounts.tsx:211/267 (the picker)
- Swaps.tsx:170/569/644/1911 (the swap's pickers and button)
- styles.css:1811-1816 `.token-row__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`
- styles.css:14: Inter's unicode-range includes U+2000-206F.
- Home doesn't filter unlisted tokens (Home.tsx:794-795, 969-980, 1102-1113).

DReps:
- dreps.mjs nameOf and staking.ts:306-315 drepName only strip controls, trim and cut to 64 characters.
- dreps.ts:39 searchDreps finds "8Ball…x" for the query "8ball".
- Voting.tsx:104 `sharedNames(dreps, d => d.name)`, and :359 `shared={sharing(shared, d.name) > 1}`.
- Voting.tsx:402/415 show `plainName(drep.name)` in `.token-row__label`.
- src/dreps/mainnet.json (recorded 2026-11-10) holds two "8Ball" DReps, drep1y296z8tm… and drep1y296zyw2…, so both get the tag.

Test run (TREE, the new test only): 2 tests, 2 failed, 5 assertion failures:
- tUSDM + 8 EM, MIN + 9 IDEOGRAPHIC and tUSDM + 13 NBSP on preprod, and SNEK + 9 EM on mainnet: each "posesAs undefined", its label keeping the run.
- The DRep: "flagged false, label "8Ball …x"".

Layout, measured with a scratch page in headless Chrome, under a 4G cap, 90 s timeout and no network. It used TREE's real styles.css with the bundled Inter embedded (document.fonts.check true) and Home's real nesting: .app--panel > .home > .stack > .section > .stack-tight > .list > .token-row.
- home-fake-360 at 1,000,000: box 164.9 px, text 172 px, last letter starts at 164.0 px, not drawn.
- The listed SNEK row beside it fits (165 px).
- 400 px at 1,000,000: fits (box 204.9 px).
- 360 px at 100,000: fits (box 177.8 px).
- 400 px at 1,000,000,000: fits, just (box 173.9 px). A larger quantity, which the stranger picks, cuts it at 400 px too.
- DRep row in Voting's nesting (.screen > .screen__body > form > .list): box 270 px at 360 and 310 px at 400, text 602 px, the x not drawn. The finder's 236/276 px likely included a card, and it is cut either way.

Fix check, in a copy under ~/.cache/seedelf-review-51 (since removed): collapsing `\s+` to one space in plainName and in tokenText's own-name label makes the new test pass, and token-text.test.ts and ui-safety.test.ts stay green.

Since: ead12610 (2026-09-27; tokens.ts:113, 115-117 and format.ts:86-88 blame to it) and e788144e (sharedNames). Both are ancestors of web-wallet/1.9.1.

**Known:** None found. I searched for: em space, wide space, ideographic, U+2003, U+3000, U+00A0, no-break space, padded/padding, blank, white space, braille, lookalike, poses as, passes for, confusable, ellipsis, truncate, cut, long name, 8Ball and SNEK. The places searched:
- seedelf-platform/seedelf-web-wallet/docs/backlog.md
- docs/archive/plans/*.md: launch-review #18, #19 and #59 (all fixed), and usability-review V-6/H-9
- docs/plans/
- review-51's INDEX, lanes and data
- SECURITY.md's out-of-scope list

The closest are launch review #18 (the lookalike helper this bypasses), #59 (the shared DRep names this bypasses) and review-51's e9b#1 (Greek capitals the fold misses, a different gap in the same family). None of them weighs blank padding.

**Fix notes:**

Fix the class: a name a list shows by its own words must not keep blank runs that the browser draws but doesn't collapse.

1. Collapse runs in the display label only. In tokenText, return `label: own.replace(/\s+/gu, " ")` in the own-name branch, and do the same in plainName (format.ts:87), which DReps and pools use.
   - Don't collapse `own` itself. My first sketch did, and it broke token-text.test.ts's " 000 ADA" (NBSP) lead case, because the amber mark quotes `own` verbatim.
   - `\s` covers every Zs character plus U+FEFF. U+2800 BRAILLE PATTERN BLANK (So) isn't white space or Default_Ignorable, so it would pass. If the owner wants the whole class, add it to a "draws nothing" set. The finder didn't render it, and neither did I.
2. The same applies at entry: the worker's drepName (staking.ts:306) and its copy, dreps.mjs's nameOf. The test reads the list's name through drepName, so a fix there passes it too.
3. Optionally, have the lookalike rule also try a name's first word against listed names ("SNEK x" would then go by its fingerprint). That widens a rule, so it's the owner's call.
4. The alternative the finder names, a middle cut in .token-row__label, .swap-token__name and .modal__title, keeps names' tails. It can't be checked in Vitest; this test pins only the logic-level fixes (1 to 3). If the owner picks the CSS route, this test doesn't apply and a layout check is needed instead.

No refusal is added and no privacy default changes. Collapsing blanks changes only how a stranger-chosen name is drawn.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension/tests/r51-gap-g10-1.test.ts`

Result: Run from extension/ with `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m npx vitest run tests/r51-gap-g10-1.test.ts`. It fails on TREE, as intended:

 RUN  v5.0.3 .../seedelf-web-wallet/extension
 ❯ tests/r51-gap-g10-1.test.ts (2 tests | 2 failed) 58ms
   ❯ gap-g10#1: blanks the browser keeps never push a name's last letters out of a one-line list (2)
     × a stranger's token, padded after a listed token's name 39ms
     × a DRep, padded after a name two others share 18ms
AssertionError: "tUSDM        x" on preprod: label "tUSDM        x", posesAs undefined: expected 'tUSDM        x' not to match /\s{2,}/u
AssertionError: "MIN　　　　　　　　　x" on preprod: label "MIN　　　　　　　　　x", posesAs undefined: expected 'MIN　　　　　　　　　x' not to match /\s{2,}/u
AssertionError: "tUSDM             x" on preprod: label "tUSDM             x", posesAs undefined: expected 'tUSDM             x' not to match /\s{2,}/u
AssertionError: "SNEK         x" on mainnet: label "SNEK         x", posesAs undefined: expected 'SNEK         x' not to match /\s{2,}/u
AssertionError: the padded 8Ball's row, flagged false, label "8Ball                                        x": expected '8Ball                                …' not to match /\s{2,}/u
 Test Files  1 failed (1)
      Tests  2 failed (2)

The output is saved in /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad/r51/work/verify-gap-g10_1-trace/vitest-run-1.txt.

With the fix sketch in a copy (plainName and tokenText's own-name label collapsing `\s+` to one space), the new test, token-text.test.ts and ui-safety.test.ts all pass. The copy has since been removed.

The 8 failures in r51-e9b-1 are that test's own: it failed the same way in the copy without my sketch.

```
// Chunk 51, gap-g10#1: blanks the browser keeps must never push a name's last letters out of a one-line list.
// `white-space: nowrap` collapses only U+0020, tabs and line breaks, so an EM SPACE (U+2003), an IDEOGRAPHIC SPACE
// (U+3000) or a NO-BREAK SPACE (U+00A0) keeps its width. nameSkeleton drops them (NFKD makes each a U+0020), so a
// stranger's token named "SNEK" + 9 EM SPACEs + "x" (32 bytes, the asset-name limit) has the skeleton "snekx", isn't
// kept apart as passing for SNEK, and goes by its own name: Home's row, the Tokens page, the Add tokens picker and
// the swap's button cut it with an ellipsis to "SNEK        …" at the side panel's 360 px, the x gone. A DRep named
// "8Ball" + 40 EM SPACEs + "x" isn't counted with the two 8Balls, so its row has no "Shared name" tag, and the row
// shows "8Ball        …". The right behaviour, whichever fix: a name a list shows by its own words has its blanks
// as one, so its last letters fit; or it's kept apart (a token as a lookalike, by its fingerprint; a DRep flagged as
// sharing the name).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { drepName } from "../src/background/staking";
import type { TokenAmount } from "../src/shared/rpc";
import { plainName, sharedNames, sharing } from "../src/ui/format";
import { DrepRow } from "../src/ui/screens/Voting";
import { assetFingerprint, tokenText, viewToken } from "../src/ui/tokens";

const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");
const STRANGER = "e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9";

const EM = " "; // EM SPACE: 1em wide, in Inter (styles.css's unicode-range takes U+2000-206F)
const IDEOGRAPHIC = "　"; // IDEOGRAPHIC SPACE
const NBSP = " "; // NO-BREAK SPACE

/** What `white-space: nowrap` draws of a label: runs of U+0020, tabs and line feeds as one space; other blanks stay. */
const asDrawn = (label: string) => label.replace(/[ \t\n]+/g, " ");
/** Two blanks or more in a row once drawn: JavaScript's \s holds every Unicode space separator. */
const BLANK_RUN = /\s{2,}/u;

/** A stranger's token, 1,000,000 of it, as the balances hold it. */
const held = (name: string): TokenAmount => {
  const ref = { policyId: STRANGER, assetName: hex(name) };
  return { ...ref, quantity: "1000000", decimals: 0, fingerprint: assetFingerprint(ref) };
};

describe("gap-g10#1: blanks the browser keeps never push a name's last letters out of a one-line list", () => {
  it("a stranger's token, padded after a listed token's name", () => {
    const cases: Array<["preprod" | "mainnet", string]> = [
      ["preprod", `tUSDM${EM.repeat(8)}x`],
      ["preprod", `MIN${IDEOGRAPHIC.repeat(9)}x`],
      ["preprod", `tUSDM${NBSP.repeat(13)}x`],
    ];
    // The finder's own case, on the mainnet list: a preprod-only build has none.
    if (__MAINNET_ENABLED__) cases.push(["mainnet", `SNEK${EM.repeat(9)}x`]);
    for (const [network, name] of cases) {
      // A name the ledger takes: at most 32 bytes.
      expect(Buffer.byteLength(name, "utf8"), name).toBeLessThanOrEqual(32);
      const token = held(name);
      const text = tokenText(network, token);
      // What Home's and the Tokens page's rows and the Add tokens picker show (viewToken), and the swap's button (tokenText).
      const label = viewToken(network, token).label;
      expect(label).toBe(text.label);
      // Kept apart, it goes by its fingerprint; by its own name, its blanks must draw as one.
      const shown = text.posesAs ? label : asDrawn(label);
      expect
        .soft(shown, `${JSON.stringify(name)} on ${network}: label ${JSON.stringify(label)}, posesAs ${text.posesAs}`)
        .not.toMatch(BLANK_RUN);
    }
  });

  it("a DRep, padded after a name two others share", () => {
    const EIGHT_A = "drep1y296z8tm7y7elwsmsewn4q2tdr5gu0fqztq97yttlpv7zycvsl554";
    const EIGHT_B = "drep1y296zyw2r8rcsy7slkd7l687hh88xc0m6ac2y3h2r3mvsdgc9q6yy";
    const IMPOSTOR = `drep1y2${"q".repeat(51)}`;
    const givenName = `8Ball${EM.repeat(40)}x`;
    // What the list keeps of its CIP-119 givenName: the worker's drepName, whose copy is dreps.mjs's nameOf.
    const stored = drepName(givenName);
    expect(stored).toBeDefined();
    const list = [
      { id: EIGHT_A, name: "8Ball" },
      { id: EIGHT_B, name: "8Ball" },
      { id: IMPOSTOR, name: stored! },
    ];
    // Counted, and each row flagged, as Voting and DrepSearch do.
    const counts = sharedNames(list, (d) => d.name);
    const row = (d: { id: string; name: string }) =>
      renderToStaticMarkup(
        createElement(DrepRow, { drep: d, shared: sharing(counts, d.name) > 1, disabled: false, onPick: () => undefined }),
      );
    for (const d of list.slice(0, 2)) expect(row(d)).toContain("Shared name");
    const html = row(list[2]!);
    const label = /<span class="token-row__label">([^<]*)<\/span>/.exec(html)?.[1];
    expect(label).toBe(plainName(stored!));
    const flagged = html.includes("Shared name");
    expect(flagged ? "" : asDrawn(label!), `the padded 8Ball's row, flagged ${flagged}, label ${JSON.stringify(label)}`).not.toMatch(
      BLANK_RUN,
    );
  });
});
```
