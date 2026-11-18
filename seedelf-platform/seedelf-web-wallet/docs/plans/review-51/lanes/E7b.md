# Lane E7b

Returned by the workflow's agent `a37a8181612cc3393`, written here by the lead from its structured answer.

## Findings (4)

### e7b#1 · low · Delegating again to the pool or DRep Koios names is refused, though the ledger takes it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/staking.ts:539`
- **Who:** user · **Since:** 756a646e (chunk 13, 2026-09-24); the messages a4d08a83, Voting's `why` 659e7ec4 · **Confidence:** traced
- **Needs the owner:** It removes a refusal and changes what Pools and Voting power offer; the owner may prefer a warning to an open button.

**Scenario:**

The public account is registered and Koios says it delegates to pool X (or its vote to DRep D). On Pools, X's page shows "You're staking with this pool" in place of the Stake button. On Voting power, choosing D greys Review with "Your voting power already goes there". The worker refuses both builds: "You're already staking with this pool." and "Your voting power is already delegated there." The ledger takes a StakeDelegation or VoteDeleg to the same target: a fee-only no-op. That breaks the owner's 2026-10-19 rule, which allows a warning at most for a valid choice. It costs money when Koios names a delegation the ledger no longer holds: a pool that retired and re-registered under the same ID (POOLREAP drops its delegations), a DRep that retired and registered again (protocol 10 clears the delegations to it), or a Koios server a block behind just after a change away. The user then can't delegate straight back. They must go through another pool or DRep first: one more transaction (about 0.17 ₳), and for a pool possibly an epoch of rewards.

**Evidence:**

staking.ts:500-504, the build's docstring: "The same pool or vote delegation again is refused: it would only cost a fee." staking.ts:539-544: `if (action.kind === "delegate" && state.registered && stake?.delegated_pool === wasm.poolId(action.pool)) { throw new Error(t("worker.staking.samePool")); } if (action.kind === "vote" && state.drep === wasm.drepId(action.drep)) { throw new Error(t("worker.staking.sameDrep")); }`. Pools.tsx:354 `const yours = row.id === current;` and Pools.tsx:367-370: the foot is the `pools.alreadyYours` label, with no button. Voting.tsx:128 `const same = chosen !== undefined && chosen === current;`, then Voting.tsx:137-138 `why = t("vote.alreadyThere")`, and Voting.tsx:195 disables Review. Core builds the certificate regardless (seedelf-core/src/staking.rs:235-243: StakeDelegation / VoteDeleg for a registered key), so the refusal is the wallet's own. The test that pins it: extension/tests/staking.test.ts:764-767 ("refuses the same choice again"). If Koios keeps naming the dropped delegation, format.ts:409 `rewardsLocked` reads false too (see notes).

**Fix:**

Drop the worker's two refusals (staking.ts:539-544), or turn each into a line on the review ("Already your pool: this only costs a fee"). Offer the button on Pools and Review on Voting with that note in place of the label or the greyed Review. The same rule elsewhere: the screens' `yours` and `same` checks are the only other copies.

**Known check:**

Searched docs/backlog.md and docs/archive/plans/ (and archive/post-release-roadmap.md) for samePool, sameDrep, alreadyThere, alreadyYours, "same pool", "same DRep", "already staking", "already delegated", "2026-10-19". Nothing settles it. The only record is the code's docstring, from chunk 13, before the rule. The rule shows in chunk-34's calls 34-36 (2026-10-19), which dropped a typo guard the chain doesn't need.

### e7b#2 · low · A DRep profile's address is refused unless it starts http(s):// or ipfs://, though the ledger takes any address up to 128 bytes

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Governance.tsx:165`
- **Who:** user · **Since:** 5969dd7a (chunk 21, 2026-10-04) · **Confidence:** traced
- **Needs the owner:** It changes what the profile form accepts. The scheme rule was a deliberate chunk-21 choice, so keeping it as a warning or as it is is the owner's call.

**Scenario:**

A user whose CIP-119 profile is published on Arweave types `ar://<43-character id>` (48 bytes) into Become a DRep's or Edit profile's address. The note under the field says "Start the address with ipfs://, https:// or http://". No anchor is made, so Review stays off on both forms. The ledger would take the anchor: any text up to 128 bytes, the very limit the wallet's own `MAX_ANCHOR_URL` names. Core's `anchor()` also refuses whitespace and control characters, which the ledger takes. The user can set such an anchor only through a governance site over CIP-95. No money is at stake.

**Evidence:**

Governance.tsx:160-167 `anchorUrlProblem`: `if (/\s/.test(trimmed)) return "drep.form.urlSpaces"; ... if (!/^(https?|ipfs):\/\/\S+$/i.test(trimmed)) return "drep.form.urlScheme";`. Governance.tsx:610 `onAnchor(file && !stale && !anchorUrlProblem(url) ? { url: url.trim(), hash: file.hash } : undefined)`. With no anchor, BecomeDrep's `ready` is false (Governance.tsx:383, 395: `drep.form.finishFirst`), and DrepProfileEdit's Review is `disabled={!anchor || ...}` (Governance.tsx:540). seedelf-core/src/staking.rs:549-550: "The ledger's limit on an anchor's address, in bytes" = 128, and staking.rs:566-568 also refuses `c.is_whitespace() || c.is_control()`. archive/plans/chunk-21-governance.md:140 records the scheme rule as deliberate (2026-10-04), before the owner's 2026-10-19 rule. The tests: extension/tests/governance-screen.test.ts:267-270.

**Fix:**

Keep the 128-byte limit as the only refusal, in the form and in core's `anchor()`. Make the scheme check, and perhaps the spaces check, a warning under the field ("Most governance tools read only ipfs:// and https:// addresses").

**Known check:**

Searched docs/backlog.md and docs/archive/plans/ for urlScheme, anchorUrlProblem, "ar://", arweave, scheme, anchor. Only chunk-21's "Where it went differently" line (deliberate, 2026-10-04) and chunk-20's ar:// note for NFT images (a different feature). Not in any backlog line or any review's Not fixed list.

### e7b#3 · nit · KoiosProposal.expiration's doc says the opposite of how governance.ts reads it

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/background/koios.ts:289`
- **Who:** nobody · **Since:** 3e96a162 (chunk 21's fix round changed the reading and left the type's doc from 5969dd7a) · **Confidence:** traced

**Scenario:**

A maintainer reads the Koios type: `expiration` is "The last epoch it can be voted on in." governance.ts subtracts one from it, which then reads as a bug. Reverting it would show voting open an epoch after the ledger closes it. The vote buttons would stay live, and the node would refuse each vote.

**Evidence:**

koios.ts:289-290 `/** The last epoch it can be voted on in. */ expiration: number;`. governance.ts:161-164: "Koios's `expiration` is the epoch an action is expired in (its `expired_epoch`, checked on mainnet 2026-10-04): the ledger takes votes through the one before" ... `expiresEpoch: row.expiration - 1`. The `- 1` is pinned by extension/tests/governance.test.ts:176-178 and recorded in archive/plans/chunk-21-governance.md:160. rpc.ts:516 `GovAction.expiresEpoch` correctly says "The last epoch it can be voted on in".

**Fix:**

Reword koios.ts:289: "The epoch it's expired in (`expired_epoch`): votes are taken through the one before."

**Known check:**

The reading itself is settled: chunk-21-governance.md:160 and flows.md:316. Only the stale type comment is new.

### e7b#4 · nit · Voting's "Inactive since epoch E" and the DRep card's "Active until the end of epoch E" read the same field an epoch apart

- **Where:** `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Voting.tsx:477`
- **Who:** user · **Since:** 8b9c3cd7 (2026-10-02) · **Confidence:** plausible

**Scenario:**

A DRep last active in epoch E (Koios `expires_epoch_no` = E) is looked up on Voting power. Its card says "Inactive since epoch E", but it was active through E and inactive from E+1. The account's own DRep card reads the same field as the last active epoch: "Active until <end of epoch E> (epoch E)". So one of the two screens is an epoch off. By the codebase's own definition (rpc.ts:482), the Voting card is the wrong one. Only the epoch shown is off: whether the DRep is inactive comes from Koios's `active`.

**Evidence:**

Voting.tsx:474-478: `drep.active ? t("vote.status.active") : drep.expiresEpoch !== null ? t("vote.status.inactiveSince", { epoch: drep.expiresEpoch }) : t("vote.status.inactive")`; en.json "vote.status.inactiveSince": "Inactive since epoch {{epoch}}". Governance.tsx:233: `t("drep.status.active", { epoch: drep.expiresEpoch, date: epochEnds(network, drep.expiresEpoch) })` (epochEnds = start of epoch+1, format.ts:121-123). rpc.ts:482 (OwnDrep.expiresEpoch): "The last epoch it stays active in without voting or updating." Both come from Koios's `expires_epoch_no` (staking.ts:429, governance.ts:110).

**Fix:**

Pass `drep.expiresEpoch + 1` to `vote.status.inactiveSince` (no string change), or reword it "Inactive after epoch {{epoch}}". To confirm, check one inactive DRep's `expires_epoch_no` against its last vote's epoch plus `drep_activity`.

**Known check:**

Searched docs/backlog.md and archive/plans/ for inactiveSince, expires_epoch_no, "Inactive since": nothing.

## Guards (18)

| Where | What it stops | Test |
|---|---|---|
| `seedelf-platform/seedelf-core/src/staking.rs:207` | A withdrawal of anything but the whole reward balance, and one from a key whose vote isn't delegated (RewardsLocked: the ledger refuses it since protocol 10) | seedelf-core/tests/staking_test.rs refuses_what_the_ledger_would, withdrawing_and_stopping_bring_the_rewards_and_the_deposit_back |
| `seedelf-platform/seedelf-core/src/staking.rs:253` | Stop staking without the withdrawal UnReg needs (a non-zero balance is refused) and with a refund other than the deposit Koios says was paid | seedelf-core/tests/staking_test.rs withdrawing_and_stopping_bring_the_rewards_and_the_deposit_back |
| `seedelf-platform/seedelf-core/src/staking.rs:238` | A first registration (StakeRegDeleg / VoteRegDeleg) carrying anything but the current key_deposit from the protocol parameters | seedelf-core/tests/staking_test.rs the_first_delegation_pays_the_deposit_and_signs_with_the_stake_key, each_action_is_the_certificate_the_state_needs |
| `seedelf-platform/seedelf-core/src/staking.rs:289` | A DRep registration with a guessed deposit when Koios gives no usable drep_deposit | seedelf-core/tests/staking_test.rs a_drep_refuses_what_the_ledger_would |
| `seedelf-platform/seedelf-core/src/staking.rs:309` | A DRep retirement with a refund of 0 when Koios didn't give the paid deposit | seedelf-core/tests/staking_test.rs a_drep_refuses_what_the_ledger_would |
| `seedelf-platform/seedelf-core/src/staking.rs:315` | Retiring while the account's vote is on its own DRep, which would leave the rewards locked: it moves the vote to Always abstain | seedelf-core/tests/staking_test.rs updating_retiring_and_voting_are_the_drep_keys; extension/tests/governance.test.ts:271-283 |
| `seedelf-platform/seedelf-core/src/staking.rs:443` | Underflow when a deposit exceeds the inputs plus rewards and refund: checked arithmetic, read as a shortfall | seedelf-core/tests/staking_test.rs a_staking_transaction_still_spends_a_utxo_and_explains_a_shortfall |
| `seedelf-platform/seedelf-core/src/staking.rs:457` | A patch after signing (the signature would cover the old body hash) or over a body already holding certificates, withdrawals or votes | seedelf-core/tests/staking_test.rs a_patch_happens_before_signing_and_nothing_to_patch_changes_nothing |
| `seedelf-platform/seedelf-web-wallet/wasm/src/lib.rs:301` | Signing a UTxO not under the account's payment key at its path, so an account switch between readAccount and buildStaking can't sign one account's UTxOs and stake state with another's keys | not checked |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/staking.ts:529` | Withdraw or Stop while one of the wallet's own transactions on its way withdraws the same rewards (only one can land) | extension/tests/staking.test.ts:739-742 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/staking.ts:523` | A DRep retirement built without Koios's positive deposit (the worker's copy of core's) | none found in Vitest; core's copy is pinned |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/staking.ts:562` | A retirement review that leaves out, or invents, the move of the account's own vote: taken from the same fresh read WebAssembly builds with | extension/tests/governance.test.ts:271-283 |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/script-spend.ts:384` | Sending a kept staking transaction other than the one reviewed (hash), on the other network, or past its TTL | extension/tests/staking.test.ts:701-717 (submits exactly what was built); not checked for the mismatch branch |
| `seedelf-platform/seedelf-web-wallet/extension/src/background/governance.ts:164` | Showing an action open for votes in the epoch Koios lists it expired in, which the ledger refuses | extension/tests/governance.test.ts:176-178 |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Staking.tsx:1021` | A review's 'Public account after' that counts withdrawn rewards twice or leaves out a deposit or refund | extension/tests/staking-screen.test.ts:98 (the balance staying the same on a withdrawal) |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Staking.tsx:645` | Stop staking offered while rewards are locked (the ledger refuses the withdrawal and the UnReg alike) | none found |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Pools.tsx:356` | Delegating to a retired pool (the ledger refuses it) | none found |
| `seedelf-platform/seedelf-web-wallet/extension/src/ui/screens/Voting.tsx:130` | Delegating the vote to a retired or never-registered DRep (protocol 10 refuses it) | none found |

## Checked and holds

- Every stake certificate the builder makes fits Conway: StakeRegDeleg or VoteRegDeleg with the current key_deposit for an unregistered key; StakeDelegation or VoteDeleg for a registered one. Stop is the whole-balance withdrawal plus UnReg with Koios's paid deposit, valid in one transaction because CERTS validates and drains withdrawals before any certificate.
- Withdraw takes the whole rewards_available, read fresh at build. It's refused when zero, when the vote isn't delegated, and while a withdrawal of the same rewards is on its way. An epoch boundary between Review and Send is refused by the node and worded 'rewards changed' (staking.test.ts:771-785).
- Become a DRep: RegDRepCert with the parameters' drep_deposit (refused when unknown), then VoteDeleg, or VoteRegDeleg with key_deposit. The certificate order lets the delegation see the new DRep. The review shows the DRep deposit and the stake key deposit apart (drepDeposit).
- Retire a DRep: UnRegDRepCert with Koios's paid deposit, refused when unknown in both the worker and core. The own-vote move to Always abstain is decided from the same fresh read in TypeScript (ownVoteMoves) and WebAssembly (own_vote, CIP-129 on both sides).
- DRep votes: Voter::DRepKey, sorted, one vote per action, no anchor. The review names the action by the same txHash#index the ballot carries.
- Signing: the stake key only for a stake certificate or withdrawal, the DRep key only for a DRep certificate or vote. The fee is priced with the same signers() count and on the patched body (settle → signed_size → built_with). Patch first, sign after.
- Every figure on StakingReview comes from the build (fee, deposit, drepDeposit, refund, withdrawal, pool, drep). 'Public account after' = Home's total − fee − deposit + refund, which is right for each of the eight actions (withdrawn rewards are already in Home's total).
- A staking transaction pays no one: Payee::Nobody makes no output and the change goes to 0/0. Selection takes pure ADA first. net() and the change sums are checked.
- Send refuses a kept transaction whose hash or network differs from the review's, so two builds racing from double clicks can't send a review other than the one shown.
- Pools refuses a retired pool and Voting a retired or never-registered DRep, as the ledger does since protocol 10. A retiring or oversaturated pool and an inactive DRep get warnings on the review.
- Become a DRep's pre-check (deposit + key deposit + 1 ₳, refusing ≤) can't refuse an amount the build would take: the build needs the fee (~0.17 ₳) plus the minimum change (~0.97 ₳) on top of the deposits.
- Epoch arithmetic (networks.ts) matches both networks' Shelley starts (mainnet epoch 208 at 1596059091, preprod epoch 4 at 1655769600). 'Closed' and 'closes' are counted from it.
- Stranger-chosen text is cleaned before display: pool tickers in the list (plainName), DRep names (plainName), action titles and abstracts (shownText). A pool's homepage is never rendered. Koios amounts are regex-checked before BigInt in the rewards, delegation and treasury paths.
- Governance's vote list takes the newest vote per action: vote_list is ordered block_time.desc, and each action sits in exactly one 40-ID request.
- Rewards and Delegation history: rows are checked before use and paged oldest first. Totals are BigInt sums. A stopped key's next-epoch rows aren't shown as coming. The stop row's deposit is carried from its own registration.
- ProtocolParameters::from_koios bounds key_deposit (≤10 ₳) and drep_deposit (≤5,000 ₳, else unknown), so a wrong epoch_params row can't raise a deposit unseen.
- The worker reads the active account's keys for every step. check_paths refuses UTxOs not under the signing account's keys, so a switch mid-build fails rather than mixing accounts.

## Notes

- KEY_DEPOSIT is hardcoded at 2 ₳ (Staking.tsx:91), used for Become a DRep's pre-check and its 'short' line (Governance.tsx:385-394), and the static strings pools.firstDeposit, staking.depositNote and vote.notRegistered say '2 ₳'. The build always uses the protocol parameter (staking.rs:238/245/538), so only these words and the pre-check would drift if governance ever changed key_deposit. No reachable harm today.
- X3 asymmetry: Stop's refund is UnReg(cred, state.deposit) from Koios's account_info.deposit, defaulted to '0' when missing (staking.ts:135, 551 → staking.rs:259), with no positivity guard. DRep retire refuses a non-positive deposit in both the worker and core (chunk 21's fix round: 'nothing is guessed'). With an honest Koios the deposit is always the paid 2 ₳ (fixture: "deposit": "2000000"). If it ever came back '0', the Stop review would show no deposit back, and the node's IncorrectDeposit/Refund refusal would be worded 'staking changed… Refresh, and review it again', in a loop.
- For O6 (the owner's open live check of a retiring DRep): if Koios's delegated_drep keeps naming a DRep that retired after the ledger cleared the delegations to it (protocol 10), or delegated_pool a pool POOLREAP dropped, then format.ts:409 rewardsLocked reads false and Home doesn't warn. Every account payment with 'Use staking rewards' on then fails with koios.staking.notDelegated, and Withdraw and Stop fail too. The way out is a new vote delegation, but not to that same ID if it re-registered (e7b#1). Worth seeing what Koios reports on that run.
- The account's own DRep profile name (Governance.tsx:240, 527) is shown as drepName gives it: C0/C1 controls stripped but not bidi or format characters, unlike plainName elsewhere. It's text from the user's own anchor as Koios read it, and a hash mismatch shows drep.warn.profileInvalid. Minor.
- A pool's page title and the delegation review use poolLabel with the raw meta_json ticker (format.ts:430). The list uses plainName. The review also shows the whole pool ID and the shared-ticker warning (via nameSkeleton), so not a finding.
- WebAssembly's own_vote and the worker's ownVoteMoves both assume Koios's delegated_drep is CIP-129. A CIP-105 form would leave a retiring DRep's own delegation unmoved, and the rewards locked after the retirement. Koios gives CIP-129 today (fixtures, KoiosAccountInfo doc).
- Settled and not reported: Koios's `expiration` reading (chunk 21's fix round, pinned by governance.test.ts:176), an epoch boundary between Review and Send (chunk 13), and a vote on an action that expired within the hour's cache (chunk 21: the ledger refuses it, and the error says to read again).

## Coverage

Read in full, every line: background/staking.ts (574), background/governance.ts (213), ui/screens/Staking.tsx (1109), Governance.tsx (1047), Voting.tsx (502), Delegations.tsx (198), Rewards.tsx (177), Pools.tsx (420), ui/dreps.ts (47). Followed the values out of them, read in full or the relevant ranges: seedelf-core/src/staking.rs (all 671); seedelf-core/src/build.rs settle_fee/settle/signed_size/Patches/expiring (100-340) and account_staking/account_payment/build_account_payment (780-1072); wasm/src/lib.rs lovelace_of, check_paths, sign_with_paths, withdrawing, stake_key, sign_staking, drep_key, drep_of, drep_profile (180-210, 295-520), and StakingRequest/StakingAction/StakeStateIn/DrepStateIn/StakingResult/pool_id/drep_id/stake/drep_transaction (1700-2080); seedelf-koios ProtocolParameters and from_koios (880-1090); extension background/account.ts (all), script-spend.ts ScriptSpendDeps/keep/send (100-140, 320-470), koios.ts staking types, columns and orders, the staking refusal wording and the staking/governance requests (155-420, 625-760, 985-1160), activity.ts txInfoPaged/stakingOf (660-760), incoming.ts withdrawingOf/withdrawalOf/rewardAccountHex, balances.ts withIncoming/read (300-380), handlers.ts staking routes, shared/rpc.ts staking types (240-280, 420-600), ui/format.ts (unlocked, rewardsLocked, spentRewards, voteLabel, poolLabel, plainName, epochEnds), networks.ts epoch math, Home.tsx's Staking mount, reviewTotals and accountTotal, and the en.json strings the staking reviews and refusals show. Checked against the settled lists: backlog.md in full, chunk-13 and chunk-21 in full, the usability review's ST/GV index, the release reviews' open sections, post-release-roadmap searches. Tests looked at by name or for the guard lines only: seedelf-core/tests/staking_test.rs, extension/tests/staking.test.ts, governance.test.ts, staking-screen.test.ts, governance-screen.test.ts. Not reached: CIP-95 signing (dapp.ts, cip30.rs: other lanes), Home's staking row and locked-rewards banner (E9a), coin-control.ts's collateral split behind noFundsReason, the DRep list generator (npm run dreps), the e2e tests, and the wasm tests for check_paths. Nothing was run but reads, git log, git blame and one python3 -I read of a fixture.
