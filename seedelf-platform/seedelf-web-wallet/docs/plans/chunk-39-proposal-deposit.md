# Chunk 39 · Whose a proposal's deposit goes back to

Branch `web-wallet/proposal-deposit`, from `main`.

**Status: ⬜ planning.** A patch, for 1.7.2 (the owner, 2026-10-31). Nothing is built yet.

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
- **The report's own transaction as a fixture:** preprod `8751ca96591ae84d16c35d0d232c1b24f1b846bc31a602c6f9eb492567fb99a8`, block 5354141. Its CBOR is read from Koios once and kept. Its deposit goes back to a stranger's key.
- `dapp.test.ts`: `proposalLine`'s three cases. A `DappApprovals` test checks the lines and the callout's tone.
- The tx-view tests: `markYours` tags a withdrawal and a proposal's deposit back, for the active account, a session and another account.
- e2e, if the fake site can send a proposal: one run with a stranger's return address, showing the warning.
- [flows.md](../flows.md)'s sign window says what the summary shows, in the same PR.

## Not in it

- No refusal and no extra confirmation for a stranger's return address: it's shown, never blocked.
- The wallet's own proposal screens stay out ([backlog.md](../backlog.md#declined)'s *The rest of governance*).
- Other voters' votes stay a count: no money moves with them.
- No new requests and no data layer change, so no privacy policy entry and no API deploy. The release cycle is merge → package → upload → record PR, tagged `web-wallet/1.7.2`.
