# v-pr338-1-trace: pr338#1, "Mended, all of it ran on Musashi", but no Lovejoin withdraw was ever sent

**Verdict: confirmed. Severity: low.**

The HEAD entry claims more coverage than the run had:
- No withdraw was sent.
- The entry's "all of it" takes in withdraws.
- Nothing on HEAD says that none ran.

Two details in the finding are narrower than they read, and its fix has one error: a deposit wasn't mended.

PR #338 is docs only: one file, 6 lines in and 6 out, as the user said. I read the run's branch (`web-wallet/leios-musashi`, `33949ac5`) only with `git show`, as evidence. It's unmerged and out of scope.

I wrote no scratch test. The claim is about a doc and the run's records, so I decided it by reading the records and the harness. No scratch file was written.

## What HEAD says

`docs/post-release-roadmap.md:406` (added by `62be5bc4`, #338):

> **Dijkstra refuses the wallet's script transactions as core builds them.** … Mended, all of it ran on Musashi, Seedelf's and Lovejoin's scripts unchanged. The fix is … (the owner, 2026-10-28). A withdraw can't be mended after it's built: its proofs bind every output.

- **"All of it" includes withdraws.** It means "the wallet's script transactions", plus the launch. The run's README puts withdraws in that set (`seedelf-leios/README.md:60`): "That's each Seedelf spend, each Lovejoin mix and withdraw, and a pool's launch."
- **The README's own summary leaves withdraws out** (`:13`): "Dijkstra refuses every Seedelf spend, every Lovejoin mix and a pool's launch. Mended, every one of them ran on Musashi". The harness says the same (`dijkstra.rs:10`): "each Seedelf spend and each Lovejoin mix". Shortening it for the roadmap widened the set.
- **Nothing else on HEAD covers it.** `git grep -i -E 'musashi|leios'` finds only lines 42 and 405-409 of the roadmap. Line 406's last sentence is the only mention of a withdraw, and it never says that none was sent.

## The trace (branch `33949ac5`, by `git show`)

- **The records.** `seedelf-leios/results/2026-10-28/` holds 20 records. Every `kind` in them, counted: payment 701, mix 134, Seedelf spend 47, deposit 7. The word "withdraw" appears in none of them.
- **The live harness can't send one.**
  - `live.rs:11-43` lists every `live` command: key, status, params, decode, faucet, split, launch, deposit, mixes, chain, single, burst, report, seedelf-deploy, seedelf-fund and seedelf.
  - None is a withdraw, and `live.rs` never mentions one.
- **The withdraw was only built offline.**
  - `measure.rs:282-293` builds one for `numbers`, with a stand-in giveme.my collateral (`giveme_collateral()`) and `change: None`.
  - It's the only kind with `change: None`. `measure.rs:30-33` says why: "None where an output can't move after the fact: a withdraw's proofs bind every output."
- **`live decode` never mended it.**
  - `live.rs:386-405` runs the withdraw, as built, through the node's Dijkstra decoder, which refuses it (README `:57`, `:60`).
  - It mends a transaction only `if let (true, Some(change)) = (m.redeemers() > 0, m.change)` (`:398`), so the withdraw never gets a mend.
- **The README says it outright:**
  - `:66`: "A Lovejoin withdraw can't be mended after the fact … None was sent here."
  - `:157`, under *What wasn't tested*: "A Lovejoin withdraw, which needs core to build it as a map, and giveme.my, which isn't on Musashi."
  - `:158`: "Token pools: the pool here is ADA alone, 5 ₳ a box."
- **The entry's last sentence is right.** On HEAD, `seedelf-core/src/lovejoin/mod.rs:1168-1187` (`owner_context`) shows that an owner's Schnorr proof binds `blake2b_256(serialise_data(outputs) ‖ serialise_data(input refs) ‖ mix_box's hash)`. A higher fee changes an output, which breaks the proofs.

## Where the finding is narrower than it reads

- **"Never been tried under PV 12"** (scenario step 3) goes slightly too far.
  - The withdraw, as built, went through `live decode` and was refused.
  - No mended or map-built withdraw was ever decoded, sent or run. Read it as "never sent or run under PV 12".
- **Token pools and giveme.my** are gaps beside "all of it", not separate false claims: the entry never says either one ran.
  - The Seedelf spends ran with the key's own collateral, not giveme.my's (`live.rs:38-42`, README `:150`).
  - The pool was launched from the templates with ADA alone.
- **The harm is small.**
  - The entry points readers to the branch's `README.md`, which says it plainly, and its last sentence hints at the gap.
  - Nothing ships from this, and the Dijkstra fix is "much later".
  - It's still a misleading doc, which the brief rates low.

## The fix

The finding's fix lists "deposit" as mended, but a deposit runs no script and went out as built:
- README `:67`: "A deposit runs no script and goes as it is."
- `dijkstra.rs:11` says the same, and `live.rs:398` mends only transactions with redeemers.

pr338#2 rewrites "The fix is …" on the same line. To leave that rewrite intact, change only these two sentences:

- "Mended, all of it ran on Musashi, Seedelf's and Lovejoin's scripts unchanged." becomes "Mended, every Seedelf spend and mix and a pool's launch ran on Musashi, Seedelf's and Lovejoin's scripts unchanged."
- "A withdraw can't be mended after it's built: its proofs bind every output." becomes "A withdraw can't be mended after it's built, as its proofs bind every output, so none was sent; nor did a token pool or giveme.my's collateral run there."

These follow the README's `:13`, `:66` and `:157-158`.
