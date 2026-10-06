// A top-up whose first submit Koios didn't answer may have gone, and the
// wallet's watch keeps sending it. Sent again from a page that missed the
// answer and turned away (a 429, a node down), it was marked unsent: Disconnect
// then stopped waiting for it, deleted the session's record, and the watch
// landed it at a one-time account nothing reads (release review). Sent again,
// it stays on its way whatever that try met. The 12-word phrase, the real
// WebAssembly, and fakes of Koios, giveme.my and Minswap's aggregator.
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { KoiosBusyError, KoiosError, type KoiosUtxo } from "../src/background/koios";
import { builtOutputs, Minswap } from "../src/background/minswap";
import { pendingKey } from "../src/background/pending";
import { SESSION_TOP_UP, SessionService } from "../src/background/sessions";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, ownedUtxos, sessionSwap, testBalances, vectors, withdrawPreprod } from "./fakes";

const PASSWORD = "correct horse battery";
const ORIGIN = "https://a.example";
/** A top-up the chain doesn't have after this long never reached it, unless the watch still sends it (sessions.ts). */
const FAILED_AFTER = 20 * 60_000 + 1;
const WAITING = "Its last transaction hasn't reached the chain yet";
const phrase = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase as string;

type T = Awaited<ReturnType<typeof unlocked>>;

async function unlocked() {
  const t = testBalances();
  await t.wallet.create(phrase, PASSWORD);
  // One spend: the funding takes the 25 ₳ UTxO alone.
  const evaluation = withdrawPreprod.amount.evaluation as { result: unknown[] };
  t.koios.evaluation = { ...evaluation, result: evaluation.result.slice(0, 1) };
  // More of the private balance, so a top-up can be funded too.
  t.koios.added.push({ ...ownedUtxos[0]!, tx_hash: "01".repeat(32), block_height: 9_000_001 });
  return t;
}

/** The session service with giveme.my's witness and the one-time key's signature stood in for, as sessions.test.ts does. */
function signing(t: T, runner: { start(): Promise<void> } = { start: async () => undefined }) {
  const wasm = loadTestWasm();
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  return new SessionService({
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
    alarm: runner,
  });
}

type Answer = "taken-504" | "429" | "node down" | "ok";

/** Koios answers its submits as `answer` says, the first being 0; everything else as the fake does. */
function submits(t: T, answer: (n: number) => Answer) {
  const real = t.koios.fetch;
  let n = 0;
  t.koios.fetch = async (url, init) => {
    if (!url.endsWith("/submittx")) return real(url, init);
    const how = answer(n++);
    if (how === "ok") return real(url, init);
    if (how === "429") return new Response("slow down", { status: 429 });
    // A Koios backend whose own node is down, every time it's asked.
    if (how === "node down") return new Response("TxSubmitConnectionError", { status: 400 });
    // The node took it; the gateway's answer never came back whole.
    await real(url, init);
    return new Response("gateway timeout", { status: 504 });
  };
}

/** Koios's backends list what transaction `tx` paid session 0's account, and that it's spent since. */
function spentSince(t: T, tx: Uint8Array) {
  const id = txIdOf(tx);
  builtOutputs(tx).forEach((o, i) => {
    if (o.address.slice(2, 58) !== sessionSwap.keyHash) return;
    t.koios.addedToAccounts.push({
      tx_hash: id,
      tx_index: i,
      address: sessionSwap.address,
      value: "5000000",
      stake_address: null,
      payment_cred: sessionSwap.keyHash,
      block_height: 5_000_000,
      inline_datum: null,
      asset_list: [],
    } as KoiosUtxo);
    t.koios.spent.add(`${id}#${i}`);
  });
}

/** Session 0's record of `txHash`, as the worker keeps it. */
async function recorded(t: T, txHash: string) {
  type Tx = { txHash: string; unsent?: boolean; why?: string };
  const book = await t.store.get<{ sessions: Array<{ index: number; txs: Tx[] }> }>("sessions.preprod");
  return book?.sessions.find((s) => s.index === 0)?.txs.find((x) => x.txHash === txHash);
}

/**
 * A site's session 0, its funding landed and all it paid spent since (the site took it), so only a top-up can keep
 * Disconnect waiting; and a top-up of 3 ₳ built, which the chain never shows here.
 */
async function toppingUp(t: T, sessions: SessionService) {
  const out = await sessions.siteOutBuild("preprod", ORIGIN, "15000000", []);
  await sessions.siteOutSubmit("preprod", out.txHash, ORIGIN);
  t.koios.confirmations = 1;
  spentSince(t, t.koios.submitted.at(-1)!);
  const more = await sessions.topUpBuild("preprod", 0, "3000000", []);
  t.koios.missing.add(more.txHash);
  return more;
}

/** Moves the clock on by `ms`, the user busy all along, so the wallet doesn't lock itself. */
async function busy(t: T, ms: number) {
  for (let left = ms; left > 0; left -= 10 * 60_000) {
    t.clock.now += Math.min(left, 10 * 60_000);
    await t.wallet.touch();
  }
}

describe("a top-up Koios didn't answer, sent again and turned away", () => {
  for (const [what, how, type] of [
    ["a 429", "429", KoiosBusyError],
    ["a node Koios couldn't reach", "node down", KoiosError],
  ] as const) {
    it(`stays on its way on ${what}, so Disconnect waits for it`, async () => {
      const t = await unlocked();
      const sessions = signing(t);
      const more = await toppingUp(t, sessions);
      submits(t, (n) => (n === 0 ? "taken-504" : how));
      // Koios didn't answer: it may have gone, and the watch keeps sending it.
      expect(await sessions.topUpSubmit("preprod", more.txHash)).toMatchObject({ txHash: more.txHash, maybeSent: true });
      // A page that missed the answer sends it again, and this try is turned away.
      const again = await sessions.topUpSubmit("preprod", more.txHash).catch((e: unknown) => e);
      expect(again).toBeInstanceOf(type);
      expect(again).not.toMatchObject({ maybeSent: true });
      expect(await recorded(t, more.txHash)).not.toHaveProperty("unsent");
      expect(await t.session.get(pendingKey("preprod"))).toMatchObject({ txHash: more.txHash, maybeSent: true });
      // Disconnect waits for it: within its 20 minutes, and past them while the watch still sends it.
      await expect(sessions.disconnect("preprod", 0)).rejects.toThrow(WAITING);
      await busy(t, FAILED_AFTER);
      await expect(sessions.disconnect("preprod", 0)).rejects.toThrow(WAITING);
      expect(await recorded(t, more.txHash)).toBeDefined();
    });
  }

  it("stays on its way when another page's top-up review takes Send's copy as it's sent again", async () => {
    const t = await unlocked();
    // What happens at the next start of the runs, which Send asks for just before it sends.
    let race: (() => Promise<void>) | undefined;
    const runner = {
      start: async () => {
        const now = race;
        race = undefined;
        await now?.();
      },
    };
    const sessions = signing(t, runner);
    const more = await toppingUp(t, sessions);
    submits(t, (n) => (n === 0 ? "taken-504" : "ok"));
    await sessions.topUpSubmit("preprod", more.txHash);
    // Between Send's reading its copy and sending it, a new review replaces it: the bytes may be out all the same.
    const kept = (await t.session.get<{ txHash: string; sentCbor?: string }>(SESSION_TOP_UP))!;
    expect(kept.sentCbor).toBeDefined();
    race = () => t.session.set(SESSION_TOP_UP, { ...kept, txHash: "ab".repeat(32), sentCbor: undefined });
    await expect(sessions.topUpSubmit("preprod", more.txHash)).rejects.toThrow("That was sent already");
    expect(await recorded(t, more.txHash)).not.toHaveProperty("unsent");
    await expect(sessions.disconnect("preprod", 0)).rejects.toThrow(WAITING);
  });

  it("is still marked unsent when its first and only try is turned away", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    const more = await toppingUp(t, sessions);
    submits(t, () => "429");
    await expect(sessions.topUpSubmit("preprod", more.txHash)).rejects.toBeInstanceOf(KoiosBusyError);
    expect(await recorded(t, more.txHash)).toMatchObject({ unsent: true, why: "busy" });
    expect((await t.session.get<{ txHash: string }>(pendingKey("preprod")))?.txHash).not.toBe(more.txHash);
  });
});
