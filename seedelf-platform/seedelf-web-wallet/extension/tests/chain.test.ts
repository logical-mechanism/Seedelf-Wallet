// The pure chain helpers, against real preprod rows where possible.
import { describe, expect, it } from "vitest";

import { discoverChain, registerOf, seedelfLabel, seedelfTokenOf, sumValue } from "../src/background/chain";
import { CONTRACT_V1 } from "../src/background/balances";
import type { KoiosUtxo } from "../src/background/koios";
import { koiosPreprod, loadTestWasm, ownedUtxos } from "./fakes";

const base = koiosPreprod.contract_utxos[0]!;
const withDatum = (value: unknown): KoiosUtxo => ({ ...base, inline_datum: { bytes: "", value } });

describe("registerOf", () => {
  it("reads the register of every real preprod contract UTxO, and they're valid points", () => {
    const wasm = loadTestWasm();
    expect(koiosPreprod.contract_utxos).toHaveLength(25);
    for (const utxo of koiosPreprod.contract_utxos) {
      const hex = registerOf(utxo)!;
      expect(hex.generator).toMatch(/^[0-9a-f]{96}$/);
      const register = new wasm.Register(hex.generator, hex.publicValue);
      expect(wasm.isValidRegister(register)).toBe(true);
      register.free();
    }
  });

  it("skips anything that isn't a two-point register", () => {
    const [g, u] = [{ bytes: "ab".repeat(48) }, { bytes: "cd".repeat(48) }];
    expect(registerOf(withDatum({ constructor: 0, fields: [g, u] }))).toBeDefined();
    expect(registerOf({ ...base, inline_datum: null })).toBeUndefined();
    expect(registerOf(withDatum({ fields: [g, u] }))).toBeUndefined();
    expect(registerOf(withDatum({ constructor: 1, fields: [g, u] }))).toBeUndefined();
    expect(registerOf(withDatum({ constructor: 0, fields: [g, u, u] }))).toBeUndefined();
    expect(registerOf(withDatum({ constructor: 0, fields: [g, { bytes: "cd".repeat(47) }] }))).toBeUndefined();
    expect(registerOf(withDatum({ constructor: 0, fields: [g, { int: 1 }] }))).toBeUndefined();
    expect(registerOf(withDatum({ constructor: 0, fields: [g, { bytes: "CD".repeat(48) }] }))).toBeUndefined();
  });
});

describe("discoverChain", () => {
  const derive = (i: number) => `addr${i}`;

  it("looks at 20 addresses when none is used", () => {
    expect(discoverChain(new Set(), derive)).toEqual({ addresses: Array.from({ length: 20 }, (_, i) => `addr${i}`), used: 0 });
  });

  it("keeps going for 20 past the last used address", () => {
    const found = discoverChain(new Set(["addr0", "addr3", "addr23"]), derive);
    expect(found.used).toBe(3);
    expect(found.addresses).toHaveLength(44);
  });

  it("stops at a gap of 20, as other wallets do", () => {
    // 21 unused addresses between 0 and 22: 22 is past the gap.
    const found = discoverChain(new Set(["addr0", "addr22"]), derive);
    expect(found.used).toBe(1);
    expect(found.addresses.at(-1)).toBe("addr20");
  });
});

describe("sumValue", () => {
  it("adds lovelace and tokens exactly, merging the same token", () => {
    const token = (quantity: string) => ({ policy_id: "aa", asset_name: "01", quantity, decimals: 2, fingerprint: "asset1x" });
    const utxos = [
      { ...base, value: "9007199254740993", asset_list: [token("9007199254740993")] },
      { ...base, value: "7", asset_list: [token("1"), { ...token("5"), policy_id: "00" }] },
    ];
    const { lovelace, tokens } = sumValue(utxos);
    expect(lovelace).toBe(9007199254741000n);
    expect(tokens).toEqual([
      { policyId: "00", assetName: "01", quantity: "5", decimals: 2, fingerprint: "asset1x" },
      { policyId: "aa", assetName: "01", quantity: "9007199254740994", decimals: 2, fingerprint: "asset1x" },
    ]);
  });
});

describe("Seedelf names", () => {
  it("reads the personal tag, as in the README's examples", () => {
    expect(seedelfLabel("5eed0e1f5b416e6369656e744b72616b656e5d016ad73d1216555b07ad5a449ff2")).toBe("[AncientKraken]");
    expect(seedelfLabel("5eed0e1f00000acab00000018732122c62aea887cd16d743c3045e524f019aea")).toBeUndefined();
  });

  it("has no label for real preprod Seedelfs minted without a tag", () => {
    const names = koiosPreprod.contract_utxos
      .map((u) => seedelfTokenOf(u, CONTRACT_V1.seedelfPolicyId))
      .filter((n): n is string => !!n);
    expect(names.length).toBeGreaterThan(10);
    for (const name of names) expect(name).toMatch(/^5eed0e1f[0-9a-f]{56}$/);
    expect(names.map(seedelfLabel).filter(Boolean).length).toBeLessThan(names.length);
  });

  it("stops the tag at the index byte after a short tag", () => {
    const name = seedelfTokenOf(ownedUtxos[2]!, CONTRACT_V1.seedelfPolicyId)!;
    expect(seedelfLabel(name)).toBe("web-wallet");
  });
});
