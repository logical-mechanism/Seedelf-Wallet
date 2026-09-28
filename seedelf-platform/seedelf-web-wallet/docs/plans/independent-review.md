# Independent review (2026-09-27)

A fresh review of PR #264 (`web-wallet/crypto-review` into `seedelf-web-wallet`) before mainnet, run at bf8c1f9 after the [crypto](crypto-review.md), [launch](launch-review.md) and [privacy](privacy-review.md) reviews and their fixes. It assumed those reviews missed things, and took from them only the owner's settled decisions and the items already known to be open.

**How it was done:**

- **Seventeen finders**, each with one lens:
  - eight went deep on one area: the maybe-sent watch, the swap runner, sessions' funding, returns and disconnect, Lovejoin, the dApp connector, the worker's runs and lock, history-aware selection, and the network switch;
  - four swept the whole code for one outcome: money paid twice, stranded funds, links the privacy docs deny, secrets and trust boundaries;
  - five read the fix commits of each earlier round for the bugs the fixes brought in.
- A completeness critic sent out two more rounds of finders: restore and Remove wallet, the UI as an actor, what's approved against what's sent, and a DEX order's lifecycle.
- 102 reports merged into 65 findings. Each was checked by three agents: one told to refute it from the code, one to reproduce it, and one to judge its impact and whether it was already known. A test showed 56 of the 63 confirmed findings; the other 7 were traced line by line.
- One verifier checked Minswap's live mainnet API (unsigned build previews) for M16.

**Verdict:** nothing critical. No finding lets a stranger or a site take funds, or leaks a key. But two highs let a stranger strand a private session's money for about 10–50 ₳, and many of the findings came from the earlier rounds' own fixes, in the worker's state machines, where two features meet.

## Status

**Everything below is fixed on `web-wallet/crypto-review`, except what *Not fixed* lists.** The *Commits* column names the fix and its follow-ups.

How the fixes were made:
- Eight areas (A returns, B submits, C timing, D chains, E connector, F swaps, G selection, H close) were each fixed in their own worktree, then reviewed adversarially there, with up to two rounds of fix-ups.
- The main session merged them, fixed the tests one area's change broke in another's, and made M8.
- A final review of the merged fixes looked for bugs where two areas meet, and for anything left unfixed. Its 13 findings were fixed the same way, in three more worktrees: see *Final review*.

**Checked on the branch** (2026-09-28, at the last commit):
- Rust: `cargo test --workspace --locked`, 456 passed (the 8 live Koios tests are `#[ignore]`d); clippy and fmt clean.
- WebAssembly: the Node tests, 37 passed.
- Vitest: 1015 passed on the default build (both networks) and on a preprod-only build.
- Playwright: 60 passed on the dev build, and 60 on the packaged mainnet store build.

**Not fixed:**
- **M14** is the owner's call (see *For the owner*).
- **L6:** a site's transaction that never lands hides its inputs for up to 2 h. A lock clears it.
- **L13 part A** is the designed "once" rule: a box drawn at an unlock that didn't go before the next lock goes a minute into the unlock after.
- **L34:** Disconnect waits while a site's session holds anything. That's the documented flow, and each payment that keeps it open is money the user gets back.
- **L43** affects only unreleased mainnet-enabled builds from before 5919298.
- **D1** is the documented order. L39 fixes its note's wording.
- **D2** only its cheap part is done: a swap never closes while Minswap lists an order for its account.

**For the owner:**
1. **M14, a restore's Lovejoin boxes.**
   - A restored wallet has no chain records, so it can't tell a box that a cut chain never mixed from one that was mixed. It schedules them all.
   - The private-by-default option is to hold every unrecorded box after a restore until the user picks Mix again or Bring back. That changes what a restore does, so it's your call.
   - It follows from the known "chain records live only on this device".
2. **H1's rule for a stranger's tokens.**
   - A return now takes a stranger's token UTxO only when that UTxO's own ADA pays what its tokens add to the return. A single token, or a DEX's fill, easily does.
   - A delivery of many tokens with little ADA stays at the one-time account, recorded as left behind.
   - A site's own transactions, signed for its session, count as the session's own (F4): their outputs come back whatever they hold.
   - Letting the session's spare ADA pay a stranger's shortfall, shown in the review, would be a further change.
3. **L16's wait.** A cancel whose return waits on an order Minswap never lists holds the session's money at its account, so that order's cancel can still be paid for. A timed escape (bring the rest back after a long wait) was left for a decision.
4. **M16 and M17, swap routing.**
   - SundaeSwapV3 is out of mainnet routing. Its orders sit under a fixed staking part, with the owner's stake key, so the order check can't pass them and a cancel would need the session's stake key.
   - Every protocol Minswap offers that isn't in `MAINNET_PROTOCOLS` is now excluded, and the fresh estimate's route is checked before an order.
   - Minswap's build-tx still routes on its side: that stays trusted, with the minimum and receiver fields (settled).

**Behaviour to know about:**
- **Nothing goes out right after an unlock.** No Lovejoin withdraw goes within 5 minutes of any unlock, create or restore (M10), and a swap step found soon after an unlock waits a fresh draw (L10–L12).
- **Maybe-sent payments:**
  - A payment is sealed as maybe sent before Koios is asked (M1).
  - Only one payment is submitted at a time on each network.
  - A maybe-sent payment's record survives Remove wallet, so the same phrase's restore keeps watching it (M2).
- **Remove wallet** refuses, unless confirmed a second time, while a payment may still go through, a private session holds money or a Lovejoin chain is being sent (M5).
- **A site's `submitTx`** that Koios didn't answer is answered with the transaction id, and never with Failure (M3).
- **A session ends only once Koios shows its funding's outputs spent** (M4). A funding asks Koios about its index once more before it's sent (M13).
- **A top-up puts a 5 ₳ collateral back** when the session's account holds none (M9).
- **A swap's return** keeps the depth and wait it was approved with (L21), and a refunded order says so (M18).

## Final review

Once the eight areas were merged, a cross-area review tested where their changes meet.

- **Eight lenses:**
  - every submit path and its maybe-sent state;
  - the unlock and quiet rules;
  - a session's life;
  - Lovejoin's chains and schedule;
  - selection and history;
  - the connector, reset and network;
  - the fix-ups no one had reviewed, with the merge resolutions;
  - whether every finding is fixed on the merged tree.
- **Verification:** each report was checked three ways, as before.
- **Result:** 12 findings confirmed, all medium or low. None refuted.
- **F13:** a thirteenth report was set aside as a residual the areas had accepted. It's added here because a cheap fix closes most of it.

They were fixed in three more worktrees (pending and connector, sessions, Lovejoin), each reviewed adversarially there until a review found nothing more to fix, then merged. All 13 are fixed.

| # | What | Of | Commits |
|---|---|---|---|
| F1 | Remove wallet neither listed nor kept a public mix stopped at a deposit that may have gone through, so a restore could pay a second deposit. | M2, L5 || 660caf3 |
| F2 | A public mix stopped at a maybe-sent mix held the account's collateral from sites until a page looked (up to 2 h), and the refusal said a chain was being sent. | L5 || f2f0023, 18219b0 |
| F3 | A return through Lovejoin (the default) whose last transaction a lock cut off never got its history entry, so its output read as received. | M7 || 5e0364a |
| F4 | A site's own signed transaction's many-token output counted as a stranger's, was left behind, and Disconnect then closed over it. | H1 || 931ce17 |
| F5 | A withdraw Koios refused while the wallet was locked stayed sealed as `withdrawing`, was sent again, and held every other withdraw up to 2 h. | M1, M11 || 5e8f737 |
| F6 | A withdraw's resend could go seconds after an unlock that fell inside its tx_status call. | L11 || dbe70d6 |
| F7 | A payment's settle begun before a lock could resend at the moment of the next unlock. | L9 || 231a060 |
| F8 | Letting a maybe-sent payment go as unseen erased its last resend's time, so a box could go within 5 minutes of it. | L8 || 53f6bcb, 863c34a |
| F9 | An approved swap's wait wasn't tied to its own boxes: another chain's earlier due time could bring its box back first. | L21 || 9f7cbc2, 7d35f30 |
| F10 | A public mix's "may have reached a node" was lost through a resend, so the chain could stop as refused, releasing its hold while that mix could still land. | L5 || 16e363c |
| F11 | A session transaction sent again and refused as spent was marked unsent though its first try might be on its way. | L15, M7 || 1340fba |
| F12 | A site that sent again a transaction the wallet keeps as maybe sent heard Failure on a 429 or another refusal. | M3 || 550ef5f |
| F13 | A site session's funding was never marked confirmed in the ordinary connect flow, so M4's check let its unknown outputs pass on lagging reads. | M4 || af1c8fd |

## High

| # | What | Fix | Commits |
|---|---|---|---|
| H1 | **A stranger's token UTxO at a session's account wrote off all of the session's money.** When a return couldn't pay the deposit for a stranger's tokens, `buildBack` recorded every row as left behind (the proceeds, the change and the 5 ₳ collateral) and never tried again. A mix-again session then held every Lovejoin box. From 9bca40a. | WebAssembly plans a return by cost (`plan_return`): the session's own and ADA-only UTxOs first, then each stranger's token UTxO only when its own ADA pays its tokens' deposit and the draft stays under the size limit. Only what's left out for `cost` is recorded as left behind, the session's own `fee` rows are tried again when more arrives, and a session with nothing that can come back (`nothingBack`) doesn't hold the boxes. | 805d415, ece5f1f |
| H2 | **A return had no bound on cost or size.** About 25–50 ₳ of junk tokens made every return of a session fail for good, the Lovejoin chain's return too; the H6 fix left out only u64 overflows. | As H1: the chain's return shares the plan. What's too large waits for the next return (`size`); what can't pay its way stays (`cost`). | 805d415, ece5f1f |

## Medium

| # | What | Fix | Commits |
|---|---|---|---|
| M1 | **Maybe sent wasn't written ahead.** A lock, auto-lock, closed browser or trapped WebAssembly during a submit left no watch, no sealed copy and no held inputs, so a later payment could pay again. | The payment is sealed as maybe sent, with its inputs held, before Koios is asked. A definite refusal takes it back; a lock meanwhile leaves it watched. Lovejoin's withdraw writes its record ahead too. | 2f7a1d8, 08e6a46, fbff918, a58abe6, bbc04c8, 60efaab, 0ccfb5a |
| M2 | **Remove wallet and Forgot password lifted the maybe-sent guard.** A restored wallet could pay again. | An unsettled `maybeSent.<network>` is kept through a reset: it's sealed under the phrase's key, so the same phrase's restore watches it again, and another phrase's restore deletes it. | 650e8d4, fbff918, c475c4b, 098bfcd |
| M3 | **A site's `submitTx` answered Failure for a transaction that might land**, so the site's retry could pay twice. | A submit Koios didn't answer is kept as sent (its inputs held), looked for and sent again a few times, and the site hears its id. | 07a9677, 2b9fd04 |
| M4 | **Disconnect trusted one Koios read.** A backend behind the funding read the account empty, and the session's record was deleted with its money at 24301'. | Each funding and top-up records what it pays the account. A session ends, or disconnects, only once Koios shows each of those spent; otherwise "Koios hasn't caught up". | 19e3b9d, efcea58 |
| M5 | **Remove wallet said "your recovery phrase brings them back"** without checking private sessions or chains, and the restore scan isn't built. | Remove wallet lists what's at stake on each network (a payment that may still go through, sessions holding money, chains being sent) and needs a second confirmation; the copy says a restore doesn't find sessions' money yet. | 650e8d4, c475c4b, 091b923 |
| M6 | **History-aware merging could stop payments that a few boxes would cover:** it put every small or token UTxO before any box, then gave up at the first computation or size limit. | Merging tries orders in turn, each grown one UTxO at a time, and moves on only at a limit more inputs can't mend: the history order, then the same without the purpose's order, then as few boxes as pay, then the CLI's own. It never refuses what the CLI's order would pay. | 769049b, 9c48db2, 79b2c89 |
| M7 | **A direct return Koios didn't answer never got its history entry**, so its UTxO later read as received, and fundings took it first. | The return's summary is kept with it, and its history entry is written once it's seen on chain, whichever copy lands. | fcf36e8, fc16cea |
| M8 | **Privacy review §2.9 was undone by other paths.** A box brought back, a session's return and a site session's submit dropped the whole balance reading, so Home read the public account moments after. | They mark only the private side behind; a swap, a cancel or a chain's mix touches neither. | 255000e |
| M9 | **A site session's first return spent its 5 ₳ collateral, and Top up never put one back**, so every later return skipped Lovejoin and `getCollateral` found nothing. | Top up adds the 5 ₳ collateral when the account holds none, and its review says so. | 8bad610 |
| M10 | **The 5-minute quiet rule forgot the last send across a lock** or a browser restart. | The last send is the later of what's known and the unlock (`unlockedAt`), and the send times survive a lock. | 61db043, d597286 |
| M11 | **A withdraw Koios refused with a 429 was kept as maybe sent**, and its resend skipped every timing rule. | Only a submit that may have reached a node is maybe sent. A resend waits for the same gates as a new withdraw: never in the unlock run, or in a run that sent anything else, and pushed within 5 minutes of a send. | 08e6a46 |
| M12 | **A private session's signing prompt always said the public account wasn't in the transaction.** | The worker checks each paid address and each found input against the public account and the other sessions, and the prompt names a match and warns. The assurance shows only when nothing matched. | e2a82d0, e66aaf3 |
| M13 | **`freshIndex` saw only landed transactions**, so two profiles on one phrase, or a reset, could put two sessions on one key. | Each funding asks Koios about its index once more just before it's sent. | 64b1b76, f3a133e |
| M14 | **A restore brings a cut chain's unmixed boxes back by themselves**, which ties them to the deposit's payer. | **Not fixed**: the owner's call (see *For the owner*). | |
| M15 | **A site's `getUtxos`/`getCollateral` amount had no size cap**, and one call ran WebAssembly out of memory; signData's address wasn't capped either. | Both are capped, `read_value` stops at 1,000 entries, and a trap is handled as one. | 4d317ab, 7aac138 |
| M16 | **Every mainnet swap through SundaeSwapV3 paused after funding:** its orders carry a fixed staking part, which `checkOrder` refuses. | SundaeSwapV3 is out of mainnet routing (see *For the owner*). | fd08346 |
| M17 | **`MAINNET_PROTOCOLS` was enforced only on the quote**, not on the order signed. | Every other protocol Minswap offers is excluded on mainnet, and the fresh estimate's route is checked before an order and in Review it myself. | e41250b, 0ab5074 |
| M18 | **A refunded order was recorded as filled**, and the page said "Done: the swap is in your private balance". | What arrived decides filled, partly filled or refunded, and the page says which. | 7b61c28, 19b1a7e |

## Low

| # | What | Fix | Commits |
|---|---|---|---|
| L1 | A private maybe-sent was dropped after 20 minutes while every resend was refused as spent (it was in a mempool). | A resend refused as spent looks its inputs up: while each is on chain and unspent, it's held as in a mempool, not dropped at 20 minutes, for up to 2.5 h. | f788f94, fbff918, 9957e3c |
| L2 | A 2xx whose body couldn't be read counted as a refusal. | It's maybe sent. | 1a0eaac |
| L3 | One Koios error in the watch let the alarm stop. | A failed look keeps the alarm going. | 481e156 |
| L4 | A maybe-sent payment never started the alarm, so with no page open it wasn't sent again. | It starts the alarm when taken or restored. | 752622f |
| L5 | A public mix's deposit Koios didn't answer showed "stopped after 0", with its inputs freed, so Mix again deposited twice. | It stops as "may have gone through", holds its inputs and reservation, and no public mix is built until it's settled. | 048a811, ffdcb30, 2e7d3aa, 563c81f, 581febd, bf00cf9, c72329b |
| L6 | A site's transaction that never lands hides its inputs for up to 2 h. | **Not fixed** (a lock clears it). | |
| L7 | A site could resubmit old transactions for free and flush the wallet's spent memory. | Sites' spends are kept apart, with their own cap; an already-on-chain resubmit records nothing. | 5c36814 |
| L8 | A maybe-sent resend didn't count as a send, so a box could go right after it. | Every resend records its send time. | 0f71729, 08e6a46 |
| L9 | The unlock run, and Home's first look, resent a sealed maybe-sent payment at the unlock. | The unlock only looks; a restored record waits two minutes before its first resend. | 461cce3, e4e7102, 45b3ea4 |
| L10 | The unlock's fresh draw came only after the unlock run's reads succeeded. | The draw comes first, from the sealed schedule, in whichever run gets there. | 61db043, 05a4a3d |
| L11 | A run in flight across a lock and an unlock carried on as a normal run. | It carries on as the unlock's run, which sends nothing. | 61db043, c38ce7d |
| L12 | An open swap page could step before the unlock run marked the wait. | Any run or page that finds no draw since the unlock draws one. | 61db043 |
| L13 | A box due in the first minute after an unlock went at the first alarm run. | Part B fixed: such a time is redrawn. Part A (the "once" rule) **not fixed**, by design. | 61db043 |
| L14 | A public mix kept resubmitting for minutes after a lock. | Each retry checks the chain is still its own and the wallet unlocked. | b65c034 |
| L15 | A swap copy tx_status didn't show counted as never placed, so Stop could close while its order sat at the DEX, or a second order go out. | Its recorded orders are looked up first; a swap never closes while an order is open. | d9abced, 8caec06, 2366ae7 |
| L16 | After a cancel, the return didn't check every order of the swap was spent. | It waits for them, as the fill path does. | e6eeb6e |
| L17 | After one chain of a session stopped partway, every later return skipped Lovejoin silently. | Only the current chain counts. | 6b65c3c, c421bd2 |
| L18 | A spend reviewed before a return's chain started could take what the chain's return merges into. | Send refuses it, and the chain refuses a return whose inputs went elsewhere since review. | 324b56e, 1fcebcc, d570d7e |
| L19 | A stale left-behind entry kept a disconnected site's record, origin included. | Disconnect keeps only entries still at the account. | 71b0c16 |
| L20 | A stranger's 5 ₳ with a deep datum could stand as the chain's collateral and make it skip. | The fallback collateral has no datum and no reference script. | 10f19f4 |
| L21 | The approval said Settings turns Lovejoin off for the swap; the runner used later depth and delay changes. | A swap keeps its approved depth and wait, and the approval says Settings changes swaps started after it. | 5204481 |
| L22 | Stop's "No order is placed" could come from a stale view. | The dialog reads the session fresh, Stop says whether an order went out, and the copy is hedged. | 2d4cfb9, f1c0cf0 |
| L23 | A cut chain's copy said what's left comes back by itself, which isn't so for a site's session. | It says Bring it back returns it. | 125d766 |
| L24 | The timeline showed the approved minimum, not the placed order's. | It shows the placed one. | 37eda7a |
| L25 | After a dropped window only the oldest transaction was resent, so the chain stopped. | Every flying transaction is resent in order. | 194d0f2, 38d7566, c4d1203 |
| L26 | Two pumps of one public mix could run at once. | A per-network claim before any await. | 12e2d6d |
| L27 | Reservations were written after the evaluation, so two chains could draw the same boxes. | Reserved as soon as WebAssembly returns; an overlap rebuilds. | d267c5c |
| L28 | A chain's progress was saved before its sealed record. | The record first, then the progress, rolled back on failure. | 700258b, 2943784, cbda943 |
| L29 | The withdraw schedule's trim could drop due times a new deposit had just added. | Trimmed inside the update, and not while a chain is live. | a13ca3b |
| L30 | With two pages open, a public mix could take over a sending chain's reservation. | A Send refuses while another public chain is being sent, and a review never replaces a sending reservation. | a1b58fc, ffdcb30, 25203cd |
| L31 | A page that went away mid-prompt left its call counted, and after 32 the site was locked out. | Its requests are ended. | 71f1b40, 70b9ce7 |
| L32 | A site could take the collateral a Lovejoin chain still needs. | Refused while the chain is sent. | 6e95c47 |
| L33 | A waiting request outlived Disconnect and turning the connector off. | They're declined, and the approval checks again. | 262f8bd, f42eca5, b6c9a40 |
| L34 | Disconnect waits while the session holds anything, and anyone who knows its address can keep it holding something. | **Not fixed**, by design. | |
| L35 | Any page could call `enable()` over and over and fill the wallet's queue. | One connect per origin, a refusal after a decline, and a per-origin cap. | 494a65a, 4f6aae4, 70b9ce7, 47b3b2c |
| L36 | The minute after a closed unlock window told any site "Seedelf Wallet is locked." | It hears what it would while unlocked. | 494a65a |
| L37 | The funding and Top up reviews gave a count of tokens, not amounts. | Each token with its amount. | 4e7a585 |
| L38 | After a restore, existing UTxOs were classed as received, not Unknown. | What a new history finds already there is Unknown. | f5fd9c7, e048f20 |
| L39 | Merging ignored the purpose's order, and the note claimed "Nothing else could pay". | The rank is in the order, and the note says what's spent together. | 769049b, 79b2c89 |
| L40 | Trimming the history turned old boxes Unknown, so two could merge with no note. | Entries whose outputs are still held aren't trimmed, and Unknowns are kept apart while anything is known. | f3726ba |
| L41 | A funding's change was classed only as its session, so notes undercounted. | It carries the inputs' histories too. | 3170a37, 70426db |
| L42 | Removing a wallet from before the switch moved the network to mainnet. | The network in use is kept. | 0b65b75 |
| L43 | A mainnet wallet from an unreleased mainnet-enabled build before 5919298 reopens on preprod. | **Not fixed** (no released build). | |

## Disputed

- **D1:** a stealth mint spends one made-private UTxO rather than merging two received payments. Two verifiers called it the documented order. L39 fixes the note's wording. **Not changed.**
- **D2:** a partial-fill remainder order would pay into a closed session. No order Minswap builds on mainnet leaves one today. Only the cheap guard is built (L15).

## Checked and fine

- **Crypto:**
  - The Seedelf proof's nonce is hedged and binds the one-time key's hash.
  - Lovejoin's RFC 6979 and sigma-OR nonces are sound.
  - One-time keys come from a fresh seed per spend.
  - The private store's key comes from the entropy.
- **Records:** every sessions-book and Lovejoin-record write is serialized. A listing without refresh never writes.
- **Mainnet:** the contract and mix_box hashes match between the worker and Rust.
- **Secrets:** no secret reaches a page, a site, a log or an error. The one trust-boundary finding was M15's denial of service.
