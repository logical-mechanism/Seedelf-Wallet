// Send and Make public, UTxO details and Transaction details, for an address under one of the account's payment keys
// whose stake part isn't the account's: someone else's stake key, a pointer, or none. Anyone can pair the account's
// receive key 0/0, public in every address it hands out, with their own stake key. The wallet rightly counts and spends
// that money as the account's (by payment key, privacy review §2.17), so a payment there comes back to the balance; but
// while it's there its stake earns, and votes, for the stranger's key.
//
// Chunk 51, x1a#1 (its trace verifier's test, moved here): Send's and Make public's reviews read word for word as they
// do for the Receive address, where the sign window says it of the same shape ("dappUi.warn.ownKey"). And e9a#3: UTxO
// details called such an address "Your receive address, the one Receive shows". Transaction details' tag is the same
// root (tx-view.ts `stakeElsewhere`).
//
// The worker's answer is the real one (resolveDestination, through WithdrawService.resolve, as both forms ask it and as
// SendService.build and WithdrawService.build put it in their summaries). The reviews are the real screens, rendered
// over the house's useState seed (screens-wiring-review-fixes.test.ts's seam, trimmed to `seed`): a review's state is
// one only an awaited answer reaches.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { KoiosUtxo } from "../src/background/koios";
import type { TxDetail, UtxoInfo } from "../src/shared/rpc";

const seam = vi.hoisted(() => {
  /** Whether a useState's initial value is `want`: an empty object for `{}`, or the same value. */
  const matches = (initial: unknown, want: unknown) =>
    want && typeof want === "object" && !Object.keys(want).length
      ? !!initial && typeof initial === "object" && !Array.isArray(initial) && !Object.keys(initial).length
      : Object.is(initial, want);
  const state = {
    /** A seed lands on a state that starts empty, or one that starts as `initial` where it says one. */
    seeds: [] as Array<{ after: unknown[]; initial?: unknown; value: unknown; used?: true }>,
    initials: [] as unknown[],
    /** What useState starts with: `initial`, or the seed whose run of initial values precedes this call. */
    seeded(initial: unknown): unknown {
      const before = state.initials;
      state.initials = [...before, initial];
      for (const seed of state.seeds) {
        if (seed.used || before.length < seed.after.length) continue;
        if ("initial" in seed ? !matches(initial, seed.initial) : initial !== undefined) continue;
        const run = before.slice(before.length - seed.after.length);
        if (!seed.after.every((want, i) => matches(run[i], want))) continue;
        seed.used = true;
        return seed.value;
      }
      return initial;
    },
    reset() {
      state.seeds = [];
      state.initials = [];
    },
  };
  return state;
});

vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return { ...react, useState: (initial?: unknown) => react.useState(seam.seeded(initial)) };
});
// Nothing a review shows is asked of the worker while it renders: any request stays unanswered.
vi.mock("../src/ui/background", async (original) => {
  const pending = { then: () => pending, catch: () => pending, finally: () => pending };
  return { ...(await original<typeof import("../src/ui/background")>()), call: () => pending };
});

const { t } = await import("../src/i18n");
const { DEFAULT_PREFERENCES } = await import("../src/shared/preferences");
const { NetworkContext } = await import("../src/ui/network");
const { PreferencesContext } = await import("../src/ui/preferences");
const { AccountsContext } = await import("../src/ui/accounts");
const { CardanoSend } = await import("../src/ui/screens/CardanoSend");
const { Withdraw } = await import("../src/ui/screens/Withdraw");
const { UtxoDetails } = await import("../src/ui/screens/Utxos");
const { TxDetailBody } = await import("../src/ui/components/TxDetail");
const { adaText } = await import("../src/ui/format");
const { preprodAddress, bech32Bytes } = await import("./fixtures/bech32");
const { koiosPreprod, loadTestWasm, testBalances, transferPreprod, vectors } = await import("./fakes");

const PASSWORD = "correct horse battery";
const v = vectors("cardano_account.json").find((x) => x.account === 0 && x.phrase.split(" ").length === 12)!;
const TX = "ab".repeat(32);
/** Any 28 bytes: a stake key that isn't any account's of this phrase. */
const STRANGERS_STAKE = "cd".repeat(28);
/** 20,000 ₳, as the finding's user sends it. */
const SENT = "20000000000";
const noop = () => undefined;
const none = { lovelace: "0", tokens: [], utxos: 0 };
const cardano = {
  lovelace: "20100000000",
  tokens: [],
  utxos: 3,
  addressesUsed: 1,
  locked: none,
  staking: { registered: true, pool: null, drep: null, rewards: "0", deposit: "2000000" },
};
const seedelf = { lovelace: "20100000000", tokens: [], utxos: 23, seedelfs: [], locked: none };

/** What a person reads of markup. */
const words = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replace(/\s+/g, " ")
    .trim();
const has = (markup: string, testId: string) => markup.includes(`data-testid="${testId}"`);
/** A review's row value by its label, of the rows `testId`. */
function row(markup: string, testId: string, label: string): string | undefined {
  const at = markup.indexOf(`data-testid="${testId}"`);
  if (at < 0) return undefined;
  const list = markup.slice(at, markup.indexOf("</dl>", at));
  return [...list.matchAll(/<dt>(.*?)<\/dt><dd[^>]*>(.*?)<\/dd>/g)].map((m) => [words(m[1]!), words(m[2]!)]).find(([l]) => l === words(label))?.[1];
}

/** `element` on preprod, in a wallet of one account, account 0 on screen. */
function render(element: ReactElement): string {
  const accounts = { accounts: [{ index: 0 }], active: 0, loaded: true, name: "Account 1", several: false, reload: async () => undefined };
  return renderToStaticMarkup(
    createElement(
      NetworkContext.Provider,
      { value: "preprod" },
      createElement(
        PreferencesContext.Provider,
        { value: { prefs: DEFAULT_PREFERENCES, loaded: true, set: async () => undefined } },
        createElement(AccountsContext.Provider, { value: accounts }, element),
      ),
    ),
  );
}

/** Send's review of one payment of 20,000 ₳ to `destination`, as SendService.pay puts the worker's answer in it. */
function sendReview(destination: object): string {
  seam.reset();
  // Its state starts after the form's reads', its Max's, its note's and the note's cut's.
  seed([{}, false, "", false], {
    network: "preprod",
    txHash: TX,
    max: false,
    fee: "200000",
    changeLovelace: "99800000",
    changeTokens: 0,
    inputs: 2,
    payments: [{ ...destination, lovelace: SENT, minimum: null, tokens: [] }],
  });
  return render(createElement(CardanoSend, { cardano, total: cardano.lovelace, onCancel: noop, onSent: noop }));
}

/** Make public's review of one payment of 20,000 ₳ to `destination`, as WithdrawService.build's summaryOf has it. */
function makePublicReview(destination: object): string {
  seam.reset();
  seed([{}, false], {
    network: "preprod",
    txHash: TX,
    max: false,
    fee: { size: "500000", compute: "50000", scriptReference: "0", total: "550000" },
    changeLovelace: "99450000",
    changeTokens: 0,
    changeOutputs: 1,
    changeMinimum: "0",
    inputs: 3,
    left: 0,
    payments: [{ ...destination, lovelace: SENT, minimum: null, tokens: [] }],
  });
  return render(createElement(Withdraw, { seedelf, onCancel: noop, onSent: noop }));
}

function seed(after: unknown[], value: unknown) {
  seam.seeds.push({ after, value });
}

/** What a person reads of a review, the address it pays written as one placeholder. */
const read = (markup: string, address: string) => words(markup).replaceAll(address, "‹the address›");

beforeEach(() => seam.reset());

describe("Send and Make public to the account's payment key under a stranger's stake key (chunk 51, x1a#1)", () => {
  it("say what the stake part means, as the sign window does, not only what they say of the Receive address", async () => {
    const tb = testBalances();
    await tb.wallet.create(v.phrase, PASSWORD);
    const wasm = loadTestWasm();
    const account = wasm.CardanoAccount.fromPhrase(v.phrase, 0);
    const key = account.paymentKeyHash(0, 0);
    const stake = Buffer.from(bech32Bytes(account.stakeAddress(wasm.Network.Preprod)).slice(1)).toString("hex");
    const { receiveAddress } = await tb.wallet.account("preprod");
    // The Receive address is base(0/0, the account's stake key); the stranger's is base(0/0, their own).
    expect(preprodAddress(key, stake)).toBe(receiveAddress);
    const planted = preprodAddress(key, STRANGERS_STAKE);
    expect(planted).not.toBe(receiveAddress);

    // What the worker has to tell them apart: the payment key is the account's in both, the stake key in one only.
    expect(account.isOwnAddress(planted, [])).toBe(true);
    expect(account.carriesStakeKey(receiveAddress)).toBe(true);
    expect(account.carriesStakeKey(planted)).toBe(false);
    account.free();
    // How the wallet says the same shape in a site's transaction.
    expect(t("dappUi.warn.ownKey")).toContain("a stake part that isn't yours");

    // The worker's answer, as both forms ask it and both builds keep it: the account's own, account 0, for both
    // (§2.17, which stays: the payment key links the money to the account, and the balance reads it).
    const toReceive = await tb.withdraw.resolve("preprod", receiveAddress);
    const toPlanted = await tb.withdraw.resolve("preprod", planted);
    expect(toReceive).toMatchObject({ address: receiveAddress, own: true, ownAccount: 0 });
    expect(toPlanted).toMatchObject({ address: planted, own: true, ownAccount: 0 });
    expect(tb.koios.calls).toHaveLength(0);

    // Send's review, today, for both: "This is your own public account: it comes back, less the fee.", and the
    // 20,000 ₳ not counted as leaving: the total is the fee alone. That much is true of the balance.
    const sendToReceive = sendReview(toReceive);
    const sendToPlanted = sendReview(toPlanted);
    for (const page of [sendToReceive, sendToPlanted]) {
      expect(has(page, "send-own")).toBe(true);
      expect(words(page)).toContain(t("send.warn.ownAccount"));
      expect(row(page, "send-review", t("review.total.public"))).toBe(words(adaText("200000")));
    }
    // Make public's review, today, for both: "This is your own public account: anyone can link it ...".
    const publicToReceive = makePublicReview(toReceive);
    const publicToPlanted = makePublicReview(toPlanted);
    for (const page of [publicToReceive, publicToPlanted]) expect(has(page, "withdraw-own")).toBe(true);

    // The finding (soft, so each is reported). The worker's answer for the stranger's stake part says something its
    // answer for the Receive address doesn't ...
    const { address: _r, ...receiveVerdict } = toReceive;
    const { address: _p, ...plantedVerdict } = toPlanted;
    expect.soft(plantedVerdict, "the worker tells base(0/0, a stranger's stake key) from the Receive address").not.toEqual(receiveVerdict);
    // ... and each review says it: not word for word what it says of the Receive address, and naming the stake.
    expect.soft(read(sendToPlanted, planted), "Send's review tells it from the Receive address").not.toBe(read(sendToReceive, receiveAddress));
    expect.soft(read(publicToPlanted, planted), "Make public's review tells it from the Receive address").not.toBe(
      read(publicToReceive, receiveAddress),
    );
    expect.soft(read(sendToReceive, receiveAddress), "the control: Send's review to the Receive address names no stake").not.toMatch(/stak/i);
    expect.soft(read(sendToPlanted, planted), "Send's review names the stake part that isn't the user's").toMatch(/stak/i);
  });
});


describe("each of several recipients so paid (chunk 51, x1a#1)", () => {
  /** Send's review of `destinations`, 20,000 ₳ each, as SendService.pay puts the worker's answers in it. */
  function sendReviewOf(destinations: object[]): string {
    seam.reset();
    seed([{}, false, "", false], {
      network: "preprod",
      txHash: TX,
      max: false,
      fee: "200000",
      changeLovelace: "99800000",
      changeTokens: 0,
      inputs: 2,
      payments: destinations.map((d) => ({ ...d, lovelace: SENT, minimum: null, tokens: [] })),
    });
    return render(createElement(CardanoSend, { cardano, total: cardano.lovelace, onCancel: noop, onSent: noop }));
  }

  it("names which one in Send's review, and says nothing of the Receive address's stake", async () => {
    const tb = testBalances();
    await tb.wallet.create(v.phrase, PASSWORD);
    const key = loadTestWasm().CardanoAccount.fromPhrase(v.phrase, 0).paymentKeyHash(0, 0);
    const { receiveAddress } = await tb.wallet.account("preprod");
    const planted = preprodAddress(key, STRANGERS_STAKE);
    const page = words(sendReviewOf([await tb.withdraw.resolve("preprod", receiveAddress), await tb.withdraw.resolve("preprod", planted)]));
    expect(page).toContain(t("send.warn.stakeElsewhereNth", { number: 2 }));
    expect(page).not.toContain(t("send.warn.stakeElsewhereNth", { number: 1 }));
    expect(page).not.toContain(t("send.warn.stakeElsewhere"));
  });
});

describe("Send's and Make public's forms, once the To field reads such an address (chunk 51, r2tests#2)", () => {
  it("say its stake part isn't the user's, under their own account's note, and nothing of it for the Receive address", async () => {
    const tb = testBalances();
    await tb.wallet.create(v.phrase, PASSWORD);
    const key = loadTestWasm().CardanoAccount.fromPhrase(v.phrase, 0).paymentKeyHash(0, 0);
    const { receiveAddress } = await tb.wallet.account("preprod");
    const planted = preprodAddress(key, STRANGERS_STAKE);
    // The worker's answer for each, as the To field asks it.
    const read = async (to: string) => ({ state: "read", destination: await tb.withdraw.resolve("preprod", to) });
    /** The form with its To field read so: the page's reads, by draft (the first is 0), start as that read. */
    const form = (screen: "send" | "withdraw", to: string, destination: unknown) => {
      seam.reset();
      seam.seeds.push({ after: [], initial: {}, value: { 0: { to, read: destination } } });
      return render(
        screen === "send"
          ? createElement(CardanoSend, { cardano, to, onCancel: noop, onSent: noop })
          : createElement(Withdraw, { seedelf, to, onCancel: noop, onSent: noop }),
      );
    };
    for (const screen of ["send", "withdraw"] as const) {
      const strangers = form(screen, planted, await read(planted));
      expect(has(strangers, `${screen}-own`), screen).toBe(true);
      expect(has(strangers, `${screen}-stake-elsewhere`), screen).toBe(true);
      expect(words(strangers), screen).toContain(t("send.warn.stakeElsewhere"));
      // The control: the Receive address is the account's own, its stake part too.
      const own = form(screen, receiveAddress, await read(receiveAddress));
      expect(has(own, `${screen}-own`), screen).toBe(true);
      expect(has(own, `${screen}-stake-elsewhere`), screen).toBe(false);
    }
  });
});

describe("UTxO details, of a public UTxO's address (chunk 51, e9a#3)", () => {
  const RECEIVE = "Your receive address, the one Receive shows.";
  /** The note under a public UTxO's address, as its details render it. */
  const whose = (utxo: UtxoInfo) =>
    render(createElement(UtxoDetails, { of: "cardano", utxo, busy: false, onLock: noop, onClose: noop })).match(
      /data-testid="utxo-address-whose">([^<]*)</,
    )?.[1];
  const stake = (utxo: UtxoInfo) =>
    words(render(createElement(UtxoDetails, { of: "cardano", utxo, busy: false, onLock: noop, onClose: noop })));

  it("calls only the Receive address itself the one Receive shows, not 0/0 under another staking part", async () => {
    const tb = testBalances();
    await tb.wallet.create(v.phrase, PASSWORD);
    const key = loadTestWasm().CardanoAccount.fromPhrase(v.phrase, 0).paymentKeyHash(0, 0);
    const recorded = koiosPreprod.accounts[v.preprod.stake]!.account_utxos;
    // Koios rows like the recorded ones, at addresses a stranger can pay: as balances.test.ts builds them.
    const stray = (n: string, address: string, value: string): KoiosUtxo => ({
      ...recorded[0]!,
      tx_hash: n.repeat(64),
      tx_index: 0,
      address,
      value,
      payment_cred: key,
      stake_address: null,
      asset_list: [],
    });
    // The account's 0/0 with a stranger's stake key (any 28 bytes), and 0/0 with no staking part.
    const strangers = preprodAddress(key, "ab".repeat(28));
    const enterprise = preprodAddress(key);
    tb.koios.addedToAccounts.push(stray("e", strangers, "30000000"), stray("f", enterprise, "40000000"));

    await tb.balances.get("preprod");
    const { receiveAddress } = await tb.wallet.account("preprod");
    const listed = (await tb.coins.lists("preprod")).cardano;
    const at = (address: string) => listed.find((u) => u.address === address)!;

    // The worker lists both as 0/0's, the same place as the Receive address ...
    expect(receiveAddress).toBe(v.preprod.receive_0);
    expect(at(receiveAddress).path).toEqual({ role: 0, index: 0 });
    expect(at(strangers).path).toEqual({ role: 0, index: 0 });
    expect(at(enterprise).path).toEqual({ role: 0, index: 0 });
    // ... and the stranger's one starts as the Receive address does, as far as the details' 16…8 shows its head.
    expect(strangers).not.toBe(receiveAddress);
    expect(strangers.slice(0, 16)).toBe(receiveAddress.slice(0, 16));

    // The control: a UTxO at the Receive address itself is said to be it, and nothing of its stake.
    expect(at(receiveAddress).otherStake).toBeUndefined();
    expect(whose(at(receiveAddress))).toBe(RECEIVE);
    // Neither of the others is the one Receive shows: each says its stake part isn't the account's.
    for (const address of [strangers, enterprise]) {
      expect(at(address).otherStake).toBe(true);
      expect(whose(at(address)), address).not.toBe(RECEIVE);
      expect(stake(at(address))).toContain(t("utxos.addressWhose.warn.stakeElsewhere"));
    }
  });
});

describe("Transaction details, of an output so paid (chunk 51, x1a#1's root)", () => {
  const decoded = (): TxDetail => {
    const wasm = loadTestWasm();
    return JSON.parse(wasm.decodeTx(wasm.Network.Preprod, transferPreprod.final.txCbor)) as TxDetail;
  };
  const page = (detail: TxDetail) => render(createElement(TxDetailBody, { detail, network: "preprod", testId: "tx" }));

  it("tags an account's output whose stake part isn't one of the accounts' stake keys", () => {
    const detail = decoded();
    detail.outputs[0]!.yours = { kind: "account", account: 0, stakeElsewhere: true };
    detail.outputs[1]!.yours = { kind: "account", account: 0 };
    const markup = page(detail);
    expect(markup.match(/data-testid="tx-output-yours-stake-elsewhere"/g)).toHaveLength(1);
    expect(words(markup)).toContain(`${t("tx.yours.account")} ${t("tx.yours.warn.stakeElsewhere")}`);
  });
});

describe("Transaction details, of a payment into Seedelf Wallet's contract (chunk 51, d1#3's words)", () => {
  const decoded = (): TxDetail => {
    const wasm = loadTestWasm();
    return JSON.parse(wasm.decodeTx(wasm.Network.Preprod, transferPreprod.final.txCbor)) as TxDetail;
  };
  const register = { generator: "97".repeat(48), publicValue: "c0" + "00".repeat(47) };

  it("says who could spend what's under its register: its key's holder, anyone, or no one ever", () => {
    const said = (payable: boolean, anyone?: boolean) => {
      const detail = decoded();
      detail.outputs[0]!.address.seedelf = true;
      detail.outputs[0]!.register = { ...register, payable, ...(anyone === undefined ? {} : { anyone }) };
      return words(render(createElement(TxDetailBody, { detail, network: "preprod", testId: "tx" })));
    };
    expect(said(true, false)).toContain(t("tx.out.underRegister"));
    // An identity public value: anyone can make its proof, so anyone could take what's there, never "nobody".
    expect(said(false, true)).toContain(t("tx.out.warn.anyoneCanSpend"));
    expect(said(false, true)).not.toContain(t("tx.out.deadRegister"));
    // Not 48 bytes, off the curve or its subgroup, an identity generator: no one ever could.
    expect(said(false, false)).toContain(t("tx.out.deadRegister"));
    // A view read before the WebAssembly knew who: as it was.
    expect(said(false)).toContain(t("tx.out.deadRegister"));
  });

  // Chunk 51, r2sign#1: a datum kept by hash is no register WebAssembly reads (decode.rs `register`, the inline datum
  // alone), carried in the witness set or not, and no Seedelf Wallet finds such a payment. Its line says so, as the sign
  // window does, and calls it neither anyone's nor a register.
  it("says no Seedelf Wallet finds a payment there that keeps its datum by hash, and only there", () => {
    const line = (seedelf: boolean) => {
      const detail = decoded();
      Object.assign(detail.outputs[0]!, { inlineDatum: null, datum: null, datumHash: "ab".repeat(32), register: null });
      detail.outputs[0]!.address.seedelf = seedelf;
      const markup = render(createElement(TxDetailBody, { detail, network: "preprod", testId: "tx" }));
      return words(/<li class="list__row dapp-paid">.*?<\/li>/s.exec(markup)?.[0] ?? "");
    };
    const at = line(true);
    expect(at).toContain(`${t("tx.out.seedelfContract")} · ${t("tx.out.datumByHash")} · ${t("tx.out.warn.seedelfByHash")}`);
    expect(at).not.toMatch(/anyone|\bregister\b/i);
    // Another contract's datum by hash: whoever reads it, it's not the wallet's to say.
    expect(line(false)).toContain(t("tx.out.datumByHash"));
    expect(line(false)).not.toContain(t("tx.out.warn.seedelfByHash"));
  });
});
