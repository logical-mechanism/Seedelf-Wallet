# docs-2: the fix round's report

Doc-only findings, part 2, plus the live-run harness that x-release#2's "a live-run step that can pass" needs. Every claim written was checked against the code and the deploy logs first. No string keys touched. One new test (the live harness's guard). Nothing needs the WebAssembly package rebuilt.

## Findings

### x-privacy#2 and x-release#3: fixed
What giveme.my sees now names the session collateral's mix wherever a list reads as complete.
- **privacy-policy.md, services:**
  - giveme.my is "a collateral service for Seedelf and Lovejoin transactions".
  - Its bullet ends its list with "the one mix of a private session's 5 ₳ collateral in Lovejoin, which names the session's one-time account".
  - It groups "a session's funding with its collateral's mix and its Lovejoin boxes".
  - The Cardano server's bullet adds that, once a return is sent, it measures that mix before giveme.my witnesses it (lovejoin.ts tailWitness: evaluate, then witness).
- **The policy's date and entries are untouched.** The unshipped 18 October entry already records the change ("giveme.my lends that mix its collateral and sees it, and the Cardano server measures it first"), so nothing needed folding in.
- **privacy.md:** rule 7's ours-bullet, its Lovejoin line, and the Network section's "giveme.my sees every private transaction" bullet, the same way.
- **store/README.md:**
  - the alarms row adds a payment's next part, sent once the part before lands (parts.ts);
  - the Koios row adds the collateral mix's evaluation;
  - the giveme.my row and the merged host box say "Seedelf and Lovejoin" transactions.
  - The box stays within the dashboard's ~1,000 characters: 997 → 996 (I trimmed "API " and "about" → "of"). The stated totals are recounted by script (host rows 2,538 → 2,636).
- Test: none (docs).

### x-release#2: fixed
The release procedure (development.md) and the live harness it runs.
- **Token routes checked after the deploy.** Part 2's deploy note moves ahead of the package block and says "First … deploy the API", so it now matches step 7's "before the package".
  - A paste-as-is block (no placeholders, no `set -e`, no `path` variable, which zsh ties to PATH) curls `lovejoin/pools`, `lovejoin/tokens`, one `pool_history` and one `account_update_history` request. Each should print `200 application/json`.
  - The two public requests copy the wallet's exact query shape (koios.ts `poolHistory`, `delegationHistory`; the API refuses any other: history.rs and account.rs `q.exactly`). Their pool and stake address come from seedelf-data's own live tests (pool-history.json, live_public.rs).
  - A request with no Origin or Sec-Fetch-Mode passes the page guard (edge.rs `made_by_a_page`).
  - Step 7 points to these checks.
- **1.6.0 flows in the preprod checklist.**
  - Item 6 gains: a mix in the newer pools from each side; Four boxes a mix; a Bootstrap and Bring one back / Bring them all back; Start a pool's review (send one only to test a change); a swap into a token with a pool shown, with the collateral mix waiting on giveme.my; Bring every box back now; Max in parts.
  - The staking line adds Return on stake and Delegation history.
  - Item 1 and Part 1's block add the offline shapes harness (`cargo test --release --locked -p seedelf-wasm --test payment_parts_shapes_test -- --ignored`). It's the workspace's only test ignored as slow; every other ignored one is live Koios or a fixture recorder.
  - Item 1 also warns that a live run's restore can't know a Bootstrap's hold (HANDOFF's wallet A note).
- **A live run that can pass.** The harness had six knowable breaks. I fixed each against the component and e2e's own patterns:
  - **The network** (lib.mjs). The two-network build opened on mainnet. The harness now sets `seedelf.network` to preprod through the worker before a page opens, as e2e's `chooseNetwork` does.
  - **The mint's tag label** was stale since chunk 23 (`mint.tagLabel`).
  - **The payer cards are radios** (RadioCards) on the mint and on the removal. They're matched by `/^Public account/` and `/^Private balance/`, because a plain string would also match the other removal card's sub-line ("… to your public account …"), and Playwright's strict mode would throw.
  - **The Seedelf's card** (lib.mjs `seedelfCard`) is found by its "Copy the name of <tag>". The card's own line holds the tag inside a sentence, and its whole name is the CopyField's `data-value`; the card has no `title` any more.
  - **Remove sits behind Manage** (e2e 402).
  - **The vote button** reads "Change who votes for you" once delegated.
  - **The `all` preset's keyword**: chunk 14's rename made it `Seedelf`, which flows.mjs refuses. It's back to `seedelf`, with quoted keywords in the error messages.
  - I also stamped `all`'s tags per run (`live1-<4 chars>`). An earlier run leaves its first Seedelf, so a second `live-1` made `seedelfName` refuse and the card waits hit strict mode.
- **Test:** `extension/tests/live-runs-copy.test.ts` ("1.6.0's release review, x-release#2: the live runs"), four cases.
- **Fail-before**, on the unedited harness, each for its own reason:
  - `expected [ 'Personal tag (optional)' ] to deeply equal []`
  - `expected [ 'Change who votes for you' ] to deeply equal []`
  - `expected [ 'button', 'button' ] to deeply equal [ 'radio', 'radio' ]`
  - `expected [ 'Seedelf', 'Seedelf' ] to deeply equal []`
- **Mutation checks**, each hunk undone with Edit, the test failing, then put back:
  - M1, the old tag label: test 1 fails.
  - M2, the old vote pattern: test 2 fails.
  - M3, role `button` on the cards: test 3 fails.
  - M3b, radios with plain-string names: "Public account picks its own card alone" fails.
  - M4, `Seedelf` in the preset: test 4 fails.
  - M5, literal preset tags: test 4 fails on `[ 'live-1', 'live-2' ]`.
- **Not covered by a test** (checked by reading the components and e2e's patterns): the network pick, the Manage click, `seedelfCard` and the `data-value` read.

### x-release#5: fixed
- **Web wallet README:**
  - a new *After v1* paragraph: the newer pools, Start a pool (~23 ₳ never back, the docs' own "at most" figure), the earliest genuine pool of each box value, a session's tokens and its 5 ₳ collateral through Lovejoin, Bootstrap, Four boxes a mix, Bring every box back now, and private payments in parts;
  - the Staking bullet gains Return on stake (chunk 37) and Delegation history (chunk 36).
- **Extension README:**
  - the intro line, and the Settings row's Lovejoin settings;
  - Send (private) and Make public: Max over every UTxO, 20 a transaction, and payments in parts. Make public's row said "up to 20 UTxOs";
  - the Lovejoin row rewritten for the hub, a pool's page, Bootstrap, Bring every box back now and Start a pool;
  - Remove's entry point (behind Manage);
  - `npm run lovejoin-pools` in Scripts;
  - the live run's preprod pick.
  - A script check shows the layout now covers every source file, bar `env.d.ts`. Added: background `lovejoin-pools.ts`, `lovejoin-launch.ts` and `parts.ts`; screens `Delegations` and `LovejoinLaunch`; components `PoolAvatar` and `BringAllBack`; `ui/lovejoin-pools.ts`; `src/lovejoin-pools.json`; and `shared/fingerprint.ts`, a pre-1.6.0 omission.
- Test: none (docs).

### 310#0, 311#1, x-compat#1, x-release#6: fixed
The runbook's rollback note (seedelf-data/deploy/README.md, *Routine*) is rewritten to stay true across deploys, with no hard-coded `.prev`.
- **What a rollback costs, by route kind:**
  - On a public route, or the private index's, a 404 or 400 holds that whole part on Koios for 5 minutes (data-layer.ts `readFallback`; private-index.ts `failed`).
  - On the token pools' routes, neither holds any part (private-index.ts `get`: `TokensDown`). The wallet reads the pools' boxes from Koios and asks it what made its own, looks for new pools at Koios's holder, shows no crowds, and watches a token pool's chain through `tx_status`. Each of those is checked: lovejoin.ts `poolRows`, lovejoin-pools.ts `refresh`/`look`, feed.ts `fromFeed`, privacy.md *Lovejoin*.
  - A stable fact: #317 added the token routes, and #311's build (`304f1d16`) is the last deployed without them.
- **How to tell what `.prev` holds:**
  - `status` prints both sha256s, and each deploy run printed its build's sha256: in the *build* job's *Checksum* step, and in `DEPLOYED <sha256> (<old> kept as .prev)`.
  - So `gh run list` gives `.prev`'s commit.
  - A failed deploy leaves `.prev` as it was, and a rollback swaps the two.
  - Then `git diff <.prev's> <running> -- seedelf-data/api/src` shows what a rollback takes away. The routes are in `public/mod.rs`, `private.rs` and `lovejoin/routes.rs`.
- **A bullet sends the operator to the route checks after each deploy.** development.md's step 7 is narrowed to public routes for the 404/400 rule (x-compat#1).
- **Verified, by gh job logs:**
  - run 39982806550 at 68150b39: `DEPLOYED 3b03a0e9… (f948fc7f… kept as .prev)`;
  - run 38765078629 at 304f1d16: `DEPLOYED f948fc7f…`;
  - no run since 2026-10-23.
  - So `.prev` is #311's build, as HANDOFF says.
- Test: none (docs).

### x-release#8: fixed
- `data-layer.yml`'s paths gain `seedelf-core/src/constants.rs` and `extension/src/networks.ts`, which the `include_str!`s in api/src/constants.rs tests check.
- They also gain `extension/tests/fixtures/nft-images.json`. Its live test is #[ignore]d, but `cargo test`/clippy `--all-targets` compile it, so a move or a rename breaks CI.
- The exact set, by grep of every `include_str!`/`fs::read` in seedelf-data: no build.rs, no path dependencies. Six files outside seedelf-data are compiled in, and all six are now listed. Each listed path exists.
- Test: none (CI configuration).

## Files touched
- `.github/workflows/data-layer.yml`
- `seedelf-data/deploy/README.md`
- `seedelf-platform/seedelf-web-wallet/README.md` (the Staking bullet and a new paragraph; docs-1's docs-row edit is beside it)
- `seedelf-platform/seedelf-web-wallet/docs/development.md`
- `seedelf-platform/seedelf-web-wallet/docs/privacy.md`
- `seedelf-platform/seedelf-web-wallet/docs/store/privacy-policy.md`
- `seedelf-platform/seedelf-web-wallet/docs/store/README.md`
- `seedelf-platform/seedelf-web-wallet/extension/README.md`
- `seedelf-platform/seedelf-web-wallet/extension/e2e/live/lib.mjs`, `flows.mjs`, `run.mjs`
- `seedelf-platform/seedelf-web-wallet/extension/tests/live-runs-copy.test.ts` (new)

## Keys
None added or changed, critical or otherwise.

## Docs to update
- None left from my findings. The runbook needs no per-deploy edit now.
- The policy header's "updated for …" list doesn't name the collateral mix. It's left with the Effective date for the owner (x-privacy#4, x-release#4); one edit covers both.
- At the 1.6.0 upload, paste the changed store text into the dashboard: the alarms justification, and the merged host-permission box (996 characters).

## Calls the owner might overturn
- **The live harness was never run after these fixes.** Fixers can't send transactions. The owner's rule is never to hand over the first real run, so someone allowed to (the lead's release prep) should run `node e2e/live/run.mjs all` and `staking` on preprod before the owner relies on it. Each `all` run still leaves its first Seedelf (`live1-xxxx`, ~1.5 tADA locked) in the test wallet, as before.
- **Checklist item 6:** "send a start only to test a change to it" is my call. Each pool started shows to every preprod wallet for good.
- **The deploy check's mainnet pool and stake address** are seedelf-data's live-test ones (public, on chain). The owner may prefer their own pool.
- **The policy also gets one sentence on the Cardano server measuring the collateral mix** (line 45), beyond the finding's lines. It's the same omission, and its 18 October entry already says so.
- **`nft-images.json` in data-layer.yml** is a compile-only dependency. Drop it if it's noise.

## Notes for other fixers and the lead
- No test needs the pkg rebuilt.
- `npm run typecheck` fails only in `tests/lovejoin-crediting-review-fixes.test.ts(20,24)`: `'madeByMix' is declared but its value is never read`. That file is untracked, another lane's in progress, and the error held on a rerun.
- **After this round's deploy, `.prev` becomes 68150b39's build (`3b03a0e9…`).**
  - It has every route and request shape 1.6.0 calls. Since 68150b39, `public/` and `private.rs` are unchanged and `routes.rs` adds no route.
  - It lacks this round's data fixes: 317-data#0/#1/#2, 321-lj-rust-data#0, and deep-datum's shown-pool rule in `standard.rs`. Rolled back, the server could list a pool the fixed wallet's own check refuses.
- HANDOFF's release prep 5 (curl the token routes) is now development.md Part 2's block.

## Checks
- `npx vitest run tests/live-runs-copy.test.ts tests/store-images-copy.test.ts tests/words.test.ts tests/i18n.test.ts`: 4 files, 31 tests passed.
- `VITE_ENABLE_MAINNET=false npx vitest run tests/live-runs-copy.test.ts tests/store-images-copy.test.ts tests/words.test.ts`: 3 files, 7 tests passed.
- `npm run typecheck`: only the other lane's error above.
- `node --check` on e2e/live's three files: clean.
- Every anchor added resolves to a heading's slug (Python check). The store box and row lengths were counted by script against HEAD's 997 and 2,538.
- No formatter was run, and nothing was sent.
