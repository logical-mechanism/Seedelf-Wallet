// A mix from the public account that stopped at a mix that may have gone
// through holds what that mix spends until it's settled, and never the
// account's collateral: no mix of the chain waits for it anymore, so a site
// on the account is offered it and may put it up. The worker's runs look
// for that mix themselves, so what it holds goes once it's settled with no
// wallet page open, and a site's refusal meanwhile says the chain stopped,
// not that it's still being sent (final review F2).
import { describe, expect, it } from "vitest";

import type { DappSession } from "../src/background/dapp";
import { PUBLIC_LOOK_MS, SESSION_LOVEJOIN_PUBLIC } from "../src/background/lovejoin";
import { runNetworks, type Runner } from "../src/background/runs";
import { reservationOf, SESSION_RESERVED_PREFIX } from "../src/background/spent";
import { TxSignError } from "../src/shared/dapp";
import { busyFor, loadTestWasm, vectors } from "./fakes";
import { CHAINS, publicFunded, type Tested } from "./chain-fixtures";

const COLLATERAL = `${"e5".repeat(32)}#0`;
const THEIRS = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 15)!.preprod
  .receive_0 as string;

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}

const uint = (n: number) => (n < 24 ? n.toString(16).padStart(2, "0") : `18${n.toString(16).padStart(2, "0")}`);
const outpoints = (list: string[]) => `8${list.length}${list.map((o) => `825820${o.slice(0, 64)}${uint(Number(o.slice(65)))}`).join("")}`;

/** A site's transaction spending `inputs`, putting up `collateral`, paying 4 ₳ to someone else. */
function siteTx(inputs: string[], collateral: string[]) {
  const pay = `825839${loadTestWasm().cip30Address(THEIRS)}1a003d0900`;
  return `84a400${outpoints(inputs)}0181${pay}021a000298100d${outpoints(collateral)}a0f5f6`;
}

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

const reservedPublic = async (t: Tested) =>
  (await t.wallet.withKeys(() => t.session.get<Record<string, { inputs: string[]; collateral: string[]; until?: number }>>(SESSION_RESERVED_PREFIX + "preprod")))
    ?.public;

/** A site connected to the public account. */
async function connected(t: Tested): Promise<DappSession> {
  await t.preferences.set({ dappConnector: true, spendRewards: false });
  const s: DappSession = { id: "stopped", origin: "https://app.example.com", title: "Example" };
  const enabling = t.dapp.call(s, "enable", []);
  await until(() => t.dapp.approvals().length === 1);
  await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
  await enabling;
  return s;
}

/** A mix of one box from the public account, sent while a site is connected, that stopped at its first mix, which reached the node. */
async function stoppedAtMix() {
  const t = await publicFunded("60000000", ["60000000"]);
  const s = await connected(t);
  const mix = await t.lovejoin.publicBuild("preprod", 1);
  const { chain } = (await t.wallet.withKeys(() => t.session.get<{ chain: Array<{ kind: string; txCbor: string }> }>(SESSION_LOVEJOIN_PUBLIC)))!;
  const net = unansweredFrom(t, 2);
  await expect(t.lovejoin.publicSubmit("preprod", mix.txHash)).rejects.toThrow("may have gone through");
  net.down = false;
  expect(chain[1]!.kind).toBe("mix");
  return { t, s, held: reservationOf([chain[1]!]).inputs };
}

function runner(t: Tested): Runner {
  return {
    networks: ["preprod"],
    wallet: t.wallet,
    sessions: { runAll: async () => false },
    lovejoin: t.lovejoin,
    pending: t.pending,
  } as unknown as Runner;
}

function alarm() {
  const a = { on: false, count: 0, start: async () => void ((a.on = true), a.count++), stop: async () => void (a.on = false), starts: () => a.count };
  return a;
}

describe("a mix from the public account stopped at a mix that may have gone through (final review F2)", CHAINS, () => {
  it("never holds the collateral from a site: it's offered, and may be put up; what the mix spends is refused, saying it stopped", async () => {
    const { t, s, held } = await stoppedAtMix();
    expect(await reservedPublic(t)).toEqual({ inputs: held, collateral: [] });
    expect(await t.dapp.call(s, "getCollateral", [])).toHaveLength(1);
    // A site's transaction putting up the collateral goes to the prompt.
    const signing = t.dapp.call(s, "signTx", [siteTx([`${"e7".repeat(32)}#0`], [COLLATERAL]), false]);
    await until(() => t.dapp.approvals().length === 1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, false);
    await expect(signing).rejects.toMatchObject({ failure: { code: TxSignError.UserDeclined } });
    // One spending what the mix spends is refused unasked, and says the chain may have stopped there.
    await expect(t.dapp.call(s, "signTx", [siteTx([held[0]!], []), false])).rejects.toMatchObject({
      failure: { code: TxSignError.ProofGeneration, info: expect.stringContaining("or that one which stopped at a transaction that may have gone through still holds") },
    });
    expect(t.dapp.approvals()).toEqual([]);
  });

  it("is settled by the worker's runs with no page open, which keep the alarm meanwhile and let go of what it held", async () => {
    const { t, s, held } = await stoppedAtMix();
    const ring = alarm();
    // Not seen yet: the runs keep the alarm going for it, looking at most every PUBLIC_LOOK_MS.
    await busyFor(t, PUBLIC_LOOK_MS);
    await runNetworks(runner(t), ring);
    expect(ring.on).toBe(true);
    expect((await reservedPublic(t))?.inputs).toEqual(held);
    const looks = () => t.koios.calls.filter((c) => c.path === "tx_status").length;
    const before = looks();
    await runNetworks(runner(t), ring);
    expect(looks()).toBe(before);
    // It lands: the next look past PUBLIC_LOOK_MS settles it, nothing is held for it anymore, and the alarm stops.
    t.koios.confirmations = 1;
    await busyFor(t, PUBLIC_LOOK_MS);
    await runNetworks(runner(t), ring);
    expect(await reservedPublic(t)).toBeUndefined();
    expect(ring.on).toBe(false);
    const record = (await t.store.get<{ chains: Array<{ maybe?: unknown; sent: number }> }>("lovejoin.preprod"))!.chains.at(-1)!;
    expect(record.maybe).toBeUndefined();
    expect(record.sent).toBe(2);
    expect((await t.lovejoin.progress("preprod"))?.maybeSent).toBeUndefined();
    // And a site's transaction that spends what it held isn't refused for the chain anymore.
    let answer: unknown = "waiting";
    const signing = t.dapp.call(s, "signTx", [siteTx([held[0]!], []), false]).then(
      (v) => (answer = v),
      (e: unknown) => (answer = e),
    );
    await until(() => t.dapp.approvals().length === 1 || answer !== "waiting");
    if (t.dapp.approvals().length) await t.dapp.answer(t.dapp.approvals()[0]!.id, false);
    await signing;
    expect(JSON.stringify(answer)).not.toContain("Lovejoin");
  });
});
