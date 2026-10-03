// One public account is the dApp account, chosen in Settings, and connected
// sites always use it (Eternl's model; the owner, 2026-10-02).
//
// It does not follow the account picker. That is the whole point: switching
// accounts can never hand a site a second account's addresses, and a site is
// never refused for being on the "wrong" one. Changing which account it is,
// is a deliberate act — and one the wallet says shows every connected site
// the new account.
import { describe, expect, it } from "vitest";

import { type DappSession } from "../src/background/dapp";
import { testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
/** The one vector phrase with both accounts recorded. */
const phrase = (account: 0 | 1) =>
  vectors("cardano_account.json").find((v) => v.account === account && v.phrase.split(" ").length === 24)!;

let pages = 0;
const site = (origin = "https://app.example.com"): DappSession => ({ id: `acct${++pages}`, origin, title: "Example" });
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

describe("the account connected sites use", () => {
  it("is the dApp account, not the one the wallet is working on", async () => {
    const t = await on();
    // The wallet moves to Account 2; the dApp account stays Account 1.
    await t.accounts.use(1, ["preprod"]);
    expect((await t.preferences.get()).dappAccount).toBe(0);

    const s = await connect(t);
    expect(await t.dapp.sites()).toEqual([{ origin: s.origin, connectedAt: t.clock.now }]);
    const [first] = (await t.dapp.call(s, "getUsedAddresses", [])) as string[];
    expect(first).toBe(t.deps.wasm.cip30Address(phrase(0).preprod.receive_0 as string));
  });

  it("doesn't change under a site when the wallet switches accounts", async () => {
    const t = await on();
    const s = await connect(t);
    const before = (await t.dapp.call(s, "getUsedAddresses", [])) as string[];

    // Switching accounts is not something a site sees at all: no refusal, and
    // nothing new shown. A site that had seen Account 1 keeps seeing it.
    await t.accounts.use(1, ["preprod"]);
    expect(await t.dapp.call(s, "getUsedAddresses", [])).toEqual(before);
    expect(await t.dapp.call(s, "getChangeAddress", [])).toBe(t.deps.wasm.cip30Address(phrase(0).preprod.receive_0 as string));
    expect(t.dapp.approvals()).toEqual([]);
  });

  it("follows the setting when the user changes it on purpose", async () => {
    const t = await on();
    const s = await connect(t);
    await t.preferences.set({ dappAccount: 1 });
    const [first] = (await t.dapp.call(s, "getUsedAddresses", [])) as string[];
    expect(first).toBe(t.deps.wasm.cip30Address(phrase(1).preprod.receive_0 as string));

    // And only an account index the wallet will use is taken.
    await t.preferences.set({ dappAccount: -1 as unknown as number });
    expect((await t.preferences.get()).dappAccount).toBe(1);
  });

  it("serves a site connected before there was a dApp account", async () => {
    const t = await on();
    const s = site();
    // The shape sealed before chunk 18: no account on the site, because there
    // was one account. It is the dApp account's now, which defaults to 0 —
    // the account it was already talking to.
    await t.store.set("dapps", [{ origin: s.origin, network: "preprod", connectedAt: t.clock.now }]);
    const [first] = (await t.dapp.call(s, "getUsedAddresses", [])) as string[];
    expect(first).toBe(t.deps.wasm.cip30Address(phrase(0).preprod.receive_0 as string));
  });
});
