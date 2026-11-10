# 1.9.0's release review: the v-a-impact verifier

The verification, told to refute. Verbatim from its structured report; full addresses of third parties shortened.

## Coverage

Read at 8d7c4b0c in the main tree, read-only:
- wasm/src/cip30.rs: datum_names_key 1079-1097, released_from_contracts 1099-1135, the input loop 1248-1275, mint/burn 1758-1767, key_releases 1826-1838.
- extension/src/ui/dapp.ts:28-35 (releasesContractFunds) and ui/screens/DappApprovals.tsx:120-125, 154, 290-318 and 1060-1145 (rows, callout, switch, note).
- background/dapp.ts:1795-1822: the window looks up missing inputs with Koios utxo_info _extended, the same rows I used.
- en.json:505-515; architecture.md:563; flows.md:430; the PR #373 body (gh pr view 373).

Real data:
- Koios: 12 requests, at least 1.2 s apart, user agent seedelf-review. tip; credential_txs and credential_utxos on the V2.1 CDP hash 0805d854… (no live CDPs, only 9 datum-less UTxOs, so the hash is stale); tx_cbor for 10 recent CDP txs; utxo_info _extended for their inputs and collaterals; asset_history of the CDP token 708f5e6d….434450; tx_cbor and utxo_info for the 4 newest burns; asset_utxos for the INDY staking manager NFT; tx_cbor and utxo_info for its last tx.
- How I found the V3 CDP script (78c79ef4…): Indigo's public analytics.indigoprotocol.io/api/cdps lists each live CDP's owner and creating tx. Also read-only:
  - config.indigoprotocol.io's live mainnet-system-params-v21-lrp.json
  - shallow, never-executed clones of IndigoProtocol/indigo-sdk and cardano-contracts-registry
  - DefiLlama's Indigo adapter
  - 3 WebSearch and 2 WebFetch calls, and one gh api listing of the org's repos.

Ran, in my own worktree at 8d7c4b0c with CARGO_TARGET_DIR=$HOME/.cache/seedelf-review-1.9.0/target-v-a-impact and an 8 GB cap:
- `cargo test -j 4 -p seedelf-wasm --test v_a_impact_test -- --nocapture --test-threads=1`: 3 passed. 7 real txs, re-keyed 28 bytes for 28 to 0/0 and 2/0 of the abandon phrase, in the tx bytes, the rows' addresses and the inline datums. sign_tx also signs each one.
- `--test v_a_impact_burn_test` under REVIEW_BURN_MODE unset, naive and guarded, with a mutant released_from_contracts (burn_mutant.diff). I also re-ran the real-tx test under both mutant modes.
- The worktree is removed. The main tree is untouched.

Not done:
- Lending protocols (Liqwid, Lenfi, Levvy, Optim), a real jpg.store reprice, a real DEX swap that spends a pool UTxO under the user's key (r9's 5M ₳ pool is still synthetic), and a real r19 or r20.
- Indigo V3's validator source: I found none. That the owner is checked is inferred from required_signers being the owner in every tx and from the SDK's addSignerKey.
- Indigo's CDP open path and a stability-pool action on chain: SDK source only (stability-pool.ts:147-165, staking.ts:167-205).
- Whether Indigo's own site lists Seedelf Wallet.
- The window itself was not rendered. I modelled dapp.ts and DappApprovals.tsx's logic over the real summaries. No Vitest run.

## Verdicts

### cip30-rust#1: confirmed, medium (confirmed-by-run)

**Why.** It holds on real mainnet bytes, and it isn't an edge case: every owner action on Indigo, a top Cardano DeFi protocol, hits it. I sampled 7 real txs: 4 V3 CDP adjustments, 2 V3 CDP closes and 1 INDY staking adjust. All 7 get the rows, the contractYours callout and the switch.

What the data shows:
- In each tx, the owner's key is the only required signer, and the CDP or staking-position datum carries the owner's key hash.
- The position is re-created at the same script, at the same address (the owner's stake key), with its auth token.
- A shared protocol UTxO is also spent and re-created every time: script eeea2dd2… for CDPs (5 ₳ plus accrued iAssets), and the INDY staking manager (101,604 ₳) for staking.
- So 'Leaves a contract, not to you' shows the whole position plus the shared UTxO: 75,005 ₳ for a repay of 81.65 iUSD, 41,505 ₳ for an 8,000 ₳ deposit, 520,005 ₳ for a repay of 1,408 iUSD, and 101,606.53 ₳ for staking 222 INDY more.
- The callout 'Your signature releases your own order or listing from a contract. It doesn't come back to you.' is false each time: it isn't an order or a listing, and it stays at the contract under the same owner.

How often:
- 314 live CDPs from 264 owners.
- 32 opened or adjusted in the last 7 days, 212 in the last 30. Each CDP counts once, so this is a lower bound.
- 45 CDP-token burns in 30 days; the 4 newest were all owner closes.
- The staking manager was last touched about 4 hours before my read.

Grade: medium by the table. It's wrong behaviour a real user hits on every action of a major dApp, at a cost: false figures of up to 520,005 ₳, a false sentence, a switch on every action, and the habituation that weakens #373's own warning. It isn't high: it overstates, nothing is refused, and a site can't use it to take money.

What the owner already accepts: the mechanism itself, that same-contract money counts as gone so honest re-creations get the switch, is their stated trade-off and not a bug. What the docs don't state or accept is the breadth (positions and shared-state UTxOs, every action), and that the contractYours text is false there.

Sub-claims that don't fully hold:
- r19's 1 ₳ row is accurate: the service fee does leave the order, not to the user. Only the switch and the wording are at issue.
- r11 (a net receiver repaying) is covered by architecture.md's general 'a loan's repayment can read as releasing the ADA paid on', even though the PR body says 'net spender'.
- r9's 5,000,000 ₳ DEX pool was not found on chain. The real shared-state cases found are Indigo's shared UTxO and the staking manager.

**Evidence.** On chain (cbor_peek.py over Koios tx_cbor; utxo_info _extended):
- Adjust 5a1d44fd…b611, block 14180873:
  - required signers ['bc64c075…0186'].
  - CDP input 07323636…#1: 75,000 ₳ + 708f5e6d….434450 (CDP token) = 1, inline datum d8799fd8799fd8799f581cbc64c075…0186ff4469555344…
  - Outputs: [1] hdr=11 pay[script]=78c79ef4… stake=74714e4c… (the owner's), 75,000 ₳ + CDP 1, the same owner in the datum. [0] the shared script eeea2dd2…, 5 ₳ + iBTC 1356, iETH 201, iSOL 2, iUSD 15495657 (input 2ee576f5#0 had iUSD 14458818).
  - mint iUSD -81648269.
- Adjusts ea894a75…, 8b09a30d… and 4185e006… have the same shape. Closes 2ee576f5… and b8d776cc… burn 708f5e6d….434450 -1.
- Staking 44402cbf…:
  - required ['233d5825…'].
  - The position 3dba6717#1 (10,091.664488 INDY + STAKING_POSITION, datum naming 233d5825…) is re-created holding 10,313.82419 INDY.
  - The manager 57d56c6c#0 (101,604.325341 ₳ + STAKING_MANAGER_NFT) is re-created unchanged, all at script 112996eb….

Run: `cargo test -j 4 -p seedelf-wasm --test v_a_impact_test -- --nocapture --test-threads=1` → `test result: ok. 3 passed`.
- A1 5a1d44fd:
  - signs=["0/0"] complete=true netLovelace=-823570 releasedLovelace=75005000000 releasedTokens=[1 CDP, 0.001356 iBTC, 0.000201 iETH, 2 iSOL, 14.458818 iUSD] namesKey=true keyReleases=true.
  - Window: 'Total leaving your public account: 0.82357 ₳', 'Sends: 82.685108 iUSD', 'Leaves a contract, not to you: 75005 ₳' plus 5 token rows, callout contractYours, switch 'I expect this to leave the contract'.
- A2 ea894a75 (an 8,000 ₳ deposit): releasedLovelace=41505000000 releasedTokens=[1 CDP, 34.412842 iUSD]. Window: 'Total leaving your public account: 8000.757572 ₳', 'Leaves a contract, not to you: 41505 ₳', contractYours, switch.
- A3 8b09a30d: releasedLovelace=520005000000.
- A4 4185e006: releasedLovelace=8237361331. Both contractYours + switch.
- S1 44402cbf: releasedLovelace=101606527751 releasedTokens=[1 STAKING_MANAGER_NFT, 10091.664488 INDY, 1 STAKING_POSITION] namesKey=true, contractYours + switch.

Activity:
- api/cdps: 'live CDPs 314 … in the last 7d: 32 … 30d: 212', 'distinct owners 264', 'ADA collateral in CDPs 16786302'.
- asset_history: '30d CDP token mints (opens) 51 burns (closes or liquidations) 45'.

Code:
- cip30.rs:1105-1106 'Money that stays at the same contract counts as gone'.
- cip30.rs:1125 `let gone = q.saturating_sub(back);`.
- cip30.rs:1130-1133, where the lovelace credits only `came_in`.
- dapp.ts:33-35 releasesContractFunds.
- DappApprovals.tsx:1104-1143: the rows, then `tr(s.namesKey ? "dappUi.warn.contractYours" : …)`.
- en.json:514.

SDK, the same shape for other positions: staking.ts:167-205 and stability-pool.ts:147-165 (`.addSignerKey(pkh.hash)`, re-created at the same script).

**Documented.** In part.

PR #373 body: "Honest requests that also get the warning and the switch: - Repricing a listing, which pays back to the same contract. - A net spender repaying a loan, which can read as releasing the ADA paid on." It also says: "Not run: a real contract UTxO on preprod or mainnet. That's left for the release review."

architecture.md:563: "`released*`, what doesn't reach the account, … and money kept at the same contract counted as gone, since a listing can stay there under a new owner's datum" and "so a loan's repayment can read as releasing the ADA paid on. Nothing is refused: the ledger takes these, and an honest listing update needs them."

cip30.rs:1105-1106 says the same.

So the mechanism is a stated, accepted trade-off. Nowhere stated: that it covers every action on positions and shared-state UTxOs, or that the contractYours text is then false.

**The fix.** Option 1 (a keptLovelace/keptTokens figure, shown as staying, out of the 'not to you' row):
- Not safe as a rule for when the warning fires. A same-script re-creation is exactly the re-listing attack the rule exists for (cip30.rs:1105-1106): a site re-creates the user's ask at the same script with its own key as owner.
- Making it conditional on the new datum naming the account's key doesn't help. datum_names_key matches any 28-byte window (cip30.rs:1093-1096), so a site can put the user's hash anywhere in its datum, a 1-lovelace payout for example.
- Indigo rewrites its datums on every action, so a byte-identical-datum rule wouldn't cover Indigo either.
- Safe only as an extra information row ('Goes back to the same contract: X ₳') that leaves the warning and the switch in place.

Option 2 (never contractYours for re-created value):
- Text-only: refuses nothing and needs no request. Safe if the new sentence stays true in the attack too, since both cases re-create at the same script: say part goes back to the same contract and the wallet can't tell whose it is then.
- It's a critical .warn. key: short text, and es/ja back-translated.

Option 3 (docs): safe. Name the class: CDPs, staking positions, stability-pool accounts and shared-state UTxOs, every action, whatever the net.

None of the options adds a network request, so no privacy-policy entry is needed. Whether to keep the switch for these is the owner's call. The text and the docs are the minimum.

### cip30-rust#3: confirmed, low (confirmed-by-run)

**Why.** It holds on two real Indigo V3 closes. The owner signs, the CDP token is burnt (mint -1), and the summary still lists '1 CDP' in releasedTokens, so the window shows 'Leaves a contract, not to you: 1 CDP' beside the mint's -1. released_from_contracts never sees the burn: the call at cip30.rs:1826 passes only contract_held, put_in, returned and fee.

Grade: low. It's misleading on a real path, but not exploitable, and the mint row tells the truth. On Indigo it adds one row: the close still gets the warning and the switch from the shared UTxO's 5 ₳ and iAssets (#1's cause), with or without a burn fix. On a dApp without shared state, the burn alone turns an honest close into warning + switch.

The finder's fix line 'Nothing a site can gain is hidden by this' is wrong. The run below shows a bypass.

**Evidence.** On chain:
- 2ee576f5…dfd: required ['ca771dc9…a072'], mint 708f5e6d….434450 -1 and iUSD -24465689. The CDP 8aa2ca54#0 (272.979999 ₳ + CDP 1, datum naming ca771dc9…) comes back to the owner (output [1], 14,272.717288 ₳). The shared UTxO 219ea990#1 is re-created at eeea2dd2….
- b8d776cc…05a is the same, with a 2,200 ₳ CDP.

Run (v_a_impact_test, shipped code):
- C1 2ee576f5: netLovelace=272028098 releasedLovelace=5000000 releasedTokens=[1 CDP, 0.001356 iBTC, 0.000201 iETH, 2 iSOL, 14.45881 iUSD] mint=[-1 CDP, -24.465689 iUSD] namesKey=true keyReleases=true.
- Window: 'Total coming into your public account: 272.028098 ₳', 'Leaves a contract, not to you: 5 ₳', '…: 1 CDP', and 4 iAsset rows, contractYours, switch.
- C2 b8d776cc: releasedLovelace=5000000 releasedTokens=[1 CDP, 0.005573 iETH, 6535 iSOL, 181.092406 iUSD], contractYours, switch.

Mutant (burn_mutant.diff, REVIEW_BURN_MODE), v_a_impact_burn_test:
- Synthetic attack: the user's order holds 5 X under 0/0's datum and the account holds 5 X. The site funds its own output's ADA, burns the account's 5 X and pays the order's 5 X to itself. Results:
  - Shipped: releasedTokens=["5"], warning (contractYours) + rows + switch.
  - naive: releasedTokens=[], 'neutral note only'.
  - guarded: releasedTokens=["5"], warning.
- The honest close in r10's shape: shipped warns; naive and guarded both give a neutral note.
- Real txs under either mode: C1 loses the '1 CDP' row but keeps releasedLovelace=5000000 and the iAssets, so it still warns with the switch. naive also over-credits the account's own iUSD burn against the shared UTxO's: A1's 14.458818 iUSD row disappears, and A4's 178.763181 becomes 127.092406.

**Documented.** Nowhere. The docs and the PR body say nothing about burns. architecture.md:563 covers only 'each asset on its own so ADA paid back can't stand for a token taken'.

**The fix.** As suggested, the fix is unsafe. Taking the whole burn off `gone` lets a burn of the account's own units stand for the contract's units leaving. The run shows the warning and the switch disappearing while the order's 5 X go to the site. A site needs only a policy that lets it burn in that transaction.

The safe version mirrors the fee rule the function already has ('the fee comes off as far as the account didn't pay it', cip30.rs:1103-1104 and 1130-1133): credit only the burn beyond the account's own net spending of that asset. In the token closure: `let credit = burnt.saturating_sub(put_in_k.saturating_sub(returned_k)); let gone = q.saturating_sub(back).saturating_sub(credit);`, passing `&burn` (built at cip30.rs:1759-1766) into released_from_contracts.

In the run, the guarded version clears the honest close and still warns on the attack. It refuses nothing and adds no network request. It doesn't remove Indigo's warning; that needs #1's decision.

