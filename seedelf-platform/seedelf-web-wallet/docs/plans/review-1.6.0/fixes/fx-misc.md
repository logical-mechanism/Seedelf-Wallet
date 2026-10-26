# Fixer fx-misc (round 3b, lane Z): the data layer, the nits, two small features

Findings R3-15, R3-16, R3-28, R3-21, R3-24, R3-26, R3-27, R3-30, R3-31; QUESTIONS.md's three data-layer questions; and its two small things (PendingBanner's count, and 309#1's "Pay it again anyway").

- **No test needs the pkg rebuilt.** The Rust changes outside seedelf-data are comments only.
- **Never ran a binary from `seedelf-data/target/`.** Only `cargo test`, `cargo clippy` and `cargo fmt` there.

## Findings

| id | status | change |
|---|---|---|
| R3-15 (low) | fixed | `pools_with` (routes.rs): the stable-cursor read's error or timeout goes into the existing `failed` path, so LATEST answers when it's kept, with the same throttled warn. Before the first list it's still the error (503). |
| R3-16 (low) | fixed | A text test of GATHERED (db.rs), the house pattern: its outer `where` ends at `b.slot_no <= $2`, its CTE holds `found_sql`'s holder/id/tx bounds, and `found_sql`'s slot bound stays. |
| R3-28 (nit) | fixed | Runbook (`seedelf-data/deploy/README.md`, *What `.prev` holds*): one passage that stays true across deploys. A read slower than the wallet's 10 s holds its whole part for 5 minutes (a token route's is the private index's). A `.prev` built before 1.6.0's review can take that long on `lovejoin/pools`, and lists a deep-datum pool the wallet refuses, hiding a later genuine one. |
| Q: cold `lovejoin/pools` | partly | Runbook, *After a deploy*: a restarted server works out its first pool list off the request, for up to a minute, so the token routes can answer 503 meanwhile: ask again before you take it for a failed deploy. development.md's curl block needs the same line (docs lane). The actual cold time can't be measured here: it needs the server against home's db-sync. |
| Q: read-on premise | fixed | Runbook, *After a db-sync resync*: resync with `db-sync-insert-options.json`'s options. The crowds and the reads on rely on `tx_out` `consumed` (every output kept, written in chain order), as `prune` and `bootstrap` don't. |
| Q: `tokens/since/{C}` not kept | not-fixed | Parity, kept. Reasons under the owner's calls. |
| R3-21 (nit) | fixed | `reviewHint`: a private Bootstrap gets `lovejoin.review.bootstrapNotePrivate`, "Once funded, the account deposits the boxes, and what's left comes back. …" The public one keeps `bootstrapNote`, which is true there. |
| R3-24 (nit) | fixed | `settings.lovejoin.collateralOn`, three languages: "Mixed once if a pool of 5 ₳ boxes holds enough of other people's; if not, it comes back with the rest. Funding pays a little more for the mix." (74 words before, 26 now). It keeps the tie (the fallback) and the cost. Settings.tsx itself didn't need to change. |
| R3-26 (nit) | fixed | `cantAffordPublic(first, held, mixable)`: "has X ₳ a mix can spend" only over publicMixAda's figure. Over Home's figure (before the UTxOs answer, or a reading too large to keep), 1.5.0's words, as the new `lovejoin.mix.cantAffordPublicHolds`. |
| R3-27 (nit) | fixed | `publicSideOf()` returns the side and `mixable`, and PoolPage passes `mixable` to both HeldOnSide calls (Mix and Bootstrap). The label is then `lovejoin.mix.inPublicSpendable`, "What Lovejoin can spend from your public account". The private side is unchanged. |
| R3-30 (nit) | fixed | `bootstrap_most_in`'s doc (wasm/src/lovejoin.rs): the two reserves, the deposit and its sweep back, each count built. |
| R3-31 (nit) | fixed | MEASURE_LIMIT's doc (eval.rs): 16.5M memory on mainnet and 17.5M on preprod. A Seedelf spend, a mix and a DEX cancel check MAX_TX_BUDGET; a Lovejoin withdraw doesn't (one box at a time; 25 pass the limit). build.rs's MAX_TX_BUDGET doc is kept (the skeptic showed it right) and adds mainnet's epoch 658. |
| Q: PendingBanner's count | fixed | `PendingTx.boxes` (additive, rpc.ts), set by publicSubmit. The done title counts it: "In Lovejoin, held there until you bring it back" for one box, and so does a mix's ("on its way to your private balance"). With no count (a watch from before this), it stays plural, as it was. |
| Q: 309#1's "Pay it again anyway" | fixed | coin-control `collateral()`: past WAIT_MS, while still held as sent, the status is `{ state: "waiting", txHash, late: true }` (additive, rpc.ts). The Collateral page's new WaitingFoot shows Done and, once late, "Pay it again anyway", with "If both land, the first 5 ₳ goes back into your balance." under it, or `blocked`'s why with the button off. The button pays what Set collateral pays; nothing is refused. |

### Why these choices

- **R3-16: the text test, not one CTE string for both queries.** Sharing the CTE means renumbering parameters and reordering `found()`'s slices. That's production SQL, and nothing offline would catch a slip: CI has no Postgres, and the review's throwaway Postgres is gone. A mistake would show only at runtime, against home's db-sync.
- **R3-27: the label says "Lovejoin", not "a mix".** The Bootstrap form shows the same figure under the same label, and nothing is mixed there. `cantAffordPublic` shows only on the Mix form, so it keeps "a mix can spend".
- **The banner: the mix's done title is counted too.** It's the same count, and "their" for one box is the same slip. e2e's public mix is one box, so its expectation changed (below).
- **The collateral: offered only once `late`.** Inside the first 10 minutes a payment is most likely just waiting for a block. 1.5.0 offered Set collateral again at that same point.
- **Paying again is never refused.** The second payment spends other UTxOs, since the first one's are marked spent. If both land, the newer is the collateral ("you"), and the first 5 ₳ is ordinary spendable ADA. The test checks this end to end.

## Tests, fail-before, mutation checks

The fail-before logs are in the scratchpad: `fx-misc-screens-fail-before.log` and `fx-misc-collateral-fail-before.log`. As sc-o-2 did, the screens' helpers (`publicSideOf`, `cantAffordPublic`, `WaitingFoot`) were first extracted with today's behaviour exactly, so each test failed on today's logic, not on a missing export. Every mutation was undone with Edit, the tests rerun, and the hunk put back with Edit. A grep afterwards found no mutation left.

| finding | test (file › name) | fail-before | mutation check |
|---|---|---|---|
| R3-15 | `seedelf-data/api/src/lovejoin/routes.rs` › `a_failed_cursor_read_answers_the_last_list` | `called Result::unwrap() on an Err value: Unavailable(no connection within 2 s)` | `Err(error) => return Err(error)`: both fail with their fail-before lines |
| R3-15 | same › `a_slow_cursor_read_answers_the_last_list` (paused clock, 6 s read) | `… Err value: Unavailable(timed out)` | same |
| R3-16 | `seedelf-data/api/src/lovejoin/db.rs` › `what_a_read_gathered_is_bounded_by_its_block` | a guard: passes before | the reviewer's own mutation, `where b.slot_no <= $2 or true`: fails, printing GATHERED's rest |
| R3-21 | `tests/screens-nits-review-fixes.test.ts` › "a Bootstrap's review hint (…R3-21)" › "from the private balance says it's funded first, never that the deposit goes now, in one transaction" | `expected 'The deposit goes in now, in one trans…' not to contain 'in one transaction'` | private branch off: it fails, and so does session 5's updated line |
| R3-21 | same › "from the public account keeps its note…" | a guard | — |
| R3-26 | same › "the public Mix form's figure…" › "says a mix can spend it only when it's what a mix can spend, and what the account holds otherwise" | `expected 'One box needs about 15.3 ₳ with its m…' to contain 'Your public account holds 10,408.0140…'` | `mixable \|\| true`: fails |
| R3-27 | same › "is what a mix can spend once the account's UTxOs answer, and Home's figure before they do" | `expected { side: { …(2) }, mixable: false } to deeply equal { side: { …(2) }, mixable: true }` | `mixable: false`: fails |
| R3-27 | same › "labels it, for a screen reader and the tooltip, by the same rule; the private side as it was" | `expected 'In your public account' to be 'lovejoin.mix.inPublicSpendable'` | label ignores `mixable`: fails |
| banner | same › "Home's banner for one box…" › "says a Bootstrap's one box is held, and its boxes so" | `expected 'In Lovejoin, held there until you bri…' to contain …` (them, not it) | count forced to 2: fails |
| banner | same › "says a mix's one box is on its way, and its boxes so" | `expected 'In Lovejoin, on their way to your pri…' to contain 'In Lovejoin, on its way to your priva…'` | same: fails |
| banner | same › "says them, as it did, for a watch from before the count" | a guard | — |
| banner (worker) | `tests/lovejoin-flows.test.ts` › "Bootstrap, in place of the seed" › "tells Home's watch how many boxes went, so its banner names one box as one (1.6.0's review of the fixes)" | `expected { kind: 'lovejoin-mix', …(6) } to match object …`, `- "boxes": 1` | `boxes` dropped from publicSubmit's PendingTx: fails, same line |
| 309#1 leftover | `tests/collateral-again-review-fixes.test.ts` › "a collateral payment that may have been dropped" › "is on its way for its first 10 minutes, then late while it can still land" | `expected { state: 'waiting', …(1) } to deeply equal { state: 'waiting', …(2) }`, `- "late": true` | `late` dropped: fails, as does the next |
| 309#1 leftover | same › "can be paid again anyway: the new payment is the collateral, and if both land the first is spendable" | the same `late` line, at its first check | same |
| 309#1 leftover | same › "the Collateral page while its payment waits" › "offers to pay it again anyway once it's late, with one line on both landing, as a choice" | `expected 'Done' to contain 'collateral.payAgain'` | `late && false`: fails; button wired to `onDone`: `expected +0 to be 1` |
| 309#1 leftover | same › "says why it can't while Home holds payments back, its button off" | `TypeError: Cannot read properties of undefined (reading 'props')` (no button) | `late && false`: fails |
| 309#1 leftover | same › "offers no payment again for its first 10 minutes: Done alone" | a guard | — |
| R3-24, R3-28, R3-30, R3-31, runbook lines | words and comments only: no new test | — | — |

**Existing tests changed:**
- `tests/lovejoin-session5-screens.test.ts:437`: the private Bootstrap's hint now expects `bootstrapNotePrivate`.
- `tests/settings.test.ts:225-231`: the new line, and not the old "comes back by itself". The on-by-default and off-with-returns checks are kept, and so is x-i18n-es#1's order ("if not" beside its condition).
- `tests/coin-control.test.ts:159, :181` (wss-2's): their `toEqual` at 11 minutes now carries `late: true`, which is the new behaviour. :90 and :144 are inside 10 minutes and unchanged.

**e2e changed (not run: the lead's):** `e2e/extension.spec.ts:3100`. The one-box public mix's done banner now says "In Lovejoin, on its way to your private balance". No e2e asserts the held label, the Bootstrap's done title, the Settings note or the collateral's waiting foot.

## Files touched

- `seedelf-data/api/src/lovejoin/routes.rs`: `pools_with` and its comments, two tests.
- `seedelf-data/api/src/lovejoin/db.rs`: one test.
- `seedelf-data/deploy/README.md`: three passages in *Routine*.
- `seedelf-platform/seedelf-core/src/eval.rs` (MEASURE_LIMIT's doc) and `src/build.rs` (MAX_TX_BUDGET's doc): comments.
- `seedelf-platform/seedelf-web-wallet/wasm/src/lovejoin.rs`: `bootstrap_most_in`'s doc.
- `extension/src/ui/screens/Lovejoin.tsx`:
  - `reviewHint` and its doc;
  - the new exported `publicSideOf` and `cantAffordPublic`, after `publicMixAda`;
  - HeldOnSide's `mixable` prop;
  - in the Mix form (lane X's): `publicSide` from `publicSideOf`, the can't-afford line, and `mixable` on both HeldOnSide calls.
- `extension/src/ui/components/PendingBanner.tsx`: `boxes`, and the done title's count.
- `extension/src/ui/screens/Collateral.tsx`: the header, the new exported `WaitingFoot`, and the waiting state's foot.
- `extension/src/background/coin-control.ts`: `collateral()`'s `late`, and WAIT_MS's doc.
- `extension/src/background/lovejoin.ts` (lane Y's, two anchored edits): `publicStart` returns `boxes`, and `publicSubmit` puts it on the PendingTx.
- `extension/src/shared/rpc.ts`: `PendingTx.boxes` and `CollateralStatus`'s `late`, both additive.
- `extension/src/i18n/translations/{en,es,ja}.json` and `docs/i18n/{es,ja}-provenance.json`: the keys below.
- `extension/e2e/extension.spec.ts`: line 3100.
- Tests:
  - new: `tests/screens-nits-review-fixes.test.ts` (8) and `tests/collateral-again-review-fixes.test.ts` (5);
  - added: one test in `tests/lovejoin-flows.test.ts`;
  - changed: `tests/lovejoin-session5-screens.test.ts`, `tests/settings.test.ts`, `tests/coin-control.test.ts`.
- This report.

## Keys

**Critical key added:** `collateral.warn.bothLand`. `node scripts/i18n-critical.mjs` (print only) lists it. It needs the lead's `--write` and round 4's blind back-translation. No critical key was changed.

**Other keys added** (es/ja provenance `machine`):

| key | en |
|---|---|
| `lovejoin.review.bootstrapNotePrivate` | Once funded, the account deposits the boxes, and what's left comes back. The boxes stay in the pool, for other people to mix with, until you bring them back: one at a time, or all of them, spaced out. |
| `lovejoin.mix.cantAffordPublicHolds` | 1.5.0's `cantAffordPublic`, verbatim in all three languages, from 499768f6 |
| `lovejoin.mix.inPublicSpendable` | What Lovejoin can spend from your public account |
| `collateral.payAgain` | Pay it again anyway |
| `pending.confirmed.lovejoin_bootstrap_one` / `_other` (es `_one`/`_many`/`_other`, ja `_other`) | In Lovejoin, held there until you bring it back / … them back |
| `pending.confirmed.lovejoin_mix_one` / `_other` (es three forms, ja `_other`) | In Lovejoin, on its way to your private balance / on their way … |

- The two `pending.confirmed.*` plain keys became plural forms, and their old provenance entries were replaced by the forms'. Their es and ja values are unchanged, except es Bootstrap `_one` ("retenida … la traigas").
- **Value changed:** `settings.lovejoin.collateralOn`, in en, es and ja. It's not critical. Put it in round 4's back-translation batch with `bootstrapNotePrivate`, as i18n-existing asked for this key.

## Docs to update

1. **seedelf-data/README.md:177** (*Kept*): the stable cursor is read once a tip. A cursor read that fails or runs past the request's 5 s also gets the last list, as a failed list does; 503 only before the first (R3-15).
2. **seedelf-data/README.md:172** (L6): "each read gathers only the outputs above the highest id read so far" becomes "each read gathers only the holder's outputs above the highest output id and transaction id it has gathered by its block, candidates or not (a later block's have higher ids of both)" (321-lj-rust-data#0).
3. **seedelf-data/README.md:165-169**, *Standard means* (L6, deep-datum's 3): a launch's script row carries a datum, if any, nested no deeper than the wallet reads, 128 levels (`datum.rs` MAX_DEPTH, core's `cbor::MAX_DEPTH`). Past that, the wallet passes the row over and never shows the pool (314-wasm#0).
4. **development.md §2**, after the curl block (:216): a restarted API works out its first pool list off the request, for up to a minute, so the token pools' routes can print 503 meanwhile: ask again before taking it for a failed deploy (as the runbook now says).
5. **flows.md:139/:143** (Collateral): a payment still waited for 10 minutes on may have been dropped. The page (from Home's row or Settings) then offers **Pay it again anyway**, with "If both land, the first 5 ₳ goes back into your balance." It pays what Set collateral pays, from other UTxOs. If both land, the newer is kept aside and the first is ordinary balance. Lovejoin's form still says the collateral is on its way, with no button.
6. **architecture.md:366** (the collateral): the waiting status carries `late` past WAIT_MS while `heldSent` holds the payment.
7. **architecture.md:483 / flows.md:522** (Home's banner): a public mix's or Bootstrap's done title counts its boxes. One box is "held there until you bring it back" or "on its way to your private balance". It's plural for more, and for a watch with no count.
8. **flows.md:512** (the Mix form, public side): once the account's UTxOs answer, the held figure is labelled "What Lovejoin can spend from your public account" (tooltip and screen reader), and its can't-afford line says "has X ₳ a mix can spend". Before they answer, or from a reading too large to keep, it's Home's figure, labelled "In your public account", and the line says "holds X ₳". This is on the Bootstrap form too.
9. **flows.md:522** (Bootstrap): from the private balance, the review's hint says it's funded first, the account then deposits the boxes, and what's left comes back. The public one says the deposit goes now, in one transaction.
10. **flows.md:521 and privacy.md** (Settings' collateral switch, L6): the On note is one line now. The docs carry what it dropped: the collateral becomes a box in the pool of 5 ₳ boxes, mixed once with two other people's boxes; what the mix doesn't use comes back; the mixed box comes back by itself.

No privacy-policy Changes entry: nothing new leaves the device. Paying again is Set collateral's own payment, and the count is the device's.

## Calls the owner might overturn

1. **R3-24's line is two short sentences (26 words), not the skeptic's one of 20.** It keeps "if not, it comes back with the rest", the tie, and the cost.
2. **R3-27's label says "What Lovejoin can spend…"**, since the Bootstrap form shows the same figure.
3. **The banner counts a mix's boxes too,** so a one-box public mix (the classic pool's included) reads "on its way". These are 1.5.0's words for that case, changed; e2e is updated.
4. **Pay it again anyway:**
   - it's offered only once late (10 minutes), on the Collateral page alone;
   - its line is a `.warn.` key, so it's critical;
   - Lovejoin's form, while the payment waits, still has no button to the page. Home's row reaches it. A one-line `offerCollateral` change in lane X's Mix form could offer the page there when `late`. Not done.
5. **`tokens/since/{C}` stays outside ALWAYS_KEPT: parity.**
   - The classic pool's `lovejoin/since/{C}` has been the same since 1.5.0. Its failure costs more (the whole private part for 5 minutes, where a token since throws TokensDown, the token reads alone).
   - Keeping "the current cursor's since" past the budget would need the cache to know each tip's stable cursor, for both pools. That's a cache design change, not a gate fix.
   - The flood that fills the budget (4,096 answers or 64 MB at one tip) also holds the two private connections. So one more kept key wouldn't change what the wallet gets.
6. **R3-16 is a text test** rather than one shared CTE (above).
7. **R3-31: build.rs's MAX_TX_BUDGET doc is kept,** with mainnet's epoch 658 added. eval.rs's comment now says withdraws are unchecked. withdraw_with gaining mix_with's total check, the skeptic's optional code change, isn't done.

## Notes for the lead and other fixers

- **Pkg rebuild: none needed.**
- **i18n gate:** `tests/i18n.test.ts`'s three critical-set checks fail. The causes:
  - my `collateral.warn.bothLand`;
  - another lane's rename, `lovejoin.stuck.privacy.privateAccounts` → `privateNamed`;
  - L5's known drafts.

  Everything else in the 11 i18n and words files passes.
- **Wiring the unit tests don't reach** (static renders start on the private side, and the page's waiting state comes from an effect). For fx-tests, or e2e:
  - PoolPage passes `mixable` from `publicSideOf` to both HeldOnSide calls and to `cantAffordPublic`;
  - the Collateral page passes `set` as WaitingFoot's `onAgain`. In the waiting state, `set` takes its `collateral-build` branch.
- **Edits in others' files, all small and anchored:**
  - `lovejoin.ts` (lane Y): `publicStart`/`publicSubmit`, `boxes` only;
  - Lovejoin.tsx's Mix form (lane X): the `publicSide` line, the can't-afford line, two HeldOnSide props;
  - wss-2's two coin-control assertions; session 5's line 437; settings.test.ts's collateral note test.
- **The 1.5.0 gate** (`tests/lovejoin-1-5-0.test.ts`) passes unedited, on both builds.
- **Scratch** (all prefixed `fx-misc-`, in the scratchpad): the two fail-before logs, the wide runs' logs, the file list. Nothing untracked is left beyond my two new test files.

## Checks

| check | result |
|---|---|
| seedelf-data `cargo fmt --all -- --check` | clean |
| seedelf-data `cargo clippy --locked --all-targets -- -D warnings` | clean |
| seedelf-data `cargo test --locked` (offline) | 126 passed (106 lib, 5, 12, 3); 30 ignored (live, not run) |
| seedelf-platform `cargo fmt --all -- --check` | clean |
| seedelf-platform `cargo check --locked -p seedelf-core -p seedelf-wasm` | clean |
| `npm run typecheck` (src, tests, e2e) | clean, run last against the shared tree |
| my 9 files (new 2, `coin-control`, `settings`, `lovejoin-session5-screens`, `home-review-fixes`, `lovejoin-held-balance`, `lovejoin-flows`, `lovejoin-1-5-0`) | 136 of 136, default and `VITE_ENABLE_MAINNET=false` |
| 50 files reaching what changed (every importer of Lovejoin.tsx, Collateral.tsx, PendingBanner, Settings, Home, coin-control; plus the i18n, words and boundaries checks) | default 884 of 887, preprod 885 of 888: the 3 are the critical-set gate above |
| every i18n and words file (11) | 184 of 187: the same 3 |
| e2e / Playwright | not run (the lead's) |
