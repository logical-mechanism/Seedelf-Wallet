# Chunk 15b plan: a swap that runs itself

**Why:** a private swap works today (chunk 15, step 2), but every step is a button: fund the session, place the order, bring it back. On 2026-09-25 the user asked for it to run on its own after one approval, and above all to be able to **pick up at any point and carry on**. That matters for more than a locked wallet: a closed browser, a restarted worker, a wallet opened again hours later. It's built on the same branch, `web-wallet/dapp-connector`, in the same PR as the rest of chunk 15.

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
  - `NewSwap`: the form, the quote, and the funding review.
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

## Open: ask the user before building it

- **An order that isn't filled.**
  - After how long does the wallet say so?
  - Does it ask, or cancel and bring the funds back on its own?
  - Recommended: after 10 minutes, show *Still waiting* with **Cancel the order** and **Keep waiting**, and never cancel on its own.

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
