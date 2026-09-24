// Records real withdrawals on preprod for the withdraw tests. Run from
// extension/ after `npm run build:wasm`:  node tests/fixtures/record-withdraw.mjs
//
// Three Seedelf spends through WebAssembly, as the worker makes them, from
// the 12-word vector phrase's synthetic owned UTxOs (owned-utxos.json), to
// the 15-word vector phrase's receive address (someone else's):
//
//   amount   5 ADA and 1 tUSDM, with change back into the contract
//   max      everything spendable: both UTxOs and the tUSDM
//   remove   the phrase's synthetic seedelf "web-wallet" burned, its ADA to
//            the address
//
// Each is drafted, evaluated by preprod Ogmios (the owned UTxOs go along as
// `additionalUtxo`; the scripts, reference inputs and giveme.my's collateral
// UTxO are real), and finished. giveme.my is asked about the first one; it
// refuses, since the inputs aren't on chain. Nothing is submitted.
import { readFileSync, writeFileSync } from "node:fs";

const wasmPkg = new URL("../../../wasm/pkg/", import.meta.url);
const wasm = await import(new URL("seedelf_wasm.js", wasmPkg));
wasm.initSync({ module: readFileSync(new URL("seedelf_wasm_bg.wasm", wasmPkg)) });

const KOIOS = "https://preprod.koios.rest/api/v1";
const COLLATERAL = "https://www.giveme.my/preprod/collateral/";
const SEEDELF_POLICY = "84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255";

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const vectors = json("../../../../seedelf-crypto/tests/vectors/cardano_account.json").vectors;
const vector = (words) => vectors.find((v) => v.account === 0 && v.phrase.split(" ").length === words);
const to = vector(15).preprod.receive_0;
const owned = json("owned-utxos.json").owned_utxos;
const isSeedelf = (u) => (u.asset_list ?? []).some((a) => a.policy_id === SEEDELF_POLICY);
const utxos = owned.filter((u) => !isSeedelf(u));
const seedelf = owned.find(isSeedelf);
const tusdm = utxos.flatMap((u) => u.asset_list ?? [])[0];

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

const [params] = await (await fetch(`${KOIOS}/epoch_params?limit=1`)).json();
const key = wasm.SeedelfKey.fromPhrase(vector(12).phrase, 0);

/** Draft, evaluate on preprod, finish. */
async function record(draftFn, finishFn, request) {
  const draft = JSON.parse(draftFn(key, JSON.stringify(request)));
  const spent = owned.filter((u) => draft.inputs.some((i) => i.txHash === u.tx_hash && i.txIndex === u.tx_index));
  const { answer: evaluation } = await post(`${KOIOS}/ogmios`, {
    jsonrpc: "2.0",
    method: "evaluateTransaction",
    params: { transaction: { cbor: draft.draftCbor }, additionalUtxo: spent.map(ogmiosUtxo) },
  });
  if (evaluation.error) throw new Error(`evaluation failed: ${JSON.stringify(evaluation.error)}`);
  const final = JSON.parse(finishFn(key, JSON.stringify({ ...request, seed: draft.seed, evaluation })));
  return { request: { ...request, params: undefined }, draft, evaluation, final };
}

const base = { network: "preprod", params, utxos, to };
const amount = await record(wasm.draftWithdraw, wasm.finishWithdraw, {
  ...base,
  lovelace: "5000000",
  tokens: [{ policyId: tusdm.policy_id, assetName: tusdm.asset_name, quantity: "1000000" }],
});
const max = await record(wasm.draftWithdraw, wasm.finishWithdraw, { ...base, lovelace: null, tokens: [] });
const remove = await record(wasm.draftRemove, wasm.finishRemove, {
  network: "preprod",
  params,
  utxo: seedelf,
  to,
});
const collateral = await post(COLLATERAL, { tx: amount.final.txCbor });
key.free();

writeFileSync(
  new URL("withdraw-preprod.json", import.meta.url),
  `${JSON.stringify(
    {
      recorded: new Date().toISOString(),
      network: "preprod",
      owner: "the 12-word cardano_account.json vector, Seedelf account 0",
      to: "the 15-word cardano_account.json vector's receive address 0/0",
      epoch: params.epoch_no,
      amount,
      max,
      remove,
      collateral,
    },
    null,
    1,
  )}\n`,
);
for (const [name, r] of Object.entries({ amount, max, remove })) {
  console.log(`${name}: ${r.draft.inputs.length} input(s), fee ${r.final.fee.total}, lovelace ${r.final.lovelace}`);
}
console.log(`giveme.my: ${collateral.status} ${JSON.stringify(collateral.answer)}`);
