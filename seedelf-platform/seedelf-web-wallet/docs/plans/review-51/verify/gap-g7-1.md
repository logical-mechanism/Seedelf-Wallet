# gap-g7#1: verification

From lane gap-G7, graded low by its finder.

## Trace: confirmed, low

The finding holds. I traced every file it cites in TREE: the source is unchanged from cd764fba and the 1.9.1 tag, apart from #387's manifest change. No guard is missing from the finder's account.

**What holds**
- `voteLabel` (`format.ts:434-439`) returns the DRep's own name for any DRep: `return name ?? shortId(drep)`. That name is a CIP-119 givenName. The bundled list's generator (`dreps.mjs` `nameOf`) and the live read (`staking.ts:306-315`) strip only C0/C1 controls, then trim and cut to 64 characters.
- So a stranger's DRep named "Always abstain" reads exactly like the predefined Always Abstain on:
  - the vote review's strong row, "Voting power to / Always abstain" (`Staking.tsx:973`);
  - Activity's line and its "Voting power" row, where the ID is only a tooltip (`activity.ts:128-138`, `Activity.tsx:280` and `:341-343`);
  - the CSV's Vote column (`activity.ts:232`);
  - Delegation history, "Voting power to Always abstain" (`Delegations.tsx:66-69`, `:117-121`).
- The same goes for "Always no confidence", and for the es and ja labels.
- No shared-name warning fires. `drepSharing` (`Voting.tsx:444-449`) gives `shared` = 1 both for a DRep listed under a unique name and for a pasted, unlisted one. The review warns only when `shared > 1` (`Staking.tsx:1070`), and `sharedNames` never counts the wallet's own labels.
- On the review, the one difference from the pinned choice is the "DRep ID" block (`Staking.tsx:1069`). The pinned choice has an ID that doesn't start with `drep1`, so it gets no block. The no-confidence review also loses its standing-vote note, which a user won't miss.
- The finder's figures check out by run: the name sorts 39th of 467 with the generator's own sort, and it's the only hit for "abstain" and for "always". By skeleton, no bundled name today matches or contains any of the 12 labels.
- Nothing covers this case: `tests/dreps.test.ts:17-33` checks only controls, length, trim and sort, and `ui-safety.test.ts`'s shared-name tests compare DReps with each other only.

**Where it's narrower than the scenario says**
1. Activity, the CSV and Delegations name a DRep only from the bundled list (`activity.ts:118-120`). So on path 2 (a pasted ID) only the review collides until a later release's list ships that DRep. Path 2 also needs the stranger to hand the user its ID, which is social engineering and out of SECURITY.md's scope. Path 1, the wallet's own list, needs no contact with the user.
2. Home's staking row (`Home.tsx:1270`) also shows the short ID, alongside Staking's "Delegated to" (`:594`) and Voting's "now" line (`:174`). The account's current vote reads honestly on all three; only the review's strong row and the history views collide.
3. "Not delegated" isn't a same-surface collision: no review, Activity or Delegations screen shows it for a real state. It produces wrong words ("Voting power to Not delegated") rather than a twin label.
4. "Your own DRep" does collide on the review, where both reviews carry the ID block, and in Delegations, where only the case differs. But the wallet passes its own `t("drep.yourOwn")` through the same `name` parameter (`Staking.tsx:618`, `Voting.tsx:190`). The test can't hold that case without assuming the fix's API, so it's left out of the test.

**Not known or settled**
- `backlog.md` has nothing.
- `archive/plans` has only:
  - `launch-review.md:284` (#59, DReps sharing "8Ball", fixed by flagging shared names);
  - `usability-review.md` GV-5 (DRep against DRep);
  - chunk 36's row wording.
- `review-51/INDEX.md` lists only this finding.
- The owner's rules don't touch it: the fix adds no refusal, only a wording change and maybe a warning.
- The token side already has this exact guard (`tokens.ts:105-121`, "calls itself"), so this is a gap in a guard family the owner already accepted.

**Grade: low, agreeing with the finder.**
- **Who can reach it:** a stranger. They pay the 500 ₳ DRep deposit, which comes back, publish a givenName, and wait for the next release's `npm run dreps`. The release's only check is development.md:330's "Skim the diff for anything odd".
- **The user's part:** the user must actively pick "A DRep", the fourth option, and that row. The real Always abstain is the first option and the default for an account whose vote isn't delegated. The card then shows the DRep's status, voting power, delegators and full ID.
- **What it costs:** the user's stake votes Yes or No as the stranger chooses until they notice. No ADA moves, and rewards stay withdrawable.
- **The way out:** Home, Staking and Voting show the DRep's short ID, and re-delegating costs only the fee.
- **Today:** no such DRep is on either list, so there's no reachable harm today. That is the brief's "low".

**Evidence:**

**Trace, with file:line in TREE** (`seedelf-platform/seedelf-web-wallet/extension/`)

1. **Where the name enters**
   - `background/staking.ts:415-431`: `drep()` reads `koios.drepNames` and calls `drepName(givenName)`.
   - `staking.ts:306-315`: `text?.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim()`, then `slice(0, 64)`.
   - `scripts/dreps.mjs:65-75` (`nameOf`) does the same, and `:94-112` keeps any row with a name. No other filter exists.
2. **Picking the DRep**
   - `Voting.tsx:186-195`: `onVote(chosen, pick === "own" ? t("drep.yourOwn") : pick === "drep" && drep?.name ? plainName(drep.name) : undefined, ...)`.
   - `Staking.tsx:448-452` hands `drepName` and `shared` to the review.
3. **The review**
   - `Staking.tsx:972-974`: `<Row label={t("staking.review.voteTo")} value={voteLabel(summary.drep, drepName)} ... strong />`. Here `summary.drep` is WebAssembly's CIP-129 ID (`wasm/src/lib.rs:1772`, `:6617-6623`).
   - `format.ts:434-439`: `if (drep === ALWAYS_ABSTAIN) return t("format.vote.abstain"); ... return name ?? shortId(drep);`.
   - `Staking.tsx:1069`: `summary.drep?.startsWith("drep1") && <ReviewId .../>`. The pinned `drep_always_abstain` gets no block.
   - `Staking.tsx:1070`: the warning shows only when `shared > 1`.
   - `Voting.tsx:444-449`: `drepSharing` returns `sharing(shared, drep.name) + (listed ? 0 : 1)`, which is 1 on both paths.
4. **Afterwards**
   - `activity.ts:118-120`: `drepName` reads `drepList(network)` only.
   - `activity.ts:128-130`: `voteOf` calls `voteLabel(s.drep, drepName(...))`.
   - Callers: `stakingLine` (`:133-138`) feeds `Activity.tsx:280`; `Activity.tsx:341-343` is the "Voting power" row, ID only in `title=`; `activity.ts:232` is the CSV.
   - `Delegations.tsx:66-69`: `voteText` calls `voteLabel(row.drep, drepName(network, row.drep))`, and `:120-121` writes "Voting power to {{drep}}".
5. **Surfaces that stay honest**
   - `Home.tsx:1270`, `Staking.tsx:594` and `Voting.tsx:174` pass a name only for the account's own DRep.
   - `ui/dapp.ts:200` calls `voteLabel(c.drep)` with no name.
6. **Labels**
   - en.json: format.vote.abstain 'Always abstain', format.vote.noConfidence 'Always no confidence', format.vote.notDelegated 'Not delegated', drep.yourOwn 'Your own DRep', staking.review.voteTo 'Voting power to'.
   - es.json: 'Siempre abstenerse', 'Siempre sin confianza', 'Sin delegar', 'Tu propio DRep'.
   - ja.json: '常に棄権', '常に不信任', '未委任', '自分の DRep'.

**Commands run** (scratch folder `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad/r51/work/verify-gap-g7_1-trace/`)
- `node g71_sort_check.mjs .../src/dreps/mainnet.json`:
  ```
  position of 'Always abstain': 39 of 467
  search 'abstain': 1 [ 'Always abstain' ]
  search 'always': 1 [ 'Always abstain' ]
  ```
- `node g71_skeleton_scan.mjs <extension>` (a copy of `nameSkeleton`, checked against all 12 labels):
  ```
  mainnet 466 names; equal to or containing a label's skeleton: 0 []
  preprod 67 names; equal to or containing a label's skeleton: 0 []
  ```
- The Vitest file below, on TREE: 12 failed, 1 passed.
- The same file in a copy (`$HOME/.cache/seedelf-review-51/verify-gap-g7_1-trace`, since removed), with a sketch fix in `voteLabel` (short ID plus "calls itself" for a name whose skeleton equals a pinned label in any bundle): 13 passed.

**Known check**
- Searched `backlog.md` for: abstain, impersonat, pinned choice, predefined, calls itself, poses as / pose as / posing, givenName, sharedNames, drepSharing, lookalike, `DRep.{0,40}name`. The only hit is Minswap's impersonation line, which is unrelated.
- Searched `archive/plans/` for: impersonat, calls itself, DRep name, #59, voteLabel, and "Always abstain" near DRep or name. Hits:
  - `launch-review.md:284` (#59);
  - `usability-review.md:580` (GV-5);
  - `chunk-36-delegation-history.md:17`;
  - chunk-13's list design.
  None of these is about a DRep named like a pinned choice.
- `review-51/INDEX.md:392` is this finding.
- `SECURITY.md` excludes social engineering, which covers path 2 only.
- `development.md:330`: the release's only check on the list is "Skim the diff for anything odd before committing it".

**Known:** none: not settled or known. The nearest items are launch-review.md:284 (#59, DReps that share a name, fixed by the shared-name flag) and usability-review.md GV-5. Both are about one DRep against another, never a DRep against the wallet's own labels. SECURITY.md's social-engineering exclusion covers only path 2 (a stranger handing the user its ID).

**Fix notes:**

**1. Fix it once in `voteLabel` (`format.ts:434`).** All three surfaces go through it: the review, `activity.ts` voteOf and the CSV, and `Delegations.tsx` voteText.
- When a DRep's name has the same `nameSkeleton` as `format.vote.abstain`, `format.vote.noConfidence` or `format.vote.notDelegated` in any bundled language, show its short ID and what it calls itself, as `tokens.ts:105-121` does for a token named like ADA.
- Build the set from `i18n/translations` `bundles`, not from `t()`, so a Spanish name still trips an English user's wallet.
- Compare after the 64-character cut.
- This sketch, run in a copy, passes all 13 cases.

**2. "Your own DRep" needs its own flag.** `Staking.tsx:618` and `Voting.tsx:190` pass `t("drep.yourOwn")` through the same `name` parameter, so `voteLabel` can't tell the wallet's label from a stranger's name.
- Pass an `own` flag, or have the review compare `summary.drep` with the account's own DRep ID.
- Then treat `drep.yourOwn`'s skeleton as reserved too.
- `Delegations.tsx` already uses `row.ownDrep`, its own flag.

**3. Optionally warn on the card and the review.** Count such a name in `drepSharing` (`Voting.tsx:444`), or add a warning of its own, so the card and the review say it before signing.

**4. Optionally flag it at release.** `dreps.mjs` could print any name that reads as one of these labels, for development.md:330's "skim the diff". It shouldn't drop the name: the owner's rule refuses only what the ledger refuses.

**5. Fold in gap-g7#3.** Apply `plainName` in the same `voteLabel` path.

**For the owner:** this needs the owner's call, because it changes what the review, Activity and Delegations show for a DRep. I didn't run the related suites (`ui-safety`, `delegations-screen`) against the sketch, since the brief allows only this test. Their current assertions use names that don't read as pinned labels, so they should be unaffected.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension/tests/r51-gap-g7-1.test.ts`

Result: Run from `extension/` as `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m npx vitest run tests/r51-gap-g7-1.test.ts --reporter=verbose`.

**On TREE: 12 of 13 fail.** The one that passes checks that the pinned choices still read as themselves.
```
 ✓ ... voteLabel, the words every surface shares > still says each pinned choice in the wallet's words
 × ... voteLabel ... > never reads a DRep named Always abstain as the pinned drep_always_abstain
 × ... voteLabel ... > never reads a DRep named Always no confidence as the pinned drep_always_no_confidence
 × ... voteLabel ... > never reads a DRep named Not delegated as a vote that isn't delegated
 × ... voteLabel ... > nor in Spanish or Japanese, with their own words
 × ... the vote's review > doesn't say a vote to a DRep named Always abstain is the pinned choice on its main row
 × ... the vote's review > doesn't say a vote to a DRep named Always no confidence is the pinned choice on its main row
 × ... afterwards ... > Activity's line and Voting power row don't call a DRep named Always abstain the pinned choice
 × ... afterwards ... > Activity's line and Voting power row don't call a DRep named Always no confidence the pinned choice
 × ... afterwards ... > the CSV's Vote column doesn't call a DRep named Always abstain the pinned choice
 × ... afterwards ... > the CSV's Vote column doesn't call a DRep named Always no confidence the pinned choice
 × ... afterwards ... > Delegation history doesn't call a vote to a DRep named Always abstain the pinned choice
 × ... afterwards ... > Delegation history doesn't call a vote to a DRep named Always no confidence the pinned choice
AssertionError: a DRep named "Always abstain": expected true to be false
AssertionError: "Always abstain" against "Always abstain": expected true to be false
AssertionError: "Always no confidence" against "Always no confidence": expected true to be false
AssertionError: the line: expected true to be false
AssertionError: "Voting power to Always abstain" against "Voting power to Always abstain": expected true to be false
AssertionError: "Voting power to Always no confidence" against "Voting power to Always no confidence": expected true to be false
 Test Files  1 failed (1)
      Tests  12 failed | 1 passed (13)
```

**In a copy with a sketch fix: all 13 pass.** The copy was at `$HOME/.cache/seedelf-review-51/verify-gap-g7_1-trace`, with node_modules linked to TREE's. Its `voteLabel` returns `${shortId(drep)} (calls itself ${name})` when the name's skeleton equals the abstain, no-confidence or not-delegated label in any bundle.
```
 Test Files  1 passed (1)
      Tests  13 passed (13)
```
The copy has been removed. TREE has no tracked changes; the only file added is this test.

```
// Chunk 51, gap-g7#1: a DRep whose own name is the wallet's word for a pinned
// choice must not read as that choice.
//
// voteLabel (ui/format.ts) puts a DRep's name where the wallet's own label
// goes, word for word: `return name ?? shortId(drep)`. A DRep's name is its
// CIP-119 givenName, any text (scripts/dreps.mjs and background/staking.ts
// drop only control characters). So a stranger's DRep named "Always abstain"
// reads, on the vote's review and afterwards in Activity's line, its Voting
// power row, the CSV and Delegation history, exactly as the predefined Always
// Abstain does, though the certificate gives that stranger the account's
// whole voting power. Compared the way the wallet tells DRep names apart
// (nameSkeleton), so a fix that shows the ID and what the DRep calls itself,
// or names it as a DRep, passes; the pinned choices must still read as
// themselves.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { i18n, t } from "../src/i18n/core";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import {
  ALWAYS_ABSTAIN,
  ALWAYS_NO_CONFIDENCE,
  type ActivityEntry,
  type DelegationRow,
  type StakingSummary,
} from "../src/shared/rpc";
import { activityCsv, stakingLine, voteOf } from "../src/ui/activity";
import { drepList } from "../src/ui/dreps";
import { nameSkeleton, voteLabel } from "../src/ui/format";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import { DelegationList } from "../src/ui/screens/Delegations";
import { StakingReview } from "../src/ui/screens/Staking";

/** A stranger's DRep (CIP-129 form), on neither bundled list. */
const STRANGER = `drep1y2strangerdrep${"q".repeat(39)}`;
const NETWORK = "preprod";

/** The two pinned choices, by the ID Koios gives each, and the name a stranger's DRep takes to read as it. */
const PINNED = [
  { choice: ALWAYS_ABSTAIN, name: "Always abstain" },
  { choice: ALWAYS_NO_CONFIDENCE, name: "Always no confidence" },
] as const;

/** Whether two texts read alike, as the wallet's shared-name rule compares DRep names (format.ts nameSkeleton). */
const readsAs = (a: string | undefined, b: string | undefined) =>
  a !== undefined && b !== undefined && nameSkeleton(a) === nameSkeleton(b);

/** The stranger's DRep on the wallet's own list under `name`, as the next release's `npm run dreps` would ship it. */
function listed<T>(name: string, run: () => T): T {
  const { dreps } = drepList(NETWORK);
  dreps.push({ id: STRANGER, name });
  try {
    return run();
  } finally {
    dreps.splice(
      dreps.findIndex((d) => d.id === STRANGER),
      1,
    );
  }
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();

/** The vote's review as Staking renders it, for a vote to `drep` named (or not) as Voting passes it. */
function review(drep: string, drepName?: string): string {
  const summary: StakingSummary = {
    network: NETWORK,
    txHash: "ab".repeat(32),
    action: { kind: "vote", drep },
    pool: null,
    drep,
    fee: "180000",
    deposit: "0",
    refund: "0",
    withdrawal: "0",
    changeLovelace: "1000000",
    changeTokens: 0,
    inputs: 1,
  };
  return renderToStaticMarkup(
    createElement(StakingReview, {
      summary,
      ...(drepName ? { drepName } : {}),
      shared: drepName ? 1 : 0,
      drepListed: true,
      busy: false,
      onBack: () => undefined,
      onSend: () => undefined,
    }),
  );
}

/** The review's main row, "Voting power to": its value. */
function mainRow(html: string): string {
  const label = t("staking.review.voteTo");
  const row = html.match(new RegExp(`<dt>${label}</dt><dd[^>]*>(.*?)</dd>`));
  expect(row, "the review's Voting power to row").not.toBeNull();
  return text(row![1]!);
}

/** A vote delegation in Activity, as the worker hands it over from the chain. */
const voteEntry = (drep: string): ActivityEntry => ({
  txHash: "cd".repeat(32),
  at: Date.UTC(2026, 9, 1, 12),
  kind: "vote",
  direction: "none",
  lovelace: "0",
  tokens: 0,
  fee: "180000",
  staking: { drep },
});

/** The CSV's Vote column for that entry. */
function csvVote(drep: string): string {
  const [header, row] = activityCsv(NETWORK, [voteEntry(drep)]).replace(/^U+FEFF/, "").split("\r\n");
  const column = header!.split(",").indexOf(t("activity.csv.vote"));
  expect(column).toBeGreaterThan(0);
  return row!.split(",")[column]!;
}

/** Delegation history's row for a vote delegation to `drep`: its words, as the list shows them. */
function delegationRow(drep: string): string {
  const row: DelegationRow = { kind: "vote", drep, txHash: "ef".repeat(32), at: Date.UTC(2026, 9, 1, 12), epoch: 320 };
  const element: ReactElement = createElement(DelegationList, { rows: [row] });
  const html = renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: NETWORK },
      createElement(
        PreferencesContext.Provider,
        { value: { prefs: DEFAULT_PREFERENCES, loaded: true, set: async () => undefined } },
        element,
      ),
    ),
  );
  const label = html.match(/<span class="token-row__label activity__title"[^>]*>(.*?)<\/span>/);
  expect(label, "the delegation's row").not.toBeNull();
  return text(label![1]!);
}

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("voteLabel, the words every surface shares", () => {
  it("still says each pinned choice in the wallet's words", () => {
    expect(voteLabel(ALWAYS_ABSTAIN)).toBe("Always abstain");
    expect(voteLabel(ALWAYS_NO_CONFIDENCE)).toBe("Always no confidence");
    expect(voteLabel(null)).toBe("Not delegated");
    // An ordinary name is still shown.
    expect(voteLabel(STRANGER, "8Ball")).toContain("8Ball");
  });

  it.each(PINNED)("never reads a DRep named $name as the pinned $choice", ({ choice, name }) => {
    for (const as of [name, name.toUpperCase(), `${name}.`]) {
      expect(readsAs(voteLabel(STRANGER, as), voteLabel(choice)), `a DRep named "${as}"`).toBe(false);
    }
  });

  it("never reads a DRep named Not delegated as a vote that isn't delegated", () => {
    expect(readsAs(voteLabel(STRANGER, "Not delegated"), voteLabel(null))).toBe(false);
  });

  it("nor in Spanish or Japanese, with their own words", async () => {
    await i18n.changeLanguage("es");
    expect(voteLabel(ALWAYS_ABSTAIN)).toBe("Siempre abstenerse");
    expect(readsAs(voteLabel(STRANGER, "Siempre abstenerse"), voteLabel(ALWAYS_ABSTAIN))).toBe(false);
    await i18n.changeLanguage("ja");
    expect(voteLabel(ALWAYS_ABSTAIN)).toBe("常に棄権");
    expect(readsAs(voteLabel(STRANGER, "常に棄権"), voteLabel(ALWAYS_ABSTAIN))).toBe(false);
  });
});

describe("the vote's review", () => {
  it.each(PINNED)("doesn't say a vote to a DRep named $name is the pinned choice on its main row", ({ choice, name }) => {
    const pinned = mainRow(review(choice));
    expect(pinned).toBe(name);
    const stranger = mainRow(review(STRANGER, name));
    expect(readsAs(stranger, pinned), `"${stranger}" against "${pinned}"`).toBe(false);
  });
});

describe("afterwards, from the wallet's own list", () => {
  it.each(PINNED)("Activity's line and Voting power row don't call a DRep named $name the pinned choice", ({ choice, name }) => {
    listed(name, () => {
      expect(readsAs(stakingLine(NETWORK, { drep: STRANGER }), stakingLine(NETWORK, { drep: choice })), "the line").toBe(false);
      expect(readsAs(voteOf(NETWORK, { drep: STRANGER }), voteOf(NETWORK, { drep: choice })), "the Voting power row").toBe(false);
    });
  });

  it.each(PINNED)("the CSV's Vote column doesn't call a DRep named $name the pinned choice", ({ choice, name }) => {
    listed(name, () => {
      expect(csvVote(choice)).toBe(name);
      expect(readsAs(csvVote(STRANGER), csvVote(choice))).toBe(false);
    });
  });

  it.each(PINNED)("Delegation history doesn't call a vote to a DRep named $name the pinned choice", ({ choice, name }) => {
    listed(name, () => {
      const pinned = delegationRow(choice);
      expect(pinned).toBe(`Voting power to ${name}`);
      expect(readsAs(delegationRow(STRANGER), pinned), `"${delegationRow(STRANGER)}" against "${pinned}"`).toBe(false);
    });
  });
});
```
