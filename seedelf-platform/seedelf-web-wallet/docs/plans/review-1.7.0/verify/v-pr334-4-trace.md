# v-pr334-4-trace: verifying pr334#4

**Verdict: confirmed. Severity: nit** (docs wording, no money, privacy or flow at stake).

## The line, on HEAD (6bca8bec)

`seedelf-platform/seedelf-web-wallet/docs/post-release-roadmap.md:407`:

> Sent whole, a 3-wide chain (a deposit and 4 mixes) went into one certified EB, and a 4-wide one went four into an EB and the fifth into the next RB's own body.

`git blame` puts lines 405 to 409 on 62be5bc4, which is PR #338 (merge 6bca8bec), not #334. #334 (ae610284) only added item 8 as a plan: its diff has no "3-wide" or "4-wide" text. So the finding is about #338's text, the docs PR that marked item 8 done. The "pr334" source label is wrong, but the line is real on HEAD.

## The record

The source is the unmerged `web-wallet/leios-musashi` branch at 33949ac5, read with `git show` only: `seedelf-leios/results/2026-10-28/`. Its write-up says KleioScan's placement is the one to trust: "KleioScan's answer is the one here" (README "The live runs").

- `1793217780-chain-w3-all.json` has 5 transactions: the deposit and mixes 1 to 4. All 5 are in the certified EB under RB 41385, so the doc is right about the 3-wide chain.
- `1793218714-chain-w4-all.json` has 6 transactions.
  - The deposit and mixes 1 to 4 (5 transactions) are in the EB certified by RB 41417, at places 1783, 1821, 1827, 1910 and 1946.
  - Mix 5 has `kleio: {block: 41418, certified_eb: false, index: 0}`.
- `musashi/blocks-41261-41760.json` (KleioScan):
  - 41417 has `has_leios_cert: true` and `tx_count: 1950`.
  - 41418 has no certificate, so it is the next RB.
- The write-up's own table (README line 95) reads: `Chain, 4 wide, sent whole (a deposit and 5 mixes) | 6 | 388 | 2 | 1 | 5`, which is 6 transactions, 1 in an RB and 5 in a certified EB.
- `docs/lovejoin-mix-width.md:130` on HEAD gives the shape at the default depth: N = 4 is 5 mixes and 16 leaves. A 4-wide chain is a deposit and 5 mixes.

## The doc against the record

- **Read in the 3-wide clause's unit** (whole transactions, since "a deposit and 4 mixes" went into one EB), "four into an EB and the fifth" describes a chain of 5 with 4 in the EB. The record has 6, with 5 in the EB. That is short by one on both counts.
- **Read as counting mixes** ("four [mixes] ... the fifth [mix]"), the mix counts are right, but the deposit's block goes unsaid, and it was in the EB too. The sentence never says "mixes" for the 4-wide chain, and it drops the shape that the 3-wide clause gives.

The compression came from the branch's README line 115: "The 4-wide chain (a deposit and 5 mixes, …) went 4 into a certified EB, at its very end (places 1,783 to 1,946), and the 5th …". The roadmap dropped "(a deposit and 5 mixes)", which was the only thing that told a reader the 4 counted mixes.

## Scratch check, run and deleted

I wrote `v-pr334-4-trace-check.py` in my scratchpad folder, outside the tree. It parses line 407's 4-wide clause and checks it against the record (KleioScan's view) and the blocks file. Result on HEAD:

```
doc: 4 into the EB, chain of 5 (the 'fifth' last)
record (KleioScan): 5 into the EB certified by RB [41417]: ['deposit', 'mix 1', 'mix 2', 'mix 3', 'mix 4']
record (KleioScan): 1 in an RB body: [('mix 5', 41418, 0, 'node says', 41419)]
'the next RB' (RB 41418, no cert) holds the rest: True
FAIL: EB count: doc 4, record 5; chain length: doc 5, record 6
exit=1
```

## Corrections to the finding

- **Wrong PR:** #338 (62be5bc4) wrote the line, not #334.
- **Wrong block for mix 5:** the finding says RB 41419. That is the record's top-level `block`, our node's reading "at the tip after it left". KleioScan says RB 41418 at place 0, and the write-up uses KleioScan's answer.
  - 41418 comes right after the certifying RB 41417, so the doc's "the next RB's own body" is right.
  - Had 41419 been the real block, "next" would have been wrong too.

## Fix

The proposed fix is accurate against the record:

> and a 4-wide one (a deposit and 5 mixes) went five into an EB and the last mix into the next RB's own body.

An equivalent wording: "a 4-wide one (a deposit and 5 mixes) went all but its last mix into a certified EB, and that mix into the next RB's own body."

This is a docs-only edit on the release branch. Aside, outside this review's scope: the unmerged branch's README line 115 has the same "went 4 into a certified EB", while its own place range (1,783 to 1,946) holds 5 transactions.
