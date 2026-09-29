// A stranger's UTxO with a deeply nested datum or native reference script,
// through WebAssembly. Anyone can pay any address one, for about 1.5 ₳: it
// must neither make a whole request unreadable nor overflow the module's
// stack. The rows are spliced into the request as text, since JSON.stringify
// overflows V8's stack at a few thousand levels.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CardanoAccount, Network, SeedelfKey, buildAccountSend, lovejoinOwned } from "./wasm.mjs";

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const vectors = json("../../../seedelf-crypto/tests/vectors/cardano_account.json").vectors;
const phrase = vectors.find((v) => v.account === 0 && v.phrase.split(" ").length === 12).phrase;
const params = json("../../../seedelf-core/tests/fixtures/epoch_params.json")[0];
const koios = json("../../extension/tests/fixtures/koios-preprod.json");
const pool = json("../../extension/tests/fixtures/lovejoin-pool-preprod.json").pool;

const LEVELS = 100_000;

/** A Plutus list nested LEVELS deep: its CBOR, and Koios's JSON of it. */
const deepDatum = `{"bytes":"${"81".repeat(LEVELS)}00","value":${'{"list":['.repeat(LEVELS)}{"int":0}${"]}".repeat(LEVELS)}}`;

/** A native script nested LEVELS deep, as Koios lists a reference script. */
const deepScript = `{"hash":"${"ab".repeat(28)}","size":${3 * LEVELS + 1},"type":"timelock","bytes":"${"820181".repeat(LEVELS)}00","value":${'{"type":"all","scripts":['.repeat(LEVELS)}{"type":"sig","keyHash":"${"cd".repeat(28)}"}${"]}".repeat(LEVELS)}}`;

/** A Koios row like `template`, under `inlineDatum` and `referenceScript` (JSON text). */
function row(template, tx, inlineDatum, referenceScript) {
  const text = JSON.stringify({ ...template, tx_hash: tx.repeat(32), tx_index: 0, inline_datum: "DATUM", reference_script: "SCRIPT" });
  return text.replace('"DATUM"', inlineDatum).replace('"SCRIPT"', referenceScript);
}

/** `request` as JSON, with each `"<name>"` placeholder replaced by its row. */
function splice(request, rows) {
  let text = JSON.stringify(request);
  for (const [name, row] of Object.entries(rows)) {
    assert.ok(text.includes(`"${name}"`), name);
    text = text.replace(`"${name}"`, row);
  }
  return text;
}

test("a send from the Cardano account reads past a stranger's deep UTxOs", () => {
  const account = CardanoAccount.fromPhrase(phrase, 0);
  const home = account.receiveAddress(Network.Preprod, 0);
  const rows = koios.accounts[account.stakeAddress(Network.Preprod)].account_utxos;
  const utxos = rows.filter((u) => u.address === home).map((utxo) => ({ utxo, role: 0, index: 0 }));
  assert.ok(utxos.length > 0);
  const template = { ...utxos[0].utxo, value: "1500000", asset_list: [] };
  const to = vectors.find((v) => v.account === 0 && v.phrase.split(" ").length === 15).preprod.receive_0;
  const request = splice(
    {
      network: "preprod",
      params,
      utxos: [...utxos, { utxo: "datum", role: 0, index: 0 }, { utxo: "script", role: 0, index: 0 }],
      payments: [{ to, lovelace: "2000000", tokens: [] }],
    },
    { datum: row(template, "d1", deepDatum, "null"), script: row(template, "d2", "null", deepScript) },
  );
  const sent = JSON.parse(buildAccountSend(account, request));
  assert.equal(sent.payments[0].lovelace, "2000000");
  assert.match(sent.txHash, /^[0-9a-f]{64}$/);
  account.free();
});

test("a stranger's deep UTxO at mix_box leaves the Lovejoin pool readable", () => {
  const key = SeedelfKey.fromPhrase(phrase, 0);
  // Box-sized, at mix_box: its datum would be read if it weren't too deep.
  const box = { ...pool[0], inline_datum: null, datum_hash: null };
  const request = splice(
    { network: "preprod", pool: [...pool, "datum", "script"] },
    { datum: row(box, "d1", deepDatum, "null"), script: row(box, "d2", JSON.stringify(pool[0].inline_datum), deepScript) },
  );
  const owned = JSON.parse(lovejoinOwned(key, request));
  assert.deepEqual([owned.boxes, owned.lovelace], [[], "0"]);
  // Neither counts among the boxes to mix with.
  assert.equal(owned.others, pool.length);
  // The module is still whole.
  assert.deepEqual(JSON.parse(lovejoinOwned(key, JSON.stringify({ network: "preprod", pool }))), owned);
  key.free();
});
