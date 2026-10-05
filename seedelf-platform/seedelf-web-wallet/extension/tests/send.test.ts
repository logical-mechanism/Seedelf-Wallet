// The send service: pay an address, an ADA Handle or someone's seedelf from
// the Cardano account, built and signed through WebAssembly on the recorded
// preprod account, kept until Send, then submitted exactly and watched.
// Nothing goes to giveme.my, and nothing into the Seedelf history.
import { describe, expect, it } from "vitest";

import { Collateral, StaleReviewError } from "../src/background/collateral";
import { ADA_HANDLE_POLICY, checkPayable } from "../src/background/destination";
import { pendingKey } from "../src/background/pending";
import { SESSION_SEND, SendService } from "../src/background/send";
import { publicShort } from "../src/background/short";
import { WalletLocked, WASM_BROKEN } from "../src/background/wallet";
import { MAX_RECIPIENTS } from "../src/shared/recipients";
import { OWN_SEEDELF_FROM_ACCOUNT, SEEDELF_NOT_AN_ADDRESS } from "../src/shared/seedelf-name";
import { ttlOf, txIdOf } from "./fixtures/cbor";
import { koiosPreprod, loadTestWasm, ownedUtxos, testBalances, transferPreprod, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const TUSDM = { policyId: "e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9", assetName: "0014df10745553444d" };
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
/** The 15-word phrase's receive address: someone else's. */
const THEIRS = account(15).preprod.receive_0 as string;
/** The 12-word phrase's own receive address. */
const OWN = account(12).preprod.receive_0 as string;
/** "This is a test.", a live preprod seedelf the phrase doesn't own. */
const SEEDELF = transferPreprod.to;
/** The phrase's own seedelf, "web-wallet". */
const MINE = ownedUtxos[2]!.asset_list![0]!.asset_name;

async function unlocked() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  return t;
}

describe("send", () => {
  it("builds and signs a payment without sending it, reading the account once", async () => {
    const t = await unlocked();
    const summary = await t.send.build("preprod", [{ to: ` ${THEIRS} `, lovelace: "3000000", tokens: [{ ...TUSDM, quantity: "1250000000" }] }]);
    expect(summary).toMatchObject({
      network: "preprod",
      max: false,
      payments: [{ address: THEIRS, own: false, lovelace: "3000000", tokens: [{ ...TUSDM, quantity: "1250000000" }] }],
    });
    expect(BigInt(summary.payments[0]!.minimum!)).toBeLessThan(3_000_000n);
    expect(Number(summary.fee)).toBeGreaterThan(150_000);
    expect(summary.changeTokens).toBeGreaterThan(0); // the rest of the tUSDM, and the other tokens
    expect(t.koios.submitted).toHaveLength(0);
    expect(t.collateral.asked).toHaveLength(0);
    expect(t.koios.calls.map((c) => c.path).sort()).toEqual([
      "account_addresses",
      "account_info",
      "credential_utxos",
      "epoch_params",
      "tip",
    ]);
    // The account's staking rewards pay for it too (preferences.ts).
    expect(summary.withdrawal).toBe("57475311");

    const built = await t.session.get<{ txCbor: string; txHash: string }>(SESSION_SEND);
    expect(built!.txHash).toBe(summary.txHash);
    expect(txIdOf(Uint8Array.from(Buffer.from(built!.txCbor, "hex")))).toBe(summary.txHash);
  });

  it("puts a note on the payment as the transaction carries it, and refuses one that can't go", async () => {
    const t = await unlocked();
    const to = [{ to: THEIRS, lovelace: "3000000", tokens: [] }];
    const plain = await t.send.build("preprod", to);
    expect(plain.note ?? null).toBeNull();
    const noted = await t.send.build("preprod", to, "  Invoice 42  ");
    expect(noted.note).toBe("Invoice 42");
    // Its bytes are paid for.
    expect(BigInt(noted.fee)).toBeGreaterThan(BigInt(plain.fee));
    const built = await t.session.get<{ txCbor: string; txHash: string; note: string }>(SESSION_SEND);
    expect(built!.note).toBe("Invoice 42");
    expect(txIdOf(Uint8Array.from(Buffer.from(built!.txCbor, "hex")))).toBe(noted.txHash);
    await expect(t.send.build("preprod", to, "x".repeat(65))).rejects.toThrow("A note is at most 64 characters, not 65");
    await expect(t.send.build("preprod", to, "two\tparts")).rejects.toThrow("one line of text");
  });

  it("sends only the ADA the tokens need when the amount is empty, and raises a short one", async () => {
    const t = await unlocked();
    const [token] = (await t.send.build("preprod", [{ to: THEIRS, lovelace: "0", tokens: [{ ...TUSDM, quantity: "1" }] }])).payments;
    expect(token!.lovelace).toBe(token!.minimum);
    expect(BigInt(token!.minimum!)).toBeGreaterThan(1_000_000n);
    const [short] = (await t.send.build("preprod", [{ to: THEIRS, lovelace: "100000", tokens: [] }])).payments;
    expect(short!.lovelace).toBe(short!.minimum);
    const max = await t.send.build("preprod", [{ to: THEIRS, lovelace: null, tokens: [] }]);
    expect(max).toMatchObject({ max: true, payments: [{ minimum: null }], inputs: 6 });
  });

  it("pays a handle, and flags the account's own address", async () => {
    const t = await unlocked();
    t.koios.nfts.set(`${ADA_HANDLE_POLICY}.${Buffer.from("bob").toString("hex")}`, THEIRS);
    expect(await t.send.build("preprod", [{ to: "$bob", lovelace: "2000000", tokens: [] }])).toMatchObject({
      payments: [{ address: THEIRS, handle: "bob" }],
    });
    expect(await t.send.build("preprod", [{ to: OWN, lovelace: "2000000", tokens: [] }])).toMatchObject({
      payments: [{ address: OWN, own: true }],
    });
  });

  it("pays someone's Seedelf, found in the contract without asking Koios about it", async () => {
    const t = await unlocked();
    const pasted = ` ${SEEDELF.slice(0, 30).toUpperCase()} ${SEEDELF.slice(30)}\n`;
    const summary = await t.send.build("preprod", [{ to: pasted, lovelace: "5000000", tokens: [{ ...TUSDM, quantity: "1" }] }]);
    const holder = koiosPreprod.contract_utxos.find((u) => u.asset_list?.some((a) => a.asset_name === SEEDELF))!;
    expect(summary.payments).toMatchObject([
      {
        seedelf: { name: SEEDELF, label: "This is a test." },
        address: holder.address,
        own: false,
        lovelace: "5000000",
        tokens: [{ ...TUSDM, quantity: "1" }],
      },
    ]);
    expect(summary.payments[0]).not.toHaveProperty("recipient");
    // The account and the whole contract, as a balance reading asks: never the seedelf's token.
    expect(t.koios.calls.some((c) => c.body?._payment_credentials?.includes(koiosPreprod.wallet_contract))).toBe(true);
    expect(JSON.stringify(t.koios.calls)).not.toContain(SEEDELF);
    expect(t.collateral.asked).toHaveLength(0);

    // Paid under a new copy of the seedelf's register, never the one it sits under.
    const built = await t.session.get<{ txCbor: string }>(SESSION_SEND);
    const [generator, publicValue] = (holder.inline_datum!.value as { fields: Array<{ bytes: string }> }).fields.map((f) => f.bytes);
    expect(built!.txCbor).toContain(koiosPreprod.wallet_contract);
    expect(built!.txCbor).not.toContain(generator);
    expect(built!.txCbor).not.toContain(publicValue);

    const pending = await t.send.submit("preprod", summary.txHash);
    expect(pending).toMatchObject({ kind: "send", txHash: summary.txHash });
    expect(await t.activity.seedelf("preprod")).toEqual([]);
  });

  it("pays several at once: an address, a handle and a Seedelf, each its own amount and tokens", async () => {
    const t = await unlocked();
    t.koios.nfts.set(`${ADA_HANDLE_POLICY}.${Buffer.from("bob").toString("hex")}`, THEIRS);
    const summary = await t.send.build("preprod", [
      { to: THEIRS, lovelace: "3000000", tokens: [{ ...TUSDM, quantity: "1000" }] },
      { to: "$bob", lovelace: "0", tokens: [{ ...TUSDM, quantity: "2000" }] },
      { to: SEEDELF, lovelace: "4000000", tokens: [] },
      { to: " $Bob", lovelace: "2000000", tokens: [] },
    ]);
    expect(summary.max).toBe(false);
    expect(summary.payments).toMatchObject([
      { address: THEIRS, lovelace: "3000000", tokens: [{ ...TUSDM, quantity: "1000" }] },
      { address: THEIRS, handle: "bob", tokens: [{ ...TUSDM, quantity: "2000" }] },
      { seedelf: { name: SEEDELF, label: "This is a test." }, lovelace: "4000000", tokens: [] },
      { address: THEIRS, handle: "bob", lovelace: "2000000", tokens: [] },
    ]);
    expect(summary.payments[1]!.lovelace).toBe(summary.payments[1]!.minimum);
    // One reading of the account, one of the contract, and the handle, once though it's paid twice.
    expect(t.koios.calls.map((c) => c.path).sort()).toEqual([
      "account_addresses",
      "account_info",
      "asset_nft_address",
      "credential_utxos",
      "credential_utxos",
      "epoch_params",
      "tip",
    ]);

    // Max pays one recipient; and there's a limit to how many.
    const two = [
      { to: THEIRS, lovelace: null, tokens: [] },
      { to: THEIRS, lovelace: "2000000", tokens: [] },
    ];
    await expect(t.send.build("preprod", two)).rejects.toThrow("Max pays a single recipient");
    const crowd = Array.from({ length: MAX_RECIPIENTS + 1 }, () => ({ to: THEIRS, lovelace: "2000000", tokens: [] }));
    await expect(t.send.build("preprod", crowd)).rejects.toThrow(`at most ${MAX_RECIPIENTS} recipients`);
    await expect(t.send.build("preprod", [])).rejects.toThrow("someone to pay");
  });

  it("points your own Seedelf to Move in, and Withdraw's Seedelf to Send", async () => {
    const t = await unlocked();
    await expect(t.send.build("preprod", [{ to: MINE, lovelace: "5000000", tokens: [] }])).rejects.toThrow(OWN_SEEDELF_FROM_ACCOUNT());
    await expect(t.send.build("preprod", [{ to: `5eed0e1f${"00".repeat(28)}`, lovelace: "5000000", tokens: [] }])).rejects.toThrow(
      "No Seedelf with that name on preprod.",
    );
    await expect(t.withdraw.resolve("preprod", SEEDELF)).rejects.toThrow(SEEDELF_NOT_AN_ADDRESS());
  });

  it("submits exactly the built transaction, then watches it, and writes no Seedelf history", async () => {
    const t = await unlocked();
    const summary = await t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]);
    const pending = await t.send.submit("preprod", summary.txHash);
    expect(pending).toEqual({
      kind: "send",
      network: "preprod",
      txHash: summary.txHash,
      submittedAt: t.clock.now,
      confirmations: null,
      invalidHereafter: ttlOf(t.koios.submitted[0]!),
    });
    expect(t.koios.submitted).toHaveLength(1);
    expect(txIdOf(t.koios.submitted[0]!)).toBe(summary.txHash);
    expect(t.collateral.asked).toHaveLength(0);
    expect(await t.session.get(SESSION_SEND)).toBeUndefined();
    expect(await t.session.get(pendingKey("preprod"))).toMatchObject({ kind: "send" });
    expect(await t.activity.seedelf("preprod")).toEqual([]);
    // Send again, from a page that missed the answer: sent already, never a stale review, whose "Refresh and review
    // again" under "Nothing was sent" would build a second payment (chunk 23's second review, fix round).
    const again = await t.send.submit("preprod", summary.txHash).catch((e: unknown) => e);
    expect((again as Error).message).toMatch(/^That was sent already, so it isn't sent again\./);
    expect(again).not.toBeInstanceOf(StaleReviewError);
    // So after another page's review took Send's place, and after the worker restarted (a new service, the same
    // session storage).
    await t.send.build("preprod", [{ to: THEIRS, lovelace: "3000000", tokens: [] }]);
    await expect(t.send.submit("preprod", summary.txHash)).rejects.toThrow("sent already");
    await expect(new SendService(t.send["deps"]).submit("preprod", summary.txHash)).rejects.toThrow("sent already");
    expect(t.koios.submitted).toHaveLength(1);
    // One never sent, and no longer kept, is still a stale review.
    await expect(t.send.submit("preprod", "00".repeat(32))).rejects.toBeInstanceOf(StaleReviewError);
  });

  it("explains what stops a payment and needs the wallet unlocked", async () => {
    const t = await unlocked();
    await expect(t.send.build("preprod", [{ to: "nope", lovelace: "2000000", tokens: [] }])).rejects.toThrow("isn't a Cardano address");
    // What's wrong with an address, named (chunk 23's second review, PY-10).
    await expect(t.send.build("preprod", [{ to: account(12).mainnet.receive_0, lovelace: "2000000", tokens: [] }])).rejects.toThrow(
      "That's a mainnet address; this wallet is on Preprod.",
    );
    // Core's shortfall in the wallet's own words, with what Max would send that one recipient.
    const short = t.send.build("preprod", [{ to: THEIRS, lovelace: "999999999999999", tokens: [] }]);
    await expect(short).rejects.toThrow(/^Not enough ADA: with the fee, your public account can pay up to [\d,.]+\u00a0₳ here\. Use Max/);
    await expect(short).rejects.not.toThrow("Cardano account");
    // Two recipients have no Max: what to do instead.
    await expect(
      t.send.build("preprod", [
        { to: THEIRS, lovelace: "999999999999999", tokens: [] },
        { to: THEIRS, lovelace: "2000000", tokens: [] },
      ]),
    ).rejects.toThrow("Lower an amount, or take a recipient off.");
    await expect(t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [{ ...TUSDM, quantity: "3000000001" }] }])).rejects.toThrow(
      "holds only 3000000000",
    );
    await t.wallet.lock();
    await expect(t.send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }])).rejects.toThrow("locked");
  });

  it("says what would stay is too little when the amount fits, never 'up to' as much as was asked", async () => {
    // Core's shortfall comes too when the amount fits and what's left can't stay: 100 ₳ in one UTxO, 99.5 ₳ asked.
    // Max then pays more than was asked (chunk 23's second review, fix round).
    const t = await unlocked();
    await t.balances.get("preprod");
    // The account's ADA alone, so nothing has to come back with the tokens and Max leaves nothing behind.
    for (const u of (await t.coins.lists("preprod")).cardano) {
      if (u.tokens.length) await t.coins.setLocked("preprod", "cardano", `${u.txHash}#${u.index}`, true);
    }
    const most = BigInt((await t.send.build("preprod", [{ to: THEIRS, lovelace: null, tokens: [] }])).payments[0]!.lovelace);
    const pay = (...amounts: bigint[]) => t.send.build("preprod", amounts.map((a) => ({ to: THEIRS, lovelace: a.toString(), tokens: [] })));
    const left = "what stays in your public account would be less than the least ADA the network accepts";
    // Half an ADA under Max: it fits, and the half left over can't stay.
    const short = pay(most - 500_000n);
    await expect(short).rejects.toThrow(`Not enough ADA: after this payment and its fee, ${left}. Use Max to send all of it, or send less.`);
    await expect(short).rejects.not.toThrow("up to");
    // Over Max, it's still how much can go.
    await expect(pay(most + 1n)).rejects.toThrow("up to");
    // Two that fit together and leave too little, and two that come to more than the account holds.
    await expect(pay(2_000_000n, most - 2_500_000n)).rejects.toThrow(`after these payments and their fee, ${left}`);
    await expect(pay(2_000_000n, most)).rejects.toThrow("these come to more than your public account can pay");
  });

  it("hands on a trap in the Max rebuild or the address check, so the wallet locks, never as a refusal", async () => {
    // A trap leaves the instance broken for good (wasm.ts): taken for a shortfall or a bad address, the next build
    // ran on it (chunk 23's second review, fix round).
    const trap = new WebAssembly.RuntimeError("unreachable");
    expect(() => publicShort(() => { throw trap; }, () => "")).toThrow(trap);
    expect(publicShort(() => { throw new Error("Not enough ADA in the Cardano account"); }, () => "").message).toBe(
      "Not enough ADA in your public account for this and its fee.",
    );
    const wasm = loadTestWasm();
    const broken = { ...wasm, checkPayableAddress: () => { throw trap; } } as typeof wasm;
    expect(() => checkPayable(broken, "preprod", THEIRS)).toThrow(trap);

    const t = await unlocked();
    let builds = 0;
    const send = new SendService({
      ...t.deps,
      wasm: {
        ...wasm,
        buildAccountSend: () => {
          if (builds++ === 0) throw new Error("Not enough ADA in the Cardano account for this payment, its fee and the change");
          throw trap;
        },
      } as typeof wasm,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    });
    const e = await send.build("preprod", [{ to: THEIRS, lovelace: "2000000", tokens: [] }]).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(WalletLocked);
    expect((e as Error).message).toBe(WASM_BROKEN());
    expect(builds).toBe(2);
    expect(await t.wallet.state()).toBe("locked");
  });
});
