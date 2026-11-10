# 1.9.0's release review: the attacker lane's report

Round one, a finder. Verbatim from its structured report; full addresses of third parties shortened.

## Coverage

Read COMMON.md; PR #373's diff (75600ed6^1..75600ed6) for wasm/src/cip30.rs (inspect, released_from_contracts, datum_names_key, at_script, sign_tx), extension/src/ui/screens/DappApprovals.tsx (mustAck, ackFor, the Sign switch, the contract note and rows), extension/src/ui/dapp.ts (releasesContractFunds), extension/src/background/tx-view.ts (markYours, yourSigners), extension/src/ui/components/TxDetail.tsx, shared/rpc.ts and en.json; wasm/src/lib.rs's inspectDappTx, signDappTx, inspectSessionTx and signSessionTx; and the worker's input lookup in background/dapp.ts (resolve). A safety check stopped the session partway through this lane. After that I did not carry on with the attacker part: I made no worktree, wrote and ran no test, built no transactions, and I report no bypass findings. So the main question of this lane (whether a site can get past the warning and the switch) has not been answered by this reviewer. The only thing I made is the empty scratch folder /tmp/claude-1000/-home-logic-Documents-LogicalMechanism-Seedelf-Wallet/6637f822-1e93-462d-9b5e-5bd103fc4b4b/scratchpad/review-1.9.0/attacker/. No worktree needs removing. The lane still needs a reviewer, or the owner, to look at how far the warning's heuristics hold (the native-script check that uses the script data hash, the datum scan, and the token-gated case the code already says it leaves to the note).

## Findings

None.

## What holds

- Private sessions get the same reading as the public account: lib.rs inspect_session_tx and sign_session_tx call cip30::inspect_tx and cip30::sign_tx with governance forced off, so the new contract fields (contractInputs, releasedLovelace/Tokens, keyReleases, namesKey) are worked out for a session's requests too.
- The Sign switch can't carry over to another request: DappApprovals.tsx keeps ackFor as the request id it was given for, and ack is only true while ackFor === currentId.
- The switch gates every way to approve: answer() returns early on approve && mustAck && !ack, so the password form's submit path is blocked as well as the button, which is disabled on the same condition.
- A payment or DRep key never signs over an input the wallet can't find: inspect bails when unknown is non-empty and payment_signs is true, so a contract input the worker didn't find can't be spent under the account's payment key.
- A required signer naming one of the account's keys always sets key_releases (cip30.rs, after released_from_contracts), and a Plutus script can only see signatures through required signers, so the plain signature-checking cancel or withdrawal shape raises the warning when the contract UTxO was found and keeps money that doesn't reach the account.
- released_from_contracts counts each asset on its own and credits the account only what it comes out ahead, so ADA paid back can't hide a token being taken, and the account's own spending isn't counted as the contract's money coming back.
