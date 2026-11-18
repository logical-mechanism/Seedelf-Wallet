// Chunk 51's probe of the critic's weak claim (verify/lead/weak-claims.md): data just under the 128-level guard through a site's
// transaction's recursive consumers, inside the module's own stack. Not part of the repo.
import { readFileSync } from "node:fs";
import { initSync, decodeTx, inspectDappTx, CardanoAccount, Network } from "../../../../../wasm/pkg/seedelf_wasm.js";
initSync({ module: readFileSync(new URL("../../../../../wasm/pkg/seedelf_wasm_bg.wasm", import.meta.url)) });
const vectors = JSON.parse(readFileSync(new URL("../../../../../../seedelf-crypto/tests/vectors/cardano_account.json", import.meta.url))).vectors;
const phrase = vectors.find((v) => v.account === 0 && v.phrase.split(" ").length === 12).phrase;
const account = CardanoAccount.fromPhrase(phrase, 0);
const good = JSON.parse(readFileSync(new URL("../../../../../wasm/tests/fixtures/minswap-swap-preprod.json", import.meta.url))).cbor;
const input = "8182" + "5820" + "ab".repeat(32) + "00"; // one input
// shapes of a Plutus datum nested n levels
const shapes = {
  list: (n) => "81".repeat(n) + "00",
  indefList: (n) => "9f".repeat(n) + "00" + "ff".repeat(n),
  map: (n) => "a100".repeat(n) + "00",
  constr121: (n) => "d87981".repeat(n) + "00",
  constr102: (n) => "d866820081".repeat(n) + "00",
  constr121indef: (n) => "d8799f".repeat(n) + "00" + "ff".repeat(n),
};
const native = (n) => "820181".repeat(n) + "8200581c" + "cd".repeat(28); // all [ all [ ... sig ] ]
// a tx: body {0: inputs, 1: [], 2: 0}, witness set {4: [datum]} (or {1: [native]})
const txWithDatum = (d) => "84a300" + input + "018002" + "00" + "a10481" + d + "f5f6";
const txWithNative = (s) => "84a300" + input + "018002" + "00" + "a10181" + s + "f5f6";
// an output whose inline datum (tag 24 bytes) holds the nested data
const enc = (h) => { const n = h.length / 2; if (n < 24) return (0x40 + n).toString(16).padStart(2, "0") + h; if (n < 256) return "58" + n.toString(16).padStart(2, "0") + h; if (n < 65536) return "59" + n.toString(16).padStart(4, "0") + h; throw 0; };
const addr = "5839" + "00" + "11".repeat(28) + "22".repeat(28); // wrong length on purpose? keep a plain enterprise addr instead
const ent = "581d60" + "11".repeat(28);
const txWithInline = (d) => "84a300" + input + "0181" + "a3" + "00" + ent + "01" + "1a001e8480" + "02" + "8201" + "d818" + enc(d) + "0200" + "a0" + "f5f6";
function wholeAgain() { JSON.parse(decodeTx(Network.Preprod, good)); }
function run(label, tx) {
  const out = {};
  for (const [name, f] of [["decodeTx", () => decodeTx(Network.Preprod, tx)], ["inspectDappTx", () => inspectDappTx(account, JSON.stringify({ network: "preprod", txCbor: tx, keys: [], inputs: [] }))]]) {
    try { f(); out[name] = "ok"; } catch (e) { const m = String(e && e.message || e); out[name] = (e instanceof WebAssembly.RuntimeError || /call stack|unreachable/i.test(m)) ? "TRAP: " + m.slice(0, 80) : "err: " + m.slice(0, 70); }
    try { wholeAgain(); } catch (e) { out[name] += " | MODULE BROKEN: " + String(e.message).slice(0, 60); }
  }
  return out;
}
for (const [shape, f] of Object.entries(shapes)) {
  for (const [where, wrap] of [["witness", txWithDatum], ["inline", txWithInline]]) {
    let last = null;
    for (let n = 1; n <= 130; n++) {
      const r = run(shape, wrap(f(n)));
      const guard = Object.values(r).every((v) => /nested more than/.test(v));
      if (guard) break;
      last = [n, r];
      if (Object.values(r).some((v) => /TRAP|BROKEN/.test(v))) { console.log("!!", shape, where, n, JSON.stringify(r)); break; }
    }
    console.log(shape, where, "deepest accepted:", last && last[0], JSON.stringify(last && last[1]));
  }
}
{ let last = null; for (let n = 1; n <= 130; n++) { const r = run("native", txWithNative(native(n))); if (Object.values(r).every((v) => /nested more than/.test(v))) break; last = [n, r]; if (Object.values(r).some((v) => /TRAP|BROKEN/.test(v))) { console.log("!! native", n, JSON.stringify(r)); break; } } console.log("native witness deepest accepted:", last && last[0], JSON.stringify(last && last[1])); }
console.log("done");
