// CIP-95 in the dApp connector (chunk 21b), on the recorded preprod account
// with the real WebAssembly: a site asks for governance in enable(), the
// window says what it gives, and only then does it learn the DRep key and
// have it sign the account's own DRep certificates, votes and messages. A
// site without it is told nothing of the key.
import { describe, expect, it } from "vitest";

import type { DappSession } from "../src/background/dapp";
import { APIError, DataSignError } from "../src/shared/dapp";
import { koiosPreprod, loadTestWasm, stakingPreprod, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const phrase = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!
  .phrase as string;
const wasm = loadTestWasm();
const me = wasm.CardanoAccount.fromPhrase(phrase, 0);
const DREP = JSON.parse(me.drepOf()) as { id: string; hash: string; publicKey: string };
const STAKE_KEY = me.stakePublicKey();
const GOVERNANCE = { extensions: [{ cip: 95 }] };
const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");

let sessions = 0;
const site = (origin = "https://gov.example.com"): DappSession => ({ id: `g${++sessions}`, origin, title: "Governance" });

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}

async function on() {
  const t = testBalances();
  await t.wallet.create(phrase, PASSWORD);
  await t.preferences.set({ dappConnector: true, spendRewards: false });
  return t;
}

/**
 * `s` connected, asking for governance when `params` says so, and the user
 * saying yes or no, with the window's governance switch on (`governance`) or
 * left off, as it is by default.
 */
async function enable(t: Awaited<ReturnType<typeof on>>, s: DappSession, params?: unknown, yes = true, governance = true) {
  const enabling = t.dapp.call(s, "enable", params === undefined ? [] : [params]);
  await until(() => t.dapp.approvals().length === 1);
  const approval = t.dapp.approvals()[0]!;
  await t.dapp.answer(approval.id, yes, undefined, undefined, governance);
  return { approval, enabled: enabling };
}

/**
 * A site's transaction, built by hand: one of the account's UTxOs in, 4 ₳ to
 * someone else, a 0.17 ₳ fee, and `certificate` (CBOR, hex). Nothing
 * balances it: the wallet only reads and signs it.
 */
function withCertificate(certificate: string) {
  const [utxo] = koiosPreprod.accounts[stakingPreprod.stake]!.account_utxos;
  const index = utxo!.tx_index < 24 ? utxo!.tx_index.toString(16).padStart(2, "0") : `18${utxo!.tx_index.toString(16).padStart(2, "0")}`;
  const theirs = wasm.cip30Address(vectors("cardano_account.json").find((v) => v.phrase.split(" ").length === 15)!.preprod.receive_0);
  const input = `825820${utxo!.tx_hash}${index}`;
  const output = `825839${theirs}1a003d0900`;
  // { 0: [input], 1: [output], 2: fee, 4: [certificate] }, no witnesses, valid, no metadata.
  return `84a40081${input}0181${output}021a000298100481${certificate}a0f5f6`;
}

/** Conway's DRep registration, `[16, credential, deposit, anchor]`, for the account's own DRep key. */
const registerOwnDrep = `8410${`8200581c${DREP.hash}`}1a1dcd6500f6`;

describe("governance (CIP-95) for a site", () => {
  it("is offered, asked for at connect, and given only when the user agrees", async () => {
    const t = await on();
    const s = site();
    const { approval, enabled } = await enable(t, s, GOVERNANCE);
    expect(approval).toMatchObject({ kind: "connect", governance: true });
    expect(approval).not.toHaveProperty("connected");
    expect(await enabled).toBe(true);
    expect(await t.dapp.call(s, "getExtensions", [])).toEqual([{ cip: 95 }]);
    expect(await t.dapp.call(s, "getPubDRepKey", [])).toBe(DREP.publicKey);
    // The recorded account's stake key is registered: one account_info says so.
    const before = t.koios.calls.length;
    expect(await t.dapp.call(s, "getRegisteredPubStakeKeys", [])).toEqual([STAKE_KEY]);
    expect(await t.dapp.call(s, "getUnregisteredPubStakeKeys", [])).toEqual([]);
    expect(t.koios.calls.slice(before).map((c) => c.path)).toEqual(["account_info", "account_info"]);
  });

  it("isn't given without asking, and a connected site that asks later is asked about that alone", async () => {
    const t = await on();
    const s = site();
    await enable(t, s);
    expect(await t.dapp.call(s, "getExtensions", [])).toEqual([]);
    await expect(t.dapp.call(s, "getPubDRepKey", [])).rejects.toMatchObject({ failure: { code: APIError.Refused } });
    await expect(t.dapp.call(s, "getRegisteredPubStakeKeys", [])).rejects.toMatchObject({ failure: { code: APIError.Refused } });

    // Declined: still connected, its enable() answered, still without it, and not asked again.
    const declined = await enable(t, s, GOVERNANCE, false);
    expect(declined.approval).toMatchObject({ kind: "connect", governance: true, connected: true });
    expect(await declined.enabled).toBe(true);
    expect(await t.dapp.call(s, "isEnabled", [])).toBe(true);
    expect(await t.dapp.call(s, "getExtensions", [])).toEqual([]);
    expect(await t.dapp.call(s, "enable", [GOVERNANCE])).toBe(true);
    expect(t.dapp.approvals()).toHaveLength(0);
    expect(await t.dapp.sites()).toEqual([expect.objectContaining({ origin: s.origin, cip95Declined: true })]);
  });

  it("connects without it when the window's switch is left off, as it is by default, and doesn't ask again", async () => {
    const t = await on();
    const s = site();
    const { approval, enabled } = await enable(t, s, GOVERNANCE, true, false);
    expect(approval).toMatchObject({ kind: "connect", governance: true });
    expect(await enabled).toBe(true);
    expect(await t.dapp.call(s, "getExtensions", [])).toEqual([]);
    await expect(t.dapp.call(s, "getPubDRepKey", [])).rejects.toMatchObject({ failure: { code: APIError.Refused } });
    expect(await t.dapp.call(s, "enable", [GOVERNANCE])).toBe(true);
    expect(t.dapp.approvals()).toHaveLength(0);
    // Disconnected and connected anew, it's asked again.
    await t.dapp.forget(s.origin);
    const again = await enable(t, s, GOVERNANCE);
    expect(again.approval).toMatchObject({ kind: "connect", governance: true });
    expect(again.approval).not.toHaveProperty("connected");
    expect(await t.dapp.call(s, "getExtensions", [])).toEqual([{ cip: 95 }]);
  });

  it("is given to a connected site that asks for it later, and not asked about again once it has it", async () => {
    const t = await on();
    const s = site();
    await enable(t, s);
    const { approval, enabled } = await enable(t, s, GOVERNANCE);
    expect(approval).toMatchObject({ connected: true, governance: true });
    expect(await enabled).toBe(true);
    expect(await t.dapp.call(s, "getExtensions", [])).toEqual([{ cip: 95 }]);
    // Asked again with it granted: no question.
    expect(await t.dapp.call(s, "enable", [GOVERNANCE])).toBe(true);
    expect(t.dapp.approvals()).toHaveLength(0);
  });

  it("has the DRep key sign the account's own DRep certificate only for a site given it", async () => {
    const t = await on();
    const governed = site("https://gov.example.com");
    const plain = site("https://plain.example.com");
    await enable(t, governed, GOVERNANCE);
    await enable(t, plain);
    const tx = withCertificate(registerOwnDrep);

    const signing = t.dapp.call(governed, "signTx", [tx, true]);
    await until(() => t.dapp.approvals().length === 1);
    const asked = t.dapp.approvals()[0]!;
    if (asked.kind !== "sign-tx") throw new Error(asked.kind);
    expect(asked.summary.signs).toContain("drep");
    expect(asked.summary.certificates[0]).toMatchObject({ kind: "drep", own: true, drepAction: "register", deposit: "500000000" });
    await t.dapp.answer(asked.id, true, PASSWORD);
    expect(((await signing) as string).slice(0, 4)).toBe("a100");

    // The same transaction from a site without governance: the DRep key is a stranger's.
    const other = t.dapp.call(plain, "signTx", [tx, true]);
    await until(() => t.dapp.approvals().length === 1);
    const theirs = t.dapp.approvals()[0]!;
    if (theirs.kind !== "sign-tx") throw new Error(theirs.kind);
    expect(theirs.summary.signs).not.toContain("drep");
    expect(theirs.summary.certificates[0]).toMatchObject({ kind: "drep", own: false });
    await t.dapp.answer(theirs.id, false);
    await expect(other).rejects.toBeDefined();
  });

  it("signs a message as the DRep, by its ID, for a site given governance alone", async () => {
    const t = await on();
    const governed = site("https://gov.example.com");
    const plain = site("https://plain.example.com");
    await enable(t, governed, GOVERNANCE);
    await enable(t, plain);

    const signing = t.dapp.call(governed, "signData", [DREP.id, hex("I am this DRep")]);
    await until(() => t.dapp.approvals().length === 1);
    expect(t.dapp.approvals()[0]).toMatchObject({ kind: "sign-data", key: "drep", address: DREP.id, text: "I am this DRep" });
    await t.dapp.answer(t.dapp.approvals()[0]!.id, true, PASSWORD);
    const signed = (await signing) as { signature: string; key: string };
    expect(signed.signature.slice(0, 2)).toBe("84");

    await expect(t.dapp.call(plain, "signData", [DREP.id, hex("x")])).rejects.toMatchObject({
      failure: { code: DataSignError.ProofGeneration },
    });
  });
});
