// The mint service: build a seedelf mint through WebAssembly on the 12-word
// phrase's synthetic Seedelf UTxOs, with Ogmios's real preprod evaluation;
// keep it unsigned until Send; at Send have giveme.my witness it, sign, and
// submit exactly it.
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { Koios } from "../src/background/koios";
import { MintService, SESSION_MINT } from "../src/background/mint";
import { SESSION_PENDING } from "../src/background/pending";
import { Wallet } from "../src/background/wallet";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const hex = (s: string) => Buffer.from(s).toString("hex");
const bytes = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));

async function unlocked(options?: { owned?: boolean }) {
  const v = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
  const t = testBalances(options);
  await t.wallet.create(v.phrase, PASSWORD);
  return t;
}

type Stored = { txCbor: string; txHash: string; seed: string; builtAt: number };

/** The same deps with WebAssembly's signScriptSpend swapped out. */
function withSigner(t: Awaited<ReturnType<typeof unlocked>>, sign: (request: any) => string) {
  const wasm = loadTestWasm();
  const calls: any[] = [];
  const service = new MintService({
    wasm: { ...wasm, signScriptSpend: (_key: unknown, request: string) => (calls.push(JSON.parse(request)), sign(JSON.parse(request))) } as typeof wasm,
    wallet: t.wallet,
    session: t.session,
    koios: () => new Koios("https://preprod.koios.rest/api/v1", t.koios.fetch, async () => undefined),
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    now: () => t.clock.now,
  });
  return { service, calls };
}

describe("mint", () => {
  it("builds a seedelf mint, measured by Ogmios, without sending anything", async () => {
    const t = await unlocked();
    const summary = await t.mint.build("preprod", "web-wallet");
    expect(summary).toMatchObject({
      network: "preprod",
      label: "web-wallet",
      // Named after the 25 ₳ UTxO, the one that pays.
      tokenName: `5eed0e1f${hex("web-wallet")}00${"a1".repeat(32)}`.slice(0, 64),
      lovelace: "1749860",
      changeOutputs: 1,
      changeTokens: 0,
      inputs: 1,
    });
    const fee = summary.fee;
    expect(Number(fee.total)).toBe(Number(fee.size) + Number(fee.compute) + Number(fee.scriptReference));
    expect(Number(fee.total) % 2).toBe(0);
    expect(Number(fee.total)).toBeGreaterThan(200_000);
    expect(BigInt(summary.changeLovelace)).toBe(25_000_000n - 1_749_860n - BigInt(fee.total));

    // Koios was read and Ogmios measured a draft; nobody else heard of it.
    expect(t.koios.calls.map((c) => c.path).sort()).toEqual(["credential_utxos", "epoch_params", "ogmios"]);
    const draft = t.koios.calls.find((c) => c.path === "ogmios")!.body.params.transaction.cbor as string;
    expect(t.collateral.asked).toHaveLength(0);
    expect(t.koios.submitted).toHaveLength(0);

    // The unsigned transaction waits in session storage: the one summarized, not the draft.
    const built = (await t.session.get<Stored>(SESSION_MINT))!;
    expect(built.txHash).toBe(summary.txHash);
    expect(txIdOf(bytes(built.txCbor))).toBe(summary.txHash);
    expect(txIdOf(bytes(draft))).not.toBe(summary.txHash);
    expect(built.seed).toMatch(/^[0-9a-f]{64}$/);
  });

  it("explains what stops a mint", async () => {
    const t = await unlocked();
    await expect(t.mint.build("preprod", "sixteen chars!!!")).rejects.toThrow("at most 15");
    t.koios.evaluation = {
      jsonrpc: "2.0",
      error: {
        code: 3010,
        message: "Some scripts of the transactions terminated with error(s).",
        data: [{ validator: { index: 0, purpose: "spend" }, error: { code: 3012, data: { validationError: "boom\nCaused by: (error)" } } }],
      },
    };
    await expect(t.mint.build("preprod", "")).rejects.toThrow(
      "The Seedelf contract refused this transaction (spending input 0: Caused by: (error))",
    );

    const empty = await unlocked({ owned: false });
    await expect(empty.mint.build("preprod", "")).rejects.toThrow("Your Seedelf balance is empty");
    expect(empty.koios.calls.map((c) => c.path)).not.toContain("ogmios");

    await t.wallet.lock();
    await expect(t.mint.build("preprod", "")).rejects.toThrow("locked");
  });

  it("sends nothing when giveme.my refuses, or its signature doesn't check out", async () => {
    const t = await unlocked();
    const summary = await t.mint.build("preprod", "");

    // The recorded answer to a transaction giveme.my can't validate.
    await expect(t.mint.submit("preprod", summary.txHash)).rejects.toThrow(
      "giveme.my, which lends the collateral, refused this transaction: Transaction Fails Validation",
    );
    expect(t.collateral.asked).toEqual([(await t.session.get<Stored>(SESSION_MINT))!.txCbor]);

    // A witness that isn't giveme.my's key over this transaction.
    t.collateral.answer = { status: 200, body: { witness: `a10081825820${"11".repeat(32)}5840${"22".repeat(64)}` } };
    await expect(t.mint.submit("preprod", summary.txHash)).rejects.toThrow("doesn't match this transaction");

    expect(t.koios.submitted).toHaveLength(0);
    expect(await t.session.get(SESSION_MINT)).toBeDefined(); // Send can be tried again
    expect(await t.session.get(SESSION_PENDING)).toBeUndefined();
  });

  it("signs after a worker restart: the one-time key comes back from the seed", async () => {
    const t = await unlocked();
    const summary = await t.mint.build("preprod", "");
    // A new worker: new wallet object and services over the same session storage.
    const wasm = loadTestWasm();
    const wallet = new Wallet({
      wasm,
      local: t.local,
      session: t.session,
      now: () => t.clock.now,
      autoLock: { start: async () => undefined, stop: async () => undefined },
      changed: () => undefined,
    });
    const restarted = new MintService({
      wasm,
      wallet,
      session: t.session,
      koios: () => new Koios("https://preprod.koios.rest/api/v1", t.koios.fetch, async () => undefined),
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      now: () => t.clock.now,
    });
    t.collateral.answer = { status: 200, body: { witness: `a10081825820${"11".repeat(32)}5840${"22".repeat(64)}` } };
    // It got past the one-time key (same key re-derived) to giveme.my's signature.
    await expect(restarted.submit("preprod", summary.txHash)).rejects.toThrow("doesn't match this transaction");
  });

  it("submits exactly the signed transaction, then watches it", async () => {
    const t = await unlocked();
    const summary = await t.mint.build("preprod", "web-wallet");
    const built = (await t.session.get<Stored>(SESSION_MINT))!;
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    // Stands in for WebAssembly's signing (Rust tests cover it): returns the transaction as it came.
    const { service, calls } = withSigner(t, (request) => JSON.stringify({ txCbor: request.txCbor, txHash: summary.txHash }));

    const pending = await service.submit("preprod", summary.txHash);
    expect(calls).toEqual([{ txCbor: built.txCbor, seed: built.seed, collateral: { witness: "a1008182" } }]);
    expect(t.koios.submitted.map((b) => txIdOf(b))).toEqual([summary.txHash]);
    expect(pending).toEqual({ kind: "mint", network: "preprod", txHash: summary.txHash, submittedAt: t.clock.now, confirmations: null });
    expect(await t.session.get(SESSION_MINT)).toBeUndefined();
    expect(await t.session.get(SESSION_PENDING)).toEqual(pending);

    // The shared watch reports it, and forgets it once confirmed.
    t.koios.confirmations = 1;
    expect(await t.pending.pending()).toMatchObject({ kind: "mint", confirmations: 1 });
    expect(await t.pending.pending()).toBeNull();
  });

  it("refuses to send anything but the reviewed transaction", async () => {
    const t = await unlocked();
    await expect(t.mint.submit("preprod", "00".repeat(32))).rejects.toThrow("isn't ready to send");
    const summary = await t.mint.build("preprod", "");
    await expect(t.mint.submit("preprod", "11".repeat(32))).rejects.toThrow("isn't ready to send");
    await expect(t.mint.submit("mainnet", summary.txHash)).rejects.toThrow("isn't ready to send");

    // Signing that changed the transaction is caught before submitting.
    const { service } = withSigner(t, (request) => JSON.stringify({ txCbor: request.txCbor, txHash: "33".repeat(32) }));
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    await expect(service.submit("preprod", summary.txHash)).rejects.toThrow("Signing changed the transaction");

    t.clock.now += 11 * 60_000;
    await expect(t.mint.submit("preprod", summary.txHash)).rejects.toThrow("more than 10 minutes ago");
    expect(t.koios.submitted).toHaveLength(0);

    // Lock forgets the built mint.
    await t.wallet.lock();
    expect(await t.session.get(SESSION_MINT)).toBeUndefined();
  });
});
