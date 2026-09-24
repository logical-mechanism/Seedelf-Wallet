# Flows

## How money moves

```mermaid
flowchart LR
  Ext["Exchange or<br/>other wallet"] -- "pay" --> Dep["Cardano account"]
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

Onboarding runs in a full tab. From the popup, **Create** and **Restore** open one, because a popup closes as soon as the user clicks elsewhere.

- **Create:**
  1. The worker generates a 24-word phrase.
  2. The UI shows it once, blurred until the user presses **Reveal**, with the warnings below. There's no copy button.
  3. The user types 3 randomly chosen words to confirm them.
  4. The user sets a password, typed twice. Only now does the worker write the vault, so abandoning the flow leaves nothing behind.
- **Restore:**
  1. Choose 12, 15 or 24 words (24 by default), then enter the phrase: one box per word, with BIP39 autocomplete.
     - Typing a prefix suggests matching words: arrow keys, Enter, Tab or a click take one, and focus moves to the next box. Space accepts a complete or unique word.
     - A word that isn't on the list is flagged when its box loses focus.
     - Pasting a whole phrase into any box fills all of them (and switches the word count if needed), then clears the clipboard.
     - **Continue** asks the worker to validate the phrase, and shows the Rust core's reason if it's wrong, for example a bad checksum.
  2. Set a password.
  3. *(Chunk 6)* Scan the wallet contract for owned registers.
  4. *(Chunk 6)* Scan the Cardano account (account `0'`, receive and change addresses, gap limit 20).
  5. *(Later)* Scan one-time accounts up to a gap limit.
- **Password:** at least 12 characters, no composition rules, with a strength hint.
- **Phrase warnings, shown during create:**
  - "Don't copy the phrase into a screenshot, a chat, an email or a cloud note, and never type it into a website."
  - "This phrase restores your seedelfs only in a Seedelf wallet. Other Cardano wallets will show your Cardano account and nothing else."
- **Home** shows:
  - the **Seedelf balance**: ADA and tokens in the contract UTxOs this wallet owns, and **your seedelfs** with their tags and the ADA locked with each;
  - the **Cardano account**: its ADA and tokens, how many addresses it has used, the receive address (copy, QR) and the stake address;
  - the **Seedelf identity**: the base register's public value, shortened;
  - when the chain was last read, and **Refresh**.

## Lock and unlock

- **Unlock:** opening the vault with the password derives every key.
- **Lock:** the lock button in the top bar, or automatically after 15 minutes without activity (key presses and clicks in the wallet). Locking wipes all secrets from memory and session storage, and every open wallet page switches to the unlock screen.
- **Closing the browser locks the wallet;** closing the popup doesn't.
- **Failed unlocks:** exponential back-off (1 s, 2 s, 4 s … capped at 60 s), enforced by the worker. The unlock screen shows the countdown.
- **Forgot password:** "Restore from your phrase" deletes the wallet from this browser after a typed confirmation (`delete wallet`), then goes straight to restore.

See [keys-and-accounts.md](keys-and-accounts.md#password-and-vault) for details.

## Receive (Cardano account)

Show the receive address `0/0`, with a copy button and a QR code, so someone paying from a phone wallet can scan it. The QR is shown on request, drawn dark on white with the standard quiet zone. Anything that can pay a Cardano address can fund the wallet. For a restored wallet, the funds already in the account show up here too.

## Move in (Cardano account → Seedelf)

This is the equivalent of the CLI's `external sweep`:

- **What it does:** the Cardano account pays into the wallet contract. Each output gets a freshly re-randomized copy of the user's own base register.
- **Signing:** only the Cardano account's payment keys sign.
- **What moves:** ADA by default, and tokens only when the user picks them. Pure-ADA 5 ADA UTxOs (another wallet's collateral) are skipped unless the user chooses "move everything".
- **No seedelf needed.** No script runs and no collateral is needed.
- **Privacy:** it links the Cardano account to *some* register UTxOs, but not to any seedelf name.

## Create a seedelf

This is the equivalent of the CLI's `util mint`: a stealth mint paid from the Seedelf balance.

1. The user picks an optional personal tag.
2. The wallet spends owned UTxOs, which needs Schnorr proofs, a fresh one-time key, and giveme.my collateral.
3. It mints the token and puts it in a UTxO holding a freshly re-randomized register.

The new seedelf is never linked to the Cardano account.

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
