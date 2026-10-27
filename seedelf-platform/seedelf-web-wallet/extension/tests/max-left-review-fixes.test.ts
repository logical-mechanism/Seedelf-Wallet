// 1.6.0's release review: why Max on the private side says it left UTxOs for another payment (321-parts-worker#6,
// x-scenarios-sessions#1). 1.5.0's one transaction left them past the 20 it spends, or for a token that wouldn't fit,
// and the review told the two apart by how many UTxOs it spent. Max in parts also leaves them when a later part can't
// pay its fee even chained, or past the 25 transactions a payment goes as, and its parts may spend fewer than 20 each:
// the review then gave a false reason. WebAssembly's last part now says why (lib.rs `LeftWhy`, tested in
// wasm/tests/api_test.rs), the worker passes it on, and the review says it.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { Koios } from "../src/background/koios";
import { TransferService } from "../src/background/transfer";
import { WithdrawService } from "../src/background/withdraw";
import type { LeftWhy, WithdrawSummary } from "../src/shared/rpc";
import { MaxLeftNote } from "../src/ui/screens/Withdraw";
import { loadTestWasm, ownedUtxos, testBalances, transferPreprod, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const SLOW = { timeout: 120_000 };
const v12 = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!;
/** The 12-word phrase's own receive address: Make public's. */
const OWN = v12.preprod.receive_0 as string;
/** "This is a test.", a live preprod Seedelf the phrase doesn't own. */
const THEIRS = transferPreprod.to;

/** A Max review's figures for the note: `parts` transactions of 20 UTxOs, none when it's one. */
const review = (left: number, leftWhy: LeftWhy | undefined, inputs: number, parts = 1): Pick<WithdrawSummary, "left" | "leftWhy" | "inputs" | "parts"> => ({
  left,
  ...(leftWhy ? { leftWhy } : {}),
  inputs,
  ...(parts > 1 ? { parts: Array.from({ length: parts }, (_, i) => ({ txHash: String(i).padStart(64, "0"), fee: "250000", inputs: 20 })) } : {}),
});

const note = (of: ReturnType<typeof review>) =>
  renderToStaticMarkup(createElement(MaxLeftNote, { of, testId: "withdraw-left" }))
    .replace(/<[^>]+>/g, "")
    .replaceAll("&#x27;", "'");

describe("Max's note on what it left (1.6.0's release review, 321-parts-worker#6, x-scenarios-sessions#1)", () => {
  it("says too little ADA pays for spending them, where a part couldn't pay its fee even chained", () => {
    // One part of 20 went (a little ADA and 19 bundles at their least); the other 21 bundles can't pay their fee. The
    // review said "a payment takes 20 at most", though a payment in parts takes 500.
    expect(note(review(21, "fee", 20))).toBe(
      "21 private UTxOs stay for another payment: there's too little ADA to pay for spending them.",
    );
    // Its parts spent fewer than 500: the review said its token wouldn't fit.
    expect(note(review(1, "fee", 32, 2))).toBe(
      "1 private UTxO stays for another payment: there's too little ADA to pay for spending it.",
    );
  });

  it("says a payment goes as 25 transactions at most, past them, however many UTxOs those spent", () => {
    // 25 parts held back by size, about 12 UTxOs each: the review said each UTxO held a token that wouldn't fit.
    expect(note(review(40, "limit", 300, 25))).toBe(
      "40 private UTxOs stay for another payment: a payment goes as 25 transactions at most.",
    );
    expect(note(review(7, "limit", 500, 25))).toBe(
      "7 private UTxOs stay for another payment: a payment goes as 25 transactions at most.",
    );
  });

  it("says a token wouldn't fit where no part could take it with the rest, and nothing where Max left nothing", () => {
    expect(note(review(1, "tokens", 33, 2))).toBe(
      "1 private UTxO stays for another payment: its token won't fit in one output with the rest.",
    );
    expect(note(review(0, undefined, 32, 2))).toBe("");
  });
});

type T = ReturnType<typeof testBalances>;

async function unlocked(more = 0): Promise<T> {
  const t = testBalances();
  await t.wallet.create(v12.phrase, PASSWORD);
  // `more` of its 25 ₳ Seedelf UTxO, each its own outpoint, as boxes brought back from Lovejoin are.
  const base = ownedUtxos[0]!;
  t.koios.added.push(...Array.from({ length: more }, (_, i) => ({ ...base, tx_hash: (i + 1).toString(16).padStart(64, "0") })));
  return t;
}

/**
 * The services, WebAssembly's parts as the test package builds them, but for the last part's `left` and `leftWhy`,
 * which `says` sets: the rebuilt package's answer where Max left some (lib.rs `max_in_parts`), so these pass on the
 * worker alone.
 */
function services(t: T, says?: { left: number; leftWhy: LeftWhy }) {
  const wasm = loadTestWasm();
  const last = (json: string) => {
    if (!says) return json;
    const built = JSON.parse(json) as { parts: Array<Record<string, unknown>> };
    Object.assign(built.parts.at(-1)!, says);
    return JSON.stringify(built);
  };
  const deps = {
    wasm: {
      ...wasm,
      buildTransferParts: (key: Parameters<typeof wasm.buildTransferParts>[0], request: string) => last(wasm.buildTransferParts(key, request)),
      buildWithdrawParts: (key: Parameters<typeof wasm.buildWithdrawParts>[0], request: string) => last(wasm.buildWithdrawParts(key, request)),
    } as typeof wasm,
    wallet: t.wallet,
    session: t.session,
    koios: () => new Koios("https://preprod.koios.rest/api/v1", t.koios.fetch, async () => undefined),
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    now: () => t.clock.now,
    coins: t.coins,
    store: t.store,
  };
  return { withdraw: new WithdrawService(deps), transfer: new TransferService(deps) };
}

describe("why Max left UTxOs, on the worker's review (1.6.0's release review, 321-parts-worker#6)", SLOW, () => {
  it("is the last part's, on Make public's and Send's reviews of a payment in parts", async () => {
    const t = await unlocked(30);
    const { withdraw, transfer } = services(t, { left: 3, leftWhy: "fee" });
    const made = await withdraw.build("preprod", [{ to: OWN, lovelace: null, tokens: [] }]);
    expect(made.parts).toHaveLength(2);
    expect(made).toMatchObject({ max: true, left: 3, leftWhy: "fee" });
    const sent = await transfer.build("preprod", [{ to: THEIRS, lovelace: null, tokens: [] }]);
    expect(sent.parts).toHaveLength(2);
    expect(sent).toMatchObject({ max: true, left: 3, leftWhy: "fee" });
  });

  it("is the one transaction's, where Max goes as one", async () => {
    const t = await unlocked();
    const { withdraw } = services(t, { left: 40, leftWhy: "limit" });
    const made = await withdraw.build("preprod", [{ to: OWN, lovelace: null, tokens: [] }]);
    expect(made.parts).toBeUndefined();
    expect(made).toMatchObject({ left: 40, leftWhy: "limit" });
  });

  it("is never said where Max left nothing", async () => {
    const t = await unlocked(30);
    const { withdraw } = services(t);
    const made = await withdraw.build("preprod", [{ to: OWN, lovelace: null, tokens: [] }]);
    expect(made.left).toBe(0);
    expect(made.leftWhy).toBeUndefined();
  });
});
