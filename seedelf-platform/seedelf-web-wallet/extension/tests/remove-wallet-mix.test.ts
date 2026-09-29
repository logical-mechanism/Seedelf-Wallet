// Remove wallet lists a mix from the public account that stopped at a
// transaction that may have gone through, and takes a second yes for it.
// Its record is kept, sealed, through the reset, as a payment that may
// still go through is: the same phrase restored here builds no other mix
// from the account until the network settles it, so the account never pays
// for a mix twice; another phrase's wallet deletes it (final review F1).
import { beforeAll, describe, expect, it, vi } from "vitest";

import { handle, RESET_AT_STAKE, type Context } from "../src/background/handlers";
import { NetworkChoice } from "../src/background/preferences";
import type { NetworkName } from "../src/networks";
import type { AtStake, Message } from "../src/shared/rpc";
import { account, CHAINS, PASSWORD, publicFunded, type Tested } from "./chain-fixtures";
import { loadTestWasm } from "./fakes";

const KEPT = "seedelf.private.lovejoinMaybe.preprod";
const MINE = account(12).phrase;
const OTHER = account(24).phrase;

function context(t: Tested): Context {
  const networks: NetworkName[] = ["preprod", "mainnet"];
  return {
    ...(t as unknown as Context),
    wasm: loadTestWasm(),
    connector: async (on) => on,
    version: "1.0.0",
    network: "preprod",
    networks,
    networkChoice: new NetworkChoice(t.local, networks),
  };
}

const ask = (message: Message, ctx: Context) => handle(message, ctx);

// The screens read the page's URL when they load (ui/view.ts).
beforeAll(() => {
  vi.stubGlobal("location", { search: "" });
});

/** A mix of one box from the public account whose deposit Koios never answered, though it reached the node. */
async function stoppedMaybe() {
  const t = await publicFunded("60000000", ["60000000"]);
  const mix = await t.lovejoin.publicBuild("preprod", 1);
  const fetch = t.koios.fetch;
  let submits = 0;
  let down = true;
  t.koios.fetch = async (url, init) => {
    if (down && url.endsWith("/submittx")) {
      if (submits++ === 0) await fetch(url, init);
      throw new TypeError("Failed to fetch");
    }
    return fetch(url, init);
  };
  await expect(t.lovejoin.publicSubmit("preprod", mix.txHash)).rejects.toThrow("may have gone through");
  down = false;
  return { t, ctx: context(t) };
}

describe("a mix from the public account that may have gone through, and Remove wallet (final review F1)", CHAINS, () => {
  it("is listed, and the wallet is removed only at a second yes, its record kept sealed", async () => {
    const { t, ctx } = await stoppedMaybe();
    const stake = (await ask({ type: "reset-check" }, ctx)) as AtStake[];
    expect(stake).toEqual([{ network: "preprod", sessions: [], chainSending: false, mixMaybeSent: true }]);
    await expect(ask({ type: "reset-wallet" }, ctx)).rejects.toThrow(RESET_AT_STAKE);
    expect(await ask({ type: "reset-wallet", force: true }, ctx)).toMatchObject({ state: "no-wallet" });
    expect(t.local.data.has(KEPT)).toBe(true);
    expect(t.local.data.has("seedelf.private.lovejoin.preprod")).toBe(false);
  });

  it("builds no other mix from the account after the same phrase is restored, until the network settles it", async () => {
    const { t, ctx } = await stoppedMaybe();
    await ask({ type: "reset-wallet", force: true }, ctx);
    await ask({ type: "restore-wallet", phrase: MINE, password: PASSWORD }, ctx);
    await expect(t.lovejoin.publicBuild("preprod", 1)).rejects.toThrow("may have gone through");
    await expect(t.lovejoin.publicAgainBuild("preprod")).rejects.toThrow("may have gone through");
    // Removing it again lists it again.
    expect(await ask({ type: "reset-check" }, ctx)).toEqual([{ network: "preprod", sessions: [], chainSending: false, mixMaybeSent: true }]);
    // The deposit lands: settled, the kept record goes, and a mix may be built.
    t.koios.confirmations = 1;
    await t.lovejoin.publicBuild("preprod", 1).catch((e: unknown) => expect(String(e)).not.toMatch("may have gone through"));
    expect(t.local.data.has(KEPT)).toBe(false);
    expect(await ask({ type: "reset-check" }, ctx)).toEqual([]);
  });

  it("is deleted when a wallet of another phrase is made, which can't open it", async () => {
    const { t, ctx } = await stoppedMaybe();
    await ask({ type: "reset-wallet", force: true }, ctx);
    await ask({ type: "restore-wallet", phrase: OTHER, password: PASSWORD }, ctx);
    expect(t.local.data.has(KEPT)).toBe(false);
    expect(await ask({ type: "reset-check" }, ctx)).toEqual([]);
  });
});

describe("Remove wallet's line for it", () => {
  it("says what stays, what brings it back, and what could happen meanwhile", async () => {
    const { atStakeLines } = await import("../src/ui/screens/Settings");
    expect(atStakeLines([{ network: "mainnet", sessions: [], chainSending: false, mixMaybeSent: true }])).toEqual([
      "Mainnet: a mix from your public account stopped at a transaction that may have gone through. An encrypted record of it stays in this browser: restoring this same recovery phrase here looks for it again before another mix from the account is built, but making or restoring another wallet here first deletes that record. While nothing looks for it, the account could pay for a mix twice.",
    ]);
  });
});
