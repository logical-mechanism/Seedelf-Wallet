// The transfer service: find a seedelf by its full name in the whole wallet
// contract, build a payment to it through WebAssembly on the 12-word
// phrase's synthetic Seedelf UTxOs with Ogmios's real preprod evaluation,
// keep it unsigned until Send, then have giveme.my witness it, sign, and
// submit exactly it.
import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral, CollateralRefusedError, refusedBy, StaleReviewError } from "../src/background/collateral";
import { SESSION_CONTRACT_PREFIX } from "../src/background/contract-scan";
import { Koios } from "../src/background/koios";
import { pendingKey } from "../src/background/pending";
import { rememberSpent, SESSION_SPENT } from "../src/background/spent";
import { adaWords } from "../src/background/short";
import { SESSION_TRANSFER, TransferService } from "../src/background/transfer";
import { SEEDELF_NAME_RULE } from "../src/shared/seedelf-name";
import { txIdOf } from "./fixtures/cbor";
import { koiosPreprod, loadTestWasm, ownedUtxos, testBalances, transferPreprod, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const bytes = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));
/** "This is a test.", a live preprod seedelf the phrase doesn't own. */
const THEIRS = transferPreprod.to;
/** The phrase's own seedelf, "web-wallet". */
const MINE = ownedUtxos[2]!.asset_list![0]!.asset_name;

async function unlocked(options?: { owned?: boolean }) {
  const v = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
  const t = testBalances(options);
  await t.wallet.create(v.phrase, PASSWORD);
  t.koios.evaluation = transferPreprod.evaluation;
  return t;
}

type Stored = { txCbor: string; txHash: string; seed: string; builtAt: number };

/** The same deps with WebAssembly's signScriptSpend swapped out. */
function withSigner(t: Awaited<ReturnType<typeof unlocked>>, sign: (request: any) => string) {
  const wasm = loadTestWasm();
  const calls: any[] = [];
  const service = new TransferService({
    wasm: { ...wasm, signScriptSpend: (_key: unknown, request: string) => (calls.push(JSON.parse(request)), sign(JSON.parse(request))) } as typeof wasm,
    wallet: t.wallet,
    session: t.session,
    koios: () => new Koios("https://preprod.koios.rest/api/v1", t.koios.fetch, async () => undefined),
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    now: () => t.clock.now,
    coins: t.coins,
    store: t.store,
  });
  return { service, calls };
}

describe("finding a Seedelf", () => {
  it("finds it by its full name, asking Koios only about the whole contract", async () => {
    const t = await unlocked();
    expect(await t.transfer.lookup("preprod", THEIRS)).toEqual({ name: THEIRS, label: "This is a test.", own: false });
    // Pasted with spaces or in capitals, it's the same name.
    const messy = ` ${THEIRS.slice(0, 20).toUpperCase()} ${THEIRS.slice(20)}\n`;
    expect((await t.transfer.lookup("preprod", messy)).name).toBe(THEIRS);
    expect(await t.transfer.lookup("preprod", MINE)).toMatchObject({ name: MINE, label: "web-wallet", own: true });

    // Never a question about the recipient's token: only the query a balance reading makes.
    expect(new Set(t.koios.calls.map((c) => c.path))).toEqual(new Set(["credential_utxos"]));
    expect(JSON.stringify(t.koios.calls)).not.toContain(THEIRS);
  });

  it("says when a name isn't whole or isn't on chain", async () => {
    const t = await unlocked();
    for (const bad of ["", "5eed0e1f", `${THEIRS}00`, `00${THEIRS.slice(2)}`, `${THEIRS.slice(0, 62)}zz`]) {
      await expect(t.transfer.lookup("preprod", bad)).rejects.toThrow(SEEDELF_NAME_RULE());
    }
    expect(t.koios.calls).toHaveLength(0);
    await expect(t.transfer.lookup("preprod", `5eed0e1f${"00".repeat(28)}`)).rejects.toThrow(
      "No Seedelf with that name on preprod.",
    );
  });
});

describe("transfer", () => {
  it("builds a payment, measured in the wallet, without sending anything", async () => {
    const t = await unlocked();
    const summary = await t.transfer.build("preprod", [{ to: THEIRS, lovelace: transferPreprod.lovelace, tokens: transferPreprod.tokens }]);
    expect(summary).toMatchObject({
      network: "preprod",
      payments: [{ to: THEIRS, label: "This is a test.", toSelf: false, lovelace: "5000000", tokens: transferPreprod.tokens }],
      changeOutputs: 1,
      changeTokens: 1,
      // The tUSDM UTxO, then the 25 ₳ one.
      inputs: 2,
    });
    const fee = summary.fee;
    // The recorded fee, or a hair less when the new one-time key's hash sorts
    // before giveme.my's among the signers the script searches (the recorded one didn't).
    const short = Number(transferPreprod.final.fee.total) - Number(fee.total);
    expect(short).toBeGreaterThanOrEqual(0);
    expect(short).toBeLessThan(1_000);
    expect(Number(fee.total)).toBe(Number(fee.size) + Number(fee.compute) + Number(fee.scriptReference));
    expect(Number(fee.scriptReference)).toBe(629 * 15); // the wallet script only
    expect(BigInt(summary.changeLovelace)).toBe(28_000_000n - 5_000_000n - BigInt(fee.total));

    // Koios was read, and nobody heard of it: the wallet measured the scripts
    // itself, as the chain did (the recorded fee), so no draft went to Ogmios.
    expect(t.koios.calls.map((c) => c.path).sort()).toEqual(["credential_utxos", "epoch_params"]);
    expect(t.collateral.asked).toHaveLength(0);
    expect(t.koios.submitted).toHaveLength(0);

    // The unsigned transaction waits in session storage, with its seed.
    const built = (await t.session.get<Stored>(SESSION_TRANSFER))!;
    expect(txIdOf(bytes(built.txCbor))).toBe(summary.txHash);
    expect(built.seed).toMatch(/^[0-9a-f]{64}$/);
  });

  it("says when it spends money with different histories together, and keeps what its change's is (privacy review §2.3)", async () => {
    const t = await unlocked();
    // The private history started before this money arrived: its first reading found none (independent review L38).
    await t.activity.arrived("preprod", []);
    // The tUSDM UTxO is money the wallet made private; the 25 ₳ one arrived from someone.
    const [ada, token] = [ownedUtxos[0]!, ownedUtxos[1]!];
    await t.activity.sent(
      "preprod",
      { kind: "move-in", network: "preprod", txHash: token.tx_hash, submittedAt: 1, confirmations: null },
      { lovelace: token.value },
    );
    await t.balances.get("preprod");
    // Its token sits in one UTxO whose ADA can't pay: both go, and nothing asks.
    const summary = await t.transfer.build("preprod", [{ to: THEIRS, lovelace: transferPreprod.lovelace, tokens: transferPreprod.tokens }]);
    const received = { id: `received:${ada.tx_hash}`, origin: "received" };
    expect(summary.inputs).toBe(2);
    expect(summary.histories).toEqual(expect.arrayContaining([{ id: "public:0", origin: "own" }, received]));
    expect(summary.histories).toHaveLength(2);
    // Its change has both histories from now on.
    const built = (await t.session.get<Stored & { origin: unknown }>(SESSION_TRANSFER))!;
    expect(built.origin).toEqual({ id: `public:0+received:${ada.tx_hash}`, origin: "own" });

    // With one history, there's nothing to say.
    const own = await t.transfer.build("preprod", [{ to: MINE, lovelace: "2000000", tokens: [] }]);
    expect(own.histories).toEqual([received]);
  });

  it("pays your own Seedelf, and says so", async () => {
    const t = await unlocked();
    const summary = await t.transfer.build("preprod", [{ to: MINE, lovelace: "2000000", tokens: [] }]);
    expect(summary).toMatchObject({ payments: [{ to: MINE, label: "web-wallet", toSelf: true }], inputs: 1 });
  });

  it("pays several Seedelfs in one transfer", async () => {
    const t = await unlocked();
    const summary = await t.transfer.build("preprod", [
      { to: THEIRS, lovelace: transferPreprod.lovelace, tokens: transferPreprod.tokens },
      { to: MINE, lovelace: "2000000", tokens: [] },
    ]);
    expect(summary.payments).toMatchObject([
      { to: THEIRS, label: "This is a test.", toSelf: false, lovelace: "5000000" },
      { to: MINE, label: "web-wallet", toSelf: true, lovelace: "2000000" },
    ]);
    // The contract read once for both, and nothing more.
    expect(t.koios.calls.map((c) => c.path).sort()).toEqual(["credential_utxos", "epoch_params"]);
    await expect(t.transfer.build("preprod", [])).rejects.toThrow("someone to pay");
  });

  it("raises a short amount to the least the payment needs", async () => {
    const t = await unlocked();
    const tokens = [{ ...transferPreprod.tokens[0]!, quantity: "1" }];
    for (const asked of ["0", "1000000"]) {
      const [paid] = (await t.transfer.build("preprod", [{ to: THEIRS, lovelace: asked, tokens: tokens }])).payments;
      expect(paid!.lovelace).toBe(paid!.minimum);
      expect(BigInt(paid!.minimum!)).toBeGreaterThan(1_000_000n);
    }
  });

  it("pays the most there is with Max: everything but the fee and what the token kept needs (blind test §9.6)", async () => {
    // T05's private balance: 25 ₳, and 3 ₳ holding 1,234.56 tUSDM, which the tester never wanted to send.
    const t = await unlocked();
    const max = await t.transfer.build("preprod", [{ to: THEIRS, lovelace: null, tokens: [] }]);
    expect(max).toMatchObject({ max: true, inputs: 2, left: 0, changeTokens: 1, changeOutputs: 1 });
    expect(max.changeMinimum).toBe(max.changeLovelace);
    expect(BigInt(max.payments[0]!.lovelace)).toBe(28_000_000n - BigInt(max.fee.total) - BigInt(max.changeLovelace));
    expect(max.payments[0]).toMatchObject({ to: THEIRS, minimum: null, tokens: [] });
    expect(max.leftOut).toBeUndefined();
    // Read once, and measured in the wallet: Max asks Koios nothing more than an amount does.
    expect(t.koios.calls.map((c) => c.path).sort()).toEqual(["credential_utxos", "epoch_params"]);

    // With the token added, it goes too, and nothing stays.
    const all = [{ ...transferPreprod.tokens[0]!, quantity: "1234560000" }];
    const everything = await t.transfer.build("preprod", [{ to: THEIRS, lovelace: null, tokens: all }]);
    expect(BigInt(everything.payments[0]!.lovelace)).toBe(28_000_000n - BigInt(everything.fee.total));
    expect(everything).toMatchObject({ changeLovelace: "0", changeOutputs: 0 });

    // Max is for one Seedelf.
    await expect(
      t.transfer.build("preprod", [
        { to: THEIRS, lovelace: null, tokens: [] },
        { to: MINE, lovelace: "2000000", tokens: [] },
      ]),
    ).rejects.toThrow("Max pays a single recipient");
  });

  it("says the most that can go and what has to stay, and pays anything up to it (blind test §4.4)", async () => {
    const t = await unlocked();
    const max = await t.transfer.build("preprod", [{ to: THEIRS, lovelace: null, tokens: [] }]);
    const most = BigInt(max.payments[0]!.lovelace);
    const pay = (lovelace: bigint, tokens = [] as typeof transferPreprod.tokens) =>
      t.transfer.build("preprod", [{ to: THEIRS, lovelace: lovelace.toString(), tokens }]);
    // T05's 26.07 ₳ and 26.081594 ₳: under Max, so they go, at the fee the review shows. The old check's guessed
    // fee, about 0.29 ₳, refused anything past about 26.06 ₳.
    let calls = t.koios.calls.length;
    const under = await pay(most - 5_000n);
    const perBuild = t.koios.calls.length - calls;
    expect(under.payments[0]!.lovelace).toBe((most - 5_000n).toString());
    expect(BigInt(under.changeLovelace)).toBeGreaterThanOrEqual(BigInt(max.changeLovelace));
    // Past it: about how much can go, and that the token's ADA has to stay with it, and how to send that too. "About":
    // each build's fee moves a few hundred lovelace with its one-time key (short.ts).
    /** The figure a shortfall gives, in lovelace, and the message around it. */
    const said = async (paying: Promise<unknown>) => {
      const message = ((await paying.catch((e: unknown) => e)) as Error).message;
      const [, whole, decimals = ""] = /up to about ([\d,]+)(?:\.(\d+))?\u00a0₳/.exec(message) ?? [];
      return { message, figure: BigInt(whole!.replaceAll(",", "")) * 1_000_000n + BigInt(decimals.padEnd(6, "0") || "0") };
    };
    calls = t.koios.calls.length;
    const past = await said(pay(27_000_000n));
    expect(past.message).toMatch(
      `here, since ${adaWords(max.changeLovelace)}\u00a0₳ has to stay with the tokens you keep.`,
    );
    // Within a few hundred lovelace of Max's own figure.
    expect(past.figure > most - 2_000n && past.figure < most + 2_000n).toBe(true);
    // Max's figure came from the reading already made: no Koios request beyond the build's own.
    expect(t.koios.calls.length - calls).toBe(perBuild);
    await expect(pay(most + 5_000n)).rejects.toThrow(`Send them too to free it.`);
    // With the token sent, nothing has to stay: up to all of it, or what's left must be enough to stay.
    const all = [{ ...transferPreprod.tokens[0]!, quantity: "1234560000" }];
    const top = BigInt((await t.transfer.build("preprod", [{ to: THEIRS, lovelace: null, tokens: all }])).payments[0]!.lovelace);
    const over = await said(pay(top + 5_000n, all));
    expect(over.message).toMatch(/^Not enough ADA: with the fee, your private balance can pay up to about [\d.]+\u00a0₳ here\. Use Max to send all of it\.$/);
    expect(over.figure > top - 2_000n && over.figure < top + 2_000n).toBe(true);
    const short = pay(top - 500_000n, all);
    await expect(short).rejects.toThrow(/^Not enough ADA: what stays in your private balance would be under the 1\.\d+\u00a0₳ minimum\. Use Max to send all of it, or send less\.$/);
    // Several: no Max measures them.
    await expect(
      t.transfer.build("preprod", [
        { to: THEIRS, lovelace: "20000000", tokens: [] },
        { to: MINE, lovelace: "20000000", tokens: [] },
      ]),
    ).rejects.toThrow("these come to more than your private balance can pay");
    expect(new Set(t.koios.calls.map((c) => c.path))).toEqual(new Set(["credential_utxos", "epoch_params"]));
  });

  it("explains what stops a transfer", async () => {
    const t = await unlocked();
    await expect(t.transfer.build("preprod", [{ to: "5eed0e1f", lovelace: "2000000", tokens: [] }])).rejects.toThrow(SEEDELF_NAME_RULE());
    await expect(t.transfer.build("preprod", [{ to: `5eed0e1f${"00".repeat(28)}`, lovelace: "2000000", tokens: [] }])).rejects.toThrow(
      "No Seedelf with that name",
    );
    await expect(t.transfer.build("preprod", [{ to: THEIRS, lovelace: "30000000", tokens: [] }])).rejects.toThrow("Not enough ADA");
    const tooMany = [{ ...transferPreprod.tokens[0]!, quantity: "1234560001" }];
    await expect(t.transfer.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: tooMany }])).rejects.toThrow("holds only 1234560000");
    expect(t.koios.calls.map((c) => c.path)).not.toContain("ogmios");

    const empty = await unlocked({ owned: false });
    await expect(empty.transfer.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }])).rejects.toThrow("Your private balance is empty");
    expect(empty.koios.calls.map((c) => c.path)).not.toContain("ogmios");

    await t.wallet.lock();
    await expect(t.transfer.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }])).rejects.toThrow("locked");
  });

  it("sends nothing when giveme.my refuses, or its signature doesn't check out", async () => {
    const t = await unlocked();
    const summary = await t.transfer.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    await expect(t.transfer.submit("preprod", summary.txHash)).rejects.toThrow(
      "giveme.my, which lends the collateral, refused this transaction: Transaction Fails Validation",
    );
    t.collateral.answer = { status: 200, body: { witness: `a10081825820${"11".repeat(32)}5840${"22".repeat(64)}` } };
    await expect(t.transfer.submit("preprod", summary.txHash)).rejects.toThrow("doesn't match this transaction");
    expect(t.koios.submitted).toHaveLength(0);
    expect(await t.session.get(SESSION_TRANSFER)).toBeDefined(); // Send can be tried again
    expect(await t.session.get(pendingKey("preprod"))).toBeUndefined();
  });

  it("names giveme.my as who refused, unless the device knows it spent something since (blind test §9.5)", async () => {
    const t = await unlocked();
    const summary = await t.transfer.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    // giveme.my's recorded refusal, with nothing the device knows of spent: a refusal of giveme.my's, not a guess
    // at the user's money, and the screen says who (ui-port.ts `refusedBy`).
    const refused = await t.transfer.submit("preprod", summary.txHash).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(CollateralRefusedError);
    expect(refusedBy(refused)).toBe("giveme");
    // An outage: giveme.my's, which waiting fixes.
    t.collateral.answer = { status: 503, body: {} };
    const down = await t.transfer.submit("preprod", summary.txHash).catch((e: unknown) => e);
    expect(refusedBy(down)).toBe("givemeBusy");
    expect((down as Error).message).toContain("couldn't take this transaction just now (503)");
    expect(t.collateral.asked).toHaveLength(2);

    // Something it spends went out since, in another of this wallet's transactions (another page's Send): said as
    // that, a stale review with nobody named, and giveme.my isn't asked.
    const built = (await t.session.get<Stored>(SESSION_TRANSFER))!;
    const [input] = txInputs(bytes(built.txCbor));
    await t.session.set(SESSION_SPENT, { [input!]: t.clock.now });
    const stale = await t.transfer.submit("preprod", summary.txHash).catch((e: unknown) => e);
    expect(stale).toBeInstanceOf(StaleReviewError);
    expect(refusedBy(stale)).toBeUndefined();
    expect((stale as Error).message).toContain("Another of your transactions spent part of it since this review");
    expect(t.collateral.asked).toHaveLength(2);
    expect(t.koios.submitted).toHaveLength(0);
  });

  it("never calls a review stale for inputs its own Send spent: says it was sent, so nothing is built twice (cross-area review)", async () => {
    // Route one: another Send of this same review wrote it ahead (rememberSpent, which keeps it as sent too) after
    // this one read the kept review.
    const t = await unlocked();
    const summary = await t.transfer.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    const built = (await t.session.get<Stored>(SESSION_TRANSFER))!;
    await rememberSpent(t.session, "preprod", bytes(built.txCbor), t.clock.now);
    const first = await t.transfer.submit("preprod", summary.txHash).catch((e: unknown) => e);
    expect(first).not.toBeInstanceOf(StaleReviewError);
    expect((first as Error).message).toContain("That was sent already");
    expect(t.collateral.asked).toHaveLength(0);

    // Route two: the kept review put back as it was, its inputs held as spent, and the watch holding it as sent.
    const u = await unlocked();
    const again = await u.transfer.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    const kept = (await u.session.get<Stored>(SESSION_TRANSFER))!;
    const [input] = txInputs(bytes(kept.txCbor));
    await u.session.set(SESSION_SPENT, { [input!]: u.clock.now });
    await u.session.set(pendingKey("preprod"), {
      kind: "transfer",
      network: "preprod",
      txHash: again.txHash,
      submittedAt: u.clock.now,
      confirmations: 0,
    });
    const second = await u.transfer.submit("preprod", again.txHash).catch((e: unknown) => e);
    expect(second).not.toBeInstanceOf(StaleReviewError);
    expect((second as Error).message).toContain("That was sent already");
    expect(u.collateral.asked).toHaveLength(0);
    expect(u.koios.submitted).toHaveLength(0);
  });

  it("reads the contract in full again after giveme.my's refusal, not its outage (cross-area review)", async () => {
    const t = await unlocked();
    const contract = `${SESSION_CONTRACT_PREFIX}preprod`;
    const summary = await t.transfer.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    const fullAt = (await t.session.get<{ fullAt: number }>(contract))!.fullAt;
    expect(fullAt).toBeGreaterThan(0);
    // An outage says nothing about the kept view: no full read on every retry.
    t.collateral.answer = { status: 503, body: {} };
    await expect(t.transfer.submit("preprod", summary.txHash)).rejects.toThrow("couldn't take this transaction just now");
    expect((await t.session.get<{ fullAt: number }>(contract))!.fullAt).toBe(fullAt);
  });

  it("reads the contract in full for the next review once giveme.my refuses (launch review #53)", async () => {
    const t = await unlocked();
    const contract = `${SESSION_CONTRACT_PREFIX}preprod`;
    const fullReads = () =>
      t.koios.calls.filter(
        (c) => c.path === "credential_utxos" && c.body._payment_credentials.includes(koiosPreprod.wallet_contract) && !c.query.includes("block_height"),
      ).length;
    await t.transfer.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    const summary = await t.transfer.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    expect(fullReads()).toBe(1); // the second read only caught up
    // giveme.my checks the chain first: a UTxO spent elsewhere, which the kept view still has, is one reason it refuses.
    await expect(t.transfer.submit("preprod", summary.txHash)).rejects.toThrow("refused this transaction");
    expect((await t.session.get<{ fullAt: number }>(contract))!.fullAt).toBe(0);
    await t.transfer.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    expect(fullReads()).toBe(2);
  });

  it("submits exactly the signed transaction, then watches it", async () => {
    const t = await unlocked();
    const summary = await t.transfer.build("preprod", [{ to: THEIRS, lovelace: transferPreprod.lovelace, tokens: transferPreprod.tokens }]);
    const built = (await t.session.get<Stored>(SESSION_TRANSFER))!;
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    // Stands in for WebAssembly's signing (Rust tests cover it): returns the transaction as it came.
    const { service, calls } = withSigner(t, (request) => JSON.stringify({ txCbor: request.txCbor, txHash: summary.txHash }));

    const pending = await service.submit("preprod", summary.txHash);
    expect(calls).toEqual([{ txCbor: built.txCbor, seed: built.seed, collateral: { witness: "a1008182" } }]);
    expect(t.collateral.asked).toEqual([built.txCbor]);
    expect(t.koios.submitted.map((b) => txIdOf(b))).toEqual([summary.txHash]);
    expect(pending).toEqual({ kind: "transfer", network: "preprod", txHash: summary.txHash, submittedAt: t.clock.now, confirmations: null });
    expect(await t.session.get(SESSION_TRANSFER)).toBeUndefined();
    expect(await t.session.get(pendingKey("preprod"))).toEqual(pending);

    t.koios.confirmations = 2;
    expect(await t.pending.pending("preprod")).toMatchObject({ kind: "transfer", confirmations: 2 });
  });

  it("says a transfer Koios took was sent already, never that its review is stale, after a lock too", async () => {
    // Its kept copy goes once it's taken: a page that missed the answer (a restarted worker, a lock, another page's
    // Send) found none, was told "Nothing was sent", and "Refresh and review again" built a second payment (chunk
    // 23's second review, fix round).
    const t = await unlocked();
    const summary = await t.transfer.build("preprod", [{ to: THEIRS, lovelace: transferPreprod.lovelace, tokens: transferPreprod.tokens }]);
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    const wasm = loadTestWasm();
    const service = new TransferService({
      ...t.deps,
      wasm: { ...wasm, signScriptSpend: (_key: unknown, r: string) => JSON.stringify({ txCbor: JSON.parse(r).txCbor, txHash: summary.txHash }) } as typeof wasm,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    });
    await service.submit("preprod", summary.txHash);
    const again = await service.submit("preprod", summary.txHash).catch((e: unknown) => e);
    expect((again as Error).message).toMatch(/^That was sent already/);
    expect(again).not.toBeInstanceOf(StaleReviewError);
    // A lock wipes what the session kept of it; the Seedelf history still has it.
    await t.wallet.lock();
    await t.wallet.unlock(PASSWORD);
    await expect(service.submit("preprod", summary.txHash)).rejects.toThrow("That was sent already");
    expect(t.koios.submitted).toHaveLength(1);
    expect(t.collateral.asked).toHaveLength(1);
  });

  it("refuses to send anything but the reviewed transaction", async () => {
    const t = await unlocked();
    await expect(t.transfer.submit("preprod", "00".repeat(32))).rejects.toThrow("That payment isn't ready to send");
    await expect(t.transfer.submit("preprod", "00".repeat(32))).rejects.toBeInstanceOf(StaleReviewError);
    const summary = await t.transfer.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    await expect(t.transfer.submit("preprod", "11".repeat(32))).rejects.toThrow("isn't ready to send");
    await expect(t.transfer.submit("mainnet", summary.txHash)).rejects.toThrow("isn't ready to send");
    // A mint's Send never sends a transfer.
    await expect(t.mint.submit("preprod", summary.txHash)).rejects.toThrow("That Seedelf isn't ready to send");

    t.clock.now += 11 * 60_000;
    await expect(t.transfer.submit("preprod", summary.txHash)).rejects.toThrow("more than 10 minutes ago");
    expect(t.koios.submitted).toHaveLength(0);

    // Lock forgets the built transfer.
    await t.wallet.lock();
    expect(await t.session.get(SESSION_TRANSFER)).toBeUndefined();
  });
});
