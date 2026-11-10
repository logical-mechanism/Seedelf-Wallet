# 1.9.0 gate review: the fix brief

You are one fixer in the fix round of Seedelf Wallet 1.9.0's gate review. The owner asked: "fix what is worthy, then commit and push."

The review's findings are in `R/FINDINGS.md`, which the lead wrote. Your lane fixes its own items in its own worktree and commits on its own local branch. The lead merges the lanes, has the merged diff reviewed across areas, and pushes. **Never push.**

`R` = `/tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/6637f822-1e93-462d-9b5e-5bd103fc4b4b/scratchpad/review-1.9.0`.

Also read:
- `R/COMMON.md` for the background, the owner's rules and the limits;
- `R/find-full.txt` and `R/verify-full.txt` for each finding in full, with the probes' paths.

## Your worktree

**The base is `8d7c4b0c`:** `origin/web-wallet/release-1.9.0`, PR #378.

**The main tree is off-limits.** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet` is detached at the base. Never edit, build, stage or commit in it. Never touch another session's worktree.

**Setup:**
- `git -C /home/logic/Documents/LogicalMechanism/Seedelf-Wallet worktree add -b review-1.9.0/fix-<lane> R/fix/<lane>/tree 8d7c4b0c`
- Symlink `seedelf-platform/seedelf-web-wallet/extension/node_modules` to the main tree's.
- Copy the main tree's `seedelf-platform/seedelf-web-wallet/wasm/pkg` in. It is the base's Rust as built. No lane changes Rust runtime code, so it stays right.
- **Cargo:**
  - Run it from your worktree's `seedelf-platform/`.
  - Use `CARGO_TARGET_DIR=$HOME/.cache/seedelf-review-1.9.0/target-fix-<lane>` (seed it with `cp -r` from an existing `target-*` there) and `-j 4`.
  - Run it under `systemd-run --user --scope -p MemoryMax=8G --`.
- **Vite and Playwright** are allowed in your worktree only:
  - `npx vite build` (CI's build:ext);
  - the store build with `VITE_ENABLE_MAINNET=true VITE_STORE_BUILD=true npx vite build`;
  - never package.mjs, `npm run build`, `npm ci` or `wasm/build.sh`;
  - run Playwright under `xvfb-run -a`, with the same 8G cap.

**When you're done:**
- Stage by path only (`git add <files>`, never `-A` on a folder) and commit on your branch with the message `review-1.9.0 fix: <lane>`. The lead rewrites the history.
- Don't remove the worktree: the lead merges from your branch.
- Unlink the node_modules symlink before you finish, so nothing writes through it later.

## Rules

- **Test first.**
  - A behaviour change: write the test, see it fail on the base, then fix it and see the test pass.
  - A test gap: show that the new test passes on the base and fails under the mutant it's meant to kill. Apply the mutant in your worktree, run, then restore with `git checkout -- <file>`.
  - Put the evidence in your report.
- **Fix the findings, and only them.**
  - No drive-by refactors and no formatter (there's no prettier config; match the file, about 120 columns).
  - Cite findings the house way, in comments and test names where it helps: "(1.9.0's release review, cross#1)".
- **The owner's rules:**
  - UI text stays short.
  - Always "Seedelf" and "Seedelf Wallet" in what the wallet shows.
  - No module-level `t()`.
  - Refuse only what the ledger or the contracts refuse.
  - No release dates or store status in docs, and no release notes.
- **Limits:**
  - Finite input only, never `yes |`.
  - Never open `extension/e2e/support.ts` or `seedelf-crypto/tests/vectors/*.json`: the environment refuses them. Derive the test account's keys in code from the public "abandon … about" phrase, as the probes do.
  - No network, except what your lane says.
- **Stay in your lane's files** (the table below). If a fix needs a change in another lane's file, say so in `notes_for_lead` and don't make it.

## Who owns which files

Paths are relative to `seedelf-platform/seedelf-web-wallet/` unless they start with `seedelf-platform/`.

| Lane | Files |
|---|---|
| **words** | `extension/src/i18n/translations/{en,es,ja}.json`, `extension/src/ui/screens/DappApprovals.tsx`, `extension/tests/dapp-prompt.test.ts`, `extension/e2e/extension.spec.ts`, `docs/i18n/{es,ja}-provenance.json`, `docs/i18n/critical-keys.json` (regenerated only, by `node scripts/i18n-critical.mjs --write` from `extension/`) |
| **rust** | `wasm/tests/cip30_test.rs`, `wasm/tests/session_test.rs`, `wasm/src/cip30.rs` (comments only), `seedelf-platform/seedelf-core/tests/orders_test.rs`, `seedelf-platform/seedelf-core/src/orders.rs` (comments only) |
| **swaps** | `extension/src/background/minswap.ts`, `extension/src/background/sessions.ts`, `extension/tests/swap-routes.test.ts`, `extension/tests/sundae-orders.test.ts`, `extension/tests/order-cancel-check.test.ts`, one new `extension/tests/*.test.ts` if needed |
| **views** | `extension/src/background/tx-view.ts`, `extension/src/ui/components/TxDetail.tsx`, `extension/src/ui/screens/Swaps.tsx`, `extension/tests/tx-view.test.ts`, `extension/tests/tx-view-screen.test.ts` |
| **docs** | `docs/architecture.md`, `docs/flows.md`, `docs/privacy.md`, `docs/backlog.md`, `docs/releases.md`, `docs/plans/chunk-46-verification-on-upstream.md`, `wasm/README.md` |

The lead alone writes `docs/i18n/verified-critical-{es,ja}.json`, after a blind back-translation of the words lane's es and ja. Don't list a key there yourself: it would record a check that never happened.

## The sign window's new English (decided by the lead)

Why: real Indigo CDP and staking actions get the release row, the "your own order or listing … doesn't come back to you" callout and the switch, over the whole position plus Indigo's shared UTxO, up to 520,005 ₳. No safe exemption exists: an honest reprice and an attacker's relist render byte-identical windows. So the words must be true for honest re-creations and still stop the bounty's victim: someone tricked into a "cancel" expects the money back.

| Key | New English |
|---|---|
| `dappUi.warn.contractRow` | From a contract, not to you |
| `dappUi.warn.contractAck` (the switch) | I expect this not to come back to me |
| `dappUi.warn.contractYours` | Your signature releases funds from a contract that names your key. They may be yours, and they don't come back to you. |
| `dappUi.warn.contractMaybe` | unchanged |
| new, for an unfound input when `keyReleases` is set (L3) | the first sentence of `dappUi.warn.unknownInputs` alone, without "Only your stake key signs here.". One: "It spends {{count}} UTxO the wallet couldn't find, so what it holds can't be shown." Other: "It spends {{count}} UTxOs the wallet couldn't find, so what they hold can't be shown." Name it with `.warn.` |
| `dappUi.note.contractInputs*` → `dappUi.note.warn.contractInputs*`, and `dappUi.note.contractInputsTokens*` → `dappUi.note.warn.contractInputsTokens*` (L11) | English unchanged except U+00A0 before ₳ (i18n#5). The new name makes them critical, since they're the only signal in the documented limits |

## The lanes

### words

**Findings:** M1 (cip30-rust#1, dapp-ui#2, i18n#1, i18n#2), L5 (i18n#3 and the blind check), L3 (cip30-rust#4), L11 (i18n#4), i18n#5, and mutants#3's e2e.

1. **en:** as in the table.
2. **es and ja:** redraft the row, the switch and contractYours. Write the new unfound-input key: reuse the first sentence of each existing `unknownInputs` value exactly, if it stands alone. Rename the notes: U+00A0 before ₳ in es and ja too; in ja, also fix what the blind check flagged. The constraints:
   - **The switch** must read as the user's own expectation of what happens ("this is what I meant to happen"). Never as acknowledging what they were told ("I know", "I understand"), and never as a hope: round one read "Espero" as "I hope".
   - **Japanese** must be in a first-person form. The current 想定どおりです can read as the wallet saying "this is normal".
   - **Negations:** keep every one, matching `tests/i18n.test.ts`'s NEGATED lists.
   - **Length:** short.
   - **The blind check's other notes:**
     - es "liberar una orden" has an ERP sense, "approve an order for execution";
     - ja notes' 使用します reads as "uses", not "spends";
     - 保持額は X ₳ とトークンです is unnatural.
3. **DappApprovals.tsx:**
   - `s.keyReleases` picks the new unfound-input key; without it, the old one stays;
   - the notes' new keys;
   - nothing else.
4. **Provenance:** in `docs/i18n/{es,ja}-provenance.json`, an entry for every new or renamed key, labelled as `docs/i18n/glossary.md` says.
5. **The critical set:** `node scripts/i18n-critical.mjs --write` from `extension/`. `tests/i18n.test.ts`'s "no unchecked machine draft" will fail for the new and renamed keys until the lead lists them after the blind round. That's expected; report it, and don't work around it.
6. **Tests:**
   - `dapp-prompt.test.ts`: the new words; contractYours without "your own order or listing"; with `keyReleases` and an unfound input, no "Only your stake key signs here"; without `keyReleases`, it stays.
   - The e2e: rewrite `extension.spec.ts`'s step "A yes is for one request: the next starts over" (about 5870-5878), which can't fail, into the queued form: both requests in one window, as in `R/v-e2e-queue/probe-e2e-queue.ts.txt`. Add the verifier's three changes:
     - decline the second request and await it;
     - wait for it to show before reading the switch;
     - assert that no new view=dapp page opens and that Enter signs nothing, then that the switch enables Sign.
   - Update every assertion of the old switch or row words. Grep the key names and regex forms (`n.t`).
7. **Run:**
   - the i18n guards (i18n, i18n-critical-helpers, words, i18n-worker-reasons, i18n-values-in-place, i18n-screens) and dapp-prompt;
   - `npx tsc --noEmit -p .`;
   - the #373 e2e on the dev build, then on the store build, each with `taskset -c 0,1 xvfb-run -a npx playwright test --project=extension -g "<its title>" --repeat-each=4 --workers=4` under the cap.
   - Prove the rewritten step fails under mutant m (DappApprovals.tsx `const ack = ackFor !== undefined;`), then restore it.
8. **Report** in `changed_strings` every new or changed key's en, es and ja values: the lead sends es and ja, without the English, to blind back-translators.

### rust

**Findings:** mutants#1, #2 and #5; cip30-rust#7; cross#3; mutants#6 and z5; v4-orders#2; two comments.

**`cip30_test.rs`:**
- **Tests from `R/mutants/cip30_test-additions.diff`,** given real names:
  - a required signer under a Plutus-shaped body (script data hash set) is key-released and counts what's released (mutant f);
  - a datum naming the key, inline, under a Plutus-shaped body (mutant e);
  - the account's own token of the same kind doesn't hide a contract's (mutant d);
  - a stranger's key input isn't a contract input (mutant z1).
- **cip30-rust#7's probes, from `R/cip30-rust/review_cip30_rust_test.rs`:**
  - r2: an unfound input with the stake key as required signer gives `key_releases`, released 0 and one unknown;
  - r3: a DRep required signer with governance;
  - r6: a non-canonical datum carried, in a tagged set and in a plain list;
  - r7: the real Minswap V1 cancel in `seedelf-platform/seedelf-core/tests/fixtures/cancel_integrity.json`, whose carried hash is the order's datum hash, with `contract_inputs` 1.
- **cross#3, in `cip30_test.rs` or `session_test.rs`:** a release read through a private session's keys. Re-key a real order fixture to a session, as `R/cross/cross_review_test.rs.txt` does. The wallet's own cancel then reads `key_releases` true and released 0.

**`orders_test.rs`:** an "another second module" variant (kills z9), and a constraint entry of three items (kills z5: `pair.len() == 2` → `!pair.is_empty()` in `fills_once`). See `R/mutants/orders_test-additions.diff`.

**Comments, which change no runtime code:**
- `orders.rs:20-23` and `orders_test.rs:4-5`: V4's facts were read on 2026-11-09, from Sundae's SDK and one real owner cancel; its validators are unpublished.
- `cip30_test.rs` near 2410: "With the hash, a script runs" is wrong. A datum alone gives a body a script data hash.
- `cip30.rs` near 1827: "A required signer is what a Plutus script can see" is too narrow. A script also sees withdrawals, certificates and votes.

**Proof:** each new test passes on the base and kills its mutant. `R/mutants/mutate.py` defines d, e, f, z1 and z9.

**Run:**
- `cargo fmt --check -p seedelf-wasm -p seedelf-core`;
- the touched test files;
- `cargo clippy -j 4 -p seedelf-wasm -p seedelf-core --tests -- -D warnings`.

### swaps

**Findings:** L8 (routes#1 and its 404 neighbour), mutants#4, routes#3.

**L8:**
- The fix is `R/v-routes/fix-routes1b.diff`:
  - trouble codes `name-refused` (400, `/exclude_protocols\/\d+ must be equal to constant/`) and `no-route` (404, `/^quote not found\.?$/i`) in minswap.ts;
  - `routeOf` keeps `first` when the second ask fails with either;
  - `MINSWAP_REASON` entries.
- Tests first, from `R/v-routes/v-reask-400.test.ts` and `v-reask-404.test.ts`, into `swap-routes.test.ts`:
  - the quote refuses in the wallet's own words;
  - the runner pauses with `nowRoutes`;
  - Stop works;
  - a 429 or a 5xx still throws and retries.
- **Keeping `first` also covers a re-ask that `outOfPlace` asked for:** a path of more than one leg, or Danogo beside another DEX. Trace and test that this case still ends in a refusal or a pause in the wallet's words, never a funded order through a leg the session can't check or cancel.

**mutants#4:** a behavioural mainnet pin for routeOf's network in swapBuild and in order(), from `R/v-routes/v-routeof-mainnet-runner.test.ts`. Prove it kills z6 and z7 (`R/v-routes/z6z7.diff`).

**routes#3:** V4's Stop, its restore-scan find and its fill, from `R/routes/review-v4-stop.test.ts`, into `sundae-orders.test.ts` or `order-cancel-check.test.ts`.

**Run:** tsc, then swap-routes, direct-swaps, order-cancel-check, sessions, sundae-orders, swap-quote-ask, restore-scan, swap-order-open, minswap-refusals and splash-remnant.

### views

**Findings:** L6 (dapp-ui#3), L7 (cross#1), dapp-ui#4.

**L6:** markYours marks each account's DRep key, for the active account and for each known one. Derive it as `background/dapp.ts` publicKeys does, with `JSON.parse(cardano.drepOf()).hash`. Mark it unconditionally: it is the user's key, and the window's governance rule is about what the wallet signs. Test first.

**L7:**
- TxDetail gets a `lookedUp` prop. It picks `tx.privacy.inputsHintSite` without switching the signatures row to the site's text; `site` implies it.
- Swaps.tsx's `session-tx-detail` passes it when the review spends inputs the session doesn't hold: a cancel's orders, or a swap against a DEX's pools. Read how `inspect` decides `others`, at sessions.ts about 4340-4365.
- Correct `tx-view-screen.test.ts`'s comment near line 96.
- Test both reviews, and an order swap's, which keeps "the wallet asks nobody".

**dapp-ui#4:** in `tx-view.test.ts`, make a session's stake key and Account 2's stake key required signers, and check both are marked.

**Run:** tsc, then tx-view, tx-view-screen, dapp-prompt, and every test file that renders TxDetail or Swaps' review.

### docs

**Findings:** M1's class, L2, L3, L4, L7, L8 and L9 in the docs, the routes cost line, cross#4, docs-prep#3, docs-prep#4, and the backlog. The fixes themselves are decided above, so describe them as they will be. Write in the docs' own voice: short, no dates for releases, no store status.

**`architecture.md`, the contract-UTxO paragraph (about 563):**
- the new words;
- the class of honest requests that get the row and the switch:
  - a position's top-up, withdrawal, repay or close;
  - staking positions;
  - shared-state UTxOs a dApp re-creates under the user's key (Indigo's);
  - partial cancels and withdrawals;
  - any repayment, whatever the net;
  - a position or auth token the transaction burns;
- why the class can't be narrowed: an honest reprice and a relist under another owner's datum are the same window, and a datum naming the key proves nothing (any 28 bytes);
- **the limits:**
  - the native-script clause's trigger is any script data hash, which a site gives a body with one datum alone, no Plutus;
  - the owner-proof limit covers any proof that isn't a required signer (the owner's input, a withdrawal, a certificate, a vote), with the datum kept by hash and withheld;
  - the fee credit: up to 10 ₳ of fee comes off what's released. A contract holding up to 10 ₳ burnt as fee shows only the note and the fee row, and above that the row is up to 10 ₳ short;
  - an unfound input under a key that releases gets the couldn't-find line without "Only your stake key signs here".

**`architecture.md`, swaps:**
- the trust line (about 646): V4's `max_per_execution` is the fee a fill takes whole, where V3's is a ceiling. The DEX's fee, like the minimum, is what Minswap writes, bounded only by `withinFunding`;
- the cost line (about 660): routeOf's re-ask covers a DEX the wallet doesn't check, too;
- about 665-669: when Minswap refuses the second ask (a name its validator refuses, or no route left), the first answer stands, so the quote is refused and the runner pauses, in the wallet's words.

**`flows.md`:**
- about 430: the window's new words and the class;
- Transaction details (about 262 and 275): the session's own cancel review, and a swap against pools, look up what the session doesn't hold and say so.

**`privacy.md`:** about 186, the direct swap's review looks up the pool UTxO and Minswap's collateral UTxO. This is existing behaviour newly stated: nothing new is sent, so no policy entry.

**Small fixes:**
- `wasm/README.md:92`: inspectDappTx's seven new fields.
- `releases.md:50`: the chunk 44 link goes to `archive/plans/`.
- `plans/chunk-46-verification-on-upstream.md`: make the status line (5), the table row (17) and step 1's last sentence agree with the plan's own steps. Change nothing else.

**`backlog.md`:** one line each, in the right section, in the house format (`- ⬜ **Title** (1.9.0's release review, id): …`):
- the burn credit (L1, with the guarded rule: only the burn beyond the account's own net put-in and the found strangers' inputs of that asset, and none when an input wasn't found);
- L2's two no-request code options;
- holding V4's cap to the approved DEX fee (L9);
- M1's optional "goes back to the same contract" info row;
- the datum scan's memo (cip30-rust#5);
- a key split across byte-string chunks (#8);
- contract token totals in u128 (#9);
- markYours' cost on every private spend (cross#2);
- the worker checking the switch itself (dapp-ui#1).

Also update the line "A DEX name Minswap stops taking fails every swap's quote": routeOf's second ask now keeps the first answer when refused.

**Run:** a relative-link check over every file you touch.
