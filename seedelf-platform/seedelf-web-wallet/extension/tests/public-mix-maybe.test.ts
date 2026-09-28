// A mix from the public account whose transaction Koios never answered may
// have gone through: it stops saying so, what the transaction spends stays
// held and reserved, and no other mix from the account is built until the
// network settles it, so the account never pays for a mix twice
// (independent review L5).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SESSION_LOVEJOIN_SENDING } from "../src/background/lovejoin";
import { SESSION_RESERVED_PREFIX, SESSION_SPENT, SPENT_KEEP_MS } from "../src/background/spent";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import { NetworkContext } from "../src/ui/network";
import { PreferencesContext } from "../src/ui/preferences";
import { Chains } from "../src/ui/screens/Lovejoin";
import { CHAINS, PASSWORD, publicFunded, type Tested } from "./chain-fixtures";

const DEPOSIT_INPUT = `${"e6".repeat(32)}#0`;

/**
 * Koios never answers a submit while `down`: the first reaches the node all
 * the same (its answer is lost), and every other doesn't.
 */
function unanswered(t: Tested) {
  const fetch = t.koios.fetch;
  const state = { down: true, submits: 0 };
  t.koios.fetch = async (url, init) => {
    if (state.down && url.endsWith("/submittx")) {
      if (state.submits++ === 0) await fetch(url, init);
      throw new TypeError("Failed to fetch");
    }
    return fetch(url, init);
  };
  return state;
}

const reservedPublic = async (t: Tested) =>
  (await t.wallet.withKeys(() => t.session.get<Record<string, { until?: number }>>(SESSION_RESERVED_PREFIX + "preprod")))?.public;
const spent = async (t: Tested) => Object.keys((await t.wallet.withKeys(() => t.session.get<Record<string, number>>(SESSION_SPENT))) ?? {});
const record = async (t: Tested) =>
  (await t.store.get<{ chains: Array<{ sent: number; stopped?: string; maybe?: unknown }> }>("lovejoin.preprod"))!.chains.at(-1)!;

/** A mix of one box sent from the public account, whose deposit's every submit Koios didn't answer. */
async function stoppedMaybe() {
  const t = await publicFunded("60000000", ["60000000"]);
  const mix = await t.lovejoin.publicBuild("preprod", 1);
  const net = unanswered(t);
  await expect(t.lovejoin.publicSubmit("preprod", mix.txHash)).rejects.toThrow("may have gone through");
  net.down = false;
  return { t, mix, net };
}

describe("a mix from the public account whose transaction may have gone through (independent review L5)", CHAINS, () => {
  it("stops saying so, holds what its deposit spends, and builds no other mix until the network shows it", async () => {
    const { t, net } = await stoppedMaybe();
    expect(net.submits).toBe(5);
    // Said as it is: nothing seen yet, and the deposit may have gone through.
    expect(await t.lovejoin.progress("preprod")).toEqual({
      total: 5,
      sent: 0,
      stopped: "Koios didn't answer when its deposit was sent, so it may have gone through. The wallet looks for it on chain before another mix from your public account is built.",
      maybeSent: true,
    });
    expect(await spent(t)).toContain(DEPOSIT_INPUT);
    expect(await reservedPublic(t)).toEqual(expect.objectContaining({ inputs: expect.arrayContaining([DEPOSIT_INPUT]) }));
    expect((await reservedPublic(t))?.until).toBeUndefined();
    await expect(t.lovejoin.publicBuild("preprod", 1)).rejects.toThrow("may have gone through");
    await expect(t.lovejoin.publicAgainBuild("preprod")).rejects.toThrow("may have gone through");
    expect((await t.lovejoin.status("preprod")).chains).toEqual([expect.objectContaining({ sent: 0, maybeSent: true })]);

    // It lands: the mix stopped after its deposit, which went, and another may be built.
    t.koios.confirmations = 1;
    await t.lovejoin.publicBuild("preprod", 1);
    expect(await record(t)).toMatchObject({ sent: 1, stopped: "Koios didn't answer when its deposit was sent. It went through, and the mix stopped there." });
    expect((await record(t)).maybe).toBeUndefined();
    const progress = await t.wallet.withKeys(() => t.session.get<{ next: number; maybe?: number }>(SESSION_LOVEJOIN_SENDING + "preprod"));
    expect(progress).toMatchObject({ next: 1 });
    expect(progress?.maybe).toBeUndefined();
    // The new review holds the account's reservation now, kept for Send.
    expect((await reservedPublic(t))?.until).toBeDefined();
  });

  it("lets another be built once what the transaction spends is spent otherwise: it can't go anymore", async () => {
    const { t } = await stoppedMaybe();
    t.koios.spent.add(DEPOSIT_INPUT);
    await t.lovejoin.publicBuild("preprod", 1);
    expect((await record(t)).stopped).toMatch("what it spends is spent now");
    expect((await t.lovejoin.progress("preprod"))?.maybeSent).toBeUndefined();
  });

  it("keeps it unsettled after a lock, and lets it go once it's been unseen as long as the wallet holds what it spends", async () => {
    const { t } = await stoppedMaybe();
    await t.wallet.lock();
    await t.wallet.unlock(PASSWORD);
    // The lock wiped its progress; its record still says it may have gone through.
    await expect(t.lovejoin.publicBuild("preprod", 1)).rejects.toThrow("may have gone through");
    expect(await t.lovejoin.progress("preprod")).toMatchObject({ sent: 0, maybeSent: true });
    t.clock.now += SPENT_KEEP_MS;
    await t.wallet.unlock(PASSWORD);
    await t.lovejoin.publicBuild("preprod", 1);
    expect((await record(t)).stopped).toBe("Koios didn't answer when its deposit was sent, and it never went through.");
  });

  it("stops as before when Koios only ever asked the wallet to slow down: nothing went", async () => {
    const t = await publicFunded("60000000");
    const mix = await t.lovejoin.publicBuild("preprod", 1);
    const fetch = t.koios.fetch;
    t.koios.fetch = async (url, init) => (url.endsWith("/submittx") ? new Response("", { status: 429 }) : fetch(url, init));
    await expect(t.lovejoin.publicSubmit("preprod", mix.txHash)).rejects.toThrow("Koios is limiting requests");
    const progress = await t.lovejoin.progress("preprod");
    expect(progress).toMatchObject({ total: 5, sent: 0 });
    expect(progress?.maybeSent).toBeUndefined();
    expect(await reservedPublic(t)).toBeUndefined();
    t.koios.fetch = fetch;
    await t.lovejoin.publicBuild("preprod", 1);
  });

  it("is listed as stopped with the next transaction maybe gone through", () => {
    const chains = createElement(Chains, { chains: [{ boxes: 1, total: 5, sent: 0, at: 1, stopped: "Koios didn't answer.", maybeSent: true }] });
    const prefs = { prefs: { ...DEFAULT_PREFERENCES, hideBalances: false }, loaded: true, set: async () => undefined };
    const html = renderToStaticMarkup(
      createElement(NetworkContext.Provider, { value: "preprod" }, createElement(PreferencesContext.Provider, { value: prefs }, chains)),
    );
    expect(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).toContain("Stopped after 0 of 5 transactions, and the next may have gone through");
  });
});
