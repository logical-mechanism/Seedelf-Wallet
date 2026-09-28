// Newer Cardano nodes answer a transaction whose every input is spent from
// their mempool, before the ledger would: "All inputs are spent. Transaction
// has probably already been included". It's what BadInputsUTxO says, and most
// often it's this very transaction, already in a block. Read as a plain
// refusal, it stopped a chain through Lovejoin at 38 of its 49 transactions
// (found live, 2026-09-28): a resend of one already in met it.
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { Koios, SpentInputError } from "../src/background/koios";
import { Minswap } from "../src/background/minswap";
import { SessionService } from "../src/background/sessions";
import { CHAINS, withSession, type Tested } from "./chain-fixtures";
import { txIdOf } from "./fixtures/cbor";

/** Koios's answer, as it came live. */
const ALL_SPENT = JSON.stringify({
  contents: {
    contents: {
      contents: {
        era: "ShelleyBasedEraConway",
        error: ['ConwayMempoolFailure "All inputs are spent. Transaction has probably already been included"'],
        kind: "ShelleyTxValidationError",
      },
      tag: "TxValidationErrorInCardanoMode",
    },
    tag: "TxCmdTxSubmitValidationError",
  },
  tag: "TxSubmitFail",
});

describe("a node's \"All inputs are spent\"", () => {
  it("is a UTxO already spent, as BadInputsUTxO is, and isn't sent again", async () => {
    let calls = 0;
    const koios = new Koios("https://preprod.koios.rest/api/v1", async () => (calls++, new Response(ALL_SPENT, { status: 400 })));
    const refusal = await koios.submitTx(new Uint8Array([0x84])).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(SpentInputError);
    expect((refusal as Error).message).toMatch("a UTxO it spends is already spent");
    expect(calls).toBe(1);
  });

  it("keeps a chain through Lovejoin going when a resend of one already in meets it, while tx_status is behind", CHAINS, async () => {
    const { t } = await withSession("40000000");
    const sessions = new SessionService({
      ...t.deps,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      store: t.store,
      minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
      lovejoin: t.lovejoin,
      sleep: async (ms: number) => {
        t.clock.now += ms;
        await t.wallet.touch();
      },
    });
    // Each transaction lands at its first submit; a second submit of one meets
    // the node's answer; tx_status is down meanwhile.
    const fetch = t.koios.fetch;
    const sent = new Set<string>();
    const landed = new Set<string>();
    let met = 0;
    let down = true;
    t.koios.fetch = async (url, init) => {
      if (url.endsWith("/submittx")) {
        const id = txIdOf(new Uint8Array(init!.body as Uint8Array));
        if (sent.has(id)) {
          met++;
          return new Response(ALL_SPENT, { status: 400 });
        }
        sent.add(id);
        landed.add(id);
        return fetch(url, init);
      }
      if (url.endsWith("/tx_status")) {
        if (down) return new Response("", { status: 502 });
        const { _tx_hashes } = JSON.parse(String(init!.body)) as { _tx_hashes: string[] };
        return Response.json(_tx_hashes.map((tx_hash) => ({ tx_hash, num_confirmations: landed.has(tx_hash) ? 1 : null })));
      }
      return fetch(url, init);
    };
    const alarm = async (t: Tested, minutes: number) => {
      for (let m = 0; m < minutes; m++) {
        t.clock.now += 60_000;
        await t.wallet.touch();
        await sessions.runAll("preprod");
      }
    };

    const review = await sessions.backBuild("preprod", 0);
    await sessions.backSubmit("preprod", review.txHash);
    await alarm(t, 8);
    expect(met).toBeGreaterThan(0);
    expect((await sessions.list("preprod"))[0]!.chain?.stopped).toBeUndefined();
    // tx_status answers again: the rest goes, and nothing stopped it.
    down = false;
    await alarm(t, 3);
    const view = (await sessions.list("preprod"))[0]!;
    expect(view.chain).toMatchObject({ total: 10, sent: 10 });
    expect(view.chain?.stopped).toBeUndefined();
  });
});
