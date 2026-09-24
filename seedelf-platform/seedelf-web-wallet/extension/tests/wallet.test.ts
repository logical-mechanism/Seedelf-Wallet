// The wallet state machine with the real WebAssembly module over in-memory
// chrome.storage fakes: create, restore, lock and unlock, the back-off,
// auto-lock, and a worker restart.
import { describe, expect, it } from "vitest";

import { VAULT_KEY } from "../src/background/vault";
import {
  AUTO_LOCK_MS,
  SESSION_ACTIVITY,
  SESSION_ENTROPY,
  UNLOCK_FAILURES,
  unlockBackoffMs,
} from "../src/background/wallet";
import { loadTestWasm, testWallet, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const cardano = vectors("cardano_account.json").filter((v) => v.account === 0);
const seedelf = vectors("seedelf_key_v1.json").filter((v) => v.account === 0);

describe("wallet", () => {
  it("starts with no wallet", async () => {
    const { wallet } = testWallet();
    expect(await wallet.state()).toBe("no-wallet");
    await expect(wallet.account("preprod")).rejects.toThrow("locked");
    await expect(wallet.unlock(PASSWORD)).rejects.toThrow("no wallet");
  });

  it("creates a wallet from a generated phrase and unlocks it", async () => {
    const { wallet, local, session, events } = testWallet();
    const phrase = loadTestWasm().generatePhrase();
    await wallet.create(phrase, PASSWORD);

    expect(await wallet.state()).toBe("unlocked");
    expect(events).toEqual({ changed: 1, alarm: "started" });
    const record = (await local.get<{ version: number; blob: string }>(VAULT_KEY))!;
    expect(record.version).toBe(1);
    expect(atob(record.blob).startsWith("SBV1")).toBe(true);
    // The vault holds entropy, never the words.
    expect(JSON.stringify([...local.data])).not.toContain(phrase.split(" ")[0]);
    expect(await session.get(SESSION_ENTROPY)).toBeTypeOf("string");

    const account = await wallet.account("preprod");
    expect(account.receiveAddress).toMatch(/^addr_test1q/);
    expect(account.stakeAddress).toMatch(/^stake_test1u/);
  });

  it("restores the vector phrases to their Lace-matching addresses and Seedelf keys", async () => {
    for (const v of cardano) {
      const { wallet } = testWallet();
      // Typed phrases are normalized.
      await wallet.create(`  ${v.phrase.toUpperCase()} `, PASSWORD);
      const preprod = await wallet.account("preprod");
      expect(preprod.receiveAddress).toBe(v.preprod.receive_0);
      expect(preprod.stakeAddress).toBe(v.preprod.stake);
      expect((await wallet.account("mainnet")).receiveAddress).toBe(v.mainnet.receive_0);
      const key = seedelf.find((s) => s.phrase === v.phrase);
      if (key) expect(preprod.seedelfPublicValue).toBe(key.public_value);
    }
  });

  it("refuses short passwords, bad phrases, and a second wallet", async () => {
    const { wallet, local } = testWallet();
    const [v] = cardano;
    await expect(wallet.create(v!.phrase, "too short")).rejects.toThrow("at least 12 characters");
    await expect(wallet.create("abandon abandon", PASSWORD)).rejects.toThrow("12, 15 or 24 words");
    expect(local.data.size).toBe(0);

    await wallet.create(v!.phrase, PASSWORD);
    await expect(wallet.create(v!.phrase, PASSWORD)).rejects.toThrow("already exists");
  });

  it("locks and unlocks with the password", async () => {
    const { wallet, session, events } = testWallet();
    const [v] = cardano;
    await wallet.create(v!.phrase, PASSWORD);

    await wallet.lock();
    expect(await wallet.state()).toBe("locked");
    expect(session.data.size).toBe(0);
    expect(events.alarm).toBe("stopped");
    await expect(wallet.account("preprod")).rejects.toThrow("locked");

    expect(await wallet.unlock(PASSWORD)).toEqual({ unlocked: true });
    expect(await wallet.state()).toBe("unlocked");
    expect(events.alarm).toBe("started");
    expect((await wallet.account("preprod")).receiveAddress).toBe(v!.preprod.receive_0);
  });

  it("backs off after wrong passwords, in the worker", async () => {
    const { wallet, local, clock } = testWallet();
    await wallet.create(cardano[0]!.phrase, PASSWORD);
    await wallet.lock();

    expect(await wallet.unlock("wrong password!")).toEqual({
      unlocked: false,
      wrongPassword: true,
      retryAfterMs: 1000,
    });
    // Too early: refused without even trying the password.
    clock.now += 400;
    expect(await wallet.unlock(PASSWORD)).toEqual({ unlocked: false, wrongPassword: false, retryAfterMs: 600 });
    expect(await wallet.retryAfterMs()).toBe(600);

    clock.now += 600;
    expect(await wallet.unlock("wrong again!!")).toMatchObject({ wrongPassword: true, retryAfterMs: 2000 });
    clock.now += 2000;
    expect(await wallet.unlock("and again!!!!")).toMatchObject({ wrongPassword: true, retryAfterMs: 4000 });
    expect(await local.get(UNLOCK_FAILURES)).toMatchObject({ count: 3 });

    // The right password after waiting resets the count.
    clock.now += 4000;
    expect(await wallet.unlock(PASSWORD)).toEqual({ unlocked: true });
    expect(await local.get(UNLOCK_FAILURES)).toBeUndefined();
  });

  it("uses Lace's back-off schedule", () => {
    expect([0, 1, 2, 3, 4, 6, 7, 8, 20].map(unlockBackoffMs)).toEqual([
      0, 1000, 2000, 4000, 8000, 32_000, 60_000, 60_000, 60_000,
    ]);
  });

  it("keeps the back-off across a worker restart and a clock that moves back", async () => {
    const first = testWallet();
    await first.wallet.create(cardano[0]!.phrase, PASSWORD);
    await first.wallet.lock();
    await first.wallet.unlock("wrong password!");

    const restarted = testWallet(first);
    expect(await restarted.wallet.retryAfterMs()).toBe(1000);
    first.clock.now -= 10 * 60_000;
    expect(await restarted.wallet.retryAfterMs()).toBe(1000);
  });

  it("comes back unlocked after a worker restart, from session storage", async () => {
    const first = testWallet();
    const [v] = cardano;
    await first.wallet.create(v!.phrase, PASSWORD);

    // A new Wallet over the same storage is a restarted worker: no keys in memory.
    const restarted = testWallet(first);
    expect(await restarted.wallet.state()).toBe("unlocked");
    expect((await restarted.wallet.account("preprod")).receiveAddress).toBe(v!.preprod.receive_0);
  });

  it("comes back locked after a browser restart, which clears session storage", async () => {
    const first = testWallet();
    await first.wallet.create(cardano[0]!.phrase, PASSWORD);
    first.session.data.clear();

    const restarted = testWallet(first);
    expect(await restarted.wallet.state()).toBe("locked");
    expect(await restarted.wallet.unlock(PASSWORD)).toEqual({ unlocked: true });
  });

  it("auto-locks after 15 minutes without activity", async () => {
    const { wallet, session, clock, events } = testWallet();
    await wallet.create(cardano[0]!.phrase, PASSWORD);

    clock.now += AUTO_LOCK_MS - 1000;
    await wallet.touch();
    expect(await session.get(SESSION_ACTIVITY)).toBe(clock.now);
    clock.now += AUTO_LOCK_MS - 1000;
    expect(await wallet.state()).toBe("unlocked");

    clock.now += 1000;
    expect(await wallet.state()).toBe("locked");
    expect(session.data.size).toBe(0);
    expect(events).toEqual({ changed: 2, alarm: "stopped" });
  });

  it("a restarted worker past the deadline locks instead of unlocking", async () => {
    const first = testWallet();
    await first.wallet.create(cardano[0]!.phrase, PASSWORD);
    first.clock.now += AUTO_LOCK_MS;

    const restarted = testWallet(first);
    expect(await restarted.wallet.state()).toBe("locked");
    expect(first.session.data.size).toBe(0);
  });

  it("touch does nothing while locked", async () => {
    const { wallet, session } = testWallet();
    await wallet.create(cardano[0]!.phrase, PASSWORD);
    await wallet.lock();
    await wallet.touch();
    expect(session.data.size).toBe(0);
  });

  it("serializes concurrent unlock attempts, so the back-off can't be raced", async () => {
    const { wallet } = testWallet();
    await wallet.create(cardano[0]!.phrase, PASSWORD);
    await wallet.lock();
    const results = await Promise.all([
      wallet.unlock("wrong password 1"),
      wallet.unlock("wrong password 2"),
      wallet.unlock(PASSWORD),
    ]);
    expect(results).toEqual([
      { unlocked: false, wrongPassword: true, retryAfterMs: 1000 },
      { unlocked: false, wrongPassword: false, retryAfterMs: 1000 },
      { unlocked: false, wrongPassword: false, retryAfterMs: 1000 },
    ]);
  });

  it("reset deletes the vault", async () => {
    const { wallet, local, session } = testWallet();
    await wallet.create(cardano[0]!.phrase, PASSWORD);
    await wallet.lock();
    await wallet.unlock("wrong password!");
    await wallet.reset();
    expect(await wallet.state()).toBe("no-wallet");
    expect(local.data.size).toBe(0);
    expect(session.data.size).toBe(0);
    // A new wallet can be created afterwards.
    await wallet.create(cardano[1]!.phrase, PASSWORD);
    expect(await wallet.state()).toBe("unlocked");
  });
});
