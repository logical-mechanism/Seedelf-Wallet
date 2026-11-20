// Chunk 51, gap-g8#8: a private swap into a token that's neither on the wallet's list nor verified by Minswap was
// refused outright, though Minswap quotes it and a DEX's order takes any token it has a pool for (chunk 24 recorded
// preprod routes to three such tokens the wallet couldn't buy). By the owner's rule of 2026-10-19 a risky but valid
// choice gets a warning, never a block, so it goes behind a switch, as the sign window's contract switch is: the quote
// still says verified: false, the form's callout says so with the token's fingerprint and full ID, Review waits for
// "Swap into it anyway", and the worker funds it only with that switch on (outBuild's `anyway`, the message's own).
// Unconfirmed, it's refused as before (tests/sessions.test.ts pins that half). The verifier's test (verify/gap-g8-8.md),
// with the switch as the fix carries it.
import { describe, expect, it } from "vitest";

import { builtOutputs } from "../src/background/minswap";
import { SESSION_OUT, type SessionService } from "../src/background/sessions";
import type { SwapQuote } from "../src/shared/rpc";
import { minswapEstimate, ownedUtxos, testBalances, vectors, withdrawPreprod } from "./fakes";
import { bytes } from "./fixtures/swap-tx";

const PASSWORD = "correct horse battery";
const ASK = minswapEstimate.ask;
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;

/** As tests/sessions.test.ts has it: the 12-word phrase, and one spend, so the funding takes the 25 ₳ UTxO alone. */
async function unlocked() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  const evaluation = withdrawPreprod.amount.evaluation as { result: unknown[] };
  t.koios.evaluation = { ...evaluation, result: evaluation.result.slice(0, 1) };
  return t;
}

/** The private balance's own token (fixtures/owned-utxos.json, a2…#0): 1,234.56 "tUSDM" under a policy off the list. */
const held = ownedUtxos[1]!.asset_list![0]!;
const HELD = held.policy_id + held.asset_name;

/** The form's "Swap into it anyway", as the message carries it to outBuild. */
const buildConfirmed = (sessions: SessionService, quote: SwapQuote) => sessions.outBuild("preprod", quote, undefined, undefined, undefined, true);

describe("a private swap into a held token Minswap quotes but doesn't verify (chunk 51, gap-g8#8)", () => {
  it("is quoted with verified false, for the warning, and funded once the user confirms it", async () => {
    const t = await unlocked();
    // Minswap's verified list hasn't got it: its search, with only_verified, finds nothing by its ID.
    const fetch = t.minswap.fetch;
    t.minswap.fetch = async (url, init) => {
      if (!url.endsWith("/tokens")) return fetch(url, init);
      t.minswap.calls.push({ path: "tokens", body: JSON.parse(String(init.body)) });
      return Response.json({ tokens: [] });
    };

    // Minswap quotes it, as it quotes any token with a pool: what it costs, and what it gets.
    const quote = await t.sessions.quote("preprod", { ...ASK, tokenOut: HELD });
    expect(quote.ask.tokenOut).toBe(HELD);
    expect(BigInt(quote.amountOut)).toBeGreaterThan(0n);
    // The warning's source stays: the form shows the callout, with the token's fingerprint.
    expect(quote.verified).toBe(false);
    expect(t.minswap.calls.at(-1)).toMatchObject({ path: "tokens", body: { query: HELD, only_verified: true } });

    // Unconfirmed, refused as before, before any account is read.
    await expect(t.sessions.outBuild("preprod", quote)).rejects.toThrow("turn on Swap into it anyway");

    // Confirmed on the form: funded as any swap is, the swap with its costs and the 5 ₳ collateral to its account.
    const out = await buildConfirmed(t.sessions, quote);
    expect(out.txHash).toMatch(/^[0-9a-f]{64}$/);
    const kept = (await t.session.get<{ txCbor: string; swap: { tokenOut: string; minAmountOut: string } }>(SESSION_OUT))!;
    expect(kept.swap).toMatchObject({ tokenOut: HELD, minAmountOut: quote.minAmountOut });
    const paid = builtOutputs(bytes(kept.txCbor)).map((o) => o.lovelace);
    expect(paid).toContain(BigInt(quote.fund.lovelace) + BigInt(out.collateralReserve ?? "0"));
    expect(paid).toContain(5_000_000n);
    // Built, not sent: sending it is Start swap's.
    expect(t.koios.submitted).toHaveLength(0);
  });
});
