# v-x-docs-6-trace: x-docs#6, the Leios entry's "all of it ran" and "a window of four"

**Verdict: confirmed, nit.** All three claims hold on HEAD (`6bca8bec`). The first is a little narrower than the finding puts it, because line 406 already ends with "A withdraw can't be mended after it's built". The scenario was decided by a scratch test and a mutation check: a four-box chain goes two at a time today, and still does with `CHAIN_WINDOW` raised alone.

PR #338 wrote lines 405 to 409 (`git diff 6bca8bec^1 6bca8bec`): a pure docs PR, as the owner says. Its text condenses `seedelf-leios/README.md` on `web-wallet/leios-musashi`, which carries the same simplification about the window (its lines 16, 49, 121 and 148).

## 1. "Mended, all of it ran on Musashi" (:406): real, slightly narrower

- The bullet's subject is "the wallet's script transactions as core builds them". The branch README's line 60 counts "each Lovejoin mix and withdraw" among those Dijkstra refuses.
- The README's line 66: "A Lovejoin withdraw can't be mended after the fact … None was sent here." Its line 157, under *What wasn't tested*, also lists "A Lovejoin withdraw".
- The README's own summary (line 13) and the run commit `33949ac5` name only what ran: "every Seedelf spend, every Lovejoin mix and a pool's launch".
- **Narrower:** :406 already ends "A withdraw can't be mended after it's built: its proofs bind every output." So the withdraw shows up as an exception. What's missing is that it was never sent or tested, and "all of it ran" reads as including it.

## 2. "a chain's window of four in flight (`pumpChain`)" (:409): confirmed

- `lovejoin.ts:294` `CHAIN_WINDOW = 4`, `:300` `CHAIN_WINDOW_FOUR = 2`, `:302` `chainWindow = (width) => (width >= 4 ? CHAIN_WINDOW_FOUR : CHAIN_WINDOW)`.
- `pumpChain` uses `chain.window ?? CHAIN_WINDOW` (`:483`).
- Chains are created in only two places, and each sets `window: chainWindow(4)` for width 4:
  - `sessions.ts:4937`, through the single `savePending` caller, via `summary.lovejoin.width` from `chain.width` (`:4521`);
  - `lovejoin.ts:4635`, in `publicStart`.
- A chain that falls back to three carries no width, so it goes four at a time, which is correct for it.
- `CHAIN_WINDOW_FOUR` came in with four-box mixes themselves (`b9c35f06`, 34e, 2026-10-18; it is in 1.6.0's `babb8e76`). So no four-box chain has ever gone four at a time.

## 3. "120 to 245 s more" (:409): confirmed

The run records on the branch (`seedelf-leios/results/2026-10-28/`):

- `chain-w3-k4` (`"window": 4`): the first four landed at 314 s; the 5th, sent then, landed at 434 s. That is 120 s more, and it matches the wallet's behaviour.
- `chain-w4-k4` (`"window": 4`): the first four landed at 153 s; mixes 4 and 5 landed at about 398 s. That is 245 s more, but for a send the wallet never makes.
- The README's table labels only the three-wide K=4 run "(the wallet today)" (its line 94 against line 96). Its prose (line 121) and the roadmap drop that distinction.
- The harness's model never tried a window of 2: `main.rs:260` runs `[4, usize::MAX]` for every chain.

## The scenario: decided by test

**Scratch test** `extension/tests/zz-review-v-x-docs-6-trace-1.test.ts`, now deleted:

- **Model:** `pumpChain` driven with fakes, where each trip through the queue lands everything in the mempool together, in one EB (as the records show).
- **Chains:** the harness's shapes, `1 + mixesPerBox(2, w)`, giving 5 transactions three wide and 6 four wide.
- **Result:** 1 failed, 1 passed.
  - The entry's reading fails: `chainWindow(4)` is expected to be 4 and is 2.
  - HEAD's behaviour passes:
    - three wide at `chainWindow(3)`: `[t0..t3], [t4]`, two trips;
    - a chain saved with no window: two trips;
    - four wide at K=4 (the harness's run): `[t0..t3], [t4,t5]`, two trips;
    - **four wide at `chainWindow(4)`: `[t0,t1], [t2,t3], [t4,t5]`, three trips;**
    - sent whole: one trip.

**Mutation check**, in a copy under the scratchpad, now deleted:

- **Change:** `CHAIN_WINDOW = 1000` alone.
- **Result:** passed. A three-box chain goes in one trip, and a four-box chain still goes `[t0,t1], [t2,t3], [t4,t5]`.
- So the finding's scenario holds as stated: raising `CHAIN_WINDOW` alone leaves four-box chains at three trips, against the two the entry describes.

## Why only a nit

- Neither money nor privacy is involved.
- The change the entry anticipates comes "much later", after a Pallas update.
- Anyone editing `pumpChain` sees `CHAIN_WINDOW_FOUR` two lines below `CHAIN_WINDOW`, and `pumpChain`'s own comment names "the chain's own `window`".
- If anything, the wallet's real four-wide delay on Musashi would be one queue trip worse than the 245 s quoted, so the entry's conclusion ("could be the whole chain") is, if anything, understated.

## Fix advice (corrections to the proposed fix)

- **:406:** don't add a second withdraw sentence; merge with the one already there. For example: "Mended, every Seedelf spend, mix and a pool's launch ran on Musashi, Seedelf's and Lovejoin's scripts unchanged. … A withdraw can't be mended after it's built (its proofs bind every output), so none was sent."
- **:409:** name both windows, and attribute the two numbers correctly. For example: "a chain's window in flight (`pumpChain`: four, two for four-box mixes, `chainWindow`) could be the whole chain: sent four at a time, a three-box chain's rest waited for the queue again (120 s more); four-box chains go two at a time, a trip more."
- The same simplification is in the branch's README (16, 49, 121, 148). That branch is outside this review, so mend it only if it's ever touched again.
