# Lane L3cli

Returned by the workflow's agent `aaef730414be9eadf`, written here by the lead from its structured answer.

## Findings (4)

### l3cli#1 · low · The window ranks every ADA-only UTxO ahead of any token UTxO, so 20 small ones (anyone's) shut a large token UTxO out and transfer and sweep -l are refused

- **Where:** `seedelf-platform/seedelf-cli/src/commands/rows.rs:221`
- **Who:** stranger · **Since:** e6d6a18d (d8114f19 on cli/stranger-rows) · **Confidence:** confirmed-by-run

**Scenario:**

The user's Seedelf balance holds one UTxO of 300 ₳ and an NFT. A CLI spend's change keeps all leftover ADA with its last token chunk (build.rs:378), so a user who holds tokens often holds their ADA this way. It also holds 20 ADA-only UTxOs at the contract's least, 1,456,780 lovelace each (29.1 ₳ for all 20). A stranger can make them under a re-randomization of the user's public register, or they can be the user's own small receipts.

Then `transfer -l 50000000` and `sweep -l 50000000` are both refused on every run with "Not enough ADA in the Seedelf balance for this, its fee and the change", though the 300 ₳ UTxO pays alone. With 19 such UTxOs both pay.

`sweep --all` sends the 20 small ones (27.5 ₳) and leaves the 300 ₳ for a next run. So README.md:195's "sends the 20 that bring most" (and "then those that bring most, ADA alone first") and sweep.rs:158 are false.

The way out is `--utxo` naming the 300 ₳ UTxO (README:152), but the error doesn't point there. A payer again decides which UTxOs fill the window, now by paying ADA alone instead of grinding a hash (r2cli#1's class). Before round two the window was Koios's first 20 by tx_hash, so the 300 ₳ UTxO was left out only when its hash sorted above all 20.

**Evidence:**

Code (FIXTREE; the CLI branch is byte-identical):
- rows.rs:217-222, by_worth: `let holds_tokens = u.asset_list.as_ref().is_some_and(|a| !a.is_empty()); Ok(((holds_tokens, std::cmp::Reverse(worth(&u, needs)?)), u))`. The first key is holds_tokens, so worth only orders within each group.
- rows.rs:250-264, window: `let ranked = by_worth(rows, needs)?;` then `build::max_inputs_by(&ranked, needed, at_most, |u| Reverse(place…))`. In build.rs:2995-3000, max_inputs_by sorts the rest back into by_worth order and does `rest.truncate(at_most - taken.len())`.
- transfer.rs:132-138 and sweep.rs:185-199 hand only that window to build::transfer and build::sweep. select_script_inputs takes the blind path there (build.rs:2636-2652): prefixes k = 0..=20 of the window, NotEnough every time, then SEEDELF_SHORT.
- build.rs:365-389, deposit_outputs: `let amount = if i == last { remaining } else { minimum };` The change's last token output carries all remaining ADA.

Run: a scratch crate, /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/0e0d3674-7c6c-46fb-8cae-a49695fa3bfe/scratchpad/r51/work/L3cli/e2e/tests/l3cli_window.rs. It drives the real transfer::run and sweep::run through FIXTREE's own harness (included by #[path], read only), against an offline mock Koios. Command: `CARGO_TARGET_DIR=~/.cache/seedelf-review-51/L3cli-target systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 30m nice -n 10 cargo test -j 4 --offline --manifest-path …/e2e/Cargo.toml --test l3cli_window -- --nocapture --test-threads=1`. Exit 101, output:
- "each ADA-only UTxO: 1456780 lovelace; 20 of them: 29135600 lovelace"
- "Transfer 50 ADA: with 19 ADA-only UTxOs: sent, 20 inputs, the 300 ADA UTxO among them; with 20: sent nothing: Not enough ADA in the Seedelf balance for this, its fee and the change"
- "Sweep 50 ADA: with 19 ADA-only UTxOs: sent, 20 inputs, the 300 ADA UTxO among them; with 20: sent nothing: Not enough ADA in the Seedelf balance for this, its fee and the change"
- sweep --all with 20: "Not Swept: 1 / Past what one transaction takes (run sweep --all again): 1", then "sent, 20 inputs, without the 300 ADA UTxO (outputs 27516540 lovelace in all)".

Words: README.md:195 "then those that bring most, ADA alone first …`sweep --all` sends the 20 that bring most"; sweep.rs:158 "--all sends the 20 UTxOs that bring most".

**Fix:**

Rank the window's rest by worth alone, not by holds_tokens first. ADA alone's worth is its lovelace, and a token UTxO's is its lovelace less its tokens' deposit. A UTxO's place is then what it brings, whatever it holds: piles still come last, and 1.46 ₳ of ADA alone comes after 300 ₳ with an NFT. select_script_inputs's blind order still spends ADA alone first within the window. by_worth's ADA-first key can stay for sweep --all's batches if wanted, but then README:195 and sweep.rs:158 must say "ADA alone first", not "bring most". Optionally, when a spend is short with the window but the owned total pays, say so and name --utxo.

**Known check:**

Searched review-51 (INDEX, FINDINGS, owner-calls, fix-branches, lanes/R2cli.md, verify/r2cli-1.md) for "ADA alone first", "ADA-only first", "bring most", "dust", "small ADA" and "by_worth", and backlog.md for "window", "first 20" and "dust". Found only r2cli#1 (piles first by ground hash, which this window fixed) and owner-calls §7 (2)/(4), which r2cli#1's fix settled. Neither has ADA-only UTxOs filling the window.

### l3cli#2 · low · fund's new holders_of takes the holder with the most of the sent token first, so a stranger's UTxO holding more of it leads, and fund refuses or carries its junk

- **Where:** `seedelf-platform/seedelf-core/src/utxos.rs:220`
- **Who:** stranger · **Since:** af022a6f (afc52463 on cli/stranger-rows) · **Confidence:** confirmed-by-run

**Scenario:**

The fund address is the user's browser-wallet address, which is public. It holds U1: 10 ₳ and 5,000 SNEK, and U2: 3 ₳ alone. A stranger sends it S: 3.017 ₳ (its least at the address), 10,000 SNEK and 100 one-of tokens of the stranger's own policy.

`fund -s <seedelf> --asset <SNEK>=100` sends 1,629,180 lovelace and 100 SNEK. main's select picks [U2, U1] and round one's picks [U1], but round two's picks nothing, and fund says "Not Enough Lovelace/Tokens". Without S, round two picks [U1].

Why: S is taken first because it holds more SNEK. Its 100 tokens go to the change, whose floor (6 outputs × the least for all 101 kinds) passes the 16 ₳ the address holds.

With more ADA at the address, fund pays but spends S. The user's own ADA ends up in 6 change outputs carrying the stranger's tokens, at a larger fee. fund has no --utxo, so the way out is moving S with the browser wallet first. The stranger only needs more of the token than the user's largest holder (cheap for a cheap token), where main and round one met holders by lovelace.

**Evidence:**

Code:
- utxos.rs:205-230, holders_of: per token, `holders.sort_by_key(|&i| Reverse(of(i)));` then takes holders until `have >= want.amount`.
- utxos.rs:281-288: `front = holders_of(&held, &tokens)`; the rest are sorted `(!held[i].1.is_empty(), Reverse(held[i].0))`.
- utxos.rs:348-381: once the tokens are found, the change floor is `multiplier.saturating_mul(minimum)` (the least for all change assets × outputs). It recurses with `lovelace + change_floor`, and returns an empty Vec when that's short.
- fund.rs:137-146: an empty pick bails "Not Enough Lovelace/Tokens". FundArgs has no --utxo.
- main's do_select (cd764fba) sorted ADA alone first, then token UTxOs by lovelace. Round one's (af022a6f^) sorted by `(!holds_sent, has_tokens, Reverse(v))`.

Run: the same scratch crate's test fund_takes_a_strangers_larger_holder_first. main's and round one's do_select are copied verbatim into …/L3cli/e2e/tests/old_select.rs, and each pick goes through utxos::fitting first, as fund.rs does. Exit 101, output:
- "S holds 3017000 lovelace; fund sends 1629180 lovelace and 100 SNEK"
- "without S: [\"U1\"]"
- "with S, main's select: [\"U2\", \"U1\"]; round one's: [\"U1\"]"
- "with S: [] (fund says \"Not Enough Lovelace/Tokens\")"

**Fix:**

Among a token's holders, take first those that bring most once their other tokens' change is paid: lovelace less the least for the tokens it holds that aren't sent (main met them by lovelace). Use the most-of-it rule only for what's still missing, and take a holder that adds less than nothing last. Core's `holding` (build.rs:3023) has the same most-of-it rule. The CLI's window and every Seedelf spend use it, and since round two the window applies it over every owned UTxO, so a stranger's bigger holder is mandatory in `transfer --asset` and `sweep --asset` too, its junk re-made in change on the user's ADA. Give it the same order. This is r2a#3's class (owner-calls §1: "take one that adds less than nothing only when it holds a token being sent, and then last").

**Known check:**

r2cli#2 (fund took a second holder for its ADA; fixed by af022a6f) and r2b#2 (fund's ADA in larger token UTxOs) are the user's own UTxOs, never a stranger's holder. r2a#3 (owner's call) prices a UTxO that adds less than nothing; its family list names Max, measured_or_more, Worth::adds and the sweeps' dusting, not the holders' order in fund or holding. Searched review-51 for "holding", "holders_of", "most of" and "holder"; only verify/r2cli-2.md, which recommended holding's most-first pick without a stranger in view.

### l3cli#3 · low · The window runs core's fitting over every owned UTxO, quadratic in their token kinds, so a stranger's piles slow every transfer, sweep -l and util mint

- **Where:** `seedelf-platform/seedelf-cli/src/commands/rows.rs:257`
- **Who:** stranger · **Since:** e6d6a18d (d8114f19 on cli/stranger-rows) · **Confidence:** confirmed-by-run

**Scenario:**

A stranger pays the user's register 20 UTxOs of 1,250 one-of tokens each (one policy, two-byte names), each at its least of 23.16 ₳: 463 ₳ in all. The user can't usefully spend them, since re-made 20 tokens an output each needs 122.3 ₳. Every transfer, sweep -l and util mint then spends about 10 s in max_inputs_by before it builds anything. With 40 such UTxOs (926 ₳) it's about 38 s, and the time grows with the square of the kinds.

sweepable bounds sweep --all with MOST_KINDS for exactly this reason, but window has no bound. Before round two these commands summed at most the first 20 rows' tokens.

**Evidence:**

Code path:
- rows.rs:257: `build::max_inputs_by(&ranked, …)` over every owned row.
- build.rs:2988: `fitting(&evaluable, &Assets::new(), holds_needed)`.
- utxos.rs:499-506: `total.merge(tokens)` for each row.
- assets.rs:312-321: merge calls add per token.
- assets.rs:207-216: add does `let mut new_items = self.items.clone();` plus a linear find, per token. K kinds cost about K²/2 clones.
- rows.rs:129-135 (MOST_KINDS's own comment): "adding them up costs time for nothing: core's token sums grow with the square of the kinds, and anyone can send thousands". sweepable caps at 4,000 kinds; window calls core with no cap.
- Before e6d6a18d, transfer, sweep and mint passed collect_wallet_utxos's 20 rows to select_script_inputs, whose fitting summed only those.

Benchmark: release build of FIXTREE's core by path, source …/L3cli/bench/src/main.rs, run under the memory cap. Each row holds 1,250 tokens at its contract least, 23,157,630 lovelace (minimum_deposit 122,287,630).
- 20 × 100 kinds: max_inputs_by 60 ms.
- 20 × 1,250 (25,000 kinds, 463 ₳): by_worth's per-row work 0.91 s, fitting 11.0 s, max_inputs_by 9.6 s.
- 40 × 1,250 (50,000 kinds, 926 ₳): 1.8 s, 43.2 s and 38.1 s.

**Fix:**

Two levels:
- In window: hand max_inputs_by only what it could pick, which is the holders of the needed tokens and the best by worth up to 20, or cut at MOST_KINDS as sweepable does.
- Better, fix the class: sum tokens in fitting with a map keyed by (policy, name), and stop Assets::add cloning the whole vector for every token. That also covers the web wallet: select_script_inputs and max_inputs_by run fitting over every owned UTxO there (build.rs:2628 and 2988, the same at web-wallet/1.9.1), and Max in parts calls max_inputs_by for each part.

**Known check:**

Searched review-51 (INDEX, FINDINGS, owner-calls, lanes) and backlog.md/archive plans for "quadratic", "square of", "MOST_KINDS" and "token sums". Found only w2#3 (a bignum's decimal conversion) and R2cli's guard-table line on MOST_KINDS, which bounds sweepable alone.

### l3cli#4 · nit · README says transfer, sweep and util mint can't spend a UTxO holding a reference script, but sweep --all sweeps them and --utxo spends them

- **Where:** `seedelf-platform/README.md:195`
- **Who:** user · **Since:** e6d6a18d (d8114f19 on cli/stranger-rows) · **Confidence:** traced

**Scenario:**

A user reads that the commands "never count a UTxO they can't spend, such as one holding a reference script". Then `sweep --all` spends such a UTxO: sweepable counts and prices them up to 204,800 bytes, kept so by owner-calls §7 (3). `transfer`/`sweep --utxo` naming one builds and prices it too, since ScriptSpend adds the reference-script fee (build.rs:2085-2086). Only the CLI's own pick for transfer, sweep -l and util mint leaves them out (eval::refusal in max_inputs_by).

**Evidence:**

README.md:195: "`transfer`, `sweep` and `util mint` never count a UTxO they can't spend, such as one holding a reference script."
- rows.rs:154-161, sweepable: `reference_script_size` is Ok, so the UTxO is taken within MAX_REFERENCE_SCRIPT_BYTES.
- build.rs:2085-2086: `script_bytes += reference_script_bytes(&spent)?` is priced.
- build.rs:2985: `.filter(|u| crate::eval::refusal(u).is_none())` applies in max_inputs_by only.

**Fix:**

Say that their own pick never takes a UTxO holding a reference script, which costs Conway's reference-script fee; `--utxo` can name one, and `sweep --all` sweeps them.

**Known check:**

owner-calls §7 (3) keeps sweep --all spending reference-script UTxOs; verify/r2cli-1.md's fix notes. No record of the README line itself.

## Checked and holds

- The three cherry-picks are byte-identical to their originals (53780f85/02dbefc8, e6d6a18d/d8114f19, af022a6f/afc52463; diffs compared without index lines).
- These are identical on both branches: seedelf-cli (all of it), seedelf-koios/src, seedelf-display, core's utxos.rs, transaction.rs, address.rs and constants.rs, and seedelf-platform's README, CLAUDE.md, Cargo.toml and Cargo.lock.
- The core differences between the branches don't reach the CLI. build.rs's account-collateral holds and apart's short_whole (r2a#2) apply only with an account or with histories, and the CLI uses giveme.my (account None) and Histories::default, so the blind path. asset_id_to_asset, cbor::check_nesting, orders.rs and lovejoin aren't called by the CLI. eval.rs's ogmios_purpose and Byron rows serve local evaluation, and the CLI evaluates through Koios. schnorr.rs is a refactor with a test, behaviour the same. Nothing the CLI needs was left out of the cherry-picks.
- register_of_datum (53780f85): checks the fields' break before the pair's, and still refuses a third item, another constructor, a missing break and trailing bytes; the definite forms are read as before. find_seedelf_datum, find_seedelf_utxo, collect_all_wallet_utxos and fund's register check all read through it.
- The window never takes a Seedelf's UTxO, or the key address carrying the contract's hash (collect_all_wallet_utxos with at_wallet_contract). It leaves out eval::refusal rows and overflow rows, puts the needed tokens' holders first (core's holding), and refuses in words when they're spread over more than 20.
- The window is a subset of max_inputs_by's fits, so select_script_inputs's own fitting keeps all of it, and its holding picks the same holders (stable sort, same quantities).
- --utxo filters collect_all_wallet_utxos (owned, at the script address, no Seedelf) and spends only what's named, matching README:152.
- most_that_fit terminates: each non-TooLarge step removes a row, and TooLarge steps shrink n. Short rows are now reported on both Err paths. "run X again" is printed only when the build succeeded, and the two new unit tests pin both.
- sweep --all now runs by_worth over every owned row before sweepable, and sweepable's MOST_KINDS cap still bounds its token sums. A pile ranks last, and the first 20 by worth go.
- external sweep: only the "again" wording changed in round two.
- fund with no token sent: holders_of is empty, and the order is main's (ADA alone first, by lovelace). With tokens, holders_of picks per token until enough, as build.rs's holding does, and r2cli#2's two scenarios hold (the selection_integration tests, read).
- No command pays an amount, token or address other than what was asked. The fix-ups change only which owned UTxOs become inputs; payments and change are built by core as before.
- The r2cli#1 scenario (20 ground piles below the user's five 100 ₳ rows) is covered by window.rs's tests: every command pays from the user's rows.

## Notes

- The quadratic in l3cli#3 is a web wallet issue too, outside this lens. At web-wallet/1.9.1, select_script_inputs and max_inputs_by already run fitting over every owned UTxO the extension passes (build.rs:2556 and 2914 at the tag), and Max in parts calls max_inputs_by once per part, for up to 25 parts. A stranger's piles of many token kinds would slow every private payment, more in WebAssembly than the native 10 s / 38 s measured here. I found no finding for it. The root is Assets::add cloning its whole vector per token (assets.rs:207). Worth routing to a web wallet verifier.
- r2a#3's class (owner-calls §1) inside the CLI's spend. select_script_inputs's blind path still sorts the window (holds_tokens, Reverse(lovelace)), so a pile with more lovelace than the user's token UTxOs is met before them, and every later prefix carries it. README:195's "a stranger's pile … comes last" is true of the window's ranking, not of the spend. In l3cli#1's 19-UTxO control, the blind path also took all 19 small ADA-only UTxOs before the 300 ₳ one: 20 inputs, a 1.63 ₳ fee, against about 0.35 ₳ for the one input that pays. Both are the blind path's old order, which r2a#3's fix sketch names.
- core's holding (build.rs:3023) predates chunk 51, but since e6d6a18d the window applies it over every owned UTxO. A stranger's UTxO holding more of a sent token than any of the user's is mandatory in a CLI `transfer --asset` or `sweep --asset`, and its junk is re-made in change on the user's ADA. This is the l3cli#2 family and r2a#3's class; I didn't run this case.
- Grading l3cli#1: low, by analogy with the review's other refusals that have a way out (r2a#2, r2b#2, r2cli#2). It is r2cli#1's class surviving its fix, though: a payer still decides the window, now by paying ADA alone, for about 29 ₳ given to the user, on every run. A tiebreak may weigh it higher.
- Cleanup: I removed ~/.cache/seedelf-review-51/L3cli-target (2.4 GB), which this lens's runs and an earlier, cut-short run of this lens had made. The scratch crates stay in the scratch folder: …/L3cli/e2e (tests/l3cli_window.rs, tests/old_select.rs) and …/L3cli/bench, plus some empty diff files the earlier run left there.

## Coverage

Read in full on FIXTREE (and diffed against the CLI branch):
- seedelf-cli/src/commands: rows.rs, sweep.rs, transfer.rs, external/sweep.rs, spend.rs, fund.rs, and util/mint.rs's run body.
- seedelf-core/src/utxos.rs.
- seedelf-koios register_of_datum and point_bytes.
- All three round-two diffs on both branches, and the branch diff of core, crypto and koios sources.
- README.md lines 149-195 and the root README's diff.

Read in the parts that matter, in seedelf-core:
- build.rs: max_inputs/max_inputs_by/holding/quantity_in; select_script_inputs (blind path and apart); deposit_output(s), token_chunks, minimum_deposit and change_outputs; remainder and stage; the mint, transfer, sweep and external_sweep builders; minimum_address_payment; the build.rs diff between branches.
- assets.rs add/merge, and eval.rs refusal.

Review records: COMMON.md, fix-branches.md, RESUME.md and owner-calls.md; INDEX and FINDINGS searched; verify/r2cli-1.md; R2a's r2a#2 and r2a#3. Skimmed: the CLI harness and window.rs/sweep.rs tests (as templates), and main's and round one's do_select (copied into a test).

Ran: my own scratch e2e tests (2 tests, offline mock Koios, FIXTREE's code by path) and a release benchmark of core's fitting and max_inputs_by. I ran no test in FIXTREE or the CLI branch, and built nothing there.

Not reached: the CLI commands round two didn't touch (remove, create, extract, balance, history); koios paging (round one); a run of l3cli#2's transfer --asset variant; the web wallet and the proofs.
