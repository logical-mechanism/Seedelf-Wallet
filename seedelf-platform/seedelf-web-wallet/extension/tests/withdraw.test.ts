// The withdraw service: read a destination (an address, or an ADA Handle
// through Koios), withdraw an amount or everything, and remove a seedelf, all
// through WebAssembly on the 12-word phrase's synthetic Seedelf UTxOs with
// Ogmios's real preprod evaluations; keep each unsigned until Send, then have
// giveme.my witness it, sign, and submit exactly it.
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { Koios } from "../src/background/koios";
import { SESSION_PENDING } from "../src/background/pending";
import { ADA_HANDLE_POLICY } from "../src/background/destination";
import { SESSION_REMOVE, SESSION_WITHDRAW, WithdrawService } from "../src/background/withdraw";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, ownedUtxos, testBalances, transferPreprod, vectors, withdrawPreprod } from "./fakes";

const PASSWORD = "correct horse battery";
const hex = (s: string) => Buffer.from(s).toString("hex");
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
/** The 15-word phrase's receive address: someone else's. */
const THEIRS = account(15).preprod.receive_0 as string;
/** The 12-word phrase's own receive address. */
const OWN = account(12).preprod.receive_0 as string;
/** The phrase's own seedelf, "web-wallet" (1.5 ₳ in the fixture). */
const MINE = ownedUtxos[2]!.asset_list![0]!.asset_name;
const TUSDM = withdrawPreprod.amount.request.tokens as Array<{ policyId: string; assetName: string; quantity: string }>;

async function unlocked(options?: { owned?: boolean }) {
  const t = testBalances(options);
  await t.wallet.create(account(12).phrase, PASSWORD);
  return t;
}

type Stored = { txCbor: string; txHash: string; seed: string; builtAt: number };

/** The same deps with WebAssembly's signScriptSpend swapped out. */
function withSigner(t: Awaited<ReturnType<typeof unlocked>>, sign: (request: any) => string) {
  const wasm = loadTestWasm();
  return new WithdrawService({
    wasm: { ...wasm, signScriptSpend: (_key: unknown, request: string) => sign(JSON.parse(request)) } as typeof wasm,
    wallet: t.wallet,
    session: t.session,
    koios: () => new Koios("https://preprod.koios.rest/api/v1", t.koios.fetch, async () => undefined),
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    now: () => t.clock.now,
    coins: t.coins,
  });
}

describe("reading a destination", () => {
  it("takes a normal address, and flags this wallet's own account", async () => {
    const t = await unlocked();
    expect(await t.withdraw.resolve("preprod", ` ${THEIRS} `)).toEqual({ address: THEIRS, own: false });
    expect(await t.withdraw.resolve("preprod", OWN)).toEqual({ address: OWN, own: true });
    expect(t.koios.calls).toHaveLength(0);
  });

  it("looks up an ADA Handle, plain or CIP-68, through Koios", async () => {
    const t = await unlocked();
    t.koios.nfts.set(`${ADA_HANDLE_POLICY}.${hex("bob")}`, THEIRS);
    t.koios.nfts.set(`${ADA_HANDLE_POLICY}.000de140${hex("me")}`, OWN);
    expect(await t.withdraw.resolve("preprod", "$Bob")).toEqual({ address: THEIRS, handle: "bob", own: false });
    expect(await t.withdraw.resolve("preprod", "$me")).toEqual({ address: OWN, handle: "me", own: true });
    await expect(t.withdraw.resolve("preprod", "$nobody")).rejects.toThrow("No ADA Handle $nobody on preprod.");
    expect(new Set(t.koios.calls.map((c) => c.path))).toEqual(new Set(["asset_nft_address"]));
  });

  it("refuses what a withdrawal can't pay", async () => {
    const t = await unlocked();
    await expect(t.withdraw.resolve("preprod", "nope")).rejects.toThrow("isn't a Cardano address");
    await expect(t.withdraw.resolve("preprod", "$not a handle")).rejects.toThrow("An ADA Handle is $");
    await expect(t.withdraw.resolve("preprod", account(12).mainnet.receive_0)).rejects.toThrow("normal preprod address");
    // A handle held by a script (here, the wallet contract itself).
    t.koios.nfts.set(`${ADA_HANDLE_POLICY}.${hex("vault")}`, ownedUtxos[0]!.address);
    await expect(t.withdraw.resolve("preprod", "$vault")).rejects.toThrow("normal preprod address");
  });
});

describe("withdraw", () => {
  it("builds an amount with a token, measured by Ogmios, without sending anything", async () => {
    const t = await unlocked();
    t.koios.evaluation = withdrawPreprod.amount.evaluation;
    const summary = await t.withdraw.build("preprod", THEIRS, "5000000", TUSDM);
    expect(summary).toMatchObject({
      network: "preprod",
      address: THEIRS,
      own: false,
      max: false,
      lovelace: "5000000",
      tokens: TUSDM,
      changeOutputs: 1,
      changeTokens: 1,
      inputs: 2,
      left: 0,
    });
    expect(summary.fee.total).toBe(withdrawPreprod.amount.final.fee.total);
    expect(Number(summary.fee.scriptReference)).toBe(629 * 15);
    expect(t.koios.calls.map((c) => c.path).sort()).toEqual(["credential_utxos", "epoch_params", "ogmios"]);
    expect(t.collateral.asked).toHaveLength(0);
    const built = (await t.session.get<Stored>(SESSION_WITHDRAW))!;
    expect(txIdOf(Uint8Array.from(Buffer.from(built.txCbor, "hex")))).toBe(summary.txHash);
    expect(built.seed).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sends everything with Max, and nothing comes back", async () => {
    const t = await unlocked();
    t.koios.evaluation = withdrawPreprod.max.evaluation;
    const summary = await t.withdraw.build("preprod", THEIRS, null, []);
    expect(summary).toMatchObject({ max: true, changeLovelace: "0", changeOutputs: 0, inputs: 2, left: 0 });
    expect(BigInt(summary.lovelace)).toBe(28_000_000n - BigInt(summary.fee.total));
    expect(summary.tokens).toHaveLength(1);
  });

  it("raises a short amount to the least the payment needs", async () => {
    const t = await unlocked();
    t.koios.evaluation = withdrawPreprod.amount.evaluation;
    const short = await t.withdraw.build("preprod", THEIRS, "500000", []);
    expect(short.lovelace).toBe(short.minimum);
    expect(BigInt(short.minimum!)).toBeGreaterThan(500_000n);
    const token = await t.withdraw.build("preprod", THEIRS, "0", [{ ...TUSDM[0]!, quantity: "1" }]);
    expect(token.lovelace).toBe(token.minimum);
    expect(BigInt(token.minimum!)).toBeGreaterThan(BigInt(short.minimum!));
  });

  it("explains what stops a withdrawal", async () => {
    const t = await unlocked();
    await expect(t.withdraw.build("preprod", THEIRS, "30000000", [])).rejects.toThrow("Not enough ADA");
    await expect(t.withdraw.build("preprod", "nope", "5000000", [])).rejects.toThrow("isn't a Cardano address");
    expect(t.koios.calls.map((c) => c.path)).not.toContain("ogmios");
    const empty = await unlocked({ owned: false });
    await expect(empty.withdraw.build("preprod", THEIRS, null, [])).rejects.toThrow("Your Seedelf balance is empty");
  });

  it("submits exactly the signed transaction, and refuses anything else", async () => {
    const t = await unlocked();
    t.koios.evaluation = withdrawPreprod.amount.evaluation;
    await expect(t.withdraw.submit("preprod", "00".repeat(32))).rejects.toThrow("That withdrawal isn't ready to send");
    const summary = await t.withdraw.build("preprod", THEIRS, "5000000", TUSDM);
    // giveme.my's recorded refusal: nothing is sent, and Send can be tried again.
    await expect(t.withdraw.submit("preprod", summary.txHash)).rejects.toThrow("Transaction Fails Validation");
    expect(t.koios.submitted).toHaveLength(0);
    expect(await t.session.get(SESSION_WITHDRAW)).toBeDefined();

    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    const service = withSigner(t, (request) => JSON.stringify({ txCbor: request.txCbor, txHash: summary.txHash }));
    const pending = await service.submit("preprod", summary.txHash);
    expect(pending).toMatchObject({ kind: "withdraw", txHash: summary.txHash, confirmations: null });
    expect(t.koios.submitted.map((b) => txIdOf(b))).toEqual([summary.txHash]);
    expect(await t.session.get(SESSION_WITHDRAW)).toBeUndefined();
    expect(await t.session.get(SESSION_PENDING)).toEqual(pending);
  });
});

describe("removing a seedelf", () => {
  it("burns it and sends its ADA to the Cardano account", async () => {
    const t = await unlocked();
    t.koios.evaluation = withdrawPreprod.remove.evaluation;
    const summary = await t.withdraw.buildRemove("preprod", MINE, "account");
    expect(summary).toMatchObject({ network: "preprod", name: MINE, label: "web-wallet", to: "account" });
    expect(summary.fee.total).toBe(withdrawPreprod.remove.final.fee.total);
    expect(BigInt(summary.lovelace)).toBe(1_500_000n - BigInt(summary.fee.total));
    // Both scripts run: the wallet's spend and the seedelf policy's burn.
    expect(Number(summary.fee.scriptReference)).toBe((629 + 519) * 15);

    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    const service = withSigner(t, (request) => JSON.stringify({ txCbor: request.txCbor, txHash: summary.txHash }));
    const pending = await service.submitRemove("preprod", summary.txHash);
    expect(pending).toMatchObject({ kind: "remove", txHash: summary.txHash });
    expect(await t.session.get(SESSION_REMOVE)).toBeUndefined();
  });

  it("explains what stops a removal", async () => {
    const t = await unlocked();
    t.koios.evaluation = withdrawPreprod.remove.evaluation;
    // The fixture's seedelf holds 1.5 ₳, too little for a contract output after the fee (a real one holds 1.75).
    await expect(t.withdraw.buildRemove("preprod", MINE, "seedelf")).rejects.toThrow("Not enough ADA");
    await expect(t.withdraw.buildRemove("preprod", transferPreprod.to, "account")).rejects.toThrow("isn't this wallet's");
    await expect(t.withdraw.buildRemove("preprod", `5eed0e1f${"00".repeat(28)}`, "account")).rejects.toThrow(
      "No seedelf with that name",
    );
    await expect(t.withdraw.buildRemove("preprod", "web-wallet", "account")).rejects.toThrow("isn't a seedelf's name");
    await expect(t.withdraw.submitRemove("preprod", "00".repeat(32))).rejects.toThrow("That removal isn't ready to send");
  });
});
