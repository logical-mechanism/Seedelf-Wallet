// What a site asked for doesn't outlive what the user did meanwhile
// (independent review L33): Disconnect declines that site's waiting
// requests; turning the connector off (Settings, or Chrome's access taken
// away) and removing the wallet decline every one. And an approval checks
// again what it was read against: the site still connected to the same
// account, what a Lovejoin chain being sent needs, and what the user locked.
import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { type DappError, type DappSession } from "../src/background/dapp";
import { handle, type Context } from "../src/background/handlers";
import { NetworkChoice } from "../src/background/preferences";
import { SESSION_SEND } from "../src/background/send";
import { SESSION_RESERVED_PREFIX } from "../src/background/spent";
import { APIError, DataSignError, TxSignError } from "../src/shared/dapp";
import { loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
const OWN = account(12).preprod.receive_0 as string;
const THEIRS = account(15).preprod.receive_0 as string;
const DISCONNECTED = "This site was disconnected from Seedelf Wallet, so the request was declined.";
const OFF = "Connecting sites is off in Seedelf Wallet's settings.";

let pages = 0;
const site = (origin = "https://app.example.com"): DappSession => ({ id: `declined${++pages}`, origin, title: "Example" });
const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");
const heard = (p: Promise<unknown>) => p.then(() => undefined, (e: DappError) => e.failure);

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}

async function on() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  await t.preferences.set({ dappConnector: true, spendRewards: false });
  return t;
}
type T = Awaited<ReturnType<typeof on>>;

async function connected(t: T, s = site()) {
  const enabling = t.dapp.call(s, "enable", []);
  await until(() => t.dapp.approvals().length === 1);
  await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
  expect(await enabling).toBe(true);
  return s;
}

/** A message for the account's key to sign, waiting for the user. */
function waitingMessage(t: T, s: DappSession) {
  return heard(t.dapp.call(s, "signData", [t.deps.wasm.cip30Address(OWN), hex("Sign in")]));
}

/** A payment from the account, built by the wallet's own Send: a site's transaction as far as the connector knows. */
async function payment(t: T) {
  const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "3000000", tokens: [] }]);
  return { summary, tx: (await t.session.get<{ txCbor: string }>(SESSION_SEND))!.txCbor };
}

function context(t: T): Context {
  const { wallet, session, balances, moveIn, mint, transfer, withdraw, send, pending, contacts, activity, coins, staking, preferences, prices, nftImages, dapp, sessions, lovejoin, accounts } =
    t;
  return {
    wasm: loadTestWasm(),
    wallet,
    session,
    balances,
    moveIn,
    mint,
    transfer,
    withdraw,
    send,
    pending,
    contacts,
    activity,
    coins,
    staking,
    preferences,
    prices,
    nftImages,
    dapp,
    sessions,
    lovejoin,
    accounts,
    connector: async (on) => on,
    version: "1.0.0",
    network: "preprod",
    networks: ["preprod"],
    networkChoice: new NetworkChoice(t.local, ["preprod"]),
  };
}

describe("a site's waiting request", () => {
  it("is declined when the site is disconnected; another site's waits on", async () => {
    const t = await on();
    const a = await connected(t);
    const b = await connected(t, site("https://other.example"));
    const theirs = waitingMessage(t, a);
    const others = waitingMessage(t, b);
    await until(() => t.dapp.approvals().length === 2);
    await t.dapp.forget(a.origin);
    expect(await theirs).toEqual({ code: DataSignError.UserDeclined, info: DISCONNECTED });
    expect(t.dapp.approvals().map((x) => x.origin)).toEqual([b.origin]);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, false);
    expect(await others).toMatchObject({ info: "The user declined." });
  });

  it("is declined, every site's, when the connector is turned off in Settings, the unlock window's too", async () => {
    const t = await on();
    const s = await connected(t);
    const ctx = context(t);
    const signing = waitingMessage(t, s);
    const connecting = heard(t.dapp.call(site("https://new.example"), "enable", []));
    await until(() => t.dapp.approvals().length === 2);
    await handle({ type: "preferences-set", dappConnector: false }, ctx);
    expect(await signing).toEqual({ code: DataSignError.UserDeclined, info: OFF });
    expect(await connecting).toEqual({ code: APIError.Refused, info: OFF });
    expect(t.dapp.approvals()).toEqual([]);

    await t.preferences.set({ dappConnector: true });
    await t.wallet.lock();
    const unlocking = heard(t.dapp.call(s, "signData", [t.deps.wasm.cip30Address(OWN), hex("x")]));
    await until(() => t.dapp.unlockingSites().length === 1);
    t.dapp.connectorOff();
    expect(await unlocking).toEqual({ code: APIError.Refused, info: OFF });
    expect(t.dapp.unlockingSites()).toEqual([]);
  });

  it("can't be approved once the connector is off, even if nothing declined it", async () => {
    const t = await on();
    const s = await connected(t);
    const signing = waitingMessage(t, s);
    await until(() => t.dapp.approvals().length === 1);
    // Off, as Chrome taking the access away writes it, before the worker hears.
    await t.preferences.set({ dappConnector: false });
    expect(await t.dapp.answer(t.dapp.approvals()[0]!.id, true, PASSWORD)).toEqual({ error: OFF });
    expect(await signing).toMatchObject({ info: OFF });
    expect(t.dapp.approvals()).toEqual([]);
  });

  it("is declined when the wallet is removed", async () => {
    const t = await on();
    const s = await connected(t);
    const signing = waitingMessage(t, s);
    await until(() => t.dapp.approvals().length === 1);
    await t.wallet.reset();
    await t.dapp.stateChanged();
    expect(await signing).toMatchObject({ code: DataSignError.UserDeclined, info: OFF });
    expect(t.dapp.approvals()).toEqual([]);
  });
});

describe("approving a site's request", () => {
  it("signs nothing for a site no longer connected to the account it was read for", async () => {
    const t = await on();
    const s = await connected(t);
    const { tx } = await payment(t);
    const signing = heard(t.dapp.call(s, "signTx", [tx, false]));
    const message = waitingMessage(t, s);
    await until(() => t.dapp.approvals().length === 2);
    // Its record changed under it, as a race with Disconnect could leave it.
    await t.store.set("dapps", []);
    for (const a of t.dapp.approvals()) expect(await t.dapp.answer(a.id, true, PASSWORD)).toEqual({ error: DISCONNECTED });
    expect(await signing).toEqual({ code: APIError.Refused, info: DISCONNECTED });
    expect(await message).toEqual({ code: APIError.Refused, info: DISCONNECTED });
  });

  it("signs nothing once the connector is turned off while the password is checked", async () => {
    const t = await on();
    const s = await connected(t);
    const signing = waitingMessage(t, s);
    await until(() => t.dapp.approvals().length === 1);
    // Chrome takes the access away as the password is checked.
    const check = t.wallet.checkPassword.bind(t.wallet);
    t.wallet.checkPassword = async (password: string) => {
      await check(password);
      await t.preferences.set({ dappConnector: false });
    };
    expect(await t.dapp.answer(t.dapp.approvals()[0]!.id, true, PASSWORD)).toEqual({ error: OFF });
    expect(await signing).toEqual({ code: APIError.Refused, info: OFF });
  });

  it("signs nothing a Lovejoin chain started meanwhile needs, or that the user locked meanwhile", async () => {
    const t = await on();
    const s = await connected(t);
    const { summary, tx } = await payment(t);
    const [input] = txInputs(Uint8Array.from(Buffer.from(tx, "hex")));
    expect(summary.inputs).toBeGreaterThan(0);

    // A public mix starts sending while the prompt waits: its first step spends the same UTxO.
    const signing = heard(t.dapp.call(s, "signTx", [tx, false]));
    await until(() => t.dapp.approvals().length === 1);
    await t.session.set(SESSION_RESERVED_PREFIX + "preprod", { public: { inputs: [input!], collateral: [] } });
    const answer = await t.dapp.answer(t.dapp.approvals()[0]!.id, true, PASSWORD);
    expect(answer.error).toContain("still being sent through Lovejoin");
    expect(await signing).toMatchObject({ code: TxSignError.ProofGeneration, info: expect.stringContaining("still being sent through Lovejoin") });
    await t.lovejoin.release("preprod", "public");

    // The user locks the UTxO while the prompt waits.
    await t.balances.get("preprod");
    const again = heard(t.dapp.call(s, "signTx", [tx, false]));
    await until(() => t.dapp.approvals().length === 1);
    await t.coins.setLocked("preprod", "cardano", input!, true);
    expect((await t.dapp.answer(t.dapp.approvals()[0]!.id, true, PASSWORD)).error).toContain("a UTxO you locked");
    expect(await again).toMatchObject({ code: TxSignError.ProofGeneration });

    // Unlocked again, the same transaction is signed.
    await t.coins.setLocked("preprod", "cardano", input!, false);
    const signed = t.dapp.call(s, "signTx", [tx, false]);
    await until(() => t.dapp.approvals().length === 1);
    expect(await t.dapp.answer(t.dapp.approvals()[0]!.id, true, PASSWORD)).toEqual({});
    expect(((await signed) as string).slice(0, 2)).toBe("a1");
  });
});
