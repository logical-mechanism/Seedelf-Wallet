// What a site waits for, while the wallet is locked (chunk 51, e4b#2). A site's signature waits in the connector's
// window, the user walks away, and auto-lock locks the wallet. A lock leaves what sites wait for in the worker's memory
// (dapp.ts `stateChanged` returns for "locked" with `waiting` untouched), so the user can unlock and answer. But
// `dapp-approvals` had no lock check, so any of the wallet's own pages, DevTools on the window that now shows Unlock
// included, still read the whole prompt: the site, the account's own outputs, and which of the wallet's other accounts
// the transaction pays (`ties`), knowledge that comes from the sealed records and the keys. It's refused while locked,
// as its neighbours `dapp-declined` and `dapp-let-ask` are, and the same request is back once unlocked.
import { describe, expect, it } from "vitest";

import { type DappSession } from "../src/background/dapp";
import { handle, type Context } from "../src/background/handlers";
import { NetworkChoice } from "../src/background/preferences";
import { AUTO_LOCK_MS } from "../src/background/wallet";
import type { DappApproval } from "../src/shared/rpc";
import { loadTestWasm, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
const LOCKED = "The wallet is locked.";
const account = (words: number) =>
  vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === words)!;

const site: DappSession = { id: "r51-e4b-2", origin: "https://dex.example", title: "Example DEX" };

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}

// A site's transaction, as dapp-ties-accounts.test.ts builds one: it spends `inputs` and pays 4 ₳ to each address.
const uint = (n: number) => (n < 24 ? n.toString(16).padStart(2, "0") : `18${n.toString(16).padStart(2, "0")}`);
const outpoints = (list: string[]) => `8${list.length}${list.map((o) => `825820${o.slice(0, 64)}${uint(Number(o.slice(65)))}`).join("")}`;
const bytesOf = (hex: string) => `58${(hex.length / 2).toString(16).padStart(2, "0")}${hex}`;
function paying(inputs: string[], to: string[]) {
  const outputs = `8${to.length}${to.map((a) => `82${bytesOf(a)}1a003d0900`).join("")}`;
  return `84a300${outpoints(inputs)}01${outputs}021a00029810a0f5f6`;
}

/** The 12-word wallet with three public accounts, the connector on. */
async function on() {
  const t = testBalances();
  await t.wallet.create(account(12).phrase, PASSWORD);
  await t.accounts.recordFirst();
  await t.accounts.add(1);
  await t.accounts.add(2);
  await t.preferences.set({ dappConnector: true, spendRewards: false });
  return t;
}
type T = Awaited<ReturnType<typeof on>>;

/** What the worker hands `handle` for a request from one of the wallet's pages (sw.ts answerUi). */
function context(t: T): Context {
  const { wallet, session, balances, moveIn, mint, transfer, withdraw, send, pending, contacts, activity, coins, staking, preferences, prices, nftImages, dapp, sessions, lovejoin, launch, accounts, dataParts } =
    t;
  return {
    wasm: loadTestWasm(),
    wallet,
    session,
    balances,
    moveIn,
    mint,
    transfer,
    withdraw,
    send,
    pending,
    contacts,
    activity,
    coins,
    staking,
    preferences,
    prices,
    nftImages,
    dapp,
    sessions,
    lovejoin,
    launch,
    accounts,
    dataParts,
    connector: async (on) => on,
    version: "1.0.0",
    network: "preprod",
    networks: ["preprod"],
    networkChoice: new NetworkChoice(t.local, ["preprod"]),
  };
}

/** A request from one of the wallet's pages, as ui-port.ts replies to it: its value, or its refusal's words. */
const asked = (p: Promise<unknown>) =>
  p.then(
    (value) => ({ value }),
    (e: Error) => ({ error: e.message }),
  );

describe("what sites wait for, asked while the wallet is locked (chunk 51, e4b#2)", () => {
  it("is refused while the wallet is locked, as dapp-declined is, and the request is back once unlocked", { timeout: 30_000 }, async () => {
    const t = await on();
    const ctx = context(t);

    // The site connects to the public account (the dApp account, index 0).
    const enabling = t.dapp.call(site, "enable", []);
    await until(() => t.dapp.approvals().length === 1);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
    expect(await enabling).toBe(true);
    await t.balances.get("preprod");
    const [own] = (await t.coins.lists("preprod")).cardano;

    // It asks to sign a transaction that pays Account 3 (index 2): the prompt ties the two accounts.
    const { wasm } = t.deps;
    const third = await t.wallet.withAccount(2, ({ cardano }) => wasm.cip30Address(cardano.receiveAddress(wasm.Network.Preprod, 0)));
    const signing = t.dapp.call(site, "signTx", [paying([`${own!.txHash}#${own!.index}`], [third]), false]);
    signing.catch(() => undefined);
    await until(() => t.dapp.approvals().length === 1);
    const shown = t.dapp.approvals()[0]! as Extract<DappApproval, { kind: "sign-tx" }>;
    expect(shown.kind).toBe("sign-tx");
    expect(shown.ties).toEqual([{ account: 2 }]);

    // The user walks away: auto-lock locks the wallet at the next look (wallet.ts load), and the worker tells the
    // connector (sw.ts wires the wallet's `changed` to `dapp.stateChanged`).
    t.clock.now += AUTO_LOCK_MS + 1;
    expect(await t.wallet.state()).toBe("locked");
    await t.dapp.stateChanged();
    // What the site waits for is kept for the unlock: by design, not the finding.
    expect(t.dapp.approvals()).toHaveLength(1);

    // Its neighbour refuses while locked: which sites were turned away is private.
    expect(await asked(handle({ type: "dapp-declined" }, ctx))).toEqual({ error: LOCKED });
    // The finding: the waiting prompt, with its ties to the wallet's other accounts, should be refused the same way.
    expect(await asked(handle({ type: "dapp-approvals" }, ctx))).toEqual({ error: LOCKED });

    // Unlocked again, the request is there to answer, as before the lock.
    expect(await t.wallet.unlock(PASSWORD)).toMatchObject({ unlocked: true });
    await t.dapp.stateChanged();
    const back = await asked(handle({ type: "dapp-approvals" }, ctx));
    expect(back).toMatchObject({ value: [{ id: shown.id, kind: "sign-tx", ties: [{ account: 2 }] }] });
    await t.dapp.answer(shown.id, false);
    await expect(signing).rejects.toMatchObject({ failure: { info: "The user declined." } });
  });
});
