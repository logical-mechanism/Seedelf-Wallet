# Chunk 28 · The public Activity's blind spots

[O7](../../post-release-roadmap.md#owed): the public Activity listed by stake address (`account_txs`) while the balance reads by payment key (`credential_utxos`), so a transaction touching only an enterprise address of the account, or its key under someone else's stake key, was counted and spent but never listed, nor in the CSV. And a Lovejoin mix from the public account listed its deposit and every mix as plain **Sent**, since an account transaction's kind came only from the private history (chunk 16's *Not done*).

**Status: ✅ built 2026-10-11** on `web-wallet/activity-blind-spots`, from `main` after #299. One PR: the plan, the build and the docs together, so this file went straight to the archive. What still holds is in the design docs: [flows.md](../../flows.md) (Activity's *Cardano account*), [architecture.md](../../architecture.md) (Activity), [privacy.md](../../privacy.md) (*When the wallet reads*), and the data layer's [README](../../../../../seedelf-data/README.md#the-public-routes). The privacy policy is unchanged: Activity sends the server the account's keys, which the balance reading already sends, and the policy's *Your addresses, balances and transactions* covers both.

## 1 · List by payment key, as the balance counts

**`credential_txs` replaces `account_txs` in Activity.** Koios's `credential_txs` takes payment credentials and answers in `account_txs`'s shape, with the same `order`, `offset` and `limit`, and `_after_block_height` (checked on preprod, 2026-10-11). Activity asks it about the account's payment keys in range, the ones the last balance reading asked `credential_utxos` about (`AccountAddresses.keys`): every transaction that made or spent an output under one of them, whatever the address's staking part. That's exactly what the balance counts.

- **Nothing new is told.** The same server already gets the same keys from the balance reading, together, from the same IP. `account_txs` named the stake address, which `account_addresses` sends anyway.
- **What `account_txs` listed that this doesn't:** a transaction that touched an output carrying the stake key but no payment key of the account's: someone paying their own key under our stake key, which `describe` already leaves out; or one that only certified or withdrew with the stake key while paying from keys outside the range (another wallet with the same phrase, past the gap), which the balance doesn't count either. Nothing the wallet itself sends: every one of its public transactions spends the account's keys.
- **More than 75 keys** (`CREDENTIALS_PER_REQUEST`, Koios's 5 KB body cap) go in groups, one request a group. A page is the newest 20 of the groups' pages merged (`takePage`), each group's offset moved by what it gave that page, so a group never skips a row and a transaction under keys in two groups is listed once. Rows past the page's last stay unread and are asked for again with the next page. One group, the usual case (the wallet uses index 0 on both chains: 42 keys), costs what `account_txs` did.
- **The pages keep the keys they were read by.** A reading that finds other keys (an address used past the range) starts the pages again, from the first: the offsets read by one set of keys say nothing of another's.
- **The data layer's `credential_txs` route** is built as its `account_txs` is (the newest ids a page needs, widened to their oldest block), up to 75 credentials, as `credential_utxos` takes. Its outputs are gathered address by address under the credentials, never all the addresses first, and capped at 200,000 as `account_txs`'s are, so a busy script credential can't make it read millions of addresses.
  - **It counts before it gathers,** from `tx_out`'s index alone, in the same query (`gate`, a one-time filter Postgres checks before the gathering runs): Minswap V2's pool script is refused in 0.1 s, against 4.9 s gathering its outputs to find out. A first build ran the count as a query of its own, for `account_txs` too, which cost every Activity page a round trip more from the VPS to home; `account_txs` is back as it was, query and flow, so deploying the API changes nothing a 1.4.x wallet asks.
  - **Checked against mainnet Koios** through a local run on home's db-sync: the same rows for a wallet's key, and for the contract's and the mix box's credentials together at offsets 0 and 20.
  - **The API is deployed before the wallet is uploaded,** as every release does it: a wallet asking a server without the route gets a 404, which puts its public part on Koios for 5 minutes. `account_txs` stays, for the restore scan and for wallets up to 1.4.1.

## 2 · Name a public mix from the transaction itself

**From the chain, not from records.** A chain's record (`ChainRecord`) goes about an hour after its mix ends, and a restore has none. But a mix's transactions say what they are: Lovejoin's `mix_box` script (`NETWORKS[network].lovejoin.mixBox`) is among their inputs or outputs, and `tx_info` gives every input's and output's payment credential. So `describe` names them, with no request and no record, after a restore too, and for mixes sent before this change:

| The account | Boxes in its inputs | Boxes in its outputs | Kind | Title |
|---|---|---|---|---|
| paid | no | yes | `lovejoin-deposit` | **Into Lovejoin** (the deposit, or a seed) |
| paid | yes | yes | `lovejoin-round` | **Lovejoin mix** (one of a chain's mixes) |
| is paid | yes | no | `lovejoin-withdraw` | **Back from Lovejoin** (a box withdrawn to the account, by another app with the same phrase) |

- A deposit reads as what went into the boxes, "−30 ₳", the fee apart; a mix as its fee alone, since it pays the account its change back.
- The private history's own entry still wins (`own`), and these come before the staking names.
- `lovejoin-deposit` and `lovejoin-round` are Activity's kinds alone (`ActivityEntry.kind`), not a pending transaction's. The deposit takes the title the public mix's own watch already had, **Into Lovejoin**; **Lovejoin mix** is the one new string (es "Mezcla en Lovejoin", ja "Lovejoin のミックス", machine-translated as the rest). Both have Lovejoin's shield icon.
- The pending list already leaves a chain's transactions out (`reserved`); once Koios lists them they read as above.

## Cost

| | Requests |
|---|---|
| A page, up to 75 keys | 1 `credential_txs` and 1 `tx_info`, as before |
| Each further 75 keys | 1 more `credential_txs` a page, and a catch-up |
| Naming a Lovejoin transaction | none |

## Tests

- `tests/activity.test.ts`: the pages ask `credential_txs` with the reading's keys; a payment to an enterprise address of the account, and one under someone else's stake key, are listed and in the CSV; past 75 keys, two requests a page, each page the newest 20 of both groups, none skipped or listed twice; other keys start the pages again; `takePage` against 130 transactions in three overlapping groups (both fail if each group's offset moves by its whole page); a deposit, a mix, a seed and a box back named, with their amounts and CSV rows; the private history's entry first, and someone else's mix left out.
- `tests/accounts-switch-reading.test.ts`, `e2e/extension.spec.ts`: the request's new name.
- `seedelf-data`: the route's grammar (`public_grammar.rs`), and a live check (`live_public.rs`) that an account's payment keys list only transactions under them, every one of its stake key's newest that is, and that the next page and the answer from a block carry on from the first.

## Left for later

- **An account's own transactions past the gap** (another wallet with the phrase, its keys beyond 20 unused) are neither counted nor listed, as before.
- **A sent chain's audit** ([the owner's question 4](../../post-release-roadmap.md#open-questions-for-the-owner)) can now be answered in Activity for a public mix, whose transactions are named; a session's mix is the one-time account's, and isn't in Public activity.
