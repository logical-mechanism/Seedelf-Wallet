// A submit's answer that's cut off after its status, or that isn't the id it
// should be, may have gone through all the same: Koios passed the transaction
// on before it answered. It's a KoiosBusyError, maybe sent, never a plain
// failure that sends an accepted payment down the failed path (independent
// review L2).
import { describe, expect, it } from "vitest";

import { Koios, KoiosBusyError, KoiosError } from "../src/background/koios";
import { pendingKey } from "../src/background/pending";
import { SESSION_SEND } from "../src/background/send";
import { spentSet } from "../src/background/spent";
import { txIdOf } from "./fixtures/cbor";
import { testBalances, vectors } from "./fakes";

const BASE = "https://preprod.koios.rest/api/v1";

/** A body that fails partway, as a connection dropped or the 20 s timeout firing after the status line does. */
function cutOff(status: number): Response {
  const body = new ReadableStream({
    start(controller) {
      controller.error(new DOMException("signal timed out", "TimeoutError"));
    },
  });
  return new Response(body, { status });
}

const submit = (answer: () => Response) =>
  new Koios(BASE, async () => answer())
    .submitTx(new Uint8Array([0x84]))
    .catch((e: unknown) => e as Error);

describe("a submit's answer", () => {
  it("that's cut off after a 2xx status is maybe sent", async () => {
    const e = await submit(() => cutOff(202));
    expect(e).toBeInstanceOf(KoiosBusyError);
    expect((e as KoiosBusyError).maybeSent).toBe(true);
  });

  it("that's cut off after a refusal's status is maybe sent too: what it said can't be known", async () => {
    const e = await submit(() => cutOff(400));
    expect(e).toBeInstanceOf(KoiosBusyError);
    expect((e as KoiosBusyError).maybeSent).toBe(true);
  });

  it("that isn't JSON, or isn't an id, after a 2xx is maybe sent", async () => {
    for (const body of ["<html>gateway</html>", JSON.stringify({ id: "ab" }), ""]) {
      const e = await submit(() => new Response(body, { status: 202 }));
      expect(e).toBeInstanceOf(KoiosBusyError);
      expect((e as KoiosBusyError).maybeSent).toBe(true);
    }
  });

  it("stays what it was otherwise: a 429 cut off isn't maybe sent, and a refusal read whole is a refusal", async () => {
    const limited = await submit(() => cutOff(429));
    expect(limited).toBeInstanceOf(KoiosBusyError);
    expect((limited as KoiosBusyError).maybeSent).toBe(false);
    const refused = await submit(() => new Response("ValueNotConserved", { status: 400 }));
    expect(refused).toBeInstanceOf(KoiosError);
    expect(refused).not.toBeInstanceOf(KoiosBusyError);
    const ok = await new Koios(BASE, async () => Response.json("ab".repeat(32), { status: 202 })).submitTx(new Uint8Array([0x84]));
    expect(ok).toBe("ab".repeat(32));
  });
});

describe("a Send whose answer was cut off", () => {
  it("is watched as maybe sent, its UTxOs held back, and kept to go again as it is", async () => {
    const t = testBalances();
    const phrase = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase;
    await t.wallet.create(phrase, "correct horse battery");
    const to = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 15)!.preprod
      .receive_0 as string;
    const summary = await t.send.build("preprod", [{ to, lovelace: "2000000", tokens: [] }]);
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) => {
      const answer = await real(url, init);
      // The network took it (the fake recorded it), and the answer never arrived whole.
      return url.endsWith("/submittx") ? cutOff(202) : answer;
    };
    expect(await t.send.submit("preprod", summary.txHash)).toMatchObject({ txHash: summary.txHash, maybeSent: true });
    expect(t.koios.submitted.map((b) => txIdOf(b))).toEqual([summary.txHash]);
    expect(await t.session.get(pendingKey("preprod"))).toMatchObject({ txHash: summary.txHash, maybeSent: true });
    expect((await spentSet(t.session)).size).toBeGreaterThan(0);
    expect(await t.session.get(SESSION_SEND)).toHaveProperty("sentCbor");
  });
});
