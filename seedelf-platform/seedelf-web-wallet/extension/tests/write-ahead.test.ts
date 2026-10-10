// A payment is in the watch as maybe sent before it goes to Koios: sealed,
// its UTxOs held back, and kept to go again as it is (independent review
// M1). A lock, a closed browser or a stopped worker while Koios is asked
// then can't lose it: it's put back at the unlock, new payments wait for
// it, and it goes into the history once it's seen. A refusal takes it all
// back, so a payment that never went out holds nothing.
import { describe, expect, it } from "vitest";

import { txInputs } from "../src/background/cbor";
import { Collateral } from "../src/background/collateral";
import { KoiosBusyError } from "../src/background/koios";
import { MAYBE_SENT_WAIT, pendingKey } from "../src/background/pending";
import { SESSION_SEND } from "../src/background/send";
import { recentlySent } from "../src/background/sent-txs";
import { lastSpentAt, SESSION_SPENT, spentSet } from "../src/background/spent";
import { WithdrawService } from "../src/background/withdraw";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
const THEIRS = account(15).preprod.receive_0 as string;
const SEALED = "seedelf.private.maybeSent.preprod";
const SPENT = "ConwayUtxowFailure (UtxoFailure (BadInputsUTxO (fromList [])))";

async function unlocked() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  return t;
}

type T = Awaited<ReturnType<typeof unlocked>>;

const pay = (t: T) => t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
const ids = (t: T) => t.koios.submitted.map((b) => txIdOf(b));

/**
 * The next submit reaches Koios (the fake records it), and `during` runs
 * while it's there: a lock, say. Then Koios answers as it would
 * (`answer: "taken"`), doesn't (`"timeout"`), or refuses it (`"refused"`).
 */
function whileAsked(t: T, during: () => Promise<unknown>, answer: "taken" | "timeout" | "refused") {
  const real = t.koios.fetch;
  let armed = true;
  t.koios.fetch = async (url, init) => {
    if (!armed || !url.endsWith("/submittx")) return real(url, init);
    armed = false;
    await during();
    if (answer === "refused") return new Response("ConwayUtxowFailure (UtxoFailure (ValueNotConservedUTxO))", { status: 400 });
    const taken = await real(url, init);
    if (answer === "timeout") throw new DOMException("signal timed out", "TimeoutError");
    return taken;
  };
}

/** The withdraw service with giveme.my's witness and WebAssembly's signing stood in for, as maybe-sent.test.ts has it. */
function privately(t: T) {
  const wasm = loadTestWasm();
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  return new WithdrawService({
    ...t.deps,
    wasm: {
      ...wasm,
      signScriptSpend: (_key: unknown, request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
  });
}

describe("a payment, before it goes to Koios", () => {
  it("is watched as maybe sent, sealed, its UTxOs held back and kept to go again as it is", async () => {
    const t = await unlocked();
    const summary = await pay(t);
    const seen: Record<string, unknown> = {};
    whileAsked(
      t,
      async () => {
        seen.watch = await t.session.get(pendingKey("preprod"));
        seen.sealed = await t.store.get("maybeSent.preprod");
        seen.spent = await spentSet(t.session);
        seen.kept = await t.session.get(SESSION_SEND);
      },
      "taken",
    );
    const pending = await t.send.submit("preprod", summary.txHash);
    expect(seen.watch).toMatchObject({ txHash: summary.txHash, maybeSent: true });
    expect(seen.sealed).toMatchObject({ txHash: summary.txHash, maybeSent: true });
    expect(seen.spent).toEqual(new Set(txInputs(t.koios.submitted[0]!)));
    expect(seen.kept).toHaveProperty("sentCbor");

    // Taken: an ordinary sent payment, nothing sealed any more.
    expect(pending).not.toHaveProperty("maybeSent");
    expect(await t.session.get(pendingKey("preprod"))).not.toHaveProperty("maybeSent");
    expect(t.local.data.has(SEALED)).toBe(false);
    expect(await t.session.get(SESSION_SEND)).toBeUndefined();
  });

  it("is still watched after a lock while Koios didn't answer: new payments wait, and its UTxOs stay held back", async () => {
    const t = await unlocked();
    const summary = await pay(t);
    whileAsked(t, () => t.wallet.lock(), "timeout");
    await t.send.submit("preprod", summary.txHash).catch(() => undefined);
    expect(t.local.data.has(SEALED)).toBe(true);

    await t.wallet.unlock(PASSWORD);
    expect(await t.pending.pending("preprod")).toMatchObject({ txHash: summary.txHash, maybeSent: true });
    expect(await spentSet(t.session)).toEqual(new Set(txInputs(t.koios.submitted[0]!)));
    await expect(pay(t)).rejects.toThrow(MAYBE_SENT_WAIT());
    // It lands: new payments go ahead, and only the one went out.
    t.koios.confirmations = 1;
    await expect(pay(t)).resolves.toBeDefined();
    expect(ids(t)).toEqual([summary.txHash]);
  });

  it("is still watched after a lock while Koios took it, and a private one goes into the history once it's seen", async () => {
    const t = await unlocked();
    const withdraw = privately(t);
    const summary = await withdraw.build("preprod", [{ to: THEIRS, lovelace: "5000000", tokens: [] }]);
    whileAsked(t, () => t.wallet.lock(), "taken");
    await expect(withdraw.submit("preprod", summary.txHash)).rejects.toThrow("locked");

    await t.wallet.unlock(PASSWORD);
    expect(await t.pending.pending("preprod")).toMatchObject({ txHash: summary.txHash, maybeSent: true });
    await expect(withdraw.build("preprod", [{ to: THEIRS, lovelace: "5000000", tokens: [] }])).rejects.toThrow(MAYBE_SENT_WAIT());
    t.koios.confirmations = 1;
    expect(await t.pending.pending("preprod")).toMatchObject({ txHash: summary.txHash, confirmations: 1 });
    expect(await t.activity.seedelf("preprod")).toMatchObject([{ kind: "withdraw", txHash: summary.txHash }]);
    expect(t.local.data.has(SEALED)).toBe(false);
  });

  it("is still watched after the browser closed while Koios was asked", async () => {
    const t = await unlocked();
    const summary = await pay(t);
    // The browser closes: session storage goes, and nothing after the fetch runs.
    whileAsked(t, () => t.session.clear(), "timeout");
    await t.send.submit("preprod", summary.txHash).catch(() => undefined);
    await t.wallet.unlock(PASSWORD);
    await expect(pay(t)).rejects.toThrow(MAYBE_SENT_WAIT());
    expect(await t.pending.pending("preprod")).toMatchObject({ txHash: summary.txHash, maybeSent: true });
  });

  it("goes again as it is after the worker stopped while Koios was asked: Send again sends the same bytes", async () => {
    const t = await unlocked();
    const summary = await pay(t);
    // The worker stops: its submit never comes back, and session storage stays.
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => {
      if (!url.endsWith("/submittx")) return real(url, init);
      await real(url, init);
      return new Promise<Response>(() => undefined);
    };
    void t.send.submit("preprod", summary.txHash);
    await new Promise((r) => setTimeout(r, 50));
    t.koios.fetch = real;
    expect(await t.pending.pending("preprod")).toMatchObject({ txHash: summary.txHash, maybeSent: true });
    // In a mempool already: refused as spent, and still maybe sent.
    t.koios.rejectSubmit = SPENT;
    expect(await t.send.submit("preprod", summary.txHash)).toMatchObject({ txHash: summary.txHash, maybeSent: true });
    expect(ids(t)).toEqual([summary.txHash, summary.txHash]);
  });
});

describe("a payment refused", () => {
  it("never went out: nothing is watched, sealed or held back, and it's kept as reviewed", async () => {
    const t = await unlocked();
    const summary = await pay(t);
    whileAsked(t, async () => undefined, "refused");
    await expect(t.send.submit("preprod", summary.txHash)).rejects.toThrow("The network rejected the transaction");
    expect(await t.session.get(pendingKey("preprod"))).toBeUndefined();
    expect(t.local.data.has(SEALED)).toBe(false);
    expect(await spentSet(t.session)).toEqual(new Set());
    expect(await t.session.get(SESSION_SEND)).toMatchObject({ txHash: summary.txHash });
    expect(await t.session.get(SESSION_SEND)).not.toHaveProperty("sentCbor");
    await expect(pay(t)).resolves.toBeDefined();
  });

  it("after a lock mid-submit leaves nothing sealed either, so nothing waits for it after the unlock", async () => {
    const t = await unlocked();
    const summary = await pay(t);
    whileAsked(t, () => t.wallet.lock(), "refused");
    await expect(t.send.submit("preprod", summary.txHash)).rejects.toThrow("The network rejected the transaction");
    expect(t.local.data.has(SEALED)).toBe(false);
    await t.wallet.unlock(PASSWORD);
    expect(await t.pending.pending("preprod")).toBeNull();
    await expect(pay(t)).resolves.toBeDefined();
  });

  it("after a lock and an unlock mid-submit, with nothing looking since, leaves nothing sealed: nothing waits for it", async () => {
    const t = await unlocked();
    const summary = await pay(t);
    whileAsked(
      t,
      async () => {
        await t.wallet.lock();
        await t.wallet.unlock(PASSWORD);
      },
      "refused",
    );
    await expect(t.send.submit("preprod", summary.txHash)).rejects.toThrow("The network rejected the transaction");
    expect(t.local.data.has(SEALED)).toBe(false);
    expect(await t.pending.pending("preprod")).toBeNull();
    await expect(pay(t)).resolves.toBeDefined();
  });

  it("after a lock mid-submit, leaves a sealed copy written since as it is", async () => {
    const t = await unlocked();
    const summary = await pay(t);
    let since: unknown;
    whileAsked(
      t,
      async () => {
        await t.wallet.lock();
        await t.wallet.unlock(PASSWORD);
        // Something else sealed over it meanwhile: not the write that was refused, so it stays.
        since = { ...(await t.store.get<object>("maybeSent.preprod")), txHash: "cd".repeat(32) };
        await t.store.set("maybeSent.preprod", since);
      },
      "refused",
    );
    await expect(t.send.submit("preprod", summary.txHash)).rejects.toThrow("The network rejected the transaction");
    expect(await t.store.get("maybeSent.preprod")).toEqual(since);
  });

  it("isn't taken back when Koios only asked the wallet to slow down: it never passed it on", async () => {
    const t = await unlocked();
    const summary = await pay(t);
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => (url.endsWith("/submittx") ? new Response("", { status: 429 }) : real(url, init));
    await expect(t.send.submit("preprod", summary.txHash)).rejects.toThrow("The server is limiting requests");
    expect(t.local.data.has(SEALED)).toBe(false);
    expect(await t.session.get(pendingKey("preprod"))).toBeUndefined();
    t.koios.fetch = real;
    // Sent again, it goes: the same review, not a new one.
    expect(await t.send.submit("preprod", summary.txHash)).toMatchObject({ txHash: summary.txHash, confirmations: null });
  });
});

// A refusal puts back what writing ahead wrote over, as it was before the
// Send: what another transaction had spent, and the watch of the payment
// before it. A lock meanwhile took those, and they stay gone.
describe("a payment refused, beside what was there before it", () => {
  const inputsOf = async (t: T) => {
    const { txCbor } = (await t.session.get<{ txCbor: string }>(SESSION_SEND))!;
    return txInputs(Uint8Array.from(Buffer.from(txCbor, "hex")));
  };

  it("keeps what another transaction had spent of its UTxOs, and when: they're still left out, and still its send", async () => {
    const t = await unlocked();
    const summary = await pay(t);
    const [input] = await inputsOf(t);
    // Another window's payment spent that UTxO after the review, and was recorded so.
    const at = Date.now() - 60_000;
    await t.session.set(SESSION_SPENT, { [input!]: at });
    t.koios.rejectSubmit = SPENT;
    await expect(t.send.submit("preprod", summary.txHash)).rejects.toThrow("already spent");
    expect(await t.session.get(SESSION_SPENT)).toEqual({ [input!]: at });
    expect(await lastSpentAt(t.session)).toBe(at);
    // Nor is it kept as sent, for a site to build on.
    expect((await recentlySent(t.session, "preprod")).map((s) => s.txHash)).not.toContain(summary.txHash);
  });

  it("keeps what another transaction spent of its UTxOs while Koios was asked, and when", async () => {
    const t = await unlocked();
    const summary = await pay(t);
    const [input] = await inputsOf(t);
    // A site's transaction that spends the same UTxO goes in while this one is asked, and is recorded so.
    const at = Date.now() + 60_000;
    whileAsked(
      t,
      () =>
        t.wallet.withKeys(async () => {
          const spent = (await t.session.get<Record<string, number>>(SESSION_SPENT)) ?? {};
          await t.session.set(SESSION_SPENT, { ...spent, [input!]: at });
        }),
      "refused",
    );
    await expect(t.send.submit("preprod", summary.txHash)).rejects.toThrow("The network rejected the transaction");
    expect(await t.session.get(SESSION_SPENT)).toEqual({ [input!]: at });
    expect(await lastSpentAt(t.session, at)).toBe(at);
  });

  it("leaves the watch of the payment before it, taken and waiting for the chain", async () => {
    const t = await unlocked();
    const first = await pay(t);
    const taken = await t.send.submit("preprod", first.txHash);
    expect(taken).toMatchObject({ txHash: first.txHash, confirmations: null });
    const held = await spentSet(t.session);

    const second = await pay(t);
    whileAsked(t, async () => undefined, "refused");
    await expect(t.send.submit("preprod", second.txHash)).rejects.toThrow("The network rejected the transaction");
    expect(await t.session.get(pendingKey("preprod"))).toMatchObject({ txHash: first.txHash, confirmations: null });
    expect(await t.session.get(pendingKey("preprod"))).not.toHaveProperty("maybeSent");
    expect(await t.pending.pending("preprod")).toMatchObject({ txHash: first.txHash, confirmations: null });
    expect(await spentSet(t.session)).toEqual(held);
    t.koios.confirmations = 1;
    expect(await t.pending.pending("preprod")).toMatchObject({ txHash: first.txHash, confirmations: 1 });
  });

  it("puts back nothing from before a lock that came while Koios was asked", async () => {
    const t = await unlocked();
    const first = await pay(t);
    await t.send.submit("preprod", first.txHash);
    const second = await pay(t);
    whileAsked(
      t,
      async () => {
        await t.wallet.lock();
        await t.wallet.unlock(PASSWORD);
        // Home looks as the wallet opens: the payment is put back from its sealed copy.
        await t.pending.pending("preprod");
      },
      "refused",
    );
    await expect(t.send.submit("preprod", second.txHash)).rejects.toThrow("The network rejected the transaction");
    expect(await t.session.get(pendingKey("preprod"))).toBeUndefined();
    expect(await spentSet(t.session)).toEqual(new Set());
    expect(t.local.data.has(SEALED)).toBe(false);
  });
});

describe("a payment Koios answers with another transaction id", () => {
  it("stays maybe sent, and says so: nothing takes it for one that never went out", async () => {
    const t = await unlocked();
    const summary = await pay(t);
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => {
      if (!url.endsWith("/submittx")) return real(url, init);
      await real(url, init);
      return Response.json("ab".repeat(32), { status: 202 });
    };
    const e = await t.send.submit("preprod", summary.txHash).catch((e: unknown) => e);
    expect(e).toBeInstanceOf(KoiosBusyError);
    expect((e as KoiosBusyError).maybeSent).toBe(true);
    expect(await t.session.get(pendingKey("preprod"))).toMatchObject({ txHash: summary.txHash, maybeSent: true });
    expect(t.local.data.has(SEALED)).toBe(true);
    await expect(pay(t)).rejects.toThrow(MAYBE_SENT_WAIT());
  });
});
