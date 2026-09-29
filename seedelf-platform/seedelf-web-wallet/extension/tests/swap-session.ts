// A swap that runs itself, for the tests of its runner and its page
// (swap-runner.test.ts, swap-routes.test.ts): session 0 of the 12-word
// phrase, the real WebAssembly, and fakes of Koios, giveme.my and Minswap's
// aggregator, as sessions.test.ts sets them up.
import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { builtOutputs, Minswap } from "../src/background/minswap";
import { SessionService } from "../src/background/sessions";
import { bech32 } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { bytes, ORDER_ADDRESS, swapTx } from "./fixtures/swap-tx";
import { loadTestWasm, minswapEstimate, sessionSwap, testBalances, vectors, withdrawPreprod } from "./fakes";

export const PASSWORD = "correct horse battery";
export const MIN = "e16c2dc8ae937e8d3790c7fd7168d7b994621ba14ca11415f39fed724d494e";
export const ASK = minswapEstimate.ask;

export type T = Awaited<ReturnType<typeof unlocked>>;

export async function unlocked() {
  const t = testBalances();
  const phrase = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase;
  await t.wallet.create(phrase, PASSWORD);
  // One spend: the funding takes the 25 ₳ UTxO alone.
  const evaluation = withdrawPreprod.amount.evaluation as { result: unknown[] };
  t.koios.evaluation = { ...evaluation, result: evaluation.result.slice(0, 1) };
  return t;
}

/** A UTxO at session 0's account, as Koios lists it. */
export function atSession(tx_hash: string, tx_index: number, value: string, tokens: Array<[string, string]> = []): KoiosUtxo {
  return {
    tx_hash,
    tx_index,
    address: sessionSwap.address,
    value,
    stake_address: null,
    payment_cred: sessionSwap.keyHash,
    epoch_no: 315,
    block_height: 5_000_000,
    block_time: 1_800_000_000,
    datum_hash: null,
    inline_datum: null,
    reference_script: null,
    is_spent: false,
    asset_list: tokens.map(([id, quantity]) => ({
      policy_id: id.slice(0, 56),
      asset_name: id.slice(56),
      quantity,
      decimals: 0,
      fingerprint: "",
    })),
  } as KoiosUtxo;
}

/** Minswap's swap from session 0's funding, as the fake aggregator builds it, and its id. */
export const SWAP = swapTx();
export const SWAP_TX = txIdOf(bytes(SWAP));

/** Session 0's funding UTxO the recorded swap spends, as `txhash#index`. */
export const FUNDING = `${sessionSwap.utxo.tx_hash}#${sessionSwap.utxo.tx_index}`;

/** An order of session 0's, as Minswap lists it. */
export const ORDER = {
  owner_address: sessionSwap.address,
  protocol: "Minswap",
  token_in: {},
  token_out: {},
  amount_in: "10000000",
  min_amount_out: "902083681",
  created_at: 1,
  tx_in: `${SWAP_TX}#0`,
  dex_fee: "2000000",
  deposit: "2000000",
};

/** Koios takes what's submitted, then answers `status` as though it hadn't: a gateway that timed out, say. Returns the undo. */
export function unanswered(t: T, status = 504) {
  const real = t.koios.fetch;
  t.koios.fetch = async (url, init) => {
    const answer = await real(url, init);
    return url.endsWith("/submittx") ? new Response("upstream request timeout", { status }) : answer;
  };
  return () => {
    t.koios.fetch = real;
  };
}

/** Moves the clock on by `ms`, the user busy all along, so the wallet doesn't lock itself. */
export async function busy(t: T, ms: number) {
  for (let left = ms; left > 0; left -= 10 * 60_000) {
    t.clock.now += Math.min(left, 10 * 60_000);
    await t.wallet.touch();
  }
}

/** The session service with giveme.my's witness and the one-time key's signature stood in for, as sessions.test.ts has it. */
export function signing(t: T, extra: Partial<ConstructorParameters<typeof SessionService>[0]> = {}) {
  const wasm = loadTestWasm();
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  t.minswap.swapCbor = SWAP;
  return new SessionService({
    ...t.deps,
    wasm: {
      ...wasm,
      signScriptSpend: (_key: unknown, request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
    alarm: { start: async () => undefined },
    ...extra,
  });
}

/** Session 0's funding, sent: the one approval. */
export async function started(sessions: SessionService, ask = ASK) {
  const out = await sessions.outBuild("preprod", await sessions.quote("preprod", ask));
  await sessions.outSubmit("preprod", out.txHash);
  return out;
}

/** The funding lands: Koios confirms everything, and the account holds what the recorded swap spends, and its collateral. */
export function funded(t: T) {
  t.koios.confirmations = 1;
  t.koios.addedToAccounts.push(atSession(sessionSwap.utxo.tx_hash, sessionSwap.utxo.tx_index, sessionSwap.utxo.value));
}

/**
 * What the funding really submitted paid session 0's account, known to Koios
 * and spent: a session ends only once Koios shows it so (independent review M4).
 */
export function fundingOutsSpent(t: T) {
  const funding = t.koios.submitted[0];
  if (!funding) return;
  const id = txIdOf(funding);
  builtOutputs(funding).forEach((o, i) => {
    if (o.address.slice(2, 58) !== sessionSwap.keyHash) return;
    t.koios.addedToAccounts.push(atSession(id, i, o.lovelace.toString()));
    t.koios.spent.add(`${id}#${i}`);
  });
}

/** The swap `txHash` lands: its order waits at the DEX's contract (output 0), and its change is at the account. */
export function ordered(t: T, txHash = SWAP_TX) {
  t.koios.spent.add(FUNDING);
  t.koios.addedToAccounts.push(atSession(txHash, 1, "131585414"), {
    ...atSession(txHash, 0, "14000000"),
    address: bech32("addr_test", bytes(ORDER_ADDRESS)),
    payment_cred: "a6".repeat(28),
  });
}

/** The sealed record of the network's sessions, as the tests read it. */
export async function bookOf(t: T) {
  return (await t.store.get<{
    sessions: Array<{ index: number; closedAt?: number; auto?: Record<string, unknown>; txs: Array<Record<string, unknown>> }>;
  }>("sessions.preprod"))!;
}
