// Chunk 51, r2a#3: an amount too large for the private balance is told the most one can be ("up to about X ₳"), built
// again on the same UTxOs. Max spends every UTxO, a stranger's pile of tokens too, whose tokens need more ADA kept
// with them than it holds; an amount never takes such a UTxO for its ADA, so the figure is asked of WebAssembly as
// `most`, which leaves it out (lib.rs `adding`). Make public asked for `most` already; a private Send now does too.
import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { Koios } from "../src/background/koios";
import { TransferService } from "../src/background/transfer";
import { WithdrawService } from "../src/background/withdraw";
import { loadTestWasm, testBalances, transferPreprod, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;

async function unlocked() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  t.koios.evaluation = transferPreprod.evaluation;
  return t;
}

/** The deps, with WebAssembly's two parts builders keeping what each was asked. */
function recording(t: Awaited<ReturnType<typeof unlocked>>) {
  const wasm = loadTestWasm();
  const asked: Array<{ most?: boolean; payments: Array<{ lovelace: string | null }> }> = [];
  type Key = Parameters<typeof wasm.buildTransferParts>[0];
  const deps = {
    wasm: {
      ...wasm,
      buildTransferParts: (key: Key, request: string) => (asked.push(JSON.parse(request)), wasm.buildTransferParts(key, request)),
      buildWithdrawParts: (key: Key, request: string) => (asked.push(JSON.parse(request)), wasm.buildWithdrawParts(key, request)),
    } as typeof wasm,
    wallet: t.wallet,
    session: t.session,
    koios: () => new Koios("https://preprod.koios.rest/api/v1", t.koios.fetch, async () => undefined),
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    now: () => t.clock.now,
    coins: t.coins,
    store: t.store,
  };
  return { deps, asked };
}

describe("the most an amount can be, said when one is too much (chunk 51, r2a#3)", () => {
  it("is asked of WebAssembly as `most`, never as Max over every UTxO, paying a Seedelf or an address", async () => {
    const t = await unlocked();
    const { deps, asked } = recording(t);
    // T05's private balance holds about 28 ₳.
    await expect(
      new TransferService(deps).build("preprod", [{ to: transferPreprod.to, lovelace: "30000000", tokens: [] }]),
    ).rejects.toThrow("up to about");
    expect(asked).toHaveLength(2);
    expect(asked[0]!.most).toBeUndefined();
    expect(asked[1]).toMatchObject({ most: true, payments: [{ lovelace: null }] });

    asked.length = 0;
    const theirs = account(15).preprod.receive_0 as string;
    await expect(
      new WithdrawService(deps).build("preprod", [{ to: theirs, lovelace: "30000000", tokens: [] }]),
    ).rejects.toThrow("up to about");
    expect(asked).toHaveLength(2);
    expect(asked[1]).toMatchObject({ most: true, payments: [{ lovelace: null }] });
  });
});
