// Test doubles for the Chrome APIs the wallet uses.
import { readFileSync } from "node:fs";

import * as wasm from "@seedelf/wasm";

import { BalanceService } from "../src/background/balances";
import { Koios, type FetchLike, type KoiosUtxo } from "../src/background/koios";
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

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as Record<string, any>;

/** Real preprod Koios responses (tests/fixtures/record-koios.mjs). */
export const koiosPreprod = fixture("koios-preprod.json") as {
  wallet_contract: string;
  contract_utxos: KoiosUtxo[];
  accounts: Record<string, { account_addresses: Array<{ addresses: string[] }>; account_utxos: KoiosUtxo[] }>;
};
/** Synthetic contract UTxOs owned by the 12-word vector phrase. */
export const ownedUtxos = fixture("owned-utxos.json").owned_utxos as KoiosUtxo[];

export interface FakeKoios {
  fetch: FetchLike;
  calls: Array<{ path: string; query: string; body: any }>;
  /** Resolves pending requests; while `hold` is set, requests wait for it. */
  hold?: Promise<void>;
}

/** A fetch that answers from the fixtures, paging like Koios does. */
export function fakeKoios({ owned = true } = {}): FakeKoios {
  const fake: FakeKoios = {
    calls: [],
    fetch: async (url, init) => {
      const { pathname, searchParams } = new URL(url);
      const path = pathname.split("/").pop()!;
      const body = JSON.parse(String(init.body));
      fake.calls.push({ path, query: searchParams.toString(), body });
      if (fake.hold) await fake.hold;
      let rows: unknown[];
      if (path === "credential_utxos") {
        const all = [...koiosPreprod.contract_utxos, ...(owned ? ownedUtxos : [])];
        rows = body._payment_credentials.includes(koiosPreprod.wallet_contract) ? all : [];
      } else if (path === "account_addresses") {
        rows = koiosPreprod.accounts[body._stake_addresses[0]]?.account_addresses ?? [];
      } else if (path === "account_utxos") {
        rows = koiosPreprod.accounts[body._stake_addresses[0]]?.account_utxos ?? [];
      } else {
        return new Response("not found", { status: 404 });
      }
      const offset = Number(searchParams.get("offset") ?? 0);
      const limit = Number(searchParams.get("limit") ?? 1000);
      return Response.json(rows.slice(offset, offset + limit));
    },
  };
  return fake;
}

/** A wallet plus a balance service over the fake Koios. */
export function testBalances(options?: { owned?: boolean }) {
  const t = testWallet();
  const koios = fakeKoios(options);
  const balances = new BalanceService({
    wasm: loadTestWasm(),
    wallet: t.wallet,
    session: t.session,
    koios: () => new Koios("https://preprod.koios.rest/api/v1", koios.fetch, async () => undefined),
    now: () => t.clock.now,
  });
  return { ...t, koios, balances };
}
