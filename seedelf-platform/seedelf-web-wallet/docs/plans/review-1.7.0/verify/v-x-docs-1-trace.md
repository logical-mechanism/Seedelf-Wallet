# v-x-docs-1-trace: x-docs#1, traced on HEAD (6bca8bec)

**Verdict: confirmed, low (docs only).** Two of the three statements are false on HEAD as written. The third, privacy.md:198, is narrower: it's accurate at today's parameters but gives a fixed figure where the code now prices it. One small overstatement in the scenario: it says no doc line gives 1.8 ₳, but the sentence #333 added at architecture.md:672 does, and so does wasm/README.md:69.

## The code path on HEAD

- Core: `bootstrap_back_reserve(params)` (`seedelf-core/src/lovejoin/mod.rs:1744-1751`) is `max(ceil_0.1₳(seedelf_min + sweep_fee + linear_fee(MAX_TX_SIZE) - DEPOSIT_RESERVE), BOOTSTRAP_BACK_RESERVE)`. `bootstrap_most` builds each count with it (`let back = bootstrap_back_reserve(params)?;` at :1974, `.and_then(|f| f.checked_add(back))` at :1990). Before #333 that was `checked_add(BOOTSTRAP_BACK_RESERVE)`, fixed at 1.5 ₳.
- WebAssembly: `lovejoinBootstrapMost` → `bootstrap_most_in` (`wasm/src/lovejoin.rs:2014`) → `bootstrap_most` with the request's params. `lovejoinBootstrapReserve(params)` → `bootstrap_back_reserve` (`wasm/src/lib.rs:5767-5773`).
- Worker:
  - The form's bounds: `privateBootstrapBounds` returns `{ most, back: lovejoinBootstrapReserve(params) }` (`background/lovejoin.ts:2966-2969`).
  - The Bootstrap's check: `mixOutBuild` runs `checkBoxes(boxes, await lovejoin.privateBootstrapMost(network, pool, params), true)` (`sessions.ts:2023`).
  - The funding: `mixFunding` adds `back = lovejoinBootstrapReserve(params)` to the boxes' payment and reports it as `bootstrapReserve` (`sessions.ts:2096`, `:2142`).
- Review: `{summary.bootstrapReserve && <Row label={tr("lovejoin.review.returnRest")} value={tr("lovejoin.collateralReserve.value", { ada: formatAda(summary.bootstrapReserve) })} />}` (`Lovejoin.tsx:3797-3798`). The English text is "{{ada}} ₳, and what it doesn't use comes back". No UI string has a fixed figure, so the defect is in the docs only.

## What #333 changed in the docs (word diff of `b2c3940f^1..b2c3940f`)

- architecture.md: added "…priced from the parameters the review read, never less than `BOOTSTRAP_BACK_RESERVE` (1.5 ₳, today's), so a dearer byte doesn't lower the cap (1.8 ₳ at 6,465 lovelace a byte, where a fixed 1.5 ₳ held it to 68 classic boxes; 1.7.0)". It left "one deposit's most under today's parameters, fewer at a dearer byte" earlier in the same paragraph.
- flows.md:523: changed only `reserves,` → `reserves at today's prices,`. It left "(68 in the classic pool at 6,465 lovelace a byte, half as much again as today's)" in the same bullet, and both "1.5 ₳ for returning the rest" and "*For returning the rest* (1.5 ₳, …)".
- privacy.md: untouched by #333. In the range, only #336's pool-check addition changed it.
- All three phrases came from 677715db (1.6.0's round 3c, an ancestor of babb8e76). They were true under the fixed reserve, and #333 made them stale.

## Scratch test

`seedelf-core/tests/zz_review_v_x_docs_1_trace_1.rs`, deleted after the run. Each `docs_*` test asserts what one doc line says. It also copies core's `fits` closure and binary search, with the reserve passed in, to emulate the cap before #333. Run with `cargo test --locked -p seedelf-core --test zz_review_v_x_docs_1_trace_1 -- --nocapture`:

```
docs_flows_523_68_classic_boxes_at_6465 ... FAILED  (left: 96, right: 68)
docs_architecture_672_fewer_at_a_dearer_byte ... FAILED  (today 96, at 6,465 96)
docs_privacy_198_1_5_ada_for_its_way_back ... FAILED  (today 1500000, mainnet 1500000, at 6,465 1800000)
facts_on_head ... ok
preprod: today reserve 1500000 most 96; at 6,465 reserve 1800000 most 96; pre-#333 (fixed 1500000) at 6,465: 68; today 96
mainnet: today reserve 1500000 most 96; at 6,465 reserve 1800000 most 96; pre-#333 (fixed 1500000) at 6,465: 68; today 96
LJTEST: at 6,465 HEAD most 64 (reserve 1800000); pre-#333 51
coins_per_utxo_size x2/x3/x4: reserve 2.5/4.0/5.5 ₳, classic most 96, LJTEST most 64
min_fee_a x2/x3/x5: reserve 1.8/2.5/4.0 ₳, classic most 96, LJTEST most 64
min_fee_b x2/x5: reserve 1.5/2.3 ₳, classic most 96
```

What the run shows:
- **flows.md:523:** 68 is exactly the cap before #333 at 6,465. On HEAD, on both networks, the cap is 96 there.
- **architecture.md:672:** "fewer at a dearer byte" fails at every dearer price tried: the UTxO byte, the fee byte and the fixed fee. The sentence #333 added ("a dearer byte doesn't lower the cap") is the one that matches HEAD.
- **privacy.md:198:** "1.5 ₳ for its way back" holds at today's preprod and mainnet parameters, both 4,310 lovelace a byte. Above that it's stale. Its "(one deposit's most under today's)" is literally true, but it implies a limit at a dearer byte that no longer exists.

## Corrections to the finding

- The scenario's "which no doc line says" is wrong. architecture.md:672's new sentence, wasm/README.md:69 and core's doc comment all give 1.8 ₳ at 6,465. The finding is right that flows.md doesn't.
- The privacy.md part is narrower than the other two: it describes today correctly. Rule 3 isn't engaged either, because the reserve's amount isn't a privacy statement and nothing about data handling changed.

## Fix advice

- **flows.md:523:**
  - Replace "(68 in the classic pool at 6,465 lovelace a byte, half as much again as today's)" with "(a dearer byte too: the way back's reserve is priced from the parameters, 1.8 ₳ at 6,465 lovelace a byte; 1.7.0)". "At most 96 boxes (64 in a token pool)" already sits earlier in the bullet, so the finding's "(96, or 64…)" would repeat it.
  - Also fix the two other fixed figures in the same bullet: "1.5 ₳ for returning the rest, a sweep with no collateral", and "*For returning the rest* (1.5 ₳, and what it doesn't use comes back)". Say "1.5 ₳ at today's prices", or "at least 1.5 ₳", as #333 did for "3 ₳ of reserves at today's prices".
- **architecture.md:672:** "one deposit's most under today's parameters, fewer at a dearer byte" → "one deposit's most, at a dearer byte too". That's the worker's own wording at `lovejoin.ts:2942`.
- **privacy.md:198:**
  - "1.5 ₳ for its way back" → "at least 1.5 ₳ for its way back, priced from the network's parameters".
  - "(one deposit's most under today's)" → "(one deposit's most)".
- **Adjacent, not in the finding:**
  - post-release-roadmap.md:378 (item 4's *Kept in mind* entry) still describes the fixed reserve as the open problem: "`BOOTSTRAP_BACK_RESERVE` is a fixed 1.5 ₳, so a dearer byte lowers the cap (68 classic boxes…)".
  - *The order*'s item 4 is still 🚧, with only its overflow half ✅.
  - That's list bookkeeping for release prep. Items 5–7, merged in #335–#337, are equally unmarked.
- **Not to change:** `docs/archive/plans/chunk-34-token-pools.md:970` is an archive and stays as it was.
