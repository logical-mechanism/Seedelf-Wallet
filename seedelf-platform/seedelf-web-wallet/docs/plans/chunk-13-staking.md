# Chunk 13 plan: staking and voting delegation

**Why:** on 2026-09-24 the user settled what the wallet is: **a Cardano wallet with private payments built in**, more like Lace, not a stealth wallet you keep beside another one. Users shouldn't need a second wallet for the Cardano side. Chunk 12 added Send from the Cardano account; this chunk adds staking and voting delegation. Branch `web-wallet/staking`, from `seedelf-web-wallet` once chunk 12 is merged. It's big, so it may split into 13a (the core and staking) and 13b (voting, spending rewards, the new positioning), one PR each.

## Status (2026-09-24)

**Built in one PR** on `web-wallet/staking`, not split into 13a and 13b: every item in *Scope* below. **Not done:** the live preprod run, which needs the user's go-ahead (`node e2e/live/run.mjs staking`, then `withdraw-rewards` and `unstake` once rewards arrive).

**Where it went differently from the plan:**

- **One certificate to register and delegate:** Conway's `StakeRegDeleg` and `VoteRegDeleg`, not a registration then a delegation as Lace does. Fewer bytes, the same effect.
- **`BuiltTransaction::sign` is fine after all.** The patch writes the new body hash into the `BuiltTransaction` (Pallas doesn't export its byte types, but their fields are public), so `sign` signs the right hash, and the signing code needed no change. A patch after signing is refused.
- **`Payee::Nobody`**: a staking transaction is an account payment that pays no one, so it shares the move-in's UTxO choice and change.
- **The pool list has tickers, not names.** `pool_list` has no name column, and `pool_metadata` includes every pool that ever was (682 on preprod), with no status to filter by. Names come with a pool's details, and search is by ticker or pool ID.
- **Saturation needs two more requests:** `pool_list` has only the active stake, so the browser adds `totals` (the supply) and `epoch_params` (`optimal_pool_count`). All three are kept for a day. Checked: LOGIC's worked out as 18.79%, `pool_info`'s live figure 18.80%.
- **The ticker on Home** comes from what the session read, the pool list on the device, or one `pool_info` a session (in session storage: it says which pool is the user's).
- **Home's Cardano balance counts the rewards,** as Lace's does; `Balances.cardano.lovelace` stays the UTxOs', and the forms add the rewards only while they ride along.
- **A DRep's name only:** `drep_metadata` with `select=drep_id,meta_json->body->givenName`. Its image is never fetched.
- **DReps are searched by name, not only pasted by ID** (the user asked, after the PR opened): the wallet ships its own list of named DReps (`npm run dreps`, `src/dreps/`), as it does its token list. The follow-up below is done.
- **The pinned choices in a list,** as radio rows with a line each, not a segmented switch: "Always no confidence" needs saying what it does.

**Checked on preprod without spending anything** ([`tests/fixtures/probe-staking.mjs`](../../extension/tests/fixtures/probe-staking.mjs)): every kind of staking transaction for the public 12-word account decodes on the node's Conway decoder (Ogmios `evaluateTransaction` answers `[]`), and an account-paid mint with its 57.475311 ₳ of rewards riding along passes the real Seedelf policy (72,835 memory, 21,396,008 steps, the same as without).

## Start here

1. `git fetch origin && git checkout -b web-wallet/staking origin/seedelf-web-wallet`
2. Read this plan, then chunk 12's handoff note in [roadmap.md](../roadmap.md#handoff-notes).
3. Build and test (from `extension/`): `npm run build && npm test && npm run e2e`.
4. Record the fixtures below from preprod before writing the worker.

## Decided with the user

| Question | Decision |
|---|---|
| Stealth wallet beside another, or a full wallet? | **A full Cardano wallet with Seedelf built in.** The README, privacy.md and the store listing say it (the user resubmits the listing). |
| Several pools per account? | **One pool per account.** Lace 2.4 dropped multi-pool too. |
| Governance | **Delegation only:** Always abstain, Always no confidence, or a DRep. No voting on proposals, no registering as a DRep. |
| Rewards | **Spent automatically when the account spends** (a withdrawal rides along in a send, move-in or account-paid mint), with a **Settings switch** to turn that off and withdraw by hand from the Staking page. |
| Rewards on Home | **`account_info` joins the balance reading** (one more request), so the Cardano tab always shows the pool and the rewards. |
| Choosing a DRep | **The two pinned choices, or paste a DRep ID** (its name from its metadata). A browsable list is a follow-up, below. |

## What Lace does, and what we keep

From `_reference/lace` (2.4.0): a staking page per account with the pool's stats and warnings (retiring, saturated, pledge not met, no DRep); a pool browser with search (ticker, name, ID) and sorts (saturation, cost, margin, pledge, stake, blocks); pool details → review (the key deposit, the fee) → sign. The first delegation is two certificates (registration, then pool delegation); a vote delegation can ride in the same transaction. De-registering withdraws all rewards and returns the deposit in one transaction, and is disabled while rewards are locked for lack of a DRep. Governance has its own tab: Abstain and No Confidence pinned at the top, then DReps by name. Lace warns "Rewards locked. Delegate your voting rights to a DRep…".

**Left out:** return estimates (ROS) and rankings, reward charts, delegation history, promoted pools and DReps, fiat, hardware wallets.

## Scope

### 1. Core (`seedelf-core/src/build.rs`)

- **Pallas can't build certificates or withdrawals.** `pallas-txbuilder` 0.33 has `// pub certificates: TODO` and `// pub withdrawals: TODO`, and `build_conway_raw` writes `None` for both; 1.4.0 (the newest) is the same, so no bump helps.
- **The way round:** stage and build as now, then decode the body (`conway::Tx`), set `certificates` and `withdrawals` (pallas-primitives has every Conway certificate: `Reg`, `UnReg`, `StakeDelegation`, `VoteDeleg`, `StakeVoteDeleg`, `StakeRegDeleg`, `VoteRegDeleg`, `StakeVoteRegDeleg`; `DRep::{Key, Script, Abstain, NoConfidence}`), and re-encode. The body hash changes, so signing comes after, on `tx_id()` of the patched bytes with `add_witnesses` (never `BuiltTransaction::sign`, whose hash is stale). `settle_fee` must price the patched body plus the stake key's witness.
- **The account payment gains** an optional withdrawal (the reward address and the whole balance: the ledger takes nothing less) and certificates, with the deposit (`key_deposit` from `epoch_params`, added to `ProtocolParameters`) paid from the inputs, and a refund (the deposit `account_info` reports) added back.
- **Builders:** delegate (registration when unregistered, then pool delegation, and a vote delegation when asked), change pool, delegate the vote, withdraw rewards, stop staking (withdraw everything, unregister, refund). Each with core tests like `build_test.rs`: value conserved counting deposit, refund and withdrawal; fee covers the patched, signed size.

### 2. WebAssembly

- Build and sign each one, with the payment keys and the **stake key** (`Role::Staking`, index 0) inside WebAssembly. The staking key never reaches JavaScript.
- A send, move-in or account mint takes an optional `withdrawal` (lovelace) when rewards are to be spent: checked non-negative, and signed with the stake key too.

### 3. Worker

- `Koios`: `accountInfo` (status, pool, DRep, rewards available, deposit), `poolList` (live pools only: `pool_status=eq.registered`, the columns the browser shows), `poolInfo`, `drepInfo`, `drepMetadata`.
- **Rewards in the balance:** `Balances.cardano` gains `rewards`, `pool`, `drep` and `registered`. With spending rewards on, the spendable figure includes them.
- **Spending rewards:** a build reads `account_info` fresh (the withdrawal must equal the balance), and only when a DRep delegation exists (Conway refuses withdrawals without one; the UI says so and offers to delegate the vote). An epoch boundary between Review and Send changes the balance: the submit fails with a clear "review it again".
- **The pool list is public:** kept in `chrome.storage.local` for a day, not per session.
- A `StakingService` for building and submitting, like `SendService` (signed at review; Send only submits; pending kinds `stake`, `vote`, `withdraw-rewards`, `unstake`).
- A setting, `spendRewards` (default on), in `chrome.storage.local`.

### 4. UI

- **Cardano tab:** a Staking row under the balance: "Staking with LOGIC · 57.47 ₳ rewards", or "Not staking · Stake", and the rewards-locked warning when there's no DRep.
- **Staking page:** the pool (ticker, name, saturation, margin, cost, pledge; the warnings), rewards with **Withdraw** (always there; the only way when the Settings switch is off), **Change pool**, **Stop staking** (disabled while rewards are locked), and **Voting power**: the current choice and **Change**.
- **Pool browser:** a search (ticker, name, pool ID) and sorts (saturation, margin, cost, pledge, live stake); details; review (deposit, fee); Send.
- **Voting:** Always abstain, Always no confidence, or a DRep by ID (name, status, voting power from its metadata and `drep_info`); review; Send.
- **Settings:** "Use staking rewards when spending" (on by default).
- **Privacy notes:** staking and voting are public and name the account; Seedelf money can't be staked (no staking part, by design), so it earns nothing while it's in Seedelf.

### 5. Koios requests

As built:

| When | Requests |
|---|---|
| A balance reading | 4 (was 3): `account_info` joins, alongside. The first of a session with a pool also asks its `pool_info` for the ticker, unless the pool list on the device has it |
| Opening Staking | 1: `pool_info` for the current pool |
| Browsing pools | 3 on preprod (559 live pools: `pool_list`, `totals`, `epoch_params`), 5 on mainnet (2,891), then none for a day |
| A pool's details | 1: `pool_info` |
| A DRep by ID | 2: `drep_info` and `drep_metadata` |
| Any staking build | 4: `account_addresses`, `credential_utxos`, `account_info`, `epoch_params` |
| A send, move-in or mint spending rewards | 1 more: `account_info` |

### 6. Tests and fixtures

- **Record from preprod:** the public 12-word phrase's account is registered, delegated to LOGIC (`pool1rccstu3l9ty3k0a5cd06fl3szsss9r34dcg5j38fqgq9kvng0tg`), set to always abstain, and had about 57.47 tADA of rewards on 2026-09-24. Record `account_info`, `pool_list` (preprod), `pool_info` for LOGIC and one other, a DRep's `drep_info` and `drep_metadata`.
- Core, WebAssembly (native and JS), worker and e2e tests as for every flow, asserting the exact Koios requests per screen.
- A live preprod run (the user approves live runs each time): delegate, vote, withdraw, change pool, stop staking.

### 7. Docs

README, privacy.md and flows.md (a Staking section); architecture.md (certificates, the requests); the store listing ("A Cardano wallet with private payments built in"), for the user to resubmit.

## Follow-ups, not this chunk

- ~~A browsable DRep list with names.~~ **Done in this chunk, at the user's request (2026-09-24):** `npm run dreps` bundles every registered DRep with a name (preprod 61 of 290, mainnet 452 of 1,050: 5 and 37 KB), and the vote page searches it by name or ID with no requests. Only the DRep picked is read live. A DRep registered since the release is found by pasting its ID. Koios has no bulk list of names: `drep_list` has none, and `drep_metadata` answers only for the IDs given (75 a request under the 5,120-byte body limit), so a live list would cost 14 requests a day on mainnet.
- Rewards history, and the Cardano Activity's certificates and withdrawals (`tx_info` with `_certs` and `_withdrawals`).
