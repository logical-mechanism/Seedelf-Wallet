# gap-g8#8: verification

From lane gap-G8, graded low by its finder.

## Trace: confirmed, low

The finding holds as described. A private swap into a token that's not on the wallet's list and not verified by Minswap is refused outright, in two places: the form never offers Review, and the worker's outBuild throws. No setting or switch turns it off. The DEXes' order scripts take any token, and Minswap's router does route unverified tokens (chunk 24 recorded preprod routes to USDRF, USDCx and PPEE). So the wallet refuses something the ledger and the contracts accept, against the owner's rule of 2026-10-19.

I found no guard the finder missed. outBuild has one caller, and nothing else reads `verified`. In a copy, a two-line switch made my test pass while the existing pin of the refusal still passed, so the check at sessions.ts:1919 is the only thing in the worker that blocks the swap. Nothing in the backlog, the archived reviews or the owner's rules settles it. Launch review #20's fix said to "list unverified tokens apart". The refusal itself was c703ee2c's choice (Claude's, 2026-09-27), made before the owner's rule, and no owner's call on it is recorded.

Severity is low:
- **Who:** the user, by an ordinary action (buying more of a new, unverified token they hold).
- **Cost:** no money moves; the swap is refused before anything is built.
- **Way out:** a private session for a site has no such check (siteOutBuild, sessions.ts:2036-2060), so the user can still swap privately on Minswap's own site, or from the public account.

**Evidence:**

The trace, every cited line opened in TREE (cd764fba; the same code is at tag web-wallet/1.9.1):

1. **Where it's decided** (sessions.ts:1899-1905):
   - verified(): `if (id === "lovelace" || LISTED[network].has(id) || this.verifiedIds.has(...)) return true; const found = await this.deps.minswap(network).tokens(id, true); const verified = found.some((t) => t.token_id === id && t.is_verified !== false);`
   - minswap.ts:400-403 always sends `only_verified: onlyVerified`, and both callers pass true.
   - LISTED is src/tokens/list.json (sessions.ts:822-825).
2. **The quote** (sessions.ts:1600-1626): routeOf asks Minswap's estimate first, then sets `verified: await this.verified(network, checked.tokenOut)`. The verified flag is computed only after Minswap has quoted.
3. **The form** (Swaps.tsx:760-761): `const unverified = current?.verified === false; const ready = !!current && !tooMuch && !short && !unverified && !quoteError;`
   - The button label is `unverified ? tr("swaps.cta.unverified")` (:952-953), "Not verified by Minswap", disabled.
   - The callout (:1717-1729) uses en.json:2605 swaps.warn.unverified: "…so the wallet won't swap into it. Anyone can copy a known token's name.", and shows `text.fingerprint`.
4. **The worker** (sessions.ts:1918-1919): `const ask = checkAsk(quote.ask); if (!(await this.verified(network, ask.tokenOut))) throw new Error(UNVERIFIED());`
   - Its only caller is handlers.ts:468-475 (session-out-build).
   - grep finds `this.verified(` only at :1626 and :1919, and no preference or switch for it.
5. **The picker** (Swaps.tsx:1895-1898, 1977-1986): a held token that's not listed and not in Minswap's results goes under "Also held" and can be picked. Minswap's search (sessions.ts:1578-1589) returns verified tokens only, so a token you don't hold and Minswap doesn't verify can't be picked at all.
6. **Reach:** chunk-24-dapp-additions.md:243-244 (2026-10-07): "Minswap's preprod router sends tADA→USDRF, tADA→USDCx … and tADA→PPEE through SundaeSwapV3", and "The wallet can't buy any of those three on preprod: it swaps only into tADA, a token on its own list … or one Minswap verifies (on preprod, only MIN)." Chunk 24 records the effect but makes no decision.
7. **The refusal is pinned as intended:** tests/sessions.test.ts:258-282 ("the wallet won't fund one that isn't") and e2e/extension.spec.ts:3992-4027 ("it can't be reviewed").
8. **Origin:** c703ee2c, "The funding of a swap into one that isn't is refused." It is in 1.0.0 (an ancestor of 0d5ec42) and in 1.9.1. Launch review #20's fix (launch-review.md:240) said "Check `tokenOut` in the worker, and list unverified tokens apart". #20 isn't among that review's owner's calls or decisions (:44-49, :293-299).
9. **Way out:** siteOutBuild (sessions.ts:2036-2060), the funding of a site's private session, has no verification check.

**Runs:**
- On TREE, `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m npx vitest run tests/r51-gap-g8-8.test.ts` fails at sessions.ts:1919:62, after the quote assertions pass (verified: false).
- In a copy (`$HOME/.cache/seedelf-review-51/verify-gap-g8_8-trace`, now removed), I added `anyway?: boolean` and changed the check to `if (!anyway && !(await this.verified(...)))`. Then:
  - my test: 1 passed;
  - `tests/sessions.test.ts -t "is verified only for ADA"`: 1 passed (the unconfirmed refusal).
- `tsc --noEmit -p .` on the copy, restored to TREE's source: 0 errors in my file.

**Known:** None: it isn't settled or known. What I searched:
- **backlog.md:** unverified, verified, picker, "Minswap's list", tokenOut, refuse, and the Declined list. Nothing.
- **archive/plans and plans/:** unverified, "verified list", "Minswap verifies", "not verified", tokenOut, alsoHeld, noneVouched, "wallet's list". Found:
  - launch-review.md:240 (#20): its fix says "Check `tokenOut` in the worker, and list unverified tokens apart". It isn't among that review's owner's calls or decisions.
  - usability-review.md:351: the "Unverified" badge.
  - chunk-24-dapp-additions.md:244: records that the wallet can't buy the unverified preprod tokens. It's a record of behaviour, not a decision or a leftover.
- **SECURITY.md:** no scope exclusion applies.
- **The owner's rules** (COMMON.md, and memory no-paternalistic-guards, 2026-10-19): "refuse only what the ledger or the contracts refuse"; this refusal is against it.
- **The review's own lanes:** E7a (lanes/E7a.md:131, :152) listed this check as a guard that holds, not as a decision.
- **Not the same family:** Lovejoin's "listed tokens only" for pools is the owner's own direction (chunk-34-token-pools.md:159, D1), so it is a different case and shouldn't be swept in.

**Fix notes:**

**Needs the owner:** the fix changes what the swap form offers and reverses c703ee2c's refusal. Under the 2026-10-19 rule, it gets a warning at most.

1. **Keep the warning:** keep `quote.verified` and the Unverified callout, with the fingerprint and the token's full ID.
2. **The form** (Swaps.tsx:760-761, :952-953): stop treating `unverified` as not ready. Put Review behind a switch, "Swap into it anyway", the way the sign window's release switch works.
3. **The worker:** carry the switch in the session-out-build message (handlers.ts:468-475) to outBuild, for example as a parameter after `through`. Keep refusing at sessions.ts:1919 when it's absent; this matches the backlog's case for the worker checking the release switch. In the copy, those two lines were all the worker needed: nothing else in outBuild depends on verification.
4. **Words** (keep the UI text short):
   - swaps.warn.unverified and swaps.cta.unverified are critical keys (critical-keys.json:416, :446), so changing their values needs fresh es/ja back-translation and a grep of the tests for the keys and their regex forms.
   - sess.unverified becomes the refusal for an unconfirmed swap only.
   - Comments that say "won't fund it": rpc.ts:1663-1668, sessions.ts:827-828, Swaps.tsx:1712-1716.
5. **Tests to update:**
   - sessions.test.ts:258-282 keeps its unconfirmed refusal.
   - e2e/extension.spec.ts:3992-4027 ("can't be reviewed") becomes "reviewed only behind the switch".
   - This test's buildConfirmed should follow whatever API the fix picks.
6. **Optional:** let the picker's Search Minswap show unverified matches apart, with the same mark (sessions.ts:1581 passes only_verified true). Minswap already sees the query on Search, so privacy doesn't change.

**Test:** `/home/logic/Documents/LogicalMechanism/Seedelf-Wallet-chunk51/seedelf-platform/seedelf-web-wallet/extension/tests/r51-gap-g8-8.test.ts`

Result: On TREE, it FAILS as intended (run from extension/: `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 10m npx vitest run tests/r51-gap-g8-8.test.ts`):

```
 ❯ tests/r51-gap-g8-8.test.ts (1 test | 1 failed) 566ms
     × is quoted with verified false, for the warning, and funded once the user confirms it 564ms
 FAIL  tests/r51-gap-g8-8.test.ts > gap-g8#8: a private swap into a held token Minswap quotes but doesn't verify > is quoted with verified false, for the warning, and funded once the user confirms it
Error: The token you'd get isn't on the wallet's list or verified by Minswap, so the wallet won't swap into it.
 ❯ SessionService.outBuild src/background/sessions.ts:1919:62
    1919|     if (!(await this.verified(network, ask.tokenOut))) throw new Error…
 ❯ tests/r51-gap-g8-8.test.ts:77:17
 Test Files  1 failed (1)
      Tests  1 failed (1)
```

The quote assertions before line 77 pass: Minswap quotes the token, and the quote says verified: false.

In a copy with the switch added (`anyway?: boolean` after `through`, then `if (!anyway && !(await this.verified(...)))`):
- my test: `Test Files 1 passed (1) / Tests 1 passed (1)`;
- `tests/sessions.test.ts -t "is verified only for ADA"`, the existing pin that an unconfirmed swap is refused: `Tests 1 passed | 60 skipped (61)`.

`tsc --noEmit -p .` reports 0 errors in this file. I removed the copy afterwards. TREE has no tracked changes; the only file added is this test.

```
// Chunk 51, gap-g8#8: a private swap into a token that's neither on the wallet's list nor verified by Minswap is
// refused outright, though Minswap quotes it and a DEX's order takes any token it has a pool for.
//
// The trace, on TREE (cd764fba, the same code as web-wallet/1.9.1):
// - background/sessions.ts:1899-1905 verified(): true only for "lovelace", a token on src/tokens/list.json (LISTED),
//   or one Minswap's token search, asked with only_verified (minswap.ts:400-403), returns by that exact ID.
// - sessions.ts:1626: the quote says verified: false for any other, after Minswap has quoted it (routeOf, :1602).
// - ui/screens/Swaps.tsx:760-761: `ready` is false while `verified === false`, so Review swap is never offered. The
//   button reads "Not verified by Minswap", disabled (:952-953), and the callout says "so the wallet won't swap into
//   it" (:1717-1729, en.json swaps.warn.unverified). No setting or switch turns it off.
// - sessions.ts:1919 outBuild: `if (!(await this.verified(network, ask.tokenOut))) throw new Error(UNVERIFIED())`. Its
//   only caller is handlers.ts:468-475 (session-out-build).
// - The picker's search (sessions.ts:1578-1589) lists Minswap's verified tokens only, so such a token can be picked
//   only from the private balance's own, under "Also held" (Swaps.tsx:1977-1986).
// Minswap's router does quote unverified tokens: chunk 24's plan recorded preprod routes for tADA to USDRF, USDCx and
// PPEE (2026-10-07), and that "the wallet can't buy any of those three on preprod" (only MIN is verified there).
//
// The right behaviour, under the owner's rule of 2026-10-19 (a risky but valid choice gets a warning at most) and as the
// finding's fix sketches it: the quote still says verified: false, for the callout with the token's fingerprint, and
// the worker funds the swap once the user has confirmed it on the approval ("Swap into it anyway", as the sign
// window's release switch is). Without that, it still refuses, which tests/sessions.test.ts:258-282 pins already. How
// the worker takes the switch is the fix's choice, and the owner's call: here it's outBuild's next argument after
// `through` (buildConfirmed below). A fix that carries it another way changes that function alone.
//
// It fails on TREE today with "won't swap into it", and passes once the switch reaches outBuild.
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

/** The approval's "Swap into it anyway", as the finding's fix has the worker take it: outBuild's sixth argument. */
type Build = (...args: unknown[]) => ReturnType<SessionService["outBuild"]>;
const buildConfirmed = (sessions: SessionService, quote: SwapQuote) =>
  (sessions.outBuild as Build).call(sessions, "preprod", quote, undefined, undefined, undefined, true);

describe("gap-g8#8: a private swap into a held token Minswap quotes but doesn't verify", () => {
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

    // Confirmed on the approval: funded as any swap is, the swap with its costs and the 5 ₳ collateral to its account.
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
```
