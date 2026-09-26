// The dApp connector's worker side (background/dapp.ts), on the recorded
// preprod account with the real WebAssembly: off until turned on, a site
// connects only when the user says so, reads come in CIP-30's encodings from
// one reading of the account, and nothing is signed until the user approves.
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { DappService, SESSION_DAPP_SIGNED, type DappSession } from "../src/background/dapp";
import type { KoiosUtxo } from "../src/background/koios";
import { Minswap } from "../src/background/minswap";
import { SESSION_SEND } from "../src/background/send";
import { SessionService } from "../src/background/sessions";
import { SESSION_BALANCES_PREFIX } from "../src/background/wallet";
import { APIError, DataSignError, TxSignError } from "../src/shared/dapp";
import { txIdOf } from "./fixtures/cbor";
import { koiosPreprod, loadTestWasm, ownedUtxos, sessionSwap, testBalances, vectors, withdrawPreprod } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
/** The 15-word phrase's receive address: someone else's. */
const THEIRS = account(15).preprod.receive_0 as string;
const OWN = account(12).preprod.receive_0 as string;
const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");

let sessions = 0;
const site = (origin = "https://app.example.com"): DappSession => ({ id: `s${++sessions}`, origin, title: "Example" });

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}

async function on(words = 12) {
  const t = testBalances();
  await t.wallet.create(account(words).phrase, PASSWORD);
  await t.preferences.set({ dappConnector: true, spendRewards: false });
  return t;
}

/** Gives the 12-word account a pure 5 ₳ UTxO at `0/0`, which the wallet takes as its collateral. */
function withCollateral(t: Awaited<ReturnType<typeof on>>) {
  const template = Object.values(koiosPreprod.accounts)
    .flatMap((a) => a.account_utxos)
    .find((u) => u.address === OWN)!;
  t.koios.addedToAccounts.push({ ...template, tx_hash: "c0".repeat(32), tx_index: 0, value: "5000000", asset_list: [], block_height: 1 });
}

/** A site the user connected. */
async function connected(t: Awaited<ReturnType<typeof on>>, s = site()) {
  const enabling = t.dapp.call(s, "enable", []);
  await until(() => t.dapp.approvals().length === 1);
  await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
  expect(await enabling).toBe(true);
  return s;
}

/** A payment from the account, built by the wallet's own Send: a dApp's transaction as far as the connector knows. */
async function built(t: Awaited<ReturnType<typeof on>>, to = THEIRS) {
  const summary = await t.send.build("preprod", [{ to, lovelace: "3000000", tokens: [] }]);
  const kept = await t.session.get<{ txCbor: string }>(SESSION_SEND);
  return { summary, tx: kept!.txCbor };
}

describe("the dApp connector", () => {
  it("is off until the user turns it on", async () => {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
    expect(await t.dapp.call(site(), "isEnabled", [])).toBe(false);
    await expect(t.dapp.call(site(), "enable", [])).rejects.toMatchObject({ failure: { code: APIError.Refused } });
    expect(t.dappWindow.shown).toBe(0);
    expect(t.koios.calls).toHaveLength(0);
  });

  it("connects a site only when the user says so, and keeps it until it's disconnected", async () => {
    const t = await on();
    const s = site();
    expect(await t.dapp.call(s, "isEnabled", [])).toBe(false);
    const enabling = t.dapp.call(s, "enable", []);
    await until(() => t.dapp.approvals().length === 1);
    expect(t.dapp.approvals()[0]).toMatchObject({ kind: "connect", origin: "https://app.example.com", title: "Example" });
    expect(t.dappWindow.shown).toBe(1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
    expect(await enabling).toBe(true);
    expect(await t.dapp.call(s, "isEnabled", [])).toBe(true);
    expect((await t.dapp.sites()).map((x) => x.origin)).toEqual(["https://app.example.com"]);
    // The same site again, another page: no question.
    expect(await t.dapp.call(site(), "enable", [])).toBe(true);
    expect(t.dappWindow.shown).toBe(1);

    // Another site, declined.
    const other = t.dapp.call(site("https://other.example"), "enable", []);
    await until(() => t.dapp.approvals().length === 1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, false);
    await expect(other).rejects.toMatchObject({ failure: { code: APIError.Refused } });
    await expect(t.dapp.call(site("https://other.example"), "getBalance", [])).rejects.toMatchObject({
      failure: { code: APIError.Refused },
    });

    // Disconnected: it has to ask again.
    await t.dapp.forget("https://app.example.com");
    expect(await t.dapp.sites()).toEqual([]);
    expect(await t.dapp.call(s, "isEnabled", [])).toBe(false);
    await expect(t.dapp.call(s, "getUtxos", [])).rejects.toMatchObject({ failure: { code: APIError.Refused } });

    // The list is sealed on the device, and goes with the wallet.
    expect(JSON.stringify([...t.local.data.values()])).not.toContain("example.com");
  });

  it("reads the public account in CIP-30's encodings, from one reading of it", async () => {
    const t = await on();
    withCollateral(t);
    const s = await connected(t);
    const { wasm } = t.deps;
    expect(await t.dapp.call(s, "getNetworkId", [])).toBe(0);
    expect(await t.dapp.call(s, "getExtensions", [])).toEqual([]);
    const utxos = (await t.dapp.call(s, "getUtxos", [])) as string[];
    const collateral = (await t.dapp.call(s, "getCollateral", [])) as string[] | null;
    // The oldest pure 5 ₳ UTxO is the account's collateral: offered as that, never among the rest.
    expect(collateral).toHaveLength(1);
    expect(utxos).not.toContain(collateral![0]);
    const all = (await t.balances.get("preprod")).cardano;
    expect(utxos).toHaveLength(all.utxos - 1);

    const balance = JSON.parse(wasm.cip30ReadValue((await t.dapp.call(s, "getBalance", [])) as string));
    expect(BigInt(balance.lovelace)).toBe(BigInt(all.lovelace) - 5_000_000n);
    expect(balance.tokens.length).toBe(all.tokens.length);

    const used = (await t.dapp.call(s, "getUsedAddresses", [])) as string[];
    expect(used[0]).toBe(wasm.cip30Address(OWN));
    expect(await t.dapp.call(s, "getChangeAddress", [])).toBe(wasm.cip30Address(OWN));
    expect(await t.dapp.call(s, "getRewardAddresses", [])).toEqual([wasm.cip30Address(account(12).preprod.stake as string)]);
    const unused = (await t.dapp.call(s, "getUnusedAddresses", [])) as string[];
    expect(unused).toHaveLength(1);
    expect(used).not.toContain(unused[0]);

    // Every read above came from one reading of the account (and the balance's own).
    const reads = t.koios.calls.filter((c) => c.path === "account_addresses").length;
    await t.dapp.call(s, "getBalance", []);
    expect(t.koios.calls.filter((c) => c.path === "account_addresses").length).toBe(reads);
    t.clock.now += 31_000;
    await t.dapp.call(s, "getBalance", []);
    expect(t.koios.calls.filter((c) => c.path === "account_addresses").length).toBe(reads + 1);
  });

  it("covers an amount with UTxOs, or answers null, and pages", async () => {
    const t = await on();
    withCollateral(t);
    const s = await connected(t);
    const one = (await t.dapp.call(s, "getUtxos", ["1a000f4240"])) as string[];
    expect(one).toHaveLength(1);
    expect(await t.dapp.call(s, "getUtxos", ["1b00038d7ea4c68000"])).toBeNull(); // a billion ADA
    expect(await t.dapp.call(s, "getUtxos", [undefined, { page: 0, limit: 2 }])).toHaveLength(2);
    await expect(t.dapp.call(s, "getUtxos", [undefined, { page: 99, limit: 2 }])).rejects.toMatchObject({
      failure: { maxSize: expect.any(Number) },
    });
    await expect(t.dapp.call(s, "getUtxos", ["zz"])).rejects.toMatchObject({ failure: { code: APIError.InvalidRequest } });
    // More collateral than 5 ₳, or than it holds: none.
    expect(await t.dapp.call(s, "getCollateral", [{ amount: "1a004c4b40" }])).toHaveLength(1);
    expect(await t.dapp.call(s, "getCollateral", [{ amount: "1a004c4b41" }])).toBeNull();
  });

  it("signs a transaction only once the user approves, with what it does shown first", async () => {
    const t = await on();
    const s = await connected(t);
    const { summary: sent, tx } = await built(t);
    const signing = t.dapp.call(s, "signTx", [tx, false]);
    await until(() => t.dapp.approvals().length === 1);
    const approval = t.dapp.approvals()[0]!;
    if (approval.kind !== "sign-tx") throw new Error(approval.kind);
    expect(approval.summary.txHash).toBe(sent.txHash);
    expect(approval.summary.paid.map((p) => p.address)).toEqual([THEIRS]);
    expect(BigInt(approval.summary.netLovelace)).toBe(-(3_000_000n + BigInt(sent.fee)));
    expect(approval.summary.complete).toBe(true);
    expect(approval.summary.signs.length).toBeGreaterThan(0);
    expect(approval.summary.signs).not.toContain("stake");

    expect(approval.password).toBe(true);
    expect(await t.dapp.answer(approval.id, true, PASSWORD)).toEqual({});
    const witnesses = (await signing) as string;
    // A witness set with only vkey witnesses: `{0: [...]}`.
    expect(witnesses.slice(0, 4)).toBe("a100");
    // Its change is kept, for the site's next transaction.
    const kept = await t.session.get<Array<{ txHash: string }>>(SESSION_DAPP_SIGNED + "preprod");
    expect(kept!.map((k) => k.txHash)).toEqual([sent.txHash]);

    // Declined.
    const again = t.dapp.call(s, "signTx", [tx, false]);
    await until(() => t.dapp.approvals().length === 1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, false);
    await expect(again).rejects.toMatchObject({ failure: { code: TxSignError.UserDeclined } });
  });

  it("refuses without asking a transaction that isn't the account's to sign, or can't be read", async () => {
    const { tx } = await built(await on());
    // Another wallet's connector: none of it is its to sign (its inputs are found through Koios).
    const t = await on(15);
    const s = await connected(t);
    await expect(t.dapp.call(s, "signTx", [tx, true])).rejects.toMatchObject({
      failure: { code: TxSignError.ProofGeneration },
    });
    await expect(t.dapp.call(s, "signTx", ["84a0", false])).rejects.toMatchObject({
      failure: { code: APIError.InvalidRequest },
    });
    await expect(t.dapp.call(s, "signTx", ["not hex", false])).rejects.toMatchObject({
      failure: { code: APIError.InvalidRequest },
    });
    expect(t.dapp.approvals()).toEqual([]);
  });

  it("sends through Koios, and counts what comes back until it's on chain", async () => {
    const t = await on();
    const s = await connected(t);
    const { summary, tx } = await built(t);
    const before = (await t.dapp.call(s, "getUtxos", [])) as string[];
    const signing = t.dapp.call(s, "signTx", [tx, false]);
    await until(() => t.dapp.approvals().length === 1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, true, PASSWORD);
    await signing;
    await t.balances.get("preprod");

    expect(await t.dapp.call(s, "submitTx", [tx])).toBe(summary.txHash);
    expect(t.koios.submitted).toHaveLength(1);
    // Home reads the account again.
    expect(await t.session.get(SESSION_BALANCES_PREFIX + "preprod")).toBeUndefined();
    const after = (await t.dapp.call(s, "getUtxos", [])) as string[];
    // What it spent is gone, and its change is there.
    expect(after.length).toBe(before.length - summary.inputs + 1);
    const change = after.filter((u) => !before.includes(u));
    expect(change).toHaveLength(1);
  });

  it("signs data with the address's key, once approved", async () => {
    const t = await on();
    const s = await connected(t);
    const { wasm } = t.deps;
    const signing = t.dapp.call(s, "signData", [wasm.cip30Address(OWN), hex("Sign in: nonce 42")]);
    await until(() => t.dapp.approvals().length === 1);
    expect(t.dapp.approvals()[0]).toMatchObject({ kind: "sign-data", address: OWN, key: "payment", text: "Sign in: nonce 42" });
    await t.dapp.answer(t.dapp.approvals()[0]!.id, true, PASSWORD);
    const signed = (await signing) as { signature: string; key: string };
    expect(signed.signature.slice(0, 2)).toBe("84");
    expect(signed.key.slice(0, 2)).toBe("a4");

    await expect(t.dapp.call(s, "signData", [THEIRS, hex("x")])).rejects.toMatchObject({
      failure: { code: DataSignError.ProofGeneration },
    });
    await expect(t.dapp.call(s, "signData", ["nonsense", hex("x")])).rejects.toMatchObject({
      failure: { code: DataSignError.AddressNotPK },
    });
    // A binary payload is shown as hex.
    const binary = t.dapp.call(s, "signData", [OWN, "00ff"]);
    await until(() => t.dapp.approvals().length === 1);
    expect(t.dapp.approvals()[0]).not.toHaveProperty("text");
    await t.dapp.answer(t.dapp.approvals()[0]!.id, false);
    await expect(binary).rejects.toMatchObject({ failure: { code: DataSignError.UserDeclined } });
  });

  it("needs the password to sign, even while unlocked: without it the site keeps waiting, and a wrong one counts", async () => {
    const t = await on();
    const s = await connected(t);
    const { tx } = await built(t);
    const signing = t.dapp.call(s, "signTx", [tx, false]);
    let settled = false;
    signing.then(
      () => (settled = true),
      () => (settled = true),
    );
    await until(() => t.dapp.approvals().length === 1);
    const approval = t.dapp.approvals()[0]!;
    expect(approval).toMatchObject({ kind: "sign-tx", password: true });

    // None, or a wrong one: nothing is signed, the request stays, and the site hears nothing.
    expect(await t.dapp.answer(approval.id, true)).toEqual({ error: "Type your password to sign." });
    expect(await t.dapp.answer(approval.id, true, "not the password")).toEqual({ error: "Wrong password." });
    expect(t.dapp.approvals().map((a) => a.id)).toEqual([approval.id]);
    expect(settled).toBe(false);
    // A wrong one counts towards the unlock back-off, as the phrase's does.
    expect(await t.dapp.answer(approval.id, true, PASSWORD)).toEqual({ error: "Too many wrong passwords. Try again in 1 s." });
    t.clock.now += 1_000;
    expect(await t.dapp.answer(approval.id, true, PASSWORD)).toEqual({});
    expect(((await signing) as string).slice(0, 4)).toBe("a100");
  });

  it("asks at Sign even right after an unlock for the request; with the setting off, Sign is enough", async () => {
    const t = await on();
    const s = await connected(t);
    const message = [t.deps.wasm.cip30Address(OWN), hex("Sign in")];

    // Locked: the connector's window unlocks first, and Sign still asks: the unlock came before the message was shown.
    await t.wallet.lock();
    const unlocking = t.dapp.call(s, "signData", message);
    await until(() => t.dappWindow.shown === 2);
    await t.wallet.unlock(PASSWORD);
    await t.dapp.stateChanged();
    await until(() => t.dapp.approvals().length === 1);
    expect(t.dapp.approvals()[0]).toMatchObject({ kind: "sign-data", password: true });
    // Declining needs no password.
    expect(await t.dapp.answer(t.dapp.approvals()[0]!.id, false)).toEqual({});
    await expect(unlocking).rejects.toMatchObject({ failure: { code: DataSignError.UserDeclined } });

    // Off: Sign is enough.
    await t.preferences.set({ dappPassword: false });
    const off = t.dapp.call(s, "signData", message);
    await until(() => t.dapp.approvals().length === 1);
    expect(t.dapp.approvals()[0]).toMatchObject({ password: false });
    expect(await t.dapp.answer(t.dapp.approvals()[0]!.id, true)).toEqual({});
    await off;
  });

  it("waits for an unlock in its window, and refuses for a while once it's closed instead", async () => {
    const t = await on();
    const s = await connected(t);
    await t.wallet.lock();
    expect(await t.dapp.call(s, "isEnabled", [])).toBe(false);

    const reading = t.dapp.call(s, "getNetworkId", []);
    await until(() => t.dappWindow.shown === 2);
    await t.wallet.unlock(PASSWORD);
    await t.dapp.stateChanged();
    expect(await reading).toBe(0);

    await t.wallet.lock();
    const refused = t.dapp.call(s, "getBalance", []);
    await until(() => t.dappWindow.shown === 3);
    t.dappWindow.open = false;
    await t.dapp.windowClosed();
    await expect(refused).rejects.toMatchObject({ failure: { code: APIError.Refused } });
    // A site that polls doesn't bring the window back for a minute.
    await expect(t.dapp.call(s, "getBalance", [])).rejects.toMatchObject({ failure: { code: APIError.Refused } });
    expect(t.dappWindow.shown).toBe(3);
  });

  it("forgets what a site asked for once its page is gone, and declines it all when the window closes", async () => {
    const t = await on();
    const s = await connected(t);
    const { tx } = await built(t);
    const signing = t.dapp.call(s, "signTx", [tx, false]);
    await until(() => t.dapp.approvals().length === 1);
    t.dapp.gone(s);
    expect(t.dapp.approvals()).toEqual([]);
    signing.catch(() => undefined);

    const again = t.dapp.call(site(), "signTx", [tx, false]);
    await until(() => t.dapp.approvals().length === 1);
    t.dappWindow.open = false;
    await t.dapp.windowClosed();
    await expect(again).rejects.toMatchObject({ failure: { code: TxSignError.UserDeclined } });
    expect(t.dapp.approvals()).toEqual([]);
  });
});

describe("private CIP-30: a site connected to a private session", () => {
  type T = Awaited<ReturnType<typeof on>>;

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

  /**
   * The connector over a session service whose giveme.my witness and Seedelf
   * signature are stood in for, as sessions.test.ts does: the funding takes
   * the private balance's 25 ₳ UTxO alone.
   */
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
      network: "preprod",
      window: t.dappWindow,
      changed: () => undefined,
    });
    return { dapp, sessions };
  }

  /** A site connected to session 0, whose account holds the recorded swap's UTxO and its 5 ₳ collateral. */
  async function connectedPrivately(t: T, dapp: DappService, s = site()) {
    const enabling = dapp.call(s, "enable", []);
    await until(() => dapp.approvals().length === 1);
    const out = await dapp.privateBuild(dapp.approvals()[0]!.id, "15000000", []);
    await dapp.answer(dapp.approvals()[0]!.id, true, PASSWORD, { txHash: out.txHash });
    t.koios.addedToAccounts.push(
      atSession(sessionSwap.utxo.tx_hash, sessionSwap.utxo.tx_index, sessionSwap.utxo.value),
      atSession(out.txHash, 1, "5000000"),
    );
    expect(await enabling).toBe(true);
    return { s, out };
  }

  it("is funded from the window, and enable() answers once Koios sees the money, even with the window closed", async () => {
    const t = await on();
    const { dapp, sessions } = privately(t);
    const s = site();
    const enabling = dapp.call(s, "enable", []);
    let settled = false;
    enabling.then(
      () => (settled = true),
      () => (settled = true),
    );
    await until(() => dapp.approvals().length === 1);
    const connect = dapp.approvals()[0]!;
    expect(connect).toMatchObject({ kind: "connect", password: true });

    // The funding: 15 ₳ for the site and 5 ₳ of collateral, into session 0's own account.
    const out = await dapp.privateBuild(connect.id, "15000000", []);
    expect(out).toMatchObject({ index: 0, address: sessionSwap.address });
    expect(out.payments.map((p) => [p.address, p.lovelace])).toEqual([
      [sessionSwap.address, "15000000"],
      [sessionSwap.address, "5000000"],
    ]);

    // Sending it needs the password, as a signature does; then it's sent, and the site is connected to the session.
    expect(await dapp.answer(connect.id, true, undefined, { txHash: out.txHash })).toEqual({ error: "Type your password to send." });
    expect(t.koios.submitted).toHaveLength(0);
    expect(await dapp.answer(connect.id, true, PASSWORD, { txHash: out.txHash })).toEqual({});
    expect(t.koios.submitted.map((b) => txIdOf(b))).toEqual([out.txHash]);
    expect(await dapp.sites()).toEqual([{ origin: s.origin, connectedAt: expect.any(Number), session: 0 }]);

    // It waits for the money: the window shows it, the site hasn't heard, and closing the window doesn't undo it.
    expect(dapp.approvals()).toMatchObject([{ kind: "connect", funding: { index: 0, txHash: out.txHash } }]);
    t.dappWindow.open = false;
    await dapp.windowClosed();
    expect(dapp.approvals()).toHaveLength(1);
    expect(settled).toBe(false);

    t.koios.addedToAccounts.push(atSession(out.txHash, 0, "15000000"), atSession(out.txHash, 1, "5000000"));
    expect(await enabling).toBe(true);
    expect(dapp.approvals()).toEqual([]);
    expect((await sessions.list("preprod"))[0]).toMatchObject({ index: 0, site: { origin: s.origin } });
  });

  it("won't fund a private session for a site another of its requests connected meanwhile", async () => {
    const t = await on();
    const { dapp } = privately(t);
    // Two tabs, or enable() twice: two questions.
    const first = dapp.call(site(), "enable", []);
    const second = dapp.call(site(), "enable", []);
    await until(() => dapp.approvals().length === 2);
    const [a, b] = dapp.approvals();
    // Their ids are random, never a count that starts again with the worker.
    expect(a!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(a!.id).not.toBe(b!.id);
    const out = await dapp.privateBuild(b!.id, "15000000", []);

    // The first is answered with the public account meanwhile.
    expect(await dapp.answer(a!.id, true)).toEqual({});
    expect(await first).toBe(true);
    // So the second's session isn't funded: the site wouldn't talk to it.
    expect(await dapp.answer(b!.id, true, PASSWORD, { txHash: out.txHash })).toEqual({
      error: expect.stringContaining("connected meanwhile"),
    });
    expect(t.koios.submitted).toHaveLength(0);
    await expect(dapp.privateBuild(b!.id, "15000000", [])).rejects.toThrow("connected meanwhile");
    expect(await dapp.sites()).toEqual([{ origin: site().origin, connectedAt: expect.any(Number) }]);
    await dapp.answer(b!.id, false);
    await expect(second).rejects.toMatchObject({ failure: { code: APIError.Refused } });
  });

  it("gives the site the session's account alone: its address, its reward address, its money and its collateral", async () => {
    const t = await on();
    const { dapp } = privately(t);
    const { s } = await connectedPrivately(t, dapp);
    const { wasm } = t.deps;
    const reward = await t.wallet.withKeys((k) => k.oneTime.rewardAddress(wasm.Network.Preprod, 0));

    expect(await dapp.call(s, "getUsedAddresses", [])).toEqual([wasm.cip30Address(sessionSwap.address)]);
    expect(await dapp.call(s, "getChangeAddress", [])).toBe(wasm.cip30Address(sessionSwap.address));
    expect(await dapp.call(s, "getUnusedAddresses", [])).toEqual([]);
    expect(await dapp.call(s, "getRewardAddresses", [])).toEqual([wasm.cip30Address(reward)]);
    // The recorded swap's UTxO to spend; the 5 ₳ is the collateral, kept out of it.
    expect(await dapp.call(s, "getUtxos", [])).toHaveLength(1);
    expect(await dapp.call(s, "getCollateral", [])).toHaveLength(1);
    expect(await dapp.call(s, "getBalance", [])).toBe(wasm.cip30Value(sessionSwap.utxo.value, "[]"));
    // Nothing of the public account's: its used address isn't there.
    const publicAddress = wasm.cip30Address(account(12).preprod.receive_0 as string);
    expect(await dapp.call(s, "getUsedAddresses", [])).not.toContain(publicAddress);
  });

  it("signs the site's transaction and message with the session's keys, after the password", async () => {
    const t = await on();
    const { dapp } = privately(t);
    const { s } = await connectedPrivately(t, dapp);
    const { wasm } = t.deps;

    const signing = dapp.call(s, "signTx", [sessionSwap.swapCbor, false]);
    await until(() => dapp.approvals().length === 1);
    const approval = dapp.approvals()[0]!;
    if (approval.kind !== "sign-tx") throw new Error(approval.kind);
    expect(approval).toMatchObject({ session: 0, password: true });
    expect(approval.summary.signs).toEqual(["0/0"]);
    expect(approval.summary.complete).toBe(true);
    expect(await dapp.answer(approval.id, true, PASSWORD)).toEqual({});
    expect(((await signing) as string).slice(0, 4)).toBe("a100");

    // A message, with the session's payment key, and with its own stake key for its reward address.
    const reward = await t.wallet.withKeys((k) => k.oneTime.rewardAddress(wasm.Network.Preprod, 0));
    for (const [address, key] of [
      [sessionSwap.address, "payment"],
      [reward, "stake"],
    ] as const) {
      const message = dapp.call(s, "signData", [wasm.cip30Address(address), hex("Sign in")]);
      await until(() => dapp.approvals().length === 1);
      expect(dapp.approvals()[0]).toMatchObject({ kind: "sign-data", session: 0, key });
      await dapp.answer(dapp.approvals()[0]!.id, true, PASSWORD);
      expect(((await message) as { signature: string }).signature.slice(0, 2)).toBe("84");
    }
    // The public account's address isn't the session's to sign for.
    await expect(dapp.call(s, "signData", [OWN, hex("x")])).rejects.toMatchObject({
      failure: { code: DataSignError.ProofGeneration, info: "That address isn't this private session's." },
    });
  });

  it("keeps the request waiting when the funding isn't sent, and its unfunded session can be closed from the dApps page", async () => {
    const t = await on();
    const { dapp, sessions } = privately(t);
    const s = site();
    const enabling = dapp.call(s, "enable", []);
    enabling.catch(() => undefined);
    await until(() => dapp.approvals().length === 1);
    const connect = dapp.approvals()[0]!;
    const out = await dapp.privateBuild(connect.id, "15000000", []);
    // giveme.my refuses: nothing is sent, the site isn't connected, and the request still waits for the user.
    t.collateral.answer = { status: 400, body: { error: "refused" } };
    const { error } = await dapp.answer(connect.id, true, PASSWORD, { txHash: out.txHash });
    expect(error).toBeTruthy();
    expect(t.koios.submitted).toHaveLength(0);
    expect(await dapp.sites()).toEqual([]);
    expect(dapp.approvals()).toMatchObject([{ kind: "connect" }]);
    expect(dapp.approvals()[0]).not.toHaveProperty("funding");
    // The session it recorded never got its money: closed from the dApps page, its index isn't used again.
    expect((await sessions.list("preprod"))[0]).toMatchObject({ index: 0, stage: "failed", site: { origin: s.origin } });
    await dapp.disconnectSession(0);
    expect((await sessions.list("preprod"))[0]!.stage).toBe("closed");
    expect((await dapp.privateBuild(connect.id, "15000000", [])).index).toBe(1);
  });

  it("takes a top-up, and disconnects only once everything's brought back, ending the session", async () => {
    const t = await on();
    const { dapp, sessions } = privately(t);
    const { s } = await connectedPrivately(t, dapp);

    // Top up: another payment into the same account, recorded in the session.
    t.koios.added.push({ ...ownedUtxos[0]!, tx_hash: "ee".repeat(32), block_height: 9_000_001 });
    const more = await sessions.topUpBuild("preprod", 0, "3000000", []);
    expect(more.payments.map((p) => [p.address, p.lovelace])).toEqual([[sessionSwap.address, "3000000"]]);
    await sessions.topUpSubmit("preprod", more.txHash);
    expect((await sessions.list("preprod"))[0]!.txs.map((x) => x.kind)).toEqual(["out", "out"]);

    // The account holds something: disconnecting refuses, and the site stays connected.
    await expect(dapp.forget(s.origin)).rejects.toThrow("Bring it back first");
    expect(await dapp.sites()).toHaveLength(1);

    // Brought back (the account is empty): disconnecting ends the session, and the site's next connect asks again.
    t.koios.addedToAccounts.splice(0);
    expect(await dapp.forget(s.origin)).toEqual([]);
    expect((await sessions.list("preprod"))[0]!.stage).toBe("closed");
    await expect(dapp.call(s, "getBalance", [])).rejects.toMatchObject({ failure: { code: APIError.Refused } });
  });
});

