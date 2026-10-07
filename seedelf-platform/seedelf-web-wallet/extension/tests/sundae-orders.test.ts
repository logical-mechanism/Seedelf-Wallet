// SundaeSwap V3 through Minswap's router (chunk 24): V3 only as a path of its
// own, the session's check reading a V3 order exactly (WebAssembly's
// readDexOrder, seedelf-core orders.rs), and Stop's own cancel of one (Step
// 3), signed by the session's stake key too, as the order's owner.
import { describe, expect, it } from "vitest";

import type { KoiosUtxo } from "../src/background/koios";
import { type BuiltOutput, outOfPlace, SUNDAE_V3, uncheckedProtocols } from "../src/background/minswap";
import { checkOrder, dexOrderAt, Refused } from "../src/background/sessions";
import { bech32 } from "./fixtures/bech32";
import { bytes, cbor, type Cbor, hex, ORDER_DATUM, ORDER_SCRIPT, SESSION_ADDRESS, swapTx } from "./fixtures/swap-tx";
import { loadTestWasm, minswapEstimate, sessionSwap } from "./fakes";
import { ASK, atSession, FUNDING, funded, orderRow, signing, started, SWAP_TX, unlocked, type T } from "./swap-session";

const PAYMENT = sessionSwap.keyHash;
const STAKE = SESSION_ADDRESS.slice(58);
const SOMEONE = "ee".repeat(28);

/** A V3 order's address on preprod: its script there, under `stake` (none: an enterprise address). */
const { order: V3_ORDER, stake: MINSWAP_SUNDAE_STAKE } = SUNDAE_V3.preprod;
const v3At = (stake?: string) => (stake ? `10${V3_ORDER}${stake}` : `70${V3_ORDER}`);

/**
 * A single-leg V3 order's datum as Minswap builds one, byte for byte bar the
 * keys (a real one on mainnet, 2026-10-06, its indefinite lists kept): the
 * pool, the owner's stake key, the protocol fee, the destination address
 * with no datum, a swap of ADA for a token, and the extension.
 */
const realV3Datum = (owner = STAKE, payment = PAYMENT, stake = STAKE) =>
  "d8799fd8799f581c3e259cc410c7932ff0f579085cb47e882498f1af51f1d8db90bc14fcff" +
  `d8799f581c${owner}ff1a00138800` +
  `d8799fd8799fd8799f581c${payment}ffd8799fd8799fd8799f581c${stake}ffffffffd87980ff` +
  "d87a9f9f581ce5a42a1a1d3d1da71b0449663c32798725888d2eb0843c4dabeca05a51576f726c644d6f62696c65546f6b656e581a9502f900ff9f40401a238bead1ffff" +
  "43d87980ff";

/** A Plutus constructor, tags 121 to 127. */
const c = (index: number, ...fields: Cbor[]): Cbor => ({ tag: 121 + index, of: fields });
const keyAddress = (payment: string, stake?: string) => c(0, c(0, bytes(payment)), stake ? c(0, c(0, c(0, bytes(stake)))) : c(1));
/** A V3 order's datum with `owner` (a MultisigScript) and `destination` in place. */
const v3Datum = ({ owner = c(0, bytes(STAKE)), destination = c(0, keyAddress(PAYMENT, STAKE), c(0)) }: { owner?: Cbor; destination?: Cbor } = {}) =>
  hex(cbor(c(0, c(0, bytes("3e".repeat(28))), owner, 1_280_000, destination, c(1, [bytes(""), bytes(""), 10_000_000], [bytes("ab".repeat(28)), bytes("4d494e"), 1]), bytes("d87980"))));

const at = (address: string, datum: string | null): BuiltOutput => ({ address, lovelace: 5_280_000n, tokens: false, datum });
const ours = { address: SESSION_ADDRESS, keyHash: PAYMENT, ownStake: true };
const change = at(SESSION_ADDRESS, null);

/** What WebAssembly reads of `datum` at V3's preprod order script, under Minswap's staking part, for session 0. */
const readV3 = (datum: string, address = v3At(MINSWAP_SUNDAE_STAKE)) => dexOrderAt(loadTestWasm(), "preprod", address, datum, sessionSwap.address);
/** checkOrder's reader for a session (bech32), on `network`. */
const reader =
  (session = sessionSwap.address, network: "preprod" | "mainnet" = "preprod") =>
  (o: BuiltOutput) =>
    dexOrderAt(loadTestWasm(), network, o.address, o.datum ?? "", session);

describe("a SundaeSwap V3 order's datum, as WebAssembly reads it", () => {
  it("is the session's, shaped as Minswap builds them: owned by its stake key, paying its address", () => {
    for (const datum of [realV3Datum(), v3Datum()]) {
      expect(readV3(datum)).toMatchObject({ known: true, protocol: "SundaeSwapV3", ours: true, stakeSigns: true, why: null });
    }
    // Its script is read from Sundae's reference UTxO on preprod.
    expect(readV3(realV3Datum()).reference).toBe("457a5c7dc6df0dc73d46a95d9f0a8a648855ceffd628803694c094e67c4bba64#0");
    // Paying an address with no staking part: not the session's.
    expect(readV3(v3Datum({ destination: c(0, keyAddress(PAYMENT), c(0)) })).ours).toBe(false);
  });

  it("isn't the session's when it can't vouch for it: an owner that isn't one signature, a script or a datum at the destination, or another shape", () => {
    const notOurs = (datum: string) => expect(readV3(datum)).toMatchObject({ known: true, ours: false });
    // AnyOf([Signature(stake)]): satisfied by the same key, but not the shape the check takes.
    notOurs(v3Datum({ owner: c(2, [c(0, bytes(STAKE))]) }));
    // Minswap's adapter, a script, with the next leg's datum by hash: as when V3 is the first of two legs.
    notOurs(v3Datum({ destination: c(0, c(0, c(1, bytes("0e".repeat(28))), c(1)), c(1, bytes("98".repeat(32)))) }));
    notOurs(v3Datum({ destination: c(0, keyAddress(PAYMENT, STAKE), c(2, bytes("d87980"))) }));
    // Self, which pays the order's own address back.
    notOurs(v3Datum({ destination: c(1) }));
    // Not a V3 order at all: a Minswap V1 order's datum, and bytes that aren't one; said why.
    expect(readV3(hex(cbor(c(0, bytes(PAYMENT), bytes(STAKE), 1)))).why).toMatch(/SundaeSwapV3 order's details/);
    notOurs("ff");
    // Owned by someone else's key, or by the session's payment key rather than its stake key.
    notOurs(realV3Datum(SOMEONE));
    notOurs(realV3Datum(PAYMENT));
  });

  it("isn't an order the wallet can cancel at all at a contract its table doesn't hold", () => {
    expect(readV3(realV3Datum(), `10${"a6".repeat(28)}${STAKE}`)).toMatchObject({ known: false, ours: false });
  });
});

describe("the session's check of a V3 order (checkOrder)", () => {
  it("takes the session's own: under Minswap's staking part, the session's, or none", () => {
    for (const address of [v3At(MINSWAP_SUNDAE_STAKE), v3At(STAKE), v3At()]) {
      expect(checkOrder([at(address, realV3Datum()), change], ours, 0n, reader())).toEqual([0]);
    }
  });

  it("refuses one under another staking part, owned by another key, paying elsewhere, or for a session without its own stake key", () => {
    const refused = (o: BuiltOutput, session: Parameters<typeof checkOrder>[1] = ours) =>
      expect(() => checkOrder([o, change], session, 0n, reader())).toThrow(Refused);
    expect(() => checkOrder([at(v3At(SOMEONE), realV3Datum()), change], ours, 0n, reader())).toThrow(
      "it pays a contract under someone else's staking part.",
    );
    // Owned by someone else (Minswap's own key, as a two-leg route's are), or by the session's payment key.
    refused(at(v3At(MINSWAP_SUNDAE_STAKE), realV3Datum(SOMEONE)));
    refused(at(v3At(MINSWAP_SUNDAE_STAKE), realV3Datum(PAYMENT)));
    // Paying someone else, or the session's key under another staking part.
    refused(at(v3At(MINSWAP_SUNDAE_STAKE), realV3Datum(STAKE, SOMEONE)));
    refused(at(v3At(MINSWAP_SUNDAE_STAKE), realV3Datum(STAKE, PAYMENT, SOMEONE)));
    // Paying Minswap's adapter, or the session's address with a datum it would have to carry.
    refused(at(v3At(MINSWAP_SUNDAE_STAKE), v3Datum({ destination: c(0, c(0, c(1, bytes("0e".repeat(28))), c(1)), c(1, bytes("98".repeat(32)))) })));
    refused(at(v3At(MINSWAP_SUNDAE_STAKE), v3Datum({ destination: c(0, keyAddress(PAYMENT, STAKE), c(2, bytes("d87980"))) })));
    // No datum, or one that isn't an order's.
    refused(at(v3At(MINSWAP_SUNDAE_STAKE), null));
    refused(at(v3At(MINSWAP_SUNDAE_STAKE), "ff"));
    // A session from before each had its own stake key: the shared one would have to cancel it, and it never signs.
    refused(at(v3At(MINSWAP_SUNDAE_STAKE), realV3Datum()), { ...ours, ownStake: false });
    refused(at(v3At(MINSWAP_SUNDAE_STAKE), realV3Datum()), { address: SESSION_ADDRESS, keyHash: PAYMENT });
  });

  it("pins each network's V3 order script, and Minswap's staking part there", () => {
    const { mainnet, preprod } = SUNDAE_V3;
    expect(mainnet.order).not.toBe(preprod.order);
    // A mainnet session (header 0x01): its V3 orders are at mainnet's script, under mainnet's staking part.
    const onMainnet = { ...ours, address: `01${SESSION_ADDRESS.slice(2)}` };
    const back = at(onMainnet.address, null);
    const onMainnetReader = reader(bech32("addr", bytes(onMainnet.address)), "mainnet");
    expect(checkOrder([at(`11${mainnet.order}${mainnet.stake}`, realV3Datum()), back], onMainnet, 0n, onMainnetReader)).toEqual([0]);
    expect(() => checkOrder([at(`11${mainnet.order}${preprod.stake}`, realV3Datum()), back], onMainnet, 0n, onMainnetReader)).toThrow(
      "it pays a contract under someone else's staking part.",
    );
    // Mainnet's script on preprod is no order the wallet can cancel there.
    expect(() => checkOrder([at(`10${mainnet.order}${mainnet.stake}`, realV3Datum()), change], ours, 0n, reader())).toThrow(
      "it places an order the wallet couldn't cancel.",
    );
  });

  it("takes Minswap's staking part at V3's order script alone", () => {
    // Another DEX's order, the session's own, under Minswap's V3 staking part: someone else's staking part.
    const other = at(`10${ORDER_SCRIPT}${MINSWAP_SUNDAE_STAKE}`, ORDER_DATUM);
    expect(() => checkOrder([other, change], ours, 0n, reader())).toThrow("it pays a contract under someone else's staking part.");
  });
});

describe("a route through SundaeSwap V3", () => {
  const leg = minswapEstimate.estimate.paths[0]![0]!;
  const route = (...paths: string[][]) => ({ paths: paths.map((p) => p.map((protocol) => ({ ...leg, protocol }))) });

  it("goes through V3 only as a path of its own, as through any DEX", () => {
    expect(outOfPlace(route(["SundaeSwapV3"]))).toEqual([]);
    expect(outOfPlace(route(["SundaeSwapV3"], ["MinswapV2"]))).toEqual([]);
    // A path of more than one leg, whichever DEXes: a later leg's order is placed by the first leg's batcher.
    expect(outOfPlace(route(["MinswapV2", "SundaeSwapV3"]))).toEqual(["MinswapV2", "SundaeSwapV3"]);
    expect(outOfPlace(route(["SundaeSwapV3", "WingRidersV2"]))).toEqual(["SundaeSwapV3", "WingRidersV2"]);
    expect(outOfPlace(route(["MinswapV2", "WingRidersV2"]))).toEqual(["MinswapV2", "WingRidersV2"]);
    // On either network: the check never sees a later leg's order.
    expect(uncheckedProtocols("preprod", route(["MinswapV2", "SundaeSwapV3"]))).toEqual(["MinswapV2", "SundaeSwapV3"]);
    expect(uncheckedProtocols("mainnet", route(["MinswapV2", "SundaeSwapV3"]))).toEqual(["MinswapV2", "SundaeSwapV3"]);
  });

  it("is asked for again without V3 when Minswap's best puts it beside another leg, and the order is built from that one", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    // The route through V3 quotes more; the one without it is what the session takes.
    const more = (BigInt(minswapEstimate.estimate.amount_out) * 2n).toString();
    const legged = { ...minswapEstimate.estimate, amount_out: more, ...route(["MinswapV2", "SundaeSwapV3"]) };
    const around = { ...minswapEstimate.estimate, ...route(["MinswapV2"]) };
    const answer = t.minswap.fetch;
    t.minswap.fetch = async (url, init) => {
      const body = init.body ? JSON.parse(String(init.body)) : {};
      const left: string[] = body.exclude_protocols ?? body.estimate?.exclude_protocols ?? [];
      t.minswap.estimate = left.includes("SundaeSwapV3") ? around : legged;
      return answer(url, init);
    };
    const asked = () => t.minswap.calls.map((c) => [c.path, (c.body?.exclude_protocols ?? c.body?.estimate?.exclude_protocols ?? []).includes("SundaeSwapV3")]);

    const quote = await sessions.quote("preprod", ASK);
    expect(quote.amountOut).toBe(around.amount_out);
    expect(asked()).toEqual([
      ["estimate", false],
      ["estimate", true],
    ]);

    t.minswap.calls.length = 0;
    await started(sessions);
    funded(t);
    const view = await sessions.advance("preprod", 0, true);
    expect(view.auto!.paused).toBeUndefined();
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
    // The order is built as the route without V3 was: Minswap routes it again, told to leave V3 out.
    expect(asked().slice(-3)).toEqual([
      ["estimate", false],
      ["estimate", true],
      ["build-tx", true],
    ]);
  });
});

describe("a V3 order placed and stopped", () => {
  /** The swap lands: its order waits at V3's order script, under Minswap's staking part, and its change is at the account. */
  const orderedAtSundae = (t: T) => {
    t.koios.spent.add(FUNDING);
    t.koios.addedToAccounts.push(atSession(SWAP_TX, 1, "131585414"), {
      ...atSession(SWAP_TX, 0, "14000000"),
      address: bech32("addr_test", bytes(v3At(MINSWAP_SUNDAE_STAKE))),
      payment_cred: V3_ORDER,
      inline_datum: { bytes: realV3Datum(), value: null },
    } as KoiosUtxo);
  };

  /** A cancel as a builder might get it wrong, its collateral the session's change, with `signers` required. */
  const cancelTx = (signers: string[]) => {
    const own = bytes(SESSION_ADDRESS);
    const body = new Map<number, Cbor>([
      [0, { tag: 258, of: [[bytes(SWAP_TX), 1], [bytes(SWAP_TX), 0]] }],
      [1, [new Map<number, Cbor>([[0, own], [1, 131_585_414 + 14_000_000 - 400_000]])]],
      [2, 400_000],
      [3, 134_639_865],
      [13, { tag: 258, of: [[bytes(SWAP_TX), 1]] }],
      [14, { tag: 258, of: signers.map(bytes) }],
      [16, new Map<number, Cbor>([[0, own], [1, 131_585_414 - 600_000]])],
      [17, 600_000],
    ]);
    const redeemers = new Map<number, Cbor>([[5, [[0, 1, { tag: 122, of: [] }, [500_000, 200_000_000]]]]]);
    return hex(cbor([body, redeemers, true, null]));
  };

  /**
   * Session 0's swap, its order at V3's order script (`atSundae`; else a Minswap V1 order), then the user's review
   * of the cancel and Stop. `built`: what the cancel's builder answers, for one it got wrong; the wallet's own
   * otherwise (chunk 24, Step 3).
   */
  const stopped = async (built?: string, atSundae = true) => {
    const t = await unlocked();
    const witnesses: string[] = [];
    const sessions = signing(t);
    const wasm = (
      sessions as unknown as {
        deps: { wasm: { signSessionTx: (k: unknown, r: string) => string; buildOrderCancel: (r: string) => string } };
      }
    ).deps.wasm;
    const sign = wasm.signSessionTx;
    wasm.signSessionTx = (keys, request) => {
      const signed = sign(keys, request);
      witnesses.push((JSON.parse(signed) as { witnessSet: string }).witnessSet);
      return signed;
    };
    if (built !== undefined) wasm.buildOrderCancel = () => JSON.stringify({ txCbor: built, covers: [`${SWAP_TX}#0`], stakeSigns: true });
    await started(sessions);
    funded(t);
    await sessions.advance("preprod", 0);
    if (atSundae) orderedAtSundae(t);
    else {
      t.koios.spent.add(FUNDING);
      t.koios.addedToAccounts.push(atSession(SWAP_TX, 1, "131585414"), orderRow(SWAP_TX));
    }
    const review = await sessions.cancelBuild("preprod", 0).catch((e: unknown) => e as Error);
    const view = await sessions.stop("preprod", 0);
    return { t, view, review, witnesses };
  };

  it("cancels it with the wallet's own cancel, signed by the session's payment and stake keys, as its owner must sign", async () => {
    const { t, view, review, witnesses } = await stopped();
    expect(review).not.toBeInstanceOf(Error);
    expect((review as { summary: { signs: string[] } }).summary.signs).toEqual(["0/0", "stake"]);
    expect(view.auto!.paused).toBeUndefined();
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "cancel"]);
    // The cancel's witness set: two signatures, the payment key's and the stake key's (a set, tagged 258, of two).
    expect(witnesses.at(-1)).toMatch(/^a100(d90102)?82/);
    // It reads V3's script from Sundae's reference UTxO, and asks Minswap nothing.
    expect(t.koios.calls.some((c) => c.path === "utxo_info" && c.body._utxo_refs.includes("457a5c7dc6df0dc73d46a95d9f0a8a648855ceffd628803694c094e67c4bba64#0"))).toBe(true);
    expect(t.minswap.calls.map((c) => c.path)).not.toContain("cancel-tx");
  });

  it("pauses rather than sign a V3 cancel without the stake key, which couldn't work", async () => {
    const { view } = await stopped(cancelTx([PAYMENT]));
    expect(view.auto!.paused).toMatchObject({
      why: "refused",
      detail: "its cancel of a SundaeSwap order isn't signed by this session's payment and stake keys alone.",
    });
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
  });

  it("never signs with the stake key for a cancel that spends no V3 order", async () => {
    const { view } = await stopped(cancelTx([STAKE]), false);
    expect(view.auto!.paused).toMatchObject({ why: "refused", detail: "it isn't signed by this session's key alone." });
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
  });

  it("places a V3 order Minswap built for the session, and records it as the swap's order", async () => {
    const t = await unlocked();
    const sessions = signing(t);
    await started(sessions);
    funded(t);
    t.minswap.swapCbor = swapTx({
      outputs: [
        [v3At(MINSWAP_SUNDAE_STAKE), 14_000_000, realV3Datum()],
        [SESSION_ADDRESS, 131_585_414],
      ],
    });
    const view = await sessions.advance("preprod", 0);
    expect(view.auto!.paused).toBeUndefined();
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
  });
});
