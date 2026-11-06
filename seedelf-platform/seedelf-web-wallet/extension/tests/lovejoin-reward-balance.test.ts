// Chunk 43: what sits in a Lovejoin pool's `mix_logic` reward account (a retired stake pool's deposit, say) is taken
// whole by the wallet's first transaction there, into the user's own output ("default to lucky winner such that
// everything just continues on as normal", the owner, 2026-11-06). The worker reads it with one account_info a pool
// where it builds, leaves out what its own transactions on their way take, reads it again at Send, and tells the
// network's refusal by its type. The real WebAssembly, v2's 5 ₳ pool, and fakes of Koios and giveme.my.
import { describe, expect, it } from "vitest";

import { txWithdrawals } from "../src/background/cbor";
import { Collateral, StaleReviewError } from "../src/background/collateral";
import type { KoiosAccountInfo } from "../src/background/koios";
import {
  LovejoinService,
  REWARDS_MOVED,
  REWARDS_MOVED_REVIEW,
  SESSION_LOVEJOIN_PUBLIC,
  SESSION_LOVEJOIN_SENDING,
  type LovejoinPool,
} from "../src/background/lovejoin";
import { balanceAfter, moved, readBalance, readsFor, rewardsField, takingFrom, type RewardRead } from "../src/background/lovejoin-rewards";
import { SESSION_SENT_PREFIX } from "../src/background/sent-txs";
import { reservationOf } from "../src/background/spent";
import { SESSION_UNLOCKED_AT } from "../src/background/wallet";
import { CHAINS, publicFunded, type Tested } from "./chain-fixtures";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, testBalances, vectors } from "./fakes";
import { ADA, ADA_BOX, ADA_POOL, ADA_ROWS, ADA_VIEW, adaBox, madeByAdaMix, ownDatum } from "./v2-pools";

const PASSWORD = "correct horse battery";
const HOUR = 3_600_000;
const PHRASE = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase;

/** The 5 ₳ pool's `mix_logic` and its reward account, as WebAssembly names them. */
const MIX_LOGIC = JSON.parse(loadTestWasm().lovejoinMixLogic(JSON.stringify({ network: "preprod", poolRef: ADA_POOL }))) as {
  hash: string;
  stake: string;
};
/** That account's bytes, as a withdrawal names it. */
const ACCOUNT = `f0${MIX_LOGIC.hash}`;
/** A retired stake pool's deposit, refunded there. */
const WINDFALL = 500_000_000n;

/** The pool as the worker reads it. */
const POOL: LovejoinPool = { id: ADA, mixBox: ADA_VIEW.mixBoxHash, lovelace: ADA_BOX, ref: ADA_POOL, version: "v2" };

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

const hexBytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
/** What `txCbor` withdraws from the 5 ₳ pool's account: none when it names it not at all. */
const takenBy = (txCbor: string) => txWithdrawals(hexBytes(txCbor)).find((w) => w.account === ACCOUNT)?.lovelace;
/** How many times account_info was asked of the pool's account. */
const reads = (t: Tested) => t.koios.calls.filter((c) => c.path === "account_info" && c.body?._stake_addresses?.includes(MIX_LOGIC.stake)).length;

describe("the reward balance's rules", () => {
  it("reads a balance that's no whole number, or past all the ADA there is, as none", () => {
    expect(readBalance("500000000")).toBe(500_000_000n);
    for (const lie of ["-1", "1.5", "", "0x10", "45000000000000001", "1".repeat(21), undefined, 7]) expect(readBalance(lie)).toBe(0n);
  });

  it("takes none while the wallet's own transaction on its way takes it, what's read otherwise", () => {
    expect(balanceAfter(WINDFALL, 0n)).toBe(WINDFALL);
    expect(balanceAfter(WINDFALL, WINDFALL)).toBe(0n);
    // Read after that one landed: what's there now is new.
    expect(balanceAfter(3_000_000n, WINDFALL)).toBe(3_000_000n);
    expect(balanceAfter(0n, WINDFALL)).toBe(0n);
  });

  it("names a request's balances only where there's one, and calls an unread one no move", () => {
    const read = (lovelace: string, unread?: true): RewardRead => ({ pool: ADA, hash: MIX_LOGIC.hash, stake: MIX_LOGIC.stake, account: ACCOUNT, lovelace, ...(unread ? { unread } : {}) });
    expect(rewardsField([read("0")])).toEqual({});
    expect(rewardsField([read("500000000")])).toEqual({ rewards: { [MIX_LOGIC.hash]: "500000000" } });
    expect(moved([read("500000000")], [read("500000000")])).toBe(false);
    expect(moved([read("500000000")], [read("0")])).toBe(true);
    expect(moved([read("0")], [read("3000000")])).toBe(true);
    expect(moved([read("500000000")], [read("0", true)])).toBe(false);
  });
});

describe("a mix from the public account and the pool's reward balance", CHAINS, () => {
  it("takes it in its first mix alone, reads it once, and the change that stays in the account carries it", async () => {
    const t = await publicFunded();
    const plain = await t.lovejoin.publicBuild("preprod", 1, { pool: ADA });
    t.koios.calls.length = 0;
    holding(t, WINDFALL);
    const summary = await t.lovejoin.publicBuild("preprod", 1, { pool: ADA });
    const kept = (await t.wallet.withKeys(() => t.session.get<{ chain: Array<{ kind: string; txCbor: string }>; balances?: RewardRead[] }>(SESSION_LOVEJOIN_PUBLIC)))!;
    const mixes = kept.chain.filter((c) => c.kind === "mix");
    expect(takenBy(mixes[0]!.txCbor)).toBe(WINDFALL);
    for (const later of mixes.slice(1)) expect(takenBy(later.txCbor)).toBe(0n);
    expect(takenBy(kept.chain[0]!.txCbor)).toBeUndefined();
    expect(reads(t)).toBe(1);
    // What stays in the account is the windfall more, give or take a few bytes' fees.
    const more = BigInt(summary.change) - BigInt(plain.change);
    expect(more > WINDFALL - 20_000n && more < WINDFALL + 20_000n).toBe(true);
    // Kept for Send with what it takes, which Send reads again.
    expect(kept.balances).toEqual([expect.objectContaining({ account: ACCOUNT, stake: MIX_LOGIC.stake, lovelace: WINDFALL.toString() })]);
  });

  it("is a review to make again when the balance moved before Send, with nothing sent", async () => {
    const t = await publicFunded();
    holding(t, WINDFALL);
    const summary = await t.lovejoin.publicBuild("preprod", 1, { pool: ADA });
    // Another wallet's Lovejoin transaction took it meanwhile.
    holding(t, 0n);
    const sent = t.koios.submitted.length;
    const refused = t.lovejoin.publicSubmit("preprod", summary.txHash);
    await expect(refused).rejects.toBeInstanceOf(StaleReviewError);
    await expect(refused).rejects.toThrow(REWARDS_MOVED_REVIEW());
    expect(t.koios.submitted.length).toBe(sent);
    // An epoch paid it in instead, from none: the same.
    holding(t, 0n);
    const none = await t.lovejoin.publicBuild("preprod", 1, { pool: ADA });
    holding(t, 3_000_000n);
    await expect(t.lovejoin.publicSubmit("preprod", none.txHash)).rejects.toBeInstanceOf(StaleReviewError);
    expect(t.koios.submitted.length).toBe(sent);
  });

  it("counts what its chain being sent takes as taken: a build meanwhile in the pool takes none", async () => {
    const t = await publicFunded();
    holding(t, WINDFALL);
    const summary = await t.lovejoin.publicBuild("preprod", 1, { pool: ADA });
    expect((await t.lovejoin.rewardsIn("preprod", [POOL]))[0]!.lovelace).toBe(WINDFALL.toString());
    await t.lovejoin.publicSubmit("preprod", summary.txHash);
    // Being sent, its first mix in the mempool or not yet sent: Koios still counts the balance, and the wallet doesn't.
    expect((await t.lovejoin.rewardsIn("preprod", [POOL]))[0]!.lovelace).toBe("0");
    // Once a reading counts less than it took, that one landed, and what's read is new.
    holding(t, 2_000_000n);
    expect((await t.lovejoin.rewardsIn("preprod", [POOL]))[0]!.lovelace).toBe("2000000");
  });
});

describe("a chain refused while it's sent", CHAINS, () => {
  it("stops in Lovejoin's words, never staking's", async () => {
    const t = await publicFunded();
    holding(t, WINDFALL);
    const summary = await t.lovejoin.publicBuild("preprod", 1, { pool: ADA });
    // Its deposit goes; its first mix, which takes the balance, meets another wallet's that took it first.
    const real = t.koios.fetch;
    let submits = 0;
    t.koios.fetch = async (url, init) => {
      if (url.endsWith("/submittx") && ++submits === 2) return new Response(NOT_IN_REWARDS, { status: 400 });
      return real(url, init);
    };
    await t.lovejoin.publicSubmit("preprod", summary.txHash).catch(() => undefined);
    const sending = await t.wallet.withKeys(() => t.session.get<{ stopped?: string }>(`${SESSION_LOVEJOIN_SENDING}preprod`));
    expect(sending?.stopped).toBe(REWARDS_MOVED());
    expect(sending?.stopped).not.toMatch(/staking/i);
  });
});

describe("a chain's reservation and what it takes", CHAINS, () => {
  it("keeps what each chain takes of a pool's balance, by the account, as the reads leave it out", async () => {
    const t = await publicFunded();
    holding(t, WINDFALL);
    await t.lovejoin.publicBuild("preprod", 1, { pool: ADA });
    const kept = (await t.wallet.withKeys(() => t.session.get<{ chain: Array<{ txCbor: string }> }>(SESSION_LOVEJOIN_PUBLIC)))!;
    const reservation = reservationOf(kept.chain);
    expect(reservation.takes).toEqual({ [ACCOUNT]: WINDFALL.toString() });
    expect(takingFrom([], new Set(), [reservation], ACCOUNT)).toBe(WINDFALL);
    expect(takingFrom([], new Set(), [reservationOf(kept.chain.slice(0, 1))], ACCOUNT)).toBe(0n);
    // A chain's reads, kept only for the accounts it withdraws from.
    const other = { pool: "ff".repeat(28), hash: "ee".repeat(28), stake: "stake_test1other", account: `f0${"ee".repeat(28)}`, lovelace: "7" };
    const mine = { pool: ADA, hash: MIX_LOGIC.hash, stake: MIX_LOGIC.stake, account: ACCOUNT, lovelace: WINDFALL.toString() };
    expect(readsFor([mine, other], kept.chain)).toEqual([mine]);
  });
});

type T = ReturnType<typeof testBalances>;

/**
 * An unlocked wallet, unlocked an hour ago with its unlock's draws made, a box of its own in v2's 5 ₳ pool, due; and
 * Lovejoin with giveme.my's witness stood in for, so a withdraw that goes is submitted (lovejoin-withdraw-submit.test.ts).
 */
async function due() {
  const t = testBalances({ pools: [ADA_POOL] });
  await t.wallet.create(PHRASE, PASSWORD);
  madeByAdaMix(t.koios, "e1".repeat(32));
  const owned = adaBox("e1", await ownDatum(t.wallet), t.clock.now);
  t.koios.addedToAccounts.push(...ADA_ROWS, owned);
  const unlocked = t.clock.now - HOUR;
  await t.wallet.withKeys(() => t.session.set(SESSION_UNLOCKED_AT, unlocked));
  await t.store.set("lovejoin.preprod", { due: [], pools: { [ADA]: { due: [t.clock.now - HOUR] } }, unlock: unlocked });
  const wasm = loadTestWasm();
  t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
  const lovejoin = new LovejoinService({
    ...t.deps,
    wasm: {
      ...wasm,
      finishLovejoinWithdraw: (request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(Uint8Array.from(Buffer.from(txCbor, "hex"))) });
      },
    } as typeof wasm,
    collateral: () => new Collateral("https://www.giveme.my/preprod/collateral/", t.collateral.fetch),
    store: t.store,
    pools: async () => [ADA_POOL],
  });
  return { t, lovejoin };
}

/** The node's refusal of a withdrawal that doesn't take the whole balance, as Koios hands it on. */
const NOT_IN_REWARDS = "ConwayCertsFailure (WithdrawalsNotInRewardsCERTS (Withdrawals {unWithdrawals = fromList []}))";

/** Koios refuses the next `count` submits as `NOT_IN_REWARDS`, running `then` after each, and takes the rest. */
function refusing(t: T, count: number, then: () => void = () => undefined) {
  const real = t.koios.fetch;
  let left = count;
  t.koios.fetch = async (url, init) => {
    if (!url.endsWith("/submittx") || left === 0) return real(url, init);
    left--;
    t.koios.submitted.push(Uint8Array.from(init!.body as Uint8Array));
    then();
    return new Response(NOT_IN_REWARDS, { status: 400 });
  };
}

describe("a box's way back and the pool's reward balance", { timeout: 60_000 }, () => {
  it("brings it back in the box's register", async () => {
    const { t, lovejoin } = await due();
    holding(t, WINDFALL);
    await lovejoin.withdrawDue("preprod", false, t.clock.now);
    const sent = t.koios.submitted.at(-1)!;
    expect(txWithdrawals(sent)).toEqual([{ account: ACCOUNT, lovelace: WINDFALL }]);
    expect(reads(t)).toBe(1);
  });

  it("is built again once, at once, when the network says the balance moved, and sent", async () => {
    const { t, lovejoin } = await due();
    holding(t, WINDFALL);
    // Someone else took it just before ours went.
    refusing(t, 1, () => holding(t, 0n));
    await lovejoin.withdrawDue("preprod", false, t.clock.now);
    expect(t.koios.submitted).toHaveLength(2);
    expect(txWithdrawals(t.koios.submitted[0]!)).toEqual([{ account: ACCOUNT, lovelace: WINDFALL }]);
    expect(txWithdrawals(t.koios.submitted[1]!)).toEqual([{ account: ACCOUNT, lovelace: 0n }]);
    expect(t.collateral.asked).toHaveLength(2);
    // It went: its due time is used, and the refused one is no transaction on its way.
    const s = (await t.store.get<{ pools?: Record<string, { due: number[] }> }>("lovejoin.preprod"))!;
    expect(s.pools?.[ADA]?.due ?? []).toHaveLength(0);
    const sent = await t.wallet.withKeys(() => t.session.get<Array<{ txHash: string }>>(`${SESSION_SENT_PREFIX}preprod`));
    expect(sent?.map((x) => x.txHash)).toEqual([txIdOf(t.koios.submitted[1]!)]);
  });

  it("refused again, sends nothing more and gives its due time back for a later run", async () => {
    const { t, lovejoin } = await due();
    holding(t, WINDFALL);
    refusing(t, 2);
    await lovejoin.withdrawDue("preprod", false, t.clock.now).catch(() => undefined);
    expect(t.koios.submitted).toHaveLength(2);
    const s = (await t.store.get<{ pools?: Record<string, { due: number[] }>; withdrawing?: unknown }>("lovejoin.preprod"))!;
    expect(s.withdrawing).toBeUndefined();
    expect(s.pools?.[ADA]?.due).toHaveLength(1);
  });
});
