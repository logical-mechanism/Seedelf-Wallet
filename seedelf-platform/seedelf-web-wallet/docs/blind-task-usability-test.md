# Blind task-completion usability test

This test asks one question: can someone who has a goal, but doesn't know how Seedelf Wallet is designed, work out how to use it? It is not another audit of every screen. Each task gave a tester a goal and a starting state, never a path, and recorded what the tester actually did, wrong turns included.

The testers were fresh AI agents with no knowledge of the product. They drove the real built extension (commit `d423b79`) in a test browser through 29 runs: the test plan's 20 tasks, five exploratory tasks of the same kind, and three reruns. After each run, a separate verifier with access to the source and logs annotated the trace, marking what the test setup rather than the wallet had caused. It never changed the tester's account, which is reported as given. Appendix A explains how the test was run and what it couldn't do. Appendix B says which findings were reported before. [§11](#11-the-fix-round) says what the fix round after it did with §9's changes, and what's left for the owner.

## 1. Executive summary

**How usable is the wallet when the tester has a goal rather than instructions?** Usable, but often on the second try. Every run reached its goal or the furthest point the test environment allowed. Testers scored 2 PASS (T20b, E02), 26 PASS WITH FRICTION and 1 BLOCKED (T16, where the fake giveme.my refused the private session's funding). The verifier agreed with every result except T14, which it marked BLOCKED because the recorded proposals had no content to understand; the rerun with content, T14r, passed. Confidence was High in 17 runs, Medium in 11 and Low in 1 (T05). Three testers rated their run as needing prior knowledge (T05, T14, T14r), each time general Cardano knowledge. T15 (reloading the page after turning Sites on), T08 (reading the pending figures) and T12 (judging a pool's health) also relied on general knowledge the UI didn't supply. None needed knowledge of how Seedelf Wallet is built.

Once a tester was on the right screen, the flows held, except the private Send's amount limit (T05). Of 114 task answers the verifier checked, 106 were right, 7 partly right, 1 couldn't be checked and none were wrong. All 8 transactions the wallet submitted (two in T03, and one each in T04, T04b, T07, T08, T13 and E04) did exactly what their reviews said. The friction is in two places: finding the right screen, and reading money that is in motion (pending balances, history amounts, the cost of multi-step flows). Testers made 38 wrong turns in 20 runs, or 30 in 18 runs once the 8 the verifier traced to the harness or a misread are removed. About half of those 30 (14) were a search for a feature in the wrong place. The rest were guesses at an amount (5, T05), money in motion (4, T03 and T08), controls or headings scrolled out of view (3, T10, T14 and E05), the state of a site connection (2, T15) and looks for an explanation (2, T16). Testers recorded 43 points where a reasonable user might have stopped, and 35 of them come from the product.

**Concepts the UI taught.**
- What to hand out to be paid privately, and who can pay it. T02 shared the Seedelf's whole name, not its tag, on the first try. The labels did it: "Its whole name: share this to be paid privately", "Share a Seedelf's whole name, not its tag" and "Only someone using Seedelf Wallet can pay this. Anyone else needs your public address."
- The setup order: fund the public account, create a Seedelf, then make ADA private. T03 learned it from the numbered "Get started" checklist.
- How to read a standard review. Amount, fee, recipient, "Total leaving …" and "… after" were read correctly every time (T04, T04b, T06, T07, T08, T12, T13, T14r, T18, E04). The exception was the swap review, which has no total (T10).
- That a send is pending and holds back the next one, from the banner plus "Wait for the last transaction to confirm" (T07, T08, T13, E04).
- How to recover from a refused send: "Nothing was sent" and a single "Refresh and review again" button (T09).
- Also: whether Lovejoin can mix, before committing to anything (T11); what stopping staking does (T13); what a site sees when it asks for a signature (T18); which account a site gets, though only from text that appears after choosing the public option, below the fold (T15); governance action types (T14, T14r); that balances are stale after a failed refresh (E05); and locking, restoring and adding an account (E02, T20a, T20b, T19).

**Concepts that still needed prior knowledge or inference.**
- On a set-up wallet, that there is a public side at all, and that ordinary sends, staking and voting live there. Get started explains the two sides on a new wallet (T01, T03), but it disappears once there is a Seedelf and private money, and then nothing on the Private tab mentions the public side (T04 verifier). T04 found the public Send only because its title said "publicly". Untitled, T04b found it only after the private route failed. T12, T14, T14r and E04 guessed their way to the Public tab, and T14 and T14r both rated finding governance as needing prior knowledge.
- What a Seedelf is. It is never defined on T02's path, and "Seedelf name" stopped T04b and T06. The UI also teaches that "Make public" pays an address only after Send rejects one (T04b, T06).
- The most the private balance can send. It depends on a minimum leftover the wallet never states, checked against an estimated fee higher than the one shown, and T05 found it with about 15 guesses.
- What the pending balance and the history amount mean. T08 needed arithmetic on UTxO change and reward withdrawals.
- That staking rewards are already counted in the balance and get spent with payments, and so when withdrawing them matters (T04, T04b, T07, T08, E04).
- What giveme.my and "the collateral" are (T04b, T06, T09, T10, T16), and what a swap, a mix or a private session costs in total. Testers added it up themselves (T10, T11, T16).
- That there are two activity lists (E01); that sites can't see the wallet until a Settings switch is on and the page has been reloaded (T15); and which output in Transaction details is the user's own (T08, T12, T18, E04).

**Where wrong turns happened.**
- The default Private tab. Home opens on Private, and in 11 runs the tester looked there first for something that lives on the Public side: 7 wrong turns (T01, T04b, T12, T14, T14r, E01, E04) and 4 hesitations (T03, T04, T07, T13). In 10 runs the very first navigation choice was wrong (T01, T04b, T06, T10, T12, T14, T14r, E01, E03, E04), and in 7 of those this was the reason.
- Private Send. Its only field is "Seedelf name", so paying an ordinary address goes the long way, through "Make public" (T04b, T06).
- "dApps". Three testers looked there for connected sites, which it doesn't list (T17, T17r, E03). Swaps and Lovejoin can be reached only through it, and only from the Private tab (T10, T11).
- Controls deep in Settings or at the bottom of long pages: the Sites switch (T15), Connected sites (T17, T17r, E03), "Public accounts" (T19), "Stop staking" (T13) and "Governance actions" (T14, T14r).
- Screens that open at the previous screen's scroll position, with titles, Back and status banners out of view (T03, T04b, T10, T11, T13, T14, T14r, T16).

**How far these results reach.** The testers were AI agents. They read every word and act slowly. They saw the accessible names the harness prints ("Send privately", "Receive publicly"), which a sighted user never sees. They saw a tooltip only when they hovered on purpose, and then without Chrome's delay; the view and the screenshots never showed one. The side panel ran as a separate window rather than docked beside the page. Payments from the private balance can't complete in this harness, so the end of every private send, swap, mix and private session is untested. Section 10 lists what human testers should settle.

## 2. Task scorecard

Legend: Result is the tester's own verdict. Where the verifier recommended a different one, it follows in parentheses. Confidence, wrong turns and navigation steps (approximate) are the tester's own figures. "Needed prior product knowledge" answers the plan's question, knowledge of how Seedelf Wallet works: no run needed it. Three testers flagged their run as needing prior knowledge (T05, T14, T14r); each time it was general Cardano knowledge, as the column notes (see below).

| Task | Goal | Result | Confidence | Wrong turns | Navigation steps | Needed prior product knowledge |
|---|---|---|---|---|---|---|
| T01 | Receive ordinary ADA | PASS WITH FRICTION | High | 1 | 10 | No |
| T02 | Receive money privately | PASS WITH FRICTION | Medium | 0 | 6 | No |
| T03 | Fund a brand-new wallet | PASS WITH FRICTION | High | 2 | 17 | No |
| T04 | Send 12 ADA publicly (pilot; task title shown) | PASS WITH FRICTION | Medium | 0 | 7 | No |
| T04b | Send 12 ADA to an ordinary address (untitled rerun) | PASS WITH FRICTION | Medium | 4 | 17 | No |
| T05 | Spend the maximum private amount | PASS WITH FRICTION | Low | 5 | 22 | No (the tester flagged general Cardano knowledge) |
| T06 | Pay a normal Cardano address using private funds | PASS WITH FRICTION | High | 1 | 6 | No |
| T07 | Make ADA private | PASS WITH FRICTION | High | 0 | 14 | No |
| T08 | Understand a pending payment | PASS WITH FRICTION | Medium | 2 | 22 | No |
| T09 | Recover from a failed private transaction build | PASS WITH FRICTION | High | 1 | 7 | No |
| T10 | Swap ADA for MIN | PASS WITH FRICTION | Medium | 2 | 11 | No |
| T11 | Determine whether Lovejoin can currently mix | PASS WITH FRICTION | Medium | 0 | 5 | No |
| T12 | Stake ADA | PASS WITH FRICTION | Medium | 3 | 11 | No |
| T13 | Stop staking | PASS WITH FRICTION | High | 0 | 7 | No |
| T14 | Understand and vote on a governance proposal | PASS WITH FRICTION (verifier: BLOCKED) | Medium | 4 | 27 | No (the tester flagged general Cardano knowledge) |
| T14r | Understand and vote on a governance proposal (rerun with proposal metadata) | PASS WITH FRICTION | High | 1 | 10 | No (the tester flagged general Cardano knowledge) |
| T15 | Connect a dApp publicly | PASS WITH FRICTION | High | 2 | 17 | No |
| T16 | Connect a dApp privately | BLOCKED | Medium | 2 | 8 | No |
| T17 | Accidentally decline a dApp | PASS WITH FRICTION | High | 1 | 13 | No |
| T17r | Accidentally decline a dApp (rerun with fast retry) | PASS WITH FRICTION | High | 1 | 11 | No |
| T18 | Sign a dApp transaction | PASS WITH FRICTION | High | 1 | 5 | No |
| T19 | Add a second public account | PASS WITH FRICTION | High | 0 | 5 | No |
| T20a | Restore the wallet (narrow side panel) | PASS WITH FRICTION | High | 0 | 5 | No |
| T20b | Restore the wallet (full tab) | PASS | High | 0 | 6 | No |
| E01 | Find an old transaction | PASS WITH FRICTION | Medium | 1 | 10 | No |
| E02 | Lock the wallet and get back in | PASS | High | 0 | 6 | No |
| E03 | Disconnect a site | PASS WITH FRICTION | High | 1 | 12 | No |
| E04 | Withdraw staking rewards | PASS WITH FRICTION | Medium | 1 | 7 | No |
| E05 | Understand a failed refresh | PASS WITH FRICTION | High | 2 | 11 | No |

Notes:
- **Verifier.** A non-blind verifier checked each trace against the command log, the screenshots and the source, and left the tester's account unchanged. It agreed with 28 of the 29 results; only T14 differs (see below). Across all runs it confirmed 331 tester claims as real product behaviour, traced 62 to the harness or its fakes, marked 26 as exists-not-found and 17 as misreads.
- **Wrong turns.** 8 of them the verifier traced to the harness or to a misread:
  - T04b, 2 of 4: the "Make public" route the wallet itself offered, which the fake giveme.my refused, and a "Details" click.
  - T09, 1 of 1, and T18, 1 of 1: the harness's click and scroll targeting.
  - T12, 2 of 3: a misread of the sort list, and a pool the fake Koios had no details for.
  - T14, 2 of 4: outside links blocked.

  T05's 5 wrong turns were guesses at the amount, not navigation.
- **Prior knowledge.** The testers' flags in T05, T14 and T14r mean general Cardano knowledge the UI didn't supply: the minimum ADA per output, that DRep voting belongs with the public stake key, and how to read CIP-108 JSON. The verifier found no use of product-internal knowledge in any run. It noted three possible leaks:
  - T04's title. The other two pilot runs saw theirs too (T03 "Fund a brand-new wallet", T15 "Connect a dApp publicly"); neither named a screen the tester used, and T15's goal already said "ordinary public account".
  - T12's session context, which showed an email domain matching the LOGIC pool's name. The tester picked LOGIC only after their first pool failed, but the choice of pool isn't an independent signal.
  - T09's tester mentioned Seedelf-related skill names in their environment. Nothing in the trace shows they used them.
- **T04 vs T04b.** T04 was the pilot: 360x480, never confirmed, with the title "Send 12 ADA publicly" shown. The tester picked the Public tab because of that word, so its 0 wrong turns don't measure discoverability. T04b repeated the task untitled, at 360x640, with confirmation allowed. That tester pressed the Private tab's Send and reached the public Send only after the private route failed, 4 wrong turns and 17 steps in. Read T04b for discoverability and T04 for the review in the short panel.
- **T14 vs T14r.** T14 used the recorded preprod proposals, which have no title, abstract, amount or date, and the harness blocked the outside links. Its finding that no proposal could be understood is therefore a test artifact. T14r added titles, abstracts and full texts written for the test. The tester went from 4 wrong turns and 27 steps to 1 and 10, from Medium to High confidence, and could decide how to vote. Both runs still rate finding governance as needing prior knowledge.
- **T17 vs T17r.** In T17 the retry reached the wallet about 14 s after "Cancel". The 10 s decline cooldown had already ended, so a fresh prompt appeared and the cooldown went unseen. T17r chained its commands and retried about 7 s after "Cancel", inside the cooldown. T17's "no lockout" describes a 14 s retry only.
- **BLOCKED** means the tester did every step a user controls and the test environment stopped the end state. It is not a product failure. In T16 the fake giveme.my refused the session's funding. In T14 the content was missing from the recorded data. The same fake refusal ended the private sends in T05, T06 and T09, and T04b's private route. Those count as PASS WITH FRICTION because the tester reached a correct review (in T09, a valid retry), but the send itself couldn't complete.
- **Confirmation.** The network confirmed only when the tester said so: in T03, T04b, T07, T08 and E04, after the pending-state questions. T04 and T13 never confirmed.

## 3. Detailed task traces

One entry per run, in task order; reruns follow the run they repeat. Each entry gives the test setup that matters for reading it, the tester's result and the path exactly as the tester took it (wrong turns included), then the tester's hesitations and observations, the answers the task asked for, and, kept apart, the verifier's notes on what the test setup rather than the wallet caused.

### T01 · Receive ordinary ADA

**Test notes.** Main run (it predates the harness fix for "Details" toggles; none was involved). Side panel, 360x640, starting from a fresh install: the welcome screen, no wallet yet (the tester created one and chose their own password). The task text told the tester not to assume "Private" or "Public" has a particular meaning. "Create new wallet" hands the wallet over from the panel to a full tab, so everything from the recovery phrase on ran in a 1280x720 tab. Extra command `world pay`: the other person's ordinary wallet pays the address given. Its reply quotes their wallet ("Sent 50 ADA to …") without saying when the payment reaches a block, but in this harness it is in a block at once. The wallet shows such a payment only after Refresh, or when Home is opened again more than 60 s after its last reading. The harness view prints each control's accessible name beside its visible label (button "Receive privately" (shows "Receive")), so the tester saw names a sighted user doesn't.

**Result.** PASS WITH FRICTION · confidence High · 1 wrong turn · 10 navigation steps · prior product knowledge needed: no, the private Receive screen pointed to "Show my public address" and that screen called the address "an ordinary Cardano address".

**Path taken.**

1. Stopped and started the harness → the welcome screen in the panel: "A private wallet for Cardano.", "Create new wallet", "Restore wallet", and "Each opens in a full tab, which stays open while you write your phrase down or type it in."
2. Clicked "Create new wallet" → the panel closed and a 1280x720 tab opened on "Your recovery phrase", "Step 1 of 3", the phrase blurred, with "This phrase restores your Seedelfs only in Seedelf Wallet. Other Cardano wallets will show your public account and nothing else."
3. Clicked "Reveal phrase" and scrolled down → the 24 words and "I've written it down".
4. Clicked "I've written it down" → "Confirm your phrase", "Step 2 of 3", asking for words 9, 17 and 18, with Confirm disabled until all three were filled.
5. Typed the three words and clicked Confirm → "Set a password", "Step 3 of 3" ("Use at least 12 characters.").
6. Entered and confirmed a 16-character password and clicked "Create wallet" → Home, in the tab, on the "Private" tab: "Private balance 0 ₳"; Receive enabled; Send, Make public and Create disabled; "Fund your public account first: it pays for your Seedelf"; and a "Get started" card ("Your wallet has two sides: a public account, like any Cardano wallet's, and a private balance in Seedelf…") whose step 1, "Fund your public account", has a "Show my address" button.
7. Clicked the big "Receive" on the Private tab, the most obvious action and the only enabled one (wrong turn) → "Receive", "Into your private balance": "People pay a Seedelf's name, and you don't have a Seedelf yet. Create one first: your public account pays for it."; "Create a Seedelf" disabled, "Show my public address" enabled.
8. Hovered the disabled "Create a Seedelf" → tooltip "Fund your public account first: it pays for your Seedelf".
9. Clicked "Show my public address" → "Into your public account": a QR code, "Receive address" addr_test1qpfex0a3…4et2qm with Copy, and "This is an ordinary Cardano address: anyone can see what it receives. To be paid privately, give out one of your Seedelfs' names instead."
10. Hovered the small i icon beside the "Receive" title, then clicked it → "Anything that can pay a Cardano address can fund this wallet: scan the code from a phone wallet, or copy the address." (first as a tooltip, then expanded under the title).
11. Clicked Copy → the button read "Copied" and the clipboard held the full address.
12. Clicked "Show my Seedelfs' names" to see what a name looks like → back on the private Receive screen, which still said there was no Seedelf.
13. Clicked Back, then the "Public" tab → "Public account 0 ₳", Receive, "Fund your public account first: Receive shows its address", and "Create your Seedelf before making money private: then what you make private isn't tied to it."
14. Ran `world pay` of 50 ADA to the copied address → the sender's wallet said "Sent 50 ADA to addr_test1qpfex…"; the wallet still showed 0 ₳.
15. Waited 10 s → no change: "Updated 59 s ago", Public account 0 ₳.
16. Clicked the Refresh icon → "Updated just now", "Public account 50 ₳"; Send and Make private enabled.
17. Stopped the harness.

**Wrong turns.**

- Step 7: clicked the prominent "Receive" on the default Private tab, expecting an address or QR code to hand the sender; got the "Into your private balance" screen saying there was no Seedelf yet, with nothing to give out; corrected by "Show my public address" on the same screen (one extra click, no Back).

**Hesitations.**

- Step 6: Home opened on "Private" while the line under the balance said "Fund your public account first"; the tester wasn't sure whether to use the big Receive or the card's "Show my address", and chose Receive as the most obvious.
- Step 9: the warning "To be paid privately, give out one of your Seedelfs' names instead" made the tester wonder whether giving out this address was the wrong thing to do; the i text ("Anything that can pay a Cardano address can fund this wallet…") reassured them.
- Step 15: the sender had said "Sent 50 ADA", yet the balance stayed at 0 ₳ with "Updated 59 s ago"; the tester wasn't sure the money had arrived until they pressed Refresh themself.

**Observations.**

- Home lands on "Private" while its first instruction is "Fund your public account first": the default tab contradicts the first step.
- Abandonment moment at step 7 ("I don't know what to do", severity 2): the first Receive said the tester couldn't be paid without a Seedelf, and creating one was disabled. A skimming user could give up there, though "Show my public address" directly below makes that unlikely. Why "Create a Seedelf" was disabled came only from the line under it and its tooltip.
- Public Receive offers "Show my Seedelfs' names" when there are none; it only leads back to "you don't have a Seedelf yet".
- Abandonment moment at step 15 ("I don't trust pressing this button", severity 2): more than 10 s after the sender confirmed, the balance still read 0 ₳ and nothing refreshed by itself. A nervous user might think the address was wrong until they notice the small Refresh icon; it briefly cost the tester trust too.
- "Seedelf" is unexplained on the first screens; the Get started definition ("A Seedelf is a name people can pay you by privately, and only…") was cut off at the bottom of the first view.
- Create moved the wallet out of the panel into a tab and it stayed there, although the welcome screen had warned "Each opens in a full tab".
- Both tabs' buttons show only "Receive": "Receive privately" and "Receive publicly" exist only as screen-reader names, so the side is clear only from the opened screen's subtitle. "Private balance" and "Public account" don't match as names, though both made sense after the Get started text.
- On the Public tab a "Create a Seedelf" link looked enabled at 0 ₳ while Create on the Private tab was disabled (not clicked).
- Mental model: the tester expected one Receive showing one address, first read Private/Public as a privacy setting or as public and private keys, and took "Seedelf" for the product's name; the wallet treats Private and Public as two separate balances, the private one paid through a Seedelf's name, which is created and paid for from the public account.
- Worked well: the recovery-phrase screen already hinted at the two sides; the Get started card explains the two-sided model in one sentence; the dead end offered the right alternative in place; the disabled Create had a tooltip and an inline reason; public Receive says plainly what the address is ("an ordinary Cardano address") and what can pay it; "anyone can see what it receives" was honest about the privacy trade-off and raised trust; "Copied" confirmed the copy; the collapsed "Stake address, for staking only" signals it isn't for payments.

**Answers the task asked for.**

| Question | Tester's answer from the UI | Verifier's check |
|---|---|---|
| What information should I give someone using an ordinary Cardano wallet? | The public account's "Receive address", addr_test1qpfex0a3…4et2qm, or its QR code (sureness High) | Correct. The QR encodes the same address; a Seedelf name wouldn't work (only Seedelf Wallet can pay one), and this wallet had none |
| Did I initially choose the correct receive path, and why? | No: clicked the Private tab's "Receive" because Home opened there and it was the most prominent and only enabled button; its screen offered "Show my public address" (High) | Correct. The Get started "Show my address" chip was also enabled |
| Did the payment arrive where expected? | Yes: the Public account showed 50 ₳, but only after Refresh (High) | Correct. The 50 ADA landed at that address at once; the wallet read the chain again only at the Refresh; the private balance stayed 0 ₳ |

**Verifier notes.**

- Every friction point is real product behaviour and nothing was misread: every quoted string matches the build's English text, the printed views and the screenshots.
- The tester's harness suspicion, the panel handing over to a tab, is real product behaviour: from the panel, Create opens a tab and closes the panel, and nothing reopens the panel afterwards. The product's default surface is a full tab anyway, so the layout the tester ended in is what a default install shows; only the panel being a separate window and the tab's fixed 1280x720 size are the harness's.
- In a real 360x640 panel the Get started "Show my address" is probably below the fold (not checked), so this run may understate the risk of the wrong turn on private Receive.
- Home never polls balances: it reads them when opened, again only if that reading is over 60 s old, and on Refresh. On the real network inclusion takes longer than the harness's instant block, so a real user could see 0 ₳ for longer.
- Exists, not found: that an ordinary Cardano wallet can't pay a Seedelf name at all. It is in the cut-off half of Get started step 2 ("…and only someone using Seedelf Wallet can pay one."), and the private Receive screen leads with "Only someone using Seedelf Wallet can pay this. Anyone else needs your public address." only once a Seedelf exists. Neither the no-Seedelf private Receive nor the public-address warning says it, which is the gap behind the step 9 hesitation: the one sentence that answers the task's question sits behind the i icon, while the visible amber warning pushes toward a Seedelf name.
- The Public tab's "Create a Seedelf" link isn't a dead end: it opens the Create screen, whose button is disabled with "Fund your public account first…" and offers "Show my public address".
- Harness effects: the accessible names in the view ("Receive privately", "What this means") gave the tester words a sighted user doesn't see, yet they still took the wrong turn, so if anything that finding is understated; hover tooltips came back within about 0.2 s, faster than Chrome's hover delay (both texts were also on the page).
- Money: the wallet submitted nothing and paid no fee. The harness's random sender paid 50 ADA to the wallet's public receive address; the Public account went from 0 to 50 ₳ after Refresh and the private balance stayed 0 ₳. Nothing was lost or misdirected.
- Prior knowledge: none seen.

**Final result.** The tester worked out that an ordinary Cardano wallet should be given the public account's receive address (or its QR code), after one wrong turn through the default Private tab's Receive. A 50 ADA test payment to that address showed as 50 ₳, but only after a manual Refresh.

### T02 · Receive money privately

**Test notes.** Main run. Side panel, 360x640. Starting state: the funded wallet, unlocked on Home, with 28 ₳ private, 10,408.014036 ₳ public and one Seedelf already owned, tagged "web-wallet". Because the wallet is already set up, Home's "Get started" checklist, one of the two places that define a Seedelf, never shows. Extra command `world pay-seedelf`: another Seedelf Wallet user pays whatever the tester gives them; the payment is in a block at once, and the wallet shows it after Refresh or when Home is opened again more than 60 s after its last reading. The trace predates the harness fix that lets a role-and-name click reach the wallet's disclosure toggles (summary elements), which is why "Manage" took a coordinate click. The harness view prints each control's accessible name beside its visible label (button "Receive privately" (shows "Receive")), so the tester saw names a sighted user doesn't.

**Result.** PASS WITH FRICTION · confidence Medium · 0 wrong turns · 6 navigation steps · prior product knowledge needed: no, the Receive screen's "Its whole name: share this to be paid privately" said what to share, though understanding what a Seedelf is would take more.

**Path taken.**

1. Stopped and started the harness → Home on the "Private" tab: "Private balance 28 ₳", Receive, Send, Make public, Create, and a token row "asset1synt…ctusdm".
2. Took a screenshot of Home → with Private already selected and someone wanting to pay, Receive looked like the obvious next step.
3. Clicked "Receive" (screen-reader name "Receive privately") → "Receive", "Into your private balance": "Only someone using Seedelf Wallet can pay this. Anyone else needs your public address.", "Show my public address", "Share a Seedelf's whole name, not its tag: anyone can choose the same tag. Nobody can tell a payment to it is yours.", a QR code, "Its whole name: share this to be paid privately", Copy and a long hex string.
4. Scrolled down 300 px → the hex 5eed0e1f7765622d77616c6c657400ab…ab; "Tag “web-wallet”: public, and anyone can choose the same one · 1.5 ₳ locked with it, back when you remove it"; a "Manage" toggle; and "A Seedelf's name is public, and linked to whatever paid to create it. What's paid to it isn't."
5. Tried to click "Manage" by role and name, then with exact → the harness said nothing matched although it listed "Manage" as visible; the tester put this down to the harness, not something a user would see.
6. Clicked "Manage" by coordinates → it expanded: "Removing it gives back the ADA locked with it. After that, nobody can pay its name." and a "Remove web-wallet" button, which the tester had no intention of pressing.
7. Clicked "Manage" again to close it, then Copy → the button read "Copied"; the clipboard held the whole name.
8. Ran `world pay-seedelf` of 5 ADA to the whole name → the payer's wallet said "Paid 5 ADA to 5eed0e1f7765…ababab"; the Receive screen didn't change.
9. Scrolled up and clicked Back → Home still showed "Private balance 28 ₳" and "Updated 52 s ago".
10. Clicked Refresh → "Updated just now", "Private balance 33 ₳".
11. Stopped the harness.

**Wrong turns.** None.

**Hesitations.**

- Step 3: the screen showed both a long hex "whole name" and the tag "web-wallet", and the tag looked like the friendlier thing to share, like a username. "Share a Seedelf's whole name, not its tag" stopped the tester, but they read it twice to work out which was which; the tag appears only after scrolling, below the hex.
- Step 3: "Nobody can tell a payment to it is yours" next to "A Seedelf's name is public, and linked to whatever paid to create it" left the tester unsure how private this is; they accepted it without really understanding it.
- Step 6: the tester opened Manage to learn what a Seedelf is; it offered only Remove, and "After that, nobody can pay its name" made them a little nervous about whether the name they share will keep working.
- Step 9: after the payer said they had paid, Home still showed 28 ₳ ("Updated 52 s ago"); the tester wasn't sure the money had arrived until they noticed and pressed the small refresh icon.

**Observations.**

- The UI never says what a Seedelf is: it uses the word as if known ("Share a Seedelf's whole name", "Create a Seedelf") and lists only properties (a whole name, a public tag, 1.5 ₳ locked, removable). The tester had first guessed "Seedelf" was the app's brand name or their account's name; their final picture of a private receiving identity, like a stealth address holding a deposit, was their own inference.
- Two identifiers compete: the readable tag looks like the thing to share, and the warning against sharing it is small grey text above the QR code. Calling a 64-character hex string a "name" while the readable label is the "tag" goes against everyday meaning.
- The tag "web-wallet" appears above the fold only in screen-reader names ("QR code of the name of web-wallet", "Copy the name of web-wallet"); a sighted user sees it only after scrolling.
- "Manage" sits right under the name to share, and its only content is the destructive "Remove web-wallet".
- No incoming-payment notification and no activity entry seen on Home; only the balance going from 28 to 33 ₳ after a manual Refresh confirmed the money.
- Home's "Create" (screen-reader name "Create a Seedelf") hints that several Seedelfs are possible, but Receive showed one and no way to choose between them.
- "Linked to whatever paid to create it" lowered the tester's trust a little, since they didn't know what paid to create it; the privacy note read as honest but abstract.
- Worked well: Receive on the Private tab reached the answer in one click; the bold who-can-pay line at the top, with "Show my public address" as the alternative, answered who can use it; "Its whole name: share this to be paid privately" answered what to give; "Copied" feedback; the tag clearly flagged as public and spoofable.
- No abandonment moments were recorded.

**Answers the task asked for.**

| Question | Tester's answer from the UI | Verifier's check |
|---|---|---|
| What should I give the other Seedelf Wallet user so they can pay me privately? | The Seedelf's "whole name", 5eed0e1f7765…ab, or its QR code, not the tag "web-wallet", because "anyone can choose the same tag" (sureness High) | Correct. The QR encodes the same value, and paying it worked (28 → 33 ₳) |
| Does the UI teach what a Seedelf is? | Not really: it never defines the term; from fragments the tester inferred a private receiving identity (Medium) | Partly. True on the tester's path: private Receive has no definition and no i. The product defines a Seedelf elsewhere (behind the i beside the title of Create a Seedelf, and in the new-wallet "Get started" checklist). Every fact the tester pieced together is accurate, and the inference matches the product's own definition |
| Do I understand who can use it? | Yes: only Seedelf Wallet users can pay a Seedelf name; anyone else needs the public address (High) | Correct (strictly, the Seedelf CLI can pay one too; ordinary Cardano wallets can't) |

**Verifier notes.**

- Harness: the "Manage" click failure. "Manage" is a disclosure toggle (a summary element) that the view lists as a button but the role-based click couldn't find; the screenshots after both failed clicks are identical to the one before. A real user clicks it and it opens, as the coordinate click showed.
- Exists, not found: a definition of a Seedelf. "A Seedelf is a name you can give out. Anyone using Seedelf Wallet can pay it, and each payment lands in a new spot only you can open, so payments can't be linked to each other or to you." sits behind the i ("What this means") beside the title of Home → Create. The "Get started" step "Create your Seedelf" defines it too, but shows only while the wallet has no Seedelf or no private balance. Neither is on Receive, so on the task's path the absence is real.
- Exists, not found: an "Activity" row on Home's Private tab, below "dApps" and below the fold the tester never scrolled. It fills on balance reads, like the balance; the harness builder's run of the same 5 ADA payment showed it there as "Received +5 ₳".
- Not a discoverability gap: with two or more Seedelfs, private Receive lists each as its own card with its own Copy and "Show QR code"; this wallet owns one.
- "Remove web-wallet" doesn't remove anything at once: it opens a Remove screen, and nothing is sent until "Remove Seedelf" on its review.
- The two privacy statements don't contradict each other (creating the Seedelf links its name to whoever paid for it; payments into it aren't linked), but the explanation that reconciles them is only behind the i on Create a Seedelf, and the card doesn't say what paid to create the Seedelf.
- Real: Home doesn't re-read balances while open, and there are no notifications. The instant block let one Refresh find the money; on the real network a payment takes about 20 s or more to reach a block.
- Harness: the view's accessible names gave the tester text a sighted user never sees; the "several Seedelfs" point rests on "Create a Seedelf", which is only the button's accessible name.
- Money: the wallet submitted nothing. The harness payer sent 5 ADA to the wallet's variant-1 Seedelf contract address under a re-randomized copy of the web-wallet register; the private balance went from 28 to 33 ₳, exactly +5. No wallet funds were spent.
- Prior knowledge: none seen.

**Final result.** The tester gave the other person the Seedelf's whole name, copied from the Private tab's Receive, and a 5 ADA private payment to it raised the private balance from 28 to 33 ₳ after a manual Refresh. They came away knowing who can pay a Seedelf, but not what one is.

### T03 · Fund a brand-new wallet

**Test notes.** Pilot run. Side panel, 360x640. Starting state: a brand-new wallet made by the wallet's own Create flow, unlocked on Home, never funded. As in every pilot task, the task was headed with its title, "Fund a brand-new wallet" (the tester's summary of the task opens with those words); the title names the step the task asked the tester to work out first. Extra commands: `world pay`, whose pilot reply said "The payment is already in a block on the test network", so the tester knew the moment the money landed; and `world confirm`, the only way anything confirms here, for which the pilot text said: "whenever you would normally wait for a confirmation, run world confirm, then look at the wallet again". Confirmations and Refreshes therefore came seconds after each submit. A `world pay` shows in the wallet only after Refresh, or when Home is opened again more than 60 s after its last reading. Spends from the private balance can't complete in this harness; the task ended at readiness, and the tester never tried one (and wasn't told). The pilot prompt didn't yet ask testers to hover over controls, and this tester never did. The harness view prints each control's accessible name beside its visible label (button "Receive privately" (shows "Receive")), so the tester saw names a sighted user doesn't. The run predates the harness fix for "Details" toggles; none was involved.

**Result.** PASS WITH FRICTION · confidence High · 2 wrong turns · 17 navigation steps · prior product knowledge needed: no, the "Get started" checklist spelled out the order with a button for each step.

**Path taken.**

1. Stopped and started the harness → Home on the "Private" tab: "Private balance 0 ₳", "Fund your public account first: it pays for your Seedelf", and the top of a "Get started" card; Receive enabled; Send, Make public and Create greyed out.
2. Scrolled down 300 px to read Get started → 1 "Fund your public account" with "Show my address", 2 "Create your Seedelf", 3 "Make ADA private"; concluded the first thing to do is fund the public account.
3. Scrolled down another 300 px → the bottom of the page: dApps, Activity, UTxOs; nothing new about setup.
4. Clicked "Show my address" (step 1) → "Receive", "Into your public account": a QR code, the addr_test1… address and the warning that it is an ordinary address anyone can see.
5. Clicked Copy and checked the clipboard → "Copied"; the address was on the clipboard.
6. Ran `world pay` of 100 ADA → the harness said the payment was already in a block; the Receive screen didn't change.
7. Clicked Back (wrong turn) → the Public tab, not the Private tab the tester had left, scrolled down, still "0 ₳" and "Fund your public account first: Receive shows its address".
8. Scrolled up → "Public account 0 ₳", "Updated 31 s ago"; the money the tester had been told was sent didn't show.
9. Clicked the Refresh icon → "Public account 100 ₳"; Make private enabled, with a green box below: "Create your Seedelf before making money private: then what you make private isn't tied to it."
10. Scrolled down and clicked "Create a Seedelf" in the green box → the Create a Seedelf form, opened partway down (the tester scrolled up): an optional Tag, "Pay with" Public account (selected) or Private balance (disabled), "About 1.75 ₳ stays locked with the Seedelf, and the network fee is about 0.25 ₳.", and Review.
11. Left the tag empty and clicked Review → "Review the new Seedelf": "Locked with it 1.74986 ₳", Seedelf name 5eed0e1f00d3…, "Network fee 0.200636 ₳", "Total leaving your public account 1.950496 ₳", "Public account after 98.049504 ₳".
12. Scrolled down to read the fine print → "Only removing the Seedelf gives back the ADA locked with it."
13. Clicked "Create Seedelf" → back on the Public tab, scrolled partway down: balance still 100 ₳, a small grey "Wait for the last transaction to confirm", the green box still there with its button greyed out; no status message or toast seen.
14. Ran `world confirm` → one transaction went into a block; the wallet didn't change.
15. Clicked Refresh (wrong turn) → 98.049504 ₳, but "Wait for the last transaction to confirm" stayed and Make private stayed disabled.
16. Waited 5 s → the wait line went away and Make private was enabled; the tester recorded the green box disappearing here too.
17. Scrolled up, then clicked the Private tab → a "Seedelf created" banner with a Cardanoscan link; the Private tab showed 0 ₳ and "Make some ADA private first: these are paid from your private balance".
18. Scrolled down to Get started → steps 1 and 2 ticked; step 3 "Make ADA private" with a "Make private" button.
19. Clicked "Make private" (step 3) → "Make private", "98.049504 ₳ available", Amount, Max, and "Making money private links your public account to the new private UTxOs, but not to any Seedelf name."
20. Typed 50 into Amount → Review enabled.
21. Clicked Review → "Review making it private": "Into your private balance 50 ₳", "Network fee 0.172233 ₳", "Total leaving your public account 50.172233 ₳", "Public account after 47.877271 ₳", "Private balance after 50 ₳".
22. Clicked "Make 50 ₳ private" → the Public tab again (the flow had started from Private), with "Payment into your private balance sent. Waiting for the network…"; Public still 98.049504 ₳.
23. Ran `world confirm`, clicked Refresh, waited 5 s, clicked the Private tab → Public 47.877271 ₳ and Private 50 ₳, but the banner still said "Waiting for the network…" and Send was disabled.
24. Waited 10 s → the banner changed to "Made private"; Private 50 ₳; Send, Make public and Create all enabled.
25. Scrolled down → Get started was gone, which the tester took to mean setup was complete; only dApps, Activity and UTxOs remained.
26. Stopped the harness.

**Wrong turns.**

- Step 7: pressed Back from the public Receive screen expecting to return to the Private tab, or at least to see the 100 ₳ arrive; got the Public tab, scrolled down, still 0 ₳ and still asking to fund the account; corrected by scrolling up, seeing "Updated 31 s ago" and pressing the small Refresh icon.
- Step 15: refreshed after `world confirm` expecting the Seedelf to show as created and Make private to be enabled; the balance dropped to 98.05 ₳, but "Wait for the last transaction to confirm" stayed and Make private stayed disabled; corrected by waiting 5 s, after which it cleared by itself.

**Hesitations.**

- Step 1: on the Private tab, Receive was the only enabled, highlighted action while the hint said to fund the public account; the tester briefly considered Receive and chose the checklist's "Show my address" because it was tied directly to step 1.
- Step 9: with 100 ₳, "Make private" was a big enabled button right under the balance, while the box just below said "Create your Seedelf before making money private". The wallet allows the wrong order and only warns, so the tester had to decide which to trust; they followed the warning.
- Step 10: hesitated over the optional Tag; "Anyone can read it on chain." made them leave it empty. They didn't know what "About 1.75 ₳ stays locked with the Seedelf" meant for them until the review said only removing the Seedelf gives it back.
- Step 13: unsure the Seedelf had been submitted: mid-page on the Public tab, balance still 100 ₳, the "Create your Seedelf before…" box still visible, and only the small grey "Wait for the last transaction to confirm" as a sign anything happened.
- Step 23: with both balances already updated, the banner still said "Waiting for the network…" and Send was disabled, contradicting what the tester saw for about 10 s.

**Observations.**

- The order the product asked for, as a numbered "Get started" card on the Private tab: 1 "Fund your public account" ("Pay it from an exchange or another wallet."), 2 "Create your Seedelf" ("A Seedelf is a name people can pay you by privately, and only someone using Seedelf Wallet can pay one. Your public account pays for it, before any money is made private."), 3 "Make ADA private" ("What you make private afterwards isn't tied to your Seedelf."), under "Your wallet has two sides: a public account, like any Cardano wallet's, and a private balance in Seedelf. These steps set up both, in the order that keeps them apart." Each step was ticked when done and the card disappeared after step 3: a clear, if implicit, completion signal.
- The hint under the balance tracked the state ("Fund your public account first: it pays for your Seedelf", then "Make some ADA private first: these are paid from your private balance", then gone) and always pointed to the next step.
- Abandonment moment at step 8 ("This seems broken", severity 2): with the 100 ADA already in a block, the wallet still said 0 ₳ and "Fund your public account first"; a user who doesn't spot the small unlabelled Refresh icon might think the deposit was lost or went to the wrong address. Balances never refreshed by themselves.
- After "Create Seedelf" the tester saw no sign it had been submitted (no banner, the balance unchanged, the create prompt still showing), unlike Make private's "Payment into your private balance sent. Waiting for the network…"; they concluded "Seedelf created" appeared only after confirmation, at the very top of the page. Abandonment moment at step 13 ("This seems broken", severity 2): they might have been tempted to try again; the greyed-out Create link helped. Banners at the top of the page are easy to miss when scrolled down.
- Back from public Receive and the Make private submit put the tester on the Public tab with no announcement; the tester also counted the Seedelf submit (in their words: "Took me to the Public tab every time"), and twice they landed scrolled partway down.
- "Make private" is enabled and prominent before a Seedelf exists; the intended order is told, not enforced or emphasised at the button.
- After confirmation, "Wait for the last transaction to confirm" and "Waiting for the network…" lingered 5–10 s while the balances were already updated, so the tester briefly couldn't tell whether to wait or act.
- Terminology: "links your public account to the new private UTxOs" (and a "UTxOs" link on Home) is jargon for a regular user; "Seedelf", defined as "a name people can pay you by privately", sounds like a username although it shows as a long hex string, and the tester didn't learn how to share it; the explanation of "Locked with it" sits below the fold on the review. There are two entry points for receiving ("Show my address" in the checklist, "Receive" on the Private tab), and the Private tab's button shows only "Receive" (its screen-reader name is "Receive privately"), so a sighted user can't tell it from the public one.
- Disabled Send, Make public and Create on the empty Private tab have no explanation of their own; only the general hint line explains them.
- Trust: the reviews ("Nothing is sent until you press …", exact before and after balances) made submitting comfortable, and the form's estimate (about 1.75 ₳ locked plus about 0.25 ₳ fee) was close to the review's 1.74986 + 0.200636; the stale 0 ₳ and the missing feedback after Create Seedelf briefly shook confidence. The privacy warnings read as plain: the tag readable on chain, the public address visible to anyone, the Seedelf openly linked to the public account, and money made private afterwards not tied to it.
- End state seen: Public 47.877271 ₳, Private 50 ₳, one Seedelf, and private Send, Make public and Create enabled.

**Answers the task asked for.**

| Question | Tester's answer from the UI | Verifier's check |
|---|---|---|
| What is the first thing you need to do? | Fund your public account: "Fund your public account first: it pays for your Seedelf", Get started step 1, via "Show my address" (sureness High) | Correct |
| What order is the product asking you to follow? | 1 Fund your public account → 2 Create your Seedelf (paid from the public account, before any money is made private) → 3 Make ADA private (High) | Correct: the Get started steps |
| Did you reach the point where the wallet is ready for private use? | Yes: Private balance 50 ₳, private Send and Make public enabled, "Made private", Get started gone (High) | Correct: both transactions confirmed and the wallet owns the Seedelf. In this harness a private spend would still be refused, but the task asked for the readiness state |

**Verifier notes.**

- Exists, not found (and a misread): the banner after Create Seedelf. "Seedelf creation sent. Waiting for the network…" with "ae3728538c…2b6b63 on Cardanoscan" was at the top of Home from the moment of the submit, but Home came back scrolled about 200 px down, so it was out of view (the verifier inferred this from the banner's code path and the page offsets in the screenshots). The verifier calls it a discoverability problem the product causes, not a missing banner; the conclusion that "Seedelf created" appeared only after confirmation is an inference from never seeing the top of the page.
- Real: the scroll carry-over. Nothing scrolls Home to the top after a flow; the browser most likely restores the offset Home had when the flow opened (the same carry-over opened the Create form about 183 px down). The view's status line couldn't tell "no banner" from "banner scrolled out of view".
- Tab switches: real for Back from Receive (Get started's "Show my address" deliberately switches Home to Public before opening Receive) and for the Make private submit (after a submit, Home opens on the side that paid). A misread for the Seedelf: that flow started on the Public tab, so landing there was a return, not a switch.
- Real: the lingering "Waiting for the network…". Refresh only re-reads balances; the hold and the banner clear only when Home's 15 s pending watch sees the confirmation. The harness made it easy to hit (instant blocks, Refresh seconds later); left alone, the watch updates the banner and balances together.
- Misread (minor): the green box had already gone at the step 15 Refresh, not after the 5 s wait.
- Real, answering the tester's harness suspicion: there is no polling interval. Home reads balances on opening, again only if the reading is over 60 s old, and on Refresh; Back from Receive doesn't trigger a read. A real exchange deposit looks the same until Refresh.
- "Make private" before a Seedelf: it is not blocked and has no reason at the button (deliberately not enforced), but it isn't styled as the emphasised action at that point; the filled button then is "Create a Seedelf" in the box, below the fold. Its prominence is its position.
- Exists, not found: each disabled Private-tab action has a hover tooltip (Send and Make public: "Create your Seedelf first, then make some ADA private: Send and Make public pay from your private balance"; Create: "Fund your public account first: it pays for your Seedelf"). The tester never hovered; touch and keyboard users miss these too.
- Exists, not found: sharing the Seedelf's name. The Private tab's "Receive" lists each Seedelf's whole name with Copy and a QR code, and public Receive links to it ("Show my Seedelfs' names"). The task didn't need it.
- The mint's fee comes from the fixture's default script measurement, so 0.200636 ₳ isn't a live-network figure.
- Money: the harness sender paid 100 ADA to the wallet's own address. The Seedelf mint (accepted, fee 0.200636 ADA) locked 1.74986 ADA with the new Seedelf token at the Seedelf contract and returned 98.049504 ADA in change; Make private (accepted, fee 0.172233 ADA) put 50 ADA at the contract under a fresh register and returned 47.877271 ADA. Both confirmed. End state: public 47.877271, private 50, 1.74986 locked, 0.372869 in fees, 100 in total; every figure matches the reviews.
- Prior knowledge: none seen.

**Final result.** Following the "Get started" order (fund the public account, create a Seedelf, make ADA private), the tester funded the wallet with 100 ADA, created a Seedelf and made 50 ₳ private, ending ready for private use with Public 47.877271 ₳ and Private 50 ₳. The friction they met: balances that update only on Refresh, unannounced switches to the Public tab, and no visible sign after Create Seedelf (the verifier found the banner there, scrolled out of view).

### T04 · Send 12 ADA publicly (pilot, task title shown)

**Test notes.** Pilot run. Short side panel, 360x480. Starting state: the funded wallet, unlocked on Home, with 28 ₳ private and 10,408.014036 ₳ public, including 57.475311 ₳ of staking rewards. The task was headed with its title, "Send 12 ADA publicly", and the tester says they chose the Public tab because of that word; the scenario text itself never says "publicly". The pilot's starting-state text also said the tester would need the password "to approve things". Note given: "You don't need to wait for the network to confirm anything in this test: observe and answer from what the wallet shows you." Nothing confirms in this task, so the state after confirmation couldn't be seen. The pilot predates the harness fix for controls whose label is outside the visible area (they printed as "(icon, no text)") and the fix for "Details" toggles (none was involved), and its prompt didn't yet ask testers to hover. The harness view prints each control's accessible name beside its visible label (button "Send publicly" (shows "Send")), so the tester saw names a sighted user doesn't. T04b repeats the task without the title.

**Result.** PASS WITH FRICTION · confidence Medium · 0 wrong turns · 7 navigation steps · prior product knowledge needed: no, though the tester relied on the word "publicly" in the task title to choose the Public tab, and reading the staking-rewards row takes some knowledge of Cardano staking.

**Path taken.**

1. Stopped and started the harness → Home on the "Private" tab, selected by default: "Private balance 28 ₳", Receive, a large highlighted teal Send, Make public, Create, and a "Public" tab beside "Private".
2. Clicked the "Public" tab → "Public account 10,408.014036 ₳", "Includes 57.475311 ₳ of staking rewards", Receive, Send, Make private; here the highlighted teal button is "Make private", not Send.
3. Clicked "Send" (screen-reader name "Send publicly") → a screen titled "Send": "10,408.014036 ₳ available (includes 57.475311 ₳ of rewards)", a "To" field ("A Cardano address, an ADA Handle like $name, or a Seedelf's whole name. Looking up a handle tells Koios which one."), Amount with Max, and Review disabled with "Enter who it goes to."
4. Filled To with the friend's address → "Sends to addr_test1qpka…cs65nlaz" with "Save to contacts".
5. Filled Amount with 12 → Review enabled; "Send tokens too (optional)" appeared.
6. Clicked Review → "Review the payment", "Nothing is sent until you press Send", the full To address, "Amount 12 ₳", "Network fee 0.174697 ₳", a rewards row cut off at the fold, and a large Send pinned at the bottom.
7. Scrolled down 200 px → "Staking rewards moved into your balance 57.475311 ₳, already counted in it", "Total leaving your public account 12.174697 ₳", "Public account after 10,395.839339 ₳", and "Transaction details".
8. Scrolled down 200 px → "To leave staking rewards out of payments, turn off “Use staking rewards when spending” in Settings." and "It takes about a minute for the network to confirm."
9. Clicked "Transaction details" → a dialog, "The transaction": f785cdcf9e4c9695…36ddba4d, "Spends 1 UTxO", "Pays 2 outputs", output #0 to the friend's address as "#0 · a key that stakes 12 ₳", tabs Transaction and Raw CBOR; it confirmed 12 ₳ goes to the friend.
10. Clicked Close → back on the review.
11. Clicked Send → straight back to Home on the Public tab: "Payment sent. Waiting for the network…" with "f785cdcf9e…ddba4d on Cardanoscan"; balance still 10,408.014036 ₳; Send and Make private greyed out. No password was asked.
12. Scrolled down 300 px → "Wait for the last transaction to confirm" under the disabled buttons, then Staking and governance, and Tokens.
13. Scrolled down 500 px → the token list, "View all 6 tokens", "Activity", "UTxOs".
14. Clicked "Activity" → "Public activity"; the newest entries were older payments ("Sent −4.185521 ₳ and 1 token", "Sent −25.177821 ₳"), nothing for the 12 ₳.
15. Stopped the harness.

**Wrong turns.** None.

**Hesitations.**

- Step 1: the wallet opened on "Private" with a big highlighted "Send", while the friend's address was an ordinary one and the task title said "publicly". The tester didn't know what "Private balance 28 ₳" meant or whether private Send could pay an ordinary address, and had to choose between the obvious Send and the "Public" tab; they judge that someone without "publicly" in their goal would most likely have pressed the private Send.
- Step 2: the emphasised button on Public is "Make private"; the tester wondered for a moment whether the wallet wanted them to move money to private first.
- Step 3: the screen is titled just "Send" and nothing on it said it pays from the public account; only the 10,408 ₳ "available" figure showed which side it was.
- Step 6: the rewards row made the tester stop: would sending 12 ₳ also move 57 ₳ of rewards, was extra money leaving? They read the total leaving (12.174697) and the balance after (10,395.839339) to convince themselves nothing extra was leaving.
- Step 11: the tester pressed Send expecting a password prompt (they had been told they would need the password to approve things); the payment went out at once, and with the balance still at 10,408.014036 ₳ they weren't sure money had moved.

**Observations.**

- The review's figures add up (10,408.014036 − 12.174697 = 10,395.839339), it shows the full recipient address, easy to compare with what the friend sent, and "Total leaving your public account" names the side paying; "Nothing is sent until you press Send" was reassuring, and the review also says how to stop rewards being used and how long confirmation takes. Before the review, "Sends to addr_test1qpka…cs65nlaz" helped check the address's start and end, and Review stayed disabled with clear hints ("Enter who it goes to.", "Enter an amount.") until the form was complete.
- Abandonment moment at step 1 ("I don't know what to do", severity 2): unexplained Private and Public tabs, and the default side's big Send; the tester wouldn't quit but could plausibly have used the wrong side. The "Private balance 28 ₳" vs "Public account 10,408 ₳" split is never explained on Home, and on Public the visual emphasis ("Make private") points away from the task.
- Both buttons show only "Send"; "Send publicly" and "Send privately" are screen-reader names only, so a sighted user isn't told which side pays.
- The rewards row is jargon-heavy: the tester expected a payment to move only the amount plus the fee, and needed a second reading to see that the 57.475311 ₳ of rewards was being withdrawn into their balance, not leaving. At 480 px the row was cut off at the fold; "Total leaving" and "Public account after" needed a scroll while the pinned Send stayed pressable, so someone could send without ever seeing the total.
- No password or confirmation on Send surprised the tester and lowered their trust slightly, since anyone at the unlocked panel could move funds.
- Abandonment moment at step 11 ("This seems broken", severity 2): with no password prompt, the balance unchanged and nothing in Activity, a nervous user might think the send failed and try again; the disabled Send prevents a duplicate, and the visible "Payment sent. Waiting for the network…" banner kept the tester from quitting. The reason for the disabled Send was below the fold, and Activity is reachable only by scrolling past staking and the token list.
- After Send, the action buttons appeared icon-only in the first view; their labels appeared only after scrolling.
- Transaction details: "Pays 2 outputs", #0 to the friend for 12 ₳; the second output, presumably change, was below the fold in the dialog; "a key that stakes" means nothing to an ordinary user. The banner's Cardanoscan link opens an outside site (a placeholder here; not followed).

**Answers the task asked for.**

| Question | Tester's answer from the UI | Verifier's check |
|---|---|---|
| Amount shown on review | "Amount 12 ₳" (sureness High) | Correct; output #0 is 12 ADA |
| Fee shown on review | "Network fee 0.174697 ₳" (High) | Correct; equals the decoded fee |
| Recipient shown on review | The full address, matching what the friend sent (High) | Correct; byte-identical to output #0's address |
| Total leaving shown on review | "Total leaving your public account 12.174697 ₳", below the fold (High) | Correct (12 + 0.174697); below the fold at 480 px |
| Resulting balance shown on review | "Public account after 10,395.839339 ₳", below the fold; checked by subtraction (High) | Correct; matches the transaction's net effect |
| Anything else on the review | The staking-rewards row and the note to turn off "Use staking rewards when spending" in Settings (Medium) | Correct; also "Nothing is sent until you press Send", "Transaction details" and the confirmation-time line, all seen in steps 6–9 |
| Did the payment go out? | "Payment sent. Waiting for the network…" with tx f785cdcf9e…ddba4d; balance unchanged; no Activity entry yet (Medium) | Correct: submitted and accepted, never confirmed (nothing confirms in this task) |
| Was the review understandable? | Mostly: all five values labelled and consistent; the rewards row confuses, and total and balance after sit below the fold under a pinned Send (High) | Correct |

**Verifier notes.**

- Test design: the title leak. Since the scenario never says "publicly", this run didn't test whether someone holding an ordinary address finds the public side unaided from a Home that opens on Private (T04b does). Had the tester used the private Send, the wallet would have pointed them to Make public, which this harness refuses at Send.
- No password on Send is intended: the wallet signs at review and Send only submits; the keys stay in memory while the wallet is unlocked, and the only sign-time password setting is for sites. The expectation came from the pilot's "you will need it to approve things", so the surprise is partly harness-induced; the trust point stands, with auto-lock (15 minutes by default) as the only mitigation.
- Exists, not found: the send form does say which side pays, in a callout at the end of the form, below the 480 px fold, which the tester never scrolled to: "This pays from your public account in the open: anyone can see it came from you. To pay without that link, make the money private and send it from there." On Home, the selected tab and the "Public account" heading also show the side.
- Harness: "labels hidden" after Send came from the view printing the buttons as "(icon, no text)" when the banner had pushed their labels just below the fold; a real user sees the buttons cut off at the bottom edge. That the reason line sits below the fold is real.
- Real: after Send, Home keeps the last balance reading until its watch sees a confirmation (about a minute in reality; never here), and public Activity lists only confirmed transactions. Once confirmed, this payment would appear in Activity as "Sent +45.300614 ₳" (Activity nets the input against the change and ignores the rewards withdrawal), a real defect this task couldn't show.
- Real: the pinned Send on the review (the sticky footer is the default, and the review doesn't turn it off), and the wording confusion of "already counted in it" (the code shows the row was already reworded once, because "collected" read as a charge), though the rewards didn't leave (they went into the wallet's change). The Private default and the "Make private" emphasis on Public are intended; Home explains the two sides only in "Get started", which a set-up wallet doesn't show.
- The second output in Transaction details is the wallet's own change, not labelled as such; nothing explains "a key that stakes".
- Money: one transaction signed, submitted and accepted by the fake Koios, never confirmed: 12 ADA to exactly the friend's address; 57.475311 ADA of rewards withdrawn into a 48.300614 ADA change output to the wallet's own address; fee 0.174697 ADA; net −12.174697 ADA, as the review said. Nothing was lost, and nothing moved on a real network.
- Prior knowledge: none beyond the title leak, which the tester declared.

**Final result.** The tester sent 12 ADA from the public account to the friend's exact address, and the review showed a correct amount, fee, recipient, total leaving and balance after. They chose the public side because the task title said "publicly", not because the wallet led them there.

### T04b · Send 12 ADA to an ordinary address (untitled rerun of T04)

**Test notes.** Main run. Side panel, 360x640. Starting state: the funded wallet, unlocked on Home, with 28 ₳ private and 10,408.014036 ₳ public, including 57.475311 ₳ of staking rewards. Same task as T04, but with no title shown (T04's pilot run was headed "Send 12 ADA publicly") and in the taller panel. Note given: one outside service the wallet relies on refuses every request here, so after confirming something the wallet may say nothing was sent; that is the end of what the test can do, not a wallet failure. In this harness every payment from the private balance ends that way (the fake giveme.my refuses every collateral request), so the Make public route could not succeed. `world confirm` was allowed, to be run only after sending and looking at what the wallet showed right after. The trace predates the harness fix that lets a role-and-name click reach the wallet's "Details" toggles (summary elements), which affected step 13. The harness view prints each control's accessible name beside its visible label (button "Send privately" (shows "Send")), so the tester saw names a sighted user doesn't.

**Result.** PASS WITH FRICTION · confidence Medium · 4 wrong turns · 17 navigation steps · prior product knowledge needed: no, but the tester had to infer the private/public split from an error message and by exploring the Public tab.

**Path taken.**

1. Stopped and started the harness → Home on the "Private" tab: "Private balance 28 ₳", Receive, Send, Make public, Create; a "Public" tab beside it, with nothing saying there was money there.
2. Clicked "Send", the big teal button that looked like the obvious action (wrong turn) → "Send", "28 ₳ in your private balance", first field "Seedelf name" (placeholder "5eed0e1f…") with "Paste the whole name the recipient gave you. Tags aren't unique, so the name is what counts."
3. Scrolled down → "Sending right after making money private is easy to match by timing: the two sit close together on chain."; Review disabled, with "Paste the Seedelf's name."
4. Pasted the friend's address into "Seedelf name" anyway, not knowing what a Seedelf name was (wrong turn) → the field was marked invalid: "That's an ordinary address, not a Seedelf's name. Send pays Seedelfs; Make public pays any address from your private balance, and that payment shows at their end.", with a "Pay it with Make public" link.
5. Clicked "Pay it with Make public" (wrong turn) → "Make public" with the address filled in: "Pays any Cardano address or $handle from your private balance." and "Making money public where it came from links it back. Send it somewhere else, or keep it private."
6. Filled Amount with 12 → Review enabled.
7. Clicked Review → "Review the payment": the full address, "Amount 12 ₳", "Network fee 0.23026 ₳", "Total leaving your private balance 12.23026 ₳", "Private balance after 15.76974 ₳", and "Send asks giveme.my to lend the collateral, then submits."; the screen opened already scrolled down about 86 px.
8. Scrolled up → the same review with its header visible.
9. Clicked "Transaction details" → "Spends 1 UTxO"; "Pays 2 outputs" (#0 12.76974 ₳ to "a contract · Seedelf Wallet's contract · under a register", #1 12 ₳ to the friend's address, "a key that stakes"); "Reads 1 UTxO"; "Collateral: 1 UTxO", "Comes back 4.65461 ₳"; fee, size, "Signed Not yet", script data hash and contracts; further down, the datum, mem/steps and "Must be signed by".
10. Scrolled inside the dialog and hovered "What this means" (the i icon) → "The wallet shows a script by its hash, its kind and its size. It doesn't take one apart…"
11. Closed the dialog → back on the review.
12. Clicked Send → a red alert, "Nothing was sent. Something it spends may have been spent or changed since you reviewed it: make a new review to send it.", with a "Details" toggle and "Refresh and review again".
13. Clicked "Details" (wrong turn): the first try matched nothing, which the tester read as targeting the wrong one of two "Details" buttons; after scrolling they clicked the right one → "giveme.my, which lends the collateral, refused this transaction: Transaction Fails Validation. Its UTxOs may have been spent since the review: refresh, then review it again."
14. Clicked "Refresh and review again" → the review rebuilt with fee 0.229958 ₳, total 12.229958 ₳ and balance after 15.770042 ₳, and "Review updated just now. Check it again."
15. Clicked Send again → the same "Nothing was sent…", which the tester recognised as the outside-service refusal the test note warned about.
16. Clicked Home (the first attempt said Home was above the visible area; scrolled up and clicked again) → "Private balance 28 ₳": nothing had moved.
17. Clicked the "Public" tab to see what was there → "Public account 10,408.014036 ₳", "Includes 57.475311 ₳ of staking rewards", with its own Receive, Send and Make private; the tester hadn't known this money was there.
18. Clicked Send on the Public tab → "Send", "10,408.014036 ₳ available (includes 57.475311 ₳ of rewards)", a To field for "A Cardano address, an ADA Handle like $name, or a Seedelf's whole name".
19. Filled To with the friend's address and Amount with 12 → "Sends to addr_test1qpka…cs65nlaz" and a "Note (optional)" field; Review enabled.
20. Clicked Review → the full address, "Amount 12 ₳", "Network fee 0.174697 ₳", "Staking rewards moved into your balance 57.475311 ₳, already counted in it", "Total leaving your public account 12.174697 ₳", "Public account after 10,395.839339 ₳"; the big teal Send visible without scrolling.
21. Scrolled down the review → "To leave staking rewards out of payments, turn off “Use staking rewards when spending” in Settings." and "It takes about a minute for the network to confirm."
22. Clicked Send → no password asked; the Public tab of Home with "Payment sent. Waiting for the network…" and "0b65241e48…c58652 on Cardanoscan"; the balance still 10,408.014036 ₳; Send and Make private greyed out, with "Wait for the last transaction to confirm".
23. Hovered the greyed-out Send and scrolled down → tooltip "Wait for the last transaction to confirm"; the tokens list below.
24. Ran `world confirm`, waited 5 s and scrolled up → "Payment confirmed" with Dismiss; the balance 10,395.839339 ₳, exactly the review's "Public account after"; the "Includes … staking rewards" line gone; Send enabled again.
25. Stopped the harness.

**Wrong turns.**

- Step 2: clicked the big Send on the default Private Home, expecting a normal send form to paste an address into; got a form asking for a "Seedelf name", which the tester didn't understand; corrected by pasting the address anyway to see what would happen.
- Step 4: pasted the ordinary address into "Seedelf name", expecting it to be accepted or at least to be told where addresses go; it was rejected ("Send pays Seedelfs") and pointed to "Make public", with no mention of the Public tab's Send; corrected by following "Pay it with Make public".
- Step 5: paid through Make public from the 28 ₳ private balance, expecting a normal payment; the outside collateral lender, giveme.my, refused twice ("Nothing was sent"), and only later did the tester find 10,408 ₳ and an ordinary Send on the Public tab, which would have been the obvious route had they known it was there; corrected by going Home, opening the Public tab and using its Send.
- Step 13: tried to click "Details" under the error, expecting it to expand; the tester believed two buttons matched the name and the first attempt matched neither, and they had to scroll before clicking the right one; corrected by scrolling and clicking the second match.

**Hesitations.**

- Step 1: the tester didn't know which side a plain payment should come from, and nothing on Home showed the Public balance, so they used the Send in front of them.
- Step 2: "Seedelf name": they didn't know what a Seedelf was, or whether the friend's address counted as one.
- Step 4: "Make public" sounded like changing a privacy setting, not paying someone; they hesitated, unsure what would become public.
- Step 5: the note "Making money public where it came from links it back. Send it somewhere else, or keep it private." confused them; they couldn't tell whether it was warning them not to make this payment.
- Step 7: "Send asks giveme.my to lend the collateral": they didn't know what giveme.my or collateral was and wondered whether it would cost anything; the review gave no amount for it.
- Step 9: the 12.76974 ₳ output to "Seedelf Wallet's contract" didn't match the 15.76974 ₳ "Private balance after"; the tester worked out that one 25 ₳ UTxO was spent and a 3 ₳ one wasn't, which they think a normal user wouldn't, and "Comes back 4.65461 ₳" made them ask whose money that was.
- Step 12: "Something it spends may have been spent or changed since you reviewed it" sounded wrong, since they had done nothing else; only the hidden Details explained that giveme.my refused.
- Step 22: right after sending, the balance showed the old 10,408.014036 ₳ with no pending amount; only the banner said the payment was on its way.

**Observations.**

- Both reviews listed the full, unshortened address, the amount, the network fee, the total leaving and the balance after, with correct arithmetic (28 − 12.23026 = 15.76974; 10,408.014036 − 12.174697 = 10,395.839339), and the labels named the source ("Total leaving your private balance" vs "Total leaving your public account"); with "Nothing is sent until you press Send", the reviews felt trustworthy. Fees: 0.23026 ₳ on the private route, 0.174697 ₳ on the public one. The public review fits the 360x640 panel with Send visible without scrolling.
- The wallet opens on Private with only 28 ₳ showing; the 10,408 ₳ public account and its ordinary address Send are one tab away and never mentioned, so the tester spent many steps on the private route first.
- Abandonment moment at step 4 ("I don't understand what this means", severity 3): told that Send "pays Seedelfs" and that paying an address means "Make public", a user who just wants to pay a friend could easily give up or switch wallets, because "make public" sounds like exposing something. The rejection message never mentions the Public tab's Send, and "Make public" is an odd name for paying a friend.
- Abandonment moment at step 7 ("I don't trust pressing this button", severity 2): an unexplained third party, giveme.my, made the tester hesitate before pressing Send.
- Abandonment moment at step 12 ("This seems broken", severity 3): "Nothing was sent…" when they had done nothing else, and the same again after "Refresh and review again"; a normal user might give up there. The headline blamed a stale review while the real reason sat in a collapsed "Details"; with the unknown third party and the same failure on retry, this lowered the tester's trust. "Nothing was sent" plus the unchanged 28 ₳ on Home did reassure them that no money had moved. The tester recorded steps 4 and 12 as points where a normal user might give up, but marked no later step as past the point where they themselves would have stopped.
- The private-side review opened scrolled down about 86 px, cutting off the header; Transaction details was heavy going (UTxOs, datum, mem/steps, script hash).
- On the public review, "Staking rewards moved into your balance 57.475311 ₳, already counted in it" made the tester stop until they checked that the balance after equals the available amount minus 12.174697.
- No password was asked during either send. While the payment was pending, Send and Make private stayed disabled with the tooltip "Wait for the last transaction to confirm", so a second payment couldn't go by accident. After `world confirm`, "Payment confirmed" appeared, the balance became exactly the reviewed figure and the rewards line went away, matching the review.
- The screen-reader names carry the split ("Send privately", "Send publicly") while both buttons show only "Send". The private Home's token warning "Calls itself tUSDM, not on the wallet's list" was, to the tester, a good touch.
- Worked well: pasting into the wrong field gave a clear, specific message and a one-click way forward with the address carried over; the pending banner, the disabled Send with its tooltip, then "Payment confirmed" made the payment's progress easy to follow.

**Answers the task asked for.**

| Question | Tester's answer from the UI | Verifier's check |
|---|---|---|
| Does the review make the amount understandable? | Yes: "Amount 12 ₳" in bold on both the private (Make public) and public reviews (sureness High) | Correct; the submitted transaction paid exactly 12 ADA to the friend |
| Does the review make the fee understandable? | Yes: "Network fee 0.23026 ₳" on the private route (0.229958 ₳ after the refresh) and "Network fee 0.174697 ₳" on the public route; the giveme.my collateral line gave no amount, so the tester was unsure whether it costs anything (Medium) | Correct. The collateral costs the user nothing (giveme.my lends its own, taken only if a contract fails), but the review doesn't say so, so the doubt was a fair reading |
| Does the review make the recipient understandable? | Yes: the full, unshortened address, matching what the friend sent (High) | Correct; it equals submitted output 0's address |
| Does the review make the total leaving understandable? | Yes: "Total leaving your public account 12.174697 ₳" (private route: "Total leaving your private balance 12.23026 ₳"), naming the balance used (High) | Correct; 12.174697 is the public account's real net decrease |
| Does the review make the resulting balance understandable? | Yes: "Public account after 10,395.839339 ₳" (private route: "Private balance after 15.76974 ₳"); the confirmed balance matched exactly; the rewards line prompted a double-check (High) | Correct; the rewards went into the wallet's own change |
| What did the wallet show right after sending, and what changed after confirmation? | Right after: "Payment sent. Waiting for the network…" with a Cardanoscan link, the balance still 10,408.014036 ₳, Send and Make private disabled ("Wait for the last transaction to confirm"). After: "Payment confirmed", 10,395.839339 ₳, the rewards line gone, Send enabled; as expected from the review (High) | Correct ("Updated 2 min ago" with the old balance right after; "Updated just now" and the new balance after confirmation) |

**Verifier notes.**

- Harness: both refusals on the private route (steps 12 and 15) came from the fake giveme.my, which refuses every collateral request. With a real giveme.my the Make public payment would have gone out from the private balance (12 ₳ plus about 0.23 ₳ fee, leaving about 15.77 ₳) with "Payment from your private balance sent. Waiting for the network…", and the task would have finished on that route; the tester would most likely never have opened the Public tab. The step 5 wrong turn is a wrong turn only because of the fixture (it is the route the wallet itself offered), and the late discovery of the public Send is partly an artifact. The default-tab, "Seedelf name" and redirect findings came before the refusal and stand.
- Real: the refusal's headline. The wallet treats every giveme.my refusal as a stale review, so whenever giveme.my refuses for another reason the headline names the wrong cause, and giveme.my's own words sit inside a closed "Details".
- Harness: the step 13 "Details" trouble. "Details" is a disclosure toggle (a summary element) that the view lists as a button but the role-based click didn't match; there weren't two candidates, and a real user clicks it once with no scrolling. So one of the four counted wrong turns was made by the harness.
- Real: Home's tabs show only "Private" and "Public", with no amounts, and the private side says nothing about the public one; the two-sides explanation appears only in "Get started", hidden on a set-up wallet. On the Public tab, too, the filled action is Make private, not Send.
- Real: the Make public note "Making money public where it came from links it back…" shows on every Make public form, whatever the destination; it is general advice, not a reaction to this address (the specific warning for paying your own account didn't appear).
- Real: collateral is explained only in Settings → Collateral, which the review doesn't link to, and Transaction details doesn't say the collateral is giveme.my's. Nothing in the draft went to giveme.my: its outputs plus the fee equal the 25 ₳ input, and the 3 ₳ UTxO left unspent is counted in the balance after.
- Real: the scroll offset carried over from the Send form to Make public to the review; only the top bar and the test-network banner were cut off, not the "Review the payment" heading.
- Real: the balance doesn't change until confirmation (a manual Refresh might have shown the change; the tester didn't press it, so that is unverified). No password for the wallet's own payments is by design.
- Harness effects: the note primed the tester to treat the refusal as the end of that route and keep exploring, probably more persistence than a real user would show after two "Nothing was sent"; the view's accessible names hinted at the private/public split before the screens did, so the run may understate how confusing the default tab is; `world confirm` came about 10 s after Send, so the pending state was brief, with figures and outcome unaffected.
- Money: one transaction submitted, accepted and confirmed, from the public account: 12 ADA to exactly the friend's address; 57.475311 ADA of staking rewards withdrawn into a 48.300614 ADA change output to the wallet's own address; fee 0.174697 ADA; net −12.174697 ADA, exactly the review's "Public account after". The Make public draft and its rebuild were never submitted, and the private balance stayed at 28 ₳.
- Prior knowledge: none of the product; general Cardano UTxO knowledge was used only to read Transaction details.

**Final result.** The tester sent 12 ADA to the friend from the public account, and it confirmed at exactly the reviewed balance. Without the title's hint they first took the default Private tab's Send, which redirected them to Make public, a route the harness's collateral service refused twice; they found the Public tab only by exploring after that failure.

### T05 · Spend the maximum private amount

**Test notes.** Surface: a 360x640 window standing in for Chrome's side panel. Starting state: the funded wallet, unlocked, on Home's Private tab with "Private balance 28 ₳" and one token flagged "Calls itself tUSDM, not on the wallet's list". Data: the recipient's Seedelf name (tag "This is a test.", a fixture Seedelf another wallet owns). The task told the tester that if there was no straightforward Max workflow, they shouldn't calculate the answer from source code but attempt it as a normal user would. The tester was also told that an outside service refuses every request here, so the last step of paying from the private balance (after review and confirmation) would fail with a message that nothing was sent, and that everything up to the confirmation counts as the task. Private-balance payments can't complete in this environment: the fake giveme.my refuses every collateral request. The harness view prints each control's accessible name beside its visible label (button "Send privately" (shows "Send")), so the tester saw names a sighted user doesn't. Main-run trace: it predates the harness fix for "Details" toggles, which affected step 32.

**Result.** PASS WITH FRICTION · confidence Low · 5 wrong turns · 22 navigation steps · prior product knowledge needed: yes, though what the tester names is general Cardano knowledge (minimum ADA per output, change outputs carrying tokens) or blind bisection, not knowledge of this wallet.

**Path taken.**
1. Ran stop, then start → Home on the Private tab: "Private balance 28 ₳", buttons Receive, Send, Make public and Create, and the token "asset1synt…ctusdm" 1,234.56, "Calls itself tUSDM, not on the wallet's list".
2. Clicked Send (accessible name "Send privately") → the Send form: "28 ₳ in your private balance", a "Seedelf name" field, Amount (placeholder 0), "Add tokens", "Add recipient" and a disabled Review; no Max or "Send all" near Amount.
3. Filled "Seedelf name" with the recipient's name → "Found: This is a test. · 5eed0e1f5468…8e0d63 ·" and a "Save to contacts" link.
4. Clicked Amount, hovered "28 ₳ in your private balance" hoping a click would fill the amount, then scrolled down looking for Max → no tooltip, nothing clickable; below, only a privacy note about timing and the version footer.
5. Typed the full balance, 28 → Review enabled, with no inline warning. (wrong turn)
6. Clicked Review → red alert "Not enough ADA in your private balance for this and its fee.", with no fee figure.
7. Changed the amount to 27 and clicked Review → the same alert; it hadn't cleared during the edit, so at first the tester couldn't tell whether it was a fresh result. (wrong turn)
8. Amount 25, Review → "Review the payment": "Amount 25 ₳", "Network fee 0.271986 ₳", "Total leaving your private balance 25.271986 ₳", "Private balance after 2.728014 ₳", and Send.
9. Opened "Transaction details", expanded it and scrolled to the outputs → dialog "The transaction": "Spends 2 UTxOs", "Pays 2 outputs", #0 25 ₳ to Seedelf Wallet's contract, #1 2.728014 ₳ plus 1,234,560,000 asset1aetp…kf6dul, which the tester read as their change carrying the tokens; scrolling over the dialog sometimes moved the page instead.
10. Closed the dialog; Back was scrolled out of view, so scrolled up and clicked Back → the Send form, inputs kept (25).
11. Amount 26, Review → review: 26 ₳, fee 0.271986 ₳, "Private balance after 1.728014 ₳".
12. Back, 26.5, Review → "Not enough ADA in your private balance for this and its fee.", although by the tester's sum about 1.23 ₳ would remain. (wrong turn)
13. 26.3, Review → the same alert.
14. 26.2, Review → the same alert.
15. 26.1, Review → the same alert.
16. 26 again on the same screen, to test whether the alert was stale → the review opened: validation is live and the limit lies between 26 and 26.1.
17. Back, then "Add tokens", to see whether sending the token too would let all the ADA go → an "Add tokens" sheet with the asset1synt…ctusdm row, "Select all" and a disabled Add.
18. Selected the token and clicked Add → a token row with an amount field "of 1,234.56", a "Max" button and an X; Review disabled with "Give each token an amount, or take it off."; a Max for tokens, none for ADA.
19. Clicked the token's Max (1,234.56), set ADA to 27.7, Review → the same "Not enough ADA…" alert; a hint under Amount now read "Leave it empty and the tokens go with only the ADA they need. The review shows how much." (wrong turn)
20. ADA 27.5, then 27, token included → the same alert both times.
21. Emptied ADA (token included), Review → review: "Amount 1.64642 ₳", "Tokens 1,234.56 asset1synt…ctusdm" with "Not on the wallet's list: it calls itself tUSDM, but it isn't the listed tUSDM.", fee 0.271986 ₳, "Total leaving your private balance 1.918406 ₳ and 1 token", "Private balance after 26.081594 ₳" and "1.64642 ₳ is the least ADA the network accepts with these tokens."
22. Back, ADA 27.728014 (28 minus the fee, to leave nothing) with the token → the same alert.
23. 27.74, then 27.75, with the token → the same alert both times.
24. 26.7, then 26.5, with the token → the same alert both times.
25. 26 with the token → review: "Total leaving your private balance 26.271986 ₳ and 1 token", "Private balance after 1.728014 ₳"; the tester concluded that adding the token didn't raise the ADA limit.
26. Opened "Transaction details" on that review → output #1 held 26 ₳ plus 1,234,560,000 asset1aetp…kf6dul; scrolling moved the page more than the dialog; nothing explained the leftover.
27. Closed it, Back, took the token off with its X, ADA 26.05, Review → review: 26.05 ₳, "Private balance after 1.678014 ₳".
28. Back, ADA 26.081594 (28 minus the fee minus the 1.64642 ₳ token minimum the wallet had shown), Review → the "Not enough ADA…" alert. (wrong turn)
29. 26.07, Review → the same alert.
30. 26.06, Review → review: "Amount 26.06 ₳", "Network fee 0.271986 ₳", "Total leaving your private balance 26.331986 ₳", "Private balance after 1.668014 ₳".
31. Clicked Send → red alert "Nothing was sent. Something it spends may have been spent or changed since you reviewed it: make a new review to send it.", with "Details" and "Refresh and review again".
32. Clicked "Details" (the first click was reported as covered by the alert; a click on the visible text worked) → "giveme.my, which lends the collateral, refused this transaction: Transaction Fails Validation. Its UTxOs may have been spent since the review: refresh, then review it again." The tester stopped here as the expected refusal; their next step would be "Refresh and review again".
33. Ran stop.

**Wrong turns.**
- Step 5: entered the full balance, 28, expecting a warning before Review or a review that subtracts the fee; got an enabled Review and, on clicking it, "Not enough ADA in your private balance for this and its fee." with no fee figure; corrected by lowering the amount by trial and error.
- Step 7: tried 27, assuming a fee under 1 ADA, expecting 27 plus the fee to fit in 28; got the same error (once a review later showed a 0.271986 ₳ fee, the tester judged "for this and its fee" misleading: something else had to stay behind); corrected by dropping to 25 to get any review at all.
- Step 12: tried 26.5, then 26.3, 26.2 and 26.1, having seen the 0.271986 ₳ fee, expecting anything up to about 27.72 to work; got the same message every time; corrected by bisecting downward.
- Step 19: added the token with Max, thinking the leftover stayed behind only to carry the token, expecting 27.7 or 28 minus the fee to pass; every amount above about 26 was still refused (27.7, 27.5, 27, 27.728014, 27.74, 27.75, 26.7, 26.5), while 26 with the token passed and still left 1.728014 ₳; corrected by taking the token off and bisecting ADA alone.
- Step 28: calculated 26.081594 from "1.64642 ₳ is the least ADA the network accepts with these tokens", guessing the leftover had to hold that much to keep the token, expecting it to be the exact maximum; got a refusal, the real limit lying between 26.06 and 26.07; corrected by bisecting (26.07 failed, 26.06 passed).

**Hesitations.**
- Step 2: looked for a Max or "Send all" by the Amount field and found none, even after scrolling; unsure whether to type the balance or hunt elsewhere.
- Step 4: hovered "28 ₳ in your private balance" hoping a click would fill the amount, as in some wallets; it isn't interactive.
- Step 7: the red alert stayed while the amount was edited, so after pressing Review again the tester couldn't tell whether it was new or left over.
- Step 17: unsure whether "as much of my private balance as possible" meant ADA only or the token too; the flag "Calls itself tUSDM, not on the wallet's list" made the tester hesitate to send it.
- Step 31: after Send, the main message blamed a stale input ("Something it spends may have been spent or changed") rather than a service; only the collapsed Details named giveme.my.

**Observations.**
- Confidence Low: the tester reached a confirmed send of 26.06 of 28 ₳ only by guessing amounts over and over (about 15 guesses by their count), never learned the real rule, doesn't know whether 26.06 is the true maximum, and couldn't repeat it with any certainty on another balance.
- No Max for ADA: the ADA Amount field has no Max or "Send all", yet each added token row gets one ("Max" on screen, "All of asset1synt…ctusdm" to screen readers); in the tester's words, "The feature exists for tokens and is missing exactly where I needed it." The tester expected a Max that fills the balance minus the fee and any required reserve.
- The shortfall message: Review stays enabled for the full balance, and the error comes only after the click, without the fee or how much could be sent. "Not enough ADA in your private balance for this and its fee." came back for 26.1 to 27.75, where amount plus fee clearly fitted; the tester inferred a hidden leftover of about 1.67 ₳ that the message never mentions. The contradiction "made me doubt the wallet's arithmetic".
- Tokens: sending the token too, so that no change would have to carry it, didn't raise the ADA limit in the tester's tries (26 passed and 26.5 failed either way), and nothing explained why. With a token added, an empty amount means sending only the ADA the tokens need, where the tester had expected an empty amount to be invalid.
- The leftover: the review's "Private balance after" shows it (1.668014 ₳ at best) without saying why it can't be sent. The only minimum-ADA explanations on the flow are for tokens, the hint "Leave it empty and the tokens go with only the ADA they need. The review shows how much." and the note "1.64642 ₳ is the least ADA the network accepts with these tokens.", both of which the tester called good.
- The fee stayed 0.271986 ₳ in every review, with or without the token.
- The failure: the headline blames a stale input while Details blames an outside service; "Nothing was sent" assured the tester that no money had moved.
- Two abandonment moments, both severity 3 of 5. At step 15 ("This seems broken"): 26.1 to 26.5 were refused although the review had shown a fee of only 0.271986 ₳; the message contradicts the arithmetic, so it looks like a bug, and many users would settle for a round 26 or 25 here, or give up on sending everything. At step 24 ("I don't understand what this means"): adding the token still capped the amount near 26 with no explanation; "I'd have stopped trying to find the true max here and just sent 26." The tester marked no later step as past an abandonment point.
- Smaller friction: the review's Back had scrolled out of view, so editing meant scrolling up; the mouse wheel over the Transaction details dialog sometimes scrolled the page behind it; the first click on the failure screen's Details was reported as covered by the alert (the last two are harness effects; see the verifier notes).
- Worked well, per the tester: "Found: This is a test." straight after pasting; "28 ₳ in your private balance" made the private side clear; Back kept the inputs; validation is live; the review spells out the fee, the total leaving and "Private balance after", and "Nothing is sent until you press Send" made the tester comfortable pressing Send.
- Screen-reader names add context the visible labels lack: "Send privately" (shows "Send"), "Receive privately" (shows "Receive"), "All of asset1synt…ctusdm" (shows "Max").

**Answers the task asked for.**

| Question | Tester's answer from the UI | Verifier's check |
|---|---|---|
| How do I send as much of my private balance as possible to another Seedelf user? | Home (Private) → Send → paste the Seedelf name → type an ADA amount by hand (no Max for ADA) → Review → Send. By guessing, about 26.06 ₳ of 28 ₳ passes review (fee 0.271986 ₳, 1.668014 ₳ left); 26.07 and above give "Not enough ADA in your private balance for this and its fee." Sureness Low. | Partly. The path is right: it is the only flow that pays a Seedelf from the private balance, and it has no ADA Max. With the token kept, the cap lies between 26.06 and 26.07 ₳ (28 ₳, minus a fee estimated at about 0.29 ₳ rather than the 0.271986 ₳ shown, minus the 1.64642 ₳ the change needs while it holds the token). Sending the token too lowers that floor to about 1.45678 ₳, so about 26.25 ₳ plus all the tokens would pass, a range the tester never tried. The balance can never be emptied to a Seedelf: at least about 1.46 ₳ stays. |
| Does the product provide a straightforward Max workflow? | Not for ADA; the only Max is on added token rows (announced as "All of" plus the token's name). Sureness High. | Correct. An ADA Max exists only on public Send, Make private and Make public (which pays addresses and handles, not Seedelfs); the private transfer has no Max mode. |
| What happened at the final step? | "Nothing was sent. Something it spends may have been spent or changed since you reviewed it: make a new review to send it."; Details: "giveme.my, which lends the collateral, refused this transaction: Transaction Fails Validation."; next, "Refresh and review again". Sureness High. | Correct. The refusal came from the fake giveme.my and nothing was submitted; in this harness "Refresh and review again" would build again and be refused again. |

**Verifier notes.**
- Result kept: PASS WITH FRICTION. The friction is the product's; the only harness effect is the expected refusal after Send, which the task excluded.
- Real, and the cause of the error that seemed to contradict the fee: the private Send's shortfall sentence drops the end of the core library's own message ("Not enough ADA in the Seedelf balance for this, its fee and the change"), and its early check catches only amounts above the balance. The real limit is the change's minimum ADA (1.64642 ₳ while the token stays), checked against a fee estimated from guessed script budgets (about 0.29 ₳; the bisection puts it between 0.2836 and 0.2936 ₳), not the 0.271986 ₳ the review shows. The tester's floor reasoning at step 28 was right, but even a user who knows the minimum-ADA rule can't work out the maximum from the screen. Public Send has messages with figures for this case (the most it can pay, with "Use Max", and a warning when what stays would be under the network's minimum); the private Send has neither.
- Real, and stronger than the tester guessed: a remainder between zero and the change's floor is always refused, so the private balance can never be emptied to a Seedelf; at least about 1.46 ₳ stays (about 1.67 ₳ while the token stays), with no explanation.
- Misread, per the verifier an over-generalisation rather than a misread screen: sending the token does help. With the token gone, the change's floor drops to about 1.45678 ₳, allowing about 26.25 ₳ plus all the tokens; the with-token tries (26 passed, 26.5 failed, nothing in between) couldn't tell the two rules apart. That nothing explains it is real.
- Partly harness: the alert does clear when Review starts a build (the button reads "Building…" with a stage line) and comes back if the build fails; the harness's settled views hide that gap, so not knowing whether an error was new is mostly the harness. The alert surviving edits to the amount is real.
- Harness: the wheel moved the page because the tester's `scroll in=The transaction` put it over the dialog's title bar, which doesn't scroll; over the content ("Pays 2 outputs") the dialog scrolled normally. A small real residue: the dialog has no overscroll containment, so a wheel over its title bar or past the end of its content moves the dimmed page. That page scroll is also why Back was out of view at step 10; on the plain reviews Back was in view.
- Harness: the first "Details" click matched by substring and most likely resolved to "Transaction details", which lay under the sticky foot's alert, hence "covered"; the visible "▸ Details" was clear of the alert, and a real click opens it at once.
- Harness: the fake Koios gives the token a made-up fingerprint ("asset1synt…ctusdm" on Home, Send and the reviews), while Transaction details computes the real CIP-14 one ("asset1aetp…kf6dul"), so one token looks like two across screens; the tester didn't notice and it didn't affect the result.
- Real wording, harness occurrence: the stale-input headline is what the wallet shows for any giveme.my refusal; this refusal came from the fixture, and with a working giveme.my this payment would have been submitted.
- The boundary figures (fee 0.271986 ₳, floors 1.64642 ₳ and about 1.45678 ₳) come from the fixture's two private UTxOs and protocol parameters: the behaviour generalises, the numbers don't.
- Money check: nothing moved and nothing was submitted. Each of the 23 Review presses was a fresh build that read Koios, and no submission followed Send. The private balance stays 28 ₳ plus the token; no fee or collateral was spent.
- Prior knowledge: none seen beyond the general Cardano knowledge the tester declared, which led only to the 26.081594 guess and the token experiment.

**Final result.** The private Send has no Max for ADA, and its only error mentions the fee, not the leftover that must stay behind; by bisecting, the tester found 26.06 ₳ of 28 ₳ to be about the most that passes review (26.07 fails), without learning why. They reviewed and pressed Send, which ended at the expected test-environment refusal ("Nothing was sent").

### T06 · Pay a normal Cardano address using private funds

**Test notes.** Surface: a 360x640 window standing in for Chrome's side panel. Starting state: the funded wallet, unlocked, on Home's Private tab with "Private balance 28 ₳". Data: an ordinary preprod address (random key hashes, nobody's wallet), with "They ask for 5 ADA." The task said not to assume which feature does this and to record the terminology the tester expected and found. The tester was told that an outside service refuses every request here, so the last step of paying from the private balance (after review and confirmation) would fail with a message that nothing was sent, and that everything up to the confirmation counts as the task; also that they needn't wait for the network to confirm anything. The feature that does this, Make public, pays from the private balance, so it can't complete here: the fake giveme.my refuses every collateral request. The harness view prints each control's accessible name beside its visible label (button "Send privately" (shows "Send")), so the tester saw names a sighted user doesn't. Main-run trace: it predates the harness fix for "Details" toggles, which affected step 9.

**Result.** PASS WITH FRICTION · confidence High · 1 wrong turn · 6 navigation steps · prior product knowledge needed: no, the wallet's own inline error on Send named the right feature, though the tester adds that Make public can't be guessed from Home alone.

**Path taken.**
1. Ran stop, then start → Home on the Private tab: "Private balance 28 ₳", buttons Receive, Send (filled teal, which the tester read as the main action), Make public and Create; to the tester "Make public" sounded like moving their own money from private to public, not paying someone.
2. Clicked Send (accessible name "Send privately") → the Send screen: "28 ₳ in your private balance", a "Seedelf name" field with placeholder "5eed0e1f…", the hint "Paste the whole name the recipient gave you. Tags aren't unique, so the name is what counts." and a disabled Review; the tester didn't know what a Seedelf name was. (wrong turn)
3. Scrolled down → a privacy note, "Sending right after making money private is easy to match by timing: the two sit close together on chain.", and the line "Paste the Seedelf's name."; nothing mentioned ordinary addresses.
4. Filled the ordinary address into "Seedelf name" anyway, hoping it would work → the field turned invalid with "That's an ordinary address, not a Seedelf's name. Send pays Seedelfs; Make public pays any address from your private balance, and that payment shows at their end." and a teal link "Pay it with Make public", which the tester called "a very helpful redirect".
5. Clicked "Pay it with Make public" → the Make public screen: "Pays any Cardano address or $handle from your private balance.", To already filled ("Sends to addr_test1qpka…cs65nlaz ·" with "Save to contacts"), Amount with Max, "Add tokens", "Add recipient", and the note "Making money public where it came from links it back. Send it somewhere else, or keep it private.", which the tester found hard to parse.
6. Amount 5 → Review enabled.
7. Clicked Review → "Review the payment", "Nothing is sent until you press Send", To with the full address (it matched the one given), "Amount 5 ₳", "Network fee 0.23026 ₳", "Total leaving your private balance 5.23026 ₳", "Private balance after 22.76974 ₳", "Send asks giveme.my to lend the collateral, then submits. It takes about a minute for the network to confirm.", and buttons "Transaction details" and Send.
8. Checked the address character by character against the one given, then clicked Send → red box "Nothing was sent. Something it spends may have been spent or changed since you reviewed it: make a new review to send it.", with "Details" and "Refresh and review again".
9. Tried "Details" with an exact-name match → nothing matched (a harness targeting quirk); scrolled down → nothing changed on screen.
10. Clicked "Details", the disclosure under the error → "giveme.my, which lends the collateral, refused this transaction: Transaction Fails Validation. Its UTxOs may have been spent since the review: refresh, then review it again."; now the tester could see that an outside service had refused it.
11. Clicked "Home" (the Seedelf logo; the first try found it scrolled out of view, so scrolled up first) → Home with "Updated 1 min ago" and "Private balance" still 28 ₳, which the tester took as confirmation that no money had left.
12. Ran stop.

**Wrong turns.**
- Step 2: clicked Send on the Private tab to pay an ordinary address, expecting a send form with a recipient address field; got a form asking for a "Seedelf name" (placeholder "5eed0e1f…"), and after pasting the address, "That's an ordinary address, not a Seedelf's name. Send pays Seedelfs; Make public pays any address from your private balance"; corrected by the inline link "Pay it with Make public", which opened the Make public form with the address filled in.

**Hesitations.**
- Step 1: had to choose between Send and Make public; picked Send as the highlighted, conventional choice, since "Make public" read as "move my money to my own public balance", not "pay someone".
- Step 2: the only recipient field is labelled "Seedelf name", and nothing on the screen said whether an ordinary address would be accepted, so the tester pasted it as a test. Logged as an abandonment moment ("I don't know what to do", severity 2 of 5): a cautious user might stop here, thinking the wallet can't pay ordinary addresses from private funds; the tester went on only because pasting the address brought the redirect.
- Step 5: "Making money public where it came from links it back. Send it somewhere else, or keep it private." made the tester pause, unsure whether it warned against what they were doing; they decided it was about sending back to the original source, which wasn't their case.
- Step 7: on "Send asks giveme.my to lend the collateral", the tester didn't know what collateral was or who giveme.my is, and briefly wondered whether an extra cost or a third party was involved; the total showed only the 0.23026 ₳ fee, so they went ahead.

**Observations.**
- Finding the feature: the obvious teal Send accepts only a "Seedelf name", and nothing before pasting says ordinary addresses go elsewhere; the tester found out only from the error. The feature that pays them is "Make public": the tester expected "Send", "Pay" or "Withdraw", and "Make public" sounds like converting one's own funds, not paying a third party. Its subtitle, "Pays any Cardano address or $handle from your private balance.", is plain and exactly what was needed, but shows only once you are on that screen. Without the inline redirect the tester might not have tried it.
- The redirect: "excellent recovery design". It explained the difference between Send and Make public, and "Pay it with Make public" kept the address.
- Terms: "Seedelf name" isn't explained before you hit it (the placeholder "5eed0e1f…" hints at the format); "collateral" and giveme.my are never explained; the expected-versus-found list is in the table below.
- The links-back note: its grammar ("making money public where it came from") is hard to parse, and it read like a warning against the action being taken.
- The review: thorough (full address, amount, fee, "Total leaving your private balance", "Private balance after", "Nothing is sent until you press Send"); the tester trusted it because it showed the full address and the balance after. The giveme.my line "slightly lowered my trust": an unexplained third party in a private payment.
- The failure: the headline points at the user's own funds ("Something it spends may have been spent or changed since you reviewed it"), and only expanding Details shows giveme.my. The mismatch was "a little unsettling", though "Nothing was sent" reassured the tester, and the balance stayed at 28 ₳. Logged as an abandonment moment ("This seems broken", severity 2 of 5): this was the expected test refusal, but a real user who kept seeing it after "Refresh and review again" could give up.
- Screen-reader names add information sighted users don't get: Home's buttons are announced as "Send privately" and "Receive privately" but show "Send" and "Receive", so a sighted user isn't told that Send is the private-to-Seedelf path.
- The wallet never asked for the password during this flow.
- As a real user the tester would next press "Refresh and review again" once; if the giveme.my refusal came back, they would wait and try later, or look for a way to send without the collateral service.
- Confidence High: the confirmed payment took 7 actions and the one wrong turn was caught at once by a clear inline message; the tester is still unsure why paying an ordinary address is called "Make public", and what a Seedelf really is.

**Answers the task asked for.**

| Question | Tester's answer from the UI | Verifier's check |
|---|---|---|
| Which feature pays an ordinary Cardano address from the private balance? | "Make public": "Pays any Cardano address or $handle from your private balance." Send only pays Seedelfs: "Send pays Seedelfs; Make public pays any address from your private balance, and that payment shows at their end." Sureness High. | Correct. Make public; Send takes only Seedelf names and points an address to Make public. |
| What terminology did I expect to find? | "Send" or "Pay" with a "Recipient address" or "To address" field, maybe "Withdraw" or "Send to address" for leaving the private side. Sureness High. | The tester's own expectation, so nothing to check; it fits the trace. "Withdraw" happens to be the code's internal name for Make public, a word the UI never shows. |
| What terminology does the wallet actually use? | "Send" ("Send privately" to screen readers) with a "Seedelf name" field, for paying Seedelfs; "Make public" with a "To" field (any Cardano address or $handle) for ordinary addresses; "Private balance" and "Public" tabs; on the review "Review the payment", "Total leaving your private balance", "Private balance after", "Network fee", "giveme.my to lend the collateral". Sureness High. | Correct. |
| Did money move? | No: "Nothing was sent.", and Home still showed "Private balance 28 ₳" afterwards. Sureness High. | Correct: nothing was signed or submitted. The 28 ₳ on Home was the reading from the start of the task ("Updated 1 min ago"), not a fresh one. |
| What was the cost shown before confirming? | Amount 5 ₳, network fee 0.23026 ₳, 5.23026 ₳ leaving the private balance, private balance after 22.76974 ₳. Sureness High. | Correct; the arithmetic is consistent and there are no other charges (the collateral is giveme.my's own and isn't billed). |

**Verifier notes.**
- Result kept: PASS WITH FRICTION. The wrong turn and the friction come from the product's behaviour and wording; only the final refusal is the harness's, and the tester excluded it as instructed.
- Harness: the exact "Details" click failed because the toggle is an HTML summary element, which the click resolver's role matching doesn't treat as a button, although the view lists it as one. A real user sees "▸ Details" under the red box, and one click opens it.
- Harness: the giveme.my refusal, and with it the step-8 abandonment moment. A real user wouldn't hit it on a valid payment: with the real giveme.my this payment would be submitted and shown as pending on Home. The recovery path (refresh, new review, Send) can't be evaluated in this harness.
- Real: before anything is typed, the Send form shows only "Seedelf name", the placeholder and the paste hint; the pointer to Make public appears only once an address-like value is in the field. Nothing on Home or on the empty form points to Make public first: Home's action buttons carry a tooltip only to explain why they are disabled, and the Get started card is hidden for this wallet. Make public is explained only on its own screen, and when opened directly its To field starts empty rather than offering the user's own account (a "Your accounts" picker appears only when there are several accounts).
- Real: the links-back note shows on every single-recipient Make public form, whatever the destination; the tester's final reading, that it is about paying back to where the money came from, is what it means. Paying the user's own account gets a separate warning.
- Real: the review's giveme.my line has no ⓘ or link, and no cost is hidden ("Total leaving" is the amount plus the network fee). The tester was right that a third party is involved: giveme.my, which the wallet's makers run, sees each private payment along with the user's IP address, and the wallet says so only in Settings.
- Exists-not-found: collateral and giveme.my are explained in Settings → Collateral, by the title's ⓘ ("Collateral is 5 ₳ of your public account set aside for transactions that run a smart contract, …") and a callout ("Payments from your private balance never put it up: giveme.my lends its own, so nothing on chain ties them to your account. giveme.my is run by Logical Mechanism, who make Seedelf Wallet, and it sees each of those payments, with your IP address."), and again in Settings' privacy text. All of it is off the payment path, and the tester had no reason to open Settings.
- Exists-not-found: what a Seedelf is. Home → Create's title ⓘ says "A Seedelf is a name you can give out. Anyone using Seedelf Wallet can pay it, and each payment lands in a new spot only you can open, so payments can't be linked to each other or to you."; Home → Receive, under "Your Seedelfs", says "Only someone using Seedelf Wallet can pay this. Anyone else needs your public address."; the Get started card explains it too but is hidden for this wallet. None of these is on the Send → Make public path, and the task didn't require them.
- Real: the refusal headline never names the service. Every non-OK answer from giveme.my gets the same "spent or changed" headline, so a real refusal for another reason (an HTTP 5xx, say) would read the same way.
- Misread: Details doesn't put the blame on giveme.my; it repeats the headline's likely cause (spent UTxOs) and adds who refused. The real part of the complaint, that the headline never names the service, stands. Being told in advance that an outside service would refuse likely shaped this reading.
- Real: the accessible names "Send privately" and "Receive privately" against the visible "Send" and "Receive". Sighted users do get the private context from the selected Private tab and the "Private balance" heading, but neither the label nor the name says that Send pays only Seedelfs.
- Real, by design: no password is asked while the wallet is unlocked; the password guards unlocking, settings and approvals for sites.
- Step 11: the 28 ₳ on Home was the balance read at the start of the task, since returning by the logo doesn't read again. The conclusion that no money moved is right, but "Nothing was sent" proved it, not the figure.
- Not raised by the tester: Make public opened scrolled about 126 px down, with its title and Back off screen, because changing screens keeps the scroll position; and "Pay it with Make public" carries over only the address, so an amount already typed on Send would be dropped (it didn't come up here).
- Money check: nothing moved; nothing was signed or submitted, because the giveme.my refusal comes before signing. The reviewed payment would have paid 5 ₳ to the given address (all 108 characters match), with a 0.23026 ₳ fee and the change back into the private balance, leaving 22.76974 ₳; the collateral would have been giveme.my's own UTxO. The public account was never touched.
- Prior knowledge: none seen; every control the tester used was printed in the view just before.

**Final result.** The tester first tried the highlighted Send, which takes only Seedelf names; pasting the ordinary address there brought an inline explanation and a "Pay it with Make public" link that carried the address over, and the 5 ₳ payment then reviewed cleanly. Send ended at the expected giveme.my refusal and nothing moved; the name "Make public" for paying someone else stayed puzzling.

### T07 · Make ADA private

**Test notes.** Surface: a 360x640 window standing in for Chrome's side panel. Starting state: the funded wallet, unlocked, on Home's Private tab ("Private balance 28 ₳"); the Public tab holds "Public account 10,408.014036 ₳" with "Includes 57.475311 ₳ of staking rewards". The tester was told "You do not need to wait for anything in this test." and given an extra command, `world confirm`, which puts the submitted transaction into a block at once, to use only after answering the questions about the state right after submission. The network confirms only on that command, and the wallet notices at its next 15-second check. A Make private is paid from the public account, so the giveme.my refusal that stops private-balance payments in this environment doesn't apply and the task could complete. The harness view prints each control's accessible name beside its visible label (button "Receive privately" (shows "Receive")), so the tester knew which side each action belonged to. Main-run trace (it predates the harness fix for "Details" toggles; none was involved).

**Result.** PASS WITH FRICTION · confidence High · 0 wrong turns · 14 navigation steps · prior product knowledge needed: no, the labels "Public", "Private" and "Make private" were enough, though the review's staking-rewards row and Transaction details assume some Cardano familiarity.

**Path taken.**
1. Ran stop, then start → Home on the Private tab: "Private balance 28 ₳", Receive, Send, Make public, Create.
2. Took a screenshot of Home → a Private/Public segmented toggle with Private selected, a big "28 ₳" and four round action buttons.
3. Clicked the "Public" tab → "Public account 10,408.014036 ₳", "Includes 57.475311 ₳ of staking rewards", and Receive, Send and "Make private" (the highlighted teal button).
4. Clicked "Make private" → the form: "10,408.014036 ₳ available (includes 57.475311 ₳ of rewards)", Amount with Max, "Add tokens", the notice "Making money private links your public account to the new private UTxOs, but not to any Seedelf name." and a disabled Review with "Enter an amount." under it.
5. Hovered the ⓘ next to the title → tooltip "Move ADA, and any amount of your tokens, from your public account into your private balance."
6. Typed 20 in Amount → Review enabled.
7. Clicked Review → "Review making it private": "Nothing is sent until you press Make 20 ₳ private", "Into your private balance 20 ₳", "Network fee 0.178349 ₳", "Staking rewards moved into your balance" with "57.475311 ₳, already counted in it", "Total leaving your public account 20.178349 ₳", "Public account after 10,387.835687 ₳", "Private balance after 48 ₳".
8. Scrolled down the review → "To leave staking rewards out of payments, turn off “Use staking rewards when spending” in Settings."
9. Hovered the review's ⓘ → tooltip "The money lands in new spots only your Seedelf key can open. It takes about a minute for the network to confirm them."
10. Clicked "Transaction details" → a technical dialog: the transaction id, "Spends 1 UTxO", "Pays 2 outputs", a contract address with "#0 · a contract · Seedelf Wallet's contract · under a register" and 20 ₳, datum bytes, and a "Raw CBOR" tab.
11. Closed the dialog → back on the review.
12. Clicked "Make 20 ₳ private" → submitted at once, with no password prompt, and back on Home's Public tab: a banner with a spinner, "Payment into your private balance sent. Waiting for the network…", and a Cardanoscan link; "Public account" still 10,408.014036 ₳, "Updated 58 s ago"; Send and Make private greyed out, with "Wait for the last transaction to confirm" below them.
13. Clicked the "Private" tab → "Private balance 28 ₳", unchanged; Send, Make public and Create disabled; "Wait for the last transaction to confirm".
14. Hovered the disabled Send → tooltip "Wait for the last transaction to confirm".
15. Scrolled down on Private → found the Activity and UTxOs buttons.
16. Clicked Activity → "Private activity", with "Made private +20 ₳ Pending · 14:00" under Today.
17. Clicked the pending entry → a detail dialog: "Amount +20 ₳", "Network fee 0.178349 ₳", the time, the transaction id and "View on Cardanoscan"; it didn't repeat the word Pending.
18. Closed the dialog, clicked Back → the private Home.
19. Scrolled up, clicked the "Public" tab, scrolled down → found the public Activity button below the token list.
20. Clicked Activity → "Public activity"; the newest entry was an older "Sent −4.185521 ₳ and 1 token"; the pending 20.18 ₳ transaction wasn't listed.
21. Clicked Back, then ran `world confirm` → the network put the transaction in block 5214889.
22. Scrolled up on Public → still "Waiting for the network…" and 10,408.014036 ₳; nothing had updated yet.
23. Waited 5 s → the wallet refreshed by itself: a check-mark banner "Made private" with Dismiss, "Public account 10,387.835687 ₳" with the "Includes … staking rewards" line gone, and Send and Make private enabled again.
24. Clicked the "Private" tab → "Private balance 48 ₳", all buttons enabled.
25. Scrolled down and opened Activity → "Made private +20 ₳ 14:00", with no Pending label.
26. Ran stop.

**Wrong turns.**
- None.

**Hesitations.**
- Step 3: on the Private tab the tester first looked for something like "Deposit" or "Add"; Private's "Receive" could plausibly mean "bring money in", but the money was public, so they switched to the Public tab and found "Make private" there. It took a moment to realise that the action lives on the source side, not the destination side.
- Step 7: "Staking rewards moved into your balance" with "57.475311 ₳, already counted in it" made the tester pause: which balance, public or private, and were the 57 ₳ of rewards being moved somewhere or spent? Only "Total leaving your public account 20.178349 ₳" reassured them that nothing extra was leaving. Logged as an abandonment moment ("I don't understand what this means", severity 2 of 5): a cautious user might worry about their rewards and back out; the "Total leaving" row mitigates it.
- Step 10: the tester opened "Transaction details" to check where the money was going; the contract address, "under a register", the datum and the CBOR were too technical to verify anything, so they closed it and trusted the summary.
- Step 12: "Make 20 ₳ private" sent the transaction instantly, with no password prompt and no "are you sure"; for a money-moving action the tester half expected to be asked for the password the task had given them.

**Observations.**
- Entry point: the action is on the source (Public) side. The Private tab's buttons (Receive, Send, Make public, Create) give no hint about moving public money in, so the tester had to think to switch tabs; once there, the teal "Make private" was easy to find. They expected "Deposit" or "Move to private" and found "Make private", clear once found.
- The form's disabled Review showed its reason, "Enter an amount.", so the tester never wondered why it was disabled.
- The review: "Nothing is sent until you press Make 20 ₳ private" and the amount repeated in the confirm button were very reassuring. It shows the total leaving, the fee and both "after" balances (Public 10,387.835687 ₳, Private 48 ₳), exactly the numbers the tester saw after confirmation, which built trust.
- The rewards row is ambiguous: it doesn't say which balance, and reads as if rewards are being moved somewhere. The Settings hint below it is under the fold and partly hidden behind the big "Make 20 ₳ private" button until you scroll. The tester had expected rewards to stay rewards unless withdrawn; the transaction pulled them into the payment, explained only by that row and the hint.
- While pending, neither Home tab showed the in-flight amount: Public still read 10,408.014036 ₳ and Private 28 ₳; only the banner and private Activity ("Pending") said anything was happening. "Briefly the 20 ₳ seems to be counted nowhere and everywhere at once." The tester had expected a reduced public figure (or a pending −20.18) and perhaps +20 pending on the private side. Logged as an abandonment moment at step 12 ("I might lose money", severity 2 of 5): without the banner a user could think the transfer failed and try again, a retry that is blocked anyway because Make private is disabled while pending.
- Public Activity didn't list the pending transaction, though 20.178349 ₳ was leaving the public account: "A user checking the public history would think nothing happened." The pending entry's detail dialog in private Activity drops the word "Pending".
- While pending, Send, Make private, Make public and Create were disabled on both tabs, each with the visible hint (also the tooltip) "Wait for the last transaction to confirm", so the tester could tell why. The banner with its spinner was clear, and after confirmation it turned into a check mark with "Made private" and Dismiss.
- After `world confirm` the balances changed only on the wallet's own refresh, about 5 s later by the tester's count, with "Waiting for the network…" still showing meanwhile. The "Includes 57.475311 ₳ of staking rewards" line then disappeared silently; that fits the review but isn't explained on Home.
- No password was asked at any point, although the task said the wallet might ask; that "slightly reduced my sense of control".
- Terms: "Private balance" against "Public account", different nouns for the two sides; "UTxOs" and "Seedelf name" in the Make private notice, and "Koios" in the activity headers ("Kept encrypted on this device, never asked of Koios." and "Read from Koios, which already knows this account, 20 transactions at a time."), are unexplained.
- Screen-reader names carry what isn't shown: "Receive privately", "Send privately", "Receive publicly", "Send publicly". Visually both tabs say only "Receive" and "Send", so the side shows only in the toggle and in the "Private balance" or "Public account" label.
- The tester suspected fake clock data because the Today entry is stamped 14:00 while the older entries below it show 14:46 (see the verifier notes).

**Answers the task asked for.**

| Question | Tester's answer from the UI | Verifier's check |
|---|---|---|
| Is the operation pending? | Yes: the banner with a spinner ("Payment into your private balance sent. Waiting for the network…"), "Made private +20 ₳ Pending · 14:00" in private Activity, and the buttons disabled with "Wait for the last transaction to confirm". Sureness High. | Correct. The transaction was submitted and accepted, and stayed out of a block until `world confirm`; the wallet's checks every 15 s found it unconfirmed until then. |
| Where is the ADA currently? | In transit: the wallet still showed it as public (Public account 10,408.014036 ₳ and Private balance 28 ₳, both unchanged), sent but not yet confirmed; the review tooltip said it "lands in new spots only your Seedelf key can open". Sureness Medium. | Correct. On chain it was still in the public account: the 3 ₳ input unspent, the rewards not yet withdrawn, the 20 ₳ contract output not yet existing. The wallet had already set the input aside as spent, but Home kept its pre-send reading and never showed its "on its way" line, because it doesn't read balances again after a send. |
| What balance do you expect after confirmation? | Private 48 ₳ and Public 10,387.835687 ₳, from the review's "after" rows; after confirmation these were exactly what was displayed. Sureness High. | Correct. |
| Can you safely continue using the wallet? | Partly: browsing and Receive stayed available, but Send, Make private, Make public and Create were disabled with "Wait for the last transaction to confirm", so wait for confirmation before spending; nothing suggested anything was unsafe, and everything was enabled again after confirmation. Sureness High. | Correct. While Home watches a sent transaction it holds back new payments, Create and staking actions until confirmation, for at most 10 minutes; Receive, Activity, UTxOs and browsing stay available. The hold stops the in-flight input from being spent twice. |
| What changed after confirmation, and did it match? | About 5 s after `world confirm`: the check-mark banner "Made private" with Dismiss; Public 10,387.835687 ₳ with the rewards line gone; Private 48 ₳; the activity entry lost "Pending"; all buttons enabled again. It matched the review exactly. Sureness High. | Correct, except the timing: the update came at the wallet's next 15-second check, about 12.6 s after the block. The rewards line went because the withdrawal brought the rewards to 0. |

**Verifier notes.**
- Result kept: PASS WITH FRICTION. Every friction item is real product behaviour; none comes from the harness.
- Real, the verifier's most useful finding: after a send, Home never reads balances again, so its line "… of this is on its way: your last transaction isn't confirmed yet", which exists for exactly this case, never appeared; the wallet's background already counts the 20 ₳ deposit on the private side at once, but Home kept the old totals until confirmation. The verifier calls it a wiring gap against Home's own header comment. Pressing the Refresh icon would probably have shown Private 48 ₳ with "20 ₳ of this is on its way" (code reading; the tester didn't press Refresh).
- From code reading only, not exercised: a Refresh during the pending window may show Public as about 10,445.31 ₳, because Koios would still report the 57.475311 ₳ of rewards while the change counted as on its way already contains them (the double count T08 then hit). Once confirmed, public Activity would likely list this Make private as "Made private +37.296962 ₳" (3 ₳ in, 40.296962 ₳ back), because it ignores the withdrawal.
- Real: public Activity can't list a pending transaction. It reads only Koios, which lists a transaction once it is in a block, so real Koios behaves the same; only the private history records a Make private when it is sent.
- Real: in the rewards row, "your balance" means the public account, whose total on Home already includes the rewards. The transaction really withdrew all 57.475311 ₳, which funded most of the payment (the only input was 3 ₳, and 40.296962 ₳ of change went back to the public account), so "moved" is accurate and the net cost is 20.178349 ₳ either way. The wording leaves both of the tester's questions open.
- Real, by design: no password and no "are you sure". The transaction is built and signed with the unlocked keys when Review is pressed, and the review is the confirmation step; the only password-to-sign setting is for sites. The password in the task notes came from the harness, not from the wallet.
- Real: Make private exists only on the Public tab, and the private Receive screen offers only "Show my public address". A pointer to Make private appears only in the Getting started checklist, shown before the first deposit, which this funded wallet didn't get.
- Real: the Settings hint is cut off behind the sticky footer until you scroll; the pending entry's dialog has no status row; the rewards line on Home disappears after the withdrawal with nothing saying the rewards went into the balance; "UTxOs", "Seedelf name" and "Koios" go unexplained (Koios is explained only inside error messages).
- Real, timing: Home checks a pending transaction every 15 s and reads balances again only once it is confirmed. The lag was about 12.6 s, not 5 s: the tester's 5-second wait began about 9 s after the confirm. In real use nobody sees the block land, so the lag shows only because `world confirm` is instant.
- Misread: the 14:00 and 14:46 entries are on different days (Today and an earlier fixture date), so the newer one having an earlier time of day is normal; 14:00 is the real submission time in the machine's UTC−7 zone. Nothing in the UI is wrong.
- Harness: the view's accessible names told the tester which side each action belonged to, while a sighted user sees only "Receive" and "Send" plus the tab toggle, so confusion about sides may be understated.
- Money check: one transaction, accepted, then confirmed in block 5214889. It spent one public UTxO of 3 ₳ and withdrew all 57.475311 ₳ of rewards; output #0 paid exactly 20 ₳, no tokens, to Seedelf Wallet's contract (variant 1) under a register the wallet owns (both points checked: in the prime-order subgroup, not the identity); output #1 returned 40.296962 ₳ of change to the same account; the fee was 0.178349 ₳; nothing else. Public went from 10,408.014036 to 10,387.835687 ₳ (rewards to 0) and private from 28 to 48 ₳, exactly as the review said. Caveat: the fake backend doesn't run ledger validation, so its acceptance proves less than a real node's would.
- Prior knowledge: none seen; the tester declared only general Cardano knowledge (rewards, fees, blocks).

**Final result.** The tester moved 20 ₳ into the private balance through the Public tab's "Make private" without a wrong turn, and after confirmation both balances matched the review exactly (public 10,387.835687 ₳, private 48 ₳). While the transaction was pending, both Home balances kept their old values and public Activity didn't list it, so the pending state showed only in the banner, the disabled buttons and private Activity.

### T08 · Understand a pending payment

**Test notes.** Surface: a 360x640 window standing in for Chrome's side panel. Starting state: the funded wallet, unlocked, on Home's Private tab ("Private balance 28 ₳", one token); the Public tab holds "Public account 10,408.014036 ₳", "Includes 57.475311 ₳ of staking rewards" and 6 tokens. Data: send 25 ADA to an ordinary preprod address (random key hashes, nobody's wallet). The tester was told "You do not need to wait for anything in this test." and given an extra command, `world confirm`, which puts the submitted transaction into a block at once, to use only after answering all the questions about the pending payment. The network confirms only on that command, which the tester ran about 1 min 51 s after sending. A public payment isn't affected by the giveme.my refusal that stops private-balance payments in this environment. Explorer links open a "Page not available" placeholder here. The harness view prints each control's accessible name beside its visible label (button "Send publicly" (shows "Send")), so the tester saw names a sighted user doesn't. Main-run trace (it predates the harness fix for "Details" toggles; none was involved).

**Result.** PASS WITH FRICTION · confidence Medium · 2 wrong turns · 22 navigation steps · prior product knowledge needed: no for sending, but the tester says that understanding the pending figures and the activity amount took knowledge of UTxO change and reward withdrawals plus arithmetic by hand, which an ordinary user couldn't get from the UI.

**Path taken.**
1. Ran stop, then start → Home on the Private tab: "Private balance 28 ₳", Receive, Send, Make public, Create, and a Private|Public switch at the top.
2. Clicked the "Public" tab, because the task says "public payment" → "Public account 10,408.014036 ₳", "Includes 57.475311 ₳ of staking rewards", and Receive, Send and "Make private", with "Make private" highlighted teal as if it were the main action.
3. Scrolled down (400, then 300) to record the tokens as a baseline → 5 tokens listed, "View all 6 tokens", then "Activity" and "UTxOs".
4. Scrolled up and clicked Send (accessible name "Send publicly") → the form, titled "Send": "10,408.014036 ₳ available (includes 57.475311 ₳ of rewards)", To, Amount with Max, "Add tokens", "Add recipient", and a disabled Review with "Enter who it goes to."
5. Filled To with the address and Amount with 25 → "Sends to addr_test1qpka…cs65nlaz ·" with "Save to contacts"; Review enabled.
6. Clicked Review → "Review the payment": "Nothing is sent until you press Send", "Amount 25 ₳", "Network fee 0.174697 ₳", "Staking rewards moved into your balance" with "57.475311 ₳, already counted in it", "Total leaving your public account 25.174697 ₳", "Public account after 10,382.839339 ₳".
7. Scrolled down the review → "To leave staking rewards out of payments, turn off “Use staking rewards when spending” in Settings.", "It takes about a minute for the network to confirm." and a "Transaction details" button.
8. Opened "Transaction details" to look for change → "Spends 1 UTxO" (ad8d827f3731…fce0b7#0) and "Pays 2 outputs": #0 25 ₳ to the recipient, #1 35.300614 ₳ to addr_test1qq8ac7…kt5dmn, each described as "a key that stakes"; neither labelled as the user's or as change.
9. Scrolled inside the dialog → "Network fee 0.174697 ₳", "Valid until slot", "Size", "Signed 2 signatures, not sent yet", and "Withdraws rewards" stake_test1… 57.475311 ₳.
10. Scrolled back up and hovered "What this means" next to "Spends 1 UTxO" (after two remote-control retries) → tooltip "What each one holds isn't in the transaction, and the wallet asks nobody: looking them up would tell whoever was asked which transaction you are reading."
11. Closed the dialog and clicked Send → submitted with no password prompt, back on the public Home: a banner with a spinner, "Payment sent. Waiting for the network…", with "b0369603dc…b8a4b6 on Cardanoscan"; the balance still read 10,408.014036 ₳ ("Updated 1 min ago"); Send and Make private greyed out, with "Wait for the last transaction to confirm".
12. Hovered the greyed-out Send → tooltip "Wait for the last transaction to confirm".
13. Scrolled down to the tokens → the same 5 tokens and "View all 6 tokens".
14. Clicked Activity → the public activity list: no entry for the new payment (the newest was an older "Sent −4.185521 ₳ and 1 token"), and no "Payment sent" banner on this screen. (wrong turn)
15. Clicked Back, then UTxOs → "5 UTxOs": 10,338.538725 ₳ and 2 tokens; 3 ₳ and 4 tokens; 2 ₳; 2 ₳; 2 ₳. The spent ad8d827f UTxO was gone, the 35.300614 ₳ change wasn't there, and nothing was marked pending. (wrong turn)
16. Hovered "What this means" by the UTxOs title → a tooltip about locking UTxOs, nothing about pending ones.
17. Went Back, scrolled up and clicked Refresh → "Updating…" for more than 3 s, then "Public account 10,440.31465 ₳", "35.300614 ₳ of this is on its way: your last transaction isn't confirmed yet" and "Includes 57.475311 ₳ of staking rewards": the balance had gone up by 32.3 ₳ after a 25 ₳ payment, against the review's "Public account after 10,382.839339 ₳".
18. Scrolled down and opened UTxOs again → the same 5 UTxOs; the change still not listed.
19. Back, then Activity again → the same list, still no pending entry.
20. Back, scrolled up, clicked the "on Cardanoscan" link → a new window, "Page not available" (the test's placeholder).
21. Closed the placeholder and clicked the "Private" tab → "Private balance 28 ₳", unchanged; Send, Make public and Create greyed out; the same "Payment sent. Waiting for the network…" banner.
22. Clicked the "Public" tab, then ran `world confirm` → the network put the transaction in block 5214889; the view didn't change right away (still the pending banner and 10,440.31465 ₳).
23. Waited 15 s, clicked Refresh, waited 15 s → "Payment confirmed" with Dismiss, "Public account 10,382.839339 ₳" (matching the review), the rewards line gone, Send and Make private enabled again; the wallet had apparently updated on its own before the Refresh.
24. Scrolled down and opened Activity → a new Today entry, "Sent +32.300614 ₳", at 14:02 to the recipient's address: a positive amount on a sent 25 ₳ payment.
25. Clicked that entry → the "Sent" dialog: "Amount +32.300614 ₳", "Network fee 0.174697 ₳", To the recipient, "Staking rewards collected 57.475311 ₳", and the time.
26. Closed the dialog and ran stop.

**Wrong turns.**
- Step 14: opened Activity while the payment was pending, expecting a "Pending" or "Sending" row for −25.174697 ₳ at the top; got no row at all for the new payment and no "Payment sent" banner on that screen, so nothing there said a payment was in flight; corrected by going back to Home, where the banner was still showing.
- Step 15: opened UTxOs to look for the returning change, expecting the 35.300614 ₳ change listed as pending and the spent 3 ₳ UTxO marked as being spent; got a list from which the spent UTxO had silently disappeared, without the change, adding up to 3 ₳ less than the headline balance with nothing on screen explaining why; corrected by going back to Home.

**Hesitations.**
- Step 2: on the Public tab "Make private" is the highlighted teal button and Send a plain grey circle; for a moment the tester wondered whether Send was the wrong action for a public payment.
- Step 4: the form's title is just "Send", not "Send publicly"; only the "10,408.014036 ₳ available" line, the public figure, said which side the payment came from, and "Send publicly" is announced only to screen readers.
- Step 6: "Staking rewards moved into your balance" with "57.475311 ₳, already counted in it" made the tester stop: was extra money being moved, and would it change what leaves? They checked the arithmetic (10,408.014036 − 25.174697 = 10,382.839339) to reassure themselves.
- Step 8: output #1 (35.300614 ₳ to addr_test1qq8ac7…) isn't labelled as the user's or as change; the tester had to assume it was their change, and the "What this means" tooltip didn't help.
- Step 11: no password was asked on Send, a little surprising for a 25 ₳ payment, but the review had said "Nothing is sent until you press Send", so the tester wasn't misled.
- Step 17: after Refresh, "Updating…" stayed for more than 3 seconds, then the balance came back higher than before the send. Logged as an abandonment moment ("This seems broken", severity 3 of 5): a normal user would think the wallet's numbers can't be trusted, and might fear the payment had failed, that the money was being counted somewhere odd, or that they'd be charged twice. The tester wouldn't have quit, but would have stopped trusting the balance until confirmation.

**Observations.**
- The pending balance contradicts the review. The review said "Public account after 10,382.839339 ₳"; right after sending, Home kept the old 10,408.014036 ₳ ("Updated 1 min ago"), with no sign that anything had left until Refresh; then it showed 10,440.31465 ₳, 32.3 ₳ more than before the payment and 57.475311 ₳ more than promised, still saying "Includes 57.475311 ₳ of staking rewards" although the signed transaction "Withdraws rewards" 57.475311 ₳. The tester worked out that the rewards were counted twice, once as rewards and once inside the 35.300614 ₳ change: UTxOs 10,347.538725 + change 35.300614 + rewards 57.475311 = 10,440.31465 exactly. Trust "dropped sharply" here, and came back in part when the confirmed balance matched the review.
- "35.300614 ₳ of this is on its way: your last transaction isn't confirmed yet" doesn't say which way: it could mean leaving or coming back. The tester recognised 35.300614 as output #1, the change, only because they had opened Transaction details, and the 25 ₳ actually leaving isn't mentioned anywhere on the pending Home screen. The word "change" is never used; the tester expected something like "Change back to you: 35.300614 ₳".
- Activity showed no pending entry while the payment waited, and the "Payment sent. Waiting for the network…" banner is only on Home, not on Activity or UTxOs. Logged as an abandonment moment at step 14 ("This seems broken", severity 2 of 5): for a moment the tester feared the payment had vanished.
- The UTxOs list silently dropped the spent UTxO, didn't show the incoming change, and marked nothing as pending.
- After confirmation, Activity labels the payment "Sent +32.300614 ₳", a positive number under "Sent", and its detail says "Amount +32.300614 ₳"; the 25 ₳ actually sent appears nowhere in the entry. The tester worked out that +32.300614 is the 35.300614 change minus the 3 ₳ spent UTxO, a net figure that leaves out the 57.475311 ₳ withdrawal. Logged as an abandonment moment at step 24 ("I don't understand what this means", severity 3 of 5): a positive amount under "Sent" makes no sense to a normal user and could suggest money moved the wrong way or the wrong amount went out. It "undermines trust in the transaction history".
- Transaction details don't say which output is the recipient and which is the change: they show raw addresses and "a key that stakes", describing outputs by key type, not by whose they are.
- While pending, every outgoing action was disabled on both sides (Send and Make private on Public; Send, Make public and Create on Private), with the tooltip "Wait for the last transaction to confirm", which helped; Receive stayed available. The tester had thought sending might be allowed or queued.
- Worked well, per the tester: getting to the payment was obvious (Public tab, Send, To and Amount, Review, Send); the review showed amount, fee, total leaving and balance after, and the numbers added up; the banner with spinner and transaction id, then "Payment confirmed" with Dismiss; tokens visibly untouched throughout (6 public before, during and after; the private side stayed at 28 ₳ plus 1 token); the wallet noticed the confirmation by itself within about 15 s; "Signed 2 signatures, not sent yet" in Transaction details told the tester that signing happens before the Send press.
- The Cardanoscan link opened a placeholder, so the tester couldn't cross-check outside the wallet (expected in this harness).
- Confidence Medium: sending was easy and the review clear, but the pending balance went up, Activity had no pending entry, and the confirmed entry read "Sent +32.300614 ₳"; the tester could tell what had happened only by working out the arithmetic, which the screens never explained.

**Answers the task asked for.**

| Question | Tester's answer from the UI | Verifier's check |
|---|---|---|
| How much ADA do I currently have (while pending)? | Right after sending, "Public account 10,408.014036 ₳" (unchanged, "Updated 1 min ago"); after Refresh, "Public account 10,440.31465 ₳" with "35.300614 ₳ of this is on its way: your last transaction isn't confirmed yet" and "Includes 57.475311 ₳ of staking rewards". Neither matches the review's 10,382.839339 ₳. Private was still 28 ₳. Sureness Low. | Partly, and the failure is the UI's, not the tester's. With the pending payment counted, Public was 10,382.839339 ₳ (10,347.538725 ₳ the payment doesn't spend, plus the 35.300614 ₳ change, which contains the withdrawn rewards); strictly on chain before the block it was 10,408.014036 ₳. 10,440.31465 ₳ was no real state: Home added the change on top of the unchanged reported rewards. Private: 28 ₳ plus 1 token, unchanged. |
| How much is leaving? | Only from the review: "Total leaving your public account 25.174697 ₳" (25 ₳ plus the 0.174697 ₳ fee); the pending Home screen doesn't say. Sureness High. | Correct: 25 ₳ to the recipient plus a 0.174697 ₳ fee. The pending Home screen indeed shows no leaving amount, and the banner carries none. |
| Is any change returning? | Apparently yes, 35.300614 ₳: Home's "on its way" line and output #1 in Transaction details; neither calls it change, and the UTxOs list didn't show it. Sureness Medium. | Correct. Output #1 pays 35.300614 ₳ to the wallet's own address and includes the withdrawn 57.475311 ₳ of rewards; the UTxOs list never shows pending outputs. |
| Did my tokens disappear? | No: all 6 public tokens stayed listed while pending and after, and the private token was unchanged. Sureness High. | Correct: the transaction moved no tokens. |
| Is the payment confirmed? | Not while pending ("Payment sent. Waiting for the network…" with a spinner); after `world confirm` the banner became "Payment confirmed". Sureness High. | Correct: unconfirmed until block 5214889; the wallet's 15-second watch then showed "Payment confirmed". |
| Can I send another transaction? | No, not while pending: Send and Make private greyed out on Public; Send, Make public and Create on Private; the tooltip "Wait for the last transaction to confirm"; only Receive available. Send was enabled again after confirmation. Sureness High. | Correct. Home holds every new payment while the sent one is unconfirmed, for up to 10 minutes; Receive stays available. |
| Any point where I feared funds had disappeared? | Yes, three: no Activity entry and no banner while pending; the balance rising to 10,440.31465 ₳ after Refresh; "Sent +32.300614 ₳" instead of about −25.17 ₳ after confirmation. Sureness High. | No funds were lost. All three fear points are real product behaviour, not the harness. |
| After confirmation: what changed, and did it match? | "Payment confirmed"; the balance became 10,382.839339 ₳, matching the review, and the rewards line disappeared; Send enabled again; Activity gained "Sent +32.300614 ₳" (detail: "Amount +32.300614 ₳", fee 0.174697 ₳, "Staking rewards collected 57.475311 ₳"), where the tester expected about −25.17 ₳. Sureness High. | Correct. Confirmed in block 5214889; the balance as reviewed, rewards at 0 after the withdrawal. The Activity amount is the 35.300614 ₳ change minus the 3 ₳ input and ignores the withdrawal; the true net change was −25.174697 ₳. |

**Verifier notes.**
- Result kept: PASS WITH FRICTION. The trace matches the commands and screenshots, with no misreads; every friction point is real product behaviour except the Cardanoscan placeholder.
- Real, a money-display defect (severity 3): while a payment is pending, Home adds the pending change, which already contains the withdrawn rewards, on top of the account's reported rewards, which stay unchanged until the block (on real Koios too), and nothing lowers the rewards for a pending withdrawal. 10,440.31465 ₳ was never a real state; the right pending figure was 10,382.839339 ₳. On a real network the window is shorter, since blocks come about every 20 s, but a Refresh before the block shows the wrong figure, and so does Home opened more than 60 s after its last reading.
- Real: right after Send the balance stays at the pre-send reading, because Home reads nothing after a send, and a reading made before the send leaves the change out.
- Real, not the fake backend as the tester suspected: the roughly 10 s of "Updating…" after Refresh is the wallet's own wait. While Koios still lists a UTxO the wallet has spent, it reads the account up to 3 more times, 3 s apart; real Koios also lists an unconfirmed transaction's input as unspent, so any Refresh during a pending payment takes about 10 s on a real network.
- Real: public Activity has no pending row because it reads only Koios's list of the account's transactions, which includes a transaction only once it is in a block; "Pending" is added only to an entry that is already listed. The pending banner appears only on Home (and the dApps screen).
- Real: the UTxOs list is the last reading minus what the wallet has spent, with no incoming or pending rows; the 3 ₳ gap the tester found is the spent UTxO ad8d827f…#0.
- Real: the Activity amount nets the account's outputs against its inputs (35.300614 − 3) and ignores the withdrawal. The entry counts as "Sent" because the transaction spends an account input and pays someone else, while the net direction gives the "+" sign and the incoming icon (the screenshot shows the ↙ icon and a teal amount); the detail rows have no per-recipient amount. Real Koios gives the same rows, and the builder notes record the same wallet behaviour.
- Real: Transaction details describe an address only by its type ("a key that stakes"), with no "yours" or "change" marker; the review leaves out a change row on purpose, and the tooltip is about why the inputs' contents aren't looked up.
- Real: "Includes 57.475311 ₳ of staking rewards" stays during the pending window because the reported rewards aren't adjusted for a pending withdrawal.
- Real, by design: the teal "Make private" on the Public tab is a deliberate nudge toward privacy; outgoing actions are held for up to 10 minutes while a payment is pending; the wallet's own sends ask for no password while it is unlocked. The wallet noticed the block at its 15-second watch.
- Harness: the Cardanoscan link opened a placeholder; a real user would get Cardanoscan's preprod page for the transaction in a new tab (whether it would already show a transaction still waiting for a block can't be verified).
- Harness: `world confirm` came about 1 min 51 s after the send, longer than preprod's usual 20 to 60 s, which lengthened the window in which the double-counted balance could be seen; it didn't cause the defect, since real Koios returns the same rows before the block.
- Harness: the view printed "Send publicly" (shows "Send"), which is how the tester spotted the screen-reader-only "publicly"; it didn't change the path.
- Money check: one transaction, accepted, then confirmed in block 5214889. It spent one public UTxO holding 3 ₳ and no tokens, withdrew all 57.475311 ₳ of rewards, paid 25 ₳ to the given address (output #0) and returned 35.300614 ₳ of change to the wallet's own address (output #1), with a 0.174697 ₳ fee; no tokens, mint, certificates, votes or metadata. The public account went from 10,408.014036 to 10,382.839339 ₳, −25.174697 ₳, exactly the review's "Total leaving"; the private balance was never touched. Nothing was lost or paid twice.
- Prior knowledge: no product-internal knowledge seen; the tester's general Cardano knowledge shaped their reading of the numbers, not their path.

**Final result.** The tester sent 25 ₳ publicly without trouble, and the confirmed balance matched the review exactly. While the payment was pending, Home first showed the old balance and then, after a refresh, a higher one (10,440.31465 ₳) that counted the staking rewards twice; Activity had no pending entry; and the confirmed payment appeared as "Sent +32.300614 ₳", so the tester could explain the numbers only with arithmetic of their own.

### T09 · Recover from a failed private transaction build

**Test notes.** Surface: a 360x640 window standing in for Chrome's side panel. Starting state: the funded wallet, unlocked, on Home's Private tab ("Private balance 28 ₳"). Data: something to attempt, a payment of 5 ADA from the private funds to another Seedelf Wallet user (the Seedelf tagged "This is a test."). The task said not to reload the extension unless the UI gave no reasonable alternative. The tester was told that the outside service the wallet relies on for this kind of transaction is set to refuse the attempt and may keep refusing on retry; that the point is whether the wallet helps them understand what happened and get back to a state where they could review or try again, not whether a retry goes through; and that closing and reopening the wallet, or pressing F5, counts as a reload. The first refusal came from a harness route answering with giveme.my's recorded refusal (HTTP 400, "Transaction Fails Validation"); any later attempt would be refused by the fake giveme.my, which refuses everything, so a successful retry is impossible here. The harness view prints each control's accessible name beside its visible label (button "Send privately" (shows "Send")). Main-run trace: it predates the harness fix for "Details" toggles, which caused the wrong turn at step 8. The tester reported seeing Seedelf-related skill and context lists in their own agent environment, which they say they deliberately ignored.

**Result.** PASS WITH FRICTION · confidence High · 1 wrong turn · 7 navigation steps · prior product knowledge needed: no, "Nothing was sent" and the "Refresh and review again" button were enough to recover, though fully understanding the error would take knowing what "collateral", "UTxOs" and giveme.my are.

**Path taken.**
1. Ran stop, then start → Home on the Private tab: "Private balance 28 ₳", and under it round buttons Receive, Send, Make public and Create.
2. Clicked Send (accessible name "Send privately") → the Send form: "28 ₳ in your private balance", a "Seedelf name" field, Amount, and a disabled Review.
3. Filled "Seedelf name" with the recipient's name → "Found: This is a test. · 5eed0e1f5468…8e0d63 ·" and a "Save to contacts" link.
4. Filled Amount with 5 → Review enabled, and a note appeared: "Sending right after making money private is easy to match by timing: the two sit close together on chain."
5. Scrolled down 300 px and took a screenshot → Review visible at the bottom.
6. Clicked Review → "Review the payment": "Nothing is sent until you press Send", To "This is a test.", "Amount 5 ₳", "Network fee 0.233912 ₳", "Total leaving your private balance 5.233912 ₳", "Private balance after 22.766088 ₳", and "Send asks giveme.my to lend the collateral, then submits."
7. Clicked Send → a red box, "Nothing was sent. Something it spends may have been spent or changed since you reviewed it: make a new review to send it.", and below it a small collapsed "▸ Details" toggle and a big "Refresh and review again" button where Send had been.
8. Tried to open the "Details" toggle under the error: the exact-name click matched nothing, and after a scroll the looser click hit "Transaction details" instead → the "The transaction" dialog with the raw transaction (UTxOs, outputs, datum), not what the tester wanted. (wrong turn)
9. Closed the dialog with its X → back on the review, the error still there.
10. Clicked the small "▸ Details" toggle under the red box (by its screen position) → "giveme.my, which lends the collateral, refused this transaction: Transaction Fails Validation. Its UTxOs may have been spent since the review: refresh, then review it again."
11. Clicked "Refresh and review again" → the review reloaded with the same figures, the status "Review updated just now. Check it again." above a fresh Send button, and the error gone; the tester counted the goal reached here.
12. Scrolled up and clicked Back, to check that nothing had moved and the inputs were kept → the Send form with the recipient and Amount 5 still filled in, and "28 ₳ in your private balance".
13. Took a screenshot and ran stop.

**Wrong turns.**
- Step 8: aimed at the small "Details" toggle under the red error, expecting an explanation of why it failed; the click hit "Transaction details" and opened a raw transaction inspector (UTxO a1a1…#0, a contract address, datum nodes), which means nothing to a normal user trying to understand a failure; corrected by closing it with X and clicking the "▸ Details" text directly under the red box. The tester put it partly down to the remote control's substring match, but noted that both controls really are labelled "details" and sit close together: the teal "Transaction details" pill above the error, "▸ Details" below it.

**Hesitations.**
- Step 6: on "Send asks giveme.my to lend the collateral, then submits.", the tester didn't know what giveme.my was or what "collateral" means here, and wondered whether they were lending money or pledging some; it didn't stop them, because "Total leaving your private balance 5.233912 ₳" was clear.
- Step 7: the headline says "Something it spends may have been spent or changed since you reviewed it", but the tester had pressed Send seconds after reviewing and done nothing else, so the stated cause made no sense; they briefly wondered whether some other transaction had spent their money. Logged as an abandonment moment ("I don't understand what this means", severity 2 of 5): a normal user might worry that someone else had touched their funds; "Nothing was sent" and the obvious "Refresh and review again" kept the tester going, and they wouldn't have quit here.
- Step 10: the expanded Details named a different cause, giveme.my "refused this transaction: Transaction Fails Validation", and then repeated the stale-UTxO guess, so the tester couldn't tell whether the problem was their funds or the outside service; "Transaction Fails Validation" reads like raw server text.
- Step 11: after the refresh every figure was identical (same fee, same total), so the tester wasn't sure anything had actually changed, or whether pressing Send again would just fail the same way; nothing says what to do if it keeps refusing. Logged as an abandonment moment ("I don't know what to do", severity 2 of 5): if the refreshed Send failed again, the UI offers nothing beyond refreshing again, the real cause is hidden in Details, and there is no advice like "try again later"; a normal user might give up after a second identical failure.

**Observations.**
- No money moved, and the error said so: "Nothing was sent." is the first phrase of the alert, and after going Back the form still showed "28 ₳ in your private balance". "Nothing is sent until you press Send" on the review and "Nothing was sent." in the error made the tester confident.
- Recovery: "Refresh and review again" is large, teal and in Send's place, so it is the obvious next action; it returned a valid review with Send enabled without re-entering anything. Back also kept the recipient and amount, so editing was possible too.
- The cause: the red headline names a likely-wrong cause, and the real event, the collateral service giveme.my refusing the transaction, appears only under a small, low-contrast, collapsed "▸ Details". The headline blames the tester's inputs; Details says the collateral lender refused and only then guesses the inputs may have been spent. The mismatch made the tester trust the explanation less; they had expected something like "The service that submits private payments refused it; try again in a few minutes".
- Two "details" controls sit close together, the teal "Transaction details" pill above the error and the grey "▸ Details" toggle below it, and the tester landed in the raw transaction inspector first.
- Jargon: the expanded detail includes the service's raw text, "Transaction Fails Validation", and the terms "UTxOs" (where the tester expected "coins" or "funds") and "lends the collateral", neither explained; "collateral" could make a lay user think their own money is being pledged. In the end the tester gathered that giveme.my provides something on their behalf.
- Layout: with Details expanded, the red error box overlaps the paragraph above it, and that paragraph's last line ("…about a minute for the network to confirm.") is partly hidden behind the box.
- After "Refresh and review again" the review is identical apart from a small grey "Review updated just now. Check it again.", with no hint about what to do if the service keeps refusing (wait, try later, contact anyone).
- The review itself was clear and well laid out: the recipient's tag, the full Seedelf name, amount, fee, total leaving, balance after and "Nothing is sent until you press Send"; the recipient check worked at once ("Found: This is a test.").
- The tester didn't press Send again after the refresh: the goal was a valid review or retry state, and the task note said the service might keep refusing.

**Answers the task asked for.**

| Question | Tester's answer from the UI | Verifier's check |
|---|---|---|
| Does the error tell you what happened? | Partly. The headline, "Nothing was sent. Something it spends may have been spent or changed since you reviewed it: make a new review to send it.", says clearly that no money moved but suggests stale inputs as the cause; the actual event is only in the collapsed Details: "giveme.my, which lends the collateral, refused this transaction: Transaction Fails Validation. Its UTxOs may have been spent since the review: refresh, then review it again." Sureness High. | Correct. giveme.my's stand-in refused the collateral request (HTTP 400, "Transaction Fails Validation") before the wallet signed anything; nothing was sent, and nothing the payment spends had changed. The headline gets "Nothing was sent" right and guesses a spent or changed input, which was false here; only Details names the refusal. |
| Does the error tell you what to do next? | Yes: "make a new review to send it", the big "Refresh and review again" button, and Details' "refresh, then review it again"; no guidance if the refusal keeps happening. Sureness High. | Correct. The only ways on are "Refresh and review again", which rebuilds the review from a fresh read of the chain, and Back. The same footer shows on every refusal, with no advice for repeated ones; in this environment a retry would be refused again. |
| Did money move? | No: "Nothing was sent.", and after going Back the form still showed "28 ₳ in your private balance". Sureness High. | Correct: the refusal comes before signing, and nothing was submitted. The 28 ₳ on the form is Home's earlier reading passed in, not a fresh read, but correct here. |
| Could you get back to a valid review or retry state without reloading? | Yes: "Refresh and review again" showed the review again with Send enabled and "Review updated just now. Check it again."; Back also returned to the filled-in Send form. Sureness High. | Correct: a rebuilt review with Send enabled, and the form with its inputs kept, with no reload. In this harness, Send on the refreshed review would be refused again. |

**Verifier notes.**
- Result kept: PASS WITH FRICTION. The product really reached the goal; the one wrong turn came from the harness, and the rest of the friction is product behaviour.
- Harness: the step-8 wrong turn. The toggle is an HTML summary element: the view lists it as button "Details", but the exact-name click answered "Nothing visible matches" while listing "Details" among the visible buttons, and the looser click's substring match took the first button containing "details", "Transaction details". The tester didn't mis-aim. The two labels do sit about 120 px apart on opposite sides of the error, but this trace gives no evidence that a mouse user would confuse them; a real user clicks the "▸ Details" text and gets the refusal at once.
- Real: the wallet shows the stale-input headline for every giveme.my refusal, whatever the reason, because any non-OK answer is treated as stale, so a 5xx outage or a 429 would read the same. In this run the stated cause was false by construction (the harness injected the refusal and nothing had changed), but a real user would meet the same mismatch whenever giveme.my refuses for a reason other than a spent input.
- Real: nothing advises what to do when refusals repeat. The wallet keeps no count and shows the same footer each time, and there is no giveme.my "try again later" message, although other services have one. Not exercised, since the tester didn't press Send again.
- Real and deliberate: giveme.my's own words wait under Details. "Small, grey, collapsed" is accurate, but "low-contrast" overstates it: the muted 12.5 px text is about 7.3:1 against the background, above WCAG AAA, though it looks muted next to the red box and the teal button.
- Real: "Transaction Fails Validation" is giveme.my's own detail string, inserted as it comes; here it came from the harness route, but it is giveme.my's recorded refusal, so a real one reads the same. "UTxOs" has no plain-language definition anywhere in the wallet's text.
- Exists-not-found: collateral and giveme.my are explained only in Settings → Collateral, by the title's ⓘ ("Collateral is 5 ₳ of your public account set aside for transactions that run a smart contract, …") and a callout ("Payments from your private balance never put it up: giveme.my lends its own, so nothing on chain ties them to your account. …"), and again in Settings' privacy text. That answers the tester's exact question (they aren't pledging their own money), but neither the review nor the error explains collateral or points there.
- Real: the sticky footer grows when Details opens and covers the text above it until you scroll the remaining ~80 px. It is worse right after Send at the top of the page, where the whole review note, the only mention of giveme.my, sits behind the footer; the tester didn't remark on that case.
- Real but expected here: the figures after the refresh were identical because the fake chain never changed, though the refresh did read the chain afresh. In this harness a Send from the refreshed review would be refused again, so the tester's doubt was right for this environment; the missing guidance is real.
- The headline and Details don't strictly contradict each other, since both guess spent inputs; only Details names giveme.my's refusal and its words, which is what the tester describes.
- Money check: nothing moved and nothing was signed or submitted. The draft would have spent one private UTxO (25 ₳ by the arithmetic), paid 5 ₳ to "This is a test." and returned 19.766088 ₳ of change to the wallet's contract under a register, with a 0.233912 ₳ fee. On Send the wallet asked giveme.my for its collateral witness before signing, the harness route refused, and nothing was posted; the refreshed draft was never sent. The private balance stays 28 ₳ and the public account was never touched.
- Prior knowledge: no hidden knowledge shows in the navigation. Caveats: the briefing gave away the true cause (an outside service refusing), which shaped the tester's judgement that the headline's cause is "likely wrong" and their expectation of a "service refused" message; the tester used general Cardano knowledge (UTxOs, Plutus collateral) to read Details, not to choose controls; and the Seedelf-related lists in their environment are a possible blindness leak, though nothing in the trace shows them used.

**Final result.** After the forced refusal the wallet said "Nothing was sent", and its one prominent button, "Refresh and review again", brought the tester back to a valid review with Send enabled, without a reload; Back kept the form. The friction is in the explanation: the headline guesses stale inputs, while the actual giveme.my refusal sits under a small collapsed "Details", in raw text, with no advice should it keep happening.

### T10 · Swap ADA for MIN

**Test notes.** Surface: a 360x640 window standing in for Chrome's side panel (a window of its own, not docked). Starting state: the funded wallet, unlocked, on Home's Private tab (28 ₳ private; 10,408.014036 ₳ public, including 57.475311 ₳ of staking rewards); the task text gave the wallet password. The tester saw the scenario, goal and questions, not the task title, and one note: "Stop when you are ready to authorize the swap; do not authorize it." The task text carried no warning about the outside service that refuses every request (BUILDER-NOTES lists T10 among the tasks with such a note, but that sentence sits only in the harness's own config, which the harness never shows to testers). Pressing "Start swap" would have ended at "Nothing was sent…", because spends from the private balance can't complete in this environment (BUILDER-NOTES limitation 1); the tester stopped before it, so this was never reached. The quote is the harness's model of one recorded Minswap quote (10 ₳ → 906.5941 MIN, a 2 ₳ DEX fee, a 2 ₳ deposit, minimum = amount out / (1 + slippage)), and Lovejoin's pool count comes from the fake Koios. Main-run trace (it predates the harness fix for "Details" toggles; none was involved).

**Result.** PASS WITH FRICTION · confidence Medium · 2 wrong turns · 11 navigation steps · prior product knowledge needed: no, the dApps card itself says "Swap tokens"; reading the costs took general DeFi knowledge (order deposit, batcher, collateral, slippage) and the tester's own arithmetic.

**Path taken.**
1. Ran stop, then start → Home's Private tab: "Private balance" "28 ₳", Receive / Send / Make public / Create, a Tokens card, and a "dApps" row cut off at the bottom edge; nothing mentioned swapping.
2. Scrolled down the Private home looking for a Swap action → only 186 px more: dApps, Activity, UTxOs and the version footer.
3. Scrolled up and clicked "Public", guessing a swap would sit with the large public balance → "Public account" "10,408.014036 ₳", Receive / Send / Make private, "Staking and governance" and Tokens (wrong turn).
4. Scrolled down twice through the whole Public view → reached "View all 6 tokens", Activity and UTxOs; no swap and no dApps row (wrong turn).
5. Scrolled up and clicked "Private" again → back on the Private home.
6. Clicked "dApps" → "Used privately, from one-time accounts", a long privacy notice about one-time accounts, and two cards: "Minswap" ("Swap tokens, routed across Cardano's DEXes") and "Lovejoin" ("Mix ADA in 10 ₳ boxes…").
7. Clicked the Minswap card → "Swaps, each from a one-time account", "No swaps yet.", a privacy notice and a big "New swap" button.
8. Clicked "New swap" → the swap form (the tester counts this as reaching it): a "Slippage: 1%" chip; "You pay" 0.0 ADA with "28" by a wallet icon and Half/Max; "You receive" 0.0 with "+ Select token"; a disabled "Select a token" button.
9. Filled "You pay" with 10 → the bottom button still read "Select a token" (disabled).
10. Clicked "+ Select token" → a "You receive" picker with sections "In your private balance" (ADA 28), "On the wallet's list" (tUSDM; MIN "Minswap (preprod)") and "On Minswap".
11. Clicked "MIN" → the picker closed and a quote appeared: 906.5941 MIN, "1 ADA ≈ 90.6594 MIN", a refresh icon, a chevron and an enabled "Review swap".
12. Clicked the chevron (the quote's details) → the details expanded.
13. Scrolled down → "Asks for at least 897.61792 MIN", "Price impact 0.34%", "Slippage 1%", "Route Minswap", "DEX fee 2 ₳", "Order deposit 2 ₳, back with the proceeds".
14. Clicked "Review swap" → the review opened about 300 px down, keeping the form's scroll: first the "Asks for at least…" line, a yellow warning and the "First, a one-time account is funded" table, with the title out of view (wrong turn).
15. Scrolled up 300 px → "Review the swap", "Nothing is sent until you press Start swap", "You pay 10 ₳", "You receive ≈ 906.5941 MIN", "Asks for at least 897.61792 MIN · 1% slippage · 0.34% price impact · through Minswap", and "Seedelf Wallet relies on Minswap for the minimum of 897.61792 MIN: it asks Minswap for it, but can't read it back from the order Minswap builds."
16. Scrolled down 450 px → the funding table: "To Private session 1", "For the swap 16 ₳", "The swap 10 ₳", "DEX fee 2 ₳", "Order deposit 2 ₳, back with the proceeds", "Room for network fees 2 ₳, what's left comes back", "Kept aside for contracts 5 ₳, comes back", "Network fee 0.233208 ₳", "Change, back to your private balance 3.766792 ₳".
17. Scrolled down 450 px → "Then it runs by itself": 1 "Funded", 2 "Order placed", 3 "Filled", 4 "Back in your private balance", then "Start swap approves the whole run…".
18. Scrolled down 400 px, then 400 more, to the end → "Three transactions, three network fees: the cost of keeping your public account out.", the "Bring it back through Lovejoin" switch already on, a pool warning (0 boxes), "Lovejoin hasn't had a third-party audit…", "As it's sent, giveme.my is asked to lend the collateral." and a "Transaction details" button.
19. Clicked "Transaction details" to work out the real total → dialog "The transaction": "Spends 1 UTxO", "Pays 3 outputs": #0 16 ₳ to the one-time account, #1 3.766792 ₳ change to "Seedelf Wallet's contract".
20. Scrolled inside the dialog → "#2 · a key that stakes 5 ₳" (the same one-time address), "Collateral: 1 UTxO", "Comes back 4.650188 ₳", "Network fee 0.233208 ₳", "Signed Not yet".
21. Closed the dialog → back at the bottom of the review with "Start swap" pinned at the bottom; stopped there as instructed, without pressing it.
22. Ran stop → the browser closed.

**Wrong turns.**
- Steps 3–4: clicked "Public" and scrolled the whole Public view, expecting a trading feature to live with the large public balance (10,408.014036 ₳) or next to Send/Receive; got Receive, Send, Make private, Staking and governance and a token list, with no swap and no dApps entry; corrected by going back to Private and trying the only remaining lead, the "dApps" row.
- Step 14: clicked "Review swap" and started reading at the top of the window, expecting the review to open at its top with a title and a summary; it opened about 300 px down, with the "Asks for at least…" line and a yellow warning first and no "Review the swap" heading or You pay / You receive summary in view; corrected by scrolling up.

**Hesitations.**
- Step 1: Home has Receive, Send, Make public and Create but no Swap; the tester didn't know whether swapping existed at all, or was hidden under "Create" or "dApps".
- Step 6: hesitated before "dApps": to the tester, dApps means external websites that connect to the wallet, not a built-in feature; on the Private tab the row is also half cut off at the bottom of the first screen.
- Step 6: the dApps and Minswap pages both lead with long privacy paragraphs ("Anyone can follow the money through that account, and money you made private yourself leads on to your public account"); the tester had to read them to decide whether using Minswap would expose them.
- Step 9: "You pay" shows "28" with a small wallet icon; the tester took it as 28 ₳ available; nothing says only the private balance can be used, not the 10,408.014036 ₳ public balance, which the tester worked out from context.
- Step 14: the minimum warning ("…can't read it back from the order Minswap builds") made the tester unsure whether the minimum is actually guaranteed.
- Step 16: "For the swap 16 ₳" is bold, as if it were the total, but "Kept aside for contracts 5 ₳" is listed below it and isn't part of it (10 + 2 + 2 + 2 = 16); the tester had to do the sums to see that.
- Step 18: the "Bring it back through Lovejoin" switch was already on, beside warnings that Lovejoin is unaudited and its pool has no room; the tester wasn't sure whether to leave it on.
- Step 20: the dialog's "Collateral: 1 UTxO … Comes back 4.650188 ₳" didn't match the review's 5 ₳ kept aside, and the tester couldn't tell whose 4.650188 ₳ it was; the review only says giveme.my lends the collateral.

**Observations.**
- Finding the swap: no Swap next to Send/Receive on either tab; the only way in is the "dApps" row at the bottom of the Private tab, cut off on the first screen, and the Public tab has no dApps row. "dApps" made the tester think of external websites; the Minswap card's "Swap tokens, routed across Cardano's DEXes" is what confirmed it. The form sits three screens deep (dApps, the Minswap card, the Minswap history page with "New swap"). Terminology expected: "Swap" or "Exchange" on Home; found: dApps, then Minswap.
- Which balance pays: the tester expected any ADA, including the public balance; only the private balance funds the swap, through a one-time "Private session" account (a new concept, explained by the surrounding text). The "You pay" card shows only "28" with a wallet icon.
- The form itself is clear and familiar: You pay / You receive cards, Half/Max, a sectioned token picker, a live rate, a collapsible details panel and the "Slippage: 1%" chip. The details panel lists everything the tester needed apart from network fees.
- "Nothing is sent until you press Start swap" made reviewing feel safe. But the review is about 1,500 px of extra scrolling in a 640 px panel: the fee breakdown, the three-transactions note, the Lovejoin switch and "Transaction details" are far below the first screen.
- No total: there is no single "Total leaving your balance" line. The bold "For the swap 16 ₳" reads as a total but leaves out the 5 ₳ "Kept aside for contracts" and the 0.233208 ₳ network fee; the tester opened "Transaction details" and added up the outputs (16 + 5 + 0.233208 = 21.233208 ₳ leaving, 3.766792 ₳ change).
- "Three transactions, three network fees" appears only in a paragraph near the bottom, and only the first fee (0.233208 ₳) is given as a number; the other two only show up as "Room for network fees 2 ₳, what's left comes back". The tester expected one transaction per approval; "Start swap approves the whole run … without asking again" is honest but buried below the fold.
- Minimum: "Asks for at least" sounds weaker than a guarantee, which matches the warning; the warning lowered the tester's trust in the minimum.
- The Lovejoin return switch is on by default while the same screen says Lovejoin "hasn't had a third-party audit" and its pool has 0 boxes; to the tester it "felt like an opt-out I hadn't asked for".
- Collateral wording: "Kept aside for contracts" is friendly, but the transaction details call something "Collateral" with a different amount (4.650188 ₳), and output #2 (5 ₳) goes to the same one-time address as #0 (16 ₳).
- Screen-reader names said more than the visible labels: "Send privately" for "Send", "Half of your ADA", "As much ADA as a swap can take" for "Max", "The quote's details" for the bare chevron and "Ask Minswap again" for the refresh icon; sighted users get only icons for the last two.
- Abandonment moments: step 4 ("I don't know what to do", severity 2 of 5): with no Swap on either Home tab, a normal user might decide the wallet doesn't support swaps, the half-visible "dApps" row being the only lead. Step 20 ("I might lose money", severity 2): the cost is spread over many lines and three transactions, an unaudited mixer is on by default and the minimum can't be verified, so a cautious user could stop rather than press "Start swap" without a clear total.
- Worked well, per the tester: the "Swap tokens" card text once on the dApps page; the familiar form; the details panel; the review's step-by-step account of the run, including that the deposit and collateral come back; "Transaction details" for checking the actual outputs.

**Answers the task asked for.**

| Question | Tester's answer from the UI | Verifier's check |
|---|---|---|
| How much ADA am I spending? | 10 ₳ ("You pay 10 ₳"). Sureness High | Correct. The swap takes 10 ₳; costs come on top (the funding sends 16 ₳ plus 5 ₳ kept aside and pays a 0.233208 ₳ fee). |
| Approximately how much MIN am I receiving? | ≈ 906.5941 MIN ("1 ADA ≈ 90.6594 MIN"). High | Correct. |
| What is the minimum I might receive? | 897.61792 MIN ("Asks for at least 897.61792 MIN"), with the warning that the wallet relies on Minswap for it and can't read it back. Medium | Correct: Minswap's minimum at 1% slippage (906.5941 / 1.01), which the wallet can't verify inside the order Minswap builds. |
| What is the slippage? | 1% (price impact shown separately as 0.34%). High | Correct; 1% is the default. |
| What fees or deposits are involved? | DEX fee 2 ₳ (not refunded); order deposit 2 ₳, back with the proceeds; room for network fees 2 ₳, what's left comes back; kept aside for contracts 5 ₳, comes back ("collateral, lent through giveme.my"); first network fee 0.233208 ₳; three transactions, three fees, only the first given as a number. Medium | Partly. The 5 ₳ is the user's own ADA (output #2), kept at the one-time account as its own collateral; giveme.my lends a separate UTxO for the funding transaction. No Minswap fee (zero, so its row is hidden) and no Lovejoin fees (the pool has no room, fixture state). The rest is right. |
| What total amount leaves my balance? | Not stated by the review. Computed 16 + 5 + 0.233208 = 21.233208 ₳ leaving in the first transaction, with 3.766792 ₳ change from one 25 ₳ UTxO; net roughly 12.2 to 14.2 ₳ once the deposit, collateral and unused fee room come back. Low | Correct, but the UI never states it. After the funding the private balance would read 6.766792 ₳; the net cost is about 12.233208 ₳ plus the two later fees, which aren't shown and come out of the 2 ₳ room. |
| How many navigation decisions before the swap form? | 5 clicks on the actual route (Public tab, wrong; Private tab; dApps; Minswap; New swap); shortest route 3 clicks (dApps → Minswap → New swap) plus scrolling to see the dApps row. High | Correct: 5 clicks and 5 scrolls; shortest route 3 clicks. The dApps label is already visible at the bottom edge of the first screen, so the scroll isn't strictly needed. The report's observations say "4 navigation decisions" for the shortest route while listing three. |

**Verifier notes.**
- Result kept: PASS WITH FRICTION. The trace matches the command log and the screenshots, and all the friction comes from the product.
- The tester's one harness suspicion is wrong: "Comes back 4.650188 ₳" is real. It belongs to giveme.my's collateral UTxO for the funding transaction (its real preprod UTxO, built in as a constant), worked out as 5 ₳ less 1.5 × the 0.233208 ₳ fee, and it goes back to giveme.my only if the scripts fail. The review's "Kept aside for contracts 5 ₳" is something else: output #2, the user's own 5 ₳ paid to the one-time account to be its collateral later.
- Misread, invited by the UI: taking the 5 ₳ kept aside for giveme.my's lent collateral (the fees answer and the terminology point). Two adjacent notes on the review use "the collateral" for the two different things, and the dialog's Collateral section is the only one without an (i) hint (Spends, Reads and Contracts have one) and names no owner.
- Exists-not-found: "nothing explains that swaps come from the private balance only". The "28" carries a hover title, "In your private balance", which the harness can't show; visible text says it too, on the dApps page, on the Minswap page ("Each swap runs from a new one-time account, funded from your private balance…"), in the token picker's "In your private balance" heading and in the form's note. That the card itself has no visible label for the 28 is real but minor.
- Real: the only way in is Private tab → dApps → Minswap → New swap (a running swap also gets a row on Home, but only while it runs). The review keeps the form's scroll offset because the same component re-renders in place and nothing resets the scroll; Chrome's real side panel would do the same. The swap review lacks the "Total leaving your private balance" and "Private balance after" rows that five other reviews have (Transfer, Withdraw, CardanoSend, MoveIn, CreateSeedelf). The parts under "For the swap" add up to 16 ₳ and the 5 ₳ is a separate output. The Lovejoin return is on by default by deliberate product choice; only the "0 boxes" count is fixture state, and a pool with room would add a Lovejoin cost table, so more cost lines, not fewer.
- Harness effects, none changing the outcome: native title tooltips appear in neither the view nor the screenshots, which hid "In your private balance" on the 28, "Show the details" and "Ask Minswap again" on the icon buttons, and the "Max" tooltip, and slightly weakens the "nothing explains" and "icons only" points; the quote is the harness's modelled one, realistic but not live; one scroll inside the dialog reported "Nothing moved" and one target was ambiguous, and the tester recovered.
- The verifier also suggested that an environment note about a refusing outside service primed the tester's harness suspicion; the task text this tester received carried no such note (only the stop instruction), so that explanation doesn't apply.
- Money check: nothing was submitted and no funds moved (the network log shows no submission and no collateral request to giveme.my); 28 ₳ private and 10,408.014036 ₳ public throughout. The built but unsigned funding transaction (694 bytes) would have spent one 25 ₳ private UTxO, paid 16 ₳ and 5 ₳ to the one-time account ("Private session 1") and 3.766792 ₳ back to Seedelf Wallet's contract, with a 0.233208 ₳ fee.
- Prior knowledge: none seen. "Minswap is a Cardano DEX" and "DEX orders carry a deposit and a batcher fee" are general knowledge, and the UI says both.

**Final result.** After a detour through the Public tab, the tester found the swap under Private → dApps → Minswap, reached "Review the swap" with "Start swap" unpressed and answered every question, but had to work out the total leaving the balance from the funding table and the transaction details. The verifier keeps PASS WITH FRICTION and confirms the friction is the product's.

### T11 · Determine whether Lovejoin can currently mix

**Test notes.** Surface: a 360x640 window standing in for Chrome's side panel (a window of its own, not docked). Starting state: the funded wallet, unlocked, on Home's Private tab (28 ₳ private; 10,408.014036 ₳ public); the task text gave the wallet password. The tester saw only the scenario ("You want to privately mix some ADA") and goal, not the task title, which names Lovejoin. They were told that one outside service refuses every request here, so after confirming something the wallet may say nothing was sent, and that this refusal should not count as a wallet failure; "Review" never became available, so that point was never reached. Lovejoin's pool is read from the fake Koios, which reports 0 other boxes, so whether a mix can start was settled by fixture data. Main-run trace (it predates the harness fix for "Details" toggles; none was involved).

**Result.** PASS WITH FRICTION · confidence Medium · 0 wrong turns · 5 navigation steps · prior product knowledge needed: no, the tester had to guess that a mixer counts as a "dApp", after which the card's "Mix ADA in 10 ₳ boxes" made it obvious, and the screen spells out "Try again later".

**Path taken.**
1. Ran stop, then start → Home's Private tab: "Private balance 28 ₳", Receive / Send / Make public / Create, a Tokens card and a "dApps" row at the bottom edge.
2. Took a screenshot of Home and looked for anything named mix, mixer or privacy → the main actions are Receive, Send, Make public, Create; nothing obvious.
3. Scrolled down 300 px on Home → the rows dApps, Activity, UTxOs and the footer "Seedelf Wallet 1.1.0 · Preprod".
4. Clicked "dApps" → the dApps page opened already scrolled about 186 px down: cards "Minswap" ("Swap tokens, routed across Cardano's DEXes") and "Lovejoin" ("Mix ADA in 10 ₳ boxes: your boxes, and bringing them back"), plus notes on one-time accounts and "Let sites connect".
5. Scrolled up 300 px → the header: "dApps", "Used privately, from one-time accounts".
6. Clicked the "Lovejoin" card → the Lovejoin screen, all above the fold: "Your boxes in the pool None", Mix tabs "Private balance" / "Public account", "Boxes of 10 ₳" "1 box, 10 ₳" with disabled − and + buttons, "Lovejoin's pool" "0 other boxes to mix with; this needs 8", "Mixed 2 waves deep, 4 mixes", "Mixing 10 ₳ costs about 3.8 ₳, 38% of it".
7. Hovered the disabled "One box more" (+) → no tooltip.
8. Scrolled down 300 px → "Into a one-time account 15.3 ₳, and 5 ₳ of collateral", "Back later" "Each box on its own, after 1 to 6 hours, while Seedelf Wallet is unlocked", and a paragraph on boxes coming back.
9. Scrolled down 300 px → an amber warning "Lovejoin hasn't had a third-party audit…", a greyed-out "Review", and amber text under it: "Lovejoin's pool has 0 other boxes to mix with, and one box 2 waves deep needs 8. Try again later."
10. Hovered the disabled "Review" → no tooltip, but the reason is already written right under the button.
11. Scrolled down 300 px to the bottom → a teal note about boxes waiting in the pool, giveme.my's collateral and timing, ending "Lovejoin hides your boxes from people reading the chain, not from Koios or giveme.my, which see your device send both ends." (cut off at "se…" in the view text, whole in the screenshot).
12. Scrolled back to the top and clicked Refresh → "Updated 30 s ago" became "Updated just now"; the pool still read 0 other boxes, needs 8.
13. Clicked the "Public account" tab under Mix → the source switched to the public account; pool status and cost unchanged.
14. Scrolled down 600 px on the Public account tab → "From your public account 15.3 ₳, its collateral backing the mixes"; "Review" still disabled with the same reason.
15. Ran stop → the browser closed.

**Wrong turns.**
- None.

**Hesitations.**
- Step 2: Home has no Mix action. The tester weighed the Public tab, Settings, "Create" (not knowing what a Seedelf was) and "dApps", and picked dApps because a mixer sounded like a separate service; a user who doesn't think of a mixer as a "dApp" could miss it.
- Step 6: both − and + are greyed out with no reason given; at first the tester didn't know whether the amount could be changed at all, or why it was locked at 1 box.
- Step 8: the tester couldn't reconcile "costs about 3.8 ₳, 38% of it" with "Into a one-time account 15.3 ₳, and 5 ₳ of collateral": is 15.3 = 10 box + 3.8 cost + 1.5 something else? Is the 5 ₳ on top, so roughly 20.3 ₳ leaves the balance for a while? The total outlay and what comes back stayed unclear.
- Step 9: "one box 2 waves deep needs 8" uses jargon ("waves deep") the tester could only half-guess at; the gist, "Try again later", is clear.

**Observations.**
- Availability is visible before committing to a review: the pool row sits above the fold, "Review" is disabled, and the reason is printed under it; "I never had to press anything risky to find out." The disabled Review plus "Try again later" made the tester trust that they couldn't lose money by accident.
- But the pool row doesn't plainly say "mixing unavailable": the tester had to infer that "this needs 8" meant it couldn't start, and the explicit reason sits only under "Review", about 600 px down. The tester had expected either a clear on/off status or finding out only after pressing Review.
- Finding the mixer: Home has no "Mix" or "Privacy" entry, though the scenario is about mixing privately; the mixer is a dApp brand name, "Lovejoin", inside "dApps" at the very bottom of Home (partly below the fold). The dApps page opened already scrolled about 186 px, so its header was missed at first. Once there, the card's "Mix ADA in 10 ₳ boxes" made the mixer recognisable.
- The − and + box buttons are disabled, hovering gives no tooltip and nothing beside them says why; the tester guessed the pool status or a fixed size. The fixed denomination itself ("Boxes of 10 ₳", "1 box, 10 ₳") is clear.
- Cost: shown up front in large bold type with a percentage, so the high fee is hard to miss. But "Mixing 10 ₳ costs about 3.8 ₳, 38% of it", "Into a one-time account 15.3 ₳, and 5 ₳ of collateral" (Private) and "From your public account 15.3 ₳, its collateral backing the mixes" (Public) don't add up for the tester, who couldn't tell the total leaving the balance or what comes back, apart from the paragraph saying unused amounts and collateral come back. The tester had expected one fee figure, or a total of amount plus fee.
- A 38% fee on a 10 ₳ box is "huge": a cost-conscious user might stop even with an available pool, and it reduced the tester's own willingness to use the mixer.
- "Waves deep", "mixes", "boxes" and "one-time account" are not explained where they appear; "waves deep" wasn't explained anywhere the tester saw.
- Refreshing, and switching the source between "Private balance" and "Public account", changed neither availability nor the 3.8 ₳ cost; only the breakdown wording changed.
- The audit warning ("Lovejoin hasn't had a third-party audit: its makers' own review is the only one it has had. Use it knowing that.") and the disclosure of what Koios and giveme.my can see raised the tester's trust; the bottom privacy caveat is useful but dense.
- Screen-reader names matched the visible labels, except that the dApp cards' names include their descriptions; nothing hidden said anything the screen didn't.
- Worked well, per the tester: the pool's readiness in plain numbers before any commitment; Review disabled with its reason right under it; the bold cost with a percentage; "Updated just now" with a Refresh button.
- Abandonment moments: step 2 ("I don't know what to do", severity 2 of 5): with no Mix or Privacy entry on Home, a user who doesn't think to open "dApps" could conclude the wallet has no mixer. Step 8 ("I don't understand what this means", severity 3): unsure how much would be tied up or lost; with the 38% fee, a normal user might give up on mixing even with an available pool.

**Answers the task asked for.**

| Question | Tester's answer from the UI | Verifier's check |
|---|---|---|
| Can a mix currently start? | No: "0 other boxes to mix with; this needs 8", "Review" disabled, and under it "Lovejoin's pool has 0 other boxes to mix with, and one box 2 waves deep needs 8. Try again later." Sureness High | Correct. The fixture's pool reports 0 other boxes; at the default depth of 2, one box needs 8, and one wave deep would need 2, so the hint the page gives when a shallower mix would fit doesn't apply either. The 0 is fixture data; on real preprod the answer depends on the live pool. |
| What will a mix cost? | "Mixing 10 ₳ costs about 3.8 ₳, 38% of it" for one 10 ₳ box; separately 15.3 ₳ into a one-time account plus 5 ₳ of collateral from the private balance, or "15.3 ₳, its collateral backing the mixes" from the public account; unused amounts and collateral said to come back. Medium | Partly. The 3.8 ₳ is an estimate for the 4 mixes only (4 × 0.95 ₳; preprod measured about 0.877 ₳ a mix, and the unused part comes back). 15.3 ₳ is the 10 ₳ box + 3.8 ₳ for the mixes + an unnamed 1.5 ₳ reserve for the deposit's fee and the change. The funding's network fee appears only in the review, and each box's return costs about 0.3 ₳, which this page doesn't state. The all-in cost is somewhat above 3.8 ₳, and the page gives no total. |
| Is availability visible before committing to a review? | Yes: the pool row is above the fold, "Review" is disabled, the reason is printed under it, and nothing had to be pressed or confirmed. High | Correct. |

**Verifier notes.**
- Result kept: PASS WITH FRICTION. The outcome and every friction point come from real UI code.
- Harness: the pool count (0 other boxes, unchanged across Refresh) comes from the fake Koios. A real user sees the live preprod count; with 8 or more free boxes the row would read "N other boxes to mix with: enough" and "Review" would be enabled (capped at 1 box from a 28 ₳ private balance). A short pool is a real state, and the wallet's handling of it (Review disabled, reason under it) is real behaviour; the tester rightly didn't count it as a failure.
- Harness: the view caps a text line at 400 characters, which cut the privacy caveat at "se…" (the screenshot shows it whole, as the tester noticed), and printed a half-scrolled row as "about  of it". No misread came of either.
- Exists-not-found: "waves deep" is explained in Settings → Lovejoin, whose "Mixing, for each box" choice offers "1 wave deep: 1 mix, about 0.95 ₳", "2 waves deep: 4 mixes, about 3.8 ₳" and so on, with a note that your box stays "one of up to 9 (at 2 waves deep)". The Lovejoin page has no (i) hint and, in this state, no pointer there. The other terms are explained nearby: the dApps page the tester read explains one-time accounts, and the subtitle "A mixer for ADA, in 10 ₳ boxes" and the label "Boxes of 10 ₳" give the box.
- Real: Lovejoin is reachable only via Home (Private tab) → dApps → Lovejoin; the Public tab has no dApps row, and Home shows a Lovejoin section only once the wallet already has boxes in the pool. The dApps page kept Home's scroll offset because the UI never resets scroll on a screen change.
- Real: "+" is disabled because the pool fits 0 boxes, and the note that normally explains the cap is suppressed when no box fits, so the only reason sits under "Review"; none of the hovered buttons has a tooltip at all (the harness can't show native title tooltips, but none exists here).
- Real: the page never breaks down the 15.3 ₳ or names the 1.5 ₳ reserve, and the bold 3.8 ₳ covers only the mixes, leaving out the funding fee, the deposit fee and the return fee. The 38% can be lowered in Settings → Lovejoin ("1 wave deep: 1 mix, about 0.95 ₳"), but this page doesn't point there in this state.
- Surface effect: at 640 px Home's dApps row sits at the bottom edge; a taller real side panel would show it whole. The missing Mix entry and the Public tab's missing dApps row are real.
- Money check: nothing moved. "Review" stayed disabled, so no review was built and nothing was signed or sent; only Koios reads. Had a mix been possible, a private-balance mix would first have sent 15.3 ₳ + 5 ₳ of collateral + a network fee to a new one-time account, and in this harness it would then have ended at the giveme.my refusal.
- Prior knowledge: none seen. The tester chose dApps by reasoning that a mixer is a separate service, and read "needs 8" with general coinjoin knowledge, both declared.

**Final result.** Without pressing anything risky, the tester established that no mix could start ("0 other boxes to mix with; this needs 8", "Review" disabled, "Try again later") and found the headline cost, but could not reconcile the cost figures into a total. The verifier keeps PASS WITH FRICTION: the empty pool is fixture data, while the way the wallet presents it, and the friction around it, are real.

### T12 · Stake ADA

**Test notes.** Surface: a 360x640 window standing in for Chrome's side panel (a window of its own, not docked). Starting state: the funded wallet, unlocked, on Home's Private tab (28 ₳ private), with the "unstaked" override: the public account is "Not staking", with no rewards, so it shows 10,350.538725 ₳; the task text gave the wallet password. The tester saw the scenario, goal and questions, not the task title. Network responses were slowed on purpose (every Koios call waits 4 s), and the tester was told: "In this test, responses from the network are slow (several seconds each), as on a congested connection. You don't need to wait for the network to confirm anything in this test: observe and answer from what the wallet shows you." The network never confirms in this task; not reached, since the tester stopped at the review. Main-run trace: it predates the harness fix for "Details" toggles, which is why the first click on "Details" (step 12) didn't register. The tester disclosed that their own session context showed the owner's email domain, which matches the LOGIC pool's name ("Logical Mechanism"); they say they chose LOGIC on pledge and saturation after HODLr failed, but can't fully rule out that the name stood out.

**Result.** PASS WITH FRICTION · confidence Medium · 3 wrong turns · 11 navigation steps · prior product knowledge needed: no, tooltips explain the terms (saturation, margin, cost, pledge, deposit, epochs), though with no recommendation and no health indicator, judging whether a pool is "healthy" took some outside understanding.

**Path taken.**
1. Ran stop, then start → Home's Private tab: "Private balance 28 ₳", Receive / Send / Make public / Create, a Tokens card and a dApps row; nothing about staking.
2. Scrolled down the Private tab looking for staking → only dApps, Activity, UTxOs and the version footer (wrong turn).
3. Scrolled back up and clicked "Public" → "Public account" "10,350.538725 ₳", Receive / Send / Make private, and above the fold a card "Staking and governance" "Not staking: stake to earn rewards" "Voting power: Not delegated".
4. Clicked "Staking and governance" → "Not staking" with "The first time takes a 2 ₳ deposit, which comes back when you stop.", a big "Choose a pool", then the Voting power / "Delegate" card and a DRep section.
5. Hovered the (i) next to "Not staking" → tooltip "Stake your public account with a pool to earn rewards every epoch (5 days). Your ADA stays in your account, free to spend."
6. Scrolled down → the green note "Staking and voting are public: anyone can see which pool and DRep your public account chose. Private money can't be staked: it has no staking part, so while it's private it earns nothing…", and "Be your own DRep" "Registering locks up 500 ₳…".
7. Clicked "Choose a pool" → "Updating…", then "559 live pools", a search box, a sort menu "Ticker, A to Z" and rows such as "8964 1.7% saturated … 0% margin · 170 ₳ cost".
8. Clicked the sort menu → the tester saw no open option list in the screenshot, got the options from the error of a deliberately invalid select command ("Ticker, A to Z", "Least saturated", "Lowest margin", "Lowest cost", "Highest pledge") and pressed Escape (wrong turn).
9. Scrolled the alphabetical list about 1,200 px → pools from 0% to 60.8% saturated (ALFA), margins from 0% to 10%; none flagged as oversaturated or retiring.
10. Scrolled back up and sorted by "Highest pledge" → top rows SWM01 (0% saturated, 1.5% margin, 340 ₳ cost, 53,000,000 ₳ pledge), LOGIC (18.8%, 2%, 170 ₳, 5,500,000 ₳), GRADA (75.4%), HODLr (14.3%, 0%, 170 ₳, 4,500,000 ₳); pledge now shows in each row.
11. Clicked HODLr, the best value to the tester → "Reading the pool's details…", then "Couldn't read the pool's details just now." with "Details", "Try again" and a disabled "Stake with HODLr" (wrong turn).
12. Clicked "Details" (the first attempt, by button name, didn't register; the second, by text, did) and hovered the disabled stake button → "Koios has no details for this pool right now: it may have retired. Try again later, or choose another pool."; no tooltip on the button.
13. Clicked "Try again" → the same failure, "Couldn't read the pool's details just now."
14. Clicked Back → the pool list, still sorted by Highest pledge.
15. Clicked LOGIC → "Logical Mechanism", "Saturation 18.8%", "Margin 2%", "Cost per epoch 170 ₳", "Pledge 5,500,000 ₳", "Delegators 103", "Blocks made 138,553", "The Stake Pool For Logical Mechanism.", the full pool ID, the 2 ₳ deposit note and an enabled teal "Stake with LOGIC".
16. Hovered the small (i) under the details card → "Saturation: how full the pool is; past 100%, every delegator earns less. Margin: the share of rewards the pool keeps after its cost. Cost: what it takes each epoch, before the margin. Pledge: what its owners stake in it themselves. Blocks made: how many it has added to the chain."
17. Scrolled down to see the rest of the pool page → only the deposit note and the footer.
18. Clicked "Stake with LOGIC" → "Building…" with Back disabled, then "Review: start staking": "Nothing is sent until you press Stake with LOGIC", "Stake with LOGIC", "Deposit 2 ₳", "Network fee 0.179361 ₳", "Public account after 10,348.359364 ₳", the pool ID, "Registering your account to stake takes the deposit. Stopping staking gives it back.", "This is public: it names your public account.", "It takes about a minute for the network to confirm." and a "Stake with LOGIC" button.
19. Hovered the (i) next to the review title → "Rewards start after about 15 to 20 days (the network takes a snapshot, then pays out an epoch later), then come every 5 days."
20. Clicked "Transaction details" → dialog "The transaction": "Spends 2 UTxOs", "Pays 1 output" to an addr_test1qq8ac… address, "#0 · a key that stakes 2.820639 ₳".
21. Scrolled inside the dialog (the first try failed because two texts matched the target; the second worked) → "Network fee 0.179361 ₳", "Valid until slot 135558247", "Size 545 bytes", "Signed 3 signatures, not sent yet", "1 Certificate" "Registers a stake key and stakes with a pool" "2 ₳ deposit" pool1rccstu…vng0tg.
22. Closed the dialog and stopped at the review without pressing the final "Stake with LOGIC" (the task said to prepare), then ran stop → the review still shown, nothing sent.

**Wrong turns.**
- Step 2: looked for staking on the Private tab, where the wallet opens, and scrolled it, expecting a Stake or Earn option near the balance on the default screen; the Private tab has no staking entry at all; corrected by guessing the Public tab might have it, which it did ("Staking and governance"); only later did the staking screen explain that private money can't be staked.
- Step 8: clicked the sort menu, expecting a visible list of sort options; by the tester's account nothing appeared in the screenshot ("likely a native select in the test browser"); corrected by getting the option names through the select command and pressing Escape.
- Step 11: picked HODLr from the "559 live pools" list for its 0% margin, minimum cost and big pledge, expecting a details page with a working Stake button; got "Couldn't read the pool's details just now." and, under Details, "…it may have retired."; the Stake button stayed disabled and Try again failed too; corrected by going Back and picking the next pool with a big pledge and moderate saturation, LOGIC.

**Hesitations.**
- Step 1: the Private tab is selected and shows only 28 ₳; the tester had to decide whether staking was under Settings, dApps or the Public tab, and nothing on the Private tab points to staking.
- Step 7: 559 pools with no recommendation and no health indicator; the tester had to choose between lowest margin, lowest cost, least saturated and highest pledge, and chose pledge because "Least saturated" would put empty, unproven pools on top.
- Step 10: SWM01 tops the pledge sort but is "0% saturated", which made the tester suspect an inactive pool; they skipped it, but the UI didn't help judge that.
- Step 12: "Stake with HODLr" was disabled and hovering gave no tooltip; the tester learned why only by expanding the small "Details", and "Koios" meant nothing to them.
- Step 20: the output address "addr_test1qq8ac…" is labelled only "a key that stakes", not "your public account", so the tester couldn't be sure the 2.820639 ₳ change was coming back to them.
- Step 21: "Signed 3 signatures, not sent yet" worried the tester, who hadn't pressed confirm or entered a password; the review's "Nothing is sent until you press Stake with LOGIC" reassured them.

**Observations.**
- Staking lives only on the Public tab, as a prominent "Staking and governance" card below the balance ("Not staking: stake to earn rewards", plain language). Home doesn't hint that staking exists or which side it's on; "Private money can't be staked" appears only at the bottom of the staking screen, once found.
- The list heading says "559 live pools", yet HODLr's page said it "may have retired", and the list doesn't mark it at all: contradictory, and it made the tester doubt how fresh the pool list is.
- No explicit health or status indicator (no recent blocks, no "retiring" badge, no uptime); the tester inferred health from "Blocks made 138,553" and "Delegators 103". The tester expected a health or status badge, recent blocks or a retiring warning.
- Sorting only goes one way ("Least saturated"): no way to bring oversaturated pools to the top and no filter to hide them; rows don't flag oversaturation with a colour or warning (the tester never saw a pool above 100% to check). Pledge appears in the rows only under "Highest pledge"; by default rows show only saturation, margin and cost.
- The review doesn't restate that the ADA stays spendable and only the 2 ₳ deposit leaves; the tester learned that from a hover tooltip on the previous screen. They had expected free-to-spend (as on Cardano) but wanted the wallet to confirm it.
- Signing: "Signed 3 signatures, not sent yet" appears in the transaction details before confirming, and no password was asked for at any point up to the review; the tester expected signing at the final button, perhaps with a password prompt. This lowered their trust a little: "A cautious user might think something was signed without consent."
- The change output is labelled "a key that stakes", not as the tester's own account; "Koios" in the error is a backend name that means nothing to a normal user.
- The review is clear and concise: "Review: start staking", "Nothing is sent until you press Stake with LOGIC" (which reassured the tester they could look around safely), the deposit, the fee, "Public account after", a public-privacy notice and the confirmation time. The public account goes from 10,350.538725 ₳ to 10,348.359364 ₳, exactly the 2 ₳ deposit plus the 0.179361 ₳ fee. The final button names the pool and sits in view without scrolling.
- The transaction details show exactly one certificate, "Registers a stake key and stakes with a pool", "2 ₳ deposit", with the LOGIC pool ID; nothing else is sent anywhere.
- Worked well, per the tester: the 2 ₳ deposit disclosed up front and called refundable; one (i) on the pool page defining every metric, including what passing 100% saturation means; saturation, margin and cost at a glance in the rows; useful sort options; pool details taking a few seconds with the Stake button disabled meanwhile, "which is reasonable".
- Abandonment moments: step 13 ("This seems broken", severity 2 of 5): a pool from the "live pools" list couldn't be read, Stake was disabled and Try again failed; a normal user might decide staking is broken, though most would try another pool. Step 2 ("I don't know what to do", severity 2): with no staking option on the Private tab, a user who doesn't try Public might assume the wallet can't stake. Step 21 ("I don't trust pressing this button", severity 2): "Signed 3 signatures, not sent yet" before confirming or entering a password.

**Answers the task asked for.**

| Question | Tester's answer from the UI | Verifier's check |
|---|---|---|
| Does my ADA stay spendable? | Yes: the "Not staking" (i) says "Your ADA stays in your account, free to spend."; only a refundable 2 ₳ deposit leaves ("comes back when you stop"); public account only ("Private money can't be staked"); the review doesn't restate it. Sureness High | Correct. The built transaction returns its 2.820639 ₳ change to the account's own address; only the 2 ₳ deposit and the 0.179361 ₳ fee leave, and the rest stays spendable. |
| What does the pool charge? | LOGIC: Margin 2% ("the share of rewards the pool keeps after its cost") and Cost per epoch 170 ₳; separately, a 2 ₳ refundable deposit and a 0.179361 ₳ network fee. High | Correct; the deposit and fee are the transaction's costs, not the pool's. |
| Does the pool look healthy? | It seems so, by inference only: the details loaded, Blocks made 138,553, Delegators 103, Pledge 5,500,000 ₳, no retiring warning; no explicit health indicator. Medium | Correct. The wallet's own checks raised no warning for LOGIC (not retired or retiring, 18.8% saturated, live pledge not below its pledge); the UI signals health only by the absence of warnings, never positively. |
| Is it oversaturated? | No: saturation 18.8%, and the tooltip says problems start "past 100%". High | Correct. |
| What will actually happen when I confirm? | One transaction from the public account with one certificate, "Registers a stake key and stakes with a pool" (LOGIC), taking a 2 ₳ deposit plus a 0.179361 ₳ fee and leaving 10,348.359364 ₳; public ("it names your public account"); confirms in about a minute; rewards after about 15 to 20 days, then every 5 days. High | Correct. Pressing "Stake with LOGIC" submits a transaction the wallet already signed at review, without asking for a password: it spends 2 public UTxOs (5 ₳), returns 2.820639 ₳ to the account's own address and carries one combined registration-and-delegation certificate. Voting power stays "Not delegated". |

**Verifier notes.**
- Result kept: PASS WITH FRICTION. Two of the three wrong turns (the sort menu, HODLr) and the "This seems broken" moment are artifacts, but real friction remains once they are removed.
- Harness (fixture gap): the fake Koios had no pool details for HODLr, a pool in its own list of registered pools, and the wallet shows "Koios has no details for this pool right now…" only when that answer is empty. Real Koios returns details for every listed pool, so a real user would see HODLr's figures and an enabled "Stake with HODLr"; even a pool that had retired would show "This pool has retired: it earns nothing now. Choose another." with a tooltip on the button, never "no details". The HODLr wrong turn, the "live pools" versus "may have retired" contradiction, the step 13 abandonment moment and the trust point about the list's freshness all come from this gap. Other pools may fail the same way (LOGIC is the funded fixture's own pool; unverified), which would funnel any T12 tester onto LOGIC.
- Misread: the screenshot taken right after clicking the sort menu shows the native list open with all five options; only the harness's text view failed to print them. So step 8 is not a real wrong turn.
- Harness: the click on "Details" by button name failed because the view lists the disclosure's summary element as a button but the matcher didn't match it (fixed after the main run); a real user opens it with one click. The ambiguous scroll in the dialog came from its title and an inner heading both reading "The transaction" (the duplicate is real product text, the failed command a matcher limit). The slow backend stretched "Updating…", "Reading your DRep…", "Reading the pool's details…" and "Building…", as intended.
- Exists-not-found: oversaturation and retirement flags. Rows over 100% get a warning-coloured "Oversaturated" tag and pools keeping 100% margin a "Keeps all rewards" tag; the pool page and the review show warnings when they apply ("This pool has retired…", "This pool retires in epoch N…", "This pool is oversaturated…", "Its owners stake less than they pledged…"); retiring and retired pools are left out of the list. None applied to the pools seen (the highest was GRADA at 75.4%), so "none flagged" is accurate; what's missing is a positive signal.
- Real: "Signed 3 signatures, not sent yet" is accurate. Pressing "Stake with LOGIC" on the pool page built and signed the transaction with the unlocked session's keys; Send only submits it, and asks for no password while the wallet is unlocked.
- Real: the change output is described only by address shape. It is the user's own address (its stake part is the credential the certificate registers) and "Public account after" counts it; the dialog just doesn't say so.
- Real: the Private tab has no route to staking; the review doesn't restate spendability (the sentence is the "Not staking" tooltip, and becomes visible text once staking); after a failed read the disabled Stake button has no tooltip and the reason names Koios; pledge shows in rows only under the pledge sort; sorts go one way only, with no filter.
- On hesitation step 7: pools that pay nothing (100% margin or zero stake) sink to the bottom of every sort, so "Least saturated" opens on barely staked pools, not empty ones, and SWM01 topping the pledge sort means its stake isn't zero.
- Minor slip in the report: HODLr was the first pool the tester opened (the fourth row of the pledge sort), not "the third".
- Money check: nothing was submitted and no funds moved. The wallet had built and signed (3 signatures) transaction e2748b01…197c97d2 and held it unsent: 2 public UTxOs (5 ₳ together) in, 2.820639 ₳ back to the account's own address, a 0.179361 ₳ fee, one certificate registering the stake key with a 2 ₳ deposit and delegating to LOGIC. The private 28 ₳ was never touched.
- Prior knowledge: none seen for wallet-specific knowledge; the tester's general beliefs (delegation doesn't lock funds, pledge signals commitment, 0% saturation means inactive) were declared, and the last is partly wrong for this wallet. The email-domain overlap with LOGIC is a low concern, since the tester picked HODLr first and moved to LOGIC only after HODLr failed.

**Final result.** The tester reached "Review: start staking" for LOGIC, stopped before the final "Stake with LOGIC" and answered all five questions correctly from the UI, after a detour through a pool whose details wouldn't load. The verifier traces that detour to a fixture gap and the sort-menu complaint to a misread, and keeps PASS WITH FRICTION for the real friction left: staking hidden from the default tab, no positive pool-health signal, signing at review without a password prompt, and a review that doesn't restate spendability.

### T13 · Stop staking

**Test notes.** Surface: a 360x640 window standing in for Chrome's side panel (a window of its own, not docked). Starting state: the funded wallet, unlocked, on Home's Private tab (28 ₳ private; 10,408.014036 ₳ public, including 57.475311 ₳ of rewards; staked with LOGIC; voting power delegated to "Always abstain"); the task text gave the wallet password. The tester saw the scenario and goal, not the task title, and was told: "You don't need to wait for the network to confirm anything in this test: observe and answer from what the wallet shows you." The task said to do it, and this is the one trace of T10 to T14 in which a transaction was submitted; the fake Koios accepted it, but the network never confirms in this task, so the wallet stayed on "… sent. Waiting for the network…" and held new payments back (BUILDER-NOTES limitation 2), and the after-confirmation state couldn't be seen. Main-run trace (it predates the harness fix for "Details" toggles; none was involved).

**Result.** PASS WITH FRICTION · confidence High · 0 wrong turns · 7 navigation steps · prior product knowledge needed: no, the labels "Public", "Staking and governance" and "Stop staking" were enough; knowing what a DRep is helped with the side effect on voting power but wasn't needed to finish.

**Path taken.**
1. Ran stop, then start → the wallet opened on the Private tab: "Private balance 28 ₳", Receive / Send / Make public / Create, Tokens, dApps.
2. Clicked "Public", guessing that delegation belongs to a normal public account → "Public account" "10,408.014036 ₳", "Includes 57.475311 ₳ of staking rewards", and a card "Staking and governance" "Staking with LOGIC" "Voting power: Always abstain" with a chevron.
3. Clicked the "Staking and governance" card → "Your pool" "LOGIC · Logical Mechanism", the pool ID, "Pool details", a big "Change pool" button, "Rewards 57.475311 ₳" with "Withdraw rewards"; no stop option above the fold.
4. Scrolled down 300 px instead of trying "Change pool" → "Voting power" "Delegated to Always abstain", "Change who votes for you", "Be your own DRep" with "Become a DRep", and "Governance actions".
5. Scrolled down 400 px more → a red text row "Stop staking" with a chevron, under the DRep section and above a privacy note; the bottom of the page.
6. Clicked "Stop staking" → the review opened already scrolled to its bottom (288 px hidden above): "Deposit back 2 ₳", "Network fee 0.173685 ₳", "Public account after 10,409.840351 ₳", a yellow warning box with bullet points, "Transaction details" and a big red "Stop staking" button; the title and first rows out of view.
7. Scrolled up 400 px → "Review: stop staking", "Nothing is sent until you press Stop staking", "Staking Stops", "Rewards withdrawn 57.475311 ₳", "Deposit back 2 ₳", "Network fee 0.173685 ₳", "Public account after 10,409.840351 ₳".
8. Scrolled down and clicked "Transaction details" → dialog "The transaction": the transaction ID, "Spends 1 UTxO", "Pays 1 output" of 62.301626 ₳ to the tester's own address ("a key that stakes"), "Network fee 0.173685 ₳", "Valid until slot 135558170".
9. Clicked "Close" → back on the review, still at the bottom, with the warnings and the red button.
10. Wrote down what they expected, then clicked the red "Stop staking" → back on the Public home with "Stop staking sent. Waiting for the network…" and "fea05649a3…8dd638 on Cardanoscan"; balance still 10,408.014036 ₳; Send and Make private greyed out with "Wait for the last transaction to confirm"; the card still read "Staking with LOGIC".
11. Waited 20 s → nothing changed while it waited for confirmation.
12. Ran stop → the browser closed.

**Wrong turns.**
- None.

**Hesitations.**
- Step 2: nothing about staking on the Private tab; the tester had to guess that delegation lives on the Public side. "Public" was the obvious place to look, but nothing on the Private home pointed there.
- Step 3: "Change pool" was the main action under "Your pool" and nothing said "Stop" or "Undelegate"; the tester briefly wondered whether stopping was inside "Change pool" (for example as a "no pool" choice) before deciding to scroll first.
- Step 6: the review opened at its bottom, so the big red "Stop staking" was the first thing the tester saw, "already under my pointer area", with the title and "Nothing is sent until you press Stop staking" out of view; for a moment they weren't sure whether this was a review or something had already happened, and scrolled up to check.
- Step 6: reading "Your pool and your voting power's delegation end", the tester, who only wanted to leave the pool, had to stop and accept that the voting delegation ("Always abstain") would end too; the wallet offered no way to keep it.
- Step 10: after sending, the card still said "Staking with LOGIC" and the balance hadn't changed; "Waiting for the network…" explained why, but the card didn't tell the tester whether staking had stopped.

**Observations.**
- Placement: the only pool action above the fold is "Change pool"; "Stop staking" is a red text row at the very bottom of the page, under Rewards, Voting power and "Be your own DRep", found after about 700 px of scrolling. The tester expected a "Stop" or "Undelegate" button next to the current pool. "Stop staking" itself read clearly enough, since "staking" is the word used throughout.
- The review kept the previous page's scroll position: it opened at its bottom with the red confirm button showing and the title, "Nothing is sent until you press Stop staking" and the "Staking" "Stops" row hidden above. "Someone who clicks quickly could confirm without seeing the top half of the review." The reassurance at the top was hidden on arrival.
- Scope: stopping also ends the voting-power delegation. The warning says so ("Your pool and your voting power's delegation end"), but it's bundled in; the tester expected only the pool delegation to end. "Voting power" and "DRep" may be unfamiliar to a basic user; each has a "What this means" (i), which the tester didn't open.
- The review lists every consequence and its numbers add up (10,408.014036 + 2 deposit − 0.173685 fee = 10,409.840351), matching the tester's own arithmetic, which built trust; "they're already counted in your balance" explains why the withdrawn rewards don't raise the after figure. The tester had thought they might need to withdraw rewards first; they are withdrawn in the same transaction.
- What is lost is stated plainly: "Rewards for the last epoch or two that the network hasn't paid out yet are lost: it pays them only to an account that's still staking." Reversibility too: "You can start staking again any time, with the deposit again."
- The large red/pink confirm button differs from the dark-outlined buttons elsewhere ("Change pool", "Withdraw rewards") and signals a consequential action.
- The transaction details show 1 input and 1 output of 62.301626 ₳ back to the tester's own staking address, which reassured them that no funds were leaving.
- Pending state: the card doesn't show a pending stop and the balance is unchanged; the "Stop staking sent. Waiting for the network…" banner, the Cardanoscan link and the disabled actions with "Wait for the last transaction to confirm" explain it. The tester had expected the card to change to "Not staking" or show a pending stop.
- Context the tester found reassuring or honest: the staking screen's "Your ADA stays in your public account, free to spend: the pool never holds it.", the footer note that private money can't be staked, and "This is public: it names your public account."
- Worked well, per the tester: the Public card showing the current delegation right away; plain-language bullets on the review, including the lost unpaid rewards and how to undo it; rewards withdrawn automatically with the stop; clear pending feedback after sending.
- Abandonment moments: none recorded.

**Answers the task asked for.**

| Question | Tester's answer from the UI | Verifier's check |
|---|---|---|
| Before confirming, what did I believe would happen? | One public transaction would deregister the public account from staking; the LOGIC delegation and the voting-power delegation ("Always abstain") would both end; the 57.475311 ₳ of rewards would be withdrawn in the same transaction, the 2 ₳ deposit would come back, and a 0.173685 ₳ fee would leave 10,409.840351 ₳; the last epoch or two of unpaid rewards would be lost and no more would come; the ADA never leaves the public account; staking again needs the deposit again. Sureness High | Correct. The submitted transaction does exactly this: a stake-key deregistration with the 2 ₳ refunded, a 57.475311 ₳ withdrawal, one 62.301626 ₳ output to the account's own receive address, a 0.173685 ₳ fee. Deregistration ends both delegations; the last unpaid rewards go to the treasury. |
| Routine, destructive, reversible, permanent, or something else? | Consequential but reversible. Not routine: a bright red confirm button, a yellow warning box, and a red entry tucked at the bottom of the page. Not permanent or destructive to funds: "You can start staking again any time, with the deposit again", the deposit comes back, rewards are withdrawn rather than lost, and "Nothing is sent until you press Stop staking"; only the most recent unpaid rewards are lost, as the warning says. High | Correct. The design means it as consequential and reversible, not destructive: a danger-styled entry row and confirm button with a warning callout, and the stake key can be registered again at any time. Only the fee and the last unpaid rewards are lost. |

**Verifier notes.**
- Result kept: PASS WITH FRICTION. Every friction item is product behaviour; none comes from the harness or the fakes.
- Real, and the strongest finding: the review opens scrolled to its bottom. Screens swap inside one scrolling page and nothing in the UI resets the scroll, so the browser keeps the offset, cut down to fit the shorter review. At 360x640 this happens to every user, because reaching the "Stop staking" row takes more scrolling (about 350 px or more) than the review's 288 px maximum. The review is about 928 px tall, so the hidden top is 288 px here, about 130 px in an 800 px panel, and nothing at about 928 px or taller. The confirm button didn't land under the spot that was clicked, so a double-click wouldn't confirm.
- Real: the placement. The only control under "Your pool" is "Change pool", and the pool browser behind it has no stop or no-pool option, so scrolling was the right call. The page scrolls 586 px in all; the tester's two scrolls asked for 700.
- Real, and Cardano's rule rather than a wallet choice: no certificate ends only a pool delegation. Deregistering the stake key is how staking stops and the deposit comes back, and it clears the vote delegation too; keeping it would mean registering again and locking the deposit again, which the wallet doesn't offer. The review states the effect plainly.
- Real: the Home card reads the last balances and has no pending state. On a real network, within about a minute, the banner would read "Staking stopped", the card "Not staking: stake to earn rewards" and the balance 10,409.840351 ₳.
- Real: the Private tab has no pointer to staking (Settings' "Staking" section holds only the rewards preference). Home opens on Private at every new panel session, so real users start there too.
- Harness: "Waited 20 s, nothing changed" reflects the never-confirming network in this task; a real user would see the change within about a minute ("It takes about a minute for the network to confirm"), possibly not within 20 s.
- Misread: taking "a key that stakes" to mean "my own address". The conclusion is right (the output is the account's own receive address 0, and its stake part matches the deregistered key), but the words only describe the address's shape and the dialog never marks your own outputs. The tester didn't scroll the dialog's inner area, which also lists the certificate ("Stops a stake key's staking · 2 ₳ back") and the withdrawal.
- Money check: one transaction, fea05649a399578f…978dd638 (416 bytes), was submitted and accepted by the fake Koios, and never confirmed. Fee 0.173685 ₳, exactly the minimum; one input of 3 ₳; a 57.475311 ₳ rewards withdrawal; one deregistration certificate with the 2 ₳ deposit refunded; one output of 62.301626 ₳ (no tokens, no datum) to the account's own receive address 0; no collateral, scripts, metadata, votes or third-party outputs. Had it confirmed, the public account would go from 10,408.014036 ₳ to 10,409.840351 ₳, both delegations would end, and the private 28 ₳ would be untouched.
- Prior knowledge: none seen. The tester used "deregister" and the deposit refund only after the review had said "Deposit back 2 ₳", and "DRep" only after "Be your own DRep" was on screen.

**Final result.** The tester found "Stop staking" at the bottom of the staking page, explained its consequences correctly before confirming, and submitted it; the decoded transaction matches the review exactly. The friction was the control's placement, the review opening scrolled down to its red confirm button, the vote delegation ending with it, and an unchanged Home card while pending; the verifier keeps PASS WITH FRICTION.

### T14 · Understand and vote on a governance proposal

**Test notes.** Surface: a full browser tab, 1280x720. Starting state: the funded wallet, unlocked, on Home's Private tab (28 ₳ private; 10,408.014036 ₳ public; staked with LOGIC), with the "drep" override: the account is its own registered DRep (active until epoch 340, voting power 10,408.014036 ₳, 1 delegator, 500 ₳ deposit) and its vote is "Delegated to Your own DRep"; the task text gave the wallet password. The tester saw the scenario and goal, not the task title, and the note "Prepare the vote up to the point of confirming it; you may stop there." This run predates the harness's `proposals` override: the fixture's recorded preprod proposal list has no title or summary for any of its seven actions (Koios hadn't read their anchors when it was recorded), and no proposal dates or treasury withdrawal amounts and recipients. The harness also blocks outside pages, so the IPFS gateway and Cardanoscan open a "Page not available" placeholder (BUILDER-NOTES limitation 6). BUILDER-NOTES records a rerun, T14r, with test-written proposal metadata and served anchor documents; this is the original run. "Your vote: Not voted" on every action comes from the fixture's fixed vote list. The network never confirms in this task (not reached). Main-run trace (it predates the harness fix for "Details" toggles; none was involved).

**Result.** PASS WITH FRICTION · confidence Medium · 4 wrong turns · 27 navigation steps · prior product knowledge needed: yes, finding voting meant knowing that DRep voting belongs to the public or staking side, and working out what a specific proposal does needed off-wallet content. Verifier: BLOCKED, because the failure to understand any proposal came from the fake data and the blocked outside pages, not the wallet, so the task's main question couldn't be tested; the part that could be (finding the actions and preparing the vote) passed with real friction.

**Path taken.**
1. Ran stop, then start → the wallet's tab opened on the Private tab: "Private balance 28 ₳", Receive / Send / Make public / Create, Tokens, dApps, Activity.
2. Took a screenshot and scrolled down the Private home → only UTxOs and the version footer; nothing about governance or DReps (wrong turn).
3. Clicked "Public" → 10,408.014036 ₳ and a card "Staking and governance" "Staking with LOGIC" "Voting power: Your own DRep".
4. Clicked the "Staking and governance" card → "Your pool" LOGIC, "Rewards 57.475311 ₳", "Voting power" "Delegated to Your own DRep", "Change who votes for you".
5. Scrolled down 400 px → "Your DRep": "Status Active until 30 Jan 2027 (epoch 340)", "Voting power 10,408.014036 ₳", "Profile None", "Deposit 500 ₳", the DRep ID and a large teal "Governance actions" button.
6. Clicked "Governance actions" → 7 entries listed only by type ("Info action" ×5, "Treasury withdrawal" ×2), each with a deadline such as "Open until 22 Oct 2026 (epoch 320)", a short hash such as "53fbef38…#0 · proposed in epoch 314" and "Not voted"; no titles.
7. Scrolled down to see the whole list, then back up → 7 actions (53fbef38, 588e7032, 322066e8, 139444b2, 2f9a101c, 6056be57, 375f7ed7), none with a title.
8. Clicked the first Info action (53fbef38…#0) → "Type Info action", "Voting Open until 22 Oct 2026 (epoch 320)", "Proposer's deposit 1,000 ₳", "Your vote Not voted", "Koios has no title or summary for it. Its full text is at the address below, written by whoever proposed it.", a "Read its full text" link, an IPFS privacy note, the Action ID and an ipfs:// address.
9. Hovered the (i) by the "Info action" heading → "An info action asks DReps, stake pools and the constitutional committee for their view: it changes nothing on chain, however the vote goes."
10. Scrolled down the detail page → "See it on Cardanoscan", the Vote section ("Yes" / "No" / "Abstain") and a note that every vote is public and stays on chain for good.
11. Clicked "Read its full text" → a new tab: "Page not available. This page is outside the test and can't be shown here." (wrong turn)
12. Closed that tab and clicked Back, which failed because Back was scrolled out of view; scrolled up and clicked Back → the list (wrong turn).
13. Opened the second Info action (588e7032…) → the same "Koios has no title or summary for it", only an ipfs://Qm… address.
14. Back, then opened Treasury withdrawal 322066e8… → the same message, with no amount and no recipient shown.
15. Hovered the (i) on the Treasury withdrawal page → "A treasury withdrawal pays ADA out of Cardano's treasury, the fund that fees and new ADA flow into, to the addresses it names, once enough DReps and the constitutional committee vote yes."; the screen itself showed no addresses and no amount.
16. Back, then opened Info action 139444b2… → the same: no title or summary.
17. Back, then opened Treasury withdrawal 2f9a101c…, Info action 6056be57… and Info action 375f7ed7… in turn (a few Back clicks failed with Back scrolled out of view) → every one said "Koios has no title or summary for it"; only IPFS addresses and action IDs.
18. Clicked "See it on Cardanoscan" on 375f7ed7 → a new tab: "Page not available" (wrong turn).
19. Closed that tab, scrolled up, Back, opened 53fbef38… again, scrolled down and clicked "Yes" → "Review: your vote": "Nothing is sent until you press Cast Yes vote", "Your DRep drep1y2e20afmrjh…2egjc8", "Governance action Info action", "Your vote Yes", "Network fee 0.173333 ₳", "Public account after 10,407.840703 ₳", two privacy notes and a big "Cast Yes vote" (after the point a normal user would have stopped).
20. Clicked "Transaction details" and scrolled inside the dialog → "Spends 1 UTxO", one change output, the fee, "Signed 2 signatures, not sent yet", and under "Governance": "Votes yes as a DRep" "53fbef383305…7de056#0" (after the point a normal user would have stopped).
21. Closed the dialog and stopped at the review without pressing "Cast Yes vote", as instructed; ran stop (after the point a normal user would have stopped).

**Wrong turns.**
- Step 2: looked for governance or voting on the Private home (the default tab) and scrolled through it, expecting a Governance, Voting or DRep entry beside dApps / Activity / UTxOs; nothing there, as governance lives only on the Public tab inside "Staking and governance"; corrected by switching to Public, where the card's "Voting power: Your own DRep" gave it away.
- Step 11: clicked "Read its full text" to learn what the proposal says, expecting its text; got "Page not available" (the harness blocks outside pages); corrected by closing the tab and opening the other proposals in the hope that one had a summary inside the wallet. None did.
- Step 12: clicked Back while scrolled down on a detail page, expecting to return to the list; Back was scrolled out of view, so the command failed ("a person would have had to scroll up to reach it"); corrected by scrolling up first, then clicking Back.
- Step 18: clicked "See it on Cardanoscan" as a second way to read the proposal, expecting an explorer page with its title and metadata; got "Page not available"; corrected by closing it and going ahead with the vote without understanding the proposal.

**Hesitations.**
- Step 2: nothing about voting on the Private home; the tester had to guess that governance belongs to the "Public" side.
- Step 6: the list gives no titles, only "Info action" or "Treasury withdrawal" plus a hash; the tester couldn't tell the five Info actions apart and had no reason to pick one over another.
- Step 8: "Koios has no title or summary for it." The tester didn't know what Koios is; a normal user would wonder whether the proposal or the wallet is broken.
- Step 14: the treasury tooltip says the action pays "to the addresses it names", but the screen showed no amount and no recipient, exactly what the tester would need before voting Yes on spending treasury money.
- Step 19: the tester hesitated before clicking Yes, since the task says to refuse to vote without understanding and they understood none of the proposals; they picked the first Info action only because its tooltip says it "changes nothing on chain, however the vote goes", so it seemed lowest-risk.
- Step 19: the review row "Governance action Info action" doesn't say which of the five Info actions; the tester had to open "Transaction details" to check it was 53fbef38.

**Observations.**
- Finding it: governance is hidden from the default Private home; it sits on the Public tab inside a card titled "Staking and governance", whose subtitle "Voting power: Your own DRep" was the only hint (and, once on Public, a clear one). "Governance actions" is below the fold on the staking screen, about 400 px down. The tester expected a top-level Governance or Vote entry; "Governance actions" is Cardano's official term and understandable to someone who knows Cardano, but the entry is buried in a staking card.
- The list has no titles: each entry is a type, a deadline, a truncated hash and "Not voted", and five look identical apart from the hash. The tester expected each proposal with a human-readable title.
- All 7 detail pages say "Koios has no title or summary for it."; "Koios" is unexplained jargon, and no proposal had any human-readable description inside the wallet. The tester expected a title, an abstract or rationale, and for treasury withdrawals the amount and recipient.
- The only routes to the content are "Read its full text" (an external IPFS gateway, with a privacy warning) and "See it on Cardanoscan"; in this test both opened "Page not available", so the tester couldn't learn what any proposal is about.
- The Treasury withdrawal pages show neither the amount nor the recipient addresses, though the tooltip says the action pays "to the addresses it names"; in the tester's words, "I would not trust myself to vote Yes on a Treasury withdrawal from this wallet".
- On detail pages Back is at the top and leaves view once you scroll down to the Vote buttons; the tester had to scroll up several times to navigate back.
- The review names the action only as "Info action", a type rather than an identifier, which is ambiguous when there are several; the action ID appears only in "Transaction details", under "Governance": "Votes yes as a DRep 53fbef383305…7de056#0".
- "Signed 2 signatures, not sent yet" appeared before pressing Cast, and the wallet never asked for a password; it made the tester "a bit uneasy about when signing actually happens", though "not sent yet" and "Nothing is sent until you press Cast Yes vote" reassured them. They had expected a password prompt before signing or sending.
- The type tooltips are good plain-language explanations, but of the category, not of the specific proposal. The wallet is honest about missing data (it says plainly there's no title or summary and that the full text is "written by whoever proposed it") and warns that the IPFS gateway (Blockfrost) sees your IP.
- Each detail page shows the proposer's deposit (1,000 ₳), the voting deadline with its epoch, the proposal epoch, the current vote, and a copyable action ID and IPFS address. The Vote section's Yes / No / Abstain are clear, with "Every vote is public and stays on chain for good, even one you replace before voting closes…". The review is clear about cost and timing: "Network fee 0.173333 ₳", "Public account after 10,407.840703 ₳", "It takes about a minute for the network to confirm".
- The "Your DRep" section is informative (status and expiry, voting power, deposit, a note about staying active); its "Profile None" wasn't relevant to the task.
- Screen-reader names matched the visible labels; the "What this means" (i) icon has no visible text but gives a helpful tooltip on hover.
- Abandonment moments: step 17 ("I don't understand what this means", severity 4 of 5): with all 7 proposals saying "Koios has no title or summary for it" and both outside links showing "Page not available", "this is where I would have stopped and not voted"; the tester carried on only to test the rest of the flow, adding that part of this is a harness limit, "but even inside the wallet there is no description at all". Step 14 ("I might lose money", severity 3): the Treasury withdrawal page asks for approval of a treasury payout without showing the amount or the recipient: "I would never vote Yes on that from this screen."

**Answers the task asked for.**

| Question | Tester's answer from the UI | Verifier's check |
|---|---|---|
| Could I find a proposal? | Yes: Public tab → "Staking and governance" → "Governance actions" lists 7 open actions (5 Info actions, 2 Treasury withdrawals), all "Not voted". Sureness High | Correct. |
| What is the chosen proposal about? | Only that it is an "Info action" which "asks DReps, stake pools and the constitutional committee for their view: it changes nothing on chain, however the vote goes."; open until 22 Oct 2026 (epoch 320), proposed in epoch 314, proposer's deposit 1,000 ₳; its subject unknown ("Koios has no title or summary for it", and the full text couldn't be opened here). High | Correct as a report of the screen, which showed exactly this. The subject was missing because the fixture's row had no title or abstract and the gateway was blocked; with that data from Koios, the heading would be the action's title and its abstract would show on the page. |
| Could I obtain enough information to make the decision? | No: no title, summary, rationale, amounts or recipients for any of the 7; the only path to the content is an external IPFS link (and Cardanoscan), which showed "Page not available"; a careful DRep could not decide from what the wallet shows. High | Partly. True of this run, but the cause is the fake data: when Koios supplies them, the wallet shows an action's title, its abstract (up to 2,000 characters), the date it was proposed and, for a treasury withdrawal, the amount and the recipient stake addresses. The "no rationale" part is real: only the title and abstract are requested, so motivation and rationale stay behind the full-text link. Whether a real title and abstract would be enough is unverifiable here. |
| Could I prepare a Yes vote? | Yes: "Yes" opens "Review: your vote" with the DRep, "Info action", "Yes", "Network fee 0.173333 ₳", "Public account after 10,407.840703 ₳" and "Cast Yes vote"; Transaction details confirm "Votes yes as a DRep 53fbef383305…7de056#0". High | Correct; the vote was not cast. |

**Verifier notes.**
- Recommended result: BLOCKED for the information question, with the vote preparation counted as a pass with real friction. The tester's PASS WITH FRICTION sits beside their own statement that the goal of understanding the proposal was never met, and that failure came from the fakes and the harness.
- Harness: the fixture's proposal rows have no title, abstract, withdrawal or proposal date, all of which this build requests and displays. Hence every action fell back to its type with "Koios has no title or summary for it", both treasury withdrawals lost their "Amount" and "To" rows (and the list rows their amount), and the rows said "proposed in epoch N" instead of a date. A real user sees each action's title (as its list row and heading) and its abstract wherever Koios has read the anchor; only actions Koios has no text for look like this run. The type-only list rows and the review's "Info action" are the real fallback for an untitled action; the data made them universal here.
- Harness: the IPFS gateway and Cardanoscan were blocked. A real user gets a new tab with the anchor file from Blockfrost's gateway (usually the proposer's CIP-108 JSON with title, abstract, motivation and rationale, shown as raw JSON) or Cardanoscan's preprod page for the transaction that made the proposal (not a page for the action itself). Whether these particular documents resolve is unverifiable.
- So the severity-4 and severity-3 abandonment moments are not product findings. A DRep vote never moves the voter's own funds; the network fee is the only cost.
- Real: governance is reachable only from the Public tab's "Staking and governance" row, and "Governance actions" is below the fold (not quite at the bottom: "Edit profile" and "Retire" rows sit under it). The staking page also opened about 113 px down, because Home had been scrolled.
- Real: the header's Back isn't sticky and screens keep the previous scroll position, so detail pages opened from the scrolled list arrived at their bottom with the title, the type and Back off screen, and the review opened 66 px down. The verifier adds that the browser's Back, Alt+← and a mouse back button all work as the screen's Back, which the tester never tried. The count of failed Back clicks is inflated because the tester sent several commands per turn: after a Back failed, the queued list clicks and scrolls failed too.
- Real: "Koios" is never explained on the staking or governance screens (only error messages introduce it as the service the wallet reads Cardano from).
- Real: the review names an untitled action only by its type. Exists-not-found: hovering "Info action" on the review shows the full gov_action1… ID as a native tooltip, but nothing hints at it, so in practice it is hidden.
- Real and intended for an unlocked wallet: signing at review without a password. The two signatures are the payment key and the DRep key, and nothing is sent until "Cast Yes vote".
- Starting-state effects, not defects: the DRep's "Profile None" (the override registers no profile) and "Not voted" on all seven actions (the fixture's fixed vote list).
- Money check: nothing was submitted and no funds moved. The wallet had built, signed and kept unsent transaction aa3cf8dc…13a3bb27 (408 bytes, 2 signatures): one 3 ₳ UTxO in, one 2.826667 ₳ change output, a 0.173333 ₳ fee, and a Yes vote as the account's own DRep on 53fbef38…#0. "Public account after 10,407.840703 ₳" was only a projection.
- Prior knowledge: none seen. The tester tried Public only after finding nothing on Private, and relied on the general knowledge that info actions change nothing on chain only after the wallet's own tooltip had said so.

**Final result.** The tester found the governance actions and prepared a Yes vote up to "Cast Yes vote", but could not learn what any of the seven proposals does and, as a DRep who refuses to vote without understanding, would have stopped. The verifier attributes that gap to proposal data missing from the fixture and to blocked outside pages, and recommends BLOCKED for the information question, while keeping the real friction in finding the actions, navigating back from detail pages and identifying the action on the review.

### T14r · Understand and vote on a governance proposal (rerun with proposal metadata)

**Test notes.** Surface: a full browser tab, 1280x720. Starting state: the funded wallet, unlocked, on Home's Private tab (28 ₳ private; 10,408.014036 ₳ public; staked with LOGIC), with the "drep" override: the account is its own registered DRep (active until epoch 340, voting power 10,408.014036 ₳, 1 delegator, 500 ₳ deposit, no profile) and its vote is "Delegated to Your own DRep"; the task text gave the wallet password. The tester saw the scenario and goal, not the task title, and the note "Prepare the vote up to the point of confirming it; you may stop there." The task text, surface, starting state and note are T14's, given to a fresh tester; the one change is the harness's `proposals` override, used for T14r only. In T14 the fixture's recorded preprod proposal list had no title or summary for any of its seven actions (Koios hadn't read their anchors when it was recorded), and no proposal dates or treasury withdrawal amounts and recipients. Here the override gives six of the seven actions a title and an abstract written for the test in the shape of mainnet CIP-108 metadata, the date each was proposed (from the preprod epoch schedule) and, for the two treasury withdrawals, the amount and the recipient stake address; action 6056be57…#0 keeps no metadata, as the real fallback. It also serves the matching CIP-108 JSON documents at the Blockfrost IPFS gateway that "Read its full text" opens, where T14 got a "Page not available" placeholder. The texts are synthetic: what's under test is the wallet's presentation, not the proposals. Cardanoscan still opens the placeholder (BUILDER-NOTES limitation 6); the tester didn't open it. "Not voted" on every action comes from the fixture's fixed vote list, and the proposer's deposit (1,000 ₳) from the recorded fixture. The network never confirms in this task (not reached). This rerun includes the harness fix for "Details" toggles; none was involved.

**Result.** PASS WITH FRICTION · confidence High · 1 wrong turn · 10 navigation steps · prior product knowledge needed: yes, finding voting meant knowing or guessing that a DRep is a public on-chain role, to look on the Public tab under "Staking and governance", and reading the full text meant reading raw JSON, which assumes some technical comfort. Verifier: same result; the friction is product behaviour, and the parts that depend on the harness (the synthetic metadata's empty authors list, forum link and test action, and one scroll command's targeting) don't change it.

**Path taken.**
1. Ran stop, then start → the wallet's tab opened on the Private tab: "Private balance 28 ₳", Receive / Send / Make public / Create, Tokens (one row, "asset1synt…ctusdm", "Calls itself tUSDM, not on the wallet's list"), dApps, Activity, and the banner "Test network: ADA here has no value."
2. Took a screenshot and scrolled down the Private home → only UTxOs and the footer "Seedelf Wallet 1.1.0 · Preprod"; nothing about voting or governance (wrong turn).
3. Clicked "Public" → "Public account 10,408.014036 ₳", "Includes 57.475311 ₳ of staking rewards" and a card "Staking and governance" "Staking with LOGIC" "Voting power: Your own DRep".
4. Clicked the "Staking and governance" card → "Your pool" LOGIC · Logical Mechanism with "Pool details" and "Change pool", "Rewards 57.475311 ₳" with "Withdraw rewards", "Voting power" "Delegated to Your own DRep" with "Change who votes for you", and the heading "Your DRep" at the bottom.
5. Scrolled down 400 px → "Status Active until 30 Jan 2027 (epoch 340)", "Voting power 10,408.014036 ₳", "Delegators 1", "Profile None", "Deposit 500 ₳", the DRep ID and a large teal "Governance actions" button.
6. Clicked "Governance actions" → a list of open actions, each with a title, its type, the voting deadline, a short ID, the date proposed and "Not voted": "Signal: agree an annual treasury budget before any withdrawals", "Poll: should stake pools publish a monthly uptime report?", "Treasury withdrawal: 450,000 ADA for an open-source light-wallet SDK" ("Treasury withdrawal · 450,000 ₳ · Open until 22 Oct 2026 (epoch 320)", "322066e8…#0 · proposed 18 Sept 2026"), "Info: lower the minimum pool cost from 170 to 100 ADA?" and "Treasury withdrawal: 1,200,000 ADA for independent security audits".
7. Scrolled down 400 px → the last two of the seven: one titled only "Info action" ("Open until 12 Oct 2026 (epoch 318)", 6056be57…#0) and "Test action, please ignore" (375f7ed7…#0).
8. Clicked "Treasury withdrawal: 450,000 ADA for an open-source light-wallet SDK" → the detail page opened about 360 px down: "Voting Open until 22 Oct 2026 (epoch 320)", "Proposed 18 Sept 2026, in epoch 314", "Proposer's deposit 1,000 ₳", "Your vote Not voted", the abstract, "Read its full text" with a note about the IPFS gateway, the Action ID, "Its full text" ipfs://QmZeFp…, "See it on Cardanoscan" and the Vote section's "Yes" / "No" / "Abstain"; the title and the Type, Amount and To rows were above the visible area.
9. Scrolled up 600 px → the top: the title, "Type Treasury withdrawal", "Amount 450,000 ₳", "To stake_test1uzxtunq2mn0rl667zg4f87q7lcw229njv3qauu0rh62adwqwdnk4t" and a small (i) beside the title.
10. Hovered the (i) by the title → "A treasury withdrawal pays ADA out of Cardano's treasury, the fund that fees and new ADA flow into, to the addresses it names, once enough DReps and the constitutional committee vote yes."
11. Read the note under "Read its full text" ("It opens in a tab through the IPFS gateway Blockfrost runs: Blockfrost sees your IP address ask for it, and your browser keeps it in its history."), then clicked "Read its full text" → a new tab (window 2) with the raw CIP-100/CIP-108 JSON: the title, abstract, motivation and rationale, "authors": [] and one reference, "Budget and milestones", pointing to forum.example.org.
12. Closed the JSON tab → back on the detail page.
13. Scrolled down 500 px → the Vote section's "Yes" / "No" / "Abstain" and "Every vote is public and stays on chain for good, even one you replace before voting closes: anyone can see how your DRep voted, and that it's your public account's."
14. Clicked "Yes" → "Review: your vote": "Nothing is sent until you press Cast Yes vote", "Your DRep drep1y2e20afmrjh…2egjc8", "Governance action Treasury withdrawal: 450,000 ADA for an open-source light-wallet SDK", "Your vote Yes", "Network fee 0.173333 ₳", "Public account after 10,407.840703 ₳", two privacy notes, "It takes about a minute for the network to confirm." and a big "Cast Yes vote".
15. Clicked "Transaction details" → the dialog "The transaction": "Spends 1 UTxO", "Pays 1 output" (2.826667 ₳ to addr_test1qq8ac7qq…qkt5dmn, "#0 · a key that stakes", which the tester took to be their own address), "Network fee 0.173333 ₳", "Signed 2 signatures, not sent yet".
16. Scrolled inside the dialog (the first try, aimed at "The transaction", matched two texts; the second, over "Spends 1 UTxO", worked) → "Governance" "Votes yes as a DRep" "322066e8333d…c3ca79#0", matching the list's 322066e8…#0.
17. Closed the dialog → back on the review; stopped there without pressing "Cast Yes vote", as instructed, and ran stop.

**Wrong turns.**
- Step 2: looked for voting or governance on the Private home, where the wallet opened, and scrolled through it, expecting a Governance or Vote entry beside dApps / Activity / UTxOs; nothing on the Private side related to governance; corrected by guessing that DRep voting belongs to the public on-chain account and switching to "Public", where the "Staking and governance" card showed "Voting power: Your own DRep".

**Hesitations.**
- Step 2: with nowhere to vote on the Private home, the tester had to choose between Settings, dApps and the Public tab; they chose Public on a hunch, because a DRep is a public on-chain role.
- Step 4: the card is called "Staking and governance", but its page opens with pool and rewards information; "Governance actions" appears only after scrolling about 400 px, at what the tester took to be the very bottom of the "Your DRep" section.
- Step 7: choosing a proposal: one entry is titled just "Info action", with no subject, and another "Test action, please ignore"; the tester skipped both and picked the 450,000 ADA treasury withdrawal because it had a concrete title.
- Step 8: the detail page opened mid-page, seemingly keeping the list's scroll position, so the first things in view were "Voting", "Proposed" and "Proposer's deposit", with no title or amount above them; for a moment the tester wasn't sure which proposal they had opened, and scrolled up to check.
- Step 11: "Read its full text" came with a warning that Blockfrost would see their IP address and the browser would keep it in its history; they hesitated over the privacy cost, then clicked because they insisted on understanding the proposal.
- Step 15: "Signed 2 signatures, not sent yet" surprised the tester: the wallet had already signed without asking for their password. It still said it wasn't sent, but it made them look twice.

**Observations.**
- Abandonment moment the tester recorded: step 2 ("I don't know what to do", severity 2): the wallet opened on the Private tab with no governance entry, and a user who doesn't think to try the Public tab might decide the wallet can't vote.
- Finding it: the tester expected a top-level "Governance" or "Vote" entry on Home. Governance is only on the Public tab, inside the "Staking and governance" card, and nothing on the Private side points there; the card's page opens with pool and rewards, and "Governance actions" sits below the fold under "Your DRep", after a 400 px scroll past pool, rewards and delegation details. Understandable once found, but grouped under staking and hidden on the Public side.
- The list shows each action's type, amount, deadline and whether you have voted, at a glance. Two entries didn't help choose: one titled only "Info action", which gives no subject, and "Test action, please ignore". Where the tester expected "Proposal" they found "Governance action" and "Info action", standard Cardano terms. The chevrons sit at a different horizontal position on each row, following the width of the text, which looked unpolished.
- The detail page opened scrolled about 360 px down, with the title, type, amount and recipient above the visible area, so the tester had to scroll up to confirm which proposal they were reading.
- Once at the top, the page gave a usable summary inside the wallet, in a clear key-facts table: "Type Treasury withdrawal", "Amount 450,000 ₳", the recipient stake address, voting open until 22 Oct 2026 (epoch 320), proposed 18 Sept 2026, "Proposer's deposit 1,000 ₳", "Your vote Not voted", then the abstract. The (i) tooltip explains in plain language what a treasury withdrawal is and when it takes effect.
- Full text: the tester expected the wallet to show the proposal's motivation and rationale on the detail page; it shows only the one-paragraph abstract. "Read its full text", a label that suggests a readable document, opens the raw CIP-108 JSON in a new tab through Blockfrost's IPFS gateway, and the motivation ("Mobile wallets each rebuild the same transaction-building and syncing code. A shared, audited SDK would cut that cost and the bugs that come with it.") and rationale ("The team has shipped two wallet libraries before. Milestone payments through an administrator mean unfinished work is not paid for, and any ADA left at the end goes back to the treasury.") appear only there. The JSON's "authors": [] and its one reference, a forum.example.org link, left the tester unable to learn who proposed it, and the wallet doesn't show the proposer either.
- Trust: the warning under "Read its full text" raised the tester's trust, though it also made them hesitate; the privacy notes on the Vote section and the review ("Every vote is public and stays on chain for good…", "A DRep is public, and it's paid for from your public account, so anyone can tie the DRep, and every vote it casts, to that account.") felt honest and informative.
- Clicking "Yes" opens a review rather than casting: it says plainly "Nothing is sent until you press Cast Yes vote", the final button repeats the choice ("Cast Yes vote"), and the fee and "Public account after" are shown. In "Transaction details", the action ID 322066e8…#0, the same as in the list, reassured the tester that the vote was for the proposal they had read, and they saw that the only output (2.826667 ₳) went back to their own address.
- Signing: the tester expected signing to happen on the final Cast button, perhaps with a password prompt. The wallet asked for no password on the way to the review, and "Transaction details" already said "Signed 2 signatures, not sent yet"; submission happens on "Cast Yes vote".
- Screen-reader names differ from the visible labels in places: the copy button for "Its full text" (the IPFS URI) is announced as "Copy the address" but shows only "Copy"; otherwise the list entries' visible text matched their full names. The "Your DRep" section's "Profile None" was noticeable but not relevant to the task.

**Answers the task asked for.**

| Question | Tester's answer from the UI | Verifier's check |
|---|---|---|
| Can I find a proposal? | Yes: Public tab → "Staking and governance" → scroll → "Governance actions" lists 7 open actions, all "Not voted" (sureness High). | Correct. That is the only route: the Public tab's "Staking and governance" row, then "Governance actions" in the "Your DRep" card. The list held 7 open actions, all "Not voted" (the fixture's vote list). |
| What is the chosen proposal about? | The abstract: "Requests 450,000 ADA from the Cardano treasury to fund twelve months of work on an open-source (Apache-2.0) light-wallet SDK for mobile apps. The ADA goes to the administrator's stake address in this action and is released to the team in four milestones, each checked by an independent auditor."; Type Treasury withdrawal, Amount 450,000 ₳, To stake_test1uzxtunq2mn0rl667zg4f87q7lcw229njv3qauu0rh62adwqwdnk4t; open until 22 Oct 2026 (epoch 320), proposed 18 Sept 2026 (epoch 314), proposer's deposit 1,000 ₳; the JSON full text adds the motivation (a shared, audited SDK cuts duplicated code and bugs) and the rationale (the team has shipped two wallet libraries before, and unpaid or leftover ADA returns to the treasury) (High). | Correct: the screen showed exactly these values and the abstract as quoted, and the anchor JSON has the motivation and rationale as summarised. The texts are the harness's synthetic metadata; the deposit comes from the recorded fixture. |
| Can I obtain enough information to make the decision? | Mostly yes: the in-wallet summary and the tooltip explain what the action does and its effect; the motivation and rationale are only in raw JSON in an outside tab, behind an IP privacy warning; the authors list is empty and the proposer isn't identified (Medium). | Correct; this matches the product. The wallet shows the title, type, amount, recipient, voting window, proposed date, deposit, your vote, the abstract and the type tooltip behind the (i). The full text is only a link to Blockfrost's IPFS gateway, which the wallet never fetches or renders (it reads only the title and abstract). There is no proposer or return address, and no vote tally. The empty authors list belongs to the synthetic test document, not the wallet. The tester didn't use "See it on Cardanoscan", a placeholder in the harness. |
| Was a Yes vote prepared? | Yes: the review shows "Your vote Yes", "Network fee 0.173333 ₳" and "Nothing is sent until you press Cast Yes vote"; Transaction details show "Votes yes as a DRep 322066e8333d…c3ca79#0"; not cast (High). | Correct. A signed vote transaction, ba2ce78a…04e63256, voting Yes as the DRep on 322066e8…#0 (the 450,000 ₳ action) with a 0.173333 ₳ fee, was built and held in the worker's session; "Cast Yes vote" was never pressed and nothing was submitted. |

**Verifier notes.**
- Real: the step 2 wrong turn and abandonment moment. Home opens on the Private tab when no tab has been kept, and the Private side holds nothing on staking or governance; the only way in is the "Staking and governance" row on the Public tab, and neither Settings nor the dApps page links to Governance actions. The Staking page opens on its overview or its vote section, with no direct route to Governance actions, and every "Governance actions" button is inside the "Your DRep" card. The Public tab is one click away at the top of the Private home, but nothing on the Private side names governance or points to it.
- Real, with a small misread: "Governance actions" is below the fold, but it isn't the last thing in the "Your DRep" card: the Profile and Retire rows follow it (the view said about 348 px more below). The Staking page had also opened 113 px down, carried over from Home, so from the top of the page the button is about 1,190 px down.
- Real: no screen resets its scroll position, and the governance list and the detail page are drawn as the same screen, so the detail page opened at the list's offset, about 363 px down, with the title, amount and recipient hidden. The harness didn't cause it: the clicked row was already in view, so the click didn't scroll. The same carry-over shows on the Staking page (113 px) and on the vote review (86 px). The list itself opened at the top only because it renders empty until Koios's proposal list answers.
- Real: the wallet reads only the title and abstract from Koios; an action's full text is a link the user opens in a tab, which the wallet never fetches, on Blockfrost's gateway (https://ipfs.blockfrost.dev). A real user gets the same raw CIP-108 JSON from the real gateway; the harness served a synthetic document at that URL, which displays the same way.
- Harness: the proposal content is synthetic. The six titles and abstracts and the anchor documents were written for the test, including "Test action, please ignore", "authors": [] and the forum.example.org reference, so the tester's "couldn't learn who proposed it" partly rests on the test document. A real CIP-108 document may name its authors, though the wallet wouldn't show them either way. The wallet only shows the title it is given: judge the presentation, not the content.
- Real: the wallet never shows the proposer. It doesn't ask Koios for the proposal's return address (the proposer's deposit-return stake address), its detail rows are Type, Amount, To, Voting, Proposed, Proposer's deposit and Your vote, and it never reads the anchor's authors. The only route to more inside the product is "See it on Cardanoscan", which opens the transaction that made the proposal; the tester didn't click it, and in the harness it would open the "Page not available" placeholder. In real use it is one more source for the "enough information" question, such as the proposal transaction and its return address.
- Real: an entry titled only "Info action" is the wallet's fallback when Koios has no title for an action: the type becomes the title and drops out of the second line. The harness left 6056be57…#0 without metadata on purpose, to mirror that fallback; its detail page would show "Koios has no title or summary for it…", but the tester didn't open it.
- Real: the misaligned chevrons. The governance rows reuse the three-column menu row built for an icon, a label and a chevron, but have no icon, so the text takes the first column and each chevron lands right after its text. Home's rows, which have the icon, line up.
- Real: the "Copy the address" button (shows "Copy") beside the IPFS URI. The visible "Copy" is part of the accessible name, so label-in-name holds; calling an IPFS URI "the address" matches the wallet's "at the address below" wording for actions with no text, but in a wallet "address" may read as a payment address.
- Real, by design: signing at review without a password. The vote is signed with the payment key and the DRep key (the 2 signatures), "not sent yet" is said on purpose, and "Cast Yes vote" only submits it. The wallet asks for no password for its own transactions while unlocked; the password setting applies only to signing for sites.
- Real: the tester was right that the only output is change to their own address, but the dialog doesn't say so: it labels the output only "#0 · a key that stakes", with no mark that it is the user's own. The tester probably worked it out from "Public account after" being the balance minus the fee.
- Starting-state effects, not defects: "Profile None" is the right display for a DRep with no anchor (the harness's drep override registers none); the proposer's deposit (1,000 ₳) and "Not voted" on all seven actions come from the recorded fixture. All of it was shown faithfully; none of it was checked against the chain.
- Harness effects that didn't change the findings: the scroll command aimed at "The transaction" matched both the dialog's title and a section heading inside it with the same words, which cost one extra command (a real user scrolls the dialog with the wheel to the same Governance section; the repeated heading is real product wording, harmless here); the view printed the JSON page as one line cut off at "…abst…", so the tester read the motivation and rationale from the screenshot (a real user sees the whole document on one screen at 1280x720); instance.log's "unknown override proposals" is log noise, as the overlay was installed and served the 7 rows and the anchor.
- Money check: nothing was submitted and no funds moved; the tester never pressed "Cast Yes vote". The wallet had built, signed and kept unsent transaction ba2ce78a…04e63256 (408 bytes, 2 signatures, valid until slot 135560643): one 3 ₳ public-account UTxO in, one 2.826667 ₳ change output to the account's own base address, a 0.173333 ₳ fee, no deposit, rewards withdrawal or tokens, and a Yes vote as the account's own DRep on 322066e8…#0, the 450,000 ₳ treasury withdrawal. Cast, it would have cost only the fee: "Public account after 10,407.840703 ₳" is 10,408.014036 − 0.173333. The balances stayed at 28 ₳ private and 10,408.014036 ₳ public.
- Prior knowledge: none of the product seen; every control the tester clicked was named in the view just before, and they went nowhere hidden. They openly used general Cardano knowledge twice: guessing that DRep voting lives with the public account (the Public tab was one of only two visible tabs), and knowing CIP-108's fields, which made the raw JSON readable (the JSON's own @context names CIP-100 and CIP-108 on screen). "DRep" came from the task text. The CIP-108 knowledge is a real advantage over a typical user: reading the full text would cost a less technical user more.

**Final result.** The tester found the governance actions on the Public tab under "Staking and governance", read the 450,000 ₳ treasury withdrawal's in-wallet summary, its type tooltip and its raw CIP-108 full text, and prepared a Yes vote up to "Cast Yes vote" (fee 0.173333 ₳), judging the information mostly enough, short of who proposed it. PASS WITH FRICTION from both: the friction (governance only on the Public tab and below the fold, the detail page opening mid-scroll, the full text only as raw JSON, no proposer shown) is product behaviour, while the empty authors list and the test action belong to the synthetic metadata.

### T15 · Connect a dApp publicly

**Test notes.** Website surface: the harness's test site, Example Market (https://dapp.example), active in a 1280x720 tab, with the wallet's side panel open as a separate 360x640 window the tester had to switch to (in real Chrome it sits docked beside the page); the wallet's connect popup opens as a 400x605 window. Starting state: funded and unlocked, with two public accounts (Account 1: 10,408.014036 ₳ including 57.475311 ₳ of staking rewards; Account 2: 0 ₳), 28 ₳ private, and "The account sites use" set to Account 1. The wallet's sites switch was at its product default, off (T16 and T17 started with it on). Chrome's access to https sites was granted at install, standing in for the permission prompt a real user accepts when turning the switch on, so no prompt appeared. This was a pilot run, made before the post-pilot harness changes: the test site did not yet reconnect after a reload (so the "Not connected." at step 22 is the site's doing), and the pilot prompt headed the task with its title, "Connect a dApp publicly", which adds nothing to the task text's "Connect using the ordinary public account". The tester was told not to wait for confirmations; nothing was submitted.

**Result.** PASS WITH FRICTION · confidence High · 2 wrong turns · 17 navigation steps · prior product knowledge needed: no, the wallet's text was enough to find the Sites switch and the account rule, though general browser-wallet knowledge (a page may need a reload to see a newly enabled wallet) got the tester past step 12.

**Path taken.**
1. Ran stop, then start → Example Market: "Not connected.", a "Connect wallet" button, "Sign in with wallet" and "Buy item - 15 ADA" disabled.
2. Clicked "Connect wallet" → the site's "Choose a wallet" dialog: "No Cardano wallet was found on this page.", with only Cancel (wrong turn).
3. Clicked Cancel and switched to the side panel → Home on the Private tab, "Private balance 28 ₳", with a header dropdown "Public account" showing "Account 1".
4. Opened the header "Public account" dropdown → it listed Account 1 and Account 2, so the wallet has two public accounts.
5. Pressed Escape and clicked the "Public" tab → "Account 1 10,408.014036 ₳", "Includes 57.475311 ₳ of staking rewards"; nothing about sites or connections.
6. Clicked the Settings gear → Network, then Wallet ("Public accounts", "Contacts", "Collateral"); nothing about sites above the fold.
7. Scrolled down 400 px → Preferences ("Language", "Open Seedelf Wallet in"); still nothing about sites.
8. Scrolled down 450 px more → "Sites and mixing", with the row "Sites" / "Off: sites can't see Seedelf Wallet", which explained the empty wallet list.
9. Clicked "Sites" → the switch "Let sites connect to Seedelf Wallet" (off) and "The account sites use" set to Account 1, with "Connected sites always use this account, whichever one you're working on, so switching accounts never shows a site a second account of yours."
10. Scrolled down → "Ask for your password to sign for a site" (on) and a "Connected sites" button.
11. Turned on "Let sites connect to Seedelf Wallet" → the text became "Sites find Seedelf Wallet as a Cardano wallet and can ask to connect." followed by the privacy warning; no Chrome permission prompt appeared.
12. Switched to the site and clicked "Connect wallet" again → still "No Cardano wallet was found on this page."; nothing had said a reload was needed (wrong turn).
13. Clicked Cancel, reloaded the page (F5), clicked "Connect wallet" → the dialog now listed a "Seedelf Wallet" button.
14. Clicked "Seedelf Wallet" → the popup "Connect a site": dapp.example / Example Market, "Choose what the site sees" with "Your public account, Account 1" and "A private session"; Connect disabled.
15. Clicked the (i) "What this means" → it added one line: "You can disconnect it in Settings, under Connected sites."
16. Selected "Your public account, Account 1" and scrolled down → Connect enabled; bullets appeared, including "It gets Account 1: sites always use the account Settings → Sites chooses, whichever one is on screen."
17. Scrolled to the bottom and clicked "Connect" → the popup briefly showed "Nothing's waiting." and closed; the site showed "Connected to Seedelf Wallet", addr_test1qq...mqkt5dmn and "10,350.538725 ADA and 6 tokens".
18. Clicked "Show full address" on the site → the full address, starting addr_test1qq8ac7qq and ending mqkt5dmn.
19. Switched to the side panel and opened "Connected sites" → "dapp.example" listed as "Your public account", with its date and a "Disconnect" button; no account named.
20. Home → Public tab → Receive → "Into Account 1, your public account", with an address matching the site's.
21. Changed the header "Public account" dropdown to Account 2 → Home showed "Account 2" and "0 ₳".
22. Switched to the site and reloaded (F5) → the site showed "Not connected." again.
23. Clicked "Connect wallet" → "Seedelf Wallet" → reconnected at once with no popup, still with Account 1's address (…mqkt5dmn) and 10,350.538725 ADA.
24. Ran stop.

**Wrong turns.**
- Step 2: clicked "Connect wallet" on the site, expecting a wallet list with Seedelf Wallet in it, or a wallet popup; got "No Cardano wallet was found on this page.", with no hint from the wallet that site access was off; corrected by going to the wallet and searching Settings until "Sites" / "Off: sites can't see Seedelf Wallet" turned up, about 850 px down.
- Step 12: clicked "Connect wallet" straight after turning Sites on, expecting the wallet to be found; got the same "No Cardano wallet was found on this page."; corrected by reloading the page on a guess, since the wallet's Sites text never says a reload is needed.

**Hesitations.**
- Step 3: the header said "Public account" / "Account 1" while the Private tab and "Private balance 28 ₳" were showing; the tester wasn't sure which side they were on, or whether the header dropdown decides what a site gets.
- Step 6: nothing on Home mentions sites or connections; the tester didn't know where a site-access setting would live and guessed Settings.
- Step 11: the switch's text warns that every https site can see that you use Seedelf Wallet; the tester paused before accepting that.
- Step 14: the popup offered "Your public account, Account 1" with no way to pick Account 2; for a moment the tester wondered whether they would get a choice.
- Step 17: the site's 10,350.538725 ADA differed from the wallet's 10,408.014036 ₳ for Account 1, which made the tester doubt it was the same account until they saw the gap equals the 57.475311 ₳ of staking rewards and the addresses matched.

**Observations.**
- Abandonment moments the tester recorded: step 2 ("This seems broken", severity 4): with the wallet installed, unlocked and open beside the site, a normal user might decide it doesn't support dApps, or is broken, and leave; the tester went on only because they thought to dig through Settings. Step 12 ("This seems broken", severity 3): some users would give up here rather than think to reload.
- Site access is off by default and the site can't say why. The setting is about 850 px down Settings, under "Sites and mixing", grouped with Lovejoin mixing; neither Home nor the Public tab mentions it. The tester had expected an installed wallet to show up for dApps automatically, like other Cardano wallets.
- After the switch is on, nothing in the wallet says to reload open pages. The off-state text says turning it on "asks Chrome to let the wallet add itself to https sites", yet no Chrome prompt appeared, which the tester put down to the test setup.
- The connect popup read clearly: two cards, nothing pre-selected so Connect stays disabled until a choice, and the account named in the visible card title, not only for screen readers. "Nothing happens until you choose, and press Connect or Review", "No fee" and "Nothing is signed without you." made the tester feel safe.
- The line that answers "which account?" appears only after choosing the public option, and below the fold; "What this means" added only the disconnect line. The popup can't change the account: using Account 2 would mean Cancel, changing "The account sites use" in Settings → Sites, and connecting again. Settings → Sites states the rule and its reason clearly.
- The header dropdown labelled "Public account" is on every screen and looks like the active-account control (the tester expected it, or a choice in the popup, to decide what sites get), but it doesn't: after switching it to Account 2 the site silently kept Account 1, and nothing on Home shows which account connected sites see. It also shows the public account while the Private tab is open.
- The reconnect after the reload exposed Account 1 again with no popup or warning while Account 2 was on screen; it matched what the wallet had said beforehand, but left the tester a little uncomfortable.
- "Connected sites" says "Your public account" without naming which one, and the site's balance leaves out the staking rewards included in the wallet's headline, a gap the tester had to work out alone.
- Terminology: expected "Connected apps" or "dApp connector", found "Sites" (clear once found, but deep in Settings next to Lovejoin); expected an active-account control, found the "Public account" dropdown; "Choose what the site sees" read clearly.
- Screen-reader names said nothing the visible labels didn't, apart from the icon-only buttons (Settings, Lock, Open in tab, What this means). Worked well: Receive's "Into Account 1, your public account" with the full address let the tester check the site's address; Connected sites offers Disconnect.

**Answers the task asked for.**

| Question | Tester's answer from the UI | Verifier's check |
|---|---|---|
| Can the site be connected with the ordinary public account? | Yes, after turning on Settings → Sites → "Let sites connect to Seedelf Wallet" and reloading the site; the popup then offered "Your public account, Account 1" and Connect worked (sureness High). | Correct. In real Chrome the switch would also bring up Chrome's permission dialog, which the harness skipped. |
| Which account does the site get when there are several public accounts? | The one set in Settings → Sites → "The account sites use" (Account 1), not the one on screen, as the popup's bullet says; checked by switching the header to Account 2 and reconnecting (High). | Correct: the site's full address is Account 1's Receive address, and the reconnect with Account 2 selected still returned …mqkt5dmn. |
| Is that account selection obvious? | Partly: the card title names "Account 1", but the explanation appears only after choosing public, below the fold; the popup can't change the account; the header dropdown suggests it controls this but doesn't; Connected sites says only "Your public account" (High). | Correct on every fact; "Partly" is a judgement the evidence supports. |

**Verifier notes.**
- Harness: the missing Chrome permission prompt. A real user flipping the switch gets Chrome's own dialog (for https://*/* Chrome words it as access to all websites) and must press Allow; declining leaves the switch off with "Chrome wasn't allowed to let the wallet onto sites, so sites still can't connect." The harness took a step away, so real friction at step 11 is a little higher, not lower.
- Harness: "No Cardano wallet was found on this page." is the test site's wording; a real dApp would word it its own way, or just leave Seedelf Wallet out of its list. The cause is real: the switch is off by default as a deliberate privacy choice, which the preset kept.
- Harness: step 22's "Not connected." is the test site not restoring its connection on load. The wallet still had dapp.example connected, which is why the next connect returned at once with no popup; many real dApps reconnect silently on load. That silent reconnect is itself real, standard CIP-30 for an approved site, and the site already held Account 1's addresses, so nothing new was exposed.
- Real: a page already open must be reloaded before it sees the wallet; the wallet registers its scripts for new page loads only, and no wallet text mentions reloading.
- Exists-not-found: the off state is also shown outside Settings. Home → Private tab → scroll down → "dApps" opens a page with the callout "Off: sites can't see Seedelf Wallet." and a "Let sites connect" button that runs the same switch. The tester never scrolled Home, the Public tab has no dApps row, and the dApps page frames itself around private use ("Used privately, from one-time accounts"), so someone wanting a public connection has little reason to open it; it is no hint at the moment of failure either.
- Real: the rest checked out. The account bullet renders only once public is chosen; the popup has no account control by design (the account is chosen only in Settings → Sites); the header picker's tooltip says only which account you're working on; Connected sites stores no account name; the site's figure is CIP-30 getBalance, which counts UTxOs only (10,408.014036 − 57.475311 = 10,350.538725). "Nothing's waiting." is a real empty state shown for 800 ms before the popup closes.
- Framing: the scenario says the wallet has been used for some time, yet the switch was off, so step 2 measures a first dApp connection.
- Money: nothing moved. No transaction was built, signed or submitted; the site received only Account 1's addresses and its UTxO balance.
- Prior knowledge: none seen beyond the declared CIP-30 knowledge, and it was that knowledge, not the UI, that got the tester past step 12.

**Final result.** The tester connected Example Market with the public account and showed, by switching the header to Account 2 and reconnecting, that sites always get the account chosen in Settings → Sites. Both wrong turns came from real product behaviour (sites off by default, no reload hint); the verifier found no misreads and kept PASS WITH FRICTION.

### T16 · Connect a dApp privately

**Test notes.** Website surface: Example Market active in a 1280x720 tab, the wallet's side panel open as a separate 360x640 window, and the wallet's connect popup a 400x605 window. Starting state: funded and unlocked, one public account, 28 ₳ private. The wallet's sites switch was already on (set for T16 and T17 after the pilot), so the site found the wallet at once and the switch-and-reload steps T15 hit were not part of this run. The tester was told beforehand that an outside service refuses every request here, so after confirming the wallet may say nothing was sent, and not to count that as a wallet failure; they were also told not to wait for confirmations. In this environment a private session can never be funded: the fake giveme.my refuses every collateral request (builder limitation 1), so the task's end state (the funding wait and a connected session) was unreachable. Main-run trace: it predates the harness fix that lets a click reach the wallet's "Details" toggles, which is why the tester's first two attempts to open "Details" failed.

**Result.** BLOCKED · confidence Medium · 2 wrong turns · 8 navigation steps · prior product knowledge needed: no, the on-screen cards alone led to the private session, though its caveats and costs use terms the UI never explains (UTxOs, collateral, "Make public", Lovejoin, giveme.my).

**Path taken.**
1. Ran stop, then start → Example Market: "Not connected.", "Connect wallet" enabled, Sign in and Buy disabled, the item at "15 ADA + 0.25 ADA network fee".
2. Took a screenshot, then clicked "Connect wallet" → the site's "Choose a wallet" dialog with "Seedelf Wallet" and "Cancel".
3. Clicked "Seedelf Wallet" → the popup "Connect a site", "Choose what the site sees": "Your public account" ("The site sees its addresses, its balance and its UTxOs, and keeps what it saw. No fee.") and "A private session" ("The site sees only a new one-time account, funded from your private balance. A fee each way, 5 ₳ kept aside that comes back, and about a minute."); Connect disabled.
4. Clicked the small (i) beside "Connect a site" (screen-reader name "What this means") → one line: "You can disconnect it in Settings, under Connected sites."; nothing about privacy or the two options (wrong turn).
5. Clicked the "A private session" card → it expanded into a funding form: "A new one-time account, funded from your private balance with what you choose here. The wallet gives the site only this account.", a line about the dApps page and Lovejoin, a "What to put in it" ₳ field, "28 ₳ in your private balance. 5 ₳ more goes in, kept aside for the site's contracts, and comes back.", "Add tokens" and a disabled "Enter an amount".
6. Scrolled down 300 px → the full privacy note: "Your public account isn't in these transactions, but anyone, the site included, can follow the money back into your private balance, and money you made private yourself leads on to your public account. The site still sees this browser: if it has seen your public account here, it can tell the session is yours. A separate Chrome profile and a VPN keep them apart."
7. Typed 16 in "What to put in it" (enough for the 15 ADA item and its 0.25 fee) → the button changed from "Enter an amount" to "Review".
8. Clicked "Review" → the review opened scrolled to its bottom: "For the site" 16 ₳, "Kept aside for contracts" 5 ₳, "Network fee" 0.233208 ₳, "Change, back to your private balance" 3.766792 ₳, a note beginning "This payment links the private UTxOs it spends to the one-time account, as Make public does", "As it's sent, giveme.my is asked to lend the collateral.", a password field and a disabled Send.
9. Scrolled up → the top: "Review the funding", "A private session for dapp.example. Nothing is sent until you press Send", the hint "The site sees this account as an ordinary wallet, and it's yours to top up or bring back from the dApps page. The 5 ₳ kept aside comes back with it.", a "To" row reading Private session 1 and an "Account" row reading addr_test1qr3xfa…cs00h9ax.
10. Scrolled down and clicked "Transaction details", hoping to see what the site would see → a dialog "The transaction": a tx id, "Spends 1 UTxO", "Pays 3 outputs" (5 ₳ and 16 ₳ to the one-time address, and an address starting addr_test1wz…), a "Raw CBOR" tab; too technical for the tester (wrong turn).
11. Closed the dialog → back on the review.
12. Typed the password into "Your password, to send" → Send enabled.
13. Clicked "Send" → a red error: "Nothing was sent: something it spends may have changed since you reviewed it. Build it again: the new review takes a fresh one-time account.", with a collapsed "Details", "Build it again" and "Cancel".
14. Opened "Details" (the first two remote-control attempts didn't match it; the third did) → "giveme.my, which lends the collateral, refused this transaction: Transaction Fails Validation. Its UTxOs may have been spent since the review: refresh, then review it again."
15. Clicked "Build it again" → the review was rebuilt with the same amounts, the password field empty and Send disabled.
16. Switched to the website to see whether it was connected → still "Waiting for your wallet...", with Activity "14:02:38 enable() -> waiting...".
17. Ran stop, treating the outside service's refusal as the end of what the test can do.

**Wrong turns.**
- Step 4: clicked the (i) beside "Connect a site", expecting an explanation of the difference between the public account and the private session; got only "You can disconnect it in Settings, under Connected sites."; corrected by relying on the option cards' text.
- Step 10: opened "Transaction details" to see what the site would see, expecting a plain-language summary; got a raw technical view (tx id, UTxO references, full addresses, a CBOR tab); corrected by closing it and going on with the summary.

**Hesitations.**
- Step 3: briefly wondered whether "A private session" was the most private option there is or one of several; with only two choices, took it as the most private.
- Step 5: unsure how much to put in, since nothing suggested an amount; picked 16 ₳ from the shop's 15 ₳ + 0.25 ₳ price.
- Step 5: "coming back through Lovejoin, as Settings has it, adds Lovejoin's fees": the tester didn't know what Lovejoin is, or what "as Settings has it" means.
- Step 8: with 28 ₳ private and 16 + 5 + 0.23 spent, the tester expected about 6.77 ₳ left, but the change was 3.766792 ₳; they worked out that it spends one 25 ₳ coin and leaves the rest untouched, which nothing on screen says.
- Step 8: "giveme.my is asked to lend the collateral" named a third party the tester had never heard of; they didn't know whether it learns anything about them or charges anything.
- Step 13: unsure whether money had moved; "Nothing was sent" reassured, but the headline first blamed a change in the tester's own coins ("something it spends may have changed") before Details showed giveme.my refusing.

**Observations.**
- Abandonment moments the tester recorded: step 8 ("I don't understand what this means", severity 2): the linking note and the giveme.my line might stop a user who wants the most private option, unsure whether this is private at all and who giveme.my is. Step 13 ("This seems broken", severity 3): the expected refusal in this test, but a real user would see a failure on their first private connection.
- Discovery was immediate: the site's "Connect wallet" opened the wallet popup with exactly two choices, nothing hidden in menus. Connect stays disabled until a choice, and "Nothing happens until you choose, and press Connect or Review" reassured.
- The tester expected a private connection to be a toggle that hides the balance and addresses with no money moving. It is a payment from the private balance into a new one-time account (the chosen amount, plus 5 ₳ kept aside, plus a network fee), and the flow turns from Connect into "What to put in it" → Review → password → Send.
- Cost is vague at the point of choosing ("A fee each way", "about a minute"): the exact network fee (0.233208 ₳) appears only on the review, and the fee for the way back and Lovejoin's fees are never given.
- The privacy note's "anyone, the site included, can follow the money back into your private balance" read as contradicting the card's "The site sees only a new one-time account". The tester had expected the site could not link the session to them; the frank warnings were honest but made them doubt how private the session really is.
- Terms never explained: "Lovejoin", "Make public" (a feature the tester never saw), "UTxOs", "giveme.my", "collateral", "kept aside for the site's contracts" (understood as refundable, but not why a site needs it) and the "dApps page". An unknown third party in a private transaction lowered the tester's trust.
- The review opened at its bottom, showing the totals before what was being reviewed. The change didn't match the tester's arithmetic, and nothing said what happens to the rest of the private balance.
- The error's headline points at the user's own coins while the real cause sits under a collapsed "Details". After "Build it again" the review looked identical, although the error had said the new review takes a fresh one-time account.
- Worked well: the public/private choice up front, each with a one-line summary of what the site sees and costs; the 28 ₳ private balance shown in the form; a review that itemises every amount, including change, and names "Private session 1"; "Nothing is sent until you press Send"; "Nothing was sent" making clear no money moved; Details giving the real cause.
- The (i) icon shows no text; its screen-reader name is "What this means" ("Hide what this means" when open).

**Answers the task asked for.**

| Question | Tester's answer from the UI | Verifier's check |
|---|---|---|
| How did you discover the private option? | The site's "Connect wallet", then "Seedelf Wallet": the popup "Connect a site" showed "Choose what the site sees" with two cards, "Your public account" and "A private session" (sureness High). | Correct; these are the connector's only two options. |
| What do you believe it costs? | The card's "A fee each way, 5 ₳ kept aside that comes back, and about a minute."; the review's 0.233208 ₳ network fee for the funding; presumably another fee to bring the money back, plus Lovejoin's fees (amount not shown) if it comes back through Lovejoin; the 5 ₳ is not a cost (Medium). | Correct. The way back's network fee shows only on the session's Bring it back review (dApps page). Returns through Lovejoin are on by default: spare ADA comes back in 10 ₳ boxes, at about 3.5 ₳ of mixes per box at the default depth plus about 0.3 ₳ per box to bring it back, and hours of waiting (not when the pool is below its floor or the return comes back directly). The connector shows none of these amounts. |
| What amount do you believe you are putting into it? | 16 ₳ for the site plus 5 ₳ kept aside, 21 ₳ into "Private session 1" (addr_test1qr3xfa…cs00h9ax); with the fee, 21.233208 ₳ leaves the 28 ₳ private balance, with 3.766792 ₳ change from the coin it spends (Medium). | Correct: one 25 ₳ UTxO spent, which would leave 6.766792 ₳ (3 ₳ untouched plus the change). It was never sent; the rebuilt review had the same amounts going to a new account, Private session 2. |
| What information will the website learn? | Only the new one-time account ("The wallet gives the site only this account", "The site sees this account as an ordinary wallet"), but anyone, the site included, can follow the money on chain back into the private balance, and money made private yourself on to the public account; the browser can tie the session to the public account if the site has seen it there (Medium). | Correct: through CIP-30 the site gets the one-time account's addresses, balance and UTxOs and can ask it to sign, and gets nothing of the public account or private balance. The "ordinary wallet" line came from a review hint that was open only because the tester had opened the connect screen's (i). |
| Was the private session created or connected? | No: the "Nothing was sent" error, Details naming giveme.my's refusal, and the site still at "Waiting for your wallet..." (High). | Correct; nothing was signed or submitted. |

**Verifier notes.**
- Harness: the refusal itself. The fake giveme.my refuses every collateral request and the wallet asks it for a collateral witness before signing, so nothing was signed or sent. A real user would have seen "Funding a private session", "Waiting for the network to confirm the funding of private session 1. It usually takes about a minute; the site connects once the money is there." and "You can close this window: the payment is sent, and closing doesn't undo it.", and the site would have connected once the funding was seen. The step 13 abandonment moment is harness-caused: a real first connection would fail here only if an input really changed after the review. Having been warned, the tester can't show how an unwarned user would read the headline.
- Harness: the two failed "Details" attempts. The view listed the disclosure toggle as a button, but the role selector couldn't reach it; a real user sees "▸ Details" and opens it with one click.
- Real: the headline deliberately names no service, and the wallet treats any giveme.my refusal as a stale review; the Details text says "refresh, then review it again" although the screen's only action is "Build it again".
- Real: any user lands at the bottom of the review. Choosing a private session scrolls the amount field to the centre, leaving the page about 469 px down, and the form and review share one scrolling page whose review scrolls at most 371 px.
- Exists-not-found: the rebuilt review was not identical. Its changed rows ("To" Private session 2 and a new "Account") sit at the top, out of view for the same reason; this comes from the code path, as no screenshot shows them.
- Real, with a nuance: the card and the note are both on screen as quoted, but the facts agree (the card says what the wallet gives the site, the note what the site can find out anyway); the conflict comes from "sees only" reading like a guarantee.
- Exists-not-found, all outside the connector, which links to none of them: the way back's cost (the session's Bring it back review on the dApps page; Settings → Lovejoin, "about 0.3 ₳ brings each box back" and each depth's mix cost); Lovejoin itself (Settings → Lovejoin, whose switch "Bring private sessions back through Lovejoin" is on by default, and the dApps page's Lovejoin tile); what giveme.my sees (Settings → Privacy: "giveme.my is run by Logical Mechanism, who make Seedelf Wallet: to lend its collateral, it sees each payment from your private balance."; the Collateral screen adds that it sees your IP address); "Make public" (a Home action on the private balance); the dApps page (Home's "dApps"). Whether giveme.my charges anything is stated nowhere, a real gap.
- Real: the "ordinary wallet" line is a review hint closed by default; the 5 ₳ row avoids the word "collateral" but the giveme.my line under it uses it for a different collateral; the review gives no value for the UTxO it spends; the amount field's placeholder is "0".
- Money: nothing moved. The unsigned funding would have spent one 25 ₳ private UTxO into 16 ₳ and 5 ₳ for the one-time account, 3.766792 ₳ change back to the Seedelf contract and a 0.233208 ₳ fee. The wallet recorded Private session 1 locally as unsent; the private balance stayed 28 ₳ and the site got no connection.
- Prior knowledge: none seen. The tester declared general Cardano knowledge (UTxOs as coins, collateral for smart contracts), used to read the change amount and the giveme.my line, and each product term appears in the trace only after the UI had shown it.

**Final result.** The tester found the private option at once and took a private session through amount, review, password and Send, where the fake collateral service's refusal stopped it: nothing was sent and the site never connected. BLOCKED, by the tester and the verifier; up to that point the flow was clear, but unexplained terms and the traceability caveats left the tester unsure how private the session really is.

### T17 · Accidentally decline a dApp

**Test notes.** Website surface: Example Market active in a 1280x720 tab, the wallet's side panel open as a separate 360x640 window, and each connect request in a 400x605 popup. Starting state: funded and unlocked, one public account, 28 ₳ private; the wallet's sites switch was already on (set for T16 and T17 after the pilot), so the site found the wallet at once. The tester was told not to wait for confirmations. Timing matters here: every remote-control command costs a round trip (about 0.7 s) plus the tester's time between commands, and the tester took a screenshot, listed the windows, viewed the site and took another screenshot between declining and retrying. The retry reached the wallet about 14 s after the decline, after the wallet's 10 s decline cooldown had run out, so this trace shows a retry 14 s after declining, not an immediate one; a rerun, T17r, repeats the task with commands chained to retry quickly. The test site shows the wallet's CIP-30 refusal text and keeps an Activity log, more than a typical dApp does. A private session could not have been funded in this environment; the tester chose the public account, so that never came into play.

**Result.** PASS WITH FRICTION · confidence High · 1 wrong turn · 13 navigation steps · prior product knowledge needed: no, everything needed was on screen and the website explained the refusal in plain words. Verifier: same result, but it covers a retry about 14 s after the decline, not an immediate one.

**Path taken.**
1. Ran stop, then start → Example Market: "Not connected.", "Connect wallet" enabled, Sign in and Buy disabled, Activity "Nothing yet."; the side panel open as window 2.
2. Clicked "Connect wallet" on the website → "Choose a wallet", "Wallets found in this browser:" with "Seedelf Wallet" and "Cancel".
3. Clicked "Seedelf Wallet" → a wallet popup: "Connect a site", "Nothing happens until you choose, and press Connect or Review", dapp.example, "Choose what the site sees" with "Your public account" and "A private session"; "Cancel" and a disabled "Connect".
4. Took a screenshot, hovered "Cancel" (no tooltip), then clicked "Cancel" to decline → the popup showed "Seedelf Wallet" / "Nothing's waiting." for a moment, then closed itself; no message that the site had been refused.
5. Looked at the website → a red banner "The wallet did not connect: The user declined. (code -3)" / "Code -3: the wallet refused the request.", Activity "14:02:37 enable() -> refused (code -3)", "Connect wallet" still enabled.
6. Clicked "Connect wallet" again → "Choose a wallet" again, with the red banner still behind it.
7. Clicked "Seedelf Wallet" → a new popup with a fresh, identical connect request; nothing about the earlier decline blocked or remembered it.
8. Selected "Your public account" → Connect enabled; the subtitle changed to "Nothing happens until you press Connect" and "It can ask you to sign transactions and messages. Nothing is signed without you." appeared.
9. Scrolled down 300 px → read "Your private balance stays out of it: the site never sees your Seedelfs or their UTxOs. It does learn your public account" and the rest of the note.
10. Clicked "Connect" → "Nothing's waiting.", then the popup closed; the website showed "Connected to Seedelf Wallet", "Preprod testnet", addr_test1qq...mqkt5dmn, "10,350.538725 ADA and 6 tokens", Activity "14:03:00 enable() -> connected" and the account reads above the earlier refusal; the banner was gone and Buy enabled.
11. Switched to the side panel → Home on the Private tab, "Private balance 28 ₳"; nothing about the connected site.
12. Clicked "dApps" to check whether the site was listed → "dApps", "Used privately, from one-time accounts", with Minswap and Lovejoin; dapp.example was not there (wrong turn).
13. Opened Settings and scrolled down twice (500 px each) to "Sites and mixing" → a "Sites" row showing "On: sites can ask to connect".
14. Clicked "Sites" → "Let sites connect to Seedelf Wallet" (on), "Ask for your password to sign for a site" (on) and a "Connected sites" button.
15. Clicked "Connected sites" → "dapp.example" listed as "Your public account", with its date and a "Disconnect" button.
16. Ran stop.

**Wrong turns.**
- Step 12: clicked "dApps" on Home to check which sites were connected, expecting a list of connected sites that included dapp.example; got a page about dApps used privately from one-time accounts (Minswap, Lovejoin), without it; corrected by going to Settings → "Sites and mixing" → "Sites" → "Connected sites".

**Hesitations.**
- Step 4: the task said decline, but the popup had no "Decline" or "Reject", only "Cancel" next to a disabled "Connect"; the tester wondered whether Cancel would refuse the site or just close the window and leave the request pending, and hovering showed no tooltip. The website later confirmed it counted as "The user declined."
- Step 4: after Cancel the popup said only "Nothing's waiting."; until looking at the website, the tester couldn't tell whether the site had been refused, blocked or simply ignored.
- Step 8: on the second try, choosing between "Your public account" ("No fee") and "A private session" (a fee each way, 5 ₳ kept aside, about a minute) was an extra decision between the tester and simply connecting; they picked public as free and instant.

**Observations.**
- No abandonment moments recorded.
- To the tester, "Cancel" sounds like closing the request for now, yet the site received a hard refusal ("The user declined. (code -3)"). The tester had expected a "Decline" or "Reject" button, perhaps with an option to block the site or a confirmation. The wallet never confirmed the refusal: the popup showed only "Nothing's waiting." and closed itself within about a second, after Connect as well as Cancel, so that screen is easy to miss (the tester's screenshot after Cancel caught the website instead, and they saw "Nothing's waiting." only in the text view). The tester learned what had happened from the website's banner.
- Declining did not block the site: the next attempt brought a fresh, identical request straight away, with no cooldown, no blocked-sites list and no mention of the earlier decline. The tester had half expected the wallet to remember the decline and need unblocking somewhere.
- The website's record was clear: refused, then connected, then getNetworkId, getUsedAddresses and getBalance; the red banner gave way to a green "Connected to Seedelf Wallet", and Sign in and Buy became enabled. The site's header button still reads "Connect wallet" after connecting, which the tester put down to the website's design.
- Connected sites is buried at Settings → about 1000 px of scrolling → "Sites" → "Connected sites"; Home's "dApps" looked like the place but isn't. Once found, Connected sites gave a clear record with a Disconnect button.
- The site's 10,350.538725 ADA (the public account) and Home's "Private balance 28 ₳" look contradictory at first glance, though they made sense given "Your public account".
- On reconnect, the fee and privacy trade-offs of the two options were explained only in small grey text; Connect staying disabled until a choice prevents an accidental connection.
- Trust: "Nothing happens until you choose, and press Connect or Review", the site name, "https://dapp.example" and the PREPROD badge, "No fee" and "Nothing is signed without you." made connecting feel safe. Terminology: expected "Decline" or "Reject", found "Cancel"; expected a "request rejected" confirmation, found "Nothing's waiting." (accurate, but it doesn't say what just happened).

**Answers the task asked for.**

| Question | Tester's answer from the UI | Verifier's check |
|---|---|---|
| What did the wallet do when I declined? | Clicked "Cancel" (there is no "Decline"); the popup changed to "Seedelf Wallet" / "Nothing's waiting." and closed itself; no confirmation that the site was refused (sureness High). | Partly correct: all of that happened, but the wallet also rejected the site's enable() with code -3 and "The user declined." and set a 10 s refusal for the site, which nothing in the wallet showed. |
| What did the website do when I declined? | A red banner, "The wallet did not connect: The user declined. (code -3)" / "Code -3: the wallet refused the request."; Activity "14:02:37 enable() -> refused (code -3)"; "Connect wallet" still available, Sign in and Buy disabled (High). | Correct. 14:02:37 is when enable() was called; the refusal itself came at about 14:02:47, when Cancel was pressed. |
| What happened on trying again from the website? | "Choose a wallet" again; a fresh, identical "Connect a site" popup with no trace of the decline; chose "Your public account" and clicked "Connect" (High). | Correct for this run. The retry reached the wallet about 14 s after the decline, after the 10 s refusal had run out; within 10 s it would have been refused at once, with no popup. |
| Did I recover? | Yes: "Connected to Seedelf Wallet", Preprod testnet, addr_test1qq...mqkt5dmn, 10,350.538725 ADA and 6 tokens, "14:03:00 enable() -> connected", and dapp.example under Settings → Sites → Connected sites (High). | Correct; connecting also cleared the wallet's refusal record. |
| Did any money move? | No: the public account says "No fee", and no transaction or signing was requested (High). | Correct. |

**Verifier notes.**
- Harness (pace): the run never reached the wallet's decline cooldown. A declined site is refused without asking for 10 s, then for 60 s and 5 minutes on repeat declines within 10 minutes. A user who retries at once, as the task asked, would see no popup: the site's enable() would be refused immediately (code -3) with "The user declined this site just now. It can ask again in N s.", which only the site can show. The tester's "no cooldown", "nothing was remembered" and "retrying worked at once" describe a 14 s retry only.
- Harness (site): the test site displays the wallet's refusal text and explains code -3. With a dApp that ignores CIP-30 error info, a real user would hear about the refusal from neither side. The "Connect wallet" label after connecting is the test site's.
- Real: the screenshot the tester took "after Cancel" shows the website because the wallet closes its own popup 0.8 s after the last request is answered; the tester's suspicion was right, but the cause is the product, not the harness.
- Real: the wallet's own wording is inconsistent: "Cancel" on a connect request, "Decline" on signing requests, and "declined" in what the site hears. Cancel has no tooltip, the second prompt has no prior-decline state, and refusals are kept only in memory and never listed.
- Exists-not-found: the wallet does point to Connected sites, but only from the connect popup's icon-only "What this means" hint ("You can disconnect it in Settings, under Connected sites."), which the tester never opened; neither Home nor the dApps page points there, and the dApps page lists only sites on private sessions.
- Real, beyond what the tester saw: the wallet's Public tab counts the staking rewards (10,408.014036 ₳), while the site's CIP-30 balance counts UTxOs alone.
- Money: nothing moved; only Koios reads, no signing request, and Buy was never clicked.
- Prior knowledge: none seen; the tester declared only the general expectation that connect prompts have approve and reject buttons, and "enable()" and "code -3" entered the trace only after the website showed them.

**Final result.** The tester declined with "Cancel", saw the site report "The user declined. (code -3)", retried from the site, got a fresh prompt and connected the public account, confirmed under Settings → Sites → Connected sites. PASS WITH FRICTION from both, with the caveat that the retry came about 14 s after the decline, so the 10 s decline cooldown an immediate retry would hit was never seen.

### T17r · Accidentally decline a dApp (rerun with fast retry)

**Test notes.** Website surface: Example Market active in a 1280x720 tab, the wallet's side panel open as a separate 360x640 window, and each connect request in a 400x605 popup. Starting state: funded and unlocked, one public account, 28 ₳ private; the wallet's sites switch was already on, as for T16 and T17, so the site found the wallet at once. The tester was told not to wait for confirmations. The task text is T17's, given to a fresh tester; the one change is an instruction added to the note: "Each remote-control command takes a few seconds here, much longer than a person's click. Where your task says to do something immediately, chain the commands into one shell call (for example: ui T17r click ... && ui T17r click ... && ui T17r click ...) so they happen within a couple of seconds, the way quick clicks would." It was added because harness round trips had brought T17's retry to the wallet about 14 s after the decline, after the wallet's 10 s decline cooldown had run out. Here the tester chained "Cancel", a screenshot and the website's "Connect wallet"; that click ran while the wallet popup was still the active window and found nothing, so the retry that reached the wallet came from the next shell call, about 7 s after Cancel. That is inside the cooldown, so this run shows the cooldown refusal, though with less of the wait left than an instant retry would see. The test site shows the wallet's CIP-30 refusal text and keeps an Activity log, more than a typical dApp does; it stamps each Activity row with the time the site sent the request, not when the wallet answered. A private session could not have been funded in this environment; the tester chose the public account, so that never came into play.

**Result.** PASS WITH FRICTION · confidence High · 1 wrong turn · 11 navigation steps · prior product knowledge needed: no, declining and reconnecting needed only the website's "Connect wallet" and the wallet's "Cancel" and "Connect", the site's error text explained the cooldown, and "No fee" made the choice of account obvious. Verifier: same result; most of the friction is real, but the tester's doubt about the "3 s" countdown is a misread: the retry reached the wallet about 7 s after Cancel, not 19 s, and the countdown was accurate.

**Path taken.**
1. Ran stop, then start, took a screenshot of Example Market ("Your wallet" "Not connected.", "Connect wallet" enabled, "Sign in with wallet" and "Buy item - 15 ADA" disabled, Activity "Nothing yet."; the side panel open as window 2) and clicked "Connect wallet" → the site's "Choose a wallet", "Wallets found in this browser:" with "Seedelf Wallet" and "Cancel".
2. Clicked "Seedelf Wallet" → a wallet popup (window 3, 400x605) took focus: "Connect a site", "Nothing happens until you choose, and press Connect or Review", dapp.example, "Example Market (test site) · https://dapp.example", "Choose what the site sees" with "Your public account" ("The site sees its addresses, its balance and its UTxOs, and keeps what it saw. No fee.") and "A private session" ("The site sees only a new one-time account, funded from your private balance. A fee each way, 5 ₳ kept aside that comes back, and about a minute."); a big "Cancel" bottom left and a disabled "Connect".
3. Waited 2 s, listed the windows and took a screenshot, then clicked "Cancel" to decline, in one chained call with a screenshot and a click on the website's "Connect wallet" for the immediate retry → the popup showed "Seedelf Wallet" / "Nothing's waiting." with no buttons.
4. The chained click on "Connect wallet" ran while the popup was still in front and found no button, which the tester put down to the remote control's timing; the popup then closed itself → the website: a red box "The wallet did not connect: The user declined. (code -3)" / "Code -3: the wallet refused the request.", Activity "14:43:01 enable() -> refused (code -3)", "Connect wallet" focused, Sign in and Buy still disabled.
5. Clicked "Connect wallet" → "Choose a wallet" again.
6. Clicked "Seedelf Wallet", chained with step 5 → no wallet popup; the site at once showed a new refusal, "The wallet did not connect: The user declined this site just now. It can ask again in 3 s. (code -3)", with Activity "14:43:20 enable() -> refused (code -3)" above the first row; from the Activity times, the tester reckoned this about 19 s after the decline.
7. Took a screenshot and read the message; with more than 3 s gone, did as it said and clicked "Connect wallet", then "Seedelf Wallet" → a new popup (window 4) with the same "Connect a site": the same two choices, Connect disabled.
8. Selected "Your public account" → a check mark on the card, "Connect" enabled, the subtitle changed to "Nothing happens until you press Connect", and "It can ask you to sign transactions and messages." appeared.
9. Scrolled down 300 px in the popup → "Nothing is signed without you." and "Your private balance stays out of it: the site never sees your Seedelfs or their UTxOs. It does learn your public account, as any site you pay from it does, and it can recognize this browser later, even if you connect it to a private session then."
10. Clicked "Connect" → "Nothing's waiting.", then the popup closed itself; the website showed "Connected to Seedelf Wallet", "Preprod testnet", addr_test1qq...mqkt5dmn, "10,350.538725 ADA and 6 tokens", Activity "14:43:33 enable() -> connected" followed by getNetworkId, getUsedAddresses and getBalance, and "Sign in with wallet" and "Buy item - 15 ADA" enabled.
11. Switched to the side panel (window 2) → Home on the Private tab: "Private balance 28 ₳", Receive / Send / Make public / Create, Tokens, "dApps"; nothing about the newly connected site.
12. Clicked "dApps", hoping to see connected sites → "dApps", "Used privately, from one-time accounts", Minswap and Lovejoin, and a note on one-time accounts; nothing about Example Market (wrong turn).
13. Clicked Back → Home; ran stop.

**Wrong turns.**
- Step 12: opened "dApps" in the side panel, expecting a list of connected or allowed websites that would include Example Market (dapp.example); got a catalogue of dApps for private sessions (Minswap, Lovejoin) with an explanation of one-time accounts, and nothing about Example Market; corrected by clicking Back and stopping, as the goal was already met on the website.

**Hesitations.**
- Step 3: the only way to decline in the popup is "Cancel", with no "Decline" or "Reject"; the tester guessed Cancel meant decline, and the site did report it as "The user declined".
- Step 6: the immediate retry was refused without any wallet window appearing, and for a moment the tester wondered whether the wallet had remembered the decline for good; the site's "It can ask again in 3 s" was the only thing that said it was temporary. It said "3 s" although, by their reckoning, about 19 s had passed since the decline, which made them unsure whether the countdown was real.
- Step 8: the tester had to choose between "Your public account" and "A private session" before Connect would turn on, and felt neither term was explained up front; they picked public because it said "No fee", while the private one mentions fees and 5 ₳ kept aside.

**Observations.**
- Abandonment moment the tester recorded: step 6 ("This seems broken", severity 2): clicking Connect again straight after declining brought up nothing in the wallet, only another refusal on the site. Had the site not passed on the wallet's "It can ask again in 3 s", the tester would have thought the wallet had blacklisted the site, and might have given up or gone digging in settings; thanks to the message, they didn't reach the point of quitting.
- The wallet gave no sign of its own that it had refused the retry: no popup, and nothing in the popup or the side panel. The only explanation was the website's "The user declined this site just now. It can ask again in 3 s. (code -3)", and the tester noted that with a site showing only the generic code -3, a user would think the wallet was broken or had blocked the site for good. While the retry was refused with nothing showing, they trusted the wallet a little less, until they read the site's text.
- The tester expected the connect prompt simply to come back on a retry; instead the wallet refused quietly with a cooldown, and the try after that showed the normal "Connect a site" again. Nothing lasted and nothing needed undoing in settings: retrying after the cooldown just worked, and the refusal had explained itself through the site, including when to try again.
- The "3 s" came, by the tester's reckoning from the Activity times, about 19 s after the decline, so they couldn't tell whether the cooldown runs longer than it first sounds or the number is misleading, and couldn't predict when retrying would work. In the site's Activity list the real decline and the automatic block read the same, "enable() -> refused (code -3)".
- Declining: the tester expected a "Decline" or "Reject" button, the popup closing and the site saying they refused; they found only "Cancel". After Cancel the popup didn't close straight away: it showed a blank "Seedelf Wallet" / "Nothing's waiting." screen with no buttons, then closed itself, and for a moment they weren't sure the decline had gone through. The site got a clear, human-readable "The user declined. (code -3)", so the result was clear even though the button wording wasn't, and declining was quick.
- To connect, the tester first had to choose "Your public account" or "A private session", wallet-specific ideas new to them; "No fee" made the choice easy. Connect stays disabled until a choice is made, and the subtitle "Nothing happens until you choose, and press Connect or Review" says so, which prevents connecting by accident.
- Trust: "Nothing happens until you choose, and press Connect or Review" made declining or looking around feel safe, and "Nothing is signed without you." with the private-balance note made connecting the public account comfortable.
- After Connect the popup closed itself and the site at once read the network, addresses and balance into its Activity list, so it was obvious that recovery had worked.
- Connected sites: the tester expected a "Connected sites" list reachable from the side panel and tried "dApps" ("Used privately, from one-time accounts"), a different feature that sounds like connected sites; they didn't find where connected sites are listed, and Home showed nothing about the new connection.
- Screen-reader names on the side panel are longer than the visible labels ("Send privately" shows "Send", "Receive privately" shows "Receive"); on the connect popup, the visible card text matched the radio names.

**Answers the task asked for.**

| Question | Tester's answer from the UI | Verifier's check |
|---|---|---|
| What did the wallet do when I declined? | Pressed "Cancel" in the "Connect a site" popup; it briefly showed "Seedelf Wallet" / "Nothing's waiting." and then closed itself (sureness High). | Correct. Cancel also rejects the site's enable() with code -3 and "The user declined." and starts a 10 s refusal for dapp.example; the empty "Nothing's waiting." shows for 800 ms before the wallet closes the window. |
| What did the website show after the decline? | A red box, "The wallet did not connect: The user declined. (code -3)" / "Code -3: the wallet refused the request."; Activity "14:43:01 enable() -> refused (code -3)"; still not connected, Sign in and Buy disabled (High). | Correct. "14:43:01" is when the site sent enable(); the decline itself came at about 14:43:13, when Cancel was pressed. |
| What happened when I immediately tried to connect again from the website? | The site's chooser appeared; picking "Seedelf Wallet" opened no wallet popup; the site showed "The wallet did not connect: The user declined this site just now. It can ask again in 3 s. (code -3)" and logged another "enable() -> refused (code -3)" at 14:43:20 (High). | Correct. The retry came about 7 s after Cancel, inside the 10 s refusal, so the wallet refused it without asking; about 2.8 s were left, shown rounded up as "3 s". Elsewhere the tester puts this 19 s after the decline, which is wrong, but this answer is right. |
| How did I recover? | After the few seconds the message mentioned, clicked "Connect wallet", then "Seedelf Wallet" again; the "Connect a site" prompt reopened; chose "Your public account" (No fee) and pressed "Connect"; the site showed "Connected to Seedelf Wallet" with the network, address and balance, and logged "14:43:33 enable() -> connected" (High). | Correct. The refusal had ended at about 14:43:23, and the try at about 14:43:33 opened the popup; connecting cleared the wallet's refusal record. The site stamped "14:43:33" when it asked; Connect itself was pressed at about 14:43:50. |
| Did the wallet itself show any notice about the automatic refusal or the cooldown? | No: the cooldown explanation appeared only on the website, and the wallet showed nothing during the blocked retry (Medium). | Correct. The refusal goes back to the site as CIP-30 code -3, with the wait only in its info text; no window opens, nothing sets a notification or badge, and the side panel shows nothing. The user sees the explanation only if the dApp prints that text, as this test site does. |

**Verifier notes.**
- Misread (timing): the tester's doubt about "3 s" coming 19 s after the decline (their first harness suspicion, the step 6 hesitation, a friction point and their confidence note). The test site stamps each Activity row with the time it sent the request: "14:43:01" is when the site asked, as "Seedelf Wallet" was clicked; Cancel was pressed at about 14:43:13, and the retry's enable() went out at about 14:43:20, about 7 s after Cancel. A first decline refuses the site for 10 s from the Cancel press, and the wallet shows what is left rounded up, so about 2.8 s read "3 s": the countdown was accurate. The site's error box is static, so it still read "in 3 s" after those 3 s had passed. The tester's last point stands: any retry within 10 s of Cancel is refused, and one 1 s after Cancel would read about "9 s". A second decline within 10 minutes of a cooldown ending makes the next wait 60 s, then 5 minutes; this run didn't trigger that.
- Harness (pace): the harness clicks only in the active window, so the chained "Connect wallet" click at step 4, about 0.1 s after the screenshot that followed Cancel, landed in the wallet popup during its deliberate 0.8 s "Nothing's waiting." hold and found no button. The chain broke, and the retry went out in a separate shell call about 7 s after the decline instead of 1-2 s. That was still inside the 10 s refusal, so unlike T17 the cooldown path was exercised, but the wait shown (3 s) was shorter than a quick clicker would see (about 8-9 s), and the tester's next try fell after the cooldown. A real user would see the popup go within about a second, or click the website behind it; any retry inside 10 s gets the same refusal either way.
- Real: the step 6 abandonment moment, and the tester's point that the wallet gave no sign of blocking the retry. A refusal during the cooldown opens no window, nothing in the wallet sets a notification or badge, and the side panel stays unchanged; the wait travels only in CIP-30's info text. This is by design: the first refusal is short, so that a user who cancelled by mistake isn't shut out for long. Whether the user learns why depends on the dApp printing that text; this test site does, and a dApp showing only the code or a generic error would leave the user with nothing, as the tester feared.
- Harness (site): the test site prints the wallet's CIP-30 info text in its error box, which made the automatic refusal explain itself; many real dApps show only a code or a generic error, so this run may understate how confusing the cooldown is in real use (the tester raised this). The identical Activity rows are the test site's choice: the wallet sends the same CIP-30 code (-3, CIP-30's single refusal code) for both, with different texts, "The user declined." and "The user declined this site just now. It can ask again in N s.", and the site's status box showed each. The "Choose a wallet" chooser and the "Code -3: the wallet refused the request." line are the test site's own UI.
- Real: after Cancel and after Connect, the popup shows the empty "Seedelf Wallet" / "Nothing's waiting." for 0.8 s, because a site's next request may be on its way, then the wallet closes the window; that screen doesn't say what was just answered. The view taken right after each click caught it (about 1 s on screen for a person), and the tester correctly called it brief.
- Real: the connect prompt's decline button is "Cancel", while signature requests use "Decline". The site is told "The user declined.", and Cancel also starts the 10 s refusal for that site, which the word "Cancel" doesn't suggest.
- Misread: "Neither term was explained up front" (step 8). Each card has a one-line explanation under its title ("The site sees its addresses, its balance and its UTxOs, and keeps what it saw. No fee." and "The site sees only a new one-time account, funded from your private balance. A fee each way, 5 ₳ kept aside that comes back, and about a minute."), and more appears once one is chosen; the tester's notes quote only the fee parts. Real: the screen never says why someone would want a private session (it only implies it), and a choice is required before Connect turns on.
- Exists-not-found: the connected-sites list (the step 12 wrong turn). It is at the side panel's gear icon "Settings" → "Sites and mixing" → "Sites" ("On: sites can ask to connect") → "Connected sites", which lists every connected site with a Disconnect button; Example Market would have been there. The connect popup's icon-only "What this means" hint beside "Connect a site" says "You can disconnect it in Settings, under Connected sites.", and the dApps page lists only sites on private sessions. Real: Home has no indicator of connected sites, and that icon-only hint is the only pointer.
- Real: once the cooldown had passed, the normal prompt came back, with no lasting block and nothing to undo: refusals are kept only in the wallet's memory and cleared by a successful connect. That holds for one decline; declining again within 10 minutes of a cooldown ending raises the wait to 60 s, then 5 minutes, which this run never reached.
- Money: nothing moved. No transaction was posted; the only network calls were Koios reads, at start-up and then the connected site's getUsedAddresses and getBalance at about 14:43:50. Only the public account was connected; nothing was signed or sent, and Buy was never pressed. The site's "10,350.538725 ADA and 6 tokens" is the public account's 10,408.014036 ₳ less its 57.475311 ₳ of staking rewards (the UTxO balance); the panel still showed 28 ₳ private.
- Prior knowledge: none seen beyond the general CIP-30 knowledge the tester declared (enable(), code -3 meaning refused), which the test site's Activity log and error line supplied anyway. The tester used no product terms before the UI showed them and went to no hidden places: they looked for connected sites under the visible "dApps" row and never reached Settings → Sites → Connected sites.

**Final result.** The tester declined with "Cancel" (the site got "The user declined. (code -3)"), retried from the site about 7 s later and was refused with no prompt, the site showing "The user declined this site just now. It can ask again in 3 s."; the next try, about 20 s after Cancel, brought the prompt back, and they connected the public account ("Connected to Seedelf Wallet"). PASS WITH FRICTION from both. Unlike T17, this run reached the 10 s decline cooldown, which the wallet itself never signals; the tester's doubt about the "3 s" was a misread of the site's request-time stamps, and the wallet's Connected sites list went unfound.

### T18 · Sign a dApp transaction

**Test notes.** Website surface: Example Market active in a 1280x720 tab with the wallet's side panel open as a separate window; the signing request opens in a 400x605 popup, standing in for the real 400x640 window once its title bar is taken off. Starting state: funded and unlocked, one public account, the sites switch on and Example Market already connected to the public account through its own Connect button ("Connected to Seedelf Wallet"). The tester was told that buying the site's sample item makes it ask the wallet to sign a payment, and not to wait for confirmations; they stopped before signing, as the task's "before you would normally press Sign" implies. The test site sets a fixed 0.25 ADA fee and picks coins greedily, so the transaction it asked for spends 5 UTxOs from 2 of the wallet's addresses; a real dApp might spend from one. On preprod a test-network strip takes about 40 px at the top of the popup, which is what pushes the end of the privacy note below the fold.

**Result.** PASS WITH FRICTION · confidence High · 1 wrong turn · 5 navigation steps · prior product knowledge needed: no, the main answers were on the summary in plain words; reading the details view (UTxOs, outputs, recognising change) takes some Cardano knowledge.

**Path taken.**
1. Ran stop → not running.
2. Ran start → Example Market, "Connected to Seedelf Wallet", with "Buy item - 15 ADA", the shop's address and "15 ADA + 0.25 ADA network fee".
3. Took a screenshot, then clicked "Buy item - 15 ADA" → a wallet popup opened and took focus: "Sign a transaction", "Nothing happens until you press Sign", dapp.example / Example Market (test site), "Total leaving your public account" 15.25 ₳, "Network fee" "0.25 ₳, counted in the total", "It signs for" "2 of your addresses", "Pays" the shop's full address as "An address" 15 ₳, and a green privacy note cut off at the bottom edge: "Signing ties this transaction to your public account, as any payment from it. Your private balance isn't in".
4. Took a screenshot → confirmed the above-the-fold content: no buttons above the fold.
5. Scrolled down 300 px to find the Sign/Decline buttons → the note's end ("Your private balance isn't in it."), "Transaction details", "Your password, to sign" with "Show", "Decline" and a disabled "Sign".
6. Hovered "2 of your addresses" → no tooltip; nothing said which addresses.
7. Clicked "Transaction details" → a dialog, "The transaction": the tx id, "Transaction" / "Raw CBOR" tabs, "Spends 5 UTxOs" (five truncated UTxO ids) and the start of "Pays 2 outputs".
8. Hovered, then clicked, the small (i) next to "Spends 5 UTxOs" → "What each one holds isn't in the transaction, and the wallet asks nobody: looking them up would tell whoever was asked which transaction you are reading."
9. Scrolled the dialog by its title, "The transaction" → the harness replied "Nothing moved." (wrong turn).
10. Scrolled over the UTxO list → the outputs: "#0 · a key" 15 ₳ to the shop's address; "#1 · a key that stakes" 10,332.288725 ₳, 550,999,000 LINK and 3,000,000,000 asset13vxx…6fmzjw to addr_test1qq8ac7…mqkt5dmn.
11. Scrolled to the bottom of the dialog → "Network fee" 0.25 ₳, "Size" "401 bytes (397 of body)", "Signed" "Not yet".
12. Closed the dialog → back on the summary, Sign still disabled; did not sign.
13. Ran stop.

**Wrong turns.**
- Step 9: scrolled the details dialog with the pointer over its title, "The transaction", expecting the content to scroll down to the second output; got "Nothing moved." (the header doesn't scroll, which the tester took for a fixed header's normal behaviour rather than a harness fault); corrected by scrolling with the pointer over a UTxO row, which worked.

**Hesitations.**
- Step 3: the first view had no Sign or Decline button and the privacy note stopped mid-sentence ("Your private balance isn't in"); the tester paused to work out whether that was the whole screen, and scrolled only because they needed the buttons.
- Step 6: "It signs for 2 of your addresses" left the tester unsure which addresses; hovering gave no tooltip and the summary doesn't list them.
- Step 7: the summary showed one recipient but the details said "Pays 2 outputs"; for a moment the tester worried a second party was being paid.
- Step 10: the second output was labelled only "#1 · a key that stakes", not as change or "back to you"; the tester decided it was theirs only because its address ends in "mqkt5dmn", like the address the website showed for their wallet.

**Observations.**
- No abandonment moments recorded.
- The summary card was well organised: "Total leaving your public account" 15.25 ₳ is the largest, boldest figure, and "counted in the total" makes clear the fee is included, not extra. The amounts matched the website's "15 ADA + 0.25 ADA network fee", and the payee matched the shop's address character for character, which built trust. "Nothing happens until you press Sign" reassured, and with the password field right above it, it was clear why Sign was disabled.
- The end of the privacy note and every control (password, Decline, Sign) are below the fold, so reading the note and reaching the buttons both need a scroll.
- Which account signs is only "your public account" plus "2 of your addresses": neither the summary nor the details names the addresses (the details list only UTxO ids, with a note that the wallet deliberately doesn't look them up). The tester had expected a named account and the addresses used; not knowing which two sign left a small doubt about which part of the wallet is used.
- The summary's single payee against the details' "Pays 2 outputs": the extra output is change back to the user, but nothing in the details labels it as theirs or as change, and "a key that stakes" is technical. The unlabelled output briefly hurt the tester's trust.
- The recipient is labelled only "An address", with no name or "not in your wallet" marker; the tester checked it against the website's shop address by hand.
- "Public account" implies there is also a private side, which the tester (playing a newcomer) didn't know about; the note at least said the private balance isn't touched. They had expected no privacy statement at all and found a plain-language one.
- "Spends 5 UTxOs" is Cardano jargon in the details view; the (i) explained that the wallet doesn't look up what each UTxO holds, for privacy.
- Screen-reader names matched the visible labels apart from icon-only buttons ("Close", "What this means"). Worked well: the site name and URL at the top, the payee shown in full, and the details view (fee, size, "Signed" "Not yet") for experts.

**Answers the task asked for.**

| Question | Tester's answer from the UI | Verifier's check |
|---|---|---|
| Which account signs? | "your public account" ("Total leaving your public account"); "It signs for 2 of your addresses"; which two isn't shown (sureness Medium). | Correct. It is the wallet's only account (an account is named only when there are several); it signs with 2 payment keys and no stake or DRep key. Which two is never shown. |
| Who receives money? | The shop's address, addr_test1vp5wwqrj43rrv5rq0tye3hzs4nt9qm96z4dwuccua6vcuagmk7tdq ("An address"), receives 15 ₳, matching the website; change of 10,332.288725 ₳ plus tokens goes to addr_test1qq8ac7…mqkt5dmn, which the tester worked out is their own (High). | Correct: output #1 is the wallet's own base address, which the summary treats as change (left out of "Pays", counted in the net). |
| How much leaves? | "Total leaving your public account" 15.25 ₳ (High). | Correct: 15 ₳ to the shop plus the 0.25 ₳ fee; no tokens leave. |
| What is the fee? | "Network fee" "0.25 ₳, counted in the total" (High). | Correct; it is the test site's fixed fee. |
| Any privacy or linking consequence? | "Signing ties this transaction to your public account, as any payment from it. Your private balance isn't in it.", cut off at the fold until the tester scrolled to reach the buttons (High). | Correct; on preprod its second half sits below the fold. |

**Verifier notes.**
- Harness: the step 9 wrong turn and its friction item. The harness's view named the dialog's scroll area "The transaction", the same text as the dialog's title, so scrolling "in" it wheeled over the title, which sits outside the scrolling area. A header that ignores the wheel is standard, real behaviour, but nothing in the product points a user at it; the verifier says to drop it from the UX findings.
- Real, by design: the password field and Sign/Decline deliberately come after the request (so it is read to its end before Sign), about 266 px below the fold for any user. The cut-off sentence is partly specific to preprod: on mainnet, without the test-network strip, the whole note would probably fit, but the controls still would not.
- Real: the wallet knows which keys sign (it recognised all 5 inputs as its own and holds their key paths), yet neither the addresses nor the paths appear anywhere in the window; the inputs hint explains why third parties aren't asked, not why the wallet's own addresses are missing.
- Real: each output's label comes from its address alone, and the wallet's knowledge of which outputs are its own is shown nowhere, so nothing reconciles "Pays 2 outputs" with the summary's single payee. "An address" does mean "not yours" (the wallet's own accounts would read "Your public account" or "Your private session N"), but only by implication.
- Real, low severity: "public account" and "private balance" aren't defined in the window, but the scenario's user has used the wallet, whose Home titles its two cards with those words.
- Unverifiable: the tester's "plus all tokens". The change carries whatever tokens were in the 5 spent inputs; the site reported 6 tokens and 3 ₳ of UTxOs went unspent, so it may not be every token. No token leaves either way.
- Harness (site): the fixed 0.25 ₳ fee is above the roughly 0.18 ₳ minimum for this size, and "2 of your addresses" and the 5 inputs come from the site's coin selection.
- Money: nothing was signed or submitted. Signed, it would have paid 15 ₳ to the shop and a 0.25 ₳ fee and returned 10,332.288725 ₳ plus the tokens to the wallet: 15.25 ₳ leaving in all and no tokens, as the summary said.
- Prior knowledge: none seen beyond the declared general knowledge that a transaction usually has a change output.

**Final result.** Before signing, the tester correctly identified all five items from the summary (the public account, 15 ₳ to the shop, 15.25 ₳ leaving, a 0.25 ₳ fee within it, and the linking note) and did not sign. PASS WITH FRICTION from both: the controls and the note's end sit below the fold, the signing addresses are only a count, and the details don't label the change; the one scrolling wrong turn was a harness artifact.

### T19 · Add a second public account

**Test notes.** Side panel surface: a separate 360x640 window. Starting state: funded and unlocked with one public account (Account 1) and 28 ₳ private; the tester was given no environment notes. Account 2 has no history in the fake Koios (real Koios answers the same for an unused account), so the run shows the two-step path for an unused next account; a next account with chain history is added in one step ("Found Account 2. It's in the list now."). The verifier found nothing in the harness that distorted this task.

**Result.** PASS WITH FRICTION · confidence High · 0 wrong turns · 5 navigation steps · prior product knowledge needed: no, only the general habit of looking in Settings for a feature that isn't on Home.

**Path taken.**
1. Ran stop, then start → Home, unlocked: Private/Public tabs, "Private balance 28 ₳", Receive / Send / Make public / Create; no account name or account switcher anywhere.
2. Clicked the Settings gear → a Network section (Mainnet/Preprod) and a Wallet section listing "Public accounts", "Contacts", "Collateral".
3. Clicked "Public accounts" → "Accounts", "Account 1 · current" with "Name it", a paragraph about the private balance being shared, a large "Look for the next account" button, a green link "Use an account number of your own", and a paragraph about Koios queries.
4. Hovered the small (i) next to the "Public accounts" title → "Each account is a separate Cardano wallet from the same recovery phrase, with its own addresses, its own staking and its own collateral. Other wallets call these accounts too, and show the same ones for this phrase."
5. Clicked "Look for the next account" → "Account 2, the next in order, has never been used on Preprod. You can still add it and start using it." and a prominent teal "Add Account 2" button.
6. Clicked "Add Account 2" → "Accounts · 2", "Account 1 · current", "Account 2" with "Switch to it" and "Name it", the status "Account 2 is in the list now.", and a new "Public account" dropdown (Account 1) in the header.
7. Clicked the Seedelf logo (Home) → the same Home as before, plus the new "Public account" dropdown under the header.
8. Ran stop.

**Wrong turns.** None.

**Hesitations.**
- Step 1: the tester looked for an account name or switcher near the top of Home, the usual place, found nothing, and had to guess that accounts live in Settings. Home's "Create" (screen-reader name "Create a Seedelf") could plausibly have meant creating an account, but they didn't click it.
- Step 2: the only account item in Settings was "Public accounts". Wanting "another Cardano account", not specifically a public one, and having seen Private/Public tabs on Home, the tester briefly wondered whether a public account was something different from what they wanted, or whether private accounts were managed elsewhere.
- Step 3: expected an "Add account" button; the main button said "Look for the next account", which sounded like a search rather than adding, and the help text mentions "Check it" and "Add it" buttons not yet on screen. The tester wasn't sure whether "Look for" would add an account or only search, or whether it would contact a server (the text says it asks Koios).

**Observations.**
- Abandonment moment the tester recorded: step 1 ("I don't know what to do", severity 2): with no account concept on Home, a user who doesn't think of Settings could conclude the wallet doesn't support multiple accounts; the tester would not have quit, but a less persistent user might.
- Home gives no sign that accounts exist until a second one does; only then does a "Public account" dropdown appear in the header on every screen. Showing the switcher only once there are two accounts makes adding the first extra account harder to discover. The tester had expected an account name or dropdown at the top of Home with an "Add account" option.
- "Public accounts" has to be worked out: "public" here means ordinary Cardano accounts, as opposed to the wallet's private balance (Seedelf side).
- Adding takes two steps, "Look for the next account" and then "Add Account 2", which appears only after the lookup; "Look for" sounds like a search, so the tester wasn't sure it would get them what they wanted.
- The Public accounts screen packs dense text before and after the main button (the shared private balance, linking private payments, Koios queried one account at a time), hard to skim in a 360 px panel, and it names buttons ("Check it", "Add it") that aren't on screen. "Use an account number of your own" is a second, competing option whose meaning is unclear without knowing about derivation; the tester ignored it.
- Once on that screen, the path was clear: the lookup said Account 2 was unused and could still be added (reassuring that nothing would conflict with existing funds), and "Account 2 is in the list now." plus the new row left no doubt. Adding did not switch accounts ("Account 1 · current" stayed, Account 2 got "Switch to it"), which the tester found reasonable and clearly shown.
- The (i) tooltip explained clearly what an account is. "Add it asks nobody anything" and the one-account-at-a-time Koios lookups reassured about privacy, though densely worded; no password was asked for and no money moved, so adding felt safe.
- Terminology: expected "Accounts", found "Public accounts"; expected "Add account", found "Look for the next account" then "Add Account 2"; Home's visible "Create" doesn't say what it creates, only its screen-reader name does.

**Answers the task asked for.**

| Question | Tester's answer from the UI | Verifier's check |
|---|---|---|
| Is the natural action for adding the next account discoverable? | Partly: nothing on Home points to accounts, so Settings had to be guessed, where "Public accounts" sits under Wallet; inside it, a big "Look for the next account" leads to a prominent "Add Account 2"; "Look for" instead of "Add", and the "Public" qualifier, caused hesitation (sureness High). | Correct. With one account Home has no account name, switcher or link, and Settings → Wallet → "Public accounts" is the only route. Once a second account exists, the header picker only switches; adding always stays in Settings. |
| Was the next account added? | Yes: "Account 2 is in the list now.", and the list shows "Accounts · 2" with Account 1 still current (High). | Correct; the active account stayed Account 1. |

**Verifier notes.**
- No harness artifacts, misreads or exists-not-found findings: every friction point is real product layout and wording.
- Real: hiding the account picker while there is one account is deliberate (a wallet that has never had a second account looks as it always did). The Public tab's heading says "Public account", but as plain text, not a name, switcher or link; Home has no route to the accounts screen at all.
- Real: even with two accounts, the header picker lists only the accounts and has no "Add account" entry, so the dropdown with "Add account" the tester expected exists in neither state.
- Real: "Look for" is accurate, as it is one Koios lookup. The always-visible cost note names "Check it" and "Add it", which exist only inside the folded "Use an account number of your own" section; the main path's button is "Add Account 2", so the note never names the button the main path shows.
- Real: there are no private accounts; the private balance is one per phrase, which the screen says only once inside Public accounts. Home's "Create" creates a Seedelf, unrelated to accounts.
- Harness fidelity, minor: the hover printed the tooltip at once; real Chrome shows the same native tooltip after a short delay.
- Money: nothing moved. One Koios read for the lookup, none for the add (it only writes the local account list), no password and no transaction; the private balance read 28 ₳ before and after.
- Prior knowledge: none seen in navigation; every control the tester used was on screen just before they used it.

**Final result.** The tester added Account 2 with no wrong turns (Settings → "Public accounts" → "Look for the next account" → "Add Account 2"), and the wallet confirmed it plainly. PASS WITH FRICTION from both; all the friction came at the start: with one account Home shows no account concept, the entry is called "Public accounts", and adding needs a "Look for" step first.

### T20a · Restore the wallet (narrow side panel)

**Test notes.** Surface: a 360x640 window standing in for Chrome's side panel (a window of its own, not docked). Starting state: a fresh install with nothing set up; the tester chose their own password. The harness set the wallet to open in the side panel for this task; per the verifier, the product's default after a fresh install is a tab. Data: a 24-word phrase that the wallet's own Create flow generated and nobody funded, so the restored wallet is truly empty (0 ₳ on both sides); the task didn't say whether the wallet held funds. The task text told the tester that another participant starts in a full tab (T20b). The tab the panel hands over to appears as a separate 1280x720 window; in Chrome it opens in the same browser window. The harness prints one settled view after each command, so text shown only while a command runs isn't seen, and `fill` sets a field's whole value in one step. Nothing is submitted in this task. Main-run trace (it predates the harness fix for "Details" toggles; none was involved).

**Result.** PASS WITH FRICTION · confidence High · 0 wrong turns · 5 navigation steps · prior product knowledge needed: no, only the general ideas of a recovery phrase and a password.

**Path taken.**
1. Ran stop, then start → the side panel showed the welcome screen: "Create new wallet", "Restore wallet" and "Each opens in a full tab, which stays open while you write your phrase down or type it in."
2. Clicked "Restore wallet" → the side panel closed by itself and a 1280x720 wallet tab opened on "Restore a wallet", "Step 1 of 2", with "24 words" already selected, 24 numbered boxes and Continue disabled.
3. Clicked box 1 and typed "exer" → a suggestion list opened under the box showing "exercise", with the typed part highlighted.
4. Pressed Enter → box 1 filled with "exercise" and focus moved to box 2.
5. Typed "joke " (word plus space) → box 2 got "joke" and focus moved to box 3, so space also advances.
6. Typed words 3 to 23, each followed by a space, then the last word in box 24 → every word landed in its numbered box and Continue became enabled (teal).
7. Checked a screenshot against the given phrase → all 24 words matched, in order, all above the fold.
8. Clicked "Continue" → "Set a password", "Step 2 of 2", Password (with "Show") and Confirm password, "Restore wallet" disabled.
9. Filled both fields with the same 16-character password → a 4-segment strength bar with "Strong." appeared and "Restore wallet" became enabled.
10. Clicked "Restore wallet" → straight to Home with no confirmation message: "Private" tab selected, "Updated just now", "Private balance 0 ₳", Send, Make public and Create greyed, "Fund your public account first: it pays for your Seedelf", and a "Get started" card.
11. Clicked the "Public" tab to see whether the existing wallet had come back → "Public account 0 ₳", a "Staking and governance" card and "Create your Seedelf before making money private: then what you make private isn't tied to it."
12. Ran open-wallet (the toolbar icon) → a side panel opened on the restored wallet's Home ("Private balance 0 ₳", "Updated 17 s ago", the Get started card).
13. Ran stop.

**Wrong turns.**
- None.

**Hesitations.**
- Step 2: the panel closing itself instead of staying open beside the tab was briefly surprising, although the welcome screen had warned "Each opens in a full tab", so the tester wasn't lost.
- Step 3: the tester didn't know how to move between boxes (Tab? Enter? space?) and found by trying that Enter takes the suggestion and moves on, and space moves on too.
- Step 8: before clicking Continue the tester wondered whether the phrase was valid; the only sign was Continue turning from grey to teal, with no "Phrase looks valid" message or per-word check mark.
- Step 10: no "Wallet restored" message and 0 ₳ on both sides, so for a moment the tester wasn't sure the restore had found the existing wallet; the "Get started" card, about funding the account, reads as if the wallet were brand new. The tester logged this as an abandonment moment ("I don't know what to do", severity 2 of 5) but called it "Not a real quitting point, just mild doubt": a user expecting funds might think the restore failed or created a new wallet, and might start over or delete it.

**Observations.**
- Checking the words: in the tab, all 24 words show in plain monospace text, each with its number, in a 4x6 grid, and the grid and Continue fit at 1280x720 (about 48 px more below). The tester found checking every word easy and certain. Phrase entry never happens in the 360 px panel.
- The handover: "Restore wallet" in the panel closes the panel and opens a tab, so the narrow panel takes no part in phrase entry. The tester had expected to type in the panel, or to have a tab open while the panel stayed; the welcome note set the expectation of a tab correctly.
- Phrase validation is silent: the only sign the phrase is acceptable is Continue enabling; nothing says it was checked or valid.
- End of restore: no success message. Home with "Private balance 0 ₳" and a "Get started" card ("Fund your public account") is what a brand-new wallet would show, and nothing on screen (an address, a "Restored" label) linked it to the phrase. The tester trusted the result "a little less" than they would have with a restored-wallet summary.
- The password step: nothing says the two passwords match; the tester inferred it from "Restore wallet" enabling. They found its text ("It encrypts your recovery phrase here; it can't recover your funds anywhere else") honest and reassuring, and noted the 12-character minimum and the "Strong." meter shown in place.
- Wallet structure: the tester expected one balance, like an ordinary Cardano wallet, and got "Private" (selected by default) and "Public" tabs with separate balances. The two-sided model isn't explained until the "Get started" card; step 1's "its first account becomes this wallet's public account" was the first hint of a public side.
- Screen-reader names say more than the visible labels: "Receive" is announced as "Receive privately", "Send" as "Send privately", "Create" as "Create a Seedelf". A sighted user sees only the short labels plus the selected tab.
- Network: the amber "Test network: ADA here has no value." banner, the PREPROD badge, and step 1's "Restoring a wallet on Preprod." with "Change network" made it clear which network the restore was on.
- Worked well, per the tester: the advance warning that restore opens a tab; "24 words" preselected; suggestions with Enter or space to advance; "Step 1 of 2" and "Step 2 of 2"; the reopened side panel showing the restored, unlocked wallet.

**Answers the task asked for.**

| Question | Tester's answer from the UI | Verifier's check |
|---|---|---|
| Can you confidently verify every word you typed before submitting? | Yes (High). In the tab all 24 words show in plain text, numbered 1-24 in a 4-column grid, on screen with Continue at 1280x720; the tester checked each before Continue. Entry happens in a tab, so there was no cramped 360 px grid. | Correct. The 24 values match the given phrase word for word and in order, and the wallet's check accepted them (Continue led to Step 2). About 48 px lay below Continue. The panel never shows the grid. |
| Was the wallet restored? | Yes, as far as the UI shows (Medium): Home with 0 ₳ private and 0 ₳ public, and the same wallet in the reopened panel; no "restored" confirmation, and no way to confirm it is this phrase's wallet. | Correct. The restore ran with exactly the typed words and the worker then read the account; 0 ₳ on both sides is the right balance for this never-funded phrase. Restore and create return the same status and land on the same Home, so the UI shows no restore confirmation. |

**Verifier notes.**
- Result kept: PASS WITH FRICTION. Every screen the tester describes matches the printed views and screenshots.
- Real, by design: in the panel, "Restore wallet" opens a tab at the restore screen and closes the panel once the tab exists. The welcome note says a tab opens and stays open, not that the panel closes, which fits the tester being warned and still surprised.
- Misread: Continue enabling didn't mean the phrase was valid. It enables once all 24 boxes are filled, valid or not; the word-list and checksum check runs when Continue is clicked, and reaching Step 2 was the pass signal. On a failure the screen stays on step 1 with "These words don't make a valid phrase. Check the spelling and the order." or "Word N isn't on the list of recovery phrase words. Check its spelling.", and a box holding an off-list word is marked invalid while typing. Nothing says Continue runs a check, so the UI invited this reading; the absence of any positive "valid" message is real.
- Real: no "Wallet restored" message. Create and restore return the same status, so an empty restored wallet's Home, Get started card included, is identical to a new one's. While the vault is sealed the button reads "Encrypting…" with "Restoring your wallet…" under it, but the harness printed only the settled Home about 1 s later; that text reports progress, not success, so the finding stands.
- Harness (test data): the 0 ₳ balances, the "my wallet or an empty one?" doubt and the step-10 abandonment moment come from the never-funded phrase. A funded phrase would show its balance on the first read, with the Get started card's first step ticked or the card gone. Restore can't swap in a fresh wallet, since the keys come from the typed words. A real user restoring an unused phrase would see exactly this screen.
- Exists-not-found: an address to compare with is one click away, not on Home. "Show my address" on the Get started card's step 1 ("Fund your public account"), or "Receive" on the Public tab, opens the public Receive screen with the address and a QR code under "Receive address". With no reference address to compare, finding it wouldn't have settled the doubt in this test.
- Real: no positive "passwords match" message. "Restore wallet" enables only when the passwords match and the first has at least 12 characters, so the tester's inference was right. "The passwords don't match." shows under Confirm password whenever the two differ; the tester's `fill` set each value in one step, so they never saw it.
- Real: no on-screen hint names the keys for moving between boxes (Enter or Tab take a suggestion; space or Enter advance on an exact word; space also takes a lone suggestion). The only tip is "Tip: paste the whole phrase into any box."
- Real and intended: each screen-reader name begins with the visible word, so label-in-name holds. Home opening on Private after a restore is by design.
- Harness: the side-panel start came from the harness seeding the wallet's open mode; after a real fresh install the toolbar icon opens a tab, so step 12's open-wallet opened the panel only because of that seeded mode (the task's premise, not a distortion). The view printed the suggestion as "exer cise"; the screenshot was correct and the tester read it correctly.
- Money check: nothing was built, signed or submitted; there were only Koios reads right after the restore. The restored wallet holds 0 ₳ private and 0 ₳ public, the true chain state for this phrase.
- Prior knowledge: none seen; the tester found that space advances by trying it.

**Final result.** The tester restored the wallet with no wrong turns: the panel handed over to a full tab, where all 24 words could be checked in plain, numbered text before Continue. The friction is the lack of any positive confirmation (phrase valid, passwords match, wallet restored), and the never-funded test phrase strengthened the doubt about whether this was the right wallet.

### T20b · Restore the wallet (full tab)

**Test notes.** Surface: a full browser tab, 1280x720. Starting state: a fresh install with nothing set up; the tester chose their own password; the wallet opened in a tab, the product's default. Data: the same 24-word phrase as T20a, generated by the wallet's own Create flow and never funded, so the restored wallet is truly empty (0 ₳ on both sides); the task didn't say whether it held funds. The task text told the tester that another participant starts in the narrow side panel (T20a). The harness prints one view after each command, so what shows only while keys are being typed (a suggestion list for an incomplete word, for example) isn't seen when a whole word goes in with one command. It also has no command to put the tester's own text on the clipboard. Nothing is submitted in this task. Main-run trace (it predates the harness fix for "Details" toggles; none was involved).

**Result.** PASS · confidence High · 0 wrong turns · 6 navigation steps · prior product knowledge needed: no, only what a recovery phrase is and that it goes in word order.

**Path taken.**
1. Ran stop, then start → the wallet tab showed the welcome screen: the Seedelf logo, "A private wallet for Cardano.", a teal "Create new wallet", a dark "Restore wallet" and a Network dropdown on Preprod.
2. Clicked "Restore wallet" → "Restore a wallet", "Step 1 of 2": "Restoring a wallet on Preprod. Change network", the Lace/Eternl/Yoroi note, "Tip: paste the whole phrase into any box.", the 12/15/24 words switch already on 24, a 4x6 grid of numbered boxes and Continue disabled.
3. Clicked box 1 and typed "exercise" → the word appeared in box 1 in plain monospace text; no suggestion list appeared.
4. Pressed Space → focus moved to box 2 on its own.
5. Typed the other 23 words key by key, separated by spaces (one `type` command) → each space moved to the next box, all 24 boxes filled and Continue turned teal (enabled); long words such as "abstract" and "envelope" fit without being cut off.
6. Read every box against the phrase, then scrolled down (the page had about 48 px more) → all 24 matched; only the version footer lay below Continue.
7. Clicked "Continue" → "Set a password", "Step 2 of 2", the password explanation, Password and Confirm password, a "Show" toggle and "Restore wallet" disabled.
8. Filled both fields with a 19-character password → a four-segment strength bar showed "Strong." and "Restore wallet" became enabled.
9. Clicked the Back arrow to check that the words could be re-reviewed before the final submit → Step 1, with all 24 words still filled in.
10. Clicked "Continue" again → Step 2, with both password fields now empty and "Restore wallet" disabled again.
11. Filled both password fields again → "Restore wallet" became enabled.
12. Clicked "Restore wallet" → Home opened at once on the "Private" tab, with no success message: "Updated just now", "Private balance 0 ₳", Receive active, Send, Make public and Create greyed, "Fund your public account first: it pays for your Seedelf", and the "Get started" card ("Your wallet has two sides: …", with steps 1 "Fund your public account" and 2 "Create your Seedelf").
13. Clicked the "Public" tab to check whether the restored wallet had any funds → "Public account 0 ₳", Send and Make private greyed, a "Staking and governance" card and "Create your Seedelf before making money private…".
14. Ran stop.

**Wrong turns.**
- None. Step 9's Back was a deliberate check, not a mistake.

**Hesitations.**
- Step 3: the boxes are announced as "combobox", but no suggestion list appeared as the tester typed, so they couldn't tell whether words were being checked against the word list.
- Step 6: nothing marked each word as valid and there was no "checksum OK" indicator; the only sign the phrase was accepted was Continue turning on, so the tester relied on reading the words themselves.
- Step 9: the final, irreversible-feeling button ("Restore wallet") is on Step 2, where the words can't be seen; the tester went Back just to make sure they could still review them.
- Step 12: no confirmation such as "Wallet restored"; 0 ₳ and "Fund your public account first" made the tester wonder briefly whether it had restored their wallet or made a new empty one.

**Observations.**
- Checking the words: all 24 words show unmasked in monospace, numbered 1-24 in a 4-column grid, on screen at once with Continue at 1280x720, so checking word by word was easy. Going Back from Step 2 keeps the words.
- No positive validation anywhere: no per-word check and no review step. Continue stays disabled until all 24 boxes are filled, then enables with no message; the tester never saw a validation or error state, because the phrase was correct. On trust: with no per-word or checksum check, the only proof the phrase was valid was that the restore went through.
- The final submit sits apart from the words: "Restore wallet" is on the password screen, with no summary of the phrase, so re-checking before submitting means remembering to go Back.
- Back clears the passwords: Back from Step 2 and then Continue wiped both password fields. The tester called it minor and arguably good for security, but said it punishes the careful user who goes back to re-check the words; they had expected going back and forward to keep everything.
- End of restore: no success message. Home with 0 ₳ and "Fund your public account first" reads like a brand-new wallet, and nothing like "found N transactions" confirmed the wallet was found or synced. The tester added that for a phrase with no history, that is expected.
- Terminology: step 1's "its first account becomes this wallet's public account" uses "public account" before the wallet's public and private sides are explained; it made sense only after Home's "Your wallet has two sides" card. "Restore wallet" was clear.
- Wallet structure: the tester expected one balance and one address, and got "Private" (the default view) and "Public", each with its own 0 ₳ balance, and a "Get started" card explaining the two sides.
- Screen-reader names say more than the visible labels: "Receive privately" and "Receive publicly" show "Receive", "Send privately" and "Send publicly" show "Send", and "Home" shows "Seedelf". By the tester's account, a sighted user has to rely on the selected tab to know which side they're on.
- Keyboard: Space moves to the next box, so typing the whole phrase in one go felt natural; "24 words" was already selected, where most other wallets default to 12.
- Worked well, per the tester: "Restore wallet" right under the primary button; "Step 1 of 2" and "Step 2 of 2"; the password screen's explanation of what the password does and doesn't do, its minimum length and the strength meter; "Restoring a wallet on Preprod. Change network" made the network clear.
- Harness suspicion (tester): the paste tip couldn't be tried, because the harness has no way to put the tester's own text on the clipboard.

**Answers the task asked for.**

| Question | Tester's answer from the UI | Verifier's check |
|---|---|---|
| Can you confidently verify every word you typed before submitting? | Yes (High). All 24 words show in plain, readable text in numbered boxes, on screen together with Continue, none cut off, and each matched. Caveats: no suggestions, ticks or "checksum OK" (Continue simply turns on); the final button is on Step 2 without the words, so re-checking means going Back, which keeps the words but clears the passwords. | Correct, and the words match the given phrase in order. One caveat is wrong because of the harness: real typing shows up to 5 suggestions while a word is incomplete, a non-word gets a red border, and Continue runs a word-list and checksum check before Step 2. What is really missing is any positive "valid" mark. |
| Was the wallet restored? | Yes (High): Home with "Updated just now", "Private balance 0 ₳" and, on the Public tab, "Public account 0 ₳"; no explicit "restored" message. | Correct. The restore ran with exactly the 24 given words, and 0 ₳ on both sides is right for this phrase. The product shows no "restored" message. |

**Verifier notes.**
- Result kept: PASS. The verifier called it borderline under the plan's "hesitation or inference" wording: of the four hesitations, one is a harness artifact and the Back step was voluntary; the step-12 doubt is real but brief, and the history-free test phrase amplifies it.
- Harness: no suggestion list at step 3. The tester typed each whole word in one command and the harness prints one view after it; the list closes once the text exactly matches a list word. A real user typing "exe" sees "execute" and "exercise". Words are also checked as typed: a box gets a red border as soon as no list word starts with its text, and Space advances only on a list word or a single completion, so Space advancing after every word silently showed that each word was on the list, though the UI never says so.
- Harness: the paste tip went untested (no clipboard command). Pasting a whole phrase into any box fills every box, switches the word count to the pasted length, empties the clipboard and puts focus on the last filled box.
- Misread: an enabled Continue wasn't acceptance. It enables once every box holds any text; clicking it runs the word-list check and the checksum check, and Step 2 opens only on success. The UI doesn't say so, which is part of the real no-positive-feedback finding.
- Exists-not-found: the per-word and whole-phrase checks the tester believed absent exist but show only on errors: a red border on a non-word, and an alert under the boxes, "Word N isn't on the list of recovery phrase words. Check its spelling." or "These words don't make a valid phrase. Check the spelling and the order." The phrase passed its check when Step 2 opened, before the password, not at the restore.
- Real: the final button sits on Step 2, which never shows the words again (the phrase is fully validated before Step 2). Back from Step 2 clears both passwords, because they belong to the password step, which is discarded on Back.
- Real: no "Wallet restored" message, and nothing reports the background account discovery a restore starts (there was nothing to find for this phrase). "Restoring your wallet…" and "Encrypting…" show only while busy; the harness's settle hid them during the roughly 1.1 s click, and they report progress, not confirmation.
- Real, amplified by the test data: an empty restored wallet looks exactly like a new one, and the Get started checklist shows until the wallet has a Seedelf and a private balance, however it was made. A real user restoring a used phrase would see their balances, which would act as confirmation.
- Real: "public account" appears on step 1 before Home first explains the two sides.
- Real but overstated: the visible labels are shorter than their accessible names, but the balance card's heading ("Private balance" or "Public account") directly above the buttons, and the third button ("Make public" or "Make private"), also name the side.
- Money check: nothing moved. There were only Koios reads right after the restore; no transaction was built, signed or submitted, and no fee was paid. Both balances were 0 ₳ and stayed 0 ₳.
- Prior knowledge: none seen. Pressing Space to advance was a general habit the tester stated; they tried it once and saw focus move before typing the rest with spaces.

**Final result.** The tester restored the wallet on the shortest path with no wrong turns and could check every word in plain, numbered text before Continue. What they recorded as friction is the absence of positive confirmation (per word, for the phrase, after the restore), the final button sitting on the password step without the words, and Back clearing the passwords; their "no suggestions" caveat is a harness artifact.

### E01 · Find an old transaction

**Test notes.** Surface: a full browser tab, 1280x720. Starting state: the funded wallet, unlocked; the tester was told they set it up some time ago and have used it since. In fact the funded preset restores the fixture phrase through the UI when the run starts (28 ₳ private, 10,408.014036 ₳ public including 57.475311 ₳ of rewards, staked with LOGIC), so this device's private history begins at that restore. Both histories come from fixture data; the verifier notes where that matters. Times show in the machine's time zone (UTC−7) with no zone displayed, and the fixture's transactions are dated September 2026. The tester got no environment note, and none was needed: the task moves no money, so the network's confirmation setting (never) didn't come into play. Main-run trace (it predates the harness fix for "Details" toggles; none was involved).

**Result.** PASS WITH FRICTION · confidence Medium · 1 wrong turn · 10 navigation steps · prior product knowledge needed: no, though the right answer depended on guessing that the Private/Public toggle splits the history and checking both sides.

**Path taken.**
1. Ran stop, then start → Home on the "Private" tab: "Private balance 28 ₳", Receive, Send, Make public and Create, a Tokens card, then "dApps" and "Activity" rows near the bottom of the screen.
2. Took a screenshot of Home → saw the "Activity" row, with a clock-history icon, near the bottom of the visible area.
3. Clicked "Activity" with the Private tab still selected (wrong turn) → "Private activity": "Kept encrypted on this device, never asked of Koios. It starts from when this wallet first saw each payment."; under "23 Sept 2026", "Already in your private balance +25 ₳ 14:46" and "Already in your private balance +3 ₳ and 1 token 14:46"; then an Export section with "Save as CSV".
4. Clicked the +25 ₳ row → a dialog: Amount "+25 ₳", When "23/09/2026, 14:46:40", "It was in your private balance when this device first read it, as after a restore, so who paid it isn't known.", a transaction id "a1a1a1a1a1a1a1…a1a1a1a1", "Copy" and "View on Cardanoscan"; no confirmed or pending status.
5. Closed it and clicked the "+3 ₳ and 1 token" row → the same time, "23/09/2026, 14:46:40", the token "+1,234,560,000 asset1aetp…kf6dul" with "Not on the wallet's list: it calls itself tUSDM, but it isn't the listed tUSDM."; no status.
6. Closed it and clicked Back → Home, Private tab. (after the point a normal user would have stopped)
7. Clicked the "Public" tab → "Public account 10,408.014036 ₳" with a list of tokens. (after the point a normal user would have stopped)
8. Scrolled down 500 px → found the "Activity" and "UTxOs" rows below the token list. (after the point a normal user would have stopped)
9. Clicked "Activity" → "Public activity" ("Read from Koios, which already knows this account, 20 transactions at a time."); the top entry was a Sent at 08:35 on 24 Sept; under 23 Sept, "Sent −25.177821 ₳ 23:07", "Received +10 ₳ 23:07", then several Sent rows. (after the point a normal user would have stopped)
10. Clicked "Received +10 ₳ 23:07" → a dialog: "Received", Amount "+10 ₳", From "addr_test1wz2te2wqn85yllvs69grz6a5fsc60pczywg8dg9gp6j2g6g7mzn9f", When "23/09/2026, 23:07:05", transaction id "5572e5a9d78545…61f271ff"; no confirmed or pending status. (after the point a normal user would have stopped)
11. Closed it and opened "Sent −25.177821 ₳ 23:07" to check whether it was the same transaction → a different one ("00676ecff9f323…f3b17c37", "23/09/2026, 23:07:54", Network fee "0.177821 ₳"), so the Received row is its own incoming payment. (after the point a normal user would have stopped)
12. Closed it and scrolled about 1600 px through Public activity → rows went back to 8 Aug 2026, with older Received rows ("+10 ₳ and 1 token 12:45" and "+5 ₳ and 1 token 12:42", in the 14 Sept to 10 Aug range) and "Load more" and "Save as CSV" at the end; no row anywhere was marked pending or confirmed. (after the point a normal user would have stopped)
13. Scrolled back up and hovered the "Received +10 ₳" row → no tooltip. (after the point a normal user would have stopped)
14. Ran stop.

The markers on steps 6 to 13 follow the tester's abandonment moment at step 3 ("I don't understand what this means", severity 3 of 5): "A normal user would likely stop at Private activity and report +25 ₳ at 14:46 as the latest incoming payment, without realising a separate Public activity list exists with a later payment. It isn't abandonment so much as stopping early with the wrong answer." The tester didn't flag individual steps as past that point.

**Wrong turns.**
- Step 3: clicked "Activity" while Home was on the Private tab, expecting one history covering all money in and out of the wallet; got only "Private activity", whose latest incoming payments were at 14:46 on 23 Sept, while a later incoming payment existed on the public side (23:07 the same day); corrected by remembering the Private/Public toggle on Home: Back, the Public tab, a 500 px scroll, then Public "Activity" (steps 6 to 9).

**Hesitations.**
- Step 3: both private rows show the same time, 14:46, and both details say 14:46:40, to the second, so the tester couldn't tell which counts as most recent.
- Step 4: the heading "Already in your private balance" and the note "It was in your private balance when this device first read it, as after a restore" made the tester unsure whether 14:46:40 is when the ADA arrived or only when this device first noticed it; the page header's "It starts from when this wallet first saw each payment" added to the doubt.
- Step 6: the tester had to decide whether "this wallet" meant only the private balance on screen or the public account as well; nothing on the Private activity screen mentions a separate public history.
- Step 10: neither detail dialog has a status line, so the tester had to infer that the payment is confirmed.
- Step 11: a Sent row and a Received row at the same minute, to the same address, made the tester wonder whether the "Received" was change from their own send, so they opened the Sent row to compare transaction ids.

**Observations.**
- Two histories: Home's "Activity" opens "Private activity" or "Public activity" depending on the selected tab, and neither screen says the other exists. A user looking at Private could wrongly conclude that the latest incoming payment was +25 ₳ at 14:46 on 23 Sept; the actual latest was the public +10 ₳ at 23:07 that day. The tester expected one history for the whole wallet, and found the split unexplained.
- On the Public tab the "Activity" row sits below the token list, off-screen (the tester scrolled 500 px to reach it); on the Private tab it is near the bottom of the first screen.
- No confirmation status: no entry and no detail dialog shows "Confirmed", "Pending" or a confirmation count ("No status vocabulary at all", in the tester's words), so whether a payment is confirmed can't be answered directly. Without a "Confirmed" indicator the tester couldn't be sure the payment was final; they took being listed with no pending marker as a sign that it was confirmed.
- The private incoming label: private rows say "Already in your private balance" where public rows say "Received". The tester found it wordy: it doesn't read as money coming in, and is easy to misread as a balance status.
- Transaction time: the tester expected the time the transaction landed on the chain. Private entries seemed to show when "this device first read it", which may not be the arrival time, while public entries appeared to show the chain time. The notes "who paid it isn't known" and "when this device first read it" made the private history feel less reliable as a record.
- Token figures disagree: Home (Private) shows the token as "asset1synt…ctusdm 1,234.56", while the private activity detail shows "+1,234,560,000 asset1aetp…kf6dul". Both the asset ID and the scaling differ, which made the tester doubt the data.
- "Koios" appears on both Activity screens without explanation.
- Detail contents: public details show Amount, From address, When (to the second), the transaction id with "Copy", and "View on Cardanoscan"; private details show Amount, When, a privacy note, the id, and a Cardanoscan link with a privacy warning. The private CSV export carries a long privacy warning; the public export notes it has only the 20 transactions loaded so far, and Public activity loads 20 at a time with "Load more".
- Worked well, per the tester: "Activity" is clearly labelled with a history icon on Home; incoming rows are easy to scan (green +amount, a down-left arrow and the word "Received"; Sent rows have a white −amount and an up-right arrow); a row opens a clear detail dialog with an exact timestamp, amount, counterparty and copyable id; rows are grouped under date headers.
- Harness suspicions (tester): the private entries' transaction ids (a1a1a1…, a2a2a2…) look like fake fixture data, and the token mismatch between Home and the private detail may come from fixture data rather than the UI.

**Answers the task asked for.**

| Question | Tester's answer from the UI | Verifier's check |
|---|---|---|
| What is the most recent time ADA came into this wallet? | Public activity, "Received" on 23 Sept 2026 (detail: "23/09/2026, 23:07:05"), from addr_test1wz2te2…7mzn9f, tx 5572e5a9d78545…61f271ff; the latest private incoming entries are earlier, two "Already in your private balance" rows at 23/09/2026, 14:46:40 (Medium). | Correct by the wallet's data. The time is UTC−7 (24/09/2026 06:07:05 UTC). The entries above it are Sent, and the private times are block times. Caveat: the sender is the Seedelf contract, so the 10 ₳ came out of a Seedelf private balance, possibly this wallet's own Make public; a restored device can't tell, and the screen doesn't say either way. |
| How much arrived? | "+10 ₳" (High). | Correct: +10 ₳ net into the public account, which spent nothing in that transaction. |
| Is it confirmed? | Probably yes (Low): the UI never says confirmed or pending; it is listed in Public activity, "Read from Koios", with no pending marker, and no entry in either list is marked pending. | Correct by inference: it is on chain, because Public activity lists only transactions Koios returns, which are already in blocks, and nothing was pending. No history entry ever shows a confirmation status; "Pending" appears only on the wallet's own send while it is being watched. |

**Verifier notes.**
- Result kept: PASS WITH FRICTION. The trace matches the command log and all eight screenshots, and the fixture artifacts touched only the private side without changing the answer.
- Real: each Home tab's "Activity" row opens only that tab's list, Home opens on Private when no tab is remembered, and neither Activity screen's note mentions the other list. The only cues are the titles "Private activity" and "Public activity" and the tabs on Home. The tester's diagnosis of the wrong turn is right.
- Real: on the Public tab the Activity row is below the fold (the harness's view reported about 470 px more below and listed no Activity control); it follows the staking card and the token list, which shows 5 of the 6 tokens plus "View all 6 tokens". How far down it sits depends on how many tokens the account holds.
- Real: history rows and details show no status. Entries appear only once on chain (public ones from Koios, private ones from the contract UTxOs the wallet found), so treating "listed" as "confirmed" is correct, but the UI never says so; the wallet's status wording for its own sends ("… sent. Waiting for the network…") never applies to a received payment.
- Real: "Already in your private balance" is the title for a received entry whose origin is unknown. Every private row has it here because the run started with a restore; a user who had used this device since setup, as the scenario says, would see "Received" for later payments from others and "Made private" for their own moves. A user who restores on a new device really does see this wording.
- Real (copy): the private "When" is the block time of the transaction that made the UTxO, not a first-read time; it reads 23/09/2026 although the restore ran at the start of the run. The copy explains which payments are listed and why the payer is unknown but never what the time means, so the doubt is a real copy problem. The tester's friction item, which says the note gives the timestamp as when this device first read it, claims more than the note says.
- Harness: the identical private times. Both private rows are synthetic fixture UTxOs sharing one block time; real payments show their own block times, which match only for payments in the same block. It didn't affect the answer.
- Harness: the placeholder ids a1a1…/a2a2…; a real user sees the payment's real 64-hex transaction id, which Cardanoscan can find.
- Harness: the asset-ID mismatch. Home shows the fingerprint the fake Koios returns, "asset1synt…ctusdm", which isn't the token's CIP-14 fingerprint; Activity computes "asset1aetp…kf6dul" itself. With real Koios both screens would show asset1aetp…kf6dul.
- Real: the scaling mismatch (1,234.56 on Home, +1,234,560,000 in the detail). Activity stores no decimals, so a token not on the wallet's list shows in raw units there while Home uses the decimals Koios reports. A real user sees this for any unlisted token Koios knows decimals for; the fixture's 6 decimals exposed it.
- Real: the step-11 doubt. addr_test1wz2te2…7mzn9f is the Seedelf contract's address, and Public activity names the other party by bare address only. After a restore, the wallet's own moves between its public account and its private balance show as plain Sent or Received, because it recognises its own flows only from this device's records. Change never appears as a separate Received, since each transaction is netted. The tester's check was right (two different transactions), but neither row says money moved between the public account and a private balance, and the UI gives no way to tell whether the +10 ₳ was this wallet's own Make public.
- Real: hovering a row shows no tooltip; "Koios" is unexplained.
- Harness (starting state): the funded preset is a fresh restore, while the scenario says the wallet has been used since setup. That is why every private row reads "Already in your private balance" and why the wallet's own earlier moves show in Public activity as Sent or Received to the Seedelf contract (the Sent −25.177821 ₳ at 23:07:54, and possibly the +10 ₳ the tester picked); the device that made them would title them "Made private" or "Made public", which can change which entry a user counts as ADA coming in.
- Harness (fixture data): the private and public histories don't form one consistent chain. Public activity shows a payment into the Seedelf contract (Sent −25.177821 ₳ at 23:07:54) with no counterpart in the private history, whose +25 ₳ is a placeholder dated 14:46:40; on a real chain, a payment into this wallet's own Seedelf would appear on the private side under the same transaction and time. So the order of private and public entries here isn't necessarily what a real wallet would show.
- Harness (display): no time zone is shown, so "23/09/2026, 23:07:05" (UTC−7) is 24/09/2026 06:07:05 UTC, and an answer key written in UTC would differ by a day. The printed view put a space before the last six characters of addresses in row names; the screen cuts them in the middle; no effect.
- Money check: nothing moved. No transaction was submitted; there were only Koios reads (at start, and account_txs and tx_info when Public activity opened; opening Private activity made no Koios request). Balances stayed 28 ₳ private and 10,408.014036 ₳ public.
- Prior knowledge: none seen; every target came from the view printed just before, and "Koios" appears in the report only after the UI showed it.

**Final result.** The tester found the latest incoming ADA, the public "Received +10 ₳" at 23/09/2026, 23:07:05, but only after a detour: the first Activity screen (Private) would have given the wrong answer, and no screen shows a confirmation status, so "confirmed" was an inference. The verifier confirmed the answer, adding that the 10 ₳ came from the Seedelf contract and may be the wallet's own Make public, which the restored device can't label.

### E02 · Lock the wallet and get back in

**Test notes.** Surface: a 360x640 window standing in for Chrome's side panel (a window of its own, not docked). Starting state: the funded wallet, unlocked, on Home's Private tab (28 ₳); the task text gave the wallet password. The tester saw only the scenario and goal ("Make sure nobody can use the wallet while you are gone. Then come back and get back into it."), not the task title, which says "lock". `press F5` reloads the panel's page; `open-wallet` stands in for clicking the extension's toolbar icon, and in this instance the harness had set the wallet to open in the side panel (per the verifier, a default install opens a full tab). Because the panel is a separate window, "Open in tab" shows as that window closing and a new 1280x720 tab window opening; in Chrome the docked panel closes and a tab opens in the same browser window. The "away" time was simulated: about 18 seconds passed between Lock and Unlock, so the idle auto-lock was never exercised. Nothing is built or sent in this task. Main-run trace (it predates the harness fix for "Details" toggles; none was involved).

**Result.** PASS · confidence High · 0 wrong turns · 6 navigation steps · prior product knowledge needed: no, only the common convention that a padlock icon locks an app.

**Path taken.**
1. Ran stop, then start, and looked at Home → unlocked, Private tab, "Private balance" "28 ₳"; three round icons at the top right (a gear, a padlock, an expand icon); the tester took the padlock to mean lock.
2. Hovered the padlock → tooltip "Lock".
3. Clicked "Lock" → at once a "Welcome back" screen: a "Password" field, a disabled "Unlock" button and "Forgot password? Restore from your phrase"; no balance or account details.
4. Pressed F5, to check that a reload doesn't get past the lock → still the locked "Welcome back" screen.
5. Clicked "Open in tab" (the expand icon), to see whether a full tab would show the wallet → the panel closed and a tab opened on the same locked "Welcome back" screen.
6. Closed the tab, as if walking away → no wallet windows open.
7. Ran open-wallet (the toolbar icon), as if back → the side panel opened on "Welcome back", with focus in the Password field.
8. Typed the password → "Unlock" turned from disabled to enabled.
9. Clicked "Unlock" → back on Home: Private tab, 28 ₳, the same tokens, "Updated just now".
10. Ran stop.

**Wrong turns.**
- None.

**Hesitations.**
- Step 1: the padlock shows no text, so the tester hovered before clicking to make sure it meant "Lock" and not something like security settings; the tooltip settled it ("It took a second, not real hunting").
- Step 3: the lock happened instantly, with no confirmation or message such as "Wallet locked". "Welcome back" made it clear enough, but the tester still wanted to check that the lock would hold if someone reloaded or opened the wallet in a tab, so tried both (steps 4 and 5).

**Observations.**
- The Lock control is a padlock icon with no visible label. The tester recognised it but hovered to confirm, and the tooltip says only "Lock", not what locking does (for example, that the password is needed to get back in).
- Nothing on screen confirms the lock or says it will hold: no "Locked" message, and nothing saying it stays locked if someone reopens the panel. Before leaving a computer in public the tester wanted that assurance and got it only by testing a reload, a full tab, and a close and reopen; all three stayed locked.
- Terminology: the locked screen's heading is "Welcome back". The tester expected something like "Wallet locked": "Welcome back" suits coming back but doesn't confirm, at the moment of locking, that it worked.
- Locking hides the balance, tokens and all navigation; only the password field, "Unlock", "Forgot password? Restore from your phrase", the Open-in-tab icon and "Seedelf Wallet 1.1.0 · Preprod" stay. Seeing the balance and tokens vanish made the tester trust that nobody could see or use the funds.
- "Unlock" stays greyed out until something is typed, so the reason is obvious; when the panel reopens, focus is already in the password field.
- Mental model matched on all three points the tester recorded: the padlock locks and asks for a password; the lock holds through reloads and reopening; the password returns you to where you were (Home, Private tab, 28 ₳, refreshed "Updated just now").
- The tester didn't look for an auto-lock or timeout setting under the gear, since the task needed only a manual lock.
- Worked well, per the tester: the padlock is always visible at the top right of Home; locking takes one click and is instant; unlocking returns to the same Home screen.

**Verifier notes.**
- Result kept: PASS. The trace matches the command log and the three screenshots step for step.
- Real: all three friction points. "Lock" is the button's only label and tooltip; locking shows no message of any kind; the Unlock screen says "Welcome back" after a manual lock, the idle auto-lock and a browser restart alike (its only lock-reason text is for a WebAssembly trap).
- Real, not a harness effect: the persistence the tester checked by hand. Lock clears the unlocked secret from the browser's session storage and frees the background worker's keys, and every page asks the worker on load, so a reloaded panel, a tab and a reopened panel all read "locked".
- Context the tester didn't need: the auto-lock setting they chose not to look for is under the gear, at Settings → "Security" → "Lock after", "15 minutes without activity" by default, with a "Locking in m:ss" countdown and "Stay unlocked" in its last 2 minutes. The only nearby text is "Closing the browser always locks it." Neither says that a manual lock survives a reload or a reopened panel, and neither shows when you lock.
- Closing the panel or tab does not lock an unlocked wallet (only Lock, the idle timer, a WebAssembly trap or closing the browser do), so the tester's "closed the tab, as if walking away" (step 6) was safe only because they had locked first.
- Unlock always lands on Home's Private tab, not on the screen where Lock was pressed (the Public tab, Settings or an open flow). It matched here only because the tester locked from Home's Private tab.
- Harness effects, none changing the outcome: in a docked Chrome panel F5 may go to the web page beside it (not verified), though a reloaded panel reads the same locked state; the hover reply printed the tooltip at once, while Chrome shows a title tooltip only after a delay and never on touch; the view's "Focus:" line is DOM focus and doesn't prove that a freshly opened docked panel takes keystrokes.
- Both of the tester's how-to answers (padlock "Lock" → "Welcome back"; password → "Unlock") were judged correct.
- Money check: nothing was submitted and no funds moved; only Koios reads, at start and right after Unlock; 28 ₳ private before and after.
- Prior knowledge: none seen.

**Final result.** The tester locked the wallet with the header padlock ("Lock"), checked by hand that the lock held through a reload, a full tab and a close and reopen, and got back in with the password and "Unlock", landing on Home with the 28 ₳ private balance. The friction they recorded is about reassurance at the moment of locking (an icon-only control, no confirmation that it locked, a "Welcome back" heading), not about finding the path.

### E03 · Disconnect a site

**Test notes.** Surface: a 360x640 window standing in for Chrome's side panel (a window of its own), active, with the Example Market test website (1280x720) open in a tab behind it; `windows` and `switch` move between them, and `open-website` would reopen the site. Starting state: the funded wallet, unlocked, on Home's Private tab (28 ₳), with the wallet's sites switch on. The harness preset had connected Example Market just before the run, through the site's own "Connect wallet" button, the wallet chooser and the real connector popup, choosing the public account; so the tester never saw the connect screen, and the connection was minutes old although the scenario says "earlier". The test browser has no address bar, so the page shows no domain. The test site never re-reads the wallet while open, keeps its "Connect wallet" button in its header while connected, and (a change made after the pilot) on each load asks the wallet it last connected to, through isEnabled(), and reconnects silently only if the answer is true, forgetting the wallet otherwise; so its "Not connected." after a reload reflects the wallet's own answer. The tester saw only the scenario and goal, not the task title, which says "disconnect". Nothing is sent in this task. Main-run trace (it predates the harness fix for "Details" toggles; none was involved).

**Result.** PASS WITH FRICTION · confidence High · 1 wrong turn · 12 navigation steps · prior product knowledge needed: no, only the general idea that wallets keep a list of connected sites, probably in settings.

**Path taken.**
1. Ran stop, then start → Home, Private tab: "Private balance 28 ₳", Receive / Send / Make public / Create, Tokens, and a "dApps" card at the bottom.
2. Took a screenshot and looked for anything about connected sites → the only candidate was the "dApps" card.
3. Clicked "dApps" (wrong turn) → a dApps page: "Used privately, from one-time accounts", Minswap and Lovejoin cards, text about one-time accounts, and "On a dApp's own site, connect Seedelf Wallet and choose a private session: the site then sees a one-time account, and it's listed here."; Example Market wasn't there.
4. Scrolled down the dApps page (still the wrong turn) → only the version footer; no connected sites.
5. Tried to click the Settings gear → refused: the header had scrolled out of view.
6. Scrolled up and clicked Settings → "Network", then "Wallet" with "Public accounts", "Contacts", "Collateral"; about 1740 px more below.
7. Scrolled down 400 px → "Preferences": "Language", "Open Seedelf Wallet in", "Show ADA's value in".
8. Scrolled down 400 px → the "Sites and mixing" section: "Sites" ("On: sites can ask to connect") and "Lovejoin".
9. Clicked "Sites" → the Sites page: a "Let sites connect to Seedelf Wallet" switch (on), an "Ask for your password to sign for a site" switch (on), and a "Connected sites" row.
10. Clicked "Connected sites" → one entry: "dapp.example", "Your public account · since" the day of the run, and a "Disconnect" button.
11. Ran windows and switched to the website, to see whether its name or domain matched "dapp.example" → no domain anywhere on the page (no address bar); it still showed itself connected, seeing "10,350.538725 ADA and 6 tokens".
12. Switched back to the wallet and hovered "Disconnect" → no tooltip.
13. Clicked "Disconnect" → a confirmation: "Disconnect dapp.example?", "dapp.example has to ask again before it sees anything more. It keeps what it already saw.", with "Keep it" and a red "Disconnect the site".
14. Clicked "Disconnect the site" → the list now said "No site is connected. A site asks when it wants to, and you choose."
15. Switched to the website → still "Connected to Seedelf Wallet", with the address and balance; the tester worried the disconnect hadn't worked.
16. Pressed F5 on the website → "Not connected.", the site's log "isEnabled() -> false", "Buy item - 15 ADA" and "Sign in with wallet" disabled, and "Connect a wallet to buy."
17. Clicked "Connect wallet" on the site → the site's "Choose a wallet" dialog, listing Seedelf Wallet.
18. Clicked "Seedelf Wallet" in the chooser → a wallet popup: "Connect a site", "dapp.example", "Example Market (test site) · https://dapp.example", "Choose what the site sees", with "Connect" disabled until a choice is made; this confirmed that dapp.example was Example Market.
19. Clicked "Cancel" in the popup → "Nothing's waiting.", then the popup closed; the site showed "The wallet did not connect: The user declined. (code -3)" and logged "enable() -> refused (code -3)".
20. Switched to the wallet → Connected sites still said "No site is connected."; ran stop.

**Wrong turns.**
- Step 3: clicked the "dApps" card on Home, expecting a list of the sites and dApps connected to the wallet, Example Market included, with a way to remove it; got a page of built-in private-use dApps (Minswap, Lovejoin) and an explanation of one-time accounts, without Example Market, and, in the tester's words, a note that "said only sites connected through a private session appear there"; corrected by scrolling to confirm nothing more was there (step 4), then opening the Settings gear and digging down to "Sites and mixing" > "Sites" > "Connected sites".

**Hesitations.**
- Step 2: Home has no "Connected sites" entry, so the choice was between "dApps" (the bottom card) and the unlabelled gear; the tester picked dApps because a connected website seemed like a "dApp".
- Step 4: logged as an abandonment moment ("I don't know what to do", severity 2 of 5): the dApps page, the one obvious place for sites, didn't list Example Market, and a less persistent user might decide the wallet has no way to manage site connections.
- Step 6: Settings is a long page (about 1740 px of scrolling), and the site controls are under "Sites and mixing", two screens down, next to the unrelated Lovejoin mixing setting.
- Step 9: the most obvious control on the Sites page is the big "Let sites connect to Seedelf Wallet" switch; the tester briefly considered turning it off, but that would block every site, not just this one. "Connected sites" is a smaller row at the bottom.
- Step 10: the site was listed as "dapp.example", not "Example Market", and the website shows no domain, so the tester couldn't be sure it was the right site and disconnected it only because it was the only entry; only the reconnect popup later showed "Example Market (test site) · https://dapp.example" together.
- Step 15: the open website still said "Connected to Seedelf Wallet" with the address and the 10,350 ADA balance, and the tester wasn't sure the disconnect had worked until they thought to reload. Logged as an abandonment moment ("This seems broken", severity 3 of 5): a user who doesn't think to reload might believe the disconnect failed.

**Observations.**
- Where connections live: the tester expected a "Connected sites" or "Connected apps" entry on Home or in the dApps section. The dApps page lists only private-session dApps, and public-account connections are three levels deep: the icon-only Settings gear > scroll two screens to "Sites and mixing" > "Sites" > "Connected sites". Nothing on Home or in the header says a site is connected.
- Terminology: calling them "dApps" in one place and "Sites" in another made the tester pick the wrong section first.
- Site identity: the list names the site by its domain only, "dapp.example"; the site's title "Example Market", which the connect popup knows, appears only there. As a harness suspicion, the tester noted that with an address bar they could have compared the domain, so the mismatch might cause less hesitation.
- Effect on an open page: the tester expected the site to show itself disconnected at once; it kept its earlier connected state until reloaded, then showed "Not connected." with isEnabled() false. Seeing it still connected shook the tester's confidence until the reload.
- "Can no longer see": the confirmation's "It keeps what it already saw" is honest, and the tester trusted it more than a promise that everything was erased, but it means the goal is only partly possible (the site already knows the public addresses and balance), and nothing suggests what else to do, for example using a new public account.
- The website had seen the public account ("10,350.538725 ADA and 6 tokens") while Home showed "Private balance 28 ₳"; the connected-sites row correctly said "Your public account".
- The reconnect popup was the only place showing the site's title and domain together; a new attempt went back through a full approval rather than reconnecting silently.
- Hovering "Disconnect" showed no tooltip. The website kept its "Connect wallet" header button while connected, which the tester put down to the website, not the wallet.
- Worked well, per the tester: once found, the list showed exactly one entry with a clear "Disconnect" and which account the site could see; the confirmation was clear, with the destructive action in red; the empty state says plainly "No site is connected."; reconnecting needs fresh approval, with "Connect" disabled until a choice is made.

**Answers the task asked for.**

| Question | Tester's answer from the UI | Verifier's check |
|---|---|---|
| Can Example Market still see or use the wallet, checked from the website's side? | No (High). After the disconnect and a reload the site shows "Not connected.", logs "isEnabled() -> false", and "Buy item - 15 ADA" and "Sign in with wallet" are disabled. Clicking Connect made the wallet ask again; the tester cancelled and the site showed "The wallet did not connect: The user declined. (code -3)". The wallet's Connected sites says "No site is connected." Per the wallet, the site "keeps what it already saw" (the public address and balance). | Correct. The cut-off took effect at the disconnect itself, not at the reload: from then on the wallet refuses every call from that origin except isEnabled and enable, and enable opens a new approval. The site keeps what it read while connected: the network id, the used address addr_test1qq...mqkt5dmn "and 3 more", and "10,350.538725 ADA and 6 tokens". |

**Verifier notes.**
- Result kept: PASS WITH FRICTION. The goal was met and checked from the site's side; no claim was put down as a misread.
- Real: the wrong turn and the step-4 abandonment moment. The dApps page lists only open private sessions with sites and has no link to Connected sites. Its note doesn't say "only", but nothing else is ever listed there, so the tester read it correctly. Nothing on Home mentions connected sites.
- Real: Connected sites is at Settings > "Sites and mixing" (the third section) > "Sites" > "Connected sites". The gear shows no text but has a hover tooltip and the accessible name "Settings". The header scrolls with the page, so the step-5 refusal is what a real user meets too.
- Real, made worse by the harness: the domain-only listing. The wallet stores no title for a site, deliberately (a site chooses its own title; the popups show the host first and the title second). The missing address bar, and a test domain that doesn't echo the site's name as most real dApp domains do, made the step-10 doubt worse than it would typically be.
- Real: the stale page at step 15. The cut-off was immediate; the banner was the page's own memory of what it read earlier, which matches "It keeps what it already saw". The wallet's injected API has no events, so it never tells an open page anything, and no wording mentions open pages or reloading. The test site never polls; a real dApp that polls would get a refusal on its next call and might show it, so how stale a page looks depends on the site.
- Exists, not found: the only in-product pointer to Connected sites is the connect popup's hint "You can disconnect it in Settings, under Connected sites.", behind the "What this means" icon beside "Connect a site". The tester's view listed that icon at step 18, but they didn't open it, and since the preset made the original connection they never saw that screen while connecting.
- The tester was right not to use the "Let sites connect" switch: turning it off refuses every site's calls but keeps Example Market's record, and turning it back on would reconnect the site without asking.
- Real: no tooltip on "Disconnect" (trivial: its label says what it does), and nothing after "It keeps what it already saw" suggests a next step.
- Harness: the site's "Connect wallet" header button while connected is the test site's quirk; the list's "since" date is the day of the run, contradicting the scenario's "earlier" (the tester didn't remark on it); the panel being a separate window meant switching windows to see the page, whereas in Chrome the stale page would sit beside the docked panel.
- Verifier extra, not a tester claim: the Connected sites card has no inner padding, so "dapp.example" and the "Disconnect" chip touch the card's border (the list's `padding: 0` overrides the section's padding).
- Money check: nothing was submitted and no funds moved; disconnecting only changes the wallet's local record of sites. The tester never clicked "Buy item - 15 ADA" or "Sign in with wallet".
- Prior knowledge: none seen.

**Final result.** The tester disconnected Example Market through Settings > "Sites and mixing" > "Sites" > "Connected sites" > "Disconnect" > "Disconnect the site", and confirmed it from the website after a reload ("Not connected.", isEnabled() false, and a fresh approval needed to reconnect, which they cancelled). The friction: the dApps page first, the site listed only as "dapp.example", and the open page still showing itself connected until reloaded.

### E04 · Withdraw staking rewards

**Test notes.** Surface: a 360x640 window standing in for Chrome's side panel. Starting state: the funded wallet, unlocked, on Home's Private tab (28 ₳). A harness override set the staking rewards to 12.345678 ₳, so the public account showed 10,362.884403 ₳ including them; staked with LOGIC, voting power "Always abstain". The task said "Do it (you may confirm if you are comfortable)". The network confirms only on the tester's command: the task offered `world confirm` ("makes the network put your submitted transaction into a block, as would happen within about a minute in real life"), to use only after submitting something and looking at what the wallet shows right after. Transactions paid by the public account complete normally here (the refusing outside service affects only spends from the private balance), so this task could finish end to end, and no environment note was given. The tester saw only the scenario and goal, not the task title, which says "withdraw". Main-run trace (it predates the harness fix for "Details" toggles; none was involved).

**Result.** PASS WITH FRICTION · confidence Medium · 1 wrong turn · 7 navigation steps · prior product knowledge needed: no, they had to infer that staking belongs to the Public side, which a basic crypto user could guess from the two tabs.

**Path taken.**
1. Ran stop, then start → Home, Private tab: "Private balance 28 ₳", Receive / Send / Make public / Create, a Tokens card with an unlisted tUSDM token, and dApps; nothing about staking.
2. Scrolled down the Private tab looking for staking (wrong turn) → only "Activity" and "UTxOs" buttons and the version footer.
3. Scrolled back up and clicked the "Public" tab → "Public account 10,362.884403 ₳", with "Includes 12.345678 ₳ of staking rewards" in small grey text beneath, and a card "Staking and governance", "Staking with LOGIC", "Voting power: Always abstain".
4. Clicked "Staking and governance" → "Your pool" "LOGIC · Logical Mechanism"; "Your ADA stays in your public account, free to spend: the pool never holds it. …"; "Rewards" "12.345678 ₳"; "Spent along with anything your public account pays, or withdrawn here. Settings can keep them here instead."; a large "Withdraw rewards" button.
5. Clicked "Withdraw rewards" → "Review: withdraw rewards": "Nothing is sent until you press Withdraw 12.345678 ₳", "Rewards withdrawn 12.345678 ₳", "Network fee 0.171749 ₳", "Public account after 10,362.712654 ₳", "Your balance stays the same, but for the fee: these rewards were already counted in it.", "This is public: it names your public account."
6. Clicked "Transaction details" → "The transaction" dialog: "Spends 1 UTxO"; "Pays 1 output" to addr_test1qq8ac7…kt5dmn, labelled "#0 · a key that stakes", 15.173929 ₳; "Network fee 0.171749 ₳".
7. Scrolled down in the dialog → "Size 372 bytes (161 of body)", "Signed 2 signatures, not sent yet", "Withdraws rewards" stake_test1urj40…324ywz 12.345678 ₳.
8. Clicked Close → back on the same review.
9. Clicked "Withdraw 12.345678 ₳" → back on the Public Home: "Reward withdrawal sent. Waiting for the network…" with a spinner and a Cardanoscan link; the balance still 10,362.884403 ₳ with "Includes 12.345678 ₳ of staking rewards"; "Send" and "Make private" greyed out, with "Wait for the last transaction to confirm" below them.
10. Ran world confirm, then waited 3 s → the harness reported the block (5212001), but the wallet still showed "Waiting for the network…"; no change yet.
11. Waited 15 s → a green "Rewards withdrawn" banner with "Dismiss"; "Public account 10,362.712654 ₳"; the "Includes … staking rewards" line gone; Send and Make private enabled again.
12. Opened "Staking and governance" again to check → "Rewards 0 ₳", "Withdraw rewards" greyed out.
13. Ran stop.

**Wrong turns.**
- Step 2: looked for staking on the default Private tab and scrolled down it, expecting a staking or rewards section somewhere on the main Home screen; got no staking at all on the Private tab, only "Activity" and "UTxOs"; corrected by guessing that staking would belong to the "Public" side and switching tabs.

**Hesitations.**
- Step 3: seeing "Includes 12.345678 ₳ of staking rewards" under the Public balance, the tester wondered whether the task was already done, since the rewards seemed to be counted in the balance already.
- Step 4: "Spent along with anything your public account pays, or withdrawn here" told the tester the rewards could already be spent, so why withdraw? They went ahead because "Withdraw rewards" was the only action that matched "get my rewards". Logged as an abandonment moment ("I don't understand what this means", severity 2 of 5): a normal user might decide there is nothing to do and leave without withdrawing, or hold back from paying a fee for a withdrawal that seems pointless. The tester wouldn't have quit, because Withdraw is plainly offered, but the reason to press it is unclear.
- Step 5: "Your balance stays the same, but for the fee" meant withdrawing would make the balance go down by 0.171749 ₳; the tester paused over paying a fee for no visible gain and decided it was acceptable because it moves the rewards into ordinary spendable funds.
- Step 7: the output went to an address labelled only "a key that stakes", not "your public account", so the tester had to trust it was their own; and "Signed 2 signatures, not sent yet" showed the wallet had already signed without asking for the password, which surprised them a little.
- Step 10: right after the block was made the wallet still showed "Waiting for the network…" and the old balance with "Includes 12.345678 ₳ of staking rewards", and for a moment the tester wasn't sure it had worked; it updated about 15 seconds later.

**Observations.**
- Mixed message: the Home balance already "Includes 12.345678 ₳ of staking rewards" and the staking screen says rewards are "Spent along with anything your public account pays", so the goal looks already done, yet "Withdraw rewards" is offered. The tester couldn't tell whether withdrawing was needed and ended unsure whether all they had done was pay a 0.171749 ₳ fee, the reason they gave for Medium confidence. They had expected wording like "Claim rewards" or "Rewards available to withdraw".
- Mental model: the tester expected rewards to sit in a separate pot, not spendable until withdrawn, after which the spendable balance would rise by the reward amount. The wallet counts them in the Public balance already, and withdrawing lowered the shown balance by the fee (10,362.884403 → 10,362.712654 ₳): honest, and the review warned, but it "feels backwards" when you're trying to "get" rewards.
- Where staking lives: not on the default Private tab, and nothing there points to it; it is a "Staking and governance" card that appears only on the Public tab. The tester also noted that the wallet opens on Private although the Public balance (10,362 ₳) is much bigger than the Private one (28 ₳).
- "Settings can keep them here instead." was cryptic: the tester didn't know what keeping them "here" would mean or why they'd want that.
- Trust in the destination: in Transaction details the output is labelled "#0 · a key that stakes", which doesn't say it is the user's own public account, so the tester couldn't easily check that the funds were coming back to them.
- Signing: the tester expected to be asked for the password before signing; no prompt came, and the details already said "Signed 2 signatures, not sent yet" before they confirmed, which made them a little uneasy that the wallet signs before confirmation.
- After the block, the wallet took about 15 more seconds to notice it, with Send and Make private greyed out meanwhile ("Wait for the last transaction to confirm"). As a harness suspicion, the tester thought this probably normal polling, not a harness problem.
- The review screen was clear and well laid out: amount withdrawn, fee, balance after, a plain explanation, the privacy note, and a big teal confirm button showing the amount; "Nothing is sent until you press Withdraw 12.345678 ₳" reassured. The tester trusted it because "Public account after" matched the balance they ended with exactly.
- Prior knowledge declared: general Cardano knowledge (rewards build up in a reward account and must be withdrawn) made the tester expect a Withdraw step and choose Public over Private; no knowledge of this wallet's design.
- Worked well, per the tester: the rewards line on the Public balance; the easily seen card and the big, plainly labelled "Withdraw rewards"; clear feedback after sending and after confirmation, with Send greyed out and a reason given while pending. Unrelated to the task, they liked the flag on the unlisted token, "Calls itself tUSDM, not on the wallet's list".

**Verifier notes.**
- Result kept: PASS WITH FRICTION. Every printed view matches its screenshot, nothing was misread, and all the friction is real product behaviour.
- Real: whether a withdrawal is needed. With the default setting "Use staking rewards when spending" (on), Home's public total counts the rewards and any public payment withdraws them in the same transaction, so a manual withdrawal is optional, and no screen says why someone would make one. The tester's suspicion is correct by the wallet's design: the net effect was paying a 0.171749 ₳ fee to turn 12.345678 ₳ of rewards into an ordinary UTxO, and under the wallet's own model the goal was met before the tester did anything. The copy itself is accurate.
- Where the setting is: "Settings can keep them here instead." refers to Settings → "Staking" → "Use staking rewards when spending" (on by default), which the staking page neither names nor links. The tester never opened Settings and didn't claim it was missing. That Settings section holds only the switch, with no link to the staking page; the Public tab's card is the only way in.
- Real: the output labelled "#0 · a key that stakes" really is the wallet's own public receive address #0 (its stake credential is the withdrawn reward address's), but Transaction details describes addresses by their shape and never marks an output as the user's own.
- By design: in-wallet transactions are signed at review while the wallet is unlocked and only submitted on the button, as the review's "Nothing is sent until you press …" says. A password re-prompt exists only for signing for sites.
- The post-block lag is real, as the tester guessed: the wallet checks a pending transaction every 15 s, so a real user gets the same lag of up to 15 s. It showed only because the harness made the block on command 4.5 s after submission and announced it; a real user can't tell when a block lands (a real block takes about 20 s; the review says "about a minute"). The outcome wasn't distorted.
- Money check: one transaction, accepted and confirmed in block 5212001 (372 bytes, fee 0.171749 ₳). It spent one 3 ₳ UTxO of the wallet's, withdrew 12.345678 ₳ from the wallet's reward address, and paid a single output of 15.173929 ₳ back to the wallet's own receive address #0; no certificates, votes, tokens, datum or metadata. The public total went from 10,362.884403 to 10,362.712654 ₳, down exactly the fee (rewards 12.345678 → 0; UTxO holdings 10,350.538725 → 10,362.712654 ₳). The private balance (28 ₳) was untouched and nobody else was paid.
- All three answers the tester recorded (rewards 12.345678 ₳; moved into the spendable balance; cost 0.171749 ₳, with no deposit) were judged correct.
- The staking page's lower part (voting power, Stop staking) was never in view; the task didn't need it.
- Prior knowledge: none of the product's. The declared Cardano knowledge probably made the tester more willing to press Withdraw despite the "already counted" copy; a user without it might have stopped at the Public balance and thought the job done, which under the default setting would not actually be wrong.

**Final result.** The tester withdrew the 12.345678 ₳ of rewards through the Public tab → "Staking and governance" → "Withdraw rewards" → "Withdraw 12.345678 ₳", paying a 0.171749 ₳ fee, and after world confirm saw "Rewards withdrawn", "Public account 10,362.712654 ₳" and "Rewards 0 ₳", exactly as the review predicted. They remained unsure whether withdrawing was needed at all; the verifier confirms that, under the default setting, it wasn't.

### E05 · Understand a failed refresh

**Test notes.** Surface: a 360x640 window standing in for Chrome's side panel. Starting state: the funded wallet, unlocked, on Home's Private tab (28 ₳ private; the public account 10,408.014036 ₳ including 57.475311 ₳ of rewards). Backend "fail-after-load": the wallet's start-up read succeeded, then, from the moment the starting state showed, the fake Koios answered every request with HTTP 503 for the whole task; so the first screen's "Updated just now" was true, and no retry could succeed. `press F5` reloads the panel's page. The view is printed once things settle after each command, so short-lived states ("Trying…", a spinning icon) show only when a command lands inside them. Main-run trace, made before the harness fix for "Details" toggles: `role=button name="Details"` matched nothing although the view listed a "Details" button, and `text="Details"` worked (step 6). The tester saw only the scenario and goal, not the task title, which says "failed refresh". Nothing is sent in this task.

**Result.** PASS WITH FRICTION · confidence High · 2 wrong turns · 11 navigation steps · prior product knowledge needed: no, the stale balance and the advice to retry needed nothing, though "Koios" and "503" take outside knowledge or the Settings privacy text.

**Path taken.**
1. Ran stop, then start → unlocked on the Private tab: "Updated just now" with a refresh icon beside it, "Private balance 28 ₳", a Tokens list; no warning of any kind.
2. Hovered the "Updated just now" text → no tooltip.
3. Hovered the circular-arrows icon beside it → tooltip "Read the chain again"; the label now read "Updated 12 s ago".
4. Clicked Refresh → the label changed to "Updating…" and Refresh went disabled.
5. Waited 5 s and took a screenshot → a yellow-bordered warning box at the top: "Couldn't refresh: these are your balances as last read", a green "Try again" link and a "Details" toggle; below it, "Updated 22 s ago".
6. Clicked "Details" (the first try missed because of a remote-control targeting quirk; the second worked) → "Koios is having trouble right now (503 for account_info). Try again in a minute."
7. Clicked the "Public" tab, to see whether the public side was affected too → the same warning stayed at the top; "Public account 10,408.014036 ₳", "Includes 57.475311 ₳ of staking rewards", "Updated 32 s ago".
8. Opened Settings (gear), looking for a network or server option (wrong turn) → "Network" (Mainnet / Preprod), "Public accounts", "Contacts", "Collateral".
9. Scrolled down Settings about 2,000 px → reached About and the privacy text "The wallet only ever talks to Koios and giveme.my, …", which told the tester what Koios is; no way to choose a different data source.
10. Tried to click Home (the Seedelf logo) (wrong turn) → refused: "That control isn't in the visible area right now (it is above)."
11. Scrolled up and clicked Back → Home (Public tab), and the warning box was gone: only "Updated 57 s ago", although nothing had refreshed.
12. Waited 60 s (two 30 s waits), as the message asked → "Updated 1 min ago"; no automatic refresh visible.
13. Clicked Refresh again → it failed again and the warning came back: "Couldn't refresh: these are your balances as last read", "Updated 2 min ago".
14. Opened "Details", then clicked "Try again" (the command log shows two clicks, about 15 s apart) → the button changed to "Trying…" (disabled) and the label to "Updating…", then it failed again with the same Koios 503 message.
15. Clicked the Private tab and scrolled down → the rest of Home: Tokens, dApps, Activity, UTxOs.
16. Opened "Activity" → "Private activity", "Updated 2 min ago" and two incoming items (+25 ₳; +3 ₳ and 1 token); no error banner on this page.
17. Clicked Back, then pressed F5 to reload the panel → "Updating…", then the same warning: "Couldn't refresh: these are your balances as last read", "Updated 2 min ago".
18. Ran stop.

**Wrong turns.**
- Step 8: went into Settings looking for a way to fix it (switch server, network status), expecting a node or provider setting or a connection status; found no such setting, only the privacy text saying the wallet talks to Koios, which explained the name but gave nothing to do; corrected by scrolling back to the top and clicking Back to Home.
- Step 10: tried to click the Seedelf logo / Home at the bottom of Settings, expecting to go back to Home; the header isn't fixed in place, so it had scrolled away and couldn't be clicked; corrected by scrolling up about 2,000 px and using the Back arrow.

**Hesitations.**
- Step 1: the task says the wallet isn't updating, but the screen said "Updated just now" with no warning, and the tester didn't know where to look until they pressed Refresh themselves. Logged as an abandonment moment ("I don't know what to do", severity 2 of 5): had they not thought to press Refresh, "Updated just now" would have convinced them all was fine, and they'd have stopped looking without finding the problem.
- Step 6: "Koios is having trouble right now (503 for account_info)": the tester didn't know what Koios was (part of the wallet, or their own setup?); "503" and "account_info" are developer terms; only "Try again in a minute" was something they could act on.
- Step 11: back from Settings, the warning had vanished, and for a moment the tester wondered whether it had fixed itself; only the still-climbing "Updated 57 s ago" said it hadn't.
- Step 14: after the 6 s wait the tester couldn't tell whether the first "Try again" had done anything, as the screen looked identical; only watching straight after clicking showed "Trying…". Also logged as an abandonment moment ("I don't know what to do", severity 2 of 5): after waiting and retrying twice, the only advice was still "Try again in a minute"; a normal user would give up here and come back later, a reasonable outcome, but the wallet offers nothing else to do.

**Observations.**
- Freshness: the tester expected the wallet to say up front if it couldn't update. The warning appeared only after they pressed Refresh, so someone who never presses it would see no sign of a problem. Afterwards "Updated N ago" kept counting from the last good read, through failed refreshes: a reliable clue, but small grey text.
- Error persistence: the tester expected a "couldn't refresh" warning to stay until a refresh succeeded. It disappeared after a visit to Settings although nothing had been fixed, and the Activity page shows "Updated 2 min ago" with no warning, so nothing there says a refresh failed. The vanishing warning cost some trust: the tester briefly thought the problem had cleared.
- "Couldn't refresh: these are your balances as last read" was very clear to the tester: the figures shown are old but still the last-known real balances, which reassured them that no money had gone. The warning applied to both tabs and stayed when switching between them.
- Who "Koios" is: the cause sits behind a small "Details" toggle in developer wording ("Koios", "503", "account_info"). The tester expected an error in their own terms (the network or server is down, "temporarily unavailable") and learned that Koios is the wallet's data service only from the privacy text at the bottom of Settings. They drew on general web knowledge that a 503 means a server is temporarily unavailable.
- What can be done: the tester expected to retry, perhaps switch servers or check a status page. The only remedy offered is "Try again" and "Try again in a minute", with no status page and no other server, and after a few minutes of failures they didn't know what else to do.
- A failed retry looks exactly like the failure before it (same text, same Details); only a brief "Trying…" or "Updating…" shows that it retried, so after waiting it's hard to tell whether "Try again" did anything.
- Settings is long (about 2,000 px) and its header scrolls away, so getting back meant scrolling all the way up.
- The Refresh icon's tooltip "Read the chain again" was understandable; the "Updated …" text has no tooltip. Reloading the panel gave the same failure, which told the tester the problem was consistent, not a stuck screen.
- Harness suspicions: the "Details" targeting quirk; and every refresh failing with the same 503 looked like a deliberately set-up fake-backend outage, with the first "Updated just now" coming from a successful read at session start.
- Worked well, per the tester: the plain-language failure message, saying exactly what the shown numbers mean; a freshness label that doesn't reset on a failed attempt; the visible "Trying…" state, with Refresh disabled during a read; "Details" keeping the technical cause out of the way but available, with a concrete next step.

**Answers the task asked for.**

| Question | Tester's answer from the UI | Verifier's check |
|---|---|---|
| Is the balance being shown current? | No (High). After Refresh the wallet said "Couldn't refresh: these are your balances as last read", and the label kept counting ("Updated 22 s ago" … "Updated 2 min ago"); the figures (Private 28 ₳, Public 10,408.014036 ₳) are from the last successful read, when the session started. | Correct. The only successful read was at session start (at step 1 the figures really were fresh); every later read failed. By the end they were about 3 minutes old; the label rounds minutes down, so it said "2 min ago". Nothing changed on the fake chain, so they were still accurate, but the wallet couldn't confirm that. |
| What went wrong? | "Koios is having trouble right now (503 for account_info)." From the Settings privacy text, Koios is the outside service the wallet reads the blockchain from, so it's that service's problem, not the wallet's or the funds'. (High) | Correct. Koios, the fixed third-party service the wallet reads Cardano through, answered every read with HTTP 503 from the moment the starting state showed (the harness's fake outage); each read was retried twice and then failed at account_info. Neither the wallet nor the funds were at fault. |
| What can be done about it? | "Try again in a minute", with "Try again" or the Refresh icon ("Read the chain again"); meanwhile the balances shown are the last ones read. Nothing else is offered: no way to switch provider. Retrying after a minute, and reloading, still failed. (High) | Correct. Wait and retry: "Try again", the Refresh icon, or reopening Home more than a minute after the last read, which reads again by itself. No other provider, status link or setting exists. The fake outage never lifted, so no retry could succeed in this run. |

**Verifier notes.**
- Result kept: PASS WITH FRICTION. Every string, label and age the tester quotes matches the command log, the screenshots and the wallet's text. Of the tester's two main deductions, the first (no warning until Refresh) is mostly a harness artifact and the second (the warning vanishing) is real; the result stands on the second and the other real friction.
- Harness, mostly: no warning until Refresh (the step-1 hesitation and abandonment moment, the first friction point, the freshness model). The harness let the start-up read succeed seconds before the fake outage began, so "Updated just now" was true. A real user opening the wallet during an outage gets the banner by itself, from the read Home makes when it opens with a kept reading over 60 s old; the step-17 reload showed exactly that, with no click. With no kept reading at all (after a lock) the banner says "Couldn't read your balances" instead. The real residue is narrower: Home doesn't poll while it stays open, so an outage that starts with Home open goes unnoticed until Refresh, or until Home is reopened more than a minute after its last read; meanwhile only the climbing "Updated N ago" shows the age. The verifier suggests starting from a kept reading older than 60 s with the outage already on, to test the real case.
- Harness: the outage that never lifts. Real Koios 5xx outages are usually brief, so a retry a minute later would often work; the never-ending 503 sharpened the step-14 abandonment moment. The lack of any other remedy is the product's: one fixed Koios address per network, no setting to change it, no status link.
- Real: the warning vanishing after Settings. Home keeps the failure in its own state; Settings replaces Home outright, which drops it, and on return Home reads again only if its last reading is over 60 s old. The tester came back at about 57 s, just under that threshold; a few seconds later Home would have re-read and shown the banner again. Per the verifier, screens drawn inside Home (Activity, Tokens, UTxOs) keep the failure, so the banner is back on returning to Home (though Activity itself doesn't show it; next point); only Settings, a reload or a lock drop it.
- Real: Activity carries no warning for Home's failure. Private Activity opens from the kept reading without asking Koios; it has its own banner, "Couldn't read your activity", with Try again and Details, which appears only after Activity's own Refresh fails (the tester didn't press it there).
- Real: the wording behind Details is deliberate (the service's own name and status code wait under Details), but "Koios is having trouble right now…" lacks the explanation its sibling messages give ("Koios, the service the wallet reads Cardano from"). The headline is plain. The tester's conclusion that Koios is the outside data service is right.
- Real: a failed retry leaves no trace (no time or attempt count is shown). The "Trying…" window lasts about 4 s (three attempts), with the refresh icon spinning.
- Misread: the step-14 hesitation. The reply to the first "Try again" click already showed "Trying…" (disabled), "Updating…" and Refresh disabled; the tester missed it. The underlying point, that nothing remains once a retry has failed, is real.
- Real: Settings has no provider, endpoint or status control, so step 8 found nothing because there is nothing to find; the header isn't sticky, so the step-10 refusal is what a real user meets; no automatic refresh while Home stays open (step 12) is by design; the "Updated …" text has no tooltip.
- Harness: the "Details" role mismatch cost one retry and carries no UX signal (a real click opens it first time). The view, printed after 5 to 6 s waits, mostly missed the roughly 4 s "Trying…" state, which fed the step-14 hesitation; a real user watching would see the spinner throughout.
- Money check: nothing was submitted and no funds moved; only reads, all failing after the start-up read. The balances never changed (28 ₳ private; 10,408.014036 ₳ public including 57.475311 ₳ of rewards).
- Prior knowledge: none seen (the 503 reading is general web knowledge, and the tester declared it).

**Final result.** The tester found that the balances weren't current only after pressing Refresh ("Couldn't refresh: these are your balances as last read", with "Updated … ago" climbing to 2 min), learned the cause under Details ("Koios is having trouble right now (503 for account_info)"), and concluded that the only remedy was to wait and retry, which kept failing through a minute's wait, two retries and a reload. The verifier kept PASS WITH FRICTION: the "no warning until Refresh" point is mostly the harness's timing, while the warning vanishing after a visit to Settings, the developer wording and the lack of any remedy beyond retrying are real.

## 4. Abandonment moments

There were 43 moments, in 23 of the 29 runs; T02, T13, T17, T18, T20b and E02 had none. 35 come from the product and are merged below into 25 entries. 8 come from the test environment and are listed at the end. By type, across all 43: 14 "This seems broken", 13 "I don't know what to do", 10 "I don't understand what this means", 3 "I don't trust pressing this button" and 3 "I might lose money". Severities ran from 2 to 4.

Each entry also says how it stands against the earlier usability reviews (Appendix B), a classification made after the blind runs; it doesn't change what the testers saw.

Ranking, most serious first:
- Wrong money figures the verifier confirmed as defects come first (entries 1 and 2). They show money that isn't there to anyone who looks at that moment, whatever score one tester gave them.
- Then the highest severity a tester gave: 4 (entry 3), then 3 (entries 4 to 9), then 2.
- Within a severity, by type, in order of what is at stake: "I might lose money", "This seems broken", "I don't trust pressing this button", "I don't understand what this means", "I don't know what to do". Doubts about money and about whether the wallet works come before doubts about a word or a route.
- Then by how many runs hit the moment, then by how many moments.

An entry that merges moments ranks by its highest severity and, at that severity, its most serious type.

**1. While a send is pending, the balance rises above its pre-send figure**
- Tasks: T08 (step 17). Type: "This seems broken". Severity: 3.
- Moment: the tester sent 25 ₳ and pressed Refresh. Home showed "Public account 10,440.31465 ₳", with "35.300614 ₳ of this is on its way: your last transaction isn't confirmed yet" and still "Includes 57.475311 ₳ of staking rewards". That is 32.3 ₳ more than before the send, against the review's "Public account after 10,382.839339 ₳".
- Why it's serious: the figure matches no real state. The verifier confirmed a display defect: Home adds the change, which already holds the withdrawn rewards, on top of the unchanged rewards. The tester would have stopped trusting the balance until confirmation, and expected a normal user to fear being charged twice. "Use staking rewards when spending" is on by default, and every payment from the funded public account in this test withdrew rewards (T04, T04b, T07, T08), so any Refresh during such a send can show this figure.
- Earlier reviews: regression: reported before and marked fixed, seen again here (Appendix B).

**2. "Sent +32.300614 ₳" for a 25 ₳ payment**
- Tasks: T08 (step 24). Type: "I don't understand what this means". Severity: 3.
- Moment: after confirmation, Public activity listed the payment as "Sent +32.300614 ₳", and its detail read "Amount +32.300614 ₳, Network fee 0.174697 ₳, Staking rewards collected 57.475311 ₳". The 25 ₳ that was actually paid appears nowhere.
- Why it's serious: a plus sign under "Sent" suggests money moved the wrong way, or the wrong amount left. The verifier confirmed that Activity nets outputs against inputs and ignores the withdrawal. Every public payment that withdraws rewards will be listed at a wrong amount; T04's would have read "Sent +45.300614 ₳".
- Earlier reviews: partly reported before; part of it is new (Appendix B).

**3. "No Cardano wallet was found on this page."**
- Tasks: T15 (step 2). Type: "This seems broken". Severity: 4.
- Moment: the tester clicked Example Market's "Connect wallet" with Seedelf Wallet installed, unlocked and open beside it, and the site found no wallet. Nothing in the wallet said why. Sites is off by default ("Off: sites can't see Seedelf Wallet"), and the switch is in Settings → "Sites and mixing" → Sites, about 850 px down. The only other notice is on the Private tab's "dApps" row, which the tester never opened (exists-not-found).
- Why it's serious: this is the only product moment scored 4. In the tester's words, "A normal user might decide the wallet doesn't support dApps, or is broken, and leave." They got past it only by searching through Settings. Two caveats: the sentence is the test site's, not the wallet's, and a long-time user, as the scenario describes, would often have turned Sites on already. This measures a first connection.
- Earlier reviews: partly reported before; part of it is new (Appendix B).

**4. The most the private balance can send**
- Tasks: T05 (steps 15 and 24). Type: "This seems broken" (step 15); "I don't understand what this means" (step 24). Severity: 3, 3.
- Moment: the review showed a 0.271986 ₳ fee, yet 26.1, 26.2, 26.3 and 26.5 ₳ (out of 28 ₳) were all refused with "Not enough ADA in your private balance for this and its fee.". Private Send has no Max for ADA. Adding the token to the payment didn't visibly help, and nothing said why.
- Why it's serious: the message contradicts the arithmetic, so it looks like a bug. The real rule is that the change must keep its minimum ADA, 1.64642 ₳ while it holds the token, and the wallet never states it. The check also uses an estimated fee near 0.29 ₳, not the 0.271986 ₳ on screen, so even a user who knows the rule can't work out the maximum from the screen; that is why the tester's reasoned 26.081594 ₳ was refused (verifier). The tester needed about 15 guesses, ended with Low confidence, and still doesn't know whether 26.06 ₳ is the true maximum. Most people would settle for a round number. The tester concluded that sending the token can't help; that is a misread, because sending it lowers the floor to about 1.457 ₳.
- Earlier reviews: partly reported before; part of it is new (Appendix B).

**5. Still no wallet after turning Sites on**
- Tasks: T15 (step 12). Type: "This seems broken". Severity: 3.
- Moment: with "Let sites connect" now on, the site's "Connect wallet" still found no wallet. The tester reloaded on a guess. No wallet text says an open page must be reloaded; the wallet adds itself only to newly loaded pages (verifier).
- Why it's serious: in the tester's words, "Some users would give up here rather than think to reload." The tester got through on general CIP-30 knowledge.
- Earlier reviews: new in this test (Appendix B).

**6. A disconnected site still shows itself as connected**
- Tasks: E03 (step 15). Type: "This seems broken". Severity: 3.
- Moment: after "Disconnect the site", the wallet said "No site is connected.". The open Example Market tab still said "Connected to Seedelf Wallet", with the address and the 10,350 ADA balance, until the tester reloaded it.
- Why it's serious: the user can't tell whether the disconnect worked. The wallet sends the site no event and says nothing about reloading (verifier). The test site never re-reads; a dApp that polls would get a refusal on its next call, so how plainly a real site shows the change varies.
- Earlier reviews: new in this test (Appendix B).

**7. Paying an ordinary address starts at the wrong Send**
- Tasks: T04 (step 1), T06 (step 2), T04b (step 4). Type: "I don't know what to do" (T04, T06); "I don't understand what this means" (T04b). Severity: 2, 2, 3.
- Moment: Home opens on Private, where the filled "Send" is the obvious action. T04's tester judged that someone without "publicly" in their goal "would most likely have pressed the private Send". That Send's only field is "Seedelf name" (T06, T04b). Pasting an address gives "That's an ordinary address, not a Seedelf's name. Send pays Seedelfs; Make public pays any address from your private balance, and that payment shows at their end." with a "Pay it with Make public" button. Nothing mentions the public account's Send (T04b).
- Why it's serious: T04b's tester thought a normal user "could easily give up here or switch wallets, because 'make public' sounds like exposing something". Two of their four wrong turns are real (the Private Send, pasting the address); the other two came from the harness (the fake giveme.my's refusal of the Make public payment, and a "Details" click). With a working giveme.my the tester would most likely have paid from the private balance through Make public and never learned that the public account has an ordinary Send (verifier). T04 avoided all of this only because of its title.
- Earlier reviews: partly reported before; part of it is new (Appendix B).

**8. Two activity lists, and the first one gives the wrong answer**
- Tasks: E01 (step 3). Type: "I don't understand what this means". Severity: 3.
- Moment: asked when ADA last came in, the tester opened Activity from the Private tab and saw "Private activity", where the latest incoming entry was +25 ₳ at 14:46. A later "Received +10 ₳", at 23:07 the same day, was only in "Public activity", below the fold on the Public tab. Neither list mentions the other.
- Why it's serious: the user stops with a wrong answer and doesn't know it. The preset was a fresh restore, so the order of the entries isn't representative, but the split itself is real.
- Earlier reviews: reported before and still open (Appendix B).

**9. What a mix costs**
- Tasks: T11 (step 8). Type: "I don't understand what this means". Severity: 3.
- Moment: on the Lovejoin page, "Mixing 10 ₳ costs about 3.8 ₳, 38% of it" sits above "Into a one-time account 15.3 ₳, and 5 ₳ of collateral", and nothing reconciles the two.
- Why it's serious: the user can't tell what is tied up and what is lost. Per the verifier, the 15.3 ₳ is the box, the mix estimate and an unnamed 1.5 ₳ reserve; the 3.8 ₳ covers the mixes only; and the box's return fee isn't on the page. With a 38% headline, the tester thought this "might make a normal user give up on mixing even with an available pool".
- Earlier reviews: partly reported before; part of it is new (Appendix B).

**10. After a send, nothing on Home or in Activity changes**
- Tasks: T04 (step 11), T07 (step 12), T08 (step 14). Type: "This seems broken" (T04, T08); "I might lose money" (T07). Severity: 2, 2, 2.
- Moment: the tester had just pressed Send (T04, T08) or "Make 20 ₳ private" (T07) and was back on Home. The balances were still the pre-send ones (Public 10,408.014036 ₳, Private 28 ₳), and Public activity had no entry. In T08 the Activity screen didn't show the pending banner either. The only signs that anything had happened were Home's "Payment sent. Waiting for the network…" (or "Payment into your private balance sent. Waiting for the network…") and the greyed-out actions.
- Why it's serious: all three testers flagged this as a point where a user would doubt the payment went out (T08: "For a moment I feared the payment had vanished"), and the disabled Send is what stopped a retry (T04, T07). The "X ₳ of this is on its way" line exists for exactly this case, but it appears only after a manual Refresh (T08), because Home doesn't re-read after a send (T07 verifier); on a staked account with rewards, that Refresh can show the double count in entry 1. Private activity did show "Pending" (T07). The public side shows nothing until the network confirms.
- Earlier reviews: regression: reported before and marked fixed, seen again here (Appendix B).

**11. The swap review has no total**
- Tasks: T10 (step 20). Type: "I might lose money". Severity: 2.
- Moment: on "Review the swap", several things compete for attention:
  - The bold "For the swap 16 ₳" looks like the total but leaves out "Kept aside for contracts 5 ₳", which is listed beneath it, and the 0.233208 ₳ network fee.
  - "Three transactions, three network fees" gives a figure only for the first.
  - "Bring it back through Lovejoin" is on, next to a note that Lovejoin "hasn't had a third-party audit".
  - The minimum comes with "Seedelf Wallet relies on Minswap for the minimum of 897.61792 MIN: it asks Minswap for it, but can't read it back from the order Minswap builds".

  The tester added up the outputs in Transaction details and got 21.233208 ₳ leaving.
- Why it's serious: one "Start swap" approves three transactions. Unlike the reviews for both Sends, Make public, Make private and Create a Seedelf, it has no "Total leaving your private balance" or "Private balance after" row (verifier).
- Earlier reviews: reported before and still open (Appendix B).

**12. A payment comes in and the balance stays at 0 ₳**
- Tasks: T01 (step 15), T03 (step 8). Type: "I don't trust pressing this button" (T01); "This seems broken" (T03). Severity: 2, 2.
- Moment: the sender had confirmed a payment (50 ADA in T01, 100 ADA "from an exchange" in T03). Home still showed 0 ₳ with "Updated 59 s ago" (T01), and in T03 also "Fund your public account first". It stayed that way until the tester found the small, unlabelled refresh icon. T02 waited the same way for a private payment (a hesitation).
- Why it's serious: a new user's first deposit looks lost, or sent to the wrong address. Home never re-reads balances while it is open (verifier). The harness's instant blocks made the gap easier to notice but didn't cause it.
- Earlier reviews: partly reported before; part of it is new (Appendix B).

**13. No visible sign that Create Seedelf was sent**
- Tasks: T03 (step 13). Type: "This seems broken". Severity: 2.
- Moment: after "Create Seedelf", Home came back scrolled about 200 px down. The balance was unchanged and "Create your Seedelf before making money private" was still showing. The "Seedelf creation sent. Waiting for the network…" banner was there, above the visible area (verifier).
- Why it's serious: the tester said they "might have been tempted to try again"; the greyed-out Create link helped.
- Earlier reviews: new in this test (Appendix B).

**14. A retry during the decline cooldown is refused, and the wallet shows nothing**
- Tasks: T17r (step 6). Type: "This seems broken". Severity: 2.
- Moment: the tester pressed "Cancel" on the connect prompt and retried "Connect wallet" straight away (about 7 s later in this harness). No wallet window opened. The site showed "The wallet did not connect: The user declined this site just now. It can ask again in 3 s. (code -3)".
- Why it's serious: only the site explained what happened, by printing the wallet's CIP-30 text. In the tester's words: "If the site hadn't passed on the wallet's 'It can ask again in 3 s' text, I would have thought the wallet had blacklisted the site". Many dApps show only a code. T17 missed the cooldown because its retry came about 14 s after the decline.
- Earlier reviews: regression: reported before and marked fixed, seen again here (Appendix B).

**15. An outside party, and a privacy caveat, on private-spend reviews**
- Tasks: T04b (step 7), T16 (step 8). Type: "I don't trust pressing this button" (T04b); "I don't understand what this means" (T16). Severity: 2, 2.
- Moment: the Make public review says "Send asks giveme.my to lend the collateral, then submits." (T04b). The private-session funding review says "giveme.my is asked to lend the collateral" and "This payment links the private UTxOs it spends to the one-time account, as Make public does" (T16). Neither says who giveme.my is, whether it costs anything, or whose money "the collateral" is. T06, T09 and T10 hesitated at the same line.
- Why it's serious: an unexplained outside party inside a private payment is what makes a cautious user back out. T16's tester chose the private option in order to be private, and was left "unsure whether this is private at all". The explanation exists only in Settings → Collateral, and nothing links to it (T09). Nothing anywhere says whether giveme.my charges (verifier, T16).
- Earlier reviews: partly reported before; part of it is new (Appendix B).

**16. "Signed 3 signatures, not sent yet" before the user had confirmed**
- Tasks: T12 (step 21). Type: "I don't trust pressing this button". Severity: 2.
- Moment: the tester opened Transaction details on "Review: start staking" and read that the transaction was already signed, though they hadn't confirmed anything or typed a password. T14, T14r and E04 noted the same "Signed 2 signatures, not sent yet" (as hesitations and trust items).
- Why it's serious: signing at review is by design for an unlocked wallet, and "Nothing is sent until you press Stake with LOGIC" reassured the tester. But "signed" reads as consent already given. Together with no password prompt for the wallet's own sends (T04, T07, T08), it lowered trust in several runs. In the pilot, the environment note had told the T04 tester the password would be needed "to approve things", which set up that expectation (T04 verifier); later runs were told it only "in case the wallet asks for it".
- Earlier reviews: reported before and still open (Appendix B).

**17. The refusal headline names the wrong cause, and a second refusal leaves nothing to do**
- Tasks: T09 (steps 7 and 11). Type: "I don't understand what this means" (step 7); "I don't know what to do" (step 11). Severity: 2, 2.
- Moment: seconds after reviewing, Send gave "Nothing was sent. Something it spends may have been spent or changed since you reviewed it: make a new review to send it.". giveme.my's refusal ("Transaction Fails Validation") appeared only under a small "Details". "Refresh and review again" produced an identical review, with no advice in case it was refused again.
- Why it's serious: the tester briefly wondered "whether some other transaction had spent my money". The wallet shows this headline for any giveme.my refusal, an outage included (verifier). Testers also met it in T04b, T05, T06 and T16, where the harness forced the refusal.
- Earlier reviews: new in this test (Appendix B).

**18. "Staking rewards moved into your balance … already counted in it"**
- Tasks: T07 (step 7). Type: "I don't understand what this means". Severity: 2.
- Moment: on the Make private review, this row read as if 57.475311 ₳ of rewards were being moved or spent, and it didn't say which balance it meant. T04, T04b and T08 paused at the same row (hesitations).
- Why it's serious: a cautious user might back out. Only "Total leaving your public account 20.178349 ₳" reassured the tester.
- Earlier reviews: regression: reported before and marked fixed, seen again here (Appendix B).

**19. Why withdraw rewards at all?**
- Tasks: E04 (step 4). Type: "I don't understand what this means". Severity: 2.
- Moment: the Public balance already "Includes 12.345678 ₳ of staking rewards". The staking screen says they are "Spent along with anything your public account pays, or withdrawn here". The review says "Your balance stays the same, but for the fee".
- Why it's serious: the user can't tell whether withdrawing does anything except cost a fee. With "Use staking rewards when spending" on, it mostly doesn't (verifier), and no screen says when it would matter.
- Earlier reviews: new in this test (Appendix B).

**20. Staking and voting aren't on the tab Home opens on**
- Tasks: T12 (step 2), T14r (step 2). Type: "I don't know what to do". Severity: 2, 2.
- Moment: both testers landed on the Private tab and found nothing about staking (T12) or voting (T14r). They reached the "Staking and governance" card only by trying the Public tab. T14 and E04 took the same wrong turn and T13 hesitated at the same point, without recording an abandonment moment.
- Why it's serious: "A user who doesn't think to try the Public tab might assume this wallet can't stake" (T12), or "can't vote" (T14r). The explanation that private money can't be staked appears only at the bottom of the staking screen (T12).
- Earlier reviews: reported before and still open (Appendix B).

**21. Swaps and mixing only behind "dApps"**
- Tasks: T10 (step 4), T11 (step 2). Type: "I don't know what to do". Severity: 2, 2.
- Moment: neither Home tab has a Swap or Mix action. The only way in is the Private tab's "dApps" row, cut off at the bottom of the first screen at 360x640, then Minswap → "New swap", or Lovejoin. The Public tab has no dApps row, and T10 searched it first because that is where the money was.
- Why it's serious: a normal user "might decide the wallet doesn't support swaps" (T10), or "has no mixer" (T11). T10's tester also read "dApps" as external websites, not built-in features.
- Earlier reviews: reported before and still open (Appendix B).

**22. "dApps" doesn't list connected sites**
- Tasks: E03 (step 4). T17 and T17r took the same wrong turn without recording a moment. Type: "I don't know what to do". Severity: 2.
- Moment: looking for where to disconnect Example Market, the tester opened "dApps". It showed Minswap and Lovejoin, with a note that only sites on private sessions appear there.
- Why it's serious: "A less persistent user might decide the wallet has no way to manage site connections." The list is at Settings → "Sites and mixing" → Sites → "Connected sites". The only pointer to it is the connect prompt's ⓘ ("You can disconnect it in Settings, under Connected sites."). E03's tester never saw that prompt, because the preset had made the connection.
- Earlier reviews: reported before and still open (Appendix B).

**23. Private Receive on a new wallet: no Seedelf, and Create disabled**
- Tasks: T01 (step 7). Type: "I don't know what to do". Severity: 2.
- Moment: on a new wallet, the big "Receive" on the default Private tab said "People pay a Seedelf's name, and you don't have a Seedelf yet", with "Create a Seedelf" disabled.
- Why it's serious: there is nothing to hand out. The "Show my public address" button right below made giving up unlikely. T03 nearly pressed the same Receive (a hesitation).
- Earlier reviews: reported before and still open (Appendix B).

**24. No sign of accounts on Home**
- Tasks: T19 (step 1). Type: "I don't know what to do". Severity: 2.
- Moment: with one account, Home shows no account name or switcher. Adding an account is under Settings → "Public accounts", through "Look for the next account" and then "Add Account 2".
- Why it's serious: "A user who doesn't think to look in Settings could conclude the wallet doesn't support multiple accounts."
- Earlier reviews: new in this test (Appendix B).

**25. After repeated failures, only "Try again in a minute"**
- Tasks: E05 (step 14). Type: "I don't know what to do". Severity: 2.
- Moment: retries, a minute's wait and a reload all gave "Couldn't refresh: these are your balances as last read", with the same "Koios is having trouble right now (503 for account_info)" under Details.
- Why it's serious: there is nothing else to try: no status page and no alternative (verifier). The fake outage never lifted, which made this sharper; real outages are usually brief.
- Earlier reviews: partly reported before; part of it is new (Appendix B).

### Caused by the test environment (not product findings)

**H1. A private payment's final Send is refused.** T04b (step 12; "This seems broken"; 3), T06 (step 8; "This seems broken"; 2), T16 (step 13; "This seems broken"; 3). The screen said "Nothing was sent. Something it spends may have been spent or changed…"; in T16, "Nothing was sent: something it spends may have changed since you reviewed it.". Reason: the fake giveme.my refuses every collateral request. With the real service, T04b and T06 would have paid and T16's session would have been funded. The headline's wording is a real finding (entry 17).

**H2. A listed pool can't be read.** T12 (step 13; "This seems broken"; 2): HODLr, from "559 live pools", gave "Couldn't read the pool's details just now". Reason: the fake Koios had no details for a pool in its own list. Real Koios has details for every listed pool, and a retired one would show "This pool has retired: it earns nothing now. Choose another."

**H3. No proposal can be understood.** T14 (step 17; "I don't understand what this means"; 4): every action said "Koios has no title or summary for it.", and both "Read its full text" and "See it on Cardanoscan" opened "Page not available". Reason: the recorded preprod proposals had no metadata, and the harness blocks outside pages. With metadata, the T14r tester could decide. What remains real: the missing titles are what preprod Koios returned for these actions, since it hadn't read their anchors. Any action Koios has no text for looks like this, and its only route to the text is the outside link, which the wallet never fetches itself (verifier; see section 5, Governance).

**H4. A treasury withdrawal with no amount or recipient.** T14 (step 14; "I might lose money"; 3). Reason: the recorded rows lacked the withdrawal field. In T14r the detail page showed the amount and the recipient stake address. In any case, a DRep vote never moves the voter's own funds.

**H5. A restored wallet that looks new.** T20a (step 10; "I don't know what to do"; 2): 0 ₳ on both sides and no "restored" message. Reason: the test phrase was never funded; a funded phrase shows its balance on the first read. The missing confirmation is a real but minor point, and T20b hesitated at the same moment.

**H6. "Updated just now" during an outage.** E05 (step 1; "I don't know what to do"; 2). Reason: the harness let the first read succeed before the outage began; a wallet opened during an outage shows the warning by itself. What remains real: Home doesn't re-read while it stays open, so an outage that starts while Home is open goes unnoticed until Refresh.

## 5. Mental-model failures

### Public vs Private
- Expected: one wallet, with one balance, one Send, one Receive and one history (T01, T04, T04b, E01, T20a, T20b). T01 guessed the two tabs were "a privacy setting, or something to do with public and private keys".
- What the wallet does: two balances on two tabs. Home opens on Private every time the panel opens (verifier, T13), and in a full tab too (T14r, E01). Each tab has its own Receive, Send, actions and Activity. The selected tab and the balance heading name the side, but the buttons read just "Receive" and "Send". The words "privately" and "publicly" appear only in the buttons' accessible names, which the harness printed and a sighted user never sees (T01, T04, T04b, T06, T08, T20a).
- Where it failed: the expectation that the tab you land on shows everything. Get started, the only place on Home that explains the two sides, disappears once the wallet has a Seedelf and private money; after that, nothing on the Private tab says a public side exists (T04 verifier).
  - 11 runs looked on Private for something that lives on Public: wrong turns in T01, T04b, T12, T14, T14r, E01 and E04, hesitations in T03, T04, T07 and T13.
  - T10 did the reverse, searching Public for a swap that only Private reaches.
  - The rerun exposed the problem. In T04 the title word "publicly" hid it; untitled, T04b's tester didn't open Public until the private route had failed.
- Smaller mismatches:
  - The nouns differ: "Private balance" against "Public account" (T01, T07).
  - The header's "Public account" picker shows while the Private tab is selected (T15).
  - After "Show my address" and after public-paid submits, Home switches to the Public tab without saying so (T03).
  - Settings' "Public accounts" made T19 wonder whether private accounts are managed somewhere else.
- Where it held: on a new wallet, Get started's one sentence carried the idea of two sides (T01, T03), and the reviews' "Total leaving your public account" / "… private balance" named the side (T04, T04b).

### Seedelf
- Expected: the brand, or an account name (T02); "some kind of private account" (T03); a handle like a username (T02, T03).
- What the wallet does: a Seedelf is something you own. It has a 64-character "whole name" and a public "tag", has ADA locked with it, can be removed, and can be paid only from Seedelf Wallet. On T02's path the word is never defined. The definition ("a name people can pay you by privately") is in the "Get started" checklist, which a set-up wallet no longer shows, and behind the ⓘ on Create a Seedelf (exists-not-found).
- Where it failed:
  - "Seedelf name", as Private Send's only field, stopped T04b and T06.
  - The "name" is the hex string, while the readable "web-wallet" is the "tag" you must not share, and it is shown below the hex (T02).
  - T01 saw the no-Seedelf private Receive and the public Receive warning ("To be paid privately, give out one of your Seedelfs' names instead"). Neither says that an ordinary wallet can't pay a Seedelf name, so T01 never learned it (exists-not-found).
  - "A Seedelf's name is public, and linked to whatever paid to create it", next to "Nobody can tell a payment to it is yours", left T02 unsure how private it is. "Manage" holds only Remove, which made them wonder whether the shared name would keep working.
- Where it held:
  - The tag warning worked: T02 shared the right thing on the first try.
  - "Only someone using Seedelf Wallet can pay this" taught who can pay (T02).
  - T03 learned from the checklist that the Seedelf comes before making money private. But "Make private" stays enabled before a Seedelf exists, with the warning only under it (T03).

### Make private and Make public
- Expected: Make private to be a "Deposit" or "Add" on the Private side (T07). Make public to mean moving one's own money to the public balance (T06), or flipping a privacy setting that would expose something (T04b).
- What the wallet does: "Make private" lives on the source side, the Public tab. "Make public" pays any address or $handle from the private balance, "and that payment shows at their end".
- Where it failed:
  - Testers reached Make public only through Private Send's redirect (T04b, T06), and still found the name wrong for paying a friend; T06 expected "Send", "Pay" or "Withdraw".
  - The note "Making money public where it came from links it back. Send it somewhere else, or keep it private." read as a warning against what they were doing (T04b, T06).
  - T16's review leans on the term ("…as Make public does") for a user who had never met it.
- Where it held: once found, Make private was direct (T07: 0 wrong turns, High confidence; T03 got there through the checklist). And T06 answered correctly which feature pays an address.

### Pending money
- Expected: the balance drops at once or shows a pending amount, and Activity lists the payment as pending (T04, T04b, T07, T08). Money paid in shows up on its own (T01, T02, T03).
- What the wallet does: Home keeps its last reading until the network confirms, and Public activity lists nothing until then. Private activity marks its entry "Pending" (T07), though the entry's detail drops the word. Incoming money waits for Refresh. After a block, the screen catches up at the wallet's next 15-second check (T07, E04); a Refresh in between updates the balances while "Waiting for the network…" and the held actions stay (T03).
- Where it failed:
  - T08 refreshed in the middle of a send and saw 10,440.31465 ₳, a verified double count of the withdrawn rewards.
  - T08 couldn't tell whether "35.300614 ₳ of this is on its way" was leaving or coming back.
  - The UTxOs list had dropped the spent UTxO and didn't show the change (T08).
  - After confirmation, the history said "Sent +32.300614 ₳". The 25 ₳ actually leaving appeared on no screen while the send was pending.
- Where it held: every tester could tell a send was pending and that the next one had to wait ("Wait for the last transaction to confirm"), and T07 and T08 answered those questions correctly. The confirmed balances matched the reviews exactly (T04b, T07, T08).

### Staking rewards
- Expected: rewards sit apart until they are withdrawn, and a payment moves only its amount and fee (T04, T07, E04).
- What the wallet does: rewards are counted in the public balance ("Includes 57.475311 ₳ of staking rewards"). With "Use staking rewards when spending" on, every public payment withdraws them in the same transaction, shown as "Staking rewards moved into your balance … already counted in it".
- Where it failed:
  - Four testers stopped to check that nothing extra was leaving, and T07 couldn't tell which balance "your balance" meant (T04, T04b, T07, T08).
  - E04 couldn't see why to withdraw rewards that are already "Spent along with anything your public account pays". Their suspicion that withdrawing only cost a fee is right, by design (verifier).
  - "Settings can keep them here instead." doesn't name the setting (E04).
  - A site's balance leaves the rewards out (CIP-30 reports the UTxO balance), and T15 had to work out the 57.475311 ₳ difference.
  - T08's double count comes from the same automatic withdrawal.
- Where it held: Stop staking withdraws the rewards in the same transaction and says what is lost, and T13 understood it exactly. E04's review ("Your balance stays the same, but for the fee") was honest and matched the result.

### dApp private sessions
- Expected: "A toggle or mode that hides my balance and addresses from the site, with no money moving", free or for one small fee (T16).
- What the wallet does: it funds a new one-time account from the private balance with an on-chain payment (the amount, plus "5 ₳ kept aside", plus a network fee), gives the site only that account, and later brings the money back, through Lovejoin "as Settings has it".
- Where it failed:
  - The option was found at once, and "The site sees only a new one-time account" is clear. But the note that "anyone, the site included, can follow the money back into your private balance, and money you made private yourself leads on to your public account" read as contradicting it, so the tester doubted how private the session is (T16).
  - The connect screen's ⓘ only explains how to disconnect (T16).
  - The way back has no cost figure at the point of choosing (T16).
  - The change (3.766792 ₳) didn't match the tester's arithmetic, because the review doesn't show the value of the UTxO it spends (T16, verifier).
  - T17 and T17r chose public for "No fee", and nothing says why someone would want a session (verifier, T17r).
  - Swaps use the same idea, and only the private balance pays for them (T10).
- Untested: the fake giveme.my refused the funding, so no session was created, and what a connected session looks like to the user is unknown (T16, BLOCKED).

### Lovejoin
- Expected: a "Mix" or privacy action on Home, and one cost figure (T11).
- What the wallet does: Lovejoin is a tile under the Private tab's "dApps". Its page shows the pool's readiness above the fold ("Lovejoin's pool: 0 other boxes to mix with; this needs 8") and disables Review with "Try again later".
- Where it failed:
  - The cost. "3.8 ₳, 38% of it" covers the mixes only, "15.3 ₳" includes an unnamed 1.5 ₳ reserve, and the box's return fee isn't on the page (T11, verifier).
  - "Waves deep" is explained in Settings → Lovejoin and on the Lovejoin review, which a short pool never reaches (exists-not-found).
  - The −/+ buttons are disabled with no reason in view (T11).
  - Elsewhere, Lovejoin arrives as a default nobody chose. In the swap, "Bring it back through Lovejoin" is on beside the audit warning; T10 called it "an opt-out I hadn't asked for". In the private session it appears as "as Settings has it", and the tester didn't know the word (T16).
- Where it held: availability. T11 knew a mix couldn't start, and why, without pressing anything.

### Governance
- Expected: a top-level "Governance" or "Vote" entry (T14, T14r), and the full proposal inside the wallet (T14r).
- What the wallet does: the route is Public tab → "Staking and governance" → scroll about 400 px → "Governance actions". A proposal's detail page shows its title, abstract, amount, recipient and dates when Koios has them. "Read its full text" opens the raw CIP-108 JSON through Blockfrost's IPFS gateway. The proposer isn't shown (T14r).
- Where it failed:
  - Finding it. Both testers searched the Private tab first and rated finding governance as needing prior knowledge (T14, T14r).
  - The proposal detail opened about 360 px down, with its title and amount out of view (T14r), and Back went off screen (T14).
  - An untitled action is named on the review only as "Info action". Its ID is in a hover tooltip that nothing points to (T14).
  - The full text as raw JSON suited a tester who knew CIP-108 (T14r).
- Where it held: the type tooltips ("it changes nothing on chain, however the vote goes"), the step from "Yes" to "Review: your vote", and "Cast Yes vote" (T14, T14r). The rerun changed the outcome: T14's failure to understand any proposal came from the recorded data, and with content T14r's tester could decide ("Mostly yes"). Separately, T13 expected stopping staking to leave the vote delegation alone. The review said otherwise ("Your pool and your voting power's delegation end"), which is Cardano's rule.

### Other mismatches
- Approval: testers expected a password before money moves (T04, T07, T08, T12, T14, T14r, E04). The wallet signs at review and sends on the final button while it is unlocked, by design; the site flows can ask for one (T16, T18). In the pilot, the environment note primed the expectation (T04 verifier); later runs were told the password only "in case the wallet asks for it".
- Site connections. Testers expected:
  - an installed wallet to be visible to sites (T15);
  - the header picker to choose the site's account, whereas "The account sites use" in Settings decides it (T15);
  - "dApps" to list connected sites (T17, T17r, E03);
  - "Cancel" only to close the prompt, not to refuse the site (T17, T17r); the signing screens say "Decline";
  - a disconnect to show on the open page (E03).
- History: testers expected one list, with a status on each entry (E01). The private copy ("when this device first read it") made E01's tester doubt the times, which are in fact block times (verifier).
- Transaction details: testers expected the change to be marked as theirs (T08, T12, T13, T18, E04). The dialog describes addresses by their shape: "a key that stakes".
- Restore: testers expected a "restored" confirmation and a sign that the phrase is valid (T20a, T20b). Both are silent on success; the checks show only when something is wrong (verifier).

## 6. Discoverability problems

Everything below exists and was reached, but only after a detour, a guess or a search.

### Where things are, and how testers got there

| Goal | Where it is | What happened | Tasks |
|---|---|---|---|
| Pay an ordinary address | Public tab → "Send"; from the private balance, "Make public" | Pressed the Private tab's "Send" (T04b, T06; T04 hesitated over it); reached "Make public" only through Send's address error; T04b found the public Send last | T04, T04b, T06 |
| Give an ordinary wallet an address | Public tab → "Receive"; Get started's "Show my address"; "Show my public address" on private Receive | Pressed the Private tab's "Receive" first (T01); T03 nearly did | T01, T03 |
| Make ADA private | Public tab → "Make private" | Looked on the Private tab first | T07 |
| Stake, withdraw rewards | Public tab → "Staking and governance" | Searched the Private tab first | T12, E04, T13 |
| Stop staking | A red row at the bottom of the Staking page, about 700 px down; only "Change pool" sits by "Your pool" | Wondered whether it was inside "Change pool"; scrolled | T13 |
| Vote | Public tab → "Staking and governance" → about 400 px down → "Governance actions" | Searched Private first; both rated it as needing prior knowledge | T14, T14r |
| Latest incoming payment | "Activity" from each tab opens that tab's list; on Public it's below the token list, about 500 px down | Read Private activity first | E01 |
| Swap | Private tab → "dApps" (cut off at the bottom of the first screen at 360x640) → Minswap → "New swap"; no dApps row on Public | Searched Public first; three screens deep | T10 |
| Mix | Private tab → "dApps" → Lovejoin | Guessed that a mixer would be a dApp | T11 |
| Let sites see the wallet | Settings → "Sites and mixing" → Sites, about 850 px down; also the Private tab's "dApps" row ("Off: sites can't see Seedelf Wallet", "Let sites connect") | Searched Settings after the site found no wallet; never saw the dApps notice | T15 |
| Check or remove connected sites | Settings → "Sites and mixing" → Sites → "Connected sites", about 1,000 px down; the only pointer is the connect prompt's ⓘ | Opened "dApps" first; T17r never found the list | T17, T17r, E03 |
| Add an account | Settings → Wallet → "Public accounts" → "Look for the next account" → "Add Account 2"; nothing on Home until a second account exists | Guessed Settings; read "Look for" as a search | T19 |

### Help that exists but sits off the path (exists-not-found)
- What a Seedelf is: in the "Get started" checklist, which disappears once the wallet is set up, and behind the ⓘ on Create a Seedelf. Not on Receive or Send, where the word is used (T02, T04b, T06).
- That an ordinary wallet can't pay a Seedelf name: in Get started step 2, below the fold, or on private Receive once a Seedelf exists (T01).
- What collateral and giveme.my are: Settings → Collateral. No review or refusal links to it (T04b, T06, T09, T16).
- "Waves deep", and the setting that brings sessions back through Lovejoin: Settings → Lovejoin, and for waves deep also the Lovejoin review, which a short pool never reaches. Neither the Lovejoin page nor the connector links to Settings (T11, T16).
- Which side a send pays from: the Send form's "This pays from your public account…" callout, which is below the fold at 360x480 (T04).
- Why an action is disabled: in hover tooltips, plus one shared line under the action row (T03). The T03 tester never hovered them, and the view shows a tooltip only on a hover, but touch and keyboard users don't get tooltips either (verifier, T03). Lovejoin's disabled −/+ are a different case, an absence: they have no tooltip at all, and the pool's reason sits under Review, about 600 px down (T11).
- The ID of the governance action on the review: a hover tooltip that nothing points to (T14).
- "In your private balance" on the swap's "You pay" figure of 28: shown on hover only (T10).
- Private activity: one scroll down the Private tab; T02 never found it.
- The restored wallet's address: one click away, behind "Show my address" (T20a).

### On the screen, but out of view on arrival
Screens keep the previous screen's scroll position; the verifier found nothing in the UI that resets it.
- "Review: stop staking" opens at its bottom. The red "Stop staking" button is in view, while the title, "Nothing is sent until you press Stop staking" and "Staking: Stops" sit 288 px up at 360x640 (T13).
- After "Create Seedelf", Home comes back about 200 px down, with the "Seedelf creation sent. Waiting for the network…" banner above the visible area (T03).
- Other screens that opened part-way down:
  - the swap review, about 300 px down (T10);
  - the private-session review, at its bottom (T16);
  - the Make public review, about 86 px down (T04b), and its form, about 126 px (T06, verifier);
  - the dApps page, about 186 px (T11);
  - a proposal detail, about 360 px, with its title and amount out of view (T14r);
  - governance detail pages, with Back off screen (T14).

  Settings' header also scrolls away on a page about 2,000 px long (E05).
- On small surfaces:
  - At 360x480, the review's total and balance-after sit below a pinned Send button (T04).
  - In the 400x605 signing popup, the password field and Sign/Decline are about 266 px below the fold, and on preprod the privacy sentence is cut in half (T18).

## 7. Trust problems

### Balances and history that contradict the review
- T08's pending balance read 10,440.31465 ₳, against the review's 10,382.839339 ₳; the tester said "Trust dropped sharply". The history then showed "Sent +32.300614 ₳", which the tester said "undermines trust in the transaction history". The verifier confirmed both as defects.
- After every send, Home kept the pre-send figure until confirmation (T04, T04b, T07, T08). T07 described the 20 ₳ as seeming to be "counted nowhere and everywhere at once".
- The same token read "1,234.56" on Home and "+1,234,560,000" in Activity (E01). The verifier confirmed a real scaling difference for unlisted tokens; the differing asset IDs were fixture data.

### Failures that point at the wrong cause
- Every giveme.my refusal opens with a guess about the user's own funds: "Nothing was sent. Something it spends may have been spent or changed since you reviewed it…" (T04b, T05, T06, T09; T16 saw the connector's shorter form). T09 wondered whether another transaction had spent their money. T04b "hadn't done anything else, so this sounded wrong". The words that name giveme.my, and its raw "Transaction Fails Validation", sit under "Details". The harness forced every one of these refusals, but the copy is real for any refusal (verifier, T09).
- "Not enough ADA in your private balance for this and its fee." refused amounts that the fee on screen clearly allowed, and the tester came to "doubt the wallet's arithmetic" (T05).
- The "Couldn't refresh" warning disappeared after a trip to Settings although nothing was fixed, and Activity showed "Updated 2 min ago" with no warning. The tester briefly thought the problem had cleared (E05).

### Outside parties in the path of money
- In private spends, giveme.my "lends the collateral" (T04b, T06, T09, T10, T16). T06: "an unexplained third party is involved in my private payment". T04b asked whose money "Collateral… Comes back 4.65461 ₳" was. On the swap review, "the collateral" names two different things, and the dialog's Collateral section has no explanation (T10, verifier).
- "Koios" goes unexplained in the 5xx error E05 met, "Koios is having trouble right now (503 for account_info)", though the timeout and unreachable errors call it "the service the wallet reads Cardano from" (verifier, E05). The activity headers and the Public accounts note name it without saying what it is (T07, E01, T19). T12 called it "a backend or data-provider name that means nothing to a normal user", but T12's and T14's Koios lines are real copy that the test data surfaced: a pool the fake Koios had no details for, and recorded proposals whose texts Koios hadn't read.

### Approval and signing
- The wallet asks no password for its own sends while unlocked (T04, T07, T08, E04), and Transaction details says "Signed … not sent yet" before the final button (T12, T14, T14r, E04). Several testers trusted it less as a result. In T08, T12 and T14, "Nothing is sent until you press …" restored that trust; T04's concern that anyone at the unlocked panel could move funds remained, and E04 stayed uneasy. This is by design; in the pilot, the environment note primed the expectation (T04 verifier).
- The signing popup's "It signs for 2 of your addresses" doesn't name the addresses (T18).

### Whose output is whose
- The change is labelled "a key that stakes", and nothing says it is the user's (T04, T08, T12, T13, E04, T18). In T18, "Pays 2 outputs" against a single payee "briefly hurt trust until I recognised my own address suffix". T12 "couldn't be sure the 2.82 ₳ change was coming back to me". T13's reassurance rested on an inference (verifier).
- The payee is shown only as "An address" (T18).

### Reviews that can be confirmed unseen
- The Stop staking review opens with the red button in view and its top hidden. T13: "Someone who clicks quickly could confirm without seeing the top half of the review."
- At 360x480, the send review's total sat below a pinned, clickable Send (T04).
- The private-session review opened at its bottom (T16).

### Promises that the fine print qualifies
- Private session: "The site sees only a new one-time account", against the note that anyone can follow the money back (T16).
- Swap: Lovejoin's return is on by default, next to "hasn't had a third-party audit" and a pool with no room; T10 said it "felt like an opt-out I hadn't asked for". The minimum "relies on Minswap … can't read it back from the order Minswap builds" (T10).
- Seedelf: "linked to whatever paid to create it", without saying what that was (T02).

### Disclosure to sites
- With Account 2 on screen, a reconnect gave the site Account 1 "with no popup and no warning" (T15). The popup had said so ("It gets Account 1: sites always use the account Settings → Sites chooses, whichever one is on screen."), but only after the public option was chosen, below the fold, and the popup can't change the account. Connected sites says "Your public account" without the number. The verifier notes that this is standard CIP-30 for an approved origin, and the site already held Account 1's addresses, so nothing new was exposed; the tester's discomfort is the finding.
- Turning Sites on warns that every https site can see the user has Seedelf Wallet. The warning is honest, and T15 paused before accepting it.
- Connected sites lists only "dapp.example", and the tester disconnected "without being sure it was the right site" (E03). The harness, which has no address bar, made this worse. "It keeps what it already saw" is honest, but suggests no next step (E03).
- The wallet never says it refused a site; only the site does (T17, T17r).
- Opening "Read its full text" takes the user to Blockfrost's IPFS gateway, and the wallet warns first that the gateway sees their IP address. The warning increased trust but made T14r hesitate.

### What earned trust
- "Nothing is sent until you press …" on every review (T03, T04, T04b, T05, T06, T07, T08, T09, T10, T12, T13, T14, T14r, T16, E04), and "Nothing happens until you press Sign" on the signing popup (T18), with figures that add up and end balances that matched exactly (T03, T04b, T07, T08, E04).
- "Nothing was sent" first in every failure, with the balances visibly unchanged (T04b, T05, T06, T09, T16).
- Full, unshortened recipients (T04, T04b, T06, T18), and confirm buttons that name the action ("Make 20 ₳ private", "Stake with LOGIC", "Withdraw 12.345678 ₳", "Cast Yes vote").
- Plain privacy notes (T01, T03, T13, T14, T14r, E03, T15), and the connect popup's "Nothing happens until you choose, and press Connect or Review" and "Nothing is signed without you." (T15, T17, T17r).
- The verifier's money checks: no run lost money or paid anyone a review didn't name.

## 8. Tasks that worked naturally

Nine runs had no wrong turns: T02, T04, T07, T11, T13, T19, T20a, T20b and E02 (T04's because of its title). The workflows below went cleanly, and the patterns behind them are the ones to reuse.

1. **Lock and unlock (E02: PASS, 0 wrong turns, 6 steps).** The padlock at the top right, with the tooltip "Lock", locked the wallet at once. The tester checked that the lock held after a reload, in a tab and after reopening, and "Unlock" returned them to the same Home. "I'd do it the same way again without thinking." Pattern: one always-visible control with an immediate, visible effect. Not exercised: the idle auto-lock.
2. **Restore (T20a, T20b: 0 wrong turns; T20b PASS).** 24 words were preselected; the words go in numbered plain-text boxes on one screen; Enter or Space moves to the next box; the steps are marked "Step 1 of 2" and "Step 2 of 2"; and a warning says the panel hands over to a tab ("Each opens in a full tab"). Both testers could check every word before submitting. Pattern: a short wizard whose whole state is visible.
3. **Receive privately (T02: 0 wrong turns, 6 steps).** The labels answer the question: "Its whole name: share this to be paid privately", "Share a Seedelf's whole name, not its tag", "Only someone using Seedelf Wallet can pay this. Anyone else needs your public address." Pattern: put the instruction in the label.
4. **Fund a new wallet (T03).** The numbered "Get started" checklist has a button for each step, ticks steps off as they finish, and disappears at the end, which the tester called "a clean completion signal". The tester stated the intended order exactly, and the create form's estimate matched the review. Pattern: a checklist with direct actions and a visible end.
5. **Make ADA private (T07: 0 wrong turns, High).** The teal "Make private" button has a tooltip. The review shows both "after" balances and puts the amount in the button ("Make 20 ₳ private"). Then come the banner, actions held with "Wait for the last transaction to confirm", a "Pending" row in Private activity, and "Made private" on confirmation, at exactly the reviewed balances. Pattern: the private side's pending lifecycle; Home's balances still waited for confirmation (section 4). Private activity's "Pending" row is the model Public activity lacks (T08).
6. **Stop staking (T13: 0 wrong turns, High).** The review lists each consequence in plain bullets (rewards withdrawn, unpaid rewards lost, vote delegation ending, how to undo it), states the deposit's return and has a red confirm button. The tester called it "Consequential but reversible", which is right. Pattern: list the consequences before a consequential action. (The review opens at its bottom; see section 6.)
7. **Sign a site's transaction (T18: 5 steps, High).** "Total leaving your public account 15.25 ₳" comes first, then "Network fee 0.25 ₳, counted in the total", the full payee (matching the site), and "Signing ties this transaction to your public account, as any payment from it. Your private balance isn't in it." All five task answers were right. Pattern: total first, a fee "counted in the total", and a privacy line on the signing screen.
8. **Recover from a refused send (T09).** "Nothing was sent" comes first. Send is replaced by a single "Refresh and review again", which rebuilt the review in place ("Review updated just now. Check it again."), and Back kept the form. Pattern: one obvious recovery action, with nothing lost.
9. **See whether Lovejoin can mix (T11: 0 wrong turns, 5 steps).** The page gives readiness in plain numbers above the fold, disables Review with "Try again later" under it, shows the cost large with a percentage, and discloses the missing audit. Pattern: say whether it can work before the user commits.
10. **Correct a wrong input (T06, T04b).** Pasting an address into "Seedelf name" got a specific explanation and "Pay it with Make public", with the address carried over. The private Receive's "Show my public address" works the same way (T01). Both testers listed it as working well. Pattern: recognise the input and carry it into the right flow.
11. **The connect prompt (T15, T16, T17, T17r, E03).** Nothing is preselected, and Connect stays disabled until the user picks what the site sees. The site's name, URL and network badge are shown, the public card names the account, and "No fee" made the choice easy. Declining is another matter: the wallet never shows that it refused a site, and a quick retry meets a silent cooldown (section 4). Pattern: an explicit choice, and the site's identity, before connecting.
12. **Add an account (T19: 0 wrong turns, 5 steps).** Once in Settings, the ⓘ explained what an account is, "Add Account 2" was prominent, and "Account 2 is in the list now." confirmed the result. Pattern: say in a sentence what just changed. The lock, restore and decline flows lack this.
13. **Understand a stale balance (E05).** "Couldn't refresh: these are your balances as last read", with "Updated N ago" counting from the last good read, reassured the tester that their funds weren't gone. Pattern: say what the numbers on screen mean when they're old.
14. **Withdraw rewards (E04).** A big "Withdraw rewards" button, an honest review ("Your balance stays the same, but for the fee"), "Withdraw 12.345678 ₳" on the button, and "Rewards withdrawn" afterwards. The confusion was about why to withdraw, not how (section 5).
15. **Reviews in general.** Testers read the standard review correctly every time it appeared, and every submitted transaction matched its review. That layout is the one to reuse where it is missing: on the swap review (T10), the Lovejoin page (T11) and the private-session costs (T16). It is "Nothing is sent until you press …", "Total leaving …", "… after", and a button that names the action and the amount.

## 9. Highest-value follow-up changes

Each change ends with how it stands against the earlier usability reviews; Appendix B gives the references.

Order: changes that fix wrong money figures first; then by the abandonment moments in section 4 that each change would remove, weighted by severity (a severity-4 moment counts 4); ties go to the change whose problem showed up in more runs. The weights: item 1, 6; item 2, 14; item 3, up to 10; item 4, 8; item 5, up to 8, behind item 4 on runs (10 against 11); item 6, 6; items 7 and 8, 5 (three runs each); item 9, 4; item 10, 2. Item 3 depends on item 1 and must ship with it or after it.

1. **Fix the two figures that show money that isn't there.**
   - Failure: while T08's 25 ₳ send was pending, a Refresh showed 10,440.31465 ₳, with the withdrawn rewards counted twice, against the review's 10,382.839339 ₳. After confirmation, Activity listed the payment as "Sent +32.300614 ₳". The verifier confirmed both as defects, and T04's payment would have read "Sent +45.300614 ₳". With "Use staking rewards when spending" on, every payment from a staked account with rewards is exposed; T04, T04b, T07 and T08 all withdrew rewards.
   - Change: never count withdrawn rewards twice, and list a sent payment as what left, with the rewards collected shown separately.
   - Effect: removes T08's two severity-3 moments, and the only balance shown in this test that matched no real state.
   - Earlier reviews: regression: reported before and marked fixed, seen again here (Appendix B).
2. **Tell the user about site state where they are.**
   - Failure:
     - A site couldn't see the wallet because Sites is off by default and the switch is 850 px into Settings (T15, severity 4).
     - After turning it on, an unexplained reload was needed (T15, severity 3).
     - Three testers looked for connected sites in "dApps" (T17, T17r, E03).
     - Connected sites shows the domain, not the site's name (E03), and "Your public account" without its number (T15).
     - A decline shows "Nothing's waiting." and closes; a retry during the cooldown is refused silently (T17r); and a disconnected page still looks connected (E03).
   - Change: in the places users look (Home, "dApps", the Sites switch), the wallet says whether sites can see it, which sites are connected and with which account, and when an open page must be reloaded. The connect prompt's "Cancel" says that it refuses the site and that the site must wait before asking again.
   - Effect: removes the highest-severity product moment and four more (T15, T17r, and two in E03). The severity-4 moment measures a first connection: a long-time user would often have turned Sites on already (T15).
   - Earlier reviews: partly reported before; part of it is new (Appendix B).
3. **Make Home and Activity follow money in motion.**
   - Failure: after a send, Home kept the pre-send balances and Public activity showed nothing until confirmation (T04, T04b, T07, T08). Incoming money waited for a manual Refresh (T01, T02, T03). The "X ₳ of this is on its way" line exists for this case but appears only after a manual Refresh (T08), because Home doesn't re-read after a send (T07 verifier).
   - Change: right after a send, Home reads again and shows what is leaving and what is coming back, and Public activity lists the payment as pending, as Private activity already does. For money coming in, not polling is deliberate (E05 verifier) and every poll costs a Koios read, so that part is a trade-off: a Refresh that is easier to find than the small unlabelled icon (T01, T03), or reads at chosen moments, rather than polling all the time.
   - Depends on item 1: with today's code, a read right after a send would show T08's double count on every public send that withdraws rewards (T07 verifier), so this ships with item 1 or after it.
   - Effect: removes the three moments after a send, including T07's "I might lose money", and eases the two at incoming payments, including T01's "I don't trust pressing this button", as far as the chosen design reaches them.
   - Earlier reviews: regression: reported before and marked fixed, seen again here (Appendix B).
4. **Make the public side visible from the Private tab.**
   - Failure: Home opens on Private on every panel open. Nothing there shows the public balance or says that ordinary sends, Make private, staking and voting are one tab away. 11 runs looked on Private first (wrong turns in T01, T04b, T12, T14, T14r, E01, E04; hesitations in T03, T04, T07, T13). The visible labels "Send" and "Receive" don't say which side they act on; only the accessible names do.
   - Change: whichever tab Home opens on, the user can see that the public balance exists and can reach its actions, staking and governance in one step, and the action labels name their side.
   - Effect: removes the most common first wrong turn (7 runs) and four abandonment moments (T01, T04, T12, T14r).
   - Earlier reviews: partly reported before; part of it is new (Appendix B).
5. **Name causes and third parties in the user's terms.**
   - Failure: any giveme.my refusal blames "something it spends" and hides who refused under "Details", with no advice for a repeat (T04b, T05, T06, T09, T16). "Send asks giveme.my to lend the collateral" never says whose money it is or whether it costs anything (T04b, T06, T09, T10, T16). "Koios is having trouble right now (503 for account_info)" is the one Koios error that doesn't say what Koios is (E05 verifier), and the activity headers and the Public accounts note name Koios without explaining it (T07, E01, T19).
   - Change: the headline says who refused and what to try if it happens again; the review explains the collateral line in a phrase or links to Settings → Collateral; and the 5xx error and the notes that name Koios say what it is, as the timeout and unreachable errors already do.
   - Effect: removes T09's two moments and T04b's at the collateral line, and eases T16's; refusals and outages read less often as something broken.
   - Earlier reviews: partly reported before; part of it is new (Appendix B).
6. **Give private Send a Max for ADA and an honest shortfall message.**
   - Failure: private Send has no ADA Max, though public Send, Make private and Make public all have one (verifier). "Not enough ADA … for this and its fee" also covers the change's minimum, so amounts well within the fee on screen were refused, and the check uses an estimated fee higher than the one shown, so the maximum can't be worked out from the screen (verifier). The tester needed about 15 guesses and ended with Low confidence (T05).
   - Change: Max fills in the largest amount that will pass, and the message says what must stay behind.
   - Effect: the test's only Low-confidence task becomes one click, and T05's two severity-3 moments go.
   - Earlier reviews: partly reported before; part of it is new (Appendix B).
7. **Offer both routes for paying an ordinary address, and explain the words on the way.**
   - Failure: Private Send's only field is "Seedelf name", and its address error offers only "Make public", never the public Send (T04b, T06). "Make public" read as a privacy toggle or a transfer to oneself (T04b, T06). "Seedelf" is undefined where it is used (T02, T04b, T06).
   - Change: the address error offers the public account's Send as well as "Make public", saying what each reveals. "Seedelf name" and "Make public" explain themselves where they first appear.
   - Effect: T04b's two real wrong turns (the Private Send, pasting the address) and T06's one become a single informed choice, which removes their moments at the wrong Send. Without the fake refusal, T04b's tester would most likely have paid through Make public from the private balance, never learning that the public account has an ordinary Send (verifier); the choice shows both.
   - Earlier reviews: partly reported before; part of it is new (Appendix B).
8. **Give the swap, Lovejoin and private-session screens one total.**
   - Failure: the swap review lacks the "Total leaving …" and "… after" rows that the reviews for both Sends, Make public, Make private and Create a Seedelf have, "For the swap 16 ₳" reads like a total and isn't, and "the collateral" means two things (T10). Lovejoin's "3.8 ₳" and "15.3 ₳" don't reconcile (T11). The private session's "A fee each way" gives no figure for the way back (T16).
   - Change: each screen states what leaves the balance now, what comes back and the expected total cost, in the review layout the other flows use.
   - Effect: removes T10's "I might lose money" and T11's severity-3 moment, and testers no longer have to add up outputs in Transaction details.
   - Earlier reviews: partly reported before; part of it is new (Appendix B).
9. **Say what happens to the user's own money on reviews and in Transaction details.**
   - Failure: the rewards row stopped four testers (T04, T04b, T07, T08). E04 couldn't see why to withdraw, and "Settings can keep them here instead." names no setting. The change output is only "a key that stakes" (T04, T08, T12, T13, E04, T18), so testers worked out which outputs were theirs from address suffixes (T18).
   - Change: the rewards row says which balance it means and that nothing extra leaves; the staking screen says when withdrawing by hand matters; and Transaction details marks the user's own outputs.
   - Effect: removes T07's and E04's moments and a hesitation seen in eight runs, and makes the details dialog usable for checking a payment.
   - Earlier reviews: regression: reported before and marked fixed, seen again here (Appendix B).
10. **Open every screen at its top.**
    - Failure: screens keep the previous scroll position, and the verifier found nothing that resets it.
      - "Review: stop staking" opened with the red button in view and "Nothing is sent until you press Stop staking" hidden (T13).
      - After "Create Seedelf", Home hid its own "Seedelf creation sent…" banner, so the tester thought nothing had happened (T03).
      - Other screens opened 86 to 360 px down, or at their bottom (T04b, T06, T10, T11, T14, T14r, T16).
    - Change: a new screen starts at its top.
    - Effect: titles, "Nothing is sent until …" lines and status banners are seen on arrival. One case needs more than this: at 360x480 the send review's total sits below a pinned, clickable Send whatever the scroll position, because the review keeps its footer pinned (T04 verifier).
    - Earlier reviews: new in this test (Appendix B).

## 10. Human testing recommendations

The AI testers read every word and act more slowly than people. They saw accessible names that sighted users don't, saw a tooltip only when they hovered on purpose (and then at once), couldn't feel visual weight, and ran into harness limits. These tasks are where that most likely changed the outcome.

1. **Pay a friend's ordinary address, untitled, in the docked side panel (T04, T04b).**
   - Watch for: which Send they press first; whether "Seedelf name" stops them; whether they choose "Make public" or look for the Public tab; and what they think "Make public" will reveal.
   - Why the AI test couldn't settle it: T04's title gave the answer away. T04b's tester saw "Send privately" and "Send publicly" in the harness view, had been warned that an outside service would refuse, and found the public Send only after the fake refusal. How a real user finishes this task is unknown.
2. **Send from a staked account, then watch it confirm on the real network (T07, T08).**
   - Watch for: whether they notice the unchanged balance; whether they press Refresh mid-send (which shows the double count); how they read "35.300614 ₳ of this is on its way"; whether they try to send again or close the wallet; and how they read "Sent +32.300614 ₳".
   - Why the AI test couldn't settle it: the harness confirmed on command, and the AI testers read the banner closely and did the arithmetic. A person may watch the big number rather than read the small banner.
3. **First run: install, create a wallet, fund it from another wallet and receive (T01, T03).**
   - Watch for: whether they press the Private tab's "Receive"; whether they find Get started's "Show my address"; how long they wait before finding Refresh; and whether they try the disabled Create.
   - Why the AI test couldn't settle it: T01's onboarding ran in a 1280x720 tab, which shows more of Home than the panel does, and the harness's payments landed instantly and announced themselves.
4. **First connection to a real dApp in real Chrome (T15).**
   - Watch for: what they do when the site finds no wallet; whether they find the Sites switch or the Private tab's "dApps" notice; whether they accept Chrome's "all websites" permission prompt; and whether they think to reload.
   - Why the AI test couldn't settle it: the headless browser couldn't show Chrome's permission prompt (access was pre-granted), the panel wasn't docked beside the site, and the AI tester got through on CIP-30 knowledge.
5. **Connect privately and buy, with a working giveme.my (T16).**
   - Watch for: how they choose the amount; whether they understand what the site sees after reading the linking note; how they wait for the funding; whether they close the window; and whether they ever bring the money back.
   - Why the AI test couldn't settle it: the run was BLOCKED, and no session was ever created.
6. **Stop staking in the side panel (T13).**
   - Watch for: whether they press the red "Stop staking", which is in view on arrival, without scrolling up to the title and "Nothing is sent until you press Stop staking".
   - Why the AI test couldn't settle it: AI testers scroll and read everything, while people act on the most prominent button. The risk is about visual weight and speed.
7. **Swap ADA for MIN through "Start swap", with a working giveme.my and a Lovejoin pool that has room (T10, T11).**
   - Watch for: whether they find "dApps"; whether they look for a total; whether they leave "Bring it back through Lovejoin" on; whether they understand the three transactions and know when the swap is done; and how they react to Lovejoin's cost.
   - Why the AI test couldn't settle it: Start swap couldn't complete; the pool had 0 boxes, so the Lovejoin cost table never appeared; and the AI tester computed totals that people won't.
8. **Send as much of the private balance as possible (T05).**
   - Watch for: how many tries they make before settling; whether they conclude the wallet is broken; and whether they include the tokens.
   - Why the AI test couldn't settle it: the AI tester bisected about 15 times. People stop much sooner, so the real cost is the amount they settle for.
9. **Decline a real dApp, retry at once, then find and remove the connection (T17, T17r, E03).**
   - Watch for: what they conclude when nothing appears during the cooldown; whether they look in "dApps"; whether they find Connected sites; and whether they trust the disconnect while the site still shows itself as connected.
   - Why the AI test couldn't settle it: the test site printed the wallet's cooldown text word for word and logged every call, which real dApps rarely do, and harness latency moved the retry's timing.
10. **Vote as a DRep on real proposals (T14, T14r).**
    - Watch for: whether they find governance starting from the Private tab; whether the abstract is enough to decide; what they make of "Read its full text" opening raw JSON; and whether they confirm which action they are voting on.
    - Why the AI test couldn't settle it: T14's data was empty, T14r's texts were written for the test, and T14r's tester knew CIP-108. Real proposals and less technical DReps may behave differently.

## 11. The fix round

What was done with each of §9's changes, on `web-wallet/style-flow-3` after the test. **Fixed** means the change asked for, or one that meets the same need; **partly** says what's left; **left** says why. Pass one made §9's changes; [pass two](#pass-two-the-owners-answers-and-the-smaller-fixes) followed the owner's answers on what it left. No blind run has checked the fixes yet: the owner's own testing comes first, and §10's human tests still stand.

| §9 | | What changed |
|---|---|---|
| 1. The two figures that show money that isn't there | Fixed | **The pending balance.** Every balance the worker answers is now its kept reading, less what the wallet has spent since, plus what the wallet's own transactions on their way pay back to it, each transaction counted whole whenever the reading was made (`background/incoming.ts`). Rewards a transaction on its way withdraws are taken out of the rewards (`withdrawing`), so T08's Refresh now reads 10,382.839339 ₳, the review's "after", not 10,440.31465 ₳. The forms don't offer those rewards again, and Withdraw rewards and Stop staking wait for that payment to land, since the rewards can be withdrawn only once. A sent transaction counts for as long as its inputs are held as spent (2 hours), not 20 minutes, and a Lovejoin chain can't push a payment out of the record. **Activity** lists a payment at what it paid ("Sent −25 ₳" for T08, "12 ₳" for T04), with the fee and the rewards collected in their own rows; Sent never carries a plus; a deposit is money out and its refund money in; an entry that only cost a fee is listed at its fee. The CSV's ADA column leaves the fee out. Tokens in Activity use their decimals (E01's "+1,234,560,000" reads "+1,234.56"). |
| 2. Site state where users look | Fixed, bounded | **The dApps page** says whether sites can see the wallet, with Let sites connect; lists the connected sites (the page's title beside the domain, and the account by name when there are several), each with Disconnect; and lists a declined site's wait, counting down, with **Let it ask now**. The dApps row shows on both tabs with that state. **Turning Sites on reaches pages already open**: no reload, except a page still holding an older copy of the wallet, which the switch's note covers. **Cancel is Decline**, on the connect question and the funding review, with the wait it starts stated before pressing; afterwards the window says the site was declined and when it can ask again. The waits survive Chrome stopping the worker (they're in session storage). After Disconnect, the wallet says the open page may still look connected but can't use the wallet. **Left:** CIP-30 has no disconnect event, so an open page learns on its next call, which is refused. |
| 3. Home and Activity follow money in motion | Fixed, bounded | Right after a send, Home reads again from the kept reading, with no Koios request, so the balance shows what's leaving at once, and the line under it says what's "on its way to this balance", the rewards collected included. Public activity lists the payment as Pending from the device's own record, as Private activity does, and Activity shows the pending banner. Refresh is a labelled button beside "Updated N ago". In pass two, the UTxOs list leaves spent UTxOs out and says what's coming back. **Left:** polling for money coming in (the owner's call); a site-signed transaction's change isn't counted as on its way, so the balance reads low until it lands. |
| 4. The public side visible from the Private tab | Fixed | Each tab has a row for the other side: its balance, what it's for ("Pay any address, get paid by any wallet, stake and vote"; "Pay and get paid privately, swap and mix"), and one press to that tab. It sits after Get started and the mint-first note, so a new wallet's next step stays first. In pass two, at the owner's call, the action labels name their side ("Receive privately", "Send publicly", …). Home keeps opening on Private (the owner's call). |
| 5. Causes and third parties in the user's terms | Fixed | **A refusal names who refused:** giveme.my, "the service that lends the collateral", and tells its refusal from its outage (5xx or 429), with what to try if it happens again. Before asking giveme.my, the wallet checks the review's inputs against what this device has spent since, and says so plainly when one was; a review already being sent is never offered for a rebuild. **Every private-spend review** has one note: giveme.my lends 5 ₳ of its own, charges nothing, is run by Logical Mechanism, and sees the transaction with your IP address; an ⓘ says what collateral is. On the swap and session reviews it's never the one-time account's 5 ₳. **Koios** is "the service the wallet reads Cardano from" in every error and note that names it. A failed reading adds "Your money is safe on chain", and the alert stays after a trip to Settings until a good reading. **Left:** a link from a review to Settings → Collateral (leaving would drop the review; the ⓘ carries it). |
| 6. A Max for private Send, and an honest shortfall | Fixed | **Max** pays one Seedelf all the ADA of up to 20 private UTxOs, less the fee and the minimum the tokens kept need, as public Send's Max does: tokens added go with it; the rest stay with exactly their minimum. Core: `transfer_most`, `ScriptSpend::pay_rest`, `max_inputs`. **The shortfall** is checked with the fee the review would show, so T05's 26.07 ₳ and 26.081594 ₳ pass, and a refusal says "up to about X ₳" and what has to stay with the tokens kept. Make public had the same fault and got the same fix. |
| 7. Both routes for paying an ordinary address | Fixed | An address in private Send offers two buttons, private first: **Pay from your private balance** (Make public: it shows at their end as coming from the Seedelf contract) and **Pay from your public account** (its Send: it shows as coming from your public account), each carrying the address and the amount, and each saying why when it can't pay. "Seedelf name" and Make public have an ⓘ, and Make public says what it shows. Its "links back" note reads as a condition. **Left:** renaming Make public (the owner's call). |
| 8. One total for the swap, Lovejoin and private sessions | Fixed | **The swap review** has "Total leaving your private balance" and "Private balance after", and a table of what the swap costs and what comes back, the later transactions' fees "about" (0.25 ₳ each, measured against real ones). **Lovejoin** gives one breakdown that adds up: the 1.5 ₳ reserve is named, and the headline is the whole cost, network fees and the box's way back included (about 4.85 ₳ for 10 ₳ at two waves, where the page said 3.8 ₳). Waves have an ⓘ; disabled −/+ say why. **A private session's** funding review has totals, and its way back's fees (two through Lovejoin: the deposit and the return). The "bring it back directly" links are switches, as Stop's is. |
| 9. The user's own money on reviews and in Transaction details | Fixed | The rewards row is "Staking rewards", with "57.475311 ₳, already in your public account's balance: nothing extra leaves". The staking page names the setting and says when withdrawing by hand matters (for a site; otherwise it costs a fee and changes nothing), and the withdrawal review says what withdrawn rewards become. Transaction details marks the user's outputs: "Yours, in your public account" (or the account's name), the private balance, a Seedelf, or a private session. In pass two, the Staking page has the setting's own switch. **Left:** the signing window naming the addresses it signs for (it carries only a count; the details mark them). |
| 10. Every screen at its top | Fixed | A screen opens at its top when its title changes (`Screen`), Home after any flow, and browser Back too. On windows 600 px high or less, a review's foot follows its rows, so the total is read before the button. In pass two, a review with several recipients puts its totals first, and Back returns to where you were in a list. |

### The fix round's own review

Four reviewers read the merged changes across areas, and a fifth read the fixes they led to. The round fixed what they found:

- **Money.** Another account's payment, and a Lovejoin mix's steps, could show as the active account's pending rows at wrong amounts. Stop staking could withdraw rewards a pending payment had already taken. After 20 minutes a pending send's change stopped counting while its inputs stayed subtracted (the HM-1 symptom back). A near-limit private payment with ADA-only change was refused when what was left after it was odd. Then, in the fixes themselves: a landed payment kept an epoch's new rewards held back as "on their way", and a Send was recorded under the account switched to after its review rather than the one it spent from.
- **Refusals.** A review being sent could be called stale and rebuilt, paying twice; a giveme.my outage forced a full contract read on every retry.
- **Sites.** The dApps page still said a site "sees only" a one-time account (§7's over-promise; a test now guards every language). Turning Sites on could add a second bridge to a page left from before an update, so a site could be told a payment failed while it went out. The decline waits lived only in the worker's memory, which Chrome drops, and once kept, a lock from a freshly started worker still wiped them. The funding review's Cancel still turned the site away unsaid. The declined list showed connected sites.
- **Screens and words.** The short-window foot rule caught pages that aren't reviews; the other-side row pushed a new wallet's next step down; a refused route ran two sentences together; six privacy notes were renamed into the checked set of translations.

### Pass two: the owner's answers, and the smaller fixes

Asked about what pass one left, the owner (5 October 2026) kept Home opening on Private, Swap and Mix behind dApps, and Make private enabled before a Seedelf exists; asked for side-named labels, the two activity lists to point to each other, and a restore to be confirmed; and took the smaller fixes "if it makes the UX/UI better … in a critique way". Each was critiqued before it was built, the merged pass was reviewed across areas, and a visual critic screenshotted every changed screen at 360×640 (the connector at 400×605) and its findings were fixed.

- **Home:** the labels name their side, each on two even lines in English and Spanish; the reason lines name the buttons as they read; an empty wallet gets **Show my public address** right under its reason, above the fold; a restore is confirmed at the top ("Wallet restored", then what the phrase holds, or that a phrase never used reads 0 ₳), from a mark the worker keeps, so it shows wherever Home opens next. "Show my address" in Get started no longer switches the tab.
- **Activity:** each list has a row to the other, which reads nothing until pressed; rows naming several addresses no longer run together.
- **Reviews:** an amount never splits from its ₳; with several recipients the totals come first; the rewards row's explanation sits under the amount; return reviews show what bringing each Lovejoin box back costs; Make public's Max note says plainly what Max sends. The swap and Lovejoin breakdowns set each total's parts in under it.
- **Back and scroll:** Back returns to where you were in a list; a flow opened part-way in still starts at its top; Settings' header stays in view, under the lock countdown when it shows.
- **The connector:** the preprod line sits in the top bar and isn't cut; the connect window's chosen option's privacy note comes before Connect, which follows the body; the sign window says "Nothing happens until you press Sign, at the end"; a site's transaction says its signatures are already in it and Seedelf Wallet adds yours only at Sign; the declined window has Close.
- **Staking and governance:** the rewards setting has its own switch on the Staking page, in Settings' words; the vote review shows the action's short ID (and title); the governance list lines up in a card; switches sit level with their names.
- **Transaction details:** the signatures row says they were made while preparing it, not sent until you confirm (§4 moment 16).
- **UTxOs:** spent UTxOs are off the private list too while a spend is on its way, and a line says what's coming back.
- **The visual critic's three passes:** the first found 13 problems on the built screens (an amount split from its ₳ in every review total, the empty wallet's first step below the fold, the connect window's privacy note under a pressable Connect, Activity rows running together, among them); the second confirmed 10 fixed and found what the fixes broke (shortened IDs breaking at their "…", addresses squeezed to a letter); the third confirmed those. **Still polish:** a few review labels wrap to two or three lines beside a long value (the sign window's "It signs for", the two-recipient total, Lovejoin's "Room for network fees"), and a private session's "Disconnect the site" may wrap in the side panel.
- **Skipped, with reasons:** the proposer on an action (the rows don't carry it, and a deposit-return address doesn't identify one); a link from a review to Settings → Collateral (it would drop the review; the ⓘ says it all); hiding the account picker on Private (it reads "Public account" already, and the private side uses it).

### Pass three: the owner's review of the fix round

The owner tried the two passes by hand (6 October 2026) and listed eight things. What each became:

1. **The account picker took a row on every screen for something rarely used.** It's the Public tab's heading on Home now, "Public account 2 ▾", and gone from the other screens; Settings → Public accounts still switches. With one account nothing shows, as before. Since the other screens no longer name the account, a public review's totals do with several: "Total leaving Public account 2", "Public account 2 after".
2. **Symmetry between the sides.** The Private tab's row for the other side reads "Public account 2" (or "Public account · Savings"), as the Public tab's reads "Private balance".
3. **The language note is gone;** Settings keeps *Report a translation error*.
4. **Settings → About's paragraph on whom the wallet talks to is gone:** the privacy policy, linked beside it, says all of it. One fact in it was said nowhere else in the wallet, that Koios sends every transaction from the IP address that reads the public account, so the giveme.my note on every private review now ends "It and Koios see this transaction with your IP address, the one that reads your public account."
5. **"Using the app is damn near a reading comprehension test."** Every screen's copy was cut, in seven areas at once (Home and history, payments and the worker's messages, swaps, Lovejoin, dApps and sites, staking and governance, Settings and onboarding), to a budget of about 20 words for a note always on screen. Mechanism, history and repeats went; every privacy, cost, can't-be-undone and next-step fact stayed, shorter. English went from 26,879 words to about 21,000; strings over 30 words from 189 to 37, over 40 from 81 to 6. Spanish and Japanese were rewritten from the new English. Some screens: the dApps page 196 → 104 words, the swap review 391 → 251, Settings 111 → 62, Lovejoin's page 222 → 113, Send publicly 55 → 33. Three reviews followed, of facts lost, of the translations and of the code and tests; their fixes put back "on chain" in two notes that had come to say "nothing ties", "here or elsewhere" in Remove wallet's double-pay warnings, the mixes' cost in Bring everything back, the no-break space before ₳ in 23 keys, and nine Spanish and Japanese wordings.
6. **Buttons pinned left under a note are centred** (*Let sites connect*, *Create a Seedelf* in Home's callout, the DRep card's and Staking's retry); links stay with their text.
7. **The swap review's numbered steps showed through Start swap:** the sticky foot sits above the body now (`z-index`), wherever a positioned element scrolls under it.
8. **Does dApps from the Public tab use the private side?** Yes, by design: the dApps page is the same from either tab. A Minswap swap always runs from a one-time account funded from the private balance; Lovejoin's mix defaults to paying from the private balance and offers the public account; a site connecting asks, each time, for the public account or a private session. Nothing changed.

### Left for the owner

- **The open calls, unchanged:** renaming Make public, polling for money coming in, a password on the wallet's own sends.
- **Calls this round made, to confirm or reverse:**
  - Lovejoin's headline is now the whole cost, network fees and the way back included (about 4.85 ₳ for 10 ₳, was 3.8 ₳), at the 0.95 ₳-per-mix estimate; measured mixes cost 0.82–0.88 ₳.
  - Private Send's Max keeps the tokens not added, as public Send's Max does; Make public's Max still sends every token.
  - Turning Sites on reaches pages already open; the privacy policy has an entry for it, and for the page title now kept with each connected site.
  - After a decline, the window stays 4 s to say so.
  - A review's foot follows its rows on windows 600 px high or less, which includes the side panel on a 768-pixel-high screen.
  - The giveme.my note says it "charges nothing" and is run by Logical Mechanism.
  - The later transactions' fees are an estimate of 0.25 ₳ each.
  - Private Send's Max hands no amount on to another form when an address is routed elsewhere.
  - The Staking page has its own copy of the rewards switch.
  - Pass three: the picker is Home's Public heading only, so a payment form off Home doesn't name the account until its review; Koios's view of private payments is said on each private review's giveme.my note, not in Settings; and the copy budget itself (~20 words a note), which the owner may want tighter or looser on screens they use most.
- **Not taken up:** §4's moment 24 (no sign of accounts on Home, by chunk 18's design). A site-signed transaction's change isn't counted as on its way, so the balance reads low until it lands; after a payment lands, an epoch's new rewards can read low for up to 2 hours (never high).

## Appendix A. How the test was run

### What was tested

- The extension's `dist/`, built from commit `d423b79` (package version 1.1.0, the default build, Cardano preprod). Commit `0513e9f`, which changes how a swap that runs itself places its order after a dip within the slippage, came later and isn't in this build. No task reached that step: T10 stops before authorizing, and private-balance spends can't complete in this environment (below).
- 29 runs: the plan's 20 scripted tasks (Task 20 twice, once in the side panel and once in a full tab), five exploratory tasks, and three reruns (T04b, T14r, T17r) of tasks whose first run the test setup had skewed.

### The testers

- Every run had a fresh tester: an AI agent (Claude Opus 5.5) with no knowledge of the product. It ran as Claude Code's Explore agent type, which doesn't load the repository's CLAUDE.md or the session's memory notes. Those describe the product and would have told a tester, for example, where Lovejoin lives.
- A tester got the plan's task text verbatim, its starting state, its password where it had one, a neutral reference for the test browser's commands, and only the extra commands its task needed. It could not read source, docs, tests, fixtures, logs or earlier reports, and was told to ignore any product knowledge it might have.
- A tester saw the wallet the way a sighted user does, through a "view" of only what is inside the window (text and controls, with a control's visible label beside its screen-reader name) and through screenshots, which it was told to check at every decision point. It acted with clicks, typing, scrolling, Back, window switching, hovering and the clipboard.
- Each tester returned a structured trace: the actual path including wrong turns, hesitations, friction, abandonment moments (type and a severity from 1 to 5), mental-model notes, terminology, trust notes, answers to the task's questions, a result, a confidence and a count of navigation steps.
- A tester's own environment wasn't entirely free of hints. It held the working directory's path, which names Seedelf-Wallet and the extension's folder, a list of available skills naming the same folder, and the owner's email domain. Two testers said so: T09 noticed the folder and skill names, and T12 noticed that the email domain matches the name of the pool its wallet staked with, "LOGIC". None of it describes the wallet's screens or flows.
- None of the 29 verifiers found a tester using product-internal knowledge. Several testers said where they used general Cardano knowledge (minimum ADA per output, change outputs, CIP-30, what an Info action is), and their traces say so.

### The verifiers

After each run, a separate agent with access to the source, the run's command log, its screenshots and the decoded transactions annotated the trace without changing it. It marked each disputed claim as real, harness (caused by the test setup), exists-not-found (it exists, but the tester didn't find it), misread or unverifiable. It checked the tester's answers against the true values, said what actually happened to any funds, and recommended a different result only when the setup caused it. Across the 29 runs there were 437 annotations: 331 real, 62 harness, 26 exists-not-found, 17 misread and 1 unverifiable.

### The test browser

- Playwright drove Chromium with the built extension. The repository's e2e fakes answered every outside request: recorded preprod Koios, giveme.my, the Minswap aggregator and Lovejoin's pool. Any other host got a "Page not available" placeholder or was blocked.
- On top of those fakes the harness added:
  - **Presets:** a fresh install; a new empty wallet; a funded wallet (about 28 ₳ private, about 10,408 ₳ public, a Seedelf, tokens, staked); the funded wallet with a second public account; and the funded wallet already connected to the test website.
  - **Overrides:** not staking (T12), a registered DRep (T14, T14r), withdrawable rewards (E04), and governance texts (T14r, below).
  - **Backend modes:** about 4 s per request in T12; failing after the first load in E05; a refused first private build in T09.
  - **A test website, "Example Market":** Connect wallet, Buy item - 15 ADA (a real unsigned transaction for the wallet to sign and submit), Sign in with wallet, and an activity log.
  - **"World" commands:** someone pays you, and the network confirms.
- **Surfaces:** the side panel as a 360x640 window (T04 at 360x480); a full tab at 1280x720 (T14, T14r, T20b, E01); website tasks with the website in front and the panel as another window; connector popups at 400x605.
- **Koios:** no test browser connected to Koios at any point. A process-level watch on Koios's IP addresses ran through the main run.

### Choices and deviations

- **No titles.** Testers didn't see the plan's task titles, because they name the interface ("Make ADA private", "publicly", "Lovejoin", "public account"). The three pilot runs (T03, T04, T15) did show theirs. Only T04's steered its tester, who picked the Public tab because of the word "publicly", so T04b repeats T04 untitled.
- **Neutral examples.** The plan's example sentences for Path ("Home → Public → Receive → Copy address") and Friction (Private as the default tab, Receive showing a Seedelf) describe Task 1's answer. Testers got neutral examples instead.
- **Pilot differences.** The pilot (T03, T04, T15) differed from the later runs in three ways besides the titles:
  - Testers were told they would need their password "to approve things". The wallet doesn't ask for it while unlocked, so the T04 tester wondered whether something was wrong. Later runs said "in case the wallet asks for it".
  - T03's "world pay" said the payment was already in a block, where later runs quoted the sender's wallet instead.
  - The test website didn't yet reconnect after a reload (T15). Many real dApps do, so it was added for later runs.
- **The sites switch.** The wallet's "Let sites connect" switch was off at the start of T15, the product default, so T15 includes a real first connection. It was on for T16 and T17, so the website could ask, as their scenarios say.
- **Site access.** Chrome's permission prompt for site access can't appear in this headless browser, so access was pre-granted. Turning the switch on showed no prompt (T15).
- **Exploratory tasks.** E01–E05 were picked from the plan's own list of examples before any results were in: find an old transaction, lock the wallet and get back in, disconnect a site, withdraw staking rewards, understand a failed refresh.
- **Confirmations.** The network confirmed only when the tester said so, in T03, T04b, T07, T08 and E04 (after the pending-state questions). Otherwise a submitted transaction stayed pending for the rest of the task.
- **T14r.** The recorded preprod governance actions have no title or abstract (Koios hadn't read their anchors) and lacked the date and payment columns the wallet asks for, so T14 couldn't test whether a DRep can learn what an action does. T14r repeats it with titles, abstracts, dates, payments and full texts (CIP-108 documents served at the IPFS gateway the wallet links to) written for the test. One action keeps no metadata, as real ones sometimes do. Judge the wallet's presentation in T14r, not the proposals.
- **T17r.** In T17 each harness command took seconds, so the retry reached the wallet after its 10 s decline cooldown. T17r repeats it with the tester chaining commands, so the retry arrives within seconds, as a person's quick clicks would.

### Limits that remain in the traces

- **Private-balance payments can't complete here.** The wallet checks giveme.my's collateral signature against a key in its WebAssembly, and the fake giveme.my refuses every request. Reviews build, but the final Send fails with "Nothing was sent…". This ended T05, the private route in T04b and T06, T09's retry, and T16's session funding. Changing the key in a copy of the build was blocked as weakening a security check and wasn't pursued. With the owner's go-ahead, those runs could be repeated with that change.
- **"Details" toggles.** The wallet's "Details" disclosures are `<summary>` elements. In the main run a click aimed at one could land on "Transaction details" or miss. This was fixed for T14r and T17r. The verifiers mark every case.
- **No docked panel, no address bar.** The side panel is a separate window rather than docked beside the page. Testers had no address bar to check a site's domain, and explorer links, IPFS images and other outside pages show a placeholder.
- **Fixture data gaps.** E01's private entries show placeholder transaction ids, a token fingerprint that differs between screens, and identical times. In T12, one listed pool's details can't be read. T20a and T20b restore a phrase that holds nothing, so a successful restore looks the same as an empty new wallet. Lovejoin's pool in T11 has no other boxes to mix with.
- **Pending times.** A payment that arrives from outside shows only after the wallet reads its balance again, on Refresh or on reopening Home a minute later, as in the real product. A confirmation shows within about 15 s of the tester's "world confirm".

## Appendix B. New, previously reported, or regression

This classification was made after the blind runs and their write-up were finished, by reading the earlier usability reviews. It doesn't change any finding above; it says which ones were known.

Four of section 4's 25 product moments are regressions. An earlier review marked each of them fixed, and this test saw the problem again. In each case the fix covered less than the finding, or caused the new failure. None is a fix that worked and broke later.

- **The pending balance (moment 1).** R2's HM-1 fix counts change on its way. That change holds withdrawn rewards, which the balance still counts.
- **Home after a send (moment 10).** HM-6 asked for a refresh on return and was marked fixed, but only its tab part was built.
- **The decline cooldown (moment 14).** CW-3's fix tells the site. The wallet itself still shows nothing.
- **The rewards row on payment reviews (moment 18).** It was reworded in both rounds (R1 S-2, R2 PY-6), and four testers still stopped at it.

These make section 9's changes 1, 3 and 9 regressions. Changes 2 and 8 also each hold a regressed part: CW-3 again, and CW-8's "the collateral", which still means two things on the swap review. The fix rounds also made two findings that count as new: R2's PY-10 fix took "the change" out of the private shortfall message, and the refusal headline is R1 P-3's suggested copy.

| | Regression | Partly | Previously reported | New |
|---|---|---|---|---|
| Section 9 (10 changes) | 3 | 6 | 0 | 1 |
| Section 4 (25 product moments) | 4 | 8 | 7 | 6 |

Nearly everything reported before was left on purpose:
- the owner's open calls;
- private Send's Max, which needs a core builder;
- the giveme.my and Koios disclosures;
- one list of sites;
- no polling for money coming in.

**Sources.**
- R1 is chunk 23's first usability review, `plans/chunk-23-ux-review.md`. It was removed when usability-review.md was written up, and is read here from history at `16c6539`.
- R2 is usability-review.md: §1–§8 are the review, and §9 is its fix round.
- Chunk 14 is `archive/plans/chunk-14-style-flow-2.md`, the owner's second findings round.
- Chunk 18, the privacy review and the launch review are also in `archive/plans/`.

Each row has one status. Where a row mixes statuses, the note says which part is which.

### Section 9: follow-up changes

| Change | Status | Earlier reference | Note |
|---|---|---|---|
| 1. Fix the two figures that show money that isn't there | Regression | R2 HM-1, and R2 §9's "The fix round's own review"; R2 AC-3; launch review H1 | **The pending balance was marked fixed twice.** HM-1's fix counts change on its way (`background/incoming.ts`). The fix round's own review then closed three ways that change could count twice, and a reward withdrawal isn't one of them. The change holds the withdrawn rewards, and the balance still counts them. So the HM-1 fix is itself what showed T08 32.3 ₳ too much, where R2 had seen too little. **The Activity half is partly known.** AC-3 noted that the detail's amount includes the fee, and that was left open. The plus sign and the ignored withdrawal are new. Launch review H1 found the same fault in the site's signing prompt and fixed it there. |
| 2. Tell the user about site state where they are | Partly | R1 D-1, SET-1; R2 CW-3, CW-5, CW-6, SE-1 | **Known, and partly fixed.** D-1 is fixed: the dApps row says "Off: sites can't see Seedelf Wallet" and offers "Let sites connect". A user who starts at the site never passes it. Settings as an index is an open call (SE-1), and Sites off by default is a privacy decision. **A part regressed.** CW-3 was marked fixed: waits of 10 s, 60 s and then 5 min, and the site hears when it can ask again. But the wallet still shows nothing during the wait (T17r). **Left.** One list of sites was left as a structural call (CW-6). The account is named in the windows only (CW-5), so Connected sites says "Your public account". **New:** the reload after turning Sites on; the open page not told of a disconnect; "Nothing's waiting." after a decline; Cancel not saying it refuses the site; and Connected sites showing only the domain. |
| 3. Make Home and Activity follow money in motion | Regression | R1 H-10; R2 HM-1, HM-2, HM-6; chunk 14's list | **HM-6 was marked fixed, but its "refresh on return" was never built.** Only the tab part was. Home's `sent` handler reads nothing, and flows.md describes only the tab. So this test saw the balances as they were before the send, as R1 H-10 described. HM-1/HM-2's "on its way" line appeared only after a manual Refresh. **Left on purpose:** the public Activity's pending row (HM-1/HM-2, "bounded"). The owner declined polling for money coming in (chunk 14), and the notification centre waits for the data layer. **New:** the small, unlabelled Refresh. |
| 4. Make the public side visible from the Private tab | Partly | R1 H-2, H-6, §4; R2 GS-3, HM-10, §4; chunk 14 item 4 | **Reported in both rounds and left.** Both reviews reported tabs that hide destinations, and a two-balance model that nothing introduces. Opening on Public is an open call (GS-3). A Home that doesn't depend on the tab was left as a layout call (HM-10). **New:** the action labels don't name their side. The owner's approved wording in chunk 14 put the side only in the accessible names, and R1 H-2's fix renamed only the checklist's Receive. Also new: this test measured it on a set-up wallet, where Get started is gone. |
| 5. Name causes and third parties in the user's terms | Partly | R1 P-3, P-4, L-2, §6; R2 PY-7, PY-13, CW-8, §6, §8.2 | **Kept on purpose.** R2 kept the giveme.my sentence and the name Koios as disclosures (PY-7, PY-13). This change explains them rather than dropping them. **New:** the refusal headline's wrong cause, which is R1 P-3's suggested copy as built ("may have changed", with the service's words under Details); advice for a second refusal; and the 5xx text, the one Koios error that doesn't say what Koios is. |
| 6. Give private Send a Max for ADA and an honest shortfall message | Partly | R1 P-5; R2 PY-3, PY-10 | **Max was reported in both rounds and left.** It needs a core builder that pays one Seedelf everything, like `sweep_from` (PY-3). **The message is new, and R2's PY-10 fix wrote it.** Core says "for this, its fee and the change". The fix dropped "the change" as jargon, and only the public side got a message saying what stays would be too little. So the private message names only the fee. |
| 7. Offer both routes for paying an ordinary address, and explain the words on the way | Partly | R1 P-1, P-2, SE-1; R2 PY-2, GS-4, FR-4, §6 | **Known.** Round one made private Send catch an address and offer "Pay it with Make public" (P-1). Renaming Make public is an open call (P-2, PY-2). Defining Seedelf is half done: Get started's step 2 and the ⓘ say what a Seedelf is (GS-4), and the closing onboarding screen was left (FR-4). **New:** offering the public account's Send beside Make public. |
| 8. Give the swap, Lovejoin and private-session screens one total | Partly | R1 D-3; R2 DX-3, CW-7, CW-8, LJ-3 | **Left.** The swap's total was left: DX-3 was "Partly" fixed, "Not the three-row summary". **A part regressed.** CW-8 was marked fixed, and the session's 5 ₳ is now "Kept aside for contracts". But the swap review's own note still calls it "the collateral", beside giveme.my's (T10). **Fixed.** Lovejoin's cost is put in proportion, with one figure everywhere (D-3, LJ-3). LJ-3 also noted that the return fee isn't its own line. **New:** nothing reconciles 3.8 ₳ with 15.3 ₳. The private session's way back also has no figure: CW-7's fix shortened that line to "A fee each way". |
| 9. Say what happens to the user's own money on reviews and in Transaction details | Regression | R1 S-2, S-9; R2 PY-6, PY-7, ST-6, SE-3, §6 | **The rewards row was reworded in both rounds.** It went from "spent" to "collected" (S-2), then to "moved into your balance" (PY-6, marked fixed). Four testers still stopped at it. **Still open:** unmarked own outputs. PY-7's partial fix left "the user's own change address isn't marked", and §6 flagged "a key that stakes". **New:** when withdrawing by hand matters, which the ST-6 fix's honest review now raises. |
| 10. Open every screen at its top | New | None; for the 360x480 case, R1 V-5 and R2 V-1 | **No earlier review reported scroll position.** The 360x480 case, a pinned Send over the total, belongs to the sticky-foot problem R1 V-5 and R2 V-1 reported. R2's fix made the sign windows' feet follow the body, but not the wallet's own reviews. |

### Section 4: product moments

| Rank | Moment (short) | Status | Earlier reference |
|---|---|---|---|
| 1 | Pending balance rises above its pre-send figure | Regression | R2 HM-1 ("Fixed, bounded"), and the double counts R2 §9's own review closed. The HM-1 fix's change on its way holds the withdrawn rewards, which the balance still counts. So the figure is now too high by the rewards, where R2 saw it too low. |
| 2 | "Sent +32.300614 ₳" for a 25 ₳ payment | Partly | R2 AC-3 noted that the detail's amount includes the fee, and it was left open. New: the plus sign, and the withdrawal ignored in the net. Launch review H1 found the same fault in the site's signing prompt and fixed it there. |
| 3 | "No Cardano wallet was found on this page." | Partly | R1 D-1 is fixed: the dApps row says Sites is off and offers "Let sites connect". Off by default is a privacy decision. Settings as an index is an open call (R1 SET-1, R2 SE-1). New: the failure starts at the site, away from that notice. |
| 4 | The most the private balance can send | Partly | No Max: R1 P-5 and R2 PY-3, left because it needs a core builder. New: the message leaves out the change's minimum, which R2's PY-10 fix dropped from core's "its fee and the change". Also new: the check's fee estimate is higher than the review's. |
| 5 | Still no wallet after turning Sites on | New | None. No review or design doc mentions the reload. |
| 6 | A disconnected site still shows itself as connected | New | None. R2 CW-6 fixed the wallet's own session text ("stays connected"), which is a different screen. |
| 7 | Paying an ordinary address starts at the wrong Send | Partly | R1 P-1 was fixed in round one: Send catches an address and offers Make public. Renaming Make public (R1 P-2, R2 PY-2) and opening on Public (R2 GS-3) are open calls. New: the error never offers the public account's Send. |
| 8 | Two activity lists, and the first gives the wrong answer | Previously reported | R1 §4 and R2 §4: "all my activity" has no route. Neither review gave it an ID, and §9 doesn't take it up, so it is still open, with no decision. |
| 9 | What a mix costs | Partly | R1 D-3 and R2 LJ-3 are fixed: the cost is put in proportion, with one figure everywhere. LJ-3 also noted that the return fee isn't its own line. New: 3.8 ₳ and 15.3 ₳ don't reconcile, because of an unnamed 1.5 ₳ reserve. |
| 10 | After a send, nothing on Home or in Activity changes | Regression | R1 H-10: round one fixed only the inline reason. R2 HM-1/HM-2 were "Fixed, bounded", saying each side shows what's on its way. R2 HM-6 was "Fixed", though it had asked for a refresh on return. Home's `sent` handler reads nothing, so the on-its-way line shows only after a manual Refresh. The public Activity's pending row was left on purpose. |
| 11 | The swap review has no total | Previously reported | R2 DX-3 was "Partly" fixed: "Not the three-row summary", and that summary's total cost was left. Round one's "Total leaving" (R1 S-3) reached the standard reviews, not the swap's. The Minswap warning is DX-2's fix. Lovejoin on by default follows the private-by-default rule. |
| 12 | A payment comes in, and the balance stays at 0 ₳ | Partly | The owner left polling for incoming payments out of chunk 14's list, and the post-release roadmap's notification centre waits for the data layer. New: only a small, unlabelled Refresh shows the deposit. |
| 13 | No visible sign that Create Seedelf was sent | New | None for scroll position. R2 HM-11's renamed banner was on the screen, above the view. |
| 14 | Decline cooldown: a retry is refused, and the wallet shows nothing | Regression | R2 CW-3 ("the wallet showed nothing") was marked fixed: waits of 10 s, 60 s and 5 min, and the site is told when it can ask again. The wallet itself still shows nothing. |
| 15 | Outside party and privacy caveat on private-spend reviews | Partly | R1 P-4 and R2 PY-7: R2 kept the giveme.my sentence on purpose. R2 CW-8 renamed the collateral. Privacy review §2.12 added the follow-the-money caveat on purpose. It also called "the site sees only it" an over-promise, yet the connect window still says "The site sees only a new one-time account". New: who giveme.my is, whose money the collateral is, whether it charges anything, and no link to Settings → Collateral. |
| 16 | "Signed … not sent yet" before confirming | Previously reported | R2 PY-7 was "Partly" fixed: "not sent yet" was added, but "Signed" stays and "Ready to send" wasn't adopted. A password on the wallet's own sends is an open call (R1 S-8, R2 §7). |
| 17 | Refusal headline names the wrong cause, and a second refusal leaves nothing to do | New | The headline is R1 P-3's suggested copy as built, with the service's words under Details and R2 §6's "make a new review". Neither review questioned the guess at the cause, or a repeat refusal. R2 PY-1's fix, "Review updated just now", worked in this test. |
| 18 | "Staking rewards moved into your balance … already counted in it" | Regression | R1 S-2 ("spent") was reworded to "collected". R2 PY-6 said "collected" reads as a charge, and was marked fixed as "moved into your balance". T07 still read the row as money moving, and T04, T04b and T08 paused at it. |
| 19 | Why withdraw rewards at all? | New | The question comes from two R2 fixes: ST-6 (the withdrawal says the balance stays the same) and SE-3 (the setting says why to turn it off). "Settings can keep them here instead" is older text that no review flagged. |
| 20 | Staking and voting aren't on the tab Home opens on | Previously reported | R1 H-6 and §4. R2 HM-10 was left as a layout call, and opening on Public is an open call (R2 GS-3). |
| 21 | Swaps and mixing only behind "dApps" | Previously reported | R1 D-2 and H-6. Swap on Home is an open call (R2 DX-6), and R2 HM-10 was left. |
| 22 | "dApps" doesn't list connected sites | Previously reported | R2 CW-6 and §4: one list of sites was left as "a structural call". |
| 23 | Private Receive on a new wallet: no Seedelf, and Create disabled | Previously reported | R1 H-2 and H-3: round one added the reason and "Show my public address", which kept T01 going. Opening a new wallet on Public is an open call (R2 GS-3). |
| 24 | No sign of accounts on Home | New | None. Chunk 18 hides the account picker with one account by design. R2 PA-1's fix of the add flow worked in this test. |
| 25 | After repeated failures, only "Try again in a minute" | Partly | R1 L-2 and R2 HM-5 are fixed, and this test found the stale-balance alert reassuring. New: there's nothing else to try. A user-set Koios is privacy review §4.7, still open and waiting for the data layer. E05's alert also vanished after a trip to Settings with nothing fixed, though HM-5's fix meant it to clear on a good reading (synthesis §7, not ranked). |
