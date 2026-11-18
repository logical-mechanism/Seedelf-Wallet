// A site connected on the public side talks to the dApp account, Settings'
// choice (Account 1 by default), whichever account the wallet is working on
// (dapp.ts withDappKeys). A mix from the public side is built and signed by
// the active account (lovejoin.ts publicBuild), and every account's is kept
// under the one owner "public", one at a time (chainOwner). signTx's first
// look (heldForLovejoin) read that reservation whole, before anything was
// looked up or counted: so while Account 2 sent a mix, a site on Account 1
// that named one of that chain's UTxOs (Account 2's own, its collateral, a
// pool box it draws) heard "a Lovejoin chain still holds" it, where a
// stranger's UTxO hears "Nothing in this transaction is the public account's
// to sign", and learned that the two accounts are one wallet's, and that it
// mixes now (chunk 51, e3a#1). privacy.md (Connecting a site) promises "a
// signature is checked only against its own account's Lovejoin chain". The
// reservation now says which account pays it (lovejoin.ts ChainReservation),
// as it's sent and once it stops, and a site hears of its own account's alone.
import { describe, expect, it } from "vitest";

import { type DappSession } from "../src/background/dapp";
import { chainOwner, SESSION_LOVEJOIN_PUBLIC, type ChainReservation } from "../src/background/lovejoin";
import { reservationOf, reservations } from "../src/background/spent";
import { TxSignError } from "../src/shared/dapp";
import { chainNet, publicFunded, type Tested } from "./chain-fixtures";
import { koiosPreprod, loadTestWasm, vectors } from "./fakes";
import { ADA, ADA_ROWS } from "./v2-pools";

/** A real chain, built and measured in WebAssembly. */
const CHAINS = { timeout: 180_000 };

/** Someone else's address: the 15-word phrase's. */
const THEIRS = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 15)!.preprod
  .receive_0 as string;

let pages = 0;
const site = (): DappSession => ({ id: `other-account-mix-${++pages}`, origin: "https://app.example.com", title: "Example" });

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}

const uint = (n: number) => (n < 24 ? n.toString(16).padStart(2, "0") : `18${n.toString(16).padStart(2, "0")}`);
const outpoints = (list: string[]) => `8${list.length}${list.map((o) => `825820${o.slice(0, 64)}${uint(Number(o.slice(65)))}`).join("")}`;

/** A site's transaction spending `inputs` and putting up `collateral`, paying 4 ₳ to someone else: read, never balanced. */
function siteTx(inputs: string[], collateral: string[] = []) {
  const pay = `825839${loadTestWasm().cip30Address(THEIRS)}1a003d0900`;
  const fields = [`00${outpoints(inputs)}`, `0181${pay}`, "021a00029810", ...(collateral.length ? [`0d${outpoints(collateral)}`] : [])];
  return `84a${fields.length}${fields.join("")}a0f5f6`;
}

/** Public account `index` known, with a 5 ₳ collateral (`f5…#0`) and 60 ₳ (`f6…#0`) of its own. */
async function fundAccount(t: Tested, index: number) {
  await t.accounts.add(index);
  const { key, address } = await t.wallet.withAccount(index, (k) => ({
    key: k.cardano.paymentKeyHash(0, 0),
    address: k.cardano.receiveAddress(t.deps.wasm.Network.Preprod, 0),
  }));
  const [first] = Object.values(koiosPreprod.accounts)[0]!.account_utxos.filter((u) => BigInt(u.value) > 1_000_000_000n);
  const at = (tx: string, value: string) => ({ ...first!, tx_hash: tx.repeat(32), tx_index: 0, value, address, payment_cred: key, asset_list: [] });
  t.koios.addedToAccounts.push(at("f5", "5000000"), at("f6", "60000000"));
  return { collateral: `${"f5".repeat(32)}#0`, funds: `${"f6".repeat(32)}#0` };
}

/**
 * Account 1 (index 0) the dApp account, Settings' default, with a site connected to it on the public side; and the
 * wallet working on Account 2 (index 1), which has money of its own. Then `hears`: what the site is told of a
 * transaction naming those UTxOs, each with a fresh minute of its lookups (dapp.ts PER_MINUTE).
 */
async function siteWhileAccountTwoMixes() {
  const t = await publicFunded();
  await t.accounts.recordFirst();
  await t.preferences.set({ dappConnector: true, dappPassword: false, spendRewards: false, lovejoinDepth: 1 });
  const two = await fundAccount(t, 1);
  const s = site();
  const enabling = t.dapp.call(s, "enable", []);
  await until(() => t.dapp.approvals().length === 1);
  await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
  expect(await enabling).toBe(true);
  await t.accounts.use(1, ["preprod"]);
  expect((await t.preferences.get()).dappAccount).toBe(0);
  const hears = async (inputs: string[], collateral: string[] = []) => {
    const failure = await t.dapp.call(s, "signTx", [siteTx(inputs, collateral), false]).then(
      () => undefined,
      (e: { failure?: unknown }) => e.failure ?? String(e),
    );
    t.clock.now += 61_000;
    return failure;
  };
  return { t, s, two, hears };
}

/** What the public side's chain holds now, as the wallet keeps it. */
const heldPublic = async (t: Tested) =>
  (await t.wallet.withKeys(() => reservations(t.session, "preprod", t.clock.now)))[chainOwner()] as ChainReservation | undefined;

/** What a stranger's UTxO gets: no window, nothing named. */
const STRANGERS = { code: TxSignError.ProofGeneration, info: "Nothing in this transaction is the public account's to sign." };
const STRANGER = `${"cd".repeat(32)}#0`;
/** What a site hears for a UTxO its own account's chain holds. */
const HELD = { code: TxSignError.ProofGeneration, info: expect.stringContaining("that a Lovejoin chain still holds") };

/** Koios never answers a submit from the `from`th on: the first of those reaches the node all the same. */
function unansweredFrom(t: Tested, from: number) {
  const fetch = t.koios.fetch;
  const state = { down: true, submits: 0 };
  t.koios.fetch = async (url, init) => {
    if (state.down && url.endsWith("/submittx")) {
      const n = ++state.submits;
      if (n < from) return fetch(url, init);
      if (n === from) await fetch(url, init);
      throw new TypeError("Failed to fetch");
    }
    return fetch(url, init);
  };
  return state;
}

describe("a site on the dApp account while another public account's mix is sent (chunk 51, e3a#1)", CHAINS, () => {
  it("hears a stranger's answer for every UTxO that mix holds, as privacy.md promises; that account's own site is still kept from them", async () => {
    const { t, s, two, hears } = await siteWhileAccountTwoMixes();

    // Account 2 sends a mix from the public account through Lovejoin's 5 ₳ pool: four boxes, five transactions, so the
    // first window leaves some of it to send (a chain of four or fewer goes whole at Send).
    const summary = await t.lovejoin.publicBuild("preprod", 4, { pool: ADA });
    const kept = await t.wallet.withKeys(() => t.session.get<{ chain: Array<{ txHash: string }> }>(SESSION_LOVEJOIN_PUBLIC));
    const order = kept!.chain.map((c) => c.txHash);
    expect(order).toHaveLength(5);
    const net = chainNet(t, () => order);
    await t.lovejoin.publicSubmit("preprod", summary.txHash);
    expect(net.mempool.length).toBeGreaterThan(0);
    expect(net.mempool.length).toBeLessThan(5);
    const { chains } = (await t.store.get<{ chains: Array<{ id: string; account?: number }> }>("lovejoin.preprod"))!;
    expect(chains.find((c) => c.id === summary.txHash)?.account).toBe(1);

    // What it holds while it's sent: Account 2's UTxO, its collateral and the pool boxes it draws, under "public",
    // named as Account 2's, as its record is.
    const held = (await heldPublic(t))!;
    expect(held.until).toBeUndefined();
    expect(held.account).toBe(1);
    expect(held.inputs).toContain(two.funds);
    expect(held.collateral).toContain(two.collateral);
    const rows = new Set(ADA_ROWS.map((u) => `${u.tx_hash}#${u.tx_index}`));
    const box = held.inputs.find((o) => rows.has(o));
    expect(box).toBeDefined();

    // None is Account 1's to sign: each goes the stranger's way.
    expect(await hears([STRANGER])).toEqual(STRANGERS);
    expect({
      "Account 2's UTxO": await hears([two.funds]),
      "a pool box the chain draws": await hears([box!]),
      "Account 2's collateral": await hears([STRANGER], [two.collateral]),
    }).toEqual({
      "Account 2's UTxO": STRANGERS,
      "a pool box the chain draws": STRANGERS,
      "Account 2's collateral": STRANGERS,
    });
    expect(t.dapp.approvals()).toEqual([]);

    // Settings makes Account 2 the dApp account: its own mix's UTxOs are kept from the site again, and its collateral
    // isn't offered while it backs the chain.
    await t.preferences.set({ dappAccount: 1 });
    expect(await hears([two.funds])).toEqual(HELD);
    expect(await hears([box!])).toEqual(HELD);
    expect(await hears([STRANGER], [two.collateral])).toEqual(HELD);
    expect(await t.dapp.call(s, "getCollateral", [])).toBeNull();
    expect(t.dapp.approvals()).toEqual([]);
  });

  it("still says whose it is once that mix stops at a mix that may have gone through: what the mix spends goes the stranger's way too", async () => {
    const { t, hears } = await siteWhileAccountTwoMixes();
    const mix = await t.lovejoin.publicBuild("preprod", 1, { pool: ADA });
    const { chain } = (await t.wallet.withKeys(() =>
      t.session.get<{ chain: Array<{ kind: string; txCbor: string }> }>(SESSION_LOVEJOIN_PUBLIC),
    ))!;
    const net = unansweredFrom(t, 2);
    await expect(t.lovejoin.publicSubmit("preprod", mix.txHash)).rejects.toThrow("may have gone through");
    net.down = false;
    expect(chain[1]!.kind).toBe("mix");

    // Only what that mix spends stays held (lovejoin.ts holdOnly), still named as Account 2's.
    const held = reservationOf([chain[1]!]).inputs;
    expect(await heldPublic(t)).toEqual({ inputs: held, collateral: [], account: 1 });
    expect(await hears([held[0]!])).toEqual(STRANGERS);

    await t.preferences.set({ dappAccount: 1 });
    expect(await hears([held[0]!])).toEqual(HELD);
    expect(t.dapp.approvals()).toEqual([]);
  });
});
