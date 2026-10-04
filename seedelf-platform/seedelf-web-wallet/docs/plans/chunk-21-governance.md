# Chunk 21 plan: be your own DRep, and vote

The public account registers its own DRep, votes Yes, No or Abstain on live governance actions, keeps an optional profile, and retires to get its deposit back. Then the dApp connector learns CIP-95, so GovTool and the other governance sites work too. [post-release-roadmap.md](../post-release-roadmap.md#public-side-completeness)'s item 2, the last of public-side completeness, and the last chunk before [the UX pass](../post-release-roadmap.md#the-ux-and-ui-pass).

**Status: built, 21a and 21b (2026-10-04).** Branch `web-wallet/governance`, from `main` at `3a3deed` (chunk 20 merged). What landed, and where it went differently from this plan, is under [*What was built*](#what-was-built). **Not done, and the owner's:** the live preprod run (500 tADA registered, a vote, retired), and GovTool by hand on preprod.

## Why

Chunk 13 delegated the vote and stopped there: Always abstain, Always no confidence, or a DRep. The owner (2026-10-02, and again 2026-10-04): voting is **"a required feature for a complete wallet experience"**. Registering is the gate on voting, not a sibling of it: a plain delegator casts no vote, DReps do. So the chunk is *be your own DRep and vote*, one thing ([the correction](../post-release-roadmap.md#public-side-completeness), confirmed by the owner's pick).

## Decided with the owner (2026-10-04)

| Question | Decision |
|---|---|
| Native screens, CIP-95, or both? | **Native first, then CIP-95.** The wallet's own screens are the default, since no site sees the DRep key; CIP-95 in the connector is the route a user chooses, and it's how Lace does it (Lace has no screens of its own; GovTool builds and Lace signs). May land as two PRs, 21a and 21b. |
| The DRep's profile (CIP-119 metadata) | **None by default, optional.** No anchor is all that voting your own stake needs. An optional name and bio make the wallet write the CIP-119 file and its hash, for the user to host; they paste its address. **The wallet never fetches it**, so no new host. |
| Delegate the account's own vote on registering? | **Yes, in the same transaction, by default**, with a switch to keep the current delegation. Without it the account's own stake doesn't count toward its own votes. |

## Found before building (2026-10-04)

**Lace** (`_reference/lace`, 2.4.2) has no DRep or voting screens. It derives the DRep key at **`account'/3/0`** (`KeyRole.DRep` in `cardano-key-agent.ts`, `ROLE_DREP = 3` in its Keystone paths) and offers it over CIP-95: `cip95.getPubDRepKey`, `getRegisteredPubStakeKeys`, `getUnregisteredPubStakeKeys`, and `signData` taking a DRep ID. It signs what the site builds, with the DRep key when the transaction needs it (`getUniqueSigners.ts` collects DRep credentials from certificates and voters).

**The key is CIP-105's**, `m/1852'/1815'/account'/3/0`, so a phrase restored in Lace, Eternl or Yoroi is the same DRep. CIP-105's test vector 1 (`test walk nut penalty hip pave soap entry language right filter choice`, account 0) pins it: verification key `f74d7ac3…7a752b`, key hash `a5b45515…b832aa`, CIP-129 ID `drep1y2jmg4g450lced7q9n34rq6d5vjwkm0ugx6h0894u6ur92s9txn3a`. Adding the role changes nothing that's derived today: roles 0–2 are the same keys, and the Seedelf key ([derivation.rs](../../../seedelf-crypto/src/derivation.rs)) is untouched.

**Pallas 0.35 has every type needed** (`pallas-primitives` `conway`): `Certificate::RegDRepCert(cred, deposit, anchor)`, `UnRegDRepCert(cred, deposit)`, `UpdateDRepCert(cred, anchor)`; the body's `voting_procedures: Option<VotingProcedures>`, a map of `Voter::DRepKey(hash)` to a map of `GovActionId { transaction_id, action_index }` to `VotingProcedure { vote: Yes | No | Abstain, anchor }`. The builder can stage none of it, as with chunk 13's certificates, so **the same patch** sets them after the build.

**The transaction view already decodes all of it** (chunk 17, `decode.rs`): DRep registration, update and retirement, and votes. Every review and the connector's sign window show them with no new work.

**The connector offers no extensions today:** `supportedExtensions` is `[]` and `getExtensions` answers `[]` (`content/page.ts`, `background/dapp.ts`). GovTool can't use this wallet until 21b.

**Koios, checked live:**

- `epoch_params` carries `drep_deposit` (**500 ₳** on both networks), `drep_activity` (20 epochs, about 100 days), `gov_action_lifetime` and `gov_action_deposit`. `ProtocolParameters` reads none of them yet.
- **`proposal_list`**, filtered to the live ones (`ratified_epoch`, `enacted_epoch`, `dropped_epoch` and `expired_epoch` all `is.null`): **3 on mainnet, 7 on preprod** today. Whole rows are 70 KB for mainnet's 3, almost all of it the metadata's text, so the request selects columns, title and abstract through JSON paths (`title:meta_json->body->>title`): 5.7 KB. **Koios reads the anchors itself** and says whether the hash matched (`meta_is_valid`), so the wallet shows a proposal's own words without fetching anything. **Preprod's have no `meta_json`**, so there the list shows the type and the ID.
- **`vote_list?voter_id=eq.<drep>`** gives a DRep's votes, with `proposal_id`, `vote` and `block_time`: one request for "how did I vote".
- **`drep_info`** gives `drep_status`, `deposit` (what retiring returns), `active`, `expires_epoch_no`, `amount` (voting power), `meta_url`, `meta_hash` and `live_delegator_count`. **A DRep never registered gets `[]`**, so "not a DRep" and "retired" are told apart.

## The ledger's rules, which the builders keep

- **Registering** locks `drep_deposit`, paid from the inputs, and needs the DRep key's signature. Retiring returns exactly the deposit paid (`drep_info.deposit`), and also needs it.
- **Certificates are applied in order**, so *register, then delegate the stake key's vote to it* works in one transaction. When the stake key isn't registered either, the delegation is `VoteRegDeleg` and pays `key_deposit` too.
- **A vote** needs the DRep key's signature and no deposit. A later vote on the same action replaces the earlier one, until the action is ratified, dropped or expires. Voting, or an update, keeps the DRep active.
- **Retiring while the account delegates its vote to itself** would leave its rewards locked if the ledger then drops that delegation (Conway's rules since protocol 10 clear delegations to a retired DRep; to confirm on the live run). So retiring moves the account's own vote to **Always abstain** in the same transaction, and the review says so. It's valid either way.
- An anchor's address is at most **128 bytes**, and its hash is blake2b-256 of the file's exact bytes.

## Scope

### 21a · Core (`seedelf-core/src/staking.rs`)

- **`DrepKey`**: the account's DRep credential (`3/0`'s key hash), naming it as a certificate credential, a `DRep::Key` and a `Voter::DRepKey`.
- **`Staking` gains votes** (`voting_procedures`), and **`signers()` counts keys, not "any"**: the stake key for stake certificates and withdrawals, the DRep key for DRep certificates and votes. Register-and-delegate is two. `deposit()` and `refund()` count the DRep certificates.
- **`Staking::patch`** sets `voting_procedures` too, refusing a body that already has any.
- **New actions:** register (with an optional anchor, and the self-delegation unless turned off), update (the anchor, or none), retire (refund, and the vote moved to Always abstain when it's delegated to itself), and vote (one or more actions, each Yes, No or Abstain, no rationale). Each refuses what the state rules out: registering twice, updating or retiring or voting when not registered, an empty or repeated vote.
- **`ProtocolParameters` reads `drep_deposit`** (in `seedelf-koios`, for both clients).
- **Tests like `build_test.rs`**: value conserved counting both deposits, refunds and withdrawals; certificate order; the fee covering the patched body with every witness; each refusal.

### 21a · Key derivation (`seedelf-crypto/src/cardano.rs`)

- `Role::Drep = 3`, with a test against CIP-105's vector 1 (key, hash and CIP-129 ID). The frozen vectors in `seedelf_key_v1.json` must still pass unchanged.

### 21a · WebAssembly

- `buildStaking` takes the new actions (`drep-register`, `drep-update`, `drep-retire`, `drep-vote`) and the DRep's standing, and signs with the DRep key when the transaction needs it. **The DRep key never reaches JavaScript.**
- `drepOf(account)`: the account's DRep ID (CIP-129) and public key, for its own standing and for CIP-95.
- `drepProfile(name, bio, …)`: the CIP-119 file, in CIP-119's JSON-LD shape (its `@context` as the CIP's example has it), and its blake2b-256 hash. The user gets exactly these bytes to host, so the hash matches.

### 21a · Worker

- `Koios`: `proposalList()` (live only, the columns above), `drepVotes(drepId)`; `drepInfo` exists.
- **The account's DRep** read on opening Staking (one `drep_info` for its own ID): not a DRep, registered (with when it goes inactive, its voting power and delegators, and its profile's address), or retired.
- **Governance actions** are the same for everyone, so they're kept in `chrome.storage.local` per network for **an hour**, with a refresh. A DRep's own votes are read with them, fresh.
- Builds go through `StakingService` as every staking transaction does: the account and its `account_info` read fresh, plus `drep_info`, then built and signed in WebAssembly and kept until Send. New pending kinds: `drep-register`, `drep-update`, `drep-retire`, `drep-vote`.
- A vote for an action that has expired since the list was read is refused by the ledger; the submit error says to read the list again.

### 21a · UI

- **Staking page, a DRep card.** Not a DRep: what being one means, the 500 ₳ deposit and that it comes back, and **Become a DRep**. A DRep: its ID (to copy), active until epoch *n*, voting power and delegators, **Governance actions**, **Profile**, **Retire**.
- **Become a DRep:** the deposit, the self-delegation switch (on), an optional profile (name and bio, the file to save, its hash, and a field for where it's hosted), the privacy callout, review with Transaction details, Send.
- **Governance actions:** each live action with its title (or type, on preprod), when it expires, and this DRep's vote if it has one; its details (type, title, abstract, ID, deposit, a copy field for its anchor, a warning when Koios found the anchor didn't match its hash, the explorer link); **Yes**, **No**, **Abstain**; review; Send. Shown to a non-DRep too, read-only, with Become a DRep.
- **Retire:** the refund, and the vote moving to Always abstain when it was the account's own.
- **The privacy notes, as critical keys** (`.privacy.` and `.warn.`):
  - A DRep is public, and it's paid for from this account, so anyone can tie the DRep, and every vote it casts, to this account.
  - Every vote is public and permanent.
  - A profile is published at the address given, for anyone to read, tied to this account.
  - Money in Seedelf has no stake key, so it carries no voting power: making money private lowers the DRep's.
  - A DRep that doesn't vote or update for `drep_activity` epochs goes inactive, and its stake stops counting until it votes again.
- en, es and ja for every new string, the critical ones back-translated, as chunk 19 set up.

### 21b · CIP-95 in the connector

- `supportedExtensions: [{ cip: 95 }]`; `enable({ extensions: [{ cip: 95 }] })` asks for it, the approval window says what it gives (the DRep key, and signing with it), and `getExtensions` answers what was granted.
- `api.cip95`: `getPubDRepKey` (the bound account's), `getRegisteredPubStakeKeys` / `getUnregisteredPubStakeKeys` (its stake key in one list or the other, from `account_info`), and `signData` with a DRep ID as the signer.
- **`signTx` signs with the DRep key only for a site granted CIP-95**, and only when the transaction needs it: a DRep certificate or a vote by this account's DRep, or its key hash in `required_signers`. A CIP-30-only site asking for it is refused, in words to the user.
- The site stays bound to its account (chunk 18): the DRep key offered is that account's.
- Tested against GovTool on preprod by hand, the owner's call.

## Koios requests

| When | Requests |
|---|---|
| Opening Staking | **2** (was 1): `pool_info`, and `drep_info` for the account's own DRep |
| Governance actions | **1** `proposal_list`, then none for an hour; **+1** `drep_info` (its standing alone); **+1** `vote_list` for a DRep's own votes |
| A DRep or vote build | **5**: `account_addresses`, `credential_utxos`, `account_info`, `epoch_params`, `drep_info` |
| CIP-95's stake key lists | **1** `account_info` |

Nothing in the background, and nothing on Home.

## Tests and checks

- Core, WebAssembly (native and JS), worker and e2e tests as for every flow, the e2e asserting the exact Koios requests per screen.
- **A probe on preprod with no funds** (`tests/fixtures/probe-governance.mjs`, after chunk 13's `probe-staking.mjs`): every new kind of transaction decodes on the node's Conway decoder (Ogmios `evaluateTransaction` answers `[]`). It proves the bytes, not the ledger rules.
- **A live preprod run, the owner's to approve:** register (500 tADA, returned at the end), vote on a live action, update the profile, retire. It's what confirms the certificate order and what retiring does to the account's own delegation.

## Docs

privacy.md (*Known links*: the DRep and its votes tie to the account), flows.md (a Governance section), architecture.md (the voting-procedures patch, the DRep key), keys-and-accounts.md (role 3), the README, and the store listing's wording if the owner wants it to say so. The manifest doesn't change for 21a. The CSP doesn't either, since nothing new is fetched.

## Not in it

- **A rationale on a vote** (CIP-136 anchor). The vote's anchor is left empty; a later round can add one the way the profile works.
- **Script DReps, the constitutional committee, and pool votes.** A key DRep from the account only.
- **Proposing governance actions:** 100,000 ₳ on mainnet, and nothing a wallet's user needs.
- **Tallies per action** (`proposal_voting_summary`): one more request an action, worth it only if the owner wants it.
- **Paying for a DRep from a one-time account**, to keep the DRep apart from the account. Possible later; today the DRep is the account, and the notes say so.

## What was built

**21a, the wallet's own screens (2026-10-04).** Everything in *Scope* under 21a. Checked: `cargo test --workspace --locked` 502 passed (8 new), clippy and fmt clean; the WebAssembly's Node tests (a new one); Vitest 1,403 passed (21 new, in `governance.test.ts` and `governance-screen.test.ts`); Playwright 68 passed (two new: becoming a DRep with the account's own vote, and a DRep voting). The probe ([`tests/fixtures/probe-governance.mjs`](../../extension/tests/fixtures/probe-governance.mjs)) had preprod's node decode every kind: a registration with the account's own vote, with a profile and alone, and registering the stake key too; an update; a retirement moving the account's vote to always abstain; a vote on all seven live actions. Fees 0.17–0.18 ₳.

**Where it went differently from the plan:**

- **`proposal_list` can't be ordered by a column it isn't asked for.** Ordering by `block_time` with a `select` that leaves it out is a 400 from Koios (PostgREST's `column record.block_time does not exist`), so the list is the newest *proposed* first (`proposed_epoch.desc`). Found by the fixture recorder before the wallet ever sent it.
- **The Governance actions screen reads the DRep's standing too** (`drep_info`, with no profile check or deposit), so it's two requests, or three for a DRep, rather than the plan's one and one.
- **`drep_deposit` is optional in `ProtocolParameters`.** Every hand-written `epoch_params` row in the tests leaves it out, and only a registration needs it: that refuses without it, rather than every build failing.
- **The DRep key signs only when it must.** `Staking::signers()` counted "any certificate or withdrawal" as one key; it counts the stake key and the DRep key apart now (`stake_signs`, `drep_signs`), so a vote isn't signed by the stake key, and a registration with the account's own vote is priced and signed with both.
- **Activity names what the DRep did** from the same `tx_info`, now with `_governance`, at no extra request: **Became a DRep**, **Updated your DRep**, **Retired as a DRep**, **Voted** (with how many actions). Koios calls the certificates `drep_registration`, `drep_update` and `drep_retire`. The plan didn't have it; a registration would otherwise have read as 500 ₳ **Sent**.
- **A profile's address must start `ipfs://`, `https://` or `http://`**, besides the ledger's 128 bytes (counted as bytes, so a non-ASCII address is measured right): an address that names no scheme would be no use to anyone reading it.
- **An action's title and abstract are cleaned before they show:** control characters, direction overrides and isolates, and zero-width characters go; a title is cut at 200 characters and an abstract at 2,000. They're the proposer's words, and a direction override can make a line read as something else.
- **When an epoch ends is worked out on the device** (`epochStart`, from Shelley's start as `seedelf-core`'s `slot_config` has it), and shown in the device's own time zone, pinned to en-GB like every date in the wallet (chunk 19's known gap).
- **One Spanish fix from the blind back-translation:** `staking.warn.retireOwnVote` gained "como DRep", since "retirarte" (retiring as a DRep) and "retirando" (withdrawing rewards) are one verb. 128 new keys in each language, 8 of them critical, all eight back-translated by an agent that saw only the Spanish and Japanese.

**21b, CIP-95 in the connector (2026-10-04).** Everything in *Scope* under 21b, and Settings' *Connected sites* marks a site that has governance. Checked: `cargo test --workspace --locked` 510 passed (four new in `cip30_test.rs`: the DRep key signing the account's own registration and vote only with the grant, a retirement's refund counted, and data signed as the DRep by each form of its ID); Vitest 1,408 passed (five new in `dapp-governance.test.ts`); Playwright 69 passed (one new: a site asks for CIP-95, the window says what it gives, and the site gets the DRep key).

**Where it went differently from the plan:**

- **`enable()` still answers `true`.** What a site was given, `getExtensions()` says, as CIP-30 has it: the page asks it after `enable()` when the site asked for CIP-95, and only then adds the `cip95` namespace. Answering a list instead would have changed what every existing site hears.
- **A site without governance is told nothing of the DRep key, rather than refused for it.** WebAssembly is handed the DRep key's hash only for a site given governance; for any other, that key is a stranger's, so a transaction naming it needs "someone else's" signature and a message for it is no key of the account's. A refusal naming the DRep key would tell a site that never asked whose key it was.
- **`signData` takes the DRep two ways:** its ID (hex, CIP-129 or CIP-105) and the enterprise address of its key, which is how Lace and GovTool name it (Lace's `cip8-sign-data.ts`). The COSE `address` header carries the key hash, as Lace writes it.
- **A connected site asking for governance later gets a question of its own** (`connected: true`): **Allow** or **Cancel**, with the same privacy note. Declined, it isn't asked again for a minute, as a connect isn't; the site stays connected.
- **A session's WebAssembly entry points force `governance` off,** whatever the request says, so a private session can never sign with a DRep key, even one derived under its own account.
- **The sign window counted every signer that wasn't the stake key as a payment key**, which would have called the DRep key a payment key. It names the DRep key now, and the account's own votes get a privacy callout of their own instead of the plain note.
- **Two Spanish fixes from the blind back-translation:** the retirement sentences say "Da de baja tu DRep", where "Retira" read as withdrawing it, the verb withdrawing rewards uses; and the update sentence says "y así lo mantiene activo", so it's the update that keeps the DRep active.

