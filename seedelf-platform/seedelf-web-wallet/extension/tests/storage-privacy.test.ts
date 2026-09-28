// What the device's storage shows without the password (privacy review
// §3.13): a sealed record's size says little of what it holds, the vault
// carries no creation time, ADA's price and its time stay off the disk, and
// Remove wallet takes the caches with it.
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";

import { LOCAL_NETWORK } from "../src/background/preferences";
import { LOCAL_PRICES } from "../src/background/prices";
import { PAD_MIN_BYTES, PRIVATE_PREFIX, PrivateStore } from "../src/background/private-store";
import { LOCAL_POOLS_PREFIX } from "../src/background/staking";
import { fromBase64, toBase64 } from "../src/background/storage";
import { VAULT_KEY } from "../src/background/vault";
import { LOCAL_CACHES } from "../src/background/wallet";
import { OPEN_IN } from "../src/shared/open-in";
import { testWallet, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const TAG = 16;
const phrase = () => vectors("cardano_account.json")[0]!.phrase;

async function unlocked() {
  const t = testWallet();
  await t.wallet.create(phrase(), PASSWORD);
  return { ...t, store: new PrivateStore({ wallet: t.wallet, local: t.local }) };
}

/** The sealed bytes' length: the padded JSON's, plus the tag. */
async function sealedLength(t: Awaited<ReturnType<typeof unlocked>>, name: string): Promise<number> {
  return fromBase64((await t.local.get<{ data: string }>(PRIVATE_PREFIX + name))!.data).length;
}

describe("a sealed record", () => {
  it("is padded: 1 KiB at least, then the next power of two, whatever it holds", async () => {
    const t = await unlocked();
    await t.store.set("lovejoin.mainnet", { chains: [] });
    expect(await sealedLength(t, "lovejoin.mainnet")).toBe(PAD_MIN_BYTES + TAG);
    await t.store.set("lovejoin.mainnet", { chains: ["x".repeat(500)] });
    expect(await sealedLength(t, "lovejoin.mainnet")).toBe(PAD_MIN_BYTES + TAG);
    await t.store.set("lovejoin.mainnet", { chains: ["x".repeat(1500)] });
    expect(await sealedLength(t, "lovejoin.mainnet")).toBe(2 * PAD_MIN_BYTES + TAG);
    await t.store.set("lovejoin.mainnet", { chains: ["x".repeat(5000)] });
    expect(await sealedLength(t, "lovejoin.mainnet")).toBe(8 * PAD_MIN_BYTES + TAG);
    // It reads as it was written.
    expect(await t.store.get("lovejoin.mainnet")).toEqual({ chains: ["x".repeat(5000)] });
    await t.store.set("maybeSent.mainnet", null);
    expect(await t.store.get("maybeSent.mainnet")).toBeNull();
  });

  it("sealed before padding still reads", async () => {
    const t = await unlocked();
    // Sealed as earlier versions did: the bare JSON, bound to its name.
    const sealed = await t.wallet.withStoreKey((key) => {
      const nonce = randomBytes(24);
      const aad = new TextEncoder().encode(`${PRIVATE_PREFIX}contacts`);
      const data = xchacha20poly1305(key, nonce, aad).encrypt(new TextEncoder().encode(JSON.stringify([{ name: "Alice" }])));
      return { v: 1, nonce: toBase64(nonce), data: toBase64(data) };
    });
    await t.local.set(`${PRIVATE_PREFIX}contacts`, sealed);
    expect(await t.store.get("contacts")).toEqual([{ name: "Alice" }]);
  });
});

describe("the vault", () => {
  it("carries no creation time, and an older one's goes at the next password change", async () => {
    const t = await unlocked();
    expect(Object.keys((await t.local.get<object>(VAULT_KEY))!).sort()).toEqual(["blob", "version"]);

    const vault = (await t.local.get<object>(VAULT_KEY))!;
    await t.local.set(VAULT_KEY, { ...vault, createdAt: 1_700_000_000_000 });
    await t.wallet.changePassword(PASSWORD, "a new long passphrase");
    expect(await t.local.get(VAULT_KEY)).not.toHaveProperty("createdAt");
    await t.wallet.lock();
    expect(await t.wallet.unlock("a new long passphrase")).toEqual({ unlocked: true });
  });
});

describe("Remove wallet", () => {
  it("deletes the pool list and a price kept on the disk before, and keeps where the wallet opens and its network", async () => {
    // The caches it names are the ones those modules keep.
    expect([...LOCAL_CACHES].sort()).toEqual([`${LOCAL_POOLS_PREFIX}mainnet`, `${LOCAL_POOLS_PREFIX}preprod`, LOCAL_PRICES].sort());
    const t = await unlocked();
    for (const key of LOCAL_CACHES) await t.local.set(key, { updatedAt: 1 });
    await t.local.set(LOCAL_NETWORK, "mainnet");
    await t.local.set(OPEN_IN, "tab");
    await t.wallet.reset();
    expect([...t.local.data.keys()].sort()).toEqual([LOCAL_NETWORK, OPEN_IN].sort());
  });
});
