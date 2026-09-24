// The service-worker handlers with the real WebAssembly module, checked
// against the same vectors as seedelf-crypto (Lace-verified Cardano
// addresses, frozen Seedelf keys).
import { readFileSync } from "node:fs";

import * as wasm from "@seedelf/wasm";
import { beforeAll, describe, expect, it } from "vitest";

import { handle, type Context } from "../src/background/handlers";
import type { Preview, Status } from "../src/shared/rpc";

const vectors = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../../seedelf-crypto/tests/vectors/${name}`, import.meta.url), "utf8"),
  ).vectors as Array<Record<string, any>>;

const context = (network: Context["network"] = "preprod"): Context => ({
  wasm,
  version: "0.1.0",
  network,
  networks: ["preprod"],
});

beforeAll(() => {
  wasm.initSync({
    module: readFileSync(new URL("../../wasm/pkg/seedelf_wasm_bg.wasm", import.meta.url)),
  });
});

describe("handlers", () => {
  it("reports status", async () => {
    const status = (await handle({ type: "status" }, context())) as Status;
    expect(status).toEqual({ version: "0.1.0", network: "preprod", networks: ["preprod"] });
  });

  it("derives Lace-matching addresses for a typed phrase", async () => {
    for (const v of vectors("cardano_account.json").filter((v) => v.account === 0)) {
      for (const network of ["preprod", "mainnet"] as const) {
        const p = (await handle({ type: "preview", phrase: `  ${v.phrase}  ` }, context(network))) as Preview;
        expect(p.generated).toBe(false);
        expect(p.phrase).toBe(v.phrase);
        expect(p.receiveAddress).toBe(v[network].receive_0);
        expect(p.changeAddress).toBe(v[network].change_0);
        expect(p.stakeAddress).toBe(v[network].stake);
      }
    }
  });

  it("derives the frozen Seedelf key", async () => {
    for (const v of vectors("seedelf_key_v1.json").filter((v) => v.account === 0)) {
      const p = (await handle({ type: "preview", phrase: v.phrase }, context())) as Preview;
      expect(p.seedelfPublicValue).toBe(v.public_value);
    }
  });

  it("generates a 24-word phrase when none is given", async () => {
    const p = (await handle({ type: "preview" }, context())) as Preview;
    expect(p.generated).toBe(true);
    expect(p.phrase.split(" ")).toHaveLength(24);
    expect(p.receiveAddress).toMatch(/^addr_test1q/);
  });

  it("rejects a bad phrase with a reason", async () => {
    await expect(handle({ type: "preview", phrase: "abandon abandon" }, context())).rejects.toThrow(
      /12, 15 or 24 words/,
    );
  });
});
