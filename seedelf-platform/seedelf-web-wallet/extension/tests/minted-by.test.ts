// Remove a Seedelf defaults to the side that paid for it (privacy review
// §3.2): a mint keeps who paid, sealed, and a Seedelf found without that
// record is worked out from what the wallet already holds, never by asking
// Koios about its mint. When nothing says, Remove chooses nothing.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { Koios, type KoiosUtxo } from "../src/background/koios";
import { MintService } from "../src/background/mint";
import { mintedBy, paidByOf, rememberMint } from "../src/background/minted-by";
import { PRIVATE_PREFIX } from "../src/background/private-store";
import type { SeedelfInfo } from "../src/shared/rpc";
import { removeNote, RemoveSeedelf } from "../src/ui/screens/RemoveSeedelf";
import { accountMintPreprod, koiosPreprod, loadTestWasm, ownedUtxos, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const phrase12 = () => vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;

async function unlocked() {
  const t = testBalances();
  await t.wallet.create(phrase12().phrase, PASSWORD);
  return t;
}

/** The fixture's Seedelf ("web-wallet"): its UTxO, and its name. */
const seedelfUtxo = ownedUtxos[2]!;
const SEEDELF = seedelfUtxo.asset_list![0]!.asset_name;

describe("who paid for a Seedelf", () => {
  const nothing = { recorded: {}, owned: [seedelfUtxo], account: [], accountTxs: new Set<string>() };

  it("is the record's, when the mint was sent from here", () => {
    expect(paidByOf(seedelfUtxo, SEEDELF, { ...nothing, recorded: { [SEEDELF]: "seedelf" } })).toBe("seedelf");
    expect(paidByOf(seedelfUtxo, SEEDELF, { ...nothing, recorded: { [SEEDELF]: "account" } })).toBe("account");
  });

  it("is the private balance when the mint's change is one of the wallet's contract UTxOs", () => {
    const change = { ...ownedUtxos[0]!, tx_hash: seedelfUtxo.tx_hash, tx_index: seedelfUtxo.tx_index + 1 };
    expect(paidByOf(seedelfUtxo, SEEDELF, { ...nothing, owned: [seedelfUtxo, change] })).toBe("seedelf");
  });

  it("is the public account when the mint's change is at the account, or its Activity lists the mint", () => {
    expect(paidByOf(seedelfUtxo, SEEDELF, { ...nothing, account: [{ tx_hash: seedelfUtxo.tx_hash }] })).toBe("account");
    expect(paidByOf(seedelfUtxo, SEEDELF, { ...nothing, accountTxs: new Set([seedelfUtxo.tx_hash]) })).toBe("account");
  });

  it("isn't known otherwise: the Seedelf's own UTxO says nothing", () => {
    expect(paidByOf(seedelfUtxo, SEEDELF, nothing)).toBeUndefined();
  });
});

describe("a mint", () => {
  it("paid by the account keeps that, sealed, when it's sent", async () => {
    const t = await unlocked();
    t.koios.evaluation = accountMintPreprod.evaluation;
    const summary = await t.mint.build("preprod", "first", "account");
    expect(await mintedBy(t.store, "preprod")).toEqual({});
    await t.mint.submit("preprod", summary.txHash);
    expect(await mintedBy(t.store, "preprod")).toEqual({ [summary.tokenName]: "account" });
    expect(await mintedBy(t.store, "mainnet")).toEqual({});
    // Sealed: the token name isn't on the device in the clear.
    expect(JSON.stringify(await t.local.get(`${PRIVATE_PREFIX}mintedBy.preprod`))).not.toContain(summary.tokenName);
  });

  it("paid from the private balance keeps that", async () => {
    const t = await unlocked();
    const summary = await t.mint.build("preprod", "web-wallet", "seedelf");
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    const wasm = loadTestWasm();
    // Stands in for WebAssembly's signing, as mint.test.ts does.
    const service = new MintService({
      wasm: { ...wasm, signScriptSpend: (_key: unknown, r: string) => JSON.stringify({ txCbor: JSON.parse(r).txCbor, txHash: summary.txHash }) } as typeof wasm,
      wallet: t.wallet,
      session: t.session,
      koios: () => new Koios("https://preprod.koios.rest/api/v1", t.koios.fetch, async () => undefined),
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      now: () => t.clock.now,
      coins: t.coins,
      store: t.store,
    });
    await service.submit("preprod", summary.txHash);
    expect(await mintedBy(t.store, "preprod")).toEqual({ [summary.tokenName]: "seedelf" });
  });

  it("that isn't the one built isn't kept", async () => {
    const t = await unlocked();
    t.koios.evaluation = accountMintPreprod.evaluation;
    await t.mint.build("preprod", "first", "account");
    await expect(t.mint.submit("preprod", "00".repeat(32))).rejects.toThrow("isn't ready to send");
    expect(await mintedBy(t.store, "preprod")).toEqual({});
  });
});

describe("the balance reading", () => {
  const seedelfOf = async (t: Awaited<ReturnType<typeof unlocked>>) =>
    (await t.balances.get("preprod", true)).seedelf.seedelfs.find((s) => s.assetName === SEEDELF)!;

  it("says who paid for each Seedelf from the record, and asks Koios nothing more for it", async () => {
    const t = await unlocked();
    expect(await seedelfOf(t)).not.toHaveProperty("paidBy");
    const before = t.koios.calls.length;
    await rememberMint(t.store, "preprod", SEEDELF, "seedelf");
    expect(await seedelfOf(t)).toMatchObject({ paidBy: "seedelf" });
    // The same requests as any reading: nothing about the mint.
    expect(t.koios.calls.slice(before).map((c) => c.path)).not.toContain("tx_info");
    expect(t.koios.calls.slice(before).map((c) => c.path)).not.toContain("utxo_info");
  });

  it("finds a stealth mint by its change in the private balance, and an account-paid one by its change at the account", async () => {
    const t = await unlocked();
    t.koios.added.push({ ...ownedUtxos[0]!, tx_hash: seedelfUtxo.tx_hash, tx_index: 1 });
    expect(await seedelfOf(t)).toMatchObject({ paidBy: "seedelf" });

    const u = await unlocked();
    const template = koiosPreprod.accounts[phrase12().preprod.stake]!.account_utxos[0]!;
    const change: KoiosUtxo = { ...template, tx_hash: seedelfUtxo.tx_hash, tx_index: 1, block_height: 5_300_000 };
    u.koios.addedToAccounts.push(change);
    expect(await seedelfOf(u)).toMatchObject({ paidBy: "account" });
  });
});

describe("Remove a Seedelf", () => {
  const info = (paidBy?: SeedelfInfo["paidBy"]): SeedelfInfo => ({
    assetName: SEEDELF,
    label: "web-wallet",
    lovelace: "1500000",
    ...(paidBy ? { paidBy } : {}),
  });
  const form = (paidBy?: SeedelfInfo["paidBy"]) =>
    renderToStaticMarkup(createElement(RemoveSeedelf, { seedelf: info(paidBy), onCancel: () => undefined, onSent: () => undefined }));
  const pressed = (html: string) => [...html.matchAll(/aria-pressed="true"[^>]*>([^<]+)</g)].map((m) => m[1]);
  const review = (html: string) => html.match(/<button[^>]*type="submit"[^>]*>/)![0];

  it("starts on the side that paid for it", () => {
    expect(pressed(form("seedelf"))).toEqual(["Private balance"]);
    expect(pressed(form("account"))).toEqual(["Public account"]);
    expect(review(form("seedelf"))).not.toContain("disabled");
  });

  it("chooses nothing when the wallet doesn't know, and Review waits for a choice", () => {
    const html = form();
    expect(pressed(html)).toEqual([]);
    expect(review(html)).toContain("disabled");
    expect(html).toContain("doesn&#x27;t know who paid for this Seedelf");
  });

  it("says what each side links for this Seedelf, and warns where it's something new", () => {
    expect(removeNote("seedelf", "seedelf")).toMatchObject({ tone: "privacy", text: expect.stringContaining("links nothing new") });
    expect(removeNote("account", "account")).toMatchObject({ tone: "privacy", text: expect.stringContaining("links nothing new") });
    expect(removeNote("account", "seedelf")).toMatchObject({
      tone: "warn",
      text: expect.stringContaining("ties the account to the Seedelf's name, and through the mint to the private UTxOs"),
    });
    expect(removeNote("seedelf", "account")).toMatchObject({ tone: "warn", text: expect.stringContaining("Your public account paid") });
    expect(removeNote("account", undefined).text).toContain("links nothing new only if your public account paid for this Seedelf");
    expect(removeNote("seedelf", undefined).text).toContain("ties the Seedelf's name to the new UTxO");
  });
});
