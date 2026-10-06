# A usability review of the built wallet, round two

A diagnosis: §1 to §8 are the review as it was written, and [§9](#9-the-fix-round) says what the fix round did with each finding. It follows chunk 23's first review (`16c6539`) and the fix round built on it, and looks at the wallet as it stands after both. Each finding has an ID (`FR-1`, `ST-4`, …) so a plan can point at it.

The brief was adversarial: treat every screen as guilty until proven usable, for someone who has never seen the wallet, hasn't read the README, doesn't know blockchain terms, clicks whatever looks like the next step, and leaves at the first sign they've made a mistake. So this is a list of problems. Where something works, it's said only when that explains a finding.

**Severity.** P0 stops an important workflow. P1 is serious confusion or a likely failure. P2 is noticeable friction. P3 is polish. **Nothing tested was a hard P0**: every workflow could be finished by someone who already knew the way. The worst are P1s where a new user would most likely fail, give up, or believe they'd lost money.

**Calls already open.** Some findings land on product calls the first round left to the owner: renaming Make public, opening a new wallet on Public, Swap on Home, UTxOs behind Advanced, two decimals, a password on the wallet's own sends, and the loading frame after create (L-1). Those are marked *(open call)*. They're here because they still hurt, not because the call was wrong to leave.

## How it was tested

- **The build:** `dist/` (1.1.0) built from `web-wallet/style-flow-3` at `16c6539` plus the uncommitted fix round from the first review (`ReviewTotals`, `RadioCards`, `StaleReview`, `ui/history.ts`, `ui/sites.ts`).
- **The harness:** Playwright's Chromium driving `dist/` with the fakes from [e2e/support.ts](../extension/e2e/support.ts), so Koios, giveme.my and Minswap answer from the recorded preprod fixtures. Four passes ran side by side:
  - onboarding, the private side, accounts, settings and failure states;
  - public money (send, make private, tokens, activity, UTxOs);
  - staking and governance;
  - dApps, swaps, Lovejoin, collateral and the connector windows.
- **Wallets:** one created through the UI (empty); the 12-word fixture phrase (28 ₳ private, about 10,408 ₳ public, six tokens, one Seedelf, staked to LOGIC), with a second account added; a DRep registration and votes made on it.
- **Sizes:** the side panel at 360×640 (and 360×480); a tab at 1280×720; the connector window at 400×605 (its 400×640 window less the title bar).
- **States forced:** Koios slowed to 3–4 s an answer, Koios failing with 500 (at refresh, at build and at submit), pending then confirmed transactions, wrong words, wrong passwords, Spanish and Japanese, a locked wallet when a site asks, two site requests at once.
- **Fake-chain artefacts left out:** giveme.my refuses every private transaction, so no private payment, swap funding, mix or site session ever completed. How each screen handles that refusal is reviewed; the refusal itself isn't. Change outputs never appear after a confirmation, so balances *after* "confirmed" are ignored; balances *while pending* are the wallet's own accounting and count. Only LOGIC and TPREP have pool details. Every recorded proposal is open and has no title. The swap quote is fixed whatever the amount.
- **Not covered:** Chrome's own side-panel chrome; real mainnet latency; a never-staked account; closed or expired proposals; screen readers beyond the accessibility tree; the light theme (there isn't one).
- **Evidence:** the screenshots were taken in a scratch folder and aren't kept. Findings quote the screen's exact words and give measurements instead.

**Since round one, and not repeated here:** the strength hint is translated; the account picker has its own row; reviews carry "Total leaving" and a "balance after"; Home's disabled actions say why, inline; browser Back works in a tab; private Send catches an ordinary address and links Make public; the phrase grid isn't under a sticky foot; and private Send's refusal now has a rebuild action. The new problems below are mostly where those fixes stop: the rebuild exists on private Send but not on swaps, mixes or site sessions, and "Total leaving" counts ADA but not tokens.

---

## 1. Top 10 UX failures

1. **A new wallet gets contradictory instructions, and the obvious path ends in the wrong advice** ([GS-1](#gs-1), [GS-2](#gs-2), [GS-3](#gs-3)).
   - Get started says "Create your Seedelf: your public account pays for it, before any money is made private".
   - Under the disabled Create button on the Private tab, the reason says "Make some ADA private first: these are paid from your private balance".
   - Following the Public tab's "Create a Seedelf" link with an empty wallet ends at: "Your private balance is empty. Make some ADA private first; the Seedelf is paid from there."

   That's the exact opposite of the advice that sent the user there, and it never names the real blocker, an empty public account.
2. **Restoring a wallet hides the words you type, then shows a blank screen** ([FR-1](#fr-1), [FR-2](#fr-2)). In the side panel the restore grid stays four columns of 46 px boxes, so "abandon" reads "aban" and "together" reads "toge". After "Restore wallet" (and "Create wallet") the screen goes blank except for the test-network banner: no header, no spinner, no words.
3. **A pending payment looks like a loss** ([HM-1](#hm-1), [HM-2](#hm-2), [HM-3](#hm-3)).
   - After sending 10 LINK and 1.16 ₳ from 10,408 ₳, the public balance reads 69.475311 ₳, and LINK and the tUSDM-named token vanish until it confirms.
   - Making money private shows no "incoming" anywhere.
   - One public transaction in flight disables every private action too.
4. **Refusals end in dead ends, and one control says it's sending when it isn't** ([DX-1](#dx-1), [PY-1](#py-1)).
   - Swaps, mixes and site-session funding still show round one's error: "giveme.my, which lends the collateral, refused this transaction: Transaction Fails Validation. Its UTxOs may have been spent since the review: refresh, then review it again." There's no refresh, Send stays live, and pressing it says "That session was started already."
   - On private Send, where the rebuild does exist, pressing "Refresh and review again" shows **"Sending…"** on the button while it only rebuilds.
5. **Site windows can be signed without seeing who gets paid** ([CW-1](#cw-1), [CW-2](#cw-2)).
   - At 400×605 the sticky password, Decline and Sign block covers the "Pays" list, and the amber "Signing ties them together on chain" warning is under it.
   - Choosing "A private session" shows a disabled Review and no amount field: it's below the fold, and nothing says why.
6. **Cancel a site once, and it's silently refused for up to a minute and a half** ([CW-3](#cw-3)). After a Cancel or a closed window, the site's next `enable()` calls were refused at once with "The user declined." No window opened and the wallet showed nothing. A user who cancelled by mistake and clicks "Connect wallet" again sees nothing happen.
7. **Lovejoin hides whether mixing can happen, and when the money comes back** ([LJ-1](#lj-1), [LJ-2](#lj-2)).
   - The page shows a cost and an active Review. Only after Review does an alert at the very bottom say the pool "has 0 boxes to mix with … Mix fewer, or less deep", when the user is already at the minimum of one box.
   - "Back later: each box on its own, after 1 to 6 hours" leaves out that boxes only come back while the wallet is unlocked.
8. **Staking's destructive actions look routine, and progress shows on the wrong control** ([ST-1](#st-1), [ST-2](#st-2), [ST-3](#st-3)).
   - Pressing "Stop staking" or "Retire as a DRep" greys the whole page for about 10 s, with "Building…" on *Withdraw rewards*, off-screen.
   - Pressing Yes/No/Abstain on a proposal greys all three for about 8 s, with no sign of which one was pressed.
   - Stop staking's review ends on the same teal **Send** as a payment, and so does every other staking, voting and swap review.
9. **Governance can't be read** ([GV-1](#gv-1), [GV-2](#gv-2)).
   - The proposal list is rows of "Info action · Open until epoch 320, which ends 22 Oct 2026" that differ only in type and date.
   - A proposal says "Koios has no title or summary for it", and its text is behind an `ipfs://` link Chrome can't open.
   - A DRep casts a "public and permanent" vote without being able to read what they're voting on.
10. **What a Seedelf is, and who can pay one, is never said where it matters** ([GS-4](#gs-4), [RX-1](#rx-1)).
    - The only definition sits behind the ⓘ on Create a Seedelf: "A Seedelf is a name you can give out. Anyone can pay it…".
    - Receive says, mid-paragraph, "Anyone with Seedelf Wallet can pay the name".
    - The user will give the 5eed… code to a friend on Eternl, or to an exchange, and it can't work.

Just outside the ten:

- The pool list cuts off its own warning badges ([ST-4](#st-4)).
- Rewards are counted in the balance but shown as if extra ([ST-6](#st-6)).
- "Total leaving" ignores the tokens that leave ([PY-5](#py-5)).
- Settings is still one 2,350 px page ([SE-1](#se-1)).

---

## 2. Workflow review

Each workflow: what the user wants, what the screens ask, where they diverge, and what had to be guessed.

### First run

- **Goal:** set up a wallet.
- **Asked:** Create new wallet or Restore wallet, with a "Network" select under them, and "Each opens in a full tab, which stays open while you write your phrase down."
- **Divergence:** a first-time user has no basis for the network choice ([FR-3](#fr-3)). The tab note is about writing a phrase down, which restoring doesn't involve.
- **Inferred:** what the expand icon at the top right does; what "private" means here.

### Create a wallet

- **Goal:** a working wallet with a safe backup.
- **Asked:** reveal 24 words → confirm three → set a password.
- **Divergence:**
  - Before the words come a paragraph and two callouts, one about "your Seedelfs" and "your public account", neither yet defined ([FR-4](#fr-4)).
  - At 1280×720, "I've written it down" ends 38 px below the fold once the words are revealed ([FR-5](#fr-5)).
  - On the confirm step, the word number sits inside each box and reads as typed text, and a word that isn't on the list only turns the border pink ([FR-6](#fr-6)).
  - After "Create wallet": a blank frame, then Home's Private tab at 0 ₳ ([FR-2](#fr-2), [GS-3](#gs-3)).
- **Inferred:** that the confirm words are random each time; that the password can't recover anything (it says so, in the paragraph).

### Restore a wallet

- **Goal:** get my wallet back.
- **Asked:** 24 boxes (12/15/24 toggle), then a password.
- **Divergence:**
  - In the panel every word over four letters is cut off ([FR-1](#fr-1)).
  - A wrong phrase gets "The phrase checksum is wrong" ([FR-7](#fr-7)).
  - Then the blank frame ([FR-2](#fr-2)).

### Getting started

- **Goal:** put money in and start using the private side.
- **Asked:** the Get started card on the Private tab: fund the public account → create your Seedelf → make ADA private.
- **Divergence:**
  - The card is below the fold in the panel ([GS-3](#gs-3)).
  - Only step 1 has a button.
  - The hero's reasons and the Create form give the opposite order ([GS-1](#gs-1), [GS-2](#gs-2)).
  - The Private tab's one live action, Receive, leads to a dead end: "Create a Seedelf" disabled, "Fund your public account first".

### Receive

- **Public:** QR, address, Copy (it turns to "Copied"), and the stake address folded under "Stake address, for staking only".
  - The "anyone can see what it receives" warning sits in a teal shield box, which reads as reassurance ([RX-4](#rx-4)).
- **Private:** the Seedelf's QR, its "whole name" in hex, and a privacy note.
  - It doesn't lead with the fact that only Seedelf Wallet can pay it ([RX-1](#rx-1)).
  - "Remove web-wallet" sits on the same screen ([RX-2](#rx-2)).

### Pay someone from the public account

- **Goal:** pay an address.
- **Asked:** To, Amount, optional tokens, recipients and note → Review → Send.
- **Divergence:**
  - The sticky Review covers the Note field and the privacy note, even at 1280×720 ([PY-8](#py-8)).
  - The review:
    - raises 0.5 ₳ to 0.97837 ₳, with a grey line under the summary ([PY-4](#py-4));
    - leaves tokens out of "Total leaving" ([PY-5](#py-5));
    - adds "Staking rewards collected 57.475311 ₳, already in your balance", which nobody asked for ([PY-6](#py-6)).
  - After Send, the balance collapses until the payment confirms ([HM-1](#hm-1)).

### Pay someone from the private balance

- **Goal:** pay a friend without it being traced to me.
- **Asked:** Send takes only a Seedelf name; an ordinary address is "Make public".
- **Divergence:**
  - Send now catches an address and links "Pay it with Make public", but the verb still says nothing about paying anyone ([PY-2](#py-2), *open call*).
  - Send has no Max; Make public has one ([PY-3](#py-3)).
  - Every private review explains "Send asks giveme.my to lend the collateral, then submits" ([PY-7](#py-7)).
  - On a refusal, "Refresh and review again" says "Sending…" ([PY-1](#py-1)).

### Create a Seedelf

- **Goal:** get something people can pay privately.
- **Asked:** an optional public tag, Pay with Public/Private, Review, Create Seedelf.
- **Divergence:**
  - The definition of a Seedelf is behind the ⓘ ([GS-4](#gs-4)).
  - "A stealth mint" labels the private option ([PY-11](#py-11)).
  - After Create Seedelf, the app returns to Home's *Private* tab with "Seedelf mint sent. Waiting for the network…", and every private action is disabled although the transaction was public ([HM-3](#hm-3), [HM-6](#hm-6)).

### Make private

- **Goal:** move public money into the private balance.
- **Divergence:**
  - The raised-amount notice is behind the sticky button at 360 ([PY-4](#py-4)).
  - With tokens, the button reads "Make 2.21103 ₳ private" and doesn't mention the four tokens that also move ([PY-5](#py-5)).
  - Afterwards neither balance shows the money in flight ([HM-2](#hm-2)).

### Activity and UTxOs

- **Goal:** what happened to my money?
- **Divergence:**
  - Counterparties are cut off at the end ("08:35 · a…").
  - Staking and governance transactions are plain "Sent −0.172673 ₳".
  - A payment just sent has no row in Public Activity ([AC-1](#ac-1), [AC-2](#ac-2)).
  - UTxOs is a home destination whose padlock icon is the same as the header's Lock ([AC-4](#ac-4), *open call*).

### Staking

- **Goal:** am I earning, and how do I change it?
- **Asked:**
  - The page opens on a six-row table of pool-operator statistics: Saturation, Margin, Cost per epoch, Pledge, Delegators, Blocks made.
  - Below it: Rewards, Voting power, Be your own DRep, Stop staking.
- **Divergence:**
  - Nothing says the ADA stays spendable or what it earns ([ST-7](#st-7)).
  - The rewards shown as "57.475311 ₳ rewards" are already inside the balance ([ST-6](#st-6)).
  - The pool list cuts its comparison data and warning badges ([ST-4](#st-4)), and its sorts put pools that pay nothing first ([ST-5](#st-5)).
  - Stop staking is a list row that ends on Send ([ST-3](#st-3)).

### Voting power and governance

- **Goal:** choose who votes for me; as a DRep, vote.
- **Divergence:**
  - Choosing "Your own DRep" without being one disables Review, and the reason and "Become a DRep" are below the fold ([GV-3](#gv-3)).
  - DReps are listed by name only, so test junk ("afsdfd") looks as real as anyone ([GV-5](#gv-5)).
  - Proposals can't be told apart or read ([GV-1](#gv-1), [GV-2](#gv-2)).
  - After each vote the user is sent to Home, and the proposal still says "Not voted" while it's pending ([GV-6](#gv-6)).

### Swap

- **Goal:** swap 10 ₳ for MIN.
- **Asked:** Home → dApps → Minswap → New swap → form → Review swap (1,922 px at 360, about three screens) → **Send**.
- **Divergence:**
  - Swap is four taps deep ([DX-6](#dx-6), *open call*).
  - Slippage is behind an unlabelled sliders icon ([DX-4](#dx-4)).
  - The review buries "the order's own minimum it can't read" in a nine-line paragraph ([DX-2](#dx-2)).
  - Refusals dead-end ([DX-1](#dx-1)).
  - Stop stays after the swap is filled.
  - The finished page never says how much MIN arrived ([DX-5](#dx-5)).

### Lovejoin

- **Goal:** mix 10 ₳.
- **Divergence:**
  - Whether mixing is possible shows only after Review ([LJ-1](#lj-1)).
  - "Waves" are defined only in Settings ([LJ-4](#lj-4)).
  - The return needs the wallet unlocked, which only an ⓘ says ([LJ-2](#lj-2)).
  - A failed mix appears nowhere ([LJ-5](#lj-5)).

### Connect and sign for a site

- **Goal:** use a site with this wallet.
- **Asked:** turn on Settings → Sites, then the connect window: public account or a private session.
- **Divergence:**
  - Connecting gives no confirmation ([CW-7](#cw-7)).
  - Sign windows hide what's paid ([CW-1](#cw-1)).
  - A locked wallet's window has no Decline and offers "Forgot password? Restore from your phrase" inside a popup a site opened ([CW-4](#cw-4)).
  - A cancelled site is refused silently for a while ([CW-3](#cw-3)).

### Several accounts

- **Goal:** add a second account.
- **Asked:**
  - "Look for the next account" answers "The next account in order has never been used on Preprod" and offers nothing more.
  - Adding it means typing 2 into "Account number" (placeholder "1338") and pressing "Add it" ([PA-1](#pa-1)).
- **Divergence:** once added, the "Public account" picker sits on every screen, including the Private tab ([PA-2](#pa-2)).

### Lock, unlock, forgot password, remove wallet

- **Works:** "Wrong password." is clear, and the typed "delete wallet" confirmation guards both deletions.
- **Divergence:**
  - Removing the wallet in the tab that created it lands on Create's step 1 with a brand-new phrase, with no "Wallet removed" ([FR-8](#fr-8)).
  - Both deletion screens explain "private sessions' one-time accounts" ([SE-4](#se-4)).

---

## 3. Screen-by-screen review

### Welcome

<a id="fr-3"></a>**FR-3 · P2 · A network choice on the first screen.**
- **Problem:** "Network [Preprod ▾]" sits under the two buttons, unexplained. Each create and restore step repeats "Creating a wallet on Preprod. Change network".
- **Why:** a newcomer can't make this choice. The one who touches it will choose by guessing.
- **Change:** default silently. Move the choice into a small "Use a test network" link that explains itself.

**FR-9 · P3 · Copy and icon.**
- "Each opens in a full tab, which stays open while you write your phrase down" doesn't fit Restore.
- The expand icon (Open in tab) has a tooltip only.
- "A private wallet for Cardano." is the whole pitch: nothing says what private means here.

### Create: the recovery phrase

<a id="fr-4"></a>**FR-4 · P2 · Three blocks of text before the words, two of them about undefined things.**
- **Problem:** first "Write these 24 words on paper…", then an amber callout, then "This phrase restores your Seedelfs only in Seedelf Wallet. Other Cardano wallets will show your public account and nothing else."
- **Why:** "Seedelfs" and "public account" haven't been introduced, so the one sentence about portability reads as noise.
- **Change:** keep the amber callout. Move the portability note to the end of onboarding, where the two balances are introduced ([GS-3](#gs-3)).

<a id="fr-5"></a>**FR-5 · P3 · The primary button is below the fold at 1280×720.**
- **Problem:** after Reveal, "I've written it down" spans 710–758 px in a 720 px viewport. There's no way to hide the words again.
- **Change:** keep the foot static (it no longer covers words), but trim the text above so it fits. Add "Hide".

<a id="fr-6"></a>**FR-6 · P2 · Confirm words: the number reads as content, and a bad word is shown by colour alone.**
- **Problem:** the boxes show "7", "8", "24" inside, as if typed. "jokes" (not a list word) only turns the border pink, and Confirm stays enabled. After Confirm: "Word 24 doesn't match. Check your written copy."
- **Change:** put "Word 7" as a label above the box. Say "not a recovery-phrase word" as soon as a word isn't on the list.

**FR-10 · P3 · Password step.** Works ("Use at least 12 characters (5 so far)", "Strong.", "The passwords don't match.").
- **Problem:** the paragraph "It encrypts your recovery phrase here; it can't recover your funds anywhere else" is accurate but long for a password field.

<a id="fr-2"></a>**FR-2 · P1 · A blank screen after Create wallet and Restore wallet.** *(open call, L-1)*
- **Problem:** for one to five seconds with the fakes (longer on a real network, where restore scans accounts) the page is empty except for the test-network banner and the footer. There's no header, spinner or words.
- **Why:** this is the moment the user has just typed their phrase. A blank page reads as a crash, and the reflex is to reload or close.
- **Change:** "Setting up your wallet…" with a spinner in the same frame. On restore, add "Looking for your accounts…".

### Restore and Check recovery phrase

<a id="fr-1"></a>**FR-1 · P1 · The word grid cuts off words in the side panel.**
- **Problem:** at 360 px the grid stays four columns, and each input is 46 px wide. Measured: "together" and "electric" need 79 px. What shows is "aban", "toge", "elec".
- **Why:** restoring means copying 12–24 words from paper. The user can't check what they typed, and a mistake surfaces only at the end, as "checksum is wrong". Check recovery phrase uses the same grid, so its one purpose, checking the copy, is undermined.
- **Change:** two columns below about 420 px (three up to the tab width), or a smaller number prefix with the input filling the cell.

<a id="fr-7"></a>**FR-7 · P2 · "The phrase checksum is wrong; check the words and their order."**
- **Problem:** "checksum" is a developer word, and the message can't say which word is wrong.
- **Change:** "These words don't make a valid recovery phrase. Check each word, and their order."

**FR-11 · P3 · The word count defaults to 24 everywhere.** Check recovery phrase opens on 24 words for a 12-word wallet, although the wallet knows the length.

### Home: a new wallet

<a id="gs-1"></a>**GS-1 · P1 · Two opposite orders on one screen.**
- **Problem:** the Private tab's hero shows Send, Make public and Create disabled, under one reason: "Make some ADA private first: these are paid from your private balance". The card below says "2 Create your Seedelf: Your public account pays for it, before any money is made private." For Create, the hero's reason is wrong: the default pays from the public account.
- **Why:** the user who reads both doesn't know which to believe. The user who reads only the hero makes ADA private first, which is exactly the order the card warns against.
- **Change:** give Create its own reason ("Fund your public account first: it pays for your Seedelf"), or hide Create from the private hero until there's a private balance.

<a id="gs-2"></a>**GS-2 · P1 · The Create link from the Public tab ends in the wrong advice.**
- **Problem:** on an empty wallet, the Public tab's callout says "Create your Seedelf before making money private" with a "Create a Seedelf" link. The form opens with both "Pay with" options disabled, "Private balance" pre-checked, and "A stealth mint…" explained. Review is still live. Pressing it says "Your private balance is empty. Make some ADA private first; the Seedelf is paid from there."
- **Why:** the user did what they were told, and the wallet tells them to do the opposite. The real blocker, an empty public account, is never named.
- **Change:** when neither side can pay, disable Review and say "Fund your public account first: it pays for your Seedelf", with Receive's address one tap away. Pre-select Public when both are empty.

<a id="gs-3"></a>**GS-3 · P2 · A new wallet opens on the tab where nothing works.** *(open call: open on Public)*
- **Problem:** it lands on Private at 0 ₳ with three disabled actions. The live one, Receive, leads to "Create a Seedelf" (disabled) and "Fund your public account first: it pays for the Seedelf". In the panel the Get started card starts below the fold, and only step 1 has a button.
- **Change:** open on Public until there's a Seedelf. Give each Get started step its button, and make the current step the screen's primary action. End onboarding with one screen introducing the two balances.

<a id="gs-4"></a>**GS-4 · P1 · "Seedelf" is defined only behind an ⓘ on Create a Seedelf.**
- **Problem:** Home, Get started, Receive and the phrase step all use the word. The definition ("A Seedelf is a name you can give out. Anyone can pay it, and each payment lands in a new spot only you can open…") appears only when the ⓘ on Create a Seedelf is opened.
- **Why:** every private screen assumes the concept, and the user meets it first as a disabled button.
- **Change:** one sentence in Get started's step 2, and the same sentence on the onboarding intro. Fix "Anyone can pay it" there ([RX-1](#rx-1)).

**GS-5 · P3 · Back goes to a place the user didn't come from.** Private Receive → "Show my public address" → Back lands on Public Home, not on the private Receive screen.

### Home: balances, header and status

<a id="hm-1"></a>**HM-1 · P1 · A pending payment collapses the balance.**
- **Problem:** after sending 10 LINK and 1.16 ₳ from 10,408.014036 ₳, a refresh during the pending window shows "Public account 69.475311 ₳". LINK (550,999,000) and the tUSDM-named token disappear from Tokens. The wallet subtracts the whole coin it spent and adds nothing back until the change confirms. On a real network that's about a minute, and longer when Koios is slow.
- **Why:** this is the moment the user is most anxious. They'll think they sent everything, or that something took it.
- **Change:** show the expected balance after ("10,406.67 ₳, 1 payment pending"), and keep the change's tokens listed as "returning".

<a id="hm-2"></a>**HM-2 · P2 · Nothing shows money in flight.**
- **Problem:** after Make private, Private stays at 28 ₳ with no "+1.45678 ₳ incoming". Public Activity has no row for a payment just sent, while Private Activity shows one ("Pending").
- **Change:** an "incoming" line under the receiving balance, and a pending row on both Activity lists.

<a id="hm-3"></a>**HM-3 · P2 · One transaction in flight locks both sides.**
- **Problem:** a Seedelf paid from the public account leaves private Send, Make public and Create disabled ("Wait for the last transaction to confirm"). On Staking and governance every button is disabled, and that page gives no reason at all.
- **Change:** lock only what spends from the side in flight, and say the reason on every screen that disables.

<a id="hm-4"></a>**HM-4 · P2 · A submit that Koios didn't answer reads as a hold-up of hours.**
- **Problem:** at submit with Koios failing: "Payment may have gone through. Waiting for the network… The wallet sends it again now and then, which is safe… New payments wait until it lands, or until it can't any more: it can land until about 01:17, and the wallet waits half an hour past that to be sure."
  - It was 23:17 at the time; the time has no date and crosses midnight.
  - There's no "Check now" and no countdown.
  - Once Koios answered, the banner turned to "Payment sent" within a minute.
- **Why:** "may have gone through" with a two-hour horizon makes people pay twice, or give up.
- **Change:** lead with "Not confirmed yet: don't pay again". Add "Check now". Say "the wallet keeps trying", and give the far horizon as a duration only on Details.

<a id="hm-5"></a>**HM-5 · P2 · A failed refresh contradicts itself.**
- **Problem:** the alert says "Couldn't refresh: showing your balances from 44 s ago", frozen. The line under the tabs says "Updated 40 s ago" and keeps ticking. "Details" is a separate disclosure outside the alert, and reveals "Koios is having trouble right now (500 for account_info)". The alert stays after Koios recovers, until Try again is pressed.
- **Change:** one timestamp. Details inside the alert, in plain words. Clear the alert by itself on the next successful read.

<a id="hm-6"></a>**HM-6 · P2 · After an action, Home opens on Private and stale.**
- **Problem:** a public-paid Create Seedelf, a withdrawal and a vote all return to Home's Private tab. The status line read "Updated 4 min ago" with the transaction just sent. A reload also drops the tab choice.
- **Change:** return to the side the action spent from, refresh on return, and remember the last tab.

<a id="hm-7"></a>**HM-7 · P2 · The chrome above the balance grows to half the panel.**
- **Problem:** at 360×640 with two accounts and a failed refresh, the stack is: brand row, "Public account" picker, test-network banner, the alert, "Details", the tabs, "Updated…". The balance starts at about y=490 and the actions at 600. At 360×480 the balance sits on the bottom edge.
- **Change:** fold the picker into the brand row (an account chip), shrink the test banner to the badge after first view, and put the refresh status in the tab row.

<a id="hm-8"></a>**HM-8 · P2 · Tokens: the warning is inconsistent, and titles are fingerprints.**
- **Problem:** Home flags only the impostor ("asset1synt…ctusdm · Calls itself tUSDM, not on the wallet's list", in orange). LINK, VEGA, RIGEL and SIRIUS look normal, yet their detail, the review and Activity call them "Not on the wallet's list". In the panel a title is cut twice ("asset13vxx…6fm…"). Each token is a card inside the Tokens card.
- **Change:** one "Unverified" badge on every unlisted token, everywhere, with the name it claims in quotes. Rows with dividers, not cards in a card.

<a id="hm-9"></a>**HM-9 · P2 · Hide balances stops at Home.** With balances hidden, Send still says "28 ₳ in your private balance", Make private says "66.475311 ₳ available (includes 57.475311 ₳ of rewards)", and reviews show full amounts. Activity and UTxOs do mask. If hiding is for screen-sharing, every screen has to honour it.

<a id="hm-10"></a>**HM-10 · P2 · Destinations are split by tab.** *(open call: UTxOs behind Advanced, Swap on Home)*
- **Problem:** dApps (and with it Swap and Lovejoin) appears only on Private Home, at the fold in the panel, as a plain row beside Activity and UTxOs. Staking only appears on Public. UTxOs is on both.
- **Change:** a home that doesn't depend on the tab for these, and expert pages behind Advanced.

**HM-11 · P3 · Status words describe mechanism.**
- "Seedelf mint sent. Waiting for the network…" says mint where the user pressed "Create Seedelf".
- "Reading the chain…" means "Updating…".

**HM-12 · P3 · Public Home's strongest button is Make private.** Send and Receive are outlined; the filled teal is Make private. It's deliberate (private by default), but a user who wants to pay will press the bright one. Nothing says what it does until the next screen.

### Receive and your Seedelfs

<a id="rx-1"></a>**RX-1 · P1 · Private Receive doesn't lead with who can pay it.**
- **Problem:** "Anyone with Seedelf Wallet can pay the name, and nobody can tell the payment is yours" is the second sentence of a paragraph. Create's ⓘ says "Anyone can pay it".
- **Why:** someone who wants to be paid privately gives the 5eed… code to a friend on Eternl, or to an exchange. It can't work, and nothing warned them.
- **Change:** the first line, above the QR: "Only someone using Seedelf Wallet can pay this. Anyone else needs your public address." Fix the ⓘ to match.

<a id="rx-2"></a>**RX-2 · P2 · Removing a Seedelf sits on the Receive screen.**
- **Problem:** "Remove web-wallet" is a text button under the QR, on the screen the user opens only to copy something.
- **Change:** move it to a Seedelf's own page (or behind "Manage").

<a id="rx-3"></a>**RX-3 · P2 · Remove a Seedelf asks a question the wallet says it can't answer.**
- **Problem:** "This wallet doesn't know who paid for this Seedelf… Send it back to the side that paid, so it links nothing new." The user doesn't remember either. "Removing burns the Seedelf's token" is mechanism.
- **Change:** pre-select the side it can infer. Otherwise default to the more private side, and say what each choice reveals in one line each.

<a id="rx-4"></a>**RX-4 · P3 · Public Receive.**
- The warning "This is an ordinary Cardano address: anyone can see what it receives" sits in the teal shield box the wallet uses for privacy notes, which reads as "this is safe". Use the amber style for a disclosure the user should act on.
- "Give out one of your Seedelfs' names instead" has no link.
- At 1280, a lone "z" of the stake address wraps onto its own line.

### Send (public)

<a id="py-8"></a>**PY-8 · P2 · The sticky Review button covers the form's last fields.**
- **Problem:** at 360 it covers the Note field and the privacy note. At 1280×720 it still covers the privacy note. Build errors stack inside the foot and push it over the form. On private Send's refusal the foot grew to about 200 px, over the review's rows.
- **Change:** bottom padding equal to the foot. Errors go next to what failed, not in the foot.

<a id="py-9"></a>**PY-9 · P2 · Validation fires early, late or not at all.**
- **Problem:**
  - A letter or "-" in Amount keeps the old number, shows "Enter an amount in ADA, like 25 or 12.5.", and leaves Review enabled with the old value.
  - 0 or blank disables Review with no reason.
  - An added token is red at once ("Enter an amount, or take it off.").
  - Typing "Bo" to find a contact says "That isn't a Cardano address": contacts aren't searched from To, only through a "Contacts" link that appears once one exists.
- **Change:** validate on blur, give every disabled Review a reason, and let To search contacts by name.

<a id="py-10"></a>**PY-10 · P2 · Error messages name the wrong thing.**
- **Problem:**
  - A mainnet `addr1…` gets "Payments go to a normal preprod address: not a script, stake or other network's address"; a stake address gets the same.
  - Too much: "Not enough ADA in the Cardano account for this payment, its fee and the change". "Cardano account" is a third name for the public account, "change" is jargon, and Max isn't offered.
- **Change:** "That's a mainnet address; this wallet is on Preprod." / "That's more than you can send: up to X ₳ after the fee. Use Max."

<a id="py-4"></a>**PY-4 · P2 · The review raises the amount and says so in small print.**
- **Problem:** 0.5 ₳ becomes 0.97837 ₳ on Send, and 1 ₳ becomes 1.45678 ₳ on Make private. The explanation ("Raised from 0.5 ₳: 0.97837 ₳ is the least ADA the network accepts in a payment.") is grey text under the summary. On Make private at 360 it's behind the sticky button.
- **Change:** say the minimum on the form as the user types. On the review, mark the Amount row "raised from 0.5 ₳".

<a id="py-5"></a>**PY-5 · P2 · Totals leave out what else leaves.**
- **Problem:**
  - "Total leaving your public account 5.195025 ₳" while 100 LINK and 1,000,000,000 VEGA also leave.
  - Make private's button reads "Make 2.21103 ₳ private" while four tokens move with it.
  - With two recipients, one of them the user's own address, the review shows "To all recipients 7 ₳ and 2 tokens" beside "Total leaving 5.197973 ₳". The own-address warning doesn't say which recipient it means.
- **Change:** "5.195025 ₳ + 2 tokens" in the total and on the button, and name the recipient in the warning.

<a id="py-6"></a>**PY-6 · P2 · "Staking rewards collected" appears on payments nobody asked to collect.**
- **Problem:** every public review (send, make private, create a Seedelf) shows "Staking rewards collected 57.475311 ₳, already in your balance", because Settings' "Use staking rewards when spending" is on by default.
- **Why:** the user didn't ask to withdraw anything, and "collected" next to a payment reads as a charge.
- **Change:** "Your 57.48 ₳ of staking rewards are moved into your balance with this payment", with a link to the setting.

<a id="py-7"></a>**PY-7 · P2 · Reviews and their details sheet speak operator.**
- **Problem:**
  - Private reviews end with "Send asks giveme.my to lend the collateral, then submits."
  - The Transaction details sheet says "Signed: 2 signatures so far" before Send is pressed, which implies it's already gone. It also says "Spends 1 UTxO", "#0 · a key that stakes", "Valid until slot 135504880" and "Raw CBOR", in cards three levels deep. The user's own change address isn't marked as theirs.
- **Change:** keep the details sheet for experts, labelled as such. Drop the giveme.my sentence from the review: the privacy policy and Settings → About already say it. Say "Ready to send" before Send.

**PY-12 · P3 · Smaller Send issues.**
- A pasted note is cut to 64 characters without a word (the counter shows "64/64").
- Max disappears with two recipients, and the Amount placeholder flips between "0" and "Minimum".
- The token picker's "Select all" disables itself, with no "Clear".
- "A Seedelf's name is 64 hex characters starting 5eed0e1f." is developer wording.
- Max's placeholder is cut: "Max, up to 10,408.01".

### Private Send and Make public

<a id="py-1"></a>**PY-1 · P1 · "Refresh and review again" says "Sending…".**
- **Problem:** after a refusal ("Nothing was sent. Something it spends may have been spent or changed since you reviewed it: build it again from the chain as it is now."), pressing "Refresh and review again" with a slow backend shows a disabled **"Sending…"** in the foot for several seconds. Then the same review returns with the same numbers, and no sign that anything was refreshed.
- **Why:** the user deliberately didn't send. Seeing "Sending…" means money is moving without their say-so.
- **Change:** "Building a new review…", then a one-line "Updated just now" on the review.

<a id="py-2"></a>**PY-2 · P2 · Paying an ordinary address from private is still called "Make public".** *(open call)*
- **Problem:** private Send now answers an address with "That's an ordinary address, not a Seedelf's name. Send pays Seedelfs; Make public pays any address from your private balance, and that payment shows at their end." and a "Pay it with Make public" link. That's the right routing. The destination screen is still titled "Make public", its review "Review the payment", and its button "Send": three names for one act.
- **Change:** name it by outcome ("Pay an address"), and keep the disclosure that the payment shows at their end.

<a id="py-3"></a>**PY-3 · P2 · Private Send has no Max.** Make public has one. Sending a whole private balance to a Seedelf means guessing the fee.

**PY-13 · P2 · Field help on Make public speaks to the vendor, not the user.**
- "A Cardano address, or an ADA Handle like $name. Looking up a handle tells Koios which one."
- Max: "Everything in your private balance, up to 20 UTxOs at once, with every token, less the fee. Spending them together ties them to each other."

The disclosures are right; the words aren't ("a public server learns which handle you looked up"; "up to 20 separate amounts at once").

**PY-14 · P3 · Make public's review.**
- The amount row is labelled "Everything".
- The token row has no label.
- The privacy note above ("Making money public where it came from links it back. Send it somewhere else, or keep it private.") needs a second read.

**PY-15 · P3 · Private Send's always-on timing note.** "Sending right after making money private is easy to match by timing" shows on every private Send, including for money that arrived weeks ago. Show it only when a Make private is recent.

### Create a Seedelf

<a id="py-11"></a>**PY-11 · P2 · The form's words are mechanism.**
- **Problem:**
  - "Tag (optional, and public)", with "With no tag, it's listed by its name alone, starting `5eed0e1f…`".
  - The private option is introduced as "A stealth mint".
  - The review lists "Seedelf name 5eed0e1f736176696e677300ad8d…".
- **Change:** "Label (optional, anyone can see it)", and "Pay privately" for the option. The hex belongs under Details here, and on Receive it's the thing to share ([RX-1](#rx-1)).

### Make private

Covered by [PY-4](#py-4), [PY-5](#py-5) and [HM-2](#hm-2). The form itself is simple and clear.

### Activity and UTxOs

<a id="ac-1"></a>**AC-1 · P2 · Activity can't name the other side.**
- **Problem:**
  - Counterparty addresses are cut at the end ("08:35 · a…", "addr_test1wz2te2wqn85yllvs69grz6a5fsc6…"), which drops the tail people compare. Other screens cut in the middle.
  - Five recent rows go to the same unlabelled script address.
  - Staking, DRep and vote transactions show as "Sent −0.172673 ₳" with nothing else.
- **Change:** middle-ellipsis everywhere. Label known scripts (Seedelf, Lovejoin, Minswap), and give each row a kind ("Staked", "Voted", "Made private").

<a id="ac-2"></a>**AC-2 · P2 · Activity's error has no way back.** "Koios is having trouble right now (500 for account_txs)" in a red card with a large gap above it, no Try again, and no "Updated".

**AC-3 · P3 · Activity details.**
- Dates are mixed: "24 Sept 2026" in headings, "24/09/2026, 08:35:05" in the detail.
- The detail's "Amount −4.185521 ₳" includes the fee, which is listed again below.
- There's no filter or search.
- "Save as CSV" saves only the rows loaded so far (20 at a time), with no confirmation.
- A private row titled "Already in your private bal…" is cut off and unexplained.

<a id="ac-4"></a>**AC-4 · P2 · UTxOs: one icon, two meanings, and silent changes.** *(open call: behind Advanced)*
- **Problem:**
  - Each row's padlock is the header's Lock-the-wallet icon.
  - Locking a UTxO is instant, with no message.
  - The detail's big primary button is "Lock", above "Output 0", "Block 4,985,492", and an address that isn't the Receive address, with no word on why.
- **Change:** "Keep aside" with its own icon and a toast; mark the address as "your account's change address".

### Staking and governance

<a id="st-1"></a>**ST-1 · P1 · Building progress shows on the wrong control, or nowhere.**
- **Problem:**
  - Pressing "Stop staking" or "Retire as a DRep" (rows at the bottom of the page) greys the row and the whole page for about 10 s, while "Building…" appears on *Withdraw rewards*, off-screen (and, for a DRep, also on "Delegate your voting power to it").
  - On a proposal, Yes, No and Abstain all grey out for about 8 s, with no spinner and no sign of which was pressed.
- **Why:** a user who scrolls up sees "Building…" on Withdraw and thinks they've started a withdrawal. A voter can't tell whether they pressed Yes or No.
- **Change:** progress on the pressed control ("Preparing your Yes vote…"), or one page-level "Preparing the review…".

<a id="st-2"></a>**ST-2 · P2 · Every staking, governance, swap and mix review ends on "Send".**
- **Problem:** staking, withdrawing, stopping, registering as a DRep, delegating a vote, voting, swapping, mixing and funding a site session all end on **Send**, under "Nothing is sent until you press Send". Titles drift too: "Review stopping", "Review retiring", "Review the vote" (delegating) next to "Review your vote" (voting).
- **Change:** the verb on the button: "Stake with TPREP", "Withdraw 57.48 ₳", "Stop staking", "Cast Yes vote", "Start swap", "Start mix", "Fund session". Titles that name the act: "Review: who votes for you".

<a id="st-3"></a>**ST-3 · P1 · Stopping staking and retiring as a DRep look like any other row.**
- **Problem:** both are plain navigation rows (Retire sits next to "Profile"), and both reviews end on the normal teal Send. Stop staking explains itself in one line: "Your pool and your voting power's delegation end, and no more rewards come." It doesn't say staking can be restarted any time, what happens to rewards already in progress, or that the 2 ₳ is the deposit coming back. Retire's review lists only the refund and fee.
- **Change:** danger styling, a two- or three-line consequences list, and the act as the button's verb ([ST-2](#st-2)).

<a id="st-4"></a>**ST-4 · P1 · The pool list cuts off its own data and warnings at 360.**
- **Problem:**
  - Each row's second line is cut: "pool15dczkrr7xjw…kwklxj · 1% m…". Margin and cost never show.
  - "Keeps all rewards" is cut to "K…", or is missing on ticker-less pools.
  - Sorting by "Highest pledge" doesn't show the pledge.
  - On the staking page, the pool ID runs past the card (measured from x=201 to 381 in a 360 px viewport).
- **Change:** a second line for margin, cost and the sorted value. Warning badges never truncate.

<a id="st-5"></a>**ST-5 · P2 · Every sort puts pools that pay nothing first.**
- **Problem:** "Least saturated" opens on 0 %-full pools (which make no blocks). "Highest pledge" opens on 100 %-margin pools. The default is A–Z, and nothing sorts by expected return.
- **Change:** a return-based default. Hide or sink pools at 100 % margin or with no blocks.

<a id="st-6"></a>**ST-6 · P2 · Rewards are counted in the balance, then shown as if extra.**
- **Problem:**
  - The Public card reads "LOGIC · 57.475311 ₳ rewards", which reads as on top of 10,408 ₳, though they're already inside it.
  - The withdrawal review says "Rewards withdrawn 57.475311 ₳" and then a balance after that's *lower* than before (by the fee).
  - With "Use staking rewards when spending" off, the balance still includes rewards it won't spend. In a low-funds state Home showed 60.475311 ₳ while every action said "Your public account is empty".
- **Change:** "includes 57.48 ₳ of rewards" under the balance. On the withdrawal: "Your balance stays the same: these rewards were already counted." With the setting off, show spendable and rewards apart.

<a id="st-7"></a>**ST-7 · P2 · The staking page answers questions nobody asked first.**
- **Problem:**
  - It opens on Saturation, Margin, Cost per epoch, Pledge, Delegators and Blocks made, in a card inside a card, with the ⓘ alone under the table.
  - Nothing says "your ADA stays in your wallet and stays spendable".
  - Changing pools shows "Rewards start after about 15 to 20 days" to an account that's already earning.
  - Two near-identical privacy notes sit around Stop staking.
  - The page is 1,495 px at 360 (about 2,000 as a DRep).
- **Change:** lead with "Staked with LOGIC · earning · your ADA stays spendable", with the operator table under "Pool details". Different copy for switching pools.

<a id="st-8"></a>**ST-8 · P2 · An oversaturated pool gets almost no friction.** TPREP at 458 % full: the warning ("every delegator's rewards shrink") has no numbers, "Stake with TPREP" stays the primary button, and the review drops the warning. Say "about 4.6× over: you'd earn about a fifth"; keep it on the review.

<a id="st-9"></a>**ST-9 · P1 · With no spendable ADA, staking actions fail with the wrong reason.**
- **Problem:** withdrawing rewards or retiring as a DRep fails, after a 10 s build, with "Your public account is empty. Staking needs ADA for the fee, and a 2 ₳ deposit the first time." The account isn't empty (it holds rewards), and no deposit applies to either act.
- **Why:** this is where a user lands after doing what the wallet encourages, making their public money private. Rewards can't pay their own withdrawal fee, and the message offers no way forward.
- **Change:** check up front. "You need about 1 ₳ of spendable ADA in your public account to pay the fee", with Receive and Make public buttons.

**ST-10 · P2 · Staking errors.**
- Errors are grey body text with no Try again: "Koios is having trouble right now (500 for pool_info)", "(500 for tip)".
- A pool picked from the wallet's own list can fail with "Koios doesn't know that pool. Check its ID."
- With Koios failing, a registered DRep's card falls back to "Be your own DRep", and "Governance actions" disappears.

**ST-11 · P2 · Back from a staking review loses the choice.** Voting power resets to "Always abstain", so the search and pick must be redone. The pool review's Back skips the pool detail and clears the search.

**ST-12 · P3 · Staking polish.**
- "Saturation 18.8%" on the page vs "18.81% full" in the list (458.39 % vs 458.48 % for TPREP): two names and two roundings for one number.
- Badges touch the names: "LOGICYours", "TPREPOversaturated".
- Pool search can't find "Logical Mechanism", only tickers and IDs.
- The pool list's Refresh and "Updated" stamp sit after 50 rows (about 3,400 px).
- "500 ₳" wraps with ₳ alone on the next line.
- All four voting options share one bank icon.
- A disabled "Your pool" button is used as a status label.
- Epochs ("Open until epoch 320", "Inactive since epoch 189") where dates would do; the dates are already computed beside some of them.

<a id="gv-3"></a>**GV-3 · P1 · "Your own DRep" without being one: a disabled Review and a hidden reason.**
- **Problem:** what's visible is a disabled Review. The reason ("This account isn't a DRep yet…") and the "Become a DRep" button are below the fold, behind the sticky foot.
- **Change:** the explanation under the option, and the foot's button becomes "Become a DRep".

<a id="gv-1"></a>**GV-1 · P1 · Proposals can't be told apart.**
- **Problem:** the list is five "Info action · Open until epoch 320, which ends 22 Oct 2026" rows and two "Treasury withdrawal" rows, identical but for type and date. The fixtures carry no titles, but real proposals often have no Koios metadata either, and the list has nothing else to show.
- **Change:** a short action ID and the proposal date on each row, and the title whenever there's one.

<a id="gv-2"></a>**GV-2 · P1 · A proposal can't be read before voting on it.**
- **Problem:** the detail says "Koios has no title or summary for it", and "Its full text" is an `ipfs://…` link Chrome can't open. A treasury withdrawal shows no amount and no recipient. Beside the buttons: "Every vote is public and permanent", and once voted, "You voted Yes. A new vote replaces it, until voting closes." The two sentences contradict each other.
- **Change:** a gateway link (or gov.tools) for the text. The amount and recipient on treasury withdrawals. "Public, and final once voting closes."

<a id="gv-5"></a>**GV-5 · P2 · DReps can't be judged from the list.**
- **Problem:** rows are a name and a truncated ID, so "afsdfd" and "fsdafsfd" look as real as anyone. An inactive DRep's "Inactive since epoch 189" is buried after a name-impersonation paragraph and dropped from the review. "Your rewards unlock either way" brings in locked rewards, which are never explained.
- **Change:** status and voting power on each row. The inactive warning first, and kept on the review.

<a id="gv-6"></a>**GV-6 · P2 · Each vote is a round trip through Home.**
- **Problem:** after Send the user lands on Home, and the success toast shows only there. The voted proposal still says "Not voted" while pending, and every other vote is locked until it confirms. A DRep with several votes goes Home → Public → Staking and governance → Governance actions → proposal, once per confirmation.
- **Change:** stay on the proposal with "Your Yes vote is on its way", and mark it pending in the list.

**GV-7 · P2 · Becoming a DRep.**
- **Problem:**
  - Review stays enabled with too little ADA; after a 10 s build: "Not enough ADA in the Cardano account for this, its fee and the change", with no amounts.
  - Nothing says a DRep must vote or update before an expiry. The card shows "Active until epoch 340" with no consequence; only the profile edit screen says "An update keeps your DRep active, as a vote does".
  - The profile is an expert workflow: "publish it exactly as saved at an address anyone can read: IPFS…", "Its hash (blake2b-256)", "at most 128 bytes". Editing any field silently clears the address already pasted.
- **Change:** check the 500 ₳ up front ("You need 500.2 ₳; you have X"), say the duty in one line, and keep the pasted address unless the file changed.

**GV-8 · P2 · Unexplained governance terms.** "Info action" and "Treasury withdrawal" have no gloss. "Always no confidence" is explained with "constitutional committee", and its review has no warning that it's a standing vote against the governing committee.

**GV-9 · P3 · The DRep profile's directory switch.** "Ask DRep directories not to list it" is on by default, beneath copy saying a profile lets "others find it". The private default is intended; the copy should reconcile the two.

### dApps and swaps

<a id="dx-1"></a>**DX-1 · P1 · A refused swap, mix or site-session funding is a dead end.**
- **Problem:**
  - The swap review shows round one's message: "giveme.my, which lends the collateral, refused this transaction: Transaction Fails Validation. Its UTxOs may have been spent since the review: refresh, then review it again." There's no refresh, and Send stays enabled. Pressing it again: "That session was started already. Start a new one." That alert follows the user back to the form.
  - Each try uses up a session and leaves a "Failed" row.
  - Lovejoin's mix and the connector's funding end the same way ("That mix was started already").
- **Why:** this is where private Send already got its fix ("Refresh and review again"). The same refusal on these screens leaves the user retrying a button that can't work.
- **Change:** the same rebuild pattern on every review that can be refused. Swap Send for one "Build it again" action that starts a fresh session. Errors without service names. Clear the alert on navigation.

<a id="dx-2"></a>**DX-2 · P1 · The swap review admits, in passing, that it can't check what you'll get.**
- **Problem:** in a nine-line paragraph: "It checks that what Minswap built pays only this session, its order and Minswap's fee; the order's own minimum it can't read." This sits just before a Send that "places it and brings everything back without asking again".
- **Change:** verify the minimum, or make it its own warning: "The wallet relies on Minswap for the minimum of 902.08 MIN."

<a id="dx-3"></a>**DX-3 · P2 · The swap review is three screens of equal-weight text, and its costs don't add up.**
- **Problem:**
  - It's 1,922 px at 360.
  - It lists "You pay 10 ₳", then "For the swap 16 ₳", "Its collateral 5 ₳", "Network fee 0.233208 ₳", "Change 3.766792 ₳". The DEX fee and order deposit (2 ₳ each) are only in the collapsed quote. "Three transactions, three network fees" is never totalled.
  - The chosen slippage isn't on the review, and the minimum shown didn't match the 12 % set on the form (the fake quote is fixed, but the wallet didn't check it either).
  - The "Bring it back through Lovejoin" switch reads on, while the note under it says this swap's ADA "would come back directly".
- **Change:** three rows (you pay, you get at least, total cost) plus slippage. One risk line. Everything else under Details. The switch shows "unavailable" when it can't apply.

<a id="dx-4"></a>**DX-4 · P2 · The swap form hides the important settings.**
- **Problem:**
  - Slippage sits behind an unlabelled sliders icon, with no value on the form.
  - In its dialog the custom field shows a placeholder "2" while 1 % is selected, which looks like a set value.
  - 12 % is accepted with "At 12%, the order can be filled for that much less than the quote."
  - Max fills 16 of 28 ₳, and only the aria label says why ("As much ADA as a swap can take").
- **Change:** a "Slippage 1 %" chip, and a stronger warning above about 5 %. Max with a helper line ("Max 16 ₳: 5 ₳ collateral and fees stay aside").

<a id="dx-5"></a>**DX-5 · P2 · Swap sessions: Stop outlives the swap, and the end never says what arrived.**
- **Problem:**
  - Once the timeline says Filled and "Coming back into your private balance", **Stop** is still the sticky primary button. Its dialog still says "The order is cancelled, unless a batcher fills it first".
  - The Done page says "Done: the swap is in your private balance." and "Quoted about 906.5941 MIN", but never "Received".
  - While returning, the "It holds" table had a row with no label.
  - The failed page says "Not funded / It never reached the chain… Forget it: its account isn't used again", with no reason. Both "Failed" sessions later flipped to "Running" once the chain showed their funding, so "Failed" wasn't final.
  - Sticky feet cover the details card and the amber note at 360.
- **Change:**
  - Hide Stop once filled.
  - "Received 906.59 MIN and 131.58 ₳ back".
  - A reason and "Try again" on failure, and "Remove from list" only once the wallet is sure.

<a id="dx-6"></a>**DX-6 · P2 · Swap is four taps deep.** *(open call: Swap on Home)* Home → dApps (a plain row at the fold, under Tokens) → Minswap → New swap. The user has to know swapping lives under "dApps".

**DX-7 · P2 · Session names count failures.** Every failed try uses up a number. The first site session was "Private session 4", and the mix was "Private session 3". Name sessions by purpose ("Swap 10 ₳ → MIN", "dapp.example").

**DX-8 · P3 · dApps polish.**
- At 1280 the page keeps two ~155 px tiles and leaves a third of the column empty.
- Choosing ADA to receive while paying ADA closes the picker silently.
- The quote showed "You receive 906.5941" for both 1 and 500 ADA. That's the fake, but the wallet doesn't check the quote's input against the typed amount.

### Lovejoin

<a id="lj-1"></a>**LJ-1 · P1 · Whether mixing can happen shows only after Review.**
- **Problem:** with an empty pool on preprod, the page shows a cost and an active Review. Afterwards, an alert at the very bottom of the page: "Lovejoin's pool has 0 boxes to mix with, and a box 2 waves deep needs 8. Mix fewer, or less deep (Settings, Lovejoin)." The user is already at one box, the minimum. Mainnet's empty-pool seed offer shows up front; preprod's shortage doesn't.
- **Change:** pool status before Review ("Pool: 0 of 8 boxes needed at 2 waves"), Review disabled with that reason, and a direct "Mix 1 wave deep instead".

<a id="lj-2"></a>**LJ-2 · P1 · "Back later: Each box on its own, after 1 to 6 hours" leaves out the condition.**
- **Problem:** boxes come back "a few minutes into the first time the wallet is unlocked after its wait", and "locking partway stops them". Only the ⓘ on the mix review and Settings → Lovejoin say so.
- **Why:** a user who mixes and closes the browser expects their money back within six hours.
- **Change:** "Comes back 1–6 hours later, the next time you unlock Seedelf Wallet", on the page and in the review summary.

<a id="lj-3"></a>**LJ-3 · P2 · The cost is the biggest thing on the page, without context or a balance check.**
- **Problem:**
  - "Mixing 10 ₳ costs about 3.8 ₳, 38% of it" is the largest text on the page, with nothing on what it buys.
  - Settings quotes "about 3.5 ₳" for the same depth (the return fee isn't its own line).
  - Three boxes need 42.9 ₳ plus 5 ₳ of collateral against a 28 ₳ balance, with no warning.
- **Change:** what the cost buys in one line; one cost figure everywhere; cap the stepper at what the balance covers.

<a id="lj-4"></a>**LJ-4 · P2 · "Waves" are never defined where the choice matters.**
- **Problem:** the page shows "2 waves deep, 4 mixes" and can't change it. Settings offers 1–3 waves with "Which box coming out is yours stays one of up to 9", and no plain payoff.
- **Change:** a depth choice on the page itself, labelled by outcome (Light / Standard / Strong), with mixes and cost as secondary text.

<a id="lj-5"></a>**LJ-5 · P2 · A mix has no home.** The page has only "Your boxes in the pool: None", with no list of mixes in progress, failed or done. The failed "Private session 3" appeared on neither Lovejoin, Home nor dApps. During loading and failure the page still says "None", with Review enabled.

**LJ-6 · P2 · Mainnet's seed offer pulls attention from mixing.**
- **Problem:**
  - A full-width "Seed the pool with 30 boxes" (300 ₳) sits above Mix, though its copy says it's "for nothing you gain".
  - Mix → Review stays active although mixing is impossible.
  - The error says "Not enough ADA in the Seedelf balance", a fourth name for the private balance.
- **Change:** seeding as a secondary "Help start the pool" link; Mix disabled with the reason.

**LJ-7 · P2 · Where publicly mixed boxes end up is unclear.** The Public tab says "What the mixes don't use comes back to your public account". The note under both tabs says each box "comes back into your private balance on its own".

### Connector windows and sites

<a id="cw-1"></a>**CW-1 · P1 · Sign a transaction: the recipient and the linking warning are under the password.**
- **Problem:** at 400×605 the sticky "Your password, to sign" / Decline / Sign block (about 140 px) covers "Pays". The first view shows "Your public account sends, net 25.2 ₳", the fee, "It signs for 1 of your addresses" and half an address. The amber "It moves money between your public account and your private session 1. Signing ties them together on chain" appears only after scrolling.
- **Why:** a user can type the password and Sign without ever seeing who's paid or the warning.
- **Change:** recipients and every warning go in the top summary. Alternatively, the password block stays in the flow until the user has scrolled to the end.

<a id="cw-2"></a>**CW-2 · P1 · Connect, private session: the amount field is below the fold.**
- **Problem:** after picking "A private session", the window shows the two cards and a disabled **Review**. "What to put in it" is at about y=660 in a 605 px window, and nothing says why Review is disabled.
- **Change:** scroll to and focus the amount on selection, or label the button "Enter an amount".

<a id="cw-3"></a>**CW-3 · P1 · A cancelled site is refused silently.**
- **Problem:** after a Cancel or a closed window, the site's `enable()` calls rejected at once with "The user declined." (code −3). No window opened and the wallet showed nothing. Two retries within a minute were refused; after a second decline, a retry 45 s later was still refused, and one 90 s later worked.
- **Why:** a user who cancels by mistake clicks "Connect wallet" again and sees nothing happen. If the cooldown is deliberate (against prompt spam), it still has to say so.
- **Change:** open the window for a retry the user starts, or show "dapp.example was declined; it can ask again in N s". List declined sites in Settings → Sites.

<a id="cw-4"></a>**CW-4 · P2 · A locked wallet's window has no way out, and teaches a bad habit.**
- **Problem:** "Welcome back… https://dapp.example is asking for Seedelf Wallet. Unlock to see what it asks." There's no Decline. It offers "Forgot password? Restore from your phrase", inside a popup a website opened, which teaches users that sites can lead to typing their phrase. After unlocking, the sign screen asks for the password again.
- **Change:** add Decline, drop the restore link from this window, and skip the second password right after an unlock.

<a id="cw-5"></a>**CW-5 · P2 · Which account a site gets is stated but can't be changed where it matters.**
- **Problem:** with one account the window says "Your public account". With two: "It gets Account 1: sites always use the account Settings → Sites chooses, whichever one is on screen", even while the header shows Account 2, and the window can't change it. Sign message says "Signs as: Your address".
- **Change:** name the account everywhere ("Signs with Account 1"), with a "Change" link in the connect window.

<a id="cw-6"></a>**CW-6 · P2 · Site connections live in two places, and the session page tells the wrong story.**
- **Problem:**
  - Public connections are in Settings → Sites → Connected sites. Private sessions are in dApps → Sites. Each only hints at the other.
  - A session the user cancelled after a failed funding says "Not connected to its site: another of dapp.example's requests connected it meanwhile".
  - Its Disconnect dialog says "dapp.example stays connected as it is now" for a site already disconnected.
  - "Bring it back" is disabled with no reason at 0 ₳, while "Top up" is live for a session no site uses.
  - Three sticky buttons (about 150 px) cover its warnings.
- **Change:** one Connected sites list covering both kinds, linked from Home when a session holds money. A reason on every disabled action.

<a id="cw-7"></a>**CW-7 · P3 · Connector polish.**
- Connecting closes the window with no "Connected to dapp.example (Account 1)" anywhere.
- Two queued requests show "1 of 2" only in the subtitle, with no "Decline all".
- The connect window gives Public one line ("No fee") and the private session four dense lines of cost, which steers toward the less private choice.
- Connected sites rows sit flush against the card border, and "since 10/4/2026" is an ambiguous date.

**CW-8 · P2 · Settings → Sites and Collateral explain themselves in protocol terms.**
- **Problem:**
  - "CIP-30" in Sites' copy.
  - Collateral leads with "Setting it pays 5 ₳ from your public account to itself"; what collateral *is* sits behind the ⓘ, and "Not set" is never shown.
  - "Collateral" means three things across the wallet: the Settings item, a session's "Its collateral 5 ₳", and "giveme.my lends the collateral".
- **Change:** lead with status and purpose ("Not set. Some dApps need 5 ₳ kept aside to run contracts"). Use another word for a session's deposit.

### Public accounts

<a id="pa-1"></a>**PA-1 · P2 · Adding an account is a hunt.**
- **Problem:** "Look for the next account" answers "The next account in order has never been used on Preprod. A custom number may still have been: check one below." and offers nothing more. To add it, the user types 2 into "Account number" (placeholder "1338") and presses "Add it", a ghost button that looks disabled. "Account 2 is in the list now." appears at the very bottom.
- **Change:** "Add account 2" as the main button, with the custom number under Advanced.

<a id="pa-2"></a>**PA-2 · P2 · The account picker shows where it means nothing.**
- **Problem:** labelled "Public account", it sits on the Private tab (whose balance is the same for every account), on Check recovery phrase and on Settings. That suggests switching it changes the private balance.
- **Change:** show it on Public screens only, as a chip in the brand row ([HM-7](#hm-7)).

**PA-3 · P3 · Public accounts' text.** Two paragraphs ("Your private balance is shared…", "Look for the next account and Check it each ask Koios about one account…") explain query privacy before the user has an account to add. One sentence plus the ⓘ would do.

### Settings, lock and removal

<a id="se-1"></a>**SE-1 · P2 · Settings is one long page, and starts with its riskiest control.** *(round one's SET-1)* 2,350 px at 360 (2,464 in Spanish), seven sections, opening on the network switch. Long paragraphs:
- the network note;
- the language note ("Every language is in the wallet already: choosing one asks nobody anything…");
- About's list of services, in a card inside a card.

An index of sub-pages with Network further down would read as a menu.

<a id="se-2"></a>**SE-2 · P2 · The network switch shows Mainnet as chosen before it is.** Pressing Mainnet marks it pressed while the header still says PREPROD and the footer "Preprod". The confirmation ("Stay on Preprod" / "Switch to Mainnet") is inline and clear, but the control says it's already done. Leave Preprod pressed until confirmed.

**SE-3 · P3 · Settings row labels.**
- "Sites Off" and "Lovejoin On, 2 waves deep" (the "On" is "bring private sessions back through Lovejoin", not the mixer itself) read as switches for the features.
- "Collateral" is a top-level entry.
- "Use staking rewards when spending" doesn't say why one would turn it off, and doesn't link to staking.
- Back from Settings goes to Home's Private tab, not where the user came from.

<a id="se-4"></a>**SE-4 · P2 · Remove wallet and Forgot password explain an internal concept.**
- **Problem:**
  - Remove wallet: "What private sessions' one-time accounts hold doesn't show after a restore yet: bring it back first."
  - Forgot password adds "If a payment may still go through, an encrypted record of it stays in this browser: restoring this same phrase here watches it again…".
  - "(Show recovery phrase)" in the warning is plain text, not a link.
- **Change:** "If a swap or site session still holds money, bring it back first: [Go there]", and a link to Show recovery phrase.

<a id="fr-8"></a>**FR-8 · P2 · Removing the wallet lands on a new wallet's phrase.**
- **Problem:** in the tab where the wallet was created (the usual case, since Create opens a tab), the URL keeps `#create` on every screen. Agents saw `#restore` likewise. After "Remove wallet", the tab opens Create's step 1 with a brand-new phrase being generated. There's no "Wallet removed" message.
- **Why:** someone removing a wallet to restore another is now looking at a fresh phrase and a "Reveal" button.
- **Change:** clear the hash once the wallet exists, land on Welcome after removal, and say "Wallet removed from this browser".

**SE-5 · P3 · Lock and unlock work.**
- "Welcome back", "Wrong password.", and "Forgot password? Restore from your phrase".
- The only issue is the locked connector window ([CW-4](#cw-4)).

### Languages

Spanish and Japanese held their layout on Home, Make public and Settings at 360 px: no horizontal overflow, nothing clipped by the measurement. Numbers stay in English format ("1,234.56"), the known gap.

---

## 4. Navigation and information architecture

**The two-balance model is right, and it's still never introduced.**
- The first decision on Home is Private or Public, before the user knows why there are two.
- The words that carry the model are defined late or not at all: "Seedelf" behind an ⓘ two levels in ([GS-4](#gs-4)), "public account", "make private".
- The Get started card teaches an order but not the model, and the screen around it argues with it ([GS-1](#gs-1)).
- One screen at the end of onboarding would anchor everything after it: two balances, what a Seedelf is, who can pay one, and that money moves between them.

**The private balance has too many names, and so does the public account.**
- The private balance is "private balance", "Seedelf balance" (Lovejoin's error) and, implicitly, "your Seedelfs".
- The public account is "public account", "Cardano account" (two errors), "Account 1" and "Your address".

Each new name makes the user wonder whether it's a new place.

**Tabs decide where features live.**
- dApps, Swap and Lovejoin hang off Private only.
- Staking and governance hang off Public only.
- Activity and UTxOs are on both, with the same names and different contents.
- Site connections are split between Settings and dApps ([CW-6](#cw-6)).

A user who wants "everything I've done" or "swap from my public money" has no route.

**Verbs name mechanisms.**
- "Make private", "Make public", "Send" (for staking, voting, swapping and mixing), "mint", "Bring it back", "Forget it".
- Users think in pay, receive, swap, stake, vote and cancel. The button verb is the last thing read before a commitment, and it's "Send" for nine different commitments ([ST-2](#st-2)).

**Every action ends on Home.** Payments, Seedelf creation, withdrawals, votes and registrations all return to Home's Private tab, with the success shown only there ([HM-6](#hm-6), [GV-6](#gv-6)). The user loses their place, and in governance, where acts come in batches, they walk five screens back for each.

**Back has three behaviours.**
- Browser Back works but throws away a filled Send form.
- In-app Back from a review sometimes skips a level (pool review → list) and sometimes resets the choice (voting power).
- A reload always lands on Home's Private tab, because the hash never changes from `#create`/`#restore` ([FR-8](#fr-8)).

**Expert pages are first-class.** UTxOs is on Home; Collateral and "Account number" are top-level Settings entries; the transaction details sheet is one tap from every review. They belong behind an Advanced door *(open call)*.

**The tab is the panel, wider.** At 1280 px every screen is a ~490 px column centred in white space. Activity needs scrolling at 720 px high while two-thirds of the window is empty. Nothing uses the width, for example balance and activity side by side.

---

## 5. Visual system problems

<a id="v-1"></a>**V-1 · Sticky feet still cover content.** The rule from round one held on the phrase grid but not elsewhere:
- the sign window's recipients ([CW-1](#cw-1));
- the connect window's amount ([CW-2](#cw-2));
- Send's note field ([PY-8](#py-8));
- the raised-amount notice on Make private ([PY-4](#py-4));
- the DRep reason ([GV-3](#gv-3));
- pool IDs under "Stake with TPREP";
- the session pages' warnings ([DX-5](#dx-5), [CW-6](#cw-6)).

Errors stacking *in* the foot make it grow to a third of the panel. The rule needs to cover every screen: a last block padded by the foot's height, and errors beside what failed.

<a id="v-2"></a>**V-2 · Progress lives on the wrong element** ([ST-1](#st-1), [PY-1](#py-1)). The pressed control should carry its own progress label, and nothing else should change its label.

<a id="v-3"></a>**V-3 · Destructive actions have no visual class.** Stop staking, Retire as a DRep, Remove a Seedelf and "Forget it" use the normal row or normal teal button. Only Remove wallet is red. One danger style (red text button → red-outlined review button) would mark all of them.

<a id="v-4"></a>**V-4 · Boxes inside boxes.**
- Staking's stats table inside the pool card.
- The transaction details sheet (sheet → section card → definition card).
- Token rows as cards inside the Tokens card.
- Recipient cards holding token cards.
- Settings → About.
- The Lovejoin stepper inside its card.

One level of container per screen; lists use dividers.

<a id="v-5"></a>**V-5 · The teal shield box means "privacy note" and "warning" at once.** It carries reassurances ("A Seedelf's name is public… What's paid to it isn't.") and disclosures the user should act on ("This is an ordinary Cardano address: anyone can see what it receives"). Amber is used for some disclosures and not others. Pick one: teal for explanation, amber for "this exposes you".

<a id="v-6"></a>**V-6 · Truncation in the wrong place.**
- End-ellipsis on addresses in Activity ("08:35 · a…").
- Pool rows' "1% m…".
- Badges cut to "K…".
- Token titles cut twice.
- The restore words cut to four letters ([FR-1](#fr-1)).

Identifiers truncate in the middle, warnings never truncate, and inputs never clip their own content.

<a id="v-7"></a>**V-7 · Numbers.**
- Six decimals everywhere ("57.475311 ₳", "0.233912 ₳", "5,914,902.920642 ₳") *(open call: two decimals)*.
- ₳ wraps onto its own line in review totals ("1.153067 / ₳") and in "500 ₳": use a no-break space.
- Two roundings for one figure (saturation).
- Dates in three formats ("24 Sept 2026", "24/09/2026, 08:35:05", "10/4/2026").
- Epoch numbers where a date is already known.

<a id="v-8"></a>**V-8 · Icons with two meanings, or none.**
- The padlock is both Lock wallet and Lock UTxO ([AC-4](#ac-4)).
- One bank icon for four different voting choices.
- A sprout for "Create" that doesn't say Seedelf.
- An expand icon for "Open in tab".
- An unlabelled sliders icon for slippage ([DX-4](#dx-4)).
- A lone ⓘ under a table instead of after a heading (staking).

<a id="v-9"></a>**V-9 · Ghost buttons that look disabled.** "Check it" and "Add it" (Public accounts), "Name it", and the small grey pills read as inactive until hovered. A secondary button needs a visible edge.

<a id="v-10"></a>**V-10 · Vertical budget in the panel.** Brand row, account picker, test-network banner, alerts, tabs and the "Updated" line take 270–350 px of a 640 px panel before any balance ([HM-7](#hm-7)). At 360×480 the first screen is all chrome.

<a id="v-11"></a>**V-11 · Badges glued to names.** "LOGICYours", "TPREPOversaturated", "…5et0yyKeeps all rewards": no gap between a name and its badge.

---

## 6. Terminology problems

| Term as shown | Where | Why it's a problem | Suggested |
|---|---|---|---|
| Seedelf (undefined) | Home, Get started, Receive, phrase step | The product's core noun, defined only behind an ⓘ | Define once, early: "a private payment name only Seedelf Wallet can pay" |
| Seedelf "name" (the hex) vs "tag" | Receive, Send, Create | The visible word isn't the one that works | "Seedelf address" (share this) and "label" |
| Make public | Private Home, Send's redirect | Says nothing about paying anyone | "Pay an address" *(open call)* |
| Send (on staking, voting, swap, mix, funding reviews) | Every review | Nine different commitments, one verb that means "money leaves" | The act: "Stake", "Withdraw", "Stop staking", "Cast vote", "Start swap", "Start mix", "Fund session" |
| Sending… (while rebuilding) | Private Send's refusal | Says money is moving when it isn't | "Building a new review…" |
| mint, "Seedelf mint sent" | Status banner | Mechanism | "Creating your Seedelf…" |
| stealth mint | Create a Seedelf | Jargon | "Pay privately" |
| burns the Seedelf's token | Remove a Seedelf | Mechanism | "Removes the Seedelf" |
| Koios; "tells Koios which one"; "(500 for account_info / pool_info / drep_info / tip / account_txs / credential_utxos)" | Field help, every error | A vendor and its endpoints | "a public server"; "Can't reach the network service. Try again." Endpoints under Details |
| giveme.my; "lends the collateral" | Every private review, swap errors | Plumbing on the commit screen | Drop from reviews; keep in Settings → About and the privacy policy |
| collateral (three meanings) | Settings, session reviews, giveme.my | One word for three things | "Contract deposit" (Settings); "refundable deposit" (sessions) |
| UTxO(s), "up to 20 UTxOs", "Spends 1 UTxO", "UTxOs spent 1" | Home, Max help, details, collateral review | Cardano's accounting unit | "coins" or "separate amounts" |
| checksum | Restore, Check recovery phrase | Developer word | "These words don't make a valid recovery phrase" |
| Cardano account | Insufficient-funds errors | A third name for the public account | "public account" |
| Seedelf balance | Lovejoin's seed error | A fourth name for the private balance | "private balance" |
| change | Insufficient-funds errors | Accounting term | "the rest that comes back to you" |
| Reading the chain… | Home, reviews | Mechanism | "Updating…" |
| build it again from the chain as it is now | Private refusal | Developer phrasing | "Something changed. Make a new review." |
| Signed: 2 signatures so far | Transaction details, before Send | Implies it's already sent | "Ready to send" |
| a key that stakes; payment key | Transaction details, sign windows | Key internals | "your public account" |
| Valid until slot 135504880; Raw CBOR; Script data hash; mem · steps | Transaction details | Expert data | Under "Advanced details"; slot as a time |
| Everything (as a row label) | Make public's review with Max | Not a label | "Amount (all of it)" |
| one-time account; private session N | Swap, connector, Remove wallet | A concept never introduced; the number counts failures | "temporary account for this swap/site"; name sessions by purpose |
| Bring it back; Forget it; Stop | Session pages | Vague | "Return to private balance"; "Remove from list"; "Cancel swap and return funds" |
| boxes; waves deep; mixes; Seed the pool | Lovejoin, Settings | Mixer internals | "10 ₳ mixing units"; "Light / Standard / Strong"; "Help start the pool (gives you no privacy)" |
| batcher | Swap timeline, Stop dialog | DEX internals | "Minswap's order filler" |
| Saturation / % full | Staking, pool list | Two names, unexplained | One: "How full (over 100 % pays less)" |
| Margin; Cost per epoch; Pledge | Staking, pool list | Operator economics | "Pool's cut"; "Fixed fee every 5 days"; "Owners' own stake" |
| epoch 320; Inactive since epoch 189 | Governance, DReps | A unit users don't count in | Dates |
| DRep (first use) | Staking | Governance jargon | "voting representative (DRep)" on first use |
| Info action; Treasury withdrawal; constitutional committee | Governance | Unglossed | "Opinion poll (no on-chain effect)"; "Spending from the treasury: X ₳ to Y"; "the governing committee" |
| Its hash (blake2b-256); at most 128 bytes | DRep profile | Implementation detail | "File fingerprint (goes on chain)"; "keep the address under ~120 characters" |
| Your rewards unlock either way | Inactive DRep | Locked rewards are never explained | "You can still withdraw your rewards" |
| Review stopping; Review retiring; Review the vote / Review your vote | Review titles | Gerunds and near-twins | "Review: stop staking"; "Review: retire as a DRep"; "Review: who votes for you"; "Review: your vote" |
| CIP-30 | Settings → Sites | A standard's number | Drop it |
| Lovejoin On, 2 waves deep | Settings row | Names the wrong switch | "Mix session returns: On · Standard" |
| Account number (placeholder 1338) | Public accounts | A derivation index, with a joke placeholder | Under Advanced; no placeholder |
| Signs as: Your address | Sign message window | Which one? | "Signs with Account 1" |
| sends, net | Sign transaction window | Accounting term | "sends in total" |
| choosing one asks nobody anything; searching it asks no one | Language note, DRep search | Developer reassurance in odd English | "stays on this device" |
| preprod (lowercase) | Errors | The rest of the UI says Preprod | "Preprod" |

---

## 7. Missing UX states

**Loading**
- Create and restore: a blank frame ([FR-2](#fr-2)) *(open call)*.
- Building a staking or voting review: progress on the wrong control or none ([ST-1](#st-1)).
- Rebuilding after a refusal: "Sending…" ([PY-1](#py-1)).
- Picking a DRep on a slow backend: the row is just disabled for 4 s or more.
- Lovejoin and session pages: stale values ("None", "Updated just now") instead of placeholders while loading or failing.
- A refresh against a failing backend shows "Reading the chain…" for about 10 s before the error.

**Errors**
- No recovery action after a refusal on swaps, mixes and connector funding ([DX-1](#dx-1)). Private Send has one.
- No Try again on Activity ([AC-2](#ac-2)) or the staking page (ST-10).
- Home's refresh alert doesn't clear itself when the backend recovers ([HM-5](#hm-5)).
- The no-fee-money error is wrong and has no way forward ([ST-9](#st-9)).
- Nothing tells the user a site's `enable()` is being refused during the post-decline cooldown ([CW-3](#cw-3)).

**Empty states**
- An empty wallet's Create form offers Review and fails with the wrong advice ([GS-2](#gs-2)).
- An empty pool: no status before Review ([LJ-1](#lj-1)).
- No list of mixes (in progress, failed, done) ([LJ-5](#lj-5)).
- Present and fine: Contacts ("No contacts yet…"), token search ("No tokens match …"), NFTs ("No NFTs in this balance."), Connected sites, "No swaps yet."

**Pending**
- No pending amount on either balance; the public balance collapses ([HM-1](#hm-1), [HM-2](#hm-2)).
- No pending row in Public Activity.
- No confirmation progress ("1 of 3"); "Payment confirmed" stays until dismissed.
- Rewards, the pool and a voted proposal show no pending marker ([GV-6](#gv-6)).

**Success**
- Wallet created or restored: none.
- Wallet removed: none ([FR-8](#fr-8)).
- Site connected: none ([CW-7](#cw-7)).
- Swap done: no "received" amount ([DX-5](#dx-5)).
- Staking and governance successes show only on Home.
- No feedback after "Save as CSV" or locking a UTxO.
- Present: payment sent and confirmed banners with a Cardanoscan link and Dismiss; Copy → "Copied".

**Disabled states without a reason**
- Review at 0 or blank amount (Send).
- The connector's Review with no amount ([CW-2](#cw-2)).
- Voting power's Review for "Your own DRep" ([GV-3](#gv-3)).
- The staking page while a transaction is pending ([HM-3](#hm-3)).
- The DRep profile's two buttons.
- A site session's "Bring it back" at 0 ₳.
- Swap's "Switch what you pay and what you receive".
- Mix Review with an empty pool (it stays *enabled* and fails afterwards).

**Up-front affordability checks** are missing on:
- Become a DRep (500 ₳);
- staking and withdrawing with no spendable ADA;
- the Lovejoin stepper;
- Create a Seedelf when neither side can pay.

Each builds for 8–10 s and then fails.

**Destructive actions**
- Stop staking and Retire as a DRep have no destructive treatment ([ST-3](#st-3)).
- Remove a Seedelf is on Receive ([RX-2](#rx-2)).
- Browser Back discards a filled Send form without asking.
- The locked connector window has no Decline ([CW-4](#cw-4)).
- Present and good: Remove wallet and Forgot password (typed "delete wallet"), Disconnect site and Stop swap (confirm dialogs).
- No password is asked for the wallet's own sends, including Stop staking and Retire *(open call)*.

**Onboarding**
- The two balances and what a Seedelf is are never introduced ([GS-4](#gs-4)).
- Who can pay a Seedelf isn't said up front ([RX-1](#rx-1)).
- The checklist's next step isn't the screen's primary action, and two screens contradict it ([GS-1](#gs-1)–[GS-3](#gs-3)).

---

## 8. Recommended redesign priorities

The smallest set of changes for the largest improvement, in order.

1. **Outright bugs, each bounded:**
   - the restore grid's columns ([FR-1](#fr-1));
   - "Sending…" on a rebuild ([PY-1](#py-1));
   - Create's reason on the private hero, and the empty-wallet Create form ([GS-1](#gs-1), [GS-2](#gs-2));
   - the stale `#create` hash after removal ([FR-8](#fr-8));
   - the pool list's clipping ([ST-4](#st-4));
   - staking's progress on the wrong button ([ST-1](#st-1));
   - the network switch showing Mainnet early ([SE-2](#se-2)).
2. **One refusal pattern everywhere.** Private Send's "Refresh and review again" becomes the rule for every review that can be refused: swap, mix, connector funding ([DX-1](#dx-1)). Error copy goes with it: no service names, endpoints, "UTxOs" or "checksum" in a message; every error has an action; the raw text sits under Details ([HM-5](#hm-5), ST-10, [AC-2](#ac-2), [FR-7](#fr-7)).
3. **Pending accounting.** Show the expected balance after and any incoming amount, marked pending. Keep tokens listed. Lock only the side in flight, and say why on every screen that disables ([HM-1](#hm-1)–[HM-4](#hm-4)).
4. **Connector windows put what's paid and every warning above the password.** Focus the private amount on selection, and tell the user (and the site) about the decline cooldown ([CW-1](#cw-1)–[CW-4](#cw-4)).
5. **Verbs and danger.** The review button says the act. Stop staking, Retire, Remove a Seedelf and Forget it get one danger style and a consequences list ([ST-2](#st-2), [ST-3](#st-3), [V-3](#v-3)).
6. **The first-run model.**
   - One closing onboarding screen: two balances, what a Seedelf is, who can pay one.
   - Get started's next step is always the primary action.
   - Private Receive leads with "only Seedelf Wallet can pay this".
   - A new wallet opens on Public *(open call)* ([GS-3](#gs-3), [GS-4](#gs-4), [RX-1](#rx-1)).
7. **Totals that count everything:** tokens in "Total leaving" and on buttons; rewards shown as moved, not "collected"; raised amounts marked on the row ([PY-4](#py-4)–[PY-6](#py-6), [ST-6](#st-6)).
8. **Lovejoin's truth on the page:** pool status before Review, the unlock condition on the return, one cost figure, a balance cap on the stepper ([LJ-1](#lj-1)–[LJ-3](#lj-3)).
9. **Governance that can be read:** distinguishable rows, a working link to the text, treasury amounts, the vote's own progress, and staying on the proposal after voting ([GV-1](#gv-1), [GV-2](#gv-2), [GV-6](#gv-6)).
10. **Settings as an index, with an Advanced door** for UTxOs, Collateral and accounts by number *(open call)* ([SE-1](#se-1), [AC-4](#ac-4), [PA-1](#pa-1)).

Then: Activity that names the other side ([AC-1](#ac-1)), the pool sort ([ST-5](#st-5)), the swap review's three-row summary ([DX-3](#dx-3)), and one place for site connections ([CW-6](#cw-6)).

The usual rules apply to each change:

- A renamed control or moved screen updates the e2e tests and [flows.md](flows.md) in the same commit.
- Every new or changed string goes into `en`, `es` and `ja`.
- No privacy note is dropped; a change may move or shorten one.
- Nothing new phones home.
- The most private option stays the default.

---

## 9. The fix round

What was done with each finding, on `web-wallet/style-flow-3` after the review. **Fixed** means the change asked for, or one that meets the same need; **partly** says what's left; **left** says why. The *(open call)* findings stay the owner's.

### Onboarding, restore and Settings

| ID | | What changed |
|---|---|---|
| FR-1 | Fixed | The word grid takes as many columns as keep an 8-letter word whole: two in the side panel, three from about 384 px, four in a tab. |
| FR-2 | Fixed, in words | The splash says "Reading your balances…", and the password step says "Setting up your wallet…" or "Restoring your wallet…" while it works. Its timings and 8 s cap are untouched: that's C2 and L-1 *(open call)*. |
| FR-3 | Left | The network choice on the welcome screen is a product call. |
| FR-4 | Left | Moving the portability note needs the closing onboarding screen (§8, 6). |
| FR-5 | Fixed | **Hide phrase** beside "I've written it down". |
| FR-6 | Fixed | "Word 7" is a label above each confirm box; a word off the list says so under its box at once. |
| FR-7 | Fixed | No "checksum" anywhere: Check recovery phrase says what Restore says. |
| FR-8 | Fixed | The `#create`/`#restore` hash goes once a wallet exists, so Remove wallet lands on the welcome and its "Wallet removed from this browser." |
| FR-9 | Fixed | The welcome's tab note fits Restore too. |
| FR-11 | Fixed | Check recovery phrase opens on the wallet's own word count (a new worker request, `phrase-words`, which reads the length while unlocked and stores nothing). |
| SE-2 | Fixed | The network switch stays on the current network until the move is confirmed. |
| SE-3 | Fixed | The Sites and Lovejoin rows say what their On means; the rewards setting says why to turn it off. |
| SE-4 | Partly | "Show recovery phrase" is a link, and "one-time accounts" is plain words. No link to the dApps page from there. |
| PA-1 | Fixed | **Add Account N** once the next is found unused; your own account number is behind a toggle, with no placeholder. |
| PA-2, PA-3 | Left | Where the picker sits is a layout call (HM-7); Public accounts' paragraphs are privacy notes. |
| SE-1 | Left | Settings as an index *(open call)*. |
| CW-8 | Fixed | Sites' copy drops "CIP-30"; Collateral leads with its status and purpose. A session's 5 ₳ is "Kept aside for contracts" in every review. |

### Home, Receive, Activity and Create a Seedelf

| ID | | What changed |
|---|---|---|
| GS-1 | Fixed | Create has its own reason, in Get started's order. |
| GS-2 | Fixed | With neither side able to pay, Create's Review is disabled with "Fund your public account first", and the public account is chosen unless only the private balance can pay. |
| GS-3 | Left | Opening on Public *(open call)*. |
| GS-4 | Partly | Get started's second step says what a Seedelf is and who can pay one, and the ⓘ no longer says "Anyone can pay it". The onboarding intro needs the closing screen. |
| GS-5 | Fixed | Back from the public address returns to the screen that offered it (private Receive, Create, Staking). |
| RX-1 | Fixed | Private Receive's first line: "Only someone using Seedelf Wallet can pay this. Anyone else needs your public address." |
| RX-2 | Fixed | Remove is behind **Manage** on each Seedelf's card. |
| RX-3 | Fixed | Each side's card says in a line what it links. When the wallet can't tell who paid, nothing is chosen, as privacy review §3.2 decided, and the note says the private balance is the safer guess. The fix round first chose it; its own review kept the choice the user's, since either side can make a link they didn't choose. |
| RX-4 | Fixed | The public address's disclosure is amber, with a link to your Seedelfs' names. |
| HM-1, HM-2 | Fixed, bounded | The worker counts what the wallet's own recent transactions are bringing back (`background/incoming.ts`, no request), so a pending payment no longer collapses the balance: each side says what's on its way, and tokens coming back stay listed. The forms spend only what's on chain. No pending row in the public Activity. |
| HM-3 | Partly | Every screen that disables for a transaction in flight says why. Which side the hold locks is the owner's call. |
| HM-4 | Fixed | The banner leads with "not confirmed yet: don't pay it again", has **Check now**, and the far horizon (dated when it isn't today) is under Details. |
| HM-5 | Fixed | One timestamp, Details inside the alert, and the alert clears on the next good reading. |
| HM-6 | Fixed | Home opens on the side a transaction spent from, and keeps the tab across reloads (until a lock). |
| HM-7, HM-10, HM-12 | Left | Layout and open calls; Make private as the bright button is deliberate. |
| HM-8 | Left | Marking every unlisted token would mark almost every token on a testnet wallet: a product call. |
| HM-9 | Fixed | Hidden balances are hidden on the forms too (asides, Max, notes), and on the swap, Lovejoin, DRep and top-up lines. Reviews still show what's sent, on purpose: it's read before sending. |
| HM-11 | Fixed | "Seedelf creation sent", and "Updating…". |
| ST-6 (Home) | Fixed | "Includes X ₳ of staking rewards" under the public balance, and says when payments don't spend them. |
| AC-1 | Fixed | Addresses are cut in the middle. Staking rows were already named from their certificates: the plain "Sent" rows were the fake chain's. |
| AC-2 | Fixed | Activity's error has Try again and the service's words under Details. |
| AC-3 | Partly | Titles wrap, "Already in your private balance" explains itself, and Save as CSV says how many rows it saved. |
| AC-4 | Fixed | A pin, not the padlock, for keeping a UTxO apart; a confirmation; and whose address the detail shows. |
| PY-11 | Fixed | The private option is no longer "A stealth mint", and the tag's label says anyone can read it. |

### Payments and reviews

| ID | | What changed |
|---|---|---|
| PY-1 | Fixed | A refusal's foot stays until the new review is in, saying "Building a new review…", and the new review says it was updated. |
| PY-2 | Left | Renaming Make public *(open call)*. |
| PY-3 | Left | Max on private Send needs a core builder that pays one Seedelf everything (like `sweep_from`), then WebAssembly and the form's Max. |
| PY-4 | Partly | The Amount row says "raised from 0.5 ₳". Saying the minimum on the form needs a worker request. |
| PY-5 | Fixed | Totals and Make private's button count the tokens; an own-address warning names its recipient. |
| PY-6 | Fixed | "Staking rewards moved into your balance", with a line on the setting. |
| PY-7 | Partly | The details sheet says "not sent yet". The giveme.my sentence stays: who sees a transaction is a note the screens keep. |
| PY-8, V-1 | Fixed | A focused field scrolls clear of a sticky foot (the page's scroll padding follows the foot's height); errors in the foot scroll within it. Session pages, the sign windows and Remove wallet's list have feet that follow the body. |
| PY-9 | Fixed | Text that isn't a number disables Review with its reason; every disabled Review says why; a new token box isn't red before it's touched. Contacts aren't searched from To yet. |
| PY-10 | Fixed | A mainnet address on Preprod, a stake or script address, and too little ADA are said in the user's words, with how much can be sent where the wallet can work it out. |
| PY-12 | Partly | Plainer Seedelf name rule, a note cut at 64 characters says so, Max's placeholder fits. |
| PY-13, PY-15 | Left | Naming Koios and the timing note are disclosures the screens keep. |
| PY-14 | Fixed | "Amount (all of it)", and token rows labelled. |
| V-7 | Fixed | A no-break space before every ₳, in the screens and the three languages. |

### Staking and governance

| ID | | What changed |
|---|---|---|
| ST-1 | Fixed | The pressed control carries its own progress ("Preparing your Yes vote…"). |
| ST-2 | Fixed | Each review's button says the act (Stake with TPREP, Withdraw 57.48 ₳, Stop staking, Register as a DRep, Cast No vote), and its title names it. |
| ST-3, V-3 | Fixed | Stop staking, Retire as a DRep and Remove Seedelf's review use the danger style, with what ends listed. This reverses round one's plain row for Stop staking. |
| ST-4 | Fixed | Pool rows give margin, cost and the sorted value a line of their own, and badges never cut; the pool ID is cut in the middle. |
| ST-5 | Partly | Pools that pay nothing sink to the end of every sort. A return-based sort needs data the list doesn't have. |
| ST-6 (Staking) | Fixed | The withdrawal says the balance stays the same, but for the fee. |
| ST-7 | Fixed | The page leads with the pool, and that the ADA stays spendable; the operator figures are under Pool details; switching pools says the old one's rewards keep coming. |
| ST-8 | Fixed | An oversaturated pool says how far over, and what that does to rewards, on its review too. |
| ST-9 | Fixed | No spendable ADA is caught before a build, with Receive and Make public; withdrawing and retiring never mention a deposit. |
| ST-10 | Fixed | Read failures say so plainly, with the service's words under Details and Try again; a registered DRep never falls back to "Be your own DRep". |
| ST-11 | Fixed | Back from a review keeps the choice and the search. |
| ST-12 | Partly | One saturation figure, badges apart from names, an icon per voting option, dates beside epochs where they're known. Search by pool name needs names the list doesn't have. |
| GV-1 | Fixed | Each row has a short ID, the day it was proposed, the title when there's one, and a treasury withdrawal's amount. |
| GV-2 | Fixed | **Read its full text** opens an IPFS text through Blockfrost's gateway, the NFT images' one, in a tab, with a line saying what Blockfrost sees; any other address is only offered to copy, as an NFT's image elsewhere is. A treasury withdrawal shows its amount and recipients. The vote note says a vote stays on chain, a replaced one too. |
| GV-3 | Fixed | The reason sits under the option, and the foot's button becomes **Become a DRep**. |
| GV-5 | Partly | The inactive warning comes first and stays on the review. Status on every row needs a request per row. |
| GV-6 | Fixed | After a vote the page stays on the action, which says it's on its way, and the list marks it. |
| GV-7 | Fixed | The deposit is checked before Review; the DRep's duty to vote or update is said; editing the profile keeps a pasted address. |
| GV-8, GV-9 | Fixed | An ⓘ for each kind of action; Always no confidence says it's a standing vote against the committee; the directory switch's copy agrees with itself. |

### dApps, swaps, Lovejoin and the connector

| ID | | What changed |
|---|---|---|
| DX-1 | Fixed | A refused swap, mix or session funding gives way to one **Build it again** (a fresh session), or says where to look when it may have gone out; the service's words are under Details, and Back clears the alert. |
| DX-2 | Fixed | The minimum Minswap vouches for is a warning of its own. Checking it would mean reading each DEX's order datum. |
| DX-3 | Partly | Slippage on the review, the swap's cost in rows that add up, and the Lovejoin switch says when it can't apply. Not the three-row summary. |
| DX-4 | Fixed | "Slippage: 1%" on the form, amber from 5%, no placeholder that looks set, and Max says what stays aside. |
| DX-5 | Fixed | Stop goes once the order is filled or refunded; a finished swap says what was received; a turned-away funding says why. |
| DX-6, DX-7, DX-8 | Left | Swap on Home *(open call)*; a session's number is its account's index, which never repeats. |
| LJ-1 | Partly | The pool's state shows before Review, which is disabled with the reason. A one-tap shallower mix needs a depth per mix (LJ-4). |
| LJ-2 | Fixed | "Back … while Seedelf Wallet is unlocked", on the page and every review. |
| LJ-3 | Fixed | One cost figure everywhere (the 0.95 ₳ estimate; Settings showed the measured 0.877 ₳), and the stepper stops at what the balance pays for. |
| LJ-4 | Left | A depth per mix: each Lovejoin build would take one, stored with the mix as swaps' is. |
| LJ-5 | Partly | Loading and a failed read are said, not "None". No list of mixes. |
| LJ-6, LJ-7 | Fixed | Seeding is a secondary link, "private balance" throughout, and each tab says where what's left goes. |
| CW-1 | Fixed | The sign windows' password and Sign follow the request, so Sign is reached past who's paid and every warning. |
| CW-2 | Fixed | Choosing a private session brings its amount into view and focuses it; the disabled button says "Enter an amount". |
| CW-3 | Fixed | A declined site waits 10 s, then 60 s, then 5 min for declines in a row (10 quiet minutes, or a connect, start it over), and the site hears when it can ask again. |
| CW-4 | Fixed | The locked window has Decline and no restore link. The password at Sign stays: it's a setting. |
| CW-5 | Partly | With several accounts, the windows say which signs. One account stays "your public account", as round one decided. |
| CW-6 | Partly | Every disabled action on a session's page says why, and a disconnected site isn't said to stay connected. One list of sites is a structural call. |
| CW-7 | Fixed | "1 of N" with Decline all; "Total leaving" for "sends, net"; the private option as short as the public one. |

### The fix round's own review

A cross-area review of the merged changes found, and the round fixed:

- **A sent transaction could be offered for rebuilding.** If the page missed a send's answer, pressing Send again met a "stale" refusal and offered a rebuild that would pay again. A missing review now checks whether it was sent first.
- **Change on its way could be counted twice**, or for a transaction that never landed: two transactions spending the same inputs, or a reading taken while a send landed.
- **The foot's clearance stopped after the first form ↔ review switch**, and **a vote "on its way" showed on another account's actions**.
- Smaller: Back from Staking's Receive and Make public returns to Staking; a review's error no longer follows Back to the form; one name for a session's 5 ₳; the "Nothing is sent until …" lines alike; the store privacy policy names the governance link.

### Left for the owner

- The open calls this review marks, unchanged: renaming Make public, opening a new wallet on Public, Swap on Home, UTxOs behind Advanced, two decimals, a password on the wallet's own sends, and L-1 with C2.
- **Stop staking and Retire are red now** (ST-3), against round one's plain row.
- **The governance text link** reaches Blockfrost's gateway from a tab (GV-2), a new use of a host the wallet already names; the privacy policy says so, dated as its *Changes* need.
- **Settings' Lovejoin cost** is the estimate the page uses now (LJ-3), not the measured figure.
- **A declined site's wait** grows to 5 minutes after three declines in a row (CW-3).
