# Privacy by default (2026-09-27)

This review tests the web wallet against the owner's principle of 2026-09-27: *"The Seedelf web wallet should be the most private by default, but with the ability to turn it down when applicable."* Six lenses tested branch `web-wallet/crypto-review` at HEAD 96682e8 (some traced at its parent 3cbfda9):

- defaults and settings
- the on-chain graph
- off-chain observers
- connected sites
- the device
- the docs against the code

A verifier re-traced every finding against the committed code. The settled decisions are taken as given. So are the accepted items, which aren't reported again: giveme.my as a single point of failure, Koios's keyless public tier, the unbuilt restore scan, the vault KDF, and the same session index being the same key on both networks.

## Status (2026-09-27)

**Since:** an independent review found more, and fixed it on the same branch: see [independent-review.md](independent-review.md). Its M8 finished §2.9 for the paths this round missed.

**Everything in §2 is done, and so is most of §3 and §4.1**, as the owner decided below. The owner declined §3.5, §3.8, §3.9, §4.2 and §4.3. §3.10 and §4.4–§4.9 are still open, with the smaller items under *Still open*. §5's limits are said plainly in [privacy.md](../privacy.md) and the [privacy policy](../store/privacy-policy.md), and §6's docs are corrected.

Two parts were built in parallel worktrees, marked *(connector)* and *(small items)* below, and are merged into `web-wallet/crypto-review` (the hashes below are the merged commits).

**The owner's decisions** (2026-09-27), which the work follows where they differ from the review:
- **Defaults:** only §3.1 changes: nothing goes out at the moment of unlock. §3.5 (the delay), §3.8 (the price lookup) and §3.9 (hide balances) are declined: the delay stays "1-6", the currency "usd", and Hide balances off.
- **§3.3:** nothing is preselected in the connect window. Connect waits until the user picks the public account or a private session, each with its cost said. No "new sites start on" preference, so §4.3 isn't needed.
- **§2.3: best effort, no gate.** Selection keeps Lovejoin boxes, and money with different histories, apart whenever a choice without merging pays. When none does, it merges, with a plain note in the review: no confirmation and no Settings switch (§4.2 isn't wanted).
- **§4.1:** a Settings switch turns Lovejoin returns off (on by default), and each flow can come back directly.
- **Settled before:** Lovejoin is on for mainnet, and returns go through it by default; a token→ADA swap's proceeds go through it, with the cost shown; one build has both networks. The live contracts are used as deployed, and the frozen key derivation never changes. The launch review's fixes stay.

**Checked on `web-wallet/crypto-review`** once everything was merged (2026-09-27):
- Rust: `cargo test --workspace --locked`, 434 passed; clippy and fmt clean.
- WebAssembly: the Node tests, 37 passed.
- Vitest: 674 passed on the default build (both networks) and on a preprod-only build.
- Playwright: 60 passed on the dev build, and 60 on the packaged mainnet store build.

| § | Status | What was done | Commits |
|---|---|---|---|
| 2.1 | Done *(connector)* | A signature checks only its own account's Lovejoin chain; another account's UTxO takes the stranger's path and words. | 0012e2f |
| 2.2 | Done *(connector)* | A site finds only the outputs that pay its own account among the wallet's recent sends; the rest go through its budget and Koios. A site's own submits are kept for it alone, so it still chains on them (launch review #13). | 8ec902b |
| 2.3 | Done, best effort | Each private UTxO has a history class from the sealed Seedelf history (made private, each payment received, each box back from Lovejoin, each session, Unknown). WebAssembly tries one UTxO alone, then one class, then merges, boxes last and one at a time, ordered by purpose (Send and Make public, a stealth mint, a funding). It never refuses: a merge gets a plain note in the review, and a funding names another session's money. The UTxOs screen tags each UTxO. No gate and no switch (the owner). | 366cd5c, d5710a2, 055fea0 |
| 2.4 | Done | The welcome line, Collateral, Settings' About and Lovejoin section, and Lovejoin's page say what's hidden is hidden on chain, and that Lovejoin hides boxes from people reading the chain, not from Koios or giveme.my. The policy, privacy.md and the listing say Koios sends every transaction from the IP that reads the public account. | adbe02e, 4fb0ad8 |
| 2.5 | Done, two checks open | giveme.my is named as ours (Logical Mechanism's) in the policy, About, Collateral, the listing, its host justification, the test instructions and the root README, with what it sees and what its logs leave out. **Open:** check the host's own log retention before promising more; decide the Web Store's *Location* answer (store README). | adbe02e, 4fb0ad8 |
| 2.6 | Done | "isn't tied", "(1 in 9)", "nothing ties it", "the mixes hide which boxes are yours" and the floor's "so yours hide among enough others" are gone. One helper says how far a box hides (`lovejoinHides`), and the public mix's review says its box can be picked out while few people bring boxes into a Seedelf. chunk-16 notes that "1 in 9" assumes the exits look alike. | be6024b, 3e0a795, adbe02e |
| 2.7 | Done | A swap's approval reads the pool once at Review (kept five minutes), caps the boxes, and says when the ADA would come back directly. | b972461 |
| 2.8 | Done | An ADA→token swap's approval prices what a stop or refund sends through Lovejoin, with the no-audit note; Stop shows the live estimate and offers *Stop and bring it back directly*. Capping a refund's chain at the approved boxes wasn't built (optional). | b972461 |
| 2.9 | Done *(small items)* | A private spend that lands marks only the private side behind; the next reading keeps the account's. Home's `tx_status` polling stays (the review's "better" option, spotting it in the contract scan, wasn't built). | be26bc0 |
| 2.10 | Done | A public mix's boxes are mixed again by *Mix again from my public account*, paid by the account; *Mix my boxes again* leaves them out; *Pay from my private balance anyway* warns. | 1c054c3, afb87d4 |
| 2.11 | Done *(connector)* | `isEnabled` answers whether the site is connected, locked or not; reads while locked are refused in a stranger's words, with no window; the unlock window names the sites waiting, and closing it answers "The user declined." | 9973116 |
| 2.12 | Done | The connect window, a site's session, the Minswap and dApps pages, the funding review and Disconnect say what the site is given and what it can still learn; the policy, privacy.md, the listing and the plans say it too. The optional warning for a site that once had a private session wasn't built. | 3e0a795, edc20c8 *(connector)*, 4fb0ad8 |
| 2.13 | Done | Half and Max round down to a whole unit and say they tell Minswap roughly what's held; minswap.ts, privacy.md and the policy say Minswap groups swaps by IP. | f9093a3, 4fb0ad8 |
| 2.14 | Done *(small items)* | Every service fetch has `credentials: "omit"` and `referrerPolicy: "no-referrer"`, with a unit test. The e2e check that no Cookie header goes out wasn't added. | 5f3dd4b |
| 2.15 | Done | A return takes the collateral its funding paid; with none left it says Lovejoin was left out. | d319d9f |
| 2.16 | Done | Hide balances masks how many Lovejoin boxes there are. | 47c7504 |
| 2.17 | Done *(small items)* | The own-account warning matches the account's payment keys too. | bbde341 |
| 2.18 | Done | The unlock reads the pool only on a network with something open, and `status()` writes no empty record. | 57c767e |
| 2.19 | Done *(small items)* | Spell check is off on `<body>`, so on every field; the public note stays off on purpose. | fdc7dc2 |
| 2.20 | Done *(connector)* | Settings' connector note says every https site, and its scripts, can see the wallet once it's on. | edc20c8 |
| 2.21 | Done *(small items)* | The private CSV's note says what the file ties together. | c06572d |
| 3.1 | Done | The unlock's run sends nothing: each box due waits a fresh draw inside the unlocked stretch, a swap's step too; no withdraw in a run that sent anything else, or within 5 minutes of the wallet's own send. | d74677a, 1860244, c58be9c |
| 3.2 | Done *(small items)* | Remove defaults to who paid (`mintedBy.<network>`, sealed, or worked out from what's held); unknown, nothing is chosen. | 8edd702 |
| 3.3 | Done *(connector)*, option (a) | Nothing preselected; each option says its cost; Connect waits for the public account to be chosen. | b80497b |
| 3.4 | Done *(small items)* | One `ExplorerLink`; private-side links carry the warning. | cb5109b, e6e0d9e |
| 3.5 | **Declined** | The delay stays "1-6" (the owner). chunk-16 and the docs say so. | |
| 3.6 | Done | The box that goes is one someone else's mix has moved since, when there is one; leaves are kept while their boxes sit. | 5364a60 |
| 3.7 | Done | A Seedelf spend's outputs are shuffled. | 366cd5c |
| 3.8 | **Declined** | The currency stays "usd" (the owner). privacy.md names CoinGecko as the one default that asks a third party for a convenience, and the policy says it's asked when Home or the swap form opens. | 4fb0ad8 |
| 3.9 | **Declined** | Hide balances stays off by default (the owner). | |
| 3.10 | **Open** | Not built: the account-paid mint's draft and a Lovejoin chain's first mix still go to Ogmios at review. The docs-only minimum is done: privacy.md, the policy, the listing's Koios justification and CreateSeedelf's header say so. | adbe02e, 4fb0ad8 |
| 3.11 | Done | The swap picker searches the wallet's own list first, and Minswap only when nothing matches or on *Search Minswap*. Telling a pending order from `utxo_info` (optional) wasn't built. | 87c8bbc |
| 3.12 | Done *(connector)* | A disconnected site's session record goes, unless something was left behind at its account. | 6bef75b |
| 3.13 | Done *(small items)*, one part left | Sealed records padded; no `vault.createdAt`; prices in session storage; Remove wallet clears the pools and old prices. Sealing every record empty at creation was left out: the "has used" checks (§2.18) must read content first. | 74a0ffc |
| 4.1 | Done | Settings' *Bring private sessions back through Lovejoin* (on by default); a swap's approval switch (`auto.direct`), Stop's direct option, each return's *Bring it back directly instead*, and Bring everything back's *Bring them back directly instead*. | be6024b, b972461, 40f7c3f |
| 4.2 | **Declined** | No switch and no per-payment confirmation (the owner): §2.3 is best effort. | |
| 4.3 | **Declined** | Not needed: the connect window preselects nothing (§3.3). | |
| 4.4 | Open | The owner's call after launch. The connector is off by default, and §2.20's copy is done. | |
| 4.5 | Open | Longer waits, and "bring boxes back when I ask", weren't built. | |
| 4.6 | Open | Clearing private history wasn't built this round. | |
| 4.7 | Open | A user-set Koios, to be built with the own backend. | |
| 4.8 | Open | Spreading Bring everything back out wasn't built; its review now says what sending them together ties, and that bringing each back from its own page, hours apart, avoids it. | 3749080 |
| 4.9 | Open | None of the smaller controls were built. | |
| 5 | Done | Each limit is said plainly in privacy.md and the policy (§5.1–§5.10), with the wording given, adjusted to what was built. | 4fb0ad8 |
| 6 | Done, two parts left | The docs in the table are corrected, and Settings' Lovejoin section says what counts as spare, what bringing a box back costs, and that a lock stops a chain. **Left:** LockCountdown's "A Lovejoin chain is being sent: locking now stops it partway" (it needs the worker to say a chain is going), and a rough send time for a chain. | 3749080, and the docs commit with this Status |

**Still open, beyond the table:** the two worktree branches' merge, then an end-to-end run (`npm run e2e`) on the merged branch and on the packaged store build; §2.5's two checks; §3.10; §4.4–§4.9.

## 1. Verdict

The wallet is private by default in its primitives: fresh one-time keys, shared collateral, re-randomized registers, an ownership check on the device, sealed records, Lovejoin on for returns, and the connector off.

It falls short in the choices it makes on top of them:

- **Two connected-site oracles.** Any site, even one on a private session, can ask the signer whether a UTxO is the wallet's, and so tie the session to the public account.
- **Coin selection ignores where money came from.** It spends Lovejoin boxes together and funds sessions from the user's own Make private.
- **Boxes come back the moment the wallet unlocks.**
- **The privacy policy and the UI promise more than the code does.** Koios and giveme.my (which is ours) see both ends of every private trip from one IP, and a Lovejoin box hides only among other Seedelf Wallet users' boxes.

Turning privacy down is only half there. The owner's belief that the Lovejoin settings turn it down is partly true: Settings can make Lovejoin cheaper (depth 1) but can't turn it off. The 1–6 h delay is already the shortest. A swap that runs itself (Stop included) and Bring everything back have no direct option.

Before mainnet: §2.1–§2.6. The rest can follow in the order below.

## 2. Fix now (privacy bugs and broken promises)

| # | Severity | Kind | What | Sources |
|---|---|---|---|---|
| 2.1 | High | Code | A connected site can test any UTxO against the wallet's Lovejoin chains | dapps-1 |
| 2.2 | High | Code | A connected site can tell whether a recent transaction is the wallet's | dapps-2 |
| 2.3 | High | Code | Coin selection ignores where each private UTxO came from | defaults-1, onchain-1, defaults-2, dapps-3 |
| 2.4 | High | Copy | "Koios can't tell which Seedelf UTxOs or Lovejoin boxes are yours" | defaults-3, observers-1, observers-2, onchain-7, docs-1 |
| 2.5 | High | Copy | "We collect nothing", yet giveme.my is ours | observers-3, docs-2 |
| 2.6 | High | Copy | Lovejoin copy promises unlinkability it doesn't reach | defaults-10, defaults-11, onchain-2, docs-3, docs-4 |
| 2.7 | Medium | Code | The swap approval promises Lovejoin without looking at the pool | defaults-7, docs-6 |
| 2.8 | Medium | Code | A stopped or refunded ADA→token swap mixes its whole principal, undisclosed | defaults-6, docs-5 |
| 2.9 | Medium | Code | Confirming a private spend re-reads the public account in the same second | observers-5 |
| 2.10 | Medium | Code | "Mix my boxes again" ties a public mix's boxes to the private balance | onchain-5 |
| 2.11 | Medium | Code | Sites can learn when the wallet is locked or unlocked | device-1, dapps-7, defaults-15, observers-15, docs-17 |
| 2.12 | Medium | Copy | "Your public account never appears", "the site sees only it" | onchain-3, dapps-4, defaults-2, dapps-8, observers-13, docs-10 |
| 2.13 | Medium | Copy + code | "Minswap never sees your private balance", but Max and Half send it | docs-8, observers-14 |
| 2.14 | Low | Code | Service fetches don't opt out of cookies | docs-12 |
| 2.15 | Low | Code | A session whose collateral was spent comes back directly without saying so | onchain-9 |
| 2.16 | Low | Code | Hide balances leaves the Lovejoin holding readable | device-5 |
| 2.17 | Low | Code | Make public's own-account warning misses enterprise addresses | docs-16 |
| 2.18 | Low | Code | Every unlock reads Lovejoin's pool on every network ever opened | docs-13 |
| 2.19 | Low | Code | The contact name is spell-checked | device-10 |
| 2.20 | Low | Copy | The connector's "That's all it adds" | defaults-15, observers-15, dapps-6, device-8, docs-17 |
| 2.21 | Low | Copy | The Activity CSV's note says only "isn't encrypted" | device-3 |

### 2.1 High: a connected site can test any UTxO against the wallet's Lovejoin chains

**What leaks, and to whom**
- `signTx` first runs `heldForLovejoin` against every chain the whole wallet is sending (`reservedSet(..., {sending:true})`, spent.ts:144-156), whoever the site's holder is.
- A reserved outpoint gets a refusal that repeats it and counts the matches. Any other outpoint gets the stranger's message.
- The check runs before the `unprompted` limit, so only `MAX_SITE_CALLS` bounds it. About 1,700 outpoints fit in one 64 KiB call, and reservations last for the whole chain.
- A site on a private session can watch Lovejoin's contract and test each new deposit's inputs:
  - A hit on the public tile mix's deposit ties the session to the public account.
  - A hit on another session's return ties the two sessions, and shows which Seedelf UTxO (the funding change it merges into) is the wallet's.

**The change**
- Check only the holder's own reservation (`reservations(...)[chainOwner(holder?.index)]`, while it has no `until`). Every other outpoint takes the stranger's path and message. Never echo or count an outpoint that isn't the holder's.
- To avoid a circular import, compute `session.${i}` / `public` locally, or move `chainOwner` to spent.ts.
- Update the header comment (dapp.ts:34-36) and the method's doc.

**Files:** dapp.ts:913-928, :1094; spent.ts; tests/dapp.test.ts:1161, plus three new cases:
- a session probing `public` and `session.1` reservations;
- a public site probing `session.N`;
- the lookup budget spent, with another holder's sent output.

**Cost:** none. A holder's keys can't sign for another account's UTxO, a Seedelf UTxO or a pool box anyway. On a patched scratch copy all 39 dApp tests pass.

### 2.2 High: a connected site can tell whether a recent transaction is the wallet's

**What leaks, and to whom**
- `resolve()` answers first from `sentOutputs`: this network's last 16 sends from the last 20 minutes (sent-txs.ts:23-25), for every holder and every flow. That covers public Sends, move-ins, fundings, returns, Lovejoin chains and withdraws, and other sites' submits.
- Only outpoints it doesn't find spend the site's per-minute budget (4 fresh reads and 6 lookups, dapp.ts:124, :847-853).
- Once the budget is spent on junk, probing `h#0` answers code 1 if `h` is the wallet's and code -3 if not. Misses aren't counted as unprompted. A hit also skips a Koios round trip, which shows in the timing.
- So a private-session site can confirm:
  - a public Send (session ↔ account);
  - another session's funding (session ↔ session);
  - a private transfer;
  - a box withdraw.

**The change**
- Change `sentOutputs(network, holder, view, refs)` to keep only outputs that pay the holder: the session's key hash, or the public account's stake key or addresses.
- Every other output goes through the budget and `utxo_info` like a stranger's. That closes the timing channel too.
- Keep a site's own `submitTx` outputs in that holder's `SESSION_DAPP_SIGNED` record, so the site can still chain on them.
- Update the comments at dapp.ts:817-826 and sent-txs.ts:1-7.

**Files:** dapp.ts:835-853, :935-941, :1238-1248; sent-txs.ts; tests/dapp.test.ts:
- a session probing the public Send and a stranger's hash gets the same reply and the same `utxo_info` count;
- origin A can't confirm origin B's submit;
- the tests at :311 and :1229 still pass.

**Cost:** none for normal flows. Send change and a session's funding or top-up still chain before they land.

### 2.3 High: coin selection ignores where each private UTxO came from

**What leaks, and to whom:** anyone reading the chain, plus the site or Minswap that knows the session's one-time account.

- `select_script_inputs` (seedelf-core build.rs:1864-1909) takes the token holders first, then pure-ADA UTxOs largest first, adding them until the payment is covered. Max takes the 20 largest (wasm lib.rs:1858-1863).
- Every private spend uses it: Send, Make public, the stealth mint, and every session, top-up and mix funding (`buildFunding` → `buildWithdraw`, sessions.ts:944-962).
- `readContract` drops only locked and reserved UTxOs (script-spend.ts:87-100). The sealed history records each UTxO's origin (activity.ts:166-172; lovejoin.ts:1505), but no selection code reads it.

This causes three links:

1. **Lovejoin boxes get spent together.**
   - A box back from Lovejoin (about 9.71 ₳ into a register) is easy to spot. Spending two leaves of one 9-leaf tree, or a box with its session's funding change, turns 1 in 9 into near certainty. It ties the boxes to each other and back to the session or the public account.
   - After a private token buy, the main UTxO carries the token and sorts after every pure-ADA box, so the next payment reaches for the boxes first (reproduced offline).
2. **Sessions fund from the move-in and chain together.**
   - A funding spends the largest UTxO, usually the user's own Make private, one hop from the public account, and shows the site or Minswap its full value.
   - The return merges into that funding's change (sessions.ts:1714-1729). The change stays the largest UTxO and funds the next session, so swaps and sessions at different sites get tied together.
3. **A stealth mint can spend moved-in money** even when received money could pay.

**The change**
1. **Selection, in seedelf-core and the WebAssembly crate.** Give each row a class; the CLI passes Unknown and keeps today's behaviour behind a parameter. The analysts agree on these rules:
   - First try a single UTxO that pays on its own (the smallest that does; a token-bearing one counts).
   - Then add inputs within one class before mixing classes.
   - Never spend two Lovejoin boxes together by default (each box is its own class), and never a box with anything else without the user's consent.
   - Order by purpose:
     - a session funding prefers a received payment, or a single box that pays alone, and takes another session's change or return last;
     - a stealth mint prefers received money;
     - Send and Make public spend own money before a box.
   - Return what was merged (`exitsSpent`, `classesMixed`).
2. **Classes, in the extension.** Build them locally from the sealed history, matched by the transaction that made each UTxO. Never ask Koios.
   - Each lovejoin-withdraw is its own class, noting whether it came from a public mix or which session.
   - A session's funding change and merged return belong to that session.
   - A move-in belongs to the public account.
   - Each received payment is its own class.
   - A spend's change inherits its inputs' classes.
   - Restored or unknown history is one class, which is no worse than today.

   A cheaper first step for fundings, in TypeScript only: build without other sessions' UTxOs first, fall back to all of them, and return `linkedSessions`.
3. **Reviews.**
   - Under "Private UTxOs spent" (Transfer.tsx:130, Withdraw.tsx:133, and the session, mix and mint reviews), say what merging ties together. Example: "Spends 3 boxes back from Lovejoin together. This ties them to each other and back to your public account's mix." Keep Send disabled until the user picks **Spend them together**.
   - The funding reviews (Swaps.tsx:739-742, DappApprovals.tsx:484-487, SiteSessions.tsx:449, Lovejoin.tsx:617) always show "Spends private UTxOs worth X ₳: the site (or Minswap) and anyone can see this", and name any linked session.
4. **UTxOs screen** (Utxos.tsx:28-34): tag each UTxO's origin (Back from Lovejoin, Received, Made private, Private session N, Unknown), so locking by hand is an informed choice.
5. **Settings switch:** see §4.2.
6. **Tests:** pin the probe's cases in seedelf-core: cases 1 and 3; case A (12 boxes against a token-bearing main UTxO); case C (a stealth mint with moved-in and received money).

**Cost to the user**
- Sometimes one more input (about 0.04 ₳, flows.md:273), or a larger single input.
- More UTxOs kept apart.
- A confirmation when histories must merge. A balance made only of boxes always asks for any payment over about 9.71 ₳.
- No gain after a restore.

### 2.4 High: "Koios can't tell which Seedelf UTxOs or Lovejoin boxes are yours"

**The claims:** privacy-policy.md:32, :16 ("Nobody is told"), :44 ("A VPN hides your IP address"), :25, :48; privacy.md:83, :84, :132; Onboarding.tsx:30.

**What's true**
- The ownership check is local only for reading. Every transaction goes to one Koios host from one IP. The only submit path is koios.ts:481-492, and it carries:
  - Seedelf spends (script-spend.ts:234 → pending.ts:243);
  - session steps (sessions.ts:1968);
  - Lovejoin chains and withdraws (lovejoin.ts:1032, :1489, :1543);
  - site submits (dapp.ts:1231);
  - a `tx_status` check for each (pending.ts:337).
- The same IP reads the public account at every balance reading (account.ts:101-103, balances.ts:136-141).
- So Koios can tie each private spend, each session, and both ends of every Lovejoin trip to the public account. Against Koios, Lovejoin's crowd is one. giveme.my sees the same from the same IP (§2.5, §5.2).

**The change**
- **policy :32:** "From what the wallet reads, it can't tell which Seedelf UTxOs or Lovejoin boxes are yours: that check runs on your device. But every transaction goes to Koios to be sent, from the same IP address that reads your public account. So it can see which private UTxOs and Lovejoin boxes you spend, and the new ones they pay into, and tie them to your public account. That includes both ends of Lovejoin."
- **policy :16:** "Nobody is told until you spend one: Koios and giveme.my see each one you spend."
- **policy :44:** "A VPN hides your IP address, not that your requests come from one wallet: the wallet reads your account and sends your private payments through the same connection."
- **policy :25 and :48:** add that Lovejoin doesn't hide the trip from Koios or giveme.my.
- **privacy.md:**
  - :83: "no key that names who you are; the requests themselves name the public account's stake address";
  - :84: add "until one is spent";
  - :132: rewrite to cover the chain's submits and each withdraw's submit;
  - add a Network bullet, "Koios sends every transaction".
- **UI:**
  - add "on chain" to Onboarding.tsx:30, Settings.tsx:327-328, LovejoinReturn.tsx:106, Lovejoin.tsx:533 and Collateral.tsx:160;
  - add a line to Settings' About (Settings.tsx:137-141), Settings' Lovejoin section and the Lovejoin tile: "Lovejoin hides your boxes from people reading the chain, not from Koios or giveme.my, which see your device send both ends."

**Cost:** copy only, plus a store policy update.

### 2.5 High: "We collect nothing", yet giveme.my is ours

**The claims:**
- privacy-policy.md:5 ("nothing it handles is ever sent to us"), :44 ("we don't control any of them"), :46 ("Nothing goes to Lovejoin's makers"), :54 ("We never receive any");
- privacy.md:44;
- store README.md:68, :116 and :155 ("a server of ours");
- root README.md:158 ("third-party").

**What's true**
- giveme.my is run by Logical Mechanism on DigitalOcean App Platform (Collateral-Provider docs/DEPLOY.md:3). Its known.hosts.json UTxO is the one compiled into constants.rs:81-88.
- It receives, with the IP, the unsigned CBOR of every Seedelf spend and box withdraw, including transactions never sent (collateral.ts:26-35, script-spend.ts:216, lovejoin.ts:1480). It asks Koios's Ogmios to evaluate each one.
- Its app logs leave out raw IPs and, on success, transaction hashes (Collateral-Provider README.md:115-119). Its rate limiter keeps IPs briefly. DigitalOcean's edge-log retention is unchecked.

**The change**
- **:5:** "No accounts, analytics, crash reports or ads. One service the wallet uses, giveme.my, is ours: it receives your IP address and each private transaction you send, to add its collateral. Never your phrase or keys."
- **:34-36:** name the operator and what it sees (each private transaction before it's on chain, each box brought back). Add the logging promise once the host's retention is checked.
- **:44:** say giveme.my is ours and the other services aren't.
- **:46:** "Lovejoin's makers also run giveme.my, which sees each box you bring back with your IP address."
- **:54:** "We don't sell or share data, and keep no record tying an IP address to a transaction."
- Mirror the changes in privacy.md:20, :44, :82; README.md:68, :116, :155; root README.md:158; Settings.tsx:139-140; Collateral.tsx:160.
- Recheck the Web Store data-usage answers (README.md:130).
- Bump the policy date and add a release note (policy :66).

**Cost:** copy only. The headline "we collect nothing" becomes a qualified claim.

### 2.6 High: Lovejoin copy promises unlinkability it doesn't reach

**The claims**
- "isn't tied to the session": Settings.tsx:327-328, LovejoinReturn.tsx:106, store README.md:56.
- "nothing ties it to where it came from": Lovejoin.tsx:533, architecture.md:488, the comment at lovejoin.ts:12.
- "The mixes hide which boxes coming out are yours": Lovejoin.tsx:617-618 and :689-690.
- "(1 in 9)": Settings.tsx:344-345.
- "enough other people's boxes to hide yours": README.md:56.
- "so yours hide among enough others": lovejoin.ts:702.
- policy :25 and :48.

**What's true**
- At best a box is one of 3^depth leaves (9 at depth 2), and usually fewer (§5.3).
- The session, or the public account, pays every mix in the open.
- The wallet's way back is recognizable.
- The floor counts boxes, not owners.
- Koios and giveme.my see both ends (§2.4).

**The change**
- Add one shared helper, for example `lovejoinHides(depth)`: "which box coming out is yours stays one of up to 9 (at 2 waves deep), fewer while few people use Lovejoin".
- Replace the wording:
  - "isn't tied" → "is harder to tie to the session";
  - "(1 in 9)" → "(up to 1 in 9)";
  - "nothing ties it" → "nothing on its way back names a session or an account";
  - the floor error → "so there's enough to mix with";
  - README.md → "enough other boxes to mix with" and "30 boxes that aren't yours".
- Add one clause until §2.3 lands: returned boxes spent together, or with the session's funding change, narrow this.
- On the public mix review (Lovejoin.tsx:688-691): "Anyone can see your public account paid for these mixes. While few people bring Lovejoin boxes into a Seedelf, the box coming back can be picked out among those your account's mixes made."
- chunk-16-lovejoin.md:16: note that "1 in 9" assumes exits look alike.

**Cost:** copy only. Lovejoin looks less protective at launch, which is accurate.

### 2.7 Medium: the swap approval promises Lovejoin without looking at the pool

**What leaks:** chain observers and Minswap can tie the swap's proceeds to the session and its funding.
- `lovejoinCost` (sessions.ts:583-605) prices boxes from the spare ADA and the depth. Its only gate is `lovejoinOn`.
- The floor (30 other people's boxes on mainnet) is checked only when the return is built (lovejoin.ts:786-787). Below it, the runner sends a direct return without asking. At the floor, depth 2 takes at most 3 boxes. Mainnet's pool launched empty (launch review M5).
- Meanwhile the approval still says "The proceeds and spare ADA through Lovejoin first" and "About N boxes, at most".

**The change**
- Add a cached (about 5 min), non-throwing pool check (`floorReason` or `room`). Run it once at Review (`outBuild`, sessions.ts:620), not on every quote while the user types (Swaps.tsx:567-593).
- Carry `skipped` on the quote, and cap `boxes`.
- When skipped: hide `LovejoinCost`, and have `Plan` say "directly". Add a callout: "Right now Lovejoin's pool holds N boxes that aren't yours, under the 30 it needs, so the proceeds would come back directly, tied to this session on chain."
- When capped: "About k of M boxes".
- "the pool may take fewer" → "fewer, or none".
- Keep the check at return time. The opt-in wait is in §4.9.

**Files:** sessions.ts:583-605, :620; lovejoin.ts; Swaps.tsx:674, :721, :733, :1005-1016, :1042-1057; a sessions.test.ts case and a screens test.

**Cost:** one pool read per Review. Koios sees it at return time anyway.

### 2.8 Medium: a stopped or refunded ADA→token swap mixes its whole principal, undisclosed

**What happens**
- For ADA→token, `lovejoinCost` counts only the 2 ₳ margin as spare. So the approval says "none of it goes through Lovejoin: it all comes back at once" (Swaps.tsx:734-738), and shows no `LOVEJOIN_UNAUDITED` note.
- After Stop before the order, a cancel, or Minswap's refund, the runner calls `bringBack` without `direct` (sessions.ts:1388, :1413). The whole principal then goes into a chain.
- At depth 2 that is up to 32 boxes: about 106 ₳ in mixes plus about 9 ₳ to bring them back, for a 500 ₳ swap.
- The Stop dialog says "less the return's network fee" (Swaps.tsx:1662-1663).

Nothing new leaks. The user pays for privacy they were told wouldn't apply.

**The change**
- Estimate the principal's route too (`ifStopped` in `lovejoinCost`). Say it on the approval, with the no-audit note.
- The Stop dialog shows the live estimate and the delay, with two buttons: "Stop, through Lovejoin" (the default) and "Stop, bring it back directly". The second sends `session-stop {direct:true}`, recorded as `auto.direct`, and the runner passes it at :1388 and :1413, as the mix path does at :1373.
- The approval text covers a refund that comes without Stop. Optionally, cap the chain at the approved box count, and pause a refund that would mix more.
- flows.md:350.

**Cost:** one flag, one estimate, and copy.

### 2.9 Medium: confirming a private spend re-reads the public account in the same second

**What leaks, and to whom:** Koios.
- Home polls `tx_status(<private tx>)` every 15 s (pending.ts:337).
- On confirmation, `settleNow` drops the whole kept reading (pending.ts:344, :366), and Home reloads everything at once (Home.tsx:147): `account_addresses`, `credential_utxos`, `account_info` and the contract scan (balances.ts:136-141). Box withdraws drop the reading too (lovejoin.ts:1503, :1531).
- Koios can therefore tie the private transaction to the public account by timing. That matters exactly on a shared IP (a VPN or CGNAT), which is what the docs advise.

**The change**
- After a Seedelf spend, refresh the private side only (for example `balances {refresh:"seedelf"}`, with separate caches).
- Keep the full read for kinds that touch the account anyway: move-in, send, collateral, stake, vote, and a Remove or withdraw to the wallet's own account.
- Better: notice confirmation in the contract catch-up scan, as a row carrying that `tx_hash`. Use `tx_status` only for a Max withdraw with no contract output, spaced 5–30 s from any account read.
- Correct privacy.md:85.

**Files:** pending.ts:261, :337, :344, :366; Home.tsx:147, :156-158; balances.ts.

**Cost:** separate caches. A Max withdraw's banner confirms later. Koios requests stay the same or drop.

### 2.10 Medium: "Mix my boxes again" ties a public mix's boxes to the private balance

**What leaks, and to whom:** anyone reading the chain.
- A public mix cut short by a lock leaves boxes that are still the account's deposit outputs. The page makes "Mix my boxes again" the primary button, and says it "hides it first" (Lovejoin.tsx:398-408, :557-559).
- But `againBoxes` takes every free box (lovejoin.ts:681-693), and the mix is always paid from the private balance (sessions.ts:721-750).
- So the again-mix ties the private UTxOs that pay for it, and their whole change chain, to the public account. That is worse than bringing one box back.

**The change now (copy):** when a not-mixed box came from a mix with no session (`LovejoinStatus.chains[].session`), say so in the NotMixed callout (170-174), the modal (557-559) and AgainReview (661-664).

**The change next**
- Group owned boxes by origin. The private-balance again-mix takes only boxes from a session, or of unknown origin.
- Boxes from a public mix default to "Finish mixing from your public account": a `Payer` built from the account, as `chain_from_account` does, sent by `pumpPublic`.
- Keep "Pay from my private balance anyway" behind the warning.
- Update privacy.md:131. Note in chunk-16 that the 2026-09-25 decision covers boxes from private sessions only.

**Cost:** the account pays those mixes (about 4.5 ₳ a box at depth 2) and needs its collateral. There are two chains, not one.

### 2.11 Medium: sites can learn when the wallet is locked or unlocked

**What leaks, and to whom**
- `isEnabled` returns `unlocked && connected` with no rate limit (dapp.ts:268-270). A connected site polling it sees the unlock moment, which is when box returns go out (§3.1).
- Any https site, connected or not, can make a read while the wallet is locked. `run()` calls `unlocked()` before checking the connection (dapp.ts:272 vs :284-285). That opens the unlock window, which says "A site is waiting…" without naming it (Unlock.tsx:75-78), and answers the site when the user unlocks or closes it.

**The change**
- `isEnabled` answers `connected`, whatever the lock state.
- While locked, refuse the read methods without opening a window, using the not-connected wording (`-3`). Strangers then learn nothing and can't pop windows.
- Keep `enable`, `signTx`, `signData` and `submitTx` going through the unlock window, and name the site asking on the Unlock screen.
- Optional:
  - answer a closed window with "The user declined.";
  - allow one `enable()` window per origin per minute, or correct flows.md:325.

**Cost:** a connected dApp that polls while locked hears "call enable()" until the user presses Connect. A connected site can still tell locked from unlocked by whether it's answered; say so at privacy.md:104.

**Files:** dapp.ts:264-285, :420, :618; shared/dapp.ts (`READ_METHODS`); Unlock.tsx:75-78; tests/dapp.test.ts; chunk-15 plan :51; flows.md step 4.

### 2.12 Medium: "Your public account never appears", "the site sees only it"

**The claims**
- store README.md:54-55;
- policy :24, :26 ("It never sees your private balance"), :39;
- privacy.md:45 (rule 8), :111, :120, and :121 ("its visits link to each other, but to nothing else");
- DappApprovals.tsx:389-390, :460, :485; SiteSessions.tsx:340; Dapps.tsx:204; Swaps.tsx:393, :730-731;
- chunk-15c:10 ("unlinked"); chunk-15-dapp-connector.md:216; the header comments at sessions.ts:3 and Swaps.tsx:4.

**What's true**
- The public account isn't in the session's transactions, but the site knows its session address and can read the funding on chain: the private UTxOs that paid, their full values, and the change left in the private balance, which it can then follow.
- Money the user made private themselves leads one hop back to the public account, which with today's selection is the usual case (§2.3). Later sessions chain through that change.
- The site also sees the IP, cookies, logins and browser fingerprint, and its scripts do too. If it ever saw the public account in this browser (or a sibling subdomain did, or a shared tracker did), it can tie the two.

**The change** (reuse CreateSeedelf.tsx:166's wording)
- **DappApprovals.tsx:485:** "Your public account isn't in these transactions, but anyone, the site included, can follow the money back into your private balance, and money you made private yourself leads on to your public account. The site still sees this browser: if it has seen your public account here, it can tell the session is yours. A separate Chrome profile and a VPN keep them apart."
- **DappApprovals.tsx:460 and SiteSessions.tsx:340:** "The wallet gives the site only this account."
- **DappApprovals.tsx:389-390:** name the change the funding leaves in the private balance.
- **privacy.md:** rule 8 becomes "is given…, never the private balance"; drop "but to nothing else" at :121.
- **Policy :26:** "It's never given your private balance or your Seedelfs; the funding itself is public."
- **Swaps.tsx:731:** "…out of the swap's own transactions."
- **The public option's callout (:452-455):** "The site can recognise this browser later, even if you connect it to a private session then."
- **Disconnect (Settings.tsx:565, :655) and ALREADY_CONNECTED (dapp.ts:225, :545):** "It keeps what it already saw."
- **Optional:** in the public branch, warn when this origin had a private session (no new storage). The reverse warning needs a sealed list of publicly connected origins kept after disconnect, which is itself a history; that's the owner's call.

**Cost:** copy only.

### 2.13 Medium: "Minswap never sees your private balance", but Max and Half send it

**What's true**
- Max and Half fill from the private balance (Swaps.tsx:412-415, :603, :806-823; ui/swap.ts:13-41).
- ADA's Max is the balance less known costs: Minswap's fees, the 2 ₳ margin, 5 ₳ and 1 ₳. So Minswap can work the balance out exactly, even from a quote never sent. A token's Max is the whole holding.
- Minswap also groups swaps by IP, together with anything the user does on minswap.org.

**The change**
- **Callout (Swaps.tsx:983-984):** "Quotes come from Minswap as you type: it sees the pair, the amount and your IP address, never your public account. Half and Max are worked out from what your private balance holds, so they tell Minswap how much that is."
- Fix minswap.ts:10 and privacy.md:114 (add the IP grouping). Policy :24 and :39: "…but your IP address lets it group your swaps."
- **Behaviour:** round Max and Half down to a whole unit (in ui/swap.ts or `fill`, Swaps.tsx:613), so the amount looks typed. The Max tooltip becomes "All but what's under 1 ₳". Don't quote a rounded amount with an exact funding.

**Cost:** up to just under 1 ₳ (or one token unit) left unswapped, still in the private balance.

### 2.14 Low: service fetches don't opt out of cookies

- The fetches set no `credentials` or `referrerPolicy`: prices.ts:67, the default `fetchFn` in koios.ts:325, and collateral.ts:22. Nothing guarantees the browser's cookies for those hosts stay out. giveme.my's cookies would tie Seedelf spends to a browser identity.
- The observers lens assumed no cookies are sent. Don't rely on that: add `credentials: "omit"` and `referrerPolicy: "no-referrer"`, a unit test on the init, and an e2e check that no Cookie header goes out.
- Drop any claim that the Origin header identifies the extension; with the host permission, it doesn't.
- **Cost:** none.

### 2.15 Low: a session whose collateral was spent comes back directly without saying so

- sessions.ts:1624 looks for any exactly-5 ₳ UTxO at the account. If a site's transaction spent it, the return silently skips Lovejoin.
- **The change:** record the collateral outpoint (`<fundingTxHash>#1`) when an out, site-out or mix-out is sent, and prefer it. When there's none, set `lovejoinSkipped` ("its collateral is gone").

### 2.16 Low: Hide balances leaves the Lovejoin holding readable

- Every box is 10 ₳, but "3 boxes of 10 ₳" shows beside "•••• ₳" (Home.tsx:643, :654; Lovejoin.tsx:142, :171, :391-392, :494).
- **The change:**
  - add an `amounts.count` helper that masks counts while balances are hidden;
  - leave forms and reviews as they are;
  - fix the comments at Lovejoin.tsx:28-29 and :390;
  - add a screens test.

### 2.17 Low: Make public's own-account warning misses enterprise addresses

- `is_own_address` checks only the stake part (wasm lib.rs:2076-2084), yet the wallet spends any address under its payment keys (account.ts).
- **The change:**
  - also match the payment key, against the last reading's keys (balances.ts:208) plus the first 20 receive and change keys;
  - pass the keys from destination.ts:53;
  - tests at api_test.rs:2270;
  - update privacy.md:58 and chunk-10-withdraw.md:66.

### 2.18 Low: every unlock reads Lovejoin's pool on every network ever opened

- `used` means only that the sealed record exists (lovejoin.ts:1303-1305). Opening the Lovejoin tile writes that record even with no boxes (`status()` → `sortOut()`).
- So a wallet on mainnet asks preprod's Koios at every unlock, against privacy.md:85 and policy :33.
- **The change:**
  - scan only when something is open (`due`, `chains`, `notMixed` or `withdrawing`);
  - optionally pass `scan` only for the current network (runs.ts:44);
  - don't write an empty record from `status()`;
  - add a test that makes zero calls.

### 2.19 Low: the contact name is spell-checked

- Contacts.tsx:147-155 lacks `spellCheck={false}`. With Chrome's Enhanced spell check on (it's off by default), contact names go to Google.
- **The change:**
  - add the attribute, or put `spellcheck="false"` on `<body>` in index.html;
  - decide the public send note (CardanoSend.tsx:260) on purpose;
  - add a test.

### 2.20 Low: the connector's "That's all it adds"

- Once the connector is on, every https page and localhost (and the scripts in its top frame) can read `window.cardano.seedelf` without connecting (page.ts:65-78; connector.ts:28-38). That's a fingerprinting bit that marks a crypto holder.
- **The change:**
  - Settings.tsx:462 (the note while off): "Then every https site you open, and scripts on it, can see that you use Seedelf Wallet, even sites you never connect (not your addresses or balance until you connect)."
  - The same in :461, privacy.md:109, policy :56, and README.md:69 and :112.
  - The control that narrows it is §4.4.

### 2.21 Low: the Activity CSV's note says only "isn't encrypted"

- Each row carries its transaction ID (ui/activity.ts:126, :158) across move-ins, session steps, lovejoin-withdraws and transfers named by contact. The file rebuilds what Seedelf and Lovejoin hid, for whoever holds it, including a tax tool.
- **The change:**
  - Activity.tsx:210-211: "The file isn't encrypted. Each row has its transaction's ID, so whoever has it can find every one on the chain. It ties your private payments, your private sessions and your Lovejoin boxes to each other and to your public account, and shows which Seedelf each payment went to. Give it only to someone you'd show all of that."
  - privacy.md:138, policy :22, flows.md:94.
  - Add no password step. Don't offer an export without IDs on its own: amounts, fees and times identify the transactions anyway.

## 3. Change the default

### 3.1 High: box returns and automatic session steps go out at the moment of unlock

Sources: defaults-8, onchain-12, observers-6, device-1.

**Today**
- Unlocking runs `runSessions(scan)` (wallet.ts:179, sw.ts:143, runs.ts:41-44). Session steps go first. Then the first due box is withdrawn in the same pass (lovejoin.ts:1323-1350), seconds after Home's account read. Only the second and later boxes get a 5–60 min wait.
- With the 15 min lock and the 1–6 h delay, most boxes come due while locked. So most returns land at an unlock, a block or two from whatever the user does next, and at the moment a connected site's `isEnabled` flips (§2.11).

**Most private**
- Nothing goes out at the unlock instant. Every box due while locked gets a fresh secure draw inside the unlocked window, for example [2 min, lockAfter − 2 min], capped around 20 min.
- Randomize the least-wait offset too (lovejoin.ts:1336-1338).
- No withdraw in a pass that sent anything else, or within about 5–10 min of the wallet's own submit. Redraw 3–10 min; after 3 pushes it goes anyway.
- A "redrawn once" mark, so boxes never stall.
- The same fresh wait for a swap return found at unlock.

**Cost:** boxes come back a few minutes later, at most one lock period (15 min by default). A brief unlock may leave a box for the next one. This needs the owner's sign-off: chunk-16-lovejoin.md:18 recorded "at the first unlock".

**Files:**
- lovejoin.ts:1296-1350; runs.ts:41-50; the sessions runner; tests/lovejoin.test.ts:1290-1322.
- Copy: privacy.md:129, architecture.md:488, LovejoinReturn.tsx:109, Lovejoin.tsx:394/614/686 ("Soon after you unlock"), Settings.tsx:364.

### 3.2 High: Remove a Seedelf defaults to the public account

Sources: defaults-4, onchain-6, docs-7.

**Today**
- `useState<RemoveTo>("account")` for every Seedelf (RemoveSeedelf.tsx:28), with the note "links nothing new" (:119-120).
- For a stealth-minted Seedelf, that ties its name, and the mint's private inputs and change, to account 0/0 (withdraw.ts:106-123).

**Most private**
- The default follows who paid for the Seedelf.
- Record it at mint in a sealed per-network `mintedBy` map, kept outside the history (which is trimmed at 500 entries).
- Fall back on data already held, never asking Koios about the mint:
  - an owned non-Seedelf contract UTxO with the same `tx_hash` means a stealth mint;
  - the mint showing in the account's own UTxOs or Activity means account-paid;
  - otherwise unknown: nothing preselected, and Review disabled until the user picks.
- The account option's note depends on the origin, with a warning when a stealth-minted Seedelf is sent to the account.

**Cost:** none for a known mint. One tap otherwise.

**Files:** activity.ts:182-183 or mint.ts; rpc.ts:118-125; balances.ts:167; RemoveSeedelf.tsx:1-5, :28, :118-122; `Choice` accepting `value?`; privacy.md:62-64; flows.md:302-305.

### 3.3 Medium: the connect window preselects the public account

Sources: defaults-9, dapps-5, docs-11.

**Today:** `useState<Connection>("public")` (DappApprovals.tsx:278). One press of Connect gives the site the account's addresses, stake key, balance and UTxOs, and the choice sticks (switching needs Disconnect, dapp.ts:225).

**Most private:** never start on public. The analysts offer two versions:
- **(a) Nothing preselected** (docs-11). Connect stays disabled until the user chooses. This is the minimum.
- **(b) Start on "A private session", listed first,** whenever the private balance can fund one (about 6.5–7 ₳). When it can't, either stay on private with a note (dapps-5) or fall back to public with a note (defaults-9).

Either way:
- a public connect takes a deliberate press;
- each option states its cost;
- the balances are read on mount (drop the guard at :288), with Connect disabled until they load;
- the default comes from the preference in §4.3.

**Cost:** one press for dApps that need the public account. A user who keeps the private default pays a network fee, keeps 5 ₳ of collateral in the session for its life, sends a request to giveme.my, waits about a minute, and pays Lovejoin's return (about 3.5 ₳ at depth 2, and hours).

**Files:**
- DappApprovals.tsx:278, :288, :406, :433-445; Choice.tsx;
- e2e extension.spec.ts:2496, :2782, :2834, :2876;
- privacy.md:104 and rule 8; policy :26; flows.md; chunk-15c; the comment at Settings.tsx:407.

### 3.4 Medium: explorer links on private transactions have no warning

Sources: observers-7, device-2, docs-15.

**Today**
- One-click Cardanoscan links with no note:
  - private Activity (Activity.tsx:257);
  - Home's banner for every kind, background box returns included (TxBanner.tsx:53);
  - each swap step (Swaps.tsx:1828);
  - a session's funding (DappApprovals.tsx:311);
  - a site session's whole address (SiteSessions.tsx:98, :286).
- They open in the normal browser profile (cookies, logins, trackers) and land in Chrome's history, and Google's with History sync.
- Only the UTxOs screen warns, and it has no link.

**Most private**
- One `ExplorerLink {private}` component. On the private side it carries the UTxOs screen's wording: "Opening this on Cardanoscan tells that site, and your browser history, that this transaction is yours." observers-7 suggests a first-tap confirm instead; device-2 and docs-15 suggest a note.
- Copy stays. Public-side links stay as they are.
- Use a UI-side set of private kinds (transfer, withdraw, remove, the session steps, lovejoin-withdraw, lovejoin-mix), not the background's `SEEDELF_KINDS`.

**Cost:** one line of text, or one tap.

**Files:** format.ts; a new ui/components/ExplorerLink; the five places above; PendingBanner.tsx; e2e extension.spec.ts:566, :700; docs in §6.

### 3.5 Medium: Lovejoin's delay defaults to the shortest range

Sources: defaults-12, onchain-10, docs-9.

**Today:** "1-6" of ["1-6", "2-12", "6-24"] (preferences.ts:30, :67). The least a box waits after its last move is the range's low end (lovejoin.ts:1331-1340).

**Most private**
- Default to "2-12". Two analysts recommend it; one argues for "6-24". Keep "1-6" as the way to turn it down.
- Mark the default in Settings, with a note on the trade-off.
- defaults-12: before raising the default, cap the least wait at 1–2 h, so other people's mixes can't keep holding a box back.

**Cost:** money comes back later (plus the wait for an unlock) and sits longer in an unaudited contract. No ADA cost. The gain grows with pool activity and is small while the pool is quiet. This reverses chunk-16 decision 4.

**Files:** preferences.ts:67; Settings.tsx:349-364; privacy.md:129; architecture.md:488-489; chunk-16-lovejoin.md:17, :162; tests preferences.test.ts:27/38/57 and staking.test.ts:272.

### 3.6 Low: the box brought back is the one nobody else has mixed since

Source: onchain-11.
- **Today:** `longestFirst` picks the oldest `block_time` (lovejoin.ts:578-581, :1329, :1404). That's usually a leaf of the wallet's own last wave.
- **Most private:** among boxes past the least wait, prefer one that isn't a leaf the wallet recorded, meaning someone else has moved it since.
  - Keep the leaf refs while the box is owned (today they're pruned after 3 h, :1222).
  - Postpone only when no box has waited long enough.
- **Cost:** none visible, and no extra request. Chunk-16 lists this as offered, not decided.

### 3.7 Low: a transfer's change is always the last output

Source: onchain-8.
- **Today:** `outputs.chain(change)` (build.rs:1792).
- **Most private:** shuffle a Seedelf spend's outputs with lovejoin.rs's Fisher–Yates over OsRng (make `shuffle` `pub(crate)`). Leave `account_send` alone: collateral relies on output 0.
- **Cost:** none.
- **Also update:**
  - the tests in mint_test.rs;
  - the comments at build.rs:2276 and :301;
  - add a privacy.md line after :67: a round payment next to non-round change still shows which output is the payment.

### 3.8 Low: ADA's price is asked of CoinGecko by default

Sources: defaults-13, observers-9, docs-12.
- **Today:** currency "usd" (preferences.ts:63). CoinGecko is asked at each Home load and when the swap form opens (Swaps.tsx:554-556), at most every 5 min. The fixed eight-currency query marks the wallet. Policy :41 says it's "told nothing about your wallet".
- **Most private:** "off", plus a one-time card on Home (mainnet only) with a remembered answer (`currencyAsked`): "Show ADA's value in dollars? CoinGecko would see your IP address when you open the wallet. [USD] [Other…] [No thanks]". If the owner keeps "usd", name it in privacy.md's rules as the one default that contacts a third party for convenience.
- **Cost:** no fiat value until one tap.
- **Files:**
  - preferences.ts:63; Home.tsx; background/preferences.ts;
  - tests preferences.test.ts:20/:87 and e2e :2170;
  - privacy.md rule 7 and :102; flows.md:54; Settings.tsx:289; README.md:68/:117/:130;
  - policy :40-42, which should also say "when Home or the swap form opens".

### 3.9 Low: balances are shown by default

Sources: defaults-14, device-4.
- **Today:** `hideBalances: false` (preferences.ts:61), and the only control is the eye on Home. Even with the eye on, forms print the whole private balance (Transfer.tsx:165-166, Withdraw.tsx:170-171, SiteSessions.tsx:462, DappApprovals.tsx:474, CreateSeedelf.tsx:108, RemoveSeedelf.tsx:95, Swaps.tsx:902), and Home's UTxO count isn't masked (Home.tsx:360).
- **Most private:**
  - hidden by default, with a visible "Show" on the hidden balance;
  - a Settings switch;
  - while hidden, mask the "available" asides and the figures in over-limit notes. "Forms show what's being sent" stays the rule.
- **Cost:** one tap, remembered.
- **Also update:** tests preferences.test.ts:18, staking.test.ts:266, the handlers tests and e2e; flows.md:53; architecture.md:291.

### 3.10 Low: drafts go to Koios's Ogmios at review

Source: observers-11.
- **Today:** the account-paid mint's draft (mint.ts:56 → script-spend.ts:174) and Lovejoin chains built for a review (crossCheck, lovejoin.ts:824, :941) are evaluated before Send. A review the user abandons still shows Koios the Seedelf name, or the planned deposit and the pool boxes it drew.
- **Most private:**
  - Measure the account-paid mint locally, as the stealth mint does (mint.ts:79). Fall back to Ogmios when a reference-script UTxO must be spent.
  - Move crossCheck into backSubmit, claimSubmit and publicSubmit. Rebuild with `avoid`, and send only if the summary is unchanged; otherwise say "Review it again". Never fall back silently to a direct return after approval.
- **Cost:** a pool that was behind shows up at Send, plus one more request there. A docs-only fix is the minimum (privacy.md:132, policy :31, README.md:114).

### 3.11 Low: token search asks Minswap before the shipped list

Source: observers-14.
- **Today:** every query of two or more characters goes to Minswap (Swaps.tsx:1122-1139 → sessions.ts:545), though tokens/list.json ships the 25 tokens.
- **Most private:**
  - Match the shipped list first. Ask Minswap only when nothing matches, or on "Search Minswap". Keep the lookalike check.
  - Optional: tell an order is still pending from Koios's `utxo_info` on the recorded outpoints, instead of polling Minswap's pending-orders (sessions.ts:1385, :1392).
- **Cost:** none.

### 3.12 Low: a closed site session keeps its origin forever

Source: device-7.
- **Today:** disconnect only sets `closedAt` (sessions.ts:866-868). The record keeps `site.origin` and every transaction, though nothing shows it.
- **Most private:** delete `r.site` on close, or drop a closed record with no `leftBehind`, keeping `book.next`.
- **Cost:** none.

### 3.13 Low: unsealed storage shows what was used and when

Source: device-6.
- **Today:**
  - Sealed records are unpadded and created on first use under readable names (private-store.ts:17, :93-100). So `lovejoin.mainnet`'s existence and length show Lovejoin use and roughly how many boxes.
  - `vault.createdAt` (never read), `prices.at`, `pools.<net>.updatedAt` and the Lovejoin settings are in plaintext.
  - Remove wallet leaves the prices, pools, network and openIn keys behind (wallet.ts:287-288).
- **Most private:**
  - pad sealed JSON to the next power of two, at least 1 KiB (readers don't change);
  - optionally seal every record empty at creation, after making the "has used" tests look at content (§2.18);
  - stop writing `vault.createdAt`;
  - keep prices in session storage;
  - have `reset()` clear the prices and pools too.
- **Cost:** a few KiB, one pool-list refetch, and at most one extra price request after a restart.

## 4. Add a control to turn it down (or up)

### 4.1 Medium: turn Lovejoin returns down

Sources: defaults-5, onchain-4, docs-5, defaults-17.

**What exists today**
- Settings has depth (1–3) and delay only. Depth 1 (1 mix, about 0.83 ₳ a box) is the only way down, and the delay default is already the shortest.
- A swap that runs itself has no direct path at all. `claimBuild` refuses it (sessions.ts:1131), and the runner calls `bringBack` without `direct` after a fill, cancel, refund or Stop (:1388, :1413).
- Bring everything back never passes `direct` (ClaimAll.tsx:61), though the worker accepts it (rpc.ts:1148, handlers.ts:249).
- The approval's "Settings, Lovejoin changes this" (Swaps.tsx:1059) suggests an off switch that doesn't exist.

| Control | Where | Default |
|---|---|---|
| "Bring it back through Lovejoin" | Swap approval, beside `LovejoinCost` (Swaps.tsx:733). Stored as `auto.direct` (sessions.ts:995), passed at :1388 and :1413. When off, hide the cost and say the money comes back at once, tied on chain to the session and its funding. | On (from the Settings switch) |
| "Stop and bring it back directly" | The Stop dialog, beside "Stop" (§2.8) | Stop through Lovejoin |
| "Bring them back directly instead" | Bring everything back: calls `session-claim-build {direct:true}`. Render `LOVEJOIN_UNAUDITED` there too. | Through Lovejoin |
| "Returns go through Lovejoin" (`lovejoinReturns`) | Settings, Lovejoin section. Checked in `buildBack` (sessions.ts:1622) only when `!record?.mix`, so a tile Mix stays a mix. `lovejoinCost` returns nothing when off. Depth and wait are disabled when off, and the section says what's lost. | On |

- **Copy:** Swaps.tsx:1059 → "Settings, Lovejoin sets how deep and how long, or turns it off." Also flows.md:82, :352 and policy :20.
- **Cost when off:** saves about 3.3 ₳ in mixes per 10 ₳ box at depth 2, plus about 0.3 ₳ per box brought back, and hours of waiting. The return is tied on chain to the session and its funding change. The public account stays out either way.

### 4.2 Medium: keep money with different histories apart

Source: defaults-1.
- **Where:** a Settings switch, "Keep money with different histories apart", plus the per-payment **Spend them together** from §2.3.
- **Default:** on. Off restores largest-first.

### 4.3 Medium: which account new sites start on

Sources: defaults-9, dapps-5.
- **Where:** Settings → Sites (Settings.tsx:453-500). `dappConnectAs: "private" | "public"`, labelled "New sites start on: A private session / Your public account". Optional: "Private sessions only".
- **Default:** private. No "ask each time" option is needed, because the window always asks.

### 4.4 Low: which sites see the wallet

Sources: defaults-15, observers-15, dapps-6, device-8, docs-17.

**Where:** Settings → Sites, under the connector switch: "Only sites I allow" (the default once the connector is on) or "Every https site" (the way down).

The analysts disagree on how to build it:

| Approach | Cost to the user |
|---|---|
| Register the scripts only for allowed origins, with `persistAcrossSessions:false`, rebuilt from the sealed record at unlock (dapps-6, observers-15) | dApps don't see the wallet until it's unlocked and the page is reloaded |
| "Connect this tab" through `scripting.executeScript`, nothing stored (device-8) | A click on every visit |
| A per-origin permission and a persistent list (defaults-15) | A Chrome dialog per dApp, and the allowed origins sit unsealed in Chrome's profile |

docs-17 rejects per-site injection for those reasons.

- **Cheap interim step:** stop turning the connector off on a partial grant (connector.ts:24, sw.ts:244-249), so Chrome's own "On specific sites" works. Check first that the Koios and giveme.my host grants survive.
- This is the owner's call, after launch. The connector is off by default, so the copy fix in §2.20 is enough for launch.

### 4.5 Low: longer Lovejoin waits (turning it up)

Sources: defaults-12, onchain-7.
- Add "12-48" and "24-72" to `LOVEJOIN_DELAYS`, and have `delayText` show days.
- Optional: "Bring boxes back when I ask", off by default, so a user can switch VPN server before the returns go. Boxes sit until the user acts.

### 4.6 Low: clear private history

Source: device-7.
- **Where:** Settings → Security, or Activity's Export. Per network:
  - empty the history's entries, but keep `seen` and any entry under about 1 h old or still pending;
  - remove closed sessions with no `leftBehind`, keeping `next`.
- **Confirm dialog:** "This deletes your private Activity, and your finished swaps, mixes and site sessions, from this device. What's on the chain stays, and your recovery phrase still finds your money."
- **Optional:** a "Keep a private history" switch, default on.
- **Cost:** the cleared entries, their CSV, and the public Activity's labels on old move-ins.

### 4.7 Low: read and send through my own Koios

Sources: observers-8, defaults-3, docs-1.
- **Where:** Settings → Advanced. Off by default.
- One URL per network, replacing Koios for reads, Ogmios, submits and `tx_status`. Start loopback-only (connect-src `http://127.0.0.1:*` and `localhost`), and check the tip and network magic when saving.
- **Wording:** "Whoever runs this server sees everything Koios would, and the wallet believes what it says about the chain. Use only a server you run."
- Build it alongside the planned own backend, which uses the same base-URL plumbing.

### 4.8 Low: spread out Bring everything back

Source: defaults-16.
- **Where:** a "Spread them out" choice in ClaimAll: send the first return now, and the rest at random due times, one chain at a time.
- **Default:** together (the owner's choice, privacy.md:134).
- **Cost:** money back hours later, and a scheduler to maintain.

### 4.9 Low: smaller optional controls

| Control | Default | Source |
|---|---|---|
| "Bring boxes back as soon as I unlock", once §3.1 lands | Off | device-1, onchain-12 |
| "Wait for Lovejoin's pool", per swap (§2.7) | Off (opt-in) | defaults-7, docs-6 |
| "Hide again each time the wallet locks" | Off | defaults-14 |
| "One-click Cardanoscan links on private transactions" | Off | observers-7, device-2 |
| CSV: "Leave out private sessions and Lovejoin" (the private balance then won't add up in a tax tool) | Off | device-3 |

## 5. Inherent limits to say plainly

### 5.1 Koios sees both sides from one IP

Sources: defaults-3, observers-1, observers-2, docs-1.
- Reads of the public account, and every submit and `tx_status`, go to one Koios host from one IP. No wallet-side timing change removes the IP link. The timing fixes help only on a shared IP.
- Koios has no onion service, and whether it accepts Tor exits is unverified, so don't recommend Tor.
- **What would fix it:**
  - a user-set endpoint (§4.7);
  - an own backend or relay, which moves the observer to the owner unless it keeps no logs;
  - a separate submit path for private transactions. giveme.my has no submit endpoint today.
- **privacy.md (Network):** "Sending is different from reading. A submit names the UTxOs it spends, and it comes from the IP address that reads your public account. So Koios, and giveme.my for private spends, can tie your private payments, your sessions and your Lovejoin boxes to your public account. A VPN hides who you are, not that the requests come from one place. Running your own Koios is the only way to take Koios out."

### 5.2 giveme.my sees every private transaction

Sources: observers-4, docs-2, onchain-7.
- Shared collateral means giveme.my must see each transaction to check and sign it. From one IP it can group all private spends, and tie a session's funding to its boxes coming back.
- **Mitigations:**
  - state its logging honestly;
  - switch VPN server between a mix and its boxes' return.
- Keep giveme.my hardcoded (constants.rs:79-88). A self-hosted provider would put the user's own collateral UTxO in every spend.
- **privacy.md:** "giveme.my and Koios each see every private payment the wallet sends, from your IP address, so each can group them as one person's, including a session's funding with its Lovejoin boxes coming back. Lovejoin and the random waits hide your boxes from people watching the chain, not from the services that carry them."

### 5.3 Lovejoin hides a box among Seedelf Wallet users, not among 30 boxes

Sources: defaults-11, onchain-2, docs-4.

**Why**
- The session pays every mix in the open, so its 3^depth leaves are public.
- The wallet's way back is recognizable: one output into the Seedelf contract under a register datum, one box per transaction, paid from itself. Lovejoin's own app writes no datum; its UI uses giveme.my too, so the collateral alone doesn't mark it.
- Timing narrows it further: 1–6 h, at an unlock.
- The floor counts boxes that aren't the wallet's, whoever put them in and however long they've sat. Seeded or idle boxes single a leaf out rather than hide it.
- The wallet already builds the most private withdraw it can. Don't adopt an Owner-spend redesign: its change output carries the same datum.

**Ways to grow the crowd**
- The ecosystem fix: Lovejoin's own UI writes a fresh register when it withdraws to a Seedelf (the issue at chunk-16-lovejoin.md:89), so both apps' exits look alike.
- Optional: count recent Seedelf-shaped withdraws from mix_box that aren't the wallet's, as the only measurable stand-in for the crowd. Show it on the review, or skip Lovejoin when it's zero. This costs an extra Koios read.

**Wording for privacy.md:125-126 (and the same under the public mix, :130):** "A box's way out shows where it goes. The wallet's go into the Seedelf contract under a register; Lovejoin's own app writes no datum. So a box hides only among the fan-out's leaves whose owners also bring them back into a Seedelf around the same time, not among all 3^depth leaves or the 30 boxes the floor counts. While few people do, a box coming back a few hours after its mixes can be picked out: for a session's return that ties it to the session, for a mix from the public account, to the account. 30 boxes means enough to mix with, not 30-way hiding."

### 5.4 Box return times follow when you use the wallet

Source: defaults-8.
- "Boxes can only come back while the wallet is unlocked (the proof needs the key), so their withdraws fall within the times you use it; compared with your public account's transactions over many boxes, that can hint they're yours. Bringing one back now makes it plainer."

### 5.5 Fixed-size boxes, and a single private UTxO

Sources: defaults-1, defaults-2, onchain-1.
- A payment above one box's worth, from money that is all boxes, has to merge boxes. With one private UTxO, every session chains to the last; only splitting or mixing first (the Lovejoin tile, at its fees) avoids it.
- **Wording:** "Spending more than one box's worth of Lovejoin money at once merges boxes and largely undoes the mix. A session funded from money you moved in yourself traces back to your public account through its funding, as a transfer does."

### 5.6 A session account looks like a Seedelf session

Sources: onchain-9, dapps-9.
- The funding shape marks it: a spend of the Seedelf contract with giveme.my's collateral, paying an amount plus exactly 5 ₳ to one fresh address, whose stake key is never registered. Anyone can list sessions this way, so a session hides among Seedelf's users, not all Cardano wallets.
- Keep exactly 5 ₳: it matches common collateral, and a random amount would be a Seedelf-only mark.
- **Wording (after privacy.md:111, pointed to from :120):** "The funding's shape, an amount and a separate 5 ₳ collateral to one new address from a Seedelf spend, tells anyone watching that it's a Seedelf Wallet session as soon as it lands, before the account places its order or connects. Everything after links to it anyway."

### 5.7 Sites see the browser

Sources: dapps-8, observers-13, docs-10.
- A CIP-30 wallet can't stop a site's own records: the IP, cookies, logins, the fingerprint, and the scripts in its top frame, or a tracker it shares with a site that saw the public account.
- A separate Chrome profile keeps cookies apart; restoring the phrase there is safe, because `freshIndex` keeps session indexes apart. A VPN hides the IP. Neither does both alone.
- The wording is in §2.12.

### 5.8 Minswap groups swaps by IP

Source: observers-14.
- "Its IP address lets it group every swap made from that address, those running together and those after, and tie them to anything else done at Minswap from it (its own site with your public account, say). A VPN hides the address."
- A random stagger between polls wouldn't break this.

### 5.9 The connector's presence while it's on

Sources: docs-17, observers-15.
- Every CIP-30 wallet is found this way. With the connector off (the default), no site can tell the wallet is installed.

### 5.10 The browser and the device

Sources: device-11, device-9.

**What the wallet can't prevent**
- The Web Store and Chrome Sync know about the install.
- While the wallet is unlocked, DevTools on its tab can read session storage (see crypto review "Not fixed" #1).
- The OS may page memory to disk.
- A copied ID leaves the wallet for good. A timed clipboard clear doesn't reach clipboard history or sync, and can wipe something copied since, so don't add one, and don't add `clipboardRead`.

**Wording for the policy's "Your control" (after :61):** "The Chrome Web Store and Chrome itself know this extension is installed in your browser, and Chrome Sync, if it syncs your extensions, installs it in your other signed-in browsers. Only the extension is synced, never your wallet. While the wallet is unlocked, anyone using your browser can see your balances and history, and someone who knows Chrome's developer tools can read your keys. Lock the wallet (or close the browser) before leaving it."

Also:
- add a clipboard line to privacy.md's "On this device";
- add a privacy callout to Activity's details for private IDs;
- correct the CSP/DevTools sentence at architecture.md:44.

## 6. Docs to correct

These are the corrections not already named in §2–§5.

| Doc | Change | Source |
|---|---|---|
| privacy.md:85 ("never polls in the background"); architecture.md:250; privacy.md:115, :129; roadmap.md:501 | Say what really runs. The balance is read only when Home opens or on Refresh. While unlocked, a one-minute alarm reads only what's running: a swap's account and its Minswap orders, a chain, a box that's due, a maybe-sent payment every 2 min. At unlock, the pool is read once on each network with Lovejoin open. Home polls `tx_status` every 15 s while waiting. Locking stops all of it, and a VPN must stay on until the work is done. | observers-12, docs-13 |
| keys-and-accounts.md:64 | Probes the next index alone, and a window of 20 only if that index was used (sessions.ts:2162-2173; launch review #22). Add a pointer at crypto-review.md:17. | docs-14 |
| privacy.md:74-77; flows.md:273-274; architecture.md:128 | Describe coin selection as it's actually implemented (after §2.3), not "should". | onchain-1, defaults-1 |
| architecture.md:445 | "On preprod, spare ADA goes through Lovejoin first" → "on mainnet, once the pool floor is met". | defaults-17 |
| Settings' Lovejoin note (Settings.tsx:326-331); LockCountdown; LovejoinNote and LovejoinCost; flows.md:352 | Add: a swap's ADA proceeds count as spare; about 0.3 ₳ to bring each box back; at 3 waves the mixes cost more than the box (about 10.7 ₳ for 10 ₳); a chain sends only while unlocked, and locking cuts it; how to turn Lovejoin down (§4.1); a rough send time. LockCountdown: "A Lovejoin chain is being sent: locking now stops it partway." Qualify flows.md's "Pause and resume at any point". | defaults-17 |
| privacy.md:134; ClaimAll.tsx:246-247 | With Lovejoin, the chosen sessions' deposits land in the same block or two and their mixes share blocks. A shallow pool serves the first sessions, and the rest come back directly. Bringing each back from its own page, hours apart, avoids both. | defaults-16 |
| flows.md:350; privacy.md | A stopped or refunded swap's ADA goes through Lovejoin unless the user chooses direct. A direct return joins the funding's change, already tied to the session. | defaults-6, onchain-4 |
| privacy.md:124; LovejoinReturn.tsx comment | List where the no-audit note appears, adding ClaimAll and the ADA→token approval. | docs-5, defaults-6 |
| store README.md:41 and "What it doesn't hide"; Settings.tsx:152 (MOVE_TO.mainnet); the welcome screen's NETWORK_NOTE.preprod; README.md:11 | The preprod line becomes "…with a recovery phrase you don't use on mainnet: the same phrase has the same keys on both networks, so anyone comparing them can tell they're one wallet's". If the unlisted item is updated, migrate installs that have a vault and no `seedelf.network` to preprod in `onInstalled` (sw.ts), rather than landing testers on mainnet. | docs-18 |
| privacy.md Network; flows.md:86, :160, :346; privacy policy | Explorer links open Cardanoscan in the browser's own profile, only when clicked. Cardanoscan then sees the IP, its cookies and what was opened. | docs-15, device-2 |
| architecture.md storage table | Add `sessions.<net>` and `lovejoin.<net>` to the sealed row; `dappPassword`, `lovejoinDepth` and `lovejoinDelay` to preferences; rows for `seedelf.prices` and `seedelf.openIn`; say the pools' time shows when staking was last browsed. privacy.md: sealing hides a record's contents, not whether it exists or its rough size, and Remove wallet isn't a secure erase. | device-6 |
| Policy :20 (settings row) | The currency default, the new switches, the 5-minute price cache, and what survives Remove wallet. | defaults-13, device-6 |
| Policy rows 17, 24, 26; privacy.md:117, :122 | The sessions record keeps each session's transactions and a site's origin until cleared (after §4.6: "You can clear it in Settings"). | device-7 |
| Plans and comments | chunk-15c:10 and chunk-15-dapp-connector.md:216: "unlinked" → "not linked on chain". chunk-16-lovejoin.md:16 ("1 in 9" assumes exits look alike), :18 (unlock timing), :17 and :162 (delay), :411-414 (box preference, once built). Header comments at sessions.ts:3, Swaps.tsx:4, and CreateSeedelf.tsx:6 (the draft goes to Ogmios at review). | onchain-3, dapps-8, onchain-2, onchain-11, observers-11 |

## 7. Already private by default

- **Private spends:** each Seedelf spend has a fresh one-time key with a hedged nonce and uses giveme.my's shared collateral, so no user UTxO tags it. Every output to a Seedelf goes under a fresh re-randomized register checked by `is_payable`. Proofs are measured in the wallet, so a review sends nothing.
- **Reading tells no one what's yours:**
  - the contract scan and Lovejoin's pool read are the same for every user, and ownership is decided in WebAssembly;
  - the private Activity is built on the device;
  - a recipient's Seedelf is found in the scanned view, never through `asset_utxos`;
  - token names, logos and the DRep list ship with the wallet.
- **Sessions:**
  - they use the reserved account 24301', with a fresh index each and their own never-registered stake key (a site's request to register it is refused);
  - the next index is probed alone first;
  - a site on a session sees and signs only with that session's keys, never the Seedelf key.
- **Returns:** Lovejoin is on by default for session returns and token→ADA proceeds, with the 30-box mainnet floor. A skipped return says why. A return merges into its funding's change. Each session comes back in its own transaction.
- **Lovejoin's mechanics:**
  - boxes are exactly 10 ₳ with no tokens;
  - every mix re-randomizes and securely permutes, and every wave is mixed again;
  - pool boxes are drawn at random, never the wallet's own;
  - delays come from `crypto.getRandomValues`;
  - one box goes per run, and the rest are spread 5–60 min apart;
  - unmixed boxes never come back by themselves;
  - each box comes back into its own fresh register, paid from itself.
- **The connector:**
  - off by default, with nothing a page can detect: no `web_accessible_resources`, no `externally_connectable`;
  - top frames only when on;
  - the site's origin comes from Chrome;
  - the password is asked at every site signature;
  - site requests are rate-limited;
  - a site can't spend locked UTxOs or collateral.
- **On the device:**
  - records that say something about the user are sealed under a key derived from the phrase;
  - which UTxOs are yours lives only in session storage and is wiped at lock;
  - storage is set to `TRUSTED_CONTEXTS`;
  - the UI talks to the worker over a port only the wallet's own pages can open.
- **Nothing phones home:** no analytics or telemetry, no Koios API key, a CSP limited to the four services, every asset bundled, no console output, a static tab title, and `rel=noreferrer` on links.
- **Mint first:** the account-paid mint is the default. Get started orders fund → create → make private, and each mint option says what it links.
- **CoinGecko, when on:** one request covers every currency (so the choice isn't revealed), for ADA only, never on preprod; "off" asks no one.
- **Nudges and warnings:**
  - round amounts, and timing right after a Make private;
  - Max spending UTxOs together, and co-paying several recipients;
  - Make public to your own stake-keyed address;
  - public notes, offered only on public sends and empty by default;
  - $handle lookups;
  - the UTxOs screen's explorer warning.
- **Coin control:** a locked UTxO stays out of every spend, Max included.
- **The phrase:** it can't be copied, a paste clears the clipboard, and showing it asks for the password again.
- **Swaps:** order destinations are checked (`checkOrder`), and only DEXes that take orders are used.
- **Networks:** records are kept per network, and switching to preprod warns that the keys are shared.
- **giveme.my's own logs** leave out raw IPs and, on success, transaction hashes. That's worth stating in the policy (§2.5).