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
import { removeNote, removeOption, RemoveSeedelf } from "../src/ui/screens/RemoveSeedelf";
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

  it("is the record's, when the mint was sent from here, and names the account that paid", () => {
    expect(paidByOf(seedelfUtxo, SEEDELF, { ...nothing, recorded: { [SEEDELF]: "seedelf" } })).toEqual({ side: "seedelf" });
    expect(paidByOf(seedelfUtxo, SEEDELF, { ...nothing, recorded: { [SEEDELF]: "account:2" } })).toEqual({
      side: "account",
      account: 2,
    });
    // The bare "account" wallets sealed before chunk 18 is account 0's: there was only one.
    expect(paidByOf(seedelfUtxo, SEEDELF, { ...nothing, recorded: { [SEEDELF]: "account" } })).toEqual({
      side: "account",
      account: 0,
    });
  });

  it("is the private balance when the mint's change is one of the wallet's contract UTxOs", () => {
    const change = { ...ownedUtxos[0]!, tx_hash: seedelfUtxo.tx_hash, tx_index: seedelfUtxo.tx_index + 1 };
    expect(paidByOf(seedelfUtxo, SEEDELF, { ...nothing, owned: [seedelfUtxo, change] })).toEqual({ side: "seedelf" });
  });

  it("is the public account when the mint's change is at the account, or its Activity lists the mint", () => {
    // What the wallet holds is the account it is working on, so the answer is that account's.
    expect(paidByOf(seedelfUtxo, SEEDELF, { ...nothing, account: [{ tx_hash: seedelfUtxo.tx_hash }], activeAccount: 1 })).toEqual({
      side: "account",
      account: 1,
    });
    expect(paidByOf(seedelfUtxo, SEEDELF, { ...nothing, accountTxs: new Set([seedelfUtxo.tx_hash]) })).toEqual({
      side: "account",
      account: 0,
    });
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
    expect(await mintedBy(t.store, "preprod")).toEqual({ [summary.tokenName]: "account:0" });
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
    await rememberMint(t.store, "preprod", SEEDELF, "seedelf", 0);
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
  // The chosen card: a radio, checked, and its label (chunk 23's review, V-4: cards, not a pill switch).
  const pressed = (html: string) =>
    [...html.matchAll(/role="radio" aria-checked="true".*?class="token-row__label">([^<]+)</g)].map((m) => m[1]);
  const review = (html: string) => html.match(/<button[^>]*type="submit"[^>]*>/)![0];

  it("starts on the side that paid for it", () => {
    expect(pressed(form("seedelf"))).toEqual(["Private balance"]);
    expect(pressed(form("account"))).toEqual(["Public account"]);
    expect(review(form("seedelf"))).not.toContain("disabled");
  });

  it("chooses nothing when the wallet doesn't know, and says which side is the safer guess (privacy review §3.2; chunk 23's second review, RX-3)", () => {
    // Either side can make a link the user didn't choose, so the wallet doesn't make it for them: Review waits.
    const html = form();
    expect(pressed(html)).toEqual([]);
    expect(review(html)).toContain("disabled");
    expect(html).toContain("doesn&#x27;t know who paid for this Seedelf");
    expect(html).toContain("If unsure, choose your private balance");
  });

  it("says in a line on each side's card what sending there links", () => {
    expect(removeOption("account", "account")).toContain("Links nothing new");
    expect(removeOption("seedelf", "seedelf")).toContain("Links nothing new");
    expect(removeOption("account", "seedelf")).toContain("Ties your public account to this Seedelf and the private money that paid for it");
    expect(removeOption("seedelf", "account")).toContain("to your public account through the Seedelf's name");
    // Not knowing who paid, neither card says it links nothing: each says when it would.
    expect(removeOption("account", undefined)).toBe("Links nothing new only if your public account paid for it");
    expect(removeOption("seedelf", undefined)).toBe("Links nothing new only if your private balance paid for it");
    expect(form("account")).toContain("Links nothing new: it paid for this Seedelf");
  });

  it("says what each side links for this Seedelf, and warns where it's something new", () => {
    expect(removeNote("seedelf", "seedelf")).toMatchObject({ tone: "privacy", text: expect.stringContaining("links nothing new") });
    expect(removeNote("account", "account")).toMatchObject({ tone: "privacy", text: expect.stringContaining("links nothing new") });
    expect(removeNote("account", "seedelf")).toMatchObject({
      tone: "warn",
      text: expect.stringContaining("ties the account to the Seedelf's name and the private UTxOs that paid"),
    });
    expect(removeNote("seedelf", "account")).toMatchObject({ tone: "warn", text: expect.stringContaining("Your public account paid") });
    // What each would link if the other side paid: when each links nothing new is on its card (removeOption).
    expect(removeNote("account", undefined).text).toContain("If your private balance paid for it, this ties your public account to the Seedelf's name");
    expect(removeNote("seedelf", undefined).text).toContain("If your public account paid for it, this ties the account to the new UTxO");
  });

  it("warns when another of the wallet's accounts paid for it (chunk 18)", () => {
    // The mint already links the Seedelf's name to the account that paid, so
    // sending the ADA to a different one lets anyone tie the two accounts
    // together through the name. The default would have done it quietly.
    const note = removeNote("account", "account", { paidByAccount: 1, active: 0, several: true });
    expect(note.tone).toBe("warn");
    expect(note.text).toContain("Account 2 paid for this Seedelf. Sending its ADA to Account 1");
    expect(note.text).toContain("lets anyone tie the two accounts together");
    expect(note.text).toContain("Switch to Account 2, or send it to your private balance");

    // On the account that paid, it links nothing new — and says which account that is.
    const same = removeNote("account", "account", { paidByAccount: 1, active: 1, several: true });
    expect(same.tone).toBe("privacy");
    expect(same.text).toContain("Account 2 paid for it, so this links nothing new");

    // With one account there is nothing to tell apart, so the wording stays as it was.
    expect(removeNote("account", "account", { paidByAccount: 0, active: 0, several: false }).text).toContain(
      "your public account paid for it, so this links nothing new",
    );
    // And the private balance is unaffected either way.
    expect(removeNote("seedelf", "seedelf", { paidByAccount: undefined, active: 1, several: true }).tone).toBe("privacy");
  });
});
