// Test doubles for the Chrome APIs the wallet uses.
import { readFileSync } from "node:fs";

import * as wasm from "@seedelf/wasm";

import type { Area } from "../src/background/storage";
import { Wallet, type WalletDeps } from "../src/background/wallet";

/** An in-memory chrome.storage area. Values go through JSON, as Chrome's do. */
export type MemoryArea = Area & { data: Map<string, unknown> };

export function memoryArea(): MemoryArea {
  const data = new Map<string, unknown>();
  return {
    data,
    async get<T>(key: string) {
      const raw = data.get(key);
      return raw === undefined ? undefined : (JSON.parse(raw as string) as T);
    },
    async set(key, value) {
      data.set(key, JSON.stringify(value));
    },
    async remove(...keys) {
      for (const k of keys) data.delete(k);
    },
  };
}

let wasmReady = false;

/** The real WebAssembly module, built by ../wasm/build.sh. */
export function loadTestWasm(): typeof wasm {
  if (!wasmReady) {
    wasm.initSync({ module: readFileSync(new URL("../../wasm/pkg/seedelf_wasm_bg.wasm", import.meta.url)) });
    wasmReady = true;
  }
  return wasm;
}

/** A wallet over fake storage and a controllable clock. */
export function testWallet(shared?: { local: MemoryArea; session: MemoryArea; clock: { now: number } }) {
  const local = shared?.local ?? memoryArea();
  const session = shared?.session ?? memoryArea();
  const clock = shared?.clock ?? { now: 1_800_000_000_000 };
  const events = { changed: 0, alarm: "stopped" as "started" | "stopped" };
  const deps: WalletDeps = {
    wasm: loadTestWasm(),
    local,
    session,
    now: () => clock.now,
    autoLock: {
      start: async () => void (events.alarm = "started"),
      stop: async () => void (events.alarm = "stopped"),
    },
    changed: () => void events.changed++,
  };
  return { wallet: new Wallet(deps), local, session, clock, events };
}

export const vectors = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../../seedelf-crypto/tests/vectors/${name}`, import.meta.url), "utf8"))
    .vectors as Array<Record<string, any>>;
