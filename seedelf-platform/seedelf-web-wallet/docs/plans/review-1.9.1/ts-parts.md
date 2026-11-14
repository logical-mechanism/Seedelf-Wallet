# ts-parts (find:ts-parts)

3 finding(s).

## ts-parts#1: A session funding whose chain ends on a carry leaves that carry out of the review's privacy note

- **Severity:** low; **confidence:** traced
- **Where:** `extension/src/background/script-spend.ts:516`
- **Since:** new in 1.9.1

**What.** `whole()` adds up each part's `changeLovelace` (script-spend.ts:516). That sum feeds `fundingPrivacy` (ui/screens/DappApprovals.tsx:443-447, shown at :811).

WebAssembly never reports a carry's ADA, either in `payments` or in `changeLovelace`:
- In core `split` (seedelf-core/src/build.rs:2051-2066), a carrying part's change is only what its kept tokens need (`kept_lovelace = self.change_minimum(&kept)`, 0 with no kept tokens).
- The carry itself is `rest_lovelace`, and `carry` is `#[serde(skip)]` (wasm/src/lib.rs:2973, :3368).

Before #384 a later part always spent every carry, and that part's own change counted the ADA, so the sum was all of the private change. #384 adds a new early return in `chained` (lib.rs:4312-4315, "Paid in full by the carries") that ends a chain on a part that carries. No part spends that carry, so it stays private and no figure counts it.

Only a session funding gets there:
- A funding's amount picks its UTxOs with guessed budgets (`sweep_many_apart` -> `spend.estimate()`, build.rs:3446).
- `SPEND_BUDGET_GUESS` is 100k mem / 450M steps against 76,043 / 337,845,799 measured, about 9.5k lovelace more fee per input.
- A funding gets no measured retry (lib.rs:3571, `request.funding.is_none()`), but the carry is measured.

So when the change is less than about 9.5k lovelace per input above an ADA-only output's least, the amount for the last tokens reads short. The carry goes instead, owed reaches 0, and the chain ends on the carry.

The rest of that review is true:
- Amount, fee, Transactions, total leaving and the balance after are correct.
- The carry's history is its part's origin, never Unknown.
- Send, the pump and the banner are unaffected.

**Scenario.** A site's private session funding whose leftover lands in that window. WebAssembly plans one part that carries 1.457114 ₳ to the wallet's own register, with `changeLovelace` "0". `whole([part]).changeLovelace` is "0", so the review says "This payment ties the private UTxOs it spends to the one-time account. Anyone can see it on chain, the site too." That is false: the same transaction also ties 1.457114 ₳ of private change (the carry) to the one-time account. When other parts have change, the note's "{ada} ₳ private change" figure is too low by the carry.

**Evidence.** Reachability: the chain-rust lane's probe `review_funding_window`, which calls `chained` (chain-rust/q1.out):
- funding=true extra=1212000: parts=1 last: payments0=1275760 tokens=1 change_lovelace=0 fee=233296 carry=Some("1457114")
- funding=true extra=1222000: parts=1 … change_lovelace=1467114 carry=None
- funding=false extra=1212000: parts=1 … change_lovelace=1457114 carry=None

TS side, my run: `npx vitest run tests/zz-review-ts-parts.test.ts --no-cache -t "last part carries|minimum note"` gives 3 passed. Two parts, p0 (carry) and p1 (spends p0's carry, then carries 1.4 ₳ that no part spends):
- `expect(whole([p0, p1]).changeLovelace).toBe("0")` passed.
- `fundingPrivacy("0")` returned "This payment ties the private UTxOs it spends to the one-time account. Anyone can see it on chain, the site too."

Code: script-spend.ts:516 `changeLovelace: sum((p) => p.changeLovelace),`; DappApprovals.tsx:445 `if (BigInt(changeLovelace) > 0n) return t("dappUi.privacy.fundingWithChange", …)`.

**Suggestion.** Either count an unspent carry as change, or let a funding's amount retry with real budgets so a chain never ends on a carry.
- To count it, WebAssembly could add the carry to that part's `change_lovelace` and `change_outputs` when `chained` ends on it, or report the carried lovelace so `whole` can add a carry that no later part spends.
- Either way, add a test with a funding inside the window.

## ts-parts#2: The minimum note would count an ADA-only part's least as the tokens' least (no plan found after #384)

- **Severity:** nit; **confidence:** plausible
- **Where:** `extension/src/background/script-spend.ts:505`
- **Since:** unchanged from 1.9.0 (#384 closes the report's path to it)

**What.** Trace of Q3:
- A part's `payments[0].minimum` is `minimum_seedelf_payment` or `minimum_address_payment` of its own share. It is null for Max and for "most" parts.
- `whole` sums the minimums when every part has one (script-spend.ts:505), and sums the lovelace.
- `MinimumNote` (ui/components/AdaInput.tsx:117-125) shows "{X} ₳ is the least ADA the network accepts with these tokens" when the two sums are equal. `amountText` (:91-94) shows "X ₳, raised from A ₳".

An ADA-only part's minimum is the least of an output of ADA alone (1.457 ₳ to a Seedelf, 0.978 ₳ to an address). When such a part is paid exactly its least, the note counts that output's least as part of the tokens' least.

#384 removes the report's path. Two paths remain in code:
- Chained: the part with the last tokens can't pay what's still owed only because its change would be under an output's least, so it carries. The next part, `amount(carry + rest, owed.max(least([])), [], false)` (lib.rs:4271), then pays least([]) when `rest` still holds spare ADA.
- `in_parts`: `(owed − keep).max(least(share))` leaves owed' < least([]).

Neither showed up in any search, on my side or the chain-rust lane's.

**Scenario.** If WebAssembly planned a part of tokens at their least plus an ADA-only part paid 1.457 ₳ where 0.5 ₳ was owed (asked 2.913 ₳), the review would show "3.87 ₳, raised from 2.913 ₳" and "Raised from 2.913 ₳: 3.87 ₳ is the least ADA the network accepts with these tokens." The tokens need 2.413 ₳, and the payment overpays by 0.957 ₳ plus a fee.

**Evidence.** Synthetic run: `whole([tokens@2413000, adaAlone@1457000])` gave those exact two strings.

Searches on the release build found no plan with an ADA-only part:
- Test wallet A (12 bundles), big UTxO at 2-9 ₳ in 0.25 ₳ steps, spare UTxO of 1.6, 2.5 or 4 ₳, asked the least plus 0.5 ₳: 87 builds, 86 plans and 1 refusal. Every plan was two parts that both send tokens (140 and 100 tokens), each paying exactly what was asked (wasm-runs.jsonl).
- The report's shape (10 sold tokens, bundles at their least, 2 of each on the ADA UTxO) plus a 1.6 ₳ spare, asked the least plus 0.5 ₳, rich swept over 45 values: always one part paying exactly 4.81 ₳.
- The chain-rust lane's post-fix sweep (sweep-bounty-tree.out): 1,011 rows with alone>0: 0 and over>0: 0. Their 1.9.0 sweep (sweep-all-tree190.out) had 284 ADA-only rows and 200 overpaid ones.

**Suggestion.** In `whole`, set `minimum` to null when any part sends no tokens, or sum only the parts that send tokens. A tokenless part's least is never the tokens' least, so the note can't misstate it whatever the planner does. A test with an ADA-only part would pin this.

## ts-parts#3: #384's vault check can still fail by chance, and it misses seven ways of storing the words

- **Severity:** low; **confidence:** confirmed-by-run
- **Where:** `extension/tests/wallet.test.ts:46`
- **Since:** new in 1.9.1

**What.** After `create`, `local.data` holds one key. The stored text is `[["seedelf.vault","{\"version\":1,\"blob\":\"<128 base64>\"}"]]`. The blob is SBV1: 4 + 32 + 12 + 32 + 16 = 96 bytes, so the base64 has no '=' padding.

"version" is a BIP39 word too. The comment names only "seed" and "vault". The record's own JSON puts `vault` and `version` next to each other with only non-word characters between them, so `/vault\W*version/` always matches it.
- New check: false fail = 23 pairs × (1/2048)² = 5.48e-6 per run, about 1 in 182,000. The base64 adds about 1.2e-10 (23 × 123 positions × E[64^-(a+b)] × 64/62).
- Old check (first word anywhere): 3/2048 (seed, vault or version) + 2.5e-5 from the base64 = 1.49e-3 per run, 1 in 671. CI runs it twice, so about 0.3% of CI runs.

False passes: the new check only catches words with nothing but non-word characters between neighbours, in phrase order. It misses seven ways of storing the phrase that the old check caught:
- joined with underscores
- an object keyed by index
- numbered text
- an array of {word} objects
- an array of [index, word] pairs
- the words sorted
- the words reversed

It still catches the realistic regressions: the phrase string, an array of words, and words joined by commas or run together.

This weakens a test only. vault.ts stores `{version, blob}` alone.

**Scenario.** About 1 in 182,000 runs, a generated phrase has "vault" immediately followed by "version", and the check fails on the key text with no words stored. Separately, a future change that stored the words as `{"1":"w1","2":"w2",…}` or under one key per word would pass the new check.

**Evidence.** `python3 -I vault_odds.py <bip39 english.json> 7 200000`:
- BIP39 words inside the fixed text: ['seed', 'vault', 'version']
- old P(fail) = 1.465e-03 + 2.479e-05 = 1.490e-03
- new 23 pairs ~ 1.177e-10 from the base64 alone
- Monte Carlo over 200,000 runs: old failed 281 (1.405e-3), new failed 3

`vault_hits.py` replays the same draws: all three hits were `vault version 'vault","{\\"version'`. Pairs that match the fixed text: [('vault','version')].

`vault_listings.py`: the new check passes (misses) for underscore-joined, object by index, numbered text, array of {word}, array of [index, word], sorted and reversed. The old check catches all of them.

**Suggestion.** Replace the regex with a structural check that can't fail by chance and can't miss words in local storage:
- `expect([...local.data.keys()]).toEqual([VAULT_KEY])`
- the record's keys are exactly `blob` and `version`
- `expect(await openVault(record, PASSWORD)).toEqual(loadTestWasm().phraseToEntropy(phrase))`

## Checked and holds

- Send and the pump: `reviewParts`'s `waits` and parts.ts `parentsOf`/`splitParts` find each part's parent from its inputs. The report's shape, now one transaction (no Transactions row, no wait), goes as any other, and so would a shorter chain or one whose last part carries.
- What the banner shows: `parts: {sent, total}` and `chain: {first, total}` are counts (`sendParts`, `step`, `went`, `holdWaiting`, `nameParts`, handlers.ts `pending-tx`). `parts` is written only on a part with more to go, so the watch on the last part has none and Home says confirmed once it lands, which is true.
- History of a carry no part spends: `activity.classes()` matches a UTxO to the transaction that made it, so the carry takes its part's `origin` (`changeHistory(seen, p.inputs)`, with any earlier carry mapped by `carried`). It is never Unknown, and `arrived()` skips it as the wallet's own. For a funding it is in the session's class, which matches the chain.
- Review totals when the last part carries: `whole`'s `lovelace` and `fee`, and TotalRows' total leaving and balance after, stay true, because the carry neither leaves nor is counted as leaving. tx-view marks the carry output as private (`markYours`).
- Funding collateral: with #384 the chain's first part can also be its last. `amount(..., starts)` still pays the collateral, and `buildFunding` takes it from `first.payments.slice(1)`.
- Minimum note in #384's usual chain shape (carries at their least, then an amount of the last tokens): the sums match only when what's owed is at most least(share), and then the figure is the token outputs' leasts added up, which is true.
- Real WebAssembly, test wallet A (12 bundles), to a Seedelf: asked 0 gave 2 parts, lovelace = minimum = 87.924 ₳. Asked the least plus 1 lovelace, 0.5 ₳ or 2 ₳: 2 parts (140 and 100 tokens), lovelace exactly as asked, minimum 87.924 ₳ (no note). To an address: the same, with the least at 82.18308 ₳.
- Q2: no extension code, test or fixture assumes the old shape. `payment-parts-chain.test.ts` (wallet A: 3 parts, every later part waits) and `payment-parts-review-fixes.test.ts` (every part's origin merged) hold after #384, because wallet A's last part was already an amount of tokens.
- Q2, continued: no extension test or fixture uses the report's shape or expects a trailing ADA-only part. The e2e 'Transactions2' case and `payment-parts.test.ts` are ADA alone, with no chain. The Rust tests only read extension fixtures.
- Re-run on the release build (3063b33f code, the lead's wasm/pkg): payment-parts-chain, payment-parts-review-fixes, payment-parts and wallet tests, 42 passed.
- The vault regex is safe to build from words: BIP39 English words are a–z with no regex metacharacters. vault.ts/wallet.ts write only `{version: 1, blob}` (SBV1, 96 bytes) under `seedelf.vault`.
- Non-fundings can't end on a carry: a payment's amount retries with real budgets through `measured_or_more`. The chain-rust probe agrees: funding=false at 1212000 is an amount with change 1457114.

## Coverage

Read in full:
- transfer.ts, withdraw.ts and parts.ts
- script-spend.ts: `whole`, `carried`, `keepParts`, `partKey`, `laterParts`, `send`
- sessions.ts: `buildFunding`, `fundingRecords`, `sendFunding`, `partsStopped`, `partsMayGo`
- pending.ts and handlers.ts, where they touch parts
- activity.ts: `sent`, `classes`, `arrived`
- The review screens: Transfer.tsx, Withdraw.tsx, DappApprovals.tsx (funding review and `fundingPrivacy`), AdaInput.tsx (`amountText`, `MinimumNote`), ReviewTotals
- wasm/src/lib.rs: `chained`, `fit_part`, `in_parts`, the build_*_parts closures, `transfer_result`, `withdraw_result`, `build_withdraw`
- core build.rs: `split`, `carry`, `carried`, `estimate`, `select_script_inputs`, `holding`

How the checks ran:
- The scratch test ran in my own worktree at 3063b33f (since removed), using the release tree's node_modules and wasm/pkg read-only, with `--no-cache`.
- Its code is at SCRATCH/review-1.9.1/ts-parts/zz-review-ts-parts.test.ts.
- Every plan the runs logged is in SCRATCH/review-1.9.1/ts-parts/wasm-runs.jsonl.

Not done:
- I didn't confirm, through the full `build_withdraw_parts` pipeline, a funding whose chain ends on a carry. That needs `in_parts` to fail and the chain's last-tokens part to land in a window about 9.5k lovelace per input wide. The chain-rust lane's probe confirms it at the `chained` level. My own funding sweep of the report's shape found only refusals between least+5+1.457 ₳ and +1.5 ₳ beyond that.
- No extension test drives the report's shape through the worker. The plan is covered in Rust, and the TS consumers don't depend on its shape.
- I didn't review the private-swap screens beyond confirming that `changeLovelace` appears only in Transfer's Max note and the dApp funding note.
- I didn't open e2e support.ts.

The brief asked for report.md in the lane folder, but the harness refused to write it ("Subagents should return findings as text"). This output is the report.
