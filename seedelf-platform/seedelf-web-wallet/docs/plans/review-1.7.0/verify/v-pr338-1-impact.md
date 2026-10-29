# v-pr338-1-impact: pr338#1, "Mended, all of it ran on Musashi", but no Lovejoin withdraw was ever sent

**Verdict: confirmed. Severity: low**, as filed. That's the bottom of low, and a nit would be arguable. Confidence is high on every fact. I read each one at HEAD (`6bca8bec`) or on the run's branch (`origin/web-wallet/leios-musashi`, `33949ac5`), and the branch only through `git show`.

This is docs only. Nothing in the shipped build changes, and it doesn't block 1.7.0. The proposed fix is right in substance but needs corrections (see *The fix*).

## The facts hold

- **The text.** `post-release-roadmap.md:406` reads, as quoted: "Mended, all of it ran on Musashi, Seedelf's and Lovejoin's scripts unchanged. … A withdraw can't be mended after it's built: its proofs bind every output."
- **"All of it" takes in withdraws.**
  - The bullet's subject is "the wallet's script transactions".
  - The run's README puts withdraws in that set (`:60`): "That's each Seedelf spend, each Lovejoin mix and withdraw, and a pool's launch."
  - The README's own summary leaves them out (`:13`): "Dijkstra refuses every Seedelf spend, every Lovejoin mix and a pool's launch. Mended, every one of them ran". Shortening it for the roadmap widened the set.
  - PR #338's description goes further still: "Mended, everything ran on Musashi".
- **Item 8's plan named withdraws, and the entry is ✅.** #334 (`ae610284`, :405) asked "how many Seedelf spends and Lovejoin transactions (deposits, mixes, withdraws) a block and a second take there".
- **No withdraw was sent.**
  - **The commands.** `live.rs:11-43` lists every `live` command: key, status, params, decode, faucet, split, launch, deposit, mixes, chain, single, burst, report and the three Seedelf steps. None is a withdraw.
  - **The records.** I tallied every `kind` in the 20 records under `results/2026-10-28/`. They hold payments, deposits, mixes and Seedelf spends only.
  - **The offline build.** The withdraw was only built offline, for `numbers` (`measure.rs:282-293`). It's the only kind with `change: None`, which `measure.rs:30-33` explains: "None where an output can't move after the fact: a withdraw's proofs bind every output".
  - **No mend.** `live decode` mends only what has a change to take the fee from, so the withdraw was refused as built and never mended.
  - **The README says it.** `:66`: "None was sent here." `:157`, under *What wasn't tested*.
- **The reason is the mend, not giveme.my.** Core has `withdraw_paid` (`lovejoin/mod.rs:1210`), which puts up an account's own collateral, so a withdraw could have gone without giveme.my. The proofs binding every output are what stopped it. The fix's "since" gives the right reason.
- **Two things beyond the finding:**
  - **The pool was an ADA pool on the generalized templates** (`live.rs:73-75`, `token: None` at `:848`). The harness never touches `Protocol::of` or `Version::Classic`. So the classic pool's scripts never ran on Musashi: `mod.rs:117-124` keeps them apart from the templates, and they are mainnet's Lovejoin today ("Mainnet has no token pools yet", roadmap :394). The README is exact here (`:152`, "Seedelf's variant 1 and Lovejoin's pinned templates ran unchanged"). The roadmap's "Lovejoin's scripts" is broader.
  - **The Seedelf spends weren't the wallet's default shape.** They ran as `transfer_from` with the key's own collateral (`with_account`, `live.rs:38-42`, README `:150`), never with giveme.my's. Neither a Seedelf mint nor a sweep ran.

## Impact

- **No user, site or attacker reaches it.** The roadmap isn't in the extension, and 1.7.0 builds nothing for Dijkstra.
- **Who it misleads:**
  - whoever takes up the Dijkstra fix ("much later") and checks it against this ✅ entry;
  - the owner, if he cites the run.
- **Why the withdraw matters most.** It's the transaction with the most unknowns under PV 12:
  - it's the only one that must be built as a map from the start, with no mend after the fact;
  - by default it takes giveme.my's collateral and signature, which also never ran there;
  - it's how a box leaves the pool.
- **Mitigations, which keep this at the bottom of low:**
  - The entry's own last sentence flags the withdraw.
  - The entry names the README, which says it plainly.
  - Testnets normally fork to a new protocol version before mainnet, and the owner's practice is to run private spends live on preprod before a release. So a fix would very likely meet a withdraw before mainnet does.
- **Severity: low,** the brief's "a misleading doc".
  - Not medium: no statement a user sees is wrong.
  - Not a nit: what was tested is the substance of a ✅ entry, not its wording.

## The fix

The proposed fix is within the owner's rules: docs only, nothing dated, no privacy note touched. Four corrections:

1. **A deposit wasn't mended.** It runs no script and goes as built: README `:67`, `dijkstra.rs:11`, and `live.rs:398`, which mends only what has redeemers. "Mended, every Seedelf spend, deposit, mix …" says otherwise. Drop "deposit".
2. **Keep whose scripts.** The bare "scripts unchanged" loses what the README states. "Seedelf's variant 1 and Lovejoin's pinned templates" says it, and it also stops a reader taking the line to cover the classic pool's scripts.
3. **Leave "The fix is a Pallas update, or patches in core, …" alone.** pr338#2 rewrites that sentence on the same line. Change only the two sentences below.
4. **"a launch" becomes "a pool's launch"**, as in the sentence before. Optionally, add that its certificate 7 went in a transaction of its own, built by `cardano-cli` (README `:72`), so core has never built one. pr338#2's rewrite already says core must.

Suggested text for `:406`:

- "Mended, all of it ran on Musashi, Seedelf's and Lovejoin's scripts unchanged." becomes "Mended, every Seedelf spend and mix and a pool's launch ran on Musashi, Seedelf's variant 1 and Lovejoin's pinned templates unchanged (an ADA pool)."
- "A withdraw can't be mended after it's built: its proofs bind every output." becomes "No withdraw was sent: one can't be mended after it's built, since its proofs bind every output. Nor did giveme.my, a token pool or the classic pool's scripts run there."

**What else it touches: nothing.**
- No test reads the roadmap. `activity.test.ts` only mentions it in comments, and `words.test.ts` reads `extension/src` alone.
- pr338#7's edits are on :405, :407 and :408, other lines. Only pr338#2 shares :406, and these two sentences stay clear of its sentence.
- The text is the README's own words, so the roadmap and the branch agree.

## Method

- No scratch test. I decided the finding by reading HEAD, and the branch by `git show`: the README, `live.rs`, `measure.rs`, `dijkstra.rs` and all 20 records. No scratch file was written, so there's nothing to delete.
- I didn't reach Musashi, Koios or any network.
