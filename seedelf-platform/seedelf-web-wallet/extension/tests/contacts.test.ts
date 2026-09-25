// The private store (records sealed on the device under a key from the
// phrase) and the contacts kept in it.
import { describe, expect, it } from "vitest";

import { PRIVATE_PREFIX, PrivateStore } from "../src/background/private-store";
import { testBalances, testWallet, transferPreprod, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const phrase = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;

async function unlocked(words = 12) {
  const t = testBalances();
  await t.wallet.create(phrase(words).phrase, PASSWORD);
  return t;
}

describe("the private store", () => {
  it("seals a record on the device: unreadable in storage, and while locked", async () => {
    const t = await unlocked();
    await t.store.set("contacts", [{ name: "Alice" }]);
    expect(await t.store.get("contacts")).toEqual([{ name: "Alice" }]);
    expect(JSON.stringify([...t.local.data])).not.toContain("Alice");

    await t.wallet.lock();
    await expect(t.store.get("contacts")).rejects.toThrow("locked");
    await t.wallet.unlock(PASSWORD);
    expect(await t.store.get("contacts")).toEqual([{ name: "Alice" }]);
  });

  it("is unreadable to a wallet with another phrase, and deleted with the wallet", async () => {
    const t = await unlocked();
    await t.store.set("contacts", [{ name: "Alice" }]);
    const sealed = await t.local.get(`${PRIVATE_PREFIX}contacts`);

    const other = testWallet();
    await other.wallet.create(phrase(24).phrase, PASSWORD);
    await other.local.set(`${PRIVATE_PREFIX}contacts`, sealed);
    expect(await new PrivateStore({ wallet: other.wallet, local: other.local }).get("contacts")).toBeUndefined();

    await t.wallet.reset();
    expect(await t.local.get(`${PRIVATE_PREFIX}contacts`)).toBeUndefined();
  });
});

describe("contacts", () => {
  const seedelf: string = transferPreprod.to;

  it("saves a Seedelf, a $handle and an address, checked without asking anyone", async () => {
    const t = await unlocked();
    const pasted = ` ${seedelf.slice(0, 32).toUpperCase()} ${seedelf.slice(32)} `;
    await t.contacts.save("preprod", { name: "Test Seedelf", value: pasted });
    await t.contacts.save("preprod", { name: "bob", value: "$Bob" });
    const list = await t.contacts.save("preprod", { name: "Alice", value: phrase(15).preprod.receive_0 });

    expect(list.map((c) => [c.name, c.kind, c.value])).toEqual([
      ["Alice", "address", phrase(15).preprod.receive_0],
      ["bob", "address", "$bob"],
      ["Test Seedelf", "seedelf", seedelf],
    ]);
    expect(t.koios.calls).toHaveLength(0);
  });

  it("explains what it won't save", async () => {
    const t = await unlocked();
    await expect(t.contacts.save("preprod", { name: " ", value: seedelf })).rejects.toThrow("Give the contact a name");
    await expect(t.contacts.save("preprod", { name: "x".repeat(41), value: seedelf })).rejects.toThrow("at most 40");
    await expect(t.contacts.save("preprod", { name: "Nope", value: "hello" })).rejects.toThrow("isn't a Seedelf's full name");
    await expect(t.contacts.save("preprod", { name: "Nope", value: "$no spaces" })).rejects.toThrow("ADA Handle");
    // A preprod address isn't one a mainnet wallet can pay.
    await expect(t.contacts.save("mainnet", { name: "Alice", value: phrase(15).preprod.receive_0 })).rejects.toThrow(
      "isn't a Seedelf's full name",
    );
    await t.contacts.save("preprod", { name: "Test", value: seedelf });
    await expect(t.contacts.save("preprod", { name: "Again", value: seedelf })).rejects.toThrow("already saved, as Test");
  });

  it("renames, re-points and removes a contact, one network at a time", async () => {
    const t = await unlocked();
    const [first] = await t.contacts.save("preprod", { name: "Test", value: seedelf });
    const renamed = await t.contacts.save("preprod", { id: first!.id, name: "Renamed", value: "$carol" });
    expect(renamed).toEqual([{ id: first!.id, name: "Renamed", kind: "address", value: "$carol", network: "preprod" }]);
    expect(await t.contacts.list("mainnet")).toEqual([]);
    expect(await t.contacts.remove("preprod", first!.id)).toEqual([]);
  });
});
