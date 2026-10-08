// A site's signData, approved with the dApp password on, while The account
// sites use changes in another window as the password is checked: refused
// with CIP-30's AccountChange (-4), as a signTx is, so the site knows to call
// enable() again (chunk 25; 1.3.0's release review, C30). dapp-account-change.test.ts
// drives the same race for a signTx; nothing drove it for a signData.
import { describe, expect, it } from "vitest";

import { type DappSession } from "../src/background/dapp";
import { APIError } from "../src/shared/dapp";
import { testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
/** The one vector phrase with both accounts recorded. */
const phrase = (account: 0 | 1) =>
  vectors("cardano_account.json").find((v) => v.account === account && v.phrase.split(" ").length === 24)!;
const site = (): DappSession => ({ id: "signDataRace", origin: "https://app.example.com", title: "Example" });
const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}

describe("a site's signData as the dApp account changes while the password is checked", () => {
  it("is refused with AccountChange, past the first look, and nothing is signed", async () => {
    const t = testBalances();
    await t.wallet.create(phrase(0).phrase, PASSWORD);
    await t.accounts.recordFirst();
    await t.preferences.set({ dappConnector: true, dappPassword: true, spendRewards: false });
    // Account 1 of this phrase has been used, so the wallet can move to it.
    t.koios.usedStakes.add(phrase(1).preprod.stake as string);
    await t.accounts.discover("preprod");
    const a = site();
    const enabling = t.dapp.call(a, "enable", []);
    await until(() => t.dapp.approvals().length === 1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
    expect(await enabling).toBe(true);

    const own = t.deps.wasm.cip30Address(phrase(0).preprod.receive_0 as string);
    const message = t.dapp.call(a, "signData", [own, hex("Sign in: nonce 7")]);
    message.catch(() => undefined);
    await until(() => t.dapp.approvals().length === 1);
    // The change lands while the password is checked: after the approval's first look at the account.
    const check = t.wallet.checkPassword.bind(t.wallet);
    t.wallet.checkPassword = async (password: string) => {
      await check(password);
      await t.preferences.set({ dappAccount: 1 });
    };
    const data = t.dapp.approvals().find((x) => x.kind === "sign-data")!;
    expect(await t.dapp.answer(data.id, true, PASSWORD)).toMatchObject({ error: expect.stringContaining("The account sites use changed") });
    await expect(message).rejects.toMatchObject({
      failure: { code: APIError.AccountChange, info: expect.stringContaining("The account sites use changed") },
    });
  });
});
