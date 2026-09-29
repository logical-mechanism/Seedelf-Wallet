// Size and speed of a built module: what a smaller build costs, if anything.
//
//   node bench.mjs [pkg-dir]        (default ./pkg; run ./build.sh first)
//
// Sizes are the .wasm file raw, gzipped (-9) and brotli'd (11). Times are
// medians in milliseconds, in Node's V8, the engine Chrome runs the worker
// in, on the same fixtures as the tests.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const dir = resolve(process.argv[2] ?? new URL("pkg", import.meta.url).pathname);
const bytes = readFileSync(`${dir}/seedelf_wasm_bg.wasm`);
const wasm = await import(pathToFileURL(`${dir}/seedelf_wasm.js`).href);
wasm.initSync({ module: bytes });

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const phrase = json("../../seedelf-crypto/tests/vectors/cardano_account.json").vectors.find(
  (v) => v.account === 0 && v.phrase.split(" ").length === 12,
).phrase;
const params = json("../../seedelf-core/tests/fixtures/epoch_params.json")[0];
const koios = json("../extension/tests/fixtures/koios-preprod.json");
const owned = json("../extension/tests/fixtures/owned-utxos.json").owned_utxos;
const transfer = json("../extension/tests/fixtures/transfer-preprod.json");

function median(runs, fn) {
  fn(); // warm up
  const times = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(runs / 2)];
}

const key = wasm.SeedelfKey.fromPhrase(phrase, 0);
const account = wasm.CardanoAccount.fromPhrase(phrase, 0);
const register = wasm.rerandomize(key.baseRegister());
const vkh = "ab".repeat(28);

const paths = new Map();
for (let i = 0; i < 20; i++) {
  paths.set(account.receiveAddress(wasm.Network.Preprod, i), [0, i]);
  paths.set(account.changeAddress(wasm.Network.Preprod, i), [1, i]);
}
const accountUtxos = koios.accounts[account.stakeAddress(wasm.Network.Preprod)].account_utxos
  .filter((u) => paths.has(u.address))
  .map((utxo) => ({ utxo, role: paths.get(utxo.address)[0], index: paths.get(utxo.address)[1] }));
const moveIn = JSON.stringify({ network: "preprod", params, utxos: accountUtxos, lovelace: "10000000", tokens: [] });
const pay = JSON.stringify({
  network: "preprod",
  params,
  utxos: owned.slice(0, 2),
  to: transfer.to,
  recipient: transfer.recipient,
  lovelace: transfer.lovelace,
  tokens: transfer.tokens,
});

let compile = [];
for (let i = 0; i < 5; i++) {
  const start = performance.now();
  await WebAssembly.compile(bytes);
  compile.push(performance.now() - start);
}
compile = compile.sort((a, b) => a - b)[2];

const result = {
  bytes: bytes.length,
  gzip: gzipSync(bytes, { level: 9 }).length,
  brotli: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
  compileMs: compile,
  "SeedelfKey.fromPhrase": median(20, () => wasm.SeedelfKey.fromPhrase(phrase, 0).free()),
  isOwned: median(200, () => key.isOwned(register)),
  rerandomize: median(200, () => wasm.rerandomize(register).free()),
  createProof: median(200, () => key.createProof(register, vkh).free()),
  draftTransfer: median(20, () => wasm.draftTransfer(key, pay)),
  buildMoveIn: median(20, () => wasm.buildMoveIn(account, key, moveIn)),
};

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`${dir}`);
console.log(`  size        ${kb(result.bytes)} raw, ${kb(result.gzip)} gzip, ${kb(result.brotli)} brotli`);
for (const [name, ms] of Object.entries(result).slice(3)) console.log(`  ${name.padEnd(22)} ${ms.toFixed(2)} ms`);
if (process.env.BENCH_JSON) console.log(JSON.stringify(result));
