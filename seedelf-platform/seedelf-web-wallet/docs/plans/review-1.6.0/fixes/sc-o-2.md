# Fixer `sc-o-2`: Home, its banner, the Collateral page, and one e2e (round 2, lane S2)

Findings 309#0, 311#0 and 318-worker#0 (the page half).

- Screens: `ui/screens/Collateral.tsx`, `ui/screens/Home.tsx`, `ui/components/PendingBanner.tsx`.
- e2e: `e2e/extension.spec.ts`, one new test and one changed.
- **No worker file touched**, no Rust. **No test needs the pkg rebuilt.**

## Findings

| id | status | change |
|---|---|---|
| 309#0 (medium) | fixed | **The page:** opened in place (`onSent` given: from Home's row, or Lovejoin under Home), it no longer asks `pending-tx`. Its look reads only `collateral`, at once and every 15 s (`lookAgain`). Home's watch is then the only asker in the window: it is told of the landing, reads the balances again, and its banner says "Collateral set". From Settings, which replaces Home, the page asks as before. **Home (the finding's optional hardening, which also covers two windows):** when the worker answers that it watches nothing while Home holds an ordinary payment still inside its 10-minute hold, Home lets it go and reads the balances again (`unwatched`). Inside those 10 minutes the worker lets such a payment go only once someone has seen it land. The rule applies only to the transaction Home held when it asked, never to one sent while the question was out. Past the hold, nothing changes. |
| 311#0 (low, tests) | fixed | After Back from TPREP's review, the e2e waits for the figure (`/Return on stake\d+(\.\d+)?% a year/`), not the label. Then it goes Back to the list and opens TPREP again, and asserts `asked` is exactly `[LOGIC, TPREP, TPREP]`. Why it now catches a second read: see below. |
| 318-worker#0, the page half | fixed | PendingBanner picks `what` and the done title by `pending.kind === "lovejoin-mix" && pending.bootstrap`, using wlj-4's `PendingTx.bootstrap`. `what` itself is replaced, so every title that uses it names a Bootstrap: sent, not confirmed, maybe sent, expired, not seen, and partly sent. New keys are **"A Bootstrap"** ("A Bootstrap sent. Waiting for the network…") and **"In Lovejoin, held there until you bring them back"**. An ordinary mix keeps its words, which e2e asserts at extension.spec.ts:3054 and :3068, unchanged. |

### Why 311#0's e2e now catches a second `pool_history` read

- **A read that hides the figures shown.** This is the finding's regression: PoolPage stops taking `view.history`.
  - Back then draws "Return on stake Reading…" until the answer comes.
  - The route counts a request (`asked.push`) before it fulfils it.
  - So the figure can't show until `asked` already holds 3.
  - The figure wait therefore passes only after the third read, and `expect(asked).toHaveLength(2)` fails. This is deterministic.
  - Before, the wait matched the label, which shows on the "Reading…" row too. `asked` was then checked straight away, before the worker's fetch reached the route.
- **A read behind the figures shown.** For example, the kept figures are drawn and the history is read again anyway.
  - The figure wait passes at once, so the step after it acts as a fence.
  - Opened again from the list, the pool is read afresh: the browser's `onOpen` drops `details` and `history`.
  - That read is asked seconds after Back's, behind a Back press and a click.
  - Its figures show only once the route has counted it, so any read Back set off is already in `asked`.
  - `asked` is then `[LOGIC, TPREP, TPREP, TPREP]`, which is not the `[LOGIC, TPREP, TPREP]` the test expects.
- Not run: Playwright isn't allowed here. The finding's way to check it is to render PoolPage with `knownHistory={undefined}` and run the chunk 37 e2e. It should then fail on the figure wait, at `toHaveLength(2)`.

## Tests, fail-before, and mutation checks

New file: `extension/tests/home-review-fixes.test.ts`, 8 tests.
- The 309#0 tests drive the **real worker** through `handlers.ts` `handle`, with `testBalances()` services, as Home and the page ask it.
- First, `lookAgain` (Collateral.tsx) and `unwatched` (Home.tsx) were extracted with today's behaviour exactly. That way each test failed on today's logic, not on a missing import. Then I fixed them.
- Every mutation below was undone with Edit, the tests were rerun, and the hunk was put back with Edit. A grep afterwards found no mutation left.
- The fail-before run is in the scratchpad: `sc-o-2-fail-before.log`, with 6 failed and the 2 guards passing.

| finding | test (describe › name) | fail-before (today's code) | mutation check |
|---|---|---|---|
| 318-worker#0 | "a Bootstrap from the public account, in Home's banner (…318-worker#0)" › "is named a Bootstrap while it's on its way, never mixes" | `expected 'Mixes into Lovejoin sent. Waiting for…' to contain 'A Bootstrap sent. Waiting for the net…'` | `what` back to `tr(SENT[pending.kind])`: the same failure, and the next test fails too |
| 318-worker#0 | same › "says its boxes are held in Lovejoin once its deposit is in, never on their way to the private balance" | `expected 'In Lovejoin, on their way to your pri…' to contain 'In Lovejoin, held there until you bri…'` | the done title back to `CONFIRMED[pending.kind]`: the same failure |
| 318-worker#0 | same › "is named a Bootstrap in every other title the banner has for it" (not confirmed, maybe sent, expired, not seen) | `expected 'Mixes into Lovejoin not confirmed yet…' to contain 'A Bootstrap not confirmed yet'` | the `what` mutation: the same failure |
| 318-worker#0 | same › "leaves a mix's words as they were" | a guard: passes before and after | — |
| 309#0 | "a collateral payment while its page is open (…309#0)" › "opened in place from Home's row, the page leaves the payment to Home's watch, which is told it landed". The page's look comes before Home's tick, after the landing. | `AssertionError: expected null to match object { kind: 'collateral', …(2) }`: Home's tick was told nothing | the gate undone (`if (!inPlace \|\| inPlace)`): the same failure |
| 309#0 | same › "from Settings, which replaces Home, the page asks about it as Home would, and says it's set once it lands" | a guard: passes before and after | — |
| 309#0 | same › "told nothing of a landing another window's page saw first, Home lets the payment go and reads the balances again". Settings' page in a tab sees the landing first, and Home's tick then gets null from the real worker. | `expected { pending: { …(6) }, read: false } to deeply equal { pending: null, read: true }` | the hold branch disabled (`< -HOLD_MS`): the same failure |
| 309#0 | same › "past its hold says what it said before…" (inside the hold, at it, maybe sent, landed, dropped, none) | `expected { pending: { …(5) }, read: false } to deeply equal { pending: null, read: true }` | the hold branch disabled: the same failure |

**Not unit-tested: the wiring in Home's `watch`.** Vitest has no DOM here, so I read it rather than ran it. The pieces:
- the `drawn` ref;
- the guard, under which a null answer applies only to the transaction Home held when it asked;
- the `load(false)`.

The decision itself, `unwatched`, is tested against the real worker's answer. The e2e below exercises the single-window path end to end.

## e2e changed (`e2e/extension.spec.ts`)

1. **New test (309#0), at line 1983:** "collateral: opened again from the Public tab while its payment waits, the page leaves it to Home's watch (1.6.0's release review, 309#0)", with `test.slow()`.
   - Send from the Public tab's row. Expect "Collateral payment sent. Waiting for the network…" and the row's "Waiting for the network to confirm it".
   - Push the landing (`collateralMadeBy`, `confirmations = 1`) and press the row at once.
   - Expect `collateral-status` "Set: 5 ₳ kept aside for running contracts." (timeout 40 s), then press Back.
   - Expect `pending-tx` to contain "Collateral set", `home-collateral` count 0 (timeout 30 s), and "Send publicly" enabled.
   - On HEAD, the page's at-once look came first in nearly every run. Home's banner then stayed on "sent", and Send publicly stayed disabled.
2. **Changed, at lines 4163–4239:** "staking: a pool's return on stake, read with its page, and on Staking only once Pool details opens (chunk 37)".
   - After Back from TPREP's review, `toContainText("Return on stake")` became `toContainText(/Return on stake\d+(\.\d+)?% a year/)`.
   - Added after the existing `pool_info` check:
     - Back (exact) to the list;
     - TPREP's row again;
     - the figure regex;
     - `expect(asked.map((q) => q.get("_pool_bech32"))).toEqual([LOGIC, TPREP, TPREP])`.
3. **No expectation removed or reworded.** The ordinary mix's banner words at 3054 and 3068 are kept.

I checked every other e2e that opens a second window while a payment is pending: 1760, 2104, 2267, 2456, 3716, 3774 and the later settings ones. Each asserts only the window that saw the landing, or closes the first window. None asserts what the first window's banner shows afterwards. So Home now letting go in the other window changes none of them. In 3716, the extra `balances` read the hardening may make isn't one of the `pool_list`/`totals` calls it counts.

## Files touched

- `extension/src/ui/screens/Collateral.tsx`:
  - the header (who asks while the page waits);
  - the exported `lookAgain`;
  - the `onSent` doc;
  - the look effect (`inPlace`).
- `extension/src/ui/screens/Home.tsx`:
  - the `useRef` import;
  - the `drawn` ref;
  - `watch`'s null branch;
  - the exported `unwatched`, beside `unsettled`.
- `extension/src/ui/components/PendingBanner.tsx`: `bootstrap`, `what`, the done title.
- `extension/src/i18n/translations/{en,es,ja}.json`: two keys each, added beside `pending.*.lovejoin_launch`.
- `docs/i18n/{es,ja}-provenance.json`: `machine` for both keys, beside `pending.*.lovejoin_mix`.
- `extension/e2e/extension.spec.ts`: the two changes above.
- `extension/tests/home-review-fixes.test.ts`: new.
- This report.

## Keys

- **Critical keys added or changed:** none.
- **Other keys added** (es and ja provenance `machine`):

| key | en | es | ja |
|---|---|---|---|
| `pending.sent.lovejoin_bootstrap` | A Bootstrap | Un arranque | ブートストラップ |
| `pending.confirmed.lovejoin_bootstrap` | In Lovejoin, held there until you bring them back | En Lovejoin, retenidas allí hasta que las traigas de vuelta | Lovejoin 内にあり、あなたが戻すまでそこに保持されます |

- The terms follow each language's existing Bootstrap strings:
  - es: "arranque" (`lj.bootstrapHolds`), "retenidas" (`lovejoin.bootstrap.held_other`), "las traigas de vuelta" (`home.lovejoin.bootstrapping_other`).
  - ja: "ブートストラップ", "保持" and "戻す".
  - The done title's shape follows its sibling `pending.confirmed.lovejoin_mix` in each language.
- In Spanish, "Un arranque" sits in the templates as its sibling "Una caja de vuelta de Lovejoin" does, for example "Enviado: Un arranque. Esperando a la red…". The masculine "lo" in `maybeSentTitle` agrees with "arranque".
- `node scripts/i18n-critical.mjs` (print only) lists neither key.
- No existing value changed.

## Docs to update

1. **flows.md:143** (Collateral → *Set collateral*):
   - Opened again from Home's row while its payment waits, the page reads only its status. It leaves the question to Home's watch, which reads the balances again once the payment lands.
   - The page then says Set within 15 s, and Home's banner goes on to "Collateral set". The line "Sent from Home or Lovejoin, it goes to Home's banner, which follows it to 'Collateral set'" is true again on that path.
   - From Settings, the page asks as before.
2. **Home's pending banner.** This goes at flows.md near :216 (the maybe-sent rules), or architecture.md beside the pending watch (:308–320); the docs lane picks.
   - The worker tells only the first page to ask that a payment landed.
   - If Home holds an ordinary payment still inside its 10-minute hold and hears the worker watches nothing, another page or window saw it land. Home then lets it go, with no banner, and reads the balances again, and payments go again.
   - Past the hold, Home still says "not confirmed yet", as before.
   - A maybe-sent payment is let go as before.
3. **architecture.md:483** (`TxBanner`, Home's pending banner) and **flows.md:522** (Bootstrap). wlj-4's items 4 complete with these words:
   - A Bootstrap from the public account carries `PendingTx.bootstrap`.
   - Home's banner names it "A Bootstrap" ("A Bootstrap sent. Waiting for the network…"). Once its deposit is in, the banner says "In Lovejoin, held there until you bring them back".
   - A mix keeps "Mixes into Lovejoin" and "In Lovejoin, on their way to your private balance".

No privacy-policy change: nothing new leaves the device. The page asks the worker less, and Home's extra read is the one its own landing would have made, from the kept reading where there is one.

## Calls the owner might overturn

1. **Home lets go, with no banner, of a payment another page saw land.** It doesn't say "Collateral set" because the worker gave it no confirmations, and nothing on chain was read to say it. This matches chunk 35's rule for Settings' page: "Home then has no banner for it, since the page's question settled it".
   - The alternative is a worker change that answers a landed transaction to an asker naming its hash. That's the finding's trap note, and it's Lane W's work. Not done.
2. **The rule stops at Home's 10-minute hold,** as the finding advised.
   - Suppose a public payment lands after 10 minutes and another window sees it first. Home's "not confirmed yet… If it hasn't by then, nothing was sent" stays, with Dismiss, holding nothing back.
   - The worker keeps a public payment watched until its slot, at least 2 hours. So for one with a slot, a null inside 2 hours also means it was seen landing elsewhere.
   - Extending the rule to that would cover the case. The cost is letting go a true banner in a rarer case: a newer payment from another window took the watch and landed. Not done.
3. **`pending.confirmed.lovejoin_bootstrap` isn't critical.**
   - It's a status title, as its siblings are: no `pending.confirmed.*` key is critical.
   - The critical set holds warnings, privacy notes and errors.
   - The finding suggested making it critical, since it states where money is.
   - To do so: rename it with `.warn.` and back-translate it.
4. **The words** are wlj-4's suggestion: "A Bootstrap" and "In Lovejoin, held there until you bring them back".
5. **The page opened in place says Set up to 15 s after Home's watch saw the landing**, on its own next look, not at once.
   - Home's banner isn't on screen while the page is, so nothing contradicts it.
   - Home could hand its reading down, as Lovejoin's form has it for R6, to make it immediate.

## Notes for the lead and other fixers

- **No pkg rebuild needed.** No worker files touched.
- **`lovejoin-flows.test.ts` not edited.** wlj-4's test there asserts that the real worker's sent and confirmed answers carry `bootstrap: true` and `confirmations: 1`. My banner tests render exactly that shape. The Bootstrap tests pass, 10 of 10 on both builds.
- **For the lead's e2e run:**
  - 309#0's new test waits on Home's 15 s tick and the page's 15 s look: about 30 s, inside its 40 s timeout.
  - 311#0's added steps are a Back and a click on a row the same test clicked before. The query "tprep" stays in the view.
- **The parts fallback in `pending-tx` doesn't break the hold rule.**
  - A later part's send writes ahead into the watch before Koios is asked.
  - Once every part went, the watch holds the last one, and the parts' record is gone (`went`).
  - Send's `sending` mark is cleared before Home gets the payment.
  - So a null inside the hold still means it was seen landing elsewhere.
- **i18n gate:** `tests/i18n.test.ts`'s three critical-set checks fail on others' keys:
  - sc-o-1's `dappUi.back.privacy.noteLovejoinMixed`, `swaps.retry.privacy.cbor`, `swaps.review.privacy.collateralMix`;
  - lane S1's `lj.bring.warn.privatePayNone`, `lovejoin.pools.warn.startedCopy`.
  - None is mine.
- **Cleanup:** my scratch files are `sc-o-2-*` in the scratchpad: the fail-before log and the critical-set print.

## Checks

| check | result |
|---|---|
| Baseline before any change (10 files: banner renderers, `home-says`, `coin-control`) | 245 of 245 |
| `tests/home-review-fixes.test.ts` before the fixes | 6 failed, each for its finding's reason; the 2 guards passed |
| the same after the fixes, default and `VITE_ENABLE_MAINNET=false` | 8 of 8 each |
| mutations: `what`, the done title, the page gate, the hold branch | each failed its tests; each put back with Edit; grep finds none left |
| 17 files: the new one, `lovejoin-screens-review`, `parts-send-review-fixes`, `screens`, `maybe-sent`, `mempool-watch`, `format`, `date-locale`, `privacy-notes`, `home-says`, `coin-control`, `i18n`, `words`, `i18n-critical-helpers`, `i18n-worker-reasons`, `worker-words`, `import-boundaries` | 395 of 398; the 3 are the critical-set gate above |
| the same 16 files without `i18n.test.ts`, `VITE_ENABLE_MAINNET=false` | 374 of 374 |
| the other tests importing Home.tsx (`lovejoin-hub`, `i18n-assembly`, `lovejoin-release-rules`, `lovejoin-restore`, `other-side`, `review-totals-incoming`, `restore-scan`) | 166 of 166 |
| `tests/lovejoin-flows.test.ts -t Bootstrap`, both builds | 10 passed each |
| `npm run typecheck` (src, tests, e2e) | clean |
| e2e / Playwright | not run (the lead runs them) |
