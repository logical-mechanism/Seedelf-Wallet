// A site's signing prompt says when the transaction moves money between the
// account the site sees and another of the wallet's (independent review
// M12): for a site on a private session, the public account (a base,
// enterprise or staked-to-it address, or an input of it) and the other
// sessions; for a site on the public account, the sessions. Signing would
// tie them on chain. Only the prompt says so: the site is never refused, so
// it learns nothing. "Your public account and your private balance aren't in
// it" is said only when the worker checked and nothing matched.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { DappService, type DappSession } from "../src/background/dapp";
import type { KoiosUtxo } from "../src/background/koios";
import { Minswap } from "../src/background/minswap";
import { SessionService } from "../src/background/sessions";
import type { DappApproval, DappTxSummary } from "../src/shared/rpc";
import { paidTo, signingTies, tiesLine } from "../src/ui/dapp";
import { SignTx } from "../src/ui/screens/DappApprovals";
import { loadTestWasm, sessionSwap, testBalances, vectors, withdrawPreprod } from "./fakes";
import { txIdOf } from "./fixtures/cbor";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
const OWN = account(12).preprod.receive_0 as string;
const THEIRS = account(15).preprod.receive_0 as string;
const SESSION_INPUT = `${sessionSwap.utxo.tx_hash}#${sessionSwap.utxo.tx_index}`;

let pages = 0;
const site = (origin = "https://app.example.com"): DappSession => ({ id: `ties${++pages}`, origin, title: "Example" });

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}

const uint = (n: number) => (n < 24 ? n.toString(16).padStart(2, "0") : `18${n.toString(16).padStart(2, "0")}`);
const outpoints = (list: string[]) => `8${list.length}${list.map((o) => `825820${o.slice(0, 64)}${uint(Number(o.slice(65)))}`).join("")}`;
const bytesOf = (hex: string) => `58${(hex.length / 2).toString(16).padStart(2, "0")}${hex}`;

/** A site's transaction: it spends `inputs` and pays 4 ₳ to each address (CIP-30 hex). Nothing balances it: the wallet only reads it. */
function paying(inputs: string[], to: string[]) {
  const outputs = `8${to.length}${to.map((a) => `82${bytesOf(a)}1a003d0900`).join("")}`;
  return `84a300${outpoints(inputs)}01${outputs}021a00029810a0f5f6`;
}

async function on() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
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

/** The connector over sessions whose giveme.my witness and Seedelf signature are stood in for (as dapp.test.ts's). */
function privately(t: T, over: Partial<SessionService> = {}) {
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
  Object.assign(sessions, over);
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
  t.koios.addedToAccounts.push(atSession(sessionSwap.utxo.tx_hash, sessionSwap.utxo.tx_index, sessionSwap.utxo.value), atSession(out.txHash, 1, "5000000"));
  expect(await enabling).toBe(true);
  return s;
}

/** What the prompt shows for `tx`, asked by `s`; declined after. */
async function prompt(dapp: DappService, s: DappSession, tx: string, partial = false) {
  const signing = dapp.call(s, "signTx", [tx, partial]);
  await until(() => dapp.approvals().length === 1);
  const approval = dapp.approvals()[0]! as Extract<DappApproval, { kind: "sign-tx" }>;
  await dapp.answer(approval.id, false);
  await expect(signing).rejects.toMatchObject({ failure: { info: "The user declined." } });
  return approval;
}

describe("a private session's signing prompt", () => {
  it("names the public account when the transaction pays it, by any address of its keys", async () => {
    const t = await on();
    const { dapp } = privately(t);
    const s = await connectedPrivately(t, dapp);
    const { wasm } = t.deps;
    const [enterpriseKey, stakeAddress] = await t.wallet.withKeys((k) => [
      k.cardano.paymentKeyHash(0, 3),
      k.cardano.stakeAddress(wasm.Network.Preprod),
    ]);
    const stakeHash = wasm.cip30Address(stakeAddress).slice(2);
    for (const address of [
      wasm.cip30Address(OWN),
      // An enterprise address of one of its payment keys, and someone's key staked to its stake key.
      `60${enterpriseKey}`,
      `00${"ab".repeat(28)}${stakeHash}`,
    ]) {
      const approval = await prompt(dapp, s, paying([SESSION_INPUT], [address]));
      expect(approval.ties).toEqual(["account"]);
      expect(approval.summary.paid.map((p) => p.yours)).toEqual(["account"]);
    }
  });

  it("names the public account when it spends from it, with partialSign", async () => {
    const t = await on();
    const { dapp } = privately(t);
    const s = await connectedPrivately(t, dapp);
    await t.balances.get("preprod");
    const [own] = (await t.coins.lists("preprod")).cardano;
    const approval = await prompt(dapp, s, paying([SESSION_INPUT, `${own!.txHash}#${own!.index}`], [t.deps.wasm.cip30Address(THEIRS)]), true);
    expect(approval.ties).toEqual(["account"]);
    expect(approval.summary.paid.map((p) => p.yours)).toEqual([undefined]);
  });

  it("names another private session it pays, and nothing when it pays someone else", async () => {
    const t = await on();
    const { dapp } = privately(t);
    const s = await connectedPrivately(t, dapp);
    const { wasm } = t.deps;
    // Session 1 was used on this device too.
    const book = (await t.store.get<{ next: number }>("sessions.preprod"))!;
    await t.store.set("sessions.preprod", { ...book, next: 2 });
    const other = await t.wallet.withKeys((k) => k.oneTime.address(wasm.Network.Preprod, 1));
    const approval = await prompt(dapp, s, paying([SESSION_INPUT], [wasm.cip30Address(other), wasm.cip30Address(THEIRS)]));
    expect(approval.ties).toEqual([1]);
    expect(approval.summary.paid.map((p) => p.yours)).toEqual([1, undefined]);

    const plain = await prompt(dapp, s, paying([SESSION_INPUT], [wasm.cip30Address(THEIRS)]));
    expect(plain.ties).toEqual([]);
    expect(plain.summary.paid[0]).not.toHaveProperty("yours");
  });

  it("is signed all the same once approved: the site is never told", async () => {
    const t = await on();
    const { dapp } = privately(t);
    const s = await connectedPrivately(t, dapp);
    const signing = dapp.call(s, "signTx", [paying([SESSION_INPUT], [t.deps.wasm.cip30Address(OWN)]), false]);
    await until(() => dapp.approvals().length === 1);
    expect(dapp.approvals()[0]).toMatchObject({ ties: ["account"] });
    expect(await dapp.answer(dapp.approvals()[0]!.id, true, PASSWORD)).toEqual({});
    expect(((await signing) as string).slice(0, 2)).toBe("a1");
  });

  it("promises nothing when the wallet couldn't check", async () => {
    const t = await on();
    const { dapp, sessions } = privately(t);
    const s = await connectedPrivately(t, dapp);
    sessions.indices = async () => {
      throw new Error("Seedelf Wallet couldn't open its record of your private sessions on this device, so it won't write over it.");
    };
    const approval = await prompt(dapp, s, paying([SESSION_INPUT], [t.deps.wasm.cip30Address(THEIRS)]));
    expect(approval).not.toHaveProperty("ties");
  });
});

describe("the public account's signing prompt", () => {
  it("names a private session it pays, and never the public account itself", async () => {
    const t = await on();
    const { dapp } = privately(t);
    await connectedPrivately(t, dapp);
    const s = site("https://public.example");
    const enabling = dapp.call(s, "enable", []);
    await until(() => dapp.approvals().length === 1);
    await dapp.answer(dapp.approvals()[0]!.id, true);
    await enabling;
    await t.balances.get("preprod");
    const [own] = (await t.coins.lists("preprod")).cardano;
    const { wasm } = t.deps;
    const approval = await prompt(dapp, s, paying([`${own!.txHash}#${own!.index}`], [wasm.cip30Address(sessionSwap.address), wasm.cip30Address(THEIRS)]));
    expect(approval.ties).toEqual([0]);
    expect(approval.summary.paid.map((p) => p.yours)).toEqual([0, undefined]);
    const plain = await prompt(dapp, s, paying([`${own!.txHash}#${own!.index}`], [wasm.cip30Address(THEIRS)]));
    expect(plain.ties).toEqual([]);
  });
});

describe("the prompt's words", () => {
  const summary = (paid: DappTxSummary["paid"], seedelf = false): DappTxSummary => ({
    txHash: "ab".repeat(32),
    fee: "180000",
    netLovelace: "-4180000",
    netTokens: [],
    spentLovelace: "10000000",
    returnedLovelace: "5820000",
    stakingLovelace: "0",
    ownInputs: 1,
    paid: seedelf ? [...paid, { ...paid[0]!, yours: undefined, seedelf: "register", script: true }] : paid,
    ownOutputs: [],
    mint: [],
    certificates: [],
    withdrawals: [],
    collateral: null,
    scripts: false,
    referenceInputs: 0,
    votes: 0,
    proposals: 0,
    donation: null,
    note: null,
    metadata: false,
    validFrom: null,
    validUntil: null,
    signs: ["0/0"],
    unknownInputs: [],
    othersSign: 0,
    complete: true,
  });
  const out: DappTxSummary["paid"][number] = { address: OWN, lovelace: "4000000", tokens: [], datum: null, script: false, seedelf: null, ownPaymentKey: false };
  const text = (props: Parameters<typeof SignTx>[0]) =>
    renderToStaticMarkup(createElement(SignTx, props))
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, " ");

  it("warn when a session's transaction pays the public account, and never say it isn't in it", () => {
    const page = text({ summary: summary([{ ...out, yours: "account" }]), partial: false, session: true, collateralSpent: false, ties: ["account"] });
    expect(page).toContain("Your public account");
    expect(page).toContain(
      "It moves money between this private session and your public account. Signing ties them together on chain, where anyone can see it.",
    );
    expect(page).toContain("Signing ties this transaction to the session's one-time account.");
    expect(page).not.toContain("aren't in it");
  });

  it("say the other side isn't in it only when the worker checked and found nothing", () => {
    const plain = summary([{ ...out, address: THEIRS }]);
    expect(text({ summary: plain, partial: false, session: true, collateralSpent: false, ties: [] })).toContain(
      "Your public account and your private balance aren't in it.",
    );
    expect(text({ summary: plain, partial: false, session: true, collateralSpent: false })).not.toContain("aren't in it");
    expect(text({ summary: plain, partial: false, session: false, collateralSpent: false, ties: [] })).toContain("Your private balance isn't in it.");
    expect(text({ summary: plain, partial: false, session: false, collateralSpent: false })).not.toContain("isn't in it");
  });

  it("name several, and say a Seedelf paid from a session comes from its one-time account", () => {
    expect(tiesLine(["account", 1, 4], true)).toBe(
      "It moves money between this private session and your public account, your private session 2 and your private session 5. Signing ties them together on chain, where anyone can see it.",
    );
    expect(tiesLine([0], false)).toBe(
      "It moves money between your public account and your private session 1. Signing ties them together on chain, where anyone can see it.",
    );
    expect(paidTo({ ...out, yours: 2, datum: "inline" })).toBe("Your private session 3, with data");
    expect(signingTies([1], false)).toBe("Signing ties this transaction to your public account, as any payment from it.");
    const page = text({ summary: summary([{ ...out, address: THEIRS }], true), partial: false, session: true, collateralSpent: false, ties: [] });
    expect(page).toContain("It pays a Seedelf. Nothing on chain says whose, but it comes from this private session's one-time account in the open.");
  });
});
