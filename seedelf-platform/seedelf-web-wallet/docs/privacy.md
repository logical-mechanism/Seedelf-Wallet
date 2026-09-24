# Privacy

The protocol-level analysis lives in the root [README](../../../README.md#what-is-a-stealth-wallet): stealth addresses, re-randomization, and the known de-anonymizing attacks. This doc covers what the web wallet has to do on top of that.

## What is hidden and what isn't

**Hidden:**

- **Who owns a UTxO.** Registers are re-randomized, so they can't be linked back to a user. This relies on ECDDH.
- **Who spends it.** Spends use a Schnorr proof, a fresh one-time signing key and shared collateral.

**Visible:**

- **Amounts and tokens.** Seedelf does not hide or mix value.
- **The transaction graph and timing.**
- **Which normal addresses paid into or received from the contract,** such as the Cardano account and one-time accounts.
- **Everything the Cardano account does,** staking included: its pool, where its vote goes, and its rewards.
- **The user's IP address,** as seen by Koios and giveme.my.

## Rules the wallet enforces

These are not user settings:

1. **A new one-time signing key for every Seedelf spend.**
   - The CLI draws it at random (`transfer.rs`, `sweep.rs`, `util/mint.rs`).
   - The web wallet derives it inside WebAssembly from the Seedelf key and a fresh random seed, so it survives a worker restart between review and Send without ever reaching JavaScript. A new seed gives a new key (see [architecture.md](architecture.md#transaction-building)).
2. **Seedelf spends take their collateral from the shared giveme.my service,** never from a user UTxO. A user's own collateral would tag every private spend with their address.
3. **Re-randomization scalars (`d`) are toxic waste.**
   - They are full-size and come from a secure random source.
   - They are never stored or logged.
   - They exist only inside `seedelf-crypto`.
4. **Registers are only built by `seedelf-crypto`,** never assembled in TypeScript. This guarantees the same `d` is applied to both points and that the points are torsion-free. A mistake here locks funds permanently (see the root [CLAUDE.md](../../../CLAUDE.md), "Core protocol invariants").
   - A payment to someone's seedelf goes under a fresh re-randomization of their register, never the register as found.
   - The wallet refuses to pay a register whose points don't decode, lie outside the prime-order subgroup, or are the identity. A payment to any of those is locked for good, or anyone can take it.
5. **A seedelf is linked to whatever pays for it, so the first one is minted before any move-in** (see [flows.md](flows.md#create-a-seedelf)).
   - **By default the Cardano account pays** (chunk 8b), and the Cardano card says to create a seedelf before moving money in.
   - **A stealth mint from the Seedelf balance is the other choice.** It hides the payer only when that balance came from other people's Seedelf payments. For it, the mint service passes only Seedelf UTxOs to WebAssembly, and WebAssembly refuses any it doesn't own.
   - This rule used to say "stealth mint from the Seedelf balance, never paid by the Cardano account". That was wrong whenever your own move-in funded the balance: the mint spends that deposit and ties the account, the name and the mint's change together.
6. **The Cardano account is never a one-time account.** Each one-time account is used for a single session. One-time accounts use a reserved account index (`24301'`), never a low index like `1'` that a restored Lace wallet may already use: sharing payment keys with a real account would link every one-time address back to the user.
7. **No analytics or telemetry.** The wallet talks to Koios and giveme.my and nothing else.

## Known links

The wallet can't prevent these, so it should make them visible to the user instead of hiding them.

- **Entry:** move-in links the Cardano account, and whoever funded it, to the register UTxOs it created. For a restored Lace or Yoroi phrase, the Cardano account is the user's public identity.
  - A move-in on its own doesn't link to a seedelf name: from outside it looks the same as paying someone else's seedelf.
- **Minting:** a seedelf is linked to whatever pays for it.
  - **Stealth mint from moved-in money:** the mint spends the deposit and returns the change in the same transaction. That links the account, the name and the remaining balance.
  - **Mint paid by the account, then move in:** only the account and the name are linked. The balance stays ambiguous. This is the default.
  - **Stealth mint from received money:** hides the payer. That's the case the stealth mint is for.
- **Exit:** withdrawing to where the money came from re-links the chain. This is the second implicit tracking method in the root README. Withdraw somewhere else, or keep the funds in Seedelf.
  - The withdraw form says so. It warns when the destination is this wallet's own Cardano account (any address carrying its staking key): that links the account to the Seedelf UTxOs spent, and so to whoever paid them in.
  - **Max** spends up to 20 UTxOs in one transaction, which ties them together (see *Co-spending*).
- **Sending from the Cardano account** (chunk 12) is an ordinary Cardano payment: anyone can see it came from the account, and so from whoever funded it. It doesn't touch Seedelf. The form says so, and that paying from the Seedelf balance instead avoids the link.
- **Removing a seedelf:** its ADA goes somewhere, and that's linked to the seedelf's name.
  - By default it goes to the Cardano account, which a mint-first seedelf is linked to already.
  - Back into the Seedelf balance, it ties the name to that new UTxO, and to whatever it's later spent with. That's the right place only for a seedelf the Seedelf balance paid for (a stealth mint).
- **Unique amounts and timing:** depositing 1,234.567 ADA and withdrawing roughly 1,234.4 ADA an hour later is an easy match. The UI should nudge users towards round amounts and not rushing.
- **Transfer:** the payment can't be linked to the recipient's seedelf. The payer's side is an ordinary spend, though.
  - Its inputs, and the change in the same transaction, trace back through the transaction graph to where that money came from.
  - If you moved the money in yourself, the chain leads from your Cardano account to this payment, though not to your seedelf's name, nor to the recipient's.
  - Its amount and timing are public. Sending right after a move-in is easy to match by timing, and the form says so.
  - Paying your own seedelf is allowed, but it only moves money in a circle.
- **Co-spending:** spending several UTxOs in one transaction suggests they share an owner.
  - Coin selection should spend as few inputs as it can.
  - It should avoid mixing funds with different histories, such as round-trip returns and fresh deposits, when it doesn't need to.
  - **Locking a UTxO** (chunk 12) keeps it out of every spend, Max included, so a user can keep such funds apart by hand.
- **The one-time account's staking part (decided): the shared Seedelf staking hash,** the same as the CLI's External Wallet (`seedelf-core/src/address.rs`, `dapp_address`).
  - dApps see a normal base address, and the staking part doesn't identify the user.
  - The trade-off is that it marks the address as a Seedelf address.
  - Any rewards on that credential go to whoever holds it, not to the user. That's fine for money passing through, but the UI should say so.
- **Crowd size:** privacy grows with the number of honest users (the flood-attack section of the root README). With few users, timing and amounts carry most of the risk. The wallet should say that plainly and not overpromise.
- **Network:** Koios and giveme.my see the user's IP address, and Koios has no Tor access. A VPN helps; see the root README's IP-tracking section.
  - A balance reading asks Koios about the Cardano account and the whole wallet contract at the same moment (between full reads, the part of it after the last block seen). Koios can tell that the account's owner uses Seedelf, though not which contract UTxOs are theirs: the ownership check runs in the extension, on every row.
  - The wallet only reads the chain when Home opens (at most once a minute) or on Refresh. It never polls in the background.
  - **Token names and logos come from a list inside the extension** (`src/tokens/`, refreshed at each release). Asking Koios about the tokens in the Seedelf balance would tell it which contract UTxOs are yours, so the wallet never does.
  - **Finding a recipient** uses the contract as the balance reading sees it, and picks the seedelf's UTxO in the extension. The wallet never asks Koios about the recipient's token (`asset_utxos` and the like): that would tell Koios exactly who is being paid.
  - **An ADA Handle can't be found that way:** withdrawing or sending to `$name` asks Koios who holds that handle (`asset_nft_address`), so Koios learns it. The transaction names the address anyway once it's submitted. Pasting the address instead asks Koios nothing.
- **On this device:** which contract UTxOs are the user's is kept only in memory and `chrome.storage.session`, never on disk unencrypted, and the session copy is wiped on lock.
  - **Contacts** (who the user pays), the Seedelf history, and **the UTxOs the user locked** (with the collateral chosen) are kept on disk, but **never unencrypted** (decided in chunk 12): sealed under a key derived from the phrase, unreadable while locked, deleted with the wallet. Saving or checking a contact, or locking a UTxO, asks no one anything.
  - **The UTxOs screen** lists the Seedelf UTxOs by outpoint, from the last reading. It says that looking one up on an explorer tells that site which UTxO you care about.
- **The Cardano account's collateral** (chunk 12) is only ever put up by what the account signs anyway (an account-paid mint). Seedelf spends never use it: giveme.my lends theirs (rule 2), so no UTxO of the user's tags a private spend. Setting one by payment is a 5 ₳ payment from the account to itself, in the open.
- **Staking and voting** (chunk 13) are the Cardano account's, and public, as in any wallet: the pool, the vote delegation, the rewards and every withdrawal name the account's stake key. The Staking page, the vote page and each review say so.
  - **Seedelf money can't be staked.** It has no staking part, so it earns nothing while it's in Seedelf, and no stake key links a user's seedelfs. The Staking page says so.
  - **Rewards spent along with a payment** (on by default, a Settings switch) add a withdrawal to a send, a move-in or an account-paid mint. It names the stake key, which the account's base addresses carry anyway, so it links nothing new. A move-in with rewards moves them into Seedelf with the rest.
  - **What Koios learns:** every balance reading asks for the account's `account_info`, and its pool's `pool_info` once a session. The pool list is the same for everyone and kept on the device for a day. Searching DReps asks no one: the list of named DReps ships with the wallet. Picking one reads it from Koios, which then knows which one you're considering, as delegating to it will tell everyone.
  - **Nothing from anywhere else:** a DRep's metadata is read through Koios, its name only. Its image, which could be on any site, is never fetched.

## Holding and staking

Seedelf funds sit at an address with no staking part, so they earn no staking rewards. That's the cost of not linking a user's seedelfs through a staking key. Since chunk 13, money that sits can stay in the Cardano account, staked with a pool, and move into Seedelf when it should move privately.
