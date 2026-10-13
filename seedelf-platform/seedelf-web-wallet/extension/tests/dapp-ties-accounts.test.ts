// A site's signing prompt matches what the transaction pays, or spends,
// against every public account the wallet knows, not only the one on screen
// (the release review), and names which. A private session's knew the active
// account alone: a session's transaction paying another, the dApp account
// included, read "Your public account and your private balance aren't in
// it.", and signing tied the session, and the private balance that funded
// it, to that account on chain. The public account's knew none: another of
// the wallet's public accounts read "An address" (C05's public half). With
// the accounts unread, the prompt promises nothing.
//
// An output is named by who can spend it, its payment key: someone else's key
// under another account's stake key read "Your public account, Account 3 ·
// Savings", and "It moves money between Account 1 and Account 3", while only
// that someone could spend it (1.5.0's release review, C01). Its stake key
// still ties the two on chain, and the prompt says so apart (`staked`). An
// account's own key past the first 20 the check derives is looked for
// further along its chains, by the stake key it carries, and named the
// account's: it read "Someone else's address … that money isn't yours" (X06).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { DappService, type DappSession } from "../src/background/dapp";
import type { KoiosUtxo } from "../src/background/koios";
import { Minswap } from "../src/background/minswap";
import { SessionService } from "../src/background/sessions";
import type { DappApproval } from "../src/shared/rpc";
import { AccountsContext } from "../src/ui/accounts";
import { paidTo } from "../src/ui/dapp";
import { SignTx } from "../src/ui/screens/DappApprovals";
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

/** As `paying`, with `certificates` (CBOR, hex) after its fee. */
function certifying(inputs: string[], to: string[], certificates: string[]) {
  const outputs = `8${to.length}${to.map((a) => `82${bytesOf(a)}1a003d0900`).join("")}`;
  return `84a400${outpoints(inputs)}01${outputs}021a00029810048${certificates.length}${certificates.join("")}a0f5f6`;
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

/**
 * Two of public account `index`'s own base addresses no balance reading has found, in CIP-30's hex: a key past the
 * first 20 the check derives on each chain (receive 25, change 40).
 */
async function farKeysOf(t: T, index: number) {
  const { wasm } = t.deps;
  return t.wallet.withAccount(index, ({ cardano }) => {
    const stake = wasm.cip30Address(cardano.stakeAddress(wasm.Network.Preprod)).slice(2);
    return [cardano.paymentKeyHash(0, 25), cardano.paymentKeyHash(1, 40)].map((key) => `00${key}${stake}`);
  });
}

describe("a private session's signing prompt, with several public accounts", () => {
  it("names a public account it pays whichever is on screen, the dApp account among them", async () => {
    const t = await on();
    const dapp = privately(t);
    const s = await connectedPrivately(t, dapp);
    // The picker on Account 2; the dApp account stays Account 1 (index 0).
    await t.accounts.use(1, ["preprod"]);
    const [first, third] = [await addressesOf(t, 0), await addressesOf(t, 2)];
    for (const [address, account] of [
      [first.receive, 0],
      [third.receive, 2],
    ] as const) {
      const approval = await prompt(dapp, s, paying([SESSION_INPUT], [address]));
      expect(approval.ties).toEqual([{ account }]);
      expect(approval.staked).toEqual([]);
      expect(approval.summary.paid.map((p) => p.yours)).toEqual([{ account }]);
    }
    // Someone else's key under an account's stake key: theirs to spend, never named the account's, and tied apart (C01).
    for (const [address, account] of [
      [first.stakedTo, 0],
      [third.stakedTo, 2],
    ] as const) {
      const approval = await prompt(dapp, s, paying([SESSION_INPUT], [address]));
      expect(approval.ties).toEqual([]);
      expect(approval.staked).toEqual([{ account }]);
      expect(approval.summary.paid.map((p) => p.yours)).toEqual([undefined]);
    }
    // Someone else's: checked, and none of the wallet's is in it.
    const plain = await prompt(dapp, s, paying([SESSION_INPUT], [t.deps.wasm.cip30Address(THEIRS)]));
    expect(plain.ties).toEqual([]);
    expect(plain.staked).toEqual([]);
  });

  it("names another account's own key past the first 20 as that account's, never someone else's (X06)", async () => {
    const t = await on();
    const dapp = privately(t);
    const s = await connectedPrivately(t, dapp);
    const far = await farKeysOf(t, 2);
    const approval = await prompt(dapp, s, paying([SESSION_INPUT], far));
    expect(approval.ties).toEqual([{ account: 2 }]);
    expect(approval.staked).toEqual([]);
    expect(approval.summary.paid.map((p) => p.yours)).toEqual([{ account: 2 }, { account: 2 }]);
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

describe("the public account's signing prompt, with several public accounts (C05's public half)", () => {
  /** A site connected to the dApp account (account 1, index 0), and one of its UTxOs to spend. */
  async function connectedPublicly(t: T, dapp: DappService) {
    const s = site("https://public.example");
    const enabling = dapp.call(s, "enable", []);
    await until(() => dapp.approvals().length === 1);
    await dapp.answer(dapp.approvals()[0]!.id, true);
    expect(await enabling).toBe(true);
    await t.balances.get("preprod");
    const [own] = (await t.coins.lists("preprod")).cardano;
    return { s, spend: `${own!.txHash}#${own!.index}` };
  }

  it("names another public account it pays, by any address of its keys, and never the site's own", async () => {
    const t = await on();
    const dapp = privately(t);
    const { s, spend } = await connectedPublicly(t, dapp);
    const [first, second, third] = [await addressesOf(t, 0), await addressesOf(t, 1), await addressesOf(t, 2)];
    for (const [address, account] of [
      [second.receive, 1],
      [third.receive, 2],
    ] as const) {
      const approval = await prompt(dapp, s, paying([spend], [address]));
      expect(approval.ties).toEqual([{ account }]);
      expect(approval.staked).toEqual([]);
      expect(approval.summary.paid.map((p) => p.yours)).toEqual([{ account }]);
    }
    // Two at once, in order, each output named.
    const both = await prompt(dapp, s, paying([spend], [third.receive, second.receive]));
    expect(both.ties).toEqual([{ account: 1 }, { account: 2 }]);
    expect(both.summary.paid.map((p) => p.yours)).toEqual([{ account: 2 }, { account: 1 }]);
    // Someone's key staked to the site's own account: not another account (it has a warning of its own).
    const own = await prompt(dapp, s, paying([spend], [first.stakedTo, t.deps.wasm.cip30Address(THEIRS)]));
    expect(own.ties).toEqual([]);
    expect(own.staked).toEqual([]);
    expect(own.summary.paid.map((p) => p.yours)).toEqual([undefined, undefined]);
  });

  it("never names another account by its stake key alone: its payment key's holder spends it (C01)", async () => {
    const t = await on();
    const dapp = privately(t);
    const { s, spend } = await connectedPublicly(t, dapp);
    const [first, second, third] = [await addressesOf(t, 0), await addressesOf(t, 1), await addressesOf(t, 2)];
    const named = (index: number) => `Account ${index + 1}${index === 2 ? " · Savings" : ""}`;
    const stake3 = third.stakedTo.slice(58);
    // Someone's key, and a contract, under Account 3's stake key: what WebAssembly read them as, and tied apart.
    const approval = await prompt(dapp, s, paying([spend], [third.stakedTo, `10${"cd".repeat(28)}${stake3}`]));
    expect(approval.summary.paid.map((p) => p.yours)).toEqual([undefined, undefined]);
    expect(approval.summary.paid.map((p) => paidTo(p, named))).toEqual(["An address", "A contract"]);
    expect(approval.ties).toEqual([]);
    expect(approval.staked).toEqual([{ account: 2 }]);
    // Account 2's key under Account 3's stake key is Account 2's to spend: named by it, the two tied as before (M12).
    const crossed = await prompt(dapp, s, paying([spend], [`00${second.receive.slice(2, 58)}${stake3}`]));
    expect(crossed.summary.paid.map((p) => p.yours)).toEqual([{ account: 1 }]);
    expect(crossed.ties).toEqual([{ account: 1 }, { account: 2 }]);
    expect(crossed.staked).toEqual([]);
    // The site's own key under Account 3's stake key is the account's to spend: WebAssembly's own line, not Account 3.
    const ownKey = await prompt(dapp, s, paying([spend], [`00${first.receive.slice(2, 58)}${stake3}`]));
    expect(ownKey.summary.paid.map((p) => [p.ownPaymentKey, p.yours])).toEqual([[true, undefined]]);
    expect(paidTo(ownKey.summary.paid[0]!, named)).toBe("Your payment key, with a stake part that isn't yours");
    expect(ownKey.ties).toEqual([{ account: 2 }]);
    expect(ownKey.staked).toEqual([]);
  });

  it("names another account's own key past the first 20 as that account's, never someone else's (X06)", async () => {
    const t = await on();
    const dapp = privately(t);
    const { s, spend } = await connectedPublicly(t, dapp);
    const named = (index: number) => `Account ${index + 1}${index === 2 ? " · Savings" : ""}`;
    // Looked for further along both of Account 3's chains, by the stake key each carries: the user's own money.
    const approval = await prompt(dapp, s, paying([spend], await farKeysOf(t, 2)));
    expect(approval.ties).toEqual([{ account: 2 }]);
    expect(approval.staked).toEqual([]);
    expect(approval.summary.paid.map((p) => p.yours)).toEqual([{ account: 2 }, { account: 2 }]);
    expect(paidTo(approval.summary.paid[0]!, named)).toBe("Your public account, Account 3 · Savings");
  });

  it("names another public account whose stake key a certificate registers (X05)", async () => {
    const t = await on();
    const dapp = privately(t);
    const { s, spend } = await connectedPublicly(t, dapp);
    const stake3 = (await addressesOf(t, 2)).stakedTo.slice(58);
    // An old-style registration (kind 0) of Account 3's stake key, which needs no signature of Account 3's.
    const approval = await prompt(dapp, s, certifying([spend], [t.deps.wasm.cip30Address(THEIRS)], [`82008200581c${stake3}`]));
    expect(approval.summary.complete).toBe(true);
    expect([approval.ties, approval.staked, approval.certified]).toEqual([[], [], [{ account: 2 }]]);
    expect(approval.summary.certificates.map((c) => c.yours)).toEqual([{ account: 2 }]);
    // The window as it shows it, the accounts named as Settings names them.
    const accounts = [{ index: 0, name: "Main" }, { index: 1 }, { index: 2, name: "Savings" }];
    const value = { accounts, active: 0, loaded: true, name: "Account 1 · Main", several: true, reload: async () => undefined };
    const { summary, ties, staked, certified } = approval;
    const props = { summary, partial: false, session: false, collateralSpent: false, ties, staked, certified, account: "Account 1 · Main" };
    const page = renderToStaticMarkup(createElement(AccountsContext.Provider, { value }, createElement(SignTx, props)))
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, " ");
    expect(page).toContain("A certificate for the stake key of Account 3 · Savings.");
    expect(page).toContain(
      "A certificate or withdrawal in it names the stake key of Account 3 · Savings: signing ties Account 1 · Main to Account 3 · Savings on chain, where anyone can see it.",
    );
    expect(page).not.toContain("isn't yours");
  });

  it("takes WebAssembly's word that the site's own key is its own, past the keys derived for the check (C01)", async () => {
    const t = await on();
    const dapp = privately(t);
    const { s, spend } = await connectedPublicly(t, dapp);
    const [first, third] = [await addressesOf(t, 0), await addressesOf(t, 2)];
    // As for a key of the dApp account past the first 20 of a chain, which only its own reading finds: none of the
    // payment keys derived, the stake keys all there.
    const derived = dapp as unknown as { publicKeys: (n: string) => Promise<{ payment: Map<string, number>; stake: Map<string, number> }> };
    const { stake } = await derived.publicKeys("preprod");
    derived.publicKeys = async () => ({ payment: new Map(), stake });
    const approval = await prompt(dapp, s, paying([spend], [`00${first.receive.slice(2, 58)}${third.stakedTo.slice(58)}`]));
    expect(approval.summary.paid.map((p) => p.ownPaymentKey)).toEqual([true]);
    // The user's own money, under Account 3's stake key: never said to be someone else's.
    expect(approval.ties).toEqual([{ account: 2 }]);
    expect(approval.staked).toEqual([]);
  });

  it("names nothing Account 3's for a site that read Account 3's stake key before Settings moved sites off it (C01)", async () => {
    const t = await on();
    const dapp = privately(t);
    // Settings → Sites on Account 3 (index 2) as the site connects: it reads Account 3's reward address.
    await t.preferences.set({ dappAccount: 2 });
    const s = site("https://public.example");
    const enabling = dapp.call(s, "enable", []);
    await until(() => dapp.approvals().length === 1);
    await dapp.answer(dapp.approvals()[0]!.id, true);
    expect(await enabling).toBe(true);
    const [reward] = (await dapp.call(s, "getRewardAddresses", [])) as string[];
    // Sites moved to Account 1, the site still connected: it asks Account 1 to pay its own key and a contract, each
    // under Account 3's stake key, 4 ₳ apiece.
    await t.preferences.set({ dappAccount: 0 });
    await dapp.dappAccountChanged();
    await t.balances.get("preprod");
    const [own] = (await t.coins.lists("preprod")).cardano;
    const stake3 = reward!.slice(2);
    const to = [`00${"ab".repeat(28)}${stake3}`, `10${"cd".repeat(28)}${stake3}`];
    const approval = await prompt(dapp, s, paying([`${own!.txHash}#${own!.index}`], to));
    expect(approval.ties).toEqual([]);
    expect(approval.staked).toEqual([{ account: 2 }]);
    // The window as it shows it, the accounts named as Settings names them.
    const accounts = [{ index: 0, name: "Main" }, { index: 1 }, { index: 2, name: "Savings" }];
    const value = { accounts, active: 0, loaded: true, name: "Account 1 · Main", several: true, reload: async () => undefined };
    const { summary, ties, staked } = approval;
    const props = { summary, partial: false, session: false, collateralSpent: false, ties, staked, account: "Account 1 · Main" };
    const page = renderToStaticMarkup(createElement(AccountsContext.Provider, { value }, createElement(SignTx, props)))
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, " ");
    expect(page).not.toContain("Your public account");
    expect(page).not.toContain("It moves money");
    expect(page).toContain("An address");
    expect(page).toContain("A contract");
    expect(page).toContain(
      "Someone else's address in it carries the stake key of Account 3 · Savings: that money isn't yours. Signing still ties Account 1 · Main to Account 3 · Savings on chain, where anyone can see it.",
    );
  });

  it("names the account on screen when sites use another", async () => {
    const t = await on();
    const dapp = privately(t);
    const { s, spend } = await connectedPublicly(t, dapp);
    await t.accounts.use(2, ["preprod"]);
    const approval = await prompt(dapp, s, paying([spend], [(await addressesOf(t, 2)).receive]));
    expect(approval.ties).toEqual([{ account: 2 }]);
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
