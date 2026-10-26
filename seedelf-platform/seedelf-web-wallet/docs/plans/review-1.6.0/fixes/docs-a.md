# docs-a: the docs round, design docs and the docs the wallet serves

Every item in `review/DOCS-TODO.md` that falls in my files, and the doc points in `review/QUESTIONS.md`, checked against the code before it was written. The code is 3ea05dc1's. fx-last was editing `sessions.ts` (the quote, `outBuild`, `stopCost`), `Swaps.tsx`, `swap.ts`, `PendingBanner.tsx`, `Lovejoin.tsx`'s `PoolPage`, `rpc.ts` and the locales meanwhile. For those, I read 3ea05dc1 (`git diff 3ea05dc1`) and described that, leaving fx-last's items alone (see *Left for later*). Docs only: no test, no build, no cargo, no formatter.

## The privacy policy (served live)

Two edits, both in the unshipped 1.6.0 material. The **Effective** date and the header's "updated for …" list are untouched (the owner's open call).

- **The 18 October entry.** "A session funded while such a pool is shown pays a little more for that mix" was false once fix round 1 added the fallback (323-worker#0, `orWithoutReserve`). It now says the session pays that "where its private balance pays for that too", and that one funded without it "has its collateral mixed only if enough is left when it comes back".
- **The Lovejoin row.** The collateral goes into a 5 ₳ pool "where there is one and the session holds enough to pay for the mix". The fallback made "where there is one" false.

**What any server learns: each fix round's changes checked.** No line is added where nothing new is learned, and no party newly learns anything.

| Change | New request or party? | Verdict |
|---|---|---|
| wss-2, restore scan (x-scenarios-sessions#0): `utxo_info` of the first wallet-contract input of each other payment into a one-time account, sent with the orders' outputs | A new ask to the same server, about inputs it has just listed in `tx_info`. It's asked of every such payment, strangers' too (`sessions.ts` `recoveredRecords`: `unsigned.slice(0, -1)`, filtered by contract input). The register check runs on the device (`ownedUtxos`). | The server can predict every ask from what it served, so it learns nothing new: **no line**. privacy.md and keys-and-accounts.md say so. Owner's call below. |
| w-left: Stop's `recheck`, one pool read 2 h after Stop | The same pool read every wallet makes | No line |
| wlj-1 `depositors`; wlj-4 `launches.box`/`reviewed`; w-left `counted`/`recheck`; fx-lj-2 `bringStopped`; wlj-2 `landed`/`waiting`/`late` | On the device, sealed | Covered by the existing words ("each mix … until their boxes are back, the pools you started, a box being brought back until it's settled"). No line. |
| 318-worker#3 (one `epoch_params` per review) | Fewer requests of a kind every wallet makes | No line |
| fx-misc "Pay it again anyway" | Set collateral's own payment, by choice | No line |
| sc-o-1/fx-reserve-1 quote reserve (`collateralPoolTakes`), sc-lj-1 `utxos` read, sc-o-2 page reads | Ask nobody beyond the worker | No line |
| 317-wallet#0 reference input on token deposits | On chain, naming the pool the deposit's output already names | No line |

## What I changed

**flows.md**
- Remove wallet's list: a payment still being sent in parts (gap-1#1).
- Public activity: **Paid for a box back from Lovejoin**, and that box isn't listed as pending (318-worker#2).
- Collateral:
  - "waiting" lasts while the payment can still land, 10 minutes after a lock (309#1); recorded on the reviewed account (309#2);
  - the page opened again from Home's row leaves the question to Home's watch (309#0);
  - **Pay it again anyway** after 10 minutes (fx-misc).
- Switching: what holds it; a private session's chain never does (gap-1#0).
- Make private's *Watching*: Home lets go of an ordinary payment another page saw land (309#0's hardening).
- Send privately's Max: what it left and why (`leftWhy`). Also each later part checked at the first's Send (321-parts-worker#3).
- *Parts that wait*:
  - a return reviewed before the payment's Send is refused at its own Send, chain or direct, Bring it back and Bring everything back alike (321-parts-worker#3, R3-4);
  - the countdown and Remove wallet say so (gap-3#6, gap-1#1);
  - Send again sends only the first (321-parts-worker#1).
- Home's banner for parts: holds after a lock (321-parts-worker#0).
- Make public's Max: why it left.
- The swap:
  - Max: FEE_ROOM 2 ₳; the reserve by `collateralPoolTakes`, yes, no or maybe; `tailUnpaid`; Max followed down (323-worker#0, R3-10, R3-11, R3-12);
  - the review's collateral words and cost row (323-worker#1, #6, x-privacy#1, R3-9, R3-10);
  - Start swap "Building…";
  - the width note only where something goes through (319-worker#0);
  - the funding's reserve and its fallback;
  - Stop's pricing and its giveme.my line (L1);
  - the retry's privacy line and its live region (322#0, 322#1).
- A site's session: the direct reserve (2.8 ₳ today), its mix row and note (323-rust#1, 323-worker#0, #1, #6, R3-9). Top up likewise. Bring it back's "Building…".
- Lovejoin:
  - Your mixes: one-box Bootstrap words (x-i18n-es#2), and a return's collateral-only entry (316#3);
  - the hub's started line after 30 minutes (320-screens#0);
  - the Mix form, private: the reserve in the figures only where that many boxes leave room for it, the collateral-if-left line, stepper room 5 ₳ + 2 ₳ (sc-lj-1, R3-7, 323-worker#0);
  - the Mix form, public: what a mix can spend, the token pool pick, the labels (321-lj-screens#1, R3-14, R3-26, R3-27);
  - the private funding's reserve, fallback, and giveme.my note (x-privacy#1, 323-worker#6);
  - Mix my boxes again's switch and Start mix (320-screens#4, #3);
  - the collateral's mix: the reserve sizes, the fallback, the cost rows, the waits' words, the listing grace, withdraws meanwhile (323-rust#1, 323-worker#0, #2, #5, x-scenarios-lj#1);
  - Bootstrap: one payment with both reserves, the cap built from the deposit and the sweep, *For returning the rest*, the hint, the shortfall, Home's banner words (318-rust#0, R3-21, 318-worker#0);
  - the escape hatch: the hatch's order, the payer order, the named notes (R3-3, x-privacy#0, R3-2, R3-23);
  - Bring every box back now:
    - the collateral's box left to its mix, a lock-cut mix's too;
    - the landing wait, the wait words, Stop through waits, Stopped not Done, late;
    - a dropped withdraw counted once, and the recheck after Stop;
    - "Nothing of yours was left in that pool.", and `privatePayNone`'s words;
  - Start a pool: the amount fields, the same-values warning, the sent-already answer, one parameters read (320-screens#1, 318-worker#1, #3);
  - a return's tokens a UTxO the evaluator can't take (rr-1's note on 319-rust#0).

**architecture.md**
- `isTrap`'s RangeError (314-wasm#0); a new bullet on traps no catch swallows (314-wasm#0, L3); the runs' trap line.
- Max on private Send: `leftWhy`, Max over nothing; `max_in_parts`' reasons.
- Parts: the worker's `laterParts` and `pumpHolds`; the pump's `Sending.parts`, `nameParts`, `holdWaiting`, `"locked"`.
- `refuseParts` in *a chain kept for Send* (321-parts-worker#3, R3-4).
- Spent marks on the services' clock (L4).
- The collateral's `WAIT_MS`, `heldSent`, `late`, account (309#1, #2).
- Storage:
  - `lovejoin.<network>` gains `launches` (`box`, `reviewed`), `depositors`, `landed`, `bringing.waiting`/`late`, `counted`, `recheck` and `bringStopped`;
  - the `seedelf.waiting` row;
  - Remove wallet's parts line;
  - the countdown's `parts-waiting`.
- `TxBanner`/`PendingBanner`: `bootstrap`, `boxes`.
- The restore scan's `recovered.own` (x-scenarios-sessions#0); what one return takes; *Out*'s Bootstrap cap.
- The collateral's mix bullet, rewritten from the reserve, wlj-3, wlj-2, fx-reserve-1/-2 and fx-lj-1/-2 reports:
  - the tail's reference input (317-wallet#0) and `mix.noCollateral` (323-worker#4);
  - the waits, the grace, `chain.from`;
  - `tailWaits`, `mixing`, `tailBoxes`, `mayLand`;
  - both reserves, `orWithoutReserve` with TooMany/TooLarge, `tailUnpaid`, `collateralPool` against `collateralReserve`;
  - `tailReserveOf`, `collateralPoolTakes`, `maxAdaIn`/FEE_ROOM/`adaShort`, `COLLATERAL_MIX_COST`, `stopCost`.
- `minswap-build-failed`'s privacy line and live region.
- Bootstrapping:
  - `lovejoinBootstrapMost` builds the deposit and the sweep;
  - token-pool reference reads;
  - `BOOTSTRAP_BACK_RESERVE` through `lovejoinBootstrapReserve`, in `mixFunding`, never `funding_for`;
  - `mix.noCollateral`; records funded between 62162483 and the fix;
  - `holderOf`, `squareUp`, landed stand-ins, `holdable`.
- Token pools' records: `chainSent`'s entry (316#3), `depositors` (316#1), the 1.5.0 gate (x-compat#2, R3-17, R3-18, record guard).
- `owner_context`'s path (`lovejoin/mod.rs`).
- Withdraws: `mixing`/`chainsMixing` against `chainsSending`, `mayLand`/`landed`/`landedDeposit`, `BRING_LATE_MS`, `tailBoxes`, `bringStopped`. A withdraw written ahead gains `bring`/`counted`/`recheck`.
- Which pools are shown:
  - the datum-depth rule (314-wasm#0);
  - `refresh`'s same-transaction guard;
  - the ledger judges a pool on chain (317-wallet#0);
  - the vectors' `scriptRowDatums`.
- What it builds:
  - `with_staking` (314-core#2), the launch's single derive and measure (314-core#0), no reference-script UTxO (318-rust#1);
  - `deposit_across`;
  - zero legs (319-rust#0), `evaluable`/`withinDepth`/`collateralWanted`, `MORE_THAN_THERE_IS` (314-core#1).
- The escape hatch's payer order and `hatchOrder`/`hatchAccountOf`.
- Costs: the recheck read; one parameters read.

**privacy.md**
- Bootstrap (198): the hold's crediting (316#0); the funding with both reserves and the built cap (318-rust#0). The stale "53 … 35 to 40" and "fixed 1.5 ₳" are gone.
- Starting a pool: the record's values and the same-values warning (318-worker#1).
- The escape hatch (207–210):
  - the hatch's order (R3-3);
  - the private payer's order (x-privacy#0, R3-2);
  - Bring every box back now's no-payer words (321-lj-screens#5);
  - the named notes (R3-23);
  - the deposit's tie kept by `depositors` (316#1);
  - **316#1's case (a) corrected**: a 1.5.0 public seed's box whose record went before the update names no account in its history, though on chain it ties it (complete-a's L6);
  - the named questions (x-privacy#0).
- The collateral's mix (217):
  - both reserves and the fallback;
  - which reviews say giveme.my backs it, and the words without the reserve (x-privacy#1, R3-9, R3-10, L1);
  - the 15-minute listing grace (323-worker#5);
  - withdraws meanwhile (x-scenarios-lj#1).
- giveme.my (121): the reviews that start a collateral's mix say so. Copying (145): the swap retry's line (322#0).
- Bring every box back now (226): the collateral's box waits for its mix; `bringStopped`/`counted`; the recheck read.
- When the wallet reads (124): the bring's reads and the recheck.
- On this device (235): `depositors`, the started pools' values.
- The restore scan (110): the new ask, and why it tells the server nothing new.

**keys-and-accounts.md**
- The restore scan: the contract-input read and its register check, the behind-server case, `recovered.own`, F4 strangers, the cost line (x-scenarios-sessions#0).
- *Put in 5 ₳ to cancel*'s 5 ₳: "comes back with the return, or … later, as a box of its own" where a 5 ₳ pool mixes it (docs-1 had left it; see *Owner's calls*).

**lovejoin-mix-width.md**
- `wayOver` gives no reason where three takes no box either (319-worker#0), at the fallback paragraph and the touch list.
- *That it's the wallet's mix*: declared budgets redeemer by redeemer, the token pool by reference and inline (312#1), five refused at measurement, four refused by its sum (312#0).
- `MEASURE_LIMIT` caps a transaction's scripts together.

**seedelf-data/README.md**
- Standard means: the 128-level datum depth, a readable copy listed (314-wasm#0).
- The read-on bounds: output and transaction ids gathered, candidates or not (321-lj-rust-data#0).
- *Kept*: the cursor read once a tip, one 5 s deadline, the last list on a failed or late read or list, 503 only before the first (317-data#0, #2, R3-15).
- The vectors' `scriptRowDatums` and `within_depth`; the offline tests' depth walk ("(above)" corrected to "(below)").
- `lovejoin/tokens` always kept (317-data#1).

**seedelf-platform/CLAUDE.md** (one line now false). "A change to either side's rules changes the other's" now names the third copy of the depth walk, `lovejoin.ts` `withinDepth`, and the vectors' `cbor::within_depth` (deep-datum, w-left).

**extension/README.md**
- Collateral's **Pay it again anyway**.
- `SendButton` in the components list. It came in round 2, and docs-2 had made the list whole.

## Found already true (no edit)

- **wasm/README.md.** rr-2's round 1 rows cover bootstrap's, reserve's, max-left's and rr-1's items: `lovejoinBootstrapReserve`, `lovejoinBootstrapMost`, both collateral reserves, the parts' `leftWhy` and Max over nothing, and `lovejoinFunding`'s refusal. Rounds 2 and 3b changed no export (fx-misc touched a doc comment).
- **seedelf-data/deploy/README.md.** fx-misc's three passages are in, and true:
  - the first pool list within a minute: `WORK_BUDGET` is 60 s; `tokens` works out `shown` per request;
  - the read-on premise;
  - what `.prev` holds.
- **store/README.md.** Nothing the fixes changed. The upload paste is the owner's step (docs-2).
- **The web wallet README and the root README.** Nothing now false.
- **flows.md:381** (Send checks inputs spent since) is now true for a payment in parts too. The later parts' check is said where the parts are.
- **The policy needs no Changes line** for: wlj-1's tie, wlj-4's launch values, w-left's records and recheck, fx-lj-1's payer and hatch order, and fx-lj-2's stop mark. The table above has why.
- **seedelf-platform/CLAUDE.md, the optional items**: pool-exists (reference read), max-left (`LeftWhy`), reserve (`direct_tail_reserve`) and rr-2 (`pay_rest` 20 to an output). Their lines stay true, so they're unedited: the brief limits that file to lines now false.

## No longer as the item said (superseded, written as the code is)

- wlj-1's payer order (privacy.md:208, flows.md:524) is superseded by fx-lj-1's.
- sc-lj-1's "the stepper keeps that reserve aside": since fx-reserve-2 (R3-7), the stepper never stops on it. The figures count it only where that many boxes leave room.
- sc-o-1's `collateralPoolShown` is now `collateralPoolTakes`, and Max's rule follows it (fx-reserve-1).
- wss-2's "no second payment is offered meanwhile": fx-misc's page offers **Pay it again anyway** after 10 minutes.
- sc-lj-2's late line: fx-lj-2's words, with the unlocked line folded in.
- wlj-4's "banner words after the screens round": sc-o-2 landed them, and fx-misc counted boxes.
- docs-1's "flows.md:512 left as the screen reads": the screens changed, so it's rewritten.
- privacy.md:210's "a 1.5.0 public seed's" holds only where the update found its record. Case (a) isn't fixed in code, so the doc says so.

## Claims I couldn't verify myself

These figures come from the fixers' measured runs, core's doc comments and their pinned tests. I ran nothing to re-measure them:
- 1,804 lovelace a token deposit's reference read (pool-exists);
- 68 classic boxes at 6,465 lovelace a byte (bootstrap; core's `a_private_bootstrap_is_held_…`);
- about 0.29 ₳ over on a chain (reserve; `COLLATERAL_TAIL_RESERVE`'s doc);
- 2.8 ₳ / 3.6 ₳ (`direct_tail_reserve`'s doc and reserve's pinned wasm test).

The "about 4.7 ₳" back, the 15-minute `LANDING_MS` (5 × 3 min), `WORK_BUDGET`, `POOL_ROOM_MS` and `RECORD_KEEP_MS` (3 h) I read in the code. Nothing was run live.

## Left for later, or for others

- **fx-last's five items**, seen in the tree: LM-1 (`tailPaid`), LM-2 (Max never followed to nothing), LW-1 (Stop's no-box words and its own privacy key), LW-2 (the banner's count while hidden) and LW-4 (the held figure at the stepper's most). The docs describe 3ea05dc1. A later pass should touch:
  - flows.md's swap review, Stop and the Mix form's held figure;
  - privacy.md:217's swap words;
  - architecture.md's collateral bullet;
  - the banner's count.
- **docs-b's files:** roadmap.md, post-release-roadmap.md, the chunk-34 plan and development.md (fx-misc's cold-start line, fx-tests' testing-layers row).
- **Not my files:**
  - the fixers' reports' corrections fx-tests asked for (wlj-4.md's "matched exactly", w-left.md's "each hunk was mutation-checked");
  - OWNER-CALLS.md's corrections (fx-reserve-1 item 7, fx-reserve-2 item 5);
  - HANDOFF.md's owner's calls (wss-1).
- **The lead's e2e list:** Home's two-window watch (fx-tests item 4).

## Owner's calls

1. **The policy's Effective date and its "updated for …" list.** Left as they are, one edit for both: docs-2, x-privacy#4, x-release#4. The list doesn't name the collateral mix.
2. **No Changes line for the restore scan's new ask** (wss-2). The server learns nothing it didn't hold (above). Under the rule of a dated entry for every data-handling change, the owner may still want one in the 18 October entry.
3. **The two policy sentences on the reserve's fallback are worded by me.**
4. **keys-and-accounts.md's *Put in 5 ₳ to cancel*** is made true now, though docs-1 suggested waiting. The screens' own by-hand notes (`swaps.collateral.note`, `swaps.backCollateral.note`) are unchanged, and stay the owner's (sc-o-1's call 6, Session 10's call 2).
5. **The store's alarms justification doesn't name Bring every box back now, nor Stop's later read.** It's a summary, not false, so I left it: an edit means one more paste at upload.

## Checks

- **Stale figures and names:** grepped across my files ("53 in the classic", "35 to 40", "fixed 1.5", "past 500", `collateralPoolShown`, "1 ₳ for the fee", the old `lovejoin.rs` path, `external_sweep_with`, "Max is 16"). None left.
- **Tables:** the storage table rows I edited keep their cells (5 fields split on `|`).
- **Links:** the one link I added (`flows.md#mix-through-lovejoin-the-dapps-page`) matches a heading's slug.
- **"Seedelf":** capitalised in every line I added.
- **No test reads these docs** (`tests/i18n.test.ts` reads `docs/i18n/` only), so none was run.
- **Not run:** formatters, builds, cargo.
