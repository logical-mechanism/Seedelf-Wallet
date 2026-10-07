// Changing the dApp account (Settings → Sites) shows sites the new account,
// and nothing of the one it left (the release review). The connector's
// reading of the account was kept 30 s, and the outputs of transactions it
// signed offered for 10 minutes, under keys with no account in them: a site
// connected just after the change, which Settings' note doesn't cover, got
// the old account's stake address, UTxOs and balance beside the new one's
// change address, and so learned both are one wallet's. The reading is kept
// per account now, and the signed outputs are offered to the account that
// signed them; a site resending a transaction sent before the change still
// hears its id (independent review M3, final review F12).
import { describe, expect, it } from "vitest";

import { type DappSession } from "../src/background/dapp";
import { SESSION_SEND } from "../src/background/send";
import { testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
/** The one vector phrase with both accounts recorded: account 0 holds UTxOs, account 1 none. */
const phrase = (account: 0 | 1) =>
  vectors("cardano_account.json").find((v) => v.account === account && v.phrase.split(" ").length === 24)!;
const THEIRS = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 15)!.preprod
  .receive_0 as string;
const BAD_INPUTS = '{"contents":{"contents":{"contents":{"era":"ShelleyBasedEraConway","error":["BadInputsUTxO"]}}}}';

let pages = 0;
const site = (origin = "https://app.example.com"): DappSession => ({ id: `change${++pages}`, origin, title: "Example" });
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
type T = Awaited<ReturnType<typeof on>>;

async function connect(t: T, s = site()) {
  const enabling = t.dapp.call(s, "enable", []);
  await until(() => t.dapp.approvals().length === 1);
  await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
  expect(await enabling).toBe(true);
  return s;
}

/** What a site reads of the public side. */
async function reads(t: T, s: DappSession) {
  return {
    reward: await t.dapp.call(s, "getRewardAddresses", []),
    used: await t.dapp.call(s, "getUsedAddresses", []),
    change: await t.dapp.call(s, "getChangeAddress", []),
    utxos: await t.dapp.call(s, "getUtxos", []),
    balance: t.deps.wasm.cip30ReadValue((await t.dapp.call(s, "getBalance", [])) as string),
    collateral: await t.dapp.call(s, "getCollateral", []),
  };
}

/** Account 1 as a site reads it: its own addresses, and nothing in it. */
function account1(t: T) {
  const { wasm } = t.deps;
  const receive = wasm.cip30Address(phrase(1).preprod.receive_0 as string);
  return {
    reward: [wasm.cip30Address(phrase(1).preprod.stake as string)],
    used: [receive],
    change: receive,
    utxos: [],
    balance: JSON.stringify({ lovelace: "0", tokens: [] }),
    collateral: null,
  };
}

describe("a change of the dApp account", () => {
  it("shows a site connected right after it nothing of the account it left, a reading under way included", async () => {
    const t = await on();
    const a = await connect(t);
    const old = await reads(t, a);
    expect(old.utxos).not.toEqual([]);

    // A reading of account 0 is under way, asking Koios, as the user changes the account.
    t.clock.now += 31_000;
    let release!: () => void;
    t.koios.hold = new Promise<void>((r) => (release = r));
    const asked = t.koios.calls.length;
    const reading = t.dapp.call(a, "getUtxos", []);
    await until(() => t.koios.calls.length > asked);
    await t.preferences.set({ dappAccount: 1 });
    release();
    t.koios.hold = undefined;
    expect(await reading).toEqual(old.utxos);

    // A new site, within the 30 s: account 1 alone, its reading not the one that just landed.
    const b = await connect(t, site("https://new.example"));
    expect(JSON.parse(JSON.stringify(await reads(t, b)))).toMatchObject({ ...account1(t), balance: expect.any(String) });
    expect(JSON.parse(t.deps.wasm.cip30ReadValue((await t.dapp.call(b, "getBalance", [])) as string))).toMatchObject({ lovelace: "0" });
    // So does the site connected before, as Settings says.
    expect((await reads(t, a)).reward).toEqual(account1(t).reward);
  });

  it("offers a site the outputs of a transaction signed before it to the account that signed it alone", async () => {
    const t = await on();
    const a = await connect(t);
    // Site A has account 0 sign a payment with change, and sends it.
    await t.send.build("preprod", [{ to: THEIRS, lovelace: "3000000", tokens: [] }]);
    const tx = (await t.session.get<{ txCbor: string }>(SESSION_SEND))!.txCbor;
    const signing = t.dapp.call(a, "signTx", [tx, false]);
    await until(() => t.dapp.approvals().length === 1);
    expect(await t.dapp.answer(t.dapp.approvals()[0]!.id, true)).toEqual({});
    await signing;
    const id = (await t.dapp.call(a, "submitTx", [tx])) as string;
    const offered = (await t.dapp.call(a, "getUtxos", [])) as string[];
    expect(offered.some((u) => u.includes(id))).toBe(true);

    // The user changes the account, a minute on: past the reading's 30 s, inside the outputs' 10 minutes.
    await t.preferences.set({ dappAccount: 1 });
    t.clock.now += 60_000;
    const b = await connect(t, site("https://new.example"));
    expect(await t.dapp.call(b, "getUtxos", [])).toEqual([]);
    expect(JSON.parse(t.deps.wasm.cip30ReadValue((await t.dapp.call(b, "getBalance", [])) as string))).toMatchObject({ lovelace: "0" });

    // Site A sending it again hears its id, as before the change, whatever Koios says of it now.
    t.koios.rejectSubmit = BAD_INPUTS;
    expect(await t.dapp.call(a, "submitTx", [tx])).toBe(id);

    // Back on account 0, its change is offered again: it's that account's.
    await t.preferences.set({ dappAccount: 0 });
    expect(((await t.dapp.call(a, "getUtxos", [])) as string[]).some((u) => u.includes(id))).toBe(true);
  });
});
