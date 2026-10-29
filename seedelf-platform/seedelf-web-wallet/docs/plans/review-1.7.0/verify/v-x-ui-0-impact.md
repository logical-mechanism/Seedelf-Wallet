# v-x-ui-0-impact: the way out's line names giveme.my where the mix waits for the pool

Finding `x-ui#0` (low, ux). I judged impact and the fix, on HEAD `6bca8bec`. #338 changed only `post-release-roadmap.md` after #337, so nothing cited here moved.

## Verdict

- **Confirmed. Severity: low**, as filed. Confidence: high.
- **It is the same defect as x-priv#3**, which `v-x-priv-3-trace` confirmed, and as pr337#0's wording aside. One rewording fixes all three.
- **It is broader than the finding says.** On a page brought back by hand, the line is wrong in the most common held state too, with the pool fine (S2 below).
- **The fix is right in direction:** drop the cause from the first sentence. It needs four corrections:
  - Keep the act clause, "Bring the rest back without it, and". The finding's "Without it, …" drops it.
  - Use a no-break space before ₳.
  - Run the blind back-translation round for es and ja.
  - Test the wording where it's cheap.

## Is it reachable with the store build?

- **Mainnet (the default): dormant today.**
  - A collateral's tail exists only once a shown 5 ₳ ADA pool holds the floor of 30 other people's boxes (`collateralPool`, lovejoin.ts:3966-3976; `networks.ts:71` `poolFloor: 30`).
  - The head start lists no mainnet pool (`src/lovejoin-pools.json`: mainnet, 0 pools). #337 says "On mainnet it stays dormant until a 5 ₳ ADA pool holds its floor of boxes".
  - Pools are discovered as they're read, so the defect goes live with no update once such a pool exists.
- **Preprod (Settings): reachable today.** The head start has the 5 ₳ ADA pool `18c4df77…` (`boxLovelace` 5000000), and preprod's floor is 0.
- **Where the line is wrong:**
  - **(a) The finding's states.** The mix's rebuild waits on the pool (`lj.tail.fewBoxes`, `lj.tail.noPool`).
    - `fewBoxes` needs fewer than 2 free boxes of other people's. That's easy on preprod's thin pool, but rare on mainnet once a pool holds 30.
    - `noPool` (the pool can't be read) is transient on either network, and needs `landed` already set (v-x-priv-3-trace).
  - **(b) Broader: every page brought back by hand** (a site's session, a swap brought back by hand) whose chain stopped or was cut at the collateral's mix. A lock is the usual way a chain stops.
    - Nothing asks giveme.my until the user presses *Bring it back*: `step` returns for a session that doesn't run itself, and the pending chain is gone.
    - The row above the line says exactly that: "the rest stays at the account until you bring it back".
    - S2 shows giveme.my asked 0 times over two alarm runs, with the line due.
  - **(c) pr337#0's stale hold** after a direct return, which that finding's view fix removes.
- **Where the line is true:** `tailWaits` (the chain pending at the mix, giveme.my busy or slow), and a self-running session once its rebuild goes.

## Harm, by the brief's scale

- **The privacy half is accurate:** the box stays in the pool unmixed, tied to the session, until it's mixed again. The wrong part is operational: what the mix waits for.
- **It contradicts the page's own reason:**
  - S1, the site's page: *Bring it back* errors with `lj.tail.fewBoxes` beside it.
  - A swap that runs itself: the retry line shows `fewBoxes` (v-x-priv-3-trace ZZ-4).
  - The mix card: "It tries again at … What went wrong: Lovejoin's pool…" (`lovejoin.detail.triesAgain`).
- **On a page brought back by hand,** "still waiting for giveme.my" suggests something is in progress when nothing is.
- **No lasting harm:** no stuck state, no money, no data. Every button works, and the row says what to do.
- **Low, not medium:** it is not a misleading money or privacy statement.
- **Not a nit:** it is a false statement of fact, in a critical line, next to a reason that says otherwise.

## Scratch runs

The test was `tests/zz-review-v-x-ui-0-impact-1.test.ts`. It ran only in a copy outside the tree (`scratchpad/review/v-x-ui-0-impact/`). It uses x-ui's helpers, the real WebAssembly and the planner's fakes, with the hour aged in the record as #337's test does. It has four cases:

- **S1:** the finding's state. `stoppedAtMix`, the pool's two other boxes spent, then the hour.
- **S2:** by hand, the pool fine, then the hour.
- **S3:** `tailWaits`, giveme.my answering 503, then the hour.
- **S4:** es and ja.

**HEAD (3 failed, 1 passed).** Each failure is only at `not.toContain("giveme.my")`; every state assertion before it held.

```
S1 stop reason: giveme.my wouldn't back the collateral's mix, so the chain stopped there.
S1 Bring it back's error: Lovejoin's pool of 5 ₳ boxes hasn't enough of other people's boxes free for its collateral's mix yet. The rest waits for that mix, a day at most.
S1 row: Stopped after 5 of 7 transactions; the rest stays at the account until you bring it back
S1 way out: The collateral's mix is still waiting for giveme.my. Bring the rest back without it, and its 5 ₳ box stays in the pool unmixed, tied to this session, until you mix it again.
S2 giveme.my asked during two runs: 0
S2 row: Stopped after 5 of 7 transactions; the rest stays at the account until you bring it back
S2 way out: The collateral's mix is still waiting for giveme.my. …
S3 giveme.my asked: 1 · row: Sending 3 of 5 transactions · anything but the way out naming giveme.my: false
S4 es: La mezcla del colateral sigue esperando a giveme.my. … · ja: コラテラルのミックスはまだ giveme.my を待っています。…
```

**Fix B in the copy (4 of 4 pass).** Fix B is my recommendation: only the first sentence changes, and the space before ₳ becomes U+00A0.
- S1 now reads: "The collateral's mix hasn't gone yet. Bring the rest back without it, and its 5 ₳ box stays in the pool unmixed, tied to this session, until you mix it again."
- **Related files:** 14 related files, each run alone, all pass, 195 tests: `collateral-held`, `i18n` (the negation guard), `i18n-critical-helpers`, `i18n-worker-reasons`, `i18n-screens`, `i18n-values-in-place`, `i18n-joins`, `i18n-assembly`, `i18n-review-fixes`, `words`, `worker-words`, `chain-stopped-copy`, `store-images-copy` and `live-runs-copy`.
- **The critical set:** derived read-only, it is still 463 keys, the same as `critical-keys.json`.

**Fix A, the finding's own wording, in the copy.**
- S1 passes, and so do `collateral-held` and `i18n`.
- The line reads "The collateral's mix hasn't gone yet. Without it, its 5 ₳ box stays in the pool unmixed, …" (S1 logs `action clause kept: false`).
- No gate notices the dropped act.

## On the fix

1. **Dropping the cause is the right fix.**
   - **Narrowing the hold instead** (no offer while the rebuild waits on the pool) would take away the owner's way out where flows.md:522 says it applies: "while the mix still waits (for giveme.my, or to be built again)".
   - **A line per state** would need a second critical key and another blind round.
2. **Correction: keep "Bring the rest back without it, and".**
   - The button says "Bring the rest back now", not "without the mix". The act clause is the one place that says pressing gives up the mix.
   - Fix A's "Without it, its box stays … unmixed" keeps the consequence but drops the act it follows from. It reads close to a tautology.
   - Rule 3 allows shortening a privacy note, not loosening it, and nothing would catch the change (Fix A run above).
   - **Recommended English:** "The collateral's mix hasn't gone yet. Bring the rest back without it, and its 5 ₳ box stays in the pool unmixed, tied to this session, until you mix it again."
   - "The collateral's mix is still waiting." is also true in every held state. The exact words are the owner's call.
3. **Fold in x-ui F4:** U+00A0 before ₳ in all three languages, as the siblings `lj.tail.fewBoxes` and `lj.tail.waiting` already have it. Use the literal character, as the files do.
4. **es and ja.** My drafts are machine drafts, written with the English in view, so not blind. Only the first sentence changes; the second stays word for word:
   - es: "La mezcla del colateral aún no se ha hecho. Si traes el resto de vuelta sin ella, …"
   - ja: "コラテラルのミックスはまだ行われていません。それを待たずに残りを取り戻すと、…"
   - Then a blind back-translation of each whole value by a fresh agent, appended as a round to the `reviewer` note in `verified-critical-{es,ja}.json`.
   - Those files list key names only, and no gate hashes the values, so the round is by hand.
   - `critical-keys.json` and the provenance entries (`machine`) don't change.
5. **What the fix touches:**
   - **Changed:** three values and two reviewer notes.
   - **Unchanged:** no code. No docs either: flows.md:522 paraphrases only the privacy half, which stays true. No e2e or store image reaches the state, and no test pins the old first sentence.
   - **No policy entry:** nothing about data handling changes.
6. **The trade-off (S3).**
   - In the common held state (`tailWaits`), the way-out line is the only text on a site's page that names giveme.my as the wait. The row reads "Sending 3 of 5 transactions". After the fix, nothing on that page names it.
   - **That's acceptable:**
     - It's not a privacy fact.
     - The return's review already says "giveme.my backs that mix, so it sees it" (`lovejoin.collateralBox.privacy.note_one`).
     - In the other states the page's own reason says why.
   - If the owner wants the cause shown where it's true, the option is a `giveme` flag in `collateralHeld` (from `tailWaits`) and a second critical first sentence. That's an owner's call, not needed.
7. **The test.**
   - **Put the property in `collateral-held.test.ts`,** for en, es and ja: no "giveme.my", and the act and its consequence both present. It's cheap, and it guards the translations too.
   - **The finding's planner-level test works:** my S1 fails today only at that assertion, and passes with the fix. But it spends WebAssembly builds on a constant string.
   - **If one planner case is wanted, use S2** (by hand, the pool fine): it's the more common state.
   - Pin the property, not the wording.
8. **How it fits with the other fixes:**
   - Merge it with x-priv#3.
   - pr337#0's view fix removes the stale-hold case entirely.
   - x-ui F2 (a press by hand brings nothing back) is separate. The kept act clause stays true there: pressing still leaves the box unmixed, and the next return is plain.

## Clean-up

- No tracked file was touched, and nothing went to the network.
- The copy of the web wallet and the crates' fixtures are deleted. The scratch test and its run logs stay under `scratchpad/review/v-x-ui-0-impact/` for the lead.
