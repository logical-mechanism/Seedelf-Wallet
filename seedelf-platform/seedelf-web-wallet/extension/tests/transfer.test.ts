// The transfer service: find a seedelf by its full name in the whole wallet
// contract, build a payment to it through WebAssembly on the 12-word
// phrase's synthetic Seedelf UTxOs with Ogmios's real preprod evaluation,
// keep it unsigned until Send, then have giveme.my witness it, sign, and
// submit exactly it.
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { Koios } from "../src/background/koios";
import { SESSION_PENDING } from "../src/background/pending";
import { SESSION_TRANSFER, TransferService } from "../src/background/transfer";
import { SEEDELF_NAME_RULE } from "../src/shared/seedelf-name";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, ownedUtxos, testBalances, transferPreprod, vectors } from "./fakes";

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
      await expect(t.transfer.lookup("preprod", bad)).rejects.toThrow(SEEDELF_NAME_RULE);
    }
    expect(t.koios.calls).toHaveLength(0);
    await expect(t.transfer.lookup("preprod", `5eed0e1f${"00".repeat(28)}`)).rejects.toThrow(
      "No Seedelf with that name on preprod.",
    );
  });
});

describe("transfer", () => {
  it("builds a payment, measured by Ogmios, without sending anything", async () => {
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
    expect(fee.total).toBe(transferPreprod.final.fee.total);
    expect(Number(fee.total)).toBe(Number(fee.size) + Number(fee.compute) + Number(fee.scriptReference));
    expect(Number(fee.scriptReference)).toBe(629 * 15); // the wallet script only
    expect(BigInt(summary.changeLovelace)).toBe(28_000_000n - 5_000_000n - BigInt(fee.total));

    // Koios was read and Ogmios measured a draft; nobody else heard of it.
    expect(t.koios.calls.map((c) => c.path).sort()).toEqual(["credential_utxos", "epoch_params", "ogmios"]);
    expect(t.collateral.asked).toHaveLength(0);
    expect(t.koios.submitted).toHaveLength(0);

    // The unsigned transaction waits in session storage, with its seed.
    const built = (await t.session.get<Stored>(SESSION_TRANSFER))!;
    expect(txIdOf(bytes(built.txCbor))).toBe(summary.txHash);
    expect(built.seed).toMatch(/^[0-9a-f]{64}$/);
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
    // The contract read once for both, and Ogmios once.
    expect(t.koios.calls.map((c) => c.path).sort()).toEqual(["credential_utxos", "epoch_params", "ogmios"]);
    await expect(t.transfer.build("preprod", [])).rejects.toThrow("someone to pay");
  });

  it("raises a short amount to the least the payment needs", async () => {
    const t = await unlocked();
    const tokens = [{ ...transferPreprod.tokens[0]!, quantity: "1" }];
    for (const asked of ["0", "1000000"]) {
      const [paid] = (await t.transfer.build("preprod", [{ to: THEIRS, lovelace: asked, tokens: tokens }])).payments;
      expect(paid!.lovelace).toBe(paid!.minimum);
      expect(BigInt(paid!.minimum)).toBeGreaterThan(1_000_000n);
    }
  });

  it("explains what stops a transfer", async () => {
    const t = await unlocked();
    await expect(t.transfer.build("preprod", [{ to: "5eed0e1f", lovelace: "2000000", tokens: [] }])).rejects.toThrow(SEEDELF_NAME_RULE);
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
    expect(await t.session.get(SESSION_PENDING)).toBeUndefined();
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
    expect(await t.session.get(SESSION_PENDING)).toEqual(pending);

    t.koios.confirmations = 2;
    expect(await t.pending.pending()).toMatchObject({ kind: "transfer", confirmations: 2 });
  });

  it("refuses to send anything but the reviewed transaction", async () => {
    const t = await unlocked();
    await expect(t.transfer.submit("preprod", "00".repeat(32))).rejects.toThrow("That payment isn't ready to send");
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
