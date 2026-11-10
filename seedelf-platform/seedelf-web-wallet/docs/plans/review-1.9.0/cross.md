# 1.9.0's release review: the cross lane's report

Round one, a finder. Verbatim from its structured report; full addresses of third parties shortened.

## Coverage

Read: the release diff for #373 (wasm/src/cip30.rs, DappApprovals.tsx, ui/dapp.ts, TxDetail.tsx, tx-view.ts, rpc.ts, i18n en), #375 and #377 (minswap.ts, sessions.ts, orders.rs and orders.json, chunk 47's plan), #376 (Cargo.toml, Cargo.lock, aiken.toml), and the prep commit (versions, development.md, releases.md). Traced across the diffs: the connector's readTx, ties, remember, resolve, view and answer paths (dapp.ts); the session paths in sessions.ts (inspect, review, signAndSend, refuseOddities, checkProceeds, withinNet, withinFunding, cancel, cancelOf, liveOrders, ordersOpen, the restore scan, disconnect, step and retry); Swaps.tsx's SessionTxReviewScreen; wallet.ts withKeys and withAccount; the tx-detail handler; wasm/build.sh, scripts/third-party.mjs and the vite manifest version.

Ran:
- **Rust probe** in my own worktree: the wallet's own cancel of all 11 mainnet order fixtures, re-keyed to one-time session 3, read through the shared cip30::inspect_tx and sign_tx with the session's keys. 4/4 pass. The code is kept at /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/6637f822-1e93-462d-9b5e-5bd103fc4b4b/scratchpad/review-1.9.0/cross/cross_review_test.rs.txt.
- **Vitest probes** in my worktree: SignTx with session true; markYours' cost and its locked-wallet behaviour; a real private Transfer in the transaction view. Their files are in the same cross/ folder.
- **Existing Vitest suites** in the main tree: dapp-lovejoin-rewards, dapp-prompt, tx-view, tx-view-screen, swap-routes, order-cancel-check, direct-swaps and session-site-outs, 164 passed. dapp.test.ts's two Lovejoin reward-account refusals (public account and session) also pass.
- **Cargo:** `cargo tree --locked --offline -p seedelf-wasm` resolves.
- **Minswap:** one live estimate per network with 1.9.0's exact exclude lists. Both answered 200: preprod routes through MinswapV2, mainnet through Minswap.

The worktree is removed and the main tree is clean.

Not done:
- Full Vitest, e2e or the full Rust suites (CI is green on #378).
- I didn't run V4's script on the re-keyed cancel (orders_test does that), or check #373's released math for third-party contract shapes (lending, listings).
- i18n translations; the verification and CLI PRs.
- An actual package build. Part 2's reproducibility is reasoned from the tree, not rebuilt.

## Findings

### cross#1 (low, #373, traced): Review it myself's transaction view still says the wallet asks nobody, though it just looked up the order or pools the session doesn't hold

**Files:** seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Swaps.tsx:2693, seedelf-platform/seedelf-web-wallet/extension/src/ui/components/TxDetail.tsx:349, seedelf-platform/seedelf-web-wallet/extension/src/background/sessions.ts:4359, seedelf-platform/seedelf-web-wallet/extension/tests/tx-view-screen.test.ts:96

**Claim.** #373 made the inputs hint depend on `site`, so only the connector's window says the wallet looked UTxOs up. A session's own cancel review and its Danogo direct-swap review open the same view without `site`, so they still show `tx.privacy.inputsHint`, "the wallet asks nobody". But to build those reviews the wallet asked its data source for every UTxO the session doesn't hold. #373's new test comment states the opposite as a general rule.

**Evidence.** - **The view:** Swaps.tsx:2693 `<TxDetailButton txHash={review.txHash} testId="session-tx-detail" />`, with no `site`. TxDetail.tsx:349 `hint={tr(site ? "tx.privacy.inputsHintSite" : "tx.privacy.inputsHint")}`.
- **The text shown:** en.json:2809 "What each one holds isn't in the transaction, and the wallet asks nobody: looking them up would tell whoever was asked which transaction you are reading."
- **The lookups behind it:** sessions.ts:4359 `const foreign = others.length ? await this.deps.koios(network).utxoInfo(others) : [];` in inspect, for a cancel's orders and a direct swap's pools and collateral. liveOrders calls `koios.utxoInfo(recorded)`; cancelOf calls `koios.datumInfo(...)` and `koios.utxoInfo(refs)`.
- **How it's reached:** session-cancel-build and session-swap-build (Swaps.tsx:2515, 2576-2577) both lead to this screen.
- **The test:** tx-view-screen.test.ts:96 says "the wallet's own builds ask nobody".

**Scenario.** A swap session is stopped with an order open. The user taps Review it myself on the cancel, then Transaction details. The inputs hint says the wallet asks nobody, while inspect has just sent the order's outpoint to Koios or the data layer. The same holds for a Danogo direct swap's review (the pool UTxO and Minswap's collateral UTxO). This was already wrong in 1.8.1; #373 fixed it for sites only.

**Fix.** Pass `site` (or a renamed `lookedUp`) to the session-tx-detail button when `review.kind === "cancel" || review.againstPools`, and correct the test comment.

### cross#2 (low, #373, confirmed-by-run): markYours now opens every other known account, and derives every session's reward address, for any Seedelf spend's transaction view

**Files:** seedelf-platform/seedelf-web-wallet/extension/src/background/tx-view.ts:296, seedelf-platform/seedelf-web-wallet/extension/src/background/tx-view.ts:297, seedelf-platform/seedelf-web-wallet/extension/src/background/tx-view.ts:300, seedelf-platform/seedelf-web-wallet/extension/src/background/tx-view.ts:282

**Claim.** Every Seedelf spend names two required signers that belong to no account: its one-time key and giveme.my's collateral key. So `restSigners` never empties, and the known-accounts loop no longer returns early. It derives each other account's 40 payment keys and its stake key, one `withAccount` turn of the wallet's queue each. The first pass now also derives every session's reward address. In 1.8.1 a private Transfer or a Lovejoin mix opened none: its outputs are scripts. Nothing gets marked; this only costs time. Locked wallet: fine, the view renders with `yourSigners: []`.

**Evidence.** - **The code:** tx-view.ts:296-300: `const restSigners = d.requiredSigners.filter((h) => !yourSigners.includes(h)); if (!rest.length && !restRewards.length && !restSigners.length) return; ... payment: rest.length || restSigners.length ? accountKeys(keys.cardano) : undefined`. Line 282 builds `sessionStakes` from `keys.oneTime.rewardAddress(net, index)` for every index, now whenever a transaction has required signers.
- **Where the signers come from:** seedelf-core build.rs:2193-2194 `.disclosed_signer(self.signer).disclosed_signer(Hash::new(COLLATERAL_HASH))`.
- **Probe** (txView with a counting wallet; one script output and two foreign required signers, against none):
  - 5 accounts, 50 sessions, first open: `signers=0 withAccount=0 ms=35` against `signers=2 withAccount=4 ms=176`.
  - 10 accounts, 3 runs each: 50 sessions `ms=50,39,38` against `ms=339,166,228`; 300 sessions `ms=73,90,72` against `ms=302,280,311`.
  - The real recorded Transfer (`transferPreprod.final.txCbor`, 4 known accounts): `requiredSigners=2 outputs=script/-,script/private withAccount=3 yourSigners=[]`.

**Scenario.** A user with 10 public accounts and a few hundred sessions opens Transaction details on a private Transfer or a Lovejoin mix. The view takes about 4× longer (about 70 ms becomes about 300 ms). Meanwhile 9 extra withAccount turns hold the wallet's queue, which the runner and the connector wait on, and the view finds nothing to mark.

**Fix.** Look for required signers among other accounts only when they're cheap: cache each account's key set for the unlock, or match signers against the active and dApp accounts and the sessions alone, since the label is informational.

### cross#3 (low, #373, confirmed-by-run): No test reads a contract release through a private session's keys (inspectSessionTx, the holder's window)

**Files:** seedelf-platform/seedelf-web-wallet/wasm/tests/cip30_test.rs:2132, seedelf-platform/seedelf-web-wallet/extension/tests/dapp-prompt.test.ts:84, seedelf-platform/seedelf-web-wallet/extension/e2e/extension.spec.ts:5833

**Claim.** #373's new tests cover the public account only:
- Rust uses `account()` with stake index 0.
- dapp-prompt renders SignTx with `session: false`.
- The e2e uses `siteOnAccount1`.

A site on a private session reaches the same switch through inspectSessionTx with `keys [0/i]` and `stakeIndex i`, where an honest cancel reads as released 0 only because the refund address counts as the session's own: base(0/i, 2/i). It works today; my probes show it. Nothing holds it, nor the wallet's own Stop cancels (which never show a warning).

**Evidence.** **Rust probe** (my worktree, `cargo test -j 4 -p seedelf-wasm --test cross_review_test`):
- Each mainnet fixture in order_cancels.json is re-keyed to one-time session 3 with `datum_hex.replace(from_pay, session.payment).replace(from_stake, session.stake)`.
- The cancel is built by `orders::cancel_orders`, then read by `cip30::inspect_tx(&accounts, TxRequest{ network: "mainnet", keys: [KeyPath{role:0,index:3}], stake_index: 3, inputs: [order, funds, collateral], .. })`. `sign_tx` returns the same hash.
- Output, 4 passed: `SundaeSwapV4: signs=["0/3","stake"] key_releases=true names_key=true released_lovelace=0 released_tokens=0 paid=0 net=3045072`, V3 and SundaeSwapStable the same. Minswap, MinswapV2, MinswapStable, SundaeSwap, the three WingRiders and Splash give signs=["0/3"], key_releases=true, released 0.

**Vitest probe:** SignTx with a releasing summary renders `dapp-contract-release` and `dapp-contract-released` identically for session false and true; the honest summary shows no warning.

**Scenario.** A later change to how a session's own address is told apart (its stake index, or `own_address`) would make every honest cancel through a site on a private session open the warning and the switch, and no test would fail.

**Fix.** Add the re-keyed fixture cancel to session_test.rs or cip30_test.rs (released 0, key_releases true), plus a session:true case in dapp-prompt.test.ts.

### cross#4 (nit, #373, traced): wasm/README.md's inspectDappTx row doesn't list #373's summary fields

**Files:** seedelf-platform/seedelf-web-wallet/wasm/README.md:92

**Claim.** The row lists what the summary returns, `paidScripts` included, but not contractInputs, contractLovelace, contractTokens, releasedLovelace, releasedTokens, keyReleases or namesKey. architecture.md:563 describes them.

**Evidence.** wasm/README.md:92 ends "... `paidScripts` (...), a CIP-20 note, which keys sign, unknown inputs, and whether the account's signatures complete it." `grep -n "keyReleases\|releasedLovelace\|contractInputs" wasm/README.md` finds nothing.

**Scenario.** Someone reading the WebAssembly API reference misses the fields the window's switch rests on.

**Fix.** Add one clause naming the seven fields and pointing to architecture.md.

## What holds

- Q1: inspect_tx and sign_tx serve inspectDappTx/signDappTx and inspectSessionTx/signSessionTx (lib.rs:6089-6112, 6484-6497). #373 adds no new refusal and no new signer, so what's signed is unchanged.
- Q1: no session code reads the new fields. sessions.ts uses refuseOddities, checkProceeds, withinNet, withinFunding/paidOut, summary.txHash and fee; the UI's SessionTxReviewScreen and intoPools read paid, fee, returnedLovelace, collateral, note and net. KeptTx drops the summary before it's kept.
- Q1: the wallet's own Stop cancel reads key_releases=true and released 0 for all 11 mainnet fixtures re-keyed to a session (V3, V4 and Stable signed by 0/3 and stake), so nothing new would show even if read. Its transaction view now labels the stake key 'Must be signed by you'.
- Q1: a Danogo direct swap through a session counts its pool rows as contract inputs. key_releases stays false (script data hash present; no required signer in Minswap's shape). Nothing is shown or refused, and the summary passes through unused.
- Q2: the public account and a private session share DappApprovals' mustAck and SignTx's row and callout (probe rendered session:true the same). The Lovejoin reward-account refusal is untouched: dapp.ts and paid_scripts are unchanged, and dapp.test.ts's account and session refusals pass.
- Q3: a site's honest V4 cancel (refund to the session's or the account's own base address) reads released 0, so no warning and no switch. The window shows the note 'It spends 1 contract UTxO holding 3.28 ₳ and tokens.'
- Q3, a site-placed order: a site session's Disconnect reads only payment-key UTxOs, and ordersOpen/liveOrders cover only the session's own swap orders, so an order a site placed isn't looked for. The UI's sites.positions line asks the user to close it first, and Find leftovers' scan can now read and cancel a V4 one (orders.json pins V4). This predates 1.9.0.
- Q4: Sign is gated in every combination. The button is disabled and answer() returns early when mustAck && !ack; Enter in the password box goes through answer(); with no password needed, onClick goes through answer().
- Q4: the yes can't carry over. ackFor is keyed to the request id, so the next or replacing request starts with the switch off. The switch is disabled while busy or held; Decline all only declines. dapp-answer is sent only from DappApprovals, sign-tx is the only transaction kind, and no path signs without the window.
- Q5: DappTxSummary is never persisted. Waiting requests live in memory; remember and siteSigned read only txHash and ownOutputs; ties spreads the summary, so the new fields reach the window.
- Q5: TxDetail.yourSigners is optional and only TxDetail.tsx reads it; incoming.ts decodes its own TxDetail; activity and CSV records aren't built from either. A locked wallet leaves yourSigners [] and the view whole (probe).
- Q6: #376 changes only the workspace crates' versions in Cargo.lock; seedelf-wasm's dependency tree is unchanged and resolves --locked. No CARGO_PKG_VERSION in wasm/core/crypto/koios, and the built module carries no crate version string.
- Q6: third-party.mjs skips workspace members, and the manifest version comes from package.json (1.9.0, lock in step). Part 2's commands read the version from package.json, so the zip stays reproducible from the merge commit.
- #375 with #377: Minswap's live estimate accepts 1.9.0's exclude lists on both networks (preprod routes through MinswapV2, mainnet through Minswap). routeOf is wired at all three call sites with the network; NOT_READ_YET left no code behind.
- Q7: nothing is stored that reads differently. avoid is recomputed per call and never kept, and no route is stored on a session; pause and retry records keep their codes and words.
- Q7: a 1.8.1 session stuck on ChakraBondingCurve's 400 was retrying, not paused (a MinswapError isn't a Refused), so after the update it routes afresh within ≤5 min. No 1.8.1 session can hold a V4 order: 1.8.1 refused unchecked routes and checkOrder couldn't read V4's script. V4's 3.28 ₳ fits a 1.8.1 funding's costs and its 2 ₳ margin under withinFunding.
