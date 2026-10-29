# Review of the merged fixes: the docs against the code (lens: docs)

Tree: `W` = `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-wt/release-1.7.0` (branch `web-wallet/release-1.7.0-fixes`, working changes on `6bca8bec`). Read-only: no tracked file edited, no git state changed. One test file run (`tests/i18n.test.ts`, 24/24 pass). Paths below are under `W/` unless absolute.

## The short answer

- **Every privacy note is still there.** No key was removed from en, es or ja, and `critical-keys.json` is unchanged. Three values changed: `lj.tail.privacy.wayOut`, `lj.tail.skipped` and `settings.koiosOnly.privacy.off`. Each keeps what it tied. The privacy paragraphs in privacy.md, the policy and the listing only grew or were corrected. The one clause dropped, privacy.md's "never one of the wallet's", was replaced by the starter's timing caveat, which is the more accurate statement.
- **No new release date or store status.** I scanned every added line in every changed `.md` for dates and status words. The dates added are the owner's decision dates and plan-session dates. One borderline case: the archived plan's 34g heading, F7.
- **The statements the lanes added match the worktree's code**, with the exceptions below. I checked them against the code:
  - #336's check, as the pools lane rewrote it:
    - `refresh` → `keep(network, [])` → `confirm` (non-blocking, one at a time) → `confirmed` → `utxoInfo` on holder rows → `launched` (`tx_info`, `account_update_history`);
    - `look()` awaits `checking`, and `lastListed` feeds the launch's copy check;
    - batch sizes 60, 20 and 75 (`koios.ts:442-448`).
  - `TAIL_OFFER_MS` is an hour (`lovejoin.ts:335`).
  - The tail lane's `view()`, which checks `chainView(...).cut`, and `skipCollateralMix` in `serial`.
  - The traps lane's `runAll` `unlessTrap` and `pump`'s rethrow.
  - The Bootstrap reserve: core's `bootstrap_back_reserve` floors at 1.5 ₳ and gives 1.8 ₳ at 6,465, and `MAX_FEE` is 10 ₳.
  - The CI conditions in `web-wallet.yml`.
  - The lockfile versions: rustls 0.23.46, crypto-bigint 0.5.5 through uplc → k256 in seedelf-wasm's tree (`cargo tree --offline`), and the data layer's ctutils 0.4.3 and tokio 1.53.2.
  - The Leios entry's code references: `cbor.ts` `0x84`, `chainWindow`, `withdraw_zero.rs`'s map refusal, `REFERENCE_SCRIPT_TIER`.
- **The listing's counts are right.**
  - The host rows come to 2,802 characters (the optional-host row plus the four host rows, the same method that gave 2,636 on the base).
  - The merged box is 998.
- **Every relative link and anchor resolves** in the edited docs (scripted check, sanity-tested on a bad anchor).

## Findings, most severe first

### F1 (low): The root CLAUDE.md and root README still say mainnet asks Koios only for what our server can't answer

- **Evidence:**
  - `CLAUDE.md:69`: "The web wallet reads mainnet through its own data layer first …, and Koios for any part that's down or with Settings' Koios-only switch on".
  - `README.md:164` (the IP-tracking section): "On mainnet it reads and submits through Logical Mechanism's own server first … and through Koios for any part that server can't answer."
  - `README.md:214` says the same.
  - The code asks Koios while the data layer answers. `lovejoin-pools.ts:620-640`: `confirmed` calls `koiosAlone().utxoInfo`, then `launched`, which asks for `tx_info` and `account_update_history`. It starts from `refresh` (`:487-488`), at a pool read.
  - This round fixed the same summaries in the listing (`docs/store/README.md:75/163/227/261/269/274/334`), the policy (`:5`, `:40`, `:46`) and privacy.md:24, which was x-rel#1 (medium). The two root files weren't in its list. The docs-design lane noted them as optional.
- **Scenario:**
  - A mainnet Lovejoin user reads the root README's IP-tracking paragraph and concludes Koios never sees their IP while the data layer is up. In fact their device asks api.koios.rest about each pool new to it. For a pool they started, it likely asks among the first, which the policy now says can tell Koios who started it.
  - An agent who takes CLAUDE.md:69 as the rule writes the next summary, such as the handoff note or a listing edit, with the omission x-rel#1 just fixed.
- **Fix:** add one clause to each, e.g. "…and Koios to check each new Lovejoin pool that server lists". The README is the public one.

### F2 (low): No test checks the changed critical values; only the lead's back-translation does

- **Evidence:**
  - `tests/i18n.test.ts:194-209` only checks that a `machine`-provenance critical key is listed by name in `verified.keys`.
  - `docs/i18n/verified-critical-{es,ja}.json` already list both `lj.tail.privacy.wayOut` and `settings.koiosOnly.privacy.off`. Their provenance in `docs/i18n/{es,ja}-provenance.json` is now `machine`.
  - `npx vitest run tests/i18n.test.ts` passes 24/24 on W.
  - So FIXBRIEF's "A test will fail until that's done" doesn't hold.
  - The listing's changed es and ja description clauses (`docs/store/README.md:163`, `:227`) have no test at all.
- **Scenario:** The release commit goes in without the blind back-translations. CI stays green. 1.7.0 then ships two critical privacy notes whose new es and ja wording nobody checked, while the verified-critical records still name both keys as verified.
- **Fix:**
  - Back-translate the four values (es and ja of both keys) and the two listing clauses before the commit, and note the round in the reviewer line.
  - Owner's call, later: record a hash of each verified value, so a changed value fails the gate.

### F3 (nit): architecture.md:53 says no request waits for the check; requests do

- **Evidence:**
  - `docs/architecture.md:53`: "Discovery's Koios check of the pools new to a device, which no request waits for, locks the wallet itself".
  - The same doc's `:733` says "a look (the Lovejoin page's, a pool's start) waits".
  - In the code, `look()` awaits `this.checking.get(network)` (`lovejoin-pools.ts:418-425`). `build` calls `look` (`lovejoin-launch.ts:245`), and the `lookForPools` request does too.
  - The code comment at `lovejoin-pools.ts:243` ("a check no request waits for") says the same thing.
  - The accurate reason the check locks the wallet itself is that `confirm` catches the trap (`:496-507`), so no request *hears* it.
- **Scenario:** Someone chasing a pool start that hangs about 91 s on a slow Koios reads `:53`, rules the check out, and misses the wait that's actually there.
- **Fix:** replace it with "whose trap no request hears (a look waits for it, but the check keeps its own failure)", and make the same change in the code comment.

### F4 (nit): architecture.md:100 draws the crate line again, which pr332#0 showed is wrong

- **Evidence:**
  - `docs/architecture.md:100`: "Since 1.7.0 it checks integer overflow in core's, crypto's and koios's code … In those crates a sum the code missed traps".
  - pr332#0, verified by a rebuild, found that core's call-free `Locked::total` wraps in the store module. The workspace `CLAUDE.md:95`, `Cargo.toml:52-58` and the roadmap's item 4 now say the check goes with the crate that compiles the code.
  - `wasm/README.md:115` ("It checks integer overflow in core's, crypto's and koios's code, not this crate's") draws the same crate line, though it points to CLAUDE.md for where the line falls.
- **Scenario:** A developer adds a small, call-free core helper on a datum value and calls it from seedelf-wasm. Trusting ":100 a sum the code missed traps", they leave out `checked_*`. The store module wraps it to a false figure while every test build panics. The sentence's own rule ("values from outside the wallet are still summed with `checked_*`") limits this.
- **Fix:** "…checks it where core, crypto and koios compile their code (a small call-free or generic core function compiled into seedelf-wasm wraps)".

### F5 (nit): CLAUDE.md exempts seedelf-wasm's lovelace sums that core was just hardened against

- **Evidence:**
  - The workspace `CLAUDE.md:96` says to sum "a value from outside the wallet (a row …) with `checked_*` … in every crate". It then says seedelf-wasm's plain sums "add counts, fees or lovelace, which the ADA supply bounds".
  - This round hardened core's `apart` (`seedelf-core/src/build.rs:2669-2673`) because "a lying index's lovelace can pass a u64 together".
  - seedelf-wasm's `holding_enough` (`wasm/src/lib.rs:3631-3635`) and `Holdings::spare` (`wasm/src/lovejoin.rs:846-848`) sum rows' lovelace with plain `.sum()` over seedelf-wasm closures, which compile in seedelf-wasm and wrap.
- **Scenario:** A misreporting index inflates the lovelace of two of the user's real private UTxOs past a u64 together. `holding_enough` wraps and refuses a payment: "Not enough ADA in the Seedelf balance". The guidance tells the next developer this needs no check, for exactly the input `apart` now treats as possible. The impact is small, since a lying index can deny service anyway.
- **Fix:** "lovelace, which the ADA supply bounds for honest rows; a row's lovelace from an index is checked or summed in u128, as core's `apart` does".

### F6 (nit): Kept in mind still says mainnet has no token pools

- **Evidence:**
  - `docs/post-release-roadmap.md:396` (MERGED-1's mainnet limit) ends with "Mainnet has no token pools yet.", and `:385` says the same.
  - Mainnet now holds a pool of 5 ₳ boxes of ADA. It's in W's head start (`src/lovejoin-pools.json` mainnet, `dc6abe3b0b18…`), and 1.6.0 devices already hold it from the data layer, per the pools lane's x-upgrade#2 note.
  - The docs count an ADA pool at another amount among the token pools: privacy.md:195/199, and the policy's 26 October entry.
- **Scenario:** The owner reads `:396`, takes MERGED-1's mainnet limit as moot, and leaves it. A later 5 ₳ ADA launch on mainnet is now a possible copy, and with our server up a restored device can't find boxes in it.
- **Fix:** replace `:396`'s last sentence with "Mainnet's only pool beside the classic one is the 5 ₳ ADA pool (1.7.0's head start), so a copy of it is possible now". `:385` concerns token legs, so there "no pools of a token yet" is enough.

### F7 (nit): The archived 34g heading now reads as a release date

- **Evidence:**
  - `docs/archive/plans/chunk-34-token-pools.md:910` became "## 34g · The preprod rehearsal and the release (2026-10-18)". It was "(2026-10-18, in progress)".
  - The other steps' headings date when the step happened. Without "in progress", this one reads as the release's date, and that date is wrong: 1.6.0's PR #324 merged 2026-10-26.
  - Rule 7: docs never date a release.
- **Scenario:** A reader of the archive takes 1.6.0 as released on 2026-10-18.
- **Fix:** "(from 2026-10-18)", and the two anchors that link to it (`:9`, `:1497`).

### Outside my lens, where x-merge#0 meets the strings (nit, for the lead)

- **Evidence:** `lovejoin-launch.ts:250-254` now refuses a start of the values of a pool that is only on `lastListed`, with `lj.launch.copy` (`en.json:3142`): "A pool of these values exists already, and a copy would never be shown. Use that pool instead."
- **What goes wrong:** that pool isn't kept, so the start form, which lists the kept pools (`terms()`/`status.pools`), doesn't show it. While Koios is down or behind, or for good if the list lied (x-merge#0's accepted case), the user is told to use a pool they can't see.
- **flows.md:530 describes it accurately.** The wording is the issue: "Wait for it to show, then use it" would fit both cases.

## The original findings in this lens, on the merged tree

Each finding below is fixed as its lane says, unless a note says otherwise.

**docs-design**
- x-docs#1: flows.md:523, architecture.md:673, privacy.md:198.
- x-docs#2: listing row `:261`, merged box `:269`.
- x-docs#3, x-priv#4, x-scen#4, pr329#4, pr336#5: architecture.md:288, :733, :738.
- x-docs#4, pr329#5, pr331#5: development.md:13, and the workflow comment at `web-wallet.yml:153-155`.
- x-docs#5: the string, and flows.md:522.
- x-docs#8, x-merge#3, x-ui#5, x-scen#5, pr337#4: privacy.md:217.
- x-rel#1, x-priv#0, pr336#6: listing en/es/ja (`:75`, `:163`, `:227`), `:261`, `:269`, `:274`, `:334`; policy `:5`, `:40`; privacy.md:24; development.md:164. The policy's `:7` was left on purpose and explained. The root files were not in scope (F1).
- x-rel#5: development.md:145, :147, :149, :164.
- x-priv#1, pr336#3: disclosed in privacy.md:200, :203, the policy's `:46` and the 28 October entry. The code half is the owner's call.
- x-priv#5, x-scen#3, pr333#2.
- pr326#0–#5: the Tor entry. I checked its claims against `data-layer.ts`: `Part`, `txStatus` through `read()`, and submit on `submit`.
- The policy's dates (x-docs#10, x-rel#8, x-priv#6, pr336#8) and pr327#0 remain owner's calls. The 28 October entry was amended rather than added to; it's still unreleased.

**docs-roadmap**
- x-docs#0, x-merge#4, pr336#7, pr329#0, pr334#2, pr338#4: items 4–7 ticked, and five ✅ entries name what was built.
- x-docs#6, pr334#0, #1, #4, #5, #6, pr338#0–#3, #6, #7: the Leios entry, checked against the code references above.
- x-docs#9, pr329#6, pr329#7: archive. F7 is a new side effect of x-docs#9's edit.
- pr329#1: item 2, and the new Kept-in-mind entry.
- pr329#2: `tailReserve`'s `may` (`sessions.ts:4630`).
- pr329#3: parts.ts `GIVEME_BEHIND_MS` and the `refresh` early return, both checked.
- pr325#0, #1: roadmap.md.
- pr328#1: lock versions checked.
- pr335#1 is partly done: architecture.md:211 and flows.md's *Read the transaction* were optional and not done. They are not false.
- pr328#0 is recorded only, since `seedelf-data/` was off limits.
- x-rel#3 and x-rel#7 are the lead's: the stale e2e "Mainnet bundles none", the handoff note and the review folder.

**Other lanes' docs halves**
- pools (`lovejoin-pools.ts` header and comments); tail (flows.md:522, architecture.md:634, development.md:147); stepper (flows.md:369-371, architecture.md:173, privacy.md:34, parts.ts header); bootstrap; traps (architecture.md:53, roadmap item 3, including the open `claimSubmit` gap, still open at `sessions.ts:3203-3208`); rust (CLAUDE.md:94-96, `Cargo.toml`, wasm/README.md, roadmap); ci (development.md:13-14).
- Each matches the code, except for F3, F4 and F5.

## Not findings (checked)

- The privacy policy's 28 October entry and the "Effective" line are consistent with the code: `utxo_info`, `tx_info` and `account_update_history`, only for pools new to the device, and the starter's timing.
- With the data layer up, pool reads, and so the check, happen only when Lovejoin is in use: `withdrawDueNow` reads pools at unlock only when something is open (`lovejoin.ts:6186-6192`). So "Koios … can tell you use Lovejoin" is right.
- Kept in mind's "Reached … mainnet's once it holds 30 boxes" (#324's call 7) holds. Below the floor, the return can't build the mix whatever was reserved.
