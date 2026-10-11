# Chunk 27 · The restore scan

[O5](../../post-release-roadmap.md#owed): after a restore, or with the same phrase in another browser, what a private session's one-time account (`24301'`) still holds didn't show, and Remove wallet and Forgot password said so (independent review M5). That warning was the promise this keeps.

**Status: ✅ built 2026-10-11** on `web-wallet/restore-scan`, from `main` after #298. One PR: the plan, the build and the docs together, so this file went straight to the archive. What still holds is in the design docs: [keys-and-accounts.md](../../keys-and-accounts.md#accounts) (*The restore scan*: what it asks, what it can't find), [flows.md](../../flows.md) (the restore's note, the dApps page, Remove wallet, Forgot password, a stalled session), [privacy.md](../../privacy.md#known-links) and [architecture.md](../../architecture.md#private-sessions). The privacy policy has its dated entry.

**Why now:** the design was settled in chunk 22 and waited on what it would tell Koios: every one-time account asked about together, from one IP address. On mainnet that question goes to our own server since 1.4.0, which logs neither, and every route the scan needs was already one of its public routes (`account_addresses` for 20 stake keys, `credential_utxos`, `account_txs`, `tx_info` with its outputs' indexes, `utxo_info`, `datum_info`, `address_utxos`). No server change.

## What it does

`SessionService.scan(network)` (`sessions.ts`), the `session-scan` request:

1. **Walks the one-time stake keys** (`2/i`) from 0, 20 at a time (`account_addresses`), until a batch has none used.
2. **For the used ones the book doesn't know:** what they hold (`credential_utxos`); each one's transactions (`account_txs` with `_after_block_height: 0`, one request an account); what those spent and paid (`tx_info`, inputs alone, whose outputs come with them).
3. **Their orders, through the swap that placed them:** each output the account's key-signed transactions paid to an order script `orders.json` pins, read by `readDexOrder` as the account's (`utxo_info`, `datum_info` for a datum kept by hash). Then `liveOrders` on the record decides which are open, a Splash fill's remnants too.
4. **Adds a session found** (`recovered: { at, own }`) for each that holds something or has an order open: its funding (the oldest transaction) as `out`, its swaps as `swap` with their orders, and what its key signed as `own`, which its return counts as the session's own. One holding nothing, with no order open, isn't added.
5. **Moves the book's `next`** past every used index. The merge is into the book as it is once everything's read, so a session started meanwhile keeps its index; one scan a network at a time.

It runs **after a restore** (in `handlers.ts`, behind the look for public accounts, on the network restored on) and from **Find leftovers**.

## Choices made here (the owner can overturn any)

- **A found session comes back by hand.** What it was for isn't known, so it has no `auto`, `swap`, `site` or `mix`; its page is the one sessions from before swaps ran themselves have (Swaps.tsx's `Session`), without Place the order: Cancel the order while one is open, Bring it back, or Bring everything back. Nothing runs by itself: the phrase may still be open in another browser whose swap or site uses the account, and its page says so (`swaps.warn.found`).
- **It's listed on the dApps page, under After a restore**, with Find leftovers beneath, not on Minswap's page: a found site's or mix's session isn't a swap. Its row is "Private session N", its page's aside *Found after a restore*. Bring everything back takes it when it holds money.
- **Find leftovers is on the dApps page**, where private sessions live, with its privacy note above the button: "It asks the server about your one-time accounts 20 at a time, so the server can tell they're one wallet's."
- **A restore scans the network it's made on, once.** The other network, or the phrase used in another browser since, needs the button.
- **The restore's note on Home** adds "The restore also found 2 private sessions from before: bring them back on the dApps page." once the scan has written them (Home reads the sessions every 20 s).
- **Sessions the book knows are skipped, closed ones too.** A closed session whose account was paid again isn't reopened: its record's fields (`auto` above all) would start it running.
- **Remove wallet and Forgot password** now count "private sessions' money" among what the phrase brings back; *something no return takes is left in …* lost its "A restore won't show it yet."; a found session is named "(found after a restore)" in Remove wallet's list.

## Cost

| | Requests |
|---|---|
| A phrase that never used a one-time account | 1 (`account_addresses`) |
| Each further batch of 20 indices | 1 |
| The used ones the book doesn't know | 1 `credential_utxos` per 75, 1 `account_txs` each, 1 `tx_info` per 20 of their transactions |
| Where those paid an order script | 1 `utxo_info`, 1 `datum_info` for a datum kept by hash, and 1 `utxo_info` per account with orders (`liveOrders`), plus a Splash order's remnant look |

A restore of a phrase with no sessions spends one request on it (the restore's e2e test counts it).

## Tests

- `tests/restore-scan.test.ts`: nothing used (one request, nothing written); an account holding money (found, listed with its holding before any refresh, brought back, taken by Bring everything back, named in Remove wallet's list); an order open with nothing at the account (found through its swap; only the order output asked about; listed; Bring everything back skips it); a found order cancelled by the wallet's own cancel; used accounts holding nothing (not added, `next` past them, the next session asks about one index alone); the book's own sessions skipped and a session started mid-scan kept; two scans at once sharing one.
- `e2e/extension.spec.ts`: a restore's requests (three `account_addresses` now), and Find leftovers on the dApps page.
- `tests/remove-wallet.test.ts`: the new notes, and a found session's name.

## Left for later

- **A found session whose account holds no ADA alone can't cancel its open order**: the wallet's own cancel needs one of the account's UTxOs as collateral. A top-up for found sessions would mend it ([Kept in mind](../../post-release-roadmap.md#kept-in-mind)).
- **What it can't find:** a session from before chunk 15b (the shared staking part: preprod, before any release), and an index past a run of 20 unused.
- **A scan a lock or a worker stop cuts off** writes nothing; Find leftovers runs it again.
