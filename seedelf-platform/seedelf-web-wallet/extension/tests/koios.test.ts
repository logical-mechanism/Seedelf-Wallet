// The Koios client: request shape, paging and retries, with a fake fetch.
import { describe, expect, it } from "vitest";

import { Koios, KoiosError, type FetchLike } from "../src/background/koios";

const BASE = "https://preprod.koios.rest/api/v1";

function scripted(responses: Array<Response | Error>) {
  const calls: Array<{ url: string; body: any }> = [];
  const delays: number[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  };
  const koios = new Koios(BASE, fetchFn, async (ms) => void delays.push(ms));
  return { koios, calls, delays };
}

const rows = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ tx_hash: `${from + i}`, tx_index: 0 }));

describe("Koios client", () => {
  it("asks for extended UTxOs by payment credential, in a fixed order", async () => {
    const { koios, calls } = scripted([Response.json(rows(2))]);
    expect(await koios.credentialUtxos(["94bc"])).toHaveLength(2);
    expect(calls).toEqual([
      {
        url: `${BASE}/credential_utxos?order=tx_hash.asc,tx_index.asc&offset=0&limit=1000`,
        body: { _payment_credentials: ["94bc"], _extended: true },
      },
    ]);
  });

  it("pages 1000 rows at a time until a short page", async () => {
    const { koios, calls } = scripted([Response.json(rows(1000)), Response.json(rows(1000, 1000)), Response.json(rows(7, 2000))]);
    const all = await koios.accountUtxos("stake_test1u");
    expect(all).toHaveLength(2007);
    expect(calls.map((c) => new URL(c.url).searchParams.get("offset"))).toEqual(["0", "1000", "2000"]);
    expect(calls[0]!.body).toEqual({ _stake_addresses: ["stake_test1u"], _extended: true });
  });

  it("reads an account's used addresses, including empty ones", async () => {
    const { koios, calls } = scripted([
      Response.json([{ stake_address: "stake_test1u", addresses: ["addr_test1a", "addr_test1b"] }]),
      Response.json([]),
    ]);
    expect(await koios.accountAddresses("stake_test1u")).toEqual(["addr_test1a", "addr_test1b"]);
    expect(calls[0]!.body).toEqual({ _stake_addresses: ["stake_test1u"], _empty: true });
    expect(await koios.accountAddresses("stake_test1never")).toEqual([]);
  });

  it("explains a connection that fails, and a rate limit", async () => {
    const offline = scripted([new TypeError("Failed to fetch"), new TypeError("Failed to fetch"), new TypeError("Failed to fetch")]);
    await expect(offline.koios.accountUtxos("x")).rejects.toThrow(
      "Couldn't reach Koios, the service the wallet reads Cardano from (Failed to fetch). Check your internet connection",
    );
    const limited = scripted([429, 429, 429].map((status) => new Response("", { status })));
    await expect(limited.koios.accountUtxos("x")).rejects.toThrow("Koios is limiting requests from your connection");
  });

  it("retries rate limits, server errors and network failures, then succeeds", async () => {
    const { koios, delays } = scripted([new Response("", { status: 429 }), new TypeError("Failed to fetch"), Response.json(rows(1))]);
    expect(await koios.credentialUtxos(["94bc"])).toHaveLength(1);
    expect(delays).toEqual([1000, 3000]);
  });

  it("gives up after two retries with a readable error", async () => {
    const { koios, calls } = scripted([
      new Response("", { status: 503 }),
      new Response("", { status: 503 }),
      new Response("", { status: 503 }),
    ]);
    await expect(koios.credentialUtxos(["94bc"])).rejects.toThrow(
      new KoiosError("Koios is having trouble right now (503 for credential_utxos). Try again in a minute."),
    );
    expect(calls).toHaveLength(3);
  });

  it("doesn't retry a request Koios rejects", async () => {
    const { koios, calls } = scripted([new Response("bad", { status: 400 })]);
    await expect(koios.accountUtxos("x")).rejects.toThrow("Koios refused the request (400 for account_utxos).");
    expect(calls).toHaveLength(1);
  });
});

describe("Koios client: transactions", () => {
  it("reads the protocol parameters with a GET", async () => {
    const { koios, calls } = scripted([Response.json([{ epoch_no: 1, coins_per_utxo_size: "4310" }])]);
    expect(await koios.epochParams()).toEqual({ epoch_no: 1, coins_per_utxo_size: "4310" });
    expect(calls[0]!.url).toBe(`${BASE}/epoch_params?limit=1`);
  });

  it("submits CBOR bytes once, and reports a rejection", async () => {
    const sent: Array<{ url: string; init: RequestInit }> = [];
    const ok = new Koios(BASE, async (url, init) => (sent.push({ url, init }), Response.json("ab".repeat(32), { status: 202 })));
    expect(await ok.submitTx(new Uint8Array([0x84, 1]))).toBe("ab".repeat(32));
    expect(sent[0]!.url).toBe(`${BASE}/submittx`);
    expect(sent[0]!.init.headers).toEqual({ "content-type": "application/cbor" });

    let tries = 0;
    const rejected = new Koios(BASE, async () => (tries++, new Response("ValueNotConserved", { status: 400 })));
    await expect(rejected.submitTx(new Uint8Array([0x84]))).rejects.toThrow("The network rejected the transaction: ValueNotConserved");
    const busy = new Koios(BASE, async () => (tries++, new Response("", { status: 503 })));
    await expect(busy.submitTx(new Uint8Array([0x84]))).rejects.toThrow("rejected");
    expect(tries).toBe(2); // never retried
  });

  it("has Ogmios evaluate a draft, and passes on why the scripts refused", async () => {
    const result = { jsonrpc: "2.0", method: "evaluateTransaction", result: [] };
    const error = { jsonrpc: "2.0", method: "evaluateTransaction", error: { code: 3010, message: "Some scripts…" } };
    const { koios, calls, delays } = scripted([
      Response.json(result),
      new Response("", { status: 503 }),
      Response.json(error, { status: 400 }),
    ]);
    expect(await koios.evaluate("84a4")).toEqual(result);
    expect(calls[0]).toEqual({
      url: `${BASE}/ogmios`,
      body: { jsonrpc: "2.0", method: "evaluateTransaction", params: { transaction: { cbor: "84a4" } } },
    });
    // A server hiccup is retried; a 400 is Ogmios's answer, not a failure.
    expect(await koios.evaluate("84a4")).toEqual(error);
    expect(delays).toEqual([1000]);
    const refused = scripted([new Response("", { status: 404 })]);
    await expect(refused.koios.evaluate("84a4")).rejects.toThrow("Koios refused the request (404 for ogmios)");
  });

  it("reads confirmations", async () => {
    const { koios, calls } = scripted([Response.json([{ tx_hash: "aa", num_confirmations: 3 }, { tx_hash: "bb", num_confirmations: null }])]);
    const status = await koios.txStatus(["aa", "bb"]);
    expect([...status]).toEqual([["aa", 3], ["bb", null]]);
    expect(calls[0]!.body).toEqual({ _tx_hashes: ["aa", "bb"] });
  });
});
