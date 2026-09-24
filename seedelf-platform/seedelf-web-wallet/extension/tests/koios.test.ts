// The Koios client: request shape, paging and retries, with a fake fetch.
import { describe, expect, it } from "vitest";

import { Koios, KoiosError, type FetchLike } from "../src/background/koios";

const BASE = "https://preprod.koios.rest/api/v1";

function scripted(responses: Array<Response | Error>) {
  const calls: Array<{ url: string; body: any }> = [];
  const delays: number[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
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
    await expect(koios.credentialUtxos(["94bc"])).rejects.toThrow(new KoiosError("Koios answered 503 for credential_utxos."));
    expect(calls).toHaveLength(3);
  });

  it("doesn't retry a request Koios rejects", async () => {
    const { koios, calls } = scripted([new Response("bad", { status: 400 })]);
    await expect(koios.accountUtxos("x")).rejects.toThrow("Koios answered 400 for account_utxos.");
    expect(calls).toHaveLength(1);
  });
});
