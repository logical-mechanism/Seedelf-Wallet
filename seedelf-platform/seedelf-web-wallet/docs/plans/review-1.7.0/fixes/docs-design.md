# Docs-design lane: report

Tree `W` = `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-wt/release-1.7.0`, branch `web-wallet/release-1.7.0-fixes`. Nothing committed. Paths below are under `W/seedelf-platform/seedelf-web-wallet/`.

All docs findings were checked against the code as the code lanes left it (pools, tail, stepper, bootstrap, ci, traps, rust), not against HEAD. The docs-only findings need no test; each was checked against the code or test named below. I didn't touch the policy's dates, the `[profile.wasm-release]` lines (rust lane), or the roadmap outside the Tor entry (another docs lane edited it while I worked; my roadmap writes went through a compare-and-swap script, so its hunks are intact).

## Outcomes

| id | outcome | checked against | files |
|---|---|---|---|
| x-docs#1 | fixed (was UNVERIFIED, holds) | core `bootstrap_back_reserve` doc (1.5 ₳ at 4,310, 1.8 ₳ at 6,465); `seedelf-core/tests/lovejoin_pools_test.rs:1843` (`bootstrap_most(&dear, &classic, true, 96) == 96`); `tests/lovejoin-flows.test.ts:508` (`{ most: 96, back: "1800000" }`) | flows.md, architecture.md, privacy.md |
| x-docs#2 | fixed (was UNVERIFIED, holds) | `lovejoin-pools.ts` `refresh` → `confirm` → `confirmed` (`koiosAlone().utxoInfo`, then `launched`: `tx_info`, `account_update_history`) | store/README.md |
| x-docs#3 | fixed (was UNVERIFIED, holds) | same code | architecture.md |
| x-docs#4 | fixed: development.md here; the workflow comment by the ci lane (pr331#5) | ci lane's live read: `required_status_checks` `contexts []`, `checks []` | development.md |
| x-docs#5 | fixed by the tail lane (same change: `lj.tail.privacy.wayOut` now "The collateral's mix hasn't gone yet."); flows.md:522 now quotes it | tail lane's planner test "says the collateral's mix hasn't gone, never that giveme.my is what it waits for…" and collateral-held "names no cause of the wait in any language…" | flows.md |
| x-docs#8 | fixed | `skipCollateralMix` → `tailOver`; `offerAt = landed + TAIL_OFFER_MS` | privacy.md |
| x-rel#1 | fixed | as x-docs#2 | store/README.md (description en, es, ja; Koios row; merged box; :274; test instructions), privacy-policy.md (:5, :40), privacy.md:22, development.md item 9 |
| x-rel#5 | fixed | strings `tx.partOf` "Transaction {{n}} of {{total}}", `lovejoin.review.returnRest`, `lj.tail.skipped`; Lovejoin.tsx `PrivateReview` rows | development.md (checklist) |
| x-merge#3 | fixed (with x-docs#8) | as x-docs#8 | privacy.md |
| x-priv#0 | fixed, with the verifier's corrections: the merged box reworded and recounted, README:266's counts, Settings' `settings.koiosOnly.privacy.off`, development.md item 9; the proposed test dropped | as x-docs#2 | as x-rel#1, plus en/es/ja.json and es/ja provenance |
| x-priv#1 | partly: disclosed (its option (a)) so the unreleased 28 October entry is true for what ships; skipping Koios for the device's own launch is the owner's call (below) | `DiscoveryDeps` has no launch input; launches are only in the sealed Lovejoin record; the sent page and hub say the pool shows "about 10 minutes after its block" | privacy-policy.md (:46, the 28 October entry), privacy.md (:200, :203) |
| x-priv#4 | fixed: architecture.md :288 and :733; the comments were fixed by the pools lane; the test comment at `tests/lovejoin-discovery.test.ts:302` too | as x-docs#2 | architecture.md |
| x-priv#5 | fixed | as x-docs#1 and x-docs#8 | privacy.md, flows.md |
| pr336#3 | partly (same as x-priv#1) | same | same |
| pr336#5 | fixed: :733 trust model, :738 cost (rule 8); comments by the pools lane | `TXS_PER_REQUEST` 20, `REFS_PER_REQUEST` 60, `CREDENTIALS_PER_REQUEST` 75 (koios.ts) | architecture.md |
| pr336#6 | fixed: :5 and :40. :7 left as it is, as its impact verifier advised: it defines *the Cardano server*, and the confirm is a request to Koios by name, which :40 and :46 now say | as x-docs#2 | privacy-policy.md |
| x-ui#5 | fixed (with x-docs#8) | | privacy.md |
| x-scen#3 | fixed (was UNVERIFIED, holds) | as x-docs#1 | flows.md, privacy.md |
| x-scen#4 | fixed (was UNVERIFIED, holds); header comment by the pools lane | as x-docs#2 | architecture.md |
| x-scen#5 | fixed (was UNVERIFIED, holds) | as x-docs#8 | privacy.md |
| pr333#2 | fixed. "fewer at a dearer byte" became "one deposit's most, at a dearer byte too, fewer only where a deposit's fee would pass `MAX_FEE`'s 10 ₳" (core `build.rs:100`; the bootstrap lane's new test pins 51 at `min_fee_b` 2 ₳) | | flows.md, architecture.md |
| pr329#4 | fixed (with x-docs#3), with its verifiers' corrections: where the launch sits is now Koios's too (the pools lane's pr336#0), and the ledger sentence is kept as the backstop | | architecture.md |
| pr329#5 | fixed (with x-docs#4) | | development.md |
| pr331#5 | fixed (with x-docs#4) | | development.md |
| pr326#0 | fixed, with the verifiers' corrections: status checks are on the public part, not `submit` | data-layer.ts: `type Part = "public" \| "private" \| "submit"`; `submitTx`/`evaluate` on `submit`; `credentialUtxos`, `utxoInfo`, `usedStakeAddresses`, `accountTxs`, `txStatus` through `read()` (public) | post-release-roadmap.md (Tor entry) |
| pr326#1 | partly: (a) Koios added to the owed check and (c) "every route" narrowed are fixed; (b) is not a contradiction (its verifiers: the README line is from 2025 and may mean onion services), so it's cited as that, not as the answer | root README:162 | post-release-roadmap.md |
| pr326#2 | fixed | its verifier's run in Chrome for Testing 153 (`permissions.request` refuses `proxy`; warning "Read and change all your data on all websites") | post-release-roadmap.md |
| pr326#3 | fixed in its verifier's narrower form: the sense of "open" spelled out (tor-js's: it connects only to listed relays), not "open to anyone" | tor-js PROTOCOL §7, per its verifier | post-release-roadmap.md |
| pr326#4 | fixed | the clone at `8977093`: `crates/tor-js-wasm/Cargo.toml:43-44` (`rustls-rustcrypto = "0.0.2-alpha"`, `webpki-roots = "1.0.10"`), `src/lib.rs:445-460` (`with_root_certificates`); rustls 0.23.46 `with_root_certificates` → `new_without_revocation` (`~/.cargo/registry`) | post-release-roadmap.md |
| pr326#5 | fixed: both links canonical (each answers 200 with no redirect, checked by GET), the branch's wording; the clone isn't a doc defect (the doc never points at it) | | post-release-roadmap.md |
| pr327#0 | owner-call (no repo change; the finding's own fix) | this box: Node v24.19.0 (nvm), `NODE_OPTIONS` unset, and the finding's one-liner says G3 is trusted by the default store | none |
| x-docs#10, x-rel#8, x-priv#6, pr336#8 | owner-call: the dates left as they are | | none |

## What changed, by file

- **docs/store/privacy-policy.md** (no date touched)
  - *In short* (:5): Koios on mainnet also "to check each new Lovejoin pool our server lists".
  - Koios bullet (:40): even while ours answers, Koios is asked to check each new pool ours lists, and what made your boxes in a later pool (the copies' read, which the summaries had left out since 1.6.0).
  - *Lovejoin's pools* (:46): the check asks for the pool's outputs (its reference and two scripts), from the pools lane's new `utxo_info`. Also the starter's timing tell.
  - 28 October entry: adds the outputs (`utxo_info`) and the starter's case. "The same request for every wallet" becomes "for every device new to the same pools". "Before" now reads "on the blockchain, finished, and as listed". It's a data-handling change, so it's amended in the unreleased entry; no new entry was added.
- **docs/store/README.md**
  - Description: one clause in en, es and ja (blind back-translation needed, below).
  - Koios host row: the confirm, even while our server answers.
  - Merged dashboard box: "and two Lovejoin reads even while its server answers", now 998 characters (was 996).
  - :266's counts: 2,802 for the host rows (was 2,636), and 998.
  - :274: Koios "checks each new Lovejoin pool that server lists".
  - Test instructions: Koios "and to check a new Lovejoin pool it lists".
  - :289 (financial information) unchanged: the check sends nothing of the user's.
- **docs/privacy.md**
  - :22: Koios sees the IP on mainnet as it checks each new pool.
  - :135: a lock, a closed browser or an update wipes the waiting parts (stepper lane, x-upgrade#1).
  - :198: the Bootstrap's way back is at least 1.5 ₳, priced from the parameters (1.8 ₳ at 6,465); one deposit's most at a dearer byte too.
  - :200: the check now reads Koios's rows (`utxo_info`, `tx_info`, `account_update_history`). No pool read waits for it; the page's look and a pool's start do. The starter's timing tell.
  - :203: the starter's exception noted.
  - :217: the user's way out, *Bring the rest back now*.
- **docs/architecture.md**
  - :53: the alarm's chain sending and return look hand a trap on (`runAll`'s `unlessTrap`). `pump` hands it on before recording, so the chain reads `CHAIN_CUT`. Discovery's background check locks the wallet itself (`DiscoveryDeps.wallet`).
  - :173: a lock, a closed browser or an update. The watch is sealed only while it may still go through; one Koios took isn't, so after a wipe nothing says the rest didn't go.
  - :288: `lovejoin/pools`' new pools are confirmed with Koios.
  - :634 (way out): the `cut` rule, `serial`, `lj.tail.skipped`, the press's own request vs `reviewAfterSkip`.
  - :673: the Bootstrap cap.
  - :733: the trust model rewritten to the pools lane's code. A new pool's on-chain status, L, datum, scripts' places and launch place are Koios's. Only "listed" and the crowds are the server's word. `checking`, `lastListed` (x-merge#0), head start and pre-1.7.0 pools (x-upgrade#2), and the ledger backstop.
  - :738: the check's Koios cost.
- **docs/flows.md**
  - :369: the stepper never stands past the last, shows nothing of one part while the next is read, and opens on the first for a review built again (stepper lane).
  - :370–371: the parts after a wipe (stepper lane).
  - :522: the way out, worded to the tail lane's code and strings.
  - :523: the priced reserve, the stale 68 dropped, the review row.
  - :530: a start of a listed, unconfirmed pool's values is refused as a copy at Review (x-merge#0).
- **docs/development.md**
  - Branching: when the check runs (a renamed file's old path, more than 3,000 files, a base other than `main`), and "the one for `main`'s branch protection to require; requiring it is the owner's step (1.7.0's item 2), and until then a red or running check doesn't stop a merge". Plus the ci lane's pr331#6 line: a PR that edits `web-wallet.yml` decides its own green.
  - Checklist:
    - the private Bootstrap's *For returning the rest* reads 1.5 ₳ at today's parameters;
    - a new way-out line (giveme.my blocked, the hour, the three pages, "You chose not to wait…", Mix my boxes again moves it);
    - Max's line: Transaction details steps through each ("Transaction 1 of N"), as a Lovejoin mix's review funded in parts does;
    - item 9: `api.koios.rest` also to confirm each pool the data layer lists that the head start doesn't hold (`utxo_info`, `tx_info`).
- **docs/post-release-roadmap.md**, the Tor entry only (#326's findings):
  - the spike's branch wording, and the shape's public-part reads;
  - canonical links;
  - "open" in tor-js's sense, and the alpha TLS provider with no revocation check;
  - `proxy` can't be optional (the all-sites warning, whole-browser PAC, one extension at a time, policy proxies), and Koios can't be split by host;
  - Split needs the parts split by side, and holds only while every part answers;
  - Koios added to the owed check, with the README's 2025 lines read as maybe onion services;
  - "never banned, as long as Koios takes Tor exits".
- **extension/src/i18n/translations/{en,es,ja}.json** and **docs/i18n/{es,ja}-provenance.json**: `settings.koiosOnly.privacy.off`, below.

## Strings

- **Changed (en, es, ja): `settings.koiosOnly.privacy.off`** (critical, `.privacy.`). It said Koios answers "only when it can't", which #336 made untrue; x-priv#0's impact verifier named it.
  - en: "Seedelf Wallet's own server answers first, and Koios when it can't. The wallet also asks Koios about each new Lovejoin pool. What the wallet reads tells neither of them which Seedelfs are yours."
  - es: "Responde primero el servidor propio de Seedelf Wallet, y Koios cuando este no puede. La billetera también consulta a Koios sobre cada pool nuevo de Lovejoin. Lo que lee la billetera no le revela a ninguno de los dos qué Seedelfs son tuyos."
  - ja: "まず Seedelf Wallet 自身のサーバーが応答し、応答できないときは、ウォレットが Koios を使います。新しい Lovejoin のプールについても、ウォレットは Koios に問い合わせます。ウォレットの問い合わせからは、どちらも、どの Seedelf があなたのものかは分かりません。"
  - Provenance in es and ja went from `mtpe` to `machine`, since the new drafts haven't been checked value by value. The key is still listed by name in `verified-critical-{es,ja}.json`, which I didn't touch, so no test fails. **The lead needs a blind back-translation of both**, then to record it and set `mtpe` back if that's the house's practice.
  - Old wordings were grepped in tests, e2e and scripts. Only `e2e/data-layer.spec.ts:71` reads this line ("Seedelf Wallet's own server answers first"), and that prefix is unchanged.
- **The store listing's description changed in es and ja** (store/README.md's rule: "back-translate what changed"). For the lead's blind back-translation:
  - es (:163): "…o para todo si desactivas el nuestro en Configuración; además, comprueba cada pool nuevo de Lovejoin que el nuestro incluya en su lista."
  - ja (:227): "また、私たちのサーバーが一覧に載せた新しい Lovejoin のプールは、どれも Koios で確認します。"
- No other UI string added or changed. No e2e spec edited. No WebAssembly node test added. No code or code comment changed by me.

## Owner's calls (one line each)

1. **The policy's dates** (x-docs#10, x-rel#8, x-priv#6, pr336#8): date the *Effective* line and the 28 October entry the release PR's merge day, as 1.6.0's were (ef6af2bc). This round amended that entry (`utxo_info`, the starter's timing), so its words now land with the release PR. If that merges on 28 October (the owner's time), nothing changes.
2. **The starter's Koios tell** (x-priv#1, pr336#3): ship 1.7.0 with the disclosure now in the policy and privacy.md. In a follow-up, confirm a pool this device launched from its own sealed launch record (the launch's own outputs) once the data layer lists it, not with Koios. That drops the tell with no new guard and nothing read sooner, and the policy line then goes.
3. **Node's CA store at the release refreshes** (pr327#0): the release prep's `npm run tokens`/`dreps`/`lovejoin-pools` already ran here on v24.19.0, which trusts emSign ECC Root CA - G3. Re-run all three with `NODE_OPTIONS=--use-openssl-ca` (or after `nvm install 24 && nvm alias default 24`) and confirm the committed diffs come out byte-identical, but for the `recorded` date. The DRep diff is small (one name dropped, "BankFi"; two added), with no renames. Whether development.md's step 1 should name that: yes, one line, recommended.
4. **The tor-js clone** (pr326#5): it's in another session's `/tmp` scratchpad (`…/6b05df79-…/scratchpad/dl-torjs/tor-js`) and goes at a reboot. The doc pins `8977093`, which GitHub serves, so keeping a copy is optional.

## Notes for the lead

- **Outside this lane, same summary:** the root README (:164, :214) and the root CLAUDE.md still say mainnet reads Koios "for any part it can't answer", with no word of the pools check. :164 is in the IP-tracking section, so it's worth a clause, optional.
- **Not added:** the ci lane's optional retarget line ("after changing a PR's base, push to it…"). Its effect is narrow now that any base but `main` always runs the check.
- **Bootstrap lane's note:** the roadmap's "51 of LJTEST" (:378 at the time) is the docs-roadmap lane's file area, not touched here.
- **Tests run** (one file at a time, all pass): `i18n` 24, `i18n-critical-helpers` 62, `i18n-assembly` 17, `words` 2, `privacy-notes` 10, `preferences` 8, `i18n-screens` 14. `npm run typecheck` is clean. No test reads the docs' text (grepped tests, scripts, e2e and wasm tests).
- **Scratch:** the roadmap edit script is `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/05f6bfd5-2a41-438b-a382-7de3ba344983/scratchpad/fix/docs-design-tor-edits.py` (not for commit).
