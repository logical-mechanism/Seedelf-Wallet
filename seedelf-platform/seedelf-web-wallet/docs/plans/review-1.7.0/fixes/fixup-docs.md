# Fix-up: the docs lens's findings on the merged fixes (lane: fixup-docs)

Tree: `W` = `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-wt/release-1.7.0`. Small anchored edits only; no git state changed; nothing reverted. Every finding was checked against the worktree's code before its words changed (docs-only findings need no test, per the brief).

## Outcomes

| # | Finding | Outcome | Files |
|---|---|---|---|
| F1 | Root README / CLAUDE.md: mainnet asks Koios only for what our server can't answer | **partly**: README fixed; root `CLAUDE.md:69` not edited (below) | `README.md:164`, `:214` |
| F2 | No test checks the two changed critical values | **owner-call** (back-translations are the lead's step; the hash gate is the owner's) | none |
| F3 | architecture.md:53 "no request waits for" the Koios check | **fixed** | `docs/architecture.md:53`, `extension/src/background/lovejoin-pools.ts:243-245` (comment) |
| F4 | architecture.md:100 draws the overflow line by crate | **fixed** | `docs/architecture.md:100`, `wasm/README.md:115` |
| F5 | CLAUDE.md exempts seedelf-wasm's lovelace sums | **partly**: roadmap fixed; `seedelf-platform/CLAUDE.md:96` not edited (below) | `docs/post-release-roadmap.md:389` |
| F6 | Kept in mind says mainnet has no token pools | **fixed** | `docs/post-release-roadmap.md:385`, `:396` |
| F7 | Archived 34g heading reads as 1.6.0's release date | **fixed** | `docs/archive/plans/chunk-34-token-pools.md:9`, `:910`, `:1497` |
| F8 | `lj.launch.copy` sends the user to a pool the form can't show | **owner-call** (the lead's, as the finding says); not built | none |

### Neither CLAUDE.md was edited

My instructions say an agent's task can't authorize a change to a CLAUDE.md. So I made the README and roadmap halves of F1 and F5, and left both CLAUDE.md edits for the lead to apply with the owner's OK. Exact text:

- **Root `CLAUDE.md:69` (F1).** Replace `and Koios for any part that's down or with Settings' Koios-only switch on; preprod reads Koios alone.` with `and Koios for any part that's down or with Settings' Koios-only switch on, and to check each new Lovejoin pool the data layer lists; preprod reads Koios alone.`
- **`seedelf-platform/CLAUDE.md:96` (F5).** Replace `Its plain \`+\` and \`.sum()\` add counts, fees or lovelace, which the ADA supply bounds (a u64 holds 400 times all of it), and its token totals are u128.` with `Its plain \`+\` and \`.sum()\` add counts, fees or lovelace, which the ADA supply bounds for honest rows (a u64 holds 400 times all of it), and its token totals are u128. A lying index's rows can pass a u64 together and wrap \`holding_enough\`'s and \`Holdings::spare\`'s to a false figure: a new sum of rows' lovelace is checked, or in u128 where it's only compared, as core's \`apart\` is.`

## Each finding

### F1 (partly)
- **Checked:**
  - `confirmed()` asks `koiosAlone()` while the data layer answers: `utxoInfo` (`utxo_info`), then `launched` → `koios.launches` (`tx_info`) and `firstRegistrations` (`account_update_history`), from `lovejoin-pools.ts:620-640` and `:574-610`.
  - `refresh` starts it through `confirm` at a pool read.
- **Fixed:**
  - `README.md:164` now ends "…through Koios for any part that server can't answer; it also asks Koios to check each new Lovejoin pool that server lists."
  - `README.md:214` reads "…and on Koios for any part it can't answer and to check each new Lovejoin pool it lists; on preprod, Koios alone."
- **Checked, needing no change:**
  - The web wallet's `README.md` has no such summary.
  - `flows.md:23` defines "Koios, here" for the flows, and makes no privacy statement.
  - The listing's `:289` covers financial data, which the pool check doesn't send.
- **Left:** the root `CLAUDE.md:69` (above).
- **Test:** none, docs-only.

### F2 (owner-call)
- **Reproduced:** `npx vitest run tests/i18n.test.ts` passes 24/24 on W.
  - Both `lj.tail.privacy.wayOut` and `settings.koiosOnly.privacy.off` are `machine` in `es-provenance.json:961/1875` and `ja-provenance.json:867/1663`. The second was `mtpe` at HEAD.
  - The verified-critical files list both by name, and `i18n.test.ts:194-209` checks names only. So the brief's "a test will fail until that's done" doesn't hold.
- **The lead's step before the commit:** a blind back-translation of four values: es and ja of `lj.tail.privacy.wayOut` and `settings.koiosOnly.privacy.off`. Add the listing's changed es clause (`docs/store/README.md:163`, "además, comprueba cada pool nuevo de Lovejoin…") and ja clause (`:227`, "また、私たちのサーバーが一覧に載せた新しい Lovejoin のプールは…"). Note the round in each reviewer line.
- **The owner's call:** record a hash of each verified value in `verified-critical-{es,ja}.json`, so a changed value fails the gate. I recommend it. The screens review's finding 2 is the same finding.
- I didn't touch `verified-critical-*.json`, as the brief says.

### F3 (fixed)
- **Checked:**
  - `look()` awaits `this.checking.get(network)` (`lovejoin-pools.ts:418-425`), and the launch's `build` calls it (`lovejoin-launch.ts:245`), as do `lookForPools` (`handlers.ts:531` → `sw.ts:247`).
  - `confirm()`'s `.catch` keeps every failure and calls `wallet.trapped()` on a trap (`:496-507`). The `DiscoveryDeps.wallet` dep has no other caller.
- **Fixed:**
  - `architecture.md:53`'s last sentence now reads "Discovery's Koios check of the pools new to a device, whose trap no request hears (a look waits for it, but the check keeps its own failure), locks the wallet itself".
  - The `DiscoveryDeps.wallet` comment says the same, wrapped under 120 columns.
- **Tests:**
  - `npm run typecheck` is clean.
  - `tests/lovejoin-discovery.test.ts` passes (27/27), and so does `tests/lovejoin-discovery-review-fixes.test.ts` (2/2).
  - The change is a comment, so no test fails before it.

### F4 (fixed)
- **`architecture.md:100`** now says the profile checks overflow "where core, crypto and koios compile their code …, not in seedelf-wasm …; a small call-free core function, or a generic one seedelf-wasm instantiates, is compiled into seedelf-wasm and wraps there". It adds that a missed sum "traps where it's checked … and wraps to a false figure where it isn't", which is why outside values are summed with `checked_*`.
- **`wasm/README.md:115`** now says "where core, crypto and koios compile their code, not where this crate does (a small call-free or generic core function compiled here wraps)".
- Both now match `Cargo.toml:52-58` and the roadmap's item at `:389`.

### F5 (partly)
- **Checked:** seedelf-wasm sums index rows' lovelace with a plain u64 `.sum()` in more places than the two named:
  - `holding_enough` (`wasm/src/lib.rs:3631-3635`);
  - `Holdings::spare` (`wasm/src/lovejoin.rs:846-848`);
  - the per-history totals (`lib.rs:3766`);
  - `lovejoin.rs:2191`, under a `saturating_sub`.
  
  Hardening "those two sums" alone wouldn't make CLAUDE.md's exemption true, so the words are the fix.
- **Fixed:** the roadmap's ✅ entry (`post-release-roadmap.md:389`) made the same claim ("its other sums add lovelace, fees or counts"). It now says "which the ADA supply bounds for honest rows (a lying index's rows can still wrap `holding_enough`'s and `Holdings::spare`'s to a false figure, where core's `apart` sums in u128)".
- **Left:** `seedelf-platform/CLAUDE.md:96` (above).
- **If the lead hardens those sums instead,** the roadmap's parenthetical and the proposed CLAUDE.md text must change with them.

### F6 (fixed)
- **Checked:** W's head start (`src/lovejoin-pools.json`) holds mainnet pool `dc6abe3b0b18…` at `boxLovelace` 5000000 with no token. HEAD's mainnet list was empty.
- **Fixed:**
  - `:396` now ends "Mainnet's only pool beside the classic one is the 5 ₳ ADA pool (1.7.0's head start), so a copy of it is possible now."
  - `:385` now says "mainnet has no pools of a token yet".
- The docs use a plain space before ₳ (no U+00A0 in either file), so I matched that.

### F7 (fixed)
- **Fixed:** the heading is now "## 34g · The preprod rehearsal and the release (from 2026-10-18)". Both anchors to it (`:9`, `:1497`) now point to `#34g--the-preprod-rehearsal-and-the-release-from-2026-10-18`. Nothing else in the repo links to it.
- **Checked:** every relative link and anchor resolves in the five edited docs. The checker is `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/fixup-docs/anchors.py`, tested first on the old anchor, which it reported as missing.

### F8 (owner-call, not built)
- **Checked:**
  - `lovejoin-launch.ts:250-254` throws `lj.launch.copy` for a match in `lastListed` that isn't kept.
  - `terms()` lists only kept pools that aren't copies (`:213-216`).
  - `LovejoinLaunch.tsx:163` shows the same key for a pool the form does list, where "Use that pool instead" is right.
- **Recommendation:** give the lastListed-only case its own short, non-critical key in en, es and ja, such as "A pool of these values was just started. Use it once it shows.", and keep `lj.launch.copy` for the form. The screens review's finding 1 is the same finding, and its lane may take it, so I left the locale files alone.

## For the record

- **Strings added or changed:** none. **Critical keys changed:** none. **e2e specs edited:** none. **WebAssembly node tests added:** none.
- **Code changed:** one comment in `extension/src/background/lovejoin-pools.ts` (`DiscoveryDeps.wallet`). No behaviour changed.
- **Docs changed:**
  - `README.md` (root);
  - `docs/architecture.md:53` (its last sentence only: the worker review's two notes touch other parts of that bullet) and `:100`;
  - `wasm/README.md:115`;
  - `docs/post-release-roadmap.md:385`, `:389`, `:396`;
  - `docs/archive/plans/chunk-34-token-pools.md:9`, `:910`, `:1497`.
- **No data-handling change,** so no policy *Changes* entry is needed.
