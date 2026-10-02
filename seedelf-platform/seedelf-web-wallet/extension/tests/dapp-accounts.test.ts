// A connected site stays bound to the public account it connected to (chunk
// 18). Following the active account would hand a site that had already seen
// Account 1's addresses Account 2's as well, and teach it the two are one
// wallet's — the exact leak several accounts exist to prevent. The connect
// window chooses nothing by design (chunk 15), and this keeps that true
// across a switch.
import { describe, expect, it } from "vitest";

import { type DappError, type DappSession } from "../src/background/dapp";
import { APIError } from "../src/shared/dapp";
import { testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
/** The one vector phrase with both accounts recorded. */
const phrase = (account: 0 | 1) =>
  vectors("cardano_account.json").find((v) => v.account === account && v.phrase.split(" ").length === 24)!;

let pages = 0;
const site = (origin = "https://app.example.com"): DappSession => ({ id: `acct${++pages}`, origin, title: "Example" });
const heard = (p: Promise<unknown>) => p.then(() => undefined, (e: DappError) => e.failure);
async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}

async function on() {
  const t = testBalances();
  await t.wallet.create(phrase(0).phrase, PASSWORD);
  await t.accounts.recordFirst();
  await t.preferences.set({ dappConnector: true, dappPassword: false, spendRewards: false });
  // Account 1 of this phrase has been used, so the wallet can move to it.
  t.koios.usedStakes.add(phrase(1).preprod.stake as string);
  await t.accounts.discover("preprod");
  return t;
}

async function connect(t: Awaited<ReturnType<typeof on>>, s = site()) {
  const enabling = t.dapp.call(s, "enable", []);
  await until(() => t.dapp.approvals().length === 1);
  await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
  expect(await enabling).toBe(true);
  return s;
}

describe("a site connected to a public account", () => {
  it("records which account, and is served that account's addresses", async () => {
    const t = await on();
    const s = await connect(t);
    expect(await t.dapp.sites()).toEqual([{ origin: s.origin, connectedAt: t.clock.now, account: 0 }]);
    const [first] = (await t.dapp.call(s, "getUsedAddresses", [])) as string[];
    expect(first).toBe(t.deps.wasm.cip30Address(phrase(0).preprod.receive_0 as string));
  });

  it("is refused, not served from the active account, once the wallet moves off it", async () => {
    const t = await on();
    const s = await connect(t);
    await t.accounts.use(1, ["preprod"]);

    const refusal = {
      code: APIError.Refused,
      info:
        "This site is connected to Account 1 of your wallet, and Seedelf Wallet is working on another account now. " +
        "Switch back to Account 1, or disconnect the site and connect it again.",
    };
    // Not one of these answers with account 1's anything.
    expect(await heard(t.dapp.call(s, "getUsedAddresses", []))).toEqual(refusal);
    expect(await heard(t.dapp.call(s, "getChangeAddress", []))).toEqual(refusal);
    expect(await heard(t.dapp.call(s, "getBalance", []))).toEqual(refusal);
    expect(await heard(t.dapp.call(s, "getRewardAddresses", []))).toEqual(refusal);
    // And nothing was put in front of the user to approve.
    expect(t.dapp.approvals()).toEqual([]);

    // Back on the account it connected to, it works again: the connection was never dropped.
    await t.accounts.use(0, ["preprod"]);
    expect(await t.dapp.sites()).toHaveLength(1);
    const [first] = (await t.dapp.call(s, "getUsedAddresses", [])) as string[];
    expect(first).toBe(t.deps.wasm.cip30Address(phrase(0).preprod.receive_0 as string));
  });

  it("connects to the account the wallet is on when it asks", async () => {
    const t = await on();
    await t.accounts.use(1, ["preprod"]);
    const s = await connect(t);
    expect(await t.dapp.sites()).toEqual([{ origin: s.origin, connectedAt: t.clock.now, account: 1 }]);
    const [first] = (await t.dapp.call(s, "getUsedAddresses", [])) as string[];
    expect(first).toBe(t.deps.wasm.cip30Address(phrase(1).preprod.receive_0 as string));
  });

  it("reads a site connected before chunk 18 as account 0's", async () => {
    const t = await on();
    const s = site();
    // The shape sealed before this chunk: no account recorded.
    await t.store.set("dapps", [{ origin: s.origin, network: "preprod", connectedAt: t.clock.now }]);
    const [first] = (await t.dapp.call(s, "getUsedAddresses", [])) as string[];
    expect(first).toBe(t.deps.wasm.cip30Address(phrase(0).preprod.receive_0 as string));

    await t.accounts.use(1, ["preprod"]);
    expect(await heard(t.dapp.call(s, "getUsedAddresses", []))).toMatchObject({
      info: expect.stringContaining("connected to Account 1"),
    });
  });
});
