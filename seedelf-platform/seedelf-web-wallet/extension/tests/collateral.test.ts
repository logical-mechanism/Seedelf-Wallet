// The giveme.my client: the request it makes, and failures in plain words.
import { describe, expect, it } from "vitest";

import { Collateral, CollateralError, CollateralRefusedError, refusedBy } from "../src/background/collateral";

const URL_ = "https://www.giveme.my/preprod/collateral/";

describe("giveme.my client", () => {
  it("asks for a witness of the unsigned transaction", async () => {
    const sent: Array<{ url: string; init: RequestInit }> = [];
    const collateral = new Collateral(URL_, async (url, init) => {
      sent.push({ url, init });
      return Response.json({ witness: "a100818258" });
    });
    expect(await collateral.witness("84a4")).toEqual({ witness: "a100818258" });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(URL_);
    expect(sent[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(sent[0]!.init.body))).toEqual({ tx: "84a4" });
  });

  it("says why it refused, and when it can't be reached", async () => {
    let asked = 0;
    const refused = new Collateral(URL_, async () => (asked++, Response.json({ detail: "Transaction Fails Validation" }, { status: 400 })));
    await expect(refused.witness("84a4")).rejects.toThrow(
      "giveme.my, which lends the collateral, refused this transaction: Transaction Fails Validation.",
    );
    expect(asked).toBe(1); // never retried
    // A refusal, which the wallet takes as a sign its view of the contract is behind.
    await expect(refused.witness("84a4")).rejects.toBeInstanceOf(CollateralRefusedError);

    // An outage or a limit is said as one, for the screen to say wait, not that the user's money changed (blind test
    // §9.5); a refusal with no words of giveme.my's still names its status.
    const down = new Collateral(URL_, async () => new Response("<html>", { status: 502 }));
    const outage = await down.witness("84a4").catch((e: unknown) => e);
    expect((outage as Error).message).toBe("giveme.my, which lends the collateral, couldn't take this transaction just now (502).");
    expect(refusedBy(outage)).toBe("givemeBusy");
    const limited = new Collateral(URL_, async () => new Response("", { status: 429 }));
    expect(refusedBy(await limited.witness("84a4").catch((e: unknown) => e))).toBe("givemeBusy");
    const bare = new Collateral(URL_, async () => new Response("", { status: 400 }));
    const plain = await bare.witness("84a4").catch((e: unknown) => e);
    expect((plain as Error).message).toContain("refused this transaction (400)");
    expect(refusedBy(plain)).toBe("giveme");

    const offline = new Collateral(URL_, async () => {
      throw new TypeError("Failed to fetch");
    });
    const e = await offline.witness("84a4").catch((e: unknown) => e);
    expect(e).toBeInstanceOf(CollateralError);
    expect(e).not.toBeInstanceOf(CollateralRefusedError);
    expect(refusedBy(e)).toBeUndefined();
    expect((e as Error).message).toContain("Couldn't reach giveme.my, which lends the collateral (Failed to fetch)");

    const garbled = new Collateral(URL_, async () => new Response("ok"));
    await expect(garbled.witness("84a4")).rejects.toThrow("isn't JSON");
  });
});
