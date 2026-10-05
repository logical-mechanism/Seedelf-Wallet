// Records a real mint round trip on preprod for the mint tests. Run from
// extension/ after `npm run build:wasm`:  node tests/fixtures/record-mint.mjs
//
// It creates a seedelf through WebAssembly, as the worker does, for the
// 12-word vector phrase's synthetic owned UTxOs (owned-utxos.json):
//
//   buildMint      the transaction, under a new one-time key, measured by
//                  the wallet's own evaluator, as the worker builds it
//                  (background/mint.ts)
//   Ogmios         preprod Koios evaluates that transaction, a check the
//                  worker doesn't make: declaredCovers must find the wallet's
//                  budgets cover what the network measures. The UTxOs aren't
//                  on chain, so they go along as `additionalUtxo`; the
//                  scripts, reference inputs and giveme.my's collateral UTxO
//                  are real.
//   giveme.my      asked to witness it. It checks a transaction against the
//                  chain first, so it refuses this one (the inputs don't
//                  exist): the recorded answer is that refusal.
//
// Nothing is submitted. mint-preprod.json keeps each step, so tests can
// replay the flow on real data.
//
// The committed mint-preprod.json is older than this script: the draftMint →
// Ogmios → finishMint recording of 2026-09-24, from before a mint was
// measured in the wallet (the crypto review). A new recording has no `draft`,
// and its `evaluation` is the finished transaction's; nothing reads `draft`.
import { readFileSync, writeFileSync } from "node:fs";

const wasmPkg = new URL("../../../wasm/pkg/", import.meta.url);
const wasm = await import(new URL("seedelf_wasm.js", wasmPkg));
wasm.initSync({ module: readFileSync(new URL("seedelf_wasm_bg.wasm", wasmPkg)) });

const KOIOS = "https://preprod.koios.rest/api/v1";
const COLLATERAL = "https://www.giveme.my/preprod/collateral/";
const SEEDELF_POLICY = "84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255";
const LABEL = "web-wallet";

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const phrase = json("../../../../seedelf-crypto/tests/vectors/cardano_account.json").vectors.find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
).phrase;
const utxos = json("owned-utxos.json").owned_utxos.filter(
  (u) => !(u.asset_list ?? []).some((a) => a.policy_id === SEEDELF_POLICY),
);

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
const key = wasm.SeedelfKey.fromPhrase(phrase, 0);
const request = { network: "preprod", params, utxos, label: LABEL };

const final = JSON.parse(wasm.buildMint(key, JSON.stringify(request)));
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
  new URL("mint-preprod.json", import.meta.url),
  `${JSON.stringify(
    {
      recorded: new Date().toISOString(),
      network: "preprod",
      owner: "the 12-word cardano_account.json vector, Seedelf account 0",
      epoch: params.epoch_no,
      label: LABEL,
      evaluation,
      final,
      collateral,
    },
    null,
    1,
  )}\n`,
);
console.log(
  `mint of ${final.tokenName}: ${final.inputs.length} input(s), fee ${final.fee.total}, tx ${final.txHash}; giveme.my: ${collateral.status} ${JSON.stringify(collateral.answer)}`,
);
