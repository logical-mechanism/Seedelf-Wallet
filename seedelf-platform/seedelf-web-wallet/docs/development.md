# Development

This is how we run and test the extension before a release goes to the Chrome Web Store. The extension lives in [../extension/](../extension/); its README lists every script.

## Branching

**The web wallet lives on `main`.** `seedelf-web-wallet`, the long-lived dev branch it was built on, was merged into `main` on 2026-09-29 (PR #266) and is finished. It held the wallet off `main` until it worked, so shelving the effort would have left no dead code there; that job is done.

**Feature branches and PRs:**

- **Start every feature branch from `main`** and name it `web-wallet/<topic>`. Keep the prefix: it reads well in the log, and it's what tags use.
- **Open PRs into `main`.**
  - CI ([web-wallet.yml](../../../.github/workflows/web-wallet.yml)) runs on pull requests into any branch that touch `seedelf-platform/`.
  - Direct pushes don't trigger it, so go through a PR even for a docs change.
- **Never name a branch `web-wallet/<x>.<y>.<z>`** — that's the tag namespace (`web-wallet/1.0.0`), and a branch and tag sharing a name makes `git checkout` ambiguous.

**The old branch:**

- **Don't start new work on `seedelf-web-wallet`;** it's finished and far behind `main`, and can be deleted whenever.

**Shared Rust code:**

- **Changes to shared Rust code that only the web wallet needs go through a `web-wallet/<topic>` branch into `main` too.** The builder extraction is the main example.

**Progress** is tracked in [roadmap.md](roadmap.md), and what comes next in [post-release-roadmap.md](post-release-roadmap.md). The work happens in chunks of about one session each, and each chunk updates the roadmap when it finishes.

**Plans:** a chunk's plan lives in [plans/](plans/) while it's being built. When the chunk lands, what still holds moves into the design docs ([architecture.md](architecture.md), [flows.md](flows.md), [privacy.md](privacy.md), [keys-and-accounts.md](keys-and-accounts.md), this file) and the plan moves to `docs/archive/plans/`, so `plans/` only ever holds live specs.

## Running it in Chrome

Chrome runs an extension straight from a folder once developer mode is on. There is no store and no packaging.

1. Build it: `cd seedelf-web-wallet/extension && npm install && npm run build`. This builds the Rust core to WebAssembly and then the extension into `dist/`. Every build has both networks: mainnet by default, with preprod on the welcome screen and in Settings (see [architecture.md](architecture.md#networks)). A wallet from before the switch stays on preprod. `VITE_ENABLE_MAINNET=false npm run build` makes a preprod-only build.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `dist/` folder.
4. Pin the extension, then click its icon: the wallet opens in a tab, or in the side panel once Settings says so.

After a rebuild, click the reload arrow on the extension's card. `npm run dev` rebuilds `dist/` on every change, but you still reload the extension by hand.

- **After packaging, build again.** `npm run package` and `npm run package:preprod` write a store build into the same `dist/`: it has no dev key, so Chrome gives it another ID, with empty storage, and `package:preprod`'s has preprod alone, so the welcome screen has no network to choose and every wallet is a preprod one. Run `npm run build` before loading or reloading `dist/` for everyday use.

- **If you forget:** Chrome keeps running the old service worker, which asks for the old WebAssembly file. Each build gives that file a new hashed name and deletes the previous one.
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

Mainnet can read Seedelf Wallet's own data layer (chunk 26b, [architecture.md](architecture.md#chain-data)). **The store build doesn't yet:** it has no origin until the VPS chunk. A dev build reads a local API instead:

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
- **The private test wallet** is `extension/.preprod-test-wallet.txt` (gitignored): one line, `phrase: ` and 24 words. The live runs restore it. It was funded with 10,000 tADA on 2026-09-24.

## Testing layers

| Layer | What | How |
|---|---|---|
| Rust | `seedelf-crypto`, `seedelf-core`, and the wasm crate | `cargo test`. The CLI's offline integration tests (`seedelf-cli/tests/cli/`) guard the builder extraction. The WebAssembly's own JS tests run in Node once it's built: `node --test "seedelf-web-wallet/wasm/tests/*.test.mjs"` from `seedelf-platform/`, as CI runs them. |
| Key derivation | The frozen v1 Seedelf key vectors, and the Cardano account vectors (verified against `@cardano-sdk`, Lace's library) | Checked in Rust, and again from JS through WebAssembly, so both sides agree |
| TypeScript | The manifest, the vault and wallet state, the Koios and giveme.my clients, and the worker's services and handlers against the real WASM, over recorded preprod answers | Vitest (`npm test`) |
| End to end, data layer | Mainnet through the data layer's fake, each part falling back to the Koios fake | `npm run e2e:data` (a build with `VITE_DATA_ORIGIN`, then `e2e/data-layer.spec.ts`), as CI runs it |
| End to end | The built extension in a real browser | Playwright (`npm run e2e`) launches Chromium with `dist/` loaded and drives the side panel's layout and the full tab. Branded Chrome no longer accepts `--load-extension`, so it uses Playwright's Chromium. The dApp connector's tests (chunk 15) load a copy of the build whose manifest grants the sites from install, because Chrome's own dialog for an optional permission can't be answered from automation (`withSiteAccess` in `e2e/support.ts`); their dApp is a page served at `https://dapp.example/`. The harness sets the network before the wallet starts (`network`, preprod by default, as the fakes answer), so the suite runs on a dev build and on the store's mainnet build alike. |
| Live reads | The balance scan and the ADA Handle lookup against the real preprod Koios | `LIVE_KOIOS=1 npx vitest run tests/live.test.ts`; skipped otherwise |
| Probes | Transactions checked against preprod's node and scripts, submitting nothing | `node tests/fixtures/probe-staking.mjs`: every staking transaction through Ogmios's decoder, and an account-paid mint with the rewards through the real policy. `probe-governance.mjs` does the same for every DRep transaction (register, update, retire, vote), and `probe-note.mjs` for a public send with a note. The `record-*.mjs` scripts do the same for the Seedelf spends, and keep what they recorded as fixtures. |
| Live | Real preprod transactions from the built extension, by hand, never in CI | `node e2e/live/run.mjs all` runs every Seedelf flow in one browser session on the private test wallet, waiting for each to confirm, and prints the hashes. `node e2e/live/run.mjs staking` stakes, delegates the vote and changes pool; `withdraw-rewards` and `unstake` wait until rewards arrive. `run.mjs` also takes single flows: `mint live-1 account + move-in 25.5`. |
| Manual | What a script can't see, before each release | [The preprod checklist](#preprod-checklist-before-a-release) |

## Rules for a change to the screens

These hold for every change to what the wallet shows, from one label to a whole restyle. They began as chunk 14's *Rules that still hold* ([archive/plans/chunk-14-style-flow-2.md](archive/plans/chunk-14-style-flow-2.md#rules-that-still-hold)); this list is the one that governs now.

- **Lace is inspiration for look and flow, never a brand to copy:** not its name, logo, purple palette or commercial fonts (Brandon Grotesque and Proxima Nova, which are in its repo but not licensed to us). A file adapted from Lace stays Apache-2.0, with its notice, our changes marked and the licence beside it, as [`background/secret-box/`](../extension/src/background/secret-box/README.md) does.
- **Every privacy note stays.** A redesign may move or shorten one, never drop it. Each is in the translations' critical set ([critical-keys.json](i18n/critical-keys.json), derived from the source by `extension/scripts/i18n-critical.mjs`): what a privacy or warning callout or an alert shows, and any key named `.privacy.` or `.warn.`.
- **Correctness UX is always in scope:** clear errors, input limits.
- **An explanation goes behind an ⓘ; a note a reader must see stays on the page** (chunk 23, from the owner's "a lot of the paragraphs we have could be like that"). `components/Hint.tsx` holds what a feature is and how a transaction runs once sent, in one of three places: beside a screen's title (`Screen`'s `hint`), beside a section's heading or a field's label (`Hinted`), or on a row of its own. A note stays on the page when it says what someone else learns or sees (a privacy note, Koios, giveme.my, Minswap), what an action costs or locks up, what can't be undone, what to do next, or what's happening now, and so does an empty list's line and a one-line note, where an icon saves nothing.
- **Short enough to read at a glance** (the owner, 2026-10-06: "Using the app is damn near a reading comprehension test"). A note always on screen is about 20 words, one or two sentences, and a screen's one core warning about 30; an error says what happened and what to do; an ⓘ stays under about 40. Say each fact once per screen, lead with the consequence, and leave out how it works inside, history and examples. Facts the rules above keep are shortened, never dropped.
- **Nothing new phones home without its own decision**, because of what a new host or query tells it. The pages' CSP keeps fonts, icons and images inside the extension (`font-src 'self'`, `img-src 'self' data:`, in `extension/src/manifest.ts`).
- **Every feature states its Koios cost, and anything paged scales with the contract's size.** The public tier takes 5,000 requests a day and 100 every 10 s from an IP address, and the wallet keeps to 40 (`RateLimit` in `extension/src/background/koios.ts`); a response holds at most 1,000 rows. The e2e tests assert the exact requests a screen makes.
- **Tests find controls by role, label and test id**, so a restyle doesn't break them; the few class selectors in `e2e/extension.spec.ts` only look inside a part (a phrase's words, a cut name, a review's rows). **A renamed control updates `e2e/extension.spec.ts` in the same commit, and `e2e/store-images.spec.ts` and [flows.md](flows.md) too:** the owner brought the documentation review ahead of the UX pass on 2026-10-04, on the understanding that the pass keeps the docs current as it goes. CI doesn't run the store images' spec, which is how it rotted; `tests/store-images-copy.test.ts` now fails `npm test` when English it fills, clicks or waits for is gone from `en.json`.
- **The name is Seedelf**, and Seedelf Wallet for the app. `extension/tests/words.test.ts` checks the source, and `extension/tests/i18n.test.ts` every locale.

## Preprod checklist before a release

On the built extension (`npm run build`, then load `dist/` unpacked), in the side panel and in a tab.

1. **The automated layers:** `cargo test --workspace --locked`, the WASM tests, `npm test` and `VITE_ENABLE_MAINNET=false npm test`, and `npm run e2e`. Then `LIVE_KOIOS=1 npx vitest run tests/live.test.ts`, and `node e2e/live/run.mjs all` on the funded test wallet. Keep the six hashes.
2. **Onboarding:** create a wallet from the toolbar button (it opens a tab), and once from the side panel (it opens one too): reveal, confirm three words, set a password. Restore that phrase in another Chrome profile and check the addresses match, and that Home says *Wallet restored* with what the phrase holds (nothing yet, for this one). Restore a 12- or 15-word phrase from Lace or Eternl, and check its account. **Restore a phrase that has used more than one account** (make one in Lace, or fund account 1's address): the picker appears on its own, and both accounts are there.
3. **Public accounts** (chunk 18): switch from Home's Public heading ("Public account 2 ▾") and from Settings → Public accounts, and check the balance, Activity, Receive, the UTxOs screen, Staking and the collateral are all the account you chose. Name one and check the name shows in the picker and on Home. *Look for the next account* with nothing there says so and costs one request. **Make private from two accounts, then send privately from the balance**: the review names both accounts and says the spend ties them together. Add an account by a number of your own (1338, say) that has never been used, and check it can be switched to and received into. On Send publicly, **Your accounts** offers the others and picking one says what the payment reveals rather than refusing it. The × clears each To field, on both sides and on Make public, and Make public offers **Your accounts** too. Past eight accounts the Settings list filters by number or name. **Settings → Sites picks the account sites use:** connect a site, switch the wallet to another account, and check the site still sees the dApp account and is never refused; then change the dApp account and check the site sees the new one.
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
   - stake with a pool from the browser, change pool, delegate the vote to a DRep by its ID, withdraw rewards, and stop staking;
   - become a DRep with the account's own vote, vote on a live governance action, change the profile, and retire as a DRep;
   - send with *Use staking rewards when spending* on, then off;
   - turn the connector on (Settings → Sites), connect one site to the public account and one to a private session, sign for each, and give a governance site such as GovTool CIP-95;
   - a private swap from the Minswap tile through to everything back, and one stopped partway;
   - a Lovejoin mix from each side, and **Bring one back now**;
   - **Show image** on an NFT, in each balance;
   - switch the language to Español and to 日本語, read Home and a review in each, and back to English.

   Read every review and every privacy note as you go.
7. **Mistakes and failures:**
   - Koios blocked (offline, or an ad blocker) says why, and recovers on Refresh;
   - amounts: more than the balance, seven decimals, letters;
   - a mistyped Seedelf name, and a `$handle` that doesn't exist.
8. **Nothing else is contacted:** in DevTools, the worker's network panel shows only `preprod.koios.rest` and `www.giveme.my` (and Minswap's preprod aggregator, for a swap, and `ipfs.blockfrost.dev` for an NFT image you asked to see).
9. **The store's build, both networks** (`npm run package`, `dist/` loaded unpacked in a fresh profile):
   - it opens on **MAINNET**, with no preprod strip;
   - Settings, Network: moving to preprod says first that its ADA has no value; then every screen, and the connector's window, shows the **PREPROD** badge and strip, and Home the preprod balances;
   - a payment reviewed on one network and sent after a switch is refused ("isn't ready to send");
   - a site connected on one network asks again on the other, and one waiting as you switch is declined;
   - on mainnet, the worker's network panel shows only `api.koios.rest`, `www.giveme.my` and `api.coingecko.com` (and `agg-api.minswap.org`, for a swap, and `ipfs.blockfrost.dev` for an NFT image you asked to see), plus `preprod.koios.rest` only for something still on its way on preprod.

## Web Store release: copy/paste procedure

This is the repeatable release path for a new Web Store version, in two parts. **The version and the refreshed token and DRep lists are committed on the release branch** (`web-wallet/release-<x.y.z>`), with the checks, and reach `main` through its PR. **The package is built after the merge, from the merge commit on `main`** in a clean tree, so the commit the handoff note records gives the same zip. Change `release_version` to the new, higher version for each later release.

**Which number.** The store only demands one strictly higher than the last, so the semantics are for the wallet's own users: a **minor** bump for a release that adds something a user can do (1.1.0, the transaction view), a **patch** for a fix or a listing hotfix on its own (1.0.1). The web wallet's line runs from 1.0.0 and is deliberately apart from the Rust workspace's 0.x.y — see the root [CLAUDE.md](../../../CLAUDE.md).

### 1. On the release branch: set the version and run the checks

From the repository root, on a `web-wallet/release-<x.y.z>` branch from `main`:

```bash
cd seedelf-platform
cargo test --workspace --locked
cd seedelf-web-wallet/extension
npm ci
release_version=1.3.0
npm version "$release_version" --no-git-tag-version
npm run tokens
npm run dreps
git diff -- package.json package-lock.json src/tokens src/dreps
```

Read those diffs (steps 2 and 3 of [Releasing to the Web Store](#releasing-to-the-web-store) say what to look for), and commit them together. Then the checks:

```bash
npm run build
npm test
VITE_ENABLE_MAINNET=false npm test
npm run e2e
LIVE_KOIOS=1 npx vitest run tests/live.test.ts
node e2e/live/run.mjs all
node e2e/live/run.mjs staking
```

Then complete the manual [preprod checklist](#preprod-checklist-before-a-release), including the dApp, private-session, swap, and Lovejoin flows. If the UI changed, regenerate the store images (`npm run store:images`), and bring the listing in [store/README.md](store/README.md) up to date. Commit them, and open the PR into `main`.

### 2. On `main`, after the merge: build and test the store package

From the repository root, at the merge commit, with nothing changed or added (`git status --porcelain` prints nothing):

```bash
git switch main
git pull --ff-only
git status --porcelain
cd seedelf-platform/seedelf-web-wallet/extension
npm ci
release_version=1.3.0
npm run package
npm run e2e
sha256sum "release/seedelf-wallet-$release_version-mainnet.zip"
git rev-parse HEAD
```

No `npm version`, `npm run tokens` or `npm run dreps` here. On `main` the bump fails ("Version not changed"), and the lists' refresh rewrites bundled files no commit has, so the zip wouldn't be the recorded commit's.

The package to upload is:

```text
seedelf-platform/seedelf-web-wallet/extension/release/seedelf-wallet-$release_version-mainnet.zip
```

With `package.json` at 1.3.0, that file is `extension/release/seedelf-wallet-1.3.0-mainnet.zip`.

`npm run package` builds the store's mainnet build (`VITE_ENABLE_MAINNET=true`, `VITE_STORE_BUILD=true`) and refuses one whose manifest lacks `https://api.koios.rest/*`. The second `npm run e2e` runs the whole suite against it, with preprod chosen before the wallet starts (the fakes are preprod's). Then do checklist item 9 by hand on it.

**Keep for the release record**, with the commit `git rev-parse HEAD` printed and the SHA-256:

- `wasm/build.sh`'s last line, `C compiler: <first line of clang --version>`, or `C compiler: unknown`;
- `scripts/package.mjs`'s `sha256 <hex>`, and the line after it, `Zipped with Node <version>, zlib <version>`.

The next `npm run package` overwrites a zip of the same version, so take the hash from the zip you upload, never from one rebuilt since.

`npm run package:preprod` makes a preprod-only store build (`-preprod.zip`) for tests. Never upload it.

### 3. Upload and submit

1. Open the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Choose **Add new item** for the first release, or open the existing item for an update. Upload `extension/release/seedelf-wallet-$release_version-mainnet.zip`.
3. Complete the **Store Listing**, **Privacy**, **Distribution**, and **Test instructions** tabs using [store/README.md](store/README.md).
4. Set visibility (**Public** for launch, or **Unlisted** for a quieter start), check the host justifications match the manifest's four hosts, and verify the privacy-policy URL resolves.
5. Submit for review.
6. Record the version, the commit it was built from, the zip's SHA-256, and the C compiler, Node and zlib lines in the roadmap's handoff notes, then share the store link with the intended users.

The official Chrome upload flow is also described in [Publish in the Chrome Web Store](https://developer.chrome.com/docs/webstore/publish/).

## Releasing to the Web Store

The listing's text, its images and the privacy policy are in [store/](store/README.md), laid out by the dashboard's tabs. The owner of the developer account uploads the package by hand.

**Steps 1 to 6 happen on the release branch and are committed in its PR; step 7 on runs on `main`'s merge commit**, in a clean tree. The privacy policy and the wallet's Settings link point at `main`, so the merge comes before `npm run package` ([store/README.md](store/README.md)).

1. **Bump the version:** `npm version <x.y.z> --no-git-tag-version` in `extension/`. It updates `package.json` and `package-lock.json`, and the manifest takes its version from there. Every upload needs a higher version than the last.
2. **Refresh the token list, every release** (the owner, 2026-10-08): `npm run tokens` in `extension/`. Read the diff of `src/tokens/registry.*.json`, and any "also claimed by" warning, before committing it. To add a token, vet its unit and put it in `src/tokens/list.json` first; `node scripts/tokens.mjs find <network> <TICKER>` shows the registry's entries for a ticker. The handoff note says what changed, or that nothing did.
3. **Refresh the DRep list, every release:** `npm run dreps` in `extension/`. It rewrites `src/dreps/<network>.json` with every registered DRep that has a name. **Koios's servers disagree about DRep metadata** (1.3.0's prep had three single-pass runs name 371, 407 and 406 mainnet DReps against the committed 449, each missing a different set), so the script asks again for the DReps still unnamed, in up to three passes. A DRep the committed list names that's still registered but that no pass names keeps its committed name, and a list that would still lose more than 5% of the committed one is refused with nothing written: run it again later. Its line for each network says how many passes it took, how many names it kept as committed, and how many committed DReps are no longer registered. Skim the diff for anything odd before committing it; the handoff note says what changed.
4. **Run [the preprod checklist](#preprod-checklist-before-a-release)** on a dev build (`npm run build`). The live runs expect the dev build's pinned ID.
5. **The images:** if the UI changed, run `npm run store:images` and look at `docs/store/images/`. They're made from the recordings on mainnet, so they show the MAINNET badge and no test-network strip ([store/README.md](store/README.md), *Graphic assets*).
6. **Commit and merge:** the bump, both lists, the images and any change to the listing's text, in the release branch's PR into `main`.
7. **Build the package**, on `main` at the merge commit, with `git status --porcelain` printing nothing: `npm run package` in `extension/`.
   - It builds with `VITE_ENABLE_MAINNET=true` and `VITE_STORE_BUILD=true`: mainnet by default, preprod in Settings, and no dev key.
   - It refuses a `dist/` with a key, one whose version doesn't match `package.json`, and one whose manifest lacks `https://api.koios.rest/*` (a preprod-only build).
   - The WebAssembly is built from the tracked `Cargo.lock` (`--locked`) with the pinned Rust (`rust-toolchain.toml`), and carries no local path.
   - It adds `licenses/THIRD-PARTY.txt`: every Rust crate compiled into the WebAssembly, every bundled npm package, and SecretBox, each with its licence text. It fails if one of them ships no licence and has no known fallback (`scripts/third-party.mjs`).
   - It writes `release/seedelf-wallet-<version>-mainnet.zip` and prints `sha256 <hex>`, then `Zipped with Node <version>, zlib <version>`. `wasm/build.sh` ends its part with `C compiler: <first line of clang --version>`, or `C compiler: unknown`.
   - The zip is reproducible: the same commit and toolchain (Rust, wasm-bindgen, clang, an official Node build) give the same bytes. Official Node builds 20 to 24 zip alike, and one linked to the system's zlib may not. blst's C goes through the unpinned clang on `PATH`.
8. **Test the store build:** `npm run e2e` runs every end-to-end test on it, with preprod chosen (`e2e/support.ts`). Load `dist/` unpacked in a fresh Chrome profile once, and do [checklist item 9](#preprod-checklist-before-a-release): it opens on mainnet, and the switch works both ways.
9. **Mainnet by hand, with small amounts,** before the first mainnet release: the launch review's step 5 ([archive/plans/launch-review.md](archive/plans/launch-review.md#launch-prep-order)): Minswap's CORS on `agg-api.minswap.org`, one swap each way and Stop; one Lovejoin box at depth 1 once the pool holds enough others' boxes; every Seedelf flow.
10. **Upload** the zip on the dashboard's Package tab. If the listing's text changed, copy it from [store/README.md](store/README.md). Then submit for review.
11. **Record it** in the roadmap's handoff notes: the version, the commit it was built from (`git rev-parse HEAD`), the zip's SHA-256, and the C compiler, Node and zlib lines.

## Sharing with testers before launch (history)

**Decided (chunk 11c): an unlisted, preprod-only Web Store listing.** Superseded on 2026-09-26, when one build came to carry both networks: the store's build is mainnet, with preprod in Settings for testing. See [store/README.md](store/README.md).

- **Zip of `dist/`:** testers load it unpacked the same way we do. It works, but it's clunky and gets no automatic updates.
- **Chrome Web Store, unlisted or private (recommended for the first testers):**
  - **Unlisted:** anyone with the link can install it.
  - **Private:** only named trusted testers can.
  - Either way it needs a developer account (a one-time fee) and passes normal review, and updates arrive automatically.
  - This is the best way to put it in front of the first group, such as the repo's stargazers.
- **Self-hosted `.crx` files:** these don't work for normal users. Chrome generally only allows installs from outside the store through enterprise policy.
