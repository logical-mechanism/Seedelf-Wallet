// The data layer's fallback (chunk 26b, Step 2): mainnet reads and submits go
// to the wallet's own server first, and each part to Koios on its own when it
// can't answer, for 5 minutes. A call that fails runs again from its start on
// Koios, so a paged read never mixes the two.
import { describe, expect, it } from "vitest";

import {
  chainClient,
  dataCost,
  DataLayerKoios,
  DataParts,
  DOWN_MS,
  SESSION_DATA_DOWN,
  type DataDeps,
} from "../src/background/data-layer";
import { Koios, KoiosBusyError, RateLimit, SpentInputError, SpentMaybeSentError } from "../src/background/koios";
import { memoryArea } from "./fakes";

const DATA = "https://data.test";
const KOIOS = "https://api.koios.rest";
const TX = "ab".repeat(32);

type Answer = Response | (() => Response) | "unreachable" | "timeout";

/** Two servers on one fetch: the data layer answers what each path is told to, Koios answers every read. */
function servers() {
  const calls: Array<{ host: string; path: string; query: string }> = [];
  const data = new Map<string, Answer>();
  const koios = new Map<string, Answer>();
  const fetch = async (url: string) => {
    const u = new URL(url);
    const host = u.origin;
    const path = u.pathname.split("/").pop()!;
    calls.push({ host, path, query: u.searchParams.toString() });
    const answer = (host === DATA ? data : koios).get(path) ?? Response.json([{ abs_slot: host === DATA ? 1 : 2 }]);
    if (answer === "unreachable") throw new TypeError("Failed to fetch");
    if (answer === "timeout") throw new DOMException("signal timed out", "TimeoutError");
    return typeof answer === "function" ? answer() : answer.clone();
  };
  return { calls, data, koios, fetch, hosts: () => calls.map((c) => c.host) };
}

function client(s: ReturnType<typeof servers>, opts: Partial<DataDeps> = {}) {
  const clock = { now: 1_800_000_000_000 };
  const session = memoryArea();
  const prefs = { koiosOnly: false };
  const deps: DataDeps = {
    koiosOnly: async () => prefs.koiosOnly,
    parts: new DataParts(session, () => clock.now),
    fetch: s.fetch,
    sleep: async () => undefined,
    limits: {},
    ...opts,
  };
  const make = chainClient(deps, (n) => (n === "mainnet" ? DATA : undefined));
  return { make, clock, session, prefs, deps };
}

const error = (status: number, words: string, headers: Record<string, string> = {}) =>
  Response.json({ error: words }, { status, headers });

describe("the data layer's client", () => {
  it("is plain Koios on preprod, and the data layer's wrapper on mainnet", async () => {
    const s = servers();
    const { make } = client(s);
    expect(make("preprod")).not.toBeInstanceOf(DataLayerKoios);
    expect(await make("preprod").tipSlot()).toBe(2);
    expect(make("mainnet")).toBeInstanceOf(DataLayerKoios);
    expect(await make("mainnet").tipSlot()).toBe(1);
    expect(s.calls.map((c) => [new URL(c.host).host, c.path])).toEqual([
      ["preprod.koios.rest", "tip"],
      ["data.test", "tip"],
    ]);
  });

  it("asks the data layer the very request it asks Koios, under /api/v1", async () => {
    const urls: string[] = [];
    const fetch = async (url: string) => {
      urls.push(url);
      return Response.json([]);
    };
    const { make } = client({ ...servers(), fetch } as never);
    await make("mainnet").poolList();
    await new Koios(`${KOIOS}/api/v1`, fetch).poolList();
    expect(urls[0]!.replace(DATA, KOIOS)).toBe(urls[1]);
  });

  it("reads Koios alone with the switch on, read at each request", async () => {
    const s = servers();
    const { make, prefs } = client(s);
    const koios = make("mainnet");
    prefs.koiosOnly = true;
    expect(await koios.tipSlot()).toBe(2);
    prefs.koiosOnly = false;
    expect(await koios.tipSlot()).toBe(1);
    expect(s.hosts()).toEqual([KOIOS, DATA]);
  });

  const triggers: Array<[string, Answer]> = [
    ["no answer", "unreachable"],
    ["a timeout", "timeout"],
    ["a 500", new Response("oops", { status: 500 })],
    ["a 502", new Response("", { status: 502 })],
    ["a 503", error(503, "unavailable", { "retry-after": "30" })],
    ["a 403: an origin the API doesn't know", error(403, "forbidden")],
    ["a 400 for a request the API doesn't take", error(400, "not a request Seedelf Wallet makes")],
    ["an answer that isn't JSON", new Response("<html>", { status: 200 })],
  ];

  it.each(triggers)("sends a read to Koios on %s, and the public side with it for 5 minutes", async (_, answer) => {
    const s = servers();
    s.data.set("tip", answer);
    const { make, clock } = client(s);
    expect(await make("mainnet").tipSlot()).toBe(2);
    expect(s.hosts()).toEqual([DATA, KOIOS]);
    // Down: straight to Koios, without asking the data layer first.
    clock.now += DOWN_MS - 1;
    expect(await make("mainnet").tipSlot()).toBe(2);
    expect(s.hosts()).toEqual([DATA, KOIOS, KOIOS]);
    // Then the data layer again.
    s.data.delete("tip");
    clock.now += 1;
    expect(await make("mainnet").tipSlot()).toBe(1);
    expect(s.hosts()).toEqual([DATA, KOIOS, KOIOS, DATA]);
  });

  it("holds a 429's Retry-After when it's longer than 5 minutes", async () => {
    const s = servers();
    s.data.set("tip", error(429, "slow down", { "retry-after": "600" }));
    const { make, clock, session } = client(s);
    await make("mainnet").tipSlot();
    s.data.delete("tip");
    clock.now += DOWN_MS + 1;
    await make("mainnet").tipSlot();
    expect(s.hosts()).toEqual([DATA, KOIOS, KOIOS]);
    expect(await session.get(SESSION_DATA_DOWN)).toEqual({ public: 1_800_000_000_000 + 600_000 });
    clock.now += 600_000;
    await make("mainnet").tipSlot();
    expect(s.hosts().at(-1)).toBe(DATA);
  });

  it("sends one too large for this server to Koios for that call alone", async () => {
    const s = servers();
    s.data.set("credential_utxos", error(503, "too large for this server"));
    const { make } = client(s);
    expect(await make("mainnet").credentialUtxos(["aa".repeat(28)])).toMatchObject([{ abs_slot: 2 }]);
    expect(await make("mainnet").tipSlot()).toBe(1);
    expect(s.hosts()).toEqual([DATA, KOIOS, DATA]);
  });

  it("reads a paged answer again from its first page on Koios, never mixing the two", async () => {
    const s = servers();
    const row = (i: number) => ({ tx_hash: i.toString(16).padStart(64, "0"), tx_index: 0, inline_datum: null });
    let page = 0;
    s.data.set("credential_utxos", () => (page++ === 0 ? Response.json(Array.from({ length: 1000 }, (_, i) => row(i))) : new Response("", { status: 504 })));
    s.koios.set("credential_utxos", Response.json([row(7)]));
    const { make } = client(s);
    const rows = await make("mainnet").credentialUtxos(["aa".repeat(28)]);
    expect(rows.map((r) => r.tx_hash)).toEqual([row(7).tx_hash]);
    const asked = s.calls.filter((c) => c.path === "credential_utxos");
    expect(asked.map((c) => c.host)).toEqual([DATA, DATA, KOIOS]);
    // Koios's from the start: no `or=` past a page the data layer gave.
    expect(asked[2]!.query).not.toContain("or=");
  });

  it("keeps each part apart, and a part's hold across a worker's restart", async () => {
    const s = servers();
    s.data.set("tip", "unreachable");
    const { make, clock, session, deps } = client(s);
    await make("mainnet").tipSlot();
    // Submits still go to the data layer.
    s.data.set("submittx", Response.json(TX, { status: 202 }));
    expect(await make("mainnet").submitTx(new Uint8Array([1]))).toBe(TX);
    expect(s.calls.at(-1)).toMatchObject({ host: DATA, path: "submittx" });
    // A new worker reads the hold back.
    const again = chainClient({ ...deps, parts: new DataParts(session, () => clock.now) }, () => DATA);
    s.data.delete("tip");
    expect(await again("mainnet").tipSlot()).toBe(2);
  });
});

describe("a submit through the data layer", () => {
  const sent = (s: ReturnType<typeof servers>) => s.calls.filter((c) => c.path === "submittx").map((c) => c.host);

  it.each([
    ["a 429", error(429, "slow down", { "retry-after": "5" })],
    ["a 503 at the in-flight cap", error(503, "busy", { "retry-after": "30" })],
    ["a 403", error(403, "forbidden")],
    ["a 413", error(413, "too large")],
    // The API's body limit answers before anything is read, in plain text.
    ["a 413 in plain text", new Response("Failed to buffer the request body: length limit exceeded", { status: 413 })],
    ["a 415 in plain text", new Response("Expected request with `Content-Type: application/cbor`", { status: 415 })],
    ["no connection at all", "unreachable" as const],
  ])("goes straight to Koios on %s: it can't have reached the node", async (_, answer) => {
    const s = servers();
    s.data.set("submittx", answer);
    s.koios.set("submittx", Response.json(TX, { status: 202 }));
    const { make } = client(s);
    expect(await make("mainnet").submitTx(new Uint8Array([1]))).toBe(TX);
    expect(sent(s)).toEqual([DATA, KOIOS]);
    // And the submit part stays on Koios.
    await make("mainnet").submitTx(new Uint8Array([1]));
    expect(sent(s)).toEqual([DATA, KOIOS, KOIOS]);
  });

  it.each([
    ["a 502", error(502, "unreachable")],
    ["a 504", error(504, "timed out")],
    ["a timeout once it went out", "timeout" as const],
  ])("is maybe sent on %s, and asks Koios nothing yet", async (_, answer) => {
    const s = servers();
    s.data.set("submittx", answer);
    const { make } = client(s);
    const e = await make("mainnet").submitTx(new Uint8Array([1])).catch((e: unknown) => e);
    expect(e).toBeInstanceOf(KoiosBusyError);
    expect((e as KoiosBusyError).maybeSent).toBe(true);
    expect(sent(s)).toEqual([DATA]);
    // Sent again later (pending.ts), it goes through Koios while the part is down: the same transaction.
    s.koios.set("submittx", Response.json(TX, { status: 202 }));
    expect(await make("mainnet").submitTx(new Uint8Array([1]))).toBe(TX);
    expect(sent(s)).toEqual([DATA, KOIOS]);
  });

  it("is maybe sent when Koios calls spent what a lost connection may have sent", async () => {
    const s = servers();
    s.data.set("submittx", "unreachable");
    s.koios.set("submittx", new Response('"BadInputsUTxO"', { status: 400 }));
    const { make } = client(s);
    const e = await make("mainnet").submitTx(new Uint8Array([1])).catch((e: unknown) => e);
    expect(e).toBeInstanceOf(KoiosBusyError);
    expect((e as KoiosBusyError).maybeSent).toBe(true);
    // Worth the mempool check a refusal as spent gets (pending.ts).
    expect(e).toBeInstanceOf(SpentMaybeSentError);
  });

  it.each([
    ["a 429", () => error(429, "slow down", { "retry-after": "5" })],
    ["a 5xx", () => error(502, "bad gateway")],
    ["its node down", () => new Response('"TxSubmitConnectionError"', { status: 500 })],
    ["no answer either", "unreachable" as const],
  ])("is maybe sent when Koios answers %s after a lost connection: that says nothing of the first try", async (_, answer) => {
    const s = servers();
    s.data.set("submittx", "unreachable");
    s.koios.set("submittx", answer);
    const { make } = client(s);
    const e = await make("mainnet").submitTx(new Uint8Array([1])).catch((e: unknown) => e);
    expect(e).toBeInstanceOf(KoiosBusyError);
    expect((e as KoiosBusyError).maybeSent).toBe(true);
  });

  it("keeps the node's refusal of the transaction itself after a lost connection", async () => {
    const s = servers();
    s.data.set("submittx", "unreachable");
    s.koios.set("submittx", new Response('"FeeTooSmallUTxO"', { status: 400 }));
    const { make } = client(s);
    const e = await make("mainnet").submitTx(new Uint8Array([1])).catch((e: unknown) => e);
    expect(e).not.toBeInstanceOf(KoiosBusyError);
  });

  it("keeps Koios's refusal as it is after a refusal that never reached the node", async () => {
    const s = servers();
    s.data.set("submittx", error(503, "busy"));
    s.koios.set("submittx", new Response('"BadInputsUTxO"', { status: 400 }));
    const { make } = client(s);
    await expect(make("mainnet").submitTx(new Uint8Array([1]))).rejects.toBeInstanceOf(SpentInputError);
  });

  it("takes the node's own refusal through the data layer as Koios's would be, and stays up", async () => {
    const s = servers();
    s.data.set("submittx", new Response('{"tag":"TxSubmitFail","contents":"BadInputsUTxO"}', { status: 400 }));
    const { make } = client(s);
    await expect(make("mainnet").submitTx(new Uint8Array([1]))).rejects.toBeInstanceOf(SpentInputError);
    s.data.set("submittx", Response.json(TX, { status: 202 }));
    expect(await make("mainnet").submitTx(new Uint8Array([1]))).toBe(TX);
    expect(sent(s)).toEqual([DATA, DATA]);
  });

  it("evaluates on the data layer, Ogmios's refusal included, and on Koios when its answer isn't Ogmios's", async () => {
    const s = servers();
    const refusal = { jsonrpc: "2.0", error: { code: 3010, message: "script failed" } };
    s.data.set("ogmios", Response.json(refusal, { status: 400 }));
    const { make } = client(s);
    expect(await make("mainnet").evaluate("00")).toEqual(refusal);
    s.data.set("ogmios", error(400, "not a request Seedelf Wallet makes"));
    s.koios.set("ogmios", Response.json({ jsonrpc: "2.0", result: [] }));
    expect(await make("mainnet").evaluate("00")).toEqual({ jsonrpc: "2.0", result: [] });
    expect(s.calls.filter((c) => c.path === "ogmios").map((c) => c.host)).toEqual([DATA, DATA, KOIOS]);
  });
});

describe("the data layer's limits", () => {
  it("routes every call Koios answers: none is left to reach Koios by itself", () => {
    const own = (proto: object) => Object.getOwnPropertyNames(proto).filter((n) => n !== "constructor");
    const internal = new Set(["paged", "post", "request", "send"]);
    const routed = new Set(own(DataLayerKoios.prototype));
    expect(own(Koios.prototype).filter((n) => !internal.has(n) && !routed.has(n))).toEqual([]);
  });

  it("weighs each route as the edge does", () => {
    expect(["tip", "epoch_params", "totals", "pool_list", "proposal_list", "contract/snapshot"].map(dataCost)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(["credential_utxos", "tx_info", "pool_info", "tx_status"].map(dataCost)).toEqual([4, 4, 4, 4]);
    expect(["submittx", "ogmios"].map(dataCost)).toEqual([10, 10]);
  });

  it("lets a window's units through, then waits", async () => {
    let now = 0;
    const waits: number[] = [];
    const limit = new RateLimit(10, 1_000, () => now, async (ms) => {
      waits.push(ms);
      now += ms;
    });
    await limit.take(4);
    await limit.take(4);
    expect(waits).toEqual([]);
    await limit.take(4);
    expect(waits).toEqual([1_000]);
    // One that costs more than a window still goes, alone.
    await limit.take(20);
    expect(waits).toEqual([1_000, 1_000]);
  });
});
