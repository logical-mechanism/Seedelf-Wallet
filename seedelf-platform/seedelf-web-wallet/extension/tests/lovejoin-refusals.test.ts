// 1.8.1's release review: the network's answers to Lovejoin as protocol version 11 gives them, which both networks run.
// A chain refused because its pool's reward balance moved as it was sent (LEDGER's ConwayIncompleteWithdrawals, as
// cardano-submit-api hands it on: readers#4) is said in Lovejoin's words wherever its Send or its runner shows it,
// never staking's (worker#1). Ogmios's answer for an input it doesn't know names it in a 3004's reason alone, which
// the wallet doesn't read: read (v-pv11-impact#2), it reached rules built for a 3117 Ogmios never sends, and Mix again
// gave up the wallet's own boxes, so it was taken back (r2-worker#1, r2-worker#2, r2-tests#1). The real WebAssembly,
// v2's 5 ₳ pool, and fakes of Koios and giveme.my.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import { RewardsChangedError, type KoiosAccountInfo } from "../src/background/koios";
import { REWARDS_MOVED, SESSION_LOVEJOIN_SENDING, unknownInputs } from "../src/background/lovejoin";
import { builtOutputs, Minswap } from "../src/background/minswap";
import { SessionService } from "../src/background/sessions";
import { reservationOf } from "../src/background/spent";
import { t as tr } from "../src/i18n";
import { account, AGREES, atSession, CHAINS, HOUR, PASSWORD, publicFunded, sessionsOf, withSession, type Tested } from "./chain-fixtures";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, sessionSwap, testBalances } from "./fakes";
import { ADA, ADA_POOL, ADA_ROWS, adaBox, madeByAdaMix, ownDatum } from "./v2-pools";

/** The 5 ₳ pool's `mix_logic` and its reward account, as WebAssembly names them. */
const MIX_LOGIC = JSON.parse(loadTestWasm().lovejoinMixLogic(JSON.stringify({ network: "preprod", poolRef: ADA_POOL }))) as {
  hash: string;
  stake: string;
};
/** A retired stake pool's deposit, refunded there. */
const WINDFALL = 500_000_000n;

/**
 * The network's refusal of a mix that withdraws a balance someone else took first, from protocol version 11: LEDGER's,
 * in cardano-submit-api's envelope (koios.test.ts), as cardano-ledger-conway 1.23 (node 11.1) `show`s it.
 */
const MOVED = JSON.stringify({
  contents: {
    contents: {
      contents: {
        era: "ShelleyBasedEraConway",
        error: [
          `ConwayIncompleteWithdrawals (NonEmptyMap (fromList [(AccountAddress {aaNetworkId = Testnet, aaId = AccountId {unAccountId = ScriptHashObj (ScriptHash "${MIX_LOGIC.hash}")}},Mismatch (RelEQ) {supplied: Coin ${WINDFALL}, expected: Coin 0})]))`,
        ],
        kind: "ShelleyTxValidationError",
      },
      tag: "TxValidationErrorInCardanoMode",
    },
    tag: "TxCmdTxSubmitValidationError",
  },
  tag: "TxSubmitFail",
});

/** `lovelace` in the 5 ₳ pool's `mix_logic` reward account, as account_info lists it. */
function holding(t: { koios: { stakes: Map<string, KoiosAccountInfo> } }, lovelace: bigint): void {
  t.koios.stakes.set(MIX_LOGIC.stake, {
    stake_address: MIX_LOGIC.stake,
    status: "registered",
    delegated_pool: null,
    delegated_drep: null,
    rewards_available: lovelace.toString(),
    deposit: "2000000",
  });
}

/** Koios refuses the `nth` submit as MOVED: a chain's first mix, which takes the balance, its deposit sent before it. */
function refusingThe(t: Tested, nth: number): void {
  const real = t.koios.fetch;
  let submits = 0;
  t.koios.fetch = async (url, init) => {
    if (url.endsWith("/submittx") && ++submits === nth) return new Response(MOVED, { status: 400 });
    return real(url, init);
  };
}

describe("a chain refused for its pool's reward balance, at protocol version 11", CHAINS, () => {
  it("is said in Lovejoin's words by a mix's Send from the public account, as by its progress, and keeps its type", async () => {
    const t = await publicFunded();
    holding(t, WINDFALL);
    const summary = await t.lovejoin.publicBuild("preprod", 1, { pool: ADA });
    refusingThe(t, 2);
    const e = await t.lovejoin.publicSubmit("preprod", summary.txHash).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(RewardsChangedError);
    expect((e as Error).message).toBe(REWARDS_MOVED());
    const sending = await t.wallet.withKeys(() => t.session.get<{ stopped?: string }>(`${SESSION_LOVEJOIN_SENDING}preprod`));
    expect(sending?.stopped).toBe(REWARDS_MOVED());
  });

  it("is said in Lovejoin's words by a reviewed return's Send, as by its session's chain", async () => {
    const { t, sessions } = await withSession("60000000");
    holding(t, WINDFALL);
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin).toBeDefined();
    refusingThe(t, 2);
    const e = await sessions.backSubmit("preprod", review.txHash).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(RewardsChangedError);
    expect((e as Error).message).toBe(REWARDS_MOVED());
    const record = (await t.store.get<{ sessions: Array<{ chain?: { stopped?: string } }> }>("sessions.preprod"))!.sessions[0]!;
    expect(record.chain?.stopped).toBe(REWARDS_MOVED());
  });

  it("is said in Lovejoin's words on Bring everything back's line for the return that didn't go", async () => {
    const { t, sessions } = await withSession("60000000");
    holding(t, WINDFALL);
    const claim = await sessions.claimBuild("preprod", [0]);
    expect(claim.returns).toHaveLength(1);
    refusingThe(t, 2);
    const { failed } = await sessions.claimSubmit("preprod", [claim.returns[0]!.txHash]);
    expect(failed).toEqual([{ index: 0, error: REWARDS_MOVED() }]);
  });

  it("is said in Lovejoin's words on a mix's retry line when it runs itself, as by its stop", { timeout: 120_000 }, async () => {
    const t = testBalances({ pools: [ADA_POOL] });
    await t.wallet.create(account(12).phrase, PASSWORD);
    t.koios.evaluation = AGREES;
    const created = t.clock.now - HOUR;
    const FUNDING = "ab".repeat(32);
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: created,
          txs: [{ kind: "out", txHash: FUNDING, at: created, confirmed: true }],
          mix: { boxes: 1, pool: ADA },
          auto: { approved: { minAmountOut: "0", fund: { lovelace: "10300000", tokens: [] } } },
        },
      ],
    });
    t.koios.addedToAccounts.push(atSession(FUNDING, 0, "10300000"), atSession(FUNDING, 1, "5000000"), ...ADA_ROWS);
    const sessions = new SessionService({
      ...t.deps,
      collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
      store: t.store,
      minswap: () => new Minswap("https://aggr.monorepo-testnet-preprod.minswap.org/aggregator", t.minswap.fetch),
      lovejoin: t.lovejoin,
      sleep: async () => undefined,
      random: () => 0.5,
      alarm: { start: async () => undefined },
    });
    holding(t, WINDFALL);
    refusingThe(t, 2);
    await sessions.advance("preprod", 0, true).catch(() => undefined);
    const [view] = await sessions.list("preprod");
    expect(view!.chain?.stopped).toBe(REWARDS_MOVED());
    expect(view!.auto?.retry?.error).toBe(REWARDS_MOVED());
  });
});

/** Preprod Ogmios's answer through Koios for a draft whose inputs it can't resolve (seedelf-core's recorded fixture). */
const RECORDED = JSON.parse(readFileSync(new URL("../../../seedelf-core/tests/fixtures/ogmios/unknown_inputs.json", import.meta.url), "utf8")) as {
  error: { code: number; data: Array<{ error: { code: number } }> };
};

describe("the inputs Ogmios's answer says it doesn't know", () => {
  it("are none the wallet reads in Ogmios's own answer, stale all the same: its 3004's reason is never read", () => {
    expect(RECORDED.error.data.map((i) => i.error.code)).toEqual([3110, 3110, 3004]);
    // Named from that reason, the input reached the rules for one Ogmios hasn't caught up with, and Mix again's own
    // boxes, together: they wait for a rework (1.8.1's release review, r2-worker#1, r2-worker#2, r2-tests#1).
    expect(unknownInputs(RECORDED)).toEqual([]);
    // A 3117's list is named, which Ogmios never answers an evaluation with.
    const listed = { error: { code: 3117, data: { unknownOutputReferences: [{ transaction: { id: "b2".repeat(32) }, index: 1 }] } } };
    expect(unknownInputs(listed)).toEqual([`${"b2".repeat(32)}#1`]);
  });

  it("are none where the answer isn't stale: a reason alone never makes it so", () => {
    // A 3004 alone: whatever its reason says, no 3110 or 3117 makes the answer stale.
    expect(unknownInputs({ error: { code: 3010, data: [RECORDED.error.data[2]!] } })).toBeUndefined();
    expect(unknownInputs(AGREES)).toBeUndefined();
    // Stale, with a reason that names nothing: stale still, and unnamed.
    const unnamed = { error: { code: 3010, data: [RECORDED.error.data[0]!, { error: { code: 3004, data: { reason: "Unknown transaction input" } } }] } };
    expect(unknownInputs(unnamed)).toEqual([]);
  });
});

/** RECORDED, naming `outpoint` where it names the input it can't find. */
const unknownTo = (outpoint: string): unknown => JSON.parse(JSON.stringify(RECORDED).replaceAll(`${"a1".repeat(32)}#0`, outpoint));

/**
 * Mix my boxes again whose first mix an Ogmios a block behind the pool read measures (preprod's Koios, or mainnet's
 * with Koios-only on): it doesn't know the wallet's own box yet, and names it as Ogmios does. That's the pool changing,
 * to try again in a minute, never the wallet's boxes gone (1.8.1's release review, r2-tests#1, r2-worker#2).
 */
describe("Mix my boxes again, its own box unknown to the Ogmios that measures it", CHAINS, () => {
  /**
   * lovejoin-reward-balance.test.ts's: the public account's two boxes in the 5 ₳ pool, the mix that put them in cut by
   * a lock after its deposit.
   */
  async function cutAfterDeposit() {
    const t = await publicFunded();
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    const [D, A, B] = ["d0", "a0", "b0"].map((h) => h.repeat(32)) as [string, string, string];
    await t.store.set("lovejoin.preprod", {
      due: [],
      chains: [
        {
          id: B,
          account: 0,
          progress: `${SESSION_LOVEJOIN_SENDING}preprod`,
          deposit: D,
          mixes: [A, B],
          leaves: [
            { txHash: A, txIndex: 0, pool: ADA },
            { txHash: B, txIndex: 0, pool: ADA },
          ],
          boxes: 2,
          pools: { [ADA]: 2 },
          total: 3,
          sent: 1,
          at: t.clock.now - HOUR,
          scheduled: true,
          stopped: "cut",
          cut: true,
          ended: t.clock.now - HOUR,
        },
      ],
    });
    t.koios.addedToAccounts.push(adaBox(D, await ownDatum(t.wallet), t.clock.now, 5, 0), adaBox(D, await ownDatum(t.wallet), t.clock.now, 5, 1));
    return { t, own: [`${D}#0`, `${D}#1`] };
  }

  it("from the public account, is told to try again in a minute, never that the account has no box there", async () => {
    const { t, own } = await cutAfterDeposit();
    // The first of the account's boxes a transaction spends, named, as Ogmios names the first input it can't find.
    const named: string[] = [];
    t.koios.evaluation = (body: { params: { transaction: { cbor: string } } }) => {
      const [first] = reservationOf([{ txCbor: body.params.transaction.cbor }]).inputs.filter((o) => own.includes(o)).sort();
      if (!first) return AGREES;
      named.push(first);
      return unknownTo(first);
    };
    await expect(t.lovejoin.publicAgainBuild("preprod", ADA)).rejects.toThrow(tr("lj.poolDrifted"));
    // Three tries, each from a fresh read, the account's boxes drawn again: none left out as gone.
    expect(named).toHaveLength(3);
  });

  it("from the private balance, is tried again later, and its mix never given up", async () => {
    const t = await publicFunded();
    const box = `${"e1".repeat(32)}#0`;
    // A box of the wallet's in the 5 ₳ pool, a mix there having made it hours ago.
    madeByAdaMix(t.koios, "e1".repeat(32));
    t.koios.addedToAccounts.push(adaBox("e1", await ownDatum(t.wallet), t.clock.now));
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    t.koios.tip = 110_000_000;
    // giveme.my's witness and the one-time key's signature, stood in for.
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    const wasm = loadTestWasm();
    const signing = {
      ...wasm,
      signScriptSpend: (_key: unknown, request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm;
    const sessions = sessionsOf({ ...t, deps: { ...t.deps, wasm: signing } });
    const out = await sessions.againBuild("preprod", false, ADA);
    const { index } = await sessions.mixOutSubmit("preprod", out.txHash);
    // Its funding on chain, at the session's account.
    t.koios.confirmations = 1;
    const funding = t.koios.submitted.find((b) => txIdOf(b) === out.txHash)!;
    t.koios.addedToAccounts.push(
      ...builtOutputs(funding).flatMap((o, i) => (o.address.slice(2, 58) === sessionSwap.keyHash ? [atSession(out.txHash, i, o.lovelace.toString())] : [])),
    );
    let named = 0;
    t.koios.evaluation = (body: { params: { transaction: { cbor: string } } }) => {
      if (!reservationOf([{ txCbor: body.params.transaction.cbor }]).inputs.includes(box)) return AGREES;
      named++;
      return unknownTo(box);
    };
    await sessions.advance("preprod", index, true);
    type Book = { sessions: Array<{ index: number; mix?: { skipped?: string }; auto?: { retry?: { error?: string } }; txs: Array<{ kind: string }> }> };
    const record = (await t.store.get<Book>("sessions.preprod"))!.sessions.find((r) => r.index === index)!;
    expect(record.mix?.skipped).toBeUndefined();
    expect(record.auto?.retry?.error).toBe(tr("lj.poolDrifted"));
    expect(record.txs.map((x) => x.kind)).toEqual(["out"]);
    expect(named).toBe(3);
  });
});
