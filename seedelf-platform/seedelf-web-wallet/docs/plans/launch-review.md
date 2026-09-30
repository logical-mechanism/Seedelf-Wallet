# Launch review (2026-09-26)

A review of the whole web wallet before mainnet, after the [crypto review](crypto-review.md). Lovejoin went live on mainnet on 2026-09-26 and Minswap is ready, so it also checks what mainnet needs. It was run on `web-wallet/crypto-review` at 3e79ebb. Nothing is fixed here: the fixes go on a launch-prep branch.

**How it was done:**

- Ten reviewers, one lens each: the worker and vault, the dApp connector, private sessions and swaps, Lovejoin, transaction building, cryptography, chain data, the money-moving UI, the mainnet build and the store, and the service worker's lifecycle.
- A critic then looked for what they missed, and five more reviewers covered it: name spoofing, untrusted input to the WebAssembly, features racing for the same UTxOs, a mainnet dry run, and the release gate.
- Every medium or higher finding was checked by an agent told to refute it. Every high one was checked again, independently, for real-world impact. Most highs were reproduced against the built WebAssembly, or in the worker with the test fakes.
- A separate mainnet check:
  - Lovejoin's deployed contracts against the wallet's own builds.
  - Lovejoin's mainnet configuration.
  - Seedelf's, giveme.my's and Minswap's mainnet constants, against the chain (13 read-only Koios calls).
  - A real `VITE_ENABLE_MAINNET=true` build.
- Baseline on this branch: `cargo fmt`, clippy, every Rust test, `tsc`, Vitest (302 tests) and `npm audit` all pass.

**Verdict:** the protocol side is ready for mainnet, and the wallet isn't yet.

- **Ready:**
  - Lovejoin's mainnet scripts accept the wallet's transactions unchanged: 16 of 16 flows. They refuse a flipped proof.
  - Seedelf's, the collateral's and giveme.my's mainnet constants match the chain.
  - The cryptography, the message boundary, the vault and the lock hold up.
- **Not yet:**
  - Mainnet Lovejoin isn't wired in, and the release path builds preprod.
  - There are 9 high bugs. Most can be set off by a stranger with one cheap transaction.

## Status (2026-09-27)

**Since:** an independent review found more, and fixed it on the same branch: see [independent-review.md](independent-review.md).

**Every item below is fixed on `web-wallet/crypto-review`**, except what *Still open* lists. That's M1–M6, H1–H9 and #10–#62.

A second adversarial review, of the fixes themselves, found 30 more issues, all now fixed. The worst five:
- a preprod site could get a mainnet output signed, through the cache of recent sends, which wasn't kept per network;
- a Lovejoin Bring back, or a public mix, could overwrite the watch on a payment that may still go through, which lifted the guard against paying twice;
- two ways a session could close with its money still at its account.

**Checked on the branch** (2026-09-27):
- Rust: `cargo test --workspace --locked`, 424 passed (the 8 live Koios tests are `#[ignore]`d); clippy and fmt clean.
- WebAssembly: the Node tests, 37 passed.
- Vitest: 552 passed on the preprod build and on the mainnet build.
- Playwright: 58 passed on the dev build, and 59 on the packaged mainnet store build.

**The owner's calls** (2026-09-26):
- Lovejoin is on for mainnet, and returns go through it by default, with a pool floor of 30 real boxes that aren't the wallet's, and a no-audit note wherever Lovejoin is chosen.
- A token→ADA swap's proceeds go through Lovejoin too, with the cost shown in the approval.
- The swap runner checks where Minswap's order pays. Mainnet swaps route only through DEXes whose orders name the owner's key (`MAINNET_PROTOCOLS`); VyFinance is excluded.
- One build holds both networks: mainnet by default, and preprod behind a Settings switch, with a badge on every screen.
- The contracts aren't rebuilt: the wallet uses the live preprod and mainnet deployments. seedelf-contracts' `hashes/` is a later, undeployed build (see its README).

**Beyond the table's fixes:**
- **A build bug** found by the end-to-end suite: the bundler put shared runtime helpers in `sw.js`, so every wallet page ran a second copy of the worker. A build now fails if a page imports `sw.js`.
- **H1's legacy deregistration** is refused only when the site's transaction comes without its deposit. The worker passes the stake key's recorded deposit from Koios `account_info`.
- **The supply chain:**
  - `Cargo.lock` is tracked, and Rust is pinned to 1.98.1.
  - The WebAssembly carries no local paths.
  - The advisories for `bytes`, `slab`, `anyhow` and `keccak` are cleared.

**Still open:**
1. **By hand, on a mainnet build, with small amounts.** The owner ran this on 2026-09-28 and reports the basic functionality working; what the chain shows is marked done, and the rest still stands.
   - **Minswap:**
     - ~~that `agg-api.minswap.org` answers the extension's origin with CORS~~ **done:** a live swap quoted, ordered, filled and paid out from the extension;
     - ~~that `aggregator_fee` is a lovelace string~~ **done:** the same swap was funded on it and settled;
     - that `exclude_protocols` accepts VyFinance and MuesliSwap;
     - one swap through each protocol in `MAINNET_PROTOCOLS`: **one route so far**, so `checkOrder` is known to pass that one's orders and no other's;
     - Stop: not exercised, the order filled first.
   - **Lovejoin:** ~~seed the pool from identities unrelated to any Seedelf key, then run one box at depth 1~~ **done, deeper:** the pool was seeded from a second wallet (39 boxes of 10 ₳, over the floor of 30) and a swap's return ran three boxes two waves deep — a deposit, twelve mixes and the return, all confirmed. **The mainnet `mix_box` hash is confirmed against real transactions for the first time**, and a mix measured 0.8225 ₳, matching `networks.ts`'s `mixCost`.
   - **Seedelf:** a Seedelf funded from the private balance, and a return merged back into it, are done; the owner reports the other flows working, which the chain hasn't been read for here.
2. **A validity interval on private spends:** they still have no expiry, until a live check shows giveme.my accepts one.
3. **The store** (`web-wallet/release-prep`):
   - ~~a new listing, or an update of the unlisted preprod item~~ **decided (the owner, 2026-09-28): a new listing**, with the old unlisted item unpublished once it's live (see [store/README.md](../store/README.md));
   - ~~screenshots from mainnet-shaped fixtures~~ **done:** the five show mainnet, with no test-network strip;
   - ~~the *Location* and *Web history* data-usage answers~~ **done:** both checked at submission, reasoning in [store/README.md](../store/README.md);
   - ~~no version bump, then the zip's SHA-256 in the roadmap~~ **done:** submitted as 1.0.0 on 2026-09-28, SHA-256 `85c0fb09…714b`, recorded in the roadmap's handoff notes. **Awaiting Google's review.**
4. **Upstream:** Lovejoin's config and SDK swap Seedelf's preprod and mainnet reference UTxOs. Its `config/network.mainnet.json` also still has `mix_script_hash: null`, though the hash the wallet uses is now confirmed on chain.
5. **Smaller items, left for later:**
   - A certificate carries no network, so a site can still ask for a stake-key-only signature over the other network's transaction.
   - #21: the order's minimum and receiver fields aren't decoded, so Minswap is trusted for them.
   - #14 and #15's refusals reach only the site, not the user.
   - A chain's last window isn't watched until it lands.
   - Chain records live only on this device.
   - The Lovejoin page's buttons aren't disabled while a payment may still go through. The worker refuses them, and the page shows why.
   - One maybe-sent watch per network.
   - A resend's "not on chain" count isn't kept across pump calls.
   - The CLI-only advisories for `h2` and `spin`.
   - The restore scan (known).
   - A swap's return records no reason when its spare ADA pays for no box: `chain` returns nothing, and the reason is only kept for a mix (`record?.mix`), so the session screen says nothing and the return looks as though Lovejoin was skipped. Found on the owner's mainnet run, 2026-09-28; the approval does say it, so nothing is hidden before the fact.
   - A swap's review says "less than a box's worth ... comes back at once" without the amount, so the user can't see what will not be mixed until it lands.
   - `MIX_FEE_ESTIMATE` is 0.95 ₳ and a mainnet mix measured 0.8225 ₳, so a chain over-reserves about 0.13 ₳ a mix. It only ever leaves a box unbought when the spare lands in that band.
6. **A privacy-by-default analysis,** at the owner's ask: done. See [privacy-review.md](privacy-review.md) and its *Status*, which lists what's fixed, what the owner declined, and what's still open.

## Mainnet

**Lovejoin's contracts.** Mainnet runs the same logic the wallet was built against (Lovejoin fa5b605), recompiled with Aiken 1.1.24 and stdlib v4.0.0, so the hashes are new.

- Every contract change from fa5b605 to cb5a5a3 is formatting, or stdlib v4's `Value` → `Assets` rename, checked mechanically. No known-answer vector changed.
- The cb5a5a3 sources, built and parameterized, reproduce mainnet's mix_box and mix_logic byte for byte.
- The wallet's deposit, mix (2, 3 and 4 boxes), withdraw, depth-2 and depth-3 chains, mix-again, session return and public-account chain all evaluate against the mainnet scripts.
- Mainnet's 1 ₳ max fee per mix and its missing fee shards don't touch the wallet. Only fee_contract's `PayMixFee` enforces the cap, and the wallet pays every mix from a key account.
- Measured mainnet costs, with mainnet's parameters (epoch 658, the same as the preprod fixture's): a 3-box mix is 0.822–0.828 ₳ (5.80B steps), and a 1-box withdraw is 0.2897 ₳. `MIX_FEE_ESTIMATE` (0.95 ₳) stays safe.

| # | What | Fix |
|---|---|---|
| M1 | **Lovejoin is off end to end in a mainnet build.** There are five gates:<br>• `Protocol::of` bails on mainnet (`seedelf-core/src/lovejoin.rs:82`);<br>• `LOVEJOIN_MIX_BOX` lists preprod only (`background/lovejoin.ts:179`);<br>• three UI gates test `network === "preprod"` (`Dapps.tsx:162`, `Settings.tsx:104`, `Swaps.tsx:490`).<br>Opening some but not all breaks every mainnet session return, or sends returns through Lovejoin with its settings and notice hidden. | Open them in one change, driven by one source (a `lovejoin` entry in `networks.ts`).<br>**Mainnet values** (`_reference/Lovejoin/artifacts/mainnet/addresses.json`):<br>• mix_box `c145c10f…1fad`, mix_logic `0dad3046…499e`, denom 10 ₳;<br>• references `f89cb43a…175c#0` (the protocol datum and NFT), `7d21335f…416a#0` (mix_box, 629 B) and `2452c3e6…c7b6#0` (mix_logic, **3,161 B**).<br>**Script size:** derive `script_bytes` from the bundled outputs. Preprod's 3,156 underprices every mainnet mix and withdraw by 75 lovelace, and the node refuses them.<br>**Rebuild the outputs** from Koios `utxo_info`, and check (160 + size) × 4,310 against the locked lovelace.<br>**Tests:** flip `lovejoin_is_not_on_mainnet` (core `tests/lovejoin_test.rs:384`) and the wasm `funding("mainnet")` assertion, and add mainnet evaluation tests. |
| M2 | **`npm run package` builds a preprod zip** (`extension/package.json:15`). Nothing sets `VITE_ENABLE_MAINNET`, and `scripts/package.mjs` doesn't check the network. | `build:store` sets the flag, and a `build:store:preprod` stays for tests. `package.mjs` takes the network, refuses a manifest whose hosts don't match it, and puts the network in the zip's name. |
| M3 | **A mainnet build still asks for preprod's hosts** (`networks.ts:41`, `enabledNetworks(true)` is `["mainnet","preprod"]`). Nothing in it can use them: the network is fixed per build, and the switch architecture.md promises doesn't exist. | Mainnet builds are mainnet only (recommended), or build the switch. Update `manifest.test.ts` and architecture.md's *Networks*. |
| M4 | **The store listing is preprod only** (`docs/store/README.md:3-7`, `:39`, `:109`): "a test build… test ADA only". The test instructions and the host justifications cover only preprod. | A mainnet listing: real-money wording, justifications for `api.koios.rest` and `api.coingecko.com`, new test instructions, and Lovejoin in the services list. |
| M5 | **Mainnet's Lovejoin pool is empty**, and the wallet can't seed it: every mix needs two boxes that aren't the wallet's. Depth 2 needs 8 per box, and depth 3 needs 26. Until then the tile refuses, and returns come back directly with a warning. That part is safe. | An owner's decision (see *Decisions*): seed it, set a pool floor, and choose the default. |
| M6 | **The end-to-end suite only runs against preprod** (`e2e/support.ts:233`). The release checklist runs it on the store build, and on a mainnet build 5 of 6 tests fail. `tests/tokens.test.ts:52` also assumes preprod. | Run the full suite on the preprod dev build. Give the mainnet store build a small smoke project. Make the token test build-aware, and run Vitest once with the flag in CI. |

**Checked against the chain and correct:**

- `get_config(1, false)` (mainnet) and its two reference UTxOs (`51f12c1a…#1`, `f3955f42…#1`). Their bundled outputs match the chain byte for byte.
- The mainnet collateral UTxO `1c2fbce4…#0` holds 5 ₳, and blake2b-224 of `COLLATERAL_PUBLIC_KEY` matches.
- giveme.my's mainnet URL.
- The 25 mainnet tokens and 451 DReps, bundled only in a mainnet build.
- Mainnet's reward-account header (0xf1) and slot config.
- A mainnet Seedelf transfer measures the same fee as on preprod (273,922).

## High

These are all confirmed by two independent checks. Each has one fix, and several merge findings that share a cause.

**H1. A site's signing prompt leaves out the account's rewards and deposit refunds** (`wasm/src/cip30.rs:1054`).

- `inspect()` nets the account's own outputs against its own inputs only. An own withdrawal only adds the stake key as a signer, and an `UnReg` refund only becomes a certificate line.
- So a site's transaction that withdraws 1,000 ₳ of rewards and pays them to the site reads "Your public account sends 0.2 ₳". This was reproduced.
- An honest dApp that returns the rewards reads "gets 999.8 ₳", so the theft looks cheaper. The private-session prompt shares `inspect`.
- **Fix:**
  - Count own withdrawals and own `UnReg` refunds as money the account puts in, with checked adds.
  - Refuse an own legacy `StakeDeregistration`, whose refund isn't in the certificate.
  - Say where a refund goes rather than "back".
  - Add a `cip30_test` for rewards paid to someone else.

**H2. Lovejoin withdraws boxes that were never mixed** (`sessions.ts:1395`, `lovejoin.ts:570`, `lovejoin.ts:651-695`).

- Due times are set for every box when the deposit is sent. The rest of the chain lives only in `chrome.storage.session`, which a lock, a browser restart or an extension update wipes. A send moves only the first window (4 transactions), and the alarm sends the rest while unlocked.
- `withdrawDue` takes `owned[0]`, the owned box with the lowest tx hash. It has no idea whether that box was mixed, or whether a chain still being sent is about to mix it.
- A 10-box public mix cut by auto-lock leaves 7 boxes that are still the deposit's own outputs. Each comes back as public account → deposit → withdraw → private UTxO, a certain link.
- A cut public mix leaves no record at all, so the page never says it stopped. A box can also come back minutes after the mix that made it, when an older box's time comes due.
- **Fix:**
  - Record every chain in the sealed private store: its deposit, its mixes and its leaves. This covers public mixes too.
  - Never withdraw a box from an unfinished chain on a timer. Mark it *not mixed yet* and offer Mix my boxes again.
  - Hold every withdraw while any chain is in flight.
  - Withdraw the box that has waited longest (by `block_time`), not the first.
  - At unlock, show a cut mix as stopped.
- Merges lovejoin-1, lovejoin-2, lifecycle-1, lifecycle-5 and worker-vault-1.

**H3. Every key "owns" the register (identity, identity)** (`seedelf-crypto/src/register.rs:175`).

- `is_owned` multiplies the generator by the key, and the identity stays the identity.
- A stranger's contract UTxO under that datum shows up in every Seedelf Wallet's and every CLI's private balance and Activity, and joins their spends. Anyone can take it back: the validator accepts g_r = identity. This was reproduced.
- **Fix:** return `Ok(false)` when either point is the identity, and add a test.
  - It must be `Ok(false)` and not an error: the CLI's scan (`seedelf-core/src/utxos.rs:42`, `:124`) aborts on an error, so one such UTxO would break every CLI balance.
  - This is the only change, and it covers the CLI.

**H4. One UTxO with deep JSON makes the WebAssembly refuse a whole request** (`seedelf-koios/src/koios.rs:134`, `:150`).

- `InlineDatum.value` and `reference_script` are `serde_json::Value`, and serde_json stops at 128 levels for the whole request. That takes a datum about 65 levels deep, or a native reference script about 62 levels deep: about 200 bytes on a 1–2 ₳ output.
- **At Lovejoin's mix_box:** no Seedelf Wallet can find or withdraw its boxes, or mix. `sw.ts:89` swallows the error.
- **At a session's address:** its return fails for good. Its keys sit under account 24301', which no other wallet reads.
- **At the public account:** move-in, send, staking and mints fail.
- Reproduced for both fields.
- **Fix, in seedelf-koios** (so the CLI gets it too):
  - Take `value` as `RawValue` and parse it leniently.
  - Make `reference_script` a struct holding only its hash and size.
  - Read registers from the datum's CBOR `bytes`.
  - Better still, parse rows one at a time and drop the ones that fail.

**H5. The contract index can outgrow session storage** (`contract-scan.ts:153`, the write at `:96`).

- Every Seedelf's whole `_extended` Koios row goes into `chrome.storage.session`: the asset list, the datum twice, the reference script. The quota is 10 MB for the whole extension.
- About 47 Seedelfs holding 1,200 junk tokens each cross it: about 1,060 ₳ parked, all recoverable. Ordinary growth crosses it at a few thousand Seedelfs.
- Past the quota the read throws:
  - no balances;
  - no transfer, withdraw, remove or stealth mint;
  - no public Send to a Seedelf.
- Just under it, `rememberSpent` fails after a good submit, so a sent payment shows as failed. This was reproduced in the built extension.
- **Fix:**
  - Keep `{txHash, txIndex, generator, publicValue}` for other people's Seedelfs, or keep the index in worker memory and persist only what's owned.
  - Catch a failed write and carry on with the in-memory view.

**H6. Token totals past u64 freeze a session's return** (`seedelf-core/src/utxos.rs:342`).

- The trigger is three outputs, each holding 2^63−1 of one token, sent to a session's address. It costs about 5 ₳.
- `assets_of` then overflows. `buildSessionReturn` and the Lovejoin chain fail forever.
- The same breaks Max send and Max move-in on the public account, and Max withdraw of a Seedelf that was sent junk. Reproduced.
- **Fix:** build from the rows that fit (a `utxos::fitting` helper) and leave the rest behind, with a notice. u128 alone doesn't help, because no output may hold more than u64 of one token.

**H7. Disconnect closes a private session while money is on its way** (`sessions.ts:629`).

- `disconnect` judges "empty" from one Koios read, minus the spent set. It never looks at the session's own transactions.
- So it closes the session in any of these cases:
  - a funding still in the mempool;
  - a top-up just sent;
  - a return, or the tail of its Lovejoin chain, that doesn't land.
- Nothing reads a closed session again. The UI enables Disconnect in exactly these states: during Funding it's the only button. This was reproduced.
- **Fix:**
  - Refuse while a chain is pending, or while a recorded transaction is neither confirmed nor failed. Check with `tx_status`, as `act` does.
  - Disable Disconnect in the UI while funding or returning.

**H8. Junk at Lovejoin's address turns a skip into a stuck return** (`lovejoin.ts:414`, and `:343`, `:355`).

- The worker counts every UTxO at mix_box as a box. The WebAssembly counts only valid ones (`PoolBox::from_row`). Lovejoin allows junk there, and anyone can add it.
- When the counts differ, the build fails with a plain error, not `LovejoinSkipped`:
  - session returns fail;
  - a swap that runs itself retries forever, with no way out;
  - a stuck mix-again blocks every withdraw.
- **Fix:**
  - Have the WebAssembly return the number of valid others, and count only those.
  - Treat any Lovejoin build failure as a skip that falls back to a direct return, mix sessions included.
- Merges lj-config-1 and lovejoin-4.

**H9. Chains collide over the same pool boxes** (`lovejoin.ts:324`, `sessions.ts:852`).

- A chain picks all its pool boxes when it's built, from a read that leaves out only inputs already sent. So picks collide in three ways:
  - Bring everything back builds several chains from one read.
  - A chain built while another is being sent draws that chain's unsent picks.
  - On mainnet, other users spend boxes during a chain that takes dozens of blocks.
- The chain then stops partway, after about 3 minutes of retries that hold the sessions queue, and H2 withdraws its under-mixed boxes. Reproduced.
- **Fix:**
  - Reserve every built or in-flight chain's picks, and leave them out of new chains. Or allow one Lovejoin chain per wallet at a time.
  - With H2's hold, a stopped chain's boxes wait for Mix again.
- Merges lj-config-3, lovejoin-3 and lifecycle-4.

## Medium

| # | What | Where | Fix |
|---|---|---|---|
| 10 | **A submit Koios didn't answer is treated as not sent, and the retry the wallet asks for pays twice.**<br>• A `KoiosBusyError` (a timeout, 429 or 5xx) "may or may not have gone through" (koios.ts's own words).<br>• The user presses Send again and gets "already spent… review it again". The review picks other UTxOs and pays a second time.<br>• A Lovejoin withdraw that times out keeps its due time, so a second box goes a minute later, undoing crypto-review #4. | `script-spend.ts:175`, `move-in.ts:85`, `lovejoin.ts:691` | A *maybe sent* state:<br>• remember the inputs as spent;<br>• keep a pending entry;<br>• resolve with `tx_status` before another build;<br>• on "already spent", check `tx_status` and finish as a success if it landed. |
| 11 | **Sessions treat a maybe-sent funding as failed.**<br>• An ambiguous submit marks it `unsent`, so the stage is "failed" at once, and Forget or Disconnect drop a session whose funding then lands.<br>• `auto.failed` is never cleared: a swap whose funding lands late shows "Running" forever, and no button moves the money.<br>• A timed-out step rebuilt after 2 minutes can leave the session unable to close. | `sessions.ts:1536`, `:1004`, `:990` | Tell unsent from maybe-sent. Check the account before declaring a funding failed, and clear `failed` when the funding shows up. Keep replaced copies in the `tx_status` check. |
| 12 | **UTxOs carrying a reference script are counted and chosen, but can't be spent.**<br>• **Private side:** the evaluator refuses them (`eval.rs:56`). One sent to a session's address blocks every return, and anyone can send one. One paid into a Seedelf breaks Max withdraw.<br>• **Public side:** the fee leaves out Conway's reference-script fee for spent inputs, so the node refuses with FeeTooSmallUTxO.<br>• The per-byte fee is hard-coded at 15 (`lovejoin.rs:59`, `build.rs:860`). | `eval.rs:56`, `build.rs:748`, `build.rs:1745`, `wasm/src/lib.rs:580` | Treat them as unspendable on both sides, and show them on UTxOs. A session return with one takes the plain sweep. Price the reference-script fee from `min_fee_ref_script_cost_per_byte`, tiered, wherever inputs carry scripts. |
| 13 | **dApp: an input the wallet can't resolve is still signed by the account's key**, with partialSign, and the prompt calls it someone else's. A site can take a pending output (a Send's change, a top-up) once it lands. Reproduced. | `cip30.rs:753` | Refuse a payment-key signature while any input or collateral input is unresolved. |
| 14 | **dApp: a site's transaction can spend locked UTxOs and the collateral**, and the prompt doesn't say so. `resolve()` uses the unfiltered view. | `dapp.ts:643` | Compare the inputs and collateral with coin control, then refuse or name them. |
| 15 | **dApp: a private session's stake key can be registered and delegated.** Bring it back and Disconnect then strand the 2 ₳ deposit and every reward. privacy.md says this key is never registered. | `dapp.ts` `signTx`, `sessions.ts:629` | For a session, refuse own register, delegate and vote certificates. |
| 16 | **dApp: a pool registration in the same transaction makes the stake key a pool owner.** The pool takes the user's rewards, and the prompt shows only "A stake pool's certificate." | `cip30.rs:958` | Read `pool_owners`, and refuse when the account's stake key is one of them. |
| 17 | **dApp: a ~3 KB `signTx` overflows the WebAssembly's stack.** The instance is then dead: Lock errors out without clearing session storage, and auto-lock fails while the site keeps pinging. | `cip30.rs:688`, `wallet.ts:368-380`, `wasm.ts` | Bound CBOR nesting before any decode. Clear session storage first in `wipe()`, free each key in its own `try`, and replace a trapped instance. |
| 18 | **A token named like a listed one reads exactly like it.** SNEK, USDM, or even "₳" (which prints "1,000 ₳") look the same in `signTx`, every review and Activity. No token is marked unlisted, and no fingerprint is shown. | `DappApprovals.tsx:428` | One token-text helper for every text view: mark unlisted tokens and show the fingerprint. Swaps must decide ADA by id, not by label (`Swaps.tsx:100`). |
| 19 | **A long token name shrinks a Pays address to its 6-character checksum**, and pushes the output's ADA off-screen. A ground address with the same checksum then reads as the real one. | `DappApprovals.tsx:471`, `styles.css:548` | Give the address its own wrapped, full-width line, and cap the amount column. |
| 20 | **The swap's You receive offers unverified held tokens under their own names**, above Minswap's verified list. Anyone can put tokens in a private balance. (Plausible.) | `Swaps.tsx:1024` | Check `tokenOut` in the worker, and list unverified tokens apart. |
| 21 | **The swap runner signs Minswap's transaction on a value cap alone.** The order's destination, receiver and minimum output are never read, though the comments and architecture.md say the minimum is checked. | `sessions.ts:1705`, `:22-24` | An owner's decision: a structural check of the order, or reworded copy with the risk accepted. |
| 22 | **freshIndex's 20-address probe lets Koios link every session the wallet opens.** Successive windows overlap, and each session's stake key goes on chain in its funding. | `sessions.ts:1628` | Probe `next` alone, and widen only when it's used. |
| 23 | **A stale pool read makes the network check skip Lovejoin.** A swap that runs itself then comes back directly without a word. | `lovejoin.ts:454` | Treat an unknown input as stale: re-read and retry. Tell the user when a return skips Lovejoin. |
| 24 | **One failed `tx_status` read ends a chain.** A public mix stops for good, and a session drops its pending chain. | `lovejoin.ts:583` | Treat a `KoiosError` in `onChain` as nothing seen yet. |
| 25 | **A swap that runs itself takes any stranger's UTxO as its fill when Minswap lags.** It returns early and closes, and the real fill lands in a closed session. (Low confidence: it needs the lag.) | `sessions.ts:1048` | Decide a fill from the order's outpoints. |
| 26 | **A token→ADA swap's proceeds go through Lovejoin**, at about 27% in mix fees at depth 2, yet the approval says "the proceeds… at once". | `Swaps.tsx:952` | Owner's call (chunk 16 chose this). At least fix the copy and show the cost. |
| 27 | **Contracts CI pins Aiken v1.1.23**, but 3e79ebb moved `aiken.toml` to 1.1.24 and stdlib v4. `aiken check -D` fails on every PR, the launch-prep PR included. | `.github/workflows/continuous-integration.yml:15` | Set `v1.1.24`. It changes no hash. |

## Low

| # | What | Where | Fix |
|---|---|---|---|
| 28 | No transaction has a validity interval: a stuck one stays valid forever while the wallet lets the user pay again. | `build.rs:105`, `:1674` | Set `invalid_from_slot` (tip + about 2 h) before settling and patching. |
| 29 | Fees and minimums trust Koios's protocol parameters with no bound. | `koios.rs:840` | Refuse parameters outside generous bounds, and cap an account fee. |
| 30 | Public Activity judges "ours" by base address: strangers' transactions show as Sent. | `activity.ts:358` | Match by payment credential. |
| 31 | Offset paging over a changing UTxO set can skip or duplicate a row. | `koios.ts:473` | Keyset paging, and dedupe by outpoint. |
| 32 | Fix #12 is incomplete: the phrase and entropy stay in WebAssembly memory after lock (bip39 and pallas `String`s). | `cardano.rs:61`, `derivation.rs:55` | Zeroizing buffers where possible, and docs that say "best effort". |
| 33 | UI requests (passwords, the phrase) reach every open wallet page, because `runtime.sendMessage` fires every page's listener. | `ui/background.ts:10` | Send requests over a port only the worker listens on. |
| 34 | SetPassword's Show makes a spell-checked text field. | `SetPassword.tsx:52` | `spellCheck={false}`, `autoCapitalize="off"`. |
| 35 | The auto-lock alarm outlives a browser restart and loads the WebAssembly every minute while locked. | `wallet.ts:334` | Stop it when there's no entropy. |
| 36 | A clock that moved backwards keeps an idle wallet unlocked longer. | `wallet.ts:321` | Treat `last > now` as expired. |
| 37 | Two overlapping `runSessions` can send two withdraws seconds apart. (Plausible.) | `sw.ts:81` | One in-flight run, or a queue for withdraws. |
| 38 | The approval window swaps in a new request in place, with Sign live at once. | `DappApprovals.tsx:54` | Hold the buttons for about 1 s, and say it changed. |
| 39 | The window's 800 ms self-close can decline a request that just arrived, unseen. | `DappApprovals.tsx:50` | The worker decides the close. |
| 40 | A site can make the worker read Koios and allocate without limit, with no approval. | `dapp.ts:496` | Share in-flight reads, rate-limit per origin, and cap the hex size. |
| 41 | A `signTx` of outputs with register datums can freeze the worker for tens of seconds. | `cip30.rs:860` | Refuse over 64 KiB before parsing. |
| 42 | An output counts as the account's by payment key alone, so a franken address shows as change. | `cip30.rs:838` | Also match the stake part. |
| 43 | Fix #10 has a race: a public connect between the check and the write detaches a funded session. (Plausible.) | `dapp.ts:409` | Serialize `dapps` writes. |
| 44 | The runner's checks ignore a treasury donation and never bound a cancel's fee. | `sessions.ts:1087` | Refuse donations, and cap a cancel's fee. |
| 45 | An unreadable sealed session record reads as empty and is overwritten. (Plausible.) | `private-store.ts:54` | Throw on a failed decrypt, and never write over it. |
| 46 | The runner's automatic return deletes a return the user is reviewing for another session. | `sessions.ts:1094` | Clear a kept slot only if it holds this transaction. |
| 47 | An in-flight chain's next input (the 0/0 change, the collateral) is offered to other spends and to sites. | `account.ts:95` | Reserve a live chain's inputs. |
| 48 | A worker restart during a busy back-off loses `tries`, so a resent deposit stops the chain. | `sessions.ts:1376` | Persist a maybe-sent mark. |
| 49 | A chain transaction Koios took but that never lands stalls the chain until the next lock. | `lovejoin.ts:152` | Resubmit the oldest after about 3 minutes. |
| 50 | One chain overflows `spentSet`'s 500 entries and evicts every other feature's recent spends. | `spent.ts:26` | Keep entries by time (about 2 h), not by count. |
| 51 | Toggling a lock drops every other lock missing from the last reading. | `coin-control.ts:180` | Don't prune on toggle. |
| 52 | A full contract read runs `isOwned` on every row inside the keys queue. At mainnet scale, Lock and the UI wait. | `contract-scan.ts:150` | Batches of about 200, yielding between them. |
| 53 | After giveme.my refuses a spent input, "review it again" rebuilds from the same view for up to 30 min. | `script-spend.ts:162` | Forget the contract view on that refusal. |
| 54 | A decimal comma is read as a thousands separator: "0,5" becomes 5 ₳, and "12,5" becomes 125 ₳. | `format.ts:129` | Accept a comma only as a well-formed separator. |
| 55 | Send forms use Koios's token decimals, while the list uses the registry's. | `TokenAmounts.tsx:25` | One `tokenDecimals` helper. |
| 56 | Hide balances leaves Lovejoin's and the dApps page's holdings visible. | `Lovejoin.tsx:259` | `useAmounts()` there too. |
| 57 | A session's return moves an ADA Handle into the private balance with no warning. | `ClaimAll.tsx:172` | `HandleWarning` on return reviews. |
| 58 | On mainnet the To field's placeholder asks for a testnet address. | `Destination.tsx:160` | Take the prefix from the network. |
| 59 | Two mainnet DReps named "8Ball" share the 10 ID characters shown. Pool tickers are squattable. (The DRep one is plausible.) | `Staking.tsx:323-326` | Flag shared names and tickers, and show more of the ID. |
| 60 | On a Chrome that refuses `storage.local.setAccessLevel`, the connector still injects everywhere. (Plausible.) | `sw.ts:46` | Record the result, and refuse the connector if it failed. |
| 61 | **Supply chain:** `Cargo.lock` is gitignored and never enforced, so the shipped WebAssembly's crates are recorded nowhere, CI tests a different graph, and `build.sh` fails on a clean checkout. The shipped module also carries 146 absolute paths under `/home/logic/`. | `seedelf-platform/.gitignore:30`, `wasm/build.sh:23-32` | Commit the lock that built 1.0.0 (`!Cargo.lock`), then clear its advisories (`bytes`, `slab`). Build with `--locked`, pin the toolchain, and pass `--remap-path-prefix`. |
| 62 | **Docs traps:** `seedelf-contracts/hashes/` and `contracts/` hold a later, undeployed revision, and AUDIT.md scopes that revision, yet both CLAUDE.md files say to copy hashes into the Rust constants. `seedelf-platform/CLAUDE.md:47` also has `get_config`'s flag inverted (`true` is preprod). | `seedelf-contracts/CLAUDE.md:17`, root `CLAUDE.md:12` | Freeze v1: it's 5b82530 with Aiken 1.1.9, 94bca9c0 / 84967d91. A changed hash is a new variant, never an edit to v1. Fix the flag's wording, and add a core test that pins mainnet's config. |

## Decisions for the owner

1. **Lovejoin at launch.** The pool is empty, and the wallet can't seed it. My suggestions:
   - Seed dozens of boxes from identities unrelated to any Seedelf key, through Lovejoin's own deposit-only flow.
   - Set a mainnet pool floor (60–100 other boxes).
   - Ship mainnet with returns-through-Lovejoin **off by default**, behind a new setting.
   - Say plainly that Lovejoin has had no third-party audit: its CLAUDE.md asks that no copy contradict that.
   - Say too that boxes seeded only by the operator hide nothing from the operator.
   - Make the first live run small: one box at depth 1.
2. **A token→ADA swap's proceeds through Lovejoin** (#26): keep chunk 16's choice with honest copy, or leave the proceeds out.
3. **The swap runner's order check** (#21): add a structural check, or accept the risk with reworded copy.
4. **Mainnet-only builds** (M3, recommended), or build the network switch.
5. **The store listing:** a new listing, or an update of the unlisted preprod item. An update moves testers' installs, and their test phrases, to mainnet.
6. **freshIndex's probe** (#22): the privacy gain against one extra request when an index is used.

## Launch-prep order

1. **Core and crypto (Rust):**
   - H3, H4 and H6.
   - #12: reference-script UTxOs and their fee.
   - H1, #13 and #16 in `cip30.rs`.
   - #17: the depth bound.
   - #28 (validity interval) and #29 (parameter bounds).
   - M1's core half.
2. **Worker:**
   - #10 and #11: maybe sent.
   - H5 and H7.
   - H2, H8 and H9: chain records, reservations and valid counts.
   - #14, #15, #23, #24 and #25.
3. **Mainnet wiring and release:**
   - M1's single source of truth and tests.
   - M2 and M3.
   - M6, and the Vitest run with the flag in CI.
   - #27 and #61.
   - M4, the listing.
   - #62's docs.
4. **UI:** #18–#20, then the lows.
5. **By hand, on a mainnet build, with small amounts:**
   - **Minswap:** check that `agg-api.minswap.org` answers the extension's origin with CORS; this was only ever checked on preprod's aggregator. Then check:
     - that `aggregator_fee` is a lovelace string;
     - the route protocols against `DIRECT_PROTOCOLS`;
     - one ADA→token and one token→ADA swap;
     - Stop.
   - **Lovejoin:** once the pool holds enough boxes, one box at depth 1.
   - **Seedelf:** every flow.

A head start for M1 from this review is in the session's scratch directory, which isn't kept: `scratchpad/mainnet/lj-parity/mainnet-lovejoin-scratch.patch`. It has the core `Protocol` mainnet branch, the three reference outputs encoded from the chain, and 16 mainnet evaluation tests (core and wasm). Its `script_bytes` is hard-coded, so derive it as M1 says.

## Checked and fine

- **Boundary:**
  - `onMessage` takes only the extension's own pages.
  - The dApp port takes only a tab's top frame, with an https or localhost origin from Chrome.
  - There's no external messaging and no web-accessible resources.
  - The CSP is tight.
- **Vault and lock:**
  - Every privileged handler goes through `Wallet.load()`.
  - The back-off survives restarts.
  - Password change is one atomic write.
  - Reveal needs the password, and the phrase check is constant time.
  - Lock frees the key objects and clears session storage.
- **Crypto:**
  - The Schnorr transcript matches the Aiken verifier byte for byte.
  - The hedged nonce (#3) is fixed-length and unambiguous.
  - The v1 derivation, the CIP-1852 paths and the one-time keys are correct.
  - Every pay path checks `is_payable`.
  - Lovejoin's RFC 6979 and sigma-OR are correct.
  - SecretBox matches Lace.
- **dApp connector:**
  - What's shown is what's signed: one request is both inspected and signed.
  - It refuses the other network.
  - Only the needed keys sign.
  - CIP-8 verifies.
  - The CBOR fix (#8) held up to 300k fuzzed transactions.
- **Sessions:**
  - `freshIndex` fails closed.
  - Record writes are serialized.
  - A merged return is bound to a fresh one-time key.
  - Value and collateral are right.
- **Transactions:**
  - Value conservation.
  - Min-UTxO for every output.
  - Linear and script fees.
  - The collateral ratio.
  - Redeemer order.
  - Address checks.
  - Staking deposits and withdrawals.
- **Chain data:**
  - Amounts are BigInt end to end.
  - Paging.
  - The gap limit.
  - Stale-backend re-reads.
  - A CSV formula guard.
- **UI:**
  - Review equals send.
  - Double submit is guarded.
  - No `dangerouslySetInnerHTML`.
  - Only full Seedelf names are paid.
  - Handles are resolved again at build.
- **Lifecycle:**
  - Listeners are registered synchronously.
  - A failed WebAssembly load isn't cached.
  - Every Koios, giveme.my, Minswap and CoinGecko fetch has a 20 s timeout.
  - Retries are bounded.

## Refuted or superseded

- **DevTools reads the entropy past the phrase gate.** This is crypto-review's *Not fixed #1*.
- **Lovejoin has no mainnet configuration** (four reports). They were refuted only because the reviewers were told Lovejoin wasn't deployed. It now is, and they're M1.

## For Lovejoin (upstream)

- `config/network.{mainnet,preprod}.json` (lines 26–27) and `offchain/src/seedelf/addresses.ts` have Seedelf's reference UTxOs swapped between the networks.
  - `96fbddac…#1` and `f620a4e9…#1` are preprod's.
  - The wallet's own values are right. Never copy these from Lovejoin.
