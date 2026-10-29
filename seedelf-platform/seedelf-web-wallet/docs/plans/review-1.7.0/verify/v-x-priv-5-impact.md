# v-x-priv-5-impact: x-priv#5 (privacy.md and flows.md trail #337's way out and #333's priced reserve)

**Verdict:** confirmed. **Severity:** low, as filed. This is a docs-only defect. Nothing in the shipped build is wrong, and nothing a user sees is wrong. **Confidence:** high.

## What is real on HEAD (6bca8bec)

### 1. flows.md:523 is false about a figure #333 changed

flows.md:523 says:

> one deposit's most under today's fees (68 in the classic pool at 6,465 lovelace a byte, half as much again as today's)

#333 made that figure stale, and #333 touched this very line: it added "at today's prices" to the "3 ₳ of reserves" clause and left the 68 in place.

HEAD's shipped WebAssembly (`wasm/pkg`) gives the classic pool's private Bootstrap a cap of **96** at 6,465 lovelace a byte, on both networks. The way back's reserve there is 1.8 ₳. The checks:

- **Scratch Vitest, deleted:** `lovejoinBootstrapMost({network, params, most: 96})` and `lovejoinBootstrapReserve`.
  - preprod and mainnet at 4,310: cap 96, reserve 1500000.
  - preprod and mainnet at 6,465: cap 96, reserve 1800000.
- **Core's own test:** `a_private_bootstrap_is_held_to_what_its_funding_pays_its_deposit_and_way_back_for` passes with "at a dearer byte: the way back's reserve is 1800000". It asserts `bootstrap_most(&dear, &classic, true, 96) == 96` and LJTEST's 64.
- **architecture.md:672 (#333's own text):** "where a fixed 1.5 ₳ held it to 68 classic boxes". That puts 68 in the past.

### 2. privacy.md:217 doesn't mention #337's way out

The sentence ends the collateral mix's wait only on its own clock:

> past that, or a day after the deposit landed, the box waits not mixed yet, tied to the session as any deposit's box is, and Mix my boxes again takes it first.

#337 adds a way to end the wait sooner, on the user's word:

- `skipCollateralMix` (sessions.ts:5525-5537) calls the same `tailOver` that the day's end calls (lovejoin.ts:4014, through `tailOf`/`tailBuildable`).
- It does so from `offerAt = c.tail.landed + TAIL_OFFER_MS` (lovejoin.ts:4127-4133), which is an hour after the deposit landed. That is the same clock the day runs on.
- The outcome is the same as the day's end. The box waits unmixed and tied to the session. `tailBoxes` (lovejoin.ts:1349) stops reserving it, so Bring every box back now takes it after that.

#337 updated flows.md:522 and architecture.md:633, but not privacy.md. privacy.md:226 has the same gap: "It leaves a session's 5 ₳ collateral's box to that collateral's mix, a day at most…".

### 3. privacy.md:198 and flows.md:523 state the reserve as a flat 1.5 ₳

They say "1.5 ₳ for its way back", "1.5 ₳ for returning the rest" and "*For returning the rest* (1.5 ₳…)". That figure is right at today's parameters, but since #333 it is only a floor. On its own this part is a nit.

### Also stale, and not in the finding

architecture.md:672 still says the cap is "one deposit's most under today's parameters, fewer at a dearer byte". The same paragraph now also says "so a dearer byte doesn't lower the cap". On HEAD the classic cap stays at 96 everywhere the WebAssembly accepts:

| Price of a byte | Classic cap | Reserve |
|---|---|---|
| 8,620 | 96 | 2.5 ₳ |
| 12,930 | 96 | 4.0 ₳ |
| 20,000 | 96 | 6.4 ₳ |

Above 20,000 the parameters are refused as implausible ("at most 20000 is expected"). So "fewer at a dearer byte" no longer holds for the classic pool.

## Impact

- **No user harm.** The review row shows the computed reserve: Lovejoin.tsx:3797-3798 `formatAda(summary.bootstrapReserve)`, priced in sessions.ts:2096. The form and the funding take the priced figure (`privateBootstrapBounds`, lovejoin.ts:2966-2969).
- **The new choice is disclosed where it's made.** #337's button sits under the privacy callout `lj.tail.privacy.wayOut` (CollateralHeldWayOut, LovejoinReturn.tsx). That callout says the 5 ₳ box stays unmixed and tied to the session.
- **The store's privacy policy already covers the outcome.** privacy-policy.md:28 says: "If the mix can't go, the box waits there, and can be tied to the session until it's mixed". That has no time in it, so no new *Changes* entry is needed, as #337 said.
- **Who is misled:**
  - The flows.md 68 misleads only about a parameter change that hasn't happened. At today's 4,310 every figure flows.md gives is right.
  - The privacy.md gap misleads a reader of the design doc about whether the wait has a way out. That is the very gap 323-worker#3 closed.
- **Reachability:** #337's offer only exists where a session's collateral mix runs. That is preprod (no floor), and mainnet once a 5 ₳ pool holds 30 boxes that aren't the wallet's. #337 itself says it stays dormant on mainnet until then. For a docs finding this doesn't change the verdict.
- **Severity:** a misleading doc is **low** on the brief's scale. It isn't medium, because no money or privacy statement *the wallet shows* is wrong.

## The fix: right in substance, with refinements

The fix is docs only. No guard, no refusal, no UI text, and every privacy note stays. "1.7.0" is a version label, as privacy.md:200 already uses, not a release date. No test reads these docs' text: words.test.ts checks only the name, and the proposed text has no lowercase "seedelf". It can go in the release-prep docs commit that already ticks post-release-roadmap.md:378. That item's "68 classic boxes … at 6,465" is the bug's history and is right as history.

**1. privacy.md:217: don't put the way out inside the "Where it was built but can't go" clause.** #337 offers it while the first build's mix simply waits for giveme.my (`tailWaits`), not only after a rebuild (`tailBuildable`). A separate sentence after "…and Mix my boxes again takes it first." fits better:

> From an hour after the deposit landed, while that mix still waits (for giveme.my, or to be built again), the session's page offers *Bring the rest back now*, its line saying first what follows: the wait ends as the day's end ends it, the box left not mixed yet, tied to the session (the owner, 2026-10-28; 1.6.0's release review, 323-worker#3; 1.7.0).

Optionally, privacy.md:226: "a day at most" becomes "a day at most, or until its session's rest is brought back without it".

**2. privacy.md:198.** Write "priced from the network's parameters", not "…fees", to match privacy.md:217's wording for `direct_tail_reserve`. The cost is mostly the price of a byte. For example:

> and, for its way back, `bootstrap_back_reserve`, priced from the network's parameters, never less than 1.5 ₳ (1.5 ₳ today, 1.8 ₳ at 6,465 lovelace a byte; 1.7.0)

**3. flows.md:523: keep the figure to the classic pool, as the line has it now.** Drop the finding's general "64 in a token pool" at 6,465. Core proves 64 at that price only for LJTEST, and a token pool whose box ADA falls under a dearer byte's minimum takes none (`belowMinimum`). For example:

> one deposit's most, at a dearer byte too, since the way back's reserve follows the parameters (96 in the classic pool at 6,465 lovelace a byte, half as much again as today's, the reserve 1.8 ₳ there; 1.7.0)

Also change "1.5 ₳ for returning the rest" to "at least 1.5 ₳ for returning the rest, priced from the parameters", and "*For returning the rest* (1.5 ₳, …)" to "(its priced figure, 1.5 ₳ today, …)".

**4. architecture.md:672, in the same pass.** Change "one deposit's most under today's parameters, fewer at a dearer byte" to "one deposit's most, at a dearer byte too", so the paragraph stops contradicting itself.

**What else it changes:** nothing in code, tests, i18n or the critical set.

## Scratch files

- `extension/tests/zz-review-v-x-priv-5-impact-1.test.ts`: the cap and reserve at 4,310 and 6,465 on both networks.
- `extension/tests/zz-review-v-x-priv-5-impact-2.test.ts`: the classic cap at 8,620, 12,930, 20,000 and 21,550.

Both have been run and deleted. No tracked file was touched.
