// Who paid for an account-paid mint is the account its review was built and
// signed on. Another window may switch accounts before Send, and the record
// named the account switched to: Remove then said "links nothing new" on the
// wrong one, and sent the Seedelf's ADA there, tying the two accounts together
// (release review). As Send's own records have it (pending-activity.test.ts).
import { describe, expect, it } from "vitest";

import { mintedBy } from "../src/background/minted-by";
import { SESSION_SENT_PREFIX, type SentTx } from "../src/background/sent-txs";
import { LOCAL_ACCOUNT } from "../src/shared/preferences";
import { accountMintPreprod, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const phrase = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase as string;

describe("an account-paid mint reviewed on one account and sent from another window's switch", () => {
  it("records the account that paid, not the one active at Send", async () => {
    const t = testBalances();
    await t.wallet.create(phrase, PASSWORD);
    t.koios.evaluation = accountMintPreprod.evaluation;
    const summary = await t.mint.build("preprod", "first", "account");
    await t.local.set(LOCAL_ACCOUNT, 1);
    await t.mint.submit("preprod", summary.txHash);
    expect(await mintedBy(t.store, "preprod")).toEqual({ [summary.tokenName]: "account:0" });
    // The same account Send's own record of it names.
    const sent = (await t.wallet.withKeys(() => t.session.get<SentTx[]>(`${SESSION_SENT_PREFIX}preprod`)))!;
    expect(sent.find((s) => s.txHash === summary.txHash)?.account).toBe(0);
  });
});
