// Once a private spend lands, only the private side of the balances is read
// again (privacy review §2.9): Koios asked about the public account in the
// same second as a private transaction lands could tie the two by timing,
// on a shared IP too. What pays the public account, or is the account's
// own, still reads both, and so does Refresh. The public account is the one
// on screen as it lands: a Make public to another of the user's accounts
// reads only the private side, as any private spend does (chunk 51, e5#2).
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { submitWatched, watchSent } from "../src/background/pending";
import { SESSION_TRANSFER } from "../src/background/transfer";
import { SESSION_BALANCES_PREFIX, SESSION_PRIVATE_STALE_PREFIX } from "../src/background/wallet";
import { WithdrawService } from "../src/background/withdraw";
import type { PendingTx, WithdrawSummary } from "../src/shared/rpc";
import { txIdOf } from "./fixtures/cbor";
import { koiosPreprod, loadTestWasm, testBalances, transferPreprod, vectors } from "./fakes";

const PASSWORD = "correct horse battery";

async function unlocked() {
  const v = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
  const t = testBalances();
  await t.wallet.create(v.phrase, PASSWORD);
  t.koios.evaluation = transferPreprod.evaluation;
  // A reading is kept, as Home's first one keeps it.
  await t.balances.get("preprod");
  return t;
}
type T = Awaited<ReturnType<typeof unlocked>>;

/** What Koios was asked since `from`: about the public account, and about the contract. */
function askedSince(t: T, from: number) {
  const calls = t.koios.calls.slice(from);
  const contract = (c: (typeof calls)[number]) =>
    c.path === "credential_utxos" && (c.body._payment_credentials as string[]).includes(koiosPreprod.wallet_contract);
  return {
    account: calls.filter((c) => ["account_addresses", "account_info", "credential_utxos"].includes(c.path) && !contract(c)).map((c) => c.path),
    contract: calls.filter(contract).length,
  };
}

/** A built transfer's bytes, sent as `kind` with `summary`: the watch knows a private spend by these alone. */
async function sent(t: T, kind: PendingTx["kind"], summary: object) {
  const built = await t.transfer.build("preprod", [{ to: transferPreprod.to, lovelace: "2000000", tokens: [] }]);
  const kept = (await t.session.get<{ txCbor: string }>(SESSION_TRANSFER))!;
  return submitWatched(t.deps, {
    network: "preprod",
    txHash: built.txHash,
    kind,
    txCbor: kept.txCbor,
    key: SESSION_TRANSFER,
    kept,
    summary,
    contract: true,
    again: false,
  });
}

/** The watch sees it land, as Home's 15 s ask does. */
async function lands(t: T) {
  t.koios.confirmations = 1;
  expect(await t.pending.pending("preprod")).toMatchObject({ confirmations: 1 });
}

describe("once a private spend lands", () => {
  it("only the private side is read again, and the public account isn't asked about", async () => {
    const t = await unlocked();
    const before = (await t.balances.get("preprod")).cardano;
    await sent(t, "transfer", { payments: [{ to: transferPreprod.to, lovelace: "2000000" }] });
    await lands(t);
    // The account's side is kept; only the private side is marked behind.
    expect(await t.session.get(SESSION_BALANCES_PREFIX + "preprod")).toBeDefined();
    expect(await t.session.get(SESSION_PRIVATE_STALE_PREFIX + "preprod")).toBe(true);

    const from = t.koios.calls.length;
    const after = await t.balances.get("preprod");
    // The contract, from the last block seen (read again while it still lists what was spent, as any reading does).
    const asked = askedSince(t, from);
    expect(asked.account).toEqual([]);
    expect(asked.contract).toBeGreaterThan(0);
    expect(after.cardano).toEqual(before);
    expect(await t.session.get(SESSION_PRIVATE_STALE_PREFIX + "preprod")).toBeUndefined();

    // Read once: the next request is answered from what's kept.
    const next = t.koios.calls.length;
    await t.balances.get("preprod");
    expect(t.koios.calls.length).toBe(next);
  });

  it("a box back from Lovejoin is private too", async () => {
    const t = await unlocked();
    await watchSent(t.deps, { kind: "lovejoin-withdraw", network: "preprod", txHash: "ab".repeat(32), submittedAt: t.clock.now, confirmations: null });
    await lands(t);
    const from = t.koios.calls.length;
    await t.balances.get("preprod");
    expect(askedSince(t, from).account).toEqual([]);
  });

  it("a pool started from the private balance is private too (34d's review 2)", async () => {
    const t = await unlocked();
    await sent(t, "lovejoin-launch", { from: "private", lovelace: "21000000", fee: "500000" });
    await lands(t);
    expect(await t.session.get(SESSION_BALANCES_PREFIX + "preprod")).toBeDefined();
    expect(await t.session.get(SESSION_PRIVATE_STALE_PREFIX + "preprod")).toBe(true);
    const from = t.koios.calls.length;
    await t.balances.get("preprod");
    expect(askedSince(t, from).account).toEqual([]);
  });

  it("Refresh still reads both", async () => {
    const t = await unlocked();
    await sent(t, "transfer", { payments: [] });
    await lands(t);
    const from = t.koios.calls.length;
    await t.balances.get("preprod", true);
    expect(askedSince(t, from).account).toContain("account_addresses");
    expect(await t.session.get(SESSION_PRIVATE_STALE_PREFIX + "preprod")).toBeUndefined();
  });
});

describe("what touches the public account reads it again", () => {
  const readsAll = async (t: T) => {
    expect(await t.session.get(SESSION_BALANCES_PREFIX + "preprod")).toBeUndefined();
    const from = t.koios.calls.length;
    await t.balances.get("preprod");
    expect(askedSince(t, from).account).toContain("account_addresses");
  };

  it("a Make public to the wallet's own account", async () => {
    const t = await unlocked();
    await sent(t, "withdraw", { payments: [{ address: "addr_test1", own: true, lovelace: "2000000" }] });
    await lands(t);
    await readsAll(t);
  });

  it("a Seedelf removed to the account", async () => {
    const t = await unlocked();
    await sent(t, "remove", { to: "account" });
    await lands(t);
    await readsAll(t);
  });

  it("one the public account signed, which carries a slot", async () => {
    const t = await unlocked();
    await watchSent(t.deps, {
      kind: "send",
      network: "preprod",
      txHash: "cd".repeat(32),
      submittedAt: t.clock.now,
      confirmations: null,
      invalidHereafter: 1,
    });
    await lands(t);
    await readsAll(t);
  });

  it("a pool the public account started, which carries a slot", async () => {
    const t = await unlocked();
    await watchSent(t.deps, {
      kind: "lovejoin-launch",
      network: "preprod",
      txHash: "ce".repeat(32),
      submittedAt: t.clock.now,
      confirmations: null,
      invalidHereafter: 1,
    });
    await lands(t);
    await readsAll(t);
  });

  it("a box back from Lovejoin the public account paid for (34d's review 9)", async () => {
    const t = await unlocked();
    const box = { kind: "lovejoin-withdraw", network: "preprod", txHash: "cf".repeat(32), submittedAt: t.clock.now, confirmations: null } as const;
    await watchSent(t.deps, box, { toAccount: true });
    await lands(t);
    await readsAll(t);
  });

  it("a Make public to someone else's address stays private", async () => {
    const t = await unlocked();
    await sent(t, "withdraw", { payments: [{ address: "addr_test1", own: false, lovelace: "2000000" }] });
    await lands(t);
    expect(await t.session.get(SESSION_PRIVATE_STALE_PREFIX + "preprod")).toBe(true);
  });
});

// Chunk 51, e5#2: a Make public to another of the user's own public accounts, made while the wallet is on account 0
// (the Your accounts picker, or account 1's address pasted). It's a private spend: the one-time key signs, giveme.my
// lends the collateral, and it touches nothing of account 0. `own` is true for every account the wallet knows since
// the picker offers them all, and the watch read it as the account on screen: the landing dropped the whole reading,
// and Home's reload asked Koios about account 0 in the second the transaction paying account 1 landed. The watch now
// keeps which accounts a spend pays, and compares them with the one the wallet is on as it lands. The real WebAssembly
// on the 12-word phrase's synthetic Seedelf UTxOs, and fakes of Koios and giveme.my.
describe("a Make public to another of the user's own accounts, once it lands (chunk 51, e5#2)", () => {
  /** Each Make public is built and measured in WebAssembly. */
  const SLOW = { timeout: 120_000 };
  const PHRASE = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase as string;

  /** A wallet on account 0 that knows account 1 too (Add account, which asks nobody anything), Home's first reading kept. */
  async function twoAccounts() {
    const t = testBalances();
    await t.wallet.create(PHRASE, PASSWORD);
    await t.accounts.add(1);
    await t.balances.get("preprod");
    return t;
  }
  type W = Awaited<ReturnType<typeof twoAccounts>>;

  const preprod = (t: W) => t.deps.wasm.Network.Preprod;
  const receive0 = (t: W, index: number) => t.wallet.withAccount(index, ({ cardano }) => cardano.receiveAddress(preprod(t), 0));
  const stakeOf = (t: W, index: number) => t.wallet.withAccount(index, ({ cardano }) => cardano.stakeAddress(preprod(t)));

  /** Makes 5 ₳ public to `to` through the worker's own build and Send; giveme.my's witness and the signing stood in for. */
  async function makePublic(t: W, to: string): Promise<WithdrawSummary> {
    const summary = await t.withdraw.build("preprod", [{ to, lovelace: "5000000", tokens: [] }]);
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    const wasm = loadTestWasm();
    const service = new WithdrawService({
      ...t.deps,
      wasm: {
        ...wasm,
        signScriptSpend: (_key: unknown, request: string) =>
          JSON.stringify({ txCbor: (JSON.parse(request) as { txCbor: string }).txCbor, txHash: summary.txHash }),
      } as typeof wasm,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    });
    expect(await service.submit("preprod", summary.txHash)).toMatchObject({ kind: "withdraw", txHash: summary.txHash, confirmations: null });
    expect(t.koios.submitted.map((b) => txIdOf(b))).toEqual([summary.txHash]);
    return summary;
  }

  /**
   * The watch sees it land, as Home's 15 s ask does, and Home reads the balances at once (Home.tsx `watch`:
   * `if (p.confirmations !== null || p.dropped) void load(false)`). What the landing left of the reading, and what that
   * read asked Koios about the public accounts.
   */
  async function landsAndHomeReads(t: W) {
    t.koios.confirmations = 1;
    expect(await t.pending.pending("preprod")).toMatchObject({ confirmations: 1 });
    const accountSideKept = (await t.session.get(SESSION_BALANCES_PREFIX + "preprod")) !== undefined;
    const privateSideBehind = (await t.session.get(SESSION_PRIVATE_STALE_PREFIX + "preprod")) === true;
    const from = t.koios.calls.length;
    await t.balances.get("preprod");
    const calls = t.koios.calls.slice(from);
    const names = new Map([
      [await stakeOf(t, 0), "account 0"],
      [await stakeOf(t, 1), "account 1"],
    ]);
    const accountAsked = calls
      .filter(
        (c) =>
          ["account_addresses", "account_info"].includes(c.path) ||
          (c.path === "credential_utxos" && !(c.body._payment_credentials as string[]).includes(koiosPreprod.wallet_contract)),
      )
      .map((c) => c.path);
    const stakesAsked = [...new Set(calls.flatMap((c) => (c.body?._stake_addresses as string[] | undefined) ?? []))].map(
      (s) => names.get(s) ?? s,
    );
    return { accountSideKept, privateSideBehind, accountAsked, stakesAsked };
  }

  it("reads only the private side again: Koios hears nothing of the account on screen", SLOW, async () => {
    const t = await twoAccounts();
    const other = await receive0(t, 1);
    const summary = await makePublic(t, other);
    // It pays account 1, while the wallet is on account 0.
    expect(summary.payments[0]).toMatchObject({ address: other, own: true, ownAccount: 1 });
    expect(await t.wallet.withKeys(({ account }) => account)).toBe(0);

    expect(await landsAndHomeReads(t)).toEqual({ accountSideKept: true, privateSideBehind: true, accountAsked: [], stakesAsked: [] });
  });

  it("control: a Make public to the account on screen reads it again, as privacy.md says", SLOW, async () => {
    const t = await twoAccounts();
    const own = await receive0(t, 0);
    const summary = await makePublic(t, own);
    expect(summary.payments[0]).toMatchObject({ address: own, own: true, ownAccount: 0 });

    const after = await landsAndHomeReads(t);
    expect(after.accountSideKept).toBe(false);
    expect(after.accountAsked).toContain("account_addresses");
    expect(after.stakesAsked).toContain("account 0");
  });

  // The account on screen is the one the wallet is on as it lands, whichever it was built on: the user may switch
  // between Send and the landing, which nothing refuses for a payment Koios took.
  it("one built on account 0 that pays it, landing once the wallet is on account 1, leaves account 1 unread", async () => {
    const t = await unlocked();
    await t.accounts.add(1);
    await sent(t, "withdraw", { payments: [{ address: "addr_test1", own: true, ownAccount: 0, lovelace: "2000000" }] });
    await t.accounts.use(1, ["preprod"]);
    await t.balances.get("preprod");
    await lands(t);
    expect(await t.session.get(SESSION_BALANCES_PREFIX + "preprod")).toBeDefined();
    expect(await t.session.get(SESSION_PRIVATE_STALE_PREFIX + "preprod")).toBe(true);
    const from = t.koios.calls.length;
    await t.balances.get("preprod");
    expect(askedSince(t, from).account).toEqual([]);
  });

  it("one built on account 0 that pays account 1, landing once the wallet is on account 1, reads it again", async () => {
    const t = await unlocked();
    await t.accounts.add(1);
    await sent(t, "withdraw", { payments: [{ address: "addr_test1", own: true, ownAccount: 1, lovelace: "2000000" }] });
    await t.accounts.use(1, ["preprod"]);
    await t.balances.get("preprod");
    await lands(t);
    expect(await t.session.get(SESSION_BALANCES_PREFIX + "preprod")).toBeUndefined();
    const from = t.koios.calls.length;
    await t.balances.get("preprod");
    expect(askedSince(t, from).account).toContain("account_addresses");
  });
});
