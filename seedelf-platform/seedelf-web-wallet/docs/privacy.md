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
- **Unique amounts and timing:** depositing 1,234.567 ADA and withdrawing roughly 1,234.4 ADA an hour later is an easy match. The UI should nudge users towards round amounts and not rushing.
- **Co-spending:** spending several UTxOs in one transaction suggests they share an owner.
  - Coin selection should spend as few inputs as it can.
  - It should avoid mixing funds with different histories, such as round-trip returns and fresh deposits, when it doesn't need to.
- **The one-time account's staking part (decided): the shared Seedelf staking hash,** the same as the CLI's External Wallet (`seedelf-core/src/address.rs`, `dapp_address`).
  - dApps see a normal base address, and the staking part doesn't identify the user.
  - The trade-off is that it marks the address as a Seedelf address.
  - Any rewards on that credential go to whoever holds it, not to the user. That's fine for money passing through, but the UI should say so.
- **Crowd size:** privacy grows with the number of honest users (the flood-attack section of the root README). With few users, timing and amounts carry most of the risk. The wallet should say that plainly and not overpromise.
- **Network:** Koios and giveme.my see the user's IP address, and Koios has no Tor access. A VPN helps; see the root README's IP-tracking section.
  - A balance reading asks Koios about the Cardano account and the whole wallet contract at the same moment. Koios can tell that the account's owner uses Seedelf, though not which contract UTxOs are theirs: the ownership check runs in the extension.
  - The wallet only reads the chain when Home opens (at most once a minute) or on Refresh. It never polls in the background.
- **On this device:** which contract UTxOs are the user's is kept only in memory and `chrome.storage.session`, never on disk, and it's wiped on lock.

## Not for holding

Seedelf funds sit at an address with no staking part, so they earn no staking rewards. That's the cost of not linking a user's seedelfs through a staking key. The wallet is for moving money privately; long-term staked holdings belong in a normal wallet.
