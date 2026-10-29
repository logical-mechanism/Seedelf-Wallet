# v-x-docs-5-impact: the way-out's line names giveme.my where the mix waits to be built again

Finding `x-docs#5` (low, ux; the x-docs report's own #6). I judged impact and the fix, on HEAD `6bca8bec`.

## Verdict

- **Confirmed. Severity: low**, as filed. Confidence: high.
- **It is the same defect as x-priv#3 and x-ui#0, and as pr337#0's wording aside.** One rewording closes all four, so merge them.
- **The fix is right and minimal as written.** It keeps the act clause and every privacy clause. Two small additions:
  - fold in x-ui F4's no-break space before ₳;
  - fix the `collateralHeld` comment at `rpc.ts:1866`.
- **The proposed test is good, and it does more than it says.** It also guards `tailHeld`'s `tailBuildable` branch, which pr337#3 found unguarded (its M2).

## The finding's state on HEAD (scratch ZZX5-1)

This is the planner test's `stoppedAtMix()`: a site's session, where giveme.my refused past its wait. It drives the real worker and WebAssembly.

```
record  {"ended":true,"stopped":"giveme.my wouldn't back the collateral's mix, so the chain stopped there.","tail":{"tries":1,"landed":1800000000000}}
view    {"stage":"open","auto":false,"site":true,"chain":{"total":7,"sent":5,"confirmed":5,"cut":false,"stopped":"giveme.my wouldn't back…"},"collateralHeld":{"offerAt":1800003600000}}
site page's chain row:         Stopped after 5 of 7 transactions; the rest stays at the account until you bring it back
Lovejoin page's Chains reason: giveme.my wouldn't back the collateral's mix, so the chain stopped there.
way out at offerAt:            The collateral's mix is still waiting for giveme.my. Bring the rest back without it, …
giveme.my asked over two alarm runs while held (record aged an hour): 0
Bring it back builds: ["mix","back"], giveme.my asked: 0 (only once that's sent)
```

**The cause on HEAD:**
- `lovejoin.ts:4131` holds the return in both states: `if (!tailWaits(c) && !tailBuildable(c, this.deps.now())) return undefined;`.
- `LovejoinReturn.tsx:548-551` shows `lj.tail.privacy.wayOut` from `offerAt`, whatever the state.
- `en.json:922` names giveme.my as the wait, and es (`:969`) and ja (`:875`) say the same.
- `flows.md:522` already describes both states correctly: "while the mix still waits (for giveme.my, or to be built again)".

## Where it shows, and for how long

**A site's page, or a swap brought back by hand (the finding's own scenario):**
- The refusal isn't on that page. Its row is `chainText(…, byHand)`: "the rest stays at the account until you bring it back" (`SiteSessions.tsx:406-407`, `LovejoinReturn.tsx:117`). The refusal is on the Lovejoin page's Chains row (`Lovejoin.tsx:964-965`), which has no way out for this session. So the contradiction is across two pages.
- On the session's own page the line is false for the whole hold, from the hour until the day's end (`TAIL_KEEP_MS`) or the user's press. Nothing asks giveme.my until *Bring it back* builds the mix again (ZZX5-1). The line suggests something is in progress; the row above it says to bring the rest back.

**A mix or swap that runs itself:**
- The card (`detailOf`, `Lovejoin.tsx:907`/`:911`) or the swap's timeline shows the refusal next to the line. That lasts only until the runner's next step builds the mix again (`tries` 2):
  - normally the first retry, after 30 s (`retryAfterMs`, `sessions.ts:265`);
  - after an unlock, a draw of 2 to 20 minutes (`UNLOCK_WAIT_MS`, `lovejoin.ts:1525`).
- From then the new chain's mix waits for giveme.my (`tailWaits`), and the line is true.
- The contradiction lasts longer (up to the day) only where the rebuild waits on the pool (`fewBoxes`/`noPool`). x-priv-3 and x-ui-0 reproduced that: the retry line names the pool right beside the line.

**Not this finding:** pr337#0's stale hold after a direct return.

## Reachable with the store build?

- **Mainnet (the default): dormant today.**
  - A tail is built only where a shown 5 ₳ ADA pool holds the floor of 30 other people's boxes (`collateralPool`, `lovejoin.ts:3966-3976`; `networks.ts:71`).
  - The head start lists no mainnet pool.
  - It goes live with no update once such a pool exists. The by-hand stop (a lock, or a refusal) is then the likeliest of these states.
- **Preprod (Settings): reachable today.** The bundled 5 ₳ pool is `18c4df77…`, and the floor is 0 (`networks.ts:56`).

## Harm, by the brief's scale

**What's wrong:** a false cause in a critical, privacy-toned callout.

**What's right:**
- the privacy clauses (unmixed, tied to this session, until you mix it again);
- what the button does;
- the choice it frames (wait, or leave the box unmixed), which doesn't depend on the cause.

No money, data or stuck state is involved.

**One soft cost, on pages brought back by hand:** "still waiting for giveme.my" invites waiting. A user who waits out the day loses the mix that *Bring it back* would have rebuilt. The box then stays unmixed, which is the same outcome as the button, and the row above tells them to bring it back.

**Rating: low** (a small UX defect).
- Not medium: it isn't a misleading money or privacy statement.
- Not a nit: it's a false statement of fact, reproduced, and it sits beside reasons that say otherwise.

## The fix

**Recommended English** (first sentence changed, the rest word for word, U+00A0 before ₳):
> The collateral's mix hasn't gone yet. Bring the rest back without it, and its 5 ₳ box stays in the pool unmixed, tied to this session, until you mix it again.

**Why it's right:**
- **It's true in every held state.** Both `tailWaits` and `tailBuildable` require `!tail.scheduled` (`lovejoin.ts:1319`, `:1338`), so the mix is unsent wherever the line shows.
- **It fits the owner's rules:**
  - It's shorter (rule 4).
  - The act clause and the privacy clauses are kept (rule 3). x-ui#0's original "Without it, …" dropped the act; this one doesn't.
  - It adds no guard (rule 1) and changes no default (rule 2).
- **It uses the house verb:** "if that mix can't go" (`en.json:1023`, `:2445`).

**No privacy note is lost.** giveme.my's role ("backs that mix, so it sees it") stays where the choice is made: `en.json:1023-1025`, `:2445`, `:2521`.

**es and ja.** These drafts are mine, written with the English in view, so not blind:
- es: "La mezcla del colateral aún no se ha hecho. …" This matches es's "no puede hacerse" for "can't go".
- ja: "コラテラルのミックスはまだ行われていません。…"
- The rest of each value stays as it is.

**The i18n process:**
- Run a fresh blind back-translation of both whole values.
- Append a round to the `reviewer` note in `verified-critical-{es,ja}.json`. Those files list key names only, and the key keeps its name, so the `keys` lists, `critical-keys.json` and provenance don't change. No gate hashes the values, so the round is done by hand.

**Also:**
- `rpc.ts:1866`'s comment, "which waits for giveme.my (a day at most)", should add "or to be built again" (nit).
- `flows.md:522` is already right.

**What else it changes:** in `tailWaits`, where the line is true, the pages lose their only mention of giveme.my as the hold-up.
- That's acceptable: it's operational, and it's disclosed at the review.
- Naming it where true would need a `giveme` flag on `collateralHeld` and a second critical sentence. That's the owner's call, and not needed for 1.7.0.

**Independent fixes that should land too:** pr337#0 (the view-level `cut` fix) and pr337#2 (a press by hand brings nothing back).

## Checked in a copy

The copy was `scratchpad/review/v-x-docs-5-impact/`, now deleted.

- **The fix (en/es/ja):**
  - ZZX5-2 passes.
  - 10 related files pass, 144 tests: `collateral-held` 2, `i18n` 24 (negation guard), `i18n-critical-helpers` 62, `i18n-joins` 4, `i18n-review-fixes` 3, `i18n-values-in-place` 7, `i18n-assembly` 17, `words` 2, `worker-words` 19, `chain-stopped-copy` 4.
- **The M2 mutation** (`tailBuildable` removed from `tailHeld`):
  - ZZX5-2 fails at `expect(held).toBeDefined()`.
  - `collateral-held.test.ts` still passes, 2/2.

## The test

**Take the finding's test, as ZZX5-2 ran it:**
- after `stoppedAtMix()`, `(await sessions.list("preprod"))[0].collateralHeld` is defined;
- `CollateralHeldWayOut`, rendered at its `offerAt`, doesn't contain "giveme.my".

**What it catches:**
- HEAD fails only at the wording.
- M2 fails at `collateralHeld`, so it closes pr337#3's gap too.

Its cost is one `stoppedAtMix`, about 2.4 s.

**Optional:** pin the property for es and ja in `collateral-held.test.ts`: no giveme.my, with the act and its consequence kept. It's cheap.

## Clean-up

- The scratch test `extension/tests/zz-review-v-x-docs-5-impact-1.test.ts` is deleted, and so are the copy and the log.
- No tracked file was touched, and nothing went to the network.
