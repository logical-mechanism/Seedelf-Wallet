# 1.9.0's release review: the v-ui-lows verifier

The verification, told to refute. Verbatim from its structured report; full addresses of third parties shortened.

## Coverage

Read at 8d7c4b0c: tx-view.ts (all); TxDetail.tsx 300-380, 420-450, 600-645; Swaps.tsx 2230-2275, 2426-2790, 3363-3445; sessions.ts swapBuild/cancelBuild (3161-3228), liveOrders/placed (3950-4052), cancelOf/cancelsChecked/referenceRows/inspect/review (4185-4455), submit (5594-5604), live/utxosOf/listing (5906-5936), indices/book; dapp.ts answer (646-710), withDappKeys/withViewKeys (1294-1311), view/read (1608-1657), resolve (1792-1830), readTx (2030-2106), publicKeys (2401-2433); ui-port.ts; sw.ts 47, 388-430; wallet.ts 215-237, 480-600, 615-655; handlers.ts 405-492; manifest.ts; data-layer.ts 225-262, 431-440; account.ts; accounts.ts known/WIPED_ON_SWITCH; wasm/src/cip30.rs keys_of/of_hash (437-492), the required-signer loop (1335-1344), key_releases (1827-1838); DappApprovals.tsx 120-205, 1020-1145; the en.json strings; docs/privacy.md 124/186/188, privacy-policy.md 10-40/52/105, flows.md 256-275, architecture.md 133/562-563; PR #373's body; 1.8.1's TxDetail.tsx, Swaps.tsx, sessions.ts and en.json via git show web-wallet/1.8.1:<path>, plus git diff web-wallet/1.8.1 8d7c4b0c on tx-view.ts, TxDetail.tsx, sessions.ts and tests.

Ran: four Vitest probes in my own worktree (detached at 8d7c4b0c, node_modules symlinked, the main tree's wasm/pkg copied in), with npx vitest run ... --silent=false under systemd-run MemoryMax=8G. All 8 tests passed; the output is in probe-run.log. They use the public "abandon ... about" phrase written out in code, never vectors(). probe-phrase showed session0IsFixture:true, so the swap fixtures hold for it. Worktree removed afterwards; the main tree is untouched and clean; no network beyond the fakes (koios 0, fetches 0 in every view probe).

Not done: no Playwright/e2e (dapp-ui#1 was shown with a unit probe of DappService.answer instead of the finder's e2e). Timings come from Node with in-memory storage, not Chrome, where each queue turn also pays chrome.storage.session round trips: read the ratios, not the absolute ms. No cargo run (no Rust question needed it). I didn't audit every other non-site review for input-specific lookups. One untraced candidate for the same hint problem: Lovejoin's madeBy tx_info before taking a box of unknown origin (privacy.md:124, lovejoin.ts:6176-6227).

## Verdicts

### dapp-ui#3: confirmed, low (confirmed-by-run)

**Why.** Where the window says a DRep key signs: Rust's keys_of (cip30.rs:448-472) adds the DRep key 3/0 when governance was granted. Keys::of_hash (484-492) maps a required signer equal to it to Signer::Drep, the required-signer loop (1335-1344) puts it in `signs`, and key_releases (1832-1838) counts it. DappApprovals.tsx:1047-1053 turns `signs` into the row at :1136, label dappUi.signsWith "It signs for" (en.json:495), value "your DRep" (en.json:530). The finder's quote "Signs with … your DRep key" is a paraphrase. With a contract UTxO released, the window also shows the warning and the Sign switch (releasesContractFunds via keyReleases).

What Transaction details marks: markYours (tx-view.ts:247-307) builds every "yours" set without a DRep key (drepOf appears 0 times in tx-view.ts). The sets are:
- the active account: accountKeys(cardano, found?.keys), the first 20 of each chain plus the last reading's keys. SESSION_ACCOUNT_ADDRESSES is wiped on an account switch (accounts.ts:105-112), so those keys are the active account's.
- every session's keyHash and reward-address stake key, and the active stake key.
- each other known account: only accountKeys(cardano), the first 20 of each chain, and its stake key (:299-302).

The window's payment keys are the dApp view's discovered paths (dapp.ts:1649), which run past 20 for an account with used addresses. So a non-active dApp account's key past 20 is "yours" in the window and not in Transaction details.

How the two views disagree: in the same window, the details' rows (TxDetail.tsx:631-641) give the DRep key and 0/25 the same "Must be signed by …" as a stranger's key, while the window counts both as the user's.

No false "you" is possible: every set is derived on the device. The decision surface (the window's row, warning and switch) is right. What's wrong is secondary text, in an edge case: a governance-granted site naming the DRep key, or a non-active dApp account's key past 20. That is misleading text, so low. The wallet's own one-time spend key is also never marked: HKDF of the Seedelf key and a random per-spend seed (wasm lib.rs:2046-2060, 2366, 2406), not derivable after the fact.

**Evidence.** Probe zz-v-ui-lows-signers.test.ts. The dApp account is 1 and the active one 0; governance is on; the transaction spends a script UTxO with a script data hash, pays a stranger, and names as required signers account 1's DRep, its 0/5, its 0/25 and a stranger:
- probe-window {"signs":["0/5","0/25","drep"],"keyReleases":true,"releasedLovelace":"4830000","contractInputs":1,"othersSign":1}
- probe-window-text "It signs for 2 of your addresses and your DRep"
- probe-window-warn "Your signature helps release funds from a contract."
- probe-details {"dappDrep":false,"dapp5":true,"dapp25":false,"stranger":false,"requiredSigners":4}
- probe-detail-text ["Must be signed by 6b1ecc8b55…0c692e ","Must be signed by you 4a4632b7a1…a7f16c ","Must be signed by bb6a4abab2…1634d2 ","Must be signed by 4444444444…444444 "]
- Active account's own keys, with no reading stored: probe-details-active {"activeDrep":false,"active5":true,"active25":false}
- Koios calls during the view: 0.

Code: tx-view.ts:218-225, 267-306. cip30.rs:442-492, 1335-1344, 1832-1838. DappApprovals.tsx:1044-1053, 1136. dapp.ts:1649 (window keys) and 2414 (publicKeys adds drepOf, markYours doesn't).

**Documented.** PR #373: "**Transaction details** marks a required signer as yours." It states no limit. flows.md:261 documents the outputs' rule, which the payment-key marking inherits: "an output under one of the public accounts' payment keys (the first 20 of each chain, and those the last reading found)". That part is consistent with a stated design. Nothing documents or accepts leaving out the DRep key.

**The fix.** Right and safe: derive JSON.parse(cardano.drepOf()).hash in the active turn and in each known account's turn, as dapp.ts publicKeys (2401-2433) already does. It's a local derivation, one key more per turn, with no request and no refusal.

One nuance: Rust counts the DRep key only with governance (cip30.rs:466-470). Marked unconditionally, a site without governance that names the DRep key would read "Must be signed by you" in details, while the window counts it among othersSign and the wallet won't sign with it. That's true of ownership but a new disagreement. Passing the waiting request's governance flag to markYours avoids it.

The optional part, the dApp account's discovered keys: the dApp view kept under SESSION_DAPP_VIEW (dapp.ts:1614-1657) has the paths; hashing them in that account's withAccount turn is local too.

### cross#1: confirmed, low (confirmed-by-run)

**Why.** The hint at TxDetail.tsx:349 depends only on `site`, and Swaps.tsx:2693 passes none. Both session reviews end in review() → inspect(), which asks for the inputs and collateral the session doesn't hold: `const foreign = others.length ? await this.deps.koios(network).utxoInfo(others) : []` (sessions.ts:4359).

The data source is this.deps.koios(network), from chainClient (data-layer.ts:431-439):
- mainnet: DataLayerKoios, the owner's mainnet.seedelf.logicalmechanism.io, with Koios for a part that's down or with Koios only on;
- preprod: Koios.

The cancel review ("Cancel the order", Swaps.tsx:2577 → cancelBuild, sessions.ts:3220-3228) asks:
- liveOrders: utxo_info of the recorded orders (:4036); for a Splash part-fill also address_utxos and remnantsFrom (:4049-4051);
- utxosOf: credential_utxos of the session key (:5934);
- cancelOf: datum_info for an order whose datum is kept by hash (:4207), utxo_info of the orders' reference UTxOs (:4211; none for Minswap V1, whose script is carried), and epoch_params;
- inspect: utxo_info of the orders again (:4359).

The direct-swap review ("Review it myself", :2515, or "Place the order" by hand → swapBuild, :3161-3196) asks credential_utxos of the session key, Minswap's estimate and build-tx, then inspect's utxo_info of the Danogo pool UTxO and Minswap's collateral. An order swap's inputs are all the session's, so its hint is true.

What the hint says on both screens: "What each one holds isn't in the transaction, and the wallet asks nobody: looking them up would tell whoever was asked which transaction you are reading." (en.json:2809). The true text already exists (:2810).

1.8.1 was identical: its hint was unconditional for every view, the sign window included (1.8.1 TxDetail.tsx:349 hint={tr("tx.privacy.inputsHint")}), with the same Swaps.tsx:2693 and the same lookups (1.8.1 sessions.ts:4356, 4033, 4204, 4208). #373 corrected only the sign window. Its new test comment (tx-view-screen.test.ts:96) states the general rule "the wallet's own builds ask nobody", which these two reviews break.

Graded as a privacy statement in the UI: it is false on these screens. But the lookups themselves are documented, and they tell the asked party little it doesn't learn anyway. It's the server that lists the session's account and orders every minute while a session runs, and the one the cancel or swap is submitted through moments later (sessions.ts:5594-5597). On mainnet it's the owner's server, which logs neither IP nor queries. The extra is the timing, and, for a review never sent, a direct swap considered against that pool. False privacy text with no undocumented leak is misleading text, so low, not high.

The scenario's path is off: a swap that runs itself cancels at Stop with no review, so there is no "Review it myself on the cancel". The cancel review exists only on a session run by hand: one the restore scan found, or one from before swaps ran themselves.

**Evidence.** Probe zz-v-ui-lows-lookups.test.ts, the real SessionService over the fakes.

The cancel review:
- probe-cancel-requests ["utxo_info [\"7177c416…926f#0\"]","credential_utxos [\"e264f7d0…5984\"]","datum_info [\"9f7f3048…cf3e\"]","epoch_params","utxo_info [\"7177c416…926f#0\"]"]
- probe-cancel-minswap []
- probe-cancel-view {"kind":"cancel","inputs":["7177c416#0"],"hint":"What each one holds isn't in the transaction, and the wallet asks nobody: looking them up would tell whoever was asked which transaction you are reading."}

The direct swap, after the runner paused on a greedy build:
- probe-direct-requests ["credential_utxos [\"e264f7d0…\"]","utxo_info [\"b1b1…#0\",\"c1c1…#0\"]"]
- probe-direct-minswap ["estimate","build-tx"]
- probe-direct-view {"kind":"swap","againstPools":true,"inputs":["07070707#1","b1b1b1b1#0"],"hint":"…the wallet asks nobody…"}

Code: TxDetail.tsx:349, Swaps.tsx:2693, sessions.ts:4359 and 4362, en.json:2809-2810, tx-view-screen.test.ts:96.

**Documented.** The lookups are documented; the UI's "asks nobody" on these screens is stated and accepted nowhere.
- privacy.md:188: "A swap's orders are read from it too, never from Minswap: the orders themselves … Placing an order also asks it for the protocol parameters and, the first time the worker places one through a DEX, for that DEX's order script (its reference UTxO, the same for everyone) … Koios is sent the swap itself moments later."
- privacy.md:124: "a one-minute alarm reads only what's running: a swap's account and its orders, from Koios and never Minswap".
- privacy-policy.md:52: "The wallet doesn't ask it for that account's orders, or to cancel one: it reads them from the Cardano server and cancels them itself." The Changes entry of 7 October 2026 (:105) says the same.
- PR #373 scopes its fix to the sign window: "Its inputs hint is now true in the sign window, which does look up the inputs the wallet doesn't hold."
- flows.md:262 frames the view's design: "An input shows as txhash#index, and nothing more … a lookup would tell whoever was asked exactly which transaction you are reading."
- Doc gap (nit): privacy.md:186 (Danogo) never says the direct swap's review looks up the pool UTxO and Minswap's collateral.

**The fix.** Passing `site` is wrong. TxDetailBody's `site` also switches the signatures row (TxDetail.tsx:440) to tx.siteSignatures, "{{count}} already in it. Seedelf Wallet adds yours only when you press Sign, and the site sends it" (en.json:2850-2851). That is false for the wallet's own review, which has no Sign and which the wallet sends, and a direct swap does carry one signature already (Minswap's collateral owner's).

The renamed prop is right: a `lookedUp` flag that picks tx.privacy.inputsHintSite alone, set when review.kind === "cancel" || review.againstPools. That condition is exactly inspect's others.length > 0: direct = kind === "swap" && others.length > 0 (sessions.ts:4362), and a cancel always spends its orders. Returning the flag from inspect would be sturdier.

It reuses an already translated string, so no new es/ja. It makes no request and changes no data handling, so it needs no privacy-policy entry. Correct the test comment and add a screen test for both reviews.

### cross#2: partly, nit (confirmed-by-run)

**Why.** What holds:
- Every Seedelf spend through giveme.my names its one-time key and giveme.my's COLLATERAL_HASH as required signers (build.rs:2190-2194; architecture.md:133). A session return names its one-time key (build.rs:2203).
- Neither is any account's, so restSigners (tx-view.ts:296) never empties, the early return at :297 never fires, and every known account but the active one gets a withAccount turn deriving 40 payment hashes and its stake key (:299-302).
- The first turn now also derives every session's reward address whenever the transaction names a required signer (:280-282).
- In 1.8.1 a Transfer to a Seedelf returned at the loop's first pass: its outputs are scripts, so `rest` was empty.
- Nothing is marked and nothing leaves the device. A locked wallet still renders: yourSigners is set at :261 before withKeys throws, and txView catches it (:186-188).

What doesn't hold as stated is that the extra turns "hold the wallet's queue, which the runner and the connector wait on". They share the queue: Wallet.serial (wallet.ts:505-547, 577-589), the connector's withDappKeys and withViewKeys (dapp.ts:1294-1311), and the runner's withKeys. But markYours queues each turn only after the last one finishes. A request arriving meanwhile runs after the current turn, not after the loop (probe-interleave). A turn takes about 15-40 ms. The one longer uninterrupted hold is the first turn's session derivation: about 63-68 ms becomes 177-228 ms at 300 sessions.

The cost isn't new in kind. 1.8.1's loop already opened every known account for any view with a stranger's key output (a public Send, Make public to an address), at the same cost. #373 extends it to every private spend's and every Lovejoin chain's view.

Grade: performance only, bounded, with no wrong output and no data leaving. It's tens of ms for 1-3 accounts and 1-2.4 s only near the 100-account cap (MAX_KEPT). No severity row covers time, so nit.

**Evidence.** Probe zz-v-ui-lows-cost.test.ts, real wasm, timing each wallet-queue task. Each pair compares a script output with no required signers against the same transaction naming two foreign signers (first open → again):
- 1 account, 5 sessions: unchanged (0 turns).
- 3 accounts, 20 sessions: 13 ms → 74 / 38 ms, 2 turns.
- 10 accounts, 50 sessions: 17-19 ms → 259 / 110 ms, 9 turns, longest turn 38 ms.
- 10 accounts, 300 sessions: 63-64 ms → 394 / 249 ms, longest turn 64 → 177 ms.
- 100 accounts, 50 sessions: 17 ms → 2410 / 814 ms, 99 turns.

The same loop for a stranger's key output with no signers, as 1.8.1 already did (probe-cost-1.8.1-shape): 10/50 228 / 91 ms; 10/300 281 / 141 ms; 100/50 2365 / 788 ms.

Interleaving: probe-interleave ["turn 1","competitor","turn 2","turn 3",…,"turn 9"].

The real private Transfer: probe-transfer {"requiredSigners":["cfae458c","1108b97f"],"collateralIsOne":true,"outputs":["script/private","script/-"],"withAccount":3,"yourSigners":[],"koios":0}. Every run showed koios 0 and fetches 0.

**Documented.** The cost is stated or accepted nowhere. The docs claim the opposite in general terms:
- tx-view.ts:5: "It is the cheapest handler in the worker: no Koios request, no storage write, nothing kept".
- flows.md:275: "It asks nobody anything … Opening it leaks nothing and costs nothing."
- architecture.md:133 states the premise: "The one-time key and giveme.my's key are the required signers."

**The fix.** Caching each account's key set for the unlock is the right option. The wallet already keeps other accounts' CardanoAccount until lock (wallet.ts:221-227, `others`), so an in-memory map of index → {payment hashes, stake, drep} beside it, freed on lock, removes the 40-hash derivation per open. Cached per network, it can hold the sessions' reward addresses too. The first PBKDF2 per account after unlock stays, as now. Nothing is written or sent, so no privacy-policy entry, and nothing is refused.

Matching only the active account, the dApp account and the sessions also works and is never false. But it drops other accounts' marks, and tx-view.test.ts expects Account 2's key marked.

Skipping COLLATERAL_HASH (constants.rs:80-81) before the loop helps only in part: the one-time key still sends it through every account.

### dapp-ui#1: confirmed, nit (confirmed-by-run)

**Why.** answer() (dapp.ts:646-701) checks, in turn: the request is waiting, the connector is on, it isn't a funding, the network, the dApp account, and the password (`guarded`, :673-681). Then it signs (:701). It never reads the summary or any acknowledgement, and dapp-answer's payload (rpc.ts:2866-2868) has no such field. The only gate is the window's `(approve && mustAck && !ack)` (DappApprovals.tsx:124, 154).

Who can send dapp-answer: its handler (handlers.ts:439) is reached only through serveUi (ui-port.ts:26-31). That needs the UI port's name, sender.id === chrome.runtime.id and sender.url starting with the extension's origin (sw.ts:47 chrome.runtime.getURL("")).
- A content script's port carries the page's URL, so it's disconnected.
- The dApp port (sw.ts:391-430) takes only CIP-30 methods (isDappMethod) into answerSite.
- manifest.ts has no externally_connectable and no web_accessible_resources, and the worker has no onConnectExternal, onMessageExternal or runtime.onMessage listener.
- The extension's CSP is script-src 'self' 'wasm-unsafe-eval' (manifest.ts:101).

So only the wallet's own pages can send it. They are the same trusted bundle and can already send every other request, and only DappApprovals does (:159; :199 with approve:false). Nothing is reachable: defence in depth only, so nit.

**Evidence.** Probe zz-v-ui-lows-answer.test.ts: a connected site's signTx spends a script UTxO with key 0/0 as a required signer and pays a stranger; DappService.answer(id, true, PASSWORD) is called with no switch:
- probe-answer-summary {"keyReleases":true,"releasedLovelace":"4830000","releasesContractFunds":true,"password":true}
- probe-answer {"answered":{},"witnessSet":"a100818258207ea0"}: the site's signTx resolved to a witness set.

Code: dapp.ts:646-701, rpc.ts:2866-2868, ui-port.ts:26-31, sw.ts:47 and 388-430, DappApprovals.tsx:124-154, 159, 199.

**Documented.** The docs describe the window's own gate and never claim the worker enforces it:
- architecture.md:563: "With `keyReleases` and anything released, the window adds a row under the total, a warning before who it pays, and a switch Sign waits for, held per request."
- PR #373: "a switch that Sign waits for, separately for each request".

**The fix.** Optional and safe. Send `ack: true` with an approval when the window's switch is on, and have answer() refuse a sign-tx whose summary releasesContractFunds holds without it, beside the password check. It mirrors the window's own rule: it refuses nothing the user can't approve by turning the switch on, so it's no new guard on the user, and it makes no request. releasesContractFunds lives in src/ui/dapp.ts and no worker module imports from ui/ today, so it would move to shared/. Not needed for 1.9.0.

