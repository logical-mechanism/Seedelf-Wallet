// The send service: pay an address or an ADA Handle from the Cardano account,
// built and signed through WebAssembly on the recorded preprod account, kept
// until Send, then submitted exactly and watched. Nothing goes to giveme.my,
// and nothing into the Seedelf history.
import { describe, expect, it } from "vitest";

import { ADA_HANDLE_POLICY } from "../src/background/destination";
import { SESSION_PENDING } from "../src/background/pending";
import { SESSION_SEND } from "../src/background/send";
import { txIdOf } from "./fixtures/cbor";
import { testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const TUSDM = { policyId: "e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9", assetName: "0014df10745553444d" };
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;
/** The 15-word phrase's receive address: someone else's. */
const THEIRS = account(15).preprod.receive_0 as string;
/** The 12-word phrase's own receive address. */
const OWN = account(12).preprod.receive_0 as string;

async function unlocked() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  return t;
}

describe("send", () => {
  it("builds and signs a payment without sending it, reading the account once", async () => {
    const t = await unlocked();
    const summary = await t.send.build("preprod", ` ${THEIRS} `, "3000000", [{ ...TUSDM, quantity: "1250000000" }]);
    expect(summary).toMatchObject({
      network: "preprod",
      address: THEIRS,
      own: false,
      max: false,
      lovelace: "3000000",
      tokens: [{ ...TUSDM, quantity: "1250000000" }],
    });
    expect(BigInt(summary.minimum!)).toBeLessThan(3_000_000n);
    expect(Number(summary.fee)).toBeGreaterThan(150_000);
    expect(summary.changeTokens).toBeGreaterThan(0); // the rest of the tUSDM, and the other tokens
    expect(t.koios.submitted).toHaveLength(0);
    expect(t.collateral.asked).toHaveLength(0);
    expect(t.koios.calls.map((c) => c.path).sort()).toEqual(["account_addresses", "account_utxos", "epoch_params"]);

    const built = await t.session.get<{ txCbor: string; txHash: string }>(SESSION_SEND);
    expect(built!.txHash).toBe(summary.txHash);
    expect(txIdOf(Uint8Array.from(Buffer.from(built!.txCbor, "hex")))).toBe(summary.txHash);
  });

  it("sends only the ADA the tokens need when the amount is empty, and raises a short one", async () => {
    const t = await unlocked();
    const token = await t.send.build("preprod", THEIRS, "0", [{ ...TUSDM, quantity: "1" }]);
    expect(token.lovelace).toBe(token.minimum);
    expect(BigInt(token.minimum!)).toBeGreaterThan(1_000_000n);
    const short = await t.send.build("preprod", THEIRS, "100000", []);
    expect(short.lovelace).toBe(short.minimum);
    const max = await t.send.build("preprod", THEIRS, null, []);
    expect(max).toMatchObject({ max: true, minimum: null, inputs: 6 });
  });

  it("pays a handle, and flags the account's own address", async () => {
    const t = await unlocked();
    t.koios.nfts.set(`${ADA_HANDLE_POLICY}.${Buffer.from("bob").toString("hex")}`, THEIRS);
    expect(await t.send.build("preprod", "$bob", "2000000", [])).toMatchObject({ address: THEIRS, handle: "bob" });
    expect(await t.send.build("preprod", OWN, "2000000", [])).toMatchObject({ address: OWN, own: true });
  });

  it("submits exactly the built transaction, then watches it, and writes no Seedelf history", async () => {
    const t = await unlocked();
    const summary = await t.send.build("preprod", THEIRS, "2000000", []);
    const pending = await t.send.submit("preprod", summary.txHash);
    expect(pending).toEqual({ kind: "send", network: "preprod", txHash: summary.txHash, submittedAt: t.clock.now, confirmations: null });
    expect(t.koios.submitted).toHaveLength(1);
    expect(txIdOf(t.koios.submitted[0]!)).toBe(summary.txHash);
    expect(t.collateral.asked).toHaveLength(0);
    expect(await t.session.get(SESSION_SEND)).toBeUndefined();
    expect(await t.session.get(SESSION_PENDING)).toMatchObject({ kind: "send" });
    expect(await t.activity.seedelf("preprod")).toEqual([]);
    await expect(t.send.submit("preprod", summary.txHash)).rejects.toThrow("isn't ready to send");
  });

  it("explains what stops a payment and needs the wallet unlocked", async () => {
    const t = await unlocked();
    await expect(t.send.build("preprod", "nope", "2000000", [])).rejects.toThrow("isn't a Cardano address");
    await expect(t.send.build("preprod", account(12).mainnet.receive_0, "2000000", [])).rejects.toThrow(
      "normal preprod address",
    );
    await expect(t.send.build("preprod", THEIRS, "999999999999999", [])).rejects.toThrow("Not enough ADA");
    await expect(t.send.build("preprod", THEIRS, "2000000", [{ ...TUSDM, quantity: "3000000001" }])).rejects.toThrow(
      "holds only 3000000000",
    );
    await t.wallet.lock();
    await expect(t.send.build("preprod", THEIRS, "2000000", [])).rejects.toThrow("locked");
  });
});
