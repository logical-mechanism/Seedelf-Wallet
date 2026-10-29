# v-pr334-1-trace: pr334#1, "Mended, all of it ran on Musashi", but no withdraw was sent

**Verdict: confirmed. Severity: low** (a misleading doc; nothing in 1.7.0 changes).

## Attribution

The sentence is #338's, not #334's. `git blame` puts roadmap lines 405 to 409 on 62be5bc4 (#338, merge 6bca8bec). #334 (ae610284) wrote only the plan, and that plan named withdraws among what the run was for: "how many Seedelf spends and Lovejoin transactions (deposits, mixes, withdraws) a block and a second take there". #338 replaced it with the done entry. #338's PR description goes further still: "Mended, everything ran on Musashi", with no word on withdraws.

## The trace

**HEAD, `docs/post-release-roadmap.md:406`:**
> Dijkstra refuses the wallet's script transactions as core builds them. … Mended, all of it ran on Musashi, Seedelf's and Lovejoin's scripts unchanged. … A withdraw can't be mended after it's built: its proofs bind every output.

- "All of it" points back to "the wallet's script transactions".
- By the run's own write-up, those include the withdraw (`origin/web-wallet/leios-musashi:seedelf-leios/README.md:60`): "That's each Seedelf spend, each Lovejoin mix and withdraw, and a pool's launch."
- No other doc on HEAD mentions Musashi, Leios or Dijkstra (`git grep`), so this entry is main's only account of the run.

**No withdraw was ever sent.** Every check was read-only, through `git show` of the run's branch (33949ac5):
- **The records.** I counted the kinds in all 20 records under `seedelf-leios/results/2026-10-28/`. They hold only `payment`, `deposit`, `mix N` and `Seedelf spend N`. No record contains the word "withdraw", and every `refused` list is empty.
- **The harness has no way to send one.** `src/live.rs`'s command list (lines 11 to 42) has key, status, params, decode, faucet, split, launch, deposit, mixes, chain, single, burst, report, seedelf-deploy, seedelf-fund and seedelf. None of them is a withdraw.
  - A withdraw is built only in `src/measure.rs:282-294`, offline, for the throughput table, with `change: None`. The comment at lines 30 to 32 says: "None where an output can't move after the fact: a withdraw's proofs bind every output."
  - `src/main.rs:180`, the `dijkstra` report, prints for it: "can't be mended after the fact … so core must build it so".
- **The write-up says so twice:**
  - README.md:66: "A Lovejoin withdraw can't be mended after the fact … None was sent here."
  - README.md:157, under *What wasn't tested*: "A Lovejoin withdraw, which needs core to build it as a map".
  - Its own summary, line 13, is exact where the roadmap isn't: "Dijkstra refuses every Seedelf spend, every Lovejoin mix and a pool's launch. Mended, every one of them ran". The withdraw is left out of that list. The roadmap's "all of it" put it back in.

**The binding holds on HEAD.**
- `seedelf-core/src/lovejoin/mod.rs:1167-1188`: `owner_context` hashes the outputs, the sorted input refs and `mix_box`'s hash.
- The withdraw's fee settles to `fee = even(needed)` (`mod.rs:1599`; accepted at `:1562` when `fee - needed < 5_000`), which leaves 0 or 1 lovelace of slack.
- The map form costs 44 lovelace a redeemer (README.md:63). That rise comes out of the register's output (`into_register`, `mod.rs:1389-1393`). The output is bound, so the proofs break.
- So "can't be mended after it's built" is right for a mend that doesn't prove again, which is what the harness's `dijkstra::mend` is.

**Why the entry's last sentence doesn't save it.** The entry never says the run mended transactions after they were built. A reader sees "Mended, all of it ran", then "The fix is a Pallas update, or patches in core", then "A withdraw can't be mended after it's built". The natural reading of that last sentence is a constraint on the fix, not "so no withdraw was sent". The literal claim "all of it ran" is false.

**The scenario holds.** Whoever writes the Dijkstra fix later (a Pallas update or core patches) and checks it against this entry would read the withdraw as already run once mended. Two things soften this, which is why it stays low: the entry names the branch's README, which is explicit, and its last sentence hints at the exception.

**One part of the finding is too narrow.** It calls the withdraw "the one transaction never tried under Dijkstra". It isn't the only one. Also never sent:
- a Seedelf mint or burn: `seedelf-fund` is a plain payment to the contract (`live.rs:1165-1177`), and every Seedelf spend was a `build::transfer_from` (`live.rs:1210`);
- a session's return;
- `mix_giveme` (giveme.my isn't on Musashi);
- a token pool's mix (README.md:158);
- the classic 10 ₳ pool's own bundled scripts. The run's pool was launched on the pinned templates with 5 ₳ boxes (`live.rs:73`).

The withdraw is still the one kind in the write-up's own list never sent, and the only one the harness's after-the-fact mend can't reach. So it's the right one to name first. The overstatement is a little wider than the finding says, not narrower.

## Fix advice

The finding's sentence needs three corrections:
- **Deposits weren't mended.** They run no script (README.md:67). Keep them out of "Mended".
- **Keep the pool's launch.** It ran mended, with `mix_logic` registered first by certificate 7.
- **Name the pinned templates.** "Seedelf's and Lovejoin's scripts" also claims the classic pool's scripts, which never ran. README.md:152 says "Lovejoin's pinned templates".

Suggested:

> Mended, Seedelf spends, Lovejoin mixes (an ADA pool on the pinned templates) and a pool's launch ran on Musashi, scripts unchanged. No withdraw was sent: one can't be mended after it's built, since its proofs bind every output, so the fix must send one first.

Optionally, one *Not run* line mirroring the README's: a withdraw, a mint or burn, a token pool, the classic pool, giveme.my.

## Repro

No scratch file was needed: it's a docs finding, decided by tracing the run's records. The command (read-only):

```sh
B=origin/web-wallet/leios-musashi
for f in $(git ls-tree --name-only $B seedelf-leios/results/2026-10-28/); do
  git show "${B}:$f" | jq -r '[.txs[].kind] | unique | join(" | ")'
done
```

- **Result:** 20 files; the kinds are only payment, deposit, mix N and Seedelf spend N.
- `git show … | grep -ci withdraw` is 0 for every record.
- Nothing was written to the tree but this report.
