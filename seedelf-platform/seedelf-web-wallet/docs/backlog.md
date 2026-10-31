# Backlog

What could become a chunk, the calls still open for the owner, and what's declined. **Nothing here is a promise.** The wallet is feature-complete for Cardano, and the work now is getting it to users: a feature comes from what they ask for, and a line here becomes a chunk only when the owner picks it ([plans/README.md](plans/README.md)). What's being built is whatever is in [plans/](plans/).

**One line an entry.** The detail (the reasoning, the measurements, a review's recommendation) is in the plan or review a line names, or in [archive/post-release-roadmap.md](archive/post-release-roadmap.md), which held every entry in full until this file replaced it (2026-10-31): search it for the line's ID. A chunk that picks a line up checks it against the code as it is now.

**Keeping it short:** a chunk or a review that leaves something open adds a line in its area, with the ID it's cited by. The chunk that settles a line deletes it, since its plan is the record: no ✅, no strikethrough. Status: ⬜ a candidate · ❓ the owner's call · ⛔ blocked.

## The owner's open calls

- ❓ **`rustls` instead of `native-tls`** for the CLI's `reqwest`: the eight `openssl` alerts stop recurring, and the CLI loses its OpenSSL build dependency. A feature-flag change in `seedelf-koios` and `seedelf-display`, checked by the live Koios tests.
- ❓ **Spanish "Configuración" for Settings**, in place of "Ajustes": the whole-locale review's choice, applied everywhere, the owner's to overrule.
- ❓ **A chain through Lovejoin once it's all sent** (1.3.0's release review, C28): its last four transactions, and all of a chain of four or fewer, leave the list and the view once sent, before they land. Keep a sent chain viewable until its last lands, or audit it afterwards in Activity.
- ❓ **Should a restore run the restore scan by itself?** (1.5.0's release review, C07): every restore asks about 20 one-time accounts, and the Restore screen doesn't say so. Keep it, say so before **Restore wallet** (a critical string), or leave it to **Find leftovers** (the most private default).
- ❓ **Polling for money coming in** (the blind test's Appendix B, row 12): Home reads the balances when it opens, then not again while it stays open, so a deposit shows only after Refresh. On mainnet the private side's read is nearly free; the public side's repeats the account's read and needs a privacy policy entry.
- ❓ **The public balances across a lock** ("Couldn't read your balances" on mainnet, 2026-10-08): chunk 26 keeps the private side's rows sealed across a lock; keeping the public side's last balances is a privacy trade, balances at rest. Or name the request that ran out of time in the error's details.
- ❓ **The usability review's calls** ([its *Left for the owner*](archive/plans/usability-review.md#left-for-the-owner)): renaming Make public, UTxOs behind Advanced, two decimals, a password on the wallet's own sends, the frame after create (L-1, C2), which side a transaction in flight holds (HM-3), whether the splash's 8 s cap still bites on mainnet since the data layer; and ST-3, GV-2, LJ-3 and CW-3 to confirm.
- ❓ **The blind test's calls** ([its *Left for the owner*](archive/plans/blind-task-usability-test.md#left-for-the-owner)): a dozen of its fix round's own calls to confirm or reverse, and a site-signed transaction's change not counted as on its way.
- ❓ **The UX pass's third round** (chunk 23 began it with two usability reviews and a blind test): the rest of its list is the owner's to write, from using the wallet.
- ❓ **More ⓘ hints:** which other note paragraphs go behind an icon, by [development.md's rule](development.md#rules-for-a-change-to-the-screens). Privacy callouts and warnings stay where they are.
- ❓ **Asking Minswap to list Seedelf Wallet** (outward-facing): its wallet list is fixed, so its own site never offers this wallet, and answering as Eternl would be impersonation. Listed, its site would reach the connector and private CIP-30.

## Owed

Promises the repo has already made, by the IDs the code and the docs cite (O1 to O10; the others are done or dropped).

- ⬜ **O2, the by-hand mainnet swap checks:** done for every route but Splash and Spectrum, which are dead in the water (the owner, 2026-10-08), so theirs are very low priority. No re-run is asked: the first real swaps of each release are the live check of the dry-run cancel (C05) and of Danogo's collateral (C21). The owner's.
- ⛔ **O4, A2, the contract round trip:** a DEX order paying straight to a Seedelf ([flows.md](flows.md#contract-round-trip)). SundaeSwap V3 first, then WingRiders V2, each with the wallet's own order builder; preprod's V3 has no scooper, so the test is mainnet's. Blocked on a batcher test.
- ⬜ **O6, chunk 21 by hand:** retiring a DRep live (which confirms the ledger drops delegations to a retired DRep), a profile update live, and GovTool over CIP-95. The owner's.
- ⬜ **O9, tell Lovejoin what we found:** its configs swap Seedelf's preprod and mainnet reference UTxOs, its mainnet `mix_script_hash` is null, and its withdraw to the Seedelf contract writes no datum, so anyone can take that box. Outward-facing, so the owner's.

## Network privacy

- ❓ **Tor inside the wallet: parked** (the owner, 2026-10-27: "I want to approach this the right way"). tor-js has no Snowflake, so a browser needs a gateway, and a gateway of ours would see both ends. The spike's findings and the cheaper routes (bring your own Tor, split who sees what, Nym's mixFetch) are in the archive's *Kept in mind*.
- ⬜ **The privacy review's optional controls** ([archive/plans/privacy-review.md](archive/plans/privacy-review.md)): which sites see the wallet (§4.4), longer Lovejoin waits (§4.5), clearing private history (§4.6), spreading out Bring everything back (§4.8), §4.9's smaller switches, and a data layer of your own (§4.7). And how long a chain takes, at the lock countdown (§6).
- ⬜ **Drafts that still reach Ogmios at review** (privacy review §3.10): the account-paid mint's draft and a chain's `crossCheck`, so a review the user abandons still shows the Seedelf name or the planned deposit.

## The data layer

From chunks 26, 26b and 26c ([archive/plans/](archive/plans/)). None breaks anything.

- ⬜ **The wallet's side:** a paged snapshot for a restore past about 60,000 contract rows; a sealed cursor whose `since` keeps answering 503; Activity's "more" page across a part's flip (X08); a clock stepped back about 200 s between a send and a reading; three rare paths that still ask `tx_status` or `utxo_info` on the public side.
- ⬜ **The server's:** Caddy's own error pages carry no HSTS or CORS headers (a Caddyfile change, the owner's by hand); many wallets behind one IPv4 address share a bucket; the data client's window (20 live-SQL requests every 10 s); small query work (`query_typed`, single-flight).
- ⬜ **Later, if ever:** a private-history restore from unpruned Kupo; view tags, a contract change and so a new variant, cutting a restore's checks about 256×; a pruned Kupo for account UTxOs, if db-sync measures slow.

## Lovejoin

- ❓ **A lock uses up a held collateral's mix** (LIVE-1): each cut counts as one of `TAIL_TRIES`, so with giveme.my down two idle locks end it, unasked. Recommended: count only builds that failed for another reason.
- ❓ **The collateral mix's way out, what's left** (pr337#0, pr337#1): a return review built before the press and sent after it still sends the mix (keep, recommended); Bring every box back now leaves that box to its day; a site's session paid again the same day can offer the way out again.
- ❓ **Waiting parts across a lock** (321-parts-worker#0, #2; x-upgrade#1): after a wipe Home can't say what didn't go. A sealed record of a payment's progress would, with its own privacy policy entry; parts that go after the unlock would be new.
- ⬜ **The collateral's mix paid from a token UTxO's ADA** (R3-10's option (a)): `direct_tail` taking that UTxO's ADA, its tokens back as the deposit's change.
- ⬜ **Fund with the reserve when the 5 ₳ pool's look fails** (#324's call 7): `tailReserve` adds nothing on `may` today, where Max keeps it. Recommended, the more private default.
- ⬜ **A public mix's pick of a token's UTxOs** (R3-14): `chain_from_account_at` refuses where ADA alone falls short, rather than take more of them.
- ⬜ **The Bootstrap form's room** (pr333#0, pr333#3): its 2 ₳ for the funding's fee and change is fixed (`FEE_ROOM`), and a Bootstrap whose byte got dearer comes back with no box where one fewer would go.
- ⬜ **A 1.5.0 public seed whose record went before the update** (316#1's case (a)): its box comes back tied to nothing. Recommended: say so in privacy.md.
- ❓ **Which boxes tie a public account** (R3-2, R3-3): the payer order and a withdraw's history use different models.
- ⬜ **Four boxes a mix and a later token** (319-rust#1, 319-worker#1): four wide can leave a later leg no box where three would mix it.
- ⬜ **A box's dropped withdraw, taken again later, counts back twice** (w-left's call 1): only Bring every box back now's are kept apart.
- ⬜ **Home's two-window watch has no test** (R3-20): one e2e case covers it.
- ⬜ **A five-minute room cache for funding reviews** (x-privacy#3): every private funding reads every pool again.
- ⬜ **Put in 5 ₳ for Lovejoin doesn't read the pool** (1.5.0's release review, C53).
- ⬜ **Four wide waits on the CPU limit** ([lovejoin-mix-width.md](lovejoin-mix-width.md)): reasonable from about 11 billion `max_tx_ex_steps`. Run `lovejoin_width_test -- --ignored` again after a hard fork or a parameter change.
- ⬜ **`MIX_FEE_ESTIMATE` is 0.95 ₳**, against the 0.8225 ₳ a mainnet mix measured.
- ⬜ **On the Lovejoin page:** a mix whose funding never landed can't be forgotten; each box's due time, Home's banner for withdraws that run themselves, and a *Through Lovejoin* switch on Make private (the owner: "maybe not") were offered and never decided. A public mix has never run live.
- ❓ **Chunk 34's leftovers** ([its plan](archive/plans/chunk-34-token-pools.md): *For the owner*, and each session's notes):
  - the collateral's mix on a swap's approval with no box (Session 12's call 5);
  - R11, a restored device's Bootstrap hold; MERGED-1's mainnet limit (no copy pool after a restore while our server is up); STATE-2; R2, preprod's floor;
  - what a classic-only user sees since 1.6.0 (*four-switch-classic-bend*), and the dApps tile's "Mix ADA in 10 ₳ boxes";
  - a box not mixed yet's words; a stopped-parts banner that comes back for an hour; D2, what replaces the 30-box floor;
  - a waiting part refused by a Koios behind the chain; the history-first planner's 25 s refusals; Mix again below the floor; `CollateralTail` repeating core's `Tail`;
  - the rehearsal review's lows (DATA-4's second half, an unmixed Bootstrap box's class, `LaunchRecord.account`, the swap approval's total counting tokens);
  - Session 5's questions, and the calls Claude made along the way, each the owner's to overturn.

## Swaps and dApps

- ⬜ **More of Minswap's routes** (chunk 24): SundaeSwap V4 once Minswap's router names it, SundaeSwapStable, VyFinance, CswapV1.
- ⬜ **Multi-hop routes**, off since chunk 24: a later leg's order is one the session can neither check nor cancel.
- ⬜ **Splash, very low priority:** a partial fill has never run live, and a remnant no cancel can spend would hold its swap's return (1.3.0's release review, C02).
- ⬜ **A timed partial return after a swap's cancel** (independent review L16), once a live check shows a cancel works from a small reserve.
- ⬜ **Swaps straight against a pool**, not through the aggregator (chunk 15b).
- ⬜ **More dApps on the dApps page:** each entry claims the dApp works privately, so each needs its own test run first.

## Sessions and restore

- ⬜ **A swap or a mix another browser brought back stays open here** (1.5.0's release review, C18): the money is safe, and the page waits for good.
- ⬜ **A swap that runs itself can't cancel the order a return from before chunk 24 left open** (chunk 32; X01, L6).
- ⬜ **A session's stake key registered from another account's site keeps its deposit there** (X05, L2): nothing in the wallet deregisters it.
- ⬜ **A found session waiting to end, and a mix's chain cut before it began, on the other screens** (L4, L5): each needs a word of its own.

## Activity

- ⬜ **Load more after a burst** (C03, X08, L7): rows a catch-up listed come back on the next pages, and a press reads on up to ten pages.
- ⬜ **A Refresh during a Load more** (G2): disable Refresh while a page loads.
- ⬜ **A CSV of the rewards** (chunk 30), for taxes, as Activity has one.

## Signing and the connector

- ⬜ **Private spends carry no validity interval** (launch review, *Still open* #2): waits on a live check that giveme.my signs one.
- ⬜ **A site's `submitTx` refusal lost the node's own reason:** `KoiosError` would have to carry the node's text apart.
- ⬜ **The connector never offers to set a collateral** (chunks 12, 31), as Lace 2.x doesn't: it waits for a site that needs it.
- ⬜ **Show image and the connect window's CIP-95 switch** have never been through a findings round.
- ⬜ **An arrow that turns itself off drops the focus** (pr335#4): in Transaction details' parts and in the box stepper. Move it to the other arrow, in both.
- ⬜ **The launch review's smaller items** (its *Still open* #5): #14 and #15's refusals reach only the site; a chain's last window isn't watched until it lands; chain records live on one device; the Lovejoin page's buttons while a payment may still go through; one maybe-sent watch per network; `swaps.review.noBox` without the amount.

## Smaller features

- ⬜ **A DRep paid from a one-time account** (chunk 21), to keep the DRep apart from the account.
- ⬜ **A live minimum before Review** (chunk 12): it needs the protocol parameters.
- ⬜ **The mainnet token list's logos are base64 in the bundle** (about 153 KB for 32 tokens); files would be smaller.
- ⬜ **A search by tag** (chunk 9) and **a QR scanner** (chunk 12).

## Security and dependencies

- ⬜ **The password is hashed as typed**, not Unicode-normalised (crypto review, *Not fixed* #3): an unlock would have to try both forms and reseal.
- ⬜ **RustSec advisories Dependabot doesn't raise:** `h2` and `spin` in the CLI (at its next change, `cargo update -p h2@0.4.11 -p spin`); `crypto-bigint` 0.5.5 in the WebAssembly, through `uplc`'s `k256`, which no secret goes through (it waits for a `uplc` on `k256` 0.14); the data layer's `ctutils` 0.4.3 and `tokio` 1.53.2 (at its next change, deployed through the workflow).

## Leios

From the headless run on Musashi (1.7.0's item 8). Its branch, `web-wallet/leios-musashi`, stays unmerged, with the harness and the record.

- ⬜ **Dijkstra refuses the wallet's script transactions as core builds them:** redeemers as a list, where protocol version 12 takes only a map, and certificate 0 for a pool's launch. A Pallas update, then a CLI and a web wallet release, much later (the owner, 2026-10-28); core's zero-withdrawal patch and `uplc` move with it.
- ⬜ **What Leios would change in the wallet:** a chain's window in flight could be the whole chain; core's fee doesn't count Dijkstra's reference-input fees, and holds as Conway's constants what Dijkstra makes parameters; `cbor.ts` refuses Dijkstra's three-element transaction from a site.

## The CLI

- ⬜ **`sweep` of 21 or more distinct tokens without `--lovelace`** (321-parts-rust#0): the shared builder refuses its default, one output's minimum. Take it from `build::minimum_address_payment` at the CLI's next change.

## Declined

The owner's calls. Don't propose these again without something new.

- **Cardano parity with Lace's extension is closed** (Lace 2.4.2, judged 2026-10-02 and passed over again on 2026-10-14; [the table](archive/post-release-roadmap.md#where-cardano-parity-stands) is in the archive). Declined from the second pass: the deterministic-nonce signature scan, CIP-142's `getNetworkMagic` (there's no preview network here), fiat values for native tokens, and NFT folders.
- **Dark only, and one recovery phrase.** No light theme or theme picker, and not a gap.
- **Several pools per account.** One pool per account is the model, and several accounts spread stake across pools anyway.
- **Folders and an account centre.** A picker, a name, and each account's own staking and collateral were what the gap was (chunk 18).
- **A Seedelf key per account.** One private balance for the whole phrase (the owner, 2026-10-02): stealth addressing already unlinks the move-ins.
- **Reading several accounts at once, or a total across them.** Either would link them, at the server and on screen.
- **The rest of governance** (chunk 21): proposing actions (100,000 ₳ on mainnet, and nothing a wallet's user needs); script DReps, the constitutional committee and pool votes; and, unless the owner asks, a rationale on a vote (a CIP-136 anchor, which could work the way the profile does) and tallies per action (`proposal_voting_summary`, one more request an action).
- **A notification centre** (the owner, 2026-10-11: no build for now). It would mostly repeat Activity and Home's banner: a private payment can't be found while the wallet is locked, and no Cardano extension says money came in. What's left of it is Home reading again while it's open, under [the owner's open calls](#the-owners-open-calls).
- **`web+cardano` payment links, CIP-13** (the owner, 2026-10-29). A phone feature, which Lace has only on mobile. A click from a site reaches an extension only through a web-accessible page, which would let any site detect the wallet. Look again for a mobile app, or if the CIP goes Active or Lace's extension adds it.
- **Hardware wallets.** They can't hold the private side: [the proof](#why-hardware-wallets-cant-cover-seedelf).
- **Earn / RealFi USDr staking, and CIP-99 claims.** Likely AML/KYC, which doesn't fit Seedelf.
- **No chain but Cardano and Midnight, and no mobile, for now.** Midnight is chunk 38.
- **Nothing that reports on the user or ties them to an identity:** analytics, AML/KYC, an on-ramp (the owner, 2026-10-02).

### Why hardware wallets can't cover Seedelf

Not declined for effort — it doesn't work, and the reason is one line of the derivation.

**The Seedelf secret scalar comes from the BIP39 seed** ([derivation.rs](../../seedelf-crypto/src/derivation.rs), v1, frozen):

```text
seed = BIP39 seed of the phrase          PBKDF2-HMAC-SHA512, 2048 rounds
okm  = HKDF-SHA-256(ikm = seed, salt = "seedelf-wallet-v1",
                    info = "seedelf-key" || u32_be(account), L = 64)
x    = int_be(okm) mod r
```

1. **A hardware wallet's one guarantee is that the seed never leaves it.** So outside the device there is no seed, and without the seed there is no `x`.
2. **Inside the device there is no path either.** A Cardano app would have to implement Seedelf's HKDF *and* then the BLS12-381 Schnorr proof over it (`z = r + c·x`, with `c` binding the one-time key hash). The Cardano apps sign Ed25519 over a transaction hash; none exposes arbitrary BLS12-381 scalar work, and none ever will on our ask.
3. **So hardware could only ever hold the public account's CIP-1852 keys** — half the wallet — while the private side still needs the phrase in the browser. A wallet that is half secured by a device is a worse thing to explain than one that isn't.
4. **And it's structural.** The v1 derivation is frozen, because every existing phrase depends on it; there's no redesign that reaches a device without being a v2 scheme no device implements either.

The same argument rules out air-gapped QR signing for the private side, for the same reason.
