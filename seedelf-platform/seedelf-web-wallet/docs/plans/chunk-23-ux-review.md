# Chunk 23: a usability review of the built wallet

Input for [chunk-23-style-flow-3.md](chunk-23-style-flow-3.md)'s list. A diagnosis only: nothing here has been decided or changed. Each finding has an ID (`C-2`, `S-1`, …) so the plan's list can point at it.

The brief was adversarial: treat every screen as guilty until proven usable, for someone who has never seen the wallet, hasn't read the README, doesn't know blockchain terms, clicks whatever looks like the next step, and leaves at the first sign they've made a mistake. So this is a list of problems. Where something works, it's said only when that explains a finding.

**Severity.** P0 stops an important workflow. P1 is serious confusion or a likely failure. P2 is noticeable friction. P3 is polish. **Nothing tested was a hard P0**; the worst are P1s where a typical user would most likely fail, give up or lose trust.

**The rules that still hold** ([the plan's](chunk-23-style-flow-3.md#rules-that-still-hold)) are kept in every recommendation: no privacy note is dropped (a recommendation may move or shorten one); nothing new phones home; the most private option stays the default. Where a finding touches a deliberate decision, it says so.

## How it was tested

- **The build:** `dist/` (1.1.0), built from `d74e718`. **`596ec27` (the first chunk 23 batch: C1's ⓘ hints, C4, C5, C6) landed during the review and isn't in it.** It moves some paragraphs quoted here behind ⓘ (Create a Seedelf's "fresh copy of your register", Make private's review note, public Receive's funding line, Public accounts, Collateral, Staking, Lovejoin, UTxOs, parts of Settings) and rewords the connector windows. A hidden paragraph is still jargon once opened, but the findings that are only about text density or connector wording need a second look against a fresh build: [SE-4](#se-4), [P-6](#p-6), [SET-1](#set-1)'s Lovejoin paragraph, [SET-4](#set-4), [U-1](#u-1)'s subtitle, [D-3](#d-3)'s density, [CW-3](#cw-3), [CW-4](#cw-4), [V-6](#v-6). It doesn't touch the password hint, the header, the sticky feet, the review summaries, private Send or the Seedelf list on Receive, so the findings about those stand.
- **The harness:** Playwright's Chromium with the fakes from [e2e/support.ts](../../extension/e2e/support.ts), so Koios answers from the recorded preprod fixtures. Three wallets: one created through the UI, the 12-word fixture phrase (28 ₳ private in 2 UTxOs, about 10,408 ₳ public, 6 tokens, one Seedelf, staked to LOGIC), and the 15-word one (empty).
- **Sizes:** the side panel at 360×640 (and 360×500); a tab at 1280×720 (a common laptop viewport); the connector window at 400×605, its 400×640 window less the title bar.
- **States forced:** Koios slowed to 6 s an answer, Koios failing with 500, a pending then confirmed transaction, giveme.my refusing, wrong words, wrong password, Spanish and Japanese, two accounts, an injected seven-figure balance.
- **Not covered:** real mainnet latency; Chrome's own side-panel chrome and its host-permission dialog; NFTs; a private session start to finish (Bring everything back, a swap's whole run); registering as a DRep and voting; Check recovery phrase's success; screen readers, except in passing.
- **Left out as test artefacts:** the 12.5 ₳ payment missing from Activity (the fake replays recorded history), and "Koios doesn't know that pool" for pools outside the recording.

---

## 1. Top 10 UX failures

1. **Review screens don't add up, and read as losses** ([S-1](#s-1), [S-2](#s-2), [S-3](#s-3)). Sending 12.5 ₳ from 10,408 ₳ shows "Staking rewards spent 57.475311 ₳" and "Back to your public account 47.800614 ₳", and no total. A careful user thinks they're about to lose 57 ₳ and end up with 47 ₳. The private review does the same: "Back to your private balance 19.77 ₳" when 22.77 ₳ will be left.
2. **Site signing windows hide the password they need** ([CW-1](#cw-1)). In the 400×640 window, the password field starts below the fold, under the sticky Decline/Sign bar (measured: top at 614 px in a 605 px viewport). The user sees a greyed-out Sign button and no reason. A longer message, or any transaction, pushes the field further down.
3. **A new wallet opens on the tab where nothing works** ([H-2](#h-2), [H-3](#h-3), [H-1](#h-1)). It lands on Private: 0 ₳, three disabled actions, one of them the brightest button on screen. The Get started card underneath says to fund the *public* account. Its Receive goes to the public address, while the Receive just above it goes to a private dead end with a disabled "Create a Seedelf".
4. **Users will give out the wrong thing to get paid privately** ([SE-1](#se-1)). The friendly label ("web-wallet", "alice") is shown big and bold. The thing that actually works is a 64-character hex string under it, also called a "name". "Tags aren't unique" assumes the user knows what a tag is.
5. **Paying an ordinary address from the private balance is undiscoverable** ([P-1](#p-1), [P-2](#p-2)). Private Send rejects an address with "A Seedelf's name is 64 hex characters starting 5eed0e1f." The feature the user wants is called "Make public", and nothing links the two.
6. **Raw translation keys on the password step** ([C-1](#c-1)). Every new user sees `setPassword.hint.weak` / `.fair` / `.good` / `.strong` under the strength meter, on create, restore and change password. It's the first form anyone fills in.
7. **With two or more accounts, the side-panel header breaks** ([HD-1](#hd-1)). It's 429 px wide in a 360 px panel: Lock is half off-screen, Open in tab is fully off-screen, the panel scrolls sideways, and the account picker shows only "Account", not which one.
8. **The backup screen hides the last words under its button** ([C-2](#c-2), [R-1](#r-1)). At 1280×720, words 22–24 sit under the sticky "I've written it down", which turns on the moment the phrase is revealed. The confirm step then asked for words 19, 23 and 24. Restore hides the same rows, plus its "paste the whole phrase" tip.
9. **Errors speak operator** ([P-3](#p-3), [L-2](#l-2), [R-2](#r-2)). "giveme.my, which lends the collateral, refused this transaction: Transaction Fails Validation. Its UTxOs may have been spent since the review: refresh…", with no Refresh button and Send still enabled. "Koios is having trouble right now (500 for account_info)." "The phrase checksum is wrong."
10. **Activity can't tell you what happened** ([A-1](#a-1)). Every row is "Sent" or "Received" and an amount. There's no counterparty and no kind (made private, created a Seedelf, staked, swapped), and the detail view adds a hash but no address. Nobody can answer "where did my 100 ₳ go?"

Just outside the ten: the pool list's unlabelled percentage reads as a return ([ST-1](#st-1)); "Become a DRep" (locks 500 ₳) is the brightest button on the staking page ([ST-2](#st-2)); browser Back does nothing in the tab view ([N-1](#n-1)); Settings is one 3,400 px page ([SET-1](#set-1)).

---

## 2. Workflow review

Each workflow: what the user wants, what the screens ask, where they diverge, and what had to be guessed.

### First run

- **Goal:** set up a wallet.
- **Asked:** pick Create or Restore; a Network select (Mainnet/Preprod) sits under them.
- **Divergence:** a first-time user has no basis for the network choice. On preprod, a two-line amber banner sits on every screen from here on. Clicking Create or Restore in the side panel **closes the panel and opens a tab** with no warning ([W-2](#w-2)), which reads as a crash.
- **Inferred:** what the expand icon does (tooltip only); what makes this wallet "private".

### Create a wallet

- **Goal:** get a working wallet with a safe backup.
- **Asked:** reveal 24 words → confirm three of them → set a password.
- **Divergence:** the last row of words is under the button ([C-2](#c-2)). The note that the phrase restores Seedelfs only in Seedelf Wallet sits *below* the primary button ([C-3](#c-3)). The strength hint is a raw key ([C-1](#c-1)). After "Create wallet" comes an empty frame, then home with no "your wallet is ready" ([C-5](#c-5)).
- **Works:** autocomplete on the confirm words; Back keeps the same phrase; the wrong-word message names the word.
- **Inferred:** why Confirm is disabled (all three filled?); that the confirm words are random each time.

### Restore a wallet

- **Goal:** get my existing wallet back.
- **Asked:** 24 boxes (12/15/24 toggle), then a password.
- **Divergence:** the paste tip, the single most useful line, is below the fold ([R-1](#r-1)). After a misspelled word is fixed into another misspelled word, the stale "checksum is wrong" message stays ([R-2](#r-2)).
- **Works:** pasting a 12-word phrase into a 24-word form switches to 12 by itself; the bad word gets a red outline.

### Fund the wallet and get started

- **Goal:** put money in.
- **Asked:** the Get started card on the *Private* tab: fund your public account → create your Seedelf → make ADA private.
- **Divergence:** there are two Receives on one screen that go to different places ([H-2](#h-2)). The Private tab's actions are dead until steps 1 and 2 are done ([H-3](#h-3)). On the Public tab, the brightest action is "Make private", above a callout that says to create a Seedelf first ([H-4](#h-4)).
- **Inferred:** what a Seedelf is (first defined on the Create screen, two levels in); why there are two balances; which tab to use.

### Receive

- **Public:** QR, address, Copy (with "Copied" feedback), a privacy note, and the **stake address with the same weight and its own Copy** ([RC-1](#rc-1)). Someone will paste the stake address into an exchange.
- **Private:** the Seedelf list. The thing to give out is the hex line, not the bold label ([SE-1](#se-1)). There's no QR, and a trash icon sits next to Copy ([SE-2](#se-2)).

### Send from the public account

- **Goal:** pay someone.
- **Asked:** To, Amount, optional tokens, optional extra recipients, optional note → Review → Send.
- **Divergence:** the two optional buttons are the heaviest things on the form ([S-5](#s-5)). The review truncates the recipient and doesn't add up ([S-1](#s-1)–[S-4](#s-4)). No password is asked ([S-8](#s-8)). Afterwards the balance stays unchanged until confirmation, and Send goes disabled with the reason in a hover title only ([H-10](#h-10)).
- **Works:** inline validation ("That isn't a Cardano address", "That's more than the … available"); the success banner with its Cardanoscan link; "Payment confirmed" with Dismiss.

### Pay from the private balance

- **Goal:** pay someone without revealing it's me.
- **Asked:** private Send takes only Seedelf names; ordinary addresses go through "Make public".
- **Divergence:** see [P-1](#p-1) and [P-2](#p-2). When the collateral service refuses, the error is jargon, its advice ("refresh") has no button, and Send stays live, which invites a retry loop ([P-3](#p-3)).

### Create a Seedelf

- **Goal:** get something people can pay privately.
- **Asked:** an optional "personal tag", Pay with Public/Private, Review (10–15 s to build), Send.
- **Divergence:** the explanation is "a fresh copy of your register" ([SE-4](#se-4)). The build's only progress text sits under the button, below the fold ([L-3](#l-3)). The review's button says "Send" ([S-7](#s-7)) and lists a "Token name" row.

### Make private

- **Goal:** move public money into the private balance.
- **Divergence:** Max puts the word "Max" in a greyed field, so the user never sees the 10,402 ₳ they're about to move ([MP-1](#mp-1)). "Available, with … of rewards" is ambiguous ([MP-2](#mp-2)). A token added at 0 is silently dropped ([MP-3](#mp-3)).

### Staking and governance

- **Goal:** earn rewards; maybe vote.
- **Divergence:** pool stats are unexplained and the pool list's % is unlabelled ([ST-1](#st-1), [ST-3](#st-3)). The most prominent action is the rarest and costliest ([ST-2](#st-2)). Stop staking wears a trash icon ([ST-4](#st-4)).
- **Works:** the voting-power chooser (radio cards, one line each) is the clearest choice screen in the wallet. Use it as the pattern for [CW-3](#cw-3).

### dApps: swap and Lovejoin

- **Goal:** swap a token; mix ADA.
- **Divergence:** Swap is four taps deep and only from the private balance ([D-2](#d-2)). The dApps page says to connect on a site, but site connections are off and it doesn't link the switch ([D-1](#d-1)). Lovejoin's cost isn't put in proportion ([D-3](#d-3)).
- **Works:** the swap form itself is conventional and clear.

### Connect and sign for a site

- **Goal:** use a site with this wallet.
- **Divergence:** Connect is disabled until a choice the user may not notice is needed ([CW-3](#cw-3)). The sign windows hide the password ([CW-1](#cw-1)), and the transaction summary's "(included)" makes no sense ([CW-2](#cw-2)).

### Lock, unlock, forgot password

- **Works:** "Wrong password." is clear; "Forgot password?" leads to a well-guarded delete-and-restore with a typed confirmation.
- **Divergence:** after unlock, a blank frame, then a full-bleed spinner with no words, then a skeleton ([L-1](#l-1)).

### Settings and destructive actions

- **Works:** Remove wallet uses a typed confirmation and the button turns red when armed; the network switch confirms inline ("Stay on Preprod" / "Switch to Mainnet").
- **Divergence:** one huge page ([SET-1](#set-1)); Collateral lets you try with 0 ₳ and fails ([SET-3](#set-3)); Remove wallet ends with no confirmation that it's done ([SET-6](#set-6)).

### Several accounts

- **Divergence:** adding a second account breaks the side-panel header ([HD-1](#hd-1)). The Public accounts page asks for an "Account number" with the placeholder "1338" ([SET-4](#set-4)).

---

## 3. Screen-by-screen review

Each finding: **severity · problem**, why it hurts, and the change.

### Welcome

<a id="w-1"></a>**W-1 · P2 · A network choice on the first screen.** A newcomer can't answer "Mainnet or Preprod?"; a wrong pick means test ADA they think is real, or the reverse. *Change:* keep the default; move the choice behind a small "Network: Mainnet ▾" link, and keep the PREPROD badge.

<a id="w-2"></a>**W-2 · P2 · Create/Restore in the side panel closes the panel and opens a tab.** The panel vanishes under the cursor; it looks like a crash. *Change:* say it on the button or before it ("Opens in a tab, so your phrase isn't shown in the side panel"), or keep a panel state that says "Continue in the tab that just opened".

<a id="w-3"></a>**W-3 · P3 · The brand twice, the difference never.** Header logo plus hero logo; "A private wallet for Cardano." says nothing about the two balances. *Change:* one logo; one line on what's different ("A Cardano wallet with a private balance built in" — the store description already says it better than the screen).

<a id="w-4"></a>**W-4 · P2 · The preprod banner takes two lines on every screen.** At 360 px that's about 50 px of every view, forever. *Change:* full banner on first sight per session, then just the badge (the badge is the safety signal).

### Create: the recovery phrase

<a id="c-1"></a>**C-1 · P1 · Raw translation keys.** `setPassword.hint.weak/fair/good/strong` show under the meter on create, restore and change password. [SetPassword.tsx:71](../../extension/src/ui/components/SetPassword.tsx#L71) renders `HINTS[strength]`, a key, without `t()`; the strings exist in all three languages. The language commit (`88de3ba`, chunk 19) turned the hints into keys without wrapping them, and the only test on the hint ([extension.spec.ts:104](../../extension/e2e/extension.spec.ts#L104)) checks the too-short message, which is translated. *Change:* `t(HINTS[strength])`, and a test that the hint never matches `/^\w+\.\w+/`.

<a id="c-2"></a>**C-2 · P1 · The last words are under the sticky button, and the button doesn't wait for them.** At 1280×720, rows 22–24 sit under "I've written it down", which turns on as soon as the phrase is revealed. A user who doesn't scroll writes 21 words; the confirm step may then ask for the ones they never saw (it asked for 19, 23, 24). *Change:* no sticky foot on this step, or a 4-column grid at tab width so all 24 fit; enable the button only once the grid's end has been in view.

<a id="c-3"></a>**C-3 · P2 · The most important caveat sits after the primary button.** "This phrase restores your Seedelfs only in Seedelf Wallet…" comes after "I've written it down": nobody reads past the button they're about to press. *Change:* above the grid, with the warning.

<a id="c-4"></a>**C-4 · P2 · Confirm: disabled with no reason; wrong fields not marked.** Restore outlines a bad word in red; confirm doesn't, and reports only the first mismatch. *Change:* outline each wrong field; say "Fill all three" while disabled.

<a id="c-5"></a>**C-5 · P2 · No arrival.** "Create wallet" → an empty frame with only the header → home at 0 ₳. No "Your wallet is ready", no next step beyond the checklist. *Change:* a one-screen success ("Your wallet is ready. Next: fund your public account") that hands off to the checklist.

<a id="c-6"></a>**C-6 · P3 · "Change network" on every onboarding step.** A distraction mid-backup. *Change:* only on the first step.

### Restore

<a id="r-1"></a>**R-1 · P1 · Same sticky-foot problem, and the paste tip is below the fold.** "Tip: paste the whole phrase into any box" is the line that saves a user typing 24 words, and it sits under Continue. *Change:* the tip above the grid ("Paste your whole phrase into the first box"); the same grid fix as [C-2](#c-2).

<a id="r-2"></a>**R-2 · P2 · Stale, jargon error.** After a checksum failure, fixing word 12 to a misspelling ("abount") outlines it red but keeps "The phrase checksum is wrong; check the words and their order." *Change:* clear the message on edit; say "Word 12 isn't a recovery-phrase word" for an unknown word, and "These words don't make a valid phrase — check the spelling and the order" for a checksum failure.

### Home (both tabs)

<a id="h-1"></a>**H-1 · P1 · Disabled buttons styled as the main action.** Send (Private) and Make private (Public) keep their solid teal circle while disabled; only the label greys. On a new wallet the brightest thing on screen is a button that does nothing. The reasons exist only as `title` tooltips on the Private tab (none on hover-less devices, none at all on the Public tab). *Change:* a disabled action is never filled; the reason shows inline under the action row ("Make some ADA private first").

<a id="h-2"></a>**H-2 · P1 · Two Receives, two destinations, one screen.** On the Private tab, the action-row Receive goes to private receive (a dead end for a new wallet); the checklist's Receive goes to the public address. Same word, same screen. *Change:* a new wallet opens on **Public** (where step 1 happens); the checklist button says "Show my address".

<a id="h-3"></a>**H-3 · P1 · Private Receive dead end.** With no Seedelf: "People pay a Seedelf's name, and you don't have a Seedelf yet…" plus a disabled "Create a Seedelf" with no reason and no path to funding. *Change:* say why ("Your public account is empty: fund it first") with a button to the public address.

<a id="h-4"></a>**H-4 · P1 · The Public tab's emphasis contradicts its advice.** The callout says "Create your Seedelf before making money private", while Make private is the filled primary above it. *Change:* until a Seedelf exists, Create a Seedelf is the primary and Make private is secondary. (Private by default holds: it's about order, not dropping the option.)

<a id="h-5"></a>**H-5 · P1 · Developer units on the home screen.** "2 UTxOs" under the private balance, "4 addresses used" under the public one, and "UTxOs" as a home-level destination ([U-1](#u-1)). *Change:* drop the counts from home (they're on the UTxOs page); move UTxOs to Settings → Advanced.

<a id="h-6"></a>**H-6 · P2 · The lists under each tab differ silently.** dApps appears only on Private, Staking only on Public. A user looking for Swap on Public won't find it. *Change:* one consistent list, or a line on Public: "Swaps and dApps run from your private balance → dApps".

<a id="h-7"></a>**H-7 · P2 · In the side panel, navigation is below the fold.** On a new wallet, dApps/Activity/UTxOs start at about 780 px in a 640 px panel. *Change:* collapse the checklist once read, or move Activity up beside the balance.

<a id="h-8"></a>**H-8 · P2 · Six decimals, always.** "10,408.014036 ₳" is noise; at seven figures the ₳ wraps onto its own line in the panel. *Change:* two decimals on home (full precision in review and details); scale the font down for long amounts.

<a id="h-9"></a>**H-9 · P2 · Unlisted tokens: title is a fingerprint, the warning is cut off.** "asset13vxx…6fmzjw" is the title; "Calls itself tUSDM, not on the wallet's list" is the subtitle, and in the panel it's cut to "not on the wallet's …" (Spanish "no est…", Japanese worse). The part that matters is the part that's lost. Showing the fingerprint is a deliberate anti-impersonation choice, and the fix keeps it. *Change:* title `"tUSDM"` in quotes with an **Unverified** badge, fingerprint as the subtitle; let the subtitle wrap.

<a id="h-10"></a>**H-10 · P2 · A sent payment doesn't show until it confirms.** The balance stays at 10,408 ₳ while Send and Make private go disabled, with the reason ("Wait for the last transaction to confirm") in a tooltip. It looks like the send failed, which invites a second one elsewhere. *Change:* under the balance, "Pending: −12.67 ₳"; the reason inline.

<a id="h-11"></a>**H-11 · P3 · No light theme.** With the browser in light mode the wallet stays dark. Not a defect; worth a decision.

### Header

<a id="hd-1"></a>**HD-1 · P1 · Overflows at two accounts in the side panel.** With the account picker, the header measures 429 px in a 360 px panel. Lock is half off-screen, Open in tab is fully off, the whole panel scrolls sideways, and the picker is 87 px wide, so it shows "Account" with the number hidden behind the arrow. The Public tab's card does say "Account 1", which helps, but the picker is where people look before sending. (The plan's C4 asks whether the picker holds past a dozen accounts; it fails at two, in the panel.) *Change:* move the account to its own row under the header (or into the Public tab's card as a picker); icons collapse into a menu below ~400 px.

<a id="hd-2"></a>**HD-2 · P2 · One padlock, two meanings.** The header padlock locks the wallet; the UTxOs page's padlock locks a coin, and its open/closed state reads as either the state or the action. *Change:* a different glyph and word for coins ("Keep aside" / a pin).

<a id="hd-3"></a>**HD-3 · P3 · Unlabelled icons.** Gear, padlock, expand: tooltips only. Acceptable for the gear; "expand = open in tab" isn't obvious.

### Receive

<a id="rc-1"></a>**RC-1 · P2 · The stake address is presented as a peer of the receive address.** Same label style, same Copy, right under the QR. Exchanges reject stake addresses, or users paste them into the wrong field. *Change:* collapse it under "Advanced: stake address", with a line on what it's for.

<a id="rc-2"></a>**RC-2 · P3 · The footer crowds the last card.** The version line sits about 5 px under the stake address box.

### Private receive and Seedelfs

<a id="se-1"></a>**SE-1 · P1 · What do I give out?** The bold "web-wallet" is the tag; the grey 64-hex line is the "name". The help text "Give out a Seedelf's whole name: tags aren't unique" needs vocabulary the user doesn't have. Users will tell people "pay alice". There's no QR here, while public Receive has one. *Change:* make the hex the hero: "Your Seedelf address — share this", with Copy and a QR; show the tag as "Label: alice (public, not unique)". One noun for the hex everywhere (Send's field says "Seedelf name" too).

<a id="se-2"></a>**SE-2 · P2 · A trash icon beside Copy on the Receive screen.** It opens a separate Remove screen with its own review (not instant), but a delete control on the screen you visit to get paid is an accidental tap waiting to happen, and "trash" over-states it. *Change:* manage Seedelfs (remove, rename) from a list reached from Settings or the Seedelf card's own menu.

<a id="se-3"></a>**SE-3 · P2 · "1.5 ₳" next to the Seedelf, unexplained.** It's the ADA locked with it. *Change:* "1.5 ₳ deposit" with a hint, or leave it to the manage screen.

<a id="se-4"></a>**SE-4 · P1 · Create a Seedelf is explained in protocol terms.** "Each payment reaches you under a fresh copy of your register"; "listed by its token name alone, starting 5eed0e1f…"; "Up to 15 letters, digits, spaces or ASCII punctuation"; the error "…ASCII punctuation, not “’”." *Change:* "Each payment lands in a new, unlinkable spot only you can open"; "Label (optional, public)"; "Plain letters and numbers, up to 15; no curly quotes or accents."

<a id="se-5"></a>**SE-5 · P2 · "Pay with" is the same segmented control as the home tabs.** It looks like navigation, not a choice with privacy consequences. See [V-4](#v-4).

### Send (public)

<a id="s-1"></a>**S-1 · P1 · "Back to your public account 47.800614 ₳" reads as what will be left.** The user has 10,408 ₳. It's the change output; the user sees 10,000 ₳ vanishing. Same on private: "Back to your private balance 19.77 ₳" with 28 ₳ before a 5 ₳ payment (it's one coin's change). *Change:* drop the change row from the summary (it's in details); show **Balance after: 10,395.34 ₳**.

<a id="s-2"></a>**S-2 · P1 · "Staking rewards spent 57.475311 ₳".** Rewards are *collected into* the account, not spent; next to 12.5 ₳ it reads as a 57 ₳ loss. *Change:* "Rewards collected +57.47 ₳ (added to your balance)", or keep them out of the summary and say so in details.

<a id="s-3"></a>**S-3 · P1 · No total.** The user has to add amount and fee themselves. *Change:* "Total leaving your wallet: 12.674697 ₳" as the bold line.

<a id="s-4"></a>**S-4 · P2 · The recipient is truncated on the review.** "addr_test1qp6cc6…nsh9llnq" is exactly what address poisoning exploits. *Change:* the full address, wrapped, monospace, on the review itself.

<a id="s-5"></a>**S-5 · P2 · Optional buttons outweigh the real one.** "Add tokens" and "+ Add recipient" are full-width, heavy black pills; Review is a grey slab until valid. At 720 px the privacy note sits under the sticky Review. *Change:* text-style buttons for optional additions; leave room above the sticky foot for the last note.

<a id="s-6"></a>**S-6 · P2 · Placeholder and help in developer language.** "addr_test1…, $handle or 5eed0e1f…" (a hex prefix); "Looking up a handle tells Koios which one." *Change:* "Address, $handle or Seedelf address"; "Looking up a $handle asks a public server which address it is."

<a id="s-7"></a>**S-7 · P2 · Every review's button says "Send".** Create a Seedelf, Make private, Remove a Seedelf all end in "Send". *Change:* the verb of the screen: "Create Seedelf", "Make 10,402 ₳ private", "Remove Seedelf".

<a id="s-8"></a>**S-8 · P2 · No password to send from the wallet itself.** Sites' signatures ask for one by default, and the wallet's own Send doesn't: anyone at an unlocked browser (15 minutes by default) can empty it. *Change:* the same switch for the wallet's own payments, on by default.

<a id="s-9"></a>**S-9 · P3 · The transaction details sheet nests three boxes deep** and uses "The transaction" for two different headings; "a key that stakes", "Valid until slot". Fine as an expert view if it's labelled one ("Advanced details").

### Private Send and Make public

<a id="p-1"></a>**P-1 · P1 · Private Send rejects the most common recipient.** Paste an exchange address: "A Seedelf's name is 64 hex characters starting 5eed0e1f." The user wanted "pay this address from my private money", which exists, under another name. *Change:* accept an address and switch to that flow, saying what changes ("This is an ordinary address: the payment will be public at their end"). At minimum, the error links to it.

<a id="p-2"></a>**P-2 · P1 · "Make public" doesn't say "pay someone".** It reads as "move my money to my public account". In fact it pays any address, and its own warning discourages paying your own account. *Change:* rename around the outcome, e.g. "Pay an address", with the subtitle "From your private balance, to any Cardano address".

<a id="p-3"></a>**P-3 · P1 · The collateral refusal is unrecoverable for a normal user.** "giveme.my, which lends the collateral, refused this transaction: Transaction Fails Validation. Its UTxOs may have been spent since the review: refresh, then review it again." No Refresh button on this screen; Send stays enabled. *Change:* "This payment couldn't be prepared — your balance may have changed. [Refresh and review again]"; disable Send until then; keep the service's own text under "Details".

<a id="p-4"></a>**P-4 · P2 · The review explains plumbing.** "Send asks giveme.my to lend the collateral, then submits." *Change:* say it in the privacy note's terms, once, in Settings → Privacy (the privacy note itself stays).

<a id="p-5"></a>**P-5 · P2 · No Max on private Send.** Public Send and Make public have it. Inconsistent.

<a id="p-6"></a>**P-6 · P2 · "Private UTxOs spent", "New private UTxOs", "locked to fresh copies of your Seedelf key's register".** See [§6](#6-terminology-problems).

### Make private

<a id="mp-1"></a>**MP-1 · P2 · Max hides the number.** The amount field shows the word "Max" in placeholder grey and becomes read-only; the user can't see they're about to move 10,402 ₳ until the review. *Change:* fill in the computed amount and mark it "(max)".

<a id="mp-2"></a>**MP-2 · P2 · "10,405 ₳ available, with 57.47 ₳ of rewards".** Included or extra? The review's arithmetic says included. *Change:* "10,405 ₳ available (includes 57.47 ₳ rewards)".

<a id="mp-3"></a>**MP-3 · P2 · A token added at 0 is silently dropped.** Adding LINK leaves its amount at 0, Review is enabled, and the review leaves LINK behind with no word. *Change:* default an added token to all of it, or block Review with "Enter an amount for LINK, or remove it".

<a id="mp-4"></a>**MP-4 · P3 · Two names for one picker.** "Bring tokens along" here, "Send tokens too" in Send.

<a id="mp-5"></a>**MP-5 · P3 · Picking a token hides its amount.** The checkmark replaces the balance in the picker.

### Activity

<a id="a-1"></a>**A-1 · P1 · No counterparty, no kind.** Rows are "Sent −4.185521 ₳ and 1 token / 08:35". The detail has amount, fee, time and a hash. Making money private, creating a Seedelf, staking and swaps all look like "Sent". *Change:* a kind per row ("Made private", "Created Seedelf alice", "Paid addr…xyz", "Staked with LOGIC") and the counterparty in the detail.

<a id="a-2"></a>**A-2 · P2 · The subtitle explains the data source.** "Read from Koios, which already knows this account, 20 transactions at a time." *Change:* drop it, or move it to a hint (C1 in the plan).

<a id="a-3"></a>**A-3 · P3 · One card per date.** A stack of boxes; a list with date headers is lighter.

### UTxOs

<a id="u-1"></a>**U-1 · P2 · An expert page as a home destination.** "Public UTxOs · 5 UTxOs · Lock a UTxO to keep it out of every payment…" is for coin control, which few users need, and it sits beside Activity. *Change:* Settings → Advanced → Coin control; the padlock becomes a "keep aside" toggle ([HD-2](#hd-2)).

### Token detail

<a id="t-1"></a>**T-1 · P2 · A dead end.** Policy ID, asset name (hex), fingerprint, three Copy buttons, and no "Send" or "Make private". *Change:* the token's actions at the top; the identifiers under "Details".

### Staking and governance

<a id="st-1"></a>**ST-1 · P1 · The pool list's percentage is unlabelled and reads as a return.** "8964 … 1.72%" — it's saturation. The default sort is ticker A–Z over 559 pools, and 100 %-margin pools (ABLE, ADASC: their delegators earn nothing) sit in the list like any other. *Change:* label it ("1.7 % full"); default sort by something meaningful; warn on 100 % margin and on saturation over 100 %.

<a id="st-2"></a>**ST-2 · P1 · "Become a DRep" is the brightest button on the page.** It locks 500 ₳ and is the rarest action here; "Change pool", "Withdraw rewards" and voting "Change" are quieter. *Change:* secondary styling; the filled primary goes to nothing here, or to "Change pool" for an unstaked account.

<a id="st-3"></a>**ST-3 · P2 · Pool stats with no meaning attached.** Saturation, Margin, Cost per epoch, Pledge, Blocks made, in a card inside a card. *Change:* one line of meaning each (hints), and a single box.

<a id="st-4"></a>**ST-4 · P2 · "Stop staking" in red with a trash icon.** Stopping isn't deleting; it does refund the deposit. *Change:* a neutral icon; red only in the confirmation. And "Change" under Voting power → "Change who votes for you".

<a id="st-5"></a>**ST-5 · P2 · Three secondary-button styles on one page.** Grey filled ("Change pool"), black outlined ("Withdraw rewards", "Change", "Governance actions"), teal filled ("Become a DRep").

<a id="st-6"></a>**ST-6 · P3 · Two privacy notes say nearly the same thing** (private money has no stake key / carries no voting power). Both points stay; they could become one note.

### dApps, Swap, Lovejoin

<a id="d-1"></a>**D-1 · P1 · The dApps page sends users to sites that can't see the wallet.** "On a dApp's own site, connect Seedelf Wallet…", but Settings → Sites is Off by default, and nothing here says so or links to it. The user goes to a site and Seedelf Wallet isn't in its wallet list. (Off by default is a privacy decision and stays.) *Change:* "Sites can't see Seedelf Wallet yet — [Let sites connect]" when the switch is off.

<a id="d-2"></a>**D-2 · P2 · Swap is four taps deep, private only.** Private → dApps → Minswap → New swap. For a full Cardano wallet, Swap belongs on home. *Change:* a Swap action on home that explains it runs from the private balance.

<a id="d-3"></a>**D-3 · P2 · Lovejoin's cost isn't put in proportion, and its warning comes after the button.** One 10 ₳ box: "Mix fees, about 3.8 ₳" and "Into a one-time account 15.3 ₳, and 5 ₳ of collateral": about 38 % in fees, 20.3 ₳ moved. "2 waves deep, 4 mixes" is unexplained. The unaudited warning sits below Review. Three levels of nested boxes. *Change:* "Mixing 10 ₳ costs about 3.8 ₳"; the audit warning above Review; one box.

<a id="d-4"></a>**D-4 · P3 · A placeholder tile.** "More dApps come here as the wallet learns…" takes a grid slot and looks like a disabled app.

### Connector windows (sites)

<a id="cw-1"></a>**CW-1 · P1 · Sign windows hide the password.** Message and transaction alike: the required "Your password, to sign" is below the fold, under the sticky Decline/Sign bar (top at 614 px in a 605 px viewport, for a one-line message). Sign looks broken. *Change:* the password goes in the sticky foot, above Decline/Sign.

<a id="cw-2"></a>**CW-2 · P1 · The transaction summary can't be read.** "Your public account sends 3.174697 ₳ / From your staking 57.475311 ₳ (included) / Network fee 0.174697 ₳ (included)". Included in what? "Signs with 1 payment key and your stake key". *Change:* the same summary as the wallet's own review once [S-1](#s-1)–[S-3](#s-3) are fixed: who gets what, total leaving, rewards collected, balance after.

<a id="cw-3"></a>**CW-3 · P2 · Connect is disabled until a choice the user may not see.** Nothing is pre-selected (deliberate, and it stays), but the choice is a tab-like toggle with its explanations in a separate bullet list, and nothing says "choose one". The subtitle mentions "Review", which the public option never shows. *Change:* two radio cards with their explanation inside, as on the Voting power screen; "Choose what the site sees" above them.

<a id="cw-4"></a>**CW-4 · P2 · Protocol words.** "With: Your payment key", "Signs with … stake key", "(CIP-30)" in Settings → Sites.

### Lock and unlock

<a id="l-1"></a>**L-1 · P2 · Three loading looks in a row, none with words.** Unlock → an empty frame with the header only → a full-bleed logo spinner (no text, up to the 8 s cap on mainnet; the plan's C2) → home with "— ₳" and "Reading the chain…". *Change:* one state: home's skeleton straight away, with "Reading your balances…".

<a id="l-2"></a>**L-2 · P2 · The Koios error is in operator terms.** "Koios is having trouble right now (500 for account_info). Try again in a minute." Keeping the last balances on screen is right. *Change:* "Couldn't refresh — showing balances from 2 min ago. [Try again]"; the code under "Details".

<a id="l-3"></a>**L-3 · P2 · Long builds with a single line of progress, below the fold.** Create a Seedelf and Make private take 10–15 s with "Building…" on the button and "Reading the chain…" under it, out of view at 720 px. *Change:* the progress line above the button, with steps ("Reading the chain → Building → Checking").

### Settings

<a id="set-1"></a>**SET-1 · P1 · One page, 3,426 px in the side panel.** Everyday preferences (language, currency, open-in) sit between expert controls (Lovejoin waves and timing, collateral, account numbers), and the Lovejoin section opens with a 13-line paragraph. Nobody finds "Lock after" by scrolling past it. *Change:* a short index of sub-pages: General, Security, Privacy & Lovejoin, Sites, Advanced (collateral, coin control, accounts by number), About. The privacy notes move with their controls, intact.

<a id="set-2"></a>**SET-2 · P2 · A clipped select in the side panel.** "Mixing, for each box" shows "2 waves deep: 4 mixes, about 3.5 ₳ (" cut mid-parenthesis.

<a id="set-3"></a>**SET-3 · P2 · Collateral is top-level, and lets you fail.** "Set collateral" is the filled primary on an empty wallet; pressing it says "Your public account is empty, so there's nothing to send", which doesn't fit "set". *Change:* disable it with the reason; move the page to Advanced.

<a id="set-4"></a>**SET-4 · P2 · Public accounts reads like a protocol note.** "Account number [1338]", "Check it", "Add it", "working on this one", and two paragraphs on what Koios learns from queries. *Change:* "Add account" as the action; "Add by number" under Advanced; "current" instead of "working on this one".

<a id="set-5"></a>**SET-5 · P3 · About repeats the footer.** Version and network in a card inside the About card, and again in the footer of every screen.

<a id="set-6"></a>**SET-6 · P3 · Remove wallet ends silently.** Back to the welcome screen with no "Wallet removed from this browser". "(Show recovery phrase)" in its warning is plain text, not a link.

### Navigation

<a id="n-1"></a>**N-1 · P1 · Browser Back does nothing in the tab view.** The URL never changes (it stays at `#restore` from onboarding), so Back, Alt+← and a mouse's back button are dead. A reload returns home and loses a half-filled form. *Change:* a history entry per screen, so Back means the screen's own Back.

### Languages

<a id="i-1"></a>**I-1 · P3 · Japanese breaks an action label mid-word.** "プライベートにする" wraps as プライベ / ートにす / る under its icon.

<a id="i-2"></a>**I-2 · P2 · Truncation hits translations hardest.** See [H-9](#h-9).

---

## 4. Navigation and information architecture

**The organising idea, two balances, is right, but it's never introduced.** The home screen's first decision is Private or Public, before the user knows they have two balances, why, or what a Seedelf is (first defined on the Create screen, two levels in). The Get started card teaches the order of operations but not the model. One screen at the end of onboarding — "You have a public account (like any Cardano wallet) and a private balance (only you can link it to you). Money moves between them." — would anchor every later screen.

**The tabs hide destinations.** dApps (and with it Swap) live only under Private; Staking and governance only under Public; Activity and UTxOs exist under both, with different content and identical names. A user who wants to swap from the public account, or see "all my activity", has no route.

**Verbs are named for mechanism, not outcome.** "Make private" and "Make public" describe what happens to the money's visibility; users think in "pay", "receive", "swap", "stake". "Make public" is how you pay most people from the private balance, and nothing says so.

**Expert pages are first-class.** UTxOs (coin control) is a home destination; Collateral and "Account number" are top-level Settings entries. They should sit behind an Advanced door.

**Settings is a document, not a menu** ([SET-1](#set-1)).

**Back works only through the on-screen button** ([N-1](#n-1)). For a side panel that's tolerable; in a tab it isn't.

**The side panel and the tab are the same layout at two widths.** The tab centres a 488 px column in 1280 px; the panel squeezes the same column into 360 px. Neither uses its space well: the tab could show the balance, actions and activity side by side; the panel needs fewer boxes and less text to fit its 640 px.

---

## 5. Visual system problems

<a id="v-1"></a>**V-1 · Disabled vs primary.** A disabled primary keeps its fill ([H-1](#h-1)). The rule: filled = available and recommended; disabled = outline, low contrast, never filled.

<a id="v-2"></a>**V-2 · Too many button styles.** At least five: filled teal (primary), filled grey ("Change pool"), black outlined pill ("Withdraw rewards", "Add tokens", "Restore wallet"), teal text link ("Try again", "Create a Seedelf" in a callout), small grey pill ("Copy", "Max", "Name it"). The black outlined pill is heavier than the disabled primary and is used for optional actions ([S-5](#s-5)). Settle on three: primary, secondary, text.

<a id="v-3"></a>**V-3 · Boxes inside boxes.** The transaction details sheet (modal → section card → definition card), Staking (card → stats card), Lovejoin (card → stepper → definition card), Settings → About (card → card). Activity makes a card per date. Rule: one level of container per screen; lists use dividers.

<a id="v-4"></a>**V-4 · One control, two jobs.** The pill segmented control is the home navigation (Private/Public) *and* the input for choices with consequences (Pay with, Mix from, Connect it to, 12/15/24 words, Network). Choices with consequences need radio cards with their explanation inside (as Voting power does).

<a id="v-5"></a>**V-5 · Sticky feet cover content.** The phrase and restore grids, the sign windows' password, Send's last note at 720 px. The sticky foot is good for long forms; it must never cover a required input or must-read text, and a screen's last block needs bottom padding equal to the foot's height.

<a id="v-6"></a>**V-6 · Text density.** The plan's C1 counts about 150 note paragraphs. The worst: Settings → Lovejoin (13 lines), Public accounts (three paragraphs), Remove wallet, Forgot password, the connect window's bullets. Many are privacy notes that must stay; they can shrink to one sentence plus a hint.

<a id="v-7"></a>**V-7 · Numbers.** Six decimals everywhere ([H-8](#h-8)); the ₳ wraps at seven figures; unlabelled percentages ([ST-1](#st-1)).

<a id="v-8"></a>**V-8 · Monospace for identifiers is right; hex as a title is not.** Fingerprints as token titles ([H-9](#h-9)), Seedelf hex under the label ([SE-1](#se-1)).

<a id="v-9"></a>**V-9 · Icons.** The padlock means two things ([HD-2](#hd-2)); trash for "Stop staking" ([ST-4](#st-4)) and for removing a Seedelf from Receive ([SE-2](#se-2)); "Create" uses a sprout that doesn't say "Seedelf"; the expand icon means "open in a tab".

<a id="v-10"></a>**V-10 · Horizontal overflow and clipping.** The header at two accounts ([HD-1](#hd-1)); the Lovejoin select ([SET-2](#set-2)); token subtitles ([H-9](#h-9)). Nothing else overflowed on the screens measured at 360 px (home and Settings, in English, Spanish and Japanese); native selects clip without the measurement noticing, so others may hide like SET-2's.

<a id="v-11"></a>**V-11 · The preprod banner** costs about 50 px of every panel view ([W-4](#w-4)).

---

## 6. Terminology problems

| Term as shown | Where | Why it's a problem | Suggested |
|---|---|---|---|
| UTxO(s), "2 UTxOs", "Private UTxOs spent", "New private UTxOs" | Home, reviews, Make private's note, UTxOs page | Cardano's internal accounting unit | Drop from home and reviews; "coins" in coin control |
| "4 addresses used" | Public home | Means nothing to the user | Drop |
| Collateral; "giveme.my lends the collateral" | Settings, reviews, errors, connect window | Protocol plumbing | "a small refundable deposit for smart-contract payments"; name the service only in the privacy notes |
| Koios; "tells Koios which one"; "(500 for account_info)" | Send help, Activity, errors, Public accounts | A vendor's name and an endpoint | "a public server" / "the network service" |
| register; "fresh copy of your Seedelf key's register" | Create a Seedelf, Make private review | Cryptography | "a new, unlinkable spot only you can open" |
| Seedelf "name" (the hex) vs "tag" | Receive, Send, Create | The visible word isn't the one that works | "Seedelf address" (share this) and "label" |
| token name; `5eed0e1f…` | Create review, placeholders | Raw on-chain identifier | Hide; "Seedelf address" |
| checksum | Restore error | Developer word | "These words don't make a valid phrase" |
| Make public | Private home | Says nothing about paying anyone | "Pay an address" |
| Make private | Public home | Acceptable once the model is introduced | Keep, with the two-balance intro |
| Back to your public account / private balance | Reviews | Read as the balance left | "Balance after" (and change only in details) |
| Staking rewards spent | Reviews | Rewards are collected, not lost | "Rewards collected +X ₳" |
| (included) | Sign transaction window | Included in what? | Total leaving / rewards collected |
| payment key, stake key, "a key that stakes" | Sign windows, transaction details | Key management internals | "your account" / "your staking" |
| CIP-30, CIP-95 | Settings → Sites | Standard numbers | "Cardano dApp connector" |
| Valid until slot, Raw CBOR, Size … bytes | Transaction details | Expert view | Fine behind "Advanced details" |
| Policy ID, Asset name (hex), Fingerprint | Token detail | Identifiers | Under "Details" |
| one-time account, private session | dApps, connect window, Settings | New concept, never introduced | One sentence the first time: "a throwaway account funded from your private balance" |
| boxes, waves deep, mixes | Lovejoin, Settings | Mixer internals | "rounds of mixing"; "10 ₳ units" |
| Saturation, Margin, Cost per epoch, Pledge | Staking, pool list | Staking economics | One-line hints; label the % |
| DRep, governance actions | Staking | Cardano governance | The page already explains DRep well; keep |
| working on this one | Public accounts | Odd phrasing | "current" |
| Account number [1338] | Public accounts | A derivation index | Under Advanced |
| Lock (wallet) / Lock (UTxO) | Header, UTxOs | One word, two meanings | "Keep aside" for coins |
| "Calls itself tUSDM, not on the wallet's list" | Token rows | Long; cut off in the panel | `"tUSDM"` + Unverified badge |
| Preprod | Everywhere on test builds | Fine with the banner's explanation | Keep |

---

## 7. Missing UX states

**Loading**
- After create/restore/unlock: an empty frame, then a wordless spinner ([L-1](#l-1), [C-5](#c-5)).
- Builds: one line of progress, out of view ([L-3](#l-3)).
- Pending payment: no pending amount on the balance ([H-10](#h-10)).

**Errors**
- The private-payment refusal has no action, and Send stays live ([P-3](#p-3)).
- The Koios failure is in operator terms ([L-2](#l-2)).
- Restore keeps a stale error after an edit ([R-2](#r-2)).
- Collateral on an empty account: allowed, then the error doesn't fit ([SET-3](#set-3)).

**Empty states**
- Private receive with no Seedelf: a disabled button, no reason, no route ([H-3](#h-3)).
- Contacts empty: good ("No contacts yet. Save a Seedelf or an address you pay often…").
- Minswap: "No swaps yet." is fine.
- Activity for a new wallet: not tested (needs an empty-history fixture).

**Success and confirmation**
- Wallet created / restored: none ([C-5](#c-5)).
- Wallet removed: none ([SET-6](#set-6)).
- Payment sent / confirmed: good (banner with link, Dismiss).
- Copy: good ("Copied" for about 2 s).

**Disabled states**
- Reasons live in `title` tooltips on the Private tab, and nowhere on the Public tab, on Review buttons, on Connect or on Sign ([H-1](#h-1), [CW-1](#cw-1), [CW-3](#cw-3)).

**Destructive actions**
- Remove wallet and Forgot password: good (typed confirmation, red when armed).
- Remove a Seedelf: guarded by a review, but placed on Receive ([SE-2](#se-2)).
- Stop staking: wears a delete icon ([ST-4](#st-4)).
- No password for the wallet's own sends ([S-8](#s-8)).

**Onboarding**
- The two-balance model and what a Seedelf is are never introduced ([§4](#4-navigation-and-information-architecture)).
- The side panel hands off to a tab without saying so ([W-2](#w-2)).
- The checklist's next step isn't the screen's primary action ([H-2](#h-2), [H-4](#h-4)).

---

## 8. Recommended redesign priorities

The smallest set of changes for the largest improvement, in order. Each is bounded; none drops a privacy note, adds a network request or changes a default's privacy.

1. **Two outright bugs, an hour's work.** Translate the strength hint ([C-1](#c-1)); move the account picker out of the side-panel header ([HD-1](#hd-1)).
2. **A sticky-foot rule, applied everywhere.** A required input or must-read text never sits under the foot: put the sign windows' password in the foot ([CW-1](#cw-1)); no sticky foot on the phrase and restore grids, and the tip above the grid ([C-2](#c-2), [R-1](#r-1)); bottom padding for the last note ([S-5](#s-5)).
3. **One review summary, used by every review and the sign window.** Who gets what (full address), **total leaving**, rewards collected (+), **balance after**; change only in details; the button says the verb ([S-1](#s-1)–[S-4](#s-4), [S-7](#s-7), [CW-2](#cw-2)).
4. **A disabled-state rule.** Never filled; the reason shown inline, not in `title` ([H-1](#h-1), [H-10](#h-10), [CW-3](#cw-3)).
5. **The new-wallet path.** Open on Public; one checklist whose step is always the primary button; the private dead ends get a reason and a route; a one-screen intro of the two balances at the end of onboarding ([H-2](#h-2)–[H-4](#h-4), [C-5](#c-5)).
6. **Paying from private.** Private Send accepts an address and routes to the address flow; rename "Make public" to the outcome ([P-1](#p-1), [P-2](#p-2)).
7. **The Seedelf address.** The hex is "your Seedelf address — share this", with a QR; the tag is a label; remove moves off Receive ([SE-1](#se-1), [SE-2](#se-2)).
8. **An error-copy pass.** No service names, HTTP codes or UTxOs in the message; every error has an action button; the raw text goes under Details ([P-3](#p-3), [L-2](#l-2), [R-2](#r-2), [SET-3](#set-3)).
9. **Settings as an index, and an Advanced door.** Sub-pages; UTxOs, collateral and accounts-by-number go behind Advanced ([SET-1](#set-1), [U-1](#u-1), [H-5](#h-5)).
10. **Activity that says what happened.** A kind and a counterparty per row ([A-1](#a-1)).

Then the staking pair ([ST-1](#st-1), [ST-2](#st-2)) and history-backed navigation ([N-1](#n-1)).

The plan's own rule applies to each: a renamed control or moved screen updates the e2e tests and [flows.md](../flows.md) in the same commit, and every new or changed string goes into `en`, `es` and `ja`.
