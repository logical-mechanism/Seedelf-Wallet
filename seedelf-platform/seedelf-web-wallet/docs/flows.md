# Flows

## How money moves

```mermaid
flowchart LR
  Ext["Exchange or<br/>other wallet"] -- "pay" --> Dep["Cardano account"]
  Dep -- "move in" --> S["Seedelf balance<br/>(wallet contract)"]
  Dep -- "send" --> Addr
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
- **Home** has two tabs, and under them when the chain was last read, and **Refresh**.
  - **Seedelf:**
    - the **Seedelf balance**: ADA in the contract UTxOs this wallet owns, with round **Receive** (your seedelfs), **Send** (to a seedelf), **Withdraw** and **Create** (a seedelf) actions;
    - its tokens: the first five (fungible first, by name, then NFTs) and **View all**. Tapping a token opens its details.

    The base register's public value isn't shown: a seedelf's name is what people pay, and nothing else takes the public value.
  - **Cardano account:** its ADA, how many addresses it has used, **Receive**, **Send** and **Move in**, and its tokens (as on the Seedelf tab). Until a seedelf exists, a note says to create one before moving money in.
  - **While the first reading loads** (after an unlock, a restore or a create), a splash covers Home instead of empty balances: the emblem on navy with a teal arc circling it. It fades out into the wallet when the balances arrive. A cached reading shows Home at once, and the splash gives up after about 8 s, so a slow Koios can't hide Refresh or an error.
  - **Tokens** (from **View all**): one balance's tokens in two tabs, **Tokens** and **NFTs**, with a search (name, ticker, policy ID, fingerprint) and a sort (name or amount), 50 rows at a time.
    - **A token's details** open in a modal, centred and never taller than the window: the amount, the policy ID, the asset name and the fingerprint, each with Copy.
    - A token on the wallet's list shows its ticker and logo, and says it's on the list. Any other token goes by its own name, with its fingerprint under it and two letters for a logo, and the modal says its name is only what it calls itself.
    - NFTs are told apart without asking anyone: CIP-68 label 222 is an NFT, 333 and 444 are fungible, and otherwise a single unit with no decimals is an NFT.
  - **Get started:** until the wallet has both a seedelf and a Seedelf balance, the Seedelf tab lists three steps, in the order that keeps them apart (see [Create a seedelf](#create-a-seedelf)):
    1. fund the Cardano account;
    2. create the seedelf, paid by the account;
    3. move ADA in.

    A step is ticked when it's done, and the next step has its button.

## Lock and unlock

- **Unlock:** opening the vault with the password derives every key.
- **Lock:** the lock button in the top bar, or automatically after 15 minutes without activity (key presses and clicks in the wallet). Locking wipes all secrets from memory and session storage, and every open wallet page switches to the unlock screen.
- **Closing the browser locks the wallet;** closing the popup doesn't.
- **Failed unlocks:** exponential back-off (1 s, 2 s, 4 s … capped at 60 s), enforced by the worker. The unlock screen shows the countdown.
- **Forgot password:** "Restore from your phrase" deletes the wallet from this browser after a typed confirmation (`delete wallet`), then goes straight to restore.

**Settings** (the gear in the top bar, while unlocked): **Contacts**, **Collateral**, **Show recovery phrase** (the password again first), **Change password**, **Remove wallet** (typed confirmation), and About (the version, the network, the source code and the privacy policy). Settings asks Koios nothing, except to set a collateral by payment.

**Activity** (the row at the bottom of each Home tab), newest first and grouped by day, after Lace's Activity tab. Each entry opens its details, with the transaction on Cardanoscan.

- **Seedelf:** what this wallet sent, written down at Send from the summary the user reviewed, and what arrived, noted from the balance reading (one entry per transaction; the wallet's own change and a UTxO holding a seedelf don't count). It asks Koios nothing, and never about one transaction. It's encrypted on the device, and starts from when this wallet first saw each payment.
- **Cardano account:** from Koios, which knows the account already: 20 transactions a page (`account_txs` and one `tx_info`), only while Activity is open, and **Load more** for the next 20. Opening it again asks only for what's newer. Each entry is what the transaction did to the account's own addresses; a move-in or a mint this wallet made is named as such.

**Contacts** name the seedelfs and addresses (or `$handles`) the user pays, after Lace's address book. They're managed in Settings, picked with **Contacts** above Send's seedelf name or Withdraw's destination, and saved from either form with **Save to contacts** once it's found. They're encrypted on the device (see [privacy.md](privacy.md#known-links)).

**UTxOs** (the row under Activity on each Home tab, chunk 12) lists that balance's UTxOs from the last reading, asking Koios nothing: the kept ones first (locked, the collateral, a seedelf's), then the largest. Each shows its ADA, how many tokens, and its outpoint, and opens its details: the tokens, the transaction (with Copy), the output and block, and on the Cardano side the address.

- **Lock** in a UTxO's details keeps it out of every payment from that balance, Max included; **Unlock** returns it. Home still counts it, and says so under the balance ("2 UTxOs · 25 ₳ locked"). The forms offer only what's unlocked, their line under the title says what's locked, and with everything locked they say why they're disabled.
- A seedelf's UTxO has no Lock: only removing the seedelf spends it. The collateral has none either: it's reclaimed in Settings.
- The Seedelf side's privacy note: only this wallet can tell these are yours, and looking one up on an explorer tells that site. The choices are encrypted on the device, like Contacts.

**Collateral** (Settings, chunk 12, after Lace's) is 5 ₳ of the Cardano account set aside for transactions that run a script: today, creating a seedelf from the account. It's only taken if the script fails, which the wallet checks before sending (Ogmios), and it's kept out of every payment.

- **Set by the wallet:** with none chosen, the wallet takes the oldest UTxO of exactly 5 ₳ and nothing else that the account holds, with no transaction. The page says so.
- **Set collateral:** from such a UTxO, nothing is sent. With none, it pays 5 ₳ from the account to its own `0/0` (a review, then Send; only the fee leaves the account). A banner follows it to "Collateral set", and the page says it's waiting until then.
- **Reclaim collateral** returns it to the balance at once, with no transaction. The wallet then takes none by itself until one is set again.
- Its privacy note: Seedelf spends never put it up; giveme.my lends theirs.

See [keys-and-accounts.md](keys-and-accounts.md#password-and-vault) for details.

## Receive (Cardano account)

**Receive**, on the Cardano account tab or the first *Get started* step, shows:

- a QR code of the receive address `0/0`, so someone paying from a phone wallet can scan it. It's drawn dark on white with the standard quiet zone;
- the address, with a copy button;
- the stake address.

Anything that can pay a Cardano address can fund the wallet. The screen also says that this is an ordinary address, which anyone can watch: to be paid privately, give out a seedelf's name instead. For a restored wallet, the funds already in the account show up here too.

## Receive (Seedelf)

**Receive** on the Seedelf tab (chunk 12) is where your seedelfs live: each by its tag, with the ADA locked with it, **Copy** for its whole name (to give to anyone who wants to pay you, or to paste into Send to a seedelf) and **Remove**. It asks Koios nothing: the list comes from the last balance reading.

- The whole name sits on one line under the tag. When it doesn't fit, as in the popup, it's cut in the middle (`5eed0e1f7765…ababab`), keeping the last six characters; the cut moves with the width (`MiddleEllipsis`, CSS only). Copy and the tooltip always give all of it.

- It says to give out the whole name, since tags aren't unique, and that nobody can tell a payment to it is yours.
- Its privacy note: the name is public, and linked to whatever paid to create it; what's paid to it isn't.
- With no seedelf yet, it says to create one first, with **Create a seedelf** (disabled, with the reason, while the account can't pay for it).
- Home no longer lists them (it did until chunk 12). Back from a removal returns here.

## Move in (Cardano account → Seedelf)

This is the equivalent of the CLI's `external sweep`, built by the same core code (`seedelf-core::build`). Built in chunk 7.

- **What it does:** the Cardano account pays into the wallet contract. Each contract output gets a freshly re-randomized copy of the user's own base register.
- **What the user chooses:**
  - An **ADA amount, or Max**.
  - **Tokens to bring along:** **Add tokens** opens a searchable picker; each picked token gets an amount box, with Max for all of it. The rest of a token stays in the account. Send and Withdraw pick tokens the same way.
  - **The amount boxes** (ADA's and each token's) group the thousands with commas as you type, and regroup them as digits come and go; Backspace or Delete on a comma takes the digit beside it, and the caret stays among the same digits. Extra decimal places are dropped. A token's box refuses more than the wallet holds, keeping what was there with a note, as ADA's refuses more than the 45 billion there is (`sanitizeAmount`).
  - **The minimum ADA is worked out.** With tokens, the amount can stay empty (the box says "Minimum"): only the least ADA the deposit needs moves. An amount below that least, with or without tokens, is raised to it. The review says so ("1.17 ₳ is the least ADA the network accepts with these tokens", or "Raised from 0.5 ₳: …"). Send and Withdraw work the same way. Lace instead shows the minimum as an error and waits for the user to type it.
  - The form nudges towards round amounts, which are harder to match to a later withdrawal.
- **Which UTxOs are spent:**
  - Every UTxO holding a token being brought along.
  - Then pure-ADA UTxOs, largest first.
  - Then other token UTxOs, until the amount, the fee and valid change are covered.
  - **Never** the account's collateral, or a UTxO the user locked (see *UTxOs* and *Collateral* above). Until chunk 12 no pure-ADA UTxO of exactly 5 ADA was ever spent, in case it was another wallet's collateral; now only the collateral stays put.
  - **Max** spends every other UTxO and keeps only the minimum ADA that the tokens staying behind need.
- **Outputs:**
  - The contract deposits, tokens 20 to an output.
  - Change (leftover ADA, and every token or part of one that stays) back to the receive address `0/0`, as in Lace's single-address mode.
- **Review, then send:**
  - The worker builds and signs the transaction, and the user reviews what moves, the fee and the change.
  - Nothing is sent until **Send**, and then exactly the reviewed transaction is submitted. A built move-in expires after 10 minutes.
- **Watching:**
  - Home shows the sent transaction with a Cardanoscan link.
  - It asks Koios for its status every 15 s for up to 10 minutes, and reopening the wallet resumes the watch.
  - Once it's confirmed, the balances are read again.
- **Signing:** only the Cardano account's payment keys sign, one signature per key, inside WebAssembly.
- **No seedelf needed.** No script runs and no collateral is needed.
- **Privacy:** it links the Cardano account to *some* register UTxOs, but not to any seedelf name. The form says so.

## Send (Cardano account → any address)

An ordinary Cardano payment from the account, so a user needn't open another wallet to pay from it. Built by `seedelf-core::build::account_send`, which shares the move-in's UTxO choice, change and signing. Added in chunk 12.

1. **Send** on the Cardano account tab, between Receive and Move in. It's disabled while the account is empty or a transaction is still confirming.
2. **To:** an address or an ADA Handle, read and checked exactly as for a withdrawal, with Contacts. Your own account's address gets a note: the payment comes back, less the fee.
3. **What's sent:** an ADA amount or Max, and tokens from the picker. The minimum ADA is worked out as for a move-in. **Max** is the move-in's: everything but the fee and what the tokens you keep need, and the collateral and locked UTxOs stay put. It pays one output; the change goes back to `0/0`.
4. **Review:** where it goes, the amount and tokens, the fee, the change and how many UTxOs pay. The account's keys sign here, inside WebAssembly.
5. **Send** submits exactly the reviewed transaction. No script runs, so no collateral and no giveme.my. A banner follows it to "Payment confirmed". It's listed in the Cardano account's Activity from Koios, not in the Seedelf history.

**Privacy:** it's paid in the open, from the account. The form says so, and that paying from Seedelf instead avoids the link.

## Create a seedelf

**A mint links the seedelf to whatever pays for it** (see [privacy.md](privacy.md#known-links)), so the order matters: **mint first, then move in.**

- **Paid by the Cardano account (the default, chunk 8b).** The seedelf is linked to the account openly, and to nothing else. Money moved in afterwards looks exactly like paying someone else's seedelf, so the Seedelf balance isn't tied to the name. This is the CLI's `create`, with the account's own keys.
- **Paid by the Seedelf balance (a stealth mint, chunk 8).** The CLI's `util mint`. It only hides the payer when that balance came from other people's Seedelf payments: hidden money paying for a hidden seedelf.
  - With money you moved in yourself, the mint spends that deposit, and its change sits in the same transaction. That ties the account, the name and the change together.
  - The first live preprod mint did exactly that.

The steps:

1. **Create a seedelf** on the Seedelf card. It's disabled while a transaction is still confirming, or when there's nothing to pay with. Until the wallet has a seedelf, the Cardano card says to create one before moving in.
2. **An optional personal tag:** at most 15 characters of printable ASCII.
   - It's previewed as the wallet will list it, along with how the token name starts.
   - Anyone can read it on chain.
3. **Pay with:** Cardano account (the default) or Seedelf balance, each with a note on what it links.
4. **Review.** Nothing leaves the wallet but chain reads and one Ogmios evaluation.
   - WebAssembly picks the UTxOs that pay (pure ADA first, as few as it can) and drafts the transaction. Ogmios, through Koios, measures the policy (and the spends, for a stealth mint), and WebAssembly finishes it.
   - **Account:** the account's collateral is put up (see *Collateral* above). Without one, one of its UTxOs is, as in the CLI: ADA-only if there is one, a 5 ₳ one first. A token UTxO also works, since the collateral return gives its tokens back. The account's keys sign here, as for a move-in. The fee is about 0.21 ₳, because only the policy runs.
   - **Stealth:** the inputs are proven under a new one-time key, and giveme.my will lend the collateral. The fee is about 0.26 ₳.
   - The review shows the tag, the token name, what pays, the ADA locked with the seedelf (about 1.75 ₳, the minimum for its UTxO), the fee, and the change.
5. **Send.**
   - Account: submits the transaction signed at review.
   - Stealth: only now does giveme.my see it. WebAssembly checks giveme.my's signature and adds it with the one-time key's.
   - Either way, exactly the reviewed transaction is submitted. A banner follows it to "Seedelf created", and it's listed in the Seedelf tab's **Receive**.

Details:

- The seedelf sits under a fresh re-randomization of the user's own register. Minting to someone else's register (the CLI's `--generator` and `--public-value`) isn't offered.
- The token is named after the smallest input spent (`5eed0e1f` ‖ tag ‖ its output index ‖ its tx id, cut to 32 bytes), because that's what the policy checks. So the name is only known once the UTxOs are picked.
- Only removing the seedelf (chunk 10) gives back the ADA locked with it.
- The wallet doesn't yet tell received Seedelf money from moved-in money. The choice and its note are the user's. The wallet could tell them apart by the transaction that created each UTxO (a spend of contract inputs, versus key inputs), but asking Koios about specific transactions would show it which UTxOs are ours.

## Transfer (Seedelf → any seedelf)

This is the equivalent of the CLI's `transfer`, built by the same core code (`seedelf-core::build::transfer`). Built in chunk 9.

1. **Send to a seedelf** on the Seedelf card. It's disabled while the Seedelf balance is empty or a transaction is still confirming.
2. **The recipient: paste the seedelf's full name**, 64 hex characters starting `5eed0e1f`. Tags aren't unique (anyone can mint "alice"), so the name is what counts. Spaces and capitals are tidied away.
   - The wallet looks the name up in the whole wallet contract, the query a balance reading already makes, and shows "Found: *tag* · 5eed0e1f…", or "No seedelf with that name on preprod."
   - Koios is never asked about the recipient's token (see [privacy.md](privacy.md#known-links)).
   - **Your own seedelf** is allowed, with a warning: the payment comes back to your Seedelf balance, less the fee.
3. **What's sent:** an ADA amount (the move-in rules: 6 decimals, the supply cap, "more than you have", and the minimum worked out), and optionally part of any token in the Seedelf balance, each with its own amount.
   - One recipient per transfer, and no Max: withdraw (chunk 10) is for sending everything.
   - The form nudges towards round amounts, and says that sending right after moving in is easy to match by timing.
4. **Review.** Nothing leaves the wallet but chain reads and one Ogmios evaluation.
   - WebAssembly checks the recipient's UTxO: it's in the wallet contract, holds that seedelf, and has a register as its datum. It refuses a register that a payment would be lost under: points that don't decode, points outside the prime-order subgroup, or the identity (anyone could spend a payment to that).
   - The payment goes under a fresh re-randomization of the recipient's register, never the register as found. The change goes under fresh copies of your own.
   - It picks the Seedelf UTxOs that pay: first the ones holding the tokens being sent (the biggest holdings first), then pure ADA, largest first, as few as it can.
   - The inputs are proven under a new one-time key, and Ogmios, through Koios, measures the spends. Only the wallet script runs. The fee is about 0.23 ₳ for one input, and 0.27 ₳ for two.
   - The review shows the recipient (tag and short name, full name on hover), the amount and tokens, the fee, the change back to the Seedelf balance, and how many UTxOs pay.
5. **Send.** As for a stealth mint: only now does giveme.my see the transaction. WebAssembly checks its signature and adds it with the one-time key's, and exactly the reviewed transaction is submitted. A banner follows it to "Transfer confirmed".

Details:

- If the recipient removes their seedelf between review and Send, the payment still reaches their register, so it's still theirs to spend; only the name is gone. The wallet doesn't look again at Send.
- `build::transfer` pays several seedelfs at once (the CLI's repeated `--seedelfs`); the UI offers one.

## Withdraw (Seedelf → any address)

Built in chunk 10, by the same core code as the CLI's `sweep` and `remove` (`seedelf-core::build`). Both are Seedelf script spends: proofs under a new one-time key, giveme.my's collateral at Send, and Ogmios measuring the scripts at review.

### Send to an address

1. **Withdraw** on the Seedelf card. It's disabled while the Seedelf balance is empty or a transaction is still confirming.
2. **To:** a Cardano address, or an ADA Handle like `$name`. What's typed is read after a short pause, and shown: "Sends to addr_test1…", or "$name is addr_test1…".
   - A handle is looked up through Koios (`asset_nft_address`), the plain name first, then the CIP-68 one. Koios sees which handle is asked about.
   - Only a normal address on this network is accepted: not a script (its output would carry no datum), not a stake address, not the other network. The same goes for the address a handle resolves to.
   - **Your own Cardano account gets a warning:** withdrawing there links the money back to it, and to whoever paid it into Seedelf. The wallet recognizes any address carrying the account's staking key, as every address a normal wallet shows for the account does.
3. **What's sent:**
   - An **amount** (the move-in rules: 6 decimals, the supply cap, "more than you have", and the minimum worked out), plus optional token amounts, as for a transfer. The change goes back into the Seedelf balance under fresh copies of your register.
   - Or **Max:** everything, up to 20 UTxOs at once (a transaction fits about that many script spends), with every token, less the fee. The largest go first, and the review says how many are left for another withdrawal. The form notes that spending them together ties them to each other.
   - The form nudges towards round amounts, and says that withdrawing to where the money came from links it back.
4. **Review:** where it goes (the handle and its address, full on hover), the amount or "Everything", the tokens, the fee, the change, and how many UTxOs pay. The fee is about 0.27 ₳ for two inputs.
5. **Send**, as for a transfer. A banner follows it to "Withdrawal confirmed".

### Remove a seedelf

1. **Remove** on a seedelf's row in the Seedelf tab's **Receive**.
2. **Send what's freed to:**
   - **Cardano account** (the default), its receive address `0/0`. A seedelf the account paid for (the default since chunk 8b) is linked to it anyway, so this links nothing new.
   - **Seedelf balance**, under a fresh copy of your register. This is for a seedelf you minted from the Seedelf balance. For one the account paid for, it ties the seedelf's name to that new UTxO, and to whatever it's later spent with.
3. **Review:** the seedelf, what comes back (the ADA locked with it, about 1.75 ₳, less a fee of about 0.24 ₳), and the fee. Both scripts run: the wallet's spend and the policy's burn.
4. **Send.** The token is burned, and the banner follows it to "Seedelf removed".

Details:

- Payments already sent to a removed seedelf stay yours: they sit under copies of your register, not with the name. After the removal, nobody can pay the name.
- The burn policy only checks the policy ID and the `5eed0e1f` prefix. The CLI's `remove` still pays any address (`--address`); the web wallet offers the account or the Seedelf balance.
- The CLI's `sweep --all` takes the first 20 owned UTxOs, and the web wallet's Max takes the 20 largest.

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
