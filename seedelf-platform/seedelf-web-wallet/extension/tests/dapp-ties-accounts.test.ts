// A private session's signing prompt matches what the transaction pays, or
// spends, against every public account the wallet knows, not only the one on
// screen (the release review). It knew the active account alone: a session's
// transaction paying another, the dApp account included, read "Your public
// account and your private balance aren't in it.", and signing tied the
// session, and the private balance that funded it, to that account on chain.
// With the accounts unread, the prompt promises nothing.
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { DappService, type DappSession } from "../src/background/dapp";
import type { KoiosUtxo } from "../src/background/koios";
import { Minswap } from "../src/background/minswap";
import { SessionService } from "../src/background/sessions";
import type { DappApproval } from "../src/shared/rpc";
import { loadTestWasm, sessionSwap, testBalances, vectors, withdrawPreprod } from "./fakes";
import { txIdOf } from "./fixtures/cbor";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
const THEIRS = account(15).preprod.receive_0 as string;
const SESSION_INPUT = `${sessionSwap.utxo.tx_hash}#${sessionSwap.utxo.tx_index}`;

let pages = 0;
const site = (origin = "https://app.example.com"): DappSession => ({ id: `tiesacct${++pages}`, origin, title: "Example" });

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}

const uint = (n: number) => (n < 24 ? n.toString(16).padStart(2, "0") : `18${n.toString(16).padStart(2, "0")}`);
const outpoints = (list: string[]) => `8${list.length}${list.map((o) => `825820${o.slice(0, 64)}${uint(Number(o.slice(65)))}`).join("")}`;
const bytesOf = (hex: string) => `58${(hex.length / 2).toString(16).padStart(2, "0")}${hex}`;

/** A site's transaction: it spends `inputs` and pays 4 ₳ to each address (CIP-30 hex). The wallet only reads it. */
function paying(inputs: string[], to: string[]) {
  const outputs = `8${to.length}${to.map((a) => `82${bytesOf(a)}1a003d0900`).join("")}`;
  return `84a300${outpoints(inputs)}01${outputs}021a00029810a0f5f6`;
}

/** The 12-word wallet with three public accounts, the connector on. */
async function on() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  await t.accounts.recordFirst();
  await t.accounts.add(1);
  await t.accounts.add(2);
  await t.preferences.set({ dappConnector: true, spendRewards: false });
  return t;
}
type T = Awaited<ReturnType<typeof on>>;

/** A UTxO at session 0's account, as Koios lists it. */
const atSession = (tx_hash: string, tx_index: number, value: string) =>
  ({
    ...(sessionSwap.utxo as unknown as KoiosUtxo),
    tx_hash,
    tx_index,
    value,
    payment_cred: sessionSwap.keyHash,
    stake_address: null,
    block_height: 5_000_000,
    asset_list: [],
  }) as KoiosUtxo;

/** The connector over sessions whose giveme.my witness and Seedelf signature are stood in for (as dapp-ties.test.ts's). */
function privately(t: T, knownAccounts: () => Promise<number[]> = t.deps.knownAccounts) {
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
  return new DappService({
    ...t.deps,
    knownAccounts,
    store: t.store,
    sessions,
    fundingPollMs: 1,
    network: () => "preprod",
    window: t.dappWindow,
    changed: () => undefined,
  });
}

/** A site connected to session 0, whose account holds the recorded swap's UTxO and its 5 ₳ collateral. */
async function connectedPrivately(t: T, dapp: DappService, s = site()) {
  const enabling = dapp.call(s, "enable", []);
  await until(() => dapp.approvals().length === 1);
  const out = await dapp.privateBuild(dapp.approvals()[0]!.id, "15000000", []);
  await dapp.answer(dapp.approvals()[0]!.id, true, PASSWORD, { txHash: out.txHash });
  t.koios.addedToAccounts.push(atSession(sessionSwap.utxo.tx_hash, sessionSwap.utxo.tx_index, sessionSwap.utxo.value), atSession(out.txHash, 1, "5000000"));
  expect(await enabling).toBe(true);
  return s;
}

/** What the prompt shows for `tx`, asked by `s`; declined after. */
async function prompt(dapp: DappService, s: DappSession, tx: string) {
  const signing = dapp.call(s, "signTx", [tx, false]);
  await until(() => dapp.approvals().length === 1);
  const approval = dapp.approvals()[0]! as Extract<DappApproval, { kind: "sign-tx" }>;
  await dapp.answer(approval.id, false);
  await expect(signing).rejects.toMatchObject({ failure: { info: "The user declined." } });
  return approval;
}

/** Public account `index`'s receive address 0/0, and someone's key staked to its stake key, in CIP-30's hex. */
async function addressesOf(t: T, index: number) {
  const { wasm } = t.deps;
  const [receive, stake] = await t.wallet.withAccount(index, ({ cardano }) => [
    cardano.receiveAddress(wasm.Network.Preprod, 0),
    cardano.stakeAddress(wasm.Network.Preprod),
  ]);
  return { receive: wasm.cip30Address(receive), stakedTo: `00${"ab".repeat(28)}${wasm.cip30Address(stake).slice(2)}` };
}

describe("a private session's signing prompt, with several public accounts", () => {
  it("names a public account it pays whichever is on screen, the dApp account among them", async () => {
    const t = await on();
    const dapp = privately(t);
    const s = await connectedPrivately(t, dapp);
    // The picker on Account 2; the dApp account stays Account 1 (index 0).
    await t.accounts.use(1, ["preprod"]);
    const [first, third] = [await addressesOf(t, 0), await addressesOf(t, 2)];
    for (const address of [first.receive, first.stakedTo, third.receive, third.stakedTo]) {
      const approval = await prompt(dapp, s, paying([SESSION_INPUT], [address]));
      expect(approval.ties).toEqual(["account"]);
      expect(approval.summary.paid.map((p) => p.yours)).toEqual(["account"]);
    }
    // Someone else's: checked, and none of the wallet's is in it.
    const plain = await prompt(dapp, s, paying([SESSION_INPUT], [t.deps.wasm.cip30Address(THEIRS)]));
    expect(plain.ties).toEqual([]);
  });

  it("promises nothing when the wallet can't read which accounts it has", async () => {
    const t = await on();
    const dapp = privately(t, async () => {
      throw new Error("Seedelf Wallet couldn't open its record of your accounts on this device.");
    });
    const s = await connectedPrivately(t, dapp);
    const approval = await prompt(dapp, s, paying([SESSION_INPUT], [t.deps.wasm.cip30Address(THEIRS)]));
    expect(approval).not.toHaveProperty("ties");
  });
});

describe("a private session's signatures, whichever public account sites use (1.3.0's release review, X03)", () => {
  // The dApp account Settings chooses is the public side's. A session signs with its own keys, and its requests are
  // read for no public account, so a change declines none of them and refuses none as it's approved. The public
  // side's checks read a missing account as account 0 (`sameAccount`), and a session is let through by its own guard
  // there: without it, every session's signature would be refused with AccountChange whenever the dApp account isn't
  // index 0, and no other test would notice.
  const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");
  const theirs = (t: T) => paying([SESSION_INPUT], [t.deps.wasm.cip30Address(THEIRS)]);

  /** What the site heard, once its call is refused. */
  function refusal(call: Promise<unknown>) {
    const heard: { failure?: unknown } = {};
    call.catch((e: { failure?: unknown }) => (heard.failure = e.failure ?? String(e)));
    return heard;
  }

  it("shows and signs a session's signTx and signData while the dApp account isn't Account 1", async () => {
    const t = await on();
    const dapp = privately(t);
    const s = await connectedPrivately(t, dapp);
    const [own] = (await dapp.call(s, "getUsedAddresses", [])) as string[];
    // Settings → Sites: the account sites use is Account 2 (index 1) before the site asks.
    await t.preferences.set({ dappAccount: 1 });
    const signing = dapp.call(s, "signTx", [theirs(t), false]);
    const tx = refusal(signing);
    await until(() => dapp.approvals().length === 1 || tx.failure !== undefined);
    expect(tx.failure).toBeUndefined();
    expect(await dapp.answer(dapp.approvals()[0]!.id, true, PASSWORD)).toEqual({});
    expect(await signing).toEqual(expect.any(String));
    const message = dapp.call(s, "signData", [own, hex("Sign in: nonce 7")]);
    const data = refusal(message);
    await until(() => dapp.approvals().length === 1 || data.failure !== undefined);
    expect(data.failure).toBeUndefined();
    expect(await dapp.answer(dapp.approvals()[0]!.id, true, PASSWORD)).toEqual({});
    expect(await message).toMatchObject({ signature: expect.any(String) });
  });

  it("keeps a session's signTx and signData waiting as Settings moves the dApp account off Account 1, and signs them", async () => {
    const t = await on();
    const dapp = privately(t);
    const s = await connectedPrivately(t, dapp);
    const [own] = (await dapp.call(s, "getUsedAddresses", [])) as string[];
    const signing = dapp.call(s, "signTx", [theirs(t), false]);
    const message = dapp.call(s, "signData", [own, hex("Sign in: nonce 7")]);
    // Caught, so neither rejects unheard before the test looks.
    signing.catch(() => undefined);
    message.catch(() => undefined);
    await until(() => dapp.approvals().length === 2);
    // Index 0 to 1, as Settings' change is made (handlers.ts, `preferences-set`): written, then the connector told.
    await t.preferences.set({ dappAccount: 1 });
    await dapp.dappAccountChanged();
    expect(dapp.approvals().map((a) => a.kind).sort()).toEqual(["sign-data", "sign-tx"]);
    for (const a of dapp.approvals()) expect(await dapp.answer(a.id, true, PASSWORD)).toEqual({});
    expect(await signing).toEqual(expect.any(String));
    expect(await message).toMatchObject({ signature: expect.any(String) });
  });
});
