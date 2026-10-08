// Every order a swap places is one the wallet can cancel itself (chunk 24,
// Step 3), and the 1.3.0 release review (C05) found the order check vouched
// for less: it read who cancels an order and whom it pays, but not whether
// any script could ever spend it. Before the session's key signs a swap, the
// worker now builds the wallet's own cancel of each order it places and runs
// the order's real script on it in WebAssembly (checkOrderCancels), with each
// script read from its reference UTxO as Koios lists it. An order no cancel
// could spend (a Plutus V1 order's datum held inline, a script on it, details
// its script can't decode) pauses the swap, through the runner and Review it
// myself alike, rather than lock its money where Stop can't bring it back;
// every real order the fixtures hold still goes. And when the wallet's own
// cancel is refused by hand, it's said as the wallet's own, never Minswap's.
// The real WebAssembly throughout.
import { blake2b } from "@noble/hashes/blake2.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { KoiosUtxo } from "../src/background/koios";
import { builtOutputs, SUNDAE_V3 } from "../src/background/minswap";
import { dexOrderAt, SESSION_TX, type SessionService } from "../src/background/sessions";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { bytes, cbor, type Cbor, hex, ORDER_ADDRESS, ORDER_DATUM, SESSION_ADDRESS } from "./fixtures/swap-tx";
import { loadTestWasm, sessionSwap } from "./fakes";
import { ASK, atSession, ordered, signing, SWAP_TX, unlocked, type T } from "./swap-session";

type Network = "preprod" | "mainnet";

const PAYMENT = sessionSwap.keyHash;
const STAKE = SESSION_ADDRESS.slice(58);
/** Session 0's address on each network (hex): its payment key and its own stake key. */
const SESSION: Record<Network, string> = { preprod: SESSION_ADDRESS, mainnet: `01${SESSION_ADDRESS.slice(2)}` };
const FUNDED = BigInt(sessionSwap.utxo.value);
const FEE = 205_189n;

/** The check's words, as a paused swap's warning shows them. */
const NOT_CANCELLABLE = "it places an order the wallet couldn't cancel.";

/** The real orders seedelf-core's cancel tests read, one per DEX and network, with the reference UTxOs their scripts are read from. */
const FIXTURES = JSON.parse(readFileSync(new URL("../../../seedelf-core/tests/fixtures/order_cancels.json", import.meta.url), "utf8")) as Array<{
  protocol: string;
  network: Network;
  datum: string;
  datumInline: boolean;
  stuck?: boolean;
  order: { address: string };
  reference: (Partial<KoiosUtxo> & { tx_hash: string; tx_index: number }) | null;
}>;

/**
 * Each fixture's order, by its owner: the payment key and the stake key its datum names, which session 0's take
 * the place of, so the order is the session's.
 */
const REAL: Array<{ protocol: string; network: Network; stuck?: boolean; owner: [payment: string, stake: string] }> = [
  { protocol: "Minswap", network: "mainnet", owner: ["cede1f9979611f5c4a569a305302419cb0214529fb29875d1c96ca23", "c106ffe0078ce85c67a59eb832cc0e48654c1f052e6d9672944b4bcd"] },
  { protocol: "MinswapV2", network: "mainnet", owner: ["c07db826987d6b92f0f95ccee63dbffa2285ee4677d9be894acd177c", "675daafbf4dbc02a2f81d61ec3d8f60d68ccac63117ea035cde3c598"] },
  { protocol: "MinswapStable", network: "mainnet", owner: ["8a1d7934ea645ae8ae284fd701f492f17e1681a2a27bfb7d4d44959a", "ad06853099f9f92c2ca5fa9cf2e73e4eb5bd19bec5cce73a8d8ea1a3"] },
  { protocol: "SundaeSwap", network: "mainnet", owner: ["7157fb9f28de4564c30e95eb503936c495962cb1f2b96d13d52e3dfc", "08d650ab629adf6f462d42d25d4d1bb830d17e718c6c2c44456ab5c5"] },
  { protocol: "SundaeSwapV3", network: "mainnet", owner: ["4cc36281257821200785dcd964b46267c0705330fed566b8fa45eb5b", "eff6864f55f7a70ac1d6010a5902c6497a07c7b04874f2ad2c993d7f"] },
  { protocol: "SundaeSwapStable", network: "mainnet", owner: ["51ba85e8ef9d13a9193a6a2629ec4e9d3fc6041c4e2d78c5b6b532e3", "603015bf589dc558b2fc1df7f125cb43a4f9d90222cb426562ceda7d"] },
  { protocol: "WingRiders", network: "mainnet", owner: ["ae465d0af465442a8bb86e2965eb192d3b310bda2fb090e9967a1275", "aef5ca9fc479fb7cc981df9d1ad6ed5065592fcde305b93d8a7c674d"] },
  { protocol: "WingRidersV2", network: "mainnet", owner: ["bb9a9ef5d661d8f3340df1cc00a3fdfa907abd2986b6b9a9340037bc", "caf7e18d89dd3c2efae7c6362fc25577ae3c3007630c8b9c6102db08"] },
  { protocol: "WingRidersStableV2", network: "mainnet", owner: ["8a6550ab2f014123c8cd0d021e23dfbbc5b6279bfa2c5e130910f3c2", "1af7b97baf428cba146425910b7ac5d1ef155cabd71662644b44abdf"] },
  { protocol: "Splash", network: "mainnet", owner: ["50ec3917ae68eaa31341050a5385636131cb59a9f43f536eb2eb2207", "066311bb73a4336f7e433e255bd9f193a2d943d4fbfa1c712e909c05"] },
  { protocol: "MinswapV2", network: "preprod", owner: ["563a1b17ea644fb0d92f4bc2d4a78bc6ce5f05efc98f9027ae19822c", "5e".repeat(28)] },
  { protocol: "SundaeSwapV3", network: "preprod", owner: ["d5dfc4d9668b998df8e95ccb6866176d861309b0c01ec252935e02c4", "c6772633852dc4df16a15b7357eadc033704699a245ad24c6c610f41"] },
  { protocol: "SundaeSwapV3", network: "preprod", stuck: true, owner: ["eb75b215293795911d97734c3a3901f0586395567380b1e8ddd2e76f", "92dcefd51649d9b7a190f6700827d3265d52fb8bfb7fadcfd7a58dec"] },
  { protocol: "WingRidersV2", network: "preprod", owner: ["b47c7c0ca235a188003fde3e6a583141a89125f346572bb87e81a870", "2966ddf1dacf046d52483389174713c212a3b549370f996066569251"] },
];

interface Order {
  /** Its address, hex: an order script's, under the session's stake key or none. */
  address: string;
  /** Its datum's CBOR, hex. */
  datum: string;
  /** Held inline; otherwise by its hash, the datum carried in the swap's witness set (as Minswap's V1 orders are). */
  inline: boolean;
  /** A script it carries: a script reference's CBOR, hex. */
  script?: string;
  /** Where its script is read from, `txhash#index`; none for a Plutus V1 one, carried in the cancel. */
  reference?: string | null;
}

/** A fixture's real order, made out to session 0 on its network, at its script under the session's stake key (or none, as the fixture's is). */
function realOrder({ protocol, network, stuck, owner }: (typeof REAL)[number]): Order {
  const f = FIXTURES.find((x) => x.protocol === protocol && x.network === network && !!x.stuck === !!stuck)!;
  const at = loadTestWasm().cip30Address(f.order.address);
  const net = network === "mainnet" ? "1" : "0";
  // The header's high four bits: 7, a script with no staking part; else a script under a key's.
  const address = at.charAt(0) === "7" ? `7${net}${at.slice(2, 58)}` : `1${net}${at.slice(2, 58)}${STAKE}`;
  const datum = f.datum.replaceAll(owner[0], PAYMENT).replaceAll(owner[1], STAKE);
  return { address, datum, inline: f.datumInline, reference: f.reference ? `${f.reference.tx_hash}#${f.reference.tx_index}` : null };
}

/** Session 0's preprod order at Minswap V1's script (fixtures/swap-tx.ts), by its datum's hash: the one the swap fixture places. */
const MINSWAP_V1: Order = { address: ORDER_ADDRESS, datum: ORDER_DATUM, inline: false, reference: null };

/** SundaeSwap V3's order script on preprod, under Minswap's staking part there, where Minswap builds V3 orders. */
const V3_AT = `10${SUNDAE_V3.preprod.order}${SUNDAE_V3.preprod.stake}`;
/** V3's reference UTxO on preprod: where its script is read from (seedelf-core orders.json). */
const V3_REFERENCE = "457a5c7dc6df0dc73d46a95d9f0a8a648855ceffd628803694c094e67c4bba64#0";
/** A single-leg V3 order's datum as Minswap builds one (sundae-orders.test.ts' realV3Datum), made out to session 0. */
const V3_DATUM =
  "d8799fd8799f581c3e259cc410c7932ff0f579085cb47e882498f1af51f1d8db90bc14fcff" +
  `d8799f581c${STAKE}ff1a00138800` +
  `d8799fd8799fd8799f581c${PAYMENT}ffd8799fd8799fd8799f581c${STAKE}ffffffffd87980ff` +
  "d87a9f9f581ce5a42a1a1d3d1da71b0449663c32798725888d2eb0843c4dabeca05a51576f726c644d6f62696c65546f6b656e581a9502f900ff9f40401a238bead1ffff" +
  "43d87980ff";
const V3: Order = { address: V3_AT, datum: V3_DATUM, inline: true, reference: V3_REFERENCE };
/** The same with a 7th field, an integer before its list's end: the reader takes it as the session's, but V3's script decodes the whole datum, and can't. */
const V3_SEVENTH: Order = { ...V3, datum: `${V3_DATUM.slice(0, -2)}00ff` };

/** A Plutus V2 script, as a script reference holds one: `[2, bytes]`. */
const SCRIPT = hex(cbor([2, bytes("4e4d01000033222220051200120011")]));

/**
 * Minswap's swap from session 0's funding (session-swap.json's UTxO), shaped as fixtures/swap-tx.ts's: `order` (14
 * ₳), and the change back to the session's address on `network`.
 */
function swapPlacing(order: Order, network: Network = "preprod"): string {
  const lovelace = 14_000_000n;
  const out = new Map<number, Cbor>([
    [0, bytes(order.address)],
    [1, lovelace],
    [2, order.inline ? [1, { tag: 24, of: bytes(order.datum) }] : [0, blake2b(bytes(order.datum), { dkLen: 32 })]],
  ]);
  if (order.script) out.set(3, { tag: 24, of: bytes(order.script) });
  const change = new Map<number, Cbor>([
    [0, bytes(SESSION[network])],
    [1, FUNDED - lovelace - FEE],
  ]);
  const body = new Map<number, Cbor>([
    [0, { tag: 258, of: [[bytes(sessionSwap.utxo.tx_hash), sessionSwap.utxo.tx_index]] }],
    [1, [out, change]],
    [2, FEE],
    [3, 134_639_865],
  ]);
  const witnesses = new Map<number, Cbor>(order.inline ? [] : [[4, { tag: 258, of: [{ raw: order.datum }] }]]);
  return hex(cbor([body, witnesses, true, null]));
}

/**
 * Session 0 on `network`, funded (its funding confirmed, its account holding what the swap spends), running and
 * approved for the 10 ₳ swap, with Minswap building `swapCbor`; nothing placed yet. The mainnet order scripts'
 * reference UTxOs are where Koios's `utxo_info` finds them, as preprod's are (fakes.ts).
 */
async function seeded(network: Network, swapCbor: string) {
  const t = await unlocked();
  const sessions = signing(t);
  const now = t.clock.now;
  await t.store.set(`sessions.${network}`, {
    next: 1,
    sessions: [
      {
        index: 0,
        ownStake: true,
        createdAt: now,
        txs: [{ kind: "out", txHash: sessionSwap.utxo.tx_hash, at: now, confirmed: true }],
        swap: { ...ASK, amountOut: "906594100", minAmountOut: "902083681" },
        auto: { approved: { minAmountOut: "902083681", fund: { lovelace: "16000000", tokens: [] } } },
      },
    ],
  });
  t.koios.confirmations = 1;
  t.koios.addedToAccounts.push({
    ...atSession(sessionSwap.utxo.tx_hash, sessionSwap.utxo.tx_index, sessionSwap.utxo.value),
    address: bech32(network === "mainnet" ? "addr" : "addr_test", bytes(SESSION[network])),
  } as KoiosUtxo);
  if (network === "mainnet") {
    for (const f of FIXTURES.filter((x) => x.network === "mainnet" && x.reference)) {
      t.koios.addedToAccounts.push({
        stake_address: null,
        payment_cred: "00".repeat(28),
        epoch_no: 300,
        block_height: 4_000_000,
        block_time: 1_700_000_000,
        inline_datum: null,
        datum_hash: null,
        asset_list: [],
        ...f.reference!,
      } as KoiosUtxo);
    }
  }
  t.minswap.swapCbor = swapCbor;
  return { t, sessions };
}

/** What the runner makes of `order`, placed by session 0 on `network`. */
async function placing(order: Order, network: Network = "preprod") {
  const { t, sessions } = await seeded(network, swapPlacing(order, network));
  const view = await sessions.advance(network, 0, true);
  return { t, sessions, view };
}

/** How often Koios's `utxo_info` was asked about `ref`. */
const askedAbout = (t: T, ref: string) =>
  t.koios.calls.filter((c) => c.path === "utxo_info" && (c.body._utxo_refs as string[]).includes(ref)).length;

/** The service's WebAssembly, its own copy (swap-session.ts `signing`): a test stands a call in on it. */
const wasmOf = (sessions: SessionService) =>
  (sessions as unknown as { deps: { wasm: Record<string, (...args: never[]) => string> } }).deps.wasm;

describe("a swap's outputs, as the order check reads them (builtOutputs)", () => {
  it("say whether each holds its datum inline, and carries a script", () => {
    const form = (swap: string) => builtOutputs(bytes(swap)).map(({ datum, inline, scriptRef }) => ({ datum, inline, scriptRef }));
    const change = { datum: null, inline: false, scriptRef: false };
    expect(form(swapPlacing(MINSWAP_V1))).toEqual([{ datum: ORDER_DATUM, inline: false, scriptRef: false }, change]);
    expect(form(swapPlacing({ ...MINSWAP_V1, inline: true }))).toEqual([{ datum: ORDER_DATUM, inline: true, scriptRef: false }, change]);
    expect(form(swapPlacing({ ...MINSWAP_V1, script: SCRIPT }))).toEqual([{ datum: ORDER_DATUM, inline: false, scriptRef: true }, change]);
    // A legacy output, an array: its datum by its hash, and nowhere for a script.
    const legacy = new Map<number, Cbor>([
      [0, { tag: 258, of: [[bytes(sessionSwap.utxo.tx_hash), sessionSwap.utxo.tx_index]] }],
      [1, [[bytes(ORDER_ADDRESS), 14_000_000, blake2b(bytes(ORDER_DATUM), { dkLen: 32 })]]],
      [2, 205_189],
    ]);
    const witnesses = new Map<number, Cbor>([[4, { tag: 258, of: [{ raw: ORDER_DATUM }] }]]);
    expect(form(hex(cbor([legacy, witnesses, true, null])))).toEqual([{ datum: ORDER_DATUM, inline: false, scriptRef: false }]);
  });
});

describe("an order no cancel could ever spend (release review C05)", () => {
  /** Whether the step asked Koios what a dry run of the swap's cancels reads: refused by its form, it never gets there. */
  const dryRun = (t: T) => t.koios.calls.some((c) => c.path === "epoch_params");

  it("pauses rather than sign a Minswap V1 order holding its datum inline, which its Plutus V1 script can never spend", async () => {
    const { t, view } = await placing({ ...MINSWAP_V1, inline: true });
    expect(view.auto!.paused).toMatchObject({ why: "refused", detail: NOT_CANCELLABLE });
    expect(view.txs.map((x) => x.kind)).toEqual(["out"]);
    expect(t.koios.submitted).toHaveLength(0);
    // Read in its form (builtOutputs, readDexOrder), it's no order of the session's before any cancel is built.
    expect(dryRun(t)).toBe(false);
  });

  it("pauses rather than sign an order carrying a script, by hash or inline, at Plutus V1's script or V2's", async () => {
    const minswapV2 = realOrder(REAL.find((r) => r.protocol === "MinswapV2" && r.network === "preprod")!);
    for (const order of [MINSWAP_V1, minswapV2]) {
      const { t, view } = await placing({ ...order, script: SCRIPT });
      expect(view.auto!.paused, order.address).toMatchObject({ why: "refused", detail: NOT_CANCELLABLE });
      expect(t.koios.submitted).toHaveLength(0);
      expect(dryRun(t), order.address).toBe(false);
    }
  });

  it("pauses rather than sign a SundaeSwap V3 order whose datum its script can't decode, though it names the session", async () => {
    // The reader alone takes it as the session's: only the dry run of its cancel, V3's own script, finds it.
    expect(dexOrderAt(loadTestWasm(), "preprod", V3_SEVENTH.address, V3_SEVENTH.datum, sessionSwap.address)).toMatchObject({ known: true, ours: true });
    const { t, sessions } = await seeded("preprod", swapPlacing(V3_SEVENTH));
    const wasm = wasmOf(sessions);
    const check = wasm.checkOrderCancels!;
    const answers: unknown[] = [];
    wasm.checkOrderCancels = ((request: string) => {
      const answer = check(request as never);
      answers.push(JSON.parse(answer));
      return answer;
    }) as never;
    const view = await sessions.advance("preprod", 0, true);
    expect(view.auto!.paused).toMatchObject({ why: "refused", detail: NOT_CANCELLABLE });
    expect(t.koios.submitted).toHaveLength(0);
    // V3's own script turned the wallet's cancel down, its script read from V3's reference UTxO as Koios lists it.
    expect(answers).toEqual([
      { orders: [expect.objectContaining({ index: 0, cancels: false, why: expect.stringContaining("The DEX's order script refused the wallet's cancel") })] },
    ]);
    expect(askedAbout(t, V3_REFERENCE)).toBe(1);
  });

  it("is refused by Review it myself as by the runner, and nothing is kept to send", async () => {
    for (const order of [{ ...MINSWAP_V1, inline: true }, V3_SEVENTH]) {
      const { t, sessions } = await seeded("preprod", swapPlacing(order));
      await expect(sessions.swapBuild("preprod", 0)).rejects.toThrow(`The wallet won't sign what Minswap built: ${NOT_CANCELLABLE}`);
      // Nothing kept for Send, so the refused swap can't be sent by its own id (1.3.0's release review, X07).
      expect(await t.session.get(SESSION_TX), order.address).toBeUndefined();
      await expect(sessions.txSubmit("preprod", txIdOf(bytes(swapPlacing(order))), "swap")).rejects.toThrow("That swap isn't ready to send.");
      expect(t.koios.submitted).toHaveLength(0);
    }
  });

  it("pauses rather than sign one whose cancel would cost more than Stop's own cancel may pay", async () => {
    for (const [fee, placed] of [
      ["3000001", false],
      ["3000000", true],
    ] as const) {
      const { t, sessions } = await seeded("preprod", swapPlacing(MINSWAP_V1));
      const wasm = wasmOf(sessions);
      const check = wasm.checkOrderCancels!;
      wasm.checkOrderCancels = ((request: string) => {
        const answer = JSON.parse(check(request as never)) as { orders: Array<{ fee: string | null }> };
        for (const o of answer.orders) o.fee = fee;
        return JSON.stringify(answer);
      }) as never;
      const view = await sessions.advance("preprod", 0, true);
      if (placed) {
        expect(view.auto!.paused, fee).toBeUndefined();
        expect(t.koios.submitted, fee).toHaveLength(1);
      } else {
        expect(view.auto!.paused, fee).toMatchObject({ why: "refused", detail: NOT_CANCELLABLE });
        expect(t.koios.submitted, fee).toHaveLength(0);
      }
    }
  });
});

describe("the real orders a swap places", () => {
  it("places session 0's own Minswap V1 order, by its datum's hash, with no reference to read", async () => {
    const { t, view } = await placing(MINSWAP_V1);
    expect(view.auto!.paused).toBeUndefined();
    expect(view.auto!.retry).toBeUndefined();
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
    expect(t.koios.submitted).toHaveLength(1);
    expect(t.koios.calls.some((c) => c.path === "utxo_info")).toBe(false);
  });

  it("places a V3 order Minswap builds, holding its datum inline, its script read from V3's reference", async () => {
    const { t, view } = await placing(V3);
    expect(view.auto!.paused).toBeUndefined();
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
    expect(askedAbout(t, V3_REFERENCE)).toBe(1);
  });

  it.each(REAL)("places the real $protocol order on $network (stuck: $stuck), made out to the session", async (real) => {
    const order = realOrder(real);
    // Made out to the session, as the check reads it.
    expect(dexOrderAt(loadTestWasm(), real.network, order.address, order.datum, bech32(real.network === "mainnet" ? "addr" : "addr_test", bytes(SESSION[real.network])))).toMatchObject({
      known: true,
      ours: true,
      why: null,
    });
    const { t, view } = await placing(order, real.network);
    expect(view.auto!.paused).toBeUndefined();
    expect(view.auto!.retry).toBeUndefined();
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
    expect(t.koios.submitted).toHaveLength(1);
    // Its script read from its reference UTxO, as Koios lists it; a Plutus V1 one's is in the wallet.
    if (order.reference) expect(askedAbout(t, order.reference)).toBe(1);
  });
});

describe("the order scripts' reference UTxOs, from Koios", () => {
  it("are asked for once a worker's life: pinned, they don't change", async () => {
    const { t, sessions } = await seeded("preprod", swapPlacing(V3));
    await sessions.swapBuild("preprod", 0);
    await sessions.swapBuild("preprod", 0);
    const view = await sessions.advance("preprod", 0, true);
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
    expect(askedAbout(t, V3_REFERENCE)).toBe(1);
  });

  it("not given, hold the swap unsigned, tried again rather than refused, and it's placed once Koios gives them", async () => {
    const { t, sessions } = await seeded("preprod", swapPlacing(V3));
    const real = t.koios.fetch;
    const reference = (init: RequestInit) => String(init.body ?? "").includes(V3_REFERENCE);
    // Koios fails the request, then answers it without the row, then with a row that holds no script.
    const answers: Array<(url: string, init: RequestInit) => Promise<Response>> = [
      async (url, init) => (url.endsWith("/utxo_info") && reference(init) ? new Response("upstream down", { status: 502 }) : real(url, init)),
      async (url, init) => (url.endsWith("/utxo_info") && reference(init) ? Response.json([]) : real(url, init)),
      async (url, init) => {
        const answer = await real(url, init);
        if (!url.endsWith("/utxo_info") || !reference(init)) return answer;
        const rows = (await answer.json()) as KoiosUtxo[];
        return Response.json(rows.map((r) => ({ ...r, reference_script: null })));
      },
    ];
    for (const [i, answer] of answers.entries()) {
      t.koios.fetch = answer;
      const view = await sessions.advance("preprod", 0, true);
      expect(view.auto!.paused, `answer ${i}`).toBeUndefined();
      expect(view.auto!.retry, `answer ${i}`).toMatchObject({ reason: "koios-silent" });
      expect(t.koios.submitted, `answer ${i}`).toHaveLength(0);
    }
    t.koios.fetch = real;
    const view = await sessions.advance("preprod", 0, true);
    expect(view.auto!.retry).toBeUndefined();
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
  });
});

describe("the wallet's own cancel, refused by hand (release review C15, C19)", () => {
  /** Session 0's swap placed and landed, its order waiting at Minswap V1's script; then Cancel order pressed, its cancel what `built` answers. */
  async function cancelling(built: (request: string) => string) {
    const { t, sessions } = await seeded("preprod", swapPlacing(MINSWAP_V1));
    await sessions.advance("preprod", 0, true);
    ordered(t);
    wasmOf(sessions).buildOrderCancel = built as never;
    return sessions.cancelBuild("preprod", 0).then(
      () => undefined,
      (e: unknown) => (e as Error).message,
    );
  }

  /** A cancel of the swap's order, everything back to the session, that also needs `signer`'s signature. */
  const cancelTx = (signer: string) => {
    const own = bytes(SESSION_ADDRESS);
    const body = new Map<number, Cbor>([
      [0, { tag: 258, of: [[bytes(SWAP_TX), 1], [bytes(SWAP_TX), 0]] }],
      [1, [new Map<number, Cbor>([[0, own], [1, 131_585_414 + 14_000_000 - 400_000]])]],
      [2, 400_000],
      [3, 134_639_865],
      [13, { tag: 258, of: [[bytes(SWAP_TX), 1]] }],
      [14, { tag: 258, of: [bytes(PAYMENT), bytes(signer)] }],
      [16, new Map<number, Cbor>([[0, own], [1, 131_585_414 - 600_000]])],
      [17, 600_000],
    ]);
    const redeemers = new Map<number, Cbor>([[5, [[0, 0, { tag: 122, of: [] }, [500_000, 200_000_000]]]]]);
    return hex(cbor([body, redeemers, true, null]));
  };

  it("says the wallet couldn't cancel the order, never that it won't sign what Minswap built", async () => {
    // The wallet's own build refused in WebAssembly, and one its checks refuse to sign.
    const unbuilt = await cancelling(() => {
      throw new Error("The session's collateral is too small to cover the cancel's fee and come back as an output");
    });
    expect(unbuilt).toBe(
      "The wallet couldn't cancel the order: the session's collateral is too small to cover the cancel's fee and come back as an output",
    );
    const unsigned = await cancelling(() => JSON.stringify({ txCbor: cancelTx("ee".repeat(28)), covers: [`${SWAP_TX}#0`], stakeSigns: false }));
    expect(unsigned).toBe("The wallet couldn't cancel the order: it needs someone else's signature too.");
    for (const message of [unbuilt, unsigned]) expect(message).not.toMatch(/Minswap/);
  });

  it("says it can't read the cancel it built, not a transaction Minswap built", async () => {
    const unread = await cancelling(() => JSON.stringify({ txCbor: "00", covers: [`${SWAP_TX}#0`], stakeSigns: false }));
    expect(unread).toBe("The wallet can't read the cancel it built.");
  });
});
