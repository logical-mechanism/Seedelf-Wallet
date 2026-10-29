# Fix-up lane: the fixes' review, screens lens

Worktree `W` = `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-wt/release-1.7.0`. Nothing was committed. Paths below are under `W/seedelf-platform/seedelf-web-wallet/`.

Each test failed on the tree before its fix, for the finding's reason, and passes now. Code comments cite this round as "1.7.0's fixes' review, screens#N", after the house's "34e's fixes' review, 2".

## Status

- **Fixed: 2.** #1 got new words for a refusal that pointed at a pool no screen shows. #3 stops a page from opening a review that could only be an error.
- **Deferred: 1.** #2 is the lead's blind back-translation before packaging (listed below). The gate change waits until after 1.7.0.
- I wrote no docs. The two docs notes below are a clause each, for the docs lanes' existing edits, with no PR of their own.

## screens#1: a start refused as the copy of a pool no screen shows. **Fixed (words only; the refusal stays)**

- **Change:** `extension/src/background/lovejoin-launch.ts` `build`. A match among the shown pools (`known`) still throws `lj.launch.copy` ("…Use that pool instead.").
  - A match only on the data layer's last list (`lastListed`, which Koios hasn't confirmed) throws the new `lj.launch.copyListed`: "A pool of these values was started already. It shows under Pools once it's confirmed: use it then." ("Shows under Pools" reuses `lovejoin.launch.sentNote`'s words.)
  - The file's header comment says so too.
- **Not changed:** the form's own check (`LovejoinLaunch.tsx` `why`). It still uses `lj.launch.copy`, and that's right there: it reads shown pools only, and it highlights the one to use.
- **Test (failed before, passes now):** `tests/lovejoin-merged-review.test.ts` › "a start of the values of a pool the data layer lists, before Koios confirms it (1.7.0's release review, x-merge#0)" › "is refused as a copy, though the pool isn't read or offered to join till Koios confirms it".
  - This is the pools lane's test. I changed its expected refusal to `lj.launch.copyListed`, and its "other values" check now excludes both keys.
  - Before the fix: `expected … to throw error including 'lj.launch.copyListed' but got 'A pool of these values exists already, … Use that pool instead.'`
- **New guard test** (passes before and after): the same describe › "says to use the pool where it's shown and the list names it too: the form offers it to join (…screens#1)". A pool that is both shown and listed still gets `lj.launch.copy`.
- **Files:**
  - `extension/src/background/lovejoin-launch.ts`
  - `extension/src/i18n/translations/{en,es,ja}.json`
  - `docs/i18n/{es,ja}-provenance.json`
  - `extension/tests/lovejoin-merged-review.test.ts`
- **Noted, not new:** x-merge#0's accepted case is unchanged. If the list names a pool Koios never confirms, the start stays refused, and the words now promise a pool that never shows. The pools lane recorded that risk as accepted.

## screens#2: the critical-words gate compares key names only. **Deferred**

- **Reproduced:** a scratch test, now deleted, applied `i18n.test.ts`'s own filter to es with `lj.tail.privacy.wayOut` replaced by its opposite ("La mezcla del colateral ya se hizo."). It failed with `expected [] to include 'lj.tail.privacy.wayOut'`, and `i18n.test.ts` passes 24 of 24 on the tree.
- **Diffed critical es/ja values against `6bca8bec` and `babb8e76`:** the only critical values changed are the four the review names:
  - `lj.tail.privacy.wayOut` (es, ja);
  - `settings.koiosOnly.privacy.off` (es, ja).

  1.7.0's PRs added only `lj.tail.privacy.wayOut`, and it was verified when added. Nothing else got past the name-only check.
- **The lead's step before packaging** (the brief keeps `verified-critical-*.json` for the lead): back-translate blind:
  - those four values;
  - the store listing's added es and ja clauses: `docs/store/README.md:163` (es, "…también comprueba cada pool nuevo de Lovejoin…") and `:227` (ja, 「また、私たちのサーバーが一覧に載せた新しい Lovejoin のプールは、どれも Koios で確認します。」).

  Note the round in each file's reviewer line, and name it in the 1.7.0 handoff. **No test will fail until then.**
- **Not built, why:**
  - All three lenses (screens #2, tests F1, docs F2) call the value-aware gate a later follow-up.
  - It needs the verified files, which the brief keeps for the lead.
  - It changes how a verification is recorded, mid-release.
  - Several lanes may hold this finding: building it once, later, avoids three edits colliding in `i18n.test.ts`.
- **Files:** none.

## screens#3: after "Bring the rest back now", a chain still being sent opens a review that can only be an error. **Fixed**

- **Change:** `extension/src/ui/components/LovejoinReturn.tsx` `reviewAfterSkip` now also requires that no chain is still being sent: `!(chain && !chain.cut && !chain.stopped && chain.sent < chain.total)`.
  - That is the same reading as Swaps' `chainGoing`, which already hides a by-hand page's foot meanwhile (C09). I inlined it rather than import a screen into a component.
  - **I didn't take the review's exact condition**, `(!chain || stopped || cut)`. It would also keep the review shut after an earlier chain that was all sent (`sent === total`), for example a site's session paid again. There the worker builds the return fine.
  - The press's own stop (`lj.tail.skipped`) and a lock's `CHAIN_CUT` still open the review.
  - A chain a lock wiped and nobody has marked yet would read as going. But `markCut` runs at every alarm run and on each page's refreshing read, so it's marked before any page shows the way out.
- **Tests (failed before, pass now):**
  - `tests/lovejoin-planner.test.ts` › … › "the way out of a return held at its collateral's mix (1.7.0's release review)" › "opens no review once the press finds the chain still being sent, nothing held: its own return brings the rest back (1.7.0's fixes' review, screens#3)".
    - This is the review's own reproduction, with the real worker: the tail marked sent as the press came, and the account read first.
    - The worker's answer is: stage open, nothing held or stopped, `sent < total`, 1 UTxO.
    - `backBuild` refuses with `sess.chainSending`.
    - Before the fix it failed at `reviewAfterSkip(after)` with `expected true to be false`.
    - It imports `reviewAfterSkip` from the UI component, as other worker tests import UI helpers.
  - `tests/collateral-held.test.ts` › "the return's review after the way out" › "never where it runs itself, …, or its chain still being sent". Before the fix: `expected true to be false`.
  - The "opens on…" test gained the stopped, cut and all-sent cases. They pass before and after.
- **Files:**
  - `extension/src/ui/components/LovejoinReturn.tsx`
  - `extension/tests/collateral-held.test.ts`
  - `extension/tests/lovejoin-planner.test.ts`

## Strings, critical keys, e2e, WebAssembly

- **Added:** `lj.launch.copyListed`, in en, es and ja, with provenance `machine` in es and ja. It isn't critical: the derived `critical-keys.json` is unchanged and `i18n.test.ts` passes. It contains no ₳.
  - es: "Ya se puso en marcha un pool con estos valores. Aparecerá en Pools cuando se confirme: úsalo entonces."
  - ja: 「同じ値のプールはすでに開始されています。確認されると「プール」に表示されるので、そのときに使ってください。」
  - Both back-translate to the English.
- **Changed values:** none. **Critical keys changed by me:** none.
- **Grepped** tests, e2e and docs for `lj.launch.copy`, "exists already" and "copy would". Only the pools lane's test needed the new key. `lovejoin-flows.test.ts`'s two "exists already" checks are shown-pool cases and still pass.
- **E2E specs edited:** none. **WebAssembly node tests:** none. **Privacy policy:** nothing changes how data is handled, so no entry is needed.

## Docs the code now differs from (for the docs lanes)

- **Way-out press:** `docs/flows.md:522`, `docs/post-release-roadmap.md:374` and `docs/development.md:147` ("whose press opens its return's review") need: "…unless a chain of the session's is still being sent: its own return brings the rest back."
- **Copy refusal:** `docs/flows.md:530` stays accurate ("refused at Review"). Optionally add that such a refusal says the pool shows under Pools once it's confirmed.

## Runs (one file at a time, all green)

- **Touched:**
  - `collateral-held` 7
  - `lovejoin-merged-review` 42
  - `lovejoin-planner` 88
  - `lovejoin-flows` 33
- **Adjacent:**
  - `chain-stopped-copy` 4, `i18n-critical-helpers` 62, `i18n-assembly` 17, `lovejoin-launch-review-fixes` 6, `lovejoin-hub` 36
  - `lovejoin-screens-review` 26, `lovejoin-merged-screens` 21, `lovejoin-session5-screens` 19, `private-refresh` 10, `review-layout` 13
  - `screens-wiring-review-fixes` 43, `screens` 72, `i18n` 24, `i18n-worker-reasons` 32, `words` 2
  - `i18n-joins` 4, `i18n-values-in-place` 7, `i18n-review-fixes` 3, `i18n-screens` 14, `privacy-notes` 10
  - `shown-text` 2, `ui-safety` 15, `worker-words` 19, `lovejoin-discovery` 27
- **`npm run typecheck`:** clean.
