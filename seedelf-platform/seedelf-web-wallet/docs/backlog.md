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
- ❓ **A stranger's certificate alone leaves a site's staking callout informational** (chunk 39, #357): a proposal whose deposit goes back to a key that isn't the account's makes it a warning; the plan said a stranger's certificate would too, and it never has.
- ❓ **The critical-words gate reads key names, not values** (1.7.0's release review, *Lessons*): a critical value changed with no fresh back-translation passes CI. A hash of each value beside its verified key would catch it.
- ❓ **`lj.rewardsMovedReview` in Bring everything back's failed list** (1.8.1's release review, guard#10): its warn callout shows each send error's own words, `sess.spentSince` and Koios's too, none of them critical but `lj.warn.rewardsMoved`, which worker#1's rethrow puts there for a return's chain refused for its pool's balance: the route is older than the rule, and `tests/i18n-worker-reasons.test.ts`'s hand-kept list (`RUNTIME`) doesn't name it. Listing it takes `.warn.` names and a blind round for every error that can reach it; or it stays as precedent.
- ❓ **The release refreshes trust Node's own CA store** (1.7.0's release review, pr327#0): `npm run tokens`, `dreps` and `lovejoin-pools` fetch Koios through a Node whose built-in store still trusted emSign ECC Root CA - G3, the root GHSA-6q48-6c7w-9gw2 is about, and their answers ship in the bundle.
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

- ❓ **A line on a review that takes a pool's reward balance** (chunk 43's call 1): a return's review counts it in what comes back, and a public mix's or Mix again's in *Public account after* (1.8.1's release review, readers#1), which can be far more than went in; one short line, only then, naming it as what sat in the pool's reward account for anyone to take. Built without it.
- ❓ **Refusing a site's payment to an address whose stake part is a pool's `mix_logic`** (chunk 43's Step 5): it puts nothing in the account, whose stake can't be delegated, so the signer refuses only what pays into the account itself.
- ⬜ **Building the rest of a chain a moved reward balance cut short** (chunk 43's call 2): it stops as a refused chain does, its boxes waiting for Mix my boxes again; worth a chunk only if cut chains turn up.
- ❓ **The wallet's own transactions in one pool race for its reward balance** (1.8.1's release review: worker#2, readers#3, readers#2, worker#3). Each refusal comes before any script runs (phase 1, or Send's own read), so nothing is lost: the flow refused says *The network refused it: Lovejoin's pool changed as it was sent. Nothing was lost.* (a chain stopping after its deposit, its boxes not mixed yet), or, at Send, *Lovejoin's pool changed since you reviewed this. Review it again.* Only an order fixes it (first built or first sent, or no build in that pool until the take is in), the owner's to pick: each fix proposed moved the refusal elsewhere, and two conflict.
  - A session's collateral tail alone in its pool holds the balance from Send until giveme.my signs: the wallet's other flows there build on 0 and are refused (worker#2).
  - Bring everything back over two or more sessions through one pool counts the balance in each return, and Send refuses all but the first; a review made again before the first's take is in stops the next return's chain after its deposit (readers#3).
  - A take that landed counts as on its way for up to two hours, so a new balance as large reads as none (readers#2).
  - A box's way back that may have gone, having taken a balance another transaction then took, is sent again for two hours, and every other way back waits (worker#3). Seen in 1.8.1's live check with a faked read: Koios answered the first submit 500, and every resend got the node's `ConwayIncompleteWithdrawals`, which a resend ignores.
- ⬜ **The 'Koios behind' rules never see a name** (1.8.1's release review, v-pv11-impact#2, and its review of its fixes, r2-worker#1, r2-worker#2, r2-tests#1): tailWitness's and unstale's were built and tested against an invented 3117 naming the unknown input; Ogmios names it only in a 3004's reason, so a collateral's mix evaluated a block behind its deposit stops its chain (*Lovejoin's pool changed while the wallet read it.*), and a build again avoids nothing, ending in *Try again in a minute*. Naming it from that reason, tried and reverted in 1.8.1's fix rounds, reached tailWitness, unstale and Mix again together: a collateral's mix whose own box another wallet drew waited a day, and Mix again took the wallet's own boxes for gone. Rework them together. Only preprod, or mainnet with Koios as a fallback, reaches them.
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
- ⬜ **D3 at width 4 ignores the collateral's tail** (1.8.0's review of its fixes, r2-worker#0's trace): with four asked and the collateral's two draws held, at 4 boxes free (depth 1) or 16 (depth 2) three and four each make one box, so four goes and its box leaves that mix one draw: the 5 ₳ comes back unmixed where three would mix both. D3's rule stays as it is for now (the owner, 2026-11-06).
- ⬜ **A box's dropped withdraw, taken again later, counts back twice** (w-left's call 1): only Bring every box back now's are kept apart.
- ⬜ **Home's two-window watch has no test** (R3-20): one e2e case would cover it, the Collateral page open in a second window as its payment lands, then Home reading the balances again.
- ⬜ **One listing through a whole build** (x-privacy#3): a return's build lists every pool twice with its collateral on (its collateral's pick, then its chain's own read). A review's look for its collateral shares the review's one read, kept five minutes, since 1.8.0's review of its fixes (r2-worker#1), but a mix's (below).
- ⬜ **A mix's review and Mix again's list the pools twice** (1.8.0's review of its fixes, r2-worker#1's trace): `fits`' or `againBoxes`' read, and `tailReserve`'s, kept fresh for P1's draws, since 1.7.2. One read would need theirs handed on to `tailReserve`.
- ⬜ **One rule for the collateral's pool** (1.8.0's release review, last-code#0's trace): `collateralRoom` (a review's look) and `collateralPool` (a mix's review, a build) each apply the ask, `usableNow`, the floor and the mix's two draws. Tests pin both copies; one shared predicate would keep them from drifting. It touches the build's read, so after a release.
- ⬜ **Put in 5 ₳ for Lovejoin reads the pool for its floor alone** (1.5.0's release review, C53; 1.8.0's release review, critic#1, which added the floor, on mainnet): not whether it has boxes free for the mixes.
- ⬜ **Put in 5 ₳ under the floor is offered, then refused** (1.8.0's review of its fixes, r2-critic#5): the session list reads only what's kept, so it offers the 5 ₳ where nothing was read lately, and the press, reading the pool, refuses it: "Its return needs no 5 ₳: as things are, it doesn't go through Lovejoin." Kept, so the list stays quiet (the owner, 2026-11-06).
- ⬜ **Four wide waits on the CPU limit** ([lovejoin-mix-width.md](lovejoin-mix-width.md)): reasonable from about 11 billion `max_tx_ex_steps`. Run `lovejoin_width_test -- --ignored` again after a hard fork or a parameter change.
- ⬜ **`MIX_FEE_ESTIMATE` is 0.95 ₳**, against the 0.8225 ₳ a mainnet mix measured.
- ⬜ **On the Lovejoin page:** a mix whose funding never landed can't be forgotten; each box's due time, Home's banner for withdraws that run themselves, and a *Through Lovejoin* switch on Make private (the owner: "maybe not") were offered and never decided. A public mix has never run live.
- ❓ **Returns in 5 ₳ boxes cost twice the fees for each ₳ mixed** (1.8.0's release review, P3): and one chain carries 160 ₳ two waves deep, the rest back at once ([privacy.md](privacy.md#known-links)). The owner's to weigh: a return's default depth, a pool of larger boxes for returns, or a chain cap counted in ADA.
- ❓ **Settings' Lovejoin row says returns are mixed on the switch alone** (1.8.0's release review, critic#6): with no 5 ₳ pool, or one under its floor, they come back directly. It describes the setting; a short state from the worker's view, as the connector's lines have (O3), if the owner wants one.
- ❓ **A v2 token pool on preprod** (1.8.0's release review, release#11): every token pool there is retired, so the preprod checklist's token-pool items wait for one. Every preprod wallet sees a pool once it's started: the owner's call.
- ⬜ **A v2 token pool launched later, on Koios paths** (1.8.0's review of its fixes, r2-critic#1): once a 5 ₳ pool is kept, it's found as Lovejoin's page opens, at a pool's start or at Settings' Bring every box back, never at a Review or a return. Widening the look is for after 1.8.0 (the owner, 2026-11-06): it would add a holder read at most Koios-only returns and reviews holding a listed token.
- ⬜ **The look's and the lists' throttles live in a worker's memory** (1.8.0's review of its fixes, r2-critic#2): at most every five minutes while the worker runs, the data layer's list's and the public look's too, and the docs say so. A firm bound would keep them in session storage, all together, with Remove wallet clearing them.
- ❓ **A retired pool's page shows the whole Mix form** (1.8.0's release review, the e2e lane's note): its cost rows for boxes it can't take, then Review off with the reason, on the page every 1.7 user with boxes lands on. For the owner, with the style pass.
- ⬜ **A resumed collateral's mix draws its boxes at build and reserves them at Send** (1.8.0's release review, the share lane's note on P2): `buildBack`'s `tailChain` branch, as a direct return's mix did before P2, so Bring everything back can have one Send refused. A fix reserves there too, `tailChain` taking `avoid`.
- ⬜ **With no 5 ₳ pool, a return whose tokens go says nothing of its ADA** (1.8.0's release review, the chain lane's note on O5): its switch says the tokens are mixed (`onTokens`), and nothing says why the ADA came back unmixed, as under that pool's floor.
- ⬜ **The swap's Plan says "directly" with no 5 ₳ pool known** (1.8.0's review of its fixes, r2-worker#4), while its return may find one and mix the ADA and the 5 ₳: its warn line and its choice are hedged, its last step isn't. Kept, as 1.6.0's DX-3 left the same step for a pool short of room (the owner, 2026-11-06).
- ⬜ **The connect window's card keeps the approval's mark** (1.8.0's release review, the connector lane's note on O3): back from a funding review that read room, the card stays hedged until the next connect.
- ⬜ **A mix's and Mix again's review read the parameters before refusing a retired pool** (1.8.0's release review, R8's `sessions.ts` half): `mixOutBuild` and `againBuild` read `epoch_params` first. The screens never ask them of one. A nit.
- ⬜ **A retired pool's run that 1.7 left going keeps when it was asked** (1.8.0's release review, the retire lane's note on R1): a box another retired pool got from a 1.7 chain sent between that ask and the update counts as made since, and keeps its own wait rather than coming back at once. Asking it at the update would take it.
- ⬜ **Home keeps "A mix stopped partway: open Lovejoin to see what to do."** for a 1.7 chain cut in a retired pool, while its box comes back by itself (1.8.0's review of its fixes, r2-critic#0's trace, an aside): the chain's `left` stays while its box is listed, though nothing there waits for the user, and the line goes at the next pool read once it's back (1.8.0's live run). Older than the review: its base shows it too.
- ⬜ **Home shows a retired box's own due time while the retired pools' run brings it back now** (1.8.0's review of its fixes, the e2e lane's note; seen in its live run): true of the box's wait, but it understates the run, which Settings says. Home has never followed Bring every box back.
- ⬜ **Untested in 1.8.0** (its release review): a retired token pool's page keeping its Done (S2) past a static render; and `withdrawDueNow`'s re-arm held to the run's own withdraws, since a re-arm for any box held as spent passes every test (last-code#1's trace).
- ⬜ **What 1.8.0's release review couldn't check** (its critic): Chrome's real order of Home's read and the first run (R2 holds both orders); the new lines at the side panel's width; a stuck retired token pool on mainnet (W4), which needs the network.
- ❓ **Chunk 34's leftovers** ([its plan](archive/plans/chunk-34-token-pools.md): *For the owner*, and each session's notes):
  - the collateral's mix on a swap's approval with no box (Session 12's call 5);
  - R11, a restored device's Bootstrap hold; MERGED-1's mainnet limit (no copy pool after a restore while our server is up); STATE-2; R2, preprod's floor;
  - a box not mixed yet's words; a stopped-parts banner that comes back for an hour; D2, what replaces the 30-box floor;
  - a waiting part refused by a Koios behind the chain; the history-first planner's 25 s refusals; Mix again below the floor; `CollateralTail` repeating core's `Tail`;
  - the rehearsal review's lows (DATA-4's second half, an unmixed Bootstrap box's class, `LaunchRecord.account`, the swap approval's total counting tokens);
  - Session 5's questions, and the calls Claude made along the way, each the owner's to overturn.

## Swaps and dApps

- ⬜ **More of Minswap's routes** (chunk 24): SundaeSwapStable, VyFinance, CswapV1.
- ⬜ **Multi-hop routes**, off since chunk 24: a later leg's order is one the session can neither check nor cancel.
- ⬜ **Dano first, then an order** (chunk 47's Part B, unbuilt): real, and its order is one the session owns. Of 27 Minswap transactions with a Danogo swap and an order on 2026-11-09, 4 were Dano first, each order the sender's own, and 23 were side by side, which leaves no middle token: look at that shape first. [The plan](archive/plans/chunk-47-minswap-new-routes.md#part-b--dano-first-then-an-order) has what it would take.
- ⬜ **A DEX name Minswap stops taking fails every swap's quote** (ChakraBondingCurve, 2026-11-09) while it's on the wallet's own list, which every ask sends. Its 400 gives the name's index, so a retry without that name would survive the next one. One that `routeOf` adds from Minswap's own route fails only the swaps routed through it, in the wallet's words: refused, its second ask leaves the first answer standing, so the quote is refused and the runner pauses (1.9.0's release review, L8). `WingRidersStableV1` is already off its documentation, though the API still takes it.
- ❓ **Hold V4's cap to the approved DEX fee** (1.9.0's release review, L9): a V4 fill takes the order's `max_per_execution` whole, and only `withinFunding` bounds it, so a build whose cap is over the quoted fee pays the difference out of the funding's 2 ₳ of room, up to about 1.8 ₳ a swap (more if the deposit is shaved too). Every Minswap build seen writes the quoted fee. Record the approved DEX fee at Start swap and hold the sum of the V4 orders' caps to at most it, sessions approved before it falling back to the funding; a re-route or a fee rise before the order would then pause.
- ⬜ **A Danogo swap's Transaction details call its collateral the paying account's** (1.9.0's review of its fixes, r2-views#2): it's Minswap's, on scripts the wallet never runs. A collateral hint that knows a swap against a DEX's pools, passed as `lookedUp` is, back-translated.
- ⬜ **Splash, very low priority:** a partial fill has never run live, and a remnant no cancel can spend would hold its swap's return (1.3.0's release review, C02).
- ⬜ **A timed partial return after a swap's cancel** (independent review L16), once a live check shows a cancel works from a small reserve.
- ⬜ **Swaps straight against a pool**, not through the aggregator (chunk 15b).
- ⬜ **More dApps on the dApps page:** each entry claims the dApp works privately, so each needs its own test run first.

## Sessions and restore

- ⬜ **A swap or a mix another browser brought back stays open here** (1.5.0's release review, C18): the money is safe, and the page waits for good.
- ⬜ **A swap that runs itself can't cancel the order a return from before chunk 24 left open** (chunk 32; X01, L6).
- ⬜ **A session's stake key registered from another account's site keeps its deposit there** (X05, L2): nothing in the wallet deregisters it. A proposal's deposit back to it stays there too, as the sign window now says (1.7.2's release review, critic#0), and so does an output paid to its hash (r2-docs#0).
- ⬜ **A found session waiting to end, and a mix's chain cut before it began, on the other screens** (L4, L5): each needs a word of its own.
- ⬜ **Put in 5 ₳ to cancel has never run end to end** (1.5.0's last review, L13): the e2e fakes plant a found session with money and no order, and the button needs an order.

## Activity

- ⬜ **Load more after a burst** (C03, X08, L7): rows a catch-up listed come back on the next pages, and a press reads on up to ten pages.
- ⬜ **A Refresh during a Load more** (G2): disable Refresh while a page loads.
- ⬜ **A CSV of the rewards** (chunk 30), for taxes, as Activity has one.

## Send and Make public

- ⬜ **A payment to the account's own key past what the balance reads "comes back"** (1.7.2's release review, own#1): under the account's stake key, Send and Make public take its keys up to the 500th on each chain as its own, as another wallet of the phrase may hand them out, but the balance reads only those its walk reaches (20 past the last used), so the money shows only in the other wallet. Count it as leaving with a line of its own, or have the balance read what Send matches. 1.7.1 did the same.
- ⬜ **An address paid to one of the accounts' stake key hashes** (1.7.2's release review, own#2): that key spends it, and the hash is public in every address the account hands out, but Send and Make public read it as anyone's, so Make public warns of no link, and base(hash, hash) is called "someone else's payment key". Crafted only: no wallet hands such an address out. A line of its own (a critical string) would say it.

## Signing and the connector

- ⬜ **A token the transaction burns reads as released** (1.9.0's release review, L1): a close that burns its position or auth token shows that token as "From a contract, not to you" beside the mint row's burn, with the switch. Taking the whole burn off would let the account's own units, or the site's, stand for the contract's: credit only the burn beyond what the account puts in of that asset, net, and what the found inputs of others hold of it, and none when an input wasn't found.
- ❓ **Two limits of the release warning, closed without a script lookup** (1.9.0's release review, L2): check the body's script data hash against the witness set shown, which tells a native script's input by its missing Spend redeemer and reads every contract input as key-released where the set doesn't verify (with redeemers it takes the cost models, which the connector doesn't read today); or count a contract input whose datum is kept by hash and not carried as key-released, which covers every proof but a required signer. Either gives the switch to a dApp that shows an incomplete witness set.
- ⬜ **A row for what goes back to the same contract** (1.9.0's release review, M1): "Goes back to the same contract: X ₳", beside the release row, the switch kept, since a reprice and a relist under someone else's datum render the same window. Its figure would have to take the account's own outflow off first, so the user's own ADA paid into that contract under another datum doesn't read as kept, and its words never say it stays the user's.
- ⬜ **The release warning's datum scan runs once per contract input** (1.9.0's release review, cip30-rust#5): a crafted 62 KB transaction, too big for the chain, keeps a site's own window from opening for about 0.9 s, and its Sign as long. Scanning each distinct datum once, and none once one names the key, takes it from about 480 ms to 15 ms natively.
- ⬜ **A key split across byte-string chunks isn't seen** (1.9.0's release review, cip30-rust#8): the datum scan reads the datum's CBOR, so a key across a chunk's header (in a field over 64 bytes, or a datum chunked on purpose) leaves only the note where no required signer names it. Decoding the datum and reading each byte string whole would see it.
- ⬜ **Contract token totals saturate** (1.9.0's release review, cip30-rust#9): past a u64 across several UTxOs the window shows a false figure, never a refusal, where `seedelf-platform/CLAUDE.md` asks for a checked sum or a u128 one. Keep them in u128, or record the exception beside the rule.
- ⬜ **Transaction details derives every other account's keys for a private spend** (1.9.0's release review, cross#2): its one-time key and giveme.my's are required signers no account has, so marking signers opens each known account in turn, a turn of the wallet's queue each: tens of ms with a few accounts, about 2.4 s at 100. Keep each account's key set until the lock.
- ⬜ **The worker doesn't check the release switch** (1.9.0's release review, dapp-ui#1): only the window holds Sign until it's on, and `dapp-answer` signs with the password alone. Only the wallet's own pages can send it, so this is defence in depth: the approval could carry the switch, and `answer()` refuse a release without it.
- ⬜ **Transaction details doesn't mark the dApp account's payment keys past its first 20 when it isn't the account on screen** (1.9.0's release review, dapp-ui#3): the sign window counts them as the user's, and details as anyone's; hash the dApp view's discovered paths (`SESSION_DAPP_VIEW`) in that account's turn.
- ⬜ **A Lovejoin mix's Transaction details say the wallet asks nobody after it asked Koios what made a box** (1.9.0's review of its fixes, r2-views#1): for a box no record accounts for (after a restore, from another device, or one another mix moved), in a pool read from Koios (any pool on preprod; on mainnet one the private index doesn't cover, or every one with Koios only or the index down), `lookUp`'s `tx_info` names that box's making. A flag from `lookUp` through the chain's records to the views' `lookedUp`, with words of its own, back-translated: the site's say the wallet looked up inputs it doesn't hold.
- ⬜ **"It signs for your staking" when the stake key only spends a UTxO at an address paid to its hash** (1.7.2's release review, pr358#3): the signer row names the stake key by its staking role alone; WebAssembly would have to say what it signs for.
- ⬜ **An output paid to one of the wallet's stake or DRep keys' hashes reads as money moving between the two sides** (1.7.2's review of its fixes, r2-docs#0): the tie is real and its row says "An address", but the wallet never reads that address. A line of its own would say so (a critical string).
- ⬜ **A wallet key's hash where a stake key goes ties nothing** (1.7.2's review of its fixes, r2-worker#0, r2-screens#0): a public account's payment or DRep key, or a session's payment key, as a certificate's credential, a reward account or an address's staking part is called someone else's ("a stake key that isn't yours", "a reward account that isn't yours", "a stake part that isn't yours") or isn't named at all, and the prompt can say the other side isn't in it. Tying it needs words of its own ("a key of …", critical strings).
- ⬜ **A committee update's members and a committee hot key aren't matched** (1.7.2's review of its fixes, r2-critic#0): key hashes that take no signature, so a session's prompt can say the public account isn't in it, as a treasury withdrawal's recipient could before pr357#0.
- ⬜ **Transaction details doesn't tag a treasury withdrawal's recipients** (1.7.2's release review, pr357#0): the sign window ties another of the wallet's stake keys among them now, and the view lists them as plain fields.
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
- ⬜ **What Leios would change in the wallet:** a chain's window in flight could be the whole chain; core's fee doesn't count Dijkstra's reference-input fees, and holds as Conway's constants what Dijkstra makes parameters; `cbor.ts` refuses Dijkstra's three-element transaction from a site; and a body field Dijkstra adds goes unnamed in the signing prompt, where Transaction details lists it as a field it can't name.

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
