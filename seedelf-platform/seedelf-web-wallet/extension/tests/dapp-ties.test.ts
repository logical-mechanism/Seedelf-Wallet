// A site's signing prompt says when the transaction moves money between the
// account the site sees and another of the wallet's (independent review
// M12): for a site on a private session, the public account (a base or
// enterprise address of its keys, or an input of it) and the other
// sessions; for a site on the public account, the sessions. Signing would
// tie them on chain. Only the prompt says so: the site is never refused, so
// it learns nothing. "Your public account and your private balance aren't in
// it" is said only when the worker checked and nothing matched. Someone
// else's address that carries one of their stake keys ties them too, but
// isn't theirs to spend, and is said apart (1.5.0's release review, C01). So
// does a certificate or a withdrawal that names one of their stake keys: an
// old-style registration needs no signature of that key's (X05), nor does a
// stake pool's registration that makes one its reward account (the last
// review, L1).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { DappService, type DappSession } from "../src/background/dapp";
import type { KoiosUtxo } from "../src/background/koios";
import { Minswap } from "../src/background/minswap";
import { SessionService } from "../src/background/sessions";
import type { DappApproval, DappTxSummary } from "../src/shared/rpc";
import { certificateLine, certifiedLine, paidTo, signingTies, stakedLine, tiesLine, withdrawalLine } from "../src/ui/dapp";
import { SignTx } from "../src/ui/screens/DappApprovals";
import { loadTestWasm, sessionSwap, testBalances, vectors, withdrawPreprod } from "./fakes";
import { preprodAddress } from "./fixtures/bech32";
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

/**
 * As `paying`, with `certificates` (CBOR, hex), a zero withdrawal from each of `withdrawals` and a proposal whose deposit
 * goes back to each of `proposals` (reward addresses, CIP-30 hex).
 */
function carrying(
  inputs: string[],
  to: string[],
  { certificates = [], withdrawals = [], proposals = [] }: { certificates?: string[]; withdrawals?: string[]; proposals?: string[] },
) {
  const outputs = `8${to.length}${to.map((a) => `82${bytesOf(a)}1a003d0900`).join("")}`;
  const fields = [`00${outpoints(inputs)}`, `01${outputs}`, "021a00029810"];
  if (certificates.length) fields.push(`048${certificates.length}${certificates.join("")}`);
  if (withdrawals.length) fields.push(`05a${withdrawals.length}${withdrawals.map((w) => `${bytesOf(w)}00`).join("")}`);
  if (proposals.length) fields.push(`148${proposals.length}${proposals.map(proposes).join("")}`);
  return `84a${fields.length}${fields.join("")}a0f5f6`;
}

/** An Info action with a 1,000 ₳ deposit that goes back to `reward` (a reward address, CIP-30 hex): it takes no signature of that key's. */
const proposes = (reward: string) => `841a3b9aca00${bytesOf(reward)}8106826b${Buffer.from("https://x.y").toString("hex")}5820${"33".repeat(32)}`;

/** An old-style stake registration (certificate kind 0) of a stake key hash: it needs no signature of that key's. */
const registers = (stakeHash: string) => `82008200581c${stakeHash}`;

/**
 * A stake pool's registration (certificate kind 3) that makes `reward` (a reward address, CIP-30 hex) the pool's reward
 * account: its operator and its owner sign it, never that account's key.
 */
const registersPool = (reward: string) =>
  `8a03581c${"77".repeat(28)}5820${"88".repeat(32)}001a0a21fe80d81e820001581d${reward}81581c${"99".repeat(28)}80f6`;

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

/** The window's text for a prompt, as SignTx shows it with one public account. */
function shown(approval: Extract<DappApproval, { kind: "sign-tx" }>, session: boolean, partial = false) {
  const { summary, ties, staked, certified } = approval;
  return renderToStaticMarkup(createElement(SignTx, { summary, partial, session, collateralSpent: false, ties, staked, certified }))
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
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
    // Its receive address, and an enterprise address of one of its payment keys.
    for (const address of [wasm.cip30Address(OWN), `60${enterpriseKey}`]) {
      const approval = await prompt(dapp, s, paying([SESSION_INPUT], [address]));
      expect(approval.ties).toEqual([{ account: 0 }]);
      expect(approval.staked).toEqual([]);
      expect(approval.summary.paid.map((p) => p.yours)).toEqual([{ account: 0 }]);
    }
    // Someone's key staked to its stake key: theirs to spend, so not the public account's, but tied to it (C01).
    const staked = await prompt(dapp, s, paying([SESSION_INPUT], [`00${"ab".repeat(28)}${stakeHash}`]));
    expect(staked.ties).toEqual([]);
    expect(staked.staked).toEqual([{ account: 0 }]);
    expect(staked.summary.paid.map((p) => p.yours)).toEqual([undefined]);
    expect(paidTo(staked.summary.paid[0]!)).toBe("An address");
  });

  it("says apart an input of someone else's that carries the public account's stake key, with partialSign (C01)", async () => {
    const t = await on();
    const { dapp } = privately(t);
    const s = await connectedPrivately(t, dapp);
    const { wasm } = t.deps;
    const stake_address = await t.wallet.withKeys((k) => k.cardano.stakeAddress(wasm.Network.Preprod));
    // Someone's UTxO under the public account's stake key, as Koios lists it: spending it is theirs to sign.
    const address = preprodAddress("ab".repeat(28), wasm.cip30Address(stake_address).slice(2));
    t.koios.addedToAccounts.push({ ...atSession("cd".repeat(32), 0, "3000000"), address, payment_cred: "ab".repeat(28), stake_address });
    const approval = await prompt(dapp, s, paying([SESSION_INPUT, `${"cd".repeat(32)}#0`], [wasm.cip30Address(THEIRS)]), true);
    expect(approval.ties).toEqual([]);
    expect(approval.staked).toEqual([{ account: 0 }]);
  });

  it("names the public account when it spends from it, with partialSign", async () => {
    const t = await on();
    const { dapp } = privately(t);
    const s = await connectedPrivately(t, dapp);
    await t.balances.get("preprod");
    const [own] = (await t.coins.lists("preprod")).cardano;
    const approval = await prompt(dapp, s, paying([SESSION_INPUT, `${own!.txHash}#${own!.index}`], [t.deps.wasm.cip30Address(THEIRS)]), true);
    expect(approval.ties).toEqual([{ account: 0 }]);
    expect(approval.summary.paid.map((p) => p.yours)).toEqual([undefined]);
  });

  it("names another private session it pays, and nothing when it pays someone else", async () => {
    const t = await on();
    const { dapp } = privately(t);
    const s = await connectedPrivately(t, dapp);
    const { wasm } = t.deps;
    // Session 1 was used on this device too: written once the funding the connector saw land is recorded
    // (final review F13), which it does in turn with the sessions' other writes.
    type Book = { next: number; sessions: Array<{ txs: Array<{ confirmed?: boolean }> }> };
    let book = (await t.store.get<Book>("sessions.preprod"))!;
    for (let i = 0; i < 200 && !book.sessions[0]!.txs[0]!.confirmed; i++) {
      await new Promise((r) => setTimeout(r, 0));
      book = (await t.store.get<Book>("sessions.preprod"))!;
    }
    expect(book.sessions[0]!.txs[0]!.confirmed).toBe(true);
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
    expect(dapp.approvals()[0]).toMatchObject({ ties: [{ account: 0 }] });
    expect(await dapp.answer(dapp.approvals()[0]!.id, true, PASSWORD)).toEqual({});
    expect(((await signing) as string).slice(0, 2)).toBe("a1");
  });

  it("names the public account when a certificate or a withdrawal names its stake key, and never says it isn't in it (X05)", async () => {
    const t = await on();
    const { dapp } = privately(t);
    const s = await connectedPrivately(t, dapp);
    const { wasm } = t.deps;
    const reward = wasm.cip30Address(await t.wallet.withKeys((k) => k.cardano.stakeAddress(wasm.Network.Preprod)));
    // An old-style registration of the public account's stake key needs no signature of its: the session's alone
    // completes it, and ties the two on chain.
    const registering = await prompt(dapp, s, carrying([SESSION_INPUT], [wasm.cip30Address(THEIRS)], { certificates: [registers(reward.slice(2))] }));
    expect(registering.summary.complete).toBe(true);
    expect(registering.ties).toEqual([]);
    expect(registering.staked).toEqual([]);
    expect(registering.certified).toEqual([{ account: 0 }]);
    expect(registering.summary.certificates.map((c) => [c.kind, c.own, c.yours])).toEqual([["register", false, { account: 0 }]]);
    const page = shown(registering, true);
    expect(page).toContain("A certificate for the stake key of your public account.");
    expect(page).toContain(
      "A certificate, withdrawal or proposal in it names the stake key of your public account: signing ties this private session to your public account on chain, where anyone can see it.",
    );
    expect(page).not.toContain("isn't yours");
    expect(page).not.toContain("in it.");
    // A withdrawal from its reward address needs the public account's own signature, with partialSign.
    const withdrawing = await prompt(dapp, s, carrying([SESSION_INPUT], [wasm.cip30Address(THEIRS)], { withdrawals: [reward] }), true);
    expect(withdrawing.certified).toEqual([{ account: 0 }]);
    expect(withdrawing.summary.withdrawals.map((w) => [w.own, w.yours])).toEqual([[false, { account: 0 }]]);
    const withdrawn = shown(withdrawing, true);
    expect(withdrawn).toContain("from the reward account of your public account.");
    expect(withdrawn).not.toContain("isn't yours");
    expect(withdrawn).not.toContain("in it.");
  });

  it("names the public account when a stake pool's registration makes its reward address the pool's, with partialSign (the last review, L1)", async () => {
    const t = await on();
    const { dapp } = privately(t);
    const s = await connectedPrivately(t, dapp);
    const { wasm } = t.deps;
    const reward = wasm.cip30Address(await t.wallet.withKeys((k) => k.cardano.stakeAddress(wasm.Network.Preprod)));
    // The pool's operator signs it, never the public account's stake key: the session's signature puts the two
    // together on chain all the same.
    const approval = await prompt(dapp, s, carrying([SESSION_INPUT], [wasm.cip30Address(THEIRS)], { certificates: [registersPool(reward)] }), true);
    expect(approval.summary.complete).toBe(false);
    expect([approval.ties, approval.staked, approval.certified]).toEqual([[], [], [{ account: 0 }]]);
    expect(approval.summary.certificates.map((c) => [c.kind, c.own, c.credential, c.yours])).toEqual([["pool", false, reward.slice(2), { account: 0 }]]);
    const page = shown(approval, true, true);
    expect(page).toContain(
      "A certificate, withdrawal or proposal in it names the stake key of your public account: signing ties this private session to your public account on chain, where anyone can see it.",
    );
    expect(page).not.toContain("in it.");
    // Someone else's reward account is none of the wallet's: the other side is still said not to be in it.
    const theirs = await prompt(dapp, s, carrying([SESSION_INPUT], [wasm.cip30Address(THEIRS)], { certificates: [registersPool(`e0${"ab".repeat(28)}`)] }), true);
    expect(theirs.certified).toEqual([]);
    expect(shown(theirs, true, true)).toContain("Your public account and your private balance aren't in it.");
  });

  it("still says the other side isn't in it for a contract's withdraw-zero and a stake pool's certificate (X05)", async () => {
    const t = await on();
    const { dapp } = privately(t);
    const s = await connectedPrivately(t, dapp);
    const { wasm } = t.deps;
    // A script's reward address, as the "withdraw zero" many contracts use: no key's, so nobody's account.
    const tx = carrying([SESSION_INPUT], [wasm.cip30Address(THEIRS)], {
      certificates: [`8304581c${"ab".repeat(28)}190100`],
      withdrawals: [`f0${"cd".repeat(28)}`],
    });
    const approval = await prompt(dapp, s, tx, true);
    expect(approval.summary.withdrawals.map((w) => w.own)).toEqual([false]);
    expect(approval.certified).toEqual([]);
    expect(approval.summary.certificates[0]).not.toHaveProperty("yours");
    expect(approval.summary.withdrawals[0]).not.toHaveProperty("yours");
    expect(shown(approval, true, true)).toContain("Your public account and your private balance aren't in it.");
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
    expect(plain.staked).toEqual([]);
    // Someone's key under the session's stake key: theirs to spend, never "Your private session 1", but tied (C01).
    const reward = await t.wallet.withKeys((k) => k.oneTime.rewardAddress(wasm.Network.Preprod, 0));
    const theirs = `00${"ab".repeat(28)}${wasm.cip30Address(reward).slice(2)}`;
    const staked = await prompt(dapp, s, paying([`${own!.txHash}#${own!.index}`], [theirs]));
    expect(staked.ties).toEqual([]);
    expect(staked.staked).toEqual([0]);
    expect(staked.summary.paid.map((p) => p.yours)).toEqual([undefined]);
    expect(paidTo(staked.summary.paid[0]!)).toBe("An address");
  });

  /** A site on the public account, with private sessions 0 and 1 used on this device, and one of its UTxOs to spend. */
  async function withTwoSessions() {
    const t = await on();
    const { dapp } = privately(t);
    await t.store.set("sessions.preprod", { next: 2, sessions: [] });
    const s = site("https://public.example");
    const enabling = dapp.call(s, "enable", []);
    await until(() => dapp.approvals().length === 1);
    await dapp.answer(dapp.approvals()[0]!.id, true);
    await enabling;
    await t.balances.get("preprod");
    const [own] = (await t.coins.lists("preprod")).cardano;
    const { wasm } = t.deps;
    const sessions = await t.wallet.withKeys((k) =>
      [0, 1].map((i) => ({ key: k.oneTime.keyHash(i), stake: wasm.cip30Address(k.oneTime.rewardAddress(wasm.Network.Preprod, i)).slice(2) })),
    );
    return { t, dapp, s, spend: `${own!.txHash}#${own!.index}`, sessions };
  }

  it("names a private session whose stake key a certificate registers, and never says the private balance isn't in it (X05)", async () => {
    const { t, dapp, s, spend, sessions } = await withTwoSessions();
    // The public account pays the deposit for private session 1's stake key: its signature alone completes it, and ties the two.
    const approval = await prompt(dapp, s, carrying([spend], [t.deps.wasm.cip30Address(THEIRS)], { certificates: [registers(sessions[0]!.stake)] }));
    expect(approval.summary.complete).toBe(true);
    expect([approval.ties, approval.staked, approval.certified]).toEqual([[], [], [0]]);
    expect(approval.summary.certificates.map((c) => c.yours)).toEqual([0]);
    const page = shown(approval, false);
    expect(page).toContain("A certificate for the stake key of your private session 1.");
    expect(page).toContain(
      "A certificate, withdrawal or proposal in it names the stake key of your private session 1: signing ties your public account to your private session 1 on chain, where anyone can see it.",
    );
    expect(page).not.toContain("isn't yours");
    expect(page).not.toContain("isn't in it");
  });

  it("names a private session a proposal's deposit goes back to, and never says the private balance isn't in it (chunk 39)", async () => {
    const { t, dapp, s, spend } = await withTwoSessions();
    const { wasm } = t.deps;
    const reward = await t.wallet.withKeys((k) => wasm.cip30Address(k.oneTime.rewardAddress(wasm.Network.Preprod, 0)));
    // The public account pays the deposit, and the ledger sends it to private session 1's reward account when the
    // action ends: no signature of that key's, and the two are tied on chain.
    const approval = await prompt(dapp, s, carrying([spend], [wasm.cip30Address(THEIRS)], { proposals: [reward] }));
    expect(approval.summary.complete).toBe(true);
    expect([approval.ties, approval.staked, approval.certified]).toEqual([[], [], [0]]);
    expect(approval.summary.proposals.map((p) => [p.action, p.own, p.credential, p.yours])).toEqual([["information", false, reward.slice(2), 0]]);
    const page = shown(approval, false);
    expect(page).toContain("Its 1,000 ₳ deposit comes back to the stake key of your private session 1 when the action ends.");
    expect(page).toContain(
      "A certificate, withdrawal or proposal in it names the stake key of your private session 1: signing ties your public account to your private session 1 on chain, where anyone can see it.",
    );
    expect(page).not.toContain("isn't yours");
    expect(page).not.toContain("isn't in it");

    // Anyone else's: said with its whole address, and it ties nothing.
    const stranger = `e0${"44".repeat(28)}`;
    const theirs = await prompt(dapp, s, carrying([spend], [wasm.cip30Address(THEIRS)], { proposals: [stranger] }));
    expect([theirs.ties, theirs.staked, theirs.certified]).toEqual([[], [], []]);
    expect(theirs.summary.proposals.map((p) => p.yours)).toEqual([undefined]);
    expect(shown(theirs, false)).toContain(`Its 1,000 ₳ deposit goes to a stake key that isn't yours, ${theirs.summary.proposals[0]!.address}, when the action ends.`);
  });

  it("names a private session a stake pool's registration makes its reward account, and never says the private balance isn't in it (the last review, L1)", async () => {
    const { t, dapp, s, spend } = await withTwoSessions();
    const { wasm } = t.deps;
    const reward = await t.wallet.withKeys((k) => wasm.cip30Address(k.oneTime.rewardAddress(wasm.Network.Preprod, 0)));
    // The pool's operator signs it, never private session 1's stake key: with partialSign, the public account's
    // signature puts the two together on chain.
    const approval = await prompt(dapp, s, carrying([spend], [wasm.cip30Address(THEIRS)], { certificates: [registersPool(reward)] }), true);
    expect(approval.summary.complete).toBe(false);
    expect([approval.ties, approval.staked, approval.certified]).toEqual([[], [], [0]]);
    expect(approval.summary.certificates.map((c) => [c.kind, c.own, c.credential, c.yours])).toEqual([["pool", false, reward.slice(2), 0]]);
    const page = shown(approval, false, true);
    expect(page).toContain("Registers stake pool");
    expect(page).toContain(
      "A certificate, withdrawal or proposal in it names the stake key of your private session 1: signing ties your public account to your private session 1 on chain, where anyone can see it.",
    );
    expect(page).not.toContain("isn't in it");
  });

  it("ties both sessions of an address with one's payment key and the other's stake key, named by its payment key (X07)", async () => {
    const { dapp, s, spend, sessions } = await withTwoSessions();
    const [first, second] = sessions as [(typeof sessions)[0], (typeof sessions)[0]];
    // Session 2's key under session 1's stake key: session 2 spends it, and signing ties both.
    const crossed = await prompt(dapp, s, paying([spend], [`00${second.key}${first.stake}`]));
    expect(crossed.ties).toEqual([0, 1]);
    expect(crossed.staked).toEqual([]);
    expect(crossed.summary.paid.map((p) => p.yours)).toEqual([1]);
    expect(shown(crossed, false)).toContain("It moves money between your public account and your private session 1 and your private session 2.");
    // And the other way round.
    const reversed = await prompt(dapp, s, paying([spend], [`00${first.key}${second.stake}`]));
    expect(reversed.ties).toEqual([0, 1]);
    expect(reversed.summary.paid.map((p) => p.yours)).toEqual([0]);
    // A session's own address ties it alone.
    const own = await prompt(dapp, s, paying([spend], [`00${second.key}${second.stake}`]));
    expect(own.ties).toEqual([1]);
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
    proposals: [],
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
    const page = text({ summary: summary([{ ...out, yours: { account: 0 } }]), partial: false, session: true, collateralSpent: false, ties: [{ account: 0 }] });
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
    expect(tiesLine([{ account: 0 }, 1, 4], true)).toBe(
      "It moves money between this private session and your public account, your private session 2 and your private session 5. Signing ties them together on chain, where anyone can see it.",
    );
    expect(tiesLine([0], false)).toBe(
      "It moves money between your public account and your private session 1. Signing ties them together on chain, where anyone can see it.",
    );
    expect(paidTo({ ...out, yours: 2, datum: "inline" })).toBe("Your private session 3, with data");
    expect(signingTies([1], false)).toBe("Signing ties this transaction to your public account.");
    const page = text({ summary: summary([{ ...out, address: THEIRS }], true), partial: false, session: true, collateralSpent: false, ties: [] });
    expect(page).toContain("It pays a Seedelf. Nothing on chain says whose, but it comes from this private session's one-time account in the open.");
    // Whose Seedelf it is isn't known: the private balance isn't said to be out of it.
    expect(page).toContain("Signing ties this transaction to the session's one-time account. Your public account isn't in it.");
    expect(page).not.toContain("private balance aren't");
    expect(signingTies([], false, true)).toBe("Signing ties this transaction to your public account.");
  });

  it("name another public account by its number and name where the wallet has several", () => {
    const named = (index: number) => `Account ${index + 1}${index === 2 ? " · Savings" : ""}`;
    expect(paidTo({ ...out, yours: { account: 2 } }, named)).toBe("Your public account, Account 3 · Savings");
    expect(paidTo({ ...out, yours: { account: 0 } })).toBe("Your public account");
    expect(tiesLine([{ account: 2 }], false, named, "Account 1")).toBe(
      "It moves money between Account 1 and Account 3 · Savings. Signing ties them together on chain, where anyone can see it.",
    );
    expect(tiesLine([{ account: 0 }, 1], true, named)).toBe(
      "It moves money between this private session and Account 1 and your private session 2. Signing ties them together on chain, where anyone can see it.",
    );
  });

  it("say someone else's address under a stake key of theirs isn't theirs, and never that the other side isn't in it (C01)", () => {
    const named = (index: number) => `Account ${index + 1}${index === 2 ? " · Savings" : ""}`;
    expect(stakedLine([{ account: 2 }], false, named, "Account 1")).toBe(
      "Someone else's address in it carries the stake key of Account 3 · Savings: that money isn't yours. Signing still ties Account 1 to Account 3 · Savings on chain, where anyone can see it.",
    );
    expect(stakedLine([0], false)).toBe(
      "Someone else's address in it carries the stake key of your private session 1: that money isn't yours. Signing still ties your public account to your private session 1 on chain, where anyone can see it.",
    );
    // A session's prompt, the public account's stake key under someone's key: no output named, nothing said to move.
    const page = text({ summary: summary([{ ...out, address: THEIRS }]), partial: false, session: true, collateralSpent: false, ties: [], staked: [{ account: 0 }] });
    expect(page).toContain(
      "Someone else's address in it carries the stake key of your public account: that money isn't yours. Signing still ties this private session to your public account on chain, where anyone can see it.",
    );
    expect(page).toContain("An address");
    expect(page).not.toContain("Your public account");
    expect(page).not.toContain("It moves money");
    expect(page).not.toContain("in it.");
    // With an account it does pay: each said, in its own words.
    const both = text({ summary: summary([{ ...out, yours: { account: 0 } }]), partial: false, session: true, collateralSpent: false, ties: [{ account: 0 }], staked: [1] });
    expect(both).toContain("It moves money between this private session and your public account.");
    expect(both).toContain("carries the stake key of your private session 2: that money isn't yours. Signing still ties this private session to your private session 2 on chain");
  });

  it("name the wallet's own stake key in a certificate or a withdrawal, never one that isn't yours (X05)", () => {
    const named = (index: number) => `Account ${index + 1}${index === 2 ? " · Savings" : ""}`;
    const cert = { kind: "register", own: false, pool: null, poolAction: null, drep: null, deposit: null, refund: null };
    expect(certificateLine({ ...cert, yours: { account: 2 } }, true, "your public account", named)).toBe(
      "A certificate for the stake key of Account 3 · Savings.",
    );
    expect(certificateLine({ ...cert, yours: { account: 0 } }, true, "your private session")).toBe("A certificate for the stake key of your public account.");
    expect(certificateLine({ ...cert, yours: 1 }, true, "your public account")).toBe("A certificate for the stake key of your private session 2.");
    // Anyone else's, or one the worker couldn't check, as before.
    expect(certificateLine(cert, true, "your public account")).toBe("A certificate for a stake key that isn't yours.");
    const withdrawal = { address: "stake_test1…", lovelace: "5000000", own: false };
    expect(withdrawalLine({ ...withdrawal, yours: 1 }, true, "your public account")).toBe(
      "Withdraws 5\u00a0₳ from the reward account of your private session 2.",
    );
    expect(withdrawalLine({ ...withdrawal, yours: { account: 2 } }, true, "your public account", named)).toBe(
      "Withdraws 5\u00a0₳ from the reward account of Account 3 · Savings.",
    );
    expect(withdrawalLine(withdrawal, true, "your public account")).toBe("Withdraws 5\u00a0₳ from a reward account that isn't yours.");
    expect(certifiedLine([{ account: 2 }, 1], false, named, "Account 1")).toBe(
      "A certificate, withdrawal or proposal in it names the stake key of Account 3 · Savings and your private session 2: signing ties Account 1 to Account 3 · Savings and your private session 2 on chain, where anyone can see it.",
    );
    // In the window: the tie said, and the other side never said to be out of it.
    const page = text({
      summary: { ...summary([{ ...out, address: THEIRS }]), certificates: [{ ...cert, yours: { account: 0 } }] },
      partial: false,
      session: true,
      collateralSpent: false,
      ties: [],
      staked: [],
      certified: [{ account: 0 }],
    });
    expect(page).toContain("A certificate for the stake key of your public account.");
    expect(page).toContain("names the stake key of your public account: signing ties this private session to your public account on chain");
    expect(page).not.toContain("in it.");
  });
});
