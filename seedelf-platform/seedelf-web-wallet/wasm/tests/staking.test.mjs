// buildStaking, poolId and drepId through WebAssembly, on the 12-word
// phrase's real preprod UTxOs and its recorded account_info (both in the
// extension's test fixtures).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CardanoAccount, Network, buildAccountSend, buildStaking, drepId, poolId } from "./wasm.mjs";

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const phrase = json("../../../seedelf-crypto/tests/vectors/cardano_account.json").vectors.find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
).phrase;
const params = json("../../../seedelf-core/tests/fixtures/epoch_params.json")[0];
const koios = json("../../extension/tests/fixtures/koios-preprod.json");
const staking = json("../../extension/tests/fixtures/staking-preprod.json");
const LOGIC = "pool1rccstu3l9ty3k0a5cd06fl3szsss9r34dcg5j38fqgq9kvng0tg";
const LOGIC_DREP = "drep1ydmraa6kv8cvmry059v608tehl50nfmg0z764lmsqkvwurs40sw2z";

function pathedUtxos(account) {
  const paths = new Map();
  for (let i = 0; i < 20; i++) {
    paths.set(account.receiveAddress(Network.Preprod, i), [0, i]);
    paths.set(account.changeAddress(Network.Preprod, i), [1, i]);
  }
  const rows = koios.accounts[account.stakeAddress(Network.Preprod)].account_utxos;
  return rows.filter((u) => paths.has(u.address)).map((utxo) => ({ utxo, role: paths.get(utxo.address)[0], index: paths.get(utxo.address)[1] }));
}

/** The recorded account_info, as the worker passes it. */
const info = staking.account_info[0];
const state = {
  registered: info.status === "registered",
  deposit: info.deposit,
  rewards: info.rewards_available,
  drep: info.delegated_drep,
};

test("builds and signs each staking transaction inside WebAssembly", () => {
  const account = CardanoAccount.fromPhrase(phrase, 0);
  const utxos = pathedUtxos(account);
  const build = (action, s = state) => JSON.parse(buildStaking(account, JSON.stringify({ network: "preprod", params, utxos, action, state: s })));

  const first = build({ kind: "delegate", pool: LOGIC }, { registered: false, deposit: "0", rewards: "0", drep: null });
  assert.equal(first.pool, LOGIC);
  assert.equal(first.deposit, "2000000");
  assert.deepEqual(first.action, { kind: "delegate", pool: LOGIC });
  assert.match(first.txHash, /^[0-9a-f]{64}$/);
  assert.ok(Number(first.fee) > 150_000 && Number(first.fee) < 400_000, first.fee);

  const vote = build({ kind: "vote", drep: LOGIC_DREP });
  assert.equal(vote.drep, LOGIC_DREP);
  assert.equal(vote.deposit, "0");

  const withdraw = build({ kind: "withdraw" });
  assert.equal(withdraw.withdrawal, "57475311");

  const stop = build({ kind: "stop" });
  assert.equal(stop.refund, "2000000");
  assert.equal(stop.withdrawal, "57475311");

  // Without a vote delegation, Conway locks the rewards: refused, and said why.
  assert.throws(() => build({ kind: "withdraw" }, { ...state, drep: null }), /voting power/);
  assert.throws(() => build({ kind: "teleport" }), /bad staking request/);
  account.free();
});

test("a send takes the rewards along when asked", () => {
  const account = CardanoAccount.fromPhrase(phrase, 0);
  const to = account.receiveAddress(Network.Preprod, 5);
  const send = (withdrawal) =>
    JSON.parse(
      buildAccountSend(
        account,
        JSON.stringify({ network: "preprod", params, utxos: pathedUtxos(account), to, lovelace: "1000000", tokens: [], withdrawal }),
      ),
    );
  assert.equal(send(undefined).withdrawal, "0");
  assert.equal(send("57475311").withdrawal, "57475311");
  account.free();
});

test("reads pool and DRep IDs the way Koios names them", () => {
  assert.equal(poolId("1e3105f23f2ac91b3fb4c35fa4fe301421028e356e114944e902005b"), LOGIC);
  assert.throws(() => poolId(LOGIC_DREP), /stake pool ID/);
  assert.equal(drepId(LOGIC_DREP), LOGIC_DREP);
  assert.equal(drepId("drep_always_abstain"), "drep_always_abstain");
  assert.throws(() => drepId(LOGIC), /DRep ID/);
});
