# x-docs: the docs across #325–#338 (cross-PR lens)

Reviewed on HEAD `6bca8bec`. Read-only, apart from one scratch Vitest file, which has been deleted.

## Verdict

**The docs are in good shape. Nothing is high or medium.**
- **Links:** every relative link and anchor in every tracked markdown file resolves, at HEAD and at `babb8e76`. That's 1,214 links on HEAD, including the archived chunk 34 plan and every file that points at it. Nothing still points at `plans/chunk-34-token-pools.md`.
- **The release record (#325) checks out:** SHA-256 `6d1219aa…938f`, 2,089,173 bytes and 24 entries in `release/seedelf-wallet-1.6.0-mainnet.zip`. clang 21.1.8, Node 24.19.0 and zlib `1.3.2.1-motley-3246f1b` match this box. `extension.spec.ts` held 104 tests at `babb8e76`.
- **Rule 7:** no added doc line dates a release or states the store's status.
- **Name style:** clean in every added line.

**What's wrong is drift:**
- Four landed items still read as open.
- Three PRs left text elsewhere that their own change made false.
- The store's host-permission text was missed.
- The repo says `main` requires a check that it doesn't.
- One new privacy line names the wrong cause in some of the states it shows in.

Several of these overlap the per-PR reports (pr329, pr331, pr332, pr333, pr338), which are noted where they do. What's new from this lens:
- privacy.md:198
- the store's host-permission text
- the way-out line's cause
- privacy.md not naming the new control
- the item-5 rollback nuance

## Findings

### 1. low · docs: items 4–7 and five *Kept in mind* entries read as open, and two describe requests that weren't built

**What's on HEAD** (`post-release-roadmap.md`):
- **:38** `4. 🚧 … ✅ The overflow half…`. #333 landed the other half.
- **:39–41** `5. ⬜`, `6. ⬜ … The owner's calls first`, `7. ⬜`. #336, #337 and #335 landed them.

**The five *Kept in mind* entries:**
- **:373** "An "unmixed, now" way out (1.7.0)".
- **:374** "a review opens only the first part's".
- **:378** "`BOOTSTRAP_BACK_RESERVE` is a fixed 1.5 ₳, so a dearer byte lowers the cap".
- **:379** "one `utxo_info` per newly listed pool". It was built as `tx_info` (`koios.ts:926`).
- **:380** "One batched `account_info`…". It was built as `account_update_history`, only for an L its launch didn't register (`koios.ts:954`).

This is agreed: #333's description says "the 1.7.0 list's tick waits for the release-prep docs commit".

**For that commit:**
- Tick 4–7 and strike the five entries ("✅ **1.7.0:** …", as :387–388 do).
- Item 6 records the owner's calls: an hour (`TAIL_OFFER_MS`), and *Bring the rest back now*.
- Rewrite :379–380 to the requests made. Rule 8: each feature states its Koios cost.
- Item 2 stays 🚧. `main`'s protection requires nothing yet (finding 5).
- **Medium confidence:** #336 checks a pool once, as it's first seen (`confirmed()`, `lovejoin-pools.ts:565`). So a launch rolled back after that check stays kept. Item 5's tick should say it closes a lying server and a launch that isn't on chain when first seen, not every rollback.

Overlaps pr329 #1 and pr338.

### 2. low · docs: #333 left three statements that its own fix made false

- **`flows.md:523`**: "one deposit's most under today's fees (68 in the classic pool at 6,465 lovelace a byte, half as much again as today's)". Since #333 the cap there is 96. `lovejoin_pools_test.rs:1809` asserts `bootstrap_most(&dear, &classic, true, 96) == 96`, and the test I ran printed "the way back's reserve is 1800000". The same bullet's "*For returning the rest* (1.5 ₳…)" holds only at today's parameters: the row shows `summary.bootstrapReserve` (`Lovejoin.tsx:3798`).
- **`architecture.md:672`** contradicts itself. First: "which builds both for each count: one deposit's most under today's parameters, fewer at a dearer byte". Then, added by #333: "so a dearer byte doesn't lower the cap".
- **`privacy.md:198`** (not in pr333): "funded with the boxes, 1.5 ₳ for the deposit's fee and change, and 1.5 ₳ for its way back … (one deposit's most under today's)". The way back is priced now, 1.8 ₳ at 6,465 lovelace a byte.

**Fix:**
- flows.md: "one deposit's most (96, or 64 in a token pool), the way back's reserve priced from the parameters: 1.5 ₳ today, 1.8 ₳ at 6,465 lovelace a byte".
- architecture.md: drop "fewer at a dearer byte".
- privacy.md: "at least 1.5 ₳ for its way back, priced from the parameters".

### 3. low · release: the store's host-permission text doesn't cover #336's new mainnet Koios requests

**`store/README.md:261`**, the Koios host row, says:
- Koios is asked about "the new pools at Lovejoin's reference holder (the transactions that started them and their scripts' registrations) while its own server hasn't listed them";
- "Even while its own server answers, Koios is asked what made the user's boxes in a later pool…".

**`:269`**, the 996-character text pasted into the dashboard, says "and for one Lovejoin read its server doesn't cover".

Since #336, Koios is also asked while the server answers, for every pool the server lists that's new to the device: `tx_info` for its launch, and `account_update_history` for L (`lovejoin-pools.ts:454`, `:565`–`:584`). That's a second read the server doesn't cover. The policy (:46, :93) and privacy.md (:200) were updated; this text, which goes to the reviewer at upload (development.md step 11, "check the host justifications"), wasn't.

**Fix:**
- **:269**: "and for two Lovejoin reads its server doesn't cover". That's 997 characters, still under the box's limit.
- **:261**: add "and, as its own server lists a pool the device hasn't seen, that pool's launch transaction and its script's registration".
- **Optional:** the policy's service list (:40, "on mainnet whatever ours can't answer") and the listing's description (:75) simplify the same way. They did already for the copies' read.

### 4. low · docs: `architecture.md:732` still calls a listed pool's launch the server's word

It says "that it's finished, and where its launch sits … are the server's word", and "Whether a pool is on chain at all is the ledger's to judge, not the server's: … one a list names may never have been launched, or its launch rolled back".

Since #336, a pool from the list that's new to the device is kept only once Koios's `tx_info` finds its launch, and its L is registered by the launch or an earlier block (`confirmed()` → `launched()`). Where it sits, and so which pool is earliest, is still the server's word.

Overlaps pr329 #5.

### 5. low · docs/ci: `development.md:13` and `web-wallet.yml:135` say `main`'s protection requires *Web Wallet required*

- `development.md:13`: "That job is the one `main`'s branch protection requires…".
- `web-wallet.yml:135`: "The one check main requires (its branch protection names *Web Wallet required*…".

A read-only `gh api repos/logical-mechanism/Seedelf-Wallet/branches/main/protection` gives `required_status_checks {strict: true, contexts: [], checks: []}`. Roadmap item 2 (:36) rightly says requiring it is still the owner's step.

**Fix:** "the one for `main`'s protection to require (1.7.0's item 2)", until the owner turns it on.

Overlaps pr329 #6 and pr331 F6.

### 6. low · ux: the way-out's privacy line names giveme.my where the mix waits to be built again

`lj.tail.privacy.wayOut` (en.json:922) reads "The collateral's mix is still waiting for giveme.my. Bring the rest back without it…".

`tailHeld` (`lovejoin.ts:4131`) offers the way out in two kinds of state:
- `tailWaits`: the mix waits for giveme.my;
- `tailBuildable`: the chain stopped short of the mix (giveme.my refused, a drawn box gone, a lock), and the mix waits to be built again. Its wait is the box's listing, the 5 ₳ pool (`lj.tail.noPool`) or free boxes (`lj.tail.fewBoxes`).

`flows.md:522` gets this right: "while the mix still waits (for giveme.my, or to be built again)".

**Shown by a scratch test (deleted):** in `lovejoin-planner.test.ts`'s `stoppedAtMix()` state, the chain's reason is "giveme.my wouldn't back the collateral's mix, so the chain stopped there.". The session's view carries `collateralHeld: {offerAt: landed + 3,600,000}`. From that hour the page says the mix "is still waiting for giveme.my".

**Fix:** a first sentence that holds in both states, for example "The collateral's mix hasn't gone yet." Keep the rest of the line as it is. It's a critical key, so es and ja need a fresh blind back-translation.

### 7. nit · docs: the Leios entry (#338) overstates two things

- **`:406`**: "Mended, all of it ran on Musashi". The branch's own README says "A Lovejoin withdraw can't be mended after the fact … None was sent here."
- **`:409`**: "a chain's window of four in flight (`pumpChain`)". For four-box chains the window is two (`CHAIN_WINDOW_FOUR = 2`, `lovejoin.ts:300–302`, used at `sessions.ts:4937` and `lovejoin.ts:4635`).

Overlaps pr338.

### 8. nit · docs: the WebAssembly profile's descriptions (#332)

- **`seedelf-platform/CLAUDE.md:94`**: "so its sums on amounts are checked by hand (`checked_add`)" reads as all of them. seedelf-wasm adds lovelace unchecked in many places: `lovejoin.rs:847–848` (`.sum::<u64>()`), `:2127`, `:2178`, and `lib.rs:3766`. That's safe on amounts the chain bounds. Only the ones a datum controls are checked by hand.
- **`wasm/README.md:115` and `architecture.md:99`** describe `wasm-release` without its new overflow-check overrides.

Overlaps pr332 (F1, and its note on :67).

### 9. nit · docs: privacy.md's collateral-mix paragraph doesn't name *Bring the rest back now*

The paragraph (:217) says the box waits unmixed and tied to the session "if it can't go". It doesn't mention the control that now does that by the user's choice. flows.md:522 and architecture.md:633 both name it.

### 10. nit · docs: the archived chunk 34 plan still heads 34g "(2026-10-18, in progress)"

`:910` still has "(2026-10-18, in progress)", and `:914` "Start here (the next session)". Both sit under a status #329 set to ✅ done, and the row's link at `:1497` now reads "done" while pointing at the "in-progress" anchor. The archive isn't maintained, so this is cosmetic.

### 11. owner-call · docs: the policy's date

The *Effective* line (:3) and the *Changes* entry (:93) are dated 28 October 2026, for behaviour that reaches users with 1.7.0's upload. For 1.6.0 the owner set the policy's date at release. #336 raised this.

## CLI notes

- The Leios run (:406) found that Dijkstra (protocol version 12) refuses list-form redeemers. Those are written by Pallas 0.35's builder and by core's `withdraw_zero.rs:117` (`Redeemers::List`). It also refuses certificate 0 (`launch.rs:252`). So once Dijkstra reaches mainnet, every CLI script spend needs the same mend as the wallet's. The owner put that much later.

## Not checked

- **Claims I couldn't check offline:** tor-js's 0.4.3 internals, the 1.9 MB bundle, DigitalOcean's acceptable use policy, Nym, and Musashi's parameters.
- **The Leios numbers:** compared with the branch's `seedelf-leios/README.md` (`git show`), not recomputed from its results.
- **The old caps:** 68 classic and 51 LJTEST at 6,465 were not re-run on the old code. Only the new 96/64 and 1.8 ₳ were.
- **The module's doubled size:** 6.4 MB / 1,289 KB is not rebuilt (`build.sh` is off-limits). The current module, 3,209,441 bytes and about 986 KB with gzip -9, matches "3.2 MB, 982 KB + 4 KB".
- **The protection read:** as of now. The owner may change it.
- **The words:** the es and ja wording isn't reviewed here (the i18n lens), and no screen was rendered.
