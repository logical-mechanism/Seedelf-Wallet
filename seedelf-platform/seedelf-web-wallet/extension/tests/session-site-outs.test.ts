// A site's own transactions, signed for its private session, can pay the
// session's account too (change, a refund the site builds): the wallet
// records what they pay it before the site has the signature, and
// Disconnect waits, as for a funding, until Koios shows each it knows spent
// (independent review M4). Otherwise a backend that knows the site's
// transaction spent the funding, next to one behind that reads the account
// empty, would end a session that still holds the site's change. The
// 12-word phrase, the real WebAssembly, and fakes of Koios, giveme.my and
// Minswap's aggregator.
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { DappService, type DappSession } from "../src/background/dapp";
import type { KoiosUtxo } from "../src/background/koios";
import { builtOutputs, Minswap } from "../src/background/minswap";
import { SessionService } from "../src/background/sessions";
import { TxSignError } from "../src/shared/dapp";
import type { DappTxSummary } from "../src/shared/rpc";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, sessionSwap, testBalances, vectors, withdrawPreprod } from "./fakes";

const PASSWORD = "correct horse battery";
const phrase = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase as string;
const NOT_CAUGHT_UP = "Koios hasn't caught up with this session yet";

type T = Awaited<ReturnType<typeof on>>;

let sessionsSeen = 0;
const site = (): DappSession => ({ id: `s${++sessionsSeen}`, origin: "https://app.example.com", title: "Example" });

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}

async function on() {
  const t = testBalances();
  await t.wallet.create(phrase, PASSWORD);
  await t.preferences.set({ dappConnector: true, spendRewards: false });
  return t;
}

/** The connector over a session service whose giveme.my witness and Seedelf signature are stood in for, as dapp.test.ts does. */
function privately(t: T) {
  const wasm = loadTestWasm();
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
  return { dapp, sessions };
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

const uint = (n: number) => (n < 24 ? n.toString(16).padStart(2, "0") : `18${n.toString(16).padStart(2, "0")}`);
const outpoints = (list: string[]) =>
  `8${list.length}${list.map((o) => `825820${o.slice(0, 64)}${uint(Number(o.slice(65)))}`).join("")}`;
const coin = (n: bigint) => `1a${n.toString(16).padStart(8, "0")}`;

/** A site's transaction, built by hand as dapp.test.ts does: it spends `inputs` and pays `lovelace` to session 0's account. */
function siteTx(inputs: string[], lovelace: bigint) {
  const address = loadTestWasm().cip30Address(sessionSwap.address);
  return `84a300${outpoints(inputs)}0181825839${address}${coin(lovelace)}021a00029810a0f5f6`;
}

/**
 * A site connected to session 0, whose funding landed at its account:
 * `funding`, what it paid the account (15 ₳, and 5 ₳ of collateral).
 */
async function connected(t: T, dapp: DappService, s = site()) {
  const enabling = dapp.call(s, "enable", []);
  await until(() => dapp.approvals().length === 1);
  const out = await dapp.privateBuild(dapp.approvals()[0]!.id, "15000000", []);
  await dapp.answer(dapp.approvals()[0]!.id, true, PASSWORD, { txHash: out.txHash });
  // Its outputs come in a random order: the 15 ₳ first here.
  const funding = builtOutputs(t.koios.submitted.at(-1)!)
    .flatMap((o, i) =>
      o.address.slice(2, 58) === sessionSwap.keyHash ? [{ ref: `${out.txHash}#${i}`, lovelace: o.lovelace }] : [],
    )
    .sort((a, b) => Number(b.lovelace - a.lovelace))
    .map((o) => ({ ...o, lovelace: o.lovelace.toString() }));
  expect(funding.map((o) => o.lovelace)).toEqual(["15000000", "5000000"]);
  for (const o of funding) t.koios.addedToAccounts.push(atSession(out.txHash, Number(o.ref.split("#")[1]), o.lovelace));
  expect(await enabling).toBe(true);
  t.koios.confirmations = 1;
  return { s, funding: funding.map((o) => o.ref) };
}

/** The site's transaction, signed with the user's yes. */
async function signed(dapp: DappService, s: DappSession, tx: string) {
  const signing = dapp.call(s, "signTx", [tx, false]);
  await until(() => dapp.approvals().length === 1);
  expect(await dapp.answer(dapp.approvals()[0]!.id, true, PASSWORD)).toEqual({});
  return signing;
}

/** The sealed record of session 0. */
async function record(t: T) {
  const book = await t.store.get<{ sessions: Array<{ index: number; siteOuts?: string[] }> }>("sessions.preprod");
  return book?.sessions.find((r) => r.index === 0);
}

/** A backend behind the account's read: `credential_utxos` doesn't list `outs`, which `utxo_info` knows. */
function hiding(t: T, outs: string[]) {
  const real = t.koios.fetch;
  t.koios.fetch = async (url: string, init: RequestInit) => {
    const answer = await real(url, init);
    if (!url.includes("/credential_utxos")) return answer;
    const rows = (await answer.json()) as KoiosUtxo[];
    return Response.json(rows.filter((u) => !outs.includes(`${u.tx_hash}#${u.tx_index}`)));
  };
  return () => void (t.koios.fetch = real);
}

describe("a site's transaction signed for its private session", () => {
  it("has what it pays the session's account recorded before the site gets the signature", async () => {
    const t = await on();
    const { dapp } = privately(t);
    const { s, funding } = await connected(t, dapp);
    const tx = siteTx(funding, 17_000_000n);
    const id = txIdOf(Uint8Array.from(Buffer.from(tx, "hex")));
    expect(((await signed(dapp, s, tx)) as string).slice(0, 4)).toBe("a100");
    expect((await record(t))!.siteOuts).toEqual([`${id}#0`]);
  });

  it("holds the session open while Koios knows that transaction spent its funding, but reads the account behind it", async () => {
    const t = await on();
    const { dapp } = privately(t);
    const { s, funding } = await connected(t, dapp);
    // The site's transaction takes the whole funding, and pays its 17 ₳ of change back to the account.
    const tx = siteTx(funding, 17_000_000n);
    const id = txIdOf(Uint8Array.from(Buffer.from(tx, "hex")));
    await signed(dapp, s, tx);

    // It lands. One backend is past it (utxo_info: the funding spent, its change unspent); the one reading
    // the account is behind it, and doesn't list the change.
    for (const o of funding) t.koios.spent.add(o);
    t.koios.addedToAccounts.push(atSession(id, 0, "17000000"));
    const caughtUp = hiding(t, [`${id}#0`]);
    await expect(dapp.forget(s.origin)).rejects.toThrow(NOT_CAUGHT_UP);
    expect(await record(t)).toBeDefined();
    expect(await dapp.sites()).toHaveLength(1);

    // Caught up: the change is there to bring back.
    caughtUp();
    await expect(dapp.forget(s.origin)).rejects.toThrow("Bring it back first");

    // Spent since (brought back): the session ends, and its record goes.
    t.koios.spent.add(`${id}#0`);
    expect(await dapp.forget(s.origin)).toEqual([]);
    expect(await record(t)).toBeUndefined();
  });

  it("doesn't hold it open when Koios never saw that transaction: the site may never have sent it", async () => {
    const t = await on();
    const { dapp } = privately(t);
    const { s, funding } = await connected(t, dapp);
    await signed(dapp, s, siteTx([funding[0]!], 14_000_000n));
    // The funding came back some other way, and the site's transaction never went out.
    for (const o of funding) t.koios.spent.add(o);
    expect(await dapp.forget(s.origin)).toEqual([]);
    expect(await record(t)).toBeUndefined();
  });

  it("gets no signature for a session that ended while the user was asked", async () => {
    const t = await on();
    const { dapp } = privately(t);
    const { s, funding } = await connected(t, dapp);
    const signing = dapp.call(s, "signTx", [siteTx([funding[0]!], 14_000_000n), false]);
    await until(() => dapp.approvals().length === 1);
    // Meanwhile the session's record went (it was disconnected in Settings, say).
    await t.store.set("sessions.preprod", { next: 1, sessions: [] });
    const { error } = await dapp.answer(dapp.approvals()[0]!.id, true, PASSWORD);
    expect(error).toBeTruthy();
    await expect(signing).rejects.toMatchObject({ failure: { code: TxSignError.ProofGeneration } });
  });
});

describe("what a site's signed transactions paid a session", () => {
  const summary = (txHash: string, indexes: number[]) =>
    ({ txHash, ownOutputs: indexes.map((txIndex) => ({ txIndex })) }) as unknown as Pick<DappTxSummary, "txHash" | "ownOutputs">;

  it("is read as WebAssembly read it when its bytes can't be read here, and keeps the newest 40", async () => {
    const t = await on();
    const { dapp, sessions } = privately(t);
    await connected(t, dapp);
    await sessions.siteSigned("preprod", 0, "00", summary("ab".repeat(32), [1, 2]));
    expect((await record(t))!.siteOuts).toEqual([`${"ab".repeat(32)}#1`, `${"ab".repeat(32)}#2`]);
    for (let i = 0; i < 25; i++) await sessions.siteSigned("preprod", 0, "00", summary(i.toString(16).padStart(64, "0"), [0, 1]));
    const kept = (await record(t))!.siteOuts!;
    expect(kept).toHaveLength(40);
    expect(kept.at(-1)).toBe(`${(24).toString(16).padStart(64, "0")}#1`);
    expect(kept).not.toContain(`${"ab".repeat(32)}#1`);
    // Nothing paid to the account: nothing recorded.
    await sessions.siteSigned("preprod", 0, "00", summary("cd".repeat(32), []));
    expect((await record(t))!.siteOuts).toEqual(kept);
  });

  it("isn't recorded for a session that's gone", async () => {
    const t = await on();
    const { sessions } = privately(t);
    const signing = sessions.siteSigned("preprod", 0, "00", summary("ab".repeat(32), [0]));
    await expect(signing).rejects.toThrow("There's no such session.");
  });
});
