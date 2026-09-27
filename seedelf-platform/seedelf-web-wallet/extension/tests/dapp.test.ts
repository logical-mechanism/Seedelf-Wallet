// The dApp connector's worker side (background/dapp.ts), on the recorded
// preprod account with the real WebAssembly: off until turned on, a site
// connects only when the user says so, reads come in CIP-30's encodings from
// one reading of the account, and nothing is signed until the user approves.
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { DappService, SESSION_DAPP_SIGNED, type DappError, type DappSession } from "../src/background/dapp";
import type { KoiosUtxo } from "../src/background/koios";
import { chainOwner } from "../src/background/lovejoin";
import { Minswap } from "../src/background/minswap";
import { SESSION_SEND } from "../src/background/send";
import { recentlySent, rememberSent, SENT_KEEP_MS } from "../src/background/sent-txs";
import { SessionService } from "../src/background/sessions";
import { SESSION_RESERVED_PREFIX } from "../src/background/spent";
import { SESSION_BALANCES_PREFIX } from "../src/background/wallet";
import { APIError, DataSignError, TxSendError, TxSignError } from "../src/shared/dapp";
import type { DappTxSummary } from "../src/shared/rpc";
import { certificateLine, paidTo, stakingComesBack, withdrawalLine } from "../src/ui/dapp";
import { txIdOf } from "./fixtures/cbor";
import {
  koiosPreprod,
  loadTestWasm,
  memoryArea,
  ownedUtxos,
  sessionSwap,
  testBalances,
  vectors,
  withdrawPreprod,
} from "./fakes";

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

const uint = (n: number) => (n < 24 ? n.toString(16).padStart(2, "0") : `18${n.toString(16).padStart(2, "0")}`);
const outpoints = (list: string[]) =>
  `8${list.length}${list.map((o) => `825820${o.slice(0, 64)}${uint(Number(o.slice(65)))}`).join("")}`;

const coin = (n: bigint) => (n < 0x100000000n ? `1a${n.toString(16).padStart(8, "0")}` : `1b${n.toString(16).padStart(16, "0")}`);

/**
 * A site's transaction, built by hand: it spends `inputs` (`txhash#index`),
 * puts up `collateral`, pays `pays` (base addresses in CIP-30's hex; 4 ₳ to
 * someone else unless given), and carries `certificates` and `withdrawals`
 * (CBOR, hex). Its fee is 0.17 ₳. Nothing balances it: the wallet only reads it.
 */
function siteTx({
  inputs,
  collateral = [],
  certificates = [],
  withdrawals,
  pays = [{ address: loadTestWasm().cip30Address(THEIRS), lovelace: 4_000_000n }],
}: {
  inputs: string[];
  collateral?: string[];
  certificates?: string[];
  withdrawals?: string;
  pays?: Array<{ address: string; lovelace: bigint }>;
}) {
  const outputs = `8${pays.length}${pays.map((p) => `825839${p.address}${coin(p.lovelace)}`).join("")}`;
  const fields = [`00${outpoints(inputs)}`, `01${outputs}`, "021a00029810"];
  if (certificates.length) fields.push(`048${certificates.length}${certificates.join("")}`);
  if (withdrawals) fields.push(`05${withdrawals}`);
  if (collateral.length) fields.push(`0d${outpoints(collateral)}`);
  return `84a${fields.length}${fields.join("")}a0f5f6`;
}

/** A stake address's key hash, from its CIP-30 bytes. */
const stakeKeyHash = (reward: string) => loadTestWasm().cip30Address(reward).slice(2);

/** Staking certificates for a stake key hash, by what they do (CBOR, hex). */
function certificates(keyHash: string) {
  const key = `8200581c${keyHash}`;
  const pool = `581c${"ab".repeat(28)}`;
  const deposit = "1a001e8480";
  return {
    register: `8200${key}`,
    registerDeposit: `8307${key}${deposit}`,
    delegate: `8302${key}${pool}`,
    vote: `8309${key}8102`,
    registerDelegate: `840b${key}${pool}${deposit}`,
    unregister: `8308${key}${deposit}`,
  };
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

  it("follows the network the wallet is on: its ID, its own sites, and nothing asked on the one it left is signed", async () => {
    const t = await on();
    const s = await connected(t);
    const { tx } = await built(t);
    expect(await t.dapp.call(s, "getNetworkId", [])).toBe(0);
    const signing = t.dapp.call(s, "signTx", [tx, false]);
    await until(() => t.dapp.approvals().length === 1);
    const id = t.dapp.approvals()[0]!.id;
    // Settings moves the wallet to mainnet while the window still shows the request: approving it signs nothing.
    await t.networkChoice.set("mainnet");
    expect(await t.dapp.answer(id, true, PASSWORD)).toEqual({ error: expect.stringContaining("moved to another network") });
    await expect(signing).rejects.toMatchObject({ failure: { code: TxSignError.UserDeclined } });
    expect(t.dapp.approvals()).toEqual([]);

    // On mainnet the site isn't connected: it asks again, and hears mainnet's ID.
    expect(await t.dapp.call(s, "isEnabled", [])).toBe(false);
    expect(await t.dapp.sites()).toEqual([]);
    await expect(t.dapp.call(s, "getNetworkId", [])).rejects.toMatchObject({ failure: { code: APIError.Refused } });
    const enabling = t.dapp.call(s, "enable", []);
    await until(() => t.dapp.approvals().length === 1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
    expect(await enabling).toBe(true);
    expect(await t.dapp.call(s, "getNetworkId", [])).toBe(1);

    // A request waiting as the wallet moves back is declined at once.
    const other = t.dapp.call(site("https://other.example"), "enable", []);
    await until(() => t.dapp.approvals().length === 1);
    await t.networkChoice.set("preprod");
    await t.dapp.networkChanged();
    await expect(other).rejects.toMatchObject({ failure: { code: APIError.Refused, info: expect.stringContaining("another network") } });
    expect(t.dapp.approvals()).toEqual([]);
    // Back on preprod, the site is connected as it was.
    expect(await t.dapp.call(s, "getNetworkId", [])).toBe(0);
    expect((await t.dapp.sites()).map((x) => x.origin)).toEqual(["https://app.example.com"]);
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

  it("reads a transaction built on one it signed, or on the wallet's own Send, before either is on chain", async () => {
    const t = await on();
    const s = await connected(t);
    const outputs = (tx: string) => JSON.parse(t.deps.wasm.ogmiosUtxos(tx)) as Array<{ index: number; address: string }>;
    const signedFor = async (tx: string, partial = false) => {
      const signing = t.dapp.call(s, "signTx", [tx, partial]);
      await until(() => t.dapp.approvals().length === 1);
      const approval = t.dapp.approvals()[0]!;
      if (approval.kind !== "sign-tx") throw new Error(approval.kind);
      await t.dapp.answer(approval.id, true, PASSWORD);
      await signing;
      return approval.summary;
    };

    // The site's first transaction pays someone else; its next spends that output, with the account's.
    const { summary: first, tx } = await built(t);
    await signedFor(tx);
    const theirs = outputs(tx).find((o) => o.address === THEIRS)!;
    await t.balances.get("preprod");
    const [own] = (await t.coins.lists("preprod")).cardano;
    const next = await signedFor(siteTx({ inputs: [`${first.txHash}#${theirs.index}`, `${own!.txHash}#${own!.index}`] }), true);
    expect(next).toMatchObject({ unknownInputs: [], ownInputs: 1, complete: false });

    // The wallet's own Send, sent: a site's transaction spending its change reads it as the account's.
    const { summary: sent, tx: sendTx } = await built(t);
    await t.send.submit("preprod", sent.txHash);
    const change = outputs(sendTx).find((o) => o.address !== THEIRS)!;
    const spendsChange = await signedFor(siteTx({ inputs: [`${sent.txHash}#${change.index}`] }));
    expect(spendsChange).toMatchObject({ unknownInputs: [], ownInputs: 1, complete: true });
    // Neither was on chain for Koios.
    expect(t.koios.calls.filter((c) => c.path === "utxo_info").flatMap((c) => c.body._utxo_refs)).not.toContain(
      `${sent.txHash}#${change.index}`,
    );
  });

  it("never reads a site's transaction on one network from the wallet's own Send on the other", async () => {
    const t = await on();
    // A Send on preprod, sent: its change isn't on chain yet.
    const { summary: sent, tx: sendTx } = await built(t);
    await t.send.submit("preprod", sent.txHash);
    const outputs = JSON.parse(t.deps.wasm.ogmiosUtxos(sendTx)) as Array<{ index: number; address: string }>;
    const change = `${sent.txHash}#${outputs.find((o) => o.address !== THEIRS)!.index}`;

    // The wallet moves to mainnet. The account's keys are the same there, and
    // a signature binds nothing to a network: a site there that spends the
    // change must never have it read as the account's.
    await t.networkChoice.set("mainnet");
    await t.dapp.networkChanged();
    const s = await connected(t);
    const pays = [{ address: t.deps.wasm.cip30Address(account(15).mainnet.receive_0 as string), lovelace: 4_000_000n }];
    await expect(t.dapp.call(s, "signTx", [siteTx({ inputs: [change], pays }), false])).rejects.toMatchObject({
      failure: { code: TxSignError.ProofGeneration },
    });
    expect(t.dapp.approvals()).toEqual([]);
    // Looked for on mainnet's Koios, which hasn't got it, rather than read from the preprod Send.
    expect(t.koios.calls.filter((c) => c.path === "utxo_info").flatMap((c) => c.body._utxo_refs)).toContain(change);
  });

  it("says in its prompt where the account's rewards go, what pays its key under another stake part, and a pool's certificate", async () => {
    const t = await on();
    const s = await connected(t);
    const { wasm } = t.deps;
    await t.balances.get("preprod");
    const [own] = (await t.coins.lists("preprod")).cardano;
    const input = `${own!.txHash}#${own!.index}`;
    const asked = async (tx: string, partial = false) => {
      const signing = t.dapp.call(s, "signTx", [tx, partial]);
      await until(() => t.dapp.approvals().length === 1);
      const approval = t.dapp.approvals()[0]!;
      if (approval.kind !== "sign-tx") throw new Error(approval.kind);
      await t.dapp.answer(approval.id, false);
      await expect(signing).rejects.toMatchObject({ failure: { code: TxSignError.UserDeclined } });
      return approval.summary;
    };
    // 1,000 ₳ of the account's rewards.
    const withdrawals = `a1581d${wasm.cip30Address(account(12).preprod.stake as string)}${coin(1_000_000_000n)}`;
    const whose = "your public account";

    // Paid to someone else: the headline counts them in what the account sends, and the line says they leave.
    const away = await asked(siteTx({ inputs: [input], withdrawals }));
    expect(away).toMatchObject({ stakingLovelace: "1000000000", netLovelace: `-${BigInt(own!.lovelace) + 1_000_000_000n}` });
    expect(stakingComesBack(away)).toBe(false);
    expect(withdrawalLine(away.withdrawals[0]!, false, whose)).toBe(
      "Withdraws your staking rewards, 1,000 ₳, and they don't all come back to your public account: they're counted in what it sends above.",
    );
    // Back into the account: it sends only the fee.
    const back = BigInt(own!.lovelace) + 1_000_000_000n - 170_000n;
    const home = await asked(siteTx({ inputs: [input], withdrawals, pays: [{ address: wasm.cip30Address(OWN), lovelace: back }] }));
    expect(home.netLovelace).toBe("-170000");
    expect(stakingComesBack(home)).toBe(true);
    expect(withdrawalLine(home.withdrawals[0]!, true, whose)).toBe("Withdraws your staking rewards, 1,000 ₳, into your public account.");

    // The account's payment key under someone else's stake part: paid, not change.
    const franken = wasm.cip30Address(OWN).slice(0, 58) + wasm.cip30Address(THEIRS).slice(58);
    const odd = await asked(siteTx({ inputs: [input], pays: [{ address: franken, lovelace: 4_000_000n }] }));
    expect(odd.paid).toMatchObject([{ ownPaymentKey: true }]);
    expect(odd.ownOutputs).toEqual([]);
    expect(paidTo(odd.paid[0]!)).toBe("Your payment key, with a stake part that isn't yours");

    // A stake pool's retirement, which its operator signs too.
    const pool = await asked(siteTx({ inputs: [input], certificates: [`8304581c${"ab".repeat(28)}190100`] }), true);
    expect(pool.certificates).toMatchObject([{ kind: "pool", own: false, poolAction: "retire", pool: expect.stringMatching(/^pool1/) }]);
    expect(certificateLine(pool.certificates[0]!, true, whose)).toBe(`Retires stake pool ${pool.certificates[0]!.pool}.`);
  });

  it("tells WebAssembly what an old-style stop of the account's staking gives back: the deposit its stake key was registered with", async () => {
    const t = await on();
    const wasm = t.deps.wasm;
    const requests: Array<Record<string, unknown>> = [];
    const dapp = new DappService({
      ...t.deps,
      wasm: {
        ...wasm,
        inspectDappTx: (keys: Parameters<typeof wasm.inspectDappTx>[0], request: string) => {
          requests.push(JSON.parse(request) as Record<string, unknown>);
          return wasm.inspectDappTx(keys, request);
        },
      } as typeof wasm,
      store: t.store,
      sessions: t.sessions,
      network: () => "preprod",
      window: t.dappWindow,
      changed: () => undefined,
    });
    const s = site();
    const enabling = dapp.call(s, "enable", []);
    await until(() => dapp.approvals().length === 1);
    await dapp.answer(dapp.approvals()[0]!.id, true);
    await enabling;
    /** What WebAssembly was asked to read for a site's transaction; whatever it makes of it is declined. */
    const read = async (tx: string) => {
      let settled = false;
      const signing = dapp
        .call(s, "signTx", [tx, false])
        .catch(() => undefined)
        .finally(() => (settled = true));
      await until(() => settled || dapp.approvals().length === 1);
      for (const a of dapp.approvals()) await dapp.answer(a.id, false);
      await signing;
      return requests.at(-1)!;
    };
    // Registered with 3 ₳, which isn't today's key deposit: the recorded one is what comes back.
    const stake = account(12).preprod.stake as string;
    const info = t.koios.stakes.get(stake)!;
    t.koios.stakes.set(stake, { ...info, deposit: "3000000" });
    await t.balances.get("preprod");
    const [own] = (await t.coins.lists("preprod")).cardano;
    const input = `${own!.txHash}#${own!.index}`;
    const keyHash = stakeKeyHash(stake);
    const oldStop = `82018200581c${keyHash}`;
    const lookups = () => t.koios.calls.filter((c) => c.path === "account_info").length;
    const before = lookups();
    expect(await read(siteTx({ inputs: [input], certificates: [oldStop] }))).toMatchObject({ stakeDeposit: "3000000" });
    expect(lookups()).toBe(before + 1);

    // Anything else looks nothing up: a Conway stop says its deposit itself.
    const { unregister, delegate } = certificates(keyHash);
    for (const tx of [siteTx({ inputs: [input] }), siteTx({ inputs: [input], certificates: [unregister] }), siteTx({ inputs: [input], certificates: [delegate] })]) {
      expect(await read(tx)).not.toHaveProperty("stakeDeposit");
    }
    expect(lookups()).toBe(before + 1);

    // A key that isn't registered has no deposit to give back: none, and WebAssembly won't sign the stop.
    t.koios.stakes.set(stake, { ...info, status: "not registered" });
    expect(await read(siteTx({ inputs: [input], certificates: [oldStop] }))).not.toHaveProperty("stakeDeposit");
  });

  it("won't sign a site's transaction that uses a UTxO the user locked, or spends the collateral", async () => {
    const t = await on();
    withCollateral(t);
    const s = await connected(t);
    await t.balances.get("preprod");
    const utxos = (await t.coins.lists("preprod")).cardano;
    const ref = (u: { txHash: string; index: number }) => `${u.txHash}#${u.index}`;
    const collateral = ref(utxos.find((u) => u.collateral)!);
    const [locked, free] = utxos.filter((u) => !u.collateral).map(ref);
    await t.coins.setLocked("preprod", "cardano", locked!, true);

    // Spent, or put up as collateral: refused before the user is asked.
    for (const tx of [siteTx({ inputs: [locked!] }), siteTx({ inputs: [free!], collateral: [locked!] })]) {
      await expect(t.dapp.call(s, "signTx", [tx, false])).rejects.toMatchObject({
        failure: { code: TxSignError.ProofGeneration, info: expect.stringContaining(`a UTxO you locked (${locked})`) },
      });
    }
    await expect(t.dapp.call(s, "signTx", [siteTx({ inputs: [free!, collateral] }), false])).rejects.toMatchObject({
      failure: { code: TxSignError.ProofGeneration, info: expect.stringContaining(`spends your collateral (${collateral})`) },
    });
    expect(t.dapp.approvals()).toEqual([]);

    // The collateral put up as collateral is what it's for; once unlocked, the UTxO is the site's to spend.
    await t.coins.setLocked("preprod", "cardano", locked!, false);
    const signing = t.dapp.call(s, "signTx", [siteTx({ inputs: [locked!], collateral: [collateral] }), false]);
    await until(() => t.dapp.approvals().length === 1);
    expect(t.dapp.approvals()[0]).not.toHaveProperty("collateralSpent");
    await t.dapp.answer(t.dapp.approvals()[0]!.id, false);
    await expect(signing).rejects.toMatchObject({ failure: { code: TxSignError.UserDeclined } });
  });

  it("won't sign a site's transaction that uses what a Lovejoin chain still being sent needs, until it's done", async () => {
    const t = await on();
    withCollateral(t);
    const s = await connected(t);
    await t.balances.get("preprod");
    const utxos = (await t.coins.lists("preprod")).cardano;
    const ref = (u: { txHash: string; index: number }) => `${u.txHash}#${u.index}`;
    const collateral = ref(utxos.find((u) => u.collateral)!);
    const [held, free] = utxos.filter((u) => !u.collateral).map(ref);
    const offered = ((await t.dapp.call(s, "getUtxos", [])) as string[]).length;

    // A mix from the public account is being sent: its next step spends `held`, and puts up the collateral.
    await t.session.set(SESSION_RESERVED_PREFIX + "preprod", { public: { inputs: [held!], collateral: [collateral] } });
    t.clock.now += 31_000;
    expect((await t.dapp.call(s, "getUtxos", [])) as string[]).toHaveLength(offered - 1);
    // A site that names it anyway, as an input or as collateral, or spends the chain's collateral, is refused
    // before anything is looked up or asked.
    const calls = t.koios.calls.length;
    for (const tx of [
      siteTx({ inputs: [held!] }),
      siteTx({ inputs: [free!], collateral: [held!] }),
      siteTx({ inputs: [free!, collateral] }),
    ]) {
      await expect(t.dapp.call(s, "signTx", [tx, false])).rejects.toMatchObject({
        failure: { code: TxSignError.ProofGeneration, info: expect.stringContaining("still being sent through Lovejoin") },
      });
    }
    await expect(t.dapp.call(s, "signTx", [siteTx({ inputs: [held!] }), false])).rejects.toMatchObject({
      failure: { info: `This transaction uses a UTxO (${held}) that a chain still being sent through Lovejoin needs, so the wallet won't sign it: the rest of that chain would be refused. Wait for it to finish, then try again.` },
    });
    expect(t.koios.calls.length).toBe(calls);
    expect(t.dapp.approvals()).toEqual([]);

    const asked = async (tx: string) => {
      const signing = t.dapp.call(s, "signTx", [tx, false]);
      await until(() => t.dapp.approvals().length === 1);
      await t.dapp.answer(t.dapp.approvals()[0]!.id, false);
      await expect(signing).rejects.toMatchObject({ failure: { code: TxSignError.UserDeclined } });
    };
    // The chain's collateral put up as collateral is what getCollateral gives a site: that's still asked.
    await asked(siteTx({ inputs: [free!], collateral: [collateral] }));
    // Once the chain is all sent, it lets go: the UTxO is the site's to spend again.
    await t.lovejoin.release("preprod", "public");
    await asked(siteTx({ inputs: [held!] }));
  });

  it("refuses a transaction over 64 KiB before reading any of it: no Koios request, no prompt", async () => {
    const t = await on();
    const s = await connected(t);
    // An input the account doesn't hold, and 70,000 bytes of padding after the body.
    const big = `84a10081825820${"cd".repeat(32)}00a0f55a${(70_000).toString(16).padStart(8, "0")}${"00".repeat(70_000)}`;
    const calls = t.koios.calls.length;
    for (const method of ["signTx", "submitTx"] as const) {
      await expect(t.dapp.call(s, method, [big, false])).rejects.toMatchObject({
        failure: { code: APIError.InvalidRequest, info: expect.stringContaining("far larger than Cardano allows") },
      });
    }
    expect(t.koios.calls.length).toBe(calls);
    expect(t.koios.submitted).toHaveLength(0);
    expect(t.dapp.approvals()).toEqual([]);
  });

  it("shares one reading of the account among the calls that ask at the same time", async () => {
    const t = await on();
    const s = await connected(t);
    await t.dapp.call(s, "getBalance", []);
    t.clock.now += 31_000;
    const reads = () => t.koios.calls.filter((c) => c.path === "account_addresses").length;
    const before = reads();
    // Koios holds its answers while ten calls come in.
    let release!: () => void;
    t.koios.hold = new Promise((r) => (release = r));
    const balances = Array.from({ length: 10 }, () => t.dapp.call(s, "getBalance", []));
    await until(() => reads() > before);
    for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 0));
    release();
    t.koios.hold = undefined;
    expect(new Set(await Promise.all(balances)).size).toBe(1);
    expect(reads()).toBe(before + 1);
  });

  it("gives a site a few lookups and submits a minute, and a few calls at once", async () => {
    const t = await on();
    const s = await connected(t);
    // It spends a UTxO nobody has: each try reads the account afresh (a few a minute) and looks it up.
    const unknown = `84a30081825820${"cd".repeat(32)}0001800200a0f5f6`;
    const lookups = () => t.koios.calls.filter((c) => c.path === "utxo_info").length;
    const fresh = () => t.koios.calls.filter((c) => c.path === "account_addresses").length;
    await t.dapp.call(s, "getBalance", []);
    const [lookedUp, readFresh] = [lookups(), fresh()];
    for (let i = 0; i < 6; i++) {
      await expect(t.dapp.call(s, "signTx", [unknown, true])).rejects.toMatchObject({ failure: { code: TxSignError.ProofGeneration } });
    }
    expect(lookups()).toBe(lookedUp + 6);
    expect(fresh()).toBe(readFresh + 4);
    await expect(t.dapp.call(s, "signTx", [unknown, true])).rejects.toMatchObject({
      failure: { code: APIError.Refused, info: expect.stringContaining("too often") },
    });
    expect(lookups()).toBe(lookedUp + 6);
    // Another site has its own; a minute later this one does again.
    const other = await connected(t, site("https://other.example"));
    await expect(t.dapp.call(other, "signTx", [unknown, true])).rejects.toMatchObject({ failure: { code: TxSignError.ProofGeneration } });
    t.clock.now += 60_000;
    await expect(t.dapp.call(s, "signTx", [unknown, true])).rejects.toMatchObject({ failure: { code: TxSignError.ProofGeneration } });

    // Ten submits a minute.
    const { tx } = await built(t);
    for (let i = 0; i < 10; i++) await t.dapp.call(s, "submitTx", [tx]);
    await expect(t.dapp.call(s, "submitTx", [tx])).rejects.toMatchObject({
      failure: { code: TxSendError.Refused, info: expect.stringContaining("too often") },
    });
    expect(t.koios.submitted).toHaveLength(10);

    // Data to sign over 64 KiB is refused unread.
    await expect(t.dapp.call(s, "signData", [OWN, "00".repeat(65_537)])).rejects.toMatchObject({
      failure: { code: APIError.InvalidRequest, info: expect.stringContaining("at most 64 KiB") },
    });
    expect(t.dapp.approvals()).toEqual([]);

    // 32 calls at once from one site; the next is refused, and once they're answered it's taken again.
    t.clock.now += 31_000;
    const before = fresh();
    let release!: () => void;
    t.koios.hold = new Promise((r) => (release = r));
    const waiting = Array.from({ length: 32 }, () => t.dapp.call(s, "getBalance", []));
    await until(() => fresh() > before);
    await expect(t.dapp.call(s, "getBalance", [])).rejects.toMatchObject({
      failure: { code: APIError.Refused, info: "Seedelf Wallet is busy with this site's other requests." },
    });
    release();
    t.koios.hold = undefined;
    await Promise.all(waiting);
    expect(typeof (await t.dapp.call(s, "getBalance", []))).toBe("string");
  });

  it("reads a site's transactions one at a time, a few a minute it won't sign, and none while the window's queue is full", async () => {
    const t = await on();
    // WebAssembly's reading of a site's transaction, counted: it can take half a second of the wallet's queue.
    const wasm = t.deps.wasm;
    let reads = 0;
    const dapp = new DappService({
      ...t.deps,
      wasm: {
        ...wasm,
        inspectDappTx: (keys: Parameters<typeof wasm.inspectDappTx>[0], request: string) => {
          reads++;
          return wasm.inspectDappTx(keys, request);
        },
      } as typeof wasm,
      store: t.store,
      sessions: t.sessions,
      network: () => "preprod",
      window: t.dappWindow,
      changed: () => undefined,
    });
    const connect = async (s: DappSession) => {
      const enabling = dapp.call(s, "enable", []);
      await until(() => dapp.approvals().length === 1);
      await dapp.answer(dapp.approvals()[0]!.id, true);
      await enabling;
      return s;
    };
    const [s, other] = [await connect(site()), await connect(site("https://other.example"))];
    await dapp.call(s, "getBalance", []);
    // Nothing of the account's to sign in it.
    const nothing = siteTx({ inputs: [] });
    const nothingToSign = { failure: { code: TxSignError.ProofGeneration, info: "Nothing in this transaction is the public account's to sign." } };

    // One at a time: the site's first spends a UTxO nobody has, and Koios holds its lookup; its next waits
    // for it, unread, while another site's is read.
    let release!: () => void;
    t.koios.hold = new Promise((r) => (release = r));
    const first = dapp.call(s, "signTx", [`84a30081825820${"cd".repeat(32)}0001800200a0f5f6`, true]);
    const next = dapp.call(s, "signTx", [nothing, false]);
    await expect(dapp.call(other, "signTx", [nothing, false])).rejects.toMatchObject(nothingToSign);
    expect(reads).toBe(1);
    release();
    t.koios.hold = undefined;
    await expect(first).rejects.toMatchObject({ failure: { code: TxSignError.ProofGeneration } });
    await expect(next).rejects.toMatchObject(nothingToSign);
    expect(reads).toBe(3);

    // A few a minute it won't sign; those put in front of the user never count.
    t.clock.now += 60_000;
    const { tx } = await built(t);
    const asked = async () => {
      const signing = dapp.call(s, "signTx", [tx, false]);
      await until(() => dapp.approvals().length === 1);
      await dapp.answer(dapp.approvals()[0]!.id, false);
      await expect(signing).rejects.toMatchObject({ failure: { code: TxSignError.UserDeclined } });
    };
    for (let i = 0; i < 3; i++) await asked();
    for (let i = 0; i < 20; i++) await expect(dapp.call(s, "signTx", [nothing, false])).rejects.toMatchObject(nothingToSign);
    const tooOften = { failure: { code: APIError.Refused, info: expect.stringContaining("too often") } };
    await expect(dapp.call(s, "signTx", [nothing, false])).rejects.toMatchObject(tooOften);
    await expect(dapp.call(s, "signTx", [tx, false])).rejects.toMatchObject(tooOften);
    expect(reads).toBe(3 + 3 + 20);
    // Another site has its own; a minute later this one does again.
    await expect(dapp.call(other, "signTx", [nothing, false])).rejects.toMatchObject(nothingToSign);
    t.clock.now += 60_000;
    await asked();
    expect(reads).toBe(3 + 3 + 20 + 2);

    // Twenty wait for the user: the next is refused unread, as the window would refuse it.
    const waiting = Array.from({ length: 20 }, () => dapp.call(s, "signTx", [tx, false]));
    await until(() => dapp.approvals().length === 20);
    const before = reads;
    await expect(dapp.call(other, "signTx", [tx, false])).rejects.toMatchObject({
      failure: { code: APIError.Refused, info: "Seedelf Wallet is busy with this site's other requests." },
    });
    expect(reads).toBe(before);
    for (const approval of dapp.approvals()) await dapp.answer(approval.id, false);
    for (const w of waiting) await expect(w).rejects.toMatchObject({ failure: { code: TxSignError.UserDeclined } });
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

  it("closes its window only with nothing waiting, and never declines unseen what came in as it closed", async () => {
    const t = await on();
    const s = await connected(t);
    // Nothing left: the worker closes it.
    expect(await t.dapp.closeWindow()).toBe(true);
    expect(t.dappWindow).toMatchObject({ closed: 1, open: false });
    await t.dapp.windowClosed();

    // A request came in before the window asked: it stays, and shows it.
    const message = [t.deps.wasm.cip30Address(OWN), hex("Sign in")];
    const first = t.dapp.call(s, "signData", message);
    await until(() => t.dapp.approvals().length === 1);
    expect(await t.dapp.closeWindow()).toBe(false);
    expect(t.dappWindow).toMatchObject({ closed: 1, open: true });
    await t.dapp.answer(t.dapp.approvals()[0]!.id, false);
    await expect(first).rejects.toMatchObject({ failure: { code: DataSignError.UserDeclined } });

    // One comes in as the worker closes it: the window it was shown in goes, and a new one shows it.
    expect(await t.dapp.closeWindow()).toBe(true);
    const second = t.dapp.call(s, "signData", message);
    await until(() => t.dapp.approvals().length === 1);
    t.dappWindow.open = false;
    const shown = t.dappWindow.shown;
    await t.dapp.windowClosed();
    expect(t.dappWindow.shown).toBe(shown + 1);
    expect(t.dapp.approvals()).toHaveLength(1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, false);
    await expect(second).rejects.toMatchObject({ failure: { code: DataSignError.UserDeclined } });

    // The user closing it declines what's waiting, as before.
    const third = t.dapp.call(s, "signData", message);
    await until(() => t.dapp.approvals().length === 1);
    t.dappWindow.open = false;
    await t.dapp.windowClosed();
    await expect(third).rejects.toMatchObject({ failure: { code: DataSignError.UserDeclined } });
    expect(t.dapp.approvals()).toEqual([]);
  });

  it("keeps every connection when several are answered at once", async () => {
    const t = await on();
    const origins = ["https://a.example", "https://b.example", "https://c.example"];
    const enabling = origins.map((o) => t.dapp.call(site(o), "enable", []));
    await until(() => t.dapp.approvals().length === 3);
    await Promise.all(t.dapp.approvals().map((a) => t.dapp.answer(a.id, true)));
    expect(await Promise.all(enabling)).toEqual([true, true, true]);
    expect((await t.dapp.sites()).map((s) => s.origin)).toEqual(origins);
  });

  it("waits for an unlock in its window, naming the site, and refuses for a while once it's closed instead", async () => {
    const t = await on();
    const s = await connected(t);
    await t.wallet.lock();

    // enable() unlocks in the window, which names who's waiting, then answers at once: the site is connected.
    const enabling = t.dapp.call(s, "enable", []);
    await until(() => t.dappWindow.shown === 2);
    expect(t.dapp.unlockingSites()).toEqual(["https://app.example.com"]);
    await t.wallet.unlock(PASSWORD);
    await t.dapp.stateChanged();
    expect(await enabling).toBe(true);
    expect(t.dapp.unlockingSites()).toEqual([]);
    expect(await t.dapp.call(s, "getNetworkId", [])).toBe(0);

    await t.wallet.lock();
    const message = [t.deps.wasm.cip30Address(OWN), hex("Sign in")];
    const refused = t.dapp.call(s, "signData", message);
    await until(() => t.dappWindow.shown === 3);
    t.dappWindow.open = false;
    await t.dapp.windowClosed();
    // Closed: declined, as a request the user said no to is, and nothing more.
    await expect(refused).rejects.toMatchObject({ failure: { code: APIError.Refused, info: "The user declined." } });
    // A site that asks again and again doesn't bring the window back for a minute.
    await expect(t.dapp.call(s, "signData", message)).rejects.toMatchObject({ failure: { code: APIError.Refused } });
    expect(t.dappWindow.shown).toBe(3);
  });

  it("tells no site when the wallet locks or unlocks: isEnabled holds, and reads are refused as a stranger's, unasked", async () => {
    const t = await on();
    const s = await connected(t);
    const stranger = site("https://stranger.example");
    const notConnected = { failure: { code: APIError.Refused, info: "This site isn't connected to Seedelf Wallet. Call enable() first." } };
    const unlocked = {
      connected: await t.dapp.call(s, "isEnabled", []),
      stranger: await t.dapp.call(stranger, "isEnabled", []),
      read: await t.dapp.call(stranger, "getNetworkId", []).catch((e: DappError) => e),
    };
    expect(unlocked).toMatchObject({ connected: true, stranger: false, read: notConnected });

    await t.wallet.lock();
    // The same answers, and no window: a site learns nothing of the lock from them, and can't bring the window up.
    expect(await t.dapp.call(s, "isEnabled", [])).toBe(true);
    expect(await t.dapp.call(stranger, "isEnabled", [])).toBe(false);
    for (const who of [stranger, s]) {
      for (const method of ["getNetworkId", "getBalance", "getUtxos", "getUsedAddresses", "getRewardAddresses"] as const) {
        await expect(t.dapp.call(who, method, [])).rejects.toMatchObject(notConnected);
      }
    }
    expect(t.dappWindow.shown).toBe(1);
    expect(t.dapp.unlockingSites()).toEqual([]);

    // Kept in the worker's memory only: one started while locked can't read the sealed list, and says no.
    const restarted = new DappService({
      ...t.deps,
      store: t.store,
      sessions: t.sessions,
      network: () => "preprod",
      window: t.dappWindow,
      changed: () => undefined,
    });
    expect(await restarted.call(s, "isEnabled", [])).toBe(false);
    // A site disconnected, or a wallet removed, isn't enabled.
    await t.wallet.unlock(PASSWORD);
    await t.dapp.forget(s.origin);
    await t.wallet.lock();
    expect(await t.dapp.call(s, "isEnabled", [])).toBe(false);
    await t.wallet.unlock(PASSWORD);
    await connected(t, s);
    await t.wallet.reset();
    await t.dapp.stateChanged();
    // The next wallet made here, locked before it has read its own list, has no site of the last one's.
    await t.wallet.create(account(15).phrase, PASSWORD);
    await t.preferences.set({ dappConnector: true });
    await t.wallet.lock();
    expect(await t.dapp.call(s, "isEnabled", [])).toBe(false);
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
      network: () => "preprod",
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

  it("says so when another of the site's requests connected it while its session's funding was sent", async () => {
    const t = await on();
    const { dapp, sessions } = privately(t);
    const first = dapp.call(site(), "enable", []);
    const second = dapp.call(site(), "enable", []);
    await until(() => dapp.approvals().length === 2);
    const [a, b] = dapp.approvals();
    const out = await dapp.privateBuild(b!.id, "15000000", []);

    // giveme.my answers slowly, and meanwhile the other request is answered with the public account.
    let answer!: () => void;
    const answered = new Promise<void>((r) => (answer = r));
    const fetch = t.collateral.fetch;
    let asked = false;
    t.collateral.fetch = async (url, init) => {
      asked = true;
      await answered;
      return fetch(url, init);
    };
    const funding = dapp.answer(b!.id, true, PASSWORD, { txHash: out.txHash });
    await until(() => asked);
    expect(await dapp.answer(a!.id, true)).toEqual({});
    answer();
    expect(await funding).toEqual({
      error: expect.stringContaining("Private session 1 is funded, but another of this site's requests connected it meanwhile"),
    });

    // The funding went out and the session holds it; the site talks to the public account, and nothing waits.
    expect(t.koios.submitted.map((x) => txIdOf(x))).toEqual([out.txHash]);
    expect((await sessions.list("preprod"))[0]).toMatchObject({ index: 0, site: { origin: site().origin } });
    expect(await dapp.sites()).toEqual([{ origin: site().origin, connectedAt: expect.any(Number) }]);
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(dapp.approvals()).toEqual([]);
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

  it("says so in the prompt when a site's transaction spends the session's collateral", async () => {
    const t = await on();
    const { dapp } = privately(t);
    const { s, out } = await connectedPrivately(t, dapp);
    const spends = async (input: string) => {
      const signing = dapp.call(s, "signTx", [siteTx({ inputs: [input] }), false]);
      await until(() => dapp.approvals().length === 1);
      const approval = dapp.approvals()[0]!;
      await dapp.answer(approval.id, false);
      await expect(signing).rejects.toMatchObject({ failure: { code: TxSignError.UserDeclined } });
      return approval;
    };
    expect(await spends(`${out.txHash}#1`)).toMatchObject({ kind: "sign-tx", session: 0, collateralSpent: true });
    expect(await spends(`${sessionSwap.utxo.tx_hash}#${sessionSwap.utxo.tx_index}`)).not.toHaveProperty("collateralSpent");
  });

  it("won't sign a site's transaction that spends what the session's return through Lovejoin still needs", async () => {
    const t = await on();
    const { dapp } = privately(t);
    const { s } = await connectedPrivately(t, dapp);
    const input = `${sessionSwap.utxo.tx_hash}#${sessionSwap.utxo.tx_index}`;
    await t.session.set(SESSION_RESERVED_PREFIX + "preprod", { [chainOwner(0)]: { inputs: [input], collateral: [] } });
    await expect(dapp.call(s, "signTx", [siteTx({ inputs: [input] }), false])).rejects.toMatchObject({
      failure: { code: TxSignError.ProofGeneration, info: expect.stringContaining("still being sent through Lovejoin") },
    });
    expect(dapp.approvals()).toEqual([]);
  });

  it("never says what another account's Lovejoin chain holds: a site on a session, or on the public account, hears what a stranger's UTxO gets", async () => {
    const t = await on();
    const { dapp } = privately(t);
    const { s } = await connectedPrivately(t, dapp);
    await t.balances.get("preprod");
    const [own] = (await t.coins.lists("preprod")).cardano;
    const account = `${own!.txHash}#${own!.index}`;
    const contract = `${ownedUtxos[0]!.tx_hash}#${ownedUtxos[0]!.tx_index}`;
    const stranger = `${"cd".repeat(32)}#0`;
    // The public account's mix and another session's return are being sent: one spends the account's UTxO, the other a Seedelf UTxO.
    await t.session.set(SESSION_RESERVED_PREFIX + "preprod", {
      [chainOwner()]: { inputs: [account], collateral: [] },
      [chainOwner(1)]: { inputs: [contract], collateral: [] },
    });
    const answer = (dapp: DappService, s: DappSession, inputs: string[]) =>
      dapp.call(s, "signTx", [siteTx({ inputs }), false]).then(
        () => undefined,
        (e: { failure: unknown }) => e.failure,
      );
    const sessionHears = { code: TxSignError.ProofGeneration, info: "Nothing in this transaction is this private session's to sign." };
    expect(await answer(dapp, s, [stranger])).toEqual(sessionHears);
    for (const inputs of [[account], [contract], [account, contract]]) expect(await answer(dapp, s, inputs)).toEqual(sessionHears);

    // A site on the public account names the session's: the same.
    const publicSite = await connected(t, site("https://public.example"));
    const publicHears = { code: TxSignError.ProofGeneration, info: "Nothing in this transaction is the public account's to sign." };
    expect(await answer(t.dapp, publicSite, [stranger])).toEqual(publicHears);
    expect(await answer(t.dapp, publicSite, [contract])).toEqual(publicHears);
    // Its own account's chain is still kept whole.
    expect(await answer(t.dapp, publicSite, [account])).toMatchObject({ info: expect.stringContaining("still being sent through Lovejoin") });
    expect(dapp.approvals()).toEqual([]);
    expect(t.dapp.approvals()).toEqual([]);
  });

  it("answers a site that names another account's recent transaction as it answers a stranger's: the same words, the same lookups", async () => {
    const t = await on();
    const { dapp } = privately(t);
    const { s, out } = await connectedPrivately(t, dapp);
    const lookups = () => t.koios.calls.filter((c) => c.path === "utxo_info").length;
    /** What a site hears for a transaction spending `input`, and how many lookups it made. */
    const probe = async (d: DappService, from: DappSession, input: string) => {
      const before = lookups();
      const failure = await d.call(from, "signTx", [siteTx({ inputs: [input] }), false]).then(
        () => undefined,
        (e: { failure: unknown }) => e.failure,
      );
      return { failure, lookups: lookups() - before };
    };
    const outputsOf = (tx: string) => (JSON.parse(t.deps.wasm.ogmiosUtxos(tx)) as Array<{ index: number }>).map((o) => o.index);

    // The public account's Send, sent a moment ago: its payment and change aren't on chain yet.
    const { summary: sent, tx: sendTx } = await built(t);
    await t.send.submit("preprod", sent.txHash);
    const stranger = await probe(dapp, s, `${"ab".repeat(32)}#0`);
    expect(stranger).toEqual({
      failure: { code: TxSignError.ProofGeneration, info: "Nothing in this transaction is this private session's to sign." },
      lookups: 1,
    });
    for (const i of outputsOf(sendTx)) expect(await probe(dapp, s, `${sent.txHash}#${i}`)).toEqual(stranger);

    // A site on the public account names the session's funding: every output, the session's and the private balance's change.
    const publicSite = await connected(t, site("https://public.example"));
    const funding = Buffer.from(t.koios.submitted.find((b) => txIdOf(b) === out.txHash)!).toString("hex");
    const publicStranger = await probe(t.dapp, publicSite, `${"ab".repeat(32)}#1`);
    expect(publicStranger).toMatchObject({ lookups: 1 });
    for (const i of outputsOf(funding)) expect(await probe(t.dapp, publicSite, `${out.txHash}#${i}`)).toEqual(publicStranger);

    // Once the session's site has used up its lookups, still the same.
    for (let i = 0; i < 6; i++) await probe(dapp, s, `${"ef".repeat(32)}#${i}`);
    const spent = await probe(dapp, s, `${"ab".repeat(32)}#0`);
    expect(spent.failure).toMatchObject({ code: APIError.Refused, info: expect.stringContaining("too often") });
    for (const i of outputsOf(sendTx)) expect(await probe(dapp, s, `${sent.txHash}#${i}`)).toEqual(spent);
  });

  it("lets a site build on what it sent itself before it's on chain, and no other site", async () => {
    const t = await on();
    const { dapp } = privately(t);
    const { s: privateSite } = await connectedPrivately(t, dapp);
    const b = await connected(t, site("https://b.example"));
    const c = await connected(t, site("https://c.example"));
    // Site B sends a transaction the wallet didn't sign: it pays someone else, with change to the account.
    const { tx } = await built(t);
    const id = (await t.dapp.call(b, "submitTx", [tx])) as string;
    const theirs = (JSON.parse(t.deps.wasm.ogmiosUtxos(tx)) as Array<{ index: number; address: string }>).find((o) => o.address === THEIRS)!;
    const input = `${id}#${theirs.index}`;
    const lookedUp = () => t.koios.calls.filter((c) => c.path === "utxo_info").flatMap((c) => c.body._utxo_refs as string[]);

    // B's next transaction spends that output, with the account's: read without Koios, as before.
    await t.balances.get("preprod");
    const [own] = (await t.coins.lists("preprod")).cardano;
    const signing = t.dapp.call(b, "signTx", [siteTx({ inputs: [input, `${own!.txHash}#${own!.index}`] }), true]);
    await until(() => t.dapp.approvals().length === 1);
    const approval = t.dapp.approvals()[0]!;
    if (approval.kind !== "sign-tx") throw new Error(approval.kind);
    expect(approval.summary).toMatchObject({ unknownInputs: [], ownInputs: 1 });
    await t.dapp.answer(approval.id, false);
    await expect(signing).rejects.toMatchObject({ failure: { code: TxSignError.UserDeclined } });
    expect(lookedUp()).not.toContain(input);

    // Another site, on the account or on a private session, finds it only where a stranger would: Koios.
    await expect(t.dapp.call(c, "signTx", [siteTx({ inputs: [input] }), false])).rejects.toMatchObject({ failure: { code: TxSignError.ProofGeneration } });
    expect(lookedUp().filter((r) => r === input)).toHaveLength(1);
    await expect(dapp.call(privateSite, "signTx", [siteTx({ inputs: [input] }), false])).rejects.toMatchObject({
      failure: { code: TxSignError.ProofGeneration },
    });
    expect(lookedUp().filter((r) => r === input)).toHaveLength(2);
  });

  it("won't register or delegate the session's stake key, which stays unregistered, but lets it stop", async () => {
    const t = await on();
    const { dapp } = privately(t);
    const { s } = await connectedPrivately(t, dapp);
    const reward = await t.wallet.withKeys((k) => k.oneTime.rewardAddress(t.deps.wasm.Network.Preprod, 0));
    const input = `${sessionSwap.utxo.tx_hash}#${sessionSwap.utxo.tx_index}`;
    const { unregister, ...staking } = certificates(stakeKeyHash(reward));
    for (const [kind, certificate] of Object.entries(staking)) {
      await expect(dapp.call(s, "signTx", [siteTx({ inputs: [input], certificates: [certificate] }), false]), kind).rejects.toMatchObject({
        failure: { code: TxSignError.ProofGeneration, info: expect.stringContaining("stays unregistered") },
      });
    }
    expect(dapp.approvals()).toEqual([]);

    // Stopping it, for a session registered before this, is still asked.
    const stopping = dapp.call(s, "signTx", [siteTx({ inputs: [input], certificates: [unregister] }), false]);
    await until(() => dapp.approvals().length === 1);
    await dapp.answer(dapp.approvals()[0]!.id, false);
    await expect(stopping).rejects.toMatchObject({ failure: { code: TxSignError.UserDeclined } });
    // An old-style stop doesn't say its deposit, and none was paid here: nothing is looked up, and it isn't signed.
    const lookups = t.koios.calls.filter((c) => c.path === "account_info").length;
    await expect(
      dapp.call(s, "signTx", [siteTx({ inputs: [input], certificates: [`82018200581c${stakeKeyHash(reward)}`] }), false]),
    ).rejects.toMatchObject({ failure: { code: TxSignError.ProofGeneration } });
    expect(t.koios.calls.filter((c) => c.path === "account_info")).toHaveLength(lookups);

    // The public account's own staking through a site is still the user's to approve.
    const publicSite = await connected(t, site("https://stake.example"));
    await t.balances.get("preprod");
    const [first] = (await t.coins.lists("preprod")).cardano;
    const { vote } = certificates(stakeKeyHash(account(12).preprod.stake as string));
    const voting = t.dapp.call(publicSite, "signTx", [siteTx({ inputs: [`${first!.txHash}#${first!.index}`], certificates: [vote] }), false]);
    await until(() => t.dapp.approvals().length === 1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, false);
    await expect(voting).rejects.toMatchObject({ failure: { code: TxSignError.UserDeclined } });
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
    // The session it recorded never got its money: closed from the dApps page, its record goes, and its index isn't used again.
    expect((await sessions.list("preprod"))[0]).toMatchObject({ index: 0, stage: "failed", site: { origin: s.origin } });
    await dapp.disconnectSession(0);
    expect(await sessions.list("preprod")).toEqual([]);
    expect((await dapp.privateBuild(connect.id, "15000000", [])).index).toBe(1);
  });

  it("reads a site's transaction that spends a top-up before it's on chain", async () => {
    const t = await on();
    const { dapp, sessions } = privately(t);
    const { s } = await connectedPrivately(t, dapp);
    t.koios.added.push({ ...ownedUtxos[0]!, tx_hash: "ee".repeat(32), block_height: 9_000_001 });
    const more = await sessions.topUpBuild("preprod", 0, "3000000", []);
    await sessions.topUpSubmit("preprod", more.txHash);
    const sent = Buffer.from(t.koios.submitted.at(-1)!).toString("hex");
    const outputs = JSON.parse(t.deps.wasm.ogmiosUtxos(sent)) as Array<{ index: number; address: string }>;
    const topUp = outputs.find((o) => o.address === sessionSwap.address)!;

    const signing = dapp.call(s, "signTx", [siteTx({ inputs: [`${more.txHash}#${topUp.index}`] }), false]);
    await until(() => dapp.approvals().length === 1);
    const approval = dapp.approvals()[0]!;
    if (approval.kind !== "sign-tx") throw new Error(approval.kind);
    expect(approval.summary).toMatchObject({ unknownInputs: [], ownInputs: 1, spentLovelace: "3000000", signs: ["0/0"] });
    await dapp.answer(approval.id, false);
    await expect(signing).rejects.toMatchObject({ failure: { code: TxSignError.UserDeclined } });
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
    t.koios.confirmations = 1;

    // The account holds something: disconnecting refuses, and the site stays connected.
    await expect(dapp.forget(s.origin)).rejects.toThrow("Bring it back first");
    expect(await dapp.sites()).toHaveLength(1);

    // Brought back (the account is empty): disconnecting ends the session, and the site's next connect asks again.
    t.koios.addedToAccounts.splice(0);
    expect(await dapp.forget(s.origin)).toEqual([]);
    await expect(dapp.call(s, "getBalance", [])).rejects.toMatchObject({ failure: { code: APIError.Refused } });
    // Nothing on the device says which site had it any more (privacy review §3.12); its index isn't used again.
    expect(await sessions.list("preprod")).toEqual([]);
    expect(JSON.stringify(await t.store.get("sessions.preprod"))).not.toContain("example.com");
    expect(await t.store.get("sessions.preprod")).toMatchObject({ next: 1 });
  });
});

describe("the wallet's own transactions, kept a while for sites to build on", () => {
  const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!, (h) => Number.parseInt(h, 16));
  const tx = (i: number) => bytes(`84a10081825820${i.toString(16).padStart(64, "0")}00a0f5f6`);

  it("keeps the newest 16 for 20 minutes, and none it can't read or too big to be on chain", async () => {
    const session = memoryArea();
    for (let i = 0; i < 20; i++) await rememberSent(session, "preprod", tx(i), 1_000 * i);
    const kept = await recentlySent(session, "preprod", 20_000);
    expect(kept.map((s) => s.txHash)).toEqual(Array.from({ length: 16 }, (_, i) => txIdOf(tx(i + 4))));
    expect(kept[0]!.txCbor).toBe(Buffer.from(tx(4)).toString("hex"));
    // Twenty minutes after the oldest kept, it's gone.
    expect(await recentlySent(session, "preprod", 4_000 + SENT_KEEP_MS)).toHaveLength(15);

    await rememberSent(session, "preprod", bytes("00"), 20_000);
    const big = new Uint8Array(16_385);
    big.set(tx(99));
    await rememberSent(session, "preprod", big, 20_000);
    expect(await recentlySent(session, "preprod", 20_000)).toHaveLength(16);
  });

  it("keeps each network's apart, and never reads what was kept for both before", async () => {
    const session = memoryArea();
    await rememberSent(session, "mainnet", tx(1), 1_000);
    await rememberSent(session, "preprod", tx(2), 1_000);
    expect((await recentlySent(session, "mainnet", 2_000)).map((s) => s.txHash)).toEqual([txIdOf(tx(1))]);
    expect((await recentlySent(session, "preprod", 2_000)).map((s) => s.txHash)).toEqual([txIdOf(tx(2))]);
    // Kept under the one key for both networks, before: no network says whose it is, so neither reads it.
    await session.set("seedelf.sent", [{ txHash: txIdOf(tx(3)), txCbor: Buffer.from(tx(3)).toString("hex"), sentAt: 1_000 }]);
    for (const network of ["mainnet", "preprod"] as const) {
      expect((await recentlySent(session, network, 2_000)).map((s) => s.txHash)).not.toContain(txIdOf(tx(3)));
    }
  });
});

describe("the prompt's words for the account's staking", () => {
  type Certificate = DappTxSummary["certificates"][number];
  const cert = (c: Partial<Certificate>): Certificate => ({
    kind: "unregister",
    own: true,
    pool: null,
    poolAction: null,
    drep: null,
    deposit: null,
    refund: "2000000",
    ...c,
  });

  it("says whether a deposit back comes back to the account, and names a stake pool's certificate", () => {
    expect(certificateLine(cert({}), true, "your public account")).toBe(
      "Stops your staking, and its 2 ₳ deposit comes back to your public account.",
    );
    expect(certificateLine(cert({}), false, "your private session")).toBe(
      "Stops your staking, and its 2 ₳ deposit doesn't all come back to your private session: it's counted in what it sends above.",
    );
    const pool = { kind: "pool", own: false, refund: null, pool: "pool1abc" } as const;
    expect(certificateLine(cert({ ...pool, poolAction: "register" }), true, "")).toBe("Registers stake pool pool1abc, or updates its terms.");
    expect(certificateLine(cert({ ...pool, poolAction: "retire" }), true, "")).toBe("Retires stake pool pool1abc.");
    expect(certificateLine(cert({ ...pool, pool: null }), true, "")).toBe("A stake pool's certificate.");
    // Staking money comes back when the account's own outputs get at least as much, the fee aside.
    expect(stakingComesBack({ returnedLovelace: "1830000", stakingLovelace: "2000000", fee: "170000" })).toBe(true);
    expect(stakingComesBack({ returnedLovelace: "1829999", stakingLovelace: "2000000", fee: "170000" })).toBe(false);
  });
});

