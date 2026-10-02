// Which transaction of a chain a review shows (the owner, 2026-10-02).
//
// A chain is built and signed before any of it is sent, so a review holds a
// dozen transactions and offers one. The one it offers is the first — the
// deposit, where the money goes in — not the last, which is what Send names
// and what Home's banner watches. The last spends outputs nothing has sent
// yet, so showing it as "the transaction" names inputs that aren't on chain.
import { describe, expect, it } from "vitest";

import { SESSION_LOVEJOIN_PUBLIC } from "../src/background/lovejoin";
import { SESSION_BACK } from "../src/background/sessions";
import { txView } from "../src/background/tx-view";
import { CHAINS, publicFunded, withSession, type Tested } from "./chain-fixtures";

const deps = (t: Tested) => ({ wasm: t.deps.wasm, wallet: t.wallet, session: t.session });

/** The chain kept under `key`, in send order. */
const keptChain = (t: Tested, key: string) =>
  t.wallet.withKeys(async () => (await t.session.get<{ chain: Array<{ kind: string; txHash: string }> }>(key))!.chain);

describe("the transaction a chain's review shows", CHAINS, () => {
  it("is the deposit of a mix from the public account, not the last mix Send names", async () => {
    const t = await publicFunded();
    const summary = await t.lovejoin.publicBuild("preprod", 1);
    const chain = await keptChain(t, SESSION_LOVEJOIN_PUBLIC);

    expect(summary.txs).toBe(chain.length);
    expect(summary.txs).toBeGreaterThan(1);
    expect(chain[0]!.kind).toBe("deposit");
    expect(summary.entry).toBe(chain[0]!.txHash);
    expect(summary.txHash).toBe(chain.at(-1)!.txHash);
    expect(summary.entry).not.toBe(summary.txHash);

    // And the view can open it: its bytes are in the kept record like any other.
    const view = await txView(deps(t), "preprod", summary.entry);
    expect(view.detail.txHash).toBe(summary.entry);
    expect(view.detail.redeemers.length).toBe(0);
  });

  it("is the deposit of a session's return through Lovejoin, not the return it ends with", async () => {
    const { t, sessions } = await withSession("60000000");
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin).toBeDefined();
    const chain = await keptChain(t, SESSION_BACK);

    expect(review.lovejoin!.txs).toBe(chain.length);
    expect(chain[0]!.kind).toBe("deposit");
    expect(chain.at(-1)!.kind).toBe("back");
    expect(review.lovejoin!.entry).toBe(chain[0]!.txHash);
    expect(review.txHash).toBe(chain.at(-1)!.txHash);

    const view = await txView(deps(t), "preprod", review.lovejoin!.entry);
    expect(view.detail.txHash).toBe(review.lovejoin!.entry);
  });
});
