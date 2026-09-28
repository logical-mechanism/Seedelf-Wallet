// A swap's page as it reads (independent review M18, L21, L22, L24): the
// least its order asks for, a refund told from a fill, Stop's dialog while
// an order may be going out, and what its approval says Settings changes.
// Rendered as the page shows it.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SessionView } from "../src/shared/rpc";
import { NetworkContext } from "../src/ui/network";
import { Session } from "../src/ui/screens/Swaps";

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
