// The connector's reading of the dApp account, still out when the wallet is removed and another phrase restored. A
// site's calls at the same time share one reading (dapp.ts `view`), kept in the DappService, which outlives the reset,
// and keyed by network and account alone: 0 for both phrases. So a reading begun under phrase A, for A's site, was
// handed to B's site as B's account, A's used addresses beside B's first, and kept under B's session for its next
// calls; or it ended as a lock ends a read A's keys began (readAccountUtxos `phrasePin`), and B's site heard that
// instead of its account. The balance readings were tied to their phrase so (chunk 51, e4a#1, wallet.ts `phrasePin`):
// the connector's is now too, and another phrase's site never joins it, nor finds it kept.
import { describe, expect, it } from "vitest";

import { type DappSession } from "../src/background/dapp";
import { SESSION_DAPP_VIEW } from "../src/background/dapp";
import { handle, type Context } from "../src/background/handlers";
import { NetworkChoice } from "../src/background/preferences";
import type { NetworkName } from "../src/networks";
import type { Message, Status } from "../src/shared/rpc";
import { koiosPreprod, loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
/** Each case reads two phrases' accounts and restores one. */
const SLOW = { timeout: 120_000 };
const vector = (words: number, last: string) =>
  vectors("cardano_account.json").find(
    (v) => v.account === 0 && v.phrase.split(" ").length === words && v.phrase.endsWith(` ${last}`),
  )!;
/** A recorded preprod account, with addresses it has used. */
const A = vector(12, "about");
/** No account on preprod: nothing used. */
const B = vector(24, "title");

type T = ReturnType<typeof testBalances>;

function context(t: T): Context {
  const networks: NetworkName[] = ["preprod", "mainnet"];
  return {
    ...(t as unknown as Context),
    wasm: loadTestWasm(),
    connector: async (on) => on,
    version: "1.0.0",
    network: "preprod",
    networks,
    networkChoice: new NetworkChoice(t.local, networks),
  };
}

const ask = (message: Message, ctx: Context) => handle(message, ctx);

let pages = 0;
const site = (origin: string): DappSession => ({ id: `reading-phrase-${++pages}`, origin, title: "Example" });

async function until(check: () => boolean) {
  for (let i = 0; i < 400 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}

/** The connector on, the password off for sites, and a site the user connected to the public account. */
async function connected(t: T, origin: string): Promise<DappSession> {
  await t.preferences.set({ dappConnector: true, dappPassword: false, spendRewards: false });
  const s = site(origin);
  const enabling = t.dapp.call(s, "enable", []);
  await until(() => t.dapp.approvals().length === 1);
  await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
  expect(await enabling).toBe(true);
  return s;
}

/** A gate that holds the first request it's asked about until released. */
function gate() {
  let release!: () => void;
  let reached!: () => void;
  const open = new Promise<void>((r) => (release = r));
  const hit = new Promise<void>((r) => (reached = r));
  return { open, hit, release, reached };
}

/**
 * Holds the next request to `path` for the account (not the contract's), once armed: Koios slow on it. Holding
 * `credential_utxos` holds the reading after its last look at the keys; `account_addresses`, before its second.
 */
function hold(t: T, path: "credential_utxos" | "account_addresses") {
  const real = t.koios.fetch;
  const g = gate();
  let armed = false;
  t.koios.fetch = async (url, init) => {
    if (armed && new URL(url).pathname.endsWith(`/${path}`)) {
      const asked = path === "credential_utxos" ? (JSON.parse(String(init.body))._payment_credentials as string[]) : [];
      if (!asked.includes(koiosPreprod.wallet_contract)) {
        armed = false;
        g.reached();
        await g.open;
      }
    }
    return real(url, init);
  };
  return { ...g, arm: () => (armed = true) };
}

/** Counts reads of the kept view: a call's look at it comes just before it joins the reading on its way, or starts one. */
function watchViewReads(t: T): () => number {
  let reads = 0;
  const get = t.session.get.bind(t.session);
  t.session.get = (async (key: string) => {
    const value = await get(key);
    if (key === `${SESSION_DAPP_VIEW}preprod`) reads++;
    return value;
  }) as typeof t.session.get;
  return () => reads;
}

/** Phrase A's wallet, made here. */
async function walletA() {
  const t = testBalances();
  const ctx = context(t);
  expect(((await ask({ type: "create-wallet", phrase: A.phrase, password: PASSWORD }, ctx)) as Status).state).toBe("unlocked");
  return { t, ctx };
}

/** Settings' Remove wallet, then a restore of phrase B, which starts on account 0 as A was. */
async function removeAndRestoreB(ctx: Context) {
  expect(((await ask({ type: "reset-wallet", force: true }, ctx)) as Status).state).toBe("no-wallet");
  expect(((await ask({ type: "restore-wallet", phrase: B.phrase, password: PASSWORD }, ctx)) as Status).state).toBe("unlocked");
}

describe("the connector's reading, still out as the wallet is removed and another phrase restored (chunk 51, as e4a#1)", () => {
  const wasm = loadTestWasm();
  const hex = (address: string) => wasm.cip30Address(address);

  it.each(["credential_utxos", "account_addresses"] as const)(
    "never answers the new phrase's site, nor is kept for it (Koios slow on %s)",
    async (path) => {
      const { t, ctx } = await walletA();
      const a = await connected(t, "https://a.example");
      // A's site asks for its used addresses; the reading it starts is slow at Koios.
      const slow = hold(t, path);
      slow.arm();
      const left = t.dapp.call(a, "getUsedAddresses", []).then(
        (v) => v,
        (e: unknown) => e,
      );
      await slow.hit;

      await removeAndRestoreB(ctx);
      const b = await connected(t, "https://b.example");
      // B's site asks while A's reading is still out, and gets as far as the reading; then Koios answers A's.
      const reads = watchViewReads(t);
      const asking = t.dapp.call(b, "getUsedAddresses", []);
      await until(() => reads() > 0);
      for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
      slow.release();
      await left;
      // B's site hears B's account: its first address alone, nothing of A's.
      expect(await asking).toEqual([hex(B.preprod.receive_0 as string)]);
      // And what's kept for B's next calls is B's reading, or nothing: never A's account.
      const kept = await t.wallet.withKeys(() => t.session.get<{ stake: string }>(`${SESSION_DAPP_VIEW}preprod`));
      if (kept) expect(kept.stake).toBe(B.preprod.stake);
      expect(await t.dapp.call(b, "getUsedAddresses", [])).toEqual([hex(B.preprod.receive_0 as string)]);
    },
    SLOW.timeout,
  );

  it("control: across a lock and an unlock of the same phrase, a site still gets the reading it asked for", SLOW, async () => {
    const { t } = await walletA();
    const a = await connected(t, "https://a.example");
    const slow = hold(t, "credential_utxos");
    slow.arm();
    const left = t.dapp.call(a, "getUsedAddresses", []);
    await slow.hit;
    await t.wallet.lock();
    expect(await t.wallet.unlock(PASSWORD)).toMatchObject({ unlocked: true });
    slow.release();
    const used = (await left) as string[];
    expect(used[0]).toBe(hex(A.preprod.receive_0 as string));
    expect(used.length).toBeGreaterThan(1);
  });
});
