// Remove a Seedelf defaults to the side that paid for it (privacy review
// §3.2): a mint keeps who paid, sealed, and a Seedelf found without that
// record is worked out from what the wallet already holds, never by asking
// Koios about its mint. When nothing says, Remove chooses nothing.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SESSION_ACCOUNT_ADDRESSES_PREFIX, type AccountAddresses } from "../src/background/activity";
import { CONTRACT_V1 } from "../src/background/balances";
import { registerOf } from "../src/background/chain";
import { Collateral } from "../src/background/collateral";
import { Koios, type KoiosTxInfo, type KoiosUtxo } from "../src/background/koios";
import { MintService } from "../src/background/mint";
import {
  clearRemoved,
  forgetRegisters,
  mintedAt,
  mintedBy,
  paidByOf,
  rememberMint,
  rememberRegister,
  removedHere,
} from "../src/background/minted-by";
import { PRIVATE_PREFIX } from "../src/background/private-store";
import { DEFAULT_PREFERENCES } from "../src/shared/preferences";
import type { KnownAccount, SeedelfInfo } from "../src/shared/rpc";
import { AccountsContext } from "../src/ui/accounts";
import { PreferencesContext } from "../src/ui/preferences";
import { removeNote, removeOption, RemoveSeedelf } from "../src/ui/screens/RemoveSeedelf";
import { accountMintPreprod, activityPreprod, koiosPreprod, loadTestWasm, ownedUtxos, testBalances, vectors } from "./fakes";

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
  const nothing = { recorded: {}, owned: [seedelfUtxo], accountActivity: [] };

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

  it("is the public account only when its Activity lists the mint as one the account spent in (chunk 51, e6#1)", () => {
    // What the wallet holds is the account it is working on, so the answer is that account's. An entry has a fee only
    // where an input of the transaction is under the account's payment keys, which takes the account's signature.
    const spentIn = [{ txHash: seedelfUtxo.tx_hash, fee: "200000" }];
    expect(paidByOf(seedelfUtxo, SEEDELF, { ...nothing, accountActivity: spentIn, activeAccount: 1 })).toEqual({
      side: "account",
      account: 1,
    });
    expect(paidByOf(seedelfUtxo, SEEDELF, { ...nothing, accountActivity: spentIn })).toEqual({ side: "account", account: 0 });
    // A transaction that only paid the account, its entry with no fee of the account's: anyone can make one, minting a
    // Seedelf of their own under the user's register beside it. It says nothing of who paid for that Seedelf.
    expect(paidByOf(seedelfUtxo, SEEDELF, { ...nothing, accountActivity: [{ txHash: seedelfUtxo.tx_hash }] })).toBeUndefined();
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

describe("the registers a mint put its Seedelf under (the 1.10.0 gate's W12)", () => {
  const A = { generator: "a".repeat(96), publicValue: "b".repeat(96) };
  const B = { generator: "c".repeat(96), publicValue: "d".repeat(96) };

  it("are kept per network, each once, and forgotten for one Seedelf alone, as its Remove is sent, a mark of the removal left", async () => {
    const t = await unlocked();
    await rememberRegister(t.store, "preprod", "5eed01", A);
    await rememberRegister(t.store, "preprod", "5eed01", A);
    await rememberRegister(t.store, "preprod", "5eed02", B);
    expect(await mintedAt(t.store, "preprod")).toEqual({ "5eed01": [A], "5eed02": [B] });
    expect(await mintedAt(t.store, "mainnet")).toEqual({});
    // Its registers go; its name stays, with none: removed here (the 1.10.0 gate's f6).
    await forgetRegisters(t.store, "preprod", "5eed01");
    expect(await mintedAt(t.store, "preprod")).toEqual({ "5eed01": [], "5eed02": [B] });
    expect(removedHere(await mintedAt(t.store, "preprod"), "5eed01")).toBe(true);
    expect(removedHere(await mintedAt(t.store, "preprod"), "5eed02")).toBe(false);
    // One never kept (minted before 1.10.0, or turned on by hand): marked removed all the same.
    await forgetRegisters(t.store, "preprod", "5eed09");
    expect(await mintedAt(t.store, "preprod")).toEqual({ "5eed01": [], "5eed02": [B], "5eed09": [] });
    // The user's own turn-on lifts the mark, and only a mark.
    await clearRemoved(t.store, "preprod", "5eed01");
    await clearRemoved(t.store, "preprod", "5eed02");
    expect(await mintedAt(t.store, "preprod")).toEqual({ "5eed02": [B], "5eed09": [] });
  });

  it("say when their write is refused, never swallowing it: the caller decides (quota-outside#11)", async () => {
    const t = await unlocked();
    t.store.set = async () => {
      throw new Error("QUOTA_BYTES quota exceeded");
    };
    await expect(rememberRegister(t.store, "preprod", "5eed01", A)).rejects.toThrow(/quota/);
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

  it("finds a stealth mint by its change in the private balance, and an account-paid one by the account spending in it", async () => {
    const t = await unlocked();
    t.koios.added.push({ ...ownedUtxos[0]!, tx_hash: seedelfUtxo.tx_hash, tx_index: 1 });
    expect(await seedelfOf(t)).toMatchObject({ paidBy: "seedelf" });

    // Its change at the account says nothing: anyone's transaction can pay the account (chunk 51, e6#1).
    const u = await unlocked();
    const template = koiosPreprod.accounts[phrase12().preprod.stake]!.account_utxos[0]!;
    const change: KoiosUtxo = { ...template, tx_hash: seedelfUtxo.tx_hash, tx_index: 1, block_height: 5_300_000 };
    u.koios.addedToAccounts.push(change);
    expect(await seedelfOf(u)).not.toHaveProperty("paidBy");
    // Public activity listing the mint as one the account spent in does: only the account's signature makes that.
    const { keys } = (await u.session.get<AccountAddresses>(`${SESSION_ACCOUNT_ADDRESSES_PREFIX}preprod`))!;
    const top = activityPreprod.account_txs[0]!;
    const row = { tx_hash: seedelfUtxo.tx_hash, block_height: top.block_height + 1, block_time: top.block_time + 60 };
    u.koios.credentialTxs.set(keys[0]!, [row]);
    // Where each sits, as tx_info writes it: `cred` is its payment key or script hash.
    const mine = { bech32: template.address, cred: keys[0]! };
    const contract = { bech32: seedelfUtxo.address, cred: CONTRACT_V1.walletContractHash };
    u.koios.txRows.set(seedelfUtxo.tx_hash, {
      tx_hash: seedelfUtxo.tx_hash,
      block_height: row.block_height,
      tx_timestamp: row.block_time,
      fee: "250000",
      inputs: [{ payment_addr: mine, value: "20000000", asset_list: [] }],
      outputs: [
        { payment_addr: contract, value: seedelfUtxo.value, asset_list: [] },
        { payment_addr: mine, value: "17000000", asset_list: [] },
      ],
    } as KoiosTxInfo);
    const listed = (await u.activity.cardano("preprod")).entries.find((e) => e.txHash === seedelfUtxo.tx_hash);
    expect(listed).toHaveProperty("fee", "250000");
    expect(await seedelfOf(u)).toMatchObject({ paidBy: "account", paidByAccount: 0 });
  });
});

// Chunk 51, e6#1 (its trace verifier's test, moved here): a stranger can plant a Seedelf so Remove starts on the public
// account and says it "links nothing new". The mint policy at 5b82530 is open and checks no output, and every Seedelf's
// register is public through its name. So anyone can mint a Seedelf of their own under a fresh re-randomization of the
// user's register, and pay the user's public account 1 ₳ in the same transaction. The wallet lists that Seedelf as the
// user's. With no record of who paid, it took the stranger's payment to the account (a UTxO from the mint, or Public
// activity's "received" entry for it) for an account-paid mint's change (minted-by.ts paidByOf). Remove then started on
// the public account: "your public account paid for it, so this links nothing new". Sent there, the freed ADA shows
// that whoever holds the planted register (the stranger knows it's the owner of the user's Seedelf) holds the account.
//
// The right behaviour, which this asserts: a transaction that only paid the account says nothing about who paid for
// the Seedelf. So the wallet doesn't claim the account did, and Remove doesn't choose the public account for the user.
describe("a Seedelf a stranger minted under the user's register (chunk 51, e6#1)", () => {
  /** The stranger's minting transaction. */
  const T = "e6".repeat(32);
  const hexOf = (s: string) => Buffer.from(s, "ascii").toString("hex");
  /** The stranger's own Seedelf, named as the policy names one: prefix, tag, the first input's index and id, 32 bytes. */
  const GIFT = `5eed0e1f${hexOf("gift")}00${"5a".repeat(32)}`.slice(0, 64);

  /** Output 0 of T: the stranger's Seedelf and 1.5 ₳, under a fresh re-randomization of the user's register. */
  function planted(): KoiosUtxo {
    const wasm = loadTestWasm();
    const found = registerOf(seedelfUtxo)!;
    const base = new wasm.Register(found.generator, found.publicValue);
    const fresh = wasm.rerandomize(base);
    const datum = `d8799f5830${fresh.generator}5830${fresh.publicValue}ff`;
    base.free();
    fresh.free();
    return {
      ...seedelfUtxo,
      tx_hash: T,
      tx_index: 0,
      value: "1500000",
      block_height: 5_300_000,
      inline_datum: { bytes: datum, value: null },
      asset_list: [{ ...seedelfUtxo.asset_list![0]!, asset_name: GIFT, fingerprint: "asset1strangersgift" }],
    };
  }

  /** Output 1 of T: 1 ₳ to the user's public account, at an address of it the stranger saw on chain. */
  function paidToAccount(): KoiosUtxo {
    const template = koiosPreprod.accounts[phrase12().preprod.stake]!.account_utxos[0]!;
    return { ...template, tx_hash: T, tx_index: 1, value: "1000000", asset_list: [], block_height: 5_300_000 };
  }

  const out = (bech32: string, cred: string, value: string, asset_list: KoiosTxInfo["outputs"][number]["asset_list"] = []) => ({
    payment_addr: { bech32, cred },
    value,
    asset_list,
  });

  /** T as Koios lists it: the stranger's coin in; their Seedelf at the contract and 1 ₳ to the account out. */
  const mintTx = (key: string, row: { block_height: number; block_time: number }): KoiosTxInfo => ({
    tx_hash: T,
    block_height: row.block_height,
    tx_timestamp: row.block_time,
    fee: "250000",
    inputs: [out("addr_test1_stranger", "57".repeat(28), "10000000")],
    outputs: [
      out(seedelfUtxo.address, CONTRACT_V1.walletContractHash, "1500000", [
        { policy_id: CONTRACT_V1.seedelfPolicyId, asset_name: GIFT, quantity: "1" },
      ]),
      out("addr_test1_mine", key, "1000000"),
    ],
  });

  /** The Remove form for `seedelf`, as Home opens it: the card it starts on, and what it says. */
  function removeForm(seedelf: SeedelfInfo) {
    const html = renderToStaticMarkup(createElement(RemoveSeedelf, { seedelf, onCancel: () => undefined, onSent: () => undefined })).replaceAll(
      "&#x27;",
      "'",
    );
    const checked = [...html.matchAll(/role="radio" aria-checked="true".*?class="token-row__label">([^<]+)</g)].map((m) => m[1]);
    return { html, checked };
  }

  it("isn't taken for one the public account paid for, so Remove doesn't start on the account saying it links nothing new", async () => {
    // The stranger's 1 ₳ still at the account.
    const t = testBalances();
    await t.wallet.create(phrase12().phrase, PASSWORD);
    t.koios.added.push(planted());
    t.koios.addedToAccounts.push(paidToAccount());
    const gift = (await t.balances.get("preprod", true)).seedelf.seedelfs.find((s) => s.assetName === GIFT);
    // The wallet lists it as the user's: its register is theirs.
    expect(gift).toMatchObject({ assetName: GIFT, label: "gift", lovelace: "1500000" });
    // Nothing on the device says who paid for it: no record, and none of the account's money went into T.
    expect.soft(gift, "who paid, from a UTxO the stranger's payment left at the account").not.toHaveProperty("paidBy");
    const form = removeForm(gift!);
    expect.soft(form.checked, "the card Remove starts on").not.toContain("Public account");
    expect.soft(form.html).not.toContain("your public account paid for it, so this links nothing new");
    expect.soft(form.html).not.toContain("Links nothing new: it paid for this Seedelf");
    // It says it doesn't know who paid, and waits for the user's choice (privacy review §3.2).
    expect.soft(form.html).toContain("doesn't know who paid for this Seedelf");

    // The 1 ₳ spent since, and Public activity listing T as what it is: a payment received.
    const u = testBalances();
    await u.wallet.create(phrase12().phrase, PASSWORD);
    u.koios.added.push(planted());
    await u.balances.get("preprod");
    const { keys } = (await u.session.get<AccountAddresses>(`${SESSION_ACCOUNT_ADDRESSES_PREFIX}preprod`))!;
    const top = activityPreprod.account_txs[0]!;
    const row = { tx_hash: T, block_height: top.block_height + 1, block_time: top.block_time + 60 };
    u.koios.credentialTxs.set(keys[0]!, [row]);
    u.koios.txRows.set(T, mintTx(keys[0]!, row));
    const listed = (await u.activity.cardano("preprod")).entries.find((e) => e.txHash === T);
    // The account spent nothing in it: received, and no fee of its own.
    expect(listed).toMatchObject({ kind: "received", direction: "in", lovelace: "1000000" });
    expect(listed).not.toHaveProperty("fee");
    const again = (await u.balances.get("preprod", true)).seedelf.seedelfs.find((s) => s.assetName === GIFT);
    expect(again).toMatchObject({ assetName: GIFT });
    expect.soft(again, "who paid, from Public activity's received entry for the stranger's mint").not.toHaveProperty("paidBy");
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

  /** The form as the wallet shows it: on account `active` of `known`, with the balances hidden or not. */
  const page = (seedelf: SeedelfInfo, known: KnownAccount[], active: number, hideBalances = false) => {
    const several = known.length > 1;
    const accounts = { accounts: known, active, loaded: true, name: "", several, reload: async () => {} };
    const prefs = { prefs: { ...DEFAULT_PREFERENCES, hideBalances }, loaded: true, set: async () => undefined };
    return renderToStaticMarkup(
      createElement(
        AccountsContext.Provider,
        { value: accounts },
        createElement(
          PreferencesContext.Provider,
          { value: prefs },
          createElement(RemoveSeedelf, { seedelf, onCancel: () => undefined, onSent: () => undefined }),
        ),
      ),
    ).replaceAll("&#x27;", "'");
  };
  /** Each card's label and line, the checked one first. */
  const cards = (html: string) =>
    [...html.matchAll(/aria-checked="(true|false)".*?<\/button>/g)]
      .map(([card, on]) => ({
        checked: on === "true",
        label: /token-row__label">([^<]+)/.exec(card)![1],
        line: /token-row__sub wrap">([^<]*)/.exec(card)?.[1],
      }))
      .sort((a, b) => Number(b.checked) - Number(a.checked));
  const NOTHING_NEW = "Links nothing new";

  it("says on the account's card, as the note under it does, that another account paying ties the two accounts", () => {
    // Account 1 paid (a bare "account" record from 1.1.0 reads so too), and the wallet is on Account 2: the card
    // that starts checked said "Links nothing new" right over the note's warning.
    const other = { paidByAccount: 0, active: 1, several: true };
    const ties = "Ties Account 2 to Account 1, which paid for this Seedelf";
    expect(removeOption("account", "account", other)).toBe(ties);
    // On the account that paid, or with one account, nothing new is linked, as before.
    expect(removeOption("account", "account", { paidByAccount: 1, active: 1, several: true })).toContain(NOTHING_NEW);
    expect(removeOption("account", "account", { paidByAccount: 0, active: 0, several: false })).toContain(NOTHING_NEW);
    // The private balance's card is about the name, whichever account paid.
    expect(removeOption("seedelf", "account", other)).toBe(removeOption("seedelf", "account"));

    const html = page({ ...info("account"), paidByAccount: 0 }, [{ index: 0 }, { index: 1 }], 1);
    const [checked, rest] = cards(html);
    // Nothing starts checked where another account paid (the owner's call, 2026-10-06).
    expect(checked).toEqual({ checked: false, label: "Public account", line: ties });
    expect(rest).toMatchObject({ checked: false, label: "Private balance" });
    expect(html).toContain("Account 1 paid for this Seedelf. Sending its ADA to Account 2 lets anyone tie");
    expect(html).not.toContain(NOTHING_NEW);
  });

  it("names a renamed account as the picker shows it, its number first", () => {
    // The picker and Settings show "Savings" and "Business", never their numbers: "Switch to Account 1" named no
    // choice on screen.
    const known = [{ index: 0, name: "Savings" }, { index: 1 }, { index: 2, name: "Business" }];
    const other = removeNote("account", "account", { paidByAccount: 0, active: 2, several: true, known });
    expect(other.text).toContain("Account 1 · Savings paid for this Seedelf. Sending its ADA to Account 3 · Business");
    expect(other.text).toContain("Switch to Account 1 · Savings, or send it to your private balance");
    expect(removeOption("account", "account", { paidByAccount: 0, active: 2, several: true, known })).toBe(
      "Ties Account 3 · Business to Account 1 · Savings, which paid for this Seedelf",
    );
    expect(removeNote("account", "account", { paidByAccount: 0, active: 0, several: true, known }).text).toContain(
      "Account 1 · Savings paid for it, so this links nothing new",
    );
    // An unnamed one, or one not listed, keeps its number alone.
    expect(removeNote("account", "account", { paidByAccount: 1, active: 2, several: true, known }).text).toContain(
      "Account 2 paid for this Seedelf. Sending its ADA to Account 3 · Business",
    );
    expect(removeNote("account", "account", { paidByAccount: 5, active: 0, several: true, known }).text).toContain(
      "Account 6 paid for this Seedelf. Sending its ADA to Account 1 · Savings",
    );

    const html = page({ ...info("account"), paidByAccount: 0 }, known, 2);
    expect(cards(html)[0]!.line).toBe("Ties Account 3 · Business to Account 1 · Savings, which paid for this Seedelf");
    expect(html).toContain("Switch to Account 1 · Savings");
  });

  it("hides what's locked with it while balances are hidden, as Receive's list does", () => {
    const aside = (html: string) => /<p class="screen__aside">([^<]*)<\/p>/.exec(html)![1];
    expect(aside(page(info("seedelf"), [{ index: 0 }], 0, true))).toBe("•••• ₳ locked with it");
    expect(aside(page(info("seedelf"), [{ index: 0 }], 0))).toBe("1.5 ₳ locked with it");
  });
});
