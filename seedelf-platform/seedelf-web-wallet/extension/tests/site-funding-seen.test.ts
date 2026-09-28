// A site's private session's funding that any read has seen land is recorded
// so (final review F13): the connector's window seeing it at the account,
// the worker's runs finding it on chain (no page open), a list or a
// Disconnect reading it there. From then on only Koios showing what it paid
// spent ends the session, never a backend behind it that knows nothing of
// it. And one no read saw land isn't taken for one never sent while it may
// still land: two hours from when it was sent. Otherwise Disconnect, after
// twenty minutes and on reads that lag, would drop a session still holding
// its money. The 12-word phrase, the real WebAssembly, and fakes of Koios,
// giveme.my and Minswap's aggregator.
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { DappService, type DappSession } from "../src/background/dapp";
import type { KoiosUtxo } from "../src/background/koios";
import { builtOutputs, Minswap } from "../src/background/minswap";
import { SessionService } from "../src/background/sessions";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, ownedUtxos, sessionSwap, testBalances, vectors, withdrawPreprod } from "./fakes";

const PASSWORD = "correct horse battery";
const ORIGIN = "https://app.example.com";
const phrase = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase as string;
const NOT_CAUGHT_UP = "Koios hasn't caught up with this session yet";
const UNSEEN = "The chain hasn't shown this session's funding";
/** A funding the chain doesn't have after this long is shown as never funded (sessions.ts). */
const FAILED_AFTER = 20 * 60_000 + 1;

let pages = 0;
const site = (): DappSession => ({ id: `seen${++pages}`, origin: ORIGIN, title: "Example" });

async function until(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 200 && !(await check()); i++) await new Promise((r) => setTimeout(r, 0));
  expect(await check()).toBe(true);
}

async function on() {
  const t = testBalances();
  await t.wallet.create(phrase, PASSWORD);
  await t.preferences.set({ dappConnector: true, spendRewards: false });
  return t;
}
type T = Awaited<ReturnType<typeof on>>;

/** The connector over sessions whose giveme.my witness and Seedelf signature are stood in for, as dapp.test.ts has them; the alarm counts its starts. */
function privately(t: T) {
  const wasm = loadTestWasm();
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  const evaluation = withdrawPreprod.amount.evaluation as { result: unknown[] };
  t.koios.evaluation = { ...evaluation, result: evaluation.result.slice(0, 1) };
  const alarm = { starts: 0, start: async () => void alarm.starts++ };
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
    alarm,
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
  return { dapp, sessions, alarm };
}

/** A UTxO at session 0's account, as Koios lists it. */
function atSession(tx_hash: string, tx_index: number, value: string): KoiosUtxo {
  return {
    ...(sessionSwap.utxo as unknown as KoiosUtxo),
    tx_hash,
    tx_index,
    value,
    payment_cred: sessionSwap.keyHash,
    stake_address: null,
    block_height: 5_000_000,
    asset_list: [],
    is_spent: false,
  } as KoiosUtxo;
}

/** What transaction `tx` paid session 0's account, as Koios lists it once it lands. */
function landed(tx: Uint8Array): KoiosUtxo[] {
  const id = txIdOf(tx);
  return builtOutputs(tx).flatMap((o, i) =>
    o.address.slice(2, 58) === sessionSwap.keyHash ? [atSession(id, i, o.lovelace.toString())] : [],
  );
}

/** Session 0's funding, as the sealed record has it. */
async function funding(t: T) {
  const book = await t.store.get<{ sessions: Array<{ index: number; txs: Array<{ kind: string; confirmed?: boolean }> }> }>(
    "sessions.preprod",
  );
  return book?.sessions.find((s) => s.index === 0)?.txs[0];
}

/** Every Koios backend that answers is behind the funding: tx_status, the account and utxo_info know nothing of it. */
function behind(t: T, txHash: string) {
  t.koios.missing.add(txHash);
  t.koios.addedToAccounts.length = 0;
}

/** Moves the clock on by `ms`, the user busy all along, so the wallet doesn't lock itself. */
async function busy(t: T, ms: number) {
  for (let left = ms; left > 0; left -= 10 * 60_000) {
    t.clock.now += Math.min(left, 10 * 60_000);
    await t.wallet.touch();
  }
}

describe("a site's private session's funding seen landing (final review F13)", () => {
  it("is recorded when the connector's window sees it, so a Disconnect on reads behind it later keeps the session", async () => {
    const t = await on();
    const { dapp } = privately(t);
    const s = site();
    const enabling = dapp.call(s, "enable", []);
    await until(() => dapp.approvals().length === 1);
    const out = await dapp.privateBuild(dapp.approvals()[0]!.id, "15000000", []);
    await dapp.answer(dapp.approvals()[0]!.id, true, PASSWORD, { txHash: out.txHash });
    // It lands, and the window sees it at the account; tx_status never showed it, and the dApps page is never opened.
    t.koios.missing.add(out.txHash);
    t.koios.addedToAccounts.push(...landed(t.koios.submitted.at(-1)!));
    expect(await enabling).toBe(true);
    await until(async () => !!(await funding(t))?.confirmed);

    // Twenty minutes on, every backend that answers is behind it: Disconnect refuses, and the record stays.
    await busy(t, FAILED_AFTER);
    behind(t, out.txHash);
    await expect(dapp.forget(s.origin)).rejects.toThrow(NOT_CAUGHT_UP);
    expect(await funding(t)).toMatchObject({ kind: "out", confirmed: true });
    expect(await dapp.sites()).toHaveLength(1);
  });

  it("is looked for by the worker's runs, with no page open, and recorded once tx_status shows it", async () => {
    const t = await on();
    const { sessions, alarm } = privately(t);
    const out = await sessions.siteOutBuild("preprod", ORIGIN, "15000000", []);
    await sessions.siteOutSubmit("preprod", out.txHash, ORIGIN);
    // Sending it starts the runs; one Koios hasn't seen land keeps them going.
    expect(alarm.starts).toBeGreaterThan(0);
    expect(await sessions.runAll("preprod")).toBe(true);
    expect(await funding(t)).not.toHaveProperty("confirmed");
    // The runs ask tx_status only: they never read a site's session's account by themselves.
    const asked = t.koios.calls.length;
    t.koios.confirmations = 1;
    expect(await sessions.runAll("preprod")).toBe(false);
    expect(t.koios.calls.slice(asked).map((c) => c.path)).toEqual(["tx_status"]);
    expect(await funding(t)).toMatchObject({ confirmed: true });
    expect((await sessions.list("preprod"))[0]!.stage).not.toBe("failed");

    // Later, on reads behind it: kept.
    await busy(t, FAILED_AFTER);
    behind(t, out.txHash);
    await expect(sessions.disconnect("preprod", 0)).rejects.toThrow(NOT_CAUGHT_UP);
    expect(await funding(t)).toBeDefined();
  });

  it("is recorded by a Disconnect whose read of the account lists it, a top-up's too", async () => {
    const t = await on();
    const { sessions } = privately(t);
    const out = await sessions.siteOutBuild("preprod", ORIGIN, "15000000", []);
    await sessions.siteOutSubmit("preprod", out.txHash, ORIGIN);
    const funded = t.koios.submitted.at(-1)!;
    t.koios.missing.add(out.txHash);
    t.koios.addedToAccounts.push(...landed(funded));
    // Twenty minutes on, tx_status still doesn't show it, and nothing else has read the account.
    await busy(t, FAILED_AFTER);
    await expect(sessions.disconnect("preprod", 0)).rejects.toThrow("Bring it back first");
    expect(await funding(t)).toMatchObject({ confirmed: true });

    // A top-up tx_status doesn't show, from more of the private balance, listed at the account by the dApps
    // page's refresh.
    t.koios.added.push({ ...ownedUtxos[0]!, tx_hash: "0e".repeat(32), block_height: 9_000_001 });
    const more = await sessions.topUpBuild("preprod", 0, "3000000", []);
    await sessions.topUpSubmit("preprod", more.txHash);
    t.koios.missing.add(more.txHash);
    t.koios.addedToAccounts.push(...landed(t.koios.submitted.at(-1)!));
    await sessions.list("preprod", true);
    const book = await t.store.get<{ sessions: Array<{ txs: Array<{ txHash: string; confirmed?: boolean }> }> }>("sessions.preprod");
    expect(book!.sessions[0]!.txs.find((x) => x.txHash === more.txHash)).toMatchObject({ confirmed: true });
  });
});

describe("a site's private session's funding no read has seen land (final review F13)", () => {
  it("isn't taken for one never sent while it may still land: two hours from when it was sent", async () => {
    const t = await on();
    const { sessions } = privately(t);
    const out = await sessions.siteOutBuild("preprod", ORIGIN, "15000000", []);
    await sessions.siteOutSubmit("preprod", out.txHash, ORIGIN);
    // Neither tx_status nor the account nor utxo_info ever shows it, and no run looked meanwhile.
    t.koios.missing.add(out.txHash);
    await busy(t, FAILED_AFTER);
    expect((await sessions.list("preprod", true))[0]!.stage).toBe("failed");
    await expect(sessions.disconnect("preprod", 0)).rejects.toThrow(UNSEEN);
    expect(await funding(t)).toBeDefined();

    // It landed after all, and a backend that knows it answers: the session goes on, its funding recorded.
    t.koios.addedToAccounts.push(...landed(t.koios.submitted.at(-1)!));
    await expect(sessions.disconnect("preprod", 0)).rejects.toThrow("Bring it back first");
    expect(await funding(t)).toMatchObject({ confirmed: true });
  });

  it("ends the empty session once two hours have passed with Koios still knowing nothing of it", async () => {
    const t = await on();
    const { sessions } = privately(t);
    const out = await sessions.siteOutBuild("preprod", ORIGIN, "15000000", []);
    await sessions.siteOutSubmit("preprod", out.txHash, ORIGIN);
    t.koios.missing.add(out.txHash);
    await busy(t, 2 * 60 * 60_000 - 60_000);
    await expect(sessions.disconnect("preprod", 0)).rejects.toThrow(UNSEEN);
    // Nor do the runs look for it any longer than that.
    await busy(t, 60_000);
    expect(await sessions.runAll("preprod")).toBe(false);
    await sessions.disconnect("preprod", 0);
    expect(await t.store.get("sessions.preprod")).toEqual({ next: 1, sessions: [] });
  });

  it("isn't waited for when Koios turned it away: it never went", async () => {
    const t = await on();
    const { sessions } = privately(t);
    const out = await sessions.siteOutBuild("preprod", ORIGIN, "15000000", []);
    t.koios.rejectSubmit = "ConwayUtxowFailure (UtxoFailure (ValueNotConservedUTxO))";
    await expect(sessions.siteOutSubmit("preprod", out.txHash, ORIGIN)).rejects.toThrow();
    t.koios.rejectSubmit = undefined;
    const asked = t.koios.calls.length;
    expect(await sessions.runAll("preprod")).toBe(false);
    expect(t.koios.calls.length).toBe(asked);
    await sessions.disconnect("preprod", 0);
    expect(await t.store.get("sessions.preprod")).toEqual({ next: 1, sessions: [] });
  });
});
