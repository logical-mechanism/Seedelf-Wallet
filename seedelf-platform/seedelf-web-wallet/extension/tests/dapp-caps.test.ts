// What a connected site sends is bounded before WebAssembly reads it, and a
// trap under a site's call is a trap (independent review M15): an amount for
// getUtxos or getCollateral, or an address for signData, far past anything
// Cardano has, is refused unread; one amount names at most 1,000 tokens; and
// WebAssembly that traps under a site's call outside the wallet's queue locks
// the wallet, as it does under the wallet's own pages.
import { describe, expect, it } from "vitest";

import { answerSite, DappService, SITE_TRAPPED, type DappSession } from "../src/background/dapp";
import { APIError } from "../src/shared/dapp";
import { koiosPreprod, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
const OWN = account.preprod.receive_0 as string;

let pages = 0;
const site = (origin = "https://app.example.com"): DappSession => ({ id: `caps${++pages}`, origin, title: "Example" });

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}

async function connected(dapp: DappService, s = site()) {
  const enabling = dapp.call(s, "enable", []);
  await until(() => dapp.approvals().length === 1);
  await dapp.answer(dapp.approvals()[0]!.id, true);
  expect(await enabling).toBe(true);
  return s;
}

async function on() {
  const t = testBalances();
  await t.wallet.create(account.phrase, PASSWORD);
  await t.preferences.set({ dappConnector: true, spendRewards: false });
  return t;
}

/** Gives the account a pure 5 ₳ UTxO at `0/0`, which the wallet takes as its collateral. */
function withCollateral(t: Awaited<ReturnType<typeof on>>) {
  const template = Object.values(koiosPreprod.accounts)
    .flatMap((a) => a.account_utxos)
    .find((u) => u.address === OWN)!;
  t.koios.addedToAccounts.push({ ...template, tx_hash: "c0".repeat(32), tx_index: 0, value: "5000000", asset_list: [], block_height: 1 });
}

/** An amount of `n` tokens with quantity 1 under one policy, CIP-30's CBOR in hex. */
const tokens = (n: number) =>
  `821a004c4b40bf581c${"ab".repeat(28)}bf${Array.from({ length: n }, (_, i) => `42${i.toString(16).padStart(4, "0")}01`).join("")}ffff`;

describe("a site's amount and address", () => {
  it("is refused unread past 8 KiB of amount, for getUtxos and getCollateral both", async () => {
    const t = await on();
    withCollateral(t);
    let reads = 0;
    const wasm = t.deps.wasm;
    const dapp = new DappService({
      ...t.deps,
      wasm: {
        ...wasm,
        cip30ReadValue: (value: string) => {
          reads++;
          return wasm.cip30ReadValue(value);
        },
      } as typeof wasm,
      store: t.store,
      sessions: t.sessions,
      network: () => "preprod",
      window: t.dappWindow,
      changed: () => undefined,
    });
    const s = await connected(dapp);
    // The review's shape: millions of `40 01` entries, here just past the cap.
    const flood = `8200bf40bf${"4001".repeat(4_100)}ffff`;
    expect(flood.length).toBeGreaterThan(16_384);
    const tooLong = { failure: { code: APIError.InvalidRequest, info: expect.stringContaining("far longer than any Cardano value") } };
    await expect(dapp.call(s, "getUtxos", [flood])).rejects.toMatchObject(tooLong);
    await expect(dapp.call(s, "getCollateral", [{ amount: flood }])).rejects.toMatchObject(tooLong);
    expect(reads).toBe(0);

    // Under the cap, an amount naming more than 1,000 tokens is refused as it's read.
    const many = tokens(1_001);
    expect(many.length).toBeLessThanOrEqual(16_384);
    await expect(dapp.call(s, "getUtxos", [many])).rejects.toMatchObject({
      failure: { code: APIError.InvalidRequest, info: expect.stringContaining("more than 1000 tokens") },
    });
    // An ordinary amount is still read.
    expect(await dapp.call(s, "getUtxos", ["1a000f4240"])).not.toBeNull();
    expect(reads).toBe(2);
  });

  it("refuses to sign data for an address longer than any Cardano address, unread and unasked", async () => {
    const t = await on();
    const s = await connected(t.dapp);
    const calls = t.koios.calls.length;
    await expect(t.dapp.call(s, "signData", ["01".repeat(300), "00"])).rejects.toMatchObject({
      failure: { code: APIError.InvalidRequest, info: expect.stringContaining("far longer than any Cardano address") },
    });
    expect(t.koios.calls.length).toBe(calls);
    expect(t.dapp.approvals()).toEqual([]);
    // A real one is still asked about.
    const signing = t.dapp.call(s, "signData", [t.deps.wasm.cip30Address(OWN), "00"]);
    await until(() => t.dapp.approvals().length === 1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, false);
    await expect(signing).rejects.toMatchObject({ failure: { info: "The user declined." } });
  });
});

describe("a trap under a site's call", () => {
  it("locks the wallet, and the site hears only that its request wasn't answered", async () => {
    const t = await on();
    const wasm = t.deps.wasm;
    const dapp = new DappService({
      ...t.deps,
      wasm: {
        ...wasm,
        // The review's out-of-memory trap, for one amount.
        cip30ReadValue: (value: string) => {
          if (value === "1a000f4240") throw new WebAssembly.RuntimeError("unreachable");
          return wasm.cip30ReadValue(value);
        },
      } as typeof wasm,
      store: t.store,
      sessions: t.sessions,
      network: () => "preprod",
      window: t.dappWindow,
      changed: () => undefined,
    });
    const s = await connected(dapp);
    // Never turned into a refusal the wallet would carry on after.
    const heard = await answerSite(dapp, t.wallet, s, "getUtxos", ["1a000f4240"]).catch((e: { failure: unknown }) => e.failure);
    expect(heard).toEqual({ code: APIError.InternalError, info: SITE_TRAPPED });
    expect(await t.wallet.state()).toBe("locked");

    // What isn't a trap is answered as ever, and nothing locks.
    await t.wallet.unlock(PASSWORD);
    const bad = await answerSite(dapp, t.wallet, s, "getUtxos", ["zz"]).catch((e: { failure: unknown }) => e.failure);
    expect(bad).toMatchObject({ code: APIError.InvalidRequest });
    expect(await t.wallet.state()).toBe("unlocked");
  });
});
