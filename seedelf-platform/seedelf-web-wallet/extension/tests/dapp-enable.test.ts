// A page can't flood the connector's window, or learn whether the wallet is
// locked from its refusals.
//
// Independent review L35: a site that isn't connected asks to connect once at
// a time, however often it calls enable(); once the user says no, or closes
// the window on it, its enable() is declined unasked for a minute, locked or
// not; and one site has at most 5 requests waiting of the window's 20.
//
// Independent review L36: in the minute after the window is closed on a
// locked wallet, a site's signatures and sends hear what a site that isn't
// connected hears unlocked, never "Seedelf Wallet is locked.".
import { describe, expect, it } from "vitest";

import { type DappError, type DappSession } from "../src/background/dapp";
import { APIError, DataSignError } from "../src/shared/dapp";
import { testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
const OWN = account.preprod.receive_0 as string;
const STRANGER = "https://stranger.example";
const DECLINED = { failure: { code: APIError.Refused, info: "The user declined." } };
const NOT_CONNECTED = { failure: { code: APIError.Refused, info: "This site isn't connected to Seedelf Wallet. Call enable() first." } };
const BUSY = { failure: { code: APIError.Refused, info: "Seedelf Wallet is busy with this site's other requests." } };

let pages = 0;
const site = (origin = "https://app.example.com"): DappSession => ({ id: `enable${++pages}`, origin, title: "Example" });
const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}
const settle = async () => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0));
};
const heard = (p: Promise<unknown>) => p.then(() => undefined, (e: DappError) => e.failure);

async function on() {
  const t = testBalances();
  await t.wallet.create(account.phrase, PASSWORD);
  await t.preferences.set({ dappConnector: true, spendRewards: false });
  return t;
}

async function connected(t: Awaited<ReturnType<typeof on>>, s = site()) {
  const enabling = t.dapp.call(s, "enable", []);
  await until(() => t.dapp.approvals().length === 1);
  await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
  expect(await enabling).toBe(true);
  return s;
}

describe("a site that isn't connected, calling enable() again and again", () => {
  it("asks once, leaves room for the other sites, and isn't asked again for a minute once the window is closed on it", async () => {
    const t = await on();
    const good = await connected(t);
    const shown = t.dappWindow.shown;
    const asking = Array.from({ length: 20 }, () => heard(t.dapp.call(site(STRANGER), "enable", [])));
    await until(() => t.dapp.approvals().length === 1);
    await settle();
    expect(t.dapp.approvals()).toHaveLength(1);
    expect(t.dappWindow.shown).toBe(shown + 1);

    // A connected site's request still goes in front of the user.
    const message = [t.deps.wasm.cip30Address(OWN), hex("Sign in")];
    const signing = heard(t.dapp.call(good, "signData", message));
    await until(() => t.dapp.approvals().length === 2);

    // The user closes the window: everything is declined, the stranger's twenty calls with its one question.
    t.dappWindow.open = false;
    await t.dapp.windowClosed();
    expect(await Promise.all(asking)).toEqual(Array.from({ length: 20 }, () => DECLINED.failure));
    expect(await signing).toEqual({ code: DataSignError.UserDeclined, info: "The user declined." });

    // It asks again at once: declined unasked, the window left alone, for a minute.
    await expect(t.dapp.call(site(STRANGER), "enable", [])).rejects.toMatchObject(DECLINED);
    expect(t.dappWindow.shown).toBe(shown + 2);
    expect(t.dapp.approvals()).toEqual([]);
    t.clock.now += 61_000;
    const again = t.dapp.call(site(STRANGER), "enable", []);
    await until(() => t.dapp.approvals().length === 1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
    expect(await again).toBe(true);
  });

  it("isn't asked again for a minute once the user says no either", async () => {
    const t = await on();
    const asking = t.dapp.call(site(STRANGER), "enable", []);
    await until(() => t.dapp.approvals().length === 1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, false);
    await expect(asking).rejects.toMatchObject(DECLINED);
    const shown = t.dappWindow.shown;
    await expect(t.dapp.call(site(STRANGER), "enable", [])).rejects.toMatchObject(DECLINED);
    expect(t.dappWindow.shown).toBe(shown);
    // Another site is asked as ever.
    const other = t.dapp.call(site("https://other.example"), "enable", []);
    await until(() => t.dapp.approvals().length === 1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
    expect(await other).toBe(true);
  });

  it("is declined unasked for a minute after the unlock window is closed on it too, in the same words", async () => {
    const t = await on();
    await t.wallet.lock();
    const asking = t.dapp.call(site(STRANGER), "enable", []);
    await until(() => t.dapp.unlockingSites().length === 1);
    t.dappWindow.open = false;
    await t.dapp.windowClosed();
    await expect(asking).rejects.toMatchObject(DECLINED);
    const shown = t.dappWindow.shown;
    const locked = await heard(t.dapp.call(site(STRANGER), "enable", []));
    expect(t.dappWindow.shown).toBe(shown);
    expect(t.dapp.unlockingSites()).toEqual([]);
    // Unlocked, within the minute: the same answer.
    await t.wallet.unlock(PASSWORD);
    await t.dapp.stateChanged();
    const unlocked = await heard(t.dapp.call(site(STRANGER), "enable", []));
    expect(t.dappWindow.shown).toBe(shown);
    expect(locked).toEqual(DECLINED.failure);
    expect(unlocked).toEqual(locked);
  });
});

describe("pages of one site sharing a connect question", () => {
  it("never ask for a page that went away while it waited on another's", async () => {
    const t = await on();
    const [a, b] = [site(STRANGER), site(STRANGER)];
    const first = heard(t.dapp.call(a, "enable", []));
    const second = heard(t.dapp.call(b, "enable", []));
    await until(() => t.dapp.approvals().length === 1);
    await settle();
    t.dapp.gone(b);
    t.dapp.gone(a);
    expect(await first).toEqual({ code: APIError.Refused, info: "The page went away." });
    expect(await second).toEqual({ code: APIError.Refused, info: "The page went away." });
    await settle();
    expect(t.dapp.approvals()).toEqual([]);
  });
});

describe("one site's share of the window", () => {
  it("is five requests waiting at once; another site's still go in", async () => {
    const t = await on();
    const s = await connected(t);
    const other = await connected(t, site("https://other.example"));
    const message = [t.deps.wasm.cip30Address(OWN), hex("Sign in")];
    const waiting = Array.from({ length: 5 }, () => heard(t.dapp.call(s, "signData", message)));
    await until(() => t.dapp.approvals().length === 5);
    await expect(t.dapp.call(s, "signData", message)).rejects.toMatchObject(BUSY);
    const theirs = heard(t.dapp.call(other, "signData", message));
    await until(() => t.dapp.approvals().length === 6);
    for (const a of t.dapp.approvals()) await t.dapp.answer(a.id, false);
    await Promise.all([...waiting, theirs]);

    // While locked, the unlock window's queue is shared the same way.
    await t.wallet.lock();
    const unlocking = Array.from({ length: 5 }, () => heard(t.dapp.call(s, "signData", message)));
    await until(() => t.dapp.unlockingSites().length === 1);
    await settle();
    await expect(t.dapp.call(s, "signData", message)).rejects.toMatchObject(BUSY);
    t.dappWindow.open = false;
    await t.dapp.windowClosed();
    await Promise.all(unlocking);
  });
});

describe("the minute after the unlock window is closed", () => {
  it("never says the wallet is locked: a site's signatures and sends hear what a stranger's do unlocked", async () => {
    const t = await on();
    const s = await connected(t);
    const message = [t.deps.wasm.cip30Address(OWN), hex("Sign in")];
    // Unlocked, a stranger's signature and send hear that it isn't connected.
    const unlocked = {
      sign: await heard(t.dapp.call(site(STRANGER), "signData", message)),
      send: await heard(t.dapp.call(site(STRANGER), "submitTx", ["00"])),
    };
    expect(unlocked).toEqual({ sign: NOT_CONNECTED.failure, send: NOT_CONNECTED.failure });

    await t.wallet.lock();
    const refused = [t.dapp.call(s, "signData", message), t.dapp.call(site(STRANGER), "signData", message)].map(heard);
    await until(() => t.dapp.unlockingSites().length === 2);
    t.dappWindow.open = false;
    await t.dapp.windowClosed();
    expect(await Promise.all(refused)).toEqual([DECLINED.failure, DECLINED.failure]);

    const shown = t.dappWindow.shown;
    for (const who of [s, site(STRANGER)]) {
      expect(await heard(t.dapp.call(who, "signData", message))).toEqual(unlocked.sign);
      expect(await heard(t.dapp.call(who, "submitTx", ["00"]))).toEqual(unlocked.send);
    }
    expect(t.dappWindow.shown).toBe(shown);
  });

  it("gives a stranger the not-connected words when the queue is full while locked, as unlocked", async () => {
    const t = await on();
    const message = [t.deps.wasm.cip30Address(OWN), hex("Sign in")];
    await t.wallet.lock();
    // Twenty from four sites wait for the unlock.
    const waiting = ["a", "b", "c", "d"].flatMap((x) =>
      Array.from({ length: 5 }, () => heard(t.dapp.call(site(`https://${x}.example`), "signData", message))),
    );
    await until(() => t.dapp.unlockingSites().length === 4);
    await settle();
    expect(await heard(t.dapp.call(site(STRANGER), "signData", message))).toEqual(NOT_CONNECTED.failure);
    t.dappWindow.open = false;
    await t.dapp.windowClosed();
    await Promise.all(waiting);
  });
});
