# Flows

## How money moves

```mermaid
flowchart LR
  Ext["Exchange or<br/>other wallet"] -- "pay" --> Dep["Deposit account"]
  Dep -- "move in" --> S["Seedelf balance<br/>(wallet contract)"]
  S -- "transfer" --> Other["Any seedelf"]
  S -- "withdraw" --> Addr["Any address"]
  S -- "out" --> OT["One-time account"]
  OT -- "CIP-30" --> D["dApp"]
  D -. "proceeds" .-> OT
  OT -- "auto-return" --> S
```

**Seedelf balance** means every UTxO at the wallet contract whose register this wallet owns. A **seedelf** is a named token (`5eed0e1f…`) sitting in one of those UTxOs. Its register is what other people use to pay you.

## Onboarding

- **Create:**
  1. Generate a 24-word phrase.
  2. Show it once.
  3. Confirm a few of the words.
  4. Set a password.
- **Restore:**
  1. Enter the phrase (12, 15 or 24 words) and set a password.
  2. Scan the wallet contract for owned registers.
  3. Scan the deposit account.
  4. Scan one-time accounts up to a gap limit.
- **Phrase warning, shown during create:** "This phrase restores your seedelfs only in a Seedelf wallet. Other Cardano wallets will show your deposit account and nothing else."

## Lock and unlock

- **Unlock:** opening the vault with the password derives every key.
- **Lock** (manual, or after inactivity): wipe all secrets from memory.
- **Failed unlocks:** exponential back-off.

See [keys-and-accounts.md](keys-and-accounts.md#password-and-vault) for details.

## Deposit

Show the deposit address and a QR code. Anything that can pay a Cardano address can fund the wallet.

## Move in (deposit → Seedelf)

This is the equivalent of the CLI's `external sweep`:

- **What it does:** the deposit account pays into the wallet contract. Each output gets a freshly re-randomized copy of the user's own base register.
- **Signing:** only the deposit key signs.
- **No seedelf needed.** No script runs and no collateral is needed.
- **Privacy:** it links the deposit account to *some* register UTxOs, but not to any seedelf name.

## Create a seedelf

This is the equivalent of the CLI's `util mint`: a stealth mint paid from the Seedelf balance.

1. The user picks an optional personal tag.
2. The wallet spends owned UTxOs, which needs Schnorr proofs, a fresh one-time key, and giveme.my collateral.
3. It mints the token and puts it in a UTxO holding a freshly re-randomized register.

The new seedelf is never linked to the deposit account.

The CLI's `create` is different: an outside wallet pays for the mint, which links that wallet to the seedelf. See the root [README](../../../README.md#implicit-tracking-methods) (first implicit tracking method). The web wallet doesn't need that path.

## Transfer (Seedelf → any seedelf)

This is the equivalent of the CLI's `transfer`:

1. Look up the recipient seedelf's register.
2. Re-randomize it for the payment output.
3. Re-randomize our own base register for change.
4. Spend the chosen owned UTxOs. Each gets its own proof, bound to a fresh random one-time key.

Collateral comes from giveme.my, and the fee is paid from the inputs.

## Withdraw (Seedelf → any address)

- **Send:** the equivalent of the CLI's `sweep`. Send an amount, or everything, to any address, or to an ADA Handle.
- **Remove a seedelf:** the equivalent of the CLI's `remove`.
  - It burns the token.
  - The burn policy only checks the policy ID and the `5eed0e1f` prefix, so the leftover ADA can go to an address or straight back into the Seedelf balance.

## Contract round trip

This comes in the phase after v1. The idea: take money out of Seedelf to use a contract, then have what comes back returned automatically.

1. **Out:**
   - Make a Seedelf spend to a fresh one-time account.
   - Wait about one block before connecting. Many dApps look up inputs and run script checks against their own backend, which can't see unconfirmed outputs.
2. **Use:**
   - The dApp connects over CIP-30 and sees an ordinary wallet: that one account and nothing else.
   - The wallet shows its own signing prompt for each transaction.
3. **Back (auto-return):**
   - The wallet watches the one-time account.
   - Anything that lands there is paid into the contract under a freshly re-randomized own register, the same as move-in: no script, no collateral.
   - This covers both kinds of dApp:
     - **One-shot dApps:** the wallet signed the dApp transaction, so it already knows the change output. It can submit the return right behind it.
     - **Async dApps** (for example DEX orders filled later by batchers): proceeds arrive blocks later, and the watcher catches them.
4. **Retire:** once the account is empty and the session ends, it is never used again.
