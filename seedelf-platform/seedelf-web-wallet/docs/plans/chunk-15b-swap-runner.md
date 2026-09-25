# Chunk 15b plan: a swap that runs itself

**Why:** a private swap works today (chunk 15, step 2), but every step is a button: fund the session, place the order, bring it back. On 2026-09-25 the user asked for it to run on its own after one approval, and above all to be able to **pick up at any point and carry on**. That matters for more than a locked wallet: a closed browser, a restarted worker, a wallet opened again hours later. It's built on the same branch, `web-wallet/dapp-connector`, in the same PR as the rest of chunk 15.

## Built (2026-09-25)

A swap runs itself after one approval, from a dApp browser, as *The design* below says, with the decisions above.

- **Worker:** `sessions.ts` gains the runner: `advance`, `stop`, `resume`, `runAll`, the `auto` record (the approval, a pause, a retry, Stop, the fill), recording before submitting, and `Refused` for failed checks. `sw.ts` runs it from the `seedelf.sessions` alarm and on unlock. Requests: `session-advance`, `session-stop`, `session-resume`.
- **UI:** `screens/Dapps.tsx`, the dApp browser (Home's **dApps** row; Minswap's tile with how many run). `screens/Swaps.tsx` is Minswap's page: the list's step per session, Send going straight to the swap's page, and that page's timeline, Refresh, Stop (one confirmation), the paused callout (Try again, Review it myself) and the retry line. Home's Private tab shows each running swap. Sessions from before keep their buttons.
- **Tests:** Vitest 9 in `tests/sessions.test.ts` (*a swap that runs itself*): the whole run; a price pause and the approved minimum; the funding limit; a restarted worker; locked then unlocked; a failure's wait, doubling; a transaction Koios never took, built again; Stop before an order; and never cancelling by itself, with Stop asking for the cancel. The fake Koios gained `missing` (transactions `tx_status` doesn't know). Playwright 2: the whole swap from the dApp browser to the success colour, through Home's running row; and a price pause, then Stop, with nothing ordered.
- **Departed from the design:**
  - The order's minimum and what counts as filled: *Decided in the build* above.
  - No `step` stored: it's worked out from the transactions and the chain each time, as the stage was.
  - Not on worker start: at a browser start the wallet is locked, so unlocking is what carries on; the alarm covers a worker restarted while unlocked.
  - The page asks every 20 s, and the runner reads a session's chain at most every 15 s unless Refresh is pressed.
- **Not done:**
  - **A live run on preprod,** and a cancel against a real order (Stop's cancel is tested only up to Minswap's request: there's no recorded cancel). Both need the user's go-ahead.
  - The restore scan (chunk 15's *Recovery*), and private CIP-30 (step 4).

## Found on the user's first try (2026-09-25)

- **MIN to ADA paused: "it spends something that isn't this session's."** Minswap had routed most of the 2,000 MIN through **DanogoCLMMV1**, a concentrated-liquidity DEX that swaps against its pools in the same transaction: four pool UTxOs, their scripts (redeemers, six reference inputs, a zero-ADA script withdrawal) and 3 ₳ of someone else's collateral. The check refused it, as it should; Stop brought everything back. ADA to MIN had gone through Minswap's own pools, which take orders.
- **Decided (the user): orders only, for now.** `estimate` and `build-tx` pass `exclude_protocols` (`DIRECT_PROTOCOLS` in `minswap.ts`). The same swap then routes through Splash as an order. On preprod's thin pools that quoted 1,283 ₳ instead of 1,489 ₳.
- **Each session gets its own stake key (the user).** Looking into it showed every one-time account carried the shared Seedelf stake key, which sits behind 385 UTxOs at 78 preprod addresses and ties all sessions together. Now session `i` is payment `24301'/0/i` with stake `24301'/2/i`, never registered; the record's `ownStake` marks the new ones, and older sessions keep their shared-stake address, where their money is. Pinned against `cardano-address` in `session_test.rs`; the extension's swap fixture was recorded again for it.
- **A failure is shown in the timeline** (it was a grey line under it, easy to miss): the step turns amber, the line under the steps says what's wrong in plain words ("Minswap is limiting requests from this connection", "Minswap hasn't seen the funding yet") and when it tries again, with **Try now** and the raw error under it. Retries start at 30 s and double to at most 5 minutes (they were a minute, doubling to ten). The user's second try, 50 MIN to ADA, sat on "Order placed": the order never reached the chain and the retry line was missed; the cause isn't known, and the next one will say.
- **The user's third try paused: "This transaction pays an address on mainnet."** On preprod, Minswap builds Splash's orders with Splash's mainnet order address (header `0x11`), which a preprod node refuses; its other two outputs were preprod's. It's what stalled the second try too. Now preprod routing also leaves out Splash and SplashStable (`excludedProtocols` in `minswap.ts`; mainnet keeps them), and whatever WebAssembly won't read in Minswap's transaction pauses the swap (`Refused`) instead of retrying. Without Splash, preprod MIN to ADA goes through Minswap's own pool, whose price is far lower (50 MIN for 0.55 ₳, against Splash's 67.5 ₳), so a session approved at Splash's quote pauses on the price: Stop it and start again.
- **Later, maybe:** allowing direct swaps, with the pools' script inputs, a collateral already signed by its owner, zero-ADA script withdrawals, a limit on the session's net change instead of what's paid out, and proceeds paid in the swap itself counted as filled.

## Start here

1. `git fetch origin && git checkout web-wallet/dapp-connector`. The branch is at 384ef7b or later: the connector (fe8b774), the Koios CORS fix (9d96bcd), private swaps (b858d22), preprod MIN's decimals (384ef7b).
2. Read, in order:
   - this file;
   - [chunk-15-dapp-connector.md](chunk-15-dapp-connector.md), its *Step 2* (the A1 steps, *Built*, and *Recovery*);
   - [flows.md, *Contract round trip*](../flows.md#contract-round-trip), what the user sees now;
   - [architecture.md, *Private sessions*](../architecture.md#private-sessions), how it's built.
3. Build and test.
   - From `seedelf-platform/`: `cargo test -p seedelf-wasm`, then `seedelf-web-wallet/wasm/build.sh`, then `node --test "seedelf-web-wallet/wasm/tests/*.test.mjs"`.
   - From `extension/`: `npm run typecheck && npm test && npm run build:ext && npm run e2e`.
   - Totals at the handoff: WebAssembly native 62 (plus 1 ignored fixture writer), Node 33, Vitest 239 (plus 2 skipped), Playwright 45.
4. The user tests by hand on preprod. They reload the extension after `npm run build` (never `npm run package`, which leaves a store build without the dev key in `dist/`).

## What's there now

- **`src/background/sessions.ts`, `SessionService`:**
  - `list` (reads the accounts with `refresh`), `quote`, `outBuild`/`outSubmit`, `swapBuild`, `txSubmit(swap | cancel)`, `orders`, `cancelBuild`, `backBuild`/`backSubmit`, `forget`, `tokens`.
  - `refuseOddities` guards what Minswap builds.
  - A session's stage (funding, open, returning, closed, failed) is worked out in `view()` from the sealed `sessions.<network>` record and the chain.
- **`src/background/minswap.ts`:** the aggregator client.
- **`src/ui/screens/Swaps.tsx`:**
  - `Swaps`: the list.
  - `NewSwap`: the form in Minswap's shape (You pay, You receive, a live quote), and the swap and funding review. Its arithmetic is in `src/ui/swap.ts`.
  - `Session`: the rows, and a `SessionFoot` of buttons.
  - After the funding is sent, the user lands on Home (`onSent`), not on the session.
- **WebAssembly:** `OneTimeAccounts`, `buildSessionReturn`, `inspectSessionTx`, `signSessionTx`, `attachWitnesses`.
- **Tests:**
  - `tests/sessions.test.ts`, with `fakeMinswap` and `sessionSwap` in `tests/fakes.ts`.
  - The Playwright test "a private swap: …" in `e2e/extension.spec.ts`, with `MinswapFake` in `e2e/support.ts`.

## Decided (the user, 2026-09-25)

- **One approval, then it runs.** The user approves the quote and the funding; the wallet does the rest (the design below, which the user agreed to in outline).
- **Polling while a swap runs is fine.** About 10–20 requests a swap is OK, as long as the screen shows clear progress that explains what's going on.
- **Pause and resume, at any point.** A locked wallet pauses the swap, and unlocking carries on. Any other interruption resumes the same way: a restarted worker, a closed browser, a wallet opened later.
- **No notifications.** No new permission. The screen shows success in the success colour, as the confirmed-transaction banner does; the user is either watching or checks later.
- **A new context,** on this branch.

## Decided when 15b started (the user, 2026-09-25)

- **An order that isn't filled: Stop, always the user's.** A **Stop** button is there the whole time a swap runs. It cancels the order, as *Cancel the order* did, and brings everything back. The wallet never cancels on its own, and there's no timer. Automation is the happy path.
- **A dApp browser, not Swaps.** Home's Swaps row becomes **dApps**: a grid of dApps. Minswap's tile opens its swaps (the Swaps screen). The next contract gets a tile of its own, and Swaps wouldn't make sense for it.

## Decided in the build

- **The order's minimum is the higher of the fresh quote's and the approved one.** The plan's rule, pausing whenever the fresh quote's minimum is under the approved one, would pause about half of all swaps on mainnet, since prices move both ways within a minute. So the order asks for at least what was approved, and the runner pauses only when the fresh quote expects less than that, and the order couldn't fill.
- **Filled means something arrived from a transaction the session didn't make, and Minswap lists no order.** Minswap's order list can lag behind the chain, so an empty list alone isn't a fill.
- **Stop asks once, then runs.** One confirmation, then the runner cancels (checked like a swap, and paying nothing out but the fee) and brings everything back.

## The design

### A runner that takes the next step

- **One function does the next thing for a session, whatever state it's in:** `advance(network, index)`, in `sessions.ts` or a new `sessions-runner.ts`. It must be safe to call any number of times: it reads the record and the chain, then acts.
- **It's called from three places:**
  - **The session's screen,** about every 15 s while it's open.
  - **A chrome.alarm** (`seedelf.sessions`) every minute while any session is running and the wallet is unlocked.
    - The `alarms` permission is already there; see `AUTO_LOCK_ALARM` in `sw.ts`.
    - The manifest's `minimum_chrome_version` is 116, where the shortest period is a minute (30 s only from Chrome 120).
    - Clear the alarm when nothing is running.
  - **Unlock and worker start** (`chrome.runtime.onStartup`, and after `Wallet.unlock`), so an interrupted swap carries on by itself.
- **One step at a time per session:** a promise queue in the service. There's one worker, so that's enough, as long as every step is also safe to repeat.
- **The record** (the sealed `sessions.<network>`) gains:
  - `auto: { approved: { amount, minAmountOut, fund }, step, paused?: { why, since }, retry?: { at, error } }`;
  - `step` is one of `funding`, `ordering`, `waiting`, `returning`, `done` or `paused`.

### The steps

| Step | Moves on when | Does |
|---|---|---|
| funding | the funding is on chain (`tx_status`), or the account holds it | → ordering |
| ordering | always | `swapBuild`, then the checks below; within them, sign and submit (`txSubmit`) → waiting; outside them → paused |
| waiting | the swap is on chain and Minswap lists no open order | `backBuild` + `backSubmit` → returning |
| returning | the return is on chain and the account is empty | → done, in the success colour |

- **What it signs by itself** (the approval's limits), on top of `refuseOddities`:
  - It spends only the session's UTxOs, and only its key signs.
  - What goes into order contracts is no more than the funding for the swap.
  - The fresh quote's `min_amount_out` is at least the approved one.
  - **Anything else pauses**, saying why ("The price moved: the order would give at least X, less than the Y you approved"), with **Review it myself** (today's manual review) and **Bring it back**.
- **Bring it back** needs no limits: it only pays the user's own private balance. It's refused while an order waits, as it is today.
- **Errors don't stop a swap.** Koios down, or Minswap's 429: the swap stays on its step, says "Trying again in a minute: …", and the next tick tries again, with a longer wait after repeated failures.

### Resuming at any point

- **Record every transaction before it's submitted,** as `outSubmit` already does. `txSubmit` and `backSubmit` record after `submit` today (`sessions.ts`, the `await this.submit(…)` then `await this.update(…)` pairs): swap that order, marking it `submitting` until Koios answers.
  - On resume, a recorded transaction the chain doesn't have is looked up with `tx_status`.
  - Still unknown after a while, it's dropped and the step built again. Its inputs are the same session's, so a second one can't pay twice: the ledger refuses a spent input.
- **Locked:** the runner does nothing (it can't sign), and the screen says it's paused until unlock.
  - Unlocking resumes it. The auto-lock setting doesn't change for a swap.
- **A restarted worker, or a closed browser:** everything is in storage and on chain.
  - The first tick after the next start and unlock finds where it is. A fill that happened meanwhile is simply there.
- **Another device:** out of scope here. It's the restore scan in chunk 15's *Recovery*.

### The waiting zone (UI)

- **Send on the funding review goes straight to the session's page,** not Home.
- **A timeline of four steps:** Funded, Order placed, Filled, Back in your private balance.
  - Each step shows waiting (spinner), done (tick, with its transaction's Cardanoscan link) or paused (warning).
  - One line says what's happening now, in plain words: "Waiting for the network to confirm the funding. It usually takes about a minute."
  - Reuse the `.step` styles (Home's getting-started list: `step--done`) and the done colour of `callout--done` / `TxBanner`.
  - **When it's done, the whole card turns the success colour.**
- **The swap's other screens:**
  - Home's Private tab shows a *Swap in progress* row that opens the session.
  - The Swaps list shows each session's step.
- **The manual buttons stay** for a paused swap, and **Bring it back** is always there to give up.
- **The Home banner** (`SESSION_PENDING`, one transaction at a time) is where other sends are watched.
  - The runner's submissions would keep replacing it, so session steps should skip it: the session's page is where a swap is watched.
  - `sessions.ts` `watch()` sets it today.

### Requests per swap

- **Koios:** `tx_status`, plus `credential_utxos` for the account, each tick while waiting on the chain. That's about two a minute, for a minute or two per step.
- **Minswap:** `estimate` and `build-tx` once, and `pending-orders` each tick while waiting for the fill.
- **In all:** about 10–20 a swap, and nothing while no swap runs.

### Tests to write

- **Vitest** (as `tests/sessions.test.ts`, with the fakes and the test clock):
  - Each step's move.
  - A worse fresh quote pauses.
  - A new `SessionService` on the same storage carries on: that's a restarted worker.
  - Locked, nothing happens; unlocked, it resumes.
  - An error waits and tries again.
  - A swap recorded but never sent is found and handled on resume.
- **Playwright:**
  - Starting a swap lands on the session's page.
  - Changing the fakes (`koios.confirmations`, `koios.addedToAccounts`, `swaps.orders`) moves the timeline to done, in the success colour.
  - Closing and reopening the page halfway carries on.

## Gotchas found in chunk 15

- **Minswap's aggregator:**
  - `build-tx` takes only a sender, and builds from UTxOs that are on chain. Funding and ordering can't be chained, so wait for the funding to confirm.
  - Its preprod API rate-limits after a few quick calls ("Rate limit exceeded, retry in 50 seconds"). Back off; never retry at once.
  - Cloudflare refuses non-browser user agents (error 1010). That only affects scripts, not the extension.
- **A swap is submitted through `attachWitnesses`, always.** Minswap's transaction carries the order's datum in its witness set, and re-encoding it would break the datum's hash.
- **A Koios backend can lag behind this wallet's own spends:** read through `readFresh` / `unspent` (`spent.ts`).
- **Koios's public tier:** 5,000 requests a day per IP address, and no CORS for pages. The extension's host permission for Koios is load-bearing; never `chrome.permissions.remove` a pattern that covers it (chunk 15's *Koios and CORS*).
- **Preprod MIN** isn't in the token registry. It's in `src/tokens/list.json` as `unregistered`, with 6 decimals.

## Not in this step

- A2 (a Minswap V2 order straight from Seedelf).
- The restore scan, and Find leftovers.
- Private CIP-30 (step 4).
- A live preprod run, which needs the user's go-ahead.
