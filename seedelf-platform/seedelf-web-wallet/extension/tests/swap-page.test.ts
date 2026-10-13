// A swap's page as it reads (independent review M18, L21, L22, L24): the
// least its order asks for, a refund told from a fill, Stop's dialog while
// an order may be going out, and what its approval says Settings changes.
// Rendered as the page shows it.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SessionBackSummary, SessionOutSummary, SessionView, SwapLovejoin } from "../src/shared/rpc";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import { isClaimable } from "../src/ui/screens/ClaimAll";
import { CancelCollateralReview, neverAgain, nextStep, Session, SessionFoot, StopDialog, SwapRow, swapsOnly } from "../src/ui/screens/Swaps";
import { loadTestWasm, sessionSwap } from "./fakes";
import { ASK, atSession, signing, unlocked } from "./swap-session";

/** A page's text, as a person reads it. */
function text(element: ReactElement): string {
  return renderToStaticMarkup(createElement(NetworkContext.Provider, { value: "preprod" }, element))
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();
}

const TUSDM = "16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde" + "0014df10745553444d";

/** A swap that runs itself, ADA to tUSDM, funded and ordering. */
function swapSession(over: Partial<SessionView> = {}): SessionView {
  return {
    index: 2,
    network: "preprod",
    address: "addr_test1" + "q".repeat(50),
    createdAt: 0,
    stage: "open",
    txs: [{ kind: "out", txHash: "ab".repeat(32), at: 0, confirmed: true }],
    swap: {
      amount: "10000000",
      tokenIn: "lovelace",
      tokenOut: TUSDM,
      slippage: 1,
      amountOut: "4200000",
      minAmountOut: "4158000",
      display: { in: { label: "₳", decimals: 6 }, out: { label: "tUSDM", decimals: 6 } },
    },
    holding: { lovelace: "17000000", tokens: [], utxos: 1 },
    auto: { step: "ordering", stopping: false, filled: false, approvedMinOut: "4158000" },
    ...over,
  };
}

const page = (s: SessionView) =>
  text(createElement(Session, { session: s, reading: false, onRefresh: () => undefined, onBack: () => undefined, onChanged: () => undefined }));

const swapTx = { kind: "swap" as const, txHash: "cd".repeat(32), at: 0, confirmed: true };

describe("a swap's timeline (independent review L24)", () => {
  it("says what the approval asked for until an order is placed, then what the placed order asks for", () => {
    expect(page(swapSession())).toContain("Asked for at least 4.158 tUSDM");
    // Placed by Review it myself after a pause, for less.
    const placed = swapSession({
      txs: [...swapSession().txs, swapTx],
      auto: { step: "filling", stopping: false, filled: false, approvedMinOut: "4158000", placedMinOut: "4000000" },
    });
    const line = page(placed);
    expect(line).toContain("Asked for at least 4 tUSDM");
    expect(line).not.toContain("Asked for at least 4.158 tUSDM");
  });
});

describe("a swap whose order was refunded (independent review M18)", () => {
  const over = (auto: Partial<SessionView["auto"]>) =>
    swapSession({
      stage: "closed",
      holding: { lovelace: "0", tokens: [], utxos: 0 },
      txs: [...swapSession().txs, swapTx, { kind: "back", txHash: "ef".repeat(32), at: 0, confirmed: true }],
      auto: { step: "done", stopping: false, filled: false, approvedMinOut: "4158000", placedMinOut: "4158000", ...auto },
    });

  it("never says the swap is done: it says it was refunded, and its tag says so", () => {
    const refunded = over({ refunded: true });
    const line = page(refunded);
    expect(line).toContain("Refunded: the order wasn't filled, so what you swapped is back in your private balance.");
    expect(line).toContain("Not filled: the DEX gave the order's funds back to the account");
    expect(line).not.toContain("Done: the swap is in your private balance");
    expect(line).not.toContain("The proceeds are at the account");
    const row = text(createElement(SwapRow, { session: refunded, onOpen: () => undefined }));
    expect(row).toContain("Refunded");
    expect(row).not.toContain("Done");
  });

  it("says a swap partly filled went partly through", () => {
    const partly = over({ filled: true, partly: true });
    expect(page(partly)).toContain("Partly filled, the rest refunded. Both are back in your private balance.");
    expect(text(createElement(SwapRow, { session: partly, onOpen: () => undefined }))).toContain("Partly filled");
    // A whole fill reads as before.
    expect(page(over({ filled: true }))).toContain("Done: the swap is in your private balance.");
  });
});

describe("Stop's dialog (independent review L22)", () => {
  const dialog = (placed: boolean, cost: SwapLovejoin | null) =>
    text(createElement(StopDialog, { placed, cost, through: true, onThrough: () => undefined, busy: false, onStop: () => undefined, onClose: () => undefined }));
  const through: SwapLovejoin = { boxes: 1, depth: 2, mixes: 4, mixFees: "3800000", withdrawFees: "300000", delay: "1-6", on: true };

  it("never promises no order is placed: the runner may be placing it as the dialog shows", () => {
    for (const cost of [null, through]) {
      const line = dialog(false, cost);
      expect(line).toContain("If no order has gone out yet, none will, and everything comes back to your private balance");
      expect(line).toContain("If one is being placed right now, it's cancelled unless it fills first.");
      expect(line).not.toContain("No order is placed");
    }
    expect(dialog(true, null)).toContain("The order is cancelled, unless it fills first");
  });

  it("isn't followed by a note about an order that went first until Stop says one did", () => {
    expect(page(swapSession())).not.toContain("before Stop took effect");
  });
});

describe("a swap's page once its order is filled, and once it's over (chunk 23's second review, DX-5)", () => {
  // Balances shown, as the preferences have them once read.
  const html = (s: SessionView) =>
    renderToStaticMarkup(
      createElement(
        PreferencesContext.Provider,
        { value: { prefs: DEFAULT_PREFERENCES, loaded: true, set: async () => undefined } },
        createElement(
          NetworkContext.Provider,
          { value: "preprod" },
          createElement(Session, { session: s, reading: false, onRefresh: () => undefined, onBack: () => undefined, onChanged: () => undefined }),
        ),
      ),
    );
  const shown = (s: SessionView) =>
    html(s)
      .replace(/<[^>]+>/g, " ")
      .replaceAll("&#x27;", "'")
      .replace(/\s+/g, " ")
      .trim();
  const stop = />Stop<\/button>/;
  const MIN = { policyId: TUSDM.slice(0, 56), assetName: TUSDM.slice(56), quantity: "4200000" };

  it("offers Stop until the order is filled, and not while everything comes back", () => {
    expect(html(swapSession())).toMatch(stop);
    const coming = swapSession({
      stage: "open",
      txs: [...swapSession().txs, swapTx],
      holding: { lovelace: "7000000", tokens: [MIN], utxos: 2 },
      auto: { step: "returning", stopping: false, filled: true, approvedMinOut: "4158000" },
    });
    expect(html(coming)).not.toMatch(stop);
    // What the account holds is one labelled row, its tokens too.
    expect(shown(coming)).toContain("It holds 7 ₳, 4.2 tUSDM");
  });

  it("says what came back once it's over, when the wallet kept it", () => {
    const done = swapSession({
      stage: "closed",
      holding: { lovelace: "0", tokens: [], utxos: 0 },
      txs: [...swapSession().txs, swapTx, { kind: "back", txHash: "ef".repeat(32), at: 0, confirmed: true }],
      auto: { step: "done", stopping: false, filled: true, approvedMinOut: "4158000" },
      received: { lovelace: "6500000", tokens: [MIN] },
    });
    expect(shown(done)).toContain("Received 4.2 tUSDM, 6.5 ₳");
    expect(shown({ ...done, received: undefined })).not.toContain("Received");
  });

  it("gives a turned-away funding's reason, and takes it off the list rather than forgetting it", () => {
    const failed = swapSession({
      stage: "failed",
      holding: null,
      unsent: true,
      unsentWhy: "changed",
      auto: { ...swapSession().auto!, step: "funding" },
    });
    const line = page(failed);
    expect(line).toContain("Its funding was turned away before it went out, so the account is empty. Something it spends had changed since the review.");
    expect(line).toContain("Remove from list");
    expect(line).not.toContain("Forget it");
  });
});

describe("a session the restore scan found (chunk 27)", () => {
  const found = (over: Partial<SessionView> = {}) =>
    swapSession({ index: 4, swap: undefined, auto: undefined, recovered: true, holding: { lovelace: "25000000", tokens: [], utxos: 2 }, ...over });

  it("is named by number and as found, warns of another browser, and only brings back what it holds", () => {
    const line = page(found());
    expect(line).toMatch(/^Private session 5 .*Found after a restore/);
    expect(line).toContain(
      "If this phrase is open in another browser, a swap or site there may still use this account. Bring it back from one browser only.",
    );
    expect(line).toContain("Nothing is waiting: bring everything in the account back into your private balance.");
    expect(line).toContain("Bring it back");
    expect(line).not.toContain("Place the order");
    // Its button is the page's main one.
    const markup = renderToStaticMarkup(
      createElement(
        NetworkContext.Provider,
        { value: "preprod" },
        createElement(Session, { session: found(), reading: false, onRefresh: () => undefined, onBack: () => undefined, onChanged: () => undefined }),
      ),
    );
    expect(markup).toContain('class="primary"');
  });

  it("stops warning once it's over", () => {
    expect(page(found({ stage: "closed" }))).not.toContain("another browser");
  });

  it("once it's over, never says the account is never used again, nor that everything came back (cross-area review X09)", () => {
    // Its own return landed: the Received row says what came back, and another browser may still use the account (C18).
    const back = page(found({ stage: "closed", received: { lovelace: "24700000", tokens: [] } }));
    expect(back).toContain("Received");
    expect(back).toContain("It's over in this browser: nothing more at its account comes back from here.");
    expect(back).not.toContain("never used again");
    expect(back).not.toContain("Everything came back");
    // Ended by itself with only what no return takes left at its account (C02): nothing came back from this browser.
    const left = page(
      found({
        stage: "closed",
        holding: { lovelace: "0", tokens: [], utxos: 0 },
        leftBehind: [{ txHash: "ab".repeat(32), txIndex: 0, reason: "fee", lovelace: "1200000" }],
      }),
    );
    expect(left).toContain("One UTxO stays at the session's account");
    expect(left).not.toContain("Everything came back");
    expect(left).not.toContain("never used again");
    // A session from before swaps ran themselves says it as before.
    expect(nextStep(swapSession({ auto: undefined, stage: "closed" }), true, false)).toBe(
      "Everything came back into your private balance. This account is never used again.",
    );
  });

  it("never says its return leaves the account unused for good: another browser may still use it (1.5.0's release review, C18)", () => {
    const back: SessionBackSummary = {
      network: "preprod",
      index: 4,
      txHash: "cd".repeat(32),
      fee: "300000",
      lovelace: "24700000",
      tokens: [],
      depositOutputs: 1,
      inputs: 2,
    };
    expect(neverAgain(found(), back)).toBeUndefined();
    // A swap from before swaps ran themselves says it as before, unless its return leaves something for the next.
    const before = swapSession({ auto: undefined });
    expect(neverAgain(before, back)).toBe("The account is never used again.");
    expect(neverAgain(before, { ...back, leftOut: [{ txHash: "34".repeat(32), txIndex: 2, reason: "tokens" }] })).toBeUndefined();
  });
  // Its order waits, and the account holds no ADA alone for the cancel's collateral (a return from before chunk 24).
  const foot = (s: SessionView, waiting = true) =>
    renderToStaticMarkup(
      createElement(SessionFoot, {
        s,
        swapped: true,
        waiting,
        busy: false,
        onSwap: () => undefined,
        onCancel: () => undefined,
        onCollateral: () => undefined,
        onBackCollateral: () => undefined,
        onBack: () => undefined,
        onForget: () => undefined,
      }),
    );
  const emptied = (cancelCollateral?: SessionView["cancelCollateral"]) =>
    found({ txs: [...found().txs, swapTx], holding: { lovelace: "0", tokens: [], utxos: 0 }, ...(cancelCollateral ? { cancelCollateral } : {}) });

  it("offers 5 ₳ for its order's cancel where the account holds no ADA alone, rather than a cancel that's refused", () => {
    const missing = foot(emptied("missing"));
    expect(missing).toContain("Put in 5 ₳ to cancel");
    expect(missing).not.toContain("Cancel the order");
    expect(nextStep(emptied("missing"), true, true)).toBe(
      "The order is waiting for a DEX's batcher to fill it. To cancel it, the account needs 5 ₳ of ADA alone as collateral, and holds none: put it in from your private balance. It comes back with everything else.",
    );
    // On its way: the cancel waits for it.
    const coming = foot(emptied("coming"));
    expect(coming).not.toContain("Put in 5 ₳");
    expect(coming).toMatch(/<button[^>]*disabled=""[^>]*>Cancel the order</);
    expect(nextStep(emptied("coming"), true, true)).toBe("The 5 ₳ for the cancel is on its way. Once it's at the account, cancel the order.");
    // There: the cancel, as before.
    const there = foot(emptied());
    expect(there).toMatch(/<button[^>]*>Cancel the order</);
    expect(there).not.toMatch(/disabled=""[^>]*>Cancel the order/);
    expect(nextStep(emptied(), true, true)).toBe("The order is waiting for a DEX's batcher to fill it. If it doesn't, cancel it.");
    // With no order waiting, nothing is offered: what it holds comes back.
    expect(nextStep(emptied("missing"), true, false)).toBe("Nothing is waiting: bring everything in the account back into your private balance.");
  });

  it("says its cancel is on its way while it is, with Cancel waiting and no 5 ₳ offered (1.5.0's release review, C04)", () => {
    const cancelling = found({ txs: [...found().txs, swapTx], holding: { lovelace: "0", tokens: [], utxos: 0 }, cancelling: true });
    const markup = foot(cancelling);
    expect(markup).not.toContain("Put in 5 ₳");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Cancel the order</);
    // A page that still holds an earlier reading of it as missing offers none either.
    expect(foot({ ...cancelling, cancelCollateral: "missing" })).not.toContain("Put in 5 ₳");
    expect(nextStep(cancelling, true, true)).toBe("The order's cancel is on its way. Once it's on chain, refresh, then bring everything back.");
  });

  it("says it ends by itself while it waits to, with Bring it back kept as the secondary button (the last review, L4)", () => {
    // Its order over and nothing at its account at a refresh: it ends at a refresh once that has held 15 minutes,
    // unless something comes in, which a refresh can read late (cross-area review X01). Bring it back reads the account
    // again, so it stays.
    const settling = found({ txs: [...found().txs, swapTx], holding: { lovelace: "0", tokens: [], utxos: 0 }, settling: true });
    const line = page(settling);
    expect(line).toContain(
      "Nothing at its account was left to bring back when it was last read, and its order is over. Once that has held for 15 minutes, the next refresh ends it, unless something comes in first, which Bring it back then takes.",
    );
    expect(line).not.toContain("bring everything in the account back");
    expect(foot(settling, false)).toMatch(/<button[^>]*class="secondary"[^>]*>Bring it back</);
    expect(foot(settling, false)).not.toContain('class="primary"');
    expect(foot(settling, false)).not.toMatch(/disabled=""[^>]*>Bring it back/);
    // An order the page's own reading finds open comes first, as for any session.
    expect(nextStep(settling, true, true)).toBe("The order is waiting for a DEX's batcher to fill it. If it doesn't, cancel it.");
  });

  it("offers 5 ₳ for its return through Lovejoin, a button beside Bring it back, and says why (1.5.0's release review, C53)", () => {
    const missing = found({ backCollateral: "missing" });
    const markup = foot(missing, false);
    expect(markup).toMatch(/<button[^>]*class="primary"[^>]*>Bring it back</);
    expect(markup).toMatch(/<button[^>]*class="secondary"[^>]*>Put in 5 ₳ for Lovejoin</);
    expect(nextStep(missing, false, false)).toBe(
      "Nothing is waiting. To bring its spare ADA back through Lovejoin, the mixes need a UTxO of exactly 5 ₳ of ADA alone at the account as collateral, and it holds none: put one in from your private balance. It comes back with everything else. Or bring it back now, directly.",
    );
    expect(page(missing)).toContain("Put in 5 ₳ for Lovejoin");
    // On its way: no second one, and Bring it back stays, but as the secondary button: the page says to wait for
    // the 5 ₳, and Bring it back before it lands comes back directly (cross-area review X20). Never greyed: a 5 ₳
    // that never lands mustn't hold the way back.
    const coming = found({ backCollateral: "coming" });
    expect(foot(coming, false)).not.toContain("Put in 5 ₳");
    expect(foot(coming, false)).toMatch(/<button[^>]*class="secondary"[^>]*>Bring it back</);
    expect(foot(coming, false)).not.toContain('class="primary"');
    expect(foot(coming, false)).not.toMatch(/disabled=""[^>]*>Bring it back/);
    // A session from before swaps ran themselves, its order filled, the same.
    expect(foot({ ...coming, recovered: undefined }, false)).toMatch(/<button[^>]*class="secondary"[^>]*>Bring it back</);
    expect(nextStep(coming, false, false)).toBe(
      "The 5 ₳ for Lovejoin's collateral is on its way. Once it's at the account, bring it back: its spare ADA goes through Lovejoin.",
    );
    // While an order waits, its cancel comes first; and none while a cancel is on its way.
    expect(foot({ ...missing, txs: [...missing.txs, swapTx] })).not.toContain("for Lovejoin");
    expect(foot({ ...missing, cancelling: true }, false)).not.toContain("for Lovejoin");
    expect(nextStep({ ...missing, cancelling: true }, false, false)).toBe("Nothing is waiting: bring everything in the account back into your private balance.");
  });

  it("reads its return's chain through Lovejoin as a site's page does: coming back while it's sent, then where it stopped (1.5.0's release review, C09)", () => {
    const sent = (kind: "deposit" | "mix", n: number) => ({ kind, txHash: String(n).repeat(64), at: 1, confirmed: false });
    const row = (s: SessionView) => text(createElement(SwapRow, { session: s, label: "Private session 5", onOpen: () => undefined }));
    expect(page(found())).not.toContain("Through Lovejoin");
    // Bring it back sent the chain's first four, a deposit and three mixes: the runs send the rest, its return last.
    // Until that return is sent, the record's stage reads open, its 5 ₳ collateral all the account holds.
    const going = found({
      txs: [...found().txs, sent("deposit", 1), sent("mix", 2), sent("mix", 3), sent("mix", 4)],
      holding: { lovelace: "5000000", tokens: [], utxos: 1 },
      chain: { total: 10, sent: 4, confirmed: 0, cut: false },
    });
    const line = page(going);
    expect(line).toContain("Where it's at Coming back");
    expect(line).toContain("Through Lovejoin Sending 4 of 10 transactions");
    expect(line).toContain("Coming back into your private balance. Refresh to check.");
    expect(line).not.toContain("Nothing is waiting");
    // No Bring it back, which the worker refuses while the chain is sent, nor Bring everything back, for a site's either.
    expect(foot(going, false)).toBe("");
    expect(isClaimable(going)).toBe(false);
    expect(isClaimable({ ...going, recovered: undefined, site: { origin: "https://app.example" } })).toBe(false);
    expect(row(going)).toBe("Private session 5 Running Coming back");

    // Stopped partway (a lock, say): the rest waits at the account, and Bring it back sends it directly.
    const stopped = found({ ...going, chain: { ...going.chain!, stopped: "The wallet locked, or the browser closed, while its chain was being sent." } });
    const after = page(stopped);
    expect(after).toContain("Where it's at Open");
    expect(after).toContain("Through Lovejoin Stopped after 4 of 10 transactions; the rest stays at the account until you bring it back");
    expect(after).toContain("Nothing is waiting: bring everything in the account back into your private balance.");
    expect(foot(stopped, false)).toContain("Bring it back");
    expect(isClaimable(stopped)).toBe(true);
    expect(row(stopped)).toBe("Private session 5 Open Its next step is yours");

    // Its return sent, the chain's tail on its way: as a site's page counts it.
    expect(page(found({ stage: "returning", chain: { total: 10, sent: 10, confirmed: 7, cut: false } }))).toContain(
      "Through Lovejoin 7 of 10 transactions on chain",
    );
    // A swap that runs itself says it on its timeline, as before: not a row too.
    const auto = swapSession({
      txs: [...swapSession().txs, swapTx, sent("deposit", 1)],
      chain: { total: 10, sent: 1, confirmed: 0, cut: false },
      auto: { step: "returning", stopping: false, filled: true, approvedMinOut: "4158000" },
    });
    expect(page(auto)).toContain("Coming back through Lovejoin: sending 1 of 10 transactions.");
    expect(page(auto)).not.toContain("Through Lovejoin Sending");
  });

  it("reviews the 5 ₳ as a top-up: where it goes, that it comes back, its fee, and what it links", () => {
    const address = "addr_test1" + "q".repeat(50);
    const review: SessionOutSummary = {
      network: "preprod",
      txHash: "ab".repeat(32),
      index: 4,
      address,
      payments: [{ address, own: false, lovelace: "5000000", minimum: null, tokens: [] }],
      max: false,
      fee: { size: "0", compute: "0", scriptReference: "0", total: "400000" },
      changeLovelace: "3600000",
      changeTokens: 0,
      changeOutputs: 1,
      changeMinimum: "0",
      inputs: 1,
      left: 0,
    };
    const stale = { detail: undefined, by: undefined, renewed: false, refused: () => undefined, built: () => undefined, clear: () => undefined };
    const line = text(
      createElement(CancelCollateralReview, {
        review,
        busy: false,
        stale,
        onBack: () => undefined,
        onAgain: () => undefined,
        onSend: () => undefined,
      }),
    );
    expect(line).toContain("To Private session 5");
    expect(line).toContain("Collateral for the cancel 5 ₳, comes back");
    expect(line).toContain("Total leaving your private balance 5.4 ₳");
    expect(line).toContain("The cancel puts this up as its collateral. It comes back with everything else when you bring the session back.");
    expect(line).toContain("This payment links the private UTxOs it spends to the session's account, as its funding did.");

    // For its return through Lovejoin (1.5.0's release review, C53): what it's for, in the return's words, and the
    // same privacy note.
    const back = text(
      createElement(CancelCollateralReview, {
        review,
        back: true,
        busy: false,
        stale,
        onBack: () => undefined,
        onAgain: () => undefined,
        onSend: () => undefined,
      }),
    );
    expect(back).toContain("To Private session 5");
    expect(back).toContain("Collateral for Lovejoin's mixes 5 ₳, comes back");
    expect(back).toContain("Total leaving your private balance 5.4 ₳");
    expect(back).toContain(
      "Lovejoin's mixes put this up as their collateral. It comes back with everything else when you bring the session back.",
    );
    expect(back).toContain("This payment links the private UTxOs it spends to the session's account, as its funding did.");
    expect(back).not.toContain("cancel");
  });
});

describe("Minswap's list, once a session's page hands it every session (1.5.0's release review, C20)", () => {
  it("keeps to its swaps when Forget answers with one the restore scan found, a site's or a mix", async () => {
    const t = await unlocked();
    // The fakes' giveme.my turns a funding away until `signing` has it lend its collateral.
    const refusal = t.collateral.answer;
    const sessions = signing(t);
    // A restore's scan found session 0, which holds 25 ₳: the dApps page lists it, under After a restore.
    const stake = await t.wallet.withKeys((keys) => keys.oneTime.rewardAddress(loadTestWasm().Network.Preprod, 0));
    t.koios.usedStakes.add(stake);
    t.koios.accountTxs.set(stake, [{ tx_hash: sessionSwap.utxo.tx_hash, block_height: 5_000_000, block_time: 1_705_000_000 }]);
    t.koios.addedToAccounts.push(atSession(sessionSwap.utxo.tx_hash, 1, "20000000"), atSession(sessionSwap.utxo.tx_hash, 2, "5000000"));
    expect(await sessions.scan("preprod")).toEqual({ used: 1, found: [0] });
    // A swap, session 1, whose funding giveme.my turned away: it never went out, and Forget takes it off the list.
    t.collateral.answer = refusal;
    const out = await sessions.outBuild("preprod", await sessions.quote("preprod", ASK));
    await expect(sessions.outSubmit("preprod", out.txHash)).rejects.toThrow();
    const answer = await sessions.forget("preprod", out.index);
    expect(answer.map((s) => [s.index, s.recovered])).toEqual([[0, true]]);
    expect(swapsOnly(answer)).toEqual([]);
    // A site's session and a mix are listed elsewhere too: on the dApps page, and Lovejoin's.
    const swap = swapSession();
    expect(swapsOnly([swap, { ...swap, index: 5, site: { origin: "https://app.example" } }, { ...swap, index: 6, mix: { boxes: 1 } }])).toEqual([swap]);
  });
});
