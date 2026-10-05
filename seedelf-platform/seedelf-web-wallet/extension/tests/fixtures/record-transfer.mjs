// Records a real transfer round trip on preprod for the transfer tests. Run
// from extension/ after `npm run build:wasm`:  node tests/fixtures/record-transfer.mjs
//
// It pays a live preprod seedelf through WebAssembly, as the worker does,
// from the 12-word vector phrase's synthetic owned UTxOs (owned-utxos.json):
//
//   lookup          the whole wallet contract from Koios (credential_utxos),
//                   then the UTxO holding the recipient's seedelf, picked
//                   locally: Koios is never asked about the recipient.
//   buildTransfer   the transaction, under a new one-time key, measured by the
//                   wallet's own evaluator, as the worker builds it
//                   (background/transfer.ts). It sends 5 ADA and 1 of the
//                   synthetic tUSDM, so two inputs pay.
//   Ogmios          preprod Koios evaluates that transaction, a check the
//                   worker doesn't make: declaredCovers must find the
//                   wallet's budgets cover what the network measures. The
//                   owned UTxOs aren't on chain, so they go along as
//                   `additionalUtxo`; the wallet script, its reference input
//                   and giveme.my's collateral UTxO are real.
//   giveme.my       asked to witness it. It checks a transaction against the
//                   chain first, so it refuses this one (the inputs don't
//                   exist): the recorded answer is that refusal.
//
// Nothing is submitted. transfer-preprod.json keeps each step, so tests can
// replay the flow on real data.
//
// The committed transfer-preprod.json is older than this script: the
// draftTransfer → Ogmios → finishTransfer recording of 2026-09-24, from
// before a transfer took a list of payments (chunk 14) and was measured in
// the wallet (the crypto review). Tests read its `draft`, its `final.to`,
// and its `final.fee`, the network's measure, to compare theirs with
// (wasm/tests/api_test.rs and transfer.test.mjs; tests/spent.test.ts and
// transfer.test.ts). A new recording has no `draft`, its `final` is
// buildTransfer's (`payments`, and the wallet's own fee), and its
// `evaluation` is the finished transaction's: move those readers in the
// same change.
import { readFileSync, writeFileSync } from "node:fs";

const wasmPkg = new URL("../../../wasm/pkg/", import.meta.url);
const wasm = await import(new URL("seedelf_wasm.js", wasmPkg));
wasm.initSync({ module: readFileSync(new URL("seedelf_wasm_bg.wasm", wasmPkg)) });

const KOIOS = "https://preprod.koios.rest/api/v1";
const COLLATERAL = "https://www.giveme.my/preprod/collateral/";
const WALLET_CONTRACT = "94bca9c099e84ffd90d150316bb44c31a78702239076a0a80ea4a469";
const SEEDELF_POLICY = "84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255";
/** "This is a test.", a seedelf the 12-word phrase doesn't own; any other live one if it's gone. */
const PREFERRED = "5eed0e1f54686973206973206120746573742e01";
const LOVELACE = "5000000";

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const phrase = json("../../../../seedelf-crypto/tests/vectors/cardano_account.json").vectors.find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
).phrase;
const utxos = json("owned-utxos.json").owned_utxos.filter(
  (u) => !(u.asset_list ?? []).some((a) => a.policy_id === SEEDELF_POLICY),
);
const tusdm = utxos.flatMap((u) => u.asset_list ?? [])[0];
const tokens = [{ policyId: tusdm.policy_id, assetName: tusdm.asset_name, quantity: "1000000" }];

/** POSTs JSON; returns the HTTP status and the JSON answer (Ogmios and giveme.my explain a 400). */
async function post(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok && r.status !== 400) throw new Error(`${url}: ${r.status} ${text}`);
  return { status: r.status, answer: JSON.parse(text) };
}

/** An Ogmios v6 UTxO for `additionalUtxo`. */
function ogmiosUtxo(u) {
  const value = { ada: { lovelace: Number(u.value) } };
  for (const a of u.asset_list ?? []) (value[a.policy_id] ??= {})[a.asset_name] = Number(a.quantity);
  return { transaction: { id: u.tx_hash }, index: u.tx_index, address: u.address, value, datum: u.inline_datum.bytes };
}

const key = wasm.SeedelfKey.fromPhrase(phrase, 0);
const seedelfOf = (u) => (u.asset_list ?? []).find((a) => a.policy_id === SEEDELF_POLICY)?.asset_name;
const theirs = (u) => {
  const [g, v] = u.inline_datum?.value?.fields?.map((f) => f.bytes) ?? [];
  if (!g || !v) return false;
  const register = new wasm.Register(g, v);
  try {
    return !key.isOwned(register);
  } catch {
    return false;
  } finally {
    register.free();
  }
};

const [params] = await (await fetch(`${KOIOS}/epoch_params?limit=1`)).json();
const { answer: contract } = await post(`${KOIOS}/credential_utxos?limit=1000`, {
  _payment_credentials: [WALLET_CONTRACT],
  _extended: true,
});
const seedelfs = contract.filter((u) => seedelfOf(u) && theirs(u));
const recipient = seedelfs.find((u) => seedelfOf(u).startsWith(PREFERRED)) ?? seedelfs[0];
if (!recipient) throw new Error("no live Seedelf to pay on preprod");
const to = seedelfOf(recipient);

// As the worker asks, less `classes`: the synthetic UTxOs have no history.
const request = { network: "preprod", params, utxos, payments: [{ to, recipient, lovelace: LOVELACE, tokens }] };
const final = JSON.parse(wasm.buildTransfer(key, JSON.stringify(request)));
const spent = utxos.filter((u) => final.inputs.some((i) => i.txHash === u.tx_hash && i.txIndex === u.tx_index));
const { answer: evaluation } = await post(`${KOIOS}/ogmios`, {
  jsonrpc: "2.0",
  method: "evaluateTransaction",
  params: { transaction: { cbor: final.txCbor }, additionalUtxo: spent.map(ogmiosUtxo) },
});
if (evaluation.error) throw new Error(`evaluation failed: ${JSON.stringify(evaluation.error)}`);
const checked = JSON.parse(wasm.declaredCovers(final.txCbor, JSON.stringify(evaluation)));
if (!checked.covers) throw new Error(`the wallet's budgets don't cover preprod's: ${checked.reason}`);

const collateral = await post(COLLATERAL, { tx: final.txCbor });
key.free();

writeFileSync(
  new URL("transfer-preprod.json", import.meta.url),
  `${JSON.stringify(
    {
      recorded: new Date().toISOString(),
      network: "preprod",
      owner: "the 12-word cardano_account.json vector, Seedelf account 0",
      epoch: params.epoch_no,
      to,
      recipient,
      lovelace: LOVELACE,
      tokens,
      evaluation,
      final,
      collateral,
    },
    null,
    1,
  )}\n`,
);
console.log(
  `transfer to ${to}: ${final.inputs.length} input(s), fee ${final.fee.total}, tx ${final.txHash}; giveme.my: ${collateral.status} ${JSON.stringify(collateral.answer)}`,
);
