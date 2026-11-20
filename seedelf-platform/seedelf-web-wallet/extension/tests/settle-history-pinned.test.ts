// A payment that may have gone through, settled while the wallet is removed and another phrase restored (chunk 51,
// own#6, e4a#1's family). settleNow pins every turn of its own to the phrase it began under, but the Seedelf history's
// write after them, when the payment is seen on chain or sent again and taken, went unpinned: it waits its turn in the
// history's queue, so a Remove wallet and a restore coming first sealed it into the next phrase's history. Since a
// public Send to the user's own Seedelf writes a move-in there (gap-g8#2), that's this phrase's amount, hash and account
// in another phrase's private Activity and CSV. Both writes now carry the settle's pin: under another phrase, nothing.
import { describe, expect, it } from "vitest";

import { handle, type Context } from "../src/background/handlers";
import { NetworkChoice } from "../src/background/preferences";
import type { NetworkName } from "../src/networks";
import { madePrivate } from "../src/shared/histories";
import type { ActivityEntry, Message, PaymentAsk, Status } from "../src/shared/rpc";
import { loadTestWasm, ownedUtxos, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) => vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
const A = account(12).phrase as string;
const B = account(24).phrase as string;
/** A's own Seedelf (owned-utxos.json). */
const MINE = ownedUtxos[2]!.asset_list![0]!.asset_name;
const toMine: PaymentAsk = { to: MINE, lovelace: "50000000", tokens: [] };
/** pending.ts RESEND_MS: how long a maybe-sent payment waits before it's sent again. */
const RESEND_MS = 2 * 60_000;
const SLOW = { timeout: 120_000 };
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
const historyOf = async (ctx: Context) => ((await ask({ type: "history", of: "seedelf" }, ctx)) as { entries: ActivityEntry[] }).entries;

/** A public Send of 50 ₳ to A's own Seedelf that Koios took but whose answer was lost: maybe sent, nothing written yet. */
async function maybeSentToOwnSeedelf() {
  const t = testBalances();
  t.koios.tip = 106_000_000;
  t.clock.now = Date.now();
  const ctx = context(t);
  expect(((await ask({ type: "create-wallet", phrase: A, password: PASSWORD }, ctx)) as Status).state).toBe("unlocked");
  await t.balances.get("preprod");
  const summary = await t.send.build("preprod", [toMine]);
  expect(summary.payments).toMatchObject([{ seedelf: { name: MINE, own: true } }]);
  const real = t.koios.fetch;
  let lost = 1;
  t.koios.fetch = async (url, init) => {
    const answer = await real(url, init);
    if (url.endsWith("/submittx") && lost-- > 0) throw new DOMException("signal timed out", "TimeoutError");
    return answer;
  };
  expect(await t.send.submit("preprod", summary.txHash)).toMatchObject({ maybeSent: true });
  expect((await t.activity.seedelf("preprod")).map((e) => e.txHash)).not.toContain(summary.txHash);
  return { t, ctx, summary };
}

/** Holds the history's write for `txHash` until released, the way a busy history queue would. */
function holdHistoryWrite(t: T, txHash: string) {
  const sent = t.activity.sent.bind(t.activity);
  let release!: () => void;
  let reached!: () => void;
  const open = new Promise<void>((r) => (release = r));
  const hit = new Promise<void>((r) => (reached = r));
  let once = true;
  t.activity.sent = async (...args: Parameters<typeof sent>) => {
    if (once && args[1].txHash === txHash) {
      once = false;
      reached();
      await open;
    }
    return sent(...args);
  };
  return { hit, release };
}

/** Remove wallet, then B restored, while A's settle waits on the history. */
async function removeAndRestoreB(ctx: Context) {
  expect(((await ask({ type: "reset-wallet", force: true }, ctx)) as Status).state).toBe("no-wallet");
  expect(((await ask({ type: "restore-wallet", phrase: B, password: PASSWORD }, ctx)) as Status).state).toBe("unlocked");
}

describe("a maybe-sent Send to the user's own Seedelf, settled as the wallet is removed and another phrase restored (chunk 51, own#6)", () => {
  it("control: settled under its own phrase, its move-in is written, made private from account 0", SLOW, async () => {
    const { t, ctx, summary } = await maybeSentToOwnSeedelf();
    t.koios.confirmations = 1;
    expect(await t.pending.pending("preprod")).toMatchObject({ txHash: summary.txHash, confirmations: 1 });
    expect((await historyOf(ctx)).find((e) => e.txHash === summary.txHash)).toMatchObject({
      kind: "move-in",
      lovelace: "50000000",
      origin: madePrivate(0),
      bySend: true,
    });
  });

  it("seen on chain: its move-in is never sealed into the next phrase's history", SLOW, async () => {
    const { t, ctx, summary } = await maybeSentToOwnSeedelf();
    t.koios.confirmations = 1;
    const held = holdHistoryWrite(t, summary.txHash);
    const look = t.pending.pending("preprod");
    look.catch(() => undefined);
    await held.hit;
    await removeAndRestoreB(ctx);
    expect((await t.wallet.account("preprod")).receiveAddress).toBe(account(24).preprod.receive_0);
    held.release();
    await look.catch(() => undefined);
    expect(
      (await historyOf(ctx)).filter((e) => e.txHash === summary.txHash),
      "A's move-in in B's sealed history",
    ).toEqual([]);
  });

  it("sent again and taken: its move-in is never sealed into the next phrase's history", SLOW, async () => {
    const { t, ctx, summary } = await maybeSentToOwnSeedelf();
    t.clock.now += RESEND_MS + 1_000;
    const submits = t.koios.submitted.length;
    const held = holdHistoryWrite(t, summary.txHash);
    const look = t.pending.pending("preprod");
    look.catch(() => undefined);
    await held.hit;
    expect(t.koios.submitted.length).toBe(submits + 1);
    await removeAndRestoreB(ctx);
    held.release();
    await look.catch(() => undefined);
    expect(
      (await historyOf(ctx)).filter((e) => e.txHash === summary.txHash),
      "A's move-in in B's sealed history",
    ).toEqual([]);
  });
});
