// A private transaction the wallet sends outside its payment watch (a
// Lovejoin box brought back, a session's step) keeps the balance reading's
// account side, as a private spend that lands does (privacy review §2.9):
// the next reading asks Koios about the private side only, never the public
// account in the same moment (independent review M8). The real WebAssembly,
// a recorded preprod pool, and fakes of Koios, giveme.my and Minswap.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { Collateral } from "../src/background/collateral";
import type { KoiosUtxo } from "../src/background/koios";
import { LovejoinService } from "../src/background/lovejoin";
import { SESSION_BALANCES_PREFIX, SESSION_PRIVATE_STALE_PREFIX, SESSION_UNLOCKED_AT } from "../src/background/wallet";
import { txIdOf } from "./fixtures/cbor";
import { koiosPreprod, loadTestWasm, madeByMix, testBalances, vectors } from "./fakes";
import { atSession, funded, signing, started, unlocked as swapWallet } from "./swap-session";

const PASSWORD = "correct horse battery";
const HOUR = 3_600_000;
const PHRASE = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 12)!.phrase;
/** Each withdraw is built and measured in WebAssembly: past Vitest's 5 s on CI's runners. */
const SLOW = { timeout: 30_000 };

/** Lovejoin's preprod pool, as Koios lists it (2026-09-25). */
const POOL = (
  JSON.parse(readFileSync(new URL("./fixtures/lovejoin-pool-preprod.json", import.meta.url), "utf8")) as { pool: KoiosUtxo[] }
).pool;

type T = ReturnType<typeof testBalances>;

/** What Koios was asked about the public account since `from`. */
function accountAskedSince(t: Pick<T, "koios">, from: number) {
  return t.koios.calls
    .slice(from)
    .filter(
      (c) =>
        ["account_addresses", "account_info"].includes(c.path) ||
        (c.path === "credential_utxos" && !(c.body._payment_credentials as string[]).includes(koiosPreprod.wallet_contract)),
    )
    .map((c) => c.path);
}

/**
 * An unlocked wallet with a balance reading kept, one box of its own due in
 * Lovejoin's pool (the unlock long past, its draws made), and giveme.my's
 * witness stood in for, so the withdraw is submitted.
 */
async function boxDue() {
  const t = testBalances();
  await t.wallet.create(PHRASE, PASSWORD);
  const wasm = loadTestWasm();
  const datum = await t.wallet.withKeys((keys) => wasm.registerToDatum(wasm.rerandomize(keys.seedelf.baseRegister())));
  const box = { ...POOL[0]!, tx_hash: "e1".repeat(32), tx_index: 0, inline_datum: { bytes: Buffer.from(datum).toString("hex"), value: {} } };
  // Someone else's mix moved it: Koios says so, as the wallet asks before it takes a box no record accounts for (M14).
  madeByMix(t.koios, box.tx_hash);
  const unlockedAt = t.clock.now - HOUR;
  await t.wallet.withKeys(() => t.session.set(SESSION_UNLOCKED_AT, unlockedAt));
  // Home's first reading, kept, before the box's pool is listed.
  await t.balances.get("preprod");
  t.koios.addedToAccounts.push(...POOL, box);
  await t.store.set("lovejoin.preprod", { due: [t.clock.now - HOUR], unlock: unlockedAt });
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
  });
  return { t, lovejoin };
}

describe("a private transaction sent outside the payment watch (independent review M8)", () => {
  it("a box brought back keeps the reading's account side, and the next reading asks nothing about the account", SLOW, async () => {
    const { t, lovejoin } = await boxDue();
    const before = (await t.balances.get("preprod")).cardano;
    const sent = t.koios.submitted.length;
    await lovejoin.withdrawDue("preprod", false, t.clock.now);
    expect(t.koios.submitted.length).toBe(sent + 1);
    expect(await t.session.get(SESSION_BALANCES_PREFIX + "preprod")).toBeDefined();
    expect(await t.session.get(SESSION_PRIVATE_STALE_PREFIX + "preprod")).toBe(true);

    // It lands, and is seen: still only the private side is behind.
    t.koios.confirmations = 1;
    await lovejoin.withdrawDue("preprod", false, t.clock.now);
    expect(await t.session.get(SESSION_BALANCES_PREFIX + "preprod")).toBeDefined();

    const from = t.koios.calls.length;
    const after = await t.balances.get("preprod");
    expect(accountAskedSince(t, from)).toEqual([]);
    expect(after.cardano).toEqual(before);
  });

  it("a session's swap step leaves the reading as it is: it spends only the session's own account", SLOW, async () => {
    const t = await swapWallet();
    const sessions = signing(t);
    await started(sessions);
    funded(t);
    t.koios.addedToAccounts.push(atSession("0c".repeat(32), 1, "5000000"));
    // Home's reading, kept once the funding is on its way.
    await t.balances.get("preprod");
    await t.wallet.withKeys(() => t.session.remove(SESSION_PRIVATE_STALE_PREFIX + "preprod"));
    const view = await sessions.advance("preprod", 0);
    expect(view.txs.map((x) => x.kind)).toEqual(["out", "swap"]);
    expect(await t.session.get(SESSION_BALANCES_PREFIX + "preprod")).toBeDefined();
    expect(await t.session.get(SESSION_PRIVATE_STALE_PREFIX + "preprod")).toBeUndefined();
  });
});
