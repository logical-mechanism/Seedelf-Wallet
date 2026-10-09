// What a restore from the private index costs on a large contract (chunk 26's
// Verification, Scale): a synthetic `contract/snapshot` answer of N rows, in
// the API's row shape (seedelf-data/README.md, A row), read and checked the
// way the worker does it (contract-scan.ts `readIndexView`).
//
//   node --expose-gc scale.mjs [rows] [checked]     (defaults 1000000 and 20000; run ./build.sh first)
//
// It writes the answer to a temporary file, then reports its size, the time
// to read and parse it as one string (what `response.json()` does), the heap
// the parsed rows hold, and the ownership check per row: the datum's
// register out of its hex, then `isOwned`, in batches of 200 as the worker
// runs them. Only `checked` rows are checked; the total is worked out from
// their rate unless `checked` is the whole answer. One row in 1,000 is this
// key's.
import { mkdtempSync, openSync, readFileSync, rmSync, statSync, writeSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const wasm = await import(new URL("pkg/seedelf_wasm.js", import.meta.url).href);
wasm.initSync({ module: readFileSync(new URL("pkg/seedelf_wasm_bg.wasm", import.meta.url)) });

const rows = Number(process.argv[2] ?? 1_000_000);
const checked = Math.min(rows, Number(process.argv[3] ?? 20_000));
const OURS_EVERY = 1000;
const BATCH = 200;

const phrase = JSON.parse(readFileSync(new URL("../../seedelf-crypto/tests/vectors/cardano_account.json", import.meta.url)))
  .vectors.find((v) => v.account === 0 && v.phrase.split(" ").length === 12).phrase;
const key = wasm.SeedelfKey.fromPhrase(phrase, 0);

// 64 other wallets' registers and this one's, re-randomized: a row's cost doesn't depend on whose it is.
const datumOf = (register) => `d8799f5830${register.generator}5830${register.publicValue}ff`;
const theirs = Array.from({ length: 64 }, (_, i) => {
  const other = wasm.SeedelfKey.fromPhrase(phrase, i + 1);
  return datumOf(wasm.rerandomize(other.baseRegister()));
});
const ours = datumOf(wasm.rerandomize(key.baseRegister()));

// Mainnet's rows today: most at the bare contract address with only ADA; about a fifth with a stake part and a Seedelf.
const BARE = "addr1wx2te2wqn85yllvs69grz6a5fsc60pczywg8dg9gp6j2g6g9nk02v";
const STAKED = "addr1zx2te2wqn85yllvs69grz6a5fsc60pczywg8dg9gp6j2g60ul3msrvwlggrpyqh048ykj69ysxaadgr8dmah4758a0csvq3tjn";
const POLICY = "84967d911e1a10d5b4a38441879f374a07f340945bcf9e7697485255";
function row(i) {
  const r = {
    ref: `${randomBytes(32).toString("hex")}#${i % 4}`,
    address: i % 5 === 0 ? STAKED : BARE,
    lovelace: String(1_500_000 + (i % 977) * 1000),
  };
  if (i % 5 === 0) r.assets = [[POLICY, `5eed0e1f01${randomBytes(27).toString("hex")}`, "1", 0]];
  r.datum = i % OURS_EVERY === 0 ? ours : theirs[i % theirs.length];
  r.created = { slot: 144_889_937 + i * 20, time: 1_736_456_228 + i * 20 };
  return r;
}

const dir = mkdtempSync(join(tmpdir(), "seedelf-scale-"));
const file = join(dir, "snapshot.json");
try {
  const fd = openSync(file, "w");
  writeSync(fd, `{"tip":{"slot":199998831,"hash":"${"8c".repeat(32)}","time":1791565122},"cursor":"199998600.${"03".repeat(32)}","rows":[`);
  for (let i = 0; i < rows; i++) writeSync(fd, (i ? "," : "") + JSON.stringify(row(i)));
  writeSync(fd, "]}");
  closeSync(fd);
  const bytes = statSync(file).size;

  globalThis.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  let start = performance.now();
  let answer;
  let parsed = "ok";
  try {
    answer = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    parsed = `failed: ${e.message}`;
  }
  const parseMs = performance.now() - start;
  globalThis.gc?.();
  const heapRows = process.memoryUsage().heapUsed - heapBefore;

  // The worker's check: the register out of the datum's hex (chain.ts `registerOf`), then isOwned.
  const check = (datum) => {
    const b = Uint8Array.from(datum.match(/../g), (h) => Number.parseInt(h, 16));
    if (b[0] !== 0xd8 || b[1] !== 0x79 || b[3] !== 0x58 || b[4] !== 0x30) return false;
    const hex = (from) => Buffer.from(b.subarray(from, from + 48)).toString("hex");
    const register = new wasm.Register(hex(5), hex(55));
    try {
      return key.isOwned(register);
    } catch {
      return false;
    } finally {
      register.free();
    }
  };
  const sample = answer?.rows ?? Array.from({ length: checked }, (_, i) => row(i));
  let found = 0;
  start = performance.now();
  for (let i = 0; i < checked; i += BATCH) {
    for (const r of sample.slice(i, i + BATCH)) if (check(r.datum)) found++;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const checkMs = performance.now() - start;
  const perRow = checkMs / checked;

  const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
  const min = (ms) => (ms >= 60_000 ? `${(ms / 60_000).toFixed(1)} min` : `${(ms / 1000).toFixed(1)} s`);
  console.log(`rows                 ${rows.toLocaleString("en-US")}`);
  console.log(`answer               ${mb(bytes)} (${(bytes / rows).toFixed(0)} bytes a row)`);
  console.log(`read + parse         ${min(parseMs)}, ${parsed}`);
  console.log(`parsed rows' heap    ${answer ? mb(heapRows) : "-"}`);
  console.log(`check per row        ${perRow.toFixed(3)} ms (${checked.toLocaleString("en-US")} checked, ${found} ours)`);
  console.log(`check, every row     ${min(perRow * rows)}${checked < rows ? " (worked out)" : ""}`);
  console.log(`peak RSS             ${mb(process.resourceUsage().maxRSS * 1024)}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
