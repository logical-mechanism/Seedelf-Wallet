// Which DEXes a mainnet swap goes through (independent review M16, M17): the
// ones whose orders the session's check reads, left to Minswap to route
// through, and every other DEX Minswap offers left out.
import { describe, expect, it } from "vitest";

import { excludedProtocols, MAINNET_PROTOCOLS } from "../src/background/minswap";
import { minswapEstimate } from "./fakes";
import { MIN, unlocked } from "./swap-session";

const leg = minswapEstimate.estimate.paths[0]![0]!;
const selling = { ...minswapEstimate.ask, tokenIn: MIN, tokenOut: "lovelace", amount: "500" };

describe("SundaeSwapV3 on mainnet (independent review M16)", () => {
  it("is left out of routing, and a quote through it is refused before anything is funded", async () => {
    // Minswap builds its orders under a fixed staking part that isn't the sender's, which the check refuses.
    expect(MAINNET_PROTOCOLS).not.toContain("SundaeSwapV3");
    expect(excludedProtocols("mainnet")).toContain("SundaeSwapV3");
    // SundaeSwap's own first version stays: its orders name the destination, at a script staked to the sender.
    expect(MAINNET_PROTOCOLS).toContain("SundaeSwap");
    expect(excludedProtocols("mainnet")).not.toContain("SundaeSwap");

    const t = await unlocked();
    t.minswap.estimate = { ...minswapEstimate.estimate, paths: [[{ ...leg, protocol: "SundaeSwapV3" }]] };
    await expect(t.sessions.quote("mainnet", selling)).rejects.toThrow(
      "Minswap routes this swap through SundaeSwapV3, whose orders the wallet can't check yet",
    );
  });
});
