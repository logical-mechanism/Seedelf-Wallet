// Changing the dApp account (Settings → Sites) shows sites the new account,
// and nothing of the one it left (the release review). The connector's
// reading of the account was kept 30 s, and the outputs of transactions it
// signed offered for 10 minutes, under keys with no account in them: a site
// connected just after the change, which Settings' note doesn't cover, got
// the old account's stake address, UTxOs and balance beside the new one's
// change address, and so learned both are one wallet's. The reading is kept
// per account now, and the signed outputs are offered to the account that
// signed them; a site resending a transaction sent before the change still
// hears its id (independent review M3, final review F12).
import { describe, expect, it } from "vitest";

import { type DappSession } from "../src/background/dapp";
import type { KoiosUtxo } from "../src/background/koios";
import { witnessedKeys } from "../src/background/minswap";
import { SESSION_SEND } from "../src/background/send";
import { APIError } from "../src/shared/dapp";
import { busyFor, koiosPreprod, testBalances, vectors } from "./fakes";

const PASSWORD = "correct horse battery";
/** The one vector phrase with both accounts recorded: account 0 holds UTxOs, account 1 none. */
const phrase = (account: 0 | 1) =>
  vectors("cardano_account.json").find((v) => v.account === account && v.phrase.split(" ").length === 24)!;
const THEIRS = vectors("cardano_account.json").find((v) => v.account === 0 && v.phrase.split(" ").length === 15)!.preprod
  .receive_0 as string;
const BAD_INPUTS = '{"contents":{"contents":{"contents":{"era":"ShelleyBasedEraConway","error":["BadInputsUTxO"]}}}}';
/** A test whose cases run in a loop, a wallet made for each or twenty signatures approved: past Vitest's 5 s on CI's runners. */
const SLOW = { timeout: 30_000 };

let pages = 0;
const site = (origin = "https://app.example.com"): DappSession => ({ id: `change${++pages}`, origin, title: "Example" });
async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}

async function on() {
  const t = testBalances();
  await t.wallet.create(phrase(0).phrase, PASSWORD);
  await t.accounts.recordFirst();
  await t.preferences.set({ dappConnector: true, dappPassword: false, spendRewards: false });
  // Account 1 of this phrase has been used, so the wallet can move to it.
  t.koios.usedStakes.add(phrase(1).preprod.stake as string);
  await t.accounts.discover("preprod");
  return t;
}
type T = Awaited<ReturnType<typeof on>>;

async function connect(t: T, s = site()) {
  const enabling = t.dapp.call(s, "enable", []);
  await until(() => t.dapp.approvals().length === 1);
  await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
  expect(await enabling).toBe(true);
  return s;
}

/** What a site reads of the public side. */
async function reads(t: T, s: DappSession) {
  return {
    reward: await t.dapp.call(s, "getRewardAddresses", []),
    used: await t.dapp.call(s, "getUsedAddresses", []),
    change: await t.dapp.call(s, "getChangeAddress", []),
    utxos: await t.dapp.call(s, "getUtxos", []),
    balance: t.deps.wasm.cip30ReadValue((await t.dapp.call(s, "getBalance", [])) as string),
    collateral: await t.dapp.call(s, "getCollateral", []),
  };
}

/** Account 1 as a site reads it: its own addresses, and nothing in it. */
function account1(t: T) {
  const { wasm } = t.deps;
  const receive = wasm.cip30Address(phrase(1).preprod.receive_0 as string);
  return {
    reward: [wasm.cip30Address(phrase(1).preprod.stake as string)],
    used: [receive],
    change: receive,
    utxos: [],
    balance: JSON.stringify({ lovelace: "0", tokens: [] }),
    collateral: null,
  };
}

describe("a change of the dApp account", () => {
  it("shows a site connected right after it nothing of the account it left, a reading under way included", async () => {
    const t = await on();
    const a = await connect(t);
    const old = await reads(t, a);
    expect(old.utxos).not.toEqual([]);

    // A reading of account 0 is under way, asking Koios, as the user changes the account.
    t.clock.now += 31_000;
    let release!: () => void;
    t.koios.hold = new Promise<void>((r) => (release = r));
    const asked = t.koios.calls.length;
    const reading = t.dapp.call(a, "getUtxos", []);
    await until(() => t.koios.calls.length > asked);
    await t.preferences.set({ dappAccount: 1 });
    release();
    t.koios.hold = undefined;
    expect(await reading).toEqual(old.utxos);

    // A new site, within the 30 s: account 1 alone, its reading not the one that just landed.
    const b = await connect(t, site("https://new.example"));
    expect(JSON.parse(JSON.stringify(await reads(t, b)))).toMatchObject({ ...account1(t), balance: expect.any(String) });
    expect(JSON.parse(t.deps.wasm.cip30ReadValue((await t.dapp.call(b, "getBalance", [])) as string))).toMatchObject({ lovelace: "0" });
    // So does the site connected before, as Settings says.
    expect((await reads(t, a)).reward).toEqual(account1(t).reward);
  });

  it("offers a site the outputs of a transaction signed before it to the account that signed it alone", async () => {
    const t = await on();
    const a = await connect(t);
    // Site A has account 0 sign a payment with change, and sends it.
    await t.send.build("preprod", [{ to: THEIRS, lovelace: "3000000", tokens: [] }]);
    const tx = (await t.session.get<{ txCbor: string }>(SESSION_SEND))!.txCbor;
    const signing = t.dapp.call(a, "signTx", [tx, false]);
    await until(() => t.dapp.approvals().length === 1);
    expect(await t.dapp.answer(t.dapp.approvals()[0]!.id, true)).toEqual({});
    await signing;
    const id = (await t.dapp.call(a, "submitTx", [tx])) as string;
    const offered = (await t.dapp.call(a, "getUtxos", [])) as string[];
    expect(offered.some((u) => u.includes(id))).toBe(true);

    // The user changes the account, a minute on: past the reading's 30 s, inside the outputs' 10 minutes.
    await t.preferences.set({ dappAccount: 1 });
    t.clock.now += 60_000;
    const b = await connect(t, site("https://new.example"));
    expect(await t.dapp.call(b, "getUtxos", [])).toEqual([]);
    expect(JSON.parse(t.deps.wasm.cip30ReadValue((await t.dapp.call(b, "getBalance", [])) as string))).toMatchObject({ lovelace: "0" });

    // Site A sending it again hears its id, as before the change, whatever Koios says of it now.
    t.koios.rejectSubmit = BAD_INPUTS;
    expect(await t.dapp.call(a, "submitTx", [tx])).toBe(id);

    // Back on account 0, its change is offered again: it's that account's.
    await t.preferences.set({ dappAccount: 0 });
    expect(((await t.dapp.call(a, "getUtxos", [])) as string[]).some((u) => u.includes(id))).toBe(true);
  });
});

describe("a site's signature waiting as the dApp account changes (chunk 25)", () => {
  // Read and checked for account 0 (its inputs, its prompt's ties), then signed on approval with whatever the dApp
  // account was by then. Lace refuses a signData so, with CIP-30's AccountChange, but not a signTx; here both are.
  const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");

  async function waiting(t: T) {
    const a = await connect(t);
    await t.send.build("preprod", [{ to: THEIRS, lovelace: "3000000", tokens: [] }]);
    const tx = (await t.session.get<{ txCbor: string }>(SESSION_SEND))!.txCbor;
    const own = t.deps.wasm.cip30Address(phrase(0).preprod.receive_0 as string);
    const signing = t.dapp.call(a, "signTx", [tx, false]);
    const message = t.dapp.call(a, "signData", [own, hex("Sign in: nonce 7")]);
    // Caught, so neither rejects unheard before the test looks.
    signing.catch(() => undefined);
    message.catch(() => undefined);
    await until(() => t.dapp.approvals().length === 2);
    return { signing, message };
  }
  const accountChange = { failure: { code: APIError.AccountChange, info: expect.stringContaining("The account sites use changed") } };

  it("is declined with AccountChange once Settings chooses another, and a connect waits on", async () => {
    const t = await on();
    const { signing, message } = await waiting(t);
    // A connect isn't read for any account: it waits on, and connects to the one chosen.
    const enabling = t.dapp.call(site("https://new.example"), "enable", []);
    await until(() => t.dapp.approvals().length === 3);

    await t.preferences.set({ dappAccount: 1 });
    await t.dapp.dappAccountChanged();
    await expect(signing).rejects.toMatchObject(accountChange);
    await expect(message).rejects.toMatchObject(accountChange);
    expect(t.dapp.approvals().map((a) => a.kind)).toEqual(["connect"]);
    await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
    expect(await enabling).toBe(true);
  });

  it("is refused if approved after a change it wasn't declined for, and nothing is signed", async () => {
    const t = await on();
    const { signing, message } = await waiting(t);
    // Changed with no word to the connector (another window, a race): the approval itself finds it.
    await t.preferences.set({ dappAccount: 1 });
    const [first] = t.dapp.approvals();
    expect(await t.dapp.answer(first!.id, true)).toEqual({ error: expect.stringContaining("The account sites use changed") });
    await expect(signing).rejects.toMatchObject(accountChange);
    await expect(message).rejects.toMatchObject(accountChange);
    expect(t.dapp.approvals()).toEqual([]);
  });

  it("is refused if the change lands while the password is checked, past the first look", async () => {
    const t = await on();
    await t.preferences.set({ dappPassword: true });
    const { signing } = await waiting(t);
    const check = t.wallet.checkPassword.bind(t.wallet);
    t.wallet.checkPassword = async (password: string) => {
      await check(password);
      await t.preferences.set({ dappAccount: 1 });
    };
    const tx = t.dapp.approvals().find((a) => a.kind === "sign-tx")!;
    expect(await t.dapp.answer(tx.id, true, PASSWORD)).toMatchObject({ error: expect.stringContaining("The account sites use changed") });
    await expect(signing).rejects.toMatchObject(accountChange);
  });

  it("stays as it was when the account is chosen again as it is", async () => {
    const t = await on();
    await waiting(t);
    await t.preferences.set({ dappAccount: 0 });
    await t.dapp.dappAccountChanged();
    expect(t.dapp.approvals()).toHaveLength(2);
  });
});

describe("a site's signature still being read, or being approved, as the dApp account changes (1.3.0's release review)", () => {
  // Read for account 0, a request was inspected, put in front of the user and signed with whatever the dApp account
  // was at each step, read again every time. A change while it was read had it refused as nothing of the account's
  // to sign (ProofGeneration, not AccountChange), or shown after Settings' decline had run; one landing as it was
  // approved, past the first check, had the new account's keys sign it (C26, C27).
  const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");
  const moved = { code: APIError.AccountChange, info: expect.stringContaining("The account sites use changed") };

  /** Settings' change as the worker makes it (handlers.ts, `preferences-set`): written, then the connector told. */
  async function change(t: T, account: number) {
    await t.preferences.set({ dappAccount: account });
    await t.dapp.dappAccountChanged();
  }

  /** How a site's call ended, once it has: its answer, or what the site heard. */
  function ending(call: Promise<unknown>) {
    const end: { done: boolean; value?: unknown; failure?: unknown } = { done: false };
    call.then(
      (value) => Object.assign(end, { done: true, value }),
      (e: { failure?: unknown }) => Object.assign(end, { done: true, failure: e.failure ?? String(e) }),
    );
    return end;
  }

  /** The public accounts whose keys the wallet is asked for, as it's asked. */
  function accountsUsed(t: T): number[] {
    const real = t.wallet.withAccount.bind(t.wallet);
    const used: number[] = [];
    t.wallet.withAccount = ((index: number, task: Parameters<typeof real>[1]) => {
      used.push(index);
      return real(index, task);
    }) as typeof t.wallet.withAccount;
    return used;
  }

  async function payment(t: T) {
    await t.send.build("preprod", [{ to: THEIRS, lovelace: "3000000", tokens: [] }]);
    return (await t.session.get<{ txCbor: string }>(SESSION_SEND))!.txCbor;
  }

  it("refuses a signTx and a signData being read as the change lands with AccountChange, and never shows them", async () => {
    const t = await on();
    const a = await connect(t);
    const tx = await payment(t);
    const own = t.deps.wasm.cip30Address(phrase(0).preprod.receive_0 as string);
    // The kept reading has aged: both read account 0 again, and Koios is slow to answer.
    t.clock.now += 31_000;
    let release!: () => void;
    t.koios.hold = new Promise<void>((r) => (release = r));
    const asked = t.koios.calls.length;
    const shown = t.dappWindow.shown;
    const signing = ending(t.dapp.call(a, "signTx", [tx, false]));
    const message = ending(t.dapp.call(a, "signData", [own, hex("Sign in: nonce 7")]));
    await until(() => t.koios.calls.length > asked);
    await change(t, 1);
    release();
    t.koios.hold = undefined;
    await until(() => signing.done && message.done);
    expect(signing.failure).toEqual(moved);
    expect(message.failure).toEqual(moved);
    expect(t.dapp.approvals()).toEqual([]);
    expect(t.dappWindow.shown).toBe(shown);
  });

  it("refuses one whose change lands as its prompt is made ready, before or after its last look at the account", SLOW, async () => {
    // The worker writes the setting, then declines what waits. Started as the prompt's ties to the wallet's other
    // accounts are read, the change is seen by the request's last look before the window, which refuses it; started
    // just after that look read the old account, it finds the request waiting, and declines it. Never left in front
    // of the user for the account Settings left, whatever turn it lands on.
    for (const after of ["ties", "look"] as const) {
      for (let skew = 0; skew < 4; skew++) {
        const t = await on();
        const a = await connect(t);
        const tx = await payment(t);
        let changing: Promise<void> | undefined;
        const start = () =>
          (changing ??= (async () => {
            for (let i = 0; i < skew; i++) await Promise.resolve();
            await change(t, 1);
          })());
        const indices = t.sessions.indices.bind(t.sessions);
        let tied = false;
        t.sessions.indices = async (network) => {
          tied = true;
          if (after === "ties") start();
          return indices(network);
        };
        const get = t.preferences.get.bind(t.preferences);
        t.preferences.get = async () => {
          const prefs = await get();
          if (after === "look" && tied) start();
          return prefs;
        };
        const signing = ending(t.dapp.call(a, "signTx", [tx, false]));
        await until(() => changing !== undefined);
        await changing;
        await until(() => signing.done);
        expect(signing.failure).toEqual(moved);
        expect(t.dapp.approvals()).toEqual([]);
      }
    }
  });

  it("reads the account it was asked for afresh, not the one Settings moved to, for an input the kept reading lacks", async () => {
    const t = await on();
    const a = await connect(t);
    const tx = await payment(t);
    await t.dapp.call(a, "getUtxos", []);
    // The kept reading of account 0 lacks what the transaction spends, so the request reads the account again.
    const KEY = "seedelf.dapp.view.preprod";
    await t.session.set(KEY, { ...(await t.session.get<object>(KEY)), utxos: [] });
    // The change lands as the kept reading is looked at: between it and the fresh one.
    const get = t.session.get.bind(t.session);
    let changed = false;
    t.session.get = (async (key: string) => {
      const value = await get(key);
      if (key === KEY && !changed) {
        changed = true;
        await change(t, 1);
      }
      return value;
    }) as typeof t.session.get;
    const signing = ending(t.dapp.call(a, "signTx", [tx, false]));
    await until(() => signing.done);
    expect(changed).toBe(true);
    expect(signing.failure).toEqual(moved);
    expect(t.dapp.approvals()).toEqual([]);
  });

  it("refuses it with AccountChange when the change lands as it's approved, and the new account's keys sign nothing", async () => {
    const t = await on();
    const a = await connect(t);
    const tx = await payment(t);
    const signing = ending(t.dapp.call(a, "signTx", [tx, false]));
    await until(() => t.dapp.approvals().length === 1);
    // Settings' change lands past the approval's first look at the account, as the user's locks are read again.
    const choices = t.coins.choices.bind(t.coins);
    let changed = false;
    t.coins.choices = async (network, account) => {
      if (!changed) {
        changed = true;
        await change(t, 1);
      }
      return choices(network, account);
    };
    const used = accountsUsed(t);
    expect(await t.dapp.answer(t.dapp.approvals()[0]!.id, true)).toEqual({
      error: expect.stringContaining("The account sites use changed"),
    });
    await until(() => signing.done);
    expect(changed).toBe(true);
    expect(signing.failure).toEqual(moved);
    expect(used).not.toContain(1);
  });

  it("never has the new account's keys sign, wherever the change falls as it's approved", SLOW, async () => {
    // A transaction with a part for each account, for a partial signature: read for account 0, which signs its own
    // input, while account 1's is someone else's to the review. Settings' change lands just before the approval's
    // first read of the setting, then its second, and so on, past the last.
    const t = await on();
    const { wasm } = t.deps;
    const ours = [...koiosPreprod.accounts[phrase(0).preprod.stake as string]!.account_utxos].sort((x, y) =>
      Number(BigInt(y.value) - BigInt(x.value)),
    )[0]!;
    const theirs: KoiosUtxo = {
      ...ours,
      tx_hash: "ab".repeat(32),
      tx_index: 0,
      value: "50000000",
      address: phrase(1).preprod.receive_0 as string,
      payment_cred: wasm.cip30Address(phrase(1).preprod.receive_0 as string).slice(2, 58),
      stake_address: phrase(1).preprod.stake as string,
      asset_list: [],
    };
    t.koios.addedToAccounts.push(theirs);
    // Both inputs, and 4 ₳ to someone else. Nothing balances it: the wallet only reads and signs it.
    const input = (u: KoiosUtxo) =>
      `825820${u.tx_hash}${u.tx_index < 24 ? "" : "18"}${u.tx_index.toString(16).padStart(2, "0")}`;
    const tx = `84a30082${input(ours)}${input(theirs)}0181825839${wasm.cip30Address(THEIRS)}1a003d0900021a00029810a0f5f6`;
    const own = wasm.cip30Address(phrase(0).preprod.receive_0 as string);
    const a = await connect(t);

    let from: number | undefined;
    let reads = 0;
    const get = t.preferences.get.bind(t.preferences);
    t.preferences.get = async () => {
      const prefs = await get();
      return from !== undefined && reads++ >= from ? { ...prefs, dappAccount: 1 } : prefs;
    };
    const used = accountsUsed(t);
    const ends = new Set<string>();
    for (const method of ["signTx", "signData"] as const) {
      for (let at = 0; at < 10; at++) {
        // A minute on each time, so the site's fresh readings and lookups (`PER_MINUTE`) come back.
        await busyFor(t, 61_000);
        const call = ending(t.dapp.call(a, method, method === "signTx" ? [tx, true] : [own, hex("Sign in: nonce 7")]));
        await until(() => t.dapp.approvals().length === 1);
        from = at;
        reads = 0;
        used.length = 0;
        await t.dapp.answer(t.dapp.approvals()[0]!.id, true);
        await until(() => call.done);
        from = undefined;
        expect(used).not.toContain(1);
        if (call.failure !== undefined) {
          expect(call.failure).toEqual(moved);
        } else if (method === "signTx") {
          // The witness set alone, as a transaction with an empty body, for the keys it carries.
          const keys = witnessedKeys(Buffer.from(`84a0${call.value as string}f5f6`, "hex"));
          expect([...keys]).toEqual([ours.payment_cred]);
        }
        ends.add(`${method} ${call.failure === undefined ? "signed" : "refused"}`);
      }
    }
    // A change up to the last look at the account was refused; past it nothing reads the setting, and account 0
    // alone signed.
    expect([...ends].sort()).toEqual(["signData refused", "signData signed", "signTx refused", "signTx signed"]);
  });
});
