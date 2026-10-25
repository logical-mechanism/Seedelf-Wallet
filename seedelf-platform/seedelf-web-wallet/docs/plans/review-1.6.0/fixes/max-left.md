# Fixer max-left (Lane R): 321-parts-worker#6, x-scenarios-sessions#1, 321-parts-rust#2

The Rust half shows in the extension only after the lead rebuilds `wasm/pkg`. No test needs the rebuild: the worker tests stub WebAssembly's answer.

## 321-parts-worker#6 and x-scenarios-sessions#1 (low, ux-words): **fixed**

These are one problem, found twice. Max's note on the UTxOs it left picked between 1.5.0's two reasons by counting inputs. Max in parts leaves UTxOs for reasons that count can't tell apart.

### What changed

- **WebAssembly says why** (`wasm/src/lib.rs`).
  - New `api::LeftWhy`: `Tokens`, `Fee` or `Limit`, serialized `"tokens"`, `"fee"`, `"limit"`.
  - New field `left_why: Option<LeftWhy>` on `TransferResult` and `WithdrawResult`. The JSON key is `leftWhy`, left out when unset.
  - `max_in_parts` sets the field on the last part, beside `left`, and only when it left something. Every other part gets `(0, None)`.
  - The rules:
    - `limit`: the parts reached `MAX_PARTS` (25).
    - `fee`: a part couldn't pay its fee and no chain went, from any anchor. That includes a chain that would pass the 25-part cap: the review then shows fewer than 25 transactions, and what stays can't pay its own way.
    - `tokens`: otherwise. That's a part that failed for anything but its fee, or what a chain's last part couldn't take with the rest (`fitting`'s overflow).
  - One transaction's `buildTransfer`/`buildWithdraw` never set it, and their `left` keeps its 1.5.0 meaning. The worker never builds a one-transaction Max. Only sessions' fundings, which are never Max, call `buildWithdraw`.
- **The worker passes it on.**
  - `script-spend.ts`: `PartBuilt.leftWhy`, and `whole()` takes it from the last part, as it takes `left`.
  - `transfer.ts` and `withdraw.ts` already spread the finished part into the summary, so they pass it with no code change. Their header comments were 1.5.0's ("Max, 20 UTxOs at most"), and now describe Max in parts saying what it left and why.
  - `rpc.ts`: a new `LeftWhy` type, and `leftWhy?` on `TransferSummary` and `WithdrawSummary`.
- **The screens say the true line.**
  - One note, `MaxLeftNote`, exported from `Withdraw.tsx` and used by both reviews. `Transfer.tsx` imports it, as `Pools.tsx` imports from `Staking.tsx`.
  - It replaces the duplicated `summary.inputs < MAX_UTXOS * (parts ? MAX_PARTS : 1)` guess:
    - `fee`: new key `withdraw.leftFee`.
    - `limit`: `withdraw.leftLimit`, its figure now the 25-transaction cap.
    - anything else: `withdraw.leftTokens`, as before.
  - The unused `MAX_UTXOS` constants and Transfer's `MAX_PARTS` are gone.

The review now reads like this:
- "21 private UTxOs stay for another payment: there's too little ADA to pay for spending them." Before: "…a payment takes 20 at most, and some tokens won't fit in one output."
- "40 private UTxOs stay for another payment: a payment goes as 25 transactions at most." Before, 25 parts of 12 read: "…each holds a token that won't fit in one output with the rest."

### Tests

All the Rust tests are in `wasm/tests/api_test.rs`, module `parts_of_any_shape`.

| Test | Fail before | Mutation check |
|---|---|---|
| Rust `max_says_it_left_what_too_little_ada_pays_to_spend`: 2 ₳ of ADA plus 40 move-in bundles at their least, Max to a Seedelf. `left` > 0, and spent + left = every UTxO. The last part's reason is `Fee`, and its JSON `leftWhy` is `"fee"`. No other part has the key. | `left: None, right: Some(Fee)` | Remove `why = LeftWhy::Fee`: `left: Some(Tokens), right: Some(Fee)`. |
| Rust `max_says_what_a_chains_last_part_left_holds_a_token_that_would_not_fit`: 12 bundles, 409 ₳ and three UTxOs of 2^63 − 1 of one token. A chain goes, and its last part leaves one junk UTxO: `(1, Tokens)`, JSON `"tokens"`. | Written after the fix's first cut; see the mutation check. | Remove `why = LeftWhy::Tokens` after a chain went: `(1, Some(Fee))` vs `(1, Some(Tokens))`. |
| Rust `max_says_it_left_what_is_past_the_most_parts_a_payment_goes_as`: 507 UTxOs of ADA. 25 parts, `(7, Limit)`, JSON `"limit"`. | `left: (7, None), right: (7, Some(Limit))` | `why` always `Tokens`: `(7, Some(Tokens))`. |
| JSON names, the three tests above. | (new assertions) | Drop `#[serde(rename_all = "camelCase")]`: all three fail, `String("Fee")` vs `"fee"` and the like. |
| Vitest `tests/max-left-review-fixes.test.ts`, "Max's note on what it left (1.6.0's release review, 321-parts-worker#6, x-scenarios-sessions#1)", three tests: fee (one part of 20, left 21; two parts, left 1), limit (25 parts over 300 and 500 UTxOs), tokens and nothing left. | `Received: "21 private UTxOs stay for another payment: a payment takes 20 at most, and some tokens won't fit in one output."` and `Received: "40 private UTxOs stay for another payment: each holds a token that won't fit in one output with the rest."` (the note moved, unchanged, into `MaxLeftNote` first) | Fee branch removed: `Received "…each holds a token that won't fit…"`. Limit branch removed: the same, for 40. |
| Vitest, same file, "why Max left UTxOs, on the worker's review (1.6.0's release review, 321-parts-worker#6)": the last part's reason on Make public's and Send's reviews in parts; one transaction's; none when nothing's left. Real test pkg, last part's answer stubbed. | (the `whole` hunk went in before its test) | `leftWhy: last.leftWhy` removed from `whole`: `- "leftWhy": "fee"`, the parts case fails. |

## 321-parts-rust#2 (nit, correctness): **fixed**

- **Change.** `max_in_parts` over no UTxOs now builds one transaction's Max over nothing (`part(vec![], tokens)`), which refuses in its own words, and returns that error. Before, it returned `Ok` with zero parts. So the words are one transaction's by construction: "There's nothing in the Seedelf balance to send" or "…to withdraw".
- **Reachable?** Not today, as the finding says. The worker refuses an empty balance first.
- **Test.** Rust `max_in_parts_over_nothing_is_refused_as_one_transactions_max_is` covers Send's Max, Make public's Everything and `most`. For each, the parts' error equals one transaction's.
- **Fail before.** `left: None, right: Some("There's nothing in the Seedelf balance to send")`.
- **Mutation check.** Removing the guard fails the same way.

## Files touched

- `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs`: `LeftWhy`, `left_why` on both results, `max_in_parts` and its two callers' `left_of`.
- `seedelf-platform/seedelf-web-wallet/wasm/tests/api_test.rs`: 4 tests.
- `seedelf-platform/seedelf-web-wallet/extension/src/shared/rpc.ts`: the `LeftWhy` type; `leftWhy?` and `left`'s doc on both summaries.
- `seedelf-platform/seedelf-web-wallet/extension/src/background/script-spend.ts`: `PartBuilt.leftWhy`; `whole` takes the last part's.
- `seedelf-platform/seedelf-web-wallet/extension/src/background/transfer.ts`, `withdraw.ts`: header comments only.
- `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Withdraw.tsx`: `MaxLeftNote`, exported.
- `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Transfer.tsx`: uses it.
- `seedelf-platform/seedelf-web-wallet/extension/src/i18n/translations/{en,es,ja}.json`
- `seedelf-platform/seedelf-web-wallet/docs/i18n/{es,ja}-provenance.json`
- `seedelf-platform/seedelf-web-wallet/extension/tests/max-left-review-fixes.test.ts`: new.

## Keys

- **Critical keys added or changed:** none. These are a plain `note`, not named `.warn.` or `.privacy.`.
- **Added:** `withdraw.leftFee`, in each language's plural forms. Provenance `machine` for es and ja.

  | Form | Value |
  |---|---|
  | en `_one` | "there's too little ADA to pay for spending it." |
  | en `_other` | "there's too little ADA to pay for spending them." |
  | es `_one` | "no hay suficiente ADA para pagar la comisión de gastarlo." |
  | es `_many`, `_other` | "no hay suficiente ADA para pagar la comisión de gastarlos." |
  | ja `_other` | "使うための手数料を払える ADA が足りません。" |

- **Changed:** `withdraw.leftLimit`. `{{max}}` is now the 25-transaction cap. It was 20 or 500 UTxOs. Provenance stays `machine`.

  | Language | Before | Now |
  |---|---|---|
  | en | "a payment takes {{max}} at most, and some tokens won't fit in one output." | "a payment goes as {{max}} transactions at most." |
  | es | (the matching translation) | "un pago va en {{max}} transacciones como máximo." (as `review.partsNote`'s "va en") |
  | ja | (the matching translation) | "1 回の支払いは最大 {{max}} 件のトランザクションまでです。" |

- **Old words.** No test, e2e or doc used them (grepped).

## Docs to update

- **`docs/flows.md`, Send privately's Max** (about line 368).
  - Now: "what it left (past 500, a token that wouldn't fit, a reference script, a return through Lovejoin being sent)".
  - What's true: the review says how many private UTxOs stay, and why, as WebAssembly's last part says (`leftWhy`). That's one of:
    - past 25 transactions: "a payment goes as 25 transactions at most";
    - too little ADA to pay for spending them: a part couldn't pay its fee, and no chain could bring it ADA;
    - a token that won't fit in one output with the rest.
  - The reference script and what a chain being sent holds are still listed UTxO by UTxO (`LeftOutNote`), unchanged.
- **`docs/flows.md`, Make public's Max** (about line 401).
  - Now: "the review says how many are left (past 500)".
  - What's true: how many are left, and why: past 25 transactions, too little ADA to pay for spending them, or a token that won't fit.
- **`docs/architecture.md`, *Max on private Send*** (about line 163).
  - Now: "answers `max`, `left` (the last part's says how many Max left)".
  - What's true:
    - the last part answers `left` and `leftWhy`: how many Max left, and why (`tokens`, `fee` or `limit`; lib.rs `LeftWhy`), absent when it left none;
    - Max in parts over no UTxOs is refused as one transaction's Max is, in its words.
- **`docs/architecture.md`, *A payment in parts*, *The plan*** (about line 168), optional. What `max_in_parts` leaves, and why:
  - `limit` once 25 parts went;
  - `fee` where a part couldn't pay its fee and no chain went, a chain past 25 parts included;
  - `tokens` otherwise.
- **`wasm/README.md`.** The export table has no `buildTransferParts`/`buildWithdrawParts` rows yet (321-lj-rust-data#2, rust-rest's). When they're added, they should say:
  - each part is a `buildTransfer`/`buildWithdraw` result;
  - the last part carries `left` and `leftWhy`;
  - Max over no UTxOs throws one transaction's "There's nothing in the Seedelf balance to send" (or "to withdraw").
- **`seedelf-platform/CLAUDE.md`**, the bullet "The web wallet's Max takes every UTxO, in parts…". Add that the last part says how many it left and why (`LeftWhy`: a token that won't fit, too little ADA to pay its fee even chained, or past 25 parts).

## Calls the owner might overturn

1. **A blocked chain reads as `fee`, not `limit`.** This covers a chain that would pass 25 parts, or fail some other way, after a part couldn't pay its fee. The review then shows fewer than 25 transactions, so "goes as 25 transactions at most" would contradict it. "Too little ADA to pay for spending them" is true of what stays: the ADA that could pay went with the parts that went. Claude's call. The alternative is a typed "past the cap" error from `max_chained`, mapped to `limit`.
2. **The wording.** The fee line is new. The cap line now counts transactions, and drops 1.5.0's "and some tokens won't fit in one output", which parts at the cap don't mean.
3. **The lead-in stays.** The fee case keeps "N private UTxOs stay for another payment:", though another Max over them is refused until more ADA comes in. It's an existing value no finding asked to change.
4. **Max over nothing reuses one transaction's refusal**, rather than adding words of its own.
5. **Where `MaxLeftNote` lives.** It's in `Withdraw.tsx`, to stay inside my files. `ui/components/LeftOut.tsx`, beside `LeftOutNote`, is the more natural home if the screens round wants to move it.

## Notes for the lead and other fixers

- **Tests needing the rebuilt pkg:** none.
  - The Vitest worker tests stub WebAssembly's answer, so they pass on the TypeScript half alone.
  - The one unstubbed test ("never said where Max left nothing") passes on either package. The rebuilt pkg sends no `leftWhy` key when nothing's left.
- **Behaviour that shows only after the rebuild:**
  - Max in parts says why it left UTxOs, on both reviews.
  - Max in parts over no UTxOs is refused in words. The worker refuses that first anyway, so nothing visible changes.
- **`whole()` sets `leftWhy` explicitly.** On a multi-part summary it's always set from the last part, possibly as an explicit `undefined` key. That's harmless for `toEqual` and for JSON. No test uses `toStrictEqual` on these.
- **The shapes test wasn't run.** `payment_parts_shapes_test` is ignored by default and takes about a minute in release. My change doesn't alter which parts get built: only the reason fields, and the empty case, which no shape has.
- **No leftovers.** No private pkg or test copies were made.

## Checks run

| Check | Result |
|---|---|
| `cargo test -p seedelf-wasm`, every target | All pass: 85 api tests, 4 of them new. The ignored shapes test stayed ignored. |
| `cargo fmt --all -- --check` | Clean. |
| `cargo clippy --locked -p seedelf-wasm --all-targets -- -D warnings` | Clean. |
| `npx vitest run`: my new file, i18n, words, i18n-assembly, i18n-critical-helpers, ui-safety, own-account-names, address-routes | 8 files, 135 tests pass. |
| `npx vitest run`: transfer, withdraw, payment-parts, payment-parts-chain, payment-parts-review-fixes, parts-send-review-fixes, history-classes, script-spend-reserved, session-funding-parts | 9 files, 93 tests pass. |
| `VITE_ENABLE_MAINNET=false npx vitest run`: my new file, i18n, words | 3 files, 32 tests pass. |
| `npm run typecheck` | Clean. |
