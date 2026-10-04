# Flows

## How money moves

```mermaid
flowchart LR
  Ext["Exchange or<br/>other wallet"] -- "pay" --> Dep["Public account<br/>(the Cardano account)"]
  Dep -- "make private" --> S["Private balance<br/>(Seedelf's wallet contract)"]
  Dep -- "send" --> Addr
  Dep -. "stake, vote" .-> Pool["A pool, a DRep"]
  S -- "send privately" --> Other["Any Seedelf"]
  Dep -- "send" --> Other
  S -- "make public" --> Addr["Any address"]
  S -- "out" --> OT["One-time account"]
  OT -- "CIP-30" --> D["dApp"]
  Dep -- "CIP-30 (chunk 15)" --> D
  D -. "proceeds" .-> OT
  OT -- "auto-return" --> S
```

**Names:** the wallet is one wallet on Cardano with two sides, and the screens say so (chunk 14): the **private balance** is the Seedelf balance, and the **public account** is the Cardano account. The flows are named to match: **Make private** is a move-in, **Make public** a withdrawal, and **Send** on each side a transfer (privately, to Seedelfs) or a send (publicly). The code and these docs' internals keep the older names (`move-in`, `withdraw`, `transfer`).

The **private balance** (the Seedelf balance) means every UTxO at the wallet contract whose register this wallet owns. A **Seedelf** is a named token (`5eed0e1f…`) sitting in one of those UTxOs. Its register is what other people use to pay you.

## Opening the wallet

The toolbar button opens the wallet in a **full tab**, or brings back the one already open (chunk 14). Settings' **Open Seedelf Wallet in** switches it to **the side panel**, as Lace does: Chrome's panel beside the page, which stays open as the user browses. Switching opens the wallet the new way at once and closes the page it was chosen on. The choice is the browser's, not the wallet's: removing the wallet keeps it. There's no popup.

## Onboarding

Onboarding runs in a full tab. From the side panel, **Create** and **Restore** open one.

- **The network comes first,** in a build with both (every build, the dev build included; `VITE_ENABLE_MAINNET=false` makes a preprod-only one for tests, with no choice): a small **Network** dropdown under **Create** and **Restore** says **Mainnet** or **Preprod** (mainnet on a new install; after Remove wallet or Forgot password, the network it was on, preprod for a wallet from before the switch; independent review L42), and moves at once, since no wallet exists yet to confirm for. Create and Restore then say which network they're on, with **Change network** back to the choice ("Forgot password" opens Restore without the welcome). So a preprod phrase is restored on preprod, never on mainnet first. Preprod's note in Settings says to test with a phrase you don't use on mainnet: the keys are the same on both.

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
  4. *(Chunk 6)* Scan the Cardano account (the account the wallet is on, `0'` on a fresh restore; receive and change addresses, gap limit 20). *(Chunk 18)* Then look for accounts past it, in the background: one `account_addresses` request each, stopping at the first never used. A restored phrase may hold funds past account 0.
  5. *(Later)* Scan one-time accounts up to a gap limit.
- **Password:** at least 12 characters, no composition rules, with a strength hint.
- **Phrase warnings, shown during create:**
  - "Don't copy the phrase into a screenshot, a chat, an email or a cloud note, and never type it into a website."
  - "This phrase restores your Seedelfs only in Seedelf Wallet. Other Cardano wallets will show your public account and nothing else."
- **Home** has two tabs, and under them when the chain was last read, and **Refresh**.
  - **The eye** beside each balance's label hides the amounts (chunk 14, after Eternl's), and shows them again. It's a setting, so the wallet opens hidden until it's pressed again. Hidden, the balances, the tokens' amounts, the staking rewards and what's locked show as "••••" on Home, Tokens, UTxOs, Activity, Receive and Staking. It hides how many Lovejoin boxes the wallet holds too, since every box is 10 ₳ (privacy review §2.16). The forms and reviews still show their amounts: what's being sent is always shown. It asks no one anything. It's off by default (the owner kept it so, 2026-09-27).
  - **ADA's value** in the chosen currency, "≈ $1,234.56", sits under each balance on mainnet (chunk 14, as in Lace; test ADA has no value, so preprod shows none). It's read from CoinGecko when Home opens or is refreshed, at most every five minutes, and not at all with the currency set to "off" in Settings.
  - **Private:**
    - the **private balance**: ADA in the contract UTxOs this wallet owns, with round **Receive** (your Seedelfs), **Send** (to Seedelfs), **Make public** and **Create** (a Seedelf) actions;
    - its tokens: the first five (fungible first, by name, then NFTs) and **View all**. Tapping a token opens its details.

    The base register's public value isn't shown: a Seedelf's name is what people pay, and nothing else takes the public value.
  - **Public:** the public account's ADA, how many addresses it has used, **Receive**, **Send** and **Make private**, and its tokens (as on the Private tab). Until a Seedelf exists, a note says to create one before making money private.
  - **An ADA Handle in the private balance** gets a warning on the Private tab (chunk 14): a wallet paying `$name` pays the address holding it, which is then the Seedelf contract, with no register to say whose the payment is. The contract lets a UTxO without a register go to anyone, so anyone can take it. It says to make the handle public. Make private and both Sends warn before a handle goes into a Seedelf.
  - **While the first reading loads** (after an unlock, a restore or a create), a splash covers Home instead of empty balances: the emblem on navy with a teal arc circling it. It fades out into the wallet when the balances arrive. A cached reading shows Home at once, and the splash gives up after about 8 s, so a slow Koios can't hide Refresh or an error.
  - **Tokens** (from **View all**): one balance's tokens in two tabs, **Tokens** and **NFTs**, with a search (name, ticker, policy ID, fingerprint) and a sort (name or amount), 50 rows at a time.
    - **A token's details** open in a modal, centred and never taller than the window: the amount, the policy ID, the asset name and the fingerprint, each with Copy.
    - A token on the wallet's list shows its ticker and logo, and says it's on the list. Any other token goes by its own name, with its fingerprint under it and two letters for a logo, and the modal says its name is only what it calls itself.
    - NFTs are told apart without asking anyone: CIP-68 label 222 is an NFT, 333 and 444 are fungible, and otherwise a single unit with no decimals is an NFT.
    - **An NFT's image** (chunk 20) is off until the user asks: an NFT's details say what **Show image** reveals and to whom, more strongly for one in the private balance, and the button is there. The first time, Chrome asks to let the wallet reach `ipfs.blockfrost.dev`; turned down, nothing is asked. Then the wallet asks Koios for the NFT's metadata and fetches the image from IPFS through that gateway, and the details show it, with where it came from. From then until the wallet locks it's shown again with nothing asked, in the details and as the NFT's avatar in the lists. An image written on chain needs no fetch. One on any other server isn't fetched: its address is shown to copy, with why. No metadata, no image in it, a file over 10 MB or one that isn't an image each get a line saying so. A Seedelf's token offers no image.
  - **Get started:** until the wallet has both a Seedelf and a private balance, the Private tab lists three steps, in the order that keeps them apart (see [Create a Seedelf](#create-a-seedelf)):
    1. fund the public account;
    2. create the Seedelf, paid by the account;
    3. make ADA private.

    A step is ticked when it's done, and the next step has its button.

## Lock and unlock

- **Unlock:** opening the vault with the password derives every key.
- **Lock:** the lock button in the top bar, or automatically after 15 minutes without activity (key presses and clicks in the wallet), or the time chosen in Settings: 1, 5, 15, 30 or 60 minutes (chunk 14, Lace's choices less "never"). Locking clears the entropy from session storage and frees the keys in memory (wiping memory is best effort: see [keys-and-accounts.md](keys-and-accounts.md)), and every open wallet page switches to the unlock screen.
- **Closing the browser locks the wallet;** closing its tab or the side panel doesn't.
- **Failed unlocks:** exponential back-off (1 s, 2 s, 4 s … capped at 60 s), enforced by the worker. The unlock screen shows the countdown.
- **Forgot password:** "Restore from your phrase" deletes the wallet from this browser after a typed confirmation (`delete wallet`), then goes straight to restore. Its note says what the phrase brings back, that what private sessions' one-time accounts hold doesn't show after a restore yet, and that a payment that may still go through leaves an encrypted record in this browser: restoring the same phrase here watches it again, and making or restoring another wallet deletes it (independent review M2, M5).

**Settings** (the gear in the top bar, while unlocked): in a build with both networks (every build but a preprod-only one for tests), *Network* (**Mainnet** or **Preprod**, which asks first and says what the other network is; while preprod is on, a strip under the top bar of every screen says its ADA has no value); **Contacts**, **Collateral**; *Preferences*: **Open Seedelf Wallet in** (a full tab or the side panel; see [Opening the wallet](#opening-the-wallet)) and **Show ADA's value in** (eight currencies, or nothing, which asks for no prices; mainnet only); *Sites*: the dApp connector (off, and disabled with the reason, on a Chrome that can't keep sites out of the wallet's storage); *Lovejoin*: whether private sessions come back through it (on by default; off, they come back directly, and it says what that ties and saves), how deep each box mixes and how long it waits, what a mix costs on this network, that it hides boxes from people reading the chain, not from Koios or giveme.my, and that it has had no third-party audit; *Staking*: whether payments spend the rewards; *Security*: **Lock after**, **Show recovery phrase** (the password again first), **Check recovery phrase**, **Change password**, **Remove wallet** (typed confirmation; it first lists what's still open on each network, and with anything listed needs *Remove it anyway, leaving that behind* too: see below); and About (the version, the network, the source code, the privacy policy, whom the wallet talks to and what each sees, and that giveme.my is run by Logical Mechanism). Settings asks Koios nothing, except to set a collateral by payment.

**Remove wallet** deletes the wallet from this browser. Its note says the phrase brings back the public account, the private balance and the Lovejoin boxes, and that what private sessions' one-time accounts hold doesn't show after a restore yet: bring it back first. Before anything is typed it lists what's still open, per network (independent review M2, M5): a payment Koios didn't answer, which may still go through (an encrypted record of it stays in this browser: restoring this same phrase here watches it again, but making or restoring another wallet here first deletes it, and while nothing watches it a payment could pay twice); private sessions still open, pointing to Bring everything back or a running swap's Stop; something left behind at a session's account; a Lovejoin chain still being sent, which removing the wallet stops partway; and a mix from the public account stopped at a transaction that may have gone through (an encrypted record of it stays too: the same phrase restored here looks for it again before another mix from the account is built, and another wallet made or restored here first deletes it; final review F1). With anything listed, or when it couldn't check, **Remove wallet** waits for *Remove it anyway, leaving that behind* as well as the typed confirmation. After a restore, the wallet asks Koios how each Lovejoin box it has no record of went into the pool: a box a mix made comes back by itself as before; a box a deposit made waits, not mixed yet, for Mix again or Bring one back anyway; a box Koios hasn't said the making of waits until it has, and Mix my boxes again can't be used meanwhile (the owner's call on independent review M14).

**Check recovery phrase** (chunk 14, after Lace's recovery phrase verification) is for a written copy: type it (12, 15 or 24 boxes with autocomplete, or paste it), and the wallet says only whether it's this wallet's phrase, never which words differ, so it tells someone at an unlocked browser nothing a whole phrase they already have wouldn't. No password is needed, and nothing is kept: a match empties the boxes. A phrase that isn't one (a word off the list, a bad checksum) gets the Rust core's reason, as restore does.

**Activity** (the row at the bottom of each Home tab), newest first and grouped by day, after Lace's Activity tab. Each entry opens its details, with the transaction on Cardanoscan. The link opens in the browser's own profile, only when clicked; on a private entry it says that opening it tells Cardanoscan, and the browser's history, that the transaction is yours (privacy review §3.4).

- **Seedelf:** what this wallet sent, written down at Send from the summary the user reviewed, and what arrived, noted from the balance reading (one entry per transaction; the wallet's own change and a UTxO holding a Seedelf don't count). It asks Koios nothing, and never about one transaction. It's encrypted on the device, and starts from when this wallet first saw each payment: what the first reading of a history this device starts finds already there (after a restore, say) is listed as *Already in your private balance*, not as received (independent review L38). A session's return that Koios didn't answer, or that a lock or anything else cut off, through Lovejoin or not, is written once it lands, from the summary kept with the session (independent review M7, final review F3).
- **Cardano account:** from Koios, which knows the account already: 20 transactions a page (`account_txs` and one `tx_info`), only while Activity is open, and **Load more** for the next 20. Opening it again, or **Refresh**, asks only for what's newer.
  - **Staking** is in it since chunk 14, from the same `tx_info`: **Staked** (with the pool, by its ticker when the device has it, and the deposit the first time), **Delegated voting power** (with the vote, a DRep by its name from the wallet's list), **Withdrew rewards**, and **Stopped staking** (with the deposit back). A payment that spent the rewards stays **Sent**, and its details say how much of the rewards it spent.
  - **A note** on a transaction (CIP-20's message, anyone's) shows in its details, with a line saying anyone can read one, and write one.
  - An entry's details list each token that moved, with its sign.
- **Refresh** on the Seedelf side reads the balances again, as Home's does, since that's how arrivals are noted. Each entry is what the transaction did to the account's own addresses; a move-in or a mint this wallet made is named as such.
- **Save as CSV** (chunk 14, after Eternl's export) saves what's listed to a file on the device, asking no one: the date (UTC), the kind, the direction, the ADA (signed), the fee, each token with its sign, who or where, the note, the pool, the vote, a deposit or its return, the rewards withdrawn, and the transaction. On the public side it has the transactions read so far, and says to **Load more** first for older ones. The file isn't encrypted, and the private side says what it gives away (privacy review §2.21): each row has its transaction's ID, so whoever has it can find every one on the chain, which ties the private payments, sessions and Lovejoin boxes to each other and to the public account, and shows which Seedelf each payment went to. There's no export without IDs. Someone else's words (a note, a tag, a token's name) never run as a spreadsheet formula: a cell starting `=`, `+`, `-` or `@` gets a leading `'`.

**Contacts** name the Seedelfs and addresses (or `$handles`) the user pays, after Lace's address book. They're managed in Settings, picked with **Contacts** above Send's Seedelf name or Withdraw's destination, and saved from either form with **Save to contacts** once it's found. They're encrypted on the device (see [privacy.md](privacy.md#known-links)).

**UTxOs** (the row under Activity on each Home tab, chunk 12) lists that balance's UTxOs from the last reading, asking Koios nothing (**Refresh** there is Home's, a new balance reading; the public side's only exception looks, at most every two minutes, for a mix from the public account stopped at a transaction that may have gone through: `tx_status`, `utxo_info`; independent review L5): the kept ones first (locked, the collateral, a Seedelf's), then the largest. Each shows its ADA, how many tokens, and its outpoint, and opens its details: the tokens, the transaction (with Copy), the output and block, and on the Cardano side the address.

- **The lock at the end of a row** locks or unlocks it at once; **Lock** in its details does the same. A locked UTxO is kept out of every payment from that balance, Max included. The list keeps its order while you toggle; locked ones come first the next time it's read. Home still counts it, and says so under the balance ("2 UTxOs · 25 ₳ locked"). The forms offer only what's unlocked, their line under the title says what's locked, and with everything locked they say why they're disabled.
- A Seedelf's UTxO has no Lock: only removing the Seedelf spends it. Its details name the Seedelf by its tag, and show its token name cut to fit, with Copy. The collateral has no Lock either: it's reclaimed in Settings.
- A UTxO's details list its first five tokens, then **Show all**, a box of its own that scrolls (with a search from 10 tokens), so a UTxO holding hundreds doesn't stretch them.
- **On the Seedelf side each UTxO says where its money came from** (privacy review §2.3): Back from Lovejoin, Received, Made private, Private session N, or Unknown, from the sealed Seedelf history, asking no one. Spending different ones together ties them, so a lock is an informed choice.
- The Seedelf side's privacy note: only this wallet can tell these are yours, and looking one up on an explorer tells that site. The choices are encrypted on the device, like Contacts.

**Collateral** (Settings, chunk 12, after Lace's) is 5 ₳ of the Cardano account set aside for transactions that run a script: today, creating a Seedelf from the account. **Each public account has its own** (chunk 18): the one shown is the account the wallet is on. It's only taken if the script fails, which the wallet checks before sending (Ogmios), and it's kept out of every payment.

- **Set by the wallet:** with none chosen, the wallet takes the oldest UTxO of exactly 5 ₳ and nothing else that the account holds, with no transaction. The page says so.
- **Set collateral:** from such a UTxO, nothing is sent. With none, it pays 5 ₳ from the account to its own `0/0` (a review, then Send; only the fee leaves the account). A banner follows it to "Collateral set", and the page says it's waiting until then.
- **Reclaim collateral** returns it to the balance at once, with no transaction. The wallet then takes none by itself until one is set again.
- Its privacy note: Seedelf spends never put it up; giveme.my lends its own, so nothing on chain ties them to the account. giveme.my is run by Logical Mechanism, and sees each of them with the IP address.

See [keys-and-accounts.md](keys-and-accounts.md#password-and-vault) for details.

## Receive publicly (the public account)

**Receive**, on the Public tab or the first *Get started* step, shows:

- a QR code of the receive address `0/0`, so someone paying from a phone wallet can scan it. It's drawn dark on white with the standard quiet zone;
- the address, with a copy button;
- **your ADA Handles** (chunk 14): each handle the account holds, from its tokens (asking no one), with Copy. A wallet paying one pays the address holding it: this account. The screen says a handle is as public as the address;
- the stake address.

Anything that can pay a Cardano address can fund the wallet. The screen also says that this is an ordinary address, which anyone can watch: to be paid privately, give out a Seedelf's name instead. For a restored wallet, the funds already in the account show up here too.

## Receive privately (the private balance)

**Receive** on the Private tab (chunk 12) is where your Seedelfs live: each by its tag, with the ADA locked with it, **Copy** for its whole name (to give to anyone who wants to pay you, or to paste into Send) and **Remove**. It asks Koios nothing: the list comes from the last balance reading.

- The whole name sits on one line under the tag. When it doesn't fit, as in the side panel, it's cut in the middle (`5eed0e1f7765…ababab`), keeping the last six characters; the cut moves with the width (`MiddleEllipsis`, CSS only). Copy and the tooltip always give all of it.

- It says to give out the whole name, since tags aren't unique, and that nobody can tell a payment to it is yours.
- Its privacy note: the name is public, and linked to whatever paid to create it; what's paid to it isn't.
- With no Seedelf yet, it says to create one first, with **Create a Seedelf** (disabled, with the reason, while the account can't pay for it).
- Home no longer lists them (it did until chunk 12). Back from a removal returns here.

## Make private (public account → private balance)

This is the equivalent of the CLI's `external sweep`, built by the same core code (`seedelf-core::build`). Built in chunk 7.

- **What it does:** the Cardano account pays into the wallet contract. Each contract output gets a freshly re-randomized copy of the user's own base register.
- **What the user chooses:**
  - An **ADA amount, or Max**.
  - **Tokens to bring along:** **Add tokens** opens a searchable picker; each picked token gets an amount box, with Max for all of it. The rest of a token stays in the account. Send and Withdraw pick tokens the same way. An ADA Handle among them gets a warning (chunk 14): in the private balance, a payment to it from another wallet is anyone's to take (see *Home*).
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
  - Home shows the sent transaction with a Cardanoscan link, which opens only when clicked (a private kind's says what opening it tells).
  - It asks Koios for its status every 15 s for up to 10 minutes, and reopening the wallet resumes the watch.
  - Once it's confirmed, the balances are read again.
  - It's valid for two hours from when it was built. If the chain passes that without it, Home says it expired and nothing was sent, and its UTxOs count again.
  - **If Koios doesn't answer the submit,** it may have gone through (launch review #10): Home says so, the wallet holds its UTxOs back and sends it again now and then (the network takes it once), and no new payment is built until it lands or expires. Every Send works this way, private ones too (see *Submits* in architecture.md).
- **Signing:** only the Cardano account's payment keys sign, one signature per key, inside WebAssembly.
- **No Seedelf needed.** No script runs and no collateral is needed.
- **Privacy:** it links the Cardano account to *some* register UTxOs, but not to any Seedelf name. The form says so.

## Send publicly (public account → any addresses or Seedelfs)

An ordinary Cardano payment from the account, so a user needn't open another wallet to pay from it. Built by `seedelf-core::build::account_send_many`, which shares the move-in's UTxO choice, change and signing. Added in chunk 12; paying a Seedelf (the CLI's `fund`, from the account) and several recipients at once came in chunk 14.

1. **Send** on the Public tab, between Receive and Make private. It's disabled while the account is empty or a transaction is still confirming.
2. **To:** an address or an ADA Handle, read and checked exactly as for a withdrawal, with Contacts. Your own account's address gets a note: the payment comes back, less the fee.
   - **Or someone's Seedelf, by its whole name**, found as [Transfer](#send-privately-private-balance--any-seedelf) finds it: "Found: *tag* · 5eed0e1f…". Koios is never asked about its token. Contacts offers Seedelfs and addresses both.
   - It's paid like a move-in, but under a fresh re-randomization of the Seedelf's register instead of your own: WebAssembly checks the UTxO holding it and refuses an unsafe register, as for a transfer. Only its owner can spend the payment.
   - **Your own Seedelf is refused**, pointing to Move in, which does the same thing.
3. **What's sent:** an ADA amount or Max, and tokens from the picker. The minimum ADA is worked out as for a move-in. **Max** is the move-in's: everything but the fee and what the tokens you keep need, and the collateral and locked UTxOs stay put. Each address gets one output (a Seedelf, one per 20 tokens), in order; the change goes back to `0/0`.
   - **Several recipients** (see [below](#several-recipients)): up to 20, each an address, a handle or a Seedelf, with its own amount and tokens.
   - **A note** (optional, chunk 14, as Lace's "Add a note"): one line of at most 64 characters, written on the transaction as CIP-20's message (label 674), which wallets and explorers show with it. The box counts the characters, and says anyone can read it, for good; paying a Seedelf, that it could say whose Seedelf this pays. Core refuses tabs and line breaks, and splits a note over 64 bytes into CIP-20's lines. The fee pays for its bytes and the hash of them the body carries: 0.00242 ₳ more for "Invoice 42", 0.00484 ₳ for all 64 characters. Make private, the private side's flows and staking offer none.
   - **An ADA Handle going to a Seedelf** is warned about, as on Make private: in a private balance, anyone paying the handle from another wallet pays the contract with nothing to say whose it is.
4. **Review:** where it goes (for a Seedelf, its tag and short name), the amount and tokens, the note, the fee, the change and how many UTxOs pay; with several recipients, each under "Recipient N", then the total. The account's keys sign here, inside WebAssembly.
5. **Send** submits exactly the reviewed transaction. No script runs, so no collateral and no giveme.my. A banner follows it to "Payment confirmed". It's listed in the Cardano account's Activity from Koios, not in the Seedelf history.

**Privacy:** it's paid in the open, from the account. The form says so, and that paying from Seedelf instead avoids the link. For a Seedelf, it adds that anyone can see the money went into Seedelf, though not whose Seedelf it is; for several recipients, that they can be seen to be paid together. A note is as public as the payment.

## Several recipients

Send on either side and Make public each pay up to 20 recipients in one transaction, as Eternl's multi-send does (chunk 14). Make private, Create and Remove pay one.

- **One recipient looks as it always did.** **Add recipient** puts each in a card, "Recipient N", with its own To, amount and tokens; × takes one off.
- **Max pays a single recipient.** Adding a second turns it off and hides it; each then needs an amount.
- **Tokens:** a recipient's token boxes offer only what the others haven't taken. The builders refuse more of a token, all recipients together, than is held.
- **"Together that's X ₳, more than the Y ₳ available"** stops Review early; the builder decides exactly.
- **The review** shows each recipient's rows under its number, then the total, the fee and the change. The minimum ADA note names the recipient it was raised for.
- **Limits:** 20 recipients (WebAssembly's `MAX_RECIPIENTS`), and core refuses a transaction over the network's 16 KiB (`build::MAX_TX_SIZE`) in words, whatever the count.
- **Koios:** several recipients cost what one does, plus each `$handle`'s lookup. The account and the contract are read once for everyone. A Seedelf's lookup as it's pasted costs nothing when Home's last reading saw it (the kept contract view), and one request for what's new when it didn't.
- **The Seedelf history** notes a transfer or withdrawal to several as its total, naming the first recipient "and N more".

## Read the transaction (every review, and the connector's window)

**Transaction details**, on every review and on the connector's sign window: the transaction itself, decoded from the CBOR that is about to be signed or sent — its inputs, outputs, datums, scripts, certificates, votes, redeemers and metadata — and a tab with the raw bytes. Added in chunk 17 ([plans/chunk-17-transaction-view.md](plans/chunk-17-transaction-view.md)), from the owner's ask after the 2026-09-28 mainnet test. Eternl is the model.

- **The way in** is a **Transaction details** control under the review's rows, on every screen that builds a transaction: Make private, Create a Seedelf, Send on both sides, Make public, Remove, the collateral, staking and voting, a swap's funding and its order, a session's top-up and its return, Bring everything back (one a session), a Lovejoin mix, and a site's funding. On the connector's sign window it sits under what the transaction does to the account — a site's bytes are the ones the wallet did *not* build, which is where reading them matters most.
- **It opens a modal of its own**, closed with Escape, a click around it or Close. **It can't strand a signed transaction:** the bytes never live in the screen. The worker holds every built transaction until Send and the view asks it for one by hash, so Send still submits exactly what was reviewed, whatever the view did.
- **What it leads with is where the value goes.** What the transaction spends, then what it pays — each output's whole address, its ADA and its tokens, whether it's a contract, Seedelf Wallet's own contract, and the register or datum it carries. Then the reference inputs, the collateral, any mint or burn, the fee and validity, the certificates, withdrawals and governance, the contracts it runs (redeemers with their budgets, scripts by hash, kind and size, datums), its note and its metadata.
- **An input shows as `txhash#index`, and nothing more.** What it holds isn't in the transaction, and a lookup would tell whoever was asked exactly which transaction you are reading.
- **The explanations are behind icons, not under the rows** (the owner, 2026-10-01): an ⓘ in a section's heading shows its paragraph on hover, and puts it on the page when clicked, so a reader isn't paying for prose they've already read. Each one is also the icon's accessible description, for a screen reader. **A privacy note stays where it is** (`components/Callout.tsx`): those carry decisions from [privacy.md](privacy.md) and are not explanations to ask for. The icon is `components/Hint.tsx`, and is there for any screen that wants it.
- **Nothing links out, and there's a copy button instead.** A click-through to an explorer would tell that explorer, from your own address, which transaction you are examining — a third party that is otherwise not in this wallet's trust set at all. The hash, the CBOR, each script hash, each datum and each unnamed field can be copied and taken anywhere.
- **One rule for what's shown whole** (the owner, 2026-10-01): an **address** is read rather than carried, so all of it is on the page, wrapped, with a button to copy it anyway; an **id** — a UTxO, a hash, a policy, an action — is carried, so it's shortened to a button, with the whole value on the element for hover and for the clipboard. The field this wallet has no name for stays whole, since showing it as written is the point of it.
- **A redeemer's budget is a line of its own**, under the script it belongs to, rather than beside it: a budget runs to ten digits and more, and sharing the line squeezed the words that said which script it was.
- **A Raw CBOR tab** has the hex and a copy button, so the bytes can go to any other decoder.
- **A field this wallet has no name for is shown, not dropped**, by its number and its raw hex, with a warning that a newer Cardano or a newer wallet would name it. A view that silently leaves out what it doesn't understand reads as "there is nothing else here".
- **A datum is a tree that opens, and all of it is there:** constructors by their number with their fields under them, lists, maps, byte strings (as text where they read as text) and whole numbers — for a datum written into an output, a datum in the witness set, and a redeemer's argument. There is no schema to read one against, since a contract's datum means whatever that contract says it means, so the shape is what the view can honestly show.
  - **Nothing is counted off.** The first couple of levels start open, so a small datum reads at a glance; a big branch starts closed and **what is closed isn't drawn at all**, which is what lets a datum of any size through. **Expand all** opens everything, and **CBOR** and **JSON** take it away — the JSON in the detailed schema cardano-cli, Blockfrost and Koios all use.
  - **A register is read only at Seedelf Wallet's own contract**, because that is the only thing that says which contract will read the datum: anyone's datum can be constructor 0 with two 48-byte fields. Where it is read, it adds the one thing the shape can't say — whether a payment under it could be spent. A datum in the witness set gets no such claim at all.
- **A chain's review shows the transaction the money goes in through** (the owner, 2026-10-01). A return through Lovejoin and a mix from the public account are built and signed whole before any of them is sent, so a review holds a dozen transactions. The one it opens is the **first** — the deposit — not the last, which is what Send names and Home's banner watches, and whose inputs are outputs nothing has sent yet. Everything after the deposit only moves what the deposit put in the pool, under rules nothing in a review could change, so the deposit is the one worth reading; the chain's counts and fees are in the review's rows. The button says which one it is, since "Transaction details" is a lie where there are ten of them: *the first mix's* where the wallet's own boxes are mixed again, which deposits nothing. A mix from the private balance is its one funding transaction — its chain is built later, when the session runs, against the pool as it is then, so there is nothing of it to show and predicting it would be a fiction.
- **It doesn't take a script apart.** A script shows as its hash, its kind (native, Plutus V1/V2/V3) and its size. Disassembling to UPLC would say more than it could prove.
- **It asks nobody anything.** No Koios request, no storage write, nothing kept: WebAssembly reads the bytes and only the bytes. Opening it leaks nothing and costs nothing.

## Staking and voting (public account)

Stake the Cardano account with a pool, spend or withdraw its rewards, and delegate its vote, as in Lace, so a user needs no second wallet. Built in chunk 13 by `seedelf-core::build::account_staking` and the `staking` module, which patch certificates and a withdrawal into an account transaction (see [architecture.md](architecture.md#transaction-building)). Only the Cardano account stakes: Seedelf money has no staking part.

- **Home:** the Public tab's balance counts the rewards, as other wallets do. Under it, the **Staking and governance** row (since chunk 21: "LOGIC · 57.47 ₳ rewards", or "Not staking", and "Voting power: Always abstain", or "Your own DRep") opens that page; one row and one page for the pool, the vote and the DRep, the owner's call. While there are rewards and the vote isn't delegated, a warning says the rewards are locked and offers **Delegate your vote**: Conway pays nothing out otherwise.
- **Staking page:** read fresh on opening (the pool's `pool_info`: one request).
  - **Your pool:** ticker and name, saturation, margin, cost, pledge, delegators and blocks, and Lace's warnings: retiring or retired, oversaturated, pledge not met (the pool then earns nothing). **Change pool** opens the browser.
  - **Not staking:** why to stake, the 2 ₳ deposit the first time, and **Choose a pool**.
  - **Rewards:** the amount and **Withdraw rewards** (the whole balance: the ledger takes nothing less). It's disabled with nothing to withdraw, or while the rewards are locked.
  - **Voting power:** where it goes now, and **Change** (or **Delegate**).
  - **Stop staking:** withdraws the rewards, unregisters the stake key and returns its deposit, in one transaction. Disabled while rewards are locked, since it must withdraw them.
- **Pool browser:** every live pool, kept on the device for a day (one `pool_list` page on preprod, three on mainnet, with `totals` and `epoch_params` for saturation). Search by ticker or pool ID; sort by ticker, least saturated, lowest margin, lowest cost or highest pledge; 50 rows at a time. A pool opens its details (one `pool_info`) and **Stake with …**. Your pool is marked, and can't be chosen again. Names come with the details only: `pool_list` has tickers, and every pool's name would cost several requests a day.
- **Vote:** Always abstain, Always no confidence, or **A DRep**:
  - **Search** by name or ID in the wallet's own list of named DReps (`src/dreps/`, made by `npm run dreps` at each release: 61 on preprod, 452 on mainnet on 2026-09-24), 20 at a time. Searching asks no one anything.
  - **Or paste** a whole ID (CIP-129 or CIP-105) the list doesn't have, such as a DRep registered since the release, and **Look up this ID**.
  - The DRep picked is read live (`drep_info` and `drep_metadata`: its name, status, voting power and delegators). An inactive DRep gets a warning (its votes don't count until it votes again; the rewards unlock either way); a retired one can't be chosen. **Choose another DRep** goes back to the search.
- **Review, then Send:** each change is built and signed at review, like a send: the payment keys that pay the fee, and the stake key (`2/0`), inside WebAssembly. The review shows the pool or the vote, any deposit, refund or rewards withdrawn, the fee and the change. Send only submits. A banner follows it ("Delegation sent" … "Now staking").
- **What each costs Koios:** a balance reading is 4 requests (was 3), plus the pool's `pool_info` once a session for its ticker. A build is 5: `account_addresses`, `credential_utxos`, `account_info`, `epoch_params`, and `tip` for its slot.
- **Spending rewards** (Settings: *Use staking rewards when spending*, on by default): a send, a move-in or an account-paid mint reads `account_info` fresh and withdraws the whole reward balance along with it, if the vote is delegated. The forms count the rewards in what's available ("…, with 57.47 ₳ of rewards"), Max takes them too, and the review says what was spent. Off, the rewards wait for **Withdraw rewards**, and the stake key isn't read at all.
- **Refusals, in plain words:** an epoch paying more rewards between Review and Send ("review it again"), a pool or DRep that's gone, rewards withdrawn without a vote delegation, or an account whose staking changed underneath.

**Privacy:** staking and voting are public and name the account. Every screen says so, and the Staking page says Seedelf money can't be staked.

## Be your own DRep, and vote (public account)

Register the account as a DRep, vote on the live governance actions, keep a profile, retire. Built in chunk 21 ([plans/chunk-21-governance.md](plans/chunk-21-governance.md)): the same patch as staking's, with DRep certificates and the body's `voting_procedures`, signed with the DRep key (CIP-105's `3/0`, as Lace derives it) inside WebAssembly. Lace itself has no such screens: it hands GovTool the key over CIP-95, which the connector here learns next (21b).

- **The DRep card,** on the Staking page under Voting power, read fresh on opening (`drep_info` for the account's DRep ID, and `epoch_params` for what registering costs, or `drep_metadata` for the profile's check).
  - **Not a DRep:** what one is, that registering locks up `drep_deposit` (500 ₳ on both networks) and that retiring returns it, **Become a DRep** and **Governance actions** (read-only).
  - **A DRep:** active until which epoch, and the day that ends; its voting power, delegators, profile and deposit; its ID to copy; **Governance actions**, **Profile** and **Retire as a DRep**. Warnings when it's inactive, and when Koios found its profile doesn't match its hash. When the account's own vote goes elsewhere, it says so, with **Delegate your voting power to it**.
- **Voting power** offers **Your own DRep** beside the two Always options and A DRep, so the account never searches for itself (the owner's review, 2026-10-04). A DRep already: its standing, then Review and Send. Not one yet: what registering costs, and **Become a DRep**, whose switch moves the vote off the current DRep in the same transaction. Both read the DRep the Staking page already has: no request.
- **Become a DRep:** *Delegate this account's voting power to it*, on by default, so the account's stake counts behind its votes: the registration and the delegation go in one transaction, in that order (the ledger applies certificates in order). An optional profile: CIP-119's name and three texts and *Ask DRep directories not to list it* (on by default); **Write the profile file** makes the file and its hash in WebAssembly, **Save the file** downloads it, and the user publishes it and gives its address (at most 128 bytes, `ipfs://`, `https://` or `http://`). The wallet never fetches it.
- **Governance actions:** every live one (`proposal_list`, kept on the device for an hour, with Refresh), its title or type, and until when it's open (the epoch before Koios's `expiration`, the one it's expired in: the ledger takes votes through the proposal's epoch plus `gov_action_lifetime`); a DRep's own vote on each (one `vote_list`). An action's details: its type, when voting closes, its proposer's deposit, its abstract, its ID and its full text's address to copy, the explorer link, and **Yes**, **No**, **Abstain**. A new vote replaces an earlier one until voting closes. A title or an abstract is Koios's reading of the action's anchor, cleared of control and direction-changing characters, and a hash mismatch Koios found is a warning. On preprod Koios has no text for them, so they show by type.
- **Profile:** a new file, or **Remove the profile**. An update keeps the DRep active, as a vote does.
- **Retire:** returns the deposit paid (refused in words when Koios didn't say what that was: the ledger takes no other refund). When the account's own vote was the DRep's, it moves to Always abstain in the same transaction, so the rewards stay withdrawable, and the review says so.
- **Review, then Send,** as for staking: each signed at review, Send only submits, and a banner follows it ("DRep registration sent" … "Now a DRep"; "Vote sent" … "Vote recorded"). Activity names them **Became a DRep**, **Updated your DRep**, **Retired as a DRep** and **Voted**, from the same `tx_info` (now with `_governance`), at no extra request.
- **What each costs Koios:** opening Staking is 2 requests more than before at most (`drep_info`, and `epoch_params` or `drep_metadata`). Governance actions are `proposal_list` (at most once an hour) and `drep_info`, and a DRep's `vote_list`. A build is a staking build's 5 and `drep_info`.
- **Refusals, in plain words:** registering twice, or updating, retiring or voting when the account isn't a DRep, before anything is built; a profile's address the ledger wouldn't take, before anything is written.

**Privacy:** a DRep is paid for from the account, so the chain ties it and every vote to the account. Every screen and review says so; so does the note that private money carries no voting power.

## Create a Seedelf

**A mint links the Seedelf to whatever pays for it** (see [privacy.md](privacy.md#known-links)), so the order matters: **mint first, then move in.**

- **Paid by the Cardano account (the default, chunk 8b).** The Seedelf is linked to the account openly, and to nothing else. Money moved in afterwards looks exactly like paying someone else's Seedelf, so the Seedelf balance isn't tied to the name. This is the CLI's `create`, with the account's own keys.
- **Paid by the Seedelf balance (a stealth mint, chunk 8).** The CLI's `util mint`. It only hides the payer when that balance came from other people's Seedelf payments: hidden money paying for a hidden Seedelf.
  - With money you moved in yourself, the mint spends that deposit, and its change sits in the same transaction. That ties the account, the name and the change together.
  - The first live preprod mint did exactly that.

The steps:

1. **Create a Seedelf** on the Private tab. It's disabled while a transaction is still confirming, or when there's nothing to pay with. Until the wallet has a Seedelf, the Public tab says to create one before moving in.
2. **An optional personal tag:** at most 15 characters of printable ASCII.
   - It's previewed as the wallet will list it, along with how the token name starts.
   - Anyone can read it on chain.
   - Without one, the wallet shows the Seedelf by its token name alone, never a stand-in such as "Unnamed", which could be someone's tag.
3. **Pay with:** Cardano account (the default) or Seedelf balance, each with a note on what it links.
4. **Review.** Nothing leaves the wallet but chain reads, and for the account-paid mint one Ogmios evaluation.
   - WebAssembly picks the UTxOs that pay (pure ADA first, as few as it can). For the account, it drafts the transaction, Ogmios (through Koios) measures the policy, and WebAssembly finishes it. For a stealth mint it measures the policy and the spends itself (since the crypto review, 2026-09-25): a draft's proofs would tell Koios which private UTxOs are yours, even for a review never sent.
   - **Account:** the account's collateral is put up (see *Collateral* above). Without one, one of its UTxOs is, as in the CLI: ADA-only if there is one, a 5 ₳ one first. A token UTxO also works, since the collateral return gives its tokens back. The account's keys sign here, as for a move-in. The fee is about 0.21 ₳, because only the policy runs.
   - **Stealth:** the inputs are proven under a new one-time key, and giveme.my will lend the collateral. The fee is about 0.26 ₳.
   - The review shows the tag, the token name, what pays, the ADA locked with the Seedelf (about 1.75 ₳, the minimum for its UTxO), the fee, and the change.
5. **Send.**
   - Account: submits the transaction signed at review.
   - Stealth: only now does giveme.my see it. WebAssembly checks giveme.my's signature and adds it with the one-time key's.
   - Either way, exactly the reviewed transaction is submitted. A banner follows it to "Seedelf created", and it's listed in the Private tab's **Receive**.

Details:

- The Seedelf sits under a fresh re-randomization of the user's own register. Minting to someone else's register (the CLI's `--generator` and `--public-value`) isn't offered.
- The token is named after the smallest input spent (`5eed0e1f` ‖ tag ‖ its output index ‖ its tx id, cut to 32 bytes), because that's what the policy checks. So the name is only known once the UTxOs are picked.
- Only removing the Seedelf (chunk 10) gives back the ADA locked with it.
- **A stealth mint takes received money first** (privacy review §2.3): each private UTxO's history comes from the sealed Seedelf history, by the transaction that made it, never from Koios (which would learn which UTxOs are ours). Moved-in money pays only when no received money pays without merging histories (money you made private, one history, goes before two received payments together), and the review says what the mint then ties together. The choice between the account and the balance is still the user's. After a restore, what the first reading found is Unknown (see [privacy.md](privacy.md#known-links)), and the note is all there is.

## Send privately (private balance → any Seedelf)

This is the equivalent of the CLI's `transfer`, built by the same core code (`seedelf-core::build::transfer`). Built in chunk 9.

1. **Send** on the Private tab. It's disabled while the private balance is empty or a transaction is still confirming.
2. **The recipient: paste the Seedelf's full name**, 64 hex characters starting `5eed0e1f`. Tags aren't unique (anyone can mint "alice"), so the name is what counts. Spaces and capitals are tidied away.
   - The wallet looks the name up in the whole wallet contract, the query a balance reading already makes, and shows "Found: *tag* · 5eed0e1f…", or "No Seedelf with that name on preprod."
   - Koios is never asked about the recipient's token (see [privacy.md](privacy.md#known-links)).
   - **Your own Seedelf** is allowed, with a warning: the payment comes back to your Seedelf balance, less the fee.
3. **What's sent:** an ADA amount (the move-in rules: 6 decimals, the supply cap, "more than you have", and the minimum worked out), and optionally part of any token in the Seedelf balance, each with its own amount.
   - No Max: withdraw (chunk 10) is for sending everything. Up to 20 recipients at once (see [Several recipients](#several-recipients)): `build::transfer` pays them all.
   - The form nudges towards round amounts, and says that sending right after moving in is easy to match by timing.
4. **Review.** Nothing leaves the wallet but chain reads.
   - WebAssembly checks the recipient's UTxO: it's in the wallet contract, holds that Seedelf, and has a register as its datum. It refuses a register that a payment would be lost under: points that don't decode, points outside the prime-order subgroup, or the identity (anyone could spend a payment to that).
   - The payment goes under a fresh re-randomization of the recipient's register, never the register as found. The change goes under fresh copies of your own.
   - It picks the Seedelf UTxOs that pay: first the ones holding the tokens being sent (the biggest holdings first), then, keeping money with different histories apart where it can (privacy review §2.3): one UTxO that pays alone, the smallest that does; then UTxOs of one history; only then several, money you made private first and boxes back from Lovejoin last, one at a time. When that would take more than one transaction can spend (too many small UTxOs, or 16 KiB), it tries other orders, spending as few boxes as pay, and at the last the CLI's own, so it never refuses what the CLI would pay (independent review M6). When it has to merge histories, the review says what's spent together and what that ties, in a plain note, never that nothing else could pay: nothing to press, and Send goes as it is (independent review L39). While none of the UTxOs has a history on the device (after a restore, say), pure ADA, largest first, as few as it can.
   - The outputs are shuffled, so the change isn't always last (§3.7).
   - The inputs are proven under a new one-time key, and WebAssembly measures the spends itself (`uplc`, as a Lovejoin chain is): no draft with its proofs goes to Koios's Ogmios. Only the wallet script runs. The fee is about 0.23 ₳ for one input, and 0.27 ₳ for two.
   - The review shows the recipient (tag and short name, full name on hover), the amount and tokens, the fee, the change back to the Seedelf balance, and how many UTxOs pay.
5. **Send.** As for a stealth mint: only now does giveme.my see the transaction. WebAssembly checks its signature and adds it with the one-time key's, and exactly the reviewed transaction is submitted. A banner follows it to "Private payment confirmed". Once it lands, only the private side is read again, not the public account (privacy review §2.9).

Details:

- If the recipient removes their Seedelf between review and Send, the payment still reaches their register, so it's still theirs to spend; only the name is gone. The wallet doesn't look again at Send.
- `build::transfer` pays several Seedelfs at once (the CLI's repeated `--seedelfs`); the UI offers it since chunk 14.

## Make public (private balance → any address)

Built in chunk 10, by the same core code as the CLI's `sweep` and `remove` (`seedelf-core::build`). Both are Seedelf script spends: proofs under a new one-time key, giveme.my's collateral at Send, and the scripts measured in the wallet at review (Ogmios until the crypto review).

### Send to an address

1. **Make public** on the Private tab. It's disabled while the private balance is empty or a transaction is still confirming.
2. **To:** a Cardano address, or an ADA Handle like `$name`; or several, up to 20 (see [Several recipients](#several-recipients), `build::sweep_many`). What's typed is read after a short pause, and shown: "Sends to addr_test1…", or "$name is addr_test1…".
   - A handle is looked up through Koios (`asset_nft_address`), the plain name first, then the CIP-68 one. Koios sees which handle is asked about.
   - Only a normal address on this network is accepted: not a script (its output would carry no datum), not a stake address, not the other network. The same goes for the address a handle resolves to.
   - **Your own Cardano account gets a warning:** withdrawing there links the money back to it, and to whoever paid it into Seedelf. The wallet recognizes any address carrying the account's staking key, as every address a normal wallet shows for the account does, and any whose payment key is the account's (the first 20 of each chain, and those the last reading found), an enterprise address among them (privacy review §2.17).
3. **What's sent:**
   - An **amount** (the move-in rules: 6 decimals, the supply cap, "more than you have", and the minimum worked out), plus optional token amounts, as for a transfer. The change goes back into the Seedelf balance under fresh copies of your register.
   - Or **Max:** everything, up to 20 UTxOs at once (a transaction fits about that many script spends), with every token, less the fee. The largest go first, whatever their histories, and the review says how many are left for another withdrawal, and which histories it merges. The form notes that spending them together ties them to each other.
   - The form nudges towards round amounts, and says that withdrawing to where the money came from links it back.
4. **Review:** where it goes (the handle and its address, full on hover), the amount or "Everything", the tokens, the fee, the change, and how many UTxOs pay. The fee is about 0.27 ₳ for two inputs.
5. **Send**, as for a transfer. A banner follows it to "Made public".

### Remove a Seedelf

1. **Remove** on a Seedelf's row in the Private tab's **Receive**.
2. **Send what's freed to:** the side that paid for the Seedelf is chosen (privacy review §3.2). The wallet keeps who paid at each mint's Send (sealed, per network); for a Seedelf minted before that or elsewhere, it works it out from what it holds, never asking Koios: another of its contract UTxOs from the mint's transaction means a stealth mint, the account's UTxOs or Activity an account-paid one. Otherwise neither is chosen, and Review waits.
   - **Cardano account**, its receive address `0/0`. A Seedelf the account paid for (the default since chunk 8b) is linked to it anyway, so this links nothing new. For a stealth-minted one it ties the account to the Seedelf's name and the private UTxOs that paid for it, and says so.
   - **Seedelf balance**, under a fresh copy of your register. This is for a Seedelf you minted from the Seedelf balance. For one the account paid for, it ties the Seedelf's name to that new UTxO, and to whatever it's later spent with, and says so.
3. **Review:** the Seedelf, what comes back (the ADA locked with it, about 1.75 ₳, less a fee of about 0.24 ₳), and the fee. Both scripts run: the wallet's spend and the policy's burn.
4. **Send.** The token is burned, and the banner follows it to "Seedelf removed".

Details:

- Payments already sent to a removed Seedelf stay yours: they sit under copies of your register, not with the name. After the removal, nobody can pay the name.
- The burn policy only checks the policy ID and the `5eed0e1f` prefix. The CLI's `remove` still pays any address (`--address`); the web wallet offers the account or the Seedelf balance.
- The CLI's `sweep --all` takes the first 20 owned UTxOs, and the web wallet's Max takes the 20 largest.

## Connect a site (public account)

CIP-30 for the public account, as Lace offers it (chunk 15). The design is in [architecture.md](architecture.md#dapp-connector); the plan, with the private steps after it, in [plans/chunk-15-dapp-connector.md](plans/chunk-15-dapp-connector.md).

1. **Turn it on:** Settings → *Sites* → **Let sites connect to Seedelf Wallet**. Each site then gets the public account or a private session, chosen in the connect window (see *Any site* below). Chrome asks to let the wallet onto https sites; only then are its two scripts added to pages. Off (the default), sites can't see the wallet.
2. **Connect:** a site's **Connect wallet** lists Seedelf Wallet (when the site lists every CIP-30 wallet). Its `enable()` opens the connector's window: the site's address as Chrome reports it, and two choices, **Your public account** and **A private session**, with neither chosen (privacy review §3.3). Each says what it costs: the public account shows the site its addresses, balance and UTxOs, which it keeps, and it can recognize this browser later; a private session takes a network fee now and back, 5 ₳ of collateral that comes back, and about a minute. **Connect** waits until the public account is chosen; **Cancel** refuses.
3. **Use it:** reads need no window. A transaction or a message to sign opens the window:
   - **A transaction:** what it does to the public account (it sends or it gets, each token that moves), the fee, who it pays (a contract, Seedelf Wallet's contract with or without a register, an address), the collateral at risk, any staking change, minting, a note, whether it runs contracts, and which keys sign. **Sign** or **Decline**. A payment to another of the wallet's accounts is named ("Your private session N" here, "Your public account" in a session's prompt), with a warning that signing ties the two together on chain; the prompt says the other side isn't in it only when it checked and found nothing (independent review M12).
   - **A message** (CIP-8): the address, which key signs, and the message as text, or hex when it isn't text. Signing moves no money.
   - A transaction that needs someone else's signature, when the site didn't ask for a partial one, or one that would hand the collateral to someone else, is refused before the window opens.
   - **Governance (CIP-95, chunk 21b):** a site that calls `enable({ extensions: [{ cip: 95 }] })` (GovTool does) has the connect window say what governance gives under *Your public account*, and under *A private session* that a session has no DRep. Under *Your public account* it's a switch, **Give it governance too (CIP-95)**, **off by default**, the most private choice: left off, the site connects without it and isn't asked again until it connects anew. A site connected already that asks for it later gets a short question of its own, **Allow** or **Cancel**; **Cancel**, or closing the window, leaves it connected, without governance and not asked again. Granted, `getExtensions()` answers `[{ cip: 95 }]`, the API has `cip95` (`getPubDRepKey`, `getRegisteredPubStakeKeys`, `getUnregisteredPubStakeKeys`, `signData`), and the DRep key `3/0` signs the account's own DRep certificates and votes, which the prompt states as sentences ("Registers your DRep (a 500 ₳ deposit).", "It casts 2 votes as your DRep…"), and messages for the DRep by its ID or its key's enterprise address. Settings' *Connected sites* marks a site that has it.
4. **Locked:** a connected site's `isEnabled()` still says it's connected, so polling it doesn't show when the wallet is in use, but its reads are refused at once, in the words a stranger hears, with no window (privacy review §2.11). `enable()`, a signature or a submit opens the window, which names the sites waiting and asks for the password first. Closing it answers "The user declined.", and for a minute, while the wallet stays locked, that site's signatures and sends are refused without asking, in the words a site that isn't connected hears, never "Seedelf Wallet is locked." (independent review L36); a site that isn't connected can't reopen it with `enable()` then either.
   - **One connect question at a time** per site (independent review L35): however many of its pages call `enable()`, they share one, and while locked they take one place in the window together, so a site open in many tabs isn't refused for its own tabs. A connect question declined, or closed on, isn't asked again for a minute. One site has at most 5 requests waiting, of the window's 20.
5. **Disconnect:** Settings → *Connected sites* lists them, each with **Disconnect**, which asks first. The list is sealed on the device. A site on a private session (*Any site* below) ends its session too, so its Disconnect waits, and says why, while the session's funding, its return or the return's chain through Lovejoin is on its way, or while the account held something when last read; the worker checks again, and its refusal shows. Right after a funding, a top-up or the site's own transaction lands, it may say Koios hasn't caught up with the session yet: try again in a minute (independent review M4). A funding or top-up that neither Koios nor any read has seen yet may still land, and Disconnect says so, and waits for it up to two hours after it was sent (final review F13). Disconnecting declines what the site was still waiting for; turning the connector off, or removing the wallet, declines every site's (independent review L33).

The account's own outputs of a transaction it signed are kept, so a site can build its next transaction on them before they're on chain. Among the wallet's recent sends, a site finds only the outputs that pay its own account; anything else it asks about goes through its lookup budget and Koios, as a stranger's does, and a signature is checked only against its own account's Lovejoin chain (privacy review §2.1, §2.2). A site's `submitTx` goes through Koios, as the wallet's own sends do, and its own outputs are kept for that site alone. What its submits spend is kept apart from what the wallet spent, so a site can't push that out (independent review L7).

- **A submit Koios didn't answer** (a timeout, a 5xx, an answer it couldn't read) may have gone through (independent review M3). The site hears its transaction id, not "failed": its inputs are held back as spent, it's kept as sent, and before answering, the call looks for it and sends it again, up to three times, 5 s apart. A 429, which Koios answers before passing anything on, is still a failure, for a transaction the wallet doesn't already keep as sent.
- **The site sending the same transaction again** hears its id too, while the first submit is still under way, and later while the wallet keeps it as sent: one it signed for that account, or one this site sent through it, within 2 hours, among the account's last 32 kept, with no lock since. Then it hears the id whatever Koios answers (a 429, a refusal), and past the site's limit of 10 submits a minute without Koios being asked: told it failed, the site could build the payment again and pay twice (final review F12). Anything else refused as spending what's spent is a failure, unless `tx_status` shows it on chain.
- **A submit a worker restart cut off** says it may have gone through, and to check on chain before sending it again.

## Contract round trip

Money leaves Seedelf to use a contract, then comes back: a **private session** on a one-time account (account `24301'`, payment key `0/i` and its own stake key `2/i`). The plan is [plans/chunk-15-dapp-connector.md](plans/chunk-15-dapp-connector.md), with the user's two designs (a round trip through a new account, or straight from Seedelf with giveme.my's collateral) and when each fits. The first built use is a swap through Minswap's aggregator (route A1).

### A private swap (built in chunk 15, runs itself since 15b)

Home's Private tab → **dApps**, a grid of the dApps the wallet uses privately → **Minswap**: its swaps, newest first, each with where it's at, and **New swap**. While a swap runs, Home's Private tab shows a **Swap in progress** row that opens it, and Minswap's tile says how many run.

1. **New swap**, in Minswap's shape: a **You pay** card over a **You receive** card, each a big amount beside its token, with a round **Switch** between them that swaps the two sides.
   - **You pay:** ADA or a token in the private balance, with what's held under it, and **Half** and **Max**. ADA's Max leaves the swap's costs, the collateral and 1 ₳ for the fee. Both round down to a whole ₳ or token unit, so the amount looks typed (what's left stays in the private balance), and the form says they still tell Minswap roughly how much the private balance holds (privacy review §2.13).
   - **You receive:** any token Minswap lists, picked from what's held or from the wallet's own token list, searched on the device (privacy review §3.11). Minswap's list is searched only when neither matches, or on **Search Minswap**, and Minswap then knows what was searched for.
   - **The quote:** it comes in as you type, asked once typing pauses for 0.6 s, since Minswap limits how often it's asked. What you receive fills in, with the rate under the cards; tap the rate to turn it round. Its details show the minimum received, the price impact (amber from 3%, red from 5%, with a warning), the slippage, the route (through DEXes that take orders only: one that swaps against its pools would spend UTxOs that aren't the session's), the DEX's fee, and the order's deposit (back with the proceeds). The refresh button asks again.
   - **Slippage:** the sliders button at the top. It offers 0.5, 1 or 3%, or your own from 0.1% to 20%, with a warning from 5%.
   - **The button** says what's missing (Select a token, Enter an amount, Not enough ADA), then **Review swap**. A quote over a minute old is asked for again before the funding is built on it.
2. **Review the swap:** what you pay and receive about, at least, the price impact and the route. Then the funding, the three transactions, each with its fee, and Send.
   - **On the way back, through Lovejoin** (on as Settings has it; a switch here, *Bring it back through Lovejoin*, turns it off for this swap, and the runner keeps to it): the spare ADA, and a token→ADA swap's proceeds, go through Lovejoin first. Review reads Lovejoin's pool once (kept five minutes, never as you type), and prices only the boxes it has room for; with none, it says the ADA would come back directly, tied to the session (privacy review §2.7). It shows the boxes, their mixes and fees, about 0.3 ₳ a box to bring them back, and the wait, with the no-audit note. It says this swap keeps that depth and wait: Settings' Lovejoin changes only swaps started after it, turning Lovejoin off there doesn't change this one, and Stop can bring it back directly (independent review L21).
   - **If it's stopped or refunded:** an ADA→token swap's funding would come back through Lovejoin, and the review prices that too, with the no-audit note (privacy review §2.8).
3. **The funding** (Send, the one approval): a Seedelf spend with giveme.my's collateral, paying the session's account twice: the swap with its costs and 2 ₳ of room, and 5 ₳ as the account's own collateral. The change goes back into the private balance. The session is recorded before it's sent, so this browser never uses its account twice, even if the send fails, and Send first asks the chain once more that the account is unused, in case the phrase used it elsewhere (independent review M13). Home's banner watches this payment; the user lands on the swap's own page.
4. **From here it runs itself,** on a timeline of four steps: **Funded**, **Order placed**, **Filled**, **Back in your private balance**. Each shows waiting, done (with its transaction on Cardanoscan) or paused, and a line under them says what's happening in plain words. The page checks every 20 s (Refresh checks now); with the page closed, the worker checks once a minute while the wallet is unlocked.
   - **The order**, once the funding is on chain: a fresh quote and Minswap's swap for the account (Minswap picks the account's UTxOs itself, so it waits for the funding). WebAssembly reads it against the session's key alone; the key signs it, the signature goes in without changing a byte of Minswap's transaction, and Koios submits it. It's placed only within what was approved: the session's UTxOs, its key alone, no more paid out than was funded, and paid only to the session, to an order made out to it, and to Minswap's quoted fee. The wallet asks Minswap for at least the approved minimum; Minswap builds the order, and its minimum isn't read back. The timeline's "Asked for at least" is what the placed order asked for, once one is (independent review L24). Anything else **pauses** and says why, with **Try again** and **Review it myself** (the order's review, as a button used to give). On mainnet that includes Minswap's fresh route going through a DEX the wallet doesn't check (independent review M17).
   - **Filled:** a DEX's batchers pay the proceeds to the account, usually within a few blocks. It waits as long as it takes: the wallet never cancels an order by itself. An order the DEX refunds shows as **Refunded** ("Refunded: the order wasn't filled, so what you swapped is back in your private balance."), and a route split between DEXes with a leg refunded as **Partly filled**, never as done (independent review M18).
   - **Back:** what's at the account into the private balance, under fresh registers, signed by the session's key. A token UTxO the session's own transactions didn't make comes back only when its own ADA pays its way; one that doesn't stays at the account, and the swap's page lists it as left behind (independent review H1, H2). With Lovejoin on for this swap, the spare ADA (a token→ADA swap's proceeds too) goes in as boxes of 10 ₳ first, each coming back later on its own; the rest comes back now, merged into the funding's change. Once it's on chain, the account is empty, Koios shows the funding's outputs spent and no order of the swap is still open, the swap is done, and **the whole card turns the success colour** (independent review M4, L15). The account is never used again.
   - Each step's transaction is on Cardanoscan, with one note under the steps saying what opening it tells.
5. **Stop**, there the whole time a swap runs, is always the user's: one confirmation, then an order that waits is cancelled (built by Minswap, read and signed the same way; the refund comes back to the account) and everything comes back. Before any order, everything just comes back. The confirmation reads the swap as it opens; with no order placed, it says "If no order has gone out yet…", since the runner may be placing one, and when one had gone out before Stop took effect, the page says so, and that it's cancelled unless a batcher fills it first (independent review L22). After a cancel, the return waits until every order of the swap is spent (independent review L16). When one of them is an order Minswap doesn't list, so it can't be cancelled yet, the page says so plainly, with a neutral **Order open** tag: what's left waits at the swap's account until that order is filled or refunded, or Minswap lists it and it's cancelled. There's no timed way out (the owner's call on independent review L16). The confirmation shows what comes back through Lovejoin, as the worker works it out then, and offers **Stop and bring it back directly** beside **Stop** (privacy review §2.8, §4.1).

**Pause and resume:** locked, the swap waits, and unlocking carries on after a fresh wait, from 2 minutes to at most 20 after the unlock (less with a short auto-lock), rather than at once, whichever check finds the step first (privacy review §3.1; independent review L10, L12; what the user asks for still goes at once). A Lovejoin chain is sent only while the wallet is unlocked: locking partway stops it, even while a transaction waits to be tried again, and a lock and an unlock during that wait stop it too (independent review L14). What's left comes back directly. A closed browser, a restarted worker, or a wallet opened hours later all carry on from what's stored and on chain. A failure (Koios down, Minswap's rate limit) turns the step amber and says what's wrong and when it tries again (30 s, doubling to five minutes), with **Try now**. The auto-lock setting doesn't change for a swap.

**If a session stalls,** everything is recoverable from the phrase: money left in the account comes back; an order that never fills is stopped, then brought back. A session whose funding never reached the chain shows so, and can be forgotten (its index isn't reused), unless Koios knows one of its funding's outputs unspent: then it landed after all, so it isn't forgotten, and it goes on (a swap or a mix runs again; independent review M4). Sessions from before swaps ran themselves keep their buttons (Place the order, Cancel the order, Bring it back). After a restore, here or on another device, a scan of the one-time accounts (not built yet) would find what's left: see the plan's *Recovery*. Until then, Remove wallet and Forgot password say that what private sessions' one-time accounts hold doesn't show after a restore (independent review M5).

### Any site (private CIP-30, chunk 15c)

The same session, offered to a site over CIP-30 instead of the public account. The plan is [plans/chunk-15c-private-cip30.md](plans/chunk-15c-private-cip30.md).

1. **Connect:** the site's `enable()` opens the connector's window, with neither choice made. **A private session** asks what to put in it (ADA, and tokens), and the funding's review shows it, each token with its amount (independent review L37), with 5 ₳ of collateral, and the change it leaves in the private balance, which anyone, the site included, can follow. **Send** needs the password when *Ask for your password to sign for a site* is on.
2. **Out:** a Seedelf spend to a fresh one-time account, with giveme.my's collateral. The window waits until Koios sees the money (about a minute), then `enable()` answers, so the site's first reading already shows it. Closing the window doesn't undo the payment.
3. **Use:** the site sees an ordinary wallet: that account, its reward address and its 5 ₳ collateral (none while the session's own chain through Lovejoin being sent needs it; independent review L32), and nothing else. Each transaction and message gets the window's prompt, signed with the session's keys.
4. **Top up and Bring it back** from the dApps page's *Sites*. Top up's review lists each token with its amount (independent review L37), and adds a new 5 ₳ collateral when the account has none left: a return takes it, or a site's transaction spent it (independent review M9). Bringing it back leaves the site connected, to an empty account, because something still open at the site (a listing, an order) may pay it later. When its chain through Lovejoin stopped partway, what's left stays at the account until Bring it back sends it, directly (independent review L23); while that isn't on chain yet, a return built meanwhile comes back directly and says why (independent review L17).
5. **Disconnect** (the site's page, or Settings → *Connected sites*) asks first, then ends the session, once nothing is on its way and the account is empty. An empty read alone isn't enough, since a Koios backend behind the funding reads it empty: Koios is also asked about what the session's fundings, top-ups and the site's own signed transactions paid the account, and while it shows one unspent, or doesn't know one it should, Disconnect says Koios hasn't caught up: try again in a minute (independent review M4). While a funding or top-up hasn't been seen at all, it says it may still land, and to try again two hours after it was sent (final review F13). It is never used again, and the site's next connect asks again. The site keeps what it already saw. The session's record goes, and with it the site's origin, unless something left behind is still at its account (privacy review §3.12; independent review L19).

**Bring everything back** (the dApps page, when sessions hold money): every site's session, and every older swap brought back by hand, with nothing on its way, back into the private balance in one go. Each comes back in its own transaction, sent one after another. The review lists them, with the total and the fees, and a tap leaves one out: a site still in use, say. When some go through Lovejoin, it says so, with the no-audit note, and offers **Bring them back directly instead** (privacy review §4.1). Sent together, their deposits land in the same block or two and their mixes share blocks, and a shallow pool serves the first sessions while the rest come back directly: bringing each back from its own page, hours apart, avoids both.
