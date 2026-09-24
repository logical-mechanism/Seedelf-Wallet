// Records a real seedelf mint paid by a Cardano account, on preprod, for the
// account-mint tests. Run from extension/ after `npm run build:wasm`:
//   node tests/fixtures/record-account-mint.mjs
//
// It builds the mint through WebAssembly, as the worker does, from the live
// UTxOs of the 12-word vector phrase's account (a public test phrase with
// preprod funds), and has preprod Ogmios (through Koios) evaluate the draft.
// The inputs are real, so the policy runs as it would on submit. Then it
// finishes and signs the mint, but never submits it, and the fixture keeps
// only its hash and summary: a signed transaction over public-phrase UTxOs
// doesn't belong in the repository.
import { readFileSync, writeFileSync } from "node:fs";

const wasmPkg = new URL("../../../wasm/pkg/", import.meta.url);
const wasm = await import(new URL("seedelf_wasm.js", wasmPkg));
wasm.initSync({ module: readFileSync(new URL("seedelf_wasm_bg.wasm", wasmPkg)) });

const KOIOS = "https://preprod.koios.rest/api/v1";
const LABEL = "account-mint";

const vectors = JSON.parse(
  readFileSync(new URL("../../../../seedelf-crypto/tests/vectors/cardano_account.json", import.meta.url)),
).vectors;
const phrase = vectors.find((v) => v.account === 0 && v.phrase.split(" ").length === 12).phrase;

async function post(path, body, allow400 = false) {
  const r = await fetch(`${KOIOS}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok && !(allow400 && r.status === 400)) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

const account = wasm.CardanoAccount.fromPhrase(phrase, 0);
const key = wasm.SeedelfKey.fromPhrase(phrase, 0);
const stake = account.stakeAddress(wasm.Network.Preprod);
const paths = new Map();
for (let i = 0; i < 20; i++) {
  paths.set(account.receiveAddress(wasm.Network.Preprod, i), [0, i]);
  paths.set(account.changeAddress(wasm.Network.Preprod, i), [1, i]);
}
const [params] = await (await fetch(`${KOIOS}/epoch_params?limit=1`)).json();
const rows = await post("account_utxos", { _stake_addresses: [stake], _extended: true });
const utxos = rows.filter((u) => paths.has(u.address)).map((utxo) => ({ utxo, role: paths.get(utxo.address)[0], index: paths.get(utxo.address)[1] }));
const request = { network: "preprod", params, utxos, label: LABEL };

const draft = JSON.parse(wasm.draftAccountMint(account, key, JSON.stringify(request)));
const evaluation = await post(
  "ogmios",
  { jsonrpc: "2.0", method: "evaluateTransaction", params: { transaction: { cbor: draft.draftCbor } } },
  true,
);
if (evaluation.error) throw new Error(`evaluation failed: ${JSON.stringify(evaluation.error)}`);
const { txCbor, ...final } = JSON.parse(wasm.finishAccountMint(account, key, JSON.stringify({ ...request, evaluation })));
account.free();
key.free();

writeFileSync(
  new URL("account-mint-preprod.json", import.meta.url),
  `${JSON.stringify(
    {
      recorded: new Date().toISOString(),
      network: "preprod",
      owner: "the 12-word cardano_account.json vector, account 0",
      epoch: params.epoch_no,
      label: LABEL,
      draft: { inputs: draft.inputs, collateral: draft.collateral },
      evaluation,
      final: { ...final, signedBytes: txCbor.length / 2 },
    },
    null,
    1,
  )}\n`,
);
console.log(
  `account mint of ${final.tokenName}: ${final.inputs.length} input(s), collateral ${final.collateral.txHash.slice(0, 8)}#${final.collateral.txIndex}, fee ${final.fee.total}, ${txCbor.length / 2} bytes signed; evaluation ${JSON.stringify(evaluation.result)}`,
);
