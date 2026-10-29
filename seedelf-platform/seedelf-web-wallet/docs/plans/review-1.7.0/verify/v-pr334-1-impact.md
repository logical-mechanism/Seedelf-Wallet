# v-pr334-1-impact: "Mended, all of it ran on Musashi", but no withdraw was sent

**Verdict:** confirmed. **Severity:** low (a misleading doc), as filed. **Confidence:** high.

## Attribution and duplicates

- The flagged text is #338's, not #334's. `git blame` puts lines 405 to 409 on `62be5bc4` (#338). #334 only added the plan, which named withdraws as a target: "how many Seedelf spends and Lovejoin transactions (deposits, mixes, withdraws) a block and a second take there" (`git diff ae610284^1 ae610284`). #338 replaced that plan with the results and dropped any word that the withdraw was never tried.
- Two other reviewers filed the same defect: `reports/pr338.md` finding 2 (line 54) and `reports/x-docs.md:114`. Merge the three under #338.

## The facts, checked

- **HEAD's text**, `docs/post-release-roadmap.md:406`: "Dijkstra refuses the wallet's script transactions as core builds them. … Mended, all of it ran on Musashi, Seedelf's and Lovejoin's scripts unchanged. … A withdraw can't be mended after it's built: its proofs bind every output." The last sentence says a withdraw can't be mended. It never says none was sent, so "all of it ran" still reads as covering withdraws.
- **No withdraw was sent.** I counted the kinds in the 20 records on `web-wallet/leios-musashi` (`seedelf-leios/results/2026-10-28/*.json`, read with `git show`). They hold `payment`, `deposit`, `mix` and `Seedelf spend` only, with 0 refused. The branch's README says "A Lovejoin withdraw can't be mended after the fact … None was sent here." Its *What wasn't tested* lists "A Lovejoin withdraw, which needs core to build it as a map, and giveme.my, which isn't on Musashi."
- **The harness has no live withdraw at all.** `live.rs` has steps for launch, deposit, mixes, chain, seedelf and burst. A withdraw is built only offline (`measure::withdraw`, `change: None`), and `dijkstra_report` prints "can't be mended after the fact" for it. Re-running the harness as it stands would never send one.
- **The binding is real** on HEAD. `seedelf-core/src/lovejoin/mod.rs:1171-1188`: `owner_context` is `blake2b_256(outputs ‖ sorted input refs ‖ mix_box_hash)`. `withdraw_with` proves every box over it (`:1481`). The harness's mend raises the fee by 44 lovelace a redeemer and takes the rise from an output. That moves a bound output, so a byte-level mend breaks the proofs.
- **What the owner has been told** says even more than :406. #338's PR body says "Mended, everything ran on Musashi with Seedelf's and Lovejoin's scripts unchanged", and the memory note on the run doesn't mention the gap. Only the unmerged branch's README states it.

## Impact

- **No user, site or attacker reaches this.** `package.mjs` zips `dist/` only, so nothing in `docs/` ships. The only readers are the owner and later sessions.
- **The reader's path is real but unlikely to end in harm.** The Dijkstra fix comes "much later" (the owner). Someone checks it by re-running the branch's harness and trusts "all of it ran", so nobody adds a withdraw step. The withdraw is the one script transaction never sent under PV 12: it goes through `WithdrawZero::patch` and proves over the final outputs.
- **Four things soften it:**
  - The memory note sends Leios work to the branch's README first, and the README states the gap twice.
  - The rest of :406 hints at it.
  - Preprod would fork before mainnet, and live preprod runs of withdraws would probably catch a broken one.
  - A refused withdraw leaves the boxes the user's: stuck until a fixed release, never lost.
- That is "a misleading doc" by the brief's scale: **low**, not medium. Plain wording would make it a nit, but this misstates what was tested.

## The proposed fix

It's right in substance: say plainly that no withdraw was sent, and why. Its wording has two slips:

1. **"Mended, every … deposit … ran"** is wrong. A deposit runs no script and was never mended ("A deposit runs no script and goes as it is", branch README).
2. **It drops the launch.** "All of it" covered the launch, and the launch did run: `mix_logic` was registered first with certificate 7 and a publish redeemer, then the pool launched. "every Seedelf spend" also claims more than ran. Only `transfer_from` ran, with the key's own collateral: no mint, remove, sweep, Max carry or giveme.my-backed spend.

Corrected, as two sentence swaps on :406, docs only:

- "Mended, all of it ran on Musashi, Seedelf's and Lovejoin's scripts unchanged." → "Mended, Seedelf spends, mixes and a launch ran on Musashi, Seedelf's and Lovejoin's scripts unchanged."
- "A withdraw can't be mended after it's built: its proofs bind every output." → "No withdraw was sent, since one can't be mended after it's built (its proofs bind every output), so the fix's check must send one."

**Optional,** from the README's *What wasn't tested* (pr338#2's version had it): "giveme.my's collateral and token pools weren't on Musashi either." The wallet's real private spends and the collateral's mix use giveme.my's collateral. The harness used the account's own instead.

**What the fix touches:** docs only.
- No test reads the roadmap's text: `words.test.ts` scans `extension/src` only, and the other tests name the roadmap only in comments.
- No i18n key, privacy note, release date or store status is involved.
- The merged PR body can't usefully change. The memory note could gain "no withdraw was sent", but that's for the lead or the owner, not this tree.

**A precision note,** not a defect: "can't be mended after it's built" holds for a mend that edits bytes only. A holder of the owner's scalar could mend and then prove again, and in core that is exactly what building it as a map before `prove` amounts to. The existing words are fine for a reader planning the fix.

## Scratch

No scratch files were made. Everything above came from read-only `git show`, `git blame`, `git diff`, `grep` and `gh pr view`.
