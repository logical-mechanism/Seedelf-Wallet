# Chunk 39 · Whose a proposal's deposit goes back to

Branch `web-wallet/proposal-deposit`, from `main`.

**Status: ✅ built 2026-10-31** on `web-wallet/proposal-deposit`, from `main` after #356. A patch, for 1.7.2 (the owner, 2026-10-31). One PR: the build, the translations and the docs together, so this file went straight to the archive, as chunks 36 and 37's did. What still holds is in [architecture.md](../../architecture.md) (the transaction view's marks, and the dApp prompt's X05 paragraph) and [flows.md](../../flows.md) (*Transaction details*, and the sign window). **The privacy policy is unchanged:** nothing new is asked of anyone or kept. *As built*, below, says where the build went past the plan or away from it.

**Why.** A bounty report against 1.7.1 (2026-10-31). A site's sign window shows a governance proposal only as a count: "It makes 1 governance proposal." When the action ends, the deposit (100,000 ₳ on mainnet) goes back to the reward address the proposal names, and the site can name anyone's. The report was out of the bounty's scope, since the sign window's **Transaction details** already lists each proposal's action, deposit and "Deposit back to" address. The owner thought the patch worth making anyway.

**What changes, in one line:** the wallet already *shows* the address, and this makes it *say whose it is*. Today the user has to compare a `stake1…` string with their own by eye. The wallet knows which stake keys are its own and does that comparison for every other place money goes in a site's transaction:

- an output says if it's the account's (`paid`, `ownPaymentKey`, `yours`);
- a certificate's deposit or refund and a withdrawal say whose stake key (`certificateLine`, `withdrawalLine`);
- the collateral says what's at risk after its return (`atRisk`).

A proposal's deposit is the one place money goes without that. Transaction details has the same gap: it tags an output that pays the user (`markYours`, `YoursTag`) but no reward address.

## 1 · WebAssembly: each proposal, not a count

`wasm/src/cip30.rs` `inspect_dapp_tx`: `proposals: usize` becomes a `Vec<Proposal>`:

- `action`: its kind, as `decode.rs` `proposal_detail` names it (`information`, `treasuryWithdrawals`, …). Share that match, don't write a second.
- `deposit`: lovelace, as a string.
- `address`: the reward account in bech32, or hex if it won't encode, as a withdrawal's.
- `own`: its stake key is the signing account's (`keys.stake`), as a withdrawal's `own` is. A script's is never own.
- `credential`: the stake key hash in hex, so the worker can find `yours` as it does for a certificate (X05).

A reward account on the other network is refused with a withdrawal's words, because the ledger refuses the proposal too (`ProposalProcedureNetworkIdMismatch`). Nothing else is refused: a deposit that goes back to someone else is legal and the user's to sign. The wallet refuses only what the ledger would (the owner, 2026-10-19).

## 2 · The sign window says where each deposit goes

`DappApprovals.tsx` `SignTx`: the count note (`dappUi.note.proposals_*`) goes. Each proposal gets a line in the callout the certificates and withdrawals share, from a `proposalLine` beside `certificateLine` in `ui/dapp.ts`:

- **the account's own:** "Proposes {{what}}. Its {{amount}} ₳ deposit comes back to {{whose}} when the action ends." (`whose` as for a withdrawal: the public account or the private session.)
- **another of the wallet's:** "… comes back to {{name}}'s stake key …", named by `yours`, never called a stranger's (X05).
- **anyone else's:** "Proposes {{what}}. Its {{amount}} ₳ deposit goes to a stake key that isn't yours, {{address}}, when the action ends." The whole address.

The callout is a warning whenever a line isn't the account's own, as it is for a stranger's certificate. The deposit is already in the total that leaves (`netLovelace`), and the line says it's a deposit and where it comes back.

The worker resolves `yours` for a proposal's credential the way it does for a certificate's. The keys are `.warn.`, so the critical-set guard tests cover them, in en, es and ja, back-translated.

## 3 · Transaction details marks the user's reward addresses

`background/tx-view.ts` `markYours` marks outputs by their payment key. It now also marks a withdrawal's address and a proposal's "Deposit back to" by their stake key: the active account's, a session's, then each other account the wallet knows. `TxDetail.tsx` shows `YoursTag` beside each, as it does beside an output. That needs a `yours` on both in `rpc.ts`, and the proposal's reward account rendered on its own rather than through `Fields`. It applies to every transaction view, not only a site's. A certificate's stake key stays as it is, since the summary already says whose it is.

## Tests

- `wasm/tests/cip30_test.rs`: one proposal with the account's reward address, a stranger's, a script's, the other network's (refused), and two in one transaction.
- **The report's own transaction as a fixture:** preprod `8751ca96591ae84d16c35d0d232c1b24f1c846bc31a602c6f9eb492567fb99a8` (the plan had `…f1b846…`, one character off), block 5354141. Its CBOR is read from Koios once and kept. Its deposit goes back to a stranger's key.
- `dapp.test.ts`: `proposalLine`'s three cases. A `DappApprovals` test checks the lines and the callout's tone.
- The tx-view tests: `markYours` tags a withdrawal and a proposal's deposit back, for the active account, a session and another account.
- e2e, if the fake site can send a proposal: one run with a stranger's return address, showing the warning.
- [flows.md](../../flows.md)'s sign window says what the summary shows, in the same PR.

## Not in it

- No refusal and no extra confirmation for a stranger's return address: it's shown, never blocked.
- The wallet's own proposal screens stay out ([backlog.md](../../backlog.md#declined)'s *The rest of governance*).
- Other voters' votes stay a count: no money moves with them.
- No new requests and no data layer change, so no privacy policy entry and no API deploy. The release cycle is merge → package → upload → record PR, tagged `web-wallet/1.7.2`.

## As built

- **WebAssembly** (`wasm/src/cip30.rs`): `TxSummary.proposals` is a `Vec<Proposal>` (`action`, `deposit`, `address`, `own`, `credential`). The kind comes from `decode.rs`'s new `action_kind`, which `proposal_detail` now names its action by too: one match for the names. A proposal adds no signer and nothing to the staking money, since the deposit leaves with the account's UTxOs and is already in the total. Refused, besides the other network: a reward account that's no address, or no reward address, which the ledger can't decode either (a withdrawal's are refused the same way). `tied`, the check that a transaction names its network, doesn't count a proposal, though the ledger would let it: unchanged, and not needed.
- **The sign window** (`ui/dapp.ts` `proposalLine`, `DappApprovals.tsx`): as planned, with "the stake key of {{name}}" for another of the wallet's, worded as the certificate's line is. `proposalWords` moved from `TxDetail.tsx` to `ui/format.ts`, beside `voteLabel`, so the helper doesn't import a component; its seven `tx.proposal.*` names are `SHARED_WORDS` in the critical-helpers guard, as the vote labels are: Transaction details shows them on their own.
- **The callout's tone:** a warning when any proposal's deposit isn't the account's own. The plan said "as it is for a stranger's certificate", but it isn't: a stranger's certificate alone leaves the callout informational, as it did before. Unchanged here; the owner's call.
- **Ties** (`background/dapp.ts` `ties`): a proposal's stake key is matched as a certificate's, named by `yours`, and put in `certified`, whose warning now reads "A certificate, withdrawal or proposal in it names the stake key of …" in all three languages. Without that, a proposal back to a session's key would have let the window say the private balance isn't in it (X05's bug, again).
- **Transaction details** (`tx-view.ts` `markYours`, `TxDetail.tsx`): as planned. "Deposit back to" is its own line, the address whole with a copy button, and the tag under it; the proposal's other fields still come from `Fields`.
- **Translations:** the three lines and the widened certified warning were back-translated blind, a fresh agent each round with no English. Round one corrected Spanish "Su depósito", which beside the informal "tuya" could read as the site's own deposit (now "El depósito … de la propuesta"), and Japanese bare アクション, which could read as the signing itself (now ガバナンスアクション); Spanish says "la acción de gobernanza" to match. Round two kept every clause; a comma after 終わると fixed a garden path in the Japanese stranger's line. Recorded in `verified-critical-es.json` and `-ja.json`.
- **Tests:** `cip30_test.rs` (one transaction with the account's, a stranger's and a script's, each with its kind; the other network refused; the report's transaction against Koios's own reading of it, `fixtures/proposal-report-preprod.json`), `dapp.test.ts` (`proposalLine`'s cases), `dapp-prompt.test.ts` (the lines and the tone), `dapp-ties.test.ts` (a session's stake key named and tied through the worker, a stranger's tying nothing), `tx-view.test.ts` (a withdrawal and proposals marked for the active account, a session and another account), `tx-view-screen.test.ts` (the tags and the one "Deposit back to"), and one e2e run, a site's proposal back to a stranger's key: the warning, the whole address, and Transaction details' line. Four runs each on 2 CPUs, dev and store builds: all passed.
