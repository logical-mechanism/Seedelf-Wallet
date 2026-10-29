# Review of the merged fixes: the screens and the words

Tree: `W = /home/logic/Documents/LogicalMechanism/Seedelf-Wallet-wt/release-1.7.0` (working changes over `6bca8bec`). Paths below are under `W/seedelf-platform/seedelf-web-wallet/` unless they start with `seedelf-platform/`. Read-only: one scratch test (`extension/tests/zz-review-screens-1.test.ts`, a copy of `lovejoin-planner.test.ts` with two `it.only`s) ran and is deleted; no tracked file touched.

## Findings

### 1. low: a start refused as the copy of a pool no screen shows ("Use that pool instead")

- **Where two areas meet:** the pools lane's x-merge#0 (the launch's copy check now reads `lastListed`) and #336's rule that a listed pool shows only once Koios confirms it.
- **Scenario:** mainnet; our server lists a pool P new to the device (say ADA, 7 ₳ a box). Koios's check of P fails: Koios down, 429s, or a block behind the data layer. `confirmed()` then returns `[]` (`extension/src/background/lovejoin-pools.ts:639`), so P isn't kept.
  - Neither the hub nor the start form's "already shown" list has P. The form's `same`/`copy` read shown pools only (`extension/src/ui/screens/LovejoinLaunch.tsx:147-148, 347-352`), so Review isn't blocked.
  - The build's copy check matches P in `lastListed` (`extension/src/background/lovejoin-launch.ts:250-254`) and throws `lj.launch.copy` (`en.json:3142`): "A pool of these values exists already, and a copy would never be shown. Use that pool instead."
  - No screen has that pool to use until a later list's check confirms it: 5 minutes at best, longer while Koios stays down.
  - The state is new. In 1.6.0 a listed pool showed at once; on HEAD (#336 alone) the start went through.
- **Fix (words only; keep the refusal):** give the case its own line, for a match in `listed` that isn't in `known`. For example, `lj.launch.copyListed`: "A pool of these values was started already. It shows here once it's confirmed: use it then." It needs en, es and ja, and provenance; it isn't critical. Or reword `lj.launch.copy` to cover both cases.

### 2. low: the critical-words gate reads names only, so two changed critical values (and the listing's es/ja) pass as verified

- **What changed:** this round changed the es and ja values of two critical keys:
  - `lj.tail.privacy.wayOut` (tail lane);
  - `settings.koiosOnly.privacy.off` (docs-design lane, provenance `mtpe` → `machine`).

  It also changed one clause of the store description in es and ja (`docs/store/README.md:163`, `:227`). The listing's own rule (`docs/store/README.md:114`) is "back-translate what changed".
- **The gate doesn't catch it:** FIXBRIEF says "A test will fail until that's done", but none does.
  - `extension/tests/i18n.test.ts:194-209` counts a critical key as checked when its *name* is in `verified-critical-{es,ja}.json`: `.filter((k) => !ok.has(baseOf(k)))`.
  - Both names are listed from earlier rounds: `docs/i18n/verified-critical-es.json:143, 312` and `-ja.json:143, 312`.
  - `i18n.test.ts` passes (24/24).
- **Failure scenario:** the lead takes the green run as "nothing left to back-translate". 1.7.0 then ships two es/ja privacy lines that no blind back-translation has read, while the record lists them as verified (owner's rule 6).
- **Not the lanes' fault:** both lanes named their key and said no test fails.
- **Fix:**
  - Before packaging, run the blind round on those two keys in es and ja, and on the listing's two sentences. Note it in each file's reviewer line, and name it in the 1.7.0 handoff.
  - Follow-up, test only: keep a hash of each verified value beside its name, so a changed value fails the test.

### 3. nit: after the way out, a page brought back by hand can open only an error, where a chain is still on its way

- **The gap:** `reviewAfterSkip` (`extension/src/ui/components/LovejoinReturn.tsx:540-543`) checks three things: not `auto`, no `collateralHeld`, and stage `open` with UTxOs at the account. It never looks at `after.chain`.
- **What happens:** the press may find the session's chain still being sent with nothing held. SiteSessions (`:419-421`) and Swaps by hand (`:2406-2411`) then build the return anyway. `buildBack` refuses (`extension/src/background/sessions.ts:4323-4324`), and the page's error reads "Its return through Lovejoin is still being sent. Wait for it to finish." That is right after "Bring the rest back now".
- **Reachable case:** the tail lane's own leftover, its owner's call 2.
  1. A site's session is paid again the same day.
  2. Its new return's chain, with no collateral tail of its own, is being sent while the earlier chain's tail is still within its day, so the page offers the way out.
  3. The press ends the old tail, then pumps the new chain for up to `CHAIN_PUMP_MS`. Then the error shows.
- **Reproduced** with a stand-in, in a scratch copy of `lovejoin-planner.test.ts`: `waitingAtMix`, the hour gone, then the tail marked `scheduled` (a mix that went as the press came, the chain still pending).
  - The press answered `{stage: "open", holding: 1 UTxO, chain: {sent: 3, total: 5, cut: false}}`, with no `stopped` and no `collateralHeld`.
  - `reviewAfterSkip` returned `true`.
  - `backBuild` refused: "Its return through Lovejoin is still being sent. Wait for it to finish."
- **Fix:** also require that no chain is on its way: `&& (!after.chain || !!after.chain.stopped || after.chain.cut)`. The intended cases still open the review:
  - the press's own stop sets `stopped` ("You chose not to wait…");
  - a lock's sets CHAIN_CUT.

## The original findings in this lens, on the merged tree

| id | status | checked |
|---|---|---|
| pr337#0 | fixed | `view()` drops `collateralHeld` once `chainView(...).cut` (`sessions.ts:5636`); planner test passes. Leftovers are the tail lane's owner's calls (finding 3 is one consequence). |
| x-priv#3, x-ui#0, x-docs#5, x-scen#2 | fixed | Line is now "The collateral's mix hasn't gone yet." In every offered state the mix isn't `scheduled` (`tailHeld` → `tailWaits`/`tailBuildable`), so it holds. es/ja match, and neither names giveme.my. |
| x-ui#3 | fixed | U+00A0 before ₳ in all three (checked bytes). |
| pr337#1, x-merge#2, x-ui#1, x-scen#1 | fixed | Checked with the real worker in a scratch test, not only the seam's fabricated answer.<br>• A site's press returns `stage: "open"` and the holding, so `reviewAfterSkip` is `true`.<br>• The review is a direct return with no `collateralTail`.<br>• After Send the chain reads `cut` ("…what was left came back directly").<br>`lj.tail.skipped` is thrown only where the press marked a *pending* chain's tail over: `recordChain`, `tailOf` and `tailChain` mark only ended chains. So "You chose not to wait…" is never shown for something the user didn't choose. |
| x-ui#2, pr337#5(a) | fixed | No empty row before the hour. `.token-row__wide` sits in the 3-column `.token-row` grid as `.token-row__detail` does, without its 12 px. The `li` has no click handler of its own. |
| pr337#5(b), x-ui#4, x-scen#7 | not-a-bug, agreed | `Home.tsx:384` ticks every 10 s. Home renders Dapps (and with it Lovejoin, SiteSession and Session) directly. Nothing is memoized. |
| pr337#3, x-scen#0 | fixed | The press waits behind a runner step with the button disabled (`busy`). No dead button. |
| pr335#0, pr335#3 | fixed | `at` is clamped and the arrows step from it. `key={txHash}` is on the only `TxDetailModal` given parts. A view shows only under the hash it was read for. The e2e reorder uses an existing `withdraw-tx-loading` test id; the lead must run it. |
| pr335#4 | owner-call | Agree: move focus to the other arrow, in both steppers alike, later. |
| pr335#5, x-scen#8 | deferred | The words they show are accurate ("Review it again"). |
| x-priv#0 (Settings line) | fixed | The line is shown only where a data layer exists (`Settings.tsx` KoiosOnly). The en/es/ja meaning matches. It needs the back-translation (finding 2). `e2e/data-layer.spec.ts:71`'s prefix is unchanged. |
| x-rel#1 (listing) | fixed | Counts verified: the merged box is 998 characters and the host rows 2,802, as stated. Back-translation is owed (finding 2). |
| x-merge#0 | fixed, money-wise | Its words in the new state: finding 1. |
| x-merge#1 (traps) | fixed | A trap-stopped chain now reads `lj.chainCut` (translated) instead of "unreachable". `claimSubmit` still lists a trap as "unreachable" until the alarm's next run locks the wallet. That is known and recorded by the traps and docs-roadmap lanes. |
| pr333#0, pr333#5 | words only / not-a-bug | No UI string changed. The form's fixed room is the owner's call. |

## The words: checks

- **Changed keys:** `lj.tail.skipped`, `lj.tail.privacy.wayOut` and `settings.koiosOnly.privacy.off`.
  - All three changed in en, es and ja, and none was added or removed.
  - Provenance is recorded in es and ja (`machine`).
  - The two critical ones were each listed by their lane.
  - `lj.tail.skipped` isn't critical: the derived set matches, and `i18n-worker-reasons` passes.
- **No-break space before ₳:** `lj.tail.privacy.wayOut` is the only changed value with ₳.
- **No module-level `t()`** was added, **and no translated text is compared, parsed or persisted** by new code.
  - `lj.tail.skipped` is written into `chain.stopped`, as every stop reason already is. #337 is unreleased, so no stored record holds the old wording.
- **Old wordings:** grepped across the web wallet. Only the planner's negative check and an unrelated test title match.
- **New core messages** ("…holds more of a token than one output can", "…holds more ADA than there is") reach the UI raw in English, as core's messages always have.
- **Tests run, one file at a time, all pass:**
  - `i18n` 24, `i18n-critical-helpers` 62, `i18n-assembly` 17, `words` 2, `i18n-joins` 4, `i18n-values-in-place` 7, `i18n-review-fixes` 3, `i18n-worker-reasons` 32
  - `i18n-screens` 14, `privacy-notes` 10, `shown-text` 2, `ui-safety` 15, `chain-stopped-copy` 4, `collateral-held` 7, `worker-words` 19
  - `screens-wiring-review-fixes` 43, `tx-view-screen` 40, `lovejoin-merged-screens` 21, `lovejoin-screens-review` 26
- `npm run typecheck`: clean, with the scratch test deleted.
