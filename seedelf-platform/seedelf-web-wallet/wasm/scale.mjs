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
//
// What Seedelf Messaging's scan and stamps cost (chunk 54's 54d):
//
//   node --expose-gc scale.mjs messaging [envelopes] [solves]     (defaults 15000 and 8)
//
// A relay pool of `envelopes` session envelopes, one in 1,000 this key's,
// scanned as the worker will (`messagingScan`, 200 an envelope a call, the
// batch as JSON of hex, the answer a digit an envelope, `1` for this key's,
// a turn of the event loop between), then one of this
// key's opened and received with its conversation's record. Then the stamps:
// a SHA-256 attempt's cost over 2^22 attempts, and `solves` first-contact
// stamps at 24 bits and four times as many posts at the relay's 18, each
// solved in slices of 2^16 attempts with a turn between.
import { mkdtempSync, openSync, readFileSync, rmSync, statSync, writeSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const wasm = await import(new URL("pkg/seedelf_wasm.js", import.meta.url).href);
wasm.initSync({ module: readFileSync(new URL("pkg/seedelf_wasm_bg.wasm", import.meta.url)) });

if (process.argv[2] === "messaging") {
  await messaging(Number(process.argv[3] ?? 15_000), Number(process.argv[4] ?? 8));
  process.exit(0);
}

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

async function messaging(envelopes, solves) {
  // Envelopes a scan call takes: the worker's turn, as for contract rows.
  const TURN = 200;
  const call = (fn, ...args) =>
    JSON.parse(fn(...args.map((a) => (a?.constructor === Object || Array.isArray(a) ? JSON.stringify(a) : a))));
  const turn = () => new Promise((resolve) => setTimeout(resolve, 0));
  const plain = (r) => ({ generator: r.generator, publicValue: r.publicValue });
  const T = Math.floor(Date.now() / 1000);
  const name = (i) => "5eed0e1f" + i.toString(16).padStart(56, "0");

  // A conversation from `from` to `to`'s Seedelf, replied to, so `from` sends
  // session messages: 512-byte envelopes, as most of a pool's are. Its first
  // message, a 2 KiB envelope, goes in the pool too.
  function pair(from, to, i) {
    const seedelf = plain(wasm.rerandomize(to.baseRegister()));
    const started = call(wasm.messagingStart, from, { handle: seedelf, to: name(i), now: T });
    let a = call(wasm.messagingSetStamp, { conversation: started.conversation, nonce: 0 }).conversation;
    const first = call(wasm.messagingSend, { conversation: a, plaintext: "68656c6c6f" });
    const request = call(wasm.messagingReceive, to, {
      envelope: first.envelope,
      now: T,
      handles: [{ name: name(i), registers: [seedelf] }],
      firstContactBits: 0,
    });
    const accepted = call(wasm.messagingAccept, to, { requests: request.requests, cid: started.cid });
    const reply = call(wasm.messagingSend, { conversation: accepted.conversation, plaintext: "6869" });
    a = call(wasm.messagingReceive, from, { envelope: reply.envelope, now: T, conversations: [first.conversation] })
      .conversation;
    return {
      first: first.envelope,
      // The record of `to`'s side, after its reply.
      theirs: reply.conversation,
      send(text) {
        const sent = call(wasm.messagingSend, { conversation: a, plaintext: Buffer.from(text).toString("hex") });
        a = sent.conversation;
        return sent.envelope;
      },
    };
  }

  const phrase = JSON.parse(readFileSync(new URL("../../seedelf-crypto/tests/vectors/cardano_account.json", import.meta.url)))
    .vectors.find((v) => v.account === 0 && v.phrase.split(" ").length === 12).phrase;
  const key = wasm.SeedelfKey.fromPhrase(phrase, 0);
  const others = Array.from({ length: 16 }, () => wasm.SeedelfKey.random());

  // 256 distinct envelopes among other wallets, 16 of them first messages; and
  // this key's, every 1,000th. The scan's cost doesn't depend on whose it is.
  let start = performance.now();
  const theirs = [];
  for (let i = 0; i < 16; i++) {
    const p = pair(others[i], others[(i + 1) % 16], i);
    theirs.push(p.first);
    for (let j = 0; j < 15; j++) theirs.push(p.send(`message ${j} of conversation ${i}, a sentence or so long`));
  }
  const toUs = pair(others[0], key, 99);
  const pool = Array.from({ length: envelopes }, (_, i) =>
    i % 1000 === 999 ? toUs.send(`for this key, ${i}`) : theirs[i % theirs.length],
  );
  const ours = pool.filter((_, i) => i % 1000 === 999).length;
  const bytes = pool.reduce((sum, e) => sum + e.length / 2, 0);
  const buildMs = performance.now() - start;

  globalThis.gc?.();
  start = performance.now();
  const found = [];
  for (let i = 0; i < pool.length; i += TURN) {
    const batch = pool.slice(i, i + TURN);
    const bits = wasm.messagingScan(key, JSON.stringify(batch));
    if (bits.length !== batch.length) throw new Error("messagingScan didn't answer a digit an envelope: rebuild the module");
    for (let at = 0; at < bits.length; at++) if (bits[at] === "1") found.push(i + at);
    await turn();
  }
  const scanMs = performance.now() - start;
  if (found.length !== ours) throw new Error(`the scan found ${found.length} of this key's ${ours}`);

  // One of this key's opened, then received with its conversation's record.
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const timed = (fn, n = 15) =>
    median(
      Array.from({ length: n }, () => {
        const t = performance.now();
        fn();
        return performance.now() - t;
      }),
    );
  // The first match is the first message of the writer's new sending chain,
  // so receiving it takes a ratchet step: the dearer case. The record isn't
  // kept, so each run reads it afresh.
  const match = pool[found[0]];
  const openMs = timed(() => call(wasm.messagingOpen, key, match));
  const receive = () => call(wasm.messagingReceive, key, { envelope: match, now: T, conversations: [toUs.theirs] });
  if (receive().received?.kind !== "message") throw new Error("this key's match didn't read");
  const receiveMs = timed(receive);

  console.log(`envelopes            ${envelopes.toLocaleString("en-US")} (${(bytes / 1e6).toFixed(1)} MB, ${ours} this key's; made in ${(buildMs / 1000).toFixed(1)} s)`);
  console.log(`scan, per envelope   ${(scanMs / envelopes).toFixed(3)} ms (messagingScan, ${TURN} a call, a turn between)`);
  console.log(`scan, every envelope ${(scanMs / 1000).toFixed(1)} s`);
  console.log(`open a match         ${openMs.toFixed(2)} ms (messagingOpen)`);
  console.log(`receive a match      ${receiveMs.toFixed(2)} ms (messagingReceive with its record, a ratchet step)`);

  // The stamps. One SHA-256 block an attempt: its cost over 2^22 attempts at
  // 32 bits, which a slice that long almost never meets.
  const digest = () => randomBytes(32).toString("hex");
  start = performance.now();
  call(wasm.messagingFindStamp, { digest: digest(), bits: 32, from: 0, attempts: 2 ** 22 });
  const attemptNs = ((performance.now() - start) * 1e6) / 2 ** 22;
  const SLICE = 2 ** 16;
  async function solve(bits) {
    const d = digest();
    const t = performance.now();
    for (let from = 0; ; from += SLICE) {
      const { nonce } = call(wasm.messagingFindStamp, { digest: d, bits, from, attempts: SLICE });
      if (nonce !== null) return performance.now() - t;
      await turn();
    }
  }
  const stats = async (bits, n) => {
    const times = [];
    for (let i = 0; i < n; i++) times.push(await solve(bits));
    const mean = times.reduce((a, b) => a + b, 0) / n;
    return `mean ${(mean / 1000).toFixed(2)} s, median ${(median(times) / 1000).toFixed(2)} s, longest ${(Math.max(...times) / 1000).toFixed(2)} s over ${n}`;
  };
  console.log(`a stamp's attempt    ${attemptNs.toFixed(0)} ns (2^18: ${((attemptNs * 2 ** 18) / 1e9).toFixed(2)} s, 2^24: ${((attemptNs * 2 ** 24) / 1e9).toFixed(1)} s on average)`);
  console.log(`relay stamp, 18 bits ${await stats(18, 4 * solves)}`);
  console.log(`first contact, 24    ${await stats(24, solves)}`);
  console.log(`peak RSS             ${((process.resourceUsage().maxRSS * 1024) / 1e6).toFixed(1)} MB`);
  key.free();
  for (const other of others) other.free();
}
