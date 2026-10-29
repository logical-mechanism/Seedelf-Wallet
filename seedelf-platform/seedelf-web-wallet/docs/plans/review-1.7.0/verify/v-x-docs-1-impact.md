# v-x-docs-1-impact: x-docs#1, judged for impact and the fix

**Verdict: confirmed, low.** Two of the three lines are false about HEAD's code: flows.md:523's "68" and architecture.md:672's "fewer at a dearer byte". The third, privacy.md:198's 1.5 ₳, is right at today's parameters. It is only incomplete, a nit on its own. No user of the store build sees any of the three. The fix is right, with three small corrections below.

## What HEAD does (scratch test, since deleted)

`seedelf-core/tests/zz_review_v_x_docs_1_impact_1.rs` measured `bootstrap_back_reserve` and `bootstrap_most` on HEAD, from the fixtures' parameters (preprod epoch 290 and mainnet epoch 658, both 4,310 lovelace a byte, `min_fee_a` 44):

| Price of a byte | Reserve | Cap: classic preprod / classic mainnet / LJTEST |
|---|---|---|
| 4,310 (today) | 1,500,000 | 96 / 96 / 64 |
| 5,000 | 1,500,000 | 96 / 96 / 64 |
| 5,400 | 1,500,000 | 96 / 96 / 64 |
| 5,700 | 1,600,000 | 96 / 96 / 64 |
| 6,000 | 1,700,000 | 96 / 96 / 64 |
| 6,465 | 1,800,000 | 96 / 96 / 64 |
| 8,620 | 2,500,000 | 96 / 96 / 64 |
| 12,930 | 4,000,000 | 96 / 96 / 64 |

At a `min_fee_a` of 44, 66 and 88, the reserve was 1.5, 1.5 and 1.8 ₳, and the cap stayed 96 / 64. The reserve first goes above 1.5 ₳ at about 5,700 lovelace a byte. `lovejoin_pools_test.rs:1808-1813` already asserts 96 and 64 at 6,465.

## Each line

- **flows.md:523: false.** It says "one deposit's most under today's fees (68 in the classic pool at 6,465 lovelace a byte, half as much again as today's)", but HEAD gives 96 at that price. The text came from 677715db (1.6.0's round 3c), when it was true. #333 edited this same bullet ("3 ₳ of reserves at today's prices") and left the "68" in place. The bullet's two other 1.5 ₳ figures, "1.5 ₳ for returning the rest" and "*For returning the rest* (1.5 ₳, …)", are right today but don't say the figure follows the parameters.
- **architecture.md:672: false, and it contradicts itself.** "one deposit's most under today's parameters, fewer at a dearer byte" stands against #333's own sentence later in the paragraph: "so a dearer byte doesn't lower the cap (1.8 ₳ at 6,465 lovelace a byte …)". The code comment at `lovejoin.ts:2942` is already right: "one deposit's most, at a dearer byte too".
- **privacy.md:198: true today, incomplete.** "1.5 ₳ for its way back" is exactly what HEAD funds at 4,310, and stays so up to about 5,690 lovelace a byte. "(one deposit's most under today's)" is also true. This line is a nit on its own. It's worth fixing in the same pass so that it matches #333's "at today's prices" convention.
- **The finding's scenario overstates one point.** It says no doc line gives the 1.8 ₳ way back, but architecture.md:672 (#333's sentence) and wasm/README.md:69 both give "1.8 ₳ at 6,465 lovelace a byte".

## Impact

- **Users of the store build see the right figures.**
  - The form counts `DEPOSIT_RESERVE + back`, where `back` is the worker's priced figure (`Lovejoin.tsx:3662`, `lovejoin.ts:2969`).
  - The review row shows `summary.bootstrapReserve` (`Lovejoin.tsx:3797-3798`), which `sessions.ts:2096,2142` fill from `lovejoinBootstrapReserve(params)`.
  - The en, es and ja strings carry no fixed figure (`lovejoin.collateralReserve.value`: "{{ada}} ₳, and what it doesn't use comes back"; `lovejoin.bootstrap.cantAfford` has no amount).
  - Neither the store's privacy policy nor its README mentions the way back.
- **Only readers of the repository's design docs are misled.** That means the owner, reviewers and the release-prep agent. The "68" and "fewer" statements are wrong exactly where someone would check #333's effect, at a dearer byte.
- **Severity: low** on the brief's scale (a misleading doc). There is no user path, so it isn't medium.

## The fix

The fix is right in substance, with three small corrections:

- **flows.md:523.** The proposed replacement would repeat "(96, or 64 in a token pool)", which the same bullet already says as "at most 96 boxes (64 in a token pool)". Its "(1.5 ₳ today, 1.8 ₳ …)" would also sit right after the unchanged "1.5 ₳ for returning the rest". Put the pricing in that earlier clause instead:
  - "and 1.5 ₳ for returning the rest, a sweep with no collateral;" becomes "and 1.5 ₳ at today's prices for returning the rest, a sweep with no collateral, priced from the parameters (1.8 ₳ at 6,465 lovelace a byte);"
  - "one deposit's most under today's fees (68 in the classic pool at 6,465 lovelace a byte, half as much again as today's)," becomes "one deposit's most, at a dearer byte too,"
  - "*For returning the rest* (1.5 ₳, and what it doesn't use comes back)" becomes "*For returning the rest* (1.5 ₳ at today's prices, and what it doesn't use comes back)"
- **architecture.md:672.** Dropping ", fewer at a dearer byte" is right and minimal. Alternatively, write `lovejoin.ts:2942`'s words: "one deposit's most, at a dearer byte too".
- **privacy.md:198.** "and at least 1.5 ₳ for its way back, priced from the parameters" is right as proposed. "(one deposit's most under today's)" may stay, since it's still true.
- **What the fix touches.** It is docs only.
  - No test reads these files: `words.test.ts` scans `extension/src` alone.
  - No key, critical value or translation changes.
  - No privacy-policy entry is needed, since no data handling changes.
  - No privacy note is dropped.
  - "today's prices" is the docs' existing idiom (#333's own words), not a release date (rule 7).
- **When to land it.** The release-prep docs commit fits. That commit also ticks item 4 at `post-release-roadmap.md:378`, which by agreement still states the bug as an open item ("68 classic boxes, and 51 of LJTEST, at 6,465 lovelace a byte"), as #333's body says.

Scratch files: the one Rust test above, deleted. No network was used.
