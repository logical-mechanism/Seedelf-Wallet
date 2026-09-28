// The pure chain helpers, against real preprod rows where possible.
import { describe, expect, it } from "vitest";

import { discoverChain, registerOf, seedelfLabel, seedelfTokenOf, sumValue } from "../src/background/chain";
import { CONTRACT_V1 } from "../src/background/balances";
import type { KoiosUtxo } from "../src/background/koios";
import { koiosPreprod, loadTestWasm, ownedUtxos } from "./fakes";

const base = koiosPreprod.contract_utxos[0]!;
/** A row whose datum's CBOR is `bytes`, and whose JSON says what it likes: the register is read from the bytes. */
const withDatum = (bytes: string, value: unknown = null): KoiosUtxo => ({ ...base, inline_datum: { bytes, value } });

describe("registerOf", () => {
  it("reads the register of every real preprod contract UTxO, and they're valid points", () => {
    const wasm = loadTestWasm();
    expect(koiosPreprod.contract_utxos).toHaveLength(25);
    for (const utxo of [...koiosPreprod.contract_utxos, ...ownedUtxos]) {
      const hex = registerOf(utxo)!;
      expect(hex.generator).toMatch(/^[0-9a-f]{96}$/);
      // The register Koios's JSON of the same datum shows.
      const fields = (utxo.inline_datum!.value as { fields: Array<{ bytes: string }> }).fields.map((f) => f.bytes);
      expect([hex.generator, hex.publicValue]).toEqual(fields);
      const register = new wasm.Register(hex.generator, hex.publicValue);
      expect(wasm.isValidRegister(register)).toBe(true);
      register.free();
    }
  });

  // Constructor 0 holding two 48-byte fields, as seedelf-koios `register_of_datum` reads it.
  const [g, u] = ["ab".repeat(48), "cd".repeat(48)];
  const field = (hex: string) => `5830${hex}`;
  const register = { generator: g, publicValue: u };

  it("reads it from the datum's bytes, however the CBOR spells constructor 0 and its fields", () => {
    expect(registerOf(withDatum(`d8799f${field(g)}${field(u)}ff`))).toEqual(register); // an indefinite list, as the CLI writes
    expect(registerOf(withDatum(`d87982${field(g)}${field(u)}`))).toEqual(register); // a definite one
    expect(registerOf(withDatum(`d866820082${field(g)}${field(u)}`))).toEqual(register); // constructor 0's general form
    expect(registerOf(withDatum(`d9007982${field(g)}${field(u)}`))).toEqual(register); // a longer head than needed
    const chunked = `5f5818${g.slice(0, 48)}5818${g.slice(48)}ff`;
    expect(registerOf(withDatum(`d87982${chunked}${field(u)}`))).toEqual(register); // bytes in chunks
    expect(registerOf(withDatum(`D87982${field(g.toUpperCase())}${field(u)}`))).toEqual(register);
  });

  it("skips anything that isn't a two-point register", () => {
    expect(registerOf({ ...base, inline_datum: null })).toBeUndefined();
    for (const bytes of [
      "",
      "d879",
      `d87a82${field(g)}${field(u)}`, // constructor 1
      `d866820182${field(g)}${field(u)}`, // constructor 1's general form
      `d87983${field(g)}${field(u)}${field(u)}`, // three fields
      `d87981${field(g)}`, // one
      `d87982${field(g)}582f${"cd".repeat(47)}`, // 47 bytes
      `d87982${field(g)}5831${"cd".repeat(49)}`, // 49 bytes
      `d87982${field(g)}01`, // a number
      `d87982${field(g)}${field(u)}00`, // something after
      `d8799f${field(g)}${field(u)}`, // no break
      `d87982${field(g)}5f5818${u.slice(0, 48)}5819${u.slice(48)}00ff`, // chunks past 48 bytes
      `d87982${field(g)}5f5f5818${u.slice(0, 48)}ff5818${u.slice(48)}ff`, // a chunk that isn't whole
      `9f${field(g)}${field(u)}ff`, // no constructor
      "zz",
      "d8799",
    ]) {
      expect(registerOf(withDatum(bytes)), bytes).toBeUndefined();
    }
  });

  it("goes by the bytes, never the datum's JSON", () => {
    // Koios's JSON says a register, the datum itself constructor 1.
    const json = { constructor: 0, fields: [{ bytes: g }, { bytes: u }] };
    expect(registerOf(withDatum(`d87a82${field(g)}${field(u)}`, json))).toBeUndefined();
  });

  it("reads a datum nested a hundred thousand levels deep as no register, at once (launch review H4)", () => {
    const started = performance.now();
    expect(registerOf(withDatum(`${"81".repeat(100_000)}00`))).toBeUndefined();
    expect(registerOf(withDatum(`${"d879".repeat(50_000)}80`))).toBeUndefined();
    expect(registerOf(withDatum(`d8799f${"9f".repeat(100_000)}`))).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(1_000);
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
