# v-pr333-2-impact: pr333#2, a dearer byte and the private Bootstrap's cap in the docs

**Verdict: confirmed. Severity: low** (a misleading doc, as the brief's scale has it). The fix is right, with two corrections below.

## What's real

- **flows.md:523 gives a cap that's been wrong since #333.** It says "one deposit's most under today's fees (68 in the classic pool at 6,465 lovelace a byte, half as much again as today's)". At HEAD the cap at 6,465 is 96. #333 edited this bullet ("3 ₳ of reserves" became "3 ₳ of reserves at today's prices") but left the 68.
- **architecture.md:672 contradicts itself.** It says "`lovejoinBootstrapMost`, which builds both for each count: one deposit's most under today's parameters, fewer at a dearer byte". Later in the same paragraph, in #333's own text, it says "so a dearer byte doesn't lower the cap". The second statement is the true one.
- **The flat 1.5 ₳ in flows.md is the weakest part.** "1.5 ₳ for returning the rest" and the review row's "(1.5 ₳, and what it doesn't use comes back)" match today's parameters, and the review row shows the priced figure (`Lovejoin.tsx:3798`, `summary.bootstrapReserve`, from `sessions.ts:2096`). So it's right today. It misleads only because the same bullet then talks about 6,465, where the figure is 1.8 ₳.

## What's overstated

The scenario says the wallet's 1.8 ₳ is something "no doc line says". That's wrong. architecture.md:672 says "1.8 ₳ at 6,465 lovelace a byte", and so does wasm/README.md:69. The docs contradict each other; it isn't that nothing says it.

## Can it happen

- **No user is affected.** These are design docs, not in the store build, and no screen text changed. The code is right: the cap, the funding and the form all use the same priced figure (`bootstrap_most`, `mixFunding`, `bootstrapLimits` with `back`).
- **The figures only part ways at a dearer byte than today's.** Mainnet and preprod are both at 4,310, where the priced reserve is 1.5 ₳ and nothing changes.
- **The harm is to whoever maintains the code next.** Say the owner or an agent checks the wallet against flows.md after a rise in the price of a byte. They'd read a cap of 96 and a 1.8 ₳ reserve as bugs, and could "fix" them back toward the fixed reserve #333 removed.
- Low, not nit: the doc gets a money cap wrong, and the PR said it had updated flows.md. Not medium: nothing a user reads or pays changes.

## The probe (scratch Rust test, deleted)

I ran `bootstrap_most` and the deposit alone across several prices. The scratch test was `seedelf-core/tests/zz_review_v-pr333-2-impact_1.rs`.

| UTxO byte price | Tx byte price (`min_fee_a`) | Way back's reserve | Classic cap | Classic deposit alone | LJTEST cap | LJTEST deposit alone |
|---|---|---|---|---|---|---|
| 4,310 | 44 | 1.5 ₳ | 96 | 96 | 64 | 64 |
| 6,465 | 44 | 1.8 ₳ | 96 | 96 | 64 | 64 |
| 4,310 | 88 | 1.8 ₳ | 96 | 96 | 64 | 64 |
| 8,620 | 88 | 3.3 ₳ | 96 | 96 | 64 | 64 |
| 17,240 | 88 | 6.2 ₳ | 96 | 96 | 64 | 64 |

That's 15 points in all: UTxO byte prices from 4,310 to 17,240 against `min_fee_a` of 44, 66 and 88. The cap equals one deposit's own most at every one.

I also re-ran `bootstrap_most`'s search with the old fixed 1.5 ₳ reserve. At 6,465 it gives **68 classic and 51 LJTEST**; with the priced 1.8 ₳ it gives 96 and 64. So architecture.md's history clause, "where a fixed 1.5 ₳ held it to 68 classic boxes", is correct, and x-docs.md:146 had noted it wasn't re-run. At the worker level LJTEST may take no new box at 6,465 at all (that's pr333#4's ground), which doesn't touch the classic figure here.

## The fix

**Docs only.** No test reads flows.md or architecture.md: `words.test.ts` scans `src/`, and `i18n.test.ts` reads only `docs/i18n`. No strings, guards or privacy notes change, and "1.7.0" is a version, not a release date.

- **flows.md:523, the payment sentence.** Replace "and 1.5 ₳ for returning the rest, a sweep with no collateral; the wallet measures how many by building both, one deposit's most under today's fees (68 in the classic pool at 6,465 lovelace a byte, half as much again as today's)" with: "and a reserve for returning the rest, a sweep with no collateral, priced from the parameters (1.5 ₳ at today's prices, never less; 1.8 ₳ at 6,465 lovelace a byte, half as much again; 1.7.0); the wallet measures how many by building both, one deposit's most at either price".
- **flows.md:523, the review row.** "(1.5 ₳, and what it doesn't use comes back)" becomes "(1.5 ₳ at today's prices, and what it doesn't use comes back)".
- **architecture.md:672: replace, don't just drop.** Dropping only "fewer at a dearer byte" leaves "one deposit's most under today's parameters", which still reads as today's only. Write "which builds both for each count: one deposit's most, at a dearer byte too". This mirrors the doc comment #333 gave the core test (`lovejoin_pools_test.rs`, "and at a dearer byte too, since the way back's reserve follows the parameters").
- **Keep the history clause.** "(1.8 ₳ at 6,465 lovelace a byte, where a fixed 1.5 ₳ held it to 68 classic boxes; 1.7.0)" is verified above.
- **When:** in the release-prep docs commit that ticks item 4. #333's description defers that tick. The same commit should reword post-release-roadmap.md:378, which still says "so a dearer byte lowers the cap (68 classic boxes, and 51 of LJTEST…)" in the present tense. That's pr334#2's ground, not this finding's.

## Duplicates

The same finding with the same fix is in reports/x-docs.md:55-61. reports/x-priv.md:88 and reports/x-scen.md:143 raise it too. Merge them as one.
