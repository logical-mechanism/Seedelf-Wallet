// The wallet's queue with a call's own admit check (the 1.10.0 gate's round 5): Seedelf Messaging's background work and
// screens pass one, looked at as the call's turn comes, so a call that waited behind another feature's long task gives
// the queue back instead of running in a run of the wallet's requests to the relay. Turned away, nothing runs, locks,
// wipes or is derived, and the queue goes on; let through, everything is as without one.
import { describe, expect, it } from "vitest";

import { PRIVATE_PREFIX, PrivateStore } from "../src/background/private-store";
import { AUTO_LOCK_MS, NotAdmitted, SESSION_ENTROPY, WalletLocked, WASM_BROKEN } from "../src/background/wallet";
import { loadTestWasm, testWallet } from "./fakes";

const PASSWORD = "correct horse battery";

async function unlocked() {
  const t = testWallet();
  await t.wallet.create(loadTestWasm().generatePhrase(), PASSWORD);
  return t;
}

/** An admit check that says yes `yes` times, then no, counting each look. */
function saysYes(yes: number) {
  const check = Object.assign(() => check.looks++ < yes, { looks: 0 });
  return check;
}

/** The wallet's in-memory keys, which a call turned away before its load's derive never sets. */
const keysOf = (wallet: unknown) => (wallet as { keys?: unknown }).keys;

describe("the wallet's queue: a call's admit check (the 1.10.0 gate's round 5)", () => {
  it("turned away as its turn comes: the task doesn't run, NotAdmitted, nothing locked or wiped, and the queue goes on", async () => {
    const t = await unlocked();
    let ran = false;
    const refused = t.wallet.withKeys(() => void (ran = true), () => false);
    const next = t.wallet.withKeys((keys) => keys.account);
    const error = await refused.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotAdmitted);
    expect(error).not.toBeInstanceOf(WalletLocked);
    expect(await next).toBe(0);
    expect(ran).toBe(false);
    expect(t.session.data.has(SESSION_ENTROPY)).toBe(true);
    expect(t.wallet.lockReason()).toBeUndefined();
    expect(await t.wallet.state()).toBe("unlocked");
  });

  it("turned away after the state's load (a run of requests began while it read the session): the task doesn't run", async () => {
    const t = await unlocked();
    let ran = false;
    const check = saysYes(1);
    await expect(t.wallet.withKeys(() => void (ran = true), check)).rejects.toBeInstanceOf(NotAdmitted);
    expect(check.looks).toBe(2);
    expect(ran).toBe(false);
    expect(await t.wallet.state()).toBe("unlocked");
  });

  it("let through: as without a check, looked at before the load and right before the task", async () => {
    const t = await unlocked();
    const check = saysYes(Infinity);
    expect(await t.wallet.withKeys((keys) => keys.account + 1, check)).toBe(1);
    expect(check.looks).toBe(2);
    expect(await t.wallet.withStoreKey((key) => key.length, check)).toBe(32);
    expect(check.looks).toBe(5);
  });

  it("derives no key it won't use: a worker started again, turned away before its load's derive", async () => {
    const t = await unlocked();
    // A worker Chrome started again: the same storage, nothing in memory.
    const again = testWallet({ local: t.local, session: t.session, clock: t.clock });
    expect(keysOf(again.wallet)).toBeUndefined();
    const check = saysYes(1);
    await expect(again.wallet.withKeys((keys) => keys.account, check)).rejects.toBeInstanceOf(NotAdmitted);
    expect(check.looks).toBe(2);
    expect(keysOf(again.wallet)).toBeUndefined();
    // Let through, it derives them as it always has.
    expect(await again.wallet.withKeys((keys) => keys.account)).toBe(0);
    expect(keysOf(again.wallet)).toBeDefined();
  });

  it("the store's key: none derived for a call turned away after its entropy's read, and the queue goes on", async () => {
    const t = await unlocked();
    let ran = false;
    const check = saysYes(2);
    await expect(t.wallet.withStoreKey(() => void (ran = true), check)).rejects.toBeInstanceOf(NotAdmitted);
    expect(check.looks).toBe(3);
    expect(ran).toBe(false);
    await expect(t.wallet.withStoreKey(() => void (ran = true), () => false)).rejects.toBeInstanceOf(NotAdmitted);
    expect(ran).toBe(false);
    expect(await t.wallet.withStoreKey((key) => key.length)).toBe(32);
    expect(await t.wallet.state()).toBe("unlocked");
  });

  it("state and unlockedAt: turned away, nothing is loaded, so not even auto-lock's deadline is applied by them", async () => {
    const t = await unlocked();
    const at = await t.wallet.unlockedAt();
    await expect(t.wallet.unlockedAt(saysYes(1))).rejects.toBeInstanceOf(NotAdmitted);
    expect(await t.wallet.unlockedAt(saysYes(Infinity))).toBe(at);
    t.clock.now += AUTO_LOCK_MS + 1;
    await expect(t.wallet.state(() => false)).rejects.toBeInstanceOf(NotAdmitted);
    await expect(t.wallet.unlockedAt(() => false)).rejects.toBeInstanceOf(NotAdmitted);
    expect(t.session.data.has(SESSION_ENTROPY)).toBe(true);
    // The first call let through loads, and the deadline locks it as before.
    expect(await t.wallet.state()).toBe("locked");
    expect(t.session.data.has(SESSION_ENTROPY)).toBe(false);
  });

  it("a trap under a call let through locks the wallet as before; one turned away never takes that path", async () => {
    const t = await unlocked();
    await expect(t.wallet.withKeys(() => void 0, () => false)).rejects.toBeInstanceOf(NotAdmitted);
    expect(t.wallet.lockReason()).toBeUndefined();
    const trap = t.wallet.withKeys(() => {
      throw new WebAssembly.RuntimeError("unreachable");
    }, () => true);
    await expect(trap).rejects.toThrow(WASM_BROKEN());
    await expect(trap).rejects.toBeInstanceOf(WalletLocked);
    expect(t.wallet.lockReason()).toBe("trap");
    expect(await t.wallet.state()).toBe("locked");
    // Locked, a call's check says nothing more: it's a lock, as without one.
    await expect(t.wallet.withKeys(() => void 0, () => true)).rejects.toBeInstanceOf(WalletLocked);
  });
});

describe("the private store with a call's admit check (round 5)", () => {
  it("set turned away: nothing sealed or written, nothing locked, and the next write goes through", async () => {
    const t = await unlocked();
    const store = new PrivateStore({ wallet: t.wallet, local: t.local });
    await expect(store.set("contacts", [{ name: "x" }], () => false)).rejects.toBeInstanceOf(NotAdmitted);
    await expect(store.set("contacts", [{ name: "x" }], saysYes(2))).rejects.toBeInstanceOf(NotAdmitted);
    expect(t.local.data.has(PRIVATE_PREFIX + "contacts")).toBe(false);
    expect(store.lastSealed("contacts")).toBeUndefined();
    await store.set("contacts", [{ name: "y" }], () => true);
    expect(await store.get("contacts")).toEqual([{ name: "y" }]);
    expect(await t.wallet.state()).toBe("unlocked");
  });

  it("get and open turned away: nothing unsealed; let through, the record as without a check", async () => {
    const t = await unlocked();
    const store = new PrivateStore({ wallet: t.wallet, local: t.local });
    await store.set("contacts", [{ name: "z" }]);
    await expect(store.get("contacts", () => false)).rejects.toBeInstanceOf(NotAdmitted);
    const sealed = await store.sealed("contacts");
    await expect(store.open("contacts", sealed, saysYes(2))).rejects.toBeInstanceOf(NotAdmitted);
    expect(await store.open("contacts", sealed, () => true)).toEqual([{ name: "z" }]);
    expect(await store.get("contacts", saysYes(Infinity))).toEqual([{ name: "z" }]);
    expect(t.wallet.lockReason()).toBeUndefined();
  });
});
