// A site's page that goes away while its request waits (a prompt, the unlock
// window, a private session's funding on its way) has that request settled,
// though nobody hears it: its call ends and gives back its share of the
// site's 32 (independent review L31). Otherwise a site reloaded mid-prompt 32
// times would be refused everything until the worker restarts.
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { DappService, type DappSession } from "../src/background/dapp";
import type { KoiosUtxo } from "../src/background/koios";
import { Minswap } from "../src/background/minswap";
import { SESSION_SEND } from "../src/background/send";
import { SessionService } from "../src/background/sessions";
import { APIError } from "../src/shared/dapp";
import { loadTestWasm, sessionSwap, testBalances, vectors, withdrawPreprod } from "./fakes";
import { txIdOf } from "./fixtures/cbor";

const PASSWORD = "correct horse battery";
const account = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
const ORIGIN = "https://app.example.com";
const BUSY = { failure: { code: APIError.Refused, info: "Seedelf Wallet is busy with this site's other requests." } };
const THEIRS = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 15)!.preprod
  .receive_0 as string;

let pages = 0;
const page = (origin = ORIGIN): DappSession => ({ id: `gone${++pages}`, origin, title: "Example" });

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}

async function on() {
  const t = testBalances();
  await t.wallet.create(account.phrase, PASSWORD);
  await t.preferences.set({ dappConnector: true, spendRewards: false });
  return t;
}

describe("a site's page that goes away while its request waits", () => {
  it("ends the call, so 32 reloads mid-prompt never lock the site out", async () => {
    const t = await on();
    for (let i = 0; i < 40; i++) {
      const s = page();
      const enabling = t.dapp.call(s, "enable", []);
      await until(() => t.dapp.approvals().length === 1);
      t.dapp.gone(s);
      await expect(enabling).rejects.toMatchObject({ failure: { code: APIError.Refused, info: "The page went away." } });
      expect(t.dapp.approvals()).toEqual([]);
    }
    expect(await t.dapp.call(page(), "isEnabled", [])).toBe(false);
    // A page still there is asked, as ever.
    const s = page();
    const enabling = t.dapp.call(s, "enable", []);
    await until(() => t.dapp.approvals().length === 1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
    expect(await enabling).toBe(true);
  });

  it("ends a call waiting for the unlock too, and an unlock afterwards lets the site on", async () => {
    const t = await on();
    await t.wallet.lock();
    for (let i = 0; i < 40; i++) {
      const s = page();
      const enabling = t.dapp.call(s, "enable", []);
      await until(() => t.dapp.unlockingSites().length === 1);
      t.dapp.gone(s);
      await expect(enabling).rejects.toMatchObject({ failure: { info: "The page went away." } });
      expect(t.dapp.unlockingSites()).toEqual([]);
    }
    await t.wallet.unlock(PASSWORD);
    await t.dapp.stateChanged();
    const s = page();
    const enabling = t.dapp.call(s, "enable", []);
    await until(() => t.dapp.approvals().length === 1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
    expect(await enabling).toBe(true);
    await expect(t.dapp.call(s, "getNetworkId", [])).resolves.toBe(0);
  });

  it("ends one waiting for its private session's funding: the site finds itself connected next time", async () => {
    const t = await on();
    const wasm = loadTestWasm();
    // giveme.my's witness and the Seedelf signature stood in for, as dapp.test.ts does.
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    const evaluation = withdrawPreprod.amount.evaluation as { result: unknown[] };
    t.koios.evaluation = { ...evaluation, result: evaluation.result.slice(0, 1) };
    const sessions = new SessionService({
      ...t.deps,
      wasm: {
        ...wasm,
        signScriptSpend: (_key: unknown, request: string) => {
          const { txCbor } = JSON.parse(request) as { txCbor: string };
          return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
        },
      } as typeof wasm,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      store: t.store,
      minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
    });
    const dapp = new DappService({
      ...t.deps,
      store: t.store,
      sessions,
      fundingPollMs: 1,
      network: () => "preprod",
      window: t.dappWindow,
      changed: () => undefined,
    });
    const s = page();
    const enabling = dapp.call(s, "enable", []);
    await until(() => dapp.approvals().length === 1);
    const out = await dapp.privateBuild(dapp.approvals()[0]!.id, "15000000", []);
    expect(await dapp.answer(dapp.approvals()[0]!.id, true, PASSWORD, { txHash: out.txHash })).toEqual({});
    expect(dapp.approvals()).toMatchObject([{ funding: { index: 0 } }]);

    dapp.gone(s);
    await expect(enabling).rejects.toMatchObject({ failure: { info: "The page went away." } });
    expect(dapp.approvals()).toEqual([]);
    // The funding went out, and the site is connected to its session.
    const atSession = (tx_hash: string, tx_index: number, value: string) =>
      ({ ...(sessionSwap.utxo as unknown as KoiosUtxo), tx_hash, tx_index, value, payment_cred: sessionSwap.keyHash, stake_address: null, block_height: 1, asset_list: [] }) as KoiosUtxo;
    t.koios.addedToAccounts.push(atSession(out.txHash, 0, "15000000"), atSession(out.txHash, 1, "5000000"));
    expect(await dapp.call(page(), "enable", [])).toBe(true);
    expect(await dapp.sites()).toEqual([{ origin: ORIGIN, connectedAt: expect.any(Number), session: 0 }]);
  });

  it("never asks for a page that went away while its transaction was being read", async () => {
    const t = await on();
    const s = page();
    const enabling = t.dapp.call(s, "enable", []);
    await until(() => t.dapp.approvals().length === 1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
    await enabling;
    await t.send.build("preprod", [{ to: THEIRS, lovelace: "3000000", tokens: [] }]);
    const tx = (await t.session.get<{ txCbor: string }>(SESSION_SEND))!.txCbor;
    // Koios is slow to answer the reading of the account the transaction spends from.
    t.clock.now += 31_000;
    let release!: () => void;
    t.koios.hold = new Promise((r) => (release = r));
    const calls = t.koios.calls.length;
    const signing = t.dapp.call(s, "signTx", [tx, false]).catch((e: { failure: unknown }) => e.failure);
    await until(() => t.koios.calls.length > calls);
    t.dapp.gone(s);
    release();
    t.koios.hold = undefined;
    expect(await signing).toEqual({ code: APIError.Refused, info: "The page went away." });
    expect(t.dapp.approvals()).toEqual([]);
    // The site's other pages are asked as ever.
    const again = t.dapp.call(page(), "signTx", [tx, false]);
    await until(() => t.dapp.approvals().length === 1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, false);
    await expect(again).rejects.toMatchObject({ failure: { info: "The user declined." } });
  });

  it("still refuses a 33rd call while 32 of a site's are really running", async () => {
    const t = await on();
    const s = page();
    const enabling = t.dapp.call(s, "enable", []);
    await until(() => t.dapp.approvals().length === 1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
    await enabling;
    t.clock.now += 31_000;
    let release!: () => void;
    t.koios.hold = new Promise((r) => (release = r));
    const running = Array.from({ length: 32 }, () => t.dapp.call(page(), "getBalance", []));
    await until(() => t.koios.calls.some((c) => c.path === "account_addresses"));
    await expect(t.dapp.call(page(), "getBalance", [])).rejects.toMatchObject(BUSY);
    release();
    t.koios.hold = undefined;
    await Promise.all(running);
  });
});
