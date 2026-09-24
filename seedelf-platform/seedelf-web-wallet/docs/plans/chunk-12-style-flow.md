# Chunk 12 plan: the style and flow iteration

v1 is built (chunks 1–11c). The user found 11a's pass "kind of looks like Lace but also totally does not", so this chunk works through the user's own list: mostly small front-end changes. Branch `web-wallet/style-flow`, one PR into `seedelf-web-wallet`.

**How it runs:** the user tests the built extension and sends findings. Each finding goes in the list below with what was decided. Batches land with popup and tab screenshots for the user to check before they rebuild.

## Start here

1. `git fetch origin && git checkout web-wallet/style-flow`
2. Read this plan and the newest roadmap handoff note.
3. Build and test (from `seedelf-platform/seedelf-web-wallet/extension`): `npm run build && npm test && npm run e2e`.
4. Ask the user for new findings; add them to the list.

## Rules that still hold

- Lace is inspiration for look and flow, not a brand to copy: no Lace purple, fonts or logos (plans/chunk-11-polish.md).
- **Every privacy note stays.** A redesign can move or shorten one, never drop it.
- Correctness UX is always in scope: clear errors, input limits.
- Nothing new phones home. A new host or query needs its own decision, because of what it tells that host.
- **Koios budget.** The wallet uses Koios's public tier: 5,000 requests a day, at most 1,000 rows a response, a 30 s timeout. Every feature states how many requests it costs, and anything paged must scale with the contract's size. The e2e tests assert the exact requests a screen makes, as Home's already does.
- The tests find things by role, label and test id. A renamed control means updating `e2e/extension.spec.ts` in the same commit.

## The list

| # | Finding | Decision | Status |
|---|---|---|---|
| 1 | Home shows "— ₳" and empty lists while it loads. Lace covers loading with an animated logo overlay. | **A splash only while there's nothing to show:** the first reading after an unlock, restore or create. A cached reading shows Home at once. The emblem on navy, breathing, with a teal arc orbiting it. When the balances arrive it fades out into the wallet (the emblem grows slightly). It gives up after about 8 s so a slow Koios can't hide Refresh or an error. Static under reduced motion. | ✅ built; the user checks |
| 2 | The Seedelf identity card (the public value) isn't needed: users have no use for it anywhere. | **Drop it from Home.** The worker keeps `seedelfPublicValue` in `account`, because a unit test checks key derivation end to end through it. | ✅ built; the user checks |
| 3 | A flat token list breaks with hundreds of tokens. Match how Lace handles them. | **Home shows the first 5, then "View all N".** A Tokens screen has **Tokens and NFTs** tabs, a search (name, ticker, policy ID, fingerprint) and a sort (name or amount). Tapping a token opens its details (policy ID, asset name, fingerprint, each with Copy). NFTs are told apart without new queries: CIP-68 label 222 is an NFT, 333 and 444 are fungible, and otherwise a single unit with no decimals is an NFT. Avatars are the logo, or the name's first two letters. | ✅ built; the user checks |
| 4 | Fungible token data (ticker, name, decimals, logo) hardly changes, so ship it in the wallet instead of querying for it. It's refreshed at each release. | **A curated registry per network, bundled.** A hand-kept list of token units per network. `npm run tokens` pulls each one's registry metadata through Koios `asset_info` at build time, shrinks logos to 96 px WebP, and writes the bundle. It's seeded with preprod (tUSDM, the one registered token testers are likely to hold) and mainnet (25 well-known FTs, each the only registry entry for its ticker). The release checklist runs it. Tokens off the list show their own name and a letter avatar, so a lookalike ticker never gets a real logo. | ✅ built; the user checks |
| 5 | Modals must be centred; a token's details were cut off when it sat low in the list. | **One `Modal`, centred,** never taller than the window, with its body scrolling. The popup is sized by its page, and a `<dialog>` doesn't count towards that size, so the old bottom sheet could spill past it. The details' ids read as plain rows, so they fit without scrolling. | ✅ built; the user checks |
| 6 | Move in any amount of a token, not only all of it. | **An amount box per token, with Max for all of it** (`TokenAmounts`, as in Send and Withdraw, which gain Max too). The Rust `build::move_in` takes `(policy, name, quantity)`; every UTxO holding the token is still spent, and the rest goes back with the change. It refuses more than is held, or none. | ✅ built; the user checks |
| 7 | "Cardano account" is long next to "Seedelf" in Home's tabs. | **The tab says "Cardano".** The balance under it still says "Cardano account". | ✅ built; the user checks |
| 8 | Lace has settings; we have none. | **A Settings screen**, from a gear in the top bar: show the recovery phrase (password first), change the password, remove the wallet, About. No Koios requests. A wrong password here counts towards the unlock back-off. | ✅ built; the user checks |
| 9 | Lace has an activity list; we show only the transaction just sent. | **Activity.** Cardano account: `account_txs` (newest first, then only after the last-seen block) and one batched `tx_info` per page of 20, only while Activity is open. Seedelf: no requests at all, and never a question about a specific transaction: received UTxOs from the scan, and what this wallet sent. The history is kept **encrypted on the device** (a key derived from the phrase), unreadable while locked. | ⬜ |
| 10 | Lace has an address book. Seedelf names are 64 hex characters. | **Contacts:** named seedelfs and addresses, **encrypted on the device** with the history's key, offered in Send and Withdraw. No Koios requests. privacy.md's "never on disk" becomes "never on disk unencrypted". | ⬜ |
| 11 | Forms list every token (the follow-up below). | **A token picker** like Lace's "Add assets": search, pick, then an amount box for each picked token only, with Max and ×. Move in, Send and Withdraw. No Koios requests. | ✅ built; the user checks |
| 12 | The balance reading pulls the whole contract, 1 request per 1,000 UTxOs, and the contract only grows. | **An incremental scan.** A full scan on unlock and every 30 minutes; in between, only UTxOs newer than the last-seen block (`credential_utxos?block_height=gt.N`, checked live: 5 of 35 rows in one request). The wallet drops its own spends as it makes them; the full scan catches another device's spends and rollbacks. The owned set stays in session memory. Checked live: the second reading filtered, and agreed. | ✅ built |

**Compared with Lace (2.4.0) and left out on purpose:** hardware wallets, swaps, Buy, other chains, mobile, analytics, the light theme (decided earlier); NFT images and fiat prices (new hosts: IPFS, CoinGecko); Identity Center, Passport, RealFi, Earn Rewards, the dApp Explorer and Lace's notification centre (Lace's own); languages, `web+cardano:` links and a QR scanner (not yet worth it). The dApp connector, Authorized dApps and the collateral setting come with the contract round trip, after v1.

## Follow-ups noticed on the way

- Before mainnet: the mainnet list's logos are base64 in the JavaScript bundle (a mainnet build's UI grows from 299 KB to 418 KB). Ship them as files instead.
- At the end of the chunk, regenerate the store images (`npm run store:images`), since Home's rows changed.
- Mainnet tokens left off the list, for the user to vet: MILK, C3, NMKR, MELD, WRT and WMTX (several registry entries each), BOOK (its asset name reads HODOR) and USDCx (not confirmed).
