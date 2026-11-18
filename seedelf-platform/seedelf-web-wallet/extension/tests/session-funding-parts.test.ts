// The owner, after 1.6.0's payments in parts: "if a user wants to sell X tokens on minswap but to fund the private one
// time flow it requires that tx to be split". A session's funding goes in parts when one transaction can't spend enough
// UTxOs: every part recorded before any is sent, sent one after another, and the session funded only once every one has
// landed: "if it requires y parts but y-k come in then its not complete and is basically equal to the one time account
// being not funded" (the owner, 2026-10-21). Short of one, nothing of it is swapped, and what came waits at the account
// for the user to bring back (the owner's call: offered, not automatic). Session 0 of the 12-word phrase, the real
// WebAssembly, a private balance of 40 small UTxOs of ADA alone, and the fakes of swap-session.ts.
import { blake2b } from "@noble/hashes/blake2.js";
import { describe, expect, it } from "vitest";

import { bodyOutpoints } from "../src/background/cbor";
import type { KoiosUtxo } from "../src/background/koios";
import { builtOutputs } from "../src/background/minswap";
import { partKey } from "../src/background/script-spend";
import { SESSION_OUT } from "../src/background/sessions";
import { outpoint, SESSION_SPENT } from "../src/background/spent";
import { txIdOf } from "./fixtures/cbor";
import { bytes, cbor, type Cbor, hex, ORDER_ADDRESS, ORDER_DATUM, SESSION_ADDRESS } from "./fixtures/swap-tx";
import { loadTestWasm, ownedUtxos, sessionSwap, testBalances, vectors } from "./fakes";
import { ASK, atSession, bookOf, busy, funded, PASSWORD, signing, type T } from "./swap-session";

const SLOW = { timeout: 180_000 };

/** The wallet with only `n` private UTxOs of ADA alone, `lovelace` each: more than one transaction spends to fund a swap. */
async function spread(n = 40, lovelace = "700000"): Promise<T> {
  const t = testBalances({ owned: false });
  const phrase = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase;
  await t.wallet.create(phrase, PASSWORD);
  const base = ownedUtxos[0]!;
  t.koios.added.push(...Array.from({ length: n }, (_, i) => ({ ...base, value: lovelace, tx_hash: (i + 1).toString(16).padStart(64, "0") })));
  return t;
}

const ids = (t: T) => t.koios.submitted.map((b) => txIdOf(b));

/** What the submitted transaction `id` paid session 0's account, as Koios would list it there. */
function paidTheAccount(t: T, id: string) {
  const bytes = t.koios.submitted.find((b) => txIdOf(b) === id)!;
  return builtOutputs(bytes).flatMap((o, i) => (o.address.slice(2, 58) === sessionSwap.keyHash ? [atSession(id, i, o.lovelace.toString())] : []));
}

/** Session 0's funding, built and sent; its parts' hashes. */
async function fundedInParts(sessions: ReturnType<typeof signing>) {
  const out = await sessions.outBuild("preprod", await sessions.quote("preprod", ASK));
  const parts = out.parts!.map((p) => p.txHash);
  await sessions.outSubmit("preprod", out.txHash);
  return { out, parts };
}

describe("a session's funding more UTxOs pay than one transaction spends (the owner's test of 1.6.0)", SLOW, () => {
  it("goes in parts: added up on its approval, every part recorded before any is sent, then sent one after another", async () => {
    const t = await spread();
    const sessions = signing(t);
    const out = await sessions.outBuild("preprod", await sessions.quote("preprod", ASK));
    expect(out.parts!.length).toBeGreaterThanOrEqual(2);
    expect(out.txHash).toBe(out.parts![0]!.txHash);
    // The swap's funding once, added up, and the account's collateral once, beside it.
    expect(out.payments.map((p) => p.lovelace).slice(1)).toEqual(["5000000"]);
    expect(out.inputs).toBe(out.parts!.reduce((n, p) => n + p.inputs, 0));
    expect(out.fee.total).toBe(out.parts!.reduce((n, p) => n + BigInt(p.fee), 0n).toString());
    for (const [i, p] of out.parts!.entries()) expect((await t.session.get<{ txHash: string }>(partKey(SESSION_OUT, i)))?.txHash).toBe(p.txHash);
    expect(t.koios.submitted).toEqual([]);

    await sessions.outSubmit("preprod", out.txHash);
    expect(ids(t)).toEqual(out.parts!.map((p) => p.txHash));
    const book = await bookOf(t);
    const s = book.sessions.find((r) => r.index === 0)! as unknown as { parts?: number; txs: Array<{ kind: string; txHash: string }> };
    expect(s.parts).toBe(out.parts!.length);
    expect(s.txs.map((x) => [x.kind, x.txHash])).toEqual(out.parts!.map((p) => ["out", p.txHash]));
    // What every part pays the account, between them: the swap's funding and its collateral, which the first pays.
    const paid = out.parts!.flatMap((p) => paidTheAccount(t, p.txHash));
    expect(paid.reduce((n, u) => n + BigInt(u.value), 0n).toString()).toBe(out.payments.reduce((n, p) => n + BigInt(p.lovelace), 0n).toString());
    expect(paidTheAccount(t, out.parts![0]!.txHash).some((u) => u.value === "5000000")).toBe(true);
  });

  it("waits for every part to land before it swaps: one in is still funding", async () => {
    const t = await spread();
    const sessions = signing(t);
    const { parts } = await fundedInParts(sessions);
    // The first lands; the second isn't on chain yet.
    t.koios.confirmations = 1;
    for (const p of parts.slice(1)) t.koios.missing.add(p);
    t.koios.addedToAccounts.push(...paidTheAccount(t, parts[0]!));
    let view = await sessions.advance("preprod", 0, true);
    expect(view.stage).toBe("funding");
    expect(view.parts).toEqual({ landed: 1, total: parts.length });
    expect(t.minswap.calls.filter((c) => c.path === "build-tx")).toHaveLength(0);
    expect(t.koios.submitted).toHaveLength(parts.length);

    // Every part in: it's funded, and the swap goes.
    for (const p of parts) t.koios.missing.delete(p);
    funded(t);
    await busy(t, 61_000);
    view = await sessions.advance("preprod", 0, true);
    expect(view.parts).toEqual({ landed: parts.length, total: parts.length });
    expect(t.minswap.calls.filter((c) => c.path === "build-tx").length).toBeGreaterThan(0);
    expect(view.txs.map((x) => x.kind)).toEqual([...parts.map(() => "out"), "swap"]);
  });

  it("short of a part that never lands, swaps nothing and waits for the user, who brings back what came", async () => {
    const t = await spread();
    const sessions = signing(t);
    const { parts } = await fundedInParts(sessions);
    t.koios.confirmations = 1;
    const lost = parts.at(-1)!;
    t.koios.missing.add(lost);
    t.koios.addedToAccounts.push(...parts.slice(0, -1).flatMap((p) => paidTheAccount(t, p)));
    // Not shown in 20 minutes, and nothing it paid is at the account: it never landed.
    await busy(t, 21 * 60_000);
    let view = await sessions.advance("preprod", 0, true);
    expect(view.stage).toBe("open");
    expect(view.parts).toEqual({ landed: parts.length - 1, total: parts.length, short: true });
    expect(view.auto!.paused).toMatchObject({ why: "short", landed: parts.length - 1, total: parts.length });
    expect(view.auto!.step).toBe("funding");
    expect(t.minswap.calls.filter((c) => c.path === "build-tx")).toHaveLength(0);
    // Try again finds it short again: nothing is swapped.
    view = await sessions.resume("preprod", 0);
    expect(view.auto!.paused).toMatchObject({ why: "short" });
    expect(t.minswap.calls.filter((c) => c.path === "build-tx")).toHaveLength(0);
    expect(t.koios.submitted).toHaveLength(parts.length);

    // Bring it back (Stop's dialog): what came comes back, never swapped.
    await busy(t, 5 * 60_000);
    view = await sessions.stop("preprod", 0, true);
    expect(view.txs.map((x) => x.kind)).toEqual([...parts.map(() => "out"), "back"]);
    expect(t.minswap.calls.filter((c) => c.path === "build-tx")).toHaveLength(0);
  });

  it("a missing part that lands after all lifts the pause, and the swap goes on", async () => {
    const t = await spread();
    const sessions = signing(t);
    const { parts } = await fundedInParts(sessions);
    t.koios.confirmations = 1;
    const late = parts.at(-1)!;
    t.koios.missing.add(late);
    t.koios.addedToAccounts.push(...parts.slice(0, -1).flatMap((p) => paidTheAccount(t, p)));
    await busy(t, 21 * 60_000);
    expect((await sessions.advance("preprod", 0, true)).auto!.paused).toMatchObject({ why: "short" });
    // It was only slow: a refresh finds what it paid at the account.
    t.koios.missing.delete(late);
    t.koios.addedToAccounts.push(...paidTheAccount(t, late));
    funded(t);
    const [view] = await sessions.list("preprod", true);
    expect(view!.auto!.paused).toBeUndefined();
    expect(view!.parts).toEqual({ landed: parts.length, total: parts.length });
  });

  it("a part the network refuses at Send: what went is watched, the rest never go, and it ends short", async () => {
    // Small enough for three parts.
    const t = await spread(70, "400000");
    let signed = 0;
    const wasm = loadTestWasm();
    const sessions = signing(t, {
      wasm: {
        ...wasm,
        signScriptSpend: (_key: unknown, request: string) => {
          // The second, signed, is refused when it's submitted.
          if (++signed === 2) t.koios.rejectSubmit = "Transaction Fails Validation";
          const { txCbor } = JSON.parse(request) as { txCbor: string };
          return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
        },
      } as typeof wasm,
    });
    const out = await sessions.outBuild("preprod", await sessions.quote("preprod", ASK));
    const parts = out.parts!.map((p) => p.txHash);
    await expect(sessions.outSubmit("preprod", out.txHash)).rejects.toThrow(
      new RegExp(`^1 of ${parts.length} transactions of its funding went\\. The rest didn't: .*Transaction Fails Validation.*`),
    );
    // The first went; the second was refused (the fake keeps what it was given); the third never went.
    expect(parts.length).toBeGreaterThanOrEqual(3);
    expect(ids(t)).toEqual(parts.slice(0, 2));
    t.koios.rejectSubmit = undefined;
    const book = await bookOf(t);
    expect(book.sessions[0]!.txs.map((x) => !!x.unsent)).toEqual(parts.map((_, i) => i > 0));
    // The first lands; the rest were turned away, and the chain has none of them: short, once it's settled.
    t.koios.confirmations = 1;
    for (const p of parts.slice(1)) t.koios.missing.add(p);
    t.koios.addedToAccounts.push(...paidTheAccount(t, parts[0]!));
    await busy(t, 3 * 60_000);
    const view = await sessions.advance("preprod", 0, true);
    expect(view.parts).toEqual({ landed: 1, total: parts.length, short: true });
    expect(view.auto!.paused).toMatchObject({ why: "short" });
  });

  it("parts that waited for the one before and won't go (parts.ts) leave it short at once, for the user to bring back", async () => {
    // 1.6.0, item 10b: a part of a funding that spends what the part before carried forward goes once that one is in
    // a block. Turned away then (or its parent never showing), the rest never go: the session hears it at once, rather
    // than once the runner misses them 20 minutes on.
    const t = await spread();
    const sessions = signing(t);
    const { parts } = await fundedInParts(sessions);
    t.koios.confirmations = 1;
    for (const p of parts.slice(1)) t.koios.missing.add(p);
    t.koios.addedToAccounts.push(...paidTheAccount(t, parts[0]!));
    await sessions.partsStopped("preprod", {
      hashes: parts,
      after: parts.map((_, i) => (i === 0 ? null : parts[i - 1]!)),
      sent: 1,
      at: t.clock.now,
      kind: "session-out",
      what: "payment",
      stopped: "refused",
      session: 0,
    });
    const book = await bookOf(t);
    expect(book.sessions[0]!.txs.map((x) => !!x.unsent)).toEqual(parts.map((_, i) => i > 0));
    await busy(t, 3 * 60_000);
    const view = await sessions.advance("preprod", 0, true);
    expect(view.parts).toEqual({ landed: 1, total: parts.length, short: true });
    expect(view.auto!.paused).toMatchObject({ why: "short" });
    expect(t.minswap.calls.filter((c) => c.path === "build-tx")).toHaveLength(0);
  });

  it("the first part refused: nothing went, and the session never started, as one transaction's funding", async () => {
    const t = await spread();
    const sessions = signing(t);
    t.koios.rejectSubmit = "Transaction Fails Validation";
    const out = await sessions.outBuild("preprod", await sessions.quote("preprod", ASK));
    await expect(sessions.outSubmit("preprod", out.txHash)).rejects.toThrow(/Transaction Fails Validation/);
    const [view] = await sessions.list("preprod");
    expect(view!.stage).toBe("failed");
    expect(view!.unsent).toBe(true);
  });
});

/** Minswap's swap from `inputs` at the account, shaped as swapTx's: its order at Minswap V1's script, and the change back. */
function swapFrom(inputs: KoiosUtxo[]): string {
  const order = 14_000_000;
  const fee = 205_189;
  const change = inputs.reduce((n, u) => n + Number(u.value), 0) - order - fee;
  expect(change).toBeGreaterThan(1_000_000);
  const spent = [...inputs]
    .sort((a, b) => (a.tx_hash === b.tx_hash ? a.tx_index - b.tx_index : a.tx_hash < b.tx_hash ? -1 : 1))
    .map((u): Cbor => [bytes(u.tx_hash), u.tx_index]);
  const body = new Map<number, Cbor>([
    [0, { tag: 258, of: spent }],
    [
      1,
      [
        new Map<number, Cbor>([
          [0, bytes(ORDER_ADDRESS)],
          [1, order],
          [2, [0, blake2b(bytes(ORDER_DATUM), { dkLen: 32 })]],
        ]),
        new Map<number, Cbor>([
          [0, bytes(SESSION_ADDRESS)],
          [1, change],
        ]),
      ],
    ],
    [2, fee],
    [3, 134_639_865],
  ]);
  const witnesses = new Map<number, Cbor>([[4, { tag: 258, of: [{ raw: ORDER_DATUM }] }]]);
  return hex(cbor([body, witnesses, true, null]));
}

/** Koios lists session 0's account from a backend behind the chain, without `behind`; its utxo_info still knows them. Returns the catch-up. */
function listingBehind(t: T, behind: Set<string>): () => void {
  const real = t.koios.fetch;
  t.koios.fetch = async (url, init) => {
    const answer = await real(url, init);
    const asked = init.body ? (JSON.parse(String(init.body)) as { _payment_credentials?: string[] }) : undefined;
    if (!url.includes("/credential_utxos") || !asked?._payment_credentials?.includes(sessionSwap.keyHash)) return answer;
    const rows = (await answer.json()) as KoiosUtxo[];
    return Response.json(rows.filter((u) => !behind.has(outpoint(u))));
  };
  return () => {
    t.koios.fetch = real;
  };
}

// Chunk 51, e7a#3: a swap funded in parts, every part on chain as tx_status says, while the account's listing (from a
// gateway backend behind the chain) doesn't show the last part's outputs yet. Minswap's build-tx picks the sender's
// UTxOs from its own, newer view and spends them too: the session's own funding, at its own key address, which
// utxo_info knows. It was read as another's, and the swap paused as "it spends something that isn't this session's".
// It's the session's own now (its parts' recorded `outs`), and a Stop meanwhile waits for them rather than bring them
// back in a second return, with a second fee.
describe("a swap funded in parts, its last part not listed yet (chunk 51, e7a#3)", SLOW, () => {
  /** Session 0 funded in parts, every part on chain, and Minswap's build spending what every part paid but the 5 ₳ collateral. */
  async function lagging() {
    const t = await spread();
    const sessions = signing(t);
    const { parts } = await fundedInParts(sessions);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(ids(t)).toEqual(parts);
    t.koios.confirmations = 1;
    const rows = parts.map((p) => paidTheAccount(t, p));
    t.koios.addedToAccounts.push(...rows.flat());
    const inputs = rows.flat().filter((u) => u.value !== "5000000");
    // Minswap's build spends the last part's output: the ADA it carries is part of what the order needs.
    expect(rows.at(-1)!.some((u) => inputs.includes(u))).toBe(true);
    const swap = swapFrom(inputs);
    t.minswap.swapCbor = swap;
    return { t, sessions, rows, swapId: txIdOf(bytes(swap)) };
  }

  it("places Minswap's swap from every part, the listing caught up or not, and never pauses it as spending another's", async () => {
    for (const behind of [false, true]) {
      const { t, sessions, rows, swapId } = await lagging();
      const caughtUp = behind ? listingBehind(t, new Set(rows.at(-1)!.map(outpoint))) : () => undefined;
      await busy(t, 61_000);
      const view = await sessions.advance("preprod", 0, true);
      expect(view.auto!.paused, `listing behind: ${behind}`).toBeUndefined();
      expect(ids(t)).toContain(swapId);
      caughtUp();
    }
  });

  it("still pauses a swap spending a part's output the wallet counts spent, as a copy built again would (final review sessions-2)", async () => {
    const { t, sessions, rows } = await lagging();
    listingBehind(t, new Set(rows.at(-1)!.map(outpoint)));
    // Something of the wallet's spent the last part's output already, and isn't on chain yet.
    await t.session.set(SESSION_SPENT, Object.fromEntries(rows.at(-1)!.map((u) => [outpoint(u), t.clock.now])));
    await busy(t, 61_000);
    const view = await sessions.advance("preprod", 0, true);
    expect(view.auto!.paused).toMatchObject({ why: "refused", detail: "it spends something that isn't this session's." });
  });

  it("brings everything back in one return when stopped meanwhile, once the listing catches up", async () => {
    const { t, sessions, rows } = await lagging();
    const caughtUp = listingBehind(t, new Set(rows.at(-1)!.map(outpoint)));
    await busy(t, 61_000);
    // Stopped before any order: no return leaves the last part's outputs behind for one of their own.
    let view = await sessions.stop("preprod", 0, true);
    expect(view.txs.map((x) => x.kind)).not.toContain("back");
    caughtUp();
    await busy(t, 61_000);
    view = await sessions.advance("preprod", 0, true);
    expect(view.txs.filter((x) => x.kind === "back")).toHaveLength(1);
    const back = t.koios.submitted.at(-1)!;
    for (const u of rows.flat()) expect(bodyOutpoints(back, 0)).toContain(outpoint(u));
    expect(t.minswap.calls.filter((c) => c.path === "build-tx")).toHaveLength(0);
  });
});
