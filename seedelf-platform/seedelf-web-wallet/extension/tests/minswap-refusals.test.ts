// What Minswap says when it refuses, as the wallet keeps it. A build whose
// transaction failed when Minswap ran it ends with the whole transaction as
// hex ("| RawTx: 84aa…", a Danogo pool's script on preprod, 2026-10-23): a few
// KB that ran off a swap's retry line as one word. It's cut from the words
// and kept apart, for a report, and the refusal gets a code of its own.
import { describe, expect, it } from "vitest";

import { Minswap, MinswapError } from "../src/background/minswap";
import { sessionSwap } from "./fakes";

const WHY = "Error evaluating tx: Error: failed script execution Withdraw[0] the validator crashed / exited prematurely";
const CBOR = sessionSwap.swapCbor;
const ASK = { amount: "10000000", tokenIn: "lovelace", tokenOut: "ab".repeat(28), slippage: 1 };

/** Minswap answering every build with `answer`. */
const minswap = (answer: () => Response) => new Minswap("https://minswap.test/aggregator", async () => answer());

async function refusal(answer: () => Response): Promise<MinswapError> {
  const e = await minswap(answer)
    .buildTx(sessionSwap.address, "1", ASK)
    .then(() => undefined, (e: unknown) => e);
  expect(e).toBeInstanceOf(MinswapError);
  return e as MinswapError;
}

describe("a build Minswap couldn't run", () => {
  it("keeps its words, and the transaction it came with apart from them", async () => {
    const e = await refusal(() => Response.json({ error: "InternalServerError", message: `${WHY} | RawTx: ${CBOR}` }, { status: 500 }));
    expect(e.message).toBe(`Minswap refused it (500): ${WHY}`);
    expect(e.trouble).toBe("build-failed");
    expect(e.cbor).toBe(CBOR);
  });

  it("does the same for an answer that isn't JSON, cutting the transaction off before the words are cut short", async () => {
    const e = await refusal(() => new Response(`${WHY} | RawTx: ${CBOR}.`, { status: 500 }));
    expect(e.message).toBe(`Minswap refused it (500): ${WHY}`);
    expect(e.cbor).toBe(CBOR);
  });
});

describe("any other refusal", () => {
  it("is kept as Minswap said it, with no transaction", async () => {
    const e = await refusal(() => Response.json({ error: "InvalidOrderOptionsError", message: "Invalid order options." }, { status: 400 }));
    expect(e.message).toBe("Minswap refused it (400): Invalid order options.");
    expect(e.trouble).toBeUndefined();
    expect(e.cbor).toBeUndefined();
  });

  it("is its first 300 characters when it isn't JSON", async () => {
    const e = await refusal(() => new Response(`<html>${"x".repeat(400)}</html>`, { status: 502 }));
    expect(e.message).toBe(`Minswap refused it (502): <html>${"x".repeat(294)}`);
  });
});
