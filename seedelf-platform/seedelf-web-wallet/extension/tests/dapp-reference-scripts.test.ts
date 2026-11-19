// Chunk 51, w2#4. A site is handed the account's UTxOs as the ledger holds them, a reference script included: Conway's
// fee counts the script on a spent input, so a site pricing its fee from a UTxO handed over without it comes up short,
// and the node refuses its transaction. Anyone can pay the account such a UTxO. Koios and the data layer give a Plutus
// script's bytes and no native script's (checked on real rows, 2026-11-18), so a UTxO whose script can't be written
// whole is left out of getUtxos and getBalance alike (dapp.ts `available`, `handedWhole`), and a site's own output
// carrying a script, chained on before it's on chain, keeps it (`remember`, cip30.rs `script_of`).
//
// The first case runs on today's WebAssembly. The other two need the WebAssembly rebuilt with cip30.rs's change:
// `utxo_cbor` writing key 3, and an own output's `referenceScript`.

import { blake2b } from "@noble/hashes/blake2.js";
import { describe, expect, it } from "vitest";

import type { DappSession } from "../src/background/dapp";
import type { KoiosUtxo } from "../src/background/koios";
import { koiosPreprod, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const phrase12 = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
/** The 12-word account's `0/0`. */
const OWN = phrase12.preprod.receive_0 as string;
const SLOW = { timeout: 30_000 };

const toHex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const fromHex = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
/** A byte string's CBOR, its head then its bytes. */
const byteString = (hex: string) => {
  const n = hex.length / 2;
  const head = n < 24 ? (0x40 + n).toString(16) : n < 256 ? `58${n.toString(16).padStart(2, "0")}` : `59${n.toString(16).padStart(4, "0")}`;
  return `${head}${hex}`;
};
const uint = (n: number) => (n < 24 ? n.toString(16).padStart(2, "0") : `18${n.toString(16).padStart(2, "0")}`);
/** A Plutus V3 script's bytes as the ledger keeps them (a byte string of its flat program), and its hash. */
const PLUTUS = "4d01000033222220051200120011";
const plutusHash = toHex(blake2b(fromHex(`03${PLUTUS}`), { dkLen: 28 }));
/** What an output's key 3 holds for it: `#6.24(bytes .cbor [3, script])`. */
const scriptRef = `03d818${byteString(`8203${byteString(PLUTUS)}`)}`;

type Read = { lovelace: string; tokens: Array<{ policyId: string; assetName: string; quantity: string }> };

async function connected() {
  const t = testBalances();
  await t.wallet.create(phrase12.phrase, PASSWORD);
  await t.preferences.set({ dappConnector: true, spendRewards: false });
  const s: DappSession = { id: "w2-4", origin: "https://app.example.com", title: "Example" };
  const enabling = t.dapp.call(s, "enable", []);
  for (let i = 0; i < 200 && t.dapp.approvals().length !== 1; i++) await new Promise((r) => setTimeout(r, 0));
  await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
  expect(await enabling).toBe(true);
  const template = Object.values(koiosPreprod.accounts)
    .flatMap((a) => a.account_utxos)
    .find((u) => u.address === OWN)!;
  /** A stranger's output at `0/0`, carrying `script`. */
  const planted = (n: number, script: KoiosUtxo["reference_script"]): KoiosUtxo => ({
    ...template,
    tx_hash: `d${n}`.repeat(32),
    tx_index: 0,
    value: "3000000",
    asset_list: [],
    inline_datum: null,
    block_height: 1,
    reference_script: script,
  });
  /** The site's getUtxos: the UTxO at an outpoint, its output's hex, or undefined. */
  const utxos = async () => {
    const list = (await t.dapp.call(s, "getUtxos", [])) as string[];
    return (txHash: string, index: number) => {
      const input = `82825820${txHash}${uint(index)}`;
      return list.find((u) => u.startsWith(input))?.slice(input.length);
    };
  };
  const balance = async (): Promise<Read> =>
    JSON.parse(t.deps.wasm.cip30ReadValue((await t.dapp.call(s, "getBalance", [])) as string)) as Read;
  return { t, s, template, planted, utxos, balance };
}

describe("chunk 51 w2#4: what a site is handed of a UTxO carrying a reference script", () => {
  it("leaves out one whose script the data source doesn't give whole, from getUtxos and getBalance alike", SLOW, async () => {
    const { t, planted, utxos, balance } = await connected();
    const before = await balance();
    // As Koios and the data layer give a native script: its type and hash, no bytes, no size.
    const native = planted(1, { hash: "ab".repeat(28), size: null, type: "timelock", bytes: null });
    // A type the ledger has no script of, and bytes that disagree with their size.
    const unknown = planted(2, { hash: null, size: 5, type: "plutusV9", bytes: "4401020304" });
    const misSized = planted(3, { hash: plutusHash, size: 99, type: "plutusV3", bytes: PLUTUS });
    // A Plutus script, as both give one: handed over.
    const plutus = planted(4, { hash: plutusHash, size: PLUTUS.length / 2, type: "plutusV3", bytes: PLUTUS });
    t.koios.addedToAccounts.push(native, unknown, misSized, plutus);
    t.clock.now += 31_000; // past the connector's 30 s reading

    const handed = await utxos();
    for (const left of [native, unknown, misSized]) expect(handed(left.tx_hash, 0), left.tx_hash).toBeUndefined();
    expect(handed(plutus.tx_hash, 0)).toBeDefined();
    // getBalance counts what getUtxos hands over: the Plutus one's 3 ₳ alone.
    expect(BigInt((await balance()).lovelace)).toBe(BigInt(before.lovelace) + 3_000_000n);
  });

  // Chunk 51, still#11: WebAssembly leaves out a script whose given hash isn't its bytes' (cip30.rs `script_ref`), and
  // the worker's filter didn't check the hash, so getBalance counted what getUtxos left out.
  it("leaves out one whose script's given hash isn't its bytes', from getUtxos and getBalance alike", SLOW, async () => {
    const { t, planted, utxos, balance } = await connected();
    const before = await balance();
    const misHashed = planted(7, { hash: "ab".repeat(28), size: PLUTUS.length / 2, type: "plutusV3", bytes: PLUTUS });
    // The hash in capitals is the same hash, and one not given is nothing to check against: both handed over.
    const capitals = planted(8, { hash: plutusHash.toUpperCase(), size: PLUTUS.length / 2, type: "plutusV3", bytes: PLUTUS });
    const unhashed = planted(9, { hash: null, size: null, type: "plutusV3", bytes: PLUTUS });
    t.koios.addedToAccounts.push(misHashed, capitals, unhashed);
    t.clock.now += 31_000;

    const handed = await utxos();
    expect(handed(misHashed.tx_hash, 0)).toBeUndefined();
    expect(handed(capitals.tx_hash, 0)).toBeDefined();
    expect(handed(unhashed.tx_hash, 0)).toBeDefined();
    expect(BigInt((await balance()).lovelace)).toBe(BigInt(before.lovelace) + 6_000_000n);
  });

  it("offers no site a collateral the user chose whose script it can't hand over whole", SLOW, async () => {
    const { t, s, planted } = await connected();
    // 5 ₳ of ADA alone carrying a native script, as Koios gives one: the user may make it the collateral.
    const chosen = { ...planted(6, { hash: "ab".repeat(28), size: null, type: "timelock", bytes: null }), value: "5000000" };
    t.koios.addedToAccounts.push(chosen);
    t.clock.now += 31_000;
    await t.balances.get("preprod", true);
    // The user's choice, what a site gets. The wallet's own builds can't put it up, so for them, and the Collateral
    // page, it's no choice (chunk 51, money#4).
    await t.coins.use("preprod", `${chosen.tx_hash}#0`);
    expect((await t.coins.choices("preprod")).collateral).toBe(`${chosen.tx_hash}#0`);
    expect(await t.dapp.call(s, "getCollateral", [])).toBeNull();
  });

  it("hands over a Koios row's Plutus script with its UTxO (needs the WebAssembly rebuilt)", SLOW, async () => {
    const { t, planted, utxos } = await connected();
    const plutus = planted(5, { hash: plutusHash, size: PLUTUS.length / 2, type: "plutusV3", bytes: PLUTUS });
    t.koios.addedToAccounts.push(plutus);
    t.clock.now += 31_000;
    const handed = (await utxos())(plutus.tx_hash, 0);
    // The map form, its key 3 the script as the ledger holds it.
    expect(handed?.slice(0, 2)).toBe("a3");
    expect(handed).toContain(scriptRef);
  });

  it("keeps a site's own output's script as it chains on it, and hands it over with it (needs the WebAssembly rebuilt)", SLOW, async () => {
    const { t, s, template, utxos } = await connected();
    // A site's transaction spending one of the account's UTxOs, its one output to the account's `0/0` carrying a
    // Plutus script: `{0: address, 1: coin, 3: script}`.
    const address = t.deps.wasm.cip30Address(OWN);
    const coin = BigInt(template.value) - 300_000n;
    const output = `a300${byteString(address)}011b${coin.toString(16).padStart(16, "0")}${scriptRef}`;
    const body = `a30081825820${template.tx_hash}${uint(template.tx_index)}0181${output}021a000493e0`;
    const tx = `84${body}a0f5f6`;
    const id = toHex(blake2b(fromHex(body), { dkLen: 32 }));

    const signing = t.dapp.call(s, "signTx", [tx, false]);
    for (let i = 0; i < 2000 && t.dapp.approvals().length === 0; i++) await new Promise((r) => setTimeout(r, 0));
    const approval = t.dapp.approvals()[0]!;
    if (approval.kind !== "sign-tx") throw new Error(approval.kind);
    expect(approval.summary.txHash).toBe(id);
    expect(approval.summary.ownOutputs[0]?.referenceScript).toEqual({
      hash: plutusHash,
      size: PLUTUS.length / 2,
      type: "plutusV3",
      bytes: PLUTUS,
    });
    expect(await t.dapp.answer(approval.id, true, PASSWORD)).toEqual({});
    await signing;
    expect(await t.dapp.call(s, "submitTx", [tx])).toBe(id);

    // Chained on before it's on chain: handed over with its script, and what it spent isn't.
    const handed = await utxos();
    expect(handed(template.tx_hash, template.tx_index)).toBeUndefined();
    expect(handed(id, 0)).toContain(scriptRef);
  });
});
