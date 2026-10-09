// The withdraw service: read a destination (an address, or an ADA Handle
// through Koios), withdraw an amount or everything, and remove a seedelf, all
// through WebAssembly on the 12-word phrase's synthetic Seedelf UTxOs with
// Ogmios's real preprod evaluations; keep each unsigned until Send, then have
// giveme.my witness it, sign, and submit exactly it.
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { Koios } from "../src/background/koios";
import { pendingKey } from "../src/background/pending";
import { ADA_HANDLE_POLICY } from "../src/background/destination";
import { SESSION_REMOVE, SESSION_WITHDRAW, WithdrawService } from "../src/background/withdraw";
import { txIdOf } from "./fixtures/cbor";
import { deepRow, koiosPreprod, loadTestWasm, ownedUtxos, testBalances, transferPreprod, vectors, withdrawPreprod, withRawRows } from "./fakes";

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
    store: t.store,
  });
}

describe("reading a destination", () => {
  it("takes a normal address, and flags this wallet's own account", async () => {
    const t = await unlocked();
    expect(await t.withdraw.resolve("preprod", ` ${THEIRS} `)).toEqual({ address: THEIRS, own: false });
    // An own address names which account it is, so Make public can say so and
    // the public Send can refuse another one (chunk 18).
    expect(await t.withdraw.resolve("preprod", OWN)).toEqual({ address: OWN, own: true, ownAccount: 0 });
    expect(t.koios.calls).toHaveLength(0);
  });

  it("looks up an ADA Handle, plain or CIP-68, through Koios", async () => {
    const t = await unlocked();
    t.koios.nfts.set(`${ADA_HANDLE_POLICY}.${hex("bob")}`, THEIRS);
    t.koios.nfts.set(`${ADA_HANDLE_POLICY}.000de140${hex("me")}`, OWN);
    expect(await t.withdraw.resolve("preprod", "$Bob")).toEqual({ address: THEIRS, handle: "bob", own: false });
    expect(await t.withdraw.resolve("preprod", "$me")).toEqual({ address: OWN, handle: "me", own: true, ownAccount: 0 });
    await expect(t.withdraw.resolve("preprod", "$nobody")).rejects.toThrow("No ADA Handle $nobody on preprod.");
    expect(new Set(t.koios.calls.map((c) => c.path))).toEqual(new Set(["asset_nft_address"]));
  });

  it("refuses what a withdrawal can't pay", async () => {
    const t = await unlocked();
    await expect(t.withdraw.resolve("preprod", "nope")).rejects.toThrow("isn't a Cardano address");
    await expect(t.withdraw.resolve("preprod", "$not a handle")).rejects.toThrow("An ADA Handle is $");
    // Each reason named, rather than one sentence for all four (chunk 23's second review, PY-10).
    await expect(t.withdraw.resolve("preprod", account(12).mainnet.receive_0)).rejects.toThrow(
      "That's a mainnet address; this wallet is on Preprod.",
    );
    await expect(t.withdraw.resolve("mainnet", account(12).preprod.receive_0)).rejects.toThrow(
      "That's a test network's address; this wallet is on mainnet.",
    );
    await expect(t.withdraw.resolve("preprod", account(12).preprod.stake)).rejects.toThrow(
      "That's a stake address, which can't receive a payment. Use an address that starts addr_test1.",
    );
    // A handle held by a script (here, the wallet contract itself).
    t.koios.nfts.set(`${ADA_HANDLE_POLICY}.${hex("vault")}`, ownedUtxos[0]!.address);
    await expect(t.withdraw.resolve("preprod", "$vault")).rejects.toThrow("That's a script's address.");
  });
});

describe("withdraw", () => {
  it("builds an amount with a token, measured in the wallet, without sending anything", async () => {
    const t = await unlocked();
    t.koios.evaluation = withdrawPreprod.amount.evaluation;
    const summary = await t.withdraw.build("preprod", [{ to: THEIRS, lovelace: "5000000", tokens: TUSDM }]);
    expect(summary).toMatchObject({
      network: "preprod",
      payments: [{ address: THEIRS, own: false, lovelace: "5000000", tokens: TUSDM }],
      max: false,
      changeOutputs: 1,
      changeTokens: 1,
      inputs: 2,
      left: 0,
    });
    // Measured in the wallet, on the finished transaction itself, so within a
    // hair of what Ogmios's measure of a draft priced it at; no draft went to Ogmios.
    const recorded = Number(withdrawPreprod.amount.final.fee.total);
    expect(Math.abs(Number(summary.fee.total) - recorded)).toBeLessThan(recorded / 100);
    expect(Number(summary.fee.total)).toBe(Number(summary.fee.size) + Number(summary.fee.compute) + Number(summary.fee.scriptReference));
    expect(Number(summary.fee.scriptReference)).toBe(629 * 15);
    expect(t.koios.calls.map((c) => c.path).sort()).toEqual(["credential_utxos", "epoch_params"]);
    expect(t.collateral.asked).toHaveLength(0);
    const built = (await t.session.get<Stored>(SESSION_WITHDRAW))!;
    expect(txIdOf(Uint8Array.from(Buffer.from(built.txCbor, "hex")))).toBe(summary.txHash);
    expect(built.seed).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sends everything with Max, and nothing comes back", async () => {
    const t = await unlocked();
    t.koios.evaluation = withdrawPreprod.max.evaluation;
    const summary = await t.withdraw.build("preprod", [{ to: THEIRS, lovelace: null, tokens: [] }]);
    expect(summary).toMatchObject({ max: true, changeLovelace: "0", changeOutputs: 0, inputs: 2, left: 0 });
    expect(BigInt(summary.payments[0]!.lovelace)).toBe(28_000_000n - BigInt(summary.fee.total));
    expect(summary.payments[0]!.tokens).toHaveLength(1);
  });

  it("leaves a UTxO carrying a reference script out of the balance and of Max", async () => {
    const t = await unlocked();
    // Anyone can pay the Seedelf a UTxO with a reference script; the wallet's evaluator can't spend it yet.
    const scripted = {
      ...ownedUtxos[0]!,
      tx_hash: "71".repeat(32),
      value: "30000000",
      reference_script: { hash: "84967d91".padEnd(56, "0"), size: 3, type: "timelock", bytes: "820080" },
    };
    t.koios.added.push(scripted);
    const b = await t.balances.get("preprod");
    expect(b.seedelf).toMatchObject({ lovelace: "28000000", utxos: 2 });
    const summary = await t.withdraw.build("preprod", [{ to: THEIRS, lovelace: null, tokens: [] }]);
    expect(summary).toMatchObject({ max: true, inputs: 2, left: 0 });
    expect(BigInt(summary.payments[0]!.lovelace)).toBe(28_000_000n - BigInt(summary.fee.total));
    // Max's review says what it left out, and why; the UTxOs screen marks it (launch review #12).
    expect(summary.leftOut).toEqual([{ txHash: scripted.tx_hash, txIndex: scripted.tx_index, reason: "script" }]);
    const { seedelf } = await t.coins.lists("preprod");
    expect(seedelf.filter((u) => u.unspendable)).toEqual([expect.objectContaining({ txHash: scripted.tx_hash, unspendable: "script" })]);
  });

  it("isn't stopped by a stranger's UTxO nested thousands of levels deep in the contract (launch review H4)", async () => {
    const t = await unlocked();
    // One pays the Seedelf's register a native reference script 5,000 levels deep; another, a datum as deep.
    withRawRows(t.koios, koiosPreprod.wallet_contract, [
      deepRow(ownedUtxos[0]!, 5_000, { txHash: "e3".repeat(32), script: true }),
      deepRow(ownedUtxos[0]!, 5_000, { txHash: "e4".repeat(32) }),
    ]);
    const b = await t.balances.get("preprod");
    expect(b.seedelf).toMatchObject({ lovelace: "28000000", utxos: 2 });
    const summary = await t.withdraw.build("preprod", [{ to: THEIRS, lovelace: null, tokens: [] }]);
    expect(summary).toMatchObject({ max: true, inputs: 2, left: 0 });
  });

  it("pays several addresses in one withdrawal; Max is for one", async () => {
    const t = await unlocked();
    t.koios.evaluation = withdrawPreprod.amount.evaluation;
    t.koios.nfts.set(`${ADA_HANDLE_POLICY}.${Buffer.from("bob").toString("hex")}`, THEIRS);
    const summary = await t.withdraw.build("preprod", [
      { to: THEIRS, lovelace: "5000000", tokens: TUSDM },
      { to: "$bob", lovelace: "2000000", tokens: [] },
    ]);
    expect(summary).toMatchObject({
      max: false,
      payments: [
        { address: THEIRS, lovelace: "5000000", tokens: TUSDM },
        { address: THEIRS, handle: "bob", lovelace: "2000000", tokens: [] },
      ],
    });
    await expect(
      t.withdraw.build("preprod", [
        { to: THEIRS, lovelace: null, tokens: [] },
        { to: THEIRS, lovelace: "2000000", tokens: [] },
      ]),
    ).rejects.toThrow("Max pays a single recipient");
  });

  it("raises a short amount to the least the payment needs", async () => {
    const t = await unlocked();
    t.koios.evaluation = withdrawPreprod.amount.evaluation;
    const [short] = (await t.withdraw.build("preprod", [{ to: THEIRS, lovelace: "500000", tokens: [] }])).payments;
    expect(short!.lovelace).toBe(short!.minimum);
    expect(BigInt(short!.minimum!)).toBeGreaterThan(500_000n);
    const [token] = (await t.withdraw.build("preprod", [{ to: THEIRS, lovelace: "0", tokens: [{ ...TUSDM[0]!, quantity: "1" }] }])).payments;
    expect(token!.lovelace).toBe(token!.minimum);
    expect(BigInt(token!.minimum!)).toBeGreaterThan(BigInt(short!.minimum!));
  });

  it("says how much an amount can be and what has to stay, and pays anything up to it (blind test §4.4)", async () => {
    // 25 ₳, and 3 ₳ holding tUSDM that isn't being sent: it stays, with the least ADA it needs.
    const t = await unlocked();
    const pay = (lovelace: bigint) => t.withdraw.build("preprod", [{ to: THEIRS, lovelace: lovelace.toString(), tokens: [] }]);
    const message = ((await pay(27_000_000n).catch((e: unknown) => e)) as Error).message;
    const [, whole, decimals] = /^Not enough ADA: with the fee, your private balance can pay up to about (\d+)\.(\d+)\u00a0₳ here, since 1\.\d+\u00a0₳ has to stay with the tokens you keep/.exec(message) ?? [];
    expect(whole, message).toBeDefined();
    const most = BigInt(whole!) * 1_000_000n + BigInt(decimals!.padEnd(6, "0"));
    // Measured, not guessed: a hair under it pays, where the guessed fee refused it.
    const under = await pay(most - 5_000n);
    expect(under.payments[0]!.lovelace).toBe((most - 5_000n).toString());
    expect(under.changeTokens).toBe(1);
    // Max is still everything, the token too.
    expect((await t.withdraw.build("preprod", [{ to: THEIRS, lovelace: null, tokens: [] }])).payments[0]!.tokens).toHaveLength(1);
  });

  it("explains what stops a withdrawal", async () => {
    const t = await unlocked();
    await expect(t.withdraw.build("preprod", [{ to: THEIRS, lovelace: "30000000", tokens: [] }])).rejects.toThrow("Not enough ADA");
    await expect(t.withdraw.build("preprod", [{ to: "nope", lovelace: "5000000", tokens: [] }])).rejects.toThrow("isn't a Cardano address");
    expect(t.koios.calls.map((c) => c.path)).not.toContain("ogmios");
    const empty = await unlocked({ owned: false });
    await expect(empty.withdraw.build("preprod", [{ to: THEIRS, lovelace: null, tokens: [] }])).rejects.toThrow("Your private balance is empty");
  });

  it("submits exactly the signed transaction, and refuses anything else", async () => {
    const t = await unlocked();
    t.koios.evaluation = withdrawPreprod.amount.evaluation;
    await expect(t.withdraw.submit("preprod", "00".repeat(32))).rejects.toThrow("That payment isn't ready to send");
    const summary = await t.withdraw.build("preprod", [{ to: THEIRS, lovelace: "5000000", tokens: TUSDM }]);
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
    // A Seedelf spend's watch says so, so it's looked for on the private index's feed where there is one (feed.ts).
    // And when it was first tried, before the submit: where the feed is read from (feed.ts).
    expect(await t.session.get(pendingKey("preprod"))).toEqual({ ...pending, contract: true, triedAt: t.clock.now });
  });
});

describe("removing a Seedelf", () => {
  it("burns it and sends its ADA to the Cardano account", async () => {
    const t = await unlocked();
    const summary = await t.withdraw.buildRemove("preprod", MINE, "account");
    expect(summary).toMatchObject({ network: "preprod", name: MINE, label: "web-wallet", to: "account" });
    // Measured in the wallet: within a hair of the recorded fee (a random
    // one-time key's hash may sort before giveme.my's among the signers).
    const recorded = Number(withdrawPreprod.remove.final.fee.total);
    expect(Math.abs(Number(summary.fee.total) - recorded)).toBeLessThan(recorded / 100);
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
      "No Seedelf with that name",
    );
    await expect(t.withdraw.buildRemove("preprod", "web-wallet", "account")).rejects.toThrow("isn't a Seedelf's name");
    await expect(t.withdraw.submitRemove("preprod", "00".repeat(32))).rejects.toThrow("That removal isn't ready to send");
  });
});
