# Chunk 23 plan: style and flow, third pass

The wallet is feature-complete for Cardano (chunks 18–20) and the public side is finished (chunk 21), so this is round three of the owner's findings: [post-release-roadmap.md](../post-release-roadmap.md#the-ux-and-ui-pass)'s step 4. Rounds one and two were [chunk 12](../archive/plans/chunk-12-style-flow.md) and [chunk 14](../archive/plans/chunk-14-style-flow-2.md); 11a was only half-Lace. Branch `web-wallet/style-flow-3` from `main`, one PR into `main`.

**How it runs:** the owner tests the built extension and sends findings. Each finding goes in the list below with what was decided. Batches land with side panel and tab screenshots for the owner to check before they rebuild.

## Start here

1. `git fetch origin && git checkout web-wallet/style-flow-3`
2. Read this plan and the newest [roadmap.md](../roadmap.md#handoff-notes) handoff note.
3. Build and test (from `seedelf-platform/seedelf-web-wallet/extension`): `npm run build && npm test && npm run e2e`.
4. Ask the owner for new findings; add them to the list.

## Rules that still hold

[development.md's list](../development.md#rules-for-a-change-to-the-screens), in short: Lace is inspiration for look and flow, never a brand to copy; **every privacy note stays** — a redesign may move or shorten one, never drop it; correctness UX is always in scope; nothing new phones home without its own decision; every feature states its Koios cost, and anything paged scales with the contract's size; the name is Seedelf (`tests/words.test.ts`).

**And one this round adds** (chunk 22's call, so the pass needs no second doc review): a renamed control or a moved screen updates the e2e tests **and** [flows.md](../flows.md) in the same commit. A new or changed string goes into all three languages, `en`, `es` and `ja`.

## The list

| # | Finding | Decision | Status |
|---|---|---|---|

## Carried in

What earlier chunks left for this pass ([post-release-roadmap.md](../post-release-roadmap.md#the-ux-and-ui-pass)). The ones marked correctness are in scope whatever the list holds; the rest are the owner's to take or leave.

| # | Candidate | Decision | Status |
|---|---|---|---|
| C1 | **About 150 plain note paragraphs could become ⓘ hints** (`components/Hint.tsx`, chunk 17). Which ones is the owner's pick. Privacy callouts and warnings stay where they are. | **The owner said do it, so the pick is by a rule, now [development.md's](../development.md#rules-for-a-change-to-the-screens):** an explanation, what a feature is or how a transaction runs once sent, goes behind an ⓘ; a note stays on the page when it says what someone else learns or sees (Koios, giveme.my, Minswap, the chain), what an action costs or locks up, what can't be undone, what to do next or what's happening now, and so do empty lists' lines and one-liners. Of the 232 `note` paragraphs, **23 went behind icons**, in three places: **beside a screen's title** (`Screen`'s new `hint`) — Make private and its review, Create a Seedelf, Collateral, Receive publicly, Voting power, Become a DRep, the UTxOs screens, Public accounts, a staking delegation's review (when rewards start), a site's connect window (disconnect in Settings) and its private-session funding review, and the five Lovejoin reviews (how the mix runs); **beside a heading** (`Hinted`) — Staking's *Not staking* and *Voting power*, the DRep card's *Be your own DRep*, Become a DRep's *A profile*; **beside a label** — Settings' account number and Lovejoin's wait. **Kept on purpose:** Settings' Lovejoin paragraph (it says what a box costs and that locking sends the rest back unmixed), the swap review's three fees and the slippage dialog's note (costs, and what the dialog is for), the dApps page's sites line (the empty state). The ⓘ's text is its `title` (hover, and a screen reader's description) and goes on the page when clicked. Tests: `tests/hint.test.ts`; two governance assertions now look behind the icon. No requests. | ✅ built; the owner checks which others should go, or come back |
| C2 | **The splash reaches its 8 s cap on mainnet** (Koios is slow). Could a first reading show something sooner, a balance that fills in, rather than a cap that expires? Possibly [the data layer](../post-release-roadmap.md#the-data-layer)'s to fix. | | ❓ |
| C3 | **Never through a findings round:** the language picker, NFT images, being your own DRep (Staking and governance, Voting, the connect window's CIP-95 switch) and the transaction view. | | ❓ |
| C4 | **Correctness.** The connector's windows say "Your public account", while sites use the one Settings → *Sites* → **The account sites use** names, whichever is on screen. They should name it (its number and name). And does the top bar's native `select` hold up past about a dozen accounts? | **With several accounts, every window names the dApp account by number and name** (`accountNumberAndName`: "Account 3 · Savings", or "Account 3" with no name of its own; a name alone could be two accounts'). A signature's, a message's and a governance question's window say "Connected to Account 3 · Savings" under the site's address, where a session's says "Connected to private session N". The connect window's cost line reads "Your public account, Account 3 · Savings:", and choosing it adds "It gets Account 3 · Savings: sites always use the account Settings → Sites chooses, whichever one is on screen." Read from the current preference, as the worker signs with it. One account: unchanged. **The top bar's `select` stays native:** Chrome's list scrolls and jumps by typed letter, the list stops at 100 accounts (`MAX_KEPT`), and Settings → Public accounts filters past eight. Tests: `tests/dapp-prompt.test.ts`. No requests. | ✅ built; the owner checks |
| C5 | **Correctness.** `worker.accounts.tooMany` says "Remove one from the list", and nothing removes one; `worker.accounts.badIndex` counts from 0 where the screens count from 1. Retiring a DRep reads four ways in Spanish and two in Japanese; the glossary records one each once the strings agree. | **`tooMany`:** "Seedelf Wallet keeps up to 100 accounts, and this wallet's list is full." **`badIndex`:** "…a whole number from 1 to 2147483648", as the number box takes (`MAX_INDEX + 1`). **Retiring a DRep is Lace's word in each:** Spanish "retirar tu DRep" and "retiro de DRep" (dropping "dar de baja" and "retirarte como DRep"; the review button became "Revisar el retiro del DRep", since a rewards withdrawal's is "Revisar el retiro"), Japanese 退任 for every DRep, 引退 kept for pools. Both rows are in [glossary.md](../i18n/glossary.md); the three Spanish warnings it changed were back-translated again (verified-critical-es.json). No requests. | ✅ built |
| C6 | **Correctness.** "The Staking page" is still the shorthand in `koios.staking.notDelegated` and `settings.staking.rewardsWait`; chunk 21 renamed it **Staking and governance**. | Both say **the Staking and governance page**, in all three languages, and so does flows.md's one mention. No requests. | ✅ built |
