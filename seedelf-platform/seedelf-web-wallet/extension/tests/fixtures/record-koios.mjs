// Records the Koios fixtures the balance tests use. Run from extension/ after
// `npm run build:wasm`:  node tests/fixtures/record-koios.mjs
//
// koios-preprod.json  real preprod responses: the wallet contract's UTxOs, and
//                     the Cardano accounts of two public test-vector phrases
// owned-utxos.json    synthetic contract UTxOs owned by the 12-word vector
//                     phrase (no phrase wallet owns real ones yet), made with
//                     the WebAssembly module: re-randomized base registers
import { readFileSync, writeFileSync } from "node:fs";

const wasmPkg = new URL("../../../wasm/pkg/", import.meta.url);
const wasm = await import(new URL("seedelf_wasm.js", wasmPkg));
wasm.initSync({ module: readFileSync(new URL("seedelf_wasm_bg.wasm", wasmPkg)) });

const KOIOS = "https://preprod.koios.rest/api/v1";
const WALLET_CONTRACT = "94bca9c099e84ffd90d150316bb44c31a78702239076a0a80ea4a469";
const SEEDELF_POLICY = "84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255";

const vectors = JSON.parse(
  readFileSync(new URL("../../../../seedelf-crypto/tests/vectors/cardano_account.json", import.meta.url)),
).vectors.filter((v) => v.account === 0);
const byWords = (n) => vectors.find((v) => v.phrase.split(" ").length === n && (n !== 24 || v.phrase.endsWith(" art")));

async function post(path, body) {
  const r = await fetch(`${KOIOS}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

const accounts = {};
for (const v of [byWords(12), byWords(24)]) {
  const stake = v.preprod.stake;
  accounts[stake] = {
    phrase_words: v.phrase.split(" ").length,
    account_addresses: await post("account_addresses", { _stake_addresses: [stake], _empty: true }),
    account_utxos: await post("account_utxos", { _stake_addresses: [stake], _extended: true }),
  };
}
const contract_utxos = await post("credential_utxos", { _payment_credentials: [WALLET_CONTRACT], _extended: true });

writeFileSync(
  new URL("koios-preprod.json", import.meta.url),
  `${JSON.stringify({ recorded: new Date().toISOString(), network: "preprod", wallet_contract: WALLET_CONTRACT, contract_utxos, accounts }, null, 1)}\n`,
);

// Synthetic owned UTxOs for the 12-word phrase, shaped like Koios rows.
const owner = byWords(12);
const key = wasm.SeedelfKey.fromPhrase(owner.phrase, 0);
const address = contract_utxos.find((u) => !u.stake_address).address;
const hex = (bytes) => Buffer.from(bytes).toString("hex");
function owned(txByte, lovelace, asset_list) {
  const register = wasm.rerandomize(key.baseRegister());
  const utxo = {
    tx_hash: txByte.repeat(32),
    tx_index: 0,
    address,
    value: String(lovelace),
    stake_address: null,
    payment_cred: WALLET_CONTRACT,
    epoch_no: 315,
    block_height: 5212000,
    block_time: 1790200000,
    datum_hash: null,
    inline_datum: {
      bytes: hex(wasm.registerToDatum(register)),
      value: { fields: [{ bytes: register.generator }, { bytes: register.publicValue }], constructor: 0 },
    },
    reference_script: null,
    asset_list,
    is_spent: false,
  };
  register.free();
  return utxo;
}
const label = Buffer.from("web-wallet").toString("hex");
const seedelfName = `5eed0e1f${label}00${"ab".repeat(32)}`.slice(0, 64);
const owned_utxos = [
  owned("a1", 25_000_000, []),
  owned("a2", 3_000_000, [
    { decimals: 6, quantity: "1234560000", policy_id: "c0".repeat(28), asset_name: Buffer.from("tUSDM").toString("hex"), fingerprint: "asset1synthetictusdm" },
  ]),
  owned("a3", 1_500_000, [
    { decimals: 0, quantity: "1", policy_id: SEEDELF_POLICY, asset_name: seedelfName, fingerprint: "asset1syntheticseedelf" },
  ]),
];
key.free();
writeFileSync(
  new URL("owned-utxos.json", import.meta.url),
  `${JSON.stringify({ owner: "the 12-word cardano_account.json vector, Seedelf account 0", owned_utxos }, null, 1)}\n`,
);
console.log(`contract ${contract_utxos.length} UTxOs; accounts`, Object.values(accounts).map((a) => a.account_utxos.length), "; owned", owned_utxos.length);
