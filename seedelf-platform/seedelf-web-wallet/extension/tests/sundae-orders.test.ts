// SundaeSwap V3 through Minswap's router (chunk 24): V3 only as a path of its
// own, the session's check reading a V3 order exactly, and Stop's cancel of
// one, signed by the session's stake key too, as the order's owner.
import { describe, expect, it } from "vitest";

import type { KoiosUtxo } from "../src/background/koios";
import {
  type BuiltOutput,
  outOfPlace,
  SUNDAE_V3,
  sundaeV3Order,
  uncheckedProtocols,
} from "../src/background/minswap";
import { checkOrder, Refused } from "../src/background/sessions";
import { bech32 } from "./fixtures/bech32";
import { bytes, cbor, type Cbor, hex, SESSION_ADDRESS, swapTx } from "./fixtures/swap-tx";
import { minswapEstimate, sessionSwap } from "./fakes";
import { ASK, atSession, FUNDING, funded, ORDER, signing, started, SWAP_TX, unlocked, type T } from "./swap-session";

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

describe("a SundaeSwap V3 order's datum", () => {
  it("reads its owner and where it pays, from one shaped as Minswap builds them", () => {
    expect(sundaeV3Order(realV3Datum())).toEqual({ owner: STAKE, pays: { payment: PAYMENT, stake: STAKE } });
    expect(sundaeV3Order(v3Datum())).toEqual({ owner: STAKE, pays: { payment: PAYMENT, stake: STAKE } });
    // An address with no staking part.
    expect(sundaeV3Order(v3Datum({ destination: c(0, keyAddress(PAYMENT), c(0)) }))!.pays).toEqual({ payment: PAYMENT, stake: null });
  });

  it("says nothing it can't vouch for: an owner that isn't one signature, a script or a datum at the destination, or another shape", () => {
    // AnyOf([Signature(stake)]): satisfied by the same key, but not the shape the check takes.
    expect(sundaeV3Order(v3Datum({ owner: c(2, [c(0, bytes(STAKE))]) }))!.owner).toBeNull();
    // Minswap's adapter, a script, with the next leg's datum by hash: as when V3 is the first of two legs.
    const adapter = c(0, c(0, c(1, bytes("0e".repeat(28))), c(1)), c(1, bytes("98".repeat(32))));
    expect(sundaeV3Order(v3Datum({ destination: adapter }))!.pays).toBeNull();
    expect(sundaeV3Order(v3Datum({ destination: c(0, keyAddress(PAYMENT, STAKE), c(2, bytes("d87980"))) }))!.pays).toBeNull();
    // Self, which pays the order's own address back.
    expect(sundaeV3Order(v3Datum({ destination: c(1) }))!.pays).toBeNull();
    // Not a V3 order at all: a Minswap V1 order's datum, and bytes that aren't one.
    expect(sundaeV3Order(hex(cbor(c(0, bytes(PAYMENT), bytes(STAKE), 1))))).toBeNull();
    expect(sundaeV3Order("ff")).toBeNull();
  });
});

describe("the session's check of a V3 order (checkOrder)", () => {
  it("takes the session's own: under Minswap's staking part, the session's, or none", () => {
    for (const address of [v3At(MINSWAP_SUNDAE_STAKE), v3At(STAKE), v3At()]) {
      expect(checkOrder([at(address, realV3Datum()), change], ours, 0n)).toEqual([0]);
    }
  });

  it("refuses one under another staking part, owned by another key, paying elsewhere, or for a session without its own stake key", () => {
    const refused = (o: BuiltOutput, session: Parameters<typeof checkOrder>[1] = ours) => expect(() => checkOrder([o, change], session, 0n)).toThrow(Refused);
    const why = "it places a SundaeSwap order this session couldn't cancel, or that pays someone else.";
    expect(() => checkOrder([at(v3At(SOMEONE), realV3Datum()), change], ours, 0n)).toThrow(why);
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
    expect(checkOrder([at(`11${mainnet.order}${mainnet.stake}`, realV3Datum()), back], onMainnet, 0n)).toEqual([0]);
    expect(() => checkOrder([at(`11${mainnet.order}${preprod.stake}`, realV3Datum()), back], onMainnet, 0n)).toThrow(
      "it places a SundaeSwap order this session couldn't cancel, or that pays someone else.",
    );
    // Mainnet's script on preprod is no V3 order there: under mainnet's staking part, it's someone else's.
    expect(() => checkOrder([at(`10${mainnet.order}${mainnet.stake}`, realV3Datum()), change], ours, 0n)).toThrow(
      "it pays a contract under someone else's staking part.",
    );
  });

  it("takes Minswap's staking part at V3's order script alone", () => {
    // Another DEX's order, naming the session's key, under Minswap's V3 staking part: someone else's staking part.
    const other = at(`10${"a6".repeat(28)}${MINSWAP_SUNDAE_STAKE}`, hex(cbor(c(0, bytes(PAYMENT)))));
    expect(() => checkOrder([other, change], ours, 0n)).toThrow("it pays a contract under someone else's staking part.");
  });
});

describe("a route through SundaeSwap V3", () => {
  const leg = minswapEstimate.estimate.paths[0]![0]!;
  const route = (...paths: string[][]) => ({ paths: paths.map((p) => p.map((protocol) => ({ ...leg, protocol }))) });

  it("goes through V3 only as a path of its own", () => {
    expect(outOfPlace(route(["SundaeSwapV3"]))).toEqual([]);
    expect(outOfPlace(route(["SundaeSwapV3"], ["MinswapV2"]))).toEqual([]);
    expect(outOfPlace(route(["MinswapV2", "SundaeSwapV3"]))).toEqual(["SundaeSwapV3"]);
    expect(outOfPlace(route(["SundaeSwapV3", "WingRidersV2"]))).toEqual(["SundaeSwapV3"]);
    expect(outOfPlace(route(["MinswapV2", "WingRidersV2"]))).toEqual([]);
    // On either network: a later leg's order is placed by the first leg's batcher, and the check never sees it.
    expect(uncheckedProtocols("preprod", route(["MinswapV2", "SundaeSwapV3"]))).toEqual(["SundaeSwapV3"]);
    expect(uncheckedProtocols("mainnet", route(["MinswapV2", "SundaeSwapV3"]))).toEqual(["SundaeSwapV3"]);
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
    } as KoiosUtxo);
  };

  /** Minswap's cancel of the order, its collateral the session's change, with `signers` required. */
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

  /** Session 0's swap, its order at V3's order script, then Stop with Minswap's cancel `cancelCbor`. */
  const stopped = async (cancelCbor: string, atSundae = true) => {
    const t = await unlocked();
    const witnesses: string[] = [];
    const sessions = signing(t);
    const wasm = (sessions as unknown as { deps: { wasm: { signSessionTx: (k: unknown, r: string) => string } } }).deps.wasm;
    const sign = wasm.signSessionTx;
    wasm.signSessionTx = (keys, request) => {
      const signed = sign(keys, request);
      witnesses.push((JSON.parse(signed) as { witnessSet: string }).witnessSet);
      return signed;
    };
    await started(sessions);
    funded(t);
    await sessions.advance("preprod", 0);
    if (atSundae) orderedAtSundae(t);
    else {
      t.koios.spent.add(FUNDING);
      t.koios.addedToAccounts.push(atSession(SWAP_TX, 1, "131585414"), {
        ...atSession(SWAP_TX, 0, "14000000"),
        address: bech32("addr_test", bytes(`10${"a6".repeat(28)}${STAKE}`)),
        payment_cred: "a6".repeat(28),
      } as KoiosUtxo);
    }
    t.minswap.orders = [{ ...ORDER, protocol: atSundae ? "SundaeSwapV3" : "Minswap", tx_in: `${SWAP_TX}#0` }];
    t.minswap.cancelCbor = cancelCbor;
    const review = await sessions.cancelBuild("preprod", 0).catch((e: unknown) => e as Error);
    const view = await sessions.stop("preprod", 0);
    return { t, view, review, witnesses };
  };

  it("cancels it with the session's payment and stake keys, as its owner must sign", async () => {
    const { view, review, witnesses } = await stopped(cancelTx([STAKE]));
    expect(review).not.toBeInstanceOf(Error);
    expect((review as { summary: { signs: string[] } }).summary.signs).toEqual(["0/0", "stake"]);
    expect(view.auto!.paused).toBeUndefined();
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap", "cancel"]);
    // The cancel's witness set: two signatures, the payment key's and the stake key's (a set, tagged 258, of two).
    expect(witnesses.at(-1)).toMatch(/^a100(d90102)?82/);
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
