// A mix from the public account whose transaction a try may have put in:
// whatever a later try is answered says nothing of that one (Koios's node
// down, a gateway's page), and an answer the wallet can't take as Koios's
// (another id, a body it can't read) may be one from a node that took it. So
// the mix stops as may have gone through, what it spends stays held, and no
// other mix from the account is built until the network settles it, never
// "press Send again" (independent review L5).
import { describe, expect, it } from "vitest";

import { SESSION_SPENT } from "../src/background/spent";
import { CHAINS, publicFunded, type Tested } from "./chain-fixtures";

const DEPOSIT_INPUT = `${"e6".repeat(32)}#0`;

const spent = async (t: Tested) => Object.keys((await t.wallet.withKeys(() => t.session.get<Record<string, number>>(SESSION_SPENT))) ?? {});
type Chain = { sent: number; stopped?: string; maybe?: { index: number; unanswered?: true } };
const record = async (t: Tested) => (await t.store.get<{ chains: Chain[] }>("lovejoin.preprod"))!.chains.at(-1)!;

/**
 * Koios's submits: the first reaches the node, and `first` is what the wallet
 * gets back; every later one is answered `later`, and never reaches it.
 */
function answers(t: Tested, first: (sent: Response) => Response | never, later: () => Response) {
  const fetch = t.koios.fetch;
  const seen = { submits: 0 };
  t.koios.fetch = async (url, init) => {
    if (!url.endsWith("/submittx")) return fetch(url, init);
    if (seen.submits++ === 0) return first(await fetch(url, init));
    return later();
  };
  return seen;
}

const lost = (): never => {
  throw new TypeError("Failed to fetch");
};
const nodeDown = () => new Response('{"contents":"","tag":"TxSubmitConnectionError"}', { status: 400 });
const gatewayPage = () => new Response("<html><body>400 Bad Request</body></html>", { status: 400 });

describe("a mix from the public account whose deposit a try may have put in (independent review L5)", CHAINS, () => {
  it.each([
    ["a try Koios didn't answer, then Koios's node down", lost, nodeDown],
    ["a try Koios didn't answer, then a gateway's page", lost, gatewayPage],
    ["an answer with another transaction id", () => Response.json("ab".repeat(32), { status: 202 }), nodeDown],
    ["an answer the wallet can't read", () => new Response("<html>Accepted</html>", { status: 202 }), nodeDown],
  ])("stops as may have gone through after %s, and builds no other mix until it's settled", async (_, first, later) => {
    const t = await publicFunded("60000000", ["60000000"]);
    const mix = await t.lovejoin.publicBuild("preprod", 1);
    const net = answers(t, first, later);
    const error = await t.lovejoin.publicSubmit("preprod", mix.txHash).then(
      () => undefined,
      (e: unknown) => String(e),
    );
    expect(error).toMatch("may have gone through");
    expect(error).not.toMatch("Press Send again");
    expect(net.submits).toBeGreaterThan(0);

    // Its record and progress say so, and what the deposit spends counts as spent.
    expect((await record(t)).maybe).toMatchObject({ index: 0, unanswered: true });
    expect(await t.lovejoin.progress("preprod")).toMatchObject({ total: 5, sent: 0, maybeSent: true });
    expect(await spent(t)).toContain(DEPOSIT_INPUT);
    // No mix from the account is built while it's unseen: not from its other UTxO either.
    await expect(t.lovejoin.publicBuild("preprod", 1)).rejects.toThrow("may have gone through");

    // It lands: the mix stopped after its deposit, which went, and another may be built.
    t.koios.spent.add(DEPOSIT_INPUT);
    t.koios.confirmations = 1;
    await t.lovejoin.publicBuild("preprod", 1);
    expect(await record(t)).toMatchObject({ sent: 1 });
    expect((await record(t)).maybe).toBeUndefined();
  });

  it("stops as before when every try is answered that nothing went: another may be built at once", async () => {
    const t = await publicFunded("60000000", ["60000000"]);
    const mix = await t.lovejoin.publicBuild("preprod", 1);
    const fetch = t.koios.fetch;
    t.koios.fetch = async (url, init) => (url.endsWith("/submittx") ? nodeDown() : fetch(url, init));
    await expect(t.lovejoin.publicSubmit("preprod", mix.txHash)).rejects.toThrow("Press Send again");
    expect((await record(t)).maybe).toBeUndefined();
    expect((await t.lovejoin.progress("preprod"))?.maybeSent).toBeUndefined();
    expect(await spent(t)).not.toContain(DEPOSIT_INPUT);
    t.koios.fetch = fetch;
    await t.lovejoin.publicBuild("preprod", 1);
  });
});
