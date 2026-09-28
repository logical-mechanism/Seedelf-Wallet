// A return through Lovejoin (the default) carries its summary on its last
// transaction, as a direct return does (final review F3): a lock, a closed
// browser or retries that ran out can stop the chain after that transaction
// went to Koios and before its history is written, and it may land all the
// same. Once the chain shows it, the runs write its history from that
// summary, so what came back is the session's money, never "received". The
// real WebAssembly, Lovejoin's recorded preprod pool, and fakes of Koios.
import { describe, expect, it } from "vitest";

import type { KoiosUtxo } from "../src/background/koios";
import { CHAINS, PASSWORD, sessionsOf, withSession, type Tested } from "./chain-fixtures";
import { txIdOf } from "./fixtures/cbor";

/** Koios takes every transaction submitted, and answers the chain's last (`last()`) with a 503, as a busy gateway would. */
function busyOnLast(t: Tested, last: () => string | undefined) {
  const fetch = t.koios.fetch;
  const seen = { submits: 0, last: 0 };
  t.koios.fetch = async (url, init) => {
    const answer = await fetch(url, init);
    if (!url.endsWith("/submittx")) return answer;
    seen.submits++;
    if (txIdOf(new Uint8Array(init!.body as Uint8Array)) !== last()) return answer;
    seen.last++;
    return new Response("", { status: 503 });
  };
  return seen;
}

interface Book {
  sessions: Array<{ chain?: { stopped?: string }; txs: Array<{ kind: string; txHash: string; confirmed?: boolean; summary?: unknown }> }>;
}
const recorded = async (t: Tested, txHash: string) =>
  (await t.store.get<Book>("sessions.preprod"))!.sessions[0]!.txs.find((x) => x.txHash === txHash);

/** Whose money a Seedelf UTxO the return made is, as the history classes it. */
async function classOf(t: Tested, txHash: string) {
  const classes = await t.activity.classes("preprod", [{ tx_hash: txHash, tx_index: 0 } as KoiosUtxo]);
  return classes.get(`${txHash}#0`);
}

/** The runs, a minute apart, the user busy all along, until `done()` or ten of them. One a lock cuts short fails, as the worker's does. */
async function runs(t: Tested, sessions: ReturnType<typeof sessionsOf>, done: () => boolean) {
  for (let i = 0; i < 10 && !done(); i++) {
    t.clock.now += 60_000;
    await t.wallet.touch();
    await sessions.runAll("preprod").catch(() => undefined);
  }
}

describe("a return through Lovejoin whose last transaction a stop cut off (final review F3)", CHAINS, () => {
  it("is written to the private history as the session's once it lands, after a lock while its send waited to try again", async () => {
    const { t } = await withSession("40000000");
    await t.activity.arrived("preprod", []);
    t.koios.confirmations = 1;
    let back: string | undefined;
    const seen = busyOnLast(t, () => back);
    // The wallet locks while the return's send waits to try it again.
    const sessions = sessionsOf(t, async () => {
      if (seen.last) await t.wallet.lock();
    });
    const review = await sessions.backBuild("preprod", 0);
    back = review.txHash;
    await sessions.backSubmit("preprod", review.txHash);
    await runs(t, sessions, () => seen.last > 0);
    expect(seen.last).toBe(1);
    expect(await t.wallet.state()).not.toBe("unlocked");

    await t.wallet.unlock(PASSWORD);
    // Its summary went with it, before it was sent.
    expect(await recorded(t, back)).toMatchObject({ kind: "back", summary: { index: 0, lovelace: review.lovelace } });
    // It landed, and a reading of the private balance finds what it made first: received, for now.
    await t.activity.arrived("preprod", [{ tx_hash: back, tx_index: 0, value: "30000000", address: "addr_test1" } as KoiosUtxo]);
    expect(await classOf(t, back)).toMatchObject({ origin: "received" });

    // The next run sees it on chain: it's the session's, written once, and nothing keeps the runs going.
    expect(await sessions.runAll("preprod")).toBe(false);
    expect(await classOf(t, back)).toEqual({ id: "session:0", origin: "session" });
    expect((await t.activity.seedelf("preprod")).filter((e) => e.txHash === back)).toMatchObject([{ kind: "session-back" }]);
    expect(await recorded(t, back)).toMatchObject({ confirmed: true });
    expect((await recorded(t, back))!.summary).toBeUndefined();
  });

  it("is written once it lands when Koios never answered it and the chain stopped, with no lock", async () => {
    const { t } = await withSession("40000000");
    await t.activity.arrived("preprod", []);
    t.koios.confirmations = 1;
    let back: string | undefined;
    const seen = busyOnLast(t, () => back);
    const sessions = sessionsOf(t);
    const review = await sessions.backBuild("preprod", 0);
    back = review.txHash;
    await sessions.backSubmit("preprod", review.txHash);
    await runs(t, sessions, () => seen.last > 0);
    // Every try at it got a 503: the chain stopped there, and nothing wrote its history.
    expect(seen.last).toBe(5);
    expect((await t.store.get<Book>("sessions.preprod"))!.sessions[0]!.chain?.stopped).toBeTruthy();
    expect((await t.activity.seedelf("preprod")).some((e) => e.txHash === back)).toBe(false);

    // Koios took it all the same: the next run writes it as the session's.
    expect(await sessions.runAll("preprod")).toBe(false);
    expect(await classOf(t, back)).toEqual({ id: "session:0", origin: "session" });
    expect((await recorded(t, back))!.summary).toBeUndefined();
  });

  it("is written as it's sent when nothing stops it, and keeps no summary after", async () => {
    const { t } = await withSession("40000000");
    await t.activity.arrived("preprod", []);
    t.koios.confirmations = 1;
    const sessions = sessionsOf(t);
    const review = await sessions.backBuild("preprod", 0);
    await sessions.backSubmit("preprod", review.txHash);
    await runs(t, sessions, () => t.koios.submitted.some((b) => txIdOf(b) === review.txHash));
    expect((await t.activity.seedelf("preprod")).filter((e) => e.txHash === review.txHash)).toHaveLength(1);
    expect(await recorded(t, review.txHash)).toMatchObject({ kind: "back" });
    expect((await recorded(t, review.txHash))!.summary).toBeUndefined();
    expect(await classOf(t, review.txHash)).toEqual({ id: "session:0", origin: "session" });
  });

  it("keeps its summary when the history won't open as it's sent, and writes it once the chain shows it", async () => {
    const { t } = await withSession("40000000");
    await t.activity.arrived("preprod", []);
    t.koios.confirmations = 1;
    const sessions = sessionsOf(t);
    const review = await sessions.backBuild("preprod", 0);
    const write = t.activity.sent.bind(t.activity);
    t.activity.sent = async () => {
      throw new Error("The history won't open.");
    };
    await sessions.backSubmit("preprod", review.txHash);
    await runs(t, sessions, () => t.koios.submitted.some((b) => txIdOf(b) === review.txHash));
    t.activity.sent = write;
    expect(await recorded(t, review.txHash)).toMatchObject({ summary: { index: 0 } });

    await sessions.runAll("preprod");
    expect(await classOf(t, review.txHash)).toEqual({ id: "session:0", origin: "session" });
    expect((await recorded(t, review.txHash))!.summary).toBeUndefined();
  });
});
