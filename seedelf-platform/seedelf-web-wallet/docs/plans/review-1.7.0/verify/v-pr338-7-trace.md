# v-pr338-7-trace: pr338#7, "Four small figures in the entry don't match the run's records or README"

**Verdict: partly. Severity: nit.** Of the four sub-claims, (a) and (b) are real but tiny, and (c) is a real ambiguity rather than a wrong count. (d) is not a defect.

PR #338 is docs only: one file, `docs/post-release-roadmap.md`, 6 lines in and 6 out, as the user said. Nothing in the wallet changes. The run's records and README are on `web-wallet/leios-musashi` (`33949ac5`, unmerged and out of this review's scope), read here only with `git show`. Only the roadmap entry on HEAD is under review. Lines 405, 407 and 408 are confirmed on HEAD.

## (a) "1.4 to 9 minutes" (:408): confirmed, one transaction of 889

- **The entry (:408):** "Under IO's load, a transaction waited 1.4 to 9 minutes for a block, whatever it was."
- **The README (:16):** "Every run here went in under IO's own load: 1.4 to 9 minutes before a block took it, a single payment as much as a chain." Its range is the table's *All on the ledger* column, which runs from 85 s (One payment) to 527 s (25 chained Seedelf spends): a figure per run. The roadmap restated it per transaction.
- **Every record, per transaction (landed − sent), all 20 files:**
  - 889 transactions landed.
  - The shortest wait is **65.9 s**: `1793223847-chain-w3-all-depth3.json`, the deposit, `"sent": 0.0507`, `"landed": 65.910`, RB 41659 index 2. Our node and KleioScan agree on it. By its slot (942312, with the genesis start 2026-10-18T00:00:00Z and 1 s slots) the wait is 64.9 s.
  - Next comes the single payment at 84.6 s (83.5 s by slot). That is the source of "1.4".
  - The longest is 526.2 s, about 8.8 minutes, in the 25 chained Seedelf spends. "9" holds.
- **Narrower than stated:** only one transaction falls outside the range, so the true lower bound is about 1.1 minutes.

## (b) "5.6× … 2.8×" (:408): confirmed as a dropped qualifier

- **They are the four-box mix's ratios.** The README's table (:134) has "Lovejoin mix, 4 wide … 0.10 | 0.56 | 0.28", and README :15 ties the figures to four-box mixes ("20 four-box mixes went into one EB … Ideally that's 5.6×"). The roadmap's throughput bullet drops that qualifier and says "mainnet's mixes".
- **The default is three** (`docs/lovejoin-mix-width.md:3`: "takes three boxes (N = 3) by default"). For a three-box mix the ratios are:
  - from the README's rounded table (:133, "0.15 | 0.95 | 0.46"): 6.33× and 3.07×;
  - from the harness's own `per_second` (`limits.rs`, p = 0.95^13 = 0.5133, observed share 96/248): 6.305× and 3.053×.
- **The four-box ratios** come out 5.620× and 2.788× by the same formula, so the entry's figures are right for four boxes. Read as "mixes" in general, they understate the default's gain.

## (c) "went four into an EB and the fifth into the next RB" (:407): partly

- **The record** (`1793218714-chain-w4-all.json`) holds 6 transactions:
  - the deposit and mixes 1 to 4 are in a certified EB (KleioScan block 41417, places 1783 to 1946);
  - mix 5 is in RB 41418's own body at place 0 (our node said 41419; the README uses KleioScan's answer).
  - The README's table (:95) agrees: 6 transactions, 1 in an RB, 5 in a certified EB.
- **Counted as mixes, the sentence is right,** and it is word for word what the README's own prose says (:14 "A chain of 5 went 4 into an EB and the 5th…"; :115 "went 4 into a certified EB … and the 5th"). So the entry doesn't contradict the README's prose.
- **But it drops the 4-wide chain's makeup and where the deposit went.** Right after "a 3-wide chain (a deposit and 4 mixes)", "four … the fifth" reads as a five-transaction chain, while the record has six, five of them in the EB.

## (d) "holds the harness (core's builders by path, a relay in Docker)" (:405): refuted as a defect

- **The literal fact is right.** The folder has no Docker, compose or relay file. `live.rs:72` has `const CONTAINER: &str = "leios-relay";`, and `live.rs:137` runs `Command::new("docker")`, which only `docker exec`s into IOG's container on the dev box (README :30).
- **But the parenthetical lists what the harness is built on, not what the folder holds.** Its other item isn't in the folder either: `Cargo.toml:28` has `seedelf-core = { path = "../seedelf-platform/seedelf-core" }`.
- **The same phrase appears at the source:** README :25 says "through a relay in Docker", and `live.rs:1` says "Against Musashi, through the relay in Docker". No reader would look for a relay in the folder.

## Repro

`extension/tests/zz-review-v-pr338-7-trace-1.test.ts` read the roadmap on HEAD and the run branch through read-only `git show`. It was run alone, then deleted. Result: **3 failed, 3 passed.**

- **Failed, as the finding predicts:**
  - (a): "expected 65.85958313941956 to be greater than or equal to 81";
  - (b) against three-box: "expected 5.6 to be close to 6.333333333333333";
  - (c) counted as transactions: "expected 6 to be 5".
- **Passed:**
  - (b)'s control, four-box (5.60× / 2.80×);
  - (c)'s control, counted as mixes (EB: deposit, mix 1 to 4; RB: mix 5, KleioScan 41418);
  - (d): the harness drives `docker exec leios-relay`, and the folder holds neither a relay nor core.
- **Cross-check:** a scratchpad Python pass over all 20 records gave the same minimum and maximum waits.

## Fix advice

All of it is in the roadmap (main) only. The README stays as it is on its unmerged branch.

- **(a):** "1.1 to 9 minutes", or the finding's "about a minute to 9 minutes".
- **(b):** the finding's wording is right: "Ideally 5.6× (four-box) to 6.3× (three-box) mainnet's mixes a second; as Musashi ran, 2.8× to 3.1×". 3.05× rounds to 3.1×.
- **(c):** the finding's wording matches the record: "a 4-wide one (a deposit and 5 mixes) went five into an EB and the last mix into the next RB's own body".
- **(d):** no change needed. "driving a relay in Docker" is harmless if the owner prefers it.
