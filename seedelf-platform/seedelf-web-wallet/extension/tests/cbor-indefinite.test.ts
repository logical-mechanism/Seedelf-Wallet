// Chunk 51, gap-g8#5 (the verifier's test). The worker's CBOR reader (src/background/cbor.ts) took a transaction only
// as a definite four-item array (`tx[0] !== 0x84`, in bodyField and txId) with a definite body map (bodyField's
// `body.indefinite`). One written 9f … ff, or with its body bf … ff, is well-formed CBOR that the ledger decodes
// (decodeRecordNamed and decodeSparse take either length) and hashes as written, and WebAssembly reads it too (Pallas's
// derived decoders, core's tx_id, decode.rs). So a site's signTx of either was refused unread ("The wallet can't read
// this transaction."), and so was its submitTx of the first. Its submitTx of the second went out, but nothing of it
// was kept: keepSent's rememberSiteSpent read its inputs with txInputs, which threw, and keepSent swallowed that.
// Each case asserts what the ledger and WebAssembly do: they failed while cbor.ts read one form only.

import { blake2b } from "@noble/hashes/blake2.js";
import { describe, expect, it } from "vitest";

import { skip, txId, txInputs } from "../src/background/cbor";
import { SESSION_DAPP_SIGNED, type DappError, type DappSession } from "../src/background/dapp";
import { SESSION_SEND } from "../src/background/send";
import { SESSION_SPENT_SITES } from "../src/background/spent";
import { APIError, TxSignError } from "../src/shared/dapp";
import { loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const bytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));
const toHex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const hash = (hex: string) => toHex(blake2b(bytes(hex), { dkLen: 32 }));
/** What a read gives, or what it throws, so that one comparison shows every case. */
const read = (f: () => unknown) => {
  try {
    return f();
  } catch (e) {
    return `throws: ${(e as Error).message}`;
  }
};
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("gap-g8#5: a transaction written with indefinite lengths", { timeout: 30_000 }, () => {
  it("is read as WebAssembly reads it: the same inputs, and the id of its body as written", () => {
    const input = "ab".repeat(32);
    // A body of three fields: one input, no outputs, no fee.
    const fields = `0081825820${input}00` + "0180" + "0200";
    const definiteBody = `a3${fields}`;
    const indefiniteBody = `bf${fields}ff`;
    const definite = `84${definiteBody}a0f5f6`;
    const indefiniteArray = `9f${definiteBody}a0f5f6ff`;
    const indefiniteMap = `84${indefiniteBody}a0f5f6`;
    const bothIndefinite = `9f${indefiniteBody}a0f5f6ff`;

    // WebAssembly reads all four today, each with the hash of its body as written.
    const wasm = loadTestWasm();
    const idOf = (tx: string) => (JSON.parse(wasm.decodeTx(wasm.Network.Preprod, tx)) as { txHash: string }).txHash;
    expect([definite, indefiniteArray, indefiniteMap, bothIndefinite].map(idOf)).toEqual([
      hash(definiteBody),
      hash(definiteBody),
      hash(indefiniteBody),
      hash(indefiniteBody),
    ]);
    // Both at once, as the ledger reads it too.
    expect([read(() => txInputs(bytes(bothIndefinite))), read(() => txId(bytes(bothIndefinite)))]).toEqual([
      [`${input}#0`],
      hash(indefiniteBody),
    ]);

    // The worker's reader, which a site's signTx (bodyOutpoints) and submitTx (txId) go through first.
    expect(read(() => txInputs(bytes(definite)))).toEqual([`${input}#0`]);
    expect({
      arrayInputs: read(() => txInputs(bytes(indefiniteArray))),
      arrayId: read(() => txId(bytes(indefiniteArray))),
      mapInputs: read(() => txInputs(bytes(indefiniteMap))),
      mapId: read(() => txId(bytes(indefiniteMap))),
    }).toEqual({
      arrayInputs: [`${input}#0`],
      arrayId: hash(definiteBody),
      mapInputs: [`${input}#0`],
      mapId: hash(indefiniteBody),
    });

    // What isn't whole still throws, rather than read past the end or loop (cbor.test.ts's "84bf").
    for (const cut of ["9f", "9fbf", "9fbf00", "84bf", "84bf00"]) {
      expect(() => txId(bytes(cut)), cut).toThrow();
      expect(() => txInputs(bytes(cut)), cut).toThrow();
    }
  });

  it("reaches the user from a site's signTx, with the id WebAssembly signs, and goes out from its submitTx, kept", async () => {
    const t = testBalances();
    await t.wallet.create(account(12).phrase, PASSWORD);
    await t.preferences.set({ dappConnector: true, spendRewards: false });
    const s: DappSession = { id: "gap-g8-5", origin: "https://app.example.com", title: "Example" };
    const enabling = t.dapp.call(s, "enable", []);
    for (let i = 0; i < 200 && t.dapp.approvals().length === 0; i++) await tick();
    await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
    expect(await enabling).toBe(true);

    // A payment from the account as the wallet's own Send builds it, definite throughout, then written both ways.
    const sent = await t.send.build("preprod", [{ to: account(15).preprod.receive_0 as string, lovelace: "3000000", tokens: [] }]);
    const tx = (await t.session.get<{ txCbor: string }>(SESSION_SEND))!.txCbor;
    const b = bytes(tx);
    expect([b[0], b[1]! >> 5, (b[1]! & 0x1f) < 24]).toEqual([0x84, 5, true]);
    const end = 2 * skip(b, 1);
    const asArray = `9f${tx.slice(2)}ff`;
    const asMapBody = `bf${tx.slice(4, end)}ff`;
    const asMap = `84${asMapBody}${tx.slice(end)}`;

    /** A site's signTx: the prompt's transaction id (then declined), or what the site heard instead. */
    const asked = async (cbor: string) => {
      let heard: unknown;
      const signing = t.dapp.call(s, "signTx", [cbor, false]).then(
        () => undefined,
        (e: DappError) => void (heard = e.failure),
      );
      for (let i = 0; i < 2000 && t.dapp.approvals().length === 0 && heard === undefined; i++) await tick();
      const approval = t.dapp.approvals()[0];
      if (!approval) return { heard };
      if (approval.kind !== "sign-tx") throw new Error(approval.kind);
      await t.dapp.answer(approval.id, false);
      await signing;
      expect(heard).toMatchObject({ code: TxSignError.UserDeclined });
      return { txHash: approval.summary.txHash };
    };
    /** A site's submitTx: whether it reached Koios, and what the site heard. */
    const submitted = async (cbor: string) => {
      const before = t.koios.submitted.length;
      const heard = await t.dapp.call(s, "submitTx", [cbor]).then(
        (id) => id,
        (e: DappError) => e.failure,
      );
      const unread = typeof heard === "object" && (heard as { code?: number }).code === APIError.InvalidRequest;
      return { reachedKoios: t.koios.submitted.slice(before).map(toHex).includes(cbor), refusedUnread: unread ? heard : false, heard };
    };
    /** Whether the wallet keeps what a site's transaction spends (spent.ts), and its record (keepSent). */
    const keptOf = async (id: string) => {
      const spent = (await t.session.get<Record<string, number>>(SESSION_SPENT_SITES)) ?? {};
      const records = (await t.session.get<Array<{ txHash: string }>>(SESSION_DAPP_SIGNED + "preprod")) ?? [];
      return { spent: txInputs(b).every((o) => o in spent), record: records.some((r) => r.txHash === id) };
    };

    const results = {
      signArray: await asked(asArray),
      signMap: await asked(asMap),
      submitMap: await submitted(asMap),
      keptMap: await keptOf(hash(asMapBody)),
      submitArray: await submitted(asArray),
    };
    expect(results).toMatchObject({
      // The same body as the definite form's: the same id.
      signArray: { txHash: sent.txHash },
      // The body as written.
      signMap: { txHash: hash(asMapBody) },
      // Sent, and its id heard (it is today)...
      submitMap: { reachedKoios: true, refusedUnread: false, heard: hash(asMapBody) },
      // ...and what it spends, and its record, kept.
      keptMap: { spent: true, record: true },
      // Sent, rather than refused unread.
      submitArray: { reachedKoios: true, refusedUnread: false },
    });
  });
});
