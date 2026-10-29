// 1.6.0's release review, 314-wasm#0: V8 reports WebAssembly running out of stack as a RangeError, as it does
// JavaScript's own overflow, and isTrap counted neither as a trap. One thrown out of WebAssembly leaves Rust's stack
// pointer where the overflow stopped it, so the instance is broken: its next calls ran short and trapped, and the
// wallet locked itself later, at some other call. A pool's script row under a datum a few thousand levels deep did it
// as the pool was verified (the Rust half of the fix keeps such a datum from being decoded). Such a RangeError is a
// trap now: under the wallet's queue or a UI request the wallet locks at once on a fresh instance, and pool discovery
// hands it on rather than leave the pool out.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DataParts } from "../src/background/data-layer";
import type { KoiosUtxo } from "../src/background/koios";
import { HOLDER, PoolDiscovery, serviceDeps, type DiscoveryDeps } from "../src/background/lovejoin-pools";
import { privateIndexClient } from "../src/background/private-index";
import { Wallet, WASM_BROKEN } from "../src/background/wallet";
import { freshWasm, isTrap } from "../src/background/wasm";
import { fakeIndex, indexRowOf } from "./fake-index";
import { loadTestWasm, memoryArea, testWallet, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const phrase = vectors("cardano_account.json").find((v) => v.account === 0)!.phrase as string;

/** A WebAssembly function that calls itself for good, `(module (func $f (export "f") (call $f)))`: V8 stops it with a RangeError, thrown inside WebAssembly. */
function overflowing(): () => void {
  const module = new WebAssembly.Module(
    new Uint8Array([
      ...[0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00], // "\0asm", version 1
      ...[0x01, 0x04, 0x01, 0x60, 0x00, 0x00], // one type, [] -> []
      ...[0x03, 0x02, 0x01, 0x00], // one function, of that type
      ...[0x07, 0x05, 0x01, 0x01, 0x66, 0x00, 0x00], // exported as "f"
      ...[0x0a, 0x06, 0x01, 0x04, 0x00, 0x10, 0x00, 0x0b], // its body: call itself
    ]),
  );
  return new WebAssembly.Instance(module).exports.f as () => void;
}

/** What `call` throws. */
function thrown(call: () => unknown): unknown {
  try {
    call();
  } catch (e) {
    return e;
  }
  throw new Error("it didn't throw");
}

/**
 * What `call` throws, its stack written by V8 itself, as in Chrome's worker. V8 writes a stack when it's first read,
 * with the formatter in place then, and Vitest puts in one of its own, which writes a WebAssembly frame differently.
 */
function thrownAsInChrome(call: () => unknown): unknown {
  const errors = Error as { prepareStackTrace?: unknown };
  const own = errors.prepareStackTrace;
  errors.prepareStackTrace = undefined;
  try {
    const e = thrown(call);
    void (e as Error).stack;
    return e;
  } finally {
    errors.prepareStackTrace = own;
  }
}

/** A wallet whose fresh() replaces the real instance, counted (wallet.test.ts's `breakable`). */
function breakable() {
  const t = testWallet();
  let fresh = 0;
  const canReset = "__wbg_reset_state" in loadTestWasm();
  const wallet = new Wallet({
    wasm: loadTestWasm(),
    local: t.local,
    session: t.session,
    now: () => t.clock.now,
    autoLock: { start: async () => undefined, stop: async () => undefined },
    changed: () => undefined,
    fresh: () => {
      fresh++;
      if (canReset) freshWasm();
    },
  });
  return { ...t, wallet, fresh: () => fresh };
}

/** PR #163's token pool on preprod, which the data layer's list names here; WebAssembly is stubbed, so it's never read. */
const FOUND = JSON.parse(readFileSync(new URL("../../wasm/tests/fixtures/lovejoin-token-pool-preprod.json", import.meta.url), "utf8")) as {
  seed: { txHash: string; txIndex: number };
  reference: KoiosUtxo;
};

/** Discovery over a data layer listing that pool, and WebAssembly whose pool verification is `verify`. */
function listing(verify: () => string) {
  const index = fakeIndex();
  const slot = 100_000_000;
  index.poolList = {
    network: "mainnet",
    cursor: `${slot}.${"0".repeat(64)}`,
    classic: { crowd: { boxes: 80, deposits: 12, mixed: 70 } },
    pools: [
      {
        id: "c5852bb700034b0b259c9e237e58ffc5d022ce8f67600fbf32736e69",
        seed: `${FOUND.seed.txHash}#${FOUND.seed.txIndex}`,
        reference: indexRowOf(FOUND.reference, slot),
        scripts: [],
        launch: { tx: FOUND.reference.tx_hash, block: 1, index: 0, slot, time: slot + 1_591_566_291 },
        crowd: { boxes: 30, deposits: 1, mixed: 0 },
      },
    ],
  };
  const parts = new DataParts(memoryArea(), () => 1_800_000_000_000);
  const client = privateIndexClient({ koiosOnly: async () => false, parts, fetch: index.fetch, limits: {} }, () => "https://data.test");
  const refused = () => {
    throw new Error("not asked here");
  };
  const deps: DiscoveryDeps = {
    local: memoryArea(),
    wasm: { lovejoinCandidate: refused, lovejoinLaunchCheck: refused, lovejoinVerifyPool: verify },
    koios: () => ({ koiosAlone: refused }) as never,
    index: client,
    wallet: { trapped: async () => undefined },
    now: () => 1_800_000_000_000,
    listed: () => new Set(["02d597331203e9e2ec8b954b26a33503f044578c836407bf125f31fa4c4a54455354"]),
    headStart: () => ({ height: 0, pools: [] }),
  };
  return new PoolDiscovery(deps);
}

describe("a stack overflow inside WebAssembly (1.6.0's release review, 314-wasm#0)", () => {
  it("is a trap, where JavaScript's own overflow isn't", () => {
    const deep: unknown[] = [];
    let at = deep;
    for (let i = 0; i < 1_000_000; i++) {
      const next: unknown[] = [];
      at.push(next);
      at = next;
    }
    const recurse = (n: number): number => recurse(n + 1) + 1;
    for (const throws of [thrownAsInChrome, thrown]) {
      const inWasm = throws(overflowing());
      expect(inWasm).toBeInstanceOf(RangeError);
      expect(inWasm).not.toBeInstanceOf(WebAssembly.RuntimeError);
      expect(isTrap(inWasm), (inWasm as Error).stack).toBe(true);
      // JSON.stringify's, as often as not, which leaves WebAssembly as it was.
      const inJson = throws(() => JSON.stringify(deep));
      expect(inJson).toBeInstanceOf(RangeError);
      expect(isTrap(inJson)).toBe(false);
      expect(isTrap(throws(() => recurse(0)))).toBe(false);
    }
    expect((thrownAsInChrome(overflowing()) as Error).stack).toMatch(/wasm-function\[0\]/);
    expect(isTrap(new RangeError("Maximum call stack size exceeded"))).toBe(false);
  });

  it("locks the wallet at once, as a trap does, and it carries on from a fresh instance", async () => {
    const { wallet, session, fresh } = breakable();
    await wallet.create(phrase, PASSWORD);
    const f = overflowing();
    await expect(wallet.withKeys(() => f())).rejects.toThrow(WASM_BROKEN());
    expect(fresh()).toBe(1);
    expect(session.data.size).toBe(0);
    expect(await wallet.state()).toBe("locked");
    expect(wallet.lockReason()).toBe("trap");
    expect(await wallet.unlock(PASSWORD)).toEqual({ unlocked: true });
    // JavaScript's own overflow under the queue is only an error: the wallet stays as it was.
    const recurse = (n: number): number => recurse(n + 1) + 1;
    await expect(wallet.withKeys(() => recurse(0))).rejects.toBeInstanceOf(RangeError);
    expect(fresh()).toBe(1);
    expect(await wallet.state()).toBe("unlocked");
  });

  it("is handed on by pool discovery, never taken for a pool that didn't verify", async () => {
    const f = overflowing();
    const verify = () => {
      f();
      return "";
    };
    await expect(listing(verify).refresh("preprod")).rejects.toBeInstanceOf(RangeError);
    // The pool read hands it on as it does a trap, so the request it's under locks the wallet (sw.ts answerUi).
    await expect(serviceDeps(listing(verify)).pools("preprod")).rejects.toBeInstanceOf(RangeError);
    // A refusal in words is only a pool left out.
    const refusing = listing(() => {
      throw new Error("Its seed doesn't make its NFT, so it can't be proven genuine");
    });
    await refusing.refresh("preprod");
    expect(await refusing.known("preprod")).toEqual([]);
    expect(HOLDER).toMatch(/^[0-9a-f]{56}$/);
  });
});
