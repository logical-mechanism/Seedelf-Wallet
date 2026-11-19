// Chunk 51, gap-g1#2 (its trace verifier's test). The user connects a site on the public account and signs its
// transaction, which pays 20 ₳ of public account 0's into the user's own Seedelf under a fresh re-randomization of its
// register, as any site that pays a Seedelf by name builds it (the CLI's own fund page does: fund.rs:161). The
// connector signed it and sent it (dapp.ts signTx, then submitTx → send → keepSent), and wrote nothing into the
// sealed Seedelf history: no PendingTx kind is a site's, and nothing in dapp.ts called ActivityService.sent. When the
// contract scan found the output, `arrived` noted it as a payment received, so `classes` gave it `received:<tx>` and
// the UTxOs screen tagged it Received. It's money made private from public account 0 (privacy.md, Co-spending: "made
// private from a public account: one history per account"), tied to that account on chain by its transaction's own
// inputs. A stealth mint then ranked it with money others paid (core Purpose::Mint) and, smallest first, took it
// ahead of a payment someone else made: the new Seedelf tied to the public account in the open.
//
// Now signTx notes, in the sealed history, the outputs under the user's own register before the site has the
// signature (a site may send it itself), as made private from the account that signed: Activity shows it once the
// scan sees it land, as Made private. A payment of a private session's account into the user's own Seedelf is that
// session's money, and an output carrying a reference script isn't noted (l3sign#1): the second case.
import { describe, expect, it } from "vitest";

import { CONTRACT_V1 } from "../src/background/balances";
import { txInputs } from "../src/background/cbor";
import { registerOf } from "../src/background/chain";
import type { DappSession } from "../src/background/dapp";
import type { KoiosUtxo } from "../src/background/koios";
import { SESSION_MINT } from "../src/background/mint";
import { historyTags, madePrivate, merged, sessionClass } from "../src/shared/histories";
import type { DappApproval } from "../src/shared/rpc";
import { activityTitle } from "../src/ui/activity";
import { busyFor, koiosPreprod, ownedUtxos, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const ACCOUNT = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
/** Public account 0's receive address 0/0. */
const OWN = ACCOUNT.preprod.receive_0 as string;
/** A pure 100 ₳ UTxO of the account's at 0/0, which the site's transaction spends. */
const FUNDS = { tx_hash: "c1".repeat(32), tx_index: 0, lovelace: 100_000_000n };
const PAID = 20_000_000n;
const FEE = 170_000n;

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}

/** A CBOR byte string of 24 to 255 bytes. */
const bytesOf = (hex: string) => `58${(hex.length / 2).toString(16).padStart(2, "0")}${hex}`;
const coin = (n: bigint) => (n < 0x100000000n ? `1a${n.toString(16).padStart(8, "0")}` : `1b${n.toString(16).padStart(16, "0")}`);
const hexOf = (b: Uint8Array) => Buffer.from(b).toString("hex");

/** Seedelf Wallet's contract on preprod, as seedelf-core's `wallet_contract` builds it: its script hash, no staking part. */
const CONTRACT = `70${CONTRACT_V1.walletContractHash}`;

/**
 * The site's transaction body: it spends FUNDS, pays 20 ₳ into the contract under the inline datum `datum` (CBOR,
 * hex), and the rest less its 0.17 ₳ fee back to `change` (CIP-30 hex). `script`: the contract output carries a
 * reference script too (a PlutusV3 script of four bytes).
 */
function body(datum: string, change: string, script = false) {
  const inputs = `81825820${FUNDS.tx_hash}00`;
  const toContract = script
    ? `a400${bytesOf(CONTRACT)}01${coin(PAID)}028201d818${bytesOf(datum)}03d818478203${"44"}01020304`
    : `a300${bytesOf(CONTRACT)}01${coin(PAID)}028201d818${bytesOf(datum)}`;
  const back = `82${bytesOf(change)}${coin(FUNDS.lovelace - PAID - FEE)}`;
  return `a300${inputs}0182${toContract}${back}02${coin(FEE)}`;
}

/** The Seedelf token a contract row holds, if it holds one. */
const seedelfOf = (u: KoiosUtxo) => (u.asset_list ?? []).find((a) => a.policy_id === CONTRACT_V1.seedelfPolicyId)?.asset_name;

/** The wallet with the connector on and a site connected to the public account, which holds FUNDS. */
async function connected() {
  const t = testBalances();
  await t.wallet.create(ACCOUNT.phrase as string, PASSWORD);
  await t.preferences.set({ dappConnector: true, spendRewards: false });
  const template = Object.values(koiosPreprod.accounts)
    .flatMap((a) => a.account_utxos)
    .find((u) => u.address === OWN)!;
  t.koios.addedToAccounts.push({
    ...template,
    tx_hash: FUNDS.tx_hash,
    tx_index: FUNDS.tx_index,
    value: FUNDS.lovelace.toString(),
    asset_list: [],
    block_height: 1,
  });
  const s: DappSession = { id: "r51-gap-g1-2", origin: "https://pay.example", title: "Pay a Seedelf" };
  const enabling = t.dapp.call(s, "enable", []);
  await until(() => t.dapp.approvals().length === 1);
  await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
  expect(await enabling).toBe(true);
  // Home's first reading: the private history begins, and what's already there is Unknown (independent review L38).
  await t.balances.get("preprod");
  expect((await t.coins.lists("preprod")).cardano.some((u) => u.txHash === FUNDS.tx_hash)).toBe(true);
  const { wasm } = t.deps;
  // The user's own Seedelf, as anyone reads it on chain, re-randomized for each payment as a correct payer does.
  const seedelf = ownedUtxos.find((u) => seedelfOf(u) && u.inline_datum)!;
  const found = registerOf(seedelf)!;
  const fresh = () => hexOf(wasm.registerToDatum(wasm.rerandomize(new wasm.Register(found.generator, found.publicValue))));
  return { t, s, fresh };
}

/** Signs the site's transaction paying `datum`, as the user approves it; returns its hash and the signed bytes. */
async function signed(c: Awaited<ReturnType<typeof connected>>, datum: string, script = false) {
  const { t, s } = c;
  const unsigned = body(datum, t.deps.wasm.cip30Address(OWN), script);
  const signing = t.dapp.call(s, "signTx", [`84${unsigned}a0f5f6`, false]);
  await until(() => t.dapp.approvals().length === 1);
  const approval = t.dapp.approvals()[0]! as Extract<DappApproval, { kind: "sign-tx" }>;
  expect(approval.summary.paid.map((p) => [p.lovelace, p.datum, p.script])).toEqual([["20000000", "inline", true]]);
  expect(approval.summary.signs).toEqual(["0/0"]);
  expect(await t.dapp.answer(approval.id, true, PASSWORD)).toEqual({});
  const witnesses = (await signing) as string;
  expect(witnesses.slice(0, 4)).toBe("a100");
  return { id: approval.summary.txHash, tx: `84${unsigned}${witnesses}f5f6` };
}

describe("a payment the user's public account makes into their own Seedelf through a site (chunk 51, gap-g1#2)", () => {
  it("keeps the public account's history, and a stealth mint takes money others paid before it", { timeout: 120_000 }, async () => {
    const c = await connected();
    const { t, s } = c;
    const ours = c.fresh();
    const bobs = c.fresh();
    expect(ours).not.toBe(bobs);

    // The site asks the public account to sign its payment into that Seedelf; the user approves it.
    const { id, tx } = await signed(c, ours);
    // Nothing shows in Activity until the scan sees it land.
    expect((await t.activity.seedelf("preprod")).some((e) => e.txHash === id)).toBe(false);
    // And sends it through the wallet, as the CLI's fund page does (index.js: signTx, then submitTx).
    expect(await t.dapp.call(s, "submitTx", [tx])).toBe(id);
    expect(t.koios.submitted).toHaveLength(1);

    // On chain: the site's output in the contract, and a payment Bob made to the same Seedelf, both after the history
    // began. Home reads again.
    const after = Math.floor(t.clock.now / 1000) + 120;
    const siteOut: KoiosUtxo = {
      ...ownedUtxos[0]!,
      tx_hash: id,
      tx_index: 0,
      value: PAID.toString(),
      asset_list: [],
      inline_datum: { bytes: ours, value: null },
      block_height: 9_000_002,
      block_time: after + 20,
    };
    const bob: KoiosUtxo = {
      ...ownedUtxos[0]!,
      tx_hash: "b0".repeat(32),
      tx_index: 0,
      value: "40000000",
      asset_list: [],
      inline_datum: { bytes: bobs, value: null },
      block_height: 9_000_001,
      block_time: after,
    };
    t.koios.added.push(bob, siteOut);
    t.clock.now += 3 * 60_000;
    await t.wallet.touch();
    await t.balances.get("preprod", true);
    const { seedelf: rows } = await t.coins.lists("preprod");
    const siteRow = rows.find((u) => u.txHash === id && u.index === 0);
    const bobRow = rows.find((u) => u.txHash === bob.tx_hash && u.index === 0);
    // Both are the wallet's: in the private balance.
    expect(siteRow).toBeDefined();
    expect(bobRow).toBeDefined();

    const classes = await t.activity.classes("preprod", [siteOut, bob]);
    const siteClass = classes.get(`${id}#0`);
    // Bob's is a payment received, as it should be.
    expect(classes.get(`${bob.tx_hash}#0`)).toEqual({ id: `received:${bob.tx_hash}`, origin: "received" });
    const entry = (await t.activity.seedelf("preprod")).find((e) => e.txHash === id);
    console.log(`[r51 gap-g1#2] the site's output ${id.slice(0, 16)}…#0 is classed ${JSON.stringify(siteClass)}, listed ${JSON.stringify(entry && activityTitle(entry))}`);
    console.log(`[r51 gap-g1#2] the UTxOs screen tags it ${JSON.stringify(siteRow?.history ? historyTags(siteRow.history) : undefined)}`);

    // A stealth mint from the private balance: the default when the public account is empty.
    const summary = await t.mint.build("preprod", "", "seedelf");
    const kept = (await t.session.get<{ txCbor: string }>(SESSION_MINT))!;
    const inputs = txInputs(Uint8Array.from(Buffer.from(kept.txCbor, "hex")));
    console.log(`[r51 gap-g1#2] the stealth mint spends ${JSON.stringify(inputs)}; its review's histories ${JSON.stringify(summary.histories)}`);

    // The site's output is money made private from public account 0, its transaction the account's in the open.
    expect.soft(siteClass, "the site's output keeps public account 0's history").toEqual(madePrivate(0));
    expect.soft(siteRow?.history && historyTags(siteRow.history), "the UTxOs screen tags it as made private").toEqual(["Made private"]);
    expect.soft(entry && activityTitle(entry), "Activity lists it as made private, once it landed").toBe("Made private");
    // So a stealth mint, which hides the payer only with money others paid, takes Bob's payment, which pays alone.
    expect.soft(inputs, "the stealth mint doesn't spend the public account's own output").not.toContain(`${id}#0`);
    expect.soft(inputs, "it spends Bob's payment").toEqual([`${bob.tx_hash}#0`]);
  });

  it("notes a private session's payment as that session's money, and drops a note whose transaction never landed", async () => {
    const t = testBalances({ owned: false });
    await t.wallet.create(ACCOUNT.phrase as string, PASSWORD);
    // The history's first reading found nothing; session 2's funding was written down when it was sent.
    await t.activity.arrived("preprod", []);
    const funding = { kind: "session-out", network: "preprod", txHash: "a2".repeat(32), submittedAt: 1, confirmations: null } as const;
    await t.activity.sent("preprod", funding, { index: 2, origin: madePrivate(0), payments: [] });
    const row = (hex: string): KoiosUtxo => ({ ...ownedUtxos[0]!, tx_hash: hex.repeat(32), tx_index: 0, asset_list: [] });
    // A site on session 2 pays the user's own Seedelf (dapp.ts notePrivate); another site's transaction, from the public
    // account, is signed but never sent.
    const [S, N] = ["5e".repeat(32), "5f".repeat(32)];
    await t.activity.signedInto("preprod", { txHash: S, outputs: [0], origin: sessionClass(2), session: 2 });
    await t.activity.signedInto("preprod", { txHash: N, outputs: [0], origin: madePrivate(0) });
    const session2 = merged([madePrivate(0), sessionClass(2)]);
    // Landed, before a reading notes it: a spend reads the note.
    expect((await t.activity.classes("preprod", [row("5e")])).get(`${S}#0`)).toEqual(session2);
    expect((await t.activity.seedelf("preprod")).some((e) => e.txHash === S)).toBe(false);
    await t.activity.arrived("preprod", [row("5e")]);
    const entry = (await t.activity.seedelf("preprod")).find((e) => e.txHash === S);
    expect(entry).toMatchObject({ kind: "session-back", session: 2 });
    expect(activityTitle(entry!)).toBe("Back from a private session");
    expect((await t.activity.classes("preprod", [row("5e")])).get(`${S}#0`)).toEqual(session2);
    // 31 days on, the note of the one never sent is gone: what lands under its hash then is a payment received.
    await busyFor(t, 31 * 24 * 60 * 60_000);
    await t.activity.arrived("preprod", [row("5e"), row("5f")]);
    expect((await t.activity.seedelf("preprod")).find((e) => e.txHash === N)).toMatchObject({ kind: "received" });
  });

  it("never notes an output that carries a reference script, which the wallet can't spend (l3sign#1)", { timeout: 120_000 }, async () => {
    const c = await connected();
    const { t } = c;
    const ours = c.fresh();
    const { id } = await signed(c, ours, true);
    // The site sends it itself. On chain, the output under the user's register, its script with it.
    const siteOut: KoiosUtxo = {
      ...ownedUtxos[0]!,
      tx_hash: id,
      tx_index: 0,
      value: PAID.toString(),
      asset_list: [],
      inline_datum: { bytes: ours, value: null },
      reference_script: { hash: "ab".repeat(28), size: 4, type: "plutusV3", bytes: "01020304" },
      block_height: 9_000_002,
      block_time: Math.floor(t.clock.now / 1000) + 140,
    };
    t.koios.added.push(siteOut);
    t.clock.now += 3 * 60_000;
    await t.wallet.touch();
    await t.balances.get("preprod", true);
    const entry = (await t.activity.seedelf("preprod")).find((e) => e.txHash === id);
    // Never "Made private": the wallet can neither count nor spend it.
    expect(entry && activityTitle(entry)).not.toBe("Made private");
    expect((await t.activity.classes("preprod", [siteOut])).get(`${id}#0`)).not.toEqual(madePrivate(0));
  });
});
