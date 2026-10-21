// The owner, after 1.6.0's payments in parts: "if a user wants to sell X tokens on minswap but to fund the private one
// time flow it requires that tx to be split". A session's funding goes in parts when one transaction can't spend enough
// UTxOs: every part recorded before any is sent, sent one after another, and the session funded only once every one has
// landed: "if it requires y parts but y-k come in then its not complete and is basically equal to the one time account
// being not funded" (the owner, 2026-10-21). Short of one, nothing of it is swapped, and what came waits at the account
// for the user to bring back (the owner's call: offered, not automatic). Session 0 of the 12-word phrase, the real
// WebAssembly, a private balance of 40 small UTxOs of ADA alone, and the fakes of swap-session.ts.
import { describe, expect, it } from "vitest";

import { builtOutputs } from "../src/background/minswap";
import { partKey } from "../src/background/script-spend";
import { SESSION_OUT } from "../src/background/sessions";
import { txIdOf } from "./fixtures/cbor";
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
