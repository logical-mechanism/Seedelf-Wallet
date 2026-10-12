# Chunk 32 · 5 ₳ for a found session's cancel

The owner asked on 2026-10-12, from [post-release-roadmap.md](../../post-release-roadmap.md)'s [Kept in mind](../../post-release-roadmap.md#kept-in-mind): a top-up for a session the restore scan found, so it can cancel an open order when its account holds no ADA, and to check that this case is handled properly.

**Status: ✅ built 2026-10-12** on `web-wallet/found-session-top-up`, from `main` after #303. One PR: the build and the docs together, so this file went straight to the archive. What still holds is in [architecture.md](../../architecture.md) (*The cancel is the wallet's own*), [flows.md](../../flows.md) (*If a session stalls*), [keys-and-accounts.md](../../keys-and-accounts.md) (*The restore scan*) and [privacy.md](../../privacy.md). The privacy policy has no new entry: nothing new is sent or kept.

## The gap

A session the restore scan finds (chunk 27) is brought back by hand: **Cancel the order** while one is open, then **Bring it back**. The cancel is the wallet's own (chunk 24), and its collateral is one of the account's UTxOs of ADA alone (`cancelOf`: its own 5 ₳, else the largest). A return from before chunk 24 checked only Minswap's list of orders, so it could take everything at the account while an order missing from that list was still open. Found after a restore, such a session's account holds nothing, or only tokens. Cancel the order was refused ("The wallet couldn't cancel the order: this session's account holds no UTxO of ADA alone to put up as collateral for cancelling the order."), and the wallet offered nothing to fix it. The order waited for its batcher. One priced past its slippage would wait for good, with its money in it. Paying the account from the public account by hand would link that account to the session on chain.

**What else touches it**, checked before building:
- **5 ₳ is enough.** The cancel's fee comes from the orders' own ADA (`cancel_orders` in `seedelf-core/src/orders.rs`), and from the collateral only when that ADA can't pay it.
- **The page is the only way in.** A found session has no `auto`, so no runner ever cancels for it.
- **A top-up on a found session's record works as a site's does.** What it pays the account (`outs`) counts as the session's own for the return and the close (`ownOuts`). The worker's runs look for it until it lands, since the session has no `auto` (`awaitsLanding`). A list read that lists it marks it confirmed (`fundingsListed`).
- **Nothing comes back early.** Bring it back and Bring everything back stay refused while the order is open.

## What changed

- **The worker** (`sessions.ts`): `cancelCollateralBuild` (`session-cancel-collateral-build`) builds a 5 ₳ payment from the private balance to the account. It builds it only for a session brought back by hand (no `auto`, `site` or `mix`), and only while all of these hold:
  - an order of the session is open (`liveOrders`);
  - the account holds no UTxO of ADA alone of 5 ₳ or more (`holdsCancelCollateral`);
  - no top-up is on its way (`topUpComing`: sent, not turned away, under 2 hours old, and its outputs not listed at the account yet).

  The funding's builder builds it (`buildFunding`, with a top-up's history rules), and it's kept as a top-up. `topUpSubmit` sends it, unchanged. `plainAda` is the cancel's own test for a UTxO of ADA alone, shared now.
- **The view:** `SessionView.cancelCollateral`, `missing` or `coming`, for such a session while it's open, from its last reading.
- **The page** (Swaps.tsx `Session`, which the dApps page's found sessions open):
  - **`missing`, order waiting:** the next step says the cancel needs 5 ₳ of ADA alone as collateral, and that it comes back. **Put in 5 ₳ to cancel** replaces Cancel the order, which would certainly be refused.
  - **Its review** (`CancelCollateralReview`) has a site top-up's shape:
    - the rows: To, Collateral for the cancel (5 ₳, comes back), the fee, what leaves the private balance, and what's left after;
    - Transaction details;
    - what it links (the top-up's privacy note, as a site's);
    - the histories note and giveme.my's.
  - **Once sent,** Home's banner watches it and the page reads the account again.
  - **`coming`:** the next step says the 5 ₳ is on its way, and Cancel the order stays greyed out until a read finds it.

**The threshold is 5 ₳, not any ADA alone.** The cancel puts up its own 5 ₳ first, else the largest UTxO of ADA alone, which must cover 1.5 times the fee and still come back as an output. A smaller one may not. So an account holding only a smaller UTxO of ADA alone (a stranger's, say) is offered the 5 ₳ too, rather than a cancel that may be refused.

**Not built:**
- **A swap that runs itself, on the device that ran it.** If its return from before chunk 24 left an order open, the session isn't closed, because the close waits on the order (`ordersOpen`). But its runner returns before any cancel when a return was its last step (`act`), and Stop is offered only before a fill or a refund. So nothing on that device cancels the order. Another browser's restore scan, or Find leftovers there, would find it, and this chunk now covers that. Traced in the code, not tested: whether any such session exists depends on what 1.0.0 to 1.2.x recorded.
- **An e2e test.** The e2e fakes don't model a found session, so the page was checked in a Vite harness instead: the real `Session` at 400 px, with the worker's answers stubbed, in each of the three states and the review.

## Tests

- `tests/restore-scan.test.ts`, "puts 5 ₳ in for a found order's cancel when the account holds no ADA alone, then cancels with it". It runs the whole sequence on one found session:
  1. The cancel is refused at first, and the view says `missing`.
  2. The 5 ₳ goes to the account alone, recorded with its `outs`.
  3. While it's on its way, the view says `coming` and a second one is refused.
  4. Once it's listed: confirmed, nothing more to put in, and the cancel builds and is sent.

  It fails without the change (no `cancelCollateralBuild`).
- **The same file,** "puts none in where no order of it is open, or for a session that isn't brought back by hand": a found session holding money but with no order, then a site's session. Neither builds or submits anything.
- **`tests/swap-page.test.ts`,** "offers 5 ₳ for its order's cancel…" and "reviews the 5 ₳ as a top-up…":
  - the foot and the next step in each state, and none with no order waiting;
  - the review's rows, the note, and the privacy note.
