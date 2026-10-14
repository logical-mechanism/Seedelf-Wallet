# Chunk 35 · The owner's small fixes for 1.6.0

Things the owner noticed using the wallet (2026-10-14), lined up for 1.6.0 beside [chunk 34](chunk-34-token-pools.md). One branch, `web-wallet/small-fixes-1.6.0`, from `main` after #308. Each fix goes in as it's reported, and the PR merges before 1.6.0 is packaged. This file is the list and its record.

**Status: 🚧 open for more of the owner's list.** Fix 1 is built.

## 1 · Collateral: a way in from the public side, and the page that kept waiting

**What the owner saw:** "link to collateral creation on public side if it doesnt exist and the user wants/ needs it. And check collateral waiting for confirmation as it is not loading even though its on chain. It doesnt update on the collateral settings page but it does work on the home page."

**Why the page kept waiting:**
- It read its status once, when it opened.
- Settings replaces Home, so Home's watch stopped. That watch is what asks the worker about a sent transaction (`pending-tx`, every 15 s).
- The worker drops its kept reading only when that question finds the payment landed (`pending.ts` `forgetReading`). So even a reopened page read the old reading.
- The page said "waiting" for 10 minutes (`WAIT_MS`), then "Not set", which invited a second payment, unless Home had been opened.

**What changed:**
- **The page, while it waits,** asks `pending-tx` at once and then every 15 s, as Home does. Once the payment has landed or been let go, or the worker is watching another transaction, it reads the status again and shows the collateral set. Home then has no banner for it, since the page's question settled it.
- **Home's Public tab** has a **Collateral** row under dApps. It shows only while the collateral isn't set and the account holds something, and it opens the page in place. A payment sent from there goes to Home's banner, as Home's own payments do. Set is held while Home's last transaction confirms (`blocked`), as Home's actions are.
- **Lovejoin's mix from the public account** holds Review while the collateral isn't set. It gives the reason, with **Set collateral** under it, and the page opens in place. While the payment is on its way, it says so and reads the status again every 15 s, from the last reading. The worker's refusal (`lj.needCollateral`) stays as the backstop, and it's still the only word for *Mix again from my public account*.
- **Two new strings**, machine drafts: `lovejoin.mix.needsCollateral` and `lovejoin.mix.collateralComing`. The rest reuse the Collateral page's words.
- **No policy entry:** nothing new is sent or kept. The page asks what Home asks.

**My calls, which the owner can overturn:**
- **"Public side"** is read as Home's Public tab, plus the one flow in the wallet that needs collateral: Lovejoin's mix from the public account. **Not built:** a prompt when a connected site asks `getCollateral` and gets none, as Lace opens one. Today the site says so in its own words, and the Public tab's row is where it leads.
- **The row is a quiet list row, not a callout.** Many users never need collateral. It's hidden for an empty account, whose next step is Receive. It shows for a user who reclaimed theirs too: it's only a way in.

**Tests** (e2e):
- The Settings page shows the collateral set once it lands, and Home then offers nothing.
- The Public tab's row opens the page in place; the payment is sent, watched, and the row goes once it's set.
- No row when the wallet set the collateral itself, or with an empty account.
- Lovejoin's public mix: Review held, Set collateral in place, the reason while it's on its way, then Review released once it lands.

The three that wait on a 15 s watch are marked `test.slow()`.
