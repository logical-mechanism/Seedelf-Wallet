# Fixer `fx-last`: the last look at round 3b, fixed (the launch gate)

Findings LM-1 and LM-2 (`review/last-money.md`), LW-1, LW-2 and LW-4 (`review/last-words.md`). LW-3 is the owner's call and is untouched.

- **Worker:** `sessions.ts`: `priced()` (`left`), `lovejoinCost` (now a wrapper) and `lovejoinPriced` (new), `outBuild`, `stopCost`, `tailPaid` (new).
- **Screens:** `ui/swap.ts` (`followMax`), `Swaps.tsx` (the follow effect, `StopDialog`, a comment in `SwapApproval`), `PendingBanner.tsx`, `Lovejoin.tsx` (PoolPage's held figure).
- **Types:** `rpc.ts`, doc comments only.
- **No Rust, no WebAssembly change:** nothing waits for a rebuild.

## One rule for the collateral's mix (LM-1)

`tailPaid(network, boxes, left, ada, params?)` says whether a session's return pays for its collateral's mix where its funding set no reserve aside for it, as WebAssembly builds that mix:
- **With a box or more** (a chain): the chain's change pays. So it pays where `left`, what the spare ADA leaves once the boxes are paid for (`spare − besides − boxes × perBox`, `priced()`'s own figures), holds `lovejoinCollateralReserve()`. That's the same boxes counted as with the reserve set aside (`tail_reserve`).
- **With no box:** the return comes back directly, and its ADA alone (`ada`) pays (`direct_tail`). So it pays where that holds `lovejoinDirectCollateralReserve(params)`.
- **A failed parameters read** says no.

**Who uses it:**
- **`stopCost`'s `collateralMix`:** a box or more and the reserve paid (set aside first, as now), or `tailPaid`. With no box, `ada` is every UTxO of ADA alone, the reserve's too (or the funding, before the fill, as the boxes are priced). It reads `epoch_params` only there, with no box and the collateral going into the pool.
- **`outBuild`'s `collateralPool`:** a 5 ₳ pool takes the collateral (`asked(lovejoin)`, as before), and the reserve was paid, or `tailPaid` on the fill as the review expects it. That's `proceeds + deposits + SWAP_MARGIN` and the boxes `lovejoinCost` counts on it, which `lovejoinPriced` now returns beside the cost. A token's boxes count as "a box", since they make a chain, and take none of that ADA, since they're funded beside it.
- **Unchanged:** the site paths (`siteOutBuild`, `topUpBuild`) and the approval's own rule, `collateralReserve || (collateralPool && adaOut)`.

## Findings

| id | status | change |
|---|---|---|
| LM-1 | fixed | `stopCost` flags `collateralMix`, and `outBuild` sets `collateralPool` on a funding without the reserve, only where the return pays for that mix (`tailPaid`, above). No new words, no refusal. L1's test now asserts the unreserved case against what `backBuild` builds. |
| LM-2 | fixed | `followMax` never follows down to nothing (`BigInt(max) > 0n`). The amount Max set stays, and the worker funds it without the reserve, as one typed past Max. The follow effect's `"0" → ""` branch, now unreachable, is gone. No new words. |
| LW-1 | fixed | **With no box** (so no switch, and Stop isn't direct) where `collateralMix` holds, Stop's note is a new `*Mixed` variant of each direct note: "…everything but its 5 ₳ collateral comes back to your private balance, less network fees; the 5 ₳ comes back later, mixed once."<br>**The giveme.my line** is Stop's own key, without the approval's "too", which points at GivemeNote there: `swaps.stop.privacy.collateralMix`. |
| LW-2 | fixed | Home's banner counts a mix's or a Bootstrap's boxes as 2 while balances are hidden (`useAmounts().hidden`), as every count of boxes is. A hidden case is added to screens-nits' banner tests. |
| LW-4 | fixed | **The figure beside the stepper** (`shownSide`) is the chain's pick for `most \|\| 1`: what the stepper offers, one box where none fits. The cantAfford line's figure uses it too.<br>**The cap still goes count by count** (`mixOffer`, unchanged).<br>**The Bootstrap form** keeps its own count. |
| LW-3 | owner-call | Not changed (the task says so). Measured by last-words: a band about 0.3 ₳ wide. |

## Tests, fail-before, and mutation checks

**How they ran:**
- Each test was written first and run on today's code. It failed on behaviour, never on a missing export. The logs are `fx-last-*-failbefore.log` in the scratchpad.
- Each fix hunk was then undone with Edit, the tests run, and the hunk put back with Edit. The logs are `fx-last-*-mutation*.log`.
- Afterwards a grep found every fix hunk in place.

**LM-2:**

| test | fail-before | mutation → failure |
|---|---|---|
| `collateral-reserve-review-fixes` › last look › "keeps the amount Max set where the quote's reserve takes Max to nothing, and funds it without the reserve (LM-2)": real worker and WebAssembly. 14 ₳ held: Max 1 ₳ before the quote, the quote's maybe-reserve, Max then 0. The 1 ₳ is funded without the reserve. | `expected '0' to be undefined` | guard removed → same |
| `screens-wiring-review-fixes` › R3-12 › "never empties the amount where the quote's reserve takes Max to nothing: it stays, and goes without it (the last look, LM-2)" | `expected '' to be '1'` | guard removed → `expected '0' to be '1'` |

**LW-2:**

| test | fail-before | mutation → failure |
|---|---|---|
| `screens-nits-review-fixes` › "Home's banner for one box of Lovejoin's…" › "says them while balances are hidden, one box or more, as every count of boxes is said then" | `expected 'In Lovejoin, on its way to your priva…' to contain 'In Lovejoin, on their way to your pri…'` | `hidden` not read → same |

**LW-4:**

| test | fail-before | mutation → failure |
|---|---|---|
| `screens-wiring-review-fixes` › "from the public account…" › "in a token pool, shows what a mix of the most boxes the stepper offers can spend, whatever the count stands at (the last look, LW-4)". PoolPage is rendered on a token pool, from R3-14's "richer" account; the stepper offers 3. | `Received: "What Lovejoin can spend from your public account 6.24061 ₳ · 300 LJTEST (…)"` (expected 17.4 ₳) | figure at `boxes` → same |

**LW-1** (`approvals-review-fixes` › "1.6.0's review of the fixes, the last look: Stop's dialog says where its 5 ₳ goes where it's mixed (LW-1)"):

| test | fail-before | mutation → failure |
|---|---|---|
| "with no box, never says everything comes back for one fee: all but its 5 ₳, which comes back later, mixed": not placed, the pools' swap, cancelled, and the pool short | `If no order has gone out yet, none will, and : expected 'Stop this swap? If no order has gone …' to contain 'If no order has gone out yet, none wi…'` | A, the notes back to `*Direct` → same |
| "says giveme.my backs that mix in its own words, without the approval's \"too\"" | `expected 'Stop this swap? If no order has gone …' to contain 'giveme.my backs its collateral\'s mix…'` | B, the line back to the review's key → same |
| "is as before where the collateral isn't mixed, or Stop brings it back directly" | a guard: passes before and after | — |
| L1's "Stop's dialog says the collateral is mixed…" (fx-reserve-1's), its expected line moved to the new words | `expected 'Stop this swap? Bring it back through…' to contain 'giveme.my backs its collateral\'s mix…'` | B → same |

**LM-1** (`collateral-reserve-review-fixes`, real WebAssembly, preprod's 5 ₳ pool with two strangers' boxes, the classic pool one wave deep: `perBox` and `besides` from `funding(1)` and `funding(2)`):

| test | fail-before | mutation → failure |
|---|---|---|
| last look › "says Stop's collateral is mixed, with a box, only where what its boxes leave pays for that mix, as the chain WebAssembly builds has it (LM-1)" | `1000000 left: expected true to be false` | A, `mixed = intoPool` → same<br>C, box branch always true → same<br>E, the reserve-paid clause dropped → `expected { boxes: 1, mixes: 1, …(5) } to match object { boxes: 1, collateralMix: true }` |
| last look › "says Stop's collateral is mixed, with no box, only where the session's ADA alone pays for that mix coming back directly, its reserve paid or not (LM-1)" | `reserved, 2000000: expected true to be false` | A → same<br>D, no-box branch ignores the ADA → same |
| last look › "says an ADA-out swap funded without the reserve mixes its collateral only where its fill, less the boxes it pays for, pays for that mix (LM-1)" | `expected true to be undefined` | B, outBuild's flag back to `asked(lovejoin)` → same<br>C → same |
| R3-9's "keeps on a funding without the reserve…" (fx-reserve-1's): its ADA→MIN case, funded without the reserve, now carries no `collateralPool` | `expected true to be undefined` | B → same<br>D → same |
| L1's "prices Stop's boxes on what's left…" (fx-reserve-1's): unreserved, asserted against `backBuild` | `expected true to be undefined` | A → same<br>C → same |

**What the LM-1 tests also prove against WebAssembly** (`backBuild`, the chain it really builds), at each point the rule draws:
- **One box:** 1 ₳ left, no collateral tail; 1.5 ₳ left, a tail.
- **Two boxes:** 2 ₳ left, a tail; L1's 0.5 ₳ left, none.
- **Reserved, one box:** 0.5 ₳ left beside the reserve, a tail.
- **No box:** 2 ₳ of ADA alone, no tail, reserved or not; 3 ₳, a tail.

So the rule never flags a mix the chain doesn't build at those points.

**What the ADA-out test sets up:** 500 MIN sold, the private balance short of the reserve. It's asserted funded without it, at three fills:
- 1 ₳ left after one box: not flagged;
- 1.5 ₳ left: flagged;
- no box (a 1 ₳ fill, 5 ₳ spare with the deposit and the room): flagged.

## Files touched

- **Worker:** `extension/src/background/sessions.ts`:
  - `priced()`: `at(w).left` and a top-level `left` at the width `price` goes at;
  - `lovejoinCost`, now a wrapper over the new `lovejoinPriced`, which also returns `spare` and `left`;
  - `outBuild`: `expected`, and `mixes` for `collateralPool`;
  - `stopCost`: `intoPool`, `counted`, `cost`, `mixed`;
  - `tailPaid` (new, beside `tailReserve`).
- **Types:** `extension/src/shared/rpc.ts`: the doc comments of `SwapLovejoin.collateralMix` and `SessionOutSummary.collateralPool`.
- **Screens:**
  - `extension/src/ui/swap.ts`: `followMax` and its doc;
  - `extension/src/ui/screens/Swaps.tsx`: NewSwap's follow effect; `StopDialog`'s `mixedBack`, its notes and its line's key; `SwapApproval`'s `collateralMixed` comment;
  - `extension/src/ui/components/PendingBanner.tsx`: `useAmounts`, the count;
  - `extension/src/ui/screens/Lovejoin.tsx`: PoolPage's `shownSide`, used by `HeldOnSide` and `cantAffordPublic`, and the comment above `side`.
- **Strings:**
  - `extension/src/i18n/translations/{en,es,ja}.json`: four keys added, each a single inserted line in sorted place;
  - `docs/i18n/{es,ja}-provenance.json`: those four, `machine`, single inserted lines.
- **Tests:**
  - `extension/tests/collateral-reserve-review-fixes.test.ts`:
    - the `SWAP_MARGIN` import;
    - R3-9's ADA→MIN assertion and L1's unreserved assertion updated;
    - one describe with 4 tests (LM-1 ×3, LM-2).
  - `extension/tests/approvals-review-fixes.test.ts`: L1's expected line updated, and one describe with 3 tests (LW-1).
  - `extension/tests/screens-nits-review-fixes.test.ts`: `html()` and `banner()` take a hidden flag, and one test (LW-2).
  - `extension/tests/screens-wiring-review-fixes.test.ts`:
    - `form()` and `maxThenQuote()` take a balance;
    - two tests (LM-2, LW-4).

## Keys

- **Critical key added:** `swaps.stop.privacy.collateralMix`.
  - en: "giveme.my backs its collateral's mix, so it sees that mix. If that mix can't go, its 5 ₳ box waits unmixed, tied to this session."
  - es: "giveme.my respalda la mezcla de su colateral, así que giveme.my ve esa mezcla. Si esa mezcla no puede hacerse, su caja de 5 ₳ espera sin mezclar, vinculada con esta sesión."
  - ja: "コラテラルのミックスは giveme.my が支えるため、giveme.my はそのミックスを見ます。そのミックスができない場合、5 ₳ のボックスはミックスされないまま、このセッションと結び付いた状態で待ちます。"
  - It's `swaps.review.privacy.collateralMix` less "too" (también, も→は). It needs the lead's `--write` and round 4's blind back-translation.
- **Other keys added** (es and ja provenance `machine`): `swaps.stop.notPlacedMixed`, `swaps.stop.notSwappedMixed`, `swaps.stop.cancelledMixed`.
  - Each is its `*Direct` sibling with "everything but its 5 ₳ collateral comes back to your private balance, less network fees; the 5 ₳ comes back later, mixed once." in place of the direct ending.
  - es: "todo menos su colateral de 5 ₳ vuelve a tu saldo privado, descontadas las comisiones de red; esos 5 ₳ vuelven más tarde, mezclados una vez".
  - ja: "5 ₳ のコラテラル以外はネットワーク手数料を除いてすべてプライベート残高へ戻ります。その 5 ₳ は 1 回ミックスされてから、あとで戻ります。"
  - The wording follows `lovejoin.review.privateNoteMixed`, the glossary's colateral/コラテラル and `swaps.review.noBoxMixed`.
  - Not named `.privacy.`, like their `*Direct` siblings and `noBoxMixed` (see the owner's calls).
- **No key changed.** `swaps.review.privacy.collateralMix` is unchanged, and still shown by the approval and Lovejoin's private review, where "too" follows GivemeNote.
- **No test or e2e read the replaced words** in their new places:
  - e2e's fakes put no box in the 5 ₳ pool, so no `collateralMix`;
  - e2e/extension.spec.ts:3101 asserts the one-box banner's "on its way", with balances shown, which still holds.

## Docs to update

1. **flows.md, Stop** (amends fx-reserve-1's docs item 3):
   - Stop's dialog says the collateral is mixed only where the return pays for that mix:
     - with a box, where the funding paid the reserve or what the boxes leave holds 1.5 ₳;
     - with no box, where the session's ADA alone holds what a return that comes back directly takes (2.8 ₳ at today's parameters).
   - With no box, it then says everything but the 5 ₳ collateral comes back, less network fees, and the 5 ₳ later, mixed once, rather than everything for the return's fee alone.
   - Its giveme.my line has no "too".
2. **flows.md, Review the swap** (amends fx-reserve-1's item 2):
   - An ADA-out swap funded without the reserve says its 5 ₳ is mixed only where its fill, as the review expects it (the proceeds, the deposit back and the 2 ₳ room), pays for that mix: with a box, where it leaves 1.5 ₳ after its boxes; with none, where it holds 2.8 ₳.
   - Elsewhere it says the 5 ₳ comes back with the rest.
3. **flows.md, You pay / Max** (amends fx-reserve-1's item 1): Max pressed before any quote follows Max down once the quote names the reserve, but never down to nothing. Where keeping the reserve aside leaves Max at nothing, the amount stays and is funded without the reserve.
4. **architecture.md, the collateral's mix** (with fx-reserve-1's item 5):
   - **`tailPaid`** is the one rule: with a box, `priced()`'s `left` (the spare less the chain's besides and the boxes) ≥ `lovejoinCollateralReserve()`; with none, the ADA alone ≥ `lovejoinDirectCollateralReserve(params)`.
   - **`stopCost`'s `collateralMix`:** the reserve paid with a box, or `tailPaid`.
   - **`outBuild`'s `collateralPool`** on a funding without the reserve follows `tailPaid` on the fill `lovejoinPriced` returns.
   - **The site paths** still set it wherever a pool takes the collateral.
   - **Stop's dialog** reads `epoch_params` (no address in it) only with no box and the collateral going into the pool.
5. **privacy.md:217** (with fx-reserve-1's item 6): Stop's dialog, and a swap's approval for an ADA fill without the reserve, say the collateral is mixed only where the return pays for that mix.
6. **flows.md, the Mix form, public side in a token pool** (amends fx-reserve-2's item 2): the held figure beside the stepper is the chain's pick for the most boxes the stepper offers (one where none fits), not the count's. The stepper's cap still goes count by count. The Bootstrap form's figure is at its own count.
7. **Home's banner for a Lovejoin mix or Bootstrap** (wherever fx-misc's banner-count item lands): with balances hidden it says "them" for one box as for more.
8. **The owner's list of calls:**
   - fx-reserve-2's call 7 ("R3-14's held figure follows the count") now holds for the Bootstrap form only;
   - fx-reserve-1's call 2 (mixed words without a cost row) now applies only where the fill pays.
9. **The privacy policy: no change.** Nothing new about the user leaves the device. The one new read is `epoch_params`, the network's parameters, which every wallet reads, and only in Stop's dialog's no-box case. The docs lane decides.

## Calls the owner might overturn

1. **LM-1's thresholds are on the safe side of WebAssembly's.**
   - The chain's change also holds what the deposit's reserve leaves, and a direct tail measures about 2.66 ₳ where its reserve says 2.8 ₳.
   - So between the points the tests pin (about 1.0–1.5 ₳ left after the boxes; 2.66–2.8 ₳ with none), the return may mix the collateral while the dialog or approval doesn't say so. Its fees then come out of what comes back, unnamed.
   - It never says a mix the chain doesn't build.
2. **A parameters read that fails in Stop's dialog** (no box, collateral into the pool) says nothing mixed: nothing promises a mix it can't price. fx-reserve-1's call 7 discloses on a failed pool read instead.
3. **An ADA-to-token swap funded without the reserve no longer carries `collateralPool`.** Its fill is the token beside the margin's 2 ₳, short of the direct tail's 2.8 ₳; with a token's boxes, the chain's change is the margin less the chain's besides. Nothing shown changes: the approval's ADA-out rule already kept its words plain. R3-9's test was updated to say so.
4. **A token-out chain** (the token's boxes, no ADA box) is priced as "a box" on the ADA spare alone, so without the reserve it's never flagged. That's conservative, and invisible for the same reason.
5. **LW-1's notes aren't named `.privacy.`.** Their `*Direct` siblings and the approval's `noBoxMixed` aren't either; the giveme.my line, which says what giveme.my sees, is. They say "less network fees" rather than naming each fee: the return's, the collateral's deposit and mix, and a cancel's.
6. **LW-1, the pool-short line** ("…, so it would come back directly, tied to this session on chain") still follows the mixed note unchanged: its "it" is the swap's ADA.
7. **LW-4 uses `most || 1`, not `Math.max(boxes, most)`.** They agree once `boxesShown` clamps the count; this one doesn't follow a count left above the cap for a render (another side chosen).
8. **LM-2: while the amount Max set stays above a Max of nothing, Max's button is off** and no note says why: the Max note needs `max !== "0"`. That's no new words, as the finding asked.
9. **Provenance under `WW/docs/i18n/`.** The task said not to touch the docs, but `i18n.test.ts` fails on any es/ja key without a provenance entry, and the brief's Strings rule gives that entry to whoever adds the key. No docs fixer's list (DOCS-TODO.md) touches these two files. So they got four single anchored lines each, nothing else under `WW/docs/` was edited, and the lead can move them if that was meant.
10. **LW-3** is left to the owner, as the task says.

## Notes for the lead

- **No test needs the pkg rebuilt.**
- **The critical-set gate** (`i18n.test.ts`) differs from the checked-in list by exactly my `swaps.stop.privacy.collateralMix`, by `node scripts/i18n-critical.mjs` (print only). It needs `--write`. The es/ja unchecked-draft checks are L5's, mine now among them.
- **The 1.5.0 gate** (`tests/lovejoin-1-5-0.test.ts`) passes unedited on both builds. Its Stop has no box in its 5 ₳ pool, so `intoPool` is false and no `epoch_params` read is added.
- **Visual checks:**
  - on preprod, the 5 ₳ pool with two strangers' boxes, a swap session whose account holds ≥ 2.8 ₳ of spare ADA but less than a box: Stop's dialog says "…everything but its 5 ₳ collateral comes back…; the 5 ₳ comes back later, mixed once." and the giveme.my line without "too";
  - the public Mix form in a token pool: the held figure stays put as + is pressed.
- **Shared files:** every locale, provenance and `rpc.ts` edit is an anchored single-line insertion or a doc-comment edit. The docs fixers' changes under `WW/docs/`, `seedelf-platform/CLAUDE.md`, `seedelf-data/README.md` and `extension/README.md` are theirs, not mine.

## Checks

- **`npm run typecheck`:** clean (exit 0), run last.
- **The wide set, default build:** 139 files (session\*, lovejoin\*, swap\*, collateral\*, parts\*, return\*, site\*, chain\*, withdraw\*, pending\*, coin-control\*, approvals\*, dapp\*, run\*, spent\*, screens\*, home\*, settings\*, activity\*, privacy\*, words, i18n\*, direct-swaps, pool-swap\*, minswap\*, maybe-sent, mempool\*, date-locale, format, import-boundaries, ui-safety). 1855 passed, 2 skipped, 3 failed: `i18n.test.ts`'s critical-set gates, as above.
- **The same set on preprod** (`VITE_ENABLE_MAINNET=false`), without the i18n files: 131 files, 1695 passed, 2 skipped.
- **The baseline** before any edit: the four files I'd touch, 68 of 68.
- **Mutations:** LM-2 (1), LW-2 (1), LW-4 (1), LW-1 (2), LM-1 (5), each put back with Edit. A grep confirms every fix hunk.
- **Scratch files** are `fx-last-*` in the scratchpad:
  - the baseline, fail-before, pass and mutation logs;
  - the wide runs' logs and file lists;
  - the critical-set print;
  - both typecheck logs.
