// Chunk 51, e7a#2: Stop's dialog on a swap approved to come back through Lovejoin, before its cost is known.
//
// The verifier's two cases (verify/e7a-2.md). A cost read that fails on Koios (a 429, the data layer down) isn't taken
// for "comes back directly": every pool read under stopCost is swallowed where it's made, and a pool with no room read
// counts every box the ADA pays for (priced's fitsOf). The first test pins that. The second held on 1.9.1: while the
// read is under way (`cost === undefined`, which a 429's retries and hold stretch), the dialog said the direct way's
// cost ("less the return's network fee"), and its Stop sent no `direct`, so the swap came back as approved, through
// Lovejoin. Now it says what's true either way: the hedged words the dialog already has, with "Working out…" under
// them, and Stop stays. A read the worker couldn't answer at all (a lock, a session over: the page's `"failed"`) says
// the same, without "Working out…", never null's "directly".
import { Children, createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NetworkContext } from "../src/ui/network";
import { StopDialog } from "../src/ui/screens/Swaps";
import { lovejoinOf } from "./chain-fixtures";
import { ASK, atSession, signing, unlocked } from "./swap-session";

/** Ogmios's answer when the network measures no more than a transaction declares. */
const AGREES = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };

/** A page's text, as a person reads it (swap-page.test.ts). */
function text(element: ReactElement): string {
  return renderToStaticMarkup(createElement(NetworkContext.Provider, { value: "preprod" }, element))
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();
}

type Props = Parameters<typeof StopDialog>[0];

/**
 * Stop's dialog as it reads, and what its Stop button (the last in its foot) sends when pressed: `direct`, or
 * nothing where it can't be pressed.
 */
function opened(props: Pick<Props, "placed" | "pools" | "cost" | "through">): { words: string; sent?: boolean; label: string } {
  let sent: boolean | undefined;
  let modal: ReactElement | undefined;
  const all: Props = {
    ...props,
    busy: false,
    onThrough: () => undefined,
    onClose: () => undefined,
    onStop: (direct) => {
      sent = direct;
    },
  };
  // The dialog's own element, its hooks run inside this render.
  function Probe() {
    modal = StopDialog(all) as ReactElement;
    return modal;
  }
  const words = text(createElement(Probe));
  const foot = (modal!.props as { foot: ReactElement }).foot;
  const buttons = Children.toArray((foot.props as { children: ReactNode }).children) as ReactElement[];
  const stop = buttons.at(-1)!.props as { disabled?: boolean; onClick: () => void; children: ReactNode };
  if (!stop.disabled) stop.onClick();
  return { words, sent, label: String(stop.children) };
}

/** What the direct way alone costs, as the dialog words it. */
const DIRECT_ONLY = ["less the return's network fee", "The cancel and the return each cost a network fee"];

describe("Stop on a swap approved to come back through Lovejoin, its cost not known yet (chunk 51, e7a#2)", () => {
  it("prices its return through Lovejoin even when every pool read fails: a 429 is no 'directly'", { timeout: 60_000 }, async () => {
    const t = await unlocked();
    t.koios.evaluation = AGREES;
    const now = t.clock.now;
    const out = "ab".repeat(32);
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: now,
          txs: [{ kind: "out", txHash: out, at: now, confirmed: true }],
          swap: { ...ASK, amountOut: "906594100", minAmountOut: "902083681" },
          auto: {
            approved: { minAmountOut: "902083681", fund: { lovelace: "16000000", tokens: [] } },
            direct: false,
            lovejoin: { depth: 1, delay: "6-24", box: "5000000" },
          },
        },
      ],
    });
    t.koios.addedToAccounts.push(atSession("c1".repeat(32), 0, "40000000"), atSession(out, 1, "5000000"));
    // Discovery hands over the 5 ₳ pool (lovejoinOf), and Koios then answers every request 429.
    const sessions = signing(t, { lovejoin: lovejoinOf(t), sleep: async () => undefined });
    let asked = 0;
    t.koios.fetch = async () => {
      asked++;
      return new Response("Too Many Requests", { status: 429 });
    };
    const cost = await sessions.stopCost("preprod", 0);
    // It asked, was refused, and still answers with the boxes: the dialog shows the switch, never null's words.
    expect(asked).toBeGreaterThan(0);
    expect(cost).not.toBeNull();
    expect(cost!.skipped).toBeUndefined();
    expect(cost!.boxes).toBeGreaterThan(0);
  });

  it("never says the direct way's cost while its cost is read, where its Stop then brings it back as approved", () => {
    const seen: string[] = [];
    for (const placed of [false, true]) {
      for (const pools of [false, true]) {
        // As openStop leaves it: the read under way, the switch on as approved.
        const { words, sent } = opened({ placed, pools, cost: undefined, through: true });
        // Pressed now, Stop sends no `direct`: the swap comes back as approved (sessions.ts stop, throughLovejoin),
        // through Lovejoin for this one. Only a press that brings it back directly may say the direct way's cost.
        if (sent !== false) continue;
        for (const phrase of DIRECT_ONLY) if (words.includes(phrase)) seen.push(`placed ${placed}, pools ${pools}: "${phrase}" in "${words}"`);
      }
    }
    expect(seen).toEqual([]);
  });

  it("says what's true either way, the read under way or failed, and keeps Stop", () => {
    for (const cost of [undefined, "failed" as const]) {
      const working = cost === undefined;
      for (const pools of [false, true]) {
        const before = opened({ placed: false, pools, cost, through: true });
        const what = pools ? "If the swap hasn't gone out yet, it won't, and everything comes back to your private balance." : "If no order has gone out yet, none will, and everything comes back to your private balance.";
        const going = pools ? "If it's going out right now, it can't be cancelled: if it lands, what comes back is swapped." : "If one is being placed right now, it's cancelled unless it fills first.";
        expect(before.words, `${String(cost)}, pools ${pools}`).toContain(`${what} ${going}`);
        expect(before.label).toBe("Stop the swap");
        expect(before.sent).toBe(false);
        expect(before.words.includes("Working out what goes through Lovejoin…")).toBe(working);
        for (const phrase of DIRECT_ONLY) expect(before.words).not.toContain(phrase);
      }
      // An order out: cancelled, and the cancel's own fee, never "the cancel and the return each cost a network fee".
      const ordered = opened({ placed: true, pools: false, cost, through: true });
      expect(ordered.words).toContain(
        "The order is cancelled, unless it fills first, and everything comes back to your private balance. The cancel costs a network fee too.",
      );
      for (const phrase of DIRECT_ONLY) expect(ordered.words).not.toContain(phrase);
      expect(ordered.words.includes("Working out what goes through Lovejoin…")).toBe(working);
    }
    // Read as coming back directly (null: approved that way, or no Lovejoin), it says so, as it always did.
    expect(opened({ placed: false, pools: false, cost: null, through: true }).words).toContain("less the return's network fee");
  });
});
