// The Koios client: request shape, paging and retries, with a fake fetch.
import { describe, expect, it } from "vitest";

import {
  BACK_OFF_MS,
  Koios,
  KOIOS_NOT_ALLOWED,
  KoiosBusyError,
  KoiosError,
  MAX_BACK_OFF_MS,
  RateLimit,
  retryAfterMs,
  type FetchLike,
} from "../src/background/koios";

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
        url: `${BASE}/credential_utxos?order=tx_hash.asc,tx_index.asc&limit=1000`,
        body: { _payment_credentials: ["94bc"], _extended: true },
      },
    ]);
  });

  it("asks only for UTxOs in blocks after a height, when given one", async () => {
    const { koios, calls } = scripted([Response.json(rows(1))]);
    await koios.credentialUtxos(["94bc"], 5214886);
    expect(calls[0]!.url).toBe(
      `${BASE}/credential_utxos?block_height=gt.5214886&order=tx_hash.asc,tx_index.asc&limit=1000`,
    );
  });

  it("pages 1000 rows at a time until a short page, each after the last row of the one before", async () => {
    const { koios, calls } = scripted([Response.json(rows(1000)), Response.json(rows(1000, 1000)), Response.json(rows(7, 2000))]);
    const all = await koios.credentialUtxos(["94bc"], 5214886);
    expect(all).toHaveLength(2007);
    expect(calls.map((c) => new URL(c.url).searchParams.get("or"))).toEqual([
      null,
      "(tx_hash.gt.999,and(tx_hash.eq.999,tx_index.gt.0))",
      "(tx_hash.gt.1999,and(tx_hash.eq.1999,tx_index.gt.0))",
    ]);
    expect(calls.every((c) => new URL(c.url).searchParams.get("block_height") === "gt.5214886")).toBe(true);
    expect(calls.some((c) => new URL(c.url).searchParams.has("offset"))).toBe(false);
    expect(calls[0]!.body).toEqual({ _payment_credentials: ["94bc"], _extended: true });
  });

  it("misses no UTxO when one before the page's end is spent between pages, and counts each once (launch review #31)", async () => {
    // A contract of 2,500 UTxOs, answered as PostgREST does: sorted, after the keyset, 1,000 at most.
    const hash = (i: number) => i.toString(16).padStart(64, "0");
    const chain = Array.from({ length: 2500 }, (_, i) => ({ tx_hash: hash(i), tx_index: 0 }));
    let pages = 0;
    const fetchFn: FetchLike = async (url) => {
      const query = new URL(url).searchParams;
      const after = /^\(tx_hash\.gt\.([0-9a-f]+),and\(tx_hash\.eq\.\1,tx_index\.gt\.(\d+)\)\)$/.exec(query.get("or") ?? "");
      const offset = Number(query.get("offset") ?? 0);
      const page = chain
        .filter((u) => !after || u.tx_hash > after[1]! || (u.tx_hash === after[1] && u.tx_index > Number(after[2])))
        .slice(offset, offset + Number(query.get("limit")));
      // Between the first and second page, the UTxO at position 10 is spent.
      if (++pages === 1) chain.splice(10, 1);
      // And a backend a block behind repeats the last row of a page at the top of the next.
      return Response.json(pages === 2 ? [chain[998]!, ...page.slice(0, -1), page.at(-1)!] : page);
    };
    const all = await new Koios(BASE, fetchFn, async () => undefined).credentialUtxos(["94bc"]);
    // The UTxO at position 1,000 is there (an offset of 1,000 would have skipped it), and none twice.
    expect(all.some((u) => u.tx_hash === hash(1000))).toBe(true);
    expect(new Set(all.map((u) => `${u.tx_hash}#${u.tx_index}`)).size).toBe(all.length);
    expect(all).toHaveLength(2500);
  });

  it("drops a datum's JSON and cuts a reference script to what prices it, however deep they nest (launch review H4)", async () => {
    // Anyone can pay an address an output like this: V8 parses it, but stringifying or storing it overflows the stack.
    const levels = 100_000;
    const datum = `{"bytes":"${"81".repeat(levels)}00","value":${'{"list":['.repeat(levels)}{"int":0}${"]}".repeat(levels)}}`;
    const script = `{"hash":"${"ab".repeat(28)}","size":300001,"type":"timelock","bytes":null,"value":${'{"type":"all","scripts":['.repeat(levels)}{"type":"sig"}${"]}".repeat(levels)}}`;
    const deep = `{"tx_hash":"${"ee".repeat(32)}","tx_index":0,"value":"1500000","inline_datum":${datum},"reference_script":${script},"asset_list":[]}`;
    const plain = { tx_hash: "ff".repeat(32), tx_index: 1, value: "2000000", inline_datum: null, reference_script: null, asset_list: [] };
    // A script in a shape Koios never sends still counts as one.
    const odd = { ...plain, tx_index: 2, reference_script: "82008" };
    const text = `[${deep},${JSON.stringify(plain)},${JSON.stringify(odd)}]`;
    expect(() => JSON.stringify(JSON.parse(text))).toThrow(RangeError);

    const read = await scripted([new Response(text)]).koios.credentialUtxos(["94bc"]);
    expect(read[0]!.inline_datum).toEqual({ bytes: `${"81".repeat(levels)}00`, value: null });
    expect(read[0]!.reference_script).toEqual({ hash: "ab".repeat(28), size: 300001, type: "timelock", bytes: null });
    expect(read[1]!.inline_datum).toBeNull();
    expect(read[1]!.reference_script).toBeNull();
    expect(read[2]!.reference_script).toEqual({ hash: null, size: null, type: null, bytes: null });
    // Everything the worker does with rows now works: requests to WebAssembly, session storage, messages.
    expect(JSON.parse(JSON.stringify(read))).toEqual(structuredClone(read));

    const info = await scripted([new Response(`[${deep}]`)]).koios.utxoInfo([`${"ee".repeat(32)}#0`]);
    expect(info[0]!.inline_datum!.value).toBeNull();
    expect(() => JSON.stringify(info)).not.toThrow();
  });

  it("asks about at most 75 credentials a request, to stay under Koios's 5,120-byte body limit", async () => {
    const { koios, calls } = scripted([Response.json(rows(2)), Response.json(rows(1, 2))]);
    const credentials = Array.from({ length: 80 }, (_, i) => i.toString(16).padStart(56, "0"));
    expect(await koios.credentialUtxos(credentials)).toHaveLength(3);
    expect(calls.map((c) => c.body._payment_credentials.length)).toEqual([75, 5]);
    expect(Math.max(...calls.map((c) => JSON.stringify(c.body).length))).toBeLessThan(5120);
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

  it("says which of several stake addresses were ever used, in one request", async () => {
    const { koios, calls } = scripted([
      Response.json([
        { stake_address: "stake_test1a", addresses: ["addr_test1a"] },
        { stake_address: "stake_test1b", addresses: [] },
      ]),
    ]);
    expect(await koios.usedStakeAddresses(["stake_test1a", "stake_test1b", "stake_test1c"])).toEqual(new Set(["stake_test1a"]));
    expect(calls.map((c) => c.body)).toEqual([{ _stake_addresses: ["stake_test1a", "stake_test1b", "stake_test1c"], _empty: true }]);
  });

  it("explains a connection that fails, and a rate limit", async () => {
    const offline = scripted([new TypeError("Failed to fetch"), new TypeError("Failed to fetch"), new TypeError("Failed to fetch")]);
    await expect(offline.koios.credentialUtxos(["x"])).rejects.toThrow(
      "Couldn't reach Koios, the service the wallet reads Cardano from (Failed to fetch). Check your internet connection",
    );
    const limited = scripted([429, 429, 429].map((status) => new Response("", { status })));
    await expect(limited.koios.credentialUtxos(["x"])).rejects.toThrow("Koios is limiting requests from your connection");
  });

  it("says when Chrome won't let the wallet reach Koios, and doesn't retry", async () => {
    // Koios's public tier sends browsers no CORS headers: without Chrome's
    // grant for its host, every request fails like a lost connection.
    let tries = 0;
    const blocked = (): FetchLike => async () => {
      tries++;
      throw new TypeError("Failed to fetch");
    };
    const asked: string[] = [];
    const withheld = new Koios(BASE, blocked(), async () => undefined, async (url) => (asked.push(url), false));
    await expect(withheld.credentialUtxos(["x"])).rejects.toThrow(KOIOS_NOT_ALLOWED);
    await expect(withheld.submitTx(new Uint8Array([0x84]))).rejects.toThrow(KOIOS_NOT_ALLOWED);
    expect(tries).toBe(2);
    expect(asked.map((u) => new URL(u).origin)).toEqual(["https://preprod.koios.rest", "https://preprod.koios.rest"]);

    const granted = new Koios(BASE, blocked(), async () => undefined, async () => true);
    await expect(granted.credentialUtxos(["x"])).rejects.toThrow("Couldn't reach Koios");
  });

  it("says a slow Koios was slow, not that the connection is broken", async () => {
    const timeout = () => {
      throw new DOMException("signal timed out", "TimeoutError");
    };
    const koios = new Koios(BASE, timeout as unknown as FetchLike, async () => undefined, async () => true);
    await expect(koios.credentialUtxos(["94bc"])).rejects.toThrow("didn't answer in time");
    await expect(koios.credentialUtxos(["94bc"])).rejects.not.toThrow("ad blocker");
    // A connection that really is broken still says so.
    const offline = new Koios(BASE, (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as FetchLike, async () => undefined, async () => true);
    await expect(offline.credentialUtxos(["94bc"])).rejects.toThrow("Check your internet connection");
  });

  it("gives a timed-out read one retry, not two: three waits of TIMEOUT_MS is minutes of a spinner", async () => {
    let tries = 0;
    const timeout = () => {
      tries++;
      throw new DOMException("signal timed out", "TimeoutError");
    };
    const koios = new Koios(BASE, timeout as unknown as FetchLike, async () => undefined, async () => true);
    await expect(koios.credentialUtxos(["94bc"])).rejects.toThrow("didn't answer in time");
    expect(tries).toBe(2);
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
    await expect(koios.credentialUtxos(["x"])).rejects.toThrow("Koios refused the request (400 for credential_utxos).");
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
    // Koios failing on its side, or asking the wallet to slow down, didn't reject it: sending it again later is safe.
    const busy = new Koios(BASE, async () => (tries++, new Response("", { status: 503 })));
    await expect(busy.submitTx(new Uint8Array([0x84]))).rejects.toThrow(KoiosBusyError);
    const limited = new Koios(BASE, async () => new Response("", { status: 429 }));
    await expect(limited.submitTx(new Uint8Array([0x84]))).rejects.toThrow("Koios is limiting requests");
    const silent = new Koios(BASE, async () => {
      throw new DOMException("signal timed out", "TimeoutError");
    });
    await expect(silent.submitTx(new Uint8Array([0x84]))).rejects.toThrow(KoiosBusyError);
    // Koios's answer, recorded live, when its node was unreachable: not sent, so Send again.
    const nodeDown = JSON.stringify({
      contents: { contents: "Network.Socket.connect: <socket: 14>: does not exist (No such file or directory)", tag: "TxCmdTxSubmitConnectionError" },
      tag: "TxSubmitFail",
    });
    const down = new Koios(BASE, async () => (tries++, new Response(nodeDown, { status: 400 })), async () => undefined);
    await expect(down.submitTx(new Uint8Array([0x84]))).rejects.toThrow("Koios couldn't reach its Cardano node, so the transaction wasn't sent");
    expect(tries).toBe(5); // that answer, and only that one, is tried three times
    const answers = [new Response(nodeDown, { status: 400 }), Response.json("cd".repeat(32), { status: 202 })];
    const recovers = new Koios(BASE, async () => answers.shift()!, async () => undefined);
    expect(await recovers.submitTx(new Uint8Array([0x84]))).toBe("cd".repeat(32));
    // A UTxO it spends is already spent: an out-of-date view of the chain.
    const badInputs = JSON.stringify({ contents: { contents: { contents: { error: ["ConwayUtxowFailure (UtxoFailure (BadInputsUTxO (fromList [])))"] } } } });
    const spentAlready = new Koios(BASE, async () => (tries++, new Response(badInputs, { status: 400 })));
    await expect(spentAlready.submitTx(new Uint8Array([0x84]))).rejects.toThrow("a UTxO it spends is already spent");
    expect(tries).toBe(6); // never retried
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

  it("says whether a submit Koios didn't answer may have gone through: not when it only asked to slow down", async () => {
    const busy = async (answer: Response | Error): Promise<KoiosBusyError> => {
      const koios = new Koios(BASE, async () => {
        if (answer instanceof Error) throw answer;
        return answer;
      });
      return (await koios.submitTx(new Uint8Array([0x84])).catch((e: unknown) => e)) as KoiosBusyError;
    };
    expect((await busy(new DOMException("signal timed out", "TimeoutError"))).maybeSent).toBe(true);
    expect((await busy(new Response("", { status: 504 }))).maybeSent).toBe(true);
    const limited = await busy(new Response("", { status: 429 }));
    expect(limited).toBeInstanceOf(KoiosBusyError);
    expect(limited.maybeSent).toBe(false);
  });

  it("reads the tip's slot", async () => {
    const { koios, calls } = scripted([Response.json([{ hash: "ab", epoch_no: 250, abs_slot: 106_000_000, block_no: 4_000_000 }])]);
    expect(await koios.tipSlot()).toBe(106_000_000);
    expect(calls[0]!.url).toBe(`${BASE}/tip`);
    await expect(scripted([Response.json([])]).koios.tipSlot()).rejects.toThrow("Koios returned no tip.");
  });

  it("reads confirmations", async () => {
    const { koios, calls } = scripted([Response.json([{ tx_hash: "aa", num_confirmations: 3 }, { tx_hash: "bb", num_confirmations: null }])]);
    const status = await koios.txStatus(["aa", "bb"]);
    expect([...status]).toEqual([["aa", 3], ["bb", null]]);
    expect(calls[0]!.body).toEqual({ _tx_hashes: ["aa", "bb"] });
  });
  it("reads a stake key's standing, and nothing for one never registered", async () => {
    const info = { stake_address: "stake_test1u", status: "registered", rewards_available: "5", deposit: "2000000" };
    const { koios, calls } = scripted([Response.json([info]), Response.json([])]);
    expect(await koios.accountInfo("stake_test1u")).toEqual(info);
    expect(await koios.accountInfo("stake_test1never")).toBeUndefined();
    expect(calls[0]).toEqual({ url: `${BASE}/account_info`, body: { _stake_addresses: ["stake_test1u"] } });
  });

  it("pages the live pools with a GET, asking only for the columns the browser shows", async () => {
    const pools = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ pool_id_bech32: `pool${from + i}` }));
    const { koios, calls } = scripted([Response.json(pools(1000)), Response.json(pools(3, 1000))]);
    expect(await koios.poolList()).toHaveLength(1003);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/api/v1/pool_list");
    expect(url.searchParams.get("pool_status")).toBe("eq.registered");
    expect(url.searchParams.get("select")).toBe("pool_id_bech32,ticker,margin,fixed_cost,pledge,active_stake,retiring_epoch");
    expect(calls.map((c) => new URL(c.url).searchParams.get("offset"))).toEqual(["0", "1000"]);
    expect(calls[0]!.body).toBeUndefined();
  });

  it("explains the ledger's staking refusals", async () => {
    const refused = (error: string) => scripted([new Response(error, { status: 400 })]).koios.submitTx(new Uint8Array([1]));
    await expect(refused("WithdrawalsNotInRewardsCERTS")).rejects.toThrow("rewards changed since you reviewed");
    await expect(refused("ConwayWdrlNotDelegatedToDRep")).rejects.toThrow("voting power is delegated");
    await expect(refused("DelegateeDRepNotRegisteredDELEG")).rejects.toThrow("DRep isn't registered any more");
    await expect(refused("StakeKeyNotRegisteredDELEG")).rejects.toThrow("staking changed since you reviewed");
    await expect(refused("SomethingElse")).rejects.toThrow("The network rejected the transaction: SomethingElse");
  });

  it("explains a transaction past its time, or a device clock far off, and a fee too small", async () => {
    const refused = (error: string) => scripted([new Response(error, { status: 400 })]).koios.submitTx(new Uint8Array([1]));
    const late = JSON.stringify({ contents: { contents: { contents: { error: ["ConwayUtxowFailure (UtxoFailure (OutsideValidityIntervalUTxO (ValidityInterval {invalidBefore = SNothing, invalidHereafter = SJust (SlotNo 100)}) (SlotNo 7300)))"] } } } });
    await expect(refused(late)).rejects.toThrow(
      "The network refused it: its time to be sent had run out, or this device's clock is far off. Nothing was sent. Check the clock, then review it again.",
    );
    const cheap = JSON.stringify({ contents: { contents: { contents: { error: ["ConwayUtxowFailure (UtxoFailure (FeeTooSmallUTxO (Mismatch {mismatchSupplied = Coin 170000, mismatchExpected = Coin 170075})))"] } } } });
    await expect(refused(cheap)).rejects.toThrow("The network refused it: its fee is less than the network asks.");
    await expect(refused(cheap)).rejects.not.toThrow("Coin 170000");
  });
});

describe("Koios's public-tier limit", () => {
  function clock() {
    const c = { now: 0, slept: [] as number[] };
    const limit = new RateLimit(3, 1_000, () => c.now, async (ms) => {
      c.slept.push(ms);
      c.now += ms;
    });
    return { c, limit };
  }

  it("lets a burst through up to the limit, then waits for the oldest request to leave the window", async () => {
    const { c, limit } = clock();
    for (let i = 0; i < 3; i++) await limit.take();
    expect(c.slept).toEqual([]);
    c.now = 400;
    await limit.take();
    expect(c.slept).toEqual([600]);
    expect(c.now).toBe(1_000);
    // Spread out, nothing waits.
    c.now = 5_000;
    await limit.take();
    expect(c.slept).toEqual([600]);
  });

  it("counts every attempt, retries included", async () => {
    const { c, limit } = clock();
    const answers = [new Response("", { status: 503 }), new Response("", { status: 503 }), Response.json([{ epoch_no: 1 }])];
    const koios = new Koios(BASE, async () => answers.shift()!, async () => undefined, async () => true, limit);
    await koios.epochParams();
    await limit.take();
    // Three attempts and this one: the fourth in the window waits.
    expect(c.slept).toEqual([1_000]);
  });

  it("is 40 requests every 10 seconds, so two workers either side of a restart still fit the tier's 100", () => {
    const limit = new RateLimit();
    expect([limit.max, limit.windowMs]).toEqual([40, 10_000]);
  });

  it("holds every request back once Koios answers 429, for as long as Retry-After asks", async () => {
    const { c, limit } = clock();
    const answers = [new Response("", { status: 429, headers: { "retry-after": "2" } }), Response.json([{ epoch_no: 1 }])];
    const koios = new Koios(BASE, async () => answers.shift()!, async () => undefined, async () => true, limit);
    await koios.epochParams();
    // The retry waited out the cooldown rather than the fixed back-off.
    expect(c.slept).toEqual([2_000]);
    expect(limit.holding()).toBe(0);
  });

  it("caps a Retry-After that asks for longer than a minute", () => {
    const { c, limit } = clock();
    limit.hold(10 * 60_000);
    expect(limit.holding()).toBe(MAX_BACK_OFF_MS);
    c.now += MAX_BACK_OFF_MS;
    expect(limit.holding()).toBe(0);
  });

  it("reads Retry-After as seconds, as an HTTP date, and falls back when it's missing", () => {
    const at = 1_000_000;
    const withHeader = (v: string) => retryAfterMs(new Response("", { status: 429, headers: { "retry-after": v } }), at);
    expect(withHeader("5")).toBe(5_000);
    expect(withHeader(new Date(at + 7_000).toUTCString())).toBe(7_000);
    expect(withHeader("soon")).toBe(BACK_OFF_MS);
    expect(retryAfterMs(new Response("", { status: 429 }), at)).toBe(BACK_OFF_MS);
  });
});
