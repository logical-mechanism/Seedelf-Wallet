# Chunk 28 · The public Activity's blind spots

[O7](../../post-release-roadmap.md#owed): the public Activity listed by stake address (`account_txs`) while the balance reads by payment key (`credential_utxos`), so a transaction touching only an enterprise address of the account, or its key under someone else's stake key, was counted and spent but never listed, nor in the CSV. And a Lovejoin mix from the public account listed its deposit and every mix as plain **Sent**, since an account transaction's kind came only from the private history (chunk 16's *Not done*).

**Status: ✅ built 2026-10-11** on `web-wallet/activity-blind-spots`, from `main` after #299. One PR: the plan, the build and the docs together, so this file went straight to the archive. What still holds is in the design docs: [flows.md](../../flows.md) (Activity's *Cardano account*), [architecture.md](../../architecture.md) (Activity), [privacy.md](../../privacy.md) (*When the wallet reads*), and the data layer's [README](../../../../../seedelf-data/README.md#the-public-routes). The privacy policy is unchanged: Activity sends the server the account's keys, which the balance reading already sends, and the policy's *Your addresses, balances and transactions* covers both.

## 1 · List by payment key, as the balance counts

**`credential_txs` replaces `account_txs` in Activity.** Koios's `credential_txs` takes payment credentials and answers in `account_txs`'s shape, with the same `order`, `offset` and `limit`, and `_after_block_height` (checked on preprod, 2026-10-11). Activity asks it about the account's payment keys in range, the ones the last balance reading asked `credential_utxos` about (`AccountAddresses.keys`): every transaction that made or spent an output under one of them, whatever the address's staking part. That's exactly what the balance counts.

- **Nothing new is told.** The same server already gets the same keys from the balance reading, together, from the same IP. `account_txs` named the stake address, which `account_addresses` sends anyway.
- **What `account_txs` listed that this doesn't:** a transaction that touched an output carrying the stake key but no payment key of the account's: someone paying their own key under our stake key, which `describe` already leaves out; or one that only certified or withdrew with the stake key while paying from keys outside the range (another wallet with the same phrase, past the gap), which the balance doesn't count either. Nothing the wallet itself sends: every one of its public transactions spends the account's keys.
- **More than 75 keys** (`CREDENTIALS_PER_REQUEST`, Koios's 5 KB body cap) go in groups, one request a group. A page is the newest 20 of the groups' pages merged (`takePage`), each group's offset moved by what it gave that page, and a transaction under keys in two groups is listed once. Rows past the page's last stay unread and are asked for again with the next page. (1.5.0's release review, C03: the catch-up also moved each offset by the newcomers it listed, which a Load more that read a page they pushed down had counted already, so a group skipped a row once a transaction landed between reads; and a Load more that took one group's newcomer moved the newest block read past another group's. Now a catch-up moves no offset, so what it lists past the pages read comes back on the next page as listed, a short page and none skipped, and Load more keeps the newest block read. Opening it again asks each group from 100 blocks under the newest block read (`CATCH_UP_MARGIN`), so a transaction a server behind another's missed is read once that server has caught up: C33. The release review's fix first kept each group's hashes read, `seen`, in place of the offsets; a Load more answered by a server behind then cut every later page of that group short for the session, and at 20 Load more never ended, so the offsets came back: 1.5.0's cross-area review, X08. 1.5.0's last review then had a page with nothing new read on, up to ten pages a press, where a re-open after a public mix had cost five or six presses that listed nothing (L7), and had a page take none older than the last row of a group's whole page, since with two groups a Load more after a catch-up listed another group's older transactions ahead of the first group's newer ones (L8).) One group, the usual case (the wallet uses index 0 on both chains: 42 keys), costs what `account_txs` did.
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
| is paid | yes | no | `lovejoin-withdraw` | **Back from Lovejoin** (a box spent into the account: its own, withdrawn through another app with the same phrase, or one someone paid from their own box, which the chain can't tell apart) |

- **Someone else's key beside the box** (1.5.0's release review, C22): an account-paid transaction that also pays someone, or someone's own box whose fee their wallet paid, is **Sent** or **Received**, named with them, never the box. A script beside the box, such as Lovejoin's fee shard, isn't someone's key, so a deposit through Lovejoin's own site still reads **Into Lovejoin**.
- A deposit reads as what went into the boxes, "−30 ₳", the fee apart; a mix as its fee alone, since it pays the account its change back.
- The private history's own entry still wins (`own`), and these come before the staking names.
- `lovejoin-deposit` and `lovejoin-round` are Activity's kinds alone (`ActivityEntry.kind`), not a pending transaction's. The deposit takes the title the public mix's own watch already had, **Into Lovejoin**; **Lovejoin mix** is the one new string (es "Mezcla en Lovejoin", ja "Lovejoin のミックス", machine-translated as the rest). Both have Lovejoin's shield icon.
- The pending list already leaves a chain's transactions out (`reserved`); once Koios lists them they read as above.

## Cost

| | Requests |
|---|---|
| A page, up to 75 keys | 1 `credential_txs` and 1 `tx_info`, as before |
| Each further 75 keys | 1 more `credential_txs` a page, and a catch-up |
| Opening it again (the catch-up) | 1 `credential_txs` a group, from 100 blocks under the newest block read since 1.5.0's release review (C33), and `tx_info` only for transactions it finds that aren't listed |
| Naming a Lovejoin transaction | none |

## Tests

- `tests/activity.test.ts`: the pages ask `credential_txs` with the reading's keys; a payment to an enterprise address of the account, and one under someone else's stake key, are listed and in the CSV; past 75 keys, two requests a page, each page the newest 20 of both groups, none skipped or listed twice; other keys start the pages again; `takePage` against 130 transactions in three overlapping groups (both fail if each group's offset moves by its whole page); a deposit, a mix, a seed and a box back named, with their amounts and CSV rows; the private history's entry first, and someone else's mix left out.
- `tests/accounts-switch-reading.test.ts`, `e2e/extension.spec.ts`: the request's new name.
- **Added in 1.5.0's release review:** `tests/activity.test.ts`'s pages as transactions land, one group's server behind another's, a box beside someone else's key (C03, C33, C22). The recorded fixture was `account_txs`'s answer served as `credential_txs`, with no `cred`, so the recorded account's tests matched by address: it's now `credential_txs`'s answer for the reading's 44 keys, `cred` kept, which lists a payment to the account's enterprise address the old one lacked (C43). 1.5.0's cross-area review added one short page, then whole ones, after a Load more a server behind answered, and Load more coming to an end when that server was 21 transactions behind (X08). 1.5.0's last review added reading on past what opening it again listed after a public mix, at most ten pages a press, two groups listing the newest of both after a catch-up, and `takePage` leaving no newer one out however far a catch-up listed (L7, L8).
- `seedelf-data`: the route's grammar (`public_grammar.rs`), and a live check (`live_public.rs`) that an account's payment keys list only transactions under them, every one of its stake key's newest that is, and that the next page and the answer from a block carry on from the first.

## Left for later

- **An account's own transactions past the gap** (another wallet with the phrase, its keys beyond 20 unused) are neither counted nor listed, as before.
- **A sent chain's audit** ([the owner's question 4](../../post-release-roadmap.md#open-questions-for-the-owner)) can now be answered in Activity for a public mix, whose transactions are named; a session's mix is the one-time account's, and isn't in Public activity.
