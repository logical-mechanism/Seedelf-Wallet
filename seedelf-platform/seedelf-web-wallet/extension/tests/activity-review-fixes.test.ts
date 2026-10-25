// Public activity's rows for a box the public account paid to bring back (Lovejoin's escape hatch, chunk 34's 34d),
// on the device that paid, as 1.6.0's release review found them (318-worker#2): named "Back from Lovejoin" from the
// private history's entry for the box, never "Paid for a box back from Lovejoin" as any other device names it, and
// listed while on its way as money in, at the account's whole change.
import { describe, expect, it } from "vitest";

import {
  accountMatcher,
  describe as describeTxs,
  SESSION_ACCOUNT_ADDRESSES_PREFIX,
  type AccountAddresses,
} from "../src/background/activity";
import { CONTRACT_V1 } from "../src/background/balances";
import { txInputs } from "../src/background/cbor";
import { pendingEntries } from "../src/background/incoming";
import type { KoiosTxInfo } from "../src/background/koios";
import { NETWORKS } from "../src/networks";
import type { ActivityEntry } from "../src/shared/rpc";
import { activityTitle } from "../src/ui/activity";
import { activityPreprod, loadTestWasm, testBalances, vectors, withdrawPreprod } from "./fakes";

const PASSWORD = "correct horse battery";
const MIX_BOX = NETWORKS.preprod.lovejoin!.mixBox;
const ME = "addr_test1_me";
const MY_KEY = "11".repeat(28);

const out = (bech32: string, cred: string, value: string) => ({ payment_addr: { bech32, cred }, value, asset_list: [] });
/** A box of the classic pool, which a byte's price made too small to pay its own way back. */
const box = () => out("addr_test1w_mix_box", MIX_BOX, "2000000");
/** The box's way back: a fresh register of the wallet's, the box's ADA and what the account made up. */
const seedelf = (value: string) => out("addr_test1w_seedelf", CONTRACT_V1.walletContractHash, value);

/** The private history's entry for the box, as withdrawOne writes it once it's sent (lovejoin.ts, activity.ts `sent`). */
const boxBack = (txHash: string): ActivityEntry => ({
  txHash,
  at: 1,
  kind: "lovejoin-withdraw",
  direction: "in",
  lovelace: "4640000",
  tokens: 0,
  detail: "Lovejoin",
});

/**
 * The escape hatch as Koios lists it: the box and 20 ₳ of the account's in; the box's way back, 4.64 ₳, and the
 * account's change out. The account paid the fee and the 2.64 ₳ the box was short.
 */
const paidBack = (txHash: string, key = MY_KEY, address = ME): KoiosTxInfo => ({
  tx_hash: txHash,
  block_height: 10,
  tx_timestamp: 1_800_000_000,
  fee: "420000",
  inputs: [box(), out(address, key, "20000000")],
  outputs: [seedelf("4640000"), out(address, key, "16940000")],
});

describe("a box the public account paid to bring back (1.6.0's release review, 318-worker#2)", () => {
  it("is named for what the account did, though this device's private history has the box's way back", () => {
    const tx = paidBack("b1".repeat(32));
    const ours = accountMatcher({ addresses: [ME], keys: [MY_KEY] });
    const elsewhere = describeTxs([tx], ours, new Map(), undefined, undefined, MIX_BOX);
    const here = describeTxs([tx], ours, new Map([[tx.tx_hash, boxBack(tx.tx_hash)]]), undefined, undefined, MIX_BOX);
    // What it cost the account, the fee apart, as a device without the private entry reads it too.
    for (const [e] of [elsewhere, here]) {
      expect(e).toMatchObject({ kind: "lovejoin-back-paid", direction: "out", lovelace: "2640000", fee: "420000" });
      expect(e!.detail).toBeUndefined();
      expect(activityTitle(e!)).toBe("Paid for a box back from Lovejoin");
    }
  });

  it("is named so in Public activity once Koios lists it, on the device that paid", async () => {
    const v = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
    const t = testBalances();
    await t.wallet.create(v.phrase, PASSWORD);
    await t.balances.get("preprod");
    const { keys } = (await t.session.get<AccountAddresses>(`${SESSION_ACCOUNT_ADDRESSES_PREFIX}preprod`))!;
    const hash = "b2".repeat(32);
    // Its box's way back, in the private history, as the withdraw wrote it at Send.
    await t.activity.sent(
      "preprod",
      { kind: "lovejoin-withdraw", network: "preprod", txHash: hash, submittedAt: t.clock.now, confirmations: null },
      { lovelace: "4640000" },
    );
    const top = activityPreprod.account_txs[0]!;
    const row = { tx_hash: hash, block_height: top.block_height + 1, block_time: top.block_time + 60 };
    t.koios.credentialTxs.set(keys[0]!, [row]);
    t.koios.txRows.set(hash, { ...paidBack(hash, keys[0]!, "addr_test1_mine"), block_height: row.block_height, tx_timestamp: row.block_time });
    const { entries } = await t.activity.cardano("preprod");
    expect(entries.find((e) => e.txHash === hash)).toMatchObject({
      kind: "lovejoin-back-paid",
      direction: "out",
      lovelace: "2640000",
      fee: "420000",
    });
  });

  it("isn't listed while it's on its way as money in at the account's change: once Koios lists it, it's named so", () => {
    const wasm = loadTestWasm();
    // A Make public to an account stands in for its bytes: a Seedelf spend that carries no slot, as the escape hatch's
    // doesn't, and pays an account its change. What the device knows tells the two apart: the private history's entry.
    const { txCbor, txHash } = withdrawPreprod.amount.final as unknown as { txCbor: string; txHash: string };
    const detail = JSON.parse(wasm.decodeTx(wasm.Network.Preprod, txCbor)) as {
      validUntil: unknown;
      outputs: Array<{ address: { payment: string | null; hex: string }; lovelace: string }>;
    };
    expect(detail.validUntil).toBeNull();
    const paying = detail.outputs.find((o) => o.address.payment === "key")!;
    const sent = [{ txHash, txCbor, sentAt: Date.now() }];
    const from = (own: ActivityEntry) => ({
      active: 0,
      keys: new Set([paying.address.hex.slice(2, 58)]),
      stake: activityPreprod.stake,
      account: new Set<string>(),
      spent: new Set(txInputs(Uint8Array.from(Buffer.from(txCbor, "hex")))),
      reserved: new Set<string>(),
      listed: new Set<string>(),
      own: new Map([[txHash, own]]),
    });
    // It read "Back from Lovejoin +16.94 ₳" until the block, for an account that paid about 3.06 ₳.
    expect(pendingEntries(wasm, "preprod", sent, from(boxBack(txHash)))).toEqual([]);
    // The Make public it stands in for is still listed as what came in.
    const madePublic: ActivityEntry = { txHash, at: 1, kind: "withdraw", direction: "out", lovelace: paying.lovelace, tokens: 0 };
    expect(pendingEntries(wasm, "preprod", sent, from(madePublic))).toMatchObject([
      { txHash, kind: "withdraw", direction: "in", lovelace: paying.lovelace, pending: true },
    ]);
  });
});
