# v-pr334-0-impact: pr334#0, item 8's entry calls the chain window four, but four-box chains go two at a time

**Verdict: confirmed. Severity: low** (as the finding says, at the bottom of low; nit is defensible). Confidence: high on every fact; the severity is a judgement. Docs only: nothing ships, and it doesn't block 1.7.0.

**One correction: this is #338's sentence, not #334's.** `git blame` puts roadmap.md:405-409 on `62be5bc4` ("docs(web-wallet): 1.7.0's item 8, the Leios run on Musashi, done", PR #338). #334's diff (`git diff ae610284^1 ae610284`) only added the plan's text (item 8 ⬜, "What it's for", "Headless only", ...), with no window and no figures. The user's own note says the same: #338 "updated the item 8 text". File it under #338.

## The facts hold

- **The doc:** roadmap.md:409: "a chain's window of four in flight (`pumpChain`) could be the whole chain, since four at a time, the rest waited for the queue again (120 to 245 s more)."
- **The code has two windows, and they predate the range.** lovejoin.ts:294 `CHAIN_WINDOW = 4`, :300 `CHAIN_WINDOW_FOUR = 2`, :302 `chainWindow = (width) => (width >= 4 ? CHAIN_WINDOW_FOUR : CHAIN_WINDOW)`. The values are the same at `babb8e76` (1.6.0), at `62be5bc4~1` and at HEAD. `git log -S CHAIN_WINDOW_FOUR` gives `b9c35f06` (34e, 2026-10-18), an ancestor of `babb8e76`. So the text was wrong when #338 wrote it.
- **Every chain gets its window from the width it was built at.** There are exactly two creation sites (`grep "flying: \[\]"`):
  - lovejoin.ts:4635 (`publicStart`: the Mix form, Mix again, Bootstrap): `...(built.width === 4 ? { window: chainWindow(4) } : {})`
  - sessions.ts:4937 (a session's return): `summary.lovejoin?.width === 4 ? { window: chainWindow(4) } : {}`. Here `summary.lovejoin.width` is the built chain's width (sessions.ts:4521 `...(chain.width ? { width: chain.width } : {})`); a fallback to three is recorded apart, as `fellBack`.
  - `pumpChain` reads `chain.window ?? CHAIN_WINDOW` (lovejoin.ts:483). So a four-box chain goes two at a time, and one that fell back to three goes four at a time.
- **Four wide ships.** It is in every build: preferences.ts:91 `LOVEJOIN_WIDTHS = [3, 4]`, Settings.tsx:892, and the Mix form's switch (Lovejoin.tsx:2746). The two-at-a-time path is live on mainnet and preprod.
- **The figures** (records on the unmerged `origin/web-wallet/leios-musashi`, `seedelf-leios/results/2026-10-28/`, read with `git show`). Only two runs set a window, both at 4, and no run used 2. So "which wasn't run" is true.
  - `chain-w3-k4` (window 4, 3 wide, 5 txs): the first four landed at 314.04 s, and mix 4 at 434.11 s, so **120 s**. That is the wallet's own behaviour three wide.
  - `chain-w4-k4` (window 4, 4 wide, 6 txs): the first four landed at 153.05 s, and mixes 4 and 5 at 397.92 and 398.86 s, so **245 s**. That is a window the wallet never uses for four-box mixes.

## Impact

- **Who reads it.** No user, site or attacker: the roadmap isn't in the extension. Its reader is whoever plans or builds the Leios change, which the owner put "much later": it needs a Pallas update or core patches, then a CLI release, then a web wallet release.
- **The scenario's mis-edit is possible but unlikely.** In it, someone raises `CHAIN_WINDOW` and misses `CHAIN_WINDOW_FOUR`. The doc's own pointer, `pumpChain`, reads `chain.window ?? CHAIN_WINDOW` (:483), and `ChainProgress.window`'s comment names `chainWindow` (:381). `CHAIN_WINDOW_FOUR` sits six lines below `CHAIN_WINDOW`, and lovejoin-mix-width.md:149 lists both. Even if the edit happened, the harm would be a slower four-wide chain under Leios. No money, no privacy, no lock.
- **The real harm is that the doc misinforms planning.** It understates what Leios would save a four-wide user. A deposit and 5 mixes at window 2 make at least three trips through the queue (2+2+2, more if a pair splits across blocks), not the two the 245 s run made. And "245 s" describes no wallet behaviour. That is "a misleading doc", which the brief rates low, in the file future work is planned from (*Kept in mind*).

## The fix

The proposed line 409 is correct against both the code and the records. It is docs only and within every owner rule: no guard, no privacy note, no UI text, no release date. It changes nothing else:
- No test reads the roadmap's text: `words.test.ts` scans `src/**/*.ts(x)` only, and `activity.test.ts` cites the roadmap in comments.
- Line 409 isn't a heading, so no anchor moves.

Advice:

1. **Keep the "waited for the queue again" framing.** Don't turn it into "sending whole would save 120 to 245 s", as the finding's claim paraphrases it. In the single live runs, sending whole didn't finish sooner end to end, because the first trip's wait varied:
   - Three wide: 462.2 s whole (`chain-w3-all`) against 434.1 s four at a time.
   - Four wide: 388.2 s whole (`chain-w4-all`) against 398.9 s.

   The saving rests on the mechanism and on the write-up's model ("2.5 to 3 minutes sent whole and 4.5 to 5 minutes four at a time", README:143). The fix as written only says what waited, which is right.
2. **Optional, tighter wording:** "a chain's window in flight (`chainWindow`: four, two for four-box mixes; `pumpChain` sends it) could be the whole chain: sent four at a time, the rest waited for the queue again (120 s more three wide, 245 s four wide). The wallet sends four-box mixes two at a time, which wasn't run." It names `chainWindow`, the one place to change, first.
3. **Out of scope:** the unmerged branch's `seedelf-leios/README.md` makes the same simplification, and the roadmap entry sends readers to it:
   - :16 "the wallet's window of four"
   - :49
   - :121 "Sent four at a time, as the wallet sends a chain today, ... 245 s more (4 wide)"
   - :148

   The brief excludes that branch. Mending it is the owner's call, since the branch is kept to learn from.

Checked in passing: roadmap.md:407's "a 4-wide one went four into an EB and the fifth into the next RB" counts mixes, and it matches `chain-w4-all`: the deposit and mixes 1 to 4 in EB 41417, mix 5 in RB 41419. Nothing to fix there.

No scratch files were made.
