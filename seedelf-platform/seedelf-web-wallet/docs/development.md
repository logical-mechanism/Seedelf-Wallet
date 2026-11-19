# Development

How we build, run and test the extension, and how a release goes to the Chrome Web Store. The last two sections are about Lace, the wallet we read for patterns, and the decisions the wallet is built on. The extension lives in [../extension/](../extension/); its README lists every script.

## Branching

**The web wallet lives on `main`.** `seedelf-web-wallet`, the long-lived dev branch it was built on, is merged and finished.

**Feature branches and PRs:**

- **Start every feature branch from `main`** and name it `web-wallet/<topic>`. Keep the prefix: it reads well in the log, and it's what tags use.
- **Open PRs into `main`.**
  - CI ([web-wallet.yml](../../../.github/workflows/web-wallet.yml)) runs on every pull request, into any branch. Its check runs when the PR touches a file under `seedelf-platform/` that isn't Markdown or in the web wallet's [media/](../media/); touches `wasm/README.md`, which a test reads, any workflow or `seedelf-verification/test-tools.sh`, which `extension/tests/workflows.test.ts` reads, or the Lovejoin scripts' `.hex` files in `seedelf-verification/Lovejoin/`, which a Rust test includes; changes more files than the API lists (3,000); or goes into a branch other than `main`. A renamed file counts by its old path too. A PR that changes only the data layer's Rust doesn't run the check: [data-layer.yml](../../../.github/workflows/data-layer.yml)'s *No Markdown included* step makes the one check of that Rust that `workflows.test.ts` makes. The check is five jobs side by side: Rust, the WebAssembly, and on that WebAssembly the extension's unit tests, end-to-end tests and store package. Its last job, **Web Wallet required**, always reports: green when every job passed, or all were skipped because the PR touches nothing they cover. `main`'s ruleset requires that job, with no bypass, so no merge lands while the check is red or still running, and no path filter can leave a PR waiting on a check that never comes. No approving review is asked while the project has one maintainer.
  - A PR that edits `web-wallet.yml` runs its own copy of it, so it decides its own *Web Wallet required*: read that diff before trusting the green.
  - A push runs it only on `main`, after a merge, so go through a PR even for a docs change: one that's only Markdown skips the check and goes green at once.
  - **Merge only once its check is green on every job,** never while it's still running. `main` runs the check again after each merge, which keeps the caches every PR's first run starts from, but a red there only shows after the fact, once the tree is already on `main`.
- **Never name a branch `web-wallet/<x>.<y>.<z>`** — that's the tag namespace (`web-wallet/1.0.0`), and a branch and tag sharing a name makes `git checkout` ambiguous.

**The old branch:**

- **Don't start new work on `seedelf-web-wallet`;** it's finished and far behind `main`, and can be deleted whenever.

**Shared Rust code:**

- **Changes to shared Rust code that only the web wallet needs go through a `web-wallet/<topic>` branch into `main` too.** The builder extraction is the main example.

**The work happens in chunks:** a number, a branch, and a plan in [plans/](plans/) while it's built. When one lands, what still holds moves into the design docs ([architecture.md](architecture.md), [flows.md](flows.md), [privacy.md](privacy.md), [keys-and-accounts.md](keys-and-accounts.md), this file) and the plan to `docs/archive/plans/`, so `plans/` holds only live specs, beside [plans/release-records.md](plans/release-records.md), the releases' records; [plans/README.md](plans/README.md) has the rules. What could come next is in [backlog.md](backlog.md), and what each release carried in [releases.md](releases.md).

## Running it in Chrome

Chrome runs an extension straight from a folder once developer mode is on. There is no store and no packaging.

1. Build it: `cd seedelf-web-wallet/extension && npm install && npm run build`. This builds the Rust core to WebAssembly and then the extension into `dist/`. Every build has both networks: mainnet by default, with preprod on the welcome screen and in Settings (see [architecture.md](architecture.md#networks)). A wallet from before the switch stays on preprod. `VITE_ENABLE_MAINNET=false npm run build` makes a preprod-only build.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `dist/` folder.
4. Pin the extension, then click its icon: the wallet opens in a tab, or in the side panel once Settings says so.

After a rebuild, click the reload arrow on the extension's card. `npm run dev` rebuilds `dist/` on every change, but you still reload the extension by hand.

- **After packaging, build again.** `npm run package` and `npm run package:preprod` write a store build into the same `dist/`: it has no dev key, so Chrome gives it another ID, with empty storage, and `package:preprod`'s has preprod alone, so the welcome screen has no network to choose and every wallet is a preprod one. Run `npm run build` before loading or reloading `dist/` for everyday use.

- **If `dist/` is rebuilt and the extension isn't reloaded** (after a package, say): Chrome keeps running the old service worker, which asks for the old WebAssembly file. Each build gives that file a new hashed name and deletes the previous one.
- The wallet then shows **"The wallet couldn't start"** with **Reload the extension**, which does the same as the reload arrow.
- The name is hashed on purpose. A stable name would let an old worker load a new module that its glue code doesn't match.

**Debugging:**

- **Service worker:** click the "service worker" link under *Inspect views* on the extension's card.
  - That DevTools window shows the worker's console and network calls.
  - It also shows its storage, under **Application → Extension storage**.
- **Side panel:** right-click inside the panel and choose **Inspect**.
- **Full tab:** use normal DevTools.

**Gotchas:**

- **The extension ID is pinned.** Chrome normally derives an unpacked extension's ID from its folder path, so moving the folder would give a new ID with empty storage. The dev `key` in `extension/src/manifest.ts` fixes the ID at `jfekiogplaamnceifeehipmomhojngcb`.
  - Web Store builds leave the key out (`VITE_STORE_BUILD=true`, which `npm run package` sets), because the store assigns its own ID.
  - The end-to-end tests read the ID from the service worker's URL, so they pass on either build.
- **Removing the extension deletes its storage,** including the vault. Keep the test wallet's phrase somewhere.
- **Startup warning:** Chrome may warn about developer-mode extensions at startup. That's expected.

## The data layer, locally

On mainnet, every build reads Seedelf Wallet's own data layer first ([architecture.md](architecture.md#chain-data)): `https://mainnet.seedelf.logicalmechanism.io`, which answers the store's ID and the dev build's. So a plain `npm run build` reads the live server, and its worker's network panel shows `mainnet.seedelf.logicalmechanism.io` where the list below says `127.0.0.1:8099`. A dev build can read a local API instead:

1. **Run the API** from `seedelf-data/` ([its README](../../../seedelf-data/README.md)) with the dev build's pinned ID allowed: `DATA_ORIGINS=chrome-extension://jfekiogplaamnceifeehipmomhojngcb cargo run -p seedelf-data-api`. It listens on `127.0.0.1:8099`.
2. **Build against it:** `VITE_DATA_ORIGIN=http://127.0.0.1:8099 npm run build`, and reload the extension. Its CSP's `connect-src` gains the origin; the manifest asks for no new host.
3. **On mainnet, the worker's network panel shows:**
   - `127.0.0.1:8099/seedelf/v1/mainnet/…`: a restore's `contract/snapshot`, then `contract/since/<cursor>` and `names` at each reading, never Koios's `credential_utxos` for the contract;
   - `127.0.0.1:8099/api/v1/…` for the account, staking, governance and submits;
   - after a private send, `contract/since/…` every 5 s while Home watches it, and no `tx_status` for it;
   - with the API stopped, or started with another `DATA_ORIGINS` (403s), each part on `api.koios.rest` within one request, and back on the API 5 minutes later;
   - with Settings' **Read Cardano through Koios only** on, nothing to `127.0.0.1:8099`.
4. **End to end:** `npm run e2e:data` builds with `VITE_DATA_ORIGIN=https://data.seedelf.test` and runs `e2e/data-layer.spec.ts` against its fake (`e2e/data-layer.ts`). It writes that build to `dist/`: run `npm run build` again for everyday use.

## Test funds

- Get preprod test ADA from the [Cardano testnet faucet](https://docs.cardano.org/cardano-testnets/tools/faucet) and send it to the wallet's Cardano account (its receive address).
- The preprod contracts, reference scripts and collateral service are live (see [architecture.md](architecture.md#networks)).
- **The private test wallet** is `extension/.preprod-test-wallet.txt` (gitignored): one line, `phrase: ` and 24 words. The live runs restore it.

## Testing layers

| Layer | What | How |
|---|---|---|
| Rust | `seedelf-crypto`, `seedelf-core`, and the wasm crate | `cargo test`. The CLI's offline integration tests (`seedelf-cli/tests/cli/`) guard the builder extraction. The WebAssembly's own JS tests run in Node once it's built: `node --test "seedelf-web-wallet/wasm/tests/*.test.mjs"` from `seedelf-platform/`, as CI runs them. |
| Key derivation | The frozen v1 Seedelf key vectors, and the Cardano account vectors (verified against `@cardano-sdk`, Lace's library) | Checked in Rust, and again from JS through WebAssembly, so both sides agree |
| TypeScript | The manifest, the vault and wallet state, the Koios and giveme.my clients, and the worker's services and handlers against the real WASM, over recorded preprod answers; the screens, rendered to markup (`renderToStaticMarkup`: Vitest has no DOM) | Vitest (`npm test`). A screen's wiring is tested with its effects and handlers run, over `tests/screens-wiring-review-fixes.test.ts`'s `vi.mock("react")` seam: effects run in the render, the worker answers at once, a press acts as its element is made (`on`), and a state only an awaited answer reaches starts from a seed (`seed`). What a press does after an `await` is its rule's own test's. |
| End to end, data layer | Mainnet through the data layer's fake, each part falling back to the Koios fake | `npm run e2e:data` (a build with `VITE_DATA_ORIGIN`, then `e2e/data-layer.spec.ts`), as CI runs it |
| End to end | The built extension in a real browser | Playwright (`npm run e2e`) launches Chromium with `dist/` loaded and drives the side panel's layout and the full tab. Branded Chrome no longer accepts `--load-extension`, so it uses Playwright's Chromium. The dApp connector's tests load a copy of the build whose manifest grants the sites from install, because Chrome's own dialog for an optional permission can't be answered from automation (`withSiteAccess` in `e2e/support.ts`); their dApp is a page served at `https://dapp.example/`. The harness sets the network before the wallet starts (`network`, preprod by default, as the fakes answer), so the suite runs on a dev build and on the store's mainnet build alike. |
| Live reads | The balance scan and the ADA Handle lookup against the real preprod Koios | `LIVE_KOIOS=1 npx vitest run tests/live.test.ts`; skipped otherwise |
| Probes | Transactions checked against preprod's node and scripts, submitting nothing | `node tests/fixtures/probe-staking.mjs`: every staking transaction through Ogmios's decoder, and an account-paid mint with the rewards through the real policy. `probe-governance.mjs` does the same for every DRep transaction (register, update, retire, vote), and `probe-note.mjs` for a public send with a note. The `record-*.mjs` scripts do the same for the Seedelf spends, and keep what they recorded as fixtures. |
| Live | Real preprod transactions from the built extension, by hand, never in CI | `node e2e/live/run.mjs all` runs every Seedelf flow in one browser session on the private test wallet, waiting for each to confirm, and prints the hashes. `node e2e/live/run.mjs staking` stakes, delegates the vote and changes pool; `withdraw-rewards` and `unstake` wait until rewards arrive. `run.mjs` also takes single flows: `mint live-1 account + move-in 25.5`. It puts the wallet on preprod before the first page opens, so it runs on `npm run build`'s build. `all` gives its Seedelfs fresh tags each run (`live1-…`, `live2-…`), because each run leaves its first Seedelf, about 1.5 tADA, in the test wallet, and a tag two Seedelfs share finds neither. CI never runs it, so `tests/live-runs-copy.test.ts` checks that every label it fills, presses or waits for is still in the wallet's English: otherwise a renamed control would break it unseen. |
| Manual | What a script can't see, before each release | [The preprod checklist](#preprod-checklist-before-a-release) |

## Rules for a change to the screens

These hold for every change to what the wallet shows, from one label to a whole restyle.

- **Lace is inspiration for look and flow, never a brand to copy:** not its name, logo, purple palette or commercial fonts (Brandon Grotesque and Proxima Nova, which are in its repo but not licensed to us). A file adapted from Lace stays Apache-2.0, with its notice, our changes marked and the licence beside it, as [`background/secret-box/`](../extension/src/background/secret-box/README.md) does.
- **Every privacy note stays.** A redesign may move or shorten one, never drop it. Each is in the translations' critical set ([critical-keys.json](i18n/critical-keys.json), derived from the source by `extension/scripts/i18n-critical.mjs`): what a privacy or warning callout or an alert shows, what an element whose class carries a `--warn` modifier shows, and any key named `.privacy.` or `.warn.`.
- **Correctness UX is always in scope:** clear errors, input limits.
- **An explanation goes behind an ⓘ; a note a reader must see stays on the page.** `components/Hint.tsx` holds what a feature is and how a transaction runs once sent, in one of three places: beside a screen's title (`Screen`'s `hint`), beside a section's heading or a field's label (`Hinted`), or on a row of its own. A note stays on the page when it says what someone else learns or sees (a privacy note, Koios, giveme.my, Minswap), what an action costs or locks up, what can't be undone, what to do next, or what's happening now, and so does an empty list's line and a one-line note, where an icon saves nothing.
- **Short enough to read at a glance:** using the wallet must never feel like a reading test. A note always on screen is about 20 words, one or two sentences, and a screen's one core warning about 30; an error says what happened and what to do; an ⓘ stays under about 40. Say each fact once per screen, lead with the consequence, and leave out how it works inside, history and examples. Facts the rules above keep are shortened, never dropped.
- **Nothing new phones home without its own decision**, because of what a new host or query tells it. The pages' CSP keeps fonts, icons and images inside the extension (`font-src 'self'`, `img-src 'self' data:`, in `extension/src/manifest.ts`).
- **Every feature states its Koios cost, and anything paged scales with the contract's size.** The public tier takes 5,000 requests a day and 100 every 10 s from an IP address, and the wallet keeps to 40 (`RateLimit` in `extension/src/background/koios.ts`); a response holds at most 1,000 rows. The e2e tests assert the exact requests a screen makes.
- **Tests find controls by role, label and test id**, so a restyle doesn't break them; the few class selectors in `e2e/extension.spec.ts` only look inside a part (a phrase's words, a cut name, a review's rows). **Renaming a control means updating `e2e/extension.spec.ts` in the same commit, and `e2e/store-images.spec.ts` and [flows.md](flows.md) too,** so the tests and the docs keep up with the screens. CI doesn't run the store images' spec, so `tests/store-images-copy.test.ts` fails `npm test` when English it fills, clicks or waits for is gone from `en.json`. CI doesn't run the live runs (`e2e/live/`) either, and `tests/live-runs-copy.test.ts` holds them likewise: a renamed control updates them too.
- **The name is Seedelf**, and Seedelf Wallet for the app. `extension/tests/words.test.ts` checks the source, and `extension/tests/i18n.test.ts` every locale.

## Preprod checklist before a release

On the built extension (`npm run build`, then load `dist/` unpacked), in the side panel and in a tab.

1. **The automated layers:** `cargo test --workspace --locked`, and the two tests it skips as slow, both offline: payments in parts over UTxOs of every shape (about a minute: `cargo test --release --locked -p seedelf-wasm --test payment_parts_shapes_test -- --ignored`) and the box rule over many more balances than the default run's (a minute or two: `cargo test --release --locked -p seedelf-core --test box_rule_reference_test -- --ignored`), the WASM tests, `npm test` and `VITE_ENABLE_MAINNET=false npm test`, and `npm run e2e`. Then `LIVE_KOIOS=1 npx vitest run tests/live.test.ts`, and `node e2e/live/run.mjs all` on the funded test wallet. Keep the six hashes.
   - The live runs put the wallet on preprod before it opens, so they run on `npm run build`'s build. Each restores the test wallet in a fresh profile, and a restore can't know a Bootstrap's hold: a held box someone else's mix moved can come back by itself while a run is open. So run them on a wallet holding no Bootstrap's boxes (the phrase in `.preprod-test-wallet.txt` picks it).
2. **Onboarding:** create a wallet from the toolbar button (it opens a tab), and once from the side panel (it opens one too): reveal, confirm three words, set a password. Restore that phrase in another Chrome profile and check the addresses match, and that Home says *Wallet restored* with what the phrase holds (nothing yet, for this one). Restore a 12- or 15-word phrase from Lace or Eternl, and check its account. **Restore a phrase that has used more than one account** (make one in Lace, or fund account 1's address): the picker appears on its own, and both accounts are there.
3. **Public accounts:** switch from Home's Public heading ("Public account 2 ▾") and from Settings → Public accounts, and check the balance, Activity, Receive, the UTxOs screen, Staking and the collateral are all the account you chose. Name one and check the name shows in the picker and on Home. *Look for the next account* with nothing there says so and costs one request. **Make private from two accounts, then send privately from the balance**: the review names both accounts and says the spend ties them together. Add an account by a number of your own (1338, say) that has never been used, and check it can be switched to and received into. On Send publicly, **Your accounts** offers the others and picking one says what the payment reveals rather than refusing it. The × clears each To field, on both sides and on Make public, and Make public offers **Your accounts** too. Past eight accounts the Settings list filters by number or name. **Settings → Sites picks the account sites use:** connect a site, switch the wallet to another account, and check the site still sees the dApp account and is never refused; then change the dApp account and check the site sees the new one.
4. **Locking:**
   - the lock button;
   - auto-lock after 15 minutes, and after 1 minute once Settings says so;
   - a wrong password's back-off;
   - Forgot password, then delete, then restore;
   - a browser restart comes back locked.
5. **Home:**
   - both tabs, and *Get started* on a new wallet;
   - Receive: scan the QR code from a phone wallet;
   - Refresh, and a sent transaction's banner through to confirmed, then Dismiss.
6. **Each flow once by hand:**
   - create a Seedelf, paid by the account;
   - move in;
   - send to a Seedelf, pasting a name someone else gave you;
   - withdraw to an address and to a `$handle`;
   - remove a Seedelf;
   - stake with a pool from the browser (its **Pool details** end with its **Return on stake**), change pool, delegate the vote to a DRep by its ID, withdraw rewards, open **Rewards history** and **Delegation history**, and stop staking;
   - become a DRep with the account's own vote, vote on a live governance action, change the profile, and retire as a DRep;
   - send with *Use staking rewards when spending* on, then off;
   - set the collateral of a public account holding no 5 ₳ UTxO of ADA alone (Settings → Collateral), which pays itself 5 ₳: Public activity names that payment *Set collateral*;
   - turn the connector on (Settings → Sites), connect one site to the public account and one to a private session, sign for each, and give a governance site such as GovTool CIP-95;
   - a session found after a restore: leave that private session funded, then restore the phrase in a fresh profile. dApps → *After a restore* lists it, its page says the phrase may be open in another browser, and **Bring it back** returns it. **Find leftovers** then finds nothing more on that network. On the other network, *After a restore* says the restore didn't look there, until Find leftovers has;
   - a session found after a restore whose account holds ADA but no UTxO of exactly 5 ₳ of ADA alone: bring a session back, pay its address 20 ₳ from another wallet, then restore the phrase in a fresh profile, with *Bring private sessions back through Lovejoin* on, as by default. Its page offers **Put in 5 ₳ for Lovejoin** beside Bring it back: review it and Send. Once it's there, **Bring it back** goes through Lovejoin;
   - a private swap from the Minswap tile through to everything back, and one stopped partway;
   - Lovejoin in v2's 5 ₳ pool (preprod's head start bundles it, `47bece42…`), once a second wallet, from another recovery phrase, has put boxes in it to mix with: a pool holding the tester's own boxes alone has nobody to mix with, since a wallet's own boxes never count. Then a Lovejoin mix from each side, and **Bring one back now**; Public activity names the public account's deposit *Into Lovejoin* and its mixes *Lovejoin mix*;
   - in that pool too: with **Four boxes a mix** on (Settings), a mix whose review says four, or why three; a Bootstrap (*Help start the pool*, under Mix) from each side, the private one's review reading *For returning the rest* 1.5 ₳ at today's parameters, then **Bring one back** and **Bring them all back**; and **Start a pool**'s review. Send a start only to test a change to it: every pool started shows to every preprod wallet, and its ADA never comes back. The other pools in the head start (MIN's two, 5 ₳ and 7 tADA, all on 8131b1d's scripts) and the classic pool are retired, and take no mix;
   - a private swap whose return goes through v2's 5 ₳ pool: with two other people's boxes free in it, the return first puts the session's 5 ₳ collateral in and mixes it once (Settings' *Mix a session's 5 ₳ collateral*, on by default), and that mix waits for giveme.my. A swap into a token with a pool shown (*What you get, on the way back* naming the pool, the tokens back through it), and every other token pool's item here, waits for a v2 token pool on preprod: every token pool there today is retired;
   - boxes in the retired pools (put some in with a 1.7.2 build first: a 1.8.x build puts none there), on the update and on a restore: at the profile's first unlock on 1.8.0 or later, and in a fresh profile once the restored phrase opens Lovejoin's page, the hub lists those pools withdraw-only, their pages' Review and Mix my boxes again off, with the reason, and the boxes come back one right after another, by themselves, Settings saying *Bringing every box in the retired pools back*, with Stop. With `www.giveme.my` blocked, that run stops by itself after three runs that sent nothing, and its **Try again** asks "Bring the retired pools' boxes back now?";
   - with `www.giveme.my` blocked once that collateral's deposit lands, an hour on, **Bring the rest back now** and its line on the swap's page, a site's (whose press opens its return's review) and the mix's card: the chain reads "You chose not to wait…", the 5 ₳ box stays unmixed, and **Mix my boxes again** moves it once unblocked;
   - **Bring every box back now** (Settings), and a pool's own, on its page;
   - **Max** on Send privately and on Make public from more than 20 UTxOs: the review's *Transactions* says how many it goes as, its **Transaction details** steps through each ("Transaction 1 of N"), as a Lovejoin mix's review funded in parts does, and Home follows each to the last;
   - **Show image** on an NFT, in each balance;
   - switch the language to Español and to 日本語, read Home and a review in each, and back to English.

   Read every review and every privacy note as you go.
7. **Mistakes and failures:**
   - the server blocked (offline, or an ad blocker) says why, and recovers on Refresh;
   - amounts: more than the balance, seven decimals, letters;
   - a mistyped Seedelf name, and a `$handle` that doesn't exist.
8. **Nothing else is contacted:** in DevTools, the worker's network panel shows only `preprod.koios.rest` and `www.giveme.my` (and Minswap's preprod aggregator, for a swap, and `ipfs.blockfrost.dev` for an NFT image you asked to see).
9. **The store's build, both networks** (`npm run package`, `dist/` loaded unpacked in a fresh profile):
   - it opens on **MAINNET**, with no preprod strip;
   - Settings, Network: moving to preprod says first that its ADA has no value; then every screen, and the connector's window, shows the **PREPROD** badge and strip, and Home the preprod balances;
   - a payment reviewed on one network and sent after a switch is refused ("isn't ready to send");
   - a site connected on one network asks again on the other, and one waiting as you switch is declined;
   - on mainnet, the worker's network panel shows only `mainnet.seedelf.logicalmechanism.io`, `www.giveme.my` and `api.coingecko.com` (and `agg-api.minswap.org`, for a swap, and `ipfs.blockfrost.dev` for an NFT image you asked to see), plus `preprod.koios.rest` only for something still on its way on preprod, and `api.koios.rest` only for a part the data layer couldn't answer;
   - Settings, Network, on mainnet: **Read Cardano through Koios only** on sends nothing more to `mainnet.seedelf.logicalmechanism.io`, and off, the next reading goes there again. The line under it says *Using Seedelf's data layer.* with a green light while it's off, and *Using Koios only.* in grey once it's on.

## Web Store release: copy/paste procedure

This is the repeatable release path for a new Web Store version, in two parts. **The version, the refreshed token and DRep lists and the Lovejoin pools' head start are committed on the release branch** (`web-wallet/release-<x.y.z>`), with the checks, and reach `main` through its PR. **The package is built after the merge, from the merge commit on `main`** in a clean tree, so the commit [releases.md](releases.md) records gives the same zip. Change part 1's `release_version` to the new, higher version for each later release; part 2 reads it from `package.json`.

**Which number.** The store only demands one strictly higher than the last, so the semantics are for the wallet's own users: a **minor** bump for a release that adds something a user can do (1.1.0, the transaction view), a **patch** for a fix or a listing hotfix on its own (1.0.1). The web wallet's line runs from 1.0.0 and is deliberately apart from the Rust workspace's and the CLI's 0.x.y, so that a listing hotfix is free to bump it alone ([the root CLAUDE.md](../../../CLAUDE.md#release--versioning) has the rule).

### 1. On the release branch: set the version and run the checks

From the repository root, on a `web-wallet/release-<x.y.z>` branch from `main`:

```bash
cd seedelf-platform
cargo test --workspace --locked
cargo test --release --locked -p seedelf-wasm --test payment_parts_shapes_test -- --ignored
cargo test --release --locked -p seedelf-core --test box_rule_reference_test -- --ignored
cd seedelf-web-wallet/extension
npm ci
release_version=1.9.2
npm version "$release_version" --no-git-tag-version
npm run tokens
npm run dreps
npm run lovejoin-pools
git diff -- package.json package-lock.json src/tokens src/dreps src/lovejoin-pools.json
```

Read those diffs (steps 2 and 3 of [Releasing to the Web Store](#releasing-to-the-web-store) say what to look for), and commit them together.

Then the pools' names on Cardanoscan (step 3 says why), in the maintainer's fork of Strica's registry, checked out beside this repository. In the same terminal, from `extension/`, it starts from Strica's own `master`:

```bash
registry=../../../../cardano-contracts-registry
if [ ! -d "$registry/.git" ]; then
  echo "No registry fork at $registry: skipped. It's the owner's step, never a release gate."
elif [ -n "$(git -C "$registry" status --porcelain --untracked-files=no)" ]; then
  echo "The fork at $registry has uncommitted changes: commit or discard them, then run this again."
elif pending=$(gh pr list --repo StricaHQ/cardano-contracts-registry --author @me --state open \
    --search "Lovejoin token pools in:title" --json url --jq '.[0].url // empty') && [ -n "$pending" ]; then
  echo "The last pools PR is still open ($pending): run this again once it's merged, or close it and run this again."
else
  git -C "$registry" fetch -q https://github.com/StricaHQ/cardano-contracts-registry.git master \
    && git -C "$registry" switch -q --detach FETCH_HEAD \
    && npm run -s lovejoin-registry -- "$registry/projects/lovejoin.json"
fi
```

It skips, saying why, in three cases:

- **No fork beside this repository,** as in any other clone: only the maintainer can send the entries, and Cardanoscan checks the PR with the official X account or email.
- **The fork has uncommitted changes.** Switching to Strica's `master` could keep them, and they'd go out in the PR.
- **The last pools PR is still open.** Most of Strica's merges take a day or less, but some have taken weeks: their slowest of 20 took 65 days. A new PR from their `master` would repeat the open one's entries. Closing it is fine: the next run adds its pools again, since the script adds what Strica's `master` lacks.

Otherwise the script's last line says what it did. "No new pools" means there's nothing to send, and the fork is left at Strica's `master`. Otherwise send the new entries, then message Cardanoscan the PR's link from the official X account or email, as their README asks. `npm ci` comes first, as Strica's validator has changed its dependencies before:

```bash
(cd "$registry" && npm ci && npm run validate && git switch -c "lovejoin-pools-$release_version" \
  && git commit -qam "Lovejoin token pools" && git push -u origin "lovejoin-pools-$release_version" \
  && gh pr create --repo StricaHQ/cardano-contracts-registry --head "logicalmechanism:lovejoin-pools-$release_version" \
    --title "Lovejoin token pools" --body "Adds the scripts of Lovejoin's token pools launched since its last update.")
```

Then the checks:

```bash
npm run build
npm test
VITE_ENABLE_MAINNET=false npm test
npm run e2e
LIVE_KOIOS=1 npx vitest run tests/live.test.ts
node e2e/live/run.mjs all
node e2e/live/run.mjs staking
```

Then complete the manual [preprod checklist](#preprod-checklist-before-a-release), including the dApp, private-session, swap, and Lovejoin flows. If the UI or a caption in `e2e/store-images.spec.ts` changed, regenerate the store images (`npm run store:images`), and bring the listing in [store/README.md](store/README.md) up to date. Commit them, and open the PR into `main`.

### 2. On `main`, after the merge: build and test the store package

**First, if the release changed `seedelf-data/` or the token list (`extension/src/tokens/list.json`, which the API builds in), deploy the API:** Actions → *Data layer deploy*, `deploy`, on `main`, approved, then a `status` run ([seedelf-data/deploy/README.md](../../../seedelf-data/deploy/README.md)). A wallet the store ships must never meet an API older than the one it was reviewed against, and checklist item 9 reads this one from the store's build. The deploy checks `/health` and CORS alone, so then check, from any machine, the routes those don't read. Each line should print `200 application/json`:

```bash
api=https://mainnet.seedelf.logicalmechanism.io
curl -s -o /dev/null -w '%{http_code} %{content_type} lovejoin/pools\n' "$api/seedelf/v1/mainnet/lovejoin/pools"
curl -s -o /dev/null -w '%{http_code} %{content_type} lovejoin/tokens\n' "$api/seedelf/v1/mainnet/lovejoin/tokens"
curl -s -o /dev/null -w '%{http_code} %{content_type} pool_history\n' "$api/api/v1/pool_history?_pool_bech32=pool1gaztx97t53k47fr7282d70tje8323vvzx8pshgts30t9krw62tm&select=epoch_no,active_stake,block_cnt,deleg_rewards&order=epoch_no.desc&limit=18"
curl -s -o /dev/null -w '%{http_code} %{content_type} account_update_history\n' -X POST -H 'content-type: application/json' \
  -d '{"_stake_addresses":["stake1uxkjkwuygxqf24wacumm8ph2nlhp9e0ahv37fshdr060cyc36wvr9"]}' \
  "$api/api/v1/account_update_history?select=action_type,tx_hash,epoch_no,absolute_slot,block_time&action_type=neq.withdrawal&order=absolute_slot.asc,tx_hash.asc,action_type.asc&offset=0&limit=1000"
```

The first two are the token pools' routes: refused, they send every wallet's token pool reads to Koios, which then learns which boxes are the wallet's. Right after a deploy they can print `503` for up to a minute, while the restarted server works out its first pool list off the request: ask again before you take it for a failed deploy (the runbook says the same). The last two ask exactly what the wallet asks for a pool's history and for a delegation history: a 404 or a 400 there holds the wallet's whole public part on Koios for 5 minutes. `status`'s `.prev` is what a `rollback` would put back, and the runbook's *Routine* says how to tell what it lacks.

Then, from the repository root, at the merge commit, with nothing changed or added (`git status --porcelain` prints nothing):

```bash
git switch main
git pull --ff-only
git status --porcelain
cd seedelf-platform/seedelf-web-wallet/extension
npm ci
release_version=$(node -p "require('./package.json').version")
npm run package
npm run e2e
sha256sum "release/seedelf-wallet-$release_version-mainnet.zip"
stat -c %s "release/seedelf-wallet-$release_version-mainnet.zip"
git rev-parse HEAD
```

No `npm version`, `npm run tokens`, `npm run dreps` or `npm run lovejoin-pools` here. On `main` the bump fails ("Version not changed"), and each refresh rewrites a bundled file no commit has, so the zip wouldn't be the recorded commit's. `release_version` is read from `package.json`, which the merge brought: the zip is the version part 1 set.

The package to upload is:

```text
seedelf-platform/seedelf-web-wallet/extension/release/seedelf-wallet-$release_version-mainnet.zip
```

With `package.json` at 1.9.2, that file is `extension/release/seedelf-wallet-1.9.2-mainnet.zip`.

`npm run package` builds the store's mainnet build (`VITE_ENABLE_MAINNET=true`, `VITE_STORE_BUILD=true`) and refuses one whose manifest lacks `https://api.koios.rest/*`. The second `npm run e2e` runs the whole suite against it, with preprod chosen before the wallet starts (the fakes are preprod's). Then do checklist item 9 by hand on it.

**Keep for the release record**, with the commit `git rev-parse HEAD` printed, the SHA-256 and the size in bytes:

- `wasm/build.sh`'s last two lines, `Rust: <release> (<commit hash>)`, from `rustc -vV`, and `C compiler: <first line of clang --version>`, each `unknown` when it can't tell;
- `scripts/package.mjs`'s `sha256 <hex>`, and the line after it, `Zipped with Node <version>, zlib <version>`.

The next `npm run package` overwrites a zip of the same version, so take the hash from the zip you upload, never from one rebuilt since.

**Then build it a second time, apart,** for the record's reproducibility line: the same commit in a worktree of its own, with its own `node_modules` and its own cargo target, so nothing built for the first zip is reused, and in a clean environment (`env -i`: only `PATH` and `HOME`, and `LC_ALL=C.UTF-8`), so a toolchain or a flag left in the shell (`RUSTUP_TOOLCHAIN`, `RUSTC`, `CFLAGS`, `CARGO_TARGET_DIR`) reaches only the first, and the two hashes then disagree. In the same terminal, from `extension/`, it prints the second zip's SHA-256, which must be the first's, and removes the worktree:

```bash
second=$(mktemp -d)
git worktree add --detach "$second/tree" HEAD
(cd "$second/tree/seedelf-platform/seedelf-web-wallet/extension" && env -i PATH="$PATH" HOME="$HOME" LC_ALL=C.UTF-8 npm ci && env -i PATH="$PATH" HOME="$HOME" LC_ALL=C.UTF-8 npm run package && sha256sum "release/seedelf-wallet-$release_version-mainnet.zip")
git worktree remove --force "$second/tree"
```

Its WebAssembly builds from nothing, which takes a while. Never make the second build in the main tree: there it reuses the first's target, which proves nothing, and it overwrites the zip you upload.

`npm run package:preprod` makes a preprod-only store build (`-preprod.zip`) for tests. Never upload it.

### 3. Upload and submit

1. Open the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Choose **Add new item** for the first release, or open the existing item for an update. Upload `extension/release/seedelf-wallet-$release_version-mainnet.zip`.
3. Complete the **Store Listing**, **Privacy**, **Distribution**, and **Test instructions** tabs using [store/README.md](store/README.md). The Store Listing tab has a language list at its top, one for each of the package's `_locales`: fill in English, then Español and 日本語, each with its own description and screenshots ([In Spanish and Japanese](store/README.md#in-spanish-and-japanese)).
4. Set visibility (**Public** for launch, or **Unlisted** for a quieter start), check the host justifications match the manifest's four hosts, and verify the privacy-policy URL resolves.
5. Submit for review.
6. Tag the commit the zip was built from, still `HEAD` if `main` hasn't moved since step 2. The slash keeps [release.yml](../../../.github/workflows/release.yml) off it, and [SECURITY.md](../../../SECURITY.md)'s bounty scope is the latest such tag:

   ```bash
   git tag "web-wallet/$release_version" HEAD
   git push origin "web-wallet/$release_version"
   ```

7. Record it: a row in [releases.md](releases.md)'s table, and the release's record in [plans/release-records.md](plans/release-records.md), as its [*Recording a release*](plans/release-records.md#recording-a-release) lists. Then share the store link with the intended users.

The official Chrome upload flow is also described in [Publish in the Chrome Web Store](https://developer.chrome.com/docs/webstore/publish/).

## Releasing to the Web Store

The listing's text, its images and the privacy policy are in [store/](store/README.md), laid out by the dashboard's tabs. The maintainer who holds the developer account uploads the package by hand.

**Steps 1 to 6 happen on the release branch and are committed in its PR; steps 7 to 12 run on `main`'s merge commit**, in a clean tree. The privacy policy and the wallet's Settings link point at `main`, so the merge comes before `npm run package` ([store/README.md](store/README.md)).

1. **Bump the version:** `npm version <x.y.z> --no-git-tag-version` in `extension/`. It updates `package.json` and `package-lock.json`, and the manifest takes its version from there. Every upload needs a higher version than the last.
2. **Refresh the token list, every release:** `npm run tokens` in `extension/`. Read the diff of `src/tokens/registry.*.json`, and any "also claimed by" warning, before committing it. To add a token, vet its unit and put it in `src/tokens/list.json` first; `node scripts/tokens.mjs find <network> <TICKER>` shows the registry's entries for a ticker. The release's record says what changed, or that nothing did.
   - **And the data layer's decimals:** the API gives a token's decimals from the registry as it was when the API was built (`seedelf-data/api/data/token-decimals.json`), and a private row keeps what it was given until it's spent. So refresh it too, by `seedelf-data/scripts/token-decimals.py`'s two lines, and if the file changed, commit it: step 7's deploy carries it.
3. **Refresh the DRep list, every release:** `npm run dreps` in `extension/`. It rewrites `src/dreps/<network>.json` with every registered DRep that has a name, except one whose profile asks directories not to list it (CIP-119's `doNotList`, which the wallet's own DRep form sets by default): a pasted ID still finds that one. **Koios's servers disagree about DRep metadata** (three single-pass runs once named 371, 407 and 406 mainnet DReps against the 449 committed, each missing a different set), so the script asks again for the DReps still unnamed, in up to three passes. A DRep the committed list names that's still registered but that no pass names keeps its committed name, unless it asks not to be listed, and a list that would still lose more than 5% of the committed one's other DReps is refused with nothing written: run it again later. Its line for each network says how many passes it took, how many names it kept as committed, how many committed DReps are no longer registered, and how many DReps ask not to be listed. Skim the diff for anything odd before committing it; the release's record says what changed.
   - **And the Lovejoin pools' head start, every release:** `npm run lovejoin-pools` in `extension/`. It rewrites `src/lovejoin-pools.json` with every shown pool on each network, read from the holder through the real Koios under the release's token list, so a first look on a new install starts there instead of the chain's start. It's a head start, never a gate: a pool launched after it is found live. On mainnet by the data layer's list, which a pool read asks at most every 5 minutes while the worker runs. On preprod, with Koios only, or while the data layer can't answer, by Koios's holder: as Lovejoin's page opens and at a pool's start, and, at most every 5 minutes a network while the worker runs (`lookSoon`), at Settings' Bring every box back and wherever a return, a review or a funding asks for the 5 ₳ pool while the wallet keeps none (1.8.0's release review, O1). So a 5 ₳ pool launched later is found without Lovejoin's page on both networks, and a token pool on mainnet by the list; on those Koios paths, once a 5 ₳ pool is kept, a token pool waits for the page, a pool's start or Settings' press, since no ask looks then (1.8.0's review of its fixes, r2-critic#1). Its test fails if `src/tokens/list.json` changed since it was written, so run it after `npm run tokens`. The release's record names the pools it added.
   - **And the pools' names on Cardanoscan, after the head start:** `npm run lovejoin-registry -- <the fork's projects/lovejoin.json>` in `extension/`. Cardanoscan names a script only by its hash, from Strica's cardano-contracts-registry, and a token pool's four scripts are its own, made from its launch's seed, so a pool shows unnamed until they're added. The script verifies each mainnet pool in `src/lovejoin-pools.json` again through WebAssembly (it needs `wasm/pkg`, which `npm run build` makes) and adds its four entries to the maintainer's fork of the registry (`logicalmechanism/cardano-contracts-registry`), named for the pool's value and its set of scripts: an 8131b1d pool's `Mix Box (5 ADA)` or `Fee Pool (1,000 SNEK + 4 ADA)`, as version 2, and a v2 pool's `Mix Box v2 (5 ADA)`, as version 3, so v2's 5 ₳ pool never takes the 8131b1d 5 ₳ pool's names; each set's entries link its own contracts, at the commit core pins it to (1.8.0's release review, D3; `tests/lovejoin-registry.test.ts`). It only adds: an entry already there is never changed or removed, and the hand-written ones (the project, the classic pool's, the reference holder's) are left alone. Given no file, it prints the entries. A pool that doesn't verify, one on a set it doesn't name, a token with no ticker or a name over the registry's 45 characters stops it with nothing written; it's never a release gate. With nothing new it writes nothing, and says so. [Part 1](#1-on-the-release-branch-set-the-version-and-run-the-checks)'s second block sends what it added. The release's record names the pools it added, or says none were new.
4. **Run [the preprod checklist](#preprod-checklist-before-a-release)** on a dev build (`npm run build`). The live runs expect the dev build's pinned ID.
5. **The images:** if the UI or a caption in `e2e/store-images.spec.ts` changed, run `npm run store:images` and look at `docs/store/images/`, and at its `es/` and `ja/`: each screen is shot in all three languages. They're made from the recordings on mainnet, so they show the MAINNET badge and no test-network strip ([store/README.md](store/README.md), *Graphic assets*). The Japanese ones need a Japanese font on the machine (Noto Sans CJK JP here), or Chromium draws boxes.
6. **Commit and merge:** the bump, both lists and the pools' head start, the images and any change to the listing's text, in the release branch's PR into `main`, merged once its Web Wallet check is green on every step ([Branching](#branching)).
7. **Deploy the data layer, if the release changed `seedelf-data/` or `extension/src/tokens/list.json`** (step 2's decimals included; the API builds the token list in, and shows a Lovejoin pool only of a listed token, so a token added to the list without a deploy leaves its pools hidden from every mainnet wallet): Actions → *Data layer deploy*, `deploy`, on `main`, approved, then a `status` run, `curl -s https://mainnet.seedelf.logicalmechanism.io/health`, and [part 2](#2-on-main-after-the-merge-build-and-test-the-store-package)'s checks of the routes `/health` doesn't read ([seedelf-data/deploy/README.md](../../../seedelf-data/deploy/README.md)). A wallet the store ships must never meet an API older than the one it was reviewed against: a public route the API lacks answers 404, and a request it takes in another shape 400, and either holds the wallet's whole public part on Koios for 5 minutes; a token pools' route refused sends the token pools' reads to Koios. It goes before the package, so the store build's check on mainnet (step 9) reads it.
8. **Build the package**, on `main` at the merge commit, with `git status --porcelain` printing nothing: `npm run package` in `extension/`.
   - It builds with `VITE_ENABLE_MAINNET=true` and `VITE_STORE_BUILD=true`: mainnet by default, preprod in Settings, and no dev key.
   - It refuses a `dist/` with a key, one whose version doesn't match `package.json`, and one whose manifest lacks `https://api.koios.rest/*` (a preprod-only build).
   - The WebAssembly is built from the tracked `Cargo.lock` (`--locked`) with the pinned Rust (`rust-toolchain.toml`, unless a `RUSTUP_TOOLCHAIN` or `RUSTC` in the shell overrides it: the `Rust:` line says which ran), and carries no local path.
   - It adds `licenses/THIRD-PARTY.txt`: every Rust crate compiled into the WebAssembly, every bundled npm package, and SecretBox, each with its licence text. It fails if one of them ships no licence and has no known fallback (`scripts/third-party.mjs`).
   - It writes `release/seedelf-wallet-<version>-mainnet.zip` and prints `sha256 <hex>`, then `Zipped with Node <version>, zlib <version>`. `wasm/build.sh` ends its part with `Rust: <release> (<commit hash>)` and `C compiler: <first line of clang --version>`, each `unknown` when it can't tell.
   - The zip is reproducible: the same commit and toolchain (Rust, wasm-bindgen, clang, an official Node build) give the same bytes, which [part 2](#2-on-main-after-the-merge-build-and-test-the-store-package)'s second build shows. Official Node builds 20 to 24 zip alike, and one linked to the system's zlib may not. blst's C goes through the unpinned clang on `PATH`.
9. **Test the store build:** `npm run e2e` runs every end-to-end test on it, with preprod chosen (`e2e/support.ts`). Load `dist/` unpacked in a fresh Chrome profile once, and do [checklist item 9](#preprod-checklist-before-a-release): it opens on mainnet, and the switch works both ways.
10. **Upload** the zip on the dashboard's Package tab. If the listing's text or images changed, copy them from [store/README.md](store/README.md), in each of its three languages ([In Spanish and Japanese](store/README.md#in-spanish-and-japanese)). Then submit for review.
11. **Tag it** `web-wallet/<version>` on the commit it was built from, and push the tag ([step 6 above](#3-upload-and-submit)).
12. **Record it:** a row in [releases.md](releases.md)'s table, and the release's record in [plans/release-records.md](plans/release-records.md), a section that says what its [*Recording a release*](plans/release-records.md#recording-a-release) lists.

## Sharing with testers

Testers install the store's build: it's mainnet, with preprod in Settings for testing ([store/README.md](store/README.md)). There's no separate unlisted or private listing.

- **A build the store hasn't reviewed** goes to a tester as a zip of `dist/`, loaded unpacked the same way we do. It gets no automatic updates.
- **Self-hosted `.crx` files don't work for normal users:** Chrome generally allows installs from outside the store only through enterprise policy.

## Reference: Lace

IOG's [Lace](https://github.com/input-output-hk/lace) wallet (Apache-2.0) is our reference for browser-extension and Cardano patterns. We take patterns and a few individual files. We don't take its framework, its UI stack or its branding.

Clone it locally for reading. `seedelf-platform/_reference/` is gitignored.

```bash
git clone https://github.com/input-output-hk/lace seedelf-platform/_reference/lace
git -C seedelf-platform/_reference/lace checkout e431933
```

Every Lace path in these docs is relative to that checkout. `e431933` is where Lace's extension is at 2.4.2, the version the docs measure against; SecretBox ([extension/src/background/secret-box/](../extension/src/background/secret-box/README.md)) was adapted from the `lace-extension@2.4.0` tag, three commits earlier, and its files are the same at both.

## Decisions

- **Networks:** mainnet and preprod in every build, mainnet by default; `VITE_ENABLE_MAINNET=false` makes a preprod-only build for tests. See [architecture.md](architecture.md#networks).
- **Seedelf key derivation:** domain-tagged HKDF over the BIP39 seed. It is permanent once shipped. See [keys-and-accounts.md](keys-and-accounts.md#seedelf-key-derivation).
- **UI:** the same app in a full tab (the default) or Chrome's side panel, the user's choice in Settings, as in Lace. No popup. See [architecture.md](architecture.md#ui).
- **Look:** the Seedelf logo set lives in [brand/](../brand/README.md). The UI's colours come from it. Images for posts about the wallet, drawn in the same look, are in [media/](../media/README.md).
- **Staying unlocked:** Chrome stops the extension's background worker after about 30 seconds idle, which clears its memory.
  - The unlocked key is kept in `chrome.storage.session` (memory-only, cleared when the browser closes).
  - So the wallet stays unlocked until auto-lock or the browser closes, instead of asking for the password each time Chrome restarts the worker.
  - See [architecture.md](architecture.md#service-worker).
- **Cardano accounts:** CIP-1852 accounts, one at a time. The wallet finds the ones the phrase has used, in order, stopping at the first never used, and asks about one at a time on purpose. The Seedelf key stays on account 0, so there is one private balance for the whole phrase. See [keys-and-accounts.md](keys-and-accounts.md#the-cardano-account).
- **One-time accounts:** a reserved account index that other wallets never reach. Each session's base address has its own payment and stake keys, shared with no other session. See [privacy.md](privacy.md#known-links).
- **Transaction building:** the CLI's Rust (Pallas) builders, separated from network calls and compiled to WebAssembly. See [architecture.md](architecture.md#transaction-building).
- **UI stack:** React + TypeScript + Vite, with plain CSS.
