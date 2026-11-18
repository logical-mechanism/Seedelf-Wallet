# r2screens#1: verification

From lane R2screens, graded low by its finder.

## Trace: confirmed, low

It holds as described. e3b#2's fix (d9e015fb) now stores the unlocked side of the private balance: DappApprovals.tsx:623 `setSeedelf(unlocked(b.seedelf))`. The two lines under the amount still put that figure in words that call it the balance: dappUi.heldAndCollateral "{{ada}} ₳ in your private balance. …" and sites.topUp.tooMuch "That's more than the {{held}} ₳ in your private balance." Nothing in the window says what's locked: DappApprovals.tsx never imports or calls lockedAside, and none of the form's other strings mention a lock.

Take 100 ₳ held with 60 ₳ and a token locked:
- The window says "40 ₳ in your private balance".
- With 50 ₳ typed, it adds "That's more than the 40 ₳ in your private balance."
- Home says 100 ₳ with "60 ₳ locked" under it, and this window's own review row starts from 100 ₳ too (homeBalance).
- With everything locked, it says "0 ₳ in your private balance" and Review stays off for any amount, with no reason given.

This breaks chunk 12's rule #23: "the forms offer only what's unlocked ("3 ₳ available · 25 ₳ locked"), and say when everything is locked". Withdraw follows that rule in both its lines. e3b#2's verifier (verify/e3b-2.md:77) and its finder (lanes/E3b.md:43) both asked for lockedAside, but G5's report lists only the cap. Before the fix the line said 100 ₳, which was true, though the cap was wrong.

Nothing refutes it:
- No other line in the window shows the lock.
- The fixer's own test pins today's words exactly (screens-wiring-review-fixes.test.ts:939 at HEAD f88560c4).
- None of the traced source files changed since 853d5779, and none is modified in the working copy.

Grade: low.
- Who: only the user, by locking private UTxOs on the UTxOs screen (deliberate and uncommon), then funding a private session from a site's connect window.
- Cost: no money moves and nothing is signed. The cap and the review's figures are right. What's wrong is a statement of the balance that is off by the locked amount, and repeated in the too-much note. In the all-locked case Review is off with no reason given.
- Way out: Decline, or unlock on the UTxOs screen. Home shows the real figure and the lock.
- It is not medium: nothing is lost or overpaid, and nothing is stuck for good. It sits at the nit end of low. It stays above nit because it states a wrong figure for the user's funds and leaves an unexplained dead end when everything is locked.

**Evidence:**

Trace in FIXTREE at HEAD f88560c4. `git log 853d5779..HEAD` shows no change to DappApprovals.tsx, en.json or format.ts, and `git diff HEAD` on them is empty.

1. **The worker's reading counts locked UTxOs in the side and reports them apart.**
   - balances.ts:441-465 seedelfSide: `sumValue(spendable)` over every spendable owned UTxO, `locked: NOTHING`.
   - balances.ts:320-322 withLocked: `seedelf: { ...b.seedelf, locked: locked.seedelf }`.

2. **The connect window reads that itself and, since d9e015fb, keeps the unlocked side.**
   - DappApprovals.tsx:620-626: `call("balances", {}).then((b) => setSeedelf(unlocked(b.seedelf)), …)`.
   - format.ts:454-462 unlocked(): subtracts locked.lovelace, the locked tokens and the locked UTxO count, and keeps `locked`.
   - On main the line was `(b) => setSeedelf(b.seedelf)`, so the line said 100 ₳.

3. **The cap is right.**
   - :703 `tooMuch = … BigInt(lovelace) > BigInt(seedelf.lovelace)`.
   - :704 canReview.

4. **The words call the unlocked side the balance.**
   - :992-995 `tr("dappUi.heldAndCollateral", { ada: amounts.ada(seedelf.lovelace) })`.
   - :997-999 `tr("sites.topUp.tooMuch", { held: amounts.ada(seedelf.lovelace) })`.
   - en.json:412 "{{ada}} ₳ in your private balance. 5 ₳ more goes in, kept aside for contracts, and comes back."
   - en.json:2193 "That's more than the {{held}} ₳ in your private balance."
   - lockedAside (format.ts:468) is called only by Withdraw.tsx:279, Transfer.tsx:290, CardanoSend.tsx:275 and MoveIn.tsx:162, never in DappApprovals.tsx.
   - `grep -i lock` in DappApprovals.tsx finds only comments and `unlocked`. I checked every other string the private form shows (cost.private, connectHint, staysLovejoin, onPoolShort, privacy.privateSession and others): none says "lock".

5. **Home and the window's own review say 100 ₳.**
   - Home.tsx:889 `privateTotal(balances.seedelf)` (Home.tsx:1177: raw lovelace plus incoming) and :891 lockedMeta, which renders home.locked "60 ₳ locked".
   - DappApprovals.tsx:820 `before={seedelf && homeBalance(seedelf)}`: ReviewTotals.tsx:76-81 adds the lock back, so 100 ₳.

6. **The house rule.**
   - archive/plans/chunk-12-style-flow.md:49 (#23): "the forms offer only what's unlocked ("3 ₳ available · 25 ₳ locked"), and say when everything is locked".
   - Withdraw does this in both lines: Withdraw.tsx:96 `available = t(seedelf.locked.utxos ? "withdraw.available" : "withdraw.inPrivate")`, :277-280 the aside, :348 withdraw.tooMuch.

7. **The records.**
   - verify/e3b-2.md:77: "Say what is locked beside the held line with `lockedAside(seedelf, amounts.ada)`".
   - lanes/E3b.md:43 says the same.
   - fixes/G5.md:10 lists only the cap.
   - The fixer's pin: screens-wiring-review-fixes.test.ts:939 (it was :936 at 853d5779), `toBe(words(t("dappUi.heldAndCollateral", { ada: free })))`.
   - Also pinned: hide-balances-forms.test.ts:58 (the source text) and e2e/extension.spec.ts:5362 ("28 ₳ in your private balance", with nothing locked).

8. **Run.** My test drives ConnectRequest over the house seam with the reading {100 ₳ and a token over 2 UTxOs, locked {60 ₳ and the token, 1 UTxO}}.
   - The page reads: "What to put in it ₳ 40 ₳ in your private balance. 5 ₳ more goes in, kept aside for contracts, and comes back. That's more than the 40 ₳ in your private balance." There is no "locked" anywhere on it.
   - With everything locked: "0 ₳ in your private balance. … That's more than the 0 ₳ in your private balance." Review is off for 10 ₳.
   - The hard preconditions pass in both cases: the balances are read, the line is shown, and Review reads Review and is off, so e3b#2's cap holds.

9. **Fix check**, in a copy under ~/.cache, removed after. I applied Withdraw's model to the two lines.
   - My test passes 3/3 in both builds.
   - Only the two pins fail, as they must: screens-wiring-review-fixes:939 now gets '40 ₳ available · 60 ₳ locked. 5 ₳ mor…', and hide-balances-forms:58 the source text.

10. **A sibling the finder missed.** Transfer.tsx:356 transfer.tooMuch says "That's more than the {{amount}} ₳ in your private balance." over free.seedelf, although its aside (:287-291) already says "available · locked".

`tsc --noEmit -p .` gives 0 errors, my file included.

**Known:** none. What I searched:
- docs/backlog.md: every line with "lock".
- docs/archive/plans/*.md and docs/plans/*.md: lockedAside, topUp.aside, heldAndCollateral, lockedMeta, asideAvailable, 'in your private balance', '₳ locked', "only what's unlocked", 'locked UTxO', and top-up with lock, aside or available.
- review-51's owner-calls.md, INDEX, FINDINGS, lanes, verify and fixes.
- SECURITY.md's out-of-scope list, which doesn't apply.

What turned up:
- chunk-12-style-flow.md:49, #23: the rule this breaks.
- e3b#2's own records: verify/e3b-2.md:77 and lanes/E3b.md:43, whose lock note G5 left undone (fixes/G5.md:10).
- owner-calls e9a#1: a different path. A token's details open a form that silently drops a token with no spendable units (locked, or on its way back). It's related in spirit (say why it's locked), but it doesn't cover this line.

**Fix notes:**

What to change, following Withdraw's model (Withdraw.tsx:96, :277-280, :348), in ConnectRequest (DappApprovals.tsx:992-999):

1. **The line under the amount.** When `seedelf.locked.utxos`, say "{{ada}} ₳ available" plus `lockedAside(seedelf, amounts.ada)` and then the 5 ₳ sentence. That needs a new en string, e.g. dappUi.availableAndCollateral "{{ada}} ₳ available{{locked}}. 5 ₳ more goes in, kept aside for contracts, and comes back.", with es and ja drafts. With nothing locked, keep today's words.
2. **The too-much note.** Use withdraw.tooMuch with `available: t(seedelf.locked.utxos ? "withdraw.available" : "withdraw.inPrivate")`, or a dappUi key of its own.
3. **Optional.** When everything is locked, add the house's reason under the amount (worker.spend.allLocked's words), so the reason Review is off is on screen.
4. **Figures.** Keep amounts.ada on every figure so hidden balances stay hidden (HM-9).

Couplings:
- Update the fixer's pin, screens-wiring-review-fixes.test.ts:939 (toBe heldAndCollateral).
- Update hide-balances-forms.test.ts:58 (the source-text pin).
- e2e/extension.spec.ts:5362 ("28 ₳ in your private balance", nothing locked) stays as it is.
- Checked in a copy: this sketch makes r51-r2screens-1 pass 3/3 in both builds, and only those two pins fail.

No owner call is needed. Nothing new is refused, no default changes, and it's words only. New strings follow the house's i18n steps.

Class: every form that labels Home's unlocked private side "in your private balance" and says nothing about the lock.
- TopUp: SiteSessions.tsx:672 sites.topUp.aside and :689 sites.topUp.tooMuch.
- Private Send's too-much note: Transfer.tsx:356 transfer.tooMuch, which the finder missed. Its aside already says "available · locked".
- The swap form: swaps.short, swaps.tooMuch and swaps.inPrivate.
- Lovejoin's form: lovejoin.mix.inPrivate.

Withdraw is the one private form that gets both lines right. The class predates this round; only the connect window is new, from d9e015fb.

My test's second check in each case encodes the finding's "the tooMuch note needs the same". If the owner settles on saying the lock once, in the line above as Transfer does, relax that check to the held line.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51-fixes/seedelf-platform/seedelf-web-wallet/extension/tests/r51-r2screens-1.test.ts`

Result: **On FIXTREE (HEAD f88560c4), from extension/, default build:** FAIL.

Command: `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m nice -n 10 npx vitest run tests/r51-r2screens-1.test.ts`

```
 ❯ tests/r51-r2screens-1.test.ts (3 tests | 2 failed) 111ms
     × with 60 ₳ of 100 ₳ locked, says the 60 ₳ is locked, and never calls the 40 ₳ left what's in the balance 67ms
     × with everything locked, says so, rather than "0 ₳ in your private balance" 10ms
AssertionError: no word of the 60 ₳ locked: "Connect a site Nothing happens until you press Review … What to put in it ₳ 40 ₳ in your private balance. 5 ₳ more goes in, kept aside for contracts, and comes back. That's more than the 40 ₳ in your private balance. Anyone can follow this money, … Decline Review": expected false to be true
AssertionError: the unlocked 40 ₳ called what's in the private balance, with no word of the lock: expected [ …(2) ] to deeply equal []
+   "What to put in it ₳ 40 ₳ in your private balance.",
+   "That's more than the 40 ₳ in your private balance.",
AssertionError: no word that everything is locked: "… What to put in it ₳ 0 ₳ in your private balance. 5 ₳ more goes in, kept aside for contracts, and comes back. That's more than the 0 ₳ in your private balance. … Decline Review": expected false to be true
AssertionError: 0 ₳ called what's in the private balance, with no word of the lock: expected [ …(2) ] to deeply equal []
+   "What to put in it ₳ 0 ₳ in your private balance.",
+   "That's more than the 0 ₳ in your private balance.",
 Test Files  1 failed (1)
      Tests  2 failed | 1 passed (3)
```

**With VITE_ENABLE_MAINNET=false in front:** the same result, "Tests 2 failed | 1 passed (3)".

- Every hard precondition passes: the balances are read, the line is shown, and Review reads "Review" and is off, so e3b#2's cap holds.
- The controls pass today: with nothing locked there's no lock word and Review is on; with balances hidden no figure shows.

**Fix check, in a copy under ~/.cache (removed after).** The copy applies Withdraw's model:
- with a lock, the line is "{{ada}} ₳ available{{locked}}. 5 ₳ more goes in…" with lockedAside(seedelf, amounts.ada);
- the note is withdraw.tooMuch with available = "available" or "in your private balance".

Results:
- My test gives "Test Files 1 passed (1), Tests 3 passed (3)" in both builds, and the line reads "40 ₳ available · 60 ₳ locked. 5 ₳ more goes in, kept aside for contracts, and comes back."
- In the same copy, only the two existing pins fail, as they must: screens-wiring-review-fixes.test.ts:939 and hide-balances-forms.test.ts:58.

**Type-check:** `tsc --noEmit -p .` in FIXTREE gives 0 errors.

```
// Chunk 51's review of its own fixes, r2screens#1. e3b#2's fix (d9e015fb) holds the connect window's private-session
// form to the unlocked side of the private balance (DappApprovals.tsx:623, `setSeedelf(unlocked(b.seedelf))`), which is
// what the funding's build can spend. But the line under the amount and its "more than" note still call that side
// what's "in your private balance" (dappUi.heldAndCollateral, sites.topUp.tooMuch), and nothing in the window says
// what's locked: with 100 ₳ held and 60 ₳ of it locked, Home shows 100 ₳ with "60 ₳ locked" under it, and the window
// says "40 ₳ in your private balance". With everything locked it says "0 ₳ in your private balance". Chunk 12's rule
// (#23, archive/plans/chunk-12-style-flow.md:49): "the forms offer only what's unlocked ("3 ₳ available · 25 ₳ locked"),
// and say when everything is locked". e3b#2's verifier asked for it too (verify/e3b-2.md:77: lockedAside).
//
// Over the house's seam (screens-wiring-review-fixes.test.ts): ConnectRequest's own effects run during
// renderToStaticMarkup, `call` answers at once so its reading of the balances lands in the same render, and the private
// session's choice and the amount typed start as seeds in their useState.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => {
  /** A thenable that answers at once: an effect's `.then` lands in the same render. */
  interface Answer {
    then(ok?: ((value: unknown) => unknown) | null, no?: ((error: unknown) => unknown) | null): Answer;
    catch(no: (error: unknown) => unknown): Answer;
    finally(done: () => void): Answer;
  }
  const answered = (value: unknown): Answer => ({
    then: (ok) => (ok ? answered(ok(value)) : answered(value)),
    catch: () => answered(value),
    finally: (done) => {
      done();
      return answered(value);
    },
  });
  /** Never answers: a request the test leaves unanswered. */
  const pending: Answer = { then: () => pending, catch: () => pending, finally: () => pending };
  const state = {
    /** The components whose own effects run, by name. */
    effects: new Set<string>(),
    answers: new Map<string, unknown>(),
    asked: [] as string[],
    /** A useState seeded: the call right after a run of calls starting as `after`, itself starting as `initial`. */
    seeds: [] as Array<{ after: unknown[]; initial: unknown; value: unknown; used?: true }>,
    initials: [] as unknown[],
    call(type: string): Answer {
      state.asked.push(type);
      return state.answers.has(type) ? answered(state.answers.get(type)) : pending;
    },
    seeded(initial: unknown): unknown {
      const before = state.initials;
      state.initials = [...before, initial];
      for (const seed of state.seeds) {
        if (seed.used || before.length < seed.after.length || !Object.is(initial, seed.initial)) continue;
        const run = before.slice(before.length - seed.after.length);
        if (!seed.after.every((want, i) => Object.is(run[i], want))) continue;
        seed.used = true;
        return seed.value;
      }
      return initial;
    },
    reset() {
      state.effects.clear();
      state.answers.clear();
      state.asked = [];
      state.seeds = [];
      state.initials = [];
    },
  };
  return state;
});

vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  /** Who called the effect: the frame after the seam's own. */
  const caller = () => {
    const frames = (new Error().stack ?? "").split("\n");
    const at = frames.findIndex((f) => f.includes("seamEffect"));
    return /at (?:[\w$]+\.)*([\w$]+)/.exec(frames[at + 1] ?? "")?.[1] ?? "";
  };
  /** The named components' effects, run during the render, again only when a dependency changes. */
  function seamEffect(run: () => void | (() => void), deps?: readonly unknown[]) {
    const last = react.useRef<readonly unknown[] | null>(null);
    const cleanup = react.useRef<void | (() => void)>(undefined);
    if (!seam.effects.has(caller())) return;
    const was = last.current;
    if (was && (!deps || (deps.length === was.length && deps.every((d, i) => Object.is(d, was[i]))))) return;
    last.current = deps ?? [];
    cleanup.current?.();
    cleanup.current = run();
  }
  return {
    ...react,
    useEffect: seamEffect,
    useLayoutEffect: seamEffect,
    useState: (initial?: unknown) => react.useState(seam.seeded(initial)),
  };
});
vi.mock("../src/ui/background", async (original) => ({
  ...(await original<typeof import("../src/ui/background")>()),
  call: (type: string) => seam.call(type),
}));

import { t } from "../src/i18n";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import { formatAda } from "../src/ui/format";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import { ConnectRequest } from "../src/ui/screens/DappApprovals";

const ADA = 1_000_000n;
const token = { policyId: "16".repeat(28), assetName: "4f4e45", quantity: "1" };
type Locked = { lovelace: string; tokens: (typeof token)[]; utxos: number };

/** The worker's reading of the private side: 100 ₳ and a token over two UTxOs, `locked` of it locked by the user. */
const privateSide = (locked: Locked) => ({ lovelace: (100n * ADA).toString(), tokens: [token], utxos: 2, seedelfs: [], locked });
/** 60 ₳ and the token in the one UTxO the user locked on the UTxOs screen. */
const SIXTY: Locked = { lovelace: (60n * ADA).toString(), tokens: [token], utxos: 1 };
/** Both UTxOs locked. */
const ALL: Locked = { lovelace: (100n * ADA).toString(), tokens: [token], utxos: 2 };
const NONE: Locked = { lovelace: "0", tokens: [], utxos: 0 };

/** What a person reads of markup. */
const words = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replace(/\s+/g, " ")
    .trim();
const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** An ADA figure as the page's words have it, with no digit before it: "40 ₳", never the end of "140 ₳". */
const figure = (lovelace: bigint) => `(?<![\\d.,])${escaped(formatAda(lovelace.toString()))} ₳`;
/** The page's sentences, as a person reads them. */
const sentences = (page: string) => words(page).split(/(?<=[.!?])\s+/);
/** The sentences that call `lovelace` what's in the private balance, with no word of a lock in them. */
const calledTheBalance = (page: string, lovelace: bigint) =>
  sentences(page).filter((s) => new RegExp(`${figure(lovelace)} in your private balance`, "i").test(s) && !/\blocked\b/i.test(s));

/** The connect window, a private session chosen and `amount` typed, the worker's reading `side`: its markup. */
function privateForm(side: ReturnType<typeof privateSide>, amount: string, prefs: Partial<typeof DEFAULT_PREFERENCES> = {}): string {
  seam.effects.add("ConnectRequest");
  seam.answers.set("balances", { seedelf: side });
  // The choice: the first state that starts undefined. The amount: the one after the governance switch's and the
  // private balance's.
  seam.seeds.push({ after: [], initial: undefined, value: "private" }, { after: [false, undefined], initial: "", value: amount });
  return renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: "preprod" },
      createElement(
        PreferencesContext.Provider,
        { value: { prefs: { ...DEFAULT_PREFERENCES, hideBalances: false, ...prefs }, loaded: true, set: async () => undefined } },
        createElement(ConnectRequest, {
          approval: { kind: "connect", id: "a1", origin: "https://example.org", title: "Example", password: false },
          busy: false,
          held: false,
          onError: () => undefined,
          onAnswer: async () => false,
        } as never),
      ),
    ),
  );
}

/** The private session's Review: its label, and whether it's off. */
const review = (page: string) => {
  const button = /<button type="submit" class="primary"( disabled="")?>([^<]*)<\/button>/.exec(page);
  return { label: button?.[2], off: button?.[1] !== undefined };
};

beforeEach(() => seam.reset());

describe("r2screens#1: the connect window's private session says what's locked of the private balance", () => {
  it("with 60 ₳ of 100 ₳ locked, says the 60 ₳ is locked, and never calls the 40 ₳ left what's in the balance", () => {
    // The words are English here: the checks below read them.
    expect(t("home.locked", { amount: "1" })).toMatch(/\blocked\b/);
    const page = privateForm(privateSide(SIXTY), "50");
    expect(seam.asked).toContain("balances");
    expect(page, "the private session's amount and its line").toContain('data-testid="dapp-private-held"');
    // e3b#2's cap holds: 50 ₳ is more than the 40 ₳ the funding can spend, and Review is off.
    expect(review(page)).toEqual({ label: t("common.review"), off: true });

    const read = words(page);
    const locked = figure(60n * ADA);
    expect
      .soft(new RegExp(`${locked}[^.]*\\blocked\\b|\\blocked\\b[^.]*${locked}`, "i").test(read), `no word of the 60 ₳ locked: "${read}"`)
      .toBe(true);
    expect.soft(calledTheBalance(page, 40n * ADA), "the unlocked 40 ₳ called what's in the private balance, with no word of the lock").toEqual([]);
  });

  it("with everything locked, says so, rather than \"0 ₳ in your private balance\"", () => {
    const page = privateForm(privateSide(ALL), "10");
    expect(page, "the private session's amount and its line").toContain('data-testid="dapp-private-held"');
    expect(review(page)).toEqual({ label: t("common.review"), off: true });

    const read = words(page);
    expect.soft(/\blocked\b/i.test(read), `no word that everything is locked: "${read}"`).toBe(true);
    expect.soft(calledTheBalance(page, 0n), "0 ₳ called what's in the private balance, with no word of the lock").toEqual([]);
  });

  it("controls: with nothing locked it says no lock; with balances hidden, the locked figure hides too", () => {
    const open = privateForm(privateSide(NONE), "50");
    expect(review(open)).toEqual({ label: t("common.review"), off: false });
    expect(/\blocked\b/i.test(words(open)), "a lock said where nothing is locked").toBe(false);

    seam.reset();
    const hidden = privateForm(privateSide(SIXTY), "50", { hideBalances: true });
    expect(hidden).toContain('data-testid="dapp-private-held"');
    expect(words(hidden), "a figure shown with balances hidden").not.toMatch(new RegExp(figure(60n * ADA)));
    expect(words(hidden)).not.toMatch(new RegExp(figure(40n * ADA)));
  });
});
```
