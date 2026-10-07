// Lovejoin's boxes from a mix a public account paid, with several public
// accounts (release review C01). A mix from the public side records which
// account paid it, and so do the leaves it leaves and, after a restore, what
// Koios says made a box. Mix again from my public account then takes only the
// active account's boxes: another account paying for their mixes would tie
// the two accounts together, so with only those left it says which account to
// switch to. The private balance still leaves every account's boxes out
// (privacy review §2.10). A record 1.1.0 kept names no account: it had one,
// account 0.
import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import type { KoiosUtxo } from "../src/background/koios";
import { CHAIN_CUT, SESSION_LOVEJOIN_PUBLIC } from "../src/background/lovejoin";
import { HOUR, PASSWORD, POOL, publicFunded, type Tested } from "./chain-fixtures";
import { koiosPreprod, loadTestWasm } from "./fakes";

/** Real chains, built and measured in WebAssembly, two in a test. */
const CHAINS = { timeout: 180_000 };

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const ref = (b: { txHash: string; txIndex: number }) => `${b.txHash}#${b.txIndex}`;

/** One of the wallet's boxes at `tx#txIndex` in the pool: the Seedelf key is account 0's, whichever account is active. */
async function ownedBox(t: Tested, tx: string, txIndex: number): Promise<KoiosUtxo> {
  const wasm = loadTestWasm();
  const datum = await t.wallet.withKeys((keys) => wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister())));
  return { ...POOL[0]!, tx_hash: tx, tx_index: txIndex, inline_datum: { bytes: Buffer.from(datum).toString("hex"), value: {} } };
}

/** Public account `index`'s first payment key and receive address. */
const accountOf = (t: Tested, index: number) =>
  t.wallet.withAccount(index, (k) => ({ key: k.cardano.paymentKeyHash(0, 0), address: k.cardano.receiveAddress(t.deps.wasm.Network.Preprod, 0) }));

/** Account `index` known, with a 5 ₳ collateral and 60 ₳ of its own, at `f5…`/`f6…` for account 1. */
async function fundAccount(t: Tested, index: number, tag: string): Promise<void> {
  await t.accounts.add(index);
  const { key, address } = await accountOf(t, index);
  const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
  const at = (tx: string, value: string) => ({ ...first!, tx_hash: tx.repeat(32), tx_index: 0, value, address, payment_cred: key, asset_list: [] });
  t.koios.addedToAccounts.push(at(`${tag}5`, "5000000"), at(`${tag}6`, "60000000"));
}

/** The chain kept for Send, and what each of its transactions spends. */
async function keptInputs(t: Tested): Promise<string[][]> {
  const kept = await t.wallet.withKeys(() => t.session.get<{ chain: Array<{ txCbor: string }> }>(SESSION_LOVEJOIN_PUBLIC));
  return kept!.chain.map((c) => txInputs(bytes(c.txCbor)));
}

/** A mix from the public side a lock cut after its deposit: both its boxes are still the deposit's. 1.1.0's names no account. */
function cutChain(tag: string, at: number, account?: number) {
  const [D, A, B] = ["d", "a", "b"].map((h) => `${h}${tag}`.repeat(32));
  return {
    D: D!,
    record: {
      id: B!,
      ...(account !== undefined ? { account } : {}),
      progress: "seedelf.lovejoin.sending.preprod",
      deposit: D!,
      mixes: [A!, B!],
      leaves: [
        { txHash: A!, txIndex: 0 },
        { txHash: B!, txIndex: 0 },
      ],
      boxes: 2,
      total: 3,
      sent: 1,
      at,
      scheduled: true,
      stopped: CHAIN_CUT(),
      cut: true,
      ended: at,
    },
  };
}

describe("a mix from one public account, and Mix again from my public account on another (release review C01)", CHAINS, () => {
  it("records the account that paid, and never has another account pay to mix its boxes again: it says which to switch to", async () => {
    // Two UTxOs of 60 ₳: the deposit takes one, and mixing again from account 0 later pays from the other.
    const t = await publicFunded("60000000", ["60000000"]);
    await t.accounts.recordFirst();
    await t.deps.preferences.set({ lovejoinDepth: 1 });

    // Account 0 mixes 4 boxes from the public account, and a lock cuts it before its last mix.
    const summary = await t.lovejoin.publicBuild("preprod", 4);
    const [deposit] = await keptInputs(t);
    await t.lovejoin.publicSubmit("preprod", summary.txHash);
    const [record] = (await t.store.get<{ chains: Array<{ account?: number; deposit: string; mixes: string[]; leaves: Array<{ txHash: string; txIndex: number }> }> }>("lovejoin.preprod"))!.chains;
    expect(record!.account).toBe(0);
    await t.wallet.lock();
    t.clock.now += 7 * HOUR;
    await t.wallet.unlock(PASSWORD);
    expect(await t.lovejoin.progress("preprod")).toMatchObject({ stopped: CHAIN_CUT() });

    // On chain: the deposit's last box not mixed, the three others mixed by account 0's mixes.
    const leaves = record!.leaves.filter((l) => record!.mixes.slice(0, 3).includes(l.txHash));
    t.koios.addedToAccounts.push(await ownedBox(t, record!.deposit, 3), ...(await Promise.all(leaves.map((l) => ownedBox(t, l.txHash, l.txIndex)))));
    for (const o of deposit!) t.koios.spent.add(o);
    const theirs = [`${record!.deposit}#3`, ...leaves.map(ref)];

    // Nothing is on its way, so the switch is allowed (handlers.ts account-use); account 1 has money of its own.
    expect(await t.lovejoin.chainsSending("preprod")).toBe(false);
    expect(await t.lovejoin.publicMaybe("preprod")).toBe(false);
    await fundAccount(t, 1, "f");
    await t.accounts.use(1, ["preprod"]);

    // The page: the boxes are a public account's, account 0's, and the deposit's isn't mixed yet.
    const status = await t.lovejoin.status("preprod");
    expect(status.fromPublic.map(ref).sort()).toEqual([...theirs].sort());
    expect(status.otherAccounts?.map((b) => `${ref(b)}@${b.account}`).sort()).toEqual(theirs.map((r) => `${r}@0`).sort());
    expect(status.notMixed.map(ref)).toEqual([`${record!.deposit}#3`]);

    // Account 1 doesn't pay to mix account 0's boxes: it says which account put them in, and nothing is kept for Send.
    await expect(t.lovejoin.publicAgainBuild("preprod")).rejects.toThrow(
      "These boxes came from a mix from Account 1. Switch to it on the Public tab to mix them again: paying from this account would tie the two accounts together.",
    );
    expect(await t.wallet.withKeys(() => t.session.get(SESSION_LOVEJOIN_PUBLIC))).toBeUndefined();
    // Nor does the private balance, unless asked (privacy review §2.10).
    await expect(t.lovejoin.againBoxes("preprod")).rejects.toThrow("mixing them from your private balance would tie the two");

    // Back on account 0, its own boxes are its to mix again, paid by it: none of account 1's money goes in.
    await t.accounts.use(0, ["preprod"]);
    expect((await t.lovejoin.status("preprod")).otherAccounts).toBeUndefined();
    const again = await t.lovejoin.publicAgainBuild("preprod");
    expect(again).toMatchObject({ again: true, boxes: 4 });
    const spent = (await keptInputs(t)).flat();
    expect(spent.filter((o) => o.startsWith("f5") || o.startsWith("f6"))).toEqual([]);
    expect(spent.filter((o) => theirs.includes(o)).sort()).toEqual([...theirs].sort());
  });

  it("takes only the active account's boxes when both have some, and reads a record 1.1.0 kept as account 0's", async () => {
    const t = await publicFunded();
    await t.accounts.recordFirst();
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    await fundAccount(t, 1, "f");
    // Account 0's mix, recorded by 1.1.0 (no account), and account 1's, each cut after its deposit.
    const zero = cutChain("0", t.clock.now - 2 * HOUR);
    const one = cutChain("1", t.clock.now - HOUR, 1);
    await t.store.set("lovejoin.preprod", { due: [], chains: [zero.record, one.record] });
    t.koios.addedToAccounts.push(
      ...(await Promise.all([zero.D, one.D].flatMap((D) => [ownedBox(t, D, 0), ownedBox(t, D, 1)]))),
    );
    const of = (D: string) => [`${D}#0`, `${D}#1`];

    // On account 0: its own boxes are the 1.1.0 record's; account 1's are said apart, and its mix leaves them out.
    const before = await t.lovejoin.status("preprod");
    expect(before.fromPublic.map(ref).sort()).toEqual([...of(zero.D), ...of(one.D)].sort());
    expect(before.otherAccounts?.map((b) => `${ref(b)}@${b.account}`).sort()).toEqual(of(one.D).map((r) => `${r}@1`));
    await t.lovejoin.publicAgainBuild("preprod");
    let spent = (await keptInputs(t)).flat();
    expect(spent.filter((o) => of(zero.D).includes(o)).sort()).toEqual(of(zero.D));
    expect(spent.filter((o) => of(one.D).includes(o))).toEqual([]);

    // On account 1: the other way round, paid from account 1's own UTxO.
    await t.accounts.use(1, ["preprod"]);
    expect((await t.lovejoin.status("preprod")).otherAccounts?.map((b) => `${ref(b)}@${b.account}`).sort()).toEqual(
      of(zero.D).map((r) => `${r}@0`),
    );
    await t.lovejoin.publicAgainBuild("preprod");
    const inputs = await keptInputs(t);
    spent = inputs.flat();
    expect(spent.filter((o) => of(one.D).includes(o)).sort()).toEqual(of(one.D));
    expect(spent.filter((o) => of(zero.D).includes(o))).toEqual([]);
    expect(inputs[0]!.some((o) => o.startsWith("f6".repeat(32)))).toBe(true);

    // Sent, it's recorded as account 1's, and so are the leaves it leaves.
    const kept = await t.wallet.withKeys(() => t.session.get<{ txHash: string; account?: number }>(SESSION_LOVEJOIN_PUBLIC));
    expect(kept!.account).toBe(1);
    await t.lovejoin.publicSubmit("preprod", kept!.txHash);
    const { chains } = (await t.store.get<{ chains: Array<{ id: string; account?: number; again?: boolean }> }>("lovejoin.preprod"))!;
    expect(chains.find((c) => c.id === kept!.txHash)).toMatchObject({ account: 1, again: true });
  });
});

describe("a restore's box a deposit from another public account made (release review C01, M14)", CHAINS, () => {
  /** Koios says `D` spent `input`; two of the wallet's boxes from it are in the pool. */
  async function restored(t: Tested, D: string, input: { bech32: string; cred: string }) {
    t.koios.txSpends.set(D, [{ payment_addr: input }]);
    t.koios.addedToAccounts.push(await ownedBox(t, D, 0), await ownedBox(t, D, 1));
    return [`${D}#0`, `${D}#1`];
  }

  it("is that account's though the wallet opens on account 0 and hasn't found that account yet, and the private balance leaves it out", async () => {
    const t = await publicFunded();
    await t.accounts.recordFirst();
    // Account 1 paid the deposit; the wallet knows only account 0 (a restore's look for accounts hasn't run yet).
    const D = "d9".repeat(32);
    const { key, address } = await accountOf(t, 1);
    const boxes = await restored(t, D, { bech32: address, cred: key });
    const status = await t.lovejoin.status("preprod");
    expect(status.fromPublic.map(ref)).toEqual(boxes);
    expect(status.otherAccounts).toEqual([
      { txHash: D, txIndex: 0, account: 1 },
      { txHash: D, txIndex: 1, account: 1 },
    ]);
    // Kept with the account it was; account 0's would be kept as 1.1.0 kept it, with none.
    const origins = (await t.store.get<{ origins: Record<string, unknown> }>("lovejoin.preprod"))!.origins;
    expect(origins[D]).toEqual({ mixed: false, public: true, account: 1, seen: t.clock.now });
    await expect(t.lovejoin.againBoxes("preprod")).rejects.toThrow("mixing them from your private balance would tie the two");
    await expect(t.lovejoin.publicAgainBuild("preprod")).rejects.toThrow("These boxes came from a mix from Account 2.");
  });

  it("finds that account's payment key past its first twenty by the stake key the input carries", async () => {
    const t = await publicFunded();
    await t.accounts.recordFirst();
    const D = "da".repeat(32);
    const far = await t.wallet.withAccount(1, (k) => ({
      bech32: k.cardano.receiveAddress(t.deps.wasm.Network.Preprod, 40),
      cred: k.cardano.paymentKeyHash(0, 40),
    }));
    await restored(t, D, far);
    expect((await t.lovejoin.status("preprod")).otherAccounts?.map((b) => b.account)).toEqual([1, 1]);
  });

  it("reads what 1.1.0 kept, `public` with no account, as account 0's", async () => {
    const t = await publicFunded();
    await t.accounts.recordFirst();
    const D = "db".repeat(32);
    await t.store.set("lovejoin.preprod", { due: [], chains: [], origins: { [D]: { mixed: false, public: true, seen: t.clock.now } } });
    t.koios.addedToAccounts.push(await ownedBox(t, D, 0));
    const zero = await t.lovejoin.status("preprod");
    expect(zero.fromPublic.map(ref)).toEqual([`${D}#0`]);
    expect(zero.otherAccounts).toBeUndefined();
    await t.accounts.add(1);
    await t.accounts.use(1, ["preprod"]);
    expect((await t.lovejoin.status("preprod")).otherAccounts).toEqual([{ txHash: D, txIndex: 0, account: 0 }]);
  });
});
