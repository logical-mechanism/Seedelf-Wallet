// Lovejoin's boxes from a mix a public account paid, with several public
// accounts (release review C01). A mix from the public side records which
// account paid it, and so do the leaves it leaves and, after a restore, what
// Koios says made a box. Mix again from my public account then takes only the
// active account's boxes: another account paying for their mixes would tie
// the two accounts together, so with only those left it says which account to
// switch to. The private balance still leaves every account's boxes out
// (privacy review §2.10). A record 1.1.0 kept names no account: it had one,
// account 0. In v2's 5 ₳ pool: the classic pool, retired, mixes none again
// (chunk 44).
import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { CHAIN_CUT, SESSION_LOVEJOIN_PUBLIC } from "../src/background/lovejoin";
import { HOUR, PASSWORD, publicFunded, type Tested } from "./chain-fixtures";
import { koiosPreprod } from "./fakes";
import { ADA, ADA_ADDRESS, ADA_VIEW, adaBox, ownDatum } from "./v2-pools";

/** Real chains, built and measured in WebAssembly, two in a test. */
const CHAINS = { timeout: 180_000 };

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const ref = (b: { txHash: string; txIndex: number }) => `${b.txHash}#${b.txIndex}`;

/** One of the wallet's boxes at `tx#txIndex` in the 5 ₳ pool: the Seedelf key is account 0's, whichever is active. */
async function ownedBox(t: Tested, tx: string, txIndex: number) {
  return adaBox(tx, await ownDatum(t.wallet), undefined, undefined, txIndex);
}

/** The page's view of the 5 ₳ pool. */
const inAda = async (t: Tested) => (await t.lovejoin.status("preprod")).pools!.find((p) => p.id === ADA)!;

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
        { txHash: A!, txIndex: 0, pool: ADA },
        { txHash: B!, txIndex: 0, pool: ADA },
      ],
      boxes: 2,
      pools: { [ADA]: 2 },
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
    const summary = await t.lovejoin.publicBuild("preprod", 4, { pool: ADA });
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
    const status = await inAda(t);
    expect(status.fromPublic.map(ref).sort()).toEqual([...theirs].sort());
    expect(status.otherAccounts?.map((b) => `${ref(b)}@${b.account}`).sort()).toEqual(theirs.map((r) => `${r}@0`).sort());
    expect(status.notMixed.map(ref)).toEqual([`${record!.deposit}#3`]);

    // Account 1 doesn't pay to mix account 0's boxes: it says which account put them in, and nothing is kept for Send.
    await expect(t.lovejoin.publicAgainBuild("preprod", ADA)).rejects.toThrow(
      "These boxes came from a mix from Account 1. Switch to it on the Public tab to mix them again: paying from this account would tie the two accounts together.",
    );
    expect(await t.wallet.withKeys(() => t.session.get(SESSION_LOVEJOIN_PUBLIC))).toBeUndefined();
    // Nor does the private balance, unless asked (privacy review §2.10).
    await expect(t.lovejoin.againBoxes("preprod", false, ADA)).rejects.toThrow(
      "mixing them from your private balance would tie the two",
    );

    // Back on account 0, its own boxes are its to mix again, paid by it: none of account 1's money goes in.
    await t.accounts.use(0, ["preprod"]);
    expect((await inAda(t)).otherAccounts).toBeUndefined();
    // Switched to account 1 while the review reads the pool's reward balance, after account 0's UTxOs were read: not
    // built, as account 1 paying to mix account 0's boxes would tie the two, and nothing is kept for Send (chunk 51,
    // t1g#14).
    const real = t.koios.fetch;
    let switched = false;
    t.koios.fetch = async (url, init) => {
      if (!switched && url.endsWith("/account_info")) {
        switched = true;
        await t.accounts.use(1, ["preprod"]);
      }
      return real(url, init);
    };
    await expect(t.lovejoin.publicAgainBuild("preprod", ADA)).rejects.toThrow("That mix isn't ready to send. Review it again.");
    t.koios.fetch = real;
    expect(switched).toBe(true);
    expect(await t.wallet.withKeys(() => t.session.get(SESSION_LOVEJOIN_PUBLIC))).toBeUndefined();
    await t.accounts.use(0, ["preprod"]);
    const again = await t.lovejoin.publicAgainBuild("preprod", ADA);
    expect(again).toMatchObject({ again: true, boxes: 4, owned: 4 });
    const spent = (await keptInputs(t)).flat();
    // Account 1's two UTxOs by their outpoints: a box's own hash may start "f5" or "f6" (fundAccount).
    const account1 = [`${"f5".repeat(32)}#0`, `${"f6".repeat(32)}#0`];
    expect(spent.filter((o) => account1.includes(o))).toEqual([]);
    expect(spent.filter((o) => theirs.includes(o)).sort()).toEqual([...theirs].sort());
  });

  it("takes only the active account's boxes when both have some, and reads a record 1.1.0 kept as account 0's", async () => {
    const t = await publicFunded();
    await t.accounts.recordFirst();
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    await fundAccount(t, 1, "f");
    // Account 0's mix, named by no account as 1.1.0 recorded it, and account 1's, each cut after its deposit.
    const zero = cutChain("0", t.clock.now - 2 * HOUR);
    const one = cutChain("1", t.clock.now - HOUR, 1);
    await t.store.set("lovejoin.preprod", { due: [], chains: [zero.record, one.record] });
    t.koios.addedToAccounts.push(
      ...(await Promise.all([zero.D, one.D].flatMap((D) => [ownedBox(t, D, 0), ownedBox(t, D, 1)]))),
    );
    const of = (D: string) => [`${D}#0`, `${D}#1`];

    // On account 0: its own boxes are the 1.1.0 record's; account 1's are said apart, and its mix leaves them out.
    const before = await inAda(t);
    expect(before.fromPublic.map(ref).sort()).toEqual([...of(zero.D), ...of(one.D)].sort());
    expect(before.otherAccounts?.map((b) => `${ref(b)}@${b.account}`).sort()).toEqual(of(one.D).map((r) => `${r}@1`));
    await t.lovejoin.publicAgainBuild("preprod", ADA);
    let spent = (await keptInputs(t)).flat();
    expect(spent.filter((o) => of(zero.D).includes(o)).sort()).toEqual(of(zero.D));
    expect(spent.filter((o) => of(one.D).includes(o))).toEqual([]);

    // On account 1: the other way round, paid from account 1's own UTxO.
    await t.accounts.use(1, ["preprod"]);
    expect((await inAda(t)).otherAccounts?.map((b) => `${ref(b)}@${b.account}`).sort()).toEqual(
      of(zero.D).map((r) => `${r}@0`),
    );
    await t.lovejoin.publicAgainBuild("preprod", ADA);
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
    const status = await inAda(t);
    expect(status.fromPublic.map(ref)).toEqual(boxes);
    expect(status.otherAccounts).toEqual([
      { txHash: D, txIndex: 0, account: 1, pool: ADA },
      { txHash: D, txIndex: 1, account: 1, pool: ADA },
    ]);
    // Kept with the account it was; account 0's would be kept as 1.1.0 kept it, with none.
    const origins = (await t.store.get<{ origins: Record<string, unknown> }>("lovejoin.preprod"))!.origins;
    expect(origins[D]).toEqual({ mixed: false, public: true, account: 1, seen: t.clock.now });
    await expect(t.lovejoin.againBoxes("preprod", false, ADA)).rejects.toThrow(
      "mixing them from your private balance would tie the two",
    );
    await expect(t.lovejoin.publicAgainBuild("preprod", ADA)).rejects.toThrow("These boxes came from a mix from Account 2.");
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
    expect((await inAda(t)).otherAccounts?.map((b) => b.account)).toEqual([1, 1]);
  });

  it("reads what 1.1.0 kept, `public` with no account, as account 0's", async () => {
    const t = await publicFunded();
    await t.accounts.recordFirst();
    const D = "db".repeat(32);
    await t.store.set("lovejoin.preprod", { due: [], chains: [], origins: { [D]: { mixed: false, public: true, seen: t.clock.now } } });
    t.koios.addedToAccounts.push(await ownedBox(t, D, 0));
    const zero = await inAda(t);
    expect(zero.fromPublic.map(ref)).toEqual([`${D}#0`]);
    expect(zero.otherAccounts).toBeUndefined();
    await t.accounts.add(1);
    await t.accounts.use(1, ["preprod"]);
    expect((await inAda(t)).otherAccounts).toEqual([{ txHash: D, txIndex: 0, account: 0, pool: ADA }]);
  });
});

// Chunk 51, gap-g6#2. What made a box no record accounts for is judged against the accounts the wallet knows at that
// pool read (lovejoin.ts accountKeys: the active one, the known ones and 0-23), and was kept as judged then. A deposit
// from public account 30, which only `add` or `check` reaches, read after a restore before the user added 30 back, was
// kept as no account's: once 30 was known, the 5 ₳ pool's page still said nothing of account 30, and Mix my boxes again
// from the private balance took those boxes, which privacy.md's "Mixing the boxes again" says it never does ("takes only
// the others"). Kept with the inputs it was judged from, it's judged again on the device once the wallet knows another
// account; one kept before origins kept their inputs is asked about once more.
describe("a restore's box a deposit from a custom account made, that account added after (chunk 51, gap-g6#2)", CHAINS, () => {
  /** Past MAX_PROBE's 0-23: never derived by accountKeys unless the wallet knows it. */
  const CUSTOM = 30;
  const TIES = "mixing them from your private balance would tie the two";

  /**
   * A restore's two boxes in the 5 ₳ pool, made by deposit `D`, which Koios says spent public account 30's first
   * receive address (a public Bootstrap or a mix cut after its deposit). The Seedelf key is account 0's, so the boxes are
   * the wallet's whichever account paid. A fresh wallet that knows only account 0 is what a restore leaves.
   */
  async function restored(t: Tested, D: string): Promise<string[]> {
    const input = await t.wallet.withAccount(CUSTOM, (k) => ({
      bech32: k.cardano.receiveAddress(t.deps.wasm.Network.Preprod, 0),
      cred: k.cardano.paymentKeyHash(0, 0),
    }));
    t.koios.txSpends.set(D, [{ payment_addr: input }]);
    t.koios.addedToAccounts.push(await ownedBox(t, D, 0), await ownedBox(t, D, 1));
    return [`${D}#0`, `${D}#1`];
  }

  /** How often Koios was asked what made a box (tx_info). */
  const asked = (t: Tested) => t.koios.calls.filter((c) => c.path === "tx_info").length;

  it("control: account 30 added before the first pool read is that account's, and the private balance leaves its boxes out", async () => {
    const t = await publicFunded();
    await t.accounts.recordFirst();
    await t.accounts.add(CUSTOM);
    const boxes = await restored(t, "dc".repeat(32));
    const status = await inAda(t);
    expect(status.fromPublic.map(ref).sort()).toEqual([...boxes].sort());
    expect(status.otherAccounts?.map((b) => b.account)).toEqual([CUSTOM, CUSTOM]);
    await expect(t.lovejoin.againBoxes("preprod", false, ADA)).rejects.toThrow(TIES);
  });

  it("is that account's once it's added after the first pool read, judged again on the device, asking nobody", async () => {
    const t = await publicFunded();
    await t.accounts.recordFirst();
    const boxes = await restored(t, "dd".repeat(32));
    // The restore's first pool read (Lovejoin's page opened) before the user adds account 30: 30 is neither known nor
    // among the first 24, so nothing names it yet.
    const before = await inAda(t);
    expect(before.fromPublic).toEqual([]);
    expect(before.notMixed.map(ref).sort()).toEqual([...boxes].sort());
    const asks = asked(t);
    // The user adds account 30 by its number (accounts.ts add: no request). The wallet knows it now.
    await t.accounts.add(CUSTOM);
    expect((await t.accounts.known()).map((a) => a.index)).toEqual([0, CUSTOM]);
    // Account 30's deposit boxes are its, named on the page, and never mixed again from the private balance unless
    // asked: judged again from the inputs kept, nobody asked.
    const after = await inAda(t);
    expect(after.fromPublic.map(ref).sort()).toEqual([...boxes].sort());
    expect(after.otherAccounts?.map((b) => b.account)).toEqual([CUSTOM, CUSTOM]);
    await expect(t.lovejoin.againBoxes("preprod", false, ADA)).rejects.toThrow(TIES);
    expect(asked(t)).toBe(asks);
  });

  it("asks once more about what made a box kept before origins kept their inputs, once the wallet knows an account past the first 24", async () => {
    const t = await publicFunded();
    await t.accounts.recordFirst();
    const D = "de".repeat(32);
    const boxes = await restored(t, D);
    // A mix in the 5 ₳ pool account 30 paid for made them. A deposit's answer kept before is asked about once more
    // whatever accounts are known, since whose deposit it was can't be told without its inputs (chunk 51, e1a#1:
    // lovejoin-someone-else.test.ts); a mix's waits for an account it may have missed, as here.
    t.koios.txSpends.set(D, [{ payment_addr: { bech32: ADA_ADDRESS, cred: ADA_VIEW.mixBoxHash } }, ...t.koios.txSpends.get(D)!]);
    // As an earlier version kept it: a mix made them, no account named, nothing to judge it again from.
    await t.store.set("lovejoin.preprod", { due: [], chains: [], origins: { [D]: { mixed: false, mixedIn: [ADA], seen: t.clock.now } } });
    // Every account known is among the first 24, which it was judged against: it stands, and nobody is asked.
    const asks = asked(t);
    expect((await inAda(t)).fromPublic).toEqual([]);
    expect(asked(t)).toBe(asks);
    // Account 30 added, which it may have missed: Koios is asked about D once more, and its boxes are 30's from then on.
    await t.accounts.add(CUSTOM);
    const after = await inAda(t);
    expect(after.fromPublic.map(ref).sort()).toEqual([...boxes].sort());
    expect(after.otherAccounts?.map((b) => b.account)).toEqual([CUSTOM, CUSTOM]);
    expect(asked(t)).toBe(asks + 1);
    await expect(t.lovejoin.againBoxes("preprod", false, ADA)).rejects.toThrow(TIES);
    // Kept with its account now: asked of no more.
    await inAda(t);
    expect(asked(t)).toBe(asks + 1);
  });
});
