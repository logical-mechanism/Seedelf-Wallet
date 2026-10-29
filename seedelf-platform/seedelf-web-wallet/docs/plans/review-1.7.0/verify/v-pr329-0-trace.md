# v-pr329-0-trace: pr329#0, 1.7.0's list still shows items 4–7 open

**Verdict: confirmed. Severity: low** (as the finding says). Confidence: high.

I tried to refute it on HEAD (`6bca8bec`) and couldn't. Every fact in the finding holds, and so does its fix, with the small corrections below. The stale state is the agreed one: #333's description says "As agreed, the 1.7.0 list's tick waits for the release-prep docs commit." That agreement isn't written anywhere in the tree, though, and the finding's fix is aimed at that same commit. So this finding is the record of what that commit has to do.

## What holds on HEAD

- **The list.** `docs/post-release-roadmap.md:38` reads `4. 🚧 **Two in core and WebAssembly:** …`, with only "✅ The overflow half" ticked. `:39` reads `5. ⬜ **A listed pool confirmed on chain, and L's registration checked on the data layer's path**`. `:40` reads `6. ⬜ **An "unmixed, now" way out** … The owner's calls first: after how long it's offered, and its words.` `:41` reads `7. ⬜ **Transaction details for every part**`.
- ***Kept in mind*.** Five **(1.7.0)** entries are unticked: :373, :374, :378, :379 and :380. They are exactly the five the finding names. The other 1.7.0 entries (:387, :388 and :405) are ticked.
- **The four PRs never touched the file.** `git diff --stat <merge>^1 <merge> -- …/post-release-roadmap.md` lists nothing for #333, #335, #336 or #337. #330, #331 and #332 each ticked their own item in their own PR (4, 2 and 4 lines). #338's diff changes item 8's lines only (:42 and the entry at :405). Its first parent is `11e249d2`, #337's merge, so all four PRs were in when it merged. That matches the user's note that #338 is a pure docs PR on item 8's text.
- **All four items are built on HEAD:**
  - **Item 4, its other half (#333):** `seedelf-core/src/lovejoin/mod.rs:1744` `pub fn bootstrap_back_reserve(params: &ProtocolParameters)`, with `:1750` `.max(BOOTSTRAP_BACK_RESERVE)`. `bootstrap_most` builds with it (`:1974`). It is reached through `lovejoinBootstrapReserve` (`wasm/src/lib.rs:5767-5768`) and `privateBootstrapBounds` (`background/lovejoin.ts:2966`). The test sets the price of a byte to `params().coins_per_utxo_size * 3 / 2`, 6,465 lovelace (`lovejoin_pools_test.rs:1797`). It asserts a cap of 96 classic boxes (`:1809`) and 64 of LJTEST (`:1813`), and that a fixed 1.5 ₳ can't pay the way back there (`:1805`).
  - **Item 5 (#336):** `background/lovejoin-pools.ts:454` reads `await this.keep(network, await this.confirmed(network, found));`. That line is on the data layer's path. `confirmed()` is at `:565`. It calls `launched()` (`:522`), which asks Koios for `tx_info` (`koios.launches`, `koios.ts:926`/`:931`). Where the launch's own certificates didn't register L, it also asks for `account_update_history` (`koios.firstRegistrations`, `:954`/`:958`). The policy entry is `privacy-policy.md:93`: "**28 October 2026:** on mainnet, a Lovejoin pool our server lists that this device hasn't seen before is confirmed with Koios …".
  - **Item 6 (#337):** `background/lovejoin.ts:335` has `export const TAIL_OFFER_MS = 60 * 60_000;`. The RPC is `"session-skip-collateral-mix"` (`rpc.ts:3005`, `handlers.ts:512`), wired into Swaps, SiteSessions and Lovejoin. The button is `en.json:921` `"lj.tail.wayOut": "Bring the rest back now"`.
  - **Item 7 (#335):** `background/tx-view.ts:190-192` follows `partHashes`. The stepper in `ui/components/TxDetail.tsx:151-164` uses `tx.partPrevious`, `tx.partOf` and `tx.partNext`.
- **:379's mechanism is stale too.** It still says "one `utxo_info` per newly listed pool". The code asks `tx_info`, plus `account_update_history` only where the launch didn't register L.
- **No other live doc is stale on this.** A grep of `docs/` (outside `archive/` and this review), `README.md` and `wasm/README.md` finds the four as unbuilt only in this file. `architecture.md:672` already describes the priced reserve. `roadmap.md:59` is 1.6.0's handoff note, a history, and stays as it is.
- **Item 2's 🚧 is right.** `gh api repos/logical-mechanism/Seedelf-Wallet/branches/main/protection/required_status_checks` returns `{"checks":[],"contexts":[],"strict":true}`. No check is required on `main` yet, and there are no rulesets.
- **The version:** `extension/package.json:3` is `"version": "1.6.0"`.

## Why it's real, and why it's low

The 1.7.0 paragraph (:33) says "the version is cut once they're in", and the owner's memory index names this file as where 1.7.0's list lives. So a release-prep session reads four of eight items as unbuilt, and a later session choosing from *Kept in mind* reads :373 "it's a button and its words" as work still to do. The harm is confined to the docs: nothing ships from this file, and no user or money is affected. The scenario's strongest branch, building a second way out, is unlikely: a session would find `lj.tail.wayOut`. That makes it a misleading doc, which is low.

## Repro

I wrote a scratch test, `extension/tests/zz-review-v-pr329-0-trace-1.test.ts`, and ran it alone (`npx vitest run …`). It reads the list's status markers and checks HEAD's code for items 4–7.
- **Sanity:** the list reads 1 to 8, and all four items are built. This check passed.
- **"ticks every item whose code is on HEAD":** FAILED with `expected [ '4: 🚧', '5: ⬜', '6: ⬜', '7: ⬜' ] to deeply equal []`.
- **"leaves no (1.7.0) Kept in mind entry unticked":** FAILED with `expected [ 373, 374, 378, 379, 380 ] to deeply equal []`.

The run gave 2 failed and 1 passed. I deleted the file afterwards, and `git status` shows none of mine.

## Corrections to the fix

- **The version is three fields, not one.** Bump `package.json:3` and `package-lock.json`'s two `version` fields (:3 and :9), as 1.6.0's bump did (`8cc00445` changed all three). The manifest and `__VERSION__` read `pkg.version` (`vite.config.ts:106`, `:112`), so nothing else needs it.
- **Item 5's ✅ wording:**
  - `launched()` was moved out of `holder()` so both paths share it. `confirmed()` is the new method.
  - `account_update_history` is asked only for an L its launch didn't register. Don't write "one per pool".
  - Only a pool new to the device is checked. `keep()` only appends (`lovejoin-pools.ts:374-383`, `pools: [...was.pools, ...fresh.map(slim)]`), and `confirmed()` passes kept pools straight through (`:569`, `:583`). A pool kept before 1.7.0, or one whose launch a deep rollback undoes after it was kept, stays kept. So the ✅ line for :379 shouldn't say the rollback case is closed. Say "before a pool new to the device is kept", and leave the after-keep case in a line if it's worth keeping.
- **Item 4's ✅ line:** reuse `architecture.md:672`'s words: 1.8 ₳ at 6,465 lovelace a byte, never below 1.5 ₳, with the cap staying at 96 classic and 64 LJTEST, where a fixed 1.5 ₳ held it to 68 and 51. Item 4 becomes one plain ✅, without the half-tick.
- **Format:** :387-388's pattern (`✅ **1.7.0:** <what's built>. ~~<old text>~~`) keeps the old text, as the finding asks. #338 used a rewrite instead (:405). Either reads fine; pick one for all five.
- Keep item 2 at 🚧 (above). Leave `roadmap.md:59` alone, since it's history.
