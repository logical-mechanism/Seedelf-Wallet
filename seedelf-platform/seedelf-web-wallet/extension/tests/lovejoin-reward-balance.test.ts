// Chunk 43: what sits in a Lovejoin pool's `mix_logic` reward account (a retired stake pool's deposit, say) is taken
// whole by the wallet's first transaction there, into the user's own output ("default to lucky winner such that
// everything just continues on as normal", the owner, 2026-11-06). The worker reads it with one account_info a pool
// where it builds, leaves out what its own transactions on their way take, reads it again at Send, and tells the
// network's refusal by its type. The real WebAssembly, v2's 5 ₳ pool, and fakes of Koios and giveme.my.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { txWithdrawals } from "../src/background/cbor";
import { Collateral, StaleReviewError } from "../src/background/collateral";
import type { KoiosAccountInfo, KoiosUtxo } from "../src/background/koios";
import {
  LovejoinService,
  REWARDS_MOVED,
  REWARDS_MOVED_REVIEW,
  SESSION_LOVEJOIN_PUBLIC,
  SESSION_LOVEJOIN_SENDING,
  type LovejoinPool,
  type PoolRef,
} from "../src/background/lovejoin";
import { balanceAfter, moved, readBalance, readsFor, rewardsField, takingFrom, type RewardRead } from "../src/background/lovejoin-rewards";
import { builtOutputs } from "../src/background/minswap";
import { rememberSent, SESSION_SENT_PREFIX } from "../src/background/sent-txs";
import { SESSION_BACK } from "../src/background/sessions";
import { rememberSpent, reservationOf, SESSION_RESERVED_PREFIX, type Reservation } from "../src/background/spent";
import { SESSION_UNLOCKED_AT } from "../src/background/wallet";
import bundled from "../src/lovejoin-pools.json";
import { AGREES, CHAINS, atSession, lovejoinOf, publicFunded, sessionsOf, withSession, type Tested } from "./chain-fixtures";
import { bech32, bech32Bytes } from "./fixtures/bech32";
import { txIdOf } from "./fixtures/cbor";
import { loadTestWasm, ownedUtxos, sessionSwap, testBalances, vectors } from "./fakes";
import { ADA, ADA_BOX, ADA_POOL, ADA_ROWS, ADA_VIEW, adaBox, madeByAdaMix, ownDatum, strangerDatum } from "./v2-pools";

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
  it.each(NOT_IN_REWARDS)("stops in Lovejoin's words, never staking's, at %s", async (_, refusal) => {
    const t = await publicFunded();
    holding(t, WINDFALL);
    const summary = await t.lovejoin.publicBuild("preprod", 1, { pool: ADA });
    // Its deposit goes; its first mix, which takes the balance, meets another wallet's that took it first.
    const real = t.koios.fetch;
    let submits = 0;
    t.koios.fetch = async (url, init) => {
      if (url.endsWith("/submittx") && ++submits === 2) return new Response(refusal, { status: 400 });
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

// 1.8.1's release review: the balance followed through each flow that builds in a pool, its read, its request, what's
// kept for Send and the read again there (readers#1, worker#4, worker#5, mutants#5 to #8). What the network refuses,
// and in whose words, is tested apart.

/** `lovelace` in reward account `stake`, as account_info lists it: any pool's `mix_logic`, as holding has the 5 ₳ pool's. */
function holds(t: Tested, stake: string, lovelace: bigint): void {
  t.koios.stakes.set(stake, {
    stake_address: stake,
    status: "registered",
    delegated_pool: null,
    delegated_drep: null,
    rewards_available: lovelace.toString(),
    deposit: "2000000",
  });
}

/**
 * A transaction spending `11…#0` that withdraws `lovelace` (under 2^32) from `account` (its bytes, hex), its fee `fee`
 * (under 24): what a mix or a withdraw of the wallet's names, by hand.
 */
const taking = (lovelace: number | bigint, fee = 0, account = ACCOUNT) =>
  `84a40081825820${"11".repeat(32)}00018002${fee.toString(16).padStart(2, "0")}05a1581d${account}1a${lovelace.toString(16).padStart(8, "0")}a0f5f6`;

/** The mix from the public account kept for Send. */
const keptPublic = async (t: Tested) =>
  (await t.wallet.withKeys(() => t.session.get<{ chain: Array<{ kind: string; txCbor: string }>; balances?: RewardRead[] }>(SESSION_LOVEJOIN_PUBLIC)))!;

/** A session's return kept for Send: its chain, and what that withdraws from each pool's reward account. */
const keptBack = async (t: Tested) =>
  (await t.wallet.withKeys(() =>
    t.session.get<{ chain?: Array<{ kind: string; txCbor: string; txHash: string; tail?: true }>; balances?: RewardRead[] }>(SESSION_BACK),
  ))!;

/** What each of `txs` withdraws from `account`, in order: none for one that names it not at all. */
const takesFrom = (txs: ReadonlyArray<{ txCbor: string }>, account = ACCOUNT) =>
  txs.flatMap(({ txCbor }) => txWithdrawals(hexBytes(txCbor)).filter((w) => w.account === account).map((w) => w.lovelace));

/** Mainnet's v2 5 ₳ pool, as the head start has it (1.8.1's prep), as the worker reads it. */
const MAINNET_REF = (bundled.mainnet.pools.find((p) => "version" in p && p.version === "v2") as unknown as { ref: PoolRef }).ref;
const MAINNET_VIEW = JSON.parse(loadTestWasm().lovejoinVerifyPool(JSON.stringify({ network: "mainnet", pool: MAINNET_REF }))) as {
  id: string;
  mixBoxHash: string;
};
const MAINNET_POOL: LovejoinPool = { id: MAINNET_VIEW.id, mixBox: MAINNET_VIEW.mixBoxHash, lovelace: ADA_BOX, ref: MAINNET_REF, version: "v2" };

describe("what the wallet's own transactions on their way take, each rule held (1.8.1's release review, mutants#5)", () => {
  const COIN = `${"11".repeat(32)}#0`;
  const sent = (txCbor: string, n: number) => ({ txHash: n.toString(16).padStart(64, "0"), txCbor, sentAt: 0 });

  it("counts one it sent while what that spends is held as spent, and not once it isn't", () => {
    expect(takingFrom([sent(taking(WINDFALL), 1)], new Set([COIN]), [], ACCOUNT)).toBe(WINDFALL);
    expect(takingFrom([sent(taking(WINDFALL), 1)], new Set(), [], ACCOUNT)).toBe(0n);
  });

  it("counts either of two it sent that spend one coin, though only one of them can land", () => {
    expect(takingFrom([sent(taking(WINDFALL, 1), 1), sent(taking(0, 2), 2)], new Set([COIN]), [], ACCOUNT)).toBe(WINDFALL);
  });

  it("counts the most any chain being sent takes, whichever is kept last", () => {
    const chain = { inputs: [], collateral: [], takes: { [ACCOUNT]: WINDFALL.toString() } };
    expect(takingFrom([], new Set(), [chain, { inputs: [], collateral: [] }], ACCOUNT)).toBe(WINDFALL);
  });

  it("reads none while a take on its way is no more than the reading, however much more that counts", () => {
    // Today's rule: the 3 ₳ past the take may be new, or the reading not yet the take's. Which figure a build takes is
    // the owner's call; either, wrong, is refused at no cost.
    expect(balanceAfter(503_000_000n, WINDFALL)).toBe(0n);
  });

  it("calls a chain's balances moved when any one of its accounts moved", () => {
    const read = (account: string, lovelace: string): RewardRead => ({ pool: account, hash: account.slice(2), stake: account, account, lovelace });
    const other = `f0${"cd".repeat(28)}`;
    expect(moved([read(ACCOUNT, "500000000"), read(other, "0")], [read(ACCOUNT, "500000000"), read(other, "3000000")])).toBe(true);
  });
});

describe("what a mix from the public account takes, on its review (1.8.1's release review, readers#1)", CHAINS, () => {
  it("is named on its summary, which its review's after counts, and not at all when it takes nothing", async () => {
    const t = await publicFunded();
    const plain = await t.lovejoin.publicBuild("preprod", 1, { pool: ADA });
    expect(plain).not.toHaveProperty("taken");
    holding(t, WINDFALL);
    const summary = await t.lovejoin.publicBuild("preprod", 1, { pool: ADA });
    // Its change carries it into the account, where Home's figure doesn't count it yet.
    expect(summary.taken).toBe(WINDFALL.toString());
  });
});

describe("how a build reads its pool's reward balance (1.8.1's release review, mutants#8, worker#5)", CHAINS, () => {
  /** account_info doesn't answer for the 5 ₳ pool's account: its Koios backend down, say. */
  function unanswered(t: Tested): void {
    const real = t.koios.fetch;
    t.koios.fetch = async (url, init) =>
      url.endsWith("/account_info") && String(init?.body).includes(MIX_LOGIC.stake) ? new Response("upstream down", { status: 503 }) : real(url, init);
  }

  it("builds as before when account_info doesn't answer: on none, its read kept as unread", async () => {
    const t = await publicFunded();
    unanswered(t);
    await t.lovejoin.publicBuild("preprod", 1, { pool: ADA });
    const kept = await keptPublic(t);
    expect(takesFrom(kept.chain.filter((c) => c.kind === "mix")).every((n) => n === 0n)).toBe(true);
    expect(kept.balances).toEqual([expect.objectContaining({ account: ACCOUNT, lovelace: "0", unread: true })]);
  });

  it("sends a review whose read again at Send isn't answered: that says nothing moved, and the network checks it", async () => {
    const t = await publicFunded();
    holding(t, WINDFALL);
    const summary = await t.lovejoin.publicBuild("preprod", 1, { pool: ADA });
    unanswered(t);
    const sent = t.koios.submitted.length;
    await t.lovejoin.publicSubmit("preprod", summary.txHash);
    expect(t.koios.submitted.length).toBeGreaterThan(sent);
  });

  it("reads a session's pool once a build: its try four a mix and its try three, and its collateral's mix there, included", async () => {
    const { t } = await withSession("20000000");
    await t.deps.preferences.set({ lovejoinWidth: 4, lovejoinDepth: 1 });
    // Four boxes a mix doesn't build: its chain is tried again three a mix (D3's fallback).
    const wasm = loadTestWasm();
    let four = 0;
    const lj = lovejoinOf(t, {
      wasm: {
        ...wasm,
        buildLovejoinChain: (...args: Parameters<typeof wasm.buildLovejoinChain>) => {
          if ((JSON.parse(args[2]) as { width?: number }).width === 4) {
            four++;
            throw new Error("Mixing 4 boxes at once needs more computation than a transaction may use");
          }
          return wasm.buildLovejoinChain(...args);
        },
      } as typeof wasm,
    });
    holding(t, WINDFALL);
    t.koios.calls.length = 0;
    await sessionsOf(t, undefined, lj).backBuild("preprod", 0);
    expect(four).toBe(1);
    const { chain } = await keptBack(t);
    // Its collateral's mix goes into the same 5 ₳ pool: read once with the chain's, taking what the chain left.
    expect(chain!.filter((c) => c.kind === "mix").at(-1)!.tail).toBe(true);
    expect(reads(t)).toBe(1);
    expect(takesFrom(chain!)[0]).toBe(WINDFALL);
  });

  it("reads none for a Bootstrap from the public account: its deposit alone runs no script", async () => {
    const t = await publicFunded();
    holding(t, WINDFALL);
    t.koios.calls.length = 0;
    await t.lovejoin.publicBuild("preprod", 1, { pool: ADA, bootstrap: true });
    expect(reads(t)).toBe(0);
  });

  it("reads none for a Bootstrap from the private balance either, its chain a deposit alone (worker#5)", async () => {
    const t = testBalances({ pools: [ADA_POOL] });
    await t.wallet.create(PHRASE, PASSWORD);
    t.koios.evaluation = AGREES;
    // A slot in preprod's Shelley era, for what the account signs (lovejoin-flows.test.ts).
    t.koios.tip = 110_000_000;
    t.koios.addedToAccounts.push(...ADA_ROWS);
    // giveme.my's witness and the one-time key's signature on the funding, stood in for.
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    const wasm = loadTestWasm();
    const signing = {
      ...wasm,
      signScriptSpend: (_key: unknown, request: string) => {
        const { txCbor } = JSON.parse(request) as { txCbor: string };
        return JSON.stringify({ txCbor, txHash: txIdOf(hexBytes(txCbor)) });
      },
    } as typeof wasm;
    const sessions = sessionsOf({ ...t, deps: { ...t.deps, wasm: signing } });
    holding(t, WINDFALL);
    const out = await sessions.mixOutBuild("preprod", 1, { bootstrap: true, pool: ADA });
    const { index } = await sessions.mixOutSubmit("preprod", out.txHash);
    // Its funding lands at the session's account.
    t.koios.confirmations = 1;
    const funding = t.koios.submitted.find((b) => txIdOf(b) === out.txHash)!;
    t.koios.addedToAccounts.push(
      ...builtOutputs(funding).flatMap((o, i) => (o.address.slice(2, 58) === sessionSwap.keyHash ? [atSession(out.txHash, i, o.lovelace.toString())] : [])),
    );
    t.koios.calls.length = 0;
    await sessions.advance("preprod", index, true);
    const book = (await t.store.get<{ sessions: Array<{ index: number; txs: Array<{ kind: string }> }> }>("sessions.preprod"))!;
    expect(book.sessions.find((s) => s.index === index)!.txs.map((x) => x.kind)).toContain("deposit");
    expect(reads(t)).toBe(0);
  });

  it("names each network's account by its bech32's bytes, mainnet's header f1, so what's on its way there counts", async () => {
    const t = await publicFunded();
    for (const [network, pool] of [["preprod", POOL], ["mainnet", MAINNET_POOL]] as const) {
      const { stake } = JSON.parse(loadTestWasm().lovejoinMixLogic(JSON.stringify({ network, poolRef: pool.ref }))) as { stake: string };
      const account = Buffer.from(bech32Bytes(stake)).toString("hex");
      expect(account.slice(0, 2)).toBe(network === "mainnet" ? "f1" : "f0");
      holds(t, stake, WINDFALL);
      const [read] = await t.lovejoin.rewardsIn(network, [pool]);
      expect(read).toMatchObject({ stake, account, lovelace: WINDFALL.toString() });
      // A transaction of the wallet's own there takes it all, what it spends held as spent: none for a build.
      await t.wallet.withKeys(() => rememberSpent(t.session, network, hexBytes(taking(WINDFALL, 0, account)), t.clock.now));
      expect((await t.lovejoin.rewardsIn(network, [pool]))[0]!.lovelace).toBe("0");
    }
  });

  it("holds what a mix it stopped at takes, as what that mix spends, while it may have gone through", async () => {
    const t = await publicFunded();
    holding(t, WINDFALL);
    const summary = await t.lovejoin.publicBuild("preprod", 1, { pool: ADA });
    const mix = (await keptPublic(t)).chain[1]!;
    expect(takesFrom([mix])).toEqual([WINDFALL]);
    // Its deposit goes; its first mix reaches the node, and Koios's answer is lost.
    const real = t.koios.fetch;
    let submits = 0;
    t.koios.fetch = async (url, init) => {
      if (!url.endsWith("/submittx") || ++submits < 2) return real(url, init);
      if (submits === 2) await real(url, init);
      throw new TypeError("Failed to fetch");
    };
    await expect(t.lovejoin.publicSubmit("preprod", summary.txHash)).rejects.toThrow("may have gone through");
    t.koios.fetch = real;
    const held = await t.wallet.withKeys(() => t.session.get<Record<string, Reservation>>(SESSION_RESERVED_PREFIX + "preprod"));
    expect(held?.public).toEqual({ inputs: reservationOf([mix]).inputs, collateral: [], takes: { [ACCOUNT]: WINDFALL.toString() } });
    // Sixteen sends of the wallet's chains since push that mix out of the sends it keeps (sent-txs.ts KEEP): what's
    // held still counts it, as Koios does.
    for (let fee = 0; fee < 16; fee++) {
      const other = `84a30081825820${"22".repeat(32)}00018002${fee.toString(16).padStart(2, "0")}a0f5f6`;
      await t.wallet.withKeys(() => rememberSent(t.session, "preprod", hexBytes(other), t.clock.now));
    }
    expect((await t.lovejoin.rewardsIn("preprod", [POOL]))[0]!.lovelace).toBe("0");
  });
});

describe("a session's return and its pool's reward balance (1.8.1's release review, worker#4, mutants#6)", CHAINS, () => {
  /** A site's session holding `lovelace` and its 5 ₳ collateral, mixed one wave deep. */
  async function session(lovelace = "20000000") {
    const set = await withSession(lovelace);
    await set.t.deps.preferences.set({ lovejoinDepth: 1 });
    return set;
  }

  it("takes it in its chain's first mix there alone, read once, and keeps it for Send", async () => {
    const { t, sessions } = await session();
    holding(t, WINDFALL);
    t.koios.calls.length = 0;
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin).toBeDefined();
    const { chain, balances } = await keptBack(t);
    expect(takesFrom(chain!)).toEqual([WINDFALL, ...Array(chain!.filter((c) => c.kind === "mix").length - 1).fill(0n)]);
    expect(reads(t)).toBe(1);
    expect(balances).toEqual([expect.objectContaining({ account: ACCOUNT, stake: MIX_LOGIC.stake, lovelace: WINDFALL.toString() })]);
  });

  it("is a review to make again when the balance moved before Send, with nothing sent", async () => {
    const { t, sessions } = await session();
    holding(t, WINDFALL);
    const review = await sessions.backBuild("preprod", 0);
    // Another wallet's Lovejoin transaction took it meanwhile.
    holding(t, 0n);
    const sent = t.koios.submitted.length;
    const refused = sessions.backSubmit("preprod", review.txHash);
    await expect(refused).rejects.toBeInstanceOf(StaleReviewError);
    await expect(refused).rejects.toThrow(REWARDS_MOVED_REVIEW());
    expect(t.koios.submitted.length).toBe(sent);
  });

  it("is left out of Bring everything back's Send when an epoch paid some in since, with nothing sent", async () => {
    const { t, sessions } = await session();
    holding(t, 0n);
    const claim = await sessions.claimBuild("preprod", [0]);
    holding(t, 3_000_000n);
    const sent = t.koios.submitted.length;
    expect(await sessions.claimSubmit("preprod", [claim.returns[0]!.txHash])).toEqual({
      sent: [],
      failed: [{ index: 0, error: REWARDS_MOVED_REVIEW() }],
    });
    expect(t.koios.submitted.length).toBe(sent);
  });

  it("comes back directly with its collateral's mix taking it, where its spare ADA pays for no box, kept for Send", async () => {
    const { t, sessions } = await session("4000000");
    holding(t, WINDFALL);
    t.koios.calls.length = 0;
    const review = await sessions.backBuild("preprod", 0);
    expect(review.lovejoin).toBeUndefined();
    const { chain, balances } = await keptBack(t);
    expect(chain!.map((c) => c.kind)).toEqual(["deposit", "mix", "back"]);
    expect(takesFrom(chain!)).toEqual([WINDFALL]);
    expect(reads(t)).toBe(1);
    expect(balances).toEqual([expect.objectContaining({ account: ACCOUNT, lovelace: WINDFALL.toString() })]);
    holding(t, 0n);
    await expect(sessions.backSubmit("preprod", review.txHash)).rejects.toThrow(REWARDS_MOVED_REVIEW());
  });

  it("builds its collateral's mix again on it, a lock having cut the chain short of that mix, and keeps it for Send", async () => {
    const { t, sessions } = await session("10000000");
    const review = await sessions.backBuild("preprod", 0);
    const { chain } = await keptBack(t);
    const deposit = chain!.at(-3)!;
    await sessions.backSubmit("preprod", review.txHash);
    // Its deposit, its mix and its collateral's deposit went; that mix waits for them to land, and the wallet locks.
    await t.wallet.lock();
    await t.wallet.unlock(PASSWORD);
    // Landed: its collateral's box in the 5 ₳ pool, that deposit's change at the session's account.
    t.koios.confirmations = 1;
    for (const tx of chain!.slice(0, -2)) for (const o of reservationOf([tx]).inputs) t.koios.spent.add(o);
    type Out = { index: number; address: string; value: { ada: { lovelace: number } }; datum?: string };
    const outs = JSON.parse(loadTestWasm().ogmiosUtxos(deposit.txCbor)) as Out[];
    const box = outs.find((o) => o.index === review.collateralTail!.box.txIndex)!;
    const change = outs.find((o) => o.address === sessionSwap.address)!;
    t.koios.addedToAccounts.push(
      adaBox(deposit.txHash, box.datum!, t.clock.now, 0, box.index),
      atSession(deposit.txHash, change.index, String(change.value.ada.lovelace)),
    );
    // A pool read finds that box the wallet's, not mixed yet: the chain stopped there.
    await t.lovejoin.status("preprod");
    // An epoch paid the pool's account since.
    holding(t, WINDFALL);
    const again = await sessions.backBuild("preprod", 0);
    const resumed = await keptBack(t);
    expect(resumed.chain!.map((c) => c.kind)).toEqual(["mix", "back"]);
    expect(takesFrom(resumed.chain!)).toEqual([WINDFALL]);
    expect(resumed.balances).toEqual([expect.objectContaining({ account: ACCOUNT, lovelace: WINDFALL.toString() })]);
    // Another wallet's took it before Send: nothing goes.
    holding(t, 0n);
    const sent = t.koios.submitted.length;
    await expect(sessions.backSubmit("preprod", again.txHash)).rejects.toThrow(REWARDS_MOVED_REVIEW());
    expect(t.koios.submitted.length).toBe(sent);
  });

  it("across pools, takes each pool's balance in its own first mix there, and keeps both for Send", async () => {
    // PR #163's token pool on preprod, on v2's scripts (wasm/tests/fixtures): 2 ₳ and LJTEST a box.
    const fixture = new URL("../../wasm/tests/fixtures/lovejoin-v2-token-pool-preprod.json", import.meta.url);
    const found = JSON.parse(readFileSync(fixture, "utf8")) as PoolRef;
    const tokenPool: PoolRef = { reference: found.reference, seed: found.seed, scripts: found.scripts };
    const wasm = loadTestWasm();
    const view = JSON.parse(wasm.lovejoinVerifyPool(JSON.stringify({ network: "preprod", pool: tokenPool }))) as {
      id: string;
      mixBoxHash: string;
      token: { policyId: string; assetName: string; quantity: string };
    };
    const mixLogic = JSON.parse(wasm.lovejoinMixLogic(JSON.stringify({ network: "preprod", poolRef: tokenPool }))) as { hash: string; stake: string };
    const ljtest = (quantity: bigint) => [
      { policy_id: view.token.policyId, asset_name: view.token.assetName, quantity: quantity.toString(), decimals: 0, fingerprint: "asset1ljtest" },
    ];
    const address = bech32("addr_test", Uint8Array.from([0x70, ...Buffer.from(view.mixBoxHash, "hex")]));
    const theirs = Array.from(
      { length: 6 },
      (_, i): KoiosUtxo => ({
        ...adaBox((0x60 + i).toString(16).repeat(32), strangerDatum()),
        address,
        payment_cred: view.mixBoxHash,
        value: "2000000",
        asset_list: ljtest(BigInt(view.token.quantity)) as never,
      }),
    );
    const t = testBalances({ pools: [ADA_POOL, tokenPool] });
    await t.wallet.create(PHRASE, PASSWORD);
    t.koios.evaluation = AGREES;
    await t.deps.preferences.set({ lovejoinDepth: 1 });
    // A site's session 0, as withSession has it.
    const OUT = "ab".repeat(32);
    await t.store.set("sessions.preprod", {
      next: 1,
      sessions: [
        {
          index: 0,
          ownStake: true,
          createdAt: t.clock.now,
          txs: [{ kind: "out", txHash: OUT, at: t.clock.now, confirmed: true }],
          site: { origin: "https://example.org" },
        },
      ],
    });
    // Its own funding left two boxes' worth of LJTEST, 40 ₳ and its collateral.
    t.koios.addedToAccounts.push(
      { ...atSession(OUT, 0, "3000000"), asset_list: ljtest(2n * BigInt(view.token.quantity)) as never },
      atSession(OUT, 1, "40000000"),
      atSession(OUT, 2, "5000000"),
      ...ADA_ROWS,
      ...theirs,
    );
    holds(t, mixLogic.stake, WINDFALL);
    holding(t, 3_000_000n);
    const review = await sessionsOf(t).backBuild("preprod", 0);
    expect(review.lovejoin?.parts?.[0]).toEqual({ pool: view.id, boxes: 2 });
    const { chain, balances } = await keptBack(t);
    const tokenAccount = `f0${mixLogic.hash}`;
    expect(takesFrom(chain!, tokenAccount)).toEqual([WINDFALL, 0n]);
    const ada = takesFrom(chain!);
    expect(ada).toEqual([3_000_000n, ...Array(ada.length - 1).fill(0n)]);
    expect(balances).toHaveLength(2);
    expect(balances).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ account: tokenAccount, lovelace: WINDFALL.toString() }),
        expect.objectContaining({ account: ACCOUNT, lovelace: "3000000" }),
      ]),
    );
    // The token pool's alone moved: it's a review to make again all the same, nothing sent.
    holds(t, mixLogic.stake, 0n);
    const sent = t.koios.submitted.length;
    await expect(sessionsOf(t).backSubmit("preprod", review.txHash)).rejects.toThrow(REWARDS_MOVED_REVIEW());
    expect(t.koios.submitted.length).toBe(sent);
  });
});

describe("Mix my boxes again from the public account and its pool's reward balance (1.8.1's release review, mutants#7)", CHAINS, () => {
  /** The public account's two boxes in the 5 ₳ pool, the mix of its that put them in cut by a lock after its deposit. */
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
    return t;
  }

  it("takes it in its first mix alone, names it on its review, and keeps it for Send", async () => {
    const t = await cutAfterDeposit();
    holding(t, WINDFALL);
    const again = await t.lovejoin.publicAgainBuild("preprod", ADA);
    expect(again).toMatchObject({ again: true, boxes: 2, taken: WINDFALL.toString() });
    const kept = await keptPublic(t);
    expect(takesFrom(kept.chain)).toEqual([WINDFALL, ...Array(kept.chain.length - 1).fill(0n)]);
    expect(kept.balances).toEqual([expect.objectContaining({ account: ACCOUNT, lovelace: WINDFALL.toString() })]);
  });

  it("is a review to make again when the balance moved before Send, with nothing sent", async () => {
    const t = await cutAfterDeposit();
    holding(t, WINDFALL);
    const again = await t.lovejoin.publicAgainBuild("preprod", ADA);
    holding(t, 0n);
    const sent = t.koios.submitted.length;
    const refused = t.lovejoin.publicSubmit("preprod", again.txHash);
    await expect(refused).rejects.toBeInstanceOf(StaleReviewError);
    await expect(refused).rejects.toThrow(REWARDS_MOVED_REVIEW());
    expect(t.koios.submitted.length).toBe(sent);
  });
});

describe("a box brought back paid for, and its pool's reward balance (1.8.1's release review, mutants#7)", { timeout: 60_000 }, () => {
  const BOX = { txHash: "e1".repeat(32), txIndex: 0, pool: ADA };

  /** The wallet's box in the 5 ₳ pool, a mix there having made it hours ago, and a public account with its collateral. */
  async function owned() {
    const t = await publicFunded();
    madeByAdaMix(t.koios, BOX.txHash);
    t.koios.addedToAccounts.push(adaBox("e1", await ownDatum(t.wallet), t.clock.now));
    return t;
  }

  it("paid by the public account, brings it back in the box's register", async () => {
    const t = await owned();
    holding(t, WINDFALL);
    t.koios.calls.length = 0;
    await t.lovejoin.withdrawNow("preprod", BOX, false, true);
    expect(txWithdrawals(t.koios.submitted.at(-1)!)).toEqual([{ account: ACCOUNT, lovelace: WINDFALL }]);
    expect(reads(t)).toBe(1);
  });

  it.each(NOT_IN_REWARDS)("paid by the public account and refused twice at %s, says so in Lovejoin's words", async (_, refusal) => {
    const t = await owned();
    holding(t, WINDFALL);
    refusing(t, refusal, 2);
    await expect(t.lovejoin.withdrawNow("preprod", BOX, false, true)).rejects.toThrow(REWARDS_MOVED());
    expect(t.koios.submitted).toHaveLength(2);
  });

  it.each(NOT_IN_REWARDS)("paid by the public account and refused as the balance moved at %s, is built again once, paid by the account again", async (_, refusal) => {
    const t = await owned();
    holding(t, WINDFALL);
    // Someone else took it just before ours went.
    refusing(t, refusal, 1, () => holding(t, 0n));
    await t.lovejoin.withdrawNow("preprod", BOX, false, true);
    expect(t.koios.submitted).toHaveLength(2);
    const [refused, sent] = t.koios.submitted.map((bytes) => ({
      withdrawals: txWithdrawals(bytes),
      spends: reservationOf([{ txCbor: Buffer.from(bytes).toString("hex") }]).inputs.sort(),
    }));
    expect(refused!.withdrawals).toEqual([{ account: ACCOUNT, lovelace: WINDFALL }]);
    expect(sent!.withdrawals).toEqual([{ account: ACCOUNT, lovelace: 0n }]);
    // The account pays for both, its UTxO beside the box, with its own collateral: giveme.my is never asked.
    expect(sent!.spends.length).toBeGreaterThan(1);
    expect(sent!.spends).toEqual(refused!.spends);
    expect(t.collateral.asked).toEqual([]);
  });

  it("paid from the private balance, brings it back in the box's register", async () => {
    // None of the fixture's own contract UTxOs: the private balance holds the one UTxO given.
    const t = testBalances({ owned: false, pools: [ADA_POOL] });
    await t.wallet.create(PHRASE, PASSWORD);
    t.koios.evaluation = AGREES;
    t.koios.tip = 110_000_000;
    madeByAdaMix(t.koios, BOX.txHash);
    t.koios.addedToAccounts.push(...ADA_ROWS, adaBox("e1", await ownDatum(t.wallet), t.clock.now));
    const datum = await ownDatum(t.wallet);
    t.koios.added.push({ ...ownedUtxos[0]!, tx_hash: "d2".repeat(32), tx_index: 0, value: "3000000", inline_datum: { bytes: datum, value: {} }, asset_list: [] });
    // giveme.my's witness and the one-time key's signature, stood in for.
    t.collateral.answer = { status: 200, body: { witness: "a1008182" } };
    const wasm = loadTestWasm();
    const lovejoin = lovejoinOf(t, {
      wasm: {
        ...wasm,
        signScriptSpend: (_key: unknown, request: string) => {
          const { txCbor } = JSON.parse(request) as { txCbor: string };
          return JSON.stringify({ txCbor, txHash: txIdOf(hexBytes(txCbor)) });
        },
      } as typeof wasm,
    });
    holding(t, WINDFALL);
    await lovejoin.withdrawNow("preprod", BOX, false, "private");
    const sent = t.koios.submitted.at(-1)!;
    expect(reservationOf([{ txCbor: Buffer.from(sent).toString("hex") }]).inputs).toContain(`${"d2".repeat(32)}#0`);
    expect(txWithdrawals(sent)).toEqual([{ account: ACCOUNT, lovelace: WINDFALL }]);
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

/**
 * The node's refusal of a withdrawal that doesn't take the whole balance, as Koios hands it on: CERTS's to protocol
 * version 10, and LEDGER's from 11, which both networks run, in cardano-submit-api's envelope (koios.test.ts).
 */
const NOT_IN_REWARDS = [
  ["protocol version 10", "ConwayCertsFailure (WithdrawalsNotInRewardsCERTS (Withdrawals {unWithdrawals = fromList []}))"],
  [
    "protocol version 11",
    JSON.stringify({
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
    }),
  ],
] as const;

/** Koios refuses the next `count` submits with `refusal`, running `then` after each, and takes the rest. */
function refusing(t: T, refusal: string, count: number, then: () => void = () => undefined) {
  const real = t.koios.fetch;
  let left = count;
  t.koios.fetch = async (url, init) => {
    if (!url.endsWith("/submittx") || left === 0) return real(url, init);
    left--;
    t.koios.submitted.push(Uint8Array.from(init!.body as Uint8Array));
    then();
    return new Response(refusal, { status: 400 });
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

  it.each(NOT_IN_REWARDS)("is built again once, at once, when the network says the balance moved at %s, and sent", async (_, refusal) => {
    const { t, lovejoin } = await due();
    holding(t, WINDFALL);
    // Someone else took it just before ours went.
    refusing(t, refusal, 1, () => holding(t, 0n));
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

  it.each(NOT_IN_REWARDS)("refused again at %s, sends nothing more and gives its due time back for a later run", async (_, refusal) => {
    const { t, lovejoin } = await due();
    holding(t, WINDFALL);
    refusing(t, refusal, 2);
    await lovejoin.withdrawDue("preprod", false, t.clock.now).catch(() => undefined);
    expect(t.koios.submitted).toHaveLength(2);
    const s = (await t.store.get<{ pools?: Record<string, { due: number[] }>; withdrawing?: unknown }>("lovejoin.preprod"))!;
    expect(s.withdrawing).toBeUndefined();
    expect(s.pools?.[ADA]?.due).toHaveLength(1);
  });
});

/**
 * A way back refused for a moved balance is built again (withdrawOne's `again`) with everything its first build was
 * given, each held here by a test that fails with it dropped from the rebuild: protocol version 11's refusal made that
 * rebuild run for the first time (1.8.1's release review, r2-last#1). T12d holds `paid`, and "is built again once"
 * `due`.
 */
describe("a way back built again after a refusal for a moved balance, as its first build was asked", { timeout: 60_000 }, () => {
  it.each(NOT_IN_REWARDS)("keeps Bring every box back now's mark on the box it sends again, refused at %s", async (_, refusal) => {
    const { t, lovejoin } = await due();
    holding(t, WINDFALL);
    await lovejoin.bringAllBack("preprod");
    refusing(t, refusal, 1, () => holding(t, 0n));
    expect(await lovejoin.withdrawDue("preprod", false, t.clock.now)).toHaveLength(1);
    expect(t.koios.submitted).toHaveLength(2);
    // Counted back as Bring every box back's (Schedule `counted`): a node dropping it never counts the box twice.
    const s = (await t.store.get<{ counted?: Record<string, { pool: string }> }>("lovejoin.preprod"))!;
    expect(Object.keys(s.counted ?? {})).toEqual([`${"e1".repeat(32)}#0`]);
  });

  it.each(NOT_IN_REWARDS)("isn't sent when the wallet locked and unlocked while it was built again, refused at %s", async (_, refusal) => {
    const { t, lovejoin } = await due();
    holding(t, WINDFALL);
    refusing(t, refusal, 1, () => holding(t, 0n));
    // The wallet locks, and is unlocked again, while giveme.my answers for the second build (independent review L11).
    const witness = t.collateral.fetch;
    let asked = 0;
    t.collateral.fetch = async (url, init) => {
      if (++asked === 2) {
        await t.wallet.lock();
        t.clock.now += 20_000;
        await t.wallet.unlock(PASSWORD);
      }
      return witness(url, init);
    };
    expect(await lovejoin.withdrawDue("preprod", false, t.clock.now)).toEqual([]);
    expect(asked).toBe(2);
    expect(t.koios.submitted).toHaveLength(1);
    const s = (await t.store.get<{ pools?: Record<string, { due: number[] }>; withdrawing?: unknown }>("lovejoin.preprod"))!;
    expect(s.withdrawing).toBeUndefined();
    expect(s.pools?.[ADA]?.due).toHaveLength(1);
  });

  const [B1, B2, MIXED, MOVED] = ["b1", "b2", "a1", "f9"].map((h) => h.repeat(32)) as [string, string, string, string];

  /**
   * As lovejoin-crediting-review-fixes.test.ts's 316#0 tests have it, in the 5 ₳ pool, a day on: a mix of the public
   * account's, its box out (MIXED); then two Bootstraps, B1's two boxes where its deposit put them, and B2's first, its
   * second moved by someone else's mix (MOVED), which B2 holds; and giveme.my's witness stood in for.
   */
  async function bootstraps() {
    const t = testBalances({ pools: [ADA_POOL] });
    await t.wallet.create(PHRASE, PASSWORD);
    const own = async (tx: string, index = 0) => adaBox(tx, await ownDatum(t.wallet), t.clock.now, 7, index);
    madeByAdaMix(t.koios, MIXED, MOVED);
    t.koios.addedToAccounts.push(...ADA_ROWS, await own(MIXED), await own(B1, 0), await own(B1, 1), await own(B2), await own(MOVED));
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
    const mix = [
      { kind: "deposit" as const, txCbor: "", txHash: "a0".repeat(32), fee: "0" },
      { kind: "mix" as const, txCbor: "", txHash: MIXED, fee: "0" },
    ];
    const leaf = { txHash: MIXED, txIndex: 0, pool: ADA };
    await lovejoin.recordChain("preprod", { progress: "test.a1", txs: mix, leaves: [leaf], boxes: 1, pools: { [ADA]: 1 }, account: 0 });
    for (const i of mix.keys()) await lovejoin.chainSent("preprod", MIXED, i);
    await lovejoin.chainEnded("preprod", MIXED);
    for (const deposit of [B1, B2]) {
      t.clock.now += 60_000;
      const progress = `test.${deposit.slice(0, 4)}`;
      const leaves = [0, 1].map((txIndex) => ({ txHash: deposit, txIndex, pool: ADA }));
      const txs = [{ kind: "deposit" as const, txCbor: "", txHash: deposit, fee: "0" }];
      await lovejoin.recordChain("preprod", { progress, txs, leaves, boxes: 2, pools: { [ADA]: 2 }, bootstrap: true, account: 0 });
      await lovejoin.chainSent("preprod", deposit, 0);
      await lovejoin.chainEnded("preprod", deposit);
    }
    t.clock.now += 24 * HOUR;
    await t.wallet.unlock(PASSWORD);
    return { t, lovejoin };
  }

  it.each(NOT_IN_REWARDS)("counts a Bootstrap's box brought back by hand against that Bootstrap, refused at %s and sent again", async (_, refusal) => {
    const { t, lovejoin } = await bootstraps();
    holding(t, WINDFALL);
    refusing(t, refusal, 1, () => holding(t, 0n));
    await lovejoin.withdrawNow("preprod", { txHash: MOVED, txIndex: 0, pool: ADA });
    expect(t.koios.submitted).toHaveLength(2);
    // B2's count is down by one; B1 still holds both its boxes, and the public account's mix still has its box out.
    const s = (await t.store.get<{ mixes?: Array<{ id: string; shares: unknown[] }> }>("lovejoin.preprod"))!;
    expect((s.mixes ?? []).map((e) => [e.id, e.shares])).toEqual([
      [MIXED, [{ pool: ADA, boxes: 1 }]],
      [B1, [{ pool: ADA, boxes: 2 }]],
      [B2, [{ pool: ADA, boxes: 2, back: 1 }]],
    ]);
  });
});
