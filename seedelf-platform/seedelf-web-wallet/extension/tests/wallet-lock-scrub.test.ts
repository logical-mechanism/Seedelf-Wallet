// The scrub of WebAssembly's stack (wallet.ts `free`, `derive` and `stackScrub`; the module's `scrubStack`, which
// wasm/tests/free_wipes_key.test.mjs holds to what it overwrites): once after a lock's keys are freed, and once after
// each derivation of keys (an unlock's, a second account's), since a derivation leaves what the keys come from on the
// stack and the next call that builds something can copy bytes of it into the heap, where no later scrub reaches
// (1.10.0's second review: 8 bytes of the BIP39 seed after a private transfer built straight after an unlock). Never
// the lock's or the unlock's failure; and optional, so a wallet without one, or over a module built before the scrub,
// locks and unlocks as it always did.
import { readFileSync } from "node:fs";

import type * as Wasm from "@seedelf/wasm";
import { describe, expect, it, vi } from "vitest";

import { stackScrub, Wallet } from "../src/background/wallet";
import { loadTestWasm, memoryArea, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const [vector] = vectors("cardano_account.json").filter((v) => v.account === 0);

/**
 * An unlocked wallet with `scrub` as the worker would wire one; `derived`, what the scrub did while its keys were
 * derived; and `order`, what its lock does, in order.
 */
async function unlocked(scrub?: (order: string[]) => void) {
  const order: string[] = [];
  const session = memoryArea();
  const events = { changed: 0, alarm: "stopped" as "started" | "stopped" };
  const wallet = new Wallet({
    wasm: loadTestWasm(),
    local: memoryArea(),
    session,
    now: () => 1_800_000_000_000,
    autoLock: {
      start: async () => void (events.alarm = "started"),
      stop: async () => void (events.alarm = "stopped"),
    },
    changed: () => void events.changed++,
    ...(scrub ? { scrub: () => scrub(order) } : {}),
  });
  await wallet.create(vector!.phrase, PASSWORD);
  // A second public account's keys, kept while unlocked and freed with the rest.
  const other = await wallet.withAccount(1, (account) => account.cardano);
  const keys = await wallet.withKeys((k) => k);
  for (const [name, object] of [["other", other], ["seedelf", keys.seedelf], ["cardano", keys.cardano], ["oneTime", keys.oneTime]] as const) {
    const free = object.free.bind(object);
    object.free = () => {
      order.push(`free ${name}`);
      free();
    };
  }
  // What the two derivations did (create's, and the second account's) is set apart: `order` begins at the lock.
  const derived = order.splice(0);
  return { wallet, session, events, order, derived };
}

/** Locked, whole: nothing in session storage, the alarm stopped, no keys, and the password opens it again. */
async function expectLocked({ wallet, session, events }: Awaited<ReturnType<typeof unlocked>>) {
  expect(session.data.size).toBe(0);
  expect(events.alarm).toBe("stopped");
  expect(wallet.lockReason()).toBeUndefined();
  expect(await wallet.state()).toBe("locked");
  await expect(wallet.account("preprod")).rejects.toThrow("locked");
  expect(await wallet.unlock(PASSWORD)).toEqual({ unlocked: true });
  expect((await wallet.account("preprod")).receiveAddress).toBe(vector!.preprod.receive_0);
}

describe("a lock's scrub of WebAssembly's stack", () => {
  it("runs once, after every key is freed", async () => {
    const t = await unlocked((order) => void order.push("scrub"));
    await t.wallet.lock();
    expect(t.order).toEqual(["free other", "free seedelf", "free cardano", "free oneTime", "scrub"]);
    // A locked wallet looked at again has no keys to free, and scrubs nothing.
    expect(await t.wallet.state()).toBe("locked");
    await t.wallet.lock();
    expect(t.order.filter((step) => step === "scrub")).toHaveLength(1);
    // The unlock in here derives the keys again: one more.
    await expectLocked(t);
    expect(t.order.filter((step) => step === "scrub")).toHaveLength(2);

    // The next lock scrubs again.
    await t.wallet.lock();
    expect(t.order.filter((step) => step === "scrub")).toHaveLength(3);
  });

  it("runs once after each derivation of keys: the wallet's own, and a second account's", async () => {
    const t = await unlocked((order) => void order.push("scrub"));
    // Before any key was freed: create's derivation, then account 1's.
    expect(t.derived).toEqual(["scrub", "scrub"]);
    // A look at the keys, or at an account already derived, derives nothing and scrubs nothing.
    await t.wallet.withKeys((k) => k);
    await t.wallet.withAccount(1, (account) => account.cardano);
    await t.wallet.account("preprod");
    expect(t.order).toEqual([]);
  });

  it("never stops an unlock when it throws", async () => {
    const t = await unlocked(() => {
      throw new WebAssembly.RuntimeError("unreachable");
    });
    expect(await t.wallet.state()).toBe("unlocked");
    expect((await t.wallet.account("preprod")).receiveAddress).toBe(vector!.preprod.receive_0);
    await t.wallet.lock();
    await expectLocked(t);
  });

  it("never stops the lock, nor leaves the wallet half locked, when it throws", async () => {
    for (const thrown of [new WebAssembly.RuntimeError("unreachable"), new RangeError("Maximum call stack size exceeded"), "not an error"]) {
      const t = await unlocked((order) => {
        order.push("scrub");
        throw thrown;
      });
      await t.wallet.lock();
      expect(t.order).toEqual(["free other", "free seedelf", "free cardano", "free oneTime", "scrub"]);
      await expectLocked(t);
    }
  });

  it("runs after keys that couldn't be freed, too", async () => {
    const t = await unlocked((order) => void order.push("scrub"));
    const keys = await t.wallet.withKeys((k) => k);
    // What a trapped instance answers: each free fails.
    for (const object of [keys.seedelf, keys.cardano, keys.oneTime]) {
      object.free = () => {
        throw new WebAssembly.RuntimeError("memory access out of bounds");
      };
    }
    await t.wallet.lock();
    expect(t.order).toEqual(["free other", "scrub"]);
    expect(await t.wallet.state()).toBe("locked");
  });

  it("isn't needed: a wallet without one locks as before", async () => {
    const t = await unlocked();
    await t.wallet.lock();
    expect(t.order).toEqual(["free other", "free seedelf", "free cardano", "free oneTime"]);
    await expectLocked(t);
  });
});

describe("the module's scrub as the worker wires it", () => {
  it("calls the module's scrubStack, and does nothing over a module built before it", () => {
    const scrubStack = vi.fn();
    stackScrub({ scrubStack } as unknown as typeof Wasm)();
    expect(scrubStack).toHaveBeenCalledOnce();
    expect(() => stackScrub({} as unknown as typeof Wasm)()).not.toThrow();
  });

  it("locks a wallet over the built module, whether or not it has the scrub", async () => {
    const wasm = loadTestWasm();
    const scrub = vi.fn(stackScrub(wasm));
    const session = memoryArea();
    const wallet = new Wallet({
      wasm,
      local: memoryArea(),
      session,
      now: () => 1_800_000_000_000,
      autoLock: { start: async () => undefined, stop: async () => undefined },
      changed: () => undefined,
      scrub,
    });
    await wallet.create(vector!.phrase, PASSWORD);
    // The derivation's.
    expect(scrub).toHaveBeenCalledOnce();
    await wallet.lock();
    expect(scrub).toHaveBeenCalledTimes(2);
    expect(scrub).toHaveReturnedWith(undefined);
    expect(session.data.size).toBe(0);
    expect(await wallet.state()).toBe("locked");
    // The same instance goes on working after its stack was scrubbed.
    expect(await wallet.unlock(PASSWORD)).toEqual({ unlocked: true });
    expect((await wallet.account("preprod")).receiveAddress).toBe(vector!.preprod.receive_0);
  });

  it("is the worker's wallet's scrub", () => {
    // sw.ts builds the one wallet: without this line a lock there scrubs nothing.
    const worker = readFileSync(new URL("../src/background/sw.ts", import.meta.url), "utf8");
    expect(worker).toContain("scrub: stackScrub(wasm),");
  });

  it("is followed by the worker's wallet's renew", () => {
    // The lock's last step (wasm.ts `renewWasm`: a fresh instance, the old one's memory zeroed) is wired in the same
    // place, and free() swallows a renew that throws: without this line a lock in Chrome would leave the instance,
    // and what calls copied into its heap, with no test saying so (the 1.10.0 gate's last review, a test gap).
    const worker = readFileSync(new URL("../src/background/sw.ts", import.meta.url), "utf8");
    expect(worker).toContain("renew: renewWasm,");
    expect(worker).toMatch(/import \{[^}]*\brenewWasm\b[^}]*\} from "\.\/wasm";/);
  });
});
