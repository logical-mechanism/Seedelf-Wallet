// Chunk 51, l3still#5: a site's private session's return review listed a token off the wallet's list in raw units. A
// return's tokens are WebAssembly's, which carry no decimals (sessions.ts `buildBack`), and the review scales a token
// by the wallet's list, then its own decimals, then 0; the session's page said its holding the same way (sessions.ts
// `holdingOf`). The session's account's rows carry Koios's decimals, as Home's do once it's back. Real worker, real
// WebAssembly, over the fake Koios: session 0 holds 1,000,000 raw units of FOO, 6 decimals by Koios.
//
// The fix is sessions.ts's, so this fails until it lands there: the review and the page show what the summary and the
// session's view carry (SiteSessions.tsx `tokenQuantity`, `tokenAmountText`), and Transaction details under the
// review take what the kept return carries (tx-view.ts `decimalsIn`).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { txView } from "../src/background/tx-view";
import { assetFingerprint } from "../src/shared/fingerprint";
import { TxDetailBody } from "../src/ui/components/TxDetail";
import { NetworkContext } from "../src/ui/network";
import { tokenAmountText, tokenQuantity } from "../src/ui/tokens";
import { atSession, withSession } from "./chain-fixtures";

/** A token off the wallet's list (2 preprod, 32 mainnet), whose decimals Koios knows from the token registry: 6. */
const FOO = { policyId: "f0".repeat(28), assetName: Buffer.from("FOO").toString("hex") };
const key = (x: { policyId: string; assetName: string }) => `${x.policyId}.${x.assetName}`;
/** A page's text, as a person reads it. */
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

describe("a site session's return and its page, a token off the wallet's list (chunk 51, l3still#5)", () => {
  it("lists it in the units the session's rows give it, and so does Transaction details under the review", async () => {
    const { t, sessions } = await withSession("40000000");
    const foo = { policy_id: FOO.policyId, asset_name: FOO.assetName, quantity: "1000000", decimals: 6 };
    t.koios.addedToAccounts.push({ ...atSession("c3".repeat(32), 2, "2000000"), asset_list: [{ ...foo, fingerprint: assetFingerprint(FOO) }] });

    // The session's page: what its account holds.
    const [view] = await sessions.list("preprod", true);
    expect(view!.holding!.tokens.map((x) => [key(x), x.quantity, x.decimals])).toEqual([[key(FOO), "1000000", 6]]);
    expect(tokenAmountText("preprod", view!.holding!.tokens[0]!)).toMatch(/^1 /);

    // Bring it back, directly: its review's row, and Transaction details under the review.
    const back = await sessions.backBuild("preprod", 0, true);
    expect(back.tokens.map((x) => [key(x), x.quantity, x.decimals])).toEqual([[key(FOO), "1000000", 6]]);
    expect(tokenQuantity("preprod", back.tokens[0]!)).toBe("1");
    const { detail } = await txView({ wasm: t.deps.wasm, wallet: t.wallet, session: t.session }, "preprod", back.txHash);
    const details = text(
      renderToStaticMarkup(
        createElement(NetworkContext.Provider, { value: "preprod" }, createElement(TxDetailBody, { detail, network: "preprod", testId: "tx" })),
      ),
    );
    expect(details).toMatch(/(?<![\d,.])1 FOO/);
    expect(details).not.toContain("1,000,000 FOO");
  }, 60_000);
});
