// The service-worker handlers with the real WebAssembly module and the
// wallet over in-memory storage, checked against the same vectors as
// seedelf-crypto (Lace-verified Cardano addresses, frozen Seedelf keys).
import { describe, expect, it } from "vitest";

import { handle, type Context } from "../src/background/handlers";
import type { Account, Balances, Status, UnlockResult, UtxoLists } from "../src/shared/rpc";
import { isMessage } from "../src/shared/rpc";
import { loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";

function context(t = testBalances()): Context {
  const { wallet, balances, moveIn, mint, transfer, withdraw, send, pending, contacts, activity, coins, staking, preferences } =
    t;
  return {
    wasm: loadTestWasm(),
    wallet,
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
    version: "0.1.0",
    network: "preprod",
    networks: ["preprod"],
  };
}

describe("handlers", () => {
  it("reports status", async () => {
    expect(await handle({ type: "status" }, context())).toEqual({
      state: "no-wallet",
      version: "0.1.0",
      network: "preprod",
      networks: ["preprod"],
      retryAfterMs: 0,
    } satisfies Status);
  });

  it("generates 24-word phrases and serves the word list", async () => {
    const ctx = context();
    const { phrase } = (await handle({ type: "generate-phrase" }, ctx)) as { phrase: string };
    expect(phrase.split(" ")).toHaveLength(24);
    const words = (await handle({ type: "wordlist" }, ctx)) as string[];
    expect(words).toHaveLength(2048);
    expect(phrase.split(" ").every((w) => words.includes(w))).toBe(true);
  });

  it("restores, locks and unlocks through the RPC", async () => {
    const ctx = context();
    const v = vectors("cardano_account.json").find((v) => v.account === 0)!;
    const key = vectors("seedelf_key_v1.json").find((k) => k.phrase === v.phrase && k.account === 0)!;

    const restored = (await handle({ type: "restore-wallet", phrase: v.phrase, password: PASSWORD }, ctx)) as Status;
    expect(restored.state).toBe("unlocked");
    expect(await handle({ type: "account" }, ctx)).toEqual({
      receiveAddress: v.preprod.receive_0,
      stakeAddress: v.preprod.stake,
      seedelfPublicValue: key.public_value,
    } satisfies Account);
    expect(await handle({ type: "activity" }, ctx)).toBeNull();

    expect(((await handle({ type: "lock" }, ctx)) as Status).state).toBe("locked");
    await expect(handle({ type: "account" }, ctx)).rejects.toThrow("locked");

    const wrong = (await handle({ type: "unlock", password: "not the password" }, ctx)) as UnlockResult;
    expect(wrong).toEqual({ unlocked: false, wrongPassword: true, retryAfterMs: 1000 });
    const status = (await handle({ type: "status" }, ctx)) as Status;
    expect(status.state).toBe("locked");
    expect(status.retryAfterMs).toBeGreaterThan(0);
  });

  it("creates a wallet and resets it", async () => {
    const ctx = context();
    const { phrase } = (await handle({ type: "generate-phrase" }, ctx)) as { phrase: string };
    expect(((await handle({ type: "create-wallet", phrase, password: PASSWORD }, ctx)) as Status).state).toBe(
      "unlocked",
    );
    expect(((await handle({ type: "reset-wallet" }, ctx)) as Status).state).toBe("no-wallet");
  });

  it("validates typed phrases with the Rust core's reason", async () => {
    const ctx = context();
    const v = vectors("cardano_account.json")[0]!;
    expect(await handle({ type: "validate-phrase", phrase: ` ${v.phrase.toUpperCase()} ` }, ctx)).toBeNull();
    await expect(handle({ type: "validate-phrase", phrase: "abandon abandon" }, ctx)).rejects.toThrow(
      "12, 15 or 24 words, got 2",
    );
    const swapped = v.phrase.split(" ").reverse().join(" ");
    await expect(handle({ type: "validate-phrase", phrase: swapped }, ctx)).rejects.toThrow("checksum");
  });

  it("reads balances once unlocked", async () => {
    const ctx = context();
    await expect(handle({ type: "balances" }, ctx)).rejects.toThrow("locked");
    const v = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
    await handle({ type: "restore-wallet", phrase: v.phrase, password: PASSWORD }, ctx);
    const b = (await handle({ type: "balances", refresh: true }, ctx)) as Balances;
    expect(b.network).toBe("preprod");
    expect(b.seedelf.seedelfs.map((s) => s.label)).toEqual(["web-wallet"]);
  });

  it("refreshes UTxOs and the Seedelf history with a balance reading; opening them reads nothing", async () => {
    const t = testBalances();
    const ctx = context(t);
    const v = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
    await handle({ type: "restore-wallet", phrase: v.phrase, password: PASSWORD }, ctx);
    const first = (await handle({ type: "balances" }, ctx)) as Balances;
    const reads = () => t.koios.calls.length;
    const before = reads();

    const lists = (await handle({ type: "utxos" }, ctx)) as UtxoLists;
    const history = (await handle({ type: "history", of: "seedelf" }, ctx)) as { updatedAt?: number };
    expect(lists.updatedAt).toBe(first.updatedAt);
    expect(history.updatedAt).toBe(first.updatedAt);
    expect(reads()).toBe(before);

    t.clock.now += 60_000;
    const fresh = (await handle({ type: "utxos", refresh: true }, ctx)) as UtxoLists;
    expect(fresh.updatedAt).toBe(t.clock.now);
    expect(reads()).toBe(before + 4);
    t.clock.now += 60_000;
    const again = (await handle({ type: "history", of: "seedelf", refresh: true }, ctx)) as { updatedAt?: number };
    expect(again.updatedAt).toBe(t.clock.now);
    expect(reads()).toBe(before + 8);
  });

  it("recognizes only known requests", () => {
    expect(isMessage({ type: "unlock", password: "x" })).toBe(true);
    expect(isMessage({ type: "mint-build", label: "" })).toBe(true);
    expect(isMessage({ type: "mint-submit", txHash: "ab" })).toBe(true);
    expect(isMessage({ type: "transfer-lookup", to: "5eed0e1f" })).toBe(true);
    expect(isMessage({ type: "transfer-build", to: "", lovelace: "1", tokens: [] })).toBe(true);
    expect(isMessage({ type: "transfer-submit", txHash: "ab" })).toBe(true);
    for (const type of [
      "resolve-destination",
      "withdraw-build",
      "withdraw-submit",
      "remove-build",
      "remove-submit",
      "send-build",
      "send-submit",
    ]) {
      expect(isMessage({ type })).toBe(true);
    }
    expect(isMessage({ type: "preview" })).toBe(false);
    expect(isMessage({ event: "state-changed" })).toBe(false);
    expect(isMessage(null)).toBe(false);
  });
});
