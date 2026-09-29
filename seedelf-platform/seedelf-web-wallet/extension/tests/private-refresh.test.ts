// Once a private spend lands, only the private side of the balances is read
// again (privacy review §2.9): Koios asked about the public account in the
// same second as a private transaction lands could tie the two by timing,
// on a shared IP too. What pays the public account, or is the account's
// own, still reads both, and so does Refresh.
import { describe, expect, it } from "vitest";

import { submitWatched, watchSent } from "../src/background/pending";
import { SESSION_TRANSFER } from "../src/background/transfer";
import { SESSION_BALANCES_PREFIX, SESSION_PRIVATE_STALE_PREFIX } from "../src/background/wallet";
import type { PendingTx } from "../src/shared/rpc";
import { koiosPreprod, testBalances, transferPreprod, vectors } from "./fakes";

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

  it("a Make public to someone else's address stays private", async () => {
    const t = await unlocked();
    await sent(t, "withdraw", { payments: [{ address: "addr_test1", own: false, lovelace: "2000000" }] });
    await lands(t);
    expect(await t.session.get(SESSION_PRIVATE_STALE_PREFIX + "preprod")).toBe(true);
  });
});
